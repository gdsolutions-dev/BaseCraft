// Évaluateur asynchrone des expressions (sémantique d'Access). Module pur.
import type { BinOp, Expr, Value } from './ast';
import {
  bool, compareText, date, fail, fromSerial, infoOf, LIBRARY, likeMatch, num, str, toDate, toLong, toNum, toSerial, toText, truthy,
} from './library';
import type { CellInput, SqlValue } from '../coerce';
import { sameName, type FieldDef } from '../field-types';
import { parseDateTime, type LocaleInfo } from '../locale-format';
import { parseCanonical } from './parser';

export { truthy } from './library';

export interface EvalEnv { field(name: string): Value; subject?: Value; now(): Date; locale: string; lang?: 'fr' | 'en' }

/** `field` d'un environnement sur un objet : nom résolu comme Access (casse ignorée), champ inconnu -> unknownField. */
export function recordFields(values: Record<string, Value>): (name: string) => Value {
  return (name) => {
    const key = Object.keys(values).find((k) => sameName(k, name));
    return key === undefined ? fail('unknownField') : values[key];
  };
}

const tri = (b: boolean | null): Value => (b === null ? null : bool(b));

function checked(n: number): number {
  if (Number.isNaN(n)) fail('badArgument');
  return Number.isFinite(n) ? n : fail('overflow');
}

/** -1, 0, 1, ou null si un opérande est Null. Texte avec compareText ; une date se compare par son numéro de série. */
export function compare(a: Value, b: Value, info: LocaleInfo): number | null {
  if (a === null || b === null) return null;
  // Empty vaut "" face à un texte, 0 sinon.
  if (a.t === 'empty') a = b.t === 'str' ? str('') : num(0);
  if (b.t === 'empty') b = a.t === 'str' ? str('') : num(0);
  if (a.t === 'str' && b.t === 'str') return compareText(a.v, b.v);
  const [x, y] = a.t === 'date' || b.t === 'date' ? [toDate(a, info), toDate(b, info)] : [toNum(a, info), toNum(b, info)];
  return x < y ? -1 : x > y ? 1 : 0;
}

const TESTS: Partial<Record<BinOp, (c: number) => boolean>> = {
  '=': (c) => c === 0, '<>': (c) => c !== 0, '<': (c) => c < 0, '<=': (c) => c <= 0, '>': (c) => c > 0, '>=': (c) => c >= 0,
};

export function binary(op: BinOp, l: Value, r: Value, info: LocaleInfo): Value {
  if (op === '&') return str((l === null ? '' : toText(l, info)) + (r === null ? '' : toText(r, info)));
  if (op === 'And' || op === 'Or' || op === 'Xor') {
    const [a, b] = [truthy(l, info), truthy(r, info)];
    if (op === 'Xor') return a === null || b === null ? null : bool(a !== b);
    const decisive = op === 'Or'; // Null And False = False ; Null Or True = True
    return a === decisive || b === decisive ? bool(decisive) : a === null || b === null ? null : bool(!decisive);
  }
  const test = TESTS[op];
  if (test) { const c = compare(l, r, info); return c === null ? null : bool(test(c)); }

  if (l === null || r === null) return null;
  if (op === '+' && l.t === 'str' && r.t === 'str') return str(l.v + r.v);
  const [x, y] = [toNum(l, info), toNum(r, info)];
  const dates = (l.t === 'date' ? 1 : 0) + (r.t === 'date' ? 1 : 0);
  switch (op) {
    case '+': return (dates ? date : num)(checked(x + y));
    case '-': return (dates === 1 ? date : num)(checked(x - y)); // date - date = jours
    case '*': return num(checked(x * y));
    case '/': return y === 0 ? fail('divByZero') : num(checked(x / y));
    case '^': return num(checked(x ** y));
    default: { // '\' et 'Mod' : opérandes convertis en entiers longs (arrondi bancaire, dépassement hors ±2^31)
      const [a, b] = [toLong(x), toLong(y)];
      if (b === 0) fail('divByZero');
      return num(op === 'Mod' ? a % b : Math.trunc(a / b));
    }
  }
}

// Opérations synchrones sur des valeurs déjà calculées, partagées avec les fonctions SQLite (sql.ts).

export function unary(op: '-' | 'Not', v: Value, info: LocaleInfo): Value {
  if (op === 'Not') { const b = truthy(v, info); return b === null ? null : bool(!b); }
  return v === null ? null : (v.t === 'date' ? date : num)(-toNum(v, info));
}

export function like(v: Value, p: Value, not: boolean, info: LocaleInfo): Value {
  return v === null || p === null ? null : bool(likeMatch(toText(v, info), toText(p, info)) !== not);
}

/** Bornes non permutées (A2-R6). */
export function between(v: Value, lo: Value, hi: Value, not: boolean, info: LocaleInfo): Value {
  const [a, b] = [compare(v, lo, info), compare(v, hi, info)];
  const [ge, le] = [a === null ? null : a >= 0, b === null ? null : b <= 0]; // v >= lo And v <= hi
  const r = ge === false || le === false ? false : ge === null || le === null ? null : true;
  return tri(r === null ? null : r !== not);
}

export async function evaluate(e: Expr, env: EvalEnv): Promise<Value> {
  const ev = (x: Expr): Promise<Value> => evaluate(x, env);
  const info = infoOf(env.locale);
  switch (e.k) {
    case 'num': return num(Number(e.v));
    case 'str': return str(e.v);
    case 'date': return date(toSerial(e.v));
    case 'bool': return bool(e.v);
    case 'null': return null;
    case 'id': return env.field(e.name);
    case 'subject': return env.subject === undefined ? fail('unknownField') : env.subject;
    case 'un': return unary(e.op, await ev(e.e), info);
    case 'bin': return binary(e.op, await ev(e.l), await ev(e.r), info);
    case 'like': return like(await ev(e.e), await ev(e.pattern), e.not, info);
    case 'between': return between(await ev(e.e), await ev(e.lo), await ev(e.hi), e.not, info);
    case 'in': {
      const v = await ev(e.e);
      let r: boolean | null = false;
      for (const item of e.list) {
        const c = compare(v, await ev(item), info);
        if (c === 0) { r = true; break; }
        if (c === null) r = null;
      }
      return tri(r === null ? null : r !== e.not);
    }
    case 'isnull': return bool((await ev(e.e) === null) !== e.not);
    case 'call': {
      const args: Value[] = [];
      for (const a of e.args) args.push(await ev(a)); // tous les arguments, IIf compris, comme Access
      const fn = LIBRARY[e.name] ?? fail('badArgument');
      return fn(args, env);
    }
  }
}

const POINT: LocaleInfo = { locale: 'en-US', decimalSep: '.', groupSep: '', dateOrder: 'MDY', dateSep: '/' };

/** Valeur stockée -> Value. Une valeur mal formée (texte dans une colonne numérique…) reste du texte, jamais num(NaN).
 *  Un entier au-delà de 2^53 (bigint) est lu au double le plus proche ; un BLOB, écrit par un outil externe, est une erreur. */
export function fromStored(field: FieldDef, v: SqlValue | bigint | Uint8Array): Value {
  if (v === null) return null;
  if (typeof v === 'object') return fail('typeMismatch');
  const type = field.props.type;
  if (type === 'shortText' || type === 'longText' || type === 'hyperlink') return str(String(v));
  if (type === 'dateTime') {
    const iso = parseDateTime(String(v), POINT); // forme stockée ; une date ISO sans heure est aussi acceptée
    return iso === null ? str(String(v)) : date(toSerial(iso));
  }
  // ponytail: Décimal (TEXT) relu en double, exact jusqu'à ~15 chiffres significatifs ; valeur décimale exacte si un calcul en a besoin.
  const n = typeof v === 'number' ? v : typeof v === 'bigint' ? Number(v) : v.trim() === '' ? NaN : Number(v);
  if (!Number.isFinite(n)) return str(String(v));
  return type === 'yesNo' ? bool(n !== 0) : num(n); // autoNumber, number, currency
}

/** Valeur à passer à `coerce`. Un texte est transmis tel quel : coerce le lit selon la région et signale l'erreur du champ. */
export function toStored(field: FieldDef, v: Value, info: LocaleInfo): CellInput {
  if (v === null) return null;
  const type = field.props.type;
  if (type === 'shortText' || type === 'longText' || type === 'hyperlink') return toText(v, info);
  if (v.t === 'empty') return null;
  if (v.t === 'str') return v.v;
  if (v.t === 'bool') return type === 'yesNo' || type === 'dateTime' ? v.v : v.v ? -1 : 0;
  if (type === 'dateTime') return fromSerial(v.v);
  return type === 'yesNo' ? v.v !== 0 : v.v;
}

/** Valeur par défaut d'un champ (expression canonique sans champ), prête pour `coerce` ; les erreurs d'analyse ou de calcul
 *  sont levées. Partagée par la couche d'écriture et la ligne d'ajout de la feuille de données. */
export async function defaultInput(field: FieldDef, info: LocaleInfo, now: () => Date): Promise<CellInput> {
  const e = parseCanonical(field.props.defaultValue ?? '');
  return toStored(field, await evaluate(e, { field: () => fail('unknownField'), now, locale: info.locale }), info);
}
