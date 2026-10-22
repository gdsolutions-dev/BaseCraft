import { describe, expect, it } from 'vitest';
import { ExprSyntaxError } from './ast';
import { fieldRefs, parseCanonical, serialize } from './parser';

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
