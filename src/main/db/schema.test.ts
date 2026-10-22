import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createBaseFile, openBaseFile } from './file-format';
import { changeType } from '../../shared/field-types';
import { clients, f, t } from '../../shared/test-fixtures';
import type { FieldProps, TableDesign } from '../../shared/field-types';
import {
  createTable, createTableStatements, dropTable, writeTableMetadata, listTables, NameExistsError, quoteIdent, reconcile, renameTable, tableDesign,
} from './schema';

let dir: string;
let p: string;
let db: DatabaseSync;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bcsch-'));
  p = path.join(dir, 'test.basecraft');
  createBaseFile(p, '0.0.0');
  db = openBaseFile(p, 'write', '0.0.0').db;
});
afterEach(() => {
  try { db.close(); } catch { /* already closed */ }
  fs.rmSync(dir, { recursive: true, force: true });
});

const sqlOf = (d: DatabaseSync, name: string): string =>
  (d.prepare(`SELECT sql FROM sqlite_master WHERE name = ?`).get(name) as { sql: string }).sql;
const withField = (d: TableDesign, field: string, extra: Record<string, unknown>): TableDesign => ({
  ...d,
  fields: d.fields.map((x) => (x.name === field ? { ...x, props: { ...x.props, ...extra } } : x)),
});

describe('schema', () => {
  it('quotes identifiers', () => expect(quoteIdent('Prix "TTC"')).toBe('"Prix ""TTC"""'));

  it('enforces constraints natively', () => {
    createTable(db, clients);
    expect(() => db.exec(`INSERT INTO "Clients"("Nom") VALUES ('${'x'.repeat(51)}')`)).toThrow(/CHECK/);
    expect(() => db.exec(`INSERT INTO "Clients"("Nom","Âge") VALUES ('a', 300)`)).toThrow(/CHECK/);
    db.exec(`INSERT INTO "Clients"("Nom","Email") VALUES ('a','x@y')`);
    expect(() => db.exec(`INSERT INTO "Clients"("Nom","Email") VALUES ('b','x@y')`)).toThrow(/UNIQUE/);
    expect(db.prepare('SELECT "Actif" AS a FROM "Clients"').get()).toEqual({ a: 0 });
    expect(sqlOf(db, 'Clients')).toMatch(/AUTOINCREMENT/);
  });

  it('file stays usable by plain SQLite without BaseCraft functions', () => {
    createTable(db, clients); db.close();
    const raw = new DatabaseSync(p);
    raw.exec(`INSERT INTO "Clients"("Nom") VALUES ('z')`);
    expect(raw.prepare('PRAGMA integrity_check').get()).toEqual({ integrity_check: 'ok' });
    raw.close();
  });

  it('new props round-trip and clearing removes them', () => {
    const lookup = { kind: 'table' as const, table: 'B', boundField: 'Id', displayFields: ['Nom'], limitToList: false };
    createTable(db, t('T', [f('A', 'number', { defaultValue: '0', validationRule: '>=0', validationText: 'Positif', format: 'fixed', inputMask: '000', lookup })]));
    expect(tableDesign(db, 'T').fields[0]!.props).toMatchObject({
      defaultValue: '0', validationRule: '>=0', validationText: 'Positif', format: 'fixed', inputMask: '000', lookup,
    });
    writeTableMetadata(db, t('T', [f('A', 'number')]));
    const cleared = tableDesign(db, 'T').fields[0]!.props;
    for (const k of ['defaultValue', 'validationRule', 'validationText', 'format', 'inputMask', 'lookup']) expect(cleared[k]).toBeUndefined();
  });

  it('invalid stored new props are dropped, other props kept', () => {
    createTable(db, t('T', [f('A', 'number', { caption: 'Cap' })]));
    const setProps = (patch: Record<string, unknown>): void => {
      const cur = JSON.parse((db.prepare('SELECT props FROM bc_fields').get() as { props: string }).props) as Record<string, unknown>;
      db.prepare('UPDATE bc_fields SET props = ?').run(JSON.stringify({ ...cur, ...patch }));
    };
    for (const bad of [42, { kind: 'values' }, { kind: 'values', values: [1], limitToList: true }, { kind: 'table', table: 'B', boundField: 'Id', displayFields: [], limitToList: 1 }, { kind: 'x' }]) {
      setProps({ lookup: bad, defaultValue: 5, validationRule: 'ok' });
      const p = tableDesign(db, 'T').fields[0]!.props;
      expect(p.lookup).toBeUndefined();
      expect(p.defaultValue).toBeUndefined();
      expect(p).toMatchObject({ type: 'number', caption: 'Cap', validationRule: 'ok' });
      expect(p.external).toBeUndefined(); // not re-inferred
    }
  });

  it.each<[string, Record<string, unknown>]>([
    ['empty displayFields', { lookup: { kind: 'table' as const, table: 'X', boundField: 'N°', displayFields: [], limitToList: false } }],
    ['empty boundField', { lookup: { kind: 'table' as const, table: 'X', boundField: '', displayFields: ['a'], limitToList: false } }],
    ['empty table', { lookup: { kind: 'table' as const, table: '', boundField: 'N°', displayFields: ['a'], limitToList: false } }],
    ['non-string format', { format: 42 }],
    ['non-string defaultValue', { defaultValue: 0 }],
  ])('createTable refuses invalid new props (%s) instead of dropping them', (_n, extra) => {
    expect(() => createTable(db, t('T', [f('A', 'number', extra)]))).toThrow(/invalid field properties: A/);
    expect(listTables(db)).toEqual([]);
    expect(db.prepare('SELECT count(*) AS n FROM bc_fields').get()).toEqual({ n: 0 });
  });

  it('an empty values lookup is allowed', () => {
    createTable(db, t('T', [f('A', 'shortText', { lookup: { kind: 'values', values: [], limitToList: false } })]));
    expect(tableDesign(db, 'T').fields[0]!.props.lookup).toEqual({ kind: 'values', values: [], limitToList: false });
  });

  it('round-trips design including unknown props', () => {
    createTable(db, withField(clients, 'Nom', { futureProp: 42 }));
    expect(tableDesign(db, 'Clients').fields.find((x) => x.name === 'Nom')!.props.futureProp).toBe(42);
  });

  it('odd names and case-insensitive uniqueness', () => {
    createTable(db, t('Prix "TTC" été', [f('Nom du client', 'shortText'), f('N°', 'autoNumber')]));
    expect(listTables(db).map((x) => x.name)).toContain('Prix "TTC" été');
    expect(() => createTable(db, t('PRIX "ttc" ÉTÉ', [f('A', 'shortText')]))).toThrow(NameExistsError);
  });

  it('rename and drop keep metadata consistent', () => {
    createTable(db, clients); renameTable(db, 'Clients', 'Contacts');
    expect(tableDesign(db, 'Contacts').fields).toHaveLength(clients.fields.length);
    expect(dropTable(db, 'Contacts')).toEqual({ ok: true }); expect(listTables(db)).toEqual([]);
    expect(db.prepare('SELECT count(*) AS n FROM bc_fields').get()).toEqual({ n: 0 });
  });

  it('rename moves indexes so the old name can be reused', () => {
    createTable(db, clients); renameTable(db, 'Clients', 'Contacts');
    expect(() => createTable(db, t('Clients', [f('Email', 'shortText', { indexed: 'yesNoDuplicates' })]))).not.toThrow();
    db.exec(`INSERT INTO "Contacts"("Nom","Email") VALUES ('a','x@y')`);
    expect(() => db.exec(`INSERT INTO "Contacts"("Nom","Email") VALUES ('b','x@y')`)).toThrow(/UNIQUE/);
  });

  it('reconciles external changes', () => {
    createTable(db, clients);
    db.exec('CREATE TABLE "Ext" (a INTEGER, b REAL, c TEXT, d BLOB)'); db.exec('CREATE TABLE "Gone"(x)');
    expect(reconcile(db).addedTables).toEqual(['Ext', 'Gone']);
    db.exec('DROP TABLE "Gone"'); db.exec('ALTER TABLE "Clients" ADD COLUMN "Note" TEXT');
    const r = reconcile(db);
    expect(r.removedTables).toEqual(['Gone']); expect(r.addedFields).toEqual([{ table: 'Clients', field: 'Note' }]);
    expect(tableDesign(db, 'Ext').fields.map((x) => [x.props.type, x.props.numberSize])).toEqual([['number', 'longInteger'], ['number', 'double'], ['longText', undefined], ['longText', undefined]]);
  });

  it('invalid metadata yields an inferred field instead of throwing', () => {
    createTable(db, clients);
    db.prepare(`UPDATE bc_fields SET props = '{"type":"bogus"}' WHERE field_name = 'Nom'`).run();
    db.prepare(`UPDATE bc_fields SET props = '{"type":"shortText","required":false,"primaryKey":false,"indexed":"maybe"}' WHERE field_name = 'Email'`).run();
    const fields = tableDesign(db, 'Clients').fields;
    expect(fields.find((x) => x.name === 'Nom')!.props).toMatchObject({ type: 'longText', external: true });
    expect(fields.find((x) => x.name === 'Email')!.props).toMatchObject({ type: 'longText', indexed: 'no', external: true });
    expect(fields).toHaveLength(clients.fields.length);
  });

  it('case-only table rename, no-op rename, and clash with another table', () => {
    createTable(db, t('clients', [f('Nom', 'shortText', { indexed: 'yesNoDuplicates', caption: 'C' })]));
    db.exec(`INSERT INTO "clients"("Nom") VALUES ('a')`);
    renameTable(db, 'clients', 'clients');
    renameTable(db, 'clients', 'Clients');
    expect(listTables(db).map((x) => x.name)).toEqual(['Clients']);
    expect(db.prepare('SELECT count(*) AS n FROM "Clients"').get()).toEqual({ n: 1 });
    expect(tableDesign(db, 'Clients').fields[0]!.props.caption).toBe('C');
    expect(() => db.exec(`INSERT INTO "Clients"("Nom") VALUES ('a')`)).toThrow(/UNIQUE/);
    createTable(db, t('Autre', [f('A', 'shortText')]));
    expect(() => renameTable(db, 'Clients', 'AUTRE')).toThrow(NameExistsError);
  });

  it('case-only column rename keeps metadata', () => {
    createTable(db, t('T', [f('nom', 'shortText', { caption: 'Cap' })]));
    db.exec('ALTER TABLE "T" RENAME COLUMN "nom" TO "Nom"');
    writeTableMetadata(db, tableDesign(db, 'T'));
    const row = db.prepare('SELECT field_name, props FROM bc_fields').get() as { field_name: string; props: string };
    expect(row.field_name).toBe('Nom');
    expect(JSON.parse(row.props)).toMatchObject({ caption: 'Cap' });
    expect(JSON.parse(row.props).external).toBeUndefined();
  });

  it('merge keeps only unknown keys', () => {
    createTable(db, { ...t('T', [f('A', 'shortText', { size: 20, allowZeroLength: false, futureProp: 1 })]), description: 'd' });
    const d = tableDesign(db, 'T');
    const { futureProp: _f, ...rest } = d.fields[0]!.props; // rewrite without mentioning futureProp
    d.fields[0]!.props = changeType(rest as FieldProps, 'longText');
    delete d.description;
    writeTableMetadata(db, d);
    const stored = JSON.parse((db.prepare('SELECT props FROM bc_fields').get() as { props: string }).props);
    expect(stored.size).toBeUndefined();
    expect(stored.allowZeroLength).toBeUndefined();
    expect(stored.futureProp).toBe(1);
    expect(tableDesign(db, 'T').description).toBeUndefined();
    expect(createTableStatements(tableDesign(db, 'T')).join()).not.toContain("<> ''");
    db.prepare(`UPDATE bc_fields SET props = json_set(props, '$.external', json('true'))`).run();
    writeTableMetadata(db, d);
    expect(JSON.parse((db.prepare('SELECT props FROM bc_fields').get() as { props: string }).props).external).toBeUndefined();
  });

  it('createTable ignores stale metadata of an externally dropped table', () => {
    createTable(db, { ...t('T', [f('A', 'shortText', { futureProp: 1 })]), extra: { color: 'red' } });
    db.exec('DROP TABLE "T"');
    createTable(db, t('t', [f('a', 'longText')]));
    const d = tableDesign(db, 't');
    expect(d.extra).toBeUndefined();
    expect(d.fields[0]!.props.futureProp).toBeUndefined();
    expect(db.prepare('SELECT count(*) AS n FROM bc_fields').get()).toEqual({ n: 1 });
  });

  it('renameTable onto a name with stale metadata purges it', () => {
    createTable(db, { ...t('Old', [f('A', 'shortText', { futureProp: 1 })]), extra: { color: 'red' } });
    createTable(db, t('Cur', [f('A', 'longText')]));
    db.exec('DROP TABLE "Old"');
    renameTable(db, 'Cur', 'Old');
    const d = tableDesign(db, 'Old');
    expect(d.extra).toBeUndefined();
    expect(d.fields[0]!.props.futureProp).toBeUndefined();
    expect(db.prepare('SELECT count(*) AS n FROM bc_tables').get()).toEqual({ n: 1 });
  });

  it('accented case-only column rename leaves one row', () => {
    createTable(db, t('T', [f('état', 'shortText', { caption: 'old' })]));
    db.exec('ALTER TABLE "T" RENAME COLUMN "état" TO "État"');
    const d = tableDesign(db, 'T');
    d.fields[0]!.props = { ...d.fields[0]!.props, caption: 'new' };
    writeTableMetadata(db, d);
    const rows = db.prepare('SELECT field_name, props FROM bc_fields').all() as { field_name: string; props: string }[];
    expect(rows).toHaveLength(1);
    expect(rows[0]!.field_name).toBe('État');
    expect(JSON.parse(rows[0]!.props).caption).toBe('new');
  });

  it('createTable rejects unusable props', () => {
    expect(() => createTable(db, t('T', [f('A', 'number', { numberSize: 'constructor' as never })]))).toThrow(/invalid field properties/);
    expect(listTables(db)).toEqual([]);
  });

  it('rename after external column rename rebuilds indexes on the right column', () => {
    createTable(db, clients);
    db.exec('ALTER TABLE "Clients" RENAME COLUMN "Email" TO "Courriel"');
    renameTable(db, 'Clients', 'Contacts');
    db.exec(`INSERT INTO "Contacts"("Nom","Courriel") VALUES ('a','x@y')`);
    expect(() => db.exec(`INSERT INTO "Contacts"("Nom","Courriel") VALUES ('b','x@y')`)).toThrow(/UNIQUE/);
  });

  it('rolls back on mid-transaction failure and reconcile is idempotent', () => {
    db.exec('CREATE TABLE "Other"(x)');
    db.exec(`CREATE INDEX "bcx_T.A" ON "Other"(x)`);
    expect(() => createTable(db, t('T', [f('A', 'shortText', { indexed: 'yesDuplicates' })]))).toThrow();
    expect(db.prepare('SELECT count(*) AS n FROM bc_tables').get()).toEqual({ n: 0 });
    expect(db.prepare('SELECT count(*) AS n FROM bc_fields').get()).toEqual({ n: 0 });
    expect(listTables(db).map((x) => x.name)).toEqual(['Other']);
    reconcile(db);
    expect(reconcile(db)).toEqual({ addedTables: [], removedTables: [], addedFields: [], removedFields: [], removedRelations: [], downgradedRelations: [] });
  });
});
