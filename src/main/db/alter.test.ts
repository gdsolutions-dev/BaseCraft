import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { createBaseFile, openBaseFile } from './file-format';
import { alterTable, type FieldMapping } from './alter';
import { createTable, listTables, NameExistsError, quoteIdent, reconcile, tableDesign, writeTableMetadata } from './schema';
import { f, t } from '../../shared/test-fixtures';
import { localeInfo } from '../../shared/locale-format';
import type { FieldDef } from '../../shared/field-types';

let dir: string;
let db: DatabaseSync;

const baseFields = [f('N°', 'autoNumber'), f('Nom', 'shortText'), f('Ville', 'shortText'), f('Code', 'shortText')];
const baseNames = baseFields.map((x) => x.name);
const withoutCode = baseFields.filter((x) => x.name !== 'Code');
const replaceField = (fields: FieldDef[], fd: FieldDef): FieldDef[] => fields.map((x) => (x.name === fd.name ? fd : x));

const rowsOf = (d: DatabaseSync, name: string): Record<string, unknown>[] =>
  d.prepare(`SELECT * FROM ${quoteIdent(name)} ORDER BY rowid`).all() as Record<string, unknown>[];
const insertRaw = (d: DatabaseSync, name: string, values: Record<string, unknown>): number => {
  const keys = Object.keys(values);
  return Number(
    d.prepare(`INSERT INTO ${quoteIdent(name)} (${keys.map(quoteIdent).join(', ')}) VALUES (${keys.map(() => '?').join(', ')})`)
      .run(...(Object.values(values) as (string | number | null)[])).lastInsertRowid,
  );
};
const fkOn = (d: DatabaseSync): number => (d.prepare('PRAGMA foreign_keys').get() as { foreign_keys: number }).foreign_keys;
const snapshot = (): unknown[] => [
  db.prepare('SELECT type, name, sql FROM sqlite_master ORDER BY name').all(),
  db.prepare('SELECT * FROM sqlite_sequence ORDER BY name').all(),
  db.prepare('SELECT * FROM bc_tables ORDER BY name').all(),
  db.prepare('SELECT * FROM bc_fields ORDER BY table_name, position').all(),
  tableDesign(db, 'T'), rowsOf(db, 'T'),
];

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bcalt-'));
  const p = path.join(dir, 'test.basecraft');
  createBaseFile(p, '0.0.0');
  db = openBaseFile(p, 'write', '0.0.0').db;
  createTable(db, t('T', baseFields));
  for (const [Nom, Ville, Code] of [['Dupont', 'Lyon', '12,5'], ['Durand', null, 'abc'], ['Dupont', null, '7']]) insertRaw(db, 'T', { Nom, Ville, Code });
});
afterEach(() => {
  try { db.close(); } catch { /* already closed */ }
  fs.rmSync(dir, { recursive: true, force: true });
});

const fr = localeInfo('fr-FR');
const alter = (fields: FieldDef[], mapping: FieldMapping[], allowDataLoss = false) => alterTable(db, 'T', t('T', fields), mapping, { allowDataLoss, info: fr });
const same = (names: string[]) => names.map((n) => ({ name: n, sourceName: n }));

describe('alterTable (brief)', () => {
  it.each<[string, Record<string, unknown>]>([
    ['empty displayFields', { lookup: { kind: 'table' as const, table: 'X', boundField: 'N°', displayFields: [], limitToList: false } }],
    ['non-string format', { format: 42 }],
  ])('refuses invalid new props (%s): throws, nothing altered', async (_n, extra) => {
    const before = snapshot();
    const fields = replaceField(baseFields, { name: 'Nom', props: { ...f('Nom', 'shortText').props, ...extra } });
    await expect(alter(fields, same(baseNames))).rejects.toThrow(/invalid field properties: Nom/);
    expect(snapshot()).toEqual(before);
  });
  it('renames a field and keeps values and rowids', async () => {
    expect(await alter([f('N°', 'autoNumber'), f('Nom', 'shortText'), f('Commune', 'shortText'), f('Code', 'shortText')],
      [...same(['N°', 'Nom']), { name: 'Commune', sourceName: 'Ville' }, ...same(['Code'])])).toEqual({ ok: true });
    expect(rowsOf(db, 'T').map((r) => [r['N°'], r.Commune])).toEqual([[1, 'Lyon'], [2, null], [3, null]]);
  });
  it('adds and removes fields', async () => {
    await alter([f('N°', 'autoNumber'), f('Nom', 'shortText'), f('Note', 'longText')], [...same(['N°', 'Nom']), { name: 'Note', sourceName: null }]);
    expect(Object.keys(rowsOf(db, 'T')[0]!)).toEqual(['N°', 'Nom', 'Note']); expect(rowsOf(db, 'T')[0]!.Note).toBeNull();
  });
  it('keeps autonumber sequence', async () => {
    db.exec('DELETE FROM "T" WHERE "N°" = 3'); await alter(baseFields, same(baseNames));
    expect(insertRaw(db, 'T', { Nom: 'X' })).toBe(4);
  });
  it('converts text to number using locale', async () => {
    db.exec(`DELETE FROM "T" WHERE "Code" = 'abc'`);
    await alter([...withoutCode, f('Code', 'number', { numberSize: 'double' })], same(baseNames));
    expect(rowsOf(db, 'T').map((r) => r.Code)).toEqual([12.5, 7]);
  });
  it('reports lossy conversion and changes nothing', async () => {
    const all = snapshot();
    const before = [tableDesign(db, 'T'), rowsOf(db, 'T')];
    expect(await alter([...withoutCode, f('Code', 'number', { numberSize: 'double' })], same(baseNames))).toEqual({ ok: false, reason: 'lossy', lossyRows: 1 });
    expect([tableDesign(db, 'T'), rowsOf(db, 'T')]).toEqual(before);
    expect(snapshot()).toEqual(all); // extra: no temporary table left, metadata untouched
  });
  it('applies loss when allowed: null for conversions, truncation for size', async () => {
    await alter([f('N°', 'autoNumber'), f('Nom', 'shortText', { size: 3 }), f('Ville', 'shortText'), f('Code', 'number', { numberSize: 'double' })], same(baseNames), true);
    expect(rowsOf(db, 'T').map((r) => [r.Nom, r.Code])).toEqual([['Dup', 12.5], ['Dur', null], ['Dup', 7]]);
  });
  it('required with existing nulls fails', async () =>
    expect(await alter(replaceField(baseFields, f('Ville', 'shortText', { required: true })), same(baseNames), true)).toEqual({ ok: false, reason: 'required', field: 'Ville', rows: 2 }));
  it('unique index on duplicates fails cleanly', async () =>
    expect(await alter(replaceField(baseFields, f('Nom', 'shortText', { indexed: 'yesNoDuplicates' })), same(baseNames))).toEqual({ ok: false, reason: 'duplicate', field: 'Nom' }));
  it('keeps unknown table and field props', async () => {
    writeTableMetadata(db, { ...tableDesign(db, 'T'), extra: { futureTableProp: 1 } });
    await alter(replaceField(baseFields, f('Nom', 'shortText', { futureProp: 2 })), same(baseNames));
    expect(tableDesign(db, 'T').extra).toMatchObject({ futureTableProp: 1 });
    expect(tableDesign(db, 'T').fields[1]!.props.futureProp).toBe(2);
  });
});

describe('alterTable (guards and edge cases)', () => {
  it('rejects a bad mapping as a programming error, touching nothing', async () => {
    const before = snapshot();
    const bad: FieldMapping[][] = [
      same(['N°', 'Nom', 'Ville']), // Code missing
      [...same(baseNames), { name: 'Code', sourceName: 'Code' }], // listed twice
      [...same(baseNames), { name: 'Autre', sourceName: null }], // not in the design
      [...same(['N°', 'Nom', 'Ville']), { name: 'Code', sourceName: 'Inconnu' }], // unknown source
      [...same(['N°', 'Nom', 'Ville']), { name: 'Code', sourceName: 'Nom' }], // source used twice
    ];
    for (const m of bad) await expect(alter(baseFields, m)).rejects.toThrow(/mapping/);
    expect(snapshot()).toEqual(before);
    expect(fkOn(db)).toBe(1);
  });

  it('returns design errors and touches nothing', async () => {
    const before = snapshot();
    expect(await alter([...baseFields, f('nom', 'longText')], [...same(baseNames), { name: 'nom', sourceName: null }]))
      .toEqual({ ok: false, reason: 'design', errors: [{ code: 'nameDuplicate', field: 'nom' }] });
    expect(await alterTable(db, 'T', t('bc_x', baseFields), same(baseNames), { allowDataLoss: true, info: fr }))
      .toEqual({ ok: false, reason: 'design', errors: [{ code: 'reservedName' }] });
    expect(snapshot()).toEqual(before);
  });

  it('rejects unusable field properties like createTable', async () => {
    await expect(alter(replaceField(baseFields, f('Code', 'number', { numberSize: 'constructor' as never })), same(baseNames))).rejects.toThrow(/invalid field properties/);
  });

  it('renames the table at the same time, metadata and indexes follow', async () => {
    db.exec('DELETE FROM "T" WHERE "N°" = 3'); // the sequence (3) must survive the rename
    writeTableMetadata(db, { ...tableDesign(db, 'T'), description: 'd', extra: { color: 'red' } });
    const fields = replaceField(baseFields, f('Nom', 'shortText', { indexed: 'yesDuplicates' }));
    expect(await alterTable(db, 'T', { ...t('Personnes "VIP" été', fields), description: 'd' }, same(baseNames), { allowDataLoss: false, info: fr })).toEqual({ ok: true });
    expect(listTables(db)).toEqual([{ name: 'Personnes "VIP" été', description: 'd' }]);
    expect(tableDesign(db, 'Personnes "VIP" été').extra).toEqual({ color: 'red' });
    expect(rowsOf(db, 'Personnes "VIP" été').map((r) => r.Nom)).toEqual(['Dupont', 'Durand']);
    expect(db.prepare(`SELECT name FROM sqlite_master WHERE type = 'index' AND name LIKE 'bcx_%'`).all()).toEqual([{ name: 'bcx_Personnes "VIP" été.Nom' }]);
    expect(db.prepare('SELECT DISTINCT table_name AS n FROM bc_fields').all()).toEqual([{ n: 'Personnes "VIP" été' }]);
    expect(reconcile(db)).toEqual({ addedTables: [], removedTables: [], addedFields: [], removedFields: [], removedRelations: [], downgradedRelations: [] });
    expect(insertRaw(db, 'Personnes "VIP" été', { Nom: 'X' })).toBe(4);
    expect(() => createTable(db, t('T', [f('A', 'shortText')]))).not.toThrow();
  });

  it('case-only table rename through alter', async () => {
    expect(await alterTable(db, 'T', t('t', baseFields), same(baseNames), { allowDataLoss: false, info: fr })).toEqual({ ok: true });
    expect(listTables(db).map((x) => x.name)).toEqual(['t']);
    expect(rowsOf(db, 't')).toHaveLength(3);
  });

  it('renaming onto another table throws NameExistsError and touches nothing', async () => {
    createTable(db, t('Autre', [f('A', 'shortText')]));
    const before = snapshot();
    await expect(alterTable(db, 'T', t('AUTRE', baseFields), same(baseNames), { allowDataLoss: false, info: fr })).rejects.toThrow(NameExistsError);
    expect(snapshot()).toEqual(before);
  });

  it('a yesNo field added gives 0 to existing rows', async () => {
    expect(await alter([...baseFields, f('Actif', 'yesNo')], [...same(baseNames), { name: 'Actif', sourceName: null }])).toEqual({ ok: true });
    expect(rowsOf(db, 'T').map((r) => r.Actif)).toEqual([0, 0, 0]);
  });

  it('a new required field on a filled table fails with every row counted', async () =>
    expect(await alter([...baseFields, f('Pays', 'shortText', { required: true })], [...same(baseNames), { name: 'Pays', sourceName: null }], true))
      .toEqual({ ok: false, reason: 'required', field: 'Pays', rows: 3 }));

  it('a UNIQUE violation during the copy fails cleanly', async () => {
    const before = snapshot();
    expect(await alter([f('N°', 'number'), f('Nom', 'shortText', { primaryKey: true }), f('Ville', 'shortText'), f('Code', 'shortText')], same(baseNames)))
      .toEqual({ ok: false, reason: 'duplicate', field: 'Nom' });
    expect(snapshot()).toEqual(before);
    expect(db.isTransaction).toBe(false);
    expect(fkOn(db)).toBe(1);
  });

  it('a unique index failing after the swap rolls everything back', async () => {
    const before = snapshot();
    expect((await alter(replaceField(baseFields, f('Nom', 'shortText', { indexed: 'yesNoDuplicates' })), same(baseNames))).ok).toBe(false);
    expect(snapshot()).toEqual(before);
    expect(fkOn(db)).toBe(1);
  });

  it('rounding a number is a loss too', async () => {
    db.exec(`DELETE FROM "T" WHERE "Code" = 'abc'`);
    await alter([...withoutCode, f('Code', 'number', { numberSize: 'double' })], same(baseNames));
    const toLong = [...withoutCode, f('Code', 'number')];
    expect(await alter(toLong, same(baseNames))).toEqual({ ok: false, reason: 'lossy', lossyRows: 1 });
    expect(await alter(toLong, same(baseNames), true)).toEqual({ ok: true });
    expect(rowsOf(db, 'T').map((r) => r.Code)).toEqual([12, 7]);
  });

  it('stored decimals are read as stored, not with the locale (de-DE)', async () => {
    const dec = f('Code', 'number', { numberSize: 'decimal', precision: 10, scale: 2 });
    const de = localeInfo('de-DE');
    db.exec(`DELETE FROM "T" WHERE "Code" = 'abc'`);
    expect(await alterTable(db, 'T', t('T', [...withoutCode, dec]), same(baseNames), { allowDataLoss: false, info: de })).toEqual({ ok: true });
    expect(rowsOf(db, 'T').map((r) => r.Code)).toEqual(['12.50', '7.00']);
    expect(await alterTable(db, 'T', t('T', [...withoutCode, dec]), same(baseNames), { allowDataLoss: false, info: de })).toEqual({ ok: true });
    expect(rowsOf(db, 'T').map((r) => r.Code)).toEqual(['12.50', '7.00']);
  });

  it('rowids survive without an autoNumber, and an autoNumber added later takes them', async () => {
    db.exec('DELETE FROM "T" WHERE "N°" = 2');
    await alter(withoutCode.slice(1), same(['Nom', 'Ville']));
    expect(db.prepare('SELECT rowid AS r FROM "T" ORDER BY rowid').all()).toEqual([{ r: 1 }, { r: 3 }]);
    expect(await alter([f('ID', 'autoNumber'), ...withoutCode.slice(1)], [{ name: 'ID', sourceName: null }, ...same(['Nom', 'Ville'])])).toEqual({ ok: true });
    expect(rowsOf(db, 'T').map((r) => [r.ID, r.Nom])).toEqual([[1, 'Dupont'], [3, 'Dupont']]);
    expect(insertRaw(db, 'T', { Nom: 'X' })).toBe(4);
  });

  it('unknown props follow a renamed field, never a new field reusing a removed name', async () => {
    const d = tableDesign(db, 'T');
    writeTableMetadata(db, { ...d, fields: d.fields.map((x) => ({ ...x, props: { ...x.props, futureProp: x.name } })) });
    expect(await alter([f('N°', 'autoNumber'), f('Nom', 'shortText'), f('Commune', 'shortText'), f('Code', 'longText')],
      [...same(['N°', 'Nom']), { name: 'Commune', sourceName: 'Ville' }, { name: 'Code', sourceName: null }])).toEqual({ ok: true });
    expect(Object.fromEntries(tableDesign(db, 'T').fields.map((x) => [x.name, x.props.futureProp])))
      .toEqual({ 'N°': 'N°', Nom: 'Nom', Commune: 'Ville', Code: undefined });
  });

  it('a BLOB written by raw SQL is never turned into text silently', async () => {
    db.exec(`UPDATE "T" SET "Ville" = x'0102' WHERE "N°" = 2`);
    expect(await alter(baseFields, same(baseNames))).toEqual({ ok: false, reason: 'lossy', lossyRows: 1 });
  });

  it('refuses to run inside an open transaction and leaves it open', async () => {
    db.exec('BEGIN');
    await expect(alter(baseFields, same(baseNames))).rejects.toThrow(/inside a transaction/);
    expect(db.isTransaction).toBe(true);
    db.exec('ROLLBACK');
  });

  it('required wins over lossy: no point confirming a loss that cannot be saved', async () =>
    expect(await alter([f('N°', 'autoNumber'), f('Nom', 'shortText'), f('Ville', 'shortText', { required: true }), f('Code', 'number')], same(baseNames)))
      .toEqual({ ok: false, reason: 'required', field: 'Ville', rows: 2 }));

  it('a primary key on a field with nulls reports required', async () =>
    expect(await alter([f('N°', 'number'), f('Nom', 'shortText'), f('Ville', 'shortText', { primaryKey: true }), f('Code', 'shortText')], same(baseNames), true))
      .toEqual({ ok: false, reason: 'required', field: 'Ville', rows: 2 }));

  it('failed yesNo conversions fall back to 0, never to null', async () => {
    const fields = [...withoutCode, f('Code', 'yesNo')];
    expect(await alter(fields, same(baseNames))).toEqual({ ok: false, reason: 'lossy', lossyRows: 3 });
    expect(await alter(fields, same(baseNames), true)).toEqual({ ok: true });
    expect(rowsOf(db, 'T').map((r) => r.Code)).toEqual([0, 0, 0]);
  });
});

describe('alterTable (fix round 1: R16, R17, R18)', () => {
  const de = localeInfo('de-DE');
  const codes = (): unknown[] => rowsOf(db, 'T').map((r) => r.Code);
  const dbl = [...withoutCode, f('Code', 'number', { numberSize: 'double' })];
  const dec = [...withoutCode, f('Code', 'number', { numberSize: 'decimal', precision: 10, scale: 2 })];

  it('de-DE: number → text → number round trips unchanged (R16a)', async () => {
    db.exec(`UPDATE "T" SET "Code" = NULL WHERE "Code" = 'abc'`);
    const steps: [FieldDef[], unknown[]][] = [
      [dbl, [12.5, null, 7]], [baseFields, ['12,5', null, '7']], [dbl, [12.5, null, 7]],
      [dec, ['12.50', null, '7.00']], [baseFields, ['12,50', null, '7,00']], [dec, ['12.50', null, '7.00']],
    ];
    for (const [fields, expected] of steps) {
      expect(await alterTable(db, 'T', t('T', fields), same(baseNames), { allowDataLoss: false, info: de })).toEqual({ ok: true });
      expect(codes()).toEqual(expected);
    }
  });

  it('de-DE: a number truncated into a short text keeps the regional separator (R16a)', async () => {
    db.exec(`DELETE FROM "T" WHERE "Code" = 'abc'`);
    await alterTable(db, 'T', t('T', dbl), same(baseNames), { allowDataLoss: false, info: de });
    const short = [...withoutCode, f('Code', 'shortText', { size: 3 })];
    expect(await alterTable(db, 'T', t('T', short), same(baseNames), { allowDataLoss: false, info: de })).toEqual({ ok: false, reason: 'lossy', lossyRows: 1 });
    expect(await alterTable(db, 'T', t('T', short), same(baseNames), { allowDataLoss: true, info: de })).toEqual({ ok: true });
    expect(codes()).toEqual(['12,', '7']);
  });

  it('de-DE: text read one way by the locale and another canonically is ambiguous, hence lossy (R16b)', async () => {
    db.exec(`UPDATE "T" SET "Code" = '1.234' WHERE "N°" = 2`);
    const run = (allowDataLoss: boolean) => alterTable(db, 'T', t('T', dbl), same(baseNames), { allowDataLoss, info: de });
    expect(await run(false)).toEqual({ ok: false, reason: 'lossy', lossyRows: 1 });
    expect(await run(true)).toEqual({ ok: true });
    expect(codes()).toEqual([12.5, 1234, 7]);
  });

  it('fr-FR: 1.5 reads the same both ways, not ambiguous (R16b)', async () => {
    db.exec(`UPDATE "T" SET "Code" = '1.5' WHERE "N°" = 2`);
    expect(await alter(dbl, same(baseNames))).toEqual({ ok: true });
    expect(codes()).toEqual([12.5, 1.5, 7]);
  });

  it.each([
    ['a trigger', `CREATE TRIGGER "tr" AFTER INSERT ON "t" BEGIN SELECT 1; END`],
    ['an index not made by BaseCraft', `CREATE INDEX "idx" ON "T"("Nom")`],
    ['a column added outside BaseCraft', `ALTER TABLE "T" ADD COLUMN "Ext" TEXT`],
  ])('refuses a table with %s and touches nothing (R17a)', async (_, sql) => {
    db.exec(sql);
    const before = snapshot();
    expect(await alter(baseFields, same(baseNames))).toEqual({ ok: false, reason: 'external' });
    expect(snapshot()).toEqual(before);
  });

  it('its own indexes (bcx_ and sqlite_autoindex) do not make a table external (R17a)', async () => {
    const fields = [f('N°', 'number'), f('Nom', 'shortText', { indexed: 'yesDuplicates' }), f('Ville', 'shortText'), f('Code', 'shortText', { primaryKey: true })];
    expect(await alter(fields, same(baseNames))).toEqual({ ok: true });
    expect((db.prepare(`SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'T' ORDER BY name`).all() as { name: string }[]).map((r) => r.name))
      .toEqual(['bcx_T.Nom', 'sqlite_autoindex_T_1']);
    expect(await alter(fields, same(baseNames))).toEqual({ ok: true });
  });

  it('text a rebuild would trim or empty is a loss, even in a field the user did not touch (R17b)', async () => {
    db.exec(`UPDATE "T" SET "Ville" = '  padded  ' WHERE "N°" = 2`);
    db.exec(`UPDATE "T" SET "Ville" = '' WHERE "N°" = 3`);
    const fields = [f('N°', 'autoNumber'), f('Client', 'shortText'), f('Ville', 'shortText'), f('Code', 'shortText')];
    const mapping = [...same(['N°']), { name: 'Client', sourceName: 'Nom' }, ...same(['Ville', 'Code'])];
    expect(await alter(fields, mapping)).toEqual({ ok: false, reason: 'lossy', lossyRows: 2 });
    expect(await alter(fields, mapping, true)).toEqual({ ok: true });
    expect(rowsOf(db, 'T').map((r) => r.Ville)).toEqual(['Lyon', 'padded', null]);
  });

  it('a field named like the rowid is a design error, nothing touched (R18)', async () => {
    const before = snapshot();
    expect(await alter([...baseFields, f('ROWID', 'longText')], [...same(baseNames), { name: 'ROWID', sourceName: null }]))
      .toEqual({ ok: false, reason: 'design', errors: [{ code: 'reservedFieldName', field: 'ROWID' }] });
    expect(snapshot()).toEqual(before);
  });

  it('a failure after the metadata write (dangling foreign key) rolls everything back', async () => {
    db.exec('PRAGMA foreign_keys=OFF');
    db.exec(`CREATE TABLE "Child" (tid INTEGER REFERENCES "T"("N°"))`);
    db.exec('INSERT INTO "Child" VALUES (99)');
    db.exec('PRAGMA foreign_keys=ON');
    const before = snapshot();
    await expect(alter([f('N°', 'autoNumber'), f('Nom', 'shortText'), f('Commune', 'shortText'), f('Code', 'shortText')],
      [...same(['N°', 'Nom']), { name: 'Commune', sourceName: 'Ville' }, ...same(['Code'])])).rejects.toThrow(/foreign key/);
    expect(snapshot()).toEqual(before);
    expect(db.isTransaction).toBe(false);
    expect(fkOn(db)).toBe(1);
  });
});
