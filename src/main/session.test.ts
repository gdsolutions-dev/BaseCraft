import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs, { existsSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { BaseFileError, createBaseFile, openBaseFile } from './db/file-format';
import type { LockInfo } from './db/lock';
import type { RiskProbe } from './db/location-risk';
import { ReadOnlyError, Session, type SessionDeps } from './session';
import { clients } from '../shared/test-fixtures';
import { defaultSpec } from '../shared/import-text';
import { localeInfo } from '../shared/locale-format';
import type { ImportTexts } from './import/text-import';

let dir: string;
let p: string;
let t = 0;
const opened: Session[] = [];
const probe: RiskProbe = { platform: 'win32', env: {}, homedir: 'C:\\Users\\x', windowsDriveType: () => 3 };
const deps: SessionDeps = { appVersion: '0.0.0', region: 'fr-FR', probe, lockDeps: { now: () => t }, sessionId: 'a' };
const track = (s: Session) => (opened.push(s), s);
const create = (d: Partial<SessionDeps> = {}) => track(Session.create(p, { ...deps, ...d }));
const open = (d: Partial<SessionDeps> = {}) => track(Session.open(p, { ...deps, ...d }));
const overwriteLock = (basePath: string, info: Partial<LockInfo>) => writeFileSync(`${basePath}.lock`, JSON.stringify(info), 'utf8');
const lockOwner = () => JSON.parse(readFileSync(`${p}.lock`, 'utf8')).sessionId;
const rawDb = (s: Session) => (s as unknown as { db: DatabaseSync }).db;
const throwEROFS = () => { throw Object.assign(new Error('ro'), { code: 'EROFS' }); };

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bcsession-'));
  p = path.join(dir, 'test.basecraft');
  t = 0;
});
afterEach(() => {
  for (const s of opened.splice(0)) s.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('session (brief)', () => {
  it('opens writable and holds the lock', () => {
    const s = create();
    expect(s.state).toMatchObject({ readOnly: false, locationRisk: 'local', path: p, fileName: 'test.basecraft' });
    expect(existsSync(`${p}.lock`)).toBe(true);
    s.close();
    expect(existsSync(`${p}.lock`)).toBe(false);
  });

  it('second session is read-only and refuses writes', async () => {
    create();
    const b = open({ sessionId: 'b' });
    expect(b.state).toMatchObject({ readOnly: true, readOnlyReason: 'heldByOther', lockStale: false, lockHolder: expect.objectContaining({ pid: process.pid }) });
    await expect(b.insert('Clients', { Nom: 'x' })).rejects.toThrow(ReadOnlyError);
    await expect(b.saveTable({ originalName: null, design: clients, mapping: [], allowDataLoss: false })).rejects.toThrow(ReadOnlyError);
    const spec = { ...defaultSpec(localeInfo('fr-FR')), fields: [] };
    expect(() => b.importRun(p, { spec, target: { kind: 'new', table: 'T', primaryKey: { kind: 'auto' } } }, {} as ImportTexts)).toThrow(ReadOnlyError);
    expect(() => b.saveImportSpec('S', spec)).toThrow(ReadOnlyError);
    expect(b.takeOverLock()).toMatchObject({ readOnly: true, lockStale: false }); // a live lock is never taken
    expect(lockOwner()).toBe('a');
    b.close();
    expect(lockOwner()).toBe('a'); // closing a read-only session leaves the holder's lock alone
  });

  it('stale lock can be taken over', async () => {
    const a = create();
    t = 31_000;
    const b = open({ sessionId: 'b' });
    expect(b.state).toMatchObject({ readOnly: true, lockStale: true });
    expect(b.takeOverLock().readOnly).toBe(false);
    expect(lockOwner()).toBe('b');
    expect(await b.saveTable({ originalName: null, design: clients, mapping: [], allowDataLoss: false })).toEqual({ ok: true });
    expect(await b.insert('Clients', { Nom: 'Dupont' })).toMatchObject({ ok: true });
    a.tick();
    expect(a.state).toMatchObject({ readOnly: true, readOnlyReason: 'lockLost' });
  });

  it('lost lock switches to read-only, refuses writes and reopens the file read-only', async () => {
    const changes: unknown[] = [];
    const a = create({ onStateChanged: (s) => changes.push(s) });
    overwriteLock(p, { sessionId: 'zz' });
    a.tick();
    expect(a.state).toMatchObject({ readOnly: true, readOnlyReason: 'lockLost' });
    expect(changes).toEqual([a.state]);
    await expect(a.insert('Clients', { Nom: 'x' })).rejects.toThrow(ReadOnlyError);
    expect(() => rawDb(a).exec('CREATE TABLE x (y)')).toThrow(/readonly/i);
    a.close();
    expect(lockOwner()).toBe('zz'); // the thief's lock survives our close
  });

  it('unwritable folder opens read-only', () => {
    create().close();
    expect(open({ lockDeps: { writeExclusive: throwEROFS } }).state.readOnlyReason).toBe('fileReadOnly');
  });

  it('write-protected file opens read-only without leaving a lock', () => {
    create().close();
    fs.chmodSync(p, 0o444);
    try {
      expect(open().state).toMatchObject({ readOnly: true, readOnlyReason: 'fileReadOnly' });
      expect(existsSync(`${p}.lock`)).toBe(false);
    } finally {
      for (const s of opened.splice(0)) s.close();
      fs.chmodSync(p, 0o666);
    }
  });

  it('reports network risk',() => expect(create({ probe: { ...probe, windowsDriveType: () => 4 } }).state.locationRisk).toBe('network'));

  it('saveTable creates then alters with mapping', async () => {
    const s = create();
    expect(await s.saveTable({ originalName: null, design: clients, mapping: [], allowDataLoss: false })).toEqual({ ok: true });
    await s.insert('Clients', { Nom: 'Dupont' });
    const renamed = { ...clients, fields: clients.fields.map((x) => (x.name === 'Nom' ? { ...x, name: 'Nom complet' } : x)) };
    const mapping = clients.fields.map((x) => ({ name: x.name === 'Nom' ? 'Nom complet' : x.name, sourceName: x.name }));
    expect(await s.saveTable({ originalName: 'Clients', design: renamed, mapping, allowDataLoss: false })).toEqual({ ok: true });
    expect(s.page('Clients', { offset: 0, limit: 10 }).rows[0].values[1]).toBe('Dupont');
  });
});

describe('session (lock lifecycle and data access)', () => {
  it('a write first beats the heart: a stolen lock refuses the write', async () => {
    const a = create();
    a.saveTable({ originalName: null, design: clients, mapping: [], allowDataLoss: false });
    overwriteLock(p, { sessionId: 'zz' });
    await expect(a.insert('Clients', { Nom: 'x' })).rejects.toThrow(ReadOnlyError);
    expect(a.state.readOnlyReason).toBe('lockLost');
    expect(a.count('Clients')).toBe(0);
  });

  it('take-over refused on an unreadable lock is reported, not offered again', () => {
    create();
    t = Date.now(); // a real clock: the placeholder's epoch heartbeat then looks stale to the lock module
    const readText = () => { throw Object.assign(new Error('busy'), { code: 'EBUSY' }); };
    const b = open({ sessionId: 'b', lockDeps: { now: () => t, readText } });
    expect(b.state).toMatchObject({ readOnly: true, readOnlyReason: 'heldByOther', lockStale: true, lockHolder: { user: '?' } });
    expect(b.takeOverLock()).toMatchObject({ readOnly: true, lockStale: false, lockHolder: { user: '?' } });
    expect(b.takeOverLock()).toMatchObject({ readOnly: true, lockStale: false });
    b.tick(); // the periodic re-check must not re-offer it either
    expect(b.state).toMatchObject({ readOnly: true, lockStale: false });
    expect(lockOwner()).toBe('a');
  });

  it('refuses rowid-less tables and rowid-named columns for data access', async () => {
    createBaseFile(p, '0.0.0');
    const { db } = openBaseFile(p, 'write', '0.0.0');
    db.exec('CREATE TABLE W (k TEXT PRIMARY KEY, v TEXT) WITHOUT ROWID; CREATE TABLE R ("OID" INTEGER, x TEXT)');
    db.close();
    const s = open();
    for (const table of ['W', 'R']) {
      expect(() => s.count(table)).toThrow('bc:unsupportedTable');
      expect(() => s.page(table, { offset: 0, limit: 10 })).toThrow('bc:unsupportedTable');
      await expect(s.insert(table, { x: '1' })).rejects.toThrow('bc:unsupportedTable');
      expect(() => s.delete(table, [1])).toThrow('bc:unsupportedTable');
    }
    expect(s.listTables().map((x) => x.name)).toEqual(['R', 'W']);
  });

  it('table operations report name problems as results', async () => {
    const s = create();
    await s.saveTable({ originalName: null, design: clients, mapping: [], allowDataLoss: false });
    await s.saveTable({ originalName: null, design: { ...clients, name: 'Fournisseurs' }, mapping: [], allowDataLoss: false });
    expect(await s.saveTable({ originalName: null, design: { ...clients, name: 'clients' }, mapping: [], allowDataLoss: false })).toEqual({ ok: false, reason: 'nameExists' });
    expect(await s.saveTable({ originalName: null, design: { ...clients, fields: [] }, mapping: [], allowDataLoss: false }))
      .toEqual({ ok: false, reason: 'design', errors: [{ code: 'noFields' }] });
    expect(s.renameTable('Clients', 'fournisseurs')).toEqual({ ok: false, reason: 'nameExists' });
    expect(s.renameTable('Clients', 'a.b')).toEqual({ ok: false, reason: 'nameInvalid' });
    expect(s.renameTable('Clients', 'Contacts')).toEqual({ ok: true });
    expect(s.dropTable('Fournisseurs')).toEqual({ ok: true });
    expect(s.listTables()).toEqual([{ name: 'Contacts' }]);
  });

  it('relations: saved, listed, guarded drop, delete results, layout; read-only refuses every write', async () => {
    const s = create();
    await s.saveTable({ originalName: null, design: clients, mapping: [], allowDataLoss: false });
    const cmd = { name: 'Cmd', fields: [{ name: 'Client', props: { ...clients.fields[2]!.props, type: 'number' as const, numberSize: 'longInteger' as const } }] };
    await s.saveTable({ originalName: null, design: cmd, mapping: [], allowDataLoss: false });
    expect((await s.insert('Clients', { Nom: 'A' })).ok).toBe(true);
    expect((await s.insert('Cmd', { Client: '1' })).ok).toBe(true);
    const rel = { name: '', parentTable: 'Clients', parentFields: ['N°'], childTable: 'Cmd', childFields: ['Client'], enforce: true, cascadeUpdate: false, cascadeDelete: false, joinType: 1 as const };
    expect(s.saveRelation(rel, null)).toMatchObject({ ok: true, relation: { name: 'ClientsCmd' } });
    expect(s.listRelations()).toHaveLength(1);
    expect(s.dropTable('Clients')).toEqual({ ok: false, reason: 'hasRelations' });
    expect(s.delete('Clients', [1])).toEqual({ ok: false, reason: 'related', table: 'Cmd' });
    s.saveRelationsLayout({ tables: { Clients: { x: 1, y: 2 } } });
    expect(s.relationsLayout()).toEqual({ tables: { Clients: { x: 1, y: 2 } } });
    const b = open({ sessionId: 'b' });
    expect(b.listRelations()).toHaveLength(1);
    expect(() => b.saveRelation(rel, null)).toThrow(ReadOnlyError);
    expect(() => b.deleteRelation('ClientsCmd')).toThrow(ReadOnlyError);
    expect(() => b.saveRelationsLayout({ tables: {} })).toThrow(ReadOnlyError);
    expect(s.deleteRelation('ClientsCmd')).toEqual({ ok: true });
    expect(s.delete('Cmd', [1])).toEqual({ ok: true, count: 1 });
  });

  it('A2-R14: refusals from the real keys and the schema are typed results; the cascade warning follows the real keys', async () => {
    const s = create();
    await s.saveTable({ originalName: null, design: clients, mapping: [], allowDataLoss: false });
    const raw = rawDb(s);
    raw.exec('CREATE TABLE "Kids" ("c" INTEGER REFERENCES "Clients" ("N°") ON DELETE CASCADE)');
    expect(s.cascadeChildren('clients')).toEqual(['Kids']);
    expect(s.dropTable('Clients')).toEqual({ ok: false, reason: 'referenced', table: 'Kids' });
    raw.exec('CREATE TABLE "Orph" ("g" INTEGER REFERENCES "Ghost" ("id"))');
    expect(await s.saveTable({ originalName: null, design: { ...clients, name: 'Ghost' }, mapping: [], allowDataLoss: false }))
      .toEqual({ ok: false, reason: 'danglingKey', table: 'Orph' });
    expect(s.renameTable('Clients', 'Ghost')).toEqual({ ok: false, reason: 'danglingKey', table: 'Orph' });
    raw.exec('CREATE TABLE "Tmp" ("a" TEXT); CREATE VIEW "VV" AS SELECT "a" FROM "Tmp"; DROP TABLE "Tmp"');
    expect(s.renameTable('Clients', 'Personnes')).toEqual({ ok: false, reason: 'viewBroken', view: 'VV' });
  });

  it('read-only open does not reconcile; write open reports external changes', () => {
    createBaseFile(p, '0.0.0');
    const { db } = openBaseFile(p, 'write', '0.0.0');
    db.exec('CREATE TABLE Ext (a TEXT)');
    db.close();
    expect(open({ lockDeps: { writeExclusive: throwEROFS } }).state.reconcileReport).toBeUndefined();
    expect(open().state.reconcileReport).toMatchObject({ addedTables: ['Ext'] });
  });

  it('a read-only session notices when the holder stops beating', () => {
    create();
    const changes: unknown[] = [];
    const b = open({ sessionId: 'b', onStateChanged: (x) => changes.push(x) });
    b.tick();
    expect(changes).toEqual([]); // nothing changed, nothing broadcast
    t = 31_000;
    b.tick();
    expect(b.state).toMatchObject({ readOnly: true, readOnlyReason: 'heldByOther', lockStale: true });
    expect(changes).toHaveLength(1);
    expect(b.takeOverLock().readOnly).toBe(false);
    expect(lockOwner()).toBe('b');
  });

  it('a session that lost its lock can take it back once the thief is gone', async () => {
    const a = create();
    overwriteLock(p, { user: 'u', host: 'h', pid: 1, sessionId: 'zz', heartbeatAt: new Date(t).toISOString() });
    a.tick();
    expect(a.state).toMatchObject({ readOnly: true, readOnlyReason: 'lockLost', lockStale: false, lockHolder: { sessionId: 'zz' } });
    expect(a.takeOverLock().readOnly).toBe(true); // live thief: refused
    fs.unlinkSync(`${p}.lock`);
    a.tick();
    expect(a.state.lockStale).toBe(true);
    expect(a.takeOverLock().readOnly).toBe(false);
    expect(lockOwner()).toBe('a');
    expect(await a.saveTable({ originalName: null, design: clients, mapping: [], allowDataLoss: false })).toEqual({ ok: true });
  });

  it('crashed base behind a stale lock needs recovery; take-over recovers it', () => {
    const src = path.join(dir, 'src.basecraft');
    createBaseFile(src, '0.0.0');
    const w = new DatabaseSync(src);
    w.exec('PRAGMA cache_size=5; CREATE TABLE big(x)');
    w.exec('BEGIN');
    for (let i = 0; i < 300; i++) w.prepare('INSERT INTO big VALUES (?)').run('y'.repeat(2000) + i);
    fs.copyFileSync(src, p);
    fs.copyFileSync(src + '-journal', p + '-journal');
    w.exec('ROLLBACK');
    w.close();
    overwriteLock(p, { user: 'u', host: 'h', pid: 1, sessionId: 'dead', heartbeatAt: new Date(0).toISOString() });
    t = 31_000;
    const s = open();
    expect(s.state).toMatchObject({ readOnly: true, readOnlyReason: 'heldByOther', lockStale: true, needsRecovery: true });
    expect(() => s.listTables()).toThrow('bc:needsRecovery');
    expect(() => s.count('big')).toThrow('bc:needsRecovery');
    expect(s.takeOverLock()).toMatchObject({ readOnly: false });
    expect(s.state.needsRecovery).toBeUndefined();
    expect(s.count('big')).toBe(0); // the uncommitted rows were rolled back
  });

  describe('failed read-only reopen after a lost lock', () => {
    let failReadOnly = false;
    let failHeartbeat = false;
    const openFile: typeof openBaseFile = (f, mode, v) => {
      if (failReadOnly && mode === 'readOnly') throw new BaseFileError('cannotOpen');
      return openBaseFile(f, mode, v);
    };
    // a transient write failure: the lock file is still ours
    const writeInPlace = (lp: string, data: string) => {
      if (failHeartbeat) throw Object.assign(new Error('busy'), { code: 'EBUSY' });
      fs.writeFileSync(lp, data, { flag: 'r+' });
    };
    const lose = () => {
      failReadOnly = false;
      failHeartbeat = false;
      const a = create({ openFile, lockDeps: { now: () => t, writeInPlace } });
      a.saveTable({ originalName: null, design: clients, mapping: [], allowDataLoss: false });
      failHeartbeat = true;
      failReadOnly = true;
      expect(() => a.tick()).not.toThrow();
      expect(a.state).toMatchObject({ readOnly: true, readOnlyReason: 'lockLost' });
      return a;
    };

    it('reads fail cleanly and a later tick retries the reopen', async () => {
      const a = lose();
      expect(() => a.count('Clients')).toThrow('bc:cannotOpen');
      await expect(a.insert('Clients', { Nom: 'x' })).rejects.toThrow(ReadOnlyError);
      expect(() => a.tick()).not.toThrow();
      failReadOnly = false;
      a.tick();
      expect(a.count('Clients')).toBe(0);
    });

    it('close does not throw and still releases our lock', () => {
      const a = lose();
      expect(() => a.close()).not.toThrow();
      expect(existsSync(`${p}.lock`)).toBe(false);
    });
  });
});
