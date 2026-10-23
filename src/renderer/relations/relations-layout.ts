// Géométrie pure de la fenêtre Relations : taille des boîtes de tables, placement automatique, tracé des lignes ; et les
// règles sans DOM de la fenêtre (paires de champs de la boîte de dialogue, sens d'une relation glissée, refus d'une suppression).
import type { OpResult, RelationsLayout } from '../../shared/api';
import type { TableDesign } from '../../shared/field-types';

export interface Point { x: number; y: number }
/** A table box on the canvas; `scroll`: how far its field list is scrolled. */
export interface Box { x: number; y: number; w: number; h: number; scroll?: number }

/** Box width, title height, field row height, list padding, rows shown before the list scrolls (RelationsView's CSS uses them). */
export const BOX_W = 200, HEAD = 34, ROW = 24, PAD = 4, MAX_ROWS = 8;
const GAP = 48, MARGIN = 24, STUB = 24; // between boxes, around the drawing, straight run out of a box

/** Its 1 px borders included (the title and field rows sit 1 px lower than the anchors say: not visible). */
export const boxHeight = (fields: number): number => 2 + HEAD + 2 * PAD + Math.min(Math.max(fields, 1), MAX_ROWS) * ROW;
const SLOT_H = boxHeight(MAX_ROWS);

/** Positions of `tables`: an existing one keeps its place; the others fill a grid, left to right, as wide as `size` allows,
 *  in slots no box overlaps (any box taken at its tallest). `size.h` is not limiting: the canvas scrolls. */
export function autoLayout(tables: string[], existing: RelationsLayout, size: { w: number; h: number }): RelationsLayout {
  const out: RelationsLayout['tables'] = Object.create(null); // a table may be named "constructor"
  const taken: Point[] = [];
  for (const t of tables) if (Object.hasOwn(existing.tables, t)) taken.push(out[t] = existing.tables[t]);
  const cols = Math.max(1, Math.floor((size.w - 2 * MARGIN + GAP) / (BOX_W + GAP)));
  const free = (p: Point) => taken.every((q) => p.x + BOX_W <= q.x || q.x + BOX_W <= p.x || p.y + SLOT_H <= q.y || q.y + SLOT_H <= p.y);
  let slot = 0;
  for (const t of tables) {
    if (Object.hasOwn(out, t)) continue;
    let p: Point;
    do {
      p = { x: MARGIN + (slot % cols) * (BOX_W + GAP), y: MARGIN + Math.floor(slot / cols) * (SLOT_H + GAP) };
      slot++;
    } while (!free(p));
    taken.push(out[t] = p);
  }
  return { tables: out };
}

/** Height of field `i` on its box's edge; a field scrolled out of view sticks to the top or bottom of the list. */
const anchorY = (b: Box, i: number) => Math.min(Math.max(b.y + HEAD + PAD + i * ROW + ROW / 2 - (b.scroll ?? 0), b.y + HEAD), b.y + b.h);

/** The line from field `aField` of the parent box `a` to field `bField` of the child box `b`: straight runs out of facing sides
 *  (both on the right when the boxes are one above the other). `oneEnd` and `manyEnd`: where "1" and "∞" go, just outside
 *  each box, above the line. */
export function linePath(a: Box, aField: number, b: Box, bField: number): { d: string; oneEnd: Point; manyEnd: Point } {
  const [sa, sb] = a.x + a.w <= b.x ? [1, -1] : b.x + b.w <= a.x ? [-1, 1] : [1, 1];
  const ax = sa > 0 ? a.x + a.w : a.x, bx = sb > 0 ? b.x + b.w : b.x;
  const ay = anchorY(a, aField), by = anchorY(b, bField);
  const d = sa === sb
    ? `M ${ax} ${ay} H ${Math.max(ax, bx) + STUB} V ${by} L ${bx} ${by}`
    : `M ${ax} ${ay} H ${ax + sa * STUB} L ${bx + sb * STUB} ${by} L ${bx} ${by}`;
  return { d, oneEnd: { x: ax + sa * 10, y: ay - 5 }, manyEnd: { x: bx + sb * 10, y: by - 5 } };
}

/** The relation dialog's rows as field pairs; a row filled on one side only is refused (its index), never zipped with
 *  another row into a pair the user did not draw. Rows empty on both sides are not pairs. */
export function relationFields(rows: [string, string][]): { parentFields: string[]; childFields: string[] } | { incomplete: number[] } {
  const incomplete = rows.flatMap(([p, c], i) => (!p !== !c ? [i] : []));
  if (incomplete.length) return { incomplete };
  const pairs = rows.filter(([p]) => p);
  return { parentFields: pairs.map((r) => r[0]), childFields: pairs.map((r) => r[1]) };
}

/** Unique on its own: the whole primary key, or indexed without duplicates. */
export function isUniqueField(d: TableDesign | undefined, field: string): boolean {
  const fd = d?.fields.find((x) => x.name === field);
  return !!fd && ((fd.props.primaryKey && d!.fields.filter((x) => x.props.primaryKey).length === 1) || fd.props.indexed === 'yesNoDuplicates');
}

/** A field dropped on a field of another table, as Access does: the side unique on its own is the parent when the other is
 *  not; otherwise the table dragged from is. [parent, child]. */
export function linkSides<T extends { table: string; field: string }>(from: T, to: T, designs: ReadonlyMap<string, TableDesign>): [T, T] {
  return isUniqueField(designs.get(to.table), to.field) && !isUniqueField(designs.get(from.table), from.field) ? [to, from] : [from, to];
}

/** The message of a refused relation delete: an external table gets the Relations window's own text, any other reason the
 *  Navigation Pane's (dialog.op.*). */
export function deleteRefusal(r: Exclude<OpResult, { ok: true }>, name: string): { messageKey: string; params: Record<string, string> } {
  if (r.reason === 'external') return { messageKey: 'relations.error.external', params: { table: r.table } };
  return { messageKey: `dialog.op.${r.reason}`, params: { name, table: 'table' in r ? r.table : '', view: 'view' in r ? r.view : '' } };
}
