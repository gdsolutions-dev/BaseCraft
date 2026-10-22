import { describe, expect, it } from 'vitest';
import en from '../i18n/en.json';
import fr from '../i18n/fr.json';
import { localeInfo } from '../locale-format';
import { ExprSyntaxError, type ExprErrorCode } from './ast';
import { FUNCTIONS, KEYWORDS } from './catalog';
import { listSeparator, toCanonical, toDisplay, type DisplayContext } from './localize';
import { parseCanonical, sameTree, serialize, serializeCriteria, serializeWith, CANONICAL_DIALECT } from './parser';

const FR: DisplayContext = { lang: 'fr', region: localeInfo('fr-FR') };
const EN: DisplayContext = { lang: 'en', region: localeInfo('en-US') };
const FR_US: DisplayContext = { lang: 'fr', region: localeInfo('en-US') };
const EN_FR: DisplayContext = { lang: 'en', region: localeInfo('fr-FR') };
const get = (o: unknown, k: string): unknown => k.split('.').reduce((a: any, p) => a?.[p], o);

describe('display <-> canonical', () => {
  it('fr display -> canonical -> en display', () => {
    const c = toCanonical('VraiFaux([Qté]>1,5; "gros; ou pas"; "petit")', FR);
    expect(c).toBe('IIf([Qté] > 1.5, "gros; ou pas", "petit")');
    expect(toDisplay(c, EN)).toBe('IIf([Qté] > 1.5, "gros; ou pas", "petit")');
    expect(toDisplay(c, FR)).toBe('VraiFaux([Qté] > 1,5; "gros; ou pas"; "petit")');
  });

  it('dates follow the region', () => {
    expect(toCanonical('#21/10/2026#', FR)).toBe('#2026-10-21#');
    expect(toDisplay('#2026-10-21#', EN)).toBe('#10/21/2026#');
    expect(toCanonical('#21/10/2026 14:05#', FR)).toBe('#2026-10-21 14:05:00#');
    expect(toDisplay('#2026-10-21 14:05:00#', FR)).toBe('#21/10/2026 14:05:00#');
    expect(toCanonical('#10/21/2026#', EN)).toBe('#2026-10-21#');
    expect(() => toCanonical('#31/02/2026#', FR)).toThrow(expect.objectContaining({ code: 'badDate' }));
  });

  it('keywords and criteria', () => {
    expect(toCanonical('Entre 1 Et 5', FR, { criteria: true })).toBe('Between 1 And 5');
    expect(toCanonical('Pas Comme "A*" Ou Est Null', FR, { criteria: true })).toBe('Not Like "A*" Or Is Null');
    expect(toDisplay('[a] Is Not Null And [b] = True', FR)).toBe('[a] Est Pas Null Et [b] = Vrai');
  });

  it('criteria are shown without the implicit subject', () => {
    expect(toDisplay('> 0', FR, { criteria: true })).toBe('> 0');
    expect(toDisplay('"Lyon"', FR, { criteria: true })).toBe('"Lyon"');
    expect(toDisplay('Is Not Null', FR, { criteria: true })).toBe('Est Pas Null');
    expect(toDisplay('Is Not Null', EN, { criteria: true })).toBe('Is Not Null');
    expect(toDisplay('<> 5', FR, { criteria: true })).toBe('<> 5');
    expect(toDisplay('>= 1.5 And < 10', FR, { criteria: true })).toBe('>= 1,5 Et < 10');
    expect(toDisplay('Like "A*" Or In (1, 2)', FR, { criteria: true })).toBe('Comme "A*" Ou Dans (1; 2)');
    expect(toCanonical('"Lyon" Ou "Paris"', FR, { criteria: true })).toBe('"Lyon" Or "Paris"');
    expect(toCanonical('Pas Null', FR, { criteria: true })).toBe('Is Not Null');
    expect(toCanonical('>0 Et <10', FR, { criteria: true })).toBe('> 0 And < 10');
    expect(toCanonical('[a] > 1', FR, { criteria: true })).toBe('[a] > 1');
  });

  it('serializeCriteria is the short, re-parsable form', () => {
    const s = (src: string) => serializeCriteria(parseCanonical(src, { criteria: true }));
    expect(s('>0')).toBe('> 0');
    expect(s('= Null')).toBe('= Null'); // not Is Null
    expect(s('= ([a] > 1)')).toBe('= ([a] > 1)');
    expect(s('Not "a" Or Not "b"')).toBe('<> "a" Or <> "b"');
    expect(s('Between 1 And 5 And Not In (3)')).toBe('Between 1 And 5 And Not In (3)');
    expect(s('[a] > 1')).toBe('[a] > 1');
  });

  it('accent/case-insensitive names', () => {
    expect(toCanonical('extracchaine([a];1;2)', FR)).toBe('Mid([a], 1, 2)');
    expect(toCanonical('RACINECARREE(4)', FR)).toBe('Sqr(4)');
    expect(toCanonical('mid([a],1,2)', EN)).toBe('Mid([a], 1, 2)');
    expect(toCanonical('ExtracChaîne([a];1)', { lang: 'fr', region: localeInfo('fr-FR') })).toBe('Mid([a], 1)');
  });

  it('brackets and strings untouched', () => {
    expect(toCanonical('[Prix; "TTC"] & "Et"', FR)).toBe('[Prix; "TTC"] & "Et"');
    expect(toDisplay('[Prix, 1.5] & "a, b; c"', FR)).toBe('[Prix, 1.5] & "a, b; c"');
    expect(toCanonical('[Date] & Date()', FR)).toBe('[Date] & Date()');
  });

  it('a function name without parentheses is a field', () => {
    expect(toCanonical('Temps + Année', FR)).toBe('[Temps] + [Année]');
    expect(toCanonical('Temps() + Année(1)', FR)).toBe('Time() + Year(1)');
  });

  it('numbers use the region decimal separator, no group separators', () => {
    expect(toCanonical('1,5 + 2', FR)).toBe('1.5 + 2');
    expect(toCanonical('1.5 + 2', EN)).toBe('1.5 + 2');
    expect(() => toCanonical('1.5', FR)).toThrow(expect.objectContaining({ code: 'badNumber' }));
    expect(() => toCanonical('1 234', FR)).toThrow(expect.objectContaining({ code: 'unexpectedToken' }));
    expect(() => toCanonical('IIf(1,5, 2)', EN)).not.toThrow(); // , is the list separator in en-US
    expect(() => toCanonical('Abs(1;2)', FR)).toThrow(expect.objectContaining({ code: 'arity' }));
    expect(() => toCanonical('Gauche(1, 2)', FR)).toThrow(ExprSyntaxError); // , is not the list separator in fr-FR
    expect(() => toCanonical('Left(1; 2)', EN)).toThrow(ExprSyntaxError);
    expect(toDisplay('.5 + 1000000.25', FR)).toBe('0,5 + 1000000,25');
  });

  it('keywords belong to the UI language', () => {
    expect(toCanonical('[a] Et [b]', FR)).toBe('[a] And [b]');
    expect(() => toCanonical('[a] And [b]', FR)).toThrow(ExprSyntaxError); // fr: And is a plain name, not an operator
    expect(() => toCanonical('[a] Et [b]', EN)).toThrow(ExprSyntaxError); // en: Et is a plain name
    expect(toCanonical('[a] Et [b]', FR_US)).toBe('[a] And [b]'); // language and region are independent
  });

  it('error span in display text', () => {
    let err: ExprSyntaxError | undefined;
    try { toCanonical('VraiFaux(1;', FR); } catch (e) { err = e as ExprSyntaxError; }
    expect(err?.code).toBe('unexpectedEnd');
    expect(err?.span.start).toBe(11);
    try { toCanonical('1 + Foo(2)', FR); } catch (e) { err = e as ExprSyntaxError; }
    expect(err).toMatchObject({ code: 'unknownFunction', span: { start: 4, end: 7 } });
  });

  it('list separator', () => {
    expect(listSeparator(localeInfo('fr-FR'))).toBe(';');
    expect(listSeparator(localeInfo('de-DE'))).toBe(';');
    expect(listSeparator(localeInfo('en-US'))).toBe(',');
  });

  it('de-DE region', () => {
    const de: DisplayContext = { lang: 'en', region: localeInfo('de-DE') };
    expect(toDisplay('IIf(a > 1.5, #2026-10-21#, 2)', de)).toBe('IIf([a] > 1,5; #21.10.2026#; 2)');
    expect(toCanonical('IIf(a > 1,5; #21.10.2026#; 2)', de)).toBe('IIf([a] > 1.5, #2026-10-21#, 2)');
  });
});

describe('catalog', () => {
  it('descriptions, categories and error messages exist in both languages', () => {
    for (const c of [fr, en]) {
      for (const f of FUNCTIONS) expect(get(c, `expr.fn.${f.name}`), f.name).toEqual(expect.any(String));
      for (const cat of new Set(FUNCTIONS.map((f) => f.category))) expect(get(c, `expr.cat.${cat}`), cat).toEqual(expect.any(String));
      const codes: ExprErrorCode[] = ['unexpectedToken', 'unexpectedEnd', 'unclosedString', 'unclosedBracket', 'badDate', 'badNumber', 'unknownFunction', 'arity'];
      for (const k of codes) expect(get(c, `expr.error.${k}`), k).toEqual(expect.any(String));
    }
  });

  it('names are unique once folded; keywords are complete', () => {
    const fold = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
    expect(new Set(FUNCTIONS.map((f) => fold(f.name))).size).toBe(FUNCTIONS.length);
    expect(new Set(FUNCTIONS.map((f) => fold(f.fr))).size).toBe(FUNCTIONS.length);
    expect(Object.keys(KEYWORDS)).toHaveLength(12);
    const kws = new Set(Object.values(KEYWORDS).map((k) => fold(k.fr)));
    expect(FUNCTIONS.filter((f) => kws.has(fold(f.fr)))).toEqual([]); // no function named like a keyword
  });
});

const CANONICAL = [
  'IIf([Qté] > 1.5, "gros; ou pas", "petit")', '[a] + 1.25 * -[b] ^ 2', '[a] Is Not Null And [b] = True', 'Not ([a] And [b]) Or [c] Xor [d]',
  '[Prix] Between 1.5 And 10', '[x] Not In (1, 2.5, "a, b")', '[Nom] Not Like "A*" & "x"', 'Mid([a], 1, 2) & Left([b], 3)',
  '[d] > #2026-10-21#', '[d] <= #2026-10-21 14:05:09#', 'Nz([a], 0) Mod 3 \\ 2', 'DateAdd("d", 7, Date()) - Now()',
  'Round(Sqr(2), 2) <> 1.41', '[Prix "TTC" été] * 1.2', 'IIf(IsNull([a]), CStr(Val("1.5")), Format([a], "0.00"))',
  'Trim(UCase([a])) = LCase(RTrim([b]))', 'InStr([a], "x") > 0 Or Len([a]) = 0', 'Weekday(Date()) In (1, 7)',
  'DateDiff("d", [a], Now()) / 365.25', 'DateSerial(2026, 10, 21) = #2026-10-21#', 'TimeSerial(1, 2, 3) < Time()',
  'Hour(Now()) + Minute(Now()) + Second(Now())', 'Month(Date()) = Day(Date())', 'CDate("2026-10-21") Is Null', 'Replace([a], "x", "y") = String(3, "z")',
  '(1 + 2) * 3 - (4 - 5)', '[a] & Null & False', 'Abs(Int(Fix(Sgn(-2.5)))) = 1', 'IsNumeric([a]) And IsDate([b])',
  'CInt(1) + CLng(2) + CDbl(3) + CCur(4) + CBool(0) + Space(2) + StrComp("a", "b") + Right("a", 1) + LTrim(" a") + DatePart("d", Now()) + Year(Now())',
];
const CRITERIA = [
  '> 0', '"Lyon"', 'Is Not Null', 'Is Null', '<> 5', 'Between 1.5 And 5', 'Not Like "A*" Or Is Null', '>= #2026-10-21# And < #2027-01-01 08:30:00#',
  'In ("a", "b")', 'Not In (1, 2.5)', '"Lyon" Or "Paris"', '> [x] + 1', '[a] > 1', '= Null', '<> "a" Or <> "b"', 'Like "*;*"', '> Date() - 7', '[Prix]',
  // subject not at the head of a top-level comparison
  'Not > 5', 'Not Is Null', 'Not = "a"', '"x" Or Not >= 3', '> 1 = True', 'Is Null = False', 'Like "a*" = False', '= [a] > 1',
  'Between 1 And 2 Like "1"', '> 1 Is Null', '= ([a] > 1)', 'Not Not "a"', 'Not (Not "a")', 'Not (Is Null)',
  // Not before a parenthesised plain Like / Between / In
  'Not (Like "a*")', 'Not (Between 1 And 2)', 'Not (In (1, 2))', 'Not ((Like "a"))', 'Not Not (Like "a")', 'Not (Like "a*") Or "b"',
  'Not (Like "a*" = True)', 'Not (Between 1 And 2 = True)', 'Not (In (1, 2) = [y])', '(((#2026-10-21# And Not (Like "a*"))))',
  'Not Like "a*"', 'Not (Not Like "a*")', 'Not (Like "a" Is Null)',
  // parenthesised groups
  '([a] Or [b])', '([a] And [b])', '("a" Or "b")', '"a" Or ([x] And [y])', '> 1 And (< 5 Or Is Null)', '(> 1 Or < 0) And <> 5', 'Not (> 5)', '(> 1)',
  '("a" Or "b") And Like "*x"', '"a" And ("b" Or "c")', 'Not ("a" Or "b")', '(Null)', '("a")', 'Not ("a")', '[x] Or ("a")', '(1 + 2)',
  '("a" & "b") Or "c"', '-("a")', '([a])', '"a" Or ([a] Or [b])', '"a" Xor "b"', '(> 1) Xor (< 2)', 'Not "a" And "b"', '((> 1) Or (< 0))',
  '= ("a" Or "b")', '> (1 Or 2)', '"a" Or (Null)', '(1 + 2) * 3 > 4', '([a] > 1) = True',
];
const CONTEXTS: [string, DisplayContext][] = [['fr/fr-FR', FR], ['en/en-US', EN], ['fr/en-US', FR_US], ['en/fr-FR', EN_FR]];

describe('round trip', () => {
  describe.each(CONTEXTS)('%s', (_n, ctx) => {
    it.each(CANONICAL)('%s', (src) => {
      const c = serialize(parseCanonical(src));
      expect(toCanonical(toDisplay(c, ctx), ctx)).toBe(c);
    });
    it.each(CRITERIA)('criteria %s', (src) => {
      const crit = { criteria: true };
      const tree = parseCanonical(src, crit);
      const c = serializeCriteria(tree);
      expect(c).not.toContain('<subject>');
      expect(sameTree(parseCanonical(c, crit), tree)).toBe(true); // same meaning, not just the same text
      expect(toCanonical(src, EN, crit)).toBe(toCanonical(toDisplay(src, EN, crit), EN, crit)); // typed in any form
      const shown = toDisplay(c, ctx, crit);
      expect(toCanonical(shown, ctx, crit)).toBe(c);
      expect(sameTree(parseCanonical(toCanonical(shown, ctx, crit), crit), tree)).toBe(true);
      expect(serializeCriteria(parseCanonical(c, crit))).toBe(c); // the stored short form is stable
    });
  });
});

describe('criteria guard', () => {
  it('refuses to store a form that would be read back differently', () => {
    // A plain (non-criteria) group of lone values: written bare, it would gain the implicit subject on reparse.
    const plain = parseCanonical('[a] Or [b]');
    expect(() => serializeCriteria(plain)).toThrow(expect.objectContaining({ code: 'unexpectedToken' }));
    expect(serializeWith(plain, CANONICAL_DIALECT, true)).toBe('[a] Or [b]');
  });
  it('accepts every tree the criteria parser produces', () => {
    for (const src of ['([a] Or [b])', 'Not (> 5)', '> 1 And (< 5 Or Is Null)']) {
      expect(() => serializeCriteria(parseCanonical(src, { criteria: true }))).not.toThrow();
    }
  });
  it('Format accepts one or two arguments', () => {
    expect(toCanonical('Format([a])', EN)).toBe('Format([a])');
    expect(toCanonical('Format([a]; "0,00")', FR)).toBe('Format([a], "0,00")');
  });
});
