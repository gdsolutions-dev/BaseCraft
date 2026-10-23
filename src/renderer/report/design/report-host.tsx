// Hôte des états pour le concepteur générique (A4) : outils de la boîte à outils, aperçu des contrôles en mode Création, création
// d'un contrôle posé, menu de la barre de section (En-tête/pied de page, En-tête/pied d'état), contexte de la Feuille de propriétés.
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
const color = (c: ControlDef, name: string) => colorCss(prop(c, name), (defaultFor(desc(name), c.kind, 'report') ?? 'transparent') as ColorValue | 'transparent');
const applies = (c: ControlDef, name: string) => desc(name).appliesTo.includes(c.kind);

function boxStyle(c: ControlDef): CSSProperties {
  const st: CSSProperties = {};
  if (applies(c, 'BackStyle')) st.background = prop(c, 'BackStyle') === 'transparent' ? 'transparent' : color(c, 'BackColor');
  if (applies(c, 'BorderStyle')) {
    const b = String(prop(c, 'BorderStyle'));
    st.border = b === 'transparent' ? '1px dotted var(--bc-border)' /* repère du mode Création, non imprimé */
      : `${Math.max(1, Number(prop(c, 'BorderWidth')) || 0)}px ${b} ${color(c, 'BorderColor')}`;
  }
  if (applies(c, 'FontName')) {
    const f = resolveFont(String(prop(c, 'FontName') || 'Inter'));
    const generic = EMBEDDED_FONTS.find((x) => x.family === f.family)?.generic ?? 'sans-serif';
    Object.assign(st, { fontFamily: `"${f.family}", ${generic}`, fontSize: `${Number(prop(c, 'FontSize')) || 10}pt`, color: color(c, 'ForeColor'),
      fontWeight: prop(c, 'FontWeight') === 'bold' ? 700 : 400, fontStyle: prop(c, 'FontItalic') ? 'italic' : 'normal',
      textDecoration: prop(c, 'FontUnderline') ? 'underline' : 'none' });
  }
  if (applies(c, 'TextAlign')) {
    const a = String(prop(c, 'TextAlign'));
    st.justifyContent = a === 'center' ? 'center' : a === 'right' ? 'flex-end' : 'flex-start';
  }
  return st;
}

/** L'aperçu d'un contrôle en mode Création ; ne dépend que de `display` (règle de stabilité d'A4 : jamais du document). */
export function reportRenderControl(display: DisplayContext): DesignerHost['renderControl'] {
  const unbound = i18n.getFixedT(display.lang)('report.unbound');
  return (c: ControlDef): ReactNode => {
    const st = boxStyle(c);
    const source = () => controlSourceToDisplay(typeof prop(c, 'ControlSource') === 'string' ? String(prop(c, 'ControlSource')) : undefined, display) || unbound;
    switch (c.kind) {
      case 'label': return <div className="rz rz-text" style={st}><span className="rz-clip">{String(prop(c, 'Caption') ?? '')}</span></div>;
      case 'textBox': return <div className="rz rz-text" style={st}><span className="rz-clip">{source()}</span></div>;
      case 'comboBox': return <div className="rz rz-text" style={st}><span className="rz-clip">{source()}</span><ChevronDown size={14} aria-hidden /></div>;
      case 'checkBox': return <div className="rz rz-check" style={{ borderColor: color(c, 'BorderColor') }} />;
      case 'optionButton': return <div className="rz rz-check rz-radio" style={{ borderColor: color(c, 'BorderColor') }} />;
      case 'image': {
        const pic = prop(c, 'Picture');
        const fit = ({ clip: 'none', stretch: 'fill', zoom: 'contain' } as Record<string, CSSProperties['objectFit']>)[String(prop(c, 'SizeMode'))] ?? 'contain';
        return <div className="rz rz-image" style={st}>
          {typeof pic === 'string' && pic.startsWith('data:image/') ? <img src={pic} alt="" draggable={false} style={{ objectFit: fit }} /> : <ImageIcon size={18} aria-hidden />}
        </div>;
      }
      case 'rectangle': return <div className="rz" style={st} />;
      case 'line': {
        const slant = prop(c, 'LineSlant') === true;   // faux : du coin haut gauche au coin bas droit (Access)
        const stroke = prop(c, 'BorderStyle') === 'transparent' ? 'var(--bc-border)' : color(c, 'BorderColor');
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
  };
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
