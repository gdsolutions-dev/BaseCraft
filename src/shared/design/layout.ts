// Control layouts (Stacked / Tabular grids) stored in doc.props.Layouts. Pure module: tolerant read, and reflow of control positions.
import { MAX_TWIPS, sameName } from '../field-types';
import type { ControlDef, DesignDoc, SectionDef } from './model';

/** Identifies a section inside a document: its kind, plus its group level for group headers/footers. */
export type SectionRef = string;
export const sectionRef = (s: SectionDef): SectionRef => (s.groupLevel === undefined ? s.kind : `${s.kind}:${s.groupLevel}`);

export interface LayoutRow { section: SectionRef; height: number }
/** rowSpan / colSpan: slots covered from (row, col); absent = 1, written only when > 1. */
export interface LayoutCell { row: number; col: number; rowSpan?: number; colSpan?: number; control: string | null }
export interface Layout {
  id: string; kind: 'stacked' | 'tabular'; left: number;
  tops: Record<SectionRef, number>;   // top of the first row of each section the layout spans
  cols: number[];                     // column widths
  rows: LayoutRow[]; cells: LayoutCell[];
}

export const spanOf = (c: LayoutCell) => ({ rows: c.rowSpan ?? 1, cols: c.colSpan ?? 1 });
/** The cell covering this slot. */
export function cellAt(l: Layout, row: number, col: number): LayoutCell | undefined {
  return l.cells.find((c) => { const s = spanOf(c); return row >= c.row && row < c.row + s.rows && col >= c.col && col < c.col + s.cols; });
}

// Calibration constants (twips): gap between two rows / two columns of a grid.
export const ROW_GAP = 170;
export const COL_GAP = 57;
/** Control Margins and Control Padding menu presets, in twips (measured in Access 16 through RunCommand, 2026-11-04). */
export const MARGIN_PRESETS = { none: 0, narrow: 22, medium: 45, wide: 90 };
export const PADDING_PRESETS = { none: 0, narrow: 30, medium: 90, wide: 180 };

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
    const seen = new Array<boolean>(nr * nc).fill(false);   // every slot covered exactly once
    const cellsOk = l.cells.every((c) => {
      if (!isObj(c) || !isUint(c.row) || c.row >= nr || !isUint(c.col) || c.col >= nc) return false;
      if (!(c.control === null || (typeof c.control === 'string' && names.some((n) => sameName(n, c.control as string))))) return false;
      const [rs, cs] = [c.rowSpan ?? 1, c.colSpan ?? 1] as number[];
      if (!Number.isSafeInteger(rs) || rs < 1 || !Number.isSafeInteger(cs) || cs < 1 || c.row + rs > nr || c.col + cs > nc) return false;
      for (let r = c.row; r < c.row + rs; r++) for (let k = c.col; k < c.col + cs; k++) { if (seen[r * nc + k]) return false; seen[r * nc + k] = true; }
      return true;
    });
    return cellsOk && seen.every(Boolean);
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
    const head = cell.col === 0 ? null : find(cellAt(l, cell.row, 0)?.control);
    return head?.kind === 'label' ? head : null;
  }
  const own = l.rows[cell.row].section;
  return l.cells.filter((c) => c.col <= cell.col && cell.col < c.col + spanOf(c).cols && c.row < cell.row && l.rows[c.row].section !== own).map((c) => find(c.control)).find((c) => c?.kind === 'label') ?? null;
}

/** labelOf when the label is in the member's own section (Stacked): the label that goes along with it (Copy, Form view link);
 *  a Tabular header label sits in another section. */
export function ownLabel(doc: DesignDoc, control: string): ControlDef | null {
  const l = labelOf(doc, control);
  return l && doc.sections.some((s) => s.controls.includes(l) && s.controls.some((c) => sameName(c.name, control))) ? l : null;
}

export interface Pads { left: number[]; right: number[]; top: number[]; bottom: number[] }
const padOf = (c: ControlDef | undefined, side: string) => { const v = c?.props[`${side}Padding`]; return isUint(v) ? v : 0; };
const noPads = (l: Layout): Pads => ({ left: l.cols.map(() => 0), right: l.cols.map(() => 0), top: l.rows.map(() => 0), bottom: l.rows.map(() => 0) });

/** Control Padding is column-wide and row-wide: each column / row takes the largest padding among its non-spanning members, in all sections.
 *  ponytail: a pad lives on the control (absent = 0), the inventory default is not applied; a spanning member's own padding is ignored. */
export function layoutPads(doc: DesignDoc, l: Layout): Pads {
  const p = noPads(l), all = topLevel(doc);
  for (const c of l.cells) {
    const sp = spanOf(c);
    const ctl = c.control === null ? undefined : all.find((x) => sameName(x.name, c.control!));
    if (!ctl) continue;
    if (sp.cols === 1) { p.left[c.col] = Math.max(p.left[c.col], padOf(ctl, 'Left')); p.right[c.col] = Math.max(p.right[c.col], padOf(ctl, 'Right')); }
    if (sp.rows === 1) { p.top[c.row] = Math.max(p.top[c.row], padOf(ctl, 'Top')); p.bottom[c.row] = Math.max(p.bottom[c.row], padOf(ctl, 'Bottom')); }
  }
  return p;
}

/** The grid's unclamped coordinates: the top of each row (section-relative, in its own section) and the left of each column, before any
 *  padding offset. Rows and columns are as large as their content plus their paddings. */
export function gridGeometry(l: Layout, pads: Pads = noPads(l)): { tops: number[]; lefts: number[] } {
  const used: Record<SectionRef, { y: number; n: number }> = {};
  const tops = l.rows.map((r, i) => {   // top of each row: its section's top + rows above in that section + gaps
    const u = (used[r.section] ??= { y: 0, n: 0 });
    const top = l.tops[r.section] + u.y + u.n * ROW_GAP;
    u.y += r.height + pads.top[i] + pads.bottom[i]; u.n++;
    return top;
  });
  const ext = l.cols.map((w, i) => w + pads.left[i] + pads.right[i]);
  return { tops, lefts: ext.map((_, i) => l.left + ext.slice(0, i).reduce((a, w) => a + w, 0) + i * COL_GAP) };
}

/** The unclamped rectangle of a cell (section-relative): its spanned columns / rows plus the gaps between them, inside the paddings. */
export function cellRect(l: Layout, c: LayoutCell, pads: Pads = noPads(l)): { left: number; top: number; width: number; height: number } {
  const { tops, lefts } = gridGeometry(l, pads);
  const sp = spanOf(c), [lc, lr] = [c.col + sp.cols - 1, c.row + sp.rows - 1];
  const wide = (i: number) => l.cols[i] + pads.left[i] + pads.right[i], high = (i: number) => l.rows[i].height + pads.top[i] + pads.bottom[i];
  const sum = (n: number, from: number, f: (i: number) => number) => Array.from({ length: n }, (_, k) => f(from + k)).reduce((a, w) => a + w, 0);
  return { left: lefts[c.col] + pads.left[c.col], top: tops[c.row] + pads.top[c.row],
    width: sum(sp.cols, c.col, wide) + (sp.cols - 1) * COL_GAP - pads.left[c.col] - pads.right[lc],
    height: sum(sp.rows, c.row, high) + (sp.rows - 1) * ROW_GAP - pads.top[c.row] - pads.bottom[lr] };
}

/** Recomputes every layout member's position and size from its grid; the same object when nothing changes. */
export function reflow(doc: DesignDoc): DesignDoc {
  const target = new Map<string, Pick<ControlDef, 'left' | 'top' | 'width' | 'height'>>();
  for (const l of readLayouts(doc)) {
    const pads = layoutPads(doc, l);
    for (const c of l.cells) if (c.control !== null) {
      const r = cellRect(l, c, pads);
      target.set(c.control.toLowerCase(), { left: clamp(r.left), top: clamp(r.top), width: clamp(r.width), height: clamp(r.height) });
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
