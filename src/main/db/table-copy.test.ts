import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Session, type SessionDeps } from '../session';
import type { RiskProbe } from './location-risk';
import { f, t } from '../../shared/test-fixtures';
import { reconcile } from './schema';

let dir: string;
let s: Session;
const probe: RiskProbe = { platform: 'linux', env: {}, homedir: '/home/x', windowsDriveType: () => 3 };
const deps: SessionDeps = { appVersion: '0.0.0', region: 'fr-FR', probe, lockDeps: { now: () => 0 }, sessionId: 'a' };
const save = (design: ReturnType<typeof t>) => s.saveTable({ originalName: null, design, mapping: [], allowDataLoss: false });
const count = (n: string) => s.count(n);

beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bccopy-')); s = Session.create(path.join(dir, 'b.basecraft'), deps); });
afterEach(() => { s.close(); fs.rmSync(dir, { recursive: true, force: true }); });

describe('table copy modes and append', () => {
  it('structure only: same design, no rows', async () => {
    await save(t('Clients', [f('Nom', 'shortText'), f('Solde', 'currency')]));
    await s.insert('Clients', { Nom: 'A', Solde: 1 });
    expect(s.copyTable('Clients', 'C2', 'structure')).toEqual({ ok: true });
    expect(count('C2')).toBe(0);
    expect(s.tableDesign('C2').fields).toEqual(s.tableDesign('Clients').fields);
    expect(s.copyTable('Clients', 'C3')).toEqual({ ok: true });
    expect(count('C3')).toBe(1);
  });

  it('append maps by name, renumbers AutoNumber and counts refusals', async () => {
    await save(t('Src', [f('Nom', 'shortText'), f('Montant', 'currency'), f('Jour', 'dateTime'), f('Ok', 'yesNo')]));
    await save(t('Dst', [f('N', 'autoNumber'), f('nom', 'shortText'), f('Montant', 'currency', { validationRule: '>0' }), f('Extra', 'shortText'), f('Jour', 'dateTime'), f('Ok', 'yesNo')]));
    await s.insert('Src', { Nom: 'a', Montant: 5, Jour: '2024-03-05', Ok: true });
    await s.insert('Src', { Nom: 'b', Montant: -1 });
    await s.insert('Src', { Nom: 'c', Montant: 7 });
    expect(await s.appendTable('Src', 'Dst')).toEqual({ appended: 2, refused: 1 });
    expect(count('Dst')).toBe(2);
    const rows = s.page('Dst', { offset: 0, limit: 10, filter: [] }).rows.map((r) => r.values);
    expect(rows[0]).toEqual([1, 'a', 5, null, expect.stringContaining('2024-03-05'), 1]);
    expect(rows[1]![0]).toBe(2);
    expect(await s.appendTable('Src', 'Src')).toEqual({ appended: 0, refused: 0 }); // never into itself
  });
  it('append never sees a bigint: node:sqlite (readBigInts off) refuses an integer beyond 2^53 when the source is read', async () => {
    await save(t('Dst', [f('Nb', 'number', { numberSize: 'double' })]));
    const db = (s as unknown as { db: import('node:sqlite').DatabaseSync }).db;
    db.exec('CREATE TABLE "Src" ("Nb" INTEGER)'); // another tool's table: an integer of any size
    reconcile(db);
    db.prepare('INSERT INTO "Src" ("Nb") VALUES (?)').run(9007199254740993n);
    await expect(s.appendTable('Src', 'Dst')).rejects.toMatchObject({ code: 'ERR_OUT_OF_RANGE' });
    expect(count('Dst')).toBe(0); // read before any insert: nothing appended, never a rounded copy
  });
});
