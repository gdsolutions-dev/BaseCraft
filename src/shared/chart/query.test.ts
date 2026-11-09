import type { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { createTable } from '../../main/db/schema';
import { pageQuerySource } from '../../main/query/source';
import { Session } from '../../main/session';
import { localeInfo } from '../locale-format';
import { parseSql } from '../query/sql-parser';
import type { SourceField } from '../record-source';
import { f, t } from '../test-fixtures';
import { buildChartQuery, CHART_MAX_POINTS } from './query';
import { readChartSpec, type ChartSpec } from './spec';

const fld = (name: string, type: SourceField['type'] = 'shortText'): SourceField => ({ name, type, props: { type } as SourceField['props'] });
const FIELDS = [fld('Client'), fld('Mois', 'dateTime'), fld('Montant', 'number'), fld('Nom')];
const spec = (p: Partial<ChartSpec>): ChartSpec => ({ ...readChartSpec({}), ...p });
const T = { kind: 'table', name: 'Cmd' } as const;
const sum = { field: 'Montant', agg: 'sum' } as const;

describe('forme du SQL', () => {
  it('somme par client', () => {
    expect(buildChartQuery(spec({ axis: ['Client'], values: [sum] }), T, FIELDS)).toEqual({
      sql: `SELECT TOP ${CHART_MAX_POINTS + 1} [Client], Sum([Montant]) AS [SumOfMontant]\nFROM [Cmd]\nGROUP BY [Client]\nORDER BY [Client];`,
      columns: [{ role: 'category', field: 'Client', name: 'Client' }, { role: 'value', field: 'Montant', name: 'SumOfMontant' }] });
  });
  it('tout none : ni GROUP BY ni agrégat', () => {
    const { sql } = buildChartQuery(spec({ axis: ['Client'], values: [{ field: 'Montant', agg: 'none' }] }), T, FIELDS);
    expect(sql).not.toMatch(/GROUP BY|ORDER BY|Sum/);
  });
  it('none mêlé à avg : Sum et Avg', () => {
    const { sql } = buildChartQuery(spec({ axis: ['Client'], values: [{ field: 'Montant', agg: 'none' }, { field: 'Montant', agg: 'avg' }] }), T, FIELDS);
    expect(sql).toContain('Sum([Montant]) AS [SumOfMontant], Avg([Montant]) AS [AvgOfMontant]');
  });
  it('count', () => expect(buildChartQuery(spec({ axis: ['Client'], values: [{ field: 'Nom', agg: 'count' }] }), T, FIELDS).sql).toContain('Count([Nom])'));
  it('casse corrigée, légende : colonnes dans l\'ordre, une seule valeur', () => {
    const q = buildChartQuery(spec({ axis: ['mois'], legend: 'client', values: [{ field: 'montant', agg: 'sum' }, { field: 'Nom', agg: 'count' }] }), T, FIELDS);
    expect(q.columns.map((c) => c.role)).toEqual(['category', 'legend', 'value']);
    expect(q.sql).toContain('GROUP BY [Mois], [Client]');
    expect(q.sql).not.toContain('Count');
  });
  it('plusieurs champs d\'axe : libellé joint par " / "', () => {
    const q = buildChartQuery(spec({ axis: ['Client', 'Nom'], values: [sum] }), T, FIELDS);
    expect(q.sql).toContain('[Client] & " / " & [Nom] AS [Client / Nom]');
    expect(q.sql).toContain('GROUP BY [Client], [Nom]');
  });
  it('champ inconnu, 0 valeur, source invalide', () => {
    expect(() => buildChartQuery(spec({ axis: ['Nope'], values: [sum] }), T, FIELDS)).toThrow('bc:notFound');
    expect(() => buildChartQuery(spec({ axis: ['Client'] }), T, FIELDS)).toThrow('bc:invalidArgument');
    expect(() => buildChartQuery(spec({ values: [sum] }), { kind: 'sql', sql: 'UPDATE Cmd SET Montant = 0' }, FIELDS)).toThrow('bc:invalidArgument');
    expect(() => buildChartQuery(spec({ values: [sum] }), { kind: 'sql', sql: 'pas du sql (' }, FIELDS)).toThrow('bc:invalidArgument');
  });
  it('source requête et sql (table dérivée)', () => {
    expect(buildChartQuery(spec({ values: [sum] }), { kind: 'query', name: 'Q' }, FIELDS).sql).toContain('FROM [Q]');
    expect(buildChartQuery(spec({ values: [sum] }), { kind: 'sql', sql: 'SELECT Client, Montant FROM Cmd' }, FIELDS).sql).toMatch(/FROM \(SELECT[^)]*\) AS \[src\]/);
  });
  it('source sql avec un paramètre linkN : refusée si liée, sinon construite', () => {
    const src = { kind: 'sql', sql: 'PARAMETERS link0 Text; SELECT Client, Montant FROM Cmd WHERE Client = [link0]' } as const;
    expect(() => buildChartQuery(spec({ axis: ['Client'], values: [sum] }), src, FIELDS, { fields: ['Client'] })).toThrow('bc:invalidArgument');
    expect(buildChartQuery(spec({ axis: ['Client'], values: [sum] }), src, FIELDS).sql).toContain('FROM (SELECT');
  });
  it('dateGroup sur axe texte : groupement simple par [Client]', () => {
    const month = buildChartQuery(spec({ axis: ['Client'], dateGroup: 'month', values: [sum] }), T, FIELDS);
    expect(month).toEqual(buildChartQuery(spec({ axis: ['Client'], dateGroup: 'none', values: [sum] }), T, FIELDS));
    expect(month.sql).toContain('GROUP BY [Client]');
  });
  it('liaison : paramètres link0, jamais dans le texte', () => {
    const { sql } = buildChartQuery(spec({ axis: ['Client'], values: [sum] }), T, FIELDS, { fields: ['client', 'Montant'] });
    expect(sql.startsWith('PARAMETERS [link0] Text, [link1] ')).toBe(true);
    expect(sql).toContain('WHERE [Client] = [link0] And [Montant] = [link1]');
  });
});

describe('nom de champ hostile', () => {
  const evil = "a]b'; DROP TABLE Cmd; --";
  it('imprimé entre crochets, une seule instruction select', () => {
    const { sql } = buildChartQuery(spec({ axis: [evil], values: [sum] }), T, [...FIELDS, fld(evil)]);
    const q = parseSql(sql);
    expect(q.body.k).toBe('select');
    if (q.body.k === 'select') expect(q.body.groupBy).toEqual([{ k: 'id', name: evil }]);
    expect(sql.replace(/\[(?:[^\]]|\]\])*\]/g, '')).not.toMatch(/DROP/);
  });
  it('source sql hostile : deux instructions refusées', () => {
    expect(() => buildChartQuery(spec({ values: [sum] }), { kind: 'sql', sql: 'SELECT Client FROM Cmd; DELETE FROM Cmd' }, FIELDS)).toThrow('bc:invalidArgument');
  });
  it('absent des champs : refusé', () => {
    expect(() => buildChartQuery(spec({ axis: [evil], values: [sum] }), T, FIELDS)).toThrow('bc:notFound');
  });
});

describe('exécution', () => {
  const session = Session.create(`${process.env.TEMP ?? '.'}/chartq-${process.pid}.basecraft`, { appVersion: '0.0.0', region: 'fr-FR', sessionId: 'a',
    probe: { platform: 'win32', env: {}, homedir: 'C:\\x', windowsDriveType: () => 3 } });
  const db = (session as unknown as { db: DatabaseSync }).db;
  createTable(db, t('Cmd', [f('Client', 'shortText'), f('Mois', 'dateTime'), f('Montant', 'number', { numberSize: 'double' })]));
  const ins = db.prepare('INSERT INTO "Cmd" ("Client","Mois","Montant") VALUES (?,?,?)');
  for (const r of [['A', '2026-03-15 00:00:00', 1], ['A', '2026-03-20 00:00:00', 2], ['B', '2026-01-02 00:00:00', 4], ['B', '2026-05-09 00:00:00', 8]]) ins.run(...r);
  const ctx = { info: localeInfo('fr-FR'), writeSeq: () => 0 };
  const run = (s: Partial<ChartSpec>, link?: { fields: string[] }, params?: Record<string, string>) => {
    const q = buildChartQuery(spec(s), T, FIELDS, link);
    return pageQuerySource(db, { kind: 'sql', sql: q.sql }, { offset: 0, limit: 100, ...(params ? { params } : {}) }, ctx).rows;
  };
  it.each([['year', ['2026']], ['quarter', ['2026-Q1', '2026-Q2']], ['month', ['2026-01', '2026-03', '2026-05']],
    ['day', ['2026-01-02', '2026-03-15', '2026-03-20', '2026-05-09']]] as const)(
    'groupement %s', (g, labels) => expect(run({ axis: ['Mois'], dateGroup: g, values: [sum] }).map((r) => r[0])).toEqual(labels));
  it('totaux', () => {
    expect(run({ axis: ['Client'], values: [sum] })).toEqual([['A', 3], ['B', 12]]);
    expect(run({ axis: ['Mois', 'Client'], dateGroup: 'month', values: [sum] }).map((r) => r[0])).toEqual(['2026-01 / B', '2026-03 / A', '2026-05 / B']);
    expect(run({ axis: ['Mois'], dateGroup: 'month', legend: 'Client', values: [sum] }).map((r) => r.slice(0, 2).join('|'))).toEqual(['2026-01|B', '2026-03|A', '2026-05|B']);
  });
  it('liaison par paramètre', () => expect(run({ axis: ['Client'], values: [sum] }, { fields: ['Client'] }, { link0: 'B' })).toEqual([['B', 12]]));
  it('un nom hostile ne change aucune ligne', () => {
    expect(() => buildChartQuery(spec({ axis: ['Client]; DELETE FROM Cmd; --'], values: [sum] }), T, FIELDS)).toThrow('bc:notFound');
    expect(db.prepare('SELECT COUNT(*) n FROM "Cmd"').get()).toEqual({ n: 4 });
  });
});
