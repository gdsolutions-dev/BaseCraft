import { afterEach, beforeEach, expect, it } from 'vitest';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createBaseFile, openBaseFile } from './file-format';
import { readRows } from './rows';
import { createTable, tableDesign } from './schema';
import { inTransaction, inTransactionAsync, setBusyRetry } from './tx';
import { insertRow } from './write-layer';
import { clients } from '../../shared/test-fixtures';
import { localeInfo } from '../../shared/locale-format';

let dir: string;
let p: string;
let a: DatabaseSync;
let b: DatabaseSync;
const fr = localeInfo('fr-FR');
const corrupt = () => Object.assign(new Error('database disk image is malformed'), { errcode: 11 });
const count = (db: DatabaseSync, table: string) => (db.prepare(`SELECT count(*) AS n FROM ${table}`).get() as { n: number }).n;
/** A child node process running `script` (plain node:sqlite: the child cannot load the TypeScript modules) on the base `p`. */
const child = (script: string) => spawn(process.execPath, ['--no-warnings', '-e', script, p], { stdio: ['ignore', 'pipe', 'inherit'] });
const said = (c: ReturnType<typeof child>, word: string) => new Promise<void>((resolve, reject) => {
  c.stdout!.on('data', (d: Buffer) => { if (String(d).includes(word)) resolve(); });
  c.on('exit', () => reject(new Error(`child exited before "${word}"`)));
});

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bctx-'));
  p = path.join(dir, 'test.basecraft');
  createBaseFile(p, '0.0.0');
  a = openBaseFile(p, 'write', '0.0.0').db;
  a.exec('CREATE TABLE t (x)');
  createTable(a, clients);
  b = new DatabaseSync(p);
  for (const db of [a, b]) db.exec('PRAGMA busy_timeout=50');
});
afterEach(() => {
  setBusyRetry(2, 250);
  for (const db of [a, b]) try { db.close(); } catch { /* already closed */ }
  fs.rmSync(dir, { recursive: true, force: true });
});

it('outside a transaction it begins IMMEDIATE', () => {
  inTransaction(a, () => { expect(() => b.exec('BEGIN IMMEDIATE')).toThrow(/locked|busy/i); });
});

it('a busy begin is retried, then bc:busy', () => {
  b.exec('BEGIN IMMEDIATE');
  setBusyRetry(2, 40);
  const t0 = Date.now();
  expect(() => inTransaction(a, () => 1)).toThrow('bc:busy');
  expect(Date.now() - t0).toBeGreaterThanOrEqual(3 * 50 + 2 * 40 - 20);
  expect(a.isTransaction).toBe(false);
  b.exec('ROLLBACK');
});

it('a holder that commits during the retries lets the write through', async () => {
  // the parent's timers are blocked by sleepSync: the holder is another process, committing on its own clock
  const c = child(`const { DatabaseSync } = require('node:sqlite'); const db = new DatabaseSync(process.argv[1]);
    db.exec('BEGIN IMMEDIATE'); console.log('locked'); setTimeout(() => { db.exec('COMMIT'); db.close(); }, 100);`);
  const exited = new Promise((r) => c.on('exit', r));
  await said(c, 'locked');
  setBusyRetry(5, 50);
  expect(inTransaction(a, () => { a.exec('INSERT INTO t VALUES (1)'); return 'ok'; })).toBe('ok');
  expect(count(b, 't')).toBe(1);
  await exited;
});

it('a commit that stays busy is rolled back and reported bc:busy', () => {
  b.exec('BEGIN');
  expect(count(b, 't')).toBe(0); // b holds a SHARED lock until it ends: a's COMMIT cannot take the EXCLUSIVE one
  expect(() => inTransaction(a, () => a.exec('INSERT INTO t VALUES (1)'))).toThrow('bc:busy');
  expect(a.isTransaction).toBe(false);
  b.exec('ROLLBACK');
  expect(count(b, 't')).toBe(0);
});

it('inside a transaction it stays a savepoint', () => {
  a.exec('BEGIN');
  expect(() => inTransaction(a, () => { throw new Error('x'); })).toThrow('x');
  expect(a.isTransaction).toBe(true);
  a.exec('ROLLBACK');
});

it('a writer killed mid-transaction leaves a hot journal the next writer rolls back', async () => { // Review Focus 1
  a.close();
  b.close();
  // a small cache spills the change into the file before the kill: the journal really has to be played back
  const c = child(`const { DatabaseSync } = require('node:sqlite'); const db = new DatabaseSync(process.argv[1]);
    db.exec('PRAGMA journal_mode=DELETE; PRAGMA cache_size=1; BEGIN IMMEDIATE');
    const ins = db.prepare('INSERT INTO "Clients" ("Nom") VALUES (?)');
    for (let i = 0; i < 200; i++) ins.run('killed' + 'x'.repeat(40));
    console.log('written'); process.kill(process.pid, 'SIGKILL');`);
  await new Promise((r) => c.on('exit', r));
  expect(fs.existsSync(`${p}-journal`)).toBe(true);
  a = openBaseFile(p, 'write', '0.0.0').db;
  b = new DatabaseSync(p);
  expect(await insertRow(a, tableDesign(a, 'Clients'), { Nom: 'after' }, fr)).toMatchObject({ ok: true });
  expect(a.prepare('PRAGMA integrity_check').get()).toEqual({ integrity_check: 'ok' });
  expect(a.prepare(`SELECT "Nom" FROM "Clients"`).all()).toEqual([{ Nom: 'after' }]);
});

it('a reader never blocks a commit for long: pages are statements, not transactions', async () => { // Review Focus 4
  const design = tableDesign(a, 'Clients');
  for (let i = 0; i < 30; i++) await insertRow(a, design, { Nom: `n${i}` }, fr);
  expect(readRows(b, design, { offset: 0, limit: 10 }).rows).toHaveLength(10);
  expect(b.isTransaction).toBe(false);
  expect(await insertRow(a, design, { Nom: 'between pages' }, fr)).toMatchObject({ ok: true }); // busy_timeout 50: a held lock would fail it
  expect(readRows(b, design, { offset: 10, limit: 10 }).rows).toHaveLength(10);
  expect(count(b, '"Clients"')).toBe(31);
});

it('an error inside the write rolls the immediate transaction back', () => { // R16: a write is never retried
  expect(() => inTransaction(a, () => { a.exec(`INSERT INTO t VALUES (1)`); throw corrupt(); })).toThrow();
  expect(a.isTransaction).toBe(false);
  expect(count(b, 't')).toBe(0);
});


it('busy inside the write (a statement past busy_timeout) is rolled back and reported bc:busy', async () => { // R7
  const busy = () => Object.assign(new Error('database is locked'), { errcode: 5 });
  expect(() => inTransaction(a, () => { a.exec(`INSERT INTO t VALUES (1)`); throw busy(); })).toThrow('bc:busy');
  expect(a.isTransaction).toBe(false);
  await expect(inTransactionAsync(a, async () => { a.exec(`INSERT INTO t VALUES (1)`); throw busy(); })).rejects.toThrow('bc:busy');
  expect(a.isTransaction).toBe(false);
  expect(count(b, 't')).toBe(0);
});
