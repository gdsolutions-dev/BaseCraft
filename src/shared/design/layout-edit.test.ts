import { describe, expect, it } from 'vitest';
import type { ControlDef, DesignDoc, SectionDef } from './model';
import { cmToTwips as cm } from './model';
import { COL_GAP, INSERT_ROW_HEIGHT, ROW_GAP, emptyCellsOf, labelOf, readLayouts, reflow, withLayouts, type Layout } from './layout';
import { canMerge, createLayout, deleteLines, emptyCellAt, fillCell, selectionIn, setCellProp, setCellSize, slotOf, insertCells, mergeCells, splitCell, joinColumn, membersOf, moveRow, placeInLayout, pruneLayouts, remapSections, removeLayout, selectionOf } from './layout-edit';

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
    expect(byName(d, 'C').top).toBe(100 + 400 + ROW_GAP + INSERT_ROW_HEIGHT + ROW_GAP);
    expect(byName(d, 'A').top).toBe(100);
  });
  it('below inserts a row of INSERT_ROW_HEIGHT and shifts the rows under it', () => {
    const d = insertCells(stackedDoc(), 'A', 'below');
    expect(readLayouts(d)[0].rows[1]).toEqual({ section: 'detail', height: INSERT_ROW_HEIGHT });
    expect(INSERT_ROW_HEIGHT).toBe(240);
    expect(byName(d, 'C').top).toBe(100 + 400 + ROW_GAP + 240 + ROW_GAP);
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

describe('cell spans in edits', () => {
  const wide = (): Layout => ({ ...stacked(), cells: [{ row: 0, col: 0, colSpan: 2, control: 'A' }, { row: 1, col: 0, control: 'C' }, { row: 1, col: 1, control: 'D' }] });
  const tall = (): Layout => ({ ...stacked(), cells: [{ row: 0, col: 0, rowSpan: 2, control: 'A' }, { row: 0, col: 1, control: 'B' }, { row: 1, col: 1, control: 'D' }] });
  const wdoc = () => reflow(mk([sec('detail', 'L1', 'A', 'C', 'D')], [wide()]));
  const tdoc = () => reflow(mk([sec('detail', 'L1', 'A', 'B', 'D')], [tall()]));
  it('back-compat: createLayout then reflow gives the same object, Stacked and Tabular', () => {
    const s = stack(s3(), S3), t = tab(s3([]), S3);
    expect(reflow(s)).toBe(s);
    expect(reflow(t)).toBe(t);
  });
  it('insert right of a member under a spanning cell widens the span', () => {
    const l = readLayouts(insertCells(wdoc(), 'C', 'right'))[0];
    expect(l.cols).toHaveLength(3);
    expect(l.cells.find((c) => c.control === 'A')).toMatchObject({ col: 0, colSpan: 3 });
    expect(l.cells.filter((c) => c.control === null)).toHaveLength(1);   // only row 1 gets a new empty slot
  });
  it('insert below under a row crossed by a rowSpan grows the span', () => {
    const l = readLayouts(insertCells(tdoc(), 'B', 'below'))[0];
    expect(l.rows).toHaveLength(3);
    expect(l.cells.find((c) => c.control === 'A')).toMatchObject({ rowSpan: 3 });
    expect(l.cells.find((c) => c.control === 'D')).toMatchObject({ row: 2 });
  });
  it('moveRow across a vertical span is a no-op', () => {
    const d = tdoc();
    expect(moveRow(d, 'B', 1)).toBe(d);
  });
  it('selectionOf column includes a cell spanning the column', () => {
    expect(selectionOf(wdoc(), 'D', 'column').sort()).toEqual(['A', 'D']);
  });
  it('removeLayout, pruneLayouts and remapSections keep spans valid', () => {
    const d = tdoc();
    expect(readLayouts(removeLayout(d, 'zz'))).toHaveLength(1);
    expect(readLayouts(pruneLayouts({ ...d, sections: [{ ...d.sections[0], controls: d.sections[0].controls.filter((c) => c.name !== 'B') }] }))).toHaveLength(1);
    const two = reflow(mk([sec('detail', 'L1', 'A', 'B', 'D')], [{ ...tall(), rows: [{ section: 'formHeader', height: 400 }, { section: 'detail', height: 400 }], tops: { formHeader: 0, detail: 0 } }]));
    const r = remapSections(two, (x) => (x === 'formHeader' ? null : x));
    expect(readLayouts(r)).toHaveLength(1);
    expect(readLayouts(r)[0].cells.find((c) => c.control === 'A')).not.toHaveProperty('rowSpan');
  });
});

describe('cell spans in placeInLayout, joinColumn, selectionOf, insertCells above/left', () => {
  const kept = (d: DesignDoc) => { expect(readLayouts(d)).toHaveLength(1); return readLayouts(d)[0]; };
  const fresh = (name: string): ControlDef => ({ ...ctl(name), left: 6000, top: 6000, width: 2000, height: 400 });
  const add = (d: DesignDoc, kind: SectionDef['kind'], c: ControlDef): DesignDoc =>
    ({ ...d, sections: d.sections.map((s) => (s.kind === kind ? { ...s, controls: [...s.controls, c] } : s)) });
  // 3 rows x 2 cols; A spans rows 0-1 of column 0
  const tall3 = (): Layout => ({ ...stacked(), rows: [...stacked().rows, { section: 'detail', height: 300 }],
    cells: [{ row: 0, col: 0, rowSpan: 2, control: 'A' }, { row: 0, col: 1, control: 'B' }, { row: 1, col: 1, control: 'D' }, { row: 2, col: 0, control: 'E' }, { row: 2, col: 1, control: 'F' }] });
  const t3 = () => reflow(mk([sec('detail', 'L1', 'A', 'B', 'D', 'E', 'F')], [tall3()]));
  const rowTop = (d: DesignDoc, i: number) => { const l = readLayouts(d)[0]; return l.rows.slice(0, i).reduce((n, r) => n + r.height + ROW_GAP, l.tops.detail); };

  it('placeInLayout (Stacked) through a rowSpan widens it and keeps the layout', () => {
    const d0 = add(t3(), 'detail', fresh('Neuf'));
    const d = placeInLayout(d0, ['Neuf'], { section: 'detail', x: byName(d0, 'B').left + 10, y: rowTop(d0, 1) + 10 });
    const l = kept(d);
    expect(l.rows).toHaveLength(4);
    expect(l.cells.find((c) => c.control === 'A')).toMatchObject({ rowSpan: 3 });
    expect(l.cells.find((c) => c.control === 'Neuf')).toMatchObject({ row: 1, col: 1 });
  });
  it('placeInLayout is a no-op when a span covers the data column it needs', () => {
    const wide = (): Layout => ({ ...stacked(), rows: [...stacked().rows, { section: 'detail', height: 300 }],
      cells: [{ row: 0, col: 0, control: 'A' }, { row: 0, col: 1, rowSpan: 2, control: 'B' }, { row: 1, col: 0, control: 'C' }, { row: 2, col: 0, control: 'E' }, { row: 2, col: 1, control: 'F' }] });
    const d0 = add(reflow(mk([sec('detail', 'L1', 'A', 'B', 'C', 'E', 'F')], [wide()])), 'detail', fresh('Neuf'));
    expect(placeInLayout(d0, ['Neuf'], { section: 'detail', x: byName(d0, 'A').left + 10, y: rowTop(d0, 1) + 10 })).toBe(d0);
  });
  it('placeInLayout (Tabular) through a colSpan widens it and keeps the layout', () => {
    const t: Layout = { ...tabular(), cols: [800, 900, 700], cells: [{ row: 0, col: 0, colSpan: 2, control: 'H0' }, { row: 0, col: 2, control: 'H2' },
      { row: 1, col: 0, control: 'D0' }, { row: 1, col: 1, control: 'D1' }, { row: 1, col: 2, control: 'D2' }] };
    const d0 = add(reflow(mk([sec('formHeader', 'T', 'H0', 'H2'), sec('detail', 'T', 'D0', 'D1', 'D2')], [t])), 'detail', fresh('Neuf'));
    const g = readLayouts(d0)[0];
    const d = placeInLayout(d0, ['Neuf'], { section: 'detail', x: g.left + 800 + 10, y: byName(d0, 'D1').top + 10 });   // left half of column 1
    const l = kept(d);
    expect(l.cols).toHaveLength(4);
    expect(l.cells.find((c) => c.control === 'H0')).toMatchObject({ colSpan: 3 });
    expect(l.cells.find((c) => c.control === 'Neuf')).toMatchObject({ row: 1, col: 1 });
  });
  it('joinColumn skips a row whose column is covered by a colSpan', () => {
    const t: Layout = { ...tabular(), tops: { ...tabular().tops, reportFooter: 20 }, rows: [...tabular().rows, { section: 'reportFooter', height: 250 }],
      cells: [{ row: 0, col: 0, control: 'H0' }, { row: 0, col: 1, control: 'H1' }, { row: 1, col: 0, control: 'D0' }, { row: 1, col: 1, control: 'D1' }, { row: 2, col: 0, colSpan: 2, control: 'Tot0' }] };
    const foot = { kind: 'reportFooter', height: 454, props: {}, controls: [{ ...ctl('Tot0', 'T') }, { ...ctl('Tot'), top: 57 }] } as SectionDef;
    const d0 = reflow(mk([sec('formHeader', 'T', 'H0', 'H1'), sec('detail', 'T', 'D0', 'D1'), foot], [t]));
    const l = kept(joinColumn(d0, 'D1', 'Tot'));
    expect(l.cells.find((c) => c.control === 'Tot0')).toMatchObject({ colSpan: 2 });
    expect(l.rows.map((r) => r.section)).toEqual(['formHeader', 'detail', 'reportFooter', 'reportFooter']);
    expect(l.cells.find((c) => c.control === 'Tot')).toMatchObject({ row: 3, col: 1 });
  });
  it('joinColumn new row through a rowSpan keeps the layout', () => {
    const t: Layout = { ...tabular(), rows: [...tabular().rows, { section: 'detail', height: 250 }],
      cells: [{ row: 0, col: 0, control: 'H0' }, { row: 0, col: 1, control: 'H1' }, { row: 1, col: 0, control: 'D0' }, { row: 1, col: 1, rowSpan: 2, control: 'D1' }, { row: 2, col: 0, control: 'E0' }] };
    const foot = { kind: 'reportFooter', height: 454, props: {}, controls: [{ ...ctl('Tot'), top: 57 }] } as SectionDef;
    const d0 = reflow(mk([sec('formHeader', 'T', 'H0', 'H1'), sec('detail', 'T', 'D0', 'D1', 'E0'), foot], [t]));
    const l = kept(joinColumn(d0, 'D1', 'Tot'));
    expect(l.cells.find((c) => c.control === 'Tot')).toMatchObject({ row: 3, col: 1 });
  });
  it("selectionOf honours the reference cell's own span", () => {
    expect(selectionOf(t3(), 'A', 'row').sort()).toEqual(['A', 'B', 'D']);
    const w = reflow(mk([sec('detail', 'L1', 'A', 'C', 'D')], [{ ...stacked(), cells: [{ row: 0, col: 0, colSpan: 2, control: 'A' }, { row: 1, col: 0, control: 'C' }, { row: 1, col: 1, control: 'D' }] }]));
    expect(selectionOf(w, 'A', 'column').sort()).toEqual(['A', 'C', 'D']);
  });
  it('insertCells above a row crossed by a rowSpan widens it', () => {
    const l = kept(insertCells(t3(), 'D', 'above'));
    expect(l.cells.find((c) => c.control === 'A')).toMatchObject({ rowSpan: 3 });
    expect(l.cells.find((c) => c.control === 'D')).toMatchObject({ row: 2 });
    expect(l.cells.filter((c) => c.control === null)).toEqual([{ row: 1, col: 1, control: null }]);
  });
  it('insertCells left of a column crossed by a colSpan widens it', () => {
    const w = reflow(mk([sec('detail', 'L1', 'A', 'C', 'D')], [{ ...stacked(), cells: [{ row: 0, col: 0, colSpan: 2, control: 'A' }, { row: 1, col: 0, control: 'C' }, { row: 1, col: 1, control: 'D' }] }]));
    const l = kept(insertCells(w, 'D', 'left'));
    expect(l.cells.find((c) => c.control === 'A')).toMatchObject({ colSpan: 3 });
    expect(l.cells.find((c) => c.control === 'D')).toMatchObject({ col: 2 });
  });
});

describe('mergeCells / splitCell', () => {
  const wide = () => insertCells(stackedDoc(), 'B', 'right');   // cols [1000, 3000, 3000]; (0,2) and (1,2) empty
  const tall = () => reflow(mk([sec('detail', 'L1', 'A', 'B', 'C', 'D')], [{ ...stacked(), rows: [{ section: 'detail', height: 340 }, { section: 'detail', height: 300 }] }]));
  it('canMerge: not two controls; a control + its empty neighbour; not a non-rectangle nor two sections', () => {
    expect(canMerge(stackedDoc(), 'L1', [{ row: 0, col: 0 }, { row: 0, col: 1 }])).toBe(false);
    expect(canMerge(wide(), 'L1', [{ row: 0, col: 1 }, { row: 0, col: 2 }])).toBe(true);
    expect(canMerge(wide(), 'L1', [{ row: 0, col: 2 }, { row: 1, col: 2 }, { row: 1, col: 1 }])).toBe(false);
    const t = insertCells(tabDoc(), 'H1', 'right');
    expect(canMerge(t, 'T', [{ row: 0, col: 2 }, { row: 1, col: 2 }])).toBe(false);
    expect(canMerge(wide(), 'L1', [{ row: 0, col: 1 }])).toBe(false);
  });
  it('merge: one cell, the control takes the merged width, props untouched', () => {
    const d = wide();
    const m = mergeCells(d, 'L1', [{ row: 0, col: 1 }, { row: 0, col: 2 }]);
    expect(readLayouts(m)[0].cells.find((c) => c.control === 'B')).toEqual({ row: 0, col: 1, colSpan: 2, control: 'B' });
    expect(byName(m, 'B').width).toBe(3000 + COL_GAP + 3000);
    expect(byName(m, 'B').props).toEqual(byName(d, 'B').props);
  });
  it('split vertical: halves 85/85, others span both, new row in the section, same total height', () => {
    const d = tall();
    const s = splitCell(d, 'L1', { row: 0, col: 1 }, 'vertical');
    const l = readLayouts(s)[0];
    expect(l.rows.map((r) => r.height)).toEqual([85, 85, 300]);
    expect(l.rows[1].section).toBe('detail');
    expect(l.cells.find((c) => c.control === 'A')!.rowSpan).toBe(2);
    expect(byName(s, 'B').height).toBe(85);
    expect(l.rows[0].height + ROW_GAP + l.rows[1].height).toBe(340);
    expect(byName(s, 'C').top).toBe(byName(d, 'C').top);
    expect(mergeCells(s, 'L1', [{ row: 0, col: 1 }, { row: 1, col: 1 }])).toEqual(d);
  });
  it('split horizontal: left half keeps the control, remainder on the first half; round trip', () => {
    const d = stackedDoc();   // B is 3000 wide: (3000 - 57) / 2 = 1471.5 -> 1471 + remainder 1472
    const s = splitCell(d, 'L1', { row: 0, col: 1 }, 'horizontal');
    expect(readLayouts(s)[0].cols).toEqual([1000, 1472, 1471]);
    expect(byName(s, 'B').width).toBe(1472);
    expect(mergeCells(s, 'L1', [{ row: 0, col: 1 }, { row: 0, col: 2 }])).toEqual(d);
  });
  it('split of a colSpan 2 cell is horizontal without a new column', () => {
    const m = mergeCells(wide(), 'L1', [{ row: 0, col: 1 }, { row: 0, col: 2 }]);
    const s = splitCell(m, 'L1', { row: 0, col: 1 }, 'horizontal');
    expect(readLayouts(s)[0].cols).toHaveLength(3);
    expect(readLayouts(s)[0].cells.filter((c) => c.row === 0 && c.col > 0).every((c) => !c.colSpan)).toBe(true);
  });
  it('split is a no-op when a half would be under 1 twip', () => {
    const d = stackedDoc();   // row 1 is 300 high; make it 171 -> (171 - 170) / 2 = 0
    const thin = reflow(withLayouts(d, [{ ...stacked(), rows: [{ section: 'detail', height: 400 }, { section: 'detail', height: 171 }] }]));
    expect(splitCell(thin, 'L1', { row: 1, col: 1 }, 'vertical')).toBe(thin);
  });
});

describe('padded layouts (L4 review fixes)', () => {
  const pad = (d: DesignDoc, name: string, props: Record<string, unknown>): DesignDoc =>
    ({ ...d, sections: d.sections.map((s) => ({ ...s, controls: s.controls.map((c) => (c.name === name ? { ...c, props: { ...c.props, ...props } } : c)) })) });
  const withN = (d: DesignDoc, section = 'detail'): DesignDoc =>
    ({ ...d, sections: d.sections.map((s) => (s.kind === section ? { ...s, controls: [...s.controls, ctl('N')] } : s)) });

  it('a drop on the padded right or bottom edge hits the layout', () => {
    const d = withN(reflow(pad(pad(stackedDoc(), 'B', { RightPadding: 500 }), 'D', { BottomPadding: 500 })));
    expect(readLayouts(placeInLayout(d, ['N'], { section: 'detail', x: 4500, y: 200 }))[0].rows).toHaveLength(3);
    expect(readLayouts(placeInLayout(d, ['N'], { section: 'detail', x: 500, y: 1300 }))[0].rows).toHaveLength(3);
  });
  it('before/after is decided on the padded extent', () => {
    const s = withN(reflow(pad(stackedDoc(), 'A', { BottomPadding: 400 })));   // row 0: top 100, padded height 800
    expect(readLayouts(placeInLayout(s, ['N'], { section: 'detail', x: 500, y: 450 }))[0].rows[0].height).toBe(10);
    const t = withN(reflow(pad(tabDoc(), 'D0', { RightPadding: 1000 })));   // col 0: padded width 1800
    expect(readLayouts(placeInLayout(t, ['N'], { section: 'detail', x: 500, y: 100 }))[0].cols[0]).toBe(10);
  });
  it('grouping padded controls keeps the first one where it was', () => {
    const at = (name: string, top: number) => ({ ...ctl(name), left: 300, top, width: 1000, height: 200, props: { LeftPadding: 100, TopPadding: 50 } });
    const d: DesignDoc = { formatVersion: '1.0', recordSource: null, props: {}, sections: [{ kind: 'detail', height: 5000, props: {}, controls: [at('A', 200), at('B', 600)] }] };
    const out = createLayout(d, [{ control: 'A' }, { control: 'B' }], 'stacked', { headerSection: 'formHeader' });
    expect([byName(out, 'A').left, byName(out, 'A').top]).toEqual([300, 200]);
  });
});

describe('empty cell props', () => {
  const fmt = { BackColor: '#ff0000', TopPadding: 180 };
  const withProps = (cells: Layout['cells']) => mk([sec('detail', 'L1', 'A', 'B')], [{ id: 'L1', kind: 'stacked', left: 0, tops: { detail: 0 }, cols: [1000, 1000],
    rows: [{ section: 'detail', height: 300 }, { section: 'detail', height: 300 }], cells }]);
  it('merging two empty cells keeps the top-left cell props', () => {
    const d = withProps([{ row: 0, col: 0, control: 'A' }, { row: 0, col: 1, control: 'B' }, { row: 1, col: 0, control: null, props: fmt }, { row: 1, col: 1, control: null, props: { Tag: 'x' } }]);
    const m = readLayouts(mergeCells(d, 'L1', [{ row: 1, col: 1 }, { row: 1, col: 0 }]))[0];
    expect(m.cells.find((c) => c.control === null)).toMatchObject({ row: 1, col: 0, colSpan: 2, props: fmt });
  });
  it('merging a control with a formatted empty cell leaves no props', () => {
    const d = withProps([{ row: 0, col: 0, control: 'A' }, { row: 0, col: 1, control: null, props: fmt }, { row: 1, col: 0, control: 'B' }, { row: 1, col: 1, control: null }]);
    const c = readLayouts(mergeCells(d, 'L1', [{ row: 0, col: 0 }, { row: 0, col: 1 }]))[0].cells.find((x) => x.control === 'A')!;
    expect(c.props).toBeUndefined();
  });
  it('splitting a formatted empty cell gives both parts its props', () => {
    const d = withProps([{ row: 0, col: 0, control: 'A' }, { row: 0, col: 1, control: 'B' }, { row: 1, col: 0, control: null, props: fmt, colSpan: 2 }]);
    const h = readLayouts(splitCell(d, 'L1', { row: 1, col: 0 }, 'horizontal'))[0].cells.filter((c) => c.control === null);
    expect(h).toHaveLength(2);
    for (const c of h) expect(c.props).toEqual(fmt);
    const d2 = withProps([{ row: 0, col: 0, control: 'A' }, { row: 0, col: 1, control: 'B' }, { row: 1, col: 0, control: null, props: fmt }, { row: 1, col: 1, control: null }]);
    const v = readLayouts(splitCell(d2, 'L1', { row: 1, col: 0 }, 'vertical'))[0].cells.filter((c) => c.control === null && c.col === 0);
    expect(v).toHaveLength(2);
    for (const c of v) expect(c.props).toEqual(fmt);
  });
  it('moveRow keeps the props of the cells it moves', () => {
    const d = withProps([{ row: 0, col: 0, control: 'A' }, { row: 0, col: 1, control: null, props: fmt }, { row: 1, col: 0, control: 'B' }, { row: 1, col: 1, control: null }]);
    expect(readLayouts(moveRow(d, 'A', 1))[0].cells.find((c) => c.props)).toMatchObject({ row: 1, col: 1, props: fmt });
  });
  it('an L4 layout with null cells reflows identically and round-trips', () => {
    for (const d of [stackedDoc(), tabDoc(), insertCells(stackedDoc(), 'A', 'below')]) {
      expect(reflow(d)).toBe(d);
      expect(JSON.stringify(readLayouts(d))).toBe(JSON.stringify(d.props.Layouts));
    }
  });
});

describe('empty cell fill, delete, select', () => {
  // Stacked Nom, Ville, Inscrit with an empty row 2 inserted below Ville
  const base = () => insertCells(stack(s3([]), ['Nom', 'Ville', 'Inscrit']), 'Ville', 'below');
  const ref = (row: number, col: number) => ({ layout: 'L1', row, col });
  const cellsOf = (d: DesignDoc) => readLayouts(d)[0].cells;
  const at = (d: DesignDoc, row: number, col: number) => cellsOf(d).find((c) => c.row === row && c.col === col)!;
  const props = { BackColor: '#ff0000', GridlineStyleTop: 'solid', TopPadding: 180 };
  const withProps = (d: DesignDoc) => withLayouts(d, readLayouts(d).map((l) => ({ ...l, cells: l.cells.map((c) => (c.row === 2 && c.col === 1 ? { ...c, props } : c)) })));
  const add = (d: DesignDoc, c: ControlDef) => ({ ...d, sections: d.sections.map((s) => (s.kind === 'detail' ? { ...s, controls: [...s.controls, c] } : s)) });

  it('slotOf and emptyCellAt', () => {
    const d = base();
    expect(slotOf(d, 'Nom')).toEqual(ref(0, 1));
    expect(slotOf(d, 'Zed')).toBeNull();
    const r = emptyCellsOf(d).find((e) => e.row === 2 && e.col === 1)!.rect;
    expect(emptyCellAt(d, { section: 'detail', x: r.left + r.width / 2, y: r.top + r.height / 2 })).toEqual(ref(2, 1));
    expect(emptyCellAt(d, { section: 'detail', x: r.left, y: r.top + r.height + 10 })).toBeNull();
    expect(emptyCellAt(d, { section: 'formHeader', x: r.left + 1, y: r.top + 1 })).toBeNull();
  });
  it('fresh fill: rectangle, LayoutID, props merged, cell loses its props', () => {
    const d = withProps(base());
    const out = fillCell(add(d, lbl('Neuf', 0, 0, 100)), ref(2, 1), 'Neuf', { fresh: true });
    const n = byName(out, 'Neuf'), r = emptyCellsOf(d).find((e) => e.row === 2 && e.col === 1)!.rect;
    expect({ left: n.left, top: n.top, width: n.width, height: n.height }).toEqual(r);
    expect(n.props).toEqual({ Caption: 'Neuf:', LayoutID: 'L1', ...props });
    expect(at(out, 2, 1)).toEqual({ row: 2, col: 1, control: 'Neuf' });
  });
  it('fresh: false keeps the control props and discards the cell ones', () => {
    const out = fillCell(add(withProps(base()), lbl('Neuf', 0, 0, 100)), ref(2, 1), 'Neuf', { fresh: false });
    expect(byName(out, 'Neuf').props).toEqual({ Caption: 'Neuf:', LayoutID: 'L1' });
    expect(at(out, 2, 1)).toEqual({ row: 2, col: 1, control: 'Neuf' });
  });
  it('a member of the same layout leaves its cell', () => {
    const out = fillCell(base(), ref(2, 1), 'Inscrit', { fresh: false });
    expect(at(out, 3, 1)).toEqual({ row: 3, col: 1, control: null });
    expect(at(out, 2, 1).control).toBe('Inscrit');
    expect(readLayouts(out)).toHaveLength(1);
  });
  it('unchanged for refused fills', () => {
    const d = add(base(), box('textBox', 'Neuf', 0, 0, 100, 100));
    expect(fillCell(d, ref(1, 1), 'Neuf', { fresh: true })).toBe(d);
    expect(fillCell(d, { layout: 'Z', row: 2, col: 1 }, 'Neuf', { fresh: true })).toBe(d);
    const og = add(d, box('optionGroup', 'Grp', 0, 0, 100, 100));
    expect(fillCell(og, ref(2, 1), 'Grp', { fresh: true })).toBe(og);
    const other = { ...d, sections: [...d.sections, sec('formFooter', undefined, 'Pied')] };
    expect(fillCell(other, ref(2, 1), 'Pied', { fresh: true })).toBe(other);
    const l2: Layout = { id: 'L2', kind: 'stacked', left: 0, tops: { detail: 0 }, cols: [100], rows: [{ section: 'detail', height: 100 }], cells: [{ row: 0, col: 0, control: 'Autre' }] };
    const two = withLayouts(add(d, ctl('Autre', 'L2')), [...readLayouts(d), l2]);
    expect(fillCell(two, ref(2, 1), 'Autre', { fresh: true })).toBe(two);
  });
  it('a field with a label: label goes left when empty, dropped when occupied', () => {
    const f = box('textBox', 'Neuf', 0, 0, 100, 100, lbl('LNeuf', 0, 0, 50));
    const out = fillCell(add(base(), f), ref(2, 1), 'Neuf', { fresh: true });
    expect(at(out, 2, 0).control).toBe('LNeuf');
    expect(byName(out, 'LNeuf').props.LayoutID).toBe('L1');
    expect(byName(out, 'Neuf').children).toBeUndefined();
    const busy = fillCell(add(base(), lbl('X', 0, 0, 50)), ref(2, 0), 'X', { fresh: true });
    const taken = fillCell(add(busy, f), ref(2, 1), 'Neuf', { fresh: true });
    expect(top(taken).some((c) => c.name === 'LNeuf')).toBe(false);
    expect(at(taken, 2, 1).control).toBe('Neuf');
  });
  it('Tabular: label goes to the header row cell of the column', () => {
    const t = insertCells(tab(s3([]), ['Nom', 'Ville']), 'Nom', 'right');
    const f = box('textBox', 'Neuf', 0, 0, 100, 100, lbl('LNeuf', 0, 0, 50));
    const out = fillCell(add(t, f), ref(1, 1), 'Neuf', { fresh: true });
    expect(at(out, 0, 1).control).toBe('LNeuf');
    expect(sectionOf(out, 'LNeuf')).toBe('formHeader');
  });
  it('deleteLines', () => {
    const d = base(), before = stack(s3([]), ['Nom', 'Ville', 'Inscrit']);
    const out = deleteLines(d, [ref(2, 0), ref(2, 1)]);
    expect(readLayouts(out)[0].rows).toHaveLength(3);
    expect(byName(out, 'Inscrit').top).toBe(byName(before, 'Inscrit').top);
    expect(deleteLines(d, [ref(2, 1)])).toBe(d);
    expect(deleteLines(d, [ref(1, 1)])).toBe(d);
    const col = deleteLines(d, [0, 1, 2, 3].map((r) => ref(r, 0)));
    expect(readLayouts(col)[0].cols).toHaveLength(1);
    expect(readLayouts(col)[0].cells.every((c) => c.col === 0)).toBe(true);
  });
  it('deleteLines: a cell inside a rowSpan removes a row only when the row is fully covered', () => {
    const d = base();
    const span = withLayouts(d, readLayouts(d).map((l) => ({ ...l, cells: l.cells.filter((c) => !(c.row === 3 && c.col === 0)).map((c) => (c.row === 2 && c.col === 0 ? { ...c, rowSpan: 2 } : c)) })));
    expect(deleteLines(span, [ref(2, 0)])).toBe(span);
    const out = deleteLines(span, [ref(2, 1), ref(2, 0)]);
    expect(readLayouts(out)[0].rows).toHaveLength(3);
    expect(readLayouts(out)[0].cells.find((c) => c.control === 'Inscrit')).toMatchObject({ row: 2, col: 1 });
  });
  it('deleteLines Tabular column and whole layout', () => {
    const t = insertCells(tab(s3([]), ['Nom', 'Ville']), 'Nom', 'right');
    const out = deleteLines(t, [ref(0, 1), ref(1, 1)]);
    expect(readLayouts(out)[0].cols).toHaveLength(2);
    const gone = deleteLines(t, readLayouts(t)[0].cells.map((c) => ref(c.row, c.col)));
    expect(readLayouts(gone)).toHaveLength(0);
    expect(top(gone).some((c) => 'LayoutID' in c.props)).toBe(false);
  });
  it('selectionIn', () => {
    const d = base();
    const row = selectionIn(d, ref(2, 0), 'row');
    expect(row.names).toEqual([]);
    expect(row.cells).toEqual([ref(2, 0), ref(2, 1)]);
    const col = selectionIn(d, slotOf(d, 'Nom')!, 'column');
    expect(col.names).toHaveLength(3);
    expect(col.cells).toEqual([ref(2, 1)]);
    const all = selectionIn(d, ref(2, 0), 'layout');
    expect(all.names).toHaveLength(6);
    expect(all.cells).toHaveLength(2);
  });
  it('setCellProp and setCellSize', () => {
    const d = base();
    expect(setCellProp(d, ref(2, 1), 'Name', 'x')).toBe(d);
    expect(setCellProp(d, ref(2, 1), 'Width', 5)).toBe(d);
    expect(setCellProp(d, ref(1, 1), 'BackColor', '#fff')).toBe(d);
    const p = setCellProp(d, ref(2, 1), 'BackColor', '#00ff00');
    expect(at(p, 2, 1).props).toEqual({ BackColor: '#00ff00' });
    expect('props' in at(setCellProp(p, ref(2, 1), 'BackColor', undefined), 2, 1)).toBe(false);
    const l0 = readLayouts(d)[0];
    expect(readLayouts(setCellSize(d, ref(2, 1), 'Width', 3000))[0].cols).toEqual([l0.cols[0], 3000]);
    expect(readLayouts(setCellSize(d, ref(2, 0), 'Height', 500))[0].rows[2].height).toBe(500);
    const sp = withLayouts(d, readLayouts(d).map((l) => ({ ...l, cells: l.cells.filter((c) => !(c.row === 2 && c.col === 1)).map((c) => (c.row === 2 && c.col === 0 ? { ...c, colSpan: 2 } : c)) })));
    const s = readLayouts(setCellSize(sp, ref(2, 0), 'Width', 5000))[0];
    expect(s.cols).toEqual([l0.cols[0], 5000 - l0.cols[0] - COL_GAP]);
  });
});
