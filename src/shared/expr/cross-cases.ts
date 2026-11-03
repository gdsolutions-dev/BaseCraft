// Cross-test material (spec 4.5): one table, its rows and the expression cases run on the evaluator, SQLite (sql.test.ts,
// postgres/cross.test.ts) and PostgreSQL (postgres/cross.test.ts, live). Every line of C4's R14 table has cases here.
import type { SqlValue } from '../coerce';
import type { TableDesign } from '../field-types';
import { f, t } from '../test-fixtures';

export const CROSS_TABLE: TableDesign = t('T', [
  f('id', 'autoNumber'), f('txt', 'shortText'), f('n', 'number', { numberSize: 'double' }), f('i', 'number'),
  f('d', 'dateTime'), f('b', 'yesNo'),
]);
/** Rows 1–9 of T (id 1…9): txt, n, i, d, b — Null, accents, case, apostrophe, %, ;, numeric text. */
export const CROSS_ROWS: SqlValue[][] = [
  ['Dupont', 1, 1, '2026-10-01 00:00:00', 1],
  ['dupont', 2.5, 2, '2026-11-15 00:00:00', 0],
  [null, null, null, null, 0],
  ['été', 3, 3, '2025-12-31 00:00:00', 1],
  ["O'Brien", 1.5, -4, '2026-09-30 23:59:59', 0],
  ['50%', 0, 0, '2026-10-02 12:00:00', 1],
  ['a;b', -2, 10, null, 0],
  ['Été', 2, null, '2026-01-01 00:00:00', 1],
  ['12', 0.1, 7, '2026-10-31 06:00:00', 0],
];

export interface CrossCase { src: string; mode: 'value' | 'condition' | 'criteria'; subject?: string }
const V = (...xs: string[]): CrossCase[] => xs.map((src) => ({ src, mode: 'value' }));
const C = (...xs: string[]): CrossCase[] => xs.map((src) => ({ src, mode: 'condition' }));
const K = (subject: string, ...xs: string[]): CrossCase[] => xs.map((src) => ({ src, mode: 'criteria', subject }));

export const CROSS_CASES: CrossCase[] = [
  // text comparisons: case-insensitive, accent-sensitive
  ...C('[txt] = "dupont"', '[txt] <> "ÉTÉ"', '[txt] < "e"', '[txt] <= "dupont"', '[txt] > "O"', '[txt] >= "été"'),
  // &
  ...V('[txt] & "x"', '[txt] & [id]', '[txt] & 5', '[txt] & Null', 'Null & Null', '[n] & ""', '[d] & ""'),
  // + - * ^ /
  ...V('[n] + [i]', '[i] - 2', '[n] * 2', '[i] ^ 2', '2 ^ [i]', '"a" + [txt]', '[n] / 2', '1 / [n]'),
  // \ and Mod: banker's rounding of both operands
  ...V('[n] \\ 2', '[n] Mod 2', '[i] Mod 3', '[i] \\ 3', '7 \\ [i]'),
  // And Or Not Xor; a condition used as a value
  ...C('[i] > 1 And [b]', 'Null Or [i] > 2', 'Null And [i] > 2', 'Not [b]', '[b] Xor [i] > 2', '[n]', 'True', 'Null'),
  ...V('[n] > 1', '[txt] Is Null', '[b]'),
  // Like
  ...C('[txt] Like "d*"', '[txt] Like "?????"', '[txt] Like "*%"', '[txt] Like "#*"', '[txt] Like "[a-e]*"', '[txt] Like "[!d]*"',
    '[txt] Not Like "*;*"', '[txt] Like "É*"', '[txt] Like "*[%]"', '[txt] Like [txt]'),
  // Between, In, Is Null
  ...C('[n] Between 1 And 2.5', '[txt] Between "a" And "E"', '[n] Not Between 0 And 1', '[i] In (1, 2, 10)', '[txt] In ("DUPONT", "été")',
    '[d] Is Null', '[i] Is Not Null'),
  // IIf, Nz, IsNull
  ...V('IIf([n] > 2, "a", "b")', 'IIf([n] = 0, 0, 1 / [n])', 'IIf([i] > 2, 1 / 0, 1)', 'IIf(Null, 1, 2)', 'Nz([n], -1)', 'Nz([txt], "?")',
    'Nz([n])', 'Nz([txt])', 'IsNull([i])'),
  ...C('IsNull([d])', 'Nz([n]) = 0'),
  // text functions
  ...V('Len([txt])', 'Left([txt], 2)', 'Right([txt], 2)', 'Mid([txt], 2, 3)', 'Mid([txt], 2)', 'Trim("  " & [txt] & " ")', 'LTrim(" " & [txt])',
    'RTrim([txt] & "  ")', 'UCase([txt])', 'LCase([txt])', 'Space(2) & [txt]', 'String(3, [txt])', 'Space([i])', 'String([i], "x")',
    'InStr([txt], "u")', 'InStr(3, [txt], "o")', 'InStr([txt], "")', 'Replace([txt], "d", "X")'),
  // numbers: Round, Int, Fix, Abs, Sgn, Sqr, conversions (CCur: half to even at 4 places)
  ...V('Round([n])', 'Round([n] * 1.25, 1)', 'Round(2.5)', 'Round(0.125, 2)', 'Int(-[n])', 'Fix(-[n])', 'Abs([i])', 'Sgn([n])', 'Sqr([n] + 2)', 'Sqr([i])',
    'CInt([n])', 'CLng([n] * 3)', 'CDbl([i])', 'CCur([n] / 3)', 'CCur([i] / 20000)', 'CBool([n])'),
  ...C('CBool([i])'),
  // dates: the clock, parts (seconds rounded: …:59.6 is the next minute), Weekday, DateAdd, DateDiff, DatePart, DateSerial, TimeSerial
  ...V('Date()', 'Year(Now())', 'Hour(Time()) >= 0'),
  ...C('[d] < Now()'),
  ...V('Year([d])', 'Month([d])', 'Day([d])', 'Hour([d])', 'Minute([d])', 'Second([d])',
    'Second([d] + 0.6 / 86400)', 'Minute([d] + 0.6 / 86400)', 'Day([d] + 0.6 / 86400)', '[d] + 0.6 / 86400', '[d] + 1', '[d] - #2026-01-01#',
    'Weekday([d])', 'Weekday([d], 2)',
    'DateAdd("m", 1, [d])', 'DateAdd("m", 2, #2025-12-31#)', 'DateAdd("yyyy", 1, [d])', 'DateAdd("q", 1, [d])', 'DateAdd("d", [i], [d])',
    'DateAdd("h", -5, [d])', 'DateAdd("ww", 1, [d])', 'DateAdd("n", 90, [d])', 'DateAdd("s", 30, [d])', 'DateAdd("w", 1, [d])', 'DateAdd("y", 1, [d])',
    'DateDiff("yyyy", [d], #2027-01-01#)', 'DateDiff("q", [d], #2027-01-01#)', 'DateDiff("m", [d], #2027-01-01#)', 'DateDiff("d", [d], #2027-01-01#)',
    'DateDiff("y", [d], #2027-01-01#)', 'DateDiff("h", [d], #2026-10-01 12:00:00#)', 'DateDiff("n", [d], #2026-10-01 12:00:00#)',
    'DateDiff("s", [d], #2026-10-01 12:00:00#)', 'DateDiff("ww", [d], #2027-01-01#)', 'DateDiff("w", [d], #2027-01-01#)',
    'DatePart("yyyy", [d])', 'DatePart("q", [d])', 'DatePart("m", [d])', 'DatePart("y", [d])', 'DatePart("d", [d])', 'DatePart("w", [d])',
    'DatePart("h", [d])', 'DatePart("n", [d])', 'DatePart("s", [d])', 'DatePart("ww", [d])',
    'DateSerial(2026, [i], 31)', 'DateSerial(26, 1, 1)', 'TimeSerial([i], 30, 0)'),
  // outside the closed list, and types R14 does not mix
  ...V('Format([d], "yyyy")', 'Val([txt])', 'CStr([n])', 'CDate([txt])', 'IsNumeric([txt])', 'IsDate([txt])', 'StrComp([txt], "dupont")'),
  ...C('[txt] * 2 > 0', '[d] = "31/10/2026 06:00:00"', '[txt]'),
  // criteria (the subject is the column filtered)
  ...K('n', '>2', '<=1.5', 'Between 1 And 3'), ...K('txt', 'Like "d*"', '"dupont"', 'Is Null', 'In ("été", "12")'),
  ...K('i', 'In (1, 2)', '<>2'), ...K('d', '<#2026-06-01#', 'Is Not Null'),
];
