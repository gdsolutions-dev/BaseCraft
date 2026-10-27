import { expect, it } from 'vitest';
import { f, t } from '../test-fixtures';
import type { IndexDef, TableDesign } from '../field-types';
import { writableColumn } from '../record-source';
import { bindQuery, toSourceInfo, type QueryCatalog } from './bind';
import { parseSql } from './sql-parser';
import { uniqueKey } from './write-plan';

// A3's test base (Clients / Commandes), plus the join cases' tables.
const TABLES: TableDesign[] = [
  t('Clients', [f('N°', 'autoNumber'), f('Nom', 'shortText', { required: true }), f('Ville', 'shortText')]),
  t('Commandes', [f('N°', 'autoNumber'), f('Client', 'number', { numberSize: 'longInteger' }),
    f('Montant', 'currency', { validationRule: '>0' }), f('Le', 'dateTime')]),
  t('Lignes', [f('N°', 'autoNumber'), f('Commande', 'number', { numberSize: 'longInteger' }), f('Qté', 'number')]),
  t('Adresses', [f('N°', 'autoNumber'), f('Client', 'number', { numberSize: 'longInteger' })]),
  t('Fiches', [f('N°', 'number', { numberSize: 'longInteger', primaryKey: true }), f('Note', 'shortText')]),
  t('P', [f('code', 'shortText', { primaryKey: true }), f('lib', 'shortText')]),
  t('E', [f('n', 'autoNumber'), f('code', 'shortText')]),
];
const V = 'SELECT Commandes.[N°], Commandes.Client, Clients.[N°], Clients.Nom, Commandes.Montant FROM Clients INNER JOIN Commandes ON Clients.[N°] = Commandes.Client';
const QUERIES: Record<string, string> = { QV: `${V};`, QDepuis: 'SELECT * FROM [Commandes] WHERE [Le] >= #2026-10-01#;' };
const cat: QueryCatalog = {
  table: (name) => TABLES.find((x) => x.name.toLowerCase() === name.toLowerCase()) ?? null,
  query: (name) => Object.entries(QUERIES).find(([n]) => n.toLowerCase() === name.toLowerCase())?.[1] ?? null,
};
const b = (sql: string) => bindQuery(parseSql(sql), cat);
const design = (name: string): TableDesign => cat.table(name)!;
const withIndex = (d: TableDesign, ix: { unique: boolean; fields: string[] }): TableDesign =>
  ({ ...d, indexes: [{ name: 'ix', unique: ix.unique, fields: ix.fields.map((name) => ({ name, desc: false })) } satisfies IndexDef] });

it('one-to-many: Commandes is the key table, Clients is looked up by Client', () => {
  const q = b(V);
  expect(q).toMatchObject({ updatable: true, keyTable: 'Commandes' });
  expect(toSourceInfo(q).tables).toEqual([{ table: 'Commandes', role: 'key', readOnly: [], lookupBy: [] },
    { table: 'Clients', role: 'one', readOnly: ['N°'], lookupBy: ['Client'] }]);
  expect(['Commandes.N°', 'Client', 'Clients.N°', 'Nom', 'Montant'].map((n) => writableColumn(toSourceInfo(q), n))).toEqual([true, true, false, true, true]);
});
it('three levels: Lignes is the key; Clients chains through Commandes', () => {
  const q = b('SELECT Lignes.Commande, Lignes.Qté, Commandes.Montant, Clients.Nom FROM (Clients INNER JOIN Commandes ON Clients.[N°] = Commandes.Client) INNER JOIN Lignes ON Commandes.[N°] = Lignes.Commande');
  expect(toSourceInfo(q).tables!.map((x) => [x.table, x.role, x.lookupBy])).toEqual([['Lignes', 'key', []], ['Commandes', 'one', ['Commande']], ['Clients', 'one', ['Commande']]]);
  expect(q.writePlan![2]).toMatchObject({ table: 'Clients', parent: { via: 'Commandes', pairs: [{ child: 'Client', field: 'N°' }] } });
});
it('left join with the one side preserved is updatable', () => expect(b('SELECT Clients.Nom, Commandes.Montant FROM Clients LEFT JOIN Commandes ON Clients.[N°] = Commandes.Client').keyTable).toBe('Commandes'));
it('right join: the same plan as inner and left (final review M4)', () => {
  const q = b('SELECT Commandes.Client, Clients.Nom, Commandes.Montant FROM Commandes RIGHT JOIN Clients ON Clients.[N°] = Commandes.Client');
  expect(q).toMatchObject({ updatable: true, keyTable: 'Commandes' });
  expect(toSourceInfo(q).tables).toEqual([{ table: 'Commandes', role: 'key', readOnly: [], lookupBy: [] },
    { table: 'Clients', role: 'one', readOnly: ['N°'], lookupBy: ['Client'] }]);
  expect(b('SELECT Clients.Nom, Commandes.Montant FROM Clients RIGHT JOIN Commandes ON Clients.[N°] = Commandes.Client').keyTable).toBe('Commandes');
});
it('one-to-one: left is the key', () => expect(b('SELECT * FROM Clients INNER JOIN Fiches ON Clients.[N°] = Fiches.[N°]').keyTable).toBe('Clients'));
it('through a saved join query', () => {
  const q = b('SELECT Nom AS Client2, Montant FROM QV');
  expect(q).toMatchObject({ updatable: true, keyTable: 'Commandes' });
  expect(q.writeLevel).toBe(q.sources[0].inner);
  expect(toSourceInfo(q).tables).toEqual([{ table: 'Commandes', role: 'key', readOnly: [], lookupBy: [] },
    { table: 'Clients', role: 'one', readOnly: ['N°'], lookupBy: [] }]);
  expect(['Client2', 'Montant'].map((n) => writableColumn(toSourceInfo(q), n))).toEqual([true, true]);
});
it.each([
  'SELECT Clients.Nom, Commandes.Montant FROM Clients INNER JOIN Commandes ON Clients.Nom = Commandes.Le',                // many-to-many
  'SELECT Clients.Nom, Commandes.Montant FROM Clients, Commandes WHERE Clients.[N°] = Commandes.Client',                  // cross product
  'SELECT * FROM Clients INNER JOIN Commandes ON Clients.[N°] = Commandes.Client And Commandes.Montant > 1',             // not an equality
  'SELECT * FROM Clients INNER JOIN Clients AS C2 ON Clients.[N°] = C2.[N°]',                                             // a table twice
  'SELECT * FROM Clients INNER JOIN QDepuis ON Clients.[N°] = QDepuis.[N°]',                                              // saved query in the join
  'SELECT * FROM (Clients INNER JOIN Commandes ON Clients.[N°] = Commandes.Client) INNER JOIN Adresses ON Clients.[N°] = Adresses.Client', // two many sides
  'SELECT DISTINCT Clients.Nom FROM Clients INNER JOIN Commandes ON Clients.[N°] = Commandes.Client',
])('not updatable: %s', (sql) => expect(b(sql)).toMatchObject({ updatable: false }));
it('uniqueKey', () => {
  expect(uniqueKey(design('Clients'), ['N°'])).toBe(true);
  expect(uniqueKey(design('Clients'), ['Nom'])).toBe(false);
  expect(uniqueKey(withIndex(design('Clients'), { unique: true, fields: ['Nom', 'Ville'] }), ['Ville'])).toBe(false); // Review Focus 2: part of a composite key
  expect(uniqueKey(withIndex(design('Clients'), { unique: true, fields: ['Nom', 'Ville'] }), ['ville', 'NOM'])).toBe(true);
  expect(uniqueKey(withIndex(design('Clients'), { unique: false, fields: ['Nom', 'Ville'] }), ['Nom', 'Ville'])).toBe(false);
  expect(uniqueKey(t('X', [f('a', 'shortText', { indexed: 'yesNoDuplicates' }), f('b', 'shortText', { indexed: 'yesDuplicates' })]), ['a'])).toBe(true);
  expect(uniqueKey(t('X', [f('a', 'shortText', { indexed: 'yesNoDuplicates' }), f('b', 'shortText', { indexed: 'yesDuplicates' })]), ['b'])).toBe(false);
  expect(uniqueKey(t('X', [f('a', 'shortText', { primaryKey: true }), f('b', 'shortText', { primaryKey: true })]), ['a'])).toBe(false);
  expect(uniqueKey(t('X', [f('a', 'shortText')]), [])).toBe(false);
});
it('a text key that differs by case is still unique for the binding (R3 refuses at write time)', () =>
  expect(b('SELECT E.n, P.lib FROM P INNER JOIN E ON P.code = E.code').updatable).toBe(true));
