import { describe, expect, it } from 'vitest';
import { CliUsageError } from './errors';
import { parseScript, applyScript } from './script';
import fs from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { CANON } from '../shared/coerce';
import { registerFunctions } from '../main/db/file-format';
import { listRelations } from '../main/db/relations';
import { newBase } from './new-base';
import { tmp } from './test-tmp';


describe('parseScript', () => {
  it('parses an array of ops', async () => {
    expect(parseScript('[{"op":"table.create"}]')).toEqual([{ op: 'table.create' }]);
  });
  it('rejects non-array JSON', async () => {
    expect(() => parseScript('{"op":"table.create"}')).toThrow(CliUsageError);
  });
  it('rejects an entry without a string op', async () => {
    expect(() => parseScript('[{"x":1}]')).toThrow(CliUsageError);
  });
  it('rejects invalid JSON with the position of the error', async () => {
    expect(() => parseScript('[')).toThrow(/JSON/);
  });
});

describe('table.create', () => {
  it('refuses a name a dangling foreign key still references, naming the referencing table', async () => {
    const p = tmp(); newBase(p, '0.3.1');
    const raw = new DatabaseSync(p);
    raw.exec('CREATE TABLE "Ghost" ("id" INTEGER PRIMARY KEY); CREATE TABLE "Orph" ("g" INTEGER REFERENCES "Ghost" ("id"))');
    raw.exec('PRAGMA foreign_keys=OFF; DROP TABLE "Ghost"');
    raw.close();
    const before = fs.readFileSync(p);
    const r = await applyScript(p, [{ op: 'table.create', name: 'Ghost', fields: [{ name: 'ID', type: 'autoNumber' }] }], CANON);
    expect(r).toMatchObject({ ok: false, index: 0, op: 'table.create', message: expect.stringContaining('"Orph"') });
    expect(fs.readFileSync(p).equals(before)).toBe(true);
  });
});

describe('relation.create', () => {
  it('creates a relation between two tables of the same script', async () => {
    const p = tmp(); newBase(p, '0.3.1');
    const r = await applyScript(p, [
      { op: 'table.create', name: 'Clients', fields: [{ name: 'ID', type: 'autoNumber' }] },
      { op: 'table.create', name: 'Commandes', fields: [{ name: 'ID', type: 'autoNumber' }, { name: 'ClientID', type: 'number', numberSize: 'longInteger' }] },
      { op: 'relation.create', parentTable: 'Clients', parentFields: ['ID'], childTable: 'Commandes', childFields: ['ClientID'] },
    ], CANON);
    expect(r).toEqual({ ok: true, applied: 3, activeContent: false });
    const db = new DatabaseSync(p); registerFunctions(db);
    expect(listRelations(db)).toHaveLength(1);
    db.close();
  });
  it('enforces integrity by default', async () => {
    const p = tmp(); newBase(p, '0.3.1');
    await applyScript(p, [
      { op: 'table.create', name: 'Clients', fields: [{ name: 'ID', type: 'autoNumber' }] },
      { op: 'table.create', name: 'Commandes', fields: [{ name: 'ID', type: 'autoNumber' }, { name: 'ClientID', type: 'number', numberSize: 'longInteger' }] },
      { op: 'relation.create', parentTable: 'Clients', parentFields: ['ID'], childTable: 'Commandes', childFields: ['ClientID'] },
    ], CANON);
    const db = new DatabaseSync(p); registerFunctions(db);
    expect(listRelations(db)[0].enforce).toBe(true);
    db.close();
  });
  it('refuses a relation to a missing table with a readable message', async () => {
    const p = tmp(); newBase(p, '0.3.1');
    const r = await applyScript(p, [{ op: 'relation.create', parentTable: 'Nope', parentFields: ['ID'], childTable: 'Nope2', childFields: ['X'] }], CANON);
    expect(r).toMatchObject({ ok: false, message: 'table not found: Nope' });
  });
  it('refuses bad argument shapes', async () => {
    const p = tmp(); newBase(p, '0.3.1');
    const r = await applyScript(p, [{ op: 'relation.create', parentTable: 'A', parentFields: 'ID', childTable: 'B', childFields: ['X'] }], CANON);
    expect(r.ok).toBe(false);
  });
});
