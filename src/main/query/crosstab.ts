// Crosstab execution (B4 R9–R11): the headings of a bound crosstab, then the crosstab bound again as its rewritten SELECT.
import type { SqlValue } from '../../shared/coerce';
import { fromStored } from '../../shared/expr/evaluate';
import { foldName } from '../../shared/field-types';
import type { LocaleInfo } from '../../shared/locale-format';
import type { RemoteCtx } from '../connectors/remote-data';
import { bindQuery, QueryBindError, type BoundQuery } from '../../shared/query/bind';
import { headingsOf, inHeadings, MAX_PIVOT_COLUMNS, pivotValuesQuery } from '../../shared/query/crosstab';
import type { ReadRequest } from '../connectors/connector';
import { compile, queryConn, run, type QueryDb } from './source';

/** The crosstab bound as its rewritten SELECT: headings from IN, or from running pivotValuesQuery with `values` (on its source). */
export function expandCrosstab(at: QueryDb, b: BoundQuery, values: Record<string, SqlValue>, info: LocaleInfo): BoundQuery {
  if (!b.crosstab) return b;
  const q = b.crosstab.source, x = q.body;
  if (x.k !== 'crosstab') throw new Error('bc:invalidArgument');
  const { catalog, dbOf } = queryConn(at);
  if (b.crosstab.headings === 'fixed') return bindQuery(q, catalog, undefined, inHeadings(x, info));
  // the distinct pivot values of the rows WHERE keeps, with the same parameter values as the cells
  const pb = bindQuery({ params: q.params, body: pivotValuesQuery(x) }, catalog);
  const c = compile(pb, values, info);
  const db = dbOf(pb.source, false);
  const col = pb.columns[0];
  const rows = run(db, `SELECT "c0" FROM (${c.sql}) LIMIT ${MAX_PIVOT_COLUMNS + 1}`, c.params);
  if (rows.length > MAX_PIVOT_COLUMNS) { // R10, before the main query runs: the count only for the message
    const count = Number(run(db, `SELECT count(*) FROM (${c.sql})`, c.params)[0][0]);
    throw new QueryBindError('tooManyColumns', String(b.columns.length + count));
  }
  const found = rows.map((r) => fromStored({ name: col.name, props: col.props }, r[0]));
  return bindQuery(q, catalog, undefined, headingsOf(found, info));
}

/** C7 R15: the same on a server source. Fixed IN headings need no read; otherwise pivotValuesQuery is planned by the connector and read
 *  (MAX_PIVOT_COLUMNS + 1 rows, the count only for the message), the values deduplicated as Access compares text (without case, with
 *  accents: PostgreSQL's DISTINCT keeps "Lyon" and "LYON" apart), the first spelling in the server's order kept. The crosstab is then
 *  bound with those headings; the connector plans it as its rewritten SELECT.
 *  ponytail: more than MAX_PIVOT_COLUMNS rows read is refused before deduplication, so 255 spellings of fewer headings are refused too. */
export async function remoteExpandCrosstab(ctx: RemoteCtx, b: BoundQuery, values: Record<string, SqlValue>): Promise<BoundQuery> {
  if (!b.crosstab) return b;
  const q = b.crosstab.source, x = q.body;
  const server = ctx.qc.remote?.(b.source);
  if (x.k !== 'crosstab' || !server) throw new Error('bc:invalidArgument');
  const { catalog } = ctx.qc;
  const expanded = (e: BoundQuery): BoundQuery => ({ ...e, crosstab: { ...e.crosstab!, expanded: true } });
  if (b.crosstab.headings === 'fixed') return expanded(bindQuery(q, catalog, undefined, inHeadings(x, ctx.info)));
  const pb = bindQuery({ params: q.params, body: pivotValuesQuery(x) }, catalog);
  const col = pb.columns[0];
  const read: ReadRequest = { query: pb, values, filter: [], sort: [], refs: false, tables: (n) => server.table(n), now: ctx.now() };
  const rows = await ctx.remote.run(b.source, async (c) => {
    const plan = c.plan(read);
    const page = (await c.rows(plan, 0, MAX_PIVOT_COLUMNS + 1)).rows;
    if (page.length > MAX_PIVOT_COLUMNS) throw new QueryBindError('tooManyColumns', String(b.columns.length + await c.count(plan))); // R10
    return page;
  }, true);
  const seen = new Set<string>();
  const found = rows.map((r) => fromStored({ name: col.name, props: col.props }, r[0])).filter((v) => {
    const key = v === null ? 'null' : v.t === 'str' ? `s${foldName(v.v)}` : `${v.t}${'v' in v ? String(v.v) : ''}`;
    return !seen.has(key) && !!seen.add(key);
  });
  return expanded(bindQuery(q, catalog, undefined, headingsOf(found, ctx.info)));
}
