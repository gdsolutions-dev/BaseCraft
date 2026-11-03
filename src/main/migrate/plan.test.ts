import { afterEach, beforeEach, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import { join } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { createBaseFile, openBaseFile } from '../db/file-format';
import { createTable } from '../db/schema';
import { addLinks } from '../links/store';
import { seedSales, seedSalesRelation } from '../query/test-db';
import { f, t } from '../../shared/test-fixtures';
import { literalDefault, migrationPlan, MigrateRefusal, objectName } from './plan';

const PG = { nameMax: 63, unit: 'utf8' } as const, MS = { nameMax: 128, unit: 'utf16' } as const;
let dir: string;
let fe: string;
let db: DatabaseSync;
const open = (file: string) => { createBaseFile(file, '0.0.0'); return openBaseFile(file, 'write', '0.0.0').db; };
const refusal = (fn: () => unknown) => { try { fn(); } catch (e) { return e instanceof MigrateRefusal ? [e.reason, e.names] : e; } return undefined; };

beforeEach(() => {
  dir = fs.realpathSync.native(fs.mkdtempSync(join(os.tmpdir(), 'bcplan-')));
  fe = join(dir, 'front.basecraft');
  db = open(fe);
  seedSales(db);
  seedSalesRelation(db);
  createTable(db, t('T', [f('N°', 'autoNumber'), f('Code', 'shortText', { size: 5, indexed: 'yesNoDuplicates', defaultValue: '"AB"' }),
    f('Qte', 'number', { numberSize: 'byte', defaultValue: '0' }), f('Le', 'dateTime', { defaultValue: 'Date()' }),
    f('Ok', 'yesNo', { defaultValue: 'True' }), f('Note', 'longText', { allowZeroLength: false })]));
});
afterEach(() => {
  db.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

it('one entry per local table, key and fields in design order, local row counts', () => {
  const p = migrationPlan(db, 'public', PG, []);
  expect(p.tables.map((x) => [x.name, x.key, x.rows])).toEqual([['Clients', ['N°'], 4], ['Commandes', ['N°'], 5], ['T', ['N°'], 0]]);
  const tt = p.tables.find((x) => x.name === 'T')!;
  expect(tt.schema).toBe('public');
  expect(tt.fields.map((x) => x.name)).toEqual(['N°', 'Code', 'Qte', 'Le', 'Ok', 'Note']);
  expect(tt.fields[1]!.props).toMatchObject({ type: 'shortText', size: 5 });
  expect(tt.indexes).toEqual([{ name: 'T_Code', fields: [{ name: 'Code', desc: false }], unique: true }]); // the sole key has none
  expect(tt.nextId).toBe(1);
});

it('literal defaults go to the server, expressions and rules stay in the front-end', () => {
  const tt = migrationPlan(db, 'public', PG, []).tables.find((x) => x.name === 'T')!;
  expect(Object.fromEntries(tt.fields.map((x) => [x.name, x.default]))).toMatchObject({ Code: { k: 'str', v: 'AB' }, Qte: { k: 'num', v: '0' }, Ok: { k: 'bool', v: true }, Le: undefined });
  expect(migrationPlan(db, 'public', PG, []).frontEndOnly).toEqual(expect.arrayContaining([
    { table: 'T', field: 'Le', what: 'defaultValue' }, { table: 'T', field: 'Note', what: 'allowZeroLength' }, { table: 'Commandes', field: 'Montant', what: 'validationRule' }]));
});

it('literalDefault converts as the field stores it', () => {
  const d = (type: Parameters<typeof f>[1], defaultValue: string, o = {}) => literalDefault(f('x', type, { defaultValue, ...o }));
  expect(d('number', '-2.5', { numberSize: 'double' })).toEqual({ k: 'num', v: '-2.5' });
  expect(d('number', '2.6', { numberSize: 'integer' })).toEqual({ k: 'num', v: '3' });
  expect(d('number', '"5"')).toEqual({ k: 'num', v: '5' });
  expect(d('number', '300', { numberSize: 'byte' })).toBeUndefined(); // the field cannot hold it
  expect(d('number', '1.23456', { numberSize: 'decimal', precision: 10, scale: 2 })).toEqual({ k: 'num', v: '1.23' });
  expect(d('currency', '1.23456')).toEqual({ k: 'num', v: '1.2346' });
  expect(d('dateTime', '#2026-01-02 03:04:05#')).toEqual({ k: 'date', v: '2026-01-02 03:04:05' });
  expect(d('yesNo', 'False')).toEqual({ k: 'bool', v: false });
  expect(d('yesNo', '-1')).toEqual({ k: 'bool', v: true });
  expect(d('shortText', '"ABCDEF"', { size: 5 })).toBeUndefined(); // longer than the size
  expect(d('shortText', '"l\'été"')).toEqual({ k: 'str', v: "l'été" });
  expect(d('shortText', '5')).toBeUndefined(); // a number shown as text depends on the region
  expect(d('number', '1+1')).toBeUndefined();
  expect(literalDefault(f('x', 'number'))).toBeUndefined();
});

it('a Short Text literal longer than the size stays in the front-end', () => {
  createTable(db, t('U', [f('Id', 'number', { primaryKey: true, required: true }), f('C', 'shortText', { size: 2, defaultValue: '"ABC"' })]));
  const p = migrationPlan(db, 'public', PG, []);
  expect(p.tables.find((x) => x.name === 'U')!.fields[1]!.default).toBeUndefined();
  expect(p.frontEndOnly).toContainEqual({ table: 'U', field: 'C', what: 'defaultValue' });
});

it('a table rule stays in the front-end', () => {
  createTable(db, { ...t('U', [f('Id', 'autoNumber'), f('A', 'number')]), validationRule: '[A]>0' });
  expect(migrationPlan(db, 'public', PG, []).frontEndOnly).toContainEqual({ table: 'U', what: 'tableRule' });
});

it('nextId past rows deleted at the end (AUTOINCREMENT never reuses)', () => {
  db.exec('DELETE FROM "Commandes" WHERE "N°" IN (4, 5)');
  const c = migrationPlan(db, 'public', PG, []).tables.find((x) => x.name === 'Commandes')!;
  expect([c.rows, c.nextId]).toEqual([3, 6]);
});

it('an enforced relation is a foreign key with its cascades; one not enforced is only listed', () => {
  expect(migrationPlan(db, 'public', PG, []).foreignKeys).toEqual([{ name: 'ClientsCommandes', relation: 'ClientsCommandes', schema: 'public',
    child: 'Commandes', childFields: ['Client'], parent: 'Clients', parentFields: ['N°'], onDelete: 'noAction', onUpdate: 'noAction' }]);
  db.prepare('UPDATE bc_relations SET props = json_set(props, \'$.cascadeDelete\', json(\'true\'))').run();
  expect(migrationPlan(db, 'public', PG, []).foreignKeys[0]).toMatchObject({ onDelete: 'cascade', onUpdate: 'noAction' });
  db.prepare('UPDATE bc_relations SET props = json_set(props, \'$.enforce\', json(\'false\'))').run();
  const p = migrationPlan(db, 'public', PG, []);
  expect([p.foreignKeys, p.notEnforced]).toEqual([[], ['ClientsCommandes']]);
});

it('a name over 63 UTF-8 bytes is refused on PostgreSQL, not on SQL Server', () => {
  const long = 'é'.repeat(32); // 64 bytes, 32 UTF-16 units
  createTable(db, t(long, [f('Id', 'autoNumber')]));
  expect(refusal(() => migrationPlan(db, 'public', PG, []))).toEqual(['nameTooLong', [long]]);
  expect(migrationPlan(db, 'dbo', MS, []).tables.map((x) => x.name)).toContain(long);
  db.exec(`DROP TABLE "${long}"`);
  createTable(db, t('V', [f('Id', 'autoNumber'), f(long, 'number')]));
  expect(refusal(() => migrationPlan(db, 'public', PG, []))).toEqual(['nameTooLong', [`V.${long}`]]);
});

it('a table the schema already has refuses, compared without case', () => {
  expect(() => migrationPlan(db, 'public', PG, ['clients', 'x'])).toThrow(expect.objectContaining({ reason: 'nameTaken', names: ['Clients'] }));
});

it('index names are cut to the limit and never collide', () => {
  const taken = new Set(['t_code']);
  expect(objectName('T_Code', taken, PG)).toBe('T_Code_2');
  expect(objectName('T_Code', taken, PG)).toBe('T_Code_3'); // the name picked is added
  expect(Buffer.byteLength(objectName('é'.repeat(40), new Set(), PG))).toBeLessThanOrEqual(63);
  const cut = objectName('é'.repeat(40), new Set(['é'.repeat(31)]), PG);
  expect([cut, Buffer.byteLength(cut) <= 63]).toEqual([`${'é'.repeat(30)}_2`, true]);
  expect(objectName('😀'.repeat(70), new Set(), MS)).toBe('😀'.repeat(64)); // never half a surrogate pair
  // an index named as a table, another index or a relation of the schema gets a suffix
  const p = migrationPlan(db, 'public', PG, ['t_code']);
  expect(p.tables.find((x) => x.name === 'T')!.indexes[0]!.name).toBe('T_Code_2');
});

it('Indexes dialog entries and a field of a multi-field key are indexes', () => {
  createTable(db, { ...t('L', [f('A', 'number', { primaryKey: true, required: true, indexed: 'yesDuplicates' }), f('B', 'number', { primaryKey: true, required: true }), f('C', 'shortText')]),
    indexes: [{ name: 'BC', fields: [{ name: 'B', desc: true }, { name: 'C', desc: false }], unique: false }] });
  const l = migrationPlan(db, 'public', PG, []).tables.find((x) => x.name === 'L')!;
  expect([l.key, l.nextId, l.indexes]).toEqual([['A', 'B'], undefined, [{ name: 'L_A', fields: [{ name: 'A', desc: false }], unique: false },
    { name: 'L_BC', fields: [{ name: 'B', desc: true }, { name: 'C', desc: false }], unique: false }]]);
});

it('noTables on a base without local tables', () => {
  const other = join(dir, 'data.basecraft');
  open(other).close();
  const empty = open(join(dir, 'empty.basecraft'));
  try {
    addLinks(empty, join(dir, 'empty.basecraft'), 'basecraft', other, ['Clients']);
    expect(refusal(() => migrationPlan(empty, 'public', PG, []))).toEqual(['noTables', []]);
  } finally { empty.close(); }
});

it('a design the editor would refuse (size, precision, scale) is refused before any SQL', () => {
  const bad = (field: string, json: string) => db.prepare('UPDATE bc_fields SET props = json_set(props, ?, json(?)) WHERE table_name = ? AND field_name = ?');
  const set = (path: string, json: string, field: string) => bad(field, json).run(path, json, 'T', field);
  set('$.size', '"10); DROP TABLE x; --"', 'Code');
  expect(refusal(() => migrationPlan(db, 'public', PG, []))).toEqual(['invalidDesign', ['T.Code']]);
  set('$.size', '5', 'Code');
  set('$.numberSize', '"decimal"', 'Qte');
  set('$.precision', '2.5', 'Qte');
  expect(refusal(() => migrationPlan(db, 'public', MS, []))).toEqual(['invalidDesign', ['T.Qte']]);
  set('$.precision', '10', 'Qte');
  set('$.scale', '11', 'Qte');
  expect(refusal(() => migrationPlan(db, 'public', PG, []))).toEqual(['invalidDesign', ['T.Qte']]);
});

it("PostgreSQL's automatic names (<table>_pkey, <table>_<col>_seq) are never chosen for an index", () => {
  createTable(db, t('Z', [f('N°', 'autoNumber'), f('pkey', 'shortText', { indexed: 'yesDuplicates' }), f('N°_seq', 'shortText', { indexed: 'yesDuplicates' })]));
  const z = migrationPlan(db, 'public', PG, []).tables.find((x) => x.name === 'Z')!;
  expect(z.indexes.map((x) => x.name)).toEqual(['Z_pkey_2', 'Z_N°_seq_2']);
});
