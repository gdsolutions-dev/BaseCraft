import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs, { existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import { join, posix } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createBaseFile, openBaseFile } from './db/file-format';
import type { RiskProbe } from './db/location-risk';
import { joinPresence, presenceEntry } from './db/presence';
import { saveStartupOptions } from './db/startup';
import { seedSales } from './query/test-db';
import { Session, type SessionDeps } from './session';
import type { SaveTableRequest } from '../shared/api';
import type { SqlValue } from '../shared/coerce';
import { DEFAULT_STARTUP } from '../shared/startup';
import { f } from '../shared/test-fixtures';

// C3 Task 4: a seedSales data file opened directly by two sessions, a (s1) and b (s2), on one clock.
let dir: string;
let data: string;
let now: number;
let s1: Session;
let s2: Session;
const opened: Session[] = [];
const probe: RiskProbe = { platform: 'win32', env: {}, homedir: 'C:\\Users\\x', windowsDriveType: () => 3 };
const deps = (sessionId: string): SessionDeps => ({
  appVersion: '0.0.0', region: 'fr-FR', probe, lockDeps: { now: () => now }, sessionId, presence: { settleMs: 0 },
});
const open = (p: string, d: SessionDeps) => { const x = Session.open(p, d); opened.push(x); return x; };
function seed(p: string, dataFile: boolean): void {
  createBaseFile(p, '0.0.0');
  const db = openBaseFile(p, 'write', '0.0.0').db;
  seedSales(db);
  if (dataFile) saveStartupOptions(db, { ...DEFAULT_STARTUP, dataFile: true });
  db.close();
}
const raw = (p: string, sql: string) => { const db = new DatabaseSync(p); try { db.exec(sql); } finally { db.close(); } };
const value = (p: string, sql: string): unknown => {
  const db = new DatabaseSync(p, { readOnly: true });
  try { return Object.values(db.prepare(sql).get() as object)[0]; } finally { db.close(); }
};
const addField = (table: string, name: string): SaveTableRequest => {
  const d = s1.tableDesign(table);
  return { originalName: table, design: { ...d, fields: [...d.fields, f(name, 'shortText')] },
    mapping: [...d.fields.map((x) => ({ name: x.name, sourceName: x.name })), { name, sourceName: null }], allowDataLoss: false };
};
/** Another workstation's entry, as its BaseCraft wrote it (then it crashed: nobody beats it). */
const writeEntry = (base: string, id: string, o: { host: string }) => {
  fs.mkdirSync(`${base}.users`, { recursive: true });
  writeFileSync(join(`${base}.users`, `${id}.lock`), JSON.stringify({ user: 'paul', host: o.host, pid: 7, sessionId: id, heartbeatAt: new Date(now).toISOString() }));
};
const cifsMountOf = (d: string) => `//srv/share ${d.replace(/ /g, '\\040')} cifs rw,vers=3.1.1 0 0\n`;

beforeEach(() => {
  now = Date.parse('2026-10-29T10:00:00.000Z');
  dir = fs.realpathSync.native(fs.mkdtempSync(join(os.tmpdir(), 'bcshared-')));
  data = join(dir, 'data.basecraft');
  seed(data, true);
  s1 = open(data, deps('a'));
  s2 = open(data, deps('b'));
});
afterEach(() => {
  for (const x of opened.splice(0)) x.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('a data file opened directly (C3 R2–R6)', () => {
  it('two sessions write the same data file at the same time', async () => {
    expect([s1.state.shared, s2.state.shared]).toEqual([true, true]);
    expect(s1.state).toMatchObject({ readOnly: false, dataFile: true });
    expect(existsSync(`${data}.lock`)).toBe(false);
    expect(readdirSync(`${data}.users`).sort()).toEqual(['a.lock', 'b.lock']);
    expect((await s1.insert('Clients', { Nom: 'Petit' })).ok).toBe(true);
    expect(s2.page('Clients', { offset: 0, limit: 10 }).rows).toHaveLength(5);
    expect(s1.state.linkedLocks).toEqual([presenceEntry(data, 'a')]);
  });

  it('a structure change is refused while someone else is present, then allowed', async () => { // Review Focus 3
    await expect(s1.saveTable(addField('Clients', 'Tel'))).rejects.toThrow(/^bc:dataFileInUse\|.+\(.+\)/);
    expect(existsSync(`${data}.lock`)).toBe(false);
    expect(s1.state.shared).toBe(true);
    s2.close();
    expect(await s1.saveTable(addField('Clients', 'Tel'))).toEqual({ ok: true });
    expect(s1.state.shared).toBeUndefined();
    expect(existsSync(`${data}.lock`)).toBe(true);
    expect(s1.state.linkedLocks).toBeUndefined(); // its entry is released with the exclusive lock taken
    expect(readdirSync(`${data}.users`)).toEqual([]);
    const s3 = open(data, deps('c'));
    expect(s3.state).toMatchObject({ readOnly: true, readOnlyReason: 'heldByOther', dataFile: true });
    expect(readdirSync(`${data}.users`)).toEqual([]); // the entry written before the lock check is released
  });

  it('a crashed workstation stops counting 30 s after it was first seen', async () => { // Review Focus 1
    writeEntry(data, 'z', { host: 'B' });
    s2.close();
    await expect(s1.saveTable(addField('Clients', 'Tel'))).rejects.toThrow('bc:dataFileInUse');
    now += 31_000;
    expect(await s1.saveTable(addField('Clients', 'Tel'))).toEqual({ ok: true });
    expect(existsSync(join(`${data}.users`, 'z.lock'))).toBe(false);
  });

  it('every structure call needs the exclusive lock; row writes, objects and options stay shared', async () => {
    await s1.insert('Clients', { Nom: 'Petit' });
    expect(s1.saveObject('form', 'F', { controls: [] }, null)).toEqual({ ok: true });
    s1.saveStartup({ ...DEFAULT_STARTUP, dataFile: true, appTitle: 'X' });
    expect(await s1.appendTable('Clients', 'Clients')).toEqual({ appended: 0, refused: 0 });
    const refused = (f: () => unknown) => expect(Promise.resolve().then(f)).rejects.toThrow('bc:dataFileInUse');
    await refused(() => s1.renameTable('Clients', 'Clients2'));
    await refused(() => s1.copyTable('Clients', 'Clients2'));
    await refused(() => s1.dropTable('Commandes'));
    await refused(() => s1.deleteRelation('x'));
    await refused(() => s1.compact());
    expect(s1.state.shared).toBe(true);
  });

  it('turning the data file option off is a structure change: refused while someone else is present (R4)', () => {
    expect(() => s1.saveStartup({ ...DEFAULT_STARTUP, dataFile: false })).toThrow(/^bc:dataFileInUse\|/);
    expect(s1.startup().dataFile).toBe(true);
    expect(s1.state.shared).toBe(true);
    expect(existsSync(`${data}.lock`)).toBe(false);
    s2.close();
    s1.saveStartup({ ...DEFAULT_STARTUP, dataFile: false });
    expect(s1.startup().dataFile).toBe(false);
    expect(s1.state.shared).toBeUndefined(); // alone, under the exclusive lock until close
    expect(existsSync(`${data}.lock`)).toBe(true);
  });

  it('a refused split takes no exclusive lock (R4, R13): refusals come first', () => {
    expect(s1.splitDatabase(data)).toEqual({ ok: false, reason: 'self' });
    const held = join(dir, 'held.basecraft');
    seed(held, false);
    open(held, deps('c'));
    expect(() => s1.splitDatabase(held)).toThrow('bc:targetInUse');
    expect(existsSync(`${data}.lock`)).toBe(false);
    expect(s1.state.shared).toBe(true);
    expect(readdirSync(dir).filter((n) => n.includes('.backup-'))).toEqual([]);
  });

  it('exclusive open mode with someone present opens read-only inUse', () => {
    const s = open(data, { ...deps('c'), openMode: 'exclusive' });
    expect(s.state).toMatchObject({ readOnly: true, readOnlyReason: 'inUse' });
    expect(s.state.users!.map((u) => u.sessionId).sort()).toEqual(['a', 'b']);
    expect(existsSync(`${data}.lock`)).toBe(false);
  });

  it('exclusive open mode alone holds the lock, as a base that is not a data file', () => {
    s1.close(); s2.close();
    const s = open(data, { ...deps('c'), openMode: 'exclusive' });
    expect(s.state).toMatchObject({ readOnly: false, dataFile: true });
    expect(s.state.shared).toBeUndefined();
    expect(open(data, deps('d')).state).toMatchObject({ readOnly: true, readOnlyReason: 'heldByOther' });
  });

  it('a data file in a synchronized folder is refused shared mode', () => {
    const syncedDir = join(dir, 'OneDrive - Contoso');
    fs.mkdirSync(syncedDir);
    const syncedData = join(syncedDir, 'data.basecraft');
    seed(syncedData, true);
    const s = open(syncedData, { ...deps('c'), probe: { ...probe, env: { OneDrive: syncedDir } } });
    expect(s.state).toMatchObject({ readOnly: true, readOnlyReason: 'syncedFolder', dataFile: true });
    expect(existsSync(`${syncedData}.users`)).toBe(false);
    expect(s.count('Clients')).toBe(4);
  });

  it('a Linux client opens a data file on a network location read-only, with no entry', () => { // G1
    // the probe is posix: the risk check gets the forward-slash form of the data path and a cifs mount line for its folder
    const posixData = data.replace(/\\/g, '/');
    const s = open(posixData, { ...deps('c'), probe: { ...probe, platform: 'linux', mounts: cifsMountOf(posix.dirname(posixData)) } });
    expect(s.state).toMatchObject({ readOnly: true, readOnlyReason: 'unsupportedClient', locationRisk: 'network', dataFile: true });
    expect(existsSync(join(`${data}.users`, 'c.lock'))).toBe(false);
  });

  it('a base that is not a data file keeps the exclusive lock', () => {
    const plain = join(dir, 'plain.basecraft');
    seed(plain, false);
    const p1 = open(plain, deps('a'));
    const p2 = open(plain, deps('b'));
    expect(p1.state).toMatchObject({ readOnly: false });
    expect(p1.state.dataFile).toBeUndefined();
    expect(p2.state).toMatchObject({ readOnly: true, readOnlyReason: 'heldByOther' });
    expect(existsSync(`${plain}.users`)).toBe(false);
  });

  it('a removed entry is written again at the next tick', async () => {
    rmSync(join(`${data}.users`, 'a.lock'));
    s1.tick();
    expect(existsSync(join(`${data}.users`, 'a.lock'))).toBe(true);
    expect(s1.state.readOnly).toBe(false);
    expect((await s1.insert('Clients', { Nom: 'Petit' })).ok).toBe(true);
  });

  it('a re-joined entry checks the exclusive lock: taken meanwhile, the session goes read-only and names the holder', () => {
    rmSync(join(`${data}.users`, 'a.lock')); // a slept past 30 s: another session removed its entry and went exclusive
    writeFileSync(`${data}.lock`, JSON.stringify({ user: 'paul', host: os.hostname(), pid: 7, sessionId: 'z', heartbeatAt: new Date(now).toISOString() }));
    s1.tick();
    expect(s1.state).toMatchObject({ readOnly: true, readOnlyReason: 'lockLost', lockHolder: { sessionId: 'z' } });
    expect(s1.state.shared).toBeUndefined();
    expect(s1.state.linkedLocks).toBeUndefined();
    expect(existsSync(join(`${data}.users`, 'a.lock'))).toBe(false);
  });

  it('an entry that cannot be written again: read-only lockLost, the other bytes left alone', () => {
    const other = JSON.stringify({ user: 'paul', host: os.hostname(), pid: 7, sessionId: 'q', heartbeatAt: new Date(now).toISOString() });
    writeFileSync(join(`${data}.users`, 'a.lock'), other); // another session's take-over, between its check and its removal
    s1.tick();
    expect(s1.state).toMatchObject({ readOnly: true, readOnlyReason: 'lockLost' });
    expect(s1.state.linkedLocks).toBeUndefined();
    expect(readFileSync(join(`${data}.users`, 'a.lock'), 'utf8')).toBe(other);
  });

  it('a busy file when the data file option is read: the open fails, never exclusive', () => {
    const w = new DatabaseSync(data);
    w.exec('BEGIN EXCLUSIVE'); // another workstation mid-commit, past busy_timeout
    try {
      expect(() => Session.open(data, deps('c'))).toThrow('bc:busy');
    } finally {
      w.exec('ROLLBACK');
      w.close();
    }
    expect(existsSync(`${data}.lock`)).toBe(false);
    expect(readdirSync(`${data}.users`).sort()).toEqual(['a.lock', 'b.lock']);
  }, 20_000);

  it('an older data file is migrated only by a session alone', () => {
    const old = join(dir, 'old.basecraft');
    seed(old, true);
    raw(old, "DROP TABLE bc_links; DROP TABLE bc_sources; UPDATE bc_meta SET value='2' WHERE key='format_minor'"); // a 1.2 data file
    const b = joinPresence(old, 'b', { now: () => now })!;
    expect(() => Session.open(old, deps('a'))).toThrow(/^bc:dataFileInUse\|/);
    expect(readdirSync(`${old}.users`)).toEqual(['b.lock']);
    expect(existsSync(`${old}.lock`)).toBe(false);
    b.release();
    const s = open(old, deps('a'));
    expect(s.state).toMatchObject({ readOnly: false, dataFile: true });
    expect(s.state.shared).toBeUndefined();
    expect(s.state.migratedBackupPath).toBeTruthy();
    expect(existsSync(`${old}.lock`)).toBe(true);
    expect(value(old, "SELECT value FROM bc_meta WHERE key = 'format_minor'")).toBe('3');
    expect(open(old, { ...deps('c'), migrate: false }).state).toMatchObject({ readOnly: true, readOnlyReason: 'heldByOther' });
  });

  it('the Runtime never migrates an older data file', () => {
    const old = join(dir, 'old.basecraft');
    seed(old, true);
    raw(old, "DROP TABLE bc_links; DROP TABLE bc_sources; UPDATE bc_meta SET value='2' WHERE key='format_minor'");
    expect(() => Session.open(old, { ...deps('a'), migrate: false })).toThrow(/needsDesigner/);
    expect(readdirSync(`${old}.users`)).toEqual([]);
  });

  it('Save As refuses a target others use in shared mode', async () => {
    const target = join(dir, 'target.basecraft');
    seed(target, true);
    const before = readFileSync(target);
    joinPresence(target, 'z', { now: () => now });
    await expect(s1.saveCopy(target)).rejects.toThrow('bc:targetInUse');
    expect(readFileSync(target).equals(before)).toBe(true);
  });

  it('no reconcile in shared mode', () => {
    s1.close(); s2.close();
    raw(data, 'CREATE TABLE Ext (id INTEGER PRIMARY KEY, v TEXT)');
    const s = open(data, deps('c'));
    expect(s.state.shared).toBe(true);
    expect(s.state.reconcileReport).toBeUndefined();
    expect(value(data, "SELECT count(*) FROM bc_tables WHERE name = 'Ext'")).toBe(0);
    s.close();
    const e = open(data, { ...deps('d'), openMode: 'exclusive' });
    expect(e.state.reconcileReport?.addedTables).toEqual(['Ext']);
  });

  it('a stale exclusive lock is taken over, released, and the session joins shared', () => {
    s1.close(); s2.close();
    writeFileSync(`${data}.lock`, JSON.stringify({ user: 'x', host: os.hostname(), pid: 1, sessionId: 'dead', heartbeatAt: new Date(now - 60_000).toISOString() }));
    const s = open(data, deps('c'));
    expect(s.state).toMatchObject({ readOnly: true, readOnlyReason: 'heldByOther', lockStale: true });
    expect(s.takeOverLock()).toMatchObject({ readOnly: false, shared: true });
    expect(existsSync(`${data}.lock`)).toBe(false);
    expect(readdirSync(`${data}.users`)).toEqual(['c.lock']);
  });

  it("the data stamp moves on another connection's commit, not on its own", async () => { // R10
    const st = s1.dataStamp();
    await s1.insert('Clients', { Nom: 'Petit' }); expect(s1.dataStamp()).toBe(st);
    await s2.insert('Clients', { Nom: 'Grand' }); expect(s1.dataStamp()).not.toBe(st);
  });

  it('close releases the entry', () => {
    s1.close();
    expect(readdirSync(`${data}.users`)).toEqual(['b.lock']);
  });
});

describe('optimistic locking between two workstations (C3 R8)', () => {
  const orig = { 'N°': 3, Nom: 'Durand', Ville: 'Paris' };
  it('two workstations, one record: the second save conflicts, Save Record wins', async () => { // Review Focus 2
    const d = s1.tableDesign('Clients');
    expect((await s1.update('Clients', 3, { Ville: 'Brest' }, orig)).ok).toBe(true);
    const r = await s2.update('Clients', 3, { Ville: 'Lille' }, orig);
    expect(r).toMatchObject({ conflict: 'changed' });
    const cur = Object.fromEntries(d.fields.map((f, i) => [f.name, (r as { current: SqlValue[] }).current[i]]));
    expect((await s2.update('Clients', 3, { Ville: 'Lille' }, cur)).ok).toBe(true);
    expect(value(data, 'SELECT Ville FROM Clients WHERE rowid = 3')).toBe('Lille');
  });
});
