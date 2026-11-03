// Import from a server (C7 R17) on the fake connector: a server table becomes a local table, all or nothing.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import { join } from 'node:path';
import type { ImportProgress } from '../../shared/import-text';
import { f, t } from '../../shared/test-fixtures';
import type { RemoteTable } from '../connectors/connector';
import { testConnector } from '../connectors/test-connector';
import type { RiskProbe } from '../db/location-risk';
import { createBaseFile, openBaseFile } from '../db/file-format';
import { createTable } from '../db/schema';
import { Session, type SessionDeps } from '../session';
import { localDesign } from './import';

const P = { host: 'db.example', port: 5432, database: 'ventes', user: 'ana', tls: 'verify-full', timeout: 60 };
const KEY = 'postgresql://db.example:5432/ventes?tls=verify-full';
const probe: RiskProbe = { platform: 'win32', env: {}, homedir: 'C:\\Users\\x', windowsDriveType: () => 3 };
const deps: SessionDeps = { appVersion: '0.0.0', region: 'fr-FR', probe, lockDeps: { now: () => 0 }, sessionId: 'a' };

/** A server table as the connector reads it: connector props, `external` on the key, an identity sole key as AutoNumber. */
const remote = (name: string, fields: ReturnType<typeof f>[], key: string[], skipped: string[] = []): RemoteTable =>
  ({ name, remote: name, schema: 'public', key, skipped, design: { name, fields } });
const serverKey = (name: string) => f(name, 'autoNumber', { primaryKey: true, external: true, pgGenerated: true, required: false });

let dir: string;
let fake: ReturnType<typeof testConnector>;
let server: RemoteTable[];
let s: Session;
let fe: string;
type Rows = Record<string, (string | number | null)[][]>;
// the fake keys its rows by link name: Clients is imported as Clients1
const ROWS: Rows = { Clients1: [[1, 'Ana', '12.5000'], [2, null, null], [7, 'Zoé', '-0.0001']], Pays: [['FR', 'France'], ['DE', 'Allemagne']] };

/** The session on a fake server holding `rows` (the previous one closed). */
async function restart(rows: Rows): Promise<void> {
  await s?.close();
  fake = testConnector({ tables: server, rows });
  s = Session.open(fe, { ...deps, connectors: { postgresql: fake } });
  s.setCredential(KEY, 'ana', 'secret');
}

beforeEach(async () => {
  dir = fs.realpathSync.native(fs.mkdtempSync(join(os.tmpdir(), 'bcimp-')));
  fe = join(dir, 'front.basecraft');
  createBaseFile(fe, '0.0.0');
  const db = openBaseFile(fe, 'write', '0.0.0').db;
  createTable(db, t('Clients', [f('N°', 'autoNumber'), f('Nom', 'shortText', { size: 20 })]));
  db.close();
  server = [
    remote('Clients', [serverKey('N°'), f('Nom', 'shortText', { size: 20, msType: 'nvarchar', pgCast: 'text' }), f('Solde', 'number', { numberSize: 'decimal', precision: 19, scale: 4 })], ['N°'], ['photo']),
    remote('Pays', [f('Code', 'shortText', { size: 3, primaryKey: true, external: true }), f('Libellé', 'shortText', { size: 3 })], ['Code']),
  ];
  await restart(ROWS);
});
afterEach(async () => {
  await s.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

const local = async (name: string) => (await s.page(name, { offset: 0, limit: 50 })).rows.map((r) => r.values);

describe('localDesign', () => {
  it('drops the connector props and `external`, keeps the key as the primary key and an identity key as AutoNumber', () => {
    const d = localDesign(server[0]!);
    expect(d.fields.map((x) => [x.name, x.props.type, x.props.primaryKey])).toEqual([['N°', 'autoNumber', true], ['Nom', 'shortText', false], ['Solde', 'number', false]]);
    for (const x of d.fields) expect(Object.keys(x.props).filter((k) => /^(pg|ms)[A-Z]/.test(k) || k === 'external')).toEqual([]);
    expect(localDesign(server[1]!).fields[0]!.props).toMatchObject({ primaryKey: true, required: true });
  });
});

describe('importServerTables', () => {
  it('a server table becomes a local table: another name when the name is used, rows as stored, AutoNumber continuing', async () => {
    const info = await s.inspectServer('postgresql', P, 'ana', 'secret');
    expect(info.tables.map((x) => x.name)).toEqual(['Clients1', 'Pays']); // never a name the front-end uses
    const ticks: ImportProgress[] = [];
    const r = await s.importServerTables('postgresql', P, ['Clients1'], async (p) => { ticks.push(p); });
    expect(r).toEqual({ ok: true, tables: [{ name: 'Clients1', remote: 'Clients', rows: 3, skipped: ['photo'] }] });
    expect(await local('Clients1')).toEqual([[1, 'Ana', '12.5000'], [2, null, null], [7, 'Zoé', '-0.0001']]);
    expect(s.tableDesign('Clients1').fields.map((x) => [x.name, x.props.type, x.props.primaryKey])).toEqual([['N°', 'autoNumber', true], ['Nom', 'shortText', false], ['Solde', 'number', false]]);
    expect(s.listTables().find((x) => x.name === 'Clients1')!.link).toBeUndefined(); // a local table, not a link
    expect(await s.insert('Clients1', { Nom: 'Neuf' })).toMatchObject({ ok: true });
    expect((await local('Clients1')).map((x) => x[0])).toEqual([1, 2, 7, 8]);
    expect(ticks.at(-1)).toMatchObject({ done: 3, total: 3, label: 'Clients1' });
    expect(fake.log).not.toContain('insert'); // nothing written to the server
  });

  it('pages of 1 000: every row, in key order', async () => {
    server[1]!.design.fields[0]!.props.size = 5;
    await restart({ Pays: Array.from({ length: 2500 }, (_, i) => [`k${String(2500 - i).padStart(4, '0')}`, 'x']) });
    const r = await s.importServerTables('postgresql', P, ['Pays']);
    expect(r).toMatchObject({ ok: true, tables: [{ rows: 2500 }] });
    expect(await s.count('Pays')).toBe(2500);
    expect((await local('Pays'))[0]![0]).toBe('k0001');
    expect(fake.log.filter((x) => x === 'rows')).toHaveLength(3);
  });

  it('one transaction for every picked table: a failure in the second leaves none', async () => {
    await restart({ ...ROWS, Pays: [['FR', 'France'], ['DE', 'Allemagne trop long']] }); // Libellé is Short Text (3): the local CHECK refuses it
    await expect(s.importServerTables('postgresql', P, ['Clients1', 'Pays'])).rejects.toThrow('bc:unsupportedTable');
    expect(s.listTables().map((x) => x.name)).toEqual(['Clients']);
    expect(await local('Clients')).toEqual([]);
  });

  it('refuses a name the front-end uses, and a name the server no longer offers, before creating anything', async () => {
    expect(await s.importServerTables('postgresql', P, ['Clients'])).toEqual({ ok: false, reason: 'nameExists', names: ['Clients'] });
    expect(await s.importServerTables('postgresql', P, ['Pays', 'Absente'])).toEqual({ ok: false, reason: 'missingTables', names: ['Absente'] });
    expect(s.listTables().map((x) => x.name)).toEqual(['Clients']);
  });

  it('Stop: cancelled, no table created', async () => {
    fake.hold = true;
    const run = s.importServerTables('postgresql', P, ['Clients1', 'Pays']);
    await vi.waitFor(() => expect(fake.log).toContain('rows'));
    expect(await s.interrupt()).toBe(true);
    expect(await run).toEqual({ ok: false, reason: 'cancelled' });
    fake.hold = false;
    expect(s.listTables().map((x) => x.name)).toEqual(['Clients']);
  });

  it('a lost connection leaves the front-end unchanged', async () => {
    fake.failNext = Object.assign(new Error('boom'), { lost: true });
    await expect(s.importServerTables('postgresql', P, ['Pays'])).rejects.toThrow(/^bc:linkUnavailable\|cannotConnect\|/);
    expect(s.listTables().map((x) => x.name)).toEqual(['Clients']);
  });
});
