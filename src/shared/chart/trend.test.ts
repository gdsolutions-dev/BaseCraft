import { describe, expect, it } from 'vitest';
import { trendlineData } from './trend';

const round = (a: number[]) => a.map((v) => Math.round(v * 1000) / 1000);

describe('trendlineData', () => {
  it('linéaire : droite des moindres carrés', () => {
    expect(round(trendlineData('linear', [1, 2, 3, 4]))).toEqual([1, 2, 3, 4]);
  });
  it('linéaire : un trou est ignoré, la droite le traverse', () => {
    expect(round(trendlineData('linear', [1, null, 3, 4]))).toEqual([1, 2, 3, 4]);
  });
  it('moyenne mobile : le premier point se répète', () => {
    expect(trendlineData('movingAverage', [2, 4, 6], 2)).toEqual([2, 3, 5]);
  });
  it('exponentielle', () => {
    expect(round(trendlineData('exponential', [1, 2, 4, 8]))).toEqual([1, 2, 4, 8]);
  });
  it('puissance et logarithmique sur des valeurs positives', () => {
    expect(round(trendlineData('power', [1, 4, 9, 16]))).toEqual([1, 4, 9, 16]);   // y = x²
    expect(round(trendlineData('logarithmic', [1, 2, 3, 4])).every(Number.isFinite)).toBe(true);
  });
  it('polynomiale (degré 2)', () => {
    expect(round(trendlineData('polynomial', [1, 4, 9, 16]))).toEqual([1, 4, 9, 16]);
  });
  it.each(['exponential', 'power', 'logarithmic'] as const)('%s : une valeur non positive donne une courbe vide, jamais NaN', (k) => {
    expect(trendlineData(k, [1, 0, 3])).toEqual([]);
    expect(trendlineData(k, [1, -2, 3])).toEqual([]);
  });
  it('pas assez de points, aucune, ou "none" : vide', () => {
    expect(trendlineData('linear', [5])).toEqual([]);
    expect(trendlineData('linear', [null, null])).toEqual([]);
    expect(trendlineData('none', [1, 2, 3])).toEqual([]);
    expect(trendlineData('polynomial', [1, 2])).toEqual([]);
  });
  it('points alignés verticalement impossibles : jamais NaN', () => {
    for (const k of ['linear', 'polynomial', 'movingAverage'] as const) expect(trendlineData(k, [3, 3, 3, 3]).every(Number.isFinite)).toBe(true);
  });
});
