// Linked pictures (F3 follow-up): `PictureType: 'linked'`, `Picture` = a file path. Only the main process reads the file, and only
// as a picture: a local path (a UNC or device path would send credentials to a server) inside the base's folder (owner, 2026-11-13:
// a received base reads nothing else on the disk), at most 1 MB, an image signature.
import { readFileSync, realpathSync, statSync } from 'node:fs';
import { dirname, isAbsolute, relative, resolve } from 'node:path';
import { LINK_PREFIX, PICTURE_MAX_BYTES, pictureDataUrl, sniffPicture } from '../shared/pictures';

// eslint-disable-next-line no-control-regex
const REFUSED = /^[\/]{2}|[\u0000-\u001f]/;

/** `path` (absolute, or relative to the base's folder) as a path relative to that folder when the file is in it or in a subfolder
 *  (links followed), else undefined. */
export function inBaseFolder(path: string, baseFile: string | undefined): string | undefined {
  try {
    if (path === '' || REFUSED.test(path) || baseFile === undefined) return undefined;
    const dir = realpathSync(dirname(baseFile)), file = realpathSync(resolve(dirname(baseFile), path));
    const rel = relative(dir, file);
    return rel === '' || rel.startsWith('..') || isAbsolute(rel) || REFUSED.test(file) ? undefined : rel;
  } catch { return undefined; }
}

/** The data URL of the picture at `path` (in the base's folder), or undefined for anything else. */
export function readLinkedPicture(path: string, baseFile: string | undefined): string | undefined {
  try {
    const rel = inBaseFolder(path, baseFile);
    if (rel === undefined) return undefined;
    const file = resolve(realpathSync(dirname(baseFile!)), rel);
    if (!statSync(file).isFile() || statSync(file).size > PICTURE_MAX_BYTES) return undefined;
    const bytes = readFileSync(file), kind = sniffPicture(bytes);
    return kind ? pictureDataUrl(kind, bytes) : undefined;
  } catch { return undefined; }
}

/** The `link:<path>` keys of `names` read from files; the other names are not looked at. */
export function readLinkedPictures(names: string[], baseFile: string | undefined): Record<string, string> {
  const out: Record<string, string> = Object.create(null) as Record<string, string>;
  for (const n of names) {
    const url = n.startsWith(LINK_PREFIX) ? readLinkedPicture(n.slice(LINK_PREFIX.length), baseFile) : undefined;
    if (url !== undefined) out[n] = url;
  }
  return out;
}
