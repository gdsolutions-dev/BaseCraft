import { describe, expect, it } from 'vitest';
import { sectionPointAt } from './flow';
import type { LaidOutBand, LaidOutReport } from './types';

const band = (section: LaidOutBand['section'], top: number, height: number, o: Partial<LaidOutBand> = {}): LaidOutBand =>
  ({ section, top, left: 567, width: 10000, height, back: null, items: [], ...o });
const SECTIONS = [
  { kind: 'reportHeader' }, { kind: 'pageHeader' }, { kind: 'groupHeader', groupLevel: 0 }, { kind: 'detail' }, { kind: 'pageFooter' }, { kind: 'reportFooter' },
];
const rep = (bands: LaidOutBand[]): LaidOutReport => ({ width: 11906, height: 5000, issues: [], pages: [{ number: 1, bands }] });
const flow = () => rep([
  band('reportHeader', 0, 500), band('pageHeader', 500, 300), band('groupHeader', 800, 200, { groupLevel: 0 }),
  band('detail', 1000, 300), band('detail', 1300, 300), band('detail', 1700, 300), // gap 1600..1700
  band('pageFooter', 2000, 0), band('reportFooter', 2000, 400),
]);

describe('sectionPointAt', () => {
  it('same section for the 1st and 3rd Detail band, y relative to its own band', () => {
    expect(sectionPointAt(flow(), SECTIONS, 600, 1050)).toEqual({ section: 3, x: 33, y: 50 });
    expect(sectionPointAt(flow(), SECTIONS, 600, 1750)).toEqual({ section: 3, x: 33, y: 50 });
  });
  it('resolves group header (groupLevel), page and report header/footer', () => {
    const r = flow();
    expect(sectionPointAt(r, SECTIONS, 600, 900)?.section).toBe(2);
    expect(sectionPointAt(r, SECTIONS, 600, 100)?.section).toBe(0);
    expect(sectionPointAt(r, SECTIONS, 600, 600)?.section).toBe(1);
    expect(sectionPointAt(r, SECTIONS, 600, 2100)?.section).toBe(5);
    const withFooter = rep([band('pageFooter', 0, 300)]);
    expect(sectionPointAt(withFooter, SECTIONS, 600, 10)?.section).toBe(4);
  });
  it('null in gaps, outside bands, zero-height band, unknown section, empty report', () => {
    const r = flow();
    expect(sectionPointAt(r, SECTIONS, 600, 1650)).toBeNull();
    expect(sectionPointAt(r, SECTIONS, 500, 1050)).toBeNull();
    expect(sectionPointAt(r, SECTIONS, 600, 2500)).toBeNull();
    expect(sectionPointAt(rep([band('pageFooter', 2000, 0)]), SECTIONS, 600, 2000)).toBeNull();
    expect(sectionPointAt(rep([band('groupFooter', 0, 300, { groupLevel: 0 })]), SECTIONS, 600, 10)).toBeNull();
    expect(sectionPointAt({ ...flow(), pages: [] }, SECTIONS, 600, 10)).toBeNull();
  });
});
