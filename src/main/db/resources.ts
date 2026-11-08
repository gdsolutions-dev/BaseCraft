// Shared image gallery of the base (F3, format 1.4): bc_resources. Names are compared with sameName (the PRIMARY KEY is binary).
import type { DatabaseSync } from 'node:sqlite';
import { sameName } from '../../shared/field-types';
import { isResourceName, parsePictureDataUrl, PICTURE_MAX_BYTES, pictureDataUrl, usedResourceNames, type PictureKind } from '../../shared/pictures';
import type { DesignDoc } from '../../shared/design/model';
import { inTransaction } from './tx';

import type { ResourceInfo } from '../../shared/api';
export type { ResourceInfo };

const hasTable = (db: DatabaseSync): boolean => !!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='bc_resources'").get();

export function listResources(db: DatabaseSync): ResourceInfo[] {
  if (!hasTable(db)) return [];
  return db.prepare(`SELECT name, type, length(data) AS bytes FROM bc_resources WHERE typeof(name) = 'text' ORDER BY bc_fold(name), name`).all() as unknown as ResourceInfo[];
}

/** Data URLs of the names that exist (unknown names omitted). */
export function getResources(db: DatabaseSync, names: string[]): Record<string, string> {
  const out: Record<string, string> = Object.create(null) as Record<string, string>;
  if (!hasTable(db)) return out;
  const q = db.prepare('SELECT type, data FROM bc_resources WHERE name = ?');
  for (const n of names) {
    const r = q.get(n) as { type: PictureKind; data: Uint8Array } | undefined;
    if (r) out[n] = pictureDataUrl(r.type, r.data);
  }
  return out;
}

function stored(db: DatabaseSync, name: string): string | undefined {
  if (!hasTable(db)) return undefined;
  const rows = db.prepare(`SELECT name FROM bc_resources WHERE typeof(name) = 'text' AND bc_fold(name) = bc_fold(?)`).all(name) as { name: string }[];
  return rows.find((r) => sameName(r.name, name))?.name;
}

/** The picture of a data URL, or throws bc:pictureTooLarge / bc:invalidPicture. A string over the size cap is refused without decoding. */
export function checkedPicture(dataUrl: unknown): { kind: PictureKind; bytes: Uint8Array } {
  if (typeof dataUrl !== 'string') throw new Error('bc:invalidPicture');
  if (dataUrl.length > (PICTURE_MAX_BYTES * 4) / 3 + 64) throw new Error('bc:pictureTooLarge');
  const p = parsePictureDataUrl(dataUrl);
  if (p) return p;
  const m = /^data:image\/(?:png|jpeg|gif|webp);base64,([A-Za-z0-9+/]*={0,2})$/.exec(dataUrl);
  throw new Error(m && m[1].length % 4 === 0 && Math.floor(m[1].length / 4) * 3 > PICTURE_MAX_BYTES ? 'bc:pictureTooLarge' : 'bc:invalidPicture');
}

/** Adds an image; a taken name becomes "name (2)", "name (3)", ... Returns the final name. */
export function addResource(db: DatabaseSync, preferred: string, dataUrl: string): string {
  if (!isResourceName(preferred)) throw new Error('bc:invalidName');
  const { kind, bytes } = checkedPicture(dataUrl);
  let name = preferred;
  for (let i = 2; stored(db, name) !== undefined; i++) { const sfx = ` (${i})`; name = preferred.slice(0, 255 - sfx.length) + sfx; }
  const now = new Date().toISOString();
  db.prepare('INSERT INTO bc_resources (name, type, data, created, modified) VALUES (?, ?, ?, ?, ?)').run(name, kind, bytes, now, now);
  return name;
}

export function replaceResource(db: DatabaseSync, name: string, dataUrl: string): void {
  const { kind, bytes } = checkedPicture(dataUrl);
  const at = stored(db, name);
  if (at === undefined) throw new Error('bc:resourceNotFound');
  db.prepare('UPDATE bc_resources SET type = ?, data = ?, modified = ? WHERE name = ?').run(kind, bytes, new Date().toISOString(), at);
}

/** The saved forms and reports that draw the image (open unsaved documents are not scanned). */
export function resourceUsage(db: DatabaseSync, name: string): { kind: 'form' | 'report'; name: string }[] {
  const quoted = JSON.stringify(name);
  const rows = db.prepare(`SELECT kind, name, definition FROM bc_objects WHERE kind IN ('form','report') AND typeof(name) = 'text' ORDER BY kind, bc_fold(name), name`)
    .all() as unknown as { kind: 'form' | 'report'; name: string; definition: unknown }[];
  const out: { kind: 'form' | 'report'; name: string }[] = [];
  for (const r of rows) {
    if (typeof r.definition !== 'string' || !r.definition.includes(quoted)) continue;
    try {
      const doc = JSON.parse(r.definition) as DesignDoc;
      if (usedResourceNames(doc).includes(name)) out.push({ kind: r.kind, name: r.name });
    } catch { /* unreadable definition: not counted */ }
  }
  return out;
}

export function removeResource(db: DatabaseSync, name: string): void {
  inTransaction(db, () => {
    const at = stored(db, name);
    if (at === undefined) throw new Error('bc:resourceNotFound');
    const n = resourceUsage(db, at).length;
    if (n > 0) throw new Error(`bc:resourceInUse|${n}`);
    db.prepare('DELETE FROM bc_resources WHERE name = ?').run(at);
  });
}
