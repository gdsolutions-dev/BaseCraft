import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createBaseFile, openBaseFile } from './file-format';
import { createTable, dropTable, renameTable } from './schema';
import { tableDesign } from './schema';
import { copyRows, deleteRows, insertRow, updateRow } from './write-layer';
import { countRows } from './rows';
import { f, t, clients } from '../../shared/test-fixtures';
import { localeInfo } from '../../shared/locale-format';
import { seedSales } from '../query/test-db';

let dir: string;
let db: DatabaseSync;
const fr = localeInfo('fr-FR');

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bcwl-'));
  const p = path.join(dir, 'test.basecraft');
  createBaseFile(p, '0.0.0');
  db = openBaseFile(p, 'write', '0.0.0').db;
  createTable(db, clients);
});
afterEach(() => {
  try { db.close(); } catch { /* already closed */ }
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('write layer (brief)', () => {
  it('insert returns stored row with autonumber', async () => expect(await insertRow(db, clients, { Nom: 'Dupont', Solde: '1 234,5' }, fr)).toEqual({ ok: true, rowid: 1, values: [1, 'Dupont', null, 0, 1234.5, null] }));
  it('collects all field errors and writes nothing', async () => {
    const r = await insertRow(db, clients, { Nom: '', Âge: '300' }, fr);
    expect(r).toEqual({ ok: false, errors: [{ field: 'Nom', code: 'required' }, { field: 'Âge', code: 'outOfRange' }] });
    expect(countRows(db, 'Clients')).toBe(0);
  });
  it('maps unique violations to the field', async () => {
    await insertRow(db, clients, { Nom: 'a', Email: 'x@y' }, fr);
    expect(await insertRow(db, clients, { Nom: 'b', Email: 'x@y' }, fr)).toEqual({ ok: false, errors: [{ field: 'Email', code: 'duplicate' }] });
  });
  it('update is partial', async () => {
    await insertRow(db, clients, { Nom: 'Dupont', Solde: '10' }, fr);
    expect(await updateRow(db, clients, 1, { Solde: '20,5' }, fr)).toEqual({ ok: true, rowid: 1, values: [1, 'Dupont', null, 0, 20.5, null] });
  });
  it('delete returns count', async () => {
    await insertRow(db, clients, { Nom: 'a' }, fr); await insertRow(db, clients, { Nom: 'b' }, fr);
    expect(deleteRows(db, 'Clients', [1, 2, 99])).toEqual({ ok: true, count: 2 });
  });
});

describe('write layer (extra)', () => {
  it('required field omitted on insert gives required', async () =>
    expect(await insertRow(db, clients, { Âge: '3' }, fr)).toEqual({ ok: false, errors: [{ field: 'Nom', code: 'required' }] }));
  it('autoNumber in values gives readOnly', async () =>
    expect(await insertRow(db, clients, { 'N°': 5, Nom: 'a' }, fr)).toEqual({ ok: false, errors: [{ field: 'N°', code: 'readOnly' }] }));
  it('unknown field throws', async () => await expect(insertRow(db, clients, { Nom: 'a', Zzz: 1 }, fr)).rejects.toThrow());
  it('update of unknown rowid throws', async () => await expect(updateRow(db, clients, 42, { Nom: 'a' }, fr)).rejects.toThrow('row not found'));
  it('update duplicate maps to field and leaves row unchanged', async () => {
    await insertRow(db, clients, { Nom: 'a', Email: 'x@y' }, fr); await insertRow(db, clients, { Nom: 'b', Email: 'z@y' }, fr);
    expect(await updateRow(db, clients, 2, { Email: 'x@y' }, fr)).toEqual({ ok: false, errors: [{ field: 'Email', code: 'duplicate' }] });
    expect(await updateRow(db, clients, 2, {}, fr)).toMatchObject({ ok: true, values: [2, 'b', null, 0, null, 'z@y'] });
  });
  it('accepts more ids than the SQLite variable limit', async () => {
    await insertRow(db, clients, { Nom: 'a' }, fr);
    expect(deleteRows(db, 'Clients', Array.from({ length: 40000 }, (_, i) => i + 1))).toEqual({ ok: true, count: 1 });
  });
  it('deletes more than 1000 ids', async () => {
    db.exec('BEGIN'); for (let i = 0; i < 1200; i++) await insertRow(db, clients, { Nom: 'n' }, fr); db.exec('COMMIT');
    expect(deleteRows(db, 'Clients', Array.from({ length: 1200 }, (_, i) => i + 1))).toEqual({ ok: true, count: 1200 });
    expect(countRows(db, 'Clients')).toBe(0);
  });
});

describe('write layer (fix round 1)', () => {
  const raw = (sql: string) => db.exec(sql);
  it('maps duplicates with commas in table and field names', async () => {
    const d = t('Clients, Pro', [f('Nom', 'shortText'), f('Nom, Prénom', 'shortText', { indexed: 'yesNoDuplicates' })]);
    createTable(db, d);
    await insertRow(db, d, { Nom: 'a', 'Nom, Prénom': 'x' }, fr);
    expect(await insertRow(db, d, { Nom: 'b', 'Nom, Prénom': 'x' }, fr)).toEqual({ ok: false, errors: [{ field: 'Nom, Prénom', code: 'duplicate' }] });
  });
  for (const mode of ['REPLACE', 'IGNORE', 'ROLLBACK']) {
    it(`external UNIQUE ON CONFLICT ${mode}: duplicate insert/update is reported, other row untouched`, async () => {
      raw(`CREATE TABLE "E" ("K" TEXT UNIQUE ON CONFLICT ${mode}, "V" TEXT)`);
      const d = tableDesign(db, 'E');
      await insertRow(db, d, { K: 'a', V: '1' }, fr); await insertRow(db, d, { K: 'b', V: '2' }, fr);
      expect(await insertRow(db, d, { K: 'a', V: '3' }, fr)).toEqual({ ok: false, errors: [{ field: 'K', code: 'duplicate' }] });
      expect(await updateRow(db, d, 2, { K: 'a' }, fr)).toEqual({ ok: false, errors: [{ field: 'K', code: 'duplicate' }] });
      expect(db.prepare('SELECT K, V FROM E ORDER BY rowid').all().map((r) => ({ ...r }))).toEqual([{ K: 'a', V: '1' }, { K: 'b', V: '2' }]);
    });
  }
  it('failed standalone write leaves no open transaction', async () => {
    await insertRow(db, clients, { Nom: 'a', Email: 'x' }, fr);
    await insertRow(db, clients, { Nom: 'b', Email: 'x' }, fr);
    expect(db.isTransaction).toBe(false);
  });
  it('deleteRows inside an outer transaction is all-or-nothing', async () => {
    for (const n of ['a', 'b']) await insertRow(db, clients, { Nom: n }, fr);
    raw(`CREATE TRIGGER bcx_t BEFORE DELETE ON "Clients" WHEN old.rowid = 2 BEGIN SELECT RAISE(ABORT, 'no'); END`);
    raw('BEGIN');
    expect(() => deleteRows(db, 'Clients', [1, ...Array.from({ length: 600 }, (_, i) => 1000 + i), 2])).toThrow(); // 2 chunks: row 1 is deleted in the first
    expect(db.isTransaction).toBe(true);
    raw('COMMIT');
    expect(countRows(db, 'Clients')).toBe(2);
  });
});

describe('write layer: input mask (A2-R10)', () => {
  const now = () => new Date(2026, 9, 21, 15, 30, 0);
  const on = { enforceMask: true };
  const d = t('Contacts', [
    f('Tel', 'shortText', { inputMask: '00\\ 00\\ 00\\ 00\\ 00;0;_' }),
    f('Code', 'shortText', { inputMask: '>LL-00' }),
    f('Né', 'dateTime', { inputMask: '00/00/0000' }),
    f('Qté', 'number', { inputMask: '9 999;;_' }),
    f('Oui', 'yesNo', { inputMask: '0' }), // ignored: masks apply to text, number, currency and date fields only
  ]);
  beforeEach(() => createTable(db, d));

  it('write layer refuses', async () => expect(await insertRow(db, d, { Tel: '06 12' }, fr, now, on)).toEqual({ ok: false, errors: [{ field: 'Tel', code: 'mask' }] }));
  it('text field stores with or without literals per the mask', async () => {
    expect(await insertRow(db, d, { Tel: '06 12 34 56 78', Code: 'ab-12' }, fr, now, on)).toMatchObject({ ok: true, values: ['06 12 34 56 78', 'AB12', null, null, 0] });
  });
  it('date and number fields: the full text goes through the normal conversion (literals are never dropped)', async () => {
    expect(await insertRow(db, d, { Né: '21/10/2026', Qté: '1 234' }, fr, now, on)).toMatchObject({ ok: true, values: [null, null, '2026-10-21 00:00:00', 1234, 0] });
    expect(await insertRow(db, d, { Né: '21/10/26' }, fr, now, on)).toEqual({ ok: false, errors: [{ field: 'Né', code: 'mask' }] });
  });
  it('empty or Null passes the mask; a non-text input is not masked', async () => {
    expect((await insertRow(db, d, { Tel: '', Code: null, Oui: true }, fr, now, on)).ok).toBe(true);
  });
  it('update is masked too', async () => {
    await insertRow(db, d, {}, fr, now, on);
    expect(await updateRow(db, d, 1, { Code: 'a1' }, fr, now, on)).toEqual({ ok: false, errors: [{ field: 'Code', code: 'mask' }] });
    expect(await updateRow(db, d, 1, { Code: 'xy99' }, fr, now, on)).toMatchObject({ ok: true, values: [null, 'XY99', null, null, 0] });
  });
  it('programmatic writes (import) ignore the mask, as in Access', async () => {
    expect(await insertRow(db, d, { Tel: '0612', Code: 'nope' }, fr, now)).toMatchObject({ ok: true, values: ['0612', 'nope', null, null, 0] });
    expect((await updateRow(db, d, 1, { Code: 'x' }, fr, now)).ok).toBe(true);
  });
});

describe('copyRows', () => {
  it('copies a WITHOUT ROWID table too (no rowid to order by: primary key order)', () => {
    db.exec('CREATE TABLE W (k TEXT PRIMARY KEY, v INTEGER) WITHOUT ROWID');
    db.exec("INSERT INTO W VALUES ('b', 2), ('a', 1)");
    db.exec('CREATE TABLE W2 (k TEXT, v INTEGER)');
    expect(copyRows(db, tableDesign(db, 'W'), 'W2')).toBe(2);
    expect(db.prepare('SELECT k, v FROM W2 ORDER BY rowid').all()).toEqual([{ k: 'a', v: 1 }, { k: 'b', v: 2 }]);
  });
});

describe('write layer: Limit To List (Lookup fields)', () => {
  const now = () => new Date(2026, 9, 22);
  const on = { enforceMask: true }; // datasheet and form entry (A2-R10): masks and lists
  const d = t('Commandes', [
    f('Client', 'number', { lookup: { kind: 'table', table: 'Clients', boundField: 'N°', displayFields: ['Nom'], limitToList: true } }),
    f('Statut', 'shortText', { lookup: { kind: 'values', values: ['Ouverte', 'Fermée'], limitToList: true } }),
    f('Note', 'shortText', { lookup: { kind: 'values', values: ['a'], limitToList: false } }),
    f('Qté', 'number', { lookup: { kind: 'values', values: ['1', '2'], limitToList: true } }),
    f('Le', 'dateTime', { lookup: { kind: 'values', values: ['01/01/2026'], limitToList: true } }), // no lookup on dates (Access)
  ]);
  beforeEach(async () => {
    createTable(db, d);
    expect((await insertRow(db, clients, { Nom: 'Dupont' }, fr)).ok).toBe(true);
  });

  it('a value absent from a value list or from the source table gives notInList, field by field', async () => {
    expect(await insertRow(db, d, { Client: '2', Statut: 'Autre', Qté: '3' }, fr, now, on)).toEqual({
      ok: false, errors: [{ field: 'Client', code: 'notInList' }, { field: 'Statut', code: 'notInList' }, { field: 'Qté', code: 'notInList' }],
    });
    expect(countRows(db, 'Commandes')).toBe(0);
  });

  it('values of the list pass, compared as stored; empty passes (Required decides); a list without Limit To List takes anything', async () => {
    expect(await insertRow(db, d, { Client: '1', Statut: 'Fermée', Qté: '02', Note: 'zzz', Le: '02/02/2026' }, fr, now, on))
      .toMatchObject({ ok: true, values: [1, 'Fermée', 'zzz', 2, '2026-02-02 00:00:00'] });
    expect((await insertRow(db, d, { Client: '', Statut: null }, fr, now, on)).ok).toBe(true);
  });

  it('a default value is not checked against the list: only what the user enters is (Access checks the combo box)', async () => {
    const e = t('Tickets', [f('Statut', 'shortText', { defaultValue: '"Brouillon"', lookup: { kind: 'values', values: ['Ouverte'], limitToList: true } })]);
    createTable(db, e);
    expect(await insertRow(db, e, {}, fr, now, on)).toMatchObject({ ok: true, values: ['Brouillon'] });
  });

  it('an update is checked too', async () => {
    await insertRow(db, d, { Statut: 'Ouverte' }, fr, now, on);
    expect(await updateRow(db, d, 1, { Statut: 'Autre' }, fr, now, on)).toEqual({ ok: false, errors: [{ field: 'Statut', code: 'notInList' }] });
    expect(await updateRow(db, d, 1, { Client: 1 }, fr, now, on)).toMatchObject({ ok: true });
  });

  it('a Number value list means the same in every region (items stored canonical)', async () => {
    const e = t('Stock', [f('Qté', 'number', { numberSize: 'double', lookup: { kind: 'values', values: ['1.5', '2.5'], limitToList: true } })]);
    createTable(db, e);
    const en = localeInfo('en-US'), de = localeInfo('de-DE'); // de: '.' groups digits
    expect(await insertRow(db, e, { Qté: '2,5' }, fr, now, on)).toMatchObject({ ok: true, values: [2.5] });
    expect(await insertRow(db, e, { Qté: '2.5' }, en, now, on)).toMatchObject({ ok: true, values: [2.5] });
    expect(await insertRow(db, e, { Qté: '2,5' }, de, now, on)).toMatchObject({ ok: true, values: [2.5] });
    expect(await insertRow(db, e, { Qté: '25' }, de, now, on)).toEqual({ ok: false, errors: [{ field: 'Qté', code: 'notInList' }] });
  });

  it('programmatic writes (import) are not checked, as in Access', async () => {
    expect((await insertRow(db, d, { Client: '9', Statut: 'Autre' }, fr, now)).ok).toBe(true);
  });

  it('Access columns: the bound column is checked (a value list read in rows, its heads left out); a Field List; SQL text (A3)', async () => {
    const pays = t('Pays', [f('Code', 'shortText', { primaryKey: true }), f('Nom', 'shortText')]);
    createTable(db, pays);
    await insertRow(db, pays, { Code: 'FR', Nom: 'France' }, fr);
    const e = t('Envois', [
      f('Statut', 'number', { lookup: { kind: 'values', values: ['Nom', 'N°', 'Ouverte', '1', 'Fermée', '2'], columnCount: 2, boundColumn: 2, columnHeads: true, limitToList: true } }),
      f('Pays', 'shortText', { lookup: { kind: 'table', table: 'Pays', boundColumn: 2, columnCount: 2, limitToList: true } }),
      f('Champ', 'shortText', { lookup: { kind: 'fieldList', table: 'Pays', limitToList: true } }),
      f('Sql', 'shortText', { lookup: { kind: 'table', table: 'SELECT Code FROM Pays', limitToList: true } }),
    ]);
    createTable(db, e);
    expect(await insertRow(db, e, { Statut: '2', Pays: 'France', Champ: 'Nom', Sql: 'FR' }, fr, now, on)).toMatchObject({ ok: true });
    expect(await insertRow(db, e, { Statut: 'N°', Pays: 'FR', Champ: 'Ville' }, fr, now, on)).toEqual({
      ok: false, errors: [{ field: 'Statut', code: 'invalidNumber' }],
    });
    expect(await insertRow(db, e, { Statut: '3', Pays: 'FR', Champ: 'Ville', Sql: 'zz' }, fr, now, on)).toEqual({
      ok: false, errors: [{ field: 'Statut', code: 'notInList' }, { field: 'Pays', code: 'notInList' }, { field: 'Champ', code: 'notInList' }, { field: 'Sql', code: 'notInList' }],
    });
  });

  it('a source table or bound field that is gone checks nothing', async () => {
    const pays = t('Pays', [f('Code', 'shortText', { primaryKey: true }), f('Nom', 'shortText')]);
    createTable(db, pays);
    const e = t('Envois', [f('Pays', 'shortText', { lookup: { kind: 'table', table: 'Pays', boundField: 'Code', displayFields: ['Nom'], limitToList: true } })]);
    createTable(db, e);
    expect(await insertRow(db, e, { Pays: 'FR' }, fr, now, on)).toEqual({ ok: false, errors: [{ field: 'Pays', code: 'notInList' }] });
    renameTable(db, 'Pays', 'Countries');
    expect((await insertRow(db, e, { Pays: 'FR' }, fr, now, on)).ok).toBe(true);
    expect(dropTable(db, 'Countries')).toEqual({ ok: true });
    expect((await insertRow(db, e, { Pays: 'DE' }, fr, now, on)).ok).toBe(true);
  });
});

describe('write layer: allowAutoNumber (A3 Append queries)', () => {
  it('an integer AutoNumber value is kept; Null or absent numbers it; without the option it is refused', async () => {
    expect(await insertRow(db, clients, { 'N°': 7, Nom: 'a' }, fr, undefined, { allowAutoNumber: true })).toMatchObject({ ok: true, rowid: 7 });
    expect(await insertRow(db, clients, { 'N°': null, Nom: 'b' }, fr, undefined, { allowAutoNumber: true })).toMatchObject({ ok: true, rowid: 8 });
    expect(await insertRow(db, clients, { 'N°': 7, Nom: 'c' }, fr, undefined, { allowAutoNumber: true })).toEqual({ ok: false, errors: [{ field: 'N°', code: 'duplicate' }] });
    expect(await insertRow(db, clients, { 'N°': 9, Nom: 'e' }, fr)).toEqual({ ok: false, errors: [{ field: 'N°', code: 'readOnly' }] });
  });
});

describe('write layer: nullOnConversion (A3 action queries run anyway)', () => {
  const d = t('Conv', [f('Code', 'number', { primaryKey: true }), f('N', 'number'), f('Le', 'dateTime'), f('Req', 'number', { required: true }),
    f('NN', 'number', { validationRule: 'Is Not Null' })]);
  const on = { nullOnConversion: true };
  beforeEach(() => createTable(db, d));

  it('a value the field cannot store becomes Null, reported; the record is kept', async () => {
    expect(await insertRow(db, d, { Code: 1, N: 'abc', Le: 'pas une date', Req: 1, NN: 2 }, fr, undefined, on))
      .toEqual({ ok: true, rowid: 1, values: [1, null, null, 1, 2], nulled: [{ field: 'N', code: 'invalidNumber' }, { field: 'Le', code: 'invalidDate' }] });
    expect(await updateRow(db, d, 1, { N: '99999999999' }, fr, undefined, on)).toMatchObject({ ok: true, nulled: [{ field: 'N', code: 'outOfRange' }] });
  });
  it('a Required field, a primary key (not AutoNumber) or an Is Not Null rule refuses the Null', async () => {
    expect(await insertRow(db, d, { Code: 2, Req: 'abc', NN: 1 }, fr, undefined, on)).toEqual({ ok: false, errors: [{ field: 'Req', code: 'required' }] });
    expect(await insertRow(db, d, { Code: 'abc', Req: 1, NN: 1 }, fr, undefined, on)).toEqual({ ok: false, errors: [{ field: 'Code', code: 'required' }] });
    expect(await insertRow(db, d, { Code: null, Req: 1, NN: 1 }, fr, undefined, on)).toEqual({ ok: false, errors: [{ field: 'Code', code: 'required' }] });
    expect(await insertRow(db, d, { Code: 3, Req: 1, NN: 'abc' }, fr, undefined, on)).toMatchObject({ ok: false, errors: [{ field: 'NN', code: 'validation' }] });
  });
  it('without the option a conversion error still refuses the row', async () => {
    expect(await insertRow(db, d, { Code: 4, Req: 1, NN: 1, N: 'abc' }, fr)).toEqual({ ok: false, errors: [{ field: 'N', code: 'invalidNumber' }] });
  });
});

describe('write layer: primary keys of adopted tables', () => {
  it('an absent key of a table made elsewhere is left to SQLite (its DEFAULT); a BaseCraft key never takes a Null', async () => {
    db.exec(`CREATE TABLE "Ext" ("id" TEXT PRIMARY KEY DEFAULT 'k1', "v" TEXT)`);
    const ext = tableDesign(db, 'Ext');
    expect(ext.fields[0]!.props).toMatchObject({ primaryKey: true, external: true });
    expect(await insertRow(db, ext, { v: 'a' }, fr)).toMatchObject({ ok: true, values: ['k1', 'a'] });
    const own = t('Own', [f('Code', 'shortText', { primaryKey: true }), f('v', 'shortText')]);
    createTable(db, own);
    expect(await insertRow(db, own, { v: 'a' }, fr)).toEqual({ ok: false, errors: [{ field: 'Code', code: 'required' }] });
    expect(await insertRow(db, own, { Code: null, v: 'a' }, fr)).toEqual({ ok: false, errors: [{ field: 'Code', code: 'required' }] });
  });
});

describe('write layer: optimistic locking (C3 R8, G3)', () => {
  // two connections a, b on one base; Clients row 3 = Durand Paris
  let a: DatabaseSync;
  let b: DatabaseSync;
  let d: ReturnType<typeof tableDesign>;
  const info = fr;
  const now = () => new Date();
  const orig = { 'N°': 3, Nom: 'Durand', Ville: 'Paris' };
  const read = (x: DatabaseSync, sql: string): unknown => Object.values(x.prepare(sql).get() as object)[0];
  beforeEach(() => {
    const p = path.join(dir, 'shared.basecraft');
    createBaseFile(p, '0.0.0');
    a = openBaseFile(p, 'write', '0.0.0').db;
    seedSales(a);
    d = tableDesign(a, 'Clients');
    b = new DatabaseSync(p);
  });
  afterEach(() => { b.close(); a.close(); });

  it('unchanged since read: saved', async () => expect((await updateRow(a, d, 3, { Ville: 'Lille' }, info, now, { expected: orig })).ok).toBe(true));
  it('changed by another connection: conflict with the current row, nothing written', async () => {
    b.prepare(`UPDATE Clients SET Ville = 'Brest' WHERE rowid = 3`).run();
    expect(await updateRow(a, d, 3, { Ville: 'Lille' }, info, now, { expected: orig }))
      .toEqual({ ok: false, conflict: 'changed', current: [3, 'Durand', 'Brest'] });
    expect(read(b, 'SELECT Ville FROM Clients WHERE rowid = 3')).toBe('Brest');
  });
  it('deleted by another connection', async () => {
    b.prepare('DELETE FROM Clients WHERE rowid = 3').run();
    expect(await updateRow(a, d, 3, { Ville: 'Lille' }, info, now, { expected: orig })).toEqual({ ok: false, conflict: 'deleted' });
  });
  it('Null and empty text differ; floats compare exactly', async () => {
    b.prepare(`UPDATE Clients SET Ville = '' WHERE rowid = 3`).run();
    expect(await updateRow(a, d, 3, { Ville: 'Lille' }, info, now, { expected: { ...orig, Ville: null } })).toMatchObject({ ok: false, conflict: 'changed' });
    expect(read(b, 'SELECT Ville FROM Clients WHERE rowid = 3')).toBe('');
    b.prepare('UPDATE Commandes SET Montant = ? WHERE rowid = 1').run(0.1 + 0.2);
    const cd = tableDesign(a, 'Commandes');
    expect((await updateRow(a, cd, 1, { Montant: '5' }, info, now, { expected: { Montant: 0.1 + 0.2 } })).ok).toBe(true);
    expect(await updateRow(a, cd, 1, { Montant: '6' }, info, now, { expected: { Montant: 0.3 } })).toMatchObject({ ok: false, conflict: 'changed' });
  });
  it('a name the design lacks is ignored; no expected keeps today\'s path', async () => {
    b.prepare(`UPDATE Clients SET Ville = 'Brest' WHERE rowid = 3`).run();
    expect((await updateRow(a, d, 3, { Ville: 'Lille' }, info, now, { expected: { Inconnu: 1 } })).ok).toBe(true);
    expect((await updateRow(a, d, 3, { Ville: 'Nantes' }, info, now)).ok).toBe(true);
    expect(read(b, 'SELECT Ville FROM Clients WHERE rowid = 3')).toBe('Nantes');
  });
  it('a table with a record rule: a deleted row is a conflict, not an error', async () => {
    const r = { ...d, validationRule: '[Nom] <> ""' };
    b.prepare('DELETE FROM Clients WHERE rowid = 3').run();
    expect(await updateRow(a, r, 3, { Ville: 'Lille' }, info, now, { expected: orig })).toEqual({ ok: false, conflict: 'deleted' });
  });
  it('a record rule broken by another workstation\'s change: the conflict, not the rule', async () => {
    const r = { ...d, validationRule: '[Ville] <> "Brest"' };
    b.prepare(`UPDATE Clients SET Ville = 'Brest' WHERE rowid = 3`).run();
    expect(await updateRow(a, r, 3, { Nom: 'Durant' }, info, now, { expected: orig }))
      .toEqual({ ok: false, conflict: 'changed', current: [3, 'Durand', 'Brest'] });
    expect(await updateRow(a, r, 3, { Nom: 'Durant' }, info, now)).toMatchObject({ ok: false, errors: [{ code: 'validation' }] }); // without expected: the rule
  });
});
