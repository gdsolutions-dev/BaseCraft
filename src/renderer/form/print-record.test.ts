import { expect, it } from 'vitest';
import { MAX_PRINT_RECORDS, PRINT_ALL, printAllRows, refuseDatasheet, withPrintMarks, type Marked } from './print-record';

/** A stand-in for an element: just the marks. */
function fake(): Marked & { marks: () => string[] } {
  const set = new Set<string>();
  return {
    classList: { add: (c: string) => set.add(c), remove: (c: string) => set.delete(c) } as unknown as DOMTokenList,
    setAttribute: (a: string) => { set.add(`@${a}`); }, removeAttribute: (a: string) => { set.delete(`@${a}`); },
    marks: () => [...set],
  };
}

it('removes both marks when the print rejects', async () => {
  const html = fake(), el = fake();
  await expect(withPrintMarks(el, () => Promise.reject(new Error('bc:printFailed')), html)).rejects.toThrow('bc:printFailed');
  expect([html.marks(), el.marks()]).toEqual([[], []]);
});

it('refuses a second call while one is pending, leaving the first marks alone', async () => {
  const html = fake(), el = fake();
  let done!: () => void;
  const first = withPrintMarks(el, () => new Promise<void>((r) => { done = r; }), html);
  expect([html.marks(), el.marks()]).toEqual([['bc-print-record'], ['@data-print-record']]);
  const html2 = fake(), el2 = fake();
  await expect(withPrintMarks(el2, async () => undefined, html2)).rejects.toThrow('bc:commandUnavailable');
  expect([html.marks(), el.marks(), html2.marks(), el2.marks()]).toEqual([['bc-print-record'], ['@data-print-record'], [], []]);
  done();
  await first;
  expect([html.marks(), el.marks()]).toEqual([[], []]);
  await withPrintMarks(el, async () => undefined, html);   // free again
});

it('refuses the datasheet view, not the others', () => {
  expect(() => refuseDatasheet('datasheet')).toThrow('bc:commandUnavailable');
  expect(() => refuseDatasheet('single')).not.toThrow();
  expect(() => refuseDatasheet('continuous')).not.toThrow();
});

it('lists every record index to print, none for an empty set, and refuses more than the ceiling before anything is rendered', () => {
  expect(printAllRows(0)).toEqual([]);
  expect(printAllRows(3)).toEqual([0, 1, 2]);
  expect(printAllRows(MAX_PRINT_RECORDS)).toHaveLength(MAX_PRINT_RECORDS);
  expect(() => printAllRows(MAX_PRINT_RECORDS + 1)).toThrow('bc:commandUnavailable');
});

it('marks the form with the all-records value when asked, with the empty one otherwise', async () => {
  const seen: [string, string][] = [];
  const el = { ...fake(), setAttribute: (a: string, v: string) => { seen.push([a, v]); } };
  await withPrintMarks(el, async () => undefined, fake());
  await withPrintMarks(el, async () => undefined, fake(), PRINT_ALL);
  expect(seen).toEqual([['data-print-record', ''], ['data-print-record', 'all']]);
});
