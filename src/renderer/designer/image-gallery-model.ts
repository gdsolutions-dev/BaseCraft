// Galerie d'images (Insérer une image) : liste triée, outil de dessin armé, nom d'un fichier choisi avec Parcourir. Module pur.
import type { ControlDef, DesignDoc } from '../../shared/design/model';
import type { ResourceInfo } from '../../shared/api';
import { PICTURE_MAX_BYTES, pictureDataUrl, resourceNameFromFile, isResourceName, sniffPicture, type PictureKind } from '../../shared/pictures';
import type { ToolState } from './Designer';
import { pictureCss, type PictureSpec } from '../../shared/design/picture-css';
import { gridStep, twipsToPx } from './units';
import type { CSSProperties } from 'react';

/** L'URL de données d'un fichier image choisi : taille puis type d'après la signature (jamais file.type) ; lève bc:pictureTooLarge / bc:invalidPicture. */
export async function readPictureFile(f: File): Promise<string> {
  if (f.size > PICTURE_MAX_BYTES) throw new Error('bc:pictureTooLarge');
  const bytes = new Uint8Array(await f.arrayBuffer());
  const kind = sniffPicture(bytes);
  if (!kind) throw new Error('bc:invalidPicture');
  return pictureDataUrl(kind, bytes);
}

export interface GalleryItem { name: string; type: PictureKind; bytes: number }

/** Les images dans l'ordre alphabétique sans tenir compte de la casse. */
export const galleryItems = (list: ResourceInfo[]): GalleryItem[] =>
  list.map(({ name, type, bytes }) => ({ name, type, bytes })).sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()) || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));

/** Choisir une image arme l'outil Image : le contrôle dessiné prendra cette image partagée. */
export const armedTool = (name: string): ToolState => ({ kind: 'image', locked: false, props: { PictureType: 'shared', Picture: name } });

/** Les propriétés de l'outil armé, fusionnées dans le premier contrôle créé seulement (ses étiquettes ou enfants restent intacts). */
export const withToolProps = (controls: ControlDef[], props?: Record<string, unknown>): ControlDef[] =>
  props && controls.length ? [{ ...controls[0]!, props: { ...controls[0]!.props, ...props } }, ...controls.slice(1)] : controls;

/** Le nom de la ressource d'un fichier de Parcourir, ou la raison du refus (avant toute lecture du fichier). */
export function browseName(file: { name: string; size: number }): { ok: true; name: string } | { ok: false; reason: 'tooLarge' | 'badName' } {
  if (file.size > PICTURE_MAX_BYTES) return { ok: false, reason: 'tooLarge' };
  const name = resourceNameFromFile(file.name);
  return isResourceName(name) ? { ok: true, name } : { ok: false, reason: 'badName' };
}

/** Le fond d'une section : l'image seule en mode Page ; en Création, les points de la grille (`--dz-dot`) par-dessus l'image. */
export function sectionBackground(picture: PictureSpec | undefined, doc: DesignDoc, layout: boolean): CSSProperties | undefined {
  if (!picture) return undefined;
  const c = pictureCss(picture);
  if (layout) return c;
  const g = `${twipsToPx(gridStep(doc))}px ${twipsToPx(gridStep(doc))}px`;
  return { backgroundImage: `var(--dz-dot), ${c.backgroundImage}`, backgroundSize: `${g}, ${c.backgroundSize}`,
    backgroundPosition: `0 0, ${c.backgroundPosition}`, backgroundRepeat: `repeat, ${c.backgroundRepeat}` };
}
