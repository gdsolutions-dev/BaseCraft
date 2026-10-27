// Compilation of a bound query into parameterised SQLite (A3). The user's SQL never reaches SQLite: each expression node
// becomes the bc_* calls of compileValue (the evaluator's semantics), each literal and parameter a bound `?`.
//
// Shape of a compiled SELECT: sources `"Table" AS "a<i>"` or `(<compiled query>) AS "a<i>"`; columns `AS "c<i>"`, in stored
// form (a field raw, a computed value through bc_out), after `"bcx_rowid"` when the query is updatable. A saved query or a
// derived table is read back through `bc_val(<type>, "a<i>"."c<k>")`, like a table field.
import type { Expr } from '../../shared/expr/ast';
import { compileSql, compileValue, type SqlCompileCtx, type SqlFragment, type SqlParam, type SqlRef } from '../../shared/expr/sql';
import type { SqlValue } from '../../shared/coerce';
import { defaultProps, quoteIdent, sameName, type FieldType } from '../../shared/field-types';
import type { FromItem, SelectQuery } from '../../shared/query/ast';
import { boundArgType, type BoundQuery, type BoundSelect, type BoundSource, type ResolvedRef } from '../../shared/query/bind';

export interface CompiledSelect { sql: string; params: SqlParam[]; hasRowid: boolean /* 1st column = rowid of keyAlias */ }
export interface CompileOptions { locale: string; fastPath?: boolean /* Task 12, default true */ }

type F = SqlFragment;
const INT_SIZES = new Set(['byte', 'integer', 'longInteger']);
/** Concatenation in text order: a string is SQL, a fragment brings its parameters. */
function cat(...xs: (string | F)[]): F {
  const params: SqlParam[] = [];
  let sql = '';
  for (const x of xs) {
    if (typeof x === 'string') sql += x;
    else { sql += x.sql; for (const p of x.params) params.push(p); }
  }
  return { sql, params };
}
const list = (xs: F[]): F => cat(...xs.flatMap((x, i) => (i ? [', ', x] : [x])));

const dirOf = (dir: 'asc' | 'desc'): string => (dir === 'desc' ? 'DESC' : 'ASC');
const nulls = (dir: 'asc' | 'desc'): string => (dir === 'desc' ? 'NULLS LAST' : 'NULLS FIRST');
/** ORDER BY keys of an encoded value `x`, as the table sort: text folded, a date by its serial, Null first ascending;
 *  ties broken by the grouping key (bc_gkey), so values tie exactly when compareText finds them equal: "zoe" before "Zoé",
 *  and TOP keeps "Lyon" and "LYON" together, as Access. */
const sortKeys = (x: F, dir: 'asc' | 'desc'): F => cat('bc_skey(', x, `) ${dirOf(dir)} ${nulls(dir)}, bc_gkey(`, x, `) ${dirOf(dir)}`);

/** ORDER BY keys of a stored column of type `type` (a query page sorted by one of its columns). The type name, from the
 *  closed FieldType set, is the only text written in the SQL. */
export function orderKeys(columnSql: string, type: FieldType, dir: 'asc' | 'desc'): string {
  if (!/^[A-Za-z]+$/.test(type)) throw new Error(`bad field type: ${type}`);
  return sortKeys({ sql: `bc_val('${type}', ${columnSql})`, params: [] }, dir).sql;
}

/** A SELECT being compiled, with the SQL alias of each of its sources. */
interface Level { b: BoundQuery; sel: BoundSelect; alias: Map<BoundSource, string> }
/** `rowid`: `"bcx_rowid"` first (an updatable query, and its saved source). `encoded`: columns left bc-encoded (a scalar or
 *  In subquery, read by bc_one / bc_list; an action query's values), instead of the stored form. `key`: an action query's
 *  target alias, whose rowid comes first (this level only, never its sources). `locate`: compileLocator's aliases. */
interface Mode { rowid: boolean; encoded: boolean; key?: string; locate?: string[] }

/**
 * SELECT or UNION of a bound query -> one parameterised SQLite statement. `values`: the converted parameter values, by
 * name (sameName). Throws Error('bc:notSelectQuery') for an action query, Error('bc:missingParameter') for a parameter
 * without a value, and compileValue's errors (ExprSyntaxError 'tooComplex'…).
 * - WHERE, HAVING, ON: bc_truth, onError 'null' (an error excludes the row), as the A2 filters; integer equalities of the
 *   top-level And natively unless `opts.fastPath` is false (Task 12, `cond`).
 * - GROUP BY, DISTINCT, UNION: grouped on bc_gkey (texts compareText finds equal share a key).
 * - TOP n [PERCENT]: ties kept, as Access, through rank() over the ORDER BY keys (equal for compareText).
 */
export function compileSelect(b: BoundQuery, values: Record<string, SqlValue>, opts: CompileOptions): CompiledSelect {
  const top = b.query.body;
  if (top.k !== 'select' && top.k !== 'union') throw new Error('bc:notSelectQuery');
  const hasRowid = top.k === 'select' && b.updatable && b.keyAlias !== undefined;
  return { ...compiler(b, values, opts).body(b, { rowid: hasRowid, encoded: false }), hasRowid };
}

/**
 * B4 R3: `SELECT "<alias>".rowid…` (one per table of `level.writePlan`, in plan order) `FROM <the level's FROM, ON as
 * compileSelect> WHERE "<key alias>".rowid = ?` — the rows of the query's own join for one key row, without its WHERE. The
 * fragment's params are the ON's (bc_truth's locale…); the caller appends the key rowid.
 */
export function compileLocator(level: BoundQuery, opts: CompileOptions): SqlFragment {
  const q = level.query.body;
  if (q.k !== 'select' || !level.writePlan) throw new Error('bc:invalidArgument');
  return compiler(level, {}, opts).select(q, level, [], { rowid: false, encoded: true, locate: level.writePlan.map((w) => w.alias) });
}

/** The SELECT compiler of a bound query: `select` (one SELECT node of `b`) and `body` (a whole query). */
function compiler(b: BoundQuery, values: Record<string, SqlValue>, opts: CompileOptions) {
  let next = 0; // source aliases, unique in the statement: a correlated subquery names the enclosing ones

  /** Bound parameter: `bc_val(<type>, ?)`, or the value as is when untyped (a text or a number, as entered). */
  const param = (name: string): SqlRef => {
    const key = Object.keys(values).find((k) => sameName(k, name));
    if (key === undefined) throw new Error('bc:missingParameter');
    return { sql: '?', params: [values[key]], type: b.params.find((p) => sameName(p.name, name))?.type ?? null };
  };
  /** A member the binding made a parameter ([Forms]![F]![C]…, B2 R11): its value bound, never its text. */
  const paramOf = (qb: BoundQuery, node: Expr): SqlRef | null => { const r = qb.refs.get(node); return r?.kind === 'param' ? param(r.name) : null; };
  const column = (stack: Level[], r: Extract<ResolvedRef, { kind: 'column' }>): SqlRef => {
    const l = stack[stack.length - 1 - r.depth];
    const s = l.sel.sources.find((x) => x.alias === r.alias)!;
    const name = s.kind === 'table' ? quoteIdent(r.field) : `"c${s.inner!.columns.findIndex((x) => x.name === r.field)}"`;
    return { sql: `"${l.alias.get(s)}".${name}`, params: [], type: r.type };
  };
  /**
   * Task 12: an operand of a native integer equality, or null. `exact`: its value is a double SQLite and the bc_* path
   * (which reads an integer through Number) both hold exactly: a safe-integer literal or parameter, a bounded Number
   * column. An AutoNumber (a rowid, any 64-bit integer) is native but not exact: `AutoNumber = AutoNumber` stays bc_*, where
   * 2^53 and 2^53 + 1 are equal. A column counts only in a table BaseCraft created: its INTEGER affinity and CHECK range
   * (schema.ts) hold numbers within ±2^31 or NULL, never text (an external tool's REAL, 7.5, passes the CHECK: both paths
   * compare it numerically); an AutoNumber, integers.
   * ponytail: an external tool that turns on ignore_check_constraints, or rewrites the table without its CHECK, can store a
   * text there, which `=` compares case-sensitively and bc_* case-insensitively; isExternal(db) at compile time if it matters.
   */
  const nativeInt = (stack: Level[], e: Expr): { ref: SqlRef; exact: boolean } | null => {
    if (e.k === 'num') return Number.isSafeInteger(Number(e.v)) ? { ref: { sql: '?', params: [Number(e.v)], type: null }, exact: true } : null;
    if (e.k !== 'id' && e.k !== 'member') return null; // a member is a parameter ([Forms]![F]![N°], B2 R11)
    const r = stack[stack.length - 1].b.refs.get(e);
    if (r?.kind === 'param') {
      const p = param(r.name); // bc_val('number', n) and an untyped n both read num(n)
      return (p.type === null || p.type === 'number') && Number.isSafeInteger(p.params[0]) ? { ref: p, exact: true } : null;
    }
    if (r?.kind !== 'column' || r.props.external === true) return null;
    if (stack[stack.length - 1 - r.depth].sel.sources.find((x) => x.alias === r.alias)?.kind !== 'table') return null;
    if (r.type === 'autoNumber') return { ref: column(stack, r), exact: false };
    return r.type === 'number' && INT_SIZES.has(r.props.numberSize ?? 'longInteger') ? { ref: column(stack, r), exact: true } : null;
  };
  /** WHERE, HAVING, ON: bc_truth (compileSql), except the conjuncts of the top-level And that compare two native integers
   *  (Task 12), emitted as SQLite's `=` so an index serves them. A row is kept iff every conjunct is True; for two such
   *  numbers Access's `=` is numeric equality, Null giving Null, and an error in the rest gives NULL (onError 'null'): both
   *  forms exclude the same rows. The one error that fails the statement instead, a scalar subquery with several rows
   *  (bc_one), keeps the whole condition in bc_*: a native conjunct would let SQLite skip it, and the query succeed.
   *  Aggregates throw only on a bug, and are all computed before HAVING anyway. */
  const cond = (e: Expr, stack: Level[], c: SqlCompileCtx): F => {
    if (opts.fastPath === false) return compileSql(e, c);
    const parts: Expr[] = [];
    const split = (x: Expr): void => { if (x.k === 'bin' && x.op === 'And') { split(x.l); split(x.r); } else parts.push(x); };
    split(e);
    const native: F[] = [];
    const rest = parts.filter((x) => {
      const [l, r] = x.k === 'bin' && x.op === '=' ? [nativeInt(stack, x.l), nativeInt(stack, x.r)] : [null, null];
      if (!l || !r || (!l.exact && !r.exact)) return true;
      native.push(cat(l.ref, ' = ', r.ref));
      return false;
    });
    if (!native.length) return compileSql(e, c);
    if (rest.length) {
      const r = compileSql(rest.reduce((l, r): Expr => ({ k: 'bin', op: 'And', l, r })), c);
      // a scalar subquery (bc_one, at any depth) can fail the statement: SQLite may skip it after a false native conjunct
      if (r.sql.includes('bc_one(')) return compileSql(e, c);
      native.push(r);
    }
    return cat(...native.flatMap((x, i) => (i ? [' AND ', x] : [x])));
  };
  /** Expressions of the innermost SELECT of `stack`; `aggregate`: its items, HAVING and ORDER BY when it is grouped. */
  const ctx = (stack: Level[], aggregate: boolean): SqlCompileCtx => {
    const lvl = stack[stack.length - 1];
    const c: SqlCompileCtx = {
      fields: [], locale: opts.locale, aggregate,
      argType: (arg) => boundArgType(arg, lvl.b),
      sub: (q, mode) => sub(q, stack, mode),
      ref: (node) => {
        const r = lvl.b.refs.get(node as Expr);
        if (r?.kind === 'param') return param(r.name);
        if (r?.kind === 'output') return { ...compileValue(lvl.sel.columns[r.index].expr, c), type: null }; // the aliased expression
        return r?.kind === 'column' ? column(stack, r) : null;
      },
      member: (node) => paramOf(lvl.b, node),
    };
    return c;
  };

  /** Exists: native EXISTS. Scalar: bc_one of the single column (Null, the value, or a query error). In: bc_list. */
  function sub(q: SelectQuery, stack: Level[], mode: 'scalar' | 'exists' | 'in'): F {
    const inner = select(q, stack[stack.length - 1].b, stack, { rowid: false, encoded: true });
    return mode === 'exists' ? cat('EXISTS (', inner, ')') : cat(`(SELECT ${mode === 'scalar' ? 'bc_one' : 'bc_list'}("c0") FROM (`, inner, '))');
  }

  function select(q: SelectQuery, qb: BoundQuery, outer: Level[], mode: Mode): F {
    const sel = qb.selects.get(q)!;
    const lvl: Level = { b: qb, sel, alias: new Map(sel.sources.map((s) => [s, `a${next++}`])) };
    const stack = [...outer, lvl];
    const plain = ctx(stack, false);
    const grouped = ctx(stack, sel.grouped);

    let i = 0; // sources in binding order: joins flattened left to right
    const fromItem = (x: FromItem): F => {
      if (x.k === 'join') {
        const l = fromItem(x.l); // before the right side: `i` follows the binding order
        const r = x.r.k === 'join' ? cat('(', fromItem(x.r), ')') : fromItem(x.r);
        return cat(l, ` ${x.kind.toUpperCase()} JOIN `, r, ' ON ', cond(x.on, stack, plain));
      }
      const s = sel.sources[i++];
      const as = ` AS "${lvl.alias.get(s)}"`;
      return s.kind === 'table' ? cat(quoteIdent(s.design!.name), as) : cat('(', body(s.inner!, { rowid: mode.rowid, encoded: false }), ')', as);
    };
    if (mode.locate) { // a locator: the rowid of each of these sources, on the row whose first one has rowid ?
      const at = (a: string) => `"${lvl.alias.get(sel.sources.find((x) => x.alias === a)!)}".rowid`;
      const from = list(q.from.map(fromItem));
      return cat('SELECT ', mode.locate.map((a, k) => `${at(a)} AS "bcx_r${k}"`).join(', '), ' FROM ', from, ` WHERE ${at(mode.locate[0])} = ?`);
    }
    const cols = sel.columns.map((col, k): F => {
      const r = col.expr.k === 'id' ? qb.refs.get(col.expr) : undefined;
      const v = mode.encoded ? compileValue(col.expr, grouped)
        : r?.kind === 'column' ? column(stack, r) // a field: its stored value, raw
          : cat('bc_out(', compileValue(col.expr, grouped), ')');
      return cat(v, ` AS "c${k}"`);
    });
    if (mode.rowid || mode.key !== undefined) {
      // the key (many-most) table's rowid, at every level (B4 R3: a join is written through it)
      const key = mode.key ?? qb.keyAlias;
      const s = sel.sources.find((x) => x.alias === key) ?? sel.sources[0];
      cols.unshift({ sql: `"${lvl.alias.get(s)}".${s.kind === 'table' ? 'rowid' : '"bcx_rowid"'} AS "bcx_rowid"`, params: [] });
    }
    const gkeys = (es: Expr[]): F[] => es.map((e) => cat('bc_gkey(', compileValue(e, plain), ')'));
    const groupBy = q.groupBy.length ? gkeys(q.groupBy) : q.distinct && !sel.grouped ? gkeys(sel.columns.map((c) => c.expr)) : [];
    const order = q.orderBy.map((o) => ({ x: compileValue(o.e, grouped), dir: o.dir }));
    const dedup = q.distinct && sel.grouped; // DISTINCT after the groups: on the output columns
    const ranked = q.top !== undefined && (order.length > 0 || q.top.percent);
    const wrapped = dedup || ranked;
    // a wrapped SELECT orders by hidden key columns, the only ones its outer level sees
    const hidden = wrapped ? order.flatMap((o, k) => [cat('bc_skey(', o.x, `) AS "bcx_s${k}"`), cat('bc_gkey(', o.x, `) AS "bcx_o${k}"`)]) : [];
    const core = cat(
      'SELECT ', list([...cols, ...hidden]),
      q.from.length ? cat(' FROM ', list(q.from.map(fromItem))) : '',
      q.where ? cat(' WHERE ', cond(q.where, stack, plain)) : '',
      groupBy.length ? cat(' GROUP BY ', list(groupBy)) : '',
      q.having ? cat(' HAVING ', cond(q.having, stack, grouped)) : '',
    );
    const limit = (sql: string): F => ({ sql, params: [q.top!.n] });
    if (!wrapped) {
      return cat(core, order.length ? cat(' ORDER BY ', list(order.map((o) => sortKeys(o.x, o.dir)))) : '', q.top ? cat(' LIMIT ', limit('?')) : '');
    }
    const keys = order.map((o, k) => `"bcx_s${k}" ${dirOf(o.dir)} ${nulls(o.dir)}, "bcx_o${k}" ${dirOf(o.dir)}`).join(', ');
    const out = [...(mode.rowid || mode.key !== undefined ? ['"bcx_rowid"'] : []), ...sel.columns.map((_, k) => `"c${k}"`)].join(', ');
    const distinct = dedup ? ` GROUP BY ${sel.columns.map((_, k) => `bc_gkey("c${k}")`).join(', ')}` : '';
    if (!ranked) return cat(`SELECT ${out} FROM (`, core, `)${distinct}`, keys ? ` ORDER BY ${keys}` : '', q.top ? cat(' LIMIT ', limit('?')) : '');
    // window functions run after GROUP BY: rank and count the distinct rows
    const rank = keys ? `rank() OVER (ORDER BY ${keys})` : 'row_number() OVER ()';
    return cat(`SELECT ${out} FROM (SELECT *, ${rank} AS "bcx_rank", count(*) OVER () AS "bcx_n" FROM (`, core, `)${distinct}) WHERE "bcx_rank" <= `,
      limit(q.top!.percent ? '("bcx_n" * ? + 99) / 100' : '?'), ' ORDER BY "bcx_rank"');
  }

  /** The SELECT or UNION of `qb` (the query, a saved source or a derived table: never correlated, so a fresh stack). */
  function body(qb: BoundQuery, mode: Mode): F {
    const q = qb.query.body;
    if (q.k === 'select') return select(q, qb, [], mode);
    if (q.k !== 'union') throw new Error('bc:notSelectQuery');
    // each part in its own SELECT (a compound member takes no ORDER BY or LIMIT); UNION is a deduplicated UNION ALL
    const part = (p: SelectQuery): F => cat('SELECT * FROM (', select(p, qb, [], { rowid: false, encoded: mode.encoded }), ')');
    const dedup = qb.columns.map((_, k) => `bc_gkey("c${k}")`).join(', ');
    let rel = part(q.parts[0]);
    q.parts.slice(1).forEach((p, k) => {
      rel = q.all[k] ? cat(rel, ' UNION ALL ', part(p)) : cat('SELECT * FROM (', rel, ' UNION ALL ', part(p), `) GROUP BY ${dedup}`);
    });
    if (!q.orderBy.length) return rel;
    // ORDER BY names output columns
    const c: SqlCompileCtx = {
      fields: [], locale: opts.locale,
      ref: (node) => {
        const r = qb.refs.get(node as Expr);
        if (r?.kind === 'param') return param(r.name);
        return r?.kind === 'output' ? { sql: `"c${r.index}"`, params: [], type: mode.encoded ? null : qb.columns[r.index].type } : null;
      },
      member: (node) => paramOf(qb, node),
    };
    return cat('SELECT * FROM (', rel, ') ORDER BY ', list(q.orderBy.map((o) => sortKeys(compileValue(o.e, c), o.dir))));
  }

  return { select, body };
}

/**
 * The rows an action query writes, as one authorised SELECT of encoded values (decoded by the caller, each converted as its
 * target field stores it); `target`: the table written. Same errors as compileSelect; Error('bc:invalidArgument') for a
 * SELECT or UNION.
 * - DELETE: `"bcx_rowid"` of the target, one row per joined row (the caller keeps each rowid once);
 * - UPDATE: `"bcx_rowid"`, then the SET values in their order (the first row of a rowid wins);
 * - INSERT … SELECT, SELECT … INTO: the SELECT's columns; INSERT … VALUES: one row of the values.
 */
export function compileAction(b: BoundQuery, values: Record<string, SqlValue>, opts: CompileOptions): { select: CompiledSelect; target: string } {
  const body = b.query.body;
  const c = compiler(b, values, opts);
  const encoded = { rowid: false, encoded: true };
  /** A SELECT made of the action's own expressions (bound already), over `from`. */
  const own = (items: Expr[], from: FromItem[], where?: Expr): SelectQuery => {
    const q: SelectQuery = { k: 'select', distinct: false, items: items.map((e) => ({ e })), from, ...(where && { where }), groupBy: [], orderBy: [] };
    b.selects.set(q, { sources: b.sources, grouped: false, columns: items.map((expr) => ({ name: '', type: 'shortText', props: defaultProps('shortText'), expr })) });
    return q;
  };
  switch (body.k) {
    case 'select':
      if (body.into === undefined) break;
      return { select: { ...c.select(body, b, [], encoded), hasRowid: false }, target: body.into };
    case 'insert': {
      const q = 'values' in body.source ? own(body.source.values, []) : body.source;
      return { select: { ...c.select(q, b, [], encoded), hasRowid: false }, target: b.keyTable! };
    }
    case 'update':
    case 'delete': {
      const q = own(body.k === 'update' ? body.set.map((x) => x.value) : [], [body.from], body.where);
      return { select: { ...c.select(q, b, [], { ...encoded, key: b.keyAlias }), hasRowid: true }, target: b.keyTable! };
    }
  }
  throw new Error('bc:invalidArgument');
}
