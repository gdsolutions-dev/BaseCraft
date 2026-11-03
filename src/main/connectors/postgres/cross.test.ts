// Cross-tests (spec 4.5, C4 Task 11): the same cases on the evaluator, SQLite and PostgreSQL. Evaluator = SQLite always;
// PostgreSQL on the server of BASECRAFT_PG_TEST_URL (CI's Linux runner, G3), through BaseCraft's own connection (pgPlan, the
// driver, pgDecode). Where PostgreSQL differs by R13/R14, PG_DISCREPANCIES holds its result and the reason docs/postgresql.md gives.
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
import { closeLite, err, evaluatorResults, NOW, parse, r12, ROWS, sqliteQuery, sqliteResults, type Outcome } from '../cross-run';
import { openPg } from './driver';
import { PG_FUNCTIONS, PG_REFUSED } from './sql-expr';
import { liveMissingOnCi, liveParams, liveUrl, withSchema } from './live';

const doc = fs.readFileSync(path.join(__dirname, '../../../../docs/postgresql.md'), 'utf8');

// ---- Reasons (docs/postgresql.md quotes each one verbatim) ----
const REFUSED = 'Refused on PostgreSQL (bc:serverFunction): outside the closed list';
const MIXED = 'Refused on PostgreSQL (bc:serverFunction): an operator or a comparison does not mix text with numbers or dates';
const AMP = 'Refused on PostgreSQL (bc:serverFunction): & takes text, Null, an AutoNumber or an integer literal';
const DIV0 = 'A division by zero ends the PostgreSQL query (Access: an error in that cell)';
const FOLDED = 'PostgreSQL computes a constant expression once for the whole query: 1 / 0 in IIf fails every row';
const SQRNEG = 'Sqr of a negative number ends the PostgreSQL query (Access: an error in that cell)';
const NZ = 'Nz(v) without a default gives 0 or a zero-length text by type on PostgreSQL (BaseCraft locally: Empty, shown as Null)';
const REPLACE = 'Replace is case-sensitive on PostgreSQL (Access compares text without case)';
const FRACTION = 'A date with fractional seconds is shown truncated to the second on PostgreSQL (Access rounds it)';
const WW = 'DateDiff with "w" or "ww" and DatePart with "ww" are refused on PostgreSQL (bc:serverFunction)';
const LIKECOL = 'Refused on PostgreSQL (bc:serverFunction): a Like pattern read from a field (a literal or a parameter is translated)';
// Kept, not reproduced: an error on the server (InStr's start pattern) would end the whole query for one cell, which is
// further from Access's one #Error cell than a zero-length text.
const SPACE = 'Space and String of a negative count give a zero-length text on PostgreSQL (Access: an error)';
// query-level differences (the query-level test)
const GROUPING = 'GROUP BY, DISTINCT and UNION group text case-sensitively on PostgreSQL ("Lyon" and "LYON" are two groups; Access: one)';

/** PostgreSQL's per-row result of a case, where R13/R14 make it differ from the evaluator's. */
export const PG_DISCREPANCIES: Record<string, { pg: unknown[]; why: string }> = {
  '[n] & ""': { pg: ['bc:serverFunction|&|postgresql'], why: AMP },
  '[d] & ""': { pg: ['bc:serverFunction|&|postgresql'], why: AMP },
  '1 / [n]': { pg: [1, 0.4, null, 0.333333333333, 0.666666666667, 'bc:serverError|22012', -0.5, 0.5, 10], why: DIV0 },
  '7 \\ [i]': { pg: [7, 3, null, 2, -1, 'bc:serverError|22012', 0, null, 1], why: DIV0 },
  '[txt]': { pg: ['bc:serverFunction|CBool|postgresql'], why: MIXED },
  '[txt] * 2 > 0': { pg: ['bc:serverFunction|*|postgresql'], why: MIXED },
  '[d] = "31/10/2026 06:00:00"': { pg: ['bc:serverFunction|=|postgresql'], why: MIXED },
  'IIf([i] > 2, 1 / 0, 1)': { pg: Array(ROWS).fill('bc:serverError|22012'), why: FOLDED },
  'Nz([n])': { pg: [1, 2.5, 0, 3, 1.5, 0, -2, 2, 0.1], why: NZ },
  'Nz([txt])': { pg: ['Dupont', 'dupont', '', 'été', "O'Brien", '50%', 'a;b', 'Été', '12'], why: NZ },
  'Replace([txt], "d", "X")': { pg: ['Dupont', 'Xupont', null, 'été', "O'Brien", '50%', 'a;b', 'Été', '12'], why: REPLACE },
  'Sqr([i])': { pg: [1, 1.41421356237, null, 1.73205080757, 'bc:serverError|2201F', 0, 3.16227766017, null, 2.64575131106], why: SQRNEG },
  '[d] + 0.6 / 86400': { pg: ['2026-10-01 00:00:00', '2026-11-15 00:00:00', null, '2025-12-31 00:00:00', '2026-09-30 23:59:59', '2026-10-02 12:00:00', null,
    '2026-01-01 00:00:00', '2026-10-31 06:00:00'], why: FRACTION },
  'DateDiff("ww", [d], #2027-01-01#)': { pg: ['bc:serverFunction|DateDiff|postgresql'], why: WW },
  'DatePart("ww", [d])': { pg: ['bc:serverFunction|DatePart|postgresql'], why: WW },
  'DateDiff("w", [d], #2027-01-01#)': { pg: ['bc:serverFunction|DateDiff|postgresql'], why: WW },
  '[txt] Like [txt]': { pg: ['bc:serverFunction|Like|postgresql'], why: LIKECOL },
  'Space([i])': { pg: [' ', '  ', null, '   ', '', '', ' '.repeat(10), null, ' '.repeat(7)], why: SPACE },
  'String([i], "x")': { pg: ['x', 'xx', null, 'xxx', '', '', 'x'.repeat(10), null, 'x'.repeat(7)], why: SPACE },
  ...Object.fromEntries(['Format', 'Val', 'CStr', 'CDate', 'IsNumeric', 'IsDate', 'StrComp']
    .map((name) => [CROSS_CASES.find((c) => c.src.startsWith(`${name}(`))!.src, { pg: [`bc:serverFunction|${name}|postgresql`], why: REFUSED }])),
};

afterAll(closeLite);

// ---- PostgreSQL (BaseCraft's connection) ----
let conn: Connection;
let pgT: RemoteTable;
let done: (() => void) | undefined;
let finished: Promise<void> | undefined; // the schema dropped
/** BaseCraft's connection to T in a fresh schema, kept until `done()` (the live describe's afterAll). */
const pgOpen = (): Promise<void> => new Promise<void>((ready, fail) => {
  finished = withSchema(async (admin, schema) => {
    await admin.query('CREATE TABLE "T" (id serial PRIMARY KEY, txt varchar(255), n float8, i int4, d timestamp, b boolean)');
    for (const r of CROSS_ROWS) await admin.query('INSERT INTO "T" (txt, n, i, d, b) VALUES ($1, $2, $3, $4, $5)', [...r.slice(0, 4), r[4] === null ? null : r[4] !== 0]);
    const { params, login } = liveParams();
    conn = await openPg(params, login);
    try {
      pgT = (await conn.table({ schema, remote: 'T', name: 'T' }))!;
      ready();
      await new Promise<void>((end) => { done = end; }); // the schema lives until afterAll
    } finally {
      await conn.close();
    }
  }).catch(fail);
});

const pgRequest = (sql: string, o: Partial<ReadRequest> = {}): ReadRequest => {
  const catalog: QueryCatalog = { table: (n) => (sameName(n, 'T') ? pgT.design : null), query: () => null, sourceOf: () => 'pg' };
  return { query: bindQuery(parseSql(sql), catalog), values: {}, filter: [], sort: [], refs: false, tables: () => pgT, now: NOW(), ...o };
};
/** The rows of a query as BaseCraft reads them, or the refusal of pgPlan ([message]). */
async function pgQuery(sql: string, o: Partial<ReadRequest> = {}): Promise<SqlValue[][] | [string]> {
  let plan;
  try { plan = conn.plan(pgRequest(sql, o)); } catch (x) { return [(x as Error).message]; }
  return (await conn.rows(plan, 0, 1000)).rows;
}
const pgNorm = (v: SqlValue, type: FieldType): Outcome => {
  if (v === null) return null;
  if (type === 'yesNo') return v !== 0 ? -1 : 0;
  return type === 'number' || type === 'currency' || type === 'autoNumber' ? r12(Number(v)) : v;
};
async function pgResults(c: CrossCase): Promise<Outcome[]> {
  if (c.mode === 'criteria') {
    const rows = await pgQuery(`SELECT [id], [${c.subject}] FROM [T]`, { filter: [{ column: 1, criteria: parse(c) }] });
    if (typeof rows[0] === 'string') return rows;
    const kept = new Set(rows.map((r) => Number((r as SqlValue[])[0])));
    return Array.from({ length: ROWS }, (_, k) => kept.has(k + 1));
  }
  // a condition through IIf: its test is pgCondition, as in a WHERE
  const e = c.mode === 'condition' ? `IIf(${c.src}, 1, IIf(Not (${c.src}), 0, Null))` : c.src;
  const sql = `SELECT [id], (${e}) AS r FROM [T]`;
  const type = pgRequest(sql).query.columns[1]!.type;
  const shown = (v: SqlValue): Outcome => (c.mode === 'condition' ? (v === null ? null : Number(v) === 1) : pgNorm(v, type));
  const all = await pgQuery(sql).catch((x: unknown) => err(x));
  if (Array.isArray(all)) return typeof all[0] === 'string' ? all : (all as SqlValue[][]).map((r) => shown(r[1]!));
  // the query failed on the server: row by row
  const out: Outcome[] = [];
  for (let k = 1; k <= ROWS; k++) {
    try {
      const rows = (await pgQuery(sql, { where: parseCanonical(`[id] = ${k}`) })) as SqlValue[][];
      out.push(shown(rows[0]![1]!));
    } catch (x) { out.push(err(x)); }
  }
  return out;
}

// ---- Tests ----
describe('cross cases (no server)', () => {
  it('Linux CI never skips the live tests: a missing BASECRAFT_PG_TEST_URL fails the run', () => {
    expect(liveMissingOnCi(process.env, process.platform)).toBe(false);
    const url = 'postgres://u:p@h/db';
    expect(liveMissingOnCi({ CI: 'true' }, 'linux')).toBe(true);
    expect(liveMissingOnCi({ CI: 'true', BASECRAFT_PG_TEST_URL: '' }, 'linux')).toBe(true);
    expect(liveMissingOnCi({ CI: 'true', BASECRAFT_PG_TEST_URL: url }, 'linux')).toBe(false);
    expect(liveMissingOnCi({ CI: 'true', BASECRAFT_PG_TEST_URL: '' }, 'win32')).toBe(false); // Windows: no service container
    expect(liveMissingOnCi({}, 'linux')).toBe(false); // a developer's machine
  });
  it('at least 80 cases, sources unique', () => {
    expect(CROSS_CASES.length).toBeGreaterThanOrEqual(80);
    expect(new Set(CROSS_CASES.map((c) => c.src)).size).toBe(CROSS_CASES.length);
  });
  it.each(CROSS_CASES)('$src: evaluator = SQLite', async (c) => { expect(sqliteResults(c)).toEqual(await evaluatorResults(c)); });
  it('every discrepancy is used by a case, differs from the evaluator and is listed in docs/postgresql.md', async () => {
    for (const [k, x] of Object.entries(PG_DISCREPANCIES)) {
      const c = CROSS_CASES.find((y) => y.src === k);
      expect(c, k).toBeDefined();
      expect(x.pg, k).not.toEqual(await evaluatorResults(c!));
      expect(doc).toContain(x.why);
    }
  });
  it('docs/postgresql.md lists the query-level differences', () => { for (const why of [GROUPING]) expect(doc).toContain(why); });
  it('docs/postgresql.md lists every function of the closed list and every refused one', () => {
    for (const name of [...PG_FUNCTIONS, ...PG_REFUSED]) expect(doc, name).toContain(`\`${name}\``);
  });
});

describe.skipIf(!liveUrl)('cross cases on PostgreSQL (live)', () => {
  beforeAll(pgOpen, 30_000);
  afterAll(async () => { done?.(); await finished; });

  it.each(CROSS_CASES)('$src: evaluator = SQLite = PostgreSQL (or a documented discrepancy)', async (c) => {
    const ev = await evaluatorResults(c);
    const lite = sqliteResults(c);
    const pg = await pgResults(c);
    expect(lite).toEqual(ev);
    expect(pg).toEqual(PG_DISCREPANCIES[c.src]?.pg ?? ev);
  });

  it('query-level cases agree: grouping, TOP ties, sort order, Like with # and […]', async () => {
    const both = async (sql: string) => ({ lite: sqliteQuery(sql), pg: await pgQuery(sql) });
    // GROUPING: BaseCraft locally puts "Dupont" and "dupont" in one group, PostgreSQL in two
    const g = await both('SELECT LCase(txt) AS k, Count(*) AS c FROM T WHERE txt Like "d*" Or txt Like "é*" GROUP BY txt ORDER BY LCase(txt)');
    expect(g.lite).toEqual([['dupont', 2], ['été', 2]]);
    expect(g.pg).toEqual([['dupont', 1], ['dupont', 1], ['été', 1], ['été', 1]]);
    const d = await both('SELECT DISTINCT LCase(txt) AS k, txt FROM T WHERE txt Like "d*"');
    expect([d.lite.length, d.pg.length]).toEqual([1, 2]);
    const u = await both('SELECT txt FROM T WHERE id = 1 UNION SELECT txt FROM T WHERE id = 2');
    expect([u.lite.length, u.pg.length]).toEqual([1, 2]);
    // TOP keeps ties: the two Null i first (Null sorts first, as Access), and "Dupont" / "dupont" equal for TOP
    for (const [sql, want] of [['SELECT TOP 1 id FROM T ORDER BY i', [3, 8]], ['SELECT TOP 1 id FROM T WHERE txt Like "d*" ORDER BY txt', [1, 2]],
      ['SELECT TOP 3 id FROM T', null]] as const) {
      const r = await both(sql), ids = (x: unknown[][]) => x.map((y) => Number(y[0])).sort((a, b) => a - b);
      if (want) expect([ids(r.lite), ids(r.pg as unknown[][])], sql).toEqual([want, want]);
      else expect([r.lite.length, r.pg.length]).toEqual([3, 3]);
    }
    // Yes/No sorts as Access on both: Yes first ascending
    const yn = await both('SELECT TOP 2 id FROM T ORDER BY b, id');
    expect([yn.lite.map((x) => Number(x[0])), yn.pg.map((x) => Number((x as SqlValue[])[0]))]).toEqual([[1, 4], [1, 4]]);
    // sort order: Null first, case folded, accents in French order, numbers and punctuation as the collation puts them
    const s = await both('SELECT id FROM T ORDER BY txt, id');
    expect(s.pg.map((x) => Number((x as SqlValue[])[0]))).toEqual(s.lite.map((x) => Number(x[0])));
    // Like with # and […]: an anchored regular expression on PostgreSQL
    for (const where of ['txt Like "#*"', 'txt Like "[a-e]*"', 'txt Like "[!d-z]*"', 'txt Like "*[%;]*"', 'txt Like "##"']) {
      const r = await both(`SELECT id FROM T WHERE ${where} ORDER BY id`);
      expect(r.pg, where).toEqual(r.lite.map((x) => [Number(x[0])]));
    }
    // subqueries and aggregates
    for (const sql of ['SELECT id FROM T WHERE i In (SELECT i FROM T WHERE b) ORDER BY id',
      'SELECT id, i - (SELECT Min(i) FROM T) AS m FROM T WHERE i > (SELECT Avg(i) FROM T) ORDER BY id',
      'SELECT id, (SELECT Count(*) FROM T AS y WHERE y.i < x.i) AS r FROM T AS x ORDER BY id', 'SELECT id FROM T AS x WHERE Exists (SELECT 1 FROM T WHERE T.i = x.i + 1) ORDER BY id',
      'SELECT Count(*), Count(txt), Sum(i), Min(txt), Max(d) FROM T', 'SELECT b, Count(*) AS c, Sum(i) AS s FROM T GROUP BY b ORDER BY Sum(i)']) {
      const r = await both(sql);
      expect(r.pg, sql).toEqual(r.lite.map((x) => x.map((y) => (typeof y === 'bigint' ? Number(y) : y))));
    }
    const a = await both('SELECT Avg(n), StDev(n), StDevP(n), Var(i), VarP(i) FROM T');
    expect((a.pg[0] as SqlValue[]).map((x) => r12(Number(x)))).toEqual(a.lite[0]!.map((x) => r12(Number(x))));
    // outside the closed list: refused before anything is sent
    expect(await pgQuery('SELECT First(txt) FROM T')).toEqual(['bc:serverFunction|First|postgresql']);
    expect(await pgQuery('SELECT Format(d, "yyyy") FROM T')).toEqual(['bc:serverFunction|Format|postgresql']);
  });
});
