// The layout of a table or query datasheet kept with it (Access keeps it): row height, frozen fields, display order, totals
// row and functions, font, colours, gridlines and per-field alignment. Column widths and hidden fields have their own place
// (widths, 0 = hidden). Stored as one JSON object; `parseSheetLayout` is the one reader and writer-side check: whatever is
// invalid is left out, so an old, damaged or newer layout opens as far as it can be read.

export const TOTAL_FNS = ['sum', 'avg', 'count', 'max', 'min', 'stdev', 'var'] as const;
export type TotalFn = typeof TOTAL_FNS[number];
export type SheetAlign = 'left' | 'center' | 'right';

export interface SheetLayout {
  /** row height, px */ rowHeight?: number;
  /** frozen fields, in order */ frozen?: string[];
  /** display order of the fields (Unfreeze leaves the formerly frozen ones first) */ order?: string[];
  totals?: boolean; /** each field's totals function */ totalFns?: Record<string, TotalFn>;
  fontSize?: number; bold?: boolean; italic?: boolean; underline?: boolean; font?: string;
  textColor?: string; backColor?: string; gridColor?: string; gridlines?: { horizontal: boolean; vertical: boolean };
  aligns?: Record<string, SheetAlign>;
}

const MAX_NAMES = 1024, MAX_NAME = 255;
const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const name = (v: unknown): v is string => typeof v === 'string' && v.length > 0 && v.length <= MAX_NAME;
const names = (v: unknown): string[] | undefined => (Array.isArray(v) ? v.filter(name).slice(0, MAX_NAMES) : undefined);
const color = (v: unknown): v is string => typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v);
/** The entries of an object whose key is a name and whose value `ok` accepts (own keys only: a field may be named "__proto__"). */
const entries = <T>(v: unknown, ok: (x: unknown) => x is T): Record<string, T> | undefined =>
  (isObject(v) ? Object.fromEntries(Object.entries(v).filter(([k, x]) => name(k) && ok(x)).slice(0, MAX_NAMES)) as Record<string, T> : undefined);

export function parseSheetLayout(v: unknown): SheetLayout {
  const out: SheetLayout = {};
  if (!isObject(v)) return out;
  if (typeof v.rowHeight === 'number' && Number.isInteger(v.rowHeight) && v.rowHeight >= 12 && v.rowHeight <= 400) out.rowHeight = v.rowHeight;
  const frozen = names(v.frozen), order = names(v.order);
  if (frozen?.length) out.frozen = frozen;
  if (order?.length) out.order = order;
  if (v.totals === true) out.totals = true;
  const totalFns = entries(v.totalFns, (x): x is TotalFn => (TOTAL_FNS as readonly unknown[]).includes(x));
  if (totalFns && Object.keys(totalFns).length) out.totalFns = totalFns;
  if (typeof v.fontSize === 'number' && v.fontSize >= 6 && v.fontSize <= 72) out.fontSize = v.fontSize;
  for (const k of ['bold', 'italic', 'underline'] as const) if (typeof v[k] === 'boolean') out[k] = v[k];
  if (typeof v.font === 'string' && v.font.length > 0 && v.font.length <= 100) out.font = v.font;
  for (const k of ['textColor', 'backColor', 'gridColor'] as const) if (color(v[k])) out[k] = v[k].toLowerCase();
  if (isObject(v.gridlines) && typeof v.gridlines.horizontal === 'boolean' && typeof v.gridlines.vertical === 'boolean') out.gridlines = { horizontal: v.gridlines.horizontal, vertical: v.gridlines.vertical };
  const aligns = entries(v.aligns, (x): x is SheetAlign => x === 'left' || x === 'center' || x === 'right');
  if (aligns && Object.keys(aligns).length) out.aligns = aligns;
  return out;
}
