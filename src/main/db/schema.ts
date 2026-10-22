import type { DatabaseSync } from 'node:sqlite';
import { inTransaction } from './tx';
import type { OpResult, ReconcileReport, Relation, TableSummary } from '../../shared/api';
export type { ReconcileReport, TableSummary };
import {
  defaultProps,
  isReservedName,
  quoteIdent,
  sameName,
  validateDesign,
  type DesignError,
  type FieldDef,
  type FieldProps,
  type FieldType,
  type NumberSize,
  type TableDesign,
} from '../../shared/field-types';

export { quoteIdent } from '../../shared/field-types';

export class DesignValidationError extends Error {
  constructor(public errors: DesignError[]) {
    super('invalid design: ' + errors.map((e) => e.code + (e.field ? `(${e.field})` : '')).join(', '));
    this.name = 'DesignValidationError';
  }
}
export class NameExistsError extends Error {
  constructor(name: string) {
    super(`a table named "${name}" already exists`);
    this.name = 'NameExistsError';
  }
}
/** A FOREIGN KEY of `table` references this name, whose table another tool dropped: a new table under it would become its parent. */
export class DanglingKeyError extends Error {
  constructor(public table: string) {
    super(`table "${table}" has a foreign key to a dropped table of that name`);
    this.name = 'DanglingKeyError';
  }
}
/** SQLite refused a rename because a view or trigger of the base no longer parses (`view`: its name). */
export class ViewBrokenError extends Error {
  constructor(public view: string) {
    super(`view or trigger "${view}" is broken`);
    this.name = 'ViewBrokenError';
  }
}
/** The view or trigger named by SQLite's `error in view|trigger <name>: …`, if that is the error. */
export function brokenObject(e: unknown): string | undefined {
  return e instanceof Error ? /^error in (?:view|trigger) (.+?): /.exec(e.message)?.[1] : undefined;
}

const FIELD_TYPES: readonly string[] = ['autoNumber', 'shortText', 'longText', 'number', 'currency', 'dateTime', 'yesNo', 'hyperlink'];
const NUMBER_SIZES: readonly string[] = ['byte', 'integer', 'longInteger', 'single', 'double', 'decimal'];
const INDEXED: readonly string[] = ['no', 'yesDuplicates', 'yesNoDuplicates'];
const INT_RANGE: Record<string, [number, number]> = {
  byte: [0, 255],
  integer: [-32768, 32767],
  longInteger: [-2147483648, 2147483647],
};

// ---------- DDL ----------

export const indexName = (table: string, field: string): string => `bcx_${table}.${field}`;

function columnDef(fd: FieldDef): string {
  const p = fd.props;
  const c = quoteIdent(fd.name);
  if (p.type === 'autoNumber') return `${c} INTEGER PRIMARY KEY AUTOINCREMENT`;
  const parts = [c];
  const checks: string[] = [];
  let notNull = p.required || p.primaryKey;
  switch (p.type) {
    case 'shortText':
      parts.push('TEXT');
      checks.push(`length(${c}) <= ${Number.isInteger(p.size) ? p.size : 255}`);
      break;
    case 'longText':
    case 'hyperlink':
    case 'dateTime':
      parts.push('TEXT');
      break;
    case 'number': {
      const size = p.numberSize ?? 'longInteger';
      const range = Object.hasOwn(INT_RANGE, size) ? INT_RANGE[size] : undefined;
      if (range) {
        parts.push('INTEGER');
        checks.push(`${c} BETWEEN ${range[0]} AND ${range[1]}`);
      } else parts.push(size === 'decimal' ? 'TEXT' : 'REAL');
      break;
    }
    case 'currency':
      parts.push('REAL');
      break;
    case 'yesNo':
      parts.push('INTEGER');
      notNull = true;
      checks.push(`${c} IN (0, 1)`);
      break;
  }
  if (notNull) parts.push('NOT NULL');
  if (p.type === 'yesNo') parts.push('DEFAULT 0');
  if ((p.type === 'shortText' || p.type === 'longText' || p.type === 'hyperlink') && p.allowZeroLength === false) checks.push(`${c} <> ''`);
  for (const k of checks) parts.push(`CHECK (${k})`);
  return parts.join(' ');
}

/** `fks`: the table's FOREIGN KEY clauses (foreignKeyClauses), part of the CREATE TABLE. */
export function createTableStatements(design: TableDesign, fks: string[] = []): string[] {
  const defs = design.fields.map(columnDef);
  const pk = design.fields.filter((x) => x.props.primaryKey && x.props.type !== 'autoNumber');
  if (pk.length > 0) defs.push(`PRIMARY KEY (${pk.map((x) => quoteIdent(x.name)).join(', ')})`);
  defs.push(...fks);
  const out = [`CREATE TABLE ${quoteIdent(design.name)} (${defs.join(', ')})`];
  const singlePk = design.fields.filter((x) => x.props.primaryKey).length === 1;
  for (const fd of design.fields) {
    const { indexed, type, primaryKey } = fd.props;
    if (indexed === 'no' || type === 'autoNumber' || (primaryKey && singlePk)) continue;
    out.push(
      `CREATE ${indexed === 'yesNoDuplicates' ? 'UNIQUE ' : ''}INDEX ${quoteIdent(indexName(design.name, fd.name))} ON ${quoteIdent(design.name)} (${quoteIdent(fd.name)})`,
    );
  }
  return out;
}

// ---------- helpers ----------

function parseObject(s: unknown): Record<string, unknown> {
  try {
    const v: unknown = JSON.parse(String(s));
    return v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

interface Column { cid: number; name: string; type: string; notnull: number; pk: number }
function columns(db: DatabaseSync, table: string): Column[] {
  return db.prepare(`PRAGMA table_info(${quoteIdent(table)})`).all() as unknown as Column[];
}

function liveTableNames(db: DatabaseSync): string[] {
  const rows = db.prepare(`SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY bc_fold(name), name`).all() as { name: string }[];
  return rows.map((r) => r.name).filter((n) => !isReservedName(n));
}

/**
 * The exact name first, then the same name ignoring case (A2-R14). SQLite keeps tables whose names differ only in
 * non-ASCII case apart ("Été", "été"): another tool can make such twins, and each must be found as itself.
 */
export function pickName(names: readonly string[], name: string): string | undefined {
  return names.find((n) => n === name) ?? names.find((n) => sameName(n, name));
}

const asciiLower = (x: string) => x.replace(/[A-Z]+/g, (c) => c.toLowerCase());
/** SQLite's own comparison of names (ASCII letters only ignore case): for what SQLite resolves, a key's parent table. */
export const sqliteSameName = (a: string, b: string): boolean => asciiLower(a) === asciiLower(b);

function findTable(db: DatabaseSync, name: string): string | undefined {
  return pickName(liveTableNames(db), name);
}

/** The metadata name of live table `table`: its exact name, else a case variant that is not itself a live table (a twin). */
function metaName(metas: readonly string[], live: readonly string[], table: string): string | undefined {
  return metas.includes(table) ? table : metas.find((n) => sameName(n, table) && !live.includes(n));
}

/** `table`'s metadata names, for a live table (exact first, see metaName). */
export const metadataNames = (db: DatabaseSync, table: string) => metaOf(db, liveTableNames(db), table);

/** The names under which bc_tables and bc_fields hold `table`'s metadata (exact first, see metaName). */
function metaOf(db: DatabaseSync, live: readonly string[], table: string): { table?: string; fields?: string } {
  const tables = (db.prepare('SELECT name FROM bc_tables').all() as { name: string }[]).map((x) => x.name);
  const fields = (db.prepare('SELECT DISTINCT table_name FROM bc_fields').all() as { table_name: string }[]).map((x) => x.table_name);
  return { table: metaName(tables, live, table), fields: metaName(fields, live, table) };
}

function inferProps(col: Column, pkCount: number): FieldProps {
  const decl = col.type.toUpperCase();
  let type: FieldType = 'longText';
  let numberSize: NumberSize | undefined;
  if (decl === 'INTEGER' && col.pk > 0 && pkCount === 1) type = 'autoNumber';
  else if (decl.includes('INT')) [type, numberSize] = ['number', 'longInteger'];
  else if (/REAL|FLOA|DOUB/.test(decl)) [type, numberSize] = ['number', 'double'];
  const props: FieldProps = { ...defaultProps(type), required: col.notnull === 1, primaryKey: col.pk > 0, external: true };
  if (numberSize) props.numberSize = numberSize;
  return props;
}

const STRING_KEYS = ['defaultValue', 'validationRule', 'validationText', 'format', 'inputMask'] as const;
const isStrings = (v: unknown): v is string[] => Array.isArray(v) && v.every((x) => typeof x === 'string');

const nonEmpty = (v: unknown): v is string => typeof v === 'string' && v !== '';

function validLookup(v: unknown): boolean {
  if (v === null || typeof v !== 'object') return false;
  const l = v as Record<string, unknown>;
  if (typeof l.limitToList !== 'boolean') return false;
  if (l.kind === 'values') return isStrings(l.values);
  return l.kind === 'table' && nonEmpty(l.table) && nonEmpty(l.boundField) && isStrings(l.displayFields) && l.displayFields.length > 0;
}

const badOptional = (p: Record<string, unknown>, k: string): boolean =>
  p[k] !== undefined && (k === 'lookup' ? !validLookup(p[k]) : typeof p[k] !== 'string');
const OPTIONAL_KEYS = [...STRING_KEYS, 'lookup'];

// Pure validator for props coming IN (createTable, alterTable): an invalid optional key makes the whole props unusable, so the write throws.
export function usableProps(p: Record<string, unknown>): p is FieldProps {
  return (
    !OPTIONAL_KEYS.some((k) => badOptional(p, k)) &&
    FIELD_TYPES.includes(p.type as string) &&
    INDEXED.includes(p.indexed as string) &&
    (p.numberSize === undefined || NUMBER_SIZES.includes(p.numberSize as string)) &&
    typeof p.required === 'boolean' &&
    typeof p.primaryKey === 'boolean'
  );
}

// Stored metadata is untrusted: returns a copy without the invalid optional keys (the rest is kept).
export function sanitizeStoredProps(p: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(p).filter(([k]) => !OPTIONAL_KEYS.includes(k) || !badOptional(p, k)));
}

// Every key written from FieldProps must be listed: an unlisted key is treated as "unknown" and resurrected from the stored value once cleared.
const KNOWN_KEYS = [
  'type', 'size', 'numberSize', 'precision', 'scale', 'decimalPlaces', 'caption', 'description', 'required', 'allowZeroLength', 'indexed', 'primaryKey', 'external',
  'defaultValue', 'validationRule', 'validationText', 'format', 'inputMask', 'lookup',
];

function putField(db: DatabaseSync, table: string, name: string, position: number, props: Record<string, unknown>): void {
  const old = db.prepare('SELECT props FROM bc_fields WHERE table_name = ? AND field_name = ?').get(table, name) as { props: string } | undefined;
  // Only unknown stored keys survive; known keys come from the incoming props.
  const kept = Object.fromEntries(Object.entries(old ? parseObject(old.props) : {}).filter(([k]) => !KNOWN_KEYS.includes(k)));
  const merged = { ...kept, ...props };
  db.prepare(
    `INSERT INTO bc_fields (table_name, field_name, position, props) VALUES (?, ?, ?, ?)
     ON CONFLICT (table_name, field_name) DO UPDATE SET table_name = excluded.table_name, field_name = excluded.field_name,
       position = excluded.position, props = excluded.props`,
  ).run(table, name, position, JSON.stringify(merged));
}

export function writeTableMetadata(db: DatabaseSync, design: TableDesign): void {
  inTransaction(db, () => {
    const old = db.prepare('SELECT props FROM bc_tables WHERE name = ?').get(design.name) as { props: string } | undefined;
    const incoming: Record<string, unknown> = { ...design.extra };
    if (design.description !== undefined) incoming.description = design.description;
    const { description: _gone, ...kept } = old ? parseObject(old.props) : {};
    const props = { ...kept, ...incoming };
    db.prepare(
      `INSERT INTO bc_tables (name, props) VALUES (?, ?) ON CONFLICT (name) DO UPDATE SET name = excluded.name, props = excluded.props`,
    ).run(design.name, JSON.stringify(props));
    design.fields.forEach((fd, i) => putField(db, design.name, fd.name, i, fd.props));
    const rows = db.prepare('SELECT field_name FROM bc_fields WHERE table_name = ?').all(design.name) as { field_name: string }[];
    const del = db.prepare('DELETE FROM bc_fields WHERE table_name = ? AND field_name = ?');
    for (const r of rows) if (!design.fields.some((x) => x.name === r.field_name)) del.run(design.name, r.field_name);
  });
}

// ---------- relations (bc_relations: name, props JSON) ----------
// Read here, beside the other system tables; saved and checked by relations.ts.

const isStr = (v: unknown): v is string => typeof v === 'string';
const isFields = (v: unknown): v is string[] => isStrings(v) && v.length >= 1 && v.length <= 10;

/** Stored relations, by name; a malformed row (written by another tool or a future version) is skipped. */
export function listRelations(db: DatabaseSync): Relation[] {
  const out: Relation[] = [];
  for (const r of db.prepare('SELECT name, props FROM bc_relations ORDER BY bc_fold(name), name').all() as { name: string; props: string }[]) {
    const p = parseObject(r.props);
    if (!isStr(p.parentTable) || !isStr(p.childTable) || !isFields(p.parentFields) || !isFields(p.childFields)
      || p.parentFields.length !== p.childFields.length || typeof p.enforce !== 'boolean') continue;
    const joinType = p.joinType === 2 || p.joinType === 3 ? p.joinType : 1;
    out.push({
      name: r.name, parentTable: p.parentTable, parentFields: p.parentFields, childTable: p.childTable, childFields: p.childFields,
      enforce: p.enforce, cascadeUpdate: p.cascadeUpdate === true, cascadeDelete: p.cascadeDelete === true, joinType,
    });
  }
  return out;
}

/** Relations where `table` is the parent or the child (table names resolved exactly first). */
export function relationsOf(db: DatabaseSync, table: string): Relation[] {
  const live = liveTableNames(db);
  const t = pickName(live, table) ?? table;
  return listRelations(db).filter((r) => pickName(live, r.parentTable) === t || pickName(live, r.childTable) === t);
}

/** FOREIGN KEY clauses of `childTable`: one per relation with integrity where it is the child. */
export function foreignKeyClauses(db: DatabaseSync, childTable: string): string[] {
  const live = liveTableNames(db);
  const t = pickName(live, childTable) ?? childTable;
  const cols = (xs: string[]) => xs.map(quoteIdent).join(', ');
  return listRelations(db).filter((r) => r.enforce && (pickName(live, r.childTable) ?? r.childTable) === t).map((r) =>
    `FOREIGN KEY (${cols(r.childFields)}) REFERENCES ${quoteIdent(r.parentTable)} (${cols(r.parentFields)})`
    + (r.cascadeUpdate ? ' ON UPDATE CASCADE' : '') + (r.cascadeDelete ? ' ON DELETE CASCADE' : ''));
}

/** Rewrites the table names stored in bc_relations (unknown keys kept); `live`: the names before the rename. */
function renameInRelations(db: DatabaseSync, live: string[], from: string, to: string): void {
  const upd = db.prepare('UPDATE bc_relations SET props = ? WHERE name = ?');
  for (const r of db.prepare('SELECT name, props FROM bc_relations').all() as { name: string; props: string }[]) {
    const p = parseObject(r.props);
    let changed = false;
    for (const k of ['parentTable', 'childTable']) if (isStr(p[k]) && pickName(live, p[k]) === from) [p[k], changed] = [to, true];
    if (changed) upd.run(JSON.stringify(p), r.name);
  }
}

/** A real FOREIGN KEY: `to` null when it names no parent columns (the parent's primary key then). Actions as SQLite gives them. */
export interface ForeignKey { child: string; parent: string; from: string[]; to: string[] | null; onUpdate: string; onDelete: string }

/** Every real FOREIGN KEY of the base, BaseCraft's relations and other tools' alike (A2-R14: they decide). */
export function foreignKeys(db: DatabaseSync): ForeignKey[] {
  const rows = db.prepare(`SELECT m.name AS child, f.id, f."table" AS parent, f."from" AS col, f."to" AS ref, f.on_update AS onUpdate, f.on_delete AS onDelete
    FROM sqlite_master AS m, pragma_foreign_key_list(m.name) AS f WHERE m.type = 'table' ORDER BY m.name, f.id, f.seq`)
    .all() as { child: string; id: number; parent: string; col: string; ref: string | null; onUpdate: string; onDelete: string }[];
  const out: ForeignKey[] = [];
  rows.forEach((r, i) => {
    const prev = rows[i - 1];
    if (!prev || prev.child !== r.child || prev.id !== r.id) {
      out.push({ child: r.child, parent: r.parent, from: [], to: [], onUpdate: r.onUpdate, onDelete: r.onDelete });
    }
    const k = out[out.length - 1]!;
    k.from.push(r.col);
    if (r.ref === null) k.to = null;
    else k.to?.push(r.ref);
  });
  return out;
}

/** The live table a key's parent name designates, as SQLite resolves it. */
export function parentOf(live: readonly string[], k: ForeignKey): string | undefined {
  return live.find((n) => n === k.parent) ?? live.find((n) => sqliteSameName(n, k.parent));
}

/** The parent columns of a key: its own, else the primary key of `parent`. */
export function refColumns(db: DatabaseSync, k: ForeignKey, parent: string): string[] {
  return k.to ?? columns(db, parent).filter((c) => c.pk > 0).sort((a, b) => a.pk - b.pk).map((c) => c.name);
}

/** Tables with a key on `table` whose ON DELETE is CASCADE: what a delete of its rows also deletes (the datasheet warns). */
export function cascadeChildren(db: DatabaseSync, table: string): string[] {
  const live = liveTableNames(db);
  const t = pickName(live, table);
  return [...new Set(foreignKeys(db).filter((k) => t !== undefined && parentOf(live, k) === t && k.onDelete === 'CASCADE').map((k) => k.child))];
}

/** Keys whose parent was dropped by another tool, by the name they reference. */
function danglingKeys(db: DatabaseSync, live: readonly string[]): ForeignKey[] {
  return foreignKeys(db).filter((k) => parentOf(live, k) === undefined);
}

/**
 * bc_relations follows the real keys (A2-R13, A2-R14). An enforced relation follows its key: a table or column another tool
 * renamed (SQLite moved the key), and the ON DELETE / ON UPDATE actions. Without its key it is kept without integrity while
 * its tables and fields remain, and dropped when they are gone. Each change is reported.
 */
function reconcileRelations(db: DatabaseSync, live: string[], report: ReconcileReport): void {
  const keys = foreignKeys(db);
  const colsOf = (t: string) => columns(db, t).map((c) => c.name);
  const fieldsIn = (t: string | undefined, fields: string[]) => {
    if (t === undefined) return undefined;
    const cols = colsOf(t);
    const out = fields.map((x) => pickName(cols, x));
    return out.every((x) => x !== undefined) ? (out as string[]) : undefined;
  };
  const sameFields = (a: string[], b: string[]) => a.length === b.length && a.every((x, i) => sameName(x, b[i]!));
  for (const r of listRelations(db)) {
    const childT = pickName(live, r.childTable);
    const parentT = pickName(live, r.parentTable);
    let next: Relation | undefined;
    if (r.enforce) {
      // Its key: on the child, by its columns; else by its parent and parent columns (a child or child column renamed).
      const byChild = keys.find((k) => k.child === childT && sameFields(k.from, r.childFields));
      const byParent = keys.find((k) => parentT !== undefined && parentOf(live, k) === parentT && (childT === undefined || k.child === childT)
        && k.from.length === r.childFields.length && sameFields(refColumns(db, k, parentT), r.parentFields));
      const k = byChild ?? byParent;
      const parent = k && parentOf(live, k);
      if (k && parent) {
        const parentFields = fieldsIn(parent, refColumns(db, k, parent));
        const childFields = fieldsIn(k.child, k.from);
        if (parentFields && childFields) {
          next = { ...r, parentTable: parent, childTable: k.child, parentFields, childFields, cascadeUpdate: k.onUpdate === 'CASCADE', cascadeDelete: k.onDelete === 'CASCADE' };
        }
      }
    }
    if (!next) {
      const parentFields = fieldsIn(parentT, r.parentFields);
      const childFields = fieldsIn(childT, r.childFields);
      if (!parentFields || !childFields) {
        db.prepare('DELETE FROM bc_relations WHERE name = ?').run(r.name);
        report.removedRelations.push(r.name);
        continue;
      }
      next = { ...r, parentTable: parentT!, childTable: childT!, parentFields, childFields, enforce: false };
      if (r.enforce) report.downgradedRelations.push(r.name);
    }
    if (JSON.stringify(next) === JSON.stringify(r)) continue;
    if (next.enforce) report.updatedRelations.push(r.name);
    const row = db.prepare('SELECT props FROM bc_relations WHERE name = ?').get(r.name) as { props: string };
    const { name: _name, ...props } = next;
    db.prepare('UPDATE bc_relations SET props = ? WHERE name = ?').run(JSON.stringify({ ...parseObject(row.props), ...props }), r.name);
  }
}

/**
 * Tokens of an SQL text, comparable whatever the spacing, comments, identifier quoting ("x", [x], `x`, bare) and ASCII case
 * (SQLite's own rule for names and keywords). String literals are kept as written.
 */
export function sqlTokens(sql: string): string[] {
  const re = /\s+|--[^\n]*|\/\*[\s\S]*?(?:\*\/|$)|('(?:[^']|'')*')|"((?:[^"]|"")*)"|\[([^\]]*)\]|`((?:[^`]|``)*)`|([\w$\u0080-\uffff]+)|([\s\S])/g;
  const out: string[] = [];
  for (const m of sql.matchAll(re)) {
    if (m[1] !== undefined) out.push(m[1]);
    else if (m[2] !== undefined) out.push(`n:${asciiLower(m[2].replace(/""/g, '"'))}`);
    else if (m[3] !== undefined) out.push(`n:${asciiLower(m[3])}`);
    else if (m[4] !== undefined) out.push(`n:${asciiLower(m[4].replace(/``/g, '`'))}`);
    else if (m[5] !== undefined) out.push(`n:${asciiLower(m[5])}`);
    else if (m[6] !== undefined) out.push(m[6]);
  }
  return out;
}
const sameSql = (a: string, b: string): boolean => sqlTokens(a).join(' ') === sqlTokens(b).join(' ');

/**
 * A table BaseCraft does not manage (A2-R13: worked out from the schema, never stored), so never rebuilds: a rebuild would
 * lose what it does not know. Managed = no field adopted from outside (A1), no trigger, and the CREATE TABLE and the CREATE
 * INDEX statements are exactly what BaseCraft generates for the design and its relations with integrity. Views are not the
 * table's own objects: they are not looked at.
 */
export function isExternal(db: DatabaseSync, design: TableDesign): boolean {
  if (design.fields.some((x) => x.props.external === true)) return true;
  const objects = db.prepare(`SELECT type, sql FROM sqlite_master WHERE tbl_name = ? COLLATE NOCASE AND type IN ('table', 'index', 'trigger')`)
    .all(design.name) as { type: string; sql: string | null }[];
  const table = objects.find((x) => x.type === 'table');
  if (!table?.sql || objects.some((x) => x.type === 'trigger')) return true;
  const [create, ...indexes] = createTableStatements(design, foreignKeyClauses(db, design.name));
  // Indexes without sql are the ones a PRIMARY KEY or UNIQUE of the CREATE TABLE makes: compared with it.
  const live = objects.filter((x) => x.type === 'index' && x.sql !== null).map((x) => sqlTokens(x.sql!).join(' ')).sort();
  const expected = indexes.map((x) => sqlTokens(x).join(' ')).sort();
  return !sameSql(table.sql, create!) || live.join('\n') !== expected.join('\n');
}

// ---------- operations ----------

// Stale metadata of an externally dropped table must not leak into a table taking its name. A case variant that is a live
// table itself (a twin made by another tool) keeps its own.
export function purgeMetadata(db: DatabaseSync, name: string): void {
  const live = liveTableNames(db);
  for (const r of db.prepare('SELECT name FROM bc_tables').all() as { name: string }[]) {
    if (r.name !== name && (!sameName(r.name, name) || live.includes(r.name))) continue;
    db.prepare('DELETE FROM bc_fields WHERE table_name = ?').run(r.name);
    db.prepare('DELETE FROM bc_tables WHERE name = ?').run(r.name);
  }
}

export function createTable(db: DatabaseSync, design: TableDesign): void {
  const errors = validateDesign(design);
  if (errors.length > 0) throw new DesignValidationError(errors);
  inTransaction(db, () => {
    if (findTable(db, design.name)) throw new NameExistsError(design.name);
    refuseDangling(db, design.name);
    for (const fd of design.fields) if (!usableProps(fd.props)) throw new Error(`invalid field properties: ${fd.name}`);
    purgeMetadata(db, design.name);
    for (const s of createTableStatements(design)) db.exec(s);
    writeTableMetadata(db, design);
  });
}

/** A key another tool left on a dropped table of that name would make a new table under it its parent. */
function refuseDangling(db: DatabaseSync, name: string): void {
  const k = danglingKeys(db, liveTableNames(db)).find((x) => sqliteSameName(x.parent, name));
  if (k) throw new DanglingKeyError(k.child);
}

/** ALTER TABLE … RENAME (SQLite rewrites every reference); a broken view or trigger of the base makes it a ViewBrokenError. */
function alterRename(db: DatabaseSync, from: string, to: string): void {
  try {
    db.exec(`ALTER TABLE ${quoteIdent(from)} RENAME TO ${quoteIdent(to)}`);
  } catch (e) {
    const view = brokenObject(e);
    if (view !== undefined) throw new ViewBrokenError(view);
    throw e;
  }
}

/**
 * Renames a table; SQLite rewrites the references to it (legacy_alter_table OFF) and bc_relations follows. A managed table's
 * bcx_ indexes take the new name; an external table's indexes are left as they are (SQLite already rewrote their ON).
 */
export function renameTable(db: DatabaseSync, oldName: string, newName: string): void {
  const errors = validateDesign({ name: newName, fields: [{ name: 'x', props: defaultProps('longText') }] });
  if (errors.length > 0) throw new DesignValidationError(errors);
  inTransaction(db, () => {
    const cur = findTable(db, oldName);
    if (!cur) throw new Error(`unknown table: ${oldName}`);
    if (cur === newName) return;
    const clash = findTable(db, newName);
    if (clash && clash !== cur) throw new NameExistsError(newName);
    if (!sqliteSameName(cur, newName)) refuseDangling(db, newName);
    const live = liveTableNames(db);
    const prefix = `bcx_${cur}.`;
    const external = isExternal(db, tableDesign(db, cur));
    const idx = (db.prepare(`PRAGMA index_list(${quoteIdent(cur)})`).all() as { name: string; unique: number }[])
      .filter((i) => !external && i.name.startsWith(prefix))
      .map((i) => ({
        name: i.name,
        unique: i.unique,
        field: (db.prepare(`PRAGMA index_info(${quoteIdent(i.name)})`).get() as { name: string }).name,
      }));
    // SQLite compares ASCII names case-insensitively: a case-only rename goes through a temporary name.
    if (sameName(cur, newName)) {
      const tmp = `bcx_tmp_${Math.random().toString(36).slice(2)}`;
      alterRename(db, cur, tmp);
      alterRename(db, tmp, newName);
    } else alterRename(db, cur, newName);
    for (const i of idx) {
      db.exec(`DROP INDEX ${quoteIdent(i.name)}`);
      db.exec(
        `CREATE ${i.unique ? 'UNIQUE ' : ''}INDEX ${quoteIdent(indexName(newName, i.field))} ON ${quoteIdent(newName)} (${quoteIdent(i.field)})`,
      );
    }
    const meta = metaOf(db, live, cur);
    if (!sameName(cur, newName)) purgeMetadata(db, newName);
    if (meta.table !== undefined) db.prepare('UPDATE bc_tables SET name = ? WHERE name = ?').run(newName, meta.table);
    if (meta.fields !== undefined) db.prepare('UPDATE bc_fields SET table_name = ? WHERE table_name = ?').run(newName, meta.fields);
    renameInRelations(db, live, cur, newName); // the REFERENCES clauses were rewritten by SQLite (legacy_alter_table OFF)
  });
}

/**
 * A table in a relation is refused (hasRelations): as in Access, its relations are deleted first. A table that another
 * table's real FOREIGN KEY references (another tool's) is refused too (referenced, naming that table): DROP TABLE would
 * otherwise run its ON DELETE CASCADE or SET NULL on that table's rows. A key of the table on itself does not count.
 */
export function dropTable(db: DatabaseSync, name: string): OpResult {
  return inTransaction(db, (): OpResult => {
    const live = liveTableNames(db);
    const cur = pickName(live, name);
    if (!cur) throw new Error(`unknown table: ${name}`);
    if (relationsOf(db, cur).length > 0) return { ok: false, reason: 'hasRelations' };
    const k = foreignKeys(db).find((x) => x.child !== cur && parentOf(live, x) === cur);
    if (k) return { ok: false, reason: 'referenced', table: k.child };
    const meta = metaOf(db, live, cur);
    db.exec(`DROP TABLE ${quoteIdent(cur)}`);
    if (meta.fields !== undefined) db.prepare('DELETE FROM bc_fields WHERE table_name = ?').run(meta.fields);
    if (meta.table !== undefined) db.prepare('DELETE FROM bc_tables WHERE name = ?').run(meta.table);
    return { ok: true };
  });
}

export function listTables(db: DatabaseSync): TableSummary[] {
  const meta = db.prepare('SELECT name, props FROM bc_tables').all() as { name: string; props: string }[];
  const live = liveTableNames(db);
  return live.map((name) => {
    const mn = metaName(meta.map((r) => r.name), live, name);
    const m = meta.find((r) => r.name === mn);
    const d = m ? parseObject(m.props).description : undefined;
    return typeof d === 'string' ? { name, description: d } : { name };
  });
}

export function tableDesign(db: DatabaseSync, name: string): TableDesign {
  const live = liveTableNames(db);
  const cur = pickName(live, name);
  if (!cur) throw new Error(`unknown table: ${name}`);
  const cols = columns(db, cur);
  const pkCount = cols.filter((c) => c.pk > 0).length;
  const allRows = db.prepare('SELECT table_name, field_name, position, props FROM bc_fields ORDER BY position').all() as {
    table_name: string; field_name: string; position: number; props: string
  }[];
  const fieldsMeta = metaName([...new Set(allRows.map((r) => r.table_name))], live, cur);
  const metaRows = allRows.filter((r) => fieldsMeta !== undefined && sqliteSameName(r.table_name, fieldsMeta));
  const known: { pos: number; fd: FieldDef }[] = [];
  const unknown: FieldDef[] = [];
  for (const col of cols) {
    const m = metaRows.find((r) => sameName(r.field_name, col.name));
    const stored = m ? sanitizeStoredProps(parseObject(m.props)) : undefined;
    if (m && stored && usableProps(stored)) known.push({ pos: m.position, fd: { name: col.name, props: stored } });
    else unknown.push({ name: col.name, props: inferProps(col, pkCount) });
  }
  known.sort((a, b) => a.pos - b.pos);
  const design: TableDesign = { name: cur, fields: [...known.map((k) => k.fd), ...unknown] };
  const tm = db.prepare('SELECT name, props FROM bc_tables').all() as { name: string; props: string }[];
  const tableMeta = metaName(tm.map((r) => r.name), live, cur);
  const row = tm.find((r) => r.name === tableMeta);
  if (row) {
    const { description, ...extra } = parseObject(row.props);
    if (typeof description === 'string') design.description = description;
    if (Object.keys(extra).length > 0) design.extra = extra;
  }
  return design;
}

export function reconcile(db: DatabaseSync): ReconcileReport {
  return inTransaction(db, () => {
    const report: ReconcileReport = {
      addedTables: [], removedTables: [], addedFields: [], removedFields: [], removedRelations: [], downgradedRelations: [], updatedRelations: [],
    };
    const live = liveTableNames(db);
    const metaTables = (db.prepare('SELECT name FROM bc_tables').all() as { name: string }[]).map((r) => r.name);
    // Each live table's metadata, exact name first: a twin another tool made never takes the managed table's (A2-R14).
    const owner = new Map(live.map((t) => [t, metaName(metaTables, live, t)]));
    const owned = new Set(owner.values());
    for (const m of metaTables) {
      if (owned.has(m)) continue;
      report.removedTables.push(m);
      db.prepare('DELETE FROM bc_fields WHERE table_name = ?').run(m);
      db.prepare('DELETE FROM bc_tables WHERE name = ?').run(m);
    }
    const allFields = db.prepare('SELECT table_name, field_name FROM bc_fields').all() as { table_name: string; field_name: string }[];
    for (const table of live) {
      const m = owner.get(table);
      if (!m) {
        report.addedTables.push(table);
        writeTableMetadata(db, tableDesign(db, table));
        continue;
      }
      const cols = columns(db, table);
      const pkCount = cols.filter((c) => c.pk > 0).length;
      const rows = allFields.filter((r) => sqliteSameName(r.table_name, m));
      for (const col of cols) {
        if (rows.some((r) => sameName(r.field_name, col.name))) continue;
        report.addedFields.push({ table, field: col.name });
        putField(db, m, col.name, col.cid, inferProps(col, pkCount));
      }
      for (const r of rows) {
        if (cols.some((c) => sameName(c.name, r.field_name))) continue;
        report.removedFields.push({ table, field: r.field_name });
        db.prepare('DELETE FROM bc_fields WHERE table_name = ? AND field_name = ?').run(r.table_name, r.field_name);
      }
    }
    reconcileRelations(db, live, report);
    return report;
  });
}
