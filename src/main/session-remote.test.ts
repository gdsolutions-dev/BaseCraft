import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import { join } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { createBaseFile, openBaseFile } from './db/file-format';
import type { RiskProbe } from './db/location-risk';
import { saveObject } from './db/objects';
import { listRelations } from './db/relations';
import { createTable } from './db/schema';
import { addLinks, addServerLinks } from './links/store';
import { linkMeta } from './links/meta';
import { ReadOnlyError, Session, type SessionDeps } from './session';
import type { RemoteTable } from './connectors/connector';
import { testConnector } from './connectors/test-connector';
import { CONNECTORS } from './connectors/registry';
import { f, t } from '../shared/test-fixtures';
import type { QueryRef, Relation, RowRef } from '../shared/api';
import type { SqlValue } from '../shared/coerce';
import { saveStartupOptions } from './db/startup';
import { writableColumn } from '../shared/record-source';
import { DEFAULT_STARTUP } from '../shared/startup';

// A front-end with a local Notes and the server links Clients (key id) and Vue (no key) on the fake connector (C4 Task 3).
const P = { host: 'db.example', port: 5432, database: 'ventes', user: 'ana', tls: 'verify-full', timeout: 60 };
const KEY = 'postgresql://db.example:5432/ventes?tls=verify-full';
const clients: RemoteTable = {
  name: 'Clients', remote: 'Clients', schema: 'public', key: ['id'], skipped: [],
  design: t('Clients', [f('id', 'number', { numberSize: 'longInteger' }), f('Nom', 'shortText'), f('Ville', 'shortText')]),
};
const vue: RemoteTable = { name: 'Vue', remote: 'vue', schema: 'public', key: [], skipped: [], design: t('Vue', [f('Ville', 'shortText'), f('N', 'number')]) };
const villes: RemoteTable = { name: 'Villes', remote: 'villes', schema: 'public', key: ['Ville'], skipped: [], design: t('Villes', [f('Ville', 'shortText', { indexed: 'yesNoDuplicates' }), f('Region', 'shortText', { pgGenerated: true })]) };
const probe: RiskProbe = { platform: 'win32', env: {}, homedir: 'C:\\Users\\x', windowsDriveType: () => 3 };
const deps: SessionDeps = { appVersion: '0.0.0', region: 'fr-FR', probe, lockDeps: { now: () => 0 }, sessionId: 'a' };
const saveQuery = (db: DatabaseSync, name: string, sql: string) => saveObject(db, 'query', name, { formatVersion: '1.0', sql }, null);
const opts = { skipFailures: false, replaceTable: false };

let dir: string;
let fe: string;
let front: DatabaseSync;
let fake: ReturnType<typeof testConnector>;
let s: Session;
let relations: Relation[];
const opened: Session[] = [];
const open = (d: Partial<SessionDeps> = {}) => { const x = Session.open(fe, { ...deps, ...d }); opened.push(x); return x; };

beforeEach(() => {
  dir = fs.realpathSync.native(fs.mkdtempSync(join(os.tmpdir(), 'bcremote-')));
  fe = join(dir, 'front.basecraft');
  createBaseFile(fe, '0.0.0');
  front = openBaseFile(fe, 'write', '0.0.0').db;
  createTable(front, t('Notes', [f('N°', 'autoNumber'), f('c', 'number'), f('Texte', 'shortText')]));
  addServerLinks(front, 'postgresql', P, [clients, vue, villes]);
  saveQuery(front, 'QVille', 'PARAMETERS [V] Text; SELECT * FROM Clients WHERE Ville = [V]');
  relations = listRelations(front);
  front.close();
  fake = testConnector({ tables: [clients, vue, villes], rows: { Clients: [[1, 'Dupont', 'Lyon'], [2, 'Martin', 'Brest'], [3, 'Durand', 'Lyon']], Vue: [['Lyon', 2]] } });
  s = open({ connectors: { postgresql: fake } });
  s.setCredential(KEY, 'ana', 'secret');
});
afterEach(async () => {
  for (const x of opened.splice(0)) await x.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('remote reads through a connector', () => {
  it('a server table pages through its connection, with references', async () => {
    const p = await s.page('Clients', { offset: 0, limit: 2, sort: { field: 'Ville', dir: 'desc' } });
    expect(p.rows.map((r) => r.rowid)).toEqual(['[["1"],"10"]', '[["2"],"11"]']);
    expect(p.rows[0]!.values).toEqual([1, 'Dupont', 'Lyon']);
    expect(fake.lastRequest).toMatchObject({ sort: [{ column: 2, dir: 'desc' }], refs: true });
    expect(fake.log.filter((x) => x === 'count')).toEqual([]); // the datasheet asks count() itself
  });

  it('count asks the connector for a count, never rows', async () => {
    expect(await s.count('Clients')).toBe(3);
    expect(fake.log.filter((x) => x === 'count' || x === 'rows')).toEqual(['count']);
  });

  it('a keyless server table is read-only', async () => {
    expect((await s.describeSource({ kind: 'table', name: 'Vue' })).updatable).toBe(false);
    expect(await s.describeSource({ kind: 'table', name: 'Clients' })).toMatchObject({ updatable: true, keyTable: 'Clients', parameters: [] });
    expect((await s.page('Vue', { offset: 0, limit: 1 })).rows[0]!.rowid).toBeNaN();
  });

  it('a column the server computes (pgGenerated) is read-only before any save (M2)', async () => {
    const info = await s.describeSource({ kind: 'table', name: 'Villes' });
    expect(['Ville', 'Region'].map((n) => writableColumn(info, n))).toEqual([true, false]);
    expect(writableColumn(await s.describeSource({ kind: 'sql', sql: 'SELECT * FROM Villes' }), 'Region')).toBe(false);
  });

  it('a query joining a local and a server table is refused', async () => {
    await expect(s.describeSource({ kind: 'sql', sql: 'SELECT * FROM Notes INNER JOIN Clients ON Notes.c = Clients.id' })).rejects.toThrow('bc:queryBind|mixedSources|');
  });

  it('a parameter query on a server table binds its values, a saved query works offline for design', async () => {
    expect((await s.describeSource({ kind: 'query', name: 'QVille' })).parameters[0]!.name).toBe('V');
    expect(fake.connections).toBe(0);
    const p = await s.pageSource({ kind: 'query', name: 'QVille' }, { offset: 0, limit: 5, params: { V: 'Lyon' } });
    expect(fake.lastRequest?.values).toEqual({ V: 'Lyon' });
    expect(p.rowids).toEqual(['[["1"],"10"]', '[["2"],"11"]', '[["3"],"12"]']); // the fake does not filter
  });

  it('SQLite-only operations refuse a server source before connecting', async () => {
    s.setContentEnabled(s.activeContent().fingerprint); // runAction checks the active content before binding
    const makeTable: QueryRef = { kind: 'sql', sql: 'SELECT * INTO X FROM Clients' }; // C7 R14: Make-Table only
    await expect(s.runAction(makeTable, {}, opts)).rejects.toThrow('bc:serverNotSupported|makeTable|postgresql');
    await expect(s.actionCount(makeTable, {})).rejects.toThrow('bc:serverNotSupported|makeTable|postgresql');
    expect(() => s.convertLink('Clients')).toThrow('bc:serverNotSupported|other|postgresql');
    expect(() => s.cascadeChildren('Clients')).toThrow('bc:serverNotSupported|other|postgresql');
    await expect(s.appendTable('Clients', 'Notes')).rejects.toThrow('bc:serverNotSupported|other|postgresql');
    expect(await s.autoLookup({ kind: 'sql', sql: 'SELECT * FROM Clients' }, {})).toEqual({}); // one table: nothing to look up (C5 R16)
    expect(await s.lookup('Clients', 'Ville')).toEqual({ rows: [], widths: [] }); // no lookup on that field
    expect(s.listRelations()).toEqual(relations);
    expect(fake.connections).toBe(0);
  });

  describe('crosstabs on a server source (C7 R15)', () => {
    const X = (pivot = 'Ville') => ({ kind: 'sql' as const, sql: `TRANSFORM Count(id) SELECT Nom FROM Clients GROUP BY Nom PIVOT ${pivot}` });
    const names = (i: { fields: { name: string }[] }) => i.fields.map((x) => x.name);
    /** A session on a fake whose Clients holds these towns. */
    const withTowns = (towns: string[]) => {
      const other = open({ connectors: { postgresql: testConnector({ tables: [clients, vue, villes], rows: { Clients: towns.map((v, k) => [k + 1, `N${k}`, v]) } }) } });
      other.setCredential(KEY, 'ana', 'secret');
      return other;
    };

    it('the headings are the towns the server gives, Lyon and LYON one column (first spelling kept)', async () => {
      expect(names(await withTowns(['Lyon', 'LYON', 'Paris', 'lyon', 'Lyôn']).describeSource(X()))).toEqual(['Nom', 'Lyon', 'Paris', 'Lyôn']);
      expect(names(await withTowns(['LYON', 'Lyon']).describeSource(X()))).toEqual(['Nom', 'LYON']);
    });

    it('fixed IN headings read nothing; a page brings its columns', async () => {
      const calls = () => fake.log.filter((x) => x === 'rows').length;
      expect(names(await s.describeSource(X('Ville IN ("Lyon", "Paris")')))).toEqual(['Nom', 'Lyon', 'Paris']);
      expect(calls()).toBe(0);
      const p = await s.pageSource(X(), { offset: 0, limit: 5 });
      expect(p.columns).toEqual(['Nom', 'Lyon', 'Brest']);
      expect(fake.lastRequest?.query.columns.map((c) => c.name)).toEqual(['Nom', 'Lyon', 'Brest']); // the rewritten SELECT is what is planned
      expect(p.rowids.every((r) => r === null)).toBe(true);
    });

    it('more than 254 headings: tooManyColumns', async () => {
      const many = withTowns(Array.from({ length: 300 }, (_, k) => `V${k}`));
      await expect(many.describeSource(X())).rejects.toThrow('bc:queryBind|tooManyColumns|301');
      expect(names(await withTowns(Array.from({ length: 254 }, (_, k) => `V${k}`)).describeSource(X()))).toHaveLength(255);
    });
  });

  it('without a credential: needsLogin with the server key', async () => {
    const s2 = open({ connectors: { postgresql: testConnector() } });
    await expect(s2.page('Clients', { offset: 0, limit: 1 })).rejects.toThrow(`bc:linkUnavailable|needsLogin|${KEY}`);
  });

  it('a credential the server refuses is forgotten', async () => {
    s.setCredential(KEY, 'ana', 'wrong');
    await expect(s.page('Clients', { offset: 0, limit: 1 })).rejects.toThrow(`bc:linkUnavailable|needsLogin|${KEY}`);
    await expect(s.page('Clients', { offset: 0, limit: 1 })).rejects.toThrow(`bc:linkUnavailable|needsLogin|${KEY}`);
    expect(fake.log.filter((x) => x === 'open')).toHaveLength(1); // the second call had no credential left to try
    expect(s.serverKeys()).toEqual([KEY]);
  });

  it('login connects with the given user; a refused one is false and forgotten', async () => { // R10
    const fresh = testConnector({ tables: [clients], rows: { Clients: [[1, 'Dupont', 'Lyon']] } });
    const users: string[] = [];
    const open0 = fresh.open.bind(fresh);
    fresh.open = (p, c) => { users.push(c.user); return open0(p, c); };
    const s2 = open({ connectors: { postgresql: fresh } });
    expect(await s2.login(KEY, 'ana', 'bad')).toBe(false);
    await expect(s2.page('Clients', { offset: 0, limit: 1 })).rejects.toThrow(`bc:linkUnavailable|needsLogin|${KEY}`); // forgotten
    expect(await s2.login(KEY, 'bob', 'secret')).toBe(true);
    expect((await s2.page('Clients', { offset: 0, limit: 1 })).rows).toHaveLength(1);
    expect(users).toEqual(['ana', 'bob']);
    expect(fresh.connections).toBe(1); // the login's connection serves the read
    expect(await s2.login(KEY, 'carl', 'secret')).toBe(true); // a new login replaces the open connection
    expect(users).toEqual(['ana', 'bob', 'carl']);
    expect(() => s2.loginDefaults('postgresql://autre:5432/x')).toThrow('bc:invalidArgument');
    await expect(s2.login('postgresql://autre:5432/x', 'ana', 'secret')).rejects.toThrow('bc:invalidArgument');
  });

  it('a credential remembered for one TLS mode is not used by the same server under another mode', async () => { // Task 5 ruling
    const fe2 = join(dir, 'front2.basecraft');
    createBaseFile(fe2, '0.0.0');
    const db = openBaseFile(fe2, 'write', '0.0.0').db;
    addServerLinks(db, 'postgresql', { ...P, tls: 'disable' }, [clients]);
    db.close();
    const weak = Session.open(fe2, { ...deps, connectors: { postgresql: testConnector({ tables: [clients], rows: { Clients: [[1, 'Dupont', 'Lyon']] } }) } });
    opened.push(weak);
    const weakKey = 'postgresql://db.example:5432/ventes?tls=disable';
    expect(weak.serverKeys()).toEqual([weakKey]); // the main process pushes only what it holds for this key
    weak.setCredential(KEY, 'ana', 'secret');
    await expect(weak.page('Clients', { offset: 0, limit: 1 })).rejects.toThrow(`bc:linkUnavailable|needsLogin|${weakKey}`);
  });

  it('loginDefaults: the source\'s user and the connector\'s label', () => {
    expect(s.loginDefaults(KEY)).toEqual({ user: 'ana', label: 'db.example:5432/ventes' });
  });

  it('a read on a lost connection reconnects once; a write is never repeated', async () => {
    fake.failNext = Object.assign(new Error('Connection terminated'), { lost: true });
    expect((await s.page('Clients', { offset: 0, limit: 1 })).rows).toHaveLength(1);
    expect(fake.connections).toBe(2);
  });

  it('a read whose retry loses its connection again cannot reach the server (I1: serverError|connection says a write may have committed), the dead connection dropped', async () => {
    const lost = Object.assign(new Error('Connection terminated'), { lost: true });
    const openReal = fake.open.bind(fake);
    fake.open = async (p, c) => { const conn = await openReal(p, c); fake.failNext = lost; return conn; }; // every connection fails once
    await expect(s.page('Clients', { offset: 0, limit: 1 })).rejects.toThrow('bc:linkUnavailable|cannotConnect|db.example:5432/ventes');
    expect(fake.connections).toBe(2);
    expect(fake.log.filter((x) => x === 'close')).toHaveLength(2);
    expect(s.dataStamp()).not.toContain('#'); // no server connection left open
  });

  it('the data stamp moves at each tick while a server connection is open; local caches do not', async () => {
    const before = s.dataStamp();
    expect(s.dataStamp()).toBe(before);
    await s.page('Clients', { offset: 0, limit: 1 });
    expect(s.dataStamp()).not.toBe(s.dataStamp());
    expect(await s.count('Notes')).toBe(0);
  });

  it('Session.interrupt cancels the running remote read only', async () => { // R12, Review Focus 5
    expect(await s.interrupt()).toBe(false); // nothing open
    await s.page('Clients', { offset: 0, limit: 1 });
    fake.hold = true;
    const p = s.page('Clients', { offset: 0, limit: 1 });
    await new Promise((r) => setImmediate(r)); // the read waits on the server
    expect(await s.interrupt()).toBe(true);
    await expect(p).rejects.toThrow('bc:cancelled');
    expect(await s.interrupt()).toBe(false);
    fake.hold = false;
    expect((await s.page('Clients', { offset: 0, limit: 1 })).rows).toHaveLength(1); // the connection stays usable
    expect(fake.connections).toBe(1);
  });

  it('close closes the server connections', async () => {
    await s.page('Clients', { offset: 0, limit: 1 });
    await s.close();
    expect(fake.log.at(-1)).toBe('close');
  });
});

describe('remote writes through a connector (R7, R8, R9)', () => {
  const ref1 = '[["1"],"10"]';
  const joinRef: QueryRef = { kind: 'sql', sql: 'SELECT Clients.Nom, Villes.Region FROM Clients INNER JOIN Villes ON Clients.Ville = Villes.Ville' };

  it('a field rule refuses before the server is asked', async () => {
    expect(await s.insert('Clients', { Nom: 'x'.repeat(300) })).toMatchObject({ ok: false, errors: [{ code: 'tooLong' }] });
    expect(fake.log).not.toContain('insert');
  });

  it('insert, update and delete reach the server with converted values and references', async () => {
    const r = await s.insert('Clients', { Nom: 'Ana', Ville: 'Nice' });
    expect(r).toEqual({ ok: true, rowid: '[["4"],"14"]', values: [4, 'Ana', 'Nice'] });
    expect(await s.update('Clients', '[["4"],"14"]', { Ville: 'Pau' })).toEqual({ ok: true, rowid: '[["4"],"15"]', values: [4, 'Ana', 'Pau'] });
    expect(await s.delete('Clients', ['[["4"],"15"]'])).toEqual({ ok: true, count: 1 });
    expect(await s.count('Clients')).toBe(3);
  });

  it('two sessions on one record: changed with the new reference, Save Record wins, deleted', async () => {
    const copy = join(dir, 'front2.basecraft');
    fs.copyFileSync(fe, copy); // a second workstation's front-end on the same server
    const s1 = s;
    const s2 = Session.open(copy, { ...deps, connectors: { postgresql: fake } });
    opened.push(s2);
    s2.setCredential(KEY, 'ana', 'secret');
    const [r1] = (await s1.page('Clients', { offset: 0, limit: 1 })).rows;
    const [r2] = (await s2.page('Clients', { offset: 0, limit: 1 })).rows;
    expect((await s1.update('Clients', r1!.rowid, { Ville: 'Brest' })).ok).toBe(true);
    const c = await s2.update('Clients', r2!.rowid, { Ville: 'Lille' });
    expect(c).toMatchObject({ ok: false, conflict: 'changed', current: [1, 'Dupont', 'Brest'], rowid: '[["1"],"11"]' });
    expect(await s2.update('Clients', (c as { rowid: RowRef }).rowid, { Ville: 'Lille' })).toMatchObject({ ok: true, values: [1, 'Dupont', 'Lille'] });
    expect(await s1.delete('Clients', [r1!.rowid])).toEqual({ ok: true, count: 1 }); // a stale reference deletes all the same (R8)
    expect(await s2.update('Clients', r2!.rowid, { Ville: 'Nantes' })).toEqual({ ok: false, conflict: 'deleted' });
  });

  it('a single-table query saves by origin; a two-table one refuses on a connector without transactions (C5 R16)', async () => {
    const r = await s.saveSource({ kind: 'sql', sql: 'SELECT id, Ville AS V FROM Clients' }, { rowid: ref1, values: { V: 'Lyon' }, expected: { id: 1, V: 'Lyon' } });
    expect(r).toEqual({ ok: true, rowid: '[["1"],"11"]', values: { id: 1, V: 'Lyon' } });
    expect(await s.saveSource({ kind: 'sql', sql: 'SELECT id, Nom AS N FROM Clients' }, { rowid: null, values: { N: 'x'.repeat(300) } }))
      .toEqual({ ok: false, errors: [{ field: 'N', code: 'tooLong' }] });
    expect(await s.saveSource({ kind: 'sql', sql: 'SELECT id, Nom AS N FROM Clients' }, { rowid: null, values: { N: 'Zoé' } }))
      .toEqual({ ok: true, rowid: '[["4"],"14"]', values: { id: 4, N: 'Zoé' } });
    expect(await s.saveSource({ kind: 'sql', sql: 'SELECT id, Nom AS N FROM Clients' }, { rowid: ref1, values: { N: 'Y' } }))
      .toMatchObject({ ok: false, conflict: 'changed', current: { id: 1, N: 'Dupont' }, rowid: '[["1"],"11"]' });
    expect(await s.saveSource({ kind: 'sql', sql: 'SELECT Ville, Ville & "!" AS X FROM Clients' }, { rowid: ref1, values: { X: 'a' } }))
      .toEqual({ ok: false, errors: [{ field: 'X', code: 'readOnly' }] });
    const plain = testConnector({ transactions: false, tables: [clients, vue, villes], rows: { Clients: [[1, 'Dupont', 'Lyon']] } });
    await s.close(); // its file, for a session of its own
    const s2 = open({ connectors: { postgresql: plain } });
    s2.setCredential(KEY, 'ana', 'secret');
    expect((await s2.describeSource(joinRef)).updatable).toBe(true); // every table it writes has a key
    await expect(s2.saveSource(joinRef, { rowid: ref1, values: { Nom: 'X' } })).rejects.toThrow('bc:serverNotSupported|joinSave|postgresql');
    expect(plain.log).not.toContain('update');
  });

  it('a lost connection during a save reports once and is not repeated', async () => {
    await s.page('Clients', { offset: 0, limit: 1 });
    fake.failNext = Object.assign(new Error('Connection terminated'), { lost: true });
    await expect(s.update('Clients', ref1, { Ville: 'Brest' })).rejects.toThrow('bc:serverError|connection|Connection terminated');
    expect(fake.log.filter((x) => x === 'update')).toEqual(['update']);
  });

  it('a read-only front-end writes no server row; the Runtime does (a front-end copy: its local tables only are read-only)', async () => {
    const ro = open({ connectors: { postgresql: fake }, sessionId: 'b' }); // the file is held by s: opened read-only
    ro.setCredential(KEY, 'ana', 'secret');
    await expect(ro.insert('Clients', { Nom: 'A' })).rejects.toThrow(ReadOnlyError);
    await expect(ro.saveSource({ kind: 'sql', sql: 'SELECT id, Nom FROM Clients' }, { rowid: ref1, values: { Nom: 'A' } })).rejects.toThrow(ReadOnlyError);
    await s.close();
    await ro.close();
    const db = openBaseFile(fe, 'write', '0.0.0').db;
    try { saveStartupOptions(db, { ...DEFAULT_STARTUP, frontEnd: true }); } finally { db.close(); }
    const rt = open({ connectors: { postgresql: fake }, runtime: true });
    rt.setCredential(KEY, 'ana', 'secret');
    await expect(rt.insert('Notes', { Texte: '1' })).rejects.toThrow(ReadOnlyError);
    expect((await rt.insert('Clients', { Nom: 'A' })).ok).toBe(true);
    expect((await rt.describeSource({ kind: 'table', name: 'Clients' })).updatable).toBe(true);
  });
});

describe('data entry through a multi-table query on a server source (C5 R16)', () => {
  const pk = (name: string) => f(name, 'number', { numberSize: 'longInteger', primaryKey: true });
  const cl: RemoteTable = { ...clients, design: t('Clients', [pk('id'), f('Nom', 'shortText'), f('Ville', 'shortText')]) };
  const commandes: RemoteTable = { name: 'Commandes', remote: 'commandes', schema: 'public', key: ['n'], skipped: [],
    design: t('Commandes', [f('n', 'autoNumber', { primaryKey: true }), f('Client', 'number', { numberSize: 'longInteger' }), f('Montant', 'currency')]) };
  const joinRef: QueryRef = { kind: 'sql', sql: 'SELECT n, Client, Montant, Nom, Ville FROM Commandes INNER JOIN Clients ON Commandes.Client = Clients.id' };
  // rows' versions: Clients 10, 11; Commandes 12, 13 (order 2's client 99 does not exist)
  const CMD1 = '[["1"],"12"]', CMD2 = '[["2"],"13"]';
  const read1 = { n: 1, Client: 2, Montant: 10, Nom: 'Martin', Ville: 'Brest' }; // order 1 as read
  let j: Session;
  let jf: ReturnType<typeof testConnector>;
  beforeEach(() => {
    const path = join(dir, 'join.basecraft');
    createBaseFile(path, '0.0.0');
    const db = openBaseFile(path, 'write', '0.0.0').db;
    addServerLinks(db, 'postgresql', P, [cl, commandes]);
    db.close();
    jf = testConnector({ tables: [cl, commandes], rows: { Clients: [[1, 'Dupont', 'Lyon'], [2, 'Martin', 'Brest']], Commandes: [[1, 2, 10], [2, 99, 5]] } });
    j = Session.open(path, { ...deps, connectors: { postgresql: jf } });
    opened.push(j);
    j.setCredential(KEY, 'ana', 'secret');
  });
  /** The fake's statements since the last 'begin' (find included). */
  const lastTransaction = () => jf.log.slice(jf.log.lastIndexOf('begin'));
  const values = async (table: string) => (await j.page(table, { offset: 0, limit: 10 })).rows.map((r) => r.values);

  it('a join query on a server source is updatable; AutoLookup fills the "one" side', async () => {
    expect((await j.describeSource(joinRef)).updatable).toBe(true);
    expect(await j.autoLookup(joinRef, { Client: '2' })).toEqual({ Nom: 'Martin', Ville: 'Brest' });
    expect(await j.autoLookup(joinRef, { Client: '7' })).toEqual({ Nom: null, Ville: null }); // no client 7
    expect(await j.autoLookup(joinRef, { Client: '' })).toEqual({ Nom: null, Ville: null }); // Null never joins: not asked
    expect(await j.autoLookup(joinRef, { Montant: '1' })).toEqual({}); // its link not sent: not looked up
    expect(jf.log.filter((x) => x === 'find')).toHaveLength(2);
  });

  it('a save writes the key table then the "one" table in one transaction; a refusal of the second rolls back the first', async () => {
    expect(await j.saveSource(joinRef, { rowid: CMD1, values: { Montant: '12', Ville: 'Nice' }, expected: read1 }))
      .toEqual({ ok: true, rowid: '[["1"],"13"]', values: { n: 1, Client: 2, Montant: 12, Nom: 'Martin', Ville: 'Nice' } });
    expect(lastTransaction()).toEqual(['begin', 'update', 'find', 'update', 'commit']);
    const r = await j.saveSource(joinRef, { rowid: '[["1"],"13"]', values: { Montant: '13', Ville: 'x'.repeat(300) } });
    expect(r).toEqual({ ok: false, errors: [{ field: 'Ville', code: 'tooLong', table: 'Clients' }] });
    expect(lastTransaction()).toEqual(['begin', 'update', 'find', 'rollback']);
    expect(await values('Commandes')).toEqual([[1, 2, 12], [2, 99, 5]]); // the key table's 13 rolled back
    expect(await values('Clients')).toEqual([[1, 'Dupont', 'Lyon'], [2, 'Martin', 'Nice']]);
    // a new record and its client's field, together; a "one" field alone checks the key row and writes the client only
    expect(await j.saveSource(joinRef, { rowid: null, values: { Client: '1', Montant: '3', Ville: 'Paris' } }))
      .toMatchObject({ ok: true, values: { n: 3, Client: 1, Montant: 3, Nom: 'Dupont', Ville: 'Paris' } });
    expect(lastTransaction()).toEqual(['begin', 'insert', 'find', 'update', 'commit']);
    expect(await j.saveSource(joinRef, { rowid: '[["1"],"13"]', values: { Nom: 'Martin SA' } })).toMatchObject({ ok: true, rowid: '[["1"],"13"]' });
    expect(await values('Clients')).toEqual([[1, 'Dupont', 'Paris'], [2, 'Martin SA', 'Nice']]);
  });

  it('the "one" row changed by another user since it was read: changed, nothing written', async () => {
    expect((await j.update('Clients', '[["2"],"11"]', { Ville: 'Nice' })).ok).toBe(true); // another user (one fake server)
    expect(await j.saveSource(joinRef, { rowid: CMD1, values: { Montant: '12', Ville: 'Pau' }, expected: read1 }))
      .toEqual({ ok: false, conflict: 'changed', current: { ...read1, Ville: 'Nice' }, rowid: CMD1 });
    // rolled back, then the key row checked only (its version stays) and its client read again
    expect(lastTransaction()).toEqual(['begin', 'update', 'find', 'rollback', 'update', 'find']);
    expect(await values('Commandes')).toEqual([[1, 2, 10], [2, 99, 5]]);
    // the key row changed: its conflict, with the new reference
    expect((await j.update('Commandes', CMD1, { Montant: '20' })).ok).toBe(true);
    expect(await j.saveSource(joinRef, { rowid: CMD1, values: { Ville: 'Pau' }, expected: { ...read1, Ville: 'Nice' } }))
      .toEqual({ ok: false, conflict: 'changed', current: { ...read1, Montant: 20, Ville: 'Nice' }, rowid: '[["1"],"13"]' });
    expect(await values('Clients')).toEqual([[1, 'Dupont', 'Lyon'], [2, 'Martin', 'Nice']]);
    expect(await j.delete('Commandes', [CMD1])).toEqual({ ok: true, count: 1 });
    expect(await j.saveSource(joinRef, { rowid: CMD1, values: { Ville: 'Pau' } })).toEqual({ ok: false, conflict: 'deleted' });
  });

  it('the connection lost while a conflict is read again: rolled back, so the conflict, read again on a fresh connection (final review 4)', async () => {
    const lost = Object.assign(new Error('Connection terminated'), { lost: true });
    let arm = 0; // 1: the read after the next rollback loses its connection; 2: its retry too
    const openReal = jf.open.bind(jf);
    jf.open = async (p, c) => {
      const conn = await openReal(p, c), tx = conn.transaction.bind(conn);
      conn.transaction = (fn) => tx(fn).catch((e: unknown) => { if (arm) jf.failNext = lost; throw e; });
      if (arm === 2) { arm = 0; jf.failNext = lost; }
      return conn;
    };
    expect((await j.update('Clients', '[["2"],"11"]', { Ville: 'Nice' })).ok).toBe(true); // another user
    arm = 1;
    expect(await j.saveSource(joinRef, { rowid: CMD1, values: { Montant: '12', Ville: 'Pau' }, expected: read1 }))
      .toEqual({ ok: false, conflict: 'changed', current: { ...read1, Ville: 'Nice' }, rowid: CMD1 });
    expect(lastTransaction()).toEqual(['begin', 'update', 'find', 'rollback', 'update', 'close', 'open', 'update', 'find']);
    arm = 2; // lost again: the read cannot reach the server, never "outcome unknown" (connection|)
    await expect(j.saveSource(joinRef, { rowid: CMD1, values: { Montant: '12', Ville: 'Pau' }, expected: read1 }))
      .rejects.toThrow('bc:linkUnavailable|cannotConnect|db.example:5432/ventes');
    expect(await values('Commandes')).toEqual([[1, 2, 10], [2, 99, 5]]);
  });

  it('no parent: noParent; a parent found twice: readOnly (B4 R3)', async () => {
    expect(await j.saveSource(joinRef, { rowid: CMD2, values: { Montant: '6', Ville: 'Pau' } })).toEqual({ ok: false, errors: [{ field: 'Ville', code: 'noParent', table: 'Clients' }] });
    expect((await j.insert('Clients', { id: '2', Nom: 'Martin bis' })).ok).toBe(true); // the fake checks no key: a second client 2
    expect(await j.saveSource(joinRef, { rowid: CMD1, values: { Ville: 'Pau' } })).toEqual({ ok: false, errors: [{ field: 'Ville', code: 'readOnly', table: 'Clients' }] });
    expect(await j.autoLookup(joinRef, { Client: '2' })).toEqual({ Nom: null, Ville: null });
    expect(await values('Commandes')).toEqual([[1, 2, 10], [2, 99, 5]]);
  });

  it('a lost connection or a Stop inside the transaction: rolled back, reported once, never run again', async () => {
    await j.count('Commandes'); // connected
    jf.failNext = Object.assign(new Error('Connection terminated'), { lost: true, unsent: true }); // even unsent: an earlier statement ran
    await expect(j.saveSource(joinRef, { rowid: CMD1, values: { Montant: '12', Ville: 'Pau' } })).rejects.toThrow('bc:serverError|connection|Connection terminated');
    expect(jf.log.filter((x) => x === 'begin')).toHaveLength(1);
    jf.failNext = new Error('bc:cancelled');
    await expect(j.saveSource(joinRef, { rowid: CMD1, values: { Montant: '12', Ville: 'Pau' } })).rejects.toThrow('bc:cancelled');
    expect(jf.log.slice(-2)).toEqual(['update', 'rollback']);
    expect(await values('Commandes')).toEqual([[1, 2, 10], [2, 99, 5]]);
  });
});

describe('BaseCraft metadata on server links: rules, lists and defaults (C7 R11, R12)', () => {
  // A migrated pair: the server-read designs (Montant numeric(19,4) read back as Decimal) and the local designs' metadata.
  const dec = { type: 'number', numberSize: 'decimal', precision: 19, scale: 4 } as const;
  const cl: RemoteTable = { name: 'Clients', remote: 'Clients', schema: 'public', key: ['id'], skipped: [],
    design: t('Clients', [f('id', 'autoNumber', { external: true }), f('Nom', 'shortText', { size: 80 })]) };
  const cmd: RemoteTable = { name: 'Commandes', remote: 'Commandes', schema: 'public', key: ['n'], skipped: [],
    design: t('Commandes', [f('n', 'autoNumber', { external: true }), f('Client', 'number'), f('Montant', 'number', dec), f('Le', 'dateTime')]) };
  const local = { ...t('Commandes', [f('n', 'autoNumber'),
    f('Client', 'number', { caption: 'Client', lookup: { kind: 'table', table: 'Clients', columnCount: 2, columnWidths: [0, 1440], limitToList: true } }),
    f('Montant', 'currency', { validationRule: '>0', validationText: 'Positif' }), f('Le', 'dateTime', { defaultValue: 'Date()' })]), validationRule: '[Montant] < 1000' };
  const CMD1 = '[["1"],"12"]';
  let m: Session;
  let mf: ReturnType<typeof testConnector>;
  beforeEach(() => {
    const path = join(dir, 'migrated.basecraft');
    createBaseFile(path, '0.0.0');
    const db = openBaseFile(path, 'write', '0.0.0').db;
    addServerLinks(db, 'postgresql', P, [cl, cmd], [undefined, linkMeta(local, cmd)]);
    db.close();
    mf = testConnector({ tables: [cl, cmd], rows: { Clients: [[1, 'Dupont'], [2, 'Martin']], Commandes: [[1, 2, 10, '2026-01-05 00:00:00']] } });
    m = Session.open(path, { ...deps, connectors: { postgresql: mf } });
    opened.push(m);
    m.setCredential(KEY, 'ana', 'secret');
  });
  const lastTransaction = () => mf.log.slice(mf.log.lastIndexOf('begin'));
  const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} 00:00:00`; };

  it('the link shows the local design: Currency, its caption and rules', () => {
    const d = m.tableDesign('Commandes');
    expect(d.fields.map((x) => x.props.type)).toEqual(['autoNumber', 'number', 'currency', 'dateTime']);
    expect(d).toMatchObject({ validationRule: '[Montant] < 1000', fields: [{}, { props: { caption: 'Client' } }, { props: { validationRule: '>0' } }, { props: { defaultValue: 'Date()' } }] });
  });

  it('a server link with a validation rule refuses as a local table does', async () => {
    expect(await m.saveSource({ kind: 'sql', sql: 'SELECT * FROM Commandes' }, { rowid: CMD1, values: { Montant: '0' } }))
      .toMatchObject({ ok: false, errors: [{ field: 'Montant', code: 'validation', message: 'Positif' }] });
    expect(await m.insert('Commandes', { Client: '1', Montant: '-1' })).toMatchObject({ ok: false, errors: [{ field: 'Montant', code: 'validation' }] });
    expect(await m.insert('Commandes', { Client: '1', Montant: '2000' })).toEqual({ ok: false, errors: [{ field: '', code: 'validation', table: 'Commandes' }] });
    expect(mf.log.filter((x) => x === 'insert' || x === 'update')).toEqual([]);
  });

  it('a table rule on update reads the current row in the save\'s transaction', async () => {
    expect(await m.update('Commandes', CMD1, { Montant: '20' })).toMatchObject({ ok: true, values: [1, 2, 20, '2026-01-05 00:00:00'] });
    expect(lastTransaction()).toEqual(['begin', 'update', 'update', 'commit']); // checked only, then written with the same reference
    expect(await m.update('Commandes', '[["1"],"13"]', { Montant: '2000' })).toEqual({ ok: false, errors: [{ field: '', code: 'validation', table: 'Commandes' }] });
    expect(lastTransaction()).toEqual(['begin', 'update', 'rollback']);
    expect(await m.update('Commandes', CMD1, { Montant: '30' })).toMatchObject({ ok: false, conflict: 'changed', rowid: '[["1"],"13"]' }); // a conflict as today
    expect(lastTransaction()).toEqual(['begin', 'update', 'commit']);
  });

  it('Limit To List over another server link', async () => {
    expect(await m.insert('Commandes', { Client: '9', Montant: '5' })).toEqual({ ok: false, errors: [{ field: 'Client', code: 'notInList' }] });
    expect(mf.log).not.toContain('insert');
    expect(mf.lastRequest?.where).toEqual({ k: 'bin', op: '=', l: { k: 'id', name: 'id' }, r: { k: 'num', v: '9' } }); // a one-row page of Clients
    expect(await m.insert('Commandes', { Client: '2', Montant: '5' })).toMatchObject({ ok: true, values: [2, 2, 5, today()] });
    expect(await m.update('Commandes', CMD1, { Client: '9' })).toEqual({ ok: false, errors: [{ field: 'Client', code: 'notInList' }] });
  });

  it('the datasheet list of a server link\'s lookup field', async () => {
    expect((await m.lookup('Commandes', 'Client')).rows).toEqual([{ value: 1, display: ['Dupont'] }, { value: 2, display: ['Martin'] }]);
    expect(mf.lastRequest?.sort).toEqual([{ column: 1, dir: 'asc' }]); // sorted on its first visible column, as a local table's list
    expect(await m.lookup('Commandes', 'Montant')).toEqual({ rows: [], widths: [] });
  });

  it('an expression default applies on a server insert', async () => {
    expect(await m.insert('Commandes', { Client: '1', Montant: '5' })).toMatchObject({ ok: true, values: [2, 1, 5, today()] });
  });

  // A migrated front-end of its own: `tables` linked with `metas` (local designs), `queries` saved, `rows` on the fake.
  const migrated = (tables: RemoteTable[], metas: (ReturnType<typeof linkMeta> | undefined)[], rows: Record<string, SqlValue[][]>, queries: [string, unknown][] = []) => {
    const path = join(dir, `own-${tables.map((x) => x.name).join('-')}.basecraft`);
    createBaseFile(path, '0.0.0');
    const db = openBaseFile(path, 'write', '0.0.0').db;
    addServerLinks(db, 'postgresql', P, tables, metas);
    for (const [name, def] of queries) saveObject(db, 'query', name, def, null);
    db.close();
    const fk = testConnector({ tables, rows });
    const x = Session.open(path, { ...deps, connectors: { postgresql: fk } });
    opened.push(x);
    x.setCredential(KEY, 'ana', 'secret');
    return { x, fk };
  };

  it('a server lookup over a pass-through query lists nothing and sends no native SQL (C6 R9)', async () => {
    const lk = { ...local, fields: local.fields.map((x) => (x.name === 'Client' ? { ...x, props: { ...x.props, lookup: { kind: 'table' as const, table: 'PT', limitToList: true } } } : x)) };
    const pt = { formatVersion: '2.0', sql: 'SELECT id FROM clients', passThrough: { kind: 'postgresql', params: P, returnsRecords: true } };
    const { x, fk } = migrated([cl, cmd], [undefined, linkMeta(lk, cmd)], { Clients: [[1, 'Dupont']] }, [['PT', pt]]);
    expect(await x.lookup('Commandes', 'Client')).toEqual({ rows: [], widths: [] });
    expect(fk.log).not.toContain('native');
  });

  it('a server error reading Limit To List inside a multi-table save fails the save with that error', async () => {
    const join = { kind: 'sql' as const, sql: 'SELECT n, Client, Montant, Nom FROM Commandes INNER JOIN Clients ON Commandes.Client = Clients.id' };
    mf.failNext = new Error('bc:serverError|42883|operator does not exist'); // the first call: the list's read, after 'begin'
    await expect(m.saveSource(join, { rowid: CMD1, values: { Client: '2' } })).rejects.toThrow('bc:serverError|42883');
    expect(lastTransaction()).toEqual(['begin', 'plan', 'rows', 'rollback']);
  });

  it('a multi-table save changing the link field reads its list inside the transaction; Stop still reaches the save', async () => {
    const join = { kind: 'sql' as const, sql: 'SELECT n, Client, Montant, Nom FROM Commandes INNER JOIN Clients ON Commandes.Client = Clients.id' };
    const openReal = mf.open.bind(mf);
    let stopped: boolean | undefined;
    mf.open = async (p, c) => {
      const conn = await openReal(p, c), update = conn.update.bind(conn);
      conn.update = async (...a) => { stopped ??= await m.interrupt(); return update(...a); }; // Stop pressed after the nested read
      return conn;
    };
    expect(await m.saveSource(join, { rowid: CMD1, values: { Client: '1' } })).toMatchObject({ ok: true });
    expect(lastTransaction()).toEqual(['begin', 'plan', 'rows', 'cancel', 'update', 'update', 'find', 'commit']);
    expect(stopped).toBe(false); // nothing was running, but the cancel reached the save's connection
  });

  it('a Decimal over 15 digits is compared by its stored text, not a double', async () => {
    const px: RemoteTable = { name: 'Prix', remote: 'Prix', schema: 'public', key: ['id'], skipped: [], design: t('Prix', [f('id', 'autoNumber', { external: true }), f('V', 'number', dec)]) };
    const ln: RemoteTable = { name: 'Lignes', remote: 'Lignes', schema: 'public', key: ['id'], skipped: [], design: t('Lignes', [f('id', 'autoNumber', { external: true }), f('V', 'number', dec)]) };
    const lk = t('Lignes', [f('id', 'autoNumber'), f('V', 'number', { ...dec, lookup: { kind: 'table', table: 'Prix', columnCount: 2, boundColumn: 2, limitToList: true } })]);
    const { x, fk } = migrated([px, ln], [undefined, linkMeta(lk, ln)], { Prix: [[1, '123456789012345.6789']], Lignes: [] });
    await x.insert('Lignes', { V: '123456789012345.6789' });
    expect(fk.lastRequest?.where).toEqual({ k: 'bin', op: '=', l: { k: 'id', name: 'V' }, r: { k: 'num', v: '123456789012345.6789' } });
    await x.insert('Lignes', { V: '-5.5' });
    expect(fk.lastRequest?.where).toMatchObject({ r: { k: 'un', op: '-', e: { k: 'num', v: '5.5000' } } }); // the stored text, as is
  });

  it('a query writing two server tables runs the rules of each (C5 R16)', async () => {
    const join = { kind: 'sql' as const, sql: 'SELECT n, Client, Montant, Nom FROM Commandes INNER JOIN Clients ON Commandes.Client = Clients.id' };
    expect(await m.saveSource(join, { rowid: CMD1, values: { Montant: '0', Nom: 'X' } })).toMatchObject({ ok: false, errors: [{ field: 'Montant', code: 'validation' }] });
    expect(await m.saveSource(join, { rowid: CMD1, values: { Montant: '2000' } })).toEqual({ ok: false, errors: [{ field: '', code: 'validation', table: 'Commandes' }] });
    expect(lastTransaction()).toEqual(['begin', 'update', 'rollback']); // the key row checked only, the rule read it
    expect(await m.saveSource(join, { rowid: CMD1, values: { Montant: '12', Nom: 'Martin SA' } })).toMatchObject({ ok: true, values: { n: 1, Montant: 12, Nom: 'Martin SA' } });
    expect(lastTransaction()).toEqual(['begin', 'update', 'update', 'find', 'update', 'commit']);
  });

  describe('action queries on a server source (C7 R14)', () => {
    const sql = (text: string): QueryRef => ({ kind: 'sql', sql: text });
    const anyway = { ...opts, skipFailures: true };
    const rows = async () => (await m.page('Commandes', { offset: 0, limit: 10 })).rows.map((r) => r.values.slice(0, 3));
    beforeEach(() => m.setContentEnabled(m.activeContent().fingerprint));

    it('INSERT … VALUES: evaluated in the front-end, one insert in one transaction, no server read', async () => {
      expect(await m.runAction(sql('INSERT INTO Commandes (Client, Montant) VALUES (1, 2 + 3)'), {}, opts)).toEqual({ ok: true, count: 1 });
      expect(lastTransaction()).toEqual(['begin', 'insert', 'commit']);
      expect(mf.log).not.toContain('plan');
      expect(await rows()).toEqual([[1, 2, 10], [2, 1, 5]]);
    });

    it('a front-end rule refusal counts by cause; run anyway skips it', async () => {
      const r = { ok: false, reason: 'rowErrors', failed: 1, total: 1, errors: [{ field: 'Montant', code: 'validation', message: 'Positif' }], byCause: { conversion: 0, key: 0, lock: 0, validation: 1 } };
      expect(await m.runAction(sql('INSERT INTO Commandes (Client, Montant) VALUES (1, -1)'), {}, opts)).toEqual(r);
      expect(lastTransaction()).toEqual(['begin', 'rollback']);
      expect(await m.runAction(sql('INSERT INTO Commandes (Client, Montant) VALUES (1, -1)'), {}, anyway)).toEqual({ ok: true, count: 0 });
      // an Update: the table rule ([Montant] < 1000) on the row read in the run's transaction
      expect(await m.runAction(sql('UPDATE Commandes SET Montant = 2000'), {}, opts)).toMatchObject({ ok: false, reason: 'rowErrors', failed: 1, total: 1, byCause: { validation: 1 } });
      expect(lastTransaction()).toEqual(['begin', 'rows', 'update', 'rollback']);
      expect(await rows()).toEqual([[1, 2, 10]]);
    });

    it('UPDATE and DELETE read their rows on the server with the target\'s tokens, then write them in the same transaction', async () => {
      expect(await m.runAction(sql('UPDATE Commandes SET Montant = 20'), {}, opts)).toEqual({ ok: true, count: 1 });
      expect(lastTransaction()).toEqual(['begin', 'rows', 'update', 'update', 'commit']); // the table rule: checked only, then written
      expect(mf.lastRequest).toMatchObject({ refs: true, sort: [], filter: [] });
      expect(await rows()).toEqual([[1, 2, 20]]);
      expect(await m.runAction(sql('DELETE FROM Commandes'), {}, opts)).toEqual({ ok: true, count: 1 });
      expect(lastTransaction()).toEqual(['begin', 'rows', 'delete', 'commit']);
      expect(await rows()).toEqual([]);
    });

    it('a refusal by the server rolls the whole run back, even with run anyway', async () => {
      const openReal = mf.open.bind(mf);
      mf.open = async (p, c) => { // the server refuses the second order (a missing parent)
        const conn = await openReal(p, c), insert = conn.insert.bind(conn);
        let n = 0;
        conn.insert = async (tb, v) => (++n === 2 ? { ok: false, errors: [{ field: 'Client', code: 'noParent' }] } : insert(tb, v));
        return conn;
      };
      const append = sql('INSERT INTO Commandes (Client, Montant) SELECT id, 5 FROM Clients');
      const refused = { ok: false, reason: 'rowErrors', failed: 1, total: 2, errors: [{ field: 'Client', code: 'noParent' }], byCause: { conversion: 0, key: 1, lock: 0, validation: 0 } };
      expect(await m.runAction(append, {}, anyway)).toEqual(refused);
      expect(lastTransaction()).toEqual(['begin', 'rows', 'insert', 'rollback']); // the first written, the second refused (not logged)
      expect(await rows()).toEqual([[1, 2, 10]]);
    });

    it('actionCount counts on the server; INSERT … VALUES counts one row without connecting', async () => {
      expect(await m.actionCount(sql('INSERT INTO Commandes (Client, Montant) VALUES (1, 5)'), {})).toEqual({ count: 1, table: 'Commandes' });
      expect(mf.connections).toBe(0);
      expect(await m.actionCount(sql('DELETE FROM Commandes'), {})).toEqual({ count: 1, table: 'Commandes' });
      expect(await m.actionCount(sql('INSERT INTO Commandes (Client, Montant) SELECT id, 5 FROM Clients'), {})).toEqual({ count: 2, table: 'Commandes' });
      expect(mf.log.filter((x) => x === 'count' || x === 'rows')).toEqual(['count', 'count']);
    });

    it('Make-Table refused; disabled content refused; a read-only front-end: readOnly', async () => {
      await expect(m.runAction(sql('SELECT * INTO X FROM Commandes'), {}, opts)).rejects.toThrow('bc:serverNotSupported|makeTable|postgresql');
      m.setContentEnabled(null);
      await expect(m.runAction(sql('DELETE FROM Commandes'), {}, opts)).rejects.toThrow('bc:contentDisabled');
      await expect(m.actionCount(sql('DELETE FROM Commandes'), {})).rejects.toThrow('bc:contentDisabled');
      const ro = Session.open(join(dir, 'migrated.basecraft'), { ...deps, connectors: { postgresql: mf }, sessionId: 'b' }); // m holds the file
      opened.push(ro);
      expect(ro.state.readOnly).toBe(true);
      ro.setContentEnabled(ro.activeContent().fingerprint);
      expect(await ro.runAction(sql('DELETE FROM Commandes'), {}, opts)).toEqual({ ok: false, reason: 'readOnly' });
      expect(mf.connections).toBe(0);
    });

    it('an Append supplying AutoNumber values is refused before anything is sent', async () => {
      await m.count('Commandes'); // connected
      const sent = mf.log.length;
      await expect(m.runAction(sql('INSERT INTO Commandes (n, Client, Montant) VALUES (9, 1, 5)'), {}, opts)).rejects.toThrow('bc:serverNotSupported|appendAutoNumber|postgresql');
      await expect(m.runAction(sql('INSERT INTO Commandes SELECT n, Client FROM Commandes'), {}, opts)).rejects.toThrow('bc:serverNotSupported|appendAutoNumber|postgresql');
      expect(mf.log.slice(sent)).not.toContain('begin');
      expect(await rows()).toEqual([[1, 2, 10]]);
    });

    it('a connector without transactions refuses an action query', async () => {
      const caps = mf.capabilities;
      Object.assign(mf, { capabilities: { ...caps, transactions: false } });
      try {
        await expect(m.runAction(sql('DELETE FROM Commandes'), {}, opts)).rejects.toThrow('bc:serverNotSupported|actionQuery|postgresql');
      } finally {
        Object.assign(mf, { capabilities: caps });
      }
      expect(await rows()).toEqual([[1, 2, 10]]);
    });

    it('a row changed since the run read it counts as a lock; run anyway skips it', async () => {
      const openReal = mf.open.bind(mf);
      mf.open = async (p, c) => {
        const conn = await openReal(p, c);
        conn.update = async (_t, ref) => ({ ok: false, conflict: 'changed', current: [1, 2, 11, ''], ref });
        return conn;
      };
      const q = sql('UPDATE Commandes SET Montant = 20');
      expect(await m.runAction(q, {}, opts)).toMatchObject({ ok: false, reason: 'rowErrors', failed: 1, total: 1, byCause: { lock: 1 } });
      expect(lastTransaction().at(-1)).toBe('rollback');
      expect(await m.runAction(q, {}, anyway)).toEqual({ ok: true, count: 0 });
    });

    it('a lost connection inside the transaction: outcome unknown, never sent again; Stop rolls back', async () => {
      await m.count('Commandes'); // connected
      mf.failNext = Object.assign(new Error('Connection terminated'), { lost: true });
      await expect(m.runAction(sql('UPDATE Commandes SET Montant = 20'), {}, opts)).rejects.toThrow('bc:serverError|connection|Connection terminated');
      expect(mf.log.filter((x) => x === 'begin')).toHaveLength(1);
      mf.hold = true;
      const p = m.runAction(sql('UPDATE Commandes SET Montant = 30'), {}, opts);
      await new Promise((r) => setTimeout(r, 20)); // the read waits on the server
      expect(await m.interrupt()).toBe(true);
      await expect(p).rejects.toThrow('bc:cancelled');
      mf.hold = false;
      expect(mf.log.slice(-2)).toEqual(['cancel', 'rollback']);
      expect(await rows()).toEqual([[1, 2, 10]]);
    });
  });
});

describe('the server drivers are loaded on first use (R1, C5 R1)', () => {
  it('a front-end without server links never opens the PostgreSQL or SQL Server connector', async () => {
    const open = vi.spyOn(CONNECTORS.postgresql!, 'open');
    const openMs = vi.spyOn(CONNECTORS.sqlserver!, 'open');
    try {
      const plain = join(dir, 'plain.basecraft');
      createBaseFile(plain, '0.0.0');
      const db = openBaseFile(plain, 'write', '0.0.0').db;
      createTable(db, t('Notes', [f('N°', 'autoNumber'), f('Texte', 'shortText')]));
      db.close();
      const x = Session.open(plain, deps); // the real registry
      opened.push(x);
      expect(x.listTables().map((l) => l.name)).toEqual(['Notes']);
      expect(await x.count('Notes')).toBe(0);
      expect((await x.page('Notes', { offset: 0, limit: 10 })).rows).toEqual([]);
      expect(x.serverKeys()).toEqual([]);
      expect(await x.interrupt()).toBe(false);
      await x.close();
      expect(open).not.toHaveBeenCalled();
      expect(openMs).not.toHaveBeenCalled();
    } finally {
      open.mockRestore();
      openMs.mockRestore();
    }
  });
});

describe('the server link dialog and the Linked Table Manager (Task 12)', () => {
  const P2 = { ...P, host: 'autre.example' };
  const KEY2 = 'postgresql://autre.example:5432/ventes?tls=verify-full';
  const tbl = (name: string, remote: string, schema: string, key = ['id']): RemoteTable =>
    ({ name, remote, schema, key, skipped: [], design: t(name, [f('id', 'number', { numberSize: 'longInteger' }), f('Nom', 'shortText')]) });

  it('inspectServer logs in with the typed password: the tables under free names (Access\'s 1, 2…), keyless read-only', async () => {
    const srv = testConnector({ tables: [
      tbl('Clients', 'Clients', 'public'), tbl('clients', 'clients', 'public'), tbl('compta_X', 'compta_X', 'public'), tbl('compta_X', 'X', 'compta'),
      tbl('Notes', 'notes', 'public', []), { ...tbl('bc_x', 'bc_x', 'public'), skipped: ['geo'] },
    ] });
    const s2 = open({ connectors: { postgresql: srv } });
    await expect(s2.inspectServer('postgresql', P2, 'ana', 'bad')).rejects.toThrow(`bc:linkUnavailable|needsLogin|${KEY2}`);
    const info = await s2.inspectServer('postgresql', P2, 'ana', 'secret');
    expect(info).toMatchObject({ key: KEY2, label: 'autre.example:5432/ventes' });
    expect(info.tables).toEqual([
      { name: 'Clients1', remote: 'Clients', schema: 'public', taken: false, readOnly: false }, // the front-end has a link Clients
      { name: 'clients2', remote: 'clients', schema: 'public', taken: false, readOnly: false }, // names ignore case
      { name: 'compta_X', remote: 'compta_X', schema: 'public', taken: false, readOnly: false },
      { name: 'compta_X1', remote: 'X', schema: 'compta', taken: false, readOnly: false }, // compta.X is compta_X too (R6)
      { name: 'Notes1', remote: 'notes', schema: 'public', taken: false, readOnly: true }, // a local table Notes
      { name: 'bc_x', remote: 'bc_x', schema: 'public', taken: false, readOnly: false, skipped: ['geo'], unsupported: 'reservedName' },
    ]);
    expect(srv.log.filter((x) => x === 'open' || x === 'close')).toEqual(['open', 'open', 'close']); // the dialog's connection is closed
  });

  it('a typed password the server refuses does not forget the key\'s working credential', async () => {
    await expect(s.inspectServer('postgresql', P, 'ana', 'bad')).rejects.toThrow(`bc:linkUnavailable|needsLogin|${KEY}`);
    expect((await s.page('Clients', { offset: 0, limit: 1 })).rows).toHaveLength(1);
  });

  it('createServerLinks caches designs; Refresh Link reads the design again, a dropped table is missingTable', async () => {
    const commandes = tbl('Commandes', 'Commandes', 'public');
    const tables = [commandes, tbl('Produits', 'Produits', 'public', [])];
    const srv = testConnector({ tables });
    const s2 = open({ connectors: { postgresql: srv } });
    await expect(s2.createServerLinks('postgresql', P2, ['Commandes'])).rejects.toThrow(`bc:linkUnavailable|needsLogin|${KEY2}`); // no login yet
    await s2.inspectServer('postgresql', P2, 'ana', 'secret');
    expect(await s2.createServerLinks('postgresql', P2, ['Commandes', 'Inconnue'])).toEqual({ ok: false, reason: 'missingTables', names: ['Inconnue'] });
    expect(await s2.createServerLinks('postgresql', P2, ['Commandes', 'Produits'])).toEqual({ ok: true });
    expect(s2.tableDesign('Commandes')).toEqual(commandes.design);
    expect(s2.listLinks().filter((l) => l.path === 'autre.example:5432/ventes').map((l) => [l.name, l.state])).toEqual([['Commandes', 'ok'], ['Produits', 'ok']]);
    expect(s2.serverKeys()).toEqual([KEY, KEY2]);
    expect(await s2.createServerLinks('postgresql', P2, ['Commandes'])).toEqual({ ok: false, reason: 'nameExists', names: ['Commandes'] });

    // the server's table gains a column, Produits is dropped
    tables[0] = { ...commandes, design: t('Commandes', [...commandes.design.fields, f('Total', 'currency')]) };
    tables.splice(1, 1);
    const infos = await s2.refreshLinks(['Commandes', 'Produits']);
    expect(infos.map((l) => [l.name, l.state])).toEqual([['Commandes', 'ok'], ['Produits', 'missingTable']]);
    expect(infos[0]).toMatchObject({ kind: 'postgresql', path: 'autre.example:5432/ventes', params: { ...P2 } });
    expect(infos[0]!.risk).toBeUndefined(); // a server has no location risk to show
    expect(s2.tableDesign('Commandes').fields.map((x) => x.name)).toEqual(['id', 'Nom', 'Total']);
    expect(s2.tableDesign('Produits').fields.map((x) => x.name)).toEqual(['id', 'Nom']); // the old design stays
  });

  it('Refresh Link of a server it cannot reach shows that state; without a login, needsLogin (the manager cannot prompt over itself)', async () => {
    await s.page('Clients', { offset: 0, limit: 1 }); // the connection open: failNext hits the next call
    fake.failNext = new Error('bc:linkUnavailable|cannotConnect|db.example:5432/ventes');
    expect((await s.refreshLinks(['Clients']))[0]).toMatchObject({ name: 'Clients', state: 'cannotConnect' });
    const s2 = open({ connectors: { postgresql: testConnector({ tables: [clients] }) } });
    expect((await s2.refreshLinks(['Clients']))[0]).toMatchObject({ name: 'Clients', state: 'needsLogin', path: 'db.example:5432/ventes' });
  });

  it('relink refuses a server link and relinkServer a file link (defence in depth: the renderer routes by kind)', async () => {
    const data = join(dir, 'data.basecraft');
    createBaseFile(data, '0.0.0');
    const d = openBaseFile(data, 'write', '0.0.0').db;
    createTable(d, t('T', [f('N°', 'autoNumber')]));
    d.close();
    const db = openBaseFile(fe, 'write', '0.0.0').db;
    addLinks(db, fe, 'basecraft', data, ['T']);
    db.close();
    const s2 = open({ connectors: { postgresql: fake } });
    s2.setCredential(KEY, 'ana', 'secret');
    expect(() => s2.relink(['Clients'], data)).toThrow('bc:invalidArgument');
    expect(() => s2.relink(['T', 'Clients'], data)).toThrow('bc:invalidArgument');
    await expect(s2.relinkServer(['T'], 'postgresql', P)).rejects.toThrow('bc:invalidArgument');
    await expect(s2.relinkServer(['Clients'], 'sqlserver', { host: 'h', database: 'd' })).rejects.toThrow('bc:invalidArgument'); // a PostgreSQL link never moves to SQL Server
    expect(s2.listLinks().map((l) => [l.name, l.kind])).toEqual([['Clients', 'postgresql'], ['T', 'basecraft'], ['Villes', 'postgresql'], ['Vue', 'postgresql']]);
  });

  it('relinkServer moves names to another server only when each table is there', async () => {
    const srv = testConnector({ tables: [{ ...clients, name: 'X' }, { ...vue, design: t('X', [f('Ville', 'shortText')]) }] });
    const s2 = open({ connectors: { postgresql: srv } });
    s2.setCredential(KEY, 'ana', 'secret');
    await s2.inspectServer('postgresql', P2, 'ana', 'secret');
    const before = s2.listLinks();
    expect(await s2.relinkServer(['Clients', 'Villes'], 'postgresql', P2)).toEqual({ ok: false, reason: 'missingTables', names: ['Villes'] });
    expect(s2.listLinks()).toEqual(before); // nothing changed
    expect(await s2.relinkServer(['Clients', 'Vue'], 'postgresql', P2)).toEqual({ ok: true });
    expect(s2.listLinks().map((l) => [l.name, l.path])).toEqual([
      ['Clients', 'autre.example:5432/ventes'], ['Villes', 'db.example:5432/ventes'], ['Vue', 'autre.example:5432/ventes']]);
    expect(s2.tableDesign('Vue')).toEqual(t('Vue', [f('Ville', 'shortText')])); // the new server's design, under the link's name
    expect(await s2.relinkServer(['Villes'], 'postgresql', P2)).toEqual({ ok: false, reason: 'missingTables', names: ['Villes'] });
    expect(s2.serverKeys()).toEqual([KEY, KEY2]);
  });

  it('a long name that collides is cut so name and suffix stay within 64 characters (review 3)', async () => {
    const long = 'é'.repeat(64);
    const srv = testConnector({ tables: [tbl(long, 'a', 'public'), tbl(long, 'b', 'public')] });
    const s2 = open({ connectors: { postgresql: srv } });
    const info = await s2.inspectServer('postgresql', P2, 'ana', 'secret');
    expect(info.tables.map((x) => [x.name, x.unsupported])).toEqual([[long, undefined], [`${'é'.repeat(63)}1`, undefined]]);
  });

  it('a server error on one link does not fail the whole Refresh: that link keeps it, the others refresh (review 4)', async () => {
    fake.failNext = new Error('bc:timeout|60');
    const infos = await s.refreshLinks(['Clients', 'Vue']);
    expect(infos.map((l) => [l.name, l.state, l.error])).toEqual([['Clients', 'cannotConnect', 'bc:timeout|60'], ['Vue', 'ok', undefined]]);
    fake.failNext = new Error('bc:cancelled'); // Stop ends the whole Refresh
    await expect(s.refreshLinks(['Clients', 'Vue'])).rejects.toThrow('bc:cancelled');
  });

  it('relinkServer: a table the server has but BaseCraft cannot link is unsupportedKind, not missing (review 5)', async () => {
    const srv = testConnector({ tables: [{ ...vue, design: t('X', []) }] }); // no field BaseCraft reads
    const s2 = open({ connectors: { postgresql: srv } });
    await s2.inspectServer('postgresql', P2, 'ana', 'secret');
    expect(await s2.relinkServer(['Vue'], 'postgresql', P2)).toEqual({ ok: false, reason: 'unsupportedKind', names: ['Vue'] });
    expect(await s2.relinkServer(['Vue', 'Villes'], 'postgresql', P2)).toEqual({ ok: false, reason: 'missingTables', names: ['Villes'] });
  });
});
