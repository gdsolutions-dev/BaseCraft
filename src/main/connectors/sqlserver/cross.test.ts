// Cross-tests (spec 4.5, C5 Task 6): the same cases on the evaluator, SQLite and SQL Server. Evaluator = SQLite always;
// SQL Server on the server of BASECRAFT_MSSQL_TEST_URL (CI's Linux runner, G2), through BaseCraft's own connection (msPlan,
// the driver, msDecode). Where SQL Server differs by R9, MS_DISCREPANCIES holds its result and the reason docs/sqlserver.md
// gives. A second database, case-sensitive (Latin1_General_100_CS_AS), runs the text cases again (R8, Review Focus 1).
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import type { SqlValue } from '../../../shared/coerce';
import { CROSS_CASES, CROSS_ROWS, type CrossCase } from '../../../shared/expr/cross-cases';
import { parseCanonical } from '../../../shared/expr/parser';
import { sameName, type FieldType } from '../../../shared/field-types';
import { bindQuery, type QueryCatalog } from '../../../shared/query/bind';
import { parseSql } from '../../../shared/query/sql-parser';
import type { Connection, ReadRequest, RemoteTable } from '../connector';
import { createTable } from '../../db/schema';
import { f, t } from '../../../shared/test-fixtures';
import { closeLite, err, evaluatorResults, lite, NOW, parse, r12, ROWS, sqliteQuery, sqliteResults, type Outcome } from '../cross-run';
import { openMs } from './driver';
import { mssqlLive, mssqlMissingOnCi, mssqlUrl, withDatabase } from './live';
import { MS_FUNCTIONS, MS_REFUSED } from './sql-expr';

const doc = fs.readFileSync(path.join(__dirname, '../../../../docs/sqlserver.md'), 'utf8');

// ---- Reasons (docs/sqlserver.md quotes each one verbatim) ----
const REFUSED = 'Refused on SQL Server (bc:serverFunction): outside the closed list';
const MIXED = 'Refused on SQL Server (bc:serverFunction): an operator or a comparison does not mix text with numbers or dates';
const AMP = 'Refused on SQL Server (bc:serverFunction): & takes text, Null, an AutoNumber or an integer literal';
const DIV0 = 'A division by zero ends the SQL Server query (Access: an error in that cell)';
const SQRNEG = 'Sqr of a negative number ends the SQL Server query (Access: an error in that cell)';
const NZ = 'Nz(v) without a default gives 0 or a zero-length text by type on SQL Server (BaseCraft locally: Empty, shown as Null)';
const WW = 'DateDiff with "w" or "ww" and DatePart with "ww" are refused on SQL Server (bc:serverFunction)';
const LIKECOL = 'Refused on SQL Server (bc:serverFunction): a Like pattern read from a field (a literal or a parameter is translated)';
const SPACE = 'Space and String of a negative count give Null on SQL Server (Access: an error)';
// query-level differences (the query-level tests)
const AVG = 'Avg of a Decimal field is exact on SQL Server, to min(s + 19, 28 - (p - s)) decimals for a Decimal(p, s), its last decimal truncated, not rounded (BaseCraft locally: a Double, about 15 significant digits)';
const GROUPING = 'GROUP BY, DISTINCT and UNION follow the column\'s collation on SQL Server: one group for "Lyon" and "LYON" on a _CI_AS column (as Access), two on a case-sensitive one';

/** SQL Server's per-row result of a case, where R9 makes it differ from the evaluator's. */
const E8134 = 'bc:serverError|8134'; // Divide by zero error encountered.
export const MS_DISCREPANCIES: Record<string, { ms: unknown[]; why: string }> = {
  '[n] & ""': { ms: ['bc:serverFunction|&|sqlserver'], why: AMP },
  '[d] & ""': { ms: ['bc:serverFunction|&|sqlserver'], why: AMP },
  '1 / [n]': { ms: [1, 0.4, null, 0.333333333333, 0.666666666667, E8134, -0.5, 0.5, 10], why: DIV0 },
  '7 \\ [i]': { ms: [7, 3, null, 2, -1, E8134, 0, null, 1], why: DIV0 },
  // evaluated per row (a CASE branch not taken is not computed): only the rows where i > 2 fail, as in Access
  'IIf([i] > 2, 1 / 0, 1)': { ms: [1, 1, 1, E8134, 1, 1, E8134, 1, E8134], why: DIV0 },
  '[txt]': { ms: ['bc:serverFunction|CBool|sqlserver'], why: MIXED },
  '[txt] * 2 > 0': { ms: ['bc:serverFunction|*|sqlserver'], why: MIXED },
  '[d] = "31/10/2026 06:00:00"': { ms: ['bc:serverFunction|=|sqlserver'], why: MIXED },
  'Nz([n])': { ms: [1, 2.5, 0, 3, 1.5, 0, -2, 2, 0.1], why: NZ },
  'Nz([txt])': { ms: ['Dupont', 'dupont', '', 'été', "O'Brien", '50%', 'a;b', 'Été', '12'], why: NZ },
  'Sqr([i])': { ms: [1, 1.41421356237, null, 1.73205080757, 'bc:serverError|3623', 0, 3.16227766017, null, 2.64575131106], why: SQRNEG },
  'DateDiff("ww", [d], #2027-01-01#)': { ms: ['bc:serverFunction|DateDiff|sqlserver'], why: WW },
  'DatePart("ww", [d])': { ms: ['bc:serverFunction|DatePart|sqlserver'], why: WW },
  'DateDiff("w", [d], #2027-01-01#)': { ms: ['bc:serverFunction|DateDiff|sqlserver'], why: WW },
  '[txt] Like [txt]': { ms: ['bc:serverFunction|Like|sqlserver'], why: LIKECOL },
  'Space([i])': { ms: [' ', '  ', null, '   ', null, '', ' '.repeat(10), null, ' '.repeat(7)], why: SPACE },
  'String([i], "x")': { ms: ['x', 'xx', null, 'xxx', null, '', 'x'.repeat(10), null, 'x'.repeat(7)], why: SPACE },
  ...Object.fromEntries(['Format', 'Val', 'CStr', 'CDate', 'IsNumeric', 'IsDate', 'StrComp']
    .map((name) => [CROSS_CASES.find((c) => c.src.startsWith(`${name}(`))!.src, { ms: [`bc:serverFunction|${name}|sqlserver`], why: REFUSED }])),
};

afterAll(closeLite);

// ---- SQL Server (BaseCraft's connection) ----
const lit = (v: SqlValue): string => (v === null ? 'NULL' : typeof v === 'string' ? `N'${v.replace(/'/g, "''")}'` : String(v));
const T_DDL = ['CREATE TABLE T (id int IDENTITY PRIMARY KEY, txt nvarchar(255), n float, i int, d datetime2(0), b bit)',
  CROSS_ROWS.map((r) => `INSERT INTO T (txt, n, i, d, b) VALUES (${r.map(lit).join(', ')});`).join('\n')];

interface Ms { conn: Connection; tables: Map<string, RemoteTable>; close(): Promise<void> }
/** BaseCraft's connection to a fresh database (`collation`, else the server's) seeded by `ddl`, with the links of `names`;
 *  the database lives until `close()`. */
const msOpen = (ddl: string[], names: string[], collation?: string): Promise<Ms> => new Promise<Ms>((ready, fail) => {
  let done!: () => void;
  const ended = new Promise<void>((end) => { done = end; });
  const finished = withDatabase(async (admin, database) => {
    for (const sql of ddl) await admin.query(sql);
    const { params, login } = mssqlLive();
    const conn = await openMs({ ...params, database }, login);
    try {
      const tables = new Map<string, RemoteTable>();
      for (const name of names) tables.set(name, (await conn.table({ remote: name, name }))!);
      ready({ conn, tables, close: async () => { done(); await finished; } });
      await ended;
    } finally {
      await conn.close();
    }
  }, { collation }).catch(fail);
});

const msRequest = (ms: Ms, sql: string, o: Partial<ReadRequest> = {}): ReadRequest => {
  const find = (n: string) => [...ms.tables.values()].find((x) => sameName(x.name, n));
  const catalog: QueryCatalog = { table: (n) => find(n)?.design ?? null, query: () => null, sourceOf: () => 'ms' };
  return { query: bindQuery(parseSql(sql), catalog), values: {}, filter: [], sort: [], refs: false, tables: (n) => find(n)!, now: NOW(), ...o };
};
/** The rows of a query as BaseCraft reads them, or the refusal of msPlan ([message]). */
async function msQueryRows(ms: Ms, sql: string, o: Partial<ReadRequest> = {}): Promise<SqlValue[][] | [string]> {
  let plan;
  try { plan = ms.conn.plan(msRequest(ms, sql, o)); } catch (x) { return [(x as Error).message]; }
  return (await ms.conn.rows(plan, 0, 1000)).rows;
}
const msNorm = (v: SqlValue, type: FieldType): Outcome => {
  if (v === null) return null;
  if (type === 'yesNo') return v !== 0 ? -1 : 0;
  return type === 'number' || type === 'currency' || type === 'autoNumber' ? r12(Number(v)) : v;
};
async function msResults(ms: Ms, c: CrossCase): Promise<Outcome[]> {
  if (c.mode === 'criteria') {
    const rows = await msQueryRows(ms, `SELECT [id], [${c.subject}] FROM [T]`, { filter: [{ column: 1, criteria: parse(c) }] });
    if (typeof rows[0] === 'string') return rows;
    const kept = new Set(rows.map((r) => Number((r as SqlValue[])[0])));
    return Array.from({ length: ROWS }, (_, k) => kept.has(k + 1));
  }
  // a condition through IIf: its test is msCondition, as in a WHERE
  const e = c.mode === 'condition' ? `IIf(${c.src}, 1, IIf(Not (${c.src}), 0, Null))` : c.src;
  const sql = `SELECT [id], (${e}) AS r FROM [T]`;
  const type = msRequest(ms, sql).query.columns[1]!.type;
  const shown = (v: SqlValue): Outcome => (c.mode === 'condition' ? (v === null ? null : Number(v) === 1) : msNorm(v, type));
  const all = await msQueryRows(ms, sql).catch((x: unknown) => err(x));
  if (Array.isArray(all)) return typeof all[0] === 'string' ? all : (all as SqlValue[][]).map((r) => shown(r[1]!));
  // the query failed on the server: row by row
  const out: Outcome[] = [];
  for (let k = 1; k <= ROWS; k++) {
    try {
      const rows = (await msQueryRows(ms, sql, { where: parseCanonical(`[id] = ${k}`) })) as SqlValue[][];
      out.push(shown(rows[0]![1]!));
    } catch (x) { out.push(err(x)); }
  }
  return out;
}
const ids = (rows: SqlValue[][] | [string]): number[] => (rows as SqlValue[][]).map((r) => Number(r[0]));
const TEXT_CASES = CROSS_CASES.filter((c) => c.src.includes('[txt]') || c.subject === 'txt');

// ---- Tests ----
describe('cross cases on SQL Server (no server)', () => {
  it('Linux CI never skips the live tests: a missing BASECRAFT_MSSQL_TEST_URL fails the run', () => {
    expect(mssqlMissingOnCi(process.env, process.platform)).toBe(false);
    const url = 'sqlserver://u:p@h:1433/master?tls=require';
    expect(mssqlMissingOnCi({ CI: 'true' }, 'linux')).toBe(true);
    expect(mssqlMissingOnCi({ CI: 'true', BASECRAFT_MSSQL_TEST_URL: '' }, 'linux')).toBe(true);
    expect(mssqlMissingOnCi({ CI: 'true', BASECRAFT_MSSQL_TEST_URL: url }, 'linux')).toBe(false);
    expect(mssqlMissingOnCi({ CI: 'true', BASECRAFT_MSSQL_TEST_URL: '' }, 'win32')).toBe(false); // Windows: no service container
    expect(mssqlMissingOnCi({}, 'linux')).toBe(false); // a developer's machine
  });
  it('every discrepancy is used by a case, differs from the evaluator and is listed in docs/sqlserver.md', async () => {
    for (const [k, x] of Object.entries(MS_DISCREPANCIES)) {
      const c = CROSS_CASES.find((y) => y.src === k);
      expect(c, k).toBeDefined();
      expect(x.ms, k).not.toEqual(await evaluatorResults(c!));
      expect(doc).toContain(x.why);
    }
  });
  it('docs/sqlserver.md lists the query-level differences', () => { for (const why of [GROUPING, AVG]) expect(doc).toContain(why); });
  it('docs/sqlserver.md lists every function of the closed list and every refused one', () => {
    for (const name of [...MS_FUNCTIONS, ...MS_REFUSED]) expect(doc, name).toContain(`\`${name}\``);
  });
});

describe.skipIf(!mssqlUrl)('cross cases on SQL Server (live)', () => {
  let ms: Ms;
  beforeAll(async () => {
    ms = await msOpen([...T_DDL, 'CREATE TABLE D (id int IDENTITY PRIMARY KEY, x decimal(10,2)); INSERT INTO D (x) VALUES (1), (2), (2), (-1), (-2.01)'], ['T', 'D']);
    createTable(lite(), t('D', [f('id', 'autoNumber'), f('x', 'number', { numberSize: 'decimal', precision: 10, scale: 2 })]));
    const ins = lite().prepare('INSERT INTO "D" ("x") VALUES (?)');
    for (const x of ['1.00', '2.00', '2.00', '-1.00', '-2.01']) ins.run(x);
  }, 60_000);
  afterAll(() => ms?.close());

  it.each(CROSS_CASES)('$src: evaluator = SQLite = SQL Server (or a documented discrepancy)', async (c) => {
    const ev = await evaluatorResults(c);
    expect(sqliteResults(c)).toEqual(ev);
    expect(await msResults(ms, c)).toEqual(MS_DISCREPANCIES[c.src]?.ms ?? ev);
  });

  it('query-level cases agree: grouping, TOP ties, sort order, Like with # and […]', async () => {
    const both = async (sql: string) => ({ lite: sqliteQuery(sql), ms: await msQueryRows(ms, sql) as SqlValue[][] });
    // GROUPING: on a _CI_AS column "Dupont" and "dupont" are one group, as BaseCraft locally (and Access)
    const g = await both('SELECT LCase(txt) AS k, Count(*) AS c FROM T WHERE txt Like "d*" Or txt Like "é*" GROUP BY txt ORDER BY LCase(txt)');
    expect(g.lite).toEqual([['dupont', 2], ['été', 2]]);
    expect(g.ms).toEqual(g.lite);
    const d = await both('SELECT DISTINCT LCase(txt) AS k, txt FROM T WHERE txt Like "d*"');
    expect([d.lite.length, d.ms.length]).toEqual([1, 1]);
    const u = await both('SELECT txt FROM T WHERE id = 1 UNION SELECT txt FROM T WHERE id = 2');
    expect([u.lite.length, u.ms.length]).toEqual([1, 1]);
    // TOP keeps ties: the two Null i first (Null sorts first, as Access), and "Dupont" / "dupont" equal for TOP
    for (const [sql, want] of [['SELECT TOP 1 id FROM T ORDER BY i', [3, 8]], ['SELECT TOP 1 id FROM T WHERE txt Like "d*" ORDER BY txt', [1, 2]],
      ['SELECT TOP 3 id FROM T', null]] as const) {
      const r = await both(sql), sorted = (x: unknown[][]) => x.map((y) => Number(y[0])).sort((a, b) => a - b);
      if (want) expect([sorted(r.lite), sorted(r.ms)], sql).toEqual([want, want]);
      else expect([r.lite.length, r.ms.length]).toEqual([3, 3]);
    }
    // Yes/No sorts as Access on both: Yes first ascending
    const yn = await both('SELECT TOP 2 id FROM T ORDER BY b, id');
    expect([ids(yn.lite as SqlValue[][]), ids(yn.ms)]).toEqual([[1, 4], [1, 4]]);
    // sort order: Null first, case folded, accents in French order, numbers and punctuation as the collation puts them
    const s = await both('SELECT id FROM T ORDER BY txt, id');
    expect(ids(s.ms)).toEqual(ids(s.lite as SqlValue[][]));
    // Like with # and […]: T-SQL's own classes
    for (const where of ['txt Like "#*"', 'txt Like "[a-e]*"', 'txt Like "[!d-z]*"', 'txt Like "*[%;]*"', 'txt Like "##"']) {
      const r = await both(`SELECT id FROM T WHERE ${where} ORDER BY id`);
      expect(r.ms, where).toEqual(r.lite.map((x) => [Number(x[0])]));
    }
    // subqueries and aggregates
    for (const sql of ['SELECT id FROM T WHERE i In (SELECT i FROM T WHERE b) ORDER BY id',
      'SELECT id, i - (SELECT Min(i) FROM T) AS m FROM T WHERE i > (SELECT Avg(i) FROM T) ORDER BY id',
      'SELECT id, (SELECT Count(*) FROM T AS y WHERE y.i < x.i) AS r FROM T AS x ORDER BY id', 'SELECT id FROM T AS x WHERE Exists (SELECT 1 FROM T WHERE T.i = x.i + 1) ORDER BY id',
      'SELECT Count(*), Count(txt), Sum(i), Min(txt), Max(d) FROM T', 'SELECT b, Count(*) AS c, Sum(i) AS s FROM T GROUP BY b ORDER BY Sum(i)']) {
      const r = await both(sql);
      expect(r.ms, sql).toEqual(r.lite.map((x) => x.map((y) => (typeof y === 'bigint' ? Number(y) : y))));
    }
    const a = await both('SELECT Avg(n), StDev(n), StDevP(n), Var(i), VarP(i) FROM T');
    expect(a.ms[0]!.map((x) => r12(Number(x)))).toEqual(a.lite[0]!.map((x) => r12(Number(x))));
    // AVG: a Decimal field's average is exact to its 20 decimals here, the last one truncated (BaseCraft locally: a Double)
    for (const [sql, want] of [['SELECT Avg(x), Sum(x) FROM D', ['0.39800000000000000000', '1.99']], ['SELECT Avg(x) FROM D WHERE x > 0', ['1.66666666666666666666']],
      ['SELECT Avg(x) FROM D WHERE x < 0', ['-1.50500000000000000000']]] as const) {
      const r = await both(sql);
      expect(r.ms, sql).toEqual([want]);
      expect(r.ms[0]!.map((x) => r12(Number(x))), sql).toEqual(r.lite[0]!.map((x) => r12(Number(x))));
    }
    // outside the closed list: refused before anything is sent
    expect(await msQueryRows(ms, 'SELECT First(txt) FROM T')).toEqual(['bc:serverFunction|First|sqlserver']);
    expect(await msQueryRows(ms, 'SELECT Format(d, "yyyy") FROM T')).toEqual(['bc:serverFunction|Format|sqlserver']);
  });
});

describe.skipIf(!mssqlUrl)('cross cases on a case-sensitive SQL Server database (live)', () => {
  let ms: Ms;
  beforeAll(async () => {
    ms = await msOpen([...T_DDL,
      // two _CI_AS collations (a join of them: no error 468), and varchar columns whose code page is not Latin1's (1252)
      'CREATE TABLE U (id int PRIMARY KEY, code nvarchar(255) COLLATE Latin1_General_100_CI_AS); CREATE TABLE V (id int PRIMARY KEY, code nvarchar(255) COLLATE French_CI_AS)',
      "INSERT INTO U VALUES (1, N'DUPONT'), (2, N'ÉTÉ'), (3, N'x'); INSERT INTO V VALUES (1, N'dupont'), (2, N'Été'), (3, N'y')",
      `CREATE TABLE W (id int PRIMARY KEY, a varchar(20) COLLATE Polish_CS_AS, j varchar(20) COLLATE Japanese_CS_AS, u varchar(40) COLLATE Latin1_General_100_CS_AS_SC_UTF8);
       INSERT INTO W VALUES (1, N'Łódź', N'日本', N'Ωmega'), (2, N'lodz', N'abc', N'omega')`], ['T', 'U', 'V', 'W'], 'Latin1_General_100_CS_AS');
  }, 60_000);
  afterAll(() => ms?.close());

  it.each(TEXT_CASES)('$src: the case-sensitive database compares as Access', async (c) => {
    expect(await msResults(ms, c)).toEqual(MS_DISCREPANCIES[c.src]?.ms ?? await evaluatorResults(c));
  });

  it('joins of columns in different collations run and ignore case; grouping follows the column (two groups here)', async () => {
    const q = (sql: string) => msQueryRows(ms, sql);
    expect(await q('SELECT T.id, U.id FROM T INNER JOIN U ON T.txt = U.code ORDER BY T.id')).toEqual([[1, 1], [2, 1], [4, 2], [8, 2]]); // CS × CI
    expect(await q('SELECT U.id, V.id FROM U INNER JOIN V ON U.code = V.code ORDER BY U.id')).toEqual([[1, 1], [2, 2]]); // two _CI_AS collations
    expect(await q('SELECT id FROM T WHERE txt In (SELECT code FROM U) ORDER BY id')).toEqual([[1], [2], [4], [8]]);
    // GROUPING: a case-sensitive column groups "Dupont" and "dupont" apart
    expect(await q('SELECT LCase(txt) AS k, Count(*) AS c FROM T WHERE txt Like "d*" GROUP BY txt')).toEqual([['dupont', 1], ['dupont', 1]]);
    // sort: folded, then exact, as on a _CI_AS database
    const lite = sqliteQuery('SELECT id FROM T ORDER BY txt, id');
    expect(ids(await q('SELECT id FROM T ORDER BY txt, id'))).toEqual(ids(lite as SqlValue[][]));
  });

  it('varchar columns of another code page keep their characters when compared and sorted (Polish, Japanese, UTF-8)', async () => {
    const q = async (where: string) => ids(await msQueryRows(ms, `SELECT id FROM W WHERE ${where} ORDER BY id`));
    expect(await q('a = "łÓDŹ"')).toEqual([1]);
    expect(await q('a Like "Ł*"')).toEqual([1]);
    expect(await q('j = "日本"')).toEqual([1]);
    expect(await q('u = "ωMEGA"')).toEqual([1]);
    expect(await msQueryRows(ms, 'SELECT Replace(a, "ł", "x") FROM W WHERE id = 1')).toEqual([['xódź']]);
    expect(ids(await msQueryRows(ms, 'SELECT id FROM W ORDER BY j'))).toEqual([2, 1]); // Latin letters before CJK, not '??'
  });
});
