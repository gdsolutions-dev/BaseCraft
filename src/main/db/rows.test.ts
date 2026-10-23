import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { createBaseFile, openBaseFile } from './file-format';
import { saveObject } from './objects';
import { createTable, dropTable, renameTable, tableDesign } from './schema';
import { insertRow } from './write-layer';
import { countRows, LOOKUP_MAX, lookupRows, readRows, type RowPage } from './rows';
import { clients, f, t } from '../../shared/test-fixtures';
import type { LookupProps } from '../../shared/field-types';
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
  it('breaks ties as Access compares texts (case ignored, accents kept): "zoe" before "Zoé", then the row order', async () => {
    for (const v of ['Zoé', 'zoe', 'ZOE']) await insertRow(db, notes, { Txt: v }, fr);
    expect(col(readRows(db, notes, { offset: 0, limit: 10, sort: { field: 'Txt', dir: 'asc' } }), 0)).toEqual(['zoe', 'ZOE', 'Zoé']);
    expect(col(readRows(db, notes, { offset: 0, limit: 10, sort: { field: 'Txt', dir: 'desc' } }), 0)).toEqual(['Zoé', 'ZOE', 'zoe']);
  });
  it('pins the order of mixed case, NFD, ligatures, ß and Null (bc_fold then bc_gkey)', async () => {
    const vals = ['STRASSE', 'Œuvre', 'été', 'oeuvre', 'Été', 'straße', 'ete', 'ÉTÉ', 'İle', 'ile'];
    for (const v of vals) await insertRow(db, notes, { Txt: v }, fr);
    db.exec(`INSERT INTO "Notes" ("Txt") VALUES (NULL)`);
    expect(col(readRows(db, notes, { offset: 0, limit: 20, sort: { field: 'Txt', dir: 'asc' } }), 0)).toEqual([
      null, 'ete', 'été', 'Été', 'ÉTÉ', 'ile', 'İle', 'oeuvre', 'STRASSE', 'straße', 'Œuvre',
    ]);
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

describe('lookupRows (Lookup fields)', () => {
  const byTable = (over: Partial<Extract<LookupProps, { kind: 'table' }>> = {}): LookupProps =>
    ({ kind: 'table', table: 'Clients', boundField: 'N°', displayFields: ['Nom', 'Solde'], limitToList: false, ...over });
  const cmd = (lookup: LookupProps, type: 'number' | 'shortText' = 'number') =>
    t('Commandes', [f('Client', type, type === 'number' ? { numberSize: 'double', lookup } : { lookup })]);
  const listOf = (...a: Parameters<typeof lookupRows>) => lookupRows(...a).rows;

  it('a value list keeps its order; each value converted as the field stores it, as typed when it does not convert', () => {
    // a Number's items are stored canonical ('.' decimal): the same values in every region, shown in the region
    const d = cmd({ kind: 'values', values: ['2.5', '1', 'abc'], limitToList: true });
    expect(listOf(db, d, 'Client', fr)).toEqual([
      { value: 2.5, display: ['2,5'] }, { value: 1, display: ['1'] }, { value: 'abc', display: ['abc'] },
    ]);
    expect(listOf(db, d, 'Client', localeInfo('en-US'))).toEqual([
      { value: 2.5, display: ['2.5'] }, { value: 1, display: ['1'] }, { value: 'abc', display: ['abc'] },
    ]);
    expect(listOf(db, cmd({ kind: 'values', values: ['Ouverte', 'Fermée'], limitToList: false }, 'shortText'), 'Client', fr))
      .toEqual([{ value: 'Ouverte', display: ['Ouverte'] }, { value: 'Fermée', display: ['Fermée'] }]);
  });

  it('a table source: bound value and displayed fields as text, sorted on the first displayed field (case and accents folded)', async () => {
    createTable(db, clients);
    for (const [Nom, Solde] of [['Martin', '12,5'], ['dupont', null], ['Émile', '3']]) await insertRow(db, clients, { Nom, Solde }, fr);
    expect(listOf(db, cmd(byTable()), 'Client', fr)).toEqual([
      { value: 2, display: ['dupont', ''] }, { value: 3, display: ['Émile', '3'] }, { value: 1, display: ['Martin', '12,5'] },
    ]);
    // names resolve as table and field names do (case ignored)
    expect(listOf(db, cmd(byTable({ table: 'clients', boundField: 'n°', displayFields: ['nom'] })), 'Client', fr).map((r) => r.value)).toEqual([2, 3, 1]);
  });

  it('a WITHOUT ROWID source table (made by another tool) gives its list, sorted on the first displayed field then the bound one', () => {
    db.exec(`CREATE TABLE Pays (Code TEXT PRIMARY KEY, Nom TEXT) WITHOUT ROWID; INSERT INTO Pays VALUES ('FR', 'France'), ('BE', 'Belgique'), ('XX', 'France')`);
    const d = t('Envois', [f('Pays', 'shortText', { lookup: { kind: 'table', table: 'Pays', boundField: 'Code', displayFields: ['Nom'], limitToList: true } })]);
    expect(listOf(db, d, 'Pays', fr)).toEqual([
      { value: 'BE', display: ['Belgique'] }, { value: 'FR', display: ['France'] }, { value: 'XX', display: ['France'] },
    ]);
  });

  it('at most LOOKUP_MAX (5000) rows', () => {
    expect(LOOKUP_MAX).toBe(5000);
    createTable(db, clients);
    db.exec('BEGIN');
    const ins = db.prepare('INSERT INTO "Clients" ("Nom") VALUES (?)');
    for (let i = 0; i <= LOOKUP_MAX; i++) ins.run(`n${String(i).padStart(5, '0')}`);
    db.exec('COMMIT');
    const rows = listOf(db, cmd(byTable({ displayFields: ['Nom'] })), 'Client', fr);
    expect(rows).toHaveLength(LOOKUP_MAX);
    expect(rows[0]).toEqual({ value: 1, display: ['n00000'] });
  });

  it('no list: a source table or field that is gone, a field without lookup, a type without lookup, an unknown field', () => {
    expect(listOf(db, cmd(byTable()), 'Client', fr)).toEqual([]); // no Clients table
    createTable(db, clients);
    expect(listOf(db, cmd(byTable({ boundField: 'Nope' })), 'Client', fr)).toEqual([]);
    expect(listOf(db, cmd(byTable({ displayFields: ['Nom', 'Nope'] })), 'Client', fr)).toEqual([]);
    renameTable(db, 'Clients', 'Contacts');
    expect(listOf(db, cmd(byTable()), 'Client', fr)).toEqual([]);
    expect(dropTable(db, 'Contacts')).toEqual({ ok: true });
    const values: LookupProps = { kind: 'values', values: ['a'], limitToList: false };
    expect(listOf(db, t('T', [f('A', 'shortText')]), 'A', fr)).toEqual([]);
    expect(listOf(db, t('T', [f('A', 'dateTime', { lookup: values })]), 'A', fr)).toEqual([]);
    expect(listOf(db, t('T', [f('A', 'shortText', { lookup: values })]), 'B', fr)).toEqual([]);
  });
  it('renaming the source table: the stored lookups (table and field list) follow it, the list still resolves (Name AutoCorrect)', async () => {
    createTable(db, clients);
    await insertRow(db, clients, { Nom: 'Martin' }, fr);
    createTable(db, t('Commandes', [
      f('Client', 'number', { numberSize: 'double', lookup: byTable({ table: 'clients', displayFields: ['Nom'], limitToList: true }) }),
      f('Champ', 'shortText', { lookup: { kind: 'fieldList', table: 'Clients', limitToList: false } }),
      f('Autre', 'shortText', { lookup: byTable({ table: 'Notes', boundField: 'Txt', displayFields: ['Txt'] }) }),
    ]));
    renameTable(db, 'Clients', 'Contacts');
    const d = tableDesign(db, 'Commandes');
    expect(d.fields.map((x) => (x.props.lookup as { table: string }).table)).toEqual(['Contacts', 'Contacts', 'Notes']);
    expect(listOf(db, d, 'Client', fr)).toEqual([{ value: 1, display: ['Martin'] }]);
    expect(await insertRow(db, d, { Client: '77' }, fr, undefined, { enforceMask: true })).toMatchObject({ ok: false, errors: [{ code: 'notInList' }] });
  });
  it('Access columns over a table: Column Count first fields, Bound Column, a width of 0 hides; heads from captions (else names)', async () => {
    const villes = t('Villes', [f('Code', 'shortText', { primaryKey: true }), f('Nom', 'shortText', { caption: 'Ville' }), f('Pop', 'number')]);
    createTable(db, villes);
    for (const [Code, Nom, Pop] of [['69', 'Lyon', '500'], ['13', 'Marseille', '870'], ['01', 'Bourg', '40']]) await insertRow(db, villes, { Code, Nom, Pop }, fr);
    const l: LookupProps = { kind: 'table', table: 'Villes', boundColumn: 1, columnCount: 3, columnWidths: [0, 2000], columnHeads: true, limitToList: false };
    expect(lookupRows(db, cmd(l, 'shortText'), 'Client', fr)).toEqual({
      heads: ['Ville', 'Pop'], widths: [2000, 1440],
      rows: [{ value: '01', display: ['Bourg', '40'] }, { value: '69', display: ['Lyon', '500'] }, { value: '13', display: ['Marseille', '870'] }],
    });
    // bound to a column past Column Count (Access allows it); the shown text is the first visible column
    expect(lookupRows(db, cmd({ ...l, boundColumn: 3, columnCount: 2, columnHeads: false }, 'shortText'), 'Client', fr).rows[0]).toEqual({ value: 40, display: ['Bourg'] });
    expect(lookupRows(db, cmd({ ...l, boundColumn: 4 }, 'shortText'), 'Client', fr)).toEqual({ rows: [], widths: [] }); // no 4th field
  });

  it('a value list in rows of Column Count: Bound Column, hidden columns, the first row as heads', () => {
    const l: LookupProps = { kind: 'values', values: ['N°', 'Statut', '1.5', 'Ouverte', '2', 'Fermée'], columnCount: 2, columnWidths: [0], columnHeads: true, limitToList: false };
    expect(lookupRows(db, cmd(l), 'Client', fr)).toEqual({
      heads: ['Statut'], widths: [1440], rows: [{ value: 1.5, display: ['Ouverte'] }, { value: 2, display: ['Fermée'] }],
    });
    expect(lookupRows(db, cmd({ ...l, columnWidths: undefined, columnHeads: false }), 'Client', fr).rows[1]).toEqual({ value: 1.5, display: ['1,5', 'Ouverte'] });
  });

  it("a Field List gives the source table's field names", () => {
    createTable(db, clients);
    expect(lookupRows(db, cmd({ kind: 'fieldList', table: 'clients', limitToList: false }, 'shortText'), 'Client', fr)).toEqual({
      widths: [1440], rows: clients.fields.map((x) => ({ value: x.name, display: [x.name] })),
    });
  });

  it('SQL text or a saved query name (A2-R18, served by A3): its rows in the query order, Access columns over its output', async () => {
    createTable(db, clients);
    for (const [Nom, Solde] of [['Martin', '12,5'], ['Dupont', null], ['Émile', '3']]) await insertRow(db, clients, { Nom, Solde }, fr);
    expect(saveObject(db, 'query', 'Requête clients', { formatVersion: '1.0', sql: 'SELECT [N°], Nom AS Client FROM Clients WHERE [N°] > 1' }, null)).toEqual({ ok: true });
    const sql: LookupProps = { kind: 'table', table: 'SELECT [N°], Nom, Solde FROM Clients ORDER BY Nom DESC;', columnCount: 3, columnWidths: [0], columnHeads: true, limitToList: true };
    expect(lookupRows(db, cmd(sql), 'Client', fr)).toEqual({
      heads: ['Nom', 'Solde'], widths: [1440, 1440],
      rows: [{ value: 1, display: ['Martin', '12,5'] }, { value: 3, display: ['Émile', '3'] }, { value: 2, display: ['Dupont', ''] }],
    });
    expect(lookupRows(db, cmd({ kind: 'table', table: 'requête clients', columnCount: 2, boundColumn: 1, columnWidths: [0], limitToList: true }), 'Client', fr))
      .toEqual({ widths: [1440], rows: [{ value: 2, display: ['Dupont'] }, { value: 3, display: ['Émile'] }] });
    // a source that does not run (missing table, parameter, bound column past the columns, empty) degrades: no list
    for (const table of ['SELECT Nom FROM Absente', 'SELECT Nom FROM Clients WHERE Nom = [Qui]', 'Absente', ''])
      expect(lookupRows(db, cmd({ kind: 'table', table, limitToList: true }), 'Client', fr)).toEqual({ rows: [], widths: [] });
    expect(lookupRows(db, cmd({ ...sql, boundColumn: 4 }), 'Client', fr)).toEqual({ rows: [], widths: [] });
  });

  it('Limit To List through SQL or a saved query: the bound column holds the value; a source that does not run checks nothing', async () => {
    createTable(db, clients);
    await insertRow(db, clients, { Nom: 'Martin' }, fr);
    expect(saveObject(db, 'query', 'QNoms', { formatVersion: '1.0', sql: 'SELECT Nom, [N°] FROM Clients' }, null)).toEqual({ ok: true });
    const on = { enforceMask: true };
    for (const table of ['SELECT [N°] FROM Clients', 'QNoms']) {
      const d = cmd({ kind: 'table', table, boundColumn: table === 'QNoms' ? 2 : 1, limitToList: true });
      createTable(db, { ...d, name: 'Cmd' });
      const live = tableDesign(db, 'Cmd');
      expect(await insertRow(db, live, { Client: '1' }, fr, undefined, on)).toMatchObject({ ok: true });
      expect(await insertRow(db, live, { Client: '7' }, fr, undefined, on)).toEqual({ ok: false, errors: [{ field: 'Client', code: 'notInList' }] });
      dropTable(db, 'Cmd');
    }
    const broken = cmd({ kind: 'table', table: 'SELECT Nom FROM Absente', limitToList: true });
    createTable(db, { ...broken, name: 'Cmd' });
    expect(await insertRow(db, tableDesign(db, 'Cmd'), { Client: '7' }, fr, undefined, on)).toMatchObject({ ok: true });
  });
});

describe('readRows: sorted-order snapshot (with a write sequence)', () => {
  const people = t('Gens', [f('Nom', 'shortText'), f('N', 'number')]);
  const NAMES = ['zoe', 'Zoé', 'ZOE', 'élise', 'Elise', 'elise', null, 'bob', 'Bob', '', 'émile', 'alain', null, 'Àlain'];
  const sorts = [
    [{ field: 'Nom', dir: 'asc' }], [{ field: 'Nom', dir: 'desc' }],
    [{ field: 'N', dir: 'desc' }, { field: 'Nom', dir: 'asc' }], [{ field: 'Nom', dir: 'desc' }, { field: 'N', dir: 'asc' }],
  ] as const;
  const filters = [undefined, [{ field: 'N', criteria: '>3' }]] as const;
  beforeEach(async () => {
    createTable(db, people);
    db.exec('BEGIN');
    for (let i = 0; i < 60; i++) await insertRow(db, people, { Nom: NAMES[i % NAMES.length], N: i % 7 }, fr);
    db.exec('COMMIT');
  });
  const pages = (seq: number | undefined, s: (typeof sorts)[number], filter?: (typeof filters)[number]) =>
    [0, 7, 25, 50, 59, 80].map((offset) => readRows(db, people, { offset, limit: 9, ...(filter ? { filter: [...filter] as never } : {}) }, 'fr-FR', [...s], seq));
  const builds = () => vi.spyOn(db, 'prepare');
  const orderByCalls = (spy: ReturnType<typeof builds>) => spy.mock.calls.filter(([sql]) => /ORDER BY/.test(sql)).length;

  it('gives the same pages as the direct ORDER BY (ties, nulls, accents and case, filter, desc)', () => {
    for (const s of sorts) for (const filter of filters) expect(pages(1, s, filter)).toEqual(pages(undefined, s, filter));
  });
  it('reuses the snapshot for the same key and write sequence; a write sequence that moves rebuilds it', async () => {
    const s = [{ field: 'Nom', dir: 'asc' }] as const;
    pages(1, s);
    const spy = builds();
    pages(1, s);
    expect(orderByCalls(spy)).toBe(0);
    const added = await insertRow(db, people, { Nom: 'Bobby', N: 1 }, fr);
    if (!added.ok) throw new Error('insert');
    db.prepare('DELETE FROM "Gens" WHERE rowid = 1').run(); // a 'zoe'
    const warm = pages(2, s);
    expect(orderByCalls(spy)).toBe(1);
    expect(warm).toEqual(pages(undefined, s)); // the new row at its place, the deleted one gone
    const all = readRows(db, people, { offset: 0, limit: 100 }, 'fr-FR', [...s], 2).rows.map((r) => r.rowid);
    expect(all).toContain(added.rowid);
    expect(all).not.toContain(1);
    spy.mockRestore();
  });
  it('a different sort or filter builds its own snapshot; unsorted and non-text sorts never build one', () => {
    const spy = builds();
    pages(1, sorts[0]); pages(1, sorts[1]); pages(1, sorts[0], filters[1]);
    expect(orderByCalls(spy)).toBe(3);
    readRows(db, people, { offset: 5, limit: 5 }, 'fr-FR', [], 1);
    readRows(db, people, { offset: 5, limit: 5 }, 'fr-FR', [{ field: 'N', dir: 'asc' }], 1);
    readRows(db, people, { offset: 5, limit: 5 }, 'fr-FR', [{ field: 'N', dir: 'asc' }], 1);
    expect(orderByCalls(spy)).toBe(6); // three direct LIMIT/OFFSET reads
    expect(spy.mock.calls.slice(-3).every(([sql]) => /ORDER BY .* LIMIT/.test(sql))).toBe(true);
    spy.mockRestore();
  });
  it('keeps the last 4 keys (LRU)', () => {
    for (const s of sorts) pages(1, s); // 4 keys
    pages(1, sorts[0]); // sorts[0] most recent: sorts[1] is the oldest now
    pages(1, sorts[0], filters[1]); // a 5th key evicts sorts[1]
    const spy = builds();
    pages(1, sorts[0]); pages(1, sorts[2]); pages(1, sorts[3]);
    expect(orderByCalls(spy)).toBe(0);
    pages(1, sorts[1]);
    expect(orderByCalls(spy)).toBe(1);
    spy.mockRestore();
  });
});
