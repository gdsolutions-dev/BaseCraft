import { describe, expect, it } from 'vitest';
import type { Expr } from '../expr/ast';
import { localeInfo } from '../locale-format';
import { toCanonical, toDisplay } from '../expr/localize';
import { printSelect, printSql } from './print';
import { isSelectBody, type Query, type SelectQuery } from './ast';
import { queryDependents } from './definition';
import { parseSql, QUERY_PARSE } from './sql-parser';

const SQL1 = 'SELECT [Clients].[Nom], [Commandes].[Montant]\nFROM [Clients] INNER JOIN [Commandes] ON [Clients].[N°] = [Commandes].[Client]\nWHERE [Commandes].[Le] >= [Date début :]\nORDER BY [Commandes].[Montant] DESC;';
it('canonical round trip', () => { expect(printSql(parseSql(SQL1))).toBe(SQL1); });
const CASES = [
  ['select nom from clients', 'SELECT [nom]\nFROM [clients];'],
  ["SELECT TOP 10 PERCENT * FROM Commandes ORDER BY Montant DESC", 'SELECT TOP 10 PERCENT *\nFROM [Commandes]\nORDER BY [Montant] DESC;'],
  ['PARAMETERS [Du] DateTime, [N] Long; SELECT * FROM T WHERE d >= [Du]', 'PARAMETERS [Du] DateTime, [N] Long;\nSELECT *\nFROM [T]\nWHERE [d] >= [Du];'],
  ['SELECT Ville, Sum(Montant) AS Total FROM C GROUP BY Ville HAVING Sum(Montant) > 5', 'SELECT [Ville], Sum([Montant]) AS [Total]\nFROM [C]\nGROUP BY [Ville]\nHAVING Sum([Montant]) > 5;'],
  ['SELECT a FROM T UNION ALL SELECT b FROM U', 'SELECT [a]\nFROM [T]\nUNION ALL\nSELECT [b]\nFROM [U];'],
  ['SELECT * FROM T WHERE x IN (SELECT y FROM U WHERE U.z = T.z)', 'SELECT *\nFROM [T]\nWHERE [x] In (SELECT [y]\nFROM [U]\nWHERE [U].[z] = [T].[z]);'],
  ['UPDATE Commandes SET Montant = Montant * 1.1 WHERE Client = 2', 'UPDATE [Commandes]\nSET [Montant] = [Montant] * 1.1\nWHERE [Client] = 2;'],
  ['DELETE Commandes.* FROM Commandes WHERE Montant < 1', 'DELETE [Commandes].*\nFROM [Commandes]\nWHERE [Montant] < 1;'],
  ['INSERT INTO Archive (N, M) SELECT [N°], Montant FROM Commandes', 'INSERT INTO [Archive] ([N], [M])\nSELECT [N°], [Montant]\nFROM [Commandes];'],
  ['SELECT * INTO Copie FROM Commandes', 'SELECT * INTO [Copie]\nFROM [Commandes];'],
] as const;
it.each(CASES)('%s', (src, out) => { expect(printSql(parseSql(src))).toBe(out); expect(printSql(parseSql(out))).toBe(out); });
it.each([
  ['DROP TABLE Clients', 'forbiddenStatement'], ['SELECT 1 FROM T; DROP TABLE T', 'multipleStatements'], ['ATTACH "x" AS y', 'forbiddenStatement'],
  ['PRAGMA writable_schema=1', 'forbiddenStatement'], ['VACUUM INTO "c:/x"', 'forbiddenStatement'], ['SELECT * FROM bc_meta', 'reservedName'],
  ['SELECT * FROM [BC_Objects]', 'reservedName'], ['SELECT * FROM sqlite_master', 'reservedName'], ['SELECT load_extension("x") FROM T', 'unknownFunction'],
  ['SELECT a FROM T -- x', 'unexpectedToken'],
  ['PARAMETERS [p] Blob; SELECT * FROM T', 'badParameterType'], ['SELECT FROM T', 'unexpectedToken'],
])('refuses %s', (src, code) => expect(() => parseSql(src)).toThrow(expect.objectContaining({ code })));
it('error span points into the text', () => expect(() => parseSql('SELECT a FROM T WHERE a >')).toThrow(expect.objectContaining({ code: 'unexpectedEnd', span: expect.objectContaining({ start: 25 }) })));

describe('crosstab (B4 R8)', () => {
  const X = 'TRANSFORM Sum([Commandes].[Montant]) AS [SommeDeMontant]\nSELECT [Clients].[Nom], Sum([Commandes].[Montant]) AS [Total]\n'
    + 'FROM [Clients] INNER JOIN [Commandes] ON [Clients].[N°] = [Commandes].[Client]\nWHERE [Commandes].[Le] >= [Du]\nGROUP BY [Clients].[Nom]\n'
    + 'PIVOT Month([Commandes].[Le]) AS [Mois] IN (10, 9, 11);';
  it('round trip', () => { expect(printSql(parseSql(X))).toBe(X); expect(isSelectBody(parseSql(X))).toBe(true);
    expect(printSql(parseSql(`PARAMETERS [Du] DateTime;\n${X}`))).toBe(`PARAMETERS [Du] DateTime;\n${X}`); });
  it('lower case and Access spacing read back canonical', () => expect(printSql(parseSql('transform count(*) select Client from Commandes group by Client pivot Ville')))
    .toBe('TRANSFORM Count(*)\nSELECT [Client]\nFROM [Commandes]\nGROUP BY [Client]\nPIVOT [Ville];'));
  it.each([
    ['TRANSFORM Sum(x) SELECT a FROM T GROUP BY a', 'badCrosstab'], ['TRANSFORM Sum(x) SELECT DISTINCT a FROM T GROUP BY a PIVOT b', 'badCrosstab'],
    ['TRANSFORM Sum(x) SELECT TOP 5 a FROM T GROUP BY a PIVOT b', 'badCrosstab'], ['TRANSFORM Sum(x) SELECT a FROM T GROUP BY a UNION SELECT a FROM T PIVOT b', 'badCrosstab'],
    ['TRANSFORM Sum(x) SELECT a FROM T GROUP BY a PIVOT b IN ([c])', 'badCrosstab'], ['SELECT a FROM T PIVOT b', 'unexpectedToken'],
  ])('%s', (sql, code) => expect(() => parseSql(sql)).toThrow(expect.objectContaining({ code })));
  it.each([
    // a pivot expression holding a top-level In is parenthesised, else it would read back as the headings list
    ['TRANSFORM Count(*) SELECT a FROM T GROUP BY a PIVOT (b In (1, 2))', 'TRANSFORM Count(*)\nSELECT [a]\nFROM [T]\nGROUP BY [a]\nPIVOT ([b] In (1, 2));'],
    ['TRANSFORM Count(*) SELECT a FROM T GROUP BY a PIVOT IIf(b In (1, 2), 1, 0) In (0, 1)', 'TRANSFORM Count(*)\nSELECT [a]\nFROM [T]\nGROUP BY [a]\nPIVOT IIf([b] In (1, 2), 1, 0) IN (0, 1);'],
    ['transform max(x) as m select a from t where a > 1 group by a having count(*) > 1 order by a desc pivot b as c in ("x", #2026-10-01#, null, true, 1.5)',
      'TRANSFORM Max([x]) AS [m]\nSELECT [a]\nFROM [t]\nWHERE [a] > 1\nGROUP BY [a]\nHAVING Count(*) > 1\nORDER BY [a] DESC\nPIVOT [b] AS [c] IN ("x", #2026-10-01#, Null, True, 1.5);'],
    ['TRANSFORM Count(*) SELECT a FROM T GROUP BY a PIVOT b IN (-1, 0, 1.5, -2.5)', 'TRANSFORM Count(*)\nSELECT [a]\nFROM [T]\nGROUP BY [a]\nPIVOT [b] IN (-1, 0, 1.5, -2.5);'],
  ])('crosstab %s', (src, out) => { expect(printSql(parseSql(src))).toBe(out); expect(printSql(parseSql(out))).toBe(out); });
  it('headings and refusals', () => {
    expect(parseSql('TRANSFORM Count(*) SELECT a FROM T GROUP BY a PIVOT (b In (1, 2))').body).toMatchObject({ k: 'crosstab', pivot: { k: 'in' } });
    expect(parseSql('TRANSFORM Count(*) SELECT a FROM T GROUP BY a PIVOT b IN (1)').body).toMatchObject({ pivot: { k: 'id', name: 'b' }, headings: [{ k: 'num', v: '1' }] });
    expect(refusal('TRANSFORM Sum(x) SELECT a INTO U FROM T GROUP BY a PIVOT b')).toEqual(['badCrosstab', 'INTO']);
    expect(refusal('TRANSFORM Sum(x) SELECT DISTINCTROW a FROM T PIVOT b')).toEqual(['badCrosstab', 'DISTINCTROW']);
    expect(refusal('TRANSFORM Sum(x) SELECT a FROM T PIVOT b IN (1, - -1)')).toEqual(['badCrosstab', '-']);
    expect(refusal('TRANSFORM Sum(x) SELECT a FROM T PIVOT b IN (1, --1)')).toEqual(['unexpectedToken', '--']);
    expect(refusal('TRANSFORM Sum(x) SELECT a FROM T PIVOT b IN (-#2026-10-01#)')).toEqual(['badCrosstab', '-']);
    expect(refusal('TRANSFORM Sum(x) SELECT a FROM T PIVOT b; SELECT c FROM T WHERE c In (1)')[0]).toBe('multipleStatements');
    expect(refusal('TRANSFORM Sum(x) SELECT a FROM T PIVOT b IN (1) AS c')).toEqual(['unexpectedToken', 'AS']);
    expect(refusal('PIVOT b')).toEqual(['unexpectedToken', 'PIVOT']);
  });
  it('an empty headings list prints no IN', () => {
    const q = parseSql('TRANSFORM Count(*) SELECT a FROM T GROUP BY a PIVOT b');
    expect(printSql({ ...q, body: { ...q.body, headings: [] } as Query['body'] })).toBe('TRANSFORM Count(*)\nSELECT [a]\nFROM [T]\nGROUP BY [a]\nPIVOT [b];');
  });
  it('dependents', () => expect(queryDependents('QDepuis', [{ kind: 'query', name: 'QX', definition: { formatVersion: '1.0', sql: 'TRANSFORM Count(*) SELECT Le FROM QDepuis GROUP BY Le PIVOT Montant;' } }]))
    .toEqual([{ kind: 'query', name: 'QX' }]));
});

// ---- Beyond the brief ------------------------------------------------------------------------------------------

/** Error code and the text its span covers. */
function refusal(src: string): [string, string] {
  try { parseSql(src); } catch (e) {
    const x = e as { name: string; code: string; span: { start: number; end: number } };
    expect(x.name).toBe('ExprSyntaxError');
    return [x.code, src.slice(x.span.start, x.span.end)];
  }
  throw new Error(`accepted: ${src}`);
}

const MORE = [
  ['SELECT DISTINCTROW TOP 5 a, T.*, [U].* FROM T, U', 'SELECT DISTINCT TOP 5 [a], [T].*, [U].*\nFROM [T], [U];'],
  ['SELECT C.Nom FROM Clients C LEFT OUTER JOIN Commandes AS K ON C.[N°] = K.Client RIGHT JOIN Lignes L ON K.[N°] = L.Cde',
    'SELECT [C].[Nom]\nFROM [Clients] AS [C] LEFT JOIN [Commandes] AS [K] ON [C].[N°] = [K].[Client] RIGHT JOIN [Lignes] AS [L] ON [K].[N°] = [L].[Cde];'],
  ['SELECT * FROM (A INNER JOIN B ON A.x = B.x) INNER JOIN C ON B.y = C.y',
    'SELECT *\nFROM [A] INNER JOIN [B] ON [A].[x] = [B].[x] INNER JOIN [C] ON [B].[y] = [C].[y];'],
  ['SELECT * FROM A INNER JOIN (B LEFT JOIN C ON B.y = C.y) ON A.x = B.x',
    'SELECT *\nFROM [A] INNER JOIN ([B] LEFT JOIN [C] ON [B].[y] = [C].[y]) ON [A].[x] = [B].[x];'],
  ['SELECT X.n FROM (SELECT Count(*) AS n FROM T WHERE a Is Not Null) X, ((U))',
    'SELECT [X].[n]\nFROM (SELECT Count(*) AS [n]\nFROM [T]\nWHERE [a] Is Not Null) AS [X], [U];'],
  ["SELECT a FROM T WHERE Not Exists (SELECT TOP 1 * FROM U WHERE U.a = T.a ORDER BY U.b) And b Like 'x*'",
    'SELECT [a]\nFROM [T]\nWHERE Not Exists (SELECT TOP 1 *\nFROM [U]\nWHERE [U].[a] = [T].[a]\nORDER BY [U].[b]) And [b] Like "x*";'],
  ['SELECT a FROM T UNION SELECT b FROM U UNION ALL SELECT c FROM V ORDER BY 1 DESC, a',
    'SELECT [a]\nFROM [T]\nUNION\nSELECT [b]\nFROM [U]\nUNION ALL\nSELECT [c]\nFROM [V]\nORDER BY 1 DESC, [a];'],
  ['select a from t order by a asc, b desc;', 'SELECT [a]\nFROM [t]\nORDER BY [a], [b] DESC;'],
  ['INSERT INTO Commandes (Client, Montant) VALUES (99, 1.5)', 'INSERT INTO [Commandes] ([Client], [Montant])\nVALUES (99, 1.5);'],
  ['INSERT INTO Archive SELECT * FROM Commandes WHERE Le < #2026-01-01#', 'INSERT INTO [Archive]\nSELECT *\nFROM [Commandes]\nWHERE [Le] < #2026-01-01#;'],
  ['SELECT * FROM T WHERE d >= #1/5/2026# AND d < #12/31/2026 10:30:00#', 'SELECT *\nFROM [T]\nWHERE [d] >= #2026-01-05# And [d] < #2026-12-31 10:30:00#;'], // Access's US literals, printed in ISO
  ['SELECT * FROM T WHERE h >= #10:30#', 'SELECT *\nFROM [T]\nWHERE [h] >= #1899-12-30 10:30:00#;'], // time alone: day 0, as in Access
  ['SELECT * FROM T WHERE h >= #10:30 PM# AND d < #1/5/2026 12:15 am#', 'SELECT *\nFROM [T]\nWHERE [h] >= #1899-12-30 22:30:00# And [d] < #2026-01-05 00:15:00#;'],
  ['DELETE * FROM Clients WHERE Ville = "Paris"', 'DELETE *\nFROM [Clients]\nWHERE [Ville] = "Paris";'],
  ['DELETE FROM Clients', 'DELETE *\nFROM [Clients];'],
  ['UPDATE Clients INNER JOIN Commandes ON Clients.[N°] = Commandes.Client SET Clients.Nom = "x", Montant = Montant + 1',
    'UPDATE [Clients] INNER JOIN [Commandes] ON [Clients].[N°] = [Commandes].[Client]\nSET [Clients].[Nom] = "x", [Montant] = [Montant] + 1;'],
  ['UPDATE T SET a = b = 1', 'UPDATE [T]\nSET [a] = [b] = 1;'],
  ['PARAMETERS [Date début :] Date, Mini Money, [N] Byte; DELETE FROM T WHERE d < [Date début :] Or m < Mini',
    'PARAMETERS [Date début :] DateTime, [Mini] Currency, [N] Byte;\nDELETE *\nFROM [T]\nWHERE [d] < [Date début :] Or [m] < [Mini];'],
  ['SELECT a AS [FROM], [Select] FROM [Where] AS [Order]', 'SELECT [a] AS [FROM], [Select]\nFROM [Where] AS [Order];'],
  ['SELECT - -a, -(-b) FROM T', 'SELECT - -[a], - -[b]\nFROM [T];'], // double negation is written `- -`: `--` is refused
] as const;
it.each(MORE)('%s', (src, out) => { expect(printSql(parseSql(src))).toBe(out); expect(printSql(parseSql(out))).toBe(out); });

it('the tree itself round-trips: parseSql(printSql(q)) equals q', () => {
  for (const [src] of [[SQL1], ...CASES, ...MORE]) {
    const q = parseSql(src);
    expect(parseSql(printSql(q)), src).toStrictEqual(q); // strict: no key present as undefined
  }
});

it('tree shapes', () => {
  expect(parseSql('PARAMETERS a Text, b Memo, c LongText, d Short, e SmallInt, f Integer, g Int, h Single, i Real, j Double, k Float, l Decimal, m Bit, n YesNo, o Logical, p DATETIME; SELECT * FROM T').params)
    .toEqual([
      { name: 'a', type: 'shortText' }, { name: 'b', type: 'longText' }, { name: 'c', type: 'longText' },
      { name: 'd', type: 'number', numberSize: 'integer' }, { name: 'e', type: 'number', numberSize: 'integer' },
      { name: 'f', type: 'number', numberSize: 'longInteger' }, { name: 'g', type: 'number', numberSize: 'longInteger' },
      { name: 'h', type: 'number', numberSize: 'single' }, { name: 'i', type: 'number', numberSize: 'single' },
      { name: 'j', type: 'number', numberSize: 'double' }, { name: 'k', type: 'number', numberSize: 'double' },
      { name: 'l', type: 'number', numberSize: 'decimal' }, { name: 'm', type: 'yesNo' }, { name: 'n', type: 'yesNo' },
      { name: 'o', type: 'yesNo' }, { name: 'p', type: 'dateTime' },
    ]);
  expect(printSql(parseSql('PARAMETERS a Memo, b LongText, d SmallInt, f Int, h Real, k Float, n Logical, x Text; SELECT * FROM T')))
    .toBe('PARAMETERS [a] Memo, [b] Memo, [d] Short, [f] Long, [h] Single, [k] Double, [n] Bit, [x] Text;\nSELECT *\nFROM [T];');
  // the spellings Access itself writes; printSql writes BaseCraft's canonical word
  const access = 'PARAMETERS a Text, b Text(255), c Text ( 50 ), d Long, e Short, f Byte, g Currency, h DateTime, i Bit, j IEEEDouble, '
    + 'k IEEESingle, l Value, m Decimal; SELECT * FROM T';
  expect(parseSql(access).params).toEqual([
    { name: 'a', type: 'shortText' }, { name: 'b', type: 'shortText' }, { name: 'c', type: 'shortText' },
    { name: 'd', type: 'number', numberSize: 'longInteger' }, { name: 'e', type: 'number', numberSize: 'integer' },
    { name: 'f', type: 'number', numberSize: 'byte' }, { name: 'g', type: 'currency' }, { name: 'h', type: 'dateTime' },
    { name: 'i', type: 'yesNo' }, { name: 'j', type: 'number', numberSize: 'double' }, { name: 'k', type: 'number', numberSize: 'single' },
    { name: 'l', type: 'shortText' }, { name: 'm', type: 'number', numberSize: 'decimal' },
  ]);
  expect(printSql(parseSql(access))).toBe('PARAMETERS [a] Text, [b] Text, [c] Text, [d] Long, [e] Short, [f] Byte, [g] Currency, '
    + '[h] DateTime, [i] Bit, [j] Double, [k] Single, [l] Text, [m] Decimal;\nSELECT *\nFROM [T];');
  expect(parseSql('SELECT a FROM T UNION SELECT b FROM U ORDER BY a').body).toMatchObject({ k: 'union', all: [false], orderBy: [{ dir: 'asc' }] });
  expect(parseSql('DELETE T.* FROM T').body).toEqual({ k: 'delete', target: 'T', from: { k: 'source', name: 'T' } });
  expect(parseSql('UPDATE T SET [T].a = 1').body).toMatchObject({ set: [{ target: { k: 'id', name: 'a', table: 'T' } }] });
  expect(parseSql('SELECT * FROM A INNER JOIN B ON 1 = 1 LEFT JOIN C ON 2 = 2').body)
    .toMatchObject({ from: [{ k: 'join', kind: 'left', l: { k: 'join', kind: 'inner', l: { name: 'A' }, r: { name: 'B' } }, r: { name: 'C' } }] });
});

it.each([
  // [text, code, text covered by the span]
  ['drop table Clients', 'forbiddenStatement', 'drop'],
  ['PARAMETERS a Long; CREATE TABLE T (a Long)', 'forbiddenStatement', 'CREATE'],
  ['WITH x AS (SELECT 1 FROM T) SELECT * FROM x', 'forbiddenStatement', 'WITH'],
  ['SELECT a FROM T GROUP BY a PIVOT b', 'unexpectedToken', 'PIVOT'],
  ['SELECT a FROM T; ', null, null],
  ['SELECT a FROM T;;', 'multipleStatements', ';'],
  ['SELECT a FROM T WHERE a = 1 /* x */', 'unexpectedToken', '*'],
  ['SELECT /* x */ a FROM T', 'unexpectedToken', '/'],
  // no comments: `--` is one token refused where it stands, even where `- -` would be arithmetic
  ['SELECT * FROM T WHERE N = 1 -- comment', 'unexpectedToken', '--'],
  ['SELECT a --x\nFROM T', 'unexpectedToken', '--'],
  ['SELECT a FROM T -- x', 'unexpectedToken', '--'],
  ['SELECT --a FROM T', 'unexpectedToken', '--'],
  ['SELECT a FROM T WHERE a In (SELECT b FROM U WHERE c = 1 --x\n)', 'unexpectedToken', '--'],
  ['SELECT 1 ---a FROM T', 'unexpectedToken', '--'],
  ['SELECT bc_meta.x FROM T', 'reservedName', 'bc_meta'],
  ['SELECT [sqlite_master].* FROM T', 'reservedName', '[sqlite_master]'],
  ['SELECT a FROM T WHERE a In (SELECT b FROM [bcx_q])', 'reservedName', '[bcx_q]'],
  ['SELECT a FROM T AS bc_x', 'reservedName', 'bc_x'],
  ['SELECT a FROM (SELECT a FROM T) sqlite_y', 'reservedName', 'sqlite_y'],
  ['SELECT a INTO bc_meta FROM T', 'reservedName', 'bc_meta'],
  ['INSERT INTO sqlite_sequence (a) VALUES (1)', 'reservedName', 'sqlite_sequence'],
  ['UPDATE bc_objects SET a = 1', 'reservedName', 'bc_objects'],
  ['UPDATE T SET bc_x.a = 1', 'reservedName', 'bc_x'],
  ['DELETE bc_x.* FROM T', 'reservedName', 'bc_x'],
  ['SELECT sqlite_version() FROM T', 'unknownFunction', 'sqlite_version'],
  ['PARAMETERS a Long, A Text; SELECT * FROM T', 'unexpectedToken', 'A'],
  ['PARAMETERS a [Long]; SELECT * FROM T', 'badParameterType', '[Long]'],
  ...['Null', 'Like', 'In', 'Is', 'True', 'False', 'Not', 'And', 'Or', 'Mod', 'Between', 'Xor']
    .map((w): [string, string, string] => [`PARAMETERS a ${w}; SELECT * FROM T`, 'badParameterType', w]), // expression keywords
  ['PARAMETERS a Text(0); SELECT * FROM T', 'badParameterType', '0'],
  ['PARAMETERS a Text(256); SELECT * FROM T', 'badParameterType', '256'],
  ['PARAMETERS a Text(2.5); SELECT * FROM T', 'badParameterType', '2.5'],
  ['PARAMETERS a Text(); SELECT * FROM T', 'badParameterType', ')'],
  ['PARAMETERS a Text(255; SELECT * FROM T', 'unexpectedToken', ';'],
  ['PARAMETERS a Long(5); SELECT * FROM T', 'unexpectedToken', '('],
  ['SELECT from.* FROM T', 'unexpectedToken', 'from'],
  ['SELECT [].* FROM T', 'unexpectedToken', '[]'],
  ['DELETE where.* FROM T', 'unexpectedToken', 'where'],
  ['DELETE [].* FROM T', 'unexpectedToken', '[]'],
  ['SELECT [a]] FROM T', 'unclosedBracket', '[a]] FROM T'],
  ['SELECT TOP 0 a FROM T', 'unexpectedToken', '0'],
  ['SELECT TOP 1.5 a FROM T', 'unexpectedToken', '1.5'],
  ['SELECT a INTO X FROM T UNION SELECT b FROM U', 'unexpectedToken', 'INTO'],
  ['SELECT a FROM T WHERE a In (SELECT b INTO X FROM U)', 'unexpectedToken', 'INTO'],
  ['SELECT a FROM T ORDER BY a UNION SELECT b FROM U', 'unexpectedToken', 'UNION'],
  ['SELECT a FROM (SELECT a FROM T)', 'unexpectedEnd', ''],
  ['SELECT a b FROM T', 'unexpectedToken', 'b'],
  ['SELECT a FROM T WHERE', 'unexpectedEnd', ''],
  ['SELECT a, FROM T', 'unexpectedToken', 'FROM'],
  ['SELECT a FROM [] ', 'unexpectedToken', '[]'],
  ['SELECT a FROM "T"', 'unexpectedToken', '"T"'],
  ['', 'unexpectedEnd', ''],
  ['SELECT a FROM T DROP TABLE T', 'unexpectedToken', 'TABLE'],
  ["SELECT 'a FROM T", 'unclosedString', "'a FROM T"],
])('%s -> %s', (src, code, covered) => {
  if (code === null) { expect(() => parseSql(src)).not.toThrow(); return; }
  expect(refusal(src)).toEqual([code, covered]);
});

describe('limits: tooComplex, never a stack overflow', () => {
  const [P, C] = [(k: number) => '('.repeat(k), (k: number) => ')'.repeat(k)];
  const derived = (k: number): string => (k === 0 ? '[T]' : `(SELECT * FROM ${derived(k - 1)}) AS [X${k}]`);
  const joins = (k: number): string => `[T0]${Array.from({ length: k }, (_, i) => ` INNER JOIN [T${i + 1}] ON 1 = 1`).join('')}`;
  const rightJoins = (k: number): string => (k === 0 ? '[T]' : `[A${k}] INNER JOIN (${rightJoins(k - 1)}) ON 1 = 1`);

  it('50 levels of FROM nesting are accepted, 51 are tooComplex', () => {
    for (const from of [`${P(50)}[T]${C(50)}`, derived(50), joins(50), rightJoins(25)]) {
      const q = parseSql(`SELECT * FROM ${from}`);
      expect(parseSql(printSql(q))).toStrictEqual(q);
    }
    for (const from of [`${P(51)}[T]${C(51)}`, derived(51), joins(51), rightJoins(26), `${P(100000)}[T]${C(100000)}`, joins(20000)]) {
      expect(() => parseSql(`SELECT * FROM ${from}`), from.slice(0, 30)).toThrow(expect.objectContaining({ name: 'ExprSyntaxError', code: 'tooComplex' }));
    }
  });

  it('subqueries in expressions count with the FROM levels, and expressions keep their own limit', () => {
    const sub = (k: number): string => (k === 0 ? '1' : `[a] In (SELECT [b] FROM ${P(1)}[T]${C(1)} WHERE ${sub(k - 1)})`);
    const tooComplex = expect.objectContaining({ name: 'ExprSyntaxError', code: 'tooComplex' });
    // a FROM parenthesis is a sibling of the WHERE, not an ancestor: only the innermost one adds a level
    expect(() => parseSql(`SELECT * FROM [T] WHERE ${sub(49)}`)).not.toThrow();
    expect(() => parseSql(`SELECT * FROM [T] WHERE ${sub(50)}`)).toThrow(tooComplex);
    const inDerived = (k: number) => `SELECT * FROM ${derived(25).replace('FROM [T]', `FROM [T] WHERE ${sub(k).replace(/\(\[T\]\)/g, '[T]')}`)}`;
    expect(() => parseSql(inDerived(25))).not.toThrow();
    expect(() => parseSql(inDerived(26))).toThrow(tooComplex);
    // the deepest accepted tree: 50 FROM levels around an expression nested 190 deep, holding a subquery
    const deep = `SELECT * FROM ${derived(49).replace('FROM [T]', `FROM [T] WHERE ${P(190)}[x] In (SELECT [y] FROM [U])${C(190)}`)}`;
    const q = parseSql(deep);
    expect(parseSql(printSql(q))).toStrictEqual(q);
    expect(() => parseSql(`SELECT * FROM [T] WHERE ${P(150)}(SELECT ${P(60)}1${C(60)} FROM [T])${C(150)}`)).toThrow(expect.objectContaining({ code: 'tooComplex' }));
  });
});

describe('QUERY_PARSE in the design grid cells', () => {
  const FR = { lang: 'fr' as const, region: localeInfo('fr-FR') };
  const o = { ...QUERY_PARSE, printSub: printSelect };

  it('a cell with a qualified reference and a subquery: display <-> canonical', () => {
    const canon = '[Commandes].[Montant] > (SELECT Avg([Montant])\nFROM [Commandes] AS [K]\nWHERE [K].[Client] = [Clients].[N°]) * 1.5';
    const shown = '[Commandes].[Montant] > (SELECT Avg([Montant])\nFROM [Commandes] AS [K]\nWHERE [K].[Client] = [Clients].[N°]) * 1,5';
    expect(toDisplay(canon, FR, o)).toBe(shown);
    expect(toCanonical('Commandes.Montant > (select avg(Montant) from Commandes K where K.Client = Clients.[N°]) * 1,5', FR, o)).toBe(canon);
    expect(toCanonical('Dans (SELECT Ville FROM Clients WHERE Ville Like "L*") Ou Est Null', FR, { ...o, criteria: true }))
      .toBe('In (SELECT [Ville]\nFROM [Clients]\nWHERE [Ville] Like "L*") Or Is Null');
  });

  it('Exists (SELECT …) in a cell: canonical inside the subquery, display around it', () => {
    const canon = 'Not Exists (SELECT [a], [c]\nFROM [T]\nWHERE [b] = 1.5) Or [c] = 1.5';
    expect(toCanonical('Pas Exists (SELECT a, c FROM T WHERE b = 1.5) Ou [c] = 1,5', FR, o)).toBe(canon);
    expect(toDisplay(canon, FR, o)).toBe('Pas Exists (SELECT [a], [c]\nFROM [T]\nWHERE [b] = 1.5) Ou [c] = 1,5');
    expect(toCanonical('Exists (SELECT a, c FROM T WHERE b = 1.5)', FR, { ...o, criteria: true }))
      .toBe('Exists (SELECT [a], [c]\nFROM [T]\nWHERE [b] = 1.5)');
  });

  it('stop words: a bare SQL word is never a field; a bracketed one is', () => {
    expect(() => toCanonical('[a] + From', FR, o)).toThrow(expect.objectContaining({ code: 'unexpectedToken' }));
    expect(toCanonical('[a] + [From] + Gauche([b]; 1)', FR, o)).toBe('[a] + [From] + Left([b], 1)');
  });
});

describe('names holding "]" round-trip: written "]]" inside the brackets', () => {
  it('fixed case', () => {
    const q = parseSql('SELECT [a]]b] AS [x]]] FROM [T]]] AS []]u] WHERE []]u].[c]]]]] = 1');
    expect(q.body).toMatchObject({ items: [{ e: { k: 'id', name: 'a]b' }, alias: 'x]' }], from: [{ name: 'T]', alias: ']u' }],
      where: { l: { k: 'id', table: ']u', name: 'c]]' } } });
    expect(printSql(q)).toBe('SELECT [a]]b] AS [x]]]\nFROM [T]]] AS []]u]\nWHERE []]u].[c]]]]] = 1;');
  });

  it('property: random names in every name position', () => {
    let seed = 20261022;
    const rnd = (n: number): number => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed % n; };
    const CHARS = ['a', 'é', ']', ']]', '[', ' ', '.', '"', "'", 'Z', '1', '#', '-', '*', ';'];
    const nm = (): string => Array.from({ length: 1 + rnd(5) }, () => CHARS[rnd(CHARS.length)]).join('');
    const id = (): Expr => (rnd(2) ? { k: 'id', name: nm() } : { k: 'id', name: nm(), table: nm() });
    for (let i = 0; i < 300; i++) {
      const inner: SelectQuery = { k: 'select', distinct: false, items: [{ e: id(), alias: nm() }], from: [{ k: 'source', name: nm() }], groupBy: [], orderBy: [] };
      const sel: SelectQuery = {
        k: 'select', distinct: false, items: [{ e: id(), alias: nm() }, { all: true, table: nm() }, { e: id() }],
        into: nm(),
        from: [{ k: 'join', kind: 'left', l: { k: 'source', name: nm(), alias: nm() }, r: { k: 'derived', q: inner, alias: nm() },
          on: { k: 'bin', op: '=', l: id(), r: id() } }, { k: 'source', name: nm() }],
        where: { k: 'inSub', e: id(), q: inner, not: false }, groupBy: [id()], orderBy: [{ e: id(), dir: 'desc' }],
      };
      const params = [{ name: `${nm()}0`, type: 'shortText' as const }, { name: `${nm()}1`, type: 'number' as const, numberSize: 'byte' as const }];
      const queries: Query[] = [
        { params, body: sel },
        { params: [], body: { k: 'insert', target: nm(), columns: [nm(), nm()], source: { values: [id(), id()] } } },
        { params: [], body: { k: 'update', from: { k: 'source', name: nm(), alias: nm() }, set: [{ target: id(), value: id() }], where: id() } },
        { params: [], body: { k: 'delete', target: nm(), from: { k: 'source', name: nm() }, where: id() } },
      ];
      for (const q of queries) expect(parseSql(printSql(q)), printSql(q)).toStrictEqual(q);
    }
  });
});
