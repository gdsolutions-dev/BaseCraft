import { describe, expect, it } from 'vitest';
import { localeInfo } from '../locale-format';
import { toCanonical, toDisplay, type DisplayContext } from '../expr/localize';
import { parsePythonCall, pythonCallFunctions } from './call-text';

const FR: DisplayContext = { lang: 'fr', region: localeInfo('fr-FR') };

describe('parsePythonCall', () => {
  it('reads name and arguments', () => {
    const a = parsePythonCall('=remise([Prix],[Client])');
    expect(a?.name).toBe('remise'); expect(a?.args.map((x) => x.k)).toEqual(['id', 'id']);
    expect(parsePythonCall('calculer()')).toMatchObject({ name: 'calculer', args: [] });
    expect(parsePythonCall('= f ( 1 , "a" )')?.args).toHaveLength(2);
  });
  it('refuses the rest', () => {
    for (const t of ['=Left([x],2)', '=left([x],2)', '=a()+1', '=1x()', '=f(', 'M.Sub', '']) expect(parsePythonCall(t), t).toBeNull();
  });
  it('localizes like an expression', () => {
    const t = 'remise([Prix],[Client])', f = pythonCallFunctions(t);
    const shown = toDisplay(t, FR, { functions: f });
    expect(shown).toBe('remise([Prix]; [Client])');
    expect(toCanonical(shown, FR, { functions: f })).toBe('remise([Prix], [Client])');
  });
});
