// Bibliothèque de fonctions des expressions, avec la sémantique d'Access. Module pur : chaque fonction ne dépend que de
// ses arguments et de `env`, si bien que la même bibliothèque sert aussi de fonctions SQLite.
import { ExprRuntimeError, type ExprRuntimeErrorCode, type Value } from './ast';
import { KEYWORDS } from './catalog';
import { formatValue } from './format';
import type { EvalEnv } from './evaluate';
import { numberToText, toDecimal } from '../coerce';
import { formatDateTime, localeInfo, parseDateTime, parseDecimal, roundDecimalString, type LocaleInfo } from '../locale-format';

// Synchrone : chaque fonction sert aussi de fonction SQLite (tâche 5), qui ne peut pas attendre une promesse.
export type LibFn = (args: Value[], env: EvalEnv) => Value;
type V = Exclude<Value, null>;

export const num = (v: number): { t: 'num'; v: number } => ({ t: 'num', v: v + 0 }); // + 0 : jamais de -0
export const str = (v: string): { t: 'str'; v: string } => ({ t: 'str', v });
export const date = (v: number): { t: 'date'; v: number } => ({ t: 'date', v: v + 0 });
export const bool = (v: boolean): { t: 'bool'; v: boolean } => ({ t: 'bool', v });
export const EMPTY: Value = { t: 'empty' };

export const fail = (code: ExprRuntimeErrorCode): never => { throw new ExprRuntimeError(code); };

/** Space and String repeat at most 65535 times (VBA). */
export const MAX_TEXT = 65535;
/** Longest text & + Replace may build (UTF-16 units): past it, an overflow, never out of memory. High enough to append to
 *  a stored Long Text (an import reads fields up to 1 MiB); stored values themselves are never capped. */
export const MAX_BUILT_TEXT = 1 << 20;
/** str() for text that grows (& + Replace). */
export const built = (v: string): { t: 'str'; v: string } => (v.length > MAX_BUILT_TEXT ? fail('overflow') : str(v));

/** Point décimal, sans séparateur de milliers. */
const POINT: LocaleInfo = { locale: 'en-US', decimalSep: '.', groupSep: '', dateOrder: 'MDY', dateSep: '/' };
const infos = new Map<string, LocaleInfo>();
/** `localeInfo` mémorisé (simple cache, sans effet sur les résultats). */
export function infoOf(locale: string): LocaleInfo {
  let i = infos.get(locale);
  if (!i) infos.set(locale, (i = localeInfo(locale)));
  return i;
}

// ---- Conversions ----

/** Texte numérique selon la région, avec repli sur le point décimal ; null s'il n'est pas numérique. */
function textToNumber(s: string, info: LocaleInfo): number | null {
  const d = parseDecimal(s, info) ?? parseDecimal(s, POINT);
  if (d !== null) return Number(d);
  return /^\s*[+-]?(\d+\.?\d*|\.\d+)e[+-]?\d+\s*$/i.test(s) ? Number(s) : null;
}

/** Chaîne décimale exacte du double (forme la plus courte qui le relit), pour les arrondis bancaires. */
const dec = (n: number): string => toDecimal(n, POINT) ?? fail('overflow');
/** Arrondi bancaire à l'entier (opérandes de \ et Mod, CInt, CLng…). */
export const roundInt = (n: number): number => Number(roundDecimalString(dec(n), 0));

export function toNum(v: V, info: LocaleInfo): number {
  switch (v.t) {
    case 'num': case 'date': return v.v;
    case 'bool': return v.v ? -1 : 0;
    case 'empty': return 0;
    case 'str': return textToNumber(v.v, info) ?? fail('typeMismatch');
  }
}

export function toDate(v: V, info: LocaleInfo): number {
  if (v.t !== 'str') return toNum(v, info);
  const iso = parseDateTime(v.v, info);
  return iso === null ? fail('typeMismatch') : toSerial(iso);
}

/** CStr d'Access : nombre avec le séparateur décimal régional, date courte régionale (heure seule si la date est nulle). */
export function toText(v: V, info: LocaleInfo): string {
  switch (v.t) {
    case 'str': return v.v;
    case 'num': return numberToText(v.v, info);
    case 'bool': return v.v ? 'True' : 'False';
    case 'empty': return '';
    case 'date': {
      const p = parts(v.v);
      if (p.day !== 0) return formatDateTime(fromSerial(v.v), info.locale);
      // Heure seule, 00:00:00 compris, comme VBA ; heure sur deux chiffres en horloge de 24 h.
      const t = new Intl.DateTimeFormat(info.locale, { hour: 'numeric', minute: '2-digit', second: '2-digit', timeZone: 'UTC' }).formatToParts(p.date);
      const h24 = !t.some((x) => x.type === 'dayPeriod');
      return t.map((x) => (x.type === 'hour' && h24 ? x.value.padStart(2, '0') : x.value)).join('');
    }
  }
}

const WORDS = new Map([['true', true], ['false', false], [KEYWORDS.True.fr.toLowerCase(), true], [KEYWORDS.False.fr.toLowerCase(), false]]);

/** Valeur de vérité : null pour Null ; nombre ≠ 0 vrai ; "True"/"False" (ou Vrai/Faux) ; texte numérique selon la région ; sinon typeMismatch. */
export function truthy(v: Value, info: LocaleInfo = POINT): boolean | null {
  if (v === null) return null;
  if (v.t === 'bool') return v.v;
  const word = v.t === 'str' ? WORDS.get(v.v.trim().toLowerCase()) : undefined;
  return word ?? toNum(v, info) !== 0;
}

/** Entier long de VBA (CLng) : arrondi bancaire, dépassement hors de l'intervalle. */
export function toLong(x: number): number {
  const n = roundInt(x);
  return n < -2147483648 || n > 2147483647 ? fail('overflow') : n;
}
const long = (v: V, info: LocaleInfo): number => toLong(toNum(v, info));
const nonNeg = (n: number): number => (n < 0 ? fail('badArgument') : n);
/** Nombre de répétitions de Space et String (limite des chaînes de VBA courantes). */
const count = (n: number): number => (n > MAX_TEXT ? fail('overflow') : nonNeg(n));

// ---- Texte ----

const collator = new Intl.Collator('und', { sensitivity: 'accent' });
/** Comparaison de texte d'Access : insensible à la casse, sensible aux accents. Renvoie -1, 0 ou 1. */
export const compareText = (a: string, b: string): number => Math.sign(collator.compare(a, b));

const escapeRe = (s: string): string => s.replace(/[\\^$.*+?()[\]{}|]/g, '\\$&');
// Même pliage que compareText : casse ignorée (drapeau i), accents conservés.
const textRe = (s: string, flags = ''): RegExp => new RegExp(escapeRe(s), `iu${flags}`);
const nfc = (s: string): string => s.normalize('NFC');

type LikeToken = '*' | '?' | '#' | { lit: string } | { ranges: [number, number][]; negate: boolean };

function tokenMatch(t: Exclude<LikeToken, '*'>, c: string): boolean {
  if (t === '?') return true;
  if (t === '#') return c >= '0' && c <= '9';
  if ('lit' in t) return t.lit === c || t.lit.toLowerCase() === c.toLowerCase();
  const hit = [c, c.toLowerCase(), c.toUpperCase()].some((x) => {
    const cp = x.codePointAt(0)!;
    return x.length === String.fromCodePoint(cp).length && t.ranges.some(([lo, hi]) => cp >= lo && cp <= hi);
  });
  return hit !== t.negate;
}

/** Step budget of one Like (5 million steps, about 50 ms, or 64 per character of the texts if more): a pathological
 *  pattern on a long text is an overflow, not a frozen process. */
const likeSteps = (value: string, pattern: string): number => Math.max(5e6, 64 * (value.length + pattern.length));

/** Like d'Access sur la chaîne entière : * ? # [liste] [!liste] [a-z] ; [*] [?] [#] [[] sont littéraux.
 *  Casse ignorée, accents conservés (comme compareText), textes normalisés en NFC. */
export function likeMatch(value: string, pattern: string): boolean {
  const p = [...pattern.normalize('NFC')];
  const toks: LikeToken[] = [];
  for (let i = 0; i < p.length; i++) {
    const c = p[i];
    if (c === '*' || c === '?' || c === '#') toks.push(c);
    else if (c !== '[') toks.push({ lit: c });
    else {
      const close = p.indexOf(']', i + 1);
      if (close < 0) fail('badArgument');
      let body = p.slice(i + 1, close);
      i = close;
      const negate = body[0] === '!' && body.length > 1;
      if (negate) body = body.slice(1);
      if (!body.length) continue; // [] : chaîne vide, comme Access
      const ranges: [number, number][] = [];
      for (let k = 0; k < body.length; k++) {
        const lo = body[k].codePointAt(0)!;
        if (body[k + 1] === '-' && k + 2 < body.length) {
          const hi = body[k + 2].codePointAt(0)!;
          if (hi < lo) fail('badArgument'); // intervalle inversé [z-a]
          ranges.push([lo, hi]);
          k += 2;
        } else ranges.push([lo, lo]);
      }
      toks.push({ ranges, negate });
    }
  }
  // Glob classique : chaque jeton consomme un caractère ; seule la dernière étoile sert de point de reprise -> O(n·m) au pire.
  const v = [...value.normalize('NFC')];
  let ti = 0, vi = 0, star = -1, mark = 0, steps = 0;
  const budget = likeSteps(value, pattern);
  while (vi < v.length) {
    if (++steps > budget) fail('overflow');
    const t = toks[ti];
    if (t === '*') { star = ti++; mark = vi; }
    else if (t !== undefined && tokenMatch(t, v[vi])) { ti++; vi++; }
    else if (star >= 0) { ti = star + 1; vi = ++mark; }
    else return false;
  }
  while (toks[ti] === '*') ti++;
  return ti === toks.length;
}

// ---- Dates : numéro de série (jours depuis 1899-12-30, fraction = heure) ----

const DAY_MS = 86400000;
const EPOCH = Date.UTC(1899, 11, 30);
const ISO = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})$/;
const pad = (n: number, w = 2): string => String(n).padStart(w, '0');

/** Instant UTC, sans la conversion des années 0 à 99 de Date.UTC ; les valeurs hors limites débordent (mois 13…). */
function utc(y: number, mo: number, d: number, h = 0, mi = 0, s = 0): number {
  const t = new Date(0);
  t.setUTCFullYear(y, mo - 1, d);
  t.setUTCHours(h, mi, s, 0);
  return t.getTime();
}

function isoOf(ms: number): string {
  const t = new Date(ms);
  const y = t.getUTCFullYear();
  if (!(y >= 100 && y <= 9999)) fail('overflow');
  return `${pad(y, 4)}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())} ${pad(t.getUTCHours())}:${pad(t.getUTCMinutes())}:${pad(t.getUTCSeconds())}`;
}

/** 'YYYY-MM-DD HH:MM:SS' -> numéro de série. Avant 1899-12-30, la partie entière est le jour et la fraction l'heure (-1,25 = 29/12/1899 06:00). */
export function toSerial(stored: string): number {
  const m = ISO.exec(stored) ?? fail('badArgument');
  const [y, mo, d, h, mi, s] = m.slice(1).map(Number);
  const day = (utc(y, mo, d) - EPOCH) / DAY_MS;
  const time = (h * 3600 + mi * 60 + s) / 86400;
  return day < 0 ? day - time : day + time;
}

/** Jour chronologique et seconde du jour, arrondie à la seconde la plus proche. */
function split(serial: number): { day: number; sec: number } {
  if (!Number.isFinite(serial)) fail('overflow');
  let day = Math.trunc(serial) + 0;
  let sec = Math.round(Math.abs(serial - day) * 86400);
  if (sec >= 86400) { day += 1; sec -= 86400; }
  return { day, sec };
}
const msOf = (serial: number): number => { const { day, sec } = split(serial); return EPOCH + day * DAY_MS + sec * 1000; };

/** Numéro de série -> 'YYYY-MM-DD HH:MM:SS', exact à la seconde. */
export const fromSerial = (n: number): string => isoOf(msOf(n));

function parts(serial: number) {
  const { day, sec } = split(serial);
  const date = new Date(msOf(serial));
  isoOf(date.getTime()); // contrôle des limites
  return {
    date, day, sec, abs: day * 86400 + sec, dow: date.getUTCDay() /* 0 = dimanche */,
    y: date.getUTCFullYear(), mo: date.getUTCMonth() + 1, d: date.getUTCDate(),
    h: date.getUTCHours(), mi: date.getUTCMinutes(), s: date.getUTCSeconds(),
  };
}

const serialFrom = (y: number, mo: number, d: number, h = 0, mi = 0, s = 0): number => toSerial(isoOf(utc(y, mo, d, h, mi, s)));
const daysIn = (y: number, mo: number): number => new Date(utc(y, mo + 1, 0)).getUTCDate();
const dayOfYear = (p: ReturnType<typeof parts>): number => (utc(p.y, p.mo, p.d) - utc(p.y, 1, 1)) / DAY_MS + 1;
const quarter = (mo: number): number => Math.ceil(mo / 3);

const INTERVALS = ['yyyy', 'q', 'm', 'y', 'd', 'w', 'ww', 'h', 'n', 's'] as const;
type Interval = (typeof INTERVALS)[number];
function interval(v: V, info: LocaleInfo): Interval {
  const s = toText(v, info).toLowerCase() as Interval;
  return INTERVALS.includes(s) ? s : fail('badArgument');
}

/** Jour de la semaine, 1 = premier jour (`first` : 1 = dimanche … 7 = samedi). */
function weekday(dow: number, first: number): number {
  if (first === 0) first = 1; // ponytail: vbUseSystem traité comme dimanche, lire la région si besoin
  if (first < 1 || first > 7) fail('badArgument');
  return ((dow + 1 - first + 7) % 7) + 1;
}

function dateAdd(iv: Interval, k: number, serial: number): number {
  const p = parts(serial);
  if (iv === 'yyyy' || iv === 'q' || iv === 'm') {
    const months = p.y * 12 + p.mo - 1 + k * (iv === 'yyyy' ? 12 : iv === 'q' ? 3 : 1);
    const y = Math.floor(months / 12), mo = months - y * 12 + 1;
    if (y < 100 || y > 9999) fail('overflow');
    return serialFrom(y, mo, Math.min(p.d, daysIn(y, mo)), p.h, p.mi, p.s);
  }
  const add = { y: [k, 0], d: [k, 0], w: [k, 0], ww: [7 * k, 0], h: [0, 3600 * k], n: [0, 60 * k], s: [0, k] }[iv];
  return serialFrom(p.y, p.mo, p.d + add[0], p.h, p.mi, p.s + add[1]);
}

/** DateDiff compte les limites franchies, comme Access ("m" du 31/01 au 01/02 = 1). */
function dateDiff(iv: Interval, a: number, b: number): number {
  const p = parts(a), q = parts(b);
  switch (iv) {
    case 'yyyy': return q.y - p.y;
    case 'q': return q.y * 4 + quarter(q.mo) - (p.y * 4 + quarter(p.mo));
    case 'm': return q.y * 12 + q.mo - (p.y * 12 + p.mo);
    case 'y': case 'd': return q.day - p.day;
    case 'w': return Math.trunc((q.day - p.day) / 7);
    case 'ww': return Math.floor((q.day - 1) / 7) - Math.floor((p.day - 1) / 7); // le jour 1 (31/12/1899) est un dimanche
    case 'h': return Math.floor(q.abs / 3600) - Math.floor(p.abs / 3600);
    case 'n': return Math.floor(q.abs / 60) - Math.floor(p.abs / 60);
    case 's': return q.abs - p.abs;
  }
}

function datePart(iv: Interval, serial: number): number {
  const p = parts(serial);
  switch (iv) {
    case 'yyyy': return p.y;
    case 'q': return quarter(p.mo);
    case 'm': return p.mo;
    case 'y': return dayOfYear(p);
    case 'd': return p.d;
    case 'w': return weekday(p.dow, 1);
    case 'ww': return Math.floor((dayOfYear(p) - 1 + new Date(utc(p.y, 1, 1)).getUTCDay()) / 7) + 1;
    case 'h': return p.h;
    case 'n': return p.mi;
    case 's': return p.s;
  }
}

// ---- Bibliothèque ----

/** Un argument Null donne Null (cas général des fonctions d'Access). */
const strict = (fn: (a: V[], info: LocaleInfo, env: EvalEnv) => Value): LibFn =>
  (args, env) => (args.includes(null) ? null : fn(args as V[], infoOf(env.locale), env));
const text = (fn: (s: string) => string): LibFn => strict(([a], i) => str(fn(toText(a, i))));
const part = (key: 'y' | 'mo' | 'd' | 'h' | 'mi' | 's'): LibFn => strict(([a], i) => num(parts(toDate(a, i))[key]));

export const LIBRARY: Record<string, LibFn> = {
  // Logique : Null n'est pas propagé.
  IIf: ([c, a, b], env) => (truthy(c, infoOf(env.locale)) === true ? a : b),
  Nz: (args) => (args[0] !== null ? args[0] : args.length > 1 ? args[1] : EMPTY), // Empty de VBA (A2-R7)
  IsNull: ([a]) => bool(a === null),
  IsNumeric: ([a], env) => bool(a !== null && a.t !== 'date' && (a.t !== 'str' || textToNumber(a.v, infoOf(env.locale)) !== null)),
  IsDate: ([a], env) => bool(a !== null && (a.t === 'date' || (a.t === 'str' && parseDateTime(a.v, infoOf(env.locale)) !== null))),

  // Texte (positions en unités UTF-16, comme VBA).
  Len: strict(([a], i) => num(toText(a, i).length)),
  Left: strict(([a, n], i) => str(toText(a, i).slice(0, nonNeg(long(n, i))))),
  Right: strict(([a, n], i) => { const s = toText(a, i); return str(s.slice(Math.max(0, s.length - nonNeg(long(n, i))))); }),
  Mid: strict(([a, b, c], i) => {
    const start = long(b, i);
    if (start < 1) fail('badArgument');
    const len = c === undefined ? Infinity : nonNeg(long(c, i));
    return str(toText(a, i).slice(start - 1, start - 1 + len));
  }),
  Trim: text((s) => s.replace(/^ +| +$/g, '')),
  LTrim: text((s) => s.replace(/^ +/, '')),
  RTrim: text((s) => s.replace(/ +$/, '')),
  UCase: text((s) => s.toUpperCase()),
  LCase: text((s) => s.toLowerCase()),
  InStr: strict((args, i) => {
    const [start, a, b] = args.length === 3 ? [long(args[0], i), args[1], args[2]] : [1, args[0], args[1]];
    const [s1, s2] = [nfc(toText(a, i)), nfc(toText(b, i))];
    if (start < 1) fail('badArgument');
    if (s2 === '') return num(start <= s1.length ? start : 0);
    const at = s1.slice(start - 1).search(textRe(s2));
    return num(at < 0 ? 0 : at + start);
  }),
  Replace: strict(([a, b, c], i) => {
    const [s, find, by] = [nfc(toText(a, i)), nfc(toText(b, i)), toText(c, i)];
    let len = s.length; // checked as it grows: the whole result may not fit in memory
    return built(find === '' ? s : s.replace(textRe(find, 'g'), (m) => ((len += by.length - m.length) > MAX_BUILT_TEXT ? fail('overflow') : by)));
  }),
  Space: strict(([n], i) => str(' '.repeat(count(long(n, i))))),
  String: strict(([n, c], i) => {
    const ch = c.t === 'str' ? (c.v[0] ?? fail('badArgument')) : String.fromCharCode(long(c, i));
    return str(ch.repeat(count(long(n, i))));
  }),
  StrComp: strict(([a, b, mode], i) => {
    const [x, y] = [toText(a, i), toText(b, i)];
    return num(mode !== undefined && long(mode, i) === 0 ? (x < y ? -1 : x > y ? 1 : 0) : compareText(x, y));
  }),
  // Format(v) : CStr(v). Format(v, f) : formats nommés (id canonique) ou personnalisés ; langue des libellés déduite de la région.
  Format: strict(([a, f], i, env) => f === undefined ? str(toText(a, i))
    : str(formatValue(a, toText(f, i), { locale: env.locale, lang: env.lang ?? (env.locale.toLowerCase().startsWith('fr') ? 'fr' : 'en') }))),

  // Nombres
  Round: strict(([x, n], i) => {
    const digits = n === undefined ? 0 : long(n, i);
    if (digits < 0 || digits > 22) fail('badArgument');
    return num(Number(roundDecimalString(dec(toNum(x, i)), digits)));
  }),
  Int: strict(([x], i) => (x.t === 'date' ? date : num)(Math.floor(toNum(x, i)))),
  Fix: strict(([x], i) => (x.t === 'date' ? date : num)(Math.trunc(toNum(x, i)))),
  Abs: strict(([x], i) => num(Math.abs(toNum(x, i)))),
  Sgn: strict(([x], i) => num(Math.sign(toNum(x, i)))),
  Sqr: strict(([x], i) => num(Math.sqrt(nonNeg(toNum(x, i))))),

  // Conversions
  Val: strict(([a], i) => {
    if (a.t !== 'str') return num(toNum(a, i));
    const m = /^[+-]?\d*\.?\d*(?:e[+-]?\d+)?/i.exec(a.v.replace(/[ \t\r\n]/g, ''))!;
    const n = Number(m[0]);
    return Number.isNaN(n) ? num(0) : Number.isFinite(n) ? num(n) : fail('overflow');
  }),
  CStr: strict(([a], i) => str(toText(a, i))),
  CInt: strict(([a], i) => { const n = long(a, i); return n < -32768 || n > 32767 ? fail('overflow') : num(n); }),
  CLng: strict(([a], i) => num(long(a, i))),
  CDbl: strict(([a], i) => num(toNum(a, i))),
  CCur: strict(([a], i) => num(Number(roundDecimalString(dec(toNum(a, i)), 4)))),
  CDate: strict(([a], i) => date(toDate(a, i))),
  CBool: strict(([a], i) => bool(truthy(a, i)!)),

  // Dates
  Date: (_, env) => { const n = env.now(); return date(serialFrom(n.getFullYear(), n.getMonth() + 1, n.getDate())); },
  Time: (_, env) => { const n = env.now(); return date(serialFrom(1899, 12, 30, n.getHours(), n.getMinutes(), n.getSeconds())); },
  Now: (_, env) => {
    const n = env.now();
    return date(serialFrom(n.getFullYear(), n.getMonth() + 1, n.getDate(), n.getHours(), n.getMinutes(), n.getSeconds()));
  },
  Year: part('y'), Month: part('mo'), Day: part('d'), Hour: part('h'), Minute: part('mi'), Second: part('s'),
  Weekday: strict(([a, first], i) => num(weekday(parts(toDate(a, i)).dow, first === undefined ? 1 : long(first, i)))),
  DateAdd: strict(([iv, k, d], i) => date(dateAdd(interval(iv, i), long(k, i), toDate(d, i)))),
  DateDiff: strict(([iv, a, b], i) => num(dateDiff(interval(iv, i), toDate(a, i), toDate(b, i)))),
  DatePart: strict(([iv, d], i) => num(datePart(interval(iv, i), toDate(d, i)))),
  DateSerial: strict(([y, m, d], i) => {
    let year = long(y, i);
    if (year >= 0 && year <= 99) year += year <= 29 ? 2000 : 1900; // années sur deux chiffres, comme VBA
    return date(serialFrom(year, long(m, i), long(d, i)));
  }),
  TimeSerial: strict(([h, m, s], i) => date(serialFrom(1899, 12, 30, long(h, i), long(m, i), long(s, i)))),
};
