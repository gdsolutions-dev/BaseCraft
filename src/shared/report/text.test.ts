import { describe, expect, it } from 'vitest';
import { metricsOf } from '../font-metrics';
import { EMBEDDED_FONTS, FONT_FILES, fontFile } from '../fonts';
import { lineHeight, measure, wrap } from './text';
import type { FontSpec } from './types';

const sans: FontSpec = { name: 'Liberation Sans', size: 10, bold: false, italic: false, underline: false };
const NBSP = ' ', NNBSP = ' ', THIN = ' ', SHY = '­';

/** Advance of a code point in an embedded file, straight from the metric table (undefined when unmapped). */
const advance = (file: string, cp: number): number | undefined => {
  for (const [first, a] of metricsOf(file).runs) if (cp >= first && cp < first + a.length) return a[cp - first];
  return undefined;
};

/** Every embedded file, as a FontSpec: family × the four styles. */
const faces: { file: string; font: FontSpec }[] = EMBEDDED_FONTS.flatMap(({ family }) =>
  (['regular', 'bold', 'italic', 'boldItalic'] as const).map((k) => ({
    file: FONT_FILES[family]![k],
    font: { ...sans, name: family, bold: k === 'bold' || k === 'boldItalic', italic: k === 'italic' || k === 'boldItalic' },
  })));

describe('measure', () => {
  it('measure in twips', () => expect(measure('A', sans).width).toBeCloseTo(1366 * 200 / 2048, 9));
  it('mono is exact', () => expect(measure('abc', { ...sans, name: 'Courier New' }).width).toBeCloseTo(3 * 1229 * 200 / 2048, 9));
  it('bold uses the bold file', () => expect(measure('A', { ...sans, bold: true }).width).not.toBe(measure('A', sans).width));
  it('line height', () => {
    const m = metricsOf('LiberationSans-Regular.ttf');
    expect(lineHeight(sans)).toBe(Math.round((m.ascender - m.descender + m.lineGap) * 200 / m.upm));
  });
  it('missing glyphs measured at 1 em and reported', () => {
    const r = measure('a😀b', sans); expect(r.missing).toEqual(['😀']);
    expect(r.width).toBeCloseTo(measure('ab', sans).width + 200, 9);
  });
  it('missing glyphs are reported once, as one character per code point', () => {
    expect(measure('😀😀中', sans).missing).toEqual(['😀', '中']);
    expect(measure('', sans)).toEqual({ width: 0, missing: [] });
  });
  it('non-portable font measured as Liberation Sans', () => expect(measure('A', { ...sans, name: 'Comic Sans MS' }).width).toBe(measure('A', sans).width));
  it('a tab counts as a space', () => expect(measure('a\tb', sans)).toEqual(measure('a b', sans)));

  it('U+202F in a French number is measured in every embedded face, by U+2009 then U+00A0 when the face lacks it (C12)', () => {
    for (const { file, font } of faces) {
      const own = advance(file, 0x202f);
      const sub = own ?? advance(file, 0x2009) ?? advance(file, 0x00a0)!;
      const r = measure(`1${NNBSP}234,50`, font);
      expect(r.missing, file).toEqual([]);
      const m = metricsOf(file);
      const digits = [...'1234,50'].reduce((n, ch) => n + advance(file, ch.codePointAt(0)!)!, 0);
      expect(r.width, file).toBeCloseTo((digits + sub) * 200 / m.upm, 9);
    }
  });
  it('Caladea and Liberation Mono lack U+202F and U+2009, so a French number measures with U+00A0', () => {
    for (const name of ['Caladea', 'Liberation Mono', 'Cambria', 'Courier New']) {
      const font = { ...sans, name };
      expect(advance(fontFile(name, false, false), 0x202f)).toBeUndefined();
      expect(measure(`1${NNBSP}234,50`, font).width, name).toBe(measure(`1${NBSP}234,50`, font).width);
    }
    expect(measure(`1${NNBSP}234,50`, sans).width).toBe(measure(`1${THIN}234,50`, sans).width);
    expect(measure(`1${NNBSP}234,50`, sans).width).not.toBe(measure(`1${NBSP}234,50`, sans).width);
  });
  it('a soft hyphen has zero width and is never missing (C12)', () => {
    for (const { file, font } of faces) {
      const r = measure(`co${SHY}opération`, font);
      expect(r.missing, file).toEqual([]);
      expect(r.width, file).toBe(measure('coopération', font).width);
    }
  });
});

describe('wrap', () => {
  it('wraps at spaces and hyphens, trims trailing spaces', () => {
    const w = measure('Bonjour le', sans).width + 1;
    expect(wrap('Bonjour le monde', sans, w).lines).toEqual(['Bonjour le', 'monde']);
    // 'monnaie' (7856 units) is wider than 'porte-' (5350): the brief's width cannot hold it, so the width is 'monnaie'.
    // 'porte-m' fits in it, and the break still goes back to the hyphen.
    expect(wrap('porte-monnaie', sans, measure('monnaie', sans).width + 1).lines).toEqual(['porte-', 'monnaie']);
  });
  it('never breaks on NBSP', () =>
    expect(wrap(`a b${NBSP}c`, sans, measure('a b', sans).width + 1).lines).toEqual(['a', `b${NBSP}c`]));
  it('never breaks on U+202F', () =>
    expect(wrap(`1${NNBSP}234 x`, sans, measure(`1${NNBSP}234`, sans).width + 1).lines).toEqual([`1${NNBSP}234`, 'x']));
  it('explicit breaks', () => expect(wrap('a\r\nb\nc', sans, 10000).lines).toEqual(['a', 'b', 'c']));
  it('empty text gives no line; an empty paragraph gives an empty line', () => {
    expect(wrap('', sans, 10000)).toEqual({ lines: [], missing: [] });
    expect(wrap('a\n\nb', sans, 10000).lines).toEqual(['a', '', 'b']);
    expect(wrap('a\n', sans, 10000).lines).toEqual(['a', '']);
  });
  it('trailing spaces never overflow and are removed; leading spaces of a line count', () => {
    expect(wrap('a   ', sans, 10000).lines).toEqual(['a']);
    expect(wrap('a      b', sans, measure('a', sans).width + 1).lines).toEqual(['a', 'b']);
    expect(wrap(' a b', sans, measure(' a', sans).width + 1).lines).toEqual([' a', 'b']);
  });
  it('a tab is a space: drawn as one, a break after it', () => {
    expect(wrap('a\tb', sans, measure('a', sans).width + 1).lines).toEqual(['a', 'b']);
    expect(wrap('a\tb', sans, 10000).lines).toEqual(['a b']);
  });
  it('a word wider than the width is broken by character, at least one per line', () => {
    expect(wrap('abcdef', sans, measure('ab', sans).width + 1).lines).toEqual(['ab', 'cd', 'ef']);
    expect(wrap('W', sans, 1).lines).toEqual(['W']);
    expect(wrap('WW', sans, 1).lines).toEqual(['W', 'W']);
    expect(wrap('x abcdef', sans, measure('abc', sans).width + 1).lines).toEqual(['x', 'abc', 'def']);
  });
  it('a soft hyphen breaks a line with a visible hyphen, else disappears (C12)', () => {
    expect(wrap(`porte${SHY}monnaie`, sans, 10000).lines).toEqual(['portemonnaie']);
    expect(wrap(`porte${SHY}monnaie`, sans, measure('monnaie', sans).width + 1).lines).toEqual(['porte-', 'monnaie']);
    // The hyphen itself does not fit: no opportunity there, the word breaks by character without a hyphen.
    const tight = wrap(`porte${SHY}monnaie`, sans, measure('porte', sans).width + 1).lines;
    expect(tight[0]).toBe('porte');
    expect(tight.join('')).toBe('portemonnaie');
    for (const { font } of faces) {
      expect(wrap(`ab${SHY}cd`, font, measure('ab-', font).width + 1).lines).toEqual(['ab-', 'cd']);
    }
  });
  it('lines carry the drawn characters: U+202F stays where the face has it, else its substitute (C12)', () => {
    expect(wrap(`1${NNBSP}234,50`, sans, 10000).lines).toEqual([`1${NNBSP}234,50`]);
    expect(wrap(`1${NNBSP}234,50`, { ...sans, name: 'Caladea' }, 10000).lines).toEqual([`1${NBSP}234,50`]);
    expect(wrap(`1${NNBSP}234,50`, { ...sans, name: 'Liberation Mono' }, 10000).lines).toEqual([`1${NBSP}234,50`]);
  });
  it('reports missing glyphs once and measures them at 1 em', () => {
    const r = wrap('a😀b 😀', sans, measure('a😀', sans).width);
    expect(r.missing).toEqual(['😀']);
    expect(r.lines).toEqual(['a😀', 'b', '😀']);
  });
  it('width is measured as `measure` does', () => {
    const line = `Facture n° 1${NNBSP}234,50 € — porte-monnaie`;
    for (const { font } of faces) {
      const w = measure(line, font).width;
      const one = wrap(line, font, w).lines; // one line, drawn with the face's substitutes, of exactly that width
      expect(one.length, font.name).toBe(1);
      expect(measure(one[0]!, font).width, font.name).toBe(w);
      expect(wrap(line, font, w - 1).lines.length, font.name).toBeGreaterThan(1);
    }
  });
});

describe('zero-width characters and leading spaces', () => {
  it('default-ignorable code points are zero width and never missing, whatever the face', () => {
    const text = 'a\u200Bb\u200Fc\u2060d\u206Fe\uFE00f\uFE0Fg\uFEFFh';
    for (const { font } of faces) {
      const r = measure(text, font);
      expect(r.missing).toEqual([]);
      expect(r.width).toBeCloseTo(measure('abcdefgh', font).width, 9);
    }
    expect(measure('\u200B', sans)).toEqual({ width: 0, missing: [] });
    expect(wrap('a\u200Bb c', sans, measure('ab', sans).width + 1).lines).toEqual(['a\u200Bb', 'c']);
  });
  it('a zero-width ignorable after spaces does not keep the trailing spaces', () => {
    expect(wrap('ab \u200B', sans, 10000).lines).toEqual(['ab']);
    expect(wrap('ab  \uFEFF\nc', sans, 10000).lines).toEqual(['ab', 'c']);
    expect(wrap('ab \u200Bcd', sans, 10000).lines).toEqual(['ab \u200Bcd']);
    expect(wrap('ab\u200B', sans, 10000).lines).toEqual(['ab\u200B']);
  });
  it('a soft hyphen right after a space does not override the space break', () => {
    expect(wrap(`ab ${SHY}cd`, sans, measure('ab-', sans).width + 1).lines).toEqual(['ab', 'cd']);
    expect(wrap(`ab ${SHY}cd`, sans, 10000).lines).toEqual(['ab cd']);
  });
  it('leading spaces plus one character never exceed the width', () => {
    const w = measure('W', sans).width + 1;
    expect(wrap('   W', sans, w).lines).toEqual(['', 'W']);
    expect(wrap('   WW', sans, w).lines).toEqual(['', 'W', 'W']);
    expect(wrap('  ab cd', sans, measure('  ab', sans).width + 1).lines).toEqual(['  ab', 'cd']);
    for (const line of wrap('   W', sans, w).lines) expect(measure(line, sans).width).toBeLessThanOrEqual(w);
  });
});
