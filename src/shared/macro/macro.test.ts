import { describe, it, expect } from 'vitest';
import fr from '../i18n/fr.json';
import en from '../i18n/en.json';
import { validateMacro, parseMacroDef, submacroNames, emptyMacro, type MacroDef, type MacroItem } from './model';
import { ACTIONS, actionDef } from './catalog';

const get = (o: any, k: string) => k.split('.').reduce((a, p) => a[p], o);

const ok: MacroDef = { formatVersion: '1.0', items: [
  { k: 'action', action: 'OpenForm', args: { FormName: 'FClients', WhereCondition: '[Ville] = "Lyon"' } },
  { k: 'if', branches: [{ cond: '[TempVars]![n] > 0', items: [] }], else: [] },
  { k: 'submacro', name: 'Fermer', items: [{ k: 'action', action: 'CloseWindow', args: {} }] }] };

describe('macro definition', () => {
  it('a valid macro', () => expect(validateMacro(ok)).toEqual([]));
  it('unknown action, argument and keys are kept', () => {
    const d = { ...ok, extra: 1, items: [{ k: 'action', action: 'ImportXML', args: { Path: 'x' }, note: 'n' }] };   // Review Focus 5
    expect(validateMacro(d)).toEqual([]); expect(parseMacroDef(d)).toEqual(d); });
  it('structure issues', () => {
    expect(validateMacro({ ...ok, items: [{ k: 'group', name: 'G', items: [ok.items[2]] }] })).toContainEqual({ path: 'items[0].items[0]', code: 'submacroPlace' });
    expect(validateMacro({ ...ok, items: [ok.items[2], ok.items[0]] })).toContainEqual({ path: 'items[1]', code: 'submacroOrder' });
    expect(validateMacro({ ...ok, items: [{ k: 'if', branches: [{ cond: ' ', items: [] }] }] })).toContainEqual({ path: 'items[0].branches[0].cond', code: 'emptyCondition' });
    expect(validateMacro({ ...ok, items: [{ k: 'action', action: 'MessageBox', args: { Message: '=1 +' } }] })).toContainEqual({ path: 'items[0].args.Message', code: 'badExpression' });
    const deep = Array.from({ length: 33 }).reduce<MacroItem>((inner) => ({ k: 'group', name: '', items: [inner] }), { k: 'comment', text: '' });
    expect(validateMacro({ formatVersion: '1.0', items: [deep] }).map((i) => i.code)).toContain('tooDeep');
    expect(() => parseMacroDef({ formatVersion: '2.0', items: [] })).toThrow('bc:invalidDefinition'); });

  // beyond the brief's fixtures: the other codes, the boundaries and the helpers
  it('shape issues', () => {
    for (const d of [null, 'x', [], {}, { formatVersion: '1.0' }, { formatVersion: 1, items: [] }, { formatVersion: '1.0', items: {} }])
      expect(validateMacro(d).map((i) => i.code)).toEqual(['shape']);
    const shape = (item: unknown) => validateMacro({ formatVersion: '1.0', items: [item] }).map((i) => i.code);
    expect(shape(null)).toEqual(['shape']);
    expect(shape({ k: 'nope' })).toEqual(['shape']);
    expect(shape({ k: 'action', action: 3, args: {} })).toEqual(['shape']);
    expect(shape({ k: 'action', action: 'Beep', args: { A: 1 } })).toEqual(['shape']);
    expect(shape({ k: 'action', action: 'Beep' })).toEqual(['shape']);
    expect(shape({ k: 'comment', text: 1 })).toEqual(['shape']);
    expect(shape({ k: 'group', name: 'G', items: 'x' })).toEqual(['shape']);
    expect(shape({ k: 'if', branches: [], items: [] })).toEqual(['shape']);
    expect(shape({ k: 'if', branches: [{ cond: 1, items: [] }] })).toEqual(['shape']);
    expect(shape({ k: 'if', branches: [{ cond: '1 = 1', items: [] }], else: 'x' })).toEqual(['shape']);
    expect(() => parseMacroDef(null)).toThrow('bc:invalidDefinition'); });
  it('names: submacros are object names, groups are free text', () => {
    const sub = (name: string): MacroItem => ({ k: 'submacro', name, items: [] });
    expect(validateMacro({ formatVersion: '1.0', items: [sub('A'), sub('a')] })).toEqual([{ path: 'items[1].name', code: 'duplicateName' }]);
    expect(validateMacro({ formatVersion: '1.0', items: [sub('Café'), sub('CAFÉ')] })).toEqual([{ path: 'items[1].name', code: 'duplicateName' }]);   // case and NFD ignored
    expect(validateMacro({ formatVersion: '1.0', items: Array.from({ length: 5000 }, (_, i) => sub(`S${i}`)) })).toEqual([]);
    expect(validateMacro({ formatVersion: '1.0', items: [sub('A.B')] })).toEqual([{ path: 'items[0].name', code: 'badName' }]);
    expect(validateMacro({ formatVersion: '1.0', items: [sub('')] })).toEqual([{ path: 'items[0].name', code: 'badName' }]);
    expect(validateMacro({ formatVersion: '1.0', items: [{ k: 'group', name: 'a.b', items: [] }] })).toEqual([]);   // free text: not an object name
    expect(validateMacro({ formatVersion: '1.0', items: [{ k: 'group', name: '', items: [] }] })).toEqual([]); });
  it('expressions: conditions, expression and where arguments, "=" text and number', () => {
    const args = (action: string, a: Record<string, string>) => validateMacro({ formatVersion: '1.0', items: [{ k: 'action', action, args: a }] });
    expect(args('SetTempVar', { Name: 'n', Expression: '1 +' })).toEqual([{ path: 'items[0].args.Expression', code: 'badExpression' }]);
    expect(args('SetTempVar', { Name: 'n', Expression: '1 + 1' })).toEqual([]);
    expect(args('OpenForm', { FormName: 'F', WhereCondition: '[a] =' })).toEqual([{ path: 'items[0].args.WhereCondition', code: 'badExpression' }]);
    expect(args('OpenForm', { FormName: 'F', WhereCondition: '' })).toEqual([]);
    expect(args('RunMacro', { MacroName: 'M', RepeatCount: '=2 *' })).toEqual([{ path: 'items[0].args.RepeatCount', code: 'badExpression' }]);
    expect(args('RunMacro', { MacroName: 'M', RepeatCount: '3' })).toEqual([]);
    expect(args('MessageBox', { Message: 'a + (b' })).toEqual([]);   // a literal text is not parsed
    expect(args('RunSQL', { SQLStatement: 'not (' })).toEqual([]);    // SQL is the interpreter's business
    expect(validateMacro({ formatVersion: '1.0', items: [{ k: 'if', branches: [{ cond: '[a] >', items: [] }] }] })).toEqual([{ path: 'items[0].branches[0].cond', code: 'badExpression' }]); });
  it('paths into branches, else and groups', () => {
    const bad: MacroItem = { k: 'action', action: 'MessageBox', args: { Message: '=1 +' } };
    const codes = validateMacro({ formatVersion: '1.0', items: [
      { k: 'if', branches: [{ cond: '1 = 1', items: [] }, { cond: '1 = 2', items: [bad] }], else: [bad] },
      { k: 'group', name: 'G', items: [bad] }] });
    expect(codes.map((i) => i.path)).toEqual(['items[0].branches[1].items[0].args.Message', 'items[0].else[0].args.Message', 'items[1].items[0].args.Message']); });
  it('limits: 32 levels of blocks are allowed, 10,000 items are allowed', () => {
    const nest = (n: number) => Array.from({ length: n }).reduce<MacroItem>((inner) => ({ k: 'group', name: '', items: [inner] }), { k: 'comment', text: '' });
    expect(validateMacro({ formatVersion: '1.0', items: [nest(32)] })).toEqual([]);
    const comments = (n: number): MacroItem[] => Array.from({ length: n }, () => ({ k: 'comment', text: '' }));
    expect(validateMacro({ formatVersion: '1.0', items: comments(10_000) })).toEqual([]);
    expect(validateMacro({ formatVersion: '1.0', items: comments(10_001) }).map((i) => i.code)).toEqual(['tooMany']);
    expect(validateMacro({ formatVersion: '1.0', items: [{ k: 'group', name: '', items: comments(10_000) }] }).map((i) => i.code)).toEqual(['tooMany']); });
  it('helpers', () => {
    expect(submacroNames(ok)).toEqual(['Fermer']);
    expect(submacroNames({ formatVersion: '1.0', items: [{ k: 'submacro', name: 'B', items: [] }, { k: 'submacro', name: 'A', items: [] }] })).toEqual(['B', 'A']);
    expect(emptyMacro()).toEqual({ formatVersion: '1.0', items: [] });
    expect(validateMacro(emptyMacro())).toEqual([]);
    expect(parseMacroDef(ok)).toBe(ok); });
});

describe('action catalogue', () => {
  it('catalogue: 33 actions, three unsafe, every label in both languages', () => {
    expect(ACTIONS).toHaveLength(33); expect(ACTIONS.filter((a) => a.unsafe).map((a) => a.name)).toEqual(['RunSQL', 'SetValue', 'SetWarnings']);
    for (const a of ACTIONS) for (const cat of [fr, en]) { expect(get(cat, `macro.action.${a.name}`)).toBeTruthy();
      for (const g of a.args) { expect(get(cat, `macro.arg.${g.name}`)).toBeTruthy(); for (const o of g.options ?? []) expect(get(cat, `macro.argValue.${g.name}.${o || 'empty'}`)).toBeTruthy(); } }
    expect(fr.macro.action.OpenForm).toBe('OuvrirFormulaire'); expect(actionDef('OpenReport')?.args.find((x) => x.name === 'View')?.default).toBe('preview');
    expect(fr.macro.action.FindRecord).toBe('RechercherEnregistrement');
    expect(actionDef('GoToRecord')?.args.find((a) => a.name === 'Record')?.default).toBe('next'); });
  it('names are unique; every category, block and the unknown action have a label', () => {
    const names = ACTIONS.map((a) => a.name);
    expect(new Set(names).size).toBe(33);
    for (const cat of [fr, en]) {
      for (const c of new Set(ACTIONS.map((a) => a.category))) expect(get(cat, `macro.category.${c}`), c).toBeTruthy();
      for (const b of ['comment', 'group', 'if', 'elseIf', 'else', 'submacro']) expect(get(cat, `macro.block.${b}`), b).toBeTruthy();
      expect(get(cat, 'macro.unknownAction')).toContain('{{name}}'); }
    expect(actionDef('Nope')).toBeUndefined(); expect(actionDef('openform')).toBeUndefined(); });
  it('every default is one of the options, and an enum has options', () => {
    for (const a of ACTIONS) for (const g of a.args) {
      if (g.type === 'enum') expect(g.options?.length, `${a.name}.${g.name}`).toBeGreaterThan(0);
      if (g.options && g.default !== undefined) expect(g.options, `${a.name}.${g.name}`).toContain(g.default); } });
  it('arguments: required, order and defaults of the brief', () => {
    expect(actionDef('MessageBox')?.args.map((g) => g.name)).toEqual(['Message', 'Beep', 'Type', 'Title']);
    expect(actionDef('MessageBox')?.args[0]).toMatchObject({ type: 'text', required: true });
    expect(actionDef('OpenForm')?.args.map((g) => `${g.name}:${g.type}`)).toEqual(['FormName:formName', 'View:enum', 'WhereCondition:where', 'DataMode:enum', 'WindowMode:enum']);
    expect(actionDef('OpenForm')?.args.at(-1)).toMatchObject({ options: ['normal', 'dialog'], default: 'normal' });
    expect(actionDef('CloseWindow')?.args.find((g) => g.name === 'ObjectType')?.options).toEqual(['', 'table', 'query', 'form', 'report', 'macro']);
    expect(actionDef('SetWarnings')?.args[0]).toMatchObject({ options: ['yes', 'no'], default: 'no' });
    expect(actionDef('OnError')?.args.map((g) => g.name)).toEqual(['GoTo', 'MacroName']);
    for (const n of ['Beep', 'ClearMacroError', 'CloseDatabase', 'Quit', 'RemoveAllTempVars', 'StopAllMacros', 'StopMacro',
      'CancelEvent', 'DeleteRecord', 'RefreshRecord', 'SaveRecord', 'ShowAllRecords', 'UndoRecord']) expect(actionDef(n)?.args, n).toEqual([]); });
  it('the 13 form actions of B2: category, unsafe, arguments (name:type=default, * required)', () => {
    const sig = (n: string) => { const d = actionDef(n)!; return `${d.category}${d.unsafe ? '!' : ''} ${d.args.map((g) => `${g.name}:${g.type}${g.required ? '*' : ''}${g.default !== undefined ? `=${g.default}` : ''}`).join(' ')}`.trim(); };
    expect(sig('ApplyFilter')).toBe('filter WhereCondition:where*');
    expect(sig('CancelEvent')).toBe('macro');
    expect(sig('DeleteRecord')).toBe('dataEntry');
    expect(sig('FindRecord')).toBe('filter FindWhat:text* Match:enum=whole MatchCase:enum=no Search:enum=all OnlyCurrentField:enum=yes FindFirst:enum=yes');
    expect(sig('GoToControl')).toBe('objects ControlName:text*');
    expect(sig('GoToRecord')).toBe('objects ObjectType:objectType= ObjectName:objectName Record:enum=next Offset:number');
    expect(sig('RefreshRecord')).toBe('filter');
    expect(sig('Requery')).toBe('filter ControlName:text');
    expect(sig('SaveRecord')).toBe('dataEntry');
    expect(sig('SetProperty')).toBe('objects ControlName:text Property:enum=enabled Value:text');
    expect(sig('SetValue')).toBe('objects! Item:reference* Expression:expression*');
    expect(sig('ShowAllRecords')).toBe('filter');
    expect(sig('UndoRecord')).toBe('ui');
    const opts = (n: string, g: string) => actionDef(n)?.args.find((x) => x.name === g)?.options;
    expect(opts('GoToRecord', 'ObjectType')).toEqual(['', 'form']);
    expect(opts('GoToRecord', 'Record')).toEqual(['previous', 'next', 'first', 'last', 'goTo', 'new']);
    expect(opts('FindRecord', 'Match')).toEqual(['anywhere', 'whole', 'start']);
    expect(opts('FindRecord', 'Search')).toEqual(['up', 'down', 'all']);
    expect(opts('FindRecord', 'MatchCase')).toEqual(['yes', 'no']);
    expect(opts('SetProperty', 'Property')).toEqual(['enabled', 'visible', 'locked', 'left', 'top', 'width', 'height', 'foreColor', 'backColor', 'caption', 'value']);
    for (const cat of [fr, en]) expect(get(cat, 'macro.category.dataEntry')).toBeTruthy();
    expect(fr.macro.category.dataEntry).toBe("Opérations d'entrée de données"); });
  it('a reference argument must parse', () => {
    const set = (a: Record<string, string>) => validateMacro({ formatVersion: '1.0', items: [{ k: 'action', action: 'SetValue', args: a }] });
    expect(set({ Item: '[Forms]![F]![C]', Expression: '1' })).toEqual([]);
    expect(set({ Item: '[Forms]![', Expression: '1' })).toContainEqual({ path: 'items[0].args.Item', code: 'badExpression' });
    expect(set({ Item: ' ', Expression: '1' })).toEqual([]); });  // blank: not set, the interpreter reports it
});
