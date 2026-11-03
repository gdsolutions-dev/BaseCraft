import { describe, expect, it } from 'vitest';
import { ExprRuntimeError } from '../../../shared/expr/ast';
import { FUNCTIONS } from '../../../shared/expr/catalog';
import { parseCanonical } from '../../../shared/expr/parser';
import type { FieldType } from '../../../shared/field-types';
import { exprType, type BoundQuery } from '../../../shared/query/bind';
import { PG_FUNCTIONS, PG_REFUSED, pgCondition, pgIdent, pgNumber, pgOrderKeys, pgValue, type PgExprCtx } from './sql-expr';

const TYPES: Record<string, FieldType> = {
  Ville: 'shortText', Nom: 'shortText', Code: 'shortText', Motif: 'shortText', t: 'shortText', a: 'shortText', b: 'shortText',
  Date: 'dateTime', d: 'dateTime', n: 'number', m: 'currency', ID: 'autoNumber', Actif: 'yesNo',
};
// exprType's rules over a stub binding: every [name] of TYPES is a column, [P] a numeric parameter.
const stub = { refs: { get: (e: { k: string; name?: string }) => (e.k === 'id' && TYPES[e.name!] ? { kind: 'column', type: TYPES[e.name!] } : undefined) },
  params: [], selects: new Map() } as unknown as BoundQuery;
const ctx: PgExprCtx = {
  resolve: (e) => (e.k === 'id' && e.name === 'P' ? { sql: '$1::text', type: 'shortText', params: [{ value: 'Du*', cast: 'text' }], param: true }
    : { sql: pgIdent(e.k === 'id' ? e.name : e.path.join('.')), type: e.k === 'id' ? TYPES[e.name] ?? null : null }),
  typeOf: (e) => exprType(e, stub),
  now: new Date(2026, 9, 30, 14, 5, 9),
};
const c = (src: string, o?: Partial<PgExprCtx>) => pgCondition(parseCanonical(src), { ...ctx, ...o });
const v = (src: string, o?: Partial<PgExprCtx>) => pgValue(parseCanonical(src), { ...ctx, ...o });

describe('brief', () => {
  it('text comparisons ignore case, values are parameters', () => {
    expect(c('[Ville] = "Lyon"')).toEqual({ sql: 'lower("Ville") = lower($1::text)', params: [{ value: 'Lyon', cast: 'text' }] });
  });
  it('Like: * and ? as ILIKE, # and […] as an anchored regular expression', () => {
    expect(c('[Nom] Like "Du*"').sql).toBe('"Nom" ILIKE $1::text'); expect(c('[Nom] Like "Du*"').params[0].value).toBe('Du%');
    expect(c('[Nom] Like "50%*"').params[0].value).toBe('50\\%%');
    expect(c('[Code] Like "A#[!x-z]"').sql).toBe('"Code" ~* $1::text'); expect(c('[Code] Like "A#[!x-z]"').params[0].value).toBe('^A[0-9][^x-z]$');
    expect(() => c('[Nom] Like [Motif]')).toThrow('bc:serverFunction|Like|postgresql');
  });
  it('& joins text, refuses a date', () => {
    expect(v('[Nom] & " " & [Ville]').sql).toBe('concat(concat("Nom", $1::text), "Ville")');
    expect(() => v('[Nom] & [Date]')).toThrow('bc:serverFunction|&|postgresql');
  });
  it('Date() is the workstation clock, bound', () => {
    expect(v('Date()', { now: new Date(2026, 9, 30, 14, 5) }).params).toEqual([{ value: '2026-10-30 00:00:00', cast: 'timestamp' }]);
  });
  it('Round is banker\'s rounding', () => { expect(v('Round([n], 1)').sql).toContain('mod(floor('); });
  it.each(['Format([d], "yyyy")', 'Val([t])', 'CDate([t])', 'IsNumeric([t])', 'StrComp([a], [b])', 'DateDiff("ww", [d], [d])'])
  ('refuses %s', (src) => expect(() => v(src)).toThrow(/^bc:serverFunction\|\w+\|postgresql$/));
  it('every catalog function is either translated or refused, none unknown', () => {
    for (const f of FUNCTIONS) expect(PG_FUNCTIONS.has(f.name) !== PG_REFUSED.has(f.name)).toBe(true);
    expect([PG_FUNCTIONS.size, PG_REFUSED.size]).toEqual([51, 9]);
  });
  it('a condition used as a value is -1/0', () => expect(v('[n] > 1').sql).toBe('CASE WHEN "n" > $1::numeric THEN -1 WHEN NOT ("n" > $1::numeric) THEN 0 END'));
  it('identifiers are quoted exactly', () => expect(pgIdent('O"Brien 2026')).toBe('"O""Brien 2026"'));
  it('ascending text sorts fold case, Null first, then exact', () => {
    expect(pgOrderKeys({ sql: '"Nom"', params: [] }, 'shortText', 'asc', 'fr-x-icu').sql).toBe('lower("Nom") COLLATE "fr-x-icu" ASC NULLS FIRST, "Nom" COLLATE "C" ASC');
  });
});

describe('operators and functions', () => {
  it('a repeated parameter is one PgParam per occurrence', () => {
    expect(v('[n] > 1').params).toEqual([{ value: '1', cast: 'numeric' }, { value: '1', cast: 'numeric' }]);
  });
  it('operands keep their precedence', () => {
    expect(c('[n] + 1 > [m] * 2 Or Not [Actif]').sql)
      .toBe('(("n" + $1::numeric) > ("m" * $1::numeric)) OR (NOT ((-abs("Actif"::int4)) <> 0))');
  });
  it('ordering text comparisons and Between use the collation', () => {
    expect(c('[Nom] < "m"', { collation: 'fr-x-icu' }).sql).toBe('lower("Nom") COLLATE "fr-x-icu" < lower($1::text)');
    expect(c('[Nom] Between "a" And "m"').sql).toBe('lower("Nom") BETWEEN lower($1::text) AND lower($1::text)');
    expect(c('[n] Not Between 1 And 2').sql).toBe('"n" NOT BETWEEN $1::numeric AND $1::numeric');
  });
  it('In, Is Null, Xor', () => {
    expect(c('[Ville] In ("Lyon", "Paris")').sql).toBe('lower("Ville") IN (lower($1::text), lower($1::text))');
    expect(c('[n] Is Not Null').sql).toBe('"n" IS NOT NULL');
    expect(c('[n] > 1 Xor [n] < 5').sql).toBe('("n" > $1::numeric) <> ("n" < $1::numeric)');
  });
  it('comparing text with a number or a date is refused, Null compares with anything', () => {
    expect(() => c('[Nom] = 1')).toThrow('bc:serverFunction|=|postgresql');
    expect(() => c('[d] > "2026-01-01"')).toThrow('bc:serverFunction|>|postgresql');
    expect(c('[d] = Null').sql).toBe('"d" = NULL');
  });
  it('a Yes/No value is -1/0, as Access', () => {
    expect(c('[Actif] = True').sql).toBe('(-abs("Actif"::int4)) = $1::int4');
    expect(c('[Actif] = True').params).toEqual([{ value: -1, cast: 'int4' }]);
    expect(c('[Actif]').sql).toBe('(-abs("Actif"::int4)) <> 0');
    expect(() => c('[Nom]')).toThrow('bc:serverFunction|CBool|postgresql');
  });
  it('arithmetic on dates and division', () => {
    expect(v('[d] + 1').sql).toBe('"d" + $1::numeric * interval \'1 day\'');
    expect(v('[d] - [d]').sql).toBe('extract(epoch from "d" - "d") / 86400');
    expect(v('[n] / 2').sql).toBe('"n"::float8 / $1::numeric');
    expect(v('"a" + [Nom]').sql).toBe('$1::text || "Nom"');
    expect(() => v('[d] * 2')).toThrow('bc:serverFunction|*|postgresql');
  });
  it('& takes an AutoNumber and an integer literal, refuses another number', () => {
    expect(v('[Nom] & [ID] & 5 & Null').sql).toBe('concat(concat(concat("Nom", "ID"), $1::numeric), NULL::text)');
    expect(() => v('[Nom] & [n]')).toThrow('bc:serverFunction|&|postgresql');
  });
  it('Like with a parameter pattern translates its value; Not Like', () => {
    expect(c('[Nom] Like [P]')).toEqual({ sql: '"Nom" ILIKE $1::text', params: [{ value: 'Du%', cast: 'text' }] });
    expect(c('[Nom] Not Like "[a-c]*"').sql).toBe('NOT ("Nom" ~* $1::text)');
    expect(c('[Nom] Like "a.[*]b?"').params[0].value).toBe('^a\\.[*]b.$');
    expect(() => c('[n] Like "1*"')).toThrow('bc:serverFunction|Like|postgresql');
    // an output alias carrying a parameter ("a" in [Code] & "a") is an expression: refused as a pattern, as a column is
    expect(() => c('[Nom] Like [X]', { resolve: (e) => (e.k === 'id' && e.name === 'X' ? { sql: '(concat("Code", $1::text))', type: 'shortText', params: [{ value: 'a', cast: 'text' }] }
      : ctx.resolve(e)) })).toThrow('bc:serverFunction|Like|postgresql');
  });
  it('IIf, Nz, IsNull', () => {
    expect(v('IIf([n] > 1, [Nom], Null)').sql).toBe('CASE WHEN "n" > $1::numeric THEN "Nom" ELSE NULL END');
    expect(() => v('IIf([n] > 1, [Nom], 2)')).toThrow('bc:serverFunction|IIf|postgresql');
    expect(v('Nz([Nom])').sql).toBe('coalesce("Nom", \'\')');
    expect(v('Nz([n], 2)').sql).toBe('coalesce("n", $1::numeric)');
    expect(c('IsNull([n])').sql).toBe('"n" IS NULL');
  });
  it('text functions', () => {
    expect(v('Left([Nom], 2)').sql).toBe('left("Nom", $1::int4)');
    expect(v('Mid([Nom], 2)').sql).toBe('substr("Nom", $1::int4)');
    expect(v('Trim([Nom])').sql).toBe('btrim("Nom", \' \')');
    expect(v('String(3, [Nom])').sql).toBe('repeat(left("Nom", 1), $1::int4)');
  });
  it('InStr as the evaluator: an empty text is found only within the text, a start below 1 is an error', () => {
    expect(v('InStr([Nom], "a")').sql).toBe('CASE WHEN char_length("Nom") = 0 AND char_length($1::text) = 0 THEN 0 ELSE strpos(lower("Nom"), lower($1::text)) END');
    const i = v('InStr(2, [Nom], "a")');
    expect(i.sql).toBe('CASE WHEN char_length($1::text) = 0 AND $1::int4 > char_length("Nom") THEN 0 '
      + 'WHEN strpos(lower(substr("Nom", $1::int4)), lower($1::text)) = 0 THEN 0 '
      + 'ELSE strpos(lower(substr("Nom", $1::int4)), lower($1::text)) + $1::int4 - 1 END');
    expect(i.params.map((p) => p.value)).toEqual(['a', 2, 2, 'a', 2, 'a', 2]);
    expect(() => v('InStr(0, [Nom], "a")')).toThrow(new ExprRuntimeError('badArgument'));
    expect(v('InStr([n], [Nom], "a")').sql).toMatch(/^CASE WHEN CASE .* END::int4 < 1 THEN \('badArgument: InStr start ' \|\| CASE .* END::int4\)::int4 WHEN char_length/);
  });
  it('conversions and integer operators round as Access', () => {
    expect(v('CInt([n])').sql).toMatch(/^CASE WHEN .* END::int4$/);
    expect(v('CDbl([n])').sql).toBe('"n"::float8');
    expect(c('CBool([n])').sql).toBe('"n" <> 0');
    const bank = (x: string) => `CASE WHEN (${x}::numeric) - floor(${x}::numeric) = 0.5 THEN (CASE WHEN mod(floor(${x}::numeric), 2) = 0 `
      + `THEN floor(${x}::numeric) ELSE floor(${x}::numeric) + 1 END) ELSE round(${x}::numeric) END`;
    expect(v('[n] \\ 2').sql).toBe(`div(${bank('"n"')}, ${bank('$1::numeric')})`);
    expect(v('[n] Mod 2').sql).toBe(`mod(${bank('"n"')}, ${bank('$1::numeric')})`);
  });
  const W = (x: string) => `date_trunc('second', ${x} + interval '0.5 second')`; // a date's parts read at the nearest second
  it('date functions', () => {
    expect(v('Now()').params).toEqual([{ value: '2026-10-30 14:05:09', cast: 'timestamp' }]);
    expect(v('Time()').params).toEqual([{ value: '1899-12-30 14:05:09', cast: 'timestamp' }]);
    expect(v('Year([d])').sql).toBe(`extract(year from ${W('"d"')})::int4`);
    expect(v('Second(#2026-10-30 10:59:59#)').sql).toBe(`extract(second from ${W('$1::timestamp')})::int4`);
    expect(v('Weekday([d], 2)')).toEqual({ sql: `mod(extract(dow from ${W('"d"')})::int4 + $1::int4, 7) + 1`, params: [{ value: 6, cast: 'int4' }] });
    expect(() => v('Weekday([d], [n])')).toThrow('bc:serverFunction|Weekday|postgresql');
    expect(v('DateAdd("m", 1, [d])').sql).toBe(`${W('"d"')} + make_interval(months => $1::int4)`);
    expect(v('DateAdd("yyyy", 1, [d])').sql).toBe(`${W('"d"')} + make_interval(months => $1::int4 * 12)`);
    expect(v('DateAdd("q", 1, [d])').sql).toBe(`${W('"d"')} + make_interval(months => $1::int4 * 3)`);
    expect(v('DateAdd("ww", 1, [d])').sql).toBe(`${W('"d"')} + make_interval(weeks => $1::int4)`);
    expect(() => v('DateAdd([Nom], 1, [d])')).toThrow('bc:serverFunction|DateAdd|postgresql');
    expect(() => v('DateAdd("constructor", 1, [d])')).toThrow('bc:serverFunction|DateAdd|postgresql');
    expect(v('DateDiff("d", [d], [Date])').sql).toBe(`${W('"Date"')}::date - ${W('"d"')}::date`);
    expect(v('DateDiff("h", [d], [Date])').sql)
      .toBe(`(extract(epoch from date_trunc('hour', ${W('"Date"')}) - date_trunc('hour', ${W('"d"')})) / 3600)::int8`);
    const ext = (f: string, x: string) => `extract(${f} from ${W(x)})::int4`;
    expect(v('DateDiff("yyyy", [d], [Date])').sql).toBe(`${ext('year', '"Date"')} - ${ext('year', '"d"')}`);
    expect(v('DateDiff("q", [d], [Date])').sql)
      .toBe(`(${ext('year', '"Date"')} * 4 + ${ext('quarter', '"Date"')}) - (${ext('year', '"d"')} * 4 + ${ext('quarter', '"d"')})`);
    expect(v('DateDiff("m", [d], [Date])').sql)
      .toBe(`(${ext('year', '"Date"')} * 12 + ${ext('month', '"Date"')}) - (${ext('year', '"d"')} * 12 + ${ext('month', '"d"')})`);
    expect(v('DatePart("w", [d])').sql).toBe(`${ext('dow', '"d"')} + 1`);
    expect(() => v('DatePart("ww", [d])')).toThrow('bc:serverFunction|DatePart|postgresql');
    expect(() => v('DatePart("__proto__", [d])')).toThrow('bc:serverFunction|DatePart|postgresql');
    expect(() => v('DatePart("toString", [d])')).toThrow('bc:serverFunction|DatePart|postgresql');
    expect(v('DateSerial(26, 2, 1)').params[0]).toEqual({ value: 2026, cast: 'int4' });
    expect(v('TimeSerial(1, 2, 3)').sql).toBe('timestamp \'1899-12-30\' + make_interval(hours => $1::int4, mins => $1::int4, secs => $1::int4)');
  });
  it('Nz of a date has no Empty to give: refused', () => {
    expect(() => v('Nz([d])')).toThrow('bc:serverFunction|Nz|postgresql');
  });
  it('an unterminated [ in a Like pattern is refused (Access: an error in every row)', () => {
    expect(() => c('[Nom] Like "a[bc"')).toThrow('bc:serverFunction|Like|postgresql');
  });
  it('aggregates', () => {
    expect(v('Count(*)').sql).toBe('count(*)');
    expect(v('StDevP([n])').sql).toBe('stddev_pop("n")');
    expect(() => v('First([n])')).toThrow('bc:serverFunction|First|postgresql');
  });
});

describe('pgNumber', () => {
  it('numbers each marker in order, never inside an identifier or a literal', () => {
    const f = { sql: 'lower("a$1::text") = lower($1::text) AND btrim("x", \'$1::\') > $1::numeric', params: [{ value: 'A', cast: 'text' as const }, { value: 2, cast: 'numeric' as const }] };
    expect(pgNumber(f, 3)).toEqual({ sql: 'lower("a$1::text") = lower($3::text) AND btrim("x", \'$1::\') > $4::numeric', params: f.params });
  });
  it('equal parameters share a number; another cast or value type does not', () => {
    expect(pgNumber(v('Left([t], 1) & Left([t], 1) & Left([t], 2)')).sql).toBe('concat(concat(left("t", $1::int4), left("t", $1::int4)), left("t", $2::int4))');
    const f = { sql: '$1::numeric $1::int4 $1::numeric', params: [{ value: '1', cast: 'numeric' as const }, { value: 1, cast: 'int4' as const }, { value: 1, cast: 'numeric' as const }] };
    expect(pgNumber(f).sql).toBe('$1::numeric $2::int4 $3::numeric');
  });
  it('NaN and Infinity never share a number with Null', () => {
    const f = { sql: '$1::float8 $1::float8 $1::float8 $1::float8', params: [null, NaN, Infinity, -Infinity].map((value) => ({ value, cast: 'float8' as const })) };
    expect(pgNumber(f).params.map((x) => x.value)).toEqual([null, NaN, Infinity, -Infinity]);
  });
  it('markers and parameters must agree', () => expect(() => pgNumber({ sql: '$1::text', params: [] })).toThrow('pgNumber: 1 markers, 0 parameters'));
});

describe('pgOrderKeys', () => {
  it('descending puts Null last; no collation found keeps the column\'s own; other types sort once', () => {
    expect(pgOrderKeys({ sql: '"Nom"', params: [] }, 'shortText', 'desc', null).sql).toBe('lower("Nom") DESC NULLS LAST, "Nom" COLLATE "C" DESC');
    expect(pgOrderKeys({ sql: '"a" + "b"', params: [] }, 'number', 'asc', 'fr-x-icu').sql).toBe('("a" + "b") ASC NULLS FIRST');
  });
});
