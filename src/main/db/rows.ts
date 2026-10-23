// Comptage et lecture paginée, triée et filtrée (utilisée par la feuille de données) ; listes des champs Liste de choix.
import type { DatabaseSync } from 'node:sqlite';
import { listItemText, listItemValue, type SqlValue } from '../../shared/coerce';
import { fromStored } from '../../shared/expr/evaluate';
import { toText } from '../../shared/expr/library';
import type { LookupData } from '../../shared/api';
import {
  accessColumns, DEFAULT_COLUMN_WIDTH, lookupOf, sameName, shownColumns, valueListRows, type FieldDef, type LookupProps, type TableDesign, type TableLookup,
} from '../../shared/field-types';
import type { LocaleInfo } from '../../shared/locale-format';
import { compileFilter } from './filter';
import { listTables, pickName, quoteIdent, tableDesign } from './schema';
import { rowSourceRef, sourceLookupRows } from '../query/source';

import type { FieldFilter, LookupRow, PageRequest, RowPage } from '../../shared/api';
import type { SortSpec } from '../../shared/record-source';
export type { LookupRow, PageRequest, RowPage };

/** ` WHERE …` for a filter (see compileFilter), '' without one. */
function where(design: TableDesign, filter: FieldFilter[] | undefined, locale: string) {
  const f = compileFilter(design, filter ?? [], locale);
  return { sql: f.sql ? ` WHERE ${f.sql}` : '', params: f.params };
}

/** The rows `filter` keeps; `locale`: the data region (see compileFilter). */
export function countRows(db: DatabaseSync, table: string, filter: FieldFilter[] = [], locale = 'en-US'): number {
  const w = filter.length ? where(tableDesign(db, table), filter, locale) : { sql: '', params: [] };
  return Number((db.prepare(`SELECT count(*) AS n FROM ${quoteIdent(table)}${w.sql}`).get(...w.params) as { n: number | bigint }).n);
}

/** Sort keys in order; `tie` breaks ties, in the direction of the last key: rowid, or another unique column for a table
 *  without one (a lookup's source). */
function orderBy(design: TableDesign, sorts: readonly SortSpec[], tie = 'rowid'): string {
  if (sorts.length === 0) return `${tie} ASC`;
  const keys = sorts.map((sort) => {
    const fd = design.fields.find((x) => sameName(x.name, sort.field));
    if (!fd) throw new Error('bc:invalidArgument'); // an unknown sort field is an invalid sort (contract 1.2)
    const dir = sort.dir === 'desc' ? 'DESC' : 'ASC';
    const nulls = dir === 'ASC' ? 'NULLS FIRST' : 'NULLS LAST';
    const c = quoteIdent(fd.name);
    const p = fd.props;
    return p.type === 'shortText' || p.type === 'longText' || p.type === 'hyperlink'
      ? `bc_fold(${c}) ${dir} ${nulls}, bc_gkey(${c}) ${dir}` // ties as Access compares: "zoe" before "Zoé"
      // ponytail: CAST AS REAL perd la précision au-delà de ~15-17 chiffres significatifs ; ces valeurs sont à égalité et retombent sur l'ordre rowid.
      : p.type === 'number' && p.numberSize === 'decimal' ? `CAST(${c} AS REAL) ${dir} ${nulls}`
      : `${c} ${dir} ${nulls}`;
  });
  return `${keys.join(', ')}, ${tie} ${sorts.at(-1)!.dir === 'desc' ? 'DESC' : 'ASC'}`;
}

const isText = (design: TableDesign, sorts: readonly SortSpec[]) => sorts.some((sort) => {
  const t = design.fields.find((x) => sameName(x.name, sort.field))?.props.type;
  return t === 'shortText' || t === 'longText' || t === 'hyperlink';
});

/** Sorted-order snapshots by database: the ordered rowids of (table, sorts, filter, region), valid for one write sequence.
 *  ponytail: 8 B per row and at most SNAPSHOTS keys (100k rows: 0.8 MB each); key-based paging if bases reach tens of millions. */
const snapshots = new WeakMap<DatabaseSync, { seq: number; byKey: Map<string, Float64Array> }>();
const SNAPSHOTS = 4;

// Errors (contract 1.2): an invalid sort (unknown field) rejects bc:invalidArgument; the caller (Session) rejects bc:notFound
// for a missing table. ponytail: pagination par OFFSET, qui suffit jusqu'à environ 1 million de lignes ; au-delà, passer à une pagination par clé.
/** With `seq` (the session's write sequence) and a text sort key: the rows come from a snapshot of the sorted rowids, built
 *  once per (table, sorts, filter, region) with the same ORDER BY (text keys use UDFs no index serves: one sort of the whole
 *  table, not one per page), then sliced; the last SNAPSHOTS keys are kept until `seq` moves. */
export function readRows(
  db: DatabaseSync, design: TableDesign, req: PageRequest, locale = 'en-US', sorts: readonly SortSpec[] = req.sort ? [req.sort] : [], seq?: number,
): RowPage {
  const names = design.fields.map((fd) => quoteIdent(fd.name));
  const w = where(design, req.filter, locale);
  const from = `FROM ${quoteIdent(design.name)}`;
  if (seq === undefined || !isText(design, sorts)) {
    const stmt = db.prepare(`SELECT rowid, ${names.join(', ')} ${from}${w.sql} ORDER BY ${orderBy(design, sorts)} LIMIT ? OFFSET ?`);
    stmt.setReturnArrays(true); // positionnel : un champ peut porter n'importe quel nom
    const rows = stmt.all(...w.params, req.limit, req.offset) as unknown as SqlValue[][];
    return { rows: rows.map(([rowid, ...values]) => ({ rowid: Number(rowid), values })) };
  }
  let cache = snapshots.get(db);
  if (cache?.seq !== seq) snapshots.set(db, (cache = { seq, byKey: new Map() }));
  const key = JSON.stringify([design.name, sorts, req.filter ?? [], locale]);
  let ids = cache.byKey.get(key);
  if (ids) cache.byKey.delete(key); // re-set below: most recent last
  else {
    const stmt = db.prepare(`SELECT rowid ${from}${w.sql} ORDER BY ${orderBy(design, sorts)}`);
    stmt.setReturnArrays(true);
    ids = Float64Array.from(stmt.all(...w.params) as unknown as [number | bigint][], ([id]) => Number(id));
    if (cache.byKey.size >= SNAPSHOTS) cache.byKey.delete(cache.byKey.keys().next().value!);
  }
  cache.byKey.set(key, ids);
  const page = ids.subarray(req.offset, req.offset + req.limit);
  const byId = new Map<number, SqlValue[]>();
  for (let i = 0; i < page.length; i += 500) { // within SQLite's bound-parameter limit
    const chunk = Array.from(page.subarray(i, i + 500));
    const stmt = db.prepare(`SELECT rowid, ${names.join(', ')} ${from} WHERE rowid IN (${chunk.map(() => '?').join(', ')})`);
    stmt.setReturnArrays(true);
    for (const [rowid, ...values] of stmt.all(...chunk) as unknown as SqlValue[][]) byId.set(Number(rowid), values);
  }
  return { rows: Array.from(page, (rowid) => ({ rowid, values: byId.get(rowid)! })) };
}

export const LOOKUP_MAX = 5000;

/** The source of a table lookup as it is now: its live table (resolved as table names are), its bound field and the list's
 *  columns (the first Column Count fields), the lookup as Access columns (accessColumns). undefined when the Row Source names
 *  no table (SQL or a query name: queryRowSource) or a field is gone: the list then degrades (raw values shown, nothing checked). */
export function lookupSource(db: DatabaseSync, l: TableLookup): { design: TableDesign; bound: FieldDef; columns: FieldDef[]; lookup: TableLookup } | undefined {
  const table = pickName(listTables(db).map((x) => x.name), l.table);
  if (table === undefined) return undefined;
  const design = tableDesign(db, table);
  const lookup = accessColumns(l, design.fields.map((x) => x.name));
  const bound = lookup && design.fields[(lookup.boundColumn ?? 1) - 1];
  return bound ? { design, bound, columns: design.fields.slice(0, lookup.columnCount ?? 1), lookup } : undefined;
}

/** A Row Source that is SQL text or a saved query's name (A2-R18), served by A3's query engine; undefined otherwise. Its list
 *  is the source's output columns: the legacy `boundField` / `displayFields` of a table lookup saved before the Access
 *  properties are ignored (Bound Column and Column Count apply), and the Query Builder drops them when it writes the SQL. */
export function queryRowSource(db: DatabaseSync, l: TableLookup) {
  const ref = rowSourceRef(db, l.table);
  return ref && ref.kind !== 'table' ? ref : undefined;
}
/** A query source that does not run (missing table, parameters, broken SQL…) degrades as a missing table does. */
export function degraded<T>(fn: () => T, fallback: T): T {
  try {
    return fn();
  } catch (e) {
    if (e instanceof Error && /^bc:\w/.test(e.message)) return fallback;
    throw e;
  }
}

/** A stored value as text, in the region (as CStr does); one another tool stored as a BLOB: as is. */
function textOf(fd: FieldDef, v: SqlValue, info: LocaleInfo): string {
  try {
    const x = fromStored(fd, v);
    return x === null ? '' : toText(x, info);
  } catch {
    return String(v);
  }
}

const NO_LIST: LookupData = { rows: [], widths: [] };
const widthsOf = (l: LookupProps, shown: number[]) => shown.map((i) => l.columnWidths?.[i] ?? DEFAULT_COLUMN_WIDTH);

/**
 * The list of `field`'s lookup, its visible columns only (a width of 0 hides one; the first visible one is the text shown).
 * A value list keeps its order, read in rows of Column Count; its bound items converted as the field stores them (as typed when
 * they do not convert). A table source gives at most LOOKUP_MAX rows, sorted on the first visible column; a Field List, the
 * source's field names. SQL text or a saved query (A2-R18): its first LOOKUP_MAX rows in the query's order, Access columns
 * over its output columns. Heads with Column Heads: a table's or query's captions (else names), a value list's first row. No
 * rows without a usable lookup (no lookup, a type without one, an unknown field, a source gone or a query that does not run).
 */
export function lookupRows(db: DatabaseSync, design: TableDesign, field: string, info: LocaleInfo): LookupData {
  const fd = design.fields.find((x) => x.name === field);
  const l = fd && lookupOf(fd);
  if (!fd || !l) return NO_LIST;
  if (l.kind === 'values') {
    const { heads, rows } = valueListRows(l);
    const shown = shownColumns(l.columnWidths, l.columnCount ?? 1);
    const b = (l.boundColumn ?? 1) - 1;
    return {
      rows: rows.map((r) => ({
        value: r[b] === undefined ? null : listItemValue(fd, r[b]!),
        display: shown.map((i) => (i === b ? listItemText(fd.props.type, r[i] ?? '', info) : r[i] ?? '')),
      })),
      widths: widthsOf(l, shown), ...(heads ? { heads: shown.map((i) => heads[i] ?? '') } : {}),
    };
  }
  if (l.kind === 'fieldList') {
    const table = pickName(listTables(db).map((x) => x.name), l.table);
    if (table === undefined) return NO_LIST;
    return { rows: tableDesign(db, table).fields.map((x) => ({ value: x.name, display: [x.name] })), widths: widthsOf(l, [0]) };
  }
  const query = queryRowSource(db, l);
  if (query) {
    return degraded(() => {
      const { fields, rows } = sourceLookupRows(db, query, LOOKUP_MAX, info);
      const b = (l.boundColumn ?? 1) - 1;
      const columns = fields.slice(0, l.columnCount ?? 1);
      if (!fields[b] || !columns.length) return NO_LIST;
      const shown = shownColumns(l.columnWidths, columns.length);
      return {
        rows: rows.map((r) => ({ value: r[b] ?? null, display: shown.map((i) => textOf(columns[i]!, r[i] ?? null, info)) })),
        widths: widthsOf(l, shown), ...(l.columnHeads ? { heads: shown.map((i) => columns[i]!.props.caption || columns[i]!.name) } : {}),
      };
    }, NO_LIST);
  }
  const src = lookupSource(db, l);
  if (!src || !src.columns.length) return NO_LIST;
  const shown = shownColumns(src.lookup.columnWidths, src.columns.length);
  const cols = [src.bound, ...shown.map((i) => src.columns[i]!)];
  const stmt = db.prepare(`SELECT ${cols.map((x) => quoteIdent(x.name)).join(', ')} FROM ${quoteIdent(src.design.name)}
    ORDER BY ${orderBy(src.design, [{ field: cols[1]!.name, dir: 'asc' }], quoteIdent(src.bound.name))} LIMIT ${LOOKUP_MAX}`);
  stmt.setReturnArrays(true);
  return {
    rows: (stmt.all() as unknown as SqlValue[][]).map(([value, ...texts]) => ({ value: value ?? null, display: texts.map((v, i) => textOf(cols[i + 1]!, v ?? null, info)) })),
    widths: widthsOf(src.lookup, shown),
    ...(src.lookup.columnHeads ? { heads: shown.map((i) => src.columns[i]!.props.caption || src.columns[i]!.name) } : {}),
  };
}
