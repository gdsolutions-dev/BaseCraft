import { describe, expect, it, vi } from 'vitest';
import { MAX_CRITERIA_CHARS } from '../../shared/api';
import type { SqlValue } from '../../shared/coerce';
import { compareText } from '../../shared/expr/library';
import { parseCanonical } from '../../shared/expr/parser';
import type { FieldDef } from '../../shared/field-types';
import { f } from '../../shared/test-fixtures';
import { activeFilter, filterValues, listCriteria, selectionCriteria, valueKey, valuesCriteria, withCriteria, type FilterState } from './filter-model';

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

describe('filter lists (brief)', () => {
  const reader = (rows: SqlValue[][]) => async (o: number, l: number) => ({ rows: rows.slice(o, o + l), total: rows.length });
  it('non-indexed: no list past the limit, nothing read but the count', async () => {
    const read = vi.fn(reader([['a'], ['b'], ['c']]));
    expect(await filterValues(read, 0, { indexed: false, local: true, listIndexed: true, listNonIndexed: true, max: 2 })).toBeNull();
    expect(read).toHaveBeenCalledWith(0, 0);
  });
  it('indexed: distinct values up to the limit, case folded, blanks kept', async () => {
    expect(await filterValues(reader([[null], ['Lyon'], ['lyon'], ['Paris'], ['Paris']]), 0, { indexed: true, local: true, listIndexed: true, listNonIndexed: false, max: 3 }))
      .toEqual([null, 'Lyon', 'Paris']);
    expect(await filterValues(reader([['a'], ['b'], ['c'], ['d']]), 0, { indexed: true, local: true, listIndexed: true, listNonIndexed: true, max: 3 })).toBeNull();
  });
  it('no list where the option is off or the field is a server one', async () => {
    for (const rule of [{ indexed: true, listIndexed: false }, { indexed: false, listNonIndexed: false }, { local: false }])
      expect(await filterValues(reader([['a']]), 0, { indexed: true, local: true, listIndexed: true, listNonIndexed: true, max: 1000, ...rule })).toBeNull();
  });
  it('valuesCriteria quotes what it must', () => {
    const text = { name: 'Nom', props: { type: 'shortText' } } as FieldDef;
    expect(valuesCriteria(text, ["O'Brien", 'say "hi"'], true)).toBe(`${selectionCriteria('equals', text, "O'Brien")} Or ${selectionCriteria('equals', text, 'say "hi"')} Or Is Null Or = ""`);
  });
});

describe('filter lists (extra)', () => {
  const rule = { indexed: false, local: true, listIndexed: true, listNonIndexed: true, max: 1000 };
  const reader = (rows: SqlValue[][]) => async (o: number, l: number) => ({ rows: rows.slice(o, o + l), total: rows.length });
  it('the column asked, accents kept, numbers apart from texts, a BLOB left out, read in pages', async () => {
    const rows: SqlValue[][] = [[1, 'É'], [2, 'é'], [3, 'e'], [4, 'E'], [5, '1'], [1, new Uint8Array([1]) as unknown as SqlValue]];
    expect(await filterValues(reader(rows), 1, rule)).toEqual(['É', 'e', '1']);
    expect(await filterValues(reader(rows), 0, rule)).toEqual([1, 2, 3, 4, 5]);
    const many = Array.from({ length: 2500 }, (_, i) => [i % 7]);
    const read = vi.fn(reader(many));
    expect(await filterValues(read, 0, { ...rule, max: 3000 })).toEqual([0, 1, 2, 3, 4, 5, 6]);
    expect(read.mock.calls.every(([, l]) => l <= 1000)).toBe(true);
  });
  it('values the comparison finds equal are one entry (kana, width, ligature, sigma); a zero-length string is a blank', async () => {
    const same = [['ア', 'あ', 'ｱ'], ['a', 'Ａ'], ['fi', 'ﬁ'], ['σ', 'ς']];
    for (const g of same) { expect(new Set(g.map(valueKey)).size, g.join()).toBe(1); expect(compareText(g[0], g[1]), g.join()).toBe(0); }
    expect(valueKey('ß')).not.toBe(valueKey('ss'));
    expect(await filterValues(reader([['ア'], ['あ'], [''], [null], ['x']]), 0, rule)).toEqual(['ア', null, 'x']);
  });
  it('a limit of 0: a list only for no records; a read that stops early ends the list', async () => {
    expect(await filterValues(reader([]), 0, { ...rule, max: 0 })).toEqual([]);
    expect(await filterValues(reader([['a']]), 0, { ...rule, max: 0 })).toBeNull();
    expect(await filterValues(async (o) => ({ rows: o ? [] : [['a']], total: 5 }), 0, rule)).toEqual(['a']);
  });
  const text = f('Nom', 'shortText');
  it('every hard value reads back as a criterion, alone or together', () => {
    const hard: SqlValue[] = ["O'Brien", 'say "hi"', '50*', '#1', '[a', 'a Or b', ''];
    for (const v of hard) expect(() => parseCanonical(valuesCriteria(text, [v], false), { criteria: true }), String(v)).not.toThrow();
    expect(() => parseCanonical(valuesCriteria(text, hard, true), { criteria: true })).not.toThrow();
    expect(valuesCriteria(f('Le', 'dateTime'), ['2026-10-21 00:00:00'], false)).toBe('#2026-10-21#');
    expect(valuesCriteria(f('X', 'number', { numberSize: 'double' }), [12.5, -3], false)).toBe('12.5 Or -3');
    expect(valuesCriteria(text, [], true)).toBe('Is Null Or = ""'); // blanks of a text: Null and the zero-length string
    expect(valuesCriteria(f('N', 'number', { numberSize: 'double' }), [], true)).toBe('Is Null');
  });
  it('listCriteria: null when all are ticked, the ticked values, or past the length limit those left out', () => {
    const list: SqlValue[] = [null, 'Lyon', 'Paris'];
    expect(listCriteria(text, list, list)).toBeNull();
    expect(listCriteria(text, list, [null, 'Lyon'])).toEqual({ criteria: '"Lyon" Or Is Null Or = ""', values: [null, 'Lyon'], not: false });
    const long = Array.from({ length: 400 }, (_, i) => `ville ${i}`);
    // past the criterion limit, the values left out are sent instead
    const huge = Array.from({ length: 12_000 }, (_, i) => `valeur numéro ${i}`);
    const out = listCriteria(text, [null, ...huge], [null, ...huge.slice(1)])!;
    expect(out).toEqual({ criteria: '<> "valeur numéro 0" Or Is Null', values: ['valeur numéro 0'], not: true });
    expect(listCriteria(text, huge, huge.slice(2))!.criteria).toBe('<> "valeur numéro 0" And <> "valeur numéro 1"');
    expect(listCriteria(text, [null, ...huge], huge)!.criteria).toBe('<> ""');
    for (const c of [out.criteria, '<> "valeur numéro 0" And <> "valeur numéro 1"']) expect(() => parseCanonical(c, { criteria: true })).not.toThrow();
    // 400 values, 200 ticked: the ticked form fits the criterion limit (65 536)
    const some = listCriteria(text, long, long.slice(0, 200))!;
    expect(some.not).toBe(false);
    expect(some.criteria.length).toBeGreaterThan(2000);
    expect(some.criteria.length).toBeLessThan(MAX_CRITERIA_CHARS);
    // both forms past the limit: the caller shows its message
    expect(listCriteria(text, huge, huge.slice(0, 6000))!.criteria.length).toBeGreaterThan(MAX_CRITERIA_CHARS);
    // blanks unticked on a text: the zero-length string is left out with Null
    expect(listCriteria(text, [null, 'a', 'b'], ['a'])!.criteria).toBe('"a"');
    expect(listCriteria(text, [null, 'a', 'b'], [null, 'a'])!.criteria).toBe('"a" Or Is Null Or = ""');
  });
});
