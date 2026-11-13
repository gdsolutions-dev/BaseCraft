// Home › Spelling (C2): the words of a cell's text to look up, and a correction applied at a word's position.
export interface SpellWord { word: string; start: number; end: number }

/** The words worth looking up, in order, with their [start, end) offsets. Skipped, as Access does: what is next to a digit,
 *  e-mail addresses, web addresses, paths and identifiers (@ / \ _), UPPERCASE words, single letters. An inner apostrophe stays. */
export function wordsOf(text: string): SpellWord[] {
  const out: SpellWord[] = [];
  for (const chunk of text.matchAll(/\S+/gu)) {
    if (/[\d@\\/_]|:\/\/|^www\./iu.test(chunk[0])) continue;
    for (const m of chunk[0].matchAll(/[\p{L}\p{M}]+(?:['’][\p{L}\p{M}]+)*/gu)) {
      const word = m[0];
      if ([...word].length < 2 || (word === word.toUpperCase() && word !== word.toLowerCase())) continue;
      const start = chunk.index! + m.index!;
      out.push({ word, start, end: start + word.length });
    }
  }
  return out;
}

/** The text with the word at `w` replaced. */
export const applyChange = (text: string, w: { start: number; end: number }, replacement: string): string =>
  text.slice(0, w.start) + replacement + text.slice(w.end);
