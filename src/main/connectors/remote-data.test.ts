import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { LOCAL_SOURCE, type BoundQuery } from '../../shared/query/bind';
import { localeInfo } from '../../shared/locale-format';
import { f, t } from '../../shared/test-fixtures';
import { createBaseFile, openBaseFile } from '../db/file-format';
import { addServerLinks, sourceRows } from '../links/store';
import { resolve, type QueryConn } from '../query/source';
import type { Capabilities, RemoteTable } from './connector';
import { comparable, readRequest, remoteDelete, remoteInsert, remoteTableRef, remoteUpdate, type RemoteCtx } from './remote-data';
import { isLost, RemoteSources } from './remote-sources';
import { testConnector } from './test-connector';
import fs from 'node:fs';
import os from 'node:os';
import { join } from 'node:path';

const clients: RemoteTable = {
  name: 'Clients', remote: 'Clients', schema: 'public', key: ['id'], skipped: [],
  design: t('Clients', [f('id', 'number', { numberSize: 'longInteger' }), f('Nom', 'shortText'), f('Ville', 'shortText')]),
};
const SRV = 'srv';
const memory = new DatabaseSync(':memory:');
const qc: QueryConn = {
  front: memory,
  catalog: { table: (n) => (n === 'Clients' ? clients.design : null), query: () => null, sourceOf: (n) => (n === 'Clients' ? SRV : LOCAL_SOURCE) },
  dbOf: () => { throw new Error('dbOf'); },
  remote: (source) => (source === SRV ? { kind: 'postgresql', table: () => clients } : undefined),
};
const ctx: RemoteCtx = { remote: new RemoteSources(() => memory, {}), qc, info: localeInfo('fr-FR'), now: () => new Date(0), hasValue: async () => true };
const bound = (sql: string): BoundQuery => resolve(qc, { kind: 'sql', sql });

describe('readRequest', () => {
  it('datasheet filters reach the connector as trees, never as SQL', () => {
    const r = readRequest(ctx, bound('SELECT * FROM Clients'), { offset: 0, limit: 10, filter: [{ field: 'Ville', criteria: '"Lyon"' }] });
    expect(r.filter).toEqual([{ column: 2, criteria: { k: 'bin', op: '=', l: { k: 'subject' }, r: { k: 'str', v: 'Lyon' } } }]);
  });

  it('sorts by output column, refs when updatable, the tables by link name, its clock', () => {
    const r = readRequest(ctx, bound('SELECT * FROM Clients'), { offset: 0, limit: 10, sort: [{ field: 'nom', dir: 'asc' }], where: 'Ville = "Lyon"' });
    expect(r).toMatchObject({ sort: [{ column: 1, dir: 'asc' }], refs: true, values: {}, now: new Date(0) });
    expect(r.where).toMatchObject({ k: 'bin', op: '=' });
    expect(r.tables('Clients')).toBe(clients);
  });

  it('an unknown field is bc:notFound, a criterion that does not parse bc:invalidArgument', () => {
    const b = bound('SELECT * FROM Clients');
    expect(() => readRequest(ctx, b, { offset: 0, limit: 1, filter: [{ field: 'X', criteria: '1' }] })).toThrow('bc:notFound');
    expect(() => readRequest(ctx, b, { offset: 0, limit: 1, sort: [{ field: 'X', dir: 'asc' }] })).toThrow('bc:notFound');
    expect(() => readRequest(ctx, b, { offset: 0, limit: 1, filter: [{ field: 'Ville', criteria: '"Lyon' }] })).toThrow('bc:invalidArgument');
    expect(() => readRequest(ctx, b, { offset: 0, limit: 1, where: 'Ville = (' })).toThrow('bc:invalidArgument');
  });

  it('a keyless server table is read-only (R9)', () => {
    qc.remote = (source) => (source === SRV ? { kind: 'postgresql', table: () => ({ ...clients, key: [] }) } : undefined);
    try {
      expect(bound('SELECT * FROM Clients').updatable).toBe(false);
    } finally {
      qc.remote = (source) => (source === SRV ? { kind: 'postgresql', table: () => clients } : undefined);
    }
  });

  it('a join query is updatable when every table it writes has a key (C5 R16)', () => {
    const villes: RemoteTable = { name: 'Villes', remote: 'villes', key: ['Ville'], skipped: [], design: t('Villes', [f('Ville', 'shortText', { indexed: 'yesNoDuplicates' }), f('Region', 'shortText')]) };
    const two = (v: RemoteTable): QueryConn => ({ ...qc,
      catalog: { table: (n) => (n === 'Clients' ? clients.design : n === 'Villes' ? v.design : null), query: () => null, sourceOf: () => SRV },
      remote: () => ({ kind: 'postgresql', table: (n) => (n === 'Clients' ? clients : v) }) });
    const sql = 'SELECT Nom, Region FROM Clients INNER JOIN Villes ON Clients.Ville = Villes.Ville';
    expect(resolve(two(villes), { kind: 'sql', sql }).updatable).toBe(true);
    expect(resolve(two({ ...villes, key: [] }), { kind: 'sql', sql }).updatable).toBe(false); // unique in its design, no key on the server
  });

  it('remoteTableRef brackets the name', () => {
    expect(remoteTableRef('Mes ]clients')).toEqual({ kind: 'sql', sql: 'SELECT * FROM [Mes ]]clients]' });
  });
});

describe('RemoteSources', () => {
  let dir: string;
  let front: DatabaseSync;
  beforeEach(() => {
    dir = fs.realpathSync.native(fs.mkdtempSync(join(os.tmpdir(), 'bcremote-')));
    const fe = join(dir, 'front.basecraft');
    createBaseFile(fe, '0.0.0');
    front = openBaseFile(fe, 'write', '0.0.0').db;
    addServerLinks(front, 'postgresql', { host: 'DB.example', port: 5432, database: 'ventes', user: 'ana' }, [clients]);
  });
  afterEach(() => {
    front.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('a write that meets a lost connection is reported, never repeated', async () => {
    const fake = testConnector();
    const r = new RemoteSources(() => front, { postgresql: fake });
    expect(r.keys()).toEqual(['postgresql://db.example:5432/ventes?tls=verify-full']);
    r.setCredential(r.keys()[0]!, { user: 'ana', password: 'secret' });
    const id = sourceRows(front)[0]!.id;
    let calls = 0;
    const lost = Object.assign(new Error('Connection terminated'), { lost: true });
    expect(isLost(lost)).toBe(true);
    await expect(r.run(id, async () => { calls++; throw lost; }, false)).rejects.toThrow('bc:serverError|connection|Connection terminated');
    expect(calls).toBe(1);
    expect(r.hasOpen()).toBe(false);
    expect(await r.run(id, async () => ++calls, true)).toBe(2);
    expect(r.hasOpen()).toBe(true);
    await r.close();
    expect(r.hasOpen()).toBe(false);
  });

  it('a write refused before it was sent (a connection that died while idle: unsent) runs once more on a fresh connection', async () => {
    const r = new RemoteSources(() => front, { postgresql: testConnector() });
    r.setCredential(r.keys()[0]!, { user: 'ana', password: 'secret' });
    const id = sourceRows(front)[0]!.id;
    const idle = () => Object.assign(new Error('Client has encountered a connection error and is not queryable'), { lost: true, unsent: true });
    let calls = 0;
    expect(await r.run(id, async () => { if (++calls === 1) throw idle(); return 'saved'; }, false)).toBe('saved');
    expect(calls).toBe(2);
    calls = 0; // unsent twice: reported, never a third try
    await expect(r.run(id, async () => { calls++; throw idle(); }, false)).rejects.toThrow('bc:serverError|connection|');
    expect(calls).toBe(2);
    calls = 0; // unsent, then lost once sent: the outcome is unknown
    const lost = Object.assign(new Error('Connection terminated'), { lost: true });
    await expect(r.run(id, async () => { throw ++calls === 1 ? idle() : lost; }, false)).rejects.toThrow('bc:serverError|connection|Connection terminated');
    expect(calls).toBe(2);
    await r.close();
  });

  it('a read lost twice cannot reach the server (bc:serverError|connection| says a write may have committed)', async () => {
    const r = new RemoteSources(() => front, { postgresql: testConnector() });
    r.setCredential(r.keys()[0]!, { user: 'ana', password: 'secret' });
    const id = sourceRows(front)[0]!.id;
    let calls = 0;
    const lost = Object.assign(new Error('Connection terminated'), { lost: true });
    await expect(r.run(id, async () => { calls++; throw lost; }, true)).rejects.toThrow(/^bc:linkUnavailable\|cannotConnect\|db\.example:5432\/ventes$/);
    expect(calls).toBe(2);
  });

  it('concurrent callers share one connection; one that connects after close() is closed at once, never kept', async () => {
    const fake = testConnector();
    const r = new RemoteSources(() => front, { postgresql: fake });
    r.setCredential(r.keys()[0]!, { user: 'ana', password: 'secret' });
    const id = sourceRows(front)[0]!.id;
    const [a, b] = await Promise.all([r.connection(id), r.connection(id)]);
    expect(fake.connections).toBe(1);
    expect(a.conn).toBe(b.conn);
    await r.close();
    expect(fake.log.filter((l) => l === 'close')).toHaveLength(1);
    const open = fake.open.bind(fake);
    let release!: () => void;
    fake.open = async (p, c) => { await new Promise<void>((done) => { release = done; }); return open(p, c); };
    const r2 = new RemoteSources(() => front, { postgresql: fake });
    r2.setCredential(r2.keys()[0]!, { user: 'ana', password: 'secret' });
    const late = r2.connection(id);
    late.catch(() => {});
    await new Promise((done) => setTimeout(done, 0));
    const closing = r2.close();
    release();
    await closing;
    await expect(late).rejects.toThrow(/^bc:linkUnavailable\|cannotConnect\|/);
    expect(fake.log.filter((l) => l === 'close')).toHaveLength(2);
    expect(r2.hasOpen()).toBe(false);
  });

  it('a kind this BaseCraft has no connector for is unsupportedKind, named by a link (no label without its connector: M9)', async () => {
    const r = new RemoteSources(() => front, {});
    expect(r.keys()).toEqual([]);
    await expect(r.connection(sourceRows(front)[0]!.id)).rejects.toThrow(/^bc:linkUnavailable\|unsupportedKind\|Clients$/);
  });
});

describe('remote writes (R7, R8)', () => {
  const d = t('Produits', [f('id', 'number', { numberSize: 'longInteger' }), f('Nom', 'shortText'), f('Prix', 'number', { numberSize: 'double' }), f('Notes', 'longText'), f('Lien', 'hyperlink')]);
  const caps: Capabilities = { passThrough: false, conflict: 'rowVersion', transactions: true, migrate: false };
  let dir: string;
  let front: DatabaseSync;
  let fake: ReturnType<typeof testConnector>;
  let w: RemoteCtx;
  let id: string;
  beforeEach(() => {
    dir = fs.realpathSync.native(fs.mkdtempSync(join(os.tmpdir(), 'bcremote-')));
    const fe = join(dir, 'front.basecraft');
    createBaseFile(fe, '0.0.0');
    front = openBaseFile(fe, 'write', '0.0.0').db;
    addServerLinks(front, 'postgresql', { host: 'db.example', port: 5432, database: 'ventes', user: 'ana' }, [clients]);
    fake = testConnector({ conflict: 'values', rows: { Clients: [[1, 'Dupont', 'Lyon']] } });
    const remote = new RemoteSources(() => front, { postgresql: fake });
    remote.setCredential(remote.keys()[0]!, { user: 'ana', password: 'secret' });
    w = { ...ctx, remote };
    id = sourceRows(front)[0]!.id;
  });
  afterEach(async () => {
    await w.remote.close();
    front.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('rowVersion: expected is not sent; values: only comparable fields', () => {
    expect(comparable(d, { id: 1, Nom: 'A', Prix: 1.5, Notes: 'long' }, { ...caps, conflict: 'rowVersion' })).toBeUndefined();
    expect(comparable(d, { id: 1, Nom: 'A', Prix: 1.5, Notes: 'long', Lien: 'http://x' }, { ...caps, conflict: 'values' })).toEqual({ id: 1, Nom: 'A' }); // Hyperlink is a Memo in Access: not compared
    expect(comparable(d, undefined, { ...caps, conflict: 'values' })).toBeUndefined();
  });

  it('values: the expected values reach the connector, a change since is a conflict with the current reference', async () => {
    const ref = JSON.stringify([['1'], JSON.stringify([1, 'Dupont', 'Lyon'])]); // the fake's 'values' token
    const c = await remoteUpdate(w, id, clients, ref, { Ville: 'Brest' }, { expected: { id: 1, Nom: 'Martin', Ville: 'Lyon' } });
    expect(c).toMatchObject({ ok: false, conflict: 'changed', current: [1, 'Dupont', 'Lyon'], rowid: ref });
    expect(await remoteUpdate(w, id, clients, ref, { Ville: 'Brest' }, { expected: { id: 1, Nom: 'Dupont', Ville: 'Lyon' } })).toMatchObject({ ok: true, values: [1, 'Dupont', 'Brest'] });
  });

  it('a local rowid is refused; insert sends only the given fields, converted', async () => {
    await expect(remoteUpdate(w, id, clients, 1, { Ville: 'x' }, {})).rejects.toThrow('bc:invalidArgument');
    await expect(remoteDelete(w, id, clients, [1])).rejects.toThrow('bc:invalidArgument');
    expect(await remoteInsert(w, id, clients, { id: '7', Nom: 'Ana' }, {})).toMatchObject({ ok: true, rowid: JSON.stringify([['7'], JSON.stringify([7, 'Ana', null])]), values: [7, 'Ana', null] });
    expect(await remoteInsert(w, id, { ...clients, key: [] }, { Nom: 'Bo' }, {})).toMatchObject({ ok: true, rowid: NaN });
  });

  it('the rules run before anything is sent: a field rule, the record rule on insert (R12)', async () => {
    const ruled = { ...clients, design: { ...clients.design, validationRule: '[Nom] <> "X"', validationText: 'Pas X',
      fields: clients.design.fields.map((x) => (x.name === 'Ville' ? { ...x, props: { ...x.props, validationRule: '<> "x"', validationText: 'Pas x' } } : x)) } };
    expect(await remoteInsert(w, id, ruled, { Nom: 'A', Ville: 'x' }, {})).toEqual({ ok: false, errors: [{ field: 'Ville', code: 'validation', message: 'Pas x' }] });
    expect(await remoteInsert(w, id, ruled, { Nom: 'X' }, {})).toEqual({ ok: false, errors: [{ field: '', code: 'validation', table: 'Clients', message: 'Pas X' }] });
    expect(await remoteUpdate(w, id, ruled, 'r', { Ville: 'x' }, {})).toEqual({ ok: false, errors: [{ field: 'Ville', code: 'validation', message: 'Pas x' }] });
    expect(fake.log).toEqual([]); // not even connected
  });

  it('Limit To List with enforceMask: a value list as stored, a Row Source through ctx.hasValue (R12)', async () => {
    const asked: unknown[] = [];
    const x: RemoteCtx = { ...w, hasValue: async (ref, column, value) => { asked.push([ref, column, value]); return value === 'Lyon'; } };
    const listed = { ...clients, design: t('Clients', [f('id', 'number', { numberSize: 'longInteger' }),
      f('Nom', 'shortText', { lookup: { kind: 'values', values: ['A', 'B'], limitToList: true } }),
      f('Ville', 'shortText', { lookup: { kind: 'table', table: 'SELECT Ville FROM Villes', limitToList: true } })]) };
    expect(await remoteInsert(x, id, listed, { Nom: 'C', Ville: 'Brest' }, { enforceMask: true }))
      .toEqual({ ok: false, errors: [{ field: 'Nom', code: 'notInList' }, { field: 'Ville', code: 'notInList' }] });
    expect(asked).toEqual([[{ kind: 'sql', sql: 'SELECT Ville FROM Villes' }, 0, 'Brest']]);
    expect((await remoteInsert(x, id, listed, { Nom: 'A', Ville: 'Lyon' }, { enforceMask: true })).ok).toBe(true);
    expect((await remoteInsert(x, id, listed, { Nom: 'C', Ville: 'Brest' }, {})).ok).toBe(true); // a programmatic write: no list
    x.hasValue = async () => { throw new Error('bc:queryBind|unknownSource|Villes'); }; // a Row Source that does not run checks nothing
    expect((await remoteInsert(x, id, listed, { Ville: 'Brest' }, { enforceMask: true })).ok).toBe(true);
    x.hasValue = async () => { throw new Error('bc:cancelled'); }; // a Stop stops the save
    await expect(remoteInsert(x, id, listed, { Ville: 'Brest' }, { enforceMask: true })).rejects.toThrow('bc:cancelled');
  });

  it('a server refusal naming a referencing table names its link in this front-end (else the server name)', async () => {
    addServerLinks(front, 'postgresql', { host: 'db.example', port: 5432, database: 'ventes', user: 'ana' },
      [{ ...clients, name: 'Mes commandes', remote: 'commandes' }]);
    const { conn } = await w.remote.connection(id);
    conn.delete = async () => ({ ok: false, reason: 'related', table: 'commandes' });
    conn.insert = async () => ({ ok: false, errors: [{ field: 'id', code: 'related', table: 'commandes' }] });
    expect(await remoteDelete(w, id, clients, ['r'])).toEqual({ ok: false, reason: 'related', table: 'Mes commandes' });
    expect(await remoteInsert(w, id, clients, { Nom: 'A' }, {})).toEqual({ ok: false, errors: [{ field: 'id', code: 'related', table: 'Mes commandes' }] });
    conn.delete = async () => ({ ok: false, reason: 'related', table: 'lignes' }); // not linked here: the server's name
    expect(await remoteDelete(w, id, clients, ['r'])).toEqual({ ok: false, reason: 'related', table: 'lignes' });
    conn.update = async () => ({ ok: false, errors: [{ field: 'id', code: 'related', table: 'commandes' }] }); // the update path too
    expect(await remoteUpdate(w, id, clients, 'r', { id: 9 }, {})).toEqual({ ok: false, errors: [{ field: 'id', code: 'related', table: 'Mes commandes' }] });
    addServerLinks(front, 'postgresql', { host: 'db.example', port: 5432, database: 'ventes', user: 'ana' },
      [{ ...clients, name: 'Commandes 2', remote: 'commandes' }]); // two links read it: which one is unknown, the server's name
    expect(await remoteUpdate(w, id, clients, 'r', { id: 9 }, {})).toEqual({ ok: false, errors: [{ field: 'id', code: 'related', table: 'commandes' }] });
    expect(await remoteDelete(w, id, clients, ['r'])).toMatchObject({ table: 'lignes' });
  });
});
