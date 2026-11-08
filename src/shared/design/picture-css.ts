// Image d'arrière-plan d'un formulaire ou d'un état : la lecture des propriétés et le CSS. Module pur.
import { resolvePicture, type ResourceMap } from '../pictures';

export type PictureSizeMode = 'clip' | 'stretch' | 'zoom' | 'stretchH' | 'stretchV';
export type PictureAlignment = 'topLeft' | 'topRight' | 'center' | 'bottomLeft' | 'bottomRight' | 'formCenter';
export interface PictureSpec { src: string; sizeMode: PictureSizeMode; alignment: PictureAlignment; tiling: boolean }

const SIZE: Record<PictureSizeMode, string> = { clip: 'auto', stretch: '100% 100%', zoom: 'contain', stretchH: '100% auto', stretchV: 'auto 100%' };
const POSITION: Record<PictureAlignment, string> = { topLeft: 'left top', topRight: 'right top', center: 'center', formCenter: 'center', bottomLeft: 'left bottom', bottomRight: 'right bottom' };
// Seule une URL de données base64 d'image raster atteint le CSS (jamais de SVG, de guillemet ni de parenthèse). Plus souple que
// parsePictureDataUrl : un PNG ancien stocké en `data:image/jpeg` garde son fond.
const CSS_SAFE = /^data:image\/(?!svg)[a-z+.-]+;base64,[A-Za-z0-9+/=]*$/;

const oneOf = <T extends string>(v: unknown, all: Record<T, unknown>, dflt: T): T => (typeof v === 'string' && Object.hasOwn(all, v) ? (v as T) : dflt);

/** L'image de fond d'un document (ses propriétés `Picture*`), ou undefined : aucune image, introuvable, ou pas une URL d'image sûre. */
export function readPictureSpec(props: Record<string, unknown>, resources: ResourceMap): PictureSpec | undefined {
  const src = resolvePicture(props, resources);
  if (src === undefined || !CSS_SAFE.test(src)) return undefined;
  return { src, sizeMode: oneOf(props.PictureSizeMode, SIZE, 'clip'), alignment: oneOf(props.PictureAlignment, POSITION, 'center'), tiling: props.PictureTiling === true };
}

/** `object-position` d'un contrôle image (même table que le fond). */
export const objectPosition = (a: PictureAlignment): string => POSITION[a] ?? 'center';
/** Alignement lu d'une propriété : une valeur inconnue donne `center`. */
export const readAlignment = (v: unknown): PictureAlignment => oneOf(v, POSITION, 'center');

export function pictureCss(p: PictureSpec): { backgroundImage: string; backgroundSize: string; backgroundPosition: string; backgroundRepeat: string } {
  const src = CSS_SAFE.test(p.src) ? p.src : '';
  return { backgroundImage: src ? `url("${src}")` : 'none', backgroundSize: p.tiling ? 'auto' : SIZE[p.sizeMode] ?? 'auto',
    backgroundPosition: POSITION[p.alignment] ?? 'center', backgroundRepeat: p.tiling ? 'repeat' : 'no-repeat' };
}
