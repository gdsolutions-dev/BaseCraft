import { describe, expect, it } from 'vitest';
import { f, t as table } from '../test-fixtures';
import type { JoinKind, ParamDecl } from './ast';
import { bindQuery, type QueryCatalog } from './bind';
import { printSql } from './print';
import { fromQbe, normalizeQbe, plainField, toQbe, type QbeColumn, type QbeDesign, type QbeKind, type QbeTotal } from './qbe';
import { parseSql } from './sql-parser';

const SQL1 = 'SELECT [Clients].[Nom], [Commandes].[Montant]\nFROM [Clients] INNER JOIN [Commandes] ON [Clients].[N°] = [Commandes].[Client]\nWHERE [Commandes].[Le] >= [Date début :]\nORDER BY [Commandes].[Montant] DESC;';

const col = (field: string, table?: string, o: Partial<QbeColumn> = {}): QbeColumn =>
  ({ field, ...(table !== undefined && { table }), show: true, criteria: [], ...o });
/** Tables named by the columns (Commandes when none); Clients and Commandes are joined N° -> Client. */
function design(kind: QbeKind, columns: QbeColumn[], o: Partial<QbeDesign> = {}): QbeDesign {
  const names = [...new Set(columns.flatMap((c) => (c.table === undefined ? [] : [c.table])))];
  const tables = (names.length ? names : ['Commandes']).map((name) => ({ name }));
  const joins = names.includes('Clients') && names.includes('Commandes')
    ? [{ l: 'Clients', lField: 'N°', r: 'Commandes', rField: 'Client', kind: 'inner' as const }] : [];
  return { kind, tables, joins, totals: false, distinct: false, params: [], columns, ...o };
}
const sel = (c: QbeColumn[], _o: { join?: boolean } = {}): QbeDesign => design('select', c);
const totals = (c: QbeColumn[]): QbeDesign => design('select', c, { totals: true });
const upd = (c: QbeColumn[]): QbeDesign => design('update', c);
const del = (c: QbeColumn[]): QbeDesign => design('delete', c);
const app = (target: string, c: QbeColumn[]): QbeDesign => design('append', c, { target });
const mk = (target: string, c: QbeColumn[]): QbeDesign => design('makeTable', c, { target });

const GRIDS: QbeDesign[] = [
  /* 1 */ sel([col('[Nom]', 'Clients'), col('[Montant]', 'Commandes', { sort: 'desc' }), col('[Le]', 'Commandes', { show: false, criteria: ['>= [Date début :]'] })], { join: true }),
  /* 2 */ totals([col('[Ville]', 'Clients', { total: 'groupBy' }), col('[Montant]', 'Commandes', { total: 'sum', criteria: ['> 5'] }), col('[Le]', 'Commandes', { total: 'where', show: false, criteria: ['>= #2026-10-01#'] })]),
  /* 3 */ sel([col('[Ville]', 'Clients', { criteria: ['"Lyon"', '"Paris"'] }), col('[Nom]', 'Clients', { criteria: ['Like "D*"', ''] })]),
  /* 4 */ sel([col('Double: [Montant] * 2'), col('*', 'Commandes')]),
  /* 5 */ upd([col('[Montant]', 'Commandes', { updateTo: '[Montant] * 1.1', criteria: ['< 1'] })]),
  /* 6 */ del([col('*', 'Commandes', { deleteRole: 'from' }), col('[Montant]', 'Commandes', { deleteRole: 'where', criteria: ['< 1'] })]),
  /* 7 */ app('Archive', [col('[N°]', 'Commandes', { appendTo: 'N' })]),
  /* 8 */ mk('Copie', [col('*', 'Commandes')]),
  /* 9 */ totals([col('[Client]', 'Commandes', { total: 'groupBy' }), col('[Montant]', 'Commandes', { total: 'stDev' })]),
];

it.each(GRIDS.map((g, i) => [i + 1, g] as const))('grid %i -> SQL -> grid', (_, g) =>
  expect(toQbe(parseSql(printSql(fromQbe(g))))).toEqual(normalizeQbe(g)));
it('grid 3 SQL', () => expect(printSql(fromQbe(GRIDS[2]))).toContain('WHERE [Clients].[Ville] = "Lyon" And [Clients].[Nom] Like "D*" Or [Clients].[Ville] = "Paris"'));
it('grid 1 SQL', () => expect(printSql(fromQbe(GRIDS[0]))).toBe(SQL1));
it('grids 2, 5, 6, 7 SQL', () => {
  expect(printSql(fromQbe(GRIDS[1]))).toBe('SELECT [Clients].[Ville], Sum([Commandes].[Montant])\nFROM [Clients] INNER JOIN [Commandes] ON [Clients].[N°] = [Commandes].[Client]\nWHERE [Commandes].[Le] >= #2026-10-01#\nGROUP BY [Clients].[Ville]\nHAVING Sum([Commandes].[Montant]) > 5;');
  expect(printSql(fromQbe(GRIDS[4]))).toBe('UPDATE [Commandes]\nSET [Commandes].[Montant] = [Montant] * 1.1\nWHERE [Commandes].[Montant] < 1;');
  expect(printSql(fromQbe(GRIDS[5]))).toBe('DELETE [Commandes].*\nFROM [Commandes]\nWHERE [Commandes].[Montant] < 1;');
  expect(printSql(fromQbe(GRIDS[6]))).toBe('INSERT INTO [Archive] ([N])\nSELECT [Commandes].[N°]\nFROM [Commandes];');
});
it('StDevP becomes an Expression column', () =>
  expect(toQbe(parseSql('SELECT StDevP(Montant) FROM Commandes'))!.columns[0]).toMatchObject({ field: 'StDevP([Montant])', total: 'expression' }));
it.each([
  'SELECT a FROM T UNION SELECT a FROM U', 'SELECT * FROM T INNER JOIN U ON T.a > U.b', 'SELECT * FROM (SELECT * FROM T) AS X',
  'SELECT * FROM T WHERE [a] > 1 And [b] < 2 Or [a] + [b] = IIf([c], 1, 2) And [d] = 1 Or [e]',
  'SELECT * FROM T INNER JOIN U ON a = U.b', 'SELECT * FROM T WHERE [a] = 1 Or [b] = 2 And ([c] = 1 Or [d] = 2)',
  'INSERT INTO A VALUES (1)', 'INSERT INTO A SELECT x FROM T',
])('SQL only: %s', (sql) => expect(toQbe(parseSql(sql))).toBeNull());
it('hand-written SQL becomes a grid', () => expect(toQbe(parseSql('SELECT Nom FROM Clients WHERE Ville = "Lyon" ORDER BY Nom'))).toMatchObject({ columns: [
  { field: '[Nom]', table: 'Clients', show: true, sort: 'asc' }, { field: '[Ville]', table: 'Clients', show: false, criteria: ['"Lyon"'] }] }));

describe('toQbe on hand-written SQL', () => {
  const grid = (sql: string): QbeDesign => toQbe(parseSql(sql))!;
  /** The grid gives the same tree back. */
  const same = (sql: string): void => { const q = parseSql(sql); expect(fromQbe(toQbe(q)!)).toEqual(q); };

  it('the leading conjuncts on one subject share a cell; a cell keeps its own Or', () => {
    expect(grid('SELECT * FROM T WHERE T.a >= 1 And T.a <= 5 And T.b = 2').columns.map((c) => c.criteria))
      .toEqual([[''], ['>= 1 And <= 5'], ['2']]);
    expect(grid('SELECT * FROM T WHERE T.b = 2 And (T.a = 1 Or T.a = 3)').columns.map((c) => c.criteria)).toEqual([[''], ['2'], ['1 Or 3']]);
    same('SELECT * FROM [T] WHERE [T].[a] >= 1 And [T].[a] <= 5 And [T].[b] = 2');
    same('SELECT * FROM [T] WHERE [T].[b] = 2 And ([T].[a] = 1 Or [T].[a] = 3) Or [T].[a] Is Null');
  });

  it('conjuncts out of column order get hidden columns, and the tree comes back unchanged', () => {
    const q = 'SELECT [T].[a], [T].[b] FROM [T] WHERE [T].[b] = 1 And [T].[a] = 2 ORDER BY [T].[b], [T].[a] DESC';
    expect(grid(q).columns).toEqual([
      { field: '[a]', table: 'T', show: true, criteria: [''] },
      { field: '[b]', table: 'T', show: true, criteria: ['1'], sort: 'asc' },
      { field: '[a]', table: 'T', show: false, criteria: ['2'], sort: 'desc' },
    ]);
    same(q);
  });

  it('GROUP BY out of SELECT order, HAVING on a missing aggregate, ORDER BY an aggregate', () => {
    const q = 'SELECT [T].[a], [T].[b], Count(*) FROM [T] GROUP BY [T].[b], [T].[a] HAVING Max([T].[c]) > 1 ORDER BY Sum([T].[d]) DESC';
    expect(grid(q).columns).toEqual([
      { field: '[a]', table: 'T', total: 'expression', show: true, criteria: [''] },
      { field: '[b]', table: 'T', total: 'groupBy', show: true, criteria: [''] },
      { field: '*', total: 'count', show: true, criteria: [''] },
      { field: '[a]', table: 'T', total: 'groupBy', show: false, criteria: [''] },
      { field: '[c]', table: 'T', total: 'max', show: false, criteria: ['> 1'] },
      { field: '[d]', table: 'T', total: 'sum', show: false, criteria: [''], sort: 'desc' },
    ]);
    same(q);
  });

  it('an unqualified field takes the only source; with several it stays an expression', () => {
    expect(grid('SELECT Sum(Montant) AS Total FROM Commandes HAVING Sum(Montant) > 5').columns)
      .toEqual([{ field: 'Total: [Montant]', table: 'Commandes', total: 'sum', show: true, criteria: ['> 5'] }]);
    expect(grid('SELECT Nom FROM Clients, Commandes').columns).toEqual([{ field: '[Nom]', show: true, criteria: [] }]);
    same('SELECT [Nom] FROM [Clients], [Commandes] WHERE [Nom] Like "D*"');
  });

  it('with the catalog, a bare name that is not a field of the only source (a parameter) stays bare', () => {
    const isField = (t: string, f: string) => t === 'Clients' && ['N°', 'Nom', 'Ville'].includes(f);
    const g = toQbe(parseSql('SELECT Nom, [Combien ?] FROM Clients'), isField)!;
    expect(g.columns.map((c) => [c.field, c.table])).toEqual([['[Nom]', 'Clients'], ['[Combien ?]', undefined]]);
    expect(printSql(fromQbe(g, isField))).toBe('SELECT [Clients].[Nom], [Combien ?]\nFROM [Clients];');
    expect(normalizeQbe({ ...g, columns: [col('[Combien ?]')] }, isField).columns[0].table).toBeUndefined();
    expect(normalizeQbe({ ...g, columns: [col('[Combien ?]')] }).columns[0].table).toBe('Clients'); // no catalog: as before
  });

  it('joins: the field pairs, the side of an outer join, a nested join, a comma', () => {
    const g = grid('SELECT * FROM (Commandes AS C RIGHT JOIN Clients ON Clients.[N°] = C.Client And C.x = Clients.y), Lignes');
    expect(g.tables).toEqual([{ name: 'Commandes', alias: 'C' }, { name: 'Clients' }, { name: 'Lignes' }]);
    expect(g.joins).toEqual([{ l: 'Clients', lField: 'N°', r: 'C', rField: 'Client', kind: 'left' },
      { l: 'C', lField: 'x', r: 'Clients', rField: 'y', kind: 'right' }]);
    same('SELECT * FROM [Commandes] AS [C] RIGHT JOIN [Clients] ON [Clients].[N°] = [C].[Client] And [C].[x] = [Clients].[y], [Lignes]');
    expect(printSql(fromQbe(grid('SELECT * FROM A INNER JOIN (B LEFT JOIN C ON B.x = C.y) ON A.x = B.x'))))
      .toBe('SELECT *\nFROM [A] INNER JOIN [B] ON [A].[x] = [B].[x] LEFT JOIN [C] ON [B].[x] = [C].[y];');
  });

  it('a subquery prints on one line in a cell and reads back', () => {
    const q = 'SELECT [T].[a] FROM [T] WHERE [T].[a] In (SELECT [b] FROM [U] WHERE [c] = "x\ny")';
    expect(grid(q).columns[0].criteria).toEqual(['In (SELECT [b] FROM [U] WHERE [c] = "x\ny")']);
    same(q);
    expect(grid('SELECT (SELECT Max(b) FROM U) AS M FROM T').columns[0].field).toBe('M: (SELECT Max([b]) FROM [U])');
    same('SELECT (SELECT Max([b]) FROM [U]) AS [M] FROM [T]');
  });

  it('PARAMETERS, DISTINCT, TOP, DELETE *, aliases needing brackets', () => {
    const g = grid('PARAMETERS [N] Long; SELECT DISTINCT TOP 5 PERCENT a AS [x: y] FROM T WHERE a > [N]');
    expect(g).toMatchObject({ distinct: true, top: { n: 5, percent: true }, params: [{ name: 'N', type: 'number', numberSize: 'longInteger' }] });
    expect(g.columns[0].field).toBe('[x: y]: [a]');
    same('PARAMETERS [N] Long; SELECT DISTINCT TOP 5 PERCENT [T].[a] AS [x: y] FROM [T] WHERE [T].[a] > [N]');
    same('DELETE * FROM [T] WHERE [T].[a] = 1');
    same('INSERT INTO [A] SELECT [T].* FROM [T]');
  });
});

describe('output aliases and Count(*)', () => {
  const CAT: QueryCatalog = {
    table: (n) => [
      table('Clients', [f('N°', 'autoNumber'), f('Nom', 'shortText'), f('Ville', 'shortText')]),
      table('Commandes', [f('N°', 'autoNumber'), f('Client', 'number', { numberSize: 'longInteger' }), f('Montant', 'currency')]),
    ].find((x) => x.name.toLowerCase() === n.toLowerCase()) ?? null,
    query: () => null,
  };
  /** SQL -> grid -> SQL, which still binds with no parameter. */
  const viaGrid = (sql: string): string => {
    const back = parseSql(printSql(fromQbe(toQbe(parseSql(sql))!)));
    expect(bindQuery(back, CAT).params).toEqual([]);
    return printSql(back);
  };

  it('an ORDER BY or a HAVING naming an output alias keeps the alias, never qualified', () => {
    expect(toQbe(parseSql('SELECT Montant * 2 AS Dbl FROM Commandes ORDER BY Dbl'))!.columns).toEqual([
      { field: 'Dbl: [Montant] * 2', show: true, criteria: [] }, { field: '[Dbl]', show: false, sort: 'asc', criteria: [] }]);
    expect(viaGrid('SELECT Montant * 2 AS Dbl FROM Commandes ORDER BY Dbl')).toBe('SELECT [Montant] * 2 AS [Dbl]\nFROM [Commandes]\nORDER BY [Dbl];');
    expect(viaGrid('SELECT Ville, Count(*) AS N FROM Clients GROUP BY Ville HAVING N > 2 ORDER BY N'))
      .toBe('SELECT [Clients].[Ville], Count(*) AS [N]\nFROM [Clients]\nGROUP BY [Clients].[Ville]\nHAVING [N] > 2\nORDER BY [N];');
    expect(viaGrid('SELECT Nom AS Nom FROM Clients WHERE Nom = "x"')).toBe('SELECT [Clients].[Nom] AS [Nom]\nFROM [Clients]\nWHERE [Nom] = "x";');
  });

  it('Count(*) is a * column with Total Count, alias and criteria kept', () => {
    const g = toQbe(parseSql('SELECT Count(*) AS N FROM Clients HAVING Count(*) > 2 ORDER BY Count(*) DESC'))!;
    expect(g.columns).toEqual([{ field: 'N: *', total: 'count', show: true, sort: 'desc', criteria: ['> 2'] }]);
    expect(printSql(fromQbe(g))).toBe('SELECT Count(*) AS [N]\nFROM [Clients]\nHAVING Count(*) > 2\nORDER BY Count(*) DESC;');
    expect(normalizeQbe(totals([col('*', 'Commandes', { total: 'count' })])).columns).toEqual([{ field: '*', total: 'count', show: true, criteria: [] }]);
  });

  it('an expression column has no table', () =>
    expect(normalizeQbe(sel([col('[Montant] * 2', 'Commandes'), col('Bad (', 'Commandes')])).columns.map((c) => c.table)).toEqual([undefined, 'Commandes']));
});

describe('normalizeQbe', () => {
  it('drops columns without a field, pads the criteria rows, drops what the kind ignores', () => {
    const g = normalizeQbe(design('update', [
      col(' ', 'Commandes'), col('[Montant]', undefined, { criteria: ['', ' > 1 ', ''], sort: 'asc', total: 'sum', updateTo: '0', appendTo: 'x', show: false }),
      col('[Le]', 'Commandes'),
    ], { totals: true, distinct: true, top: { n: 1, percent: false }, target: 'Z' }));
    expect(g).toEqual({ kind: 'update', tables: [{ name: 'Commandes' }], joins: [], totals: false, distinct: false, params: [], columns: [
      { field: '[Montant]', table: 'Commandes', show: true, criteria: ['', '> 1'], updateTo: '0' },
      { field: '[Le]', table: 'Commandes', show: true, criteria: ['', ''] }] });
  });

  it('a Where column is hidden and unsorted; * has no criteria; joins follow the FROM order', () => {
    const g = normalizeQbe({ ...design('select', [col('[Le]', 'C', { total: 'where', sort: 'asc' }), col('*', 'C', { criteria: ['1'] })], { totals: true }),
      tables: [{ name: 'A' }, { name: 'B' }, { name: 'C' }],
      joins: [{ l: 'B', lField: 'x', r: 'C', rField: 'y', kind: 'left' }, { l: 'A', lField: 'x', r: 'C', rField: 'y', kind: 'inner' },
        { l: 'C', lField: 'z', r: 'A', rField: 'w', kind: 'left' }, { l: 'Z', lField: 'x', r: 'A', rField: 'y', kind: 'inner' }] });
    expect(g.columns).toEqual([{ field: '[Le]', table: 'C', total: 'where', show: false, criteria: [] }, { field: '*', table: 'C', total: 'groupBy', show: true, criteria: [] }]);
    expect(g.tables.map((t) => t.name)).toEqual(['A', 'C', 'B']);
    expect(g.joins).toEqual([{ l: 'A', lField: 'x', r: 'C', rField: 'y', kind: 'inner' }, { l: 'C', lField: 'z', r: 'A', rField: 'w', kind: 'inner' },
      { l: 'B', lField: 'x', r: 'C', rField: 'y', kind: 'left' }]); // one JOIN, one kind: the first pair's
  });

  it('fromQbe refuses what no statement can say', () => {
    expect(() => fromQbe(design('update', [col('[a]', 'A', { updateTo: '1' }), col('[b]', 'B')]))).toThrow('bc:invalidQuery|unlinkedTables|');
    expect(() => fromQbe(design('update', [col('[a] + 1', 'A', { updateTo: '1' })]))).toThrow('bc:invalidQuery|updateTarget|[a] + 1');
    expect(() => fromQbe(design('makeTable', [col('*', 'A')]))).toThrow('bc:invalidQuery|noTarget|');
  });
});

describe('property: a tree the grid makes comes back from its grid unchanged', () => {
  let seed = 20261022;
  const rnd = (n: number): number => { seed = (seed * 1103515245 + 12345) % 2147483648; return Math.floor(seed / 65536) % n; };
  const pick = <X>(a: readonly X[]): X => a[rnd(a.length)];
  const FIELDS: Record<string, string[]> = { Clients: ['N°', 'Nom', 'Ville'], Commandes: ['N°', 'Client', 'Montant', 'Le'], Lignes: ['Commande', 'Prix', 'Qté'] };
  const KINDS: QbeKind[] = ['select', 'select', 'makeTable', 'append', 'update', 'delete'];
  const TOTALS: QbeTotal[] = ['groupBy', 'sum', 'avg', 'min', 'max', 'count', 'stDev', 'var', 'first', 'last', 'expression', 'where'];
  const JOINS: JoinKind[] = ['inner', 'left', 'right'];
  const EXPRS = ['[Montant] * 2', 'Total: [Prix] * [Qté]', 'Left([Nom], 1)', 'X: [N°] + 1', '[Ville] & "-"', 'N: *', '[Total]', '[X]', '[Lib 2]'];
  const CELLS = ['', '', '> 5', '"Lyon"', 'Like "D*"', 'Between 1 And 5', 'Is Null', 'Not "x"', '>= [Date début :]', 'In (1, 2)',
    '> 1 And < 9', '1 Or 2', 'Is Not Null', '<> [Prix] * 2', 'In (SELECT [Client] FROM [Commandes] WHERE [Montant] > 1)'];
  const PARAMS: ParamDecl[][] = [[], [], [{ name: 'Date début :', type: 'dateTime' }]];

  function randomGrid(): QbeDesign {
    const kind = pick(KINDS);
    const action = kind === 'update' || kind === 'delete';
    const names = Object.keys(FIELDS).filter(() => rnd(2)).sort(() => rnd(3) - 1);
    if (!names.length) names.push('Commandes');
    const tables = names.map((name, i) => (rnd(3) ? { name } : { name, alias: `${name[0]}${i}` }));
    const a = (t: { name: string; alias?: string }): string => t.alias ?? t.name;
    const joins: QbeDesign['joins'] = [];
    tables.slice(1).forEach((t, i) => {
      if (!action && !rnd(3)) return;
      const o = tables[rnd(i + 1)];
      for (let k = 1 + rnd(2); k > 0; k--) {
        const [x, y] = rnd(2) ? [o, t] : [t, o];
        joins.push({ l: a(x), lField: pick(FIELDS[x.name]), r: a(y), rField: pick(FIELDS[y.name]), kind: pick(JOINS) });
      }
    });
    const columns: QbeColumn[] = [];
    for (let i = 1 + rnd(5); i > 0; i--) {
      const t = pick(tables);
      const r = rnd(10);
      const c = r < 5 || (action && r < 8) ? col(`[${pick(FIELDS[t.name])}]`, a(t))
        : r < 6 ? col(`Lib ${i}: [${pick(FIELDS[t.name])}]`, a(t))
        : r < 7 || (kind === 'delete' && !columns.length) ? col('*', a(t)) : col(pick(EXPRS));
      c.show = rnd(3) > 0;
      if (rnd(3)) c.total = pick(TOTALS);
      if (rnd(3) === 0) c.sort = rnd(2) ? 'asc' : 'desc';
      c.criteria = Array.from({ length: rnd(3) }, () => pick(CELLS));
      if (kind === 'append' && !c.field.endsWith('*') && rnd(3)) c.appendTo = `C${i}`;
      if (kind === 'update' && /^\[[^\]]+\]$/.test(c.field) && rnd(2)) c.updateTo = pick(['[Montant] * 1.1', '0', 'Null', '"x"']);
      if (kind === 'delete') c.deleteRole = c.field === '*' ? 'from' : 'where';
      columns.push(c);
    }
    if (!action && rnd(3) === 0) { // an output alias referenced by a hidden column (sort, criteria): never qualified
      columns.splice(rnd(columns.length + 1), 0, col('Dbl: [Montant] * 2', undefined, { ...(rnd(2) && { total: 'sum' as const }) }));
      columns.push(col('[Dbl]', undefined, { show: false, sort: 'desc', criteria: [pick(CELLS)] }));
    }
    if (!action && rnd(4) === 0) columns.push(col(pick(['N: *', '*']), undefined, { total: 'count', sort: 'asc', criteria: ['', pick(CELLS)] }));
    return {
      kind, ...((kind === 'makeTable' || kind === 'append') && { target: 'Cible' }), tables, joins, totals: rnd(2) === 0, distinct: rnd(4) === 0,
      ...(rnd(4) === 0 && { top: { n: 1 + rnd(9), percent: rnd(2) === 0 } }), params: pick(PARAMS), columns,
    };
  }

  it('600 random grids', () => {
    let tested = 0;
    for (let i = 0; i < 600; i++) {
      const g = randomGrid();
      const t = fromQbe(g);
      const b = t.body;
      const empty = b.k === 'select' ? !b.items.length : b.k === 'insert' ? !('values' in b.source) && !b.source.items.length : b.k === 'update' && !b.set.length;
      if (empty) continue; // the grid has no destination field: no statement to save
      const sql = printSql(t);
      const back = toQbe(parseSql(sql));
      expect(back, sql).not.toBeNull();
      expect(printSql(fromQbe(back!)), JSON.stringify(g)).toBe(sql);
      expect(fromQbe(back!)).toEqual(t);
      expect(normalizeQbe(back!)).toEqual(back);
      tested++;
    }
    expect(tested).toBeGreaterThan(400);
  });
});

describe('plainField (a Field cell shows Nom, as Access does)', () => {
  const reads = (s: string) => !['Date', 'Vrai'].includes(s.replace(/^.*\./, '')); // what the cell's own parser accepts as the same field
  it('brackets only where the name needs them, or where the bare word would read as something else', () => {
    expect(plainField('[Nom]', reads, 'fr')).toBe('Nom');
    expect(plainField('[Clients].[Nom]', reads, 'fr')).toBe('Clients.Nom');
    expect(plainField('[Lignes de commande].[Prix]', reads, 'fr')).toBe('[Lignes de commande].Prix');
    expect(plainField('[Combien ?]', reads, 'fr')).toBe('[Combien ?]');
    expect(plainField('[N°]', reads, 'fr')).toBe('[N°]');
    expect(plainField('[Date]', reads, 'fr')).toBe('[Date]');
    expect(plainField('[Montant] * 2', reads, 'fr')).toBe('[Montant] * 2');
    expect(plainField('*', reads, 'fr')).toBe('*');
  });
  it('a field named like a function of the interface language keeps its brackets (Access shows [Date], [Somme])', () => {
    const any = () => true;
    expect(plainField('[Somme]', any, 'fr')).toBe('[Somme]');
    expect(plainField('[Commandes].[maintenant]', any, 'fr')).toBe('Commandes.[maintenant]');
    expect(plainField('[Now]', any, 'en')).toBe('[Now]');
    expect(plainField('[Sum]', any, 'fr')).toBe('Sum'); // a function only in English
    expect(plainField('[Somme]', any, 'en')).toBe('Somme');
  });
});

describe('crosstab (B4 R13)', () => {
  const X = 'TRANSFORM Sum([Commandes].[Montant])\nSELECT [Clients].[Nom], Sum([Commandes].[Montant]) AS [Total]\n'
    + 'FROM [Clients] INNER JOIN [Commandes] ON [Clients].[N°] = [Commandes].[Client]\nWHERE [Commandes].[Le] >= [Du]\nGROUP BY [Clients].[Nom]\n'
    + 'PIVOT Month([Commandes].[Le]) AS [Mois] IN (10, 9, 11);';
  const isField = (t: string, f: string): boolean => (t === 'Clients' ? ['N°', 'Nom', 'Ville'] : ['N°', 'Client', 'Montant', 'Le']).includes(f);
  const ct = (columns: QbeColumn[], o: Partial<QbeDesign> = {}): QbeDesign => design('crosstab', columns, { totals: true, ...o });

  it('crosstab round trip', () => {
    const q = parseSql(X);
    const d = toQbe(q, isField)!;   // columns in this order: row items, Column Heading, Value, Where columns
    expect(d).toMatchObject({ kind: 'crosstab', totals: true, headings: ['10', '9', '11'] });
    expect(d.columns.map((c) => [c.field, c.total, c.crosstab])).toEqual([['[Nom]', 'groupBy', 'rowHeading'], ['Total: [Montant]', 'sum', 'rowHeading'],
      ['Mois: Month([Commandes].[Le])', 'groupBy', 'columnHeading'], ['[Montant]', 'sum', 'value'], ['[Le]', 'where', 'none']]);
    expect(printSql(fromQbe(d, isField))).toBe(printSql(q));
  });
  it('round trips: a value alias, Count(*), an expression value, signed headings, no headings, parameters', () => {
    for (const sql of [
      'PARAMETERS [Du] DateTime;\nTRANSFORM Sum([Commandes].[Montant]) AS [S]\nSELECT [Commandes].[Client]\nFROM [Commandes]\nWHERE [Commandes].[Le] >= [Du]\nGROUP BY [Commandes].[Client]\nORDER BY [Commandes].[Client] DESC\nPIVOT [Commandes].[Le];',
      'TRANSFORM Count(*)\nSELECT [Commandes].[Client]\nFROM [Commandes]\nGROUP BY [Commandes].[Client]\nPIVOT [Commandes].[Montant] IN (-1, 0, 1.5);',
      'TRANSFORM Nz(Sum([Commandes].[Montant]), 0) AS [V]\nSELECT [Commandes].[Client]\nFROM [Commandes]\nGROUP BY [Commandes].[Client]\nPIVOT Year([Commandes].[Le]);',
    ]) expect(printSql(fromQbe(toQbe(parseSql(sql))!))).toBe(sql);
    expect(toQbe(parseSql('TRANSFORM Count(*) SELECT Client FROM Commandes GROUP BY Client PIVOT Le IN (-1)'))!.headings).toEqual(['-1']);
    expect(toQbe(parseSql('TRANSFORM Count(*) SELECT Client FROM Commandes GROUP BY Client PIVOT Le'))).not.toHaveProperty('headings');
    expect(toQbe(parseSql('TRANSFORM Nz(Sum(Montant), 0) SELECT Client FROM Commandes GROUP BY Client PIVOT Le'))!.columns[2])
      .toMatchObject({ field: 'Nz(Sum([Montant]), 0)', total: 'expression', crosstab: 'value' });
  });
  it.each([
    'TRANSFORM Count(*) SELECT * FROM Commandes GROUP BY Client PIVOT Le',                       // `*` row item
    'TRANSFORM Count(*) SELECT Client FROM Commandes GROUP BY Client, Montant PIVOT Le',          // a GROUP BY not shown
    'TRANSFORM Count(*) SELECT Client FROM Commandes GROUP BY Client ORDER BY Month(Le) PIVOT Month(Le)', // sort on the Column Heading
    'TRANSFORM Count(*) SELECT Client FROM Commandes GROUP BY Client HAVING Max(Le) > #2026-01-01# PIVOT Le', // a hidden HAVING column
  ])('SQL view only: %s', (sql) => expect(toQbe(parseSql(sql))).toBeNull());
  it('criteria: Row Heading -> HAVING, Column Heading -> WHERE', () => {
    const d = ct([col('[Nom]', 'Clients', { total: 'groupBy', crosstab: 'rowHeading', criteria: ['"Dupont"'] }),
      col('Mois: Month([Le])', undefined, { total: 'groupBy', crosstab: 'columnHeading', criteria: ['>=9'] }),
      col('[Montant]', 'Commandes', { total: 'sum', crosstab: 'value' })]);
    const sql = printSql(fromQbe({ ...d, tables: [{ name: 'Clients' }, { name: 'Commandes' }],
      joins: [{ l: 'Clients', lField: 'N°', r: 'Commandes', rField: 'Client', kind: 'inner' }] }));
    expect(sql).toBe('TRANSFORM Sum([Commandes].[Montant])\nSELECT [Clients].[Nom]\nFROM [Clients] INNER JOIN [Commandes] ON [Clients].[N°] = [Commandes].[Client]\n'
      + 'WHERE Month([Le]) >= 9\nGROUP BY [Clients].[Nom]\nHAVING [Clients].[Nom] = "Dupont"\nPIVOT Month([Le]) AS [Mois];');
  });
  it('normalizeQbe: no Sort on the Column Heading, Show from the Crosstab row, no Top or Unique Values; other kinds drop it', () => {
    const d = normalizeQbe(ct([col('[Client]', 'Commandes', { total: 'groupBy', crosstab: 'rowHeading', show: false }),
      col('[Le]', 'Commandes', { total: 'groupBy', crosstab: 'columnHeading', sort: 'asc' }), col('[Montant]', 'Commandes', { total: 'sum', crosstab: 'value' })],
      { distinct: true, top: { n: 5, percent: false }, headings: ['1'] }));
    expect(d.columns.map((c) => [c.show, c.sort])).toEqual([[true, undefined], [false, undefined], [false, undefined]]);
    expect(d).toMatchObject({ distinct: false, headings: ['1'] });
    expect(d).not.toHaveProperty('top');
    const s = normalizeQbe({ ...d, kind: 'select' });
    expect(s).not.toHaveProperty('headings');
    expect(s.columns.some((c) => 'crosstab' in c)).toBe(false);
  });
});
