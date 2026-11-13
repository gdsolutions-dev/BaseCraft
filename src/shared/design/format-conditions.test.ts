// Conditional formatting (E2): the rules' storage, their evaluation, and a report's formatting by them.
import { describe, expect, it } from 'vitest';
import type { SqlValue } from '../coerce';
import { num, str } from '../expr/library';
import { parseCanonical } from '../expr/parser';
import { defaultProps, type FieldType } from '../field-types';
import { formatBand } from '../report/band';
import { readReport } from '../report/model';
import type { LayoutEnv, ReportData } from '../report/types';
import type { SourceField } from '../record-source';
import { compileConditions, conditionText, firstMatch, readConditions, writeConditions, type FormatCondition } from './format-conditions';
import type { ControlDef, DesignDoc } from './model';

const parse = (text: string, criteria: boolean) => parseCanonical(text, { criteria });
const env = { field: () => null, now: () => new Date(0), locale: 'en-US', lang: 'en' } as const;
const match = async (rules: FormatCondition[], v: Parameters<typeof firstMatch>[1]) => (await firstMatch(compileConditions(writeConditions(rules), parse), v, env))?.back ?? null;

describe('format conditions', () => {
  it('round-trips and drops malformed rules', () => {
    const ok: FormatCondition = { op: 'between', a: '1', b: '5', bold: true, fore: '#ff0000' };
    expect(readConditions(writeConditions([ok]))).toEqual([ok]);
    expect(writeConditions([])).toBeUndefined();
    const raw = JSON.stringify([ok, { op: 'nope', a: '1' }, { op: 'between', a: '1' }, { op: 'equal', a: ' ' }, { op: 'equal', a: '2', fore: 'red', back: '#00ff00' }, 7, null]);
    expect(readConditions(raw)).toEqual([ok, { op: 'equal', a: '2', back: '#00ff00' }]);
    expect(readConditions('{')).toEqual([]);
    expect(readConditions(undefined)).toEqual([]);
  });
  it('builds a criterion or an expression', () => {
    expect(conditionText({ op: 'between', a: '1', b: '5' })).toEqual({ text: 'Between (1) And (5)', criteria: true });
    expect(conditionText({ op: 'greaterEqual', a: '[Min]' })).toEqual({ text: '>=([Min])', criteria: true });
    expect(conditionText({ op: 'expression', a: '[X] > 1' })).toEqual({ text: '[X] > 1', criteria: false });
  });
  it('applies the first rule that holds', async () => {
    const rules: FormatCondition[] = [{ op: 'greater', a: '100', back: '#ff0000' }, { op: 'between', a: '10', b: '100', back: '#00ff00' }, { op: 'equal', a: '"x"', back: '#0000ff' }];
    expect(await match(rules, num(500))).toBe('#ff0000');
    expect(await match(rules, num(100))).toBe('#00ff00');
    expect(await match(rules, num(10))).toBe('#00ff00');
    expect(await match(rules, num(9))).toBeNull();
    expect(await match(rules, str('x'))).toBe('#0000ff');
    expect(await match(rules, null)).toBeNull();
    expect(await match([{ op: 'notEqual', a: '3', back: '#111111' }, { op: 'less', a: '3', back: '#222222' }], num(2))).toBe('#111111');
  });
  it('an expression rule reads the fields; a rule that does not parse or evaluate does not hold', async () => {
    const e = { ...env, field: (n: string) => { if (n === 'Qty') return num(7); throw new Error('unknown'); } };
    const rules = compileConditions(writeConditions([{ op: 'expression', a: '[Nope] > 1', back: '#111111' }, { op: 'expression', a: '[Qty] > 5', back: '#222222' }, { op: 'expression', a: '[', back: '#333333' }]), parse);
    expect(rules).toHaveLength(2);   // the third does not parse
    expect((await firstMatch(rules, null, e))?.back).toBe('#222222');
  });
});

const FIELDS: SourceField[] = [{ name: 'Qty', type: 'number' as FieldType, props: defaultProps('number') }];
const ENV: LayoutEnv = { locale: 'en-US', lang: 'en', now: () => new Date(0), errorText: { error: '#Error', name: '#Name?' } };
const data = (...qty: number[]): ReportData => ({ fields: FIELDS, rows: qty.map((q) => [q as SqlValue]) });
const tb = (props: Record<string, unknown>): ControlDef => ({ kind: 'textBox', name: 'Q', left: 0, top: 0, width: 2000, height: 300, props: { ControlSource: 'Qty', BorderStyle: 'transparent', ...props } });
const doc = (docProps: Record<string, unknown>, ...controls: ControlDef[]): DesignDoc => ({ formatVersion: '1.0', recordSource: null, props: docProps,
  sections: [{ kind: 'detail', height: 400, props: {}, controls }] });

describe('reports', () => {
  it('formats a text box by its rules, row by row', async () => {
    const rules = writeConditions([{ op: 'greater', a: '5', bold: true, fore: '#ff0000', back: '#ffff00' }]);
    const spec = readReport(doc({}, tb({ FormatConditions: rules })), FIELDS).detail!;
    const at = async (row: number) => (await formatBand(spec, data(9, 2), { row, scope: [0, 1], page: 1, pages: null, formatCount: 1 }, ENV))!.items[0] as any;
    expect(await at(0)).toMatchObject({ color: '#ff0000', back: '#ffff00', font: { bold: true } });
    expect(await at(1)).toMatchObject({ color: '#1b1f27', font: { bold: false } });   // the report's default text colour
  });
});
