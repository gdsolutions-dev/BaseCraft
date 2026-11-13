// Query Wizard (Create › Query Wizard): the query trees of Access's four wizards, built from the picks and printed by printSql,
// which brackets every name (nothing is concatenated here). Pure module.
import type { Expr } from '../../shared/expr/ast';
import { sameName, type FieldType } from '../../shared/field-types';
import type { FromItem, Query, SelectItem, SelectQuery } from '../../shared/query/ast';
import { printSql } from '../../shared/query/print';

export type QueryAgg = 'Sum' | 'Avg' | 'Min' | 'Max';
export const QUERY_AGGS: QueryAgg[] = ['Sum', 'Avg', 'Min', 'Max'];
export const isSummable = (type: FieldType): boolean => type === 'number' || type === 'currency';

const id = (name: string, table?: string): Expr => ({ k: 'id', name, ...(table !== undefined && { table }) });
const call = (name: string, field: string): Expr => ({ k: 'call', name, args: [id(field)] });
const COUNT_ALL: Expr = { k: 'call', name: 'Count', args: [{ k: 'star' }] };
const source = (name: string): FromItem => ({ k: 'source', name });
const fields = (names: string[], table?: string): SelectItem[] => names.map((n) => ({ e: id(n, table) }));
const select = (items: SelectItem[], from: FromItem[], more: Partial<SelectQuery> = {}): SelectQuery =>
  ({ k: 'select', distinct: false, items, from, groupBy: [], orderBy: [], ...more });
const text = (body: Query['body']): string => printSql({ params: [], body });
const and = (es: Expr[]): Expr => es.reduce((l, r) => ({ k: 'bin', op: 'And', l, r }));

/** Simple Query Wizard. Summary: the non-numeric fields group, each numeric one gets the functions picked for it (`aggs`),
 *  and `count` adds the number of records. ponytail: one source (Access also joins several related tables). */
export function simpleQuery(src: string, picked: { name: string; type: FieldType }[],
  summary?: { aggs: Record<string, QueryAgg[]>; count: boolean }): string {
  if (!summary) return text(select(fields(picked.map((f) => f.name)), [source(src)]));
  const groups = picked.filter((f) => !isSummable(f.type)).map((f) => f.name);
  // ponytail: the aliases are English (SumOfX); Access's follow the interface language
  const items: SelectItem[] = [...fields(groups),
    ...picked.filter((f) => isSummable(f.type)).flatMap((f) => (summary.aggs[f.name] ?? []).map((fn) => ({ e: call(fn, f.name), alias: `${fn}Of${f.name}` }))),
    ...(summary.count ? [{ e: COUNT_ALL, alias: `CountOf${src}` }] : [])];
  return text(select(items, [source(src)], { groupBy: groups.map((n) => id(n)) }));
}

/** Find Duplicates: the rows whose `compare` values occur more than once, joined back to show the `extra` fields too.
 *  A null in a compared field never matches (null = null is not true), as in Access. */
export function duplicatesQuery(src: string, compare: string[], extra: string[]): string {
  const dup = sameName(src, 'Dup') ? 'Dup1' : 'Dup';
  const inner = select(fields(compare), [source(src)], { groupBy: compare.map((n) => id(n)), having: { k: 'bin', op: '>', l: COUNT_ALL, r: { k: 'num', v: '1' } } });
  const from: FromItem = { k: 'join', kind: 'inner', l: source(src), r: { k: 'derived', q: inner, alias: dup },
    on: and(compare.map((n): Expr => ({ k: 'bin', op: '=', l: id(n, src), r: id(n, dup) }))) };
  const shown = [...compare, ...extra.filter((n) => !compare.some((c) => sameName(c, n)))];
  return text(select(fields(shown, src), [from], { orderBy: compare.map((n) => ({ e: id(n, src), dir: 'asc' as const })) }));
}

/** Find Unmatched: the rows of `a` whose `aKey` has no equal `bKey` in `b` (LEFT JOIN … WHERE b.key IS NULL). */
export function unmatchedQuery(a: string, aKey: string, b: string, bKey: string, shown: string[]): string {
  const from: FromItem = { k: 'join', kind: 'left', l: source(a), r: source(b), on: { k: 'bin', op: '=', l: id(aKey, a), r: id(bKey, b) } };
  return text(select(fields(shown, a), [from], { where: { k: 'isnull', e: id(bKey, b), not: false } }));
}

/** Crosstab Query Wizard: row headings down, the column heading across, `fn` of `value` in the cells.
 *  ponytail: one column heading field, no date intervals and no row-total column. */
export function crosstabQuery(src: string, rows: string[], column: string, value: string, fn: QueryAgg | 'Count'): string {
  return text({ k: 'crosstab', value: call(fn, value), valueAlias: `${fn}Of${value}`, pivot: id(column),
    select: select(fields(rows), [source(src)], { groupBy: rows.map((n) => id(n)) }) });
}
