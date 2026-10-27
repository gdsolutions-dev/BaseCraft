// Write plan of an updatable SELECT (B4 R1, R2): the key table written, the "one" tables looked up through the joins, and
// their read-only join fields. Pure module.
import type { Expr } from '../expr/ast';
import { sameName, type TableDesign } from '../field-types';
import type { FromItem } from './ast';
import type { BoundSource, ResolvedRef } from './bind';

export interface WriteTable {
  table: string; alias: string;            // alias in the join level
  role: 'key' | 'one';
  readOnly: string[];                      // 'one': its join fields (R2); 'key': []
  parent?: { via: string /* child alias */; pairs: { child: string; field: string }[] };   // 'one': the ON equalities, child field -> own field
}

const covers = (fields: string[], names: string[]): boolean => names.every((n) => fields.some((x) => sameName(x, n)));

/** `fields` cover a unique key of `design`: all its primary-key fields, a No-Duplicates field or every field of a unique index. */
export function uniqueKey(design: TableDesign, fields: string[]): boolean {
  const pk = design.fields.filter((x) => x.props.primaryKey).map((x) => x.name);
  return (pk.length > 0 && covers(fields, pk))
    || design.fields.some((x) => x.props.indexed === 'yesNoDuplicates' && covers(fields, [x.name]))
    || (design.indexes ?? []).some((ix) => ix.unique && ix.fields.length > 0 && covers(fields, ix.fields.map((x) => x.name)));
}

/** null: not updatable (R1). [0] is the key table; 'one' tables follow, parents after their children. */
export function writePlan(sources: BoundSource[], from: FromItem[], refs: Map<Expr, ResolvedRef>): WriteTable[] | null {
  if (from.length !== 1 || sources.some((s) => s.kind !== 'table')) return null;
  if (sources.some((s, i) => sources.slice(0, i).some((o) => sameName(o.name, s.name)))) return null;
  const at = (alias: string): number => sources.findIndex((s) => s.alias === alias);
  // ON conditions: conjunctions of [A].[x] = [B].[y], grouped by pair of sources (lower index first)
  const edges = new Map<string, { a: number; b: number; pairs: [string, string][] }>();
  const conjuncts = (e: Expr): Expr[] => (e.k === 'bin' && e.op === 'And' ? [...conjuncts(e.l), ...conjuncts(e.r)] : [e]);
  const ons: Expr[] = [];
  const walk = (f: FromItem): void => { if (f.k === 'join') { walk(f.l); walk(f.r); ons.push(f.on); } };
  walk(from[0]);
  for (const c of ons.flatMap(conjuncts)) {
    if (c.k !== 'bin' || c.op !== '=') return null;
    const [l, r] = [refs.get(c.l), refs.get(c.r)];
    if (l?.kind !== 'column' || r?.kind !== 'column' || l.depth !== 0 || r.depth !== 0 || l.alias === r.alias) return null;
    const [x, y] = at(l.alias) < at(r.alias) ? [l, r] : [r, l];
    const key = `${at(x.alias)}|${at(y.alias)}`;
    const edge = edges.get(key) ?? { a: at(x.alias), b: at(y.alias), pairs: [] };
    edge.pairs.push([x.field, y.field]);
    edges.set(key, edge);
  }
  if (edges.size !== sources.length - 1) return null;
  // orient each edge "many" -> "one"; one-to-one: left -> right as written
  const parentOf = new Map<number, WriteTable['parent'] & { fields: string[] }>();
  for (const { a, b, pairs } of edges.values()) {
    const [ua, ub] = [uniqueKey(sources[a].design!, pairs.map((p) => p[0])), uniqueKey(sources[b].design!, pairs.map((p) => p[1]))];
    if (!ua && !ub) return null; // many-to-many
    const [many, one, ps] = ub ? [a, b, pairs] : [b, a, pairs.map(([p, q]) => [q, p] as [string, string])];
    if (parentOf.has(one)) return null; // two parents: two "many"-most tables
    parentOf.set(one, { via: sources[many].alias, pairs: ps.map(([child, field]) => ({ child, field })), fields: ps.map((p) => p[1]) });
  }
  const keys = sources.map((_, i) => i).filter((i) => !parentOf.has(i));
  if (keys.length !== 1) return null;
  // breadth first from the key table: each table after the one it is looked up from
  const order = [keys[0]];
  for (let i = 0; i < order.length; i++) {
    for (const [one, p] of parentOf) if (p.via === sources[order[i]].alias) order.push(one);
  }
  if (order.length !== sources.length) return null;
  return order.map((i) => {
    const s = sources[i], p = parentOf.get(i);
    if (!p) return { table: s.design!.name, alias: s.alias, role: 'key', readOnly: [] };
    const readOnly = p.fields.filter((x, j) => p.fields.findIndex((y) => sameName(x, y)) === j);
    return { table: s.design!.name, alias: s.alias, role: 'one', readOnly, parent: { via: p.via, pairs: p.pairs } };
  });
}
