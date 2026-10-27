// Crosstab execution (B4 R9–R11): the headings of a bound crosstab, then the crosstab bound again as its rewritten SELECT.
import type { DatabaseSync } from 'node:sqlite';
import type { SqlValue } from '../../shared/coerce';
import { fromStored } from '../../shared/expr/evaluate';
import type { LocaleInfo } from '../../shared/locale-format';
import { bindQuery, QueryBindError, type BoundQuery } from '../../shared/query/bind';
import { headingsOf, inHeadings, MAX_PIVOT_COLUMNS, pivotValuesQuery } from '../../shared/query/crosstab';
import { compile, queryCatalog, run } from './source';

/** The crosstab bound as its rewritten SELECT: headings from IN, or from running pivotValuesQuery with `values`. */
export function expandCrosstab(db: DatabaseSync, b: BoundQuery, values: Record<string, SqlValue>, info: LocaleInfo): BoundQuery {
  if (!b.crosstab) return b;
  const q = b.crosstab.source, x = q.body;
  if (x.k !== 'crosstab') throw new Error('bc:invalidArgument');
  const catalog = queryCatalog(db);
  if (b.crosstab.headings === 'fixed') return bindQuery(q, catalog, undefined, inHeadings(x, info));
  // the distinct pivot values of the rows WHERE keeps, with the same parameter values as the cells
  const pb = bindQuery({ params: q.params, body: pivotValuesQuery(x) }, catalog);
  const c = compile(pb, values, info);
  const col = pb.columns[0];
  const rows = run(db, `SELECT "c0" FROM (${c.sql}) LIMIT ${MAX_PIVOT_COLUMNS + 1}`, c.params);
  if (rows.length > MAX_PIVOT_COLUMNS) { // R10, before the main query runs: the count only for the message
    const count = Number(run(db, `SELECT count(*) FROM (${c.sql})`, c.params)[0][0]);
    throw new QueryBindError('tooManyColumns', String(b.columns.length + count));
  }
  const found = rows.map((r) => fromStored({ name: col.name, props: col.props }, r[0]));
  return bindQuery(q, catalog, undefined, headingsOf(found, info));
}
