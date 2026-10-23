// Regroupement, tri et totaux d'un état (pur) : les niveaux de props.grouping et leurs sections d'en-tête et de pied de groupe
// restent cohérents après chaque opération (une section par drapeau, groupLevel dans l'ordre de grouping, sections rangées).
import { flattenControls, type DesignDoc, type SectionDef } from '../../../shared/design/model';
import { sameName } from '../../../shared/field-types';
import type { SourceField } from '../../../shared/record-source';
import { bareName, type GroupLevel } from '../../../shared/report/model';
import { uniqueName } from '../../designer/designer-model';
import { placeControls, sectionOrder, topBelow, withSections } from './report-sections';

/** Les niveaux de props.grouping (aucun quand la valeur n'est pas une liste). */
export const groupLevels = (doc: DesignDoc): GroupLevel[] => (Array.isArray(doc.props.grouping) ? (doc.props.grouping as GroupLevel[]) : []);
const isGroupSection = (s: SectionDef) => s.kind === 'groupHeader' || s.kind === 'groupFooter';

/** `next` devient props.grouping ; `from[ancien niveau]` = son nouveau niveau, ou null s'il disparaît. Chaque section de groupe suit
 *  son niveau (avec ses contrôles) ; celles qu'un drapeau ne demande plus partent, celles qu'il demande sont créées vides. */
function regroup(doc: DesignDoc, next: GroupLevel[], from: (number | null)[]): DesignDoc {
  const kept = doc.sections.flatMap((s): SectionDef[] => {
    if (!isGroupSection(s)) return [s];
    const l = from[s.groupLevel ?? -1];
    if (l === null || l === undefined || !next[l]![s.kind === 'groupHeader' ? 'header' : 'footer']) return [];
    return [l === s.groupLevel ? s : { ...s, groupLevel: l }];
  });
  let out: DesignDoc = { ...doc, props: { ...doc.props, grouping: next }, sections: kept };
  next.forEach((g, l) => {
    out = withSections(out, [...(g.header ? ['groupHeader' as const] : []), ...(g.footer ? ['groupFooter' as const] : [])], l);
  });
  return sectionOrder(out);
}
const same = (doc: DesignDoc) => groupLevels(doc).map((_, i) => i);

/** Le niveau le plus intérieur, avec une section d'en-tête et sans pied, comme « Ajouter un groupe » d'Access. */
export function addGroup(doc: DesignDoc, expression: string): DesignDoc {
  return regroup(doc, [...groupLevels(doc), { expression, order: 'asc', header: true, footer: false, keepTogether: 'no' }], same(doc));
}
/** Un tri seul : le niveau le plus intérieur, sans en-tête ni pied. */
export function addSort(doc: DesignDoc, expression: string): DesignDoc {
  return regroup(doc, [...groupLevels(doc), { expression, order: 'asc', header: false, footer: false, keepTogether: 'no' }], same(doc));
}
export function removeGroup(doc: DesignDoc, level: number): DesignDoc {
  const levels = groupLevels(doc);
  if (!levels[level]) return doc;
  return regroup(doc, levels.filter((_, i) => i !== level), levels.map((_, i) => (i === level ? null : i < level ? i : i - 1)));
}
export function moveGroup(doc: DesignDoc, from: number, to: number): DesignDoc {
  const levels = groupLevels(doc);
  if (from === to || !levels[from] || !levels[to]) return doc;
  const order = levels.map((_, i) => i);
  order.splice(to, 0, ...order.splice(from, 1));
  return regroup(doc, order.map((i) => levels[i]!), levels.map((_, i) => order.indexOf(i)));
}
/** Un en-tête ou un pied demandé crée sa section, retiré il la supprime (le garde demande d'abord si elle a des contrôles). */
export function setGroup(doc: DesignDoc, level: number, patch: Partial<GroupLevel>): DesignDoc {
  const levels = groupLevels(doc);
  if (!levels[level]) return doc;
  return regroup(doc, levels.map((g, i) => (i === level ? { ...g, ...patch } : g)), same(doc));
}

/** Le libellé de l'ordre d'un niveau suit le type de son champ, comme dans Access : « avec A en haut » (texte), « du plus petit au
 *  plus grand » (nombre), « du plus ancien au plus récent » (date) ; Oui/Non, une expression ou un champ inconnu : null (croissant). */
export function orderKind(expression: string, fields: SourceField[]): 'text' | 'number' | 'date' | null {
  if (expression.startsWith('=')) return null;
  const type = fields.find((f) => sameName(f.name, bareName(expression)))?.type;
  if (type === 'shortText' || type === 'longText' || type === 'hyperlink') return 'text';
  if (type === 'number' || type === 'currency' || type === 'autoNumber') return 'number';
  return type === 'dateTime' ? 'date' : null;
}

export type TotalFn = 'Sum' | 'Avg' | 'CountRecords' | 'Count' | 'Max' | 'Min' | 'StDev' | 'Var';   // spec 4.4 ; CountRecords = Count(*)
export const TOTAL_FNS: TotalFn[] = ['Sum', 'Avg', 'CountRecords', 'Count', 'Max', 'Min', 'StDev', 'Var'];
/** Les préfixes français des noms de l'état instantané d'Access (Somme_Montant…). */
const PREFIX: Record<TotalFn, string> = { Sum: 'Somme', Avg: 'Moyenne', CountRecords: 'Nombre', Count: 'Nombre', Max: 'Max', Min: 'Min', StDev: 'EcartType', Var: 'Var' };
/** Les totaux du type de leur argument (band.ts, TYPED_TOTALS) : eux seuls reprennent le format du champ. */
const TYPED: TotalFn[] = ['Sum', 'Avg', 'Max', 'Min'];
const HEIGHT = 340;   // 0,6 cm de haut (état instantané)

/** `=<Fn>([Champ])` (`=Count(*)` pour CountRecords) à la gauche et la largeur de la zone de texte, sous les contrôles déjà là,
 *  dans chaque pied de groupe et dans le pied d'état (la paire En-tête/pied d'état est créée s'il manque). Un pied qui a déjà ce total est laissé tel quel ;
 *  rien d'ajouté : le même document. Pas de BorderStyle : le défaut des états (C5). */
export function addTotal(doc: DesignDoc, field: SourceField, fn: TotalFn, left: number, width: number): DesignDoc {
  const source = fn === 'CountRecords' ? '=Count(*)' : `=${fn}([${field.name}])`;
  const format = TYPED.includes(fn) ? field.props.format || (field.type === 'currency' ? 'currency' : undefined) : undefined;
  let out = withSections(doc, ['reportHeader', 'reportFooter']);
  for (let i = 0; i < out.sections.length; i++) {
    const s = out.sections[i]!;
    if ((s.kind !== 'groupFooter' && s.kind !== 'reportFooter') || flattenControls(s.controls).some((c) => c.props.ControlSource === source)) continue;
    out = placeControls(out, i, [{ kind: 'textBox', name: uniqueName(out, `${PREFIX[fn]}_${field.name}`), left, top: topBelow(s), width, height: HEIGHT,
      props: { ControlSource: source, ...(format ? { Format: format } : {}) } }]);
  }
  return out;
}
