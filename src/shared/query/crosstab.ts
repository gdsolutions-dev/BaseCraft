// Crosstab (B4 R9): the TRANSFORM query rewritten as a grouped SELECT, one column per heading. Pure module.
import type { Expr, Value } from '../expr/ast';
import { AGGREGATES } from '../expr/catalog';
import { toSerial, toText } from '../expr/library';
import { literalOf } from '../expr/members';
import type { LocaleInfo } from '../locale-format';
import type { CrosstabQuery, SelectQuery } from './ast';

/** Access's limits (R10): column headings, and output columns in all. */
export const MAX_PIVOT_COLUMNS = 254, MAX_COLUMNS = 255;
export interface Heading { name: string; value: Expr /* a literal, or { k: 'null' } */ }

/** SELECT <pivot> FROM … WHERE … GROUP BY <pivot> ORDER BY <pivot>: the distinct headings, in Access order (HAVING and ORDER BY of the crosstab dropped). */
export function pivotValuesQuery(q: CrosstabQuery): SelectQuery {
  const { from, where } = q.select;
  return { k: 'select', distinct: false, items: [{ e: q.pivot }], from, ...(where && { where }), groupBy: [q.pivot], orderBy: [{ e: q.pivot, dir: 'asc' }] };
}

/** Each aggregate call of `e` (not inside subqueries) replaced by `f` of it. */
function mapAggregates(e: Expr, f: (call: Extract<Expr, { k: 'call' }>) => Expr): Expr {
  const m = (x: Expr): Expr => mapAggregates(x, f);
  switch (e.k) {
    case 'call': return AGGREGATES.has(e.name) ? f(e) : { ...e, args: e.args.map(m) };
    case 'un': case 'isnull': case 'inSub': return { ...e, e: m(e.e) };
    case 'bin': return { ...e, l: m(e.l), r: m(e.r) };
    case 'like': return { ...e, e: m(e.e), pattern: m(e.pattern) };
    case 'between': return { ...e, e: m(e.e), lo: m(e.lo), hi: m(e.hi) };
    case 'in': return { ...e, e: m(e.e), list: e.list.map(m) };
    default: return e;
  }
}

const NULL: Expr = { k: 'null' };
const iif = (c: Expr, a: Expr, b: Expr): Expr => ({ k: 'call', name: 'IIf', args: [c, a, b] });

/** The crosstab as a grouped SELECT: its items, then per heading `<value with each aggregate A(x) -> A(IIf(<pivot> = <h>, x, Null))>` AS <name>
 *  (`<pivot> Is Null` for the Null heading); Count(x) and Count(*) -> IIf(Count(IIf(<match>, 1, Null)) = 0, Null, Count(IIf(<match>, x|1, Null))) (R9);
 *  ORDER BY the row headings ascending when the crosstab has none. */
export function crosstabSelect(q: CrosstabQuery, headings: Heading[]): SelectQuery {
  const columns = headings.map((h) => {
    // fresh nodes per column: the binding keys its references by node
    const pivot = structuredClone(q.pivot);
    const match: Expr = h.value.k === 'null' ? { k: 'isnull', e: pivot, not: false } : { k: 'bin', op: '=', l: pivot, r: h.value };
    const e = mapAggregates(structuredClone(q.value), (a) => {
      const arg = a.args[0]!;
      if (a.name !== 'Count') return { ...a, args: [iif(match, arg, NULL), ...a.args.slice(1)] };
      const count = (x: Expr): Expr => ({ k: 'call', name: 'Count', args: [iif(match, x, NULL)] });
      const one: Expr = { k: 'num', v: '1' };
      return iif({ k: 'bin', op: '=', l: count(one), r: { k: 'num', v: '0' } }, NULL, count(arg.k === 'star' ? one : arg));
    });
    return { e, alias: h.name };
  });
  const s = q.select;
  return { ...s, items: [...s.items, ...columns], orderBy: s.orderBy.length ? s.orderBy : s.groupBy.map((e) => ({ e, dir: 'asc' as const })) };
}

/** R9: the value's text in the region (`toText`, as the datasheet shows it unformatted); Null `<>`; a zero-length text `""`. */
export function headingName(v: Value, info: LocaleInfo): string {
  if (v === null) return '<>';
  if (v.t === 'str' && v.v === '') return '""';
  return toText(v, info);
}

/** A heading literal of IN (B4 Task 5: num, str, date, bool, Null, or `-` on a number) as a value; -0 is 0. */
function literalValue(e: Expr): Value {
  switch (e.k) {
    case 'num': return { t: 'num', v: Number(e.v) };
    case 'un': return { t: 'num', v: -Number((e.e as Extract<Expr, { k: 'num' }>).v) || 0 };
    case 'str': return { t: 'str', v: e.v };
    case 'date': return { t: 'date', v: toSerial(e.v) };
    case 'bool': return { t: 'bool', v: e.v };
    default: return null;
  }
}

/** The headings a value list gives (the IN list, or the pivot values read back), named in the region. */
export const headingsOf = (values: Value[], info: LocaleInfo): Heading[] => values.map((v) => ({ name: headingName(v, info), value: literalOf(v) }));
/** The values of the crosstab's IN list, in its order. */
export const inValues = (q: CrosstabQuery): Value[] => (q.headings ?? []).map(literalValue);
/** The headings of the crosstab's IN list, in its order, named in the region. */
export const inHeadings = (q: CrosstabQuery, info: LocaleInfo): Heading[] => headingsOf(inValues(q), info);
