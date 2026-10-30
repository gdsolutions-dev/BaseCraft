import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import { join } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { createBaseFile, openBaseFile } from '../db/file-format';
import { renameObject, saveObject } from '../db/objects';
import { createTable, NameExistsError, renameTable } from '../db/schema';
import { f, t } from '../../shared/test-fixtures';
import { addLinks, findLink, isLinkName, linkRows, relinkRows, removeLink, resolveSourcePath, setLinkDescription, sourceRows } from './store';

// A 1.3 front-end in a temp folder, its data files beside it.
let dir: string;
let fe: string;
let db: DatabaseSync;
let data: string;
let data2: string;
let sqliteFile: string;
beforeEach(() => {
  dir = fs.realpathSync.native(fs.mkdtempSync(join(os.tmpdir(), 'bclink-')));
  fe = join(dir, 'Ventes.basecraft');
  data = join(dir, 'Ventes-donnees.basecraft');
  data2 = join(dir, 'Archives.basecraft');
  sqliteFile = join(dir, 'notes.sqlite');
  for (const p of [fe, data, data2]) createBaseFile(p, '0.0.0');
  fs.writeFileSync(sqliteFile, '');
  db = openBaseFile(fe, 'write', '0.0.0').db;
});
afterEach(() => {
  db.close();
  fs.rmSync(dir, { recursive: true, force: true });
});
const def = (sql: string) => ({ formatVersion: '1.0', sql });

describe('sources and links', () => {
  it('addLinks stores absolute and relative paths and reuses the source', () => {
    addLinks(db, fe, 'basecraft', data, ['Clients']);
    addLinks(db, fe, 'basecraft', data, ['Commandes']);
    expect(sourceRows(db)).toHaveLength(1);
    expect(sourceRows(db)[0]).toMatchObject({ kind: 'basecraft', path: data, relative: 'Ventes-donnees.basecraft' });
    expect(sourceRows(db)[0]!.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(linkRows(db)).toEqual([
      { name: 'Clients', sourceId: sourceRows(db)[0]!.id, remote: 'Clients' },
      { name: 'Commandes', sourceId: sourceRows(db)[0]!.id, remote: 'Commandes' },
    ]);
  });

  it.runIf(process.platform === 'win32')('a path differing only by case is the same source on Windows', () => {
    addLinks(db, fe, 'basecraft', data, ['Clients']);
    addLinks(db, fe, 'basecraft', data.toUpperCase(), ['Commandes']);
    expect(sourceRows(db)).toHaveLength(1);
    expect(sourceRows(db)[0]).toMatchObject({ kind: 'basecraft', path: data, relative: 'Ventes-donnees.basecraft' });
  });

  it('two files are two sources; a relative path keeps its folders with forward slashes', () => {
    fs.mkdirSync(join(dir, 'sub'));
    const inSub = join(dir, 'sub', 'd.basecraft');
    createBaseFile(inSub, '0.0.0');
    addLinks(db, fe, 'basecraft', data, ['Clients']);
    addLinks(db, fe, 'basecraft', inSub, ['Notes']);
    expect(sourceRows(db).map((s) => s.relative)).toEqual(['Ventes-donnees.basecraft', 'sub/d.basecraft']);
    expect(resolveSourcePath(sourceRows(db)[1]!, fe)).toBe(inSub);
  });

  it('the relative path wins when the pair moved together', () => {   // R5
    const s = { id: 'x', kind: 'basecraft', path: '/old/d.basecraft', relative: 'd.basecraft' };
    expect(resolveSourcePath(s, '/new/fe.basecraft', (p) => p === join('/new', 'd.basecraft'))).toBe(join('/new', 'd.basecraft'));
    expect(resolveSourcePath(s, '/new/fe.basecraft', () => false)).toBe('/old/d.basecraft');
    expect(resolveSourcePath({ ...s, relative: undefined }, '/new/fe.basecraft', () => true)).toBe('/old/d.basecraft');
  });

  it('a pair moved together reuses its source when one more table is linked', () => { // final review I1
    addLinks(db, fe, 'basecraft', data, ['Clients']);
    db.close();
    const sub = join(dir, 'moved');
    fs.mkdirSync(sub);
    const fe2 = join(sub, 'Ventes.basecraft');
    fs.renameSync(fe, fe2);
    fs.renameSync(data, join(sub, 'Ventes-donnees.basecraft'));
    db = openBaseFile(fe2, 'write', '0.0.0').db;
    addLinks(db, fe2, 'basecraft', join(sub, 'Ventes-donnees.basecraft'), ['Commandes']);
    expect(sourceRows(db)).toHaveLength(1);
    expect(new Set(linkRows(db).map((l) => l.sourceId)).size).toBe(1);
  });

  it('relinkRows moves links and drops an empty source', () => {
    addLinks(db, fe, 'basecraft', data, ['Clients', 'Commandes']);
    relinkRows(db, fe, ['clients', 'Commandes'], 'basecraft', data2);
    expect(sourceRows(db)).toHaveLength(1);
    expect(sourceRows(db)[0]).toMatchObject({ path: data2, relative: 'Archives.basecraft' });
    expect(linkRows(db).map((l) => [l.name, l.sourceId])).toEqual([['Clients', sourceRows(db)[0]!.id], ['Commandes', sourceRows(db)[0]!.id]]);
  });

  it('relinkRows of one link keeps the source the other still uses, and relinking onto the same file changes nothing', () => {
    addLinks(db, fe, 'basecraft', data, ['Clients', 'Commandes']);
    relinkRows(db, fe, ['Commandes'], 'basecraft', data2);
    expect(sourceRows(db).map((s) => s.path)).toEqual([data, data2]);
    const before = [sourceRows(db), linkRows(db)];
    relinkRows(db, fe, ['Commandes'], 'basecraft', data2);
    expect([sourceRows(db), linkRows(db)]).toEqual(before);
  });

  it('relinkRows is atomic: an unknown name changes nothing', () => {
    addLinks(db, fe, 'basecraft', data, ['Clients']);
    const before = [sourceRows(db), linkRows(db)];
    expect(() => relinkRows(db, fe, ['Clients', 'Zzz'], 'basecraft', data2)).toThrow('bc:notFound');
    expect([sourceRows(db), linkRows(db)]).toEqual(before);
  });

  it('removeLink drops its source only when it was the last link', () => {
    addLinks(db, fe, 'basecraft', data, ['Clients', 'Commandes']);
    removeLink(db, 'CLIENTS');
    expect(linkRows(db).map((l) => l.name)).toEqual(['Commandes']);
    expect(sourceRows(db)).toHaveLength(1);
    removeLink(db, 'Commandes');
    expect([linkRows(db), sourceRows(db)]).toEqual([[], []]);
    expect(() => removeLink(db, 'Commandes')).toThrow('bc:notFound');
  });

  it('findLink and isLinkName compare with sameName; a name stored as a BLOB is skipped', () => {
    addLinks(db, fe, 'sqlite', sqliteFile, ['Été']);
    expect(findLink(db, 'ÉTÉ')).toMatchObject({ name: 'Été', remote: 'Été' });
    expect(findLink(db, 'Autre')).toBeUndefined();
    expect(isLinkName(db, 'été')).toBe(true);
    expect(isLinkName(db, 'Autre')).toBe(false);
    db.prepare("INSERT INTO bc_links (name, source_id, remote_name) VALUES (?, 's', 'x')").run(new Uint8Array([1, 2]));
    expect(linkRows(db).map((l) => l.name)).toEqual(['Été']);
  });

  it('setLinkDescription sets and clears the description, keeping the other props', () => {
    addLinks(db, fe, 'basecraft', data, ['Clients']);
    db.exec(`UPDATE bc_links SET props = '{"x":1}'`);
    setLinkDescription(db, 'clients', 'Fichier des ventes');
    expect(findLink(db, 'Clients')).toMatchObject({ description: 'Fichier des ventes' });
    expect(db.prepare('SELECT props FROM bc_links').get()).toEqual({ props: '{"x":1,"description":"Fichier des ventes"}' });
    setLinkDescription(db, 'Clients', '');
    expect(findLink(db, 'Clients')!.description).toBeUndefined();
    expect(db.prepare('SELECT props FROM bc_links').get()).toEqual({ props: '{"x":1}' });
    setLinkDescription(db, 'Clients', 'd');
    setLinkDescription(db, 'Clients', null);
    expect(db.prepare('SELECT props FROM bc_links').get()).toEqual({ props: '{"x":1}' });
  });

  it('unknown kinds and props keys are kept', () => {
    db.exec(`INSERT INTO bc_sources VALUES ('pg', 'postgresql', '{"path":"db.example/ventes","x":1}');
      INSERT INTO bc_links VALUES ('Factures', 'pg', 'factures', '{"y":2}')`);
    const pg = () => [db.prepare("SELECT * FROM bc_sources WHERE id = 'pg'").get(), db.prepare("SELECT * FROM bc_links WHERE name = 'Factures'").get()];
    const before = pg();
    addLinks(db, fe, 'basecraft', data, ['Clients', 'Commandes']);
    relinkRows(db, fe, ['Clients'], 'basecraft', data2);
    removeLink(db, 'Commandes');
    expect(pg()).toEqual(before);
    expect(sourceRows(db).find((s) => s.id === 'pg')).toMatchObject({ kind: 'postgresql', path: 'db.example/ventes' });
    expect(findLink(db, 'Factures')).toMatchObject({ sourceId: 'pg', remote: 'factures' });
    removeLink(db, 'Clients');
    expect(sourceRows(db).map((s) => s.id)).toEqual(['pg']); // an unrelated source with no link of its own is not ours to delete
  });

  it('a damaged row (props not an object, path missing) reads as an empty path, never throws', () => {
    db.exec(`INSERT INTO bc_sources VALUES ('a', 'basecraft', 'nope'), ('b', 'sqlite', '[1]'), ('c', 'sqlite', '{"path":3,"relative":4}')`);
    expect(sourceRows(db)).toEqual([{ id: 'a', kind: 'basecraft', path: '' }, { id: 'b', kind: 'sqlite', path: '' }, { id: 'c', kind: 'sqlite', path: '' }]);
  });
});

describe('the tables namespace', () => {
  it('a link takes a name in the tables namespace', () => {
    addLinks(db, fe, 'sqlite', sqliteFile, ['Notes']);
    expect(() => createTable(db, t('Notes', [f('x', 'shortText')]))).toThrow(NameExistsError);
    expect(() => createTable(db, t('NOTES', [f('x', 'shortText')]))).toThrow(NameExistsError);
    expect(saveObject(db, 'query', 'notes', def('SELECT 1'), null)).toEqual({ ok: false, reason: 'nameExists' });
  });

  it('renaming a table or a query onto a link name is refused', () => {
    addLinks(db, fe, 'sqlite', sqliteFile, ['Notes']);
    createTable(db, t('Autre', [f('x', 'shortText')]));
    expect(() => renameTable(db, 'Autre', 'notes')).toThrow(NameExistsError);
    expect(saveObject(db, 'query', 'Q', def('SELECT 1'), null)).toEqual({ ok: true });
    expect(renameObject(db, 'query', 'Q', 'NOTES')).toEqual({ ok: false, reason: 'nameExists' });
    expect(saveObject(db, 'query', 'Q', def('SELECT 2'), 'Q')).toEqual({ ok: true });
    expect(saveObject(db, 'form', 'Notes', def('x'), null)).toEqual({ ok: true }); // forms have their own namespace
  });
});
