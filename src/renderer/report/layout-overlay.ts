// Mode Page des états (L3) : géométrie pure de la surcouche du flux (anneaux de sélection, poignée de largeur) et la largeur
// posée par cette poignée. Tout est en twips dans le document, en px (× scale) à l'écran.
import type { DesignDoc } from '../../shared/design/model';
import { occurrences, sectionPointAt } from '../../shared/report/flow';
import type { LaidOutReport } from '../../shared/report/types';
import type { Rect } from '../designer/geometry';
import type { ToolState } from '../designer/Designer';
import { designerReducer, initDesigner, type Selection } from '../designer/designer-model';
import { DEFAULT_SIZE, snap as snapTo } from '../designer/units';

export const MIN_WIDTH = 100;   // twips
export interface Ring { name: string; left: number; top: number; width: number; height: number }
export interface Handle { name: string; left: number; top: number; height: number }

/** Un anneau par occurrence de chaque contrôle sélectionné ; la poignée au bord droit de la première occurrence quand un seul
 *  contrôle est sélectionné. Un contrôle sans occurrence (section masquée, Visible faux, réduit à rien) : rien. */
export function overlayFor(report: LaidOutReport, selectedNames: string[], scale: number): { rings: Ring[]; handle: Handle | null } {
  const rings = selectedNames.flatMap((name) => occurrences(report, name).map((o) =>
    ({ name, left: o.left * scale, top: o.top * scale, width: o.width * scale, height: o.height * scale })));
  const first = selectedNames.length === 1 ? rings[0] : undefined;
  return { rings, handle: first ? { name: first.name, left: first.left + first.width, top: first.top, height: first.height } : null };
}

/** La largeur d'un contrôle, comme la Feuille de propriétés la pose : un membre de disposition donne sa largeur à sa colonne et
 *  décale les suivantes (syncLayouts du réducteur), sinon seule sa largeur change. Le même doc quand rien ne change. */
export function resizeTo(doc: DesignDoc, name: string, widthTwips: number): DesignDoc {
  return designerReducer(initDesigner(doc, 'report'),
    { type: 'setProp', targets: [{ kind: 'control', name }], name: 'Width', value: Math.max(MIN_WIDTH, Math.round(widthTwips)) }).doc;
}

/** Glisser de la poignée : `x0` et `x` en px écran, `base` et `w` en twips ; `done` : relâché, la largeur visée reste montrée
 *  jusqu'à la mise en page suivante. */
export interface WidthDrag { name: string; x0: number; base: number; w: number; done?: true }
export type DragStep = { kind: 'down'; name: string; x: number; base: number } | { kind: 'move'; x: number; buttons: number } | { kind: 'up' }
  | { kind: 'cancel' } /* capture perdue, Échap */;

/** Une étape du glisser ; `commit` : la seule modification, au relâchement, si la largeur a changé. Un mouvement sans bouton
 *  enfoncé (relâché hors de la fenêtre), Échap ou la capture perdue l'abandonnent ; après le relâchement, plus rien ne change. */
export function stepDrag(d: WidthDrag | null, s: DragStep, scale: number): { drag: WidthDrag | null; commit: { name: string; width: number } | null } {
  if (s.kind === 'down') return { drag: { name: s.name, x0: s.x, base: s.base, w: s.base }, commit: null };
  if (!d || d.done) return { drag: d, commit: null };
  if (s.kind === 'cancel' || (s.kind === 'move' && s.buttons === 0)) return { drag: null, commit: null };
  if (s.kind === 'move') return { drag: { ...d, w: Math.max(MIN_WIDTH, Math.round(d.base + (s.x - d.x0) / scale)) }, commit: null };
  return d.w === d.base ? { drag: null, commit: null } : { drag: { ...d, done: true }, commit: { name: d.name, width: d.w } };
}

/** Les contrôles que Suppr retire : ceux de la sélection ; vide pour l'état ou une section (on ne supprime ni l'un ni l'autre ici). */
export const deleteTargets = (selection: Selection): string[] => (selection.kind === 'controls' ? selection.names : []);

/** Poser un contrôle d'un clic sur le flux : (x, y) en twips absolus du flux ; la section sous le point et le rectangle (taille par
 *  défaut) relatif à sa bande, accroché à la grille de pas `snap` (null ou 0 : sans accrochage), left/top ≥ 0. Null hors bande ou sans outil. */
export function placement(report: LaidOutReport, doc: DesignDoc, tool: ToolState, x: number, y: number, snap: number | null): { section: number; rect: Rect } | null {
  if (!tool.kind) return null;
  const p = sectionPointAt(report, doc.sections, x, y);
  if (!p) return null;
  const at = (v: number) => Math.max(0, Math.round(snap ? snapTo(v, snap) : v));
  return { section: p.section, rect: { left: at(p.x), top: at(p.y), ...DEFAULT_SIZE } };
}
