// PostgreSQL generator of whole reads (C4 R14, R15). Pure: no import of `pg`. A bound SELECT or UNION and a page request
// become two statements over one derived table `q`: its columns c0…cn, the query's own ORDER BY keys o0… (R15: a derived
// table loses its order), the key columns' own values k0… and `xmin` as v; the outer select filters, counts and pages it.
// Every value is a parameter (pgNumber); TOP's count, a literal integer of the query, is the only number written as text.
import type { Expr } from '../../../shared/expr/ast';
import { sameName, type FieldProps, type FieldType } from '../../../shared/field-types';
import type { FromItem, SelectQuery } from '../../../shared/query/ast';
import { exprType, type BoundParam, type BoundQuery, type BoundSelect, type BoundSource, type ResolvedRef } from '../../../shared/query/bind';
import type { ReadRequest } from '../connector';
import { pgCondition, pgIdent, pgNumber, pgOrderKeys, pgValue, type PgExprCtx, type PgFrag, type PgParam } from './sql-expr';

/** The statements of a read: `rows` takes $a (limit) and $b (offset) as its last two parameters. Output: c0…cn, then with
 *  `version` k0…km (key texts: the inner select's key values, `::text` in the outer one, R15) and v (xmin::text); `keys`: the
 *  key table's key column names (none without `version`), which each row's token names.
 *  bc:serverNotSupported|crosstab|topPercent|actionQuery|other|postgresql, bc:serverFunction|…, bc:missingParameter||<name>. */
export interface PgPlan { rows: string; count: string; params: PgParam[]; columns: number; keys: string[]; version: boolean }

/** What Task 9 marks on a field whose PostgreSQL type the expression generator cannot read as is (sql-expr's `resolve`
 *  contract): `timestamp` (date, timestamptz: the session's zone is the workstation's), `time` (on 1899-12-30, as Access),
 *  `text` (enum, json, jsonb, uuid). Unmarked: already a timestamp, text, number or boolean. A key column is never cast. */
export type PgCast = 'timestamp' | 'time' | 'text';
export const present = (sql: string, props: FieldProps): string => {
  switch (props.pgCast as PgCast | undefined) {
    case 'timestamp': return `${sql}::timestamp`;
    case 'time': return `(date '1899-12-30' + ${sql})`;
    case 'text': return `${sql}::text`;
    default: return sql;
  }
};

const refuse = (feature: string): never => { throw new Error(`bc:serverNotSupported|${feature}|postgresql`); };
const invalid = (): never => { throw new Error('bc:invalidArgument'); };
type F = PgFrag;
function cat(...xs: (string | F)[]): F {
  const params: PgParam[] = [];
  let sql = '';
  for (const x of xs) {
    if (typeof x === 'string') sql += x;
    else { sql += x.sql; params.push(...x.params); }
  }
  return { sql, params };
}
const list = (xs: F[], sep = ', '): F => cat(...xs.flatMap((x, i) => (i ? [sep, x] : [x])));
const TEXT: ReadonlySet<FieldType> = new Set(['shortText', 'longText', 'hyperlink']);
const NUMBER_CAST: Record<string, PgParam['cast']> = { single: 'float8', double: 'float8', decimal: 'numeric' };
export const castOf = (p: BoundParam | undefined): PgParam['cast'] => {
  switch (p?.type) {
    case 'number': case 'autoNumber': return NUMBER_CAST[p.props?.numberSize ?? ''] ?? 'int4';
    case 'currency': return 'numeric';
    case 'dateTime': return 'timestamp';
    case 'yesNo': return 'boolean';
    default: return 'text'; // a text, or untyped (paramValues gives it as text)
  }
};

/** R15's ORDER BY keys of a value: text folded in the collation, then exact; the first key alone decides TOP's ties (Access
 *  ties "Lyon" and "LYON"). Each key is written with its collation, so a hidden column carries it to the outer select. */
function sortKeys(x: F, type: FieldType, dir: 'asc' | 'desc', collation: string | null): { x: F; d: string }[] {
  const d = dir === 'asc' ? 'ASC NULLS FIRST' : 'DESC NULLS LAST';
  if (!TEXT.has(type)) return [{ x, d }];
  return [{ x: cat('lower(', x, `)${collation ? ` COLLATE ${pgIdent(collation)}` : ''}`), d }, { x: cat('(', x, ') COLLATE "C"'), d: dir.toUpperCase() }];
}
/** The keys of an ORDER BY: every folded key first, the exact ones after, so `ORDER BY Nom, id` orders "Dupont" and
 *  "dupont" by id, as Access (the exact text only breaks the ties left). */
const orderKeys = (order: { x: F; d: string }[][]) => [...order.map((k) => k[0]!), ...order.flatMap((k) => k.slice(1))];

/** The SELECT being written, with the alias of each of its sources. */
interface Level { b: BoundQuery; sel: BoundSelect; alias: Map<BoundSource, string> }
/** `raw`: a field selected as stored (its presented form), not as a value (a Yes/No stays boolean); `order`: the directions of
 *  the hidden keys o0… (the top level only); `keys`, `version`: k0… and v, through the key source. */
interface Mode { raw: boolean; order?: string[]; keys: boolean; version: boolean }
const PLAIN: Mode = { raw: false, keys: false, version: false };

export function pgPlan(r: ReadRequest, collation: string | null): PgPlan {
  const b = r.query, top = b.query.body;
  if (b.crosstab && !b.crosstab.expanded) refuse('crosstab'); // C7 R15: only an expanded one
  if (top.k !== 'union' && (top.k !== 'select' || top.into !== undefined)) refuse('actionQuery');
  let next = 0; // source aliases, unique in the statement: a correlated subquery names the enclosing ones
  let outerJoin = false; // somewhere in the statement: a key may then be Null on many rows

  const param = (qb: BoundQuery, name: string) => {
    const key = Object.keys(r.values).find((k) => sameName(k, name));
    if (key === undefined) throw new Error(`bc:missingParameter||${name}`);
    const p = qb.params.find((x) => sameName(x.name, name)), cast = castOf(p);
    return { sql: `$1::${cast}`, type: p?.type ?? null, params: [{ value: r.values[key]!, cast }], param: true as const };
  };
  const tableSql = (s: BoundSource): string => {
    const t = r.tables(s.name);
    return `${t.schema !== undefined ? `${pgIdent(t.schema)}.` : ''}${pgIdent(t.remote)}`;
  };
  const column = (stack: Level[], c: Extract<ResolvedRef, { kind: 'column' }>): string => {
    const l = stack[stack.length - 1 - c.depth]!;
    const s = l.sel.sources.find((x) => x.alias === c.alias)!;
    const a = l.alias.get(s)!;
    return s.kind === 'table' ? present(`${a}.${pgIdent(c.field)}`, c.props) : `${a}."c${s.inner!.columns.findIndex((x) => x.name === c.field)}"`;
  };
  /** The key fields of `qb`'s key source (a table's, or through a saved or derived query), [] when it has none. */
  const keysOf = (qb: BoundQuery): string[] => {
    const s = qb.keyAlias === undefined ? undefined : qb.sources.find((x) => x.alias === qb.keyAlias);
    return !s ? [] : s.kind === 'table' ? r.tables(s.name).key : keysOf(s.inner!);
  };

  const ctx = (stack: Level[]): PgExprCtx => {
    const lvl = stack[stack.length - 1]!;
    const c: PgExprCtx = {
      resolve: (e) => {
        const ref = lvl.b.refs.get(e);
        if (ref?.kind === 'param') return param(lvl.b, ref.name);
        if (ref?.kind === 'column') return { sql: column(stack, ref), type: ref.type };
        if (ref?.kind !== 'output') return invalid();
        const col = lvl.sel.columns[ref.index]!, v = pgValue(col.expr, c); // an alias of the same SELECT: its expression
        return { sql: `(${v.sql})`, type: col.type, params: v.params };
      },
      typeOf: (e) => exprType(e, lvl.b),
      subquery: (q) => select(q, lvl.b, stack, PLAIN),
      now: r.now, collation,
    };
    return c;
  };

  function select(q: SelectQuery, qb: BoundQuery, outer: Level[], m: Mode): F {
    if (q.top?.percent) refuse('topPercent');
    const sel = qb.selects.get(q)!;
    const lvl: Level = { b: qb, sel, alias: new Map(sel.sources.map((s) => [s, `a${next++}`])) };
    const stack = [...outer, lvl], c = ctx(stack);
    const keyed = m.keys || m.version ? sel.sources.find((x) => x.alias === qb.keyAlias) : undefined;
    let i = 0; // sources in binding order: joins flattened left to right
    const fromItem = (x: FromItem): F => {
      if (x.k === 'join') {
        if (x.kind !== 'inner') outerJoin = true;
        const l = fromItem(x.l);
        const rr = x.r.k === 'join' ? cat('(', fromItem(x.r), ')') : fromItem(x.r);
        return cat(l, ` ${x.kind.toUpperCase()} JOIN `, rr, ' ON ', pgCondition(x.on, c));
      }
      const s = sel.sources[i++]!, as = ` AS ${lvl.alias.get(s)}`;
      if (s.kind === 'table') return cat(tableSql(s), as);
      return cat('(', body(s.inner!, { raw: true, keys: s === keyed && m.keys, version: s === keyed && m.version }), ')', as);
    };
    /** A field as stored (its presented form), else the value. */
    const item = (e: Expr, raw: boolean): F => {
      const ref = e.k === 'id' ? qb.refs.get(e) : undefined;
      return raw && ref?.kind === 'column' ? { sql: column(stack, ref), params: [] } : pgValue(e, c);
    };
    const from = q.from.length ? cat(' FROM ', list(q.from.map(fromItem))) : '';
    const cols = sel.columns.map((col, k) => cat(item(col.expr, m.raw), ` AS "c${k}"`));
    const order = m.order || q.top ? q.orderBy.map((o) => sortKeys(pgValue(o.e, c), exprType(o.e, qb), o.dir, collation)) : [];
    // DISTINCT needs its ORDER BY in the select list (42P10): below the top level, the TOP's keys go hidden and a wrapper
    // keeps the columns c0… only (a UNION part or an In subquery takes no extra column)
    const wrap = !m.order && q.distinct && q.top && order.length > 0;
    if (m.order) {
      orderKeys(order).forEach((key, j) => { cols.push(cat(key.x, ` AS "o${j}"`)); m.order!.push(key.d); });
    } else if (wrap) order.forEach(([key], j) => cols.push(cat(key!.x, ` AS "o${j}"`)));
    if (keyed) {
      const a = lvl.alias.get(keyed)!;
      if (m.keys) keysOf(qb).forEach((k, j) => cols.push({ sql: `${a}.${keyed.kind === 'table' ? pgIdent(k) : `"k${j}"`} AS "k${j}"`, params: [] }));
      if (m.version) cols.push({ sql: `${a}.${keyed.kind === 'table' ? 'xmin::text' : '"v"'} AS "v"`, params: [] });
    }
    let top = '';
    if (q.top) {
      if (!Number.isSafeInteger(q.top.n) || q.top.n < 0) invalid();
      top = order.length ? ` FETCH FIRST ${q.top.n} ROWS WITH TIES` : ` LIMIT ${q.top.n}`;
    }
    const out = cat(
      `SELECT ${q.distinct ? 'DISTINCT ' : ''}`, list(cols), from,
      q.where ? cat(' WHERE ', pgCondition(q.where, c)) : '',
      q.groupBy.length ? cat(' GROUP BY ', list(q.groupBy.map((e) => item(e, true)))) : '', // as the select list writes a field
      q.having ? cat(' HAVING ', pgCondition(q.having, c)) : '',
      q.top && order.length ? cat(' ORDER BY ', list(order.map(([k]) => cat(k!.x, ` ${k!.d}`)))) : '', // only TOP needs an order here
      top,
    );
    return wrap ? cat(`SELECT ${sel.columns.map((_, k) => `"c${k}"`).join(', ')} FROM (`, out, `) AS a${next++}`) : out;
  }

  /** The SELECT or UNION of `qb` (the query, a saved source or a derived table: never correlated, so a fresh stack). */
  function body(qb: BoundQuery, m: Mode): F {
    const q = qb.query.body;
    if (q.k === 'select') return select(q, qb, [], m);
    if (q.k !== 'union') return refuse('other');
    // parts as values (their column types must agree), each in parentheses (its own ORDER BY … WITH TIES)
    const parts = q.parts.map((p, k) => cat(k ? (q.all[k - 1] ? ' UNION ALL ' : ' UNION ') : '', '(', select(p, qb, [], PLAIN), ')'));
    if (!m.order || !q.orderBy.length) return cat(...parts);
    const c: PgExprCtx = { // ORDER BY names output columns
      resolve: (e) => {
        const ref = qb.refs.get(e);
        if (ref?.kind === 'param') return param(qb, ref.name);
        return ref?.kind === 'output' ? { sql: `u."c${ref.index}"`, type: qb.columns[ref.index]!.type } : invalid();
      },
      typeOf: (e) => exprType(e, qb), now: r.now, collation,
    };
    const keys = orderKeys(q.orderBy.map((o) => sortKeys(pgValue(o.e, c), exprType(o.e, qb), o.dir, collation)));
    keys.forEach((k) => m.order!.push(k.d));
    return cat('SELECT u.*, ', list(keys.map((k, j) => cat(k.x, ` AS "o${j}"`))), ' FROM (', ...parts, ') AS u');
  }

  const keys = keysOf(b), version = r.refs && keys.length > 0;
  const m: Mode = { raw: true, order: [], keys: keys.length > 0, version };
  const inner = body(b, m);

  // page criteria and `where` name output columns, read from q
  const outCol = new Map<Expr, number>(), outRefs = new Map<Expr, ResolvedRef>();
  const out = (k: number): Expr => {
    const e: Expr = { k: 'id', name: b.columns[k]!.name };
    outCol.set(e, k);
    outRefs.set(e, { kind: 'column', alias: 'q', field: b.columns[k]!.name, type: b.columns[k]!.type, props: b.columns[k]!.props, depth: 0,
      src: { alias: 'q', name: 'q', kind: 'derived' } });
    return e;
  };
  const named = (x: unknown, subject?: number): unknown => {
    if (Array.isArray(x)) return x.map((y) => named(y, subject));
    if (!x || typeof x !== 'object') return x;
    const e = x as Expr;
    if (e.k === 'subject' && subject !== undefined) return out(subject);
    if (e.k === 'member') invalid();
    if (e.k === 'id') {
      const k = b.columns.findIndex((col) => sameName(col.name, e.table === undefined ? e.name : `${e.table}.${e.name}`));
      return k < 0 ? invalid() : out(k);
    }
    return Object.fromEntries(Object.entries(e).map(([k, v]) => [k, named(v, subject)]));
  };
  const stub = { ...b, refs: outRefs } as BoundQuery;
  const qctx: PgExprCtx = { resolve: (e) => { const k = outCol.get(e)!; return { sql: `q."c${k}"`, type: b.columns[k]!.type }; }, typeOf: (e) => exprType(e, stub), now: r.now, collation };
  const conds = [...r.filter.map((f) => named(f.criteria, f.column)), ...(r.where ? [named(r.where)] : [])]
    .map((e) => cat('(', pgCondition(e as Expr, qctx), ')'));
  const n = pgNumber(cat(' FROM (', inner, ') AS q', conds.length ? cat(' WHERE ', list(conds, ' AND ')) : ''));

  const shown = (k: number) => (b.columns[k]!.type === 'yesNo' ? `-abs(q."c${k}"::int4)` : `q."c${k}"`); // Yes/No sorts as -1/0
  const orderBy = [
    ...r.sort.map((s) => pgOrderKeys({ sql: shown(s.column), params: [] }, b.columns[s.column]!.type, s.dir, collation).sql),
    ...m.order!.map((d, j) => `q."o${j}" ${d}`),
    // stable pages (R15): the keys; every output column without keys, or after them when an outer join leaves keys Null
    ...keys.map((_, j) => `q."k${j}"`), ...(!keys.length || outerJoin ? b.columns.map((_, k) => `q."c${k}"`) : []),
  ];
  const outCols = [...b.columns.map((_, k) => `q."c${k}"`), ...(version ? [...keys.map((_, j) => `q."k${j}"::text`), 'q."v"'] : [])];
  const at = n.params.length + 1;
  return {
    rows: `SELECT ${outCols.join(', ')}${n.sql} ORDER BY ${orderBy.join(', ')} LIMIT $${at} OFFSET $${at + 1}`,
    count: `SELECT count(*)${n.sql}`,
    params: n.params, columns: b.columns.length, keys: version ? keys : [], version,
  };
}
