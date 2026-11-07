import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { CANON } from '../shared/coerce';
import { getObject, listObjects } from '../main/db/objects';
import { registerFunctions } from '../main/db/file-format';
import { newBase } from './new-base';
import { buildQueryDefinition } from './ops';
import { applyScript } from './script';
import { tmp } from './test-tmp';

const clients = { op: 'table.create', name: 'Clients', fields: [{ name: 'ID', type: 'autoNumber' }, { name: 'Nom', type: 'shortText' }] };

describe('buildQueryDefinition', () => {
  it('builds a version 1.0 definition holding the SQL as given', () => {
    expect(buildQueryDefinition('SELECT * FROM Clients')).toEqual({ formatVersion: '1.0', sql: 'SELECT * FROM Clients' });
  });
  it('refuses a pass-through (2.x) shape: this tranche only builds 1.x queries', () => {
    expect(() => buildQueryDefinition('x', '2.0')).toThrow(/pass-through/);
  });
});

describe('query.create', () => {
  it('creates a query over a table of the same script', () => {
    const p = tmp(); newBase(p, '0.3.1');
    const r = applyScript(p, [clients, { op: 'query.create', name: 'QClients', sql: 'SELECT ID, Nom FROM Clients' }], CANON);
    expect(r).toEqual({ ok: true, applied: 2 });
    const db = new DatabaseSync(p); registerFunctions(db);
    expect(listObjects(db, 'query').map((o) => o.name)).toEqual(['QClients']);
    db.close();
  });
  it('refuses a syntax error with its position, file unchanged', () => {
    const p = tmp(); newBase(p, '0.3.1'); const before = fs.readFileSync(p);
    const r = applyScript(p, [{ op: 'query.create', name: 'Q', sql: 'SELECT FROM' }], CANON);
    expect(r).toMatchObject({ ok: false, index: 0, op: 'query.create' });
    expect(r.ok === false && r.message).toMatch(/^invalidQuery\|\w+\|\d+$/);
    expect(fs.readFileSync(p).equals(before)).toBe(true);
  });
  it('refuses a query over a missing table, file unchanged', () => {
    const p = tmp(); newBase(p, '0.3.1'); const before = fs.readFileSync(p);
    const r = applyScript(p, [{ op: 'query.create', name: 'Q', sql: 'SELECT * FROM Nope' }], CANON);
    expect(r).toMatchObject({ ok: false, index: 0 });
    expect(r.ok === false && r.message).toMatch(/^queryBind\|/);
    expect(fs.readFileSync(p).equals(before)).toBe(true);
  });
  it('refuses a query named like an existing table', () => {
    const p = tmp(); newBase(p, '0.3.1');
    const r = applyScript(p, [clients, { op: 'query.create', name: 'clients', sql: 'SELECT ID FROM Clients' }], CANON);
    expect(r).toMatchObject({ ok: false, index: 1, message: 'query name already used: clients' });
  });
  it('refuses a query that refers to itself', () => {
    const p = tmp(); newBase(p, '0.3.1');
    const r = applyScript(p, [clients, { op: 'query.create', name: 'A', sql: 'SELECT * FROM A' }], CANON);
    expect(r).toMatchObject({ ok: false, index: 1, message: expect.stringMatching(/^queryBind\|/) });
  });
  it('refuses an action query before validation, file unchanged', () => {
    const p = tmp(); newBase(p, '0.3.1'); const before = fs.readFileSync(p);
    const r = applyScript(p, [{ op: 'query.create', name: 'Q', sql: 'UPDATE Nope SET X = 1' }], CANON);
    expect(r).toMatchObject({ ok: false, index: 0, message: 'action and crosstab queries are not supported by basecraft-cli yet' });
    expect(fs.readFileSync(p).equals(before)).toBe(true);
  });
  it('refuses a crosstab query before validation, file unchanged', () => {
    const p = tmp(); newBase(p, '0.3.1'); const before = fs.readFileSync(p);
    const r = applyScript(p, [{ op: 'query.create', name: 'Q', sql: 'TRANSFORM Count(ID) SELECT Nom FROM Nope GROUP BY Nom PIVOT Nom' }], CANON);
    expect(r).toMatchObject({ ok: false, index: 0, message: 'action and crosstab queries are not supported by basecraft-cli yet' });
    expect(fs.readFileSync(p).equals(before)).toBe(true);
  });
  it('refuses bad argument shapes', () => {
    const p = tmp(); newBase(p, '0.3.1');
    expect(applyScript(p, [{ op: 'query.create', name: 1, sql: 'SELECT 1' }], CANON)).toMatchObject({ ok: false, message: '"name" must be a string' });
    expect(applyScript(p, [{ op: 'query.create', name: 'Q', sql: 1 }], CANON)).toMatchObject({ ok: false, message: '"sql" must be a string' });
    expect(applyScript(p, [{ op: 'query.create', name: 'Q', sql: 'SELECT 1', description: 2 }], CANON)).toMatchObject({ ok: false, message: '"description" must be a string' });
  });
  it('stores the description and an NFD name in NFC', () => {
    const p = tmp(); newBase(p, '0.3.1');
    const r = applyScript(p, [clients, { op: 'query.create', name: 'ÉtéQ', sql: 'SELECT ID FROM Clients', description: 'Liste' }], CANON);
    expect(r.ok).toBe(true);
    const db = new DatabaseSync(p); registerFunctions(db);
    expect(listObjects(db, 'query')[0]).toMatchObject({ name: 'ÉtéQ', description: 'Liste' });
    db.close();
  });
  it('the saved definition is the one the application reads back', () => {
    const p = tmp(); newBase(p, '0.3.1');
    applyScript(p, [clients, { op: 'query.create', name: 'Q', sql: 'SELECT ID FROM Clients' }], CANON);
    const db = new DatabaseSync(p); registerFunctions(db);
    expect(getObject(db, 'query', 'Q')?.definition).toEqual({ formatVersion: '1.0', sql: 'SELECT ID FROM Clients' });
    db.close();
  });
});
