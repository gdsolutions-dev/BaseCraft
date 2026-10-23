import { describe, expect, it } from 'vitest';
import { NO_TOKENS, YES_TOKENS } from './coerce';
import { defaultExportSpec, type ExportTextSpec } from './exchange';
import { csvRecord, encodeText, excelCurrencyFormat, excelDateFormat, exportCell, sheetName } from './export-format';
import { defaultProps, type FieldProps, type FieldType } from './field-types';
import { localeInfo } from './locale-format';
import type { SourceField } from './record-source';

const fr = localeInfo('fr-FR');
const t = { info: fr, yes: 'Vrai', no: 'Faux' };
const sf = (name: string, type: FieldType, props: Partial<FieldProps> = {}): SourceField => ({ name, type, props: { ...defaultProps(type), ...props } as FieldProps });
const spec = (delimiter: ExportTextSpec['delimiter'], qualifier: ExportTextSpec['qualifier']): ExportTextSpec => ({ ...defaultExportSpec(fr), delimiter, qualifier });

describe('exportCell', () => {
  it('numbers use the region separator, no grouping', () => {
    expect(exportCell(1234.5, sf('n', 'number', { numberSize: 'double' }), t)).toBe('1234,5');
    expect(exportCell(12.5, sf('c', 'currency'), t)).toBe('12,5');
    expect(exportCell(1234.5, sf('n', 'number', { numberSize: 'double' }), { ...t, info: localeInfo('en-US') })).toBe('1234.5');
  });
  it('dates: time only when not midnight', () => {
    expect(exportCell('2026-10-23T00:00:00', sf('d', 'dateTime'), t)).toBe('23/10/2026');
    expect(exportCell('2026-10-23T09:05:00', sf('d', 'dateTime'), t)).toBe('23/10/2026 09:05:00');
    expect(exportCell('2026-10-23 09:05:00', sf('d', 'dateTime'), { ...t, info: localeInfo('en-US') })).toBe('10/23/2026 09:05:00');
  });
  it('yes/no words read back by the importer', () => {
    expect(YES_TOKENS).toContain('vrai'); expect(NO_TOKENS).toContain('false');
    for (const [y, n] of [['Vrai', 'Faux'], ['True', 'False']]) {
      expect(YES_TOKENS).toContain(y!.toLowerCase()); expect(NO_TOKENS).toContain(n!.toLowerCase());
    }
    expect(exportCell(1, sf('b', 'yesNo'), t)).toBe('Vrai');
    expect(exportCell(0, sf('b', 'yesNo'), t)).toBe('Faux');
  });
  it('text as stored, null empty', () => {
    expect(exportCell(' a;b ', sf('s', 'shortText'), t)).toBe(' a;b ');
    expect(exportCell(null, sf('s', 'shortText'), t)).toBeNull();
  });
});

describe('csvRecord', () => {
  it('quotes text and doubles the qualifier', () => expect(csvRecord(['Il a dit "oui"', '3'], [true, false], spec(';', '"')).line).toBe('"Il a dit ""oui""";3'));
  it('empty text vs null', () => expect(csvRecord(['', null, 'x'], [true, true, true], spec(';', '"')).line).toBe('"";;"x"'));
  it('ambiguous without qualifier', () => expect(csvRecord(['a;b'], [true], spec(';', '')).ambiguous).toBe(true));
  it('a number holding the delimiter is written as is and reported', () => {
    expect(csvRecord(['1,5'], [false], spec(',', '"'))).toEqual({ line: '1,5', ambiguous: true });
  });
});

describe('encodeText', () => {
  it('cp1252', () => {
    const r = encodeText('€é😀', 'windows-1252');
    expect([...r.bytes]).toEqual([0x80, 0xe9, 0x3f]);
    expect(r.unmappable).toBe(1);
  });
  it('utf-8 with and without BOM', () => {
    expect([...encodeText('é', 'utf-8-bom').bytes]).toEqual([0xef, 0xbb, 0xbf, 0xc3, 0xa9]);
    expect([...encodeText('é', 'utf-8').bytes]).toEqual([0xc3, 0xa9]);
  });
});

it('default spec follows the region', () => {
  expect(defaultExportSpec(fr).delimiter).toBe(';');
  expect(defaultExportSpec(localeInfo('en-US')).delimiter).toBe(',');
});

describe('Excel formats', () => {
  it('sheet names', () => {
    expect(sheetName('Ventes [2026]: T1/T2?')).toBe('Ventes 2026 T1T2');
    expect(sheetName('x'.repeat(40))).toHaveLength(31);
    expect(sheetName('[]')).toBe('Sheet1');
  });
  it('formats', () => {
    expect(excelCurrencyFormat(localeInfo('fr-FR'))).toBe('#,##0.00\\ "€"');
    expect(excelCurrencyFormat(localeInfo('en-US'))).toBe('"$"#,##0.00');
    expect(excelDateFormat(localeInfo('fr-FR'), false)).toBe('dd/mm/yyyy');
    expect(excelDateFormat(localeInfo('fr-FR'), true)).toBe('dd/mm/yyyy hh:mm:ss');
    expect(excelDateFormat(localeInfo('en-US'), false)).toBe('m/d/yyyy');
    expect(excelDateFormat(localeInfo('en-US'), true)).toBe('m/d/yyyy h:mm:ss');
  });
});
