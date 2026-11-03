// Live migration tests (R19): a plan written through each connector's SchemaWriter on the throwaway servers; skipped without
// their URLs (describe.skipIf).
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { ServerKind } from '../../shared/api';
import type { SqlValue } from '../../shared/coerce';
import type { ImportProgress } from '../../shared/import-text';
import { localeInfo } from '../../shared/locale-format';
import type { MigrateRequest, MigrationReport } from '../../shared/migrate';
import { bindQuery } from '../../shared/query/bind';
import { parseSql } from '../../shared/query/sql-parser';
import { f, t } from '../../shared/test-fixtures';
import type { Connection, Credentials, RemoteTable } from '../connectors/connector';
import { CONNECTORS } from '../connectors/registry';
import { openPg } from '../connectors/postgres/driver';
import { liveParams, liveUrl, withSchema } from '../connectors/postgres/live';
import { msForeignKey } from '../connectors/sqlserver/ddl';
import { openMs } from '../connectors/sqlserver/driver';
import { mssqlLive, mssqlUrl, withDatabase } from '../connectors/sqlserver/live';
import { createBaseFile, openBaseFile } from '../db/file-format';
import type { RiskProbe } from '../db/location-risk';
import { saveRelation } from '../db/relations';
import { createTable, quoteIdent } from '../db/schema';
import { Session } from '../session';
import { seedSales, seedSalesRelation } from '../query/test-db';
import { migrationPlan, type ServerForeignKey, type ServerTable } from './plan';

let dir: string;
let file: string;
let db: DatabaseSync;
const sessions: Session[] = [];
beforeEach(() => {
  dir = fs.realpathSync.native(fs.mkdtempSync(join(os.tmpdir(), 'bcmigrate-')));
  file = join(dir, 'front.basecraft');
  createBaseFile(file, '0.0.0');
  db = openBaseFile(file, 'write', '0.0.0').db;
});
afterEach(async () => {
  for (const x of sessions.splice(0)) await x.close();
  if (db.isOpen) db.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

const probe: RiskProbe = { platform: 'win32', env: {}, homedir: 'C:\\Users\\x', windowsDriveType: () => 3 };
/** A session on `path` (the seeded front-end: `db` closed first) on the real connectors, the live login as its key's credential. */
function session(kind: ServerKind, params: unknown, login: Credentials, path = file): Session {
  if (db.isOpen) db.close();
  const x = Session.open(path, { appVersion: '0.0.0', region: 'fr-FR', probe, lockDeps: { now: () => 0 }, sessionId: `s${sessions.length}` });
  sessions.push(x);
  const c = CONNECTORS[kind]!;
  x.setCredential(c.key(c.params(params)), login.user, login.password);
  return x;
}
/** Every row of every table of the front-end file (links, relations, options included) and its schema. */
function snapshot(): unknown {
  const d = new DatabaseSync(file, { readOnly: true });
  try {
    const master = d.prepare('SELECT type, name, tbl_name, sql FROM sqlite_master ORDER BY type, name').all() as { type: string; name: string }[];
    return { master, rows: Object.fromEntries(master.filter((m) => m.type === 'table').map((m) => [m.name, d.prepare(`SELECT * FROM ${quoteIdent(m.name)}`).all()])) };
  } finally { d.close(); }
}
/** Each table's datasheet page (100 rows), by name. */
async function pagesOf(s: Session): Promise<Record<string, SqlValue[][]>> {
  const out: Record<string, SqlValue[][]> = {};
  for (const x of s.listTables()) out[x.name] = (await s.page(x.name, { offset: 0, limit: 100 })).rows.map((r) => r.values);
  return out;
}
/** Two Nulls in P.Code, a unique field the enforced relation PQ references (SQL Server's unfiltered rebuild refuses them). */
function seedOneNull(): void {
  createTable(db, t('P', [f('N°', 'autoNumber'), f('Code', 'shortText', { size: 5, indexed: 'yesNoDuplicates' })]));
  createTable(db, t('Q', [f('N°', 'autoNumber'), f('Code', 'shortText', { size: 5 })]));
  db.exec(`INSERT INTO "P" ("Code") VALUES (NULL), (NULL), ('X')`);
  const r = saveRelation(db, { name: 'PQ', parentTable: 'P', parentFields: ['Code'], childTable: 'Q', childFields: ['Code'], enforce: true, cascadeUpdate: false,
    cascadeDelete: false, joinType: 1 }, null, localeInfo('fr-FR'));
  if (!r.ok) throw new Error(r.reason);
}

const LONG = `${'x'.repeat(1 << 20)}終`; // 1 MB of Long Text
const NAME = 'Nom "l\'été" °'; // a field name with quotes, an apostrophe, a degree sign and spaces
/** Review Focus 1's values, a Null in every type, and literal defaults with a quote, a backslash and non-Latin text. */
function seedEdges(): void {
  createTable(db, t('Arêtes "1"', [f('N°', 'autoNumber'), f(NAME, 'shortText', { size: 5 }), f('Texte', 'longText'), f('Déc', 'number', { numberSize: 'decimal', precision: 28, scale: 10 }),
    f('Montant', 'currency'), f('Le', 'dateTime', { defaultValue: '#2026-01-02 03:04:05#' }), f('Qte', 'number', { numberSize: 'byte' }), f('Ok', 'yesNo', { defaultValue: 'True' }),
    f('Lien', 'hyperlink'), f('Simple', 'number', { numberSize: 'single' }), f('Double', 'number', { numberSize: 'double', defaultValue: '-2.5' }),
    f('Entier', 'number', { numberSize: 'integer' }), f('Code', 'shortText', { size: 10, indexed: 'yesNoDuplicates' }),
    f('Défaut', 'shortText', { size: 40, defaultValue: '"O\'Brien \\ 東京 ""q"""' })]));
  const ins = db.prepare(`INSERT INTO ${quoteIdent('Arêtes "1"')} (${[NAME, 'Texte', 'Déc', 'Montant', 'Le', 'Qte', 'Ok', 'Lien', 'Simple', 'Double', 'Entier', 'Code', 'Défaut'].map(quoteIdent).join(', ')})
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  ins.run('😀😀😀😀😀', 'l\'a \\ "b" 日本語', '123456789012345678.1234567890', 922337203685477.5807, '0100-01-01 00:00:00', 255, 1, 'https://x.example/#a',
    1.1, -2.5e-10, -32768, 'A', 'É\'\\');
  ins.run(null, null, null, null, null, null, 0, null, null, null, null, null, null);
  ins.run('ab', LONG, '-0.0000000001', -922337203685477.5807, '9999-12-31 23:59:59', 0, 0, null, -3.4e38, 1.7976931348623157e308, 32767, 'B', null);
}

/** The local rows of `st` in rowid order, values in its field order (stored form). */
const localRows = (st: ServerTable): SqlValue[][] =>
  (db.prepare(`SELECT ${st.fields.map((x) => quoteIdent(x.name)).join(', ')} FROM ${quoteIdent(st.name)} ORDER BY rowid`).all() as Record<string, SqlValue>[])
    .map((r) => st.fields.map((x) => r[x.name]!));

/** Every row of `rt` in key order, decoded with the local props of `st` (R11's overlay, Task 4). */
async function serverRows(c: Connection, rt: RemoteTable, st: ServerTable): Promise<SqlValue[][]> {
  const asLocal: RemoteTable = { ...rt, design: { name: rt.name, fields: st.fields.map((x) => ({ name: x.name, props: x.props })) } };
  const query = bindQuery(parseSql(`SELECT * FROM [${rt.name}]`), { table: () => asLocal.design, query: () => null, sourceOf: () => 'srv' });
  return (await c.rows(c.plan({ query, values: {}, filter: [], sort: [], refs: false, tables: () => asLocal, now: new Date() }), 0, 100)).rows;
}

describe.skipIf(!liveUrl)('migration to PostgreSQL (live)', () => {
  /** `fn` with BaseCraft's connection and a fresh schema. */
  const withPg = (fn: (c: Connection, schema: string) => Promise<void>) => withSchema(async (_admin, schema) => {
    const { params, login } = liveParams();
    const c = await openPg(params, login);
    try { await fn(c, schema); } finally { await c.close(); }
  });

  it('PostgreSQL: a plan written in one transaction reads back as linkable tables', async () => {
    seedSales(db);
    seedSalesRelation(db);
    db.exec('DELETE FROM "Clients" WHERE "N°" = 4'); // a number deleted before the migration is never given again
    seedEdges();
    await withPg(async (c, schema) => {
      const w = c.schema!;
      expect(w.limits).toEqual({ nameMax: 63, unit: 'utf8', params: 65535 });
      expect(await w.names(schema)).toEqual([]);
      expect(await w.names('nope')).toBeNull();
      const plan = migrationPlan(db, schema, w.limits, []);
      const commandesEntry = plan.tables.find((x) => x.name === 'Commandes')!;
      const fks = plan.foreignKeys.map((x) => ({ ...x, onDelete: 'cascade' as const }));
      await c.transaction(async () => {
        for (const st of plan.tables) {
          await w.createTable(st);
          const rows = localRows(st);
          for (let i = 0; i < rows.length; i += 3) await w.insertRows(st, rows.slice(i, i + 3)); // Commandes: 2 pages
          await w.finishTable(st);
          expect(await w.countRows(st)).toBe(st.rows);
        }
        expect(await w.addForeignKeys(fks)).toEqual(fks);
      });
      const read = async (name: string) => (await c.table({ schema, remote: name, name }))!;
      const [clients, commandes, edges] = [await read('Clients'), await read('Commandes'), await read('Arêtes "1"')];
      for (const rt of [clients, commandes, edges]) expect([rt.key, rt.unsupported, rt.skipped]).toEqual([['N°'], undefined, []]);
      expect(clients.design.fields[0]!.props.type).toBe('autoNumber');
      expect(commandes.design.fields.find((x) => x.name === 'Montant')!.props).toMatchObject({ type: 'number', numberSize: 'decimal', precision: 19, scale: 4 });
      expect(commandesEntry.fields.find((x) => x.name === 'Montant')!.props.type).toBe('currency'); // the local props
      expect(edges.design.fields.find((x) => x.name === 'Qte')!.props).toMatchObject({ type: 'number', numberSize: 'integer' });
      expect(await w.countRows(commandesEntry)).toBe(5);

      for (const st of plan.tables) expect(await serverRows(c, await read(st.name), st)).toEqual(localRows(st));
      // the identity goes on after the local sequence; the server fills the literal defaults
      expect((await c.insert(clients, { Nom: 'Neuf' }) as { values: SqlValue[] }).values[0]).toBe(5);
      const e = (await c.insert(edges, { Code: 'C' }) as { values: SqlValue[] }).values;
      expect(Object.fromEntries(edges.design.fields.map((x, i) => [x.name, e[i]]))).toMatchObject({ 'N°': 4, Le: '2026-01-02 03:04:05', Ok: 1, Double: -2.5, Défaut: 'O\'Brien \\ 東京 "q"' });
      // the foreign key cascades the parent's delete
      const [one] = await c.find(clients, { 'N°': 1 }, 1, false);
      expect(await c.delete(clients, [one!.ref!])).toEqual({ ok: true, count: 1 });
      expect(await w.countRows(commandesEntry)).toBe(3);
      await expect(c.insert(commandes, { Client: 99, Montant: 1 })).resolves.toMatchObject({ ok: false, errors: [{ field: 'Client', code: 'noParent' }] });

      const names = await w.names(schema);
      expect(names).toEqual(expect.arrayContaining(['Clients', 'Commandes', 'Arêtes "1"', 'Arêtes "1"_Code', fks[0]!.name]));
      // outside a transaction: every table dropped (a missing one too), foreign keys with them
      expect(await w.dropTables([...plan.tables, { ...plan.tables[0]!, name: 'Absente' }])).toEqual([]);
      expect(await w.names(schema)).toEqual([]);
    });
  }, 60_000);

  it('PostgreSQL: a failure inside the transaction leaves no table', async () => {
    await withPg(async (c, schema) => {
      const w = c.schema!;
      const st: ServerTable = { name: 'U', schema, rows: 2, nextId: 3, key: ['N°'], fields: [{ name: 'N°', props: f('N°', 'autoNumber').props }, { name: 'Ville', props: f('Ville', 'shortText').props }],
        indexes: [{ name: 'U_Ville', fields: [{ name: 'Ville', desc: false }], unique: true }] };
      await expect(c.transaction(async () => {
        await w.createTable(st);
        await w.insertRows(st, [[1, 'Lyon'], [2, 'Lyon']]);
        await w.finishTable(st); // the unique index finds the duplicate
      })).rejects.toThrow(/^bc:serverError\|23505\|/);
      expect(await w.names(schema)).toEqual([]);
      await c.transaction(async () => { await w.createTable(st); }); // the connection goes on
      expect(await w.names(schema)).toEqual(expect.arrayContaining(['U']));
    });
  });

  it('PostgreSQL: a foreign key the rows refuse fails naming its child table', async () => {
    seedSales(db);
    seedSalesRelation(db);
    await withPg(async (c, schema) => {
      const w = c.schema!;
      const plan = migrationPlan(db, schema, w.limits, []);
      const err = await c.transaction(async () => {
        for (const st of plan.tables) await w.createTable(st);
        const commandes = plan.tables.find((x) => x.name === 'Commandes')!;
        await w.insertRows(commandes, localRows(commandes)); // their Clients never copied: orphans
        await w.addForeignKeys(plan.foreignKeys);
      }).catch((e: unknown) => e);
      expect(err).toMatchObject({ message: expect.stringMatching(/^bc:serverError\|23503\|/), table: 'Commandes' });
      expect(await w.names(schema)).toEqual([]);
    });
  });

  it('PostgreSQL: a same-name domain or composite type counts as a taken name', async () => {
    await withSchema(async (admin, schema) => {
      await admin.query(`CREATE DOMAIN "${schema}"."Dom" AS integer`);
      await admin.query(`CREATE TYPE "${schema}"."Comp" AS (a integer)`);
      const { params, login } = liveParams();
      const c = await openPg(params, login);
      try { expect(await c.schema!.names(schema)).toEqual(expect.arrayContaining(['Dom', 'Comp'])); } finally { await c.close(); }
    });
  });
});

describe.skipIf(!mssqlUrl)('migration to SQL Server (live)', () => {
  /** `fn` with BaseCraft's connection to a fresh database (its dbo schema) and an admin connection to it. */
  const withMs = (fn: (c: Connection, admin: { query(sql: string): Promise<unknown[][]> }) => Promise<void>, o: { collation?: string } = {}) => withDatabase(async (admin, database) => {
    const { params, login } = mssqlLive();
    const c = await openMs({ ...params, database }, login);
    try { await fn(c, admin); } finally { await c.close(); }
  }, o);
  const st = (name: string, fields: ServerTable['fields'], o: Partial<ServerTable> = {}): ServerTable =>
    ({ name, schema: 'dbo', rows: 0, nextId: 1, key: ['id'], indexes: [], fields: [{ name: 'id', props: f('id', 'autoNumber').props }, ...fields], ...o });
  const num = (name: string) => ({ name, props: f(name, 'number').props });
  const short = (name: string) => ({ name, props: f(name, 'shortText', { size: 5 }).props });

  it('SQL Server: a plan reads back with its rowversion as the link version, money as Currency, tinyint as Byte', async () => {
    seedSales(db);
    seedSalesRelation(db);
    db.exec('DELETE FROM "Clients" WHERE "N°" = 4'); // a number deleted before the migration is never given again
    seedEdges();
    // nvarchar(n) counts UTF-16 units (an emoji takes two: tested below) and money stops at ±922 337 203 685 477.5807, which a
    // Currency stored as a double exceeds (its nearest double is …477.625): values the server holds
    db.prepare(`UPDATE ${quoteIdent('Arêtes "1"')} SET ${quoteIdent(NAME)} = '😀😀a', "Montant" = 922337203685477.5 WHERE "N°" = 1`).run();
    db.prepare(`UPDATE ${quoteIdent('Arêtes "1"')} SET "Montant" = -922337203685477.5 WHERE "N°" = 3`).run();
    await withMs(async (c) => {
      const w = c.schema!;
      expect(w.limits).toEqual({ nameMax: 128, unit: 'utf16', params: 2000 });
      const base = (await w.names('dbo'))!; // a new database's dbo holds system objects (Service Broker queues): taken names too
      expect(base).not.toContain('Clients');
      expect(await w.names('nope')).toBeNull();
      const plan = migrationPlan(db, 'dbo', w.limits, []);
      const commandesEntry = plan.tables.find((x) => x.name === 'Commandes')!;
      const fks = plan.foreignKeys.map((x) => ({ ...x, onDelete: 'cascade' as const }));
      await c.transaction(async () => {
        for (const st of plan.tables) {
          await w.createTable(st);
          const rows = localRows(st);
          for (let i = 0; i < rows.length; i += 3) await w.insertRows(st, rows.slice(i, i + 3)); // Commandes: 2 pages
          await w.finishTable(st);
          expect(await w.countRows(st)).toBe(st.rows);
        }
        expect(await w.addForeignKeys(fks)).toEqual(fks);
      });
      const read = async (name: string) => (await c.table({ schema: 'dbo', remote: name, name }))!;
      const [clients, commandes, edges] = [await read('Clients'), await read('Commandes'), await read('Arêtes "1"')];
      for (const rt of [clients, commandes, edges]) expect([rt.key, rt.unsupported, rt.skipped, rt.version]).toEqual([['N°'], undefined, [], 'bc_rowversion']);
      expect(clients.design.fields[0]!.props.type).toBe('autoNumber');
      expect(commandes.design.fields.find((x) => x.name === 'Montant')!.props.type).toBe('currency');
      expect(edges.design.fields.find((x) => x.name === 'Qte')!.props).toMatchObject({ type: 'number', numberSize: 'byte' });
      expect(edges.design.fields.find((x) => x.name === NAME)!.props).toMatchObject({ type: 'shortText', size: 5 });
      expect(edges.design.fields.find((x) => x.name === 'Déc')!.props).toMatchObject({ type: 'number', numberSize: 'decimal', precision: 28, scale: 10 });
      expect(edges.design.fields.find((x) => x.name === 'Texte')!.props.type).toBe('longText');

      for (const st of plan.tables) expect(await serverRows(c, await read(st.name), st)).toEqual(localRows(st));
      // the identity goes on after the local sequence; the server fills the literal defaults
      expect((await c.insert(clients, { Nom: 'Neuf' }) as { values: SqlValue[] }).values[0]).toBe(5);
      const e = (await c.insert(edges, { Code: 'C' }) as { values: SqlValue[] }).values;
      expect(Object.fromEntries(edges.design.fields.map((x, i) => [x.name, e[i]]))).toMatchObject({ 'N°': 4, Le: '2026-01-02 03:04:05', Ok: 1, Double: -2.5, Défaut: 'O\'Brien \\ 東京 "q"' });
      // the foreign key cascades the parent's delete
      const [one] = await c.find(clients, { 'N°': 1 }, 1, false);
      expect(await c.delete(clients, [one!.ref!])).toEqual({ ok: true, count: 1 });
      expect(await w.countRows(commandesEntry)).toBe(3);
      await expect(c.insert(commandes, { Client: 99, Montant: 1 })).resolves.toMatchObject({ ok: false, errors: [{ field: 'Client', code: 'noParent' }] });

      expect(await w.names('dbo')).toEqual(expect.arrayContaining(['Clients', 'Commandes', 'Arêtes "1"', 'Arêtes "1"_Code', fks[0]!.name]));
      // outside a transaction: every table dropped (a missing one too), foreign keys with them
      expect(await w.dropTables([...plan.tables, { ...plan.tables[0]!, name: 'Absente' }])).toEqual([]);
      expect(await w.names('dbo')).toEqual(base);
    });
  }, 60_000);

  it('SQL Server: never error 1785; the downgraded relations come back from addForeignKeys', async () => {
    await withMs(async (c, admin) => {
      const w = c.schema!;
      const base = await w.names('dbo');
      // the four-table diamond, a self-reference; a foreign key to a unique field holding a Null (its filtered index rebuilt)
      const tables = [st('A', [], { nextId: 7 }), st('B', [num('a')]), st('C', [num('a')]), st('D', [num('b'), num('c')]), st('E', [num('p')]),
        st('P', [short('Code')], { rows: 2, nextId: 3, indexes: [{ name: 'P_Code', fields: [{ name: 'Code', desc: false }], unique: true }] }), st('Q', [short('Code')])];
      const fk = (child: string, field: string, parent: string, parentField = 'id'): ServerForeignKey => ({ name: `${parent}${child}${field}`, relation: `${parent}${child}`,
        schema: 'dbo', child, childFields: [field], parent, parentFields: [parentField], onDelete: 'cascade', onUpdate: 'cascade' });
      const fks = [fk('B', 'a', 'A'), fk('C', 'a', 'A'), fk('D', 'b', 'B'), fk('D', 'c', 'C'), fk('E', 'p', 'E'), fk('Q', 'Code', 'P', 'Code')];
      const none = { onDelete: 'noAction', onUpdate: 'noAction' } as const;
      let made: ServerForeignKey[] = [];
      await c.transaction(async () => {
        for (const x of tables) {
          await w.createTable(x);
          if (x.name === 'P') await w.insertRows(x, [[1, null], [2, 'X']]);
          await w.finishTable(x);
        }
        made = await w.addForeignKeys(fks);
      });
      expect(made).toEqual([fks[0], fks[1], fks[2], { ...fks[3], ...none }, { ...fks[4], ...none }, fks[5]]);
      expect(await admin.query('SELECT name, delete_referential_action_desc, update_referential_action_desc FROM sys.foreign_keys ORDER BY name')).toEqual([
        ['ABa', 'CASCADE', 'CASCADE'], ['ACa', 'CASCADE', 'CASCADE'], ['BDb', 'CASCADE', 'CASCADE'], ['CDc', 'NO_ACTION', 'NO_ACTION'],
        ['EEp', 'NO_ACTION', 'NO_ACTION'], ['PQCode', 'CASCADE', 'CASCADE']]);
      // the downgrade was needed: the cascading C→D is SQL Server's 1785
      await expect(c.native!(msForeignKey({ ...fks[3]!, name: 'CDc2' }))).rejects.toThrow(/^bc:serverError\|1785\|/);
      // an empty table's identity starts at its nextId
      expect((await c.insert((await c.table({ schema: 'dbo', remote: 'A', name: 'A' }))!, {}) as { values: SqlValue[] }).values).toEqual([7]);
      expect(await w.dropTables(tables)).toEqual([]);
      expect(await w.names('dbo')).toEqual(base);
    });
  }, 60_000);

  it('SQL Server: a rolled back transaction leaves no filtered index for the next one to rebuild', async () => {
    await withMs(async (c) => {
      const w = c.schema!;
      const p = st('P', [short('Code')], { indexes: [{ name: 'P_Code', fields: [{ name: 'Code', desc: false }], unique: true }] });
      await expect(c.transaction(async () => { await w.createTable(p); await w.finishTable(p); throw new Error('stop'); })).rejects.toThrow('stop');
      // the same connection, P now keyed by Code (no index of its own): the foreign key references its primary key
      const keyed: ServerTable = { ...p, key: ['Code'], nextId: undefined, indexes: [], fields: [{ name: 'Code', props: f('Code', 'shortText', { size: 5, required: true }).props }] };
      const q = st('Q', [short('Code')]);
      const fk: ServerForeignKey = { name: 'PQ', relation: 'PQ', schema: 'dbo', child: 'Q', childFields: ['Code'], parent: 'P', parentFields: ['Code'], onDelete: 'noAction', onUpdate: 'noAction' };
      await c.transaction(async () => {
        for (const x of [keyed, q]) { await w.createTable(x); await w.finishTable(x); }
        expect(await w.addForeignKeys([fk])).toEqual([fk]);
      });
    });
  }, 60_000);

  it('SQL Server: a duplicate under the CI collation fails naming the field; an emoji at the nvarchar limit fails tooLong naming the field', async () => {
    await withMs(async (c) => {
      const w = c.schema!;
      const base = await w.names('dbo');
      const u = st('U', [short('Ville')], { rows: 2, nextId: 3, indexes: [{ name: 'U_Ville', fields: [{ name: 'Ville', desc: false }], unique: true }] });
      await expect(c.transaction(async () => {
        await w.createTable(u);
        await w.insertRows(u, [[1, 'Lyon'], [2, 'LYON']]);
        await w.finishTable(u); // the unique index finds the duplicate
      })).rejects.toMatchObject({ message: expect.stringMatching(/^bc:serverError\|1505\|/), field: 'Ville', code: 'duplicate' });
      expect(await w.names('dbo')).toEqual(base);
      // several Nulls in a unique field are no duplicate (Access's rule)
      await c.transaction(async () => {
        await w.createTable(u);
        await w.insertRows(u, [[1, null], [2, null]]);
        await w.finishTable(u);
        // a page at limits.params: 1 000 rows of two fields, 2 000 parameters in one request
        const m = st('M', [num('n')], { rows: 1000, nextId: 1001 });
        await w.createTable(m);
        await w.insertRows(m, Array.from({ length: 1000 }, (_, i) => [i + 1, i]));
        expect(await w.countRows(m)).toBe(1000);
      });
      // a filtered index is no key a foreign key can reference (1776): addForeignKeys rebuilds a referenced one (test above)
      await expect(c.native!('CREATE TABLE [dbo].[R] ([v] nvarchar(5) REFERENCES [dbo].[U] ([Ville]))')).rejects.toThrow(/^bc:serverError\|1776\|/);
      const tt = st('T', [short('Nom')], { rows: 1, nextId: 2 });
      await expect(c.transaction(async () => {
        await w.createTable(tt);
        await w.insertRows(tt, [[1, 'abcd😀']]); // five characters (the size), six UTF-16 units
      })).rejects.toMatchObject({ message: expect.stringMatching(/^bc:serverError\|2628\|/), field: 'Nom', code: 'tooLong' });
      expect(await w.names('dbo')).not.toContain('T');
    }, { collation: 'French_CI_AS' });
  }, 60_000);
});

describe.skipIf(!liveUrl)('the migration run to PostgreSQL (live)', () => {
  const req = (schema: string): MigrateRequest => ({ kind: 'postgresql', params: liveParams().params, schema });
  const count = async (admin: { query(sql: string, v: unknown[]): Promise<{ rows: { n: string }[] }> }, schema: string) =>
    Number((await admin.query('SELECT count(*) AS n FROM pg_class c JOIN pg_namespace s ON s.oid = c.relnamespace WHERE s.nspname = $1', [schema])).rows[0]!.n);

  it('PostgreSQL: the whole front-end moves; the links read the same pages; numbering goes on; a run from the backup is refused nameTaken', async () => {
    seedSales(db);
    seedSalesRelation(db);
    db.exec('DELETE FROM "Clients" WHERE "N°" = 4'); // a number deleted before the migration is never given again
    seedEdges();
    await withSchema(async (_admin, schema) => {
      const { params, login } = liveParams();
      const s = session('postgresql', params, login);
      const before = await pagesOf(s);
      const r = await s.migrateToServer(req(schema));
      expect(r).toMatchObject({ ok: true, report: { kind: 'postgresql', server: CONNECTORS.postgresql!.label(params), schema, queries: [],
        relations: [{ name: 'ClientsCommandes', result: 'created' }], indexes: [{ table: 'Arêtes "1"', name: 'Arêtes "1"_Code', unique: true }] } });
      const report = (r as { report: MigrationReport }).report;
      expect(report.tables).toEqual([{ name: 'Arêtes "1"', rows: 3, nextId: 4 }, { name: 'Clients', rows: 3, nextId: 5 }, { name: 'Commandes', rows: 5, nextId: 6 }]);
      expect(report.approximated).toEqual([{ table: 'Arêtes "1"', field: 'Montant', serverType: 'numeric(19,4)' }, { table: 'Arêtes "1"', field: 'Qte', serverType: 'smallint' },
        { table: 'Arêtes "1"', field: 'Lien', serverType: 'text' }, { table: 'Commandes', field: 'Montant', serverType: 'numeric(19,4)' }]);
      expect(s.listTables().every((x) => x.link?.kind === 'postgresql')).toBe(true);
      expect(await pagesOf(s)).toEqual(before); // Review Focus 1's values, read back through the links
      expect(await s.insert('Commandes', { Client: 1, Montant: 5 })).toMatchObject({ ok: true });
      expect((await s.page('Commandes', { offset: 5, limit: 1 })).rows[0]!.values[0]).toBe(6);
      expect(await s.insert('Commandes', { Client: 1, Montant: -1 })).toMatchObject({ ok: false }); // Montant's rule, from the link's meta
      const again = session('postgresql', params, login, report.backupPath);
      expect(await again.migrateToServer(req(schema))).toEqual({ ok: false, reason: 'nameTaken', names: ['Arêtes "1"', 'Clients', 'Commandes'] });
    });
  }, 120_000);

  it('PostgreSQL: a duplicate the server finds (1.5 and 1.50 in a unique Decimal) rolls everything back, naming the table', async () => {
    seedSales(db);
    createTable(db, t('Taux', [f('N°', 'autoNumber'), f('Taux', 'number', { numberSize: 'decimal', precision: 5, scale: 2, indexed: 'yesNoDuplicates' })]));
    db.exec(`INSERT INTO "Taux" ("Taux") VALUES ('1.5'), ('1.50')`); // two texts locally, one number on the server
    await withSchema(async (admin, schema) => {
      const { params, login } = liveParams();
      const s = session('postgresql', params, login);
      const before = snapshot();
      expect(await s.migrateToServer(req(schema))).toMatchObject({ ok: false, reason: 'failed', error: expect.stringMatching(/^bc:serverError\|23505\|/), table: 'Taux' });
      expect(snapshot()).toEqual(before);
      expect(await count(admin, schema)).toBe(0);
    });
  }, 60_000);

  it('PostgreSQL: a connection killed by the admin during the rows: failed, the schema empty, the front-end unchanged', async () => {
    seedSales(db);
    seedSalesRelation(db);
    await withSchema(async (admin, schema) => {
      const { params, login } = liveParams();
      const s = session('postgresql', params, login);
      const before = snapshot();
      const kill = async (p: ImportProgress) => {
        if (p.label === 'Commandes') await admin.query(`SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE application_name = 'BaseCraft' AND query LIKE '%' || $1 || '%'`, [schema]);
      };
      expect(await s.migrateToServer(req(schema), kill)).toMatchObject({ ok: false, reason: 'failed', error: `bc:linkUnavailable|cannotConnect|${CONNECTORS.postgresql!.label(params)}`, table: 'Commandes' });
      expect(snapshot()).toEqual(before);
      expect(await count(admin, schema)).toBe(0);
      expect(await s.migrateToServer(req(schema))).toMatchObject({ ok: true }); // a new run works without cleanup
    });
  }, 60_000);
});

describe.skipIf(!mssqlUrl)('the migration run to SQL Server (live)', () => {
  type Admin = { query(sql: string): Promise<unknown[][]> };
  const live = (database: string) => ({ params: { ...mssqlLive().params, database }, login: mssqlLive().login });
  const req = (database: string): MigrateRequest => ({ kind: 'sqlserver', params: live(database).params, schema: 'dbo' });
  const userTables = async (admin: Admin) => Number((await admin.query('SELECT count(*) FROM sys.tables WHERE is_ms_shipped = 0'))[0]![0]);
  /** KILL every BaseCraft session in this database (other test files run their own elsewhere at the same time). */
  const killBaseCraft = (admin: Admin) => admin.query(`DECLARE @sql nvarchar(max) = N'';
    SELECT @sql += N'KILL ' + CAST(session_id AS nvarchar(10)) + N'; ' FROM sys.dm_exec_sessions WHERE program_name = N'BaseCraft' AND database_id = DB_ID();
    EXEC(@sql)`);

  it('SQL Server: the whole front-end moves with its rowversion; the links read the same pages; numbering goes on; a run from the backup is refused', async () => {
    seedSales(db);
    seedSalesRelation(db);
    db.exec('DELETE FROM "Clients" WHERE "N°" = 4');
    seedEdges();
    // as the SchemaWriter test: nvarchar(n) counts UTF-16 units, money stops below the nearest double of Currency's maximum
    db.prepare(`UPDATE ${quoteIdent('Arêtes "1"')} SET ${quoteIdent(NAME)} = '😀😀a', "Montant" = 922337203685477.5 WHERE "N°" = 1`).run();
    db.prepare(`UPDATE ${quoteIdent('Arêtes "1"')} SET "Montant" = -922337203685477.5 WHERE "N°" = 3`).run();
    await withDatabase(async (admin, database) => {
      const { params, login } = live(database);
      const s = session('sqlserver', params, login);
      const before = await pagesOf(s);
      const r = await s.migrateToServer(req(database));
      expect(r).toMatchObject({ ok: true, report: { kind: 'sqlserver', schema: 'dbo', relations: [{ name: 'ClientsCommandes', result: 'created' }],
        approximated: [{ table: 'Arêtes "1"', field: 'Lien', serverType: 'nvarchar(max)' }] } });
      expect((r as { report: MigrationReport }).report.tables).toEqual([{ name: 'Arêtes "1"', rows: 3, nextId: 4, version: 'bc_rowversion' },
        { name: 'Clients', rows: 3, nextId: 5, version: 'bc_rowversion' }, { name: 'Commandes', rows: 5, nextId: 6, version: 'bc_rowversion' }]);
      expect(await pagesOf(s)).toEqual(before);
      expect(await s.insert('Commandes', { Client: 1, Montant: 5 })).toMatchObject({ ok: true });
      expect((await s.page('Commandes', { offset: 5, limit: 1 })).rows[0]!.values[0]).toBe(6);
      expect(await userTables(admin)).toBe(3);
      const again = session('sqlserver', params, login, (r as { report: MigrationReport }).report.backupPath);
      expect(await again.migrateToServer(req(database))).toEqual({ ok: false, reason: 'nameTaken', names: ['Arêtes "1"', 'Clients', 'Commandes'] });
    });
  }, 120_000);

  it('SQL Server: a duplicate under the CI collation (Lyon, LYON) rolls everything back, naming the table and the field', async () => {
    seedSales(db);
    createTable(db, t('Villes', [f('N°', 'autoNumber'), f('Ville', 'shortText', { size: 20, indexed: 'yesNoDuplicates' })]));
    db.exec(`INSERT INTO "Villes" ("Ville") VALUES ('Lyon'), ('LYON')`);
    await withDatabase(async (admin, database) => {
      const { params, login } = live(database);
      const s = session('sqlserver', params, login);
      const before = snapshot();
      expect(await s.migrateToServer(req(database))).toMatchObject({ ok: false, reason: 'failed', error: expect.stringMatching(/^bc:serverError\|1505\|/), table: 'Villes', field: 'Ville' });
      expect(snapshot()).toEqual(before);
      expect(await userTables(admin)).toBe(0);
    }, { collation: 'French_CI_AS' });
  }, 60_000);

  it('SQL Server: two Nulls in a unique field a relation references: the server allows one, the run says so', async () => {
    seedOneNull();
    await withDatabase(async (admin, database) => {
      const { params, login } = live(database);
      const s = session('sqlserver', params, login);
      const before = snapshot();
      expect(await s.migrateToServer(req(database))).toMatchObject({ ok: false, reason: 'failed', error: 'bc:migrateOneNull|P.Code|PQ', table: 'P', field: 'Code' });
      expect(snapshot()).toEqual(before);
      expect(await userTables(admin)).toBe(0);
    });
  }, 60_000);

  it('SQL Server: a connection killed by the admin during the rows: failed, nothing left, the front-end unchanged', async () => {
    seedSales(db);
    seedSalesRelation(db);
    await withDatabase(async (admin, database) => {
      const { params, login } = live(database);
      const s = session('sqlserver', params, login);
      const before = snapshot();
      const kill = async (p: ImportProgress) => { if (p.label === 'Commandes') await killBaseCraft(admin); };
      expect(await s.migrateToServer(req(database), kill)).toMatchObject({ ok: false, reason: 'failed', error: `bc:linkUnavailable|cannotConnect|${CONNECTORS.sqlserver!.label(params)}`, table: 'Commandes' });
      expect(snapshot()).toEqual(before);
      expect(await userTables(admin)).toBe(0);
      expect(await s.migrateToServer(req(database))).toMatchObject({ ok: true }); // a new run works without cleanup
    });
  }, 60_000);
});

// R17: import from a server. A server table with every mapped type and a Null in each, copied into a local table; a Stop (the
// progress callback rejecting bc:cancelled, as a cancelled statement does) leaves no table.
const stopAtB = async (p: ImportProgress) => { if (p.label === 'B') throw new Error('bc:cancelled'); };
const localRowsOf = (s: Session, name: string) => s.page(name, { offset: 0, limit: 100 }).then((p) => p.rows.map((r) => r.values));

describe.skipIf(!liveUrl)('import from PostgreSQL (live)', () => {
  it('PostgreSQL: every mapped type and a Null in each are copied identically; the identity key becomes AutoNumber; skipped columns are listed', async () => {
    await withSchema(async (admin, schema) => {
      await admin.query(`CREATE TABLE "Imp" (id integer GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY, t varchar(20), lt text, n numeric(28,10), c numeric(19,4), ts timestamp(0),
        d date, u uuid, b boolean, i2 smallint, i4 integer, i8 bigint, f4 real, f8 double precision, other bytea)`);
      await admin.query(`INSERT INTO "Imp" (id, t, lt, n, c, ts, d, u, b, i2, i4, i8, f4, f8, other) VALUES
        (3, 'l''a \\ "b" 日本語', 'texte', 123456789012345678.1234567890, 922337203685477.5807, '0100-01-01 00:00:00', '2026-01-02', '123e4567-e89b-12d3-a456-426614174000', true, -32768, 2147483647,
         9007199254740993, 1.1, -2.5e-10, '\\x00'),
        (1, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL),
        (2, '', 'x', -0.0000000001, -922337203685477.5807, '9999-12-31 23:59:59', '0001-01-01', NULL, false, 32767, -2147483648, -9223372036854775808, 3.4e38, 1.7976931348623157e308, NULL)`);
      const { params, login } = liveParams();
      const s = session('postgresql', params, login);
      const info = await s.inspectServer('postgresql', params, login.user, login.password);
      const name = info.tables.find((x) => x.schema === schema && x.remote === 'Imp')!.name;
      const r = await s.importServerTables('postgresql', params, [name]);
      expect(r).toEqual({ ok: true, tables: [{ name, remote: 'Imp', rows: 3, skipped: ['other'] }] });
      expect(s.listTables().find((x) => x.name === name)!.link).toBeUndefined();
      expect(s.tableDesign(name).fields.map((x) => [x.name, x.props.type, x.props.primaryKey])).toEqual([['id', 'autoNumber', true], ['t', 'shortText', false], ['lt', 'longText', false],
        ['n', 'number', false], ['c', 'number', false], ['ts', 'dateTime', false], ['d', 'dateTime', false], ['u', 'shortText', false], ['b', 'yesNo', false], ['i2', 'number', false],
        ['i4', 'number', false], ['i8', 'number', false], ['f4', 'number', false], ['f8', 'number', false]]);
      expect(await localRowsOf(s, name)).toEqual([
        [1, null, null, null, null, null, null, null, 0, null, null, null, null, null], // Yes/No has no Null locally: No
        [2, '', 'x', '-0.0000000001', '-922337203685477.5807', '9999-12-31 23:59:59', null /* 0001-01-01: before 0100, the connector's Null */, null, 0, 32767, -2147483648, '-9223372036854775808', 3.4e38, 1.7976931348623157e308],
        [3, 'l\'a \\ "b" 日本語', 'texte', '123456789012345678.1234567890', '922337203685477.5807', '0100-01-01 00:00:00', '2026-01-02 00:00:00', '123e4567-e89b-12d3-a456-426614174000', 1,
          -32768, 2147483647, '9007199254740993', 1.1, -2.5e-10]]);
      expect(await s.insert(name, { t: 'Neuf' })).toMatchObject({ ok: true }); // the numbering goes on after the highest imported id
      expect((await localRowsOf(s, name)).map((x) => x[0])).toEqual([1, 2, 3, 4]);
    });
  }, 60_000);

  it('PostgreSQL: a Stop between tables leaves no table, the front-end unchanged', async () => {
    await withSchema(async (admin, schema) => {
      await admin.query(`CREATE TABLE "A" (id integer PRIMARY KEY, v text); INSERT INTO "A" VALUES (1, 'a'); CREATE TABLE "B" (id integer PRIMARY KEY); INSERT INTO "B" VALUES (1)`);
      const { params, login } = liveParams();
      const s = session('postgresql', params, login);
      const info = await s.inspectServer('postgresql', params, login.user, login.password);
      const names = ['A', 'B'].map((n) => info.tables.find((x) => x.schema === schema && x.remote === n)!.name);
      const before = snapshot();
      expect(await s.importServerTables('postgresql', params, names, async (p) => stopAtB({ ...p, label: p.label === names[1] ? 'B' : p.label }))).toEqual({ ok: false, reason: 'cancelled' });
      expect(snapshot()).toEqual(before);
      expect(await s.importServerTables('postgresql', params, names)).toMatchObject({ ok: true }); // a new run works
    });
  }, 60_000);
});

describe.skipIf(!mssqlUrl)('import from SQL Server (live)', () => {
  const live = (database: string) => ({ params: { ...mssqlLive().params, database }, login: mssqlLive().login });

  it('SQL Server: money, datetime2(7), a rowversion that is no field, and a Null in each are copied identically', async () => {
    await withDatabase(async (admin, database) => {
      await admin.query(`CREATE TABLE dbo.Imp (id int IDENTITY(1,1) PRIMARY KEY, t nvarchar(20), lt nvarchar(max), n decimal(28,10), m money, dt datetime2(7), d date, b bit, ti tinyint,
        si smallint, i int, bi bigint, f real, fl float, u uniqueidentifier, rv rowversion)`);
      await admin.query(`SET IDENTITY_INSERT dbo.Imp ON;
        INSERT INTO dbo.Imp (id, t, lt, n, m, dt, d, b, ti, si, i, bi, f, fl, u) VALUES
        (3, N'l''a \\ "b" 日本語', N'texte', 123456789012345678.1234567890, 922337203685477.5807, '9999-12-31 23:59:59.1234567', '2026-01-02', 1, 255, -32768, 2147483647,
         9007199254740993, 1.1, -2.5e-10, '123E4567-E89B-12D3-A456-426614174000'),
        (1, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL),
        (2, N'', N'x', -0.0000000001, -922337203685477.5, '0100-01-01 00:00:00', '0100-01-01', 0, 0, 32767, -2147483648, -9223372036854775808, 3.4e38, 1.7976931348623157e308, NULL);
        SET IDENTITY_INSERT dbo.Imp OFF`);
      const { params, login } = live(database);
      const s = session('sqlserver', params, login);
      const r = await s.importServerTables('sqlserver', params, ['Imp']);
      expect(r).toEqual({ ok: true, tables: [{ name: 'Imp', remote: 'Imp', rows: 3, skipped: [] }] });
      expect(s.listTables().find((x) => x.name === 'Imp')!.link).toBeUndefined();
      expect(s.tableDesign('Imp').fields.map((x) => [x.name, x.props.type])).toEqual([['id', 'autoNumber'], ['t', 'shortText'], ['lt', 'longText'], ['n', 'number'], ['m', 'currency'],
        ['dt', 'dateTime'], ['d', 'dateTime'], ['b', 'yesNo'], ['ti', 'number'], ['si', 'number'], ['i', 'number'], ['bi', 'number'], ['f', 'number'], ['fl', 'number'], ['u', 'shortText']]);
      expect(await localRowsOf(s, 'Imp')).toEqual([
        [1, null, null, null, null, null, null, 0, null, null, null, null, null, null, null], // Yes/No has no Null locally: No
        [2, '', 'x', '-0.0000000001', -922337203685477.5, '0100-01-01 00:00:00', '0100-01-01 00:00:00', 0, 0, 32767, -2147483648, '-9223372036854775808', 3.4e38, 1.7976931348623157e308, null],
        [3, 'l\'a \\ "b" 日本語', 'texte', '123456789012345678.1234567890', 922337203685477.5807, '9999-12-31 23:59:59', '2026-01-02 00:00:00', 1, 255, -32768, 2147483647, '9007199254740993', 1.1, -2.5e-10,
          '123E4567-E89B-12D3-A456-426614174000']]);
      expect(await s.insert('Imp', { t: 'Neuf' })).toMatchObject({ ok: true });
      expect((await localRowsOf(s, 'Imp')).map((x) => x[0])).toEqual([1, 2, 3, 4]);
    });
  }, 60_000);

  it('SQL Server: a Stop between tables leaves no table, the front-end unchanged', async () => {
    await withDatabase(async (admin, database) => {
      await admin.query(`CREATE TABLE dbo.A (id int PRIMARY KEY, v nvarchar(max)); INSERT INTO dbo.A VALUES (1, N'a'); CREATE TABLE dbo.B (id int PRIMARY KEY); INSERT INTO dbo.B VALUES (1)`);
      const { params, login } = live(database);
      const s = session('sqlserver', params, login);
      const before = snapshot();
      expect(await s.importServerTables('sqlserver', params, ['A', 'B'], stopAtB)).toEqual({ ok: false, reason: 'cancelled' });
      expect(snapshot()).toEqual(before);
      expect(await s.importServerTables('sqlserver', params, ['A', 'B'])).toMatchObject({ ok: true });
    });
  }, 60_000);
});
