import { describe, expect, it } from 'vitest';
import { findCommands, findDefaults, goToRow, matchText, replaceText } from './find-commands';

describe('goToRow', () => {
  it('moves within the saved records', () => {
    expect(goToRow('first', 4, 10)).toBe(0);
    expect(goToRow('last', 4, 10)).toBe(9);
    expect(goToRow('next', 9, 10)).toBe(9);
    expect(goToRow('previous', 0, 10)).toBe(0);
    expect(goToRow('next', null, 10)).toBe(1);
    expect(goToRow('previous', 5, 10)).toBe(4);
  });
  it('new record always; nothing to go to in an empty table', () => {
    expect(goToRow('new', 3, 10)).toBe('new');
    expect(goToRow('last', null, 0)).toBeNull();
    expect(goToRow('new', null, 0)).toBe('new');
  });
});

describe('Find dialog (O2 R10)', () => {
  it('findDefaults', () => {
    expect(findDefaults('fast')).toEqual({ onlyCurrentField: true, match: 'whole' });
    expect(findDefaults('general')).toEqual({ onlyCurrentField: false, match: 'anywhere' });
    expect(findDefaults('startOfField')).toEqual({ onlyCurrentField: true, match: 'start' });
  });
  it('matchText', () => {
    expect(matchText('Dupont', 'dup', 'start', false, 'fr-FR')).toBe(true);
    expect(matchText('Dupont', 'dup', 'whole', false, 'fr-FR')).toBe(false);
    expect(matchText('Dupont', 'Pon', 'anywhere', true, 'fr-FR')).toBe(false);
    expect(matchText('Élodie', 'élodie', 'whole', false, 'fr-FR')).toBe(true);
    expect(matchText("O'Brien", "o'b", 'start', false, 'fr-FR')).toBe(true);
  });
  it('matchText: case ignored without Match Case, accents always kept (B2 R13, as FindRecord)', () => {
    expect(matchText('Élodie', 'elodie', 'whole', false, 'fr-FR')).toBe(false);
    expect(matchText('Lyôn', 'lyon', 'whole', false, 'fr-FR')).toBe(false);
    expect(matchText('LYÔN', 'lyôn', 'whole', false, 'fr-FR')).toBe(true);
    expect(matchText('Élodie', 'Elodie', 'whole', true, 'fr-FR')).toBe(false);
    expect(matchText('Lyon', 'Lyon', 'whole', true, 'fr-FR')).toBe(true);
    expect(matchText('1 200,00 €', '200', 'anywhere', false, 'fr-FR')).toBe(true);
    expect(matchText('Lyon', 'yo', 'start', false, 'fr-FR')).toBe(false);
  });
  it('matchText: the no-break spaces of the region (grouping, currency) match a typed space', () => {
    expect(matchText('1\u202f200,00\u00a0€', '1 200,00 €', 'whole', false, 'fr-FR')).toBe(true);
    expect(matchText('1\u202f200,00\u00a0€', '1 200,00 €', 'whole', true, 'fr-FR')).toBe(true);
  });
});

describe('Replace (Find dialog, Replace tab)', () => {
  it('replaceText: whole field, start, any part (first or every occurrence)', () => {
    expect(replaceText('Dupont', { what: 'dup', match: 'whole', matchCase: false }, 'Martin', false)).toBe('Martin');
    expect(replaceText('Dupont Dupont', { what: 'dup', match: 'start', matchCase: false }, 'X', true)).toBe('Xont Dupont');
    expect(replaceText('Dupont Dupont', { what: 'dup', match: 'anywhere', matchCase: false }, 'X', false)).toBe('Xont Dupont');
    expect(replaceText('Dupont Dupont', { what: 'dup', match: 'anywhere', matchCase: false }, 'X', true)).toBe('Xont Xont');
    expect(replaceText('a.b a.b', { what: 'a.b', match: 'anywhere', matchCase: true }, 'c', true)).toBe('c c');
    expect(replaceText('aXb', { what: 'a.b', match: 'anywhere', matchCase: true }, 'c', true)).toBe('aXb');
    expect(replaceText('$1 x', { what: '$1', match: 'anywhere', matchCase: true }, '$&', false)).toBe('$& x');
  });
  it('findCommands opens the dialog on the Find or the Replace tab', () => {
    const tabs: string[] = [];
    const h = findCommands({ openFind: (tab) => tabs.push(tab), openMenu: () => {} });
    h.find!(undefined as never); h.replace!(undefined as never);
    expect(tabs).toEqual(['find', 'replace']);
  });
});
