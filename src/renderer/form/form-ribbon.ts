// Ruban › Création de formulaire : la galerie Contrôles (le même outil que la boîte à outils) et En-tête/pied (Logo, Titre, Date et heure).
import type { ControlDef, ControlKind, DesignDoc } from '../../shared/design/model';
import { effectiveProp } from '../../shared/design/properties';
import { sectionBottomLimit } from '../designer/designer-model';
import { intersects } from '../designer/geometry';
import { MAX_TWIPS } from '../designer/units';
import type { CommandId } from '../shell/ribbon-model';
import { headerFooterShown, nextTabIndex, toggleHeaderFooter, type FormLabels } from './form-def';
import { nextName } from './form-host';

/** Les 15 contrôles de l'étape A ; null = Sélectionner. Les entrées 'later' de la galerie n'y sont pas. */
export const GALLERY_TOOLS: Partial<Record<CommandId, ControlKind | null>> = {
  select: null, textBox: 'textBox', label: 'label', button: 'commandButton', tabControl: 'tabControl', optionGroup: 'optionGroup',
  insertPageBreak: 'pageBreak', comboBox: 'comboBox', line: 'line', listBox: 'listBox', rectangle: 'rectangle', checkBox: 'checkBox',
  optionButton: 'optionButton', subform: 'subform', image: 'image',
};

const GAP = 113;                                // 0,2 cm entre le logo et le titre
const LOGO = 851;                               // 1,5 cm
const TITLE = { width: 5103, height: 567 };     // 9 × 1 cm
const STAMP = { width: 2835, height: 340 };     // 5 × 0,6 cm

/** La première place libre en haut de la section, de gauche à droite : après chaque contrôle qui la recouvre (+ 0,2 cm). */
function firstFreeLeft(controls: ControlDef[], size: { width: number; height: number }): number {
  let left = 0;
  for (;;) {
    const hit = controls.find((c) => intersects(c, { left, top: 0, ...size }));
    if (!hit || left >= MAX_TWIPS - size.width) return Math.min(left, MAX_TWIPS - size.width);
    left = hit.left + hit.width + GAP;
  }
}

/**
 * Affiche l'en-tête (et le pied, comme toggleHeaderFooter) s'il est masqué, puis y ajoute, noms rendus uniques : le logo et le titre
 * à la première place libre depuis la gauche (le titre après le logo ; un logo ajouté ensuite, après le titre), la date et l'heure au bord droit. La section grandit pour les contenir.
 */
export function headerItem(doc: DesignDoc, item: 'logo' | 'title' | 'dateTime', ctx: { title: string; picture?: string; labels: FormLabels }): DesignDoc {
  const d = headerFooterShown(doc) ? doc : toggleHeaderFooter(doc);
  const index = d.sections.findIndex((s) => s.kind === 'formHeader');
  if (index < 0) return doc;
  const header = d.sections[index];
  const name = (kind: ControlKind, taken: string[] = []) => nextName(d, ctx.labels.prefix(kind), taken);
  let added: ControlDef[];
  if (item === 'logo') {
    added = [{ kind: 'image', name: name('image'), left: firstFreeLeft(header.controls, { width: LOGO, height: LOGO }), top: 0, width: LOGO, height: LOGO, props: { ...(ctx.picture ? { Picture: ctx.picture } : {}), SizeMode: 'zoom' } }];
  } else if (item === 'title') {
    added = [{ kind: 'label', name: name('label'), left: firstFreeLeft(header.controls, TITLE), top: 0, ...TITLE, props: { Caption: ctx.title, FontSize: 18 } }];
  } else {
    const width = Number(effectiveProp(d.props, 'Width', 'form', 'form'));
    const left = Math.min(Math.max(0, (Number.isFinite(width) ? width : 0) - STAMP.width), MAX_TWIPS - STAMP.width);
    const date = name('textBox');
    const tab = nextTabIndex(header);
    added = [
      { kind: 'textBox', name: date, left, top: 0, ...STAMP, props: { ControlSource: '=Date()', Format: 'longDate', TabIndex: tab } },
      { kind: 'textBox', name: name('textBox', [date]), left, top: STAMP.height, ...STAMP, props: { ControlSource: '=Time()', Format: 'longTime', TabIndex: tab + 1 } },
    ];
  }
  const controls = [...header.controls, ...added];
  const height = Math.max(header.height, Math.min(sectionBottomLimit({ ...header, controls }), MAX_TWIPS));
  return { ...d, sections: d.sections.map((s, i) => (i === index ? { ...s, height, controls } : s)) };
}
