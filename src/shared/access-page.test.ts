import { describe, expect, it } from 'vitest';
import { accessPage } from './access-page';
import { MAX_COLUMNS, readReport } from './report/model';

const mip = (v: number[]) => new Uint8Array(new Int32Array([...v, ...Array(14 - v.length).fill(0)]).buffer);
const dev = (orientation: number, paper: number) => { const b = new Uint8Array(64); new DataView(b.buffer).setInt16(44, orientation, true); new DataView(b.buffer).setInt16(46, paper, true); return b; };

describe('accessPage', () => {
  it('margins, orientation, paper', () => {
    expect(accessPage(mip([1440, 720, 1440, 720, 0, 0, 0, 1, 1]), dev(2, 1))).toEqual({ page: { orientation: 'landscape', paper: 'letter', margins: { left: 1440, top: 720, right: 1440, bottom: 720 } }, columns: { count: 1, spacing: 0, across: false } });
  });
  it('data only, columns across with an explicit size', () => {
    expect(accessPage(mip([567, 567, 567, 567, 1, 4000, 2000, 0, 3, 100, 200, 1953]), dev(1, 9)))
      .toEqual({ page: { orientation: 'portrait', paper: 'a4', margins: { left: 567, top: 567, right: 567, bottom: 567 }, dataOnly: true }, columns: { count: 3, spacing: 200, across: true, width: 4000, height: 2000, rowSpacing: 100 } });
  });
  it('no device mode: portrait A4; unknown paper: A4; absent or short PrtMip: null; a mad margin: null', () => {
    expect(accessPage(mip([567, 567, 567, 567, 0, 0, 0, 1, 1]), null)!.page).toMatchObject({ orientation: 'portrait', paper: 'a4' });
    expect(accessPage(mip([567, 567, 567, 567, 0, 0, 0, 1, 1]), dev(1, 9999))!.page.paper).toBe('a4');
    expect(accessPage(null, dev(2, 9))).toBeNull();
    expect(accessPage(new Uint8Array(10), null)).toBeNull();
    expect(accessPage(mip([-5, 567, 567, 567]), null)).toBeNull();
  });
  it('column count clamped; no explicit size with several columns when "same as detail"', () => {
    expect(accessPage(mip([567, 567, 567, 567, 0, 4000, 2000, 1, 99, 100, 200, 0]), null)!.columns).toEqual({ count: 10, spacing: 200, across: false, rowSpacing: 100 });
    expect(accessPage(mip([567, 567, 567, 567, 0, 0, 0, 1, 0]), null)!.columns.count).toBe(1);
  });
  it('every mapped paper', () => {
    const p = (n: number) => accessPage(mip([0, 0, 0, 0]), dev(1, n))!.page.paper;
    expect([5, 6, 7, 11, 13, 20, 27, 28, 31, 37, 70].map(p)).toEqual(['legal', 'statement', 'executive', 'a5', 'b5', 'env10', 'envDl', 'envC5', 'envC6', 'envMonarch', 'a6']);
  });
  it('edge inputs', () => {
    const base = [567, 567, 567, 567, 0, 0, 0, 1, 2];
    expect(accessPage(mip(base), new Uint8Array(47))!.page).toMatchObject({ orientation: 'portrait', paper: 'a4' });
    const plain = mip([1440, 720, 1440, 720, 1, 4000, 2000, 0, 3, 100, 200, 1953]);
    const buf = new Uint8Array(plain.length + 3 + 5); buf.set(plain, 3);
    expect(accessPage(new Uint8Array(buf.buffer, 3, plain.length), null)).toEqual(accessPage(plain, null));
    const cols = (n: number) => accessPage(mip([567, 567, 567, 567, 0, 0, 0, 1, n]), null)!.columns.count;
    expect([0, -1, 2147483647].map(cols)).toEqual([1, 1, MAX_COLUMNS]);
    expect(accessPage(mip([5671, 567, 567, 567]), null)).toBeNull();
    for (const [sp, row] of [[-100, -100], [2147483647, 2147483647], [-1, 2147483647]]) {
      const r = accessPage(mip([567, 567, 567, 567, 0, 0, 0, 1, 2, row!, sp!, 0]), null)!;
      const spec = readReport({ formatVersion: '1.0', recordSource: null, props: { pageSetup: r.page, columns: r.columns }, sections: [] }, []);
      expect(spec.page).toEqual(r.page);
      expect(spec.columns).toEqual(r.columns);
    }
  });
});
