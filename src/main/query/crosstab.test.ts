import { afterEach, beforeEach, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import type { RiskProbe } from '../db/location-risk';
import { createTable } from '../db/schema';
import { Session } from '../session';
import type { CellInput } from '../../shared/coerce';
import type { Value } from '../../shared/expr/ast';
import { toSerial, toText } from '../../shared/expr/library';
import { localeInfo } from '../../shared/locale-format';
import type { SourcePageRequest } from '../../shared/record-source';
import { f, t } from '../../shared/test-fixtures';
import { describeQuerySource, pageQuerySource, sourceLookupRows } from './source';
import { seedSales, seedSalesRelation } from './test-db';

const probe: RiskProbe = { platform: 'win32', env: {}, homedir: 'C:\\Users\\x', windowsDriveType: () => 3 };
let dir: string;
let session: Session;
let db: DatabaseSync;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bcx-'));
  session = Session.create(path.join(dir, 'test.basecraft'), { appVersion: '0.0.0', region: 'fr-FR', probe, sessionId: 'a' });
  db = (session as unknown as { db: DatabaseSync }).db;
  seedSales(db);
  seedSalesRelation(db);
});
afterEach(() => {
  session.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

const saveQ = (name: string, sql: string) => expect(session.saveObject('query', name, { formatVersion: '1.0', sql }, null)).toEqual({ ok: true });
const ctx = (region: string) => ({ info: localeInfo(region), writeSeq: () => 0 });
function page(sql: string, params: Record<string, CellInput> = {}, region = 'fr-FR', req: Partial<SourcePageRequest> = {}) {
  const p = pageQuerySource(db, { kind: 'sql', sql }, { offset: 0, limit: 1000, params, ...req }, ctx(region));
  return { names: p.columns, rows: p.rows };
}
const describe = (sql: string, params?: Record<string, CellInput>) => describeQuerySource(db, { kind: 'sql', sql }, localeInfo('fr-FR'), params);
const dateOf = (iso: string): Value => ({ t: 'date', v: toSerial(`${iso} 00:00:00`) });

const QX = 'TRANSFORM Sum(Commandes.Montant) SELECT Clients.Nom, Sum(Commandes.Montant) AS Total FROM Clients INNER JOIN Commandes ON Clients.[N°] = Commandes.Client GROUP BY Clients.Nom PIVOT Month(Commandes.Le)';

it('sales by client and month, exact', () => expect(page(QX)).toEqual({ names: ['Nom', 'Total', '9', '10'], // Review Focus 3, 5: 9 before 10
  rows: [['Dupont', 10.2, null, 10.2], ['Durand', 99.99, 99.99, null], ['Martin', 0.3, null, 0.3]] }));

it("same totals as A3's Totals query", () => {
  const totals = pageQuerySource(db, { kind: 'sql', sql: 'SELECT Clients.Nom, Sum(Montant) AS Total FROM Clients INNER JOIN Commandes ON Clients.[N°] = Commandes.Client GROUP BY Clients.Nom ORDER BY Clients.Nom' },
    { offset: 0, limit: 100 }, ctx('fr-FR')).rows;
  expect(page(QX).rows.map((r) => r.slice(0, 2))).toEqual(totals);
  expect(totals.find((r) => r[0] === 'Martin')![1]).toBe(0.3);
});

it('Format headings', () => expect(page(QX.replace('Month(Commandes.Le)', 'Format(Commandes.Le, "yyyy-mm")')).names).toEqual(['Nom', 'Total', '2026-09', '2026-10']));

it('empty cells: Count blank, Nz 0', () => { // Review Focus 5
  expect(page('TRANSFORM Count(*) SELECT Client FROM Commandes GROUP BY Client PIVOT Month(Le)').rows).toEqual([[1, null, 2], [2, null, 2], [3, 1, null]]);
  expect(page('TRANSFORM Nz(Sum(Montant), 0) SELECT Client FROM Commandes GROUP BY Client PIVOT Month(Le)').rows[0]).toEqual([1, 0, 10.2]);
});

it('a Null heading is <> and comes first', () => {
  db.exec(`INSERT INTO "Commandes" ("Client", "Montant") VALUES (1, 5)`);
  expect(page('TRANSFORM Sum(Montant) SELECT Client FROM Commandes GROUP BY Client PIVOT Month(Le)'))
    .toMatchObject({ names: ['Client', '<>', '9', '10'], rows: [[1, 5, null, 10.2], expect.anything(), expect.anything()] });
});

it('dates are chronological and named in the region', () => {
  expect(page('TRANSFORM Count(*) SELECT Client FROM Commandes GROUP BY Client PIVOT Le').names).toEqual(['Client', '30/09/2026', '01/10/2026', '05/10/2026', '21/10/2026']);
  expect(page('TRANSFORM Count(*) SELECT Client FROM Commandes GROUP BY Client PIVOT Le', {}, 'en-US').names![1]).toBe(toText(dateOf('2026-09-30') as Exclude<Value, null>, localeInfo('en-US')));
});

it('texts differing by case are one heading', () => {
  const { names } = page('TRANSFORM Count(*) SELECT Nom FROM Clients GROUP BY Nom PIVOT Ville');
  expect(names).toHaveLength(4);
  expect(names![1]).toMatch(/^lyon$/i);
  expect(names!.slice(2)).toEqual(['Lyôn', 'Paris']);
  // Lyon and LYON in one column: Dupont and Martin both counted there
  expect(page('TRANSFORM Count(*) SELECT Nom FROM Clients GROUP BY Nom PIVOT Ville').rows).toEqual([
    ['Dupont', 1, null, null], ['Durand', null, null, 1], ['Éric', null, 1, null], ['Martin', 1, null, null]]);
});

it('IN fixes the columns and their order; rows stay', () => {
  expect(page('TRANSFORM Sum(Montant) SELECT Client FROM Commandes GROUP BY Client PIVOT Month(Le) IN (10, 9, 11)')).toEqual({ names: ['Client', '10', '9', '11'],
    rows: [[1, 10.2, null, null], [2, 0.3, null, null], [3, null, 99.99, null]] });
  expect(page('TRANSFORM Sum(Montant) SELECT Client FROM Commandes GROUP BY Client PIVOT Month(Le) IN (11)').rows).toEqual([[1, null], [2, null], [3, null]]);
  expect(describe('TRANSFORM Sum(Montant) SELECT Client FROM Commandes WHERE Le >= [Du] GROUP BY Client PIVOT Month(Le) IN (10)').crosstab).toEqual({ headings: 'fixed' });
});

it('254 headings, then 255', () => { // Review Focus 3
  createTable(db, t('Big', [f('n', 'autoNumber'), f('k', 'number', { numberSize: 'longInteger' })]));
  db.exec('WITH RECURSIVE s(k) AS (SELECT 1 UNION ALL SELECT k + 1 FROM s WHERE k < 254) INSERT INTO "Big" ("k") SELECT k FROM s');
  expect(page('TRANSFORM Count(*) SELECT 1 AS Un FROM Big GROUP BY 1 PIVOT k').names).toHaveLength(255);
  db.exec('INSERT INTO "Big" ("k") VALUES (255)');
  expect(() => page('TRANSFORM Count(*) SELECT 1 AS Un FROM Big GROUP BY 1 PIVOT k')).toThrow(/bc:queryBind\|tooManyColumns\|256/);
  // fix m2: only 255 values are read for the refusal; its number counts them all
  db.exec('WITH RECURSIVE s(k) AS (SELECT 256 UNION ALL SELECT k + 1 FROM s WHERE k < 400) INSERT INTO "Big" ("k") SELECT k FROM s');
  expect(() => page('TRANSFORM Count(*) SELECT 1 AS Un FROM Big GROUP BY 1 PIVOT k')).toThrow(/bc:queryBind\|tooManyColumns\|401$/);
});

it('a heading named like a parameter never captures it (fix I1)', () => {
  db.exec(`INSERT INTO "Clients" ("Nom", "Ville") VALUES ('Zoé', 'Seuil'), ('Yves', 'Exclure')`);
  const having = 'TRANSFORM Count(*) SELECT Nom FROM Clients GROUP BY Nom HAVING Count(*) >= [Seuil] PIVOT Ville';
  expect(describe(having)).toMatchObject({ crosstab: { headings: 'needsParameters' }, parameters: [{ name: 'Seuil' }] });
  expect(describe(having, { Seuil: '1' })).toMatchObject({ parameters: [{ name: 'Seuil' }] });
  expect(describe(having, { Seuil: '1' }).fields.map((x) => x.name)).toContain('Seuil');
  expect(page(having, { Seuil: '1' }).rows).toHaveLength(6);
  expect(page(having, { Seuil: '2' }).rows).toEqual([]);
  // WHERE: the heading Exclure would make [Exclure] an aggregate column (aggregateInWhere) if it captured it
  const where = 'TRANSFORM Count(*) SELECT Nom FROM Clients WHERE Ville <> [Exclure] GROUP BY Nom PIVOT Ville';
  expect(page(where, { Exclure: 'Paris' }).names).toEqual(['Nom', 'Exclure', 'Lyon', 'Lyôn', 'Seuil']);
  expect(page(where, { Exclure: 'Paris' }).rows.map((r) => r[0])).not.toContain('Durand');
  // an IN literal named like a parameter
  const fixed = 'TRANSFORM Count(*) SELECT Nom FROM Clients GROUP BY Nom HAVING Count(*) >= [Seuil] PIVOT Ville IN ("Seuil", "Lyon")';
  expect(describe(fixed).parameters).toMatchObject([{ name: 'Seuil' }]);
  expect(page(fixed, { Seuil: '1' })).toMatchObject({ names: ['Nom', 'Seuil', 'Lyon'], rows: expect.arrayContaining([['Zoé', 1, null], ['Dupont', null, 1]]) });
});

it('a row alias equal to a heading in another region opens (fix m1)', () =>
  expect(page('TRANSFORM Sum(Montant) SELECT Client AS [1.5] FROM Commandes GROUP BY Client PIVOT Month(Le) IN (1.5)').names).toEqual(['1.5', '1,5']));

it('parameters: headings and cells from the same values', () => { // Review Focus 4
  const sql = 'TRANSFORM Sum(Montant) SELECT Client FROM Commandes WHERE Le >= [Du] GROUP BY Client PIVOT Month(Le)';
  expect(describe(sql)).toMatchObject({ fields: [expect.objectContaining({ name: 'Client' })], crosstab: { headings: 'needsParameters' }, parameters: [{ name: 'Du', type: 'dateTime' }] });
  expect(describe(sql).fields).toHaveLength(1);
  expect(describe(sql, { Du: '01/10/2026' }).fields.map((x) => x.name)).toEqual(['Client', '10']);
  expect(page(sql, { Du: '01/10/2026' })).toEqual({ names: ['Client', '10'], rows: [[1, 10.2], [2, 0.3]] });
});

it('a form reference is a parameter', () => expect(describe('TRANSFORM Count(*) SELECT Client FROM Commandes WHERE Le >= [Forms]![FCrit]![Du] GROUP BY Client PIVOT Month(Le)').parameters)
  .toEqual([{ name: '[Forms]![FCrit]![Du]', type: 'dateTime', props: expect.anything() }]));

it('sort and filter on a heading', () => {
  expect(page(QX, {}, 'fr-FR', { sort: [{ field: '10', dir: 'desc' }] }).rows.map((r) => r[0])).toEqual(['Dupont', 'Martin', 'Durand']);
  expect(page(QX, {}, 'fr-FR', { filter: [{ field: '9', criteria: 'Is Not Null' }] }).rows).toEqual([['Durand', 99.99, 99.99, null]]);
});

it('describe without parameters names the data headings; a data crosstab carries its columns on every page (R14)', () => {
  expect(describe(QX)).toMatchObject({ updatable: false, crosstab: { headings: 'data' } });
  expect(describe(QX).fields.map((x) => x.name)).toEqual(['Nom', 'Total', '9', '10']);
  db.exec(`INSERT INTO "Commandes" ("Client", "Montant", "Le") VALUES (1, 1, '2026-11-02 00:00:00')`);
  expect(page(QX).names).toEqual(['Nom', 'Total', '9', '10', '11']);
  expect(pageQuerySource(db, { kind: 'sql', sql: 'SELECT Nom FROM Clients' }, { offset: 0, limit: 1 }, ctx('fr-FR')).columns).toBeUndefined();
});

it('a sort or filter on a heading gone (its last row deleted) is dropped: the page carries the new columns (R14, final review M2)', () => {
  db.exec('DELETE FROM "Commandes" WHERE "Client" = 3'); // Durand's order, the only one in September
  const gone = { sort: [{ field: '9', dir: 'asc' as const }], filter: [{ field: '9', criteria: 'Is Not Null' }] };
  expect(page(QX, {}, 'fr-FR', gone)).toEqual({ names: ['Nom', 'Total', '10'], rows: [['Dupont', 10.2, 10.2], ['Martin', 0.3, 0.3]] });
  expect(page(QX, {}, 'fr-FR', { limit: 0, filter: gone.filter }).names).toEqual(['Nom', 'Total', '10']); // the count (Refresh)
  expect(() => page('SELECT Nom FROM Clients', {}, 'fr-FR', { sort: gone.sort })).toThrow('bc:notFound'); // not a crosstab: as before
});

it.each([
  ['TRANSFORM Montant SELECT Client FROM Commandes GROUP BY Client PIVOT Le', 'crosstabValue'],
  ['TRANSFORM Sum(Montant) SELECT Client FROM Commandes GROUP BY Client PIVOT Sum(Montant)', 'pivotAggregate'],
  ['TRANSFORM Sum(Montant) SELECT Sum(Montant) AS T FROM Commandes PIVOT Le', 'crosstabRowHeading'],
  ['TRANSFORM Sum(Montant) SELECT Client AS [10] FROM Commandes GROUP BY Client PIVOT Month(Le)', 'duplicateOutput'],
])('%s', (sql, code) => expect(() => page(sql)).toThrow(new RegExp(`bc:queryBind\\|${code}`)));

it('a crosstab is no source', () => {
  saveQ('QX', QX);
  expect(() => describe('SELECT * FROM QX')).toThrow(/bc:queryBind\|crosstabAsSource\|QX/);
  expect(() => describe('SELECT Nom FROM Clients WHERE Exists (SELECT * FROM QX)')).toThrow(/bc:queryBind\|crosstabAsSource\|QX/);
  expect(() => sourceLookupRows(db, { kind: 'query', name: 'QX' }, 10, localeInfo('fr-FR'))).toThrow(/bc:queryBind\|crosstabAsSource\|QX/); // a lookup Row Source
  expect(() => session.saveObject('query', 'QY', { formatVersion: '1.0', sql: 'SELECT * FROM QX' }, null)).toThrow(/crosstabAsSource/);
  // a saved crosstab opened itself is a datasheet
  expect(describeQuerySource(db, { kind: 'query', name: 'QX' }, localeInfo('fr-FR')).fields).toHaveLength(4);
});
