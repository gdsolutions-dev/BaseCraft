import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import { join } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { createBaseFile, openBaseFile } from '../db/file-format';
import type { RiskProbe } from '../db/location-risk';
import { addServerLinks, linkRows, setLinkDescription, sourceRows } from '../links/store';
import { Session, type SessionDeps } from '../session';
import type { BoundQuery } from '../../shared/query/bind';
import { f, t } from '../../shared/test-fixtures';
import type { RemoteTable } from './connector';
import { testConnector } from './test-connector';

// A front-end with server links (C4 R6) on the fake connector, registered as `postgresql`.
const P = { host: 'db.example', port: 5432, database: 'ventes', user: 'ana', tls: 'verify-full', timeout: 60 };
const clients: RemoteTable = {
  name: 'Clients', remote: 'Clients', schema: 'public', key: ['id'], skipped: [],
  design: t('Clients', [f('id', 'number', { numberSize: 'longInteger' }), f('Nom', 'shortText'), f('Ville', 'shortText')]),
};
const commandes: RemoteTable = { ...clients, name: 'Commandes', remote: 'Commandes', design: t('Commandes', [f('id', 'number')]) };
const probe: RiskProbe = { platform: 'win32', env: {}, homedir: 'C:\\Users\\x', windowsDriveType: () => 3 };
const deps: SessionDeps = { appVersion: '0.0.0', region: 'fr-FR', probe, lockDeps: { now: () => 0 }, sessionId: 'a' };
const raw = (db: DatabaseSync, sql: string): unknown => Object.values(db.prepare(sql).get() as object)[0];

let dir: string;
let fe: string;
let front: DatabaseSync;
let fake: ReturnType<typeof testConnector>;
const opened: Session[] = [];
const open = (d: Partial<SessionDeps>) => { front.close(); const s = Session.open(fe, { ...deps, ...d }); opened.push(s); return s; };
beforeEach(() => {
  dir = fs.realpathSync.native(fs.mkdtempSync(join(os.tmpdir(), 'bcserver-')));
  fe = join(dir, 'front.basecraft');
  createBaseFile(fe, '0.0.0');
  front = openBaseFile(fe, 'write', '0.0.0').db;
  fake = testConnector({ tables: [clients], rows: { Clients: [[1, 'Dupont', 'Lyon'], [2, 'Martin', 'Brest']] } });
});
afterEach(() => {
  for (const s of opened.splice(0)) s.close();
  if (front.isOpen) front.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('server sources in the front-end', () => {
  it('a server source keeps its params without any password, links cache their design', () => {
    addServerLinks(front, 'postgresql', { ...P, password: 'x' }, [clients]);
    expect(JSON.parse(raw(front, 'SELECT props FROM bc_sources') as string)).toEqual(P);
    expect(raw(front, 'SELECT props FROM bc_sources')).not.toMatch(/password/i);
    expect(sourceRows(front)[0]).toMatchObject({ kind: 'postgresql', params: P });
    expect(linkRows(front)[0]).toMatchObject({ name: 'Clients', remote: 'Clients', server: { schema: 'public', key: ['id'], fields: clients.design.fields, skipped: [] } });
  });

  it('two links to one server share one source', () => {
    addServerLinks(front, 'postgresql', P, [clients]);
    addServerLinks(front, 'postgresql', { ...P, password: 'y' }, [commandes]);
    expect(sourceRows(front)).toHaveLength(1);
    addServerLinks(front, 'postgresql', { ...P, database: 'autre' }, [{ ...clients, name: 'Clients2' }]);
    expect(sourceRows(front)).toHaveLength(2);
  });

  it('a description set on a server link keeps its cached design', () => {
    addServerLinks(front, 'postgresql', P, [clients]);
    setLinkDescription(front, 'Clients', 'Fichier clients');
    expect(linkRows(front)[0]).toMatchObject({ description: 'Fichier clients', server: { fields: clients.design.fields } });
  });

  it('listTables and listLinks show a server link without connecting', () => {
    addServerLinks(front, 'postgresql', P, [clients]);
    const sourceId = sourceRows(front)[0]!.id;
    const s = open({ connectors: { postgresql: fake } });
    expect(s.listTables().find((x) => x.name === 'Clients')?.link).toEqual({ kind: 'postgresql', path: 'db.example:5432/ventes' });
    expect(s.listLinks()).toEqual([{ name: 'Clients', sourceId, kind: 'postgresql', path: 'db.example:5432/ventes', state: 'ok', params: P }]); // no location risk: a server's
    expect(s.tableDesign('Clients')).toEqual({ name: 'Clients', fields: clients.design.fields });
    expect(fake.connections).toBe(0);
  });

  it('a server kind the registry lacks is unsupportedKind', () => {
    addServerLinks(front, 'postgresql', P, [clients]);
    const s = open({ connectors: {} });
    expect(s.listLinks()[0]).toMatchObject({ kind: 'postgresql', path: '', state: 'unsupportedKind' });
    expect(s.tableDesign('Clients').fields).toEqual(clients.design.fields);
  });

  it('a server link whose cached design is damaged is unsupportedKind', () => {
    addServerLinks(front, 'postgresql', P, [clients]);
    front.exec(`UPDATE bc_links SET props = '{"key":["id"],"fields":[{"name":1}]}'`);
    expect(linkRows(front)[0]!.server).toBeUndefined();
    const s = open({ connectors: { postgresql: fake } });
    expect(s.listLinks()[0]).toMatchObject({ path: 'db.example:5432/ventes', state: 'unsupportedKind' });
  });

  it('cached field props are checked as stored metadata is: one unusable field is a damaged design', () => {
    addServerLinks(front, 'postgresql', P, [clients]);
    const id = sourceRows(front)[0]!.id;
    const bad = (props: object) => JSON.stringify({ key: [], fields: [{ name: 'id', props }] });
    front.exec(`INSERT INTO bc_links (name, source_id, remote_name, props) VALUES ('Vide', '${id}', 'vide', '${bad({})}'),
      ('Faux', '${id}', 'faux', '${bad({ ...clients.design.fields[0]!.props, type: 'bogus' })}'),
      ('Rogne', '${id}', 'rogne', '${bad({ ...clients.design.fields[1]!.props, format: 3 })}')`);
    const s = open({ connectors: { postgresql: fake } });
    expect(s.listLinks().map((l) => [l.name, l.state])).toEqual([['Clients', 'ok'], ['Faux', 'unsupportedKind'], ['Rogne', 'ok'], ['Vide', 'unsupportedKind']]);
    expect(() => s.tableDesign('Vide')).toThrow('bc:linkUnavailable|unsupportedKind|');
    expect(s.tableDesign('Rogne').fields).toEqual([{ name: 'id', props: clients.design.fields[1]!.props }]); // an invalid optional key dropped, as stored metadata
  });
});

describe('the test connector', () => {
  it('params, key and label follow PostgreSQL\'s rules', () => {
    expect(fake.params({ host: 'DB.example', database: 'ventes', user: 'ana' })).toEqual({ host: 'db.example', port: 5432, database: 'ventes', user: 'ana', tls: 'verify-full', timeout: 60 });
    expect(fake.key(fake.params(P))).toBe('postgresql://db.example:5432/ventes?tls=verify-full');
    // the TLS mode is part of the key (controller ruling, Task 5 review): a remembered password never goes to a weaker mode
    expect(fake.key(fake.params({ ...P, tls: 'disable' }))).toBe('postgresql://db.example:5432/ventes?tls=disable');
    expect(fake.key(fake.params({ ...P, user: 'bob' }))).toBe('postgresql://db.example:5432/ventes?tls=verify-full'); // R10: never the user
    expect(fake.label(fake.params({ ...P, host: 'DB.example' }))).toBe('db.example:5432/ventes'); // the host lower-cased (Task 9 review)
    for (const bad of [null, { ...P, host: '' }, { ...P, port: 0 }, { ...P, tls: 'x' }, { ...P, timeout: 3601 }]) expect(() => fake.params(bad)).toThrow('bc:invalidArgument');
  });

  it('a wrong password is needsLogin; refs carry the key texts and a version that moves on update', async () => {
    await expect(fake.open(fake.params(P), { user: 'ana', password: 'x' })).rejects.toThrow('bc:linkUnavailable|needsLogin|postgresql://db.example:5432/ventes?tls=verify-full');
    const c = await fake.open(fake.params(P), { user: 'ana', password: 'secret' });
    expect(fake.connections).toBe(1);
    const query = { sources: [{ kind: 'table', name: 'Clients' }], columns: clients.design.fields.map((x) => ({ origin: { table: 'Clients', field: x.name } })) };
    const plan = c.plan({ query: query as unknown as BoundQuery, values: {}, filter: [], sort: [], refs: true, tables: () => clients, now: new Date() });
    expect(await c.count(plan)).toBe(2);
    expect(await c.rows(plan, 0, 5)).toEqual({ rows: [[1, 'Dupont', 'Lyon'], [2, 'Martin', 'Brest']], refs: ['[["1"],"10"]', '[["2"],"11"]'] });
    expect(await c.update(clients, '[["1"],"10"]', { Ville: 'Nice' })).toEqual({ ok: true, ref: '[["1"],"11"]', values: [1, 'Dupont', 'Nice'] });
    expect(await c.update(clients, '[["1"],"10"]', { Ville: 'Pau' })).toEqual({ ok: false, conflict: 'changed', current: [1, 'Dupont', 'Nice'], ref: '[["1"],"11"]' });
    expect(await c.delete(clients, ['[["1"],"10"]', '[["2"],"11"]'])).toEqual({ ok: true, count: 2 }); // by key only: 1 changed since read, deleted all the same (R8)
    expect(await c.update(clients, '[["1"],"11"]', { Ville: 'Pau' })).toEqual({ ok: false, conflict: 'deleted' });
    expect(fake.log).toEqual(['open', 'open', 'plan', 'count', 'rows', 'update', 'update', 'delete', 'update']);
  });

  it('C7: its SchemaWriter serves created tables, rolls them back with the transaction and drops them', async () => {
    const c = await fake.open(fake.params(P), { user: 'ana', password: 'secret' });
    const w = c.schema!;
    const st = { name: 'T', schema: 'public', key: ['N°'], rows: 2, nextId: 9, fields: [f('N°', 'autoNumber'), f('Nom', 'shortText')],
      indexes: [{ name: 'T_Nom', fields: [{ name: 'Nom', desc: false }], unique: false }] };
    const fk = { name: 'TClients', relation: 'TClients', schema: 'public', child: 'T', childFields: ['N°'], parent: 'Clients', parentFields: ['id'], onDelete: 'noAction' as const, onUpdate: 'noAction' as const };
    const write = () => c.transaction(async () => {
      await w.createTable(st);
      await w.insertRows(st, [[1, 'a'], [5, 'b']]);
      await w.finishTable(st);
      expect(await w.addForeignKeys([fk])).toEqual([fk]);
      return w.countRows(st);
    });
    fake.failNext = new Error('bc:serverError|x|y');
    await expect(write()).rejects.toThrow('bc:serverError|x|y');
    expect([await w.names('public'), await w.names('nope'), await c.table({ schema: 'public', remote: 'T', name: 'T' })]).toEqual([['Clients'], null, null]);
    expect(await write()).toBe(2);
    expect(await w.names('public')).toEqual(['Clients', 'T', 'T_Nom', 'TClients']);
    const tt = (await c.table({ schema: 'public', remote: 'T', name: 'T' }))!;
    expect(tt.key).toEqual(['N°']);
    expect((await c.insert(tt, { Nom: 'c' }) as { values: unknown[] }).values).toEqual([9, 'c']); // the AutoNumber goes on at nextId
    fake.undroppable = ['T'];
    expect(await w.dropTables([st])).toEqual(['T']);
    fake.undroppable = undefined;
    expect(await w.dropTables([st])).toEqual([]);
    expect(await w.names('public')).toEqual(['Clients']);
    expect(fake.log).toEqual(['open', 'begin', 'createTable', 'rollback', 'names', 'names', 'table', 'begin', 'createTable', 'insertRows', 'finishTable',
      'addForeignKeys', 'countRows', 'commit', 'names', 'table', 'insert', 'dropTables', 'dropTables', 'names']);
    expect(testConnector({ migrate: false }).capabilities.migrate).toBe(false);
  });
});
