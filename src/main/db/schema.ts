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

function findTable(db: DatabaseSync, name: string): string | undefined {
  return liveTableNames(db).find((n) => sameName(n, name));
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

/** Relations where `table` is the parent or the child. */
export function relationsOf(db: DatabaseSync, table: string): Relation[] {
  return listRelations(db).filter((r) => sameName(r.parentTable, table) || sameName(r.childTable, table));
}

/** FOREIGN KEY clauses of `childTable`: one per relation with integrity where it is the child. */
export function foreignKeyClauses(db: DatabaseSync, childTable: string): string[] {
  const cols = (xs: string[]) => xs.map(quoteIdent).join(', ');
  return listRelations(db).filter((r) => r.enforce && sameName(r.childTable, childTable)).map((r) =>
    `FOREIGN KEY (${cols(r.childFields)}) REFERENCES ${quoteIdent(r.parentTable)} (${cols(r.parentFields)})`
    + (r.cascadeUpdate ? ' ON UPDATE CASCADE' : '') + (r.cascadeDelete ? ' ON DELETE CASCADE' : ''));
}

/** Rewrites the table names stored in bc_relations (unknown keys kept). */
function renameInRelations(db: DatabaseSync, from: string, to: string): void {
  const upd = db.prepare('UPDATE bc_relations SET props = ? WHERE name = ?');
  for (const r of db.prepare('SELECT name, props FROM bc_relations').all() as { name: string; props: string }[]) {
    const p = parseObject(r.props);
    let changed = false;
    for (const k of ['parentTable', 'childTable']) if (isStr(p[k]) && sameName(p[k], from)) [p[k], changed] = [to, true];
    if (changed) upd.run(JSON.stringify(p), r.name);
  }
}

/** Every real FOREIGN KEY of the base (BaseCraft's relations and other tools' alike), as child → parent table names. */
export function foreignKeyRefs(db: DatabaseSync): { child: string; parent: string }[] {
  return db.prepare(`SELECT DISTINCT m.name AS child, f."table" AS parent FROM sqlite_master AS m, pragma_foreign_key_list(m.name) AS f WHERE m.type = 'table'`)
    .all() as { child: string; parent: string }[];
}

/** The FOREIGN KEY of `r` is in its child's schema: same parent table, same columns in order (names compared ignoring case). */
function hasForeignKey(db: DatabaseSync, r: Relation): boolean {
  const rows = db.prepare('SELECT id, "table" AS parent, "from" AS col, "to" AS ref FROM pragma_foreign_key_list(?) ORDER BY id, seq')
    .all(r.childTable) as { id: number; parent: string; col: string; ref: string | null }[];
  return [...new Set(rows.map((x) => x.id))].some((id) => {
    const fk = rows.filter((x) => x.id === id);
    return sameName(fk[0]!.parent, r.parentTable) && fk.length === r.childFields.length
      && fk.every((x, i) => sameName(x.col, r.childFields[i]!) && (x.ref === null || sameName(x.ref, r.parentFields[i]!)));
  });
}

/**
 * bc_relations follows the schema (A2-R13). A relation whose table or field is gone is dropped. An enforced relation whose
 * FOREIGN KEY another tool removed or replaced is kept without integrity. Names take the live spelling. Both are reported.
 */
function reconcileRelations(db: DatabaseSync, live: string[], report: ReconcileReport): void {
  const resolve = (table: string | undefined, fields: string[]) => {
    if (table === undefined) return undefined;
    const cols = columns(db, table).map((c) => c.name);
    const out = fields.map((x) => cols.find((c) => sameName(c, x)));
    return out.every((x) => x !== undefined) ? (out as string[]) : undefined;
  };
  for (const r of listRelations(db)) {
    const parentTable = live.find((n) => sameName(n, r.parentTable));
    const childTable = live.find((n) => sameName(n, r.childTable));
    const parentFields = resolve(parentTable, r.parentFields);
    const childFields = resolve(childTable, r.childFields);
    if (!parentFields || !childFields) {
      db.prepare('DELETE FROM bc_relations WHERE name = ?').run(r.name);
      report.removedRelations.push(r.name);
      continue;
    }
    const next: Relation = { ...r, parentTable: parentTable!, childTable: childTable!, parentFields, childFields };
    if (next.enforce && !hasForeignKey(db, next)) {
      next.enforce = false;
      report.downgradedRelations.push(r.name);
    }
    if (JSON.stringify(next) === JSON.stringify(r)) continue;
    const row = db.prepare('SELECT props FROM bc_relations WHERE name = ?').get(r.name) as { props: string };
    const { name: _name, ...props } = next;
    db.prepare('UPDATE bc_relations SET props = ? WHERE name = ?').run(JSON.stringify({ ...parseObject(row.props), ...props }), r.name);
  }
}

// ---------- operations ----------

// Stale metadata of an externally dropped table must not leak into a table taking its name.
export function purgeMetadata(db: DatabaseSync, name: string): void {
  for (const r of db.prepare('SELECT name FROM bc_tables').all() as { name: string }[]) {
    if (!sameName(r.name, name)) continue;
    db.prepare('DELETE FROM bc_fields WHERE table_name = ?').run(r.name);
    db.prepare('DELETE FROM bc_tables WHERE name = ?').run(r.name);
  }
}

export function createTable(db: DatabaseSync, design: TableDesign): void {
  const errors = validateDesign(design);
  if (errors.length > 0) throw new DesignValidationError(errors);
  inTransaction(db, () => {
    if (findTable(db, design.name)) throw new NameExistsError(design.name);
    for (const fd of design.fields) if (!usableProps(fd.props)) throw new Error(`invalid field properties: ${fd.name}`);
    purgeMetadata(db, design.name);
    for (const s of createTableStatements(design)) db.exec(s);
    writeTableMetadata(db, design);
  });
}

export function renameTable(db: DatabaseSync, oldName: string, newName: string): void {
  const errors = validateDesign({ name: newName, fields: [{ name: 'x', props: defaultProps('longText') }] });
  if (errors.length > 0) throw new DesignValidationError(errors);
  inTransaction(db, () => {
    const cur = findTable(db, oldName);
    if (!cur) throw new Error(`unknown table: ${oldName}`);
    if (cur === newName) return;
    const clash = findTable(db, newName);
    if (clash && clash !== cur) throw new NameExistsError(newName);
    const prefix = `bcx_${cur}.`;
    const idx = (db.prepare(`PRAGMA index_list(${quoteIdent(cur)})`).all() as { name: string; unique: number }[])
      .filter((i) => i.name.startsWith(prefix))
      .map((i) => ({
        name: i.name,
        unique: i.unique,
        field: (db.prepare(`PRAGMA index_info(${quoteIdent(i.name)})`).get() as { name: string }).name,
      }));
    // SQLite compares ASCII names case-insensitively: a case-only rename goes through a temporary name.
    if (sameName(cur, newName)) {
      const tmp = `bcx_tmp_${Math.random().toString(36).slice(2)}`;
      db.exec(`ALTER TABLE ${quoteIdent(cur)} RENAME TO ${quoteIdent(tmp)}`);
      db.exec(`ALTER TABLE ${quoteIdent(tmp)} RENAME TO ${quoteIdent(newName)}`);
    } else db.exec(`ALTER TABLE ${quoteIdent(cur)} RENAME TO ${quoteIdent(newName)}`);
    for (const i of idx) {
      db.exec(`DROP INDEX ${quoteIdent(i.name)}`);
      db.exec(
        `CREATE ${i.unique ? 'UNIQUE ' : ''}INDEX ${quoteIdent(indexName(newName, i.field))} ON ${quoteIdent(newName)} (${quoteIdent(i.field)})`,
      );
    }
    if (!sameName(cur, newName)) purgeMetadata(db, newName);
    db.prepare('UPDATE bc_tables SET name = ? WHERE name = ?').run(newName, cur);
    db.prepare('UPDATE bc_fields SET table_name = ? WHERE table_name = ?').run(newName, cur);
    renameInRelations(db, cur, newName); // the REFERENCES clauses were rewritten by SQLite (legacy_alter_table OFF)
  });
}

/**
 * A table in a relation is refused (hasRelations): as in Access, its relations are deleted first. So is a table that any
 * other table's real FOREIGN KEY references (another tool's, or one whose relation reconcile dropped): DROP TABLE would
 * otherwise run its ON DELETE CASCADE or SET NULL on that other table's rows.
 */
export function dropTable(db: DatabaseSync, name: string): OpResult {
  return inTransaction(db, (): OpResult => {
    const cur = findTable(db, name);
    if (!cur) throw new Error(`unknown table: ${name}`);
    if (relationsOf(db, cur).length > 0 || foreignKeyRefs(db).some((x) => sameName(x.parent, cur) && !sameName(x.child, cur))) {
      return { ok: false, reason: 'hasRelations' };
    }
    db.exec(`DROP TABLE ${quoteIdent(cur)}`);
    db.prepare('DELETE FROM bc_fields WHERE table_name = ?').run(cur);
    db.prepare('DELETE FROM bc_tables WHERE name = ?').run(cur);
    return { ok: true };
  });
}

export function listTables(db: DatabaseSync): TableSummary[] {
  const meta = db.prepare('SELECT name, props FROM bc_tables').all() as { name: string; props: string }[];
  return liveTableNames(db).map((name) => {
    const m = meta.find((r) => sameName(r.name, name));
    const d = m ? parseObject(m.props).description : undefined;
    return typeof d === 'string' ? { name, description: d } : { name };
  });
}

export function tableDesign(db: DatabaseSync, name: string): TableDesign {
  const cur = findTable(db, name);
  if (!cur) throw new Error(`unknown table: ${name}`);
  const cols = columns(db, cur);
  const pkCount = cols.filter((c) => c.pk > 0).length;
  const metaRows = (db.prepare('SELECT table_name, field_name, position, props FROM bc_fields ORDER BY position').all() as {
    table_name: string; field_name: string; position: number; props: string
  }[]).filter((r) => sameName(r.table_name, cur));
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
  const row = tm.find((r) => sameName(r.name, cur));
  if (row) {
    const { description, ...extra } = parseObject(row.props);
    if (typeof description === 'string') design.description = description;
    if (Object.keys(extra).length > 0) design.extra = extra;
  }
  return design;
}

export function reconcile(db: DatabaseSync): ReconcileReport {
  return inTransaction(db, () => {
    const report: ReconcileReport = { addedTables: [], removedTables: [], addedFields: [], removedFields: [], removedRelations: [], downgradedRelations: [] };
    const live = liveTableNames(db);
    const metaTables = (db.prepare('SELECT name FROM bc_tables').all() as { name: string }[]).map((r) => r.name);
    for (const m of metaTables) {
      if (live.some((n) => sameName(n, m))) continue;
      report.removedTables.push(m);
      db.prepare('DELETE FROM bc_fields WHERE table_name = ?').run(m);
      db.prepare('DELETE FROM bc_tables WHERE name = ?').run(m);
    }
    const allFields = db.prepare('SELECT table_name, field_name FROM bc_fields').all() as { table_name: string; field_name: string }[];
    for (const table of live) {
      const m = metaTables.find((n) => sameName(n, table));
      if (!m) {
        report.addedTables.push(table);
        writeTableMetadata(db, tableDesign(db, table));
        continue;
      }
      const cols = columns(db, table);
      const pkCount = cols.filter((c) => c.pk > 0).length;
      const rows = allFields.filter((r) => sameName(r.table_name, table));
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
