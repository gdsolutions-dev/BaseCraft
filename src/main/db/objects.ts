// Objets de la base (requêtes, formulaires, états, macros, modules) dans bc_objects. La définition est un JSON opaque ici.
import type { DatabaseSync } from 'node:sqlite';
import type { ObjectKind, ObjectSummary, OpResult } from '../../shared/api';
import { isReservedName, isValidObjectName, sameName } from '../../shared/field-types';
import { isTableName } from './schema';
import { inTransaction } from './tx';

export type { ObjectKind, ObjectSummary };

interface Row { kind: ObjectKind; name: string; definition: string; description: string | null; nav_group: string | null; created: string; modified: string }

const fail = (reason: 'nameExists' | 'nameInvalid' | 'notFound'): OpResult => ({ ok: false, reason });
/** A TEXT column converts a number to text, but keeps a BLOB an external tool wrote: every reader skips such names. */
export const TEXT_NAME = "typeof(name) = 'text'";

/** Size limit of a definition, in UTF-16 characters of its JSON text. */
export const MAX_DEFINITION_CHARS = 8 * 1024 * 1024;
const FORBIDDEN_KEYS: readonly string[] = ['__proto__', 'constructor', 'prototype'];
const plain = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === 'object' && Object.getPrototypeOf(v) === Object.prototype;

/**
 * JSON text of a definition, or null when it is not a plain JSON object within the limits: at most 64 levels deep and
 * `maxChars` once serialized, no own `__proto__`, `constructor` or `prototype` key (a later recursive merge would pollute
 * Object.prototype). Walked iteratively against a budget charged before each container is read, so a sparse array (length
 * 2^32-1), a cycle or a huge string is refused at once. An `undefined` property is dropped, as JSON.stringify does.
 * Shared by the save path (IPC) and getObject (a definition edited by an external tool).
 */
export function definitionJson(v: unknown, maxChars = MAX_DEFINITION_CHARS): string | null {
  if (!plain(v)) return null;
  let budget = maxChars;
  const spend = (n: number) => (budget -= n) >= 0;
  const stack: [unknown, number][] = [[v, 0]];
  while (stack.length) {
    const [x, depth] = stack.pop()!;
    if (x === null || x === undefined || typeof x === 'boolean') { if (!spend(5)) return null; } // undefined in an array is written null
    else if (typeof x === 'number') { if (!Number.isFinite(x) || !spend(String(x).length)) return null; }
    else if (typeof x === 'string') { if (!spend(x.length + 2)) return null; }
    else if (depth >= 64) return null;
    else if (Array.isArray(x)) {
      if (!spend(x.length + 2)) return null;
      for (let i = 0; i < x.length; i++) stack.push([x[i], depth + 1]);
    } else if (plain(x)) {
      if (!spend(2)) return null;
      for (const k of Object.keys(x)) {
        if (FORBIDDEN_KEYS.includes(k)) return null;
        if (x[k] === undefined) continue;
        if (!spend(k.length + 4)) return null;
        stack.push([x[k], depth + 1]);
      }
    } else return null;
  }
  const json = JSON.stringify(v); // exact size (escapes); bounded by the walk
  return json.length > maxChars ? null : json;
}
const validName = (n: string) => isValidObjectName(n) && !isReservedName(n);
/** Names are stored in NFC: the same name typed decomposed is the same object. */
const nfc = (n: string) => n.normalize('NFC');

const summary = (r: Row): ObjectSummary =>
  ({ kind: r.kind, name: r.name, description: r.description, navGroup: r.nav_group, created: r.created, modified: r.modified });

/** Stored name of `name` in `kind` (sameName), if any. bc_fold narrows the candidates without reading any definition. */
function find(db: DatabaseSync, kind: ObjectKind, name: string): string | undefined {
  const rows = db.prepare(`SELECT name FROM bc_objects WHERE kind = ? AND ${TEXT_NAME} AND bc_fold(name) = bc_fold(?)`).all(kind, name) as { name: string }[];
  return rows.find((r) => sameName(r.name, name))?.name;
}
const row = (db: DatabaseSync, kind: ObjectKind, name: string): Row =>
  db.prepare('SELECT * FROM bc_objects WHERE kind = ? AND name = ?').get(kind, name) as unknown as Row;

/** `name` is taken in `kind`'s namespace by another object than `self` (a query also clashes with a table). Saving or
 *  renaming an object onto its own name never clashes, even with a table an older version let share it. */
function taken(db: DatabaseSync, kind: ObjectKind, name: string, self?: string): boolean {
  const o = find(db, kind, name);
  if (o !== undefined && o !== self) return true;
  return kind === 'query' && !(self !== undefined && sameName(self, name)) && isTableName(db, name);
}

export function listObjects(db: DatabaseSync, kind?: ObjectKind): ObjectSummary[] {
  const sql = `SELECT kind, name, description, nav_group, created, modified FROM bc_objects WHERE ${TEXT_NAME} ${kind ? 'AND kind = ?' : ''} ORDER BY kind, bc_fold(name), name`;
  return (db.prepare(sql).all(...(kind ? [kind] : [])) as unknown as Row[]).map(summary);
}

/** The stored name (its own case) and the parsed definition, or null. A definition that is not a JSON object within the
 *  save limits (definitionJson; edited by an external tool) throws bc:corruptObject. */
export function getObject(db: DatabaseSync, kind: ObjectKind, name: string): { name: string; definition: unknown } | null {
  const stored = find(db, kind, name);
  if (stored === undefined) return null;
  const text: unknown = row(db, kind, stored).definition;
  let definition: unknown;
  if (typeof text === 'string' && text.length <= MAX_DEFINITION_CHARS) try { definition = JSON.parse(text); } catch { /* below */ }
  if (definitionJson(definition) === null) throw new Error('bc:corruptObject');
  return { name: stored, definition };
}

/** Creates (`originalName` null) or rewrites an object, renaming it when `name` differs from `originalName`. */
export function saveObject(db: DatabaseSync, kind: ObjectKind, name: string, definition: unknown, originalName: string | null): OpResult {
  name = nfc(name); // first: the 64-character limit counts the composed form
  if (!validName(name)) return fail('nameInvalid');
  const json = JSON.stringify(definition);
  const now = new Date().toISOString();
  return inTransaction(db, () => {
    if (originalName === null) {
      if (taken(db, kind, name)) return fail('nameExists');
      db.prepare('INSERT INTO bc_objects (kind, name, definition, created, modified) VALUES (?, ?, ?, ?, ?)').run(kind, name, json, now, now);
      return { ok: true };
    }
    const cur = find(db, kind, originalName);
    if (cur === undefined) return fail('notFound');
    if (taken(db, kind, name, cur)) return fail('nameExists');
    db.prepare('UPDATE bc_objects SET name = ?, definition = ?, modified = ? WHERE kind = ? AND name = ?').run(name, json, now, kind, cur);
    return { ok: true };
  });
}

export function renameObject(db: DatabaseSync, kind: ObjectKind, oldName: string, newName: string): OpResult {
  newName = nfc(newName);
  if (!validName(newName)) return fail('nameInvalid');
  return inTransaction(db, () => {
    const cur = find(db, kind, oldName);
    if (cur === undefined) return fail('notFound');
    if (taken(db, kind, newName, cur)) return fail('nameExists');
    db.prepare('UPDATE bc_objects SET name = ? WHERE kind = ? AND name = ?').run(newName, kind, cur);
    return { ok: true };
  });
}

export function deleteObject(db: DatabaseSync, kind: ObjectKind, name: string): OpResult {
  const cur = find(db, kind, name);
  if (cur === undefined) return fail('notFound');
  db.prepare('DELETE FROM bc_objects WHERE kind = ? AND name = ?').run(kind, cur);
  return { ok: true };
}

/** Properties dialog: the description ('' or null removes it); the object counts as modified, as in Access. */
export function setObjectDescription(db: DatabaseSync, kind: ObjectKind, name: string, description: string | null): OpResult {
  const cur = find(db, kind, name);
  if (cur === undefined) return fail('notFound');
  db.prepare('UPDATE bc_objects SET description = ?, modified = ? WHERE kind = ? AND name = ?').run(description || null, new Date().toISOString(), kind, cur);
  return { ok: true };
}

/** Copy with the same definition, description and group; new dates. */
export function copyObject(db: DatabaseSync, kind: ObjectKind, name: string, newName: string): OpResult {
  newName = nfc(newName);
  if (!validName(newName)) return fail('nameInvalid');
  const now = new Date().toISOString();
  return inTransaction(db, () => {
    const cur = find(db, kind, name);
    if (cur === undefined) return fail('notFound');
    if (taken(db, kind, newName)) return fail('nameExists');
    db.prepare(`INSERT INTO bc_objects (kind, name, definition, description, nav_group, created, modified)
      SELECT kind, ?, definition, description, nav_group, ?, ? FROM bc_objects WHERE kind = ? AND name = ?`).run(newName, now, now, kind, cur);
    return { ok: true };
  });
}
