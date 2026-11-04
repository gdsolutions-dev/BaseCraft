import { describe, expect, it } from 'vitest';
import type { ControlDef, DesignDoc, SectionDef } from './model';
import { cmToTwips as cm } from './model';
import { COL_GAP, ROW_GAP, labelOf, readLayouts, reflow, withLayouts, type Layout } from './layout';
import { createLayout, insertCells, joinColumn, membersOf, moveRow, placeInLayout, pruneLayouts, remapSections, removeLayout, selectionOf } from './layout-edit';

const ctl = (name: string, layoutId?: string): ControlDef =>
  ({ kind: 'textBox', name, left: 0, top: 0, width: 10, height: 10, props: layoutId ? { LayoutID: layoutId } : {} });
const sec = (kind: SectionDef['kind'], id: string | undefined, ...names: string[]): SectionDef =>
  ({ kind, height: 5000, props: {}, controls: names.map((n) => ctl(n, id)) });
const mk = (sections: SectionDef[], layouts: Layout[]): DesignDoc =>
  ({ formatVersion: '1.0', recordSource: null, props: { Layouts: layouts }, sections });
const byName = (d: DesignDoc, n: string) => d.sections.flatMap((s) => s.controls).find((c) => c.name === n)!;

const stacked = (): Layout => ({ id: 'L1', kind: 'stacked', left: 200, tops: { detail: 100 }, cols: [1000, 3000],
  rows: [{ section: 'detail', height: 400 }, { section: 'detail', height: 300 }],
  cells: [{ row: 0, col: 0, control: 'A' }, { row: 0, col: 1, control: 'B' }, { row: 1, col: 0, control: 'C' }, { row: 1, col: 1, control: 'D' }] });
const stackedDoc = () => reflow(mk([sec('detail', 'L1', 'A', 'B', 'C', 'D')], [stacked()]));
const tabular = (): Layout => ({ id: 'T', kind: 'tabular', left: 0, tops: { formHeader: 50, detail: 70 }, cols: [800, 900],
  rows: [{ section: 'formHeader', height: 200 }, { section: 'detail', height: 250 }],
  cells: [{ row: 0, col: 0, control: 'H0' }, { row: 0, col: 1, control: 'H1' }, { row: 1, col: 0, control: 'D0' }, { row: 1, col: 1, control: 'D1' }] });
const tabDoc = () => reflow(mk([sec('formHeader', 'T', 'H0', 'H1'), sec('detail', 'T', 'D0', 'D1')], [tabular()]));

describe('insertCells', () => {
  it('above adds an empty row and shifts the controls below down', () => {
    const d = insertCells(stackedDoc(), 'C', 'above');
    const l = readLayouts(d)[0];
    expect(l.rows).toHaveLength(3);
    expect(l.cells.filter((c) => c.row === 1).every((c) => c.control === null)).toBe(true);
    expect(byName(d, 'C').top).toBe(100 + 400 + ROW_GAP + 300 + ROW_GAP);
    expect(byName(d, 'A').top).toBe(100);
  });
  it('below uses the reference row height', () => {
    const l = readLayouts(insertCells(stackedDoc(), 'A', 'below'))[0];
    expect(l.rows[1]).toEqual({ section: 'detail', height: 400 });
  });
  it('left adds an empty column, widening the layout', () => {
    const d = insertCells(stackedDoc(), 'B', 'left');
    const l = readLayouts(d)[0];
    expect(l.cols).toEqual([1000, 3000, 3000]);
    expect(byName(d, 'B').left).toBe(200 + 1000 + COL_GAP + 3000 + COL_GAP);
    expect(byName(d, 'A').left).toBe(200);
  });
  it('right inserts after the reference column', () => {
    const l = readLayouts(insertCells(stackedDoc(), 'A', 'right'))[0];
    expect(l.cols).toEqual([1000, 1000, 3000]);
    expect(l.cells.find((c) => c.control === 'B')!.col).toBe(2);
  });
  it('inserts into the reference row section on a tabular layout', () => {
    const l = readLayouts(insertCells(tabDoc(), 'D0', 'above'))[0];
    expect(l.rows.map((r) => r.section)).toEqual(['formHeader', 'detail', 'detail']);
  });
  it('is a no-op for a control outside any layout', () => {
    const d = stackedDoc();
    expect(insertCells(d, 'Zed', 'above')).toBe(d);
  });
});

describe('moveRow', () => {
  it('swaps the tops of two stacked rows', () => {
    const d = moveRow(stackedDoc(), 'A', 1);
    expect(byName(d, 'A').top).toBe(100 + 300 + ROW_GAP);
    expect(byName(d, 'A').height).toBe(400);
    expect(byName(d, 'C').top).toBe(100);
  });
  it('is a no-op at an edge', () => {
    const d = stackedDoc();
    expect(moveRow(d, 'A', -1)).toBe(d);
  });
  it('is a no-op on a Tabular detail row (alone in its section)', () => {
    const d = tabDoc();
    expect(moveRow(d, 'D0', -1)).toBe(d);
    expect(moveRow(d, 'D0', 1)).toBe(d);
  });
});

describe('selectionOf', () => {
  it('layout / row / column on a stacked layout', () => {
    const d = stackedDoc();
    expect(selectionOf(d, 'A', 'layout').sort()).toEqual(['A', 'B', 'C', 'D']);
    expect(selectionOf(d, 'A', 'row').sort()).toEqual(['A', 'B']);
    expect(selectionOf(d, 'A', 'column').sort()).toEqual(['A', 'C']);
  });
  it('a Tabular column spans header and detail', () => {
    expect(selectionOf(tabDoc(), 'D1', 'column').sort()).toEqual(['D1', 'H1']);
  });
  it('is empty outside any layout', () => expect(selectionOf(stackedDoc(), 'Zed', 'row')).toEqual([]));
});

describe('removeLayout', () => {
  it('drops the layout and LayoutID, leaving coordinates', () => {
    const before = stackedDoc();
    const d = removeLayout(before, 'L1');
    expect(readLayouts(d)).toEqual([]);
    expect('Layouts' in d.props).toBe(false);
    expect(byName(d, 'C')).toMatchObject({ left: byName(before, 'C').left, top: byName(before, 'C').top });
    expect('LayoutID' in byName(d, 'C').props).toBe(false);
  });
  it('is a no-op for an unknown id', () => {
    const d = stackedDoc();
    expect(removeLayout(d, 'nope')).toBe(d);
  });
});

describe('pruneLayouts', () => {
  it('returns the same doc when nothing changes', () => {
    const d = stackedDoc();
    expect(pruneLayouts(d)).toBe(d);
  });
  it('turns a cell naming a deleted control into null, keeping rows and columns', () => {
    const d0 = stackedDoc();
    const d = pruneLayouts({ ...d0, sections: [{ ...d0.sections[0], controls: d0.sections[0].controls.filter((c) => c.name !== 'D') }] });
    const l = readLayouts(d)[0];
    expect(l.cells.find((c) => c.row === 1 && c.col === 1)!.control).toBeNull();
    expect(l.rows).toHaveLength(2);
    expect(l.cols).toHaveLength(2);
  });
  it('drops a layout with no member left, and strips orphan LayoutID', () => {
    const d0 = stackedDoc();
    const orphan = { ...d0.sections[0], controls: [ctl('X', 'L1')] };
    const d = pruneLayouts({ ...d0, sections: [orphan] });
    expect(readLayouts(d)).toEqual([]);
    expect('Layouts' in d.props).toBe(false);
    expect('LayoutID' in byName(d, 'X').props).toBe(false);
  });
});

// Capture S3: misaligned controls, each with an attached label (Actif's on its right).
const lbl = (name: string, left: number, top: number, width: number, height = 300): ControlDef =>
  ({ kind: 'label', name, left, top, width, height, props: { Caption: `${name}:` } });
const box = (kind: ControlDef['kind'], name: string, left: number, top: number, width: number, height: number, label?: ControlDef): ControlDef =>
  ({ kind, name, left, top, width, height, props: {}, ...(label ? { children: [label] } : {}) });
const s3 = (header?: ControlDef[]): DesignDoc => ({ formatVersion: '1.0', recordSource: null, props: {}, sections: [
  ...(header ? [{ kind: 'formHeader' as const, height: 100, props: {}, controls: header }] : []),
  { kind: 'detail', height: 500, props: {}, controls: [
    box('textBox', 'Nom', cm(1.753), cm(0.635), cm(4), cm(0.8), lbl('LNom', cm(1.753) - 600, cm(0.635), 500)),
    box('textBox', 'Ville', cm(1.9), cm(1.5), cm(3), cm(0.58), lbl('LVille', cm(1.9) - 600, cm(1.5), 550)),
    box('textBox', 'Inscrit', cm(1.65), cm(1.8), cm(5), cm(0.58), lbl('LInscrit', cm(1.65) - 650, cm(1.8), 600, 350)),
    box('textBox', 'Remarque', cm(1.75), cm(3.2), cm(4), cm(1.2), lbl('LRemarque', cm(1.75) - 800, cm(3.2), 750, 400)),
    box('checkBox', 'Actif', cm(7), cm(3.2), 260, 240, lbl('LActif', cm(7) + 300, cm(3.2), 500)),
  ] },
] });
const S3 = ['Nom', 'Ville', 'Inscrit', 'Remarque', 'Actif'];
const top = (d: DesignDoc) => d.sections.flatMap((s) => s.controls);
const sectionOf = (d: DesignDoc, n: string) => d.sections.find((s) => s.controls.some((c) => c.name === n))!.kind;
const stack = (d: DesignDoc, names: string[]) => createLayout(d, membersOf(d, names), 'stacked', { headerSection: 'formHeader' });
const tab = (d: DesignDoc, names: string[]) => createLayout(d, membersOf(d, names), 'tabular', { headerSection: 'formHeader' });

describe('membersOf', () => {
  it('keeps top-level controls, with their attached label implied', () => {
    expect(membersOf(s3(), ['Nom', 'Actif', 'Nope'])).toEqual([{ control: 'Nom' }, { control: 'Actif' }]);
  });
  it('drops option groups, option buttons, nested controls and unknown names', () => {
    const d = s3();
    d.sections[0].controls.push(box('optionGroup', 'Grp', 0, 3000, 2000, 1000), box('optionButton', 'Opt', 0, 4500, 260, 240));
    d.sections[0].controls[5].children = [box('optionButton', 'Opt1', 100, 3100, 260, 240)];
    expect(membersOf(d, ['Grp', 'Opt', 'Opt1', 'LNom', 'Ville'])).toEqual([{ control: 'Ville' }]);
  });
  it('a control without a label gets null; a layout label replaces the attached one and is not a member itself', () => {
    const d = stack(s3(), ['Nom']);
    d.sections[0].controls.push(box('tabControl', 'Onglet', 0, 4000, 3000, 1500));
    expect(membersOf(d, ['LNom', 'Nom', 'Onglet'])).toEqual([{ control: 'Nom', label: 'LNom' }, { control: 'Onglet', label: null }]);
  });
});

describe('createLayout stacked', () => {
  it('orders by top then left, label column = widest label, data column = widest control, row = control height', () => {
    const d = stack(s3(), S3);
    const l = readLayouts(d)[0];
    expect(l.kind).toBe('stacked');
    expect(l.cols).toEqual([750, cm(5)]);
    expect(l.rows.map((r) => r.height)).toEqual([cm(0.8), cm(0.58), cm(0.58), cm(1.2), 240]);
    expect(l.cells.filter((c) => c.col === 1).map((c) => c.control)).toEqual(S3);
    expect(l.cells.filter((c) => c.col === 0).map((c) => c.control)).toEqual(['LNom', 'LVille', 'LInscrit', 'LRemarque', 'LActif']);
  });
  it('sits at the top-left control (its label included), reflowed with the gaps', () => {
    const d = stack(s3(), S3);
    const l = readLayouts(d)[0];
    expect(l.left).toBe(cm(1.753) - 600);
    expect(l.tops).toEqual({ detail: cm(0.635) });
    expect(byName(d, 'Remarque')).toMatchObject({ left: l.left + 750 + COL_GAP, top: cm(0.635) + cm(0.8) + 2 * cm(0.58) + 3 * ROW_GAP, width: cm(5), height: cm(1.2) });
    expect(byName(d, 'LRemarque')).toMatchObject({ left: l.left, width: 750, height: cm(1.2) });
  });
  it('detaches each label into a top-level control of the same section, keeping its props, all tagged with the layout id', () => {
    const d = stack(s3(), S3);
    const id = readLayouts(d)[0].id;
    expect(top(d).find((c) => c.name === 'Nom')!.children).toBeUndefined();
    expect(byName(d, 'LNom').props).toEqual({ Caption: 'LNom:', LayoutID: id });
    expect(sectionOf(d, 'LNom')).toBe('detail');
    expect(S3.every((n) => byName(d, n).props.LayoutID === id)).toBe(true);
    expect(labelOf(d, 'Nom')?.name).toBe('LNom');
  });
  it('grows the section to contain the layout', () => {
    const d = stack(s3(), S3);
    const a = byName(d, 'Actif');
    expect(d.sections[0].height).toBe(a.top + a.height);
  });
  it('same top: leftmost first, at the position of that control', () => {
    const d = stack(s3(), ['Actif', 'Remarque']);
    const l = readLayouts(d)[0];
    expect(l.cells.filter((c) => c.col === 1).map((c) => c.control)).toEqual(['Remarque', 'Actif']);
    expect(l.tops.detail).toBe(cm(3.2));
    expect(byName(d, 'Nom').top).toBe(cm(0.635));   // untouched
  });
  it('a control without a label lands in column 0 and widens it (S1)', () => {
    const d0 = s3();
    d0.sections[0].controls.push(box('tabControl', 'Onglet', 0, cm(5), cm(5), 1500));
    const l = readLayouts(stack(d0, [...S3, 'Onglet']))[0];
    expect(l.cols[0]).toBe(cm(5));
    expect(l.cells.filter((c) => c.row === 5)).toEqual([{ row: 5, col: 0, control: 'Onglet' }, { row: 5, col: 1, control: null }]);
  });
  it('takes controls out of their previous layout; a layout left empty is dropped', () => {
    const d1 = stack(s3(), ['Nom', 'Ville']);
    const d2 = stack(d1, ['Ville']);
    const [a, b] = readLayouts(d2);
    expect(a.cells.filter((c) => c.row === 1).map((c) => c.control)).toEqual([null, null]);
    expect(b.id).not.toBe(a.id);
    expect(byName(d2, 'Ville').props.LayoutID).toBe(b.id);
    const d3 = stack(d2, ['Nom']);
    expect(readLayouts(d3).map((l) => l.id)).toEqual([b.id, expect.any(String)]);
  });
  it('ignores an option group and Default View', () => {
    const d0 = s3();
    d0.sections[0].controls.push(box('optionGroup', 'Grp', 0, cm(6), 2000, 1000));
    const a = stack(d0, [...S3, 'Grp']);
    expect(byName(a, 'Grp')).toEqual(byName(d0, 'Grp'));
    expect(stack({ ...d0, props: { DefaultView: 'continuous' } }, S3).sections).toEqual(stack({ ...d0, props: { DefaultView: 'single' } }, S3).sections);
  });
  it('returns the doc unchanged when there is no member', () => {
    const d = s3();
    expect(createLayout(d, [], 'stacked', { headerSection: 'formHeader' })).toBe(d);
    expect(stack(d, ['Nope'])).toBe(d);
  });
});

describe('createLayout tabular', () => {
  it('orders by left, one column per control width, one detail row as tall as the tallest control', () => {
    const d = tab(s3([]), S3);
    const l = readLayouts(d)[0];
    expect(l.kind).toBe('tabular');
    expect(l.cols).toEqual([cm(5), cm(4), cm(4), cm(3), 260]);
    expect(l.rows).toEqual([{ section: 'formHeader', height: 400 }, { section: 'detail', height: cm(1.2) }]);
    expect(l.cells.filter((c) => c.row === 1).map((c) => c.control)).toEqual(['Inscrit', 'Remarque', 'Nom', 'Ville', 'Actif']);
    expect(l.left).toBe(cm(1.65));
    expect(l.tops).toEqual({ formHeader: 0, detail: cm(1.8) });
  });
  it('moves each attached label into the header section, same name, column width', () => {
    const d = tab(s3([]), S3);
    expect(sectionOf(d, 'LInscrit')).toBe('formHeader');
    expect(top(d).find((c) => c.name === 'Inscrit')!.children).toBeUndefined();
    expect(byName(d, 'LInscrit')).toMatchObject({ left: cm(1.65), top: 0, width: cm(5), height: 400 });
    expect(byName(d, 'LRemarque')).toMatchObject({ left: cm(1.65) + cm(5) + COL_GAP, props: { Caption: 'LRemarque:' } });
    expect(labelOf(d, 'Remarque')?.name).toBe('LRemarque');
    expect(d.sections[0].height).toBe(400);   // header grew
  });
  it('the header row goes below existing header controls', () => {
    const d = tab(s3([lbl('Titre', 0, 0, 3000, 500)]), S3);
    expect(readLayouts(d)[0].tops.formHeader).toBe(500 + ROW_GAP);
  });
  it('turns a stacked layout into a tabular one, moving its labels to the header', () => {
    const d0 = stack(s3([]), S3);
    const d = tab(d0, top(d0).map((c) => c.name));
    const ls = readLayouts(d);
    expect(ls).toHaveLength(1);
    expect(ls[0].kind).toBe('tabular');
    expect(sectionOf(d, 'LNom')).toBe('formHeader');
  });
  it('is a no-op when the header section does not exist', () => {
    const d = s3();
    expect(tab(d, S3)).toBe(d);
  });
});

describe('removeLayout re-attaches labels', () => {
  it('Stacked: each column-0 label goes back into the children of the control on its row, coordinates and caption kept', () => {
    const d0 = stack(s3(), S3);
    const d = removeLayout(d0, readLayouts(d0)[0].id);
    for (const n of S3) {
      const kids = top(d).find((c) => c.name === n)!.children!;
      const l0 = top(d0).find((c) => c.name === `L${n}`)!;
      expect(kids).toEqual([{ ...l0, props: { Caption: `L${n}:` } }]);
      expect(top(d).some((c) => c.name === `L${n}`)).toBe(false);
      expect('LayoutID' in top(d).find((c) => c.name === n)!.props).toBe(false);
    }
  });
  it('Tabular: header labels stay top-level, without LayoutID', () => {
    const d0 = tab(s3([]), S3);
    const d = removeLayout(d0, readLayouts(d0)[0].id);
    expect(sectionOf(d, 'LNom')).toBe('formHeader');
    expect(byName(d, 'LNom').props).toEqual({ Caption: 'LNom:' });
  });
});

describe('remapSections', () => {
  const grouped = (): DesignDoc => mk([sec('groupHeader', 'L1', 'A', 'B'), sec('groupHeader', 'L2', 'C', 'D')].map((s, i) => ({ ...s, groupLevel: i })), [
    { id: 'L1', kind: 'stacked', left: 0, tops: { 'groupHeader:0': 10 }, cols: [100, 100], rows: [{ section: 'groupHeader:0', height: 10 }],
      cells: [{ row: 0, col: 0, control: 'A' }, { row: 0, col: 1, control: 'B' }] },
    { id: 'L2', kind: 'stacked', left: 0, tops: { 'groupHeader:1': 20 }, cols: [100, 100], rows: [{ section: 'groupHeader:1', height: 10 }],
      cells: [{ row: 0, col: 0, control: 'C' }, { row: 0, col: 1, control: 'D' }] }]);
  it('renames rows and tops keys at once (a swap does not collide); a dropped section loses its rows and cells', () => {
    const d = remapSections(grouped(), (r) => ({ 'groupHeader:0': 'groupHeader:1', 'groupHeader:1': 'groupHeader:0' }[r] ?? r));
    const [a, b] = d.props.Layouts as Layout[];
    expect([a.rows[0].section, Object.keys(a.tops), b.rows[0].section, b.tops]).toEqual(['groupHeader:1', ['groupHeader:1'], 'groupHeader:0', { 'groupHeader:0': 20 }]);
    const e = remapSections(grouped(), (r) => (r === 'groupHeader:0' ? null : r));
    expect((e.props.Layouts as Layout[])[0]).toMatchObject({ rows: [], cells: [], tops: {} });
  });
  it('is the same doc when nothing is renamed', () => {
    const d = grouped();
    expect(remapSections(d, (r) => r)).toBe(d);
  });
});

describe('createLayout over a report Tabular layout (labels in pageHeader)', () => {
  const rpt = (): DesignDoc => {
    const d = s3([]);
    const r = { ...d, sections: [{ ...d.sections[0], kind: 'pageHeader' as const }, d.sections[1]] };
    return createLayout(r, membersOf(r, S3), 'tabular', { headerSection: 'pageHeader' });
  };
  const LABELS = ['LNom', 'LVille', 'LInscrit', 'LRemarque', 'LActif'];
  it('selected whole and made Stacked: one clean layout, labels back in column 0 of the detail rows', () => {
    const d0 = rpt();
    const d = stack(d0, top(d0).map((c) => c.name));
    const ls = readLayouts(d);
    expect(ls).toHaveLength(1);
    expect(ls[0].kind).toBe('stacked');
    // one detail row: every control shares a top, so the order is by left
    expect(ls[0].cells.filter((c) => c.col === 0).map((c) => c.control)).toEqual(['LInscrit', 'LRemarque', 'LNom', 'LVille', 'LActif']);
    expect(LABELS.every((n) => sectionOf(d, n) === 'detail')).toBe(true);
  });
  it('selected whole and made Tabular again: one layout, labels on its header row', () => {
    const d0 = rpt();
    const d = createLayout(d0, membersOf(d0, top(d0).map((c) => c.name)), 'tabular', { headerSection: 'pageHeader' });
    const ls = readLayouts(d);
    expect(ls).toHaveLength(1);
    expect(ls[0].rows.map((r) => r.section)).toEqual(['pageHeader', 'detail']);
    expect(ls[0].cells.filter((c) => c.row === 0).map((c) => c.control)).toEqual(['LInscrit', 'LRemarque', 'LNom', 'LVille', 'LActif']);
  });
  it('unattached labels over the columns (a fresh report) join the header row', () => {
    const lab = (name: string, left: number): ControlDef => ({ ...ctl(name), kind: 'label', left, width: 100 });
    const d0 = mk([
      { kind: 'pageHeader', height: 5000, props: {}, controls: [lab('LA', 0), lab('LB', 100)] },
      { kind: 'detail', height: 5000, props: {}, controls: [{ ...ctl('A'), left: 0, width: 100 }, { ...ctl('B'), left: 100, width: 100 }] },
    ], []);
    const d = createLayout(d0, membersOf(d0, ['A', 'B'], 'pageHeader'), 'tabular', { headerSection: 'pageHeader' });
    expect(readLayouts(d)[0].cells.filter((c) => c.row === 0).map((c) => c.control)).toEqual(['LA', 'LB']);
  });
  it('only the data controls selected: their labels move with them, no layout of labels left behind', () => {
    const d = stack(rpt(), S3);
    expect(readLayouts(d)).toHaveLength(1);
    expect(LABELS.every((n) => sectionOf(d, n) === 'detail')).toBe(true);
  });
});

describe('placeInLayout', () => {
  const S = ['Nom', 'Ville', 'Inscrit'];
  /** A fresh control (as a tool or a field drop makes it) added to the section of that kind. */
  const drop = (d: DesignDoc, c: ControlDef, kind: SectionDef['kind'] = 'detail'): DesignDoc =>
    ({ ...d, sections: d.sections.map((s) => (s.kind === kind ? { ...s, controls: [...s.controls, c] } : s)) });
  const neuf = (h = 400) => box('textBox', 'Neuf', 6000, 6000, 2000, h, lbl('LNeuf', 4500, 6000, 1400));
  const geo = (d: DesignDoc, n: string) => { const c = byName(d, n); return { x: c.left, y: c.top, w: c.width, h: c.height }; };

  describe('Stacked (3 rows)', () => {
    const base = () => drop(stack(s3([]), S), neuf());
    const at = (d: DesignDoc, dy: (v: { y: number; h: number }) => number) => { const v = geo(d, 'Ville'); return { section: 'detail', x: v.x + 100, y: dy(v) }; };
    it('upper half of row 1: a new row 1, label detached into column 0, followers shifted by its height + ROW_GAP', () => {
      const d0 = base();
      const d = placeInLayout(d0, ['Neuf'], at(d0, (v) => v.y + 10));
      const l = readLayouts(d)[0];
      expect(l.rows).toHaveLength(4);
      expect(l.rows[1]).toEqual({ section: 'detail', height: 400 });
      expect(l.cells.filter((c) => c.row === 1).sort((a, b) => a.col - b.col).map((c) => c.control)).toEqual(['LNeuf', 'Neuf']);
      expect(byName(d, 'Neuf')).toMatchObject({ left: geo(d0, 'Ville').x, top: geo(d0, 'Ville').y, width: l.cols[1], height: 400, props: { LayoutID: l.id } });
      expect(byName(d, 'Neuf').children).toBeUndefined();
      expect(byName(d, 'LNeuf')).toMatchObject({ left: l.left, width: l.cols[0], height: 400, props: { Caption: 'LNeuf:', LayoutID: l.id } });
      expect(sectionOf(d, 'LNeuf')).toBe('detail');
      expect(labelOf(d, 'Neuf')?.name).toBe('LNeuf');
      expect(geo(d, 'Ville').y).toBe(geo(d0, 'Ville').y + 400 + ROW_GAP);
      expect(geo(d, 'Inscrit').y).toBe(geo(d0, 'Inscrit').y + 400 + ROW_GAP);
      expect(geo(d, 'Nom').y).toBe(geo(d0, 'Nom').y);
    });
    it('lower half of row 1: a new row 2', () => {
      const d0 = base();
      const d = placeInLayout(d0, ['Neuf'], at(d0, (v) => v.y + v.h - 10));
      expect(readLayouts(d)[0].cells.find((c) => c.control === 'Neuf')!.row).toBe(2);
      expect(geo(d, 'Ville').y).toBe(geo(d0, 'Ville').y);
      expect(geo(d, 'Inscrit').y).toBe(geo(d0, 'Inscrit').y + 400 + ROW_GAP);
    });
    it('a subform (no label) becomes one row, stretched to the data column width, its height kept, column 0 empty', () => {
      const d0 = drop(stack(s3([]), S), box('subform', 'Sous', 6000, 6000, 1000, 1500));
      const d = placeInLayout(d0, ['Sous'], at(d0, (v) => v.y + 10));
      const l = readLayouts(d)[0];
      expect(l.cells.filter((c) => c.row === 1).sort((a, b) => a.col - b.col).map((c) => c.control)).toEqual([null, 'Sous']);
      expect(byName(d, 'Sous')).toMatchObject({ left: geo(d0, 'Ville').x, width: l.cols[1], height: 1500 });
    });
    it('the section grows to hold the shifted rows', () => {
      const d0 = base();
      const d = placeInLayout(d0, ['Neuf'], at(d0, (v) => v.y + 10));
      const i = geo(d, 'Inscrit');
      expect(d.sections[1].height).toBeGreaterThanOrEqual(i.y + i.h);
    });
    it('placeInLayout then reflow is a no-op', () => {
      const d0 = base();
      const d = placeInLayout(d0, ['Neuf'], at(d0, (v) => v.y + 10));
      expect(reflow(d)).toBe(d);
    });
  });

  describe('Tabular (3 columns, header labels in the form header)', () => {
    const base = () => drop(tab(s3([]), S), neuf());
    it('right half of column 0: a new column 1, label in the header row, followers shifted right', () => {
      const d0 = base();
      const c0 = geo(d0, 'Inscrit');   // column 0 (leftmost)
      const d = placeInLayout(d0, ['Neuf'], { section: 'detail', x: c0.x + c0.w - 10, y: c0.y + 10 });
      const l = readLayouts(d)[0];
      expect(l.cols).toHaveLength(4);
      expect(l.cols[1]).toBe(2000);
      expect(l.cells.filter((c) => c.col === 1).sort((a, b) => a.row - b.row).map((c) => c.control)).toEqual(['LNeuf', 'Neuf']);
      expect(sectionOf(d, 'LNeuf')).toBe('formHeader');
      expect(sectionOf(d, 'Neuf')).toBe('detail');
      expect(labelOf(d, 'Neuf')?.name).toBe('LNeuf');
      expect(byName(d, 'Neuf')).toMatchObject({ left: c0.x + c0.w + COL_GAP, top: c0.y });
      expect(geo(d, 'Nom').x).toBe(geo(d0, 'Nom').x + 2000 + COL_GAP);
      expect(geo(d, 'LNom').x).toBe(geo(d0, 'LNom').x + 2000 + COL_GAP);
      expect(geo(d, 'Inscrit').x).toBe(c0.x);
      expect(reflow(d)).toBe(d);
    });
    it('left half of column 0: a new column 0', () => {
      const d0 = base();
      const c0 = geo(d0, 'Inscrit');
      const d = placeInLayout(d0, ['Neuf'], { section: 'detail', x: c0.x + 10, y: c0.y + 10 });
      expect(readLayouts(d)[0].cells.find((c) => c.control === 'Neuf')!.col).toBe(0);
      expect(geo(d, 'Neuf').x).toBe(c0.x);
      expect(geo(d, 'Inscrit').x).toBe(c0.x + 2000 + COL_GAP);
    });
    it('a labelled control dropped on the header row (no header row above it) stays free', () => {
      const d0 = drop(base(), box('textBox', 'Haut', 6000, 0, 2000, 300, lbl('LHaut', 4500, 0, 1400)), 'formHeader');
      const h = geo(d0, 'LInscrit');
      expect(placeInLayout(d0, ['Haut'], { section: 'formHeader', x: h.x + 10, y: h.y + 10 })).toBe(d0);
    });
  });

  describe('unchanged', () => {
    const d0 = () => drop(stack(s3([]), S), neuf());
    const inside = (d: DesignDoc) => { const v = geo(d, 'Ville'); return { section: 'detail', x: v.x + 100, y: v.y + 10 }; };
    it('an option group or an option button', () => {
      for (const kind of ['optionGroup', 'optionButton'] as const) {
        const d = drop(stack(s3([]), S), box(kind, 'Opt', 6000, 6000, 2000, 1000));
        expect(placeInLayout(d, ['Opt'], inside(d))).toBe(d);
      }
    });
    it('several controls', () => {
      const d = drop(d0(), box('textBox', 'Autre', 6000, 7000, 2000, 300));
      expect(placeInLayout(d, ['Neuf', 'Autre'], inside(d))).toBe(d);
    });
    it('a point outside every layout', () => {
      const d = d0();
      expect(placeInLayout(d, ['Neuf'], { section: 'detail', x: 10000, y: 10 })).toBe(d);
    });
    it('a point in a section where the layout has no row (form header present)', () => {
      const d = d0();
      const v = geo(d, 'Ville');
      expect(placeInLayout(d, ['Neuf'], { section: 'formHeader', x: v.x + 100, y: v.y + 10 })).toBe(d);
    });
    it('a control in another section than the point', () => {
      const d = drop(stack(s3([]), S), box('textBox', 'Haut', 6000, 0, 2000, 300), 'formHeader');
      expect(placeInLayout(d, ['Haut'], inside(d))).toBe(d);
    });
    it('a labelled control on a one-column Stacked layout (no label column)', () => {
      const d1 = s3();
      d1.sections[0].controls.push(box('commandButton', 'B1', 0, cm(6), 1000, 300), box('commandButton', 'B2', 0, cm(7), 1000, 300));
      const d = drop(stack(d1, ['B1', 'B2']), neuf());
      const b = geo(d, 'B1');
      expect(placeInLayout(d, ['Neuf'], { section: 'detail', x: b.x + 10, y: b.y + 10 })).toBe(d);
    });
    it('a control that is already a member', () => {
      const d = d0();
      expect(placeInLayout(d, ['Nom'], inside(d))).toBe(d);
    });
  });
});

describe('joinColumn', () => {
  const tot = (name: string, left = 0, top = 57, height = 340): ControlDef => ({ ...ctl(name), left, top, width: 10, height });
  const withFooters = (kind: SectionDef['kind'], ...cs: ControlDef[]) => ({ kind, height: 454, props: {}, controls: cs }) as SectionDef;
  const base = (...footer: ControlDef[]) => reflow(mk([sec('formHeader', 'T', 'H0', 'H1'), sec('detail', 'T', 'D0', 'D1'), withFooters('reportFooter', ...footer)], [tabular()]));
  const rows = (d: DesignDoc) => readLayouts(d)[0].rows.map((r) => r.section);

  it('joins column 1 with a reportFooter row', () => {
    const d0 = base(tot('Tot'));
    const d = joinColumn(d0, 'D1', 'Tot');
    const l = readLayouts(d)[0];
    expect(l.tops.reportFooter).toBe(57);
    expect(rows(d)).toEqual(['formHeader', 'detail', 'reportFooter']);
    expect(l.cells.find((c) => c.control === 'Tot')).toMatchObject({ row: 2, col: 1 });
    expect(byName(d, 'Tot')).toMatchObject({ left: byName(d, 'D1').left, width: 900, top: 57, height: 340, props: { LayoutID: 'T' } });
  });
  it('a second control for the same column goes on a new row; a column 0 control fills the first row', () => {
    let d = joinColumn(base(tot('A1'), tot('A2'), tot('B1')), 'D1', 'A1');
    d = joinColumn(d, 'D1', 'A2');
    expect(rows(d).filter((r) => r === 'reportFooter')).toHaveLength(2);
    expect(readLayouts(d)[0].cells.find((c) => c.control === 'A1')).toMatchObject({ row: 2, col: 1 });
    expect(readLayouts(d)[0].cells.find((c) => c.control === 'A2')).toMatchObject({ row: 3, col: 1 });
    d = joinColumn(d, 'D0', 'B1');
    expect(rows(d).filter((r) => r === 'reportFooter')).toHaveLength(2);
    expect(readLayouts(d)[0].cells.find((c) => c.control === 'B1')).toMatchObject({ row: 2, col: 0 });
  });
  it('widening the column widens the total', () => {
    const d = joinColumn(base(tot('Tot')), 'D1', 'Tot');
    const l = readLayouts(d)[0];
    expect(byName(reflow(withLayouts(d, [{ ...l, cols: [800, 1200] }])), 'Tot').width).toBe(1200);
  });
  it('a group footer total joins on its own row, before the report footer rows', () => {
    const gf = { ...withFooters('groupFooter', tot('G')), groupLevel: 0 } as SectionDef;
    const d0 = reflow(mk([sec('formHeader', 'T', 'H0', 'H1'), sec('detail', 'T', 'D0', 'D1'), gf, withFooters('reportFooter', tot('R'))], [tabular()]));
    const d = joinColumn(joinColumn(d0, 'D1', 'R'), 'D1', 'G');
    expect(rows(d)).toEqual(['formHeader', 'detail', 'groupFooter:0', 'reportFooter']);
    expect(readLayouts(d)).toHaveLength(1);
  });
  it('is the same doc for a Stacked member, a non-member, a control already in a layout, a missing control, the member itself', () => {
    const t = base(tot('Tot'));
    expect(joinColumn(t, 'D1', 'Nope')).toBe(t);
    expect(joinColumn(t, 'D1', 'D1')).toBe(t);
    expect(joinColumn(t, 'D1', 'D0')).toBe(t);
    expect(joinColumn(t, 'Tot', 'D0')).toBe(t);
    expect(joinColumn(t, 'Nope', 'Tot')).toBe(t);
    const s = stackedDoc();
    expect(joinColumn({ ...s, sections: [...s.sections, withFooters('reportFooter', tot('X'))] }, 'B', 'X').props).toBe(s.props);
  });
  it('after the Detail box is deleted the total stays a member; removeLayout strips its LayoutID', () => {
    const d = joinColumn(base(tot('Tot')), 'D1', 'Tot');
    const del = { ...d, sections: d.sections.map((s) => ({ ...s, controls: s.controls.filter((c) => c.name !== 'D1') })) };
    const p = pruneLayouts(del);
    expect(readLayouts(p)[0].cells.some((c) => c.control === 'Tot')).toBe(true);
    expect(byName(p, 'Tot').props.LayoutID).toBe('T');
    expect('LayoutID' in byName(removeLayout(p, 'T'), 'Tot').props).toBe(false);
  });
});
