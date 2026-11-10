// Paramètres du graphique (onglet Données) : opérations pures sur la spécification, jamais sur le document.
// Chaque fonction renvoie une nouvelle ChartSpec ; le volet en tire un correctif de propriétés (specPatch).
import { CHART_MAX_AXIS, CHART_MAX_VALUES, type Agg, type ChartSeries, type ChartSpec, type ChartType } from '../../shared/chart/spec';
import { findControl } from '../../shared/design/control-tree';
import type { ControlDef } from '../../shared/design/model';
import type { RecordSourceRef } from '../../shared/record-source';
import type { ToolState } from './Designer';
import type { DesignerState } from './designer-model';

export type SourceKind = 'tables' | 'queries' | 'both';

const same = (a: string, b: string): boolean => a.toLowerCase() === b.toLowerCase();

/** Cocher ajoute le champ à la suite (l'ordre de cochage est l'ordre des niveaux), décocher le retire ; au plus 8 champs. */
export function toggleAxis(spec: ChartSpec, field: string): ChartSpec {
  const has = spec.axis.some((f) => same(f, field));
  return { ...spec, axis: (has ? spec.axis.filter((f) => !same(f, field)) : [...spec.axis, field]).slice(0, CHART_MAX_AXIS) };
}

/** Le champ de légende ; '' = aucun. */
export const setLegend = (spec: ChartSpec, field: string): ChartSpec => ({ ...spec, legend: field });

/** Une valeur nouvellement cochée prend la somme (agrégat par défaut) ; au plus 16 valeurs. */
export function toggleValue(spec: ChartSpec, field: string): ChartSpec {
  const has = spec.values.some((v) => same(v.field, field));
  const values = (has ? spec.values.filter((v) => !same(v.field, field)) : [...spec.values, { field, agg: 'sum' as Agg }]).slice(0, CHART_MAX_VALUES);
  // Une série dont la Valeur disparaît est retirée (le document n'écrit pas de série orpheline).
  return { ...spec, values, ...(spec.series && { series: spec.series.filter((x) => values.some((v) => same(v.field, x.field))) }) };
}

export const setAgg = (spec: ChartSpec, field: string, agg: Agg): ChartSpec =>
  ({ ...spec, values: spec.values.map((v) => (same(v.field, field) ? { ...v, agg } : v)) });

/** Une autre source : les champs choisis ne valent plus rien, ils sont retirés (sinon la requête refuserait un champ inconnu). */
export const setSource = (spec: ChartSpec, source: RecordSourceRef | null): ChartSpec =>
  ({ ...spec, source, axis: [], dateGroup: 'none', legend: '', values: [], series: [] });

export const setDateGroup = (spec: ChartSpec, dateGroup: ChartSpec['dateGroup']): ChartSpec => ({ ...spec, dateGroup });

/** Les noms proposés par la liste déroulante : tables, requêtes, ou les deux (tables d'abord, sans doublon). */
export function listSources(kind: SourceKind, tables: string[], queries: string[]): string[] {
  if (kind === 'tables') return tables;
  if (kind === 'queries') return queries;
  return [...tables, ...queries.filter((q) => !tables.some((t) => same(t, q)))];
}

/** Change la mise en forme d'une série (liée à sa Valeur par le champ) ; une clé `undefined` du correctif l'efface, une série sans plus aucune
 *  option disparaît (le document n'écrit pas de série vide) ; les autres séries ne changent pas. */
export function setSeries(series: ChartSeries[], field: string, patch: Partial<ChartSeries>): ChartSeries[] {
  const at = series.findIndex((x) => same(x.field, field));
  const merged = Object.fromEntries(Object.entries({ ...(series[at] ?? { field }), ...patch, field: series[at]?.field ?? field }).filter(([, v]) => v !== undefined)) as unknown as ChartSeries;
  const keep = Object.keys(merged).length > 1;
  if (at < 0) return keep ? [...series, merged] : series;
  return keep ? series.map((x, i) => (i === at ? merged : x)) : series.filter((_, i) => i !== at);
}

/** Les propriétés plates du contrôle (ruling « Where the spec lives ») ; une clé `undefined` est retirée par l'édition. */
export const specToProps = (s: ChartSpec): Record<string, unknown> => ({
  ChartType: s.type, ChartSource: s.source ?? undefined, ChartAxis: s.axis, ChartDateGroup: s.dateGroup, ChartLegend: s.legend, ChartValues: s.values,
  ChartSeries: s.series?.length ? s.series : undefined,
});

/** Seulement les propriétés qui changent entre deux spécifications (un document n'écrit pas les valeurs par défaut sans raison). */
export function specPatch(from: ChartSpec, to: ChartSpec): Record<string, unknown> {
  const a = specToProps(from);
  return Object.fromEntries(Object.entries(specToProps(to)).filter(([k, v]) => JSON.stringify(v) !== JSON.stringify(a[k])));
}

/** Choisir un type dans Insérer un graphique moderne arme l'outil Graphique : le contrôle dessiné prendra ce type. */
export const armedChartTool = (type: ChartType): ToolState => ({ kind: 'chart', locked: false, props: { ChartType: type } });

/** Le genre de source d'un graphique (radios du volet) : celui de sa source, « les deux » sans source propre. */
export const sourceKindOf = (s: ChartSpec): SourceKind => (s.source?.kind === 'table' ? 'tables' : s.source?.kind === 'query' ? 'queries' : 'both');

/** Le regroupement de dates ne concerne que le premier champ d'axe, s'il est une date. */
export const isDateField = (fields: { name: string; type: string }[], name: string | undefined): boolean =>
  !!name && fields.some((f) => same(f.name, name) && f.type === 'dateTime');

/** Le graphique sélectionné quand c'est le seul contrôle sélectionné. */
export function selectedChart(s: DesignerState): ControlDef | null {
  if (s.selection.kind !== 'controls' || s.selection.names.length !== 1) return null;
  const c = findControl(s.doc, s.selection.names[0]!)?.control;
  return c?.kind === 'chart' ? c : null;
}

export { typeHintKey } from '../../shared/chart/spec';   // la vue Formulaire (bundle Runtime) la lit aussi : elle vit dans shared
