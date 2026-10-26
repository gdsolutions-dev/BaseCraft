import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs, { existsSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { BaseFileError, createBaseFile, openBaseFile } from './db/file-format';
import type { LockInfo } from './db/lock';
import type { RiskProbe } from './db/location-risk';
import { ReadOnlyError, Session, type SessionDeps } from './session';
import { reconcile } from './db/schema';
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

  it('startup options: read in a read-only session, saved only by the writer', () => {
    const a = create();
    const mine = { ...a.startup(), appTitle: 'Gestion des ventes', runMode: true };
    a.saveStartup(mine);
    const b = open({ sessionId: 'b' });
    expect(b.state.readOnly).toBe(true);
    expect(b.startup()).toEqual(mine);
    expect(() => b.saveStartup({ ...mine, runMode: false })).toThrow(ReadOnlyError);
    expect(a.startup()).toEqual(mine);
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

  // the base lives under the OS temp folder: a drive letter on Windows, a POSIX path elsewhere (checked against the mounts)
  const network: RiskProbe = process.platform === 'win32'
    ? { ...probe, windowsDriveType: () => 4 }
    : { platform: 'linux', env: {}, homedir: '/home/x', mounts: '//nas/p / cifs rw 0 0' };
  it('reports network risk',() => expect(create({ probe: network }).state.locationRisk).toBe('network'));

  it('saveTable creates then alters with mapping', async () => {
    const s = create();
    expect(await s.saveTable({ originalName: null, design: clients, mapping: [], allowDataLoss: false })).toEqual({ ok: true });
    await s.insert('Clients', { Nom: 'Dupont' });
    const renamed = { ...clients, fields: clients.fields.map((x) => (x.name === 'Nom' ? { ...x, name: 'Nom complet' } : x)) };
    const mapping = clients.fields.map((x) => ({ name: x.name === 'Nom' ? 'Nom complet' : x.name, sourceName: x.name }));
    expect(await s.saveTable({ originalName: 'Clients', design: renamed, mapping, allowDataLoss: false })).toEqual({ ok: true });
    expect(s.page('Clients', { offset: 0, limit: 10 }).rows[0].values[1]).toBe('Dupont');
  });

  it('testRules: the fields whose rule stored rows break, with their count (Test Validation Rules)', async () => {
    const s = create();
    await s.saveTable({ originalName: null, design: clients, mapping: [], allowDataLoss: false });
    for (const [Nom, Âge] of [['Dupont', 30], ['Martin', 17], ['Zola', 12]] as const) await s.insert('Clients', { Nom, Âge });
    expect(await s.testRules('Clients')).toEqual([]);
    const rule = (name: string, validationRule: string) => (x: (typeof clients.fields)[number]) =>
      (x.name === name ? { ...x, props: { ...x.props, validationRule } } : x);
    const ruled = { ...clients, fields: clients.fields.map(rule('Nom', 'Like "D*"')).map(rule('Âge', '>= 18')) };
    const mapping = clients.fields.map((x) => ({ name: x.name, sourceName: x.name }));
    expect(await s.saveTable({ originalName: 'Clients', design: ruled, mapping, allowDataLoss: false, acceptExistingViolations: true })).toEqual({ ok: true });
    expect(await s.testRules('clients')).toEqual([{ field: 'Nom', rows: 2 }, { field: 'Âge', rows: 2 }]);
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
    expect(s.cascadeChildren('clients')).toEqual([{ table: 'Kids', effect: 'deleted' }]);
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

describe('session (objects and record sources)', () => {
  const def = { formatVersion: '1.0' };

  it('objects: CRUD in write mode, refused in read-only mode', () => {
    const a = create();
    expect(a.saveObject('form', 'F', def, null)).toEqual({ ok: true });
    expect(a.copyObject('form', 'F', 'G')).toEqual({ ok: true });
    expect(a.renameObject('form', 'G', 'H')).toEqual({ ok: true });
    expect(a.listObjects().map((o) => o.name)).toEqual(['F', 'H']);
    expect(a.getObject('form', 'f')).toEqual({ name: 'F', definition: def });
    expect(() => a.getObject('report', 'F')).toThrow('bc:notFound');
    const b = open({ sessionId: 'b' });
    expect(b.listObjects('form')).toHaveLength(2); // reads are allowed
    expect(() => b.saveObject('form', 'X', def, null)).toThrow(ReadOnlyError);
    expect(() => b.renameObject('form', 'F', 'X')).toThrow(ReadOnlyError);
    expect(() => b.deleteObject('form', 'F')).toThrow(ReadOnlyError);
    expect(() => b.copyObject('form', 'F', 'X')).toThrow(ReadOnlyError);
    expect(a.deleteObject('form', 'H')).toEqual({ ok: true });
  });

  it('Properties dialog: a description set on a table (bc_tables, other keys kept) or an object (modified date moves); read-only refused', async () => {
    const a = create();
    await a.saveTable({ originalName: null, design: { ...clients, extra: { futur: 1 } }, mapping: [], allowDataLoss: false });
    expect(a.setDescription('table', 'clients', 'Nos clients')).toEqual({ ok: true });
    expect(a.listTables()).toEqual([{ name: 'Clients', description: 'Nos clients' }]);
    expect(a.tableDesign('Clients')).toMatchObject({ description: 'Nos clients', extra: { futur: 1 } });
    expect(a.setDescription('table', 'Clients', '')).toEqual({ ok: true }); // empty: removed
    expect(a.listTables()).toEqual([{ name: 'Clients' }]);
    expect(a.setDescription('table', 'Absente', 'x')).toEqual({ ok: false, reason: 'notFound' });
    expect(a.saveObject('form', 'F', { formatVersion: '1.0' }, null)).toEqual({ ok: true });
    const before = a.listObjects('form')[0]!;
    await new Promise((r) => setTimeout(r, 5));
    expect(a.setDescription('form', 'f', 'Saisie')).toEqual({ ok: true });
    const after = a.listObjects('form')[0]!;
    expect(after).toMatchObject({ name: 'F', description: 'Saisie', created: before.created });
    expect(after.modified > before.modified).toBe(true);
    expect(a.setDescription('report', 'F', 'x')).toEqual({ ok: false, reason: 'notFound' });
    const b = open({ sessionId: 'b' });
    expect(() => b.setDescription('form', 'F', 'y')).toThrow(ReadOnlyError);
    expect(() => b.setDescription('table', 'Clients', 'y')).toThrow(ReadOnlyError);
  });

  it('a table source: describe, sorted pages with rowids and total; query and sql served by A3', async () => {
    const s = create();
    await s.saveTable({ originalName: null, design: clients, mapping: [], allowDataLoss: false });
    for (const [Nom, Âge] of [['b', 30], ['a', 30], ['c', 20]] as const) await s.insert('Clients', { Nom, Âge });
    const info = s.describeSource({ kind: 'table', name: 'clients' });
    expect(info).toMatchObject({ updatable: true, keyTable: 'Clients', parameters: [] });
    expect(info.fields.map((x) => x.name)).toEqual(clients.fields.map((x) => x.name));
    expect(info.fields[1]).toMatchObject({ name: 'Nom', type: 'shortText', props: { size: 50 }, origin: { table: 'Clients', field: 'Nom' } });
    const nom = info.fields.findIndex((x) => x.name === 'Nom');
    const page = s.pageSource({ kind: 'table', name: 'Clients' }, { offset: 0, limit: 2, sort: [{ field: 'âge', dir: 'desc' }, { field: 'Nom', dir: 'asc' }] });
    expect(page.total).toBe(3);
    expect(page.rows.map((r) => r[nom])).toEqual(['a', 'b']);
    expect(page.rowids).toEqual([2, 1]);
    expect(() => s.describeSource({ kind: 'query', name: 'Q' })).toThrow(/^bc:notFound$/);
    expect(() => s.describeSource({ kind: 'table', name: 'Absente' })).toThrow(/^bc:notFound$/);
    expect(() => s.pageSource({ kind: 'table', name: 'Absente' }, { offset: 0, limit: 1 })).toThrow(/^bc:notFound$/);
    // contract 1.2: a missing field is bc:notFound in sources; rows.page keeps bc:invalidArgument
    expect(() => s.pageSource({ kind: 'table', name: 'Clients' }, { offset: 0, limit: 1, sort: [{ field: 'Inconnu', dir: 'asc' }] })).toThrow(/^bc:notFound$/);
    expect(() => s.pageSource({ kind: 'table', name: 'Clients' }, { offset: 0, limit: 0, sort: [{ field: 'Nom', dir: 'asc' }, { field: 'Inconnu', dir: 'asc' }] })).toThrow(/^bc:notFound$/);
    expect(() => s.page('Clients', { offset: 0, limit: 1, sort: { field: 'Inconnu', dir: 'asc' } })).toThrow(/^bc:invalidArgument$/);
    expect(s.pageSource({ kind: 'table', name: 'Clients' }, { offset: 0, limit: 0 })).toEqual({ rows: [], rowids: [], total: 3 });
    expect(s.pageSource({ kind: 'sql', sql: 'SELECT Nom FROM Clients ORDER BY Nom' }, { offset: 0, limit: 1 })).toEqual({ rows: [['a']], rowids: [2], total: 3 });
  });

  it('sorted table pages follow every write (the sorted-order snapshot is per write sequence)', async () => {
    const s = create();
    await s.saveTable({ originalName: null, design: clients, mapping: [], allowDataLoss: false });
    for (const Nom of ['d', 'b', 'f']) await s.insert('Clients', { Nom });
    const ref = { kind: 'table', name: 'Clients' } as const;
    const nom = clients.fields.findIndex((x) => x.name === 'Nom');
    const names = () => s.pageSource(ref, { offset: 0, limit: 10, sort: [{ field: 'Nom', dir: 'asc' }] }).rows.map((r) => r[nom]);
    const pageNames = () => s.page('Clients', { offset: 0, limit: 10, sort: { field: 'Nom', dir: 'desc' } }).rows.map((r) => r.values[nom]);
    expect(names()).toEqual(['b', 'd', 'f']);
    expect(pageNames()).toEqual(['f', 'd', 'b']);
    await s.insert('Clients', { Nom: 'c' });
    expect(names()).toEqual(['b', 'c', 'd', 'f']);
    expect(pageNames()).toEqual(['f', 'd', 'c', 'b']);
    s.delete('Clients', [1]);
    expect(names()).toEqual(['b', 'c', 'f']);
    expect(pageNames()).toEqual(['f', 'c', 'b']);
    expect(s.pageSource(ref, { offset: 1, limit: 1, sort: [{ field: 'Nom', dir: 'asc' }] })).toMatchObject({ rowids: [4], total: 3 });
  });

  it('a table source filtered as rows.page filters: total counts the kept rows; bad criteria bc:invalidArgument, unknown field bc:notFound', async () => {
    const s = create();
    await s.saveTable({ originalName: null, design: clients, mapping: [], allowDataLoss: false });
    for (const [Nom, Âge] of [['b', 30], ['a', 40], ['c', 20], ['d', 50]] as const) await s.insert('Clients', { Nom, Âge });
    const ref = { kind: 'table', name: 'Clients' } as const;
    const nom = s.describeSource(ref).fields.findIndex((x) => x.name === 'Nom');
    const filter = [{ field: 'Âge', criteria: '>= 30' }];
    const page = s.pageSource(ref, { offset: 1, limit: 10, sort: [{ field: 'Nom', dir: 'desc' }], filter });
    expect(page.total).toBe(3);
    expect(page.rows.map((r) => r[nom])).toEqual(['b', 'a']);
    expect(page.rowids).toEqual([1, 2]);
    expect(s.pageSource(ref, { offset: 0, limit: 0, filter })).toEqual({ rows: [], rowids: [], total: 3 });
    expect(s.pageSource(ref, { offset: 0, limit: 0, filter: [...filter, { field: 'nom', criteria: '"a"' }] }).total).toBe(1);
    expect(s.count('Clients', filter)).toBe(3); // same compiler as rows.count
    expect(() => s.pageSource(ref, { offset: 0, limit: 1, filter: [{ field: 'Âge', criteria: '> 1 +' }] })).toThrow(/^bc:invalidArgument$/);
    expect(() => s.pageSource(ref, { offset: 0, limit: 0, filter: [{ field: 'Nom', criteria: '= [Inconnu]' }] })).toThrow(/^bc:invalidArgument$/);
    expect(() => s.pageSource(ref, { offset: 0, limit: 1, filter: [{ field: 'Inconnu', criteria: '1' }] })).toThrow(/^bc:notFound$/);
    expect(() => s.page('Clients', { offset: 0, limit: 1, filter: [{ field: 'Âge', criteria: '> 1 +' }] })).toThrow(/bc:invalidFilter/); // rows keep their code
  });
});

describe('session (copy a table)', () => {
  it('copies the structure and the data, AutoNumber values kept; a taken or invalid name is refused; read-only refused', async () => {
    const a = create();
    await a.saveTable({ originalName: null, design: clients, mapping: [], allowDataLoss: false });
    for (const Nom of ['Dupont', 'Martin']) await a.insert('Clients', { Nom, Email: `${Nom}@x.fr` });
    await a.delete('Clients', [1]);
    expect(a.copyTable('clients', 'Copie de Clients')).toEqual({ ok: true });
    expect(a.tableDesign('Copie de Clients').fields).toEqual(a.tableDesign('Clients').fields);
    expect(a.pageSource({ kind: 'table', name: 'Copie de Clients' }, { offset: 0, limit: 10 })).toMatchObject({ total: 1, rowids: [2] });
    expect((await a.insert('Copie de Clients', { Nom: 'Durand', Email: 'Martin@x.fr' })).ok).toBe(false); // unique index copied too
    a.saveObject('query', 'Q', { formatVersion: '1.0', sql: 'SELECT * FROM Clients' }, null);
    expect(a.copyTable('Clients', 'q')).toEqual({ ok: false, reason: 'nameExists' });
    expect(a.copyTable('Clients', 'COPIE DE CLIENTS')).toEqual({ ok: false, reason: 'nameExists' });
    expect(a.copyTable('Clients', 'a.b')).toEqual({ ok: false, reason: 'nameInvalid' });
    expect(a.copyTable('Absente', 'X')).toEqual({ ok: false, reason: 'notFound' });
    const b = open({ sessionId: 'b' });
    expect(() => b.copyTable('Clients', 'Autre')).toThrow(ReadOnlyError);
  });
});

describe('session (description of a table another tool created)', () => {
  it('no bc_tables row: Properties adds one with the description only; the design stays external and reconcile sees nothing new', () => {
    const a = create();
    rawDb(a).exec("CREATE TABLE Ext (n INTEGER, t TEXT); CREATE TABLE Témoin (n INTEGER, t TEXT); INSERT INTO Ext VALUES (1, 'x')");
    const before = a.tableDesign('Ext');
    expect(rawDb(a).prepare("SELECT count(*) AS n FROM bc_tables WHERE name = 'Ext'").get()).toEqual({ n: 0 });
    expect(a.setDescription('table', 'ext', 'Externe')).toEqual({ ok: true });
    expect(rawDb(a).prepare("SELECT name, props FROM bc_tables WHERE name = 'Ext'").get()).toEqual({ name: 'Ext', props: '{"description":"Externe"}' });
    expect(a.tableDesign('Ext')).toEqual({ ...before, description: 'Externe' }); // fields still inferred and external, no extra
    expect(a.listTables().find((x) => x.name === 'Ext')).toEqual({ name: 'Ext', description: 'Externe' });
    // the next reconcile (at the next opening) reports it as the new table it is, like its twin without a description
    expect(reconcile(rawDb(a))).toMatchObject({ addedTables: ['Ext', 'Témoin'], addedFields: [] });
    expect(a.tableDesign('Ext')).toEqual({ ...before, description: 'Externe' }); // the description kept, the fields as inferred
    expect(reconcile(rawDb(a))).toMatchObject({ addedTables: [], addedFields: [] }); // then nothing new
    expect(a.pageSource({ kind: 'table', name: 'Ext' }, { offset: 0, limit: 5 })).toMatchObject({ total: 1, rows: [[1, 'x']] });
    expect(a.setDescription('table', 'Ext', null)).toEqual({ ok: true });
    expect(a.tableDesign('Ext')).toEqual(before);
  });
});

describe('session (copy a table: typed results)', () => {
  it('a copy is a managed table: no external flags; data kept', () => {
    const a = create();
    rawDb(a).exec("CREATE TABLE Ext (n INTEGER, t TEXT); INSERT INTO Ext VALUES (1, 'x'), (2, 'y')");
    expect(a.tableDesign('Ext').fields.every((x) => x.props.external === true)).toBe(true);
    expect(a.copyTable('Ext', 'Ext2')).toEqual({ ok: true });
    expect(a.tableDesign('Ext2').fields.some((x) => x.props.external)).toBe(false);
    expect(a.pageSource({ kind: 'table', name: 'Ext2' }, { offset: 0, limit: 10 })).toMatchObject({ total: 2, rows: [[1, 'x'], [2, 'y']] });
  });

  it('a table BaseCraft cannot address by rowid, or data the copy refuses: bc:unsupportedTable, nothing created', () => {
    const a = create();
    rawDb(a).exec("CREATE TABLE W (k TEXT PRIMARY KEY) WITHOUT ROWID; CREATE TABLE Mix (n INTEGER); INSERT INTO Mix VALUES (1), ('abc')");
    expect(() => a.copyTable('W', 'W2')).toThrow(/^bc:unsupportedTable$/);
    expect(() => a.copyTable('Mix', 'Mix2')).toThrow(/^bc:unsupportedTable$/);
    expect(a.listTables().map((x) => x.name)).toEqual(['Mix', 'W']);
  });

  it('the new name is checked on its own first', () => {
    const a = create();
    rawDb(a).exec("CREATE TABLE Ext (n INTEGER)");
    expect(a.copyTable('Ext', 'bc_x')).toEqual({ ok: false, reason: 'nameInvalid' });
    expect(a.copyTable('Ext', ' x')).toEqual({ ok: false, reason: 'nameInvalid' });
  });
});

describe('session (C8: long names created by an external tool stay readable)', () => {
  it('a 100-character table is read through sources.page; BaseCraft never creates one over 64', async () => {
    const a = create();
    const long = 'T'.repeat(100);
    rawDb(a).exec(`CREATE TABLE "${long}" (n INTEGER); INSERT INTO "${long}" VALUES (7)`);
    expect(a.pageSource({ kind: 'table', name: long }, { offset: 0, limit: 10 })).toMatchObject({ total: 1, rows: [[7]] });
    expect(await a.saveTable({ originalName: null, design: { ...clients, name: 'C'.repeat(65) }, mapping: [], allowDataLoss: false }))
      .toMatchObject({ ok: false, reason: 'design', errors: [{ code: 'nameInvalid' }] });
  });
});

describe('session (copy a table: only constraint failures are unsupportedTable)', () => {
  it('any other SQLite error passes through unchanged', () => {
    const a = create();
    rawDb(a).exec('CREATE TABLE Src (n INTEGER); INSERT INTO Src VALUES (1)');
    const db = rawDb(a);
    const prepare = db.prepare.bind(db);
    db.prepare = ((sql: string) => {
      if (sql.startsWith('INSERT INTO "Dst"')) throw Object.assign(new Error('disk I/O error'), { code: 'ERR_SQLITE_ERROR', errcode: 10 });
      return prepare(sql);
    }) as typeof db.prepare;
    try {
      expect(() => a.copyTable('Src', 'Dst')).toThrow(/^disk I\/O error$/);
    } finally {
      db.prepare = prepare;
    }
    expect(a.listTables().map((x) => x.name)).toEqual(['Src']); // rolled back
  });
});

describe('session (active content)', () => {
  it('action queries refused while content is disabled', async () => {
    const s = create();
    expect(await s.saveTable({ originalName: null, design: clients, mapping: [], allowDataLoss: false })).toEqual({ ok: true });
    expect(s.saveObject('query', 'QMaj', { formatVersion: '1.0', sql: 'UPDATE Clients SET Nom = "Lyon";' }, null)).toEqual({ ok: true });
    await expect(s.actionCount({ kind: 'query', name: 'QMaj' }, {})).rejects.toThrow('bc:contentDisabled');
    await expect(s.runAction({ kind: 'query', name: 'QMaj' }, {}, { skipFailures: false, replaceTable: false })).rejects.toThrow('bc:contentDisabled');
    expect(s.activeContent().present).toBe(true);
    expect(s.dbUuid()).toMatch(/^[0-9a-f-]{36}$/);
    s.setContentEnabled(s.activeContent().fingerprint);
    await expect(s.actionCount({ kind: 'query', name: 'QMaj' }, {})).resolves.toMatchObject({ table: 'Clients' });
  });

  /** Another tool (another connection) adds an action query to the open base. */
  const addElsewhere = (name: string, sql: string) => {
    const other = new DatabaseSync(p);
    try {
      other.prepare("INSERT INTO bc_objects (kind, name, definition, created, modified) VALUES ('query', ?, ?, '', '')").run(name, JSON.stringify({ formatVersion: '1.0', sql }));
    } finally {
      other.close();
    }
  };

  it('content changed by another connection since it was enabled is refused', async () => {
    const s = create();
    expect(await s.saveTable({ originalName: null, design: clients, mapping: [], allowDataLoss: false })).toEqual({ ok: true });
    expect(s.saveObject('query', 'QMaj', { formatVersion: '1.0', sql: 'UPDATE Clients SET Nom = "Lyon";' }, null)).toEqual({ ok: true });
    s.setContentEnabled(s.activeContent().fingerprint);
    await expect(s.actionCount({ kind: 'query', name: 'QMaj' }, {})).resolves.toMatchObject({ table: 'Clients' });
    addElsewhere('QSup', 'DELETE FROM Clients;');
    await expect(s.actionCount({ kind: 'query', name: 'QMaj' }, {})).rejects.toThrow('bc:contentDisabled');
    await expect(s.runAction({ kind: 'query', name: 'QSup' }, {}, { skipFailures: false, replaceTable: false })).rejects.toThrow('bc:contentDisabled');
  });

  it('a base enabled with no content refuses an action query added by another connection', async () => {
    const s = create();
    expect(await s.saveTable({ originalName: null, design: clients, mapping: [], allowDataLoss: false })).toEqual({ ok: true });
    s.setContentEnabled(''); // opened with no active content
    await expect(s.actionCount({ kind: 'sql', sql: 'DELETE FROM Clients' }, {})).resolves.toMatchObject({ table: 'Clients' });
    addElsewhere('QSup', 'DELETE FROM Clients;');
    await expect(s.runAction({ kind: 'query', name: 'QSup' }, {}, { skipFailures: false, replaceTable: false })).rejects.toThrow('bc:contentDisabled');
    await expect(s.actionCount({ kind: 'sql', sql: 'DELETE FROM Clients' }, {})).rejects.toThrow('bc:contentDisabled');
  });
});
