// Mode Page des états (L3) : les premiers enregistrements de la source, lus une fois par source, et la mise en page continue
// de la définition courante sur ces lignes. Ni événement ni macro. Module pur, hors loadFlowData dont l'api est injectée (le
// pont par défaut, chargé à la demande : les tests n'ont pas de window).
import type { BasecraftApi, CellInput } from '../../shared/api';
import type { DesignDoc } from '../../shared/design/model';
import { layoutReport } from '../../shared/report/layout';
import type { Theme } from '../../shared/design/theme';
import type { ResourceMap } from '../../shared/pictures';
import { readReport } from '../../shared/report/model';
import type { LaidOutReport, LayoutEnv, ReportData } from '../../shared/report/types';
import type { LiveNotice } from '../form/live-records';
import type { ChartDataMap } from '../../shared/chart/query';
import { docParameters, loadDocData, type AskParameters } from './load';

export const FLOW_ROWS = 100;
/** 'layoutFailed' : les lignes lues, mais la mise en page a échoué (useReportFlow). */
export type FlowNotice = LiveNotice | 'truncated' | 'layoutFailed';
export interface FlowData { report: LaidOutReport | null; notice: FlowNotice | null }
/** Les lignes lues (opaque pour l'appelant) : gardées d'une modification à l'autre tant que la source ne change pas. */
export interface FlowSource { data: ReportData; notice: FlowNotice | null; params?: Record<string, CellInput> }
export type FlowApi = Pick<BasecraftApi, 'sources'>;

const NO_DATA: ReportData = { fields: [], rows: [] };

/** Les lignes gardées hors du mode Page : une lecture réussie (vide ou tronquée comprise) reste, Création <-> Page ne redemande
 *  rien ; une lecture échouée (paramètres refusés, source illisible) est oubliée, revenir au mode Page réessaie. */
export const keptOutOfLayout = <T extends { source: FlowSource }>(s: T | null): T | null =>
  (s && (s.source.notice === 'parameters' || s.source.notice === 'unreadable') ? null : s);

/** Ce qui oblige à relire les lignes : la source seule. Tri et regroupement se refont sur les lignes lues (sortAndGroup du
 *  moteur) ; les paramètres, demandés une fois par source, ne sont pas redemandés à chaque modification. */
export const flowKey = (doc: DesignDoc): string => JSON.stringify(doc.recordSource ?? null);

/** Les FLOW_ROWS premières lignes de la source de `doc`, paramètres demandés par `ask`. Ne rejette jamais : pas de source
 *  'noSource', aucune ligne 'empty', des paramètres refusés 'parameters', une erreur 'unreadable', plus de lignes 'truncated'. */
export async function loadFlowData(doc: DesignDoc, ask: AskParameters, api?: FlowApi): Promise<FlowSource> {
  if (!doc.recordSource) return { data: NO_DATA, notice: 'noSource' };
  try {
    const a = api ?? (await import('../bridge')).api;
    const params = await docParameters(a, doc, ask);
    const data = await loadDocData(a, doc, params, undefined, undefined, FLOW_ROWS + 1);   // une de plus : la source en a-t-elle davantage ?
    if (data.rows.length > FLOW_ROWS) return { data: { ...data, rows: data.rows.slice(0, FLOW_ROWS) }, notice: 'truncated', params };
    return { data, notice: data.rows.length ? null : 'empty', params };
  } catch (e) {
    return { data: NO_DATA, notice: (e as Error | null)?.name === 'AbortError' ? 'parameters' : 'unreadable' };
  }
}

/** La définition courante mise en page en un seul flux sur les lignes déjà lues. Les crochets d'événements (`hooks`) et
 *  `onPage` de `env` sont écartés : le mode Page n'exécute ni Sur formatage ni Sur impression. */
export async function layoutFlow(doc: DesignDoc, source: FlowSource, env: LayoutEnv, signal: AbortSignal, theme?: Theme, resources?: ResourceMap, charts?: ChartDataMap): Promise<LaidOutReport> {
  const { hooks: _hooks, onPage: _onPage, ...rest } = env;
  return layoutReport(readReport(doc, source.data.fields, { allCells: true, theme, resources, ...(charts ? { charts } : {}), ...(env.chartLabels ? { chartLabels: env.chartLabels } : {}) }), source.data, { ...rest, signal }, { flow: true });
}

/** Une seule mise en page à la fois : `schedule` lance `job` `delay` ms après le dernier appel, annule la précédente (son
 *  signal) et jette son résultat ; `done` reçoit le résultat de la dernière seule, null si elle a échoué (jamais de rejet).
 *  `cancel` : démontage ou sortie du mode Page. */
export function latestRun(delay: number) {
  let timer: ReturnType<typeof setTimeout> | undefined, ac: AbortController | undefined;
  const cancel = () => { clearTimeout(timer); ac?.abort(); };
  return {
    cancel,
    schedule<T>(job: (signal: AbortSignal) => Promise<T>, done: (r: T | null) => void) {
      cancel();
      const mine = ac = new AbortController();
      timer = setTimeout(() => {
        void Promise.resolve().then(() => job(mine.signal)).catch(() => null).then((r) => { if (!mine.signal.aborted) done(r); });
      }, delay);
    },
  };
}
