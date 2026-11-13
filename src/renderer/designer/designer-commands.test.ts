import { describe, expect, it } from 'vitest';
import { ARRANGE_MENUS, arrangeItemEnabled, designerCommands, historyCommands, historyStates, setChartProps, subObjectOf, type ArrangeMenu } from './designer-commands';
import { designerReducer, initDesigner, type DesignerAction } from './designer-model';
import { selectedChart } from './chart-settings-model';
import type { DesignDoc } from '../../shared/design/model';

describe('arrange commands', () => {
  it('arrange menus and their enabled items', () => {
    expect(ARRANGE_MENUS.align).toEqual(['alignToGrid', 'alignLeft', 'alignRight', 'alignTop', 'alignBottom']);
    expect(ARRANGE_MENUS.sizeSpace.at(-1)).toBe('toggleSnap');
    expect([arrangeItemEnabled('alignToGrid', 1), arrangeItemEnabled('alignLeft', 1), arrangeItemEnabled('alignLeft', 2)]).toEqual([true, false, true]);
    expect([arrangeItemEnabled('spaceVerticalEqual', 2), arrangeItemEnabled('spaceVerticalEqual', 3), arrangeItemEnabled('toggleSnap', 0)]).toEqual([false, true, true]); });
  it('arrange commands', () => { const got: DesignerAction[] = []; const menus: ArrangeMenu[] = [];
    const h = designerCommands((a) => got.push(a), (m) => menus.push(m), 2);
    h.bringToFront!(); h.sizeSpace!(); h.align!(); h.sendToBack!();
    expect(got).toEqual([{ type: 'arrange', op: 'bringToFront' }, { type: 'arrange', op: 'sendToBack' }]); expect(menus).toEqual(['sizeSpace', 'align']);
    const empty: ArrangeMenu[] = [];
    const none = designerCommands(() => {}, (m) => empty.push(m), 0);   // Aimanter à la grille reste accessible sans sélection
    expect(Object.keys(none)).toEqual(['sizeSpace']); none.sizeSpace!(); expect(empty).toEqual(['sizeSpace']); });
});

describe('Subform / Subreport in New Window', () => {
  const ctl = (kind: 'subform' | 'textBox', name: string, SourceObject?: string) => ({ kind, name, left: 0, top: 0, width: 100, height: 100, props: SourceObject === undefined ? {} : { SourceObject } });
  const doc = { formatVersion: '1.0', recordSource: null, props: {}, sections: [{ kind: 'detail', height: 500, props: {}, controls: [
    ctl('subform', 'Sub', ' Lignes '), ctl('subform', 'Vide', ''), ctl('subform', 'Sans'), ctl('textBox', 'Txt', 'Lignes')] }] } as DesignDoc;
  const pick = (...names: string[]) => subObjectOf({ ...initDesigner(doc), selection: { kind: 'controls', names } });
  it('the one selected subform control with a Source Object gives its name; anything else gives null', () => {
    expect(pick('Sub')).toBe('Lignes');
    for (const names of [[], ['Vide'], ['Sans'], ['Txt'], ['Sub', 'Vide']]) expect(pick(...names), names.join()).toBeNull();
    expect(subObjectOf({ ...initDesigner(doc), selection: { kind: 'doc' } })).toBeNull();
  });
});

describe('setChartProps', () => {
  const doc: DesignDoc = { formatVersion: '1.0', recordSource: null, props: {}, sections: [{ kind: 'detail', height: 3000, props: {}, controls: [
    { kind: 'chart', name: 'G1', left: 0, top: 0, width: 4000, height: 3000, props: { ChartType: 'pie', ChartLegend: 'X' } },
    { kind: 'textBox', name: 'T1', left: 0, top: 0, width: 1000, height: 300, props: {} }] }] };
  it('patches only charts, removes undefined keys, one undo step', () => {
    let s = initDesigner(doc, 'form');
    s = designerReducer(s, setChartProps(['G1', 'T1'], { ChartAxis: ['A'], ChartLegend: undefined }));
    const [g, t] = s.doc.sections[0]!.controls;
    expect(g!.props).toEqual({ ChartType: 'pie', ChartAxis: ['A'] });
    expect(t!.props).toEqual({});
    expect(s.dirty).toBe(true);
    s = designerReducer(s, { type: 'undo' });
    expect(s.doc.sections[0]!.controls[0]!.props).toEqual({ ChartType: 'pie', ChartLegend: 'X' });
  });
});

describe('selectedChart (the chartSettings handler is registered only for exactly one chart)', () => {
  const chart = (name: string) => ({ kind: 'chart' as const, name, left: 0, top: 0, width: 4000, height: 3000, props: {} });
  const doc: DesignDoc = { formatVersion: '1.0', recordSource: null, props: {}, sections: [{ kind: 'detail', height: 3000, props: {}, controls: [
    chart('G1'), chart('G2'), { kind: 'textBox', name: 'T1', left: 0, top: 0, width: 1000, height: 300, props: {} }] }] };
  const pick = (names: string[]) => selectedChart({ ...initDesigner(doc, 'form'), selection: { kind: 'controls', names } })?.name ?? null;
  it('is null for no selection, two charts or a non-chart', () => {
    expect([pick([]), pick(['G1', 'G2']), pick(['T1'])]).toEqual([null, null, null]);
    expect(pick(['G2'])).toBe('G2');
  });
});

describe('history commands (Quick Access Toolbar Undo / Redo)', () => {
  it('undo and redo dispatch; each enabled when the designer has a past, a future', () => {
    const got: DesignerAction[] = [];
    const h = historyCommands((a) => got.push(a));
    h.undo!(); h.redo!();
    expect(got).toEqual([{ type: 'undo' }, { type: 'redo' }]);
    const doc = {} as DesignDoc;
    expect(historyStates({ past: [], future: [] })).toEqual({ undo: { enabled: false }, redo: { enabled: false } });
    expect(historyStates({ past: [doc], future: [] })).toEqual({ undo: { enabled: true }, redo: { enabled: false } });
    expect(historyStates({ past: [], future: [doc] })).toEqual({ undo: { enabled: false }, redo: { enabled: true } });
  });
});
