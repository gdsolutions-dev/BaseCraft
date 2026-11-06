import { describe, expect, it } from 'vitest';
import { validateDesignDoc, type ControlDef, type ControlKind, type DesignDoc } from '../../shared/design/model';
import { MAX_TWIPS } from './units';
import { INSERT_ROW_HEIGHT, ROW_GAP, emptyCellsOf, readLayouts, reflow, withLayouts } from '../../shared/design/layout';
import { createLayout, insertCells, removeLayout, membersOf, selectionIn, selectionOf } from '../../shared/design/layout-edit';
import { CONTAINER_KINDS, controlRect, coreReducer, designerReducer, docWidth, documentKind, findControl, initDesigner, sectionBottomLimit, syncLayouts,
  uniqueName, type DesignerAction, type DesignerState } from './designer-model';

const ctl = (kind: ControlKind, name: string, left = 0, top = 0, width = 2268, height = 340, children?: ControlDef[]): ControlDef =>
  ({ kind, name, left, top, width, height, props: {}, ...(children ? { children } : {}) });
const section = (kind: 'formHeader' | 'detail' | 'formFooter', height: number, controls: ControlDef[]) => ({ kind, height, props: {}, controls });
// detail (2268) : Nom (+ étiquette attachée) et Ville ; formHeader (567) : Titre ; GridX 4 (pas 142)
const fixture = (): DesignDoc => ({ formatVersion: '1.0', recordSource: null, props: { GridX: 4 }, sections: [
  section('formHeader', 567, [ctl('label', 'Titre', 0, 0, 3000, 400)]),
  section('detail', 2268, [ctl('textBox', 'Nom', 1134, 0, 2268, 340, [ctl('label', 'Étiquette_Nom', 0, 0, 1000, 340)]), ctl('textBox', 'Ville', 1134, 567, 2268, 340)]),
  section('formFooter', 0, []),
] });
const threeDoc = (): DesignDoc => ({ formatVersion: '1.0', recordSource: null, props: { GridX: 4 }, sections: [
  section('detail', 2500, [ctl('textBox', 'A', 0, 0, 2268, 340), ctl('textBox', 'B', 0, 300, 2268, 340), ctl('textBox', 'C', 0, 2000, 2268, 340)])] });
const withUnknown = (): DesignDoc => {
  const d = fixture() as DesignDoc & { zz?: number };
  d.zz = 1; (d.sections[1] as unknown as { zz: number }).zz = 3; d.sections[1].controls[0].props.zz = 2;
  return d;
};

const init = initDesigner(fixture());
const act = (s: DesignerState, ...a: DesignerAction[]): DesignerState => a.reduce(designerReducer, s);
const selIn = (doc: DesignDoc, ...names: string[]): DesignerState => act(initDesigner(doc), { type: 'select', selection: { kind: 'controls', names } });
const sel = (...names: string[]) => selIn(fixture(), ...names);
const three = threeDoc();
const rect = (s: DesignerState, name: string) => controlRect(findControl(s.doc, name)!.control);
const lefts = (s: DesignerState, ...n: string[]) => n.map((x) => rect(s, x).left);
const tops = (s: DesignerState, ...n: string[]) => n.map((x) => rect(s, x).top);

describe('designer model', () => {
  it('move snaps and moves attached label by the same delta', () => { const s = act(sel('Nom'), { type: 'moveBy', dx: 150, dy: 10 });
    expect(rect(s, 'Nom')).toMatchObject({ left: 1278, top: 0 }); expect(rect(s, 'Étiquette_Nom').left).toBe(144); });
  it('free move ignores grid', () => expect(rect(act(sel('Nom'), { type: 'moveBy', dx: 150, dy: 10, free: true }), 'Nom')).toMatchObject({ left: 1284, top: 10 }));
  it('snap off ignores grid', () => expect(rect(act(sel('Nom'), { type: 'toggleSnap' }, { type: 'moveBy', dx: 150, dy: 10 }), 'Nom')).toMatchObject({ left: 1284, top: 10 }));
  it('label alone moves alone', () => { const s = act(sel('Étiquette_Nom'), { type: 'moveBy', dx: 284, dy: 0 }); expect(rect(s, 'Nom').left).toBe(1134); });
  it('selected parent and child move once', () => { const s = act(sel('Nom', 'Étiquette_Nom'), { type: 'moveBy', dx: 284, dy: 0, free: true });
    expect(rect(s, 'Nom').left).toBe(1418); expect(rect(s, 'Étiquette_Nom').left).toBe(284); });
  it('clamped at 0, label included', () => {
    expect(rect(act(sel('Ville'), { type: 'moveBy', dx: -5000, dy: -5000 }), 'Ville')).toMatchObject({ left: 0, top: 0 });
    const s = act(sel('Nom'), { type: 'moveBy', dx: -5000, dy: 0 }); expect(rect(s, 'Étiquette_Nom').left).toBe(0); expect(rect(s, 'Nom').left).toBe(1134); });
  it('clamped at MAX_TWIPS', () => expect(rect(act(sel('Ville'), { type: 'moveBy', dx: 99999, dy: 99999, free: true }), 'Ville'))
    .toMatchObject({ left: MAX_TWIPS - 2268, top: MAX_TWIPS - 340 }));
  it('a move that changes nothing is not an edit', () => { const s = act(sel('Ville'), { type: 'moveBy', dx: 0, dy: 0, free: true }); expect(s.dirty).toBe(false); expect(s.past).toHaveLength(0); });
  it('section grows, never shrinks below content', () => {
    expect(act(sel('Ville'), { type: 'moveBy', dx: 0, dy: 3000 }).doc.sections[1].height).toBe(3890);   // top 3567 -> 3550 aimanté, + 340
    expect(act(init, { type: 'setSectionHeight', index: 1, height: 100 }).doc.sections[1].height).toBe(907);
    expect(act(init, { type: 'setSectionHeight', index: 1, height: 99999 }).doc.sections[1].height).toBe(MAX_TWIPS); });
  it('document grows to the right', () => { const s = act(sel('Ville'), { type: 'moveBy', dx: 6000, dy: 0, free: true });
    expect(s.doc.props.Width).toBe(9402); expect(s.doc.props.GridX).toBe(4); });
  it('align bottom is per section', () => { const s = act(sel('Nom', 'Ville', 'Titre'), { type: 'arrange', op: 'alignBottom' });
    expect(rect(s, 'Nom').top).toBe(567); expect(rect(s, 'Ville').top).toBe(567); expect(rect(s, 'Titre').top).toBe(0); });   // Titre is alone in its section
  it('align top is per section', () => { const t = act(sel('Nom', 'Ville', 'Titre'), { type: 'arrange', op: 'alignTop' });
    expect(rect(t, 'Ville').top).toBe(0); expect(rect(t, 'Titre').top).toBe(0); });
  it('align left across sections', () => expect(rect(act(sel('Titre', 'Ville'), { type: 'arrange', op: 'alignLeft' }), 'Ville').left).toBe(0));
  it('align right', () => { const s = act(sel('Titre', 'Ville'), { type: 'arrange', op: 'alignRight' }); expect(rect(s, 'Titre').left).toBe(402); });
  it('align never pushes an unselected attached label below 0', () => { const s = act(sel('Titre', 'Nom'), { type: 'arrange', op: 'alignLeft' });
    expect(rect(s, 'Nom').left).toBe(1134); expect(rect(s, 'Étiquette_Nom').left).toBe(0); expect(validateDesignDoc(s.doc)).toEqual([]); });
  it('arrange needs 2 controls, except the grid ones', () => {
    expect(act(sel('Ville'), { type: 'arrange', op: 'alignLeft' }).dirty).toBe(false);
    expect(act(selIn(three, 'A', 'B'), { type: 'arrange', op: 'spaceVerticalEqual' }).dirty).toBe(false);
    expect(rect(act(sel('Ville'), { type: 'arrange', op: 'alignToGrid' }), 'Ville')).toMatchObject({ left: 1136, top: 568 }); });
  it('size to widest / narrowest / tallest / shortest', () => {
    const s = act(sel('Nom', 'Titre'), { type: 'arrange', op: 'sizeToWidest' }); expect([rect(s, 'Nom').width, rect(s, 'Titre').width]).toEqual([3000, 3000]);
    const n = act(sel('Nom', 'Titre'), { type: 'arrange', op: 'sizeToNarrowest' }); expect([rect(n, 'Nom').width, rect(n, 'Titre').width]).toEqual([2268, 2268]);
    const t = act(sel('Nom', 'Titre'), { type: 'arrange', op: 'sizeToTallest' }); expect([rect(t, 'Nom').height, rect(t, 'Titre').height]).toEqual([400, 400]);
    const h = act(sel('Nom', 'Titre'), { type: 'arrange', op: 'sizeToShortest' }); expect([rect(h, 'Nom').height, rect(h, 'Titre').height]).toEqual([340, 340]); });
  it('size to grid snaps the four edges', () => { const s = act(sel('Ville'), { type: 'arrange', op: 'sizeToGrid' });
    expect(rect(s, 'Ville')).toEqual({ left: 1136, top: 568, width: 2272, height: 284 }); });
  it('space vertically equal keeps ends', () => { const s = act(selIn(three, 'A', 'B', 'C'), { type: 'arrange', op: 'spaceVerticalEqual' });
    expect(tops(s, 'A', 'B', 'C')).toEqual([0, 1000, 2000]); });
  it('space horizontally: equal, increase', () => {
    const d = threeDoc(); d.sections[0].controls = [ctl('textBox', 'A', 0, 0, 100, 340), ctl('textBox', 'B', 500, 0, 100, 340), ctl('textBox', 'C', 1000, 0, 100, 340)];
    d.sections[0].controls[1].left = 100;
    const s = act(selIn(d, 'C', 'A', 'B'), { type: 'arrange', op: 'spaceHorizontalEqual' }); expect(lefts(s, 'A', 'B', 'C')).toEqual([0, 500, 1000]);
    const e = act(selIn(d, 'A', 'B', 'C'), { type: 'arrange', op: 'spaceHorizontalIncrease' }); expect(lefts(e, 'A', 'B', 'C')).toEqual([0, 242, 1284]); });
  it('increase vertical spacing by grid steps', () => { const s = act(selIn(three, 'A', 'B', 'C'), { type: 'arrange', op: 'spaceVerticalIncrease' });
    expect(tops(s, 'A', 'B', 'C')).toEqual([0, 442, 2284]); });
  it('decrease vertical spacing, never below 0', () => { const s = act(selIn(three, 'A', 'B', 'C'), { type: 'arrange', op: 'spaceVerticalDecrease' });
    expect(tops(s, 'A', 'B', 'C')).toEqual([0, 158, 1716]);
    const d = threeDoc(); d.sections[0].controls[2].top = 100; expect(rect(act(selIn(d, 'A', 'B', 'C'), { type: 'arrange', op: 'spaceVerticalDecrease' }), 'C').top).toBe(0); });
  it('bring to front / send to back change the stacking order', () => {
    expect(act(selIn(three, 'A'), { type: 'arrange', op: 'bringToFront' }).doc.sections[0].controls.map((c) => c.name)).toEqual(['B', 'C', 'A']);
    expect(act(selIn(three, 'C', 'B'), { type: 'arrange', op: 'sendToBack' }).doc.sections[0].controls.map((c) => c.name)).toEqual(['B', 'C', 'A']); });
  it('delete removes attached label', () => { const s = act(sel('Nom'), { type: 'deleteSelection' }); expect(findControl(s.doc, 'Étiquette_Nom')).toBeNull();
    expect(findControl(s.doc, 'Nom')).toBeNull(); expect(s.selection).toEqual({ kind: 'doc' }); });
  it('deleting the label alone keeps its control', () => { const s = act(sel('Étiquette_Nom'), { type: 'deleteSelection' }); expect(findControl(s.doc, 'Nom')!.control.children).toEqual([]); });
  it('insert renames duplicates and selects', () => { const s = act(init, { type: 'insert', section: 1, controls: [ctl('textBox', 'Nom')] });
    expect(s.selection).toEqual({ kind: 'controls', names: ['Nom1'] }); });
  it('insert renames children too and grows the section', () => {
    const s = act(init, { type: 'insert', section: 1, controls: [ctl('textBox', 'nom', 0, 3000, 100, 340, [ctl('label', 'Étiquette_Nom')])] });
    expect(findControl(s.doc, 'Étiquette_Nom1')).not.toBeNull(); expect(s.doc.sections[1].height).toBe(3340); expect(validateDesignDoc(s.doc)).toEqual([]); });
  it('insert into option group', () => { const s = act(init, { type: 'insert', section: 1, controls: [ctl('optionGroup', 'Groupe')] },
    { type: 'insert', section: 1, controls: [ctl('optionButton', 'Option')], parent: 'Groupe' });
    expect(findControl(s.doc, 'Option')).toMatchObject({ section: 1, parent: 'Groupe' });
    expect(findControl(s.doc, 'Groupe')!.control.children!.map((c) => c.name)).toEqual(['Option']); });
  it('change section drops the selection in another section', () => { const s = act(sel('Ville'), { type: 'changeSection', to: 2, top: 100 });
    expect(findControl(s.doc, 'Ville')).toMatchObject({ section: 2 }); expect(rect(s, 'Ville').top).toBe(142); expect(s.doc.sections[2].height).toBe(482);
    expect(s.doc.sections[1].controls.map((c) => c.name)).toEqual(['Nom']); });
  it('undo/redo', () => { const s = act(sel('Nom'), { type: 'moveBy', dx: 284, dy: 0, free: true }, { type: 'undo' }); expect(rect(s, 'Nom').left).toBe(1134); expect(s.dirty).toBe(true);
    expect(rect(act(s, { type: 'redo' }), 'Nom').left).toBe(1418); });
  it('undo drops a vanished name from the selection; history is capped; load and saved clear it', () => {
    const s = act(init, { type: 'insert', section: 1, controls: [ctl('textBox', 'Neuf')] }, { type: 'undo' });
    expect(s.selection).toEqual({ kind: 'doc' });
    let h = sel('Ville'); for (let i = 0; i < 120; i++) h = act(h, { type: 'moveBy', dx: i % 2 ? 1 : -1, dy: 0, free: true });
    expect(h.past.length).toBe(100);
    expect(act(h, { type: 'saved' })).toMatchObject({ dirty: false, past: [], future: [] });
    expect(act(h, { type: 'load', doc: fixture() })).toMatchObject({ dirty: false, past: [], future: [] }); });
  it('rename via setProp Name', () => { const s = act(sel('Nom'), { type: 'setProp', targets: [{ kind: 'control', name: 'Nom' }], name: 'Name', value: 'NomClient' });
    expect(findControl(s.doc, 'NomClient')).not.toBeNull(); expect(s.selection).toEqual({ kind: 'controls', names: ['NomClient'] });
    const dup = act(init, { type: 'setProp', targets: [{ kind: 'control', name: 'Nom' }], name: 'Name', value: 'ville' }); expect(dup.dirty).toBe(false);
    const bad = act(init, { type: 'setProp', targets: [{ kind: 'control', name: 'Nom' }], name: 'Name', value: '' }); expect(bad.dirty).toBe(false); });
  it('setProp geometry and section height', () => {
    const s = act(init, { type: 'setProp', targets: [{ kind: 'control', name: 'Ville' }], name: 'Top', value: 3000 }, { type: 'setProp', targets: [{ kind: 'section', index: 0 }], name: 'Height', value: 900 });
    expect(rect(s, 'Ville').top).toBe(3000); expect(s.doc.sections[1].height).toBe(3340); expect(s.doc.sections[0].height).toBe(900);
    expect(findControl(s.doc, 'Ville')!.control.props.Top).toBeUndefined(); });
  it('setProp removes a key with undefined, sets others', () => {
    const t = [{ kind: 'control' as const, name: 'Nom' }, { kind: 'control' as const, name: 'Ville' }];
    const s = act(init, { type: 'setProp', targets: t, name: 'FontSize', value: 12 }); expect(findControl(s.doc, 'Ville')!.control.props.FontSize).toBe(12);
    expect(findControl(act(s, { type: 'setProp', targets: t, name: 'FontSize', value: undefined }).doc, 'Ville')!.control.props).not.toHaveProperty('FontSize');
    const d = act(init, { type: 'setProp', targets: [{ kind: 'doc' }, { kind: 'section', index: 1 }], name: 'Caption', value: 'x' });
    expect(d.doc.props.Caption).toBe('x'); expect(d.doc.sections[1].props.Caption).toBe('x'); });
  it('RecordSource goes to doc.recordSource', () => { const s = act(init, { type: 'setProp', targets: [{ kind: 'doc' }], name: 'RecordSource', value: { kind: 'table', name: 'Clients' } });
    expect(s.doc.recordSource).toEqual({ kind: 'table', name: 'Clients' }); expect(s.doc.props.RecordSource).toBeUndefined();
    expect(act(s, { type: 'setProp', targets: [{ kind: 'doc' }], name: 'RecordSource', value: undefined }).doc.recordSource).toBeNull(); });
  it('unknown keys survive every action', () => { const s = act(selIn(withUnknown(), 'Nom'), { type: 'moveBy', dx: 284, dy: 0, free: true },
    { type: 'setProp', targets: [{ kind: 'control', name: 'Nom' }], name: 'FontSize', value: 12 }, { type: 'undo' });
    expect((s.doc as unknown as { zz: number }).zz).toBe(1); expect((s.doc.sections[1] as unknown as { zz: number }).zz).toBe(3);
    expect(findControl(s.doc, 'Nom')!.control.props.zz).toBe(2);
    const t = act(selIn(withUnknown(), 'Nom', 'Ville'), { type: 'arrange', op: 'alignToGrid' }, { type: 'setSectionHeight', index: 1, height: 3000 });
    expect((t.doc as unknown as { zz: number }).zz).toBe(1); expect((t.doc.sections[1] as unknown as { zz: number }).zz).toBe(3);
    expect(findControl(t.doc, 'Nom')!.control.props.zz).toBe(2); });
  it('resize multi-selection', () => { const s = act(sel('Nom', 'Ville'), { type: 'resize', handle: 'e', dx: 284, dy: 0, free: true });
    expect([rect(s, 'Nom').width, rect(s, 'Ville').width]).toEqual([2552, 2552]); });
  it('resize snaps the moving edge, respects the minimum, leaves children alone', () => {
    expect(rect(act(sel('Nom'), { type: 'resize', handle: 'e', dx: 150, dy: 0 }), 'Nom').width).toBe(2416); // right edge 3552 -> 3550
    const m = act(sel('Nom'), { type: 'resize', handle: 'w', dx: 99999, dy: 0, free: true }); expect(rect(m, 'Nom').width).toBe(57); expect(rect(m, 'Étiquette_Nom').left).toBe(0);
    const d = fixture(); d.sections[1].controls.push(ctl('line', 'Trait', 0, 0, 1000, 0));
    expect(rect(act(selIn(d, 'Trait'), { type: 'resize', handle: 's', dx: 0, dy: -50, free: true }), 'Trait').height).toBe(0); });
  it('select, toggle, all, rubber band', () => {
    expect(act(init, { type: 'toggleSelect', name: 'Nom' }, { type: 'toggleSelect', name: 'Ville' }).selection).toEqual({ kind: 'controls', names: ['Nom', 'Ville'] });
    expect(act(init, { type: 'toggleSelect', name: 'Nom' }, { type: 'toggleSelect', name: 'Nom' }).selection).toEqual({ kind: 'controls', names: [] });
    expect(act(init, { type: 'selectAll' }).selection).toEqual({ kind: 'controls', names: ['Titre', 'Nom', 'Étiquette_Nom', 'Ville'] });
    const band = (add: boolean, r: { left: number; top: number; width: number; height: number }, s = init) => act(s, { type: 'selectRect', section: 1, rect: r, add }).selection;
    expect(band(false, { left: 1200, top: 500, width: 100, height: 100 })).toEqual({ kind: 'controls', names: ['Ville'] });
    expect(band(false, { left: 0, top: 0, width: 5000, height: 2000 })).toEqual({ kind: 'controls', names: ['Nom', 'Étiquette_Nom', 'Ville'] });
    expect(band(false, { left: 5000, top: 1500, width: 10, height: 10 })).toEqual({ kind: 'section', index: 1 });
    expect(band(true, { left: 1200, top: 500, width: 100, height: 100 }, sel('Nom'))).toEqual({ kind: 'controls', names: ['Nom', 'Ville'] }); });
  it('rubber band enclosed keeps whole controls only; Shift adds; no hit falls back to the section', () => {
    const d = fixture(); d.sections[1].controls = [ctl('textBox', 'A', 0, 0, 1000, 300), ctl('textBox', 'B', 900, 0, 1000, 300)];
    const s0 = initDesigner(d);
    const rect = { left: 0, top: 0, width: 1500, height: 400 };
    const names = (s: typeof init) => (s.selection as { names: string[] }).names;
    expect(names(act(s0, { type: 'selectRect', section: 1, rect, add: false }))).toEqual(['A', 'B']);
    expect(names(act(s0, { type: 'selectRect', section: 1, rect, add: false, enclosed: true }))).toEqual(['A']);
    const withB = act(s0, { type: 'select', selection: { kind: 'controls', names: ['B'] } });
    expect(names(act(withB, { type: 'selectRect', section: 1, rect, add: true, enclosed: true }))).toEqual(['B', 'A']);
    expect(act(s0, { type: 'selectRect', section: 1, rect: { ...rect, height: 0 }, add: false, enclosed: true }).selection).toEqual({ kind: 'section', index: 1 }); });
  it('edit applies a host operation', () => { const s = act(init, { type: 'edit', apply: (d) => ({ ...d, props: { ...d.props, Caption: 'Z' } }) });
    expect(s.doc.props.Caption).toBe('Z'); expect(s.dirty).toBe(true); expect(s.past).toHaveLength(1); });
  it('helpers', () => {
    expect(uniqueName(init.doc, 'Nom')).toBe('Nom1'); expect(uniqueName(init.doc, 'Autre')).toBe('Autre'); expect(uniqueName(init.doc, 'étiquette_nom')).toBe('étiquette_nom1');
    expect(sectionBottomLimit(init.doc.sections[1])).toBe(907); expect(sectionBottomLimit(init.doc.sections[2])).toBe(0);
    expect(CONTAINER_KINDS).toEqual(['optionGroup', 'tabControl']);
    expect(findControl(init.doc, 'étiquette_nom')).toMatchObject({ section: 1, parent: 'Nom' }); expect(findControl(init.doc, 'Nom')!.parent).toBeNull(); });
});

describe('fix round 1', () => {
  it('moveBy snaps only the axis that moves', () => { const s = act(sel('Nom'), { type: 'moveBy', dx: 0, dy: 142 }); expect(rect(s, 'Nom')).toMatchObject({ left: 1134, top: 142 });
    expect(rect(act(sel('Nom'), { type: 'moveBy', dx: 142, dy: 0 }), 'Nom')).toMatchObject({ left: 1278, top: 0 }); });
  it('sizeToNarrowest / sizeToShortest respect the per-kind minimum', () => {
    const d = fixture(); d.sections[1].controls.push(ctl('line', 'Trait', 0, 1000, 5, 0));
    const h = act(selIn(d, 'Ville', 'Trait'), { type: 'arrange', op: 'sizeToShortest' }); expect([rect(h, 'Ville').height, rect(h, 'Trait').height]).toEqual([57, 0]);
    const d2 = fixture(); d2.sections[1].controls.push(ctl('line', 'Trait', 0, 1000, 0, 0));
    const w = act(selIn(d2, 'Ville', 'Trait'), { type: 'arrange', op: 'sizeToNarrowest' }); expect([rect(w, 'Ville').width, rect(w, 'Trait').width]).toEqual([57, 0]); });
  it('vertical spacing is per section, horizontal stays global', () => {
    const d = fixture();
    d.sections[0].controls = [ctl('textBox', 'P', 0, 0, 100, 340), ctl('textBox', 'Q', 0, 1000, 100, 340)];
    d.sections[1].controls = [ctl('textBox', 'A', 0, 0, 100, 340), ctl('textBox', 'B', 0, 300, 100, 340), ctl('textBox', 'C', 0, 2000, 100, 340)];
    const names = ['P', 'Q', 'A', 'B', 'C'];
    const eq = act(selIn(d, ...names), { type: 'arrange', op: 'spaceVerticalEqual' }); expect(tops(eq, ...names)).toEqual([0, 1000, 0, 1000, 2000]);
    const inc = act(selIn(d, ...names), { type: 'arrange', op: 'spaceVerticalIncrease' }); expect(tops(inc, ...names)).toEqual([0, 1142, 0, 442, 2284]);
    const lone = act(selIn(d, 'P', 'A', 'B'), { type: 'arrange', op: 'spaceVerticalIncrease' }); expect(tops(lone, 'P', 'A', 'B')).toEqual([0, 0, 442]);
    expect(act(selIn(d, 'P', 'A'), { type: 'arrange', op: 'spaceVerticalIncrease' }).dirty).toBe(false);
    d.sections[0].controls[1].left = 300; d.sections[1].controls[0].left = 100; d.sections[1].controls[1].left = 150;
    const h = act(selIn(d, 'P', 'A', 'Q'), { type: 'arrange', op: 'spaceHorizontalIncrease' }); expect(lefts(h, 'P', 'A', 'Q')).toEqual([0, 242, 584]); });
  it('dropping into the own section keeps the stacking order and is a no-op without a move', () => {
    expect(act(sel('Nom'), { type: 'changeSection', to: 1, top: 0 }).dirty).toBe(false);
    const s = act(sel('Titre', 'Ville'), { type: 'changeSection', to: 1, top: 0 }); expect(s.doc.sections[1].controls.map((c) => c.name)).toEqual(['Nom', 'Ville', 'Titre']);
    expect(rect(s, 'Ville').top).toBe(567); expect(rect(s, 'Titre').top).toBe(0); });
  it('a report with no Width and no control is drawn at the catalog’s width, never 0', () => {
    const empty: DesignDoc = { formatVersion: '1.0', recordSource: null, props: {}, sections: [{ kind: 'detail', height: 2268, props: {}, controls: [] }] };
    expect(docWidth(empty, 'report')).toBe(6994);
  });
  it('a report document grows its Width too', () => {
    const d = fixture(); d.sections[0].kind = 'pageHeader'; d.sections[1].controls[1].left = 6000;
    expect(act(selIn(d, 'Ville'), { type: 'moveBy', dx: 10, dy: 0, free: true }).doc.props.Width).toBe(8278); });
  it('RecordSource is compared by content', () => {
    const d = { ...fixture(), recordSource: { kind: 'table', name: 'Clients' } as const };
    const same = act(initDesigner(d), { type: 'setProp', targets: [{ kind: 'doc' }], name: 'RecordSource', value: { kind: 'table', name: 'Clients' } }); expect(same.dirty).toBe(false);
    expect(act(initDesigner(d), { type: 'setProp', targets: [{ kind: 'doc' }], name: 'RecordSource', value: { kind: 'table', name: 'Autre' } }).dirty).toBe(true);
    expect(act(initDesigner({ ...fixture(), recordSource: { kind: 'sql', sql: 'select 1' } }), { type: 'setProp', targets: [{ kind: 'doc' }], name: 'RecordSource', value: { kind: 'sql', sql: 'select 2' } }).dirty).toBe(true); });
  it('doc Width never goes below the rightmost control', () => {
    const t = [{ kind: 'doc' as const }];
    expect(act(init, { type: 'setProp', targets: t, name: 'Width', value: 100 }).doc.props.Width).toBe(3402);
    expect(act(init, { type: 'setProp', targets: t, name: 'Width', value: 9000 }).doc.props.Width).toBe(9000);
    expect(act(init, { type: 'setProp', targets: t, name: 'Width', value: 99999 }).doc.props.Width).toBe(MAX_TWIPS);
    expect(act(init, { type: 'setProp', targets: t, name: 'Width', value: 'x' }).dirty).toBe(false); });
  it('history: a new action clears redo, the cap drops the oldest, undo to the saved state stays dirty', () => {
    const m = (dx: number): DesignerAction => ({ type: 'moveBy', dx, dy: 0, free: true });
    const u = act(sel('Nom'), m(284), { type: 'undo' }); expect(u.future).toHaveLength(1);
    const n = act(u, m(142)); expect(n.future).toHaveLength(0); expect(act(n, { type: 'redo' })).toBe(n);
    let h = sel('Ville'); for (let i = 0; i < 120; i++) h = act(h, m(1));
    expect(h.past).toHaveLength(100); expect(rect({ ...h, doc: h.past[0] }, 'Ville').left).toBe(1134 + 20);
    const sv = act(sel('Nom'), { type: 'saved' }, m(284), { type: 'undo' }); expect(rect(sv, 'Nom').left).toBe(1134); expect(sv.dirty).toBe(true); });
  it('objectKind set by the host wins over the inference from the sections (fit, form: / report: defaults)', () => {
    const detailOnly: DesignDoc = { ...threeDoc() };
    expect(documentKind(initDesigner(detailOnly))).toBe('form');                       // inferred: only form sections
    expect(documentKind(initDesigner(detailOnly, 'report'))).toBe('report');           // a report with only a Detail section
    const d = fixture(); d.sections[0].kind = 'pageHeader';
    expect(documentKind(initDesigner(d))).toBe('report');
    expect(documentKind(initDesigner(d, 'form'))).toBe('form');
    const r = act(initDesigner(detailOnly, 'report'), { type: 'load', doc: fixture() });
    expect(r.objectKind).toBe('report');                                               // load keeps the host's kind
    expect(act(r, { type: 'load', doc: fixture(), objectKind: 'form' }).objectKind).toBe('form');
    const grown = act(act(initDesigner(detailOnly, 'report'), { type: 'select', selection: { kind: 'controls', names: ['A'] } }), { type: 'moveBy', dx: 9000, dy: 0, free: true });
    expect(grown.doc.props.Width).toBe(11268); expect(grown.objectKind).toBe('report'); });
  it('a cross-section drop with a horizontal move is one action: snapped, or free with Alt; one undo restores it', () => {
    const s = act(sel('Ville'), { type: 'changeSection', to: 0, top: 100, dx: 150 });
    expect(rect(s, 'Ville')).toMatchObject({ left: 1278, top: 142 }); expect(findControl(s.doc, 'Ville')!.section).toBe(0);
    expect(s.past).toHaveLength(1);
    const u = act(s, { type: 'undo' }); expect(rect(u, 'Ville')).toMatchObject({ left: 1134, top: 567 }); expect(findControl(u.doc, 'Ville')!.section).toBe(1);
    expect(rect(act(sel('Ville'), { type: 'changeSection', to: 0, top: 100, dx: 150, free: true }), 'Ville')).toMatchObject({ left: 1284, top: 100 });
    const n = act(sel('Nom'), { type: 'changeSection', to: 2, top: 0, dx: -5000 });   // borné à 0, l'étiquette suit
    expect(rect(n, 'Étiquette_Nom').left).toBe(0); expect(rect(n, 'Nom').left).toBe(1134); });
  it('a move keeps the identity of untouched controls and sections (the canvas skips their rendering during a drag)', () => {
    const s0 = sel('Ville'); const s = act(s0, { type: 'moveBy', dx: 284, dy: 0, free: true });
    expect(findControl(s.doc, 'Nom')!.control).toBe(findControl(s0.doc, 'Nom')!.control);            // a parent with its attached label
    expect(findControl(s.doc, 'Étiquette_Nom')!.control).toBe(findControl(s0.doc, 'Étiquette_Nom')!.control);
    expect(s.doc.sections[0]).toBe(s0.doc.sections[0]); expect(s.doc.sections[2]).toBe(s0.doc.sections[2]);
    expect(findControl(s.doc, 'Ville')!.control).not.toBe(findControl(s0.doc, 'Ville')!.control); });
  it('a drop in another section keeps the identity of the controls it does not move', () => {
    const s0 = sel('Ville'); const s = act(s0, { type: 'changeSection', to: 0, top: 0 });
    expect(findControl(s.doc, 'Nom')!.control).toBe(findControl(s0.doc, 'Nom')!.control);
    expect(s.doc.sections[2]).toBe(s0.doc.sections[2]); });
});

describe('layouts stay in step with coordinates', () => {
  // Nom et Ville, chacun avec son étiquette, mis en disposition Empilé ou Tabulaire ; Width posé : fit n'écrit rien
  const base = (): DesignDoc => ({ formatVersion: '1.0', recordSource: null, props: { Width: 20000 }, sections: [
    section('formHeader', 567, []),
    section('detail', 3000, [ctl('textBox', 'Nom', 1134, 0, 2268, 340, [ctl('label', 'Étiquette_Nom', 0, 0, 1000, 340)]),
      ctl('textBox', 'Ville', 1134, 567, 2268, 340, [ctl('label', 'Étiquette_Ville', 0, 567, 1000, 340)])]),
    section('formFooter', 0, []),
  ] });
  const laid = (kind: 'stacked' | 'tabular'): DesignDoc => createLayout(base(), membersOf(base(), ['Nom', 'Ville']), kind, { headerSection: 'formHeader' });
  const stack = laid('stacked');
  const grid = (s: DesignerState) => readLayouts(s.doc)[0];

  it('resizing a data control widens the whole data column', () => {
    const s = act(selIn(stack, 'Nom'), { type: 'resize', handle: 'e', dx: 300, dy: 0, free: true });
    expect([rect(s, 'Nom').width, rect(s, 'Ville').width]).toEqual([2568, 2568]);
    expect(grid(s).cols).toEqual([1000, 2568]);
    expect(rect(s, 'Ville').left).toBe(rect(s, 'Nom').left);
  });
  it('resizing a padded data control learns its own size, not the padding', () => {
    const padded = reflow({ ...stack, sections: stack.sections.map((x) => ({ ...x, controls: x.controls.map((c) => (c.name === 'Ville' ? { ...c, props: { ...c.props, LeftPadding: 180 } } : c)) })) });
    const left = rect(selIn(padded, 'Nom') as DesignerState, 'Nom').left;
    const s = act(selIn(padded, 'Nom'), { type: 'resize', handle: 'e', dx: 300, dy: 0, free: true });
    expect(grid(s).cols[1]).toBe(2568);
    expect(rect(s, 'Nom')).toMatchObject({ left, width: 2568 });
  });
  it('resizing a colSpan 2 member adds the change to the last spanned column', () => {
    const l = readLayouts(stack)[0];
    const lay = { ...l, cells: [{ ...l.cells[0], colSpan: 2 }, ...l.cells.slice(2)] };   // row 0: one cell over both columns
    const doc = reflow({ ...stack, props: { ...stack.props, Layouts: [lay] } });
    expect(readLayouts(doc)).toHaveLength(1);
    const s = act(selIn(doc, lay.cells[0].control!), { type: 'resize', handle: 'e', dx: 200, dy: 0, free: true });
    expect(grid(s).cols).toEqual([1000, l.cols[1] + 200]);
  });
  it('resizing a rowSpan 2 member adds the change to the last spanned row', () => {
    const l = readLayouts(stack)[0];
    const lay = { ...l, cells: [{ ...l.cells[0], rowSpan: 2 }, l.cells[1], l.cells[3]] };   // column 0: one cell over both rows
    const doc = reflow({ ...stack, props: { ...stack.props, Layouts: [lay] } });
    expect(readLayouts(doc)).toHaveLength(1);
    const s = act(selIn(doc, lay.cells[0].control!), { type: 'resize', handle: 's', dx: 0, dy: 200, free: true });
    expect(grid(s).rows.map((r) => r.height)).toEqual([l.rows[0].height, l.rows[1].height + 200]);
  });
  it('setProp Width / Height of a member sets its column / row', () => {
    const s = act(selIn(stack, 'Ville'), { type: 'setProp', targets: [{ kind: 'control', name: 'Ville' }], name: 'Width', value: 3000 },
      { type: 'setProp', targets: [{ kind: 'control', name: 'Nom' }], name: 'Height', value: 500 });
    expect(rect(s, 'Nom').width).toBe(3000);
    expect(rect(s, 'Étiquette_Nom').height).toBe(500);
    expect(rect(s, 'Ville').top).toBe(rect(s, 'Nom').top + 500 + ROW_GAP);
  });
  it('resizing a header label grows the header row of a tabular layout', () => {
    const tab = laid('tabular');
    const s = act(selIn(tab, 'Étiquette_Nom'), { type: 'resize', handle: 's', dx: 0, dy: 200, free: true });
    expect([rect(s, 'Étiquette_Nom').height, rect(s, 'Étiquette_Ville').height]).toEqual([540, 540]);
    expect(grid(s).rows[0].height).toBe(540);
  });
  it('a free move of a member does nothing: the same state comes back', () => {
    const s0 = selIn(stack, 'Nom');
    expect(act(s0, { type: 'moveBy', dx: 284, dy: 142, free: true })).toBe(s0);
    expect(act(s0, { type: 'setProp', targets: [{ kind: 'control', name: 'Nom' }], name: 'Left', value: 5000 })).toBe(s0);
  });
  it('the whole layout selected moves as a block: members, left and tops shift by the same delta, one undo', () => {
    for (const d of [stack, laid('tabular')]) {
      const s0 = selIn(d, ...selectionOf(d, 'Nom', 'layout'));
      const s = act(s0, { type: 'moveBy', dx: 284, dy: 142, free: true });
      const names = selectionOf(d, 'Nom', 'layout');
      expect(names.map((n) => rect(s, n))).toEqual(names.map((n) => { const r = rect(s0, n); return { ...r, left: r.left + 284, top: r.top + 142 }; }));
      const l0 = grid(s0);
      expect(grid(s)).toEqual({ ...l0, left: l0.left + 284, tops: Object.fromEntries(Object.entries(l0.tops).map(([k, t]) => [k, t + 142])) });
      expect(s.past).toHaveLength(1); expect(act(s, { type: 'undo' }).doc).toBe(d);
    }
  });
  it('a non-member moves, members stay put', () => {
    const d = structuredClone(stack); d.sections[1].controls.push(ctl('textBox', 'Libre', 5000, 0));
    const s = act(selIn(d, 'Nom', 'Libre'), { type: 'moveBy', dx: 284, dy: 0, free: true });
    expect(rect(s, 'Libre').left).toBe(5284); expect(rect(s, 'Nom')).toEqual(controlRect(findControl(d, 'Nom')!.control));
  });
  it('deleting a member deletes its label, leaves empty cells, keeps the layout, one undo', () => {
    const s = act(selIn(stack, 'Nom'), { type: 'deleteSelection' });
    expect(findControl(s.doc, 'Étiquette_Nom')).toBeNull();
    expect(grid(s).cells.filter((c) => c.row === 0).map((c) => c.control)).toEqual([null, null]);
    expect(rect(s, 'Ville')).toEqual(controlRect(findControl(stack, 'Ville')!.control));
    expect(s.past).toHaveLength(1); expect(act(s, { type: 'undo' }).doc).toBe(stack);
  });
  it('deleting every member removes Layouts', () => {
    const s = act(selIn(stack, 'Nom', 'Ville'), { type: 'deleteSelection' });
    expect(s.doc.props).not.toHaveProperty('Layouts');
    expect(s.doc.sections[1].controls).toEqual([]);
  });
  it('one undo after a resize restores coordinates and Layouts', () => {
    const s0 = selIn(stack, 'Nom');
    const s = act(s0, { type: 'resize', handle: 'e', dx: 300, dy: 0, free: true });
    expect(s.past).toHaveLength(1);
    expect(act(s, { type: 'undo' }).doc).toBe(s0.doc);
  });
  it('renaming a member renames its cell', () => {
    const s = act(selIn(stack, 'Nom'), { type: 'setProp', targets: [{ kind: 'control', name: 'Nom' }], name: 'Name', value: 'NomClient' });
    expect(grid(s).cells.map((c) => c.control)).toContain('NomClient');
    expect(findControl(s.doc, 'NomClient')!.control.props.LayoutID).toBe(grid(s).id);
  });
  it('a member dropped in another section leaves the layout', () => {
    const s = act(selIn(stack, 'Nom'), { type: 'changeSection', to: 0, top: 0, free: true });
    expect(findControl(s.doc, 'Nom')).toMatchObject({ section: 0 });
    expect(grid(s).cells.map((c) => c.control)).not.toContain('Nom');
    expect(findControl(s.doc, 'Nom')!.control.props).not.toHaveProperty('LayoutID');
  });
  it('a member moved past the document width or the section bottom grows nothing: the same state comes back', () => {
    const d = structuredClone(stack); d.props.Width = 6000;
    const s0 = selIn(d, 'Nom');
    const s = act(s0, { type: 'moveBy', dx: 9000, dy: 5000, free: true });
    expect(s).toBe(s0); expect(s.past).toHaveLength(0);
  });
  it('inserted rows grow the section to hold the lowest member, in the same history entry', () => {
    const d = structuredClone(stack); d.sections[1].height = 900;
    const below: DesignerAction = { type: 'edit', apply: (x) => insertCells(x, 'Nom', 'below') };
    const s = act(initDesigner(d), below, below, below);
    expect(rect(s, 'Ville').top + rect(s, 'Ville').height).toBe(2 * 340 + 4 * ROW_GAP + 3 * INSERT_ROW_HEIGHT);
    expect(s.doc.sections[1].height).toBe(2 * 340 + 4 * ROW_GAP + 3 * INSERT_ROW_HEIGHT);
    expect(s.past).toHaveLength(3);
  });
  it('a resize that makes a member taller grows the section within the same single history entry', () => {
    const d = structuredClone(stack); d.sections[1].height = 900;
    const s = act(selIn(d, 'Nom'), { type: 'resize', handle: 's', dx: 0, dy: 400, free: true });
    expect(s.doc.sections[1].height).toBe(740 + ROW_GAP + 340);
    expect(s.past).toHaveLength(1); expect(act(s, { type: 'undo' }).doc).toBe(d);
  });
  describe('a tab control member carries its content', () => {
    const tabBase = (): DesignDoc => { const d = base();
      d.sections[1].controls = [d.sections[1].controls[0], ctl('tabControl', 'Onglet', 4000, 0, 3000, 2000, [ctl('textBox', 'Dedans', 4100, 300, 1000, 340)])];
      return d; };
    const tab = createLayout(tabBase(), membersOf(tabBase(), ['Nom', 'Onglet']), 'tabular', { headerSection: 'formHeader' });
    it('creation moved the content with the tab control', () => {
      expect(rect(initDesigner(tab), 'Dedans').left - rect(initDesigner(tab), 'Onglet').left).toBe(100);
    });
    it('a move of the tab control leaves it and its content in place', () => {
      const s0 = selIn(tab, 'Onglet');
      expect(act(s0, { type: 'moveBy', dx: 284, dy: 0, free: true })).toBe(s0);
    });
    it('widening an earlier column shifts the tab control and its content together', () => {
      const s0 = selIn(tab, 'Nom');
      const s = act(s0, { type: 'resize', handle: 'e', dx: 300, dy: 0, free: true });
      expect(lefts(s, 'Onglet', 'Dedans')).toEqual(lefts(s0, 'Onglet', 'Dedans').map((x) => x + 300));
      expect(tops(s, 'Dedans')).toEqual(tops(s0, 'Dedans'));
    });
  });
  describe('un contrôle posé sur une disposition en devient membre', () => {
    const neuf = () => ctl('textBox', 'Neuf', 8000, 2000, 2000, 400, [ctl('label', 'Étiquette_Neuf', 6500, 2000, 1400, 340)]);
    const ville = () => rect(initDesigner(stack), 'Ville');
    const over = (): DesignerAction => ({ type: 'insert', section: 1, controls: [neuf()], at: { x: ville().left + 100, y: ville().top + 10 } });
    it('insert au-dessus de la moitié haute de Ville : une ligne de plus, puis une seule annulation retire contrôle et appartenance', () => {
      const s0 = initDesigner(stack);
      const s = act(s0, over());
      expect(grid(s).cells.filter((c) => c.row === 1).map((c) => c.control)).toEqual(['Étiquette_Neuf', 'Neuf']);
      expect(rect(s, 'Neuf')).toMatchObject({ left: ville().left, top: ville().top, height: 400 });
      expect(rect(s, 'Ville').top).toBe(ville().top + 400 + ROW_GAP);
      expect(s.selection).toEqual({ kind: 'controls', names: ['Neuf'] });
      expect(s.past).toHaveLength(1);
      expect(act(s, { type: 'undo' }).doc).toBe(stack);
    });
    it('sans `at`, ou hors de toute disposition : le même document qu\'aujourd\'hui', () => {
      const plain: DesignerAction = { type: 'insert', section: 1, controls: [neuf()] };
      const today = act(initDesigner(stack), plain);
      expect(grid(today)).toEqual(grid(initDesigner(stack)));
      expect(JSON.stringify(act(initDesigner(stack), { ...plain, at: { x: 12000, y: 10 } }).doc)).toBe(JSON.stringify(today.doc));
    });
    it('dans un conteneur (parent) : jamais membre', () => {
      const d = structuredClone(stack); d.sections[1].controls.push(ctl('tabControl', 'Onglet', 6000, 3000, 3000, 2000));
      const s = act(initDesigner(d), { ...over(), parent: 'Onglet' });
      expect(grid(s)).toEqual(grid(initDesigner(d)));
    });
  });
  it('a document with no Layouts goes through every action untouched by the layout step', () => {
    const acts: DesignerAction[] = [{ type: 'moveBy', dx: 284, dy: 0 }, { type: 'resize', handle: 'e', dx: 284, dy: 0 }, { type: 'deleteSelection' },
      { type: 'setProp', targets: [{ kind: 'control', name: 'Nom' }], name: 'Width', value: 3000 }, { type: 'arrange', op: 'alignToGrid' },
      { type: 'changeSection', to: 0, top: 0 }, { type: 'insert', section: 1, controls: [ctl('textBox', 'X')] }, { type: 'undo' }];
    for (const a of acts) {
      const s0 = sel('Nom', 'Ville'); const next = coreReducer(s0, a);
      expect(syncLayouts(s0, a, next)).toBe(next);
    }
  });
});

describe('dispositions d\'un état : un contrôle posé en devient membre (L3c)', () => {
  const sec = (kind: DesignDoc['sections'][number]['kind'], height: number, controls: ControlDef[], groupLevel?: number) =>
    ({ kind, height, props: {}, controls, ...(groupLevel === undefined ? {} : { groupLevel }) });
  const neuf = () => ctl('textBox', 'Neuf', 8000, 2000, 2000, 400, [ctl('label', 'Étiquette_Neuf', 6500, 2000, 1400, 340)]);
  const rdoc = (): DesignDoc => ({ formatVersion: '1.0', recordSource: null, props: {}, sections: [
    sec('pageHeader', 500, []),
    sec('detail', 800, [ctl('textBox', 'Nom', 0, 0, 1500, 340, [ctl('label', 'ÉtiqNom', 0, 0, 1500, 340)]), ctl('textBox', 'Ville', 1700, 0, 1500, 340, [ctl('label', 'ÉtiqVille', 1700, 0, 1500, 340)])]),
    sec('groupHeader', 1500, [ctl('textBox', 'GA', 2000, 0, 1500, 340, [ctl('label', 'ÉtiqGA', 0, 0, 1500, 340)]), ctl('textBox', 'GB', 2000, 500, 1500, 340, [ctl('label', 'ÉtiqGB', 0, 500, 1500, 340)])], 0),
  ] });
  const tabular = (): DesignDoc => { const d = rdoc();
    const t = createLayout(d, membersOf(d, ['Nom', 'Ville']), 'tabular', { headerSection: 'pageHeader' });
    return createLayout(t, membersOf(t, ['GA', 'GB']), 'stacked', { headerSection: 'groupHeader:0' }); };
  const sectionOf = (d: DesignDoc, n: string) => d.sections.find((x) => x.controls.some((c) => c.name === n))!.kind;
  const grid = (s: DesignerState, member: string) => readLayouts(s.doc).find((l) => l.cells.some((c) => c.control === member))!;
  const start = () => initDesigner(tabular(), 'report');

  it('Tabular : posé sur une cellule du détail, une colonne de plus (étiquette dans l\'en-tête de page), une annulation restaure', () => {
    const s0 = start();
    const nom = rect(s0, 'Nom');
    const s = act(s0, { type: 'insert', section: 1, controls: [neuf()], at: { x: nom.left + nom.width - 10, y: nom.top + 10 } });
    const l = grid(s, 'Nom');
    expect(l.cols).toHaveLength(3);
    expect(l.cells.filter((c) => c.control === 'Neuf' || c.control === 'Étiquette_Neuf')).toHaveLength(2);
    expect(sectionOf(s.doc, 'Étiquette_Neuf')).toBe('pageHeader');
    expect(sectionOf(s.doc, 'Neuf')).toBe('detail');
    expect(findControl(s.doc, 'Neuf')!.control.props.LayoutID).toBe(l.id);
    expect(s.past).toHaveLength(1);
    expect(act(s, { type: 'undo' }).doc).toBe(s0.doc);
  });
  it('Stacked dans un en-tête de groupe (groupHeader:0) : le dépôt dans la disposition y ajoute une ligne', () => {
    const s0 = start();
    const gb = rect(s0, 'GB');
    const l0 = readLayouts(s0.doc).find((l) => l.rows.some((r) => r.section === 'groupHeader:0'))!;
    const s = act(s0, { type: 'insert', section: 2, controls: [neuf()], at: { x: gb.left + 10, y: gb.top + 10 } });
    const l = readLayouts(s.doc).find((x) => x.id === l0.id)!;
    expect(l.rows).toHaveLength(l0.rows.length + 1);
    expect(l.cells.some((c) => c.control === 'Neuf')).toBe(true);
    expect(sectionOf(s.doc, 'Neuf')).toBe('groupHeader');
  });
  it('un point hors de toute disposition : la disposition reste telle quelle', () => {
    const s0 = start();
    const s = act(s0, { type: 'insert', section: 1, controls: [neuf()], at: { x: 9000, y: 10 } });
    expect(JSON.stringify(readLayouts(s.doc))).toBe(JSON.stringify(readLayouts(s0.doc)));
    expect(findControl(s.doc, 'Neuf')!.control.props.LayoutID).toBeUndefined();
  });
  it('fit : la colonne qui dépasse la largeur de page élargit Width', () => {
    const s0 = start();
    const right = Math.max(...s0.doc.sections.flatMap((x) => x.controls).map((c) => c.left + c.width));
    const d = { ...s0.doc, props: { ...s0.doc.props, Width: right } };
    const nom = rect(initDesigner(d, 'report'), 'Nom');
    const s = act(initDesigner(d, 'report'), { type: 'insert', section: 1, controls: [neuf()], at: { x: nom.left + 10, y: nom.top + 10 } });
    expect(Number(s.doc.props.Width)).toBeGreaterThan(right);
    expect(Number(s.doc.props.Width)).toBeGreaterThanOrEqual(rect(s, 'Neuf').left + rect(s, 'Neuf').width);
  });
  describe('empty cells', () => {
    const d = insertCells(createLayout(fixture(), membersOf(fixture(), ['Nom', 'Ville']), 'stacked', { headerSection: 'formHeader' }), 'Nom', 'right');
    const l = readLayouts(d)[0];
    const empty = l.cells.find((c) => c.control === null)!;
    const cell = { layout: l.id, row: empty.row, col: empty.col };
    it('selectCell replaces, or toggles with add and keeps the names', () => {
      const s = act(initDesigner(d), { type: 'selectCell', cell, add: false });
      expect(s.selection).toEqual({ kind: 'controls', names: [], cells: [cell] });
      const s2 = act(selIn(d, 'Nom'), { type: 'selectCell', cell, add: true });
      expect(s2.selection).toEqual({ kind: 'controls', names: ['Nom'], cells: [cell] });
      expect(act(s2, { type: 'selectCell', cell, add: true }).selection).toEqual({ kind: 'controls', names: ['Nom'] });
      expect(act(s2, { type: 'toggleSelect', name: 'Ville' }).selection).toEqual({ kind: 'controls', names: ['Nom', 'Ville'], cells: [cell] });
    });
    it('a ref naming a slot covered by a merged empty cell, not its anchor, is dropped', () => {
      const [a, b] = [{ layout: l.id, row: 0, col: 2 }, { layout: l.id, row: 1, col: 2 }];
      const merged = { ...l, cells: l.cells.filter((c) => !(c.col === 2)).concat({ row: 0, col: 2, rowSpan: 2, control: null }) };
      const s = act({ ...initDesigner(d), selection: { kind: 'controls', names: [], cells: [a, b] } }, { type: 'edit', apply: (x) => withLayouts(x, [merged]) });
      expect(s.selection).toEqual({ kind: 'controls', names: [], cells: [a] });
    });
    it('a doc edit that removes the cell drops it from the selection', () => {
      const s = act(initDesigner(d), { type: 'selectCell', cell, add: false }, { type: 'edit', apply: (x) => removeLayout(x, l.id) });
      expect(s.selection).toEqual({ kind: 'doc' });
    });
  });
});

describe('L5 cellules vides dans le concepteur', () => {
  const base = (): DesignDoc => ({ formatVersion: '1.0', recordSource: null, props: { Width: 20000 }, sections: [
    section('formHeader', 567, []),
    section('detail', 3000, [ctl('textBox', 'Nom', 1134, 0, 2268, 340, [ctl('label', 'Étiquette_Nom', 0, 0, 1000, 340)]),
      ctl('textBox', 'Ville', 1134, 567, 2268, 340, [ctl('label', 'Étiquette_Ville', 0, 567, 1000, 340)]), ctl('textBox', 'Libre', 9000, 2500, 1000, 340)]),
    section('formFooter', 0, []),
  ] });
  const stack = createLayout(base(), membersOf(base(), ['Nom', 'Ville']), 'stacked', { headerSection: 'formHeader' });
  const d = insertCells(stack, 'Ville', 'below');   // row 2 : two empty cells
  const empties = emptyCellsOf(d);
  const ref = (col: number) => ({ layout: readLayouts(d)[0].id, row: 2, col });
  const mid = (col: number) => { const r = empties.find((e) => e.row === 2 && e.col === col)!.rect; return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; };
  const neuf = () => ctl('label', 'Neuf', 8000, 100, 500, 200);
  const field = () => ctl('textBox', 'Champ', 8000, 100, 2000, 400, [ctl('label', 'Étiquette_Champ', 6500, 100, 1400, 340)]);
  const cellOf = (s: DesignerState, name: string) => readLayouts(s.doc)[0].cells.find((c) => c.control === name);

  it('insert at an empty cell fills it, one undo step', () => {
    const s0 = initDesigner(d);
    const s = act(s0, { type: 'insert', section: 1, controls: [neuf()], at: mid(1) });
    const r = empties.find((e) => e.row === 2 && e.col === 1)!.rect;
    expect(rect(s, 'Neuf')).toMatchObject({ left: r.left, top: r.top, width: r.width });
    expect(findControl(s.doc, 'Neuf')!.control.props.LayoutID).toBe(readLayouts(d)[0].id);
    expect(cellOf(s, 'Neuf')).toMatchObject({ row: 2, col: 1 });
    expect(s.selection).toEqual({ kind: 'controls', names: ['Neuf'] });
    expect(s.past).toHaveLength(1);
    expect(act(s, { type: 'undo' }).doc).toBe(d);
  });
  it('insert of a field at the right cell: text box there, label in the left cell', () => {
    const s = act(initDesigner(d), { type: 'insert', section: 1, controls: [field()], at: mid(1) });
    expect(cellOf(s, 'Champ')).toMatchObject({ row: 2, col: 1 });
    expect(cellOf(s, 'Étiquette_Champ')).toMatchObject({ row: 2, col: 0 });
    expect(readLayouts(s.doc)[0].rows).toHaveLength(3);
  });
  it('insert at a gap or on an occupied cell keeps the L4 placement', () => {
    const nom = rect(initDesigner(d), 'Nom');
    const occ = act(initDesigner(d), { type: 'insert', section: 1, controls: [neuf()], at: { x: nom.left + 10, y: nom.top + 10 } });
    expect(readLayouts(occ.doc)[0].rows).toHaveLength(4);
    const gap = act(initDesigner(d), { type: 'insert', section: 1, controls: [neuf()], at: { x: 12000, y: 10 } });
    expect(readLayouts(gap.doc)).toEqual(readLayouts(d));
  });
  it('insert of an option group at a cell: L4 behaviour', () => {
    const og = ctl('optionGroup', 'Groupe', 8000, 100, 2000, 1000);
    const s = act(initDesigner(d), { type: 'insert', section: 1, controls: [og], at: mid(1) });
    expect(cellOf(s, 'Groupe')).toBeUndefined();
  });
  it('moveBy with drop in an empty cell: the member fills it, its old cell is empty', () => {
    const s = act(selIn(d, 'Ville'), { type: 'moveBy', dx: 100, dy: 600, free: true, drop: mid(1) });
    expect(cellOf(s, 'Ville')).toMatchObject({ row: 2, col: 1 });
    expect(readLayouts(s.doc)[0].cells.find((c) => c.row === 1 && c.col === 1)!.control).toBeNull();
    const r = empties.find((e) => e.row === 2 && e.col === 1)!.rect;
    expect(rect(s, 'Ville')).toMatchObject({ left: r.left, top: r.top });
  });
  it('moveBy with drop: a loose control joins the layout', () => {
    const s = act(selIn(d, 'Libre'), { type: 'moveBy', dx: -3000, dy: -300, free: true, drop: mid(1) });
    expect(cellOf(s, 'Libre')).toMatchObject({ row: 2, col: 1 });
    expect(findControl(s.doc, 'Libre')!.control.props.LayoutID).toBe(readLayouts(d)[0].id);
  });
  it('moveBy with drop on an occupied cell or outside: the member returns to its cell', () => {
    const nom = rect(initDesigner(d), 'Nom');
    for (const drop of [{ x: nom.left + 10, y: nom.top + 10 }, { x: 15000, y: 10 }]) {
      const s = act(selIn(d, 'Ville'), { type: 'moveBy', dx: 100, dy: 600, free: true, drop });
      expect(cellOf(s, 'Ville')).toMatchObject({ row: 1, col: 1 });
      expect(readLayouts(s.doc)[0].cells.find((c) => c.row === 2 && c.col === 1)!.control).toBeNull();
    }
  });
  it('changeSection with drop in an empty cell of the target section fills it', () => {
    const s0 = selIn({ ...d, sections: d.sections.map((x, i) => (i === 0 ? { ...x, controls: [ctl('textBox', 'Haut', 0, 0, 1000, 340)] } : x)) }, 'Haut');
    const s = act(s0, { type: 'changeSection', to: 1, top: 2000, free: true, drop: mid(1) });
    expect(cellOf(s, 'Haut')).toMatchObject({ row: 2, col: 1 });
    expect(s.doc.sections[1].controls.some((c) => c.name === 'Haut')).toBe(true);
  });
  describe('deleteSelection with cells', () => {
    const both = [ref(0), ref(1)];
    it('both cells of the empty row: row removed, selection doc, one undo step', () => {
      const s = act(initDesigner(d), { type: 'select', selection: { kind: 'controls', names: [], cells: both } }, { type: 'deleteSelection' });
      expect(readLayouts(s.doc)[0].rows).toHaveLength(2);
      expect(s.selection).toEqual({ kind: 'doc' });
      expect(s.past).toHaveLength(1);
      expect(act(s, { type: 'undo' }).doc).toBe(d);
    });
    it('one cell only: nothing changes', () => {
      const s0 = act(initDesigner(d), { type: 'select', selection: { kind: 'controls', names: [], cells: [ref(1)] } });
      const s = act(s0, { type: 'deleteSelection' });
      expect(s.doc).toBe(d);
      expect(s.past).toHaveLength(0);
    });
    it('names only (control and label row): the empty row stays', () => {
      const s = act(selIn(d, 'Ville'), { type: 'deleteSelection' });
      expect(readLayouts(s.doc)[0].rows).toHaveLength(3);
      expect(findControl(s.doc, 'Étiquette_Ville')).toBeFalsy();
    });
    it('Select Row result (names and cells) removes the row and its label', () => {
      const sr = selectionIn(d, { layout: readLayouts(d)[0].id, row: 1, col: 1 }, 'row');
      const s = act(initDesigner(d), { type: 'select', selection: { kind: 'controls', ...sr } }, { type: 'deleteSelection' });
      expect(readLayouts(s.doc)[0].rows).toHaveLength(2);
      expect(findControl(s.doc, 'Ville')).toBeFalsy();
      expect(findControl(s.doc, 'Étiquette_Ville')).toBeFalsy();
    });
  });
  it('setProp on a cell target: BackColor in props, Width changes the column, Name ignored', () => {
    const t = [{ kind: 'cell' as const, ...ref(1) }];
    const s = act(initDesigner(d), { type: 'setProp', targets: t, name: 'BackColor', value: 255 });
    expect(readLayouts(s.doc)[0].cells.find((c) => c.row === 2 && c.col === 1)!.props).toEqual({ BackColor: 255 });
    const w = act(initDesigner(d), { type: 'setProp', targets: t, name: 'Width', value: 3000 });
    expect(readLayouts(w.doc)[0].cols[1]).toBe(3000);
    expect(rect(w, 'Ville').width).toBe(3000);
    const n = act(initDesigner(d), { type: 'setProp', targets: t, name: 'Name', value: 'X' });
    expect(n.doc).toBe(d);
  });
});
