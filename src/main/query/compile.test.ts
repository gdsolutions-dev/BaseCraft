import { afterAll, beforeAll, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { createBaseFile, openBaseFile, REGISTERED_FUNCTIONS } from '../db/file-format';
import { createTable, isTableName, tableDesign } from '../db/schema';
import type { SqlValue } from '../../shared/coerce';
import { bindQuery, type QueryCatalog } from '../../shared/query/bind';
import { parseSql } from '../../shared/query/sql-parser';
import { f, t } from '../../shared/test-fixtures';
import { authorizedPrepare } from './authorizer';
import { compileSelect, orderKeys } from './compile';
import { seedSales } from './test-db';

const QUERIES: Record<string, string> = {
  QLyon: 'SELECT * FROM Clients WHERE Ville = "Lyon";',
  QQLyon: 'SELECT * FROM QLyon;',
};
let dir: string;
let db: DatabaseSync;
const catalog: QueryCatalog = {
  table: (name) => (isTableName(db, name) ? tableDesign(db, name) : null),
  query: (name) => Object.entries(QUERIES).find(([n]) => n.toLowerCase() === name.toLowerCase())?.[1] ?? null,
};
const compile = (sql: string, values: Record<string, SqlValue> = {}) => compileSelect(bindQuery(parseSql(sql), catalog), values, { locale: 'fr-FR' });
/** Rows as arrays, without the rowid column. */
const run = (sql: string, values?: Record<string, SqlValue>): unknown[][] => {
  const c = compile(sql, values);
  const stmt = authorizedPrepare(db, c.sql);
  stmt.setReturnArrays(true);
  return (stmt.all(...c.params) as unknown as unknown[][]).map((r) => (c.hasRowid ? r.slice(1) : r));
};

beforeAll(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bcq-'));
  const p = path.join(dir, 'test.basecraft');
  createBaseFile(p, '0.0.0');
  db = openBaseFile(p, 'write', '0.0.0').db;
  seedSales(db);
  createTable(db, t('D', [f('v', 'number', { numberSize: 'decimal', precision: 18, scale: 2 })]));
  const d = db.prepare('INSERT INTO "D" ("v") VALUES (?)');
  for (const v of ['0.10', '0.20', '0.10']) d.run(v);
});
afterAll(() => {
  db.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

it('join + param + order', () => expect(run('SELECT Nom, Montant FROM Clients INNER JOIN Commandes ON Clients.[N°] = Commandes.Client WHERE Le >= [Du] ORDER BY Montant DESC, Nom',
  { Du: '2026-10-05 00:00:00' })).toEqual([['Martin', 0.2], ['Dupont', 0.1], ['Martin', 0.1]]));
it('currency totals are exact', () => {
  expect(run('SELECT Client, Sum(Montant) FROM Commandes GROUP BY Client ORDER BY Client')).toEqual([[1, 10.2], [2, 0.3], [3, 99.99]]);
  expect(run('SELECT Sum(Montant) FROM Commandes WHERE Montant < 1')).toEqual([[0.4]]);
  expect(run('SELECT Avg(Montant) FROM Commandes WHERE Client = 2')).toEqual([[0.15]]);
});
it('decimal totals are exact at the field scale', () => {
  /* D(v Number Decimal precision 18 scale 2): 0.10, 0.20, 0.10 */ expect(run('SELECT Sum(v) FROM D')).toEqual([[0.4]]);
});
it('StDev and Var through the shared accumulator', () => expect(run('SELECT Var(Montant) FROM Commandes WHERE Client = 2')[0][0]).toBeCloseTo(0.005, 12));
it('grouping is case-insensitive, accent-sensitive', () => expect(run('SELECT Count(*) FROM Clients GROUP BY Ville ORDER BY Ville')).toEqual([[2], [1], [1]]));
it('DISTINCT and Min follow Access text rules', () => {
  expect(run('SELECT DISTINCT Ville FROM Clients').length).toBe(3);
  expect(run('SELECT Min(Ville) FROM Clients WHERE Ville Like "l*"')[0][0]).toMatch(/^lyon$/i);
});
it('In (SELECT …) compares like Access', () => expect(run('SELECT Nom FROM Clients WHERE Ville In (SELECT Ville FROM Clients WHERE [N°] = 2) ORDER BY Nom').flat()).toEqual(['Dupont', 'Martin']));
it('French sort', () => expect(run('SELECT Nom FROM Clients ORDER BY Nom').flat()).toEqual(['Dupont', 'Durand', 'Éric', 'Martin']));
it('TOP without ties', () => expect(run('SELECT TOP 1 [N°] FROM Commandes ORDER BY Montant, [N°]').flat()).toEqual([2]));
it('TOP keeps ties', () => expect(run('SELECT TOP 1 [N°] FROM Commandes ORDER BY Montant').flat().sort()).toEqual([2, 5]));
it('TOP PERCENT', () => expect(run('SELECT TOP 40 PERCENT [N°] FROM Commandes ORDER BY Montant DESC').flat()).toEqual([4, 1]));
it('subqueries', () => {
  expect(run('SELECT Nom FROM Clients WHERE [N°] In (SELECT Client FROM Commandes WHERE Montant > 50)').flat()).toEqual(['Durand']);
  expect(run('SELECT Nom FROM Clients AS C WHERE Not Exists (SELECT * FROM Commandes WHERE Client = C.[N°])').flat()).toEqual(['Éric']);
  expect(run('SELECT Nom, (SELECT Max(Montant) FROM Commandes WHERE Client = C.[N°]) FROM Clients AS C ORDER BY Nom')[0]).toEqual(['Dupont', 10.1]);
});
it('left join keeps unmatched parents', () => expect(run('SELECT Nom FROM Clients LEFT JOIN Commandes ON Clients.[N°] = Commandes.Client WHERE Commandes.[N°] Is Null').flat()).toEqual(['Éric']));
it('saved query as source', () => { /* QLyon = SELECT * FROM Clients WHERE Ville = "Lyon" */ expect(run('SELECT Count(*) FROM QLyon')).toEqual([[2]]); });
it('computed values come back in stored form', () => expect(run('SELECT Le + 1, [Le] > #2026-10-04# FROM Commandes WHERE [N°] = 2')).toEqual([['2026-10-06 00:00:00', 1]]));
it('authorizer is a second line of defence', () => {
  for (const sql of ['SELECT * FROM bc_meta', 'SELECT * FROM "BC_OBJECTS"', 'SELECT * FROM sqlite_master', 'ATTACH \'x\' AS y', 'PRAGMA user_version',
    'CREATE TABLE z (a)', 'DROP TABLE Clients', 'SELECT load_extension(\'x\')', 'SELECT sqlite_version()', 'DELETE FROM bc_relations'])
    expect(() => authorizedPrepare(db, sql)).toThrow(/bc:invalidQuery/);
  expect(() => authorizedPrepare(db, 'SELECT count(*) FROM "Clients"')).not.toThrow();
  expect(() => authorizedPrepare(db, 'SELECT row_number() OVER () FROM "Clients"')).not.toThrow();
  expect(() => authorizedPrepare(db, 'SELECT bc_fold("Nom") FROM "Clients"')).not.toThrow();
  expect(isTableName(db, 'Clients')).toBe(true);
});
it('authorizer is cleared after prepare', () => { try { authorizedPrepare(db, 'PRAGMA x') } catch { /* refused */ } expect(() => db.prepare('PRAGMA user_version').get()).not.toThrow(); });

// ---- Beyond the brief ----

it('every bc_* function and aggregate is registered and allowed', () => {
  for (const name of ['bc_fold', 'bc_out', 'bc_gkey', 'bc_skey', 'bc_insub', 'bc_list', 'bc_one', 'bc_agg_Sum', 'bc_agg_VarP']) expect(REGISTERED_FUNCTIONS.has(name)).toBe(true);
  expect(() => authorizedPrepare(db, 'SELECT bc_agg_Sum(\'fr-FR\', NULL, 1), bc_list(1), bc_one(1)')).not.toThrow();
});
it('rowid of the key table first, through a saved query too', () => {
  for (const sql of ['SELECT Nom FROM Clients WHERE Ville = "Lyon" ORDER BY Nom', 'SELECT Nom FROM QLyon ORDER BY Nom', 'SELECT Nom FROM QQLyon AS Q ORDER BY Nom']) {
    const c = compile(sql);
    expect(c.hasRowid).toBe(true);
    const stmt = authorizedPrepare(db, c.sql);
    stmt.setReturnArrays(true);
    expect(stmt.all(...c.params)).toEqual([[1, 'Dupont'], [2, 'Martin']]);
  }
  expect(compile('SELECT DISTINCT Nom FROM Clients').hasRowid).toBe(false);
});
it('empty groups and errors in a total', () => {
  expect(run('SELECT Sum(Montant), Avg(Montant), Count(Montant), Count(*), Min(Le) FROM Commandes WHERE Montant > 1000')).toEqual([[null, null, 0, 0, null]]);
  expect(run('SELECT Sum(Nom) FROM Clients')).toEqual([[null]]); // typeMismatch: #Error in Access, Null here
});
it('UNION dedups like Access; UNION ALL keeps every row; ORDER BY names the output', () => {
  expect(run('SELECT Ville FROM Clients UNION SELECT Ville FROM Clients WHERE [N°] = 3 ORDER BY Ville DESC').map((r) => String(r[0]).toLowerCase())).toEqual(['paris', 'lyôn', 'lyon']);
  expect(run('SELECT Nom FROM Clients UNION ALL SELECT Nom FROM Clients WHERE [N°] = 3 ORDER BY Nom').flat()).toEqual(['Dupont', 'Durand', 'Durand', 'Éric', 'Martin']);
});
it('DISTINCT on a totals query, ordered and limited', () => {
  expect(run('SELECT DISTINCT Count(*) FROM Clients GROUP BY Ville ORDER BY Count(*) DESC')).toEqual([[2], [1]]);
  expect(run('SELECT DISTINCT TOP 1 Count(*) FROM Clients GROUP BY Ville ORDER BY Count(*)')).toEqual([[1]]);
});
it('TOP without ORDER BY', () => {
  expect(run('SELECT TOP 2 [N°] FROM Commandes').length).toBe(2);
  expect(run('SELECT TOP 40 PERCENT [N°] FROM Commandes').length).toBe(2);
});
it('output aliases, derived tables, right joins', () => {
  expect(run('SELECT Montant * 2 AS D, D + 1 FROM Commandes WHERE [N°] = 2')).toEqual([[0.2, 1.2]]);
  expect(run('SELECT X.T FROM (SELECT Client, Sum(Montant) AS T FROM Commandes GROUP BY Client) AS X WHERE X.T > 1 ORDER BY X.T')).toEqual([[10.2], [99.99]]);
  expect(run('SELECT Nom FROM Commandes RIGHT JOIN Clients ON Clients.[N°] = Commandes.Client WHERE Commandes.[N°] Is Null').flat()).toEqual(['Éric']);
});
it('a scalar subquery with several rows fails the query, as in Access', () => {
  expect(() => run('SELECT Nom, (SELECT Montant FROM Commandes WHERE Client = C.[N°]) FROM Clients AS C')).toThrow(/bc:invalidQuery\|subqueryRows/);
});
it('expression heights add up across subqueries: tooComplex or a prepared statement, never SQLite\'s raw error', () => {
  const chain = (n: number): string => Array.from({ length: n }, () => '[Montant]').join(' + ');
  for (const n of [50, 300, 440, 600, 890, 1500]) {
    for (const sql of [
      `SELECT Nom, (SELECT Max(${chain(n)}) FROM Commandes WHERE Client = C.[N°]) FROM Clients AS C`,
      `SELECT Nom FROM Clients AS C WHERE Exists (SELECT * FROM Commandes WHERE Client = C.[N°] AND ${chain(n)} > 0) ORDER BY Nom`,
      `SELECT Nom FROM Clients WHERE [N°] + ${chain(n).replaceAll('[Montant]', '1')} In (SELECT ${chain(n)} FROM Commandes ORDER BY ${chain(n)})`,
      `SELECT TOP 1 ${chain(n)} FROM Commandes ORDER BY ${chain(n)}`,
      `SELECT DISTINCT Sum(${chain(n)}) FROM Commandes GROUP BY Client ORDER BY Sum(${chain(n)})`,
    ]) {
      let c;
      try { c = compile(sql); } catch (e) { expect(e).toMatchObject({ code: 'tooComplex' }); continue; }
      expect(() => authorizedPrepare(db, c.sql), `${n}: ${sql.slice(0, 40)}`).not.toThrow();
    }
  }
});
// ---- Fix round 1 ----

it('ties are broken as compareText orders: accents before case (I1)', () => {
  createTable(db, t('Z', [f('Nom', 'shortText')]));
  const z = db.prepare('INSERT INTO "Z" ("Nom") VALUES (?)');
  for (const v of ['Zoé', 'zoe', 'ZOÉ', 'Zoe']) z.run(v);
  expect(run('SELECT Nom FROM Z ORDER BY Nom').flat().map((x) => String(x).toLowerCase())).toEqual(['zoe', 'zoe', 'zoé', 'zoé']);
  expect(run('SELECT TOP 1 Nom FROM Z ORDER BY Nom DESC').flat().map((x) => String(x).toLowerCase())).toEqual(['zoé', 'zoé']);
  expect(run('SELECT TOP 1 Nom FROM Clients ORDER BY Ville').flat().sort()).toEqual(['Dupont', 'Martin']); // Lyon and LYON tie
  // orderKeys (a page sorted by a column) breaks ties the same way
  const stmt = authorizedPrepare(db, `SELECT "Nom" FROM "Z" ORDER BY ${orderKeys('"Nom"', 'shortText', 'asc')}`);
  stmt.setReturnArrays(true);
  expect(stmt.all().flat().map((x) => String(x).toLowerCase())).toEqual(['zoe', 'zoe', 'zoé', 'zoé']);
});
it('GROUP BY and DISTINCT put Empty (Nz without a replacement) with "", as compare does (M1)', () => {
  createTable(db, t('E', [f('T', 'shortText'), f('I', 'number')]));
  const e = db.prepare('INSERT INTO "E" ("T", "I") VALUES (?, ?)');
  for (const r of [[null, null], ['', 0], ['x', 1]]) e.run(...r);
  expect(run('SELECT Count(*) FROM E GROUP BY Nz(T)')).toHaveLength(2);
  expect(run('SELECT DISTINCT Nz(T) FROM E')).toHaveLength(2);
});
it('the authorizer refuses VACUUM INTO, table-valued pragmas, dbstat and any table that is no real table of the base (M2)', () => {
  for (const sql of ['VACUUM INTO \'copie.basecraft\'', 'VACUUM', 'SELECT * FROM pragma_table_info(\'bc_objects\')', 'SELECT name FROM pragma_table_list',
    'SELECT * FROM dbstat', 'SELECT * FROM json_each(\'[1]\')', 'SELECT * FROM temp.sqlite_schema', 'SELECT * FROM "Clients" WHERE "N°" IN (SELECT cid FROM pragma_table_info(\'Clients\'))'])
    expect(() => authorizedPrepare(db, sql), sql).toThrow(/bc:invalidQuery/);
  expect(fs.existsSync(path.join(process.cwd(), 'copie.basecraft'))).toBe(false);
  expect(() => authorizedPrepare(db, 'SELECT x.c FROM (SELECT "Nom" AS c FROM "Clients") AS x')).not.toThrow();
});
it('the authorizer allows only a SELECT: writes go through the write layer (rules, relations, cascades), never a compiled statement', () => {
  for (const sql of [`INSERT INTO "Clients" ("Nom") VALUES ('x')`, `UPDATE "Clients" SET "Nom" = 'x'`, 'DELETE FROM "Clients"',
    'INSERT INTO "Clients" ("Nom") SELECT "Nom" FROM "Clients"', 'WITH x AS (SELECT 1) DELETE FROM "Clients"'])
    expect(() => authorizedPrepare(db, sql), sql).toThrow(/^bc:invalidQuery$/);
  expect(() => authorizedPrepare(db, 'WITH x AS (SELECT "Nom" FROM "Clients") SELECT * FROM x')).not.toThrow();
});
it('SQLite limits are typed errors, never raw (M3)', () => {
  const tables = Array.from({ length: 65 }, (_, i) => `Clients AS T${i}`).join(', ');
  const parts = Array.from({ length: 501 }, () => 'SELECT Nom FROM Clients').join(' UNION ALL ');
  for (const sql of [`SELECT T0.Nom FROM ${tables}`, parts]) {
    const c = compile(sql);
    expect(() => authorizedPrepare(db, c.sql)).toThrow(/^bc:invalidQuery\|tooComplex\|$/);
  }
});
it('a missing parameter value is refused', () => expect(() => compile('SELECT Nom FROM Clients WHERE Ville = [V]')).toThrow(/bc:missingParameter/));
it('literals are bound parameters', () => {
  const c = compile('SELECT Nom FROM Clients WHERE Nom = "x\'; DROP TABLE Clients; --" OR [N°] > 2.5');
  expect(c.sql).not.toMatch(/DROP|2\.5/);
  expect(c.params).toContain(2.5);
});
