// Linked files of a front-end (format 1.3, R1): `bc_sources` (one row per linked file) and `bc_links` (one row per linked table).
// `props` is JSON read tolerantly (a file edited elsewhere); unknown kinds and keys are never rewritten, so a newer minor's survive.
// Imports nothing of schema.ts: schema.ts, alter.ts, objects.ts and action.ts import isLinkName from here.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { sameName } from '../../shared/field-types';
import { inTransaction } from '../db/tx';

export type SourceKind = 'basecraft' | 'sqlite' | 'access';
export interface SourceRow { id: string; kind: string; path: string; relative?: string }
export interface LinkRow { name: string; sourceId: string; remote: string; description?: string }

function parseObject(s: unknown): Record<string, unknown> {
  try {
    const v: unknown = JSON.parse(String(s));
    return v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

export function sourceRows(db: DatabaseSync): SourceRow[] {
  const rows = db.prepare('SELECT id, kind, props FROM bc_sources ORDER BY rowid').all() as { id: string; kind: string; props: string }[];
  return rows.map((r) => {
    const p = parseObject(r.props);
    return { id: r.id, kind: r.kind, path: typeof p.path === 'string' ? p.path : '', ...(typeof p.relative === 'string' ? { relative: p.relative } : {}) };
  });
}

/** typeof: a BLOB name written by an external tool is skipped, as objects.ts does. */
export function linkRows(db: DatabaseSync): LinkRow[] {
  const rows = db.prepare(`SELECT name, source_id, remote_name, props FROM bc_links WHERE typeof(name) = 'text' ORDER BY bc_fold(name), name`).all() as
    { name: string; source_id: string; remote_name: string; props: string }[];
  return rows.map((r) => {
    const d = parseObject(r.props).description;
    return { name: r.name, sourceId: r.source_id, remote: r.remote_name, ...(typeof d === 'string' ? { description: d } : {}) };
  });
}

export const findLink = (db: DatabaseSync, name: string): LinkRow | undefined => linkRows(db).find((l) => sameName(l.name, name));

/** Tables, queries and links share one namespace. */
export const isLinkName = (db: DatabaseSync, name: string): boolean => findLink(db, name) !== undefined;

function mustFind(db: DatabaseSync, name: string): LinkRow {
  const l = findLink(db, name);
  if (!l) throw new Error('bc:notFound');
  return l;
}

/** R5: the relative path (against the front-end's current folder) when that file exists, else the absolute one. */
export function resolveSourcePath(s: SourceRow, frontEnd: string, exists: (p: string) => boolean = fs.existsSync): string {
  if (s.relative !== undefined) {
    const p = path.join(path.dirname(frontEnd), s.relative);
    if (exists(p)) return p;
  }
  return s.path;
}

/** The source of `file`, reused when one holds that real path or resolves to it (R5: a pair moved together; Windows paths ignore
 *  case), else created: absolute path, plus the path relative to the front-end's folder when both are on one volume (stored with `/`,
 *  so it reads on either system). */
function sourceFor(db: DatabaseSync, frontEnd: string, kind: SourceKind, file: string): string {
  const real = fs.realpathSync.native(file);
  const key = (p: string) => (process.platform === 'win32' ? p.toLowerCase() : p);
  const realOf = (p: string) => { try { return fs.realpathSync.native(p); } catch { return p; } };
  const found = sourceRows(db).find((s) => s.kind === kind && (key(s.path) === key(real) || key(realOf(resolveSourcePath(s, frontEnd))) === key(real)));
  if (found) return found.id;
  const rel = path.relative(fs.realpathSync.native(path.dirname(frontEnd)), real);
  const props = { path: real, ...(path.isAbsolute(rel) ? {} : { relative: rel.split(path.sep).join('/') }) }; // absolute: another drive
  const id = crypto.randomUUID();
  db.prepare('INSERT INTO bc_sources (id, kind, props) VALUES (?, ?, ?)').run(id, kind, JSON.stringify(props));
  return id;
}

/** A source no link uses any more goes (only one a caller just took a link from: an unrelated unused row is not ours). */
const dropIfUnused = (db: DatabaseSync, id: string): void => {
  db.prepare('DELETE FROM bc_sources WHERE id = ? AND NOT EXISTS (SELECT 1 FROM bc_links WHERE source_id = ?)').run(id, id);
};

/** Links `names` (each is the remote table's own name, R2) to `file`. The caller has checked that no name is taken (R2). */
export function addLinks(db: DatabaseSync, frontEnd: string, kind: SourceKind, file: string, names: string[]): void {
  inTransaction(db, () => {
    const id = sourceFor(db, frontEnd, kind, file);
    const ins = db.prepare('INSERT INTO bc_links (name, source_id, remote_name) VALUES (?, ?, ?)');
    for (const n of names) ins.run(n.normalize('NFC'), id, n);
  });
}

/** R9: `names` move to the source of `file`; a source left with no link is deleted. One transaction; an unknown name is bc:notFound. */
export function relinkRows(db: DatabaseSync, frontEnd: string, names: string[], kind: SourceKind, file: string): void {
  inTransaction(db, () => {
    const id = sourceFor(db, frontEnd, kind, file);
    const left = new Set<string>();
    for (const n of names) {
      const l = mustFind(db, n);
      left.add(l.sourceId);
      db.prepare('UPDATE bc_links SET source_id = ? WHERE name = ?').run(id, l.name);
    }
    for (const s of left) dropIfUnused(db, s);
  });
}

/** Removes the link, and its source when it was the last link. */
export function removeLink(db: DatabaseSync, name: string): void {
  inTransaction(db, () => {
    const l = mustFind(db, name);
    db.prepare('DELETE FROM bc_links WHERE name = ?').run(l.name);
    dropIfUnused(db, l.sourceId);
  });
}

/** '' or null removes the description; the link's other props are kept. */
export function setLinkDescription(db: DatabaseSync, name: string, description: string | null): void {
  const l = mustFind(db, name);
  const props = parseObject((db.prepare('SELECT props FROM bc_links WHERE name = ?').get(l.name) as { props: string }).props);
  if (description) props.description = description;
  else delete props.description;
  db.prepare('UPDATE bc_links SET props = ? WHERE name = ?').run(JSON.stringify(props), l.name);
}
