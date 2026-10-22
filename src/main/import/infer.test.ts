import { describe, expect, it } from 'vitest';
import {
  defaultSpec, detectNumberFormat, fieldNames, parseFileNumber, sanitizeName, sanitizeTableName, specLocale, uniqueName, validSpec,
} from '../../shared/import-text';
import { localeInfo } from '../../shared/locale-format';
import { detectHeader, inferFields, inferType } from './infer';

const fr = localeInfo('fr-FR');
const spec = defaultSpec(fr);
const dot = { ...spec, decimalSep: '.' };

describe('type inference', () => {
  const type = (v: string[], s = spec) => inferType(v, s, specLocale(s, fr)).type;
  it('long integers', () => expect(type(['1', '-42', '', '2147483647'])).toBe('longInteger'));
  it('out of long range → double', () => expect(type(['2147483648'])).toBe('double'));
  it('decimals with the spec symbol', () => expect(type(['12.5', '3'], dot)).toBe('double'));
  it('leading zeros stay text', () => expect(type(['01230', '75001'])).toBe('shortText'));
  it('more than 15 significant digits stay text (a double would lose them)', () => {
    expect(type(['12345678901234567890'])).toBe('shortText');
    expect(type(['123456789012345'])).toBe('double');
  });
  it('dates in the spec order', () => {
    expect(type(['2024-01-15', '2024-12-31'])).toBe('dateTime');
    expect(type(['31/12/2024', '01/02/2024'])).toBe('dateTime');
    expect(type(['12/31/2024'])).toBe('shortText'); // not a DMY date
    expect(type(['12/31/2024'], { ...spec, dateOrder: 'MDY' })).toBe('dateTime');
  });
  it('time separator of the file', () => expect(type(['31/12/2024 10.30'], { ...spec, timeSep: '.' })).toBe('dateTime'));
  it('yes/no words only', () => {
    expect(type(['oui', 'Non', 'yes'])).toBe('yesNo');
    expect(type(['0', '1'])).toBe('longInteger');
    expect(type(['oui', 'peut-être'])).toBe('shortText');
  });
  it('text sizes', () => {
    expect(inferType(['abc'], spec, fr)).toEqual({ type: 'shortText', size: 255 }); // as Access: 255 whatever the sample
    expect(inferType(['x'.repeat(63)], spec, fr)).toEqual({ type: 'shortText', size: 255 });
    expect(inferType(['x'.repeat(255)], spec, fr)).toEqual({ type: 'shortText', size: 255 });
    expect(inferType(['x'.repeat(256)], spec, fr)).toEqual({ type: 'longText' });
    expect(inferType(['', ' '], spec, fr)).toEqual({ type: 'shortText', size: 255 });
  });
});

describe('numbers as written in the file (never the region)', () => {
  it.each([
    ['1.234', ',', '.', '1234'], ['249.90', '.', ',', '249.9'], ['249.90', ',', '.', null], ['1.234,5', ',', '.', '1234.5'],
    ['1,234.5', '.', ',', '1234.5'], ['1 234,5', ',', '.', '1234.5'], ['1 234,5', ',', '', '1234.5'], ['12,34,5', '.', ',', null],
    ['1.2.3', ',', '.', null], ['-2,5', ',', '', '-2.5'], ['2,5', '.', '', null], ['1234', '.', ',', '1234'], ['1,23', '.', ',', null],
    ['+7', '.', ',', '7'], ['', '.', ',', null], ['.5', '.', ',', '0.5'], ['1 2', ',', '.', null],
  ])('%s with decimal %s and thousands %s', (text, dec, group, want) => expect(parseFileNumber(text, dec, group)).toBe(want));
  it.each([
    [['249.90', '12.5', '3'], ',', { decimalSep: '.', thousandsSep: ',', assumed: false }],
    [['2,5', '1 234,50'], '.', { decimalSep: ',', thousandsSep: ' ', assumed: false }],
    [['1.234,50', '12,00'], '.', { decimalSep: ',', thousandsSep: '.', assumed: false }],
    [['1,234.50', '7'], ',', { decimalSep: '.', thousandsSep: ',', assumed: false }],
    [['12', 'abc'], ',', { decimalSep: ',', thousandsSep: '.', assumed: false }],
    // three digits after the only separator: ambiguous unless a leading 0 or a too long first group proves it decimal
    [['1,250', '0,750', '2,125'], '.', { decimalSep: ',', thousandsSep: '.', assumed: false }],
    [['1.250', '0.750'], ',', { decimalSep: '.', thousandsSep: ',', assumed: false }],
    [['1250,500'], '.', { decimalSep: ',', thousandsSep: '.', assumed: false }],
    [['1,250', '2,125'], ',', { decimalSep: ',', thousandsSep: '.', assumed: true }], // the region decides, visibly
    [['1,250', '2,125'], '.', { decimalSep: '.', thousandsSep: ',', assumed: true }],
    // a repeated separator or a space group proves the other symbol is the decimal
    [['1,250,500', '2,125'], ',', { decimalSep: '.', thousandsSep: ',', assumed: false }],
    [['1.250.500', '0,5'], ',', { decimalSep: ',', thousandsSep: '.', assumed: false }],
    [['1.250.500'], '.', { decimalSep: ',', thousandsSep: '.', assumed: false }],
    [['1 250,500'], '.', { decimalSep: ',', thousandsSep: ' ', assumed: false }],
    // proofs for both: the majority wins, a tie goes to the region, and either way the choice is shown
    [['12,5', '12.5', '1,250'], ',', { decimalSep: ',', thousandsSep: '.', assumed: true }],
    [['12,5', '12.5', '1,250'], '.', { decimalSep: '.', thousandsSep: ',', assumed: true }],
    [['12,5', '3,25', '12.5'], '.', { decimalSep: ',', thousandsSep: '.', assumed: true }],
  ])('detects %j (region decimal %s)', (values, region, want) => expect(detectNumberFormat(values, region)).toEqual(want));
});

describe('header detection', () => {
  it('text names over data', () => expect(detectHeader([['Date', 'Qté'], ['2024-01-01', '3']], spec, fr)).toBe(true));
  it('numbers in the first row', () => expect(detectHeader([['1', 'a'], ['2', 'b']], spec, fr)).toBe(false));
  it('duplicate or empty names are still a header (the names are deduplicated)', () => {
    expect(detectHeader([['a', 'A'], ['1', '2']], spec, fr)).toBe(true);
    expect(detectHeader([['a', ''], ['1', '2']], spec, fr)).toBe(true);
    expect(detectHeader([['', ''], ['1', '2']], spec, fr)).toBe(false);
  });
});

describe('field and table names', () => {
  it('sanitizes forbidden characters', () => expect(sanitizeName(' Prix [€]. TTC! ', 'Champ1')).toBe('Prix _€__ TTC_'));
  it('falls back when nothing is left', () => expect(sanitizeName('   ', 'Champ3')).toBe('Champ3'));
  it('reserved column names', () => expect(sanitizeName('rowid', 'x')).toBe('rowid_'));
  it('truncates to 64 characters', () => expect([...sanitizeName('é'.repeat(80), 'x')].length).toBe(64));
  it('dedupes ignoring case', () => expect(fieldNames(['Nom', 'nom', 'NOM', ''], 4, 'Champ')).toEqual(['Nom', 'nom1', 'NOM2', 'Champ4']));
  it('names from the prefix without header', () => expect(fieldNames(null, 2, 'Field')).toEqual(['Field1', 'Field2']));
  it('table names avoid reserved prefixes', () => expect(sanitizeTableName('bc_data', 'T')).toBe('_bc_data'));
  it('unique table name', () => expect(uniqueName('Ventes', ['ventes', 'Ventes1'])).toBe('Ventes2'));
  it('infers fields from header and rows', () => {
    expect(inferFields(['Qté', 'Prix'], [['2', '12.5']], 2, dot, specLocale(dot, fr), 'Champ')).toEqual([
      { name: 'Qté', indexed: 'no', skip: false, type: 'longInteger' },
      { name: 'Prix', indexed: 'no', skip: false, type: 'double' },
    ]);
  });
});

describe('spec validation', () => {
  const good = { ...spec, fields: [{ name: 'A', type: 'shortText', indexed: 'no', skip: false, size: 50 }] };
  it('accepts a valid spec and strips unknown keys', () => expect(validSpec({ ...good, extra: 1 })).toEqual(good));
  it.each([
    ['format', { format: 'xml' }], ['delimiter', { delimiter: ',,' }], ['newline delimiter', { delimiter: '\n' }],
    ['qualifier', { qualifier: '`' }], ['encoding', { encoding: 'latin9' }], ['date order', { dateOrder: 'DDD' }],
    ['breaks order', { breaks: [5, 3] }], ['break zero', { breaks: [0] }], ['field type', { fields: [{ ...good.fields[0], type: 'blob' }] }],
    ['field size', { fields: [{ ...good.fields[0], size: 300 }] }], ['delimiter = qualifier', { delimiter: '"' }],
  ])('rejects bad %s', (_n, patch) => expect(validSpec({ ...good, ...patch })).toBeNull());
  it('rejects non objects', () => { expect(validSpec(null)).toBeNull(); expect(validSpec([])).toBeNull(); });
});
