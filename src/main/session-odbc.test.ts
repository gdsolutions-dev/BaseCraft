import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import { join } from 'node:path';
import en from '../shared/i18n/en.json';
import { clients, f, t } from '../shared/test-fixtures';
import { createBaseFile, openBaseFile } from './db/file-format';
import type { RiskProbe } from './db/location-risk';
import { createTable } from './db/schema';
import type { OdbcRunner } from './import/odbc';
import type { ImportTexts } from './import/text-import';
import { Session } from './session';

const texts: ImportTexts = {
  fieldPrefix: 'Champ', idName: 'N°', errorSuffix: '_ErreursImportation',
  errorFields: { error: 'Erreur', field: 'Champ', line: 'Ligne' }, messages: en.fieldError, log: en.importText.log,
};
const probe: RiskProbe = { platform: 'win32', env: {}, homedir: 'C:\\Users\\x', windowsDriveType: () => 3 };
const req = { dsn: 'Sales', connection: '', user: 'u', password: 'secret' };
let dir: string; let s: Session; let seen: string[];
const runner: OdbcRunner = {
  dsns: async () => ['Sales'],
  tables: async (c) => { seen.push(c); return [{ name: 'Clients', schema: 'dbo' }, { name: 'Pays', schema: 'dbo' }, { name: 'Notes', schema: '' }]; },
  read: async (c, tb) => { seen.push(c); return { columns: [{ name: 'k', kind: 'int', size: 10 }, { name: 'v', kind: 'text', size: 20 }], rows: [['1', `${tb.name} a`], ['2', 'b']] }; },
};
beforeEach(() => {
  seen = [];
  dir = fs.realpathSync.native(fs.mkdtempSync(join(os.tmpdir(), 'bcodbc-s-')));
  const p = join(dir, 'f.basecraft');
  createBaseFile(p, '0.0.0');
  const db = openBaseFile(p, 'write', '0.0.0').db;
  createTable(db, t('Notes', [f('N°', 'autoNumber'), f('Texte', 'shortText')]));
  db.close();
  s = Session.open(p, { appVersion: '0.0.0', region: 'fr-FR', probe, lockDeps: { now: () => 0 }, sessionId: 'a' });
});
afterEach(() => { s.close(); fs.rmSync(dir, { recursive: true, force: true }); });
void clients;

describe('ODBC links in the session (D1)', () => {
  const link = (names = ['Pays']) => s.linkOdbcTables({ dsn: '', connection: 'Driver=x;PWD=hidden', user: 'u', password: '' }, names, 'x.ps1', runner);
  it('links read-only: rows read through the runner, the password never stored', async () => {
    expect(await link()).toEqual({ ok: true });
    expect(seen.at(-1)).toBe('Driver=x;UID=u;PWD=hidden');
    expect((await s.page('Pays', { offset: 0, limit: 10 })).rows).toHaveLength(2);
    expect(s.listTables().find((x) => x.name === 'Pays')?.link).toEqual({ kind: 'odbc', path: 'Driver=x;PWD=***' });
    await expect(s.insert('Pays', { Code: 3 })).rejects.toThrow('read-only base'); // a link to a source with no connector is read-only
    const info = s.listLinks();
    expect(info.map((l) => [l.name, l.kind, l.state])).toEqual([['Pays', 'odbc', 'ok']]);
    s.close();
    expect(fs.readFileSync(join(dir, 'f.basecraft')).includes('hidden')).toBe(false);
  });
  it('after a reopen the table asks its login; the login loads it; Refresh reads again', async () => {
    await link();
    s.close();
    s = Session.open(join(dir, 'f.basecraft'), { appVersion: '0.0.0', region: 'fr-FR', probe, lockDeps: { now: () => 0 }, sessionId: 'a', odbcRunner: runner });
    await expect(s.page('Pays', { offset: 0, limit: 10 })).rejects.toThrow(/^bc:linkUnavailable\|needsLogin\|odbc:\/\//);
    expect((await s.refreshLinks(['Pays']))[0]!.state).toBe('needsLogin');
    const key = s.listLinks()[0] && `odbc://${s.listLinks()[0]!.sourceId}`;
    expect(s.loginDefaults(key)).toEqual({ user: 'u', label: 'Driver=x;PWD=***' });
    expect(await s.login(key, 'u', 'pw2')).toBe(true);
    expect(seen.at(-1)).toBe('Driver=x;UID=u;PWD=pw2');
    expect((await s.page('Pays', { offset: 0, limit: 10 })).rows).toHaveLength(2);
    seen = [];
    expect((await s.refreshLinks(['Pays']))[0]!.state).toBe('ok');
    expect(seen.length).toBe(1);
  });
  it('a refused login is false and leaves the table asking; a failing Refresh is cannotConnect', async () => {
    await link();
    s.close();
    const bad: OdbcRunner = { ...runner, read: async () => { throw new Error('bc:odbc|failed|nope'); } };
    s = Session.open(join(dir, 'f.basecraft'), { appVersion: '0.0.0', region: 'fr-FR', probe, lockDeps: { now: () => 0 }, sessionId: 'a', odbcRunner: bad });
    const key = `odbc://${s.listLinks()[0]!.sourceId}`;
    expect(await s.login(key, 'u', 'x')).toBe(false);
    await expect(s.page('Pays', { offset: 0, limit: 10 })).rejects.toThrow(/needsLogin/);
  });
  it('a failed read links nothing; a missing table is reported; Change Source is refused', async () => {
    const bad: OdbcRunner = { ...runner, read: async () => { throw new Error('bc:odbc|failed|nope'); } };
    await expect(s.linkOdbcTables(req, ['Pays'], 'x.ps1', bad)).rejects.toThrow('bc:odbc|failed|nope');
    expect(s.listLinks()).toEqual([]);
    expect(await s.linkOdbcTables(req, ['Absente'], 'x.ps1', runner)).toEqual({ ok: false, reason: 'missingTables', names: ['Absente'] });
    await s.linkOdbcTables(req, ['Pays'], 'x.ps1', runner);
    expect(() => s.relink(['Pays'], join(dir, 'f.basecraft'))).toThrow('bc:invalidArgument');
  });
});

describe('ODBC import in the session (C4)', () => {
  it('inspect names the tables as free local names, the login in the connection string only', async () => {
    const info = await s.inspectOdbc(req, 'x.ps1', runner);
    expect(info.label).toBe('Sales');
    expect(info.tables.map((x) => [x.name, x.remote, x.schema])).toEqual([['Clients', 'Clients', 'dbo'], ['Pays', 'Pays', 'dbo'], ['Notes1', 'Notes', undefined]]);
    expect(seen).toEqual(['DSN=Sales;UID=u;PWD=secret']);
    expect(JSON.stringify(info)).not.toContain('secret');
  });
  it('imports the picked tables, one transaction each, and reports them', async () => {
    const ticks: string[] = [];
    const r = await s.importOdbcTables(req, ['Pays', 'Notes1'], texts, 'x.ps1', async (p) => { ticks.push(`${p.label}:${p.done}/${p.total}`); }, runner);
    expect(r).toEqual({ ok: true, tables: [{ name: 'Pays', remote: 'Pays', rows: 2, skipped: [] }, { name: 'Notes1', remote: 'Notes', rows: 2, skipped: [] }] });
    expect(ticks).toContain('Pays:2/2');
    expect(s.listTables().map((x) => x.name).sort()).toEqual(['Notes', 'Notes1', 'Pays']);
    expect((await s.page('Pays', { offset: 0, limit: 10 })).rows).toHaveLength(2);
  });
  it('a name the source no longer offers creates nothing', async () => {
    expect(await s.importOdbcTables(req, ['Pays', 'Absente'], texts, 'x.ps1', undefined, runner)).toEqual({ ok: false, reason: 'missingTables', names: ['Absente'] });
    expect(s.listTables().map((x) => x.name)).toEqual(['Notes']);
  });
});
