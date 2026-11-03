// A join ON text = text with a saved query on a side compares keys (bc_gkey), so SQLite indexes the query: same rows as
// Access's text equality (case ignored, accents kept, Null and nothing else never equal, "" = "").
import { afterAll, beforeAll, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { createBaseFile, openBaseFile } from '../db/file-format';
import { createTable, isTableName, tableDesign } from '../db/schema';
import { bindQuery, type QueryCatalog } from '../../shared/query/bind';
import { parseSql } from '../../shared/query/sql-parser';
import { f, t } from '../../shared/test-fixtures';
import { authorizedPrepare } from './authorizer';
import { compileSelect } from './compile';

let dir: string;
let db: DatabaseSync;
const QUERIES: Record<string, string> = { QB: 'SELECT B.code, B.lib FROM B WHERE B.keep = "y";' };
const catalog: QueryCatalog = { table: (n) => (isTableName(db, n) ? tableDesign(db, n) : null), query: (n) => QUERIES[n] ?? null };
const run = (sql: string, fastPath = true): string[] => {
  const c = compileSelect(bindQuery(parseSql(sql), catalog), {}, { locale: 'fr-FR', fastPath });
  expect(/bcx_k\d/.test(c.sql)).toBe(fastPath);
  const stmt = authorizedPrepare(db, c.sql);
  stmt.setReturnArrays(true);
  return (stmt.all(...c.params) as unknown as unknown[][]).map((r) => r.map(String).join('|')).sort();
};
const A = ['zoe', 'ZOE', 'Zoé', 'zoé', 'Zoe', '', null, 'x'];
const B: [string | null, string, string][] = [['Zoe', 'L1', 'y'], ['zoé', 'L2', 'y'], ['', 'L3', 'y'], [null, 'L4', 'y'], ['x', 'L5', 'n'], ['y', 'L6', 'y']];

beforeAll(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bctj-'));
  const p = path.join(dir, 'test.basecraft');
  createBaseFile(p, '0.0.0');
  db = openBaseFile(p, 'write', '0.0.0').db;
  createTable(db, t('A', [f('id', 'autoNumber'), f('nom', 'shortText')]));
  createTable(db, t('B', [f('id', 'autoNumber'), f('code', 'shortText'), f('lib', 'shortText'), f('keep', 'shortText')]));
  for (const n of A) db.prepare('INSERT INTO "A" ("nom") VALUES (?)').run(n);
  for (const [c, l, k] of B) db.prepare('INSERT INTO "B" ("code", "lib", "keep") VALUES (?, ?, ?)').run(c, l, k);
});
afterAll(() => { db.close(); fs.rmSync(dir, { recursive: true, force: true }); });

const same = (a: string | null, b: string | null) => a !== null && b !== null && a.normalize('NFC').toLowerCase() === b.normalize('NFC').toLowerCase();
const kept = B.filter((b) => b[2] === 'y');

it('INNER JOIN a table to a query on text: case ignored, accents kept, "" = "", Null never', () => {
  const expected = A.flatMap((a) => kept.filter((b) => same(a, b[0])).map((b) => `${a}|${b[1]}`)).sort();
  expect(expected.length).toBeGreaterThan(3);
  expect(run('SELECT A.nom, QB.lib FROM A INNER JOIN QB ON QB.code = A.nom;')).toEqual(expected);
  expect(run('SELECT A.nom, QB.lib FROM QB INNER JOIN A ON A.nom = QB.code;')).toEqual(expected);
});

it('LEFT JOIN keeps the unmatched rows of the table', () => {
  const expected = A.flatMap((a) => { const m = kept.filter((b) => same(a, b[0])); return m.length ? m.map((b) => `${a}|${b[1]}`) : [`${a}|null`]; }).sort();
  expect(run('SELECT A.nom, QB.lib FROM A LEFT JOIN QB ON QB.code = A.nom;')).toEqual(expected);
});

it('two tables on text: the same rows', () => {
  const expected = A.flatMap((a) => B.filter((b) => same(a, b[0])).map((b) => `${a}|${b[1]}`)).sort();
  expect(run('SELECT A.nom, B.lib FROM A INNER JOIN B ON B.code = A.nom;')).toEqual(expected);
  expect(run('SELECT A.nom, B.lib FROM B INNER JOIN A ON A.nom = B.code;')).toEqual(expected);
});

it('ON with several conditions: the first text = text keyed, the rest as it was; the slow path agrees', () => {
  for (const sql of [
    'SELECT A.nom, B.lib FROM A INNER JOIN B ON B.code = A.nom AND B.keep = "y";',
    'SELECT A.nom, B.lib FROM A LEFT JOIN B ON B.keep = "y" AND B.code = A.nom AND B.lib <> "L2";',
    'SELECT A.nom, QB.lib FROM A INNER JOIN QB ON QB.lib Like "L*" AND QB.code = A.nom;',
  ]) {
    const fast = run(sql);
    expect(fast.length).toBeGreaterThan(2);
    expect(fast).toEqual(run(sql, false));
  }
});

it('a correlated subquery on text (Exists, scalar, In with a WHERE): keyed, the same rows as the slow path', () => {
  for (const sql of [
    'SELECT A.nom FROM A WHERE Exists (SELECT * FROM QB WHERE QB.code = A.nom);',
    'SELECT A.nom FROM A WHERE Not Exists (SELECT * FROM B WHERE A.nom = B.code AND B.keep = "y");',
    'SELECT A.nom, (SELECT First(QB.lib) FROM QB WHERE QB.code = A.nom) FROM A;',
    'SELECT A.nom FROM A WHERE A.nom In (SELECT B.code FROM B WHERE B.code = A.nom);',
  ]) {
    const fast = run(sql);
    expect(fast.length).toBeGreaterThan(1);
    expect(fast).toEqual(run(sql, false));
  }
});
