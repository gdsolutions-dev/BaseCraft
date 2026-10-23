import type { RowPage } from '../../shared/api';
import { MAX_LOADED_ROWS, PageCache } from './page-cache';

const flush = () => new Promise((r) => setTimeout(r, 0));
const rows = (offset: number, n: number, tag = '') =>
  ({ rows: Array.from({ length: n }, (_, i) => ({ rowid: offset + i + 1, values: [`${tag}${offset + i}`] })) });

describe('PageCache', () => {
  it('page cache fetches each page once and refetches after invalidate', async () => {
    const fetch = vi.fn().mockResolvedValue({ rows: [] }); const c = new PageCache(fetch);
    c.get(0); c.get(150); await flush(); expect(fetch).toHaveBeenCalledTimes(1); expect(fetch).toHaveBeenCalledWith(0, 200);
    c.invalidate(); c.get(0); await flush(); expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('serves loaded rows and tells when a page arrives', async () => {
    const fetch = vi.fn((o: number, n: number) => Promise.resolve(rows(o, n)));
    const c = new PageCache(fetch, 10);
    const loaded = vi.fn();
    c.onLoaded(loaded);
    expect(c.get(12)).toBeUndefined();
    await flush();
    expect(fetch).toHaveBeenCalledWith(10, 10);
    expect(loaded).toHaveBeenCalledTimes(1);
    expect(c.get(12)).toEqual({ rowid: 13, values: ['12'] });
  });

  it('ensure loads the pages of a range, four at a time, without reading a page twice', async () => {
    let running = 0, peak = 0;
    const fetch = vi.fn(async (o: number, n: number) => { peak = Math.max(peak, ++running); await flush(); running--; return rows(o, n); });
    const c = new PageCache(fetch, 10);
    c.get(0); // page 0 already in flight
    await c.ensure(0, 119);
    expect(fetch).toHaveBeenCalledTimes(12);
    expect(peak).toBeLessThanOrEqual(5); // four of ensure + the page read by get
    expect(c.get(115)).toEqual({ rowid: 116, values: ['115'] });
    await c.ensure(0, 119);
    expect(fetch).toHaveBeenCalledTimes(12);
  });

  it('ensure (Find, Select All) loads at most MAX_LOADED_ROWS rows and tells when it stopped there', async () => {
    expect(MAX_LOADED_ROWS).toBe(100_000);
    let end = 0;
    const fetch = vi.fn(async (o: number, n: number) => { end = Math.max(end, o + n); return { rows: [] }; });
    const c = new PageCache(fetch, 1000);
    expect(await c.ensure(0, 99_999)).toBe(false);
    expect(await c.ensure(0, 249_999)).toBe(true);
    expect(end).toBe(MAX_LOADED_ROWS);
    expect(fetch).toHaveBeenCalledTimes(100);
    expect(await c.ensure(150_000, 160_000)).toBe(true); // wholly beyond: nothing read
    expect(fetch).toHaveBeenCalledTimes(100);
  });

  it('ensure ends when a page fails', async () => {
    const c = new PageCache(() => Promise.reject(new Error('x')), 10);
    c.onError(() => {});
    await c.ensure(0, 25);
    expect(c.get(5)).toBeUndefined();
  });

  it('keeps showing the previous rows while it reloads', async () => {
    let tag = 'a';
    const c = new PageCache((o, n) => Promise.resolve(rows(o, n, tag)), 10);
    c.get(0); await flush();
    tag = 'b';
    expect(c.fresh(3)).toBe(true);
    c.invalidate();
    expect(c.get(3)).toEqual({ rowid: 4, values: ['a3'] });
    expect(c.fresh(3)).toBe(false); // shown, but not to be edited: the index may now hold another record
    await flush();
    expect(c.get(3)).toEqual({ rowid: 4, values: ['b3'] });
    expect(c.fresh(3)).toBe(true);
  });

  it('a reply to a request made before invalidate is dropped', async () => {
    let resolve!: (p: RowPage) => void;
    const fetch = vi.fn().mockImplementationOnce(() => new Promise((r) => { resolve = r; })).mockResolvedValue(rows(0, 5, 'new'));
    const c = new PageCache(fetch, 10);
    c.get(0);
    c.invalidate();
    c.get(0);
    await flush();
    resolve(rows(0, 5, 'old'));
    await flush();
    expect(c.get(0)?.values).toEqual(['new0']);
  });

  it('set patches a row; a page still loading is read again', async () => {
    const replies: ((p: RowPage) => void)[] = [];
    const fetch = vi.fn(() => new Promise<RowPage>((r) => replies.push(r)));
    const c = new PageCache(fetch, 10);
    c.set(2, { rowid: 3, values: ['patched'] }); // not loaded: shown until the page arrives
    expect(c.get(2)).toEqual({ rowid: 3, values: ['patched'] });
    expect(fetch).toHaveBeenCalledTimes(1);
    c.set(2, { rowid: 3, values: ['again'] }); // the request in flight may predate the write
    replies[0](rows(0, 5, 'stale'));
    await flush();
    expect(fetch).toHaveBeenCalledTimes(2);
    replies[1](rows(0, 5, 'fresh'));
    await flush();
    expect(c.get(2)?.values).toEqual(['fresh2']);
    c.set(2, { rowid: 3, values: ['x'] });
    expect(c.get(2)?.values).toEqual(['x']);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('a failed page is reported once and not retried until invalidate', async () => {
    const fetch = vi.fn().mockRejectedValueOnce(new Error('bc:unsupportedTable')).mockResolvedValue(rows(0, 1));
    const c = new PageCache(fetch, 10);
    const err = vi.fn();
    c.onError(err);
    c.get(0); await flush();
    c.get(0); await flush();
    expect(err).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledTimes(1);
    c.invalidate(); c.get(0); await flush();
    expect(c.get(0)).toEqual({ rowid: 1, values: ['0'] });
  });
});
