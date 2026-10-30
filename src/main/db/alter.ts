import crypto from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { coerce, numberToText, toDecimal, type CellInput, type SqlValue } from '../../shared/coerce';
import { renamedIndexes, renamedRule, sameName, validateDesign, type FieldDef, type TableDesign } from '../../shared/field-types';
import { parseDecimal, type LocaleInfo } from '../../shared/locale-format';
import {
  brokenObject, createTableStatements, DanglingKeyError, foreignKeyClauses, foreignKeys, isExternal, isQueryName, listTables, metadataNames, NameExistsError,
  purgeMetadata, quoteIdent, refColumns, relationsOf, renameTable, sameColumns, sqliteSameName, tableDesign, usableProps, ViewBrokenError, writeTableMetadata,
} from './schema';
import type { AlterResult, FieldMapping, Relation } from '../../shared/api';
import { countViolations } from './rules';
import { isLinkName } from '../links/store';
export type { AlterResult, FieldMapping };
export { isExternal, sqlTokens } from './schema';

interface AlterOptions { allowDataLoss: boolean; info: LocaleInfo; acceptExistingViolations?: boolean }

/** The fields form the primary key, or are one field with a "no duplicates" index: what a foreign key needs in its parent. */
export function uniqueKey(design: TableDesign, fields: string[]): boolean {
  const pk = design.fields.filter((x) => x.props.primaryKey).map((x) => x.name);
  if (pk.length > 0 && pk.length === fields.length && pk.every((x) => fields.includes(x))) return true;
  return fields.length === 1 && design.fields.some((x) => x.name === fields[0] && x.props.indexed === 'yesNoDuplicates');
}

/**
 * A field of a relation, or a column another table's real FOREIGN KEY references (A2-R14), that this alteration renames,
 * deletes, retypes or resizes; or a referenced key that loses its uniqueness. Access refuses these: the relation is deleted
 * first. `relation` is '' for a key that is no relation (another tool's); `table` is the other table.
 */
function relationField(db: DatabaseSync, old: TableDesign, design: TableDesign, sources: (string | null)[], relations: Relation[]): AlterResult {
  const uses: { fields: string[]; unique: boolean; relation: string; table: string }[] = [];
  for (const r of relations) {
    if (sqliteSameName(r.parentTable, old.name)) uses.push({ fields: r.parentFields, unique: r.enforce, relation: r.name, table: r.childTable });
    if (sqliteSameName(r.childTable, old.name)) uses.push({ fields: r.childFields, unique: false, relation: r.name, table: r.parentTable });
  }
  for (const k of foreignKeys(db).filter((x) => x.child !== old.name && sqliteSameName(x.parent, old.name))) {
    const fields = refColumns(db, k, old.name).map((c) => old.fields.find((x) => sameName(x.name, c))?.name ?? c);
    // Its relation only by a full match (A2-R15): another relation on the same child field has another parent.
    const rel = relations.find((r) => r.enforce && r.childTable === k.child && r.parentTable === old.name
      && sameColumns(r.childFields, k.from) && sameColumns(r.parentFields, fields));
    uses.push({ fields, unique: true, relation: rel?.name ?? '', table: k.child });
  }
  for (const u of uses) {
    for (const name of u.fields) {
      const before = old.fields.find((x) => x.name === name);
      const i = sources.indexOf(name);
      const after = i < 0 ? undefined : design.fields[i]!;
      if (!before || !after || after.name !== name || after.props.type !== before.props.type
        || after.props.numberSize !== before.props.numberSize || after.props.size !== before.props.size) {
        return { ok: false, reason: 'relationField', field: name, relation: u.relation, table: u.table };
      }
    }
    if (u.unique && !uniqueKey(design, u.fields)) return { ok: false, reason: 'relationField', field: u.fields[0]!, relation: u.relation, table: u.table };
  }
  return { ok: true };
}

/** Views of the base that no longer parse (SQLite reads a view when a statement uses it). */
function brokenViews(db: DatabaseSync): string[] {
  return (db.prepare(`SELECT name FROM sqlite_master WHERE type = 'view'`).all() as { name: string }[]).map((x) => x.name).filter((v) => {
    try {
      db.prepare(`SELECT 1 FROM ${quoteIdent(v)} LIMIT 0`);
      return false;
    } catch {
      return true;
    }
  });
}

/** PRAGMA foreign_key_check of these tables only: an unrelated violation elsewhere is not this operation's business. */
export function checkForeignKeys(db: DatabaseSync, tables: string[]): void {
  for (const t of tables) if (db.prepare(`PRAGMA foreign_key_check(${quoteIdent(t)})`).all().length > 0) throw new Error(`foreign key violation: ${t}`);
}

/** The table and every table whose FOREIGN KEY references it (relations, or another tool's): what a rebuild of it can break. */
export function keyedTables(db: DatabaseSync, table: string): string[] {
  return [table, ...new Set(foreignKeys(db).filter((k) => sqliteSameName(k.parent, table) && k.child !== table).map((k) => k.child))];
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

/** SQLite refused the rebuild because of rows outside the design: they break its constraints (copy, unique index). */
const refusedBySqlite = (e: unknown): boolean => e instanceof Error && /constraint failed/.test(e.message);

/**
 * Rebuilds `oldName` with `design` (which may rename the table) in one transaction.
 * Returns a result for user-fixable failures; throws for programming errors (bad mapping, unknown table,
 * unusable props, open transaction) and NameExistsError when `design.name` is taken by another table.
 */
export async function alterTable(db: DatabaseSync, oldName: string, design: TableDesign, mapping: FieldMapping[], opts: AlterOptions): Promise<AlterResult> {
  design = { ...design, name: design.name.normalize('NFC') }; // names are stored in NFC
  // The table's rule names fields by their source names: renamed fields are followed here, for every caller of saveTable.
  if (design.validationRule) design.validationRule = renamedRule(design.validationRule, mapping);
  const old = tableDesign(db, oldName);
  // So do the indexes; a deleted field leaves them, as in Access, and an index left without a field goes.
  if (design.indexes) {
    const deleted = (n: string) => old.fields.some((x) => sameName(x.name, n)) && !mapping.some((m) => sameName(m.sourceName ?? m.name, n)); // a new field may take its name
    const kept = design.indexes.map((ix) => ({ ...ix, fields: ix.fields.filter((x) => !deleted(x.name)) })).filter((ix) => ix.fields.length);
    design.indexes = renamedIndexes(kept, mapping);
  }
  const errors = validateDesign(design);
  if (errors.length > 0) return { ok: false, reason: 'design', errors };
  for (const fd of design.fields) if (!usableProps(fd.props)) throw new Error(`invalid field properties: ${fd.name}`);
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
  // Only a new name can clash (a twin another tool made, "été" beside "Été", does not stop altering "Été"). A query clash only
  // matters for a rename: a table that an older version let share a query's name can still be saved.
  if (design.name !== old.name && listTables(db).some((x) => x.name !== old.name && sameName(x.name, design.name))) throw new NameExistsError(design.name);
  if (!sameName(old.name, design.name) && (isQueryName(db, design.name) || isLinkName(db, design.name))) throw new NameExistsError(design.name);
  if (db.isTransaction) throw new Error('alterTable cannot run inside a transaction');
  const relations = relationsOf(db, old.name);
  const guarded = relationField(db, old, design, sources, relations);
  if (!guarded.ok) return guarded;

  const fk = (db.prepare('PRAGMA foreign_keys').get() as { foreign_keys: number }).foreign_keys;
  db.exec('PRAGMA foreign_keys=OFF'); // no effect inside a transaction: must come first (a dropped parent must not cascade)
  try {
    db.exec('BEGIN');
    const viewsBroken = brokenViews(db); // already broken (another tool's): not this alteration's doing
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
    // A view (of another tool) reading a field this alteration removes or renames would no longer parse: refused, named.
    const view = r.ok ? brokenViews(db).find((v) => !viewsBroken.includes(v)) : undefined;
    if (view !== undefined) r = { ok: false, reason: 'viewBroken', view };
    if (r.ok) {
      checkForeignKeys(db, keyedTables(db, design.name));
      db.exec('COMMIT');
    } else db.exec('ROLLBACK');
    return r;
  } catch (e) {
    if (db.isTransaction) db.exec('ROLLBACK');
    const field = duplicateField(e, design.fields);
    if (field !== undefined) return { ok: false, reason: 'duplicate', field };
    if (e instanceof DanglingKeyError) return { ok: false, reason: 'danglingKey', table: e.table };
    if (e instanceof ViewBrokenError) return { ok: false, reason: 'viewBroken', view: e.view };
    const view = brokenObject(e);
    if (view !== undefined) return { ok: false, reason: 'viewBroken', view };
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
  // Its metadata, exact name first: a twin's (another tool's "été" beside "Été") is never taken (A2-R14).
  const names = metadataNames(db, old.name);
  const metaTable = (db.prepare('SELECT name, props FROM bc_tables').all() as { name: string; props: string }[]).find((x) => x.name === names.table);
  const metaFields = (db.prepare('SELECT table_name, field_name, props FROM bc_fields').all() as { table_name: string; field_name: string; props: string }[])
    .filter((x) => names.fields !== undefined && sqliteSameName(x.table_name, names.fields));

  db.exec(`DROP TABLE ${quoteIdent(old.name)}`);
  // The copy takes the name with legacy_alter_table ON (SQLite's 12-step rebuild): nothing refers to the copy, foreign keys
  // are OFF, and a view elsewhere in the base that no longer parses (another tool's) must not refuse the rename.
  db.exec('PRAGMA legacy_alter_table=ON');
  try {
    db.exec(`ALTER TABLE ${quoteIdent(tmp)} RENAME TO ${quoteIdent(design.name)}`);
  } finally {
    db.exec('PRAGMA legacy_alter_table=OFF');
  }
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

/** A rule (a field's, or the table's) added or changed by this alteration, broken by rows of the rebuilt table: validationExisting. */
async function existingViolations(db: DatabaseSync, old: TableDesign, design: TableDesign, sources: (string | null)[], info: LocaleInfo): Promise<AlterResult> {
  for (const [i, fd] of design.fields.entries()) {
    const before = old.fields.find((x) => x.name === sources[i])?.props.validationRule;
    if (!fd.props.validationRule || fd.props.validationRule === before) continue;
    const rows = await countViolations(db, design, fd.name, info);
    if (rows > 0) return { ok: false, reason: 'validationExisting', field: fd.name, rows };
  }
  const before = old.validationRule && renamedRule(old.validationRule, design.fields.map((fd, i) => ({ name: fd.name, sourceName: sources[i] ?? null })));
  if (design.validationRule && design.validationRule !== before) { // the table's rule (field ''), unless only its fields were renamed
    const rows = await countViolations(db, design, '', info);
    if (rows > 0) return { ok: false, reason: 'validationExisting', field: '', rows };
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
