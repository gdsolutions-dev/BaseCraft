// Totaux d'un état : extraction des agrégats et calcul par les accumulateurs exacts du socle (contrat 1.6 et 1.7).
import { describe, expect, it } from 'vitest';
import { computeAggregate, extractAggregates, type AggInput } from './totals';
import { ExprSyntaxError } from '../expr/ast';
import { date, num, str } from '../expr/library';
import { fieldRefs, parseCanonical } from '../expr/parser';
import type { SqlValue } from '../coerce';
import { defaultProps, type FieldProps, type FieldType } from '../field-types';
import type { SourceField } from '../record-source';

const sf = (name: string, type: FieldType, props: Partial<FieldProps> = {}): SourceField => ({ name, type, props: { ...defaultProps(type), ...props } });
const fields = [sf('Client', 'shortText'), sf('Montant', 'currency'), sf('Qté', 'number', { numberSize: 'longInteger' }), sf('Prix', 'currency'), sf('Taux', 'number', { numberSize: 'double' })];
const env: AggInput['env'] = { now: () => new Date(0), locale: 'fr-FR' };

/** Parses `src`, extracts its single aggregate and computes it over every row of `rows`, in order. */
async function agg(src: string, rows: SqlValue[][], scope = rows.map((_, i) => i), flds = fields) {
  const { aggs } = extractAggregates(parseCanonical(src));
  expect(aggs).toHaveLength(1);
  return computeAggregate(aggs[0]!, { fields: flds, rows, scope, env });
}

describe('computeAggregate', () => {
  it('ten times 0.10 is exactly 1', async () => {
    const rows = Array.from({ length: 10 }, () => ['A', 0.1, 1, 0.1, 0.1]);
    expect(await agg('Sum([Montant])', rows)).toEqual(num(1));
  });
  it('expression over currency is exact per row', async () =>
    expect(await agg('Sum([Qté] * [Prix])', [['A', 0, 3, 12.35, 0], ['A', 0, 3, 12.35, 0], ['A', 0, 3, 12.35, 0]])).toEqual(num(111.15)));
  it('nulls', async () => {
    expect(await agg('Sum([Montant])', [['A', null, 1, 0, 0]])).toBeNull();
    expect(await agg('Count([Montant])', [['A', null, 1, 0, 0], ['B', 2, 1, 0, 0]])).toEqual(num(1));
    expect(await agg('Count(*)', [['A', null, 1, 0, 0], ['B', 2, 1, 0, 0]])).toEqual(num(2));
  });
  it('first last', async () => {
    const rowsABC = ['A', 'B', 'C'].map((c) => [c, 0, 0, 0, 0]);
    expect(await agg('First([Client])', rowsABC)).toEqual(str('A'));
    expect(await agg('Last([Client])', rowsABC)).toEqual(str('C'));
  });
  it('accumulator type from aggregateArgType: sixty times 1 x 0.10 is exactly 6', async () =>
    expect(await agg('Sum([Qté] * [Prix])', [...Array.from({ length: 60 }, () => ['A', 0, 1, 0.1, 0]), ['A', 0, null, 0.1, 0]])).toEqual(num(6)));
  it('a double stays floating point', async () =>
    expect(await agg('Sum([Taux])', [['A', 0, 0, 0, 0.5], ['A', 0, 0, 0, 0.25]])).toEqual(num(0.75)));
  it('scope picks the rows, in the order given', async () => {
    const rowsABC = ['A', 'B', 'C'].map((c, i) => [c, i + 1, 0, 0, 0]);
    expect(await agg('First([Client])', rowsABC, [2, 0])).toEqual(str('C'));
    expect(await agg('Sum([Montant])', rowsABC, [2, 0])).toEqual(num(4));
    expect(await agg('Count(*)', rowsABC, [1])).toEqual(num(1));
    expect(await agg('Count(*)', rowsABC, [])).toEqual(num(0));
  });
  it('field names resolve as Access does (case ignored); an unknown field is unknownField', async () => {
    expect(await agg('Sum([montant])', [['A', 2, 0, 0, 0]])).toEqual(num(2));
    await expect(agg('Sum([Inconnu])', [['A', 2, 0, 0, 0]])).rejects.toMatchObject({ name: 'ExprRuntimeError', code: 'unknownField' });
  });
  it('a text value is read in the region of the environment', async () =>
    expect(await agg('Sum([Client])', [['1,5', 0, 0, 0, 0], ['2', 0, 0, 0, 0]])).toEqual(num(3.5)));
  it('stored Yes/No and Date/Time values are read with fromStored (C9): Yes is -1, a date sum or average is a Double', async () => {
    const typed = [sf('Ok', 'yesNo'), sf('Quand', 'dateTime')];
    const rows: SqlValue[][] = [[1, '2026-01-01 00:00:00'], [1, '2026-01-02 00:00:00'], [0, '2026-01-03 00:00:00']]; // 46023..46025
    const run = (src: string) => agg(src, rows, undefined, typed);
    expect(await run('Sum([Ok])')).toEqual(num(-2));
    expect(await run('Sum([Quand])')).toEqual(num(138072));
    expect(await run('Avg([Quand])')).toEqual(num(46024));
    expect(await run('Min([Quand])')).toEqual(date(46023));
  });
});

describe('extractAggregates', () => {
  it('extract', () => {
    const { expr, aggs } = extractAggregates(parseCanonical('"Total : " & Sum([Montant]) & " / " & Count(*)'));
    expect(aggs.map((a) => a.fn)).toEqual(['Sum', 'Count']);
    expect(fieldRefs(expr)).toEqual(['\u0000agg0', '\u0000agg1']);
    expect(aggs[0]).toEqual({ fn: 'Sum', arg: { k: 'id', name: 'Montant' }, id: '\u0000agg0' });
    expect(aggs[1]).toEqual({ fn: 'Count', arg: { k: 'star' }, id: '\u0000agg1' });
  });
  it('every occurrence has its own id; other calls and field references stay', () => {
    const { expr, aggs } = extractAggregates(parseCanonical('Round(Sum([Montant]) / Sum([Qté]), 2) + [Taux]'));
    expect(aggs.map((a) => a.id)).toEqual(['\u0000agg0', '\u0000agg1']);
    const ratio = { k: 'bin', op: '/', l: { k: 'id', name: '\u0000agg0' }, r: { k: 'id', name: '\u0000agg1' } };
    expect(expr).toEqual({ k: 'bin', op: '+', l: { k: 'call', name: 'Round', args: [ratio, { k: 'num', v: '2' }] }, r: { k: 'id', name: 'Taux' } });
  });
  it('no aggregate: the tree is returned unchanged', () => {
    const e = parseCanonical('[Montant] * 2');
    expect(extractAggregates(e)).toEqual({ expr: e, aggs: [] });
  });
  it('nested aggregate refused', () => {
    expect(() => extractAggregates(parseCanonical('Sum(Sum([Montant]))'))).toThrow(ExprSyntaxError);
    expect(() => extractAggregates(parseCanonical('Max(1 + Count(*))'))).toThrow(expect.objectContaining({ code: 'unexpectedToken' }));
  });
});
