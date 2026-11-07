import { describe, expect, it } from 'vitest';
import { DARK_THEME_HEX, LIGHT_THEME_HEX } from './colors';
import { EMBEDDED_FONTS } from '../fonts';
import {
  BUILTIN_THEMES, DEFAULT_THEME, THEME_SLOTS, deriveDark, effectiveTheme, formatSlotRef, isTheme, parseSlotRef, readTheme, shade, tint, variantsFor,
} from './theme';

const hsl = (hex: string): [number, number, number] => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255) as [number, number, number];
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2, d = mx - mn;
  if (d === 0) return [0, 0, l];
  const s = d / (1 - Math.abs(2 * l - 1));
  const h = mx === r ? ((g - b) / d + 6) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h * 60, s, l];
};
const v = (mode: 'tint' | 'shade', pct: number) => ({ mode, pct });

describe('tint / shade', () => {
  it('exact values', () => {
    expect(tint('#000000', 0.5)).toBe('#808080');
    expect(shade('#ffffff', 0.05)).toBe('#f2f2f2');
  });
  it('keep hue and saturation, change lightness by the formula', () => {
    const [h, s, l] = hsl('#3e63dd');
    const t = hsl(tint('#3e63dd', 0.8)), k = hsl(shade('#3e63dd', 0.25));
    expect(Math.abs(t[0] - h)).toBeLessThan(1.5);
    expect(Math.abs(t[1] - s)).toBeLessThan(0.03);
    expect(Math.abs(t[2] - (l + (1 - l) * 0.8))).toBeLessThan(0.01);
    expect(Math.abs(k[0] - h)).toBeLessThan(1.5);
    expect(Math.abs(k[1] - s)).toBeLessThan(0.03);
    expect(Math.abs(k[2] - l * 0.75)).toBeLessThan(0.01);
  });
});

describe('variantsFor', () => {
  it('white, black, dark, light, mid', () => {
    expect(variantsFor('#ffffff')).toEqual([5, 15, 25, 35, 50].map((p) => v('shade', p)));
    expect(variantsFor('#000000')).toEqual([50, 35, 25, 15, 5].map((p) => v('tint', p)));
    expect(variantsFor('#1a1a1a')).toEqual([90, 75, 50, 25, 10].map((p) => v('tint', p)));
    expect(variantsFor('#e6e6e6')).toEqual([10, 25, 50, 75, 90].map((p) => v('shade', p)));
    expect(variantsFor('#3e63dd')).toEqual([v('tint', 80), v('tint', 60), v('tint', 40), v('shade', 25), v('shade', 50)]);
  });
});

describe('slot references', () => {
  it('parse', () => {
    expect(parseSlotRef('theme:accent1')).toEqual({ slot: 'accent1', mode: null, pct: 0 });
    expect(parseSlotRef('theme:accent1@-25')).toEqual({ slot: 'accent1', mode: 'shade', pct: 25 });
    expect(parseSlotRef('theme:lt1@+40')).toEqual({ slot: 'lt1', mode: 'tint', pct: 40 });
    for (const bad of ['theme:accent7', 'theme:accent1@0', 'theme:accent1@100', 'theme:accent1@+x', 'theme:text', 'accent1', 42, null]) {
      expect(parseSlotRef(bad)).toBeNull();
    }
  });
  it('format round-trips', () => {
    expect(formatSlotRef('hlink')).toBe('theme:hlink');
    for (const s of ['theme:dk2', 'theme:accent6@+80', 'theme:folHlink@-5']) {
      const p = parseSlotRef(s)!;
      expect(formatSlotRef(p.slot, p.mode ? { mode: p.mode, pct: p.pct } : undefined)).toBe(s);
    }
  });
});

describe('Theme', () => {
  it('readTheme is total and tolerant', () => {
    for (const x of [undefined, {}, 'x', null, 3]) expect(readTheme(x)).toEqual(DEFAULT_THEME);
    const bad = { ...DEFAULT_THEME, colors: { ...DEFAULT_THEME.colors, light: { ...DEFAULT_THEME.colors.light, accent2: 'red' } } };
    const r = readTheme(bad);
    expect(r.colors.light.accent2).toBe(DEFAULT_THEME.colors.light.accent2);
    expect(r.colors.light.accent1).toBe(DEFAULT_THEME.colors.light.accent1);
    const noDark = { ...DEFAULT_THEME, colors: { name: 'x', light: BUILTIN_THEMES[1]!.colors.light } };
    expect(readTheme(noDark).colors.dark).toEqual(deriveDark(BUILTIN_THEMES[1]!.colors.light));
    expect(isTheme(bad)).toBe(false);
  });
  it('built-ins', () => {
    expect(BUILTIN_THEMES).toHaveLength(6);
    expect(new Set(BUILTIN_THEMES.map((t) => t.name)).size).toBe(6);
    expect(DEFAULT_THEME).toBe(BUILTIN_THEMES[0]);
    for (const t of BUILTIN_THEMES) {
      expect(isTheme(t)).toBe(true);
      for (const p of [t.colors.light, t.colors.dark]) {
        expect(THEME_SLOTS.map((s) => p[s]).every((h) => /^#[0-9a-f]{6}$/.test(h))).toBe(true);
      }
      for (const f of [t.fonts.major, t.fonts.minor]) expect(EMBEDDED_FONTS.some((e) => e.family === f)).toBe(true);
    }
  });
  it('picker order', () => {
    expect(THEME_SLOTS).toEqual(['lt1', 'dk1', 'lt2', 'dk2', 'accent1', 'accent2', 'accent3', 'accent4', 'accent5', 'accent6', 'hlink', 'folHlink']);
  });
  it('effectiveTheme', () => {
    const custom = BUILTIN_THEMES[2]!;
    expect(effectiveTheme({ Theme: custom }, DEFAULT_THEME)).toEqual(custom);
    expect(effectiveTheme({ Theme: 'junk' }, custom)).toBe(custom);
    expect(effectiveTheme({}, custom)).toBe(custom);
  });
  it('default theme equals the current look', () => {
    const { light, dark } = DEFAULT_THEME.colors;
    expect([light.dk1, light.lt1, light.accent1]).toEqual([LIGHT_THEME_HEX.text, '#ffffff', LIGHT_THEME_HEX.accent]);
    expect([dark.lt1, dark.dk1, dark.accent1]).toEqual([DARK_THEME_HEX.surface, DARK_THEME_HEX.text, DARK_THEME_HEX.accent]);
    expect(DEFAULT_THEME.fonts).toMatchObject({ major: 'Inter', minor: 'Inter' });
  });
});
