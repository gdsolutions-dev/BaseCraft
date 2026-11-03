import { describe, expect, it } from 'vitest';
import type { SqlValue } from '../../../shared/coerce';
import { parseCanonical } from '../../../shared/expr/parser';
import { sameName } from '../../../shared/field-types';
import type { SelectQuery } from '../../../shared/query/ast';
import { bindQuery, type QueryCatalog } from '../../../shared/query/bind';
import { parseSql } from '../../../shared/query/sql-parser';
import { f, t } from '../../../shared/test-fixtures';
import type { ReadRequest, RemoteTable } from '../connector';
import { parseRowToken as parseToken, rowToken as pgToken } from '../token';
import { pgPlan } from './sql-query';

const TABLES: RemoteTable[] = [
  { name: 'Clients', remote: 'Clients', schema: 'ventes', key: ['id'], skipped: [],
    design: t('Clients', [f('id', 'number', { primaryKey: true }), f('Nom', 'shortText'), f('Ville', 'shortText')]) },
  { name: 'Commandes', remote: 'Commandes', schema: 'ventes', key: ['n'], skipped: [],
    design: t('Commandes', [f('n', 'number', { primaryKey: true }), f('Client', 'number'), f('Montant', 'currency'), f('Date', 'dateTime')]) },
  { name: 'Flags', remote: 'flags', schema: 'ventes', key: ['k'], skipped: [],
    design: t('Flags', [f('k', 'number'), f('Actif', 'yesNo'), f('Jour', 'dateTime', { pgCast: 'timestamp' }), f('Etat', 'longText', { pgCast: 'text' })]) },
  { name: 'Lignes', remote: 'Lignes', schema: 'ventes', key: ['n', 'l'], skipped: [],
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
  tables: (n) => table(n)!, now: new Date(2026, 9, 30, 14, 5, 9), ...o,
});
const sql = (src: string, o?: Partial<ReadRequest>) => pgPlan(req(src, o), null).rows;

const CLIENTS_INNER = 'SELECT a0."id" AS "c0", a0."Nom" AS "c1", a0."Ville" AS "c2", a0."id" AS "k0", a0.xmin::text AS "v" FROM "ventes"."Clients" AS a0';

describe('brief', () => {
  it('a table page: inner select with keys and xmin, outer filter, sort, then keys', () => {
    const p = pgPlan(req('SELECT * FROM Clients', { refs: true, sort: [{ column: 2, dir: 'asc' }], filter: [{ column: 2, criteria: crit('"Lyon"') }] }), null);
    expect(p.rows).toBe('SELECT q."c0", q."c1", q."c2", q."k0"::text, q."v" FROM (SELECT a0."id" AS "c0", a0."Nom" AS "c1", a0."Ville" AS "c2", a0."id" AS "k0", a0.xmin::text AS "v" FROM "ventes"."Clients" AS a0) AS q'
      + ' WHERE (lower(q."c2") = lower($1::text)) ORDER BY lower(q."c2") ASC NULLS FIRST, q."c2" COLLATE "C" ASC, q."k0" LIMIT $2 OFFSET $3');
    expect(p.count).toBe(`SELECT count(*) FROM (${CLIENTS_INNER}) AS q WHERE (lower(q."c2") = lower($1::text))`);
    expect(p).toMatchObject({ params: [{ value: 'Lyon', cast: 'text' }], columns: 3, keys: ['id'], version: true });
  });
  it('a parameter query: one bound value, typed', () => {
    expect(pgPlan(req('PARAMETERS [V] Text; SELECT Nom FROM Clients WHERE Ville = [V]', { values: { V: 'Lyon' } }), null).params[0]).toEqual({ value: 'Lyon', cast: 'text' });
  });
  it('joins, totals, TOP with ties, union, subqueries', () => {
    expect(sql('SELECT Ville, Sum(Montant) AS T FROM Clients INNER JOIN Commandes ON Clients.id = Commandes.Client GROUP BY Ville')).toMatch(/GROUP BY a0\."Ville"/);
    expect(sql('SELECT TOP 2 Nom FROM Clients ORDER BY Nom')).toMatch(/FETCH FIRST 2 ROWS WITH TIES/);
    expect(sql('SELECT Nom FROM Clients WHERE id In (SELECT Client FROM Commandes)')).toMatch(/IN \(SELECT/);
  });
  it('the query\'s own order survives the outer page', () => { expect(sql('SELECT Nom FROM Clients ORDER BY Ville DESC')).toMatch(/AS "o0".*ORDER BY q\."o0"/s); });
  it('refuses what the closed list lacks', () => {
    expect(() => pgPlan(req('SELECT TOP 10 PERCENT Nom FROM Clients ORDER BY Nom'), null)).toThrow('bc:serverNotSupported|topPercent|postgresql');
    expect(() => pgPlan(req('TRANSFORM Sum(Montant) SELECT Client FROM Commandes GROUP BY Client PIVOT Year(Date)'), null)).toThrow('bc:serverNotSupported|crosstab|postgresql');
  });
  it('a source without keys orders by every output column last', () => { expect(sql('SELECT Ville FROM Clients GROUP BY Ville')).toMatch(/ORDER BY .*q\."c0"\s+LIMIT/); });
  it('tokens round-trip; a long key gives none', () => {
    expect(parseToken(pgToken(['id'], ['2026-10-30 12:00:00.123456'], '731')!, ['id'])).toEqual({ keys: ['2026-10-30 12:00:00.123456'], version: '731' });
    expect(pgToken(['id'], ['x'.repeat(5000)], '1')).toBeNull(); expect(() => parseToken('[["id"],[1],"2"]', ['id'])).toThrow('bc:invalidArgument');
  });
  it("a token names its key columns: read under another key (Refresh Link changed it) it is stale, null, never another row's key", () => {
    const t = pgToken(['id'], ['7'], '731')!;
    expect(parseToken(t, ['code'])).toBeNull();
    expect(parseToken(t, ['ID'])).toBeNull(); // PostgreSQL names are case-sensitive
    expect(parseToken(pgToken(['n', 'l'], ['1', '2'], '9')!, ['l', 'n'])).toBeNull();
  });
});

describe('statements', () => {
  it('the joined, grouped query in full: each source its alias, the aggregate native', () => {
    expect(sql('SELECT Ville, Sum(Montant) AS T FROM Clients INNER JOIN Commandes ON Clients.id = Commandes.Client GROUP BY Ville'))
      .toBe('SELECT q."c0", q."c1" FROM (SELECT a0."Ville" AS "c0", sum(a1."Montant") AS "c1" FROM "ventes"."Clients" AS a0 INNER JOIN "ventes"."Commandes" AS a1'
        + ' ON a0."id" = a1."Client" GROUP BY a0."Ville") AS q ORDER BY q."c0", q."c1" LIMIT $1 OFFSET $2');
  });
  it('TOP ties on the folded text only (Lyon and LYON tie, as Access); hidden keys carry both', () => {
    expect(sql('SELECT TOP 2 Nom FROM Clients ORDER BY Nom')).toBe('SELECT q."c0" FROM (SELECT a0."Nom" AS "c0", lower(a0."Nom") AS "o0", (a0."Nom") COLLATE "C" AS "o1", a0."id" AS "k0"'
      + ' FROM "ventes"."Clients" AS a0 ORDER BY lower(a0."Nom") ASC NULLS FIRST FETCH FIRST 2 ROWS WITH TIES) AS q ORDER BY q."o0" ASC NULLS FIRST, q."o1" ASC, q."k0" LIMIT $1 OFFSET $2');
    expect(sql('SELECT TOP 3 Nom FROM Clients')).toMatch(/AS a0 LIMIT 3\) AS q/);
  });
  it('the collation folds hidden keys and page sorts', () => {
    expect(pgPlan(req('SELECT Nom FROM Clients ORDER BY Nom', { sort: [{ column: 0, dir: 'desc' }] }), 'fr-x-icu').rows)
      .toContain('lower(a0."Nom") COLLATE "fr-x-icu" AS "o0"');
    expect(pgPlan(req('SELECT Nom FROM Clients', { sort: [{ column: 0, dir: 'desc' }] }), 'fr-x-icu').rows)
      .toContain('ORDER BY lower(q."c0") COLLATE "fr-x-icu" DESC NULLS LAST, q."c0" COLLATE "C" DESC, q."k0"');
  });
  it('a value repeated in GROUP BY and the select list is one parameter, so PostgreSQL sees one expression', () => {
    const p = pgPlan(req('SELECT Left(Nom, 1) AS I, Count(*) AS N FROM Clients GROUP BY Left(Nom, 1)'), null);
    expect(p.count).toContain('SELECT left(a0."Nom", $1::int4) AS "c0", count(*) AS "c1" FROM "ventes"."Clients" AS a0 GROUP BY left(a0."Nom", $1::int4)');
    expect(p.params).toEqual([{ value: 1, cast: 'int4' }]);
  });
  it('union parts in parentheses; UNION and UNION ALL; its order over the output columns', () => {
    expect(sql('SELECT Ville FROM Clients UNION ALL SELECT Ville FROM Clients UNION SELECT Nom FROM Clients ORDER BY Ville'))
      .toBe('SELECT q."c0" FROM (SELECT u.*, lower(u."c0") AS "o0", (u."c0") COLLATE "C" AS "o1" FROM ((SELECT a0."Ville" AS "c0" FROM "ventes"."Clients" AS a0)'
        + ' UNION ALL (SELECT a1."Ville" AS "c0" FROM "ventes"."Clients" AS a1) UNION (SELECT a2."Nom" AS "c0" FROM "ventes"."Clients" AS a2)) AS u) AS q'
        + ' ORDER BY q."o0" ASC NULLS FIRST, q."o1" ASC, q."c0" LIMIT $1 OFFSET $2');
  });
  it('a saved query as a source carries its key and version up', () => {
    const p = pgPlan(req('SELECT Nom FROM QLyon', { refs: true }), null);
    expect(p.rows).toBe('SELECT q."c0", q."k0"::text, q."v" FROM (SELECT a0."c1" AS "c0", a0."k0" AS "k0", a0."v" AS "v" FROM (SELECT a1."id" AS "c0", a1."Nom" AS "c1", a1."Ville" AS "c2",'
      + ' a1."id" AS "k0", a1.xmin::text AS "v" FROM "ventes"."Clients" AS a1 WHERE lower(a1."Ville") = lower($1::text)) AS a0) AS q ORDER BY q."k0" LIMIT $2 OFFSET $3');
    expect(p).toMatchObject({ keys: ['id'], version: true });
  });
  it('a correlated subquery names the enclosing source', () => {
    expect(sql('SELECT Nom FROM Clients AS C WHERE Exists (SELECT * FROM Commandes WHERE Commandes.Client = C.id)'))
      .toContain('WHERE EXISTS (SELECT a1."n" AS "c0", a1."Client" AS "c1", a1."Montant" AS "c2", a1."Date" AS "c3" FROM "ventes"."Commandes" AS a1 WHERE a1."Client" = a0."id")');
  });
  it('a missing parameter value refuses before anything is sent', () => {
    expect(() => pgPlan(req('PARAMETERS [V] Text; SELECT Nom FROM Clients WHERE Ville = [V]'), null)).toThrow('bc:missingParameter||V');
  });
  it('action queries refuse', () => {
    expect(() => pgPlan(req('DELETE FROM Clients WHERE id = 1'), null)).toThrow('bc:serverNotSupported|actionQuery|postgresql');
  });
});

describe('fix round 1', () => {
  it('an outer join: keys first, then every output column, so rows whose key is Null still page stably', () => {
    expect(sql('SELECT Clients.Nom, Commandes.Montant FROM Clients LEFT JOIN Commandes ON Clients.id = Commandes.Client'))
      .toMatch(/LEFT JOIN "ventes"\."Commandes" AS a1 ON a0\."id" = a1\."Client"\) AS q ORDER BY q\."k0", q\."c0", q\."c1" LIMIT \$1 OFFSET \$2$/);
    expect(sql('SELECT Nom FROM Clients INNER JOIN Commandes ON Clients.id = Commandes.Client')).toMatch(/ORDER BY q\."k0" LIMIT/);
  });
  it('a composite key orders by each of its columns and reads each as text', () => {
    const p = pgPlan(req('SELECT * FROM Lignes', { refs: true }), null);
    expect(p.rows).toBe('SELECT q."c0", q."c1", q."c2", q."k0"::text, q."k1"::text, q."v" FROM (SELECT a0."n" AS "c0", a0."l" AS "c1", a0."Qte" AS "c2", a0."n" AS "k0", a0."l" AS "k1",'
      + ' a0.xmin::text AS "v" FROM "ventes"."Lignes" AS a0) AS q ORDER BY q."k0", q."k1" LIMIT $1 OFFSET $2');
    expect(p.keys).toEqual(['n', 'l']);
  });
  it('DISTINCT TOP below the top level: its sort keys hidden in the select list (42P10), a wrapper keeps c0… only', () => {
    expect(sql('SELECT Ville FROM QTop')).toBe('SELECT q."c0" FROM (SELECT a0."c0" AS "c0" FROM (SELECT "c0" FROM (SELECT DISTINCT a1."Ville" AS "c0", lower(a1."Ville") AS "o0"'
      + ' FROM "ventes"."Clients" AS a1 ORDER BY lower(a1."Ville") ASC NULLS FIRST FETCH FIRST 3 ROWS WITH TIES) AS a2) AS a0) AS q ORDER BY q."c0" LIMIT $1 OFFSET $2');
    expect(sql('SELECT Nom FROM Clients WHERE Ville In (SELECT DISTINCT TOP 1 Ville FROM Clients ORDER BY Ville)'))
      .toContain('IN (SELECT lower(s.v) FROM (SELECT "c0" FROM (SELECT DISTINCT a1."Ville" AS "c0", lower(a1."Ville") AS "o0" FROM');
    expect(sql('SELECT DISTINCT TOP 1 Ville FROM Clients ORDER BY Ville')).toContain('SELECT DISTINCT a0."Ville" AS "c0", lower(a0."Ville") AS "o0", (a0."Ville") COLLATE "C" AS "o1" FROM');
  });
  it('text groups case-sensitively on PostgreSQL (R14, documented): GROUP BY, DISTINCT and UNION on the value itself, never lower()', () => {
    expect(sql('SELECT Ville FROM Clients GROUP BY Ville')).toContain('SELECT a0."Ville" AS "c0" FROM "ventes"."Clients" AS a0 GROUP BY a0."Ville")');
    expect(sql('SELECT DISTINCT Ville FROM Clients')).toContain('(SELECT DISTINCT a0."Ville" AS "c0" FROM "ventes"."Clients" AS a0)');
    expect(sql('SELECT Ville FROM Clients UNION SELECT Nom FROM Clients')).toContain('(SELECT a0."Ville" AS "c0" FROM "ventes"."Clients" AS a0) UNION (SELECT a1."Nom" AS "c0"');
  });
  it.each([-1, 2.5, NaN, Infinity, 2 ** 53])('TOP %s refuses as an invalid argument', (n) => {
    const r = req('SELECT TOP 2 Nom FROM Clients');
    (r.query.query.body as SelectQuery).top!.n = n;
    expect(() => pgPlan(r, null)).toThrow('bc:invalidArgument');
  });
  it.each(['', 'x', '[]', '[["id"],["1"]]', '[["id"],["1"],"2",3]', '[["id"],["1","2"],"3"]', '[["id"],[],"3"]', '[["id"],["1"],3]', '[["id"],["1"],null]',
    '[["id"],[null],"3"]', '[["1"],"2"]', '[[1],["1"],"2"]', '{"0":["id"],"1":["1"],"2":"2"}'])
  ('parseToken refuses %s for one key', (t) => expect(() => parseToken(t, ['id'])).toThrow('bc:invalidArgument'));
});

describe('columns as the expression generator reads them (Task 6 contract)', () => {
  it('a field marked pgCast is presented in its class, everywhere but its key', () => {
    const p = pgPlan(req('SELECT k, Jour, Etat FROM Flags WHERE Year(Jour) = 2026', { refs: true }), null);
    expect(p.rows).toContain('SELECT a0."k" AS "c0", a0."Jour"::timestamp AS "c1", a0."Etat"::text AS "c2", a0."k" AS "k0"');
    expect(p.rows).toContain('extract(year from date_trunc(\'second\', (a0."Jour"::timestamp) + interval \'0.5 second\'))::int4');
    expect(sql('SELECT Jour FROM Flags WHERE Etat = "x"').replace(/.*FROM "ventes"/, '')).toBe('."flags" AS a0 WHERE lower(a0."Etat"::text) = lower($1::text)) AS q ORDER BY q."k0" LIMIT $2 OFFSET $3');
  });
  it('Yes/No: read raw, sorted and filtered as -1/0 (Yes first ascending, as Access)', () => {
    const p = pgPlan(req('SELECT k, Actif FROM Flags', { sort: [{ column: 1, dir: 'asc' }], filter: [{ column: 1, criteria: crit('True') }] }), null);
    expect(p.rows).toContain('SELECT a0."k" AS "c0", a0."Actif" AS "c1"');
    expect(p.rows).toContain('WHERE ((-abs(q."c1"::int4)) = $1::int4) ORDER BY (-abs(q."c1"::int4)) ASC NULLS FIRST, q."k0"');
  });
  it('page criteria and where name output columns; an unknown name refuses', () => {
    expect(sql('SELECT Nom AS Client, Ville FROM Clients', { where: parseCanonical('[Client] Like "D*" And [Ville] = "Lyon"') }))
      .toContain('WHERE ((q."c0" ILIKE $1::text) AND (lower(q."c1") = lower($2::text)))');
    expect(() => sql('SELECT Nom FROM Clients', { where: parseCanonical('[Ville] = "Lyon"') })).toThrow('bc:invalidArgument');
  });
});

describe('cross-tests (Task 11)', () => {
  it('ORDER BY Nom, id: the exact text breaks only the ties left by every key, as Access', () => {
    expect(sql('SELECT Nom FROM Clients ORDER BY Nom, id')).toContain('lower(a0."Nom") AS "o0", a0."id" AS "o1", (a0."Nom") COLLATE "C" AS "o2"');
  });
  it('a UNION ordered by two keys: the exact text after both', () => {
    expect(sql('SELECT Nom, id FROM Clients UNION SELECT Ville, id FROM Clients ORDER BY Nom, id')).toContain(
      'SELECT u.*, lower(u."c0") AS "o0", u."c1" AS "o1", (u."c0") COLLATE "C" AS "o2" FROM');
  });
});
