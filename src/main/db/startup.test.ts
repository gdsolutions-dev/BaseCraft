import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { DEFAULT_STARTUP } from '../../shared/startup';
import { createBaseFile, openBaseFile, readOptions, updateOptions } from './file-format';
import { peekStartup, saveStartupOptions, startupOptions } from './startup';

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

it('peekStartup: the options of a base, null for a file that is not one, cannotOpen when its metadata cannot be read', () => {
  const p = path.join(dir, 'test.basecraft');
  saveStartupOptions(db, { ...DEFAULT_STARTUP, dataFile: true });
  expect(peekStartup(p)?.dataFile).toBe(true);
  const other = path.join(dir, 'other.txt');
  fs.writeFileSync(other, 'not a base');
  expect(peekStartup(other)).toBeNull();
  db.exec('DROP TABLE bc_meta');
  expect(() => peekStartup(p)).toThrow(expect.objectContaining({ code: 'cannotOpen' }));
});

it('a new base has the defaults', () => {
  expect(startupOptions(db)).toEqual(DEFAULT_STARTUP);
});

it('round trip, other option keys and unknown startup keys kept', () => {
  updateOptions(db, (o) => { o.relationsLayout = { tables: {} }; o.startup = { v: 2, menuBar: 'X', future: 1 }; });
  saveStartupOptions(db, { ...DEFAULT_STARTUP, appTitle: 'Gestion des ventes', runMode: true, statusBar: false, compactOnClose: true });
  expect(startupOptions(db)).toMatchObject({ appTitle: 'Gestion des ventes', runMode: true, statusBar: false, compactOnClose: true });
  expect(readOptions(db)).toMatchObject({ relationsLayout: { tables: {} }, startup: { v: 2, menuBar: 'X', future: 1, runMode: true, statusBar: false, compactOnClose: true } });
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
  // the eight O1 switches read key by key: the wrong ones give their default, the right one is kept (Review Focus 2)
  updateOptions(db, (o) => { o.startup = { statusBar: 'no', fullMenus: 0, specialKeys: false, documentTabs: null, future: { x: 1 } }; });
  expect(startupOptions(db)).toEqual({ ...DEFAULT_STARTUP, specialKeys: false });
});
