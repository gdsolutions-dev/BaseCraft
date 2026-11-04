// Run-time anchoring (Form view): a derived document in which anchored controls follow the window. Pure, never stored.
import { sameName } from '../field-types';
import { readLayouts, reflow, spanOf, withLayouts, type Layout, type LayoutCell } from './layout';
import type { ControlDef, DesignDoc } from './model';

const shift = (c: ControlDef, dx: number, dy: number): ControlDef =>
  ({ ...c, left: c.left + dx, top: c.top + dy, ...(c.children ? { children: c.children.map((k) => shift(k, dx, dy)) } : {}) });
/** The spare split between n shares: equal, the remainder to the last. */
const share = (total: number, n: number, i: number) => Math.floor(total / n) + (i === n - 1 ? total % n : 0);
const lastCol = (c: LayoutCell) => c.col + spanOf(c).cols - 1;
const lastRow = (c: LayoutCell) => c.row + spanOf(c).rows - 1;

/** The document as shown in a window larger than the form (spare in twips; negative = 0): a layout column / row anchored "both" takes
 *  the spare, else a member anchored right / bottom moves the layout; a free control moves or grows; the Detail grows with a vertical
 *  anchor. Vertical anchoring only when `opts.vertical`, and only in the Detail. The same doc when nothing changes. */
export function anchoredDoc(doc: DesignDoc, spare: { width: number; height: number }, opts: { vertical: boolean }): DesignDoc {
  const sw = Math.max(0, spare.width), sh = opts.vertical ? Math.max(0, spare.height) : 0;
  if (sw === 0 && sh === 0) return doc;
  const h = (c?: ControlDef) => c?.props.HorizontalAnchor, v = (c?: ControlDef) => c?.props.VerticalAnchor;
  const anchored = (c: ControlDef): boolean => (sw > 0 && (h(c) === 'right' || h(c) === 'both')) || (sh > 0 && (v(c) === 'bottom' || v(c) === 'both')) || !!c.children?.some(anchored);
  if (!doc.sections.some((s) => s.controls.some(anchored))) return doc;
  const all = doc.sections.flatMap((s) => s.controls);
  const byName = (n: string | null) => (n === null ? undefined : all.find((c) => sameName(c.name, n)));
  const inLayout = new Set<string>();
  let detailTall = false;

  const layouts = readLayouts(doc).map((l): Layout => {
    const cells = l.cells.map((c) => ({ c, ctl: byName(c.control), detail: l.rows[c.row].section === 'detail' }));
    cells.forEach(({ ctl }) => ctl && inLayout.add(ctl.name.toLowerCase()));
    const wide = [...new Set(cells.filter(({ ctl }) => h(ctl) === 'both').map(({ c }) => lastCol(c)))].sort((a, b) => a - b);
    const high = sh ? [...new Set(cells.filter(({ ctl, detail }) => detail && v(ctl) === 'both').map(({ c }) => lastRow(c)))].sort((a, b) => a - b) : [];
    const moveX = !wide.length && cells.some(({ ctl }) => h(ctl) === 'right');
    const moveY = !high.length && cells.some(({ ctl, detail }) => detail && sh > 0 && v(ctl) === 'bottom');
    if (sh && cells.some(({ ctl, detail }) => detail && (v(ctl) === 'both' || v(ctl) === 'bottom'))) detailTall = true;
    return { ...l,
      left: l.left + (moveX ? sw : 0),
      tops: moveY ? { ...l.tops, detail: l.tops.detail + sh } : l.tops,
      cols: l.cols.map((w, i) => (wide.includes(i) ? w + share(sw, wide.length, wide.indexOf(i)) : w)),
      rows: l.rows.map((r, i) => (high.includes(i) ? { ...r, height: r.height + share(sh, high.length, high.indexOf(i)) } : r)) };
  });
  const laid = layouts.length ? reflow(withLayouts(doc, layouts)) : doc;

  const sections = laid.sections.map((s) => {
    const vert = sh > 0 && s.kind === 'detail';
    let tall = false;
    const controls = s.controls.map((c) => {
      if (inLayout.has(c.name.toLowerCase())) return c;
      const ah = h(c), av = vert ? v(c) : undefined;
      if (av === 'bottom' || av === 'both') tall = true;
      const dx = ah === 'right' ? sw : 0, dy = av === 'bottom' ? sh : 0;
      const wd = ah === 'both' ? sw : 0, ht = av === 'both' ? sh : 0;
      if (!dx && !dy && !wd && !ht) return c;
      const grown = wd || ht ? { ...c, width: c.width + wd, height: c.height + ht } : c;
      return dx || dy ? shift(grown, dx, dy) : grown;
    });
    const grows = vert && (tall || detailTall);
    return grows || controls.some((c, i) => c !== s.controls[i]) ? { ...s, controls, height: s.height + (grows ? sh : 0) } : s;
  });
  return sections.some((s, i) => s !== laid.sections[i]) ? { ...laid, sections } : laid;
}
