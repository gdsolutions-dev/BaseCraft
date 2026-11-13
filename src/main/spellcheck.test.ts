import { expect, it } from 'vitest';
import { pickSpellLanguage } from './spellcheck';

const AVAILABLE = ['de', 'en-AU', 'en-GB', 'en-US', 'es', 'es-419', 'fr', 'pt-BR', 'pt-PT'];
it('picks the region, else the language default, else nothing', () => {
  expect(pickSpellLanguage(AVAILABLE, 'fr', 'fr-FR')).toBe('fr');
  expect(pickSpellLanguage(AVAILABLE, 'en', 'en-GB')).toBe('en-GB');
  expect(pickSpellLanguage(AVAILABLE, 'en', 'fr-FR')).toBe('en-US');
  expect(pickSpellLanguage(AVAILABLE, 'pt', 'pt-PT')).toBe('pt-PT');
  expect(pickSpellLanguage(AVAILABLE, 'pt', 'en-US')).toBe('pt-BR');
  expect(pickSpellLanguage(AVAILABLE, 'ja', 'ja-JP')).toBeNull();
});
