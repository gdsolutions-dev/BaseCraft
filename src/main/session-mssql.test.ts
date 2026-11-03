import { describe, expect, it, vi } from 'vitest';
import { Connection as Tds } from 'tedious';
import fs from 'node:fs';
import os from 'node:os';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { createBaseFile, openBaseFile } from './db/file-format';
import type { RiskProbe } from './db/location-risk';
import { addServerLinks } from './links/store';
import { linkMeta, type LinkMeta } from './links/meta';
import { Session, type SessionDeps } from './session';
import { connectMs, msConfig, msQuery, openMs } from './connectors/sqlserver/driver';
import { mssqlLive, mssqlUrl, withDatabase } from './connectors/sqlserver/live';
import { msKey, type MsParams } from './connectors/sqlserver/params';
import type { RowRef } from '../shared/api';
import type { SqlValue } from '../shared/coerce';
import type { RemoteTable } from './connectors/connector';
import { f, t } from '../shared/test-fixtures';
import { createTable } from './db/schema';
import { seedSales, seedSalesRelation } from './query/test-db';

// C5 Task 5: sessions of BaseCraft on a live SQL Server (BASECRAFT_MSSQL_TEST_URL), each test in its own database.
const probe: RiskProbe = { platform: 'win32', env: {}, homedir: 'C:\\Users\\x', windowsDriveType: () => 3 };
const deps: SessionDeps = { appVersion: '0.0.0', region: 'fr-FR', probe, lockDeps: { now: () => 0 }, sessionId: 'a' };

const SEED = [
  `CREATE TABLE Clients (id int IDENTITY PRIMARY KEY, Nom nvarchar(80) NOT NULL UNIQUE, Ville nvarchar(80) CONSTRAINT ville_ok CHECK (Ville <> N'Interdit'), rv rowversion);
   INSERT INTO Clients (Nom, Ville) VALUES (N'Dupont', N'Lyon'), (N'Martin', N'LYON'), (N'Durand', N'Paris'), (N'Éric', N'Lyôn')`,
  `EXEC('CREATE TRIGGER Clients_ins ON Clients AFTER INSERT AS BEGIN SET NOCOUNT ON; END')`, // plain OUTPUT would fail (334)
  `CREATE TABLE Commandes (n int IDENTITY PRIMARY KEY, Client int REFERENCES Clients, Montant decimal(10,2), Prix float, Notes nvarchar(max), Code nvarchar(10), Quand datetime2(7));
   INSERT INTO Commandes (Client, Montant, Prix, Notes, Code, Quand) VALUES (2, 10.10, 1.5, N'a', N'abc', '2026-10-30 12:34:56.1234567'), (3, 0.20, NULL, NULL, NULL, NULL)`,
  `CREATE TABLE Big (k bigint PRIMARY KEY, x int); INSERT INTO Big VALUES (9007199254740993, 1), (9007199254740995, 1)`,
  `CREATE TABLE Ts (t datetime2(7) PRIMARY KEY, x int); INSERT INTO Ts VALUES ('2026-10-30 12:34:56.0000001', 1), ('2026-10-30 12:34:56.0000002', 1)`,
  `CREATE TABLE Pad (code char(5) PRIMARY KEY, x int); INSERT INTO Pad VALUES ('ab', 1), ('abc', 1)`,
  `CREATE TABLE G (id uniqueidentifier PRIMARY KEY DEFAULT NEWID(), x int); INSERT INTO G (x) VALUES (1), (1)`,
  // the first row of each by its key: a money with four decimals, a float of 17 significant digits
  `CREATE TABLE Mon (m money PRIMARY KEY, x int); INSERT INTO Mon VALUES (1.2345, 1), (2.5, 1)`,
  `CREATE TABLE Fl (f float PRIMARY KEY, x int); INSERT INTO Fl VALUES (1.0E0 / 3, 1), (2.5, 1)`,
  `CREATE TABLE Vt (x int); EXEC('CREATE VIEW V AS SELECT x FROM Vt')`,
  `EXEC('CREATE TRIGGER V_ins ON V INSTEAD OF INSERT AS BEGIN SET NOCOUNT ON; END')`, // writes nothing
  // C5 R16: a case-sensitive key ('Lyon' and 'LYON' two rows), joined as Access compares (without case)
  `CREATE TABLE Villes (code nvarchar(80) COLLATE Latin1_General_100_CS_AS PRIMARY KEY, region nvarchar(80));
   INSERT INTO Villes VALUES (N'Lyon', N'ARA'), (N'LYON', N'Rhône'), (N'Paris', N'IDF')`,
  `CREATE TABLE Gros (id bigint IDENTITY(3000000000, 1) PRIMARY KEY, nom nvarchar(80)); INSERT INTO Gros (nom) VALUES (N'Grand');
   CREATE TABLE Liens (n int IDENTITY PRIMARY KEY, g bigint REFERENCES Gros, note nvarchar(80)); INSERT INTO Liens (g, note) VALUES (3000000000, N'a')`,
  `CREATE TABLE Prix (id int IDENTITY PRIMARY KEY, Montant money, Age tinyint)`, // C7 R11: Currency and Byte as the wizard writes them
];
// C5 R16: an order and its client, entered through one query
const J = { kind: 'sql' as const, sql: 'SELECT n, Client, Montant, Nom, Ville FROM Commandes INNER JOIN Clients ON Commandes.Client = Clients.id ORDER BY n' };
const COMMANDES = ['n', 'Client', 'Montant', 'Prix', 'Notes', 'Code', 'Quand'];
/** A page row's values by field name (the record as read when editing began). */
const byField = (r: { values: SqlValue[] }): Record<string, SqlValue> => Object.fromEntries(COMMANDES.map((k, i) => [k, r.values[i] ?? null]));

type Admin = { query(sql: string): Promise<unknown[][]> };
type Ctx = { admin: Admin; database: string; tables: RemoteTable[]; session: (o?: { timeout?: number }, metas?: Record<string, LinkMeta>) => Session };
/** The seeded database linked into front-ends (one per session asked, as two workstations); every session closed after. */
async function live(fn: (x: Ctx) => Promise<void>): Promise<void> {
  const dir = fs.realpathSync.native(fs.mkdtempSync(join(os.tmpdir(), 'bcms-')));
  const opened: Session[] = [];
  try {
    await withDatabase(async (admin, database) => {
      for (const sql of SEED) await admin.query(sql);
      const { params, login } = mssqlLive();
      const conn = await openMs({ ...params, database }, login);
      const tables = await conn.tables();
      await conn.close();
      const session = (o: { timeout?: number } = {}, metas?: Record<string, LinkMeta>) => {
        const p: MsParams = { ...params, database, ...o };
        const fe = join(dir, `front${opened.length}.basecraft`);
        createBaseFile(fe, '0.0.0');
        const db = openBaseFile(fe, 'write', '0.0.0').db;
        addServerLinks(db, 'sqlserver', p, tables, metas && tables.map((x) => metas[x.name])); // C7 R11: the wizard's metadata
        db.close();
        const s = Session.open(fe, deps);
        opened.push(s);
        s.setCredential(msKey(p), login.user, login.password);
        return s;
      };
      try {
        await fn({ admin, database, tables, session });
      } finally {
        await admin.query('IF @@TRANCOUNT > 0 ROLLBACK').catch(() => {}); // a test's lock, if it failed holding one
        for (const s of opened.splice(0)) await s.close();
      }
    });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}
/** Order 1's amount and its client's town, as the server holds them. */
const order1 = (admin: Admin) => admin.query('SELECT CONVERT(varchar(20), Montant), Ville FROM Commandes JOIN Clients ON id = Client WHERE n = 1');
/** KILL every BaseCraft session in this database (other test files run their own elsewhere at the same time). */
const killBaseCraft = (admin: Admin) => admin.query(`DECLARE @sql nvarchar(max) = N'';
  SELECT @sql += N'KILL ' + CAST(session_id AS nvarchar(10)) + N'; ' FROM sys.dm_exec_sessions WHERE program_name = N'BaseCraft' AND database_id = DB_ID();
  EXEC(@sql)`);
/** BaseCraft's requests now running in this database. */
const running = (admin: Admin) => admin.query(`SELECT count(*) FROM sys.dm_exec_requests r JOIN sys.dm_exec_sessions x ON x.session_id = r.session_id
  WHERE x.program_name = N'BaseCraft' AND x.database_id = DB_ID()`);

describe.skipIf(!mssqlUrl)('sessions on a SQL Server (live)', () => {
  it('BaseCraft metadata on the links: Currency over money, Byte over tinyint, rules and Limit To List (C7 R11, R12)', async () => {
    await live(async ({ admin, tables, session }) => {
      const prix = tables.find((x) => x.name === 'Prix')!, commandes = tables.find((x) => x.name === 'Commandes')!;
      expect(prix.design.fields.map((x) => [x.props.type, x.props.numberSize])).toEqual([['autoNumber', undefined], ['currency', undefined], ['number', 'byte']]);
      const local = { ...t('Prix', [f('id', 'autoNumber'), f('Montant', 'currency', { caption: 'Montant TTC', validationRule: '>0' }), f('Age', 'number', { numberSize: 'byte' })]),
        validationRule: '[Montant] < 10000' };
      const client = f('Client', 'number', { lookup: { kind: 'table', table: 'Clients', columnCount: 2, columnWidths: [0, 1440], limitToList: true } });
      const own = commandes.design.fields.map((x) => (x.name === 'Client' ? { ...x, props: { ...x.props, lookup: client.props.lookup } } : x));
      const s = session({}, { Prix: linkMeta(local, prix), Commandes: linkMeta(t('Commandes', own), commandes) });
      expect(s.tableDesign('Prix').fields.map((x) => [x.props.type, x.props.caption])).toEqual([['autoNumber', undefined], ['currency', 'Montant TTC'], ['number', undefined]]);
      const r = await s.insert('Prix', { Montant: '1234,5678', Age: '255' });
      expect(r).toMatchObject({ ok: true, values: [1, 1234.5678, 255] });
      expect(await s.insert('Prix', { Montant: '1', Age: '300' })).toEqual({ ok: false, errors: [{ field: 'Age', code: 'outOfRange' }] }); // before sending
      expect(await s.insert('Prix', { Montant: '0' })).toMatchObject({ ok: false, errors: [{ field: 'Montant', code: 'validation' }] });
      expect(await s.update('Prix', (r as { rowid: RowRef }).rowid, { Montant: '20000' })).toEqual({ ok: false, errors: [{ field: '', code: 'validation', table: 'Prix' }] });
      const u = await s.update('Prix', (r as { rowid: RowRef }).rowid, { Montant: '922,5' }); // the rule read the row in the save's transaction
      expect(u).toMatchObject({ ok: true, values: [1, 922.5, 255] });
      expect((await s.page('Prix', { offset: 0, limit: 10 })).rows.map((x) => x.values)).toEqual([[1, 922.5, 255]]);
      expect(await admin.query('SELECT CONVERT(varchar(30), Montant, 2), Age FROM Prix')).toEqual([['922.5000', 255]]);
      // Limit To List over another server link, compared on the server; the datasheet list read through it
      expect(await s.insert('Commandes', { Client: '99', Montant: '1' })).toEqual({ ok: false, errors: [{ field: 'Client', code: 'notInList' }] });
      expect(await s.insert('Commandes', { Client: '4', Montant: '1' })).toMatchObject({ ok: true, values: [3, 4, '1.00', null, null, null, null] });
      expect((await s.lookup('Commandes', 'Client')).rows.map((x) => [x.value, ...x.display])).toEqual([[1, 'Dupont'], [3, 'Durand'], [4, 'Éric'], [2, 'Martin']]);
    });
  });
  it('pages and counts on the server; text criteria ignore case', async () => {
    await live(async ({ session }) => {
      const s = session();
      expect(await s.count('Clients', [{ field: 'Ville', criteria: '"lyon"' }])).toBe(2);
      expect(await s.count('Clients')).toBe(4);
      const p = await s.page('Clients', { offset: 1, limit: 2, sort: { field: 'Nom', dir: 'asc' } });
      expect(p.rows.map((r) => r.values)).toEqual([[3, 'Durand', 'Paris'], [4, 'Éric', 'Lyôn']]); // Dupont, Durand, Éric, Martin
      expect(JSON.parse(p.rows[0]!.rowid as string)).toEqual([['id'], ['3'], expect.stringMatching(/^0x[0-9A-F]{16}$/)]); // R11: the rowversion
      expect((await s.page('Commandes', { offset: 0, limit: 1 })).rows[0]!.values).toEqual([1, 2, '10.10', 1.5, 'a', 'abc', '2026-10-30 12:34:56']);
      expect(JSON.parse((await s.page('Commandes', { offset: 0, limit: 1 })).rows[0]!.rowid as string)).toEqual([['n'], ['1'], '']); // no rowversion
      const q = await s.pageSource({ kind: 'sql', sql: 'SELECT Nom, Ville FROM Clients WHERE Ville Like "ly*" ORDER BY Nom DESC' }, { offset: 0, limit: 10 });
      expect(q).toMatchObject({ total: 3, rows: [['Martin', 'LYON'], ['Éric', 'Lyôn'], ['Dupont', 'Lyon']] });
    });
  });

  it('every key type finds its row again; an insert returns its new key despite the trigger', async () => { // Review Focus 3, 4
    await live(async ({ session }) => {
      const s = session();
      for (const t of ['Big', 'Ts', 'Pad', 'G', 'Mon', 'Fl']) {
        const before = await s.count(t);
        const [r] = (await s.page(t, { offset: 0, limit: 1 })).rows;
        expect((await s.update(t, r!.rowid, { x: '2' })).ok).toBe(true);
        expect(await s.delete(t, [r!.rowid])).toEqual({ ok: true, count: 1 });
        expect(await s.count(t)).toBe(before - 1);
      }
      expect((await s.page('Big', { offset: 0, limit: 1 })).rows[0]!.values).toEqual(['9007199254740995', 1]);
      expect((await s.page('Ts', { offset: 0, limit: 1 })).rows[0]!.values).toEqual(['2026-10-30 12:34:56', 1]); // the fraction dropped, kept in its token
      expect((await s.page('Pad', { offset: 0, limit: 1 })).rows[0]!.values).toEqual(['abc  ', 1]);
      expect(await s.insert('Clients', { Nom: 'Petit', Ville: 'Nancy' })).toMatchObject({ ok: true, values: [5, 'Petit', 'Nancy'] });
      const g = await s.insert('G', { x: '1' });
      expect(g).toMatchObject({ ok: true, values: [expect.stringMatching(/^[0-9A-F-]{36}$/), 1] });
      expect((await s.update('G', (g as { rowid: RowRef }).rowid, { x: '3' }))).toMatchObject({ ok: true, values: [(g as { values: SqlValue[] }).values[0], 3] });
    });
  });

  it('rowversion: two sessions on one record, Save Record wins, deleted', async () => {
    await live(async ({ session }) => {
      const s1 = session(), s2 = session();
      const [r1] = (await s1.page('Clients', { offset: 0, limit: 1 })).rows;
      const [r2] = (await s2.page('Clients', { offset: 0, limit: 1 })).rows;
      expect((await s1.update('Clients', r1!.rowid, { Ville: 'Brest' })).ok).toBe(true);
      const c = await s2.update('Clients', r2!.rowid, { Ville: 'Lille' }, { id: 1, Nom: 'Dupont', Ville: 'Lyon' }); // expected ignored: the version decides
      expect(c).toMatchObject({ ok: false, conflict: 'changed', current: [1, 'Dupont', 'Brest'] });
      expect((c as { rowid: RowRef }).rowid).not.toBe(r2!.rowid);
      const saved = await s2.update('Clients', (c as { rowid: RowRef }).rowid, { Ville: 'Lille' }); // Save Record wins
      expect(saved).toMatchObject({ ok: true, values: [1, 'Dupont', 'Lille'] });
      expect(await s1.delete('Clients', [r1!.rowid])).toEqual({ ok: true, count: 1 }); // a stale reference deletes all the same (R8)
      expect(await s2.update('Clients', r2!.rowid, { Ville: 'Nantes' })).toEqual({ ok: false, conflict: 'deleted' });
    });
  });

  it('values (no rowversion): a real change conflicts; a fraction, a float, a Long Text or a case-only change does not', async () => { // Review Focus 2
    await live(async ({ admin, session }) => {
      const s1 = session(), s2 = session();
      const [a] = (await s1.page('Commandes', { offset: 0, limit: 1 })).rows;
      const [b] = (await s2.page('Commandes', { offset: 0, limit: 1 })).rows;
      await admin.query("UPDATE Commandes SET Prix = Prix + 1, Notes = N'x', Code = UPPER(Code), Quand = DATEADD(ns, 100, Quand) WHERE n = 1");
      expect(await s1.update('Commandes', a!.rowid, { Montant: '9' }, byField(a!))).toMatchObject({ ok: true, values: [1, 2, '9.00', 2.5, 'x', 'ABC', '2026-10-30 12:34:56'] });
      const c = await s2.update('Commandes', b!.rowid, { Montant: '7' }, byField(b!));
      expect(c).toMatchObject({ ok: false, conflict: 'changed', current: [1, 2, '9.00', 2.5, 'x', 'ABC', '2026-10-30 12:34:56'] });
      // Save Record: the renderer adopts `current` as the record read; the reference is the same (no version)
      expect((c as { rowid: RowRef }).rowid).toBe(b!.rowid);
      const current = Object.fromEntries(COMMANDES.map((k, i) => [k, (c as { current: SqlValue[] }).current[i] ?? null]));
      expect(await s2.update('Commandes', b!.rowid, { Montant: '7' }, current)).toMatchObject({ ok: true, values: [1, 2, '7.00', 2.5, 'x', 'ABC', '2026-10-30 12:34:56'] });
      // Null on one side: a value where Null was read is a change; Null read and Null now is none
      const [, d] = (await s1.page('Commandes', { offset: 0, limit: 2 })).rows;
      await admin.query("UPDATE Commandes SET Code = N'z' WHERE n = 2");
      expect(await s1.update('Commandes', d!.rowid, { Montant: '1' }, byField(d!))).toMatchObject({ ok: false, conflict: 'changed' });
      expect(await s1.update('Commandes', d!.rowid, { Montant: '1' }, { ...byField(d!), Code: 'z' })).toMatchObject({ ok: true });
    });
  });

  it('server refusals become field errors', async () => {
    await live(async ({ session }) => {
      const s = session();
      expect(await s.insert('Clients', { Nom: 'Dupont' })).toMatchObject({ ok: false, errors: [{ field: 'Nom', code: 'duplicate' }] });
      expect(await s.insert('Commandes', { Client: '999' })).toMatchObject({ ok: false, errors: [{ field: 'Client', code: 'noParent' }] });
      const [martin] = (await s.page('Clients', { offset: 1, limit: 1 })).rows;
      expect(await s.delete('Clients', [martin!.rowid])).toEqual({ ok: false, reason: 'related', table: 'Commandes' });
      await expect(s.insert('V', { x: '1' })).rejects.toThrow('bc:serverError|notWritten|V');
      expect(await s.insert('Clients', { Nom: 'Zoé', Ville: 'Nice' })).toMatchObject({ ok: true, values: [expect.any(Number), 'Zoé', 'Nice'] });
    });
  });

  it('a lost connection: reads reconnect, a save lost once sent reports once and is never repeated', async () => { // Review Focus 5
    await live(async ({ admin, database, session }) => {
      const s = session();
      const [r] = (await s.page('Clients', { offset: 0, limit: 1 })).rows;
      await killBaseCraft(admin);
      expect((await s.page('Clients', { offset: 0, limit: 1 })).rows).toHaveLength(1);
      // a save waiting on another session's lock, its session killed: outcome unknown, never repeated (KILL refuses to run
      // inside a transaction: the lock is held by a connection of its own)
      const { params, login } = mssqlLive();
      const config = msConfig({ ...params, database }, login);
      const locker = await connectMs({ ...config, options: { ...config.options, appName: 'BaseCraft tests' } });
      try {
        await msQuery(locker, 'BEGIN TRAN; SELECT TOP (0) * FROM Clients WITH (TABLOCKX, HOLDLOCK)');
        const u = s.update('Clients', r!.rowid, { Ville: 'Brest' });
        u.catch(() => {}); // it may fail during the KILL below, before the expect: never an unhandled rejection
        await sleep(300);
        await killBaseCraft(admin);
        await expect(u).rejects.toThrow(/^bc:serverError\|connection\|/);
        await msQuery(locker, 'ROLLBACK');
      } finally {
        locker.close();
      }
      expect((await s.page('Clients', { offset: 0, limit: 1 })).rows[0]!.values).toEqual([1, 'Dupont', 'Lyon']); // never repeated
    });
  });

  it('a join query (C5 R16): AutoLookup, both tables saved in one transaction; a refusal or a conflict on the client rolls everything back', async () => {
    await live(async ({ admin, session }) => {
      const s = session(), other = session();
      expect((await s.describeSource(J)).updatable).toBe(true);
      expect(await s.autoLookup(J, { Client: '3' })).toEqual({ Nom: 'Durand', Ville: 'Paris' });
      expect(await s.autoLookup(J, { Client: '99' })).toEqual({ Nom: null, Ville: null });
      const page = await s.pageSource(J, { offset: 0, limit: 10 });
      expect(page.rows).toEqual([[1, 2, '10.10', 'Martin', 'LYON'], [2, 3, '0.20', 'Durand', 'Paris']]);
      const read = { n: 1, Client: 2, Montant: '10.10', Nom: 'Martin', Ville: 'LYON' };
      const r = await s.saveSource(J, { rowid: page.rowids[0]!, values: { Montant: '11', Ville: 'Lille' }, expected: read });
      const now = { ...read, Montant: '11.00', Ville: 'Lille' };
      expect(r).toMatchObject({ ok: true, values: now });
      expect(await order1(admin)).toEqual([['11.00', 'Lille']]);
      const ref = (r as { rowid: RowRef }).rowid;
      // the server refuses the client's town (its CHECK): the order's amount is rolled back
      expect(await s.saveSource(J, { rowid: ref, values: { Montant: '12', Ville: 'Interdit' }, expected: now }))
        .toMatchObject({ ok: false, errors: [{ field: 'Ville', code: 'validation', table: 'Clients' }] });
      expect(await order1(admin)).toEqual([['11.00', 'Lille']]);
      // another session changed the client since it was read (rowversion moved): changed, `current` read again, nothing written
      const [martin] = (await other.page('Clients', { offset: 1, limit: 1 })).rows;
      expect((await other.update('Clients', martin!.rowid, { Ville: 'Nice' })).ok).toBe(true);
      const c = await s.saveSource(J, { rowid: ref, values: { Montant: '13', Ville: 'Pau' }, expected: now });
      expect(c).toMatchObject({ ok: false, conflict: 'changed', current: { ...now, Ville: 'Nice' }, rowid: ref });
      expect(await order1(admin)).toEqual([['11.00', 'Nice']]);
      // Save Record: against `current`
      expect(await s.saveSource(J, { rowid: ref, values: { Montant: '13', Ville: 'Pau' }, expected: (c as { current: Record<string, SqlValue> }).current }))
        .toMatchObject({ ok: true, values: { Montant: '13.00', Ville: 'Pau' } });
      expect(await order1(admin)).toEqual([['13.00', 'Pau']]);
    });
  });

  it('a join query (C5 R16): a new order with its client field: the client found from the key typed gets it (final review 7)', async () => {
    await live(async ({ admin, session }) => {
      const s = session();
      expect(await s.saveSource(J, { rowid: null, values: { Client: '3', Montant: '7', Ville: 'Annecy' } }))
        .toMatchObject({ ok: true, values: { n: 3, Client: 3, Montant: '7.00', Nom: 'Durand', Ville: 'Annecy' } });
      expect(await admin.query('SELECT Client, CONVERT(varchar(20), Montant) FROM Commandes WHERE n = 3')).toEqual([[3, '7.00']]);
      expect(await admin.query('SELECT Ville FROM Clients WHERE id = 3')).toEqual([['Annecy']]);
    });
  });

  it('a join query (C5 R16): its "one" row found as the join compares (R8: without case): twice readOnly, none noParent', async () => {
    await live(async ({ admin, session }) => {
      const s = session();
      const V = { kind: 'sql' as const, sql: 'SELECT Clients.id, Nom, Ville, region FROM Clients INNER JOIN Villes ON Clients.Ville = Villes.code' };
      expect(await s.autoLookup(V, { Ville: 'paris' })).toEqual({ region: 'IDF' });
      expect(await s.autoLookup(V, { Ville: 'lyon' })).toEqual({ region: null }); // 'Lyon' and 'LYON'
      const clients = (await s.page('Clients', { offset: 0, limit: 10 })).rows; // Dupont Lyon, Martin LYON, Durand Paris, Éric Lyôn
      expect(await s.saveSource(V, { rowid: clients[0]!.rowid, values: { region: 'X' } })).toEqual({ ok: false, errors: [{ field: 'region', code: 'readOnly', table: 'Villes' }] });
      expect(await s.saveSource(V, { rowid: clients[3]!.rowid, values: { region: 'X' } })).toEqual({ ok: false, errors: [{ field: 'region', code: 'noParent', table: 'Villes' }] });
      expect(await s.saveSource(V, { rowid: clients[2]!.rowid, values: { Nom: 'Durand SA', region: 'Île-de-France' } })).toMatchObject({ ok: true, values: { Nom: 'Durand SA', region: 'Île-de-France' } });
      expect(await admin.query('SELECT region FROM Villes ORDER BY code COLLATE Latin1_General_100_BIN2')).toEqual([['Rhône'], ['ARA'], ['Île-de-France']]);
    });
  });

  it('a join query (C5 R16): a join key above 2^31 (a bigint identity): AutoLookup and the "one" row found', async () => {
    await live(async ({ admin, session }) => {
      const s = session();
      const G = { kind: 'sql' as const, sql: 'SELECT n, g, note, nom FROM Liens INNER JOIN Gros ON Liens.g = Gros.id' };
      expect(await s.autoLookup(G, { g: '3000000000' })).toEqual({ nom: 'Grand' });
      const page = await s.pageSource(G, { offset: 0, limit: 10 });
      expect(await s.saveSource(G, { rowid: page.rowids[0]!, values: { nom: 'Énorme' }, expected: { n: 1, g: 3000000000, note: 'a', nom: 'Grand' } })).toMatchObject({ ok: true, values: { nom: 'Énorme' } });
      expect(await admin.query('SELECT nom FROM Gros')).toEqual([['Énorme']]);
    });
  });

  it('a join query (C5 R16): Delete Record deletes the row of the key table by its token only, the "one" row stays', async () => {
    await live(async ({ admin, session }) => {
      const s = session();
      const page = await s.pageSource(J, { offset: 0, limit: 10 });
      expect(await s.delete('Commandes', [page.rowids[0]!])).toEqual({ ok: true, count: 1 });
      expect(await admin.query('SELECT n FROM Commandes')).toEqual([[2]]);
      expect(await admin.query('SELECT count(*) FROM Clients')).toEqual([[4]]);
    });
  });

  it('a join query (C5 R16): Stop or a lost connection during the transaction rolls it back, never run again', async () => {
    await live(async ({ admin, database, session }) => {
      const s = session();
      const ref = (await s.pageSource(J, { offset: 0, limit: 1 })).rowids[0]!;
      // the order written, then its client waited on inside the transaction (UPDLOCK against UPDLOCK); KILL refuses to run
      // inside a transaction: the lock is held by a connection of its own
      const { params, login } = mssqlLive();
      const config = msConfig({ ...params, database }, login);
      const locker = await connectMs({ ...config, options: { ...config.options, appName: 'BaseCraft tests' } });
      try {
        await msQuery(locker, 'BEGIN TRAN; SELECT * FROM Clients WITH (UPDLOCK) WHERE id = 2');
        const stopped = s.saveSource(J, { rowid: ref, values: { Montant: '12', Ville: 'Pau' } });
        await sleep(300);
        expect(await running(admin)).toEqual([[1]]);
        expect(await s.interrupt()).toBe(true);
        await expect(stopped).rejects.toThrow('bc:cancelled');
        await msQuery(locker, 'ROLLBACK');
        expect(await order1(admin)).toEqual([['10.10', 'LYON']]);
        expect(await admin.query("SELECT count(*) FROM sys.dm_tran_session_transactions t JOIN sys.dm_exec_sessions x ON x.session_id = t.session_id WHERE x.program_name = N'BaseCraft' AND x.database_id = DB_ID()")).toEqual([[0]]); // rolled back, none left open
        await msQuery(locker, 'BEGIN TRAN; SELECT * FROM Clients WITH (UPDLOCK) WHERE id = 2');
        const lost = s.saveSource(J, { rowid: ref, values: { Montant: '12', Ville: 'Pau' } });
        lost.catch(() => {});
        await sleep(300);
        await killBaseCraft(admin);
        await expect(lost).rejects.toThrow(/^bc:serverError\|connection\|/);
        await msQuery(locker, 'ROLLBACK');
      } finally {
        locker.close();
      }
      expect(await order1(admin)).toEqual([['10.10', 'LYON']]); // rolled back by the server, never run again
      expect((await s.saveSource(J, { rowid: ref, values: { Montant: '12' } })).ok).toBe(true); // a new connection
    });
  });

  it('a connection killed while idle: the save, refused before it left, is sent once on a new connection (I1)', async () => {
    await live(async ({ admin, session }) => {
      const s = session();
      const [r] = (await s.page('Clients', { offset: 0, limit: 1 })).rows;
      const ended = vi.fn();
      const original = Tds.prototype.emit; // EventEmitter's
      const emit = vi.spyOn(Tds.prototype, 'emit').mockImplementation(function (this: Tds, event: string | symbol, ...args: unknown[]) {
        if (event === 'end') ended(); // the connection closed: its next request is refused before it is sent
        return original.apply(this, [event, ...args] as Parameters<Tds['emit']>);
      });
      try {
        await killBaseCraft(admin);
        await vi.waitFor(() => expect(ended).toHaveBeenCalled(), { timeout: 5000, interval: 20 }); // tedious heard the socket close
      } finally {
        emit.mockRestore();
      }
      expect(await s.update('Clients', r!.rowid, { Ville: 'Brest' })).toMatchObject({ ok: true, values: [1, 'Dupont', 'Brest'] });
    });
  });

  it('Stop cancels on the server; the timeout reports', async () => { // Review Focus 5
    await live(async ({ admin, session }) => {
      const s = session();
      expect(await s.count('Clients')).toBe(4); // connected
      await admin.query('BEGIN TRAN; SELECT TOP (0) * FROM Clients WITH (TABLOCKX, HOLDLOCK)');
      const p = s.page('Clients', { offset: 0, limit: 1 });
      await sleep(200);
      expect(await running(admin)).toEqual([[1]]);
      expect(await s.interrupt()).toBe(true);
      await expect(p).rejects.toThrow('bc:cancelled');
      expect(await running(admin)).toEqual([[0]]);
      await admin.query('ROLLBACK');
      expect(await s.count('Clients')).toBe(4); // the same connection goes on
      expect(await s.interrupt()).toBe(false); // nothing running

      const s2 = session({ timeout: 1 });
      const [r] = (await s2.page('Clients', { offset: 0, limit: 1 })).rows;
      await admin.query('BEGIN TRAN; SELECT * FROM Clients WITH (UPDLOCK) WHERE id = 1');
      const started = Date.now();
      // a write's timeout is the client's (the server may have completed it): outcome unknown, never sent again (final review 1)
      await expect(s2.update('Clients', r!.rowid, { Ville: 'Brest' })).rejects.toThrow(/^bc:serverError\|connection\|Timeout: Request failed to complete in 1000ms/);
      expect(Date.now() - started).toBeLessThan(5000);
      await admin.query('ROLLBACK');
      expect((await s2.page('Clients', { offset: 0, limit: 1 })).rows[0]!.values).toEqual([1, 'Dupont', 'Lyon']); // cancelled, never repeated
      await admin.query('BEGIN TRAN; SELECT TOP (0) * FROM Clients WITH (TABLOCKX, HOLDLOCK)');
      await expect(s2.page('Clients', { offset: 0, limit: 1 })).rejects.toThrow('bc:timeout|1'); // a read's timeout
      await admin.query('ROLLBACK');
    });
  });

  it('pass-through (R13): a read-only snapshot of the batch as typed; Returns Records No runs once enabled', async () => {
    await live(async ({ admin, database, session }) => {
      const s = session();
      const params = { ...mssqlLive().params, database };
      const pt = (returnsRecords: boolean, sql: string) => ({ formatVersion: '2.0', sql, passThrough: { kind: 'sqlserver', params, returnsRecords } });
      expect(s.saveObject('query', 'P', pt(true, `SELECT Ville, STRING_AGG(Nom, N', ') WITHIN GROUP (ORDER BY Nom) AS Noms
        FROM Clients GROUP BY Ville COLLATE Latin1_General_100_BIN2, Ville ORDER BY Ville COLLATE Latin1_General_100_BIN2`), null)).toEqual({ ok: true });
      expect(s.saveObject('query', 'PNo', pt(false, "UPDATE Clients SET Ville = UPPER(Ville) WHERE Ville = N'Paris'"), null)).toEqual({ ok: true });
      const P = { kind: 'query', name: 'P' } as const;
      s.setContentEnabled(s.activeContent().fingerprint, true); // trusted: the stored credential runs pass-throughs (C6 Task 8)
      const info = await s.describeSource(P);
      expect(info.updatable).toBe(false);
      expect(info.fields.map((f) => [f.name, f.type])).toEqual([['Ville', 'shortText'], ['Noms', 'longText']]);
      const page = await s.pageSource(P, { offset: 0, limit: 10, fresh: true, filter: [{ field: 'Ville', criteria: '"lyon"' }] });
      expect(page.rows).toEqual([['LYON', 'Martin'], ['Lyon', 'Dupont']]); expect(page.rowids).toEqual([null, null]);

      s.setContentEnabled(null);
      const OPTS = { skipFailures: false, replaceTable: false };
      await expect(s.runAction({ kind: 'query', name: 'PNo' }, {}, OPTS)).rejects.toThrow('bc:contentDisabled');
      expect(await admin.query("SELECT count(*) FROM Clients WHERE Ville = N'PARIS' COLLATE Latin1_General_100_BIN2")).toEqual([[0]]);
      s.setContentEnabled(s.activeContent().fingerprint, true);
      expect(await s.runAction({ kind: 'query', name: 'PNo' }, {}, OPTS)).toEqual({ ok: true, count: 1 });
      expect(await admin.query("SELECT count(*) FROM Clients WHERE Ville = N'PARIS' COLLATE Latin1_General_100_BIN2")).toEqual([[1]]);
      // a pass-through runs on its own connection, closed after (C6 R4): no BaseCraft session left in the database but the links'
      await expect.poll(() => admin.query(`SELECT count(*) FROM sys.dm_exec_sessions WHERE program_name = N'BaseCraft' AND database_id = DB_ID()`)).toEqual([[0]]);
    });
  });
});

describe.skipIf(!mssqlUrl)('action queries on the migrated sales base (live, C7 R14)', () => {
  const OPTS = { skipFailures: false, replaceTable: false };
  const sql = (text: string) => ({ kind: 'sql' as const, sql: text });
  /** The sales base with its Journal, migrated to a fresh database: `fn` with the session on its links (content enabled). */
  const migrated = (fn: (s: Session) => Promise<void>) => withDatabase(async (_admin, database) => {
    const dir = fs.realpathSync.native(fs.mkdtempSync(join(os.tmpdir(), 'bcmsa-')));
    const fe = join(dir, 'ventes.basecraft');
    createBaseFile(fe, '0.0.0');
    const db = openBaseFile(fe, 'write', '0.0.0').db;
    seedSales(db);
    seedSalesRelation(db);
    createTable(db, t('Journal', [f('N°', 'autoNumber'), f('Texte', 'shortText')]));
    db.close();
    const { login } = mssqlLive(), params = { ...mssqlLive().params, database };
    const s = Session.open(fe, deps);
    try {
      s.setCredential(msKey(params), login.user, login.password);
      expect(await s.migrateToServer({ kind: 'sqlserver', params, schema: 'dbo' })).toMatchObject({ ok: true });
      s.setContentEnabled(s.activeContent().fingerprint);
      await fn(s);
    } finally {
      await s.close();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
  const rows = async (s: Session, table: string) => (await s.page(table, { offset: 0, limit: 20 })).rows.map((r) => r.values);

  it('RunSQL INSERT … VALUES into a server table', () => migrated(async (s) => {
    expect(await s.runAction(sql('INSERT INTO Journal (Texte) VALUES ("ouverture")'), {}, OPTS)).toEqual({ ok: true, count: 1 });
    expect(await rows(s, 'Journal')).toEqual([[1, 'ouverture']]);
  }), 60_000);

  it('Update with a criterion and Delete', () => migrated(async (s) => {
    expect(await s.runAction(sql('UPDATE Commandes SET Montant = Montant * 2 WHERE Client = 1'), {}, OPTS)).toEqual({ ok: true, count: 2 });
    expect((await rows(s, 'Commandes')).map((r) => r[2])).toEqual([20.2, 0.2, 0.2, 99.99, 0.1]);
    await s.runAction(sql('INSERT INTO Journal (Texte) VALUES ("x")'), {}, OPTS);
    expect(await s.runAction(sql('DELETE FROM Journal'), {}, OPTS)).toEqual({ ok: true, count: 1 });
    expect(await rows(s, 'Journal')).toEqual([]);
  }), 60_000);

  it('a front-end rule refusal counts by cause; run anyway skips it', () => migrated(async (s) => {
    const q = sql('UPDATE Commandes SET Montant = 0 WHERE [N°] = 1');
    expect(await s.runAction(q, {}, OPTS)).toMatchObject({ ok: false, reason: 'rowErrors', failed: 1, byCause: { validation: 1 } });
    expect(await s.runAction(q, {}, { ...OPTS, skipFailures: true })).toEqual({ ok: true, count: 0 });
    expect((await rows(s, 'Commandes'))[0]![2]).toBe(10.1);
  }), 60_000);

  it('a server key violation rolls the whole run back, run anyway included', () => migrated(async (s) => {
    const q = sql('INSERT INTO Commandes (Client, Montant) SELECT [N°] * [N°], 1 FROM Clients'); // clients 1 and 4 exist, 9 does not
    const refused = { ok: false, reason: 'rowErrors', failed: 1, total: 4, errors: [{ field: 'Client', code: 'noParent' }], byCause: { conversion: 0, key: 1, lock: 0, validation: 0 } };
    expect(await s.runAction(q, {}, OPTS)).toEqual(refused);
    expect(await s.runAction(q, {}, { ...OPTS, skipFailures: true })).toEqual(refused);
    expect(await rows(s, 'Commandes')).toHaveLength(5); // nothing written
  }), 60_000);

  it('an Append supplying AutoNumber values is refused, nothing written', () => migrated(async (s) => {
    await expect(s.runAction(sql('INSERT INTO Journal ([N°], Texte) VALUES (7, "x")'), {}, OPTS)).rejects.toThrow('bc:serverNotSupported|appendAutoNumber|sqlserver');
    await expect(s.runAction(sql('INSERT INTO Journal VALUES (7, "x")'), {}, OPTS)).rejects.toThrow('bc:serverNotSupported|appendAutoNumber|sqlserver');
    expect(await rows(s, 'Journal')).toEqual([]);
    expect(await s.runAction(sql('INSERT INTO Journal (Texte) VALUES ("y")'), {}, OPTS)).toEqual({ ok: true, count: 1 }); // the server numbers
  }), 60_000);

  it('Make-Table on a server source is refused', () => migrated(async (s) => {
    await expect(s.runAction(sql('SELECT * INTO X FROM Clients'), {}, OPTS)).rejects.toThrow('bc:serverNotSupported|makeTable|sqlserver');
  }), 60_000);

  it('actionCount counts on the server', () => migrated(async (s) => {
    expect(await s.actionCount(sql('UPDATE Commandes SET Montant = 1 WHERE Client = 1'), {})).toEqual({ count: 2, table: 'Commandes' });
    expect(await s.actionCount(sql('DELETE FROM Commandes WHERE Client = 2'), {})).toEqual({ count: 2, table: 'Commandes' });
    expect(await s.actionCount(sql('INSERT INTO Journal (Texte) SELECT Nom FROM Clients WHERE Ville = "lyon"'), {})).toEqual({ count: 2, table: 'Journal' });
    // a join: the target's rows, each once
    expect(await s.actionCount(sql('UPDATE Commandes INNER JOIN Clients ON Commandes.Client = Clients.[N°] SET Montant = 1 WHERE Ville = "Lyon"'), {})).toEqual({ count: 4, table: 'Commandes' });
    expect((await rows(s, 'Commandes')).map((r) => r[2])).toEqual([10.1, 0.1, 0.2, 99.99, 0.1]); // nothing written
  }), 60_000);
  // C7 R15: crosstabs on the migrated sales base, against the same query on the local base
  const VENTES = 'TRANSFORM Sum(Montant) SELECT Nom FROM Clients INNER JOIN Commandes ON Clients.[N°] = Commandes.Client GROUP BY Nom PIVOT Ville';
  /** Every cell by row name and heading folded without case (the headings' order and spelling are the server's). */
  const grid = (cols: string[], rows: SqlValue[][]) => rows.map((r) => Object.fromEntries(cols.map((c, k) => [c.toLowerCase(), typeof r[k] === 'number' ? Math.round(r[k] * 100) / 100 : r[k] === null ? null : Number(r[k]) || r[k]]))).sort((a, b) => String(a.nom).localeCompare(String(b.nom)));
  const crosstab = async (s: Session, text: string) => {
    const p = await s.pageSource({ kind: 'sql', sql: text }, { offset: 0, limit: 50 });
    return { cols: p.columns!, rows: p.rows };
  };

  it('QVentes on the server gives the local result', () => migrated(async (s) => {
    const dir = fs.realpathSync.native(fs.mkdtempSync(join(os.tmpdir(), 'bcloc-')));
    const path = join(dir, 'local.basecraft');
    createBaseFile(path, '0.0.0');
    const ldb = openBaseFile(path, 'write', '0.0.0').db;
    seedSales(ldb);
    seedSalesRelation(ldb);
    ldb.close();
    const local = Session.open(path, deps);
    try {
      const want = await crosstab(local, VENTES), got = await crosstab(s, VENTES);
      expect(got.cols.map((c) => c.toLowerCase()).sort()).toEqual(want.cols.map((c) => c.toLowerCase()).sort());
      expect(grid(got.cols, got.rows)).toEqual(grid(want.cols, want.rows));
      expect((await s.describeSource({ kind: 'sql', sql: VENTES })).fields.map((x) => x.name)).toEqual(got.cols);
    } finally {
      await local.close();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }), 60_000);

  it('Lyon and LYON are one heading, as Access: the column sums both', () => migrated(async (s) => {
    const { cols, rows } = await crosstab(s, VENTES);
    expect(cols.filter((c) => c.toLowerCase() === 'lyon')).toHaveLength(1);
    const lyon = cols.findIndex((c) => c.toLowerCase() === 'lyon');
    expect(rows.map((r) => Number(r[lyon] ?? 0)).reduce((a, b) => a + b, 0)).toBeCloseTo(10.1 + 0.1 + 0.2 + 0.1, 2); // Dupont's and Martin's orders
  }), 60_000);

  it('fixed IN headings and too many columns', () => migrated(async (s) => {
    const fixed = await crosstab(s, VENTES.replace('PIVOT Ville', 'PIVOT Ville IN ("Lyon", "Paris")'));
    expect(fixed.cols).toEqual(['Nom', 'Lyon', 'Paris']);
    // 512 Journal rows: 512 distinct [N°] to pivot on
    await s.runAction(sql('INSERT INTO Journal (Texte) SELECT Nom FROM Clients'), {}, OPTS);
    for (let k = 0; k < 7; k++) await s.runAction(sql('INSERT INTO Journal (Texte) SELECT Texte FROM Journal'), {}, OPTS);
    await expect(crosstab(s, 'TRANSFORM Count(Texte) SELECT Texte FROM Journal GROUP BY Texte PIVOT [N°]')).rejects.toThrow('bc:queryBind|tooManyColumns|513');
  }), 120_000);

});
