import { describe, expect, it } from 'vitest';
import { parseCanonical } from '../../shared/expr/parser';
import { f } from '../../shared/test-fixtures';
import { activeFilter, selectionCriteria, withCriteria, type FilterState } from './filter-model';

describe('selectionCriteria (brief)', () => {
  it('selection criteria', () => {
    expect(selectionCriteria('equals', f('Ville', 'shortText'), 'Lyon')).toBe('"Lyon"');
    expect(selectionCriteria('contains', f('Nom', 'shortText'), 'du')).toBe('Like "*du*"');
    expect(selectionCriteria('equals', f('Le', 'dateTime'), '2026-10-21 00:00:00')).toBe('#2026-10-21#');
    expect(selectionCriteria('equals', f('Nom', 'shortText'), null)).toBe('Is Null');
    expect(selectionCriteria('contains', f('Nom', 'shortText'), 'a*')).toBe('Like "*a[*]*"');
  });
});

describe('selectionCriteria (extra)', () => {
  it('the other kinds', () => {
    expect(selectionCriteria('notEquals', f('Ville', 'shortText'), 'Lyon')).toBe('<> "Lyon"');
    expect(selectionCriteria('notContains', f('Nom', 'shortText'), 'du')).toBe('Not Like "*du*"');
    expect(selectionCriteria('notEquals', f('Nom', 'shortText'), null)).toBe('Is Not Null');
    expect(selectionCriteria('notContains', f('Nom', 'shortText'), null)).toBe('Is Not Null');
  });
  it('every Like wildcard and quotes are escaped', () => {
    expect(selectionCriteria('contains', f('Nom', 'shortText'), 'a?#[b]"c')).toBe('Like "*a[?][#][[]b]""c*"');
    expect(selectionCriteria('equals', f('Nom', 'shortText'), 'say "hi"')).toBe('"say ""hi"""');
  });
  it('stored values of each type, as literals', () => {
    expect(selectionCriteria('equals', f('Solde', 'currency'), 1500.25)).toBe('1500.25');
    expect(selectionCriteria('equals', f('N', 'number'), -3)).toBe('-3');
    expect(selectionCriteria('notEquals', f('N', 'number', { numberSize: 'double' }), 1e-7)).toBe('<> 0.0000001');
    expect(selectionCriteria('equals', f('N', 'number', { numberSize: 'double' }), 0.1)).toBe('0.1');
    expect(selectionCriteria('equals', f('N', 'number', { numberSize: 'double' }), 1e21)).toBe('1000000000000000000000');
    expect(selectionCriteria('equals', f('D', 'number', { numberSize: 'decimal', precision: 6, scale: 2 }), '-0.50')).toBe('-0.5');
    expect(selectionCriteria('equals', f('D', 'number', { numberSize: 'decimal', precision: 6, scale: 2 }), '3.00')).toBe('3');
    expect(selectionCriteria('equals', f('D', 'number', { numberSize: 'decimal', precision: 6, scale: 2 }), '12.50')).toBe('12.5');
    expect(selectionCriteria('equals', f('Id', 'autoNumber'), 7)).toBe('7');
    expect(selectionCriteria('equals', f('Ok', 'yesNo'), 1)).toBe('True');
    expect(selectionCriteria('equals', f('Ok', 'yesNo'), 0)).toBe('False');
    expect(selectionCriteria('equals', f('Le', 'dateTime'), '2026-10-21 13:05:00')).toBe('#2026-10-21 13:05:00#');
    expect(selectionCriteria('equals', f('Le', 'dateTime'), '2026-10-21')).toBe('#2026-10-21#'); // written by another tool
  });
  it('a value another tool stored in the wrong class is compared as it is', () => {
    expect(selectionCriteria('equals', f('Le', 'dateTime'), 'hier')).toBe('"hier"');
    expect(selectionCriteria('equals', f('N', 'number'), 'abc')).toBe('"abc"');
    expect(selectionCriteria('equals', f('Txt', 'shortText'), 12)).toBe('12');
  });
  it('a BLOB another tool stored cannot be filtered on: a typed refusal', () => {
    for (const k of ['equals', 'notEquals', 'contains', 'notContains'] as const) {
      expect(() => selectionCriteria(k, f('T', 'shortText'), new Uint8Array([1, 2]) as unknown as string)).toThrow(/bc:unsupportedValue/);
    }
  });
  it('every result reads back as a criterion', () => {
    for (const v of ["O'Brien", '50%', 'a;b', '[x]', '"']) {
      for (const k of ['equals', 'notEquals', 'contains', 'notContains'] as const) expect(() => parseCanonical(selectionCriteria(k, f('T', 'shortText'), v), { criteria: true })).not.toThrow();
    }
  });
});

describe('filter state', () => {
  const s: FilterState = { items: [{ field: 'Ville', criteria: '"Lyon"' }], applied: null, active: true };
  it('a field has one criterion: set replaces it (name case ignored), empty removes it, the filter turns on', () => {
    expect(withCriteria({ ...s, active: false }, 'ville', '"Paris"')).toEqual({ items: [{ field: 'ville', criteria: '"Paris"' }], applied: null, active: true });
    expect(withCriteria(s, 'Solde', '>1000')).toEqual({ items: [...s.items, { field: 'Solde', criteria: '>1000' }], applied: null, active: true });
    expect(withCriteria(s, 'Ville', '')).toEqual({ items: [], applied: null, active: false });
    expect(withCriteria({ ...s, applied: '[N°] > 1' }, 'Ville', '')).toEqual({ items: [], applied: '[N°] > 1', active: true });   // R14: ApplyFilter's stays
  });
  it('at most 20 fields', () => {
    let x: FilterState = { items: [], applied: null, active: false };
    for (let i = 0; i < 20; i++) x = withCriteria(x, `F${i}`, '1');
    expect(() => withCriteria(x, 'F20', '1')).toThrow(/bc:tooManyFilters/);
    expect(withCriteria(x, 'F3', '2').items).toHaveLength(20);
  });
  it('the filter sent: only when active', () => {
    expect(activeFilter(s)).toEqual(s.items);
    expect(activeFilter({ ...s, active: false })).toBeUndefined();
    expect(activeFilter({ items: [], applied: null, active: true })).toBeUndefined();
  });
});
