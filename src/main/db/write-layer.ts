// Couche d'écriture unique : toute écriture de données passe ici (conversion, validation, transaction).
import type { DatabaseSync } from 'node:sqlite';
import { coerce, listItemValue, type CellInput, type FieldErrorCode, type SqlValue } from '../../shared/coerce';
import { lookupOf, MASK_TYPES, valueListRows, type FieldDef, type TableDesign } from '../../shared/field-types';
import { checkMasked, parseMask } from '../../shared/expr/input-mask';
import type { LocaleInfo } from '../../shared/locale-format';
import { foreignKeys, listTables, parentOf, pickName, quoteIdent, refColumns, sqliteSameName, tableDesign } from './schema';
import { applyDefaults, checkRecordRule, checkRules, DefaultValueError } from './rules';
import { degraded, lookupSource, queryRowSource } from './rows';
import { sourceHasValue } from '../query/source';
import { inTransaction } from './tx';

import type { DeleteResult, RowWriteResult } from '../../shared/api';
export type { DeleteResult, RowWriteResult };
type FieldError = { field: string; code: FieldErrorCode; message?: string; table?: string };

const CHUNK = 500;

/** Codes of a value the field cannot store (type conversion failure, Access's term). */
const CONVERSION: ReadonlySet<FieldErrorCode> = new Set(['invalidNumber', 'outOfRange', 'invalidDate', 'tooLong']);
/** Required, or part of a primary key BaseCraft created (NOT NULL: a Null is refused as Required, never as a raw SQLite
 *  error). A table made elsewhere keeps its own key rules (a DEFAULT, a NULL SQLite allows): its NOT NULL is `required`. */
const needsValue = (fd: FieldDef): boolean => fd.props.type !== 'autoNumber' && (fd.props.required || (!!fd.props.primaryKey && !fd.props.external));

/** Convertit les champs présents ; `requiredAbsent` vérifie aussi les champs obligatoires absents (insertion).
 *  `allowAutoNumber` : un NuméroAuto donné est converti comme un Entier long (Null : numéroté par SQLite).
 *  `nullOnConversion` : une valeur que le champ ne peut pas stocker devient Null (`nulled`), sauf champ obligatoire. */
function convert(design: TableDesign, values: Record<string, CellInput>, info: LocaleInfo, requiredAbsent: boolean, opts: WriteOptions = {}) {
  const keys = Object.keys(values);
  for (const k of keys) if (!design.fields.some((fd) => fd.name === k)) throw new Error(`unknown field: ${k}`);
  const errors: FieldError[] = [];
  const nulled: { field: string; code: FieldErrorCode }[] = [];
  const cols: { fd: FieldDef; value: SqlValue }[] = [];
  for (const fd of design.fields) {
    if (keys.includes(fd.name)) {
      const auto = opts.allowAutoNumber && fd.props.type === 'autoNumber';
      if (auto && (values[fd.name] === null || values[fd.name] === '')) continue;
      const r = coerce(auto ? { name: fd.name, props: { ...fd.props, type: 'number', numberSize: 'longInteger' } } : fd, values[fd.name], info);
      const value = r.ok ? r.value : opts.nullOnConversion && CONVERSION.has(r.error) ? null : undefined;
      if (value === undefined) errors.push({ field: fd.name, code: (r as { error: FieldErrorCode }).error });
      else if (value === null && needsValue(fd)) errors.push({ field: fd.name, code: 'required' });
      else {
        cols.push({ fd, value });
        if (!r.ok) nulled.push({ field: fd.name, code: r.error });
      }
    } else if (requiredAbsent && needsValue(fd)) errors.push({ field: fd.name, code: 'required' });
  }
  return { errors, cols, nulled };
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

/**
 * noParent on the first column of the real key of `design` whose parent row is missing for `row` (child values), parent named.
 * `changed`: the columns an update sets; SQLite checks only the keys that use one of them (an insert checks every key).
 */
function missingParent(db: DatabaseSync, design: TableDesign, row: Record<string, SqlValue>, changed?: string[]): FieldError | undefined {
  const live = listTables(db).map((x) => x.name);
  const keys = foreignKeys(db).filter((x) => x.child === design.name && (!changed || x.from.some((c) => changed.some((n) => sqliteSameName(n, c)))));
  for (const k of keys) {
    const fields = k.from.map((c) => fieldOf(design, c));
    if (fields.some((x) => x === undefined)) continue;
    const key = fields.map((x) => row[x!] ?? null);
    if (key.some((v) => v === null)) continue; // a Null part references nothing
    const parent = parentOf(live, k);
    const where = parent && refColumns(db, k, parent).map((c) => `${quoteIdent(c)} = ?`).join(' AND ');
    if (!parent || !where || !db.prepare(`SELECT 1 FROM ${quoteIdent(parent)} WHERE ${where} LIMIT 1`).get(...key)) {
      // On an update, the key's column the user changed carries the error (the cursor goes there).
      const field = (changed && fields.find((x) => changed.some((n) => sqliteSameName(n, x!)))) ?? fields[0]!;
      return { field, code: 'noParent', table: parent ?? k.parent };
    }
  }
  return undefined;
}

/**
 * The table whose real key refuses a delete (`changed` null) or a change of the referenced fields in `changed` of these rows
 * of `table`: a NO ACTION or RESTRICT key with referencing rows, found down the CASCADE chain; else a SET DEFAULT key with
 * referencing rows (its default may have no parent). Only tables holding related rows are named; undefined when the chain
 * cannot be found (the caller then names no table). `field`: the first changed field of `table` that the key references.
 */
function blockingKey(db: DatabaseSync, table: string, rowids: number[], changed: string[] | null, path = new Set<string>()): { child: string; field?: string } | undefined {
  if (path.has(table)) return undefined; // a cycle of cascades
  const keys = foreignKeys(db).filter((k) => sqliteSameName(k.parent, table)).map((k) => {
    const to = refColumns(db, k, table);
    return { k, to, field: changed?.find((x) => to.some((c) => sqliteSameName(c, x))) };
  }).filter((x) => changed === null || x.field !== undefined);
  let setDefault: { child: string; field?: string } | undefined;
  for (const { k, to, field } of keys) {
    const action = changed === null ? k.onDelete : k.onUpdate;
    if (action === 'SET NULL') continue; // a NOT NULL it breaks is another error (nulledChild)
    const c = k.from.map(quoteIdent).join(', ');
    const p = to.map(quoteIdent).join(', ');
    const children: number[] = [];
    for (let i = 0; i < rowids.length; i += CHUNK) {
      const ids = rowids.slice(i, i + CHUNK);
      const sql = `SELECT rowid AS r FROM ${quoteIdent(k.child)} WHERE (${c}) IN (SELECT ${p} FROM ${quoteIdent(table)} WHERE rowid IN (${ids.map(() => '?').join(', ')}))`;
      for (const row of db.prepare(sql).all(...ids) as { r: number }[]) children.push(row.r);
    }
    if (children.length === 0) continue;
    if (action === 'SET DEFAULT') setDefault ??= { child: k.child, field };
    else if (action !== 'CASCADE') return { child: k.child, field };
    else {
      const deeper = blockingKey(db, k.child, children, changed === null ? null : k.from, new Set(path).add(table));
      if (deeper) return { child: deeper.child, field };
    }
  }
  return setDefault;
}

/** Options of a write. `enforceMask`: datasheet/form entry, where the input mask (A2-R10) and a lookup's Limit To List apply;
 *  imports and other programmatic writes ignore both, as in Access. `allowAutoNumber` (A3 Append queries, insert only): an
 *  integer value for the AutoNumber is accepted, as Access appends it. `nullOnConversion` (A3 action queries run anyway): a
 *  value its field cannot store is written as Null and reported in `nulled`, as Access does; the field's rule then runs on
 *  the Null, and a Required or primary-key field refuses it. */
export interface WriteOptions { enforceMask?: boolean; allowAutoNumber?: boolean; nullOnConversion?: boolean }

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

/**
 * Limit To List: a value of a lookup field must be in its list, compared as stored: a value list's bound items converted as
 * the field stores them, a Field List's names, else a row of the source table (`SELECT 1 … WHERE bound = ?`), or of the SQL
 * or saved query's bound column (A2-R18). Empty passes (Required decides); a source table or field that is gone, or a query
 * that does not run, checks nothing.
 */
function notInList(db: DatabaseSync, cols: { fd: FieldDef; value: SqlValue }[], info: LocaleInfo): FieldError[] {
  const errors: FieldError[] = [];
  for (const { fd, value } of cols) {
    const l = lookupOf(fd);
    if (!l?.limitToList || value === null) continue;
    let found: boolean;
    if (l.kind === 'values') {
      const b = (l.boundColumn ?? 1) - 1;
      found = valueListRows(l).rows.some((r) => r[b] !== undefined && listItemValue(fd, r[b]!) === value);
    } else if (l.kind === 'fieldList') {
      const table = pickName(listTables(db).map((x) => x.name), l.table);
      found = table === undefined || tableDesign(db, table).fields.some((x) => x.name === value);
    } else {
      const query = queryRowSource(db, l);
      const src = query ? undefined : lookupSource(db, l);
      found = query ? degraded(() => sourceHasValue(db, query, (l.boundColumn ?? 1) - 1, value, info), true)
        : !src || !!db.prepare(`SELECT 1 FROM ${quoteIdent(src.design.name)} WHERE ${quoteIdent(src.bound.name)} = ? LIMIT 1`).get(value);
    }
    if (!found) errors.push({ field: fd.name, code: 'notInList' });
  }
  return errors;
}

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
  const { errors, cols, nulled } = convert(design, filled, info, true, opts);
  if (errors.length > 0) return { ok: false, errors };
  const unlisted = opts.enforceMask ? notInList(db, cols.filter((c) => Object.hasOwn(values, c.fd.name)), info) : [];
  if (unlisted.length > 0) return { ok: false, errors: unlisted };
  const stored = storedOf(cols);
  for (const fd of design.fields) if (fd.props.type === 'yesNo' && !Object.hasOwn(stored, fd.name)) stored[fd.name] = 0; // DEFAULT 0
  const broken = await checkRules(design, stored, design.fields.map((fd) => fd.name), now, info);
  if (broken.length > 0) return { ok: false, errors: broken };
  const record = await checkRecordRule(design, stored, now, info);
  if (record) return { ok: false, errors: [record] };
  const table = quoteIdent(design.name);
  const sql = cols.length === 0 ? `INSERT OR ABORT INTO ${table} DEFAULT VALUES`
    : `INSERT OR ABORT INTO ${table} (${cols.map((c) => quoteIdent(c.fd.name)).join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`;
  try {
    return inTransaction(db, () => {
      const r = db.prepare(sql).run(...cols.map((c) => c.value));
      if (Number(r.changes) !== 1) throw new Error('insert changed an unexpected number of rows');
      const rowid = Number(r.lastInsertRowid);
      return { ok: true as const, rowid, values: readBack(db, design, rowid), ...(nulled.length && { nulled }) };
    });
  } catch (e) {
    if (isForeignKeyError(e)) {
      // A generated AutoNumber is part of the key too: the one SQLite was about to give (the failed insert was rolled back).
      const auto = design.fields.find((fd) => fd.props.type === 'autoNumber' && !Object.hasOwn(stored, fd.name));
      const p = missingParent(db, design, auto ? { ...stored, [auto.name]: nextAutoNumber(db, design.name) } : stored);
      if (p) return { ok: false, errors: [p] };
    }
    return duplicateOrThrow(design, e);
  }
}

/** The AutoNumber SQLite gives the next row of `table`: past its largest rowid and, with AUTOINCREMENT, past its sequence. */
function nextAutoNumber(db: DatabaseSync, table: string): number {
  const max = (db.prepare(`SELECT coalesce(max(rowid), 0) AS n FROM ${quoteIdent(table)}`).get() as { n: number }).n;
  const sequence = db.prepare(`SELECT 1 FROM sqlite_master WHERE name = 'sqlite_sequence'`).get()
    ? (db.prepare('SELECT seq FROM sqlite_sequence WHERE name = ?').get(table) as { seq: number } | undefined)?.seq ?? 0 : 0;
  return Math.max(Number(max), Number(sequence)) + 1;
}

/** The first of the `changed` fields of `table` that a real key references: where a parent-side refusal goes. */
function referencedField(db: DatabaseSync, table: string, changed: string[]): string {
  const keys = foreignKeys(db).filter((k) => sqliteSameName(k.parent, table));
  return changed.find((n) => keys.some((k) => refColumns(db, k, table).some((c) => sqliteSameName(c, n)))) ?? changed[0]!;
}

/** Only the changed fields' rules are checked (a row that broke a later rule stays editable). */
export async function updateRow(db: DatabaseSync, design: TableDesign, rowid: number, changes: Record<string, CellInput>, info: LocaleInfo, now: () => Date = () => new Date(), opts: WriteOptions = {}): Promise<RowWriteResult> {
  if (opts.enforceMask) {
    const m = applyMasks(design, changes);
    if (m.errors.length > 0) return { ok: false, errors: m.errors };
    changes = m.values;
  }
  const { errors, cols, nulled } = convert(design, changes, info, false, opts);
  if (errors.length > 0) return { ok: false, errors };
  const unlisted = opts.enforceMask ? notInList(db, cols, info) : [];
  if (unlisted.length > 0) return { ok: false, errors: unlisted };
  const broken = await checkRules(design, storedOf(cols), Object.keys(changes), now, info);
  if (broken.length > 0) return { ok: false, errors: broken };
  if (design.validationRule) { // the whole record: stored values with the changes
    const current = readBack(db, design, rowid);
    const row = { ...Object.fromEntries(design.fields.map((fd, i) => [fd.name, current[i] ?? null])), ...storedOf(cols) };
    const record = await checkRecordRule(design, row, now, info);
    if (record) return { ok: false, errors: [record] };
  }
  try {
    return inTransaction(db, () => {
      if (cols.length > 0) {
        const n = db.prepare(`UPDATE OR ABORT ${quoteIdent(design.name)} SET ${cols.map((c) => `${quoteIdent(c.fd.name)} = ?`).join(', ')} WHERE rowid = ?`)
          .run(...cols.map((c) => c.value), rowid).changes;
        if (Number(n) === 0) throw new Error('row not found');
        if (Number(n) !== 1) throw new Error('update changed an unexpected number of rows');
      }
      return { ok: true as const, rowid, values: readBack(db, design, rowid), ...(nulled.length && { nulled }) };
    });
  } catch (e) {
    const changed = cols.map((c) => c.fd.name);
    if (isForeignKeyError(e)) {
      // As a child: the new values must have a parent. As a parent: the changed key must not leave children behind.
      const current = readBack(db, design, rowid);
      const row = { ...Object.fromEntries(design.fields.map((fd, i) => [fd.name, current[i] ?? null])), ...storedOf(cols) };
      const p = missingParent(db, design, row, changed);
      if (p) return { ok: false, errors: [p] };
      const b = blockingKey(db, design.name, [rowid], changed);
      return { ok: false, errors: [b ? { field: b.field!, code: 'related', table: b.child } : { field: referencedField(db, design.name, changed), code: 'related' }] };
    }
    const nulled = nulledChild(db, e, 'onUpdate');
    if (nulled) return { ok: false, errors: [{ field: referencedField(db, design.name, changed), code: 'related', table: nulled }] };
    return duplicateOrThrow(design, e);
  }
}

/**
 * The child table whose NOT NULL column a SET NULL or SET DEFAULT (`action` of a real key, maybe reached through a cascade)
 * broke: SQLite names the column exactly.
 */
function nulledChild(db: DatabaseSync, e: unknown, action: 'onDelete' | 'onUpdate'): string | undefined {
  const m = e instanceof Error ? /^NOT NULL constraint failed: ([\s\S]+)$/.exec(e.message) : null;
  return m ? foreignKeys(db).find((k) => ['SET NULL', 'SET DEFAULT'].includes(k[action])
    && k.from.some((c) => sqliteSameName(m[1]!, `${k.child}.${c}`)))?.child : undefined;
}

/**
 * All or nothing: a row with related records (relation with integrity, without cascade) refuses the whole delete, as does
 * a SET NULL that a NOT NULL column of the child refuses. `table` is left out when the refusing table cannot be found.
 */
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
    if (isForeignKeyError(e)) {
      const child = blockingKey(db, table, rowids, null)?.child;
      return child === undefined ? { ok: false, reason: 'related' } : { ok: false, reason: 'related', table: child };
    }
    const child = nulledChild(db, e, 'onDelete');
    if (!child) throw e;
    return { ok: false, reason: 'related', table: child };
  }
}

/** A table copy: every row of `from` into `to`, a new empty table with the same design (createTable). The rows already meet
 *  the same rules, so they are copied as they are, in rowid order (primary-key order for a WITHOUT ROWID table), AutoNumber
 *  values included; the CHECK constraints of `to` still apply. */
export function copyRows(db: DatabaseSync, from: TableDesign, to: string): number {
  const cols = from.fields.map((x) => quoteIdent(x.name)).join(', ');
  const noRowid = db.prepare(`SELECT 1 FROM pragma_table_list WHERE schema = 'main' AND name = ? AND wr = 1`).get(from.name);
  const order = noRowid ? '' : ' ORDER BY rowid';
  return Number(db.prepare(`INSERT INTO ${quoteIdent(to)} (${cols}) SELECT ${cols} FROM ${quoteIdent(from.name)}${order}`).run().changes);
}
