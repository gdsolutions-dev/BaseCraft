// Access import (E-linked): the linked tables of an Access front-end, read from MSysObjects, become BaseCraft links of kind 'access'
// (read-only, mdb-reader) to the same back-end file. The back-end's password (MSysObjects.Connect) is never read; one that needs a
// password is linked unchecked. A table that cannot be relinked gives one report line, never an error.
import fs from 'node:fs';
import path from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import type MDBReader from 'mdb-reader';
import type { ReportLine } from '../../shared/access-import';
import { sameName } from '../../shared/field-types';
import { uniqueName } from '../../shared/import-text';
import { listObjects } from '../db/objects';
import { danglingNames, listTables } from '../db/schema';
import { addLinks, linkRows, pathKey } from '../links/store';

export type AccessLinkedTable = { name: string; kind: 'access'; database: string; foreign: string } | { name: string; kind: 'other' };

/** The linked tables of the file: Type 6 rows are linked to a file (read from Database and ForeignName), Type 4 (ODBC) and any other
 *  linked row are 'other'. Only the four columns named are read: never Connect. */
/** Access's hidden tables of the attachment fields: internals, never listed, linked nor reported. */
export const isAttachmentTable = (name: string): boolean => /^f_[0-9A-Fa-f]{32}_/.test(name);

export function accessLinkedTables(r: MDBReader): AccessLinkedTable[] {
  let rows: { Name: unknown; Type: unknown; Database: unknown; ForeignName: unknown }[] = [];
  try { rows = r.getTable('MSysObjects').getData({ columns: ['Name', 'Type', 'Database', 'ForeignName'] }) as typeof rows; } catch { /* no system table: nothing linked */ }
  const out: AccessLinkedTable[] = [];
  for (const { Name, Type, Database, ForeignName } of rows) {
    if (typeof Name !== 'string' || /^(MSys|~)/i.test(Name) || isAttachmentTable(Name) || ![4, 6].includes(Number(Type))) continue;
    out.push(Number(Type) === 6 && typeof Database === 'string' && /\.(mdb|accdb)$/i.test(Database) && typeof ForeignName === 'string' && ForeignName
      ? { name: Name, kind: 'access', database: Database, foreign: ForeignName } : { name: Name, kind: 'other' });
  }
  return out;
}

const baseName = (p: string) => p.split(/[\\/]/).pop()!;
const key = (p: string) => { let q = path.resolve(p); try { q = fs.realpathSync.native(p); } catch { /* not there */ } return pathKey(q); };

/** The stored path when it is absolute and exists, else the file of the same name beside `importedFile`, else null. */
export function resolveBackEnd(stored: string, importedFile: string, exists: (p: string) => boolean = fs.existsSync): string | null {
  const name = baseName(stored);
  if (!name) return null;
  if (path.isAbsolute(stored) && exists(stored)) return stored;
  const beside = path.join(path.dirname(importedFile), name);
  return exists(beside) ? beside : null;
}

const stateOf = (e: unknown): string => (e instanceof Error ? e.message.split('|')[1] ?? '' : '');

/** Links the linked tables of the front-end `importedFile` to their Access files in `front` (the BaseCraft base at `frontEndPath`).
 *  `links`: `remote` the Access name, `name` the link's name here. */
export function relinkTables(front: DatabaseSync, frontEndPath: string, importedFile: string, linked: AccessLinkedTable[], open: (path: string) => MDBReader, exists?: (p: string) => boolean):
  { links: { remote: string; name: string }[]; lines: ReportLine[] } {
  const taken = [...listTables(front).map((t) => t.name), ...listObjects(front, 'query').map((o) => o.name), ...linkRows(front).map((l) => l.name), ...danglingNames(front)];
  const lines: ReportLine[] = [];
  const links: { remote: string; name: string }[] = [];
  const skip = (object: string, reason: string) => lines.push({ code: 'tableLinked', object, reason });
  const files = new Map<string, { file: string; tables: Extract<AccessLinkedTable, { kind: 'access' }>[] }>();
  const self = key(importedFile);
  const where = new Map<string, { file: string; k: string } | null>(); // one lookup per stored path (an unreachable share costs once, not per table)
  for (const t of linked) {
    if (t.kind === 'other') { skip(t.name, 'otherSource'); continue; }
    if (!where.has(t.database)) { const f = resolveBackEnd(t.database, importedFile, exists); where.set(t.database, f === null ? null : { file: f, k: key(f) }); }
    const w = where.get(t.database)!;
    if (w === null) { skip(t.name, 'fileMissing'); continue; }
    if (w.k === self) { skip(t.name, 'sameFile'); continue; }
    const g = files.get(w.k) ?? { file: w.file, tables: [] };
    g.tables.push(t);
    files.set(w.k, g);
  }
  for (const { file, tables } of files.values()) {
    let inFile: string[] | null = null; // null: not checked (a password is needed)
    try { inFile = open(file).getTableNames(); } catch (e) {
      if (stateOf(e) !== 'needsPassword') { for (const t of tables) skip(t.name, 'cannotOpen'); continue; }
    }
    const pairs: { name: string; remote: string }[] = [];
    for (const t of tables) {
      const remote = inFile === null ? t.foreign : inFile.find((n) => sameName(n, t.foreign));
      if (remote === undefined) { skip(t.name, 'notInFile'); continue; }
      const name = uniqueName(t.name.normalize('NFC'), taken);
      taken.push(name);
      pairs.push({ name, remote });
      links.push({ remote: t.name, name });
      lines.push({ code: 'tableRelinked', object: name, part: baseName(file) });
    }
    if (pairs.length) addLinks(front, frontEndPath, 'access', file, pairs);
  }
  return { links, lines };
}
