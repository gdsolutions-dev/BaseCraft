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
import { bool, date, fail, infoOf, LIBRARY, num, str, toSerial, truthy } from './library';
import type { SqlValue } from '../coerce';
import { defaultProps, quoteIdent, sameName, type FieldType, type NumberSize } from '../field-types';

export interface SqlField { name: string; type: FieldType; numberSize?: NumberSize }
/** `locale` : région des données, comme `EvalEnv.locale` (lecture des nombres et des dates dans le texte). */
export interface SqlCompileCtx { fields: SqlField[]; subject?: string /* nom de champ du sujet implicite */; locale: string }
export interface SqlFragment { sql: string; params: (string | number | null)[] }
export interface SqlCompileOptions { onError?: 'null' | 'throw' }

type SqlOut = number | string | null | Uint8Array;
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

export const SQL_FUNCTIONS: Record<string, { deterministic: boolean; fn: (...a: unknown[]) => SqlOut }> = {
  bc_val: det((type, x) => fromStored({ name: '', props: defaultProps(type as FieldType) }, x as SqlValue)),
  bc_date: det((serial) => date(Number(serial))),
  bc_un: det((l, op, x) => unary(op as '-' | 'Not', dec(x), info(l))),
  bc_op: det((l, op, a, b) => binary(op as BinOp, dec(a), dec(b), info(l))),
  bc_like: det((l, not, v, p) => like(dec(v), dec(p), on(not), info(l))),
  bc_between: det((l, not, v, lo, hi) => between(dec(v), dec(lo), dec(hi), on(not), info(l))),
  // Même boucle que l'In de l'évaluateur : arrêt au premier élément égal, les suivants ne sont pas lus (ni leurs erreurs).
  bc_in: det((l, not, v, ...items) => {
    const x = dec(v);
    let r: boolean | null = false;
    for (const item of items) {
      const c = compare(x, dec(item), info(l));
      if (c === 0) { r = true; break; }
      if (c === null) r = null;
    }
    return r === null ? null : bool(r !== (on(not)));
  }),
  bc_isnull: det((not, v) => bool((dec(v) === null) !== (on(not)))),
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

/** Marge sous les limites de SQLite : 1000 arguments par appel, profondeur d'expression 1000. */
const MAX_ARGS = 900;
const MAX_DEPTH = 900;
const tooComplex = (): never => { throw new ExprSyntaxError('tooComplex', { start: 0, end: 0 }); };

/** Expression -> condition SQLite paramétrée (1/0/NULL). Lève ExprRuntimeError('unknownField') pour un champ inconnu,
 *  ExprSyntaxError('tooComplex') au-delà des limites de SQLite (liste In ou imbrication de plus de 900). */
export function compileSql(e: Expr, ctx: SqlCompileCtx, opts: SqlCompileOptions = {}): SqlFragment {
  const params: (string | number | null)[] = [];
  const P = (v: string | number | null): string => { params.push(v); return '?'; };
  const field = (name: string): SqlField => ctx.fields.find((f) => sameName(f.name, name)) ?? fail('unknownField');

  let depth = 0;
  const deeper = <X>(f: () => X): X => {
    if (++depth > MAX_DEPTH) tooComplex();
    try { return f(); } finally { depth--; }
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
      case 'id': case 'subject': {
        const f = field(x.k === 'id' ? x.name : (ctx.subject ?? fail('unknownField')));
        return `bc_val(${P(f.type)}, ${quoteIdent(f.name)})`; }
      case 'un': return `bc_un(${L()}, ${P(x.op)}, ${val(x.e)})`;
      case 'bin': return `bc_op(${L()}, ${P(x.op)}, ${val(x.l)}, ${val(x.r)})`;
      case 'like': return `bc_like(${L()}, ${P(x.not ? 1 : 0)}, ${val(x.e)}, ${val(x.pattern)})`;
      case 'between': return `bc_between(${L()}, ${P(x.not ? 1 : 0)}, ${val(x.e)}, ${val(x.lo)}, ${val(x.hi)})`;
      // Pas de découpage en Or au-delà de MAX_ARGS : Or lit tous les éléments, l'In de l'évaluateur s'arrête au premier égal.
      case 'in': if (x.list.length > MAX_ARGS) tooComplex(); return `bc_in(${[L(), P(x.not ? 1 : 0), val(x.e), ...x.list.map(val)].join(', ')})`;
      case 'isnull': return `bc_isnull(${P(x.not ? 1 : 0)}, ${val(x.e)})`;
      case 'call': {
        if (!Object.hasOwn(LIBRARY, x.name)) fail('badArgument');
        return `bc_fn_${x.name}(${[L(), ...x.args.map(val)].join(', ')})`;
      }
    }
  });

  const sql = `bc_truth(${P(opts.onError ?? 'null')}, ${L()}, ${val(e)})`;
  return { sql, params };
}
