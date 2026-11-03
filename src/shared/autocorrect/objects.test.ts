import { describe, expect, it } from 'vitest';
import type { NameChange } from '../api';
import type { MacroDef } from '../macro/model';
import { toRenames } from './sql';
import type { DesignDoc } from '../design/model';
import { rewriteDesign, rewriteExpr, rewriteLookup, rewriteMacro, type RewriteCtx } from './objects';

const obj = (kind: 'form' | 'macro' | 'table' | 'query', from: string, to: string): NameChange => ({ k: 'object', kind, from, to });
const ctx = (changes: NameChange[], cols: Record<string, string> = {}): RewriteCtx => ({
  r: toRenames(changes),
  sql: (s) => { if (!/^[A-Z]/.test(s)) throw new Error('bad'); return s.includes('Clients') ? s.replace('Clients', '[Clientèle]') : null; },
  columns: (ref) => (ref ? new Map(Object.entries(cols)) : new Map()),
  recordSourceOf: (_k, n) => (n === 'FClients' ? { kind: 'table', name: 'Clients' } : null),
});
const at = { kind: 'macro' as const, name: 'M', control: '' };
const mac = (...items: MacroDef['items']): MacroDef => ({ formatVersion: '1.0', items });
const act = (action: string, args: Record<string, string>) => ({ k: 'action' as const, action, args });

describe('rewriteMacro', () => {
  it('renames object arguments by type', () => {
    const def = mac(act('OpenForm', { FormName: 'FClients', WhereCondition: '[Nom]="x"' }),
      act('CloseWindow', { ObjectType: 'form', ObjectName: 'FClients' }), act('CloseWindow', { ObjectType: 'table', ObjectName: 'FClients' }),
      act('RunMacro', { MacroName: 'M.Sub' }));
    const out = rewriteMacro(def, ctx([obj('form', 'FClients', 'F2'), obj('macro', 'M', 'M2')]), at)!;
    expect(out.def.items).toEqual([act('OpenForm', { FormName: 'F2', WhereCondition: '[Nom]="x"' }),
      act('CloseWindow', { ObjectType: 'form', ObjectName: 'F2' }), act('CloseWindow', { ObjectType: 'table', ObjectName: 'FClients' }),
      act('RunMacro', { MacroName: 'M2.Sub' })]);
    expect(out.entries.map((e) => [e.control, e.property, e.new])).toEqual([['items[0]', 'FormName', 'F2'], ['items[1]', 'ObjectName', 'F2'], ['items[3]', 'MacroName', 'M2.Sub']]);
  });
  it("OpenForm WhereCondition follows the form's record source fields; MessageBox text does not", () => {
    const c = ctx([], { nom: 'NomClient' });
    const out = rewriteMacro(mac(act('OpenForm', { FormName: 'FClients', WhereCondition: '[Nom] = "Nom"' }),
      act('MessageBox', { Message: '[Nom]' }), act('OpenForm', { FormName: 'Autre', WhereCondition: '[Nom] = 1' })), c, at)!;
    expect(out.def.items[0]).toEqual(act('OpenForm', { FormName: 'FClients', WhereCondition: '[NomClient] = "Nom"' }));
    expect(out.def.items[1]).toEqual(act('MessageBox', { Message: '[Nom]' }));
    expect(out.def.items[2]).toEqual(act('OpenForm', { FormName: 'Autre', WhereCondition: '[Nom] = 1' }));
  });
  it('renames members in conditions and = arguments', () => {
    const out = rewriteMacro(mac({ k: 'if', branches: [{ cond: '[Forms]![FClients]![Ville] = "Lyon"', items: [act('MessageBox', { Message: '=[Forms]![FClients]![Ville]' })] }] }),
      ctx([obj('form', 'FClients', 'F2')]), at)!;
    const i = out.def.items[0] as Extract<MacroDef['items'][0], { k: 'if' }>;
    expect(i.branches[0]!.cond).toBe('[Forms]![F2]![Ville] = "Lyon"');
    expect(i.branches[0]!.items[0]).toEqual(act('MessageBox', { Message: '=[Forms]![F2]![Ville]' }));
    expect(out.entries.map((e) => [e.control, e.property])).toEqual([['items[0]', 'Condition'], ['items[0].branches[0].items[0]', 'Message']]);
  });
  it('rewrites RunSQL, with the embedded control as entry control', () => {
    const out = rewriteMacro(mac(act('RunSQL', { SQLStatement: 'UPDATE Clients SET Ville = "Lyon"' })), ctx([obj('table', 'Clients', 'Clientèle')]), { ...at, kind: 'form', control: 'Bouton1.OnClick' })!;
    expect(out.def.items[0]).toEqual(act('RunSQL', { SQLStatement: 'UPDATE [Clientèle] SET Ville = "Lyon"' }));
    expect(out.entries[0]).toMatchObject({ kind: 'form', control: 'Bouton1.OnClick', property: 'SQLStatement' });
  });
  it('reports an unreadable argument naming a renamed name, not one naming nothing', () => {
    const c = ctx([], { nom: 'N2' });
    const out = rewriteMacro(mac(act('OpenForm', { FormName: 'FClients', WhereCondition: '[Nom' }), act('OpenForm', { FormName: 'FClients', WhereCondition: '1 +' })), c, at)!;
    expect(out.entries.map((e) => [e.property, e.old, e.new])).toEqual([['WhereCondition', '[Nom', null]]);
    expect(out.def.items[0]).toEqual(act('OpenForm', { FormName: 'FClients', WhereCondition: '[Nom' }));
  });
  it('returns null when nothing changes', () => {
    expect(rewriteMacro(mac(act('Beep', {}), act('Nope', { A: 'FClients' })), ctx([obj('form', 'FClients', 'F2')]), at)).toBeNull();
  });
});

describe('rewriteExpr', () => {
  it('skips controls and string literals', () => {
    const c = ctx([]);
    expect(rewriteExpr('[Nom] & "Nom"', c, new Map([['nom', 'N2']]), [])).toBe('[N2] & "Nom"');
    expect(rewriteExpr('[Nom]', c, new Map([['nom', 'N2']]), ['nom'])).toBeNull();
  });
  it('prints criteria form', () => {
    expect(rewriteExpr('>5', ctx([]), new Map(), [], true)).toBeNull();
    expect(rewriteExpr('[Nom] = 1', ctx([]), new Map([['nom', 'N2']]), [], true)).toBe('[N2] = 1');
  });
});

describe('rewriteLookup', () => {
  const at2 = { table: 'Commandes', field: 'Client' };
  it('rewrites a SQL row source and a query name, never a value list', () => {
    const c = ctx([obj('query', 'QClients', 'Q2')]);
    expect(rewriteLookup({ kind: 'table', table: 'SELECT Nom FROM Clients' } as never, c, at2)!.lookup).toMatchObject({ table: 'SELECT Nom FROM [Clientèle]' });
    const q = rewriteLookup({ kind: 'table', table: 'qclients' } as never, c, at2)!;
    expect(q.lookup).toMatchObject({ table: 'Q2' });
    expect(q.entries[0]).toEqual({ kind: 'table', name: 'Commandes', control: 'Client', property: 'RowSource', old: 'qclients', new: 'Q2' });
    expect(rewriteLookup({ kind: 'values', values: ['QClients'] } as never, c, at2)).toBeNull();
    expect(rewriteLookup({ kind: 'table', table: 'Clients' } as never, ctx([obj('table', 'Clients', 'X')]), at2)).toBeNull();
  });
  it('reports an unreadable SQL naming a renamed name', () => {
    expect(rewriteLookup({ kind: 'table', table: 'select Clients' } as never, ctx([obj('table', 'Clients', 'X')]), at2)!.entries[0]!.new).toBeNull();
    expect(rewriteLookup({ kind: 'table', table: 'select Autre' } as never, ctx([obj('table', 'Clients', 'X')]), at2)).toBeNull();
  });
});

describe('rewriteExpr subqueries', () => {
  const c = (changes: NameChange[], cols: Record<string, string> = {}): RewriteCtx => ({ ...ctx(changes, cols), sql: (s) => { if (/Secret/.test(s)) throw new Error('refused'); return s.includes('Clients') ? s.replace(/\[?Clients\]?/g, '[Clientèle]') : s.includes('Nom') ? s.replace(/\[?\bNom\b\]?/g, '[NomClient]') : null; } });
  it('rewrites a table name inside In (SELECT …)', () => {
    const out = rewriteExpr('[N] In (SELECT N FROM Clients)', c([]), new Map(), []);
    expect(out).toContain('Clientèle');
    expect(out).toMatch(/^\[N\] In \(SELECT/);
  });
  it('rewrites a field inside Exists(SELECT …) and a scalar subquery', () => {
    expect(rewriteExpr('Exists (SELECT Nom FROM T)', c([]), new Map(), [])).toContain('NomClient');
    expect(rewriteExpr('1 + (SELECT Nom FROM T)', c([]), new Map(), [])).toContain('NomClient');
  });
  it('a subquery ctx.sql refuses fails the argument and leaves it', () => {
    const def = mac(act('OpenForm', { FormName: 'Autre', WhereCondition: '[N] In (SELECT Secret FROM Clients)' }));
    const out = rewriteMacro(def, c([obj('table', 'Clients', 'Clientèle')]), at)!;
    expect(out.entries.map((e) => [e.property, e.new])).toEqual([['WhereCondition', null]]);
    expect(out.def.items[0]).toEqual(def.items[0]);
  });
  it('a correlated subquery naming a renamed outer table fails the argument and leaves it', () => {
    const def = mac(act('OpenForm', { FormName: 'Autre', WhereCondition: 'Exists (SELECT 1 FROM Commandes WHERE Commandes.Client = Cli.[N°])' }));
    const out = rewriteMacro(def, c([obj('table', 'Cli', 'Clientèle')]), at)!;
    expect(out.entries.map((e) => [e.property, e.new])).toEqual([['WhereCondition', null]]);
    expect(out.def.items[0]).toEqual(def.items[0]);
  });
  it('rewrites a Where Condition subquery in a macro', () => {
    const out = rewriteMacro(mac(act('OpenForm', { FormName: 'Autre', WhereCondition: '[N] In (SELECT N FROM Clients)' })), c([obj('table', 'Clients', 'Clientèle')]), at)!;
    expect(out.entries).toHaveLength(1);
    expect(out.entries[0]!.new).toContain('Clientèle');
  });
});

describe('rewriteDesign', () => {
  const tb = (name: string, props: Record<string, unknown>, kind = 'textBox') => ({ kind, name, left: 0, top: 0, width: 1, height: 1, props }) as never;
  const form = (o: { recordSource?: DesignDoc['recordSource']; controls: unknown[]; props?: Record<string, unknown> }): DesignDoc =>
    ({ formatVersion: '1.0', recordSource: o.recordSource ?? null, props: o.props ?? {}, sections: [{ kind: 'detail', height: 1, props: {}, controls: o.controls as never }] });
  const props = (d: DesignDoc) => d.sections[0]!.controls.map((c) => c.props);
  const c = (changes: NameChange[], cols: Record<string, string> = { nom: 'NomClient', ville: 'Cité' }) => ctx(changes, cols);

  it('ControlSource follows, =[Nom] reads the control', () => {
    const doc = form({ recordSource: { kind: 'table', name: 'Clients' }, controls: [tb('Nom', { ControlSource: 'Nom' }), tb('Salut', { ControlSource: '=[Nom] & "!"' }), tb('V', { ControlSource: '=[Ville] & "!"' })] });
    const out = rewriteDesign(doc, 'form', 'FClients', c([]))!;
    expect(props(out.doc)).toEqual([{ ControlSource: 'NomClient' }, { ControlSource: '=[Nom] & "!"' }, { ControlSource: '=[Cité] & "!"' }]);
    expect(out.entries).toContainEqual({ kind: 'form', name: 'FClients', control: 'Nom', property: 'ControlSource', old: 'Nom', new: 'NomClient' });
    expect(doc.sections[0]!.controls[0]!.props).toEqual({ ControlSource: 'Nom' });
  });
  it('renames the record source, a combo row source, a subform and its link fields', () => {
    const doc = form({ recordSource: { kind: 'table', name: 'Clients' }, controls: [
      tb('Cb', { RowSource: 'SELECT Nom FROM Clients' }, 'comboBox'), tb('Cv', { RowSource: 'Clients', RowSourceType: 'valueList' }, 'comboBox'),
      tb('Sf', { SourceObject: 'FSub', LinkMasterFields: 'Nom; Ville', LinkChildFields: 'Cl', Autre: 1 }, 'subform')] });
    const cx: RewriteCtx = { ...c([obj('table', 'Clients', 'Clientèle'), obj('form', 'FSub', 'FSub2')]), columns: (ref) => new Map(ref?.kind === 'table' && ref.name === 'Clients' ? [['nom', 'NomClient']] : ref ? [['cl', 'Client']] : []), recordSourceOf: () => ({ kind: 'table', name: 'Sub' }) };
    const out = rewriteDesign(doc, 'form', 'F', cx)!;
    expect(out.doc.recordSource).toEqual({ kind: 'table', name: 'Clientèle' });
    expect(props(out.doc)).toEqual([{ RowSource: 'SELECT Nom FROM [Clientèle]' }, { RowSource: 'Clients', RowSourceType: 'valueList' },
      { SourceObject: 'FSub2', LinkMasterFields: 'NomClient; Ville', LinkChildFields: 'Client', Autre: 1 }]);
  });
  it('follows a query record source output renames', () => {
    const doc = form({ recordSource: { kind: 'query', name: 'QVentes' }, controls: [tb('T', { ControlSource: 'Nom' })] });
    expect(props(rewriteDesign(doc, 'form', 'F', c([obj('query', 'QVentes', 'Q2')]))!.doc)).toEqual([{ ControlSource: 'NomClient' }]);
  });
  it('rewrites DefaultValue, ValidationRule and an embedded macro', () => {
    const embedded = mac(act('OpenForm', { FormName: 'FClients' }));
    const doc = form({ recordSource: { kind: 'table', name: 'Clients' }, controls: [tb('T', { DefaultValue: '[Nom]', ValidationRule: '[Nom] > 1', OnClick: { embedded }, OnEnter: 'FClients' })] });
    const out = rewriteDesign(doc, 'form', 'F', c([obj('form', 'FClients', 'F2'), obj('macro', 'FClients', 'M2')]))!;
    expect(props(out.doc)[0]).toEqual({ DefaultValue: '[NomClient]', ValidationRule: '[NomClient] > 1', OnClick: { embedded: mac(act('OpenForm', { FormName: 'F2' })) }, OnEnter: 'M2' });
    expect(out.entries.map((e) => [e.control, e.property])).toContainEqual(['T.OnClick', 'FormName']);
  });
  it("rewrites a report's grouping", () => {
    const doc = form({ recordSource: { kind: 'table', name: 'Clients' }, props: { grouping: [{ expression: 'Nom', keep: 1 }] }, controls: [] });
    const out = rewriteDesign(doc, 'report', 'R', c([]))!;
    expect(out.doc.props.grouping).toEqual([{ expression: 'NomClient', keep: 1 }]);
    expect(out.entries[0]).toMatchObject({ property: 'GroupLevel1', new: 'NomClient' });
  });
  it('leaves a field renamed onto a control name and reports it', () => {
    const doc = form({ recordSource: { kind: 'table', name: 'Clients' }, controls: [tb('Cité', {}), tb('T', { ControlSource: '=[Ville]' })] });
    const out = rewriteDesign(doc, 'form', 'F', c([]))!;
    expect(props(out.doc)[1]).toEqual({ ControlSource: '=[Ville]' });
    expect(out.entries).toEqual([{ kind: 'form', name: 'F', control: 'T', property: 'ControlSource', old: '=[Ville]', new: null, reason: 'meaning' }]);
  });
  it('returns null for a form that uses nothing renamed', () => {
    expect(rewriteDesign(form({ controls: [tb('T', { ControlSource: 'Autre', OnClick: 'M' })] }), 'form', 'F', c([obj('form', 'X', 'Y')]))).toBeNull();
  });
});
