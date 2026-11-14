// C7b: text comparisons (=, <, >, <=, >=, Between, In, Min/Max, StrComp, grouping key) follow the base's sort order; no order set: as before.
import { afterEach, describe, expect, it } from 'vitest';
import type { Value } from './ast';
import { createAccumulator } from './aggregate';
import { evaluate, type EvalEnv } from './evaluate';
import { setTextOrder, textGroupKey } from './library';
import { parseCanonical } from './parser';
import { sortKey } from '../sort-orders';
import { localeInfo } from '../locale-format';

const env: EvalEnv = { field: () => null, now: () => new Date(2026, 0, 1), locale: 'fr-FR' };
const ev = async (src: string): Promise<unknown> => { const v = await evaluate(parseCanonical(src), env); return v === null ? null : v.t === 'empty' ? '' : v.v; };
const q = (s: string) => `"${s}"`;
afterEach(() => setTextOrder('legacy'));

// [left, right, sign of left against right] where the orders disagree: å is a letter after z in Swedish, an a with a ring elsewhere
describe.each([
  ['legacy', { åker: -1, zebra: -1 }],
  ['general', { åker: -1, zebra: -1 }],
  ['swedish', { åker: 1, zebra: -1 }],
] as const)('under the %s order', (order, expected) => {
  const t = (src: string) => { setTextOrder(order); return ev(src); };
  it('<, >, <=, >= against "z"', async () => {
    const a = expected.åker;
    expect(await t(`${q('åker')} > ${q('z')}`)).toBe(a > 0);
    expect(await t(`${q('åker')} < ${q('z')}`)).toBe(a < 0);
    expect(await t(`${q('åker')} >= ${q('z')}`)).toBe(a > 0);
    expect(await t(`${q('åker')} <= ${q('z')}`)).toBe(a < 0);
    expect(await t(`${q('zebra')} < ${q('åker')}`)).toBe(expected.zebra < 0 ? a > 0 : a < 0);
  });
  it('Between and In', async () => {
    expect(await t(`${q('åker')} Between ${q('x')} And ${q('ö')}`)).toBe(order === 'swedish');
    expect(await t(`${q('apa')} Between ${q('a')} And ${q('b')}`)).toBe(true);
    expect(await t(`${q('ÅKER')} In (${q('x')}, ${q('åker')})`)).toBe(true);
    expect(await t(`${q('aker')} In (${q('x')}, ${q('åker')})`)).toBe(false); // accents stay significant under every order
  });
  it('= ignores case and keeps accents; StrComp follows the order', async () => {
    expect(await t(`${q('Åker')} = ${q('åKER')}`)).toBe(true);
    expect(await t(`${q('a')} = ${q('å')}`)).toBe(false);
    expect(await t(`StrComp(${q('å')}, ${q('z')})`)).toBe(order === 'swedish' ? 1 : -1);
  });
  it('Min and Max of texts, grouping key', () => {
    setTextOrder(order);
    const run = (fn: 'Min' | 'Max') => {
      const acc = createAccumulator(fn, 'shortText', undefined, localeInfo('fr-FR'));
      for (const s of ['zebra', 'åker', 'apa']) acc.add({ t: 'str', v: s } as Value);
      return (acc.result() as { v: string }).v;
    };
    expect(run('Max')).toBe(order === 'swedish' ? 'åker' : 'zebra');
    expect(run('Min')).toBe(order === 'swedish' ? 'apa' : 'åker'); // General: å = a at the first level, then k < p
    expect(textGroupKey('Åker')).toBe(textGroupKey('åker'));
    expect(textGroupKey('aker')).not.toBe(textGroupKey('åker'));
  });
});

describe('contractions', () => {
  it('Czech "ch" is a letter after h', () => {
    const k = sortKey('czech');
    expect(k('hrad') < k('chata') && k('chata') < k('iva')).toBe(true);
    expect(k('Chata')).toBe(k('chata'));
    expect(k('cena') < k('hrad')).toBe(true);
  });
  it('Danish "aa" is å, after z', () => {
    const k = sortKey('danish');
    expect(k('zoo') < k('aal')).toBe(true);
    expect(k('aal')).toBe(k('ål'));
  });
  it('Hungarian "cs" and "sz" are letters of their own; General has none', () => {
    const k = sortKey('hungarian');
    expect(k('cukor') < k('csak')).toBe(true); // c, cs, d: "cu" is a c-word, before cs
    expect(k('csak') < k('dob')).toBe(true);
    const g = sortKey('general');
    expect(g('chata') < g('cukor')).toBe(true);
    expect(sortKey('spanish')('llave') < sortKey('spanish')('lobo')).toBe(true);
  });
});
