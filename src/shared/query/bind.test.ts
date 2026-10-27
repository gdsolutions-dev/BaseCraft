import { describe, expect, it } from 'vitest';
import type { Expr } from '../expr/ast';
import { coerce } from '../coerce';
import { localeInfo } from '../locale-format';
import { f, t } from '../test-fixtures';
import { defaultProps, type FieldProps, type TableDesign } from '../field-types';
import type { CrosstabQuery, SelectQuery } from './ast';
import { inHeadings } from './crosstab';
import { bindQuery, boundArgType, exprType, toSourceInfo, type BoundQuery, type QueryCatalog } from './bind';
import { parseQueryDefinition, queryDependents } from './definition';
import { parseSql } from './sql-parser';
import { printSql } from './print';

// Test base of the plan header (Clients / Commandes), plus T (UNION cases) and W (Decimal, Hyperlink, Yes/No).
const TABLES: TableDesign[] = [
  t('Clients', [f('N°', 'autoNumber'), f('Nom', 'shortText', { required: true }), f('Ville', 'shortText')]),
  t('Commandes', [f('N°', 'autoNumber'), f('Client', 'number', { numberSize: 'longInteger' }),
    f('Montant', 'currency', { validationRule: '>0' }), f('Le', 'dateTime')]),
  t('T', [f('a', 'shortText'), f('b', 'number')]),
  t('W', [f('d', 'number', { numberSize: 'decimal', precision: 18, scale: 2 }), f('h', 'hyperlink'), f('y', 'yesNo'),
    f('s', 'number', { numberSize: 'byte', caption: 'Petit' })]),
  t('Memos', [f('Notes', 'longText')]),
];
const QUERIES: Record<string, string> = {
  Q1: 'SELECT * FROM [Clients];',
  Q2: 'SELECT * FROM [Q1];',
  QClientsLyon: 'SELECT * FROM [Clients] WHERE [Ville] = "Lyon";',
  QCycle1: 'SELECT * FROM [QCycle2];',
  QCycle2: 'SELECT * FROM [QCycle1];',
  QParam: 'SELECT * FROM [Clients] WHERE [Ville] = [V];',
  QAction: 'DELETE * FROM [Clients];',
  QMake: 'SELECT * INTO [Copie] FROM [Clients];',
  QTotals: 'SELECT [Client], Sum([Montant]) AS [Total] FROM [Commandes] GROUP BY [Client];',
  QSum: 'SELECT Sum([s]) AS [Total] FROM [W];',
  QArt: 'SELECT IIf([y], [s], [d]) AS [Val] FROM [W];',
  QAvg: 'SELECT Avg([d]) AS [Moy] FROM [W];',
  ...Object.fromEntries(Array.from({ length: 17 }, (_, i) => [`D${i + 1}`, i ? `SELECT * FROM [D${i}];` : 'SELECT * FROM [Clients];'])),
};
const cat: QueryCatalog = {
  table: (name) => TABLES.find((x) => x.name.toLowerCase() === name.toLowerCase()) ?? null,
  query: (name) => Object.entries(QUERIES).find(([n]) => n.toLowerCase() === name.toLowerCase())?.[1] ?? null,
};

const b = (sql: string) => bindQuery(parseSql(sql), cat);
it('provenance and output names', () => {
  const q = b('SELECT Clients.[N°], Commandes.[N°], Nom, Montant * 2 FROM Clients INNER JOIN Commandes ON Clients.[N°] = Commandes.Client');
  expect(q.columns.map((c) => [c.name, c.type, c.origin])).toEqual([
    ['Clients.N°', 'autoNumber', { table: 'Clients', field: 'N°' }], ['Commandes.N°', 'autoNumber', { table: 'Commandes', field: 'N°' }],
    ['Nom', 'shortText', { table: 'Clients', field: 'Nom' }], ['Expr1000', 'currency', undefined]]);
  expect(q).toMatchObject({ updatable: true, keyTable: 'Commandes' }); // R7: a one-to-many join is updatable (B4)
});
it('single table query is updatable', () => expect(b('SELECT Nom, Ville FROM Clients WHERE Ville = "Lyon"')).toMatchObject({ updatable: true, keyTable: 'Clients' }));
it('updatable through a saved query', () => expect(b('SELECT * FROM QClientsLyon')).toMatchObject({ updatable: true, keyTable: 'Clients' }));
it.each(['SELECT DISTINCT Ville FROM Clients', 'SELECT Ville, Count(*) FROM Clients GROUP BY Ville', 'SELECT * FROM Clients UNION SELECT * FROM Clients'])
  ('not updatable: %s', (sql) => expect(b(sql).updatable).toBe(false));
it('parameters: declared first, inferred types, merged names', () => {
  const q = b('PARAMETERS [N] Long; SELECT * FROM Commandes WHERE Le >= [Date début :] AND Montant > [Mini ?] AND Client = [N] AND [Note] = [date début :]');
  expect(q.params).toEqual([{ name: 'N', type: 'number', props: expect.objectContaining({ numberSize: 'longInteger', required: false }) },
    { name: 'Date début :', type: 'dateTime', props: expect.objectContaining({ type: 'dateTime' }) },
    { name: 'Mini ?', type: 'currency', props: expect.objectContaining({ type: 'currency' }) }, { name: 'Note', type: null }]);
});
it('AutoNumber comparison gives a Long Integer parameter', () =>
  expect(b('SELECT * FROM Clients WHERE [N°] = [Num]').params).toEqual([{ name: 'Num', type: 'number', props: expect.objectContaining({ numberSize: 'longInteger' }) }]));
it('typo becomes a parameter, like Access', () => expect(b('SELECT * FROM Clients WHERE Vile = "Lyon"').params).toEqual([{ name: 'Vile', type: null }]));
it.each([
  ['SELECT * FROM Zzz', 'unknownSource', 'Zzz'], ['SELECT [N°] FROM Clients, Commandes', 'ambiguousField', 'N°'],
  ['SELECT * FROM QCycle1', 'circular', 'QCycle1 → QCycle2 → QCycle1'], ['SELECT Nom, Count(*) FROM Clients', 'notGrouped', '[Nom]'],
  ['SELECT * FROM Clients WHERE Count(*) > 1', 'aggregateInWhere', ''], ['SELECT Sum(Max([Montant])) FROM Commandes', 'nestedAggregate', ''],
  ['SELECT a FROM T UNION SELECT a, b FROM T', 'unionArity', ''],
  ['UPDATE Clients INNER JOIN Commandes ON Clients.[N°] = Commandes.Client SET Nom = "x", Montant = 1', 'updateTarget', ''],
])('%s', (sql, code, detail) => expect(() => b(sql)).toThrow(expect.objectContaining({ code, ...(detail ? { detail } : {}) })));
it('a scalar or In subquery returns exactly one column (Exists takes any)', () => {
  for (const sql of ['SELECT Nom, (SELECT * FROM Commandes) FROM Clients', 'SELECT Nom FROM Clients WHERE [N°] In (SELECT Client, Montant FROM Commandes)'])
    expect(bindErr(sql)[0]).toBe('subqueryArity');
  expect(() => b('SELECT Nom FROM Clients WHERE Exists (SELECT * FROM Commandes)')).not.toThrow();
  expect(() => b('SELECT Nom FROM Clients WHERE [N°] In (SELECT Client FROM Commandes)')).not.toThrow();
});
it('correlated subquery resolves outer columns', () => {
  const q = b('SELECT Nom FROM Clients AS C WHERE Exists (SELECT * FROM Commandes WHERE Commandes.Client = C.[N°])');
  expect(q.params).toEqual([]);
});
it('toSourceInfo', () => expect(toSourceInfo(b('SELECT Nom FROM Clients WHERE Ville = [V]'))).toEqual({
  fields: [{ name: 'Nom', type: 'shortText', props: expect.objectContaining({ type: 'shortText' }), origin: { table: 'Clients', field: 'Nom' } }],
  updatable: true, keyTable: 'Clients', parameters: [{ name: 'V', type: 'shortText', props: expect.objectContaining({ type: 'shortText' }) }],
  tables: [{ table: 'Clients', role: 'key', readOnly: [], lookupBy: [] }] }));
it('definition validation', () => {
  expect(parseQueryDefinition({ formatVersion: '1.0', sql: 'SELECT * FROM T', future: 1 })).toMatchObject({ future: 1 });
  for (const bad of [null, { formatVersion: '2.0', sql: 'SELECT 1 FROM T' }, { formatVersion: '1.0', sql: 'DROP TABLE T' }, { formatVersion: '1.0', sql: 'x'.repeat(1_048_577) }])
    expect(() => parseQueryDefinition(bad)).toThrow(/bc:invalidQuery/);
});

// ---- Beyond the brief ------------------------------------------------------------------------------------------

/** Code and detail of the binding error. */
const bindErr = (sql: string): [string, string] => {
  try { b(sql); } catch (e) { const x = e as { name: string; code: string; detail: string; message: string };
    expect(x.name).toBe('QueryBindError');
    expect(x.message).toBe(`bc:queryBind|${x.code}|${x.detail}`);
    return [x.code, x.detail]; }
  throw new Error(`bound: ${sql}`);
};

describe('sources', () => {
  it('saved queries nest, are bound once, and keep their own provenance', () => {
    const q = b('SELECT * FROM Q2 AS X');
    expect(q.columns.map((c) => [c.name, c.origin])).toEqual([['N°', { table: 'Clients', field: 'N°' }], ['Nom', { table: 'Clients', field: 'Nom' }],
      ['Ville', { table: 'Clients', field: 'Ville' }]]);
    expect(q.sources).toMatchObject([{ alias: 'X', name: 'Q2', kind: 'query', inner: { sources: [{ alias: 'Q1', kind: 'query' }] } }]);
    expect(q).toMatchObject({ updatable: true, keyTable: 'Clients', keyAlias: 'X' });
  });
  it('16 levels of saved queries, not 17', () => {
    expect(b('SELECT * FROM D16').columns).toHaveLength(3);
    expect(bindErr('SELECT * FROM D17')).toEqual(['tooDeep', 'D1']);
    // the binding of D2 (made 1 level deep) is not reused 16 levels deep, where its source D1 is one level too many
    expect(bindErr('SELECT * FROM D2 AS A, D17')).toEqual(['tooDeep', 'D1']);
  });
  it('a saved query used twice is bound once', () => {
    const q = b('SELECT A.Nom FROM Q1 AS A, Q1 AS B');
    expect(q.sources[0].inner).toBe(q.sources[1].inner);
  });
  it('an action query as a source is bc:notSelectQuery, thrown as is', () => {
    for (const sql of ['SELECT * FROM QAction', 'SELECT * FROM QMake']) expect(() => b(sql)).toThrow(new Error('bc:notSelectQuery'));
  });
  it('a totals query as a source: computed columns without origin, not updatable', () => {
    const q = b('SELECT * FROM QTotals');
    expect(q.columns.map((c) => [c.name, c.type, c.origin])).toEqual([['Client', 'number', { table: 'Commandes', field: 'Client' }], ['Total', 'currency', undefined]]);
    expect(q.updatable).toBe(false);
  });
  it('derived tables', () => {
    const q = b('SELECT X.n, Y.Nom FROM (SELECT Count(*) AS n FROM Clients) AS X, (SELECT Nom FROM Clients WHERE Ville = [V]) Y');
    expect(q.columns.map((c) => [c.name, c.type, c.origin])).toEqual([['n', 'number', undefined], ['Nom', 'shortText', { table: 'Clients', field: 'Nom' }]]);
    expect(q.sources.map((s) => [s.alias, s.kind])).toEqual([['X', 'derived'], ['Y', 'derived']]);
    expect(q.params).toEqual([{ name: 'V', type: 'shortText', props: expect.objectContaining({ type: 'shortText' }) }]);
  });
  it.each([
    ['SELECT * FROM Clients, Clients', 'ambiguousField', 'Clients'],
    ['SELECT X.* FROM Clients', 'unknownSource', 'X'],
  ])('%s', (sql, code, detail) => expect(bindErr(sql)).toEqual([code, detail]));
});

describe('resolving identifiers', () => {
  it('qualified by alias only (an aliased table\'s own name is a parameter, as in Access); an unknown field of a known source is the parameter A.F', () => {
    const q = b('SELECT C.Nom, Clients.Ville FROM Clients AS C WHERE C.Pays = 1 Or Zz.y = 2');
    expect(q.columns.map((c) => c.name)).toEqual(['Nom', 'Expr1000']);
    expect(q.params.map((p) => p.name)).toEqual(['Clients.Ville', 'C.Pays', 'Zz.y']);
    expect(b('SELECT Clients.Nom FROM Clients AS C, Clients AS D').params.map((p) => p.name)).toEqual(['Clients.Nom']);
  });
  it('a table aliased in a subquery never captures the outer table of the same name (correlation)', () => {
    /** Refs of the two sides of the first subquery's WHERE. */
    const sides = (sql: string) => {
      const q = b(sql);
      const where = [...q.selects.keys()].find((s) => s !== q.query.body)!.where as Extract<Expr, { k: 'bin' }>;
      return [q.refs.get(where.l), q.refs.get(where.r)];
    };
    // Allen Browne's delete-duplicates query: Clients.Ville is the outer row, not Dupe.Ville (else all rows but one are deleted)
    expect(sides('DELETE * FROM Clients WHERE [N°] <> (SELECT Min([N°]) FROM Clients AS Dupe WHERE Dupe.Ville = Clients.Ville)')).toMatchObject([
      { kind: 'column', alias: 'Dupe', field: 'Ville', depth: 0 }, { kind: 'column', alias: 'Clients', field: 'Ville', depth: 1 }]);
    expect(sides('SELECT Nom FROM Clients WHERE Exists (SELECT * FROM Clients AS C2 WHERE C2.Ville = Clients.Ville)')).toMatchObject([
      { alias: 'C2', depth: 0 }, { alias: 'Clients', depth: 1 }]);
  });
  it('output aliases: the select list sees earlier ones; WHERE, HAVING and ORDER BY see them all; GROUP BY never', () => {
    const q = b('SELECT Montant * 2 AS M2, M2 + 1 AS M3, M4 FROM Commandes WHERE M3 > 1 ORDER BY M2');
    const sel = q.query.body as SelectQuery;
    const ref = (e: Expr) => q.refs.get(e);
    expect(ref((sel.items[1] as { e: Extract<Expr, { k: 'bin' }> }).e.l)).toEqual({ kind: 'output', index: 0 });
    expect(ref((sel.where as Extract<Expr, { k: 'bin' }>).l)).toEqual({ kind: 'output', index: 1 });
    expect(ref(sel.orderBy[0].e)).toEqual({ kind: 'output', index: 0 });
    expect(q.params.map((p) => p.name)).toEqual(['M4']);
    expect(q.columns.map((c) => [c.name, c.type])).toEqual([['M2', 'currency'], ['M3', 'number'], ['Expr1000', 'shortText']]);
    expect(bindErr('SELECT Ville AS V, Count(*) FROM Clients GROUP BY V')).toEqual(['notGrouped', '[Ville]']); // V: a parameter
  });
  it('a field of the level wins over an outer one, an outer one over an output alias', () => {
    const q = b('SELECT Nom AS Client FROM Clients WHERE Exists (SELECT Montant AS Ville FROM Commandes WHERE Client = 1 ORDER BY Ville)');
    const inner = [...q.selects.keys()].find((s) => s !== q.query.body)!;
    expect(q.refs.get((inner.where as Extract<Expr, { k: 'bin' }>).l)).toMatchObject({ kind: 'column', alias: 'Commandes', field: 'Client', depth: 0 });
    expect(q.refs.get(inner.orderBy[0].e)).toMatchObject({ kind: 'column', alias: 'Clients', field: 'Ville', depth: 1 });
  });
  it('T.* and * expand in field order; duplicate names are qualified, then refused', () => {
    expect(b('SELECT Commandes.*, Nom FROM Clients, Commandes').columns.map((c) => c.name)).toEqual(['N°', 'Client', 'Montant', 'Le', 'Nom']);
    expect(b('SELECT * FROM Clients, Commandes').columns.map((c) => c.name))
      .toEqual(['Clients.N°', 'Nom', 'Ville', 'Commandes.N°', 'Client', 'Montant', 'Le']);
    expect(b('SELECT Nom & "", Ville AS Expr1000 FROM Clients').columns.map((c) => c.name)).toEqual(['Expr1001', 'Expr1000']);
    expect(bindErr('SELECT Nom AS A, Ville AS a FROM Clients')).toEqual(['duplicateOutput', 'a']);
    // the same field twice from one source (Output All Fields with the field shown): the later one is T.F, as in Access
    expect(b('SELECT *, Clients.Nom FROM Clients').columns.map((c) => c.name)).toEqual(['N°', 'Nom', 'Ville', 'Clients.Nom']);
    expect(b('SELECT Nom, Nom FROM Clients AS C').columns.map((c) => c.name)).toEqual(['Nom', 'C.Nom']);
    expect(bindErr('SELECT Nom, Nom, Nom FROM Clients')).toEqual(['duplicateOutput', 'Clients.Nom']); // still the same name
    expect(bindErr('SELECT Nom, Ville AS [Clients.Nom], Nom FROM Clients')).toEqual(['duplicateOutput', 'Clients.Nom']);
  });
});

describe('parameters', () => {
  it('order of appearance in the text, source queries included and merged', () => {
    expect(b('SELECT [A] AS x FROM QParam WHERE Nom = [v] And [B] = 1').params.map((p) => [p.name, p.type]))
      .toEqual([['A', null], ['V', 'shortText'], ['B', null]]);
    expect(b('SELECT * FROM Clients WHERE [P] = 1 And Exists (SELECT * FROM Commandes WHERE Client = [Q] And [p] = Montant)').params
      .map((p) => [p.name, p.type])).toEqual([['P', 'currency'], ['Q', 'number']]);
  });
  it('inferred from Between and In, both ways; Hyperlink gives Short Text; Decimal keeps its scale', () => {
    const q = b('SELECT * FROM Commandes, W WHERE Le Between [Du] And [Au] And [N] In (Client, 2) And h = [Ph] And d > [Pd] And s = [Ps]');
    expect(q.params).toEqual([
      { name: 'Du', type: 'dateTime', props: expect.objectContaining({ type: 'dateTime', required: false }) },
      { name: 'Au', type: 'dateTime', props: expect.anything() },
      { name: 'N', type: 'number', props: expect.objectContaining({ numberSize: 'longInteger' }) },
      { name: 'Ph', type: 'shortText', props: expect.objectContaining({ type: 'shortText' }) },
      { name: 'Pd', type: 'number', props: expect.objectContaining({ numberSize: 'decimal', precision: 18, scale: 2 }) },
      { name: 'Ps', type: 'number', props: expect.objectContaining({ numberSize: 'byte', required: false }) },
    ]);
    expect(q.params[5].props).not.toHaveProperty('caption');
  });
  it('a declared parameter keeps its declared type', () =>
    expect(b('PARAMETERS [D] Text; SELECT * FROM Commandes WHERE Le = [d]').params).toEqual([{ name: 'D', type: 'shortText', props: expect.objectContaining({ type: 'shortText' }) }]));
});

describe('exprType', () => {
  const types = (sql: string) => b(`SELECT ${sql} FROM Commandes, W`).columns.map((c) => c.type);
  it.each([
    ['1, "a", #2026-01-01#, True, Null, Montant & 1', ['number', 'shortText', 'dateTime', 'yesNo', 'shortText', 'shortText']],
    ['Le + 1, 1 + Le, Le - 1, Le - Le, Montant + Montant, Montant + 1', ['dateTime', 'dateTime', 'dateTime', 'number', 'currency', 'number']],
    ['Montant * 2, 2 / Montant, Montant * Montant, Client \\ 2, Client Mod 2, 2 ^ 2', ['currency', 'currency', 'number', 'number', 'number', 'number']],
    ['Client = 1, Not y, y And y, Montant Like "1*", Client In (1, 2), Le Is Null, Client Between 1 And 2', Array(7).fill('yesNo')],
    ['-Montant, -Le, Left(h, 2), CCur(1), IIf(y, Montant, Null), IIf(y, Null, Le), Nz(Le, 0)', ['currency', 'dateTime', 'shortText', 'currency', 'currency', 'dateTime', 'dateTime']],
    // as the evaluator: + of two texts concatenates; date + date and number - date are dates
    ['"a" + "b", h + h, Null + "a", "1" + 1, 1 - Le, Le + Le', ['shortText', 'longText', 'shortText', 'number', 'dateTime', 'dateTime']],
    ['Count(*), Min([Commandes].[N°]), Max(Le), StDev(Montant)', ['number', 'number', 'dateTime', 'number']],
    ['(SELECT Max(Montant) FROM Commandes), Exists (SELECT * FROM T), [p]', ['currency', 'yesNo', 'shortText']],
  ])('%s', (sql, expected) => expect(types(sql)).toEqual(expected));

  it('Sum and Avg (C12): Currency and Decimal keep their type; integers, Yes/No, Date/Time and the rest give Double', () => {
    const q = b('SELECT Sum(Montant) AS a, Avg(Montant) AS b, Sum(d) AS c, Avg(d) AS e, Sum(y) AS g, Avg(Le) AS h, Sum(s) AS i, Avg(s) AS j, '
      + 'Sum([Commandes].[N°]) AS k FROM Commandes, W');
    expect(q.columns.map((c) => [c.name, c.type, c.props.numberSize, c.props.scale])).toEqual([
      ['a', 'currency', undefined, undefined], ['b', 'currency', undefined, undefined],
      ['c', 'number', 'decimal', 2], ['e', 'number', 'decimal', 12], ['g', 'number', 'double', 0], ['h', 'number', 'double', 0],
      ['i', 'number', 'double', 0], ['j', 'number', 'double', 0], ['k', 'number', 'double', 0],
    ]);
  });
  it('Sum and Avg of an expression: the type the accumulator sums with (aggregateArgType over the binding, C12)', () => {
    const q = b('SELECT Sum(d * 2) AS a, Sum(d + d) AS c, Avg(d * s) AS e, Sum(Montant + 1) AS g, Avg(Montant - 1) AS h, '
      + 'Sum(IIf(y, 0, Montant)) AS i, Sum(Montant - Client) AS j, Sum(Client * 2) AS k, Avg(Client * 2) AS m, Sum(Le + 1) AS n, '
      + 'Sum(Montant * d) AS o FROM Commandes, W');
    expect(q.columns.map((c) => [c.name, c.type, c.props.numberSize, c.props.precision, c.props.scale])).toEqual([
      ['a', 'number', 'decimal', 28, 2], ['c', 'number', 'decimal', 28, 2], ['e', 'number', 'decimal', 28, 2],
      ['g', 'currency', undefined, undefined, undefined], ['h', 'currency', undefined, undefined, undefined],
      ['i', 'currency', undefined, undefined, undefined], ['j', 'currency', undefined, undefined, undefined],
      ['k', 'number', 'double', 18, 0], ['m', 'number', 'double', 18, 0], ['n', 'number', 'double', 18, 0],
      ['o', 'number', 'decimal', 28, 6],
    ]);
  });
  it('Sum of a Byte, Integer or Long Integer total is a Double: the accumulator total is unbounded, so a parameter is not narrowed', () => {
    expect(b('SELECT * FROM (SELECT Sum(s) AS tot, Sum(b) AS tb FROM W, T) AS X WHERE tot > [Mini] AND tb > [B]').params).toEqual([
      { name: 'Mini', type: 'number', props: expect.objectContaining({ numberSize: 'double' }) },
      { name: 'B', type: 'number', props: expect.objectContaining({ numberSize: 'double' }) }]);
    expect(b('SELECT * FROM QSum WHERE Total > [Mini]').params)
      .toEqual([{ name: 'Mini', type: 'number', props: expect.objectContaining({ numberSize: 'double' }) }]);
  });
  it('IIf and Nz: a type and size only when every branch has them (Null left out; an integer literal that fits takes them)', () => {
    const q = b('SELECT IIf(y, s, b) AS a, IIf(y, s, d) AS c, Nz(s, 2.5) AS e, IIf(y, s, Montant) AS m, IIf(y, Montant, s) AS mr, '
      + 'IIf(y, d, s) AS r, Nz(s, 0) AS z, Nz(s, 300) AS o, IIf(y, Null, s) AS n, IIf(y, Montant, 0) AS k, Nz(d, 0) AS dz, '
      + 'IIf(y, Le, h) AS lt FROM W, T, Commandes');
    expect(q.columns.map((c) => [c.name, c.type, c.props.numberSize, c.props.scale])).toEqual([
      ['a', 'number', 'double', 0], ['c', 'number', 'double', 0], ['e', 'number', 'double', 0], ['m', 'number', 'double', 0],
      ['mr', 'number', 'double', 0], ['r', 'number', 'double', 0], ['z', 'number', 'byte', 0], ['o', 'number', 'double', 0],
      ['n', 'number', 'byte', 0], ['k', 'currency', undefined, undefined], ['dz', 'number', 'decimal', 2],
      ['lt', 'longText', undefined, undefined]]);
    // a parameter compared with such a column, through a saved query, is a Double: 2.75 is not rounded to a Byte's 3
    expect(b('SELECT * FROM QArt WHERE Val = [Valeur ?]').params)
      .toEqual([{ name: 'Valeur ?', type: 'number', props: expect.objectContaining({ numberSize: 'double' }) }]);
  });
  it('Avg of a Decimal: scale widened to what the accumulator returns, integer digits kept, so a parameter keeps 1.666', () => {
    const [seuil] = b('SELECT * FROM QAvg WHERE Moy > [Seuil]').params;
    expect(seuil).toEqual({ name: 'Seuil', type: 'number', props: expect.objectContaining({ numberSize: 'decimal', precision: 28, scale: 12 }) });
    expect(coerce({ name: 'Seuil', props: seuil!.props! }, '1.666', localeInfo('en-US'))).toEqual({ ok: true, value: '1.666000000000' });
    expect(coerce({ name: 'Seuil', props: seuil!.props! }, '9999999999999999.5', localeInfo('en-US'))).toEqual({ ok: true, value: '9999999999999999.500000000000' });
  });
  it('a text expression with a Long Text branch or operand is Long Text: Make-Table keeps notes over 255 characters', () => {
    const q = b('SELECT Nz(Notes, "") AS a, IIf(y, Notes, Nom) AS c, IIf(y, Notes, h) AS e, IIf(y, Notes, 1.5) AS g, Notes & "" AS k, '
      + 'Notes + Nom AS m, IIf(y, Nom, h) AS n FROM Memos, W, Clients');
    expect(q.columns.map((c) => c.type)).toEqual(['longText', 'longText', 'longText', 'longText', 'longText', 'longText', 'longText']);
    expect(b('SELECT * FROM (SELECT Nz(Notes, "") AS n FROM Memos) AS X WHERE n = [Texte]').params)
      .toEqual([{ name: 'Texte', type: 'longText', props: expect.objectContaining({ type: 'longText' }) }]);
  });
  it('Hyperlink is unbounded like Long Text: a text mix with a Hyperlink is Long Text, all-Hyperlink stays Hyperlink', () => {
    const q = b('SELECT Nz(h, "") AS a, IIf(y, h, d) AS c, h & "" AS k, IIf(y, h, h) AS p, IIf(y, Nom, h) AS n FROM W, Clients');
    expect(q.columns.map((c) => c.type)).toEqual(['longText', 'longText', 'longText', 'hyperlink', 'longText']);
  });
  it('boundArgType resolves each identifier through the binding, not by its bare name', () => {
    // X.Montant is a Decimal (scale 2), Commandes.Montant a Currency: Decimal at the larger scale, 4
    const q = b('SELECT Sum(X.Montant + Commandes.Montant) AS t FROM (SELECT d AS Montant FROM W) AS X, Commandes');
    const call = ((q.query.body as SelectQuery).items[0] as { e: Extract<Expr, { k: 'call' }> }).e;
    expect(boundArgType(call.args[0], q)).toMatchObject({ type: 'number', props: { numberSize: 'decimal', scale: 4 } });
    expect(q.columns[0].props).toMatchObject({ numberSize: 'decimal', precision: 28, scale: 4 });
    expect(boundArgType({ k: 'star' }, q)).toEqual({ type: null });
    expect(b('SELECT Sum(Total) AS s FROM QTotals').columns[0].type).toBe('currency');
  });
  it('a computed number whose size is unknown is a Double, never a Long Integer that would round it', () => {
    const q = b('SELECT Le - Le AS a, b / 3 AS c, 1.5 AS e, d * 2 AS g, b + [x] AS h FROM Commandes, T, W');
    expect(q.columns.map((c) => c.props.numberSize)).toEqual(['double', 'double', 'double', 'double', 'double']);
    expect(b('SELECT * FROM (SELECT b / 3 AS y FROM T) AS X WHERE y = [P]').params)
      .toEqual([{ name: 'P', type: 'number', props: expect.objectContaining({ numberSize: 'double' }) }]);
    expect(b('PARAMETERS [N] Byte; SELECT [N] AS n, Nz(s, 0) AS a FROM W').columns.map((c) => c.props.numberSize)).toEqual(['byte', 'byte']);
  });
  it('a concatenation with + is text, so a parameter compared with it is text', () => {
    expect(b('SELECT * FROM (SELECT Nom + " " + Ville AS Lib FROM Clients) AS X WHERE Lib = [Qui]').params)
      .toEqual([{ name: 'Qui', type: 'shortText', props: expect.objectContaining({ type: 'shortText' }) }]);
  });
  it('column props: the origin field (caption…), else the defaults of the type', () => {
    const q = b('SELECT s, s + 1 FROM W');
    expect(q.columns[0].props).toMatchObject({ caption: 'Petit', numberSize: 'byte' });
    expect(q.columns[1].props).toEqual({ type: 'number', required: false, indexed: 'no', primaryKey: false, numberSize: 'double',
      decimalPlaces: 'auto', precision: 18, scale: 0 });
  });
  it('exprType of a subexpression', () => {
    const q: BoundQuery = b('SELECT Le FROM Commandes WHERE Le + [n] > Le');
    const where = (q.query.body as SelectQuery).where as Extract<Expr, { k: 'bin' }>;
    expect([exprType(where, q), exprType(where.l, q), exprType((where.l as Extract<Expr, { k: 'bin' }>).r, q)]).toEqual(['yesNo', 'dateTime', 'shortText']);
  });
});

describe('grouping', () => {
  it.each([
    'SELECT Ville, Count(*) FROM Clients GROUP BY Clients.Ville',
    'SELECT Year(Le) AS An, Sum(Montant) FROM Commandes GROUP BY Year(Commandes.Le) HAVING Year(Le) > 2000 ORDER BY Year([Le])',
    'SELECT Ville & "!", [p], 1, Count(*) AS n, n + 1 FROM Clients GROUP BY Ville HAVING Count(*) > 1 ORDER BY n',
    'SELECT Count(*) FROM Clients',
    'SELECT Ville, (SELECT Count(*) FROM Commandes WHERE Commandes.Client > Clients.Ville) FROM Clients GROUP BY Ville',
    'SELECT Nom FROM Clients WHERE Exists (SELECT Client FROM Commandes WHERE Client = Clients.[N°] GROUP BY Client HAVING Count(*) > 1)',
  ])('accepted: %s', (sql) => expect(() => b(sql)).not.toThrow());
  it.each([
    ['SELECT Ville, Count(*) FROM Clients GROUP BY Ville HAVING Nom = "x"', 'notGrouped', '[Nom]'],
    ['SELECT Ville FROM Clients GROUP BY Ville ORDER BY Clients.Nom', 'notGrouped', '[Clients].[Nom]'],
    ['SELECT * FROM T GROUP BY a', 'notGrouped', '[T].[b]'],
    ['SELECT Ville, (SELECT Count(*) FROM Commandes WHERE Client = Clients.[N°]) FROM Clients GROUP BY Ville', 'notGrouped', '[Clients].[N°]'],
    ['SELECT Count(*) AS n FROM Clients WHERE n > 1', 'aggregateInWhere', 'Count(*)'],
    ['SELECT Ville FROM Clients GROUP BY Count(*)', 'aggregateInWhere', 'Count(*)'],
    ['SELECT Nom FROM Clients INNER JOIN Commandes ON Sum(Montant) > 1', 'aggregateInWhere', 'Sum([Montant])'],
    ['SELECT Sum(Montant) AS s, Max(s) FROM Commandes', 'nestedAggregate', 'Max([s])'],
    ['UPDATE Commandes SET Montant = Sum(Montant)', 'aggregateInWhere', 'Sum([Montant])'],
  ])('%s', (sql, code, detail) => expect(bindErr(sql)).toEqual([code, detail]));
  it('aggregate flag', () => {
    expect(b('SELECT Count(*) FROM Clients').aggregate).toBe(true);
    expect(b('SELECT Nom FROM Clients WHERE Exists (SELECT Count(*) FROM Commandes)').aggregate).toBe(false);
  });
});

describe('UNION', () => {
  it('names and types of the first part, no origin; ORDER BY by output name', () => {
    const q = b('SELECT Nom AS Qui, [N°] FROM Clients UNION ALL SELECT a, b FROM T ORDER BY Qui');
    expect(q.columns.map((c) => [c.name, c.type, c.origin])).toEqual([['Qui', 'shortText', undefined], ['N°', 'autoNumber', undefined]]);
    expect(q.params).toEqual([]);
    expect(q.selects.size).toBe(2);
  });
});

describe('action queries', () => {
  it.each([
    ['INSERT INTO Zzz (a) VALUES (1)', 'unknownTarget', 'Zzz'],
    ['INSERT INTO T (a, c) VALUES (1, 2)', 'unknownTarget', 'c'],
    ['INSERT INTO T (a, A) VALUES (1, 2)', 'duplicateOutput', 'A'],
    ['INSERT INTO T (a, b) VALUES (1)', 'insertArity', ''],
    ['INSERT INTO T SELECT Nom FROM Clients', 'unknownTarget', 'Nom'], // no field list: each output column names its field
    ['INSERT INTO T (a, b) SELECT Nom FROM Clients', 'insertArity', ''],
    ['UPDATE Clients SET Zz = 1', 'updateTarget', '[Zz]'],
    ['UPDATE Q1 SET Nom = 1', 'updateTarget', '[Nom]'],
    ['DELETE FROM Clients INNER JOIN Commandes ON Clients.[N°] = Commandes.Client', 'updateTarget', ''],
    ['DELETE X.* FROM Clients', 'unknownTarget', 'X'],
    ['DELETE FROM Q1', 'updateTarget', 'Q1'],
    ['SELECT * INTO [a.b] FROM Clients', 'unknownTarget', 'a.b'],
  ])('%s', (sql, code, detail) => expect(bindErr(sql)).toEqual([code, detail]));
  it('targets and parameters', () => {
    expect(b('INSERT INTO T (b, a) SELECT [N°], Nom FROM Clients WHERE Ville = [V]')).toMatchObject({ keyTable: 'T', columns: [], updatable: false,
      params: [{ name: 'V', type: 'shortText' }] });
    expect(b('INSERT INTO T VALUES ([x], 2)').params.map((p) => p.name)).toEqual(['x']);
    expect(b('INSERT INTO T SELECT Nom AS b FROM Clients')).toMatchObject({ keyTable: 'T' }); // by name: fewer columns than fields
    expect(b('UPDATE Clients AS C INNER JOIN Commandes ON C.[N°] = Commandes.Client SET C.Nom = "x", Ville = [V] WHERE Montant > [M]'))
      .toMatchObject({ keyTable: 'Clients', keyAlias: 'C', params: [{ name: 'V', type: null }, { name: 'M', type: 'currency' }] });
    expect(b('DELETE Commandes.* FROM Clients INNER JOIN Commandes ON Clients.[N°] = Commandes.Client WHERE Ville = "Paris"'))
      .toMatchObject({ keyTable: 'Commandes', keyAlias: 'Commandes' });
    expect(b('SELECT * INTO Copie FROM Clients')).toMatchObject({ updatable: false });
  });
});

describe('parseQueryDefinition', () => {
  it('accepts a newer minor and a valid layout; keeps unknown keys', () => {
    const def = { formatVersion: '1.3', sql: 'SELECT * FROM T', layout: { tables: { T: { x: 10, y: 20 } }, widths: [100, 80], zoom: 2 }, x: [1] };
    expect(parseQueryDefinition(def)).toBe(def);
  });
  it.each([
    [[]], ['SELECT 1'], [{ sql: 'SELECT * FROM T' }], [{ formatVersion: '1', sql: 'SELECT * FROM T' }], [{ formatVersion: '1.0' }],
    [{ formatVersion: '1.0', sql: 'SELECT * FROM T', layout: null }], [{ formatVersion: '1.0', sql: 'SELECT * FROM T', layout: {} }],
    [{ formatVersion: '1.0', sql: 'SELECT * FROM T', layout: { tables: { T: { x: '1', y: 2 } } } }],
    [{ formatVersion: '1.0', sql: 'SELECT * FROM T', layout: { tables: {}, widths: [Number.NaN] } }],
    [{ formatVersion: '1.0', sql: 'SELECT * FROM T', layout: { tables: [] } }],
  ])('refuses %j', (def) => expect(() => parseQueryDefinition(def)).toThrow(new TypeError('bc:invalidQuery')));
});

it('a crosstab binds as its rewritten SELECT (B4 R9)', () => {
  const data = b('TRANSFORM Count(*) SELECT Ville FROM Clients WHERE Nom <> [N] GROUP BY Ville PIVOT Ville');
  expect(toSourceInfo(data)).toMatchObject({ fields: [{ name: 'Ville' }], updatable: false, crosstab: { headings: 'data' }, parameters: [{ name: 'N', type: 'shortText' }] });
  const fixedSql = parseSql('TRANSFORM Sum(Montant) SELECT Client FROM Commandes GROUP BY Client PIVOT Month(Le) IN (10, -1.5)');
  const fixed = bindQuery(fixedSql, cat, undefined, inHeadings(fixedSql.body as CrosstabQuery, localeInfo('fr-FR')));
  expect(fixed.columns.map((c) => [c.name, c.type])).toEqual([['Client', 'number'], ['10', 'currency'], ['-1,5', 'currency']]);
  // bound without a region: heading columns keep internal names until expandCrosstab names them
  expect(b('TRANSFORM Sum(Montant) SELECT Client AS [10] FROM Commandes GROUP BY Client PIVOT Month(Le) IN (10)').columns.map((c) => c.name)).toEqual(['10', '0']);
  expect(fixed.crosstab?.headings).toBe('fixed');
  // the value's and the pivot's parameters count even when the headings come from the data
  expect(b('TRANSFORM Sum(Montant * [k]) SELECT Client FROM Commandes GROUP BY Client PIVOT Month(Le) + [d]').params.map((p) => p.name).sort()).toEqual(['d', 'k']);
  const dup = parseSql('TRANSFORM Count(*) SELECT Ville FROM Clients GROUP BY Ville PIVOT Ville IN (1, 1)');
  expect(() => bindQuery(dup, cat, undefined, inHeadings(dup.body as CrosstabQuery, localeInfo('fr-FR')))).toThrow('bc:queryBind|duplicateOutput|1');
  expect(() => b(`TRANSFORM Count(*) SELECT Ville FROM Clients GROUP BY Ville PIVOT Ville IN (${Array.from({ length: 255 }, (_, i) => i).join(', ')})`))
    .toThrow('bc:queryBind|tooManyColumns|256');
  expect(() => b(`TRANSFORM Count(*) SELECT Ville, Nom FROM Clients GROUP BY Ville, Nom PIVOT Ville IN (${Array.from({ length: 254 }, (_, i) => i).join(', ')})`))
    .toThrow('bc:queryBind|tooManyColumns|256');
});
it('queryDependents finds queries, forms and reports using a query', () => expect(queryDependents('QClientsLyon', [
  { kind: 'query', name: 'QNoms', definition: { formatVersion: '1.0', sql: 'SELECT Nom FROM [qclientslyon];' } },
  { kind: 'query', name: 'QSub', definition: { formatVersion: '1.0', sql: 'SELECT * FROM Clients WHERE [N°] In (SELECT [N°] FROM QClientsLyon);' } },
  { kind: 'form', name: 'F', definition: { formatVersion: '1.0', recordSource: { kind: 'query', name: 'QClientsLyon' }, props: {}, sections: [] } },
  { kind: 'query', name: 'QBroken', definition: { formatVersion: '1.0', sql: 'SELEC' } },
])).toEqual([{ kind: 'query', name: 'QNoms' }, { kind: 'query', name: 'QSub' }, { kind: 'form', name: 'F' }]));

it('queryDependents: joins, derived tables, a sql record source; never the query itself nor a mere field name', () => expect(queryDependents('Q', [
  { kind: 'query', name: 'Q', definition: { formatVersion: '1.0', sql: 'SELECT * FROM Clients' } },
  { kind: 'query', name: 'QJoin', definition: { formatVersion: '1.0', sql: 'SELECT * FROM Clients INNER JOIN Q ON Clients.[N°] = Q.[N°]' } },
  { kind: 'query', name: 'QDer', definition: { formatVersion: '1.0', sql: 'SELECT * FROM (SELECT * FROM Q) AS D' } },
  { kind: 'query', name: 'QField', definition: { formatVersion: '1.0', sql: 'SELECT Q FROM Clients' } },
  { kind: 'report', name: 'R', definition: { formatVersion: '1.0', recordSource: { kind: 'sql', sql: 'SELECT * FROM q' } } },
  { kind: 'report', name: 'R2', definition: { formatVersion: '1.0', recordSource: { kind: 'table', name: 'Q' } } },
  { kind: 'form', name: 'F', definition: null },
])).toEqual([{ kind: 'query', name: 'QJoin' }, { kind: 'query', name: 'QDer' }, { kind: 'report', name: 'R' }]));

it('queryDependents: tables whose lookup Row Source names the query (by name or in SQL); never a lookup a type ignores', () => {
  const fd = (name: string, type: 'shortText' | 'dateTime', lookup: object) => ({ name, props: { ...defaultProps(type), lookup } as FieldProps });
  const look = (table: string) => ({ kind: 'table', table, limitToList: true });
  expect(queryDependents('Q', [], [
    { name: 'Commandes', fields: [fd('Client', 'shortText', look(' q '))] },
    { name: 'Ventes', fields: [fd('A', 'shortText', look('Clients')), fd('B', 'shortText', look('SELECT Nom FROM Q ORDER BY Nom'))] },
    { name: 'Liste', fields: [fd('C', 'shortText', { kind: 'fieldList', table: 'Q', limitToList: false })] },
    { name: 'Ignorée', fields: [fd('D', 'dateTime', look('Q'))] }, // Date/Time takes no lookup
    { name: 'Autre', fields: [fd('E', 'shortText', look('SELECT Q FROM Clients')), fd('F', 'shortText', { kind: 'values', values: ['Q'], limitToList: true })] },
  ])).toEqual([{ kind: 'table', name: 'Commandes' }, { kind: 'table', name: 'Ventes' }, { kind: 'table', name: 'Liste' }]);
});
it('a form reference in a criterion is a typed parameter', () => {
  const q = b('SELECT * FROM Commandes WHERE Client = [Forms]![FClients]![N°];');
  expect(q.params).toEqual([{ name: '[Forms]![FClients]![N°]', type: 'number', props: expect.objectContaining({ numberSize: 'longInteger' }) }]);
  expect(b('SELECT * FROM Clients WHERE Nom = [Formulaires]![fclients]![Nom] Or Ville = [VarTemp]![v] Or Nom = [États]![E]![C];').params.map((p) => p.name))
    .toEqual(['[Forms]![fclients]![Nom]', '[TempVars]![v]', '[Reports]![E]![C]']);
  expect(printSql(parseSql('SELECT * FROM Clients WHERE Nom = [Formulaires]![F]![C];'))).toContain('WHERE [Nom] = [Forms]![F]![C]');
});
it('LocalVars in a query is refused', () => {
  expect(() => b('SELECT * FROM Clients WHERE Nom = [LocalVars]![x];')).toThrow(expect.objectContaining({ code: 'memberNotAllowed' }));
  expect(() => b('SELECT [MacroError]![Number] FROM Clients;')).toThrow(expect.objectContaining({ code: 'memberNotAllowed', detail: '[MacroError]![Number]' }));
});
