import { describe, expect, it } from 'vitest';
import type { ControlDef, DesignDoc, SectionDef } from '../../shared/design/model';
import { readLayouts } from '../../shared/design/layout';
import { createLayout, membersOf } from '../../shared/design/layout-edit';
import { designerReducer, initDesigner, type DesignerAction, type DesignerState } from './designer-model';
import { layoutAction, layoutCommands, type FormHeader, type LayoutCommand } from './layout-commands';

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
  it('all twelve for a member selection, dispatching at call time', () => {
    const doc = createLayout(formDoc(), membersOf(formDoc(), ['A', 'B']), 'stacked', { headerSection: 'formHeader' });
    const h = mk(sel(doc, ['A']));
    expect(Object.keys(h).sort()).toEqual([...ALL].sort());
    h.selectRow!();
    expect(dispatched.at(-1)?.type).toBe('select');
  });
});
