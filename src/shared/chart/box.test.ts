import { describe, expect, it } from 'vitest';
import { boxStats } from './box';

describe('boxStats (médiane exclue, moustaches à 1,5 écart interquartile)', () => {
  it('[1..5]', () => expect(boxStats([1, 2, 3, 4, 5])).toEqual({ min: 1, q1: 1.5, median: 3, q3: 4.5, max: 5, whiskerLow: 1, whiskerHigh: 5, outliers: [] }));
  it('[1..4]', () => expect(boxStats([1, 2, 3, 4])).toMatchObject({ q1: 1.5, median: 2.5, q3: 3.5 }));
  it('une observation : cinq nombres égaux', () => expect(boxStats([7])).toEqual({ min: 7, q1: 7, median: 7, q3: 7, max: 7, whiskerLow: 7, whiskerHigh: 7, outliers: [] }));
  it('deux observations', () => expect(boxStats([2, 9])).toMatchObject({ q1: 2, median: 5.5, q3: 9 }));
  it('valeur aberrante : 100 au-delà de la barrière haute (15,5)', () => {
    expect(boxStats([1, 2, 3, 4, 5, 6, 7, 8, 9, 100])).toEqual({ min: 1, q1: 3, median: 5.5, q3: 8, max: 100, whiskerLow: 1, whiskerHigh: 9, outliers: [100] });
  });
  it('aberrantes basses et hautes, en ordre croissant', () => {
    expect(boxStats([-100, -90, 1, 2, 3, 4, 5, 6, 7, 8, 9, 100, 90])!.outliers).toEqual([-100, -90, 90, 100]);
  });
  it('désordre, NaN et Infinity écartés, entrée non modifiée', () => {
    const input = [5, NaN, 1, Infinity, 3, -Infinity, 2, 4];
    const copy = [...input];
    expect(boxStats(input)).toEqual(boxStats([1, 2, 3, 4, 5]));
    expect(input.map(String)).toEqual(copy.map(String));
  });
  it('aucune valeur finie : null', () => { expect(boxStats([])).toBeNull(); expect(boxStats([NaN, Infinity])).toBeNull(); });
  it('tous les résultats sont des nombres finis', () => {
    const b = boxStats([0.1, 0.2, 0.7, 1e9, -3])!;
    for (const v of [b.min, b.q1, b.median, b.q3, b.max, b.whiskerLow, b.whiskerHigh, ...b.outliers]) expect(Number.isFinite(v)).toBe(true);
  });
});
