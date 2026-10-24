// Lexèmes de la forme canonique et de la forme affichée. Module pur (aucune API Node).
import { localeInfo, parseDateTime } from '../locale-format';
import { ExprSyntaxError } from './ast';

export type TokenType = 'num' | 'str' | 'date' | 'id' | 'kw' | 'op' | 'eof';

export interface Token {
  t: TokenType;
  /** num: texte canonique; str: contenu; date: 'YYYY-MM-DD HH:MM:SS'; id: nom; kw: casse canonique; op: symbole. */
  v: string;
  /** id: écrit sans crochets. */
  bare?: boolean;
  start: number;
  end: number;
}

/** Écriture lue par l'analyseur lexical : la forme canonique, ou la forme affichée (langue + région). */
export interface LexConfig {
  /** Nom écrit (replié par `fold`) -> mot-clé canonique. */
  keywords: Map<string, string>;
  /** Nom écrit (replié) -> fonction canonique ; ne s'applique qu'à un nom suivi de « ( ». */
  functions: Map<string, string>;
  fold: (word: string) => string;
  decimalSep: string;
  /** Séparateur des arguments ; devient l'opérateur « , » canonique. */
  listSep: string;
  /** Contenu d'un littéral `#…#` -> 'YYYY-MM-DD HH:MM:SS', ou null. */
  parseDate: (text: string) => string | null;
}

const WORD = /[\p{L}_][\p{L}\p{M}\p{Nd}_]*/uy;
const OPS = ['<=', '>=', '<>', '<', '>', '=', '+', '-', '*', '/', '\\', '^', '&', '(', ')', '.', ';'];
/** `(word` : `(SELECT` opens a subquery, always written in canonical SQL, even inside a displayed expression. */
const PAREN_WORD = /\(\s*([\p{L}_][\p{L}\p{M}\p{Nd}_]*)/uy;
const ISO_DATE = /^(\d{4}-\d{2}-\d{2})(?: (\d{2}:\d{2}:\d{2}))?$/;
const EN = localeInfo('en-US');
const TIME = String.raw`\d{1,2}:\d{2}(?::\d{2})?(?:\s*[AaPp][Mm])?`;
/** Access SQL's US literals: m/d/yyyy, an optional time (10:30 PM), or a time alone. */
const US_LITERAL = new RegExp(String.raw`^(?:\d{1,2}/\d{1,2}/\d{4}(?: ${TIME})?|${TIME})$`);

export const CANONICAL_LEX: LexConfig = {
  keywords: new Map(
    ['And', 'Or', 'Xor', 'Not', 'Mod', 'Like', 'Between', 'In', 'Is', 'Null', 'True', 'False'].map((k) => [k.toLowerCase(), k]),
  ),
  functions: new Map(),
  fold: (w) => w.toLowerCase(),
  decimalSep: '.',
  listSep: ',',
  parseDate: (text) => {
    const m = ISO_DATE.exec(text);
    // also Access SQL's own literals, US order (#1/5/2026#) or time alone (#10:30#); printed back in ISO
    return m ? parseDateTime(m[1] + (m[2] ? ` ${m[2]}` : ''), EN)
      : US_LITERAL.test(text) ? parseDateTime(text, EN) : null;
  },
};

/** ASCII-only lower case: SQL words (SELECT, FROM, Exists…) compare as SQLite's keywords do, never by Unicode folding
 *  (ſ is not s, K is not k). The lexer, the expression parser and the SQL parser all use it. */
export const asciiLower = (s: string): string => s.replace(/[A-Z]+/g, (m) => m.toLowerCase());

/** A name in brackets, `]` written `]]` (as tokenize reads it back). */
export const bracket = (name: string): string => `[${name.replace(/]/g, ']]')}]`;

/** '007.50' -> '7.5', '0.0' -> '0', '.5' -> '0.5' */
function canonicalNumber(int: string, frac: string): string {
  const i = int.replace(/^0+/, '') || '0';
  const f = frac.replace(/0+$/, '');
  return f ? `${i}.${f}` : i;
}

/** The `(` at `i` opens a subquery: `(SELECT`, not after a function name (a bare name other than Exists). */
function opensSubquery(text: string, i: number, prev: Token | undefined): boolean {
  PAREN_WORD.lastIndex = i;
  const m = PAREN_WORD.exec(text);
  if (!m || asciiLower(m[1]) !== 'select') return false;
  return !(prev?.t === 'id' && prev.bare && asciiLower(prev.v) !== 'exists');
}

/** `display`: the display form's config. A subquery `(SELECT …)` is lexed in canonical form up to its closing parenthesis;
 *  a function call's parenthesis (`Sum(select …`) never opens one, as in the parser (`Exists (SELECT …)` does). */
export function tokenize(text: string, display: LexConfig = CANONICAL_LEX): Token[] {
  const out: Token[] = [];
  const n = text.length;
  let i = 0;
  let cfg = display;
  let sub = 0; // parentheses open inside a subquery
  while (i < n) {
    const c = text[i];
    const start = i;
    if (/\s/.test(c)) { i++; continue; }
    if (c === '(' || c === ')') {
      if (sub > 0 || (c === '(' && opensSubquery(text, i, out[out.length - 1]))) sub += c === '(' ? 1 : -1;
      cfg = sub > 0 ? CANONICAL_LEX : display;
    }
    if (c === '"' || c === "'") { // 'texte' : écriture d'Access acceptée en entrée ; la sortie utilise toujours "…"
      let v = '';
      i++;
      for (;;) {
        if (i >= n) throw new ExprSyntaxError('unclosedString', { start, end: n });
        if (text[i] === c) {
          if (text[i + 1] !== c) break;
          v += c; i += 2;
        } else v += text[i++];
      }
      out.push({ t: 'str', v, start, end: ++i });
    } else if (c === '[') { // `]]` inside the brackets is one `]` of the name (`bracket`)
      let v = '';
      i++;
      for (;;) {
        const close = text.indexOf(']', i);
        if (close < 0) throw new ExprSyntaxError('unclosedBracket', { start, end: n });
        v += text.slice(i, close);
        i = close + 1;
        if (text[i] !== ']') break;
        v += ']';
        i++;
      }
      out.push({ t: 'id', v, start, end: i });
    } else if (c === '#') {
      const close = text.indexOf('#', i + 1);
      if (close < 0) throw new ExprSyntaxError('badDate', { start, end: n });
      i = close + 1;
      const v = cfg.parseDate(text.slice(start + 1, close));
      if (!v) throw new ExprSyntaxError('badDate', { start, end: i });
      out.push({ t: 'date', v, start, end: i });
    } else if (/\d/.test(c) || (text.startsWith(cfg.decimalSep, i) && /\d/.test(text[i + cfg.decimalSep.length] ?? ''))) {
      let int = '', frac = '';
      while (/\d/.test(text[i] ?? '')) int += text[i++];
      if (text.startsWith(cfg.decimalSep, i)) {
        i += cfg.decimalSep.length;
        while (/\d/.test(text[i] ?? '')) frac += text[i++];
        if (!frac) throw new ExprSyntaxError('badNumber', { start, end: i });
      }
      if (/[\p{L}_.]/u.test(text[i] ?? '')) { // 12abc, 1..2, 1.2.3
        while (/[\p{L}\p{Nd}_.]/u.test(text[i] ?? '')) i++;
        throw new ExprSyntaxError('badNumber', { start, end: i });
      }
      out.push({ t: 'num', v: canonicalNumber(int, frac), start, end: i });
    } else {
      WORD.lastIndex = i;
      const w = WORD.exec(text);
      if (w) {
        i += w[0].length;
        const folded = cfg.fold(w[0]);
        const kw = cfg.keywords.get(folded);
        const fn = cfg.functions.get(folded);
        if (kw) out.push({ t: 'kw', v: kw, start, end: i });
        else out.push({ t: 'id', v: fn && /^\s*\(/.test(text.slice(i)) ? fn : w[0], bare: true, start, end: i });
        continue;
      }
      if (c === cfg.listSep) { out.push({ t: 'op', v: ',', start, end: ++i }); continue; }
      const op = OPS.find((o) => text.startsWith(o, i));
      i += op ? op.length : 1; // inconnu (!, :, ...) : le parseur le refuse ; « . » et « ; » servent au SQL (A3)
      out.push({ t: 'op', v: op ?? (c === ',' ? 'bad,' : c), start, end: i }); // « , » qui n'est pas le séparateur : refusé
    }
  }
  out.push({ t: 'eof', v: '', start: n, end: n });
  return out;
}
