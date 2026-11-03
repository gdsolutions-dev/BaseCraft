// Control layouts (Stacked / Tabular grids) stored in doc.props.Layouts. Pure module: tolerant read, and reflow of control positions.
import { MAX_TWIPS, sameName } from '../field-types';
import type { ControlDef, DesignDoc, SectionDef } from './model';

/** Identifies a section inside a document: its kind, plus its group level for group headers/footers. */
export type SectionRef = string;
export const sectionRef = (s: SectionDef): SectionRef => (s.groupLevel === undefined ? s.kind : `${s.kind}:${s.groupLevel}`);

export interface LayoutRow { section: SectionRef; height: number }
export interface LayoutCell { row: number; col: number; control: string | null }
export interface Layout {
  id: string; kind: 'stacked' | 'tabular'; left: number;
  tops: Record<SectionRef, number>;   // top of the first row of each section the layout spans
  cols: number[];                     // column widths
  rows: LayoutRow[]; cells: LayoutCell[];
}

// Calibration constants (twips): gap between two rows / two columns of a grid.
export const ROW_GAP = 170;
export const COL_GAP = 57;

const isObj = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v);
const isUint = (v: unknown): v is number => Number.isSafeInteger(v) && (v as number) >= 0;
const clamp = (n: number) => Math.min(Math.max(n, 0), MAX_TWIPS);
const topLevel = (doc: DesignDoc): ControlDef[] => doc.sections.flatMap((s) => s.controls);
const shift = (c: ControlDef, dx: number, dy: number): ControlDef =>
  ({ ...c, left: c.left + dx, top: c.top + dy, ...(c.children ? { children: c.children.map((k) => shift(k, dx, dy)) } : {}) });

/** The valid layouts of a document; anything malformed, or naming a control that does not exist, is dropped. Never throws. */
export function readLayouts(doc: DesignDoc): Layout[] {
  const raw = doc.props?.Layouts;
  if (!Array.isArray(raw)) return [];
  const names = topLevel(doc).map((c) => c.name);
  return raw.filter((l): l is Layout => {
    if (!isObj(l) || typeof l.id !== 'string' || (l.kind !== 'stacked' && l.kind !== 'tabular') || !isUint(l.left)) return false;
    if (!Array.isArray(l.cols) || !l.cols.every(isUint) || !Array.isArray(l.rows) || !Array.isArray(l.cells) || !isObj(l.tops)) return false;
    const tops = l.tops;
    const rowsOk = l.rows.every((r) => isObj(r) && typeof r.section === 'string' && isUint(r.height) && isUint(tops[r.section]));
    if (!rowsOk) return false;
    const [nr, nc] = [l.rows.length, l.cols.length];
    return l.cells.every((c) => isObj(c) && isUint(c.row) && c.row < nr && isUint(c.col) && c.col < nc
      && (c.control === null || (typeof c.control === 'string' && names.some((n) => sameName(n, c.control as string)))));
  });
}

/** The document with these layouts; the key is removed when there are none. */
export function withLayouts(doc: DesignDoc, layouts: Layout[]): DesignDoc {
  const { Layouts: _old, ...rest } = doc.props;
  return { ...doc, props: layouts.length ? { ...rest, Layouts: layouts } : rest };
}

export const layoutOf = (doc: DesignDoc, control: string): Layout | null =>
  readLayouts(doc).find((l) => l.cells.some((c) => c.control !== null && sameName(c.control, control))) ?? null;

/** A layout member's label: Stacked, the label in column 0 of its row; Tabular, the label in the same column on a row above, in
 *  another section than the member's (the header rows: Form Header, Page Header, a group header… — an empty inserted row is skipped). */
export function labelOf(doc: DesignDoc, control: string): ControlDef | null {
  const l = layoutOf(doc, control);
  if (!l) return null;
  const cell = l.cells.find((c) => c.control !== null && sameName(c.control, control))!;
  const find = (n: string | null | undefined) => (n ? topLevel(doc).find((c) => sameName(c.name, n)) ?? null : null);
  if (l.kind === 'stacked') {
    const head = cell.col === 0 ? null : find(l.cells.find((c) => c.row === cell.row && c.col === 0)?.control);
    return head?.kind === 'label' ? head : null;
  }
  const own = l.rows[cell.row].section;
  return l.cells.filter((c) => c.col === cell.col && c.row < cell.row && l.rows[c.row].section !== own).map((c) => find(c.control)).find((c) => c?.kind === 'label') ?? null;
}

/** labelOf when the label is in the member's own section (Stacked): the label that goes along with it (Copy, Form view link);
 *  a Tabular header label sits in another section. */
export function ownLabel(doc: DesignDoc, control: string): ControlDef | null {
  const l = labelOf(doc, control);
  return l && doc.sections.some((s) => s.controls.includes(l) && s.controls.some((c) => sameName(c.name, control))) ? l : null;
}

/** The grid's unclamped coordinates: the top of each row (section-relative, in its own section) and the left of each column. */
export function gridGeometry(l: Layout): { tops: number[]; lefts: number[] } {
  const used: Record<SectionRef, { y: number; n: number }> = {};
  const tops = l.rows.map((r) => {   // top of each row: its section's top + rows above in that section + gaps
    const u = (used[r.section] ??= { y: 0, n: 0 });
    const top = l.tops[r.section] + u.y + u.n * ROW_GAP;
    u.y += r.height; u.n++;
    return top;
  });
  return { tops, lefts: l.cols.map((_, i) => l.left + l.cols.slice(0, i).reduce((a, w) => a + w, 0) + i * COL_GAP) };
}

/** Recomputes every layout member's position and size from its grid; the same object when nothing changes. */
export function reflow(doc: DesignDoc): DesignDoc {
  const target = new Map<string, Pick<ControlDef, 'left' | 'top' | 'width' | 'height'>>();
  for (const l of readLayouts(doc)) {
    const { tops, lefts } = gridGeometry(l);
    for (const c of l.cells) if (c.control !== null) {
      target.set(c.control.toLowerCase(), { left: clamp(lefts[c.col]), top: clamp(tops[c.row]), width: clamp(l.cols[c.col]), height: clamp(l.rows[c.row].height) });
    }
  }
  let changed = false;
  const sections = doc.sections.map((s) => {
    let sc = false;
    const controls = s.controls.map((c) => {
      const t = [...target].find(([n]) => sameName(n, c.name))?.[1];
      if (!t || (t.left === c.left && t.top === c.top && t.width === c.width && t.height === c.height)) return c;
      sc = true;
      const [dx, dy] = [t.left - c.left, t.top - c.top];   // its content (tab pages) moves with it, section-relative, never resized
      return { ...c, ...t, ...(c.children && (dx || dy) ? { children: c.children.map((k) => shift(k, dx, dy)) } : {}) };
    });
    if (!sc) return s;
    changed = true; return { ...s, controls };
  });
  return changed ? { ...doc, sections } : doc;
}
