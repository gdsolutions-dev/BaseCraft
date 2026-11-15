// Converter of the text Access's SaveAsText writes for a macro (a `macros/<n>.txt` file or the inside of an `EmMacro` block) into a
// BaseCraft macro definition, batch E5. Pure module: no database, no UI. What it cannot carry becomes a comment item, never a loss.
import { parseAccessText } from './access-text';
import { memberRoot } from './expr/members';
import { parseCanonical, serialize } from './expr/parser';
import { isValidObjectName, sameName } from './field-types';
import { actionDef } from './macro/catalog';
import { validateMacro, type MacroDef, type MacroItem } from './macro/model';
import { parsePythonCall } from './python/call-text';

export interface AccessMacroRow { macroName?: string; condition?: string; action?: string; args: string[]; comment?: string }
export type MacroNote = { code: 'actionComment'; part: string /* Access action name */ } | { code: 'elseLost' } | { code: 'conditionKept'; part: string }
  | { code: 'notConverted' } | { code: 'argumentDropped'; part: string /* Action.Argument */ };
export type MacroRefKind = 'form' | 'report' | 'query' | 'table' | 'macro';

/** The rows of a macro text; null when it is not one. */
export function parseAccessMacro(text: string): AccessMacroRow[] | null {
  let n = 0;   // the reader keeps one value per property name: number the positional arguments of each row
  const lines = text.replace(/^﻿/, '').split('\n').map((l) => (/^\s*Begin\s*$/.test(l) ? ((n = 0), l) : l.replace(/^(\s*)Argument(\s*=)/, (_, a: string, b: string) => `${a}Argument#${n++}${b}`)));
  try {
    const { root } = parseAccessText(`Begin Form\n${lines.join('\n')}\nEnd\n`);
    const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : typeof v === 'number' ? String(v) : undefined);
    const rows: AccessMacroRow[] = [];
    for (const b of root.blocks) {
      if (b.type !== '' || b.blocks.length) return null;
      const args: string[] = [];
      for (const [k, v] of b.props) { const m = /^Argument#(\d+)$/.exec(k); if (m) args[+m[1]] = str(v) ?? ''; }
      rows.push({ macroName: str(b.props.get('MacroName')), condition: str(b.props.get('Condition')), action: str(b.props.get('Action')),
        args: Array.from(args, (a) => a ?? ''), comment: str(b.props.get('Comment')) });
    }
    return rows.length || /^\s*Version\b/m.test(text) ? rows : null;   // no row and no header: not a macro text
  } catch { return null; }
}

// Defaults: DoCmd typelib defaults and the macro designer's defaults, both in docs/analyse-access/actions-macro.md (section 2 catalogue and the DoCmd signatures).
// Mapping table. One column per positional `Argument` of the Access action (orders: Microsoft's DoCmd method of the action; the fixture
// confirms OpenReport). A column with `to` becomes that BaseCraft argument; one without must hold Access's default (`ok`) or the action is a comment.
// `def`: Access's own default of the argument (its stored form), taken for an empty value and emitted explicitly; an enumeration without one maps no empty value.
// `note`: an argument BaseCraft has no place for whose value other than `ok`/empty is dropped with a note.
interface Col { to?: string; quiet?: string[]; def?: string; note?: string; t?: 'raw' | 'text' | 'expr' | 'ref' | 'where' | 'bool' | 'num' | 'call' | 'excel' | 'pdf' | 'xlsx'; map?: Record<string, string>; ok?: string[] }
const raw = (to: string): Col => ({ to, t: 'raw' });
const txt = (to: string): Col => ({ to, t: 'text' });
const ex = (to: string): Col => ({ to, t: 'expr' });
const wh = (to: string): Col => ({ to, t: 'where' });
const bl = (to: string, def?: string): Col => ({ to, t: 'bool', def });
const en = (to: string, map: Record<string, string>, def?: string): Col => ({ to, map, def });
const drop = (...ok: string[]): Col => ({ ok });   // '' (not set) is always Access's default too
const OBJECT_TYPE = { '-1': '', 0: 'table', 1: 'query', 2: 'form', 3: 'report', 4: 'macro' };   // AcObjectType
const VIEW = { 0: 'datasheet', 1: 'design' };   // AcView of OpenQuery / OpenTable (2, 3, 4… are views BaseCraft lacks)
const dataMode = (part: string): Col => ({ to: 'DataMode', note: part });   // OpenQuery / OpenTable: 1 (acEdit, the default) or empty is silent, 2 is readOnly, 0 (add) is dropped with a note
const OUTPUT_AUTO_START: Col = { note: 'OutputTo.AutoStart', quiet: ['0'] };   // OutputTo: 0 (no) or empty is silent, any other value is dropped with a note
const none: Col[] = [];
const MAP = new Map<string, { to: string; cols: Col[] }>([
  ['Beep', { to: 'Beep', cols: none }], ['CancelEvent', { to: 'CancelEvent', cols: none }], ['ClearMacroError', { to: 'ClearMacroError', cols: none }],
  ['CloseDatabase', { to: 'CloseDatabase', cols: none }], ['DeleteRecord', { to: 'DeleteRecord', cols: none }], ['RefreshRecord', { to: 'RefreshRecord', cols: none }],
  ['RemoveAllTempVars', { to: 'RemoveAllTempVars', cols: none }], ['SaveRecord', { to: 'SaveRecord', cols: none }], ['ShowAllRecords', { to: 'ShowAllRecords', cols: none }],
  ['StopAllMacros', { to: 'StopAllMacros', cols: none }], ['StopMacro', { to: 'StopMacro', cols: none }], ['UndoRecord', { to: 'UndoRecord', cols: none }],
  ['Close', { to: 'CloseWindow', cols: [en('ObjectType', OBJECT_TYPE, '-1'), raw('ObjectName'), drop('0')] }],   // Save: acSavePrompt is the default
  ['CloseWindow', { to: 'CloseWindow', cols: [en('ObjectType', OBJECT_TYPE, '-1'), raw('ObjectName'), drop('0')] }],
  ['FindRecord', { to: 'FindRecord', cols: [txt('FindWhat'), en('Match', { 0: 'anywhere', 1: 'whole', 2: 'start' }, '1'), bl('MatchCase', 'no'),
    en('Search', { 0: 'up', 1: 'down', 2: 'all' }, '2'), drop('0', 'no', 'false'), en('OnlyCurrentField', { '-1': 'yes', 0: 'no' }, '-1'), bl('FindFirst', 'yes')] }],
  // OutputTo (object type 0 table / 1 query, format, file, auto start, template, encoding, quality): only the Excel workbook of a table or query; quality is ignored
  ...['OutputTo', 'ExportWithFormatting'].map((n): [string, { to: string; cols: Col[] }] => [n, { to: 'ExportWithFormatting', cols: [en('ObjectType', { 0: 'table', 1: 'query' }), raw('ObjectName'),
    { to: 'OutputFormat', t: 'excel', def: '' }, { to: 'OutputFile', t: 'xlsx' }, OUTPUT_AUTO_START, drop(), drop(), drop('0', '1')] }]),
  // SendObject (object type, name, format, to, cc, bcc, subject, text, edit message, template): only a report as a PDF. Edit Message No (Access sends
  // with no window) is noted: BaseCraft always opens a draft; so is a template file
  ...['SendObject', 'EMailDatabaseObject'].map((n): [string, { to: string; cols: Col[] }] => [n, { to: 'EMailDatabaseObject', cols: [en('ObjectType', { 3: 'report' }), raw('ObjectName'),
    { to: 'OutputFormat', t: 'pdf', def: '' }, txt('To'), txt('Cc'), txt('Bcc'), txt('Subject'), txt('MessageText'),
    { note: 'SendObject.EditMessage', quiet: ['-1', '1', 'yes', 'Yes', 'true', 'True'] }, { note: 'SendObject.TemplateFile', quiet: [] }] }]),
  ['GoToControl', { to: 'GoToControl', cols: [txt('ControlName')] }],
  ['GoToRecord', { to: 'GoToRecord', cols: [en('ObjectType', { '-1': '', 2: 'form' }, '-1'), raw('ObjectName'),
    en('Record', { 0: 'previous', 1: 'next', 2: 'first', 3: 'last', 4: 'goTo', 5: 'new' }, '1'), { to: 'Offset', t: 'num' }] }],
  ['SearchForRecord', { to: 'SearchForRecord', cols: [en('ObjectType', { '-1': '', 2: 'form' }, '-1'), raw('ObjectName'),
    en('Record', { 0: 'previous', 1: 'next', 2: 'first', 3: 'last' }, '2'), txt('WhereCondition')] }],
  ['MsgBox', { to: 'MessageBox', cols: [txt('Message'), bl('Beep', 'yes'), en('Type', { 0: 'none' }, '0'), txt('Title')] }],   // icons: numbers not confirmed, so comment
  ['MessageBox', { to: 'MessageBox', cols: [txt('Message'), bl('Beep', 'yes'), en('Type', { 0: 'none' }, '0'), txt('Title')] }],
  ['OnError', { to: 'OnError', cols: [en('GoTo', { 0: 'next', 1: 'macroName', 2: 'fail' }, '0'), raw('MacroName')] }],   // GoTo 0/1/2: docs/analyse-access/actions-macro.md (MSACCESS.EXE strings), not a Microsoft page
  ['OpenForm', { to: 'OpenForm', cols: [raw('FormName'), en('View', { 0: 'form', 1: 'design', 3: 'datasheet' }, '0'), drop(), wh('WhereCondition'),
    en('DataMode', { '-1': '', 0: 'add', 1: 'edit', 2: 'readOnly' }, '-1'), en('WindowMode', { 0: 'normal', 3: 'dialog' }, '0')] }],
  ['OpenQuery', { to: 'OpenQuery', cols: [raw('QueryName'), en('View', VIEW, '0'), dataMode('OpenQuery.DataMode')] }],
  ['OpenReport', { to: 'OpenReport', cols: [raw('ReportName'), en('View', { 0: 'print', 1: 'design', 2: 'preview' }), drop(),   // View: no default (typelib 0 = print, designer: report view BaseCraft lacks), so an empty one is a comment
    wh('WhereCondition'), drop('0')] }],
  ['OpenTable', { to: 'OpenTable', cols: [raw('TableName'), en('View', VIEW, '0'), dataMode('OpenTable.DataMode')] }],
  ['Quit', { to: 'Quit', cols: [drop('1')] }],   // Options: acQuitSaveAll is the default
  ['RemoveTempVar', { to: 'RemoveTempVar', cols: [txt('Name')] }],
  ['Requery', { to: 'Requery', cols: [txt('ControlName')] }],
  ['RunCode', { to: 'RunCode', cols: [{ to: 'FunctionName', t: 'call' }] }],
  ['RunMacro', { to: 'RunMacro', cols: [raw('MacroName'), { to: 'RepeatCount', t: 'num' }, ex('RepeatExpression')] }],
  ['RunSQL', { to: 'RunSQL', cols: [raw('SQLStatement'), drop('-1', 'yes', 'true')] }],   // UseTransaction: Yes is the default
  ['SetLocalVar', { to: 'SetLocalVar', cols: [txt('Name'), ex('Expression')] }],
  ['SetProperty', { to: 'SetProperty', cols: [txt('ControlName'), en('Property', { 0: 'enabled', 1: 'visible', 2: 'locked', 3: 'left', 4: 'top', 5: 'width',
    6: 'height', 7: 'foreColor', 8: 'backColor', 9: 'caption', 10: 'value' }), txt('Value')] }],
  ['SetTempVar', { to: 'SetTempVar', cols: [txt('Name'), ex('Expression')] }],
  ['SetValue', { to: 'SetValue', cols: [{ to: 'Item', t: 'ref' }, ex('Expression')] }],
  ['SetWarnings', { to: 'SetWarnings', cols: [bl('WarningsOn', 'no')] }],
  ['ApplyFilter', { to: 'ApplyFilter', cols: [drop(), wh('WhereCondition'), drop()] }],
]);
/** The Access action names the table maps (RunCommand apart). */
export const ACCESS_ACTION_NAMES: string[] = [...MAP.keys()];

// RunCommand: AcCommand number → action. AcCommand: https://learn.microsoft.com/en-us/office/vba/api/access.accommand (also in docs/analyse-access/actions-macro.md).
const COMMANDS = new Map<string, { action: string; args?: Record<string, string> }>([
  ['97', { action: 'SaveRecord' }], ['292', { action: 'UndoRecord' }], ['223', { action: 'DeleteRecord' }],
  ['50', { action: 'RunMenuCommand', args: { Command: 'selectRecord' } }], ['190', { action: 'RunMenuCommand', args: { Command: 'copy' } }],
  ['191', { action: 'RunMenuCommand', args: { Command: 'paste' } }], ['340', { action: 'RunMenuCommand', args: { Command: 'print' } }], ['590', { action: 'RunMenuCommand', args: { Command: 'printSelection' } }],
  ['28', { action: 'GoToRecord', args: { Record: 'new' } }], ['58', { action: 'CloseWindow' }], ['186', { action: 'CloseWindow' }]]);

// The canonical form of an Access expression, as E4 does for a control source; undefined when it does not read.
// Access writes the members of MacroError / TempVars / LocalVars with a dot (or none: MacroError alone is its Number); BaseCraft's form is `[Root]![X]`.
const ROOT_MEMBER = /"(?:[^"]|"")*"|(?<![\w\]!.])\[?(MacroError|TempVars|LocalVars|Form)\]?(?:\.(?:\[([^\]]+)\]|(\w+))|(?![\w.!(]))/gi;
const SCREEN = /"(?:[^"]|"")*"|(?<![\w\]!.])\[?Screen\]?\.\[?(PreviousControl|ActiveControl)\]?(?:\.\[?(Name)\]?)?(?![\w\]])/gi;   // [Screen]![PreviousControl]![Name], [Screen]![ActiveControl](![Name])
const bang = (s: string): string => s.replace(SCREEN, (m, a?: string, nm?: string) => a ? `[Screen]![${a.toLowerCase() === 'activecontrol' ? 'ActiveControl' : 'PreviousControl'}]${nm ? '![Name]' : ''}` : m).replace(ROOT_MEMBER, (m, root?: string, br?: string, w?: string) => {
  if (!root) return m;
  const r = memberRoot(root)!, member = br ?? w;
  return member ? `[${r}]![${member}]` : r === 'MacroError' ? '[MacroError]![Number]' : m;
});
// [Form] / [Screen] members: only the ones the macro runtime reads (formMember), with these exact spellings. SQL (a where argument)
// and an assigned Item cannot carry them (plain). Any other member of these two roots: not convertible.
const FORM_MEMBERS = ['NewRecord', 'Dirty'], SCREEN_MEMBERS = ['PreviousControl', 'ActiveControl'];
function formScreenOk(n: unknown, plain: boolean): boolean {
  if (Array.isArray(n)) return n.every((x) => formScreenOk(x, plain));
  if (typeof n !== 'object' || n === null) return true;
  const e = n as { k?: string; path?: string[] };
  if (e.k === 'member' && e.path && (e.path[0] === 'Form' || e.path[0] === 'Screen')) {
    if (plain) return false;
    const [root, key = '', prop] = e.path;
    const ok = (root === 'Form' ? FORM_MEMBERS : SCREEN_MEMBERS).find((m) => sameName(m, key));
    const alone = root === 'Screen' && ok === 'ActiveControl' && e.path.length === 2;   // [Screen]![ActiveControl]: the control's value
    if (!ok || (root === 'Form' ? e.path.length !== 2 : !alone && (e.path.length !== 3 || !prop || !sameName(prop, 'Name')))) return false;
    e.path[1] = ok; if (root === 'Screen' && !alone) e.path[2] = 'Name';
    return true;
  }
  return Object.values(n).every((x) => formScreenOk(x, plain));
}
const canon = (s: string, plain = false): string | undefined => { try { const e = parseCanonical(bang(s)); return formScreenOk(e, plain) ? serialize(e) : undefined; } catch { return undefined; } };
const YES = ['yes', '-1', '1', 'true'], NO = ['no', '0', 'false'];

// One argument value; undefined: not convertible; null: nothing to set.
function convertArg(c: Col, v: string): string | null | undefined {
  if (v === '') { if (c.def === undefined) return c.map || c.t === 'bool' ? undefined : null; v = c.def; }
  if (c.map) { const m = Object.hasOwn(c.map, v) ? c.map[v] : undefined; return m === '' ? null : m; }
  switch (c.t) {
    case 'bool': return YES.includes(v.toLowerCase()) ? 'yes' : NO.includes(v.toLowerCase()) ? 'no' : undefined;
    case 'text': case 'num': {
      if (v.startsWith('=')) { const e = canon(v.slice(1)); return e === undefined ? undefined : `=${e}`; }
      return c.t === 'num' && !/^-?\d+(\.\d+)?$/.test(v) ? undefined : v;
    }
    case 'expr': case 'ref': case 'where': {
      return canon(c.t === 'where' ? v : v.replace(/^=/, ''), c.t === 'where' || c.t === 'ref');
    }
    case 'excel': return v.replace(/\s/g, '').toLowerCase() === 'excelworkbook(*.xlsx)' ? 'excel' : undefined;   // AcOutputFormat names the format by its filter text
    case 'pdf': return v.replace(/\s/g, '').toLowerCase() === 'pdfformat(*.pdf)' ? 'pdf' : undefined;
    case 'xlsx': return /\.xlsx$/i.test(v) ? v : undefined;   // a path the main process will write: only a workbook
    case 'call': return parsePythonCall(v) ? v : undefined;
    default: return v;
  }
}

function convertAction(row: AccessMacroRow, extra: MacroNote[]): MacroItem | undefined {
  const name = row.action ?? '';
  if (name === 'RunCommand') {
    const c = COMMANDS.get((row.args[0] ?? '').trim());
    return c && row.args.slice(1).every((a) => a === '') ? { k: 'action', action: c.action, args: { ...c.args } } : undefined;
  }
  const entry = MAP.get(name);
  if (!entry || row.args.slice(entry.cols.length).some((a) => a !== '')) return undefined;
  const args: Record<string, string> = {};
  for (let i = 0; i < entry.cols.length; i++) {
    const c = entry.cols[i], v = row.args[i] ?? '';
    if (c.note) { if (c.to && v === '2') args[c.to!] = 'readOnly'; else if (v !== '' && !(c.quiet ?? ['1']).includes(v)) extra.push({ code: 'argumentDropped', part: c.note }); continue; }
    if (!c.to) { if (v !== '' && !(c.ok ?? []).includes(v.toLowerCase())) return undefined; continue; }
    const r = convertArg(c, v);
    if (r === undefined) return undefined;
    if (r !== null) args[c.to] = r;
  }
  return { k: 'action', action: entry.to, args };
}

const actionText = (row: AccessMacroRow): string => { const a = row.args.join('; ').replace(/(; )*$/, ''); return a ? `${row.action}: ${a}` : row.action!; };
const valid = (item: MacroItem): boolean => validateMacro({ formatVersion: '1.0', items: [item] }).length === 0;

function convertRows(rows: AccessMacroRow[], notes: MacroNote[]): MacroItem[] {
  const out: MacroItem[] = [];
  let branch: MacroItem[] | undefined, bad: string | undefined;   // the open `if` branch, or the condition that did not convert
  for (const row of rows) {
    const c = row.condition?.trim();
    if (c && c !== '...') {
      const cond = canon(c);
      bad = cond === undefined ? c : undefined;
      if (cond === undefined) { branch = undefined; notes.push({ code: 'conditionKept', part: c }); }
      else { branch = []; out.push({ k: 'if', branches: [{ cond, items: branch }] }); }
    } else if (!c) { branch = undefined; bad = undefined; }
    const target = branch ?? out;
    if (row.action) {
      const extra: MacroNote[] = [], item = bad === undefined && !(c === '...' && !branch) ? convertAction(row, extra) : undefined;   // "..." with no branch open: no condition to carry
      if (item && valid(item)) { target.push(item); notes.push(...extra); }
      else {
        target.push({ k: 'comment', text: bad === undefined ? actionText(row) : `If ${bad}: ${actionText(row)}` });
        if (bad === undefined) notes.push({ code: 'actionComment', part: row.action });
      }
    }
    if (row.comment) target.push({ k: 'comment', text: row.comment });
  }
  return out;
}

export function convertAccessMacro(rows: AccessMacroRow[]): { def: MacroDef; notes: MacroNote[] } {
  const notes: MacroNote[] = [];
  const isAxl = (r: AccessMacroRow): boolean => r.comment?.startsWith('_AXL:') === true;
  // ponytail: rows only; read the AXL XML when a real base needs Else blocks
  if (rows.filter(isAxl).map((r) => r.comment!.slice(5)).join('').includes('<Else')) notes.push({ code: 'elseLost' });
  const segments: { name?: string; rows: AccessMacroRow[] }[] = [{ rows: [] }];
  for (const r of rows.filter((r) => !isAxl(r))) {
    if (r.macroName) segments.push({ name: r.macroName, rows: [] });
    segments[segments.length - 1].rows.push(r);
  }
  const items = convertRows(segments[0].rows, notes);
  const used: string[] = segments.slice(1).map((s) => s.name!);   // original names are reserved: a renamed one never takes one
  const taken = (n: string): boolean => used.some((u) => sameName(u, n));
  segments.slice(1).forEach((s, i) => {
    const sub = convertRows(s.rows, notes);
    let name = s.name!;
    if (!isValidObjectName(name) || segments.slice(1, i + 1).some((p) => sameName(p.name!, name))) {
      sub.unshift({ k: 'comment', text: `Submacro: ${name}` });
      for (let k = i + 1; taken((name = `Sub${k}`)); k++);
      used.push(name);
    }
    items.push({ k: 'submacro', name, items: sub });
  });
  const def: MacroDef = { formatVersion: '1.0', items };
  return validateMacro(def).length ? commentMacro(rows) : { def, notes };
}

/** The whole macro as comment items (one per row of the original) and one notConverted note. */
export function commentMacro(rows: AccessMacroRow[]): { def: MacroDef; notes: MacroNote[] } {
  const items: MacroItem[] = [];
  for (const r of rows) {
    if (r.comment?.startsWith('_AXL:')) continue;
    if (r.action) items.push({ k: 'comment', text: actionText(r) });
    if (r.comment) items.push({ k: 'comment', text: r.comment });
  }
  return { def: { formatVersion: '1.0', items }, notes: [{ code: 'notConverted' }] };
}

const REF_KIND: Record<string, MacroRefKind> = { formName: 'form', reportName: 'report', queryName: 'query', tableName: 'table', macroName: 'macro' };
const OBJECT_KIND: Record<string, MacroRefKind> = { table: 'table', query: 'query', form: 'form', report: 'report', macro: 'macro' };
const childItems = (i: MacroItem): MacroItem[] => (i.k === 'group' || i.k === 'submacro' ? i.items : i.k === 'if' ? [...i.branches.flatMap((b) => b.items), ...(i.else ?? [])] : []);

// The kind of object an argument names, if it names one (an `=expression` names none).
function refOf(action: string, args: Record<string, string>, name: string): MacroRefKind | undefined {
  if (args[name] === '' || args[name].startsWith('=')) return undefined;
  const type = actionDef(action)?.args.find((a) => a.name === name)?.type;
  if (type === 'objectName') return Object.hasOwn(OBJECT_KIND, args.ObjectType ?? '') ? OBJECT_KIND[args.ObjectType] : undefined;
  if (action === 'OnError') return name === 'MacroName' && args.GoTo === 'macroName' ? 'macro' : undefined;
  return type && Object.hasOwn(REF_KIND, type) ? REF_KIND[type] : undefined;
}
// `M.Sub` of a macro: M and `.Sub`.
const split = (kind: MacroRefKind, v: string): [string, string] => { const i = kind === 'macro' ? v.indexOf('.') : -1; return i < 0 ? [v, ''] : [v.slice(0, i), v.slice(i)]; };

/** A copy of the definition with the object names the actions hold renamed (`undefined`: unchanged). */
export function renameMacroRefs(def: MacroDef, rename: (kind: MacroRefKind, name: string) => string | undefined): MacroDef {
  const copy = structuredClone(def);
  const walk = (items: MacroItem[]): void => {
    for (const i of items) {
      if (i.k === 'action') for (const n of Object.keys(i.args)) {
        const kind = refOf(i.action, i.args, n);
        if (!kind) continue;
        const [base, rest] = split(kind, i.args[n]), to = rename(kind, base);
        if (to !== undefined) i.args[n] = to + rest;
      }
      walk(childItems(i));
    }
  };
  walk(copy.items);
  return copy;
}
