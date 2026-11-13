// Needs Microsoft Access (starts hidden instances on this PC): skipped without it, or without Ventes-complet.accdb.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs, { copyFileSync, existsSync, readdirSync } from 'node:fs';
import os from 'node:os';
import { join } from 'node:path';
import { createBaseFile } from './db/file-format';
import type { RiskProbe } from './db/location-risk';
import { Session, type SessionDeps } from './session';
import { hasAccess, readAccessExport } from './import/access-export';

const COMPLET = join(__dirname, '../../tests/fixtures/access/Ventes-complet.accdb');
const SCRIPT = join(__dirname, '../../resources/access-export.ps1');
const run = hasAccess() && existsSync(COMPLET);
const probe: RiskProbe = { platform: 'win32', env: {}, homedir: 'C:/Users/x', windowsDriveType: () => 3 };
const deps: SessionDeps = { appVersion: '0.0.0', region: 'fr-FR', probe, lockDeps: { now: () => 0 }, sessionId: 'a' };
const tmps = () => readdirSync(os.tmpdir()).filter((n) => n.startsWith('basecraft-export-'));

let dir: string;
let complet: string;
let s: Session;
beforeEach(() => {
  dir = fs.realpathSync.native(fs.mkdtempSync(join(os.tmpdir(), 'bcaccessx-')));
  complet = join(dir, 'Ventes-complet.accdb');
  const fe = join(dir, 'front.basecraft');
  if (run) copyFileSync(COMPLET, complet);
  createBaseFile(fe, '0.0.0');
  s = Session.open(fe, deps);
});
afterEach(() => { s.close(); fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 }); });

describe.skipIf(!run)('Access import with Access running the export (E2 Task 4)', () => {
  it('kind access: exact structure, no temporary folder left; keepDir keeps a readable export', async () => {
    const left = tmps();
    const keep = join(dir, 'keep'); fs.mkdirSync(keep);
    const r = await s.importAccessTables(complet, ['Commandes', 'Clients'], undefined, { kind: 'access' }, keep, SCRIPT);
    expect(r.ok && r.report.lines).toContainEqual({ code: 'structureExact', object: 'Commandes' });
    expect(tmps()).toEqual(left);
    const kept = join(keep, 'Ventes-complet.accdb.export');
    expect(readAccessExport(kept, 'Ventes-complet.accdb').ok).toBe(true);
    // an existing export folder there is refused, nothing more is created
    expect(await s.importAccessTables(complet, ['Divers'], undefined, { kind: 'access' }, keep, SCRIPT)).toEqual({ ok: false, reason: 'export', failure: 'badFolder' });
  }, 180_000);
  it('a keepDir that cannot be written is failed, not badFolder', async () => {
    const notAFolder = join(dir, 'file.txt'); fs.writeFileSync(notAFolder, 'x');
    expect(await s.importAccessTables(complet, ['Divers'], undefined, { kind: 'access' }, notAFolder, SCRIPT)).toEqual({ ok: false, reason: 'export', failure: 'failed' });
  }, 180_000);
  it('interrupt during the export cancels, creates nothing and leaves no temporary folder', async () => {
    const left = tmps();
    const p = s.importAccessTables(complet, ['Commandes'], undefined, { kind: 'access' }, undefined, SCRIPT);
    await new Promise((res) => setTimeout(res, 1500));
    expect(await s.interrupt()).toBe(true);
    expect(await p).toEqual({ ok: false, reason: 'cancelled' });
    expect(s.listTables().map((x) => x.name)).not.toContain('Commandes');
    expect(tmps()).toEqual(left);
  }, 180_000);
});
