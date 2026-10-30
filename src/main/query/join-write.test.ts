import { afterEach, beforeEach, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { CellInput } from '../../shared/coerce';
import { localeInfo } from '../../shared/locale-format';
import type { SourceSaveRequest } from '../../shared/record-source';
import { f, t } from '../../shared/test-fixtures';
import type { RiskProbe } from '../db/location-risk';
import { saveRelation } from '../db/relations';
import { createTable } from '../db/schema';
import { Session } from '../session';
import { autoLookup, saveSourceRow } from './join-write';
import { resolve } from './source';
import { seedSales, seedSalesRelation } from './test-db';

const probe: RiskProbe = { platform: 'win32', env: {}, homedir: 'C:\\Users\\x', windowsDriveType: () => 3 };
const info = localeInfo('fr-FR');
let dir: string;
let session: Session;
let db: DatabaseSync;

// Task 1's queries: Commandes (key) ⋈ Clients; three levels Lignes ⋈ Commandes ⋈ Clients
const QV = 'SELECT Commandes.[N°], Commandes.Client, Clients.[N°], Clients.Nom, Commandes.Montant FROM Clients INNER JOIN Commandes ON Clients.[N°] = Commandes.Client';
const L3 = 'SELECT Lignes.Commande, Lignes.Qté, Commandes.Montant, Clients.Nom FROM (Clients INNER JOIN Commandes ON Clients.[N°] = Commandes.Client) INNER JOIN Lignes ON Commandes.[N°] = Lignes.Commande';
const save = (sql: string, req: SourceSaveRequest) => saveSourceRow(db, resolve(db, { kind: 'sql', sql }), req, info);
const lookup = (sql: string, values: Record<string, CellInput>) => autoLookup(db, resolve(db, { kind: 'sql', sql }), values, info);
const row = (table: string, rowid: number): unknown[] => {
  const s = db.prepare(`SELECT * FROM "${table}" WHERE rowid = ?`);
  s.setReturnArrays(true);
  return s.get(rowid) as unknown as unknown[];
};
const count = (table: string) => (db.prepare(`SELECT count(*) AS n FROM "${table}"`).get() as { n: number }).n;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bcjw-'));
  session = Session.create(path.join(dir, 'test.basecraft'), { appVersion: '0.0.0', region: 'fr-FR', probe, sessionId: 'a' });
  db = (session as unknown as { db: DatabaseSync }).db;
  seedSales(db);
  seedSalesRelation(db);
});
afterEach(() => {
  session.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

it('a "one" field goes to the row\'s client', async () => {
  expect(await save(QV, { rowid: 3, values: { Nom: 'Martin SA' } })).toMatchObject({ ok: true, rowid: 3, values: { Nom: 'Martin SA', Client: 2 } });
  expect(row('Clients', 2)).toEqual([2, 'Martin SA', 'LYON']);
  // the session's entry points (sources.save / sources.autoLookup)
  expect(await session.saveSource({ kind: 'sql', sql: QV }, { rowid: 3, values: { Nom: 'Martin' } })).toMatchObject({ ok: true, values: { Nom: 'Martin' } });
  expect(session.autoLookup({ kind: 'sql', sql: QV }, { Client: '1' })).toEqual({ 'Clients.N°': 1, Nom: 'Dupont' });
});

it('link and "one" field together: the new parent is written (R3)', async () => { // Review Focus 1
  await save(QV, { rowid: 3, values: { Client: '3', Nom: 'Durand SARL' } });
  expect(row('Commandes', 3)[1]).toBe(3);
  expect(row('Clients', 3)[1]).toBe('Durand SARL');
  expect(row('Clients', 2)[1]).toBe('Martin');
});

it('a right join saves as an inner one: link and "one" field together go to the new parent (R1, R3; final review M4)', async () => {
  const QR = 'SELECT Commandes.[N°], Commandes.Client, Clients.Nom, Commandes.Montant FROM Commandes RIGHT JOIN Clients ON Clients.[N°] = Commandes.Client';
  expect(await save(QR, { rowid: 3, values: { Client: '3', Nom: 'Durand SARL', Montant: '7' } })).toMatchObject({ ok: true, rowid: 3, values: { Client: 3, Nom: 'Durand SARL' } });
  expect(row('Commandes', 3).slice(1, 3)).toEqual([3, 7]);
  expect([row('Clients', 2)[1], row('Clients', 3)[1]]).toEqual(['Martin', 'Durand SARL']);
  expect(lookup(QR, { Client: '1' })).toEqual({ Nom: 'Dupont' });
});

it('all or nothing', async () => { // Review Focus 1
  expect(await save(QV, { rowid: 1, values: { Montant: '5', Nom: '' } })).toEqual({ ok: false, errors: [{ field: 'Nom', code: 'required', table: 'Clients' }] });
  expect(row('Commandes', 1)[2]).toBe(10.1);
});

it('rules and read-only columns', async () => {
  expect(await save(QV, { rowid: 1, values: { Montant: '-1' } })).toMatchObject({ ok: false, errors: [{ field: 'Montant', code: 'validation' }] });
  expect(await save(QV, { rowid: 1, values: { 'Clients.N°': '9' } })).toMatchObject({ ok: false, errors: [{ field: 'Clients.N°', code: 'readOnly' }] });
  expect(await save(QV, { rowid: 1, values: { Zzz: '9' } })).toMatchObject({ ok: false, errors: [{ field: 'Zzz', code: 'readOnly' }] });
  expect(await save('SELECT Nom, Montant * 2 AS M2 FROM Clients INNER JOIN Commandes ON Clients.[N°] = Commandes.Client', { rowid: 1, values: { M2: '9' } }))
    .toMatchObject({ ok: false, errors: [{ field: 'M2', code: 'readOnly' }] });
  // not updatable (a cross product): readOnly on the first column
  expect(await save('SELECT Clients.Nom, Commandes.Montant FROM Clients, Commandes WHERE Clients.[N°] = Commandes.Client', { rowid: 1, values: { Montant: '9' } }))
    .toEqual({ ok: false, errors: [{ field: 'Nom', code: 'readOnly' }] });
  expect(row('Commandes', 1)[2]).toBe(10.1);
  expect(row('Clients', 1)[0]).toBe(1);
});

it('a new record goes to the key table', async () => {
  expect(await save(QV, { rowid: null, values: { Client: '4', Montant: '7' } })).toMatchObject({ ok: true, rowid: 6, values: { Nom: 'Éric' } });
  expect(await save(QV, { rowid: null, values: { Client: '99', Montant: '1' } })).toMatchObject({ ok: false, errors: [{ field: 'Client', code: 'noParent' }] });
  expect(await save(QV, { rowid: null, values: { Montant: '1', Nom: 'X' } })).toMatchObject({ ok: false, errors: [{ field: 'Nom', code: 'noParent', table: 'Clients' }] });
  expect(count('Commandes')).toBe(6);
});

it('a parent the join finds twice is never written', async () => { // Review Focus 2 (P10: real tables)
  createTable(db, t('P', [f('code', 'shortText', { primaryKey: true }), f('lib', 'shortText')]));
  createTable(db, t('E', [f('n', 'autoNumber'), f('code', 'shortText')]));
  db.exec(`INSERT INTO "P" ("code", "lib") VALUES ('ab', 'a'), ('AB', 'b'); INSERT INTO "E" ("code") VALUES ('ab');`);
  expect(await save('SELECT E.n, P.lib FROM P INNER JOIN E ON P.code = E.code', { rowid: 1, values: { lib: 'x' } }))
    .toMatchObject({ ok: false, errors: [{ field: 'lib', code: 'readOnly', table: 'P' }] });
  expect(db.prepare('SELECT count(*) AS n FROM P WHERE lib = ?').get('x')).toEqual({ n: 0 });
});

it('AutoLookup', () => {
  createTable(db, t('Lignes', [f('N°', 'autoNumber'), f('Commande', 'number', { numberSize: 'longInteger' }), f('Qté', 'number')]));
  expect(lookup(QV, { Client: '2' })).toEqual({ 'Clients.N°': 2, Nom: 'Martin' });
  expect(lookup(QV, { Client: '99' })).toEqual({ 'Clients.N°': null, Nom: null });
  expect(lookup(QV, { Client: '' })).toEqual({ 'Clients.N°': null, Nom: null });
  expect(lookup(L3, { Commande: '4' })).toEqual({ Montant: 99.99, Nom: 'Durand' }); // Clients chained through Commandes.Client
  expect(lookup(L3, { Commande: '99' })).toEqual({ Montant: null, Nom: null });
  // an intermediate link alone (lookupFor leaves Commande out): Clients from the Client typed, Commandes not looked up
  const L3C = 'SELECT Lignes.Commande, Commandes.Client, Clients.Nom FROM (Clients INNER JOIN Commandes ON Clients.[N°] = Commandes.Client) INNER JOIN Lignes ON Commandes.[N°] = Lignes.Commande';
  expect(lookup(L3C, { Client: '3' })).toEqual({ Nom: 'Durand' });
  expect(lookup(QV, { Montant: '3' })).toEqual({}); // no link changed: nothing looked up
  expect(count('Commandes')).toBe(5);
});

it('a single-table query saves as in A3', async () =>
  expect(await save('SELECT [N°], Nom AS Client FROM Clients', { rowid: 1, values: { Client: 'Dupond' } })).toMatchObject({ ok: true, values: { Client: 'Dupond' } }));

it('through a saved join query: the inner key rowid, the inner join', async () => {
  expect(session.saveObject('query', 'QV', { formatVersion: '1.0', sql: QV }, null)).toEqual({ ok: true });
  expect(await save('SELECT Nom AS Qui, Montant FROM QV WHERE Montant > 1', { rowid: 3, values: { Qui: 'Martin SA' } }))
    .toEqual({ ok: true, rowid: 3, values: { Qui: 'Martin SA', Montant: 0.2 } });
  expect(row('Clients', 2)[1]).toBe('Martin SA');
});

it('aliased tables: the plan\'s aliases locate the parent (Task 1 deferred)', async () => {
  const sql = 'SELECT O.Montant, O.Client, C.Nom FROM Clients AS C INNER JOIN Commandes AS O ON C.[N°] = O.Client';
  expect(await save(sql, { rowid: 4, values: { Montant: '1,5', Nom: 'Durand & fils' } }))
    .toEqual({ ok: true, rowid: 4, values: { Montant: 1.5, Client: 3, Nom: 'Durand & fils' } });
  expect(row('Clients', 3)[1]).toBe('Durand & fils');
  expect(lookup(sql, { Client: '1' })).toEqual({ Nom: 'Dupont' });
});

it('a join on two columns (a composite key): the parent found on both', async () => {
  createTable(db, t('H', [f('a', 'number', { numberSize: 'longInteger', primaryKey: true }), f('b', 'number', { numberSize: 'longInteger', primaryKey: true }), f('lib', 'shortText')]));
  createTable(db, t('D', [f('n', 'autoNumber'), f('a', 'number', { numberSize: 'longInteger' }), f('b', 'number', { numberSize: 'longInteger' })]));
  db.exec('INSERT INTO "H" VALUES (1, 1, \'un-un\'), (1, 2, \'un-deux\'); INSERT INTO "D" ("a", "b") VALUES (1, 2);');
  const sql = 'SELECT D.n, D.a, D.b, H.lib, H.b AS hb FROM H INNER JOIN D ON H.a = D.a And H.b = D.b';
  expect(await save(sql, { rowid: 1, values: { lib: 'X' } })).toMatchObject({ ok: true, values: { lib: 'X' } });
  expect(row('H', 2)).toEqual([1, 2, 'X']);
  expect(row('H', 1)).toEqual([1, 1, 'un-un']);
  expect(await save(sql, { rowid: 1, values: { hb: '1' } })).toMatchObject({ ok: false, errors: [{ field: 'hb', code: 'readOnly' }] });
  expect(lookup(sql, { a: '1', b: '1' })).toEqual({ lib: 'un-un', hb: 1 });
});

it('AutoLookup: in a chain, the parent just looked up beats a stale link value of the request', () => {
  createTable(db, t('Lignes', [f('N°', 'autoNumber'), f('Commande', 'number', { numberSize: 'longInteger' }), f('Qté', 'number')]));
  const sql = 'SELECT Lignes.Commande, Commandes.Client, Clients.Nom FROM (Clients INNER JOIN Commandes ON Clients.[N°] = Commandes.Client) INNER JOIN Lignes ON Commandes.[N°] = Lignes.Commande';
  // order 4 belongs to client 3; the request still holds client 1 (the old order's)
  expect(lookup(sql, { Commande: '4', Client: '1' })).toEqual({ Client: 3, Nom: 'Durand' });
});

it('an ambiguous parent rolls the key values back too', async () => {
  createTable(db, t('P', [f('code', 'shortText', { primaryKey: true }), f('lib', 'shortText')]));
  createTable(db, t('E', [f('n', 'autoNumber'), f('code', 'shortText'), f('note', 'shortText')]));
  db.exec(`INSERT INTO "P" ("code", "lib") VALUES ('ab', 'a'), ('AB', 'b'); INSERT INTO "E" ("code", "note") VALUES ('ab', 'avant');`);
  expect(await save('SELECT E.n, E.note, P.lib FROM P INNER JOIN E ON P.code = E.code', { rowid: 1, values: { note: 'après', lib: 'x' } }))
    .toMatchObject({ ok: false, errors: [{ field: 'lib', code: 'readOnly', table: 'P' }] });
  expect(row('E', 1)).toEqual([1, 'ab', 'avant']);
});

it('a "one" write refused by a relationship (related) rolls everything back', async () => {
  createTable(db, t('Pays', [f('N°', 'autoNumber'), f('code', 'shortText', { indexed: 'yesNoDuplicates' })]));
  createTable(db, t('Villes', [f('n', 'autoNumber'), f('pays', 'number', { numberSize: 'longInteger' }), f('nom', 'shortText')]));
  createTable(db, t('Douanes', [f('n', 'autoNumber'), f('code', 'shortText')]));
  db.exec(`INSERT INTO "Pays" ("code") VALUES ('FR'); INSERT INTO "Villes" ("pays", "nom") VALUES (1, 'Lyon'); INSERT INTO "Douanes" ("code") VALUES ('FR');`);
  const r = saveRelation(db, { name: '', parentTable: 'Pays', parentFields: ['code'], childTable: 'Douanes', childFields: ['code'],
    enforce: true, cascadeUpdate: false, cascadeDelete: false, joinType: 1 }, null, info);
  expect(r.ok).toBe(true);
  expect(await save('SELECT Villes.nom, Pays.code FROM Pays INNER JOIN Villes ON Pays.[N°] = Villes.pays', { rowid: 1, values: { nom: 'Lyon 2', code: 'FX' } }))
    .toMatchObject({ ok: false, errors: [{ field: 'code', code: 'related', table: 'Douanes' }] });
  expect(row('Villes', 1)[2]).toBe('Lyon');
  expect(row('Pays', 1)[1]).toBe('FR');
});

it('two nested saved queries: the page rowid is the key table\'s, and a save writes there', async () => {
  expect(session.saveObject('query', 'QV', { formatVersion: '1.0', sql: QV }, null)).toEqual({ ok: true });
  expect(session.saveObject('query', 'QV2', { formatVersion: '1.0', sql: 'SELECT Nom, Montant FROM QV' }, null)).toEqual({ ok: true });
  const ref = { kind: 'sql', sql: 'SELECT Nom AS Qui, Montant FROM QV2' } as const;
  expect(session.pageSource(ref, { offset: 0, limit: 10 }).rowids).toEqual([1, 2, 3, 4, 5]);
  expect(await session.saveSource(ref, { rowid: 4, values: { Qui: 'Durand SA', Montant: '98' } })).toEqual({ ok: true, rowid: 4, values: { Qui: 'Durand SA', Montant: 98 } });
  expect(row('Clients', 3)[1]).toBe('Durand SA');
  expect(row('Commandes', 4)[2]).toBe(98);
});

it('a join save reports the conflict of the one side and writes nothing', async () => { // C3 R8
  const a = db;
  const b = new DatabaseSync(path.join(dir, 'test.basecraft'));
  const read = (x: DatabaseSync, sql: string): unknown => Object.values(x.prepare(sql).get() as object)[0];
  try {
    const bound = resolve(a, { kind: 'sql', sql: 'SELECT Commandes.[N°], Commandes.Client, Clients.Nom, Clients.Ville, Commandes.Montant FROM Clients INNER JOIN Commandes ON Clients.[N°] = Commandes.Client' });
    b.prepare(`UPDATE Clients SET Ville = 'Brest' WHERE rowid = 1`).run();
    expect(await saveSourceRow(a, bound, { rowid: 1, values: { Montant: '11', Ville: 'Lille' }, expected: { Montant: 10.1, Ville: 'Lyon', Nom: 'Dupont' } }, info))
      .toMatchObject({ ok: false, conflict: 'changed', current: { Ville: 'Brest', Montant: 10.1 } });
    expect(read(b, 'SELECT Montant FROM Commandes WHERE rowid = 1')).toBe(10.1);
    // the key row gone: deleted; unchanged since read: saved
    expect(await saveSourceRow(a, bound, { rowid: 1, values: { Montant: '11', Ville: 'Lille' }, expected: { Montant: 10.1, Ville: 'Brest', Nom: 'Dupont' } }, info))
      .toMatchObject({ ok: true, values: { Montant: 11, Ville: 'Lille' } });
    b.prepare('DELETE FROM Commandes WHERE rowid = 2').run();
    expect(await saveSourceRow(a, bound, { rowid: 2, values: { Montant: '3' }, expected: { Montant: 0.1 } }, info)).toEqual({ ok: false, conflict: 'deleted' });
  } finally { b.close(); }
});

it('only a "one" column edited: the key row is still compared first (R8, review fix 1)', async () => {
  const b = new DatabaseSync(path.join(dir, 'test.basecraft'));
  const read = (x: DatabaseSync, sql: string): unknown => Object.values(x.prepare(sql).get() as object)[0];
  try {
    const bound = resolve(db, { kind: 'sql', sql: 'SELECT Commandes.Client, Clients.Nom, Clients.Ville, Commandes.Montant FROM Clients INNER JOIN Commandes ON Clients.[N°] = Commandes.Client' });
    // the key row deleted by another workstation: deleted, not noParent; nothing written
    b.prepare('DELETE FROM Commandes WHERE rowid = 1').run();
    expect(await saveSourceRow(db, bound, { rowid: 1, values: { Ville: 'Lille' }, expected: { Client: 1, Montant: 10.1, Nom: 'Dupont', Ville: 'Lyon' } }, info))
      .toEqual({ ok: false, conflict: 'deleted' });
    expect(read(b, 'SELECT Ville FROM Clients WHERE rowid = 1')).toBe('Lyon');
    // the key row re-linked to another client whose own columns match the expected ones: changed, the new parent untouched
    b.exec(`UPDATE Clients SET Nom = 'Martin', Ville = 'LYON' WHERE rowid = 3; UPDATE Commandes SET Client = 3 WHERE rowid = 3`);
    expect(await saveSourceRow(db, bound, { rowid: 3, values: { Ville: 'Lille' }, expected: { Client: 2, Montant: 0.2, Nom: 'Martin', Ville: 'LYON' } }, info))
      .toMatchObject({ ok: false, conflict: 'changed', current: { Client: 3, Nom: 'Martin', Ville: 'LYON' } });
    expect([read(b, 'SELECT Ville FROM Clients WHERE rowid = 2'), read(b, 'SELECT Ville FROM Clients WHERE rowid = 3')]).toEqual(['LYON', 'LYON']);
  } finally { b.close(); }
});
