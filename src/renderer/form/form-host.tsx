// Hôte des formulaires pour le concepteur générique : outils de la boîte à outils, aperçu des contrôles en mode Création (maquette,
// écran 2), création d'un contrôle posé, menu de la barre de section (En-tête/pied de formulaire).
import {
  AppWindow, ChevronDown, ChevronsUpDown, CircleDot, Group, Image as ImageIcon, LetterText, List, Minus, PanelTop, RectangleHorizontal,
  Navigation, SeparatorHorizontal, Square, SquareCheck, TextCursorInput, ToggleLeft,
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
import { parseTargets } from './nav-targets';
import { DesignChart } from './controls/ChartCtl';
import { DesignButton, DesignImage } from './controls/ImageCtl';
import { applies, color, controlLook, gridlineStyle, linkAddress, LINK_LOOK, prop, type ThemeCtx } from './run-model';
import { useDocTheme } from '../design/doc-theme';

/** Dans l'ordre de la maquette ; libellés : l'entrée de la galerie Contrôles du ruban. */
export const FORM_TOOLS: ToolDef[] = [
  { kind: 'label', icon: LetterText, labelKey: 'ribbon.cmd.label' },
  { kind: 'textBox', icon: TextCursorInput, labelKey: 'ribbon.cmd.textBox' },
  { kind: 'commandButton', icon: RectangleHorizontal, labelKey: 'ribbon.cmd.button' },
  { kind: 'comboBox', icon: ChevronsUpDown, labelKey: 'ribbon.cmd.comboBox' },
  { kind: 'listBox', icon: List, labelKey: 'ribbon.cmd.listBox' },
  { kind: 'toggleButton', icon: ToggleLeft, labelKey: 'ribbon.cmd.toggleButton' },
  { kind: 'checkBox', icon: SquareCheck, labelKey: 'ribbon.cmd.checkBox' },
  { kind: 'optionGroup', icon: Group, labelKey: 'ribbon.cmd.optionGroup' },
  { kind: 'optionButton', icon: CircleDot, labelKey: 'ribbon.cmd.optionButton' },
  { kind: 'tabControl', icon: PanelTop, labelKey: 'ribbon.cmd.tabControl' },
  { kind: 'subform', icon: AppWindow, labelKey: 'ribbon.cmd.subform' },
  { kind: 'navigationControl', icon: Navigation, labelKey: 'ribbon.cmd.navigationControl' },
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
  if (click && kind === 'navigationControl') { r.width = 6804; r.height = 3402; }   // 12 × 6 cm: tabs over the form shown below
  if (click && kind === 'line') r.height = 0;   // un clic pose un trait horizontal
  if (click && kind === 'chart') { r.width = 4800; r.height = 2800; }   // un clic pose un graphique de taille utile (une étiquette de 2,5 cm ne montre rien)
  const props: Record<string, unknown> = {};
  if (TAB_KINDS.includes(kind)) props.TabIndex = nextTabIndex(s);
  if (kind === 'optionGroup' || kind === 'label' || kind === 'commandButton' || kind === 'toggleButton') props.Caption = name;
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

function boxStyle(c: ControlDef, tc: ThemeCtx): CSSProperties {
  const st = controlLook(c, tc);   // as in Form view
  if (applies(c, 'TextAlign')) {
    const a = String(prop(c, 'TextAlign'));
    st.justifyContent = a === 'center' ? 'center' : a === 'right' ? 'flex-end' : 'flex-start';
  }
  return st;
}

/** L'aperçu d'un contrôle ; `live` (mode Page) : le texte de l'enregistrement courant au lieu de la source, l'état de la case. */
export function preview(c: ControlDef, display: PropertySheetContext['display'], unbound: string, live?: { text?: string; checked?: boolean }): ReactNode {
  return <Preview c={c} display={display} unbound={unbound} live={live} />;
}

/** Un composant (pas un appel) : il lit le thème effectif et le mode du contexte, et se redessine quand ils changent. */
function Preview({ c, display, unbound, live }: { c: ControlDef; display: PropertySheetContext['display']; unbound: string; live?: { text?: string; checked?: boolean } }) {
  const tc = useDocTheme();
  const grid = gridlineStyle(c, c, tc);   // relative to the control's own box (the canvas wrapper), a sibling of the preview
  const body = previewBody(c, display, unbound, tc, live);
  return grid ? <>{body}<div aria-hidden data-testid={`grid-${c.name}`} style={grid} /></> : body;
}

function previewBody(c: ControlDef, display: PropertySheetContext['display'], unbound: string, tc: ThemeCtx, live?: { text?: string; checked?: boolean }): ReactNode {
  const st = boxStyle(c, tc);
  const source = () => live?.text ?? (controlSourceToDisplay(typeof prop(c, 'ControlSource') === 'string' ? String(prop(c, 'ControlSource')) : undefined, display) || unbound);
  const on = live?.checked ? ' is-on' : '';
  switch (c.kind) {
    case 'label': return <div className="fz fz-text" style={linkAddress(c) ? { ...st, ...LINK_LOOK } : st}>{String(prop(c, 'Caption') ?? '')}</div>;
    case 'textBox': return <div className="fz fz-text" style={st}><span className="fz-clip">{source()}</span></div>;
    case 'comboBox': return <div className="fz fz-text fz-combo" style={st}><span className="fz-clip">{source()}</span><ChevronDown size={14} aria-hidden /></div>;
    case 'listBox': return <div className="fz fz-list" style={st}><span className="fz-clip">{source()}</span></div>;
    case 'checkBox': return <div className={`fz fz-check${on}`} style={{ borderColor: color(c, 'BorderColor', tc) }} />;
    case 'optionButton': return <div className={`fz fz-check fz-radio${on}`} />;
    case 'optionGroup': return <fieldset className="fz fz-group" style={st}><legend>{String(prop(c, 'Caption') ?? '')}</legend></fieldset>;
    case 'commandButton': case 'toggleButton': return <DesignButton c={c} style={st} />;
    case 'subform': return <div className="fz fz-subform" style={st}><span className="fz-clip">{String(prop(c, 'SourceObject') ?? '')}</span></div>;
    case 'image': return <DesignImage c={c} className="fz fz-image" style={st} />;
    case 'chart': return <DesignChart c={c} className="fz fz-chart" style={st} />;
    case 'rectangle': return <div className="fz" style={st} />;
    case 'line': {
      const slant = prop(c, 'LineSlant') === true;   // faux : du coin haut gauche au coin bas droit (Access)
      const stroke = prop(c, 'BorderStyle') === 'transparent' ? 'transparent' : color(c, 'BorderColor', tc);
      const w = Math.max(1, Number(prop(c, 'BorderWidth')) || 0);
      const dash = ({ dashed: '6 3', dotted: '1 3' } as Record<string, string>)[String(prop(c, 'BorderStyle'))];
      const [y1, y2] = c.height === 0 ? [0.5, 0.5] : slant ? [1, 0] : [0, 1];
      const [x1, x2] = c.width === 0 ? [0.5, 0.5] : [0, 1];
      return <svg className="fz fz-line" viewBox="0 0 1 1" preserveAspectRatio="none" aria-hidden>
        <line x1={x1} y1={y1} x2={x2} y2={y2} stroke={stroke} strokeWidth={w} strokeDasharray={dash} vectorEffect="non-scaling-stroke" />
      </svg>;
    }
    case 'pageBreak': return <div className="fz fz-pagebreak" />;
    case 'navigationControl': return <div className="fz fz-tabs" style={st}><div className="fz-tabstrip">{parseTargets(prop(c, 'NavigationTargets')).map((x, i) => <span key={i} className={i === 0 ? 'is-on' : ''}>{x.caption}</span>)}</div></div>;
    case 'tabControl': {
      const v = prop(c, 'Pages');
      const pages = Array.isArray(v) ? v.map(String) : [];
      return <div className="fz fz-tabs" style={st}><div className="fz-tabstrip">{pages.map((x, i) => <span key={i} className={i === 0 ? 'is-on' : ''} data-tab-page={i} data-testid={`tabpage-${c.name}-${i}`}>{x}</span>)}</div></div>;
    }
  }
}

/** L'hôte des formulaires. `renderControl` ne dépend que de l'affichage (langue, région) et du texte « Indépendant » : de nouveaux
 *  champs ou de nouvelles listes dans la feuille ne redessinent aucun contrôle (CanvasControl compare la fonction). */
export function useFormHost(sheet: PropertySheetContext, onPageTabOrder?: (control: string, page: number) => void): { host: DesignerHost; labels: FormLabels } {
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
    ...(onPageTabOrder && { pageMenu: (control: string, page: number) => [{ id: 'taborder', labelKey: 'form.tabOrder.pageItem', run: () => onPageTabOrder(control, page) }] }),
    sheet,
  }), [t, sheet, renderControl, labels, onPageTabOrder]);
  return { host, labels };
}
