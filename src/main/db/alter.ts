import crypto from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { coerce, numberToText, toDecimal, type CellInput, type SqlValue } from '../../shared/coerce';
import { sameName, validateDesign, type FieldDef, type TableDesign } from '../../shared/field-types';
import { parseDecimal, type LocaleInfo } from '../../shared/locale-format';
import {
  createTableStatements, foreignKeyClauses, foreignKeyRefs, listTables, NameExistsError, purgeMetadata, quoteIdent, relationsOf, renameTable,
  tableDesign, usableProps, writeTableMetadata,
} from './schema';
import type { AlterResult, FieldMapping, Relation } from '../../shared/api';
import { countViolations } from './rules';
export type { AlterResult, FieldMapping };

interface AlterOptions { allowDataLoss: boolean; info: LocaleInfo; acceptExistingViolations?: boolean }

/**
 * Tokens of an SQL text, comparable whatever the spacing, comments, identifier quoting ("x", [x], `x`, bare) and ASCII case
 * (SQLite's own rule for names and keywords). String literals are kept as written.
 */
export function sqlTokens(sql: string): string[] {
  const re = /\s+|--[^\n]*|\/\*[\s\S]*?(?:\*\/|$)|('(?:[^']|'')*')|"((?:[^"]|"")*)"|\[([^\]]*)\]|`((?:[^`]|``)*)`|([\w$\u0080-\uffff]+)|([\s\S])/g;
  const out: string[] = [];
  const lower = (x: string) => x.replace(/[A-Z]+/g, (c) => c.toLowerCase());
  for (const m of sql.matchAll(re)) {
    if (m[1] !== undefined) out.push(m[1]);
    else if (m[2] !== undefined) out.push(`n:${lower(m[2].replace(/""/g, '"'))}`);
    else if (m[3] !== undefined) out.push(`n:${lower(m[3])}`);
    else if (m[4] !== undefined) out.push(`n:${lower(m[4].replace(/``/g, '`'))}`);
    else if (m[5] !== undefined) out.push(`n:${lower(m[5])}`);
    else if (m[6] !== undefined) out.push(m[6]);
  }
  return out;
}
const sameSql = (a: string, b: string): boolean => sqlTokens(a).join(' ') === sqlTokens(b).join(' ');

/**
 * A table BaseCraft does not manage (A2-R13: worked out from the schema, never stored), so never rebuilds: a rebuild would
 * lose what it does not know. Managed = no field adopted from outside (A1), no trigger, and the CREATE TABLE and the CREATE
 * INDEX statements are exactly what BaseCraft generates for the design and its relations with integrity.
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

/** The fields form the primary key, or are one field with a "no duplicates" index: what a foreign key needs in its parent. */
export function uniqueKey(design: TableDesign, fields: string[]): boolean {
  const pk = design.fields.filter((x) => x.props.primaryKey).map((x) => x.name);
  if (pk.length > 0 && pk.length === fields.length && pk.every((x) => fields.includes(x))) return true;
  return fields.length === 1 && design.fields.some((x) => x.name === fields[0] && x.props.indexed === 'yesNoDuplicates');
}

/**
 * A field of a relation that this alteration renames, deletes, retypes or resizes; or a parent key that loses its uniqueness
 * while a relation with integrity needs it. Access refuses these: the relation is deleted first.
 */
function relationField(old: TableDesign, design: TableDesign, sources: (string | null)[], relations: Relation[]): AlterResult {
  for (const r of relations) {
    const sides: { fields: string[]; parent: boolean }[] = [];
    if (sameName(r.parentTable, old.name)) sides.push({ fields: r.parentFields, parent: true });
    if (sameName(r.childTable, old.name)) sides.push({ fields: r.childFields, parent: false });
    for (const side of sides) {
      for (const name of side.fields) {
        const before = old.fields.find((x) => x.name === name);
        const i = sources.indexOf(name);
        const after = i < 0 ? undefined : design.fields[i]!;
        if (!before || !after || after.name !== name || after.props.type !== before.props.type
          || after.props.numberSize !== before.props.numberSize || after.props.size !== before.props.size) {
          return { ok: false, reason: 'relationField', field: name, relation: r.name };
        }
      }
      if (side.parent && r.enforce && !uniqueKey(design, side.fields)) return { ok: false, reason: 'relationField', field: side.fields[0]!, relation: r.name };
    }
  }
  return { ok: true };
}

/** PRAGMA foreign_key_check of these tables only: an unrelated violation elsewhere is not this operation's business. */
export function checkForeignKeys(db: DatabaseSync, tables: string[]): void {
  for (const t of tables) if (db.prepare(`PRAGMA foreign_key_check(${quoteIdent(t)})`).all().length > 0) throw new Error(`foreign key violation: ${t}`);
}

/** The table and every table whose FOREIGN KEY references it (relations, or another tool's): what a rebuild of it can break. */
export function keyedTables(db: DatabaseSync, table: string): string[] {
  return [table, ...new Set(foreignKeyRefs(db).filter((r) => sameName(r.parent, table) && r.child !== table).map((r) => r.child))];
}

/**
 * Runs `fn` in one transaction with foreign keys OFF, then checks the keys of `checked()`. OFF is set outside the transaction
 * (it has no effect inside one): dropping a rebuilt parent must neither cascade into its children nor fail on them.
 */
export function withForeignKeysOff<T extends { ok: boolean }>(db: DatabaseSync, fn: () => T, checked: () => string[]): T {
  if (db.isTransaction) throw new Error('a rebuild cannot run inside a transaction');
  const fk = (db.prepare('PRAGMA foreign_keys').get() as { foreign_keys: number }).foreign_keys;
  db.exec('PRAGMA foreign_keys=OFF');
  try {
    db.exec('BEGIN');
    const r = fn();
    if (r.ok) {
      checkForeignKeys(db, checked());
      db.exec('COMMIT');
    } else db.exec('ROLLBACK');
    return r;
  } catch (e) {
    if (db.isTransaction) db.exec('ROLLBACK');
    throw e;
  } finally {
    db.exec(`PRAGMA foreign_keys=${fk ? 'ON' : 'OFF'}`);
  }
}

/**
 * Rebuilds a managed table as it is, e.g. to apply a change of its FOREIGN KEY clauses. Values are copied as they are (same
 * columns: nothing to convert); rows that do not fit the table's own design (written by another tool) refuse it: external.
 */
export function rebuildSame(db: DatabaseSync, name: string, info: LocaleInfo): AlterResult {
  const d = tableDesign(db, name);
  try {
    return rebuild(db, d, d, d.fields.map((x) => x.name), { allowDataLoss: false, info }, true);
  } catch (e) {
    if (refusedBySqlite(e)) return { ok: false, reason: 'external' }; // the caller rolls back
    throw e;
  }
}

/** SQLite refused the rebuild because of something outside the design: rows breaking its constraints (copy, unique index),
 *  or a view or trigger of another tool that no longer parses during the rename. */
const refusedBySqlite = (e: unknown): boolean => e instanceof Error && /constraint failed|^error in (view|trigger) /.test(e.message);

/**
 * Rebuilds `oldName` with `design` (which may rename the table) in one transaction.
 * Returns a result for user-fixable failures; throws for programming errors (bad mapping, unknown table,
 * unusable props, open transaction) and NameExistsError when `design.name` is taken by another table.
 */
export async function alterTable(db: DatabaseSync, oldName: string, design: TableDesign, mapping: FieldMapping[], opts: AlterOptions): Promise<AlterResult> {
  const errors = validateDesign(design);
  if (errors.length > 0) return { ok: false, reason: 'design', errors };
  for (const fd of design.fields) if (!usableProps(fd.props)) throw new Error(`invalid field properties: ${fd.name}`);
  const old = tableDesign(db, oldName);
  if (mapping.length !== design.fields.length) throw new Error('mapping: one entry per design field expected');
  const sources = design.fields.map((fd) => {
    const m = mapping.filter((x) => x.name === fd.name);
    if (m.length !== 1) throw new Error(`mapping: ${fd.name} must appear exactly once`);
    const src = m[0]!.sourceName;
    if (src !== null && !old.fields.some((x) => x.name === src)) throw new Error(`mapping: unknown source field ${src}`);
    return src;
  });
  const used = sources.filter((s) => s !== null);
  if (new Set(used).size !== used.length) throw new Error('mapping: a source field is used twice');
  // A1 only rebuilds tables it fully manages: the rebuild would drop or change what it does not know (R17).
  if (isExternal(db, old)) return { ok: false, reason: 'external' };
  if (listTables(db).some((x) => x.name !== old.name && sameName(x.name, design.name))) throw new NameExistsError(design.name);
  if (db.isTransaction) throw new Error('alterTable cannot run inside a transaction');
  const relations = relationsOf(db, old.name);
  const guarded = relationField(old, design, sources, relations);
  if (!guarded.ok) return guarded;

  const fk = (db.prepare('PRAGMA foreign_keys').get() as { foreign_keys: number }).foreign_keys;
  db.exec('PRAGMA foreign_keys=OFF'); // no effect inside a transaction: must come first (a dropped parent must not cascade)
  try {
    db.exec('BEGIN');
    let from = old;
    // A renamed table is renamed first: SQLite rewrites every REFERENCES to it (relations and other tools' keys alike), and
    // bc_relations follows. A rename by the rebuild (DROP, then RENAME of the copy) would leave them on the old name.
    if (old.name !== design.name) {
      renameTable(db, old.name, design.name);
      from = { ...old, name: design.name };
    }
    let r = rebuild(db, from, design, sources, opts);
    // ponytail: awaited inside the open transaction; the evaluator only awaits settled promises (microtasks), so no other
    // IPC call can run on this connection meanwhile. A truly asynchronous function in a rule would need a lock here.
    if (r.ok && !opts.acceptExistingViolations) r = await existingViolations(db, old, design, sources, opts.info);
    if (r.ok) {
      checkForeignKeys(db, keyedTables(db, design.name));
      db.exec('COMMIT');
    } else db.exec('ROLLBACK');
    return r;
  } catch (e) {
    if (db.isTransaction) db.exec('ROLLBACK');
    const field = duplicateField(e, design.fields);
    if (field !== undefined) return { ok: false, reason: 'duplicate', field };
    if (e instanceof Error && /^error in (view|trigger) /.test(e.message)) return { ok: false, reason: 'external' };
    throw e;
  } finally {
    db.exec(`PRAGMA foreign_keys=${fk ? 'ON' : 'OFF'}`);
  }
}

// ponytail: copie ligne à ligne en JS (environ 200 000 lignes/s) ; un INSERT … SELECT direct serait plus rapide
// quand aucun type ne change, à faire si une mesure le demande.
function rebuild(db: DatabaseSync, old: TableDesign, design: TableDesign, sources: (string | null)[], opts: AlterOptions, verbatim = false): AlterResult {
  const tmp = `bcx_tmp_${crypto.randomUUID().replace(/-/g, '')}`;
  db.exec(createTableStatements({ ...design, name: tmp }, foreignKeyClauses(db, design.name))[0]!);
  const r = verbatim ? copyVerbatim(db, old, tmp) : copyConverted(db, old, design, sources, opts, tmp);
  return r.ok ? replaceTable(db, old, design, sources, tmp) : r;
}

/** Same design: INSERT … SELECT, rowids kept (a constraint the old rows break: see rebuildSame). */
function copyVerbatim(db: DatabaseSync, d: TableDesign, tmp: string): AlterResult {
  const auto = d.fields.findIndex((x) => x.props.type === 'autoNumber');
  const cols = [auto >= 0 ? quoteIdent(d.fields[auto]!.name) : 'rowid', ...d.fields.filter((_, i) => i !== auto).map((x) => quoteIdent(x.name))].join(', ');
  db.exec(`INSERT INTO ${quoteIdent(tmp)} (${cols}) SELECT ${cols} FROM ${quoteIdent(d.name)} ORDER BY rowid`);
  return { ok: true };
}

function copyConverted(db: DatabaseSync, old: TableDesign, design: TableDesign, sources: (string | null)[], opts: AlterOptions, tmp: string): AlterResult {
  const canon: LocaleInfo = { ...opts.info, decimalSep: '.', groupSep: '' };
  const decimals = sources.map((s) => {
    const p = old.fields.find((x) => x.name === s)?.props;
    return p?.type === 'number' && p.numberSize === 'decimal';
  });
  // The autoNumber column is the rowid alias; without one, the rowid is written explicitly. Rowids are kept.
  const auto = design.fields.findIndex((x) => x.props.type === 'autoNumber');
  const cols = [auto >= 0 ? quoteIdent(design.fields[auto]!.name) : 'rowid', ...design.fields.filter((_, i) => i !== auto).map((x) => quoteIdent(x.name))];
  const insert = db.prepare(`INSERT INTO ${quoteIdent(tmp)} (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`);
  const select = db.prepare(
    `SELECT rowid AS r${sources.map((s, i) => (s === null ? '' : `, ${quoteIdent(s)} AS c${i}`)).join('')} FROM ${quoteIdent(old.name)} ORDER BY rowid`,
  );

  let lossyRows = 0;
  const missing = design.fields.map(() => 0); // rows left without a value, per required field
  for (const row of select.iterate() as Iterable<Record<string, unknown>>) {
    let rowid = row.r as SqlValue;
    const values: SqlValue[] = [];
    let lossy = false;
    let skip = false;
    design.fields.forEach((fd, i) => {
      const src = sources[i] === null ? null : row[`c${i}`];
      if (i === auto) {
        // The source value becomes the number; anything but an integer is lost and gets a fresh number.
        if (sources[i] !== null) {
          if (Number.isInteger(src)) rowid = src as number;
          else [rowid, lossy] = [null, true];
        }
        return;
      }
      const c = convert(fd, src, decimals[i]!, opts.info, canon);
      lossy ||= c.lossy;
      if (c.value === null && (fd.props.required || fd.props.primaryKey)) {
        missing[i]!++;
        skip = true;
      }
      values.push(c.value);
    });
    if (lossy) lossyRows++;
    if (!skip) insert.run(rowid, ...values);
  }
  const req = missing.findIndex((n) => n > 0);
  if (req >= 0) return { ok: false, reason: 'required', field: design.fields[req]!.name, rows: missing[req]! };
  if (lossyRows > 0 && !opts.allowDataLoss) return { ok: false, reason: 'lossy', lossyRows };
  return { ok: true };
}

/** The copy `tmp` replaces `old` under the design's name, with its indexes, AutoNumber sequence and metadata. */
function replaceTable(db: DatabaseSync, old: TableDesign, design: TableDesign, sources: (string | null)[], tmp: string): AlterResult {
  const auto = design.fields.findIndex((x) => x.props.type === 'autoNumber');
  // Access never reuses an AutoNumber: carry the old sequence over.
  const seq = auto >= 0 ? ((db.prepare('SELECT seq FROM sqlite_sequence WHERE name = ?').get(old.name) as { seq: number } | undefined)?.seq ?? 0) : 0;
  const metaTable = (db.prepare('SELECT name, props FROM bc_tables').all() as { name: string; props: string }[]).find((x) => sameName(x.name, old.name));
  const metaFields = (db.prepare('SELECT table_name, field_name, props FROM bc_fields').all() as { table_name: string; field_name: string; props: string }[])
    .filter((x) => sameName(x.table_name, old.name));

  db.exec(`DROP TABLE ${quoteIdent(old.name)}`);
  db.exec(`ALTER TABLE ${quoteIdent(tmp)} RENAME TO ${quoteIdent(design.name)}`);
  for (const s of createTableStatements(design).slice(1)) db.exec(s);
  if (auto >= 0 && seq > 0) {
    const upd = db.prepare('UPDATE sqlite_sequence SET seq = max(seq, ?) WHERE name = ?').run(seq, design.name);
    if (Number(upd.changes) === 0) db.prepare('INSERT INTO sqlite_sequence (name, seq) VALUES (?, ?)').run(design.name, seq);
  }

  // Old metadata moves to the new names (unknown keys survive renames), then the usual merge applies.
  purgeMetadata(db, old.name);
  purgeMetadata(db, design.name);
  if (metaTable) db.prepare('INSERT INTO bc_tables (name, props) VALUES (?, ?)').run(design.name, metaTable.props);
  const put = db.prepare('INSERT INTO bc_fields (table_name, field_name, position, props) VALUES (?, ?, ?, ?)');
  design.fields.forEach((fd, i) => {
    const m = sources[i] === null ? undefined : metaFields.find((x) => sameName(x.field_name, sources[i]!));
    if (m) put.run(design.name, fd.name, i, m.props);
  });
  writeTableMetadata(db, design);
  return { ok: true };
}

/** A rule added or changed by this alteration, broken by rows of the rebuilt table: validationExisting. */
async function existingViolations(db: DatabaseSync, old: TableDesign, design: TableDesign, sources: (string | null)[], info: LocaleInfo): Promise<AlterResult> {
  for (const [i, fd] of design.fields.entries()) {
    const before = old.fields.find((x) => x.name === sources[i])?.props.validationRule;
    if (!fd.props.validationRule || fd.props.validationRule === before) continue;
    const rows = await countViolations(db, design, fd.name, info);
    if (rows > 0) return { ok: false, reason: 'validationExisting', field: fd.name, rows };
  }
  return { ok: true };
}

const TEXT_TYPES: readonly string[] = ['shortText', 'longText', 'hyperlink'];

/**
 * Converted value; `lossy` when the source value cannot be kept exactly (the value is then the fallback, or the
 * rounded / locale-read value). `decimal`: the source is a stored decimal, i.e. canonical text ('12.50').
 */
function convert(fd: FieldDef, src: unknown, decimal: boolean, info: LocaleInfo, canon: LocaleInfo): { value: SqlValue; lossy: boolean } {
  const toText = TEXT_TYPES.includes(fd.props.type);
  let input = src as CellInput;
  if (toText && typeof src === 'number') input = numberToText(src, info); // CStr: '12,5' in de-DE and fr-FR
  else if (toText && decimal && typeof src === 'string') input = src.replace('.', info.decimalSep);
  const srcInfo = decimal ? canon : info; // a stored decimal read with the locale ('.' = group in de-DE) would be corrupted
  const r = src instanceof Uint8Array ? undefined : coerce(fd, input, srcInfo); // a BLOB never converts
  if (r?.ok) {
    let lossy = false;
    // Trimmed or emptied text: never happens to text written by BaseCraft.
    if (toText) lossy = typeof input === 'string' && r.value !== input;
    else if ((fd.props.type === 'number' || fd.props.type === 'currency') && r.value !== null) {
      // Rounding loses digits; text read differently by the locale and canonically is ambiguous (de-DE '1.234').
      const loc = typeof input === 'string' && !decimal ? parseDecimal(input, info) : null;
      const can = typeof input === 'string' && !decimal ? parseDecimal(input, canon) : null;
      lossy = toDecimal(input as string | number, srcInfo) !== toDecimal(r.value, canon) || (loc !== null && can !== null && loc !== can);
    }
    return { value: r.value, lossy };
  }
  if (r?.error === 'required') return { value: null, lossy: false };
  const fb = r?.error === 'tooLong'
    ? coerce(fd, [...String(input).trim()].slice(0, fd.props.size ?? 255).join(''), info)
    : coerce(fd, null, info); // empty value of the field: null, or 0 for yesNo
  return { value: fb.ok ? fb.value : null, lossy: true };
}

/** Field named by `UNIQUE constraint failed: <table>.<col>[, …]` (table names never contain '.'). */
function duplicateField(e: unknown, fields: FieldDef[]): string | undefined {
  const m = /UNIQUE constraint failed: [^.]*\.(.*)$/s.exec(e instanceof Error ? e.message : '');
  return m ? fields.find((x) => m[1] === x.name || m[1]!.startsWith(`${x.name}, `))?.name : undefined;
}
