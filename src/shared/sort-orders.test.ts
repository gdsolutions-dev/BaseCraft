import { describe, expect, it } from 'vitest';
import { isSortOrder, SORT_ORDERS, sortKey, type SortOrderId } from './sort-orders';

/** The texts in the order of their keys; equal keys are broken as ORDER BY does (bc_gkey: NFC, lower case). */
const sorted = (order: SortOrderId, ...texts: string[]) => {
  const k = sortKey(order);
  const g = (s: string) => s.normalize('NFC').toLowerCase();
  return [...texts].sort((a, b) => (k(a) < k(b) ? -1 : k(a) > k(b) ? 1 : g(a) < g(b) ? -1 : g(a) > g(b) ? 1 : 0));
};

describe('sort orders', () => {
  it('knows its ids', () => {
    expect(SORT_ORDERS.slice(0, 2)).toEqual(['legacy', 'general']);
    expect(isSortOrder('swedish')).toBe(true);
    expect(isSortOrder('klingon')).toBe(false);
    expect(isSortOrder(null)).toBe(false);
  });
  it('legacy folds case and accents and puts ligatures and ß after z (what BaseCraft always did)', () => {
    expect(sorted('legacy', 'zèbre', 'Eté', 'ete', 'ŒUF', 'straße', 'strasse')).toEqual(['ete', 'Eté', 'strasse', 'straße', 'zèbre', 'ŒUF']);
  });
  it('general ignores case and ranks an accent as its letter, ligatures and ß expanded', () => {
    const k = sortKey('general');
    expect(k('Été')).toBe(k('ete'));
    expect(sorted('general', 'zèbre', 'Eté', 'ete', 'ŒUF', 'oeuf', 'straße', 'strasse', 'oz')).toEqual(['ete', 'Eté', 'oeuf', 'ŒUF', 'oz', 'strasse', 'straße', 'zèbre']);
  });
  it('general reads text character by character: numbers in text are not values, spaces and punctuation come first', () => {
    expect(sorted('general', 'a10', 'a2', 'a 1', 'a-1', 'b', 'A1')).toEqual(['a 1', 'a-1', 'A1', 'a10', 'a2', 'b']);
  });
  it('general NFD and NFC give the same key', () => {
    expect(sortKey('general')('été')).toBe(sortKey('general')('été'));
  });
  it('language orders rank their own letters', () => {
    expect(sorted('swedish', 'zebra', 'ägg', 'apa', 'öl', 'åker')).toEqual(['apa', 'zebra', 'åker', 'ägg', 'öl']);
    expect(sorted('general', 'zebra', 'ägg', 'apa', 'öl', 'åker')).toEqual(['ägg', 'åker', 'apa', 'öl', 'zebra']);
    expect(sorted('spanish', 'oso', 'ñu', 'nube', 'pato')).toEqual(['nube', 'ñu', 'oso', 'pato']);
    expect(sorted('danish', 'aal', 'zoo', 'æble', 'øl')).toEqual(['zoo', 'æble', 'øl', 'aal']); // "aa" is å (a contraction)
    expect(sorted('turkish', 'iş', 'ıs', 'is')).toEqual(['ıs', 'is', 'iş']);
  });
  it('traditional Spanish ranks ch after c and ll after l; modern Spanish does not', () => {
    expect(sorted('spanishTraditional', 'dama', 'chico', 'cosa')).toEqual(['cosa', 'chico', 'dama']);
    expect(sorted('spanishTraditional', 'mapa', 'llama', 'luz')).toEqual(['luz', 'llama', 'mapa']);
    expect(sorted('spanishTraditional', 'oso', 'ñu', 'nube')).toEqual(['nube', 'ñu', 'oso']);
    expect(sorted('spanish', 'dama', 'chico', 'cosa')).toEqual(['chico', 'cosa', 'dama']);
    expect(sorted('general', 'mapa', 'llama', 'luz')).toEqual(['llama', 'luz', 'mapa']);
  });
  it('keeps what no table knows (astral characters) and drops stray marks', () => {
    const k = sortKey('general');
    expect(k('a😀')).toBe(`${k('a')}😀`);
    expect(k('à̀')).toBe(k('à')); // two marks on a letter: composed once, the second dropped
  });
  it('every order builds and sorts', () => {
    for (const id of SORT_ORDERS) expect(sorted(id, 'b', 'a')).toEqual(['a', 'b']);
  });
});
