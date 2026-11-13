import { describe, expect, it } from 'vitest';
import type { Relation } from '../../shared/api';
import type { FieldDef, TableDesign } from '../../shared/field-types';
import { analyzePerformance, filteredFields } from './performance';

const f = (name: string, extra: Partial<FieldDef['props']> = {}): FieldDef => ({ name, props: { type: 'shortText', required: false, indexed: 'no', primaryKey: false, ...extra } });
const clients: TableDesign = { name: 'Clients', fields: [f('Id', { type: 'autoNumber', primaryKey: true }), f('Ville'), f('Nom', { indexed: 'yesDuplicates' })] };
const commandes: TableDesign = { name: 'Commandes', fields: [f('Id', { type: 'autoNumber', primaryKey: true }), f('ClientId', { type: 'number' }), f('Date')] };
const notes: TableDesign = { name: 'Notes', fields: [f('Texte')] };
const rel: Relation = { name: 'R1', parentTable: 'Clients', parentFields: ['Id'], childTable: 'Commandes', childFields: ['ClientId'], enforce: true, cascadeUpdate: false, cascadeDelete: false, joinType: 1 };

describe('performance analyzer', () => {
  it('finds the fields a query filters or joins on, through aliases, and leaves subqueries to their own SELECT', () => {
    const sql = "SELECT * FROM Clients AS c INNER JOIN Commandes AS o ON c.Id = o.ClientId WHERE c.Ville = 'Lyon' AND o.Date > #2020-01-01# AND c.Id IN (SELECT ClientId FROM Commandes WHERE Date < #2021-01-01#)";
    const got = filteredFields(sql, [clients, commandes]);
    expect(got).toContainEqual({ table: 'Clients', field: 'Ville' });
    expect(got).toContainEqual({ table: 'Commandes', field: 'ClientId' });
    expect(got).toContainEqual({ table: 'Commandes', field: 'Date' });
    expect(got.length).toBe(4);   // Clients.Id too; each pair once
    expect(filteredFields('nonsense', [clients])).toEqual([]);
  });
  it('suggests a key, the index of a relation and those of the saved queries, each field once', () => {
    const s = analyzePerformance({ tables: [clients, commandes, notes], relations: [rel], queries: [
      { name: 'QLyon', sql: "SELECT * FROM Clients WHERE Ville = 'Lyon' AND Nom = 'x'" }, { name: 'QClient', sql: 'SELECT * FROM Commandes WHERE ClientId = 1 AND Date > #2020-01-01#' }] });
    expect(s).toEqual([
      { kind: 'noPrimaryKey', table: 'Notes' },
      { kind: 'relationIndex', table: 'Commandes', field: 'ClientId', relation: 'R1' },
      { kind: 'queryIndex', table: 'Clients', field: 'Ville', query: 'QLyon' },
      { kind: 'queryIndex', table: 'Commandes', field: 'Date', query: 'QClient' }]);
  });
  it('nothing to say about an indexed base', () => {
    expect(analyzePerformance({ tables: [clients], relations: [], queries: [{ name: 'Q', sql: 'SELECT * FROM Clients WHERE Id = 1 AND Nom = 2' }] })).toEqual([]);
  });
});
