import { describe, expect, it } from 'vitest';
import { compactMessage, formatSize } from './compact-message';

const more = (n: number) => `+${n}`;

describe('compactMessage', () => {
  it('done: sizes and backup', () => {
    const m = compactMessage({ ok: true, backupPath: 'b.basecraft', sizeBefore: 5 * 1024 ** 2, sizeAfter: 200 * 1024, repaired: [] }, 'en', more);
    expect(m).toEqual({ messageKey: 'compact.done', params: { before: formatSize(5 * 1024 ** 2, 'en'), after: formatSize(200 * 1024, 'en'), backup: 'b.basecraft' } });
    expect(formatSize(200 * 1024, 'en')).toMatch(/^200\s?kB$/);
  });
  it('repaired and corrupt list at most 10 problems', () => {
    const problems = Array.from({ length: 12 }, (_, i) => `p${i}`);
    const r = compactMessage({ ok: true, backupPath: 'b', sizeBefore: 1, sizeAfter: 1, repaired: problems.slice(0, 2) }, 'fr', more);
    expect(r).toMatchObject({ messageKey: 'compact.repaired', params: { count: 2, problems: 'p0\np1' } });
    const c = compactMessage({ ok: false, reason: 'corrupt', problems, backupPath: 'b' }, 'fr', more);
    expect(c).toEqual({ messageKey: 'compact.corrupt', params: { problems: [...problems.slice(0, 10), '+2'].join('\n'), backup: 'b' } });
  });
});
