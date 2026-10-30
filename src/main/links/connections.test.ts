import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs, { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { BaseFileError, createBaseFile, openBaseFile } from '../db/file-format';
import type { RiskProbe } from '../db/location-risk';
import { presenceEntry } from '../db/presence';
import { createTable } from '../db/schema';
import { saveStartupOptions } from '../db/startup';
import { DEFAULT_STARTUP } from '../../shared/startup';
import { f, t } from '../../shared/test-fixtures';
import { LinkedSources, openPlainSqlite, sourceKindOf, type LinkedDeps } from './connections';
import { addLinks, sourceRows } from './store';

// peekStartup made to fail (busy, unreadable) on a file whose header is a valid BaseCraft one: the fail-closed branch.
const peek = vi.hoisted(() => ({ fail: null as Error | null, calls: 0 }));
vi.mock('../db/startup', async (original) => {
  const m = await original<typeof import('../db/startup')>();
  return { ...m, peekStartup: (p: string) => { peek.calls++; if (peek.fail) throw peek.fail; return m.peekStartup(p); } };
});

// A front-end linking `data.basecraft` (table Clients) and `plain.sqlite` (table T), in a temp folder.
let dir: string;
let fe: string;
let data: string;
let plain: string;
let front: DatabaseSync;
let now = 0;
const open: LinkedSources[] = [];
const probe: RiskProbe = { platform: 'win32', env: {}, homedir: 'C:\\Users\\x', windowsDriveType: () => 3 };
const deps = (sessionId = 'a'): LinkedDeps => ({ frontEnd: fe, appVersion: '0.0.0', sessionId, lockDeps: { now: () => now }, probe });
const sources = (sessionId = 'a') => { const l = new LinkedSources(() => front, deps(sessionId)); open.push(l); return l; };
const idOf = (kind: string) => sourceRows(front).find((s) => s.kind === kind)!.id;
const tablesOf = (p: string) => {
  const db = new DatabaseSync(p, { readOnly: true });
  try { return (db.prepare(`SELECT name FROM sqlite_master WHERE type = 'table'`).all() as { name: string }[]).map((r) => r.name); } finally { db.close(); }
};
const lockOf = (p: string) => JSON.parse(readFileSync(`${p}.lock`, 'utf8'));

beforeEach(() => {
  dir = fs.realpathSync.native(fs.mkdtempSync(join(os.tmpdir(), 'bcconn-')));
  fe = join(dir, 'front.basecraft');
  data = join(dir, 'data.basecraft');
  plain = join(dir, 'plain.sqlite');
  now = 0;
  peek.fail = null;
  createBaseFile(data, '0.0.0');
  const d = openBaseFile(data, 'write', '0.0.0').db;
  createTable(d, t('Clients', [f('N°', 'autoNumber'), f('Nom', 'shortText')]));
  d.close();
  const p = new DatabaseSync(plain);
  p.exec('CREATE TABLE T (id INTEGER PRIMARY KEY, n INTEGER)');
  p.close();
  createBaseFile(fe, '0.0.0');
  front = openBaseFile(fe, 'write', '0.0.0').db;
  addLinks(front, fe, 'basecraft', data, ['Clients']);
  addLinks(front, fe, 'sqlite', plain, ['T']);
});
afterEach(() => {
  for (const l of open.splice(0)) l.close();
  front.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('sourceKindOf and openPlainSqlite (R7)', () => {
  it('tells a BaseCraft file from a plain SQLite file, and refuses anything else', () => {
    expect(sourceKindOf(data)).toBe('basecraft');
    expect(sourceKindOf(plain)).toBe('sqlite');
    const txt = join(dir, 'x.txt');
    writeFileSync(txt, 'not a database');
    expect(() => sourceKindOf(txt)).toThrow(BaseFileError);
    expect(() => sourceKindOf(join(dir, 'missing'))).toThrow(BaseFileError);
  });
  it('tells an Access file by its header, whatever its extension (C2 R2)', () => {
    for (const [name, as] of [['Ventes.mdb', 'a.sqlite'], ['Ventes.accdb', 'b.db'], ['Ventes-mdp.accdb', 'c.basecraft']]) {
      fs.copyFileSync(join(__dirname, '../../../tests/fixtures/access', name), join(dir, as));
      expect(sourceKindOf(join(dir, as)), name).toBe('access');
    }
  });

  it('opens a plain file with a TEMP catalog: no bc_ table, journal mode and bytes kept', () => {
    const w = new DatabaseSync(plain);
    w.exec('PRAGMA journal_mode=WAL');
    w.close();
    const before = readFileSync(plain);
    for (const mode of ['write', 'readOnly'] as const) {
      const db = openPlainSqlite(plain, mode);
      expect(db.prepare('SELECT count(*) AS n FROM bc_fields').get()).toEqual({ n: 0 });
      expect(db.prepare('SELECT bc_fold(?) AS x').get('É')).toEqual({ x: 'e' });
      expect(db.prepare('PRAGMA foreign_keys').get()).toEqual({ foreign_keys: 1 });
      db.close();
    }
    expect(readFileSync(plain)).toEqual(before);
    expect(tablesOf(plain)).toEqual(['T']);
    const r = new DatabaseSync(plain, { readOnly: true });
    expect(r.prepare('PRAGMA journal_mode').get()).toEqual({ journal_mode: 'wal' });
    r.close();
  });
});

describe('LinkedSources (R3, R4)', () => {
  it('opens a source once, writable, holding its lock; close releases it', () => {
    const l = sources();
    const c = l.open(idOf('basecraft'), true);
    expect(c).toMatchObject({ state: 'ok', writable: true, path: data, risk: 'local' });
    expect(l.open(idOf('basecraft'), true).db).toBe(c.db);
    expect(lockOf(data).sessionId).toBe('a');
    expect(l.heldLockPaths()).toEqual([data]);
    expect(l.open(idOf('sqlite'), true)).toMatchObject({ state: 'ok', writable: true, path: plain });
    expect(l.heldLockPaths()).toEqual([data, plain]);
    expect(l.dataVersions()).toHaveLength(3); // the count of opens, then one per connection
    l.close();
    expect(existsSync(`${data}.lock`)).toBe(false);
    expect(existsSync(`${plain}.lock`)).toBe(false);
    expect(l.heldLockPaths()).toEqual([]);
  });

  it('read-only when not asked to write: no lock', () => {
    const l = sources();
    expect(l.open(idOf('basecraft'), false)).toMatchObject({ state: 'readOnly', writable: false });
    expect(existsSync(`${data}.lock`)).toBe(false);
  });

  it('a source held by another session opens read-only, with its holder', () => {
    sources('a').open(idOf('basecraft'), true);
    const c = sources('b').open(idOf('basecraft'), true);
    expect(c).toMatchObject({ state: 'readOnly', writable: false, stale: false, holder: expect.objectContaining({ sessionId: 'a' }) });
    expect(c.db).not.toBeNull();
  });

  it('a missing, foreign or unknown source fails with its state and is retried on the next use', () => {
    const l = sources();
    renameSync(data, `${data}.moved`);
    expect(l.open(idOf('basecraft'), true)).toMatchObject({ state: 'missingFile', db: null, path: data });
    expect(existsSync(`${data}.lock`)).toBe(false);
    renameSync(`${data}.moved`, data);
    expect(l.open(idOf('basecraft'), true).state).toBe('ok');
    writeFileSync(plain, 'not a database');
    expect(l.open(idOf('sqlite'), true)).toMatchObject({ state: 'cannotOpen', db: null });
    expect(existsSync(`${plain}.lock`)).toBe(false);
    front.prepare(`UPDATE bc_sources SET kind = 'postgresql' WHERE kind = 'sqlite'`).run();
    expect(l.open(idOf('postgresql'), true)).toMatchObject({ state: 'unsupportedKind', db: null });
    expect(l.open('no such id', true)).toMatchObject({ state: 'cannotOpen', db: null });
  });

  it('the front-end itself is never opened as a source (its lock would be adopted, then released)', () => {
    front.prepare('UPDATE bc_sources SET props = ? WHERE kind = ?').run(JSON.stringify({ path: fe }), 'basecraft');
    writeFileSync(`${fe}.lock`, JSON.stringify({ user: 'u', host: os.hostname(), pid: 1, sessionId: 'a', heartbeatAt: new Date(0).toISOString() }));
    expect(sources().open(idOf('basecraft'), true)).toMatchObject({ state: 'cannotOpen', db: null });
    expect(existsSync(`${fe}.lock`)).toBe(true);
  });

  it('a file of a newer major or an older one is refused, never migrated', () => {
    const set = (major: string) => { const d = new DatabaseSync(data); d.prepare(`UPDATE bc_meta SET value = ? WHERE key = 'format_major'`).run(major); d.close(); };
    set('2');
    expect(sources().open(idOf('basecraft'), true)).toMatchObject({ state: 'newerMajor', db: null });
    set('0');
    const before = readFileSync(data);
    expect(sources().open(idOf('basecraft'), true)).toMatchObject({ state: 'needsMigration', db: null });
    expect(readFileSync(data)).toEqual(before);
    expect(fs.readdirSync(dir).filter((n) => n.includes('backup'))).toEqual([]);
    expect(existsSync(`${data}.lock`)).toBe(false);
  });

  it('an older minor (1.2) is used as it is: its missing bc_ tables are TEMP, the file keeps format 1.2', () => {
    const d = new DatabaseSync(data);
    d.exec(`DROP TABLE bc_links; DROP TABLE bc_sources; UPDATE bc_meta SET value = '2' WHERE key = 'format_minor'`);
    d.close();
    const c = sources().open(idOf('basecraft'), true);
    expect(c.state).toBe('ok');
    expect(c.db!.prepare('SELECT count(*) AS n FROM bc_links').get()).toEqual({ n: 0 });
    expect(tablesOf(data)).not.toContain('bc_links');
  });

  it('a lost lock makes that source read-only; tick says so', () => {
    const l = sources();
    l.open(idOf('basecraft'), true);
    expect(l.tick()).toBe(false);
    writeFileSync(`${data}.lock`, JSON.stringify({ user: 'u', host: 'PC-2', pid: 1, sessionId: 'z', heartbeatAt: new Date(0).toISOString() }));
    const opens = l.dataVersions()[0];
    expect(l.tick()).toBe(true);
    expect(l.dataVersions()[0]).toBe(opens! + 1); // final review M1: a reconnect invalidates cached totals
    expect(l.open(idOf('basecraft'), true)).toMatchObject({ state: 'readOnly', writable: false, holder: expect.objectContaining({ sessionId: 'z' }) });
    expect(l.heldLockPaths()).toEqual([]);
    expect(lockOf(data).sessionId).toBe('z'); // never released: not ours
  });

  it('refresh takes a stale lock over; open never does', () => {
    writeFileSync(`${data}.lock`, JSON.stringify({ user: 'u', host: 'PC-2', pid: 1, sessionId: 'z', heartbeatAt: new Date(0).toISOString() }));
    const l = sources();
    expect(l.open(idOf('basecraft'), true)).toMatchObject({ state: 'readOnly', stale: false });
    now = 31_000; // observed 31 s of this reader's clock (R13)
    expect(l.open(idOf('basecraft'), true).state).toBe('readOnly'); // cached: open never takes over
    expect(l.refresh(idOf('basecraft'), true)).toMatchObject({ state: 'ok', writable: true });
    expect(lockOf(data).sessionId).toBe('a');
  });

  it('a plain file read-only on disk opens read-only and takes no lock', () => {
    fs.chmodSync(plain, 0o444);
    try {
      expect(sources().open(idOf('sqlite'), true)).toMatchObject({ state: 'readOnly', writable: false });
      expect(existsSync(`${plain}.lock`)).toBe(false);
    } finally { fs.chmodSync(plain, 0o666); }
  });

  it('a data file is written through a presence entry: tick beats it, drop releases it (C3 R2, R3)', () => {
    const d = openBaseFile(data, 'write', '0.0.0').db;
    saveStartupOptions(d, { ...DEFAULT_STARTUP, dataFile: true });
    d.close();
    const l = sources();
    const entry = presenceEntry(data, 'a');
    expect(l.open(idOf('basecraft'), true)).toMatchObject({ state: 'ok', writable: true, shared: true });
    expect(l.heldLockPaths()).toEqual([entry]);
    expect(existsSync(`${data}.lock`)).toBe(false);
    now = 5_000;
    expect(l.tick()).toBe(false);
    expect(lockOf(entry).heartbeatAt).toBe(new Date(5_000).toISOString());
    expect(l.open(idOf('basecraft'), false).shared).toBe(true); // cached
    l.drop(idOf('basecraft'));
    expect(existsSync(`${entry}.lock`)).toBe(false);
    expect(l.open(idOf('basecraft'), false)).toMatchObject({ state: 'readOnly', writable: false }); // read-only: no entry, not shared
    expect(l.heldLockPaths()).toEqual([]);
  });

  it('a presence entry that fails one heartbeat (a transient share error) is written again: the link stays writable', () => {
    const d = openBaseFile(data, 'write', '0.0.0').db;
    saveStartupOptions(d, { ...DEFAULT_STARTUP, dataFile: true });
    d.close();
    let fail = false;
    const l = new LinkedSources(() => front, { ...deps(), lockDeps: { now: () => now, writeInPlace: (p, s) => { if (fail) throw new Error('EIO'); writeFileSync(p, s, { flag: 'r+' }); } } });
    open.push(l);
    const entry = presenceEntry(data, 'a');
    const c = l.open(idOf('basecraft'), true);
    fail = true;
    now = 10_000;
    expect(l.tick()).toBe(false);
    fail = false;
    expect(l.open(idOf('basecraft'), true)).toBe(c); // the same connection, still writable
    expect(c).toMatchObject({ state: 'ok', writable: true, shared: true });
    expect(lockOf(entry).heartbeatAt).toBe(new Date(10_000).toISOString());
    now = 20_000;
    expect(l.tick()).toBe(false);
    expect(lockOf(entry).heartbeatAt).toBe(new Date(20_000).toISOString()); // the new entry is beaten
    expect(l.heldLockPaths()).toEqual([entry]);
  });

  it('a re-joined entry checks the exclusive lock: held by another session, the link goes read-only, no entry', () => {
    const d = openBaseFile(data, 'write', '0.0.0').db;
    saveStartupOptions(d, { ...DEFAULT_STARTUP, dataFile: true });
    d.close();
    const l = sources();
    const entry = presenceEntry(data, 'a');
    l.open(idOf('basecraft'), true);
    fs.rmSync(`${entry}.lock`); // removed as stale by the designer, who then went exclusive
    writeFileSync(`${data}.lock`, JSON.stringify({ user: 'u', host: 'PC-2', pid: 1, sessionId: 'z', heartbeatAt: new Date(0).toISOString() }));
    expect(l.tick()).toBe(true);
    expect(l.open(idOf('basecraft'), true)).toMatchObject({ state: 'readOnly', writable: false, holder: expect.objectContaining({ sessionId: 'z' }) });
    expect(existsSync(`${entry}.lock`)).toBe(false);
    expect(l.heldLockPaths()).toEqual([]);
  });

  it('a data file whose flag cannot be read is not opened: no lock, no entry, not cached (fail closed)', () => {
    const l = sources();
    for (const fail of [new Error('bc:busy'), new BaseFileError('cannotOpen')]) {
      peek.fail = fail;
      peek.calls = 0;
      expect(l.open(idOf('basecraft'), true)).toMatchObject({ state: 'cannotOpen', db: null, writable: false });
      expect(l.open(idOf('basecraft'), true).state).toBe('cannotOpen');
      expect(peek.calls).toBe(2); // not cached: the next use peeks again
      expect(existsSync(`${data}.lock`)).toBe(false);
      expect(existsSync(`${data}.users`)).toBe(false);
      expect(l.heldLockPaths()).toEqual([]);
    }
    peek.fail = null;
    expect(l.open(idOf('basecraft'), true)).toMatchObject({ state: 'ok', writable: true }); // not a data file: C1's lock
    expect(existsSync(`${data}.lock`)).toBe(true);
  });

  it('a lock our own session id left on a data file is released, then the source opens shared', () => {
    const d = openBaseFile(data, 'write', '0.0.0').db;
    saveStartupOptions(d, { ...DEFAULT_STARTUP, dataFile: true });
    d.close();
    writeFileSync(`${data}.lock`, JSON.stringify({ user: 'u', host: 'PC-1', pid: 1, sessionId: 'a', heartbeatAt: new Date(0).toISOString() }));
    const l = sources();
    expect(l.open(idOf('basecraft'), true)).toMatchObject({ state: 'ok', writable: true, shared: true });
    expect(existsSync(`${data}.lock`)).toBe(false);
    expect(l.heldLockPaths()).toEqual([presenceEntry(data, 'a')]);
  });

  it('a rebuilt Access copy leaves the old one readable until the next tick (m1)', () => {
    const accdb = join(dir, 'Ventes.accdb');
    const fixture = (name: string) => join(__dirname, '../../../tests/fixtures/access', name);
    fs.copyFileSync(fixture('Ventes.accdb'), accdb);
    addLinks(front, fe, 'access', accdb, ['Commandes']);
    const l = sources();
    const count = (db: DatabaseSync | null) => (db!.prepare('SELECT count(*) AS n FROM "Commandes"').get() as { n: number }).n;
    const held = l.open(idOf('access'), false).db; // a caller of this request, e.g. pageQuerySource before expandCrosstab
    fs.copyFileSync(fixture('Ventes-modifie.accdb'), accdb);
    fs.utimesSync(accdb, new Date(), new Date(Date.now() + 2000));
    const next = l.open(idOf('access'), false).db;
    expect(next).not.toBe(held);
    expect([count(held), count(next)]).toEqual([5, 6]);
    l.tick();
    expect(() => count(held)).toThrow();
    expect(count(next)).toBe(6);
  });
});
