// Sort orders of a base (Access: « Ordre de tri de la nouvelle base de données »). Pure: no I/O.
// `legacy` is what BaseCraft always did (case and accents folded, code-point order of the folded text); the others rank
// characters with Intl.Collator of the order's language. node:sqlite has no createCollation, so an order is a UDF that maps a
// text to a key string (bc_okey, registered by registerFunctions) and ORDER BY compares the keys.

/** Order id -> BCP 47 tag of its language (`legacy` has none). */
export const SORT_ORDER_LOCALES = {
  legacy: '', general: 'und', arabic: 'ar', chinese: 'zh', croatian: 'hr', czech: 'cs', danish: 'da', dutch: 'nl', estonian: 'et', german: 'de',
  greek: 'el', hebrew: 'he', hungarian: 'hu', icelandic: 'is', japanese: 'ja', korean: 'ko', latvian: 'lv', lithuanian: 'lt', norwegian: 'nb',
  polish: 'pl', romanian: 'ro', slovak: 'sk', slovenian: 'sl', spanish: 'es', spanishTraditional: 'es-u-co-trad', swedish: 'sv', thai: 'th', turkish: 'tr', ukrainian: 'uk',
} as const;
export type SortOrderId = keyof typeof SORT_ORDER_LOCALES;
export const SORT_ORDERS = Object.keys(SORT_ORDER_LOCALES) as SortOrderId[];
/** A new base's order when no workstation option says otherwise; a base that stores none (made before this option) is `legacy`. */
export const DEFAULT_NEW_SORT_ORDER: SortOrderId = 'general';
export const isSortOrder = (v: unknown): v is SortOrderId => typeof v === 'string' && Object.hasOwn(SORT_ORDER_LOCALES, v);

/** Same folding as bc_fold (sql.ts): accents and case ignored. Duplicated, not imported, to keep this module free of the expression library. */
const fold = (s: string): string => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
const EXPANSIONS: [string, string][] = [['æ', 'ae'], ['Æ', 'AE'], ['œ', 'oe'], ['Œ', 'OE'], ['ß', 'ss'], ['ẞ', 'SS'], ['ĳ', 'ij'], ['Ĳ', 'IJ']];
const OFFSET = 0x20; // ranks start above the control characters; at most ~40,000 of them, far below the surrogates (0xD800)

/** Rank of each BMP character (letters, digits, punctuation, symbols, spaces; precomposed ones included, so that å, ñ, č are letters of
 *  their own where the language says so) at the collator's base level: equal characters share a rank. */
function rankTable(co: Intl.Collator, contractions: string[]): Map<string, string> {
  const chars: string[] = [...contractions];
  for (let c = 0x20; c < 0xd800; c++) {
    const s = String.fromCharCode(c);
    if (/^[\p{L}\p{N}\p{P}\p{S}\p{Z}]$/u.test(s)) chars.push(s);
  }
  chars.sort(co.compare);
  const table = new Map<string, string>();
  let rank = OFFSET;
  chars.forEach((ch, i) => {
    if (i > 0 && co.compare(chars[i - 1]!, ch) !== 0) rank++;
    table.set(ch, String.fromCharCode(rank));
  });
  return table;
}

/** The two-letter contractions of a language (Czech "ch", Danish "aa", Hungarian "cs"/"gy"/"sz"...: sorted as one letter), found by
 *  asking the collator: "ab" is one when it sorts against "az" otherwise than b against z. Lower case, two letters
 *  (Hungarian "dz" and "dzs" are missed: "z" is not probed). */
function findContractions(co: Intl.Collator): string[] {
  const ascii = [...'abcdefghijklmnopqrstuvwxyz'];
  const seconds = [...ascii];
  for (let c = 0xdf; c <= 0x17f; c++) { const ch = String.fromCharCode(c); if (/^\p{Ll}$/u.test(ch)) seconds.push(ch); }
  const out: string[] = [];
  // "ab" against "az": a plain pair sorts as b against z; a contraction is a letter of its own, before or after all of "a?" (not "az", z excluded)
  for (const a of ascii) for (const b of seconds) {
    const e = co.compare(b, 'z');
    if (e !== 0 && Math.sign(co.compare(a + b, a + 'z')) !== Math.sign(e)) out.push(a + b);
  }
  return out;
}

const keyFns = new Map<SortOrderId, (s: string) => string>();
/** The key function of an order: texts that sort equal at the base level (case and, unless the language ranks it, accent) get keys
 *  that compare equal, and keys compare by code point as the texts sort. Ties are broken by the caller (bc_gkey). Built once per order.
 *  ponytail: character by character plus two-letter contractions (Czech "ch", Danish "aa"...); no numbers-by-value, no
 *  three-letter contraction ("dzs"); ICU's full sort keys would need a collation hook node:sqlite lacks. */
export function sortKey(order: SortOrderId): (s: string) => string {
  const known = keyFns.get(order);
  if (known) return known;
  let fn: (s: string) => string;
  if (order === 'legacy') fn = fold;
  else {
    const co = new Intl.Collator(SORT_ORDER_LOCALES[order], { sensitivity: 'base' });
    const contr = findContractions(co);
    const table = rankTable(co, contr);
    const pairs = new Set(contr);
    const expand = EXPANSIONS.filter(([c, e]) => co.compare(c, e) === 0);
    fn = (s) => {
      let t = s.normalize('NFKC');
      for (const [c, e] of expand) t = t.replaceAll(c, e);
      let out = '';
      const cs = [...t.normalize('NFC')];
      for (let i = 0; i < cs.length; i++) {
        const ch = cs[i]!;
        if (pairs.size && i + 1 < cs.length && pairs.has((ch + cs[i + 1]).toLowerCase())) { out += table.get((ch + cs[i + 1]).toLowerCase()); i++; continue; }
        out += table.get(ch) ?? (/^\p{M}$/u.test(ch) ? '' : ch); // a stray mark ranks nothing
      }
      return out;
    };
  }
  keyFns.set(order, fn);
  return fn;
}
