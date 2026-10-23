// Task 12: the native path for integer equalities gives the rows of the bc_* path, on random data (Null, negatives, integers
// around 2^53, an adopted table holding text and decimals in an INTEGER column), with a fixed seed.
import { afterAll, beforeAll, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { createBaseFile, openBaseFile } from '../db/file-format';
import { createTable, isTableName, tableDesign } from '../db/schema';
import type { SqlValue } from '../../shared/coerce';
import { bindQuery, type QueryCatalog } from '../../shared/query/bind';
import { parseSql } from '../../shared/query/sql-parser';
import { f, t } from '../../shared/test-fixtures';
import { authorizedPrepare } from './authorizer';
import { compileAction, compileSelect } from './compile';

let dir: string;
let db: DatabaseSync;
const catalog: QueryCatalog = { table: (name) => (isTableName(db, name) ? tableDesign(db, name) : null), query: () => null };
const compiled = (sql: string, fastPath = true, values: Record<string, SqlValue> = { p: 7 }) =>
  compileSelect(bindQuery(parseSql(sql), catalog), values, { locale: 'fr-FR', fastPath });
/** Rows as sorted strings (the two plans read in different orders), integers read exactly (bigint). */
const rows = (sql: string, fastPath: boolean, values?: Record<string, SqlValue>): string[] => {
  const c = compiled(sql, fastPath, values);
  const stmt = authorizedPrepare(db, c.sql);
  stmt.setReturnArrays(true);
  stmt.setReadBigInts(true);
  return (stmt.all(...c.params) as unknown as unknown[][]).map((r) => r.map(String).join('|')).sort();
};

const BIG = 2n ** 53n;
beforeAll(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bcfast-'));
  const p = path.join(dir, 'test.basecraft');
  createBaseFile(p, '0.0.0');
  db = openBaseFile(p, 'write', '0.0.0').db;
  let seed = 20261023;
  const rnd = (): number => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
  const pick = <T>(xs: T[]): T => xs[Math.floor(rnd() * xs.length)];
  const int = (lo: number, hi: number): number => lo + Math.floor(rnd() * (hi - lo + 1));

  createTable(db, t('A', [f('id', 'autoNumber'), f('txt', 'shortText'), f('n', 'number', { numberSize: 'longInteger' })]));
  createTable(db, t('B', [f('id', 'autoNumber'), f('aid', 'number', { numberSize: 'longInteger' }), f('x', 'number', { numberSize: 'integer' })]));
  createTable(db, t('C', [f('id', 'autoNumber')]));
  db.exec('CREATE TABLE "X" ("extInt" INTEGER, "t" TEXT)'); // adopted: no CHECK, anything in extInt

  db.exec('BEGIN'); // one commit: synchronous=FULL
  const ids = new Set<bigint>([-5n, -1n, 7n, 9n, BIG - 1n, BIG, BIG + 1n]);
  while (ids.size < 300) ids.add(BigInt(int(-20, 400)));
  const a = db.prepare('INSERT INTO "A" ("id", "txt", "n") VALUES (?, ?, ?)');
  for (const id of ids) a.run(id, pick(['a', 'A', 'ab', 'AB', 'b', null]), pick([null, -7, 0, 7, 7.5, 9, 2147483647, -2147483648, int(-10, 10)]));
  const b = db.prepare('INSERT INTO "B" ("aid", "x") VALUES (?, ?)');
  // a REAL passes the CHECK range of an integer column: 7.5 and -5.5 among the integers
  for (let i = 0; i < 300; i++) b.run(pick([null, 7, 7.5, 9, -5, -5.5, 2147483647, -2147483648, int(-20, 400)]), pick([null, int(-5, 5)]));
  for (const id of [7n, 9n, BIG, BIG + 1n]) db.prepare('INSERT INTO "C" ("id") VALUES (?)').run(id);
  const x = db.prepare('INSERT INTO "X" ("extInt", "t") VALUES (?, ?)');
  for (let i = 0; i < 300; i++) x.run(pick<SqlValue | bigint>([null, 7, 9, '7', ' 9', 'abc', 7.5, BIG + 1n, int(-20, 400)]), pick(['a', 'A', null]));
  db.exec('COMMIT');
});
afterAll(() => {
  db.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

/** [SQL, path expected with fastPath (some native `=` in the statement, or bc_* only), parameter values]. */
const CASES: [string, 'native' | 'bc', Record<string, SqlValue>?][] = [
  ['SELECT * FROM A INNER JOIN B ON A.id = B.aid', 'native'],
  ['SELECT * FROM A LEFT JOIN B ON A.id = B.aid AND B.x > 2', 'native'],
  ['SELECT * FROM A WHERE id = 7 AND txt Like "a*"', 'native'],
  ['SELECT * FROM A WHERE id = [p]', 'native'],
  ['SELECT * FROM A WHERE id = 7 Or id = 9', 'bc'],
  ['SELECT * FROM X INNER JOIN B ON X.extInt = B.aid', 'bc' /* adopted table: external, no native path */],
  // beyond the brief
  ['SELECT * FROM A WHERE id = [p]', 'bc', { p: '7' }], // a text value
  ['PARAMETERS [q] Long; SELECT * FROM B WHERE aid = [q] AND x Is Not Null', 'native', { q: -5 }],
  ['SELECT * FROM A INNER JOIN C ON A.id = C.id', 'bc' /* two AutoNumbers beyond 2^53 */],
  ['SELECT * FROM A WHERE id = 9007199254740991', 'native'],
  ['SELECT * FROM A WHERE id = 9007199254740993', 'bc' /* not a safe integer */],
  ['SELECT * FROM A INNER JOIN B ON B.aid = A.n AND A.txt = "a" AND 7 = 7', 'native' /* 7.5 = 7.5 on both paths */],
  ['SELECT * FROM A, B WHERE A.n = B.aid AND (B.x = 1 Or B.x Is Null)', 'native'],
  ['SELECT aid, Count(*) FROM B GROUP BY aid HAVING aid = 7 AND Count(*) > 0', 'native'],
  ['SELECT * FROM A WHERE Exists (SELECT * FROM B WHERE B.aid = A.id AND B.x <> 1)', 'native' /* the inner WHERE */],
  ['SELECT * FROM A INNER JOIN (SELECT aid FROM B) AS D ON A.id = D.aid', 'bc' /* a derived table's column */],
  ['SELECT * FROM B RIGHT JOIN A ON A.id = B.aid', 'native'],
  ['SELECT * FROM A LEFT JOIN B ON A.id = B.aid WHERE B.x = 1', 'native'],
  ['SELECT * FROM A LEFT JOIN B ON A.id = B.aid WHERE B.aid Is Null', 'native'],
  ['SELECT * FROM B WHERE aid = 7.5', 'bc' /* not an integer literal; B.aid holds REALs */],
  ['SELECT * FROM A INNER JOIN B ON A.id = B.aid WHERE B.aid <> 7', 'native'],
];
it.each(CASES)('same rows with and without fast path: %s (%s)', (sql, path, values) => {
  expect(/ = /.test(compiled(sql, true, values).sql)).toBe(path === 'native');
  const native = rows(sql, true, values);
  expect(native.length).toBeGreaterThan(0);
  expect(native).toEqual(rows(sql, false, values));
});
it('a scalar subquery that can fail the statement keeps the whole condition in bc_* (fails on both paths)', () => {
  const sql = 'SELECT * FROM A WHERE id = 100000 AND n = (SELECT aid FROM B)'; // no row 100000; B has many rows
  expect(compiled(sql).sql).not.toMatch(/"id" = \?/);
  for (const fastPath of [true, false]) expect(() => rows(sql, fastPath), String(fastPath)).toThrow(/subqueryRows/);
});

it('native SQL is emitted only under the invariant', () => {
  expect(compiled('SELECT * FROM A INNER JOIN B ON A.id = B.aid').sql).toMatch(/ON "a0"\."id" = "a1"\."aid"/);
  expect(compiled('SELECT * FROM A WHERE txt = "x"').sql).not.toMatch(/"txt" = /);
  expect(compiled('SELECT * FROM X INNER JOIN B ON X.extInt = B.aid').sql).toMatch(/bc_truth/);
  expect(compiled('SELECT * FROM A WHERE id = 7 Or id = 9').sql).not.toMatch(/"id" = \?/); // Or: no split
  // beyond the brief
  expect(compiled('SELECT * FROM A WHERE id = 7 AND txt Like "a*"').sql).toMatch(/WHERE "a0"\."id" = \? AND bc_truth\(/);
  expect(compiled('SELECT * FROM A WHERE id = [p]', true, { p: '7' }).sql).not.toMatch(/"id" = \?/);
  expect(compiled('SELECT * FROM A INNER JOIN C ON A.id = C.id').sql).not.toMatch(/"id" = "a1"/);
  expect(compiled('SELECT * FROM A WHERE id = 9007199254740993').sql).not.toMatch(/"id" = \?/);
  expect(compiled('SELECT * FROM A INNER JOIN B ON A.id = B.aid', false).sql).not.toMatch(/"id" = /);
  const del = compileAction(bindQuery(parseSql('DELETE FROM B WHERE aid = 7'), catalog), {}, { locale: 'fr-FR' });
  expect(del.select.sql).toMatch(/WHERE "a0"\."aid" = \?$/);
});

const plan = (sql: string): string => {
  const c = compiled(sql);
  return (db.prepare(`EXPLAIN QUERY PLAN ${c.sql}`).all(...c.params) as { detail: string }[]).map((r) => r.detail).join();
};
it('the index is used', () => {
  expect(plan('SELECT * FROM A WHERE id = 7')).toMatch(/USING INTEGER PRIMARY KEY/);
  expect(plan('SELECT * FROM B INNER JOIN A ON A.id = B.aid')).toMatch(/SEARCH a1 USING INTEGER PRIMARY KEY/);
});
