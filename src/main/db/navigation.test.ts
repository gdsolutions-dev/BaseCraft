import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { DEFAULT_NAV_OPTIONS } from '../../shared/nav-view';
import { createBaseFile, openBaseFile, readOptions, updateOptions } from './file-format';
import { navForget, navOptions, navRename, saveNavOptions } from './navigation';
import { deleteObject, renameObject, saveObject } from './objects';
import { createTable, dropTable, listTables, renameTable, writeTableMetadata, tableDesign } from './schema';
import { defaultProps } from '../../shared/field-types';

vi.setConfig({ testTimeout: 30_000, hookTimeout: 30_000 });

let dir: string;
let db: DatabaseSync;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bcnav-'));
  const p = path.join(dir, 'test.basecraft');
  createBaseFile(p, '0.0.0');
  db = openBaseFile(p, 'write', '0.0.0').db;
});
afterEach(() => {
  try { db.close(); } catch { /* already closed */ }
  fs.rmSync(dir, { recursive: true, force: true });
});

it('saving then reading gives the same options', () => {
  expect(navOptions(db)).toEqual(DEFAULT_NAV_OPTIONS);
  const o = { ...DEFAULT_NAV_OPTIONS, category: 'created', viewBy: 'icon' as const, singleClick: true };
  saveNavOptions(db, o);
  expect(navOptions(db)).toEqual(o);
});

it('save keeps other options keys and unknown navigation keys', () => {
  updateOptions(db, (o) => { o.startup = { appTitle: 'x' }; o.navigation = { future: 1 }; });
  saveNavOptions(db, { ...DEFAULT_NAV_OPTIONS, searchBar: false });
  const opts = readOptions(db);
  expect(opts.startup).toEqual({ appTitle: 'x' });
  expect((opts.navigation as Record<string, unknown>).future).toBe(1);
  expect(navOptions(db).searchBar).toBe(false);
});

const design = () => ({ name: 'T', fields: [{ name: 'a', props: defaultProps('shortText') }] });

it('createTable dates the table, a later metadata write moves only modified', async () => {
  vi.useFakeTimers();
  try {
    vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'));
    createTable(db, design());
    expect(listTables(db)[0]).toMatchObject({ created: '2026-01-01T00:00:00.000Z', modified: '2026-01-01T00:00:00.000Z' });
    vi.setSystemTime(new Date('2026-02-01T00:00:00.000Z'));
    const d = tableDesign(db, 'T');
    writeTableMetadata(db, { ...d, extra: { ...d.extra, created: '1999-01-01T00:00:00.000Z', modified: '1999-01-01T00:00:00.000Z' } });
    expect(listTables(db)[0]).toMatchObject({ created: '2026-01-01T00:00:00.000Z', modified: '2026-02-01T00:00:00.000Z' });
  } finally { vi.useRealTimers(); }
});

it('a legacy table without the keys has no dates', () => {
  createTable(db, design());
  db.prepare("UPDATE bc_tables SET props = '{}' WHERE name = 'T'").run();
  const t = listTables(db)[0];
  expect(t.created).toBeUndefined();
  expect(t.modified).toBeUndefined();
});

it('rename and drop keep groups in step', () => {
  createTable(db, { name: 'Clients', fields: [{ name: 'a', props: defaultProps('shortText') }] });
  saveObject(db, 'form', 'FCli', {}, null);
  saveObject(db, 'form', 'Clients', {}, null);
  const keys = ['table:Clients', 'form:FCli', 'form:Clients'];
  saveNavOptions(db, { ...DEFAULT_NAV_OPTIONS, categories: [{ id: 'k', name: 'K', groups: [{ id: 'g', name: 'G', items: keys }] }], hidden: keys, hiddenIn: keys.map((k) => `k|g|${k}`) });
  const all = () => { const o = navOptions(db); return [o.categories[0].groups[0].items, o.hidden, o.hiddenIn.map((k) => k.slice(4))]; };
  renameTable(db, 'Clients', 'Clients2');
  renameObject(db, 'form', 'FCli', 'FCli2');
  for (const l of all()) expect(l).toEqual(['table:Clients2', 'form:FCli2', 'form:Clients']);
  renameTable(db, 'Clients2', 'CLIENTS2'); // case only
  expect(all()[0][0]).toBe('table:CLIENTS2');
  dropTable(db, 'CLIENTS2');
  deleteObject(db, 'form', 'FCli2');
  for (const l of all()) expect(l).toEqual(['form:Clients']);
});

it('a designer save that renames keeps groups in step', () => {
  saveObject(db, 'form', 'FCli', {}, null);
  const keys = ['form:FCli'];
  saveNavOptions(db, { ...DEFAULT_NAV_OPTIONS, categories: [{ id: 'k', name: 'K', groups: [{ id: 'g', name: 'G', items: keys }] }], hidden: keys, hiddenIn: ['k|g|form:FCli'] });
  expect(saveObject(db, 'form', 'FCli2', {}, 'FCli')).toEqual({ ok: true });
  const o = navOptions(db);
  expect([o.categories[0].groups[0].items, o.hidden, o.hiddenIn]).toEqual([['form:FCli2'], ['form:FCli2'], ['k|g|form:FCli2']]);
});

it('navRename and navForget do not create nor rewrite the section', () => {
  navRename(db, 'table', 'A', 'B');
  navForget(db, 'table', 'A');
  expect(readOptions(db).navigation).toBeUndefined();
  updateOptions(db, (o) => { o.navigation = { future: 1 }; });
  const before = JSON.stringify(readOptions(db));
  navRename(db, 'table', 'A', 'B');
  expect(JSON.stringify(readOptions(db))).toBe(before);
});
