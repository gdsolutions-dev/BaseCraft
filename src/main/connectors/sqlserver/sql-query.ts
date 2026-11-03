// SQL Server generator of whole reads (C5 R6, R10), on postgres/sql-query.ts's shape. Pure: no import of `tedious`. A bound
// SELECT or UNION and a page request become two statements over one derived table `q`: its columns c0…cn, the query's own
// ORDER BY keys o0… (a derived table loses its order, and T-SQL refuses an ORDER BY there without TOP), the key columns'
// texts k0… and the rowversion as v; the outer select filters, counts, pages it and converts what `tedious` would parse
// (decimals, dates) to exact text (R6). Every value is a parameter (msNumber); TOP's count, a literal integer of the query, is
// the only number written as text.
import type { Expr } from '../../../shared/expr/ast';
import { sameName, type FieldProps, type FieldType } from '../../../shared/field-types';
import type { FromItem, SelectQuery } from '../../../shared/query/ast';
import { exprType, type BoundParam, type BoundQuery, type BoundSelect, type BoundSource, type ResolvedRef } from '../../../shared/query/bind';
import type { ReadRequest, RemoteTable } from '../connector';
import { msCollate, msCondition, msIdent, msNumber, msOrderKeys, msValue, type MsExprCtx, type MsFrag, type MsParam } from './sql-expr';

/** The statements of a read: `rows` takes the offset and the limit as its last two parameters (@p<n>, @p<n+1>, after
 *  `params`; nvarchar digits as every parameter, R7, cast to bigint in the text; the limit never 0: `FETCH NEXT 0` is an
 *  error, R10, and remotePageSource only counts then). Output: c0…cn converted by R6, then with `refs` k0…km (key texts, R6) and,
 *  when the key table has `version`, v (its hex); `keys`: the key table's key column names (none without `refs`).
 *  bc:serverNotSupported|crosstab|topPercent|actionQuery|other|sqlserver, bc:serverFunction|…, bc:missingParameter||<name>. */
export interface MsPlan { rows: string; count: string; params: MsParam[]; columns: number; keys: string[]; version: boolean }

/** R5: a column as the expression generator reads it, by its declared type `msType` (Task 4). A key's text is never this. */
export const present = (sql: string, props: FieldProps): string => {
  switch (String(props.msType ?? '').replace(/\(.*$/, '').toLowerCase()) {
    case 'text': case 'ntext': return `CAST(${sql} AS nvarchar(max))`;
    case 'uniqueidentifier': return `CONVERT(char(36), ${sql})`;
    case 'date': case 'smalldatetime': case 'datetime': return `CAST(${sql} AS datetime2(7))`;
    case 'time': return `DATEADD(second, DATEDIFF(second, '00:00:00', ${sql}), CAST('1899-12-30' AS datetime2(0)))`;
    case 'datetimeoffset': return `CONVERT(nvarchar(34), ${sql}, 121)`;
    default: return sql;
  }
};
const isDecimal = (type: FieldType, props: FieldProps) => type === 'number' && props.numberSize === 'decimal';
const scaleOf = (props: FieldProps): number | undefined => (Number.isInteger(props.scale) && (props.scale as number) >= 0 && (props.scale as number) <= 38 ? props.scale : undefined);
/** R6: an output column as exact text when `tedious` would parse it (decimal and money to a double, dates to a Date). */
export const exact = (sql: string, type: FieldType, props: FieldProps): string => {
  if (type === 'currency' || isDecimal(type, props)) return `CONVERT(varchar(48), CAST(${sql} AS decimal(38, ${type === 'currency' ? 4 : scaleOf(props) ?? 10})))`;
  return type === 'dateTime' ? `CONVERT(varchar(27), CAST(${sql} AS datetime2(7)), 121)` : sql;
};
/** R6: a key column's text, every digit kept so the row is found again: a date's every fraction (style 121), a money's four
 *  decimals (style 2; the default keeps two), a float's 17 significant digits (style 3; the default keeps six). */
export const keyText = (sql: string, props: FieldProps | undefined): string => {
  const type = String(props?.msType ?? '').replace(/\(.*$/, '').toLowerCase();
  const style = props?.type === 'dateTime' || type === 'datetimeoffset' ? 121 : type === 'money' || type === 'smallmoney' ? 2 : type === 'float' || type === 'real' ? 3 : undefined;
  return `CONVERT(nvarchar(4000), ${sql}${style !== undefined ? `, ${style}` : ''})`;
};
/** R8: what the expression generator needs of a column besides its text (and a Decimal's size, for its exact Avg). */
export const colInfo = (type: FieldType, props: FieldProps) => ({
  ci: props.msCi === true,
  ...(typeof props.msCollation === 'string' ? { collation: props.msCollation } : {}),
  ...(isDecimal(type, props) && scaleOf(props) !== undefined ? { scale: scaleOf(props) } : {}),
  ...(isDecimal(type, props) && Number.isInteger(props.precision) && (props.precision as number) >= 1 && (props.precision as number) <= 38 ? { precision: props.precision } : {}),
});

const refuse = (feature: string): never => { throw new Error(`bc:serverNotSupported|${feature}|sqlserver`); };
const invalid = (): never => { throw new Error('bc:invalidArgument'); };
type F = MsFrag;
function cat(...xs: (string | F)[]): F {
  const params: MsParam[] = [];
  let sql = '';
  for (const x of xs) {
    if (typeof x === 'string') sql += x;
    else { sql += x.sql; params.push(...x.params); }
  }
  return { sql, params };
}
const list = (xs: F[], sep = ', '): F => cat(...xs.flatMap((x, i) => (i ? [sep, x] : [x])));
const TEXT: ReadonlySet<FieldType> = new Set(['shortText', 'longText', 'hyperlink']);

/** R7: a query parameter's text and cast. Numbers keep their own decimals (float beyond decimal(38)); Yes/No is 1/0. */
export const paramOf = (value: unknown, p: BoundParam | undefined): MsParam => {
  if (value === null || value === undefined) return { value: null, cast: castOf(p, '') };
  const v = p?.type === 'yesNo' ? (Number(value) ? '1' : '0') : p?.type === 'dateTime' ? String(value).replace(' ', 'T') : String(value);
  return { value: p?.type === 'dateTime' && !v.includes('T') ? `${v}T00:00:00` : v, cast: castOf(p, v) };
};
function castOf(p: BoundParam | undefined, v: string): MsParam['cast'] {
  const own = (): MsParam['cast'] => {
    const m = /^-?(\d+)(?:\.(\d+))?$/.exec(v);
    return !m || m[1]!.length + (m[2] ?? '').length > 38 ? 'float' : `decimal(38, ${(m[2] ?? '').length})`;
  };
  switch (p?.type) {
    case 'number': case 'autoNumber': {
      const size = p.props?.numberSize;
      return size === 'single' || size === 'double' ? 'float' : size === 'decimal' ? own() : 'int';
    }
    case 'currency': return own();
    case 'dateTime': return 'datetime2(0)';
    case 'yesNo': return 'bit';
    default: return 'nvarchar'; // a text, or untyped (paramValues gives it as text)
  }
}

/** R8's ORDER BY keys of a value: text folded in French_100_CI_AS, then exact in BIN2 (dropped under DISTINCT, where it would
 *  split "Lyon" and "LYON", one row in the column's _CI_AS collation); the first key alone decides TOP's ties. Each key carries
 *  its collation, so a hidden column takes it to the outer select. */
function sortKeys(x: F, type: FieldType, dir: 'asc' | 'desc', distinct: boolean): { x: F; d: string }[] {
  const d = dir.toUpperCase();
  if (!TEXT.has(type)) return [{ x, d }];
  const max = type !== 'shortText';
  const folded = { x: msCollate(x, max, 'French_100_CI_AS'), d };
  return distinct ? [folded] : [folded, { x: msCollate(x, max, 'Latin1_General_100_BIN2'), d }];
}
/** Every folded key first, the exact ones after: `ORDER BY Nom, id` orders "Dupont" and "dupont" by id, as Access. */
const orderKeys = (order: { x: F; d: string }[][]) => [...order.map((k) => k[0]!), ...order.flatMap((k) => k.slice(1))];

/** The SELECT being written, with the alias of each of its sources. */
interface Level { b: BoundQuery; sel: BoundSelect; alias: Map<BoundSource, string> }
/** `raw`: a field selected as presented (R5), not as a value (a Yes/No stays bit); `order`: the directions of the hidden keys
 *  o0… (the top level only); `keys`, `version`: k0… and v, through the key source. */
interface Mode { raw: boolean; order?: string[]; keys: boolean; version: boolean }
const PLAIN: Mode = { raw: false, keys: false, version: false };

export function msPlan(r: ReadRequest, dbCi: boolean): MsPlan {
  const b = r.query, top = b.query.body;
  if (b.crosstab && !b.crosstab.expanded) refuse('crosstab'); // C7 R15: only an expanded one
  if (top.k !== 'union' && (top.k !== 'select' || top.into !== undefined)) refuse('actionQuery');
  let next = 0; // source aliases, unique in the statement: a correlated subquery names the enclosing ones
  let outerJoin = false; // somewhere in the statement: a key may then be Null on many rows

  const param = (qb: BoundQuery, name: string) => {
    const key = Object.keys(r.values).find((k) => sameName(k, name));
    if (key === undefined) throw new Error(`bc:missingParameter||${name}`);
    const p = qb.params.find((x) => sameName(x.name, name)), x = paramOf(r.values[key], p);
    return { sql: x.cast === 'nvarchar' ? '@?' : `CAST(@? AS ${x.cast})`, type: p?.type ?? null, ci: true, params: [x], param: true as const };
  };
  const tableSql = (s: BoundSource): string => {
    const t = r.tables(s.name);
    return `${t.schema !== undefined ? `${msIdent(t.schema)}.` : ''}${msIdent(t.remote)}`;
  };
  const column = (stack: Level[], c: Extract<ResolvedRef, { kind: 'column' }>): string => {
    const l = stack[stack.length - 1 - c.depth]!;
    const s = l.sel.sources.find((x) => x.alias === c.alias)!;
    const a = l.alias.get(s)!;
    return s.kind === 'table' ? present(`${a}.${msIdent(c.field)}`, c.props) : `${a}.[c${s.inner!.columns.findIndex((x) => x.name === c.field)}]`;
  };
  /** The key table of `qb` (through saved or derived queries), when it has one. */
  const keyTable = (qb: BoundQuery): RemoteTable | undefined => {
    const s = qb.keyAlias === undefined ? undefined : qb.sources.find((x) => x.alias === qb.keyAlias);
    return !s ? undefined : s.kind === 'table' ? r.tables(s.name) : keyTable(s.inner!);
  };

  const ctx = (stack: Level[]): MsExprCtx => {
    const lvl = stack[stack.length - 1]!;
    const c: MsExprCtx = {
      resolve: (e) => {
        const ref = lvl.b.refs.get(e);
        if (ref?.kind === 'param') return param(lvl.b, ref.name);
        if (ref?.kind === 'column') return { sql: column(stack, ref), type: ref.type, ...colInfo(ref.type, ref.props) };
        if (ref?.kind !== 'output') return invalid();
        const col = lvl.sel.columns[ref.index]!, v = msValue(col.expr, c); // an alias of the same SELECT: its expression
        return { sql: `(${v.sql})`, type: col.type, ci: false, params: v.params };
      },
      typeOf: (e) => exprType(e, lvl.b),
      subquery: (q) => select(q, lvl.b, stack, PLAIN),
      now: r.now, dbCi,
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
        return cat(l, ` ${x.kind.toUpperCase()} JOIN `, rr, ' ON ', msCondition(x.on, c));
      }
      const s = sel.sources[i++]!, as = ` AS ${lvl.alias.get(s)}`;
      if (s.kind === 'table') return cat(tableSql(s), as);
      return cat('(', body(s.inner!, { raw: true, keys: s === keyed && m.keys, version: s === keyed && m.version }), ')', as);
    };
    /** A field as presented, else the value. */
    const item = (e: Expr, raw: boolean): F => {
      const ref = e.k === 'id' ? qb.refs.get(e) : undefined;
      return raw && ref?.kind === 'column' ? { sql: column(stack, ref), params: [] } : msValue(e, c);
    };
    const from = q.from.length ? cat(' FROM ', list(q.from.map(fromItem))) : '';
    const cols = sel.columns.map((col, k) => cat(item(col.expr, m.raw), ` AS [c${k}]`));
    const order = m.order || q.top ? q.orderBy.map((o) => sortKeys(msValue(o.e, c), exprType(o.e, qb), o.dir, q.distinct)) : [];
    // DISTINCT needs its ORDER BY in the select list (error 145): below the top level, the TOP's keys go hidden and a wrapper
    // keeps the columns c0… only (a UNION part or an In subquery takes no extra column)
    const wrap = !m.order && q.distinct && q.top && order.length > 0;
    if (m.order) {
      orderKeys(order).forEach((key, j) => { cols.push(cat(key.x, ` AS [o${j}]`)); m.order!.push(key.d); });
    } else if (wrap) order.forEach(([key], j) => cols.push(cat(key!.x, ` AS [o${j}]`)));
    if (keyed) {
      const a = lvl.alias.get(keyed)!, t = keyed.kind === 'table' ? r.tables(keyed.name) : undefined;
      if (m.keys) {
        // typed, as stored: the page orders by them (an index serves it); the outer select reads their text (R6)
        (t?.key ?? keyTable(keyed.inner!)!.key).forEach((k, j) => cols.push({ sql: `${a}.${t ? msIdent(k) : `[k${j}]`} AS [k${j}]`, params: [] }));
      }
      if (m.version) cols.push({ sql: `${t ? `CONVERT(varchar(18), CAST(${a}.${msIdent(t.version!)} AS binary(8)), 1)` : `${a}.[v]`} AS [v]`, params: [] });
    }
    let topSql = '';
    if (q.top) {
      if (!Number.isSafeInteger(q.top.n) || q.top.n < 0) invalid();
      topSql = `TOP (${q.top.n}) ${order.length ? 'WITH TIES ' : ''}`;
    }
    const out = cat(
      `SELECT ${q.distinct ? 'DISTINCT ' : ''}${topSql}`, list(cols), from,
      q.where ? cat(' WHERE ', msCondition(q.where, c)) : '',
      q.groupBy.length ? cat(' GROUP BY ', list(q.groupBy.map((e) => item(e, true)))) : '', // as the select list writes a field
      q.having ? cat(' HAVING ', msCondition(q.having, c)) : '',
      q.top && order.length ? cat(' ORDER BY ', list(order.map(([k]) => cat(k!.x, ` ${k!.d}`)))) : '', // only TOP needs an order here
    );
    return wrap ? cat(`SELECT ${sel.columns.map((_, k) => `[c${k}]`).join(', ')} FROM (`, out, `) AS a${next++}`) : out;
  }

  /** The SELECT or UNION of `qb` (the query, a saved source or a derived table: never correlated, so a fresh stack). */
  function body(qb: BoundQuery, m: Mode): F {
    const q = qb.query.body;
    if (q.k === 'select') return select(q, qb, [], m);
    if (q.k !== 'union') return refuse('other');
    // parts as values (their column types must agree); one with its own TOP … ORDER BY in a derived table (a T-SQL union part
    // cannot carry ORDER BY, even in parentheses). R10 mandates it; the SQL parser gives a part no ORDER BY today.
    const parts = q.parts.map((p, k) => {
      const s = select(p, qb, [], PLAIN);
      return cat(k ? (q.all[k - 1] ? ' UNION ALL ' : ' UNION ') : '', p.top && p.orderBy.length ? cat('SELECT * FROM (', s, `) AS u${k}`) : s);
    });
    if (!m.order || !q.orderBy.length) return cat(...parts);
    const c: MsExprCtx = { // ORDER BY names output columns
      resolve: (e) => {
        const ref = qb.refs.get(e);
        if (ref?.kind === 'param') return param(qb, ref.name);
        if (ref?.kind !== 'output') return invalid();
        const col = qb.columns[ref.index]!;
        return { sql: `u.[c${ref.index}]`, type: col.type, ...colInfo(col.type, col.props) };
      },
      typeOf: (e) => exprType(e, qb), now: r.now, dbCi,
    };
    const keys = orderKeys(q.orderBy.map((o) => sortKeys(msValue(o.e, c), exprType(o.e, qb), o.dir, false)));
    keys.forEach((k) => m.order!.push(k.d));
    return cat('SELECT u.*, ', list(keys.map((k, j) => cat(k.x, ` AS [o${j}]`))), ' FROM (', ...parts, ') AS u');
  }

  const kt = keyTable(b), keys = kt?.key ?? [];
  const version = r.refs && keys.length > 0 && kt!.version !== undefined;
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
  const qctx: MsExprCtx = {
    resolve: (e) => { const k = outCol.get(e)!, col = b.columns[k]!; return { sql: `q.[c${k}]`, type: col.type, ...colInfo(col.type, col.props) }; },
    typeOf: (e) => exprType(e, stub), now: r.now, dbCi,
  };
  const conds = [...r.filter.map((f) => named(f.criteria, f.column)), ...(r.where ? [named(r.where)] : [])]
    .map((e) => cat('(', msCondition(e as Expr, qctx), ')'));
  const n = msNumber(cat(' FROM (', inner, ') AS q', conds.length ? cat(' WHERE ', list(conds, ' AND ')) : ''));

  const shown = (k: number) => (b.columns[k]!.type === 'yesNo' ? `-ABS(CAST(q.[c${k}] AS int))` : `q.[c${k}]`); // Yes/No sorts as -1/0
  const orderBy = [
    ...r.sort.map((s) => msOrderKeys({ sql: shown(s.column), params: [] }, b.columns[s.column]!.type, s.dir).sql),
    ...m.order!.map((d, j) => `q.[o${j}] ${d}`),
    // stable pages: the keys; every output column without keys, or after them when an outer join leaves keys Null
    ...keys.map((_, j) => `q.[k${j}]`), ...(!keys.length || outerJoin ? b.columns.map((_, k) => `q.[c${k}]`) : []),
  ].filter((x, j, all) => !/^q\.\[c\d+\]$/.test(x) || !all.slice(0, j).some((y) => y.startsWith(`${x} `) || y.startsWith(`CAST(${x} AS `))); // a column twice: error 169
  const outCols = [
    ...b.columns.map((col, k) => exact(`q.[c${k}]`, col.type, col.props)),
    ...(r.refs ? keys.map((k, j) => keyText(`q.[k${j}]`, kt!.design.fields.find((x) => x.name === k)?.props)) : []), ...(version ? ['q.[v]'] : []),
  ];
  const at = n.params.length;
  return {
    rows: `SELECT ${outCols.join(', ')}${n.sql} ORDER BY ${orderBy.join(', ')} OFFSET CAST(@p${at} AS bigint) ROWS FETCH NEXT CAST(@p${at + 1} AS bigint) ROWS ONLY`,
    count: `SELECT count(*)${n.sql}`,
    params: n.params, columns: b.columns.length, keys: r.refs ? keys : [], version,
  };
}
