import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { createBaseFile, openBaseFile } from './file-format';
import { createTable } from './schema';
import { tableDesign } from './schema';
import { deleteRows, insertRow, updateRow } from './write-layer';
import { countRows } from './rows';
import { f, t, clients } from '../../shared/test-fixtures';
import { localeInfo } from '../../shared/locale-format';

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
