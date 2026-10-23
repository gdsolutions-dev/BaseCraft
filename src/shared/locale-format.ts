// Lecture et affichage des nombres et dates selon les paramètres régionaux.
// Module pur (Intl standard uniquement) : utilisable dans le processus principal et le rendu.

export interface LocaleInfo {
  locale: string;
  decimalSep: string;
  groupSep: string;
  dateOrder: 'DMY' | 'MDY' | 'YMD';
  dateSep: string;
}

/** The system locale as a tag Intl accepts: Linux gives POSIX forms (`en-US@posix` under LANG=C, `de-DE@euro`) that it rejects. */
export function regionTag(tag: string): string {
  try {
    return Intl.getCanonicalLocales(tag.split('@')[0])[0] ?? 'en-US';
  } catch {
    return 'en-US';
  }
}

export function localeInfo(locale: string): LocaleInfo {
  const num = new Intl.NumberFormat(locale).formatToParts(123456.7);
  const decimalSep = num.find((p) => p.type === 'decimal')?.value ?? '.';
  const groupSep = num.find((p) => p.type === 'group')?.value ?? '';
  const date = new Intl.DateTimeFormat(locale, { year: 'numeric', month: '2-digit', day: '2-digit', timeZone: 'UTC' })
    .formatToParts(new Date(Date.UTC(2026, 9, 21)));
  const letters = { day: 'D', month: 'M', year: 'Y' } as Record<string, string>;
  const order = date.map((p) => letters[p.type] ?? '').join('');
  const dateOrder = order === 'MDY' || order === 'YMD' ? order : 'DMY';
  const dateSep = date.find((p) => p.type === 'literal')?.value.trim() || '/';
  return { locale, decimalSep, groupSep, dateOrder, dateSep };
}

const GROUP_SPACES = /[   ]/g;

/** Forme canonique : '-' facultatif, chiffres, '.' facultatif ; sans zéro superflu. */
export function parseDecimal(text: string, info: LocaleInfo): string | null {
  let s = text.trim().replace(GROUP_SPACES, '');
  if (info.groupSep) s = s.split(info.groupSep).join('');
  s = s.split(info.decimalSep).join('.');
  const m = /^([+-]?)(\d*)(?:\.(\d*))?$/.exec(s);
  if (!m || !(m[2] || m[3])) return null;
  const int = m[2].replace(/^0+/, '') || '0';
  const frac = (m[3] ?? '').replace(/0+$/, '');
  const body = frac ? `${int}.${frac}` : int;
  return m[1] === '-' && body !== '0' ? `-${body}` : body;
}

export function parseNumber(text: string, info: LocaleInfo): number | null {
  const d = parseDecimal(text, info);
  return d === null ? null : Number(d);
}

/** Arrondi bancaire sur la chaîne décimale ; le résultat a exactement `digits` décimales. */
export function roundDecimalString(s: string, digits: number): string {
  const m = /^(-?)(\d+)(?:\.(\d*))?$/.exec(s.trim());
  if (!m) return s;
  const frac = m[3] ?? '';
  let kept = BigInt(m[2] + frac.slice(0, digits).padEnd(digits, '0'));
  const rest = frac.slice(digits);
  if (rest) {
    const first = rest.charCodeAt(0) - 48;
    const tail = /[1-9]/.test(rest.slice(1));
    if (first > 5 || (first === 5 && (tail || kept % 2n === 1n))) kept += 1n;
  }
  const str = kept.toString().padStart(digits + 1, '0');
  const body = digits ? `${str.slice(0, -digits)}.${str.slice(-digits)}` : str;
  return m[1] && kept !== 0n ? `-${body}` : body;
}

const pad = (n: number, w = 2): string => String(n).padStart(w, '0');

function validDate(y: number, mo: number, d: number): boolean {
  if (y < 1 || mo < 1 || mo > 12 || d < 1) return false;
  const leap = (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][mo - 1];
  return d <= days;
}

function parseTime(text: string): [number, number, number] | null {
  const m = /^(\d{1,2}):(\d{2})(?::(\d{2}))?\s*([AaPp][Mm])?$/.exec(text);
  if (!m) return null;
  let h = Number(m[1]);
  const mi = Number(m[2]), se = Number(m[3] ?? 0);
  if (m[4]) {
    if (h < 1 || h > 12) return null;
    h = (h % 12) + (m[4].toLowerCase() === 'pm' ? 12 : 0);
  }
  return h > 23 || mi > 59 || se > 59 ? null : [h, mi, se];
}

/** Renvoie 'YYYY-MM-DD HH:MM:SS' ou null. */
export function parseDateTime(text: string, info: LocaleInfo): string | null {
  const s = text.trim();
  // Years 100 to 9999, as in Access (0050 would be shown as 50 and read back as 1950).
  const out = (y: number, mo: number, d: number, t: [number, number, number]): string | null =>
    y >= 100 && y <= 9999 && validDate(y, mo, d) ? `${pad(y, 4)}-${pad(mo)}-${pad(d)} ${pad(t[0])}:${pad(t[1])}:${pad(t[2])}` : null;

  const timeOnly = parseTime(s);
  if (timeOnly) return out(1899, 12, 30, timeOnly);

  const iso = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](.+))?$/.exec(s);
  let y: number, mo: number, d: number, timeText: string | undefined;
  if (iso) {
    [y, mo, d, timeText] = [Number(iso[1]), Number(iso[2]), Number(iso[3]), iso[4]];
  } else {
    const m = /^(\d{1,4})[./-](\d{1,4})[./-](\d{1,4})(?:\s+(.+))?$/.exec(s)
      ?? (info.dateSep.length === 1 && !/[\d\s]/.test(info.dateSep)
        ? new RegExp(`^(\\d{1,4})\\${info.dateSep}(\\d{1,4})\\${info.dateSep}(\\d{1,4})(?:\\s+(.+))?$`).exec(s)
        : null);
    if (!m) return null;
    const part = { D: m[1], M: m[2], Y: m[3] } as Record<string, string>;
    const o = info.dateOrder;
    const raw = [m[1], m[2], m[3]];
    [part.D, part.M, part.Y] = [raw[o.indexOf('D')], raw[o.indexOf('M')], raw[o.indexOf('Y')]];
    if (part.Y.length === 3) return null;
    d = Number(part.D); mo = Number(part.M); y = Number(part.Y);
    if (part.Y.length <= 2) y += y <= 29 ? 2000 : 1900;
    timeText = m[4];
  }
  const t = timeText === undefined ? ([0, 0, 0] as [number, number, number]) : parseTime(timeText.trim());
  return t ? out(y, mo, d, t) : null;
}

// Intl formatters cost ~70 µs to build and are pure: one per locale and options (a few dozen at most in practice).
const formatters = new Map<string, Intl.NumberFormat | Intl.DateTimeFormat>();
function cached<F extends Intl.NumberFormat | Intl.DateTimeFormat>(kind: string, locale: string, o: object, make: () => F): F {
  const key = `${kind}|${locale}|${JSON.stringify(o)}`;
  let f = formatters.get(key) as F | undefined;
  if (!f) formatters.set(key, (f = make()));
  return f;
}
export const numberFormat = (locale: string, o: Intl.NumberFormatOptions = {}): Intl.NumberFormat =>
  cached('n', locale, o, () => new Intl.NumberFormat(locale, o));
export const dateTimeFormat = (locale: string, o: Intl.DateTimeFormatOptions = {}): Intl.DateTimeFormat =>
  cached('d', locale, o, () => new Intl.DateTimeFormat(locale, o));

/** `n` may be a canonical decimal string (Décimal fields): Intl formats it exactly, without going through a double. */
export function formatNumber(n: number | string, locale: string, decimals?: number): string {
  return numberFormat(locale, decimals === undefined
    ? { maximumFractionDigits: 20 }
    : { minimumFractionDigits: decimals, maximumFractionDigits: decimals }).format(n as Intl.StringNumericLiteral);
}

/** An ISO 8601 instant (bc_objects created / modified) as a stored date-time in local time, for formatDateTime. */
export function isoToStored(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const p = (n: number) => String(n).padStart(2, '0');
  return `${String(d.getFullYear()).padStart(4, '0')}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

export function formatDateTime(stored: string, locale: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})$/.exec(stored);
  if (!m) return stored;
  const [y, mo, d, h, mi, s] = m.slice(1).map(Number);
  const date = new Date(Date.UTC(y, mo - 1, d, h, mi, s));
  date.setUTCFullYear(y);
  const dateOpts: Intl.DateTimeFormatOptions = { year: 'numeric', month: '2-digit', day: '2-digit', timeZone: 'UTC' };
  const dateOnly = h === 0 && mi === 0 && s === 0;
  return dateTimeFormat(locale, dateOnly ? dateOpts
    : { ...dateOpts, hour: 'numeric', minute: '2-digit', second: '2-digit' }).formatToParts(date)
    .map((p) => (p.type === 'year' ? p.value.padStart(4, '0') : p.value)).join(''); // year 150 shown as 0150: read back as is
}

const CURRENCY_BY_REGION: Record<string, string> = {
  FR: 'EUR', BE: 'EUR', LU: 'EUR', DE: 'EUR', AT: 'EUR', ES: 'EUR', IT: 'EUR', NL: 'EUR', PT: 'EUR', IE: 'EUR',
  FI: 'EUR', GR: 'EUR', CH: 'CHF', CA: 'CAD', US: 'USD', GB: 'GBP'
};

/** `decimals` (when given) replaces the two decimals of the currency. */
export function formatCurrency(n: number, locale: string, decimals?: number): string {
  const loc = new Intl.Locale(locale);
  const currency = CURRENCY_BY_REGION[loc.region ?? loc.maximize().region ?? ''];
  const digits = decimals === undefined ? {} : { minimumFractionDigits: decimals, maximumFractionDigits: decimals };
  return currency
    ? numberFormat(locale, { style: 'currency', currency, ...digits }).format(n)
    : formatNumber(n, locale, decimals ?? 2);
}
