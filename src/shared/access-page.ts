// Page setup of an Access report from its PrtMip (margins, columns) and PrtDevMode (orientation, paper) blocks, batch E4. Pure module.
import { DEFAULT_PAGE_SETUP, MAX_COLUMNS, type ColumnSetup, type PageSetup, type PaperId } from './report/model';
import { MAX_TWIPS } from './field-types';

// Windows DMPAPER_* numbers; anything else is A4.
const PAPER = new Map<number, PaperId>([[1, 'letter'], [5, 'legal'], [6, 'statement'], [7, 'executive'], [9, 'a4'], [11, 'a5'], [13, 'b5'], [20, 'env10'],
  [27, 'envDl'], [28, 'envC5'], [31, 'envC6'], [37, 'envMonarch'], [70, 'a6']]);
const ACROSS_THEN_DOWN = 1953;

/** `mip`: the bytes of PrtMip; `devMode`: the bytes of PrtDevMode (ANSI DEVMODE). null when `mip` is absent or shorter than 48 bytes.
 *  Reads numbers only: never the device name. */
export function accessPage(mip: Uint8Array | null, devMode: Uint8Array | null): { page: PageSetup; columns: ColumnSetup } | null {
  if (!mip || mip.length < 48) return null;
  const m = new DataView(mip.buffer, mip.byteOffset, mip.byteLength);
  const i = (o: number) => m.getInt32(o, true);
  const [left, top, right, bottom] = [0, 4, 8, 12].map(i) as [number, number, number, number];
  if (![left, top, right, bottom].every((v) => v >= 0 && v <= 5670)) return null;
  let orientation: PageSetup['orientation'] = DEFAULT_PAGE_SETUP.orientation, paper: PaperId = DEFAULT_PAGE_SETUP.paper;
  if (devMode && devMode.length >= 48) {
    const d = new DataView(devMode.buffer, devMode.byteOffset, devMode.byteLength);
    if (d.getInt16(44, true) === 2) orientation = 'landscape';
    paper = PAPER.get(d.getInt16(46, true)) ?? paper;
  }
  const page: PageSetup = { orientation, paper, margins: { left, top, right, bottom }, ...(i(16) !== 0 ? { dataOnly: true as const } : {}) };
  const count = Math.min(MAX_COLUMNS, Math.max(1, i(32)));
  const columns: ColumnSetup = { count, spacing: Math.min(5670, Math.max(0, i(40))), across: i(44) === ACROSS_THEN_DOWN };
  const size = (k: 'width' | 'height' | 'rowSpacing', v: number) => { if (v >= 1) columns[k] = Math.min(MAX_TWIPS, v); };
  if (count > 1) {
    if (i(28) === 0) { size('width', i(20)); size('height', i(24)); }
    size('rowSpacing', i(36));
  }
  return { page, columns };
}
