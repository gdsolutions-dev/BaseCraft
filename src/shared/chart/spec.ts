// Spécification d'un graphique moderne (F4) : lue des props plates du contrôle `chart` (ChartType, ChartSource, ChartAxis…).
// La lecture est tolérante : un document édité à la main donne des valeurs par défaut, jamais une exception.
import type { RecordSourceRef } from '../record-source';
import { isColorValue, type ColorValue } from '../design/colors';
import { TRENDLINES, type Trendline } from './trend';

export type ChartType = 'columnClustered' | 'columnStacked' | 'columnStacked100' | 'barClustered' | 'barStacked' | 'barStacked100'
  | 'line' | 'lineStacked' | 'lineStacked100' | 'area' | 'areaStacked' | 'areaStacked100' | 'pie' | 'radar' | 'radarFilled' | 'combo'
  | 'doughnut' | 'arc' | 'scatter' | 'bubble' | 'boxWhisker' | 'funnel' | 'pareto' | 'waterfall';
export const CHART_TYPES: readonly ChartType[] = ['columnClustered', 'columnStacked', 'columnStacked100', 'barClustered', 'barStacked', 'barStacked100',
  'line', 'lineStacked', 'lineStacked100', 'area', 'areaStacked', 'areaStacked100', 'pie', 'radar', 'radarFilled', 'combo',
  'doughnut', 'arc', 'scatter', 'bubble', 'boxWhisker', 'funnel', 'pareto', 'waterfall'];
/** Les types F5, dans l'ordre du menu des nouveaux types. */
export const F5_CHART_TYPES: readonly ChartType[] = ['doughnut', 'arc', 'funnel', 'scatter', 'bubble', 'boxWhisker', 'pareto', 'waterfall'];
export type ChartFamily = 'column' | 'bar' | 'line' | 'area' | 'pie' | 'radar' | 'combo'
  | 'doughnut' | 'arc' | 'scatter' | 'bubble' | 'boxWhisker' | 'funnel' | 'pareto' | 'waterfall';
/** Famille d'un type : histogramme, barres, courbe, zone, secteurs, radar (simple ou rempli), combiné. */
export const chartFamily = (t: ChartType): ChartFamily => (F5_CHART_TYPES.includes(t) ? (t as ChartFamily) : t === 'pie' ? 'pie' : t === 'combo' ? 'combo' : t.startsWith('radar') ? 'radar' : t.startsWith('column') ? 'column' : t.startsWith('bar') ? 'bar' : t.startsWith('area') ? 'area' : 'line');
/** Mode de données : `grouped` (GROUP BY, agrégats) ou `rows` (enregistrements bruts : nuage de points, bulles, boîte à moustaches). */
export const chartDataMode = (t: ChartType): 'grouped' | 'rows' => (t === 'scatter' || t === 'bubble' || t === 'boxWhisker' ? 'rows' : 'grouped');
/** Vrai quand la famille se dessine sur des axes (faux : secteurs, radar, anneau, arc, entonnoir). */
export const usesAxes = (f: ChartFamily): boolean => !(f === 'pie' || f === 'radar' || f === 'doughnut' || f === 'arc' || f === 'funnel');
/** Vrai quand la Légende est ignorée et qu'une seule série (première Valeur, lignes d'une catégorie additionnées) est tracée. */
export const singleSeries = (f: ChartFamily): boolean => f === 'pie' || f === 'doughnut' || f === 'arc' || f === 'funnel' || f === 'pareto' || f === 'waterfall';
/** Empilement : aucun (groupé), cumulé, ou cumulé en parts de la catégorie (100 %). */
export const chartStack = (t: ChartType): 'none' | 'stack' | 'percent' => (t.endsWith('Stacked100') ? 'percent' : t.endsWith('Stacked') ? 'stack' : 'none');
export type Agg = 'none' | 'sum' | 'avg' | 'min' | 'max' | 'count';
export const AGGS: readonly Agg[] = ['none', 'sum', 'avg', 'min', 'max', 'count'];
export type DateGroup = 'none' | 'year' | 'quarter' | 'month' | 'day';
export const DATE_GROUPS: readonly DateGroup[] = ['none', 'year', 'quarter', 'month', 'day'];
export interface ChartValue { field: string; agg: Agg }
/** Mise en forme d'une série (F4b), liée à une Valeur par son champ : sert au graphique combiné. */
export type SeriesType = 'column' | 'line' | 'area';
export const SERIES_TYPES: readonly SeriesType[] = ['column', 'line', 'area'];
export const DASHES = ['solid', 'dashed', 'dotted'] as const;
export type Dash = (typeof DASHES)[number];
export const GAPS = ['gap', 'zero', 'connect'] as const;
export type Gap = (typeof GAPS)[number];
export const LINE_WIDTH = { min: 1, max: 10 } as const;
/** Mise en forme d'une série : nom, axe secondaire, remplissage (color), bordure, étiquettes, courbe de tendance, options de courbe (dash, marker, gap : trous). */
export interface ChartSeries {
  field: string; name?: string; type?: SeriesType; secondary?: boolean; color?: ColorValue; borderColor?: ColorValue; dataLabels?: boolean;
  trendline?: Trendline; trendlineName?: string; lineWidth?: number; dash?: Dash; marker?: boolean; gap?: Gap;
}
export interface ChartSpec { type: ChartType; source: RecordSourceRef | null; axis: string[]; dateGroup: DateGroup; legend: string; values: ChartValue[]; series?: ChartSeries[] }

export const CHART_MAX_AXIS = 8;
export const CHART_MAX_VALUES = 16;
export const CHART_MAX_SERIES = 16;
const MAX_TEXT = 255;

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
/** Épaisseur de trait valide : nombre fini entre 1 et 10 (au-delà, la valeur est ignorée, comme une valeur inconnue). */
export const isLineWidth = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= LINE_WIDTH.min && v <= LINE_WIDTH.max;
const clean = (v: unknown): string => (typeof v === 'string' ? v.trim().slice(0, MAX_TEXT) : '');
const oneOf = <T extends string>(list: readonly T[], v: unknown, fallback: T): T => (list as readonly unknown[]).includes(v) ? (v as T) : fallback;

function readSource(v: unknown): RecordSourceRef | null {
  if (!isObject(v)) return null;
  if (v.kind === 'table' || v.kind === 'query') { const name = clean(v.name); return name === '' ? null : { kind: v.kind, name }; }
  return v.kind === 'sql' && typeof v.sql === 'string' && v.sql !== '' ? { kind: 'sql', sql: v.sql } : null;
}

function readValues(raw: unknown): ChartValue[] {
  return (Array.isArray(raw) ? raw : []).flatMap((x): ChartValue[] => {
    const field = isObject(x) ? clean(x.field) : '';
    return field === '' ? [] : [{ field, agg: oneOf(AGGS, (x as Record<string, unknown>).agg, 'sum') }];
  }).slice(0, CHART_MAX_VALUES);
}

/** Séries mises en forme : au plus 16, un champ absent de ChartValues est ignoré (le champ retenu est celui de la Valeur), un type inconnu donne column. */
export function readChartSeries(props: Record<string, unknown>): ChartSeries[] {
  if (!Array.isArray(props.ChartSeries)) return [];
  const fields = readValues(props.ChartValues).map((v) => v.field);
  return props.ChartSeries.flatMap((x): ChartSeries[] => {
    if (!isObject(x)) return [];
    const field = fields.find((f) => f.toLowerCase() === clean(x.field).toLowerCase());
    if (field === undefined) return [];
    const name = clean(x.name);
    const tname = clean(x.trendlineName);
    const bool = (k: string) => (typeof x[k] === 'boolean' ? { [k]: x[k] } : {});
    const pick = <T extends string>(k: string, list: readonly T[]) => ((list as readonly unknown[]).includes(x[k]) ? { [k]: x[k] } : {});
    return [{ field, ...(name !== '' ? { name } : {}), ...(x.type !== undefined ? { type: oneOf(SERIES_TYPES, x.type, 'column') } : {}),
      ...bool('secondary'), ...bool('dataLabels'), ...bool('marker'), ...(isColorValue(x.color) ? { color: x.color } : {}), ...(isColorValue(x.borderColor) ? { borderColor: x.borderColor } : {}),
      ...pick('trendline', TRENDLINES), ...(tname !== '' ? { trendlineName: tname } : {}), ...pick('dash', DASHES), ...pick('gap', GAPS),
      ...(isLineWidth(x.lineWidth) ? { lineWidth: x.lineWidth } : {}) }];
  }).slice(0, CHART_MAX_SERIES);
}

export function readChartSpec(props: Record<string, unknown>): ChartSpec {
  const axis = Array.isArray(props.ChartAxis) ? props.ChartAxis.map(clean).filter((s) => s !== '').slice(0, CHART_MAX_AXIS) : [];
  const values = readValues(props.ChartValues);
  return { type: oneOf(CHART_TYPES, props.ChartType, 'columnClustered'), source: readSource(props.ChartSource), axis,
    dateGroup: oneOf(DATE_GROUPS, props.ChartDateGroup, 'none'), legend: clean(props.ChartLegend), values, series: readChartSeries(props) };
}

const PREFIX: Record<Exclude<Agg, 'none'>, string> = { sum: 'Sum', avg: 'Avg', min: 'Min', max: 'Max', count: 'Count' };
/** Nom par défaut d'une série, comme Access (préfixes anglais dans toutes les langues) ; `none` donne le nom du champ. */
export const seriesName = (v: ChartValue): string => (v.agg === 'none' ? v.field : `${PREFIX[v.agg]}Of${v.field}`);

export const isEmptySpec = (s: ChartSpec): boolean => s.axis.length === 0 && s.values.length === 0;

/** Toutes les clés d'aide qu'un graphique peut afficher (la vue formulaire les traduit à la demande ; l'impression les reçoit d'avance). */
export const TYPE_HINT_KEYS: readonly string[] = ['chart.noData', ...F5_CHART_TYPES.map((t) => `chart.settings.typeHint.${t}`)];
/** L'aide propre au type (clé i18n), ou null (types F4). */
export const typeHintKey = (spec: ChartSpec): string | null =>
  F5_CHART_TYPES.includes(spec.type) ? `chart.settings.typeHint.${spec.type}` : null;

export type FormatGroup = 'frame' | 'legend' | 'title' | 'subtitle' | 'axisTitles' | 'xAxis' | 'yAxis' | 'secAxis' | 'paretoSec' | 'hole' | 'bubble' | 'waterfall';
const FRAME_GROUPS: readonly FormatGroup[] = ['frame', 'legend', 'title', 'subtitle'];
const AXIS_GROUPS: readonly FormatGroup[] = ['axisTitles', 'xAxis', 'yAxis'];
/** Les groupes de lignes de mise en forme qui s'appliquent à un type (source unique de la feuille de propriétés) ; secteurs et radar n'ont pas d'axes. */
export function formatApplies(type: ChartType): ReadonlySet<FormatGroup> {
  const f = chartFamily(type);
  const extra: Partial<Record<ChartFamily, FormatGroup[]>> = { doughnut: ['hole'], arc: ['hole'], bubble: [...AXIS_GROUPS, 'bubble'], scatter: [...AXIS_GROUPS],
    pareto: [...AXIS_GROUPS, 'paretoSec'], waterfall: [...AXIS_GROUPS, 'waterfall'], boxWhisker: [...AXIS_GROUPS] };
  const none = f === 'pie' || f === 'radar' || f === 'funnel';
  const g = new Set<FormatGroup>([...FRAME_GROUPS, ...(extra[f] ?? (none ? [] : [...AXIS_GROUPS, 'secAxis']))]);
  if (f === 'boxWhisker') g.delete('legend');   // une seule série
  return g;
}
/** Types qui ignorent le champ Légende (une seule série dessinée) : Chart Settings le désactive, les mises en forme de série s'appliquent quand même. */
export const ignoresLegend = (t: ChartType): boolean => ['doughnut', 'arc', 'boxWhisker', 'funnel', 'pareto', 'waterfall'].includes(t);
