import { describe, expect, it } from 'vitest';
import { evaluate } from './evaluate';
import { bool, date, fail, num, str } from './library';
import { bindMembers, literalOf, MEMBER_ROOTS } from './members';
import { parseCanonical, serialize } from './parser';
import { compileSql } from './sql';

describe('member references', () => {
  it('roots: French names and arity', () => {
    expect(MEMBER_ROOTS.TempVars).toEqual({ fr: 'VarTemp', arity: 2 });
    expect(MEMBER_ROOTS.Forms).toEqual({ fr: 'Formulaires', arity: 3 });
    expect(MEMBER_ROOTS.Reports.fr).toBe('États');
  });

  it('bare names and three-part chains parse', () => {
    expect(parseCanonical('TempVars!Total')).toEqual({ k: 'member', path: ['TempVars', 'Total'] });
    expect(parseCanonical('[Formulaires]![F]![C]')).toEqual({ k: 'member', path: ['Forms', 'F', 'C'] });
    expect(() => parseCanonical('[TempVars]![a]![b]')).toThrow(expect.objectContaining({ code: 'badMember' }));
    expect(() => parseCanonical('[TempVars]!')).toThrow();
  });

  it('evaluates through env.member', async () => {
    const env = { field: () => null, now: () => new Date(), locale: 'fr-FR',
      member: (p: string[]) => (p[1] === 'n' ? num(3) : fail('unknownField')) };
    expect(await evaluate(parseCanonical('[TempVars]![n] + 1'), env)).toEqual(num(4));
    await expect(evaluate(parseCanonical('[TempVars]![x]'), env)).rejects.toMatchObject({ code: 'unknownField' });
    await expect(evaluate(parseCanonical('[TempVars]![n]'), { field: () => null, now: () => new Date(), locale: 'fr-FR' }))
      .rejects.toMatchObject({ code: 'unknownField' });
  });

  it('literalOf', () => {
    expect(literalOf(num(1.5))).toEqual({ k: 'num', v: '1.5' });
    expect(literalOf(num(-2))).toEqual({ k: 'un', op: '-', e: { k: 'num', v: '2' } });
    expect(literalOf(str('a'))).toEqual({ k: 'str', v: 'a' });
    expect(literalOf(bool(true))).toEqual({ k: 'bool', v: true });
    expect(literalOf(null)).toEqual({ k: 'null' });
    expect(literalOf(date(46316.5))).toEqual({ k: 'date', v: '2026-10-21 12:00:00' });
  });

  it('binds values as literals, never as SQL', async () => { // Review Focus 3
    const e = await bindMembers(parseCanonical('[Ville] = [TempVars]![v]'), async () => str(`x' OR 1=1 --`));
    expect(serialize(e)).toBe(`[Ville] = "x' OR 1=1 --"`);
    const sql = compileSql(e, { fields: [{ name: 'Ville', type: 'shortText' }], locale: 'fr-FR' });
    expect(sql.params).toContain(`x' OR 1=1 --`);
    expect(sql.sql).not.toContain('OR 1=1');
  });
});
