// Polices embarquées (spec 4.7, contrat 1.5) : mêmes mesures sur les trois systèmes. Noms seulement ; le lot A5 ajoute les
// fichiers et les tables de mesure dans ce module, sans changer ces deux exports.
import { sameName } from './field-types';

export const EMBEDDED_FONTS: { family: string; generic: 'sans-serif' | 'serif' | 'monospace' }[] = [
  { family: 'Liberation Sans', generic: 'sans-serif' },
  { family: 'Liberation Serif', generic: 'serif' },
  { family: 'Liberation Mono', generic: 'monospace' },
  { family: 'Carlito', generic: 'sans-serif' },
  { family: 'Caladea', generic: 'serif' },
  { family: 'Inter', generic: 'sans-serif' },
];

/** Any other font is a system font, flagged "not portable". Case ignored. */
export const isEmbeddedFont = (name: string): boolean => EMBEDDED_FONTS.some((f) => sameName(f.family, name));

/** Office fonts and their metric-compatible embedded font: a layout made with them keeps its line breaks. */
export const FONT_ALIASES: Record<string, string> = {
  Arial: 'Liberation Sans',
  Helvetica: 'Liberation Sans',
  'Times New Roman': 'Liberation Serif',
  'Courier New': 'Liberation Mono',
  Calibri: 'Carlito',
  Cambria: 'Caladea',
};

/** The family to draw with; portable when it is embedded or aliased to an embedded font. "Not portable" in the UI = !portable. */
export function resolveFont(name: string): { family: string; portable: boolean } {
  const embedded = EMBEDDED_FONTS.find((f) => sameName(f.family, name));
  if (embedded) return { family: embedded.family, portable: true };
  const alias = Object.keys(FONT_ALIASES).find((a) => sameName(a, name));
  return alias ? { family: FONT_ALIASES[alias]!, portable: true } : { family: name, portable: false };
}

// --- A5 : fichiers des polices embarquées (src/renderer/public/fonts/, servis sous fonts/) ---

export type FontStyleKey = 'regular' | 'bold' | 'italic' | 'boldItalic';

/** Family of EMBEDDED_FONTS → its four TTF files ("Liberation Sans" → "LiberationSans-Bold.ttf"). */
export const FONT_FILES: Record<string, Record<FontStyleKey, string>> = Object.fromEntries(
  EMBEDDED_FONTS.map(({ family }): [string, Record<FontStyleKey, string>] => {
    const base = family.replaceAll(' ', '');
    return [family, { regular: `${base}-Regular.ttf`, bold: `${base}-Bold.ttf`, italic: `${base}-Italic.ttf`,
      boldItalic: `${base}-BoldItalic.ttf` }];
  }),
);

/** CSS name of an embedded family: never collides with an installed system font. */
export const cssFamily = (family: string): string => `BC ${family}`;

/** Embedded family (or alias) drawn as is; anything else is measured and drawn with Liberation Sans. */
const embeddedFamily = (family: string): string => {
  const r = resolveFont(family);
  return r.portable ? r.family : 'Liberation Sans';
};

export function fontFile(family: string, bold: boolean, italic: boolean): string {
  const key: FontStyleKey = bold ? (italic ? 'boldItalic' : 'bold') : italic ? 'italic' : 'regular';
  return FONT_FILES[embeddedFamily(family)]![key];
}

/** A CSS string: quote, backslash and control characters escaped, so a value never leaves it. */
export const cssString = (s: string): string => `"${s.replace(/["\\\u0000-\u001f\u007f]/g, (c) => `\\${c.charCodeAt(0).toString(16)} `)}"`;

/** @font-face rules for the faces used, each once; baseUrl ends with '/' (e.g. 'fonts/'), quoted: spaces and parentheses work. */
export function fontFaceCss(faces: { family: string; bold: boolean; italic: boolean }[], baseUrl: string): string {
  const rules = new Map<string, string>();
  for (const { family, bold, italic } of faces) {
    const file = fontFile(family, bold, italic);
    rules.set(file, `@font-face{font-family:"${cssFamily(embeddedFamily(family))}";src:url(${cssString(baseUrl + file)}) format("truetype");`
      + `font-weight:${bold ? 700 : 400};font-style:${italic ? 'italic' : 'normal'}}`);
  }
  return [...rules.values()].join('\n');
}
