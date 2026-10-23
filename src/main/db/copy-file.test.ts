import { vi, afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs, { existsSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { backupCopy, createBaseFile, openBaseFile } from './file-format';
import { compactBase, vacuumInto, type CopyDeps } from './copy-file';
import { createTable, reconcile } from './schema';
import { clients } from '../../shared/test-fixtures';
import type { RiskProbe } from './location-risk';
import { ReadOnlyError, Session, type SessionDeps } from '../session';

vi.setConfig({ testTimeout: 30_000, hookTimeout: 15_000 });

let dir: string;
let p: string;
const sessions: Session[] = [];
const handles: { close(): void }[] = [];
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bccopy-'));
  p = path.join(dir, 'test.basecraft');
});
afterEach(() => {
  for (const s of sessions.splice(0)) s.close();
  for (const h of handles.splice(0)) { try { h.close(); } catch { /* closed */ } }
  fs.rmSync(dir, { recursive: true, force: true });
});

/** What compactBase needs of a session, over a real write handle. */
function fakeSession() {
  let db = openBaseFile(p, 'write', '0.0.0').db;
  reconcile(db);
  const h = {
    db: () => db, path: p,
    close: () => db.close(),
    reopen: () => { db = openBaseFile(p, 'write', '0.0.0').db; reconcile(db); },
  };
  handles.push({ close: () => db.close() });
  return h;
}
function seeded() {
  createBaseFile(p, '0.0.0');
  const s = fakeSession();
  createTable(s.db(), clients);
  return s;
}
const leftovers = () => fs.readdirSync(dir).filter((f) => f.endsWith('.bc-tmp') || f.endsWith('.compact'));
const dump = (db: DatabaseSync) => ({
  meta: db.prepare("SELECT key, value FROM bc_meta WHERE key <> 'app_version' ORDER BY key").all(),
  tables: db.prepare('SELECT * FROM bc_tables ORDER BY name').all(),
  fields: db.prepare('SELECT * FROM bc_fields ORDER BY table_name, position').all(),
  objects: db.prepare('SELECT * FROM bc_objects ORDER BY 1, 2').all(),
  rows: db.prepare('SELECT * FROM Clients ORDER BY rowid').all(),
  userVersion: db.prepare('PRAGMA user_version').get(),
  appId: db.prepare('PRAGMA application_id').get(),
});
const sessionDeps: SessionDeps = {
  appVersion: '0.0.0', region: 'fr-FR', sessionId: 'a',
  probe: { platform: 'win32', env: {}, homedir: 'C:\\Users\\x', windowsDriveType: () => 3 } satisfies RiskProbe,
};

describe('backupCopy', () => {
  it('backupCopy naming unchanged', () => {
    createBaseFile(p, '0.0.0');
    const d = new Date(2026, 9, 23, 9, 5, 7);
    expect(backupCopy(p, d)).toMatch(/test\.backup-20261023-090507\.basecraft$/);
    expect(backupCopy(p, d)).toMatch(/test\.backup-20261023-090507-1\.basecraft$/); // never overwritten
  });
});

describe('vacuumInto', () => {
  it('writes a checked copy, replacing an existing target', () => {
    const s = seeded();
    const target = path.join(dir, 'copy.basecraft');
    fs.writeFileSync(target, 'old');
    vacuumInto(s.db(), target);
    const c = openBaseFile(target, 'readOnly', '0.0.0').db;
    handles.push(c);
    expect(dump(c)).toEqual(dump(s.db()));
    expect(leftovers()).toEqual([]);
  });

  it('save copy refuses a corrupt copy', () => {
    const s = seeded();
    const target = path.join(dir, 'copy.basecraft');
    expect(() => vacuumInto(s.db(), target, { check: () => ['*** in database main ***'] })).toThrow('bc:copyCorrupt');
    expect(existsSync(target)).toBe(false);
    expect(leftovers()).toEqual([]);
  });

  it('a target locked during the copy keeps its journal (checked before it is removed)', () => {
    const s = seeded();
    const target = path.join(dir, 'copy.basecraft');
    fs.writeFileSync(target, 'old');
    fs.writeFileSync(`${target}-journal`, 'hot');
    const beforeReplace = () => { throw new Error('bc:targetInUse'); };
    expect(() => vacuumInto(s.db(), target, { beforeReplace })).toThrow('bc:targetInUse');
    expect(readFileSync(`${target}-journal`, 'utf8')).toBe('hot');
    expect(readFileSync(target, 'utf8')).toBe('old');
  });

  it('a failed copy leaves no file and a typed error', () => {
    const s = seeded();
    const target = path.join(dir, 'copy.basecraft');
    fs.writeFileSync(target, 'old');
    const rename = () => { throw Object.assign(new Error('no space'), { code: 'ENOSPC' }); };
    expect(() => vacuumInto(s.db(), target, { rename })).toThrow(/bc:copyFailed/);
    expect(readFileSync(target, 'utf8')).toBe('old');
    expect(leftovers()).toEqual([]);
    expect(() => vacuumInto(s.db(), path.join(dir, 'missing', 'x.basecraft'))).toThrow(/bc:copyFailed/);
  });
});

describe('compactBase', () => {
  it('compact shrinks and keeps data', async () => {
    const s = seeded();
    const db = s.db();
    const ins = db.prepare('INSERT INTO Clients (Nom) VALUES (?)');
    db.exec('BEGIN');
    for (let i = 0; i < 20_000; i++) ins.run(`client ${i} ${'x'.repeat(30)}`);
    db.exec('COMMIT');
    db.exec('DELETE FROM Clients WHERE rowid > 10');
    const before = dump(s.db());
    const r = await compactBase(s);
    if (!r.ok) throw new Error('expected ok');
    expect(r.sizeAfter).toBeLessThan(r.sizeBefore);
    expect(r.sizeAfter).toBe(fs.statSync(p).size);
    expect(r.repaired).toEqual([]);
    expect(dump(s.db())).toEqual(before);
    expect(leftovers()).toEqual([]);
  });

  it('backup exists before the swap', async () => {
    const s = seeded();
    const original = readFileSync(p);
    let seen = false;
    const r = await compactBase(s, {
      rename: (from, to) => { if (to === p) seen = existsSync(backup()); fs.renameSync(from, to); },
    });
    function backup() { return fs.readdirSync(dir).map((f) => path.join(dir, f)).find((f) => f.includes('.backup-')) ?? ''; }
    if (!r.ok) throw new Error('expected ok');
    expect(seen).toBe(true);
    expect(existsSync(r.backupPath)).toBe(true);
    expect(readFileSync(r.backupPath)).toEqual(original);
  });

  it.each([1, 2])('failure leaves the original untouched (rename %i fails)', async (failing) => {
    const s = seeded();
    s.db().prepare('INSERT INTO Clients (Nom) VALUES (?)').run('Durand');
    const original = readFileSync(p);
    let n = 0;
    const rename = (from: string, to: string) => {
      if (++n === failing) throw Object.assign(new Error('no space'), { code: 'ENOSPC' });
      fs.renameSync(from, to);
    };
    await expect(compactBase(s, { rename })).rejects.toThrow(/bc:copyFailed/);
    expect(readFileSync(p)).toEqual(original);
    expect(leftovers()).toEqual([]);
    expect(s.db().prepare('SELECT Nom FROM Clients').all()).toEqual([{ Nom: 'Durand' }]); // the session works again
  });

  it('a corrupt base whose copy fails: corrupt, original untouched', async () => {
    const s = seeded();
    const original = readFileSync(p);
    const r = await compactBase(s, { check: () => ['row 2 missing from index'] });
    expect(r).toMatchObject({ ok: false, reason: 'corrupt', problems: ['row 2 missing from index'] });
    if (r.ok) return;
    expect(existsSync(r.backupPath)).toBe(true);
    expect(readFileSync(p)).toEqual(original);
    expect(leftovers()).toEqual([]);
  });

  it('a problem the copy fixes is reported as repaired', async () => {
    const s = seeded();
    let n = 0;
    const check: CopyDeps['check'] = () => (n++ === 0 ? ['row 2 missing from index'] : []);
    expect(await compactBase(s, { check })).toMatchObject({ ok: true, repaired: ['row 2 missing from index'] });
  });
});

describe('session', () => {
  it('lock is kept across compact', async () => {
    const s = Session.create(p, sessionDeps);
    sessions.push(s);
    const lock = () => { const { heartbeatAt: _, ...l } = JSON.parse(readFileSync(`${p}.lock`, 'utf8')); return l; }; // a write beats it
    const before = lock();
    expect(await s.compact()).toMatchObject({ ok: true });
    expect(lock()).toEqual(before);
    expect(before.sessionId).toBe('a');
    expect(s.state.readOnly).toBe(false);
    expect(s.listTables()).toEqual([]);
    expect(await s.saveTable({ originalName: null, design: clients, mapping: [], allowDataLoss: false })).toEqual({ ok: true });
  });

  it('compact needs the write lock; save copy does not', async () => {
    sessions.push(Session.create(p, sessionDeps));
    const ro = Session.open(p, { ...sessionDeps, sessionId: 'b' });
    sessions.push(ro);
    expect(ro.state.readOnly).toBe(true);
    await expect(ro.compact()).rejects.toBeInstanceOf(ReadOnlyError);
    const target = path.join(dir, 'copy.basecraft');
    await ro.saveCopy(target);
    handles.push(openBaseFile(target, 'readOnly', '0.0.0').db);
  });
});

describe('fix round 1', () => {
  const target = () => path.join(dir, 'copy.basecraft');

  it('Save As refuses a target held by another live session', async () => {
    const s = Session.create(p, sessionDeps);
    sessions.push(s);
    createBaseFile(target(), '0.0.0');
    const before = readFileSync(target());
    const other = Session.open(target(), { ...sessionDeps, sessionId: 'other' }); // holds copy.basecraft.lock
    sessions.push(other);
    await expect(s.saveCopy(target())).rejects.toThrow('bc:targetInUse');
    expect(readFileSync(target())).toEqual(before);
    expect(leftovers()).toEqual([]);
    other.close();
    await s.saveCopy(target()); // released: allowed
  });

  const writeLock = (base: string, heartbeatAt: string) =>
    fs.writeFileSync(`${base}.lock`, JSON.stringify({ user: 'u', host: 'h', pid: 1, sessionId: 'other', heartbeatAt }));

  it('Save As: a live lock appearing during the copy refuses the rename (target untouched, temp removed)', async () => {
    const s = Session.create(p, sessionDeps);
    sessions.push(s);
    createBaseFile(target(), '0.0.0');
    const before = readFileSync(target());
    // check() runs between VACUUM INTO and the rename: another instance opens the target meanwhile
    const check = () => { writeLock(target(), new Date().toISOString()); return []; };
    await expect(s.saveCopy(target(), { check })).rejects.toThrow('bc:targetInUse');
    expect(readFileSync(target())).toEqual(before);
    expect(leftovers()).toEqual([]);
  });

  it('Save As removes a stale lock left at the target: the copy opens for writing', async () => {
    const s = Session.create(p, sessionDeps);
    sessions.push(s);
    writeLock(target(), new Date(0).toISOString());
    await s.saveCopy(target());
    expect(existsSync(`${target()}.lock`)).toBe(false);
    const copy = Session.open(target(), { ...sessionDeps, sessionId: 'copy' });
    sessions.push(copy);
    expect(copy.state.readOnly).toBe(false);
  });

  it('a stale journal beside the target is never applied to the new copy', async () => {
    // a real hot journal of an older file at the target path (pages spilled to disk mid-transaction)
    const old = new DatabaseSync(target());
    old.exec('PRAGMA cache_size=1; CREATE TABLE junk(x); BEGIN;');
    const ins = old.prepare('INSERT INTO junk VALUES (?)');
    for (let i = 0; i < 2000; i++) ins.run('j'.repeat(200));
    old.exec('COMMIT; BEGIN; DELETE FROM junk;');
    const journal = readFileSync(`${target()}-journal`);
    old.exec('ROLLBACK');
    old.close();
    fs.writeFileSync(`${target()}-journal`, journal);

    const s = seeded();
    s.db().prepare('INSERT INTO Clients (Nom) VALUES (?)').run('Durand');
    const sess = { saveCopy: (t: string) => vacuumInto(s.db(), t) };
    sess.saveCopy(target());
    expect(existsSync(`${target()}-journal`)).toBe(false);
    const c = new DatabaseSync(target());
    handles.push(c);
    expect(c.prepare('PRAGMA integrity_check').all()).toEqual([{ integrity_check: 'ok' }]);
    expect(dump(c)).toEqual(dump(s.db()));
  });

  it('a failed reopen after a failed rename keeps the rename error', async () => {
    const s = seeded();
    let n = 0;
    const rename = (from: string, to: string) => {
      if (++n === 2) throw Object.assign(new Error('busy'), { code: 'EBUSY' });
      fs.renameSync(from, to);
    };
    const broken = { ...s, reopen: () => { throw new Error('cannot reopen'); } };
    await expect(compactBase(broken, { rename })).rejects.toThrow(/^bc:copyFailed\|EBUSY/);
  });

  it('a failed reopen after the swap: typed, and the session says the base is lost', async () => {
    let fail = false;
    const openFile: typeof openBaseFile = (...a) => { if (fail) throw new Error('disk gone'); return openBaseFile(...a); };
    const s = Session.create(p, { ...sessionDeps, openFile });
    sessions.push(s);
    fail = true;
    const e = await s.compact().then(() => null, (x: Error) => x);
    expect(e).toMatchObject({ name: 'BaseLostError', message: expect.stringMatching(/^bc:reopenFailed\|/) });
  });
});
