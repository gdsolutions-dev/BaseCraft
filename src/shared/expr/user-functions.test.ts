import { afterEach, describe, expect, it } from 'vitest';
import { ExprSyntaxError } from './ast';
import { parseCanonical } from './parser';
import { refineUnknownFunction, setUserFunctions, userFunctionNames, userFunctionsVersion, withUserFunctions } from './user-functions';

afterEach(() => setUserFunctions([]));

describe('user functions registry', () => {
  it('parses a registered name as a call, refuses it otherwise', () => {
    setUserFunctions(['Remise']);
    expect(parseCanonical('remise([Prix])', { functions: withUserFunctions() })).toMatchObject({ k: 'call', name: 'Remise' });   // the export's spelling
    expect(userFunctionNames().has('remise')).toBe(true);   // membership stays folded
    expect(() => parseCanonical('remise([Prix])')).toThrow(expect.objectContaining({ code: 'unknownFunction' }));
  });
  it('never overrides a built-in', () => {
    setUserFunctions(['left']);
    expect(() => parseCanonical('Left("a")', { functions: withUserFunctions() })).toThrow(expect.objectContaining({ code: 'arity' }));
    expect(parseCanonical('left("a",1)', { functions: withUserFunctions() })).toMatchObject({ name: 'Left' });
  });
  it('versions and memoizes', () => {
    const v = userFunctionsVersion();
    setUserFunctions(['a']);
    expect(userFunctionsVersion()).toBe(v + 1);
    expect(withUserFunctions()).toBe(withUserFunctions());
    const t = withUserFunctions();
    setUserFunctions(['a']);
    expect(withUserFunctions()).not.toBe(t);
  });
  it('refineUnknownFunction names the Python function', () => {
    setUserFunctions(['remise']);
    const err = (t: string) => { try { parseCanonical(t); } catch (e) { return e as ExprSyntaxError; } throw new Error('no error'); };
    const r = refineUnknownFunction(err('remise(1)'), 'remise(1)');
    expect(r.code).toBe('pythonNotAllowed');
    expect(r.fn).toBe('remise');
    expect(refineUnknownFunction(err('autre(1)'), 'autre(1)').code).toBe('unknownFunction');
  });
});
