import { describe, expect, it } from 'vitest';
import { CliUsageError } from './errors';
import { parseScript, applyScript } from './script';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { CANON } from '../shared/coerce';
import { registerFunctions } from '../main/db/file-format';
import { listRelations } from '../main/db/relations';
import { newBase } from './new-base';

const tmp = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'bccli-')), 'x.basecraft');

describe('parseScript', () => {
  it('parses an array of ops', () => {
    expect(parseScript('[{"op":"table.create"}]')).toEqual([{ op: 'table.create' }]);
  });
  it('rejects non-array JSON', () => {
    expect(() => parseScript('{"op":"table.create"}')).toThrow(CliUsageError);
  });
  it('rejects an entry without a string op', () => {
    expect(() => parseScript('[{"x":1}]')).toThrow(CliUsageError);
  });
  it('rejects invalid JSON with the position of the error', () => {
    expect(() => parseScript('[')).toThrow(/JSON/);
  });
});

describe('relation.create', () => {
  it('creates a relation between two tables of the same script', () => {
    const p = tmp(); newBase(p, '0.3.1');
    const r = applyScript(p, [
      { op: 'table.create', name: 'Clients', fields: [{ name: 'ID', type: 'autoNumber' }] },
      { op: 'table.create', name: 'Commandes', fields: [{ name: 'ID', type: 'autoNumber' }, { name: 'ClientID', type: 'number', numberSize: 'longInteger' }] },
      { op: 'relation.create', parentTable: 'Clients', parentFields: ['ID'], childTable: 'Commandes', childFields: ['ClientID'] },
    ], CANON);
    expect(r).toEqual({ ok: true, applied: 3 });
    const db = new DatabaseSync(p); registerFunctions(db);
    expect(listRelations(db)).toHaveLength(1);
    db.close();
  });
  it('enforces integrity by default', () => {
    const p = tmp(); newBase(p, '0.3.1');
    applyScript(p, [
      { op: 'table.create', name: 'Clients', fields: [{ name: 'ID', type: 'autoNumber' }] },
      { op: 'table.create', name: 'Commandes', fields: [{ name: 'ID', type: 'autoNumber' }, { name: 'ClientID', type: 'number', numberSize: 'longInteger' }] },
      { op: 'relation.create', parentTable: 'Clients', parentFields: ['ID'], childTable: 'Commandes', childFields: ['ClientID'] },
    ], CANON);
    const db = new DatabaseSync(p); registerFunctions(db);
    expect(listRelations(db)[0].enforce).toBe(true);
    db.close();
  });
  it('refuses a relation to a missing table with a readable message', () => {
    const p = tmp(); newBase(p, '0.3.1');
    const r = applyScript(p, [{ op: 'relation.create', parentTable: 'Nope', parentFields: ['ID'], childTable: 'Nope2', childFields: ['X'] }], CANON);
    expect(r).toMatchObject({ ok: false, message: 'table not found: Nope' });
  });
  it('refuses bad argument shapes', () => {
    const p = tmp(); newBase(p, '0.3.1');
    const r = applyScript(p, [{ op: 'relation.create', parentTable: 'A', parentFields: 'ID', childTable: 'B', childFields: ['X'] }], CANON);
    expect(r.ok).toBe(false);
  });
});
