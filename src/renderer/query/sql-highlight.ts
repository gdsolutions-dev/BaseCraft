// SQL view helpers (pure): a tolerant colouring pass (the parser's lexer throws on half-typed text) and the word completion.
import { SQL_WORDS } from '../../shared/query/sql-parser';
import { asciiLower, bracket } from '../../shared/expr/lexer';

/** Keywords completed and coloured: the parser's reserved words plus the operators and literals of Access SQL. */
export const SQL_KEYWORDS: readonly string[] = [...new Set([...SQL_WORDS, 'and', 'or', 'not', 'like', 'in', 'is', 'null', 'between', 'true', 'false', 'exists', 'count', 'sum', 'avg', 'min', 'max'])]
  .map((w) => w.toUpperCase()).sort();
const KEYWORDS = new Set(SQL_KEYWORDS.map(asciiLower));

export type Kind = 'kw' | 'str' | 'id' | 'num' | 'date' | 'text';
// one alternative per kind, in this order: string, [identifier], #date#, number, word; anything else is plain text
const RE = /("(?:[^"]|"")*"?|'(?:[^']|'')*'?)|(\[(?:[^\]]|\]\])*\]?)|(#[^#\n]*#?)|(\d+(?:\.\d+)?)|([\p{L}_][\p{L}\p{M}\p{Nd}_]*)/gu;

/** The text cut in runs, each with its kind; the runs joined give the text back. */
export function highlight(text: string): { kind: Kind; text: string }[] {
  const out: { kind: Kind; text: string }[] = [];
  const push = (kind: Kind, s: string) => { if (s) out.push({ kind, text: s }); };
  let last = 0;
  for (const m of text.matchAll(RE)) {
    push('text', text.slice(last, m.index));
    const kind: Kind = m[1] ? 'str' : m[2] ? 'id' : m[3] ? 'date' : m[4] ? 'num' : KEYWORDS.has(asciiLower(m[0])) ? 'kw' : 'text';
    push(kind, m[0]);
    last = m.index + m[0].length;
  }
  push('text', text.slice(last));
  return out;
}

/** The word being typed before `caret` (a `[name` too), or null. */
export function wordAt(text: string, caret: number): { start: number; word: string } | null {
  const m = /\[[^\]\n]*$|[\p{L}_][\p{L}\p{M}\p{Nd}_]*$/u.exec(text.slice(0, caret));
  return m ? { start: m.index, word: m[0] } : null;
}

/** Candidates for `word`: keywords, then names (bracketed when they are not plain words); the word itself is not offered. */
export function complete(word: string, names: readonly string[], max = 8): string[] {
  const w = asciiLower(word.replace(/^\[/, ''));
  const hit = (s: string) => asciiLower(s).startsWith(w) && asciiLower(s) !== w;
  const plain = (n: string) => /^[\p{L}_][\p{L}\p{M}\p{Nd}_]*$/u.test(n) && !KEYWORDS.has(asciiLower(n));
  const kws = word.startsWith('[') ? [] : SQL_KEYWORDS.filter(hit);
  return [...kws, ...names.filter(hit).map((n) => (plain(n) && !word.startsWith('[') ? n : bracket(n))).sort((a, b) => a.localeCompare(b))].slice(0, max);
}
