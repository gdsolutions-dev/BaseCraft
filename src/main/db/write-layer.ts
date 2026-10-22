// Couche d'écriture unique : toute écriture de données passe ici (conversion, validation, transaction).
import type { DatabaseSync } from 'node:sqlite';
import { coerce, type CellInput, type FieldErrorCode, type SqlValue } from '../../shared/coerce';
import { MASK_TYPES, type FieldDef, type TableDesign } from '../../shared/field-types';
import { checkMasked, parseMask } from '../../shared/expr/input-mask';
import type { LocaleInfo } from '../../shared/locale-format';
import { foreignKeys, listTables, parentOf, quoteIdent, refColumns, sqliteSameName } from './schema';
import { applyDefaults, checkRules, DefaultValueError } from './rules';
import { inTransaction } from './tx';

import type { DeleteResult, RowWriteResult } from '../../shared/api';
export type { DeleteResult, RowWriteResult };
type FieldError = { field: string; code: FieldErrorCode; message?: string; table?: string };

const CHUNK = 500;

/** Convertit les champs présents ; `requiredAbsent` vérifie aussi les champs obligatoires absents (insertion). */
function convert(design: TableDesign, values: Record<string, CellInput>, info: LocaleInfo, requiredAbsent: boolean) {
  const keys = Object.keys(values);
  for (const k of keys) if (!design.fields.some((fd) => fd.name === k)) throw new Error(`unknown field: ${k}`);
  const errors: FieldError[] = [];
  const cols: { fd: FieldDef; value: SqlValue }[] = [];
  for (const fd of design.fields) {
    if (keys.includes(fd.name)) {
      const r = coerce(fd, values[fd.name], info);
      if (r.ok) cols.push({ fd, value: r.value });
      else errors.push({ field: fd.name, code: r.error });
    } else if (requiredAbsent && fd.props.required && fd.props.type !== 'autoNumber') errors.push({ field: fd.name, code: 'required' });
  }
  return { errors, cols };
}

function readBack(db: DatabaseSync, design: TableDesign, rowid: number): SqlValue[] {
  const stmt = db.prepare(`SELECT ${design.fields.map((fd) => quoteIdent(fd.name)).join(', ')} FROM ${quoteIdent(design.name)} WHERE rowid = ?`);
  stmt.setReturnArrays(true);
  const row = stmt.get(rowid) as unknown as SqlValue[] | undefined;
  if (!row) throw new Error('row not found');
  return row;
}

/** Traduit `UNIQUE constraint failed: T.a[, T.b]` en erreur de champ ; sinon relance.
 *  Comparaison avec la conception (les noms peuvent contenir ", ") ; clé composée : on signale la première colonne. */
function duplicateOrThrow(design: TableDesign, e: unknown): RowWriteResult {
  const m = e instanceof Error ? /^UNIQUE constraint failed: ([\s\S]+)$/.exec(e.message) : null;
  const p = design.name + '.';
  if (m && m[1].startsWith(p)) {
    const rest = m[1].slice(p.length);
    const fd = design.fields
      .filter((x) => rest === x.name || rest.startsWith(x.name + ', ' + p))
      .sort((a, b) => b.name.length - a.name.length)[0];
    if (fd) return { ok: false, errors: [{ field: fd.name, code: 'duplicate' }] };
  }
  throw e;
}

// SQLite says `FOREIGN KEY constraint failed` without naming the constraint (immediate constraints: the statement fails and
// its savepoint is rolled back). The key is found again from the data, after the rollback, among the real keys (A2-R14):
// a relation's, or another tool's.
const isForeignKeyError = (e: unknown): boolean => e instanceof Error && /FOREIGN KEY constraint failed/.test(e.message);

/** The design field a key column names (SQLite ignores ASCII case in column names). */
const fieldOf = (design: TableDesign, column: string): string | undefined =>
  design.fields.find((fd) => fd.name === column)?.name ?? design.fields.find((fd) => sqliteSameName(fd.name, column))?.name;

/** noParent on the first column of the real key of `design` whose parent row is missing for `row` (child values), parent named. */
function missingParent(db: DatabaseSync, design: TableDesign, row: Record<string, SqlValue>): FieldError | undefined {
  const live = listTables(db).map((x) => x.name);
  for (const k of foreignKeys(db).filter((x) => x.child === design.name)) {
    const fields = k.from.map((c) => fieldOf(design, c));
    if (fields.some((x) => x === undefined)) continue;
    const key = fields.map((x) => row[x!] ?? null);
    if (key.some((v) => v === null)) continue; // a Null part references nothing
    const parent = parentOf(live, k);
    const where = parent && refColumns(db, k, parent).map((c) => `${quoteIdent(c)} = ?`).join(' AND ');
    if (!parent || !where || !db.prepare(`SELECT 1 FROM ${quoteIdent(parent)} WHERE ${where} LIMIT 1`).get(...key)) {
      return { field: fields[0]!, code: 'noParent', table: parent ?? k.parent };
    }
  }
  return undefined;
}

/**
 * The real key (NO ACTION or RESTRICT) whose child rows reference these rows of `table`: delete (`changed` null) or change of
 * the referenced fields in `changed`. `field`: the first changed field it references.
 */
function blockingKey(db: DatabaseSync, table: string, rowids: number[], changed: string[] | null): { child: string; field?: string } | undefined {
  const keys = foreignKeys(db).filter((k) => sqliteSameName(k.parent, table)).map((k) => {
    const to = refColumns(db, k, table);
    return { k, to, field: changed?.find((x) => to.some((c) => sqliteSameName(c, x))) };
  }).filter((x) => changed === null || x.field !== undefined);
  for (const { k, to, field } of keys) {
    if (['CASCADE', 'SET NULL', 'SET DEFAULT'].includes(changed === null ? k.onDelete : k.onUpdate)) continue;
    const c = k.from.map(quoteIdent).join(', ');
    const p = to.map(quoteIdent).join(', ');
    for (let i = 0; i < rowids.length; i += CHUNK) {
      const ids = rowids.slice(i, i + CHUNK);
      const sql = `SELECT 1 FROM ${quoteIdent(k.child)} WHERE (${c}) IN (SELECT ${p} FROM ${quoteIdent(table)} WHERE rowid IN (${ids.map(() => '?').join(', ')})) LIMIT 1`;
      if (db.prepare(sql).get(...ids)) return { child: k.child, field };
    }
  }
  // ponytail: a cascade that reaches a grandchild without cascade is reported on the first cascading child, not the grandchild.
  return keys[0] && { child: keys[0].k.child, field: keys[0].field };
}

/** Options of a write. `enforceMask`: datasheet/form entry only; imports and other programmatic writes ignore input masks,
 *  as in Access (A2-R10). */
export interface WriteOptions { enforceMask?: boolean }

/** Typed text checked against its field's input mask (empty passes: Required handles it). A text field stores the masked
 *  text (with or without literals); a number or date keeps its full text for the normal conversion. */
function applyMasks(design: TableDesign, values: Record<string, CellInput>): { values: Record<string, CellInput>; errors: FieldError[] } {
  const errors: FieldError[] = [];
  const out = { ...values };
  for (const fd of design.fields) {
    const v = values[fd.name];
    if (!Object.hasOwn(values, fd.name) || typeof v !== 'string' || v === '' || !fd.props.inputMask || !MASK_TYPES.includes(fd.props.type)) continue;
    let mask;
    try { mask = parseMask(fd.props.inputMask); } catch { continue; } // unreadable (written by another tool): no mask, as validateDesign refuses it
    const r = checkMasked(fd.props.type === 'shortText' ? mask : { ...mask, storeLiterals: true }, v);
    if (r.ok) out[fd.name] = r.stored;
    else errors.push({ field: fd.name, code: 'mask' });
  }
  return { values: out, errors };
}

const storedOf = (cols: { fd: FieldDef; value: SqlValue }[]): Record<string, SqlValue> => Object.fromEntries(cols.map((c) => [c.fd.name, c.value]));

/** Absent fields get their default value (converted like an input); every field's rule is then checked. */
export async function insertRow(db: DatabaseSync, design: TableDesign, values: Record<string, CellInput>, info: LocaleInfo, now: () => Date = () => new Date(), opts: WriteOptions = {}): Promise<RowWriteResult> {
  if (opts.enforceMask) {
    const m = applyMasks(design, values);
    if (m.errors.length > 0) return { ok: false, errors: m.errors };
    values = m.values;
  }
  let filled: Record<string, CellInput>;
  try {
    filled = await applyDefaults(design, values, info, now);
  } catch (e) {
    if (e instanceof DefaultValueError) return { ok: false, errors: [{ field: e.field, code: 'expressionError' }] };
    throw e;
  }
  const { errors, cols } = convert(design, filled, info, true);
  if (errors.length > 0) return { ok: false, errors };
  const stored = storedOf(cols);
  for (const fd of design.fields) if (fd.props.type === 'yesNo' && !Object.hasOwn(stored, fd.name)) stored[fd.name] = 0; // DEFAULT 0
  const broken = await checkRules(design, stored, design.fields.map((fd) => fd.name), now, info);
  if (broken.length > 0) return { ok: false, errors: broken };
  const table = quoteIdent(design.name);
  const sql = cols.length === 0 ? `INSERT OR ABORT INTO ${table} DEFAULT VALUES`
    : `INSERT OR ABORT INTO ${table} (${cols.map((c) => quoteIdent(c.fd.name)).join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`;
  try {
    return inTransaction(db, () => {
      const r = db.prepare(sql).run(...cols.map((c) => c.value));
      if (Number(r.changes) !== 1) throw new Error('insert changed an unexpected number of rows');
      const rowid = Number(r.lastInsertRowid);
      return { ok: true as const, rowid, values: readBack(db, design, rowid) };
    });
  } catch (e) {
    const p = isForeignKeyError(e) ? missingParent(db, design, stored) : undefined;
    if (p) return { ok: false, errors: [p] };
    return duplicateOrThrow(design, e);
  }
}

/** Only the changed fields' rules are checked (a row that broke a later rule stays editable). */
export async function updateRow(db: DatabaseSync, design: TableDesign, rowid: number, changes: Record<string, CellInput>, info: LocaleInfo, now: () => Date = () => new Date(), opts: WriteOptions = {}): Promise<RowWriteResult> {
  if (opts.enforceMask) {
    const m = applyMasks(design, changes);
    if (m.errors.length > 0) return { ok: false, errors: m.errors };
    changes = m.values;
  }
  const { errors, cols } = convert(design, changes, info, false);
  if (errors.length > 0) return { ok: false, errors };
  const broken = await checkRules(design, storedOf(cols), Object.keys(changes), now, info);
  if (broken.length > 0) return { ok: false, errors: broken };
  try {
    return inTransaction(db, () => {
      if (cols.length > 0) {
        const n = db.prepare(`UPDATE OR ABORT ${quoteIdent(design.name)} SET ${cols.map((c) => `${quoteIdent(c.fd.name)} = ?`).join(', ')} WHERE rowid = ?`)
          .run(...cols.map((c) => c.value), rowid).changes;
        if (Number(n) === 0) throw new Error('row not found');
        if (Number(n) !== 1) throw new Error('update changed an unexpected number of rows');
      }
      return { ok: true as const, rowid, values: readBack(db, design, rowid) };
    });
  } catch (e) {
    if (isForeignKeyError(e)) {
      // As a child: the new values must have a parent. As a parent: the changed key must not leave children behind.
      const current = readBack(db, design, rowid);
      const row = { ...Object.fromEntries(design.fields.map((fd, i) => [fd.name, current[i] ?? null])), ...storedOf(cols) };
      const p = missingParent(db, design, row);
      if (p) return { ok: false, errors: [p] };
      const b = blockingKey(db, design.name, [rowid], cols.map((c) => c.fd.name));
      if (b) return { ok: false, errors: [{ field: b.field!, code: 'related', table: b.child }] };
    }
    return duplicateOrThrow(design, e);
  }
}

/** All or nothing: a row with related records (relation with integrity, without cascade) refuses the whole delete. */
export function deleteRows(db: DatabaseSync, table: string, rowids: number[]): DeleteResult {
  try {
    const count = inTransaction(db, () => {
      let n = 0;
      for (let i = 0; i < rowids.length; i += CHUNK) {
        const ids = rowids.slice(i, i + CHUNK);
        n += Number(db.prepare(`DELETE FROM ${quoteIdent(table)} WHERE rowid IN (${ids.map(() => '?').join(', ')})`).run(...ids).changes);
      }
      return n;
    });
    return { ok: true, count };
  } catch (e) {
    const b = isForeignKeyError(e) ? blockingKey(db, table, rowids, null) : undefined;
    if (!b) throw e;
    return { ok: false, reason: 'related', table: b.child };
  }
}
