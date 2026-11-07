import i18next from 'i18next';
import { describe, expect, it } from 'vitest';
import fr from '../../shared/i18n/fr.json';
import { DEFAULT_THEME, variantsFor } from '../../shared/design/theme';
import { colorLabel, pickerModel, pushRecent, STANDARD_COLORS } from './color-picker-model';

const i18n = i18next.createInstance();
void i18n.init({ resources: { fr: { translation: fr } }, lng: 'fr', interpolation: { escapeValue: false }, initAsync: false });
const t = i18n.t.bind(i18n);

describe('pickerModel', () => {
  it('10 colonnes dans l\'ordre de l\'étude, 5 nuances égales à variantsFor', () => {
    const m = pickerModel(DEFAULT_THEME, 'light');
    expect(m.map((c) => c.slot)).toEqual(['lt1', 'dk1', 'lt2', 'dk2', 'accent1', 'accent2', 'accent3', 'accent4', 'accent5', 'accent6']);
    for (const c of m) {
      expect(c.base).toBe(DEFAULT_THEME.colors.light[c.slot]);
      expect(c.variants).toHaveLength(5);
      expect(c.variants.map((v) => ({ mode: v.mode, pct: v.pct }))).toEqual(variantsFor(c.base));
    }
    expect(m[4]!.variants[0]!.value).toMatch(/^theme:accent1@[+-]\d+$/);
  });
  it('le mode sombre prend la palette sombre', () => {
    const m = pickerModel(DEFAULT_THEME, 'dark');
    expect(m[0]!.base).toBe(DEFAULT_THEME.colors.dark.lt1);
    expect(m[0]!.base).not.toBe(DEFAULT_THEME.colors.light.lt1);
  });
});

describe('pushRecent / STANDARD_COLORS', () => {
  it('le plus récent d\'abord, sans doublon, 10 au plus', () => {
    expect(pushRecent(['#111111', '#222222'], '#222222')).toEqual(['#222222', '#111111']);
    const many = Array.from({ length: 10 }, (_, i) => `#00000${i}` as const);
    const r = pushRecent(many, '#ffffff');
    expect(r).toHaveLength(10);
    expect(r[0]).toBe('#ffffff');
  });
  it('dix couleurs standard', () => expect(STANDARD_COLORS).toHaveLength(10));
});

describe('colorLabel', () => {
  it('libellés Access', () => {
    expect(colorLabel('theme:accent2@+80', t)).toBe('Accent 2, Plus clair 80%');
    expect(colorLabel('theme:lt1@-35', t)).toBe('Arrière-plan 1, Plus sombre 35%');
    expect(colorLabel('theme:dk2@+90', t)).toBe('Texte 2, Plus clair 90%');
    expect(colorLabel('theme:dk1', t)).toBe('Texte 1');
    expect(colorLabel('theme:accent', t)).toBe('Accent');
    expect(colorLabel('#ff0000', t)).toBe('#ff0000');
  });
});
