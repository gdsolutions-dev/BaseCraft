import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { DEFAULT_STARTUP } from '../../shared/startup';
import { createBaseFile, openBaseFile, readOptions, updateOptions } from './file-format';
import { saveStartupOptions, startupOptions } from './startup';

// Every test writes a real base file (synchronous=FULL): a slow scan of the temp files must not fail one at random.
vi.setConfig({ testTimeout: 30_000, hookTimeout: 30_000 });

let dir: string;
let db: DatabaseSync;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bcstart-'));
  const p = path.join(dir, 'test.basecraft');
  createBaseFile(p, '0.0.0');
  db = openBaseFile(p, 'write', '0.0.0').db;
});
afterEach(() => {
  try { db.close(); } catch { /* already closed */ }
  fs.rmSync(dir, { recursive: true, force: true });
});

it('a new base has the defaults', () => {
  expect(startupOptions(db)).toEqual(DEFAULT_STARTUP);
});

it('round trip, other option keys and unknown startup keys kept', () => {
  updateOptions(db, (o) => { o.relationsLayout = { tables: {} }; o.startup = { v: 2, menuBar: 'X' }; });
  saveStartupOptions(db, { ...DEFAULT_STARTUP, appTitle: 'Gestion des ventes', runMode: true });
  expect(startupOptions(db)).toMatchObject({ appTitle: 'Gestion des ventes', runMode: true });
  expect(readOptions(db)).toMatchObject({ relationsLayout: { tables: {} }, startup: { v: 2, menuBar: 'X', runMode: true } });
});

it('a startup section that is not an object is replaced; a broken one never throws', () => {
  for (const bad of ['x', [1], 7, null]) {
    updateOptions(db, (o) => { o.startup = bad; });
    expect(startupOptions(db)).toEqual(DEFAULT_STARTUP);
    saveStartupOptions(db, { ...DEFAULT_STARTUP, ribbon: 'simplified' });
    expect(startupOptions(db).ribbon).toBe('simplified');
  }
});

it('an untrusted file with wrong values reads as the defaults', () => {
  updateOptions(db, (o) => { o.startup = { ribbon: 'custom', showNavPane: 'no', runMode: 1, appIcon: 'AAAA', startupForm: 'a.b' }; });
  expect(startupOptions(db)).toEqual(DEFAULT_STARTUP);
});
