import { describe, it, expect } from 'vitest';
import fr from './fr.json';
import en from './en.json';
import { flattenKeys, resolveUiLanguage } from './index';
import type { RelationResult } from '../api';

const get = (o: any, k: string) => k.split('.').reduce((a, p) => a[p], o);

describe('i18n', () => {
  it('catalogs have identical keys', () => expect(flattenKeys(fr).sort()).toEqual(flattenKeys(en).sort()));
  it('no empty translation', () => [fr, en].forEach((c) => flattenKeys(c).forEach((k) => expect(get(c, k)).not.toBe(''))));
  it('every refusal of a relation save has its text (Relations window)', () => {
    // exhaustive by type: a new reason fails the typecheck until it is listed here, with its plural forms
    const forms: Record<Exclude<RelationResult, { ok: true }>['reason'], string[]> = {
      fieldsMismatch: [''], typesMismatch: [''], parentNotUnique: [''], readOnly: [''], nameExists: [''], nameInvalid: [''],
      sameTable: [''], external: [''], duplicate: [''], violations: ['_one', '_other'],
    };
    for (const c of [fr, en]) {
      for (const [reason, sfx] of Object.entries(forms)) for (const x of sfx) expect(get(c, `relations.error.${reason}${x}`), reason).toBeTruthy();
    }
  });
  it('resolves UI language', () => {
    expect(resolveUiLanguage('system', 'fr-CA')).toBe('fr');
    expect(resolveUiLanguage('system', 'de-DE')).toBe('en');
    expect(resolveUiLanguage('en', 'fr-FR')).toBe('en');
  });
});
