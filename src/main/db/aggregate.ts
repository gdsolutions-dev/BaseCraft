// Totals of a datasheet column over every row (Home › Records › Totals), computed by SQLite: the select list for a set of
// (column, function) pairs and the values read back. SQLite has no STDEV or VAR: they come from SUM(x), SUM(x*x) and COUNT(x).
import type { DatabaseSync } from 'node:sqlite';
import type { TotalFn } from '../../shared/sheet-layout';

export interface AggregateSpec { /** quoted SQL column */ col: string; fn: TotalFn; /** a number: compared and summed as REAL (a Decimal is stored as text) */ numeric: boolean }

/** The select list: one expression per pair, three for StDev and Var. */
export function aggregateSelect(specs: readonly AggregateSpec[]): string {
  return specs.flatMap(({ col, fn, numeric }) => {
    const x = `CAST(${col} AS REAL)`;
    switch (fn) {
      case 'count': return [`count(${col})`];
      case 'max': case 'min': return [`${fn}(${numeric ? x : col})`];
      case 'stdev': case 'var': return [`sum(${x})`, `sum(${x} * ${x})`, `count(${col})`];
      default: return [`${fn}(${x})`]; // sum, avg
    }
  }).join(', ');
}

/** `SELECT <the select list> FROM <from>` (a table with its WHERE, or a derived table) read as one row, then its values. */
export function aggregateRun(db: DatabaseSync, specs: readonly AggregateSpec[], from: string, params: readonly unknown[] = []): (number | string | null)[] {
  const stmt = db.prepare(`SELECT ${aggregateSelect(specs)} FROM ${from}`);
  stmt.setReturnArrays(true);
  return aggregateValues(specs, stmt.get(...(params as never[])) as unknown as unknown[]);
}

/** The values of a row of `aggregateSelect`'s result, one per pair; null when the function has no value (no row; one row for
 *  StDev and Var, of a sample as Access's). */
export function aggregateValues(specs: readonly AggregateSpec[], row: readonly unknown[]): (number | string | null)[] {
  let at = 0;
  return specs.map(({ fn }) => {
    if (fn !== 'stdev' && fn !== 'var') {
      const v = row[at++];
      return typeof v === 'bigint' ? Number(v) : (v as number | string | null);
    }
    const [sum, sq, n] = [Number(row[at]), Number(row[at + 1]), Number(row[at + 2])];
    at += 3;
    if (!(n > 1)) return null;
    const variance = Math.max(0, (sq - sum * sum / n) / (n - 1)); // ponytail: one pass, not the two-pass sum of squared deviations: loses digits when the mean dwarfs the spread
    return fn === 'var' ? variance : Math.sqrt(variance);
  });
}
