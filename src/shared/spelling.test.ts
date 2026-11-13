import { describe, expect, it } from 'vitest';
import { applyChange, wordsOf } from './spelling';

describe('spelling words', () => {
  it('splits words with their offsets, keeps inner apostrophes and accents', () => {
    const text = "L'été, c'est beau";
    expect(wordsOf(text).map((w) => w.word)).toEqual(["L'été", "c'est", 'beau']);
    for (const w of wordsOf(text)) expect(text.slice(w.start, w.end)).toBe(w.word);
  });
  it('skips numbers, words with digits, addresses, paths, UPPERCASE words and single letters', () => {
    expect(wordsOf('abc123 42 a x@y.fr http://x.fr www.x.fr C:\\dir a/b snake_case NASA ok').map((w) => w.word)).toEqual(['ok']);
  });
  it('looks inside a hyphenated word', () => {
    expect(wordsOf('week-end').map((w) => w.word)).toEqual(['week', 'end']);
  });
  it('applies a change at a position, whatever the new length', () => {
    const text = 'a teh b';
    const [w] = wordsOf(text);
    expect(applyChange(text, w!, 'the')).toBe('a the b');
    expect(applyChange(text, w!, 'then maybe')).toBe('a then maybe b');
  });
});
