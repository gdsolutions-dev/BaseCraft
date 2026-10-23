import { describe, expect, it } from 'vitest';
import { EMBEDDED_FONTS, FONT_FILES, cssFamily, fontFaceCss, fontFile } from './fonts';

describe('embedded font files (A5)', () => {
  it('every embedded family has its four files', () => {
    expect(Object.keys(FONT_FILES).sort()).toEqual(EMBEDDED_FONTS.map((f) => f.family).sort());
    expect(FONT_FILES['Liberation Sans']).toEqual({ regular: 'LiberationSans-Regular.ttf', bold: 'LiberationSans-Bold.ttf',
      italic: 'LiberationSans-Italic.ttf', boldItalic: 'LiberationSans-BoldItalic.ttf' });
  });

  it('cssFamily prefixes the family', () => expect(cssFamily('Carlito')).toBe('BC Carlito'));

  it('fontFile picks the style', () => {
    expect(fontFile('Caladea', false, true)).toBe('Caladea-Italic.ttf');
    expect(fontFile('Liberation Mono', true, true)).toBe('LiberationMono-BoldItalic.ttf');
  });

  it('fontFile follows the Office aliases and ignores case', () => {
    expect(fontFile('Calibri', true, false)).toBe('Carlito-Bold.ttf');
    expect(fontFile('Times New Roman', false, false)).toBe('LiberationSerif-Regular.ttf');
    expect(fontFile('courier new', false, false)).toBe('LiberationMono-Regular.ttf');
    expect(fontFile('arial', false, true)).toBe('LiberationSans-Italic.ttf');
    expect(fontFile('carlito', false, false)).toBe('Carlito-Regular.ttf');
  });

  it('fontFaceCss declares an aliased face under its embedded family', () => {
    const css = fontFaceCss([{ family: 'Cambria', bold: false, italic: false }], 'f/');
    expect(css).toContain('font-family:"BC Caladea"');
    expect(css).toContain('url("f/Caladea-Regular.ttf")');
  });

  it('fontFile falls back to Liberation Sans', () => {
    expect(fontFile('Comic Sans MS', false, false)).toBe('LiberationSans-Regular.ttf');
    expect(fontFile('constructor', true, false)).toBe('LiberationSans-Bold.ttf');
  });

  it('fontFaceCss declares only the requested faces', () => {
    const css = fontFaceCss([{ family: 'Carlito', bold: true, italic: false }], 'fonts/');
    expect(css).toContain('font-family:"BC Carlito"');
    expect(css).toContain('url("fonts/Carlito-Bold.ttf")');
    expect(css).toContain('font-weight:700');
    expect(css).not.toContain('Carlito-Regular');
  });

  it('fontFaceCss declares a face once, with its style', () => {
    const face = { family: 'Inter', bold: false, italic: true };
    const css = fontFaceCss([face, face], 'x/');
    expect(css.match(/@font-face/g)).toHaveLength(1);
    expect(css).toContain('font-style:italic');
    expect(css).toContain('font-weight:400');
  });

  it('fontFaceCss maps a non-embedded family to Liberation Sans', () => {
    const css = fontFaceCss([{ family: 'Comic Sans MS', bold: false, italic: false }], 'fonts/');
    expect(css).toContain('font-family:"BC Liberation Sans"');
    expect(css).toContain('url("fonts/LiberationSans-Regular.ttf")');
    expect(css).not.toContain('Comic');
  });

  it('fontFaceCss quotes and escapes the base URL (spaces, parentheses, quotes)', () => {
    const css = fontFaceCss([{ family: 'Carlito', bold: false, italic: false }], 'file:///C:/Mes polices (2)/');
    expect(css).toContain('src:url("file:///C:/Mes polices (2)/Carlito-Regular.ttf") format("truetype")');
    const hostile = fontFaceCss([{ family: 'Carlito', bold: false, italic: false }], 'a") ;}*{color:red} x("\\\n/');
    expect(hostile).toContain('src:url("a\\22 ) ;}*{color:red} x(\\22 \\5c \\a /Carlito-Regular.ttf")');
    expect(hostile.match(/@font-face/g)).toHaveLength(1);
  });
});
