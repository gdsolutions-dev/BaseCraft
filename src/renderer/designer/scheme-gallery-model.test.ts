import { describe, expect, it } from 'vitest';
import { BUILTIN_THEMES, deriveDark } from '../../shared/design/theme';
import { colorSchemes, customizeColors, fontSchemes, isValidFontScheme, isValidScheme, swapColors, swapFonts } from './scheme-gallery-model';

const [base, slate, forest] = BUILTIN_THEMES;

describe('colorSchemes', () => {
  it('current first, then custom, then built-ins, each distinct', () => {
    const mine = { ...forest!, name: 'Mien', colors: { ...forest!.colors, name: 'Mes couleurs' } };
    const e = colorSchemes(slate!, [mine], BUILTIN_THEMES);
    expect(e.map((x) => [x.section, x.scheme.name])).toEqual([
      ['current', slate!.colors.name], ['custom', 'Mes couleurs'], ...BUILTIN_THEMES.filter((t) => t !== slate).map((t) => ['builtin', t.colors.name])]);
  });
  it('a scheme equal to the current one in name and content is not repeated; same name, other content stays', () => {
    const e = colorSchemes(slate!, [{ ...base!, colors: slate!.colors }, { ...base!, colors: { ...slate!.colors, light: { ...slate!.colors.light, accent1: '#010203' } } }], []);
    expect(e.map((x) => x.section)).toEqual(['current', 'custom']);
  });
});

describe('swapColors', () => {
  it('replaces the colours only: theme name and fonts stay', () => {
    const t = swapColors(base!, slate!.colors);
    expect(t.colors).toBe(slate!.colors);
    expect([t.name, t.fonts]).toEqual([base!.name, base!.fonts]);
  });
});

describe('isValidScheme', () => {
  it('accepts a real scheme, refuses a bad hex, an empty name or a missing dark palette', () => {
    expect(isValidScheme(slate!.colors)).toBe(true);
    expect(isValidScheme({ ...slate!.colors, light: { ...slate!.colors.light, accent1: 'red' } })).toBe(false);
    expect(isValidScheme({ ...slate!.colors, name: '' })).toBe(false);
    expect(isValidScheme({ name: 'x', light: slate!.colors.light } as never)).toBe(false);
  });
});

describe('customizeColors', () => {
  it('a Dark value never edited follows deriveDark of its Light value; an edited one is kept; untouched slots keep the base', () => {
    const c = customizeColors(base!.colors, { accent1: { light: '#123456' }, accent2: { light: '#654321', dark: '#abcdef' } }, 'Neuf');
    const d = deriveDark({ ...base!.colors.light, accent1: '#123456', accent2: '#654321' });
    expect(c.name).toBe('Neuf');
    expect([c.light.accent1, c.dark.accent1]).toEqual(['#123456', d.accent1]);
    expect([c.light.accent2, c.dark.accent2]).toEqual(['#654321', '#abcdef']);
    expect(c.dark.accent3).toBe(base!.colors.dark.accent3);
    expect(c.light.accent3).toBe(base!.colors.light.accent3);
  });
  it('a Dark-only edit keeps the Light value', () => {
    const c = customizeColors(base!.colors, { accent1: { dark: '#ffffff' } }, 'x');
    expect([c.light.accent1, c.dark.accent1]).toEqual([base!.colors.light.accent1, '#ffffff']);
  });
  it('the result is valid', () => { expect(isValidScheme(customizeColors(base!.colors, { hlink: { light: '#00ff00' } }, 'x'))).toBe(true); });
});

describe('fontSchemes', () => {
  it('current first, then custom, then built-ins, each distinct', () => {
    const mine = { ...forest!, name: 'Mien', fonts: { name: 'Mes polices', major: 'Caladea', minor: 'Inter' } };
    const e = fontSchemes(slate!, [mine], BUILTIN_THEMES);
    expect(e.map((x) => [x.section, x.scheme.name])).toEqual([
      ['current', 'Ardoise'], ['custom', 'Mes polices'], ['builtin', 'BaseCraft'], ['builtin', 'Forêt'], ['builtin', 'Sable'], ['builtin', 'Océan'], ['builtin', 'Prune']]);
  });
});

describe('swapFonts', () => {
  it('replaces the fonts only: theme name and colours stay', () => {
    const t = swapFonts(base!, forest!.fonts);
    expect(t.fonts).toBe(forest!.fonts);
    expect([t.name, t.colors]).toEqual([base!.name, base!.colors]);
  });
});

describe('isValidFontScheme', () => {
  it('accepts embedded families, refuses a system font or an empty name', () => {
    expect(isValidFontScheme(forest!.fonts)).toBe(true);
    expect(isValidFontScheme({ ...forest!.fonts, major: 'Comic Sans' })).toBe(false);
    expect(isValidFontScheme({ ...forest!.fonts, minor: 'Comic Sans' })).toBe(false);
    expect(isValidFontScheme({ ...forest!.fonts, name: ' ' })).toBe(false);
  });
});
