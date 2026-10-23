// Format : formats nommés et personnalisés (sous-ensemble d'Access). Module pur, sans exception : un format inconnu ou
// inutilisable donne l'affichage non formaté. Les caractères d'un format personnalisé ont un sens fixe, quelle que soit la langue.
import type { Value } from './ast';
// library.ts importe aussi ce module : ces imports ne servent qu'à l'appel (jamais au chargement), le cycle est sans effet.
import { fromSerial, infoOf } from './library';
import type { FieldType } from '../field-types';
import { numberToText } from '../coerce';
import { dateTimeFormat, formatCurrency, formatDateTime, numberFormat } from '../locale-format';

export type NamedFormat = 'generalNumber' | 'currency' | 'euro' | 'fixed' | 'standard' | 'percent' | 'scientific'
  | 'generalDate' | 'longDate' | 'mediumDate' | 'shortDate' | 'longTime' | 'mediumTime' | 'shortTime' | 'yesNo' | 'trueFalse' | 'onOff';

const NUMBERS: NamedFormat[] = ['generalNumber', 'currency', 'euro', 'fixed', 'standard', 'percent', 'scientific'];
const DATES: NamedFormat[] = ['generalDate', 'longDate', 'mediumDate', 'shortDate', 'longTime', 'mediumTime', 'shortTime'];
const BOOLS: NamedFormat[] = ['yesNo', 'trueFalse', 'onOff'];
export const FORMATS_BY_TYPE: Record<FieldType, NamedFormat[]> = {
  autoNumber: NUMBERS, number: NUMBERS, currency: NUMBERS, dateTime: DATES, yesNo: BOOLS, shortText: [], longText: [], hyperlink: [],
};

// Valeurs affichées (comme les mots-clés du catalogue), pas des libellés d'interface.
const LABELS: Record<string, Record<'fr' | 'en', [string, string]>> = {
  yesNo: { fr: ['Oui', 'Non'], en: ['Yes', 'No'] },
  trueFalse: { fr: ['Vrai', 'Faux'], en: ['True', 'False'] },
  onOff: { fr: ['Actif', 'Inactif'], en: ['On', 'Off'] },
};

/** Id canonique d'un nom de format nommé, saisi tel quel ou à l'anglaise d'Access (« Short Date », « Yes/No »), casse et espaces ignorés. */
export function namedFormatId(f: string): NamedFormat | undefined {
  const key = f.toLowerCase().replace(/[\s/]/g, '');
  return [...NUMBERS, ...DATES, ...BOOLS].find((n) => n.toLowerCase() === key);
}

export interface FormatCtx { locale: string; lang: 'fr' | 'en'; decimalPlaces?: 'auto' | number }

// ---- Analyse d'un format personnalisé : sections séparées par ';', littéraux "…" et \x ----

type Tok = { lit: string } | { ch: string };
function sections(format: string): Tok[][] {
  const out: Tok[][] = [[]];
  for (let i = 0; i < format.length; i++) {
    const c = format[i];
    const cur = out[out.length - 1];
    if (c === '"') {
      const end = format.indexOf('"', i + 1);
      if (end < 0) throw new Error('unterminated');
      cur.push({ lit: format.slice(i + 1, end) });
      i = end;
    } else if (c === '\\') cur.push({ lit: format[++i] ?? '' });
    else if (c === ';') out.push([]);
    else cur.push({ ch: c });
  }
  return out;
}
const isCh = (t: Tok, re: RegExp): t is { ch: string } => 'ch' in t && re.test(t.ch);
const hasDigits = (s: Tok[]): boolean => s.some((t) => isCh(t, /[0#]/));
const hasDateTokens = (s: Tok[]): boolean => s.some((t) => isCh(t, /[dmyhns]/i));
const hasTextTokens = (s: Tok[]): boolean => s.some((t) => isCh(t, /[@<>]/));
const lit = (t: Tok): string => ('lit' in t ? t.lit : t.ch);
const literals = (s: Tok[]): string => s.map(lit).join('');

// ---- Nombres ----

function customNumber(n: number, sec: Tok[], locale: string, minus: boolean): string {
  // Le motif commence au premier 0 ou # (ou à un point suivi de 0/#, « .00 ») et s'étend sur 0 # . , contigus.
  const start = sec.findIndex((t, i) => isCh(t, /[0#]/) || (isCh(t, /\./) && isCh(sec[i + 1] ?? { lit: '' }, /[0#]/)));
  let end = start;
  while (end < sec.length && isCh(sec[end], /[0#.,]/)) end++;
  const run = literals(sec.slice(start, end));
  // Motif qu'on ne sait pas rendre fidèlement (000-0000, 0.0.0, #,##0, mise à l'échelle, « 0. ») : repli sur l'affichage brut.
  if (sec.slice(end).some((t) => isCh(t, /[0#]/)) || run.split('.').length > 2 || /[.,]$/.test(run)) throw new Error('unsupported pattern');
  const [intPart, decPart = ''] = run.split('.');
  const minInt = (intPart.match(/0/g) ?? []).length;
  const pct = sec.some((t) => isCh(t, /%/));
  const parts = numberFormat(locale, {
    useGrouping: /[0#],[0#]/.test(intPart), minimumIntegerDigits: Math.max(1, minInt),
    minimumFractionDigits: (decPart.match(/0/g) ?? []).length, maximumFractionDigits: decPart.replace(/[^0#]/g, '').length,
  }).formatToParts(Math.abs(pct ? n * 100 : n));
  // « # » seul : pas de zéro devant la virgule (.5), ni pour la valeur zéro.
  const bare = minInt === 0 && !parts.some((p) => p.type === 'group') && parts.find((p) => p.type === 'integer')?.value === '0';
  const digits = parts.filter((p) => !(bare && p.type === 'integer')).map((p) => p.value).join('');
  return (minus ? '-' : '') + literals(sec.slice(0, start)) + digits + literals(sec.slice(end));
}

function namedNumber(n: number, f: NamedFormat, ctx: FormatCtx): string {
  const dp = typeof ctx.decimalPlaces === 'number' ? ctx.decimalPlaces : 2;
  const nf = (o: Intl.NumberFormatOptions): string =>
    numberFormat(ctx.locale, { minimumFractionDigits: dp, maximumFractionDigits: dp, ...o }).format(n);
  switch (f) {
    case 'generalNumber': return numberToText(n, infoOf(ctx.locale));
    case 'fixed': return nf({ useGrouping: false });
    case 'standard': return nf({ useGrouping: true });
    case 'percent': return nf({ style: 'percent' });
    case 'currency': return formatCurrency(n, ctx.locale, dp);
    case 'euro': return nf({ style: 'currency', currency: 'EUR' });
    default: { // scientific : 1,23E+03
      const [m, e] = n.toExponential(dp).split('e');
      return `${m.replace('.', infoOf(ctx.locale).decimalSep)}E${e.startsWith('-') ? '-' : '+'}${e.replace(/^[+-]/, '').padStart(2, '0')}`;
    }
  }
}

// ---- Dates ----

const RUN_LENGTHS: Record<string, number[]> = { d: [1, 2, 3, 4], m: [1, 2, 3, 4], y: [2, 4], h: [1, 2], n: [1, 2], s: [1, 2] };
function dateParts(serial: number) {
  const [y, mo, d, h, mi, s] = fromSerial(serial).split(/[- :]/).map(Number);
  const at = new Date(Date.UTC(y, mo - 1, d, h, mi, s));
  at.setUTCFullYear(y);
  return { y, mo, d, h, mi, s, intl: (locale: string, o: Intl.DateTimeFormatOptions): string => dateTimeFormat(locale, { ...o, timeZone: 'UTC' }).format(at) };
}
const two = (n: number): string => String(n).padStart(2, '0');

function customDate(serial: number, sec: Tok[], locale: string): string {
  const p = dateParts(serial);
  // Jetons (lettres identiques consécutives) et littéraux ; une longueur inconnue (y, yyy, ddddd) est refusée.
  const items: ({ tok: string } | { lit: string })[] = [];
  for (let i = 0; i < sec.length;) {
    const t = sec[i];
    if (!('ch' in t) || !/[dmyhns]/i.test(t.ch)) { items.push({ lit: lit(t) }); i++; continue; }
    const c = t.ch.toLowerCase();
    let len = 0;
    while (i + len < sec.length && isCh(sec[i + len], /./) && (sec[i + len] as { ch: string }).ch.toLowerCase() === c) len++;
    if (!RUN_LENGTHS[c].includes(len)) throw new Error('unsupported date token');
    items.push({ tok: c.repeat(len) });
    i += len;
  }
  const toks = items.map((x) => ('tok' in x ? x.tok : null));
  return items.map((x, i) => {
    if (!('tok' in x)) return x.lit;
    let tok = x.tok;
    if (tok === 'm' || tok === 'mm') { // minutes (comme Access) juste après h/hh ou juste avant s/ss
      const prev = toks.slice(0, i).reverse().find((k) => k !== null);
      const next = toks.slice(i + 1).find((k) => k !== null);
      if (prev?.[0] === 'h' || next?.[0] === 's') tok = tok.replace(/m/g, 'n');
    }
    return ({
      d: String(p.d), dd: two(p.d), ddd: p.intl(locale, { weekday: 'short' }), dddd: p.intl(locale, { weekday: 'long' }),
      m: String(p.mo), mm: two(p.mo), mmm: p.intl(locale, { month: 'short' }), mmmm: p.intl(locale, { month: 'long' }),
      yy: two(p.y % 100), yyyy: String(p.y).padStart(4, '0'),
      h: String(p.h), hh: two(p.h), n: String(p.mi), nn: two(p.mi), s: String(p.s), ss: two(p.s),
    } as Record<string, string>)[tok];
  }).join('');
}

function namedDate(serial: number, f: NamedFormat, ctx: FormatCtx): string {
  const intl = (o: Intl.DateTimeFormatOptions): string => dateParts(serial).intl(ctx.locale, o);
  switch (f) {
    case 'longDate': return intl({ dateStyle: 'full' });
    case 'mediumDate': return intl({ dateStyle: 'medium' });
    case 'shortDate': return intl({ day: '2-digit', month: '2-digit', year: 'numeric' });
    case 'longTime': return intl({ timeStyle: 'medium' });
    case 'mediumTime': return intl({ hour: '2-digit', minute: '2-digit', hour12: true });
    case 'shortTime': return intl({ timeStyle: 'short' });
    default: return formatDateTime(fromSerial(serial), ctx.locale);
  }
}

// ---- Texte et affichage non formaté ----

function customText(s: string, sec: Tok[]): string {
  const v = sec.some((t) => isCh(t, />/)) ? s.toUpperCase() : sec.some((t) => isCh(t, /</)) ? s.toLowerCase() : s;
  const at = sec.findIndex((t) => isCh(t, /@/));
  const text = (ts: Tok[]): string => literals(ts.filter((t) => !isCh(t, /[<>@]/)));
  return at < 0 ? text(sec) + v : text(sec.slice(0, at)) + v + text(sec.slice(at + 1));
}

function plain(v: Value, ctx: FormatCtx): string {
  if (v === null || v.t === 'empty') return '';
  switch (v.t) {
    case 'str': return v.v;
    case 'num': return numberToText(v.v, infoOf(ctx.locale));
    case 'bool': return LABELS.trueFalse.en[v.v ? 0 : 1];
    case 'date': return formatDateTime(fromSerial(v.v), ctx.locale);
  }
}

const asNumber = (v: Value): number | null =>
  v === null || v.t === 'str' ? null : v.t === 'empty' ? 0 : v.t === 'bool' ? (v.v ? -1 : 0) : v.v;

/** Lettres non protégées (hors jetons admis) : le format n'est pas compris, on ne devine pas (AM/PM, E+, « kg »…). */
function checkLetters(secs: Tok[][], ok: RegExp): void {
  if (secs.some((sec) => sec.some((t) => isCh(t, /[a-z]/i) && !ok.test(t.ch)))) throw new Error('unknown letters');
}
const NO_LETTER = /^$/;

function format(v: Value, f: string | undefined, ctx: FormatCtx): string {
  if (f === undefined || f === '') return plain(v, ctx);
  const named = namedFormatId(f);
  if (named) {
    const n = asNumber(v);
    if (n === null || !Number.isFinite(n)) return v === null ? '' : plain(v, ctx);
    if (BOOLS.includes(named)) return LABELS[named][ctx.lang][n !== 0 ? 0 : 1];
    return NUMBERS.includes(named) ? namedNumber(n, named, ctx) : v!.t === 'empty' ? '' : namedDate(n, named, ctx);
  }
  const secs = sections(f);
  const textual = hasTextTokens(secs[0]) && !hasDigits(secs[0]);
  if (v === null || (v.t === 'str' && v.v === '' && textual)) return literals((textual ? secs[1] : secs[3]) ?? []);
  if (v.t === 'str') {
    if (!hasTextTokens(secs[0])) return v.v;
    checkLetters(secs.slice(0, 1), NO_LETTER);
    return customText(v.v, secs[0]);
  }
  const n = asNumber(v)!;
  if (!Number.isFinite(n)) return plain(v, ctx);
  const digits = secs.some(hasDigits);
  if (v.t === 'empty' && !digits) return '';
  if (v.t === 'date' ? hasDateTokens(secs[0]) && !hasDigits(secs[0]) : !digits && hasDateTokens(secs[0])) {
    checkLetters(secs.slice(0, 1), /[dmyhns]/i);
    return customDate(n, secs[0], ctx.locale);
  }
  if (!digits) return plain(v, ctx);
  checkLetters(secs, NO_LETTER);
  const sec = n > 0 ? secs[0] : n < 0 ? secs[1] ?? secs[0] : secs[2] ?? secs[0];
  return hasDigits(sec) ? customNumber(n, sec, ctx.locale, n < 0 && sec === secs[0]) : literals(sec);
}

export function formatValue(v: Value, f: string | undefined, ctx: FormatCtx): string {
  try {
    return format(v, f, ctx);
  } catch {
    try { return plain(v, ctx); } catch { return ''; }
  }
}
