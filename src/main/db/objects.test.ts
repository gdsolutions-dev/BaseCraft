import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { createBaseFile, openBaseFile } from './file-format';
import { copyObject, deleteObject, getObject, listObjects, renameObject, saveObject } from './objects';
import { createTable, listTables, NameExistsError, renameTable } from './schema';
import { alterTable } from './alter';
import { clients, f, t } from '../../shared/test-fixtures';
import { localeInfo } from '../../shared/locale-format';

let dir: string;
let db: DatabaseSync;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bcobj-'));
  const p = path.join(dir, 'o.basecraft');
  createBaseFile(p, '0.0.0');
  db = openBaseFile(p, 'write', '0.0.0').db;
});
afterEach(() => {
  db.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

const def = { formatVersion: '1.0', sections: [], future: { kept: true } };

describe('objects', () => {
  it('saves, lists and gets an object, unknown keys kept', () => {
    expect(saveObject(db, 'form', 'Saisie', def, null)).toEqual({ ok: true });
    expect(getObject(db, 'form', 'SAISIE')).toEqual({ name: 'Saisie', definition: def });
    const [o] = listObjects(db);
    expect(o).toEqual({ kind: 'form', name: 'Saisie', description: null, navGroup: null, created: o!.created, modified: o!.created });
    expect(o!.created).toMatch(/^\d{4}-\d\d-\d\dT/);
    expect(listObjects(db, 'report')).toEqual([]);
    expect(getObject(db, 'report', 'Saisie')).toBeNull();
  });

  it('lists by kind then name, accents and case folded', () => {
    for (const n of ['b', 'Été', 'a']) saveObject(db, 'report', n, def, null);
    saveObject(db, 'form', 'z', def, null);
    expect(listObjects(db).map((o) => `${o.kind}:${o.name}`)).toEqual(['form:z', 'report:a', 'report:b', 'report:Été']);
  });

  it('updates in place, keeping created, description and group', () => {
    saveObject(db, 'query', 'Q', def, null);
    db.exec("UPDATE bc_objects SET description = 'd', nav_group = 'g', created = '2000-01-01T00:00:00.000Z'");
    expect(saveObject(db, 'query', 'q', { formatVersion: '1.0', x: 1 }, 'Q')).toEqual({ ok: true }); // case-only rename
    expect(getObject(db, 'query', 'q')).toEqual({ name: 'q', definition: { formatVersion: '1.0', x: 1 } });
    expect(listObjects(db, 'query')[0]).toMatchObject({ name: 'q', description: 'd', navGroup: 'g', created: '2000-01-01T00:00:00.000Z' });
    expect(listObjects(db, 'query')).toHaveLength(1);
    expect(saveObject(db, 'query', 'X', def, 'Absent')).toEqual({ ok: false, reason: 'notFound' });
  });

  it('refuses invalid and reserved names', () => {
    for (const n of ['', ' x', 'a.b', 'a[b]', 'bc_x', 'SQLITE_x']) expect(saveObject(db, 'form', n, def, null)).toEqual({ ok: false, reason: 'nameInvalid' });
    saveObject(db, 'form', 'F', def, null);
    expect(renameObject(db, 'form', 'F', 'a!b')).toEqual({ ok: false, reason: 'nameInvalid' });
    expect(copyObject(db, 'form', 'F', '')).toEqual({ ok: false, reason: 'nameInvalid' });
  });

  it('a name is unique within a kind (Unicode case ignored)', () => {
    saveObject(db, 'form', 'Été', def, null);
    expect(saveObject(db, 'form', 'ÉTÉ', def, null)).toEqual({ ok: false, reason: 'nameExists' });
    expect(saveObject(db, 'report', 'ÉTÉ', def, null)).toEqual({ ok: true }); // forms and reports: separate namespaces
    saveObject(db, 'form', 'Autre', def, null);
    expect(saveObject(db, 'form', 'été', def, 'Autre')).toEqual({ ok: false, reason: 'nameExists' });
    expect(renameObject(db, 'form', 'Autre', 'été')).toEqual({ ok: false, reason: 'nameExists' });
  });

  it('tables and queries share one namespace, both ways', async () => {
    createTable(db, clients);
    expect(saveObject(db, 'query', 'CLIENTS', def, null)).toEqual({ ok: false, reason: 'nameExists' });
    expect(saveObject(db, 'form', 'Clients', def, null)).toEqual({ ok: true }); // a form may share a table's name
    saveObject(db, 'query', 'Requête', def, null);
    expect(renameObject(db, 'query', 'Requête', 'clients')).toEqual({ ok: false, reason: 'nameExists' });
    expect(copyObject(db, 'query', 'Requête', 'Clients')).toEqual({ ok: false, reason: 'nameExists' });
    expect(() => createTable(db, t('REQUÊTE', [f('N', 'autoNumber')]))).toThrow(NameExistsError);
    expect(() => renameTable(db, 'Clients', 'requête')).toThrow(NameExistsError);
    await expect(alterTable(db, 'Clients', { ...clients, name: 'requête' }, clients.fields.map((x) => ({ name: x.name, sourceName: x.name })),
      { allowDataLoss: false, info: localeInfo('fr-FR') })).rejects.toThrow(NameExistsError);
  });

  it('renames, copies and deletes', () => {
    saveObject(db, 'report', 'R', def, null);
    db.exec("UPDATE bc_objects SET description = 'd', nav_group = 'g'");
    expect(renameObject(db, 'report', 'r', 'R2')).toEqual({ ok: true });
    expect(getObject(db, 'report', 'R')).toBeNull();
    expect(copyObject(db, 'report', 'R2', 'R3')).toEqual({ ok: true });
    expect(getObject(db, 'report', 'R3')).toEqual({ name: 'R3', definition: def });
    expect(listObjects(db, 'report').find((o) => o.name === 'R3')).toMatchObject({ description: 'd', navGroup: 'g' });
    expect(copyObject(db, 'report', 'R2', 'r3')).toEqual({ ok: false, reason: 'nameExists' });
    expect(deleteObject(db, 'report', 'r2')).toEqual({ ok: true });
    expect(listObjects(db, 'report').map((o) => o.name)).toEqual(['R3']);
    expect(deleteObject(db, 'report', 'R2')).toEqual({ ok: false, reason: 'notFound' });
    expect(renameObject(db, 'report', 'R2', 'X')).toEqual({ ok: false, reason: 'notFound' });
    expect(copyObject(db, 'report', 'R2', 'X')).toEqual({ ok: false, reason: 'notFound' });
  });

  it('a table and a query sharing a name (older app, external tool): each can still be saved under its own name', async () => {
    createTable(db, clients);
    db.exec("INSERT INTO bc_objects VALUES ('query', 'Clients', '{}', NULL, NULL, 'a', 'a')");
    expect(saveObject(db, 'query', 'Clients', def, 'Clients')).toEqual({ ok: true });
    expect(renameObject(db, 'query', 'Clients', 'CLIENTS')).toEqual({ ok: true }); // case only: itself
    const same = clients.fields.map((x) => ({ name: x.name, sourceName: x.name }));
    expect(await alterTable(db, 'Clients', clients, same, { allowDataLoss: false, info: localeInfo('fr-FR') })).toEqual({ ok: true });
  });

  it('a stored definition that is not a JSON object, or beyond the save limits, rejects bc:corruptObject', () => {
    saveObject(db, 'form', 'F', def, null);
    const deep = '{"a":'.repeat(70) + '1' + '}'.repeat(70);
    for (const bad of ['{oops', '[1]', 'null', '3', deep, '{"__proto__": {"x": 1}}', `{"s": "${'x'.repeat(8 * 1024 * 1024)}"}`]) {
      db.prepare("UPDATE bc_objects SET definition = ? WHERE name = 'F'").run(bad);
      expect(() => getObject(db, 'form', 'F'), bad).toThrow(/^bc:corruptObject$/);
    }
  });

  it('a name is normalized to NFC before it is checked (64 characters once composed)', () => {
    const decomposed = 'e\u0301'.repeat(40); // 80 code points, 40 once composed
    expect(saveObject(db, 'form', decomposed, def, null)).toEqual({ ok: true });
    expect(listObjects(db, 'form').map((o) => o.name)).toEqual(['é'.repeat(40)]);
    expect(copyObject(db, 'form', 'é'.repeat(40), 'a\u0301'.repeat(40))).toEqual({ ok: true });
    expect(renameObject(db, 'form', 'á'.repeat(40), 'o\u0301'.repeat(40))).toEqual({ ok: true });
  });

  it('names are stored in NFC and compared in NFC', () => {
    const nfd = 'e\u0301te\u0301'; // été, decomposed
    expect(saveObject(db, 'form', nfd, def, null)).toEqual({ ok: true });
    expect(listObjects(db, 'form').map((o) => o.name)).toEqual(['été']);
    expect(getObject(db, 'form', 'ÉTÉ')).toMatchObject({ name: 'été' });
    expect(saveObject(db, 'form', 'été', def, null)).toEqual({ ok: false, reason: 'nameExists' });
    createTable(db, t(nfd, [f('N', 'autoNumber')]));
    expect(listTables(db).map((x) => x.name)).toEqual(['été']);
    expect(saveObject(db, 'query', 'été', def, null)).toEqual({ ok: false, reason: 'nameExists' });
    expect(() => createTable(db, t('Été', [f('N', 'autoNumber')]))).toThrow(NameExistsError);
  });

  it('a name an external tool stored as a BLOB is skipped by every reader', () => {
    saveObject(db, 'query', 'Q', def, null);
    db.prepare("INSERT INTO bc_objects VALUES ('query', ?, '{}', NULL, NULL, 'a', 'a')").run(new Uint8Array([1, 2]));
    expect(listObjects(db, 'query').map((o) => o.name)).toEqual(['Q']);
    expect(getObject(db, 'query', 'Q')).toMatchObject({ name: 'Q' });
    expect(() => createTable(db, t('Autre', [f('N', 'autoNumber')]))).not.toThrow(); // isQueryName reads the names
    expect(saveObject(db, 'query', 'R', def, null)).toEqual({ ok: true });
  });

  it('the schema refuses an unknown kind', () => {
    expect(() => db.exec("INSERT INTO bc_objects VALUES ('table', 'x', '{}', NULL, NULL, 'a', 'a')")).toThrow(/CHECK/);
  });
});
