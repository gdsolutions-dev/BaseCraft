import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { createBaseFile, openBaseFile } from './file-format';
import { createTable, tableDesign } from './schema';
import { insertRow, updateRow } from './write-layer';
import { alterTable } from './alter';
import { f, t } from '../../shared/test-fixtures';
import { localeInfo } from '../../shared/locale-format';
import { validateDesign } from '../../shared/field-types';

let dir: string;
let db: DatabaseSync;
const en = localeInfo('en-US');
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bccalc-'));
  const p = path.join(dir, 'test.basecraft');
  createBaseFile(p, '0.0.0');
  db = openBaseFile(p, 'write', '0.0.0').db;
});
afterEach(() => {
  try { db.close(); } catch { /* already closed */ }
  fs.rmSync(dir, { recursive: true, force: true });
});

const design = () => t('Lines', [f('N', 'autoNumber'), f('Qty', 'number'), f('Price', 'currency'), f('Total', 'currency', { calculated: '[Qty]*[Price]' })]);

describe('calculated fields', () => {
  it('stores the expression on insert and update; a typed value is ignored', async () => {
    const d = design();
    createTable(db, d);
    const r = await insertRow(db, d, { Qty: '3', Price: '2.5', Total: '99' }, en);
    expect(r.ok && r.values[3]).toBe(7.5);
    const u = await updateRow(db, d, r.ok ? r.rowid : 0, { Qty: '4', Total: '1' }, en);
    expect(u.ok && u.values[3]).toBe(10);
  });
  it('an evaluation error leaves Null', async () => {
    const d = design();
    createTable(db, d);
    const r = await insertRow(db, d, { Qty: '3' }, en);
    expect(r.ok && r.values[3]).toBeNull();
  });
  it('a table save computes a new calculated field for the rows already there', async () => {
    const d = t('Lines', [f('N', 'autoNumber'), f('Qty', 'number'), f('Price', 'currency')]);
    createTable(db, d);
    await insertRow(db, d, { Qty: '2', Price: '5' }, en);
    const next = design();
    const r = await alterTable(db, 'Lines', next, next.fields.map((x, i) => ({ name: x.name, sourceName: i < 3 ? x.name : null })), { allowDataLoss: false, info: en });
    expect(r.ok).toBe(true);
    expect(db.prepare('SELECT Total FROM Lines').get()).toEqual({ Total: 10 });
    expect(tableDesign(db, 'Lines').fields[3]!.props.calculated).toBe('[Qty]*[Price]');
  });
  it('refuses an expression on itself or on another calculated field', () => {
    const d = design();
    d.fields.push(f('Twice', 'currency', { calculated: '[Total]*2' }));
    d.fields[3]!.props.calculated = '[Total]+1';
    const errors = validateDesign(d);
    expect(errors.filter((e) => e.prop === 'calculated').map((e) => e.field)).toEqual(['Total', 'Twice']);
  });
});
