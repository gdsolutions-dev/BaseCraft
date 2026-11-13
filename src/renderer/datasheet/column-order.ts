// Hidden and frozen columns of a datasheet (Home › Records › More). The view works in field indexes; the grid shows only some
// fields, the frozen ones first: `order` gives the field of each grid column, and the selection is translated both ways where
// the view meets the grid.
import { CompactSelection, type GridSelection } from '@glideapps/glide-data-grid';

export interface ColumnOrder { /** field index of each grid column */ order: number[]; /** grid columns frozen at the left */ frozen: number }

/** The fields in the display order `order` (Freeze fixes it, Unfreeze leaves it); fields it does not name follow, in the table's order. */
export function orderedNames(names: readonly string[], order: readonly string[]): string[] {
  const first = order.filter((n, i) => names.includes(n) && order.indexOf(n) === i);
  return [...first, ...names.filter((n) => !first.includes(n))];
}

/** The frozen fields first (in the order they were frozen), then the others in the display order (the table's by default);
 *  hidden ones left out. Names that are no longer fields are ignored. */
export function columnOrder(names: readonly string[], hidden: ReadonlySet<string>, frozen: readonly string[], order: readonly string[] = []): ColumnOrder {
  const shown = orderedNames(names, order).map((n) => names.indexOf(n)).filter((i) => !hidden.has(names[i]!));
  const first = frozen.map((n) => names.indexOf(n)).filter((i) => shown.includes(i));
  return { order: [...first, ...shown.filter((i) => !first.includes(i))], frozen: first.length };
}

/** A selection with its columns mapped by `f` (grid to field: `order[c]`; field to grid: `order.indexOf(c)`). A current cell
 *  whose column has no image (a hidden field) is dropped; a range keeps its width (the grid's), a range whose corner has no
 *  image shrinks to the cell. */
export function mapSelection(sel: GridSelection, f: (col: number) => number | undefined): GridSelection {
  const ok = (c: number | undefined): c is number => c !== undefined && c >= 0;
  let columns = CompactSelection.empty();
  for (const c of sel.columns.toArray()) { const m = f(c); if (ok(m)) columns = columns.add(m); }
  const cur = sel.current;
  const col = cur ? f(cur.cell[0]) : undefined;
  if (!cur || !ok(col)) return { columns, rows: sel.rows };
  const x = f(cur.range.x);
  return {
    columns, rows: sel.rows,
    current: {
      cell: [col, cur.cell[1]],
      range: ok(x) ? { ...cur.range, x } : { x: col, y: cur.cell[1], width: 1, height: 1 },
      rangeStack: cur.rangeStack.flatMap((r) => { const rx = f(r.x); return ok(rx) ? [{ ...r, x: rx }] : []; }),
    },
  };
}
