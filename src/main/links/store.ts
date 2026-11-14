// Linked files of a front-end (format 1.3, R1): `bc_sources` (one row per linked file or server) and `bc_links` (one row per linked table).
// `props` is JSON read tolerantly (a file edited elsewhere); unknown kinds and keys are never rewritten, so a newer minor's survive.
// Imports nothing of schema.ts: schema.ts, alter.ts, objects.ts and action.ts import isLinkName from here.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { sameName, type FieldDef, type FieldProps } from '../../shared/field-types';
import { isServerKind, type RemoteTable, type ServerKind } from '../connectors/connector';
import { inTransaction } from '../db/tx';
import type { LinkMeta } from './meta';

export type SourceKind = 'basecraft' | 'sqlite' | 'access';
/** D1: the source kind of ODBC links. params: `{ connection, user, label }`, the connection string without its password. */
export const ODBC = 'odbc';
/** params: a server source's props (C4 R6: the connector's params, never a password). */
export interface SourceRow { id: string; kind: string; path: string; relative?: string; params?: unknown }
/** server: a server link's design as cached at link or Refresh time (C4 R6); `meta`: BaseCraft's metadata the migration wizard
 *  kept (C7 R11). */
export interface LinkRow { name: string; sourceId: string; remote: string; description?: string;
  /** D1: an ODBC link's table at the source (`remote` is its name in the cache, the link's own); read-only, cached in memory. */
  odbc?: { table: string; schema: string };
  server?: { schema?: string; key: string[]; fields: FieldDef[]; skipped: string[]; version?: string; meta?: LinkMeta } }

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
    return { id: r.id, kind: r.kind, path: typeof p.path === 'string' ? p.path : '', ...(typeof p.relative === 'string' ? { relative: p.relative } : {}),
      ...(isServerKind(r.kind) || r.kind === ODBC ? { params: p } : {}) };
  });
}

const isObject = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v);
/** C7 R11: `meta` when it has the shape of one (each field's props and `from` objects; the table's texts only), else none. The
 *  props are checked where they are used (withMetadata). */
function metaOf(v: unknown): LinkMeta | undefined {
  if (!isObject(v) || !isObject(v.fields) || !Object.values(v.fields).every((x) => isObject(x) && isObject(x.props) && isObject(x.from))) return undefined;
  if (v.table !== undefined && !isObject(v.table)) return undefined;
  const table = isObject(v.table) ? Object.fromEntries(Object.entries(v.table).filter(([k, x]) => ['description', 'validationRule', 'validationText'].includes(k) && typeof x === 'string')) : undefined;
  return { fields: v.fields as LinkMeta['fields'], ...(table ? { table } : {}) };
}
/** A server link's cached design, only when `fields` is a list of field definitions; a key naming anything but its fields reads
 *  as none (read-only): a partial key would write more than one row. */
function serverOf(p: Record<string, unknown>): LinkRow['server'] {
  const { fields, key, skipped, schema, version, meta } = p;
  if (!Array.isArray(fields) || !fields.every((x) => isObject(x) && typeof x.name === 'string' && isObject(x.props))) return undefined;
  const defs = fields as FieldDef[];
  const keyOk = Array.isArray(key) && key.every((k) => defs.some((x) => x.name === k));
  const m = metaOf(meta);
  return { ...(typeof schema === 'string' ? { schema } : {}), key: keyOk ? (key as string[]) : [], fields: defs,
    skipped: Array.isArray(skipped) ? skipped.filter((x): x is string => typeof x === 'string') : [],
    // C5 R11: the rowversion column; one naming a field is no rowversion (a damaged cache reads as none)
    ...(typeof version === 'string' && !defs.some((x) => x.name === version) ? { version } : {}),
    ...(m ? { meta: m } : {}) };
}

/** typeof: a BLOB name written by an external tool is skipped, as objects.ts does. `server`: only a link of a server source. */
export function linkRows(db: DatabaseSync): LinkRow[] {
  const rows = db.prepare(`SELECT l.name, l.source_id, l.remote_name, l.props, s.kind FROM bc_links l LEFT JOIN bc_sources s ON s.id = l.source_id
    WHERE typeof(l.name) = 'text' ORDER BY bc_fold(l.name), l.name`).all() as { name: string; source_id: string; remote_name: string; props: string; kind: string | null }[];
  return rows.map((r) => {
    const p = parseObject(r.props);
    const server = r.kind !== null && isServerKind(r.kind) ? serverOf(p) : undefined;
    return { name: r.name, sourceId: r.source_id, remote: r.remote_name, ...(typeof p.description === 'string' ? { description: p.description } : {}),
      ...(r.kind === ODBC && typeof p.table === 'string' ? { odbc: { table: p.table, schema: typeof p.schema === 'string' ? p.schema : '' } } : {}),
      ...(server ? { server } : {}) };
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

/** The server source of `params`, reused when one holds equal params (the connector's normalized form, in its order), else created.
 *  A `password` key is never stored (R6; the connector's params have none: defence in depth). */
export function serverSourceFor(db: DatabaseSync, kind: ServerKind, params: unknown): string {
  const { password: _password, ...rest } = params !== null && typeof params === 'object' ? (params as Record<string, unknown>) : {};
  const text = JSON.stringify(rest);
  const found = sourceRows(db).find((s) => s.kind === kind && JSON.stringify(s.params) === text);
  if (found) return found.id;
  const id = crypto.randomUUID();
  db.prepare('INSERT INTO bc_sources (id, kind, props) VALUES (?, ?, ?)').run(id, kind, text);
  return id;
}

/** D1: the ODBC source of `params`, reused when one holds equal params, else created (never a password: the caller stripped it). */
export function odbcSourceFor(db: DatabaseSync, params: { connection: string; user: string; label: string }): string {
  const text = JSON.stringify(params);
  const found = sourceRows(db).find((s) => s.kind === ODBC && JSON.stringify(s.params) === text);
  if (found) return found.id;
  const id = crypto.randomUUID();
  db.prepare('INSERT INTO bc_sources (id, kind, props) VALUES (?, ?, ?)').run(id, ODBC, text);
  return id;
}

/** D1: links `tables` (name = the link and cache name) of the ODBC source `params`; returns the source's id. The caller checked the names are free. */
export function addOdbcLinks(db: DatabaseSync, params: { connection: string; user: string; label: string }, tables: { name: string; table: string; schema: string }[]): string {
  return inTransaction(db, () => {
    const id = odbcSourceFor(db, params);
    const ins = db.prepare('INSERT INTO bc_links (name, source_id, remote_name, props) VALUES (?, ?, ?, ?)');
    for (const t of tables) ins.run(t.name.normalize('NFC'), id, t.name, JSON.stringify({ table: t.table, ...(t.schema ? { schema: t.schema } : {}) }));
    return id;
  });
}

/** A link's props with `t`'s design cached (R6); its other props (description, C7's meta, a newer minor's keys) kept. */
function withServer(props: Record<string, unknown>, t: RemoteTable): string {
  const { schema: _schema, version: _version, ...rest } = props;
  return JSON.stringify({ ...rest, ...(t.schema !== undefined ? { schema: t.schema } : {}), ...(t.version !== undefined ? { version: t.version } : {}), key: t.key, fields: t.design.fields, skipped: t.skipped });
}
const linkProps = (db: DatabaseSync, name: string) => parseObject((db.prepare('SELECT props FROM bc_links WHERE name = ?').get(name) as { props: string }).props);

/** Links `tables` of the server `params` (C4 R6), each under its `name`, `metas[i]` (C7 R11: the migration wizard's) on
 *  tables[i]. The caller has checked that no name is taken. */
export function addServerLinks(db: DatabaseSync, kind: ServerKind, params: unknown, tables: RemoteTable[], metas?: (LinkMeta | undefined)[]): void {
  inTransaction(db, () => {
    const id = serverSourceFor(db, kind, params);
    const ins = db.prepare('INSERT INTO bc_links (name, source_id, remote_name, props) VALUES (?, ?, ?, ?)');
    tables.forEach((t, i) => ins.run(t.name.normalize('NFC'), id, t.remote, withServer(metas?.[i] ? { meta: metas[i] } : {}, t)));
  });
}

/** `names` move to the server `params`, each with its table of `tables` (matched by link name) and that design (and `metas[i]` on
 *  tables[i], C7 R11); a source left with no link is deleted. One transaction; an unknown name, or one without its table, is bc:notFound. */
export function relinkServerRows(db: DatabaseSync, names: string[], kind: ServerKind, params: unknown, tables: RemoteTable[], metas?: (LinkMeta | undefined)[]): void {
  inTransaction(db, () => {
    const id = serverSourceFor(db, kind, params);
    const left = new Set<string>();
    for (const n of names) {
      const l = mustFind(db, n);
      const i = tables.findIndex((x) => sameName(x.name, l.name));
      const t = tables[i];
      if (!t) throw new Error('bc:notFound');
      left.add(l.sourceId);
      const meta = metas?.[i];
      db.prepare('UPDATE bc_links SET source_id = ?, remote_name = ?, props = ? WHERE name = ?').run(id, t.remote, withServer({ ...linkProps(db, l.name), ...(meta ? { meta } : {}) }, t), l.name);
    }
    for (const s of left) dropIfUnused(db, s);
  });
}

/** Refresh Link of a server link: its cached design replaced by `t`'s. */
export function setServerDesign(db: DatabaseSync, name: string, t: RemoteTable): void {
  const l = mustFind(db, name);
  db.prepare('UPDATE bc_links SET props = ? WHERE name = ?').run(withServer(linkProps(db, l.name), t), l.name);
}

/** Removes the link, and its source when it was the last link. */
export function removeLink(db: DatabaseSync, name: string): void {
  inTransaction(db, () => {
    const l = mustFind(db, name);
    db.prepare('DELETE FROM bc_links WHERE name = ?').run(l.name);
    dropIfUnused(db, l.sourceId);
  });
}

/** C7 R11, edited: a server link's BaseCraft metadata (bc_links.props.meta) patched. `fields`: per field name (matched as the cached
 *  design names it), the props to set (undefined removes one); a field new to the meta takes its `from` (type keys) from the
 *  cached design. `table`: replaces the table's texts (empty: none). Other props of the link are kept. */
export function patchLinkMeta(db: DatabaseSync, name: string, fields: Record<string, Partial<FieldProps>>, table?: NonNullable<LinkMeta['table']>): void {
  const l = mustFind(db, name);
  if (!l.server) throw new Error('bc:notFound');
  const meta: LinkMeta = { ...(l.server.meta ?? { fields: {} }), fields: { ...l.server.meta?.fields } };
  for (const [n, patch] of Object.entries(fields)) {
    const cached = l.server.fields.find((x) => sameName(x.name, n));
    if (!cached) continue;
    const old = meta.fields[cached.name];
    const props: Record<string, unknown> = { ...old?.props };
    for (const [k, v] of Object.entries(patch)) { if (v === undefined) delete props[k]; else props[k] = v; }
    meta.fields[cached.name] = { props, from: old?.from ?? Object.fromEntries(['type', 'numberSize', 'size', 'precision', 'scale'].filter((k) => (cached.props as Record<string, unknown>)[k] !== undefined).map((k) => [k, (cached.props as Record<string, unknown>)[k]])) as LinkMeta['fields'][string]['from'] };
  }
  if (table) { if (Object.keys(table).length) meta.table = table; else delete meta.table; }
  db.prepare('UPDATE bc_links SET props = ? WHERE name = ?').run(JSON.stringify({ ...linkProps(db, l.name), meta }), l.name);
}

/** '' or null removes the description; the link's other props are kept. */
export function setLinkDescription(db: DatabaseSync, name: string, description: string | null): void {
  const l = mustFind(db, name);
  const props = linkProps(db, l.name);
  if (description) props.description = description;
  else delete props.description;
  db.prepare('UPDATE bc_links SET props = ? WHERE name = ?').run(JSON.stringify(props), l.name);
}
