import { describe, expect, it } from 'vitest';
import { dependencies, refsOf, relatedGroups, sqlSources, type DepObject } from './dependencies';
import type { NavObject } from '../../shared/nav-view';

const form = (recordSource: unknown, controls: Record<string, unknown>[] = []) => ({ formatVersion: '1.0', recordSource, props: {},
  sections: [{ kind: 'detail', height: 100, props: {}, controls: controls.map((props, i) => ({ kind: 'subform', name: `c${i}`, left: 0, top: 0, width: 1, height: 1, props })) }] });
const objects: DepObject[] = [
  { kind: 'query', name: 'QClientsLyon', definition: { formatVersion: '1.0', sql: "SELECT * FROM Clients WHERE Ville = 'Lyon'" } },
  { kind: 'query', name: 'QTotaux', definition: { formatVersion: '1.0', sql: 'SELECT c.Nom FROM QClientsLyon AS c INNER JOIN Commandes ON c.Id = Commandes.ClientId WHERE c.Id IN (SELECT ClientId FROM Archive)' } },
  { kind: 'form', name: 'FClients', definition: form({ kind: 'table', name: 'Clients' }, [{ SourceObject: 'FCommandes' }, { RowSource: 'SELECT Id FROM Villes', RowSourceType: 'tableQuery' }, { RowSource: 'Clients', RowSourceType: 'valueList' }]) },
  { kind: 'form', name: 'FCommandes', definition: form({ kind: 'sql', sql: 'SELECT * FROM QTotaux' }) },
  { kind: 'report', name: 'RClients', definition: form({ kind: 'query', name: 'QClientsLyon' }) },
  { kind: 'macro', name: 'MOuvrir', definition: { formatVersion: '1.0', items: [
    { k: 'action', action: 'OpenForm', args: { FormName: 'FClients' } },
    { k: 'if', branches: [{ cond: 'True', items: [{ k: 'action', action: 'OpenReport', args: { ReportName: 'RClients' } }] }], else: [{ k: 'action', action: 'OpenForm', args: { FormName: 'Inconnu' } }] },
    { k: 'submacro', name: 'S', items: [{ k: 'action', action: 'RunMacro', args: { MacroName: 'MOuvrir.S' } }] }] } },
];
const world = { tables: ['Clients', 'Commandes', 'Archive', 'Villes'], objects };
const names = (r: { kind: string; name: string }[]) => r.map((x) => `${x.kind}:${x.name}`);

describe('object dependencies', () => {
  it('reads the tables and queries of a SQL text, subqueries and joins included', () => {
    expect(sqlSources('SELECT * FROM A INNER JOIN B ON A.x = B.x WHERE A.y IN (SELECT y FROM C)')).toEqual(['A', 'B', 'C']);
    expect(sqlSources('not sql')).toEqual([]);
  });
  it('a query depends on its sources, tables first', () => {
    expect(names(dependencies(world, { kind: 'query', name: 'QTotaux' }).iDependOn)).toEqual(['table:Archive', 'table:Commandes', 'query:QClientsLyon']);
  });
  it('who depends on a table: queries, forms and reports through record source, row source and SQL', () => {
    expect(names(dependencies(world, { kind: 'table', name: 'clients' }).dependsOnMe)).toEqual(['query:QClientsLyon', 'form:FClients']);
    expect(names(dependencies(world, { kind: 'table', name: 'Villes' }).dependsOnMe)).toEqual(['form:FClients']);   // the valueList row source names nothing
  });
  it('a form depends on its subform, its record source and its row sources', () => {
    expect(names(dependencies(world, { kind: 'form', name: 'FClients' }).iDependOn)).toEqual(['table:Clients', 'table:Villes', 'form:FCommandes']);
    expect(names(dependencies(world, { kind: 'form', name: 'FCommandes' }).iDependOn)).toEqual(['query:QTotaux']);
  });
  it('a macro depends on what it opens, in branches and submacros; an unknown object and itself are left out', () => {
    expect(names(refsOf(objects[5], world))).toEqual(['form:FClients', 'report:RClients']);
    expect(names(dependencies(world, { kind: 'report', name: 'RClients' }).dependsOnMe)).toEqual(['macro:MOuvrir']);
  });
  it('a table depends on nothing; a pass-through query names nothing', () => {
    expect(dependencies(world, { kind: 'table', name: 'Clients' }).iDependOn).toEqual([]);
    expect(refsOf({ kind: 'query', name: 'P', definition: { formatVersion: '2.0', sql: 'SELECT * FROM Clients' } }, world)).toEqual([]);
  });
});

describe('relatedGroups cycles and names', () => {
  const m = (name: string, target: string): DepObject => ({ kind: 'macro', name, definition: { formatVersion: '1.0', items: [{ k: 'action', action: 'RunMacro', args: { MacroName: target } }] } });
  const o = (kind: NavObject['kind'], name: string): NavObject => ({ kind, name });
  it('terminates on a cycle A -> B -> A', () => {
    const q: DepObject = { kind: 'query', name: 'Q', definition: { formatVersion: '1.0', sql: 'SELECT * FROM T' } };
    const g = relatedGroups({ tables: ['T'], objects: [q, m('A', 'B'), m('B', 'A'), { kind: 'macro', name: 'C', definition: { formatVersion: '1.0', items: [{ k: 'action', action: 'OpenQuery', args: { QueryName: 'Q' } }] } }] },
      [o('table', 'T'), o('query', 'Q'), o('macro', 'A'), o('macro', 'B'), o('macro', 'C')]);
    expect(g.map((x) => [x.id, x.items.map((i) => i.name)])).toEqual([['table:T', ['T', 'Q', 'C']], ['unrelated', ['A', 'B']]]);
  });
  it('a name differing by case or accent still links', () => {
    const q: DepObject = { kind: 'query', name: 'Q', definition: { formatVersion: '1.0', sql: 'SELECT * FROM clients' } };
    const g = relatedGroups({ tables: ['Clients'], objects: [q] }, [o('table', 'Clients'), o('query', 'Q')]);
    expect(g[0]!.items.map((i) => i.name)).toEqual(['Clients', 'Q']);
  });
});

describe('relatedGroups', () => {
  const q = (name: string, sql: string): DepObject => ({ kind: 'query', name, definition: { formatVersion: '1.0', sql } });
  const w = { tables: ['Clients', 'Commandes'], objects: [
    q('QCmd', 'SELECT * FROM Clients INNER JOIN Commandes ON Clients.Id = Commandes.ClientId'),
    { kind: 'form' as const, name: 'FCli', definition: form({ kind: 'table', name: 'Clients' }) },
    { kind: 'report' as const, name: 'RQ', definition: form({ kind: 'query', name: 'QCmd' }) },
    { kind: 'macro' as const, name: 'M', definition: null },
  ] };
  const o = (kind: NavObject['kind'], name: string): NavObject => ({ kind, name });
  it('one group per table with its transitive dependents, then unrelated', () => {
    const objs = [o('table', 'Clients'), o('table', 'Commandes'), o('form', 'FCli'), o('query', 'QCmd'), o('report', 'RQ'), o('macro', 'M'), o('module', 'Mod')];
    const g = relatedGroups(w, objs);
    expect(g.map((x) => [x.id, x.items.map((i) => i.name)])).toEqual([
      ['table:Clients', ['Clients', 'FCli', 'QCmd', 'RQ']], ['table:Commandes', ['Commandes', 'QCmd', 'RQ']], ['unrelated', ['M', 'Mod']]]);
    expect(g[0].label).toBe('Clients');
    expect(g[2].label).toEqual({ key: 'nav.group.unrelated' });
  });
});
