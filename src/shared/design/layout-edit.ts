// Row/column editing of control layouts (doc.props.Layouts). Pure: every function returns the same doc when nothing changes.
import { MAX_TWIPS, sameName } from '../field-types';
import { ROW_GAP, gridGeometry, labelOf, layoutOf, readLayouts, reflow, sectionRef, withLayouts, type Layout, type LayoutCell, type LayoutRow, type SectionRef } from './layout';
import type { ControlDef, DesignDoc } from './model';

const members = (l: Layout): string[] => l.cells.flatMap((c) => (c.control === null ? [] : [c.control]));
const isObj = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v);

/** Replaces the layout with the same id, then reflows. */
function replaceLayout(doc: DesignDoc, next: Layout): DesignDoc {
  return reflow(withLayouts(doc, readLayouts(doc).map((l) => (l.id === next.id ? next : l))));
}

/** Removes LayoutID from every top-level control for which `drop(name)` is true; the same doc when none carries it. */
function stripLayoutIds(doc: DesignDoc, drop: (name: string) => boolean): DesignDoc {
  let changed = false;
  const sections = doc.sections.map((s) => {
    let sc = false;
    const controls = s.controls.map((c): ControlDef => {
      if (!('LayoutID' in c.props) || !drop(c.name)) return c;
      const { LayoutID: _id, ...props } = c.props;
      sc = true; return { ...c, props };
    });
    if (!sc) return s;
    changed = true; return { ...s, controls };
  });
  return changed ? { ...doc, sections } : doc;
}

/** Inserts an empty row (above/below, in the reference row's section) or column (left/right) next to a layout member. */
export function insertCells(doc: DesignDoc, control: string, where: 'above' | 'below' | 'left' | 'right'): DesignDoc {
  const l = layoutOf(doc, control);
  if (!l) return doc;
  const ref = l.cells.find((c) => c.control !== null && sameName(c.control, control))!;
  if (where === 'above' || where === 'below') {
    const at = ref.row + (where === 'below' ? 1 : 0);
    const rows = [...l.rows.slice(0, at), { ...l.rows[ref.row] }, ...l.rows.slice(at)];
    const cells = l.cells.map((c) => (c.row >= at ? { ...c, row: c.row + 1 } : c));
    l.cols.forEach((_, col) => cells.push({ row: at, col, control: null }));
    return replaceLayout(doc, { ...l, rows, cells });
  }
  const at = ref.col + (where === 'right' ? 1 : 0);
  const cols = [...l.cols.slice(0, at), l.cols[ref.col], ...l.cols.slice(at)];
  const cells = l.cells.map((c) => (c.col >= at ? { ...c, col: c.col + 1 } : c));
  l.rows.forEach((_, row) => cells.push({ row, col: at, control: null }));
  return replaceLayout(doc, { ...l, cols, cells });
}

/** Swaps the control's row with the adjacent row of the same section; no-op at an edge or across sections. */
export function moveRow(doc: DesignDoc, control: string, delta: 1 | -1): DesignDoc {
  const l = layoutOf(doc, control);
  if (!l) return doc;
  const r = l.cells.find((c) => c.control !== null && sameName(c.control, control))!.row;
  const o = r + delta;
  if (o < 0 || o >= l.rows.length || l.rows[o].section !== l.rows[r].section) return doc;
  const rows = l.rows.map((x, i) => (i === r ? l.rows[o] : i === o ? l.rows[r] : x));   // heights travel with their row
  const cells = l.cells.map((c) => (c.row === r ? { ...c, row: o } : c.row === o ? { ...c, row: r } : c));
  return replaceLayout(doc, { ...l, rows, cells });
}

/** Names of the controls in the whole layout, the control's row, or the control's column (a Tabular column spans header and detail). */
export function selectionOf(doc: DesignDoc, control: string, scope: 'layout' | 'row' | 'column'): string[] {
  const l = layoutOf(doc, control);
  if (!l) return [];
  const ref = l.cells.find((c) => c.control !== null && sameName(c.control, control))!;
  return l.cells.flatMap((c) => (c.control !== null && (scope === 'layout' || (scope === 'row' ? c.row === ref.row : c.col === ref.col)) ? [c.control] : []));
}

/** Drops a layout and its members' LayoutID; positions untouched. Stacked: each column-0 label becomes again the attached label
 *  (a child) of the control on its row, in the same section; Tabular header labels stay top-level. */
export function removeLayout(doc: DesignDoc, id: string): DesignDoc {
  const all = readLayouts(doc);
  const gone = all.find((l) => l.id === id);
  if (!gone) return doc;
  const names = members(gone);
  const pairs = gone.kind === 'stacked' ? names.flatMap((n) => { const l = labelOf(doc, n); return l ? [[n, l.name] as const] : []; }) : [];
  const out = stripLayoutIds(withLayouts(doc, all.filter((l) => l !== gone)), (n) => names.some((m) => sameName(m, n)));
  return { ...out, sections: out.sections.map((s) => {
    const here = (n: string) => s.controls.find((c) => sameName(c.name, n));
    const back = pairs.flatMap(([n, l]) => { const c = here(n), k = here(l);
      return c && k && !attachedLabel(c) && c.kind !== 'tabControl' ? [[c, k] as const] : []; });
    if (!back.length) return s;
    return { ...s, controls: s.controls.filter((c) => !back.some(([, k]) => k === c))
      .map((c) => { const k = back.find(([x]) => x === c)?.[1]; return k ? { ...c, children: [...(c.children ?? []), k] } : c; }) };
  }) };
}

/** Renames the section references of every layout (rows and tops), all at once; a reference mapped to null loses its rows and
 *  their cells. For group sections renumbered by the Group, Sort and Total pane. The same doc when nothing changes. */
export function remapSections(doc: DesignDoc, map: (ref: SectionRef) => SectionRef | null): DesignDoc {
  const all = readLayouts(doc);
  const next = all.map((l): Layout => {
    const keep = l.rows.map((r) => map(r.section));
    const index = keep.map((k, i) => keep.slice(0, i).filter((x) => x !== null).length);   // a kept row's new index
    return { ...l,
      tops: Object.fromEntries(Object.entries(l.tops).flatMap(([k, t]) => { const m = map(k); return m === null ? [] : [[m, t]]; })),
      rows: l.rows.flatMap((r, i) => (keep[i] === null ? [] : [{ ...r, section: keep[i]! }])),
      cells: l.cells.flatMap((c) => (keep[c.row] === null ? [] : [{ ...c, row: index[c.row] }])) };
  });
  return JSON.stringify(next) === JSON.stringify(all) ? doc : withLayouts(doc, next);
}

/** A cell naming a missing control becomes null; a layout with no member left is dropped; LayoutID of non-members is stripped. */
export function pruneLayouts(doc: DesignDoc): DesignDoc {
  const raw = doc.props?.Layouts;
  if (!Array.isArray(raw)) return doc;
  const exists = (n: string) => doc.sections.some((s) => s.controls.some((c) => sameName(c.name, n)));
  const nulled = raw.map((l) => (isObj(l) && Array.isArray(l.cells)
    ? { ...l, cells: l.cells.map((c) => (isObj(c) && typeof c.control === 'string' && !exists(c.control) ? { ...c, control: null } : c)) } : l));
  const kept = readLayouts({ ...doc, props: { ...doc.props, Layouts: nulled } }).filter((l) => members(l).length > 0);
  const next = JSON.stringify(kept) === JSON.stringify(raw) ? doc : withLayouts(doc, kept);
  const live = kept.flatMap(members);
  return stripLayoutIds(next, (n) => !live.some((m) => sameName(m, n)));
}

/** A control to lay out with its label. `label` undefined: the control's attached label child; a name: a top-level label; null: none. */
export interface Member { control: string; label?: string | null }

/** The label child of a control; a tab control's or option group's children are its content, not a label. */
const attachedLabel = (c: ControlDef): ControlDef | undefined =>
  (c.kind === 'tabControl' || c.kind === 'optionGroup' ? undefined : c.children?.find((k) => k.kind === 'label'));
const bottom = (c: ControlDef): number => Math.max(c.top + c.height, ...(c.children ?? []).map(bottom));

/** The top-level label of the header section that sits over the control's column (a report's labels are not attached to their control). */
const headerLabelOver = (doc: DesignDoc, c: ControlDef, header: SectionRef): ControlDef | null => {
  const over = (l: ControlDef) => Math.min(l.left + l.width, c.left + c.width) - Math.max(l.left, c.left);
  const hs = doc.sections.find((s) => sectionRef(s) === header);
  return hs?.controls.filter((l) => l.kind === 'label' && over(l) > 0).sort((a, b) => over(b) - over(a))[0] ?? null;
};

/** The layout members among selected names: top-level controls only, minus option groups/buttons and labels that belong to another member.
 *  `header`: a Tabular's header section, where an unattached label is looked for over the control's column. */
export function membersOf(doc: DesignDoc, names: string[], header?: SectionRef): Member[] {
  const all = doc.sections.flatMap((s) => s.controls);
  const ms = names.flatMap((n) => all.filter((c) => sameName(c.name, n) && c.kind !== 'optionGroup' && c.kind !== 'optionButton'))
    .map((c): Member => (attachedLabel(c) ? { control: c.name }
      : { control: c.name, label: (labelOf(doc, c.name) ?? (header ? headerLabelOver(doc, c, header) : null))?.name ?? null }));
  return ms.filter((m) => !ms.some((o) => o.label && sameName(o.label, m.control)));
}

/**
 * Builds a Stacked or Tabular layout over the members, as Access does (captures S1, S3). Members leave any previous layout;
 * their labels become top-level label controls (Stacked: the control's section, column 0; Tabular: `headerSection`, header row).
 * Stacked: rows sorted by section, top, then left; Tabular: columns sorted by left. The doc is unchanged without members,
 * or for Tabular without the header section.
 */
export function createLayout(doc: DesignDoc, mems: Member[], kind: 'stacked' | 'tabular', opts: { headerSection: SectionRef }): DesignDoc {
  const hi = doc.sections.findIndex((s) => sectionRef(s) === opts.headerSection);
  if (kind === 'tabular' && hi < 0) return doc;
  const placed = mems.flatMap((m) => {
    const si = doc.sections.findIndex((s) => s.controls.some((c) => sameName(c.name, m.control)));
    if (si < 0) return [];
    const c = doc.sections[si].controls.find((x) => sameName(x.name, m.control))!;
    const label = m.label === undefined ? attachedLabel(c) ?? null
      : m.label === null ? null : doc.sections.flatMap((s) => s.controls).find((x) => x.kind === 'label' && sameName(x.name, m.label!)) ?? null;
    return [{ c, si, label }];
  });
  if (!placed.length) return doc;
  placed.sort(kind === 'stacked' ? (a, b) => a.si - b.si || a.c.top - b.c.top || a.c.left - b.c.left : (a, b) => a.c.left - b.c.left || a.c.top - b.c.top);

  // Previous layouts lose the moved controls; one left without members is dropped.
  const labels = placed.flatMap((p) => (p.label ? [p.label] : []));
  const moved = [...placed.map((p) => p.c.name), ...labels.map((l) => l.name)];
  const isIn = (list: string[], n: string) => list.some((m) => sameName(m, n));
  const old = readLayouts(doc)
    .map((l) => ({ ...l, cells: l.cells.map((c) => (c.control !== null && isIn(moved, c.control) ? { ...c, control: null } : c)) }))
    .filter((l) => members(l).length > 0);
  let n = 1;
  while (old.some((l) => l.id === `L${n}`)) n++;
  const id = `L${n}`;
  const tag = (c: ControlDef): ControlDef => ({ ...c, props: { ...c.props, LayoutID: id } });

  // Labels leave their control's children (or their section) and become top-level controls of their target section.
  const labelNames = labels.map((l) => l.name);
  const sections = doc.sections.map((s) => ({ ...s, controls: s.controls.filter((c) => !isIn(labelNames, c.name)).map((c) => {
    if (!isIn(moved, c.name)) return c;
    const { children, ...rest } = c;
    const kids = children?.filter((k) => !isIn(labelNames, k.name));
    return tag(kids?.length ? { ...rest, children: kids } : rest);
  }) }));
  const headerTop = hi < 0 || !sections[hi].controls.length ? 0 : Math.max(...sections[hi].controls.map(bottom)) + ROW_GAP;
  for (const p of placed) if (p.label) sections[kind === 'stacked' ? p.si : hi].controls.push(tag(p.label));

  const ref = (si: number) => sectionRef(doc.sections[si]);
  const tops: Record<SectionRef, number> = {};
  for (const p of placed) tops[ref(p.si)] ??= p.c.top;   // the first control of each section sets that section's top
  let layout: Layout;
  if (kind === 'stacked') {
    const labeled = placed.filter((p) => p.label);
    const cols = [Math.max(...placed.map((p) => (p.label ?? p.c).width)), ...(labeled.length ? [Math.max(...labeled.map((p) => p.c.width))] : [])];
    const cells = placed.flatMap((p, row): LayoutCell[] => (p.label
      ? [{ row, col: 0, control: p.label.name }, { row, col: 1, control: p.c.name }]
      : [{ row, col: 0, control: p.c.name }, ...(cols.length > 1 ? [{ row, col: 1, control: null }] : [])]));   // no label: column 0 (S1)
    const [first] = placed;   // S3b: the label column starts where the first control's label was
    layout = { id, kind, left: Math.min(first.c.left, first.label?.left ?? first.c.left), tops, cols,
      rows: placed.map((p) => ({ section: ref(p.si), height: p.c.height })), cells };
  } else {
    const secs = [...new Set(placed.map((p) => p.si))].sort((a, b) => a - b);
    const head: LayoutRow[] = labels.length ? [{ section: opts.headerSection, height: Math.max(...labels.map((l) => l.height)) }] : [];
    if (head.length) tops[opts.headerSection] = headerTop;
    const rows = [...head, ...secs.map((si) => ({ section: ref(si), height: Math.max(...placed.filter((p) => p.si === si).map((p) => p.c.height)) }))];
    const cells = placed.flatMap((p, col): LayoutCell[] => [
      ...(head.length ? [{ row: 0, col, control: p.label?.name ?? null }] : []),
      ...secs.map((si, r) => ({ row: head.length + r, col, control: si === p.si ? p.c.name : null })),
    ]);
    layout = { id, kind, left: placed[0].c.left, tops, cols: placed.map((p) => p.c.width), rows, cells };
  }

  return grow(reflow(withLayouts({ ...doc, sections }, [...old, layout])));
}

/** Sections grow to hold what was placed; never shrink. */
const grow = (doc: DesignDoc): DesignDoc => ({ ...doc, sections: doc.sections.map((s) => {
  const b = Math.min(Math.max(0, ...s.controls.map(bottom)), MAX_TWIPS);
  return b > s.height ? { ...s, height: b } : s;
}) });

/**
 * A freshly inserted control dropped at `at` (section-relative twips) on a layout of that section joins it, as Access does.
 * Stacked: a new row above the row under the point (upper half) or below it, the control in the data column (column 1, or 0 when
 * the layout has a single column), its attached label detached into column 0; the row takes the control's height, reflow gives it
 * the column width. Tabular: a new column left/right of the column under the point (same half rule), the control in the row under
 * the point, its label in the nearest header row above (another section). The doc is unchanged for several names, a kind that
 * membersOf refuses (option group/button), a control outside `at.section` or already in a layout, a point outside every layout's
 * grid in that section, or a labelled control the layout has no place for the label of (one-column Stacked, Tabular with no
 * header row above).
 */
export function placeInLayout(doc: DesignDoc, names: string[], at: { section: SectionRef; x: number; y: number }): DesignDoc {
  const si = doc.sections.findIndex((s) => sectionRef(s) === at.section);
  const [m, ...more] = membersOf(doc, names);
  if (names.length !== 1 || !m || more.length || si < 0 || layoutOf(doc, m.control)) return doc;
  const c = doc.sections[si].controls.find((x) => sameName(x.name, m.control));
  if (!c) return doc;
  const label = attachedLabel(c) ?? null;
  const l = readLayouts(doc).find((x) => hits(x, at));
  if (!l) return doc;
  const { tops, lefts } = gridGeometry(l);
  const r = l.rows.flatMap((x, i) => (x.section === at.section && tops[i] <= at.y ? [i] : [])).pop()!;   // the row under the point
  let next: Layout, labelAt = si;
  if (l.kind === 'stacked') {
    const data = l.cols.length > 1 ? 1 : 0;
    if (label && !data) return doc;
    const row = r + (at.y < tops[r] + l.rows[r].height / 2 ? 0 : 1);
    next = { ...l, rows: [...l.rows.slice(0, row), { section: at.section, height: c.height }, ...l.rows.slice(row)],
      cells: [...l.cells.map((x) => (x.row >= row ? { ...x, row: x.row + 1 } : x)),
        ...l.cols.map((_, col) => ({ row, col, control: col === data ? c.name : col === 0 && label ? label.name : null }))] };
  } else {
    const k = lefts.filter((x) => x <= at.x).length - 1;   // the column under the point
    const col = k + (at.x < lefts[k] + l.cols[k] / 2 ? 0 : 1);
    const head = l.rows.map((_, i) => i).filter((i) => i < r && l.rows[i].section !== at.section).pop() ?? -1;
    labelAt = head < 0 ? -1 : doc.sections.findIndex((s) => sectionRef(s) === l.rows[head].section);
    if (label && labelAt < 0) return doc;
    next = { ...l, cols: [...l.cols.slice(0, col), c.width, ...l.cols.slice(col)],
      cells: [...l.cells.map((x) => (x.col >= col ? { ...x, col: x.col + 1 } : x)),
        ...l.rows.map((_, row) => ({ row, col, control: row === r ? c.name : row === head && label ? label.name : null }))] };
  }
  const tag = (x: ControlDef): ControlDef => ({ ...x, props: { ...x.props, LayoutID: l.id } });
  const sections = doc.sections.map((s, i) => {
    let controls = i !== si ? s.controls : s.controls.map((x) => {
      if (x !== c) return x;
      const { children, ...rest } = x;
      const kids = children?.filter((k) => k !== label);
      return tag(kids?.length ? { ...rest, children: kids } : rest);
    });
    if (label && i === labelAt) controls = [...controls, tag(label)];
    return controls === s.controls ? s : { ...s, controls };
  });
  return grow(replaceLayout({ ...doc, sections }, next));
}

/**
 * An existing top-level control joins the Tabular column of `member`, in a row of its own section (a footer total under its column).
 * Target row: the first row of the layout in that section with nothing in the column, else a new row after the section's last row
 * (or after the last row of an earlier section), as tall as the control; a section new to the layout starts at the control's top.
 * The doc is unchanged for a missing member/control, a Stacked layout, a nested control, one already in a layout, or the member itself.
 */
export function joinColumn(doc: DesignDoc, member: string, control: string): DesignDoc {
  const l = layoutOf(doc, member);
  const si = doc.sections.findIndex((s) => s.controls.some((x) => sameName(x.name, control)));
  if (!l || l.kind !== 'tabular' || si < 0 || sameName(member, control) || layoutOf(doc, control)) return doc;
  const c = doc.sections[si].controls.find((x) => sameName(x.name, control))!;
  const k = l.cells.find((x) => x.control !== null && sameName(x.control, member))!.col;
  const ref = sectionRef(doc.sections[si]);
  const order = (r: SectionRef) => doc.sections.findIndex((s) => sectionRef(s) === r);
  let row = l.rows.findIndex((x, i) => x.section === ref && !l.cells.some((y) => y.row === i && y.col === k && y.control !== null));
  let next: Layout;
  if (row >= 0) next = { ...l, cells: [...l.cells.filter((y) => y.row !== row || y.col !== k), { row, col: k, control: c.name }] };
  else {
    row = l.rows.reduce((n, x, i) => (order(x.section) <= si ? i + 1 : n), 0);
    next = { ...l, tops: l.rows.some((x) => x.section === ref) ? l.tops : { ...l.tops, [ref]: c.top },
      rows: [...l.rows.slice(0, row), { section: ref, height: c.height }, ...l.rows.slice(row)],
      cells: [...l.cells.map((y) => (y.row >= row ? { ...y, row: y.row + 1 } : y)), ...l.cols.map((_, col) => ({ row, col, control: col === k ? c.name : null }))] };
  }
  const sections = doc.sections.map((s, i) => (i !== si ? s
    : { ...s, controls: s.controls.map((x) => (x === c ? { ...x, props: { ...x.props, LayoutID: l.id } } : x)) }));
  return grow(replaceLayout({ ...doc, sections }, next));
}

/** The point lies on the layout's grid in that section (gaps included, empty edge cells included). */
function hits(l: Layout, at: { section: SectionRef; x: number; y: number }): boolean {
  const { tops, lefts } = gridGeometry(l);
  const rs = l.rows.flatMap((x, i) => (x.section === at.section ? [i] : []));
  if (!rs.length || !l.cols.length) return false;
  const [r0, r1, c1] = [rs[0], rs[rs.length - 1], l.cols.length - 1];
  return at.x >= l.left && at.x <= lefts[c1] + l.cols[c1] && at.y >= tops[r0] && at.y <= tops[r1] + l.rows[r1].height;
}
