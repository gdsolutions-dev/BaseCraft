// Binding of a query tree (A3): sources, column provenance, types, parameters, grouping and updatability. Pure module.
// Resolution follows Access: a name that is no field becomes a parameter (a typo in a field name makes the question appear).
import type { Expr } from '../expr/ast';
import { aggregateArgType } from '../expr/aggregate';
import { AGGREGATES, FUNCTIONS, type FnInfo } from '../expr/catalog';
import { RANGES } from '../coerce';
import { CANONICAL_DIALECT, serializeWith } from '../expr/parser';
import { defaultProps, isReservedName, isValidObjectName, sameName, type FieldProps, type FieldType, type TableDesign } from '../field-types';
import type { SourceInfo } from '../record-source';
import { isSelectBody, type CrosstabQuery, type FromItem, type Query, type SelectQuery } from './ast';
import { literalOf } from '../expr/members';
import { crosstabSelect, inValues, MAX_COLUMNS, MAX_PIVOT_COLUMNS, type Heading } from './crosstab';
import { printSelect } from './print';
import { parseSql } from './sql-parser';
import { writePlan, type WriteTable } from './write-plan';

export interface QueryCatalog { table(name: string): TableDesign | null; query(name: string): string | null /* canonical SQL */ }
export type ResolvedRef =
  | { kind: 'column'; alias: string; field: string; type: FieldType; props: FieldProps; depth: number /* 0 = same level, n = enclosing query */ }
  | { kind: 'param'; name: string /* as written: look it up in `params` with sameName */ }
  | { kind: 'output'; index: number /* alias of the same SELECT: its column index */ };
export interface BoundSource { alias: string; name: string; kind: 'table' | 'query' | 'derived'; design?: TableDesign; inner?: BoundQuery }
export interface BoundColumn { name: string; type: FieldType; props: FieldProps; origin?: { table: string; field: string }; expr: Expr }
export interface BoundParam { name: string; type: FieldType | null; props?: FieldProps }   // = SourceInfo['parameters'][number]
/** One SELECT of the tree: the body, a UNION part, a subquery or INSERT's source (a derived table or a saved query has
 *  its own BoundQuery, `BoundSource.inner`). `grouped`: an aggregate, a GROUP BY or a HAVING (a group context). */
export interface BoundSelect { sources: BoundSource[]; columns: BoundColumn[]; grouped: boolean }
export interface BoundQuery {
  query: Query; columns: BoundColumn[]; params: BoundParam[]; sources: BoundSource[];
  /** Every `id` of the tree, subqueries included, plus the `id`s `*` expands to (`columns[i].expr`) and the SET targets. */
  refs: Map<Expr, ResolvedRef>;
  aggregate: boolean; updatable: boolean;
  /** Updatable SELECT: the table written and its source's alias. UPDATE / DELETE / INSERT: the target table (and alias). */
  keyTable?: string; keyAlias?: string;
  /** Updatable SELECT (B4 R1): the tables written, and the bound query whose FROM holds them (itself or an inner saved query). */
  writePlan?: WriteTable[]; writeLevel?: BoundQuery;
  /** Binding of each SELECT node of this query (not those of `inner` queries). */
  selects: Map<SelectQuery, BoundSelect>;
  /** A crosstab (B4 R9): `query` is its rewritten SELECT (crosstabSelect), `source` the TRANSFORM query. 'data': headings
   *  from the data, `columns` the row columns only until expandCrosstab binds it with them. */
  crosstab?: { headings: 'fixed' | 'data'; source: Query };
}
export type QueryBindErrorCode = 'unknownSource' | 'ambiguousField' | 'circular' | 'tooDeep' | 'notGrouped' | 'aggregateInWhere'
  | 'nestedAggregate' | 'unionArity' | 'updateTarget' | 'unknownTarget' | 'duplicateOutput'
  | 'insertArity' // INSERT: values (or the SELECT columns of a field list) and target columns differ in number
  | 'subqueryArity' // a scalar or In subquery that does not return exactly one column
  | 'memberNotAllowed' // [LocalVars]! or [MacroError]! in a query (only Forms, Reports and TempVars become parameters)
  | 'crosstabRowHeading' // a crosstab without GROUP BY (no row heading)
  | 'crosstabValue' // a crosstab value (TRANSFORM) without an aggregate
  | 'pivotAggregate' // an aggregate in PIVOT
  | 'tooManyColumns' // a crosstab past 254 headings or 255 columns (R10); detail: its number of columns
  | 'crosstabAsSource'; // a saved crosstab used as a source (R12); detail: its name

export class QueryBindError extends Error {
  constructor(public code: QueryBindErrorCode, public detail: string) {
    super(`bc:queryBind|${code}|${detail}`);
    this.name = 'QueryBindError';
  }
}

/** Saved queries nested in one another (Q1 uses Q2 uses Q3…), at most. */
const MAX_SAVED_DEPTH = 16;
const CMP = new Set(['=', '<>', '<', '<=', '>', '>=']);
const RET = new Map<string, FnInfo['ret']>(FUNCTIONS.map((x) => [x.name, x.ret]));
const fail = (code: QueryBindErrorCode, detail = ''): never => { throw new QueryBindError(code, detail); };
/** Canonical text of an expression (error details). */
const show = (e: Expr): string => serializeWith(e, { ...CANONICAL_DIALECT, sub: printSelect });
/** Output reference (`{ kind: 'output' }`) -> the expression of the column it names. Keyed by node, so exprType sees it. */
const outputTargets = new WeakMap<Expr, Expr>();

type Id = Extract<Expr, { k: 'id' }>;
type Col = { name: string; type: FieldType; props: FieldProps; origin?: { table: string; field: string } };
interface Level { sources: BoundSource[]; parent?: Level; outputs: { name: string; index: number; expr: Expr }[] }
interface Ctx {
  /** Saved queries being bound (outermost first); saved queries already bound, with the chain length they fit under. */
  catalog: QueryCatalog; chain: string[]; saved: [string, BoundQuery, number][];
  params: BoundParam[]; refs: Map<Expr, ResolvedRef>; selects: Map<SelectQuery, BoundSelect>;
}

const cols = (s: BoundSource): Col[] => s.design?.fields.map((x) => ({ name: x.name, type: x.props.type, props: x.props })) ?? s.inner!.columns;
/** By alias only (an unaliased source's alias is its name), as in Access: an aliased table's own name is no longer a
 *  qualifier, so `Clients AS Dupe` in a subquery never captures the enclosing query's `Clients.Ville`. */
const findSource = (lvl: Level, name: string): BoundSource | undefined => lvl.sources.find((s) => sameName(s.alias, name));

/** Sub-expressions, without entering subqueries. */
function children(e: Expr): Expr[] {
  switch (e.k) {
    case 'un': case 'isnull': case 'inSub': return [e.e];
    case 'bin': return [e.l, e.r];
    case 'like': return [e.e, e.pattern];
    case 'between': return [e.e, e.lo, e.hi];
    case 'in': return [e.e, ...e.list];
    case 'call': return e.args;
    default: return [];
  }
}

/** First aggregate call of `e`, through output aliases, not inside subqueries (theirs belong to them). */
function aggOf(e: Expr): Expr | null {
  if (e.k === 'call' && AGGREGATES.has(e.name)) return e;
  const target = e.k === 'id' ? outputTargets.get(e) : undefined;
  if (target) return aggOf(target);
  for (const c of children(e)) { const a = aggOf(c); if (a) return a; }
  return null;
}
const noAggregate = (e: Expr): void => { const a = aggOf(e); if (a) fail('aggregateInWhere', show(a)); };

/** Expressions of a SELECT (items, ON, WHERE, GROUP BY, HAVING, ORDER BY), for a check that enters subqueries. */
function selectExprs(q: SelectQuery): Expr[] {
  const ons: Expr[] = [];
  const from = (f: FromItem): void => { if (f.k === 'join') { from(f.l); from(f.r); ons.push(f.on); } };
  q.from.forEach(from);
  return [...q.items.flatMap((i) => ('e' in i ? [i.e] : [])), ...ons, ...(q.where ? [q.where] : []), ...q.groupBy,
    ...(q.having ? [q.having] : []), ...q.orderBy.map((o) => o.e)];
}

// ---- Parameters ----

/** Parameter type and props from the column it is compared with: AutoNumber is a Long Integer, Hyperlink a Short Text,
 *  so `coerce` never answers readOnly; only the number size, precision and scale of the field are kept (C3). */
function paramFrom(type: FieldType, props: FieldProps): { type: FieldType; props: FieldProps } {
  const t: FieldType = type === 'autoNumber' ? 'number' : type === 'hyperlink' ? 'shortText' : type;
  const num = t !== 'number' ? {} : type === 'autoNumber' ? { numberSize: 'longInteger' as const }
    : Object.fromEntries((['numberSize', 'precision', 'scale'] as const).filter((k) => props[k] !== undefined).map((k) => [k, props[k]]));
  return { type: t, props: { ...defaultProps(t), ...num, required: false } };
}

function addParam(ctx: Ctx, name: string): void {
  if (!ctx.params.some((p) => sameName(p.name, name))) ctx.params.push({ name, type: null });
}

/** Parameters of a source query or of a deferred clause, merged by name: a typed one types an untyped one. */
function merge(ctx: Ctx, list: BoundParam[]): void {
  for (const p of list) {
    const same = ctx.params.find((x) => sameName(x.name, p.name));
    if (!same) ctx.params.push({ ...p });
    else if (same.type === null && p.type !== null) Object.assign(same, { type: p.type, props: p.props });
  }
}

/** `a` compared directly with `b`: an untyped parameter takes the column's type. */
function infer(ctx: Ctx, a: Expr, b: Expr): void {
  for (const [p, c] of [[a, b], [b, a]]) {
    const [rp, rc] = [ctx.refs.get(p), ctx.refs.get(c)];
    if (rp?.kind !== 'param' || rc?.kind !== 'column') continue;
    const param = ctx.params.find((x) => sameName(x.name, rp.name));
    if (param && param.type === null) Object.assign(param, paramFrom(rc.type, rc.props));
  }
}

// ---- Resolution ----

/** An identifier, in Access's order: qualified source (this level, then the enclosing ones); a field of exactly one source
 *  of the level, else of an enclosing level; an output alias of the same SELECT (`outputs`); otherwise a parameter. */
function resolve(e: Id, lvl: Level, outputs: boolean): ResolvedRef {
  const column = (s: BoundSource, c: Col, depth: number): ResolvedRef =>
    ({ kind: 'column', alias: s.alias, field: c.name, type: c.type, props: c.props, depth });
  let depth = 0;
  if (e.table !== undefined) {
    for (let l: Level | undefined = lvl; l; l = l.parent, depth++) {
      const s = findSource(l, e.table);
      if (!s) continue;
      const c = cols(s).find((x) => sameName(x.name, e.name));
      if (c) return column(s, c, depth);
      break; // the source exists, not the field: the parameter A.F
    }
    return { kind: 'param', name: `${e.table}.${e.name}` };
  }
  for (let l: Level | undefined = lvl; l; l = l.parent, depth++) {
    const hits = l.sources.flatMap((s) => cols(s).filter((x) => sameName(x.name, e.name)).map((c) => column(s, c, depth)));
    if (hits.length > 1) fail('ambiguousField', e.name);
    if (hits.length === 1) return hits[0];
  }
  const o = outputs ? lvl.outputs.find((x) => sameName(x.name, e.name)) : undefined;
  if (o) {
    outputTargets.set(e, o.expr);
    return { kind: 'output', index: o.index };
  }
  return { kind: 'param', name: e.name };
}

/** Resolves every identifier of `e` (subqueries bound one level deeper) and infers parameter types from comparisons. */
function walk(e: Expr, lvl: Level, ctx: Ctx, outputs: boolean): void {
  if (e.k === 'member') {
    // R11: [Forms]![F]![C], [Reports]![R]![C], [TempVars]![x] are parameters named by their canonical text, filled by the
    // renderer from the open object (asked when it is not); the value reaches SQLite bound, never as text
    const name = show(e);
    if (!['Forms', 'Reports', 'TempVars'].includes(e.path[0]!)) fail('memberNotAllowed', name);
    ctx.refs.set(e, { kind: 'param', name });
    addParam(ctx, name);
    return;
  }
  if (e.k === 'id') {
    const r = resolve(e, lvl, outputs);
    ctx.refs.set(e, r);
    if (r.kind === 'param') addParam(ctx, r.name);
    return;
  }
  for (const c of children(e)) walk(c, lvl, ctx, outputs);
  if (e.k === 'bin' && CMP.has(e.op)) infer(ctx, e.l, e.r);
  else if (e.k === 'between') { infer(ctx, e.e, e.lo); infer(ctx, e.e, e.hi); }
  else if (e.k === 'in') e.list.forEach((x) => infer(ctx, e.e, x));
  else if (e.k === 'sub' || e.k === 'inSub') {
    const s = bindSelect(e.q, lvl, ctx);
    if ((e.k === 'inSub' || e.mode === 'scalar') && s.columns.length !== 1) fail('subqueryArity', show(e));
  }
}

// ---- Sources ----

function savedQuery(name: string, ctx: Ctx): BoundQuery {
  const seen = ctx.chain.findIndex((n) => sameName(n, name));
  if (seen >= 0) fail('circular', [...ctx.chain.slice(seen), name].join(' → '));
  // a binding is reused at its depth or shallower: deeper, its own saved sources might exceed MAX_SAVED_DEPTH
  const cached = ctx.saved.find(([n, , depth]) => sameName(n, name) && ctx.chain.length <= depth);
  if (cached) return cached[1];
  const sql = ctx.catalog.query(name);
  if (sql === null) return fail('unknownSource', name);
  if (ctx.chain.length >= MAX_SAVED_DEPTH) fail('tooDeep', name);
  const q = parseSql(sql);
  if (q.body.k === 'crosstab') fail('crosstabAsSource', name); // R12
  if (isSelectBody(q)) {
    const b = bindIn(q, ctx.catalog, [...ctx.chain, name], ctx.saved);
    ctx.saved.push([name, b, ctx.chain.length]);
    return b;
  }
  throw new Error('bc:notSelectQuery');
}

function bindSource(f: Exclude<FromItem, { k: 'join' }>, ctx: Ctx): BoundSource {
  if (f.k === 'derived') {
    const inner = bindIn({ params: [], body: f.q }, ctx.catalog, ctx.chain, ctx.saved);
    merge(ctx, inner.params);
    return { alias: f.alias, name: f.alias, kind: 'derived', inner };
  }
  const design = ctx.catalog.table(f.name);
  if (design) return { alias: f.alias ?? design.name, name: design.name, kind: 'table', design };
  const inner = savedQuery(f.name, ctx);
  merge(ctx, inner.params);
  return { alias: f.alias ?? f.name, name: f.name, kind: 'query', inner };
}

/** FROM: its sources (joins flattened, left to right), then the ON conditions, resolved against the whole level. */
function bindFrom(from: FromItem[], parent: Level | undefined, ctx: Ctx): Level {
  const sources: BoundSource[] = [], ons: Expr[] = [];
  const add = (f: FromItem): void => {
    if (f.k !== 'join') { sources.push(bindSource(f, ctx)); return; }
    add(f.l); add(f.r); ons.push(f.on);
  };
  from.forEach(add);
  sources.forEach((s, i) => { if (sources.slice(0, i).some((o) => sameName(o.alias, s.alias))) fail('ambiguousField', s.alias); });
  const lvl: Level = { sources, parent, outputs: [] };
  for (const on of ons) { walk(on, lvl, ctx, false); noAggregate(on); }
  return lvl;
}

// ---- SELECT ----

function bindSelect(q: SelectQuery, parent: Level | undefined, ctx: Ctx): BoundSelect {
  // FROM first (its parameters are listed after the select list's: order of appearance in the text)
  const outer = ctx.params;
  ctx.params = [];
  const lvl = bindFrom(q.from, parent, ctx);
  const fromParams = ctx.params;
  ctx.params = outer;

  const plan: { e: Expr; alias?: string; direct?: { s: BoundSource; c: Col } }[] = [];
  const direct = (e: Expr): { s: BoundSource; c: Col } | undefined => {
    const r = ctx.refs.get(e);
    if (r?.kind !== 'column' || r.depth !== 0) return undefined;
    const s = lvl.sources.find((x) => x.alias === r.alias)!;
    return { s, c: cols(s).find((x) => sameName(x.name, r.field))! };
  };
  for (const item of q.items) {
    if ('all' in item) {
      const list = item.table === undefined ? lvl.sources : [findSource(lvl, item.table) ?? fail('unknownSource', item.table)];
      for (const s of list) {
        for (const c of cols(s)) {
          const e: Expr = { k: 'id', name: c.name, table: s.alias };
          ctx.refs.set(e, { kind: 'column', alias: s.alias, field: c.name, type: c.type, props: c.props, depth: 0 });
          plan.push({ e, direct: { s, c } });
        }
      }
      continue;
    }
    walk(item.e, lvl, ctx, true); // earlier aliases only: they are pushed after their own item
    plan.push({ e: item.e, alias: item.alias, direct: direct(item.e) }); // `Nom AS Client` keeps its origin
    if (item.alias !== undefined) lvl.outputs.push({ name: item.alias, index: plan.length - 1, expr: item.e });
  }
  merge(ctx, fromParams);
  if (q.where) walk(q.where, lvl, ctx, true);
  for (const g of q.groupBy) walk(g, lvl, ctx, false); // GROUP BY never names an output alias, as in Access
  if (q.having) walk(q.having, lvl, ctx, true);
  for (const o of q.orderBy) walk(o.e, lvl, ctx, true);

  // Output names: the alias, else the field (T.F when another source gives the same name, or for the later ones of a field
  // given twice by the same source: `SELECT *, [T].[F]`, as in Access), else Expr1000, Expr1001…
  const names = plan.map((p, i) => {
    if (p.alias !== undefined) return p.alias;
    if (!p.direct) return undefined;
    const { s, c } = p.direct;
    const clash = plan.some((o, j) => j !== i && o.alias === undefined && o.direct && (o.direct.s !== s || j < i) && sameName(o.direct.c.name, c.name));
    return clash ? `${s.alias}.${c.name}` : c.name;
  });
  let n = 1000;
  const named = names.map((x) => {
    if (x !== undefined) return x;
    while (names.some((y) => y !== undefined && sameName(y, `Expr${n}`))) n++;
    return `Expr${n++}`;
  });
  named.forEach((x, i) => { if (named.slice(0, i).some((y) => sameName(x, y))) fail('duplicateOutput', x); });

  const grouped = checkGrouping(q, plan.map((p) => p.e), ctx);
  const bs: BoundSelect = {
    sources: lvl.sources, grouped,
    columns: plan.map((p, i) => {
      const origin = p.direct && (p.direct.s.design ? { table: p.direct.s.design.name, field: p.direct.c.name } : p.direct.c.origin);
      // type and props are filled once the parameters are typed (bindIn)
      return { name: named[i], type: 'shortText', props: defaultProps('shortText'), ...(origin && { origin }), expr: p.e };
    }),
  };
  ctx.selects.set(q, bs);
  return bs;
}

/** Aggregates and grouping of one SELECT (`items`: its column expressions, `*` expanded). Returns whether it is grouped. */
function checkGrouping(q: SelectQuery, items: Expr[], ctx: Ctx): boolean {
  if (q.where) noAggregate(q.where);
  q.groupBy.forEach(noAggregate);
  const exprs = [...items, ...(q.having ? [q.having] : []), ...q.orderBy.map((o) => o.e)];
  const grouped = q.groupBy.length > 0 || q.having !== undefined || exprs.some((e) => aggOf(e) !== null);
  if (!grouped) return false;
  const keys = q.groupBy;
  /** A column `n` subqueries below this SELECT that belongs to it: a bare GROUP BY column. */
  const isKey = (r: Extract<ResolvedRef, { kind: 'column' }>, n: number): boolean => keys.some((k) => {
    const kr = ctx.refs.get(k);
    return kr?.kind === 'column' && kr.depth === r.depth - n && sameName(kr.alias, r.alias) && sameName(kr.field, r.field);
  });
  const check = (e: Expr, n: number): void => {
    if (n === 0 && keys.some((k) => sameBound(k, e, ctx.refs))) return;
    if (n === 0 && e.k === 'call' && AGGREGATES.has(e.name)) {
      if (e.args.some((a) => aggOf(a))) fail('nestedAggregate', show(e));
      return;
    }
    if (e.k === 'id') {
      const r = ctx.refs.get(e);
      if (r?.kind === 'column' && r.depth === n && !isKey(r, n)) fail('notGrouped', show(e));
      return;
    }
    children(e).forEach((c) => check(c, n));
    if (e.k === 'sub' || e.k === 'inSub') selectExprs(e.q).forEach((c) => check(c, n + 1));
  };
  exprs.forEach((e) => check(e, 0));
  return true;
}

/** Same expression, identifiers compared by what they resolve to (`Nom` and `[Clients].[Nom]` are the same column). */
function sameBound(a: unknown, b: unknown, refs: Map<Expr, ResolvedRef>): boolean {
  if (a === b) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || !a || !b) return false;
  const [ra, rb] = [refs.get(a as Expr), refs.get(b as Expr)];
  if (ra || rb) {
    if (ra?.kind === 'column' && rb?.kind === 'column') return ra.depth === rb.depth && sameName(ra.alias, rb.alias) && sameName(ra.field, rb.field);
    if (ra?.kind === 'param' && rb?.kind === 'param') return sameName(ra.name, rb.name);
    return ra?.kind === 'output' && rb?.kind === 'output' && ra.index === rb.index;
  }
  const [ka, kb] = [Object.keys(a), Object.keys(b)];
  return ka.length === kb.length && ka.every((k) => sameBound((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k], refs));
}

// ---- Query ----

/** A crosstab bound as its rewritten SELECT (B4 R9): with `headings` (expandCrosstab: named in the region), else its IN
 *  list, else (headings from the data) one placeholder Null heading, so the value's and the pivot's parameters and grouping
 *  are bound too; its column is dropped. Heading columns are bound under aliases no identifier can name (`\u0001<i>`), so
 *  a heading named like a parameter never captures it; the names, and R9's duplicateOutput check, come after. */
function bindCrosstab(q: Query, x: CrosstabQuery, catalog: QueryCatalog, chain: string[], saved: Ctx['saved'], headings?: Heading[]): BoundQuery {
  if (!x.select.groupBy.length) fail('crosstabRowHeading');
  if (!aggOf(x.value)) fail('crosstabValue', show(x.value));
  const a = aggOf(x.pivot);
  if (a) fail('pivotAggregate', show(a));
  const fixed = !!x.headings?.length;
  const values = headings?.map((h) => h.value) ?? (fixed ? inValues(x).map(literalOf) : [{ k: 'null' } as Expr]);
  const n = x.select.items.length + values.length;
  if (values.length > MAX_PIVOT_COLUMNS || n > MAX_COLUMNS) fail('tooManyColumns', String(n));
  // no field name holds a control character
  const out = bindIn({ params: q.params, body: crosstabSelect(x, values.map((value, i) => ({ name: `\u0001${i}`, value }))) }, catalog, chain, saved);
  const rows = out.columns.length - values.length;
  if (headings) {
    headings.forEach((h, i) => { out.columns[rows + i].name = h.name; });
    out.columns.forEach((c, i) => { if (out.columns.slice(0, i).some((o) => sameName(o.name, c.name))) fail('duplicateOutput', c.name); });
  } else if (!fixed) out.columns = out.columns.slice(0, rows);
  out.crosstab = { headings: fixed ? 'fixed' : 'data', source: q };
  return out;
}

function bindIn(q: Query, catalog: QueryCatalog, chain: string[], saved: Ctx['saved'], headings?: Heading[]): BoundQuery {
  if (q.body.k === 'crosstab') return bindCrosstab(q, q.body, catalog, chain, saved, headings);
  const ctx: Ctx = {
    catalog, chain, saved, refs: new Map(), selects: new Map(),
    params: q.params.map((p) => ({ name: p.name, type: p.type, props: { ...defaultProps(p.type), ...(p.numberSize && { numberSize: p.numberSize }), required: false } })),
  };
  const out: BoundQuery = { query: q, columns: [], params: [], sources: [], refs: ctx.refs, aggregate: false, updatable: false, selects: ctx.selects };
  const body = q.body;
  let union: BoundSelect | undefined;
  switch (body.k) {
    case 'select': {
      const s = bindSelect(body, undefined, ctx);
      if (body.into !== undefined && (!isValidObjectName(body.into) || isReservedName(body.into))) fail('unknownTarget', body.into);
      Object.assign(out, { columns: s.columns, sources: s.sources, aggregate: s.grouped });
      // a single saved query carries its own plan (A3); otherwise the plan of this FROM (B4 R1)
      const saved = body.from.length === 1 && body.from[0].k === 'source' && s.sources[0].kind === 'query' ? s.sources[0] : undefined;
      const plan = saved ? (saved.inner!.updatable ? saved.inner!.writePlan! : null) : writePlan(s.sources, body.from, ctx.refs);
      if (plan && !s.grouped && !body.distinct && body.into === undefined) {
        Object.assign(out, { updatable: true, keyTable: plan[0].table, keyAlias: saved?.alias ?? plan[0].alias, writePlan: plan,
          writeLevel: saved ? saved.inner!.writeLevel : out });
      }
      break;
    }
    case 'union': {
      const parts = body.parts.map((p) => bindSelect(p, undefined, ctx));
      if (parts.some((p) => p.columns.length !== parts[0].columns.length)) fail('unionArity');
      union = parts[0];
      const lvl: Level = { sources: [], outputs: union.columns.map((c, index) => ({ name: c.name, index, expr: c.expr })) };
      for (const o of body.orderBy) walk(o.e, lvl, ctx, true);
      Object.assign(out, { sources: parts.flatMap((p) => p.sources), aggregate: parts.some((p) => p.grouped) });
      break;
    }
    case 'insert': {
      const design = catalog.table(body.target) ?? fail('unknownTarget', body.target);
      body.columns.forEach((c, i) => {
        if (!design.fields.some((x) => sameName(x.name, c))) fail('unknownTarget', c);
        if (body.columns.slice(0, i).some((x) => sameName(x, c))) fail('duplicateOutput', c);
      });
      let count: number | null; // null: mapped by name
      if ('values' in body.source) {
        const lvl: Level = { sources: [], outputs: [] };
        for (const v of body.source.values) { walk(v, lvl, ctx, false); noAggregate(v); }
        count = body.source.values.length;
      } else {
        const s = bindSelect(body.source, undefined, ctx);
        Object.assign(out, { sources: s.sources, aggregate: s.grouped });
        count = s.columns.length;
        // without a field list, each output column goes to the target field of its name, as in Access
        if (!body.columns.length) {
          for (const c of s.columns) if (!design.fields.some((x) => sameName(x.name, c.name))) fail('unknownTarget', c.name);
          count = null;
        }
      }
      if (count !== null && count !== (body.columns.length || design.fields.length)) fail('insertArity');
      out.keyTable = design.name;
      break;
    }
    case 'update': {
      const lvl = bindFrom([body.from], undefined, ctx);
      let target: BoundSource | undefined;
      for (const { target: t, value } of body.set) {
        const r = t.k === 'id' ? resolve(t, lvl, false) : undefined;
        const s = r?.kind === 'column' ? lvl.sources.find((x) => x.alias === r.alias) : undefined;
        if (!s || s.kind !== 'table' || (target && target !== s)) fail('updateTarget', show(t));
        target = s;
        ctx.refs.set(t, r!);
        walk(value, lvl, ctx, false);
        noAggregate(value);
      }
      if (body.where) { walk(body.where, lvl, ctx, false); noAggregate(body.where); }
      Object.assign(out, { sources: lvl.sources, keyTable: target!.design!.name, keyAlias: target!.alias });
      break;
    }
    case 'delete': {
      const lvl = bindFrom([body.from], undefined, ctx);
      const s = body.target !== undefined ? findSource(lvl, body.target) ?? fail('unknownTarget', body.target)
        : lvl.sources.length === 1 ? lvl.sources[0] : fail('updateTarget');
      if (s.kind !== 'table') fail('updateTarget', s.alias);
      if (body.where) { walk(body.where, lvl, ctx, false); noAggregate(body.where); }
      Object.assign(out, { sources: lvl.sources, keyTable: s.design!.name, keyAlias: s.alias });
      break;
    }
  }
  out.params = ctx.params.map((p) => (p.type === null ? { name: p.name, type: null } : p));
  for (const s of ctx.selects.values()) {
    for (const c of s.columns) Object.assign(c, { type: exprType(c.expr, out), props: columnProps(c.expr, out) });
  }
  if (union) out.columns = union.columns.map(({ origin: _, ...c }) => c); // names and types of the first part
  return out;
}

/** Binds a parsed query against the catalog. Throws QueryBindError, Error('bc:notSelectQuery') for an action query used
 *  as a source, or the ExprSyntaxError of a saved query that does not parse. `name`: the saved query `q` is (opened or
 *  being saved), first in the chain, so a cycle through it reads `QA → QB → QA`. */
export function bindQuery(q: Query, catalog: QueryCatalog, name?: string, headings?: Heading[] /* a crosstab's: expandCrosstab */): BoundQuery {
  return bindIn(q, catalog, name === undefined ? [] : [name], [], headings);
}

export function toSourceInfo(b: BoundQuery): SourceInfo {
  return {
    fields: b.columns.map(({ name, type, props, origin }) => (origin ? { name, type, props, origin } : { name, type, props })),
    updatable: b.updatable, ...(b.updatable && { keyTable: b.keyTable }), parameters: b.params,
    ...(b.crosstab && { crosstab: { headings: b.crosstab.headings } }),
    ...(b.updatable && b.writePlan && { tables: b.writePlan.map((w) => ({ table: w.table, role: w.role, readOnly: w.readOnly, lookupBy: lookupBy(b, w) })) }),
  };
}

/** Output columns whose change looks `w` up: those showing a child field of a join on the way from the key table to `w` (R4). */
function lookupBy(b: BoundQuery, w: WriteTable): string[] {
  const plan = b.writePlan!, links: { table: string; field: string }[] = [];
  for (let x: WriteTable | undefined = w; x?.parent; ) {
    const via = plan.find((y) => y.alias === x!.parent!.via)!;
    links.push(...x.parent.pairs.map((p) => ({ table: via.table, field: p.child })));
    x = via;
  }
  return b.columns.filter((c) => c.origin && links.some((l) => sameName(l.table, c.origin!.table) && sameName(l.field, c.origin!.field))).map((c) => c.name);
}

// ---- Types ----

/** Type of an expression of the bound query (Access's rules; Sum/Avg as the shared accumulator returns them, C12). */
export function exprType(e: Expr, b: BoundQuery): FieldType {
  switch (e.k) {
    case 'id': case 'member': {
      const r = b.refs.get(e);
      if (r?.kind === 'column') return r.type;
      if (r?.kind === 'param') return b.params.find((p) => sameName(p.name, r.name))?.type ?? 'shortText';
      const target = outputTargets.get(e);
      return target ? exprType(target, b) : 'shortText';
    }
    case 'num': case 'star': return 'number';
    case 'date': return 'dateTime';
    case 'bool': case 'like': case 'between': case 'in': case 'inSub': case 'isnull': return 'yesNo';
    case 'sub': {
      const first = b.selects.get(e.q)?.columns[0];
      return e.mode === 'exists' ? 'yesNo' : first ? exprType(first.expr, b) : 'shortText';
    }
    case 'un': {
      const t = exprType(e.e, b);
      return e.op === 'Not' ? 'yesNo' : t === 'currency' || t === 'dateTime' ? t : 'number';
    }
    case 'bin': {
      if (!['&', '+', '-', '*', '/', '\\', 'Mod', '^'].includes(e.op)) return 'yesNo';
      const [l, r] = [exprType(e.l, b), exprType(e.r, b)];
      // as the evaluator (`binary`): + of two texts concatenates; a date + anything, or one date in a -, is a date
      if (e.op === '&' || (e.op === '+' && TEXT.has(l) && TEXT.has(r))) return textOf([l, r]);
      const dates = Number(l === 'dateTime') + Number(r === 'dateTime');
      if ((e.op === '+' && dates) || (e.op === '-' && dates === 1)) return 'dateTime';
      if (e.op === '+' || e.op === '-') return l === 'currency' && r === 'currency' ? 'currency' : 'number';
      const num = (x: FieldType): boolean => x === 'number' || x === 'autoNumber';
      if (e.op === '*' || e.op === '/') return (l === 'currency' && num(r)) || (num(l) && r === 'currency') ? 'currency' : 'number';
      return 'number';
    }
    case 'call': {
      if (e.name === 'Sum' || e.name === 'Avg') return sumAvg(e, b).type;
      const ret = RET.get(e.name)!;
      const t = ret === 'arg0' || ret === 'arg1' ? branchesType(e, b) : ret;
      return t === 'autoNumber' ? 'number' : t; // a computed value is never numbered automatically
    }
    default: return 'shortText'; // str, null
  }
}

const TEXT: ReadonlySet<FieldType> = new Set(['shortText', 'longText', 'hyperlink']);
/** Text made from these types: Long Text when one may be unbounded (Long Text, Hyperlink: no 255 limit in schema or coerce),
 *  so a Make-Table column holds notes over 255 characters. */
const textOf = (ts: FieldType[]): FieldType => (ts.some((t) => t === 'longText' || t === 'hyperlink') ? 'longText' : 'shortText');
const NUMERIC: ReadonlySet<FieldType> = new Set(['number', 'currency', 'autoNumber']);
type Call = Extract<Expr, { k: 'call' }>;
const intLiteral = (x: Expr): x is Extract<Expr, { k: 'num' }> => x.k === 'num' && /^-?\d+$/.test(x.v);

/** The values a function returning its argument may give (IIf: either branch; Nz: the value or its replacement; Min…: the
 *  argument), Null literals left out; an integer literal takes the others' type (`Nz([Prix], 0)` stays Currency). */
function branches(e: Call): { typed: Expr[]; literals: Extract<Expr, { k: 'num' }>[] } {
  const xs = (RET.get(e.name) === 'arg1' ? e.args.slice(1) : e.args).filter((x) => x.k !== 'null');
  const typed = xs.filter((x) => !intLiteral(x));
  return typed.length ? { typed, literals: xs.filter(intLiteral) } : { typed: xs, literals: [] };
}

/** One type when every branch has it; numbers of different types are a Double; anything else mixed is a Variant (text,
 *  Long Text when a branch is: `Nz([Notes], "")` keeps its notes). */
function branchesType(e: Call, b: BoundQuery): FieldType {
  const ts = [...new Set(branches(e).typed.map((x) => exprType(x, b)))];
  return ts.length === 1 ? ts[0]! : ts.length && ts.every((t) => NUMERIC.has(t)) ? 'number' : textOf(ts);
}

/** Number size of IIf/Nz/Min…: only when every branch has the same one and each integer literal fits it, so a parameter
 *  compared with `IIf(c, [Octet], [Réel])` is no Byte that would round 2.75 to 3. */
function branchesNumInfo(e: Call, b: BoundQuery): NumInfo | undefined {
  const { typed, literals } = branches(e);
  const infos = typed.map((x) => numInfo(x, b));
  const n = infos[0];
  const same = (i: NumInfo | undefined): boolean => i?.numberSize === n?.numberSize
    && (n?.numberSize !== 'decimal' || (i?.precision === n?.precision && i?.scale === n?.scale));
  const fits = (x: Extract<Expr, { k: 'num' }>): boolean => {
    const range = n?.numberSize && RANGES[n.numberSize];
    if (range) return Number(x.v) >= range[0] && Number(x.v) <= range[1];
    return n?.numberSize !== 'decimal' || x.v.replace(/^-?0*/, '').length <= (n.precision ?? 18) - (n.scale ?? 0);
  };
  return n && infos.every(same) && literals.every(fits) ? n : undefined;
}
type NumInfo = Pick<FieldProps, 'numberSize' | 'precision' | 'scale'>;
const sizeOf = (type: FieldType | null, props?: FieldProps): NumInfo | undefined => (type === 'autoNumber' ? { numberSize: 'longInteger' }
  : type === 'number' ? { numberSize: props?.numberSize, precision: props?.precision, scale: props?.scale } : undefined);

/**
 * Type the accumulator of an aggregate uses for its argument `arg` (`createAccumulator`): the foundation's aggregateArgType
 * (C5), with each identifier resolved through the binding (`b.refs`, output aliases followed), so `[Clients].[N°]` and
 * `[Commandes].[N°]` stay distinct; a parameter is undefined. The bc_agg_* UDFs (Task 4) and the Sum/Avg column types
 * (C12) both use it, so a column's declared type is the one its total is computed in.
 */
export function boundArgType(arg: Expr, b: BoundQuery): { type: FieldType | null; props?: FieldProps } {
  const fields: ({ type: FieldType; props: FieldProps } | undefined)[] = [];
  /** `arg` with each identifier renamed to its index in `fields` (only the nodes aggregateArgType looks into). */
  const keyed = (x: Expr): Expr => {
    switch (x.k) {
      case 'id': {
        const target = outputTargets.get(x);
        if (target) return keyed(target);
        const r = b.refs.get(x);
        fields.push(r?.kind === 'column' ? { type: r.type, props: r.props } : undefined);
        return { k: 'id', name: String(fields.length - 1) };
      }
      case 'un': return { ...x, e: keyed(x.e) };
      case 'bin': return { ...x, l: keyed(x.l), r: keyed(x.r) };
      case 'call': return { ...x, args: x.args.map(keyed) };
      default: return x;
    }
  };
  return aggregateArgType(keyed(arg), (key) => fields[Number(key)]);
}

/** Sum/Avg result (C12), as the accumulator returns it for its argument type: Currency stays Currency, Decimal stays Decimal
 *  (precision 28; a Sum at the argument's scale, an Avg wider: the accumulator divides at the scale + 19, and an average has
 *  no more integer digits than its argument); anything else is a Double, integers included: their exact total is unbounded
 *  (a Sum of Bytes passes 255, of Long Integers 2^31) and may grow decimals, so no integer size holds it. */
function sumAvg(e: Call, b: BoundQuery): { type: FieldType; num?: NumInfo } {
  const a = boundArgType(e.args[0]!, b);
  if (a.type === 'currency') return { type: 'currency' };
  if (sizeOf(a.type, a.props)?.numberSize !== 'decimal') return { type: 'number', num: { numberSize: 'double' } };
  const scale = a.props?.scale ?? 0;
  // ponytail: an expression's Decimal (aggregateArgType) declares precision 28, so all its digits may be integer ones and
  // its Avg keeps the argument's scale; widen it too once aggregateArgType reports an expression's integer digits.
  const avgScale = Math.min(scale + 19, 28 - ((a.props?.precision ?? 18) - scale));
  return { type: 'number', num: { numberSize: 'decimal', precision: 28, scale: e.name === 'Avg' ? avgScale : scale } };
}

/** Number size of a `number` expression when known (field, parameter, Sum/Avg, a function returning its argument). */
function numInfo(e: Expr, b: BoundQuery): NumInfo | undefined {
  if (e.k === 'id' || e.k === 'member') {
    const target = outputTargets.get(e);
    if (target) return numInfo(target, b);
    const r = b.refs.get(e);
    if (r?.kind === 'column') return sizeOf(r.type, r.props);
    const p = r?.kind === 'param' ? b.params.find((x) => sameName(x.name, r.name)) : undefined;
    return p && sizeOf(p.type, p.props);
  }
  if (e.k !== 'call') return undefined;
  if (e.name === 'Sum' || e.name === 'Avg') return sumAvg(e, b).num;
  const ret = RET.get(e.name);
  return ret === 'arg0' || ret === 'arg1' ? branchesNumInfo(e, b) : undefined;
}

/** Props of an output column: those of the field it shows (caption, format, lookup…), else the defaults of its type. */
function columnProps(e: Expr, b: BoundQuery): FieldProps {
  const target = e.k === 'id' ? outputTargets.get(e) : undefined;
  if (target) return columnProps(target, b);
  const r = e.k === 'id' ? b.refs.get(e) : undefined;
  if (r?.kind === 'column') return r.props;
  const type = exprType(e, b);
  // a computed number of unknown size is a Double: a Long Integer would round 2.5 (Make-Table, parameter inference)
  const num = type === 'number' ? numInfo(e, b) ?? { numberSize: 'double' } : undefined;
  return { ...defaultProps(type), ...(num && Object.fromEntries(Object.entries(num).filter(([, v]) => v !== undefined))) };
}
