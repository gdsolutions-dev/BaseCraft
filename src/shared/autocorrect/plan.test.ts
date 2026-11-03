import { describe, expect, it } from 'vitest';
import type { NameChange } from '../api';
import type { DesignDoc } from '../design/model';
import { foldName, sameName, type TableDesign } from '../field-types';
import type { MacroDef } from '../macro/model';
import type { QueryCatalog } from '../query/bind';
import { f, t } from '../test-fixtures';
import { planAutoCorrect, propertyTargets, type AutoCorrectWorld } from './plan';

// seedSales's designs (src/main/query/test-db.ts), Commandes.Client looked up in QClientsLyon, and SALES_QUERIES
// (tests/e2e/helpers.ts, Playwright: not importable here).
const TABLES: TableDesign[] = [
  t('Clients', [f('N°', 'autoNumber'), f('Nom', 'shortText', { required: true }), f('Ville', 'shortText')]),
  t('Commandes', [f('N°', 'autoNumber'), f('Client', 'number', { numberSize: 'longInteger', lookup: { kind: 'table', table: 'QClientsLyon', limitToList: true } }),
    f('Montant', 'currency', { validationRule: '>0' }), f('Le', 'dateTime')]),
];
const SALES_QUERIES: [string, string][] = [
  ['QDepuis', 'SELECT [N°], Montant, Le FROM Commandes WHERE Le >= [Date début :];'],
  ['QClientsLyon', 'SELECT * FROM [Clients] WHERE [Ville] = "Lyon";'],
  ['QVentes', 'SELECT Clients.Nom, Commandes.Montant, Commandes.Le FROM Clients INNER JOIN Commandes ON Clients.[N°] = Commandes.Client;'],
];
const tb = (name: string, props: Record<string, unknown>) => ({ kind: 'textBox', name, left: 0, top: 0, width: 1, height: 1, props }) as never;
const doc = (recordSource: DesignDoc['recordSource'], ...controls: unknown[]): DesignDoc =>
  ({ formatVersion: '1.0', recordSource, props: {}, sections: [{ kind: 'detail', height: 1, props: {}, controls: controls as never }] });
const FCLIENTS = doc({ kind: 'table', name: 'Clients' }, tb('Nom', { ControlSource: 'Nom' }), tb('Ville', { ControlSource: 'Ville' }));
const RVENTES = doc({ kind: 'query', name: 'QVentes' }, tb('Nom', { ControlSource: 'Nom' }), tb('Montant', { ControlSource: 'Montant' }));
const MOUVRIR: MacroDef = { formatVersion: '1.0', items: [{ k: 'action', action: 'OpenForm', args: { FormName: 'FClients' } }] };

type Obj = AutoCorrectWorld['objects'][number];
const q = (name: string, sql: string): Obj => ({ kind: 'query', name, definition: { formatVersion: '1.0', sql } });
function worldOf(objects: Obj[], extra: Partial<AutoCorrectWorld> = {}): AutoCorrectWorld {
  const catalog: QueryCatalog = {
    table: (n) => TABLES.find((x) => sameName(x.name, n)) ?? null,
    query: (n) => {
      const d = objects.find((o) => o.kind === 'query' && sameName(o.name, n))?.definition as { sql?: unknown } | undefined;
      return typeof d?.sql === 'string' ? d.sql : null;
    },
  };
  return { objects, corrupt: [], tables: TABLES, catalog, startupForm: '', ...extra };
}
const BASE: Obj[] = [...SALES_QUERIES.map(([n, s]) => q(n, s)), { kind: 'form', name: 'FClients', definition: FCLIENTS },
  { kind: 'report', name: 'RVentes', definition: RVENTES }, { kind: 'macro', name: 'MOuvrir', definition: MOUVRIR }];
const world = worldOf(BASE);
const F = (table: string, ...renames: [string, string][]): NameChange => ({ k: 'fields', table, renames: renames.map(([from, to]) => ({ from, to })) });
const T = (from: string, to: string): NameChange => ({ k: 'object', kind: 'table', from, to });
const O = (kind: 'query' | 'form' | 'report', from: string, to: string): NameChange => ({ k: 'object', kind, from, to });
const def = (p: ReturnType<typeof planAutoCorrect>, name: string) => p.objects.find((o) => o.name === name)?.definition;

describe('planAutoCorrect', () => {
  it('renaming Clients.Nom corrects the query, the form and the report (roadmap acceptance)', () => {
    const p = planAutoCorrect(world, [F('Clients', ['Nom', 'NomClient'])]);
    expect(p.corrected).toEqual([{ kind: 'query', name: 'QVentes' }, { kind: 'form', name: 'FClients' }, { kind: 'report', name: 'RVentes' }]);
    expect(p.failed).toEqual([]);
    expect((def(p, 'QVentes') as { sql: string }).sql).toContain('[Clients].[NomClient]');
    expect((def(p, 'RVentes') as DesignDoc).sections[0]!.controls[0]!.props).toEqual({ ControlSource: 'NomClient' });
    expect(p.entries.map((e) => [e.kind, e.name, e.control, e.property])).toEqual([['query', 'QVentes', '', 'SQL'],
      ['form', 'FClients', 'Nom', 'ControlSource'], ['report', 'RVentes', 'Nom', 'ControlSource']]);
    expect(p.lookups).toEqual([]);
    expect(p.startupForm).toBeUndefined();
  });

  it('a broken query: untouched when unrelated, failed when it names the renamed table (Review Focus 1)', () => {
    const w = worldOf([...BASE, q('QCassée', 'SELECT Clients.Nom FROM Clients, Disparue;')]);
    const unrelated = planAutoCorrect(w, [T('Commandes', 'Ventes')]);
    expect(unrelated.failed).toEqual([]);
    expect(unrelated.entries.some((e) => e.name === 'QCassée')).toBe(false);
    const named = planAutoCorrect(w, [T('Clients', 'Clientèle')]);
    expect(named.failed).toEqual([{ kind: 'query', name: 'QCassée' }]);
    expect(named.entries).toContainEqual({ kind: 'query', name: 'QCassée', control: '', property: 'SQL', old: 'SELECT Clients.Nom FROM Clients, Disparue;', new: null, reason: 'unreadable' });
    expect(named.objects.some((o) => o.name === 'QCassée')).toBe(false);
  });

  it('a parameter capture is failed (Review Focus 2)', () => {
    const w = worldOf([...BASE, { kind: 'report', name: 'RDepuis', definition: doc({ kind: 'query', name: 'QDepuis' }, tb('M', { ControlSource: 'Montant' })) }]);
    const p = planAutoCorrect(w, [F('Commandes', ['Montant', 'Date début :'])]);
    expect(p.failed).toEqual([{ kind: 'query', name: 'QDepuis' }, { kind: 'report', name: 'RDepuis' }]); // its query put back
    expect(p.corrected).toContainEqual({ kind: 'query', name: 'QVentes' });
    expect(p.objects.some((o) => o.name === 'QDepuis')).toBe(false);
  });

  it('a failing query fails its dependents', () => {
    // QB's rewrite passes the rewriter but not R7's check (its expression column keeps the name Expr1000 the field takes);
    // QA, checked first against QB's rewrite, is checked again once QB is put back.
    const w = worldOf([q('QA', 'SELECT Nom FROM QB;'), q('QB', 'SELECT Nom, [N°] + 1 FROM Clients;'), ...BASE]);
    const p = planAutoCorrect(w, [F('Clients', ['Nom', 'Expr1000'])]);
    expect(p.failed).toEqual([{ kind: 'query', name: 'QA' }, { kind: 'query', name: 'QB' }]);
    expect(p.objects.some((o) => o.name === 'QA' || o.name === 'QB')).toBe(false);
    expect(p.entries.filter((e) => e.name === 'QA' || e.name === 'QB').map((e) => e.new)).toEqual([null, null]);
    expect(p.entries.filter((e) => e.name === 'QA' || e.name === 'QB').map((e) => [e.name, e.reason])).toEqual([['QA', 'dependency'], ['QB', 'meaning']]);
  });

  it('a renamed form is listed under its new name, its own [Forms]![FClients] fixed, startupForm follows', () => {
    const self = doc({ kind: 'table', name: 'Clients' }, tb('Nom', { ControlSource: 'Nom' }), tb('Salut', { ControlSource: '=[Forms]![FClients]![Nom] & "!"' }));
    const w = worldOf([...BASE.map((o) => (o.name === 'FClients' ? { ...o, definition: self } : o)),
      q('QParam', 'SELECT * FROM Clients WHERE Ville = [Forms]![FClients]![Ville];')], { startupForm: 'FClients' });
    const p = planAutoCorrect(w, [O('form', 'FClients', 'FClientèle')]);
    expect(p.corrected).toEqual([{ kind: 'form', name: 'FClientèle' }, { kind: 'macro', name: 'MOuvrir' }, { kind: 'query', name: 'QParam' }]);
    expect(p.failed).toEqual([]); // ruling 3: the renamed parameter [Forms]![FClients]![Ville] is the same parameter
    expect((def(p, 'FClientèle') as DesignDoc).sections[0]!.controls[1]!.props).toEqual({ ControlSource: '=[Forms]![FClientèle]![Nom] & "!"' });
    expect((def(p, 'MOuvrir') as MacroDef).items[0]).toEqual({ k: 'action', action: 'OpenForm', args: { FormName: 'FClientèle' } });
    expect((def(p, 'QParam') as { sql: string }).sql).toContain('[Forms]![FClientèle]![Ville]');
    expect(p.startupForm).toBe('FClientèle');
    expect(p.entries).toContainEqual({ kind: 'form', name: 'FClientèle', control: '', property: 'StartupForm', old: 'FClients', new: 'FClientèle' });
  });

  it('lookups of other tables follow a query rename', () => {
    const p = planAutoCorrect(world, [O('query', 'QClientsLyon', 'QLyon')]);
    expect(p.lookups).toEqual([{ table: 'Commandes', field: 'Client', lookup: { kind: 'table', table: 'QLyon', limitToList: true } }]);
    expect(p.corrected).toEqual([{ kind: 'table', name: 'Commandes' }]);
    expect(p.entries).toEqual([{ kind: 'table', name: 'Commandes', control: 'Client', property: 'RowSource', old: 'QClientsLyon', new: 'QLyon' }]);
  });

  it("a fields change's own table keeps its lookups (the designer's)", () => {
    const tables = TABLES.map((d) => (d.name === 'Clients' ? { ...d, fields: [...d.fields, f('Parrain', 'number', { lookup: { kind: 'table', table: 'SELECT [N°], Nom FROM Clients', limitToList: true } })] } : d));
    expect(planAutoCorrect(worldOf(BASE, { tables }), [F('Clients', ['Nom', 'NomClient'])]).lookups).toEqual([]);
    const p = planAutoCorrect(worldOf(BASE, { tables }), [T('Clients', 'Clientèle')]); // a Navigation Pane rename: its own lookups follow
    expect(p.lookups).toEqual([{ table: 'Clientèle', field: 'Parrain', lookup: { kind: 'table', table: 'SELECT [N°], [Nom]\nFROM [Clientèle];', limitToList: true } }]);
  });

  it('corrupt objects are failed', () => {
    const p = planAutoCorrect(worldOf(BASE, { corrupt: [{ kind: 'form', name: 'FClients2' }, { kind: 'query', name: 'QPerdue' }] }), [O('query', 'QPerdue', 'QP')]);
    expect(p.failed).toEqual([{ kind: 'form', name: 'FClients2' }, { kind: 'query', name: 'QP' }]);
    expect(p.entries.filter((e) => e.new === null)).toEqual([{ kind: 'form', name: 'FClients2', control: '', property: '', old: '', new: null, reason: 'unreadable' },
      { kind: 'query', name: 'QP', control: '', property: '', old: '', new: null, reason: 'unreadable' }]);
  });

  it('a malformed definition is failed when it names a renamed name, never crashes the plan (ruling 2)', () => {
    const badPt: Obj = { kind: 'query', name: 'QServeur', definition: { formatVersion: '2.0', sql: 'SELECT * FROM Clients' } };
    const badForm: Obj = { kind: 'form', name: 'FCassé', definition: { formatVersion: '1.0', recordSource: { kind: 'table', name: 'Clients' }, sections: 3 } };
    const w = worldOf([...BASE, badPt, badForm]);
    expect(planAutoCorrect(w, [T('Clients', 'Clientèle')]).failed).toEqual([{ kind: 'query', name: 'QServeur' }, { kind: 'form', name: 'FCassé' }]);
    expect(planAutoCorrect(w, [T('Commandes', 'Ventes')]).failed).toEqual([]);
  });

  it("a form whose record source does not bind is failed when a text names a renamed field (R7)", () => {
    const w = worldOf([...BASE, q('QCassée', 'SELECT * FROM Disparue;'),
      { kind: 'form', name: 'FCassé', definition: doc({ kind: 'query', name: 'QCassée' }, tb('Nom', { ControlSource: 'Nom' })) },
      { kind: 'form', name: 'FAutre', definition: doc({ kind: 'query', name: 'QCassée' }, tb('Ville', { ControlSource: 'Ville' })) }]);
    const p = planAutoCorrect(w, [F('Clients', ['Nom', 'NomClient'])]);
    expect(p.failed).toEqual([{ kind: 'form', name: 'FCassé' }]);
    expect(p.entries).toContainEqual({ kind: 'form', name: 'FCassé', control: 'Nom', property: 'ControlSource', old: 'Nom', new: null, reason: 'unreadable' });
  });

  it('a record source SQL is checked too (ruling 1)', () => {
    const w = worldOf([...BASE, { kind: 'form', name: 'FSql', definition: doc({ kind: 'sql', sql: 'SELECT Nom, [N°] + 1 FROM Clients;' }) }]);
    const p = planAutoCorrect(w, [F('Clients', ['Nom', 'Expr1000'])]);
    expect(p.failed).toContainEqual({ kind: 'form', name: 'FSql' });
    expect(p.objects.some((o) => o.name === 'FSql')).toBe(false);
  });

  it('a refused record source rewrite is failed even when no token names the renamed field (fix I1)', () => {
    // [Clients.N°] is one identifier (a clash-qualified column of QTous); its rewrite to Expr1000 clashes with Le + 1.
    const w = worldOf([...BASE, q('QTous', 'SELECT * FROM Clients, Commandes;'),
      { kind: 'form', name: 'FT', definition: doc({ kind: 'sql', sql: 'SELECT [Clients.N°], Le + 1 FROM QTous;' }, tb('C', { ControlSource: 'Clients.N°' })) }]);
    const p = planAutoCorrect(w, [F('Clients', ['N°', 'Expr1000'])]);
    expect(p.failed).toContainEqual({ kind: 'form', name: 'FT' });
    expect(p.objects.some((o) => o.name === 'FT')).toBe(false);
  });

  it('a SQL record source over a put-back query is failed, like a query one (fix I2)', () => {
    const w = worldOf([...BASE, { kind: 'form', name: 'FS', definition: doc({ kind: 'sql', sql: 'SELECT * FROM QDepuis;' }, tb('M', { ControlSource: 'Montant' })) },
      { kind: 'macro', name: 'MFs', definition: { formatVersion: '1.0', items: [{ k: 'action', action: 'OpenForm', args: { FormName: 'FS', WhereCondition: '[Montant] > 5' } }] } }]);
    const p = planAutoCorrect(w, [F('Commandes', ['Montant', 'Date début :'])]);
    expect(p.failed).toEqual(expect.arrayContaining([{ kind: 'form', name: 'FS' }, { kind: 'macro', name: 'MFs' }]));
    expect(p.objects.some((o) => o.name === 'FS' || o.name === 'MFs')).toBe(false);
  });

  it('LinkMasterFields over a record source that does not bind is failed, never folded (fix I3)', () => {
    const w = worldOf([...BASE, q('QCassée', 'SELECT * FROM Disparue;'), { kind: 'form', name: 'FP', definition: doc({ kind: 'query', name: 'QCassée' },
      { kind: 'subform', name: 'Sf', left: 0, top: 0, width: 1, height: 1, props: { SourceObject: 'FClients', LinkMasterFields: 'Nom', LinkChildFields: 'Ville' } }) }]);
    const p = planAutoCorrect(w, [F('Clients', ['Nom', 'NomClient'])]);
    expect(p.failed).toContainEqual({ kind: 'form', name: 'FP' });
    expect(p.entries).toContainEqual({ kind: 'form', name: 'FP', control: 'Sf', property: 'LinkMasterFields', old: 'Nom', new: null, reason: 'unreadable' });
  });

  it("a subform's Source Object names an object of its own document's kind: a same-named form and report (final I1)", () => {
    const sf = (props: Record<string, unknown>) => ({ kind: 'subform', name: 'Sf', left: 0, top: 0, width: 1, height: 1, props });
    const w = worldOf([...BASE, { kind: 'report', name: 'FClients', definition: RVENTES },
      { kind: 'form', name: 'FMain', definition: doc(null, sf({ SourceObject: 'FClients', LinkChildFields: 'Ville' })) },
      { kind: 'report', name: 'RMain', definition: doc(null, sf({ SourceObject: 'FClients', LinkChildFields: 'Ville' })) }]);
    const byReport = planAutoCorrect(w, [O('report', 'FClients', 'RClients')]);
    expect(byReport.corrected).toEqual([{ kind: 'report', name: 'RMain' }]);
    expect(byReport.entries).toEqual([{ kind: 'report', name: 'RMain', control: 'Sf', property: 'SourceObject', old: 'FClients', new: 'RClients' }]);
    const byForm = planAutoCorrect(w, [O('form', 'FClients', 'F2')]);
    expect(byForm.corrected).toContainEqual({ kind: 'form', name: 'FMain' });
    expect(byForm.entries.some((e) => e.name === 'RMain')).toBe(false);
    // The child fields are the subform's own kind's record source: the form FClients reads Clients, the report FClients QVentes.
    const ville = planAutoCorrect(w, [F('Clients', ['Ville', 'Cité'])]);
    expect(ville.entries).toContainEqual({ kind: 'form', name: 'FMain', control: 'Sf', property: 'LinkChildFields', old: 'Ville', new: 'Cité' });
    expect(ville.entries.some((e) => e.name === 'RMain')).toBe(false);
  });

  it('reads each table design and saved query of the catalog at most once per plan (final I2)', () => {
    const reads = new Map<string, number>();
    const count = (k: string) => { reads.set(k, (reads.get(k) ?? 0) + 1); };
    const w = worldOf(BASE);
    const catalog: QueryCatalog = { table: (n) => { count(`t|${foldName(n)}`); return w.catalog.table(n); },
      query: (n) => { count(`q|${foldName(n)}`); return w.catalog.query(n); } };
    expect(planAutoCorrect({ ...w, catalog }, [F('Clients', ['Nom', 'NomClient'])]).corrected).toHaveLength(3);
    expect(reads.size).toBeGreaterThan(0);
    expect([...reads].filter(([, n]) => n > 1)).toEqual([]);
  });

  it('lists only the objects that use the name', () => expect(planAutoCorrect(world, [T('Commandes', 'Ventes')]).corrected).toEqual([{ kind: 'query', name: 'QDepuis' }, { kind: 'query', name: 'QVentes' }]));
});

describe('propertyTargets (R12)', () => {
  const fc = (c: Record<string, unknown>) => doc({ kind: 'table', name: 'Commandes' }, tb('Montant', { ControlSource: 'Montant', ...c }));
  const w = worldOf([...BASE,
    { kind: 'form', name: 'FStd', definition: fc({ Format: 'Standard' }) },
    { kind: 'form', name: 'FVide', definition: fc({ Format: '' }) },
    { kind: 'form', name: 'FSans', definition: fc({}) },
    { kind: 'form', name: 'FDeja', definition: fc({ Format: 'Monétaire' }) },
    { kind: 'form', name: 'FCalc', definition: doc({ kind: 'table', name: 'Commandes' }, tb('M', { ControlSource: '=Montant', Format: 'Standard' })) },
    { kind: 'form', name: 'FClientsFmt', definition: doc({ kind: 'table', name: 'Clients' }, tb('Montant', { ControlSource: 'Montant', Format: 'Standard' })) },
    { kind: 'report', name: 'RFmt', definition: doc({ kind: 'query', name: 'QVentes' }, tb('Montant', { ControlSource: 'Montant', Format: 'Standard', DecimalPlaces: '3' }), tb('Nom', { ControlSource: 'Nom', Format: '>' })) }]);

  it('lists the bound controls with their own different value, through the table and through a query', () => {
    expect(propertyTargets(w, 'Commandes', 'Montant', 'Format', 'Monétaire')).toEqual([
      { kind: 'form', name: 'FStd', control: 'Montant', current: 'Standard' }, { kind: 'report', name: 'RFmt', control: 'Montant', current: 'Standard' }]);
    expect(propertyTargets(w, 'Commandes', 'Montant', 'DecimalPlaces', '2')).toEqual([{ kind: 'report', name: 'RFmt', control: 'Montant', current: '3' }]);
    expect(propertyTargets(w, 'Commandes', 'Montant', 'DecimalPlaces', '3')).toEqual([]);
  });
});
