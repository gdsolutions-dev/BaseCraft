import { describe, expect, it } from 'vitest';
import { anchoredDoc } from './anchor';
import { createLayout, membersOf } from './layout-edit';
import type { ControlDef, DesignDoc } from './model';

const box = (name: string, left: number, top: number, props: Record<string, unknown> = {}, children?: ControlDef[]): ControlDef =>
  ({ kind: 'textBox', name, left, top, width: 2000, height: 300, props, ...(children ? { children } : {}) });
const lbl = (name: string, left: number, top: number, props: Record<string, unknown> = {}): ControlDef =>
  ({ kind: 'label', name, left, top, width: 800, height: 300, props: { Caption: name, ...props } });
const base = (extra: Record<string, unknown> = {}, labelExtra: Record<string, unknown> = {}): DesignDoc => ({ formatVersion: '1.0', recordSource: null, props: {}, sections: [
  { kind: 'formHeader', height: 100, props: {}, controls: [] },
  { kind: 'detail', height: 3000, props: {}, controls: [
    box('Nom', 1000, 200, {}, [lbl('LNom', 100, 200, labelExtra)]), box('Ville', 1000, 700, extra, [lbl('LVille', 100, 700)]), box('CP', 1000, 1200, {}, [lbl('LCP', 100, 1200)])] },
  { kind: 'formFooter', height: 0, props: {}, controls: [] }] });
const laid = (extra: Record<string, unknown> = {}, labelExtra: Record<string, unknown> = {}) => {
  const d = base(extra, labelExtra);
  return createLayout(d, membersOf(d, ['Nom', 'Ville', 'CP']), 'stacked', { headerSection: 'formHeader' });
};
const get = (d: DesignDoc, n: string) => d.sections.flatMap((s) => s.controls).find((c) => c.name === n)!;
const both = { HorizontalAnchor: 'both', VerticalAnchor: 'both' };

describe('anchoredDoc', () => {
  it('a stretching column / row takes the spare, the rows below move, the label column stays', () => {
    const d = laid(both), a = anchoredDoc(d, { width: 1000, height: 600 }, { vertical: true });
    expect(get(a, 'Ville').width).toBe(get(d, 'Ville').width + 1000);
    expect(get(a, 'Ville').height).toBe(get(d, 'Ville').height + 600);
    expect(get(a, 'CP').top).toBe(get(d, 'CP').top + 600);
    expect(get(a, 'Nom').top).toBe(get(d, 'Nom').top);
    expect(get(a, 'LVille').width).toBe(get(d, 'LVille').width);
    expect(get(a, 'LVille').left).toBe(get(d, 'LVille').left);
    expect(a.sections.find((s) => s.kind === 'detail')!.height).toBe(3600);
    expect(d.sections.find((s) => s.kind === 'detail')!.height).toBe(3000);   // the source is untouched
  });
  it('two stretching columns share 1001 as 500 and 501', () => {
    const d = laid({ HorizontalAnchor: 'both' }, { HorizontalAnchor: 'both' });
    const a = anchoredDoc(d, { width: 1001, height: 0 }, { vertical: false });
    expect(get(a, 'LNom').width - get(d, 'LNom').width).toBe(500);
    expect(get(a, 'Ville').width - get(d, 'Ville').width).toBe(501);
  });
  it('a member anchored right moves the layout', () => {
    const d = laid({ HorizontalAnchor: 'right' });
    expect(get(anchoredDoc(d, { width: 700, height: 0 }, { vertical: true }), 'Nom').left).toBe(get(d, 'Nom').left + 700);
  });
  it('a free control anchored right / bottom moves, both grows', () => {
    const d = base(); d.sections[1].controls = [box('A', 100, 100, { HorizontalAnchor: 'right', VerticalAnchor: 'bottom' }), box('B', 100, 500, both)];
    const a = anchoredDoc(d, { width: 300, height: 200 }, { vertical: true });
    expect([get(a, 'A').left, get(a, 'A').top]).toEqual([400, 300]);
    expect([get(a, 'B').width, get(a, 'B').height]).toEqual([2300, 500]);
  });
  it('an unanchored doc with a layout and a positive spare is returned as is', () => {
    const d = laid();
    expect(anchoredDoc(d, { width: 1000, height: 600 }, { vertical: true })).toBe(d);
  });
  it('a negative spare returns the same doc', () => {
    const d = laid(both);
    expect(anchoredDoc(d, { width: -500, height: -500 }, { vertical: true })).toBe(d);
  });
  it('vertical: false ignores VerticalAnchor', () => {
    const d = laid({ VerticalAnchor: 'both' });
    expect(anchoredDoc(d, { width: 0, height: 600 }, { vertical: false })).toBe(d);
    expect(get(anchoredDoc(d, { width: 100, height: 600 }, { vertical: false }), 'Ville').height).toBe(get(d, 'Ville').height);
  });
  it('a tab control anchored both grows, its pages stay', () => {
    const d = base(); d.sections[1].controls = [{ ...box('T', 100, 100, both), kind: 'tabControl', children: [box('P1', 150, 150)] }];
    const a = anchoredDoc(d, { width: 400, height: 400 }, { vertical: true });
    expect(get(a, 'T').width).toBe(2400);
    expect(get(a, 'T').children![0]).toEqual(get(d, 'T').children![0]);
  });
  it('a moving tab control takes its pages along', () => {
    const d = base(); d.sections[1].controls = [{ ...box('T', 100, 100, { HorizontalAnchor: 'right' }), kind: 'tabControl', children: [box('P1', 150, 150)] }];
    expect(get(anchoredDoc(d, { width: 400, height: 0 }, { vertical: true }), 'T').children![0].left).toBe(550);
  });
});
