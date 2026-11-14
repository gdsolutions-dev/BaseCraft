import { afterEach, beforeEach, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { createBaseFile, openBaseFile } from '../db/file-format';
import { deleteSavedImport, loadSavedImports, saveSavedImport } from './saved';
import { validSavedImport, type SavedImport } from '../../shared/exchange';
import { defaultSpec } from '../../shared/import-text';
import { localeInfo } from '../../shared/locale-format';

let dir: string;
let db: DatabaseSync;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bcsi-'));
  const p = path.join(dir, 'test.basecraft');
  createBaseFile(p, '0.0.0');
  db = openBaseFile(p, 'write', '0.0.0').db;
});
afterEach(() => {
  try { db.close(); } catch { /* already closed */ }
  fs.rmSync(dir, { recursive: true, force: true });
});

const spec = defaultSpec(localeInfo('en-US'));
const text: SavedImport = { source: 'text', plan: { spec, target: { kind: 'new', table: 'Clients', primaryKey: { kind: 'auto' } } } };

it('saved imports: save, list, delete; a damaged entry is ignored', () => {
  saveSavedImport(db, 'Import - Clients', text);
  saveSavedImport(db, 'Sheet', { source: 'excel', sheet: 'Feuil1', plan: { spec, target: { kind: 'append', table: 'Clients', mapping: ['A', null] } } });
  expect(Object.keys(loadSavedImports(db))).toEqual(['Import - Clients', 'Sheet']);
  expect(() => saveSavedImport(db, 'x', { source: 'excel', plan: text.plan })).toThrow('bc:invalidArgument'); // Excel needs its sheet
  expect(() => saveSavedImport(db, ' bad', text)).toThrow('bc:invalidArgument');
  expect(validSavedImport({ source: 'text', plan: { spec: { ...spec, format: 'x' }, target: text.plan.target } })).toBeNull();
  deleteSavedImport(db, 'Sheet');
  expect(Object.keys(loadSavedImports(db))).toEqual(['Import - Clients']);
  expect(loadSavedImports(db)['Import - Clients']).toEqual(text);
});
