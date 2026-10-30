import { describe, it, expect } from 'vitest';
import { catalogs } from './catalogs';
import { flattenKeys, formulaLang, resolveUiLanguage, UI_LANGUAGES, type UiLanguage } from './index';
import type { RelationResult } from '../api';

const get = (o: any, k: string) => k.split('.').reduce((a, p) => a?.[p], o);
const PLURAL = /_(zero|one|two|few|many|other)$/;
const base = (k: string) => k.replace(PLURAL, '');
const keys = (l: UiLanguage) => flattenKeys(catalogs[l]);
/** What i18next needs per language: its CLDR plural categories, except `many`, which in es/fr/it/pt only counts millions and falls back to the bare key. */
const required = (l: UiLanguage) => new Intl.PluralRules(l).resolvedOptions().pluralCategories.filter((c) => c !== 'many' || l === 'pl');
/** A plural form is there as its suffixed key, or (`other` only) as the bare key. */
const hasForm = (l: UiLanguage, b: string, cat: string) => get(catalogs[l], `${b}_${cat}`) !== undefined || (cat === 'other' && get(catalogs[l], b) !== undefined);
const placeholders = (s: unknown) => [...new Set(String(s).match(/\{\{\w+\}\}/g) ?? [])].filter((p) => p !== '{{count}}').sort();

describe('i18n', () => {
  it.each(UI_LANGUAGES)('%s: same keys as English, plural suffixes aside', (l) => {
    expect([...new Set(keys(l).map(base))].sort()).toEqual([...new Set(keys('en').map(base))].sort());
  });
  it.each(UI_LANGUAGES)('%s: every plural group has the forms of the language', (l) => {
    const groups = new Set(keys('en').filter((k) => PLURAL.test(k)).map(base));
    for (const b of groups) for (const c of required(l)) expect(hasForm(l, b, c), `${b}_${c}`).toBe(true);
  });
  it.each(UI_LANGUAGES)('%s: no empty translation, no placeholder lost or invented', (l) => {
    const en = keys('en');
    for (const k of keys(l)) {
      const v = get(catalogs[l], k);
      expect(v, k).not.toBe('');
      if (typeof v !== 'string') continue;
      const same = en.filter((e) => base(e) === base(k)).map((e) => placeholders(get(catalogs.en, e)).join());
      expect(same, k).toContain(placeholders(v).join()); // a plural variant may drop what only another variant carries
    }
  });
  it('every refusal of a relation save has its text (Relations window)', () => {
    // exhaustive by type: a new reason fails the typecheck until it is listed here; `plural` ones carry the language's plural forms
    const reasons: Record<Exclude<RelationResult, { ok: true }>['reason'], boolean> = {
      fieldsMismatch: false, typesMismatch: false, parentNotUnique: false, readOnly: false, nameExists: false, nameInvalid: false,
      sameTable: false, external: false, duplicate: false, violations: true,
    };
    for (const l of UI_LANGUAGES) {
      for (const [reason, plural] of Object.entries(reasons)) {
        const b = `relations.error.${reason}`;
        if (plural) for (const c of required(l)) expect(hasForm(l, b, c), `${l} ${b}_${c}`).toBe(true);
        else expect(get(catalogs[l], b), `${l} ${b}`).toBeTruthy();
      }
    }
  });
  it('resolves UI language', () => {
    expect(resolveUiLanguage('system', 'fr-CA')).toBe('fr');
    expect(resolveUiLanguage('system', 'de-DE')).toBe('de');
    expect(resolveUiLanguage('system', 'pt_BR')).toBe('pt');
    expect(resolveUiLanguage('system', 'zh-CN')).toBe('zh');
    expect(resolveUiLanguage('system', 'sv-SE')).toBe('en');
    expect(resolveUiLanguage('en', 'fr-FR')).toBe('en');
    expect(resolveUiLanguage('ja', 'fr-FR')).toBe('ja');
  });
  it('formulas stay French or English', () => {
    expect(formulaLang('fr')).toBe('fr');
    for (const l of UI_LANGUAGES.filter((x) => x !== 'fr')) expect(formulaLang(l)).toBe('en');
  });
});
