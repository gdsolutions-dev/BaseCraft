import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BUILTIN_THEMES, DEFAULT_THEME, deriveDark, type Theme } from '../shared/design/theme';
import { readUserThemes, writeUserThemes, saveUserTheme, removeUserTheme } from './user-themes';

const tmp = () => mkdtempSync(join(tmpdir(), 'bc-ut-'));
const named = (name: string): Theme => ({ ...DEFAULT_THEME, name });

describe('user themes', () => {
  it('a missing or corrupt file gives []', () => {
    const d = tmp();
    expect(readUserThemes(d)).toEqual([]);
    writeFileSync(join(d, 'themes.json'), '{nope');
    expect(readUserThemes(d)).toEqual([]);
    writeFileSync(join(d, 'themes.json'), JSON.stringify({ themes: 5 }));
    expect(readUserThemes(d)).toEqual([]);
  });
  it('drops invalid entries, keeps the first of each name (case-insensitive), derives a missing dark palette', () => {
    const d = tmp();
    const { dark: _d, ...noDark } = named('Sans sombre').colors;
    writeFileSync(join(d, 'themes.json'), JSON.stringify({ themes: [named('Ocean'), named('ocean'), { name: 'x' }, 7, { ...named('Sans sombre'), colors: noDark }] }));
    const r = readUserThemes(d);
    expect(r.map((t) => t.name)).toEqual(['Ocean', 'Sans sombre']);
    expect(r[1]!.colors.dark).toEqual(deriveDark(DEFAULT_THEME.colors.light));
  });
  it('write then read round-trips', () => {
    const d = tmp();
    writeUserThemes(d, [named('A'), named('B')]);
    expect(readUserThemes(d)).toEqual([named('A'), named('B')]);
  });
  it('save: trims, refuses built-in and bad names, asks for replace on collision; remove', () => {
    const d = tmp();
    saveUserTheme(d, named('  Ma charte '), false);
    expect(readUserThemes(d).map((t) => t.name)).toEqual(['Ma charte']);
    expect(() => saveUserTheme(d, named('ma CHARTE'), false)).toThrow('bc:themeExists');
    saveUserTheme(d, { ...named('ma CHARTE'), fonts: { name: 'F', major: 'Inter', minor: 'Inter' } }, true);
    expect(readUserThemes(d)).toHaveLength(1);
    expect(readUserThemes(d)[0]!.fonts.name).toBe('F');
    expect(() => saveUserTheme(d, named(BUILTIN_THEMES[1]!.name.toUpperCase()), false)).toThrow('bc:themeReserved');
    for (const bad of ['', '   ', 'a'.repeat(61), 'a\nb']) expect(() => saveUserTheme(d, named(bad), false)).toThrow('bc:invalidName');
    removeUserTheme(d, 'MA CHARTE');
    expect(readUserThemes(d)).toEqual([]);
  });
});
