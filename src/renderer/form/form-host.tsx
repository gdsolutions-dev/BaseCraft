// Hôte des formulaires pour le concepteur générique : outils de la boîte à outils, aperçu des contrôles en mode Création (maquette,
// écran 2), création d'un contrôle posé, menu de la barre de section (En-tête/pied de formulaire).
import {
  AppWindow, ChevronDown, ChevronsUpDown, CircleDot, Group, Image as ImageIcon, LetterText, List, Minus, PanelTop, RectangleHorizontal,
  SeparatorHorizontal, Square, SquareCheck, TextCursorInput,
} from 'lucide-react';
import { useMemo, type CSSProperties, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import type { ControlDef, ControlKind, DesignDoc, SectionDef } from '../../shared/design/model';
import { sameName } from '../../shared/field-types';
import type { DesignerHost, ToolDef } from '../designer/Designer';
import { findControl } from '../designer/designer-model';
import type { Rect } from '../designer/geometry';
import { controlSourceToDisplay } from '../designer/property-sheet-model';
import type { PropertySheetContext } from '../designer/sheet-types';
import { MAX_TWIPS } from '../designer/units';
import { nextTabIndex, TAB_KINDS } from '../designer/field-controls';
import { formLabels, headerFooterShown, toggleHeaderFooter, type FormLabels } from './form-def';
import { applies, color, controlLook, prop } from './run-model';

/** Dans l'ordre de la maquette ; libellés : l'entrée de la galerie Contrôles du ruban. */
export const FORM_TOOLS: ToolDef[] = [
  { kind: 'label', icon: LetterText, labelKey: 'ribbon.cmd.label' },
  { kind: 'textBox', icon: TextCursorInput, labelKey: 'ribbon.cmd.textBox' },
  { kind: 'commandButton', icon: RectangleHorizontal, labelKey: 'ribbon.cmd.button' },
  { kind: 'comboBox', icon: ChevronsUpDown, labelKey: 'ribbon.cmd.comboBox' },
  { kind: 'listBox', icon: List, labelKey: 'ribbon.cmd.listBox' },
  { kind: 'checkBox', icon: SquareCheck, labelKey: 'ribbon.cmd.checkBox' },
  { kind: 'optionGroup', icon: Group, labelKey: 'ribbon.cmd.optionGroup' },
  { kind: 'optionButton', icon: CircleDot, labelKey: 'ribbon.cmd.optionButton' },
  { kind: 'tabControl', icon: PanelTop, labelKey: 'ribbon.cmd.tabControl' },
  { kind: 'subform', icon: AppWindow, labelKey: 'ribbon.cmd.subform' },
  { kind: 'image', icon: ImageIcon, labelKey: 'ribbon.cmd.image' },
  { kind: 'rectangle', icon: Square, labelKey: 'ribbon.cmd.rectangle' },
  { kind: 'line', icon: Minus, labelKey: 'ribbon.cmd.line' },
  { kind: 'pageBreak', icon: SeparatorHorizontal, labelKey: 'ribbon.cmd.insertPageBreak' },
];

const LABEL_WIDTH = 1418, GAP = 57, BOX = 284;   // étiquette attachée 2,5 cm à gauche ; case 0,5 cm
const DEFAULT_CLICK = { width: 1418, height: 340 };   // la taille d'un simple clic (pointer.ts)
const WITH_LABEL: ControlKind[] = ['textBox', 'comboBox', 'listBox'];

/** Le premier « préfixe + n » libre (n ≥ 1), comme Access (Texte1, Étiquette2…) ; `taken` : noms déjà pris dans ce même ajout. */
export function nextName(doc: DesignDoc, prefix: string, taken: string[]): string {
  for (let n = 1; ; n++) { const name = `${prefix}${n}`; if (!findControl(doc, name) && !taken.some((x) => sameName(x, name))) return name; }
}

/** Les contrôles d'un outil posé dans `rect` (twips, relatifs à la section). */
export function newFormControls(kind: ControlKind, rect: Rect, section: number, doc: DesignDoc, labels: FormLabels): ControlDef[] {
  const s = doc.sections[section];
  if (!s) return [];
  const name = nextName(doc, labels.prefix(kind), []);
  const click = rect.width === DEFAULT_CLICK.width && rect.height === DEFAULT_CLICK.height;
  const r = { ...rect };
  if (click && (kind === 'checkBox' || kind === 'optionButton')) { r.width = BOX; r.height = BOX; }
  if (click && kind === 'line') r.height = 0;   // un clic pose un trait horizontal
  const props: Record<string, unknown> = {};
  if (TAB_KINDS.includes(kind)) props.TabIndex = nextTabIndex(s);
  if (kind === 'optionGroup' || kind === 'label' || kind === 'commandButton') props.Caption = name;
  if (kind === 'tabControl') props.Pages = [labels.tabPage(1), labels.tabPage(2)];
  const label = (g: Rect, caption: string): ControlDef =>
    ({ kind: 'label', name: nextName(doc, labels.prefix('label'), [name]), ...g, props: { Caption: caption } });
  if (WITH_LABEL.includes(kind)) {
    r.left = Math.min(Math.max(r.left, LABEL_WIDTH), MAX_TWIPS - r.width);   // l'étiquette reste dans la section
    return [{ kind, name, ...r, props, children: [label({ left: r.left - LABEL_WIDTH, top: r.top, width: LABEL_WIDTH - GAP, height: Math.min(r.height, 340) }, `${name}:`)] }];
  }
  // hors d'un groupe d'options, une case porte son étiquette à droite (dans un groupe, le groupe a sa légende)
  const inGroup = s.controls.some((c) => c.kind === 'optionGroup' && r.left >= c.left && r.left < c.left + c.width && r.top >= c.top && r.top < c.top + c.height);
  if ((kind === 'checkBox' || kind === 'optionButton') && !inGroup) {
    const left = Math.min(r.left + r.width + GAP, MAX_TWIPS - LABEL_WIDTH);
    return [{ kind, name, ...r, props, children: [label({ left, top: r.top, width: LABEL_WIDTH, height: Math.max(r.height, 284) }, name)] }];
  }
  return [{ kind, name, ...r, props }];
}

/** Barres de l'en-tête et du pied : En-tête/pied de formulaire, avec confirmation quand les masquer supprime des contrôles. */
export const formSectionMenu: NonNullable<DesignerHost['sectionMenu']> = (index, doc) => {
  const k = doc.sections[index]?.kind;
  if (k !== 'formHeader' && k !== 'formFooter') return [];
  const losing = headerFooterShown(doc) && doc.sections.some((s) => (s.kind === 'formHeader' || s.kind === 'formFooter') && s.controls.length > 0);
  return [{ id: 'headerFooter', labelKey: 'form.headerFooter', action: { type: 'edit', apply: toggleHeaderFooter }, ...(losing ? { confirmKey: 'form.headerFooterConfirm' } : {}) }];
};

// ---- aperçu

function boxStyle(c: ControlDef): CSSProperties {
  const st = controlLook(c);   // as in Form view
  if (applies(c, 'TextAlign')) {
    const a = String(prop(c, 'TextAlign'));
    st.justifyContent = a === 'center' ? 'center' : a === 'right' ? 'flex-end' : 'flex-start';
  }
  return st;
}

function preview(c: ControlDef, display: PropertySheetContext['display'], unbound: string): ReactNode {
  const st = boxStyle(c);
  const source = () => controlSourceToDisplay(typeof prop(c, 'ControlSource') === 'string' ? String(prop(c, 'ControlSource')) : undefined, display) || unbound;
  switch (c.kind) {
    case 'label': return <div className="fz fz-text" style={st}>{String(prop(c, 'Caption') ?? '')}</div>;
    case 'textBox': return <div className="fz fz-text" style={st}><span className="fz-clip">{source()}</span></div>;
    case 'comboBox': return <div className="fz fz-text fz-combo" style={st}><span className="fz-clip">{source()}</span><ChevronDown size={14} aria-hidden /></div>;
    case 'listBox': return <div className="fz fz-list" style={st}><span className="fz-clip">{source()}</span></div>;
    case 'checkBox': return <div className="fz fz-check" style={{ borderColor: color(c, 'BorderColor') }} />;
    case 'optionButton': return <div className="fz fz-check fz-radio" />;
    case 'optionGroup': return <fieldset className="fz fz-group" style={st}><legend>{String(prop(c, 'Caption') ?? '')}</legend></fieldset>;
    case 'commandButton': return <div className="fz fz-text fz-button" style={st}>{String(prop(c, 'Caption') ?? '')}</div>;
    case 'subform': return <div className="fz fz-subform" style={st}><span className="fz-clip">{String(prop(c, 'SourceObject') ?? '')}</span></div>;
    case 'image': {
      const pic = prop(c, 'Picture');
      const fit = ({ clip: 'none', stretch: 'fill', zoom: 'contain' } as Record<string, CSSProperties['objectFit']>)[String(prop(c, 'SizeMode'))] ?? 'contain';
      return <div className="fz fz-image" style={st}>
        {typeof pic === 'string' && pic.startsWith('data:image/') ? <img src={pic} alt="" draggable={false} style={{ objectFit: fit }} /> : <ImageIcon size={18} aria-hidden />}
      </div>;
    }
    case 'rectangle': return <div className="fz" style={st} />;
    case 'line': {
      const slant = prop(c, 'LineSlant') === true;   // faux : du coin haut gauche au coin bas droit (Access)
      const stroke = prop(c, 'BorderStyle') === 'transparent' ? 'transparent' : color(c, 'BorderColor');
      const w = Math.max(1, Number(prop(c, 'BorderWidth')) || 0);
      const dash = ({ dashed: '6 3', dotted: '1 3' } as Record<string, string>)[String(prop(c, 'BorderStyle'))];
      const [y1, y2] = c.height === 0 ? [0.5, 0.5] : slant ? [1, 0] : [0, 1];
      const [x1, x2] = c.width === 0 ? [0.5, 0.5] : [0, 1];
      return <svg className="fz fz-line" viewBox="0 0 1 1" preserveAspectRatio="none" aria-hidden>
        <line x1={x1} y1={y1} x2={x2} y2={y2} stroke={stroke} strokeWidth={w} strokeDasharray={dash} vectorEffect="non-scaling-stroke" />
      </svg>;
    }
    case 'pageBreak': return <div className="fz fz-pagebreak" />;
    case 'tabControl': {
      const v = prop(c, 'Pages');
      const pages = Array.isArray(v) ? v.map(String) : [];
      return <div className="fz fz-tabs" style={st}><div className="fz-tabstrip">{pages.map((x, i) => <span key={i} className={i === 0 ? 'is-on' : ''}>{x}</span>)}</div></div>;
    }
  }
}

/** L'hôte des formulaires. `renderControl` ne dépend que de l'affichage (langue, région) et du texte « Indépendant » : de nouveaux
 *  champs ou de nouvelles listes dans la feuille ne redessinent aucun contrôle (CanvasControl compare la fonction). */
export function useFormHost(sheet: PropertySheetContext): { host: DesignerHost; labels: FormLabels } {
  const { t } = useTranslation();
  const unbound = t('form.unbound');
  const { display } = sheet;
  const renderControl = useMemo(() => (c: ControlDef) => preview(c, display, unbound), [display, unbound]);
  const labels = useMemo(() => formLabels(t), [t]);
  const host = useMemo<DesignerHost>(() => ({
    target: 'form',
    tools: FORM_TOOLS,
    sectionLabel: (s: SectionDef) => t(`designer.section.${s.kind}`),
    renderControl,
    newControls: (kind, rect, section, doc) => newFormControls(kind, rect, section, doc, labels),
    sectionMenu: formSectionMenu,
    sheet,
  }), [t, sheet, renderControl, labels]);
  return { host, labels };
}
