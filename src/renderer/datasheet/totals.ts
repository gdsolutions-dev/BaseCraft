// Totals row of a datasheet (Home › Records › Totals): each column's function, its value over the rows, and where the row's
// cells sit under the grid's columns. Pure.
import type { FieldType } from '../../shared/field-types';
import { TOTAL_FNS, type TotalFn } from '../../shared/sheet-layout';

export { TOTAL_FNS, type TotalFn };
/** The functions' names: the report totals' ones (i18n `report.totals.*`). */
export const TOTAL_LABEL: Record<TotalFn, string> = { sum: 'Sum', avg: 'Avg', count: 'Count', max: 'Max', min: 'Min', stdev: 'StDev', var: 'Var' };

/** The functions a column offers, as Access: all of them for a number, Count, Maximum and Minimum for a date, Count for the
 *  others (a Lookup field shows a list's text, not its number: Count). */
export function totalFnsFor(type: FieldType, lookup: boolean): TotalFn[] {
  if (lookup) return ['count'];
  if (type === 'number' || type === 'currency' || type === 'autoNumber') return [...TOTAL_FNS];
  return type === 'dateTime' ? ['count', 'max', 'min'] : ['count'];
}

/** The function over the non-null values; null when it has no value (no row; one row for StDev and Var, of a sample as Access's). */
export function totalOf(fn: TotalFn, values: readonly unknown[]): number | string | null {
  const got = values.filter((v) => v !== null && v !== undefined);
  if (fn === 'count') return got.length;
  if (!got.length) return null;
  if (fn === 'max' || fn === 'min') {
    return got.reduce((a, b) => ((fn === 'max' ? b! > a! : b! < a!) ? b : a)) as number | string;
  }
  const nums = got.map(Number).filter((n) => Number.isFinite(n));
  if (!nums.length) return null;
  const sum = nums.reduce((a, b) => a + b, 0);
  if (fn === 'sum') return sum;
  const mean = sum / nums.length;
  if (fn === 'avg') return mean;
  if (nums.length < 2) return null;
  const variance = nums.reduce((a, b) => a + (b - mean) ** 2, 0) / (nums.length - 1);
  return fn === 'var' ? variance : Math.sqrt(variance);
}

/** Left edge and width of each grid column in the totals row (null: scrolled out of view). The frozen columns stay at the
 *  left; the others start at the first one the grid shows (`first`), shifted by its scroll offset `tx` (≤ 0). */
export function totalsLayout(widths: readonly number[], frozen: number, first: number, tx: number, marker: number): ({ left: number; width: number } | null)[] {
  const out: ({ left: number; width: number } | null)[] = [];
  let x = marker;
  for (let c = 0; c < frozen && c < widths.length; c++) { out.push({ left: x, width: widths[c]! }); x += widths[c]!; }
  const start = Math.max(first, frozen);
  for (let c = frozen; c < start && c < widths.length; c++) out.push(null);
  x += tx;
  for (let c = start; c < widths.length; c++) { out.push({ left: x, width: widths[c]! }); x += widths[c]!; }
  return out;
}
