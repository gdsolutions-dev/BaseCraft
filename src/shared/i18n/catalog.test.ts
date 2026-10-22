import { describe, it, expect } from 'vitest';
import fr from './fr.json';
import en from './en.json';
import { flattenKeys, resolveUiLanguage } from './index';

const get = (o: any, k: string) => k.split('.').reduce((a, p) => a[p], o);

describe('i18n', () => {
  it('catalogs have identical keys', () => expect(flattenKeys(fr).sort()).toEqual(flattenKeys(en).sort()));
  it('no empty translation', () => [fr, en].forEach((c) => flattenKeys(c).forEach((k) => expect(get(c, k)).not.toBe(''))));
  it('resolves UI language', () => {
    expect(resolveUiLanguage('system', 'fr-CA')).toBe('fr');
    expect(resolveUiLanguage('system', 'de-DE')).toBe('en');
    expect(resolveUiLanguage('en', 'fr-FR')).toBe('en');
  });
});
