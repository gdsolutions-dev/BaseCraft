import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import { join } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { createBaseFile, openBaseFile } from './db/file-format';
import type { RiskProbe } from './db/location-risk';
import { saveObject } from './db/objects';
import { createTable } from './db/schema';
import { addServerLinks } from './links/store';
import { Session, type SessionDeps } from './session';
import type { NativeResult } from './connectors/connector';
import { ptProps } from './connectors/postgres/types';
import { testConnector } from './connectors/test-connector';
import { f, t } from '../shared/test-fixtures';

// A front-end holding the pass-throughs P, PBak (Returns Records Yes) and PNo (No) to the fake connector's server, and a local
// table Notes (C6 Task 3).
const PARAMS = { host: 'db.example', port: 5432, database: 'ventes', user: 'ana', tls: 'verify-full', timeout: 60 };
const KEY = 'postgresql://db.example:5432/ventes?tls=verify-full';
const pt = (returnsRecords: boolean, sql = 'SELECT nom AS "Nom", ville AS "Ville" FROM clients') =>
  ({ formatVersion: '2.0', sql, passThrough: { kind: 'postgresql', params: PARAMS, returnsRecords } });
const probe: RiskProbe = { platform: 'win32', env: {}, homedir: 'C:\\Users\\x', windowsDriveType: () => 3 };
const deps: SessionDeps = { appVersion: '0.0.0', region: 'fr-FR', probe, lockDeps: { now: () => 0 }, sessionId: 'a' };
const P = { kind: 'query', name: 'P' } as const;
const lt = ptProps(1043, 54);
const villes: NativeResult = { columns: [{ name: 'Nom', props: lt }, { name: 'Ville', props: lt }], rows: [['Dupont', 'Lyon'], ['Durand', 'Brest'], ['Martin', 'LYON']], affected: 3 };

let dir: string;
let result: NativeResult;
let onNative: (() => void) | undefined;
let fake: ReturnType<typeof testConnector>;
let s: Session;

beforeEach(() => {
  dir = fs.realpathSync.native(fs.mkdtempSync(join(os.tmpdir(), 'bcpt-')));
  const fe = join(dir, 'front.basecraft');
  createBaseFile(fe, '0.0.0');
  const front = openBaseFile(fe, 'write', '0.0.0').db;
  saveObject(front, 'query', 'P', pt(true), null);
  saveObject(front, 'query', 'PBak', pt(true), null);
  createTable(front, t('Notes', [f('N°', 'autoNumber'), f('Texte', 'shortText')]));
  saveObject(front, 'query', 'PNo', pt(false, 'UPDATE clients SET ville = upper(ville)'), null);
  front.close();
  result = villes;
  onNative = undefined;
  fake = testConnector({ native: () => { onNative?.(); return result; } });
  s = Session.open(fe, { ...deps, connectors: { postgresql: fake } });
  s.setCredential(KEY, 'ana', 'secret');
  s.setContentEnabled(s.activeContent().fingerprint, true); // trusted: the stored credential runs pass-throughs (Task 8)
});
afterEach(async () => {
  await s.close();
  fs.rmSync(dir, { recursive: true, force: true });
});
const natives = () => fake.log.filter((x) => x === 'native');
const snapshotDb = (name: string) => (s as unknown as { snapshots: Map<string, { db: DatabaseSync }> }).snapshots.get(name)?.db;

describe('pass-through record sources (C6 R1, R7)', () => {
  it('a pass-through datasheet: read-only, sorted and filtered on the snapshot, sent once', async () => {
    const info = await s.describeSource(P);
    expect(info.updatable).toBe(false); expect(info.fields.map((f) => f.name)).toEqual(['Nom', 'Ville']);
    expect(info.fields[0]).toEqual({ name: 'Nom', type: 'shortText', props: lt }); // no origin: PassThrough is no table of the front-end
    const p = await s.pageSource(P, { offset: 0, limit: 0, fresh: true }); // the describe just before: no second run
    expect(p.total).toBe(3); expect(natives()).toHaveLength(1);
    const sorted = await s.pageSource(P, { offset: 0, limit: 10, sort: [{ field: 'Ville', dir: 'asc' }], filter: [{ field: 'Ville', criteria: '"lyon"' }] });
    expect(sorted.rows).toEqual([['Dupont', 'Lyon'], ['Martin', 'LYON']]); expect(sorted.rowids).toEqual([null, null]);
    expect(natives()).toHaveLength(1);
    await s.pageSource(P, { offset: 0, limit: 10, fresh: true }); // Requery
    expect(natives()).toHaveLength(2);
    expect(fake.log.slice(-3)).toEqual(['open', 'native', 'close']); // one connection per run (R4)
  });

  // G1 (owner 2026-10-31): Returns Records Yes is not active content — snapshotOf never calls needContent().
  it('in disabled mode a pass-through returning records still runs; a source query naming it is refused', async () => {
    s.setContentEnabled(null);
    expect(await s.login(KEY, 'ana', 'secret')).toBe(true); // untrusted: typed in this session (Task 8)
    expect((await s.describeSource(P)).updatable).toBe(false);
    fake.log.length = 0;
    await expect(s.pageSource({ kind: 'sql', sql: 'SELECT * FROM P' }, { offset: 0, limit: 1 })).rejects.toThrow('bc:queryBind|passThroughAsSource|P');
    expect(fake.log).not.toContain('native');
  });

  it('Returns Records No is no record source; saving the query drops its snapshot', async () => {
    await expect(s.describeSource({ kind: 'query', name: 'PNo' })).rejects.toThrow(/^bc:notSelectQuery$/);
    await expect(s.pageSource({ kind: 'query', name: 'PNo' }, { offset: 0, limit: 1, fresh: true })).rejects.toThrow(/^bc:notSelectQuery$/);
    expect(natives()).toHaveLength(0);
    await s.describeSource(P);
    expect(s.saveObject('query', 'P', pt(true, 'SELECT 1'), 'P')).toEqual({ ok: true });
    await s.pageSource(P, { offset: 0, limit: 1 });
    expect(natives()).toHaveLength(2);
    expect(await s.renameObject('query', 'P', 'P2')).toMatchObject({ ok: true });
    await s.pageSource({ kind: 'query', name: 'p2' }, { offset: 0, limit: 1 });
    expect(natives()).toHaveLength(3);
  });

  it('an open runs once whatever other sources are read between its describe and its first page', async () => {
    await s.describeSource(P);
    await s.describeSource({ kind: 'table', name: 'Notes' });
    await s.pageSource({ kind: 'table', name: 'Notes' }, { offset: 0, limit: 0 });
    await s.pageSource(P, { offset: 0, limit: 0, fresh: true });
    expect(natives()).toHaveLength(1);
  });

  it('a report opens with two describes then a fresh page: one run; a page in between makes the fresh page a Requery', async () => {
    await s.describeSource(P);
    await s.describeSource(P);
    await s.pageSource(P, { offset: 0, limit: 10, fresh: true });
    expect(natives()).toHaveLength(1);
    await s.pageSource(P, { offset: 0, limit: 10, fresh: true });
    expect(natives()).toHaveLength(2);
    await s.describeSource(P);
    await s.pageSource(P, { offset: 0, limit: 10 });
    await s.pageSource(P, { offset: 0, limit: 10, fresh: true });
    expect(natives()).toHaveLength(3);
  });

  it('a call retried by db-host (the same request again) is the same call: the text is not sent again', async () => {
    await s.describeSource(P);
    const req = { offset: 0, limit: 0, fresh: true };
    await s.pageSource(P, req);
    await s.pageSource(P, req); // host.ts retries a READ_METHODS call once on SQLITE_CORRUPT with the same arguments
    expect(natives()).toHaveLength(1);
    await s.pageSource(P, { offset: 0, limit: 0, fresh: true }); // a Requery: a new call
    expect(natives()).toHaveLength(2);
  });

  it('deleting the query drops its snapshot; close closes it', async () => {
    await s.describeSource(P);
    const first = snapshotDb('p')!;
    expect(s.deleteObject('query', 'P')).toEqual({ ok: true });
    expect(first.isOpen).toBe(false);
    expect(s.copyObject('query', 'PBak', 'P')).toEqual({ ok: true });
    await s.pageSource(P, { offset: 0, limit: 1 }); // no snapshot left: it runs again
    expect(natives()).toHaveLength(2);
    const second = snapshotDb('p')!;
    expect(second.isOpen).toBe(true);
    await s.close();
    expect(second.isOpen).toBe(false);
  });

  it('Stop cancels a running pass-through (R12)', async () => {
    fake.hold = true;
    const run = s.describeSource(P);
    await expect.poll(() => fake.log.includes('native')).toBe(true);
    expect(await s.interrupt()).toBe(true);
    await expect(run).rejects.toThrow(/^bc:cancelled$/);
    expect(fake.log.slice(-2)).toEqual(['cancel', 'close']);
  });

  it('a window closed during the run keeps no snapshot', async () => {
    onNative = () => { void s.close(); };
    await expect(s.describeSource(P)).rejects.toThrow(/^bc:cannotOpen$/);
    expect(snapshotDb('p')).toBeUndefined();
  });

  it('Returns Records Yes without columns', async () => {
    result = { columns: [], rows: [], affected: 2 };
    await expect(s.describeSource(P)).rejects.toThrow(/^bc:passThroughNoRecords$/);
  });

  it('no credential: the login prompt, nothing sent', async () => {
    const other = { ...pt(true), passThrough: { ...pt(true).passThrough, params: { ...PARAMS, host: 'autre' } } };
    expect(s.saveObject('query', 'Q', other, null)).toEqual({ ok: true });
    await expect(s.describeSource({ kind: 'query', name: 'Q' })).rejects.toThrow('bc:linkUnavailable|needsLogin|postgresql://autre:5432/ventes?tls=verify-full');
    expect(natives()).toHaveLength(0);
  });
});

describe('running Returns Records No, servers no link uses, Stop and errors (C6 Task 4)', () => {
  const U = { kind: 'query', name: 'PNo' } as const;
  const OPTS = { skipFailures: false, replaceTable: false };

  it('an UPDATE pass-through: blocked in disabled mode, runs once enabled', async () => {
    s.setContentEnabled(null);
    await expect(s.runAction(U, {}, OPTS)).rejects.toThrow('bc:contentDisabled');
    expect(natives()).toHaveLength(0);
    s.setContentEnabled(s.activeContent().fingerprint, true);
    result = { columns: [], rows: [], affected: 2 };
    expect(await s.runAction(U, {}, OPTS)).toEqual({ ok: true, count: 2 });
    expect(natives()).toHaveLength(1);
    expect(fake.log.slice(-3)).toEqual(['open', 'native', 'close']);
  });

  it('Returns Records Yes is no action; actionCount of a pass-through is refused, nothing sent', async () => {
    s.setContentEnabled(null);
    await expect(s.runAction({ kind: 'query', name: 'P' }, {}, OPTS)).rejects.toThrow('bc:invalidArgument');
    await expect(s.actionCount(U, {})).rejects.toThrow('bc:invalidArgument');
    expect(natives()).toHaveLength(0);
  });

  it('runs on a read-only front-end too (the file is not written)', async () => {
    const ro = Session.open(join(dir, 'front.basecraft'), { ...deps, sessionId: 'b', connectors: { postgresql: fake } });
    try {
      expect(ro.state.readOnly).toBe(true);
      ro.setCredential(KEY, 'ana', 'secret');
      ro.setContentEnabled(ro.activeContent().fingerprint, true);
      result = { columns: [], rows: [], affected: 5 };
      expect(await ro.runAction(U, {}, OPTS)).toEqual({ ok: true, count: 5 });
    } finally { await ro.close(); }
  });

  it('a server no link uses: its key is listed, the login works through it', async () => {
    expect(s.serverKeys()).toEqual([KEY]);
    expect(s.loginDefaults(KEY)).toEqual({ user: 'ana', label: expect.stringContaining('db.example') });
    const fe = join(dir, 'front.basecraft');
    const fresh = Session.open(fe, { ...deps, sessionId: 'c', connectors: { postgresql: fake } });
    try {
      await expect(fresh.describeSource(P)).rejects.toThrow(`bc:linkUnavailable|needsLogin|${KEY}`);
      expect(await fresh.login(KEY, 'ana', 'wrong')).toBe(false);
      await expect(fresh.describeSource(P)).rejects.toThrow(`bc:linkUnavailable|needsLogin|${KEY}`);
      expect(await fresh.login(KEY, 'ana', 'secret')).toBe(true);
      expect((await fresh.describeSource(P)).fields.length).toBeGreaterThan(0);
    } finally { await fresh.close(); }
  });

  it('Stop cancels the running pass-through without killing the session', async () => {
    fake.hold = true;
    const run = s.runAction(U, {}, OPTS);
    await expect.poll(() => fake.log.includes('native')).toBe(true);
    expect(await s.interrupt()).toBe(true);
    await expect(run).rejects.toThrow('bc:cancelled');
    expect(fake.log).toContain('close');
  });

  it('timeout and lost connection (never repeated)', async () => {
    result = { columns: [], rows: [], affected: 0 };
    fake.failNext = new Error('bc:timeout|60');
    await expect(s.runAction(U, {}, OPTS)).rejects.toThrow('bc:passThroughTimeout|60');
    fake.failNext = Object.assign(new Error('Connection terminated'), { lost: true });
    await expect(s.runAction(U, {}, OPTS)).rejects.toThrow('bc:passThroughLost||Connection terminated');
    expect(natives()).toHaveLength(2);
  });
});

// Task 8 (owner 2026-10-31, option 2): a pass-through never runs on a stored credential unless the file is trusted (content
// enabled, or a trusted location); a credential typed in this session is used.
describe('a stored password runs pass-throughs only in a trusted file (C6 Task 8)', () => {
  const untrusted = (fingerprint: string | null) => { s.setContentEnabled(fingerprint, false); fake.log.length = 0; };

  it('untrusted + stored credential only: the login prompt, nothing opened; typed in this session: runs', async () => {
    untrusted(null);
    await expect(s.describeSource(P)).rejects.toThrow(`bc:linkUnavailable|needsLogin|${KEY}`);
    await expect(s.pageSource(P, { offset: 0, limit: 1, fresh: true })).rejects.toThrow(`bc:linkUnavailable|needsLogin|${KEY}`);
    await expect(s.describeSource(P)).rejects.toThrow(/^bc:linkUnavailable\|needsLogin\|.*\|untrusted$/); // no refusal: main keeps the stored one; the prompt says why
    expect(fake.log).toEqual([]); // no open, no native
    expect(await s.login(KEY, 'ana', 'secret')).toBe(true);
    expect((await s.describeSource(P)).fields.length).toBe(2);
    expect(natives()).toHaveLength(1);
    await s.pageSource(P, { offset: 0, limit: 1, fresh: true }); // the open's first page: the describe's run
    s.setCredential(KEY, 'ana', 'secret'); // main pushes again (takeOverLock): still the credential typed here
    await s.pageSource(P, { offset: 0, limit: 1, fresh: true });
    expect(natives()).toHaveLength(2);
  });

  it('a file with no active content is not trusted', async () => {
    untrusted('');
    await expect(s.describeSource(P)).rejects.toThrow(`bc:linkUnavailable|needsLogin|${KEY}`);
    expect(fake.log).toEqual([]);
  });

  it('trusted (enabled or a trusted location): the stored credential runs it; becoming trusted in the session too', async () => {
    untrusted(s.activeContent().fingerprint);
    await expect(s.describeSource(P)).rejects.toThrow(`bc:linkUnavailable|needsLogin|${KEY}`);
    s.setContentEnabled(s.activeContent().fingerprint, true); // « Activer le contenu »
    expect((await s.describeSource(P)).fields.length).toBe(2);
    await s.pageSource(P, { offset: 0, limit: 1, fresh: true }); // the open's first page
    s.setContentEnabled('', true); // no content, in a trusted location
    await s.pageSource(P, { offset: 0, limit: 1, fresh: true });
    expect(natives()).toHaveLength(2);
  });

  it('a refused typed login leaves it asked; a link datasheet of the same server keeps the stored credential', async () => {
    const fe = join(dir, 'front.basecraft');
    const db = openBaseFile(fe, 'write', '0.0.0').db;
    const clients = { name: 'Clients', remote: 'clients', schema: 'public', key: ['id'], skipped: [], design: t('Clients', [f('id', 'number', { numberSize: 'longInteger' }), f('Nom', 'shortText')]) };
    addServerLinks(db, 'postgresql', PARAMS, [clients]);
    db.close();
    const linked = testConnector({ tables: [clients], rows: { Clients: [[1, 'Dupont']] }, native: () => result });
    const x = Session.open(fe, { ...deps, sessionId: 'd', connectors: { postgresql: linked } });
    try {
      x.setCredential(KEY, 'ana', 'secret');
      x.setContentEnabled(null, false);
      expect((await x.page('Clients', { offset: 0, limit: 10 })).rows).toHaveLength(1); // linked tables unchanged
      await expect(x.describeSource(P)).rejects.toThrow(`bc:linkUnavailable|needsLogin|${KEY}`);
      expect(linked.log).not.toContain('native');
      expect(await x.login(KEY, 'ana', 'wrong')).toBe(false);
      await expect(x.describeSource(P)).rejects.toThrow(`bc:linkUnavailable|needsLogin|${KEY}`);
      expect(await x.login(KEY, 'ana', 'secret')).toBe(true);
      expect((await x.describeSource(P)).fields.length).toBe(2);
    } finally { await x.close(); }
  });
});
