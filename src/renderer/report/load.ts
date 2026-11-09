// Chargement d'un état enregistré (définition, données, mise en page), pour l'aperçu, l'impression et l'export PDF ; zoom.
import { MAX_PRINT_HTML_CHARS, type BasecraftApi, type CellInput, type PrintRequest, type RecordSourceRef } from '../../shared/api';
import { validateDesignDoc, type DesignDoc } from '../../shared/design/model';
import { DEFAULT_THEME, effectiveTheme } from '../../shared/design/theme';
import type { SourceInfo } from '../../shared/record-source';
import { layoutReport } from '../../shared/report/layout';
import { usedResourceNames, type ResourceMap } from '../../shared/pictures';
import { chartRequest, type ChartData, type ChartDataMap } from '../../shared/chart/query';
import { readChartSpec } from '../../shared/chart/spec';
import { readReport } from '../../shared/report/model';
import { renderDocumentHtml } from '../../shared/report/render';
import { ReportLoadError, type LaidOutReport, type LayoutEnv, type ReportData } from '../../shared/report/types';
import type { ReportEvents } from './report-events';

/** Rows per sources.page call: main's cap (MAX_PAGE_ROWS); 500 at a time made 200,000 rows 400 round trips (7 s). */
export const DATA_PAGE = 10_000;

const aborted = () => Object.assign(new Error('Report loading aborted'), { name: 'AbortError' });
/** On Open or On No Data cancelled: an AbortError (print and export stop silently) that OpenReport tells apart by its message. */
export const reportCancelled = () => Object.assign(new Error('bc:actionCancelled'), { name: 'AbortError' });

/** Every row of the source, read DATA_PAGE at a time up to `total`; rejects with name 'AbortError' once `signal` is aborted.
 *  `where`: the opening's Where Condition (OpenReport, R8): only the rows it keeps. `max`: at most that many rows (Layout view). */
export async function loadReportData(api: Pick<BasecraftApi, 'sources'>, ref: RecordSourceRef, params?: Record<string, CellInput>,
  signal?: AbortSignal, where?: string, max = Infinity): Promise<ReportData> {
  const { fields } = await api.sources.describe(ref);
  const rows: ReportData['rows'] = [];
  for (let offset = 0; ; offset += DATA_PAGE) {
    if (signal?.aborted) throw aborted();
    const p = await api.sources.page(ref, { offset, limit: Math.min(DATA_PAGE, max - offset), ...(params ? { params } : {}), ...(where !== undefined ? { where } : {}), ...(offset === 0 ? { fresh: true } : {}) });
    if (signal?.aborted) throw aborted();
    rows.push(...p.rows);
    if (rows.length > max) rows.length = max;
    if (!p.rows.length || offset + DATA_PAGE >= p.total || rows.length >= max) return { fields, rows };
  }
}

export { ReportLoadError };

/** Steps 1 and 2: the saved definition, checked. objects.get's rejections (bc:notFound, bc:corruptObject…) pass through. */
export async function loadReportDoc(api: Pick<BasecraftApi, 'objects'>, name: string): Promise<DesignDoc> {
  const def = (await api.objects.get('report', name)).definition;
  const errors = validateDesignDoc(def);
  if (errors.length) throw new ReportLoadError('invalidDefinition', errors);
  return def as DesignDoc;
}

/** Les images partagées que le document utilise ({} s'il n'en utilise aucune ; un appel refusé se lit {}). */
export async function loadDocResources(api: Pick<BasecraftApi, 'resources'>, doc: DesignDoc): Promise<ResourceMap> {
  const names = usedResourceNames(doc);
  if (!names.length) return {};
  try { return await api.resources.get(names); } catch { return {}; }
}

/** Les données de chaque graphique du document, par nom de contrôle : un appel `charts.data` par graphique dont la demande n'est pas
 *  nulle ({} s'il n'y en a pas ; un appel refusé laisse ce graphique sans données, il se dessine vide). */
export async function loadDocCharts(api: Pick<BasecraftApi, 'charts'>, doc: DesignDoc, params?: Record<string, CellInput>, cache?: Map<string, Promise<ChartData | null>>): Promise<ChartDataMap> {
  const found: { name: string; props: Record<string, unknown> }[] = [];
  const walk = (list: unknown): void => {
    if (!Array.isArray(list)) return;
    for (const c of list as { kind?: unknown; name?: unknown; props?: unknown; children?: unknown }[]) {
      if (c?.kind === 'chart' && typeof c.name === 'string') found.push({ name: c.name, props: (c.props ?? {}) as Record<string, unknown> });
      walk(c?.children);
    }
  };
  for (const s of doc.sections ?? []) walk((s as { controls?: unknown }).controls);
  const out: Record<string, ChartData> = {};
  await Promise.all(found.map(async ({ name, props }) => {
    const req = chartRequest(readChartSpec(props), doc.recordSource ?? null, params);
    if (!req) return;
    // `cache` (mode Page : une remise en page à chaque modification) : une demande identique ne rappelle pas charts.data
    const key = JSON.stringify(req);
    let p = cache?.get(key);
    if (!p) { p = api.charts.data(req).catch(() => null); cache?.set(key, p); }
    const got = await p;
    if (got) out[name] = got;
  }));
  return out;
}

/** « Entrer une valeur de paramètre » (promptParameters, C3): the values typed, null on Cancel. */
export type AskParameters = (params: SourceInfo['parameters']) => Promise<Record<string, CellInput> | null>;

/** The values of the record source's parameters (a PARAMETERS clause, or a parameterized query), asked before any row is read;
 *  undefined when it has none. Cancel rejects with name 'AbortError': the caller stops without a message. */
export async function docParameters(api: Pick<BasecraftApi, 'sources'>, doc: DesignDoc, ask: AskParameters): Promise<Record<string, CellInput> | undefined> {
  if (!doc.recordSource) return undefined;
  const { parameters } = await api.sources.describe(doc.recordSource);
  if (!parameters.length) return undefined;
  const values = await ask(parameters);
  if (values === null) throw aborted();
  return values;
}

/** Step 3: every row of the record source (none without one), with the parameter values (docParameters) and the Where
 *  Condition on every page read; `max`: at most that many rows. */
export async function loadDocData(api: Pick<BasecraftApi, 'sources'>, doc: DesignDoc, params?: Record<string, CellInput>, signal?: AbortSignal,
  where?: string, max?: number): Promise<ReportData> {
  if (!doc.recordSource) return { fields: [], rows: [] };
  return loadReportData(api, doc.recordSource, params, signal, where, max);
}

/** Steps 1 to 5 for a report that is not open (the Navigation Pane's Print and Export items); rejects with the step's bc: code.
 *  `ready`: the parameters are asked, the long part begins (the progress box). `events`: the report's events (On Open before
 *  the parameters, On No Data, On Format / On Print); one cancelling rejects with reportCancelled(). */
export async function layoutSavedReport(api: Pick<BasecraftApi, 'objects' | 'sources'> & { charts?: Pick<BasecraftApi['charts'], 'data'>; resources?: Pick<BasecraftApi['resources'], 'get'>; theme?: Pick<BasecraftApi['theme'], 'get'> }, name: string, env: LayoutEnv, ask: AskParameters, signal?: AbortSignal,
  ready?: () => void, where?: string, events?: (doc: DesignDoc) => ReportEvents): Promise<LaidOutReport> {
  const doc = await loadReportDoc(api, name);
  const ev = events?.(doc), release = ev?.register();
  try {
    if (await ev?.open()) throw reportCancelled();
    const params = await docParameters(api, doc, ask);
    // ponytail: a report with On No Data / On Format / On Print macros shows no progress box (their message boxes would wait
    // behind it: one dialog queue), so it cannot be cancelled while laid out; a box that steps aside for them when that matters
    if (!ev?.layoutMacros) ready?.();
    const data = await loadDocData(api, doc, params, signal, where);
    if (!data.rows.length && await ev?.noData()) throw reportCancelled();
    const theme = effectiveTheme(doc.props, await api.theme?.get().catch(() => DEFAULT_THEME) ?? DEFAULT_THEME);
    const resources = api.resources ? await loadDocResources({ resources: api.resources } as Pick<BasecraftApi, 'resources'>, doc) : {};
    const charts = api.charts ? await loadDocCharts({ charts: api.charts }, doc, params) : {};
    return await layoutReport(readReport(doc, data.fields, { theme, resources, charts, ...(env.chartLabels ? { chartLabels: env.chartLabels } : {}) }), data, { ...env, signal, ...(ev ? { hooks: ev.hooks } : {}) });
  } finally { release?.(); }
}

/** What print and export send to main; a document past main's cap rejects with tooLarge before anything is sent (`max`: tests). */
export function printRequestFor(r: LaidOutReport, name: string, max = MAX_PRINT_HTML_CHARS): PrintRequest {
  const html = renderDocumentHtml(r);
  if (html.length > max) throw new ReportLoadError('tooLarge');
  return { html, name, landscape: r.width > r.height };
}

/** Scale of a page (or a spread of pages) in the viewport, both in px; a hidden viewport (0 × 0) keeps a usable scale. */
export function zoomFor(mode: 'fitPage' | 'actual', page: { w: number; h: number }, viewport: { w: number; h: number }): number {
  if (mode === 'actual') return 1;
  const z = Math.min(viewport.w / page.w, viewport.h / page.h);
  return z > 0 ? z : 1;
}
