// Formulaire instantané (module pur, partagé avec basecraft-cli : aucune dépendance au rendu, à React ni à i18next).
import type { ControlDef, ControlKind, DesignDoc, SectionDef, SectionKind } from './model';
import { createLayout, membersOf } from './layout-edit';
import { cmToTwips } from './model';
import type { RecordSourceRef, SourceField, SourceInfo } from '../record-source';
import { MAX_TWIPS } from '../field-types';
import { boundControlWithLabel, TAB_KINDS } from './field-controls';

/** Préfixe des noms de contrôles (designer.ctlPrefix.<genre>) et nom d'une page d'onglet (form.tabPage), traduits par la vue. */
export interface FormLabels { prefix(kind: ControlKind): string; tabPage(n: number): string }
export const hidden = (kind: SectionKind): SectionDef => ({ kind, height: 0, props: { Visible: false }, controls: [] });

/** Un formulaire vierge : Détail de 4 cm, en-tête et pied masqués à 0, largeur 16 cm. */
export function emptyFormDoc(source: RecordSourceRef | null): DesignDoc {
  return { formatVersion: '1.0', recordSource: source, props: { Width: 9072 },
    sections: [hidden('formHeader'), { kind: 'detail', height: 2268, props: {}, controls: [] }, hidden('formFooter')] };
}

/** Le contrôle lié d'un champ et son étiquette attachée (boundControlWithLabel, partagé avec A5). */
export function fieldControls(doc: DesignDoc, f: SourceField, at: { section: number; left: number; top: number }, labels: FormLabels): ControlDef[] {
  return boundControlWithLabel(doc, f, at, { objectKind: 'form', labelSuffix: labels.prefix('label') });
}

/** TabIndex 0…n dans l'ordre donné ; les autres contrôles restent tels quels. Rien ne change : la même section. */
export function withTabOrder(s: SectionDef, names: string[]): SectionDef {
  const index = new Map(names.map((n, i) => [n, i]));
  const controls = s.controls.map((c) => (index.has(c.name) && c.props.TabIndex !== index.get(c.name) ? { ...c, props: { ...c.props, TabIndex: index.get(c.name) } } : c));
  return controls.every((c, i) => c === s.controls[i]) ? s : { ...s, controls };
}

export const AUTO = { gap: cmToTwips(0.15), label: cmToTwips(0.5), control: cmToTwips(3.5), header: cmToTwips(1.2), footer: cmToTwips(0.5) };

/** Largeur du contrôle d'un champ dans un formulaire instantané ; undefined : celle de boundControlWithLabel (case à cocher…). */
export function autoWidth(f: SourceField): { width: number; height?: number } | undefined {
  switch (f.type) {
    case 'shortText': return { width: Math.min(Math.max(cmToTwips(Math.min(f.props.size ?? 255, 50) * 0.2), cmToTwips(2)), cmToTwips(8)) };
    case 'longText': return { width: cmToTwips(8), height: cmToTwips(1.8) };
    case 'autoNumber': case 'number': case 'currency': case 'dateTime': return { width: cmToTwips(3) };
    default: return undefined;
  }
}

/**
 * Formulaire instantané (Créer › Formulaire), en colonne comme celui d'Access : en-tête de 1,2 cm avec le nom de la source en titre
 * (16 pt, gras ; couleurs du catalogue), un contrôle lié et son étiquette par champ, empilés à 0,15 cm (étiquettes à 0,5 cm du bord,
 * contrôles à 3,5 cm ; une autre colonne au-delà de 55,88 cm), pied de 0,5 cm vide ; Mode par défaut Formulaire unique, ordre de
 * tabulation colonne par colonne, largeur ajustée
 * au contrôle le plus large + 0,5 cm. Couleurs de thème seulement (aucune n'est écrite).
 */
export function autoForm(ref: RecordSourceRef, title: string, info: SourceInfo, labels: FormLabels): DesignDoc {
  const base = emptyFormDoc(ref);
  const titleLabel: ControlDef = { kind: 'label', name: 'Auto_Header0', left: AUTO.label, top: cmToTwips(0.2), width: cmToTwips(9), height: cmToTwips(0.8),
    props: { Caption: title, FontSize: 16, FontWeight: 'bold' } };
  let doc: DesignDoc = { ...base, sections: [
    { kind: 'formHeader', height: AUTO.header, props: { Visible: true }, controls: [titleLabel] },
    { ...base.sections[1], controls: [] },
    { kind: 'formFooter', height: AUTO.footer, props: { Visible: true }, controls: [] },
  ] };
  let top = AUTO.gap;
  let x0 = 0;          // bord gauche de la colonne : une autre commence après son contrôle le plus large quand le Détail dépasserait la limite d'Access
  let colRight = 0;
  for (const f of info.fields) {
    const [c] = fieldControls(doc, f, { section: 1, left: AUTO.control, top }, labels);
    const ctl0: ControlDef = { ...c, ...autoWidth(f) };
    if (top > AUTO.gap && top + ctl0.height > MAX_TWIPS) { x0 = colRight; top = AUTO.gap; }
    // ponytail: au-delà de 55,88 cm de colonnes (des centaines de champs Texte long), la dernière est ramenée dans la limite et peut chevaucher
    const left = Math.min(x0 + AUTO.control, MAX_TWIPS - ctl0.width);
    const ctl: ControlDef = { ...ctl0, left, top,
      children: c.children!.map((l) => ({ ...l, left: left - AUTO.control + AUTO.label, top, width: AUTO.control - AUTO.label - (c.left - l.left - l.width) })) };
    const detail = doc.sections[1];
    doc = { ...doc, sections: doc.sections.map((s, i) => (i === 1 ? { ...detail, controls: [...detail.controls, ctl] } : s)) };
    colRight = Math.max(colRight, left + ctl.width);
    top += ctl.height + AUTO.gap;
  }
  // Une seule colonne : les champs forment une disposition Empilée (comme Access) ; elle remplace l'espacement de 0,15 cm par ROW_GAP.
  // ponytail: several columns would need one layout each; add when asked
  if (!x0) {
    const laid = createLayout(doc, membersOf(doc, doc.sections[1].controls.map((c) => c.name)), 'stacked', { headerSection: 'detail' });
    if (laid.sections[1].controls.every((c) => c.top + c.height <= MAX_TWIPS)) doc = laid;
  }
  const bottom = Math.max(0, ...doc.sections[1].controls.map((c) => c.top + c.height));
  // ordre de tabulation : la première colonne de haut en bas, puis la suivante (une colonne : l'ordre automatique d'Access)
  const placed = doc.sections[1];
  const detail = withTabOrder({ ...placed, height: info.fields.length ? Math.min(bottom + AUTO.gap, MAX_TWIPS) : base.sections[1].height }, placed.controls.filter((c) => TAB_KINDS.includes(c.kind)).map((c) => c.name));
  const right = Math.max(...doc.sections.flatMap((s) => s.controls.map((c) => c.left + c.width)));
  return { ...doc, props: { ...doc.props, Width: Math.min(right + AUTO.label, MAX_TWIPS), DefaultView: 'single' }, sections: doc.sections.map((s, i) => (i === 1 ? detail : s)) };
}
