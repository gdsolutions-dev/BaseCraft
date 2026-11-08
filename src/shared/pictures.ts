// Images : formats, taille, noms de ressource et références (incorporée ou partagée). Module pur (renderer et main).
import { flattenControls, type DesignDoc } from './design/model';

export const PICTURE_MAX_BYTES = 1024 * 1024;   // 1 Mo par image, une seule définition
export type PictureKind = 'png' | 'jpeg' | 'gif' | 'webp';
export const PICTURE_KINDS: readonly PictureKind[] = ['png', 'jpeg', 'gif', 'webp'];
export const PICTURE_ACCEPT = PICTURE_KINDS.map((k) => `image/${k}`).join(',');

const ascii = (b: Uint8Array, at: number, s: string): boolean => [...s].every((c, i) => b[at + i] === c.charCodeAt(0));

/** Le format d'après la signature du fichier (jamais d'après le type MIME ni l'extension) ; null pour tout autre contenu, SVG compris. */
export function sniffPicture(bytes: Uint8Array): PictureKind | null {
  if (bytes.length >= 4 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return 'png';
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'jpeg';
  if (ascii(bytes, 0, 'GIF87a') || ascii(bytes, 0, 'GIF89a')) return 'gif';
  if (bytes.length >= 12 && ascii(bytes, 0, 'RIFF') && ascii(bytes, 8, 'WEBP')) return 'webp';
  return null;
}

const DATA_URL = /^data:image\/(png|jpeg|gif|webp);base64,([A-Za-z0-9+/]*={0,2})$/;
// Longueur maximale d'une URL de données acceptable : refusée avant toute expression régulière ou tout décodage.
const DATA_URL_MAX = 'data:image/jpeg;base64,'.length + Math.ceil(PICTURE_MAX_BYTES / 3) * 4;

/** Une image en URL de données : base64, 1 octet à PICTURE_MAX_BYTES, signature conforme au type déclaré ; sinon null. */
export function parsePictureDataUrl(v: unknown): { kind: PictureKind; bytes: Uint8Array } | null {
  if (typeof v !== 'string' || v.length > DATA_URL_MAX) return null;
  const m = DATA_URL.exec(v);
  if (!m || m[2].length % 4 !== 0) return null;
  const bin = atob(m[2]);
  if (bin.length < 1 || bin.length > PICTURE_MAX_BYTES) return null;
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  return sniffPicture(bytes) === m[1] ? { kind: m[1] as PictureKind, bytes } : null;
}

export function pictureDataUrl(kind: PictureKind, bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return `data:image/${kind};base64,${btoa(bin)}`;
}

// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u001f\u007f-\u009f]/g;
/** Le nom d'une ressource d'après un nom de fichier : nom de base sans extension, nettoyé, 255 caractères au plus. */
export const resourceNameFromFile = (fileName: string): string => fileName.replace(/\.[^.]*$/, '').replace(CONTROL, '').trim().slice(0, 255);
export const isResourceName = (v: unknown): v is string =>
  typeof v === 'string' && v.length >= 1 && v.length <= 255 && v === v.trim() && !new RegExp(CONTROL.source).test(v);

export type PictureType = 'embedded' | 'shared';
/** Toute valeur autre que 'shared' (absente, inconnue, « linked » pas encore géré) se lit incorporée. */
export const readPictureType = (v: unknown): PictureType => (v === 'shared' ? 'shared' : 'embedded');
export type ResourceMap = Readonly<Record<string, string>>;

/** L'URL de données à dessiner pour `Picture` : incorporée (elle-même, si valide) ou partagée (dans la galerie), sinon undefined. */
export function resolvePicture(props: Record<string, unknown>, resources: ResourceMap): string | undefined {
  const pic = props.Picture;
  if (readPictureType(props.PictureType) === 'shared') return typeof pic === 'string' && Object.hasOwn(resources, pic) ? resources[pic] : undefined;
  // incorporée : la règle d'avant F3 (tout `data:image/`), pour qu'une image déjà enregistrée se dessine comme avant
  // (un PNG nommé .jpg était stocké en `data:image/jpeg`) ; les nouvelles écritures de la galerie sont, elles, vérifiées.
  return typeof pic === 'string' && pic.startsWith('data:image/') ? pic : undefined;
}

/** Les noms d'images partagées que le document utilise (lui-même et tous ses contrôles, onglets compris), sans doublon. */
export function usedResourceNames(doc: DesignDoc): string[] {
  const names = new Set<string>();
  const add = (p: Record<string, unknown>): void => { if (readPictureType(p.PictureType) === 'shared' && typeof p.Picture === 'string') names.add(p.Picture); };
  add(doc.props);
  for (const s of doc.sections) for (const c of flattenControls(s.controls)) add(c.props);
  return [...names];
}
