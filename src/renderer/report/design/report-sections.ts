// Sections d'un état et contrôles posés (pur) : état vide, paires En-tête/pied d'état et de page, ordre des sections, libellés
// des barres de section, contrôles créés par la boîte à outils. Aucun défaut écrit (C5) : le catalogue donne ceux des états.
import type { TFunction } from 'i18next';
import { flattenControls, type ControlDef, type ControlKind, type DesignDoc, type SectionDef, type SectionKind } from '../../../shared/design/model';
import { defaultFor, effectiveProp, PROPERTY_CATALOG } from '../../../shared/design/properties';
import type { DisplayContext } from '../../../shared/expr/localize';
import { sameName } from '../../../shared/field-types';
import { findControl, sectionBottomLimit } from '../../designer/designer-model';
import type { Rect } from '../../designer/geometry';
import { controlSourceToDisplay } from '../../designer/property-sheet-model';
import { MAX_TWIPS } from '../../designer/units';
import { readReport } from '../../../shared/report/model';
import { orientationStates } from '../page-setup';

const PAIR_HEIGHT = 454;   // 0,8 cm, comme une section ajoutée par Access
const section = (kind: SectionKind, height: number): SectionDef => ({ kind, height, props: {}, controls: [] });

export function blankReport(): DesignDoc {
  // Width stored from the start (the catalog's): the engine never falls back to 6994 (C5, reportWidth)
  return { formatVersion: '1.0', recordSource: null, props: { grouping: [], Width: defaultFor(PROPERTY_CATALOG.find((d) => d.name === 'Width')!, 'report', 'report') },
    sections: [section('pageHeader', PAIR_HEIGHT), section('detail', 2268), section('pageFooter', PAIR_HEIGHT)] };
}

const RANK: Partial<Record<SectionKind, number>> = { reportHeader: 0, pageHeader: 1, groupHeader: 2, detail: 3, groupFooter: 4, pageFooter: 5, reportFooter: 6 };
/** L'ordre d'Access : en-têtes de groupe du niveau 0 vers l'intérieur, pieds de groupe de l'intérieur vers le niveau 0. */
export function sectionOrder(doc: DesignDoc): DesignDoc {
  const key = (s: SectionDef) => (RANK[s.kind] ?? 7) * 1e6 + (s.kind === 'groupFooter' ? -1 : 1) * (s.groupLevel ?? 0);
  const sections = [...doc.sections].sort((a, b) => key(a) - key(b));   // stable
  return sections.every((s, i) => s === doc.sections[i]) ? doc : { ...doc, sections };
}

/** Les sections `kinds` qui manquent, vides (0,8 cm), à leur place ; le même document quand rien ne manque. Une section nouvelle
 *  n'a aucune propriété : Conserver ensemble et le reste viennent des défauts du catalogue (C5). */
export function withSections(doc: DesignDoc, kinds: SectionKind[], groupLevel?: number): DesignDoc {
  const missing = kinds.filter((k) => !doc.sections.some((s) => s.kind === k && s.groupLevel === groupLevel));
  if (!missing.length) return doc;
  const add = missing.map((k): SectionDef => ({ ...section(k, PAIR_HEIGHT), ...(groupLevel === undefined ? {} : { groupLevel }) }));
  return sectionOrder({ ...doc, sections: [...doc.sections, ...add] });
}

/** Ajoute la paire (vide, 0,8 cm chacune) ou la retire avec ses contrôles, comme le menu de la barre de section d'Access. */
function togglePair(doc: DesignDoc, head: SectionKind, foot: SectionKind): DesignDoc {
  if (doc.sections.some((s) => s.kind === head || s.kind === foot)) return { ...doc, sections: doc.sections.filter((s) => s.kind !== head && s.kind !== foot) };
  return withSections(doc, [head, foot]);
}

/** Le haut d'un contrôle ajouté sous ceux de la section (0,1 cm d'écart), ou à 0,1 cm du haut d'une section vide. */
export const topBelow = (s: SectionDef): number => (s.controls.length ? sectionBottomLimit(s) : 0) + 57;

/** `controls` ajoutés à la section `index`, qui grandit pour les contenir (une opération `edit` n'ajuste rien d'elle-même). */
export function placeControls(doc: DesignDoc, index: number, controls: ControlDef[]): DesignDoc {
  return { ...doc, sections: doc.sections.map((s, i) => {
    if (i !== index) return s;
    const next = { ...s, controls: [...s.controls, ...controls] };
    return { ...next, height: Math.max(s.height, Math.min(sectionBottomLimit(next), MAX_TWIPS)) };
  }) };
}
export const toggleReportHeaderFooter = (doc: DesignDoc): DesignDoc => togglePair(doc, 'reportHeader', 'reportFooter');
export const togglePageHeaderFooter = (doc: DesignDoc): DesignDoc => togglePair(doc, 'pageHeader', 'pageFooter');

const names = (doc: DesignDoc): string[] => doc.sections.flatMap((s) => flattenControls(s.controls).map((c) => c.name));
/** Une modification qui fait disparaître des contrôles (paire de sections, regroupement) demande d'abord confirmation. */
export function removesControls(before: DesignDoc, after: DesignDoc): boolean {
  const kept = names(after);
  return names(before).some((n) => !kept.some((k) => sameName(k, n)));
}

/** « En-tête de groupe : Client » (l'expression du niveau, affichée dans la langue de l'interface), sinon le nom de la section. */
export function sectionLabel(s: SectionDef, doc: DesignDoc, t: TFunction, display?: DisplayContext): string {
  if (s.kind === 'groupHeader' || s.kind === 'groupFooter') {
    const levels = doc.props.grouping;
    const expr = Array.isArray(levels) ? (levels[s.groupLevel ?? -1] as { expression?: unknown } | undefined)?.expression : undefined;
    if (typeof expr === 'string') {
      return t(`report.sectionGroup.${s.kind === 'groupHeader' ? 'header' : 'footer'}`, { expr: display ? controlSourceToDisplay(expr, display) : expr });
    }
  }
  return t(`designer.section.${s.kind}`);
}

const LABEL_WIDTH = 1418, GAP = 57, BOX = 284;   // étiquette attachée 2,5 cm à gauche ; case 0,5 cm
const DEFAULT_CLICK = { width: 1418, height: 340 };   // la taille d'un simple clic (pointer.ts)

/** Le premier « préfixe + n » libre (n ≥ 1), comme Access (Texte1, Étiquette2…). */
function nextName(doc: DesignDoc, prefix: string, taken: string[]): string {
  for (let n = 1; ; n++) { const name = `${prefix}${n}`; if (!findControl(doc, name) && !taken.some((x) => sameName(x, name))) return name; }
}

/** Les contrôles d'un outil posé dans `rect` (twips, relatifs à la section) : zone de texte et liste déroulante avec leur étiquette
 *  attachée à gauche, case à cocher et case d'option avec la leur à droite ; une étiquette porte son nom pour légende. */
export function newReportControls(kind: ControlKind, rect: Rect, section: number, doc: DesignDoc, prefix: (k: ControlKind) => string): ControlDef[] {
  if (!doc.sections[section]) return [];
  const name = nextName(doc, prefix(kind), []);
  const click = rect.width === DEFAULT_CLICK.width && rect.height === DEFAULT_CLICK.height;
  const r = { ...rect };
  if (click && (kind === 'checkBox' || kind === 'optionButton')) { r.width = BOX; r.height = BOX; }
  if (click && kind === 'line') r.height = 0;   // un clic donne un trait horizontal
  const label = (g: Rect, caption: string): ControlDef => ({ kind: 'label', name: nextName(doc, prefix('label'), [name]), ...g, props: { Caption: caption } });
  if (kind === 'textBox' || kind === 'comboBox') {
    r.left = Math.min(Math.max(r.left, LABEL_WIDTH), MAX_TWIPS - r.width);   // l'étiquette reste dans la section
    return [{ kind, name, ...r, props: {}, children: [label({ left: r.left - LABEL_WIDTH, top: r.top, width: LABEL_WIDTH - GAP, height: Math.min(r.height, 340) }, `${name}:`)] }];
  }
  if (kind === 'checkBox' || kind === 'optionButton') {
    const left = Math.min(r.left + r.width + GAP, MAX_TWIPS - LABEL_WIDTH);
    return [{ kind, name, ...r, props: {}, children: [label({ left, top: r.top, width: LABEL_WIDTH, height: Math.max(r.height, BOX) }, name)] }];
  }
  return [{ kind, name, ...r, props: kind === 'label' ? { Caption: name } : {} }];
}

/** The Detail is hidden (Hide Details: its Visible property false). */
export function detailHidden(doc: DesignDoc): boolean {
  const d = doc.sections.find((x) => x.kind === 'detail');
  return !!d && effectiveProp(d.props, 'Visible', 'detail', 'report') === false;
}

/** The pressed buttons of the Report Design and Page Setup tabs (registerCommandStates): the orientation, the Group, Sort and
 *  Total pane shown, the Detail hidden. */
export const reportDesignStates = (doc: DesignDoc, grouping: boolean) => ({
  ...orientationStates(readReport(doc, []).page.orientation), groupSort: { active: grouping }, hideDetails: { active: detailHidden(doc) },
});
