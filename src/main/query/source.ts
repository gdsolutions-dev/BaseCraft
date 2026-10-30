// Record sources of kind `query` and `sql` (contract A3/A4/A5, section 1.2): describe, pages, and the save check of a query.
// Path of every run: parseSql -> bindQuery -> compileSelect -> authorizedPrepare; the user's SQL never reaches SQLite.
import { createHash } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { coerce, type CellInput, type SqlValue } from '../../shared/coerce';
import { SQL_FUNCTIONS, type SqlFragment } from '../../shared/expr/sql';
import { defaultProps, quoteIdent, sameName, type TableDesign } from '../../shared/field-types';
import type { LocaleInfo } from '../../shared/locale-format';
import { isSelectBody, type Query } from '../../shared/query/ast';
import { bindQuery, QueryBindError, toSourceInfo, type BoundQuery, type QueryCatalog } from '../../shared/query/bind';
import { invalidQueryError, isSqlSource, parseQueryDefinition } from '../../shared/query/definition';
import { parseSql } from '../../shared/query/sql-parser';
import type { RecordSourceRef, SourceField, SourceInfo, SourcePage, SourcePageRequest } from '../../shared/record-source';
import type { FieldFilter } from '../../shared/api';
import { compileFilter } from '../db/filter';
import { getObject } from '../db/objects';
import { hasRealRowid, isTableName, listTables, tableDesign } from '../db/schema';
import { authorizedPrepare, queryError } from './authorizer';
import { compileSelect, orderKeys, type CompiledSelect } from './compile';
import { expandCrosstab } from './crosstab';

import type { QueryRef } from '../../shared/api';

export type { QueryRef };
export interface QueryCtx { info: LocaleInfo; writeSeq: () => number /* moves on every write (Session.writeDb) */ }

/** SQL of a stored query; a definition that no longer reads names its query: `bc:invalidQuery|storedQuery|<name>`. */
function storedSql(o: { name: string; definition: unknown }): string {
  try {
    return parseQueryDefinition(o.definition).sql;
  } catch (e) {
    throw new Error(`bc:invalidQuery|storedQuery|${o.name}`, { cause: e });
  }
}

/** Tables (their design), then saved queries (their SQL), as bindQuery looks names up. */
export function queryCatalog(db: DatabaseSync): QueryCatalog {
  return {
    table: (name) => (isTableName(db, name) ? tableDesign(db, name) : null),
    query: (name) => {
      const o = getObject(db, 'query', name);
      return o && storedSql(o);
    },
  };
}

/** Where queries bind and run (C1 R10): the front-end holds the saved queries, `catalog` finds tables (local or linked) and
 *  their source, and a bound query runs on `dbOf(b.source, write)`. A bare DatabaseSync is all of these at once. */
/** `writable`: false when the source is read-only (a link whose file another session holds); absent, every source is. */
export interface QueryConn { front: DatabaseSync; catalog: QueryCatalog; dbOf(source: string, write: boolean): DatabaseSync; writable?(source: string): boolean }
export type QueryDb = DatabaseSync | QueryConn;
export const queryConn = (x: QueryDb): QueryConn => ('front' in x ? x : { front: x, catalog: queryCatalog(x), dbOf: () => x });

/** A parse error as `bc:invalidQuery|<code>|<position>`. */
function parse(sql: string): Query {
  try {
    return parseSql(sql);
  } catch (e) {
    throw invalidQueryError(e) ?? e;
  }
}

/**
 * The bound SELECT or UNION of `ref` (with `action`: the bound action query, bc:invalidArgument for a SELECT or UNION). bc:notFound (saved query missing), bc:notFound|unknownSource|<name> (a table or query it
 * names is missing: contract 1.2), bc:invalidQuery|…, bc:notSelectQuery, bc:queryBind|…. A key table without a real rowid
 * (WITHOUT ROWID, a field named rowid: adopted tables), or a joined table without one, makes the query read-only, as its table datasheet refuses it.
 */
export function resolve(x: QueryDb, ref: QueryRef, action = false): BoundQuery {
  const c = queryConn(x);
  let q: Query;
  let self: string | undefined;
  if (ref.kind === 'query') {
    const o = getObject(c.front, 'query', ref.name);
    if (!o) throw new Error('bc:notFound');
    self = o.name;
    q = parse(storedSql(o));
  } else q = parse(ref.sql);
  if (isSelectBody(q) === action) throw new Error(action ? 'bc:invalidArgument' : 'bc:notSelectQuery');
  let bound: BoundQuery;
  try {
    bound = bindQuery(q, c.catalog, self);
  } catch (e) {
    if (e instanceof Error && e.message.startsWith('bc:queryBind|unknownSource|')) throw new Error(e.message.replace('bc:queryBind', 'bc:notFound'), { cause: e });
    throw e;
  }
  // every table written (B4: the key table and the 'one' tables) is located by its rowid
  const written = bound.writePlan?.map((w) => w.table) ?? [bound.keyTable!];
  if (bound.updatable) {
    const db = c.dbOf(bound.source, false); // where its tables are
    if (!written.every((t) => hasRealRowid(db, tableDesign(db, t))) || c.writable?.(bound.source) === false) bound.updatable = false;
  }
  return bound;
}

/** A crosstab (B4 R11): its IN headings; else those of the data, with `params` when it has parameters — without them, its
 *  row columns only and `crosstab.headings` 'needsParameters'. `params`: as a page's, converted in the region. */
export function describeQuerySource(x: QueryDb, ref: QueryRef, info: LocaleInfo, params?: Record<string, CellInput>): SourceInfo {
  const b = resolve(x, ref);
  if (!b.crosstab) return toSourceInfo(b);
  if (b.crosstab.headings === 'fixed') return toSourceInfo(expandCrosstab(x, b, {}, info)); // IN: no value needed
  if (b.params.length && !params) return { ...toSourceInfo(b), crosstab: { headings: 'needsParameters' } };
  return toSourceInfo(expandCrosstab(x, b, paramValues(b, params ?? {}, info), info));
}

/** Each parameter's value, converted in the region as its type stores it. bc:missingParameter||<name>, bc:invalidParameter|<FieldErrorCode>|<name>. */
export function paramValues(b: BoundQuery, input: Record<string, CellInput>, info: LocaleInfo): Record<string, SqlValue> {
  const out: Record<string, SqlValue> = {};
  for (const p of b.params) {
    const key = Object.keys(input).find((k) => sameName(k, p.name));
    if (key === undefined) throw new Error(`bc:missingParameter||${p.name}`);
    const r = coerce({ name: p.name, props: p.props ?? defaultProps('shortText') }, input[key], info);
    if (!r.ok) throw new Error(`bc:invalidParameter|${r.error}|${p.name}`);
    out[p.name] = r.value;
  }
  return out;
}

export function compile(b: BoundQuery, values: Record<string, SqlValue>, info: LocaleInfo): CompiledSelect {
  try {
    return compileSelect(b, values, { locale: info.locale });
  } catch (e) {
    throw invalidQueryError(e, false) ?? e; // tooComplex
  }
}

/** Runs a statement prepared under the authorizer; a SQLite limit met while it runs is a typed error too. */
export function run(db: DatabaseSync, sql: string, params: SqlValue[]): SqlValue[][] {
  const stmt = authorizedPrepare(db, sql);
  stmt.setReturnArrays(true);
  try {
    return stmt.all(...params) as unknown as SqlValue[][];
  } catch (e) {
    throw queryError(e);
  }
}

/**
 * The compiled query restricted by `filter` and `where` (compileFilter over the output columns, named as the source names them; their
 * stored form is a table's). Same columns as `c`: `"bcx_rowid"` first when it has one, then `"c<k>"`. A field the source
 * lacks: bc:notFound; a criterion compileFilter refuses: bc:invalidArgument (contract 1.2).
 */
function filtered(b: BoundQuery, c: CompiledSelect, filter: FieldFilter[], where: string | undefined, locale: string): SqlFragment {
  if (!filter.length && where === undefined) return c;
  if (filter.some((f) => !b.columns.some((col) => sameName(col.name, f.field)))) throw new Error('bc:notFound');
  const design: TableDesign = { name: '', fields: b.columns.map(({ name, props }) => ({ name, props })) };
  let w: SqlFragment;
  try {
    w = compileFilter(design, filter, locale, where);
  } catch (e) {
    if (e instanceof Error && e.message.startsWith('bc:invalidFilter')) throw new Error('bc:invalidArgument', { cause: e });
    throw e;
  }
  // the rowid's inner name: one no output name takes (a bracketed alias may hold any character; sameName folds more than SQLite)
  let rowid = 'bcx.rowid';
  while (b.columns.some((col) => sameName(col.name, rowid))) rowid += '_';
  const named = [...(c.hasRowid ? [`"bcx_rowid" AS ${quoteIdent(rowid)}`] : []), ...b.columns.map((col, k) => `"c${k}" AS ${quoteIdent(col.name)}`)];
  const back = [...(c.hasRowid ? [`${quoteIdent(rowid)} AS "bcx_rowid"`] : []), ...b.columns.map((col, k) => `${quoteIdent(col.name)} AS "c${k}"`)];
  return { sql: `SELECT ${back.join(', ')} FROM (SELECT ${named.join(', ')} FROM (${c.sql})) WHERE ${w.sql}`, params: [...c.params, ...w.params] };
}

/** A call of Date(), Now() or Time() (the non-deterministic UDFs): such a count changes without any write. */
const VOLATILE = new RegExp(`\\b(${Object.keys(SQL_FUNCTIONS).filter((n) => !SQL_FUNCTIONS[n].deterministic).join('|')})\\(`);

/** Totals by database, keyed by a hash of (ref, parameter values, filter, where, region) — a `sql` ref holds up to 1 MB — valid for one writeSeq. */
const totals = new WeakMap<DatabaseSync, Map<string, { seq: number; total: number }>>();
const MAX_TOTALS = 256;

/**
 * A page of a query or SQL source: the compiled query as a derived table, filtered by `req.filter` and `req.where` (see `filtered`), sorted
 * by `req.sort` (unknown field: bc:notFound), ties kept in the query's own order (its row position); `rowids` of the key
 * table when the query is updatable. `total` counts the filtered rows, cached until the next write (never for a query or
 * filter calling Date(), Now() or Time()).
 */
export function pageQuerySource(x: QueryDb, ref: QueryRef, req: SourcePageRequest, ctx: QueryCtx): SourcePage {
  const resolved = resolve(x, ref);
  const db = queryConn(x).dbOf(resolved.source, false);
  const values = paramValues(resolved, req.params ?? {}, ctx.info);
  const b = expandCrosstab(x, resolved, values, ctx.info); // a crosstab: its headings from these values (R11)
  const columns = b.crosstab && { columns: b.columns.map((x) => x.name) }; // R14
  // a crosstab's heading gone (its last row deleted): its sort and criteria go, the page brings the columns to rebuild (R14)
  const shown = (field: string) => !b.crosstab || b.columns.some((c) => sameName(c.name, field));
  const sort = (req.sort ?? []).filter((s) => shown(s.field)), filter = (req.filter ?? []).filter((f) => shown(f.field));
  const keys = sort.map((s) => {
    const k = b.columns.findIndex((c) => sameName(c.name, s.field));
    if (k < 0) throw new Error('bc:notFound');
    return orderKeys(`"c${k}"`, b.columns[k].type, s.dir);
  });
  const compiled = compile(b, values, ctx.info);
  const c = { ...filtered(b, compiled, filter, req.where, ctx.info.locale), hasRowid: compiled.hasRowid };

  const seq = ctx.writeSeq();
  const cache = totals.get(db) ?? new Map<string, { seq: number; total: number }>();
  totals.set(db, cache);
  const key = createHash('sha256').update(JSON.stringify([ref, values, filter, req.where ?? null, ctx.info.locale])).digest('base64');
  const volatile = VOLATILE.test(c.sql);
  let total = !volatile && cache.get(key)?.seq === seq ? cache.get(key)!.total : undefined;
  if (total === undefined) {
    total = Number(run(db, `SELECT count(*) FROM (${c.sql})`, c.params)[0][0]);
    if (cache.size >= MAX_TOTALS) cache.clear(); // ponytail: drop all past 256 keys; an LRU if forms page many parameter sets
    if (!volatile) cache.set(key, { seq, total });
  }
  if (req.limit === 0) return { rows: [], rowids: [], total, ...columns };

  const out = [...(c.hasRowid ? ['"bcx_rowid"'] : []), ...b.columns.map((_, k) => `"c${k}"`)].join(', ');
  // the query's own ORDER BY stays inside; row_number() over its rows, in that order, breaks the page sort's ties
  const sql = keys.length
    ? `SELECT ${out} FROM (SELECT *, row_number() OVER () AS "bcx_pos" FROM (${c.sql})) AS "bcx_q" ORDER BY ${keys.join(', ')}, "bcx_pos" LIMIT ? OFFSET ?`
    : `SELECT ${out} FROM (${c.sql}) AS "bcx_q" LIMIT ? OFFSET ?`;
  const rows = run(db, sql, [...c.params, req.limit, req.offset]);
  return c.hasRowid
    ? { rows: rows.map((r) => r.slice(1)), rowids: rows.map((r) => (r[0] === null ? null : Number(r[0]))) /* an outer join's row without its key record (R5) */, total }
    : { rows, rowids: rows.map(() => null), total, ...columns };
}

/**
 * Save check of a query definition (objects.save): its shape and SQL (parseQueryDefinition), then its binding against the
 * catalog where `name` already holds the new SQL, so a cycle through it is found (`QA → QB → QA`). Action queries are
 * checked too. Throws bc:invalidQuery|… or bc:queryBind|…; the caller writes nothing then.
 */
export function checkQueryDefinition(x: QueryDb, name: string, definition: unknown): void {
  const { sql } = parseQueryDefinition(definition);
  const base = queryConn(x).catalog;
  bindQuery(parseSql(sql), { ...base, query: (n) => (sameName(n, name) ? sql : base.query(n)) }, name);
}

/**
 * A lookup's Row Source (A2-R18) or a Record Source text as a ref (contract 1.2): SQL when it starts with SELECT, TRANSFORM
 * or PARAMETERS; else a table, then a saved query (sameName, stored spelling); null when neither exists.
 */
export function rowSourceRef(db: DatabaseSync, text: string): RecordSourceRef | null {
  if (isSqlSource(text)) return { kind: 'sql', sql: text };
  const name = text.trim();
  const table = listTables(db).find((t) => sameName(t.name, name));
  if (table) return { kind: 'table', name: table.name };
  const query = getObject(db, 'query', name);
  return query && { kind: 'query', name: query.name };
}

/** A lookup's Row Source, never a crosstab (R12): bc:queryBind|crosstabAsSource|<its name>. */
function lookupSource(db: DatabaseSync, ref: QueryRef): BoundQuery {
  const b = resolve(db, ref);
  if (b.crosstab) throw new QueryBindError('crosstabAsSource', ref.kind === 'query' ? ref.name : '');
  return b;
}

/** Limit To List through a query or SQL Row Source: column `column` of the source holds `value`, compared as stored. */
export function sourceHasValue(db: DatabaseSync, ref: QueryRef, column: number, value: SqlValue, info: LocaleInfo): boolean {
  const b = lookupSource(db, ref);
  if (!Number.isSafeInteger(column) || column < 0 || column >= b.columns.length) throw new Error('bc:invalidArgument');
  const c = compile(b, paramValues(b, {}, info), info);
  return run(db, `SELECT 1 FROM (${c.sql}) WHERE "c${column}" = ? LIMIT 1`, [...c.params, value]).length > 0;
}

/** A lookup list through a query or SQL Row Source (A2-R18): its columns and its first `limit` rows, in the query's order.
 *  bc:missingParameter when it has parameters (a list asks none, as in a datasheet). */
export function sourceLookupRows(db: DatabaseSync, ref: QueryRef, limit: number, info: LocaleInfo): { fields: SourceField[]; rows: SqlValue[][] } {
  const b = lookupSource(db, ref);
  const c = compile(b, paramValues(b, {}, info), info);
  return { fields: toSourceInfo(b).fields, rows: run(db, `SELECT ${b.columns.map((_, k) => `"c${k}"`).join(', ')} FROM (${c.sql}) LIMIT ${limit}`, c.params) };
}
