import { describe, expect, it } from 'vitest';
import type { SqlValue } from '../../shared/coerce';
import type { SourceField } from '../../shared/record-source';
import { rowTest, searchStart, type SearchRecord } from './search-record';

const field = (name: string, type: string): SourceField => ({ name, type, props: { type } } as unknown as SourceField);
const fields = [field('Id', 'number'), field('Nom', 'shortText'), field('Jour', 'dateTime'), field('Actif', 'yesNo'), field('Note', 'shortText')];
const rows: SqlValue[][] = [
  [1, 'alpha', '2026-01-10 00:00:00', 1, null],
  [2, 'Beta', '2026-02-10 00:00:00', 0, 'x'],
  [3, 'gamma', '2026-03-10 00:00:00', 1, null],
  [4, 'Beta', '2026-04-10 00:00:00', 0, 'y'],
  [5, 'delta', '2026-05-10 00:00:00', 1, 'z'],
];
const base = { now: () => new Date(2026, 5, 1), locale: 'en-US' };

/** What FormRecords.find does over `rows` (from excluded, one direction, no wrap), then the move the view makes. */
async function search(where: string, record: SearchRecord, here: number | 'new'): Promise<number | null> {
  const test = rowTest(where, fields, base);
  const at = here === 'new' ? rows.length : here;
  const { from, dir } = searchStart(record, at, rows.length);
  for (let k = 0; k < rows.length; k++) {
    const i = dir === 'down' ? from + 1 + k : from - 1 - k;
    if (i < 0 || i >= rows.length) return null;
    if (await test(rows[i]!)) return i;
  }
  return null;
}

describe('SearchForRecord: the row test and the search window', () => {
  it('first and last', async () => {
    expect(await search('[Nom] = "Beta"', 'first', 4)).toBe(1);
    expect(await search('[Nom] = "Beta"', 'last', 0)).toBe(3);
  });
  it('next and previous from the middle', async () => {
    expect(await search('[Nom] = "Beta"', 'next', 1)).toBe(3);
    expect(await search('[Nom] = "Beta"', 'previous', 3)).toBe(1);
    expect(await search('[Actif] = True', 'next', 2)).toBe(4);
  });
  it('next from the last record and from a new record: no match', async () => {
    expect(await search('[Id] > 0', 'next', 4)).toBeNull();
    expect(await search('[Id] > 0', 'next', 'new')).toBeNull();
    expect(await search('[Id] > 0', 'previous', 0)).toBeNull();
  });
  it('previous from a new record starts at the last record', async () => {
    expect(await search('[Id] > 0', 'previous', 'new')).toBe(4);
  });
  it('no match at all', async () => {
    expect(await search('[Id] = 99', 'first', 0)).toBeNull();
    expect(await search('[Id] = 99', 'last', 0)).toBeNull();
  });
  it('a condition that does not parse, or names an unknown field, rejects before any search', () => {
    expect(() => rowTest('[Id] = = 3', fields, base)).toThrow();
    expect(() => rowTest('[Absent] = 3', fields, base)).toThrow(expect.objectContaining({ code: 'unknownField' }));
  });
  it('Is Null, a date, a Yes/No, text without case', async () => {
    expect(await search('[Note] Is Null', 'first', 0)).toBe(0);
    expect(await search('[Note] Is Null', 'next', 0)).toBe(2);
    expect(await search('[Note] Is Not Null', 'first', 0)).toBe(1);
    expect(await search('[Jour] > #2026-03-01#', 'first', 0)).toBe(2);
    expect(await search('[Jour] = #2026-04-10#', 'first', 0)).toBe(3);
    expect(await search('[Actif] = False', 'first', 0)).toBe(1);
    expect(await search('[Nom] = "BETA"', 'first', 0)).toBe(1);
    expect(await search('[Nom] = "GAMMA"', 'last', 0)).toBe(2);
  });
});
