import { describe, expect, it } from 'vitest';
import { COL_GAP, readLayouts, reflow, type Layout } from '../../shared/design/layout';
import type { ControlDef, DesignDoc, SectionDef } from '../../shared/design/model';
import type { LaidOutBand, LaidOutItem, LaidOutReport } from '../../shared/report/types';
import { DEFAULT_SIZE } from '../designer/units';
import { MIN_WIDTH, deleteTargets, overlayFor, placement, resizeTo, stepDrag, type WidthDrag } from './layout-overlay';

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

describe('placement (click-to-place)', () => {
  const doc = { sections: [{ kind: 'reportHeader' }, { kind: 'detail' }] } as unknown as DesignDoc;
  const tool = { kind: 'textBox', locked: false } as const;
  const none = { kind: null, locked: false } as const;
  it('a click in the 3rd Detail band: Detail section, band-relative rect at the default size', () => {
    expect(placement(rep(), doc, tool, 1010, 1130, null)).toEqual({ section: 1, rect: { left: 510, top: 130, ...DEFAULT_SIZE } });
  });
  it('snapped to the grid, unsnapped without a step (Alt)', () => {
    expect(placement(rep(), doc, tool, 1010, 1130, 100)?.rect).toMatchObject({ left: 500, top: 100 });
    expect(placement(rep(), doc, tool, 1010, 1130, 0)?.rect).toMatchObject({ left: 510, top: 130 });
  });
  it('null in a gap, with no tool, or for a section absent from the document', () => {
    expect(placement(rep(), doc, tool, 1010, 350, null)).toBeNull();
    expect(placement(rep(), doc, none, 1010, 1130, null)).toBeNull();
    expect(placement(rep(), { sections: [{ kind: 'reportHeader' }] } as unknown as DesignDoc, tool, 1010, 1130, null)).toBeNull();
  });
  it('left/top clamped at 0 when snapping rounds below the band', () => {
    expect(placement(rep(), doc, tool, 510, 1001, 1000)?.rect).toMatchObject({ left: 0, top: 0 });
  });
});
