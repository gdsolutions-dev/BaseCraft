// Contour des dispositions dans le canevas : le rectangle englobant, dans une section, des contrôles que nomment les cellules
// d'une disposition. Une disposition Tabulaire en donne un par section traversée. Module pur.
import { cellRect, layoutPads, readLayouts, sectionRef } from '../../shared/design/layout';
import type { DesignDoc } from '../../shared/design/model';
import { sameName } from '../../shared/field-types';
import type { Rect } from './geometry';

export function layoutOutlines(doc: DesignDoc, sectionIndex: number): { id: string; rect: Rect }[] {
  const s = doc.sections[sectionIndex];
  if (!s) return [];
  return readLayouts(doc).flatMap((l) => {
    const cs = s.controls.filter((c) => l.cells.some((x) => x.control !== null && sameName(x.control, c.name)));
    if (!cs.length) return [];
    const left = Math.min(...cs.map((c) => c.left)), top = Math.min(...cs.map((c) => c.top));
    return [{ id: l.id, rect: { left, top,
      width: Math.max(...cs.map((c) => c.left + c.width)) - left, height: Math.max(...cs.map((c) => c.top + c.height)) - top } }];
  });
}

/** The empty cells of every layout that sit in this section, with their rectangle (where reflow would put a control there). */
export function emptyCells(doc: DesignDoc, sectionIndex: number): { layout: string; row: number; col: number; rect: Rect }[] {
  const s = doc.sections[sectionIndex];
  if (!s) return [];
  const ref = sectionRef(s);
  return readLayouts(doc).flatMap((l) => l.cells.filter((c) => c.control === null && l.rows[c.row].section === ref)
    .map((c) => ({ layout: l.id, row: c.row, col: c.col, rect: cellRect(l, c, layoutPads(doc, l)) })));
}
