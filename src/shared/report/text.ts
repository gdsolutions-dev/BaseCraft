// Mesure et coupure du texte des états (pur) : somme des avances de font-metrics.json, jamais canvas.measureText.
// Le navigateur dessine les lignes telles quelles : chaque ligne porte déjà les caractères à dessiner (C12).
import { metricsOf, type FontMetrics } from '../font-metrics';
import { fontFile } from '../fonts';
import type { FontSpec } from './types';

const SHY = '­', NNBSP = ' ', THIN = ' ', NBSP = ' ';

/** Default-ignorable code points (zero-width spaces and joiners, variation selectors, BOM): zero width in every face. */
const IGNORABLE = /^[​-‏⁠-⁯︀-️﻿]$/;

interface Face { m: FontMetrics; adv: Map<number, number> /* code point → advance in font units */ }
/** Where a line ends: `end` is the index after its last drawn character, `next` where the following line starts. */
interface Break { end: number; next: number; hyphen: boolean /* a soft hyphen: draw '-' at the end */ }

const faces = new Map<string, Face>();

/** Metric table of the file `fontFile` picks for this font (a non-portable name measures as Liberation Sans). */
function face(font: FontSpec): Face {
  const file = fontFile(font.name, font.bold, font.italic);
  let f = faces.get(file);
  if (!f) {
    const m = metricsOf(file);
    const adv = new Map<number, number>();
    for (const [first, a] of m.runs) a.forEach((u, k) => adv.set(first + k, u));
    faces.set(file, (f = { m, adv }));
  }
  return f;
}

/** Twips of `units` font units at this size, computed once per quantity so `measure` and `wrap` agree exactly. */
const twips = (units: number, font: FontSpec, m: FontMetrics): number => (units * font.size * 20) / m.upm;

/**
 * What is drawn for one code point and its advance: a tab is a space; a soft hyphen draws nothing (zero width, `wrap`
 * adds the hyphen when it breaks there); a default-ignorable code point is drawn as is at zero width; U+202F falls back
 * to U+2009 then U+00A0 when the face lacks it (C12); any other unmapped character is drawn as is, measured at 1 em and
 * reported once in `missing`.
 */
function glyph(ch: string, f: Face, missing: string[]): { draw: string; units: number } {
  if (ch === SHY) return { draw: '', units: 0 };
  if (IGNORABLE.test(ch)) return { draw: ch, units: 0 };
  if (ch === '\t') ch = ' ';
  else if (ch === NNBSP && !f.adv.has(0x202f)) ch = f.adv.has(0x2009) ? THIN : NBSP;
  const units = f.adv.get(ch.codePointAt(0)!);
  if (units !== undefined) return { draw: ch, units };
  if (!missing.includes(ch)) missing.push(ch);
  return { draw: ch, units: f.m.upm };
}

/** Width of one line of text in twips (not rounded), code point by code point; trailing spaces count. */
export function measure(text: string, font: FontSpec): { width: number; missing: string[] } {
  const f = face(font);
  const missing: string[] = [];
  let units = 0;
  for (const ch of text) units += glyph(ch, f, missing).units;
  return { width: twips(units, font, f.m), missing };
}

/** Line height in twips: ascender − descender + lineGap of the hhea table, rounded once. */
export function lineHeight(font: FontSpec): number {
  const { m } = face(font);
  return Math.round(twips(m.ascender - m.descender + m.lineGap, font, m));
}

/**
 * Greedy line breaking into lines no wider than `width` twips. `\r\n`, `\n` and `\r` force a break; a line may break
 * after a space (a tab counts as one), after `-`, or at a soft hyphen (then `-` is drawn; one right after a space keeps
 * the space break), never at U+00A0 or U+202F; trailing spaces are dropped, and leading spaces that overflow with the
 * first character leave an empty line (spaces hang, as in CSS); a word wider than `width` is cut by character, one at
 * least per line; '' gives [].
 */
export function wrap(text: string, font: FontSpec, width: number): { lines: string[]; missing: string[] } {
  const lines: string[] = [];
  const missing: string[] = [];
  if (text === '') return { lines, missing };
  const f = face(font);
  const hyphen = glyph('-', f, missing).units;
  for (const para of text.split(/\r\n|\n|\r/)) {
    const g = [...para].map((ch) => glyph(ch, f, missing));
    let start = 0;
    for (;;) {
      let all = 0; // units of g[start..i], trailing spaces included
      let trim = 0; // units of g[start..end]
      let end = start; // index after the last visible character
      let opp: Break | null = null; // last break opportunity that fits
      let cut: Break | null = null;
      for (let i = start; i < g.length; i++) {
        const { draw, units } = g[i]!;
        if (draw === '') { // soft hyphen: an opportunity only when the drawn hyphen fits, and not right after a space
          if (end > start && all === trim && twips(trim + hyphen, font, f.m) <= width) opp = { end, next: i + 1, hyphen: true };
          continue;
        }
        if (draw === ' ') {
          all += units;
          if (end > start) opp = { end, next: i + 1, hyphen: false };
          continue;
        }
        if (units === 0 && all !== trim) continue; // zero width after spaces: kept only if a visible character follows
        if (all > 0 && twips(all + units, font, f.m) > width) { // all > 0: the first character with a width always fits
          cut = opp ?? { end, next: i, hyphen: false }; // no opportunity: cut the word before this character
          break;
        }
        all += units; trim = all; end = i + 1;
        if (draw === '-') opp = { end, next: end, hyphen: false };
      }
      const at = cut ?? { end, next: g.length, hyphen: false };
      lines.push(g.slice(start, at.end).map((x) => x.draw).join('') + (at.hyphen ? '-' : ''));
      if (!cut) break;
      start = at.next;
    }
  }
  return { lines, missing };
}
