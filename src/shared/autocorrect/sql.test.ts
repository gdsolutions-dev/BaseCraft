import { describe, expect, it } from 'vitest';
import type { NameChange } from '../api';
import { foldName, sameName, type TableDesign } from '../field-types';
import { f, t } from '../test-fixtures';
import { bindQuery, type QueryCatalog } from '../query/bind';
import { printSql } from '../query/print';
import { parseSql } from '../query/sql-parser';
import { outputRenames, renamedColumn, renamedName, rewriteQueryDefinition, rewriteSql, sameMeaning, toRenames } from './sql';

// seedSales's two designs (src/main/query/test-db.ts) and two of SALES_QUERIES (tests/e2e/helpers.ts, Playwright: not importable here).
const TABLES: TableDesign[] = [
  t('Clients', [f('N°', 'autoNumber'), f('Nom', 'shortText', { required: true }), f('Ville', 'shortText')]),
  t('Commandes', [f('N°', 'autoNumber'), f('Client', 'number', { numberSize: 'longInteger' }),
    f('Montant', 'currency', { validationRule: '>0' }), f('Le', 'dateTime')]),
];
const QVENTES = 'SELECT Clients.Nom, Commandes.Montant, Commandes.Le FROM Clients INNER JOIN Commandes ON Clients.[N°] = Commandes.Client;';
const QUERIES: Record<string, string> = { QVentes: QVENTES, QClientsLyon: 'SELECT * FROM [Clients] WHERE [Ville] = "Lyon";',
  QTous: 'SELECT * FROM Clients INNER JOIN Commandes ON Clients.[N°] = Commandes.Client;' }; // N° clashes: Clients.N°, Commandes.N°
const catalogOf = (tables: TableDesign[], queries: Record<string, string>): QueryCatalog => ({
  table: (n) => tables.find((x) => sameName(x.name, n)) ?? null,
  query: (n) => Object.entries(queries).find(([q]) => sameName(q, n))?.[1] ?? null,
});
const cat = catalogOf(TABLES, QUERIES);
const r = (c: NameChange[]) => toRenames(c);
const T = (from: string, to: string): NameChange => ({ k: 'object', kind: 'table', from, to });
const PT_DEF = { formatVersion: '2.0' as const, sql: 'SELECT * FROM Clients;', passThrough: { kind: 'postgresql' as const, params: {}, returnsRecords: true } };

/** The base as it will be: tables and fields renamed, saved queries rewritten (Task 6's overlay, for the round trip). */
function after(changes: NameChange[]): QueryCatalog {
  const rn = toRenames(changes);
  const tables = TABLES.map((d) => ({ ...d, name: renamedName(rn, 'table', d.name) ?? d.name,
    fields: d.fields.map((x) => ({ ...x, name: rn.fields.get(foldName(d.name))?.get(foldName(x.name)) ?? x.name })) }));
  const queries = Object.fromEntries(Object.entries(QUERIES).map(([n, sql]) => [renamedName(rn, 'query', n) ?? n, rewriteSql(sql, cat, rn, n) ?? sql]));
  return catalogOf(tables, queries);
}

describe('toRenames', () => {
  it('folds old names per namespace; a field change of a renamed table is keyed by its old name', () => {
    const x = toRenames([T('Clients', 'Clientèle'), { k: 'object', kind: 'form', from: 'FClients', to: 'FX' },
      { k: 'fields', table: 'clientèle', renames: [{ from: 'Nom', to: 'NomClient' }] }]);
    expect(renamedName(x, 'table', 'CLIENTS')).toBe('Clientèle');
    expect(renamedName(x, 'form', 'fclients')).toBe('FX');
    expect(renamedName(x, 'query', 'Clients')).toBeUndefined();
    expect(x.fields.get('clients')?.get('nom')).toBe('NomClient');
  });
});

describe('rewriteSql (tables, queries, forms, reports)', () => {
  it('renames a table in FROM, joins and unaliased qualifiers', () => {
    expect(rewriteSql(QVENTES, cat, r([T('Clients', 'Clientèle')])))
      .toBe('SELECT [Clientèle].[Nom], [Commandes].[Montant], [Commandes].[Le]\nFROM [Clientèle] INNER JOIN [Commandes] ON [Clientèle].[N°] = [Commandes].[Client];');
  });
  it('keeps an alias', () => expect(rewriteSql('SELECT C.Nom FROM Clients AS C;', cat, r([T('clients', 'X')]))).toBe('SELECT [C].[Nom]\nFROM [X] AS [C];'));
  it('follows subqueries, derived tables, [T].*, INTO and INSERT INTO', () => {
    const x = r([T('Clients', 'X')]);
    expect(rewriteSql('SELECT Nom FROM Clients WHERE Exists (SELECT * FROM Commandes WHERE Commandes.Client = Clients.[N°]);', cat, x))
      .toBe('SELECT [Nom]\nFROM [X]\nWHERE Exists (SELECT *\nFROM [Commandes]\nWHERE [Commandes].[Client] = [X].[N°]);');
    expect(rewriteSql('SELECT D.Nom FROM (SELECT Clients.Nom FROM Clients) AS D;', cat, x))
      .toBe('SELECT [D].[Nom]\nFROM (SELECT [X].[Nom]\nFROM [X]) AS [D];');
    expect(rewriteSql('SELECT Clients.*, Commandes.Montant FROM Clients INNER JOIN Commandes ON Clients.[N°] = Commandes.Client;', cat, x))
      .toBe('SELECT [X].*, [Commandes].[Montant]\nFROM [X] INNER JOIN [Commandes] ON [X].[N°] = [Commandes].[Client];');
    expect(rewriteSql('SELECT Nom INTO Copie FROM Clients;', cat, r([T('Copie', 'Copie2')]))).toBe('SELECT [Nom] INTO [Copie2]\nFROM [Clients];');
    expect(rewriteSql('INSERT INTO Clients (Nom, Ville) VALUES ("a", "b");', cat, x)).toBe('INSERT INTO [X] ([Nom], [Ville])\nVALUES ("a", "b");');
    expect(rewriteSql('INSERT INTO Commandes (Client) SELECT Clients.[N°] FROM Clients;', cat, x))
      .toBe('INSERT INTO [Commandes] ([Client])\nSELECT [X].[N°]\nFROM [X];');
    expect(rewriteSql('DELETE Clients.* FROM Clients WHERE Clients.Ville = "x";', cat, x)).toBe('DELETE [X].*\nFROM [X]\nWHERE [X].[Ville] = "x";');
    expect(rewriteSql('UPDATE Clients SET Clients.Ville = "a";', cat, x)).toBe('UPDATE [X]\nSET [X].[Ville] = "a";');
    expect(rewriteSql('SELECT Nom FROM Clients UNION SELECT Clients.Ville FROM Clients ORDER BY Nom;', cat, x))
      .toBe('SELECT [Nom]\nFROM [X]\nUNION\nSELECT [X].[Ville]\nFROM [X]\nORDER BY [Nom];');
    expect(rewriteSql('TRANSFORM Sum(Commandes.Montant) SELECT Clients.Nom FROM Clients INNER JOIN Commandes ON Clients.[N°] = Commandes.Client GROUP BY Clients.Nom PIVOT Clients.Ville;', cat, x))
      .toBe('TRANSFORM Sum([Commandes].[Montant])\nSELECT [X].[Nom]\nFROM [X] INNER JOIN [Commandes] ON [X].[N°] = [Commandes].[Client]\nGROUP BY [X].[Nom]\nPIVOT [X].[Ville];');
  });
  it('a name the binder gives to something else stays: an alias in a subquery, a derived table, a saved query', () => {
    const x = r([T('Clients', 'X')]);
    expect(rewriteSql('SELECT Nom FROM Clients WHERE Exists (SELECT * FROM Commandes AS Clients WHERE Clients.Client = 1);', cat, x))
      .toBe('SELECT [Nom]\nFROM [X]\nWHERE Exists (SELECT *\nFROM [Commandes] AS [Clients]\nWHERE [Clients].[Client] = 1);');
    expect(rewriteSql('SELECT Clients.Nom FROM (SELECT Nom FROM Clients) AS Clients;', cat, x))
      .toBe('SELECT [Clients].[Nom]\nFROM (SELECT [Nom]\nFROM [X]) AS [Clients];');
    expect(rewriteSql('SELECT QClientsLyon.Nom FROM QClientsLyon;', cat, x)).toBeNull(); // its own SQL is another object's
  });
  it('renames a saved query used as a source', () =>
    expect(rewriteSql('SELECT * FROM QVentes;', cat, r([{ k: 'object', kind: 'query', from: 'QVentes', to: 'QV' }]))).toBe('SELECT *\nFROM [QV];'));
  it('renames [Forms]![F]![C] on a form rename, [Reports]! on a report rename, never [TempVars]', () => {
    const sql = 'SELECT * FROM Clients WHERE Ville = [Forms]![FClients]![Ville] And Nom = [TempVars]![FClients] And Nom <> [Reports]![FClients]![Nom];';
    expect(rewriteSql(sql, cat, r([{ k: 'object', kind: 'form', from: 'fclients', to: 'FX' }])))
      .toBe('SELECT *\nFROM [Clients]\nWHERE [Ville] = [Forms]![FX]![Ville] And [Nom] = [TempVars]![FClients] And [Nom] <> [Reports]![FClients]![Nom];');
    expect(rewriteSql(sql, cat, r([{ k: 'object', kind: 'report', from: 'FClients', to: 'RX' }])))
      .toBe('SELECT *\nFROM [Clients]\nWHERE [Ville] = [Forms]![FClients]![Ville] And [Nom] = [TempVars]![FClients] And [Nom] <> [Reports]![RX]![Nom];');
    expect(rewriteSql(sql, cat, r([T('FClients', 'X')]))).toBeNull(); // a table of that name is not the form
  });
  it('leaves strings, parameters and unrelated SQL', () => {
    // the brief's DLookUp("Nom", "Clients"): BaseCraft has no domain functions (unknownFunction), the same strings in Nz
    expect(rewriteSql('SELECT Nz(Client, "Clients"), "Clients" AS [Nom] FROM Commandes WHERE "Clients" Like "Clients*";', cat, r([T('Clients', 'X')]))).toBeNull();
    expect(rewriteSql('SELECT * FROM Commandes WHERE Client = [Clients] Or Client = [Clients].[Zz];', cat, r([T('Clients', 'X')]))).toBeNull();
    expect(rewriteSql('PARAMETERS [Clients] Long; SELECT * FROM Commandes WHERE Client = [Clients];', cat, r([T('Clients', 'X')]))).toBeNull();
    expect(rewriteSql(QVENTES, cat, r([T('Autre', 'X'), { k: 'object', kind: 'form', from: 'Clients', to: 'X' }]))).toBeNull();
  });
  it('writes names that need brackets after the rename', () => {
    expect(rewriteSql('SELECT Clients.Nom FROM Clients;', cat, r([T('Clients', 'Mes clients')]))).toBe('SELECT [Mes clients].[Nom]\nFROM [Mes clients];');
    expect(rewriteSql('SELECT Clients.Nom FROM Clients;', cat, r([T('Clients', 'Select')]))).toBe('SELECT [Select].[Nom]\nFROM [Select];');
  });
  it('R8: a case-only rename writes the new spelling; a swap renames each name once', () => {
    expect(rewriteSql('SELECT Clients.Nom FROM Clients;', cat, r([T('Clients', 'clients')]))).toBe('SELECT [clients].[Nom]\nFROM [clients];');
    expect(rewriteSql('SELECT [clients].Nom FROM [clients];', cat, r([T('Clients', 'clients')]))).toBeNull();
    expect(rewriteSql(QVENTES, cat, r([T('Clients', 'Commandes'), T('Commandes', 'Clients')])))
      .toBe('SELECT [Commandes].[Nom], [Clients].[Montant], [Clients].[Le]\nFROM [Commandes] INNER JOIN [Clients] ON [Commandes].[N°] = [Clients].[Client];');
  });
  it('R8: a new name equal to another alias of the FROM fails, ambiguousField (the query is reported failed by R7)', () => {
    expect(() => rewriteSql('SELECT * FROM Clients, Commandes AS C2;', cat, r([T('Clients', 'C2')])))
      .toThrow(expect.objectContaining({ code: 'ambiguousField', detail: 'C2' }));
    // its print would not bind either
    expect(() => bindQuery(parseSql('SELECT * FROM [C2], [Commandes] AS [C2];'), after([T('Clients', 'C2')]))).toThrow(expect.objectContaining({ code: 'ambiguousField' }));
  });
  it('a new name equal to an alias of an enclosing or nested level fails (it would capture the references): ambiguousField', () => {
    const x = r([T('Clients', 'X')]);
    // the outer source renamed onto a subquery's alias: Clients.[N°] would read Commandes.[N°]
    expect(() => rewriteSql('SELECT Nom FROM Clients WHERE Exists (SELECT * FROM Commandes AS X WHERE X.Client = Clients.[N°]);', cat, x))
      .toThrow(expect.objectContaining({ code: 'ambiguousField', detail: 'X' }));
    // a subquery's source renamed onto an outer alias: the outer X.[N°] would read the subquery's
    expect(() => rewriteSql('SELECT * FROM Commandes AS X WHERE Exists (SELECT * FROM Clients WHERE Clients.Nom = "a" And X.[N°] = Clients.[N°]);', cat, x))
      .toThrow(expect.objectContaining({ code: 'ambiguousField', detail: 'X' }));
  });
  it('scopes that cannot see each other do not collide: sibling subqueries, UNION parts, a derived table', () => {
    const x = r([T('Clients', 'X')]);
    expect(rewriteSql('SELECT * FROM Commandes WHERE Exists (SELECT * FROM Clients WHERE Clients.[N°] = Commandes.Client) And Exists (SELECT * FROM Commandes AS X WHERE X.Client = 1);', cat, x))
      .toBe('SELECT *\nFROM [Commandes]\nWHERE Exists (SELECT *\nFROM [X]\nWHERE [X].[N°] = [Commandes].[Client]) And Exists (SELECT *\nFROM [Commandes] AS [X]\nWHERE [X].[Client] = 1);');
    expect(rewriteSql('SELECT Clients.Nom FROM Clients UNION SELECT X.Ville FROM Clients AS X;', cat, x))
      .toBe('SELECT [X].[Nom]\nFROM [X]\nUNION\nSELECT [X].[Ville]\nFROM [X] AS [X];');
    expect(rewriteSql('SELECT X.Nom FROM (SELECT Clients.Nom FROM Clients) AS D, Clients AS X;', cat, x))
      .toBe('SELECT [X].[Nom]\nFROM (SELECT [X].[Nom]\nFROM [X]) AS [D], [X] AS [X];');
  });
  it('a column named like the table is a field, never renamed', () => {
    const c = catalogOf([...TABLES, t('Ventes', [f('Clients', 'shortText')])], QUERIES);
    expect(rewriteSql('SELECT Clients FROM Ventes;', c, r([T('Clients', 'X')]))).toBeNull();
    expect(rewriteSql('SELECT Clients, Clients.Nom FROM Ventes, Clients;', c, r([T('Clients', 'X')]))).toBe('SELECT [Clients], [X].[Nom]\nFROM [Ventes], [X];');
  });
  it('throws the parse error, and the bind error', () => {
    expect(() => rewriteSql('SELECT FROM', cat, r([T('Clients', 'X')]))).toThrow();
    expect(() => rewriteSql('SELECT * FROM Zzz;', cat, r([T('Clients', 'X')]))).toThrow(expect.objectContaining({ code: 'unknownSource' }));
  });
  it('round trip: the printed SQL re-parses to itself and binds to the same meaning in the renamed base', () => {
    const changes = [T('Clients', 'Mes clients'), { k: 'object', kind: 'query', from: 'QVentes', to: 'QV' } as NameChange];
    const rn = toRenames(changes);
    for (const sql of [QVENTES, 'SELECT C.Nom, Clients.Ville FROM Clients, Clients AS C WHERE C.[N°] = Clients.[N°];',
      'SELECT Nom FROM Clients WHERE Exists (SELECT * FROM Commandes WHERE Commandes.Client = Clients.[N°]);',
      'SELECT * FROM QVentes WHERE Montant > [Mini];', 'SELECT D.Nom FROM (SELECT Clients.Nom FROM Clients) AS D;',
      'TRANSFORM Sum(Commandes.Montant) SELECT Clients.Nom FROM Clients INNER JOIN Commandes ON Clients.[N°] = Commandes.Client GROUP BY Clients.Nom PIVOT Clients.Ville;',
      'DELETE Clients.* FROM Clients WHERE Clients.Ville = [V];',
      'SELECT * FROM Commandes WHERE Exists (SELECT * FROM Clients WHERE Clients.[N°] = Commandes.Client) And Exists (SELECT * FROM Commandes AS X WHERE X.Client = 1);']) {
      const out = rewriteSql(sql, cat, rn)!;
      expect(printSql(parseSql(out))).toBe(out);
      expect(sameMeaning(sql, cat, out, after(changes), rn)).toBe(true);
    }
  });
  it('sameMeaning (R7, Task 6) sees a reference bound elsewhere: the captures the rewriter refuses', () => {
    const changes = [T('Clients', 'X')], rn = toRenames(changes), overlay = after(changes);
    // what the rewriter printed before it refused them: same columns and parameters, references read another source or level
    expect(sameMeaning('SELECT Nom FROM Clients WHERE Exists (SELECT * FROM Commandes AS X WHERE X.Client = Clients.[N°]);', cat,
      'SELECT [Nom] FROM [X] WHERE Exists (SELECT * FROM [Commandes] AS [X] WHERE [X].[Client] = [X].[N°]);', overlay, rn)).toBe(false);
    expect(sameMeaning('SELECT * FROM Commandes AS X WHERE Exists (SELECT * FROM Clients WHERE Clients.Nom = "a" And X.[N°] = Clients.[N°]);', cat,
      'SELECT * FROM [Commandes] AS [X] WHERE Exists (SELECT * FROM [X] WHERE [X].[Nom] = "a" And [X].[N°] = [X].[N°]);', overlay, rn)).toBe(false);
    expect(sameMeaning('SELECT Nom FROM Clients;', cat, 'SELECT [Ville] FROM [X];', overlay, rn)).toBe(false); // another field
    expect(sameMeaning('SELECT Nom FROM Clients;', cat, 'SELECT [Nom] FROM [X];', overlay, rn)).toBe(true);
    expect(() => sameMeaning('SELECT Nom FROM Clients;', cat, 'SELECT [Nom] FROM [Clients];', overlay, rn)).toThrow(expect.objectContaining({ code: 'unknownSource' }));
  });
});

const F = (table: string, ...p: [string, string][]): NameChange => ({ k: 'fields', table, renames: p.map(([from, to]) => ({ from, to })) });

describe('rewriteSql (fields and output columns)', () => {
  it('renames a field, bare and qualified, in every clause', () => {
    expect(rewriteSql('SELECT Nom FROM Clients WHERE Nom Like "D*" ORDER BY Clients.Nom;', cat, r([F('Clients', ['Nom', 'NomClient'])])))
      .toBe('SELECT [NomClient]\nFROM [Clients]\nWHERE [NomClient] Like "D*"\nORDER BY [Clients].[NomClient];');
    expect(rewriteSql('SELECT Ville, Count(*) FROM Clients GROUP BY Ville HAVING Count(Ville) > 1;', cat, r([F('Clients', ['Ville', 'Cité'])])))
      .toBe('SELECT [Cité], Count(*)\nFROM [Clients]\nGROUP BY [Cité]\nHAVING Count([Cité]) > 1;');
    expect(rewriteSql(QVENTES, cat, r([F('Clients', ['N°', 'Id'])])))
      .toBe('SELECT [Clients].[Nom], [Commandes].[Montant], [Commandes].[Le]\nFROM [Clients] INNER JOIN [Commandes] ON [Clients].[Id] = [Commandes].[Client];');
  });
  it('keeps an alias and its output name', () => expect(rewriteSql('SELECT Nom AS N FROM Clients;', cat, r([F('Clients', ['Nom', 'X'])]))).toBe('SELECT [X] AS [N]\nFROM [Clients];'));
  it('qualifies a name another source has (Review Focus 2)', () =>
    expect(rewriteSql('SELECT Nom FROM Clients INNER JOIN Commandes ON Clients.[N°] = Commandes.Client;', cat, r([F('Clients', ['Nom', 'Montant'])])))
      .toMatch(/^SELECT \[Clients\]\.\[Montant\]/));
  it('qualifies a reference another field renamed onto its name would capture, at its level or a nearer one', () => {
    // the other source gets the name: Nom would be ambiguous, both are qualified
    expect(rewriteSql('SELECT Nom, Montant FROM Clients INNER JOIN Commandes ON Clients.[N°] = Commandes.Client;', cat, r([F('Commandes', ['Montant', 'Nom'])])))
      .toBe('SELECT [Clients].[Nom], [Commandes].[Nom]\nFROM [Clients] INNER JOIN [Commandes] ON [Clients].[N°] = [Commandes].[Client];');
    // an outer field read from a subquery, the subquery's source renamed onto it: Ville would read Commandes
    expect(rewriteSql('SELECT * FROM Clients WHERE Exists (SELECT * FROM Commandes WHERE Ville = "a");', cat, r([F('Commandes', ['Montant', 'Ville'])])))
      .toBe('SELECT *\nFROM [Clients]\nWHERE Exists (SELECT *\nFROM [Commandes]\nWHERE [Clients].[Ville] = "a");');
    // the outer field renamed onto a field of the subquery's source
    expect(rewriteSql('SELECT * FROM Clients WHERE Exists (SELECT * FROM Commandes WHERE Ville = "a");', cat, r([F('Clients', ['Ville', 'Montant'])])))
      .toBe('SELECT *\nFROM [Clients]\nWHERE Exists (SELECT *\nFROM [Commandes]\nWHERE [Clients].[Montant] = "a");');
    // the qualifier itself is shadowed by the subquery's alias: no spelling reaches it, refused
    expect(() => rewriteSql('SELECT * FROM Clients WHERE Exists (SELECT * FROM Commandes AS Clients WHERE Ville = "a");', cat, r([F('Commandes', ['Montant', 'Ville'])])))
      .toThrow(expect.objectContaining({ code: 'ambiguousField', detail: 'Ville' }));
    // a swap between two sources needs no qualifier
    expect(rewriteSql('SELECT Nom, Montant FROM Clients, Commandes;', cat, r([F('Clients', ['Nom', 'Montant']), F('Commandes', ['Montant', 'Nom'])])))
      .toBe('SELECT [Montant], [Nom]\nFROM [Clients], [Commandes];');
  });
  it('swaps once (Review Focus 3)', () =>
    expect(rewriteSql('SELECT Nom, Ville FROM Clients;', cat, r([F('Clients', ['Nom', 'Ville'], ['Ville', 'Nom'])]))).toBe('SELECT [Ville], [Nom]\nFROM [Clients];'));
  it('follows a field through a saved query and a derived table', () => {
    expect(rewriteSql('SELECT Nom FROM QVentes;', cat, r([F('Clients', ['Nom', 'NomClient'])]))).toBe('SELECT [NomClient]\nFROM [QVentes];');
    expect(rewriteSql('SELECT D.Nom FROM (SELECT Nom FROM Clients) AS D;', cat, r([F('Clients', ['Nom', 'N2'])]))).toBe('SELECT [D].[N2]\nFROM (SELECT [N2]\nFROM [Clients]) AS [D];');
    // an aliased output column keeps its name: what reads it does not change
    expect(rewriteSql('SELECT D.N FROM (SELECT Nom AS N FROM Clients) AS D;', cat, r([F('Clients', ['Nom', 'N2'])]))).toBe('SELECT [D].[N]\nFROM (SELECT [N2] AS [N]\nFROM [Clients]) AS [D];');
    expect(rewriteSql('SELECT Nom FROM QClientsLyon;', cat, r([F('Clients', ['Nom', 'N2'])]))).toBe('SELECT [N2]\nFROM [QClientsLyon];'); // a * expansion
  });
  it('follows a column a table rename renames (a clash-qualified name)', () =>
    expect(rewriteSql('SELECT [Clients.N°], Nom FROM QTous;', cat, r([T('Clients', 'X')]))).toBe('SELECT [X.N°], [Nom]\nFROM [QTous];'));
  it('outputRenames: unaliased and * columns only', () => {
    const b = bindQuery(parseSql('SELECT *, Ville AS V FROM Clients;'), cat);
    expect([...outputRenames(b, r([F('Clients', ['Nom', 'NomClient'], ['Ville', 'Cité'])]))]).toEqual([['nom', 'NomClient'], ['ville', 'Cité']]); // `*`'s Ville; V stays
  });
  it('outputRenames: a clash-qualified name follows a table rename; a clash appears or goes', () => {
    const tous = bindQuery(parseSql(QUERIES.QTous!), cat);
    expect([...outputRenames(tous, r([T('Clients', 'X')]))]).toEqual([['clients.n°', 'X.N°']]);
    expect([...outputRenames(tous, r([F('Clients', ['N°', 'Id'])]))]).toEqual([['clients.n°', 'Id'], ['commandes.n°', 'N°']]);
    expect([...outputRenames(bindQuery(parseSql(QVENTES), cat), r([F('Clients', ['Nom', 'Montant'])]))]).toEqual([['nom', 'Clients.Montant'], ['montant', 'Commandes.Montant']]);
    expect(outputRenames(bindQuery(parseSql('SELECT * FROM Clients AS Clients, Commandes;'), cat), r([T('Clients', 'X')])).size).toBe(0); // an alias stays
    expect([...outputRenames(bindQuery(parseSql('SELECT Nom FROM QVentes;'), cat), r([F('Clients', ['Nom', 'N2'])]))]).toEqual([['nom', 'N2']]); // through the saved query
  });
  it('renamedColumn: a table\'s, a saved query\'s; never a link\'s', () => {
    const rn = r([F('Clients', ['Nom', 'N2'])]);
    const b = bindQuery(parseSql('SELECT * FROM Clients, QVentes;'), cat);
    expect(renamedColumn(b.sources[0]!, 'NOM', rn)).toBe('N2');
    expect(renamedColumn(b.sources[1]!, 'Nom', rn)).toBe('N2');
    expect(renamedColumn(b.sources[0]!, 'Ville', rn)).toBeUndefined();
    const linked = bindQuery(parseSql('SELECT * FROM Clients;'), { ...cat, sourceOf: () => 'autre' });
    expect(renamedColumn(linked.sources[0]!, 'Nom', rn)).toBeUndefined();
  });
  it('renames INSERT columns, UPDATE SET targets, crosstab value and pivot', () => {
    const x = r([F('Clients', ['Nom', 'N2'], ['Ville', 'Cité']), F('Commandes', ['Montant', 'Prix'], ['Client', 'Cl'])]);
    expect(rewriteSql('INSERT INTO Clients (Nom, Ville) VALUES ("a", "b");', cat, x)).toBe('INSERT INTO [Clients] ([N2], [Cité])\nVALUES ("a", "b");');
    expect(rewriteSql('UPDATE Clients SET Ville = "a", Clients.Nom = Nom & "!" WHERE Ville Is Null;', cat, x))
      .toBe('UPDATE [Clients]\nSET [Cité] = "a", [Clients].[N2] = [N2] & "!"\nWHERE [Cité] Is Null;');
    expect(rewriteSql('TRANSFORM Sum(Montant) SELECT Nom FROM Clients INNER JOIN Commandes ON Clients.[N°] = Commandes.Client GROUP BY Nom PIVOT Ville;', cat, x))
      .toBe('TRANSFORM Sum([Prix])\nSELECT [N2]\nFROM [Clients] INNER JOIN [Commandes] ON [Clients].[N°] = [Commandes].[Cl]\nGROUP BY [N2]\nPIVOT [Cité];');
  });
  it('INSERT … SELECT without a field list: the list is written when the names no longer match', () => {
    expect(rewriteSql('INSERT INTO Clients SELECT Nom, Ville FROM Clients;', cat, r([F('Clients', ['Ville', 'Cité'])])))
      .toBe('INSERT INTO [Clients]\nSELECT [Nom], [Cité]\nFROM [Clients];'); // the same rename on both sides: still matched by name
    // the output name changes, not the target field: the column keeps its target
    expect(rewriteSql('INSERT INTO Commandes SELECT [N°] FROM Clients;', cat, r([F('Clients', ['N°', 'Id'])])))
      .toBe('INSERT INTO [Commandes] ([N°])\nSELECT [Id]\nFROM [Clients];');
    expect(rewriteSql('INSERT INTO Clients SELECT Ville AS Nom FROM Clients;', cat, r([F('Clients', ['Nom', 'N2'])])))
      .toBe('INSERT INTO [Clients] ([N2])\nSELECT [Ville] AS [Nom]\nFROM [Clients];');
  });
  it('UNION: ORDER BY an output column follows its rename', () =>
    expect(rewriteSql('SELECT Nom FROM Clients UNION SELECT Ville FROM Clients ORDER BY Nom;', cat, r([F('Clients', ['Nom', 'N2'])])))
      .toBe('SELECT [N2]\nFROM [Clients]\nUNION\nSELECT [Ville]\nFROM [Clients]\nORDER BY [N2];'));
  it('writes a case-only rename', () => expect(rewriteSql('SELECT Nom FROM Clients;', cat, r([F('Clients', ['Nom', 'nom'])]))).toBe('SELECT [nom]\nFROM [Clients];'));
  it('never renames a string or a parameter of the field\'s old name', () => {
    expect(rewriteSql('PARAMETERS [Nom] Text; SELECT * FROM Commandes WHERE Montant > [Nom];', cat, r([F('Clients', ['Nom', 'N2'])]))).toBeNull();
    expect(rewriteSql('SELECT "Nom" AS [Nom2] FROM Clients WHERE Ville = [Clients.Nom];', cat, r([F('Clients', ['Nom', 'N2'])]))).toBeNull();
  });
  it('refuses a rename a parameter or an output alias would be captured by (Review Focus 2): ambiguousField', () => {
    // Montant → Nom: the parameter [Nom] would read the field
    expect(() => rewriteSql('PARAMETERS [Nom] Text; SELECT * FROM Commandes WHERE Montant > [Nom];', cat, r([F('Commandes', ['Montant', 'Nom'])])))
      .toThrow(expect.objectContaining({ code: 'ambiguousField', detail: 'Nom' }));
    // a qualified parameter of an existing source: Commandes.Nom
    expect(() => rewriteSql('SELECT * FROM Commandes WHERE Montant > [Commandes].[Nom];', cat, r([F('Commandes', ['Montant', 'Nom'])])))
      .toThrow(expect.objectContaining({ code: 'ambiguousField' }));
    // a parameter [X].[Nom] (no source X) and a table renamed X
    expect(() => rewriteSql('SELECT * FROM Clients WHERE Nom = [X].[Nom];', cat, r([T('Clients', 'X')])))
      .toThrow(expect.objectContaining({ code: 'ambiguousField', detail: 'X.Nom' }));
    // un-shadowing: the inner Clients renamed away, Clients.Montant (a parameter) would read the outer Commandes AS Clients
    expect(() => rewriteSql('SELECT * FROM Commandes AS Clients WHERE Exists (SELECT * FROM Clients WHERE Clients.Montant = 1);', cat, r([T('Clients', 'X')])))
      .toThrow(expect.objectContaining({ code: 'ambiguousField' }));
    // an output alias read in WHERE, a field renamed onto it
    expect(() => rewriteSql('SELECT Nom AS N FROM Clients WHERE N = "a";', cat, r([F('Clients', ['Ville', 'N'])])))
      .toThrow(expect.objectContaining({ code: 'ambiguousField', detail: 'N' }));
  });
  it('round trip: the print re-parses to itself and means what the query meant, saved queries rewritten', () => {
    const cases: [string, NameChange[]][] = [
      ['SELECT Nom FROM QVentes;', [F('Clients', ['Nom', 'NomClient'])]],
      ['SELECT * FROM QVentes WHERE Montant > 1;', [F('Commandes', ['Montant', 'Prix'])]],
      ['SELECT D.Nom FROM (SELECT Nom FROM Clients) AS D;', [F('Clients', ['Nom', 'N2'])]],
      ['SELECT Nom FROM Clients INNER JOIN Commandes ON Clients.[N°] = Commandes.Client;', [F('Clients', ['Nom', 'Montant'])]],
      ['SELECT * FROM Clients WHERE Exists (SELECT * FROM Commandes WHERE Ville = "a");', [F('Commandes', ['Montant', 'Ville'])]],
      ['SELECT Nom, Ville FROM Clients;', [F('Clients', ['Nom', 'Ville'], ['Ville', 'Nom'])]],
      ['SELECT [Clients.N°], Nom FROM QTous;', [T('Clients', 'X')]],
      ['SELECT * FROM Clients, Commandes WHERE Clients.Nom = "a";', [T('Clients', 'X')]],
      ['SELECT [Clients.N°] FROM QTous;', [F('Clients', ['N°', 'Id'])]],
      ['TRANSFORM Sum(Montant) SELECT Nom FROM Clients INNER JOIN Commandes ON Clients.[N°] = Commandes.Client GROUP BY Nom PIVOT Ville;', [F('Clients', ['Ville', 'Cité'])]],
      ['SELECT Nom FROM Clients UNION SELECT Ville FROM Clients ORDER BY Nom;', [F('Clients', ['Nom', 'N2'])]],
      ['UPDATE Clients SET Ville = "a" WHERE Nom = [N];', [F('Clients', ['Nom', 'N2'])]],
    ];
    for (const [sql, changes] of cases) {
      const rn = toRenames(changes), out = rewriteSql(sql, cat, rn)!;
      expect(printSql(parseSql(out))).toBe(out);
      expect(sameMeaning(sql, cat, out, after(changes), rn)).toBe(true);
    }
  });
  it('sameMeaning sees a field capture, a lost alias, and maps a saved query\'s or derived table\'s fields', () => {
    const rn = toRenames([F('Commandes', ['Montant', 'Ville'])]);
    // the unqualified outer Ville, printed as it was, reads the subquery's renamed field
    expect(sameMeaning('SELECT * FROM Clients WHERE Exists (SELECT * FROM Commandes WHERE Ville = "a");', cat,
      'SELECT * FROM [Clients] WHERE Exists (SELECT * FROM [Commandes] WHERE [Ville] = "a");', after([F('Commandes', ['Montant', 'Ville'])]), rn)).toBe(false);
    const n = [F('Clients', ['Nom', 'NomClient'])], rn2 = toRenames(n);
    expect(sameMeaning('SELECT Nom FROM QVentes;', cat, 'SELECT [NomClient] FROM [QVentes];', after(n), rn2)).toBe(true);
    expect(sameMeaning('SELECT D.Nom FROM (SELECT Nom FROM Clients) AS D;', cat, 'SELECT [D].[NomClient] FROM (SELECT [NomClient] FROM [Clients]) AS [D];', after(n), rn2)).toBe(true);
    expect(sameMeaning('SELECT Nom AS N FROM Clients;', cat, 'SELECT [NomClient] FROM [Clients];', after(n), rn2)).toBe(false); // the alias lost
    expect(sameMeaning('SELECT Nom FROM QVentes;', cat, 'SELECT [Nom] FROM [QVentes];', after(n), rn2)).toBe(false); // now a parameter
  });
});

describe('rewriteQueryDefinition', () => {
  it('a field rename keeps the layout', () => {
    const def = { formatVersion: '1.0' as const, sql: 'SELECT Nom FROM Clients;', layout: { tables: { Clients: { x: 1, y: 2 } }, widths: [3] } };
    expect(rewriteQueryDefinition(def, 'Q', cat, r([F('Clients', ['Nom', 'N2'])]))).toEqual({ ...def, sql: 'SELECT [N2]\nFROM [Clients];' });
  });
  it('moves the layout key of an unaliased renamed source', () => {
    expect(rewriteQueryDefinition({ formatVersion: '1.0', sql: 'SELECT * FROM Clients;', layout: { tables: { Clients: { x: 1, y: 2 } } }, keep: 1 }, 'Q', cat, r([T('Clients', 'X')])))
      .toEqual({ formatVersion: '1.0', sql: 'SELECT *\nFROM [X];', layout: { tables: { X: { x: 1, y: 2 } } }, keep: 1 });
  });
  it('keeps an alias key, an unknown key and the widths', () => {
    const def = { formatVersion: '1.0' as const, sql: 'SELECT * FROM Clients AS Commandes, Commandes AS K;', layout: { tables: { Commandes: { x: 1, y: 2 }, K: { x: 3, y: 4 }, Vieux: { x: 5, y: 6 } }, widths: [9] } };
    expect(rewriteQueryDefinition(def, 'Q', cat, r([T('Commandes', 'X'), T('Clients', 'Y')])))
      .toEqual({ ...def, sql: 'SELECT *\nFROM [Y] AS [Commandes], [X] AS [K];' });
    // a subquery's source is not the QBE's: the alias key of the same name stays
    const sub = { formatVersion: '1.0' as const, sql: 'SELECT * FROM Commandes AS Clients WHERE Client In (SELECT [N°] FROM Clients);', layout: { tables: { Clients: { x: 1, y: 2 } } } };
    expect(rewriteQueryDefinition(sub, 'Q', cat, r([T('Clients', 'X')])))
      .toEqual({ ...sub, sql: 'SELECT *\nFROM [Commandes] AS [Clients]\nWHERE [Client] In (SELECT [N°]\nFROM [X]);' });
  });
  it('null when nothing is renamed', () => expect(rewriteQueryDefinition({ formatVersion: '1.0', sql: QVENTES }, 'Q', cat, r([T('Zz', 'X')]))).toBeNull());
  it('never touches a pass-through', () => expect(rewriteQueryDefinition(PT_DEF, 'P', cat, r([T('Clients', 'X')]))).toBeNull());
});
