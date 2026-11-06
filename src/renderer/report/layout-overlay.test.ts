import { describe, expect, it } from 'vitest';
import { COL_GAP, readLayouts, reflow, type Layout } from '../../shared/design/layout';
import type { ControlDef, DesignDoc, SectionDef } from '../../shared/design/model';
import type { LaidOutBand, LaidOutItem, LaidOutReport } from '../../shared/report/types';
import { DEFAULT_SIZE } from '../designer/units';
import { MIN_WIDTH, containerAt, deleteTargets, overlayFor, selectionAt, placement, resizeTo, stepDrag, type WidthDrag } from './layout-overlay';

const T = (name: string, left: number, top: number, width = 1000, height = 200): LaidOutItem => ({ kind: 'text', name, left, top, width, height, lines: [],
  font: { name: 'Arial', size: 10, bold: false, italic: false, underline: false }, color: '#000000', back: null, border: null } as unknown as LaidOutItem);
const band = (top: number, items: LaidOutItem[], section: LaidOutBand['section'] = 'detail'): LaidOutBand =>
  ({ section, top, left: 500, width: 10000, height: 300, back: null, items } as unknown as LaidOutBand);
// Total : une fois par enregistrement (3) ; Titre : une fois dans l'en-tête ; Cache : aucune occurrence (masqué)
const rep = (): LaidOutReport => ({ width: 11906, height: 2000, issues: [], pages: [{ number: 1, bands: [
  band(0, [T('Titre', 100, 50)], 'reportHeader'), band(400, [T('Total', 200, 0)]), band(700, [T('Total', 200, 0)]), band(1000, [T('Total', 200, 0), T('', 3000, 0)]),
] }] });

describe('overlayFor', () => {
  it('one ring per occurrence of each selected control', () => {
    expect(overlayFor(rep(), ['Total'], 1).rings).toHaveLength(3);
    expect(overlayFor(rep(), ['Total', 'Titre'], 1).rings).toHaveLength(4);
  });
  it('a control with no occurrence (hidden, zero height): no ring, no handle, no throw', () => {
    expect(overlayFor(rep(), ['Cache'], 1)).toEqual({ rings: [], handle: null });
    expect(overlayFor({ width: 0, height: 0, issues: [], pages: [] }, ['Total'], 1)).toEqual({ rings: [], handle: null });
  });
  it('the width handle only for a single selection, at the right edge of the first occurrence', () => {
    expect(overlayFor(rep(), ['Total'], 1).handle).toEqual({ name: 'Total', left: 1700, top: 400, height: 200 });
    expect(overlayFor(rep(), ['Total', 'Titre'], 1).handle).toBeNull();
  });
  it('names compared as the designer does: « total » selected rings the items named Total', () => {
    expect(overlayFor(rep(), ['total'], 1).rings).toHaveLength(3);
    expect(overlayFor(rep(), ['total'], 1).handle).toMatchObject({ name: 'total', left: 1700 });
  });
  it('scale applies to rings and handle', () => {
    const o = overlayFor(rep(), ['Total'], 1 / 10);
    expect(o.rings[0]).toEqual({ name: 'Total', left: 70, top: 40, width: 100, height: 20 });
    expect(o.handle).toEqual({ name: 'Total', left: 170, top: 40, height: 20 });
  });
});

describe('stepDrag (width handle)', () => {
  type S = Parameters<typeof stepDrag>[1];
  /** Rejoue les étapes ; rend les validations (une par relâchement utile) et le dernier état. */
  const play = (...steps: S[]) => steps.reduce<{ drag: WidthDrag | null; commits: { name: string; width: number }[] }>((acc, s) => {
    const r = stepDrag(acc.drag, s, 1 / 10);
    return { drag: r.drag, commits: r.commit ? [...acc.commits, r.commit] : acc.commits };
  }, { drag: null, commits: [] });
  const down: S = { kind: 'down', name: 'Total', x: 50, base: 1000 };
  const move = (x: number, buttons = 1): S => ({ kind: 'move', x, buttons });
  it('down, move, up: exactly one commit with the target width; the width stays shown (done) until the next layout', () => {
    const r = play(down, move(60), move(70), { kind: 'up' }, { kind: 'cancel' } /* lost capture after the release */);
    expect(r.commits).toEqual([{ name: 'Total', width: 1200 }]);
    expect(r.drag).toMatchObject({ w: 1200, done: true });
  });
  it('lost capture, Escape (cancel) or a move with no button pressed: no commit, the drag ends', () => {
    for (const end of [{ kind: 'cancel' } as S, move(80, 0)]) {
      const r = play(down, move(70), end, { kind: 'up' });
      expect(r.commits).toEqual([]); expect(r.drag).toBeNull();
    }
  });
  it('no move, or back to the start: no commit; never narrower than MIN_WIDTH', () => {
    expect(play(down, move(70), move(50), { kind: 'up' }).commits).toEqual([]);
    expect(play(down, move(-500), { kind: 'up' }).commits).toEqual([{ name: 'Total', width: MIN_WIDTH }]);
  });
});

// mêmes formes que les dispositions de shared/design/layout-edit.test.ts, dans des sections d'état
const ctl = (name: string, layoutId?: string): ControlDef =>
  ({ kind: 'textBox', name, left: 0, top: 0, width: 10, height: 10, props: layoutId ? { LayoutID: layoutId } : {} });
const sec = (kind: SectionDef['kind'], id: string | undefined, ...names: string[]): SectionDef =>
  ({ kind, height: 5000, props: {}, controls: names.map((n) => ctl(n, id)) });
const tabular = (): Layout => ({ id: 'T', kind: 'tabular', left: 0, tops: { pageHeader: 50, detail: 70 }, cols: [800, 900],
  rows: [{ section: 'pageHeader', height: 200 }, { section: 'detail', height: 250 }],
  cells: [{ row: 0, col: 0, control: 'H0' }, { row: 0, col: 1, control: 'H1' }, { row: 1, col: 0, control: 'D0' }, { row: 1, col: 1, control: 'D1' }] });
const tabDoc = (): DesignDoc => reflow({ formatVersion: '1.0', recordSource: null, props: { Width: 20000, Layouts: [tabular()] },
  sections: [sec('pageHeader', 'T', 'H0', 'H1'), { ...sec('detail', 'T', 'D0', 'D1'), controls: [...sec('detail', 'T', 'D0', 'D1').controls, { ...ctl('Libre'), left: 5000, width: 700 }] }] });
const at = (d: DesignDoc, n: string) => d.sections.flatMap((s) => s.controls).find((c) => c.name === n)!;

describe('resizeTo', () => {
  it('a Tabular member: its column widens, the header cell follows, the next column shifts', () => {
    const d = resizeTo(tabDoc(), 'D0', 1200);
    expect([at(d, 'D0').width, at(d, 'H0').width]).toEqual([1200, 1200]);
    expect(readLayouts(d)[0]!.cols).toEqual([1200, 900]);
    expect([at(d, 'D1').left, at(d, 'H1').left]).toEqual([1200 + COL_GAP, 1200 + COL_GAP]);
  });
  it('a free control: its width only', () => {
    const d0 = tabDoc(), d = resizeTo(d0, 'Libre', 1500);
    expect(at(d, 'Libre')).toEqual({ ...at(d0, 'Libre'), width: 1500 });
    expect(at(d, 'D1')).toBe(at(d0, 'D1'));
  });
  it('never narrower than MIN_WIDTH; an unknown control or the same width: the same doc', () => {
    expect(MIN_WIDTH).toBe(100);
    expect(at(resizeTo(tabDoc(), 'Libre', 20), 'Libre').width).toBe(100);
    const d0 = tabDoc();
    expect(resizeTo(d0, 'Inconnu', 900)).toBe(d0);
    expect(resizeTo(d0, 'Libre', 700)).toBe(d0);
  });
});

describe('deleteTargets', () => {
  it('the selected controls; nothing for the report or a section', () => {
    expect(deleteTargets({ kind: 'controls', names: ['Total', 'Titre'] })).toEqual(['Total', 'Titre']);
    expect(deleteTargets({ kind: 'controls', names: [] })).toEqual([]);
    expect(deleteTargets({ kind: 'doc' })).toEqual([]);
    expect(deleteTargets({ kind: 'section', index: 1 })).toEqual([]);
  });
});

describe('placement (click-to-place and drag-to-draw)', () => {
  const doc = { sections: [{ kind: 'reportHeader' }, { kind: 'detail' }] } as unknown as DesignDoc;
  const tool = { kind: 'textBox', locked: false } as const;
  const none = { kind: null, locked: false } as const;
  const P = (x: number, y: number) => ({ x, y });
  const click = (x: number, y: number, snap: number | null) => placement(rep(), doc, tool, P(x, y), P(x, y), snap, 1);
  it('a click in the 3rd Detail band: Detail section, band-relative rect at the default size', () => {
    expect(click(1010, 1130, null)).toEqual({ section: 1, rect: { left: 510, top: 130, ...DEFAULT_SIZE } });
  });
  it('snapped to the grid, unsnapped without a step (Alt)', () => {
    expect(click(1010, 1130, 100)?.rect).toMatchObject({ left: 500, top: 100 });
    expect(click(1010, 1130, 0)?.rect).toMatchObject({ left: 510, top: 130 });
  });
  it('null in a gap, with no tool, or for a section absent from the document', () => {
    expect(click(1010, 350, null)).toBeNull();
    expect(placement(rep(), doc, none, P(1010, 1130), P(1010, 1130), null, 1)).toBeNull();
    expect(placement(rep(), { sections: [{ kind: 'reportHeader' }] } as unknown as DesignDoc, tool, P(1010, 1130), P(1010, 1130), null, 1)).toBeNull();
  });
  it('left/top clamped at 0 when snapping rounds below the band', () => {
    expect(click(510, 1001, 1000)?.rect).toMatchObject({ left: 0, top: 0 });
  });
  it('drag right-down: the rect from start to end in the start band', () => {
    expect(placement(rep(), doc, tool, P(1010, 1130), P(2010, 1230), null, 1)).toEqual({ section: 1, rect: { left: 510, top: 130, width: 1000, height: 100 } });
  });
  it('drag left-up: the same rect (corners swapped)', () => {
    expect(placement(rep(), doc, tool, P(2010, 1230), P(1010, 1130), null, 1)).toEqual({ section: 1, rect: { left: 510, top: 130, width: 1000, height: 100 } });
  });
  it('end in the next gap or below the last band: still the start band, reaching past its bottom', () => {
    expect(placement(rep(), doc, tool, P(1010, 1130), P(1510, 1600), null, 1)?.rect).toEqual({ left: 510, top: 130, width: 500, height: 470 });
    expect(placement(rep(), doc, tool, P(1010, 430), P(1510, 1130), null, 1)).toMatchObject({ section: 1, rect: { left: 510, top: 30, width: 500, height: 700 } });
  });
  it('a move under the click threshold is a click; the threshold is in px (scale)', () => {
    expect(placement(rep(), doc, tool, P(1010, 1130), P(1012, 1129), null, 1)?.rect).toMatchObject(DEFAULT_SIZE);
    expect(placement(rep(), doc, tool, P(1010, 1130), P(1015, 1129), null, 1 / 10)?.rect).toMatchObject(DEFAULT_SIZE);
    expect(placement(rep(), doc, tool, P(1010, 1130), P(1015, 1129), null, 1)?.rect).toEqual({ left: 510, top: 129, width: 5, height: 1 });
  });
  it('both corners snapped; a zero-size snapped drag is one grid step', () => {
    expect(placement(rep(), doc, tool, P(1010, 1130), P(2090, 1290), 100, 1)?.rect).toEqual({ left: 500, top: 100, width: 1100, height: 200 });
    expect(placement(rep(), doc, tool, P(1010, 1130), P(1040, 1140), 100, 1)?.rect).toEqual({ left: 500, top: 100, width: 100, height: 100 });
  });
  it('start in a gap: null', () => {
    expect(placement(rep(), doc, tool, P(1010, 350), P(1500, 1130), null, 1)).toBeNull();
  });
});

describe('containerAt (a control drawn inside an option group or a tab control goes into it)', () => {
  const c = (kind: ControlDef['kind'], name: string, children?: ControlDef[]): ControlDef => ({ kind, name, left: 0, top: 0, width: 1000, height: 200, props: {}, ...(children ? { children } : {}) });
  const doc = { formatVersion: '1.0', recordSource: null, props: {}, sections: [
    { kind: 'reportHeader', height: 300, props: {}, controls: [c('label', 'Titre')] },
    { kind: 'detail', height: 300, props: {}, controls: [c('optionGroup', 'Total', [c('optionButton', 'Opt')]), c('tabControl', 'Onglets')] },
  ] } as DesignDoc;
  const flow = (): LaidOutReport => ({ width: 11906, height: 2000, issues: [], pages: [{ number: 1, bands: [
    band(0, [T('Titre', 100, 50)], 'reportHeader'), band(400, [T('Total', 200, 0), T('Opt', 300, 0, 100, 100), T('Onglets', 5000, 0)]),
  ] }] });
  it('the container under the start point, in any record', () => {
    expect(containerAt(flow(), doc, 1300, 450)).toBe('Total');
    expect(containerAt(flow(), doc, 5600, 450)).toBe('Onglets');
  });
  it('none over another control (an option button inside the group included), in a gap or outside any item', () => {
    expect(containerAt(flow(), doc, 650, 100)).toBeUndefined();
    expect(containerAt(flow(), doc, 850, 450)).toBeUndefined();
    expect(containerAt(flow(), doc, 9000, 450)).toBeUndefined();
    expect(containerAt(flow(), doc, 1300, 350)).toBeUndefined();
  });
});

describe('empty cells in the flow (L5)', () => {
  const cell = { layout: 'L1', row: 0, col: 1 };
  const name = 'cell!L1!0!1';
  it('overlayFor rings an item named as a selected cell', () => {
    const r: LaidOutReport = { ...rep(), pages: [{ number: 1, bands: [band(0, [T(name, 100, 20)])] }] };
    expect(overlayFor(r, [name], 1).rings).toEqual([{ name, left: 600, top: 20, width: 1000, height: 200 }]);
  });
  it('a lone selected cell rings but gets no width handle; a lone control keeps its handle', () => {
    const r: LaidOutReport = { ...rep(), pages: [{ number: 1, bands: [band(0, [T(name, 100, 20), T('Titre', 100, 50)])] }] };
    expect(overlayFor(r, [name], 1)).toEqual({ rings: [{ name, left: 600, top: 20, width: 1000, height: 200 }], handle: null });
    expect(overlayFor(r, ['Titre'], 1).handle).toEqual({ name: 'Titre', left: 1600, top: 50, height: 200 });
  });
  it('deleteTargets holds the selected cells', () => {
    expect(deleteTargets({ kind: 'controls', names: [], cells: [cell] })).toEqual([name]);
    expect(deleteTargets({ kind: 'controls', names: ['A'] })).toEqual(['A']);
  });
  it('selectionAt maps a click', () => {
    expect(selectionAt(name, true)).toEqual({ type: 'selectCell', cell, add: true });
    expect(selectionAt(name, false)).toEqual({ type: 'selectCell', cell, add: false });
    expect(selectionAt('A', false)).toEqual({ type: 'select', selection: { kind: 'controls', names: ['A'] } });
    expect(selectionAt('A', true)).toEqual({ type: 'toggleSelect', name: 'A' });
    expect(selectionAt(null, false)).toEqual({ type: 'select', selection: { kind: 'doc' } });
    expect(selectionAt(null, true)).toBeNull();
  });
});
