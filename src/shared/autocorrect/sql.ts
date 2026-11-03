// Name AutoCorrect (O4) in SQL: a query's text rewritten for renamed tables, fields, queries, forms and reports. Pure module.
// The binder decides what each identifier refers to (R5), never its spelling; the parsed tree is changed in place and
// printed canonically (printSql). Strings and parameters are never renamed.
import type { NameChange, ObjectKind, SaveTableRequest } from '../api';
import type { Expr } from '../expr/ast';
import { foldName, sameName } from '../field-types';
import type { FromItem, Query, QueryDefinition, SelectQuery } from '../query/ast';
import { bindQuery, LOCAL_SOURCE, QueryBindError, type BoundQuery, type BoundSelect, type BoundSource, type QueryCatalog, type ResolvedRef } from '../query/bind';
import { passThroughOf } from '../query/definition';
import { printSql } from '../query/print';
import { parseSql } from '../query/sql-parser';

type Kind = ObjectKind | 'table';
export interface Renames {
  /** foldName(old) → new, one map per namespace ('table' holds tables; links are never renamed). */
  objects: Record<Kind, Map<string, string>>;
  /** foldName(old table name) → foldName(old field) → new field. */
  fields: Map<string, Map<string, string>>;
}

/** A `fields` change naming a renamed table is keyed by the table's old name. */
export function toRenames(changes: NameChange[]): Renames {
  const objects: Renames['objects'] = { table: new Map(), query: new Map(), form: new Map(), report: new Map(), macro: new Map(), module: new Map() };
  const fields: Renames['fields'] = new Map();
  for (const c of changes) if (c.k === 'object') objects[c.kind].set(foldName(c.from), c.to);
  for (const c of changes) {
    if (c.k !== 'fields') continue;
    const table = [...objects.table].find(([, to]) => sameName(to, c.table))?.[0] ?? foldName(c.table);
    const m = fields.get(table) ?? new Map<string, string>();
    for (const x of c.renames) m.set(foldName(x.from), x.to);
    fields.set(table, m);
  }
  return { objects, fields };
}

/** The renames a table save makes (R3): the table's own, then its fields' by the mapping (under the table's new name). */
export function saveTableChanges(req: SaveTableRequest): NameChange[] {
  if (req.originalName === null) return [];
  const to = req.design.name.normalize('NFC');
  const renames = req.mapping.flatMap((m) => (m.sourceName !== null && m.sourceName !== m.name ? [{ from: m.sourceName, to: m.name }] : []));
  return [...(req.originalName !== to ? [{ k: 'object' as const, kind: 'table' as const, from: req.originalName, to }] : []),
    ...(renames.length ? [{ k: 'fields' as const, table: to, renames }] : [])];
}

export const renamedName = (r: Renames, kind: Kind, name: string): string | undefined => r.objects[kind].get(foldName(name));

type Source = Extract<FromItem, { k: 'source' }>;
/** A FROM's tables, queries and derived tables, joins flattened left to right: bindFrom's order of `BoundSelect.sources`. */
const flat = (from: FromItem[]): Exclude<FromItem, { k: 'join' }>[] => from.flatMap((f) => (f.k === 'join' ? flat([f.l, f.r]) : [f]));

/** The new name of `field` read from `src` (a table's: Renames.fields; a saved query's or a derived table's: its output rename,
 *  through src.inner). A link's fields are never renamed (its design may carry a local table's name). */
export function renamedColumn(src: BoundSource, field: string, r: Renames): string | undefined {
  if (src.kind === 'table') return src.source === LOCAL_SOURCE ? r.fields.get(foldName(src.name))?.get(foldName(field)) : undefined;
  return src.inner && outputRenames(src.inner, r).get(foldName(field));
}

/** The output names of one SELECT once renamed, by bindSelect's rule: the alias, else the field (`T.F` when another column
 *  shows a field of that name from another source, or the same source earlier, T the source's name once renamed); other
 *  columns keep theirs. ponytail: an `ExprNNNN` is not renumbered when a field is renamed onto `Expr1000`; R7's check sees it. */
function columnNames(sel: SelectQuery, bs: BoundSelect, refs: Map<Expr, ResolvedRef>, r: Renames): string[] {
  const aliased = new Set(sel.items.flatMap((i) => ('e' in i && i.alias !== undefined ? [i.e] : [])));
  const unaliased = new Set(flat(sel.from).flatMap((f, i) => (f.k === 'source' && f.alias === undefined ? [bs.sources[i]!] : [])));
  const plan = bs.columns.map((c) => {
    const x = refs.get(c.expr);
    return aliased.has(c.expr) || x?.kind !== 'column' || x.depth !== 0 ? undefined : { s: x.src, f: renamedColumn(x.src, x.field, r) ?? x.field };
  });
  return plan.map((p, i) => {
    if (!p) return bs.columns[i]!.name;
    const clash = plan.some((o, j) => j !== i && o && (o.s !== p.s || j < i) && sameName(o.f, p.f));
    const alias = (p.s.kind !== 'derived' && unaliased.has(p.s) && renamedName(r, p.s.kind, p.s.alias)) || p.s.alias;
    return clash ? `${alias}.${p.f}` : p.f;
  });
}

/** Per Renames, the output renames already worked out: a chain of saved queries asks each one once per column. */
const memo = new WeakMap<Renames, WeakMap<BoundQuery, Map<string, string>>>();
/** foldName(old output column) → new name, for every unaliased column that is a renamed reference or a `*` expansion of one
 *  (R5), a field or a source (a clash-qualified `Clients.N°` → `X.N°`), and every column a clash qualifies or frees. */
export function outputRenames(b: BoundQuery, r: Renames): Map<string, string> {
  const done = memo.get(r) ?? new WeakMap<BoundQuery, Map<string, string>>();
  memo.set(r, done);
  const known = done.get(b);
  if (known) return known;
  const out = new Map<string, string>(), body = b.query.body;
  const sel = body.k === 'union' ? body.parts[0]! : body.k === 'select' ? body : undefined; // a UNION is named by its first part
  const bs = sel && b.selects.get(sel);
  if (sel && bs) columnNames(sel, bs, b.refs, r).forEach((n, i) => { if (n !== bs.columns[i]!.name) out.set(foldName(bs.columns[i]!.name), n); });
  done.set(b, out);
  return out;
}

/** `q` bound, every SELECT of the tree included (a derived table has its own binding, BoundSource.inner; a saved query is
 *  another object): `refs` keyed by the tree's own nodes, `selects` its SELECTs' bindings, `levelSources` UPDATE / DELETE's. */
function bindTree(q: Query, catalog: QueryCatalog, self?: string) {
  const body = q.body;
  // a crosstab binds as its SELECT plus the value and the pivot, so their own nodes are keyed in refs (crosstabSelect clones them)
  const crosstab: SelectQuery | undefined = body.k === 'crosstab'
    ? { ...body.select, items: [...body.select.items, { e: body.value }, { e: body.pivot }], groupBy: [...body.select.groupBy, body.pivot] } : undefined;
  const b = bindQuery(crosstab ? { params: q.params, body: crosstab } : q, catalog, self);
  const refs = new Map<Expr, ResolvedRef>(), selects = new Map<SelectQuery, BoundSelect>();
  const add = (x: BoundQuery): void => {
    x.refs.forEach((v, k) => refs.set(k, v));
    x.selects.forEach((s, k) => selects.set(k, s));
    for (const s of [...x.sources, ...[...x.selects.values()].flatMap((y) => y.sources)]) if (s.kind === 'derived') add(s.inner!);
  };
  add(b);
  if (body.k === 'crosstab') selects.set(body.select, selects.get(crosstab!)!);
  const action = body.k === 'update' || body.k === 'delete' ? body : undefined;
  return { b, refs, selects, action, levelSources: action ? b.sources : [] };
}

/** Rewrites `q` in place. Null: nothing renamed; else the unaliased sources of the query's own FROM renamed, old name as
 *  written → new (their QBE layout keys follow). Throws ambiguousField when a renamed source's new name meets another
 *  source's name in a scope that sees both (the same FROM, R8, or an enclosing or nested SELECT), when a parameter or an
 *  output alias would read a column once renamed, or when an unqualified column a renamed name would capture cannot be
 *  qualified (its source's name is shadowed): references would be captured. */
function rewrite(q: Query, catalog: QueryCatalog, r: Renames, self?: string): Map<string, string> | null {
  const body = q.body;
  const { refs, selects, action, levelSources } = bindTree(q, catalog, self);
  const sourceOf = new Map<Source, BoundSource>(), unaliased = new Set<BoundSource>();
  const pair = (from: FromItem[], sources: BoundSource[]): void => flat(from).forEach((f, i) => {
    if (f.k !== 'source') return;
    sourceOf.set(f, sources[i]!);
    if (f.alias === undefined) unaliased.add(sources[i]!);
  });
  selects.forEach((x, s) => pair(s.from, x.sources));
  if (action) pair([action.from], levelSources);
  const own = body.k === 'union' ? body.parts : body.k === 'crosstab' ? [body.select] : body.k === 'select' ? [body]
    : body.k === 'insert' && !('values' in body.source) ? [body.source] : [];
  const top = new Set(flat([...own.flatMap((s) => s.from), ...(action ? [action.from] : [])]));

  let changed = false;
  const moved = new Map<string, string>();
  /** The new name when `name` of that namespace is renamed and written otherwise (R8: a case-only change too). */
  const to = (kind: Kind, name: string): string | undefined => {
    const n = renamedName(r, kind, name);
    if (n === undefined || n === name) return undefined;
    changed = true;
    return n;
  };
  /** A qualifier follows only an unaliased renamed source (`Clients AS C`: C stays). */
  const qualifier = (s: BoundSource | undefined, name: string): string | undefined =>
    s && s.kind !== 'derived' && unaliased.has(s) ? to(s.kind, name) : undefined;
  const byAlias = (sources: BoundSource[], name: string): BoundSource | undefined => sources.find((s) => sameName(s.alias, name));
  /** A source's name once renamed: an unaliased table's or query's new name, else its alias. */
  const named = (s: BoundSource): string => (s.kind !== 'derived' && unaliased.has(s) && renamedName(r, s.kind, s.alias)) || s.alias;
  /** The levels seen from `level` entered under `outer` (the enclosing ones, outermost first); two sources whose names meet
   *  only after the renames fail. ponytail: O(sources²) per level, fine for a query's handful. */
  const scope = (outer: BoundSource[][], level: BoundSource[]): BoundSource[][] => {
    const all = [...outer.flat(), ...level];
    for (const s of level) {
      for (const o of all) if (o !== s && sameName(named(s), named(o)) && !sameName(s.alias, o.alias)) throw new QueryBindError('ambiguousField', named(s));
    }
    return [...outer, level];
  };
  // the binder's resolution (bind.ts `resolve`) replayed on the names as they will be
  const fieldsOf = (s: BoundSource): string[] => (s.design?.fields ?? s.inner!.columns).map((c) => renamedColumn(s, c.name, r) ?? c.name);
  /** What an unqualified `name` will read: the one source of the nearest level that has it, null (ambiguous), undefined (none). */
  const reads = (levels: BoundSource[][], name: string): BoundSource | null | undefined => {
    for (const level of [...levels].reverse()) {
      const hits = level.filter((s) => fieldsOf(s).some((f) => sameName(f, name)));
      if (hits.length) return hits.length === 1 ? hits[0]! : null;
    }
    return undefined;
  };
  /** The source a qualifier will name: the nearest of that name. */
  const nearest = (levels: BoundSource[][], name: string): BoundSource | undefined => {
    for (const level of [...levels].reverse()) { const s = level.find((x) => sameName(named(x), name)); if (s) return s; }
    return undefined;
  };
  let unionNames: string[] | undefined;

  const visit = (node: unknown, seen: BoundSource[][]): void => {
    if (Array.isArray(node)) { node.forEach((x) => visit(x, seen)); return; }
    if (typeof node !== 'object' || node === null) return;
    const n = node as Query['body'] | FromItem | Expr;
    let inner = seen; // the sources a nested SELECT sees besides its own
    switch (n.k) {
      case 'derived': inner = []; break; // bound on its own: no enclosing level
      case 'crosstab': { // TRANSFORM and PIVOT read the SELECT's level
        visit(n.select, seen);
        visit([n.value, n.pivot], scope(seen, selects.get(n.select)!.sources));
        return;
      }
      case 'update': inner = scope(seen, levelSources); break;
      case 'source': {
        const s = sourceOf.get(n);
        const name = s && s.kind !== 'derived' ? to(s.kind, n.name) : undefined;
        if (name === undefined) break;
        if (n.alias === undefined && top.has(n)) moved.set(n.name, name);
        n.name = name;
        break;
      }
      case 'id': {
        const ref = refs.get(n);
        if (ref?.kind === 'column') {
          const field = renamedColumn(ref.src, ref.field, r);
          if (field !== undefined && field !== n.name) { n.name = field; changed = true; }
          if (n.table !== undefined) n.table = qualifier(ref.src, n.table) ?? n.table;
          else if (reads(seen, n.name) !== ref.src) {
            // R5: another source in reach will have the name (ambiguous, or nearer): written qualified, when that reaches it
            if (nearest(seen, named(ref.src)) !== ref.src) throw new QueryBindError('ambiguousField', n.name);
            n.table = named(ref.src);
            changed = true;
          }
        } else if (ref?.kind === 'output' && !seen.length && body.k === 'union') { // ORDER BY of a UNION: its output names
          const bs = selects.get(body.parts[0]!)!;
          const name = (unionNames ??= columnNames(body.parts[0]!, bs, refs, r))[ref.index]!;
          if (name !== bs.columns[ref.index]!.name && name !== n.name) { n.name = name; changed = true; }
        } else if (ref) { // a parameter or an output alias: a column of its name, once renamed, would capture it
          const s = n.table === undefined ? reads(seen, n.name) : nearest(seen, n.table);
          if (n.table === undefined ? s !== undefined : s && fieldsOf(s).some((f) => sameName(f, n.name))) {
            throw new QueryBindError('ambiguousField', ref.kind === 'param' ? ref.name : n.name);
          }
        }
        break;
      }
      case 'member': { // [Forms]![F]![C], [Reports]![R]![C]; TempVars never
        const kind = n.path[0] === 'Forms' ? 'form' : n.path[0] === 'Reports' ? 'report' : undefined;
        const name = kind && n.path[1] !== undefined ? to(kind, n.path[1]) : undefined;
        if (name !== undefined) n.path[1] = name;
        break;
      }
      case 'select': {
        const sources = selects.get(n)?.sources ?? [];
        inner = scope(seen, sources);
        if (n.into !== undefined) n.into = to('table', n.into) ?? n.into;
        for (const i of n.items) if ('all' in i && i.table !== undefined) i.table = qualifier(byAlias(sources, i.table), i.table) ?? i.table;
        break;
      }
      case 'insert': {
        const target = r.fields.get(foldName(n.target)); // a target is a table (INSERT INTO T (columns), R4)
        if (n.columns.length) {
          n.columns = n.columns.map((c) => { const x = target?.get(foldName(c)); return x !== undefined && x !== c ? ((changed = true), x) : c; });
        } else if (!('values' in n.source)) {
          // without a field list each output column goes to the field of its name: the list is written once the names part
          const bs = selects.get(n.source)!, now = columnNames(n.source, bs, refs, r);
          const want = bs.columns.map((c) => target?.get(foldName(c.name)) ?? c.name);
          if (want.some((w, i) => !sameName(w, now[i]!))) { n.columns = want; changed = true; }
        }
        n.target = to('table', n.target) ?? n.target;
        break;
      }
      case 'delete':
        inner = scope(seen, levelSources);
        if (n.target !== undefined) n.target = qualifier(byAlias(levelSources, n.target), n.target) ?? n.target;
        break;
    }
    Object.values(node).forEach((x) => visit(x, inner));
  };
  visit(q, []);
  return changed ? moved : null;
}

/** The SQL text rewritten for `r` (canonical print), or null when nothing in it is renamed. Throws the parse or bind error. */
export function rewriteSql(sql: string, catalog: QueryCatalog, r: Renames, self?: string): string | null {
  const q = parseSql(sql);
  return rewrite(q, catalog, r, self) ? printSql(q) : null;
}

/** What a query means, as text: for each `id` and `member` node of its tree (tree order), what the binder gives it — a
 *  column's source (kind, object name, field) and level depth, a parameter's name, an output alias's index, a member's
 *  path —; its output columns' names, types and origins; its parameters' types. `r`: the names it has once renamed (a query
 *  as it was, compared with its rewrite; a saved query's or derived table's fields through outputRenames). */
function meaning(q: Query, catalog: QueryCatalog, self?: string, r?: Renames): string {
  const { b, refs } = bindTree(q, catalog, self);
  const obj = (kind: Kind, name: string): string => foldName((r && renamedName(r, kind, name)) ?? name);
  const field = (table: string, f: string): string => foldName(r?.fields.get(foldName(table))?.get(foldName(f)) ?? f);
  const nodes: unknown[] = [];
  const walk = (node: unknown): void => {
    if (Array.isArray(node)) { node.forEach(walk); return; }
    if (typeof node !== 'object' || node === null) return;
    const n = node as Expr, x = refs.get(n);
    if (n.k === 'member') {
      const kind = n.path[0] === 'Forms' ? 'form' : n.path[0] === 'Reports' ? 'report' : undefined;
      nodes.push(['member', ...n.path.map((p, i) => (i === 1 && kind ? obj(kind, p) : foldName(p)))]);
    } else if (x?.kind === 'column') {
      const s = x.src;
      nodes.push(['column', s.kind, s.kind === 'derived' ? foldName(s.alias) : obj(s.kind, s.name), foldName((r && renamedColumn(s, x.field, r)) ?? x.field), x.depth]);
    } else if (x) nodes.push(x.kind === 'param' ? ['param', foldName(x.name)] : ['output', x.index]);
    Object.values(node).forEach(walk);
  };
  walk(q);
  const outs = r && outputRenames(b, r);
  return JSON.stringify({ nodes, columns: b.columns.map((c) => [foldName(outs?.get(foldName(c.name)) ?? c.name), c.type,
    c.origin && [obj('table', c.origin.table), field(c.origin.table, c.origin.field)]]),
    params: b.params.map((p) => p.type) });
}

/** R7's check (Task 6): `after`, bound in the base as it will be (`overlay`), means what `before` meant in `catalog` once
 *  renamed — every reference reads the same source, field and level (a capture by another alias fails), same output columns,
 *  same parameters. Throws `after`'s parse or bind error. */
export function sameMeaning(before: string, catalog: QueryCatalog, after: string, overlay: QueryCatalog, r: Renames, self?: string): boolean {
  return meaning(parseSql(before), catalog, self, r) === meaning(parseSql(after), overlay, self && (renamedName(r, 'query', self) ?? self));
}

/** A stored query: `sql` rewritten and the layout's `tables` keys moved (R4); unknown keys kept; null: unchanged or pass-through. */
export function rewriteQueryDefinition(def: QueryDefinition, name: string, catalog: QueryCatalog, r: Renames): QueryDefinition | null {
  if (passThroughOf(def) !== null) return null; // a pass-through's SQL is the server's text (out of scope)
  const q = parseSql(def.sql);
  const moved = rewrite(q, catalog, r, name);
  if (!moved) return null;
  const key = (k: string): string => [...moved].find(([old]) => sameName(old, k))?.[1] ?? k;
  return { ...def, sql: printSql(q),
    ...(def.layout && { layout: { ...def.layout, tables: Object.fromEntries(Object.entries(def.layout.tables).map(([k, v]) => [key(k), v])) } }) };
}
