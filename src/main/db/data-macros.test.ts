// Data macros (T2) on a real temp base: the events run inside the write's transaction through the write layer.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createBaseFile, openBaseFile } from './file-format';
import { createTable, getDataMacros, setDataMacros, tableDesign } from './schema';
import { deleteRowsWithMacros, insertRow, updateRow } from './write-layer';
import { countRows } from './rows';
import { f, t, clients } from '../../shared/test-fixtures';
import { localeInfo } from '../../shared/locale-format';
import type { DataMacros } from '../../shared/macro/data-macro';
import type { MacroDef, MacroItem } from '../../shared/macro/model';

let dir: string;
let db: DatabaseSync;
const fr = localeInfo('fr-FR');
const def = (...items: MacroItem[]): MacroDef => ({ formatVersion: '1.0', items });
const act = (action: string, args: Record<string, string> = {}): MacroItem => ({ k: 'action', action, args });
const when = (cond: string, ...items: MacroItem[]): MacroItem => ({ k: 'if', branches: [{ cond, items }] });
const journal = t('Journal', [f('Id', 'autoNumber'), f('Texte', 'shortText', { size: 100 })]);
const texts = () => (db.prepare('SELECT Texte FROM Journal ORDER BY Id').all() as { Texte: string }[]).map((r) => r.Texte);
const use = (dm: DataMacros) => expect(setDataMacros(db, 'Clients', dm)).toBe(true);

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bcdm-'));
  const p = path.join(dir, 'test.basecraft');
  createBaseFile(p, '0.0.0');
  db = openBaseFile(p, 'write', '0.0.0').db;
  createTable(db, clients);
  createTable(db, journal);
});
afterEach(() => {
  try { db.close(); } catch { /* already closed */ }
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('data macros in the write layer', () => {
  it('are stored with the table metadata, outside the design, and survive a design save', () => {
    const dm: DataMacros = { events: { beforeChange: def(act('StopMacro')) }, named: { N: def(act('StopMacro')) } };
    use(dm);
    expect(getDataMacros(db, 'Clients')).toEqual(dm);
    expect(tableDesign(db, 'Clients').extra).toBeUndefined();
    expect(setDataMacros(db, 'Nope', dm)).toBe(false);
    use({});
    expect(getDataMacros(db, 'Clients')).toEqual({});
  });

  it('Before Change: RaiseError refuses an insert and an update with its message, nothing is written', async () => {
    use({ events: { beforeChange: def(when('IsNull([Email])', act('RaiseError', { ErrorDescription: 'Email is required' }))) } });
    const r = await insertRow(db, clients, { Nom: 'a' }, fr);
    expect(r).toEqual({ ok: false, errors: [{ field: '', code: 'validation', message: 'Email is required', table: 'Clients' }] });
    expect(countRows(db, 'Clients')).toBe(0);
    expect((await insertRow(db, clients, { Nom: 'a', Email: 'a@b' }, fr)).ok).toBe(true);
    expect(await updateRow(db, clients, 1, { Email: null }, fr)).toMatchObject({ ok: false, errors: [{ message: 'Email is required' }] });
    expect(db.prepare('SELECT Email FROM Clients').get()).toEqual({ Email: 'a@b' });
  });

  it('Before Change: SetField changes the row, on insert and update; [Old] is the row before', async () => {
    use({ events: { beforeChange: def(
      act('SetField', { Name: 'Nom', Value: 'UCase([Nom])' }),
      when('[Solde] < [Old].[Solde]', act('RaiseError', { ErrorDescription: 'Solde cannot decrease' })),
      when('IsNull([Old].[Nom])', act('SetField', { Name: 'Email', Value: '"new"' }))) } });
    const r = await insertRow(db, clients, { Nom: 'dupont', Solde: '10' }, fr);
    expect(r).toMatchObject({ ok: true, values: [1, 'DUPONT', null, 0, 10, 'new'] });
    expect(await updateRow(db, clients, 1, { Nom: 'martin' }, fr)).toMatchObject({ ok: true, values: [1, 'MARTIN', null, 0, 10, 'new'] });
    expect(await updateRow(db, clients, 1, { Solde: '5' }, fr)).toMatchObject({ ok: false, errors: [{ message: 'Solde cannot decrease' }] });
  });

  it('a SetField value the field cannot store is the usual field error; rules still apply to it', async () => {
    use({ events: { beforeChange: def(act('SetField', { Name: 'Âge', Value: '999' })) } });
    expect(await insertRow(db, clients, { Nom: 'a' }, fr)).toEqual({ ok: false, errors: [{ field: 'Âge', code: 'outOfRange' }] });
  });

  it('a failing macro (bad field, unknown action) refuses the write', async () => {
    use({ events: { beforeChange: def(act('SetField', { Name: 'Nope', Value: '1' })) } });
    expect(await insertRow(db, clients, { Nom: 'a' }, fr)).toMatchObject({ ok: false });
    const bad = { events: { beforeChange: def(act('RunSQL', { SQLStatement: 'DROP TABLE Clients' })) } } as DataMacros;
    db.prepare("UPDATE bc_tables SET props = json_set(props, '$.dataMacros', json(?)) WHERE name = 'Clients'").run(JSON.stringify(bad));   // stored by a tool that skipped the check
    expect(await insertRow(db, clients, { Nom: 'a' }, fr)).toMatchObject({ ok: false });
    expect(countRows(db, 'Clients')).toBe(0);
    expect(db.prepare("SELECT name FROM sqlite_master WHERE name = 'Clients'").get()).toBeDefined();
  });

  it('Before Delete: RaiseError refuses the whole delete; After Delete runs after it', async () => {
    for (const n of ['a', 'b', 'c']) await insertRow(db, clients, { Nom: n }, fr);
    use({ events: {
      beforeDelete: def(when('[Nom] = "b"', act('RaiseError', { ErrorDescription: 'b is protected' }))),
      afterDelete: def(act('CreateRecord', { TableName: 'Journal', Values: 'Texte = "deleted " & [Nom]' })) } });
    expect(await deleteRowsWithMacros(db, clients, [1, 2], fr)).toEqual({ ok: false, reason: 'dataMacro', message: 'b is protected' });
    expect(countRows(db, 'Clients')).toBe(3);
    expect(texts()).toEqual([]);
    expect(await deleteRowsWithMacros(db, clients, [1, 3], fr)).toEqual({ ok: true, count: 2 });
    expect(texts()).toEqual(['deleted a', 'deleted c']);
  });

  it('After Insert / After Update create rows in another table in the same transaction', async () => {
    use({ events: {
      afterInsert: def(act('CreateRecord', { TableName: 'Journal', Values: 'Texte = "new " & [Nom]' })),
      afterUpdate: def(when('[Nom] <> [Old].[Nom]', act('CreateRecord', { TableName: 'journal', Values: 'Texte = [Old].[Nom] & " -> " & [Nom]' }))) } });
    await insertRow(db, clients, { Nom: 'a' }, fr);
    await updateRow(db, clients, 1, { Nom: 'b' }, fr);
    await updateRow(db, clients, 1, { Solde: '3' }, fr);
    expect(texts()).toEqual(['new a', 'a -> b']);
  });

  it('a refused CreateRecord does not undo the write; a failing After macro is not the write\'s', async () => {
    use({ events: { afterInsert: def(act('CreateRecord', { TableName: 'Journal', Values: 'Texte = [Nom]' })) } });
    db.exec('ALTER TABLE Journal ADD COLUMN Req TEXT NOT NULL DEFAULT 1');
    expect((await insertRow(db, clients, { Nom: 'a' }, fr)).ok).toBe(true);
    use({ events: { afterInsert: def(act('RaiseError', { ErrorDescription: 'late' })) } });
    expect((await insertRow(db, clients, { Nom: 'b' }, fr)).ok).toBe(true);
    expect(countRows(db, 'Clients')).toBe(2);
  });

  it('an After macro that writes into its own table stops at the depth limit (10)', async () => {
    use({ events: { afterInsert: def(act('CreateRecord', { TableName: 'Clients', Values: 'Nom = "x"' })) } });
    expect((await insertRow(db, clients, { Nom: 'a' }, fr)).ok).toBe(true);
    expect(countRows(db, 'Clients')).toBe(11);   // the macro runs at 10 levels: the 11th insert is written, its macro is refused
  });

  it('a table without macros, and a delete without them, are written as before', async () => {
    expect((await insertRow(db, clients, { Nom: 'a' }, fr)).ok).toBe(true);
    expect(await deleteRowsWithMacros(db, clients, [1], fr)).toEqual({ ok: true, count: 1 });
  });
});
