import { describe, expect, it } from 'vitest';
import { cmToTwips as cm, type ControlDef, type DesignDoc } from '../../shared/design/model';
import { createLayout, membersOf } from '../../shared/design/layout-edit';
import { layoutOutlines } from './layout-outline';

// Comme la capture S3 : des contrôles mal alignés, chacun avec son étiquette attachée.
const lbl = (name: string, left: number, top: number, width: number): ControlDef =>
  ({ kind: 'label', name, left, top, width, height: 300, props: { Caption: `${name}:` } });
const box = (name: string, left: number, top: number, width: number, height: number): ControlDef =>
  ({ kind: 'textBox', name, left, top, width, height, props: {}, children: [lbl(`L${name}`, left - 700, top, 600)] });
const s3 = (): DesignDoc => ({ formatVersion: '1.0', recordSource: null, props: {}, sections: [
  { kind: 'formHeader', height: 100, props: {}, controls: [] },
  { kind: 'detail', height: 500, props: {}, controls: [
    box('Nom', cm(1.753), cm(0.635), cm(4), cm(0.8)),
    box('Ville', cm(1.9), cm(1.5), cm(3), cm(0.58)),
    box('Inscrit', cm(1.65), cm(1.8), cm(5), cm(0.58)),
  ] },
] });
const NAMES = ['Nom', 'Ville', 'Inscrit'];
const make = (kind: 'stacked' | 'tabular') => { const d = s3(); return createLayout(d, membersOf(d, NAMES), kind, { headerSection: 'formHeader' }); };
const bbox = (cs: ControlDef[]) => {
  const left = Math.min(...cs.map((c) => c.left)), top = Math.min(...cs.map((c) => c.top));
  return { left, top, width: Math.max(...cs.map((c) => c.left + c.width)) - left, height: Math.max(...cs.map((c) => c.top + c.height)) - top };
};

describe('layoutOutlines', () => {
  it('Empilé : un rectangle, la boîte englobante des contrôles de ses cellules', () => {
    const d = make('stacked');
    expect(layoutOutlines(d, 1)).toEqual([{ id: 'L1', rect: bbox(d.sections[1].controls) }]);   // contrôles et étiquettes détachées
    expect(layoutOutlines(d, 0)).toEqual([]);
  });
  it('Tabulaire : un rectangle dans l’en-tête (les étiquettes), un dans le détail', () => {
    const d = make('tabular');
    expect(layoutOutlines(d, 0)).toEqual([{ id: 'L1', rect: bbox(d.sections[0].controls) }]);
    expect(layoutOutlines(d, 1)).toEqual([{ id: 'L1', rect: bbox(d.sections[1].controls) }]);
  });
  it('sans disposition : rien', () => {
    expect(layoutOutlines(s3(), 1)).toEqual([]);
    expect(layoutOutlines(s3(), 9)).toEqual([]);
  });
});
