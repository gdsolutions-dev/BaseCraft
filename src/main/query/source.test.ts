import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { RiskProbe } from '../db/location-risk';
import { Session } from '../session';
import { localeInfo } from '../../shared/locale-format';
import { printSql } from '../../shared/query/print';
import { parseSql } from '../../shared/query/sql-parser';
import { describeQuerySource, pageQuerySource, rowSourceRef, sourceHasValue, type QueryRef } from './source';
import { seedSales, seedSalesRelation } from './test-db';

const probe: RiskProbe = { platform: 'win32', env: {}, homedir: 'C:\\Users\\x', windowsDriveType: () => 3 };
let dir: string;
let file: string;
let session: Session;
let db: DatabaseSync;
let seq = 0;
const ctx = { info: localeInfo('fr-FR'), writeSeq: () => seq };
const saveQ = (name: string, sql: string) => expect(session.saveObject('query', name, { formatVersion: '1.0', sql }, null)).toEqual({ ok: true });

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bcsrc-'));
  file = path.join(dir, 'test.basecraft');
  session = Session.create(file, { appVersion: '0.0.0', region: 'fr-FR', probe, sessionId: 'a' });
  db = (session as unknown as { db: DatabaseSync }).db;
  seedSales(db);
  seq = 0;
});
afterEach(() => {
  session.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

it('describe a parameter query', () => {
  saveQ('QDepuis', 'SELECT [N°], Montant, Le FROM Commandes WHERE Le >= [Date début :]');
  expect(describeQuerySource(db, { kind: 'query', name: 'QDepuis' }))
    .toMatchObject({ updatable: true, keyTable: 'Commandes', parameters: [{ name: 'Date début :', type: 'dateTime' }] });
});

it('page converts the parameter in the region', () => {
  saveQ('QDepuis', 'SELECT [N°], Montant, Le FROM Commandes WHERE Le >= [Date début :]');
  const p = pageQuerySource(db, { kind: 'query', name: 'QDepuis' }, { offset: 0, limit: 10, params: { 'date début :': '05/10/2026' } }, ctx);
  expect(p).toMatchObject({ total: 3, rowids: [2, 3, 5] });
  expect(p.rows.map((r) => r[0])).toEqual([2, 3, 5]);
});

it('missing / invalid parameter', () => {
  saveQ('QDepuis', 'SELECT [N°], Montant, Le FROM Commandes WHERE Le >= [Date début :]');
  expect(() => pageQuerySource(db, { kind: 'query', name: 'QDepuis' }, { offset: 0, limit: 10 }, ctx)).toThrow(/bc:missingParameter/);
  expect(() => pageQuerySource(db, { kind: 'query', name: 'QDepuis' }, { offset: 0, limit: 10, params: { 'Date début :': '31/02/2026' } }, ctx))
    .toThrow(/^bc:invalidParameter\|invalidDate\|Date début :$/);
});

it('sql source, sort, multi-table read-only', () => {
  const ref = { kind: 'sql', sql: 'SELECT Nom, Montant FROM Clients INNER JOIN Commandes ON Clients.[N°] = Commandes.Client' } as const;
  expect(pageQuerySource(db, ref, { offset: 0, limit: 2, sort: [{ field: 'Montant', dir: 'desc' }] }, ctx))
    .toEqual({ rows: [['Durand', 99.99], ['Dupont', 10.1]], rowids: [null, null], total: 5 });
  expect(() => pageQuerySource(db, ref, { offset: 0, limit: 2, sort: [{ field: 'Zzz', dir: 'asc' }] }, ctx)).toThrow(/^bc:notFound$/); // contract 1.2
});

it("a page keeps the query's own order, which also breaks ties of the page sort; offset pages", () => {
  const ref = { kind: 'sql', sql: 'SELECT [N°], Client FROM Commandes ORDER BY Montant DESC' } as const;
  expect(pageQuerySource(db, ref, { offset: 0, limit: 10 }, ctx).rows.map((r) => r[0])).toEqual([4, 1, 3, 2, 5]);
  expect(pageQuerySource(db, ref, { offset: 1, limit: 2 }, ctx).rows.map((r) => r[0])).toEqual([1, 3]);
  // Client 1: 1, 2; client 2: 3, 5; client 3: 4 — within a client, the query's order (Montant DESC)
  expect(pageQuerySource(db, ref, { offset: 0, limit: 10, sort: [{ field: 'client', dir: 'asc' }] }, ctx).rows.map((r) => r[0])).toEqual([1, 2, 3, 5, 4]);
  expect(pageQuerySource(db, ref, { offset: 0, limit: 10, sort: [{ field: 'Client', dir: 'desc' }] }, ctx).rows.map((r) => r[0])).toEqual([4, 3, 5, 1, 2]);
});

it('text sorts as Access: accents order, case ties (then the query order)', () => {
  const ref = { kind: 'sql', sql: 'SELECT Ville, [N°] FROM Clients ORDER BY [N°] DESC' } as const;
  expect(pageQuerySource(db, ref, { offset: 0, limit: 10, sort: [{ field: 'Ville', dir: 'asc' }] }, ctx).rows)
    .toEqual([['LYON', 2], ['Lyon', 1], ['Lyôn', 4], ['Paris', 3]]);
});

it('an updatable query, also through a saved query, gives the key table rowids', () => {
  saveQ('QLyon', 'SELECT Nom AS Client, Ville FROM Clients WHERE Ville = "Lyon"');
  const ref = { kind: 'sql', sql: 'SELECT * FROM QLyon' } as const;
  expect(describeQuerySource(db, ref)).toMatchObject({ updatable: true, keyTable: 'Clients', fields: [{ name: 'Client', origin: { table: 'Clients', field: 'Nom' } }, { name: 'Ville' }] });
  expect(pageQuerySource(db, ref, { offset: 0, limit: 10, sort: [{ field: 'Client', dir: 'desc' }] }, ctx))
    .toEqual({ rows: [['Martin', 'LYON'], ['Dupont', 'Lyon']], rowids: [2, 1], total: 2 });
  expect(pageQuerySource(db, { kind: 'sql', sql: 'SELECT Ville FROM Clients UNION SELECT Ville FROM QLyon' }, { offset: 0, limit: 10 }, ctx).rowids)
    .toEqual([null, null, null]);
});

it('filter on a sql source: criteria on the output columns, total of the kept rows', () => {
  const ref = { kind: 'sql', sql: 'SELECT Nom, Montant FROM Clients INNER JOIN Commandes ON Clients.[N°] = Commandes.Client' } as const;
  expect(pageQuerySource(db, ref, { offset: 0, limit: 10, sort: [{ field: 'Montant', dir: 'desc' }], filter: [{ field: 'Nom', criteria: '"martin"' }] }, ctx))
    .toEqual({ rows: [['Martin', 0.2], ['Martin', 0.1]], rowids: [null, null], total: 2 });
  // a criterion naming another output column, a page past the first, limit 0
  const f = [{ field: 'montant', criteria: '<11 And >[Montant]-1 And >0.15' }];
  expect(pageQuerySource(db, ref, { offset: 1, limit: 10, sort: [{ field: 'Montant', dir: 'asc' }], filter: f }, ctx))
    .toEqual({ rows: [['Dupont', 10.1]], rowids: [null], total: 2 });
  expect(() => pageQuerySource(db, ref, { offset: 0, limit: 1, filter: [{ field: 'Nom', criteria: '>>' }] }, ctx)).toThrow(/^bc:invalidArgument$/);
  expect(() => pageQuerySource(db, ref, { offset: 0, limit: 1, filter: [{ field: 'Nom', criteria: '[Zzz]' }] }, ctx)).toThrow(/^bc:invalidArgument$/);
  expect(() => pageQuerySource(db, ref, { offset: 0, limit: 1, filter: [{ field: 'Ville', criteria: '"x"' }] }, ctx)).toThrow(/^bc:notFound$/);
});

it('filter on an updatable query keeps its rowids; output names that look like internal ones stay apart', () => {
  saveQ('QLyon', 'SELECT [N°] AS c1, Nom AS bcx_rowid, Ville FROM Clients WHERE Ville Like "ly*"');
  const ref = { kind: 'query', name: 'QLyon' } as const;
  expect(pageQuerySource(db, ref, { offset: 0, limit: 10, filter: [{ field: 'bcx_rowid', criteria: 'Like "*r*"' }] }, ctx))
    .toEqual({ rows: [[2, 'Martin', 'LYON'], [4, 'Éric', 'Lyôn']], rowids: [2, 4], total: 2 });
  expect(pageQuerySource(db, ref, { offset: 0, limit: 10, sort: [{ field: 'c1', dir: 'desc' }], filter: [{ field: 'c1', criteria: '<4' }] }, ctx))
    .toEqual({ rows: [[2, 'Martin', 'LYON'], [1, 'Dupont', 'Lyon']], rowids: [2, 1], total: 2 });
  // a bracketed alias may hold a '.': even the rowid's inner name
  for (const alias of ['bcx.rowid', 'BCX.ROWID']) {
    const r = { kind: 'sql', sql: `SELECT Nom AS [${alias}], [N°] AS [bcx.rowid_], Ville FROM Clients` } as const;
    expect(pageQuerySource(db, r, { offset: 0, limit: 10, filter: [{ field: alias, criteria: '"Durand"' }] }, ctx))
      .toEqual({ rows: [['Durand', 3, 'Paris']], rowids: [3], total: 1 });
  }
});

it('pages a query and a table with where and filter', () => {
  saveQ('QClientsLyon', 'SELECT Nom, Ville FROM Clients WHERE Ville = "Lyon"');
  const q = { kind: 'query', name: 'QClientsLyon' } as const;
  expect(pageQuerySource(db, q, { offset: 0, limit: 10 }, ctx).total).toBe(2);
  expect(pageQuerySource(db, q, { offset: 0, limit: 10, where: '[Nom] Like "M*"' }, ctx)).toEqual({ rows: [['Martin', 'LYON']], rowids: [2], total: 1 });
  expect(pageQuerySource(db, q, { offset: 0, limit: 10, where: '[Nom] Like "*"', filter: [{ field: 'Nom', criteria: '"dupont"' }] }, ctx))
    .toEqual({ rows: [['Dupont', 'Lyon']], rowids: [1], total: 1 });
  expect(pageQuerySource(db, q, { offset: 0, limit: 10, where: '[Nom] Like "Z*"' }, ctx).total).toBe(0); // part of the totals key
  const t = { kind: 'table', name: 'Clients' } as const;
  expect(session.pageSource(t, { offset: 0, limit: 10, where: '[Nom] Like "M*"' })).toEqual({ rows: [[2, 'Martin', 'LYON']], rowids: [2], total: 1 });
  expect(session.pageSource(t, { offset: 0, limit: 10, where: '[Ville] = "Lyon"', filter: [{ field: 'Nom', criteria: 'Like "M*"' }] }).total).toBe(1);
  for (const where of ['[TempVars]![v] = 1', '[Absent] = 1', '[Nom] =']) {
    expect(() => pageQuerySource(db, q, { offset: 0, limit: 1, where }, ctx)).toThrow(/^bc:invalidArgument$/);
    expect(() => session.pageSource(t, { offset: 0, limit: 1, where })).toThrow(/^bc:invalidArgument$/);
  }
});

it('a table without a real rowid (WITHOUT ROWID, or a field named rowid) gives a read-only source', () => {
  db.exec("CREATE TABLE Ext (k INTEGER PRIMARY KEY, v TEXT) WITHOUT ROWID; INSERT INTO Ext VALUES (1, 'a');");
  db.exec("CREATE TABLE Shadow (rowid INTEGER, v TEXT); INSERT INTO Shadow VALUES (7, 'b');");
  for (const [sql, row] of [['SELECT * FROM Ext', [1, 'a']], ['SELECT v FROM Shadow', ['b']]] as const) {
    expect(describeQuerySource(db, { kind: 'sql', sql })).toMatchObject({ updatable: false });
    expect(describeQuerySource(db, { kind: 'sql', sql }).keyTable).toBeUndefined();
    expect(pageQuerySource(db, { kind: 'sql', sql }, { offset: 0, limit: 10 }, ctx)).toEqual({ rows: [row], rowids: [null], total: 1 });
  }
});

it('a query using Date(), Now() or Time() (or a filter that does) counts again on each page', () => {
  const spy = vi.spyOn(db, 'prepare');
  const counts = () => spy.mock.calls.filter(([sql]) => sql.startsWith('SELECT count(*)')).length;
  const ref = { kind: 'sql', sql: 'SELECT Le FROM Commandes WHERE Le <= Now()' } as const;
  pageQuerySource(db, ref, { offset: 0, limit: 1 }, ctx);
  pageQuerySource(db, ref, { offset: 0, limit: 1 }, ctx);
  expect(counts()).toBe(2);
  const plain = { kind: 'sql', sql: 'SELECT Le FROM Commandes' } as const;
  const f = [{ field: 'Le', criteria: '<=Date()' }];
  pageQuerySource(db, plain, { offset: 0, limit: 1, filter: f }, ctx);
  pageQuerySource(db, plain, { offset: 0, limit: 1, filter: f }, ctx);
  expect(counts()).toBe(4);
  pageQuerySource(db, { kind: 'sql', sql: 'SELECT DateAdd("d", 1, Le) FROM Commandes' }, { offset: 0, limit: 1 }, ctx);
  pageQuerySource(db, { kind: 'sql', sql: 'SELECT DateAdd("d", 1, Le) FROM Commandes' }, { offset: 0, limit: 1 }, ctx);
  expect(counts()).toBe(5); // DateAdd is not volatile
});

it('total is cached until a write', () => {
  const spy = vi.spyOn(db, 'prepare');
  const counts = () => spy.mock.calls.filter(([sql]) => sql.startsWith('SELECT count(*)')).length;
  const ref = { kind: 'sql', sql: 'SELECT * FROM Clients WHERE Ville = [V]' } as const;
  const page = (v: string) => pageQuerySource(db, ref, { offset: 0, limit: 1, params: { V: v } }, ctx).total;
  expect(page('Lyon')).toBe(2);
  expect(page('lyon')).toBe(2); // another parameter value: another key
  expect(counts()).toBe(2);
  expect(page('Lyon')).toBe(2);
  expect(counts()).toBe(2);
  db.prepare(`INSERT INTO "Clients" ("Nom", "Ville") VALUES ('Petit', 'Lyon')`).run();
  seq++;
  expect(page('Lyon')).toBe(3);
  expect(counts()).toBe(3);
});

it("the session's sequence moves on each write, and on another connection's commit", async () => {
  const info = { kind: 'sql', sql: 'SELECT * FROM Clients' } as const;
  const total = () => session.pageSource(info, { offset: 0, limit: 0 }).total;
  expect(total()).toBe(4);
  await session.insert('Clients', { Nom: 'Petit' });
  expect(total()).toBe(5);
  const other = new DatabaseSync(file);
  other.prepare(`INSERT INTO "Clients" ("Nom") VALUES ('Grand')`).run();
  other.close();
  expect(total()).toBe(6);
});

it('limit 0 returns only the total', () =>
  expect(pageQuerySource(db, { kind: 'sql', sql: 'SELECT * FROM Clients' }, { offset: 0, limit: 0 }, ctx)).toEqual({ rows: [], rowids: [], total: 4 }));

it.each([
  [{ kind: 'sql', sql: 'DELETE FROM Clients' }, /^bc:notSelectQuery$/],
  [{ kind: 'sql', sql: 'SELECT * INTO Copie FROM Clients' }, /^bc:notSelectQuery$/],
  [{ kind: 'sql', sql: 'SELECT * FROM bc_meta' }, /^bc:invalidQuery\|reservedName\|14$/],
  [{ kind: 'sql', sql: 'SELECT * FROM' }, /^bc:invalidQuery\|unexpectedEnd\|13$/],
  [{ kind: 'query', name: 'Nope' }, /^bc:notFound$/],
  [{ kind: 'sql', sql: 'SELECT * FROM Zzz' }, /^bc:notFound\|unknownSource\|Zzz$/], // contract 1.2: a missing table
])('errors %#', (ref, re) => expect(() => describeQuerySource(db, ref as QueryRef)).toThrow(re));

it('broken after a table rename', () => {
  saveQ('QC', 'SELECT * FROM Clients');
  expect(session.renameTable('Clients', 'Contacts')).toEqual({ ok: true });
  expect(() => describeQuerySource(db, { kind: 'query', name: 'QC' })).toThrow(/^bc:notFound\|unknownSource\|Clients$/);
  expect(() => session.describeSource({ kind: 'sql', sql: 'SELECT * FROM QC' })).toThrow(/^bc:notFound\|unknownSource\|Clients$/);
  expect(() => session.pageSource({ kind: 'query', name: 'QC' }, { offset: 0, limit: 1 })).toThrow(/^bc:notFound\|unknownSource\|Clients$/);
});

it('a stored query whose definition no longer reads is named', () => {
  db.prepare(`INSERT INTO bc_objects (kind, name, definition, created, modified) VALUES ('query', 'QBad', ?, '', '')`)
    .run(JSON.stringify({ formatVersion: '1.0', sql: 'SELECT * FROM' }));
  expect(() => describeQuerySource(db, { kind: 'query', name: 'qbad' })).toThrow(/^bc:invalidQuery\|storedQuery\|QBad$/);
  expect(() => describeQuerySource(db, { kind: 'sql', sql: 'SELECT * FROM Clients WHERE Exists (SELECT * FROM QBad)' }))
    .toThrow(/^bc:invalidQuery\|storedQuery\|QBad$/);
});

it('a scalar subquery with several rows is a typed error at run time', () =>
  expect(() => pageQuerySource(db, { kind: 'sql', sql: 'SELECT Nom, (SELECT Montant FROM Commandes) AS M FROM Clients' }, { offset: 0, limit: 10 }, ctx))
    .toThrow(/^bc:invalidQuery\|subqueryRows\|/));

it('save refuses invalid SQL and cycles', () => {
  expect(() => session.saveObject('query', 'QX', { formatVersion: '1.0', sql: 'SELECT * FROM QY' }, null)).toThrow(/bc:queryBind\|unknownSource/);
  expect(() => session.saveObject('query', 'QX', { formatVersion: '1.0', sql: 'SELECT * FROM' }, null)).toThrow(/^bc:invalidQuery\|unexpectedEnd\|13$/);
  expect(() => session.saveObject('query', 'QX', { formatVersion: '1.0' }, null)).toThrow(/^bc:invalidQuery$/);
  saveQ('QA', 'SELECT * FROM Clients');
  saveQ('QB', 'SELECT * FROM QA');
  expect(() => session.saveObject('query', 'QA', { formatVersion: '1.0', sql: 'SELECT * FROM QB' }, 'QA')).toThrow(/^bc:queryBind\|circular\|QA → QB → QA$/);
  expect(() => session.saveObject('query', 'QC', { formatVersion: '1.0', sql: 'SELECT * FROM QC' }, null)).toThrow(/^bc:queryBind\|circular\|QC → QC$/);
  expect(session.getObject('query', 'QA').definition).toEqual({ formatVersion: '1.0', sql: 'SELECT * FROM Clients' }); // nothing written
  expect(session.listObjects('query').map((o) => o.name)).toEqual(['QA', 'QB']);
  expect(session.saveObject('query', 'CLIENTS', { formatVersion: '1.0', sql: 'SELECT * FROM [Clients];' }, null)).toEqual({ ok: false, reason: 'nameExists' });
  // an action query is saved (it runs with Task 10)
  saveQ('QDel', 'DELETE FROM Clients WHERE Ville = [V]');
});

it('save checks what printSql writes: a tree the parser refuses is not stored', () => {
  const q = parseSql('SELECT Nom FROM Clients');
  if (q.body.k === 'select') q.body.from = [];
  expect(() => session.saveObject('query', 'QP', { formatVersion: '1.0', sql: printSql(q) }, null)).toThrow(/^bc:invalidQuery\|/);
});

it('lookup Row Source (A2-R18): a table, a saved query or SQL text; the bound column holds a value', () => {
  saveQ('QVilles', 'SELECT DISTINCT Ville FROM Clients');
  expect(rowSourceRef(db, 'clients')).toEqual({ kind: 'table', name: 'Clients' });
  expect(rowSourceRef(db, 'qvilles')).toEqual({ kind: 'query', name: 'QVilles' });
  expect(rowSourceRef(db, '  select Nom FROM Clients')).toEqual({ kind: 'sql', sql: '  select Nom FROM Clients' });
  expect(rowSourceRef(db, 'PARAMETERS [x] Text; SELECT 1')).toMatchObject({ kind: 'sql' });
  expect(rowSourceRef(db, 'Absente')).toBeNull();
  expect(sourceHasValue(db, { kind: 'query', name: 'QVilles' }, 0, 'Paris', ctx.info)).toBe(true);
  expect(sourceHasValue(db, { kind: 'query', name: 'QVilles' }, 0, 'Rome', ctx.info)).toBe(false);
  expect(sourceHasValue(db, { kind: 'sql', sql: 'SELECT [N°], Nom FROM Clients' }, 1, 'Durand', ctx.info)).toBe(true);
  expect(sourceHasValue(db, { kind: 'sql', sql: 'SELECT [N°], Nom FROM Clients' }, 0, 3, ctx.info)).toBe(true);
  expect(() => sourceHasValue(db, { kind: 'sql', sql: 'SELECT Nom FROM Clients' }, 1, 'x', ctx.info)).toThrow(/^bc:invalidArgument$/);
});

it('seedSalesRelation: the ClientsCommandes relation of the test base', () => {
  seedSalesRelation(db);
  expect(session.listRelations()).toMatchObject([{ name: 'ClientsCommandes', parentTable: 'Clients', childTable: 'Commandes', enforce: true, joinType: 1 }]);
});

it('the cached total is per region: a criterion reads text in the region', () => {
  const ref = { kind: 'sql', sql: 'SELECT "1,5" AS T FROM Clients' } as const;
  const req = { offset: 0, limit: 0, filter: [{ field: 'T', criteria: '=1.5' }] };
  expect(pageQuerySource(db, ref, req, ctx).total).toBe(4);
  expect(pageQuerySource(db, ref, req, { ...ctx, info: localeInfo('en-US') }).total).toBe(0);
});

it('a virtual table of another tool parses and binds, but the authorizer refuses to read it (its own bc:invalidQuery)', () => {
  db.exec('CREATE VIRTUAL TABLE "Notes" USING fts5("Texte")');
  const r = { kind: 'sql', sql: 'SELECT * FROM Notes' } as const;
  expect(describeQuerySource(db, r).fields.map((x) => x.name)).toEqual(['Texte']);
  expect(() => pageQuerySource(db, r, { offset: 0, limit: 10 }, ctx)).toThrow(/^bc:invalidQuery$/);
});
