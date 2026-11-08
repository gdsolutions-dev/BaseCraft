// Image : <img alt={Texte d'info-bulle ?? Nom}>, ajustée selon le Mode d'affichage (clip : none, stretch : fill, zoom : contain).
import { ImageIcon } from 'lucide-react';
import type { CSSProperties } from 'react';
import { resolvePicture, type ResourceMap } from '../../../shared/pictures';
import { objectPosition, pictureCss, readAlignment } from '../../../shared/design/picture-css';
import { useResource } from '../../design/resources';
import { prop } from '../run-model';
import { tipOf, type CtlProps } from './run-ctx';

const FIT: Record<string, CSSProperties['objectFit']> = { clip: 'none', stretch: 'fill', zoom: 'contain' };

/** La source à dessiner : la donnée incorporée ou l'image de la galerie ; undefined (repère) sinon. */
export const imageSource = (props: Record<string, unknown>, resources: ResourceMap): string | undefined => resolvePicture(props, resources);

/** Source d'un contrôle image (formulaire ou état en Création) ; s'abonne à la galerie pour une image partagée. */
export function useImageSource(c: CtlProps['c']): string | undefined {
  const shared = prop(c, 'PictureType') === 'shared' && typeof prop(c, 'Picture') === 'string' ? String(prop(c, 'Picture')) : undefined;
  const data = useResource(shared);
  return imageSource({ PictureType: prop(c, 'PictureType'), Picture: prop(c, 'Picture') }, data === undefined || shared === undefined ? {} : { [shared]: data });
}

/** Mosaïque : un div au fond répété à la taille naturelle (le CSS passe par la garde de pictureCss) ; sinon null. */
export function tiledStyle(c: CtlProps['c'], src: string): CSSProperties | null {
  return prop(c, 'PictureTiling') === true ? pictureCss({ src, sizeMode: 'clip', alignment: readAlignment(prop(c, 'PictureAlignment')), tiling: true }) : null;
}
const position = (c: CtlProps['c']): string => objectPosition(readAlignment(prop(c, 'PictureAlignment')));

export function ImageCtl({ c, style }: CtlProps) {
  const pic = useImageSource(c);
  const tip = prop(c, 'ControlTipText');
  const alt = typeof tip === 'string' && tip ? tip : c.name;
  const fit = FIT[String(prop(c, 'SizeMode'))] ?? 'contain';
  if (!pic) return <div role="img" aria-label={alt} className="frun-image" style={style} data-testid={`form-ctl-${c.name}`} {...tipOf(c)} />;
  const tiled = tiledStyle(c, pic);
  if (tiled) return <div role="img" aria-label={alt} className="frun-image" style={{ ...style, ...tiled }} data-testid={`form-ctl-${c.name}`} {...tipOf(c)} />;
  return <img src={pic} alt={alt} className="frun-image" style={{ ...style, objectFit: fit, objectPosition: position(c) }} data-testid={`form-ctl-${c.name}`} draggable={false} {...tipOf(c)} />;
}

/** Le bouton de commande en Création : l'image éventuelle avant la légende. */
export function DesignButton({ c, style }: { c: CtlProps['c']; style: CSSProperties }) {
  const src = useImageSource(c);
  return <div className="fz fz-text fz-button" style={style}>{src && <img src={src} alt="" className="frun-button-pic" draggable={false} />}{String(prop(c, 'Caption') ?? '')}</div>;
}

/** L'aperçu d'un contrôle image en Création (formulaires et états) : l'image, ou le repère quand elle manque. */
export function DesignImage({ c, className, style }: { c: CtlProps['c']; className: string; style: CSSProperties }) {
  const src = useImageSource(c);
  return <div className={className} style={style}>
    {src ? tiledStyle(c, src) ? <div style={{ width: '100%', height: '100%', ...tiledStyle(c, src) }} />
      : <img src={src} alt="" draggable={false} style={{ objectFit: FIT[String(prop(c, 'SizeMode'))] ?? 'contain', objectPosition: position(c) }} /> : <ImageIcon size={18} aria-hidden />}
  </div>;
}
