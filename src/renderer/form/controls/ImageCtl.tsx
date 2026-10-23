// Image : <img alt={Texte d'info-bulle ?? Nom}>, ajustée selon le Mode d'affichage (clip : none, stretch : fill, zoom : contain).
import type { CSSProperties } from 'react';
import { prop } from '../run-model';
import { tipOf, type CtlProps } from './run-ctx';

const FIT: Record<string, CSSProperties['objectFit']> = { clip: 'none', stretch: 'fill', zoom: 'contain' };

export function ImageCtl({ c, style }: CtlProps) {
  const pic = prop(c, 'Picture');
  const tip = prop(c, 'ControlTipText');
  const alt = typeof tip === 'string' && tip ? tip : c.name;
  const fit = FIT[String(prop(c, 'SizeMode'))] ?? 'contain';
  if (typeof pic !== 'string' || !pic.startsWith('data:image/')) return <div role="img" aria-label={alt} className="frun-image" style={style} data-testid={`form-ctl-${c.name}`} {...tipOf(c)} />;
  return <img src={pic} alt={alt} className="frun-image" style={{ ...style, objectFit: fit }} data-testid={`form-ctl-${c.name}`} draggable={false} {...tipOf(c)} />;
}
