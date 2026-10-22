// Forme affichée <-> forme canonique des expressions. Module pur.
// Affichée : noms et mots-clés dans la langue de l'interface ; décimale, séparateur de liste et ordre des dates dans la région.
import { ExprSyntaxError } from './ast';
import type { LocaleInfo } from '../locale-format';
import { parseDateTime } from '../locale-format';
import { FUNCTIONS, KEYWORDS, type KeywordName } from './catalog';
import { tokenize, type LexConfig } from './lexer';
import { parseCanonical, parseTokens, serialize, sameTree, serializeCriteria, serializeWith, type Dialect } from './parser';

export interface DisplayContext { lang: 'fr' | 'en'; region: LocaleInfo }
export interface LocalizeOptions { criteria?: boolean }

export function listSeparator(region: LocaleInfo): ',' | ';' {
  return region.decimalSep === ',' ? ';' : ',';
}

/** Sans casse ni accents. */
const fold = (s: string): string => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
const pad = (n: string | number): string => String(n).padStart(2, '0');

function names(lang: 'fr' | 'en'): { kw: [string, string][]; fn: [string, string][] } {
  const kw = Object.entries(KEYWORDS) as [KeywordName, { fr: string }][];
  return {
    kw: kw.map(([k, v]) => [k, lang === 'fr' ? v.fr : k]),
    fn: FUNCTIONS.map((f) => [f.name, lang === 'fr' ? f.fr : f.name]),
  };
}

function lexConfig(ctx: DisplayContext): LexConfig {
  const n = names(ctx.lang);
  return {
    keywords: new Map(n.kw.map(([canon, shown]) => [fold(shown), canon])),
    functions: new Map(n.fn.map(([canon, shown]) => [fold(shown), canon])),
    fold,
    decimalSep: ctx.region.decimalSep,
    listSep: listSeparator(ctx.region),
    parseDate: (text) => parseDateTime(text, ctx.region),
  };
}

function dialect(ctx: DisplayContext): Dialect {
  const n = names(ctx.lang);
  const kw = new Map(n.kw), fn = new Map(n.fn);
  const { decimalSep, dateOrder, dateSep } = ctx.region;
  return {
    kw: (k) => kw.get(k) ?? k,
    fn: (name) => fn.get(name) ?? name,
    num: (v) => v.replace('.', decimalSep),
    // Format fixe (jj/mm/aaaa, mm/jj/aaaa ou aaaa/mm/jj ; HH:MM:SS), indépendant de la ponctuation que choisit Intl.
    date: (v) => {
      const [y, mo, d, h, mi, s] = v.split(/[- :]/);
      const day = { D: d, M: mo, Y: y };
      const date = [...dateOrder].map((c) => day[c as 'D' | 'M' | 'Y']).join(dateSep);
      return `#${date}${v.endsWith(' 00:00:00') ? '' : ` ${pad(h)}:${pad(mi)}:${pad(s)}`}#`;
    },
    sep: `${listSeparator(ctx.region)} `,
  };
}

/** Texte saisi -> forme canonique stockée (`ExprSyntaxError` dont les positions renvoient au texte saisi). */
export function toCanonical(display: string, ctx: DisplayContext, opts: LocalizeOptions = {}): string {
  const e = parseTokens(tokenize(display, lexConfig(ctx)), opts);
  return opts.criteria ? serializeCriteria(e) : serialize(e);
}

/** Forme canonique stockée -> texte affiché. Un critère s'affiche sans son sujet implicite. */
export function toDisplay(canonical: string, ctx: DisplayContext, opts: LocalizeOptions = {}): string {
  const e = parseCanonical(canonical, opts);
  const out = serializeWith(e, dialect(ctx), opts.criteria);
  // Garde-fou : le texte affiché doit se relire en la même expression.
  if (opts.criteria && !sameTree(parseTokens(tokenize(out, lexConfig(ctx)), opts), e)) throw new ExprSyntaxError('unexpectedToken', { start: 0, end: out.length });
  return out;
}
