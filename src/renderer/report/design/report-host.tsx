// Hôte des états pour le concepteur générique (A4) : outils de la boîte à outils, aperçu des contrôles en mode Création, création
// d'un contrôle posé, menu de la barre de section (En-tête/pied de page, En-tête/pied d'état), contexte de la Feuille de propriétés.
import { DesignChart } from '../../form/controls/ChartCtl';
import { DesignImage } from '../../form/controls/ImageCtl';
import type { TFunction } from 'i18next';
import {
  ChevronDown, ChevronsUpDown, CircleDot, Image as ImageIcon, LetterText, Minus, SeparatorHorizontal, Square, SquareCheck, TextCursorInput,
} from 'lucide-react';
import type { CSSProperties, ReactNode } from 'react';
import { colorCss, type ColorValue } from '../../../shared/design/colors';
import type { ControlDef, DesignDoc } from '../../../shared/design/model';
import { defaultFor, effectiveProp, PROPERTY_CATALOG } from '../../../shared/design/properties';
import type { DisplayContext } from '../../../shared/expr/localize';
import { EMBEDDED_FONTS, resolveFont } from '../../../shared/fonts';
import type { DesignerHost, ToolDef } from '../../designer/Designer';
import { controlSourceToDisplay } from '../../designer/property-sheet-model';
import type { PropertySheetContext } from '../../designer/sheet-types';
import { gridlineStyle, marginInset, themedFamily, type ThemeCtx } from '../../form/run-model';
import { useDocTheme } from '../../design/doc-theme';
import { i18n } from '../../i18n';
import { newReportControls, sectionLabel, togglePageHeaderFooter, toggleReportHeaderFooter } from './report-sections';
import './report-design.css';

/** Les contrôles que le moteur imprime (Global Constraints) ; libellés : l'entrée de la galerie Contrôles du ruban. */
export const REPORT_TOOLBOX: ToolDef[] = [
  { kind: 'label', icon: LetterText, labelKey: 'ribbon.cmd.label' },
  { kind: 'textBox', icon: TextCursorInput, labelKey: 'ribbon.cmd.textBox' },
  { kind: 'comboBox', icon: ChevronsUpDown, labelKey: 'ribbon.cmd.comboBox' },
  { kind: 'checkBox', icon: SquareCheck, labelKey: 'ribbon.cmd.checkBox' },
  { kind: 'optionButton', icon: CircleDot, labelKey: 'ribbon.cmd.optionButton' },
  { kind: 'image', icon: ImageIcon, labelKey: 'ribbon.cmd.image' },
  { kind: 'rectangle', icon: Square, labelKey: 'ribbon.cmd.rectangle' },
  { kind: 'line', icon: Minus, labelKey: 'ribbon.cmd.line' },
  { kind: 'pageBreak', icon: SeparatorHorizontal, labelKey: 'ribbon.cmd.insertPageBreak' },
];

const desc = (name: string) => PROPERTY_CATALOG.find((d) => d.name === name)!;
const prop = (c: ControlDef, name: string) => effectiveProp(c.props, name, c.kind, 'report');
const color = (c: ControlDef, name: string, tc: ThemeCtx) => colorCss(prop(c, name), (defaultFor(desc(name), c.kind, 'report') ?? 'transparent') as ColorValue | 'transparent', tc);
const applies = (c: ControlDef, name: string) => desc(name).appliesTo.includes(c.kind);

function boxStyle(c: ControlDef, tc: ThemeCtx): CSSProperties {
  const st: CSSProperties = {};
  if (applies(c, 'BackStyle')) st.background = prop(c, 'BackStyle') === 'transparent' ? 'transparent' : color(c, 'BackColor', tc);
  if (applies(c, 'BorderStyle')) {
    const b = String(prop(c, 'BorderStyle'));
    st.border = b === 'transparent' ? '1px dotted var(--bc-border)' /* repère du mode Création, non imprimé */
      : `${Math.max(1, Number(prop(c, 'BorderWidth')) || 0)}px ${b} ${color(c, 'BorderColor', tc)}`;
  }
  if (applies(c, 'FontName')) {
    const name = String(prop(c, 'FontName') || 'Inter');
    const f = resolveFont(name, tc.theme);
    const generic = EMBEDDED_FONTS.find((x) => x.family === f.family)?.generic ?? 'sans-serif';
    Object.assign(st, { fontFamily: themedFamily(name, f, generic) ?? `"${f.family}", ${generic}`, fontSize: `${Number(prop(c, 'FontSize')) || 10}pt`, color: color(c, 'ForeColor', tc),
      fontWeight: prop(c, 'FontWeight') === 'bold' ? 700 : 400, fontStyle: prop(c, 'FontItalic') ? 'italic' : 'normal',
      textDecoration: prop(c, 'FontUnderline') ? 'underline' : 'none' });
  }
  if (applies(c, 'TextAlign')) {
    const a = String(prop(c, 'TextAlign'));
    st.justifyContent = a === 'center' ? 'center' : a === 'right' ? 'flex-end' : 'flex-start';
  }
  return Object.assign(st, marginInset(c));
}

/** L'aperçu d'un contrôle en mode Création ; ne dépend que de `display` (règle de stabilité d'A4 : jamais du document). */
export function reportRenderControl(display: DisplayContext): DesignerHost['renderControl'] {
  const unbound = i18n.getFixedT(display.lang)('report.unbound');
  return (c: ControlDef): ReactNode => <Draw c={c} />;
  /** Un composant : il lit le thème du contexte (toujours le mode clair pour un état) et se redessine quand il change. */
  function Draw({ c }: { c: ControlDef }): ReactNode {
    const tc = useDocTheme();
    const grid = gridlineStyle(c, c, tc);   // a sibling over the cell rectangle, relative to the control's box
    const body = draw(c, tc);
    return grid ? <>{body}<div aria-hidden data-testid={`grid-${c.name}`} style={grid} /></> : body;
  }
  function draw(c: ControlDef, tc: ThemeCtx): ReactNode {
    const st = boxStyle(c, tc);
    const source = () => controlSourceToDisplay(typeof prop(c, 'ControlSource') === 'string' ? String(prop(c, 'ControlSource')) : undefined, display) || unbound;
    switch (c.kind) {
      case 'label': return <div className="rz rz-text" style={st}><span className="rz-clip">{String(prop(c, 'Caption') ?? '')}</span></div>;
      case 'textBox': return <div className="rz rz-text" style={st}><span className="rz-clip">{source()}</span></div>;
      case 'comboBox': return <div className="rz rz-text" style={st}><span className="rz-clip">{source()}</span><ChevronDown size={14} aria-hidden /></div>;
      case 'checkBox': return <div className="rz rz-check" style={{ borderColor: color(c, 'BorderColor', tc) }} />;
      case 'optionButton': return <div className="rz rz-check rz-radio" style={{ borderColor: color(c, 'BorderColor', tc) }} />;
      case 'image': return <DesignImage c={c} className="rz rz-image" style={st} />;
      case 'chart': return <DesignChart c={c} className="rz rz-chart" style={st} />;
      case 'rectangle': return <div className="rz" style={st} />;
      case 'line': {
        const slant = prop(c, 'LineSlant') === true;   // faux : du coin haut gauche au coin bas droit (Access)
        const stroke = prop(c, 'BorderStyle') === 'transparent' ? 'var(--bc-border)' : color(c, 'BorderColor', tc);
        const w = Math.max(1, Number(prop(c, 'BorderWidth')) || 0);
        const dash = ({ dashed: '6 3', dotted: '1 3' } as Record<string, string>)[String(prop(c, 'BorderStyle'))];
        const [y1, y2] = c.height === 0 ? [0.5, 0.5] : slant ? [1, 0] : [0, 1];
        const [x1, x2] = c.width === 0 ? [0.5, 0.5] : [0, 1];
        return <svg className="rz rz-line" viewBox="0 0 1 1" preserveAspectRatio="none" aria-hidden>
          <line x1={x1} y1={y1} x2={x2} y2={y2} stroke={stroke} strokeWidth={w} strokeDasharray={dash} vectorEffect="non-scaling-stroke" />
        </svg>;
      }
      case 'pageBreak': return <div className="rz rz-pagebreak" />;
      default: return <div className="rz rz-other" />;   // non imprimé (avertissement unsupportedControl sous la surface)
    }
  }
}

export function reportHost(p: { doc: DesignDoc; sheet: PropertySheetContext; t: TFunction; renderControl: DesignerHost['renderControl'] }): DesignerHost {
  const { doc, sheet, t } = p;
  return {
    target: 'report',
    tools: REPORT_TOOLBOX,
    sectionLabel: (s) => sectionLabel(s, doc, t, sheet.display),
    renderControl: p.renderControl,
    newControls: (kind, rect, section, d) => newReportControls(kind, rect, section, d, (k) => t(`designer.ctlPrefix.${k}`)),
    // le menu contextuel de toute barre de section d'Access
    sectionMenu: () => [
      { id: 'pageHeaderFooter', labelKey: 'report.pageHeaderFooter', action: { type: 'edit', apply: togglePageHeaderFooter } },
      { id: 'reportHeaderFooter', labelKey: 'report.headerFooter', action: { type: 'edit', apply: toggleReportHeaderFooter } },
    ],
    sheet,
  };
}
