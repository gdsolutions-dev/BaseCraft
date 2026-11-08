import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { CANON } from '../shared/coerce';
import { applyScript } from './script';
import { newBase } from './new-base';
import { tmp } from './test-tmp';

const tables = [
  { op: 'table.create', name: 'Clients', fields: [{ name: 'ID', type: 'autoNumber', primaryKey: true }, { name: 'Nom', type: 'shortText', required: true }, { name: 'Le', type: 'dateTime' }, { name: 'Actif', type: 'yesNo', defaultValue: 'True' }] },
  { op: 'table.create', name: 'Commandes', fields: [{ name: 'ID', type: 'autoNumber', primaryKey: true }, { name: 'Client', type: 'number', numberSize: 'longInteger' }, { name: 'Montant', type: 'currency', validationRule: '>=0', validationText: 'Positif.' }] },
  { op: 'relation.create', parentTable: 'Clients', parentFields: ['ID'], childTable: 'Commandes', childFields: ['Client'] },
];
const base = async (ops: unknown[]) => { const p = tmp(); newBase(p, '0.3.1'); await applyScript(p, tables as never, CANON); const before = fs.readFileSync(p); return { p, before, r: await applyScript(p, ops as never, CANON) }; };
const rows = (p: string, sql: string) => { const db = new DatabaseSync(p, { readOnly: true }); try { return db.prepare(sql).all(); } finally { db.close(); } };
const message = (r: { ok: boolean; message?: string }) => (r.ok ? 'ok' : r.message);

describe('rows.insert', () => {
  it('inserts through the write layer: AutoNumber, canonical text values, defaults, relations', async () => {
    const { p, r } = await base([
      { op: 'rows.insert', table: 'clients', rows: [{ nom: 'Dupont', Le: '2026-01-31' }, { Nom: 'Durand', Le: '2026-02-01 14:30', Actif: false }] },
      { op: 'rows.insert', table: 'Commandes', rows: [{ Client: 2, Montant: '12.5' }, { Client: 1, Montant: 3 }] },
    ]);
    expect(r).toEqual({ ok: true, applied: 2, activeContent: false });
    expect(rows(p, 'SELECT ID, Nom, Actif FROM Clients ORDER BY ID')).toEqual([{ ID: 1, Nom: 'Dupont', Actif: 1 }, { ID: 2, Nom: 'Durand', Actif: 0 }]);
    expect(rows(p, 'SELECT Client, Montant FROM Commandes ORDER BY ID')).toEqual([{ Client: 2, Montant: 12.5 }, { Client: 1, Montant: 3 }]);
  });
  it.each([
    [{ table: 'Nope', rows: [] }, 'table not found: Nope'],
    [{ table: 'Clients', rows: {} }, '"rows" must be an array of objects'],
    [{ table: 'Clients', rows: [{ Nom: 'A' }, 3] }, 'row #1: must be an object of field values'],
    [{ table: 'Clients', rows: [{ Ville: 'X' }] }, 'row #0: field not found: Ville'],
    [{ table: 'Clients', rows: [{ Nom: ['A'] }] }, 'row #0, field "Nom": value must be a string, number, boolean or null'],
    [{ table: 'Clients', rows: [{ Le: '2026-01-01' }] }, 'row #0, field "Nom": required'],
    [{ table: 'Clients', rows: [{ Nom: 'A', Le: 'demain' }] }, 'row #0, field "Le": invalidDate'],
    [{ table: 'Commandes', rows: [{ Montant: -1 }] }, 'row #0, field "Montant": validation: Positif.'],
    [{ table: 'Commandes', rows: [{ Client: 9 }] }, 'row #0, field "Client": noParent (Clients)'],
  ])('refuses %j with the row and field, leaving the file untouched', async (args, expected) => {
    const { p, before, r } = await base([{ op: 'rows.insert', ...args }]);
    expect(message(r as never)).toBe(expected);
    expect(fs.readFileSync(p).equals(before)).toBe(true);
  });
});
