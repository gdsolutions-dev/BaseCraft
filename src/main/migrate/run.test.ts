// The migration run (C7 R8, R9, R10, R16) on the fake connector: every phase of R9 leaves the front-end as it was.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs, { existsSync } from 'node:fs';
import os from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { ImportProgress } from '../../shared/import-text';
import type { MigrateResult, MigrationReport } from '../../shared/migrate';
import { f, t } from '../../shared/test-fixtures';
import type { Connection, RemoteTable, SchemaWriter } from '../connectors/connector';
import { testConnector } from '../connectors/test-connector';
import type { RiskProbe } from '../db/location-risk';
import { createBaseFile, openBaseFile } from '../db/file-format';
import { saveObject } from '../db/objects';
import { addServerLinks } from '../links/store';
import { createTable, removeTable } from '../db/schema';
import { saveStartupOptions, startupOptions } from '../db/startup';
import { seedSales, seedSalesRelation } from '../query/test-db';
import { Session, type SessionDeps } from '../session';
import { runMigration, switchLocal } from './run';

const P = { host: 'db.example', port: 5432, database: 'ventes', user: 'ana', tls: 'verify-full', timeout: 60 };
const KEY = 'postgresql://db.example:5432/ventes?tls=verify-full';
const LOGIN = { user: 'ana', password: 'secret' };
const probe: RiskProbe = { platform: 'win32', env: {}, homedir: 'C:\\Users\\x', windowsDriveType: () => 3 };
const deps: SessionDeps = { appVersion: '0.0.0', region: 'fr-FR', probe, lockDeps: { now: () => 0 }, sessionId: 'a' };
const REQ = { kind: 'postgresql' as const, params: P, schema: 'public' };

let dir: string;
let fe: string;
let fake: ReturnType<typeof testConnector>;
let server: RemoteTable[]; // the fake's own tables (tests add to it)
let s: Session;
const opened: Session[] = [];

/** The stage B sample: Clients, Commandes (Montant's rule >0) with their relation, an empty Journal, a query, an option. */
function seed(db: DatabaseSync): void {
  seedSales(db);
  seedSalesRelation(db);
  createTable(db, t('Journal', [f('N°', 'autoNumber'), f('Quand', 'dateTime'), f('Texte', 'shortText')]));
  saveObject(db, 'query', 'QClients', { formatVersion: '1.0', sql: 'SELECT * FROM Clients' }, null);
  saveStartupOptions(db, { ...startupOptions(db), appTitle: 'Ventes' });
}
/** A new front-end at `fe` seeded by `fn`, opened on the fake with the wizard's login as its key's credential. */
function setup(fn: (db: DatabaseSync) => void = seed): Session {
  fe = join(dir, `front${opened.length}.basecraft`);
  createBaseFile(fe, '0.0.0');
  const db = openBaseFile(fe, 'write', '0.0.0').db;
  fn(db);
  db.close();
  const x = Session.open(fe, { ...deps, connectors: { postgresql: fake } });
  opened.push(x);
  x.setCredential(KEY, LOGIN.user, LOGIN.password);
  return x;
}
/** Every row of every table of the front-end file (bc_ tables included: links, relations, options) and its schema. */
function snapshot(): unknown {
  const db = new DatabaseSync(fe, { readOnly: true });
  try {
    const master = db.prepare(`SELECT type, name, tbl_name, sql FROM sqlite_master ORDER BY type, name`).all() as { type: string; name: string }[];
    return { master, rows: Object.fromEntries(master.filter((m) => m.type === 'table').map((m) => [m.name, db.prepare(`SELECT * FROM "${m.name}"`).all()])) };
  } finally { db.close(); }
}
/** The fake server's object names in `public`, on a connection of its own. */
async function serverNames(): Promise<string[] | null> {
  const c = await fake.open(P as never, LOGIN);
  return c.schema!.names('public');
}
/** The next connection's `method` throws `e` for Commandes (addForeignKeys: always). */
function failOn(method: keyof SchemaWriter | 'table', e: unknown): () => void {
  const open = fake.open;
  fake.open = async (p, login) => {
    const c = await open(p, login);
    if (method === 'table') {
      const table = c.table;
      c.table = async (x) => { if (x.name === 'Commandes') throw e; return table(x); };
    } else {
      const w = c.schema! as unknown as Record<string, (...a: unknown[]) => Promise<unknown>>, fn = w[method]!;
      w[method] = async (...a) => { if (method === 'addForeignKeys' || (a[0] as { name: string }).name === 'Commandes') throw e; return fn(...a); };
    }
    return c;
  };
  return () => { fake.open = open; };
}
const txLog = () => fake.log.filter((x) => ['begin', 'commit', 'rollback'].includes(x));
const backups = () => fs.readdirSync(dir).filter((n) => n.includes('.backup-'));

beforeEach(() => {
  dir = fs.realpathSync.native(fs.mkdtempSync(join(os.tmpdir(), 'bcrun-')));
  server = [];
  fake = testConnector({ tables: server });
  s = setup();
});
afterEach(async () => {
  for (const x of opened.splice(0)) await x.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('migrateToServer', () => {
  it('success: server tables in one transaction, links with metadata, relations gone, front-end option, backup, report', async () => {
    const r = await s.migrateToServer(REQ);
    expect(r).toMatchObject({ ok: true, report: { kind: 'postgresql', server: 'db.example:5432/ventes', schema: 'public',
      tables: [{ name: 'Clients', rows: 4, nextId: 5 }, { name: 'Commandes', rows: 5, nextId: 6 }, { name: 'Journal', rows: 0, nextId: 1 }],
      relations: [{ name: 'ClientsCommandes', result: 'created' }], frontEndOnly: [{ table: 'Commandes', field: 'Montant', what: 'validationRule' }],
      indexes: [], approximated: [], queries: [] } });
    expect(txLog()).toEqual(['begin', 'commit']);
    expect(s.listTables().map((x) => [x.name, x.link?.kind])).toEqual([['Clients', 'postgresql'], ['Commandes', 'postgresql'], ['Journal', 'postgresql']]);
    expect(s.listRelations()).toEqual([]);
    expect(s.startup()).toMatchObject({ frontEnd: true, appTitle: 'Ventes' });
    expect(existsSync((r as { report: MigrationReport }).report.backupPath)).toBe(true);
    expect(s.tableDesign('Commandes').fields.find((x) => x.name === 'Montant')!.props).toMatchObject({ type: 'currency', validationRule: '>0' });
    // the rows read through the links; the next AutoNumber goes on after the local ones
    expect((await s.page('Commandes', { offset: 0, limit: 10 })).rows.map((x) => x.values[2])).toEqual([10.1, 0.1, 0.2, 99.99, 0.1]);
    expect(await s.insert('Clients', { Nom: 'Neuf' })).toMatchObject({ ok: true });
    expect((await s.page('Clients', { offset: 0, limit: 10 })).rows.map((x) => x.values[0])).toEqual([1, 2, 3, 4, 5]);
    // the plan's order: each table counted before its identity and indexes; the foreign keys, then every table read back
    const order = fake.log.filter((x) => ['createTable', 'insertRows', 'countRows', 'finishTable', 'addForeignKeys', 'table'].includes(x));
    expect(order).toEqual(['createTable', 'insertRows', 'countRows', 'finishTable', 'createTable', 'insertRows', 'countRows', 'finishTable',
      'createTable', 'countRows', 'finishTable', 'addForeignKeys', 'table', 'table', 'table']);
  });

  it('R13: a saved query or a SQL Record Source the server refuses is listed with its message, nothing sent', async () => {
    const x = setup((db) => {
      seed(db);
      saveObject(db, 'query', 'QNoms', { formatVersion: '1.0', sql: 'SELECT Format(Nom, ">") FROM Clients' }, null);
      saveObject(db, 'query', 'QMaj', { formatVersion: '1.0', sql: 'UPDATE Clients SET Nom = Format(Nom, ">")' }, null);
      saveObject(db, 'query', 'QDirect', { formatVersion: '2.0', sql: 'SELECT Format(1)', passThrough: { kind: 'postgresql', params: P, returnsRecords: true } }, null);
      saveObject(db, 'form', 'FNoms', { formatVersion: '1.0', recordSource: { kind: 'sql', sql: 'SELECT Format(Ville, ">") FROM Clients' }, props: {}, sections: [] }, null);
      saveObject(db, 'report', 'RNoms', { formatVersion: '1.0', recordSource: { kind: 'query', name: 'QNoms' }, props: {}, sections: [] }, null); // listed as QNoms
    });
    // the generators refuse a function they lack when they plan (bc:serverFunction|Format|postgresql)
    const open = fake.open;
    fake.open = async (p, login) => {
      const c = await open(p, login), plan = c.plan.bind(c);
      c.plan = (r) => {
        if (JSON.stringify(r.query.query.body).includes('"name":"Format"')) throw new Error('bc:serverFunction|Format|postgresql');
        return plan(r);
      };
      return c;
    };
    const r = await x.migrateToServer(REQ);
    expect(r).toMatchObject({ ok: true });
    expect((r as { report: MigrationReport }).report.queries).toEqual([
      { name: 'QMaj', error: 'bc:serverFunction|Format|postgresql' }, { name: 'QNoms', error: 'bc:serverFunction|Format|postgresql' },
      { name: 'FNoms', error: 'bc:serverFunction|Format|postgresql' }]);
    const after = fake.log.slice(fake.log.lastIndexOf('commit'));
    expect(after).toContain('plan');
    expect(after.filter((y) => !['commit', 'plan', 'close'].includes(y))).toEqual([]); // planned only: nothing read, nothing written
    fake.open = open;
  });

  it('R13: only the migrated source is checked; a corrupt object is listed unreadable; a crosstab with data headings is not listed', async () => {
    const x = setup((db) => {
      seed(db);
      addServerLinks(db, 'sqlserver', { host: 'other', port: 1433, database: 'x' }, [{ name: 'Ext', remote: 'Ext', schema: 'dbo', key: ['N'], skipped: [],
        design: t('Ext', [f('N', 'number')]) }]);
      saveObject(db, 'query', 'QExt', { formatVersion: '1.0', sql: 'SELECT * FROM Ext' }, null);
      saveObject(db, 'query', 'QBad', { formatVersion: '1.0', sql: 'SELECT 1' }, null);
      db.prepare(`UPDATE bc_objects SET definition = 'nope' WHERE name = 'QBad'`).run();
      saveObject(db, 'query', 'QCross', { formatVersion: '1.0', sql: 'TRANSFORM Sum(Montant) SELECT Client FROM Commandes GROUP BY Client PIVOT Month(Le)' }, null);
    });
    const open = fake.open;
    fake.open = async (p, login) => {
      const c = await open(p, login), plan = c.plan.bind(c);
      c.plan = (r) => {
        if (JSON.stringify(r.query.query.body).includes('"Clients"') || JSON.stringify(r.query.query.body).includes('"Ext"')) throw new Error('bc:serverFunction|Format|postgresql');
        return plan(r);
      };
      return c;
    };
    const r = await x.migrateToServer(REQ);
    fake.open = open;
    expect((r as { report: MigrationReport }).report.queries).toEqual([
      { name: 'QBad', error: 'bc:unreadable' }, { name: 'QClients', error: 'bc:serverFunction|Format|postgresql' }]);
  });

  it('refusals change nothing: readOnly, noTables, dataFile, noSchema, nameTaken, nameTooLong', async () => {
    const before = snapshot();
    const check = async (x: Session, r: MigrateResult, req = REQ) => {
      expect(await x.migrateToServer(req)).toEqual(r);
    };
    await check(s, { ok: false, reason: 'noSchema', schema: 'nope' }, { ...REQ, schema: 'nope' });
    server.push({ name: 'clients', remote: 'clients', schema: 'public', key: [], skipped: [], design: t('clients', [f('a', 'number')]) });
    await check(s, { ok: false, reason: 'nameTaken', names: ['Clients'] });
    server.length = 0;
    const ro = Session.open(fe, { ...deps, sessionId: 'b', connectors: { postgresql: fake } }); // held by s: read-only
    opened.push(ro);
    await check(ro, { ok: false, reason: 'readOnly' });
    expect(snapshot()).toEqual(before);
    expect(backups()).toEqual([]);
    expect(txLog()).toEqual([]);

    await check(setup(() => {}), { ok: false, reason: 'noTables' });
    await check(setup((db) => { seed(db); saveStartupOptions(db, { ...startupOptions(db), dataFile: true }); }), { ok: false, reason: 'dataFile' });
    const long = 'é'.repeat(32); // 32 characters, 64 UTF-8 bytes: over PostgreSQL's 63
    const x = setup((db) => { seed(db); createTable(db, t(long, [f('N°', 'autoNumber')])); });
    const one = snapshot();
    await check(x, { ok: false, reason: 'nameTooLong', names: [long] });
    expect(snapshot()).toEqual(one);
    expect(backups()).toEqual([]);
    expect(await serverNames()).toEqual([]);
  });

  it.each(['createTable', 'insertRows', 'countRows', 'finishTable', 'addForeignKeys', 'table'] as const)('a failure at %s rolls back; the front-end is unchanged', async (at) => {
    const before = snapshot();
    const restore = failOn(at, Object.assign(new Error('bc:serverError|XX000|boom'), at === 'insertRows' ? { field: 'Montant' } : {}));
    const r = await s.migrateToServer(REQ);
    expect(r).toEqual({ ok: false, reason: 'failed', error: 'bc:serverError|XX000|boom', ...(at !== 'addForeignKeys' && { table: 'Commandes' }),
      ...(at === 'insertRows' && { field: 'Montant' }), backupPath: expect.stringContaining('.backup-') });
    expect(txLog()).toEqual(['begin', 'rollback']);
    expect(snapshot()).toEqual(before);
    expect(existsSync((r as { backupPath: string }).backupPath)).toBe(true);
    expect(await serverNames()).toEqual([]);
    restore();
    expect(await s.migrateToServer(REQ)).toMatchObject({ ok: true }); // a new run works without cleanup
  });

  it('a backup that fails: failed, nothing written to the server', async () => {
    const before = snapshot();
    const spy = vi.spyOn(fs, 'copyFileSync').mockImplementation(() => { throw new Error('EACCES: permission denied'); });
    try {
      expect(await s.migrateToServer(REQ)).toEqual({ ok: false, reason: 'failed', error: 'bc:copyFailed|EACCES: permission denied' });
    } finally { spy.mockRestore(); }
    expect(fake.log).not.toContain('begin');
    expect(fake.log).not.toContain('createTable');
    expect(snapshot()).toEqual(before);
  });

  it('a row count that differs rolls back: bc:migrateCount|Commandes|5|4', async () => {
    const before = snapshot();
    const open = fake.open;
    fake.open = async (p, login) => {
      const c = await open(p, login), w = c.schema!, count = w.countRows;
      w.countRows = async (x) => (await count(x)) - (x.name === 'Commandes' ? 1 : 0);
      return c;
    };
    expect(await s.migrateToServer(REQ)).toMatchObject({ ok: false, reason: 'failed', error: 'bc:migrateCount|Commandes|5|4', table: 'Commandes' });
    expect(fake.log.filter((x) => x === 'finishTable')).toHaveLength(1); // Clients only: Commandes stopped at its count
    expect(txLog()).toEqual(['begin', 'rollback']);
    expect(snapshot()).toEqual(before);
    expect(await serverNames()).toEqual([]);
  });

  it('a server failure in the middle of the copy (Clients copied, Commandes written): the table named, nothing left', async () => {
    const before = snapshot();
    const tick = async (p: ImportProgress) => { if (p.label === 'Commandes') fake.failNext = new Error('bc:serverError|22021|invalid byte sequence'); };
    expect(await s.migrateToServer(REQ, tick)).toMatchObject({ ok: false, reason: 'failed', error: 'bc:serverError|22021|invalid byte sequence', table: 'Commandes' });
    expect(txLog()).toEqual(['begin', 'rollback']);
    expect(snapshot()).toEqual(before);
    expect(await serverNames()).toEqual([]);
  });

  it('a connection lost during the rows: rolled back by the server, cannotConnect, the front-end unchanged', async () => {
    const before = snapshot();
    const tick = async () => { fake.failNext = Object.assign(new Error('Connection terminated unexpectedly'), { lost: true }); };
    expect(await s.migrateToServer(REQ, tick)).toMatchObject({ ok: false, reason: 'failed', error: 'bc:linkUnavailable|cannotConnect|db.example:5432/ventes', table: 'Clients' });
    expect(snapshot()).toEqual(before);
    expect(await serverNames()).toEqual([]);
  });

  it('a refusal whose ROLLBACK fails: the refusal with its table and field, the connection closed (not cannotConnect)', async () => {
    const before = snapshot();
    // the drivers' rollback(): the connection closed, the refusal as the cause of a lost error
    const refusal = Object.assign(new Error('bc:serverError|23502|null value'), { table: 'Commandes', field: 'Montant' });
    const tick = async (p: ImportProgress) => { if (p.label === 'Commandes') fake.failNext = Object.assign(new Error(refusal.message, { cause: refusal }), { lost: true }); };
    expect(await s.migrateToServer(REQ, tick)).toMatchObject({ ok: false, reason: 'failed', error: 'bc:serverError|23502|null value',
      table: 'Commandes', field: 'Montant', closed: true });
    expect(snapshot()).toEqual(before);
  });

  it('a connection lost during the COMMIT: every table left, the front-end unchanged', async () => {
    const before = snapshot();
    const open = fake.open;
    fake.open = async (p, login) => {
      const c = await open(p, login), tx = c.transaction.bind(c);
      c.transaction = async (fn) => { await tx(fn); throw Object.assign(new Error('Connection terminated unexpectedly'), { lost: true }); };
      return c;
    };
    expect(await s.migrateToServer(REQ)).toEqual({ ok: false, reason: 'failed', error: 'bc:serverError|connection|Connection terminated unexpectedly',
      unknown: true, left: ['Clients', 'Commandes', 'Journal'], backupPath: expect.stringContaining('.backup-') });
    expect(snapshot()).toEqual(before);
    expect(await serverNames()).toEqual(expect.arrayContaining(['Clients', 'Commandes', 'Journal'])); // committed after all: check, then drop
    fake.open = open;
    expect(await s.migrateToServer(REQ)).toEqual({ ok: false, reason: 'nameTaken', names: ['Clients', 'Commandes', 'Journal'] });
  });

  it('Stop during the COMMIT: its outcome unknown (SQL Server cancels a COMMIT already done), every table left', async () => {
    const before = snapshot();
    const open = fake.open;
    fake.open = async (p, login) => {
      const c = await open(p, login), tx = c.transaction.bind(c);
      c.transaction = async (fn) => { await tx(fn); throw new Error('bc:cancelled'); };
      return c;
    };
    expect(await s.migrateToServer(REQ)).toEqual({ ok: false, reason: 'failed', error: 'bc:cancelled',
      unknown: true, left: ['Clients', 'Commandes', 'Journal'], backupPath: expect.stringContaining('.backup-') });
    expect(snapshot()).toEqual(before);
    fake.open = open;
  });

  it.each([['no table', null, 'key'], ['unsupported', 'invalidName', 'invalidName'], ['another key', ['Client'], 'key']] as const)(
    'a table read back as unlinkable (%s): bc:migrateUnlinkable, rolled back', async (_, what, code) => {
      const before = snapshot();
      const open = fake.open;
      fake.open = async (p, login) => {
        const c = await open(p, login), table = c.table;
        c.table = async (x) => {
          const rt = await table(x);
          if (x.name !== 'Commandes' || !rt) return rt;
          return what === null ? null : typeof what === 'string' ? { ...rt, unsupported: what as never } : { ...rt, key: [...what] };
        };
        return c;
      };
      expect(await s.migrateToServer(REQ)).toEqual({ ok: false, reason: 'failed', error: `bc:migrateUnlinkable|Commandes|${code}`, table: 'Commandes',
        backupPath: expect.stringContaining('.backup-') });
      expect(txLog()).toEqual(['begin', 'rollback']);
      expect(snapshot()).toEqual(before);
      expect(await serverNames()).toEqual([]);
    });

  it('a design the editor would refuse: invalidDesign, nothing copied, nothing sent', async () => {
    const x = setup((db) => {
      seed(db);
      db.prepare(`UPDATE bc_fields SET props = json_set(props, '$.size', json(?)) WHERE table_name = 'Clients' AND field_name = 'Nom'`).run('"10); DROP TABLE x; --"');
    });
    const one = snapshot();
    expect(await x.migrateToServer(REQ)).toEqual({ ok: false, reason: 'invalidDesign', names: ['Clients.Nom'] });
    expect(snapshot()).toEqual(one);
    expect(backups()).toEqual([]);
    expect(txLog()).toEqual([]);
  });

  it("the run's connection has no statement timeout; the links keep the wizard's", async () => {
    const seen: unknown[] = [];
    const open = fake.open;
    fake.open = async (p, login) => { seen.push((p as { timeout: number }).timeout); return open(p, login); };
    expect(await s.migrateToServer(REQ)).toMatchObject({ ok: true });
    expect(seen).toEqual([0]);
    expect(s.listLinks().map((x) => x.params?.timeout)).toEqual([60, 60, 60]);
    fake.open = open;
  });

  it('Stop during the rows: cancelled, nothing on the server, the front-end unchanged', async () => {
    const before = snapshot();
    fake.hold = true;
    const run = s.migrateToServer(REQ);
    await vi.waitFor(() => expect(fake.log).toContain('insertRows'));
    expect(await s.interrupt()).toBe(true);
    expect(await run).toEqual({ ok: false, reason: 'cancelled', backupPath: expect.stringContaining('.backup-') });
    expect(txLog()).toEqual(['begin', 'rollback']);
    expect(snapshot()).toEqual(before);
    fake.hold = false;
    expect(await serverNames()).toEqual([]);
  });

  it('progress: rows over all tables with the table name, then finishing', async () => {
    const seen: ImportProgress[] = [];
    await s.migrateToServer(REQ, async (p) => { seen.push(p); });
    // the backup copy's path first: the wizard names it when a Stop ends the data process
    expect(seen).toEqual([{ done: 0, total: 9, backupPath: expect.stringContaining('.backup-') }, { done: 4, total: 9, label: 'Clients' },
      { done: 9, total: 9, label: 'Commandes' }, { done: 9, total: 9, finishing: true }]);
  });

  it('rows go by pages of limits.params / fields (at most 1 000), in rowid order', async () => {
    const x = setup((db) => {
      createTable(db, t('Grand', [f('N°', 'autoNumber'), f('v', 'number')]));
      const ins = db.prepare('INSERT INTO "Grand" ("v") VALUES (?)');
      db.exec('BEGIN');
      for (let i = 0; i < 2500; i++) ins.run(i);
      db.exec('COMMIT');
      db.exec('DELETE FROM "Grand" WHERE "N°" = 1000');
    });
    const sizes: number[] = [];
    const open = fake.open;
    fake.open = async (p, login) => {
      const c = await open(p, login), w = c.schema!, insert = w.insertRows;
      w.insertRows = async (tb, rows) => { sizes.push(rows.length); return insert(tb, rows); };
      return c;
    };
    expect(await x.migrateToServer(REQ)).toMatchObject({ ok: true, report: { tables: [{ name: 'Grand', rows: 2499, nextId: 2501 }] } });
    expect(sizes).toEqual([1000, 1000, 499]);
    expect((await x.page('Grand', { offset: 998, limit: 2 })).rows.map((r) => r.values)).toEqual([[999, 998], [1001, 1000]]);
  });
});

describe('runMigration: the local switch', () => {
  let front: DatabaseSync;
  let c: Connection;
  beforeEach(async () => {
    for (const x of opened.splice(0)) await x.close(); // the switch on a connection of the test's own
    front = openBaseFile(fe, 'write', '0.0.0').db;
    c = await fake.open(P as never, LOGIN);
  });
  afterEach(() => { front.close(); });
  /** runMigration whose local switch throws at Commandes's removeTable (Clients already removed in that transaction). */
  const failingSwitch = () => runMigration({ front, c, caps: fake.capabilities, kind: 'postgresql', params: P, label: 'srv', schema: 'public', tick: async () => {},
    backup: () => join(dir, 'b.basecraft'),
    switchLocal: (tables, metas) => switchLocal(front, 'postgresql', P, tables, metas, (db, n) => {
      if (n === 'Commandes') throw new Error('bc:busy');
      removeTable(db, n);
    }), queries: async () => [] });

  it('the local switch failing drops the server tables and reports those left', async () => {
    const before = snapshot();
    expect(await failingSwitch()).toEqual({ ok: false, reason: 'failed', error: 'bc:busy', left: [], backupPath: join(dir, 'b.basecraft') });
    expect(txLog()).toEqual(['begin', 'commit']);
    expect(fake.log.at(-1)).toBe('dropTables');
    expect(snapshot()).toEqual(before);
    expect(await c.schema!.names('public')).toEqual([]);
  });

  it('a failure reading the local designs after the COMMIT still drops the server tables', async () => {
    const before = snapshot();
    const table = c.table;
    c.table = async (x) => {
      const rt = (await table(x))!;
      return { ...rt, design: { ...rt.design, get fields(): never { throw new Error('boom'); } } };
    };
    expect(await failingSwitch()).toEqual({ ok: false, reason: 'failed', error: 'bc:unknown|boom', left: [], backupPath: join(dir, 'b.basecraft') });
    expect(fake.log.at(-1)).toBe('dropTables');
    expect(snapshot()).toEqual(before);
    expect(await c.schema!.names('public')).toEqual([]);
  });

  it('R13: a check that fails says the queries could not be checked, never an empty list', async () => {
    const r = await runMigration({ front, c, caps: fake.capabilities, kind: 'postgresql', params: P, label: 'srv', schema: 'public', tick: async () => {},
      backup: () => join(dir, 'b.basecraft'), switchLocal: (tables, metas) => switchLocal(front, 'postgresql', P, tables, metas),
      queries: async () => { throw new Error('bc:serverError|connection|gone'); } });
    expect(r).toMatchObject({ ok: true, report: { queries: [], queriesUnchecked: 'bc:serverError|connection|gone' } });
  });

  it('a table dropTables cannot drop is reported left', async () => {
    const before = snapshot();
    fake.undroppable = ['Journal'];
    expect(await failingSwitch()).toMatchObject({ ok: false, reason: 'failed', error: 'bc:busy', left: ['Journal'] });
    expect(snapshot()).toEqual(before);
    expect(await c.schema!.names('public')).toEqual(['Journal']);
  });
});
