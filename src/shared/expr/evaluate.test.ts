import { describe, expect, it } from 'vitest';
import type { Value } from './ast';
import { FUNCTIONS } from './catalog';
import { evaluate, fromStored, recordFields, toStored, truthy, type EvalEnv } from './evaluate';
import { bool, compareText, date, fromSerial, LIBRARY, likeMatch, num, str, toSerial } from './library';
import { parseCanonical } from './parser';
import { coerce } from '../coerce';
import { localeInfo } from '../locale-format';
import { f } from '../test-fixtures';
import type { FieldType } from '../field-types';

const NOW = new Date(2026, 9, 21, 14, 5, 0);
const env = (fields: Record<string, Value> = {}, subject?: Value): EvalEnv =>
  ({ field: recordFields(fields), subject, now: () => NOW, locale: 'fr-FR' });
const plain = (v: Value): unknown => (v === null ? null : v.t === 'empty' ? '<empty>' : v.t === 'date' ? fromSerial(v.v) : v.v);
const ev = async (src: string, e: EvalEnv = env({ A: null })): Promise<unknown> => plain(await evaluate(parseCanonical(src), e));
const fails = (src: string, code: string, e: EvalEnv = env()) =>
  expect(evaluate(parseCanonical(src), e)).rejects.toMatchObject({ code });

describe('evaluate (brief)', () => {
  it.each([
    ['1 + 2 * 3', 7], ['-2 ^ 2', -4], ['7 \\ 2', 3], ['7.5 \\ 2', 4 /* 7.5 -> 8 bancaire */], ['8.5 Mod 3', 2 /* 8 Mod 3 */],
    ['"a" & Null & 1', 'a1'], ['Null + 1', null], ['"3" + 4', 7], ['"a" + "b"', 'ab'], ['Round(2.5)', 2], ['Round(3.5)', 4], ['Round(1.2345, 2)', 1.23],
    ['IIf(Null, 1, 2)', 2], ['Nz(Null, "x")', 'x'], ['Len("Été")', 3], ['UCase("été")', 'ÉTÉ'], ['Mid("abcdef", 2, 3)', 'bcd'],
    ['InStr("Bonjour", "jour")', 4], ['"abc" = "ABC"', true], ['"é" = "e"', false], ['Null = Null', null],
    ['Null And False', false], ['Null Or True', true], ['True + 0', -1],
    ['"Dupont" Like "d*"', true], ['"A1" Like "[A-C]#"', true], ['"x" Like "[!a-z]"', false],
    ['#2026-10-21# + 30', '2026-11-20 00:00:00'], ['DateDiff("d", #2026-10-01#, #2026-10-21#)', 20],
    ['Year(Date())', 2026], ['5 Between 1 And 5', true], ['3 In (1, 2, 3)', true], ['[A] Is Null', true],
  ])('%s', async (src, expected) => expect(await ev(src)).toEqual(expected));

  it('errors', async () => {
    await fails('1 / 0', 'divByZero');
    await fails('"x" * 2', 'typeMismatch');
  });

  it('truthy', () => {
    expect(truthy(null)).toBeNull(); expect(truthy(num(0))).toBe(false); expect(truthy(num(-1))).toBe(true);
    expect(truthy(bool(false))).toBe(false); expect(truthy(str('1'))).toBe(true); expect(truthy(str('0'))).toBe(false);
    expect(truthy(date(0))).toBe(false); expect(truthy(date(1.5))).toBe(true);
    expect(truthy(str('True'))).toBe(true); expect(truthy(str('faux'))).toBe(false); expect(truthy({ t: 'empty' })).toBe(false);
    expect(truthy(str('0,0'), localeInfo('fr-FR'))).toBe(false); expect(truthy(str('1,5'), localeInfo('fr-FR'))).toBe(true);
    expect(() => truthy(str('x'))).toThrow(expect.objectContaining({ code: 'typeMismatch' }));
  });
});

describe('operators', () => {
  it.each([
    ['10 / 4', 2.5], ['2 ^ 10', 1024], ['-7 \\ 2', -3], ['-7 Mod 3', -1], ['7 Mod 2.5', 1 /* 7 Mod 2 */], ['0.1 + 0.2 = 0.3', false],
    ['Null & Null', ''], ['1.5 & ""', '1,5'], ['True & ""', 'True'], ['"1,5" + 1', 2.5], ['Null * 2', null], ['-Null', null],
    ['#2026-10-21# - #2026-10-01#', 20], ['#2026-10-21# - 1', '2026-10-20 00:00:00'], ['1 + #2026-10-21#', '2026-10-22 00:00:00'],
    ['#2026-10-21 12:00:00# + 0.25', '2026-10-21 18:00:00'],
    ['"b" > "A"', true], ['"a" < "B"', true], ['"Été" = "été"', true], ['#1899-12-31# = 1', true], ['#2026-10-21# > #2026-10-20#', true],
    ['1 < Null', null], ['5 = "5"', true], ['True = -1', true], ['1 <> 2', true], ['2 >= 2', true], ['3 <= 2', false],
    ['#2026-10-21# = "21/10/2026"', true],
  ])('%s', async (src, expected) => expect(await ev(src)).toEqual(expected));

  it('runtime errors', async () => {
    await fails('7 Mod 0', 'divByZero'); await fails('7 \\ 0', 'divByZero'); await fails('"a" = 1', 'typeMismatch');
    await fails('"a" + 1', 'typeMismatch'); await fails('10 ^ 400', 'overflow');
  });

  // Logique à trois valeurs d'Access : T, F, N (Null).
  const V: Record<string, string> = { T: 'True', F: 'False', N: 'Null' };
  const P: Record<string, boolean | null> = { T: true, F: false, N: null };
  const table: Record<string, string> = { // ligne = gauche (T F N), colonne = droite (T F N)
    And: 'TFN FFF NFN', Or: 'TTT TFN TNN', Xor: 'FTN TFN NNN',
  };
  for (const [op, rows] of Object.entries(table)) {
    rows.split(' ').forEach((row, i) => [...row].forEach((out, j) => {
      const [l, r] = ['TFN'[i], 'TFN'[j]];
      it(`${V[l]} ${op} ${V[r]}`, async () => expect(await ev(`${V[l]} ${op} ${V[r]}`)).toBe(P[out]));
    }));
  }
  it.each([['Not True', false], ['Not False', true], ['Not Null', null], ['Not 0', true], ['1 And 2', true]])('%s', async (src, expected) =>
    expect(await ev(src)).toBe(expected));
});

describe('Like', () => {
  it.each([
    ['"a*c" Like "a[*]c"', true], ['"abc" Like "a[*]c"', false], ['"a?c" Like "a[?]c"', true], ['"abc" Like "a[?]c"', false],
    ['"a#" Like "a[#]"', true], ['"a1" Like "a[#]"', false], ['"[x" Like "[[]x"', true], ['"a-" Like "a[-]"', true],
    ['"été" Like "ETE"', false], ['"ÉTÉ" Like "été"', true], ['"abc" Like "ab"', false], ['"xabc" Like "abc"', false],
    ['"a.c" Like "a.c"', true], ['"abc" Like "a.c"', false], ['"a(b)$" Like "a(b)$"', true], ['"a\\b" Like "a\\b"', true],
    ['"abc" Like "a?c"', true], ['"ac" Like "a?c"', false], ['"" Like "*"', true], ['"b" Like "[a-c]"', true],
    ['"^" Like "[^a]"', true], ['"b" Like "[^a]"', false], ['"\\" Like "[\\]"', true], ['"a" Like "[]a"', true],
    ['"x" Not Like "y"', true], ['Null Like "a"', null], ['"a" Like Null', null], ['12 Like "1#"', true],
  ])('%s', async (src, expected) => expect(await ev(src)).toBe(expected));

  it('direct calls and bad patterns', async () => {
    expect(likeMatch('ab\ncd', 'ab*')).toBe(true);
    expect(likeMatch('Z', '[!a-y]')).toBe(true);
    // Pas de retour arrière exponentiel : 10 000 caractères, 6 étoiles, sans correspondance.
    const t0 = performance.now();
    expect(likeMatch('a'.repeat(10000), '*a*a*a*a*a*b')).toBe(false);
    expect(likeMatch('a'.repeat(200), '*a*a*a*a*b')).toBe(false);
    expect(performance.now() - t0).toBeLessThan(50);
    expect(likeMatch('xaybzc', '*a*b*c')).toBe(true);
    expect(likeMatch('abcabd', '*ab?')).toBe(true);
    expect(likeMatch('ab', 'a*?*b')).toBe(false);
    await fails('"abc" Like "[a"', 'badArgument');
  });

  it('text produced by & + Replace is at most 1 048 576 characters, a longer one is an overflow (never out of memory)', async () => {
    const memo = env({ Notes: str('n'.repeat(100000)) });
    expect(await ev('Len([Notes] & "x")', memo)).toBe(100001); // appending to a stored Long Text
    expect(await ev('Len([Notes] + "x")', memo)).toBe(100001);
    expect(await ev('Len(Replace([Notes], "n", "nn"))', memo)).toBe(200000);
    const big = env({ A: str('a'.repeat(1048575)) });
    expect(await ev('Len([A] & "b")', big)).toBe(1048576);
    await fails('[A] & "bc"', 'overflow', big);
    await fails('[A] + "bc"', 'overflow', big);
    // runaway nested Replace: stopped as it grows, the 131-million-character string is never built
    const t0 = performance.now();
    await fails('Len(Replace(String(65535, "a"), "a", String(2000, "b")))', 'overflow');
    await fails('Len(Replace(Replace(String(65535, "a"), "a", String(16, "b")), "b", String(2000, "c")))', 'overflow');
    expect(performance.now() - t0).toBeLessThan(2000);
    await fails('Space(65536)', 'overflow'); // Space and String keep VBA's 65535
    expect(await ev('Len(Left([A], 3))', env({ A: str('x'.repeat(100000)) }))).toBe(3);
  });
  it('Like stops with an overflow past its step budget instead of freezing; the budget grows with the texts', () => {
    const t0 = performance.now();
    expect(() => likeMatch('a'.repeat(32000), '*' + 'a'.repeat(16000) + 'b')).toThrow(expect.objectContaining({ code: 'overflow' }));
    expect(performance.now() - t0).toBeLessThan(1000);
    const lit = 'a'.repeat(79) + 'b';
    expect(likeMatch('x'.repeat(65455) + lit, '*' + lit)).toBe(true); // ~65535 characters, * then an 80-character literal
    // a 200 000-character Long Text with many partial matches: ~6 million steps, within 64 × its length
    const memo = ('a'.repeat(60) + 'c').repeat(3280) + lit;
    expect(likeMatch(memo, '*' + lit)).toBe(true);
  });
});

describe('Empty (Nz sans valeur de remplacement, A2-R7)', () => {
  it.each([
    ['Nz(Null) * 5', 0], ['Nz(Null) + 1', 1], ['Nz(Null) & "x"', 'x'], ['Nz(Null) = 0', true], ['Nz(Null) = ""', true],
    ['Nz(Null) Is Null', false], ['Not Nz(Null)', true], ['IIf(Nz(Null), 1, 2)', 2], ['Len(Nz(Null))', 0], ['Nz(Null) < 1', true],
    ['"a" > Nz(Null)', true], ['Nz(Nz(Null))', '<empty>'],
  ])('%s', async (src, expected) => expect(await ev(src)).toEqual(expected));

  it('stored', () => {
    const fr = localeInfo('fr-FR');
    expect(toStored(f('C', 'shortText'), { t: 'empty' }, fr)).toBe('');
    expect(toStored(f('C', 'number'), { t: 'empty' }, fr)).toBeNull();
    expect(toStored(f('C', 'dateTime'), { t: 'empty' }, fr)).toBeNull();
    expect(toStored(f('C', 'yesNo'), { t: 'empty' }, fr)).toBeNull();
  });
});

describe('Between, In, Is Null, fields, subject', () => {
  it.each([
    ['0 Between 1 And 5', false], ['Null Between 1 And 5', null], ['5 Not Between 1 And 4', true], ['3 Between Null And 5', null], ['5 Between 10 And 1', false /* bornes non permutées (A2-R6) */],
    ['"b" Between "A" And "C"', true], ['4 In (1, Null)', null], ['1 In (1, Null)', true], ['4 Not In (1, 2)', true],
    ['"X" In ("x", "y")', true], ['[A] Is Not Null', false], ['1 Is Null', false],
  ])('%s', async (src, expected) => expect(await ev(src)).toBe(expected));

  it('fields resolve ignoring case; unknown field fails', async () => {
    const e = env({ Prix: num(10), 'Été': str('oui') });
    expect(await ev('[prix] * 2', e)).toBe(20);
    expect(await ev('[ÉTÉ]', e)).toBe('oui');
    await fails('[Inconnu]', 'unknownField', e);
  });

  it('criteria subject', async () => {
    const crit = (src: string, subject?: Value) => evaluate(parseCanonical(src, { criteria: true }), env({}, subject));
    expect(await crit('>0', num(5))).toEqual(bool(true));
    expect(await crit('>0', null)).toBeNull();
    expect(await crit('Is Not Null', null)).toEqual(bool(false));
    await expect(crit('>0')).rejects.toMatchObject({ code: 'unknownField' });
  });
});

describe('library', () => {
  it('has exactly the catalog functions, aggregates aside (evaluated over a group by A3 and A5)', () => {
    expect(Object.keys(LIBRARY).sort()).toEqual(FUNCTIONS.filter((x) => x.category !== 'aggregate').map((x) => x.name).sort());
  });

  it('functions are callable directly (pure on args and env)', async () => {
    expect(await LIBRARY.Len([str('abc')], env())).toEqual(num(3));
    expect(await LIBRARY.Nz([null, num(0)], env())).toEqual(num(0));
  });

  it('compareText', () => {
    expect(compareText('abc', 'ABC')).toBe(0); expect(compareText('e', 'é')).not.toBe(0);
    expect(compareText('a', 'B')).toBe(-1); expect(compareText('b', 'A')).toBe(1);
  });

  // [expression, résultat] : un cas normal, un cas Null et un cas limite par fonction.
  it.each([
    ['IIf(1 > 0, "a", "b")', 'a'], ['IIf(0, 1, Null)', null],
    // only the chosen branch is evaluated, as in Access queries and controls (VBA's IIf evaluates both): no error from the other
    ['IIf(True, 1, 1 / 0)', 1], ['IIf(False, 1 / 0, 2)', 2], ['IIf(Null, 1 / 0, 2)', 2],
    ['Nz(5, 0)', 5], ['Nz(Null)', '<empty>'], ['Nz("", "x")', ''],
    ['IsNull(1)', false], ['IsNull(Null)', true], ['IsNull("")', false],
    ['IsNumeric("12,5")', true], ['IsNumeric(Null)', false], ['IsNumeric("abc")', false], ['IsNumeric("")', false], ['IsNumeric(True)', true],
    ['IsDate("21/10/2026")', true], ['IsDate(Null)', false], ['IsDate("31/02/2026")', false], ['IsDate(#2026-01-01#)', true], ['IsDate(1)', false],
    ['Len(Null)', null], ['Len("")', 0], ['Len(1.5)', 3],
    ['Left("abcdef", 2)', 'ab'], ['Left(Null, 2)', null], ['Left("ab", 5)', 'ab'], ['Left("ab", Null)', null],
    ['Right("abcdef", 2)', 'ef'], ['Right(Null, 2)', null], ['Right("ab", 0)', ''],
    ['Mid("abcdef", 3)', 'cdef'], ['Mid(Null, 1)', null], ['Mid("abc", 5)', ''], ['Mid("abc", 2, 0)', ''],
    ['Trim("  a b  ")', 'a b'], ['Trim(Null)', null], ['Trim("")', ''],
    ['LTrim("  a ")', 'a '], ['LTrim(Null)', null], ['LTrim("   ")', ''],
    ['RTrim("  a ")', '  a'], ['RTrim(Null)', null], ['RTrim("a")', 'a'],
    ['UCase(Null)', null], ['UCase(1.5)', '1,5'], ['UCase("abc1")', 'ABC1'],
    ['LCase("ÉTÉ")', 'été'], ['LCase(Null)', null], ['LCase("")', ''],
    ['InStr("Bonjour", "JOUR")', 4], ['InStr(5, "abcabc", "b")', 5], ['InStr("abc", "")', 1], ['InStr("abc", "z")', 0],
    ['InStr(Null, "a")', null], ['InStr("été", "e")', 0], ['InStr(9, "abc", "a")', 0], ['InStr("a.c", ".")', 2],
    ['Replace("a.b.c", ".", "-")', 'a-b-c'], ['Replace("ABC", "b", "$&")', 'A$&C'], ['Replace(Null, "a", "b")', null], ['Replace("abc", "", "x")', 'abc'],
    ['Space(3)', '   '], ['Space(Null)', null], ['Space(0)', ''],
    ['String(3, "ab")', 'aaa'], ['String(2, 65)', 'AA'], ['String(Null, "x")', null], ['String(0, "x")', ''],
    ['StrComp("a", "B")', -1], ['StrComp("abc", "ABC")', 0], ['StrComp("abc", "ABC", 0)', 1], ['StrComp(Null, "a")', null],
    ['Format(1.5)', '1,5'], ['Format(Null)', null], ['Format(#2026-10-21#)', '21/10/2026'], ['Format(1.5, "0.00")', '1,50'], ['Format(1234.5, "fixed")', '1234,50'], ['Format(1.5, Null)', null],
    ['Round(-2.5)', -2], ['Round(Null)', null], ['Round(2.675, 2)', 2.68], ['Round(0.125, 2)', 0.12], ['Round(1.5, Null)', null],
    ['Int(-2.5)', -3], ['Int(2.9)', 2], ['Int(Null)', null], ['Int(#2026-10-21 14:05:00#)', '2026-10-21 00:00:00'],
    ['Fix(-2.5)', -2], ['Fix(2.9)', 2], ['Fix(Null)', null], ['Fix(-0.5)', 0],
    ['Abs(-3)', 3], ['Abs(Null)', null], ['Abs(0)', 0],
    ['Sgn(-3)', -1], ['Sgn(0)', 0], ['Sgn(2)', 1], ['Sgn(Null)', null],
    ['Sqr(9)', 3], ['Sqr(Null)', null], ['Sqr(0)', 0],
    ['Val("12abc")', 12], ['Val(" 1 2 3")', 123], ['Val("abc")', 0], ['Val("1.5e2")', 150], ['Val("1,5")', 1], ['Val(Null)', null],
    ['CStr(1.5)', '1,5'], ['CStr(True)', 'True'], ['CStr(Null)', null], ['CStr(#2026-10-21 14:05:00#)', '21/10/2026 14:05:00'],
    ['CStr(#1899-12-30 14:05:00#)', '14:05:00'], ['CStr(0.1 + 0.2)', '0,30000000000000004'],
    ['CInt(2.5)', 2], ['CInt("3,5")', 4], ['CInt(Null)', null], ['CInt(-32768)', -32768],
    ['CLng(2.5)', 2], ['CLng(-3.5)', -4], ['CLng(Null)', null], ['CLng(2147483647)', 2147483647],
    ['CDbl("1,5")', 1.5], ['CDbl("1.5")', 1.5], ['CDbl(Null)', null], ['CDbl(True)', -1], ['CDbl("1 234,5")', 1234.5],
    ['CCur(1.23456)', 1.2346], ['CCur(0.00005)', 0], ['CCur(0.00015)', 0.0002], ['CCur(Null)', null],
    ['CDate("21/10/2026")', '2026-10-21 00:00:00'], ['CDate(1)', '1899-12-31 00:00:00'], ['CDate(Null)', null], ['CDate("14:05")', '1899-12-30 14:05:00'],
    ['CBool(0)', false], ['CBool("-1")', true], ['CBool(Null)', null], ['CBool(0.5)', true], ['CBool("True")', true], ['CBool("false")', false], ['CBool("Vrai")', true], ['CBool(CStr(True))', true],
    ['IIf("0,0", 1, 2)', 2], ['Not "0,0"', true], ['CStr(#1899-12-30#)', '00:00:00'],
    // NFC : é composé (\u00e9) et e + accent combinant (e\u0301) sont le même texte, comme pour compareText.
    ['InStr("caf\u00e9", "e\u0301")', 4], ['Replace("cafe\u0301", "\u00e9", "e")', 'cafe'], ['"cafe\u0301" Like "caf\u00e9"', true],
    ['"cafe\u0301" Like "caf[\u00e9]"', true],
    ['Date()', '2026-10-21 00:00:00'], ['Date() + 1', '2026-10-22 00:00:00'],
    ['Time()', '1899-12-30 14:05:00'], ['Now()', '2026-10-21 14:05:00'], ['Now() - Date()', 14 / 24 + 5 / 1440],
    ['Year(Null)', null], ['Year("21/10/2026")', 2026], ['Year(#0100-01-01#)', 100],
    ['Month(#2026-10-21#)', 10], ['Month(Null)', null], ['Month(#2026-12-31 23:59:59#)', 12],
    ['Day(#2026-10-21#)', 21], ['Day(Null)', null], ['Day(#2024-02-29#)', 29],
    ['Hour(#2026-10-21 14:05:09#)', 14], ['Hour(Null)', null], ['Hour("14:05")', 14],
    ['Minute(#2026-10-21 14:05:09#)', 5], ['Minute(Null)', null], ['Minute(#2026-10-21#)', 0],
    ['Second(#2026-10-21 14:05:09#)', 9], ['Second(Null)', null], ['Second(0.5 / 86400 + 0.1 / 86400)', 1],
    ['Weekday(#2026-10-21#)', 4], ['Weekday(#2026-10-21#, 2)', 3], ['Weekday(Null)', null], ['Weekday(#2026-10-18#)', 1],
    ['DateAdd("m", 1, #2026-01-31#)', '2026-02-28 00:00:00'], ['DateAdd("yyyy", 1, #2024-02-29#)', '2025-02-28 00:00:00'],
    ['DateAdd("q", 1, #2026-10-21#)', '2027-01-21 00:00:00'], ['DateAdd("d", -1, #2026-03-01#)', '2026-02-28 00:00:00'],
    ['DateAdd("y", 1, #2026-12-31#)', '2027-01-01 00:00:00'], ['DateAdd("w", 1, #2026-10-21#)', '2026-10-22 00:00:00'],
    ['DateAdd("ww", 2, #2026-10-21#)', '2026-11-04 00:00:00'], ['DateAdd("h", 10, #2026-10-21 14:05:00#)', '2026-10-22 00:05:00'],
    ['DateAdd("n", 55, #2026-10-21 14:05:00#)', '2026-10-21 15:00:00'], ['DateAdd("s", -1, #2026-01-01#)', '2025-12-31 23:59:59'],
    ['DateAdd("M", 1, #2026-10-21#)', '2026-11-21 00:00:00'], ['DateAdd("d", 1, Null)', null],
    ['DateDiff("m", #2026-01-31#, #2026-02-01#)', 1], ['DateDiff("yyyy", #2026-12-31#, #2027-01-01#)', 1],
    ['DateDiff("d", #2026-10-21 23:00:00#, #2026-10-22 01:00:00#)', 1], ['DateDiff("y", #2026-10-01#, #2026-10-21#)', 20],
    ['DateDiff("h", #2026-10-21 13:59:59#, #2026-10-21 14:00:00#)', 1], ['DateDiff("n", #2026-10-21 14:00:59#, #2026-10-21 14:01:00#)', 1],
    ['DateDiff("s", #2026-10-21#, #2026-10-21 00:01:00#)', 60], ['DateDiff("q", #2026-03-31#, #2026-04-01#)', 1],
    ['DateDiff("ww", #2026-10-17#, #2026-10-18#)', 1], ['DateDiff("ww", #2026-10-18#, #2026-10-24#)', 0],
    ['DateDiff("w", #2026-10-01#, #2026-10-21#)', 2], ['DateDiff("d", #2026-10-21#, #2026-10-01#)', -20],
    ['DateDiff("m", Null, #2026-01-01#)', null], ['DateDiff("yyyy", #2026-01-01#, #2026-12-31#)', 0],
    ['DateDiff("d", #1899-12-29 06:00:00#, #1899-12-30#)', 1], ['DateDiff("h", #1899-12-29 06:00:00#, #1899-12-30#)', 18],
    ['DatePart("q", #2026-10-21#)', 4], ['DatePart("y", #2026-10-21#)', 294], ['DatePart("ww", #2026-01-03#)', 1],
    ['DatePart("ww", #2026-01-04#)', 2], ['DatePart("w", #2026-10-21#)', 4], ['DatePart("d", Null)', null],
    ['DatePart("yyyy", #2026-10-21#)', 2026], ['DatePart("m", #2026-10-21#)', 10], ['DatePart("h", #2026-10-21 14:05:09#)', 14],
    ['DatePart("n", #2026-10-21 14:05:09#)', 5], ['DatePart("s", #2026-10-21 14:05:09#)', 9], ['DatePart("d", #2026-10-21#)', 21],
    ['DateSerial(2026, 13, 1)', '2027-01-01 00:00:00'], ['DateSerial(2026, 3, 0)', '2026-02-28 00:00:00'],
    ['DateSerial(26, 1, 1)', '2026-01-01 00:00:00'], ['DateSerial(99, 1, 1)', '1999-01-01 00:00:00'], ['DateSerial(Null, 1, 1)', null],
    ['TimeSerial(14, 5, 0)', '1899-12-30 14:05:00'], ['TimeSerial(0, 90, 0)', '1899-12-30 01:30:00'], ['TimeSerial(Null, 0, 0)', null],
  ])('%s', async (src, expected) => {
    const got = await ev(src);
    if (typeof expected === 'number' && !Number.isInteger(expected)) expect(got).toBeCloseTo(expected, 9);
    else expect(got).toEqual(expected);
  });

  it.each([
    ['IIf(1 / 0, 1, 2)', 'divByZero' /* the condition's error is IIf's */], ['IIf(True, 1 / 0, 2)', 'divByZero'], ['Round(1, 2000000000)', 'badArgument'], ['Round(1, 23)', 'badArgument'],
    ['Space(2000000000)', 'overflow'], ['Space(65536)', 'overflow'], ['String(2000000000, "x")', 'overflow'],
    ['3000000000 Mod 7', 'overflow'], ['3000000000 \\ 2', 'overflow'], ['7 Mod 3000000000', 'overflow'], ['"abc" Like "[z-a]"', 'badArgument'], ['Left("ab", -1)', 'badArgument'], ['Mid("abc", 0)', 'badArgument'],
    ['Mid("abc", 1, -1)', 'badArgument'], ['Space(-1)', 'badArgument'], ['String(2, "")', 'badArgument'], ['Sqr(-1)', 'badArgument'],
    ['Round(1.5, -1)', 'badArgument'], ['InStr(0, "a", "a")', 'badArgument'], ['CInt(40000)', 'overflow'], ['CInt(-32769)', 'overflow'],
    ['CLng(3000000000)', 'overflow'], ['CDbl("x")', 'typeMismatch'], ['CDate("abc")', 'typeMismatch'], ['CBool("x")', 'typeMismatch'],
    ['DateAdd("x", 1, Date())', 'badArgument'], ['DateDiff("x", Date(), Date())', 'badArgument'], ['DatePart("x", Date())', 'badArgument'],
    ['DateSerial(10000, 1, 1)', 'overflow'], ['DateAdd("yyyy", 8000, Date())', 'overflow'], ['Year("abc")', 'typeMismatch'],
    ['Left(1, "x")', 'typeMismatch'],
  ])('%s fails with %s', async (src, code) => fails(src, code));
});

describe('serial dates', () => {
  it.each([
    ['1899-12-30 00:00:00', 0], ['1899-12-31 00:00:00', 1], ['1899-12-30 12:00:00', 0.5], ['1899-12-29 06:00:00', -1.25],
    ['2026-10-21 00:00:00', 46316], ['2026-01-01 00:00:00', 46023],
  ])('%s <-> %s', (iso, serial) => {
    expect(toSerial(iso)).toBeCloseTo(serial, 12);
    expect(fromSerial(serial)).toBe(iso);
  });

  it('round trips to the second', () => {
    for (const iso of ['2026-10-21 14:05:09', '0100-01-01 00:00:01', '9999-12-31 23:59:59', '1899-12-29 23:59:59', '1700-03-01 08:30:00']) {
      expect(fromSerial(toSerial(iso))).toBe(iso);
    }
    expect(fromSerial(0.99999999)).toBe('1899-12-31 00:00:00');
    expect(() => fromSerial(3e6)).toThrow(expect.objectContaining({ code: 'overflow' }));
  });
});

describe('stored values', () => {
  const fr = localeInfo('fr-FR');
  const cases: [FieldType, Record<string, unknown>, (string | number)[]][] = [
    ['shortText', {}, ['abc', 'Prix "TTC" été']], ['longText', {}, ['ligne 1\nligne 2']], ['hyperlink', {}, ['https://exemple.fr']],
    ['number', { numberSize: 'longInteger' }, [42, -7]], ['number', { numberSize: 'double' }, [1.5, 0.30000000000000004]],
    ['number', { numberSize: 'decimal', precision: 10, scale: 3 }, ['12.340', '-0.001']], ['currency', {}, [1.2345, -10]],
    ['dateTime', {}, ['2026-10-21 14:05:00', '1899-12-29 06:00:00', '0100-01-01 00:00:00']], ['yesNo', {}, [0, 1]],
  ];
  // Décimal relu en double : aller-retour exact jusqu'à ~15 chiffres significatifs (voir fromStored).
  it('stored round trip per type (values within double precision)', () => {
    for (const [type, props, values] of cases) {
      const field = f('C', type, props);
      for (const v of values) {
        const back = coerce(field, toStored(field, fromStored(field, v), fr), fr);
        expect(back, `${type} ${v}`).toEqual({ ok: true, value: v });
      }
      expect(fromStored(field, null)).toBeNull();
      expect(toStored(field, null, fr)).toBeNull();
    }
  });

  it('typed values', () => {
    expect(fromStored(f('C', 'dateTime'), '2026-10-21 00:00:00')).toEqual(date(46316));
    expect(fromStored(f('C', 'yesNo'), 1)).toEqual(bool(true));
    expect(fromStored(f('C', 'number', { numberSize: 'decimal', scale: 2 }), '1.50')).toEqual(num(1.5));
    expect(fromStored(f('C', 'currency'), 2.5)).toEqual(num(2.5));
    expect(fromStored(f('C', 'autoNumber'), 7)).toEqual(num(7));
    expect(fromStored(f('C', 'shortText'), 'x')).toEqual(str('x'));
    // Valeurs mal formées : jamais num(NaN) ; une date sans heure est lue en ISO.
    expect(fromStored(f('C', 'number', { numberSize: 'double' }), 'abc')).toEqual(str('abc'));
    expect(fromStored(f('C', 'number', { numberSize: 'double' }), '')).toEqual(str(''));
    expect(fromStored(f('C', 'yesNo'), 'abc')).toEqual(str('abc'));
    expect(fromStored(f('C', 'dateTime'), '2026-10-21')).toEqual(date(46316));
    expect(fromStored(f('C', 'dateTime'), 'n/a')).toEqual(str('n/a'));
  });

  it('a malformed stored number never compares as a number', async () => {
    const n = fromStored(f('N', 'number', { numberSize: 'double' }), 'abc');
    await fails('[N] = 5', 'typeMismatch', env({ N: n }));
  });

  it('conversions into another type', () => {
    expect(toStored(f('C', 'shortText'), num(1.5), fr)).toBe('1,5');
    expect(toStored(f('C', 'shortText'), bool(true), fr)).toBe('True');
    expect(toStored(f('C', 'shortText'), date(46316), fr)).toBe('21/10/2026');
    expect(toStored(f('C', 'dateTime'), num(1), fr)).toBe('1899-12-31 00:00:00');
    expect(toStored(f('C', 'number'), bool(true), fr)).toBe(-1);
    expect(toStored(f('C', 'number'), str('1,5'), fr)).toBe('1,5'); // coerce lit la saisie régionale
    expect(toStored(f('C', 'yesNo'), num(-1), fr)).toBe(true);
    expect(toStored(f('C', 'yesNo'), num(0), fr)).toBe(false);
  });
});
