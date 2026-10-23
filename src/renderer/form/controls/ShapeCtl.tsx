// Trait et rectangle (un saut de page ne dessine rien) : rectangle en bordure CSS, trait en SVG, du coin haut droit au coin bas
// gauche quand Trait oblique (LineSlant) est vrai.
import { colorCss } from '../../../shared/design/colors';
import { prop } from '../run-model';
import { tipOf, type CtlProps } from './run-ctx';

const DASH: Record<string, string> = { dashed: '6 3', dotted: '1 3' };

export function ShapeCtl({ c, style }: CtlProps) {
  if (c.kind === 'pageBreak') return null;
  if (c.kind === 'rectangle') return <div className="frun-shape" style={style} data-testid={`form-ctl-${c.name}`} {...tipOf(c)} />;
  const b = String(prop(c, 'BorderStyle'));
  const stroke = b === 'transparent' ? 'transparent' : colorCss(prop(c, 'BorderColor'), 'theme:border');
  const w = Math.max(1, Number(prop(c, 'BorderWidth')) || 0);
  const slant = prop(c, 'LineSlant') === true;
  const [y1, y2] = c.height === 0 ? [0.5, 0.5] : [0, 1];
  const [x1, x2] = c.width === 0 ? [0.5, 0.5] : slant ? [1, 0] : [0, 1];
  return (
    <svg className="frun-line" style={style} viewBox="0 0 1 1" preserveAspectRatio="none" aria-hidden data-testid={`form-ctl-${c.name}`}>
      <line x1={x1} y1={y1} x2={x2} y2={y2} stroke={stroke} strokeWidth={w} strokeDasharray={DASH[b]} vectorEffect="non-scaling-stroke" />
    </svg>
  );
}
