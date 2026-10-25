// Chargement d'un état enregistré (définition, données, mise en page), pour l'aperçu, l'impression et l'export PDF ; zoom.
import { MAX_PRINT_HTML_CHARS, type BasecraftApi, type CellInput, type PrintRequest, type RecordSourceRef } from '../../shared/api';
import { validateDesignDoc, type DesignDoc } from '../../shared/design/model';
import type { SourceInfo } from '../../shared/record-source';
import { layoutReport } from '../../shared/report/layout';
import { readReport } from '../../shared/report/model';
import { renderDocumentHtml } from '../../shared/report/render';
import { ReportLoadError, type LaidOutReport, type LayoutEnv, type ReportData } from '../../shared/report/types';

/** Rows per sources.page call: main's cap (MAX_PAGE_ROWS); 500 at a time made 200,000 rows 400 round trips (7 s). */
export const DATA_PAGE = 10_000;

const aborted = () => Object.assign(new Error('Report loading aborted'), { name: 'AbortError' });

/** Every row of the source, read DATA_PAGE at a time up to `total`; rejects with name 'AbortError' once `signal` is aborted.
 *  `where`: the opening's Where Condition (OpenReport, R8): only the rows it keeps. */
export async function loadReportData(api: Pick<BasecraftApi, 'sources'>, ref: RecordSourceRef, params?: Record<string, CellInput>,
  signal?: AbortSignal, where?: string): Promise<ReportData> {
  const { fields } = await api.sources.describe(ref);
  const rows: ReportData['rows'] = [];
  for (let offset = 0; ; offset += DATA_PAGE) {
    if (signal?.aborted) throw aborted();
    const p = await api.sources.page(ref, { offset, limit: DATA_PAGE, ...(params ? { params } : {}), ...(where !== undefined ? { where } : {}) });
    if (signal?.aborted) throw aborted();
    rows.push(...p.rows);
    if (!p.rows.length || offset + DATA_PAGE >= p.total) return { fields, rows };
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
 *  Condition on every page read. */
export async function loadDocData(api: Pick<BasecraftApi, 'sources'>, doc: DesignDoc, params?: Record<string, CellInput>, signal?: AbortSignal,
  where?: string): Promise<ReportData> {
  if (!doc.recordSource) return { fields: [], rows: [] };
  return loadReportData(api, doc.recordSource, params, signal, where);
}

/** Steps 1 to 5 for a report that is not open (the Navigation Pane's Print and Export items); rejects with the step's bc: code.
 *  `ready`: the parameters are asked, the long part begins (the progress box). */
export async function layoutSavedReport(api: Pick<BasecraftApi, 'objects' | 'sources'>, name: string, env: LayoutEnv, ask: AskParameters, signal?: AbortSignal,
  ready?: () => void, where?: string): Promise<LaidOutReport> {
  const doc = await loadReportDoc(api, name);
  const params = await docParameters(api, doc, ask);
  ready?.();
  const data = await loadDocData(api, doc, params, signal, where);
  return layoutReport(readReport(doc, data.fields), data, { ...env, signal });
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
