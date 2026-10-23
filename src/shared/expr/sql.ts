// Générateur SQLite des expressions, paramétré. Module pur : le SQL produit appelle les fonctions bc_* de SQL_FUNCTIONS,
// enregistrées sur chaque connexion par registerFunctions, qui exécutent la même bibliothèque que l'évaluateur.
//
// Exactitude par construction : chaque nœud devient un appel bc_* qui applique la même fonction que l'évaluateur
// (binary, compare, like, between, truthy, LIBRARY…). Aucun opérateur SQL natif : le type déclaré ne garantit pas la classe
// stockée (table adoptée sans CHECK : texte ou BLOB dans une colonne INT), et même `IS NOT NULL` diffère sur un BLOB, que
// l'évaluateur rejette (typeMismatch). Les index ne servent donc pas ici (performance : A6).
//
// Les fonctions sont enregistrées avec useBigIntArguments : un entier arrive en bigint, au-delà de 2^53 compris.
//
// Encodage des valeurs entre deux appels bc_* : Null = NULL, nombre = REAL, texte = TEXT ; date, booléen, Empty et
// erreur = BLOB contenant le JSON de la valeur ({"t":"date","v":46316}, {"t":"err","code":"typeMismatch"}…).
// Une erreur d'exécution devient une valeur {"t":"err"} qui se propage jusqu'à bc_truth : la ligne entière vaut alors
// Null (exclue, onError 'null', par défaut) ou la requête échoue (onError 'throw'), comme l'évaluateur qui lève.
import { ExprRuntimeError, ExprSyntaxError, type BinOp, type Expr, type ExprRuntimeErrorCode, type Value } from './ast';
import { between, binary, compare, fromStored, like, unary, type EvalEnv } from './evaluate';
import { createAccumulator, type Accumulator, type AggregateName } from './aggregate';
import { AGGREGATES } from './catalog';
import { bool, date, fail, fromSerial, infoOf, LIBRARY, num, str, toSerial, truthy } from './library';
import type { SqlValue } from '../coerce';
import { defaultProps, quoteIdent, sameName, type FieldProps, type FieldType, type NumberSize } from '../field-types';
import type { SelectQuery } from '../query/ast';

export interface SqlField { name: string; type: FieldType; numberSize?: NumberSize }
export type SqlParam = string | number | null;
/** A resolved reference: `sql` is a stored value, read through `bc_val(type, …)`; with `type` null, `sql` is already a
 *  bc-encoded value, used as is (Task 4: an output alias compiled in place, an untyped parameter's value). A column of a
 *  saved query or derived table is a stored value with its type: Task 4 projects those columns raw (a field) or through
 *  `bc_out` (a computed value), never encoded. */
export interface SqlRef { sql: string; params: SqlParam[]; type: FieldType | null }
/**
 * `locale` : région des données, comme `EvalEnv.locale` (lecture des nombres et des dates dans le texte).
 * A3 additions:
 * - `ref`: resolves a reference (`table` set for `[T].[F]`) before `fields`; a qualified reference it leaves unresolved is
 *   unknownField. It receives the `id` node itself, so a binding keyed by node (`BoundQuery.refs`) resolves it;
 * - `sub`: SQL of a subquery. Mode `scalar`: an encoded value; `exists`: a native 0/1 condition; `in`: the encoded list
 *   read by `bc_insub(locale, not, x, list)` (registered with the subquery compiler, Task 4);
 * - `argType`: an aggregate's argument type (aggregateArgType, C5), passed as JSON to `bc_agg_<Name>` (Task 4);
 * - `aggregate`: SELECT, HAVING and ORDER BY of a Totals query; aggregates are refused (aggregateContext) otherwise.
 */
export interface SqlCompileCtx {
  fields: SqlField[]; subject?: string /* nom de champ du sujet implicite */; locale: string;
  ref?: (r: { name: string; table?: string }) => SqlRef | null;
  sub?: (q: SelectQuery, mode: 'scalar' | 'exists' | 'in') => SqlFragment;
  argType?: (e: Expr) => { type: FieldType | null; props?: FieldProps };
  aggregate?: boolean;
}
export interface SqlFragment { sql: string; params: SqlParam[] }
export interface SqlCompileOptions { onError?: 'null' | 'throw' }

export type SqlOut = number | bigint | string | null | Uint8Array;
type Tagged = { t: 'date'; v: number } | { t: 'bool'; v: boolean } | { t: 'empty' } | { t: 'err'; code: ExprRuntimeErrorCode };

const utf8 = new TextEncoder();
const utf8d = new TextDecoder();
const blob = (x: Tagged): Uint8Array => utf8.encode(JSON.stringify(x));
const enc = (v: Value): SqlOut => (v === null ? null : v.t === 'num' || v.t === 'str' ? v.v : blob(v));
/** Valeur reçue d'un autre appel bc_* (ou d'un paramètre littéral) ; une erreur encodée est relancée. */
function dec(x: unknown): Value {
  if (x === null || x === undefined) return null;
  if (typeof x === 'number') return num(x);
  if (typeof x === 'bigint') return num(Number(x));
  if (typeof x === 'string') return str(x);
  const o = JSON.parse(utf8d.decode(x as Uint8Array)) as Tagged;
  return o.t === 'err' ? fail(o.code) : o;
}

/** Fonction SQLite : erreur d'exécution -> valeur {"t":"err"} ; toute autre exception est un bogue et remonte. */
const udf = (fn: (...a: unknown[]) => Value) => (...a: unknown[]): SqlOut => {
  try {
    return enc(fn(...a));
  } catch (e) {
    if (e instanceof ExprRuntimeError) return blob({ t: 'err', code: e.code });
    throw e;
  }
};
const info = (locale: unknown) => infoOf(String(locale));
const env = (locale: unknown): EvalEnv => ({ field: () => fail('unknownField'), now: () => new Date(), locale: String(locale) });
const det = (fn: (...a: unknown[]) => Value) => ({ deterministic: true, fn: udf(fn) });
const on = (flag: unknown): boolean => Number(flag) === 1; // drapeau lié 0/1, reçu en bigint
/** Sort key of a text (`bc_fold`, the table sort): accents and case ignored. */
/** toLowerCase() is the default Unicode case mapping, same result as toLocaleLowerCase('und') without the slow ICU path. */
export const fold = (s: string): string => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
/** Runtime error -> encoded error value; anything else is a bug and is rethrown. */
const caught = (e: unknown): SqlOut => {
  if (e instanceof ExprRuntimeError) return blob({ t: 'err', code: e.code });
  throw e;
};

/** Access's In over `items`, read one by one: stops at the first equal item, the following ones are never read (nor
 *  their errors). Shared by `x In (list)` and `x In (SELECT …)`. */
function inItems(l: unknown, not: unknown, v: unknown, items: (() => Value)[]): Value {
  const x = dec(v);
  let r: boolean | null = false;
  for (const item of items) {
    const c = compare(x, item(), info(l));
    if (c === 0) { r = true; break; }
    if (c === null) r = null;
  }
  return r === null ? null : bool(r !== (on(not)));
}
/** The tagged value of a BLOB, or undefined for a raw BLOB (an external tool's, read from a stored column). */
const tagOf = (x: Uint8Array): Tagged | undefined => {
  try { return JSON.parse(utf8d.decode(x)) as Tagged; } catch { return undefined; }
};
/** Encoded list of `bc_list` (JSON): Values, and errors kept in place. */
type ListItem = Value | { t: 'err'; code: ExprRuntimeErrorCode };

export const SQL_FUNCTIONS: Record<string, { deterministic: boolean; fn: (...a: unknown[]) => SqlOut }> = {
  bc_val: det((type, x) => fromStored({ name: '', props: defaultProps(type as FieldType) }, x as SqlValue)),
  bc_date: det((serial) => date(Number(serial))),
  bc_un: det((l, op, x) => unary(op as '-' | 'Not', dec(x), info(l))),
  bc_op: det((l, op, a, b) => binary(op as BinOp, dec(a), dec(b), info(l))),
  bc_like: det((l, not, v, p) => like(dec(v), dec(p), on(not), info(l))),
  bc_between: det((l, not, v, lo, hi) => between(dec(v), dec(lo), dec(hi), on(not), info(l))),
  // Même boucle que l'In de l'évaluateur : arrêt au premier élément égal, les suivants ne sont pas lus (ni leurs erreurs).
  bc_in: det((l, not, v, ...items) => inItems(l, not, v, items.map((item) => () => dec(item)))),
  /** `x In (SELECT …)`: the same loop over the list built by `bc_list`. */
  bc_insub: det((l, not, v, list) => {
    const items = list === null ? [] : JSON.parse(utf8d.decode(list as Uint8Array)) as ListItem[];
    return inItems(l, not, v, items.map((item) => () => (item !== null && item.t === 'err' ? fail(item.code) : item)));
  }),
  /** Encoded value -> stored form (a computed column, Task 4): number, text, date 'YYYY-MM-DD HH:MM:SS', Yes/No 1/0, Null.
   *  ponytail: Empty and an error give Null (Access shows #Error); add a marker when SourcePage gets cell flags. */
  bc_out: {
    deterministic: true,
    fn: (x) => {
      try {
        const v = dec(x);
        return v === null || v.t === 'empty' ? null : v.t === 'date' ? fromSerial(v.v) : v.t === 'bool' ? (v.v ? 1 : 0) : v.v;
      } catch (e) {
        if (e instanceof ExprRuntimeError) return null;
        throw e;
      }
    },
  },
  /** Grouping key (GROUP BY, DISTINCT, UNION) and sort tie-breaker: two texts compareText finds equal get the same key (case
   *  ignored, accents kept); Empty (Nz without a replacement) is "", as Nz gives in an Access query and as compare finds
   *  them equal (A2-R7: Empty counts as ""); any other value keeps its encoding (so Null stays apart from 0 and ""). */
  bc_gkey: {
    deterministic: true,
    fn: (x) => {
      if (typeof x === 'string') return x.normalize('NFC').toLowerCase();
      return x instanceof Uint8Array && tagOf(x)?.t === 'empty' ? '' : x as SqlOut;
    },
  },
  /** Sort key of an encoded value, as the table sort: a text folded (bc_fold), a date its serial number, Yes/No 1/0, a
   *  number itself; Empty and an error Null. `bc_out` of the value breaks the ties. */
  bc_skey: {
    deterministic: true,
    fn: (x) => {
      if (typeof x === 'string') return fold(x);
      if (!(x instanceof Uint8Array)) return x as SqlOut;
      const t = tagOf(x);
      return t?.t === 'date' ? t.v : t?.t === 'bool' ? (t.v ? 1 : 0) : null;
    },
  },
  bc_isnull: det((not, v) => bool((dec(v) === null) !== (on(not)))),
  /** IIf's condition (compiled as a CASE): 1 when true, 0 when false or Null, NULL when it is an error or no truth value. */
  bc_cond: {
    deterministic: true,
    fn: (l, c) => {
      try {
        return truthy(dec(c), info(l)) === true ? 1 : 0;
      } catch (e) {
        if (e instanceof ExprRuntimeError) return null;
        throw e;
      }
    },
  },
  /** Condition finale : 1, 0, ou NULL (Null, ou erreur de la ligne avec onError 'null'). */
  bc_truth: {
    deterministic: true,
    fn: (onError, l, x) => {
      try {
        const b = truthy(dec(x), info(l));
        return b === null ? null : b ? 1 : 0;
      } catch (e) {
        if (e instanceof ExprRuntimeError && onError !== 'throw') return null;
        throw e;
      }
    },
  },
  ...Object.fromEntries(Object.entries(LIBRARY).map(([name, fn]) => [`bc_fn_${name}`, {
    deterministic: !['Date', 'Now', 'Time'].includes(name),
    fn: udf((l, ...args) => fn(args.map(dec), env(l))),
  }])),
};

/**
 * SQL aggregates, registered with `db.aggregate` (start, step, result). A step never throws: node:sqlite would end the
 * statement with no error and no rows. An exception is kept in the state; `result` encodes it (a runtime error) or raises
 * it (a bug).
 */
type AggregateUdf = { start: unknown; step: (acc: unknown, ...a: unknown[]) => unknown; result: (acc: unknown) => SqlOut };
type Kept<S> = { s: S } | { e: unknown };
/** A step that keeps its first exception; the group's later rows are then skipped. */
const keep = <S>(step: (s: S | undefined, ...a: unknown[]) => S) => (k: unknown, ...a: unknown[]): Kept<S> => {
  const kept = k as Kept<S> | null;
  if (kept && 'e' in kept) return kept;
  try { return { s: step(kept?.s, ...a) }; } catch (e) { return { e }; }
};
const settle = <S>(result: (s: S | undefined) => SqlOut) => (k: unknown): SqlOut => {
  const kept = k as Kept<S> | null;
  try {
    if (kept && 'e' in kept) throw kept.e;
    return result(kept?.s);
  } catch (e) {
    return caught(e);
  }
};
type ArgType = { type: FieldType | null; props?: FieldProps };

/**
 * `bc_agg_<Name>(locale, argType, x)`: a thin wrapper around the shared accumulator (contract 1.6, C5), so a Totals query
 * and an A5 report give the same totals. `argType` is the JSON of the argument's accumulator type (`boundArgType`), read
 * at the group's first row; `x` is an encoded value, so `add()` takes evaluator Values only (C9). An error in a row makes
 * the group's result an error. Internal: `bc_list` (the values of `x In (SELECT …)`), and `bc_one` (a scalar subquery:
 * Null without a row, the value with one; beyond, the query fails, as Access's error 3354).
 */
export const SQL_AGGREGATES: Record<string, AggregateUdf> = {
  ...Object.fromEntries([...AGGREGATES].map((name) => [`bc_agg_${name}`, {
    start: () => null,
    step: keep<Accumulator>((acc, l, type, x) => {
      const t = acc === undefined && type !== null ? JSON.parse(String(type)) as ArgType : undefined;
      const a = acc ?? createAccumulator(name as AggregateName, t?.type ?? null, t?.props, info(l));
      a.add(dec(x));
      return a;
    }),
    result: settle<Accumulator>((acc) => enc((acc ?? createAccumulator(name as AggregateName, null)).result())),
  }])),
  bc_list: {
    start: () => null,
    step: keep<ListItem[]>((list = [], x) => {
      try {
        list.push(dec(x));
      } catch (e) {
        if (!(e instanceof ExprRuntimeError)) throw e;
        list.push({ t: 'err', code: e.code });
      }
      return list;
    }),
    result: settle<ListItem[]>((list = []) => utf8.encode(JSON.stringify(list))),
  },
  bc_one: {
    start: () => null,
    step: keep<{ n: number; x: unknown }>((s, x) => ({ n: (s?.n ?? 0) + 1, x })),
    result: (k) => {
      const kept = k as Kept<{ n: number; x: unknown }> | null;
      if (kept && 'e' in kept) throw kept.e;
      if (kept && kept.s.n > 1) throw new Error('bc:invalidQuery|subqueryRows|');
      return kept ? kept.s.x as SqlOut : null;
    },
  },
};

/** Marge sous les limites de SQLite : 1000 arguments par appel ; la pile de son analyseur (SQLite 3.53, Electron 44) est
 *  pleine vers 2 500 entrées et chaque niveau `bc_op(?, ?, …` en prend 5 (496 niveaux). */
const MAX_ARGS = 900;
const MAX_DEPTH = 450;
/** Levels a subquery adds around its expressions that compileValue does not see: the SELECT node and Task 4's wrappers
 *  (EXISTS, bc_truth, bc_out, bc_one / bc_list). */
const SUB_LEVELS = 3;
const tooComplex = (): never => { throw new ExprSyntaxError('tooComplex', { start: 0, end: 0 }); };

/**
 * SQLite adds expression heights up across subqueries (`Expression tree is too large`): an expression's height includes
 * the subqueries in it, and resolving a subquery's expression adds its height again on top of every enclosing one's.
 * The compileValue calls made by `ctx.sub` report their height and cost here; the outermost call checks the total.
 * Compiling is synchronous: set and restored around each `ctx.sub` call.
 * ponytail: every subquery counts like a direct one (EXISTS), twice; Task 4's scalar and In read theirs from a derived table,
 * which SQLite counts once, so they are refused about halfway early (still hundreds of levels).
 */
let enclosing: { height: number; cost: number } | null = null;

/** Expression -> valeur SQLite paramétrée, encodée comme entre deux appels bc_*. Lève ExprRuntimeError('unknownField') pour un
 *  champ inconnu, ExprRuntimeError('aggregateContext') pour un agrégat hors de `ctx.aggregate` (Sum, Count(*)… : seulement
 *  dans un regroupement, lot A3) ou imbriqué dans un autre, ExprSyntaxError('tooComplex') au-delà des limites de SQLite
 *  (liste In ou imbrication de plus de 900, sous-requêtes comprises). */
export function compileValue(e: Expr, ctx: SqlCompileCtx): SqlFragment {
  const params: SqlParam[] = [];
  const P = (v: SqlParam): string => { params.push(v); return '?'; };
  const splice = (f: SqlFragment): string => { params.push(...f.params); return f.sql; };
  const column = (r: { name: string; table?: string }): string => {
    const ref = ctx.ref?.(r);
    if (ref) return ref.type === null ? splice(ref) : `bc_val(${P(ref.type)}, ${splice(ref)})`;
    if (r.table !== undefined) return fail('unknownField');
    const f = ctx.fields.find((x) => sameName(x.name, r.name)) ?? fail('unknownField');
    return `bc_val(${P(f.type)}, ${quoteIdent(f.name)})`;
  };
  let inAggregate = false; // aggregates never nest

  let depth = 0;
  let height = 0; // longest path, subqueries included
  let subCost = 0; // highest cost of a subquery's expression
  const deeper = <X>(f: () => X): X => {
    if (++depth > MAX_DEPTH) tooComplex();
    height = Math.max(height, depth);
    try { return f(); } finally { depth--; }
  };
  const sub = (q: SelectQuery, mode: 'scalar' | 'exists' | 'in'): string => {
    const read = ctx.sub ?? fail('badArgument');
    const outer = enclosing;
    const inner = enclosing = { height: 0, cost: 0 };
    let f: SqlFragment;
    try { f = read(q, mode); } finally { enclosing = outer; }
    height = Math.max(height, depth + SUB_LEVELS + inner.height);
    subCost = Math.max(subCost, SUB_LEVELS + inner.cost);
    return splice(f);
  };

  // ---- Valeur encodée, calculée par les fonctions bc_* ----
  const L = (): string => P(ctx.locale);
  const val = (x: Expr): string => deeper(() => {
    switch (x.k) {
      case 'num': return P(Number(x.v));
      case 'str': return P(x.v);
      case 'date': return `bc_date(${P(toSerial(x.v))})`;
      case 'bool': return `bc_val(${P('yesNo')}, ${P(x.v ? 1 : 0)})`;
      case 'null': return P(null);
      case 'id': return column(x);
      case 'subject': return column({ name: ctx.subject ?? fail('unknownField') });
      case 'sub': return x.mode === 'exists' ? `bc_val(${P('yesNo')}, ${sub(x.q, 'exists')})` : sub(x.q, 'scalar');
      case 'inSub': return `bc_insub(${L()}, ${P(x.not ? 1 : 0)}, ${val(x.e)}, ${sub(x.q, 'in')})`;
      case 'un': return `bc_un(${L()}, ${P(x.op)}, ${val(x.e)})`;
      case 'bin': return `bc_op(${L()}, ${P(x.op)}, ${val(x.l)}, ${val(x.r)})`;
      case 'like': return `bc_like(${L()}, ${P(x.not ? 1 : 0)}, ${val(x.e)}, ${val(x.pattern)})`;
      case 'between': return `bc_between(${L()}, ${P(x.not ? 1 : 0)}, ${val(x.e)}, ${val(x.lo)}, ${val(x.hi)})`;
      // Pas de découpage en Or au-delà de MAX_ARGS : Or lit tous les éléments, l'In de l'évaluateur s'arrête au premier égal.
      case 'in': if (x.list.length > MAX_ARGS) tooComplex(); return `bc_in(${[L(), P(x.not ? 1 : 0), val(x.e), ...x.list.map(val)].join(', ')})`;
      case 'isnull': return `bc_isnull(${P(x.not ? 1 : 0)}, ${val(x.e)})`;
      case 'star': return fail('aggregateContext');
      case 'call': {
        if (AGGREGATES.has(x.name)) {
          if (!ctx.aggregate || inAggregate) fail('aggregateContext');
          const arg = x.args[0]!;
          if (arg.k === 'star') return 'count(*)'; // the parser allows * only in Count(*)
          inAggregate = true;
          try {
            const type = ctx.argType ? JSON.stringify(ctx.argType(arg)) : null;
            return `bc_agg_${x.name}(${L()}, ${P(type)}, ${val(arg)})`;
          } finally { inAggregate = false; }
        }
        if (!Object.hasOwn(LIBRARY, x.name)) fail('badArgument');
        if (x.name === 'IIf' && x.args.length === 3) {
          // only the chosen branch, as the evaluator: bc_cond gives 1 or 0 (Null is false); NULL for a condition that is an
          // error or no truth value, whose error bc_fn_IIf gives again (the condition is computed twice in that case only)
          const [c, a, b] = x.args as [Expr, Expr, Expr];
          return `CASE bc_cond(${L()}, ${val(c)}) WHEN 1 THEN ${val(a)} WHEN 0 THEN ${val(b)} ELSE bc_fn_IIf(${L()}, ${val(c)}, NULL, NULL) END`;
        }
        return `bc_fn_${x.name}(${[L(), ...x.args.map(val)].join(', ')})`;
      }
    }
  });

  const sql = val(e);
  const cost = height + subCost;
  if (enclosing) { enclosing.height = Math.max(enclosing.height, height); enclosing.cost = Math.max(enclosing.cost, cost); }
  else if (cost > MAX_DEPTH) tooComplex();
  return { sql, params };
}

/** Expression -> condition SQLite paramétrée (1/0/NULL) : `bc_truth(compileValue)`. Mêmes erreurs que compileValue. */
export function compileSql(e: Expr, ctx: SqlCompileCtx, opts: SqlCompileOptions = {}): SqlFragment {
  const v = compileValue(e, ctx);
  return { sql: `bc_truth(?, ?, ${v.sql})`, params: [opts.onError ?? 'null', ctx.locale, ...v.params] };
}

/** A value read back from an encoded column (A3: an action query's values); an encoded error throws its ExprRuntimeError. */
export const decodeValue = (x: SqlOut): Value => dec(x);
