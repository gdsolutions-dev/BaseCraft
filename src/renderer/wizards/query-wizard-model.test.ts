import { describe, expect, it } from 'vitest';
import { parseSql } from '../../shared/query/sql-parser';
import { printSql } from '../../shared/query/print';
import { crosstabQuery, duplicatesQuery, simpleQuery, unmatchedQuery } from './query-wizard-model';

const ok = (sql: string) => { expect(printSql(parseSql(sql))).toBe(sql); return sql; };   // the printed text reads back as itself
const f = (name: string, type: 'shortText' | 'currency' | 'number' = 'shortText') => ({ name, type });

describe('Query Wizard model', () => {
  it('Simple: detail', () => {
    expect(ok(simpleQuery('Clients', [f('Nom'), f('Ville')]))).toBe('SELECT [Nom], [Ville]\nFROM [Clients];');
  });
  it('Simple: summary groups the text fields, aggregates the picked numeric ones and counts', () => {
    const sql = ok(simpleQuery('Ventes', [f('Client'), f('Montant', 'currency'), f('Qté', 'number')], { aggs: { Montant: ['Sum', 'Max'] }, count: true }));
    expect(sql).toBe('SELECT [Client], Sum([Montant]) AS [SumOfMontant], Max([Montant]) AS [MaxOfMontant], Count(*) AS [CountOfVentes]\nFROM [Ventes]\nGROUP BY [Client];');
  });
  it('quotes awkward names', () => {
    expect(ok(simpleQuery('Mes ventes', [f('Prix ]x')]))).toBe('SELECT [Prix ]]x]\nFROM [Mes ventes];');
  });
  it('Find Duplicates joins the grouped duplicates back', () => {
    expect(ok(duplicatesQuery('Clients', ['Nom', 'Ville'], ['Id', 'Nom']))).toBe(
      'SELECT [Clients].[Nom], [Clients].[Ville], [Clients].[Id]\nFROM [Clients] INNER JOIN (SELECT [Nom], [Ville]\nFROM [Clients]\nGROUP BY [Nom], [Ville]\nHAVING Count(*) > 1) AS [Dup] ON [Clients].[Nom] = [Dup].[Nom] And [Clients].[Ville] = [Dup].[Ville]\nORDER BY [Clients].[Nom], [Clients].[Ville];');
  });
  it('Find Unmatched', () => {
    expect(ok(unmatchedQuery('Clients', 'Id', 'Ventes', 'ClientId', ['Nom']))).toBe(
      'SELECT [Clients].[Nom]\nFROM [Clients] LEFT JOIN [Ventes] ON [Clients].[Id] = [Ventes].[ClientId]\nWHERE [Ventes].[ClientId] Is Null;');
  });
  it('Crosstab', () => {
    ok(crosstabQuery('Ventes', ['Client'], 'Mois', 'Montant', 'Sum'));
  });
});
