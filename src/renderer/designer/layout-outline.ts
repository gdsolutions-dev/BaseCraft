// Contour des dispositions dans le canevas : le rectangle englobant, dans une section, des contrôles que nomment les cellules
// d'une disposition. Une disposition Tabulaire en donne un par section traversée. Module pur.
import { readLayouts } from '../../shared/design/layout';
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
