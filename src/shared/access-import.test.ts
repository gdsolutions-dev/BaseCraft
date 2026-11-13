import { describe, expect, it } from 'vitest';
import { REPORT_LEVEL, reportText } from './access-import';

const t = (k: string, p?: Record<string, unknown>) => `${k}${p ? JSON.stringify(p) : ''}`;

describe('access-import report', () => {
  it('REPORT_LEVEL gives every code a level', () => {
    expect(REPORT_LEVEL.tableImported).toBe('carried');
    expect(REPORT_LEVEL.keyAssumed).toBe('approximated');
    expect(REPORT_LEVEL.fieldSkipped).toBe('ignored');
  });
  it('reportText: ignored first, then approximated, then carried; an empty level is left out', () => {
    const text = reportText({ source: 'Ventes.accdb', lines: [
      { code: 'tableImported', object: 'Clients', n: 4 }, { code: 'fieldSkipped', object: 'Clients', part: 'Photo' } ] }, t);
    const lines = text.split('\n');
    expect(lines[0]).toBe('import.report.title{"source":"Ventes.accdb"}');
    expect(text.indexOf('import.report.level.ignored')).toBeLessThan(text.indexOf('import.report.level.carried'));
    expect(text).not.toContain('import.report.level.approximated');
    expect(text).toContain('import.report.line.fieldSkipped{"object":"Clients","part":"Photo"}');
    expect(text.endsWith('\n')).toBe(true);
  });
});
