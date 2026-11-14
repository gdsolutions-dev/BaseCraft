// Attachment fields (C5, format 1.5): bc_attachments. An Attachment cell holds the id of its set of files (NULL: none), so the
// files follow the row through a table rebuild, a Compact (VACUUM renumbers rowids) and a table copy. Everything here runs on
// the file that owns the table. The files of a row a CASCADE removes, of a dropped table or of a dropped field are removed by
// purgeOrphanSets (called by those operations, in their transaction, and by Compact as the safety net).
import type { DatabaseSync } from 'node:sqlite';
import { ATTACHMENT_MAX_BYTES, ATTACHMENT_PREVIEW_MAX_BYTES, attachmentName, attachmentType, type AttachmentFace, type AttachmentInfo } from '../../shared/attachments';
import { sameName, type FieldDef, type TableDesign } from '../../shared/field-types';
import { pictureDataUrl, sniffPicture } from '../../shared/pictures';
import { quoteIdent, tableDesign } from './schema';
import { inTransaction } from './tx';

export type { AttachmentInfo };

const hasTable = (db: DatabaseSync): boolean => !!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='bc_attachments'").get();
export const attachmentFields = (design: TableDesign): FieldDef[] => design.fields.filter((f) => f.props.type === 'attachment');

/** SQL of what a datasheet shows for an Attachment column: the number of files (the stored value is the set id). */
export const attachmentCountSql = (db: DatabaseSync, fd: FieldDef): string =>
  hasTable(db) ? `(SELECT count(*) FROM bc_attachments WHERE set_id = ${quoteIdent(fd.name)})` : quoteIdent(fd.name);

function fieldOf(design: TableDesign, field: string): FieldDef {
  const fd = design.fields.find((f) => sameName(f.name, field));
  if (!fd || fd.props.type !== 'attachment') throw new Error('bc:invalidArgument');
  return fd;
}
const setOf = (db: DatabaseSync, design: TableDesign, fd: FieldDef, rowid: number): number | null => {
  const r = db.prepare(`SELECT ${quoteIdent(fd.name)} AS s FROM ${quoteIdent(design.name)} WHERE rowid = ?`).get(rowid) as { s: number | bigint | null } | undefined;
  if (!r) throw new Error('bc:notFound');
  return r.s === null ? null : Number(r.s);
};

export function listAttachments(db: DatabaseSync, table: string, field: string, rowid: number): AttachmentInfo[] {
  const design = tableDesign(db, table);
  const set = setOf(db, design, fieldOf(design, field), rowid);
  if (set === null || !hasTable(db)) return [];
  return db.prepare('SELECT id, name, type, length(data) AS bytes FROM bc_attachments WHERE set_id = ? ORDER BY id').all(set).map((r) => ({ ...r, id: Number(r.id), bytes: Number(r.bytes) })) as unknown as AttachmentInfo[];
}

/** The files `files` (name + bytes) added to the row's cell. A name already in the set becomes "name (2).ext". Over 25 MB or an
 *  unusable name: bc:attachmentTooLarge / bc:invalidArgument, nothing added. Returns the names as stored. */
export function addAttachments(db: DatabaseSync, table: string, field: string, rowid: number, files: { name: string; data: Uint8Array }[]): string[] {
  const design = tableDesign(db, table);
  const fd = fieldOf(design, field);
  for (const f of files) {
    if (f.data.length > ATTACHMENT_MAX_BYTES) throw new Error('bc:attachmentTooLarge');
    if (attachmentName(f.name) === null) throw new Error('bc:invalidArgument');
  }
  return inTransaction(db, () => {
    let set = setOf(db, design, fd, rowid);
    if (set === null) {
      set = Number((db.prepare('SELECT coalesce(max(set_id), 0) + 1 AS n FROM bc_attachments').get() as { n: number | bigint }).n);
      db.prepare(`UPDATE ${quoteIdent(design.name)} SET ${quoteIdent(fd.name)} = ? WHERE rowid = ?`).run(set, rowid);
    }
    const taken = new Set((db.prepare('SELECT name FROM bc_attachments WHERE set_id = ?').all(set) as { name: string }[]).map((r) => r.name.toLowerCase()));
    const now = new Date().toISOString();
    return files.map((f) => {
      const base = attachmentName(f.name)!;
      let name = base;
      const dot = base.lastIndexOf('.');
      const [stem, ext] = dot > 0 ? [base.slice(0, dot), base.slice(dot)] : [base, ''];
      for (let i = 2; taken.has(name.toLowerCase()); i++) name = `${stem} (${i})${ext}`;
      taken.add(name.toLowerCase());
      db.prepare('INSERT INTO bc_attachments (set_id, name, type, data, created) VALUES (?, ?, ?, ?, ?)').run(set!, name, attachmentType(name), f.data, now);
      return name;
    });
  });
}

/** One file of the row's cell (its id must belong to that cell's set), or bc:notFound. */
function member(db: DatabaseSync, table: string, field: string, rowid: number, id: number) {
  const design = tableDesign(db, table);
  const fd = fieldOf(design, field);
  const set = setOf(db, design, fd, rowid);
  const row = set === null ? undefined : db.prepare('SELECT id, name, type, data FROM bc_attachments WHERE id = ? AND set_id = ?').get(id, set) as { id: number; name: string; type: string; data: Uint8Array } | undefined;
  if (!row) throw new Error('bc:notFound');
  return { design, fd, set: set!, row };
}

/** The first file of each row's cell: a picture as a data URL (PNG, JPEG, GIF, WebP of at most 8 MB, by signature), else its name and type. */
export function facesOf(db: DatabaseSync, table: string, field: string, rowids: number[]): (AttachmentFace | null)[] {
  const design = tableDesign(db, table);
  const fd = fieldOf(design, field);
  if (!hasTable(db)) return rowids.map(() => null);
  const q = db.prepare(`SELECT name, type, data FROM bc_attachments WHERE set_id = (SELECT ${quoteIdent(fd.name)} FROM ${quoteIdent(design.name)} WHERE rowid = ?) ORDER BY id LIMIT 1`);
  return rowids.map((id) => {
    const r = q.get(id) as { name: string; type: string; data: Uint8Array } | undefined;
    if (!r) return null;
    const kind = r.data.length <= ATTACHMENT_PREVIEW_MAX_BYTES ? sniffPicture(r.data) : null;
    return { name: r.name, type: r.type, src: kind ? pictureDataUrl(kind, r.data) : null };
  });
}

export function getAttachment(db: DatabaseSync, table: string, field: string, rowid: number, id: number): { name: string; data: Uint8Array } {
  const { row } = member(db, table, field, rowid, id);
  return { name: row.name, data: row.data };
}

/** A data URL of the file when it is a PNG, JPEG, GIF or WebP of at most 8 MB (by signature, not name), else null. */
export function previewAttachment(db: DatabaseSync, table: string, field: string, rowid: number, id: number): string | null {
  const { row } = member(db, table, field, rowid, id);
  const kind = row.data.length <= ATTACHMENT_PREVIEW_MAX_BYTES ? sniffPicture(row.data) : null;
  return kind ? pictureDataUrl(kind, row.data) : null;
}

/** Removes the file; the cell goes back to Null with its last file. */
export function removeAttachment(db: DatabaseSync, table: string, field: string, rowid: number, id: number): void {
  inTransaction(db, () => {
    const { design, fd, set } = member(db, table, field, rowid, id);
    db.prepare('DELETE FROM bc_attachments WHERE id = ?').run(id);
    if (!db.prepare('SELECT 1 FROM bc_attachments WHERE set_id = ?').get(set)) db.prepare(`UPDATE ${quoteIdent(design.name)} SET ${quoteIdent(fd.name)} = NULL WHERE rowid = ?`).run(rowid);
  });
}

/** The files of the rows about to be deleted (call inside the delete's transaction, before the DELETE). */
export function deleteSetsOf(db: DatabaseSync, design: TableDesign, ids: number[]): void {
  const fields = attachmentFields(design);
  if (!fields.length || !ids.length || !hasTable(db)) return;
  for (const fd of fields) {
    db.prepare(`DELETE FROM bc_attachments WHERE set_id IN (SELECT ${quoteIdent(fd.name)} FROM ${quoteIdent(design.name)} WHERE rowid IN (${ids.map(() => '?').join(', ')}))`).run(...ids);
  }
}

/** Removes every set no Attachment cell references (CASCADE, dropped table or field, a delete by SQL). Skipped when a table
 *  cannot be read: never delete on a doubt. */
export function purgeOrphanSets(db: DatabaseSync): void {
  if (!hasTable(db) || !db.prepare('SELECT 1 FROM bc_attachments').get()) return;
  const refs: string[] = [];
  try {
    for (const { name } of db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND substr(name, 1, 7) <> 'sqlite_' AND substr(name, 1, 3) <> 'bc_'").all() as { name: string }[]) {
      for (const fd of attachmentFields(tableDesign(db, name))) refs.push(`SELECT ${quoteIdent(fd.name)} FROM ${quoteIdent(name)} WHERE ${quoteIdent(fd.name)} IS NOT NULL`);
    }
  } catch { return; }
  db.exec(`DELETE FROM bc_attachments WHERE set_id NOT IN (${refs.length ? refs.join(' UNION ') : 'SELECT -1'})`);
}

/** After a table copy (`to` filled from `from`): every set of `to` is a copy of its own, so editing one table never changes the other. */
export function copySets(db: DatabaseSync, from: TableDesign, to: string): void {
  if (!hasTable(db)) return;
  for (const fd of attachmentFields(from)) {
    const off = Number((db.prepare('SELECT coalesce(max(set_id), 0) AS n FROM bc_attachments').get() as { n: number | bigint }).n);
    db.prepare(`INSERT INTO bc_attachments (set_id, name, type, data, created)
      SELECT set_id + ?, name, type, data, created FROM bc_attachments WHERE set_id IN (SELECT ${quoteIdent(fd.name)} FROM ${quoteIdent(to)}) ORDER BY id`).run(off);
    db.prepare(`UPDATE ${quoteIdent(to)} SET ${quoteIdent(fd.name)} = ${quoteIdent(fd.name)} + ? WHERE ${quoteIdent(fd.name)} IS NOT NULL`).run(off);
  }
}

/** What an export writes for an Attachment cell: the names of the row's files, « ; » between them (Null without any). */
export function attachmentNames(db: DatabaseSync, design: TableDesign, fd: FieldDef, rowid: number): string | null {
  if (!hasTable(db)) return null;
  const r = db.prepare(`SELECT group_concat(name, '; ') AS n FROM (SELECT name FROM bc_attachments WHERE set_id = (SELECT ${quoteIdent(fd.name)} FROM ${quoteIdent(design.name)} WHERE rowid = ?) ORDER BY id)`).get(rowid) as { n: string | null };
  return r.n;
}
