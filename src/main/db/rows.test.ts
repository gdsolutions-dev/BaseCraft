import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { createBaseFile, openBaseFile } from './file-format';
import { createTable } from './schema';
import { insertRow } from './write-layer';
import { countRows, readRows, type RowPage } from './rows';
import { f, t } from '../../shared/test-fixtures';
import { localeInfo } from '../../shared/locale-format';

let dir: string;
let db: DatabaseSync;
const fr = localeInfo('fr-FR');
const notes = t('Notes', [f('Txt', 'shortText'), f('Dec', 'number', { numberSize: 'decimal', precision: 5, scale: 2 })]);

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bcrows-'));
  const p = path.join(dir, 'test.basecraft');
  createBaseFile(p, '0.0.0');
  db = openBaseFile(p, 'write', '0.0.0').db;
  createTable(db, notes);
});
afterEach(() => {
  try { db.close(); } catch { /* already closed */ }
  fs.rmSync(dir, { recursive: true, force: true });
});

const col = (page: RowPage, i: number) => page.rows.map((r) => r.values[i]);

describe('readRows (brief)', () => {
  it('sorts text accent- and case-insensitively, nulls first', async () => {
    for (const v of ['b', 'É', 'e', null, 'a']) await insertRow(db, notes, { Txt: v }, fr);
    expect(col(readRows(db, notes, { offset: 0, limit: 10, sort: { field: 'Txt', dir: 'asc' } }), 0)).toEqual([null, 'a', 'b', 'e', 'É']);
  });
  it('sorts decimals numerically', async () => {
    for (const v of ['10', '9']) await insertRow(db, notes, { Dec: v }, fr);
    expect(col(readRows(db, notes, { offset: 0, limit: 10, sort: { field: 'Dec', dir: 'asc' } }), 1)).toEqual(['9.00', '10.00']);
  });
  it('pages stably with ties', async () => {
    db.exec('BEGIN'); for (let i = 0; i < 500; i++) await insertRow(db, notes, { Txt: 'same' }, fr); db.exec('COMMIT');
    const ids = [0, 200, 400].flatMap((o) => readRows(db, notes, { offset: o, limit: 200, sort: { field: 'Txt', dir: 'asc' } }).rows.map((r) => r.rowid));
    expect(new Set(ids).size).toBe(500);
  });
});

describe('readRows (extra)', () => {
  it('desc puts nulls last', async () => {
    for (const v of ['b', null, 'a']) await insertRow(db, notes, { Txt: v }, fr);
    expect(col(readRows(db, notes, { offset: 0, limit: 10, sort: { field: 'Txt', dir: 'desc' } }), 0)).toEqual(['b', 'a', null]);
  });
  it('defaults to rowid order and counts', async () => {
    for (const v of ['b', 'a']) await insertRow(db, notes, { Txt: v }, fr);
    expect(readRows(db, notes, { offset: 0, limit: 10 }).rows.map((r) => r.rowid)).toEqual([1, 2]);
    expect(countRows(db, 'Notes')).toBe(2);
  });
  it('folds accents before comparing', async () => {
    for (const v of ['f', 'é', 'd']) await insertRow(db, notes, { Txt: v }, fr);
    expect(col(readRows(db, notes, { offset: 0, limit: 10, sort: { field: 'Txt', dir: 'asc' } }), 0)).toEqual(['d', 'é', 'f']);
  });
  it('throws when the sort field is not in the design', async () => {
    expect(() => readRows(db, notes, { offset: 0, limit: 10, sort: { field: 'Nope', dir: 'asc' } })).toThrow();
  });
  it('reads rowids correctly when a field is named bc_rowid', async () => {
    const d = t('B', [f('bc_rowid', 'shortText')]);
    createTable(db, d);
    await insertRow(db, d, { bc_rowid: 'x' }, fr);
    expect(readRows(db, d, { offset: 0, limit: 5 }).rows).toEqual([{ rowid: 1, values: ['x'] }]);
  });
});
