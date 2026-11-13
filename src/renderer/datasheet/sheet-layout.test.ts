import { describe, expect, it } from 'vitest';
import { columnWidthPx, layoutSavable, rowHeightPx, storedPx, toTwips, withQuerySheet, withQueryWidths } from './sheet-layout';

describe('sheet-layout', () => {
  it('storedPx: integer twips > 0 to px, else undefined', () => {
    expect(storedPx(1500)).toBe(100);
    for (const v of [0, -1, 1.5, 'x', undefined, null]) expect(storedPx(v)).toBeUndefined();
  });
  it('rowHeightPx, columnWidthPx: the typed size in px, null when unreadable or out of range', () => {
    expect(rowHeightPx(22.5)).toBe(30);
    for (const v of [null, NaN, 8, 301]) expect(rowHeightPx(v)).toBeNull();
    expect(columnWidthPx(1500)).toBe(100);
    for (const v of [null, NaN, 299, 31681]) expect(columnWidthPx(v)).toBeNull();
  });
  it('toTwips: px x 15, rounded', () => {
    expect(toTwips({ A: 100, B: 10.4 })).toEqual({ A: 1500, B: 156 });
  });
  it('withQueryWidths keeps other keys, merges an existing columnWidths, replaces a non-object', () => {
    expect(withQueryWidths({ sql: 'x', columnWidths: { A: 300, B: 600 } }, { B: 100 })).toEqual({ sql: 'x', columnWidths: { A: 300, B: 1500 } });
    expect(withQueryWidths({ sql: 'x', columnWidths: 5 }, { A: 100 })).toEqual({ sql: 'x', columnWidths: { A: 1500 } });
    expect(withQueryWidths({ sql: 'x', columnWidths: [1] }, { A: 100 })).toEqual({ sql: 'x', columnWidths: { A: 1500 } });
  });
  it('withQuerySheet: replaces the stored layout, an empty one removes it, the rest of the definition stays', () => {
    const def = { sql: 'SELECT 1', columnWidths: { A: 1500 }, sheetLayout: { rowHeight: 40 } };
    expect(withQuerySheet(def, { totals: true })).toEqual({ sql: 'SELECT 1', columnWidths: { A: 1500 }, sheetLayout: { totals: true } });
    expect(withQuerySheet(def, {})).toEqual({ sql: 'SELECT 1', columnWidths: { A: 1500 } });
  });
  it('layoutSavable: false for a link, a sql source, a pass-through query, read-only', () => {
    const ok = { kind: 'table' as const, link: false, passThrough: false, readOnly: false, runtime: false };
    expect(layoutSavable(ok)).toBe(true);
    expect(layoutSavable({ ...ok, kind: 'query', source: { kind: 'query' } })).toBe(true);
    expect(layoutSavable({ ...ok, link: true })).toBe(false);
    expect(layoutSavable({ ...ok, kind: 'query', source: { kind: 'sql' } })).toBe(false);
    expect(layoutSavable({ ...ok, passThrough: true })).toBe(false);
    expect(layoutSavable({ ...ok, readOnly: true })).toBe(false);
    expect(layoutSavable({ ...ok, runtime: true })).toBe(false);
  });
});
