// Requête groupée d'un graphique (F4) : construite uniquement comme arbre `Query` puis imprimée par `printSql`.
// Aucun texte du document n'est jamais collé dans le SQL : chaque champ est cherché (sans tenir compte de la casse) dans
// les champs de la source et remplacé par son nom canonique, sinon `bc:notFound` ; les valeurs de liaison sont des paramètres.
import type { CellInput, SqlValue } from '../coerce';
import type { Expr } from '../expr/ast';
import { sameName } from '../field-types';
import type { RecordSourceRef, SourceField } from '../record-source';
import type { FromItem, ParamDecl, Query, SelectItem, SelectQuery } from '../query/ast';
import { printSql } from '../query/print';
import { parseSql } from '../query/sql-parser';
import { seriesName, type Agg, type ChartSpec } from './spec';

export const CHART_MAX_POINTS = 5000;
export interface ChartColumn { role: 'category' | 'legend' | 'value'; field: string; name: string }
/** Demande du canal `charts.data` : le graphique, sa source résolue, la liaison Maître/Fils et les valeurs de paramètres du document. */
export interface ChartDataRequest { spec: ChartSpec; source: RecordSourceRef; link?: { fields: string[]; values: CellInput[] }; params?: Record<string, CellInput> }
/** Les données de chaque graphique d'un état, par nom de contrôle. */
export type ChartDataMap = Readonly<Record<string, ChartData>>;
export interface ChartData { columns: ChartColumn[]; rows: SqlValue[][]; truncated: boolean }
export interface ChartQuery { sql: string; columns: ChartColumn[] }

const id = (name: string): Expr => ({ k: 'id', name });
const str = (v: string): Expr => ({ k: 'str', v });
const call = (name: string, ...args: Expr[]): Expr => ({ k: 'call', name, args });
const cat = (...p: Expr[]): Expr => p.reduce((l, r) => ({ k: 'bin', op: '&', l, r }));

/** Libellé de groupe d'une date : `2026`, `2026-Q1`, `2026-03`, `2026-03-15` (texte qui se trie chronologiquement). */
function dateLabel(g: 'year' | 'quarter' | 'month' | 'day', e: Expr): Expr {
  switch (g) {
    case 'year': return call('Format', e, str('yyyy'));
    case 'quarter': return cat(call('Format', e, str('yyyy')), str('-Q'), call('DatePart', str('q'), e));
    case 'month': return call('Format', e, str('yyyy-mm'));
    case 'day': return call('Format', e, str('yyyy-mm-dd'));
  }
}

const AGG_FN: Record<Exclude<Agg, 'none'>, string> = { sum: 'Sum', avg: 'Avg', min: 'Min', max: 'Max', count: 'Count' };
const bad = (): never => { throw new Error('bc:invalidArgument'); };

function paramOf(f: SourceField, name: string): ParamDecl {
  const type = f.type === 'autoNumber' ? 'number' : f.type === 'hyperlink' ? 'shortText' : f.type;
  return { name, type, ...(type === 'number' ? { numberSize: f.type === 'autoNumber' ? 'longInteger' as const : f.props.numberSize ?? 'longInteger' as const } : {}) };
}

export function buildChartQuery(spec: ChartSpec, source: RecordSourceRef, fields: SourceField[], link?: { fields: string[] }): ChartQuery {
  if (spec.values.length === 0) bad();
  const field = (name: string): SourceField => fields.find((f) => sameName(f.name, name)) ?? (() => { throw new Error('bc:notFound'); })();
  const params: ParamDecl[] = [];
  let from: FromItem;
  if (source.kind === 'sql') {
    let q: Query;
    try { q = parseSql(source.sql); } catch { return bad(); }
    if (q.body.k !== 'select' || q.body.into !== undefined) bad();
    params.push(...q.params);
    from = { k: 'derived', q: q.body as SelectQuery, alias: 'src' };
  } else if (source.kind === 'table' || source.kind === 'query') from = { k: 'source', name: source.name };
  else return bad();

  const used = new Set<string>();
  const items: SelectItem[] = [];
  const columns: ChartColumn[] = [];
  // Nom de colonne unique ; l'alias n'est écrit que s'il diffère du champ nu
  const add = (role: ChartColumn['role'], fieldName: string, e: Expr, want: string): void => {
    let name = want;
    for (let n = 2; used.has(name.toLowerCase()); n++) name = `${want}${n}`;
    used.add(name.toLowerCase());
    items.push(e.k === 'id' && e.name === name ? { e } : { e, alias: name });
    columns.push({ role, field: fieldName, name });
  };

  const axis = spec.axis.map((a, i) => {
    const f = field(a);
    const e = id(f.name);
    return { f, e: i === 0 && spec.dateGroup !== 'none' && f.type === 'dateTime' ? dateLabel(spec.dateGroup, e) : e };
  });
  const groups = axis.map((a) => a.e);
  if (axis.length) {
    const label = axis.length === 1 ? axis[0].e : cat(...axis.flatMap((a, i) => (i ? [str(' / '), a.e] : [a.e])));
    const joined = axis.map((a) => a.f.name).join(' / ');
    add('category', joined, label, joined);
  }
  const legend = spec.legend === '' ? null : field(spec.legend);
  if (legend) { add('legend', legend.name, id(legend.name), legend.name); groups.push(id(legend.name)); }
  const raw = spec.values.every((v) => v.agg === 'none');
  for (const v of legend ? spec.values.slice(0, 1) : spec.values) {
    const f = field(v.field);
    if (raw) add('value', f.name, id(f.name), f.name);
    else {
      const agg = v.agg === 'none' ? 'sum' : v.agg;
      add('value', f.name, call(AGG_FN[agg], id(f.name)), seriesName({ field: f.name, agg }));
    }
  }

  let where: Expr | undefined;
  // La liaison déclare link0, link1… : un paramètre de la source du même nom ferait un doublon, refusé
  if (link && params.some((p) => /^link\d+$/i.test(p.name))) bad();
  (link?.fields ?? []).forEach((l, i) => {
    const f = field(l);
    params.push(paramOf(f, `link${i}`));
    const eq: Expr = { k: 'bin', op: '=', l: id(f.name), r: id(`link${i}`) };
    where = where ? { k: 'bin', op: 'And', l: where, r: eq } : eq;
  });

  const body: SelectQuery = { k: 'select', distinct: false, top: { n: CHART_MAX_POINTS + 1, percent: false }, items, from: [from],
    ...(where ? { where } : {}), groupBy: raw ? [] : groups, orderBy: raw ? [] : groups.map((e) => ({ e, dir: 'asc' as const })) };
  return { sql: printSql({ params, body }), columns };
}

/** La demande du graphique ; null (repère) sans source ou sans valeurs. `params` : les valeurs de paramètres déjà connues du document.
 *  `link` : champs père/fils et valeurs du père (null : pas d'enregistrement) ; deux listes vides = pas de liaison, des nombres
 *  différents ou des valeurs absentes = null. Les valeurs voyagent en paramètres, jamais dans le texte SQL. */
export function chartRequest(spec: ChartSpec, docSource: RecordSourceRef | null, params?: Record<string, CellInput>,
  link?: { master: string[]; child: string[]; values: CellInput[] | null }): ChartDataRequest | null {
  const source = spec.source ?? docSource;
  if (!source || spec.values.length === 0) return null;
  const linked = !!link && (link.master.length > 0 || link.child.length > 0);
  if (linked && (link.master.length !== link.child.length || !link.values)) return null;
  return { spec, source, ...(linked && { link: { fields: link.child, values: link.values! } }), ...(params && { params }) };
}
