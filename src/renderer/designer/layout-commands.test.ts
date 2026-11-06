import { describe, expect, it } from 'vitest';
import type { ControlDef, DesignDoc, SectionDef } from '../../shared/design/model';
import { readLayouts } from '../../shared/design/layout';
import { createLayout, insertCells, membersOf } from '../../shared/design/layout-edit';
import { designerReducer, initDesigner, type DesignerAction, type DesignerState } from './designer-model';
import { anchorAction, gridlineColorAction, gridlinesAction, gridlineStyleAction, gridlineWidthAction, layoutAction, layoutCommands, layoutKey, marginsAction, paddingAction, type FormHeader, type LayoutCommand } from './layout-commands';

const ctl = (name: string, top: number, withLabel = true): ControlDef => ({
  kind: 'textBox', name, left: 1000, top, width: 2000, height: 300, props: {},
  ...(withLabel ? { children: [{ kind: 'label' as const, name: `L_${name}`, left: 0, top, width: 900, height: 300, props: { Caption: name } }] } : {}),
});
const sec = (kind: SectionDef['kind'], height: number, controls: ControlDef[] = [], visible = true): SectionDef =>
  ({ kind, height, props: visible ? {} : { Visible: false }, controls });
const formDoc = (): DesignDoc => ({ formatVersion: '1.0', recordSource: null, props: {},
  sections: [sec('formHeader', 0, [], false), sec('detail', 2000, [ctl('A', 100), ctl('B', 600)]), sec('formFooter', 0, [], false)] });
const reportDoc = (): DesignDoc => ({ formatVersion: '1.0', recordSource: null, props: {},
  sections: [sec('pageHeader', 500), sec('detail', 2000, [ctl('A', 100), ctl('B', 600)]), sec('pageFooter', 500)] });
const sel = (doc: DesignDoc, names: string[], kind?: 'form' | 'report'): DesignerState =>
  ({ ...initDesigner(doc, kind), selection: { kind: 'controls', names } });
const edited = (a: DesignerAction | null, doc: DesignDoc): DesignDoc => {
  expect(a?.type).toBe('edit');
  return (a as Extract<DesignerAction, { type: 'edit' }>).apply(doc);
};
// l'en-tête fourni par l'hôte formulaire (form-def n'est pas importable depuis le concepteur)
const formHeader: FormHeader = {
  shown: (d) => d.sections.find((s) => s.kind === 'formHeader')?.props.Visible !== false,
  toggle: (d) => ({ ...d, sections: d.sections.map((s) => (s.kind === 'formHeader' ? { ...s, height: 680, props: { ...s.props, Visible: true } } : s)) }),
};
const ALL: LayoutCommand[] = ['stacked', 'tabular', 'removeLayout', 'insertAbove', 'insertBelow', 'insertLeft', 'insertRight',
  'selectLayout', 'selectColumn', 'selectRow', 'moveUp', 'moveDown'];

describe('layoutAction', () => {
  it('tabular on a form with a hidden header shows it and puts the labels there', () => {
    const d = edited(layoutAction(sel(formDoc(), ['A', 'B'], 'form'), 'tabular', formHeader), formDoc());
    const header = d.sections.find((s) => s.kind === 'formHeader')!;
    expect(header.props.Visible).toBe(true);
    expect(header.controls.map((c) => c.name).sort()).toEqual(['L_A', 'L_B']);
    expect(readLayouts(d)[0].kind).toBe('tabular');
  });
  it('tabular on a report uses the page header', () => {
    const d = edited(layoutAction(sel(reportDoc(), ['A', 'B'], 'report'), 'tabular'), reportDoc());
    expect(d.sections.find((s) => s.kind === 'pageHeader')!.controls.map((c) => c.name).sort()).toEqual(['L_A', 'L_B']);
  });
  it('stacked creates a stacked layout', () => {
    expect(readLayouts(edited(layoutAction(sel(formDoc(), ['A', 'B']), 'stacked'), formDoc()))[0].kind).toBe('stacked');
  });
  it('selectColumn returns a select action with the column names', () => {
    const doc = createLayout(formDoc(), membersOf(formDoc(), ['A', 'B']), 'stacked', { headerSection: 'formHeader' });
    const a = layoutAction(sel(doc, ['A']), 'selectColumn');
    expect(a).toEqual({ type: 'select', selection: { kind: 'controls', names: expect.arrayContaining(['A', 'B']) } });
    expect((a as { selection: { names: string[] } }).selection.names).not.toContain('L_A');
  });
  it('returns null without selection or member, except stacked/tabular', () => {
    expect(layoutAction(initDesigner(formDoc()), 'stacked')).toBeNull();
    expect(layoutAction(sel(formDoc(), ['A']), 'insertLeft')).toBeNull();
    expect(layoutAction(sel(formDoc(), ['A']), 'removeLayout')).toBeNull();
  });
  it('an edit goes through designerReducer and one undo restores the document', () => {
    const doc = formDoc();
    const s = sel(doc, ['A', 'B'], 'form');
    const after = designerReducer(s, layoutAction(s, 'tabular', formHeader)!);
    expect(after.doc).not.toEqual(doc);
    expect(designerReducer(after, { type: 'undo' }).doc).toEqual(doc);
  });
});

describe('layoutCommands', () => {
  const dispatched: DesignerAction[] = [];
  const mk = (s: DesignerState) => layoutCommands(() => s, (a) => dispatched.push(a));
  it('is empty without selection', () => expect(mk(initDesigner(formDoc()))).toEqual({}));
  it('only stacked/tabular for non-members', () => expect(Object.keys(mk(sel(formDoc(), ['A']))).sort()).toEqual(['stacked', 'tabular']));
  it('the twelve plus the two splits for one member, dispatching at call time', () => {
    const doc = createLayout(formDoc(), membersOf(formDoc(), ['A', 'B']), 'stacked', { headerSection: 'formHeader' });
    const h = mk(sel(doc, ['A']));
    expect(Object.keys(h).sort()).toEqual([...ALL, 'splitVertically', 'splitHorizontally'].sort());
    h.selectRow!();
    expect(dispatched.at(-1)?.type).toBe('select');
  });
});

describe('merge and split commands', () => {
  const laid = () => insertCells(createLayout(formDoc(), membersOf(formDoc(), ['A', 'B']), 'stacked', { headerSection: 'formHeader' }), 'A', 'right');
  const withCells = (doc: DesignDoc, names: string[], cells: { row: number; col: number }[]): DesignerState =>
    ({ ...initDesigner(doc, 'form'), selection: { kind: 'controls', names, cells: cells.map((c) => ({ layout: 'L1', ...c })) } });
  it('merge: member + empty neighbour selected; selection becomes the control; one undo', () => {
    const doc = laid();
    const s = withCells(doc, ['A'], [{ row: 0, col: 2 }]);
    expect(Object.keys(layoutCommands(() => s, () => {})).filter((k) => /merge|split/i.test(k)).sort()).toEqual(['merge']);
    const after = designerReducer(s, layoutAction(s, 'merge')!);
    expect(readLayouts(after.doc)[0].cells.find((c) => c.control === 'A')?.colSpan).toBe(2);
    expect(after.selection).toEqual({ kind: 'controls', names: ['A'] });
    expect(designerReducer(after, { type: 'undo' }).doc).toEqual(doc);
  });
  it('split: one empty cell selected keeps the selection on it; two cells do not split', () => {
    const doc = laid();
    const s = withCells(doc, [], [{ row: 0, col: 2 }]);
    expect(Object.keys(layoutCommands(() => s, () => {})).sort()).toEqual(['selectColumn', 'selectLayout', 'selectRow', 'splitHorizontally', 'splitVertically']);
    const after = designerReducer(s, layoutAction(s, 'splitHorizontally')!);
    expect(after.selection).toEqual({ kind: 'controls', names: [], cells: [{ layout: 'L1', row: 0, col: 2 }] });
    expect(layoutAction(withCells(doc, [], [{ row: 0, col: 2 }, { row: 1, col: 2 }]), 'splitVertically')).toBeNull();
  });
  it('layoutKey changes with merge/split availability', () => {
    const doc = laid();
    expect(layoutKey(withCells(doc, ['A'], [{ row: 0, col: 2 }]))).not.toBe(layoutKey(sel(doc, ['A'])));
  });
});

describe('L4 popup writers', () => {
  const laid = () => createLayout(formDoc(), membersOf(formDoc(), ['A', 'B']), 'stacked', { headerSection: 'formHeader' });
  const props = (d: DesignDoc, n: string) => d.sections.flatMap((s) => s.controls).flatMap((c) => [c, ...(c.children ?? [])]).find((c) => c.name === n)!.props;
  it('padding wide is one edit writing 180 on the four sides of each selected control', () => {
    const s = sel(formDoc(), ['A', 'B']);
    const d = edited(paddingAction(s, 'wide'), formDoc());
    for (const n of ['A', 'B']) expect(props(d, n)).toMatchObject({ TopPadding: 180, BottomPadding: 180, LeftPadding: 180, RightPadding: 180 });
    expect(designerReducer(designerReducer(s, paddingAction(s, 'wide')!), { type: 'undo' }).doc).toEqual(formDoc());
  });
  it('margins narrow, anchors both/both', () => {
    expect(props(edited(marginsAction(sel(formDoc(), ['A']), 'narrow'), formDoc()), 'A')).toMatchObject({ TopMargin: 22, RightMargin: 22 });
    expect(props(edited(anchorAction(sel(formDoc(), ['A']), 'both', 'both'), formDoc()), 'A')).toMatchObject({ HorizontalAnchor: 'both', VerticalAnchor: 'both' });
  });
  it('horizontal gridlines: Top and Bottom solid, Left and Right transparent', () => {
    const doc = formDoc();
    doc.sections[1].controls[0].props = { GridlineStyleLeft: 'dashed', GridlineStyleTop: 'dotted' };
    const p = props(edited(gridlinesAction(sel(doc, ['A']), 'horizontal'), doc), 'A');
    expect(p).toMatchObject({ GridlineStyleTop: 'dotted', GridlineStyleBottom: 'solid', GridlineStyleLeft: 'transparent' });
    expect(p.GridlineStyleRight ?? 'transparent').toBe('transparent');   // the default: nothing to write
  });
  it('outline of a 2x2 selection gives each control its outer sides', () => {
    const d = edited(gridlinesAction(sel(laid(), ['L_A', 'A', 'L_B', 'B']), 'outline'), laid());
    const solid = (n: string) => ['Top', 'Bottom', 'Left', 'Right'].filter((x) => props(d, n)[`GridlineStyle${x}`] === 'solid');
    expect([solid('L_A'), solid('A'), solid('L_B'), solid('B')]).toEqual([['Top', 'Left'], ['Top', 'Right'], ['Bottom', 'Left'], ['Bottom', 'Right']]);
  });
  it('width and style skip transparent sides; colour writes everywhere', () => {
    const doc = formDoc();
    doc.sections[1].controls[0].props = { GridlineStyleTop: 'solid' };
    const run = (a: DesignerAction | null) => designerReducer(sel(doc, ['A']), a!).doc;
    const w = props(run(gridlineWidthAction(sel(doc, ['A']), 3)), 'A');
    expect(w).toMatchObject({ GridlineWidthTop: 3 }); expect(w).not.toHaveProperty('GridlineWidthLeft');
    expect(props(run(gridlineStyleAction(sel(doc, ['A']), 'dashed')), 'A')).toMatchObject({ GridlineStyleTop: 'dashed' });
    expect(props(run(gridlineColorAction(sel(doc, ['A']), '#ff0000')), 'A')).toMatchObject({ GridlineColor: '#ff0000' });
  });
  it('null without any selection; popups registered with a control, Gridlines and Padding also with cells', () => {
    const none = initDesigner(formDoc());
    expect([marginsAction(none, 'wide'), paddingAction(none, 'wide'), anchorAction(none, 'left', 'top'), gridlinesAction(none, 'both')]).toEqual([null, null, null, null]);
    const opened: string[] = [];
    const h = layoutCommands(() => sel(formDoc(), ['A']), () => {}, undefined, (id) => opened.push(id));
    h.anchoring!();
    expect(opened).toEqual(['anchoring']);
  });
});

describe('L5 empty cells', () => {
  // A | B stacked, with an empty cell right of A (col 2) and of B
  const laid = () => insertCells(createLayout(formDoc(), membersOf(formDoc(), ['A', 'B']), 'stacked', { headerSection: 'formHeader' }), 'A', 'right');
  const cellsOnly = (doc: DesignDoc, cells: { row: number; col: number }[], names: string[] = []): DesignerState =>
    ({ ...initDesigner(doc, 'form'), selection: { kind: 'controls', names, cells: cells.map((c) => ({ layout: 'L1', ...c })) } });
  const cp = (d: DesignDoc, row: number, col: number) => readLayouts(d)[0].cells.find((c) => c.row === row && c.col === col)!.props ?? {};
  const SIDES = ['Top', 'Bottom', 'Left', 'Right'];
  it('Select Row/Column/Layout start from a selected empty cell and include empty cells', () => {
    const doc = laid(), s = cellsOnly(doc, [{ row: 0, col: 2 }]);
    const a = layoutAction(s, 'selectRow') as { selection: { names: string[]; cells?: unknown[] } };
    expect(a.selection.names).toContain('A');
    expect(a.selection.cells).toEqual([{ layout: 'L1', row: 0, col: 2 }]);
    const c = layoutAction(s, 'selectColumn') as { selection: { cells: unknown[] } };
    expect(c.selection.cells).toHaveLength(2);
    expect(layoutAction(s, 'selectLayout')).not.toBeNull();
    expect(layoutAction(s, 'insertLeft')).toBeNull();
  });
  it('from a member, cells are included; omitted when there are none', () => {
    const a = layoutAction(sel(laid(), ['A']), 'selectRow') as { selection: { cells?: unknown[] } };
    expect(a.selection.cells).toEqual([{ layout: 'L1', row: 0, col: 2 }]);
    const plain = createLayout(formDoc(), membersOf(formDoc(), ['A', 'B']), 'stacked', { headerSection: 'formHeader' });
    expect((layoutAction(sel(plain, ['A']), 'selectRow') as { selection: object }).selection).not.toHaveProperty('cells');
  });
  it('layoutKey distinguishes none / cells only / member; cells-only handlers', () => {
    const doc = laid();
    const keys = [layoutKey(initDesigner(doc)), layoutKey(cellsOnly(doc, [{ row: 0, col: 2 }])), layoutKey(sel(doc, ['A']))];
    expect(new Set(keys).size).toBe(3);
    const s = cellsOnly(doc, [{ row: 0, col: 2 }, { row: 1, col: 2 }]);
    expect(Object.keys(layoutCommands(() => s, () => {}, undefined, () => {})).filter((k) => k !== 'merge').sort())
      .toEqual(['selectLayout', 'selectColumn', 'selectRow', 'layoutGridlines', 'controlPadding'].sort());
  });
  it('layoutKey differs when cells join a loose-control selection', () => {
    const doc = laid();
    const loose = (cells: unknown[]) => ({ ...sel(doc, ['A']), selection: { kind: 'controls', names: ['Z'], cells } }) as DesignerState;
    expect(layoutKey(loose([{ layout: 'L1', row: 0, col: 2 }]))).not.toBe(layoutKey(loose([])));
  });
  it('gridlines both and padding wide write the cells; margins and anchors do not apply', () => {
    const doc = laid(), s = cellsOnly(doc, [{ row: 0, col: 2 }]);
    const g = edited(gridlinesAction(s, 'both'), doc);
    for (const x of SIDES) expect(cp(g, 0, 2)[`GridlineStyle${x}`]).toBe('solid');
    const p = edited(paddingAction(s, 'wide'), doc);
    for (const x of SIDES) expect(cp(p, 0, 2)[`${x}Padding`]).toBe(180);
    expect(marginsAction(s, 'wide')).toBeNull();
    expect(anchorAction(s, 'left', 'top')).toBeNull();
  });
  it('mixed selection: padding writes control and cell in one edit; width skips transparent sides', () => {
    const doc = laid(), s = cellsOnly(doc, [{ row: 0, col: 2 }], ['A']);
    const p = edited(paddingAction(s, 'wide'), doc);
    expect(cp(p, 0, 2).TopPadding).toBe(180);
    expect(p.sections.flatMap((x) => x.controls).find((c) => c.name === 'A')!.props.TopPadding).toBe(180);
    const c0 = cellsOnly(doc, [{ row: 0, col: 2 }]);
    const g = designerReducer(c0, gridlinesAction(c0, 'top')!).doc;
    const c1 = cellsOnly(g, [{ row: 0, col: 2 }]);
    const w = designerReducer(c1, gridlineWidthAction(c1, 3)!).doc;
    expect(cp(w, 0, 2)).toMatchObject({ GridlineWidthTop: 3 });
    expect(cp(w, 0, 2)).not.toHaveProperty('GridlineWidthLeft');
  });
  it('outline of two selected cells gives each its outer sides', () => {
    const doc = laid(), s = cellsOnly(doc, [{ row: 0, col: 2 }, { row: 1, col: 2 }]);
    const d = edited(gridlinesAction(s, 'outline'), doc);
    const solid = (r: number) => SIDES.filter((x) => cp(d, r, 2)[`GridlineStyle${x}`] === 'solid');
    expect([solid(0), solid(1)]).toEqual([['Top', 'Left', 'Right'], ['Bottom', 'Left', 'Right']]);
  });
});
