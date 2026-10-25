import { afterEach, beforeEach, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import type { RiskProbe } from '../db/location-risk';
import { countRows } from '../db/rows';
import { saveRelation } from '../db/relations';
import { createTable, listTables, tableDesign } from '../db/schema';
import { Session } from '../session';
import { localeInfo } from '../../shared/locale-format';
import { f, t } from '../../shared/test-fixtures';
import { actionCount, runAction } from './action';
import type { QueryRef } from './source';
import { seedSales, seedSalesRelation } from './test-db';

const probe: RiskProbe = { platform: 'win32', env: {}, homedir: 'C:\\Users\\x', windowsDriveType: () => 3 };
let dir: string;
let session: Session;
let db: DatabaseSync;
const ctx = { info: localeInfo('fr-FR'), writeSeq: () => 0, now: () => new Date(2026, 9, 23) };
const opts0 = { skipFailures: false, replaceTable: false };
const q = (name: string): QueryRef => ({ kind: 'query', name });
const sqlRef = (sql: string): QueryRef => ({ kind: 'sql', sql });
const saveQ = (name: string, sql: string) => expect(session.saveObject('query', name, { formatVersion: '1.0', sql }, null)).toEqual({ ok: true });
const rowsOf = (table: string) => {
  const s = db.prepare(`SELECT * FROM "${table}" ORDER BY rowid`);
  s.setReturnArrays(true);
  return s.all() as unknown as unknown[][];
};
const montants = () => rowsOf('Commandes').map((r) => r[2]);
const listTableNames = () => listTables(db).map((x) => x.name);

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bcact-'));
  session = Session.create(path.join(dir, 'test.basecraft'), { appVersion: '0.0.0', region: 'fr-FR', probe, sessionId: 'a' });
  db = (session as unknown as { db: DatabaseSync }).db;
  seedSales(db);
});
afterEach(() => {
  session.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

it('update through the write layer, rules checked', async () => {
  saveQ('QMaj', 'UPDATE Commandes SET Montant = Montant - 1 WHERE Client = 1'); // 10.10 -> 9.10; 0.10 -> -0.90 breaks >0
  expect(actionCount(db, q('QMaj'), {}, ctx)).toEqual({ count: 2, table: 'Commandes' });
  expect(await runAction(db, q('QMaj'), {}, opts0, ctx)).toMatchObject({ ok: false, reason: 'rowErrors', failed: 1, total: 2, errors: [{ field: 'Montant', code: 'validation' }],
    byCause: { conversion: 0, key: 0, lock: 0, validation: 1 } });
  expect(montants()).toEqual([10.1, 0.1, 0.2, 99.99, 0.1]); // all rolled back
  expect(await runAction(db, q('QMaj'), {}, { skipFailures: true, replaceTable: false }, ctx)).toEqual({ ok: true, count: 1 });
  expect(montants()).toEqual([9.1, 0.1, 0.2, 99.99, 0.1]);
});

it('masks are not enforced by action queries', async () => {
  createTable(db, t('Contacts', [f('Nom', 'shortText'), f('Tel', 'shortText', { inputMask: '00\\ 00\\ 00\\ 00\\ 00;0;_' })]));
  db.prepare('INSERT INTO "Contacts" ("Nom") VALUES (?)').run('a');
  expect(await runAction(db, sqlRef('UPDATE Contacts SET Tel = "12"'), {}, opts0, ctx)).toEqual({ ok: true, count: 1 });
  expect(rowsOf('Contacts')).toEqual([['a', '12']]);
});

it('update with a join: one write per target row, values converted as the target field stores them', async () => {
  // Commandes 1 and 2 belong to client 1: each is written once; Le gets a date computed by the expression
  expect(await runAction(db, sqlRef('UPDATE Clients INNER JOIN Commandes ON Clients.[N°] = Commandes.Client SET Clients.Ville = Clients.Ville & "!", Clients.Nom = Commandes.Le + 1 WHERE Commandes.Client = 1'), {}, opts0, ctx))
    .toEqual({ ok: true, count: 1 });
  expect(rowsOf('Clients')[0]).toEqual([1, '02/10/2026', 'Lyon!']);
});

it('delete respects referential integrity', async () => {
  seedSalesRelation(db);
  saveQ('QSup', 'DELETE * FROM Clients WHERE Ville = "Paris"');
  expect(await runAction(db, q('QSup'), {}, opts0, ctx)).toEqual({ ok: false, reason: 'related', table: 'Commandes' });
  expect(countRows(db, 'Clients')).toBe(4);
});

it('delete with a join and a parameter', async () => {
  saveQ('QSupLyon', 'DELETE Commandes.* FROM Commandes INNER JOIN Clients ON Clients.[N°] = Commandes.Client WHERE Clients.Ville = [V]');
  expect(actionCount(db, q('QSupLyon'), { V: 'lyon' }, ctx)).toEqual({ count: 4, table: 'Commandes' });
  expect(() => actionCount(db, q('QSupLyon'), {}, ctx)).toThrow('bc:missingParameter||V');
  expect(await runAction(db, q('QSupLyon'), { V: 'lyon' }, opts0, ctx)).toEqual({ ok: true, count: 4 }); // Lyon and LYON
  expect(countRows(db, 'Commandes')).toBe(1);
});

it('append keeps AutoNumber values and applies defaults / FK', async () => {
  seedSalesRelation(db);
  createTable(db, t('Archive', [f('N', 'autoNumber'), f('M', 'currency'), f('Note', 'shortText', { defaultValue: '"importé"' })]));
  expect(await runAction(db, sqlRef('INSERT INTO Archive (N, M) SELECT [N°], Montant FROM Commandes WHERE Montant > 50'), {}, opts0, ctx)).toEqual({ ok: true, count: 1 });
  expect(rowsOf('Archive')).toEqual([[4, 99.99, 'importé']]);
  expect(await runAction(db, sqlRef('INSERT INTO Commandes (Client, Montant) VALUES (99, 1)'), {}, opts0, ctx)).toMatchObject({ reason: 'rowErrors', errors: [{ code: 'noParent' }] });
  expect(countRows(db, 'Commandes')).toBe(5);
});

it('make table, then exists, then replace', async () => {
  const r = sqlRef('SELECT Client, Sum(Montant) AS Total INTO Totaux FROM Commandes GROUP BY Client');
  expect(actionCount(db, r, {}, ctx)).toEqual({ count: 3, table: 'Totaux' });
  expect(await runAction(db, r, {}, opts0, ctx)).toEqual({ ok: true, count: 3 });
  expect(actionCount(db, sqlRef('SELECT Client INTO totaux FROM Commandes'), {}, ctx).table).toBe('Totaux'); // the table it replaces
  expect(tableDesign(db, 'Totaux').fields.map((x) => [x.name, x.props.type])).toEqual([['Client', 'number'], ['Total', 'currency']]);
  expect(rowsOf('Totaux')).toEqual([[1, 10.2], [2, 0.3], [3, 99.99]]);
  expect(await runAction(db, r, {}, opts0, ctx)).toEqual({ ok: false, reason: 'tableExists', table: 'Totaux' });
  expect(await runAction(db, r, {}, { skipFailures: false, replaceTable: true }, ctx)).toEqual({ ok: true, count: 3 });
  expect(countRows(db, 'Totaux')).toBe(3);
});

it('make table: an AutoNumber becomes a Long Integer, without a key', async () => {
  expect(await runAction(db, sqlRef('SELECT [N°], Nom INTO Copie FROM Clients'), {}, opts0, ctx)).toEqual({ ok: true, count: 4 });
  expect(tableDesign(db, 'Copie').fields.map((x) => [x.name, x.props.type, x.props.numberSize, !!x.props.primaryKey, !!x.props.required]))
    .toEqual([['N°', 'number', 'longInteger', false, false], ['Nom', 'shortText', undefined, false, false]]);
});

it('make table never replaces a query', async () => {
  saveQ('Bilan', 'SELECT * FROM Clients');
  expect(await runAction(db, sqlRef('SELECT * INTO Bilan FROM Commandes'), {}, { skipFailures: false, replaceTable: true }, ctx)).toEqual({ ok: false, reason: 'nameExists', table: 'Bilan' });
});

it('a select query is no action query', async () => {
  expect(() => actionCount(db, sqlRef('SELECT * FROM Clients'), {}, ctx)).toThrow('bc:invalidArgument');
});

it('read-only session', async () => {
  saveQ('QMaj', 'UPDATE Commandes SET Montant = Montant - 1 WHERE Client = 1');
  const roSession = Session.open(path.join(dir, 'test.basecraft'), { appVersion: '0.0.0', region: 'fr-FR', probe, sessionId: 'b' });
  try {
    expect(roSession.state.readOnly).toBe(true);
    roSession.setContentEnabled(roSession.activeContent().fingerprint);
    expect(await roSession.runAction(q('QMaj'), {}, opts0)).toEqual({ ok: false, reason: 'readOnly' });
    expect((await roSession.actionCount(q('QMaj'), {})).count).toBe(2);
  } finally {
    roSession.close();
  }
});

it('append without a field list maps each column to the field of its name; VALUES stay positional', async () => {
  createTable(db, t('P', [f('Ville', 'shortText'), f('Nom', 'shortText')]));
  expect(await runAction(db, sqlRef('INSERT INTO P SELECT Nom, Ville FROM Clients WHERE [N°] = 1'), {}, opts0, ctx)).toEqual({ ok: true, count: 1 });
  expect(await runAction(db, sqlRef('INSERT INTO P VALUES ("Lille", "Leroy")'), {}, opts0, ctx)).toEqual({ ok: true, count: 1 });
  expect(rowsOf('P')).toEqual([['Lyon', 'Dupont'], ['Lille', 'Leroy']]);
  // SELECT * from a table with fewer fields: the target's extra field gets its default
  createTable(db, t('P2', [f('N°', 'autoNumber'), f('Nom', 'shortText'), f('Ville', 'shortText'), f('X', 'shortText', { defaultValue: '"?"' })]));
  expect(await runAction(db, sqlRef('INSERT INTO P2 SELECT * FROM Clients'), {}, opts0, ctx)).toEqual({ ok: true, count: 4 });
  expect(rowsOf('P2')[3]).toEqual([4, 'Éric', 'Lyôn', '?']);
  expect(() => actionCount(db, sqlRef('INSERT INTO P SELECT Nom, [N°] FROM Clients'), {}, ctx)).toThrow('bc:queryBind|unknownTarget|N°');
});

it('make table: a column name no table field can take is named; a failed replace keeps the old table and its rows', async () => {
  const join = 'FROM Clients INNER JOIN Commandes ON Clients.[N°] = Commandes.Client';
  expect(await runAction(db, sqlRef(`SELECT Clients.Nom, Commandes.[N°], Clients.[N°] INTO D ${join}`), {}, opts0, ctx))
    .toEqual({ ok: false, reason: 'badColumnName', column: 'Commandes.N°' });
  expect(listTableNames()).not.toContain('D');
  createTable(db, t('D2', [f('X', 'number')]));
  db.prepare('INSERT INTO "D2" VALUES (7)').run();
  expect(await runAction(db, sqlRef(`SELECT Clients.[N°], Commandes.[N°] INTO D2 ${join}`), {}, { skipFailures: false, replaceTable: true }, ctx))
    .toMatchObject({ ok: false, reason: 'badColumnName' });
  expect([rowsOf('D2'), tableDesign(db, 'D2').fields.map((x) => x.name)]).toEqual([[[7]], ['X']]);
  // a table with relations is never replaced: its rows stay
  seedSalesRelation(db);
  expect(await runAction(db, sqlRef('SELECT * INTO Commandes FROM Commandes WHERE Client = 1'), {}, { skipFailures: false, replaceTable: true }, ctx))
    .toEqual({ ok: false, reason: 'hasRelations' });
  expect(countRows(db, 'Commandes')).toBe(5);
});

it('refused rows are counted by cause, as Access words its question', async () => {
  expect(await runAction(db, sqlRef('UPDATE Commandes SET Montant = "abc" WHERE Client = 1'), {}, opts0, ctx))
    .toMatchObject({ reason: 'rowErrors', failed: 0, total: 2, byCause: { conversion: 2, key: 0, lock: 0, validation: 0 } }); // 2 fields set to Null
  createTable(db, t('K', [f('N', 'number'), f('Code', 'shortText', { indexed: 'yesNoDuplicates', required: true })]));
  db.prepare('INSERT INTO "K" VALUES (0, ?)').run('Lyon');
  // Lyon is in K already: a duplicate (key violation); a Null Code breaks Required (validation)
  expect(await runAction(db, sqlRef('INSERT INTO K (N, Code) SELECT [N°], Ville FROM Clients'), {}, opts0, ctx))
    .toMatchObject({ reason: 'rowErrors', failed: 1, total: 4, byCause: { conversion: 0, key: 1, lock: 0, validation: 0 } });
  expect(await runAction(db, sqlRef('INSERT INTO K (N, Code) VALUES (9, Null)'), {}, opts0, ctx))
    .toMatchObject({ reason: 'rowErrors', byCause: { conversion: 0, key: 0, lock: 0, validation: 1 } });
  // under skipFailures, exactly the other rows are written
  expect(await runAction(db, sqlRef('INSERT INTO K (N, Code) SELECT [N°], Ville FROM Clients'), {}, { skipFailures: true, replaceTable: false }, ctx)).toEqual({ ok: true, count: 3 });
  expect(rowsOf('K')).toEqual([[0, 'Lyon'], [2, 'LYON'], [3, 'Paris'], [4, 'Lyôn']]);
});

it('delete: rows held by related records are key violations; run anyway deletes exactly the others', async () => {
  seedSalesRelation(db);
  expect(await runAction(db, sqlRef('DELETE * FROM Clients'), {}, opts0, ctx))
    .toMatchObject({ ok: false, reason: 'rowErrors', failed: 3, total: 4, byCause: { conversion: 0, key: 3, lock: 0, validation: 0 }, errors: Array(3).fill({ field: '', code: 'related', table: 'Commandes' }) });
  expect(countRows(db, 'Clients')).toBe(4);
  expect(await runAction(db, sqlRef('DELETE * FROM Clients'), {}, { skipFailures: true, replaceTable: false }, ctx)).toEqual({ ok: true, count: 1 });
  expect(rowsOf('Clients').map((r) => r[0])).toEqual([1, 2, 3]);
});

it('cascade delete removes exactly the child rows of the deleted parents', async () => {
  const r = saveRelation(db, { name: '', parentTable: 'Clients', parentFields: ['N°'], childTable: 'Commandes', childFields: ['Client'],
    enforce: true, cascadeUpdate: false, cascadeDelete: true, joinType: 1 }, null, localeInfo('fr-FR'));
  expect(r.ok).toBe(true);
  expect(await runAction(db, sqlRef('DELETE * FROM Clients WHERE [N°] = 1'), {}, opts0, ctx)).toEqual({ ok: true, count: 1 });
  expect(rowsOf('Commandes').map((x) => x[0])).toEqual([3, 4, 5]);
  expect(rowsOf('Clients').map((x) => x[0])).toEqual([2, 3, 4]);
});

it('an update reads every value before writing: a swap uses the old values', async () => {
  createTable(db, t('S', [f('A', 'number'), f('B', 'number')]));
  db.prepare('INSERT INTO "S" VALUES (1, 2), (3, 4)').run();
  expect(await runAction(db, sqlRef('UPDATE S SET A = B, B = A'), {}, opts0, ctx)).toEqual({ ok: true, count: 2 });
  expect(rowsOf('S')).toEqual([[2, 1], [4, 3]]);
});

it('run anyway: a value its field cannot store is written as Null and the record kept (Access); only after Yes', async () => {
  const r = sqlRef('UPDATE Commandes SET Le = "pas une date", Montant = 1/0 WHERE Client = 1');
  expect(await runAction(db, r, {}, opts0, ctx)).toMatchObject({ ok: false, reason: 'rowErrors', failed: 0, total: 2,
    byCause: { conversion: 4, key: 0, lock: 0, validation: 0 }, errors: [{ field: 'Montant', code: 'expressionError' }, { field: 'Le', code: 'invalidDate' }, { field: 'Montant', code: 'expressionError' }, { field: 'Le', code: 'invalidDate' }] });
  expect(rowsOf('Commandes')[0]).toEqual([1, 1, 10.1, '2026-10-01 00:00:00']); // nothing written before Yes
  expect(await runAction(db, r, {}, { skipFailures: true, replaceTable: false }, ctx)).toEqual({ ok: true, count: 2 });
  expect(rowsOf('Commandes').slice(0, 2)).toEqual([[1, 1, null, null], [2, 1, null, null]]);
});

it('run anyway: a Required field, a primary key or an Is Not Null rule refuses the Null (validation)', async () => {
  createTable(db, t('R', [f('Code', 'number', { primaryKey: true }), f('Req', 'number', { required: true }), f('NN', 'number', { validationRule: 'Is Not Null' })]));
  const cause = async (sql: string) => {
    const res = await runAction(db, sqlRef(sql), {}, opts0, ctx);
    return res.ok === false && res.reason === 'rowErrors' ? [res.failed, res.byCause] : res;
  };
  const validation = [1, { conversion: 0, key: 0, lock: 0, validation: 1 }];
  expect(await cause('INSERT INTO R VALUES (1, "abc", 1)')).toEqual(validation);
  expect(await cause('INSERT INTO R VALUES ("abc", 1, 1)')).toEqual(validation);
  expect(await cause('INSERT INTO R VALUES (1, 1, "abc")')).toEqual(validation);
  expect(await runAction(db, sqlRef('INSERT INTO R VALUES (1, 1, "abc")'), {}, { skipFailures: true, replaceTable: false }, ctx)).toEqual({ ok: true, count: 0 });
  expect(countRows(db, 'R')).toBe(0);
});

it('conversion counts only fields set to Null: another refusal (an AutoNumber changed) is a rule violation', async () => {
  expect(await runAction(db, sqlRef('UPDATE Clients SET [N°] = 9 WHERE [N°] = 1'), {}, opts0, ctx))
    .toMatchObject({ reason: 'rowErrors', failed: 1, byCause: { conversion: 0, key: 0, lock: 0, validation: 1 }, errors: [{ code: 'readOnly' }] });
});

it('IIf runs only its chosen branch: 1/0 on the other rows gives no error', async () => {
  expect(await runAction(db, sqlRef('UPDATE Clients SET Ville = IIf([N°] = 2, 1 / 0, Nom)'), {}, opts0, ctx))
    .toMatchObject({ reason: 'rowErrors', failed: 0, total: 4, byCause: { conversion: 1, key: 0, lock: 0, validation: 0 }, errors: [{ field: 'Ville', code: 'expressionError' }] });
  expect(await runAction(db, sqlRef('UPDATE Clients SET Ville = IIf([N°] = 2, 1 / 0, Nom)'), {}, { skipFailures: true, replaceTable: false }, ctx)).toEqual({ ok: true, count: 4 });
  expect(rowsOf('Clients').map((r) => r[2])).toEqual(['Dupont', null, 'Durand', 'Éric']);
});
