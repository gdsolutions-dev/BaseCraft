// SQL Server generator of expressions (C5 R9). Pure: no import of `tedious`. The bound tree becomes T-SQL text over C4's
// closed list of operators and functions with Access's semantics; anything outside it refuses bc:serverFunction|<name>|
// sqlserver before a statement is sent.
//
// Values are never written into the text: each one is a parameter bound as nvarchar text (R7), written `@?` (text) or
// `CAST(@? AS <type>)` in a fragment and named `@p0…` by `msNumber` once the statement is whole. Yes/No: a condition is a
// native predicate; a Yes/No *value* is -1/0, as Access (a bit column read as `-ABS(CAST(x AS int))`, which also takes a
// -1/0 column of a derived table). Text compares in the column's collation when it is _CI_AS, else in
// Latin1_General_100_CI_AS (R8): without case, accents kept.
import { ExprRuntimeError, type Expr } from '../../../shared/expr/ast';
import { bracket } from '../../../shared/expr/lexer';
import type { FieldType } from '../../../shared/field-types';
import type { SelectQuery } from '../../../shared/query/ast';
import { PG_REFUSED } from '../postgres/sql-expr';

export interface MsFrag { sql: string; params: MsParam[] } // markers `@?`, numbered by msNumber
/** R7: every parameter is nvarchar text (null, digits, ISO dates `YYYY-MM-DDTHH:MM:SS`, 1/0); `cast` is written around it. */
export type MsParam = { value: string | null; cast: 'nvarchar' | 'float' | 'int' | 'bigint' | 'datetime2(0)' | 'bit' | `decimal(38, ${number})` };
export interface MsExprCtx {
  /** A column as R5 presents it (text/ntext as nvarchar(max), uniqueidentifier as char(36), dates as datetime2, time on
   *  1899-12-30), its type, `ci` (its collation is _CI_AS, R8) and `collation` (its name, `sys.columns.collation_name`;
   *  absent: unknown, so it never compares plain with another column), `precision` and `scale` (a Decimal field's: its Avg
   *  stays exact); a query parameter: its marker and value, `param: true` (an output alias's expression may carry
   *  parameters too, but is no value). Called several times per node: no side effect. */
  resolve(e: Extract<Expr, { k: 'id' | 'member' }>): { sql: string; type: FieldType | null; ci: boolean; collation?: string; precision?: number; scale?: number; params?: MsParam[]; param?: true };
  subject?: { sql: string; type: FieldType; ci: boolean; collation?: string }; // criteria mode
  typeOf(e: Expr): FieldType | null; // exprType of the bound query
  subquery?(q: SelectQuery): MsFrag; // Task 3
  now: Date;
  dbCi: boolean; // the database's collation is _CI_AS (R4, R8)
}

export const msIdent: (name: string) => string = bracket;
const refuse = (name: string): never => { throw new Error(`bc:serverFunction|${name}|sqlserver`); };
const CI = 'Latin1_General_100_CI_AS';

// ---- Fragments: `atom` = needs no parentheses as an operand ----
type F = MsFrag & { atom?: boolean };
type Part = F | string; // a string part is generator text, never a value
function S(strs: TemplateStringsArray, ...xs: Part[]): F {
  const params: MsParam[] = [];
  let sql = strs[0]!;
  xs.forEach((x, i) => {
    if (typeof x === 'string') sql += x;
    else { sql += x.sql; params.push(...x.params); }
    sql += strs[i + 1]!;
  });
  return { sql, params };
}
const atom = (f: F): F => ({ ...f, atom: true });
const A = (strs: TemplateStringsArray, ...xs: Part[]): F => atom(S(strs, ...xs));
const NAME = String.raw`\[(?:[^\]]|\]\])*\]`;
// a (qualified: a0.[x]) identifier or a parameter
const ATOMIC = new RegExp(String.raw`^(?:(?:(?:[a-z]\w*|${NAME})\.)*${NAME}|@\?|CAST\(@\? AS [\w(), ]+\))$`);
const w = (x: F): F => (x.atom || ATOMIC.test(x.sql) ? x : A`(${x})`);
const join = (xs: F[], sep = ', '): F => xs.reduce<F>((acc, x, i) => (i ? S`${acc}${sep}${x}` : x), { sql: '', params: [] });
const p = (value: string | null, cast: MsParam['cast']): F => ({ sql: cast === 'nvarchar' ? '@?' : `CAST(@? AS ${cast})`, params: [{ value, cast }], atom: true });
const raw = (sql: string): F => ({ sql, params: [], atom: true }); // generator constants only
/** `x COLLATE <collation>` (R8), as nvarchar first: COLLATE on a varchar re-encodes it into the collation's code page (a
 *  Polish_CS_AS 'ł' became 'l', a Japanese or UTF-8 varchar's other characters '?'); a parameter is nvarchar already.
 *  `max`: a Long Text operand, never cut to 4 000 characters. */
export const msCollate = (x: MsFrag, max: boolean, collation = CI): MsFrag =>
  x.sql === '@?' ? S`${x} COLLATE ${collation}` : S`CAST(${x} AS nvarchar(${max ? 'max' : '4000'})) COLLATE ${collation}`;

/** `@?` markers → @p0, @p1… in order from `start`, outside bracketed identifiers and literals. Equal parameters (same cast
 *  and value) share one name, so an expression written twice (select list and GROUP BY, a hidden order key) is the same
 *  expression to SQL Server; `params`: one per name. */
export function msNumber(f: MsFrag, start = 0): { sql: string; params: MsParam[] } {
  const params: MsParam[] = [];
  const seen = new Map<string, number>();
  let i = 0;
  const sql = f.sql.replace(new RegExp(String.raw`${NAME}|'(?:[^']|'')*'|@\?`, 'g'), (m) => {
    if (m !== '@?') return m;
    const x = f.params[i++];
    if (!x) return m; // counted below
    const key = JSON.stringify([x.cast, x.value]); // Null apart from the text 'null'
    if (!seen.has(key)) seen.set(key, params.push(x) - 1);
    return `@p${start + seen.get(key)!}`;
  });
  if (i !== f.params.length) throw new Error(`msNumber: ${i} markers, ${f.params.length} parameters`);
  return { sql, params };
}

// ---- Types ----
type Cls = 'text' | 'num' | 'date' | 'null';
const CLASS: Record<FieldType, Cls> = {
  shortText: 'text', longText: 'text', hyperlink: 'text', number: 'num', currency: 'num', autoNumber: 'num', yesNo: 'num', dateTime: 'date',
};
const TEXT: ReadonlySet<FieldType> = new Set(['shortText', 'longText', 'hyperlink']);
const COMPARE = new Set(['=', '<>', '<', '<=', '>', '>=']);
const pad = (n: number, width = 2): string => String(n).padStart(width, '0');
const intLiteral = (e: Expr): e is Extract<Expr, { k: 'num' }> => e.k === 'num' && /^\d{1,9}$/.test(e.v);
/** A number literal: exact decimal digits (its own scale), float beyond decimal(38). */
const numParam = (v: string): F => {
  const [int, frac = ''] = v.split('.');
  return p(v, int!.length + frac.length > 38 ? 'float' : `decimal(38, ${frac.length})`);
};
// LEN alone drops trailing spaces; the max cast keeps `+ N'x'` from truncating a 4000-character value
const len = (s: F): F => S`LEN(CAST(${s} AS nvarchar(max)) + N'x') - 1`;

type Call = Extract<Expr, { k: 'call' }>;
type Gen = ReturnType<typeof generator>;

function generator(ctx: MsExprCtx) {
  const cls = (e: Expr): Cls => (e.k === 'null' ? 'null' : CLASS[ctx.typeOf(e) ?? 'shortText']);
  /** The one class of `es` (Null goes with any), else refused as `name`. */
  const common = (es: Expr[], name: string): Cls => {
    const cs = new Set(es.map(cls).filter((x) => x !== 'null'));
    return cs.size > 1 ? refuse(name) : ([...cs][0] ?? 'null');
  };
  const typed = (c: Cls, e: Expr, name: string): F => {
    const k = cls(e);
    if (k === 'null') return raw(`CAST(NULL AS ${c === 'text' ? 'nvarchar(4000)' : c === 'date' ? 'datetime2(0)' : 'int'})`);
    return k === c ? val(e) : refuse(name);
  };
  const num = (e: Expr, name: string): F => typed('num', e, name);
  const txt = (e: Expr, name: string): F => typed('text', e, name);
  const dat = (e: Expr, name: string): F => typed('date', e, name);
  /** Banker's rounding on decimal(38, 10) (R9), at `n` decimals. FLOOR and the scaled product are cast back to
   *  decimal(38, 10): T-SQL's decimal arithmetic would otherwise cut `y - floor(y)` to no decimals.
   *  ponytail: `y` is written 6 times (C4 R14's CASE), so each nested Round/CInt/CLng/\/Mod multiplies the text by 6 (its
   *  parameters share their names: msNumber). With `n`, the product and the final division keep 6 decimals (T-SQL's
   *  decimal(38) scale rule): Round(x, n > 6) keeps 6, and the tie test reads x·10ⁿ at 6 decimals, so an x with more than
   *  n + 6 decimals (a float, a decimal(…, ≥ 9)) can be taken for an exact half. A value above 10^28 (a huge Double)
   *  overflows decimal(38, 10): error 8115 ends the query where Access rounds. Bind `y` once through CROSS APPLY, or round
   *  in float beyond 10^28, if any of these matters. */
  const bank = (x: F, n?: F): F => {
    const d = A`CAST(${x} AS decimal(38, 10))`;
    const y = n ? A`CAST(${d} * POWER(CAST(10 AS decimal(38, 10)), ${n}) AS decimal(38, 10))` : d;
    const fy = A`CAST(FLOOR(${y}) AS decimal(38, 10))`;
    const r = A`CASE WHEN ${y} - ${fy} = 0.5 THEN (CASE WHEN ${fy} % 2 = 0 THEN ${fy} ELSE ${fy} + 1 END) ELSE ROUND(${y}, 0) END`;
    return n ? S`${r} / POWER(CAST(10 AS decimal(38, 10)), ${n})` : r;
  };
  /** An integer argument, as the evaluator's `long`: banker's rounding. */
  const int = (e: Expr, name: string): F => (intLiteral(e) ? p(e.v, 'int') : A`CAST(${bank(num(e, name))} AS int)`);

  const ref = (r: { sql: string; type: FieldType | null; params?: MsParam[] }): F => {
    const x: F = { sql: r.sql, params: r.params ?? [] };
    return r.type === 'yesNo' ? S`-ABS(CAST(${x} AS int))` : x;
  };

  /** R8: a column's `ci` and collation name; an expression counts as a non-CI column (its collation is a column's,
   *  unknown here); null a value (it takes the other operand's collation, or the database's when no operand is a column). */
  const colOf = (e: Expr): { ci: boolean; collation?: string } | null => {
    switch (e.k) {
      case 'str': case 'null': return null;
      case 'id': case 'member': { const r = ctx.resolve(e); return r.param ? null : r; }
      case 'subject': return ctx.subject ?? { ci: false };
      default: return { ci: false };
    }
  };
  const long = (es: Expr[]): boolean => es.some((e) => { const t = e.k === 'subject' ? ctx.subject?.type : ctx.typeOf(e); return t === 'longText' || t === 'hyperlink'; });
  /** The text operands `es` as R8 compares them: plain when every column is _CI_AS and they share one known collation
   *  (else error 468), or the database's is _CI_AS when none is a column; otherwise each one in Latin1_General_100_CI_AS. */
  const collate = (es: Expr[]): ((x: F) => F) => {
    const cols = es.map(colOf).filter((c) => c !== null);
    const names = new Set(cols.map((c) => c.collation));
    const plain = cols.length ? cols.every((c) => c.ci) && (cols.length === 1 || (names.size === 1 && !names.has(undefined))) : ctx.dbCi;
    const max = long(es);
    return plain ? (x) => x : (x) => msCollate(x, max);
  };

  function isCond(e: Expr): boolean {
    switch (e.k) {
      case 'bin': return COMPARE.has(e.op) || e.op === 'And' || e.op === 'Or' || e.op === 'Xor';
      case 'un': return e.op === 'Not';
      case 'like': case 'between': case 'in': case 'inSub': case 'isnull': return true;
      case 'sub': return e.mode === 'exists';
      case 'call': return e.name === 'IsNull' || e.name === 'CBool';
      default: return false;
    }
  }

  function compare(op: string, l: Expr, r: Expr): F {
    if (common([l, r], op) !== 'text') return S`${w(val(l))} ${op} ${w(val(r))}`;
    const co = collate([l, r]);
    return S`${co(txt(l, op))} ${op} ${co(txt(r, op))}`;
  }
  const sub = (q: SelectQuery): F => (ctx.subquery ?? (() => { throw new Error('bc:serverNotSupported|other|sqlserver'); }))(q);

  function like(e: Extract<Expr, { k: 'like' }>): F {
    if (cls(e.e) !== 'text' && cls(e.e) !== 'null') refuse('Like');
    const pt = e.pattern;
    const r = pt.k === 'id' || pt.k === 'member' ? ctx.resolve(pt) : null;
    const value = pt.k === 'str' ? pt.v : pt.k === 'null' ? null : r?.param && r.params?.length === 1 ? r.params[0]!.value : refuse('Like');
    const co = collate([e.e, { k: 'null' }]);
    const m = S`${co(txt(e.e, 'Like'))} LIKE ${co(p(value === null ? null : likePattern(value), 'nvarchar'))}`;
    return e.not ? S`NOT ${w(m)}` : m;
  }

  function cond(e: Expr): F {
    switch (e.k) {
      case 'bin':
        if (COMPARE.has(e.op)) return compare(e.op, e.l, e.r);
        if (e.op === 'And' || e.op === 'Or') return S`${w(cond(e.l))} ${e.op.toUpperCase()} ${w(cond(e.r))}`;
        if (e.op === 'Xor') { const [a, b] = [cond(e.l), cond(e.r)]; return S`((${a}) AND NOT (${b})) OR (NOT (${a}) AND (${b}))`; }
        break;
      case 'un': if (e.op === 'Not') return S`NOT ${w(cond(e.e))}`; break;
      case 'like': return like(e);
      case 'between': {
        const c = common([e.e, e.lo, e.hi], 'Between');
        const co = c === 'text' ? collate([e.e, e.lo, e.hi]) : (x: F) => w(x);
        return S`${co(val(e.e))} ${e.not ? 'NOT ' : ''}BETWEEN ${co(val(e.lo))} AND ${co(val(e.hi))}`;
      }
      case 'in': {
        const c = common([e.e, ...e.list], 'In');
        const co = c === 'text' ? collate([e.e, ...e.list]) : (x: F) => w(x);
        return S`${co(val(e.e))} ${e.not ? 'NOT ' : ''}IN (${join(e.list.map((x) => co(val(x))))})`;
      }
      case 'inSub': {
        // the subquery's column collation is unknown: the outer operand's explicit collation decides (no error 468)
        const c = common([e.e, { k: 'sub', mode: 'scalar', q: e.q }], 'In');
        const x = c === 'text' ? msCollate(val(e.e), long([e.e])) : w(val(e.e));
        return S`${x} ${e.not ? 'NOT ' : ''}IN (${sub(e.q)})`;
      }
      case 'isnull': return S`${w(val(e.e))} IS ${e.not ? 'NOT ' : ''}NULL`;
      case 'sub': if (e.mode === 'exists') return S`EXISTS (${sub(e.q)})`; break;
      case 'call':
        if (e.name === 'IsNull') return S`${w(val(e.args[0]!))} IS NULL`;
        if (e.name === 'CBool') return cond(e.args[0]!);
        break;
      case 'id': case 'member': case 'subject': {
        const r: { sql: string; type: FieldType | null; params?: MsParam[] } | undefined = e.k === 'subject' ? ctx.subject : ctx.resolve(e);
        if (r?.type === 'yesNo') return S`${w({ sql: r.sql, params: r.params ?? [] })} <> 0`; // a bit or -1/0 column: R9's `x = 1`, sargable
        break;
      }
    }
    // a value as a condition: a number is true when not 0 (Yes/No values are -1/0); text and dates are refused
    const c = cls(e);
    return c === 'num' || c === 'null' ? S`${w(val(e))} <> 0` : refuse('CBool');
  }

  /** `d` + `n` days, the fraction to the second (DATEADD takes whole units). */
  const addDays = (d: F, n: F): F =>
    A`DATEADD(second, CAST(ROUND((${w(n)} - FLOOR(${n})) * 86400, 0) AS int), DATEADD(day, CAST(FLOOR(${n}) AS int), ${d}))`;

  function arith(e: Extract<Expr, { k: 'bin' }>): F {
    const { op, l, r } = e;
    const cs = new Set([cls(l), cls(r)].filter((x) => x !== 'null'));
    const only = (c: Cls): boolean => [...cs].every((x) => x === c);
    if (op === '&') {
      const part = (x: Expr): F => (x.k === 'null' ? raw('NULL')
        : cls(x) === 'text' || ctx.typeOf(x) === 'autoNumber' || intLiteral(x) ? val(x) : refuse('&'));
      return A`CONCAT(${part(l)}, ${part(r)})`;
    }
    if (op === '+' && cs.size && only('text')) return S`${w(txt(l, op))} + ${w(txt(r, op))}`;
    if ((op === '+' || op === '-') && cs.has('date')) {
      if (op === '-' && cls(l) !== 'num' && cls(r) !== 'num') return S`CAST(DATEDIFF_BIG(millisecond, ${dat(r, op)}, ${dat(l, op)}) AS float) / 86400000`;
      const [d, n] = cls(l) === 'date' ? [l, r] : op === '+' ? [r, l] : refuse(op);
      return addDays(dat(d, op), op === '-' ? S`-${w(num(n, op))}` : num(n, op));
    }
    if (!only('num')) refuse(op);
    const [a, b] = [num(l, op), num(r, op)];
    switch (op) {
      case '/': return S`CAST(${a} AS float) / ${w(b)}`;
      case '^': return A`POWER(CAST(${a} AS float), ${b})`;
      case '\\': return S`CAST(${bank(a)} AS bigint) / CAST(${bank(b)} AS bigint)`;
      case 'Mod': return S`CAST(${bank(a)} AS bigint) % CAST(${bank(b)} AS bigint)`;
      default: return S`${w(a)} ${op} ${w(b)}`; // + - *
    }
  }

  function val(e: Expr): F {
    if (isCond(e)) { const c = cond(e); return A`CASE WHEN ${c} THEN -1 WHEN NOT (${c}) THEN 0 END`; }
    switch (e.k) {
      case 'num': return numParam(e.v);
      case 'str': return p(e.v, 'nvarchar');
      case 'date': return p(e.v.replace(' ', 'T'), 'datetime2(0)');
      case 'bool': return p(e.v ? '-1' : '0', 'int');
      case 'null': return raw('NULL');
      case 'id': case 'member': return ref(ctx.resolve(e));
      case 'subject': if (!ctx.subject) throw new Error('subject without criteria mode'); return ref(ctx.subject);
      case 'un': return cls(e.e) === 'date' ? refuse('-') : S`-${w(num(e.e, '-'))}`;
      case 'bin': return arith(e);
      case 'sub': return A`(${sub(e.q)})`;
      case 'call': return (CALLS[e.name] ?? (() => refuse(e.name)))(e, gen);
      default: return refuse(e.k);
    }
  }

  const gen = { val, cond, common, num, txt, dat, int, bank, collate, ctx };
  return gen;
}

// ---- Like (R9): T-SQL's LIKE has Access's classes; only `%` `_` `[` outside a class are escaped ----
const span = (a: string, b: string): string => String.fromCharCode(...Array.from({ length: b.charCodeAt(0) - a.charCodeAt(0) + 1 }, (_, k) => a.charCodeAt(0) + k));
const DIGITS = span('0', '9'); // `#`, as the evaluator: the ASCII digits (a collation's [0-9] also takes ² or ½)
function likePattern(s: string): string {
  const c = [...s];
  let out = '';
  for (let i = 0; i < c.length; i++) {
    const ch = c[i]!;
    if (ch === '*') out += '%';
    else if (ch === '?') out += '_';
    else if (ch === '#') out += `[${DIGITS}]`;
    else if (ch === '%' || ch === '_') out += `[${ch}]`;
    else if (ch !== '[') out += ch;
    else {
      const close = c.indexOf(']', i + 1);
      if (close < 0) refuse('Like'); // Access: an error in every row
      let body = c.slice(i + 1, close).join('');
      i = close;
      const negate = body[0] === '!' && body.length > 1;
      if (negate) body = body.slice(1);
      else if (body[0] === '^') body = body.slice(1) + '^'; // Access's ^ is literal; first in a T-SQL class it negates
      // an ASCII range by its characters, as the evaluator (code points): in the collation's order [d-z] would take é
      body = body.replace(/[a-z]-[a-z]|[A-Z]-[A-Z]|[0-9]-[0-9]/g, (r) => (r[0]! <= r[2]! ? span(r[0]!, r[2]!) : r));
      if (body === '^') out += '^';
      else if (body) out += `[${negate ? '^' : ''}${body}]`; // [] matches nothing, as C4
    }
  }
  return out;
}

// ---- Functions (R9) ----
const literal = (e: Expr | undefined): string => (e?.k === 'str' ? e.v.toLowerCase() : '');
/** The instant rounded to the nearest second, as the evaluator reads a date's parts (…:59.6 is the next minute). */
const whole = (d: F): F => A`CAST(${d} AS datetime2(0))`;
const part = (name: string, d: F): F => A`DATEPART(${name}, ${whole(d)})`;
const ADD_UNITS: Record<string, string> = { yyyy: 'year', q: 'quarter', m: 'month', y: 'dayofyear', d: 'day', w: 'day', ww: 'week', h: 'hour', n: 'minute', s: 'second' };
const PARTS: Record<string, string> = { yyyy: 'year', q: 'quarter', m: 'month', y: 'dayofyear', d: 'day', w: 'weekday', h: 'hour', n: 'minute', s: 'second' };
const DIFFS: Record<string, string> = { yyyy: 'DATEDIFF(year', q: 'DATEDIFF(quarter', m: 'DATEDIFF(month', y: 'DATEDIFF(day', d: 'DATEDIFF(day', h: 'DATEDIFF(hour',
  n: 'DATEDIFF_BIG(minute', s: 'DATEDIFF_BIG(second' };
const clock = (d: Date, date: boolean, time: boolean): F => p(`${date ? `${pad(d.getFullYear(), 4)}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` : '1899-12-30'}`
  + `T${time ? `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}` : '00:00:00'}`, 'datetime2(0)');

const CALLS: Record<string, (e: Call, g: Gen) => F> = {
  IIf: ({ args: [c, a, b] }, g) => {
    g.common([a!, b!], 'IIf');
    return A`CASE WHEN ${g.cond(c!)} THEN ${g.val(a!)} ELSE ${g.val(b!)} END`;
  },
  Nz: ({ args: [x, d] }, g) => {
    const k = g.common(d ? [x!, d] : [x!], 'Nz');
    if (d) return A`COALESCE(${g.val(x!)}, ${g.val(d)})`;
    return k === 'date' ? refuse('Nz') : A`COALESCE(${g.val(x!)}, ${raw(k === 'num' ? '0' : "N''")})`;
  },
  Len: ({ args: [s] }, g) => len(g.txt(s!, 'Len')),
  Left: ({ args: [s, n] }, g) => A`LEFT(${g.txt(s!, 'Left')}, ${g.int(n!, 'Left')})`,
  Right: ({ args: [s, n] }, g) => A`RIGHT(${g.txt(s!, 'Right')}, ${g.int(n!, 'Right')})`,
  Mid: ({ args: [s, a, n] }, g) => A`SUBSTRING(${g.txt(s!, 'Mid')}, ${g.int(a!, 'Mid')}, ${n ? g.int(n, 'Mid') : raw('2147483647')})`,
  Trim: ({ args: [s] }, g) => A`LTRIM(RTRIM(${g.txt(s!, 'Trim')}))`,
  LTrim: ({ args: [s] }, g) => A`LTRIM(${g.txt(s!, 'LTrim')})`,
  RTrim: ({ args: [s] }, g) => A`RTRIM(${g.txt(s!, 'RTrim')})`,
  UCase: ({ args: [s] }, g) => A`UPPER(${g.txt(s!, 'UCase')})`,
  LCase: ({ args: [s] }, g) => A`LOWER(${g.txt(s!, 'LCase')})`,
  // As the evaluator (C4): an empty text is found at `start` only within the text (InStr("", "") = 0; CHARINDEX finds it
  // nowhere); start < 1 is badArgument — at plan time for a literal, else on the server (a failing cast of the row's value)
  InStr: ({ args }, g) => {
    const [se, fe] = [args.at(-2)!, args.at(-1)!];
    const [s, f] = [g.txt(se, 'InStr'), g.txt(fe, 'InStr')];
    const co = g.collate([se, fe]);
    if (args.length === 2) return A`CASE WHEN ${len(f)} = 0 AND ${len(s)} >= 1 THEN 1 ELSE CHARINDEX(${co(f)}, ${co(s)}) END`;
    const lit = intLiteral(args[0]!);
    if (lit && Number((args[0] as Extract<Expr, { k: 'num' }>).v) < 1) throw new ExprRuntimeError('badArgument');
    const st = g.int(args[0]!, 'InStr');
    const bad = lit ? '' : S`WHEN ${w(st)} < 1 THEN CAST(CONCAT(N'badArgument: InStr start ', ${st}) AS int) `;
    return A`CASE ${bad}WHEN ${len(f)} = 0 AND ${len(s)} >= ${w(st)} THEN ${st} ELSE CHARINDEX(${co(f)}, ${co(s)}, ${st}) END`;
  },
  // R8: on a case-sensitive column, found without case as Access (the result keeps the CI collation)
  Replace: ({ args: [s, f, r] }, g) => {
    const co = g.collate([s!, f!]);
    return A`REPLACE(${co(g.txt(s!, 'Replace'))}, ${co(g.txt(f!, 'Replace'))}, ${g.txt(r!, 'Replace')})`;
  },
  Space: ({ args: [n] }, g) => A`SPACE(${g.int(n!, 'Space')})`,
  String: ({ args: [n, c] }, g) => A`REPLICATE(LEFT(${g.txt(c!, 'String')}, 1), ${g.int(n!, 'String')})`,
  Round: ({ args: [x, n] }, g) => g.bank(g.num(x!, 'Round'), n ? g.int(n, 'Round') : undefined),
  Int: ({ args: [x] }, g) => A`FLOOR(${g.num(x!, 'Int')})`,
  Fix: ({ args: [x] }, g) => A`ROUND(${g.num(x!, 'Fix')}, 0, 1)`,
  Abs: ({ args: [x] }, g) => A`ABS(${g.num(x!, 'Abs')})`,
  Sgn: ({ args: [x] }, g) => A`SIGN(${g.num(x!, 'Sgn')})`,
  Sqr: ({ args: [x] }, g) => A`SQRT(${g.num(x!, 'Sqr')})`,
  CInt: ({ args: [x] }, g) => A`CAST(${g.bank(g.num(x!, 'CInt'))} AS int)`,
  CLng: ({ args: [x] }, g) => A`CAST(${g.bank(g.num(x!, 'CLng'))} AS bigint)`,
  CDbl: ({ args: [x] }, g) => A`CAST(${g.num(x!, 'CDbl')} AS float)`,
  CCur: ({ args: [x] }, g) => g.bank(g.num(x!, 'CCur'), raw('4')),
  Date: (_, g) => clock(g.ctx.now, true, false),
  Time: (_, g) => clock(g.ctx.now, false, true),
  Now: (_, g) => clock(g.ctx.now, true, true),
  ...Object.fromEntries(([['Year', 'year'], ['Month', 'month'], ['Day', 'day'], ['Hour', 'hour'], ['Minute', 'minute'], ['Second', 'second']] as const)
    .map(([name, field]) => [name, ({ args: [d] }: Call, g: Gen) => part(field, g.dat(d!, name))])),
  Weekday: ({ args: [d, first] }, g) => {
    const f = first === undefined ? 1 : intLiteral(first) ? Number(first.v) || 1 : refuse('Weekday'); // 0 (vbUseSystem): Sunday
    if (f > 7) refuse('Weekday');
    return S`((${part('weekday', g.dat(d!, 'Weekday'))} + ${String(7 - f)}) % 7) + 1`; // DATEFIRST 7 (R4): Sunday is 1
  },
  DateAdd: ({ args: [iv, n, d] }, g) => {
    const i = literal(iv);
    return A`DATEADD(${Object.hasOwn(ADD_UNITS, i) ? ADD_UNITS[i]! : refuse('DateAdd')}, ${g.int(n!, 'DateAdd')}, ${whole(g.dat(d!, 'DateAdd'))})`;
  },
  // boundaries crossed, as Access; w, ww refused (R9)
  DateDiff: ({ args: [iv, d1, d2] }, g) => {
    const i = literal(iv);
    const fn = Object.hasOwn(DIFFS, i) ? DIFFS[i]! : refuse('DateDiff');
    return A`${fn}, ${whole(g.dat(d1!, 'DateDiff'))}, ${whole(g.dat(d2!, 'DateDiff'))})`;
  },
  DatePart: ({ args: [iv, d] }, g) => {
    const i = literal(iv);
    return part(Object.hasOwn(PARTS, i) ? PARTS[i]! : refuse('DatePart'), g.dat(d!, 'DatePart'));
  },
  DateSerial: ({ args: [y, m, d] }, g) => {
    // two-digit years as VBA: 0–29 → 20xx, 30–99 → 19xx
    const year = intLiteral(y!) ? p(String(Number(y.v) + (Number(y.v) <= 29 ? 2000 : Number(y.v) <= 99 ? 1900 : 0)), 'int') : (() => {
      const k = g.int(y!, 'DateSerial');
      return A`CASE WHEN ${k} BETWEEN 0 AND 29 THEN ${k} + 2000 WHEN ${k} BETWEEN 30 AND 99 THEN ${k} + 1900 ELSE ${k} END`;
    })();
    return A`DATEADD(day, ${w(g.int(d!, 'DateSerial'))} - 1, DATEADD(month, ${w(g.int(m!, 'DateSerial'))} - 1, CAST(DATEFROMPARTS(${year}, 1, 1) AS datetime2(0))))`;
  },
  TimeSerial: ({ args: [h, n, s] }, g) =>
    A`DATEADD(second, ${g.int(s!, 'TimeSerial')}, DATEADD(minute, ${g.int(n!, 'TimeSerial')}, DATEADD(hour, ${g.int(h!, 'TimeSerial')}, CAST('1899-12-30' AS datetime2(0)))))`,
  // Aggregates (the binding has checked where they stand). `+ CAST(0 AS bigint)` sums an int as bigint (SUM(int) overflows
  // at 2^31) and leaves decimal, money and float their type. AVG of an int truncates: a Currency or Decimal field's average
  // stays exact (native AVG of money; of decimal at bind.ts' sumAvg scale, min(s + 19, 28 - (p - s)), which T-SQL's AVG
  // keeps, and which leaves 10 integer digits beyond the field's for the sum; a bigint is a Decimal(19, 0) whose own AVG
  // would truncate), any other number is averaged as a float.
  // ponytail: a Decimal *expression* (Avg([Montant] * 2)) is averaged as a float (about 15 significant digits); type
  // expressions here if exact averages of them matter.
  Count: ({ args: [x] }, g) => (x!.k === 'star' ? raw('COUNT(*)') : A`COUNT(${g.val(x!)})`),
  Min: ({ args: [x] }, g) => A`MIN(${g.val(x!)})`,
  Max: ({ args: [x] }, g) => A`MAX(${g.val(x!)})`,
  Sum: ({ args: [x] }, g) => A`SUM(${w(g.num(x!, 'Sum'))} + CAST(0 AS bigint))`,
  Avg: ({ args: [x] }, g) => {
    if (g.ctx.typeOf(x!) === 'currency') return A`AVG(${g.num(x!, 'Avg')})`;
    const r = x!.k === 'id' || x!.k === 'member' ? g.ctx.resolve(x!) : undefined;
    const s = r?.scale, scale = s === undefined ? undefined : Math.min(s + 19, 28 - ((r!.precision ?? 18) - s));
    return A`AVG(CAST(${g.num(x!, 'Avg')} AS ${scale === undefined ? 'float' : `decimal(38, ${scale})`}))`;
  },
  ...Object.fromEntries(([['StDev', 'STDEV'], ['StDevP', 'STDEVP'], ['Var', 'VAR'], ['VarP', 'VARP']] as const)
    .map(([name, fn]) => [name, ({ args: [x] }: Call, g: Gen) => A`${fn}(${g.num(x!, name)})`])),
};

/** The closed list's catalog functions (R9 = C4 R14), for docs/sqlserver.md. */
export const MS_FUNCTIONS: ReadonlySet<string> = new Set([...Object.keys(CALLS), 'IsNull', 'CBool']);
/** The catalog functions R9 refuses: C4's list (one list for both engines). */
export const MS_REFUSED: ReadonlySet<string> = PG_REFUSED;

const plain = (f: F): MsFrag => ({ sql: f.sql, params: f.params });
/** A value, R9's table; refusals: bc:serverFunction|<name>|sqlserver. */
export function msValue(e: Expr, ctx: MsExprCtx): MsFrag { return plain(generator(ctx).val(e)); }
/** A condition (WHERE, ON, HAVING): Null and False exclude the row. */
export function msCondition(e: Expr, ctx: MsExprCtx): MsFrag { return plain(generator(ctx).cond(e)); }

/** R8's ORDER BY keys: text `x COLLATE French_100_CI_AS <dir>, x COLLATE Latin1_General_100_BIN2 <dir>` (folded, then
 *  exact); ascending puts Null first natively, as Access; a Yes/No value is already -1/0 (msValue), so Yes sorts first. */
export function msOrderKeys(x: MsFrag, type: FieldType, dir: 'asc' | 'desc'): MsFrag {
  const d = dir.toUpperCase();
  if (!TEXT.has(type)) return plain(S`${w(x)} ${d}`);
  const max = type !== 'shortText';
  return plain(S`${msCollate(x, max, 'French_100_CI_AS')} ${d}, ${msCollate(x, max, 'Latin1_General_100_BIN2')} ${d}`);
}
