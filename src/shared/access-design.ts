// Converter of the text Access's SaveAsText writes for a form or a report into a BaseCraft design document, batch E4. Pure module.
import { convertAccessMacro, parseAccessMacro } from './access-macro';
import { AccessTextError, blockBytes, parseAccessText, type AccessBlock } from './access-text';
import { accessPage } from './access-page';
import { resolveAccess } from './access-design-defaults';
import { EVENTS, readEvent } from './design/events';
import { EVENT_PROCEDURE, procedureName } from './python/code-behind';
import { PROPERTY_CATALOG, defaultFor, descriptorFor, type PropertyDescriptor, type PropertyEditorKind, type PropertyTarget } from './design/properties';
import type { ControlDef, ControlKind, DesignDoc, SectionDef, SectionKind } from './design/model';
import { parseCanonical, serialize, serializeCriteria } from './expr/parser';
import { MAX_TWIPS, foldName, isValidObjectName } from './field-types';
import { DEFAULT_COLUMNS, type GroupLevel } from './report/model';

export interface DesignNote {
  code: 'controlReplaced' /* part: control, reason: Access block type */ | 'eventDropped' /* part, reason: 'procedure' | 'expression' | 'embeddedMacro' */
    | 'expressionKept' /* part: control, or 'grouping' */ | 'sectionDropped' /* part: Access block type */ | 'controlRenamed' /* part: old name, reason: new name */
    | 'eventProcedure' /* part: the procedure, kept as [Event Procedure] (keepProcedures) */ | 'pageDefault' | 'macroNote' /* part: `Owner.Event` and `: <Access action>` when the note has one, reason: the MacroNote code */;
  part?: string; reason?: string }
export interface ConvertedDesign {
  doc: DesignDoc;                 // recordSource is always null here: the engine resolves it
  recordSource: string;           // as Access wrote it ('' when none)
  ignored: Map<string, number>;   // SaveAsText property name → times it was present and not carried
  notes: DesignNote[];
  code: string | null;            // the code-behind (the VBA after CodeBehindForm / CodeBehindReport), null when there is none
}

type Raw = number | string;
interface Ctx { kind: 'form' | 'report'; defaults: ReadonlyMap<string, AccessBlock>; ignored: Map<string, number>; notes: DesignNote[]; keep: boolean; names: Set<string>; nextSuffix: Map<string, number>; made: number }   // made: controls so far; names: folded; nextSuffix: folded base → the next number to try
/** What a converter can reach: the resolved value of another name of the same block, a count of its own name, the "kept as written" note. */
interface X { get(name: string): Raw | undefined; count(name: string): void; kept(): void }
type Conv = (v: Raw, x: X, d: PropertyDescriptor) => unknown;   // undefined: not carried; null: read, nothing to write

const num = (v: Raw): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);
const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
const twips = (n: number) => Math.round(clamp(n, 0, MAX_TWIPS));
const table = (t: readonly string[]): Conv => (v) => (typeof v === 'number' ? t[v] || undefined : undefined);   // '' : a number Access does not use
const hex = (n: number) => `#${[n & 255, (n >> 8) & 255, (n >> 16) & 255].map((b) => b.toString(16).padStart(2, '0')).join('')}`;

// System colours (index = n & 0xff of a negative colour) as Windows paints them.
const SYSTEM_COLORS = new Map([[5, '#ffffff'], [8, '#000000'], [15, '#f0f0f0'], [18, '#000000'], [13, '#0078d7'], [14, '#ffffff'], [16, '#a0a0a0'], [17, '#6d6d6d'],
  [12, '#ababab'], [4, '#f0f0f0'], [24, '#ffffe1'], [23, '#000000'], [6, '#646464'], [20, '#ffffff'], [21, '#696969'], [22, '#e3e3e3']]);
const color: Conv = (v) => {
  if (typeof v !== 'number' || !Number.isInteger(v)) return undefined;
  return v >= 0 ? (v <= 0xffffff ? hex(v) : undefined) : SYSTEM_COLORS.get(v & 0xff);
};
// Line styles of Access (BorderLineStyle; the gridlines count the same from 0 transparent, 1 solid): dots are 3-4 (4-5 for gridlines).
const lineOf = (ls: Raw | undefined) => (typeof ls !== 'number' ? undefined : ls === 0 || ls === 7 ? 'solid' : ls === 3 || ls === 4 ? 'dotted' : 'dashed');
const border: Conv = (v, x) => (v === 0 ? 'transparent' : typeof v === 'number' ? lineOf(x.get('BorderLineStyle')) : undefined);
const gridline: Conv = (v) => (v === 0 ? 'transparent' : v === 1 ? 'solid' : v === 4 || v === 5 ? 'dotted' : typeof v === 'number' ? 'dashed' : undefined);

/** `=expr` of a ControlSource: canonical when BaseCraft reads it, as written (and noted) when not. */
const controlSource: Conv = (v, x) => {
  if (typeof v !== 'string' || !v.startsWith('=')) return typeof v === 'string' ? v : undefined;
  try { return `=${serialize(parseCanonical(v.slice(1)))}`; } catch { x.kept(); return v; }
};
// DefaultValue and ValidationRule are stored as the Property Sheet's ExpressionField stores them (toCanonical).
const expression = (criteria: boolean): Conv => (v, x) => {
  if (typeof v !== 'string') return undefined;
  if (v === '') return '';
  try {
    const text = criteria ? v : v.replace(/^=/, '');
    return criteria ? serializeCriteria(parseCanonical(text, { criteria: true })) : serialize(parseCanonical(text));
  } catch { x.kept(); return v; }
};
const rowSourceType = (v: Raw) => (v === 'Table/Query' ? 'tableQuery' : v === 'Value List' ? 'valueList' : undefined);

const BY_EDITOR: Partial<Record<PropertyEditorKind, Conv>> = {
  text: (v) => (typeof v === 'string' ? v : undefined), font: (v) => (typeof v === 'string' ? v : undefined),
  rowSource: (v, x) => (typeof v === 'string' && (x.get('RowSourceType') === undefined || rowSourceType(x.get('RowSourceType')!)) ? v : undefined),
  objectName: (v) => (typeof v === 'string' ? v : undefined), fieldList: (v) => (typeof v === 'string' ? v : undefined),
  bool: (v) => (typeof v === 'number' ? v !== 0 : undefined),
  twips: (v) => { const n = num(v); return n === undefined ? undefined : twips(n); },
  number: (v, _x, d) => { const n = num(v); return n === undefined ? undefined : (d.integer ? Math.round : (a: number) => a)(clamp(n, d.min ?? -Infinity, d.max ?? Infinity)); },
  color, controlSource, expression: expression(false), criteria: expression(true),
};
// Enums, by catalogue name.
const SPECIAL: Record<string, Conv> = {
  BackStyle: table(['transparent', 'normal']),
  FontWeight: (v) => (typeof v === 'number' ? (v >= 600 ? 'bold' : 'normal') : undefined),
  TextAlign: (v) => (typeof v === 'number' ? ['general', 'left', 'center', 'right'][v] ?? 'general' : undefined),
  DefaultView: (v, x) => { const r = typeof v === 'number' ? ['single', 'continuous', 'datasheet'][v] : undefined; if (!r) x.count('DefaultView'); return r ?? 'single'; },
  SizeMode: table(['clip', 'stretch', '', 'zoom']),
  PictureAlignment: table(['topLeft', 'topRight', 'center', 'bottomLeft', 'bottomRight', 'formCenter']),
  ForceNewPage: table(['none', 'before', 'after', 'beforeAndAfter']),
  HorizontalAnchor: table(['left', 'right', 'both']), VerticalAnchor: table(['top', 'bottom', 'both']),
  DecimalPlaces: (v) => (v === 255 ? 'auto' : typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= 15 ? String(v) : undefined),
  RowSourceType: rowSourceType,
  ColumnWidth: (v) => { const n = num(v); return n === undefined ? undefined : n < 0 ? null : n === 0 ? undefined : twips(n); },   // -1 / -2: Access's automatic width, BaseCraft's absence
};
const SIDES = ['Top', 'Bottom', 'Left', 'Right'];
for (const s of SIDES) SPECIAL[`GridlineStyle${s}`] = gridline;

const DESC = new Map(PROPERTY_CATALOG.map((d) => [d.name, d]));
/** Every SaveAsText property that is carried, by its SaveAsText name: the catalogue name it becomes and how. `also`: names read with it (consumed). */
const MAP = new Map<string, { to: string; conv: Conv; also?: string[] }>();
for (const n of ['Caption', 'DefaultView', 'NavigationButtons', 'Width', 'Visible', 'Format', 'DecimalPlaces', 'ColumnCount', 'ColumnWidths', 'ColumnHeads',
  'BackStyle', 'BackColor', 'BorderWidth', 'BorderColor', 'GridlineColor', 'HorizontalAnchor', 'VerticalAnchor', 'ForeColor', 'FontName', 'FontSize',
  'FontWeight', 'FontItalic', 'FontUnderline', 'TextAlign', 'CanGrow', 'CanShrink', 'KeepTogether', 'RepeatSection', 'ForceNewPage', 'AllowAdditions',
  'AllowEdits', 'AllowDeletions', 'ControlSource', 'RowSourceType', 'RowSource', 'BoundColumn', 'LimitToList', 'DefaultValue', 'ValidationRule',
  'ValidationText', 'Enabled', 'Locked', 'OptionValue', 'HyperlinkAddress', 'SourceObject', 'LinkMasterFields', 'LinkChildFields', 'RecordSelectors',
  'SizeMode', 'PictureAlignment', 'LineSlant', 'Tag', 'TabStop', 'TabIndex', 'ControlTipText', 'StatusBarText', 'ColumnWidth',
  ...SIDES.flatMap((s) => [`GridlineStyle${s}`, `GridlineWidth${s}`, `${s}Margin`, `${s}Padding`])]) {
  MAP.set(n, { to: n, conv: SPECIAL[n] ?? BY_EDITOR[DESC.get(n)!.editor]! });
}
MAP.set('OldBorderStyle', { to: 'BorderStyle', conv: border, also: ['BorderLineStyle'] });   // the object model's BorderStyle; form and report have no such property here

const FORM_SECTIONS = new Map<string, SectionKind | 'dropped'>(Object.entries({ FormHeader: 'formHeader', Section: 'detail', FormFooter: 'formFooter',
  PageHeader: 'dropped', PageFooter: 'dropped', BreakHeader: 'dropped', BreakFooter: 'dropped' } as const));
const REPORT_SECTIONS = new Map<string, SectionKind>(Object.entries({ FormHeader: 'reportHeader', PageHeader: 'pageHeader', BreakHeader: 'groupHeader', Section: 'detail',
  BreakFooter: 'groupFooter', PageFooter: 'pageFooter', FormFooter: 'reportFooter' } as const));
const KINDS = new Map<string, ControlKind>(['Label', 'TextBox', 'CheckBox', 'OptionGroup', 'OptionButton', 'ComboBox', 'ListBox', 'CommandButton', 'ToggleButton',
  'Subform', 'Image', 'Line', 'Rectangle', 'PageBreak', 'Tab'].map((t) => [t, (t === 'Tab' ? 'tabControl' : t[0]!.toLowerCase() + t.slice(1)) as ControlKind]));
const POSITION = ['Left', 'Top', 'Width', 'Height'];
const CARRIED_ELSEWHERE = new Set(['RecordSource', 'Name']);   // RecordSource: ConvertedDesign.recordSource; Name: the control's name

const bump = (m: Map<string, number>, k: string) => m.set(k, (m.get(k) ?? 0) + 1);
// Pure bookkeeping, no visible effect: theme indexes, VBA's procedure prefix, web/SharePoint publishing, the design grid, quick-style presets (their colours are carried), the numeric twin of RowSourceType.
const silent = (n: string) => /^(Name|GUID|NameMap|RecSrcDt|ItemSuffix|Right|Bottom|OverlapFlags|Overlaps|LayoutCached(Left|Top|Width|Height)|EventProcPrefix|ThemeFontIndex|RowSourceTypeInt|DisplayOnSharePointSite|NoSaveCTIWhenDisabled|GridY|TabularFamily|QuickStyle|QuickStyleMask|IMESentenceMode|WebImagePadding(Top|Bottom|Left|Right))$/.test(n)
  || /(ThemeColorIndex|Tint|Shade)$/.test(n) || n.startsWith('Prt');
/** The property says what Access would give without it. */
function restates(b: AccessBlock, n: string, defaults: ReadonlyMap<string, AccessBlock>): boolean {
  const own = b.props.get(n);
  const fb = resolveAccess({ ...b, props: new Map() }, n, defaults);
  return fb !== undefined && fb === own;
}
const inner = (b: AccessBlock): AccessBlock[] => b.blocks.filter((x) => x.type === '').flatMap((x) => x.blocks);
const boxOf = (b: AccessBlock, c: Ctx) => POSITION.map((n) => { const v = resolveAccess(b, n, c.defaults); return typeof v === 'number' ? twips(v) : 0; }) as [number, number, number, number];
const accessName = (b: AccessBlock) => { const n = b.props.get('Name'); return typeof n === 'string' ? n : ''; };

interface Who { access: string; name: string }   // the Access name (VBA's) and the BaseCraft one

/** The props of one object (form, section or control), the events with their notes, and the counting of what is left. */
function convertObject(b: AccessBlock, target: PropertyTarget, who: Who, c: Ctx): Record<string, unknown> {
  const kind = c.kind;
  const props: Record<string, unknown> = {};
  const done = new Set<string>();
  const x: X = { get: (n) => resolveAccess(b, n, c.defaults), count: (n) => bump(c.ignored, n), kept: () => c.notes.push({ code: 'expressionKept', part: who.name }) };
  for (const [from, m] of MAP) {
    const d = descriptorFor(m.to, target)!;   // BorderStyle has a form descriptor and a control one
    if (m.to === 'BorderStyle' && target === 'form') continue;   // the form's BorderStyle (window) is not the controls' line style
    if (!d.appliesTo.includes(target) || (d.objects && !d.objects.includes(kind)) || (from === 'Width' && target !== 'form' && target !== 'report')) continue;
    const own = b.props.has(from);
    if (d.default === undefined && !own) continue;   // no default to compare with: only what the object says
    const raw = x.get(from);
    const v = raw === undefined ? undefined : m.conv(raw, x, d);
    if (v === undefined) continue;
    done.add(from);
    if (v === null) continue;
    for (const a of m.also ?? []) done.add(a);
    if (d.editor === 'color' || v !== defaultFor(d, target, kind)) props[m.to] = v;   // colours: BaseCraft's defaults follow the theme, Access's do not
  }
  if (target !== 'form') for (const n of POSITION) if (typeof x.get(n) === 'number') done.add(n);
  const owner = target === 'form' ? 'Form' : who.access;
  for (const ev of EVENTS) {
    const d = DESC.get(ev)!;
    const v = b.props.get(ev);
    if (typeof v !== 'string' || !d.appliesTo.includes(target) || (d.objects && !d.objects.includes(kind))) continue;
    done.add(ev);
    if (v === EVENT_PROCEDURE && c.keep) { props[ev] = v; c.notes.push({ code: 'eventProcedure', part: procedureName(kind, ev, owner) }); }
    else if (v === EVENT_PROCEDURE) c.notes.push({ code: 'eventDropped', part: `${owner}_${ev.replace(/^On/, '')}`, reason: 'procedure' });
    else if (v === '' || v === '[Embedded Macro]') continue;   // the EmMacro block says the rest
    else if (readEvent(v).kind === 'macro') props[ev] = v;
    else c.notes.push({ code: 'eventDropped', part: v.slice(0, 80), reason: 'expression' });
  }
  for (const n of b.props.keys()) {
    const m = /^(.+)EmMacro$/.exec(n);
    if (!m || !(EVENTS as readonly string[]).includes(m[1]!)) continue;
    done.add(n);
    const v = b.props.get(n);
    const d = DESC.get(m[1]!)!;
    try {   // a defect in a macro never loses the form: the block is dropped as any other
      const rows = d.appliesTo.includes(target) && !(d.objects && !d.objects.includes(kind)) && typeof v === 'object' && 'lines' in v ? parseAccessMacro(v.lines.join('\n')) : null;
      if (!rows?.length) throw new Error('dropped');
      const { def, notes } = convertAccessMacro(rows);
      props[m[1]!] = { embedded: def };
      for (const note of notes) c.notes.push({ code: 'macroNote', part: `${owner}.${m[1]}${'part' in note ? `: ${note.part}` : ''}`, reason: note.code });
    } catch { c.notes.push({ code: 'eventDropped', part: `${owner}.${m[1]}`, reason: 'embeddedMacro' }); }
  }
  for (const n of b.props.keys()) if (!done.has(n) && !CARRIED_ELSEWHERE.has(n) && !silent(n) && !restates(b, n, c.defaults)) bump(c.ignored, n);
  return props;
}

const MAX_CONTROLS = 20000;   // one converted object; beyond it the object is skipped (tooLong)
const clean = (s: string) => [...s].filter((ch) => !/[.!`[\]\u0000-\u001f\u007f-\u009f]|\p{Cs}/u.test(ch)).join('').replace(/^\s+/, '');   // eslint-disable-line no-control-regex

function nameOf(b: AccessBlock, fallback: ControlKind, c: Ctx): string {
  const n = accessName(b);
  let name = n;
  if (!isValidObjectName(n) || c.names.has(foldName(n))) {
    const cleaned = [...clean(n)].slice(0, 56).join('');   // 56 + a suffix of up to 8 digits stays within the 64
    const base = isValidObjectName(cleaned) ? cleaned : fallback;
    const fb = foldName(base);
    let i = c.nextSuffix.get(fb) ?? 0;   // 0: the base itself, then base1, base2...
    while (c.names.has(foldName(i ? base + i : base))) i++;
    c.nextSuffix.set(fb, i + 1);
    name = i ? base + i : base;
    c.notes.push({ code: 'controlRenamed', part: n, reason: name });
  }
  c.names.add(foldName(name));
  return name;
}

/** A control and, right after it, its attached labels. `page`: the tab page it sits on. */
function control(b: AccessBlock, c: Ctx, page?: number): ControlDef[] {
  if (b.type === 'EmptyCell') return [];
  if (++c.made > MAX_CONTROLS) throw new AccessTextError('tooLong');
  const known = KINDS.get(b.type);
  const kind: ControlKind = known ?? 'label';
  const name = nameOf(b, kind, c);
  const [left, top, width, height] = boxOf(b, c);
  const kids = inner(b);
  const def: ControlDef = { kind, name, left, top, width, height, props: {} };
  if (known) def.props = convertObject(b, kind, { access: accessName(b) || name, name }, c);
  else {
    def.props = { Caption: name, BorderStyle: 'solid' };
    c.notes.push({ code: 'controlReplaced', part: name, reason: b.type });
  }
  if (page !== undefined) def.props.PageIndex = page;
  if (b.type === 'Tab') {
    const pages: string[] = [];
    def.children = [];
    inner(b).filter((p) => p.type === 'Page').forEach((p, i) => {
      const cap = p.props.get('Caption');
      pages.push(typeof cap === 'string' && cap ? cap : accessName(p) || `Page${i + 1}`);
      def.children!.push(...inner(p).flatMap((k) => control(k, c, i)));
    });
    def.props.Pages = pages;
  } else if (b.type === 'OptionGroup') def.children = kids.filter((k) => k.type !== 'Label').flatMap((k) => control(k, c));
  return [def, ...kids.filter((k) => k.type === 'Label').flatMap((k) => control(k, c, page))];
}

const NO_DEFAULTS: ReadonlyMap<string, AccessBlock> = new Map();
const LEVEL_PROPS = new Set(['ControlSource', 'GroupHeader', 'GroupFooter', 'SortOrder', 'KeepTogether', 'GroupOn', 'GroupInterval']);
const MAX_LEVELS = 10;   // Access's own limit
const KEEP = ['no', 'wholeGroup', 'withFirstDetail'] as const;
/** The group levels (BreakLevel blocks, in order); the level props are counted as ignored here, as an object's are. */
function levelsOf(blocks: AccessBlock[], c: Ctx): GroupLevel[] {
  return blocks.map((b) => {
    const get = (n: string) => resolveAccess(b, n, NO_DEFAULTS);   // a BreakLevel is never a default block
    const src = b.props.get('ControlSource');
    const x: X = { get, count: () => {}, kept: () => c.notes.push({ code: 'expressionKept', part: 'grouping' }) };
    const kt = get('KeepTogether');
    if (get('GroupOn') !== 0) bump(c.ignored, 'GroupOn');
    if (get('GroupInterval') !== 1) bump(c.ignored, 'GroupInterval');
    for (const n of b.props.keys()) if (!LEVEL_PROPS.has(n) && !silent(n)) bump(c.ignored, n);
    return { expression: typeof src === 'string' ? (controlSource(src, x, DESC.get('ControlSource')!) as string) : '', order: get('SortOrder') === 0 ? 'asc' : 'desc',
      header: get('GroupHeader') === 1, footer: get('GroupFooter') === 1, keepTogether: (typeof kt === 'number' && KEEP[kt]) || 'no' };
  });
}

/** Throws AccessTextError (from the reader) and nothing else. The document it returns passes validateDesignDoc.
 *  `keepProcedures`: an event holding `[Event Procedure]` keeps it (the caller imports the code-behind) and gives the note `eventProcedure`. */
export function convertAccessDesign(text: string, kind: 'form' | 'report', opts?: { keepProcedures?: boolean }): ConvertedDesign {
  const t = parseAccessText(text);
  if (t.root.type !== (kind === 'form' ? 'Form' : 'Report')) throw new AccessTextError('noRoot');
  const items = t.root.blocks.find((b) => b.type === '')?.blocks ?? [];
  const secs: ReadonlyMap<string, SectionKind | 'dropped'> = kind === 'form' ? FORM_SECTIONS : REPORT_SECTIONS;
  const first = items.findIndex((b) => secs.has(b.type));
  const preamble = first < 0 ? items : items.slice(0, first);
  const defaults = new Map<string, AccessBlock>();
  for (const b of preamble) if (!defaults.has(b.type) && !(kind === 'report' && b.type === 'BreakLevel')) defaults.set(b.type, b);
  const c: Ctx = { kind, defaults, ignored: new Map(), notes: [], keep: opts?.keepProcedures === true, names: new Set(), nextSuffix: new Map(), made: 0 };
  const props = convertObject(t.root, kind, { access: kind === 'form' ? 'Form' : 'Report', name: kind === 'form' ? 'Form' : 'Report' }, c);
  const levels = kind === 'report' ? levelsOf(preamble.filter((b) => b.type === 'BreakLevel'), c) : [];
  // Access writes the headers outermost first and the footers innermost first
  const headerLevels = levels.flatMap((l, i) => (l.header ? [i] : []));
  const footerLevels = levels.flatMap((l, i) => (l.footer ? [i] : [])).reverse();
  const seen = new Set<SectionKind>();
  const picked: { b: AccessBlock; kind: SectionKind; level?: number }[] = [];
  let nh = 0, nf = 0;
  if (first >= 0) for (const b of items.slice(first)) {
    const s = secs.get(b.type);
    if (s === 'dropped' || (s && seen.has(s) && s !== 'groupHeader' && s !== 'groupFooter')) c.notes.push({ code: 'sectionDropped', part: b.type });   // the first one wins
    else if (s === 'groupHeader' || s === 'groupFooter') {
      const level = (s === 'groupHeader' ? headerLevels[nh++] : footerLevels[nf++]);
      if (level === undefined) c.notes.push({ code: 'sectionDropped', part: b.type });
      else picked.push({ b, kind: s, level });
    } else if (s) { seen.add(s); picked.push({ b, kind: s }); }
  }
  for (const [flag, list, n] of [['header', headerLevels, nh], ['footer', footerLevels, nf]] as const) for (const i of list.slice(n)) levels[i]![flag] = false;
  // a level without a key, or beyond the tenth, goes with its sections (after the pairing, which is Access's)
  const gone = new Set<number>();
  let kept = 0;
  levels.forEach((l, i) => { if (l.expression === '' || ++kept > MAX_LEVELS) gone.add(i); });
  if (gone.size) {
    const to = new Map<number, number>();
    levels.forEach((_, i) => { if (!gone.has(i)) to.set(i, to.size); });
    for (let i = 0; i < gone.size; i++) c.notes.push({ code: 'sectionDropped', part: 'BreakLevel' });
    levels.splice(0, levels.length, ...levels.filter((_, i) => !gone.has(i)));
    for (let i = picked.length - 1; i >= 0; i--) {
      const lv = picked[i]!.level;
      if (lv === undefined) continue;
      if (gone.has(lv)) picked.splice(i, 1); else picked[i]!.level = to.get(lv);
    }
  }
  const sections: SectionDef[] = picked.map(({ b, kind: k, level }) => ({ kind: k, height: boxOf(b, c)[3], props: convertObject(b, k, { access: accessName(b) || b.type, name: accessName(b) || b.type }, c),
    controls: inner(b).flatMap((k2) => control(k2, c)), ...(level === undefined ? {} : { groupLevel: level }) }));
  if (!seen.has('detail')) {   // BaseCraft wants a detail: an empty one, before the first section that follows it
    const at = sections.findIndex((s) => ['groupFooter', 'pageFooter', 'reportFooter', 'formFooter'].includes(s.kind));
    sections.splice(at < 0 ? sections.length : at, 0, { kind: 'detail', height: 0, props: {}, controls: [] });
  }
  if (kind === 'report') {
    if (levels.length) props.grouping = levels;
    const pg = accessPage(blockBytes(t.root.props.get('PrtMip')), blockBytes(t.root.props.get('PrtDevMode')));
    if (!pg) c.notes.push({ code: 'pageDefault' });
    else {
      props.pageSetup = pg.page;
      const d = DEFAULT_COLUMNS;
      if (pg.columns.count !== d.count || pg.columns.spacing !== d.spacing || pg.columns.across !== d.across) props.columns = pg.columns;
    }
  }
  const rs = t.root.props.get('RecordSource');
  return { doc: { formatVersion: '1.0', recordSource: null, props, sections }, recordSource: typeof rs === 'string' ? rs : '', ignored: c.ignored, notes: c.notes, code: t.code.trim() === '' ? null : t.code };
}
