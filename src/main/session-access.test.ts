import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs, { copyFileSync, existsSync, readdirSync, readFileSync, utimesSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import { join } from 'node:path';
import { createBaseFile, openBaseFile } from './db/file-format';
import type { RiskProbe } from './db/location-risk';
import { createTable } from './db/schema';
import { ReadOnlyError, Session, type SessionDeps } from './session';
import { f, t } from '../shared/test-fixtures';
import { ACCESS_PASSWORD } from '../../tests/fixtures/access/expected';

// C2 Task 3: a front-end with a local Notes; Ventes.accdb (`access`) and Ventes-mdp.accdb (`protectedCopy`) copied beside it.
const fixture = (name: string) => join(__dirname, '../../tests/fixtures/access', name);
let dir: string;
let fe: string;
let access: string;
let protectedCopy: string;
let s: Session;
const opened: Session[] = [];
const probe: RiskProbe = { platform: 'win32', env: {}, homedir: 'C:\\Users\\x', windowsDriveType: () => 3 };
const deps: SessionDeps = { appVersion: '0.0.0', region: 'fr-FR', probe, lockDeps: { now: () => 0 }, sessionId: 'a' };
const open = (p: string) => { const x = Session.open(p, deps); opened.push(x); return x; };
const def = (sql: string) => ({ formatVersion: '1.0', sql });
const link = () => expect(s.createLinks(access, ['Clients', 'Commandes'])).toEqual({ ok: true });

beforeEach(() => {
  dir = fs.realpathSync.native(fs.mkdtempSync(join(os.tmpdir(), 'bcaccess-')));
  fe = join(dir, 'front.basecraft');
  access = join(dir, 'Ventes.accdb');
  protectedCopy = join(dir, 'Ventes-mdp.accdb');
  copyFileSync(fixture('Ventes.accdb'), access);
  copyFileSync(fixture('Ventes-mdp.accdb'), protectedCopy);
  createBaseFile(fe, '0.0.0');
  const db = openBaseFile(fe, 'write', '0.0.0').db;
  createTable(db, t('Notes', [f('N°', 'autoNumber'), f('Texte', 'shortText')]));
  db.close();
  s = open(fe);
});
afterEach(() => {
  for (const x of opened.splice(0)) x.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('Access sources in the session (C2 Task 3)', () => {
  it('an Access file is linked, read, filtered and totalled', () => {
    const info = s.inspectLinkFile(access);
    expect(info.kind).toBe('access');
    expect(info.tables).toEqual([
      { name: 'Clients', taken: false, skipped: ['Photo'] }, { name: 'Commandes', taken: false }, { name: 'Divers', taken: false }]);
    link();
    expect(s.listTables().find((x) => x.name === 'Clients')!.link).toEqual({ kind: 'access', path: access });
    expect(s.page('Clients', { offset: 0, limit: 10 }).rows).toHaveLength(4);
    // R11: Access's text semantics on the copy (case-insensitive, accent-sensitive): Lyon and LYON, not Lyôn
    expect(s.page('Clients', { offset: 0, limit: 10, filter: [{ field: 'Ville', criteria: '"Lyon"' }] }).rows.map((r) => r.values[1])).toEqual(['Dupont', 'Martin']);
    expect(s.pageSource({ kind: 'sql', sql: 'SELECT Client, Sum(Montant) AS Total, Count(*) AS Nb FROM Commandes GROUP BY Client' }, { offset: 0, limit: 10 }).rows)
      .toEqual([[1, 10.2, 2], [2, 0.3, 2], [3, 99.99, 1]]);
    expect(s.describeSource({ kind: 'table', name: 'Clients' }).updatable).toBe(false);
    expect(s.listLinks().map((l) => [l.name, l.kind, l.state])).toEqual([['Clients', 'access', 'ok'], ['Commandes', 'access', 'ok']]);
    expect(s.listRelations()).toEqual([]);
  });

  it('every write is refused and the file is unchanged', async () => { // R8, Review Focus 5
    link();
    const before = readFileSync(access);
    await expect(s.insert('Clients', { Nom: 'X' })).rejects.toThrow(ReadOnlyError);
    await expect(s.update('Clients', 1, { Nom: 'X' })).rejects.toThrow(ReadOnlyError);
    s.setContentEnabled(s.activeContent().fingerprint);
    expect(await s.runAction({ kind: 'sql', sql: 'UPDATE Clients SET Ville = "X"' }, {}, { skipFailures: false, replaceTable: false })).toMatchObject({ ok: false, reason: 'readOnly' });
    expect(() => s.saveObject('query', 'QI', def('SELECT Nom INTO Copie FROM Clients'), null)).toThrow(/\|mixedSources\|/); // PF4
    expect(readFileSync(access)).toEqual(before);
    expect(existsSync(`${access}.lock`)).toBe(false);
    expect(readdirSync(dir).filter((x) => x.endsWith('.laccdb') || x.endsWith('.ldb'))).toEqual([]);
  });

  it('a changed file is reread and totals follow', () => { // R4, Review Focus 4
    link();
    const q = () => s.pageSource({ kind: 'sql', sql: 'SELECT Sum(Montant) FROM Commandes' }, { offset: 0, limit: 1 }).rows[0][0];
    expect(q()).toBe(110.49);
    copyFileSync(fixture('Ventes-modifie.accdb'), access);
    utimesSync(access, new Date(), new Date(Date.now() + 2000));
    expect(q()).toBe(115.49);
    expect(s.page('Clients', { offset: 0, limit: 10 }).rows[2].values).toContain('Marseille');
  });

  it('Refresh Link rebuilds the copy even when size and time are kept', () => {
    const modified = readFileSync(fixture('Ventes-modifie.accdb'));
    const padded = Buffer.alloc(modified.length); // Ventes.accdb with zero pages up to the modified file's size
    readFileSync(fixture('Ventes.accdb')).copy(padded);
    const when = 1_700_000_000; // whole seconds: kept exactly by every file system
    writeFileSync(access, padded);
    utimesSync(access, when, when);
    link();
    expect(s.count('Commandes')).toBe(5);
    writeFileSync(access, modified);
    utimesSync(access, when, when);
    expect(s.count('Commandes')).toBe(5); // same size and time: the copy is kept (R4's limit)
    expect(s.refreshLinks(['Commandes']).map((l) => l.state)).toEqual(['ok']);
    expect(s.count('Commandes')).toBe(6);
  });

  it('a half-written file fails once, then reads again', () => { // R4, Review Focus 1
    link();
    expect(s.page('Clients', { offset: 0, limit: 10 }).rows).toHaveLength(4);
    writeFileSync(access, readFileSync(fixture('Ventes.accdb')).subarray(0, 8192));
    expect(() => s.page('Clients', { offset: 0, limit: 1 })).toThrow('|cannotOpen|');
    copyFileSync(fixture('Ventes.accdb'), access);
    expect(s.page('Clients', { offset: 0, limit: 10 }).rows).toHaveLength(4);
    expect(s.page('Notes', { offset: 0, limit: 1 }).rows).toEqual([]);
  });

  it('a table gone from the file is missingTable, the others still read', () => {
    expect(s.createLinks(access, ['Clients', 'Divers'])).toEqual({ ok: true });
    s.close();
    const db = openBaseFile(fe, 'write', '0.0.0').db;
    db.prepare(`UPDATE bc_links SET remote_name = 'Absente' WHERE name = 'Divers'`).run();
    db.close();
    s = open(fe);
    expect(() => s.page('Divers', { offset: 0, limit: 1 })).toThrow(`bc:linkUnavailable|missingTable|${access}`);
    expect(s.page('Clients', { offset: 0, limit: 10 }).rows).toHaveLength(4);
  });

  it('a protected file asks for its password, which is kept in memory only', () => { // R7, Review Focus 2
    expect(() => s.inspectLinkFile(protectedCopy)).toThrow(`bc:linkUnavailable|needsPassword|${protectedCopy}`);
    expect(s.unlockAccess(protectedCopy, 'faux', true)).toBe(false);
    expect(() => s.inspectLinkFile(protectedCopy)).toThrow('|needsPassword|');
    expect(s.unlockAccess(protectedCopy, ACCESS_PASSWORD, true)).toBe(true);
    expect(s.inspectLinkFile(protectedCopy).tables.map((x) => x.name)).toEqual(['Clients', 'Commandes', 'Divers']);
    expect(s.createLinks(protectedCopy, ['Divers'])).toEqual({ ok: true });
    expect(s.page('Divers', { offset: 0, limit: 1 }).rows).toHaveLength(1);
    s.close();
    expect(readFileSync(fe).includes(Buffer.from(ACCESS_PASSWORD, 'utf8'))).toBe(false);
    expect(readFileSync(fe).includes(Buffer.from(ACCESS_PASSWORD, 'utf16le'))).toBe(false);
    s = open(fe);
    let err = '';
    try { s.page('Divers', { offset: 0, limit: 1 }); } catch (e) { err = (e as Error).message; }
    expect(err).toBe(`bc:linkUnavailable|needsPassword|${protectedCopy}`);
    expect(s.listLinks().map((l) => l.state)).toEqual(['needsPassword']);
    expect(s.unlockAccess(protectedCopy, ACCESS_PASSWORD, false)).toBe(true); // a source of the front-end: no pick needed
    expect(s.page('Divers', { offset: 0, limit: 1 }).rows).toHaveLength(1);
  });

  it('unlock refuses a path that is neither a source nor picked', () => {
    expect(() => s.unlockAccess('/etc/passwd', 'x', false)).toThrow('bc:invalidArgument');
    expect(() => s.unlockAccess(protectedCopy, 'x', false)).toThrow('bc:invalidArgument');
  });

  it('convert to a local table copies the Access rows', () => { // R8
    link();
    expect(s.convertLink('Commandes')).toEqual({ ok: true });
    expect(s.listTables().find((x) => x.name === 'Commandes')!.link).toBeUndefined();
    expect(s.page('Commandes', { offset: 0, limit: 10 }).rows).toHaveLength(5);
    expect(s.tableDesign('Commandes').fields.find((x) => x.name === 'Montant')!.props.type).toBe('currency');
  });

  it('a query joining an Access link and a local table is refused', () => {
    link();
    expect(() => s.describeSource({ kind: 'sql', sql: 'SELECT * FROM Notes, Clients' })).toThrow(/\|mixedSources\|Clients/);
  });
});
