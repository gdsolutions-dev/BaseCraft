import { beforeEach, describe, expect, it } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import type { ExportQuery } from '../../shared/access-export';
import { defaultProps, type FieldDef } from '../../shared/field-types';
import { registerFunctions, SYSTEM_DDL } from '../db/file-format';
import { getObject, saveObject } from '../db/objects';
import { createTable } from '../db/schema';
import { importQueries } from './access-queries';

const memoryBase = () => { const db = new DatabaseSync(':memory:'); registerFunctions(db); for (const ddl of SYSTEM_DDL) db.exec(ddl); return db; };
const text = (name: string): FieldDef => ({ name, props: { ...defaultProps('shortText'), size: 50 } });
const q = (name: string, sql: string | null, queryType = 0, connect = ''): ExportQuery => ({ name, sql, queryType, connect });
const T = [{ remote: 'Clients', name: 'Clients' }, { remote: 'Commandes', name: 'Commandes' }];
const sqlOf = (db: DatabaseSync, name: string) => (getObject(db, 'query', name)!.definition as { sql: string }).sql;
let db: DatabaseSync;
let rowsBefore: number;

beforeEach(() => {
  db = memoryBase();
  createTable(db, { name: 'Clients', fields: [text('Nom'), text('Ville')] });
  createTable(db, { name: 'Commandes', fields: [text('Client'), text('Produit')] });
  db.exec(`INSERT INTO "Clients" (Nom, Ville) VALUES ('A', 'x'), ('B', 'y')`);
  rowsBefore = 2;
});

describe('importQueries', () => {
  it('a query that parses and binds is imported as written', () => {
    const r = importQueries(db, [q('QVilles', 'SELECT Clients.Ville FROM Clients;\r\n')], T);
    expect(r.lines).toEqual([{ code: 'queryImported', object: 'QVilles' }]);
    expect(r.queries).toEqual([{ name: 'QVilles', remote: 'QVilles' }]);
    expect(getObject(db, 'query', 'QVilles')!.definition).toEqual({ formatVersion: '1.0', sql: 'SELECT Clients.Ville FROM Clients;\r\n' });
  });
  it('a query over a later query binds', () => {
    const r = importQueries(db, [q('QB', 'SELECT Ville FROM QA'), q('QA', 'SELECT Clients.Ville FROM Clients')], T);
    expect(r.lines.map((l) => l.code)).toEqual(['queryImported', 'queryImported']);
  });
  it('an unknown function: kept as text, named in the report', () => {
    const sql = 'SELECT DLookup("Nom","Clients") AS X FROM Clients';
    expect(importQueries(db, [q('QF', sql)], T).lines).toEqual([{ code: 'queryKeptAsText', object: 'QF', reason: 'unknownFunction', part: 'DLookup' }]);
    expect(sqlOf(db, 'QF')).toBe(sql);
  });
  it('a data-definition query, an unread text, an ambiguous field', () => {
    const r = importQueries(db, [q('QD', 'CREATE TABLE X (a INT)', 96), q('QU', 'UPDATE Clients, Commandes SET Clients.Ville = "x"', 48), q('QN', 'SELECT Nom FROM Clients AS A, Clients AS B')], T);
    expect(r.lines.map((l) => [l.code, l.reason])).toEqual([['queryKeptAsText', 'dataDefinition'], ['queryKeptAsText', 'notRead'], ['queryKeptAsText', 'notBound']]);
    expect(r.queries.map((x) => x.name)).toEqual(['QD', 'QU', 'QN']);
  });
  it('a source that was not imported: the other queries are unaffected', () => {
    const r = importQueries(db, [q('QM', 'SELECT a FROM Produits'), q('QOk', 'SELECT Clients.Ville FROM Clients')], T);
    expect(r.lines).toEqual([{ code: 'querySourceMissing', object: 'QM', part: 'Produits' }, { code: 'queryImported', object: 'QOk' }]);
    expect(sqlOf(db, 'QM')).toBe('SELECT a FROM Produits');
  });
  it('a pass-through is never parsed', () => {
    expect(importQueries(db, [q('QP', 'EXEC sp_x @a = 1', 112, 'ODBC'), q('QP2', 'EXEC sp_y', 144)], T).lines)
      .toEqual([{ code: 'queryPassThrough', object: 'QP', part: 'ODBC' }, { code: 'queryPassThrough', object: 'QP2' }]);
    expect(sqlOf(db, 'QP')).toBe('EXEC sp_x @a = 1');
  });
  it('skipped: no text, a refused name, a duplicate', () => {
    const r = importQueries(db, [q('QNul', null), q('bc_x', 'SELECT 1'), q('QA', 'SELECT Clients.Ville FROM Clients'), q('qa', 'SELECT Clients.Ville FROM Clients')], T);
    expect(r.lines.map((l) => [l.code, l.reason])).toEqual([['querySkipped', 'unreadable'], ['querySkipped', 'nameInvalid'], ['queryImported', undefined], ['querySkipped', 'duplicate']]);
    expect(r.queries).toEqual([{ name: 'QA', remote: 'QA' }]);
  });
  it('taken names: the query gets a number and reads the renamed table', () => {
    // db holds a table Clients (other rows) and a query QTotaux; this import created Clients1 for the Access table Clients
    createTable(db, { name: 'Clients1', fields: [text('Nom'), text('Ville')] });
    saveObject(db, 'query', 'QTotaux', { formatVersion: '1.0', sql: 'SELECT Clients.Nom FROM Clients' }, null);
    const r = importQueries(db, [q('QTotaux', 'SELECT Clients.Ville FROM Clients')], [{ remote: 'Clients', name: 'Clients1' }]);
    expect(r.lines).toEqual([{ code: 'queryImported', object: 'QTotaux1', part: 'QTotaux' }]);
    expect(sqlOf(db, 'QTotaux1')).toMatch(/Clients1/);
    expect(sqlOf(db, 'QTotaux1')).not.toMatch(/Clients\b(?!1)/);
    expect(sqlOf(db, 'QTotaux')).toBe('SELECT Clients.Nom FROM Clients'); // the old query is untouched
  });
  it('a query over a renamed query reads the new name', () => {
    saveObject(db, 'query', 'QA', { formatVersion: '1.0', sql: 'SELECT Nom FROM Clients' }, null);
    const r = importQueries(db, [q('QB', 'SELECT Ville FROM QA'), q('QA', 'SELECT Clients.Ville FROM Clients')], T);
    expect(r.lines).toEqual([{ code: 'queryImported', object: 'QB' }, { code: 'queryImported', object: 'QA1', part: 'QA' }]);
    expect(sqlOf(db, 'QB')).toMatch(/QA1/);
  });
  it('an action query is saved, never run', () => {
    importQueries(db, [q('QSuppr', 'DELETE * FROM Clients')], T);
    expect(db.prepare('SELECT count(*) AS n FROM "Clients"').get()).toEqual({ n: rowsBefore });
    expect(getObject(db, 'query', 'QSuppr')).not.toBeNull();
  });
  it('a source the import did not create is reported, even when the target has an object of that name', () => {
    createTable(db, { name: 'Produits', fields: [text('X')] });
    expect(importQueries(db, [q('QP2', 'SELECT Produits.X FROM Produits')], T).lines).toEqual([{ code: 'querySourceMissing', object: 'QP2', part: 'Produits' }]);
    expect(getObject(db, 'query', 'QP2')).not.toBeNull(); // still saved as written
  });
  it('a query over a skipped query of the same export is reported, even when the target has a query of that name', () => {
    saveObject(db, 'query', 'QVieux', { formatVersion: '1.0', sql: 'SELECT Clients.Nom FROM Clients' }, null);
    const r = importQueries(db, [q('QVieux', null), q('QSur', 'SELECT * FROM QVieux')], T);
    expect(r.lines).toEqual([{ code: 'querySkipped', object: 'QVieux', reason: 'unreadable' }, { code: 'querySourceMissing', object: 'QSur', part: 'QVieux' }]);
  });
  it('a pre-existing object named like a renamed one is not read', () => {
    createTable(db, { name: 'Clients1', fields: [text('Nom'), text('Ville')] }); // created by this import for Access's Clients; Clients is pre-existing
    const r = importQueries(db, [q('QX', 'SELECT Clients1.Ville FROM Clients1')], [{ remote: 'Clients', name: 'Clients1' }]);
    expect(r.lines).toEqual([{ code: 'querySourceMissing', object: 'QX', part: 'Clients1' }]);
    expect(sqlOf(db, 'QX')).toBe('SELECT Clients1.Ville FROM Clients1');
  });
  it('chains of renames are applied once each', () => {
    createTable(db, { name: 'Clients1', fields: [text('Nom'), text('Ville')] });
    createTable(db, { name: 'Clients2', fields: [text('Nom'), text('Ville')] });
    const r = importQueries(db, [q('QC', 'SELECT a.Ville, b.Ville FROM Clients AS a, Clients1 AS b')], [{ remote: 'Clients', name: 'Clients1' }, { remote: 'Clients1', name: 'Clients2' }]);
    expect(r.lines).toEqual([{ code: 'queryImported', object: 'QC' }]);
    expect(sqlOf(db, 'QC')).toMatch(/\[Clients1\] AS \[a\]/);
    expect(sqlOf(db, 'QC')).toMatch(/\[Clients2\] AS \[b\]/);
  });
  describe('the target of an action query', () => {
    const missing = (name: string) => [{ code: 'querySourceMissing', object: name, part: 'Produits' }];
    it('an append query into a table the import did not create is reported (pre-existing table)', () => {
      createTable(db, { name: 'Produits', fields: [text('X')] });
      expect(importQueries(db, [q('QA1', 'INSERT INTO Produits (X) SELECT Ville FROM Clients')], T).lines).toEqual(missing('QA1'));
    });
    it('the same with VALUES', () => {
      createTable(db, { name: 'Produits', fields: [text('X')] });
      expect(importQueries(db, [q('QA2', 'INSERT INTO Produits (X) VALUES (1)')], T).lines).toEqual(missing('QA2'));
    });
    it('the same when the target has no such table', () => {
      expect(importQueries(db, [q('QA3', 'INSERT INTO Produits (X) SELECT Ville FROM Clients')], T).lines).toEqual(missing('QA3'));
    });
    it('an append query into a table of the import is imported', () => {
      expect(importQueries(db, [q('QA4', 'INSERT INTO Commandes (Client) SELECT Nom FROM Clients')], T).lines).toEqual([{ code: 'queryImported', object: 'QA4' }]);
    });
    it('an append query into a renamed table of the import targets the new name', () => {
      createTable(db, { name: 'Clients1', fields: [text('Nom'), text('Ville')] });
      const r = importQueries(db, [q('QA5', 'INSERT INTO Clients (Nom) SELECT Client FROM Commandes')], [{ remote: 'Clients', name: 'Clients1' }, { remote: 'Commandes', name: 'Commandes' }]);
      expect(r.lines).toEqual([{ code: 'queryImported', object: 'QA5' }]);
      expect(sqlOf(db, 'QA5')).toMatch(/INSERT INTO \[?Clients1\]?/);
    });
    it('regression guards: make-table, update and delete', () => {
      createTable(db, { name: 'Produits', fields: [text('X')] });
      expect(importQueries(db, [q('QM1', 'SELECT Ville INTO NouvelleTable FROM Clients')], T).lines).toEqual([{ code: 'queryImported', object: 'QM1' }]);
      expect(importQueries(db, [q('QU1', 'UPDATE Produits SET X = 1')], T).lines).toEqual(missing('QU1'));
      expect(importQueries(db, [q('QD1', 'DELETE * FROM Produits')], T).lines).toEqual(missing('QD1'));
    });
  });
  it('a renamed source is rewritten even when another source is outside the import', () => {
    createTable(db, { name: 'Clients1', fields: [text('Nom'), text('Ville')] }); // the table this import created
    const r = importQueries(db, [q('QMixte', 'SELECT Clients.Ville, Ext.X FROM Clients INNER JOIN Ext ON Clients.Ville = Ext.Ville')], [{ remote: 'Clients', name: 'Clients1' }]);
    expect(r.lines).toEqual([{ code: 'querySourceMissing', object: 'QMixte', part: 'Ext' }]);
    const sql = sqlOf(db, 'QMixte');
    expect(sql).toMatch(/Clients1/); expect(sql).not.toMatch(/Clients(?!1)/); expect(sql).toMatch(/Ext/);
  });
  it('the same when the outside source exists in the target', () => {
    createTable(db, { name: 'Clients1', fields: [text('Nom'), text('Ville')] });
    createTable(db, { name: 'Ext', fields: [text('X'), text('Ville')] });
    const r = importQueries(db, [q('QMixte', 'SELECT Clients.Ville, Ext.X FROM Clients INNER JOIN Ext ON Clients.Ville = Ext.Ville')], [{ remote: 'Clients', name: 'Clients1' }]);
    expect(r.lines).toEqual([{ code: 'querySourceMissing', object: 'QMixte', part: 'Ext' }]);
    const sql = sqlOf(db, 'QMixte');
    expect(sql).toMatch(/Clients1/); expect(sql).not.toMatch(/Clients(?!1)/); expect(sql).toMatch(/Ext/);
  });
  it('no rename, an outside source: the text stays byte for byte', () => {
    const sql = 'SELECT Clients.Ville, Ext.X\r\nFROM Clients INNER JOIN Ext ON Clients.Ville = Ext.Ville;\r\n';
    importQueries(db, [q('QLie', sql)], T);
    expect(sqlOf(db, 'QLie')).toBe(sql);
  });
});
