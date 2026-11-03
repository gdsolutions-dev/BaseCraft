import { describe, expect, it } from 'vitest';
import type { SqlValue } from '../../../shared/coerce';
import { parseCanonical } from '../../../shared/expr/parser';
import { sameName } from '../../../shared/field-types';
import type { SelectQuery } from '../../../shared/query/ast';
import { bindQuery, type QueryCatalog } from '../../../shared/query/bind';
import { parseSql } from '../../../shared/query/sql-parser';
import { f, t } from '../../../shared/test-fixtures';
import type { ReadRequest, RemoteTable } from '../connector';
import { parseRowToken, rowToken } from '../token';
import { msPlan } from './sql-query';

const ci = { msCi: true, msCollation: 'French_CI_AS' };
const TABLES: RemoteTable[] = [
  { name: 'Clients', remote: 'Clients', schema: 'dbo', key: ['id'], skipped: [], version: 'rv',
    design: t('Clients', [f('id', 'number', { primaryKey: true, msType: 'int' }), f('Nom', 'shortText', { msType: 'nvarchar(80)', ...ci }),
      f('Ville', 'shortText', { msType: 'nvarchar(80)', ...ci })]) },
  { name: 'Commandes', remote: 'Commandes', schema: 'dbo', key: ['n'], skipped: [],
    design: t('Commandes', [f('n', 'number', { primaryKey: true, msType: 'int' }), f('Client', 'number', { msType: 'int' }),
      f('Montant', 'number', { numberSize: 'decimal', precision: 10, scale: 2, msType: 'decimal(10,2)' }), f('Date', 'dateTime', { msType: 'datetime2(7)' })]) },
  { name: 'Divers', remote: 'Divers]x', schema: 'ventes', key: ['Quand'], skipped: [], version: 'rv',
    design: t('Divers', [f('Quand', 'dateTime', { primaryKey: true, msType: 'datetime2(7)' }), f('Notes', 'longText', { msType: 'ntext' }),
      f('Guid', 'shortText', { size: 36, msType: 'uniqueidentifier' }), f('Jour', 'dateTime', { msType: 'date' }), f('Heure', 'dateTime', { msType: 'time(7)' }),
      f('Zone', 'shortText', { size: 34, msType: 'datetimeoffset(7)' }), f('Actif', 'yesNo', { msType: 'bit' }), f('Prix', 'currency', { msType: 'money' }),
      f('Gros', 'number', { numberSize: 'decimal', precision: 19, scale: 0, msType: 'bigint' }), f('Code', 'shortText', { msType: 'varchar(10)', msCi: false })]) },
  { name: 'Lignes', remote: 'Lignes', schema: 'dbo', key: ['n', 'l'], skipped: [],
    design: t('Lignes', [f('n', 'number', { primaryKey: true }), f('l', 'number', { primaryKey: true }), f('Qte', 'number')]) },
];
const QUERIES: Record<string, string> = { QLyon: 'SELECT * FROM Clients WHERE Ville = "Lyon";', QTop: 'SELECT DISTINCT TOP 3 Ville FROM Clients ORDER BY Ville;' };
const table = (name: string) => TABLES.find((x) => sameName(x.name, name));
const catalog: QueryCatalog = {
  table: (name) => table(name)?.design ?? null,
  query: (name) => Object.entries(QUERIES).find(([n]) => sameName(n, name))?.[1] ?? null,
  sourceOf: () => 'srv',
};
const crit = (text: string) => parseCanonical(text, { criteria: true });
const req = (src: string, o: Partial<ReadRequest> & { values?: Record<string, SqlValue> } = {}): ReadRequest => ({
  query: bindQuery(parseSql(src), catalog), values: {}, filter: [], sort: [], refs: false,
  tables: (n) => table(n)!, now: new Date(2026, 9, 31, 14, 5, 9), ...o,
});
const sql = (src: string, o?: Partial<ReadRequest>) => msPlan(req(src, o), true).rows;

const CLIENTS_INNER = 'SELECT a0.[id] AS [c0], a0.[Nom] AS [c1], a0.[Ville] AS [c2], a0.[id] AS [k0], CONVERT(varchar(18), CAST(a0.[rv] AS binary(8)), 1) AS [v] FROM [dbo].[Clients] AS a0';

describe('brief', () => {
  it('a table page: inner select with keys and rowversion, outer filter, sort, OFFSET/FETCH', () => {
    const p = msPlan(req('SELECT * FROM Clients', { refs: true, sort: [{ column: 2, dir: 'asc' }], filter: [{ column: 2, criteria: crit('"Lyon"') }] }), true);
    expect(p.rows).toBe('SELECT q.[c0], q.[c1], q.[c2], CONVERT(nvarchar(4000), q.[k0]), q.[v] FROM (SELECT a0.[id] AS [c0], a0.[Nom] AS [c1], a0.[Ville] AS [c2], '
      + 'a0.[id] AS [k0], CONVERT(varchar(18), CAST(a0.[rv] AS binary(8)), 1) AS [v] FROM [dbo].[Clients] AS a0) AS q WHERE (q.[c2] = @p0) '
      + 'ORDER BY CAST(q.[c2] AS nvarchar(4000)) COLLATE French_100_CI_AS ASC, CAST(q.[c2] AS nvarchar(4000)) COLLATE Latin1_General_100_BIN2 ASC, q.[k0] OFFSET CAST(@p1 AS bigint) ROWS FETCH NEXT CAST(@p2 AS bigint) ROWS ONLY');
    expect(p.count).toBe(`SELECT count(*) FROM (${CLIENTS_INNER}) AS q WHERE (q.[c2] = @p0)`);
    expect(p).toMatchObject({ params: [{ value: 'Lyon', cast: 'nvarchar' }], columns: 3, keys: ['id'], version: true });
  });
  it('decimals and dates are read as text (R6)', () => {
    expect(sql('SELECT Montant, Date FROM Commandes')).toMatch(/CONVERT\(varchar\(48\), CAST\(q\.\[c0\] AS decimal\(38, 2\)\)\).*CONVERT\(varchar\(27\), CAST\(q\.\[c1\] AS datetime2\(7\)\), 121\)/);
  });
  it('a table without rowversion: keys only, no v', () => {
    const p = msPlan(req('SELECT * FROM Commandes', { refs: true }), true);
    expect(p).toMatchObject({ keys: ['n'], version: false });
    expect(p.rows).toMatch(/^SELECT q\.\[c0\], q\.\[c1\], .*, CONVERT\(nvarchar\(4000\), q\.\[k0\]\) FROM \(.* a0\.\[n\] AS \[k0\] FROM \[dbo\]\.\[Commandes\] AS a0\) AS q ORDER BY q\.\[k0\] OFFSET/);
  });
  it('TOP with ties, a union of TOP parts, joins, totals, subqueries', () => {
    expect(sql('SELECT TOP 2 Nom FROM Clients ORDER BY Nom')).toMatch(/SELECT TOP \(2\) WITH TIES/);
    // the SQL parser gives a union part no ORDER BY of its own (only the whole union's): the parts are built as such
    const [a, b] = ['SELECT TOP 1 Nom FROM Clients ORDER BY Nom', 'SELECT TOP 1 Ville FROM Clients ORDER BY Ville'].map((x) => parseSql(x).body as SelectQuery);
    const u = bindQuery({ ...parseSql('SELECT Nom FROM Clients'), body: { k: 'union', parts: [a!, b!], all: [false], orderBy: [] } }, catalog);
    expect(msPlan({ ...req('SELECT Nom FROM Clients'), query: u }, true).rows).toMatch(/SELECT \* FROM \(SELECT TOP \(1\) WITH TIES .*\) AS u0 UNION SELECT \* FROM \(SELECT TOP \(1\) WITH TIES .*\) AS u1\) AS q/);
    expect(sql('SELECT Ville, Sum(Montant) AS T FROM Clients INNER JOIN Commandes ON Clients.id = Commandes.Client GROUP BY Ville')).toMatch(/GROUP BY a0\.\[Ville\]/);
    expect(sql('SELECT Nom FROM Clients WHERE id In (SELECT Client FROM Commandes)')).toMatch(/a0\.\[id\] IN \(SELECT a1\.\[Client\] AS \[c0\] FROM \[dbo\]\.\[Commandes\] AS a1\)/);
  });
  it('the query\'s own order survives the outer page; no ORDER BY inside a derived table without TOP', () => {
    const s = sql('SELECT Nom FROM Clients ORDER BY Ville DESC');
    expect(s).toMatch(/AS \[o0\].*ORDER BY q\.\[o0\]/s); expect(s.slice(0, s.lastIndexOf(') AS q'))).not.toMatch(/ORDER BY/);
  });
  it('refuses what C4 refuses', () => {
    expect(() => msPlan(req('SELECT TOP 10 PERCENT Nom FROM Clients ORDER BY Nom'), true)).toThrow('bc:serverNotSupported|topPercent|sqlserver');
    expect(() => msPlan(req('TRANSFORM Sum(Montant) SELECT Client FROM Commandes GROUP BY Client PIVOT Year(Date)'), true)).toThrow('bc:serverNotSupported|crosstab|sqlserver');
  });
});

describe('statements', () => {
  it('the joined, grouped query in full: each source its alias, the decimal total read as text', () => {
    expect(sql('SELECT Ville, Sum(Montant) AS T FROM Clients INNER JOIN Commandes ON Clients.id = Commandes.Client GROUP BY Ville'))
      .toBe('SELECT q.[c0], CONVERT(varchar(48), CAST(q.[c1] AS decimal(38, 2))) FROM (SELECT a0.[Ville] AS [c0], SUM(a1.[Montant] + CAST(0 AS bigint)) AS [c1]'
        + ' FROM [dbo].[Clients] AS a0 INNER JOIN [dbo].[Commandes] AS a1 ON a0.[id] = a1.[Client] GROUP BY a0.[Ville]) AS q ORDER BY q.[c0], q.[c1] OFFSET CAST(@p0 AS bigint) ROWS FETCH NEXT CAST(@p1 AS bigint) ROWS ONLY');
  });
  it('TOP ties on the folded text only (Lyon and LYON tie, as Access); hidden keys carry both', () => {
    expect(sql('SELECT TOP 2 Nom FROM Clients ORDER BY Nom')).toBe('SELECT q.[c0] FROM (SELECT TOP (2) WITH TIES a0.[Nom] AS [c0], CAST(a0.[Nom] AS nvarchar(4000)) COLLATE French_100_CI_AS AS [o0],'
      + ' CAST(a0.[Nom] AS nvarchar(4000)) COLLATE Latin1_General_100_BIN2 AS [o1], a0.[id] AS [k0] FROM [dbo].[Clients] AS a0 ORDER BY CAST(a0.[Nom] AS nvarchar(4000)) COLLATE French_100_CI_AS ASC) AS q'
      + ' ORDER BY q.[o0] ASC, q.[o1] ASC, q.[k0] OFFSET CAST(@p0 AS bigint) ROWS FETCH NEXT CAST(@p1 AS bigint) ROWS ONLY');
    expect(sql('SELECT TOP 3 Nom FROM Clients')).toMatch(/^SELECT q\.\[c0\] FROM \(SELECT TOP \(3\) a0\.\[Nom\] AS \[c0\], .* AS a0\) AS q/);
  });
  it('a union: parts unparenthesised, UNION and UNION ALL, its order over the output columns', () => {
    expect(sql('SELECT Ville FROM Clients UNION ALL SELECT Ville FROM Clients UNION SELECT Nom FROM Clients ORDER BY Ville'))
      .toBe('SELECT q.[c0] FROM (SELECT u.*, CAST(u.[c0] AS nvarchar(4000)) COLLATE French_100_CI_AS AS [o0], CAST(u.[c0] AS nvarchar(4000)) COLLATE Latin1_General_100_BIN2 AS [o1] FROM (SELECT a0.[Ville] AS [c0] FROM [dbo].[Clients] AS a0'
        + ' UNION ALL SELECT a1.[Ville] AS [c0] FROM [dbo].[Clients] AS a1 UNION SELECT a2.[Nom] AS [c0] FROM [dbo].[Clients] AS a2) AS u) AS q'
        + ' ORDER BY q.[o0] ASC, q.[o1] ASC, q.[c0] OFFSET CAST(@p0 AS bigint) ROWS FETCH NEXT CAST(@p1 AS bigint) ROWS ONLY');
  });
  it('a saved query as a source carries its key and version up', () => {
    const p = msPlan(req('SELECT Nom FROM QLyon', { refs: true }), true);
    expect(p.rows).toBe('SELECT q.[c0], CONVERT(nvarchar(4000), q.[k0]), q.[v] FROM (SELECT a0.[c1] AS [c0], a0.[k0] AS [k0], a0.[v] AS [v] FROM (SELECT a1.[id] AS [c0], a1.[Nom] AS [c1], a1.[Ville] AS [c2],'
      + ' a1.[id] AS [k0], CONVERT(varchar(18), CAST(a1.[rv] AS binary(8)), 1) AS [v] FROM [dbo].[Clients] AS a1 WHERE a1.[Ville] = @p0) AS a0) AS q ORDER BY q.[k0]'
      + ' OFFSET CAST(@p1 AS bigint) ROWS FETCH NEXT CAST(@p2 AS bigint) ROWS ONLY');
    expect(p).toMatchObject({ keys: ['id'], version: true });
  });
  it('an unsorted page orders by the typed key (1, 2, 10, as Access), read as text only in the output', () => {
    const p = msPlan(req('SELECT n FROM Commandes', { refs: true }), true);
    expect(p.rows).toBe('SELECT q.[c0], CONVERT(nvarchar(4000), q.[k0]) FROM (SELECT a0.[n] AS [c0], a0.[n] AS [k0] FROM [dbo].[Commandes] AS a0) AS q'
      + ' ORDER BY q.[k0] OFFSET CAST(@p0 AS bigint) ROWS FETCH NEXT CAST(@p1 AS bigint) ROWS ONLY');
  });
  it('without refs: keys order the page but are not read', () => {
    const p = msPlan(req('SELECT * FROM Clients'), true);
    expect(p.rows).toMatch(/^SELECT q\.\[c0\], q\.\[c1\], q\.\[c2\] FROM .* ORDER BY q\.\[k0\] OFFSET/);
    expect(p.rows).not.toContain('[v]');
    expect(p).toMatchObject({ keys: [], version: false });
  });
  it('a correlated subquery names the enclosing source', () => {
    expect(sql('SELECT Nom FROM Clients AS C WHERE Exists (SELECT * FROM Commandes WHERE Commandes.Client = C.id)'))
      .toContain('WHERE EXISTS (SELECT a1.[n] AS [c0], a1.[Client] AS [c1], a1.[Montant] AS [c2], a1.[Date] AS [c3] FROM [dbo].[Commandes] AS a1 WHERE a1.[Client] = a0.[id])');
  });
  it('parameters: typed casts of nvarchar text; a missing one refuses before anything is sent', () => {
    expect(msPlan(req('PARAMETERS [V] Text; SELECT Nom FROM Clients WHERE Ville = [V]', { values: { V: 'Lyon' } }), true).params).toEqual([{ value: 'Lyon', cast: 'nvarchar' }]);
    expect(msPlan(req('PARAMETERS [D] DateTime, [M] Currency; SELECT n FROM Commandes WHERE Date > [D] And Montant > [M]', { values: { D: '2026-10-31 10:00:00', M: 12.5 } }), true).params)
      .toEqual([{ value: '2026-10-31T10:00:00', cast: 'datetime2(0)' }, { value: '12.5', cast: 'decimal(38, 1)' }]);
    expect(msPlan(req('PARAMETERS [L] Long; SELECT n FROM Commandes WHERE Client = [L]', { values: { L: null } }), true).params).toEqual([{ value: null, cast: 'int' }]);
    expect(() => msPlan(req('PARAMETERS [V] Text; SELECT Nom FROM Clients WHERE Ville = [V]'), true)).toThrow('bc:missingParameter||V');
  });
  it('a value repeated in GROUP BY and the select list is one parameter, so SQL Server sees one expression', () => {
    const p = msPlan(req('SELECT Left(Nom, 1) AS I, Count(*) AS N FROM Clients GROUP BY Left(Nom, 1)'), true);
    expect(p.count).toContain('SELECT LEFT(a0.[Nom], CAST(@p0 AS int)) AS [c0], COUNT(*) AS [c1] FROM [dbo].[Clients] AS a0 GROUP BY LEFT(a0.[Nom], CAST(@p0 AS int))');
    expect(p.params).toEqual([{ value: '1', cast: 'int' }]);
  });
  it('action queries refuse', () => {
    expect(() => msPlan(req('DELETE FROM Clients WHERE id = 1'), true)).toThrow('bc:serverNotSupported|actionQuery|sqlserver');
  });
  it('an outer join: keys first, then every output column', () => {
    expect(sql('SELECT Clients.Nom, Commandes.Montant FROM Clients LEFT JOIN Commandes ON Clients.id = Commandes.Client'))
      .toMatch(/LEFT JOIN \[dbo\]\.\[Commandes\] AS a1 ON a0\.\[id\] = a1\.\[Client\]\) AS q ORDER BY q\.\[k0\], q\.\[c0\], q\.\[c1\] OFFSET CAST\(@p0 AS bigint\) ROWS FETCH NEXT CAST\(@p1 AS bigint\) ROWS ONLY$/);
  });
  it('a composite key orders by each of its columns', () => {
    const p = msPlan(req('SELECT * FROM Lignes', { refs: true }), true);
    expect(p.rows).toContain('a0.[n] AS [k0], a0.[l] AS [k1] FROM [dbo].[Lignes] AS a0) AS q ORDER BY q.[k0], q.[k1] OFFSET');
    expect(p.rows).toMatch(/^SELECT .*, CONVERT\(nvarchar\(4000\), q\.\[k0\]\), CONVERT\(nvarchar\(4000\), q\.\[k1\]\) FROM/);
    expect(p).toMatchObject({ keys: ['n', 'l'], version: false });
  });
  it('DISTINCT TOP below the top level: its folded keys hidden (error 145), a wrapper keeps c0… only', () => {
    expect(sql('SELECT Ville FROM QTop')).toBe('SELECT q.[c0] FROM (SELECT a0.[c0] AS [c0] FROM (SELECT [c0] FROM (SELECT DISTINCT TOP (3) WITH TIES a1.[Ville] AS [c0],'
      + ' CAST(a1.[Ville] AS nvarchar(4000)) COLLATE French_100_CI_AS AS [o0] FROM [dbo].[Clients] AS a1 ORDER BY CAST(a1.[Ville] AS nvarchar(4000)) COLLATE French_100_CI_AS ASC) AS a2) AS a0) AS q ORDER BY q.[c0] OFFSET CAST(@p0 AS bigint) ROWS FETCH NEXT CAST(@p1 AS bigint) ROWS ONLY');
  });
  it('DISTINCT at the top level: no exact (BIN2) key, which would split "Lyon" and "LYON"', () => {
    expect(sql('SELECT DISTINCT Ville FROM Clients ORDER BY Ville')).toContain('SELECT DISTINCT a0.[Ville] AS [c0], CAST(a0.[Ville] AS nvarchar(4000)) COLLATE French_100_CI_AS AS [o0] FROM');
  });
  it.each([-1, 2.5, NaN, Infinity, 2 ** 53])('TOP %s refuses as an invalid argument', (n) => {
    const r = req('SELECT TOP 2 Nom FROM Clients');
    (r.query.query.body as SelectQuery).top!.n = n;
    expect(() => msPlan(r, true)).toThrow('bc:invalidArgument');
  });
  it('a page sort on a column the stable order also names writes it once (error 169)', () => {
    expect(sql('SELECT Ville FROM Clients GROUP BY Ville', { sort: [{ column: 0, dir: 'desc' }] }))
      .toMatch(/ORDER BY CAST\(q\.\[c0\] AS nvarchar\(4000\)\) COLLATE French_100_CI_AS DESC, CAST\(q\.\[c0\] AS nvarchar\(4000\)\) COLLATE Latin1_General_100_BIN2 DESC OFFSET/);
    expect(sql('SELECT n FROM Commandes GROUP BY n', { sort: [{ column: 0, dir: 'asc' }] })).toMatch(/ORDER BY q\.\[c0\] ASC OFFSET/);
  });
});

describe('columns as R5 presents them and R6 reads them', () => {
  it('each declared type presented in its class; the key as text with every fraction; identifiers quoted', () => {
    const p = msPlan(req('SELECT * FROM Divers', { refs: true }), true);
    expect(p.count).toContain('SELECT a0.[Quand] AS [c0], CAST(a0.[Notes] AS nvarchar(max)) AS [c1], CONVERT(char(36), a0.[Guid]) AS [c2], CAST(a0.[Jour] AS datetime2(7)) AS [c3], '
      + "DATEADD(second, DATEDIFF(second, '00:00:00', a0.[Heure]), CAST('1899-12-30' AS datetime2(0))) AS [c4], CONVERT(nvarchar(34), a0.[Zone], 121) AS [c5], a0.[Actif] AS [c6], "
      + 'a0.[Prix] AS [c7], a0.[Gros] AS [c8], a0.[Code] AS [c9], a0.[Quand] AS [k0], CONVERT(varchar(18), CAST(a0.[rv] AS binary(8)), 1) AS [v] FROM [ventes].[Divers]]x] AS a0');
    expect(p.rows).toMatch(/^SELECT CONVERT\(varchar\(27\), CAST\(q\.\[c0\] AS datetime2\(7\)\), 121\), q\.\[c1\], q\.\[c2\], CONVERT\(varchar\(27\), CAST\(q\.\[c3\] AS datetime2\(7\)\), 121\), CONVERT\(varchar\(27\), CAST\(q\.\[c4\] AS datetime2\(7\)\), 121\), q\.\[c5\], q\.\[c6\], CONVERT\(varchar\(48\), CAST\(q\.\[c7\] AS decimal\(38, 4\)\)\), CONVERT\(varchar\(48\), CAST\(q\.\[c8\] AS decimal\(38, 0\)\)\), q\.\[c9\], CONVERT\(nvarchar\(4000\), q\.\[k0\], 121\), q\.\[v\] FROM/);
  });
  it('a presented column is what expressions read', () => {
    expect(sql('SELECT Quand FROM Divers WHERE Year(Jour) = 2026 And Notes Like "a*"'))
      .toContain('WHERE (DATEPART(year, CAST(CAST(a0.[Jour] AS datetime2(7)) AS datetime2(0))) = CAST(@p0 AS decimal(38, 0))) AND (CAST(CAST(a0.[Notes] AS nvarchar(max)) AS nvarchar(max)) COLLATE Latin1_General_100_CI_AS LIKE @p1 COLLATE Latin1_General_100_CI_AS)) AS q');
  });
  it('Yes/No: read raw, sorted and filtered as -1/0 (Yes first ascending, as Access)', () => {
    const p = msPlan(req('SELECT Quand, Actif FROM Divers', { sort: [{ column: 1, dir: 'asc' }], filter: [{ column: 1, criteria: crit('True') }] }), true);
    expect(p.rows).toContain('SELECT a0.[Quand] AS [c0], a0.[Actif] AS [c1]');
    expect(p.rows).toContain('WHERE ((-ABS(CAST(q.[c1] AS int))) = CAST(@p0 AS int)) ORDER BY (-ABS(CAST(q.[c1] AS int))) ASC, q.[k0]');
  });
  it('page criteria and where name output columns, compared in their collation (R8); an unknown name refuses', () => {
    expect(sql('SELECT Nom AS Client, Code FROM Divers, Clients', { where: parseCanonical('[Client] Like "D*" And [Code] = "x"') }))
      .toContain('WHERE ((q.[c0] LIKE @p0) AND (CAST(q.[c1] AS nvarchar(4000)) COLLATE Latin1_General_100_CI_AS = @p1 COLLATE Latin1_General_100_CI_AS))');
    expect(() => sql('SELECT Nom FROM Clients', { where: parseCanonical('[Ville] = "Lyon"') })).toThrow('bc:invalidArgument');
  });
  it('a join compares two columns plain only under one known collation (R8)', () => {
    expect(sql('SELECT Clients.Nom FROM Clients INNER JOIN Divers ON Clients.Nom = Divers.Code')).toContain('ON CAST(a0.[Nom] AS nvarchar(4000)) COLLATE Latin1_General_100_CI_AS = CAST(a1.[Code] AS nvarchar(4000)) COLLATE Latin1_General_100_CI_AS');
    expect(sql('SELECT Nom FROM Clients WHERE Nom = Ville')).toContain('WHERE a0.[Nom] = a0.[Ville]');
  });
  it('Avg of a Decimal field stays exact at the bound column scale (bind.ts); of a Currency, native; of an integer, a float', () => {
    expect(sql('SELECT Avg(Montant) AS A, Avg(Client) AS B FROM Commandes')).toContain('SELECT AVG(CAST(a0.[Montant] AS decimal(38, 20))) AS [c0], AVG(CAST(a0.[Client] AS float)) AS [c1]');
    expect(sql('SELECT Avg(Gros) AS A, Avg(Prix) AS B FROM Divers')).toContain('SELECT AVG(CAST(a0.[Gros] AS decimal(38, 9))) AS [c0], AVG(a0.[Prix]) AS [c1]');
  });
});

describe('tokens (token.ts)', () => {
  it('round-trip with a rowversion or none; a long key gives none; another key names it stale', () => {
    expect(parseRowToken(rowToken(['id'], ['2026-10-30 12:00:00.1234567'], '0x00000000000007D1')!, ['id'])).toEqual({ keys: ['2026-10-30 12:00:00.1234567'], version: '0x00000000000007D1' });
    expect(parseRowToken(rowToken(['n'], ['7'], '')!, ['n'])).toEqual({ keys: ['7'], version: '' });
    expect(rowToken(['id'], ['x'.repeat(5000)], '')).toBeNull();
    expect(parseRowToken(rowToken(['id'], ['7'], '')!, ['code'])).toBeNull();
    expect(() => parseRowToken('[["id"],[1],""]', ['id'])).toThrow('bc:invalidArgument');
  });
});
