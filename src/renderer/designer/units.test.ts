import { describe, expect, it } from 'vitest';
import { localeInfo } from '../../shared/locale-format';
import type { DesignDoc } from '../../shared/design/model';
import { formatCm, gridStep, MAX_TWIPS, parseCm, pxToTwips, snap, twipsToPx } from './units';

const fr = localeInfo('fr-FR');
const docWith = (props: Record<string, unknown>): DesignDoc => ({ formatVersion: '1.0', recordSource: null, props, sections: [] });

describe('designer units', () => {
  it('cm <-> twips', () => {
    expect(formatCm(868, fr)).toBe('1,53 cm');
    expect(parseCm('1,53', fr)).toBe(868);
    expect(parseCm('1,53 cm', fr)).toBe(868);
    expect(parseCm('-1', fr)).toBeNull();
    expect(parseCm('56', fr)).toBeNull();
    expect(parseCm('abc', fr)).toBeNull();
    expect(parseCm('', fr)).toBeNull();
    expect(parseCm('0', fr)).toBe(0);
    expect(Object.is(parseCm('-0,0001', fr), 0)).toBe(true); // never -0
    expect(MAX_TWIPS).toBe(31680);
    expect(parseCm('55,88', fr)).toBeNull(); // 31 684 twips
    expect(parseCm('55,87', fr)).toBe(31678);
  });
  it('en locale uses the point', () => {
    const en = localeInfo('en-US');
    expect(formatCm(868, en)).toBe('1.53 cm');
    expect(parseCm('1.53 cm', en)).toBe(868);
  });
  it('px', () => {
    expect(twipsToPx(567)).toBeCloseTo(37.8);
    expect(pxToTwips(10)).toBe(150);
  });
  it('grid', () => {
    expect(gridStep(docWith({ GridX: 4 }))).toBe(142);
    expect(gridStep(docWith({}))).toBe(142);
    expect(gridStep(docWith({ GridX: 16 }))).toBe(35);
    expect(gridStep(docWith({ GridX: 0 }))).toBe(567); // clamped to 1..16
    expect(gridStep(docWith({ GridX: 99 }))).toBe(35);
    expect(gridStep(docWith({ GridX: 'x' }))).toBe(142); // non numeric: the default
    expect(gridStep(docWith({ GridX: NaN }))).toBe(142);
    expect(Object.is(snap(-10, 142), 0)).toBe(true); // never -0
    expect(snap(200, 142)).toBe(142);
    expect(snap(220, 142)).toBe(284);
  });
});
