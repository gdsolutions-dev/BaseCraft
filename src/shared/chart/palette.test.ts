import { describe, expect, it } from 'vitest';
import { resolveColor } from '../design/colors';
import { BUILTIN_THEMES, DEFAULT_THEME } from '../design/theme';
import { cssFamily } from '../fonts';
import { chartPalette } from './palette';

describe('chartPalette', () => {
  it('6 accents du thème, clair', () => {
    const p = chartPalette(DEFAULT_THEME, 'light');
    expect(p.series).toEqual([1, 2, 3, 4, 5, 6].map((n) => resolveColor(`theme:accent${n}`, 'light', 'transparent', DEFAULT_THEME)));
    expect(new Set(p.series).size).toBe(6);
  });
  it('le mode sombre change les accents et le texte', () => {
    const l = chartPalette(DEFAULT_THEME, 'light');
    const d = chartPalette(DEFAULT_THEME, 'dark');
    expect(d.series).toEqual([1, 2, 3, 4, 5, 6].map((n) => resolveColor(`theme:accent${n}`, 'dark', 'transparent', DEFAULT_THEME)));
    expect(d.series).not.toEqual(l.series);
    expect(d.text).not.toBe(l.text);
  });
  it('une police non portable donne Liberation Sans', () => {
    const t = { ...DEFAULT_THEME, fonts: { ...DEFAULT_THEME.fonts, minor: 'Comic Sans MS' } };
    expect(chartPalette(t, 'light').fontFamily).toBe(cssFamily('Liberation Sans'));
    expect(chartPalette(BUILTIN_THEMES[3]!, 'light').fontFamily).toBe(cssFamily('Liberation Sans'));
    expect(chartPalette(DEFAULT_THEME, 'light').fontFamily).toBe(cssFamily('Inter'));
  });
});
