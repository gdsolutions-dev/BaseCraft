// PostgreSQL generator of expressions (C4 R14). Pure: no import of `pg`. The bound tree becomes PostgreSQL text over a
// closed list of operators and functions with Access's semantics; anything outside it refuses bc:serverFunction|<name>|
// postgresql before a statement is sent.
//
// Values are never written into the text: each one is a parameter, written `$1::<cast>` in a fragment and numbered by
// `pgNumber` once the statement is whole (one PgParam per occurrence, a repeated fragment repeats its parameters).
// Yes/No: a condition is a native boolean; a Yes/No *value* is -1/0, as Access (a boolean column read as `-abs(x::int4)`,
// which also takes a -1/0 column of a derived table). Text compares case-insensitively (`lower`), accents kept.
import type { SqlValue } from '../../../shared/coerce';
import { ExprRuntimeError, type Expr } from '../../../shared/expr/ast';
import { quoteIdent, type FieldType } from '../../../shared/field-types';
import type { SelectQuery } from '../../../shared/query/ast';

export interface PgFrag { sql: string; params: PgParam[] } // params numbered by the caller ($n assigned at the end)
export type PgParam = { value: SqlValue; cast: 'text' | 'numeric' | 'float8' | 'int4' | 'int8' | 'timestamp' | 'boolean' };
export interface PgExprCtx {
  /** A column, already quoted, presented in the class the generator assumes: every Date/Time value a `timestamp` (a
   *  `date` or `timestamptz` column cast, a `time` column as `date '1899-12-30' + "t"`), every text value a `text` (`enum`,
   *  `json`, `jsonb`, `uuid` cast) — `lower`, `ILIKE`, `extract`, `date_trunc` fail on the others (Task 7's contract).
   *  A query parameter ([P], [Forms]!…): `sql` `$1::<cast>` (`::boolean` for Yes/No), its value in `params` and
   *  `param: true`, so a Like pattern parameter can be translated (an output alias's expression may carry parameters too). */
  resolve(e: Extract<Expr, { k: 'id' | 'member' }>): { sql: string; type: FieldType | null; params?: PgParam[]; param?: true };
  subject?: { sql: string; type: FieldType }; // criteria mode
  typeOf(e: Expr): FieldType | null; // exprType of the bound query
  subquery?(q: SelectQuery): PgFrag; // Task 7
  now: Date;
  /** R15's collation (read at connect), for ordering comparisons of text; absent: the column's own. */
  collation?: string | null;
}

export const pgIdent: (name: string) => string = quoteIdent;
const refuse = (name: string): never => { throw new Error(`bc:serverFunction|${name}|postgresql`); };

// ---- Fragments: `atom` = needs no parentheses as an operand ----
type F = PgFrag & { atom?: boolean };
type Part = F | string; // a string part is generator text, never a value
function S(strs: TemplateStringsArray, ...xs: Part[]): F {
  const params: PgParam[] = [];
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
const ATOMIC = /^(?:(?:[a-z]\w*\.|"(?:[^"]|"")*"\.)*"(?:[^"]|"")*"|\$1::\w+)$/; // a (qualified: a0."x") identifier or a parameter
const w = (x: F): F => (x.atom || ATOMIC.test(x.sql) ? x : A`(${x})`);
const join = (xs: F[], sep = ', '): F => xs.reduce<F>((acc, x, i) => (i ? S`${acc}${sep}${x}` : x), { sql: '', params: [] });
const p = (value: SqlValue, cast: PgParam['cast']): F => ({ sql: `$1::${cast}`, params: [{ value, cast }], atom: true });
const raw = (sql: string): F => ({ sql, params: [], atom: true }); // generator constants only

/** Numbers the `$1::` markers of a whole statement in order, from `start`, outside quoted identifiers and literals. Equal
 *  parameters (same cast and value) share one number, so an expression written twice (select list and GROUP BY, a hidden
 *  order key and WITH TIES) is the same expression to PostgreSQL; `params`: one per number. */
export function pgNumber(f: PgFrag, start = 1): { sql: string; params: PgParam[] } {
  const params: PgParam[] = [];
  const seen = new Map<string, number>();
  let i = 0;
  const sql = f.sql.replace(/"(?:[^"]|"")*"|'(?:[^']|'')*'|\$1::/g, (m) => {
    if (m !== '$1::') return m;
    const x = f.params[i++];
    if (!x) return m; // counted below
    const key = `${x.cast}|${typeof x.value}|${String(x.value)}`; // NaN and Infinity apart from Null
    if (!seen.has(key)) seen.set(key, params.push(x) - 1);
    return `$${start + seen.get(key)!}::`;
  });
  if (i !== f.params.length) throw new Error(`pgNumber: ${i} markers, ${f.params.length} parameters`);
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

type Call = Extract<Expr, { k: 'call' }>;
type Gen = ReturnType<typeof generator>;

function generator(ctx: PgExprCtx) {
  const cls = (e: Expr): Cls => (e.k === 'null' ? 'null' : CLASS[ctx.typeOf(e) ?? 'shortText']);
  /** The one class of `es` (Null goes with any), else refused as `name`. */
  const common = (es: Expr[], name: string): Cls => {
    const cs = new Set(es.map(cls).filter((x) => x !== 'null'));
    return cs.size > 1 ? refuse(name) : ([...cs][0] ?? 'null');
  };
  const typed = (c: Cls, e: Expr, name: string): F => {
    const k = cls(e);
    if (k === 'null') return raw(`NULL::${c === 'text' ? 'text' : c === 'date' ? 'timestamp' : 'numeric'}`);
    return k === c ? val(e) : refuse(name);
  };
  const num = (e: Expr, name: string): F => typed('num', e, name);
  const txt = (e: Expr, name: string): F => typed('text', e, name);
  const dat = (e: Expr, name: string): F => typed('date', e, name);
  /** Banker's rounding on numeric (R14), at `n` decimals.
   *  ponytail: `y` is written 6 times (R14's CASE), so each nested Round/CInt/CLng/\/Mod multiplies the text by 6 (its
   *  parameters share their numbers: pgNumber); bind `y` once through a LATERAL subquery or a CTE if real queries nest
   *  deep enough for the text to matter. */
  const bank = (x: F, n?: F): F => {
    const y = n ? S`${w(x)}::numeric * power(10::numeric, ${n})` : S`${w(x)}::numeric`;
    const fy = A`floor(${y})`;
    const r = A`CASE WHEN ${w(y)} - ${fy} = 0.5 THEN (CASE WHEN mod(${fy}, 2) = 0 THEN ${fy} ELSE ${fy} + 1 END) ELSE round(${y}) END`;
    return n ? S`${r} / power(10::numeric, ${n})` : r;
  };
  /** An integer argument, as the evaluator's `long`: banker's rounding. */
  const int = (e: Expr, name: string): F => (intLiteral(e) ? p(Number(e.v), 'int4') : A`${bank(num(e, name))}::int4`);

  const ref = (r: { sql: string; type: FieldType | null; params?: PgParam[] }): F => {
    const x: F = { sql: r.sql, params: r.params ?? [] };
    return r.type === 'yesNo' ? S`-abs(${w(x)}::int4)` : x;
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
    const c = common([l, r], op);
    if (c !== 'text') return S`${w(val(l))} ${op} ${w(val(r))}`;
    const coll = op !== '=' && op !== '<>' && ctx.collation ? ` COLLATE ${pgIdent(ctx.collation)}` : '';
    return S`lower(${txt(l, op)})${coll} ${op} lower(${txt(r, op)})`;
  }
  const lowered = (e: Expr, c: Cls): F => (c === 'text' ? A`lower(${txt(e, 'In')})` : w(val(e)));
  const sub = (q: SelectQuery): F => (ctx.subquery ?? (() => { throw new Error('bc:serverNotSupported|other|postgresql'); }))(q);

  function like(e: Extract<Expr, { k: 'like' }>): F {
    if (cls(e.e) !== 'text' && cls(e.e) !== 'null') refuse('Like');
    const pt = e.pattern;
    const r = pt.k === 'id' || pt.k === 'member' ? ctx.resolve(pt) : null;
    const value = pt.k === 'str' ? pt.v : pt.k === 'null' ? null : r?.param && r.params?.length === 1 ? r.params[0]!.value : refuse('Like');
    const { op, pattern } = value === null ? { op: 'ILIKE', pattern: null } : likePattern(String(value));
    const m = S`${w(val(e.e))} ${op} ${p(pattern, 'text')}`;
    return e.not ? S`NOT ${w(m)}` : m;
  }

  function cond(e: Expr): F {
    switch (e.k) {
      case 'bin':
        if (COMPARE.has(e.op)) return compare(e.op, e.l, e.r);
        if (e.op === 'And' || e.op === 'Or') return S`${w(cond(e.l))} ${e.op.toUpperCase()} ${w(cond(e.r))}`;
        if (e.op === 'Xor') return S`${w(cond(e.l))} <> ${w(cond(e.r))}`;
        break;
      case 'un': if (e.op === 'Not') return S`NOT ${w(cond(e.e))}`; break;
      case 'like': return like(e);
      case 'between': {
        const c = common([e.e, e.lo, e.hi], 'Between');
        const coll = c === 'text' && ctx.collation ? ` COLLATE ${pgIdent(ctx.collation)}` : '';
        return S`${lowered(e.e, c)}${coll} ${e.not ? 'NOT ' : ''}BETWEEN ${lowered(e.lo, c)} AND ${lowered(e.hi, c)}`;
      }
      case 'in': {
        const c = common([e.e, ...e.list], 'In');
        return S`${lowered(e.e, c)} ${e.not ? 'NOT ' : ''}IN (${join(e.list.map((x) => lowered(x, c)))})`;
      }
      case 'inSub': {
        const c = common([e.e, { k: 'sub', mode: 'scalar', q: e.q }], 'In');
        const list = c === 'text' ? S`SELECT lower(s.v) FROM (${sub(e.q)}) AS s(v)` : sub(e.q);
        return S`${lowered(e.e, c)} ${e.not ? 'NOT ' : ''}IN (${list})`;
      }
      case 'isnull': return S`${w(val(e.e))} IS ${e.not ? 'NOT ' : ''}NULL`;
      case 'sub': if (e.mode === 'exists') return S`EXISTS (${sub(e.q)})`; break;
      case 'call':
        if (e.name === 'IsNull') return S`${w(val(e.args[0]!))} IS NULL`;
        if (e.name === 'CBool') return cond(e.args[0]!);
        break;
    }
    // a value as a condition: a number is true when not 0 (Yes/No values are -1/0); text and dates are refused
    const c = cls(e);
    return c === 'num' || c === 'null' ? S`${w(val(e))} <> 0` : refuse('CBool');
  }

  function arith(e: Extract<Expr, { k: 'bin' }>): F {
    const { op, l, r } = e;
    const cs = new Set([cls(l), cls(r)].filter((x) => x !== 'null'));
    const only = (c: Cls): boolean => [...cs].every((x) => x === c);
    if (op === '&') {
      const part = (x: Expr): F => (x.k === 'null' ? raw('NULL::text')
        : cls(x) === 'text' || ctx.typeOf(x) === 'autoNumber' || intLiteral(x) ? val(x) : refuse('&'));
      return A`concat(${part(l)}, ${part(r)})`;
    }
    if (op === '+' && cs.size && only('text')) return S`${w(txt(l, op))} || ${w(txt(r, op))}`;
    if ((op === '+' || op === '-') && cs.has('date')) {
      if (op === '-' && cls(l) !== 'num' && cls(r) !== 'num') return S`extract(epoch from ${w(dat(l, op))} - ${w(dat(r, op))}) / 86400`;
      const [d, n] = cls(l) === 'date' ? [l, r] : op === '+' ? [r, l] : refuse(op);
      return S`${w(dat(d, op))} ${op} ${w(num(n, op))} * interval '1 day'`;
    }
    if (!only('num')) refuse(op);
    const [a, b] = [num(l, op), num(r, op)];
    switch (op) {
      case '/': return S`${w(a)}::float8 / ${w(b)}`;
      case '^': return A`power(${a}, ${b})`;
      case '\\': return A`div(${bank(a)}, ${bank(b)})`;
      case 'Mod': return A`mod(${bank(a)}, ${bank(b)})`;
      default: return S`${w(a)} ${op} ${w(b)}`; // + - *
    }
  }

  function val(e: Expr): F {
    if (isCond(e)) { const c = cond(e); return A`CASE WHEN ${c} THEN -1 WHEN NOT ${w(c)} THEN 0 END`; }
    switch (e.k) {
      case 'num': return p(e.v, 'numeric');
      case 'str': return p(e.v, 'text');
      case 'date': return p(e.v, 'timestamp');
      case 'bool': return p(e.v ? -1 : 0, 'int4');
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

  const gen = { val, cond, common, num, txt, dat, int, bank, ctx };
  return gen;
}

// ---- Like (R14): `*` `?` only → ILIKE; with `#` or `[…]` → anchored case-insensitive regular expression ----
function likePattern(s: string): { op: 'ILIKE' | '~*'; pattern: string } {
  if (!/[#[]/.test(s)) return { op: 'ILIKE', pattern: s.replace(/[\\%_]/g, '\\$&').replace(/\*/g, '%').replace(/\?/g, '_') };
  const c = [...s.normalize('NFC')];
  let re = '^';
  for (let i = 0; i < c.length; i++) {
    const ch = c[i]!;
    if (ch === '*') re += '.*';
    else if (ch === '?') re += '.';
    else if (ch === '#') re += '[0-9]';
    else if (ch !== '[') re += ch.replace(/[\\^$.*+?()[\]{}|]/, '\\$&');
    else {
      const close = c.indexOf(']', i + 1);
      if (close < 0) refuse('Like'); // Access: an error in every row
      let body = c.slice(i + 1, close);
      i = close;
      const negate = body[0] === '!' && body.length > 1;
      if (negate) body = body.slice(1);
      if (body.length) re += `[${negate ? '^' : ''}${body.map((x) => x.replace(/[\\^[]/, '\\$&')).join('')}]`; // [] matches nothing, as Access
    }
  }
  return { op: '~*', pattern: `${re}$` };
}

// ---- Functions (R14) ----
const literal = (e: Expr | undefined): string => (e?.k === 'str' ? e.v.toLowerCase() : '');
const ext = (field: string, d: F): F => A`extract(${field} from ${d})::int4`;
/** The instant rounded to the nearest second, as the evaluator reads a date's parts (…:59.6 is the next minute). */
const whole = (d: F): F => A`date_trunc('second', ${w(d)} + interval '0.5 second')`;
const ADD_UNITS: Record<string, string> = { yyyy: 'months', q: 'months', m: 'months', y: 'days', d: 'days', w: 'days', ww: 'weeks', h: 'hours', n: 'mins', s: 'secs' };
const PARTS: Record<string, string> = { yyyy: 'year', q: 'quarter', m: 'month', y: 'doy', d: 'day', h: 'hour', n: 'minute', s: 'second' };
const clock = (d: Date, date: boolean, time: boolean): F => p(`${date ? `${pad(d.getFullYear(), 4)}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` : '1899-12-30'} `
  + `${time ? `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}` : '00:00:00'}`, 'timestamp');

const CALLS: Record<string, (e: Call, g: Gen) => F> = {
  IIf: ({ args: [c, a, b] }, g) => {
    g.common([a!, b!], 'IIf');
    return A`CASE WHEN ${g.cond(c!)} THEN ${g.val(a!)} ELSE ${g.val(b!)} END`;
  },
  Nz: ({ args: [x, d] }, g) => {
    const k = g.common(d ? [x!, d] : [x!], 'Nz');
    if (d) return A`coalesce(${g.val(x!)}, ${g.val(d)})`;
    return k === 'date' ? refuse('Nz') : A`coalesce(${g.val(x!)}, ${raw(k === 'num' ? '0' : "''")})`;
  },
  Len: ({ args: [s] }, g) => A`char_length(${g.txt(s!, 'Len')})`,
  Left: ({ args: [s, n] }, g) => A`left(${g.txt(s!, 'Left')}, ${g.int(n!, 'Left')})`,
  Right: ({ args: [s, n] }, g) => A`right(${g.txt(s!, 'Right')}, ${g.int(n!, 'Right')})`,
  Mid: ({ args: [s, a, n] }, g) => (n ? A`substr(${g.txt(s!, 'Mid')}, ${g.int(a!, 'Mid')}, ${g.int(n, 'Mid')})` : A`substr(${g.txt(s!, 'Mid')}, ${g.int(a!, 'Mid')})`),
  Trim: ({ args: [s] }, g) => A`btrim(${g.txt(s!, 'Trim')}, ' ')`,
  LTrim: ({ args: [s] }, g) => A`ltrim(${g.txt(s!, 'LTrim')}, ' ')`,
  RTrim: ({ args: [s] }, g) => A`rtrim(${g.txt(s!, 'RTrim')}, ' ')`,
  UCase: ({ args: [s] }, g) => A`upper(${g.txt(s!, 'UCase')})`,
  LCase: ({ args: [s] }, g) => A`lower(${g.txt(s!, 'LCase')})`,
  // As the evaluator: an empty text found at `start` only within the text (InStr("", "") = 0); start < 1 is badArgument —
  // at plan time for a literal, else on the server (a failing cast that depends on the row, so it is never folded early)
  InStr: ({ args }, g) => {
    const [s, f] = [g.txt(args.at(-2)!, 'InStr'), g.txt(args.at(-1)!, 'InStr')];
    if (args.length === 2) return A`CASE WHEN char_length(${s}) = 0 AND char_length(${f}) = 0 THEN 0 ELSE strpos(lower(${s}), lower(${f})) END`;
    const lit = intLiteral(args[0]!);
    if (lit && Number((args[0] as Extract<Expr, { k: 'num' }>).v) < 1) throw new ExprRuntimeError('badArgument');
    const st = g.int(args[0]!, 'InStr');
    const at = A`strpos(lower(substr(${s}, ${st})), lower(${f}))`;
    const bad = lit ? '' : S`WHEN ${w(st)} < 1 THEN ('badArgument: InStr start ' || ${st})::int4 `;
    return A`CASE ${bad}WHEN char_length(${f}) = 0 AND ${w(st)} > char_length(${s}) THEN 0 WHEN ${at} = 0 THEN 0 ELSE ${at} + ${st} - 1 END`;
  },
  Replace: ({ args: [s, f, r] }, g) => A`replace(${g.txt(s!, 'Replace')}, ${g.txt(f!, 'Replace')}, ${g.txt(r!, 'Replace')})`,
  Space: ({ args: [n] }, g) => A`repeat(' ', ${g.int(n!, 'Space')})`,
  String: ({ args: [n, c] }, g) => A`repeat(left(${g.txt(c!, 'String')}, 1), ${g.int(n!, 'String')})`,
  Round: ({ args: [x, n] }, g) => g.bank(g.num(x!, 'Round'), n ? g.int(n, 'Round') : undefined),
  Int: ({ args: [x] }, g) => A`floor(${g.num(x!, 'Int')})`,
  Fix: ({ args: [x] }, g) => A`trunc(${g.num(x!, 'Fix')})`,
  Abs: ({ args: [x] }, g) => A`abs(${g.num(x!, 'Abs')})`,
  Sgn: ({ args: [x] }, g) => A`sign(${g.num(x!, 'Sgn')})`,
  Sqr: ({ args: [x] }, g) => A`sqrt(${g.num(x!, 'Sqr')})`,
  CInt: ({ args: [x] }, g) => A`${g.bank(g.num(x!, 'CInt'))}::int4`,
  CLng: ({ args: [x] }, g) => A`${g.bank(g.num(x!, 'CLng'))}::int8`,
  CDbl: ({ args: [x] }, g) => A`${w(g.num(x!, 'CDbl'))}::float8`,
  // banker's at 4 decimals, as the evaluator's CCur (R14 writes round(x::numeric, 4), which rounds half away from zero)
  CCur: ({ args: [x] }, g) => g.bank(g.num(x!, 'CCur'), raw('4')),
  Date: (_, g) => clock(g.ctx.now, true, false),
  Time: (_, g) => clock(g.ctx.now, false, true),
  Now: (_, g) => clock(g.ctx.now, true, true),
  ...Object.fromEntries(([['Year', 'year'], ['Month', 'month'], ['Day', 'day'], ['Hour', 'hour'], ['Minute', 'minute'], ['Second', 'second']] as const)
    .map(([name, field]) => [name, ({ args: [d] }: Call, g: Gen) => ext(field, whole(g.dat(d!, name)))])),
  Weekday: ({ args: [d, first] }, g) => {
    const f = first === undefined ? 1 : intLiteral(first) ? Number(first.v) || 1 : refuse('Weekday'); // 0 (vbUseSystem): Sunday
    if (f > 7) refuse('Weekday');
    return S`mod(${ext('dow', whole(g.dat(d!, 'Weekday')))} + ${p(8 - f, 'int4')}, 7) + 1`;
  },
  DateAdd: ({ args: [iv, n, d] }, g) => {
    const i = literal(iv), unit = Object.hasOwn(ADD_UNITS, i) ? ADD_UNITS[i]! : refuse('DateAdd');
    const date = whole(g.dat(d!, 'DateAdd')), k = g.int(n!, 'DateAdd');
    return S`${w(date)} + make_interval(${unit} => ${i === 'yyyy' ? S`${w(k)} * 12` : i === 'q' ? S`${w(k)} * 3` : k})`;
  },
  DateDiff: ({ args: [iv, d1, d2] }, g) => {
    const i = literal(iv);
    const [a, b] = [whole(g.dat(d1!, 'DateDiff')), whole(g.dat(d2!, 'DateDiff'))];
    switch (i) {
      case 'yyyy': return S`${ext('year', b)} - ${ext('year', a)}`;
      case 'q': return S`(${ext('year', b)} * 4 + ${ext('quarter', b)}) - (${ext('year', a)} * 4 + ${ext('quarter', a)})`;
      case 'm': return S`(${ext('year', b)} * 12 + ${ext('month', b)}) - (${ext('year', a)} * 12 + ${ext('month', a)})`;
      case 'y': case 'd': return S`${w(b)}::date - ${w(a)}::date`;
      case 'h': case 'n': case 's': {
        const [unit, secs] = ({ h: ['hour', 3600], n: ['minute', 60], s: ['second', 1] } as const)[i];
        return A`(extract(epoch from date_trunc('${unit}', ${b}) - date_trunc('${unit}', ${a})) / ${String(secs)})::int8`;
      }
      default: return refuse('DateDiff'); // w, ww (R14), or not a literal
    }
  },
  DatePart: ({ args: [iv, d] }, g) => {
    const i = literal(iv), date = whole(g.dat(d!, 'DatePart'));
    if (i === 'w') return S`${ext('dow', date)} + 1`;
    return Object.hasOwn(PARTS, i) ? ext(PARTS[i]!, date) : refuse('DatePart');
  },
  DateSerial: ({ args: [y, m, d] }, g) => {
    // two-digit years as VBA: 0–29 → 20xx, 30–99 → 19xx
    const year = intLiteral(y!) ? p(Number(y.v) + (Number(y.v) <= 29 ? 2000 : Number(y.v) <= 99 ? 1900 : 0), 'int4') : (() => {
      const k = g.int(y!, 'DateSerial');
      return A`CASE WHEN ${k} BETWEEN 0 AND 29 THEN ${k} + 2000 WHEN ${k} BETWEEN 30 AND 99 THEN ${k} + 1900 ELSE ${k} END`;
    })();
    return S`make_date(${year}, 1, 1) + make_interval(months => ${w(g.int(m!, 'DateSerial'))} - 1, days => ${w(g.int(d!, 'DateSerial'))} - 1)`;
  },
  TimeSerial: ({ args: [h, n, s] }, g) =>
    S`timestamp '1899-12-30' + make_interval(hours => ${g.int(h!, 'TimeSerial')}, mins => ${g.int(n!, 'TimeSerial')}, secs => ${g.int(s!, 'TimeSerial')})`,
  // Aggregates (the binding has checked where they stand)
  Count: ({ args: [x] }, g) => (x!.k === 'star' ? raw('count(*)') : A`count(${g.val(x!)})`),
  Min: ({ args: [x] }, g) => A`min(${g.val(x!)})`,
  Max: ({ args: [x] }, g) => A`max(${g.val(x!)})`,
  ...Object.fromEntries(([['Sum', 'sum'], ['Avg', 'avg'], ['StDev', 'stddev_samp'], ['StDevP', 'stddev_pop'], ['Var', 'var_samp'], ['VarP', 'var_pop']] as const)
    .map(([name, fn]) => [name, ({ args: [x] }: Call, g: Gen) => A`${fn}(${g.num(x!, name)})`])),
};

/** The closed list's catalog functions (R14), for docs/postgresql.md. */
export const PG_FUNCTIONS: ReadonlySet<string> = new Set([...Object.keys(CALLS), 'IsNull', 'CBool']);
/** The catalog functions R14 refuses: locale-dependent, or no order to take first/last by. */
export const PG_REFUSED: ReadonlySet<string> = new Set(['Format', 'Val', 'CStr', 'CDate', 'IsNumeric', 'IsDate', 'StrComp', 'First', 'Last']);

const plain = (f: F): PgFrag => ({ sql: f.sql, params: f.params });
/** A value, R14's table; refusals: bc:serverFunction|<name>|postgresql. */
export function pgValue(e: Expr, ctx: PgExprCtx): PgFrag { return plain(generator(ctx).val(e)); }
/** A condition (WHERE, ON, HAVING): Null and False exclude the row. */
export function pgCondition(e: Expr, ctx: PgExprCtx): PgFrag { return plain(generator(ctx).cond(e)); }

/** ORDER BY keys of a value of type `type` (R15). `collation`: read at connect. Text: case folded in the collation, then
 *  exact; ascending puts Null first, as Access; a Yes/No value is -1/0, so Yes sorts first ascending, as Access. */
export function pgOrderKeys(x: PgFrag, type: FieldType, dir: 'asc' | 'desc', collation: string | null): PgFrag {
  const d = dir === 'asc' ? 'ASC NULLS FIRST' : 'DESC NULLS LAST';
  if (!TEXT.has(type)) return plain(S`${w(x)} ${d}`);
  const coll = collation ? ` COLLATE ${pgIdent(collation)}` : '';
  return plain(S`lower(${x})${coll} ${d}, ${w(x)} COLLATE "C" ${dir.toUpperCase()}`);
}
