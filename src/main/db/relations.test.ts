import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { Relation } from '../../shared/api';
import { clients, f, t } from '../../shared/test-fixtures';
import { localeInfo } from '../../shared/locale-format';
import { createBaseFile, openBaseFile } from './file-format';
import { alterTable, isExternal, rebuildSame, withForeignKeysOff, type FieldMapping } from './alter';
import {
  cascadeChildren, createTable, DanglingKeyError, dropTable, listTables, quoteIdent, reconcile, renameTable, tableDesign, ViewBrokenError,
} from './schema';
import { previewText, runImport, type ImportTexts } from '../import/text-import';
import en from '../../shared/i18n/en.json';
import frTexts from '../../shared/i18n/fr.json';
import type { FieldDef } from '../../shared/field-types';
import { countRows } from './rows';
import { deleteRows, insertRow, updateRow } from './write-layer';
import { deleteRelation, listRelations, relationsLayout, relationsOf, saveRelation, saveRelationsLayout } from './relations';

// Every test writes a real base file (synchronous=FULL): on Windows, a scan of the new temp files can stall one for
// seconds under the full suite's load, also before this task. The default 5 s timeout then fails at random.
vi.setConfig({ testTimeout: 30_000, hookTimeout: 30_000 });

const fr = localeInfo('fr-FR');
const now = () => new Date(2026, 9, 22);
let dir: string;
let db: DatabaseSync;

const commandes = t('Commandes', [f('N°', 'autoNumber'), f('Client', 'number', { numberSize: 'longInteger' }), f('Montant', 'currency')]);
const rel: Relation = {
  name: '', parentTable: 'Clients', parentFields: ['N°'], childTable: 'Commandes', childFields: ['Client'],
  enforce: true, cascadeUpdate: false, cascadeDelete: false, joinType: 1,
};
const sqlOf = (name: string): string => (db.prepare('SELECT sql FROM sqlite_master WHERE name = ?').get(name) as { sql: string }).sql;
const identity = (d: { fields: { name: string }[] }): FieldMapping[] => d.fields.map((x) => ({ name: x.name, sourceName: x.name }));
const opts = { allowDataLoss: false, info: fr };
const raw = (sql: string, ...args: (string | number | null)[]) => db.prepare(sql).run(...args);

const file = () => path.join(dir, 'test.basecraft');
/** A real close and reopen, then the reconcile of an open in write mode. */
const reopen = () => { db.close(); db = openBaseFile(file(), 'write', '0.0.0').db; return reconcile(db); };
const externalTables = () => listTables(db).map((x) => x.name).filter((n) => isExternal(db, tableDesign(db, n)));
/** Another tool rebuilds `table` from its own CREATE TABLE (rows copied, foreign keys off). */
const rebuildWith = (table: string, edit: (sql: string) => string) => {
  db.exec('PRAGMA foreign_keys=OFF');
  db.exec(edit(sqlOf(table)).replace(/^CREATE TABLE [^(]+\(/, 'CREATE TABLE "tmp_other" ('));
  db.exec(`INSERT INTO "tmp_other" SELECT * FROM ${quoteIdent(table)}; DROP TABLE ${quoteIdent(table)}; ALTER TABLE "tmp_other" RENAME TO ${quoteIdent(table)}`);
  db.exec('PRAGMA foreign_keys=ON');
};

beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bcrel-'));
  const p = path.join(dir, 'test.basecraft');
  createBaseFile(p, '0.0.0');
  db = openBaseFile(p, 'write', '0.0.0').db;
  createTable(db, clients);
  createTable(db, commandes);
  for (const [nom, email] of [['Ana', 'ana@x'], ['Bob', 'bob@x']]) expect((await insertRow(db, clients, { Nom: nom, Email: email }, fr, now)).ok).toBe(true);
  for (const c of ['1', '2']) expect((await insertRow(db, commandes, { Client: c, Montant: '10' }, fr, now)).ok).toBe(true);
});
afterEach(() => {
  try { db.close(); } catch { /* already closed */ }
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('relations (brief)', () => {
  it('enforced relation adds a real FK', () => {
    const r = saveRelation(db, rel, null, fr);
    expect(r).toMatchObject({ ok: true, relation: { name: 'ClientsCommandes' } });
    expect(sqlOf('Commandes')).toMatch(/FOREIGN KEY \("Client"\) REFERENCES "Clients" \("N°"\)/);
    expect(listRelations(db)).toEqual([{ ...rel, name: 'ClientsCommandes' }]);
    expect(countRows(db, 'Commandes')).toBe(2);
  });

  it('orphans block creation', () => {
    raw('INSERT INTO "Commandes" ("Client") VALUES (99)');
    raw('INSERT INTO "Commandes" ("Client") VALUES (NULL)'); // a Null key is no orphan, as in SQLite and Access
    expect(saveRelation(db, rel, null, fr)).toEqual({ ok: false, reason: 'violations', rows: 1 });
    expect(listRelations(db)).toEqual([]);
    expect(sqlOf('Commandes')).not.toMatch(/FOREIGN KEY/);
    expect(saveRelation(db, { ...rel, enforce: false }, null, fr)).toMatchObject({ ok: true }); // no integrity: no check
  });

  it('type and key checks', () => {
    expect(saveRelation(db, { ...rel, childFields: ['Montant'] }, null, fr)).toMatchObject({ reason: 'typesMismatch' });
    expect(saveRelation(db, { ...rel, parentFields: ['Nom'] }, null, fr)).toMatchObject({ reason: 'parentNotUnique' });
    expect(saveRelation(db, { ...rel, parentFields: ['Nom'], enforce: false, childFields: ['N°'] }, null, fr)).toMatchObject({ reason: 'typesMismatch' });
    expect(saveRelation(db, { ...rel, childFields: ['Client', 'Montant'] }, null, fr)).toMatchObject({ reason: 'fieldsMismatch' });
    expect(saveRelation(db, { ...rel, childFields: ['Inconnu'] }, null, fr)).toMatchObject({ reason: 'fieldsMismatch' });
    expect(saveRelation(db, { ...rel, childTable: 'Clients', childFields: ['Âge'] }, null, fr)).toMatchObject({ reason: 'sameTable' });
    expect(listRelations(db)).toEqual([]);
  });

  it('names: default with a numeric suffix, explicit duplicates refused (Unicode case ignored)', () => {
    expect(saveRelation(db, { ...rel, enforce: false }, null, fr)).toMatchObject({ ok: true, relation: { name: 'ClientsCommandes' } });
    expect(saveRelation(db, { ...rel, enforce: false, childFields: ['N°'] }, null, fr)).toMatchObject({ ok: true, relation: { name: 'ClientsCommandes1' } });
    expect(saveRelation(db, { ...rel, enforce: false, name: 'Été', parentFields: ['Solde'], childFields: ['Montant'] }, null, fr)).toMatchObject({ ok: true });
    const other = { ...rel, enforce: false, parentFields: ['N°', 'Solde'], childFields: ['Client', 'Montant'] }; // no duplicate of those
    expect(saveRelation(db, { ...other, name: 'été' }, null, fr)).toEqual({ ok: false, reason: 'nameExists' });
    expect(saveRelation(db, { ...other, name: 'clientscommandes' }, null, fr)).toEqual({ ok: false, reason: 'nameExists' });
  });

  it('external tables cannot take part in a relation', () => {
    db.exec('CREATE TABLE "Ext" ("Client" INTEGER)');
    reconcile(db);
    expect(saveRelation(db, { ...rel, childTable: 'Ext' }, null, fr)).toEqual({ ok: false, reason: 'external', table: 'Ext' });
  });

  it('a field-less metadata row whose name differs from the live table by non-ASCII case is adopted, not left behind', () => {
    db.exec('CREATE TABLE "Été" ("x" TEXT)');
    raw(`INSERT INTO bc_tables (name, props) VALUES ('ÉTÉ', '{"description":"kept"}')`); // NOCASE folds ASCII only
    expect(reconcile(db)).toMatchObject({ addedTables: ['Été'], removedTables: [] });
    expect(db.prepare('SELECT name FROM bc_tables WHERE name IN (?, ?)').all('ÉTÉ', 'Été')).toHaveLength(1);
    expect(tableDesign(db, 'Été').description).toBe('kept');
    expect(reopen()).toMatchObject({ addedTables: [], removedTables: [] });
  });

  it('a foreign key added by another tool makes the table external: a rebuild would lose it', async () => {
    db.exec('CREATE TABLE "Notes" ("N°" INTEGER PRIMARY KEY AUTOINCREMENT, "Client" INTEGER REFERENCES "Clients" ("N°"))');
    reconcile(db);
    const d = tableDesign(db, 'Notes');
    raw(`UPDATE bc_fields SET props = json_remove(props, '$.external') WHERE table_name = 'Notes'`); // even with adopted fields
    expect(await alterTable(db, 'Notes', tableDesign(db, 'Notes'), identity(d), opts)).toEqual({ ok: false, reason: 'external' });
    expect(saveRelation(db, { ...rel, childTable: 'Notes' }, null, fr)).toEqual({ ok: false, reason: 'external', table: 'Notes' });
  });

  it('write errors', async () => {
    saveRelation(db, rel, null, fr);
    const design = tableDesign(db, 'Commandes');
    expect(await insertRow(db, design, { Client: '99' }, fr, now)).toEqual({ ok: false, errors: [{ field: 'Client', code: 'noParent', table: 'Clients' }] });
    expect((await updateRow(db, design, 1, { Client: '99' }, fr, now))).toEqual({ ok: false, errors: [{ field: 'Client', code: 'noParent', table: 'Clients' }] });
    expect((await insertRow(db, design, { Client: '2' }, fr, now)).ok).toBe(true);
    expect(deleteRows(db, 'Clients', [1])).toEqual({ ok: false, reason: 'related', table: 'Commandes' });
    expect(countRows(db, 'Clients')).toBe(2);
    expect(db.isTransaction).toBe(false);
  });

  it('updating a referenced parent key is refused with the child table; cascade update propagates', async () => {
    createTable(db, t('Contacts', [f('Email', 'shortText')]));
    raw(`INSERT INTO "Contacts" ("Email") VALUES ('ana@x')`);
    saveRelation(db, { ...rel, parentFields: ['Email'], childTable: 'Contacts', childFields: ['Email'] }, null, fr);
    const cl = tableDesign(db, 'Clients');
    expect(await updateRow(db, cl, 1, { Email: 'zed@x' }, fr, now)).toEqual({ ok: false, errors: [{ field: 'Email', code: 'related', table: 'Contacts' }] });
    expect((await updateRow(db, cl, 2, { Email: 'bob@y' }, fr, now)).ok).toBe(true); // no child row
    saveRelation(db, { ...rel, name: 'ClientsContacts', parentFields: ['Email'], childTable: 'Contacts', childFields: ['Email'], cascadeUpdate: true }, 'ClientsContacts', fr);
    expect((await updateRow(db, cl, 1, { Email: 'zed@x' }, fr, now)).ok).toBe(true);
    expect(db.prepare('SELECT "Email" FROM "Contacts"').all()).toEqual([{ Email: 'zed@x' }]);
  });

  it('a refused delete inside an outer transaction undoes its own work only', () => {
    saveRelation(db, rel, null, fr);
    db.exec('BEGIN');
    raw('DELETE FROM "Commandes" WHERE rowid = 1');
    expect(deleteRows(db, 'Clients', [1, ...Array.from({ length: 600 }, (_, i) => 1000 + i), 2])).toEqual({ ok: false, reason: 'related', table: 'Commandes' });
    expect(db.isTransaction).toBe(true);
    db.exec('COMMIT');
    expect(countRows(db, 'Clients')).toBe(2);
    expect(countRows(db, 'Commandes')).toBe(1);
  });

  it('cascade delete', () => {
    saveRelation(db, { ...rel, cascadeDelete: true }, null, fr);
    expect(deleteRows(db, 'Clients', [1])).toEqual({ ok: true, count: 1 });
    expect(countRows(db, 'Commandes')).toBe(1);
  });

  it('rename table propagates', () => {
    expect((db.prepare('PRAGMA legacy_alter_table').get() as { legacy_alter_table: number }).legacy_alter_table).toBe(0);
    saveRelation(db, rel, null, fr);
    renameTable(db, 'Clients', 'Contacts');
    expect(listRelations(db)[0]).toMatchObject({ parentTable: 'Contacts' });
    expect(sqlOf('Commandes')).toMatch(/REFERENCES "Contacts"/);
    expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
    renameTable(db, 'Commandes', 'Achats');
    expect(listRelations(db)[0]).toMatchObject({ parentTable: 'Contacts', childTable: 'Achats' });
    expect(relationsOf(db, 'achats')).toHaveLength(1);
  });

  it('drop and alter guarded', async () => {
    saveRelation(db, rel, null, fr);
    expect(dropTable(db, 'Clients')).toEqual({ ok: false, reason: 'hasRelations' });
    expect(dropTable(db, 'Commandes')).toEqual({ ok: false, reason: 'hasRelations' });
    const renamed = { ...commandes, fields: commandes.fields.map((x) => (x.name === 'Client' ? { ...x, name: 'Cli' } : x)) };
    const mapping = commandes.fields.map((x) => ({ name: x.name === 'Client' ? 'Cli' : x.name, sourceName: x.name }));
    expect(await alterTable(db, 'Commandes', renamed, mapping, opts)).toEqual({ ok: false, reason: 'relationField', field: 'Client', relation: 'ClientsCommandes', table: 'Clients' });
    const retyped = { ...commandes, fields: commandes.fields.map((x) => (x.name === 'Client' ? f('Client', 'number', { numberSize: 'integer' }) : x)) };
    expect(await alterTable(db, 'Commandes', retyped, identity(commandes), opts)).toMatchObject({ reason: 'relationField' });
    const removed = { ...commandes, fields: commandes.fields.filter((x) => x.name !== 'Client') };
    expect(await alterTable(db, 'Commandes', removed, identity(removed), opts)).toMatchObject({ reason: 'relationField' });
    const withNote = { ...commandes, fields: [...commandes.fields, f('Note', 'shortText')] };
    expect(await alterTable(db, 'Commandes', withNote, [...identity(commandes), { name: 'Note', sourceName: null }], opts)).toEqual({ ok: true });
    expect(sqlOf('Commandes')).toMatch(/FOREIGN KEY/);
    expect(countRows(db, 'Commandes')).toBe(2);
  });

  it('a parent field cannot lose its uniqueness while an enforced relation needs it', async () => {
    createTable(db, t('Contacts', [f('Email', 'shortText')]));
    expect(saveRelation(db, { ...rel, parentFields: ['Email'], childTable: 'Contacts', childFields: ['Email'] }, null, fr)).toMatchObject({ ok: true });
    const cl = tableDesign(db, 'Clients');
    const loose = { ...cl, fields: cl.fields.map((x) => (x.name === 'Email' ? { ...x, props: { ...x.props, indexed: 'yesDuplicates' as const } } : x)) };
    expect(await alterTable(db, 'Clients', loose, identity(cl), opts)).toEqual({ ok: false, reason: 'relationField', field: 'Email', relation: 'ClientsContacts', table: 'Contacts' });
  });

  it('rebuilding a parent with cascade-delete children keeps the children (foreign keys off during the rebuild)', async () => {
    saveRelation(db, { ...rel, cascadeDelete: true }, null, fr);
    const cl = tableDesign(db, 'Clients');
    const more = { ...cl, fields: [...cl.fields, f('Ville', 'shortText')] };
    expect(await alterTable(db, 'Clients', more, [...identity(cl), { name: 'Ville', sourceName: null }], opts)).toEqual({ ok: true });
    expect(countRows(db, 'Commandes')).toBe(2);
    expect(sqlOf('Commandes')).toMatch(/ON DELETE CASCADE/);
    expect((db.prepare('PRAGMA foreign_keys').get() as { foreign_keys: number }).foreign_keys).toBe(1);
    expect(deleteRows(db, 'Clients', [1])).toEqual({ ok: true, count: 1 }); // the cascade still works on the rebuilt parent
    expect(countRows(db, 'Commandes')).toBe(1);
  });

  it('renaming a parent through alterTable rewrites the children and the relation', async () => {
    saveRelation(db, rel, null, fr);
    const cl = tableDesign(db, 'Clients');
    expect(await alterTable(db, 'Clients', { ...cl, name: 'Personnes' }, identity(cl), opts)).toEqual({ ok: true });
    expect(sqlOf('Commandes')).toMatch(/REFERENCES "Personnes"/);
    expect(listRelations(db)[0]).toMatchObject({ parentTable: 'Personnes' });
    expect(countRows(db, 'Commandes')).toBe(2);
    expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
    const cm = tableDesign(db, 'Commandes');
    expect(await alterTable(db, 'Commandes', { ...cm, name: 'Ventes' }, identity(cm), opts)).toEqual({ ok: true });
    expect(sqlOf('Ventes')).toMatch(/FOREIGN KEY \("Client"\) REFERENCES "Personnes"/);
    expect(listRelations(db)[0]).toMatchObject({ childTable: 'Ventes' });
  });

  it('an unrelated foreign-key violation elsewhere does not block an alteration (scoped check)', async () => {
    db.exec('CREATE TABLE "P" ("k" INTEGER PRIMARY KEY); CREATE TABLE "E" ("p" INTEGER REFERENCES "P" ("k"))');
    db.exec('PRAGMA foreign_keys=OFF; INSERT INTO "E" VALUES (5); PRAGMA foreign_keys=ON');
    const cm = tableDesign(db, 'Commandes');
    expect(await alterTable(db, 'Commandes', { ...cm, fields: [...cm.fields, f('X', 'shortText')] }, [...identity(cm), { name: 'X', sourceName: null }], opts)).toEqual({ ok: true });
  });

  it('delete relation removes FK', () => {
    saveRelation(db, rel, null, fr);
    expect(deleteRelation(db, 'ClientsCommandes', fr)).toEqual({ ok: true });
    expect(sqlOf('Commandes')).not.toMatch(/FOREIGN KEY/);
    expect(listRelations(db)).toEqual([]);
    expect(dropTable(db, 'Commandes')).toEqual({ ok: true });
  });

  it('editing a relation keeps its unknown keys and rebuilds the child only when its keys change', () => {
    saveRelation(db, rel, null, fr);
    raw(`UPDATE bc_relations SET props = json_set(props, '$.future', 1)`);
    const before = sqlOf('Commandes');
    expect(saveRelation(db, { ...rel, name: 'ClientsCommandes', joinType: 2 }, 'ClientsCommandes', fr)).toMatchObject({ ok: true });
    expect(sqlOf('Commandes')).toBe(before);
    expect(saveRelation(db, { ...rel, name: 'Achats', cascadeDelete: true }, 'ClientsCommandes', fr)).toMatchObject({ ok: true, relation: { name: 'Achats' } });
    expect(sqlOf('Commandes')).toMatch(/ON DELETE CASCADE/);
    expect(listRelations(db)).toEqual([{ ...rel, name: 'Achats', cascadeDelete: true }]);
    expect(JSON.parse((db.prepare('SELECT props FROM bc_relations').get() as { props: string }).props).future).toBe(1);
    expect(saveRelation(db, { ...rel, name: 'Achats', enforce: false }, 'Achats', fr)).toMatchObject({ ok: true });
    expect(sqlOf('Commandes')).not.toMatch(/FOREIGN KEY/);
  });

  it('reconcile forgets the relations of a table dropped outside BaseCraft', () => {
    saveRelation(db, { ...rel, enforce: false }, null, fr);
    db.exec('DROP TABLE "Commandes"');
    reconcile(db);
    expect(listRelations(db)).toEqual([]);
  });

  it('layout round-trips through bc_meta options and keeps other options', () => {
    expect(relationsLayout(db)).toEqual({ tables: {} });
    saveRelationsLayout(db, { tables: { Clients: { x: 10, y: 20 } } });
    expect(relationsLayout(db)).toEqual({ tables: { Clients: { x: 10, y: 20 } } });
    raw(`UPDATE bc_meta SET value = '{"relationsLayout":{"tables":{"A":{"x":"bad"}}},"other":1}' WHERE key = 'options'`);
    expect(relationsLayout(db)).toEqual({ tables: {} }); // untrusted file content: invalid entries dropped
    saveRelationsLayout(db, { tables: {} });
    expect(JSON.parse((db.prepare(`SELECT value FROM bc_meta WHERE key = 'options'`).get() as { value: string }).value).other).toBe(1);
  });

  it('a renamed table keeps its place in the layout (case-only rename too); other entries are left alone', () => {
    saveRelationsLayout(db, { tables: { Clients: { x: 10, y: 20 }, Commandes: { x: 300, y: 40 } } });
    renameTable(db, 'Clients', 'Contacts');
    expect(relationsLayout(db)).toEqual({ tables: { Contacts: { x: 10, y: 20 }, Commandes: { x: 300, y: 40 } } });
    renameTable(db, 'Contacts', 'contacts');
    expect(relationsLayout(db).tables).toEqual({ contacts: { x: 10, y: 20 }, Commandes: { x: 300, y: 40 } });
  });

  it('a table named like an Object.prototype member keeps its place through save, reopen and rename', () => {
    for (const n of ['__proto__', 'constructor', 'prototype']) createTable(db, t(n, [f('A', 'shortText')]));
    const tables = JSON.parse('{"__proto__":{"x":1,"y":2},"constructor":{"x":3,"y":4},"prototype":{"x":5,"y":6}}');
    saveRelationsLayout(db, { tables });
    reopen();
    const read = relationsLayout(db).tables;
    expect(Object.keys(read)).toEqual(['__proto__', 'constructor', 'prototype']);
    expect(Object.getOwnPropertyDescriptor(read, '__proto__')?.value).toEqual({ x: 1, y: 2 });
    renameTable(db, 'Clients', '__proto__x');
    renameTable(db, '__proto__', 'Proto');
    renameTable(db, 'constructor', '__proto__');
    const after = relationsLayout(db).tables;
    expect(Object.keys(after)).toEqual(['Proto', '__proto__', 'prototype']);
    expect(Object.getOwnPropertyDescriptor(after, '__proto__')?.value).toEqual({ x: 3, y: 4 });
  });

  it('a dropped table leaves the layout; a table taking a name never inherits a stale box', () => {
    createTable(db, t('Autre', [f('A', 'shortText')]));
    saveRelationsLayout(db, { tables: { Clients: { x: 10, y: 20 }, Autre: { x: 300, y: 40 } } });
    expect(dropTable(db, 'Autre')).toEqual({ ok: true });
    expect(relationsLayout(db).tables).toEqual({ Clients: { x: 10, y: 20 } });
    // stale entries left by an older version or by a table another tool dropped
    saveRelationsLayout(db, { tables: { Clients: { x: 10, y: 20 }, Ancien: { x: 1, y: 1 }, Nouveau: { x: 2, y: 2 } } });
    renameTable(db, 'Commandes', 'Ancien'); // Commandes had no box: the stale one under the new name goes
    createTable(db, t('Nouveau', [f('A', 'shortText')]));
    expect(relationsLayout(db).tables).toEqual({ Clients: { x: 10, y: 20 } });
  });

  it('quoted, accented names', async () => {
    createTable(db, t('Prix "TTC" été', [f('Code été', 'shortText', { primaryKey: true })]));
    createTable(db, t('Lignes', [f('Réf "x"', 'shortText')]));
    raw(`INSERT INTO ${quoteIdent('Prix "TTC" été')} VALUES ('A')`);
    const r = saveRelation(db, { ...rel, parentTable: 'Prix "TTC" été', parentFields: ['Code été'], childTable: 'Lignes', childFields: ['Réf "x"'] }, null, fr);
    expect(r).toMatchObject({ ok: true, relation: { name: 'Prix "TTC" étéLignes' } });
    const lignes = tableDesign(db, 'Lignes');
    expect((await insertRow(db, lignes, { 'Réf "x"': 'A' }, fr, now)).ok).toBe(true);
    expect(await insertRow(db, lignes, { 'Réf "x"': 'B' }, fr, now)).toEqual({ ok: false, errors: [{ field: 'Réf "x"', code: 'noParent', table: 'Prix "TTC" été' }] });
  });
});

describe('relations (fix round 1)', () => {
  const hasTrigger = () => db.prepare(`SELECT 1 FROM sqlite_master WHERE type = 'trigger' AND name = 'audit'`).get() !== undefined;
  const addTrigger = () => db.exec(`CREATE TRIGGER audit AFTER INSERT ON "Commandes" BEGIN SELECT 1; END`);
  /** Another tool rebuilds Commandes with a FOREIGN KEY of its own (column names kept). */
  const addForeignKey = () => {
    db.exec('PRAGMA foreign_keys=OFF');
    db.exec('CREATE TABLE "X" ("k" REAL PRIMARY KEY)');
    db.exec(sqlOf('Commandes').replace(/^CREATE TABLE [^(]+\(/, 'CREATE TABLE "tmp" (').replace(/\)$/, ', FOREIGN KEY ("Montant") REFERENCES "X" ("k"))'));
    db.exec('INSERT INTO "tmp" SELECT * FROM "Commandes"; DROP TABLE "Commandes"; ALTER TABLE "tmp" RENAME TO "Commandes"');
    db.exec('PRAGMA foreign_keys=ON');
  };

  it('I1: deleting a relation whose child another tool changed (trigger) is refused, nothing lost', () => {
    saveRelation(db, rel, null, fr);
    addTrigger();
    expect(deleteRelation(db, 'ClientsCommandes', fr)).toEqual({ ok: false, reason: 'external', table: 'Commandes' });
    expect(hasTrigger()).toBe(true);
    expect(listRelations(db)).toHaveLength(1);
  });

  it('I1: deleting a relation whose child carries a foreign key of another tool is refused', () => {
    saveRelation(db, rel, null, fr);
    addForeignKey();
    expect(deleteRelation(db, 'ClientsCommandes', fr)).toEqual({ ok: false, reason: 'external', table: 'Commandes' });
    expect(sqlOf('Commandes')).toMatch(/REFERENCES "X"/);
  });

  it('I1: moving a relation to another child refuses when the old child is external', () => {
    saveRelation(db, rel, null, fr);
    createTable(db, t('Factures', [f('Client', 'number', { numberSize: 'longInteger' })]));
    addTrigger();
    expect(saveRelation(db, { ...rel, name: 'ClientsCommandes', childTable: 'Factures' }, 'ClientsCommandes', fr)).toEqual({ ok: false, reason: 'external', table: 'Commandes' });
    expect(hasTrigger()).toBe(true);
    expect(listRelations(db)[0]).toMatchObject({ childTable: 'Commandes' });
  });

  it('M1: decimal keys need the same precision and scale', () => {
    createTable(db, t('P', [f('K', 'number', { numberSize: 'decimal', precision: 18, scale: 2, primaryKey: true })]));
    createTable(db, t('C', [f('K', 'number', { numberSize: 'decimal', precision: 18, scale: 1 })]));
    const pc = { ...rel, parentTable: 'P', parentFields: ['K'], childTable: 'C', childFields: ['K'] };
    expect(saveRelation(db, pc, null, fr)).toEqual({ ok: false, reason: 'typesMismatch' });
    createTable(db, t('C2', [f('K', 'number', { numberSize: 'decimal', precision: 18, scale: 2 })]));
    expect(saveRelation(db, { ...pc, childTable: 'C2' }, null, fr)).toMatchObject({ ok: true });
  });

  it('M2: the identity rebuild copies values as they are; a relation stays deletable', () => {
    createTable(db, t('Lignes', [f('Client', 'number', { numberSize: 'longInteger' }), f('Note', 'shortText')]));
    raw(`INSERT INTO "Lignes" VALUES (1, ' x ')`); // edge spaces another tool wrote: a conversion would trim them
    const lr = { ...rel, childTable: 'Lignes' };
    expect(saveRelation(db, lr, null, fr)).toMatchObject({ ok: true });
    expect(deleteRelation(db, 'ClientsLignes', fr)).toEqual({ ok: true });
    expect(db.prepare('SELECT "Note" FROM "Lignes"').all()).toEqual([{ Note: ' x ' }]);
  });

  it('M2: a table whose rows do not fit its own design gives a typed refusal', () => {
    createTable(db, t('Lignes', [f('Client', 'number', { numberSize: 'longInteger' }), f('Note', 'shortText')]));
    raw(`INSERT INTO "Lignes" VALUES (1, NULL)`);
    raw(`UPDATE bc_fields SET props = json_set(props, '$.required', json('true')) WHERE table_name = 'Lignes' AND field_name = 'Note'`);
    expect(saveRelation(db, { ...rel, childTable: 'Lignes' }, null, fr)).toEqual({ ok: false, reason: 'external', table: 'Lignes' });
    expect(listRelations(db)).toEqual([]);
    expect(countRows(db, 'Lignes')).toBe(1);
  });

  it('M5: relation names follow the object-name rules', () => {
    for (const name of ['a.b', 'bc_x', ' x', 'x'.repeat(65), 'a[b]']) expect(saveRelation(db, { ...rel, name }, null, fr)).toEqual({ ok: false, reason: 'nameInvalid' });
    const long = (c: string) => t(c.repeat(60), [f('K', 'number', { numberSize: 'longInteger' }), f('K2', 'number', { numberSize: 'longInteger' })]);
    createTable(db, long('a'));
    const l = { ...rel, childTable: 'a'.repeat(60), childFields: ['K'], enforce: false };
    expect(saveRelation(db, l, null, fr)).toMatchObject({ ok: true, relation: { name: ('Clients' + 'a'.repeat(60)).slice(0, 64) } });
    const second = saveRelation(db, { ...l, childFields: ['K2'] }, null, fr);
    expect(second.ok && second.relation.name).toBe(('Clients' + 'a'.repeat(60)).slice(0, 63) + '1');
  });

  it('M7: reconcile drops a relation whose field is gone and no foreign key remains', () => {
    saveRelation(db, { ...rel, enforce: false }, null, fr);
    db.exec('ALTER TABLE "Commandes" DROP COLUMN "Client"');
    reconcile(db);
    expect(listRelations(db)).toEqual([]);
  });

  it('M7 (A2-R14): a child key column renamed by another tool is followed: SQLite moved the key, the relation follows it', async () => {
    saveRelation(db, rel, null, fr);
    db.exec('ALTER TABLE "Commandes" RENAME COLUMN "Client" TO "Cli"'); // SQLite rewrites the key to "Cli"
    expect(reconcile(db)).toMatchObject({ removedRelations: [], downgradedRelations: [], updatedRelations: ['ClientsCommandes'] });
    expect(listRelations(db)).toEqual([{ ...rel, name: 'ClientsCommandes', childFields: ['Cli'] }]);
    expect(dropTable(db, 'Clients')).toEqual({ ok: false, reason: 'hasRelations' }); // still a relation: delete it first
  });

  it('M7 (A2-R13): a parent dropped by another tool drops the relation row, reported; nothing sticky is stored', async () => {
    saveRelation(db, rel, null, fr);
    db.exec('PRAGMA foreign_keys=OFF; DROP TABLE "Clients"; PRAGMA foreign_keys=ON');
    expect(reconcile(db)).toMatchObject({ removedTables: ['Clients'], removedRelations: ['ClientsCommandes'], downgradedRelations: [] });
    expect(listRelations(db)).toEqual([]);
    const cm = tableDesign(db, 'Commandes');
    expect(cm.extra?.external).toBeUndefined();
    expect(await alterTable(db, 'Commandes', cm, identity(cm), opts)).toEqual({ ok: false, reason: 'external' }); // its leftover key
    expect(sqlOf('Commandes')).toMatch(/REFERENCES "Clients"/);
  });
});

describe('relations (fix round 2, A2-R13: the SQLite schema is the source of truth)', () => {

  describe('dropTable refuses a table that any real foreign key references', () => {
    it('a key left behind by a parent dropped and recreated by another tool (cascade): the children survive', () => {
      saveRelation(db, { ...rel, cascadeDelete: true }, null, fr);
      db.exec('PRAGMA foreign_keys=OFF; DROP TABLE "Clients"; PRAGMA foreign_keys=ON');
      expect(reconcile(db).removedRelations).toEqual(['ClientsCommandes']);
      db.exec('CREATE TABLE "Clients" ("N°" INTEGER PRIMARY KEY); INSERT INTO "Clients" VALUES (1), (2)'); // the other tool again
      expect(dropTable(db, 'Clients')).toEqual({ ok: false, reason: 'referenced', table: 'Commandes' });
      expect(countRows(db, 'Commandes')).toBe(2);
    });
    for (const action of ['CASCADE', 'SET NULL']) {
      it(`another tool's key ON DELETE ${action} (name in another case): nothing deleted or nulled`, () => {
        db.exec(`CREATE TABLE "Kids" ("c" INTEGER REFERENCES "clients" ("N°") ON DELETE ${action}); INSERT INTO "Kids" VALUES (1), (2)`);
        expect(dropTable(db, 'Clients')).toEqual({ ok: false, reason: 'referenced', table: 'Kids' });
        expect(db.prepare('SELECT "c" FROM "Kids"').all()).toEqual([{ c: 1 }, { c: 2 }]);
      });
    }
    it('a key of the table on itself does not block its drop', () => {
      db.exec('CREATE TABLE "Tree" ("id" INTEGER PRIMARY KEY, "up" INTEGER REFERENCES "Tree" ("id"))');
      expect(dropTable(db, 'Tree')).toEqual({ ok: true });
    });
  });

  it("alterTable renames first: another tool's key on the renamed parent follows it", async () => {
    db.exec('CREATE TABLE "ExtB" ("c" INTEGER REFERENCES "Clients" ("N°"))');
    const cl = tableDesign(db, 'Clients');
    expect(await alterTable(db, 'Clients', { ...cl, name: 'Personnes' }, identity(cl), opts)).toEqual({ ok: true });
    expect(sqlOf('ExtB')).toMatch(/REFERENCES "Personnes"/);
    raw('INSERT INTO "ExtB" VALUES (1)');
    expect(() => raw('INSERT INTO "ExtB" VALUES (99)')).toThrow(/FOREIGN KEY/);
  });

  it("BaseCraft's own tables stay managed through every operation (no false positive)", async () => {
    const check = (step: string) => expect({ step, external: externalTables() }).toEqual({ step, external: [] });
    check('create');
    expect(saveRelation(db, { ...rel, cascadeDelete: true }, null, fr).ok).toBe(true);
    createTable(db, t('Contacts', [f('Email', 'shortText')]));
    expect(saveRelation(db, { ...rel, parentFields: ['Email'], childTable: 'Contacts', childFields: ['Email'], cascadeUpdate: true }, null, fr).ok).toBe(true);
    check('relations');
    const before = stored();
    expect(reopen()).toEqual(EMPTY);
    expect(stored()).toEqual(before);
    check('reopen');
    for (const [a, b] of [['Clients', 'Été'], ['Été', 'été'], ['Commandes', 'commandes'], ['commandes', 'Prix "TTC"']]) {
      renameTable(db, a!, b!);
      check(`rename ${a} -> ${b}`);
    }
    expect(listRelations(db).map((r) => [r.parentTable, r.childTable])).toEqual([['été', 'Prix "TTC"'], ['été', 'Contacts']]);
    expect(saveRelation(db, { ...listRelations(db)[0]!, cascadeDelete: false, name: 'Achats' }, 'ClientsCommandes', fr)).toMatchObject({ ok: true });
    check('relation edit');
    let d = tableDesign(db, 'été');
    const alter = async (next: typeof d, mapping: FieldMapping[], step: string) => {
      expect(await alterTable(db, d.name, next, mapping, opts)).toEqual({ ok: true });
      d = tableDesign(db, next.name);
      check(step);
    };
    await alter({ ...d, fields: [...d.fields, f('Ville', 'shortText')] }, [...identity(d), { name: 'Ville', sourceName: null }], 'add field');
    const noAge = d.fields.filter((x) => x.name !== 'Âge');
    await alter({ ...d, fields: noAge }, identity({ fields: noAge }), 'drop field');
    const retyped = d.fields.map((x) => (x.name === 'Solde' ? f('Solde', 'number', { numberSize: 'double' }) : x));
    await alter({ ...d, fields: retyped }, identity(d), 'retype field');
    const reordered = [...d.fields].reverse();
    await alter({ ...d, fields: reordered }, identity({ fields: reordered }), 'reorder fields');
    await alter({ ...d, name: 'Personnes' }, identity(d), 'alter rename');
    const child = tableDesign(db, 'Prix "TTC"');
    expect(await alterTable(db, child.name, { ...child, fields: [...child.fields, f('Note', 'longText')] }, [...identity(child), { name: 'Note', sourceName: null }], opts)).toEqual({ ok: true });
    check('alter child');
    const texts: ImportTexts = {
      fieldPrefix: 'Champ', idName: 'N°', errorSuffix: '_Erreurs', errorFields: { error: 'Erreur', field: 'Champ', line: 'Ligne' }, messages: en.fieldError, log: en.importText.log,
    };
    const csv = path.join(dir, 'c.csv');
    fs.writeFileSync(csv, 'Client;Montant\n1;5\n99;6\n');
    const spec = previewText(csv, null, fr, 'Champ').spec;
    expect(await runImport(db, csv, { spec, target: { kind: 'new', table: 'Importée', primaryKey: { kind: 'auto' } } }, fr, texts)).toMatchObject({ ok: true });
    expect(await runImport(db, csv, { spec, target: { kind: 'append', table: 'Prix "TTC"', mapping: ['Client', 'Montant'] } }, fr, texts)).toMatchObject({ errors: 1 });
    check('text import');
    expect(deleteRelation(db, 'Achats', fr)).toEqual({ ok: true });
    expect(deleteRelation(db, 'ClientsContacts', fr)).toEqual({ ok: true });
    check('relation delete');
    expect(reopen()).toEqual(EMPTY);
    check('reopen 2');
    // A base written by A1 (format 1.0: neither bc_relations nor bc_objects), migrated on open.
    db.close();
    const old = path.join(dir, 'old.basecraft');
    createBaseFile(old, '0.1.0');
    const w = openBaseFile(old, 'write', '0.1.0').db;
    createTable(w, clients);
    createTable(w, commandes);
    w.close();
    const r10 = new DatabaseSync(old);
    r10.exec("DROP TABLE bc_relations; DROP TABLE bc_objects; UPDATE bc_meta SET value='0' WHERE key='format_minor'");
    r10.close();
    db = openBaseFile(old, 'write', '0.2.0').db;
    expect(reconcile(db)).toEqual(EMPTY);
    check('migrated 1.0');
    expect(saveRelation(db, rel, null, fr).ok).toBe(true);
    check('relation on migrated base');
    const migrated = stored();
    db.close();
    db = openBaseFile(old, 'write', '0.2.0').db;
    expect(reconcile(db)).toEqual(EMPTY);
    expect(stored()).toEqual(migrated);
  });

  describe('a change another tool made to a managed table makes it external: no rebuild loses it', () => {
    const cases: [string, (sql: string) => string][] = [
      ['table CHECK', (s) => s.replace(/\)$/, ', CHECK ("Montant" >= 0))')],
      ['DEFAULT', (s) => s.replace('"Montant" REAL', '"Montant" REAL DEFAULT 5')],
      ['COLLATE', (s) => s.replace('"Montant" REAL', '"Montant" REAL COLLATE NOCASE')],
      ['inline UNIQUE', (s) => s.replace('"Client" INTEGER', '"Client" INTEGER UNIQUE')],
      ['column type', (s) => s.replace('"Montant" REAL', '"Montant" TEXT')],
      ['STRICT', (s) => `${s} STRICT`],
      ['foreign key action', (s) => s.replace(/\)\)$/, ') ON DELETE SET NULL)')],
    ];
    for (const [what, edit] of cases) {
      it(what, () => {
        saveRelation(db, rel, null, fr);
        rebuildWith('Commandes', edit);
        const sql = sqlOf('Commandes');
        expect(externalTables()).toEqual(['Commandes']);
        expect(deleteRelation(db, 'ClientsCommandes', fr)).toEqual({ ok: false, reason: 'external', table: 'Commandes' });
        expect(sqlOf('Commandes')).toBe(sql);
      });
    }
    it('a generated column (hidden from table_info)', () => {
      saveRelation(db, rel, null, fr);
      db.exec('ALTER TABLE "Commandes" ADD COLUMN "Double" REAL GENERATED ALWAYS AS ("Montant" * 2) VIRTUAL');
      expect(deleteRelation(db, 'ClientsCommandes', fr)).toEqual({ ok: false, reason: 'external', table: 'Commandes' });
      expect(sqlOf('Commandes')).toMatch(/GENERATED/);
    });
    it('an index BaseCraft created, dropped by another tool; an index of another tool', async () => {
      db.exec('DROP INDEX "bcx_Clients.Email"');
      db.exec('CREATE INDEX "ix_other" ON "Commandes" ("Montant")');
      expect(externalTables()).toEqual(['Clients', 'Commandes']);
      const cl = tableDesign(db, 'Clients');
      expect(await alterTable(db, 'Clients', cl, identity(cl), opts)).toEqual({ ok: false, reason: 'external' });
    });
    it('adopted tables (A1 external fields) stay external', () => {
      db.exec('CREATE TABLE "Ext" ("a" TEXT)');
      reconcile(db);
      expect(externalTables()).toEqual(['Ext']);
    });
  });

  describe('reconcile', () => {
    it('matches foreign keys and fields ignoring case, and follows the live names', () => {
      saveRelation(db, rel, null, fr);
      db.exec('ALTER TABLE "Commandes" RENAME COLUMN "Client" TO "client"');
      expect(reconcile(db)).toMatchObject({ removedRelations: [], downgradedRelations: [] });
      expect(listRelations(db)).toEqual([{ ...rel, name: 'ClientsCommandes', childFields: ['client'] }]);
      expect(externalTables()).toEqual([]);
      expect(dropTable(db, 'Clients')).toEqual({ ok: false, reason: 'hasRelations' });
    });
    it('an enforced relation whose key another tool removed is kept without integrity, reported', () => {
      saveRelation(db, rel, null, fr);
      rebuildWith('Commandes', (s) => s.replace(/, FOREIGN KEY .*\)$/, ')'));
      expect(reconcile(db)).toMatchObject({ removedRelations: [], downgradedRelations: ['ClientsCommandes'] });
      expect(listRelations(db)).toEqual([{ ...rel, name: 'ClientsCommandes', enforce: false }]);
      expect(externalTables()).toEqual([]);
      expect(deleteRelation(db, 'ClientsCommandes', fr)).toEqual({ ok: true });
    });
    it("a key swapped for another tool's: the relation loses its integrity, the table is external, the other key is kept", () => {
      saveRelation(db, rel, null, fr);
      db.exec('CREATE TABLE "X" ("k" REAL PRIMARY KEY)');
      rebuildWith('Commandes', (s) => s.replace(/FOREIGN KEY .*\)$/, 'FOREIGN KEY ("Montant") REFERENCES "X" ("k"))'));
      expect(reconcile(db).downgradedRelations).toEqual(['ClientsCommandes']);
      expect(externalTables()).toEqual(['Commandes', 'X']);
      expect(deleteRelation(db, 'ClientsCommandes', fr)).toEqual({ ok: true }); // no key change: no rebuild
      expect(sqlOf('Commandes')).toMatch(/REFERENCES "X"/);
    });
    it('an intact relation without integrity is left alone (no key expected)', () => {
      saveRelation(db, { ...rel, enforce: false }, null, fr);
      expect(reconcile(db)).toMatchObject({ removedRelations: [], downgradedRelations: [] });
      expect(listRelations(db)).toEqual([{ ...rel, name: 'ClientsCommandes', enforce: false }]);
    });
    it('a relation without integrity whose field is gone is dropped', () => {
      saveRelation(db, { ...rel, enforce: false }, null, fr);
      db.exec('ALTER TABLE "Clients" RENAME COLUMN "N°" TO "Id"');
      expect(reconcile(db).removedRelations).toEqual(['ClientsCommandes']);
    });
  });

  it('a relation without integrity can be deleted or edited whatever its tables', () => {
    saveRelation(db, { ...rel, enforce: false }, null, fr);
    db.exec(`CREATE TRIGGER audit AFTER INSERT ON "Commandes" BEGIN SELECT 1; END`);
    expect(saveRelation(db, { ...rel, enforce: false, name: 'Autre', joinType: 2 }, 'ClientsCommandes', fr)).toMatchObject({ ok: true });
    expect(deleteRelation(db, 'Autre', fr)).toEqual({ ok: true });
    expect(db.prepare(`SELECT 1 FROM sqlite_master WHERE name = 'audit'`).get()).toBeDefined();
  });

  it('a view of another tool on the table does not block its rebuild; a rebuild that would break it is refused, typed', async () => {
    saveRelation(db, rel, null, fr);
    db.exec('CREATE VIEW "V" AS SELECT "Client", "Montant" FROM "Commandes"');
    expect(deleteRelation(db, 'ClientsCommandes', fr)).toEqual({ ok: true });
    const cm = tableDesign(db, 'Commandes');
    expect(await alterTable(db, 'Commandes', { ...cm, fields: [...cm.fields, f('X', 'shortText')] }, [...identity(cm), { name: 'X', sourceName: null }], opts))
      .toEqual({ ok: true });
    expect(db.prepare('SELECT count(*) AS n FROM "V"').get()).toEqual({ n: 2 });
    const c2 = tableDesign(db, 'Commandes');
    const noMontant = c2.fields.filter((x) => x.name !== 'Montant');
    expect(await alterTable(db, 'Commandes', { ...c2, fields: noMontant }, identity({ fields: noMontant }), { ...opts, allowDataLoss: true }))
      .toEqual({ ok: false, reason: 'viewBroken', view: 'V' });
    expect(sqlOf('Commandes')).toMatch(/"Montant"/);
    expect((db.prepare('PRAGMA foreign_keys').get() as { foreign_keys: number }).foreign_keys).toBe(1);
    expect(db.isTransaction).toBe(false);
  });
});

/** The report of a reconcile that found nothing changed outside BaseCraft. */
const EMPTY = { addedTables: [], removedTables: [], addedFields: [], removedFields: [], removedRelations: [], downgradedRelations: [], updatedRelations: [] };
const stored = () => db.prepare('SELECT name, props FROM bc_relations ORDER BY name').all();

const texts: ImportTexts = {
  fieldPrefix: 'Champ', idName: 'N°', errorSuffix: '_Erreurs', errorFields: { error: 'Erreur', field: 'Champ', line: 'Ligne' }, messages: en.fieldError, log: en.importText.log,
};
const csvFile = (name: string, data: string) => { const p = path.join(dir, name); fs.writeFileSync(p, data); return p; };

describe('relations (fix round 3, A2-R14: the real foreign keys decide)', () => {
  const n = (table: string) => countRows(db, table);

  describe('tables whose names differ only in non-ASCII case (another tool made the twin)', () => {
    beforeEach(() => {
      createTable(db, t('Été', [f('N°', 'autoNumber'), f('Nom', 'shortText', { caption: 'Le nom' })]));
      raw(`INSERT INTO "Été" ("Nom") VALUES ('mine')`);
      db.exec(`CREATE TABLE "été" ("x" TEXT); INSERT INTO "été" VALUES ('keep')`);
    });
    it('drop and rename act on the exact table', () => {
      expect(dropTable(db, 'été')).toEqual({ ok: true });
      expect(listTables(db).map((x) => x.name)).toContain('Été');
      expect(n('Été')).toBe(1);
      db.exec(`CREATE TABLE "été" ("x" TEXT); INSERT INTO "été" VALUES ('keep')`);
      renameTable(db, 'été', 'Autre');
      expect(listTables(db).map((x) => x.name)).toEqual(expect.arrayContaining(['Autre', 'Été']));
      expect(tableDesign(db, 'Été').fields.map((x) => x.name)).toEqual(['N°', 'Nom']);
    });
    it('the design, a datasheet delete and an import append use the exact table', async () => {
      expect(tableDesign(db, 'été').fields.map((x) => x.name)).toEqual(['x']);
      expect(tableDesign(db, 'Été').fields[1]!.props.caption).toBe('Le nom');
      expect(deleteRows(db, tableDesign(db, 'été').name, [1])).toEqual({ ok: true, count: 1 });
      expect([n('été'), n('Été')]).toEqual([0, 1]);
      const p = csvFile('t.csv', 'x\nnew\n');
      expect(await runImport(db, p, { spec: previewText(p, null, fr, 'Champ').spec, target: { kind: 'append', table: 'été', mapping: ['x'] } }, fr, texts))
        .toMatchObject({ ok: true, imported: 1 });
      expect([n('été'), n('Été')]).toEqual([1, 1]);
    });
    it('reconcile never maps the twin onto the managed table metadata', () => {
      const r = reconcile(db);
      expect(r).toMatchObject({ addedTables: ['été'], removedTables: [], removedFields: [] });
      expect(r.addedFields).toEqual([]);
      const d = tableDesign(db, 'Été');
      expect(d.fields[1]!.props.caption).toBe('Le nom');
      expect(isExternal(db, d)).toBe(false);
      expect(isExternal(db, tableDesign(db, 'été'))).toBe(true);
      expect(reconcile(db)).toMatchObject({ addedTables: [], removedTables: [], addedFields: [], removedFields: [] });
    });
    it("altering the managed table keeps its metadata and leaves the twin's alone", async () => {
      reconcile(db);
      const d = tableDesign(db, 'Été');
      expect(await alterTable(db, 'Été', { ...d, fields: [...d.fields, f('Ville', 'shortText')] }, [...identity(d), { name: 'Ville', sourceName: null }], opts))
        .toEqual({ ok: true });
      expect(tableDesign(db, 'Été').fields[1]!.props.caption).toBe('Le nom');
      expect(tableDesign(db, 'été').fields).toEqual([{ name: 'x', props: expect.objectContaining({ external: true }) }]);
      expect(db.prepare(`SELECT count(*) AS n FROM bc_tables WHERE name = 'été'`).get()).toEqual({ n: 1 });
      expect(reconcile(db)).toMatchObject({ addedTables: [], removedTables: [], addedFields: [], removedFields: [] });
    });
    it("dropping the managed table is refused when its twin's key references it (no cascade into the twin)", () => {
      db.exec(`CREATE TABLE "éTÉ" ("ref" INTEGER REFERENCES "Été" ("N°") ON DELETE CASCADE); INSERT INTO "éTÉ" VALUES (1)`);
      expect(dropTable(db, 'Été')).toEqual({ ok: false, reason: 'referenced', table: 'éTÉ' });
      expect(n('éTÉ')).toBe(1);
    });
  });

  describe('reconcile syncs enforced relations from the real keys', () => {
    it('a parent renamed by another tool: the relation follows it, the child stays managed', () => {
      saveRelation(db, { ...rel, cascadeDelete: true }, null, fr);
      db.exec('ALTER TABLE "Clients" RENAME TO "Kunden"');
      expect(reconcile(db)).toMatchObject({ removedRelations: [], updatedRelations: ['ClientsCommandes'] });
      expect(listRelations(db)).toEqual([{ ...rel, name: 'ClientsCommandes', parentTable: 'Kunden', cascadeDelete: true }]);
      expect(isExternal(db, tableDesign(db, 'Commandes'))).toBe(false);
      expect(cascadeChildren(db, 'Kunden')).toEqual([{ table: 'Commandes', effect: 'deleted' }]);
    });
    it('a child renamed by another tool: the relation follows it', () => {
      saveRelation(db, rel, null, fr);
      db.exec('ALTER TABLE "Commandes" RENAME TO "Orders"');
      expect(reconcile(db)).toMatchObject({ removedRelations: [], updatedRelations: ['ClientsCommandes'] });
      expect(listRelations(db)[0]).toMatchObject({ parentTable: 'Clients', childTable: 'Orders', enforce: true });
    });
    it('changed ON DELETE / ON UPDATE actions are copied into the relation', () => {
      saveRelation(db, rel, null, fr);
      db.exec('PRAGMA foreign_keys=OFF');
      db.exec(sqlOf('Commandes').replace(/^CREATE TABLE [^(]+\(/, 'CREATE TABLE "tmp_other" (').replace(/\)\)$/, ') ON UPDATE CASCADE ON DELETE CASCADE)'));
      db.exec('INSERT INTO "tmp_other" SELECT * FROM "Commandes"; DROP TABLE "Commandes"; ALTER TABLE "tmp_other" RENAME TO "Commandes"');
      db.exec('PRAGMA foreign_keys=ON');
      expect(reconcile(db)).toMatchObject({ updatedRelations: ['ClientsCommandes'] });
      expect(listRelations(db)).toEqual([{ ...rel, name: 'ClientsCommandes', cascadeDelete: true, cascadeUpdate: true }]);
      expect(isExternal(db, tableDesign(db, 'Commandes'))).toBe(false); // the generated key is that one again
      expect(reconcile(db).updatedRelations).toEqual([]);
    });
  });

  it('the cascade warning comes from the real keys', () => {
    expect(cascadeChildren(db, 'Clients')).toEqual([]);
    saveRelation(db, rel, null, fr);
    expect(cascadeChildren(db, 'Clients')).toEqual([]);
    db.exec(`CREATE TABLE "Notes" ("c" INTEGER REFERENCES "clients" ("N°") ON DELETE CASCADE)`);
    expect(cascadeChildren(db, 'Clients')).toEqual([{ table: 'Notes', effect: 'deleted' }]);
  });

  describe("another tool's key on a managed table: typed refusals, never raw errors", () => {
    beforeEach(() => {
      db.exec(`CREATE TABLE "Kids" ("e" TEXT REFERENCES "Clients" ("Email")); INSERT INTO "Kids" VALUES ('ana@x')`);
    });
    it('alterTable: the referenced field cannot be dropped, retyped, renamed or lose its uniqueness', async () => {
      const cl = tableDesign(db, 'Clients');
      const refused = { ok: false, reason: 'relationField', field: 'Email', relation: '', table: 'Kids' };
      const loose = cl.fields.map((x) => (x.name === 'Email' ? { ...x, props: { ...x.props, indexed: 'no' as const } } : x));
      expect(await alterTable(db, 'Clients', { ...cl, fields: loose }, identity(cl), opts)).toEqual(refused);
      const noEmail = cl.fields.filter((x) => x.name !== 'Email');
      expect(await alterTable(db, 'Clients', { ...cl, fields: noEmail }, identity({ fields: noEmail }), { ...opts, allowDataLoss: true })).toEqual(refused);
      const retyped = cl.fields.map((x) => (x.name === 'Email' ? f('Email', 'number', { indexed: 'yesNoDuplicates' }) : x));
      expect(await alterTable(db, 'Clients', { ...cl, fields: retyped }, identity(cl), { ...opts, allowDataLoss: true })).toEqual(refused);
      const renamed = cl.fields.map((x) => (x.name === 'Email' ? { ...x, name: 'Mail' } : x));
      expect(await alterTable(db, 'Clients', { ...cl, fields: renamed }, cl.fields.map((x) => ({ name: x.name === 'Email' ? 'Mail' : x.name, sourceName: x.name })), opts))
        .toEqual(refused);
      expect(await alterTable(db, 'Clients', { ...cl, fields: [...cl.fields, f('Ville', 'shortText')] }, [...identity(cl), { name: 'Ville', sourceName: null }], opts))
        .toEqual({ ok: true });
    });
    it('write layer: noParent and related come from the real keys', async () => {
      expect(deleteRows(db, 'Clients', [1])).toEqual({ ok: false, reason: 'related', table: 'Kids' });
      expect(await insertRow(db, tableDesign(db, 'Kids'), { e: 'zz@x' }, fr, now)).toEqual({ ok: false, errors: [{ field: 'e', code: 'noParent', table: 'Clients' }] });
      expect(await updateRow(db, tableDesign(db, 'Clients'), 1, { Email: 'new@x' }, fr, now)).toEqual({ ok: false, errors: [{ field: 'Email', code: 'related', table: 'Kids' }] });
    });
    it('dropTable names the referencing table, without speaking of relationships', () => {
      expect(dropTable(db, 'Clients')).toEqual({ ok: false, reason: 'referenced', table: 'Kids' });
    });
  });

  it('a broken view elsewhere blocks no rebuild, and a rename that SQLite refuses for it is typed', async () => {
    createTable(db, t('Tmp', [f('a', 'shortText')]));
    db.exec('CREATE VIEW "VV" AS SELECT "a" FROM "Tmp"');
    expect(dropTable(db, 'Tmp')).toEqual({ ok: true }); // VV is now broken
    const cm = tableDesign(db, 'Commandes');
    expect(await alterTable(db, 'Commandes', { ...cm, fields: [...cm.fields, f('X', 'shortText')] }, [...identity(cm), { name: 'X', sourceName: null }], opts))
      .toEqual({ ok: true });
    expect(saveRelation(db, rel, null, fr)).toMatchObject({ ok: true });
    expect(() => renameTable(db, 'Clients', 'Personnes')).toThrow(ViewBrokenError);
    try { renameTable(db, 'Clients', 'Personnes'); } catch (e) { expect((e as ViewBrokenError).view).toBe('VV'); }
    const cl = tableDesign(db, 'Clients');
    expect(await alterTable(db, 'Clients', { ...cl, name: 'Personnes' }, identity(cl), opts)).toEqual({ ok: false, reason: 'viewBroken', view: 'VV' });
    expect(listTables(db).map((x) => x.name)).toContain('Clients');
  });

  it("renaming an external table keeps another tool's change to a bcx_ index", () => {
    db.exec(`DROP INDEX "bcx_Clients.Email"; CREATE UNIQUE INDEX "bcx_Clients.Email" ON "Clients" ("Email" COLLATE NOCASE) WHERE "Email" <> ''`);
    expect(isExternal(db, tableDesign(db, 'Clients'))).toBe(true);
    renameTable(db, 'Clients', 'Contacts');
    const sql = (db.prepare(`SELECT sql FROM sqlite_master WHERE type = 'index' AND tbl_name = 'Contacts'`).all() as { sql: string }[]).map((x) => x.sql);
    expect(sql).toHaveLength(1);
    expect(sql[0]).toMatch(/COLLATE NOCASE\) WHERE/);
  });

  describe('a name a dangling key references (its parent was dropped by another tool) is refused, naming the referencing table', () => {
    beforeEach(() => {
      db.exec('CREATE TABLE "Ghost" ("id" INTEGER PRIMARY KEY); CREATE TABLE "Orph" ("g" INTEGER REFERENCES "Ghost" ("id") ON DELETE CASCADE)');
      db.exec('INSERT INTO "Ghost" VALUES (1); INSERT INTO "Orph" VALUES (1), (1)');
      db.exec('PRAGMA foreign_keys=OFF; DROP TABLE "Ghost"; PRAGMA foreign_keys=ON');
    });
    const refusal = (fn: () => unknown) => {
      try { fn(); } catch (e) { return e instanceof DanglingKeyError ? e.table : e; }
      return 'accepted';
    };
    it('createTable, renameTable, alterTable rename and a text import into a new table', async () => {
      expect(refusal(() => createTable(db, t('Ghost', [f('id', 'autoNumber')])))).toBe('Orph');
      expect(refusal(() => createTable(db, t('ghost', [f('id', 'autoNumber')])))).toBe('Orph');
      expect(refusal(() => renameTable(db, 'Clients', 'Ghost'))).toBe('Orph');
      const cl = tableDesign(db, 'Clients');
      expect(await alterTable(db, 'Clients', { ...cl, name: 'Ghost' }, identity(cl), opts)).toEqual({ ok: false, reason: 'danglingKey', table: 'Orph' });
      const p = csvFile('g.csv', 'v\n1\n');
      expect(await runImport(db, p, { spec: previewText(p, null, fr, 'Champ').spec, target: { kind: 'new', table: 'Ghost', primaryKey: { kind: 'auto' } } }, fr, texts))
        .toEqual({ ok: false, reason: 'danglingKey', table: 'Orph' });
      expect(n('Orph')).toBe(2);
      expect(listTables(db).map((x) => x.name)).not.toContain('Ghost');
    });
  });
});

describe('relations (fix round 4, A2-R15: one real key per relation, exact match first)', () => {
  const fournisseurs = t('Fournisseurs', [f('N°', 'autoNumber'), f('Nom', 'shortText')]);
  const byFournisseur: Relation = { ...rel, parentTable: 'Fournisseurs' };
  beforeEach(async () => {
    createTable(db, fournisseurs);
    for (const nom of ['F1', 'F2']) expect((await insertRow(db, fournisseurs, { Nom: nom }, fr, now)).ok).toBe(true);
  });

  it('guard: on a base only BaseCraft touched, a reopen reports nothing and leaves bc_relations byte-identical', () => {
    expect(saveRelation(db, rel, null, fr)).toMatchObject({ ok: true, relation: { name: 'ClientsCommandes' } });
    expect(saveRelation(db, { ...byFournisseur, cascadeDelete: true }, null, fr)).toMatchObject({ ok: true, relation: { name: 'FournisseursCommandes' } });
    createTable(db, t('Contacts', [f('Email', 'shortText')]));
    expect(saveRelation(db, { ...rel, parentFields: ['Email'], childTable: 'Contacts', childFields: ['Email'], cascadeUpdate: true }, null, fr).ok).toBe(true);
    expect(saveRelation(db, { ...rel, name: 'Libre', childFields: ['N°'], enforce: false }, null, fr).ok).toBe(true);
    const before = stored();
    expect(reopen()).toEqual(EMPTY);
    expect(stored()).toEqual(before);
    expect(externalTables()).toEqual([]);
    expect(reopen()).toEqual(EMPTY);
    expect(stored()).toEqual(before);
  });

  it('two relations on one child column with different parents keep their own key through a reopen', () => {
    saveRelation(db, rel, null, fr);
    saveRelation(db, { ...byFournisseur, cascadeDelete: true }, null, fr);
    expect(reopen()).toEqual(EMPTY);
    expect(listRelations(db)).toEqual([{ ...rel, name: 'ClientsCommandes' }, { ...byFournisseur, name: 'FournisseursCommandes', cascadeDelete: true }]);
    expect(externalTables()).toEqual([]);
    expect(deleteRelation(db, 'ClientsCommandes', fr)).toEqual({ ok: true });
    expect(sqlOf('Commandes')).not.toMatch(/REFERENCES "Clients"/);
    expect(sqlOf('Commandes')).toMatch(/REFERENCES "Fournisseurs" \("N°"\) ON DELETE CASCADE/);
    expect(reopen()).toEqual(EMPTY);
    expect(deleteRelation(db, 'FournisseursCommandes', fr)).toEqual({ ok: true });
    expect(sqlOf('Commandes')).not.toMatch(/FOREIGN KEY/);
  });

  for (const dup of ['Aaa', 'Zzz']) {
    it(`legacy duplicate relations (saved before duplicates were refused) keep their own key and flags (${dup})`, () => {
      saveRelation(db, rel, null, fr);
      const { name: _n, ...props } = { ...rel, cascadeDelete: true };
      raw('INSERT INTO bc_relations (name, props) VALUES (?, ?)', dup, JSON.stringify(props));
      expect(withForeignKeysOff(db, () => rebuildSame(db, 'Commandes', fr), () => ['Commandes'])).toEqual({ ok: true });
      expect(sqlOf('Commandes').match(/FOREIGN KEY/g)).toHaveLength(2);
      const before = stored();
      expect(reopen()).toEqual(EMPTY);
      expect(stored()).toEqual(before);
      expect(externalTables()).toEqual([]);
    });
  }

  it('sibling children of one parent: another tool renames one child, only its relation follows', () => {
    createTable(db, t('Factures', [f('Client', 'number', { numberSize: 'longInteger' })]));
    saveRelation(db, rel, null, fr);
    saveRelation(db, { ...rel, childTable: 'Factures', cascadeDelete: true }, null, fr);
    db.exec('ALTER TABLE "Commandes" RENAME TO "Orders"');
    expect(reopen()).toMatchObject({ removedRelations: [], downgradedRelations: [], updatedRelations: ['ClientsCommandes'] });
    expect(listRelations(db)).toEqual([
      { ...rel, name: 'ClientsCommandes', childTable: 'Orders' },
      { ...rel, name: 'ClientsFactures', childTable: 'Factures', cascadeDelete: true },
    ]);
    expect(isExternal(db, tableDesign(db, 'Factures'))).toBe(false);
    expect(deleteRelation(db, 'ClientsFactures', fr)).toEqual({ ok: true });
  });

  it("a child renamed by another tool is followed even beside another tool's key to the same parent (only the new table fits)", () => {
    db.exec('CREATE TABLE "Notes" ("c" INTEGER REFERENCES "Clients" ("N°"))');
    reconcile(db);
    saveRelation(db, rel, null, fr);
    db.exec('ALTER TABLE "Commandes" RENAME TO "Orders"');
    expect(reopen()).toMatchObject({ removedRelations: [], downgradedRelations: [], updatedRelations: ['ClientsCommandes'] });
    expect(listRelations(db)).toEqual([{ ...rel, name: 'ClientsCommandes', childTable: 'Orders' }]);
  });

  it('a key replaced by another tool: the relation loses its integrity, the other key and its cascade are kept', async () => {
    const cm = tableDesign(db, 'Commandes');
    const more = { ...cm, fields: [...cm.fields, f('Livraison', 'number', { numberSize: 'longInteger' })] };
    expect(await alterTable(db, 'Commandes', more, [...identity(cm), { name: 'Livraison', sourceName: null }], opts)).toEqual({ ok: true });
    saveRelation(db, { ...rel, name: 'Facturation' }, null, fr);
    rebuildWith('Commandes', (s) => s.replace(/FOREIGN KEY .*\)$/, 'FOREIGN KEY ("Livraison") REFERENCES "Clients" ON DELETE CASCADE)'));
    expect(reopen()).toMatchObject({ removedRelations: [], downgradedRelations: ['Facturation'], updatedRelations: [] });
    expect(listRelations(db)).toEqual([{ ...rel, name: 'Facturation', enforce: false }]);
    expect(deleteRelation(db, 'Facturation', fr)).toEqual({ ok: true });
    expect(sqlOf('Commandes')).toMatch(/FOREIGN KEY \("Livraison"\) REFERENCES "Clients" ON DELETE CASCADE/);
    expect(cascadeChildren(db, 'Clients')).toEqual([{ table: 'Commandes', effect: 'deleted' }]);
  });

  it('a key retargeted to another parent while the old parent still exists: downgraded, never rebound', () => {
    createTable(db, t('Autres', [f('K', 'autoNumber')]));
    saveRelation(db, rel, null, fr);
    rebuildWith('Commandes', (s) => s.replace('REFERENCES "Clients" ("N°")', 'REFERENCES "Autres" ("K")'));
    expect(sqlOf('Commandes')).toMatch(/REFERENCES "Autres"/);
    expect(reopen()).toMatchObject({ removedRelations: [], downgradedRelations: ['ClientsCommandes'], updatedRelations: [] });
    expect(listRelations(db)).toEqual([{ ...rel, name: 'ClientsCommandes', enforce: false }]);
  });

  it('relations without integrity: a change by another tool is reported; a case-only table rename is followed', () => {
    saveRelation(db, { ...rel, enforce: false }, null, fr);
    db.exec('ALTER TABLE "Commandes" RENAME COLUMN "Client" TO "client"');
    expect(reopen()).toMatchObject({ updatedRelations: ['ClientsCommandes'] });
    expect(listRelations(db)[0]).toMatchObject({ childFields: ['client'], enforce: false });
    db.exec('ALTER TABLE "Clients" RENAME TO "tmp_x"; ALTER TABLE "tmp_x" RENAME TO "clients"');
    expect(reopen()).toMatchObject({ removedRelations: [], updatedRelations: ['ClientsCommandes'] });
    expect(listRelations(db)[0]).toMatchObject({ parentTable: 'clients' });
  });

  it("a twin of a table another tool dropped never takes that table's relation", () => {
    createTable(db, t('Été', [f('N°', 'autoNumber')]));
    db.exec('CREATE TABLE "été" ("N°" INTEGER)');
    reconcile(db);
    expect(saveRelation(db, { ...rel, name: 'RP', parentTable: 'Été', enforce: false }, null, fr)).toMatchObject({ ok: true });
    db.exec('DROP TABLE "Été"');
    expect(reopen()).toMatchObject({ removedTables: ['Été'], removedRelations: ['RP'] });
    expect(listRelations(db)).toEqual([]);
    expect(dropTable(db, 'été')).toEqual({ ok: true });
  });

  it('a duplicate relation (same tables and fields) is refused, as in Access', () => {
    expect(saveRelation(db, rel, null, fr)).toMatchObject({ ok: true });
    const dup = { ok: false, reason: 'duplicate', relation: 'ClientsCommandes' };
    expect(saveRelation(db, { ...rel, name: 'Bis', cascadeDelete: true }, null, fr)).toEqual(dup);
    expect(saveRelation(db, { ...rel, enforce: false, parentTable: 'clients', childFields: ['client'] }, null, fr)).toEqual(dup);
    expect(saveRelation(db, { ...rel, name: 'ClientsCommandes', cascadeDelete: true }, 'ClientsCommandes', fr)).toMatchObject({ ok: true }); // itself
    expect(saveRelation(db, byFournisseur, null, fr)).toMatchObject({ ok: true }); // another parent
    expect(saveRelation(db, { ...rel, name: 'FournisseursCommandes' }, 'FournisseursCommandes', fr)).toEqual(dup);
    expect(listRelations(db)).toHaveLength(2);
  });

  it('saveRelation compares twins exactly: a relation cannot slip onto the twin of another tool', () => {
    createTable(db, t('Été', [f('Client', 'number', { numberSize: 'longInteger' })]));
    db.exec('CREATE TABLE "été" ("Client" INTEGER); INSERT INTO "été" VALUES (99)');
    reconcile(db);
    expect(saveRelation(db, { ...rel, name: 'RT', childTable: 'Été' }, null, fr)).toMatchObject({ ok: true });
    expect(saveRelation(db, { ...rel, name: 'RT', childTable: 'été' }, 'RT', fr)).toEqual({ ok: false, reason: 'external', table: 'été' });
    expect(sqlOf('Été')).toMatch(/FOREIGN KEY/);
    expect(saveRelation(db, { ...rel, parentTable: 'Été', parentFields: ['Client'], childTable: 'été', enforce: false }, null, fr))
      .toEqual({ ok: false, reason: 'external', table: 'été' }); // two tables, not sameTable
  });

  it("relationField names a relation only by a full match: another tool's key on the same child field is no relation", async () => {
    saveRelation(db, rel, null, fr);
    rebuildWith('Commandes', (s) => s.replace(/\)$/, ', FOREIGN KEY ("Client") REFERENCES "Clients" ("Email"))'));
    const cl = tableDesign(db, 'Clients');
    const loose = cl.fields.map((x) => (x.name === 'Email' ? { ...x, props: { ...x.props, indexed: 'no' as const } } : x));
    expect(await alterTable(db, 'Clients', { ...cl, fields: loose }, identity(cl), opts))
      .toEqual({ ok: false, reason: 'relationField', field: 'Email', relation: '', table: 'Commandes' });
  });

  it('updateRow: a refusal on the parent side is related on the parent key, never noParent on an untouched child column', async () => {
    db.exec(`CREATE TABLE "P" ("id" INTEGER PRIMARY KEY); CREATE TABLE "C" ("ref" TEXT PRIMARY KEY, "pid" INTEGER REFERENCES "P" ("id"));
      CREATE TABLE "L" ("r" TEXT REFERENCES "C" ("ref"))`);
    db.exec(`INSERT INTO "P" VALUES (1); INSERT INTO "C" VALUES ('a', 1); INSERT INTO "L" VALUES ('a')`);
    db.exec('PRAGMA foreign_keys=OFF; DELETE FROM "P"; PRAGMA foreign_keys=ON'); // an orphan another tool wrote
    reconcile(db);
    expect(await updateRow(db, tableDesign(db, 'C'), 1, { ref: 'b' }, fr, now)).toEqual({ ok: false, errors: [{ field: 'ref', code: 'related', table: 'L' }] });
    expect(await updateRow(db, tableDesign(db, 'C'), 1, { pid: '7' }, fr, now)).toEqual({ ok: false, errors: [{ field: 'pid', code: 'noParent', table: 'P' }] });
  });

  it('cascadeChildren: CASCADE deletes, SET NULL and SET DEFAULT modify; SET NULL into a NOT NULL column is a typed refusal', () => {
    db.exec(`CREATE TABLE "Notes" ("c" INTEGER REFERENCES "Clients" ("N°") ON DELETE CASCADE);
      CREATE TABLE "Kids" ("c" INTEGER REFERENCES "clients" ("N°") ON DELETE SET NULL);
      CREATE TABLE "Pets" ("c" INTEGER DEFAULT 0 REFERENCES "Clients" ("N°") ON DELETE SET DEFAULT)`);
    expect(cascadeChildren(db, 'Clients')).toEqual([
      { table: 'Kids', effect: 'modified' }, { table: 'Notes', effect: 'deleted' }, { table: 'Pets', effect: 'modified' },
    ]);
    db.exec(`CREATE TABLE "Strict" ("c" INTEGER NOT NULL REFERENCES "Clients" ("N°") ON DELETE SET NULL); INSERT INTO "Strict" VALUES (1)`);
    expect(deleteRows(db, 'Clients', [1])).toEqual({ ok: false, reason: 'related', table: 'Strict' });
    expect(countRows(db, 'Clients')).toBe(2);
  });

  it("the import's error table skips a name a dangling key targets", async () => {
    db.exec('CREATE TABLE "Ghost_Erreurs" ("id" INTEGER PRIMARY KEY); CREATE TABLE "Orph" ("g" INTEGER REFERENCES "Ghost_Erreurs" ("id"))');
    db.exec('PRAGMA foreign_keys=OFF; DROP TABLE "Ghost_Erreurs"; PRAGMA foreign_keys=ON');
    createTable(db, t('Ghost', [f('n', 'number', { numberSize: 'longInteger' })]));
    const p = csvFile('g.csv', 'n\nabc\n');
    expect(await runImport(db, p, { spec: previewText(p, null, fr, 'Champ').spec, target: { kind: 'append', table: 'Ghost', mapping: ['n'] } }, fr, texts))
      .toMatchObject({ ok: true, errors: 1 });
    expect(listTables(db).map((x) => x.name)).toContain('Ghost_Erreurs1');
  });
});

describe('relations (fix round 5)', () => {
  const long = (name: string, more: Partial<FieldDef['props']> = {}) => f(name, 'number', { numberSize: 'longInteger', ...more });

  describe('a refusal names the table the failing chain reaches, never an unrelated sibling', () => {
    it('delete: a cascade stopped by a grandchild names the grandchild', () => {
      createTable(db, t('Adresses', [long('Client'), f('Mail', 'shortText')]));
      createTable(db, t('Lignes', [long('Commande')]));
      raw('INSERT INTO "Adresses" ("Client") VALUES (2)');
      raw('INSERT INTO "Lignes" VALUES (1)'); // order 1 is client 1's
      expect(saveRelation(db, { ...rel, childTable: 'Adresses' }, null, fr).ok).toBe(true);
      expect(saveRelation(db, { ...rel, cascadeDelete: true }, null, fr).ok).toBe(true);
      expect(saveRelation(db, { ...rel, parentTable: 'Commandes', childTable: 'Lignes', childFields: ['Commande'] }, null, fr).ok).toBe(true);
      expect(deleteRows(db, 'Clients', [1])).toEqual({ ok: false, reason: 'related', table: 'Lignes' });
      expect(deleteRows(db, 'Clients', [2])).toEqual({ ok: false, reason: 'related', table: 'Adresses' });
      expect(countRows(db, 'Commandes')).toBe(2);
    });
    it('update: a cascade update stopped by a grandchild names the grandchild', async () => {
      createTable(db, t('Adresses', [f('Mail', 'shortText')]));
      createTable(db, t('Contacts', [f('Email', 'shortText', { indexed: 'yesNoDuplicates' })]));
      createTable(db, t('Notes', [f('Mail', 'shortText')]));
      raw(`INSERT INTO "Contacts" VALUES ('ana@x')`);
      raw(`INSERT INTO "Notes" VALUES ('ana@x')`);
      const byEmail = { ...rel, parentFields: ['Email'] };
      expect(saveRelation(db, { ...byEmail, childTable: 'Adresses', childFields: ['Mail'] }, null, fr).ok).toBe(true);
      expect(saveRelation(db, { ...byEmail, childTable: 'Contacts', childFields: ['Email'], cascadeUpdate: true }, null, fr).ok).toBe(true);
      expect(saveRelation(db, { ...rel, parentTable: 'Contacts', parentFields: ['Email'], childTable: 'Notes', childFields: ['Mail'] }, null, fr).ok).toBe(true);
      expect(await updateRow(db, tableDesign(db, 'Clients'), 1, { Email: 'zed@x' }, fr, now))
        .toEqual({ ok: false, errors: [{ field: 'Email', code: 'related', table: 'Notes' }] });
    });
    it('a chain that cannot be resolved names no table', () => {
      db.exec(`CREATE TABLE "Log" ("c" INTEGER REFERENCES "Clients" ("N°"));
        CREATE TRIGGER "audit" AFTER DELETE ON "Clients" BEGIN INSERT INTO "Log" VALUES (OLD."N°"); END`);
      expect(deleteRows(db, 'Clients', [1])).toEqual({ ok: false, reason: 'related' });
      expect(countRows(db, 'Clients')).toBe(2);
    });
  });

  describe('pass 2 follows a rename by the stored field names, actions copied only when they match', () => {
    beforeEach(() => {
      createTable(db, t('Teams', [f('ID', 'autoNumber'), long('Code', { indexed: 'yesNoDuplicates' })]));
      createTable(db, t('Matches', [f('N°', 'autoNumber'), long('HomeTeam'), long('AwayTeam')]));
    });
    const home: Relation = { ...rel, name: 'Home', parentTable: 'Teams', parentFields: ['ID'], childTable: 'Matches', childFields: ['HomeTeam'] };
    const away: Relation = { ...home, name: 'Away', childFields: ['AwayTeam'] };
    it('a child renamed by another tool, two keys to one parent, same actions: both follow', () => {
      expect(saveRelation(db, home, null, fr).ok).toBe(true);
      expect(saveRelation(db, away, null, fr).ok).toBe(true);
      db.exec('ALTER TABLE "Matches" RENAME TO "Games"');
      expect(reopen()).toMatchObject({ removedRelations: [], downgradedRelations: [], updatedRelations: ['Away', 'Home'] });
      expect(listRelations(db)).toEqual([{ ...away, childTable: 'Games' }, { ...home, childTable: 'Games' }]);
    });
    it('a parent renamed by another tool, one child column to two parent keys: both follow, the child stays managed', () => {
      expect(saveRelation(db, home, null, fr).ok).toBe(true);
      expect(saveRelation(db, { ...home, name: 'ByCode', parentFields: ['Code'] }, null, fr).ok).toBe(true);
      db.exec('ALTER TABLE "Teams" RENAME TO "Clubs"');
      expect(reopen()).toMatchObject({ removedRelations: [], downgradedRelations: [], updatedRelations: ['ByCode', 'Home'] });
      expect(listRelations(db)).toEqual([{ ...home, name: 'ByCode', parentTable: 'Clubs', parentFields: ['Code'] }, { ...home, parentTable: 'Clubs' }]);
      expect(isExternal(db, tableDesign(db, 'Matches'))).toBe(false);
    });
    it('a rename plus swapped actions is not rebound', () => {
      expect(saveRelation(db, home, null, fr).ok).toBe(true);
      expect(saveRelation(db, { ...away, cascadeDelete: true }, null, fr).ok).toBe(true);
      rebuildWith('Matches', (s) => s.replace(' ON DELETE CASCADE', '')
        .replace('FOREIGN KEY ("HomeTeam") REFERENCES "Teams" ("ID")', 'FOREIGN KEY ("HomeTeam") REFERENCES "Teams" ("ID") ON DELETE CASCADE'));
      db.exec('ALTER TABLE "Matches" RENAME TO "Games"');
      expect(sqlOf('Games')).toMatch(/"HomeTeam"\) REFERENCES "Teams" \("ID"\) ON DELETE CASCADE/);
      expect(reopen()).toMatchObject({ removedRelations: ['Away', 'Home'], updatedRelations: [] });
      expect(listRelations(db)).toEqual([]);
    });
  });

  describe('no raw FOREIGN KEY or NOT NULL error left', () => {
    it('insert: an AutoNumber child key without parent is noParent', async () => {
      createTable(db, t('Fiches', [long('Client', { indexed: 'yesNoDuplicates' })]));
      raw('INSERT INTO "Fiches" VALUES (1), (2)');
      expect(saveRelation(db, { ...rel, parentTable: 'Fiches', parentFields: ['Client'], childTable: 'Clients', childFields: ['N°'] }, null, fr).ok).toBe(true);
      expect(await insertRow(db, tableDesign(db, 'Clients'), { Nom: 'Cy' }, fr, now)).toEqual({ ok: false, errors: [{ field: 'N°', code: 'noParent', table: 'Fiches' }] });
      raw('INSERT INTO "Fiches" VALUES (3)');
      expect((await insertRow(db, tableDesign(db, 'Clients'), { Nom: 'Cy' }, fr, now)).ok).toBe(true);
    });
    it('update: ON UPDATE SET NULL into a NOT NULL column is related; a SET NULL reached through a cascade too', async () => {
      db.exec(`CREATE TABLE "Kids" ("e" TEXT NOT NULL REFERENCES "Clients" ("Email") ON UPDATE SET NULL); INSERT INTO "Kids" VALUES ('ana@x')`);
      expect(await updateRow(db, tableDesign(db, 'Clients'), 1, { Email: 'new@x' }, fr, now))
        .toEqual({ ok: false, errors: [{ field: 'Email', code: 'related', table: 'Kids' }] });
      db.exec(`CREATE TABLE "Notes" ("id" INTEGER PRIMARY KEY, "c" INTEGER REFERENCES "Clients" ("N°") ON DELETE CASCADE);
        CREATE TABLE "G" ("n" INTEGER NOT NULL REFERENCES "Notes" ("id") ON DELETE SET NULL);
        INSERT INTO "Notes" VALUES (10, 1); INSERT INTO "G" VALUES (10)`);
      expect(deleteRows(db, 'Clients', [1])).toEqual({ ok: false, reason: 'related', table: 'G' });
    });
    it('update: noParent goes on the column of a multi-column key the user changed', async () => {
      createTable(db, t('P', [long('a', { primaryKey: true }), long('b', { primaryKey: true })]));
      createTable(db, t('C', [long('x'), long('y')]));
      raw('INSERT INTO "P" VALUES (1, 1)');
      raw('INSERT INTO "C" VALUES (1, 1)');
      expect(saveRelation(db, { ...rel, parentTable: 'P', parentFields: ['a', 'b'], childTable: 'C', childFields: ['x', 'y'] }, null, fr).ok).toBe(true);
      expect(await updateRow(db, tableDesign(db, 'C'), 1, { y: '9' }, fr, now)).toEqual({ ok: false, errors: [{ field: 'y', code: 'noParent', table: 'P' }] });
    });
    it('a text import appended to a child with a DEFERRABLE key logs the orphan line and keeps the others', async () => {
      db.exec('CREATE TABLE "Kids" ("id" INTEGER PRIMARY KEY, "e" TEXT REFERENCES "Clients" ("Email") DEFERRABLE INITIALLY DEFERRED)');
      reconcile(db);
      const p = csvFile('k.csv', 'e\nbob@x\nzz@x\nana@x\n');
      expect(await runImport(db, p, { spec: previewText(p, null, fr, 'Champ').spec, target: { kind: 'append', table: 'Kids', mapping: ['e'] } }, fr, texts))
        .toMatchObject({ ok: true, imported: 2, errors: 1, errorTable: 'Kids_Erreurs' });
      expect(db.prepare('SELECT "e" FROM "Kids" ORDER BY "id"').all()).toEqual([{ e: 'bob@x' }, { e: 'ana@x' }]);
      expect(db.prepare('SELECT "Champ", "Ligne" FROM "Kids_Erreurs"').all()).toEqual([{ Champ: 'e', Ligne: 3 }]);
    });
  });

  it('saveRelation refuses the swapped duplicate (the same fields, parent and child exchanged)', () => {
    createTable(db, t('Fiches', [long('Client', { indexed: 'yesNoDuplicates' })]));
    raw('INSERT INTO "Fiches" VALUES (1), (2)');
    expect(saveRelation(db, { ...rel, childTable: 'Fiches' }, null, fr).ok).toBe(true);
    expect(saveRelation(db, { ...rel, parentTable: 'Fiches', parentFields: ['Client'], childTable: 'Clients', childFields: ['N°'] }, null, fr))
      .toEqual({ ok: false, reason: 'duplicate', relation: 'ClientsFiches' });
  });

  it('a self-referencing SET NULL key: the warning does not speak of other tables', () => {
    db.exec('CREATE TABLE "Emp" ("id" INTEGER PRIMARY KEY, "boss" INTEGER REFERENCES "Emp" ("id") ON DELETE SET NULL)');
    expect(cascadeChildren(db, 'Emp')).toEqual([{ table: 'Emp', effect: 'modified' }]);
    for (const s of [en.datasheet.deleteModifies, en.datasheet.deleteModifies_one, frTexts.datasheet.deleteModifies, frTexts.datasheet.deleteModifies_one]) {
      expect(s).not.toMatch(/other tables|autres tables/);
    }
  });
});
