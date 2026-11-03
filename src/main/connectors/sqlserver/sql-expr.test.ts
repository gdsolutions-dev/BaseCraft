import { describe, expect, it } from 'vitest';
import { ExprRuntimeError } from '../../../shared/expr/ast';
import { parseCanonical } from '../../../shared/expr/parser';
import type { FieldType } from '../../../shared/field-types';
import type { SelectQuery } from '../../../shared/query/ast';
import { exprType, type BoundQuery } from '../../../shared/query/bind';
import { PG_FUNCTIONS, PG_REFUSED } from '../postgres/sql-expr';
import { MS_FUNCTIONS, MS_REFUSED, msCondition, msIdent, msNumber, msOrderKeys, msValue, type MsExprCtx } from './sql-expr';

const TYPES: Record<string, FieldType> = {
  Ville: 'shortText', Ville2: 'shortText', Ville3: 'shortText', Code: 'shortText', m: 'currency', t: 'shortText', a: 'shortText', d: 'dateTime', n: 'number', i: 'number', b: 'yesNo', ID: 'autoNumber',
};
// exprType's rules over a stub binding: every [name] of TYPES is a column.
const stub = { refs: { get: (e: { k: string; name?: string }) => (e.k === 'id' && TYPES[e.name!] ? { kind: 'column', type: TYPES[e.name!] } : undefined) },
  params: [], selects: new Map() } as unknown as BoundQuery;
// [Ville] and [Ville3] are French_CI_AS columns, [Ville2] another _CI_AS one, [t] a _CI_AS one of unknown collation name,
// [Code] a case-sensitive one; [P] a text query parameter
const COLL: Record<string, string> = { Ville: 'French_CI_AS', Ville3: 'French_CI_AS', Ville2: 'SQL_Latin1_General_CP1_CI_AS', Code: 'Latin1_General_CS_AS' };
const ctx: MsExprCtx = {
  resolve: (e) => (e.k === 'id' && e.name === 'P' ? { sql: '@?', type: 'shortText', ci: true, params: [{ value: 'Du*', cast: 'nvarchar' }], param: true }
    : { sql: `a0.${msIdent(e.k === 'id' ? e.name : e.path.join('.'))}`, type: e.k === 'id' ? TYPES[e.name] ?? null : null, ci: !(e.k === 'id' && e.name === 'Code'),
      ...(e.k === 'id' && COLL[e.name] ? { collation: COLL[e.name] } : {}) }),
  typeOf: (e) => exprType(e, stub),
  now: new Date(2026, 9, 31, 14, 5, 9),
  dbCi: true,
};
const c = (src: string, o?: Partial<MsExprCtx>) => msNumber(msCondition(parseCanonical(src), { ...ctx, ...o }));
const v = (src: string, o?: Partial<MsExprCtx>) => msNumber(msValue(parseCanonical(src), { ...ctx, ...o }));
const CI = 'COLLATE Latin1_General_100_CI_AS';
/** A column or an expression as nvarchar before its COLLATE (a varchar would be re-encoded into Latin1's code page). */
const N = (x: string) => `CAST(${x} AS nvarchar(4000))`;

describe('brief', () => {
  it('text on a _CI_AS column compares plain; a case-sensitive one gets the CI collation', () => {
    expect(c('[Ville] = "Lyon"')).toEqual({ sql: 'a0.[Ville] = @p0', params: [{ value: 'Lyon', cast: 'nvarchar' }] });
    expect(c('[Code] = "ab"').sql).toBe('CAST(a0.[Code] AS nvarchar(4000)) COLLATE Latin1_General_100_CI_AS = @p0 COLLATE Latin1_General_100_CI_AS');
    expect(c('[Ville] = [Code]').sql).toContain('COLLATE Latin1_General_100_CI_AS'); // Review Focus 1
  });
  it('Like: * ? # [!…] become T-SQL classes; literal % and _ are escaped', () => {
    expect(c('[Ville] Like "L*"').params[0]!.value).toBe('L%');
    expect(c('[Ville] Like "50%_A#[!x-z]"').params[0]!.value).toBe('50[%][_]A[0123456789][^xyz]');
    // Task 6: ASCII ranges by their characters (the collation's order would put é in [d-z]); others as written
    expect(c('[Ville] Like "[A-C1-3_][à-ÿ][a-Z]"').params[0]!.value).toBe('[ABC123_][à-ÿ][a-Z]');
    expect(() => c('[Ville] Like [Code]')).toThrow('bc:serverFunction|Like|sqlserver');
  });
  it('numbers and dates are cast parameters; Date() is the workstation clock', () => {
    expect(c('[n] > 1.25').sql).toBe('a0.[n] > CAST(@p0 AS decimal(38, 2))');
    expect(msNumber(msValue(parseCanonical('Date()'), { ...ctx, now: new Date(2026, 9, 31, 14, 5) })).params).toEqual([{ value: '2026-10-31T00:00:00', cast: 'datetime2(0)' }]);
  });
  it('Len keeps trailing spaces; Avg of an integer is not truncated; Round is banker\'s', () => {
    expect(msValue(parseCanonical('Len([Ville])'), ctx).sql).toBe("LEN(CAST(a0.[Ville] AS nvarchar(max)) + N'x') - 1"); // fix round 1: no 4000 truncation
    expect(msValue(parseCanonical('Avg([i])'), ctx).sql).toBe('AVG(CAST(a0.[i] AS float))');
    expect(msValue(parseCanonical('Round([n], 1)'), ctx).sql).toContain('FLOOR(');
  });
  it('a condition as a value is -1/0; Xor keeps Null', () => {
    expect(msValue(parseCanonical('[n] > 1'), ctx).sql).toMatch(/^CASE WHEN .* THEN -1 WHEN NOT \(.*\) THEN 0 END$/);
    expect(c('[b] Xor [n] > 1').sql).toMatch(/^\(\(.*\) AND NOT \(.*\)\) OR \(NOT \(.*\) AND \(.*\)\)$/);
  });
  it.each(['Format([d], "yyyy")', 'Val([t])', 'CDate([t])', 'StrComp([a], [b])', 'DateDiff("ww", [d], [d])', 'DatePart("ww", [d])'])
  ('refuses %s', (src) => expect(() => msValue(parseCanonical(src), ctx)).toThrow(/^bc:serverFunction\|\w+\|sqlserver$/));
  it('the closed list is C4\'s', () => { expect(MS_FUNCTIONS).toEqual(PG_FUNCTIONS); expect(MS_REFUSED).toEqual(PG_REFUSED); });
  it('identifiers are quoted exactly', () => expect(msIdent('Clients] 2026')).toBe('[Clients]] 2026]')); // Review Focus 3
  it('text sorts fold in French, then exact', () => {
    expect(msOrderKeys({ sql: 'q.[c0]', params: [] }, 'shortText', 'asc').sql).toBe('CAST(q.[c0] AS nvarchar(4000)) COLLATE French_100_CI_AS ASC, CAST(q.[c0] AS nvarchar(4000)) COLLATE Latin1_General_100_BIN2 ASC');
  });
});

describe('collation (R8)', () => {
  it('In, Between, Like and a query parameter follow the same rule', () => {
    expect(c('[Code] In ("a", "b")').sql).toBe(`${N('a0.[Code]')} ${CI} IN (@p0 ${CI}, @p1 ${CI})`);
    expect(c('[Ville] Between "a" And "m"').sql).toBe('a0.[Ville] BETWEEN @p0 AND @p1');
    expect(c('[Code] Like "a*"').sql).toBe(`${N('a0.[Code]')} ${CI} LIKE @p0 ${CI}`);
    expect(c('[Ville] = [P]').sql).toBe('a0.[Ville] = @p0');
  });
  it('an expression or a case-sensitive database gets the CI collation; two values take the database\'s', () => {
    expect(c('UCase([Code]) = "A"').sql).toBe(`${N('UPPER(a0.[Code])')} ${CI} = @p0 ${CI}`);
    expect(c('"a" = "A"').sql).toBe('@p0 = @p1');
    expect(c('"a" = "A"', { dbCi: false }).sql).toBe(`@p0 ${CI} = @p1 ${CI}`);
    expect(c('[Ville] = "a"', { dbCi: false }).sql).toBe('a0.[Ville] = @p0'); // the value takes the column's collation
  });
  it('two _CI_AS columns compare plain only under one known collation name (else error 468)', () => {
    expect(c('[Ville] = [Ville3]').sql).toBe('a0.[Ville] = a0.[Ville3]');
    expect(c('[Ville] = [Ville2]').sql).toBe(`${N('a0.[Ville]')} ${CI} = ${N('a0.[Ville2]')} ${CI}`);
    expect(c('[Ville] = [t]').sql).toBe(`${N('a0.[Ville]')} ${CI} = ${N('a0.[t]')} ${CI}`); // [t]'s name unknown
    expect(c('[t] = "a"').sql).toBe('a0.[t] = @p0'); // one column against a value: as before
    expect(c('[Ville] In ([Ville3], [Ville2])').sql).toBe(`${N('a0.[Ville]')} ${CI} IN (${N('a0.[Ville3]')} ${CI}, ${N('a0.[Ville2]')} ${CI})`);
  });
  it('an output alias carrying parameters is an expression, not a value: no plain compare, no Like pattern', () => {
    const alias = { resolve: (e: Parameters<MsExprCtx['resolve']>[0]) => (e.k === 'id' && e.name === 'X'
      ? { sql: 'CONCAT(a0.[Code], @?)', type: 'shortText' as const, ci: false, params: [{ value: 'a', cast: 'nvarchar' as const }] } : ctx.resolve(e)) };
    expect(c('[X] = "abc"', alias).sql).toBe(`${N('CONCAT(a0.[Code], @p0)')} ${CI} = @p1 ${CI}`);
    expect(() => c('[Ville] Like [X]', alias)).toThrow('bc:serverFunction|Like|sqlserver');
  });
  it('InStr and Replace compare in the CI collation on a case-sensitive column', () => {
    expect(v('Replace([Code], "a", "b")').sql).toBe(`REPLACE(${N('a0.[Code]')} ${CI}, @p0 ${CI}, @p1)`);
    expect(v('InStr([Ville], "a")').sql).toBe("CASE WHEN LEN(CAST(@p0 AS nvarchar(max)) + N'x') - 1 = 0 AND LEN(CAST(a0.[Ville] AS nvarchar(max)) + N'x') - 1 >= 1 THEN 1 ELSE CHARINDEX(@p0, a0.[Ville]) END");
  });
});

describe('operators and functions', () => {
  it('a Yes/No column is -1/0 as a value, <> 0 as a condition', () => {
    expect(v('[b]').sql).toBe('-ABS(CAST(a0.[b] AS int))');
    expect(c('[b]').sql).toBe('a0.[b] <> 0');
    expect(c('[b] = True')).toEqual({ sql: '(-ABS(CAST(a0.[b] AS int))) = CAST(@p0 AS int)', params: [{ value: '-1', cast: 'int' }] });
    expect(() => c('[t]')).toThrow('bc:serverFunction|CBool|sqlserver');
  });
  it('arithmetic', () => {
    expect(v('[n] / 2').sql).toBe('CAST(a0.[n] AS float) / CAST(@p0 AS decimal(38, 0))');
    expect(v('[n] ^ 2').sql).toBe('POWER(CAST(a0.[n] AS float), CAST(@p0 AS decimal(38, 0)))');
    expect(v('[n] \\ 2').sql).toMatch(/^CAST\(CASE .* END AS bigint\) \/ CAST\(CASE .* END AS bigint\)$/);
    expect(v('[n] Mod 2').sql).toMatch(/^CAST\(CASE .* END AS bigint\) % CAST\(CASE .* END AS bigint\)$/);
    expect(v('"a" + [t]').sql).toBe('@p0 + a0.[t]');
    expect(v('-(-[n])').sql).toBe('-(-a0.[n])');
    expect(v('[d] - [d]').sql).toBe('CAST(DATEDIFF_BIG(millisecond, a0.[d], a0.[d]) AS float) / 86400000');
    expect(v('[d] + 1').sql).toContain('DATEADD(day, CAST(FLOOR(CAST(@p0 AS decimal(38, 0))) AS int), a0.[d])');
    expect(() => v('[d] * 2')).toThrow('bc:serverFunction|*|sqlserver');
  });
  it('& is CONCAT of text, AutoNumber, an integer literal', () => {
    expect(v('[t] & [ID] & 5 & Null').sql).toBe('CONCAT(CONCAT(CONCAT(a0.[t], a0.[ID]), CAST(@p0 AS decimal(38, 0))), NULL)');
    expect(() => v('[t] & [n]')).toThrow('bc:serverFunction|&|sqlserver');
  });
  it('Like with a parameter pattern, Not Like, classes and an unterminated [', () => {
    expect(c('[Ville] Like [P]')).toEqual({ sql: 'a0.[Ville] LIKE @p0', params: [{ value: 'Du%', cast: 'nvarchar' }] });
    expect(c('[Ville] Not Like "[a-c]*"').sql).toBe('NOT (a0.[Ville] LIKE @p0)');
    expect(c('[Ville] Like "a[*]b?[^x][!]"').params[0]!.value).toBe('a[*]b_[x^][!]');
    expect(c('[Ville] Like "x[]y"').params[0]!.value).toBe('xy');
    expect(() => c('[Ville] Like "a[bc"')).toThrow('bc:serverFunction|Like|sqlserver');
    expect(() => c('[n] Like "1*"')).toThrow('bc:serverFunction|Like|sqlserver');
  });
  it('IIf, Nz, IsNull', () => {
    expect(v('IIf([n] > 1, [t], Null)').sql).toBe('CASE WHEN a0.[n] > CAST(@p0 AS decimal(38, 0)) THEN a0.[t] ELSE NULL END');
    expect(v('Nz([t])').sql).toBe("COALESCE(a0.[t], N'')");
    expect(v('Nz([n], 2)').sql).toBe('COALESCE(a0.[n], CAST(@p0 AS decimal(38, 0)))');
    expect(() => v('Nz([d])')).toThrow('bc:serverFunction|Nz|sqlserver');
    expect(v('IsNull([n])').sql).toBe('CASE WHEN a0.[n] IS NULL THEN -1 WHEN NOT (a0.[n] IS NULL) THEN 0 END');
  });
  it('text functions', () => {
    expect(v('Left([t], 2)').sql).toBe('LEFT(a0.[t], CAST(@p0 AS int))');
    expect(v('Mid([t], 2)').sql).toBe('SUBSTRING(a0.[t], CAST(@p0 AS int), 2147483647)');
    expect(v('Trim([t])').sql).toBe('LTRIM(RTRIM(a0.[t]))');
    expect(v('String(3, [t])').sql).toBe('REPLICATE(LEFT(a0.[t], 1), CAST(@p0 AS int))');
    expect(v('Space(2)').sql).toBe('SPACE(CAST(@p0 AS int))');
  });
  it('InStr with a start: an empty text found within the text, a start below 1 is an error', () => {
    expect(v('InStr(2, [t], "a")').sql).toBe("CASE WHEN LEN(CAST(@p0 AS nvarchar(max)) + N'x') - 1 = 0 AND LEN(CAST(a0.[t] AS nvarchar(max)) + N'x') - 1 >= CAST(@p1 AS int) THEN CAST(@p1 AS int) "
      + 'ELSE CHARINDEX(@p0, a0.[t], CAST(@p1 AS int)) END');
    expect(() => v('InStr(0, [t], "a")')).toThrow(new ExprRuntimeError('badArgument'));
    expect(v('InStr([n], [t], "a")').sql).toMatch(/^CASE WHEN CAST\(.* AS int\) < 1 THEN CAST\(CONCAT\(N'badArgument: InStr start ', CAST\(.* AS int\)\) AS int\) WHEN LEN/);
  });
  it('conversions round as Access', () => {
    expect(v('CInt([n])').sql).toMatch(/^CAST\(CASE WHEN .* END AS int\)$/);
    expect(v('CLng([n])').sql).toMatch(/^CAST\(CASE WHEN .* END AS bigint\)$/);
    expect(v('CDbl([n])').sql).toBe('CAST(a0.[n] AS float)');
    expect(c('CBool([n])').sql).toBe('a0.[n] <> 0');
    const y = 'CAST(a0.[n] AS decimal(38, 10))', fy = `CAST(FLOOR(${y}) AS decimal(38, 10))`;
    expect(v('Round([n])').sql).toBe(`CASE WHEN ${y} - ${fy} = 0.5 THEN (CASE WHEN ${fy} % 2 = 0 THEN ${fy} ELSE ${fy} + 1 END) ELSE ROUND(${y}, 0) END`);
    expect(v('Int([n])').sql).toBe('FLOOR(a0.[n])');
    expect(v('Fix([n])').sql).toBe('ROUND(a0.[n], 0, 1)');
  });
  const W = (x: string) => `CAST(${x} AS datetime2(0))`;
  it('date functions', () => {
    expect(v('Now()').params).toEqual([{ value: '2026-10-31T14:05:09', cast: 'datetime2(0)' }]);
    expect(v('Time()').params).toEqual([{ value: '1899-12-30T14:05:09', cast: 'datetime2(0)' }]);
    expect(v('#2026-10-31 10:00:00#').params).toEqual([{ value: '2026-10-31T10:00:00', cast: 'datetime2(0)' }]);
    expect(v('Year([d])').sql).toBe(`DATEPART(year, ${W('a0.[d]')})`);
    expect(v('Weekday([d], 2)').sql).toBe(`((DATEPART(weekday, ${W('a0.[d]')}) + 5) % 7) + 1`);
    expect(() => v('Weekday([d], [n])')).toThrow('bc:serverFunction|Weekday|sqlserver');
    expect(v('DateAdd("w", 1, [d])').sql).toBe(`DATEADD(day, CAST(@p0 AS int), ${W('a0.[d]')})`);
    expect(v('DateAdd("q", 1, [d])').sql).toBe(`DATEADD(quarter, CAST(@p0 AS int), ${W('a0.[d]')})`);
    expect(() => v('DateAdd("constructor", 1, [d])')).toThrow('bc:serverFunction|DateAdd|sqlserver');
    expect(v('DateDiff("m", [d], [d])').sql).toBe(`DATEDIFF(month, ${W('a0.[d]')}, ${W('a0.[d]')})`);
    expect(v('DateDiff("s", [d], [d])').sql).toBe(`DATEDIFF_BIG(second, ${W('a0.[d]')}, ${W('a0.[d]')})`);
    expect(() => v('DateDiff("w", [d], [d])')).toThrow('bc:serverFunction|DateDiff|sqlserver');
    expect(v('DatePart("w", [d])').sql).toBe(`DATEPART(weekday, ${W('a0.[d]')})`);
    expect(v('DatePart("y", [d])').sql).toBe(`DATEPART(dayofyear, ${W('a0.[d]')})`);
    expect(() => v('DatePart("__proto__", [d])')).toThrow('bc:serverFunction|DatePart|sqlserver');
    expect(v('DateSerial(26, 2, 1)')).toEqual({
      sql: 'DATEADD(day, CAST(@p0 AS int) - 1, DATEADD(month, CAST(@p1 AS int) - 1, CAST(DATEFROMPARTS(CAST(@p2 AS int), 1, 1) AS datetime2(0))))',
      params: [{ value: '1', cast: 'int' }, { value: '2', cast: 'int' }, { value: '2026', cast: 'int' }] });
    expect(v('TimeSerial(1, 2, 3)').sql)
      .toBe("DATEADD(second, CAST(@p0 AS int), DATEADD(minute, CAST(@p1 AS int), DATEADD(hour, CAST(@p2 AS int), CAST('1899-12-30' AS datetime2(0)))))");
  });
  it('aggregates', () => {
    expect(v('Count(*)').sql).toBe('COUNT(*)');
    expect(v('Sum([i])').sql).toBe('SUM(a0.[i] + CAST(0 AS bigint))');
    expect(v('Avg([m])').sql).toBe('AVG(a0.[m])'); // Currency stays exact
    // a Decimal field too, at bind.ts' Avg scale: decimal(10, 2) → min(2 + 19, 28 - 8) = 20; Decimal(19, 0) (a bigint) → 9
    expect(v('Avg([n])', { resolve: (e) => ({ ...ctx.resolve(e), precision: 10, scale: 2 }) }).sql).toBe('AVG(CAST(a0.[n] AS decimal(38, 20)))');
    expect(v('Avg([n])', { resolve: (e) => ({ ...ctx.resolve(e), precision: 19, scale: 0 }) }).sql).toBe('AVG(CAST(a0.[n] AS decimal(38, 9)))');
    expect(v('Avg([n] * 2)', { resolve: (e) => ({ ...ctx.resolve(e), scale: 2 }) }).sql).toBe('AVG(CAST(a0.[n] * CAST(@p0 AS decimal(38, 0)) AS float))');
    expect(v('StDevP([n])').sql).toBe('STDEVP(a0.[n])');
    expect(() => v('First([n])')).toThrow('bc:serverFunction|First|sqlserver');
  });
  it('a subquery without a generator is refused', () => {
    expect(() => msCondition({ k: 'sub', mode: 'exists', q: {} as SelectQuery }, ctx)).toThrow('bc:serverNotSupported|other|sqlserver');
  });
});

describe('msNumber', () => {
  it('numbers each marker in order, never inside an identifier or a literal', () => {
    const f = { sql: "[a@?] = @? AND x = N'@?' AND y > CAST(@? AS int)", params: [{ value: 'A', cast: 'nvarchar' as const }, { value: '2', cast: 'int' as const }] };
    expect(msNumber(f, 3)).toEqual({ sql: "[a@?] = @p3 AND x = N'@?' AND y > CAST(@p4 AS int)", params: f.params });
  });
  it('equal parameters share a name; another cast, or Null against the text null, does not', () => {
    const f = { sql: '@? @? CAST(@? AS int) @? @?', params: [{ value: '1', cast: 'nvarchar' as const }, { value: '1', cast: 'nvarchar' as const },
      { value: '1', cast: 'int' as const }, { value: null, cast: 'nvarchar' as const }, { value: 'null', cast: 'nvarchar' as const }] };
    expect(msNumber(f).sql).toBe('@p0 @p0 CAST(@p1 AS int) @p2 @p3');
  });
  it('markers and parameters must agree', () => expect(() => msNumber({ sql: '@?', params: [] })).toThrow('msNumber: 1 markers, 0 parameters'));
});

describe('msOrderKeys', () => {
  it('descending text, other types sort once (a Yes/No value is already -1/0)', () => {
    expect(msOrderKeys({ sql: 'q.[c0]', params: [] }, 'longText', 'desc').sql).toBe('CAST(q.[c0] AS nvarchar(max)) COLLATE French_100_CI_AS DESC, CAST(q.[c0] AS nvarchar(max)) COLLATE Latin1_General_100_BIN2 DESC');
    expect(msOrderKeys({ sql: 'a + b', params: [] }, 'number', 'asc').sql).toBe('(a + b) ASC');
  });
});
