import { describe, expect, it } from 'vitest';
import {
  formatCurrency,
  dateTimeFormat,
  formatDateTime,
  isoToStored,
  localeInfo,
  numberFormat,
  parseDateTime,
  parseDecimal,
  parseNumber,
  regionTag,
  roundDecimalString
} from './locale-format';

const fr = localeInfo('fr-FR'), en = localeInfo('en-US'), de = localeInfo('de-DE');

describe('locale-format', () => {
  it('a system locale Intl rejects becomes a usable tag', () => {
    expect(['fr-FR', 'en-US@posix', 'de-DE@euro', 'C', ''].map(regionTag)).toEqual(['fr-FR', 'en-US', 'de-DE', 'en-US', 'en-US']);
  });
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

describe('Intl formatters, built once per locale and options (reports format tens of thousands of values)', () => {
  it('the same formatter for the same locale and options, another for other ones', () => {
    expect(numberFormat('fr-FR', { minimumFractionDigits: 2 })).toBe(numberFormat('fr-FR', { minimumFractionDigits: 2 }));
    expect(numberFormat('fr-FR', { minimumFractionDigits: 2 })).not.toBe(numberFormat('en-US', { minimumFractionDigits: 2 }));
    expect(dateTimeFormat('fr-FR', { month: 'long', timeZone: 'UTC' })).toBe(dateTimeFormat('fr-FR', { month: 'long', timeZone: 'UTC' }));
    expect(dateTimeFormat('fr-FR', { month: 'long', timeZone: 'UTC' })).not.toBe(dateTimeFormat('fr-FR', { month: 'short', timeZone: 'UTC' }));
    expect(numberFormat('fr-FR', { minimumFractionDigits: 2 }).format(1.5)).toBe('1,50');
  });
});

describe('isoToStored', () => {
  it('an ISO 8601 instant (bc_objects dates) as a local stored date-time, shown by formatDateTime in the region', () => {
    const iso = new Date(2026, 9, 21, 14, 5, 9).toISOString();
    expect(isoToStored(iso)).toBe('2026-10-21 14:05:09');
    expect(formatDateTime(isoToStored(iso), 'fr-FR')).toBe('21/10/2026 14:05:09');
    expect(isoToStored('not a date')).toBe('not a date');
  });
});
