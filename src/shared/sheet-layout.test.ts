import { describe, expect, it } from 'vitest';
import { parseSheetLayout } from './sheet-layout';

describe('parseSheetLayout', () => {
  it('keeps a valid layout as it is', () => {
    const l = { rowHeight: 40, frozen: ['A'], order: ['A', 'B'], totals: true, totalFns: { B: 'sum' }, fontSize: 14, bold: true, italic: false, underline: true,
      font: 'Lora', textColor: '#112233', backColor: '#ffffff', gridColor: '#abcdef', gridlines: { horizontal: true, vertical: false }, aligns: { A: 'center' } };
    expect(parseSheetLayout(JSON.parse(JSON.stringify(l)))).toEqual(l);
  });
  it('leaves out what is invalid and nothing else', () => {
    const got = parseSheetLayout({ rowHeight: 5, frozen: ['A', 3, '', 'x'.repeat(256)], order: [], totals: 'yes', totalFns: { A: 'median', B: 'avg' }, fontSize: 500, bold: 'x', italic: true,
      textColor: 'red', backColor: '#fff', gridlines: { horizontal: true }, aligns: { A: 'justify', B: 'right' }, extra: 1 });
    expect(got).toEqual({ frozen: ['A'], totalFns: { B: 'avg' }, italic: true, aligns: { B: 'right' } });
  });
  it('reads anything else as no layout, and a field named __proto__ as a field', () => {
    for (const v of [null, undefined, 5, 'x', [], [1]]) expect(parseSheetLayout(v)).toEqual({});
    const got = parseSheetLayout(JSON.parse('{"aligns":{"__proto__":"left"}}'));
    expect(Object.keys(got.aligns!)).toEqual(['__proto__']);
    expect(({} as { left?: string }).left).toBeUndefined();
  });
});
