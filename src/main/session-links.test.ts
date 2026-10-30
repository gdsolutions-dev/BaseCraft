import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs, { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import { join, posix } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createBaseFile, openBaseFile } from './db/file-format';
import type { RiskProbe } from './db/location-risk';
import { createTable } from './db/schema';
import { presenceEntry } from './db/presence';
import { saveStartupOptions } from './db/startup';
import { addLinks } from './links/store';
import { seedSales, seedSalesRelation } from './query/test-db';
import { ReadOnlyError, Session, type SessionDeps } from './session';
import { expectedValues } from './ipc-validate';
import { defaultSpec } from '../shared/import-text';
import { localeInfo } from '../shared/locale-format';
import { clients, f, t } from '../shared/test-fixtures';
import type { ImportTexts } from './import/text-import';
import type { SaveTableRequest, SessionState } from '../shared/api';
import { DEFAULT_STARTUP } from '../shared/startup';

// A front-end with a local Notes, linked to data.basecraft (seedSales + its relation) and to plain.sqlite (T, W).
let dir: string;
let fe: string;
let fe2: string;
let data: string;
let plain: string;
let s: Session;
const opened: Session[] = [];
const probe: RiskProbe = { platform: 'win32', env: {}, homedir: 'C:\\Users\\x', windowsDriveType: () => 3 };
const deps: SessionDeps = { appVersion: '0.0.0', region: 'fr-FR', probe, lockDeps: { now: () => 0 }, sessionId: 'a' };
const open = (p: string, d: Partial<SessionDeps> = {}) => { const x = Session.open(p, { ...deps, ...d }); opened.push(x); return x; };
const readBack = (p: string, sql: string): unknown => {
  const db = new DatabaseSync(p, { readOnly: true });
  try { return Object.values(db.prepare(sql).get() as object)[0]; } finally { db.close(); }
};
const tablesOf = (p: string) => {
  const db = new DatabaseSync(p, { readOnly: true });
  try { return (db.prepare(`SELECT name FROM sqlite_master WHERE type = 'table'`).all() as { name: string }[]).map((r) => r.name); } finally { db.close(); }
};
function frontEnd(p: string, local: boolean): void {
  createBaseFile(p, '0.0.0');
  const db = openBaseFile(p, 'write', '0.0.0').db;
  if (local) createTable(db, t('Notes', [f('N°', 'autoNumber'), f('Texte', 'shortText')]));
  addLinks(db, p, 'basecraft', data, ['Clients', 'Commandes']);
  addLinks(db, p, 'sqlite', plain, ['T', 'W']);
  db.close();
}

beforeEach(() => {
  dir = fs.realpathSync.native(fs.mkdtempSync(join(os.tmpdir(), 'bclinks-')));
  fe = join(dir, 'front.basecraft');
  fe2 = join(dir, 'front2.basecraft');
  data = join(dir, 'data.basecraft');
  plain = join(dir, 'plain.sqlite');
  createBaseFile(data, '0.0.0');
  const d = openBaseFile(data, 'write', '0.0.0').db;
  seedSales(d);
  seedSalesRelation(d);
  d.close();
  const p = new DatabaseSync(plain);
  p.exec(`CREATE TABLE T (id INTEGER PRIMARY KEY, n INTEGER); CREATE TABLE W (k TEXT PRIMARY KEY) WITHOUT ROWID; CREATE VIEW V AS SELECT 1;
    INSERT INTO T VALUES (1, 'abc')`);
  p.close();
  frontEnd(fe, true);
  frontEnd(fe2, false);
  s = open(fe);
});
afterEach(() => {
  for (const x of opened.splice(0)) x.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('linked tables in the session (C1 Task 3)', () => {
  it('a linked .basecraft is read and written through its own rules', async () => {
    expect(s.listTables().map((x) => [x.name, x.link?.kind])).toEqual([['Clients', 'basecraft'], ['Commandes', 'basecraft'], ['Notes', undefined], ['T', 'sqlite'], ['W', 'sqlite']]);
    expect(s.listTables().find((x) => x.name === 'T')!.link).toEqual({ kind: 'sqlite', path: plain });
    expect(existsSync(`${data}.lock`)).toBe(false); // listing opens no linked file (R3)
    expect(s.page('Clients', { offset: 0, limit: 10 }).rows).toHaveLength(4);
    expect(s.count('Clients')).toBe(4);
    expect(await s.update('Commandes', 1, { Montant: '0' })).toMatchObject({ ok: false }); // the data file's rule >0
    expect(await s.update('Clients', 3, { Ville: 'Marseille' })).toMatchObject({ ok: true });
    expect(readBack(data, 'SELECT Ville FROM Clients WHERE rowid = 3')).toBe('Marseille');
    expect(await s.insert('Clients', { Nom: 'Neuf' })).toMatchObject({ ok: true });
    expect(s.delete('Clients', [5])).toEqual({ ok: true, count: 1 });
    expect(readBack(data, 'SELECT count(*) FROM Clients')).toBe(4);
    expect(s.tableDesign('Commandes').fields.find((x) => x.name === 'Montant')!.props.validationRule).toBe('>0');
    expect(s.describeSource({ kind: 'table', name: 'Clients' })).toMatchObject({ updatable: true, keyTable: 'Clients' });
    expect(s.pageSource({ kind: 'table', name: 'Clients' }, { offset: 0, limit: 2 }).total).toBe(4);
    expect(s.cascadeChildren('Clients')).toEqual([]);
  });

  it('writing a link holds the data file\'s lock; a second session reads only', async () => { // R4, Review Focus 2
    const changes: SessionState[] = [];
    s.close();
    const a = open(fe, { sessionId: 'c', onStateChanged: (x) => changes.push(x) });
    a.page('Clients', { offset: 0, limit: 1 });
    expect(a.state.linkedLocks).toEqual([data]);
    expect(changes.at(-1)?.linkedLocks).toEqual([data]);
    expect(existsSync(`${data}.lock`)).toBe(true);
    const s2 = open(fe2, { sessionId: 'b' });
    expect(s2.describeSource({ kind: 'table', name: 'Clients' }).updatable).toBe(false);
    await expect(s2.insert('Clients', { Nom: 'X' })).rejects.toThrow(ReadOnlyError);
    a.close();
    expect(existsSync(`${data}.lock`)).toBe(false);
  });

  it('a plain SQLite file is used as it is and never gets bc_ tables', async () => { // R7, Review Focus 5
    const before = readFileSync(plain);
    expect(s.tableDesign('T').fields.map((x) => x.props.external)).toEqual([true, true]);
    expect(s.page('T', { offset: 0, limit: 5 }).rows[0]!.values).toEqual([1, 'abc']);
    expect(readFileSync(plain)).toEqual(before);
    expect(s.describeSource({ kind: 'table', name: 'W' }).updatable).toBe(false);
    expect(s.describeSource({ kind: 'table', name: 'T' }).updatable).toBe(true);
    expect(await s.insert('T', { n: '7' })).toMatchObject({ ok: true });
    expect(readBack(plain, 'SELECT n FROM T WHERE id = 2')).toBe(7);
    expect(tablesOf(plain)).toEqual(['T', 'W']);
    expect(readBack(plain, 'PRAGMA journal_mode')).toBe('delete');
  });

  it('a BLOB in a linked SQLite table: the record as read passes IPC; another field saves, a changed BLOB conflicts', async () => { // C3 R8
    const blobs = join(dir, 'blobs.sqlite');
    const b = new DatabaseSync(blobs);
    b.exec(`CREATE TABLE B (id INTEGER PRIMARY KEY, n INTEGER, b BLOB); INSERT INTO B VALUES (1, 1, x'0102')`);
    b.close();
    expect(s.createLinks(blobs, ['B'])).toMatchObject({ ok: true });
    const record = () => {
      const names = s.tableDesign('B').fields.map((x) => x.name);
      const row = s.page('B', { offset: 0, limit: 1 }).rows[0]!;
      return expectedValues(Object.fromEntries(names.map((n, i) => [n, row.values[i]]))); // what the datasheet sends
    };
    const read = record()!;
    expect(read.b).toEqual(new Uint8Array([1, 2]));
    expect(await s.update('B', 1, { n: '2' }, read)).toMatchObject({ ok: true });
    const again = record()!; // editing begins again
    const w = new DatabaseSync(blobs);
    w.exec(`UPDATE B SET b = x'0103'`); // another workstation
    w.close();
    expect(await s.update('B', 1, { n: '3' }, again)).toMatchObject({ ok: false, conflict: 'changed', current: [1, 2, new Uint8Array([1, 3])] });
    expect(readBack(blobs, 'SELECT n FROM B')).toBe(2);
  });

  it('a missing data file fails its links only', () => { // R3, Review Focus 1
    renameSync(data, `${data}.moved`);
    expect(() => s.page('Clients', { offset: 0, limit: 1 })).toThrow(`bc:linkUnavailable|missingFile|${data}`);
    expect(s.page('Notes', { offset: 0, limit: 1 }).rows).toEqual([]);
    expect(s.page('T', { offset: 0, limit: 1 }).rows).toHaveLength(1);
  });

  it('a data file that no longer holds the table fails with missingTable', () => {
    const d = new DatabaseSync(data);
    d.exec('DROP TABLE Commandes');
    d.close();
    expect(() => s.page('Commandes', { offset: 0, limit: 1 })).toThrow(`bc:linkUnavailable|missingTable|${data}`);
  });

  it('an older data file is refused, never migrated', () => {
    const d = new DatabaseSync(data);
    d.exec(`UPDATE bc_meta SET value = '0' WHERE key = 'format_major'`); // an older major: a front-end never migrates it
    d.close();
    const before = readFileSync(data);
    expect(() => s.page('Clients', { offset: 0, limit: 1 })).toThrow(`bc:linkUnavailable|needsMigration|${data}`);
    expect(readFileSync(data)).toEqual(before);
    expect(fs.readdirSync(dir).filter((n) => n.includes('backup'))).toEqual([]);
  });

  it('an older minor data file (1.2) is used as it is (PF3)', async () => {
    const d = new DatabaseSync(data);
    d.exec(`DROP TABLE bc_links; DROP TABLE bc_sources; UPDATE bc_meta SET value = '2' WHERE key = 'format_minor'`);
    d.close();
    expect(await s.update('Clients', 3, { Ville: 'Nice' })).toMatchObject({ ok: true });
    expect(readBack(data, `SELECT value FROM bc_meta WHERE key = 'format_minor'`)).toBe('2');
    expect(tablesOf(data)).not.toContain('bc_links');
  });

  it('writing through a link never stamps the data file\'s app_version', async () => { // review I1
    s.close();
    const v = open(fe, { appVersion: '9.9.9', sessionId: 'v' });
    expect(await v.update('Clients', 3, { Ville: 'Brest' })).toMatchObject({ ok: true });
    expect(readBack(data, 'SELECT Ville FROM Clients WHERE rowid = 3')).toBe('Brest');
    expect(readBack(data, `SELECT value FROM bc_meta WHERE key = 'app_version'`)).toBe('0.0.0');
  });

  it('structure belongs to the data file', async () => { // R8
    expect(() => s.renameTable('Clients', 'C2')).toThrow('bc:linkedTable');
    await expect(s.testRules('Clients')).rejects.toThrow('bc:linkedTable');
    await expect(s.saveTable({ originalName: 'Clients', design: clients, mapping: [], allowDataLoss: false })).rejects.toThrow('bc:linkedTable');
    expect(() => s.copyTable('Clients', 'C2')).toThrow('bc:linkedTable');
    expect(s.copyTable('Notes', 'clients')).toEqual({ ok: false, reason: 'nameExists' }); // final review M3: the namespace's answer
    await expect(s.appendTable('Notes', 'Clients')).rejects.toThrow('bc:linkedTable');
    const spec = { ...defaultSpec(localeInfo('fr-FR')), fields: [] };
    expect(() => s.importRun(plain, { spec, target: { kind: 'append', table: 'Clients', mapping: [] } }, {} as ImportTexts)).toThrow('bc:linkedTable');
    await expect(s.importExcelRun(plain, 'S', true, { spec, target: { kind: 'append', table: 'T', mapping: [] } }, {} as ImportTexts)).rejects.toThrow('bc:linkedTable');
    expect(s.setDescription('table', 'Clients', 'Les clients')).toEqual({ ok: true });
    expect(s.listTables().find((x) => x.name === 'Clients')!.description).toBe('Les clients');
    expect(s.dropTable('Clients')).toEqual({ ok: true });
    expect(tablesOf(data)).toContain('Clients');
    expect(s.listTables().some((x) => x.name === 'Clients')).toBe(false);
  });

  it('a linked table appends into a local one, read on its own connection', async () => {
    createTable((s as unknown as { db: DatabaseSync }).db, t('Copie', [f('Nom', 'shortText')]));
    expect(await s.appendTable('Clients', 'Copie')).toEqual({ appended: 4, refused: 0 });
  });

  it('relations of linked tables are listed, marked linked', () => { // R11
    renameSync(plain, `${plain}.moved`); // a failing source contributes none
    expect(s.listRelations().map((r) => [r.parentTable, r.childTable, r.linked])).toEqual([['Clients', 'Commandes', true]]);
  });

  it('the local-only list (the Relationships window) opens no linked file and takes no lock', () => { // R11
    expect(s.listRelations({ localOnly: true }).every((r) => !r.linked)).toBe(true);
    expect(s.state.linkedLocks).toBeUndefined();
    expect(existsSync(`${data}.lock`)).toBe(false);
    expect(s.listRelations().some((r) => r.linked)).toBe(true); // the full list opens them
    expect(existsSync(`${data}.lock`)).toBe(true);
  });

  it('a commit to the data file by another connection invalidates cached totals and snapshots', () => {
    const req = { offset: 0, limit: 10, sort: { field: 'Nom', dir: 'asc' as const } }; // a text sort: served from a snapshot
    expect(s.page('Clients', req).rows).toHaveLength(4);
    const d = new DatabaseSync(data);
    d.prepare(`INSERT INTO Clients (Nom) VALUES ('Zoé')`).run();
    d.close();
    expect(s.page('Clients', req).rows).toHaveLength(5);
  });

  it('a read-only front-end takes no data file lock', async () => {
    writeFileSync(`${fe}.lock`, JSON.stringify({ user: 'u', host: os.hostname(), pid: 1, sessionId: 'z', heartbeatAt: new Date(0).toISOString() }));
    s.close();
    const r = open(fe, { sessionId: 'b' });
    expect(r.state.readOnly).toBe(true);
    expect(r.page('Clients', { offset: 0, limit: 10 }).rows).toHaveLength(4);
    expect(existsSync(`${data}.lock`)).toBe(false);
    expect(r.state.linkedLocks).toBeUndefined();
    expect(r.describeSource({ kind: 'table', name: 'Clients' }).updatable).toBe(false);
    await expect(r.update('Clients', 1, { Ville: 'x' })).rejects.toThrow(ReadOnlyError);
  });

  it('a front-end that loses its lock closes its links (their locks released)', () => {
    s.page('Clients', { offset: 0, limit: 1 });
    expect(existsSync(`${data}.lock`)).toBe(true);
    writeFileSync(`${fe}.lock`, JSON.stringify({ user: 'u', host: os.hostname(), pid: 1, sessionId: 'z', heartbeatAt: new Date(0).toISOString() }));
    s.tick();
    expect(s.state).toMatchObject({ readOnly: true, readOnlyReason: 'lockLost' });
    expect(s.state.linkedLocks).toBeUndefined();
    expect(existsSync(`${data}.lock`)).toBe(false);
    expect(s.page('Clients', { offset: 0, limit: 10 }).rows).toHaveLength(4); // reopened read-only
    expect(existsSync(`${data}.lock`)).toBe(false);
  });
});

describe('queries over linked tables (C1 Task 4, R10)', () => {
  const join = 'SELECT Commandes.[N°], Nom, Montant FROM Clients INNER JOIN Commandes ON Clients.[N°] = Commandes.Client';
  const def = (sql: string) => ({ formatVersion: '1.0', sql });
  const run = (sql: string) => s.runAction({ kind: 'sql', sql }, {}, { skipFailures: false, replaceTable: false });
  const notes = () => s.page('Notes', { offset: 0, limit: 10 }).rows.length;

  it('a parameter query over links runs on the data file', () => {
    const r = s.pageSource({ kind: 'sql', sql: 'SELECT Nom, Montant FROM Clients INNER JOIN Commandes ON Clients.[N°] = Commandes.Client WHERE Ville = [V]' },
      { offset: 0, limit: 50, params: { V: 'Lyon' } });
    expect(r.rows.map((x) => x[1])).toEqual([10.1, 0.1, 0.2, 0.1]); // Lyon and LYON (Access comparison)
    expect(s.describeSource({ kind: 'sql', sql: join })).toMatchObject({ updatable: true, keyTable: 'Commandes' });
  });

  it('a saved query over links is stored in the front-end and runs on the data file', () => {
    expect(s.saveObject('query', 'QLies', def('SELECT Nom FROM Clients WHERE Ville = "Paris";'), null)).toEqual({ ok: true });
    expect(s.pageSource({ kind: 'query', name: 'QLies' }, { offset: 0, limit: 10 }).rows).toEqual([['Durand']]);
    expect(readBack(data, `SELECT count(*) FROM bc_objects WHERE name = 'QLies'`)).toBe(0);
  });

  it('a join query over links saves through the data file (B4)', async () => {
    const ref = { kind: 'sql' as const, sql: join };
    expect(await s.saveSource(ref, { rowid: 1, values: { Montant: '5' } })).toMatchObject({ ok: true });
    expect(readBack(data, 'SELECT Montant FROM Commandes WHERE rowid = 1')).toBe(5);
    expect(await s.saveSource(ref, { rowid: 1, values: { Montant: '0' } })).toMatchObject({ ok: false }); // the data file's rule >0
    expect(s.autoLookup({ kind: 'sql', sql: 'SELECT Client, Nom, Montant FROM Clients INNER JOIN Commandes ON Clients.[N°] = Commandes.Client' }, { Client: '3' }))
      .toMatchObject({ Nom: 'Durand' });
  });

  it('an UPDATE over a link writes the data file through the write layer', async () => {
    s.setContentEnabled(s.activeContent().fingerprint);
    expect(await s.actionCount({ kind: 'sql', sql: 'UPDATE Clients SET Ville = "X" WHERE [N°] = 4' }, {})).toEqual({ count: 1, table: 'Clients' });
    expect(await run('UPDATE Clients SET Ville = "X" WHERE [N°] = 4')).toEqual({ ok: true, count: 1 });
    expect(readBack(data, 'SELECT Ville FROM Clients WHERE rowid = 4')).toBe('X');
    expect(await run('UPDATE Commandes SET Montant = 0')).toMatchObject({ ok: false, reason: 'rowErrors' }); // its rule, nothing written
    expect(readBack(data, 'SELECT count(*) FROM Commandes WHERE Montant = 0')).toBe(0);
    expect(await run('INSERT INTO Notes (Texte) VALUES ("local")')).toEqual({ ok: true, count: 1 }); // a local one still writes the front-end
    expect(notes()).toBe(1);
  });

  it('an action over a link on a read-only front-end is refused readOnly', async () => {
    writeFileSync(`${fe}.lock`, JSON.stringify({ user: 'u', host: os.hostname(), pid: 1, sessionId: 'z', heartbeatAt: new Date(0).toISOString() }));
    s.close();
    const r = open(fe, { sessionId: 'b' });
    expect(r.state.readOnly).toBe(true);
    r.setContentEnabled(r.activeContent().fingerprint);
    expect(await r.runAction({ kind: 'sql', sql: 'UPDATE Clients SET Ville = "X"' }, {}, { skipFailures: false, replaceTable: false })).toEqual({ ok: false, reason: 'readOnly' });
    expect(readBack(data, `SELECT count(*) FROM Clients WHERE Ville = 'X'`)).toBe(0);
  });

  it('a query over a link another session holds is read-only', () => { // final review I2
    s.page('Clients', { offset: 0, limit: 1 }); // s holds data's lock
    const s2 = open(fe2, { sessionId: 'b' });
    expect(s2.describeSource({ kind: 'sql', sql: 'SELECT * FROM Clients' }).updatable).toBe(false);
    expect(s2.describeSource({ kind: 'sql', sql: join }).updatable).toBe(false);
    expect(s.describeSource({ kind: 'sql', sql: 'SELECT * FROM Clients' }).updatable).toBe(true);
  });

  it('a mixed query cannot be saved', () => {
    expect(() => s.saveObject('query', 'QX', def('SELECT * FROM Notes, Clients'), null)).toThrow(/\|mixedSources\|Clients$/);
    expect(s.listObjects('query')).toEqual([]);
  });

  it('a form source in SQL mixing sources is refused', () => {
    expect(() => s.describeSource({ kind: 'sql', sql: 'SELECT * FROM Notes, Clients' })).toThrow(/\|mixedSources\|Clients$/);
    expect(() => s.pageSource({ kind: 'sql', sql: 'SELECT * FROM Notes, Clients' }, { offset: 0, limit: 5 })).toThrow(/\|mixedSources\|Clients$/);
  });

  it('a combo box Row Source joining both is refused', () => {
    const sql = 'SELECT Nom, Texte FROM Clients INNER JOIN Notes ON Clients.Nom = Notes.Texte';
    expect(() => s.describeSource({ kind: 'sql', sql })).toThrow(/\|mixedSources\|Notes$/);
    expect(() => s.pageSource({ kind: 'sql', sql }, { offset: 0, limit: 5 })).toThrow(/\|mixedSources\|Notes$/);
  });

  it('a local query using a saved query over links is refused', () => {
    expect(s.saveObject('query', 'QLies', def('SELECT Nom FROM Clients;'), null)).toEqual({ ok: true });
    const sql = 'SELECT Texte FROM Notes INNER JOIN QLies ON Notes.Texte = QLies.Nom';
    expect(() => s.pageSource({ kind: 'sql', sql }, { offset: 0, limit: 5 })).toThrow(/\|mixedSources\|QLies$/);
    expect(() => s.saveObject('query', 'QY', def(sql), null)).toThrow(/\|mixedSources\|QLies$/);
    expect(() => s.pageSource({ kind: 'sql', sql: 'SELECT Texte FROM Notes WHERE Texte IN (SELECT Nom FROM Clients)' }, { offset: 0, limit: 5 }))
      .toThrow(/\|mixedSources\|Clients$/);
    expect(() => s.pageSource({ kind: 'sql', sql: 'SELECT Texte FROM Notes UNION SELECT Nom FROM Clients' }, { offset: 0, limit: 5 })).toThrow(/\|mixedSources\|Clients$/);
  });

  it('mixed or make-table action queries write nothing (PF4)', async () => {
    s.setContentEnabled(s.activeContent().fingerprint);
    const before = readFileSync(data);
    await expect(run('INSERT INTO Notes (Texte) SELECT Nom FROM Clients')).rejects.toThrow(/\|mixedSources\|Clients$/);
    await expect(run('INSERT INTO Clients (Nom) SELECT Texte FROM Notes')).rejects.toThrow(/\|mixedSources\|Notes$/);
    await expect(run('SELECT Nom INTO Copie FROM Clients')).rejects.toThrow(/\|mixedSources\|Copie$/);
    await expect(s.actionCount({ kind: 'sql', sql: 'SELECT Nom INTO Copie FROM Clients' }, {})).rejects.toThrow(/\|mixedSources\|Copie$/);
    expect(notes()).toBe(0);
    expect(s.listTables().map((x) => x.name)).not.toContain('Copie');
    expect(tablesOf(data)).not.toContain('Copie');
    expect(readFileSync(data)).toEqual(before);
  });

  it('a crosstab over links runs on the data file; a mixed one is refused', () => {
    const x = 'TRANSFORM Sum(Montant) SELECT Client FROM Commandes GROUP BY Client PIVOT Month(Le)';
    expect(s.describeSource({ kind: 'sql', sql: x }).fields.map((fd) => fd.name)).toEqual(['Client', '9', '10']);
    expect(s.pageSource({ kind: 'sql', sql: x }, { offset: 0, limit: 10 }).rows).toHaveLength(3);
    expect(() => s.describeSource({ kind: 'sql', sql: 'TRANSFORM Count(*) SELECT Texte FROM Notes, Commandes GROUP BY Texte PIVOT Client' }))
      .toThrow(/\|mixedSources\|Commandes$/);
  });

  it('a linked table without a real rowid reads, read-only (R7)', () => {
    const p = new DatabaseSync(plain);
    p.exec(`INSERT INTO W VALUES ('b'), ('a')`);
    p.close();
    expect(s.page('W', { offset: 0, limit: 10, sort: { field: 'k', dir: 'asc' } }).rows.map((r) => r.values)).toEqual([['a'], ['b']]);
    expect(s.count('W')).toBe(2);
    expect(s.pageSource({ kind: 'table', name: 'W' }, { offset: 0, limit: 10 })).toMatchObject({ rowids: [null, null], total: 2 });
    expect(s.describeSource({ kind: 'sql', sql: 'SELECT k FROM W' }).updatable).toBe(false);
    expect(s.pageSource({ kind: 'sql', sql: 'SELECT k FROM W WHERE k = "a"' }, { offset: 0, limit: 10 }).rows).toEqual([['a']]);
  });
});

describe('link operations (C1 Task 5)', () => {
  const lockOf = (p: string) => JSON.parse(readFileSync(`${p}.lock`, 'utf8')) as { sessionId: string };
  const foreignLock = (p: string) => writeFileSync(`${p}.lock`, JSON.stringify({ user: 'u', host: 'PC-2', pid: 1, sessionId: 'z', heartbeatAt: new Date(0).toISOString() }));
  const pathsOf = (x: Session, names: string[]) => x.listLinks().filter((l) => names.includes(l.name)).map((l) => l.path);
  let other: string;
  beforeEach(() => {
    other = join(dir, 'other.sqlite');
    const o = new DatabaseSync(other);
    o.exec(`CREATE TABLE Notes (a); CREATE TABLE T2 (id INTEGER PRIMARY KEY, n); CREATE TABLE W2 (k TEXT PRIMARY KEY) WITHOUT ROWID;
      CREATE VIEW V AS SELECT 1; CREATE TABLE bc_x (a); CREATE VIRTUAL TABLE R USING rtree(id, x0, x1)`);
    o.close();
  });

  it('inspect lists real tables only', () => { // Review Focus 5
    const before = readFileSync(other);
    expect(s.inspectLinkFile(other)).toEqual({ kind: 'sqlite', tables: [{ name: 'Notes', taken: true }, { name: 'T2', taken: false }, { name: 'W2', taken: false }] });
    expect(readFileSync(other)).toEqual(before);
    expect(s.inspectLinkFile(plain)).toEqual({ kind: 'sqlite', tables: [{ name: 'T', taken: true }, { name: 'W', taken: true }] }); // no V
    expect(s.inspectLinkFile(data).kind).toBe('basecraft');
    expect(existsSync(`${data}.lock`)).toBe(false); // no lock
    const textFile = join(dir, 'x.txt');
    writeFileSync(textFile, 'not a database');
    expect(() => s.inspectLinkFile(textFile)).toThrow(`bc:linkUnavailable|cannotOpen|${textFile}`);
    expect(() => s.inspectLinkFile(fe)).toThrow(`bc:linkUnavailable|self|${fe}`); // the dialog says it before any table is ticked
  });

  it('create refuses the front-end itself and taken names', async () => { // R2
    expect(s.createLinks(fe, ['Notes'])).toEqual({ ok: false, reason: 'self', names: [] });
    expect(s.createLinks(other, ['Notes', 'T2'])).toEqual({ ok: false, reason: 'nameExists', names: ['Notes'] });
    expect(s.createLinks(other, ['T2', 'V', 'bc_x', 'Absent'])).toEqual({ ok: false, reason: 'missingTables', names: ['V', 'bc_x', 'Absent'] });
    expect(s.createLinks(other, ['T2', 'W2'])).toEqual({ ok: true });
    expect(s.listTables().find((x) => x.name === 'T2')!.link).toEqual({ kind: 'sqlite', path: other });
    expect(await s.insert('T2', { n: '1' })).toMatchObject({ ok: true });
    expect(s.createLinks(other, ['T2'])).toEqual({ ok: false, reason: 'nameExists', names: ['T2'] }); // links too
    s.saveObject('query', 'Q', { formatVersion: '1.0', sql: 'SELECT Texte FROM Notes' }, null);
    const q = new DatabaseSync(other);
    q.exec('CREATE TABLE Q (a)');
    q.close();
    expect(s.createLinks(other, ['Q'])).toEqual({ ok: false, reason: 'nameExists', names: ['Q'] }); // queries too
  });

  it('a moved pair links one more table into the same source; a join across both works', () => { // final review I1, R5
    const fe3 = join(dir, 'front3.basecraft');
    createBaseFile(fe3, '0.0.0');
    const db = openBaseFile(fe3, 'write', '0.0.0').db;
    addLinks(db, fe3, 'basecraft', data, ['Clients']);
    db.close();
    const sub = join(dir, 'moved');
    fs.mkdirSync(sub);
    renameSync(fe3, join(sub, 'front3.basecraft'));
    renameSync(data, join(sub, 'data.basecraft'));
    const m = open(join(sub, 'front3.basecraft'));
    expect(m.createLinks(join(sub, 'data.basecraft'), ['Commandes'])).toEqual({ ok: true });
    expect(new Set(m.listLinks().map((l) => l.path))).toEqual(new Set([join(sub, 'data.basecraft')]));
    expect(m.pageSource({ kind: 'sql', sql: 'SELECT Nom, Montant FROM Clients INNER JOIN Commandes ON Clients.[N°] = Commandes.Client' }, { offset: 0, limit: 50 }).rows.length).toBeGreaterThan(0);
  });

  it('list opens each source and tells its state', () => {
    const d = new DatabaseSync(data);
    d.exec('DROP TABLE Commandes');
    d.close();
    renameSync(plain, `${plain}.moved`);
    expect(s.listLinks().map((l) => [l.name, l.kind, l.path, l.state, l.risk])).toEqual([
      ['Clients', 'basecraft', data, 'ok', 'local'], ['Commandes', 'basecraft', data, 'missingTable', 'local'],
      ['T', 'sqlite', plain, 'missingFile', 'local'], ['W', 'sqlite', plain, 'missingFile', 'local'],
    ]);
    expect(s.state.linkedLocks).toEqual([data]); // R4 write rule
  });

  it('relink moves a whole source, or one table, and refuses a file missing a table', () => { // R9
    const d2 = join(dir, 'd2.basecraft');
    fs.copyFileSync(data, d2);
    s.page('Clients', { offset: 0, limit: 1 });
    expect(existsSync(`${data}.lock`)).toBe(true);
    expect(s.relink(['Clients', 'Commandes'], d2)).toEqual({ ok: true });
    expect(pathsOf(s, ['Clients', 'Commandes'])).toEqual([d2, d2]);
    expect(existsSync(`${data}.lock`)).toBe(false); // the source left was closed
    expect(s.state.linkedLocks).toEqual([d2, plain]); // listLinks opened every source
    expect(s.relink(['Clients'], plain)).toEqual({ ok: false, reason: 'missingTables', names: ['Clients'] });
    expect(s.relink(['Clients'], fe)).toEqual({ ok: false, reason: 'self', names: [] });
    expect(s.relink(['Clients'], data)).toEqual({ ok: true }); // relocate one table
    expect(pathsOf(s, ['Clients', 'Commandes'])).toEqual([data, d2]);
    expect(() => s.relink(['Nope'], data)).toThrow('bc:notFound');
  });

  it('a query over a missing link saves once relinked', () => { // Task 4 carry
    const moved = join(dir, 'moved.basecraft');
    renameSync(data, moved);
    expect(() => s.saveObject('query', 'Q', { formatVersion: '1.0', sql: 'SELECT Nom FROM Clients' }, null)).toThrow('bc:linkUnavailable|missingFile|');
    expect(s.relink(['Clients', 'Commandes'], moved)).toEqual({ ok: true });
    expect(s.saveObject('query', 'Q', { formatVersion: '1.0', sql: 'SELECT Nom FROM Clients' }, null)).toEqual({ ok: true });
  });

  it('refresh takes a stale lock over', () => { // R4, R13
    s.close();
    let now = 0;
    const r = open(fe, { sessionId: 'c', lockDeps: { now: () => now } });
    foreignLock(data);
    expect(r.listLinks().find((l) => l.name === 'Clients')).toMatchObject({ state: 'readOnly', stale: false, holder: { sessionId: 'z' } });
    now = 31_000; // observed 31 s of this reader's clock
    expect(r.listLinks().find((l) => l.name === 'Clients')!.state).toBe('readOnly'); // listing never takes over
    const got = r.refreshLinks(['Clients']);
    expect(got.map((l) => [l.name, l.state])).toEqual([['Clients', 'ok']]);
    expect(lockOf(data).sessionId).toBe('c');
    expect(r.state.linkedLocks).toEqual([plain, data]); // listLinks opened plain; data reopened
    expect(() => r.refreshLinks(['Nope'])).toThrow('bc:notFound');
  });

  it('convert copies structure and rows and removes the link, atomically', () => { // R12
    s.page('Clients', { offset: 0, limit: 1 });
    expect(s.convertLink('Commandes')).toEqual({ ok: true });
    expect(s.listTables().find((x) => x.name === 'Commandes')!.link).toBeUndefined();
    expect(s.page('Commandes', { offset: 0, limit: 10 }).rows.map((r) => r.rowid)).toEqual([1, 2, 3, 4, 5]);
    expect(s.tableDesign('Commandes').fields.find((x) => x.name === 'Montant')!.props.validationRule).toBe('>0');
    expect(s.tableDesign('Commandes').fields.some((x) => x.props.external)).toBe(false);
    expect(tablesOf(fe)).toContain('Commandes');
    expect(readBack(data, 'SELECT count(*) FROM Commandes')).toBe(5);
    expect(existsSync(`${data}.lock`)).toBe(true); // Clients still uses that source
    expect(s.convertLink('Clients')).toEqual({ ok: true });
    expect(existsSync(`${data}.lock`)).toBe(false); // its last link gone: closed
    expect(s.state.linkedLocks).toBeUndefined();
    expect(s.convertLink('Notes')).toEqual({ ok: false, reason: 'notFound' });
  });

  it('convert refuses rows the local table cannot hold and changes nothing', () => {
    expect(() => s.convertLink('T')).toThrow('bc:unsupportedTable'); // 'abc' in INTEGER n
    expect(s.listTables().find((x) => x.name === 'T')!.link).toEqual({ kind: 'sqlite', path: plain });
    expect(tablesOf(fe)).not.toContain('T');
    expect(() => s.convertLink('W')).toThrow('bc:unsupportedTable'); // WITHOUT ROWID
  });

  it('a read-only front-end lists and refreshes its links but changes none', () => {
    writeFileSync(`${fe}.lock`, JSON.stringify({ user: 'u', host: os.hostname(), pid: 1, sessionId: 'z', heartbeatAt: new Date(0).toISOString() }));
    s.close();
    const r = open(fe, { sessionId: 'b' });
    expect(r.listLinks().map((l) => l.state)).toEqual(['readOnly', 'readOnly', 'readOnly', 'readOnly']);
    expect(r.refreshLinks(['T']).map((l) => l.state)).toEqual(['readOnly']);
    expect(existsSync(`${data}.lock`)).toBe(false);
    expect(() => r.createLinks(other, ['T2'])).toThrow(ReadOnlyError);
    expect(() => r.relink(['Clients'], data)).toThrow(ReadOnlyError);
    expect(() => r.convertLink('Clients')).toThrow(ReadOnlyError);
  });

  it('a local object an older BaseCraft named like a link wins; the link is unusable', () => { // ruling (Task 2 carry)
    const front = (s as unknown as { db: DatabaseSync }).db;
    front.exec(`CREATE TABLE Clients (x); INSERT INTO Clients VALUES ('local')`);
    front.prepare(`INSERT INTO bc_objects (kind, name, definition, created, modified) VALUES ('query', 'W', '{"sql":"SELECT 1"}', '', '')`).run();
    expect(s.listTables().filter((x) => ['Clients', 'W'].includes(x.name))).toEqual([{ name: 'Clients' }]);
    expect(s.listLinks().map((l) => l.name)).toEqual(['Commandes', 'T']);
    expect(s.inspectLinkFile(data).tables.find((x) => x.name === 'Clients')!.taken).toBe(true);
    expect(s.page('Clients', { offset: 0, limit: 5 }).rows.map((r) => r.values)).toEqual([['local']]);
    expect(() => s.refreshLinks(['Clients'])).toThrow('bc:notFound');
    expect(() => s.relink(['W'], plain)).toThrow('bc:notFound');
    expect(s.convertLink('Clients')).toEqual({ ok: false, reason: 'notFound' });
    expect(s.listRelations().filter((r) => r.linked)).toEqual([]); // Commandes' parent is the local Clients now
  });
});

describe('links to a shared data file (C3 Task 5, R2, R3, R6)', () => {
  // data is a data file (dataFile: true); s is front-end 1 (session a), f2 front-end 2 (session b)
  const dd = (sessionId: string): SessionDeps => ({ ...deps, sessionId, presence: { settleMs: 0 } });
  let f2: Session;
  const foreignLock = (p: string) => writeFileSync(`${p}.lock`, JSON.stringify({ user: 'u', host: 'PC-2', pid: 1, sessionId: 'z', heartbeatAt: new Date(0).toISOString() }));
  const addField = (x: Session, table: string, name: string): SaveTableRequest => {
    const d = x.tableDesign(table);
    return { originalName: table, design: { ...d, fields: [...d.fields, f(name, 'shortText')] },
      mapping: [...d.fields.map((y) => ({ name: y.name, sourceName: y.name })), { name, sourceName: null }], allowDataLoss: false };
  };
  const markDataFile = (p: string) => {
    const db = openBaseFile(p, 'write', '0.0.0').db;
    try { saveStartupOptions(db, { ...DEFAULT_STARTUP, dataFile: true }); } finally { db.close(); }
  };
  /** The front-end's source of `data` stored as `p` only (no relative path). */
  const storeSourceAs = (front: string, p: string) => {
    const db = new DatabaseSync(front);
    try { db.prepare(`UPDATE bc_sources SET props = json_object('path', ?) WHERE kind = 'basecraft'`).run(p); } finally { db.close(); }
  };
  beforeEach(() => {
    markDataFile(data);
    f2 = open(fe2, { sessionId: 'b' });
  });

  it('two front-ends write the same data file through their links', async () => {
    expect((await s.update('Clients', 3, { Ville: 'Lille' })).ok).toBe(true);
    expect((await f2.update('Clients', 1, { Ville: 'Brest' })).ok).toBe(true);
    expect(s.state.linkedLocks).toEqual([presenceEntry(data, 'a')]);
    expect(existsSync(`${data}.lock`)).toBe(false);
    expect(s.listLinks().find((l) => l.name === 'Clients')).toMatchObject({ state: 'ok', shared: true });
    expect(s.listLinks().find((l) => l.name === 'T')!.shared).toBeUndefined();
    expect(readBack(data, 'SELECT Ville FROM Clients WHERE rowid = 1')).toBe('Brest');
    s.close();
    expect(existsSync(join(`${data}.users`, 'a.lock'))).toBe(false);
    expect(existsSync(join(`${data}.users`, 'b.lock'))).toBe(true);
  });

  it("a front-end's stamp moves when another front-end commits to the data file", async () => { // C3 R10
    s.page('Clients', { offset: 0, limit: 1 }); // the link's source opened: the baseline counts it
    const st = s.dataStamp();
    expect((await s.update('Clients', 3, { Ville: 'Lille' })).ok).toBe(true);
    expect(s.dataStamp()).toBe(st);
    expect((await f2.update('Clients', 1, { Ville: 'Brest' })).ok).toBe(true);
    expect(s.dataStamp()).not.toBe(st);
  });

  it('the designer holding the data file exclusively makes the links read-only, named', async () => { // Review Focus 3
    const d = open(data, { ...dd('d'), openMode: 'exclusive' });
    expect(d.state).toMatchObject({ readOnly: false });
    expect(s.listLinks()[0]).toMatchObject({ state: 'readOnly', holder: { sessionId: 'd' } });
    expect(existsSync(join(`${data}.users`, 'a.lock'))).toBe(false); // the entry written before the lock check is released
    await expect(s.insert('Clients', { Nom: 'X' })).rejects.toThrow(ReadOnlyError);
    d.close();
  });

  it('a front-end present blocks the designer\'s field', async () => {
    s.page('Clients', { offset: 0, limit: 1 });
    const d = open(data, dd('d'));
    await expect(d.saveTable(addField(d, 'Clients', 'Tel'))).rejects.toThrow('bc:dataFileInUse');
    s.close();
    expect(await d.saveTable(addField(d, 'Clients', 'Tel'))).toEqual({ ok: true });
  });

  it('a stale exclusive lock reads only until Refresh takes it over', () => { // R4, R13
    s.close();
    let now = 0;
    const r = open(fe, { sessionId: 'c', lockDeps: { now: () => now } });
    foreignLock(data);
    expect(r.listLinks()[0]).toMatchObject({ state: 'readOnly', stale: false, holder: { sessionId: 'z' } });
    now = 31_000; // observed 31 s of this reader's clock
    expect(r.refreshLinks(['Clients'])[0]).toMatchObject({ state: 'ok', shared: true });
    expect(existsSync(`${data}.lock`)).toBe(false);
    expect(r.state.linkedLocks).toEqual([plain, presenceEntry(data, 'c')]); // listLinks opened plain; data reopened shared
  });

  it('a linked data file in a synchronized folder is read-only', () => { // R6
    s.close();
    const x = open(fe, { sessionId: 'c', probe: { ...probe, env: { OneDrive: dir } } });
    expect(x.listLinks()[0]).toMatchObject({ state: 'syncedFolder', risk: 'synced' });
    expect(x.count('Clients')).toBe(4);
    expect(existsSync(`${data}.users`)).toBe(false);
  });

  it('a Linux client links a data file on a network location read-only', () => { // R6, G1
    // the probe is posix: the source stored in its forward-slash form, a cifs mount line for its folder (as Task 4's test)
    s.close();
    const posixData = data.replace(/\\/g, '/');
    storeSourceAs(fe, posixData);
    const mounts = `//srv/share ${posix.dirname(posixData).replace(/ /g, '\\040')} cifs rw,vers=3.1.1 0 0\n`;
    const x = open(fe, { sessionId: 'c', probe: { ...probe, platform: 'linux', mounts } });
    expect(x.listLinks()[0]).toMatchObject({ state: 'unsupportedClient', risk: 'network' });
    expect(existsSync(`${data}.users`)).toBe(false);
  });
});

describe("the Runtime's front-end (C3 Task 10, R14, R15)", () => {
  const markFrontEnd = (p: string) => {
    const db = openBaseFile(p, 'write', '0.0.0').db;
    try { saveStartupOptions(db, { ...DEFAULT_STARTUP, frontEnd: true }); } finally { db.close(); }
  };
  const run = (x: Session, sql: string) => x.runAction({ kind: 'sql', sql }, {}, { skipFailures: false, replaceTable: false });

  it("a copy's links find the data file beside the original", () => { // Review Focus 5: the absolute path no longer holds
    const db = new DatabaseSync(fe2);
    try { db.prepare(`UPDATE bc_sources SET props = json_set(props, '$.path', ?) WHERE kind = 'basecraft'`).run(join(dir, 'gone', 'data.basecraft')); } finally { db.close(); }
    fs.mkdirSync(join(dir, 'cache'));
    const copy = join(dir, 'cache', 'front2.basecraft');
    fs.copyFileSync(fe2, copy);
    const alone = open(copy, { sessionId: 'c' });
    expect(() => alone.page('Clients', { offset: 0, limit: 10 })).toThrow('bc:linkUnavailable');
    alone.close();
    const x = open(copy, { sessionId: 'c', origin: fe2 });
    expect(x.page('Clients', { offset: 0, limit: 10 }).rows).toHaveLength(4);
    expect(x.listTables().find((t) => t.name === 'Clients')!.link!.path).toBe(data);
    expect(x.state).toMatchObject({ path: copy, origin: fe2, fileName: 'front2.basecraft', readOnly: false });
    expect(existsSync(`${copy}.lock`)).toBe(true); // the lock is the copy's
    expect(existsSync(`${fe2}.lock`)).toBe(false);
  });

  it("a front-end's local tables are read-only in the Runtime", async () => { // R15
    s.close();
    markFrontEnd(fe);
    const x = open(fe, { runtime: true });
    await expect(x.insert('Notes', { Texte: '1' })).rejects.toThrow(ReadOnlyError);
    expect((await x.insert('Clients', { Nom: 'X' })).ok).toBe(true); // a link: writable
    expect(x.describeSource({ kind: 'table', name: 'Notes' }).updatable).toBe(false);
    expect(x.describeSource({ kind: 'sql', sql: 'SELECT * FROM Notes' }).updatable).toBe(false);
    x.setContentEnabled(x.activeContent().fingerprint);
    expect(await run(x, 'DELETE FROM Notes')).toEqual({ ok: false, reason: 'readOnly' });
    x.close();
    const full = open(fe); // the full application, run mode included, still writes them
    expect((await full.insert('Notes', { Texte: '1' })).ok).toBe(true);
  });
});
