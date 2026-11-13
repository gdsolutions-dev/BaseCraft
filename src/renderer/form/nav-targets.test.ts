import { describe, expect, it } from 'vitest';
import { parseTargets } from './nav-targets';

describe('parseTargets', () => {
  it('reads Caption|form:Name and Caption|report:Name lines', () => {
    expect(parseTargets(['Clients|form:Fiche clients', 'Ventes | report:Ventes par mois', 'form:Seul', 'Odd|x|FORM: Majuscule '])).toEqual([
      { caption: 'Clients', kind: 'form', name: 'Fiche clients' }, { caption: 'Ventes', kind: 'report', name: 'Ventes par mois' },
      { caption: 'Seul', kind: 'form', name: 'Seul' }, { caption: 'Odd|x', kind: 'form', name: 'Majuscule' }]);
  });
  it('drops what names no form or report, and anything that is not a list of text', () => {
    expect(parseTargets(['Clients', 'A|table:T', 'B|form:', '|form:', 3, null])).toEqual([]);
    for (const v of [undefined, null, 'form:A', 3, {}]) expect(parseTargets(v)).toEqual([]);
  });
});
