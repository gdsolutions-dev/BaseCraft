import { CompactSelection, type GridSelection } from '@glideapps/glide-data-grid';
import { describe, expect, it } from 'vitest';
import { columnOrder, mapSelection, orderedNames } from './column-order';

const names = ['Id', 'Nom', 'Ville', 'Solde'];
const cell = (col: number, row: number, width = 1): GridSelection =>
  ({ columns: CompactSelection.empty(), rows: CompactSelection.empty(), current: { cell: [col, row], range: { x: col, y: row, width, height: 1 }, rangeStack: [] } });

describe('column-order', () => {
  it('columnOrder: frozen first in their order, hidden left out, unknown names ignored', () => {
    expect(columnOrder(names, new Set(), [])).toEqual({ order: [0, 1, 2, 3], frozen: 0 });
    expect(columnOrder(names, new Set(['Nom']), [])).toEqual({ order: [0, 2, 3], frozen: 0 });
    expect(columnOrder(names, new Set(), ['Solde', 'Nom'])).toEqual({ order: [3, 1, 0, 2], frozen: 2 });
    expect(columnOrder(names, new Set(['Solde', 'Gone']), ['Solde', 'Gone', 'Ville'])).toEqual({ order: [2, 0, 1], frozen: 1 });
  });
  it('a display order is kept by Unfreeze: the formerly frozen fields stay first', () => {
    expect(orderedNames(names, ['Solde', 'Gone', 'Nom', 'Solde'])).toEqual(['Solde', 'Nom', 'Id', 'Ville']);
    expect(columnOrder(names, new Set(), [], ['Solde', 'Nom'])).toEqual({ order: [3, 1, 0, 2], frozen: 0 });
    expect(columnOrder(names, new Set(['Nom']), ['Ville'], ['Solde', 'Nom'])).toEqual({ order: [2, 3, 0], frozen: 1 });
  });
  it('mapSelection: grid to field and back gives the same selection', () => {
    const { order } = columnOrder(names, new Set(['Nom']), ['Solde']); // grid: Solde, Id, Ville
    const toField = (s: GridSelection) => mapSelection(s, (c) => order[c]);
    const toGrid = (s: GridSelection) => mapSelection(s, (c) => order.indexOf(c));
    const field = toField(cell(2, 5, 1));
    expect(field.current!.cell).toEqual([2, 5]);
    expect(toField(cell(0, 1)).current!.cell).toEqual([3, 1]);
    expect(toGrid(field).current).toEqual(cell(2, 5).current);
    expect(toGrid(toField(cell(0, 4, 3))).current).toEqual(cell(0, 4, 3).current);
    const cols = toField({ columns: CompactSelection.fromSingleSelection([0, 2]), rows: CompactSelection.empty() });
    expect(cols.columns.toArray().sort()).toEqual([0, 3]);
  });
  it('mapSelection: a cell of a hidden field is dropped', () => {
    const { order } = columnOrder(names, new Set(['Nom']), []);
    expect(mapSelection(cell(1, 0), (c) => order.indexOf(c)).current).toBeUndefined();
  });
});
