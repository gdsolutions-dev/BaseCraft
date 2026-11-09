// charts.data: the grouped rows of a chart. The SQL comes only from buildChartQuery (a query tree, fields looked up in the
// source); it runs through pageSource, so the parser, binder, authorizer and snapshot rules apply and nothing is written.
import type { CellInput } from '../shared/coerce';
import { buildChartQuery, CHART_MAX_POINTS, type ChartData, type ChartDataRequest } from '../shared/chart/query';
import type { RecordSourceRef, SourceInfo, SourcePage, SourcePageRequest } from '../shared/record-source';

interface Reader {
  describeSource(ref: RecordSourceRef, params?: Record<string, CellInput>): Promise<SourceInfo>;
  pageSource(ref: RecordSourceRef, req: SourcePageRequest): Promise<SourcePage>;
}

export async function chartData(s: Reader, req: ChartDataRequest): Promise<ChartData> {
  const { fields } = await s.describeSource(req.source, req.params);
  const { sql, columns } = buildChartQuery(req.spec, req.source, fields, req.link && { fields: req.link.fields });
  // The link values are the declared parameters link0, link1...; they come last so a document parameter cannot shadow them.
  const params: Record<string, CellInput> = { ...req.params };
  (req.link?.values ?? []).forEach((v, i) => { params[`link${i}`] = v; });
  const page = await s.pageSource({ kind: 'sql', sql }, { offset: 0, limit: CHART_MAX_POINTS + 1, count: false, params });
  return { columns, rows: page.rows.slice(0, CHART_MAX_POINTS), truncated: page.rows.length > CHART_MAX_POINTS };
}
