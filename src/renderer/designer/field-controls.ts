// Un champ de la source posé sur une section (Liste des champs, formulaire instantané) : le contrôle lié et son étiquette attachée,
// comme Access les crée. Générique : l'hôte des formulaires (A4) et celui des états (A5) l'appellent depuis leur `onAdd`.
import { flattenControls, type ControlDef, type ControlKind, type DesignDoc, type SectionDef } from '../../shared/design/model';
import { PROPERTY_CATALOG } from '../../shared/design/properties';
import { LOOKUP_TYPES } from '../../shared/field-types';
import type { SourceField } from '../../shared/record-source';
import { uniqueName } from './designer-model';
import { MAX_TWIPS } from './units';

const LABEL_WIDTH = 1418;   // 2,5 cm à gauche du contrôle, étiquette comprise
const LABEL_GAP = 57;       // 0,1 cm entre l'étiquette et son contrôle
const HEIGHT = 340;         // 0,6 cm
/** Les genres de contrôles qui ont un arrêt de tabulation (ceux auxquels s'applique TabIndex). */
export const TAB_KINDS = PROPERTY_CATALOG.find((d) => d.name === 'TabIndex')!.appliesTo;

/** Le TabIndex suivant d'une section : après le plus grand, ou le nombre de contrôles à arrêt de tabulation (contenus compris). */
export function nextTabIndex(s: SectionDef | undefined): number {
  const tabbable = flattenControls(s?.controls ?? []).filter((c) => TAB_KINDS.includes(c.kind));
  return Math.max(tabbable.length, ...tabbable.map((c) => (typeof c.props.TabIndex === 'number' ? c.props.TabIndex + 1 : 0)));
}

const lookupOf = (f: SourceField) => (LOOKUP_TYPES.includes(f.type) ? f.props.lookup : undefined);

/** Liste de valeurs ou table (pas un ancien lookup à boundField, ni une liste de champs) : zone de liste si Display Control le dit,
 *  sinon zone de liste déroulante ; Oui/Non : case à cocher ; le reste : zone de texte. */
export function controlKindFor(f: SourceField): ControlKind {
  const l = lookupOf(f);
  if (l && (l.kind === 'values' || (l.kind === 'table' && l.boundField === undefined))) return l.displayControl === 'listBox' ? 'listBox' : 'comboBox';
  return f.type === 'yesNo' ? 'checkBox' : 'textBox';
}

/** L'onglet Liste de choix (A2) recopié tel quel, seulement les clés que le champ a. */
function lookupProps(f: SourceField, kind: ControlKind): Record<string, unknown> {
  const l = lookupOf(f);
  if (!l || (kind !== 'comboBox' && kind !== 'listBox') || l.kind === 'fieldList') return {};
  return {
    ...(l.kind === 'values' ? { RowSourceType: 'valueList', RowSource: l.values.join(';') } : { RowSourceType: 'tableQuery', RowSource: l.table }),
    ...(l.boundColumn !== undefined ? { BoundColumn: l.boundColumn } : {}),
    ...(l.columnCount !== undefined ? { ColumnCount: l.columnCount } : {}),
    ...(l.columnWidths !== undefined ? { ColumnWidths: l.columnWidths.join(';') } : {}),
    ...(l.columnHeads !== undefined ? { ColumnHeads: l.columnHeads } : {}),
    ...(kind === 'comboBox' ? { LimitToList: l.limitToList } : {}),
  };
}

/** Le contrôle lié (4 cm, 0,5 cm pour une case à cocher ; 0,6 cm de haut) au point `at`, son étiquette attachée 2,5 cm à gauche
 *  (Caption = la légende du champ ou son nom, suivie de « : »), décalé vers la droite si l'étiquette sortirait de la section.
 *  Noms rendus uniques ; dans un formulaire, le TabIndex suivant de la section.
 *  Un dépôt près du bas agrandit la section (le réducteur l'ajuste à l'insertion) ; position bornée à MAX_TWIPS. `labelSuffix` : « Étiquette » ou « Label » (traduit par l'hôte). */
export function boundControlWithLabel(doc: DesignDoc, f: SourceField, at: { section: number; left: number; top: number },
  opts: { objectKind: 'form' | 'report'; labelSuffix: string }): ControlDef[] {
  const kind = controlKindFor(f);
  const name = uniqueName(doc, f.name);
  const width = kind === 'checkBox' ? 284 : 2268;
  // la section s'agrandit au dépôt (fit, dans le réducteur) ; le contrôle reste dans la limite d'Access
  const left = Math.min(Math.max(at.left, LABEL_WIDTH), MAX_TWIPS - width), top = Math.min(Math.max(0, at.top), MAX_TWIPS - HEIGHT);
  const tabIndex = nextTabIndex(doc.sections[at.section]);
  const label: ControlDef = { kind: 'label', name: uniqueName(doc, `${name}_${opts.labelSuffix}`), left: left - LABEL_WIDTH, top, width: LABEL_WIDTH - LABEL_GAP,
    height: HEIGHT, props: { Caption: `${f.props.caption || f.name}:` } };
  return [{ kind, name, left, top, width, height: HEIGHT,
    props: { ControlSource: f.name, ...(opts.objectKind === 'form' ? { TabIndex: tabIndex } : {}), ...lookupProps(f, kind) }, children: [label] }];
}
