import { describe, expect, it } from 'vitest';
import { totalFnsFor, totalOf, totalsLayout } from './totals';

describe('datasheet totals', () => {
  it('totalFnsFor: every function for a number, Count Max Min for a date, Count otherwise', () => {
    expect(totalFnsFor('currency', false)).toEqual(['sum', 'avg', 'count', 'max', 'min', 'stdev', 'var']);
    expect(totalFnsFor('number', true)).toEqual(['count']);
    expect(totalFnsFor('dateTime', false)).toEqual(['count', 'max', 'min']);
    expect(totalFnsFor('shortText', false)).toEqual(['count']);
  });
  it('totalOf: nulls are left out; a sample variance', () => {
    const v = [2, null, 4, 4, undefined, 6];
    expect(totalOf('count', v)).toBe(4);
    expect(totalOf('sum', v)).toBe(16);
    expect(totalOf('avg', v)).toBe(4);
    expect(totalOf('max', v)).toBe(6);
    expect(totalOf('min', v)).toBe(2);
    expect(totalOf('var', v)).toBeCloseTo(8 / 3);
    expect(totalOf('stdev', v)).toBeCloseTo(Math.sqrt(8 / 3));
    expect(totalOf('max', ['2026-01-02', '2026-11-01'])).toBe('2026-11-01');
  });
  it('totalOf: nothing to total', () => {
    expect(totalOf('count', [null])).toBe(0);
    expect(totalOf('sum', [null])).toBeNull();
    expect(totalOf('stdev', [5])).toBeNull();
  });
  it('totalsLayout: frozen columns stay, the others follow the grid scroll', () => {
    expect(totalsLayout([100, 50, 80], 0, 0, 0, 44)).toEqual([{ left: 44, width: 100 }, { left: 144, width: 50 }, { left: 194, width: 80 }]);
    expect(totalsLayout([100, 50, 80], 0, 1, -20, 44)).toEqual([null, { left: 24, width: 50 }, { left: 74, width: 80 }]);
    expect(totalsLayout([100, 50, 80], 1, 2, -10, 44)).toEqual([{ left: 44, width: 100 }, null, { left: 134, width: 80 }]);
  });
});
