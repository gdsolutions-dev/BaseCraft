import fs from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ACCESS_ACTION_NAMES, commentMacro, convertAccessMacro, parseAccessMacro, renameMacroRefs, type AccessMacroRow } from './access-macro';
import { validateMacro, type MacroDef } from './macro/model';

const fixture = fs.readFileSync(join(__dirname, '../../tests/fixtures/access/Ventes-complet.export/macros/1.txt'), 'utf8');
const row = (action: string, ...args: string[]): AccessMacroRow => ({ action, args });
const rowText = (action: string, ...args: string[]) => `Begin\n  Action ="${action}"\n${args.map((a) => `  Argument ="${a}"\n`).join('')}End\n`;
const convert = (text: string) => convertAccessMacro(parseAccessMacro(text)!);

describe('access macro text', () => {
  it('the fixture: one OpenReport, no note', () => {
    const { def, notes } = convert(fixture);
    expect(def.items).toEqual([{ k: 'action', action: 'OpenReport', args: { ReportName: 'ECommandes', View: 'preview' } }]);
    expect(notes).toEqual([]);
  });
  it('an embedded body: OnError, then a RunCommand with an unmapped number', () => {
    const { def, notes } = convert(`Version =196611\nColumnsShown =8\n${rowText('OnError', '0', '')}${rowText('RunCommand', '4')}`);
    expect(def.items).toEqual([{ k: 'action', action: 'OnError', args: { GoTo: 'next' } }, { k: 'comment', text: 'RunCommand: 4' }]);
    expect(notes).toEqual([{ code: 'actionComment', part: 'RunCommand' }]);
  });
  it('RunCommand with the save-record number is SaveRecord', () => {
    expect(convert(rowText('RunCommand', '97')).def.items).toEqual([{ k: 'action', action: 'SaveRecord', args: {} }]);
  });
  it('is not a macro text', () => {
    expect(parseAccessMacro('Begin Form\nEnd\n')).toBeNull();
    expect(parseAccessMacro('Begin\nEnd\nEnd\n')).toBeNull();
  });
});

describe('structure', () => {
  it('named rows start submacros, placed after the unnamed rows', () => {
    const { def } = convertAccessMacro([row('CancelEvent'), { ...row('Beep'), macroName: 'A' }, row('Quit', '1'), { ...row('StopMacro'), macroName: 'B' }]);
    expect(def.items.map((i) => (i.k === 'submacro' ? [i.name, i.items.length] : i.k))).toEqual(['action', ['A', 2], ['B', 1]]);
  });
  it('a Condition row then a "..." row make one if with two items', () => {
    const { def, notes } = convertAccessMacro([{ ...row('Beep'), condition: '[X]>1' }, { ...row('StopMacro'), condition: '...' }, row('Beep')]);
    expect(def.items).toHaveLength(2);
    expect(def.items[0]).toMatchObject({ k: 'if', branches: [{ items: [{ action: 'Beep' }, { action: 'StopMacro' }] }] });
    expect(notes).toEqual([]);
  });
  it('a condition that does not convert: comment items and conditionKept', () => {
    const { def, notes } = convertAccessMacro([{ ...row('Beep'), condition: '[X] >>> (' }, { ...row('StopMacro'), condition: '...' }]);
    expect(def.items.map((i) => i.k)).toEqual(['comment', 'comment']);
    expect(notes).toEqual([{ code: 'conditionKept', part: '[X] >>> (' }]);
  });
  it('AXL rows are dropped, one elseLost when they hold an Else', () => {
    const axl = (c: string): AccessMacroRow => ({ args: [], comment: `_AXL:${c}` });
    const { def, notes } = convertAccessMacro([row('Beep'), axl('<If><Condition>x</Condition></If><El'), axl('se>')]);
    expect(def.items).toHaveLength(1);
    expect(notes).toEqual([{ code: 'elseLost' }]);
    expect(convertAccessMacro([axl('<Statements/>')]).notes).toEqual([]);
  });
  it('a plain comment row is a comment item', () => {
    expect(convertAccessMacro([{ args: [], comment: 'hello' }]).def.items).toEqual([{ k: 'comment', text: 'hello' }]);
  });
  it('an invalid or repeated submacro name is kept in a comment', () => {
    const { def } = convertAccessMacro([{ ...row('Beep'), macroName: 'A' }, { ...row('Beep'), macroName: 'a' }]);
    expect(validateMacro(def)).toEqual([]);
    expect(def.items[1]).toMatchObject({ k: 'submacro', name: 'Sub2', items: [{ k: 'comment', text: 'Submacro: a' }, { k: 'action' }] });
  });
});

describe('arguments', () => {
  it('OpenForm with a filter name (no place for it) is a comment item', () => {
    const { def, notes } = convertAccessMacro([row('OpenForm', 'F', '0', 'SomeQuery', '', '', '0')]);
    expect(def.items).toEqual([{ k: 'comment', text: 'OpenForm: F; 0; SomeQuery; ; ; 0' }]);
    expect(notes).toEqual([{ code: 'actionComment', part: 'OpenForm' }]);
  });
  it('an enumeration value not in the table, an unknown action and a bad expression are comments', () => {
    const { def, notes } = convertAccessMacro([row('OpenQuery', 'Q', '3'), row('Frobnicate', 'x'), row('SetTempVar', 'V', '[a] >>> ('), row('RunCode', 'Not a call')]);
    expect(def.items.every((i) => i.k === 'comment')).toBe(true);
    expect(notes.map((n) => (n as { part: string }).part)).toEqual(['OpenQuery', 'Frobnicate', 'SetTempVar', 'RunCode']);
  });
  it('expressions are converted to the canonical form', () => {
    const { def } = convertAccessMacro([row('SetTempVar', 'V', '=1 + 2'), row('MsgBox', '="a"', 'Yes', '0', 'T'), row('OpenReport', 'R', '2', '', '[ID]=3', '0')]);
    expect(def.items).toEqual([
      { k: 'action', action: 'SetTempVar', args: { Name: 'V', Expression: '1 + 2' } },
      { k: 'action', action: 'MessageBox', args: { Message: '="a"', Beep: 'yes', Type: 'none', Title: 'T' } },
      { k: 'action', action: 'OpenReport', args: { ReportName: 'R', View: 'preview', WhereCondition: '[ID] = 3' } }]);
  });
  it('RunCode keeps a call parsePythonCall reads', () => {
    expect(convertAccessMacro([row('RunCode', 'Compute(1)')]).def.items).toEqual([{ k: 'action', action: 'RunCode', args: { FunctionName: 'Compute(1)' } }]);
  });
});

describe('Access members written with a dot', () => {
  const handler = [row('OnError', '0'), { ...row('MsgBox', '=[MacroError].[Description]', '-1', '0'), condition: '[MacroError]<>0' }];
  it('the wizard error handler reads MacroError with a bang', () => {
    const { def, notes } = convertAccessMacro(handler);
    expect(def.items).toEqual([{ k: 'action', action: 'OnError', args: { GoTo: 'next' } },
      { k: 'if', branches: [{ cond: '[MacroError]![Number] <> 0', items: [{ k: 'action', action: 'MessageBox', args: { Beep: 'yes', Message: '=[MacroError]![Description]', Type: 'none' } }] }] }]);
    expect(notes).toEqual([]);
  });
  it('bare MacroError is its Number; TempVars and LocalVars members; a string literal stays', () => {
    const e = (s: string) => (convertAccessMacro([row('SetTempVar', 'V', s)]).def.items[0] as unknown as { args: { Expression: string } }).args.Expression;
    expect(e('[MacroError]+1')).toBe('[MacroError]![Number] + 1');
    expect(e('[TempVars].[x]&TempVars!y&LocalVars.z')).toBe('[TempVars]![x] & [TempVars]![y] & [LocalVars]![z]');
    expect(e('"[MacroError].[X]"&[MacroError].[Number]')).toBe('"[MacroError].[X]" & [MacroError]![Number]');
  });
});

describe('the Command Button Wizard delete-record macro', () => {
  const when = (condition: string, r: AccessMacroRow): AccessMacroRow => ({ ...r, condition });
  const wizard = [row('OnError', '0'), row('GoToControl', '=[Screen].[PreviousControl].[Name]'), row('ClearMacroError'),
    when('Not [Form].[NewRecord]', row('RunCommand', '223')), when('[Form].[NewRecord] And Not [Form].[Dirty]', row('Beep')),
    when('[Form].[NewRecord] And [Form].[Dirty]', row('RunCommand', '292')), when('[MacroError]<>0', row('MsgBox', '=[MacroError].[Description]', '-1', '0'))];
  const act = (action: string, args = {}) => ({ k: 'action', action, args });
  it('converts to seven items with no comment and no note', () => {
    const { def, notes } = convertAccessMacro(wizard);
    expect(notes).toEqual([]);
    expect(def.items).toEqual([act('OnError', { GoTo: 'next' }), act('GoToControl', { ControlName: '=[Screen]![PreviousControl]![Name]' }), act('ClearMacroError'),
      { k: 'if', branches: [{ cond: 'Not [Form]![NewRecord]', items: [act('DeleteRecord')] }] },
      { k: 'if', branches: [{ cond: '[Form]![NewRecord] And Not [Form]![Dirty]', items: [act('Beep')] }] },
      { k: 'if', branches: [{ cond: '[Form]![NewRecord] And [Form]![Dirty]', items: [act('UndoRecord')] }] },
      { k: 'if', branches: [{ cond: '[MacroError]![Number] <> 0', items: [act('MessageBox', { Beep: 'yes', Message: '=[MacroError]![Description]', Type: 'none' })] }] }]);
    expect(validateMacro(def)).toEqual([]);
  });
  it('ActiveControl, and a string literal holding a member stays', () => {
    const e = (s: string) => (convertAccessMacro([row('SetTempVar', 'V', s)]).def.items[0] as unknown as { args: { Expression: string } }).args.Expression;
    expect(e('Screen.ActiveControl.Name')).toBe('[Screen]![ActiveControl]![Name]');
    expect(e('"[Form].[Dirty]"&[Form].[Dirty]')).toBe('"[Form].[Dirty]" & [Form]![Dirty]');
  });
  it('exact spellings whatever the case; Form.Dirty without brackets', () => {
    const e = (s: string) => (convertAccessMacro([row('SetTempVar', 'V', s)]).def.items[0] as unknown as { args: { Expression: string } }).args.Expression;
    expect(e('[Screen].[ACTIVECONTROL].[Name]')).toBe('[Screen]![ActiveControl]![Name]');
    expect(e('[SCREEN].[previouscontrol].[NAME]')).toBe('[Screen]![PreviousControl]![Name]');
    expect(e('Form.Dirty')).toBe('[Form]![Dirty]');
  });
  it('a three-part [Form] chain and [Sub Form].[X] stay unconverted (comment item, actionComment note)', () => {
    for (const x of ['[Form].[Ctl].[Value]', '[Sub Form].[X]']) {
      const { def, notes } = convertAccessMacro([row('SetTempVar', 'V', x)]);
      expect(def.items.map((i) => i.k)).toEqual(['comment']);
      expect(notes).toEqual([{ code: 'actionComment', part: 'SetTempVar' }]);
    }
  });
  it('only the members the engine reads: another [Form] / [Screen] member makes a comment item + note', () => {
    for (const r of [{ ...row('Beep'), condition: '[Form].[Nom] Is Null' }, row('SetTempVar', 'V', '[Form].[Name]'), row('SetTempVar', 'V', '[Screen].[ActiveControl].[Tag]'), row('SetTempVar', 'V', '[Screen].[Foo]')]) {
      const { def, notes } = convertAccessMacro([r]);
      expect(def.items.map((i) => i.k)).toEqual(['comment']);
      expect(notes.length).toBe(1);
    }
  });
  it('the Combo Box Wizard find-a-record row converts, with [Screen]![ActiveControl] in the expression', () => {
    const { def, notes } = convertAccessMacro([row('SearchForRecord', '-1', '', '2', '="[Id] = " & Str(Nz([Screen].[ActiveControl],0))')]);
    expect(notes).toEqual([]);
    expect(def.items).toEqual([{ k: 'action', action: 'SearchForRecord', args: { Record: 'first', WhereCondition: '="[Id] = " & Str(Nz([Screen]![ActiveControl], 0))' } }]);
    expect(validateMacro(def)).toEqual([]);
    const o = convertAccessMacro([row('SearchForRecord', '2', 'F', '1', '[Id] = 1')]).def.items[0] as unknown as { args: Record<string, string> };
    expect(o.args).toMatchObject({ ObjectType: 'form', ObjectName: 'F', Record: 'next', WhereCondition: '[Id] = 1' });
  });
  it('[Screen].[ActiveControl] in a where argument is still not converted; [Screen].[PreviousControl] alone neither', () => {
    for (const r of [row('ApplyFilter', '', '[Id]=[Screen].[ActiveControl]'), row('OpenForm', 'F', '0', '', '[Id]=[Screen].[ActiveControl]'), row('SetTempVar', 'V', '[Screen].[PreviousControl]')]) {
      const { def, notes } = convertAccessMacro([r]);
      expect(def.items.map((i) => i.k)).toEqual(['comment']);
      expect(notes).toEqual([{ code: 'actionComment', part: r.action }]);
    }
  });
  it('a where argument holding a Form or Screen member is not converted; SetValue Item on Form or Screen neither', () => {
    for (const r of [row('ApplyFilter', '', '[Form].[X]=1'), row('OpenForm', 'F', '0', '', '[Screen].[ActiveControl].[Name]="a"'), row('SetValue', '[Form].[Dirty]', '0'), row('SetValue', '[Screen].[ActiveControl].[Name]', '0')]) {
      const { def, notes } = convertAccessMacro([r]);
      expect(def.items.map((i) => i.k)).toEqual(['comment']);
      expect(notes).toEqual([{ code: 'actionComment', part: r.action }]);
    }
    expect(convertAccessMacro([row('ApplyFilter', '', '[X]=1')]).def.items.map((i) => i.k)).toEqual(['action']);
  });
});

describe('object references', () => {
  const def: MacroDef = { formatVersion: '1.0', items: [
    { k: 'action', action: 'OpenForm', args: { FormName: 'F1' } },
    { k: 'submacro', name: 'S', items: [{ k: 'if', branches: [{ cond: '1', items: [{ k: 'action', action: 'RunMacro', args: { MacroName: 'M.Sub' } }] }] }] },
    { k: 'action', action: 'OnError', args: { GoTo: 'macroName', MacroName: 'H' } },
    { k: 'action', action: 'OpenQuery', args: { QueryName: '=x' } }] };
  it('renames an OpenForm target and a RunMacro target (M.Sub keeps .Sub), leaving the input alone', () => {
    const out = renameMacroRefs(def, (kind, name) => (kind === 'form' ? 'G' : kind === 'macro' && name === 'M' ? 'N' : undefined));
    expect(JSON.stringify(out)).toContain('"FormName":"G"');
    expect(JSON.stringify(out)).toContain('"MacroName":"N.Sub"');
    expect(JSON.stringify(out)).toContain('"MacroName":"H"');
    expect(JSON.stringify(def)).toContain('"FormName":"F1"');
  });
});

describe('the Command Button Wizard duplicate-record macro', () => {
  const when = (condition: string, r: AccessMacroRow): AccessMacroRow => ({ ...r, condition });
  const ok = '[MacroError]=0';
  const wizard = [row('OnError', '0'), row('RunCommand', '50'), when(ok, row('RunCommand', '190')), when(ok, row('RunCommand', '28')), when(ok, row('RunCommand', '50')),
    when(ok, row('RunCommand', '191')), when('[MacroError]<>0', row('MsgBox', '=[MacroError].[Description]', '-1', '0'))];
  const act = (action: string, args = {}) => ({ k: 'action', action, args });
  it('converts with no comment and no note', () => {
    const { def, notes } = convertAccessMacro(wizard);
    expect(notes).toEqual([]);
    const run = (Command: string) => act('RunMenuCommand', { Command });
    const guard = (...items: unknown[]) => ({ k: 'if', branches: [{ cond: '[MacroError]![Number] = 0', items }] });
    expect(def.items).toEqual([act('OnError', { GoTo: 'next' }), run('selectRecord'), guard(run('copy')), guard(act('GoToRecord', { Record: 'new' })), guard(run('selectRecord')), guard(run('paste')),
      { k: 'if', branches: [{ cond: '[MacroError]![Number] <> 0', items: [act('MessageBox', { Beep: 'yes', Message: '=[MacroError]![Description]', Type: 'none' })] }] }]);
    expect(validateMacro(def)).toEqual([]);
  });
});

describe('every entry of the mapping table', () => {
  // [row as Access writes it (action|arguments), expected BaseCraft action, expected arguments]
  const RAW: [string, string, Record<string, string>][] = [
    ['Beep', 'Beep', {}], ['CancelEvent', 'CancelEvent', {}], ['ClearMacroError', 'ClearMacroError', {}], ['CloseDatabase', 'CloseDatabase', {}],
    ['DeleteRecord', 'DeleteRecord', {}], ['RefreshRecord', 'RefreshRecord', {}], ['RemoveAllTempVars', 'RemoveAllTempVars', {}], ['SaveRecord', 'SaveRecord', {}],
    ['ShowAllRecords', 'ShowAllRecords', {}], ['StopAllMacros', 'StopAllMacros', {}], ['StopMacro', 'StopMacro', {}], ['UndoRecord', 'UndoRecord', {}],
    ['Close|2|F|0', 'CloseWindow', { ObjectType: 'form', ObjectName: 'F' }], ['CloseWindow|-1||0', 'CloseWindow', {}],
    ['FindRecord|x|1|0|2|0|-1|-1', 'FindRecord', { FindWhat: 'x', Match: 'whole', MatchCase: 'no', Search: 'all', OnlyCurrentField: 'yes', FindFirst: 'yes' }],
    ['GoToControl|C', 'GoToControl', { ControlName: 'C' }], ['GoToRecord|-1||5|', 'GoToRecord', { Record: 'new' }],
    ['MsgBox|Hi|Yes|0|T', 'MessageBox', { Message: 'Hi', Beep: 'yes', Type: 'none', Title: 'T' }], ['MessageBox|Hi|-1|0|', 'MessageBox', { Message: 'Hi', Beep: 'yes', Type: 'none' }],
    ['OnError|1|H', 'OnError', { GoTo: 'macroName', MacroName: 'H' }],
    ['OpenForm|F|0||[A]=1|-1|0', 'OpenForm', { FormName: 'F', View: 'form', WhereCondition: '[A] = 1', WindowMode: 'normal' }],
    ['OpenQuery|Q|0|2', 'OpenQuery', { QueryName: 'Q', View: 'datasheet', DataMode: 'readOnly' }], ['OpenReport|R|2|||0', 'OpenReport', { ReportName: 'R', View: 'preview' }],
    ['OpenTable|T|1|', 'OpenTable', { TableName: 'T', View: 'design' }], ['Quit|1', 'Quit', {}], ['RemoveTempVar|V', 'RemoveTempVar', { Name: 'V' }],
    ['Requery|C', 'Requery', { ControlName: 'C' }], ['RunCode|Compute()', 'RunCode', { FunctionName: 'Compute()' }],
    ['RunMacro|M.S|2|', 'RunMacro', { MacroName: 'M.S', RepeatCount: '2' }], ['RunSQL|DELETE FROM T|-1', 'RunSQL', { SQLStatement: 'DELETE FROM T' }],
    ['SetLocalVar|V|1', 'SetLocalVar', { Name: 'V', Expression: '1' }], ['SetProperty|C|1|No', 'SetProperty', { ControlName: 'C', Property: 'visible', Value: 'No' }],
    ['SetTempVar|V|=1', 'SetTempVar', { Name: 'V', Expression: '1' }], ['SetValue|[A]|=2', 'SetValue', { Item: '[A]', Expression: '2' }],
    ['OutputTo|0|T|ExcelWorkbook(*.xlsx)|C:/a.xlsx|0|||0', 'ExportWithFormatting', { ObjectType: 'table', ObjectName: 'T', OutputFormat: 'excel', OutputFile: 'C:/a.xlsx' }],
    ['ExportWithFormatting|1|Q|ExcelWorkbook(*.xlsx)|C:/a.xlsx', 'ExportWithFormatting', { ObjectType: 'query', ObjectName: 'Q', OutputFormat: 'excel', OutputFile: 'C:/a.xlsx' }],
    ['SendObject|3|R|PDFFormat(*.pdf)|a@example.com|b@example.com|c@example.com|S|T|-1|', 'EMailDatabaseObject', { ObjectType: 'report', ObjectName: 'R', OutputFormat: 'pdf', To: 'a@example.com', Cc: 'b@example.com', Bcc: 'c@example.com', Subject: 'S', MessageText: 'T' }],
    ['EMailDatabaseObject|3|R|PDFFormat(*.pdf)|a@example.com', 'EMailDatabaseObject', { ObjectType: 'report', ObjectName: 'R', OutputFormat: 'pdf', To: 'a@example.com' }],
    ['SearchForRecord|-1||2|[Id] = 1', 'SearchForRecord', { Record: 'first', WhereCondition: '[Id] = 1' }],
    ['SetWarnings|No', 'SetWarnings', { WarningsOn: 'no' }], ['ApplyFilter||[A]=1|', 'ApplyFilter', { WhereCondition: '[A] = 1' }],
  ];
  it('has a row for each entry', () => { expect(RAW.map((t) => t[0].split('|')[0]).sort()).toEqual([...ACCESS_ACTION_NAMES].sort()); });
  it.each(RAW)('%s converts to the expected action and arguments', (r, action, args) => {
    const [name, ...a] = r.split('|');
    const { def, notes } = convertAccessMacro([row(name, ...a)]);
    expect(def.items).toEqual([{ k: 'action', action, args }]);
    expect(notes).toEqual([]);
    expect(validateMacro(def)).toEqual([]);
  });
  it.each([['97', 'SaveRecord'], ['292', 'UndoRecord'], ['223', 'DeleteRecord'], ['50', 'RunMenuCommand'], ['190', 'RunMenuCommand'], ['191', 'RunMenuCommand'], ['340', 'RunMenuCommand'], ['28', 'GoToRecord'], ['58', 'CloseWindow'], ['186', 'CloseWindow']])(
    'RunCommand %s', (n, action) => { expect(convertAccessMacro([row('RunCommand', n)]).def.items).toMatchObject([{ k: 'action', action }]); });
  it.each([['340', 'print'], ['590', 'printSelection']])('RunCommand %s is RunMenuCommand %s, without a note', (n, c) => {
    expect(convertAccessMacro([row('RunCommand', n)])).toMatchObject({ def: { items: [{ k: 'action', action: 'RunMenuCommand', args: { Command: c } }] }, notes: [] });
  });
  it.each(['18', '4'])('RunCommand %s is a comment', (n) => {
    const { def, notes } = convertAccessMacro([row('RunCommand', n)]);
    expect(def.items).toEqual([{ k: 'comment', text: `RunCommand: ${n}` }]);
    expect(notes).toEqual([{ code: 'actionComment', part: 'RunCommand' }]);
  });
});

const one = (...r: string[]) => convertAccessMacro([row(r[0], ...r.slice(1))]);

describe('review: whole-macro fallback', () => {
  it('every row becomes a comment item and one notConverted note', () => {
    const { def, notes } = commentMacro([row('OpenForm', 'F', '0'), { args: [], comment: 'c' }, { args: [], comment: '_AXL:<x/>' }, row('Beep')]);
    expect(def.items).toEqual([{ k: 'comment', text: 'OpenForm: F; 0' }, { k: 'comment', text: 'c' }, { k: 'comment', text: 'Beep' }]);
    expect(notes).toEqual([{ code: 'notConverted' }]);
    expect(validateMacro(def)).toEqual([]);
  });
});

describe('review: an empty enumeration argument holds Access\'s default, emitted explicitly', () => {
  it('SetWarnings, OnError, MsgBox, OpenForm, GoToRecord, FindRecord', () => {
    expect(one('SetWarnings').def.items).toEqual([{ k: 'action', action: 'SetWarnings', args: { WarningsOn: 'no' } }]);
    expect(one('OnError').def.items).toEqual([{ k: 'action', action: 'OnError', args: { GoTo: 'next' } }]);
    expect(one('MsgBox', 'Hi').def.items).toEqual([{ k: 'action', action: 'MessageBox', args: { Message: 'Hi', Beep: 'yes', Type: 'none' } }]);
    expect(one('OpenForm', 'F').def.items).toEqual([{ k: 'action', action: 'OpenForm', args: { FormName: 'F', View: 'form', WindowMode: 'normal' } }]);
    expect(one('GoToRecord').def.items).toEqual([{ k: 'action', action: 'GoToRecord', args: { Record: 'next' } }]);
    expect(one('FindRecord', 'x').def.items).toEqual([{ k: 'action', action: 'FindRecord',
      args: { FindWhat: 'x', Match: 'whole', MatchCase: 'no', Search: 'all', OnlyCurrentField: 'yes', FindFirst: 'yes' } }]);
  });
  it('without a stated Access default (OpenReport View, SetProperty Property) it is a comment item', () => {
    expect(one('OpenReport', 'R').def.items).toEqual([{ k: 'comment', text: 'OpenReport: R' }]);
    expect(one('OpenReport', 'R', '', '', '[A]=1', '0').notes).toEqual([{ code: 'actionComment', part: 'OpenReport' }]);
    expect(one('SetProperty', 'C', '', 'x').def.items.map((i) => i.k)).toEqual(['comment']);
  });
});

describe('review: argument forms measured on real Access macro text', () => {
  it('Yes/No written -1 and 0', () => {
    expect(one('SetWarnings', '-1').def.items).toEqual([{ k: 'action', action: 'SetWarnings', args: { WarningsOn: 'yes' } }]);
    expect(one('SetWarnings', '0').def.items).toEqual([{ k: 'action', action: 'SetWarnings', args: { WarningsOn: 'no' } }]);
  });
  it('GoToRecord with three arguments, MsgBox with three, record 5 is new', () => {
    expect(one('GoToRecord', '-1', '', '5').def.items).toEqual([{ k: 'action', action: 'GoToRecord', args: { Record: 'new' } }]);
    expect(one('MsgBox', 'Hi', '-1', '0').def.items).toEqual([{ k: 'action', action: 'MessageBox', args: { Message: 'Hi', Beep: 'yes', Type: 'none' } }]);
  });
  it('OpenForm data mode -1 is none, 1 is edit', () => {
    expect(one('OpenForm', 'F', '0', '', '', '-1', '0').def.items).toEqual([{ k: 'action', action: 'OpenForm', args: { FormName: 'F', View: 'form', WindowMode: 'normal' } }]);
    expect(one('OpenForm', 'F', '0', '', '', '1', '0').def.items).toEqual([{ k: 'action', action: 'OpenForm', args: { FormName: 'F', View: 'form', DataMode: 'edit', WindowMode: 'normal' } }]);
  });
  it('OpenQuery/OpenTable data mode: 1 or empty no note, 2 is readOnly, 0 is mapped with argumentDropped', () => {
    expect(one('OpenQuery', 'Q', '0', '1').notes).toEqual([]);
    expect(one('OpenTable', 'T', '0').notes).toEqual([]);
    const q = one('OpenQuery', 'Q', '0', '2'), t = one('OpenTable', 'T', '0', '0');
    expect(one('OpenTable', 'T', '0', '2').def.items).toEqual([{ k: 'action', action: 'OpenTable', args: { TableName: 'T', View: 'datasheet', DataMode: 'readOnly' } }]);
    expect(q.def.items).toEqual([{ k: 'action', action: 'OpenQuery', args: { QueryName: 'Q', View: 'datasheet', DataMode: 'readOnly' } }]);
    expect(q.notes).toEqual([]);
    expect(t.def.items).toEqual([{ k: 'action', action: 'OpenTable', args: { TableName: 'T', View: 'datasheet' } }]);
    expect(t.notes).toEqual([{ code: 'argumentDropped', part: 'OpenTable.DataMode' }]);
  });
  it('SendObject of a report as a PDF: EMailDatabaseObject with the five fields; Edit Message No and a template are noted; any other object or format is a comment', () => {
    const send = (...r: string[]) => one('SendObject', ...r);
    const ok = send('3', 'Factures', 'PDFFormat(*.pdf)', 'a@example.com; b@example.com', '', '', 'Mensuel', '="Bonjour" & " " & "Cordialement"', '-1', '');
    expect(ok.def.items).toEqual([{ k: 'action', action: 'EMailDatabaseObject', args: { ObjectType: 'report', ObjectName: 'Factures', OutputFormat: 'pdf', To: 'a@example.com; b@example.com',
      Subject: 'Mensuel', MessageText: '="Bonjour" & " " & "Cordialement"' } }]);
    expect(ok.notes).toEqual([]);
    expect(validateMacro(ok.def)).toEqual([]);
    expect(send('3', 'R', 'pdf format (*.PDF)', 'a@example.com', '', '', '', '', '0', '').notes).toEqual([{ code: 'argumentDropped', part: 'SendObject.EditMessage' }]);
    expect(send('3', 'R', 'PDFFormat(*.pdf)', 'a@example.com', '', '', '', '', '', 'tpl.rtf').notes).toEqual([{ code: 'argumentDropped', part: 'SendObject.TemplateFile' }]);
    const comment = (r: ReturnType<typeof send>) => r.def.items.map((i) => i.k);
    expect(comment(send('0', 'T', 'PDFFormat(*.pdf)', 'a@example.com'))).toEqual(['comment']);
    expect(comment(send('3', 'R', 'ExcelWorkbook(*.xlsx)', 'a@example.com'))).toEqual(['comment']);
    expect(comment(send('-1', '', '', 'a@example.com'))).toEqual(['comment']);
    expect(comment(send('3', 'R', '', 'a@example.com'))).toEqual(['comment']);
  });
  it('OutputTo of an Excel workbook: the measured row converts to ExportWithFormatting; the others are comments or noted', () => {
    const out = (...r: string[]) => one('OutputTo', ...r);
    const ok = out('1', 'QVentes', 'ExcelWorkbook(*.xlsx)', 'C:/out/Ventes.xlsx', '0', '', '', '0');
    expect(ok.def.items).toEqual([{ k: 'action', action: 'ExportWithFormatting', args: { ObjectType: 'query', ObjectName: 'QVentes', OutputFormat: 'excel', OutputFile: 'C:/out/Ventes.xlsx' } }]);
    expect(ok.notes).toEqual([]);
    expect(out('0', 'T', 'Excel Workbook (*.XLSX)', 'C:/a.XLSX').def.items).toMatchObject([{ k: 'action', action: 'ExportWithFormatting', args: { ObjectType: 'table' } }]);
    expect(out('1', 'Q', 'ExcelWorkbook(*.xlsx)', 'C:/a.xlsx', '-1', '', '', '0').notes).toEqual([{ code: 'argumentDropped', part: 'OutputTo.AutoStart' }]);
    expect(out('1', 'Q', 'ExcelWorkbook(*.xlsx)', '', '0').def.items).toMatchObject([{ k: 'action', action: 'ExportWithFormatting', args: { ObjectName: 'Q' } }]);   // no file: the save dialog
    const comment = (r: ReturnType<typeof out>) => r.def.items.map((i) => i.k);
    expect(comment(out('1', 'Q', 'PDFFormat(*.pdf)', 'C:/a.pdf', '0'))).toEqual(['comment']);
    expect(comment(out('3', 'Q', 'ExcelWorkbook(*.xlsx)', 'C:/a.xlsx', '0'))).toEqual(['comment']);
    expect(comment(out('1', 'Q', 'ExcelWorkbook(*.xlsx)', 'C:/a.txt', '0'))).toEqual(['comment']);
    expect(comment(out('1', 'Q', 'ExcelWorkbook(*.xlsx)', 'C:/a.xlsx', '0', 'tpl.xlsx'))).toEqual(['comment']);
    expect(comment(out('1', 'Q', 'ExcelWorkbook(*.xlsx)', 'C:/a.xlsx', '0', '', '65001'))).toEqual(['comment']);
  });
  it('SetLocalVar with False / True', () => {
    expect(one('SetLocalVar', 'V', 'False').def.items).toMatchObject([{ k: 'action', action: 'SetLocalVar', args: { Name: 'V' } }]);
    expect(one('SetLocalVar', 'V', 'True').notes).toEqual([]);
  });
});

describe('review: minor', () => {
  it('parse: null without row and header, [] for a header alone', () => {
    expect(parseAccessMacro('')).toBeNull();
    expect(parseAccessMacro('Version =196611\nColumnsShown =8\n')).toEqual([]);
  });
  it('a first row whose condition is "..." is a comment item', () => {
    const { def } = convertAccessMacro([{ ...row('Beep'), condition: '...' }]);
    expect(def.items).toEqual([{ k: 'comment', text: 'Beep' }]);
  });
  it('a renamed submacro name loops until free', () => {
    const { def } = convertAccessMacro([{ ...row('Beep'), macroName: 'Sub2' }, { ...row('Beep'), macroName: 'Bad.Name' }, { ...row('Beep'), macroName: 'Sub3' }]);
    expect(validateMacro(def)).toEqual([]);
    expect(def.items.map((i) => (i.k === 'submacro' ? i.name : ''))).toEqual(['Sub2', 'Sub4', 'Sub3']);
  });
  it('no trailing space in a comment item without argument', () => {
    expect(one('Frobnicate').def.items).toEqual([{ k: 'comment', text: 'Frobnicate' }]);
  });
});
