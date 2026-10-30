import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterAll, beforeAll, expect, it } from 'vitest';

// scripts/smb-spike.mjs (C3 Task 1): the owner runs it on real shares; here only a local smoke and its positive controls.
const SCRIPT = path.resolve(__dirname, '../../scripts/smb-spike.mjs');
const spike = (...args: string[]) => spawnSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf8' });

let dir: string;
let smoke: ReturnType<typeof spike>;
beforeAll(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bcspike-'));
  smoke = spike('smoke', dir, '--workers', '3', '--seconds', '3');
});
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

/** A copy of the smoke's file damaged by `sql`, so each control starts from the same clean file. */
function damaged(name: string, sql: string): string {
  const file = path.join(dir, name);
  fs.copyFileSync(path.join(dir, 'smb-spike.sqlite'), file);
  const db = new DatabaseSync(file);
  try { db.exec(sql); } finally { db.close(); }
  return file;
}

it('smoke sur un dossier local : integrity ok, aucun commit perdu, des commits de chaque worker', () => {
  expect(smoke.status, smoke.stdout + smoke.stderr).toBe(0);
  expect(smoke.stdout).toContain('BASECRAFT SMB SPIKE REPORT v1');
  expect(smoke.stdout).toMatch(/integrity_check: ok/);
  expect(smoke.stdout).toMatch(/lost commits: 0/);
  for (const w of ['x-0', 'x-1', 'x-2']) expect(smoke.stdout).toMatch(new RegExp(`worker ${w}: commits [1-9]`));
  expect(smoke.stdout).toContain('VERDICT: OK');
});

it('check repère un commit perdu (témoin positif)', () => {
  const r = spike('check', damaged('lost.sqlite', "DELETE FROM rows WHERE writer = 'x-0' AND seq = 1"));
  expect(r.status).toBe(1);
  expect(r.stdout).toContain('VERDICT: FAIL');
  expect(r.stdout).toMatch(/lost commits: [1-9]/);
  expect(r.stdout).toMatch(/x-0.*MISMATCH/);
});

it('check repère un contenu abîmé', () => {
  const r = spike('check', damaged('crc.sqlite', "UPDATE rows SET payload = 'x' WHERE id = 1"));
  expect(r.status).toBe(1);
  expect(r.stdout).toContain('VERDICT: FAIL');
  expect(r.stdout).toMatch(/crc mismatches: 1/);
});
