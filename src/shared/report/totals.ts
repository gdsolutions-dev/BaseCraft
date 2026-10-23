// Totaux d'un état (pur) : extraction des agrégats d'une expression, calcul par les accumulateurs exacts du socle
// (createAccumulator, aggregateArgType — contrat 1.6 et 1.7, C7/C9). A5 n'additionne jamais en double : une requête
// Regroupement (A3) et un état donnent la même somme pour les mêmes données.
import { aggregateArgType, createAccumulator, type AggregateName } from '../expr/aggregate';
import { ExprSyntaxError, type Expr, type Value } from '../expr/ast';
import { AGGREGATES } from '../expr/catalog';
import { evaluate, fromStored, type EvalEnv } from '../expr/evaluate';
import { fail, infoOf, num } from '../expr/library';
import { hasAggregate } from '../expr/parser';
import type { SqlValue } from '../coerce';
import { sameName } from '../field-types';
import type { SourceField } from '../record-source';

/** A row's field by name (sameName) as the evaluator reads it: unknown → unknownField; no row (a report section) → Null. */
export const rowField = (fields: SourceField[], row: SqlValue[] | null) => (name: string): Value => {
  const j = fields.findIndex((f) => sameName(f.name, name));
  if (j < 0) return fail('unknownField');
  return row === null ? null : fromStored(fields[j]!, row[j] ?? null);
};

export interface AggSpec { fn: AggregateName; arg: Expr /* { k: 'star' } pour Count(*) */; id: string /* '\u0000agg<n>' */ }
export interface AggInput { fields: SourceField[]; rows: SqlValue[][]; scope: number[] /* indices de lignes, ordre de l'état */; env: Omit<EvalEnv, 'field'> }

/**
 * Replaces every aggregate call (a name in `AGGREGATES`) by the field reference `{ k: 'id', name: id }`, ids numbered in
 * order of appearance (`'\u0000agg0'`, …: a NUL never occurs in a field name). The caller computes each `AggSpec` with
 * `computeAggregate` and evaluates `expr` with those ids as fields. An aggregate nested in another, which the parser
 * accepts, is refused with `ExprSyntaxError('unexpectedToken')`, as Access does.
 */
export function extractAggregates(e: Expr): { expr: Expr; aggs: AggSpec[] } {
  const aggs: AggSpec[] = [];
  const walk = (x: Expr): Expr => {
    switch (x.k) {
      case 'call': {
        if (!AGGREGATES.has(x.name)) return { ...x, args: x.args.map(walk) };
        const arg = x.args[0]!;
        if (arg.k !== 'star' && hasAggregate(arg)) throw new ExprSyntaxError('unexpectedToken', { start: 0, end: 0 });
        const id = `\u0000agg${aggs.length}`;
        aggs.push({ fn: x.name as AggregateName, arg, id });
        return { k: 'id', name: id };
      }
      case 'un': return { ...x, e: walk(x.e) };
      case 'bin': return { ...x, l: walk(x.l), r: walk(x.r) };
      case 'like': return { ...x, e: walk(x.e), pattern: walk(x.pattern) };
      case 'between': return { ...x, e: walk(x.e), lo: walk(x.lo), hi: walk(x.hi) };
      case 'in': return { ...x, e: walk(x.e), list: x.list.map(walk) };
      case 'isnull': return { ...x, e: walk(x.e) };
      default: return x;
    }
  };
  return { expr: walk(e), aggs };
}

/**
 * One aggregate over the rows of `scope`, in that order: `Count(*)` adds `num(1)` per row; any other aggregate evaluates
 * `arg` on the row's fields (`fromStored`) and adds the Value. The accumulator is typed by `aggregateArgType` (foundation,
 * C5), so `Sum([Qté] * [Prix])` is the same here and in a Totals query; Null handling, exactness and First/Last are its
 * job. Text values are read in the region of `env.locale`. An unknown field rejects `ExprRuntimeError('unknownField')`.
 */
export async function computeAggregate(spec: AggSpec, { fields, rows, scope, env }: AggInput): Promise<Value> {
  const { type, props } = aggregateArgType(spec.arg, (name) => fields.find((f) => sameName(f.name, name)));
  const acc = createAccumulator(spec.fn, type, props, infoOf(env.locale));
  for (const i of scope) {
    if (spec.arg.k === 'star') { acc.add(num(1)); continue; }
    acc.add(await evaluate(spec.arg, { ...env, field: rowField(fields, rows[i]!) }));
  }
  return acc.result();
}
