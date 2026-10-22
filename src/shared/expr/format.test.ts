import { describe, expect, it } from 'vitest';
import type { Value } from './ast';
import { FORMATS_BY_TYPE, formatValue, namedFormatId } from './format';
import { bool, date, EMPTY, num, str, toSerial } from './library';

const NNBSP = String.fromCharCode(0x202f); // fr-FR thousands separator (same as the datasheet)
const NBSP = String.fromCharCode(0xa0); // fr-FR percent and currency (same as the datasheet)
const d = (iso: string): Value => date(toSerial(iso));
const fmt = (v: Value, f: string | undefined, locale: string, decimalPlaces?: 'auto' | number): string =>
  formatValue(v, f, { locale, lang: locale.startsWith('fr') ? 'fr' : 'en', decimalPlaces });

describe('formatValue', () => {
  it.each<[Value, string, string, string]>([
    [num(1234.5), 'fixed', 'fr-FR', '1234,50'],
    [num(1234.5), 'standard', 'fr-FR', `1${NNBSP}234,50`],
    [num(0.125), 'percent', 'fr-FR', `12,50${NBSP}%`],
    [num(1234.5), 'euro', 'en-US', '€1,234.50'],
    [num(-3), '0.0;(0.0);"zéro"', 'fr-FR', '(3,0)'],
    [num(0), '0.0;(0.0);"zéro"', 'fr-FR', 'zéro'],
    [d('2026-10-21 14:05:00'), 'dddd d mmmm yyyy', 'fr-FR', 'mercredi 21 octobre 2026'],
    [d('2026-10-21 14:05:00'), 'hh:nn', 'fr-FR', '14:05'],
    [d('2026-10-21 00:00:00'), 'shortDate', 'fr-FR', '21/10/2026'],
    [bool(true), 'yesNo', 'fr-FR', 'Oui'],
    [str('Dupont'), '>', 'fr-FR', 'DUPONT'],
    [null, '0;0;0;"(vide)"', 'fr-FR', '(vide)'],
  ])('%#', (v, f, loc, out) => expect(fmt(v, f, loc)).toBe(out));

  it('number sections, groups, literals', () => {
    expect(fmt(num(1234567.891), '#,##0.00', 'en-US')).toBe('1,234,567.89');
    expect(fmt(num(0.5), '#.##', 'en-US')).toBe('.5');
    expect(fmt(num(5), '000', 'fr-FR')).toBe('005');
    expect(fmt(num(0.125), '0.0%', 'fr-FR')).toBe('12,5%');
    expect(fmt(num(12), '0" kg"', 'fr-FR')).toBe('12 kg');
    expect(fmt(num(12), '0\€', 'fr-FR')).toBe('12€');
    expect(fmt(num(-5), '0', 'fr-FR')).toBe('-5');
    expect(fmt(EMPTY, '0.0', 'fr-FR')).toBe('0,0');
    expect(fmt(EMPTY, '@', 'fr-FR')).toBe('');
    expect(fmt(null, '0.0', 'fr-FR')).toBe('');
  });

  it('named numbers, decimalPlaces override, scientific', () => {
    expect(fmt(num(1234.5), 'fixed', 'fr-FR', 0)).toBe('1235');
    expect(fmt(num(1234.5), 'fixed', 'fr-FR', 'auto')).toBe('1234,50');
    expect(fmt(num(1234.5), 'generalNumber', 'de-DE')).toBe('1234,5');
    expect(fmt(num(1234.5), 'currency', 'fr-FR')).toBe(`1${NNBSP}234,50${NBSP}€`);
    expect(fmt(num(1234.5), 'scientific', 'en-US')).toBe('1.23E+03');
  });

  it('named dates and times', () => {
    const v = d('2026-10-21 14:05:09');
    expect(fmt(v, 'generalDate', 'fr-FR')).toBe('21/10/2026 14:05:09');
    expect(fmt(v, 'longDate', 'fr-FR')).toBe('mercredi 21 octobre 2026');
    expect(fmt(v, 'mediumDate', 'en-US')).toBe('Oct 21, 2026');
    expect(fmt(v, 'shortDate', 'en-US')).toBe('10/21/2026');
    expect(fmt(v, 'longTime', 'fr-FR')).toBe('14:05:09');
    expect(fmt(v, 'shortTime', 'fr-FR')).toBe('14:05');
    expect(fmt(v, 'mediumTime', 'en-US')).toMatch(/^02:05 PM$/);
    expect(fmt(v, 'yyyy-mm-dd hh:nn:ss', 'fr-FR')).toBe('2026-10-21 14:05:09');
    expect(fmt(v, 'd/m/yy "à" h', 'fr-FR')).toBe('21/10/26 à 14');
  });

  it('yes/no labels follow the language', () => {
    expect(fmt(bool(false), 'trueFalse', 'fr-FR')).toBe('Faux');
    expect(fmt(bool(true), 'onOff', 'en-US')).toBe('On');
    expect(fmt(num(0), 'yesNo', 'en-US')).toBe('No');
    expect(fmt(bool(true), 'yesNo', 'en-US')).toBe('Yes');
  });

  it('text', () => {
    expect(fmt(str('Dupont'), '<', 'fr-FR')).toBe('dupont');
    expect(fmt(str('Dupont'), '"M. "@', 'fr-FR')).toBe('M. Dupont');
  });

  it('never throws: unknown or unusable formats show the plain value', () => {
    expect(fmt(num(1.5), 'zzz', 'fr-FR')).toBe('1,5');
    expect(fmt(num(1.5), '"unterminated', 'fr-FR')).toBe('1,5');
    expect(fmt(num(1.5), undefined, 'fr-FR')).toBe('1,5');
    expect(fmt(str('abc'), 'fixed', 'fr-FR')).toBe('abc');
    expect(fmt(num(Infinity), 'fixed', 'fr-FR')).toBe('Infinity');
  });

  it('lists named formats by type', () => {
    expect(FORMATS_BY_TYPE.dateTime).toContain('longDate');
    expect(FORMATS_BY_TYPE.shortText).toEqual([]);
    expect(FORMATS_BY_TYPE.yesNo).toEqual(['yesNo', 'trueFalse', 'onOff']);
  });
});

describe('formatValue (review fixes)', () => {
  const v = d('2026-10-21 14:05:09');
  it('m/mm after h or before s means minutes', () => {
    expect(fmt(v, 'hh:mm', 'fr-FR')).toBe('14:05');
    expect(fmt(v, 'hh:mm:ss', 'fr-FR')).toBe('14:05:09');
    expect(fmt(v, 'h"h"mm', 'fr-FR')).toBe('14h05');
    expect(fmt(v, 'm:ss', 'fr-FR')).toBe('5:09');
    expect(fmt(v, 'mm/dd/yyyy', 'en-US')).toBe('10/21/2026');
    expect(fmt(v, 'd mmm yyyy hh:nn', 'en-US')).toBe('21 Oct 2026 14:05');
  });

  it("accepts Access's English names, case and spaces ignored", () => {
    expect(fmt(num(1234.5), 'Fixed', 'fr-FR')).toBe('1234,50');
    expect(fmt(num(1234.5), 'general number', 'fr-FR')).toBe('1234,5');
    expect(fmt(v, 'Short Date', 'fr-FR')).toBe('21/10/2026');
    expect(fmt(bool(true), 'Yes/No', 'en-US')).toBe('Yes');
    expect(fmt(bool(false), 'ON/off', 'en-US')).toBe('Off');
    expect(namedFormatId('True/False')).toBe('trueFalse');
    expect(namedFormatId('fixed')).toBe('fixed');
    expect(namedFormatId('0.00')).toBeUndefined();
  });

  it('unquoted letters that are not tokens fall back to the plain display', () => {
    expect(fmt(num(1.5), 'Curr', 'fr-FR')).toBe('1,5');
    expect(fmt(num(1.5), '0 kg', 'fr-FR')).toBe('1,5');
    expect(fmt(v, 'dd/mm/yyyy hh:nn AM/PM', 'fr-FR')).toBe('21/10/2026 14:05:09');
    expect(fmt(v, 'y', 'fr-FR')).toBe('21/10/2026 14:05:09');
    expect(fmt(v, 'yyy', 'fr-FR')).toBe('21/10/2026 14:05:09');
    expect(fmt(num(1.5), '0.0E+00', 'fr-FR')).toBe('1,5');
  });

  it('digit placeholders: leading dot supported, unfaithful patterns fall back', () => {
    expect(fmt(num(0.5), '.00', 'en-US')).toBe('.50');
    expect(fmt(num(0), '.00', 'en-US')).toBe('.00');
    expect(fmt(num(5551234), '000-0000', 'en-US')).toBe('5551234');
    expect(fmt(num(1234.5), '#,##0,', 'en-US')).toBe('1234.5');
    expect(fmt(num(5), '0.', 'en-US')).toBe('5');
    expect(fmt(num(1.5), '0.0.0', 'en-US')).toBe('1.5');
  });

  it('text formats: section 2 is for Null and empty strings', () => {
    expect(fmt(null, '@;"(vide)"', 'fr-FR')).toBe('(vide)');
    expect(fmt(str(''), '@;"(vide)"', 'fr-FR')).toBe('(vide)');
    expect(fmt(str('x'), '@;"(vide)"', 'fr-FR')).toBe('x');
    expect(fmt(null, '@', 'fr-FR')).toBe('');
  });
});
