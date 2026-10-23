// Exact accumulators (contract 1.6, rulings C3 and C4) and the type of an aggregate's argument (C5).
import { describe, expect, it } from 'vitest';
import { aggregateArgType, createAccumulator, type AggregateName } from './aggregate';
import type { Value } from './ast';
import { parseCanonical } from './parser';
import { defaultProps, type FieldProps, type FieldType } from '../field-types';
import { localeInfo, type LocaleInfo } from '../locale-format';

const n = (v: number): Value => ({ t: 'num', v });
const s = (v: string): Value => ({ t: 'str', v });
const run = (fn: AggregateName, values: Value[], type: FieldType | null = null, props?: FieldProps, _?: undefined, info?: LocaleInfo): Value => {
  const acc = createAccumulator(fn, type, props, info);
  for (const v of values) acc.add(v);
  return acc.result();
};
const dec = (scale: number): FieldProps => ({ ...defaultProps('number'), numberSize: 'decimal', precision: 28, scale });
const long: FieldProps = { ...defaultProps('number'), numberSize: 'longInteger' };
const dbl: FieldProps = { ...defaultProps('number'), numberSize: 'double' };

describe('createAccumulator', () => {
  it('Currency sums exactly: 0.1 + 0.2 = 0.3, ten times 0.1 = 1', () => {
    expect(run('Sum', [n(0.1), n(0.2)], 'currency')).toEqual(n(0.3));
    expect(run('Sum', Array<Value>(10).fill(n(0.1)), 'currency')).toEqual(n(1));
    expect(run('Sum', [n(0.1), n(0.2)], 'number', dbl)).not.toEqual(n(0.3)); // a Double sums as the hardware does
    expect(run('Sum', [n(1234567.8912), n(-0.0012)], 'currency')).toEqual(n(1234567.89));
    expect(run('Avg', [n(0.1), n(0.2), n(0.3)], 'currency')).toEqual(n(0.2));
  });

  it('Decimal sums at its scale, exactly, also from the stored text', () => {
    expect(run('Sum', [s('0.10'), s('0.20'), s('12345678901234.55')], 'number', dec(2))).toEqual(n(12345678901234.85));
    expect(run('Sum', [s('1.005'), s('1.015')], 'number', dec(2))).toEqual(n(2.02)); // a value beyond the scale: banker's rounding, 1.00 + 1.02
    expect(run('Sum', [n(0.1), n(0.7)], 'number', dec(3))).toEqual(n(0.8));
  });

  it('integers sum as BigInt; the result is a number', () => {
    const big = 2 ** 53 - 1;
    expect(run('Sum', [n(big), n(1), n(-1)], 'number', long)).toEqual(n(big));
    expect(run('Sum', [n(1), n(2), n(3)], 'autoNumber')).toEqual(n(6));
    expect(run('Sum', [{ t: 'bool', v: true }, { t: 'bool', v: true }, { t: 'bool', v: false }], 'yesNo')).toEqual(n(-2)); // Yes = -1
  });

  it('only Null is ignored; an empty or all-Null group gives Null, Count 0', () => {
    const nulls: Value[] = [null, null];
    for (const fn of ['Sum', 'Avg', 'Min', 'Max', 'First', 'Last', 'StDev', 'StDevP', 'Var', 'VarP'] as const) {
      expect(run(fn, [], 'currency'), fn).toBeNull();
      expect(run(fn, nulls, 'currency'), fn).toBeNull();
    }
    expect(run('Count', [])).toEqual(n(0));
    expect(run('Count', nulls)).toEqual(n(0));
    expect(run('Count', [n(1), null, s('x')])).toEqual(n(2));
    expect(run('Avg', [n(2), null, n(4)], 'number', long)).toEqual(n(3));
  });

  it('Empty (Nz without a replacement) is a value: 0 in arithmetic and Count, 0 or "" in Min/Max (A2-R7, C7)', () => {
    const E: Value = { t: 'empty' };
    expect(run('Count', [n(10), E])).toEqual(n(2)); // Count(Nz([x])) over [10, Null]
    expect(run('Avg', [n(10), E, n(20)], 'number', long)).toEqual(n(10)); // Avg(Nz([x])) over [10, Null, 20]
    expect(run('Sum', [E, E], 'currency')).toEqual(n(0));
    expect(run('Min', [n(3), E], 'number', long)).toEqual(E);
    expect(run('Max', [s('a'), E], 'shortText')).toEqual(s('a'));
    expect(run('VarP', [n(2), E], 'number', dbl)).toEqual(n(1));
  });

  it('overflow is an error, never NaN or Infinity; Currency beyond the Access range too', () => {
    expect(() => run('Sum', [n(1.7e308), n(1.7e308)], 'number', dbl)).toThrow(expect.objectContaining({ name: 'ExprRuntimeError', code: 'overflow' }));
    expect(() => run('Var', [n(1e308), n(-1e308)], 'number', dbl)).toThrow(expect.objectContaining({ code: 'overflow' }));
    expect(() => run('Sum', [n(922337203685477), n(922337203685477)], 'currency')).toThrow(expect.objectContaining({ code: 'overflow' }));
  });

  it('text values are read in the given region (en-US by default)', () => {
    expect(run('Sum', [s('1,5'), s('2')], 'number', dbl, undefined, localeInfo('fr-FR'))).toEqual(n(3.5));
    expect(run('Sum', [s('1,500'), s('2')], 'number', dbl)).toEqual(n(1502));
  });

  it("Avg of Currency is Currency (rounded to 4 decimals, banker's); Sum of dates is a number of days", () => {
    expect(run('Avg', [n(0.0001), n(0.0002)], 'currency')).toEqual(n(0.0002)); // 0.00015 -> 0.0002
    expect(run('Avg', [n(0.0001), n(0.0004)], 'currency')).toEqual(n(0.0002)); // 0.00025 -> 0.0002
    expect(run('Sum', [{ t: 'date', v: 1.5 }, { t: 'date', v: 2 }], 'dateTime')).toEqual(n(3.5));
  });

  it('Min and Max compare as Access (text case-insensitive, dates by serial); First and Last skip Null', () => {
    expect(run('Min', [s('b'), s('A'), s('c')], 'shortText')).toEqual(s('A'));
    expect(run('Max', [s('b'), s('A'), s('C')], 'shortText')).toEqual(s('C'));
    expect(run('Min', [n(3), null, n(-2)], 'number', long)).toEqual(n(-2));
    expect(run('Max', [{ t: 'date', v: 46000 }, { t: 'date', v: 46316 }], 'dateTime')).toEqual({ t: 'date', v: 46316 });
    expect(run('First', [null, s('x'), s('y')])).toEqual(s('x'));
    expect(run('Last', [s('x'), s('y'), null])).toEqual(s('y'));
  });

  it('StDev, StDevP, Var, VarP (Welford): sample and population; stable with a large offset', () => {
    const xs = [2, 4, 4, 4, 5, 5, 7, 9].map(n);
    expect(run('VarP', xs)).toEqual(n(4));
    expect(run('StDevP', xs)).toEqual(n(2));
    expect((run('Var', xs) as { v: number }).v).toBeCloseTo(32 / 7, 12);
    expect((run('StDev', xs) as { v: number }).v).toBeCloseTo(Math.sqrt(32 / 7), 12);
    expect(run('Var', [n(5)])).toBeNull(); // a sample of one has no variance
    expect(run('VarP', [n(5)])).toEqual(n(0));
    const shifted = [1e9 + 4, 1e9 + 7, 1e9 + 13, 1e9 + 16].map(n);
    expect((run('Var', shifted) as { v: number }).v).toBeCloseTo(30, 6);
  });

  it('a text value that is not a number fails a sum (typeMismatch)', () => {
    expect(() => run('Sum', [s('abc')], 'number', dbl)).toThrow(expect.objectContaining({ code: 'typeMismatch' }));
    expect(run('Sum', [s('2.5'), n(1)], 'number', dbl)).toEqual(n(3.5));
  });
});

describe('aggregateArgType', () => {
  const fields: Record<string, { type: FieldType; props: FieldProps }> = {
    Qte: { type: 'number', props: long },
    Prix: { type: 'currency', props: defaultProps('currency') },
    Taux: { type: 'number', props: dbl },
    D2: { type: 'number', props: dec(2) },
    D4: { type: 'number', props: dec(4) },
    Nom: { type: 'shortText', props: defaultProps('shortText') },
  };
  const ty = (src: string) => aggregateArgType(parseCanonical(src), (name) => fields[name]);

  it('field references keep their type', () => {
    expect(ty('[Nom]')).toEqual({ type: 'shortText', props: fields.Nom!.props });
    expect(ty('[Prix]')).toEqual({ type: 'currency', props: fields.Prix!.props });
    expect(ty('[Inconnu]')).toEqual({ type: null });
  });

  it('Currency with integers stays Currency; Decimal at the larger scale; Double, text or / are floating point', () => {
    expect(ty('[Qte] * [Prix]').type).toBe('currency');
    expect(ty('[Prix] - 2 * [Prix]').type).toBe('currency');
    expect(ty('Nz([Prix], 0)').type).toBe('currency');
    expect(ty('IIf([Qte] > 1, [Prix], 0)').type).toBe('currency');
    expect(ty('[Qte] + 1')).toMatchObject({ type: 'number', props: { numberSize: 'longInteger' } });
    expect(ty('[D2] * [Qte] + [D4]')).toMatchObject({ type: 'number', props: { numberSize: 'decimal', scale: 4 } });
    expect(ty('[D2] + [Prix]')).toMatchObject({ type: 'number', props: { numberSize: 'decimal', scale: 4 } });
    // a product keeps every digit: the scales add up (Currency counts as 4), at most 28 (C7)
    expect(ty('[D2] * [D2]')).toMatchObject({ type: 'number', props: { numberSize: 'decimal', scale: 4 } });
    expect(ty('[D4] * [Prix]')).toMatchObject({ type: 'number', props: { numberSize: 'decimal', scale: 8 } });
    expect(ty('[D2] * [Prix] * 3')).toMatchObject({ props: { scale: 6 } });
    expect(ty('[D4] * [D4] * [D4] * [D4] * [D4] * [D4] * [D4] * [D4]')).toMatchObject({ props: { scale: 28 } });
    // a Null branch takes the other branch's type; Int, Fix and Round keep Currency
    expect(ty('IIf([Qte] > 1, [Prix], Null)').type).toBe('currency');
    expect(ty('IIf([Qte] > 1, Null, [D2])')).toMatchObject({ props: { numberSize: 'decimal', scale: 2 } });
    expect(ty('Nz(Null, [Prix])').type).toBe('currency');
    for (const src of ['Int([Prix])', 'Fix([Prix])', 'Round([Prix], 2)']) expect(ty(src).type, src).toBe('currency');
    expect(ty('Round([Taux], 2)').type).toBeNull();
    for (const src of ['[Prix] * [Taux]', '[Prix] * 1.1', '[Prix] / 2', '[Nom] & "x"', 'Len([Nom])', '[Qte] ^ 2']) expect(ty(src).type, src).toBeNull();
  });

  it('a Totals query and a report agree: Sum([Qte]*[Prix]) is exact', () => {
    const { type, props } = ty('[Qte] * [Prix]');
    expect(run('Sum', [n(3 * 0.1), n(0.2)], type, props)).toEqual(n(0.5));
  });

  it('Sum([D2]*[D2]) over 0.15 twice is 0.045 (no early rounding)', () => {
    const { type, props } = ty('[D2] * [D2]');
    expect(run('Sum', [n(0.15 * 0.15), n(0.15 * 0.15)], type, props)).toEqual(n(0.045));
  });
});

describe('C9: accumulator input', () => {
  const de = localeInfo('de-DE');
  it('a text Value is read canonical first, then in the region', () => {
    expect(run('Sum', [s('12.34'), s('1.5')], 'number', dbl, undefined, de)).toEqual(n(13.84)); // never 1234 + 15
    expect(run('Sum', [s('12.34')], 'currency', undefined, undefined, de)).toEqual(n(12.34));
    expect(run('Sum', [s('1,5')], 'number', dbl, undefined, de)).toEqual(n(1.5)); // not canonical: the region
    expect(run('Var', [s('1.5'), s('2.5')], 'number', dbl, undefined, de)).toEqual(n(0.5));
  });

  it('Min/Max of a numeric type compare numeric text as numbers', () => {
    expect(run('Max', [s('9'), s('10')], 'number', long)).toEqual(n(10));
    expect(run('Min', [s('9'), n(10)], 'currency')).toEqual(n(9));
    expect(run('Max', [s('9'), s('10')], 'shortText')).toEqual(s('9')); // text compares as text
  });

  it('a non-integer on the integer exact path switches to exact decimals, never rounded', () => {
    expect(run('Sum', [n(2.5), n(2.5)], 'number', long)).toEqual(n(5));
    expect(run('Avg', [n(1), n(2.5)], 'number', long)).toEqual(n(1.75));
    expect(run('Sum', [n(1), n(0.1), n(0.2), n(2 ** 53)], 'number', long)).toEqual(n(2 ** 53 + 1.3));
    expect(run('Sum', [n(0.5), n(0.5)], 'autoNumber')).toEqual(n(1));
  });

  it('Currency totals compare on the stored double grid: the largest storable value sums without overflow', () => {
    const max = Number('922337203685477.5807'); // stored as the nearest double, 922337203685477.625
    expect(run('Sum', [n(max)], 'currency')).toEqual(n(max));
    expect(run('Avg', [n(max)], 'currency')).toEqual(n(max));
    expect(() => run('Sum', [n(max), n(1)], 'currency')).toThrow(expect.objectContaining({ code: 'overflow' }));
    expect(run('Sum', [n(-max)], 'currency')).toEqual(n(-max));
  });
});
