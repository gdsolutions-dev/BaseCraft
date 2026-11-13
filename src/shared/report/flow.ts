// Locating report items by control name in a flow (Layout view) report (pure): absolute twips, no DOM.
import type { SectionKind } from '../design/model';
import { sameName } from '../field-types';
import type { LaidOutItem, LaidOutReport } from './types';

export interface Occurrence { left: number; top: number; width: number; height: number; section: SectionKind; row: number }

/** Bounding box of an item in its band's coordinates (a line's is that of its two ends). */
function bounds(i: LaidOutItem): { left: number; top: number; width: number; height: number } {
  if (i.kind === 'line') return { left: Math.min(i.x1, i.x2), top: Math.min(i.y1, i.y2), width: Math.abs(i.x2 - i.x1), height: Math.abs(i.y2 - i.y1) };
  return { left: i.left, top: i.top, width: i.width, height: i.height };
}

/** Every drawn instance of control `name` (names compared as the designer does: sameName), in absolute twips, in reading order (top then left). A multi-line text is one
 *  occurrence (its box). `row`: 0-based rank of the band among the bands of the same section and group level. */
export function occurrences(report: LaidOutReport, name: string): Occurrence[] {
  const out: Occurrence[] = [], rank = new Map<string, number>();
  for (const b of report.pages[0]?.bands ?? []) {
    const key = `${b.section}/${b.groupLevel ?? ''}`, row = rank.get(key) ?? 0;
    rank.set(key, row + 1);
    for (const i of b.items) if (sameName(i.name, name)) { const r = bounds(i); out.push({ left: b.left + r.left, top: b.top + r.top, width: r.width, height: r.height, section: b.section, row }); }
  }
  return out.sort((a, b) => a.top - b.top || a.left - b.left);
}

/** Document section under a flow point (absolute twips): index in `sections` (kind + groupLevel) of the topmost band holding the point, and the point relative to that band.
 *  Null in gaps, outside every band, for a zero-height band, or when the band's section is not in `sections`. */
export function sectionPointAt(report: LaidOutReport, sections: readonly { kind: string; groupLevel?: number }[], x: number, y: number): { section: number; x: number; y: number } | null {
  const bands = report.pages[0]?.bands ?? [];
  for (let k = bands.length - 1; k >= 0; k--) {
    const b = bands[k]!;
    if (b.height <= 0 || x < b.left || x >= b.left + b.width || y < b.top || y >= b.top + b.height) continue;
    const section = sections.findIndex((s) => s.kind === b.section && (s.groupLevel ?? undefined) === (b.groupLevel ?? undefined));
    return section < 0 ? null : { section, x: x - b.left, y: y - b.top };
  }
  return null;
}

/** Name of the topmost item (the last painted) whose box holds the point (twips), or null in the gaps. */
export function itemAt(report: LaidOutReport, x: number, y: number): string | null {
  let hit: string | null = null;
  for (const b of report.pages[0]?.bands ?? []) for (const i of b.items) {
    const r = bounds(i), l = b.left + r.left, t = b.top + r.top;
    if (i.name && x >= l && x <= l + r.width && y >= t && y <= t + r.height) hit = i.name;   // nameless: inside a subreport, its frame is the hit
  }
  return hit;
}
