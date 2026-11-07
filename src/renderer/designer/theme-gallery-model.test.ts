import { describe, expect, it } from 'vitest';
import { BUILTIN_THEMES, DEFAULT_THEME } from '../../shared/design/theme';
import type { DesignDoc } from '../../shared/design/model';
import { applyThemeToDoc, customNamed, sameTheme, themeSections } from './theme-gallery-model';

const doc = (props: Record<string, unknown> = {}): DesignDoc => ({ formatVersion: '1.0', recordSource: null, props, sections: [] });
const [base, slate, forest] = BUILTIN_THEMES;
const custom = { ...forest!, name: 'Mien' };

describe('themeSections', () => {
  it('current first and once, then custom, then the built-ins without the current one', () => {
    const e = themeSections(slate!, [custom], BUILTIN_THEMES);
    expect(e.map((x) => [x.section, x.theme.name])).toEqual([
      ['current', slate!.name], ['custom', 'Mien'], ...BUILTIN_THEMES.filter((t) => t !== slate).map((t) => ['builtin', t.name])]);
  });
  it('a custom theme equal to the current one is not repeated', () => {
    expect(themeSections(custom, [custom], BUILTIN_THEMES).filter((x) => x.theme.name === 'Mien')).toHaveLength(1);
  });
});

describe('keys and custom lookup', () => {
  it('every entry has a unique key, even a custom theme named like a built-in', () => {
    const e = themeSections(slate!, [{ ...forest!, name: BUILTIN_THEMES[3]!.name }], BUILTIN_THEMES);
    expect(new Set(e.map((x) => x.key)).size).toBe(e.length);
  });
  it('customNamed finds a user theme by name, ignoring case', () => {
    expect(customNamed([custom], { ...forest!, name: 'MIEN' })).toBe(custom);
    expect(customNamed([custom], slate!)).toBeUndefined();
  });
});

describe('applyThemeToDoc', () => {
  it('sets props.Theme, other props untouched', () => {
    const d = applyThemeToDoc(doc({ Width: 5 }), forest!);
    expect(d.props).toEqual({ Width: 5, Theme: forest });
  });
  it('same object when already equal', () => {
    const d = doc({ Theme: forest });
    expect(applyThemeToDoc(d, { ...forest! })).toBe(d);
  });
  it('sameTheme compares by value', () => {
    expect(sameTheme(base!, { ...DEFAULT_THEME })).toBe(true);
    expect(sameTheme(base!, slate!)).toBe(false);
  });
});
