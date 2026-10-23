import { describe, expect, it } from 'vitest';
import { localeInfo } from '../locale-format';
import type { SelectQuery } from '../query/ast';
import { createAccumulator } from './aggregate';
import { ExprSyntaxError, type Expr } from './ast';
import { AGGREGATES, FUNCTIONS } from './catalog';
import { evaluate } from './evaluate';
import { num, str } from './library';
import { toCanonical, toDisplay } from './localize';
import { CANONICAL_LEX, tokenize, type Token } from './lexer';
import {
  CANONICAL_DIALECT, fieldRefs, hasAggregate, parseCanonical, parseExprAt, serialize, serializeWith, type ParseOptions,
} from './parser';

describe('canonical parser', () => {
  it.each([
    ['1+2*3', '1 + 2 * 3'], ['-2^2', '-2 ^ 2'], ['[A] & "x" & [B]', '[A] & "x" & [B]'],
    ['a Mod 3 = 0 And Not [b]', '[a] Mod 3 = 0 And Not [b]'], ['"Il dit ""oui"""', '"Il dit ""oui"""'],
    ['#2026-10-21#', '#2026-10-21#'], ['#2026-10-21 14:05:00#', '#2026-10-21 14:05:00#'],
    ['[N° client] Between 1 And 10', '[N° client] Between 1 And 10'], ['x In (1, 2, 3)', '[x] In (1, 2, 3)'],
    ['iif([a] Is Null, 0, [a])', 'IIf([a] Is Null, 0, [a])'],
  ])('round trip %s', (src, out) => expect(serialize(parseCanonical(src))).toBe(out));

  it('precedence', () => {
    expect(parseCanonical('-2^2')).toMatchObject({ k: 'un', op: '-', e: { k: 'bin', op: '^' } }); /* Access: -(2^2) = -4 */
  });

  it('criteria mode inserts the subject', () => {
    expect(serialize(parseCanonical('>0', { criteria: true }))).toBe('<subject> > 0');
    expect(serialize(parseCanonical('Like "A*"', { criteria: true }))).toBe('<subject> Like "A*"');
    expect(serialize(parseCanonical('"Lyon"', { criteria: true }))).toBe('<subject> = "Lyon"');
    expect(serialize(parseCanonical('Is Not Null', { criteria: true }))).toBe('<subject> Is Not Null');
    expect(serialize(parseCanonical('Between 1 And 5', { criteria: true }))).toBe('<subject> Between 1 And 5');
    expect(serialize(parseCanonical('"Lyon" Or "Paris"', { criteria: true }))).toBe('<subject> = "Lyon" Or <subject> = "Paris"');
    expect(serialize(parseCanonical('>1 And <5', { criteria: true }))).toBe('<subject> > 1 And <subject> < 5');
  });

  it('criteria mode: negated predicates, In, parentheses', () => {
    const c = (s: string) => serialize(parseCanonical(s, { criteria: true }));
    expect(c('Not Like "A*"')).toBe('<subject> Not Like "A*"');
    expect(c('Not In (1, 2)')).toBe('<subject> Not In (1, 2)');
    expect(c('In (1, 2)')).toBe('<subject> In (1, 2)');
    expect(c('Not Between 1 And 5')).toBe('<subject> Not Between 1 And 5');
    expect(c('<>5 Or Is Null')).toBe('<subject> <> 5 Or <subject> Is Null');
    expect(c('-5')).toBe('<subject> = -5');
    expect(c('Null')).toBe('<subject> Is Null');
    expect(c('[a] > 1')).toBe('[a] > 1'); // already a full condition
    expect(c('Not [a] > 1')).toBe('Not [a] > 1'); // operand is a condition, not a lone value
    expect(c('>= [a] + 1')).toBe('<subject> >= [a] + 1');
    expect(c('(>1)')).toBe('<subject> > 1'); // a parenthesised logical group is transparent
    expect(() => parseCanonical('IIf(>1, 2, 3)', { criteria: true })).toThrow(ExprSyntaxError); // but not a function argument
    expect(() => parseCanonical('x In (>1)', { criteria: true })).toThrow(ExprSyntaxError);
    expect(parseCanonical('>0', { criteria: true })).toMatchObject({ k: 'bin', op: '>', l: { k: 'subject' } });
    expect(() => parseCanonical('>0')).toThrow(ExprSyntaxError); // not in criteria mode
  });

  it('criteria mode: parenthesised groups of the logical structure', () => {
    const c = (s: string) => serialize(parseCanonical(s, { criteria: true }));
    expect(c('> 1 And (< 5 Or Is Null)')).toBe('<subject> > 1 And (<subject> < 5 Or <subject> Is Null)');
    expect(c('(> 1 Or < 0) And <> 5')).toBe('(<subject> > 1 Or <subject> < 0) And <subject> <> 5');
    expect(c('Not (> 5)')).toBe('Not <subject> > 5');
    expect(c('([a] Or [b])')).toBe('<subject> = [a] Or <subject> = [b]');
    expect(c('"a" Or ([x] And [y])')).toBe('<subject> = "a" Or <subject> = [x] And <subject> = [y]');
    expect(c('(1 + 2) * 3')).toBe('<subject> = (1 + 2) * 3'); // ordinary parentheses: not a group
    expect(c('([a] > 1) = True')).toBe('[a] > 1 = True'); // not a group: no subject
    expect(() => parseCanonical('(> 1 Or', { criteria: true })).toThrow(expect.objectContaining({ code: 'unexpectedEnd' }));
  });

  it('criteria mode: a lone field or call means = value (Access)', () => {
    const c = (s: string) => serialize(parseCanonical(s, { criteria: true }));
    expect(c('[Prix]')).toBe('<subject> = [Prix]');
    expect(c('Prix')).toBe('<subject> = [Prix]');
    expect(c('Date()')).toBe('<subject> = Date()');
    expect(c('"Lyon" Or [Ville2]')).toBe('<subject> = "Lyon" Or <subject> = [Ville2]');
    expect(c('IsNull([a])')).toBe('<subject> = IsNull([a])');
    expect(c('IIf([a] > 1, 2, 3) = 2')).toBe('IIf([a] > 1, 2, 3) = 2'); // full condition untouched
  });

  it('criteria mode: Not <value> means <>', () => {
    const c = (s: string) => serialize(parseCanonical(s, { criteria: true }));
    expect(c('Not Null')).toBe('<subject> Is Not Null');
    expect(c('Not "Lyon"')).toBe('<subject> <> "Lyon"');
    expect(c('Not 5')).toBe('<subject> <> 5');
    expect(c('Not [a]')).toBe('<subject> <> [a]');
    expect(c('Not Date()')).toBe('<subject> <> Date()');
    expect(c('Not -5')).toBe('<subject> <> -5');
    expect(c('Not Null And <10')).toBe('<subject> Is Not Null And <subject> < 10');
    expect(c('Not "a" Or Not "b"')).toBe('<subject> <> "a" Or <subject> <> "b"');
    expect(c('Not ([a] > 1)')).toBe('Not [a] > 1'); // parenthesised condition: left as is
    expect(parseCanonical('Not "Lyon"', { criteria: true })).toMatchObject({ k: 'bin', op: '<>', l: { k: 'subject' } });
    expect(serialize(parseCanonical('Not "Lyon"'))).toBe('Not "Lyon"'); // plain mode unchanged
  });

  it.each([['1 +', 'unexpectedEnd'], ['"abc', 'unclosedString'], ['[abc', 'unclosedBracket'], ['#2026-02-31#', 'badDate'], ['Foo(1)', 'unknownFunction'], ['IIf(1)', 'arity']])
    ('errors %s', (src, code) => expect(() => parseCanonical(src)).toThrow(expect.objectContaining({ code })));

  it.each([
    ['', 'unexpectedEnd'], ['(1', 'unexpectedEnd'], ['1 2', 'unexpectedToken'], ['Forms!X!Y', 'unexpectedToken'],
    ['[A].[B]', 'unexpectedToken'], ['1..2', 'badNumber'], ['1.', 'badNumber'], ['12abc', 'badNumber'], ['#2026-10-21 25:00:00#', 'badDate'],
    ['#21/10/2026#', 'badDate'], ['#2026-10-21', 'badDate'], ['a ; b', 'unexpectedToken'], ['[]', 'unexpectedToken'], ['x = Not y', 'unexpectedToken'],
    ['IIf(1, 2, 3, 4)', 'arity'], ['a And', 'unexpectedEnd'], ['x In ()', 'unexpectedToken'], ['x Is 5', 'unexpectedToken'],
  ])('error codes %s', (src, code) => expect(() => parseCanonical(src)).toThrow(expect.objectContaining({ code })));

  it('error spans are character offsets', () => {
    const err = (s: string) => { try { parseCanonical(s); } catch (e) { return (e as ExprSyntaxError).span; } };
    expect(err('1 + Foo(2)')).toEqual({ start: 4, end: 7 });
    expect(err('1 + "abc')).toEqual({ start: 4, end: 8 });
    expect(err('1 +')).toEqual({ start: 3, end: 3 });
    expect(err('1 2')).toEqual({ start: 2, end: 3 });
    expect(err('IIf(1)')).toEqual({ start: 0, end: 3 });
  });

  it('literals', () => {
    expect(parseCanonical('1.50')).toEqual({ k: 'num', v: '1.5' });
    expect(parseCanonical('007')).toEqual({ k: 'num', v: '7' });
    expect(parseCanonical('0.0')).toEqual({ k: 'num', v: '0' });
    expect(parseCanonical('.25')).toEqual({ k: 'num', v: '0.25' });
    expect(parseCanonical('12345678901234567890.123456789')).toEqual({ k: 'num', v: '12345678901234567890.123456789' });
    expect(parseCanonical('-3')).toEqual({ k: 'un', op: '-', e: { k: 'num', v: '3' } });
    expect(parseCanonical('#2026-10-21#')).toEqual({ k: 'date', v: '2026-10-21 00:00:00' });
    expect(parseCanonical('#2024-02-29 08:00:01#')).toEqual({ k: 'date', v: '2024-02-29 08:00:01' });
    expect(parseCanonical('tRuE')).toEqual({ k: 'bool', v: true });
    expect(parseCanonical('NULL')).toEqual({ k: 'null' });
    expect(parseCanonical('"a;b,c"')).toEqual({ k: 'str', v: 'a;b,c' });
    expect(parseCanonical('Prix')).toEqual({ k: 'id', name: 'Prix' });
    expect(parseCanonical('Été_2')).toEqual({ k: 'id', name: 'Été_2' });
    expect(parseCanonical('[Prix "TTC" été]')).toEqual({ k: 'id', name: 'Prix "TTC" été' });
    expect(serialize(parseCanonical('Prix'))).toBe('[Prix]');
    expect(serialize(parseCanonical('[And] And [Or]'))).toBe('[And] And [Or]');
  });

  it('keywords are case-insensitive and canonically cased', () => {
    expect(serialize(parseCanonical('a AND b or NOT c xor d'))).toBe('[a] And [b] Or Not [c] Xor [d]');
    expect(serialize(parseCanonical('x is not null'))).toBe('[x] Is Not Null');
    expect(serialize(parseCanonical('x not like "a*"'))).toBe('[x] Not Like "a*"');
    expect(serialize(parseCanonical('x not between 1 and 2'))).toBe('[x] Not Between 1 And 2');
    expect(serialize(parseCanonical('x not in (1)'))).toBe('[x] Not In (1)');
    expect(serialize(parseCanonical('a mod b'))).toBe('[a] Mod [b]');
  });

  it('precedence and associativity', () => {
    expect(parseCanonical('1 - 2 - 3')).toMatchObject({ k: 'bin', op: '-', l: { k: 'bin', op: '-' } });
    expect(parseCanonical('2 ^ 3 ^ 2')).toMatchObject({ k: 'bin', op: '^', l: { k: 'bin', op: '^' } });
    expect(parseCanonical('7 \\ 2 Mod 3')).toMatchObject({ k: 'bin', op: 'Mod', l: { op: '\\' } });
    expect(parseCanonical('1 + 2 Mod 3')).toMatchObject({ op: '+', r: { op: 'Mod' } });
    expect(parseCanonical('1 + 2 & 3')).toMatchObject({ op: '&', l: { op: '+' } });
    expect(parseCanonical('1 & 2 = 3')).toMatchObject({ op: '=', l: { op: '&' } });
    expect(parseCanonical('a = 1 And b = 2 Or c = 3')).toMatchObject({ op: 'Or', l: { op: 'And' } });
    expect(parseCanonical('a Or b Xor c')).toMatchObject({ op: 'Xor', l: { op: 'Or' } });
    expect(parseCanonical('Not a = b')).toMatchObject({ k: 'un', op: 'Not', e: { op: '=' } });
    expect(parseCanonical('2 ^ -1')).toMatchObject({ op: '^', r: { k: 'un', op: '-' } });
    expect(parseCanonical('-2 * 3')).toMatchObject({ op: '*', l: { k: 'un' } });
  });

  it.each([
    ['(1 + 2) * 3', '(1 + 2) * 3'], ['2 ^ (3 ^ 2)', '2 ^ (3 ^ 2)'], ['(2 ^ 3) ^ 2', '2 ^ 3 ^ 2'],
    ['1 - (2 - 3)', '1 - (2 - 3)'], ['(1 - 2) - 3', '1 - 2 - 3'], ['Not (a And b)', 'Not ([a] And [b])'],
    ['(a And b) And c', '[a] And [b] And [c]'], ['a And (b And c)', '[a] And ([b] And [c])'],
    ['a And (b Or c)', '[a] And ([b] Or [c])'], ['(a Or b) And c', '([a] Or [b]) And [c]'],
    ['(-2) ^ 2', '(-2) ^ 2'], ['-(2 ^ 2)', '-2 ^ 2'], ['-(1 + 2)', '-(1 + 2)'], ['2 ^ -(3 ^ 2)', '2 ^ -(3 ^ 2)'],
    ['2 * -3', '2 * -3'], ['(1 + 2) = 3', '1 + 2 = 3'], ['1 = (2 = 3)', '1 = (2 = 3)'], ['(a = b) = c', '[a] = [b] = [c]'],
    ['x = (y Like "a")', '[x] = ([y] Like "a")'], ['(a Or b) Between 1 And 2', '([a] Or [b]) Between 1 And 2'],
    ['x Between (1 = 1) And 2', '[x] Between (1 = 1) And 2'], ['(a = b) Like c', '[a] = [b] Like [c]'],
    ['x In (a Or b, 2)', '[x] In ([a] Or [b], 2)'], ['(Not a) = b', '(Not [a]) = [b]'], ['Not Not a', 'Not Not [a]'],
    ['a & (b & c)', '[a] & ([b] & [c])'], ['a \\ (b * c)', '[a] \\ [b] * [c]'], ['(a \\ b) * c', '([a] \\ [b]) * [c]'],
    ['a * (b \\ c)', '[a] * ([b] \\ [c])'], ['(a Xor b) Or c', '([a] Xor [b]) Or [c]'], ['a Xor (b Or c)', '[a] Xor [b] Or [c]'],
    ['(x Is Null) And y', '[x] Is Null And [y]'], ['(x Is Null) = True', '[x] Is Null = True'],
    // a double negation is never printed `--` (a comment opener in SQL); a stored `--a` is still read
    ['--a', '- -[a]'], ['-(-a)', '- -[a]'], ['- - -1', '- - -1'], ['2 ^ - -3', '2 ^ - -3'], ['1 - -a', '1 - -[a]'],
  ])('parenthesization %s', (src, out) => {
    expect(serialize(parseCanonical(src))).toBe(out);
    expect(parseCanonical(out)).toEqual(parseCanonical(src)); // the tree is preserved, not just the text
  });

  it('a \\ b * c is a \\ (b * c)', () => {
    expect(parseCanonical('a \\ b * c')).toEqual(parseCanonical('a \\ (b * c)'));
    expect(parseCanonical('a \\ b * c')).toMatchObject({ op: '\\', r: { op: '*' } });
  });

  const SAMPLES = [
    '1+2*3', '-2^2', '2^-1', '(1+2)*3', '2^(3^2)', '1-(2-3)', 'Not (a And b)', 'Not a = b And c', 'a Or b And c Xor d',
    '[A] & "x" & [B]', 'a Mod 3 = 0 And Not [b]', '"Il dit ""oui"""', '#2026-10-21#', '#2026-10-21 14:05:00#',
    '[N° client] Between 1 And 10', 'x Not Between 1 And 10 And y', 'x In (1, 2, 3)', 'x Not In ("a", "b")',
    'iif([a] Is Null, 0, [a])', 'IIf(a > 1, "gros", "petit") & "!"', 'Nz([a], 0) * -[b] ^ 2', 'Left([Nom], 3) Like "A*"',
    '(a = b) = c', 'a = (b = c)', '-(-3)', '- - 3', '1.50 + .5', '[Prix "TTC" été] * 1.2', 'x Is Not Null Or y Is Null',
    'a \\ b \\ c', 'a \\ (b \\ c)', 'a Like "x" & "y"', '(a Like "x") Like "y"', 'Round(1.005, 2) <> 1', 'Date() - 7 > [d]',
    'True And Not False Or Null Is Null', 'x In (IIf(a, 1, 2), 3 + 4, -5)', '(a Or b) Between 1 And 2',
  ];
  it.each(SAMPLES)('stable round trip %s', (src) => {
    const once = serialize(parseCanonical(src));
    expect(serialize(parseCanonical(once))).toBe(once);
    expect(parseCanonical(once)).toEqual(parseCanonical(src)); // the tree itself is preserved
  });

  it('fieldRefs', () => {
    expect(fieldRefs(parseCanonical('[A] + [b] * [a]'))).toEqual(['A', 'b']);
    expect(fieldRefs(parseCanonical('IIf(x Between a And [Été], y In (z, é), 1) Like w'))).toEqual(['x', 'a', 'Été', 'y', 'z', 'é', 'w']);
    expect(fieldRefs(parseCanonical('Été + été'))).toEqual(['Été']);
    expect(fieldRefs(parseCanonical('>[x]', { criteria: true }))).toEqual(['x']);
  });

  it('the function table is injectable', () => {
    expect(parseCanonical('Foo(1)', { functions: { Foo: { min: 1, max: 1 } } })).toEqual({ k: 'call', name: 'Foo', args: [{ k: 'num', v: '1' }] });
    expect(() => parseCanonical('Foo(1, 2)', { functions: { Foo: { min: 1, max: 1 } } })).toThrow(expect.objectContaining({ code: 'arity' }));
  });
});

describe('nesting limits', () => {
  it('deep nesting is a typed tooComplex error, never a stack overflow', () => {
    const nested = (k: number) => '('.repeat(k) + '1' + ')'.repeat(k);
    expect(() => parseCanonical(nested(150))).not.toThrow();
    for (const src of [nested(300), nested(5000), '-'.repeat(5000) + '1', 'Not '.repeat(3000) + 'True', 'Abs('.repeat(400) + '1' + ')'.repeat(400)]) {
      expect(() => parseCanonical(src)).toThrow(expect.objectContaining({ name: 'ExprSyntaxError', code: 'tooComplex' }));
    }
    expect(() => parseCanonical(nested(300), { criteria: true })).toThrow(expect.objectContaining({ code: 'tooComplex' }));
  });
});

describe('operand limit', () => {
  it('a left-associative chain of more than 2000 operands is tooComplex', () => {
    const chain = (k: number, op = ' + ') => Array(k).fill('1').join(op);
    expect(() => parseCanonical(chain(2000))).not.toThrow();
    for (const [k, op] of [[2001, ' + '], [5000, ' & '], [3000, ' And '], [2500, ' < '], [2001, ' ^ '], [20000, ' ^ ']] as const) {
      expect(() => parseCanonical(chain(k, op)), op).toThrow(expect.objectContaining({ name: 'ExprSyntaxError', code: 'tooComplex' }));
    }
  });
});

// ---- A3 Task 1: query expressions ----------------------------------------------------------------------------

const Q = { qualified: true };
const oneSelect: SelectQuery = { k: 'select', distinct: false, items: [{ e: { k: 'num', v: '1' } }], from: [], groupBy: [], orderBy: [] };
const env = () => ({ field: () => null, now: () => new Date(), locale: 'fr-FR' });

/** Minimal `SELECT e FROM [T]` reader for the subquery hook (the real one is Task 2's sql-parser). */
function subquery(toks: Token[], pos: number): { q: SelectQuery; end: number } {
  const { e, end } = parseExprAt(toks, pos + 1, SUBQ);
  const [from, t] = [toks[end]!, toks[end + 1]!];
  if (from.v.toLowerCase() !== 'from' || t.t !== 'id') throw new Error('stub: SELECT e FROM [T] only');
  return { q: { ...oneSelect, items: [{ e }], from: [{ k: 'source', name: t.v }] }, end: end + 2 };
}
const SUBQ: ParseOptions = { qualified: true, stopWords: new Set(['from']), subquery };
const printSub = (q: SelectQuery): string =>
  `SELECT ${serializeWith((q.items[0] as { e: Expr }).e, SUB_DIALECT)} FROM [${(q.from[0] as { name: string }).name}]`;
const SUB_DIALECT = { ...CANONICAL_DIALECT, sub: printSub };

describe('query expressions', () => {
  it.each([
    ['[Clients].[Nom] & "x"', '[Clients].[Nom] & "x"'], ['Clients.Nom = 1', '[Clients].[Nom] = 1'], ["'l''été'", '"l\'été"'],
    ['Sum([Commandes].[Montant]) / Count(*)', 'Sum([Commandes].[Montant]) / Count(*)'], ['StDev([Montant])', 'StDev([Montant])'],
    ['[T].F + T.[G]', '[T].[F] + [T].[G]'], [`'a' & "b" & 'c'''`, `"a" & "b" & "c'"`],
  ])('query expr %s', (src, out) => expect(serialize(parseCanonical(src, Q))).toBe(out));

  it('qualified refs: tree, and T.* is not a reference', () => {
    expect(parseCanonical('[T].[F]', Q)).toEqual({ k: 'id', name: 'F', table: 'T' });
    expect(parseCanonical('[F]', Q)).toEqual({ k: 'id', name: 'F' }); // no table key: sameTree with A2 trees
    expect(() => parseCanonical('T.*', Q)).toThrow(expect.objectContaining({ code: 'unexpectedToken' }));
    expect(() => parseCanonical('[T].[]', Q)).toThrow(expect.objectContaining({ code: 'unexpectedToken' }));
    expect(parseExprAt(tokenize('T.* FROM'), 0, Q)).toMatchObject({ e: { k: 'id', name: 'T' }, end: 1 }); // sql-parser reads T.*
  });

  it('qualified refs and subqueries are opt-in', () => {
    expect(() => parseCanonical('[T].[F]')).toThrow(expect.objectContaining({ code: 'unexpectedToken' }));
    expect(() => parseCanonical('[a] In (SELECT [b] FROM [T])', Q)).toThrow(expect.objectContaining({ code: 'subqueryNotAllowed' }));
    for (const s of ['(select 1 FROM [T])', 'Exists (SELECT 1 FROM [T])', '[a] Not In (SELECT 1 FROM [T])']) {
      let err: ExprSyntaxError | undefined;
      try { parseCanonical(s, { criteria: true }); } catch (e) { err = e as ExprSyntaxError; }
      expect(err, s).toMatchObject({ code: 'subqueryNotAllowed', span: { start: s.search(/select/i), end: s.search(/select/i) + 6 } });
    }
  });

  it('parseExprAt stops at a stop word', () => {
    const toks = tokenize('[a] + 1 AS [x] FROM [T]');
    expect(parseExprAt(toks, 0, { stopWords: new Set(['as', 'from']) })).toMatchObject({ e: { k: 'bin', op: '+' }, end: 3 });
    expect(parseExprAt(toks, 4, {})).toEqual({ e: { k: 'id', name: 'x' }, end: 5 });
    // a stop word is never read as a field; a function call of the same name still is one
    expect(() => parseExprAt(tokenize('[a] + FROM'), 0, { stopWords: new Set(['from']) }))
      .toThrow(expect.objectContaining({ code: 'unexpectedToken', span: { start: 6, end: 10 } }));
    expect(parseExprAt(tokenize('Left([a], 1) LEFT JOIN'), 0, { stopWords: new Set(['left']) })).toMatchObject({ e: { k: 'call', name: 'Left' }, end: 6 });
    expect(parseExprAt(tokenize('[From] + 1'), 0, { stopWords: new Set(['from']) }).end).toBe(3); // bracketed: a field
  });

  it('subqueries: scalar, Exists and [Not] In, printed through Dialect.sub', () => {
    const s = (src: string, o: ParseOptions = SUBQ) => serializeWith(parseCanonical(src, o), SUB_DIALECT);
    expect(parseCanonical('[a] In (SELECT [b] FROM [T])', SUBQ))
      .toEqual({ k: 'inSub', e: { k: 'id', name: 'a' }, not: false, q: { ...oneSelect, items: [{ e: { k: 'id', name: 'b' } }], from: [{ k: 'source', name: 'T' }] } });
    expect(parseCanonical('exists(select 1 from T)', SUBQ)).toMatchObject({ k: 'sub', mode: 'exists' });
    expect(s('[a] not in (select [T].[b] from T) And Not Exists (SELECT 1 FROM [U])')).toBe('[a] Not In (SELECT [T].[b] FROM [T]) And Not Exists (SELECT 1 FROM [U])');
    expect(s('(SELECT Max([b]) FROM [T]) + 1 > [c]')).toBe('(SELECT Max([b]) FROM [T]) + 1 > [c]');
    expect(s('[a] = (SELECT (SELECT 1 FROM [V]) FROM [U])')).toBe('[a] = (SELECT (SELECT 1 FROM [V]) FROM [U])');
    expect(s('[a] In (1, 2) Or [b] In (SELECT 1 FROM [T])')).toBe('[a] In (1, 2) Or [b] In (SELECT 1 FROM [T])');
    expect(() => serialize(parseCanonical('Exists (SELECT 1 FROM [T])', SUBQ))).toThrow(); // no printer given
    expect(hasAggregate(parseCanonical('[a] In (SELECT Sum([b]) FROM [T])', SUBQ))).toBe(false); // the subquery's own aggregate
    expect(fieldRefs(parseCanonical('[a] In (SELECT [b] FROM [T])', SUBQ))).toEqual(['a']);
  });

  it('criteria mode: In (SELECT …) and a lone scalar subquery apply to the subject', () => {
    const c = (src: string) => serializeWith(parseCanonical(src, { ...SUBQ, criteria: true }), SUB_DIALECT);
    expect(c('In (SELECT [b] FROM [T])')).toBe('<subject> In (SELECT [b] FROM [T])');
    expect(c('Not In (SELECT [b] FROM [T]) Or Is Null')).toBe('<subject> Not In (SELECT [b] FROM [T]) Or <subject> Is Null');
    expect(c('(SELECT Max([b]) FROM [T])')).toBe('<subject> = (SELECT Max([b]) FROM [T])');
    expect(c('> (SELECT Avg([b]) FROM [T])')).toBe('<subject> > (SELECT Avg([b]) FROM [T])');
    expect(c('Exists (SELECT 1 FROM [T])')).toBe('Exists (SELECT 1 FROM [T])'); // a condition: no subject
  });

  it('display form: a subquery stays canonical SQL', () => {
    const FR = { lang: 'fr' as const, region: localeInfo('fr-FR') };
    const o = { ...SUBQ, printSub };
    const canon = '[Prix] > (SELECT Max(IIf([b] > 1.5, [b], 0)) FROM [T]) Or Exists (SELECT "a;b" FROM [U]) And [c] = 2.5';
    const shown = '[Prix] > (SELECT Max(IIf([b] > 1.5, [b], 0)) FROM [T]) Ou Exists (SELECT "a;b" FROM [U]) Et [c] = 2,5';
    expect(toDisplay(canon, FR, o)).toBe(shown);
    expect(toCanonical(shown, FR, o)).toBe(canon);
    const crit = { ...o, criteria: true };
    expect(toDisplay('Not In (SELECT [T].[b] FROM [T]) Or > 1.5', FR, crit)).toBe('Pas Dans (SELECT [T].[b] FROM [T]) Ou > 1,5');
    expect(toCanonical('pas dans (SELECT [T].[b] FROM [T]) ou > 1,5', FR, crit)).toBe('Not In (SELECT [T].[b] FROM [T]) Or > 1.5');
  });

  it('evaluator: aggregates keep aggregateContext, subqueries give badArgument', async () => {
    await expect(evaluate(parseCanonical('StDev([a])'), env())).rejects.toMatchObject({ code: 'aggregateContext' });
    await expect(evaluate({ k: 'sub', mode: 'scalar', q: oneSelect }, env())).rejects.toMatchObject({ code: 'badArgument' });
    await expect(evaluate({ k: 'inSub', e: { k: 'num', v: '1' }, q: oneSelect, not: false }, env())).rejects.toMatchObject({ code: 'badArgument' });
    const field = (name: string, table?: string) => str(`${table ?? '-'}.${name}`);
    expect(await evaluate(parseCanonical('[T].[F] & F', Q), { ...env(), field })).toEqual(str('T.F-.F'));
  });

  it('catalog: return types; StDev/Var appended after the foundation aggregates', () => {
    for (const f of FUNCTIONS) expect(f.ret, f.name).toBeDefined();
    expect([...AGGREGATES]).toEqual(['Sum', 'Avg', 'Count', 'Min', 'Max', 'First', 'Last', 'StDev', 'StDevP', 'Var', 'VarP']);
    const ret = (n: string) => FUNCTIONS.find((f) => f.name === n)?.ret;
    expect([ret('Left'), ret('Len'), ret('CCur'), ret('DateAdd'), ret('IsNull'), ret('Nz'), ret('Sum'), ret('IIf'), ret('VarP')])
      .toEqual(['shortText', 'number', 'currency', 'dateTime', 'yesNo', 'arg0', 'arg0', 'arg1', 'number']);
  });

  it('limits are shared with the subqueries: tooComplex, never a stack overflow', () => {
    const [P, C] = [(k: number) => '('.repeat(k), (k: number) => ')'.repeat(k)];
    const chain = (k: number) => Array(k).fill('1').join(' + ');
    const tooComplex = expect.objectContaining({ name: 'ExprSyntaxError', code: 'tooComplex' });
    for (const src of [
      `${P(198)}(SELECT ${P(198)}1${C(198)} FROM [T])${C(198)}`,
      `${P(198)}(SELECT ${P(198)}(SELECT 1 FROM [T])${C(198)} FROM [T])${C(198)}`,
      `(SELECT ${chain(1999)} FROM [T]) + ${chain(1999)}`,
      `${chain(1999)} + (SELECT ${chain(1999)} FROM [T])`,
    ]) expect(() => parseCanonical(src, SUBQ), src.slice(0, 40)).toThrow(tooComplex);
    expect(() => parseCanonical(chain(2000))).not.toThrow(); // the failed parse left no budget behind
    // nesting is a depth (sibling subqueries do not add up); operands count over the whole tree
    const ok = `${P(90)}(SELECT ${P(90)}1${C(90)} FROM [T])${C(90)} + (SELECT ${P(100)}1${C(100)} FROM [T]) + (SELECT ${chain(900)} FROM [T]) + ${chain(900)}`;
    const e = parseCanonical(ok, SUBQ);
    const FR = { lang: 'fr' as const, region: localeInfo('fr-FR') };
    expect(() => serializeWith(e, SUB_DIALECT)).not.toThrow();
    expect(() => toDisplay(ok, FR, { ...SUBQ, printSub })).not.toThrow();
  });

  it('the shared accumulator covers the appended names', () => {
    const acc = createAccumulator('StDev', 'number'); for (const v of [2, 4, 4, 4, 5, 5, 7, 9]) acc.add(num(v));
    expect((acc.result() as { v: number }).v).toBeCloseTo(Math.sqrt(32 / 7), 12);
  });
});

// ---- A3 Task 2: Task 1 review minors (lexer subquery switch, ASCII rule, typed error without printSub) -----------

describe('display lexing of subqueries', () => {
  const FR = { lang: 'fr' as const, region: localeInfo('fr-FR') };
  const o = { ...SUBQ, printSub };

  it('a function-call parenthesis is never a subquery: display lexing goes on', () => {
    expect(toCanonical('Gauche(select; 2) & Somme(Select)', FR)).toBe('Left([select], 2) & Sum([Select])');
    expect(toCanonical('Gauche(select; 2)', FR, o)).toBe('Left([select], 2)');
  });

  it('Exists (SELECT …) does open a subquery: canonical inside, display after', () => {
    expect(toCanonical('Pas Exists (SELECT 1.5 FROM [T]) Ou [c] = 1,5', FR, o)).toBe('Not Exists (SELECT 1.5 FROM [T]) Or [c] = 1.5');
    expect(toDisplay('Not Exists (SELECT 1.5 FROM [T]) Or [c] = 1.5', FR, o)).toBe('Pas Exists (SELECT 1.5 FROM [T]) Ou [c] = 1,5');
  });

  it('SELECT is recognised by one ASCII-only rule in the lexer and the parser (ſ is not s)', () => {
    expect(toCanonical('[a] * (ſelect + 1,5)', FR)).toBe('[a] * ([ſelect] + 1.5)');
    expect(toCanonical('[a] Dans (SeLeCt [b] FROM [T]) Ou [c] = 1,5', FR, o)).toBe('[a] In (SELECT [b] FROM [T]) Or [c] = 1.5');
    expect(parseCanonical('(ſelect)', SUBQ)).toEqual({ k: 'id', name: 'ſelect' });
  });

  it('nested parentheses inside a subquery are counted: canonical up to its own closing parenthesis', () => {
    expect(toCanonical('(SELECT IIf((1 > 0), 1.5, 2) FROM [T]) + 2,5', FR, o)).toBe('(SELECT IIf(1 > 0, 1.5, 2) FROM [T]) + 2.5');
    const toks = tokenize('(SELECT IIf((1 > 0), 1.5, 2) FROM [T]) + 2,5', { ...CANONICAL_LEX, decimalSep: ',', listSep: ';' });
    expect(toks.filter((t) => t.t === 'num').map((t) => t.v)).toEqual(['1', '0', '1.5', '2', '2.5']);
  });

  it('a subquery without printSub is a typed ExprSyntaxError, never a plain Error', () => {
    const typed = expect.objectContaining({ name: 'ExprSyntaxError', code: 'subqueryNotAllowed' });
    expect(() => toCanonical('[a] Dans (SELECT [b] FROM [T])', FR, SUBQ)).toThrow(typed);
    expect(() => toCanonical('Dans (SELECT [b] FROM [T])', FR, { ...SUBQ, criteria: true })).toThrow(typed);
    expect(() => toDisplay('[a] In (SELECT [b] FROM [T])', FR, SUBQ)).toThrow(typed);
    expect(() => toDisplay('In (SELECT [b] FROM [T])', FR, { ...SUBQ, criteria: true })).toThrow(typed);
  });
});
