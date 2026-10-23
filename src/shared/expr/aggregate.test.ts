// Fonctions d'agrégat (contrat 1.5) : catalogue, Count(*), refus hors contexte par l'évaluateur et par compileSql.
import { describe, expect, it } from 'vitest';
import { AGGREGATES, FUNCTIONS } from './catalog';
import { evaluate } from './evaluate';
import { toCanonical, toDisplay } from './localize';
import { parseCanonical, serialize } from './parser';
import { compileSql } from './sql';
import { localeInfo } from '../locale-format';

const fr = { lang: 'fr' as const, region: localeInfo('fr-FR') };
const en = { lang: 'en' as const, region: localeInfo('en-US') };
const env = { field: () => ({ t: 'num' as const, v: 1 }), now: () => new Date(), locale: 'fr-FR' };
const ctx = { fields: [{ name: 'Montant', type: 'currency' as const }], locale: 'fr-FR' };

describe('aggregate functions', () => {
  it('are in the catalog, category aggregate, one argument', () => {
    const agg = FUNCTIONS.filter((f) => f.category === 'aggregate').map((f) => [f.name, f.fr, f.min, f.max]);
    expect(agg).toEqual([['Sum', 'Somme', 1, 1], ['Avg', 'Moyenne', 1, 1], ['Count', 'Compte', 1, 1], ['Min', 'Min', 1, 1],
      ['Max', 'Max', 1, 1], ['First', 'Premier', 1, 1], ['Last', 'Dernier', 1, 1],
      ['StDev', 'EcartType', 1, 1], ['StDevP', 'EcartTypeP', 1, 1], ['Var', 'Var', 1, 1], ['VarP', 'VarP', 1, 1]]);
    expect([...AGGREGATES]).toEqual(['Sum', 'Avg', 'Count', 'Min', 'Max', 'First', 'Last', 'StDev', 'StDevP', 'Var', 'VarP']);
  });

  it('Count(*) gives a star node, only as the argument of Count', () => {
    expect(parseCanonical('count(*)')).toEqual({ k: 'call', name: 'Count', args: [{ k: 'star' }] });
    expect(serialize(parseCanonical('Count(*) + Sum([Montant])'))).toBe('Count(*) + Sum([Montant])');
    for (const s of ['Sum(*)', '*', 'Count(* + 1)', 'Count(*, 1)', 'Len(*)']) expect(() => parseCanonical(s), s).toThrow();
  });

  it('round-trips through the displayed forms', () => {
    expect(toDisplay('Count(*)', fr)).toBe('Compte(*)');
    expect(toCanonical('compte(*)', fr)).toBe('Count(*)');
    expect(toDisplay('Sum([Montant]) / Count(*)', fr)).toBe('Somme([Montant]) / Compte(*)');
    expect(toCanonical('Somme([Montant]) / Compte(*)', fr)).toBe('Sum([Montant]) / Count(*)');
    expect(toDisplay('Avg([Montant])', en)).toBe('Avg([Montant])');
    expect(toCanonical('Premier([Montant]) & Dernier([Montant])', fr)).toBe('First([Montant]) & Last([Montant])');
  });

  it('outside a group context: the evaluator and compileSql refuse them with aggregateContext', async () => {
    for (const s of ['Sum([Montant])', 'Count(*)', '1 + Max([Montant])', 'Len(First([Montant]))']) {
      await expect(evaluate(parseCanonical(s), env), s).rejects.toMatchObject({ name: 'ExprRuntimeError', code: 'aggregateContext' });
      expect(() => compileSql(parseCanonical(`${s} > 0`), ctx), s).toThrow(expect.objectContaining({ name: 'ExprRuntimeError', code: 'aggregateContext' }));
    }
  });
});
