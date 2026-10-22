import { describe, expect, it } from 'vitest';
import {
  formatCurrency,
  formatDateTime,
  localeInfo,
  parseDateTime,
  parseDecimal,
  parseNumber,
  roundDecimalString
} from './locale-format';

const fr = localeInfo('fr-FR'), en = localeInfo('en-US'), de = localeInfo('de-DE');

describe('locale-format', () => {
  it('separators and date order', () => {
    expect([fr.decimalSep, fr.dateOrder, en.decimalSep, en.dateOrder]).toEqual([',', 'DMY', '.', 'MDY']);
  });
  it('parses numbers', () => {
    expect(parseNumber('1 234,5', fr)).toBe(1234.5);
    expect(parseNumber('1 234,5', fr)).toBe(1234.5);
    expect(parseNumber('1 234,5', fr)).toBe(1234.5);
    expect(parseNumber('-0,25', fr)).toBe(-0.25);
    expect(parseNumber('1.5', fr)).toBe(1.5);
    expect(parseNumber('1.234,5', de)).toBe(1234.5);
    expect(parseNumber('1,234.5', en)).toBe(1234.5);
    expect(parseNumber('12abc', fr)).toBeNull();
    expect(parseNumber('', fr)).toBeNull();
  });
  it('parses decimals exactly', () => {
    expect(parseDecimal('12345678901234567,123', fr)).toBe('12345678901234567.123');
    expect(parseDecimal('-0,50', fr)).toBe('-0.5');
    expect(roundDecimalString('2.5', 0)).toBe('2'); expect(roundDecimalString('3.5', 0)).toBe('4');
    expect(roundDecimalString('1234.56785', 4)).toBe('1234.5678');
  });
  it('parses dates', () => {
    expect(parseDateTime('21/10/2026', fr)).toBe('2026-10-21 00:00:00');
    expect(parseDateTime('10/21/2026', en)).toBe('2026-10-21 00:00:00');
    expect(parseDateTime('21/10/2026 14:05', fr)).toBe('2026-10-21 14:05:00');
    expect(parseDateTime('2026-10-21 08:30:15', fr)).toBe('2026-10-21 08:30:15');
    expect(parseDateTime('21/10/29', fr)).toBe('2029-10-21 00:00:00');
    expect(parseDateTime('21/10/30', fr)).toBe('1930-10-21 00:00:00');
    expect(parseDateTime('14:30', fr)).toBe('1899-12-30 14:30:00');
    expect(parseDateTime('31/02/2026', fr)).toBeNull();
  });
  it('years 100 to 9999 only (as Access), and years below 1000 round-trip with four digits', () => {
    expect(parseDateTime('0050-03-04', fr)).toBeNull(); // would display as 04/03/50 and read back as 1950
    expect(parseDateTime('04/03/0050', fr)).toBeNull();
    expect(parseDateTime('0099-12-31', fr)).toBeNull();
    expect(parseDateTime('0100-01-01', fr)).toBe('0100-01-01 00:00:00');
    expect(parseDateTime('9999-12-31', fr)).toBe('9999-12-31 00:00:00');
    expect(formatDateTime('0150-03-04 00:00:00', 'fr-FR')).toBe('04/03/0150');
    for (const [loc, info] of [['fr-FR', fr], ['en-US', en]] as const) {
      expect(parseDateTime(formatDateTime('0150-03-04 00:00:00', loc), info)).toBe('0150-03-04 00:00:00');
    }
    expect(parseDateTime(formatDateTime('0150-03-04 14:05:00', 'fr-FR'), fr)).toBe('0150-03-04 14:05:00');
  });
  it('formats', () => {
    expect(formatDateTime('2026-10-21 00:00:00', 'fr-FR')).toBe('21/10/2026');
    expect(formatDateTime('2026-10-21 14:05:00', 'fr-FR')).toBe('21/10/2026 14:05:00');
    expect(formatDateTime('2026-10-21 14:05:00', 'en-US')).toMatch(/^10\/21\/2026,? 2:05:00[\s ]PM$/);
    expect(formatCurrency(12.5, 'fr-FR')).toBe('12,50 €');
    expect(formatCurrency(12.5, 'en-US')).toBe('$12.50');
  });
});
