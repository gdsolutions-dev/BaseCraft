import { describe, expect, it } from 'vitest';
import { MAX_TWIPS } from '../field-types';
import type { ControlDef, DesignDoc, SectionDef } from './model';
import { COL_GAP, ROW_GAP, labelOf, layoutOf, readLayouts, reflow, withLayouts, type Layout } from './layout';

const ctl = (name: string, kind: ControlDef['kind'] = 'textBox'): ControlDef => ({ kind, name, left: 0, top: 0, width: 10, height: 10, props: {} });
const sec = (kind: SectionDef['kind'], ...names: string[]): SectionDef => ({ kind, height: 2000, props: {}, controls: names.map((n) => ctl(n)) });
const mk = (sections: SectionDef[], layouts?: unknown): DesignDoc =>
  ({ formatVersion: '1.0', recordSource: null, props: layouts === undefined ? {} : { Layouts: layouts }, sections });
const stacked = (): Layout => ({ id: 'L1', kind: 'stacked', left: 200, tops: { detail: 100 }, cols: [1000, 3000],
  rows: [{ section: 'detail', height: 400 }, { section: 'detail', height: 300 }],
  cells: [{ row: 0, col: 0, control: 'A' }, { row: 0, col: 1, control: 'B' }, { row: 1, col: 0, control: 'C' }, { row: 1, col: 1, control: 'D' }] });
const byName = (d: DesignDoc, n: string) => d.sections.flatMap((s) => s.controls).find((c) => c.name === n)!;

describe('reflow', () => {
  it('positions a stacked grid', () => {
    const d = reflow(mk([sec('detail', 'A', 'B', 'C', 'D')], [stacked()]));
    expect(byName(d, 'B')).toMatchObject({ left: 200 + 1000 + COL_GAP, top: 100, width: 3000, height: 400 });
    expect(byName(d, 'C')).toMatchObject({ left: 200, top: 100 + 400 + ROW_GAP, width: 1000, height: 300 });
  });
  it('aligns tabular header labels and detail controls per section top', () => {
    const l: Layout = { id: 'T', kind: 'tabular', left: 0, tops: { formHeader: 50, detail: 70 }, cols: [800, 900],
      rows: [{ section: 'formHeader', height: 200 }, { section: 'detail', height: 250 }],
      cells: [{ row: 0, col: 0, control: 'H0' }, { row: 0, col: 1, control: 'H1' }, { row: 1, col: 0, control: 'D0' }, { row: 1, col: 1, control: 'D1' }] };
    const d = reflow(mk([sec('formHeader', 'H0', 'H1'), sec('detail', 'D0', 'D1')], [l]));
    expect(byName(d, 'H1')).toMatchObject({ left: 800 + COL_GAP, top: 50, width: 900, height: 200 });
    expect(byName(d, 'D1')).toMatchObject({ left: 800 + COL_GAP, top: 70, width: 900, height: 250 });
  });
  it('returns the same object when nothing moves', () => {
    const d = reflow(mk([sec('detail', 'A', 'B', 'C', 'D')], [stacked()]));
    expect(reflow(d)).toBe(d);
  });
  it('moves a tab control’s pages (and their content) with it, without resizing them', () => {
    const page: ControlDef = { ...ctl('P', 'subform'), left: 50, top: 60, width: 500, height: 400, children: [{ ...ctl('In'), left: 70, top: 80 }] };
    const s = sec('detail', 'A', 'C', 'D');
    s.controls.splice(1, 0, { ...ctl('B', 'tabControl'), children: [page] });
    const d = reflow(mk([s], [stacked()]));
    const dx = 200 + 1000 + COL_GAP, dy = 100;   // B goes from (0, 0) to (dx, dy)
    expect(byName(d, 'B').children![0]).toMatchObject({ left: 50 + dx, top: 60 + dy, width: 500, height: 400 });
    expect(byName(d, 'B').children![0].children![0]).toMatchObject({ left: 70 + dx, top: 80 + dy });
  });
  it('clamps to MAX_TWIPS', () => {
    const l = { ...stacked(), left: MAX_TWIPS + 5 };
    expect(byName(reflow(mk([sec('detail', 'A', 'B', 'C', 'D')], [l])), 'A').left).toBe(MAX_TWIPS);
  });
});

describe('readLayouts', () => {
  const doc = (l: unknown) => mk([sec('detail', 'A', 'B', 'C', 'D')], [l]);
  it('keeps a valid layout', () => expect(readLayouts(doc(stacked()))).toEqual([stacked()]));
  it('drops a missing control, bad rows/cols or out-of-range cells', () => {
    const s = stacked();
    for (const bad of [
      { ...s, cells: [{ row: 0, col: 0, control: 'Nope' }] },
      { ...s, rows: 'x' }, { ...s, cols: [1.5] }, { ...s, cols: [-1] },
      { ...s, cells: [{ row: 5, col: 0, control: 'A' }] }, { ...s, cells: [{ row: 0, col: 2, control: 'A' }] },
      null, 7,
    ]) expect(readLayouts(doc(bad))).toEqual([]);
  });
  it('never throws on a non-array', () => {
    for (const v of [42, 'x', null, {}, true]) expect(readLayouts(mk([sec('detail')], v))).toEqual([]);
  });
});

describe('withLayouts / layoutOf / labelOf', () => {
  it('removes the key when empty', () => expect('Layouts' in withLayouts(mk([], [stacked()]), []).props).toBe(false));
  it('finds the layout of a control', () => {
    const d = mk([sec('detail', 'A', 'B', 'C', 'D')], [stacked()]);
    expect(layoutOf(d, 'C')?.id).toBe('L1');
    expect(layoutOf(d, 'Z')).toBeNull();
  });
  it('labelOf returns the header control of the column', () => {
    const l: Layout = { id: 'T', kind: 'tabular', left: 0, tops: { formHeader: 0, detail: 0 }, cols: [800, 900],
      rows: [{ section: 'formHeader', height: 200 }, { section: 'detail', height: 250 }],
      cells: [{ row: 0, col: 0, control: 'H0' }, { row: 0, col: 1, control: 'H1' }, { row: 1, col: 0, control: 'D0' }, { row: 1, col: 1, control: 'D1' }] };
    const head: SectionDef = { kind: 'formHeader', height: 2000, props: {}, controls: [ctl('H0', 'label'), ctl('H1', 'label')] };
    const d = mk([head, sec('detail', 'D0', 'D1')], [l]);
    expect(labelOf(d, 'D1')?.name).toBe('H1');
    expect(labelOf(d, 'H1')).toBeNull();
  });
  it('labelOf on a Tabular layout after Insert Above on a header label: the label on its own header row, not the empty one', () => {
    const l: Layout = { id: 'T', kind: 'tabular', left: 0, tops: { formHeader: 0, detail: 0 }, cols: [800, 900],
      rows: [{ section: 'formHeader', height: 200 }, { section: 'formHeader', height: 200 }, { section: 'detail', height: 250 }],
      cells: [{ row: 0, col: 0, control: null }, { row: 0, col: 1, control: null },
        { row: 1, col: 0, control: 'H0' }, { row: 1, col: 1, control: 'H1' }, { row: 2, col: 0, control: 'D0' }, { row: 2, col: 1, control: 'D1' }] };
    const head: SectionDef = { kind: 'formHeader', height: 2000, props: {}, controls: [ctl('H0', 'label'), ctl('H1', 'label')] };
    const d = mk([head, sec('detail', 'D0', 'D1')], [l]);
    expect(labelOf(d, 'D1')?.name).toBe('H1');
    expect(labelOf(d, 'H1')).toBeNull();
  });
  it('labelOf on a report Tabular layout: the label of the column in the page header', () => {
    const l: Layout = { id: 'T', kind: 'tabular', left: 0, tops: { pageHeader: 0, detail: 0 }, cols: [800, 900],
      rows: [{ section: 'pageHeader', height: 200 }, { section: 'detail', height: 250 }],
      cells: [{ row: 0, col: 0, control: 'H0' }, { row: 0, col: 1, control: 'H1' }, { row: 1, col: 0, control: 'D0' }, { row: 1, col: 1, control: 'D1' }] };
    const head: SectionDef = { kind: 'pageHeader', height: 2000, props: {}, controls: [ctl('H0', 'label'), ctl('H1', 'label')] };
    const d = mk([head, sec('detail', 'D0', 'D1')], [l]);
    expect(labelOf(d, 'D1')?.name).toBe('H1');
    expect(labelOf(d, 'H1')).toBeNull();
  });
  it('labelOf on a stacked layout: the label in column 0 of the row', () => {
    const s: SectionDef = { kind: 'detail', height: 2000, props: {}, controls: [ctl('A', 'label'), ctl('B'), ctl('C'), ctl('D')] };
    const d = mk([s], [stacked()]);
    expect(labelOf(d, 'B')?.name).toBe('A');
    expect(labelOf(d, 'A')).toBeNull();   // the label itself
    expect(labelOf(d, 'D')).toBeNull();   // column 0 holds a text box, not a label
  });
});
