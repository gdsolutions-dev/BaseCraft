import { describe, expect, it } from 'vitest';
import { chartKey, chartRequest } from './chart-view';
import { readChartSpec } from '../../../shared/chart/spec';

const doc = { kind: 'table', name: 'Commandes' } as const;
const own = { kind: 'query', name: 'Q' } as const;
const values = [{ field: 'Montant', agg: 'sum' }];

describe('chartRequest', () => {
  it('prend ChartSource quand il est donné, sinon la source du document', () => {
    expect(chartRequest(readChartSpec({ ChartSource: own, ChartValues: values }), doc)?.source).toEqual(own);
    expect(chartRequest(readChartSpec({ ChartValues: values }), doc)?.source).toEqual(doc);
  });
  it('null sans source, ou sans valeurs', () => {
    expect(chartRequest(readChartSpec({ ChartValues: values }), null)).toBeNull();
    expect(chartRequest(readChartSpec({ ChartSource: own }), doc)).toBeNull();
  });
  it('transmet les valeurs de paramètres du document', () => {
    expect(chartRequest(readChartSpec({ ChartValues: values }), doc, { p: 1 })?.params).toEqual({ p: 1 });
  });
  describe('liaison père/fils', () => {
    const spec = readChartSpec({ ChartValues: values });
    it('filtre sur les champs fils avec les valeurs du père', () => {
      expect(chartRequest(spec, doc, undefined, { master: ['Id'], child: ['Client'], values: [7] })?.link).toEqual({ fields: ['Client'], values: [7] });
    });
    it('null sans valeurs du père, ou avec des nombres de champs différents', () => {
      expect(chartRequest(spec, doc, undefined, { master: ['Id'], child: ['Client'], values: null })).toBeNull();
      expect(chartRequest(spec, doc, undefined, { master: ['Id', 'X'], child: ['Client'], values: [1] })).toBeNull();
    });
    it('une valeur Null (nouvel enregistrement) reste une demande : [Client] = NULL ne trouve rien', () => {
      expect(chartRequest(spec, doc, undefined, { master: ['Id'], child: ['Client'], values: [null] })?.link?.values).toEqual([null]);
    });
    it('sans champs de liaison, aucune liaison', () => {
      expect(chartRequest(spec, doc, undefined, { master: [], child: [], values: null })?.link).toBeUndefined();
    });
    it('une valeur hostile reste une valeur (jamais du texte SQL)', () => {
      const r = chartRequest(spec, doc, undefined, { master: ['Id'], child: ['Client'], values: ["O'Brien'; DROP TABLE x;--"] });
      expect(r?.link?.values).toEqual(["O'Brien'; DROP TABLE x;--"]);
      expect(JSON.stringify(r?.spec)).not.toContain('DROP');
    });
  });
});

describe('chartKey', () => {
  const req = chartRequest(readChartSpec({ ChartValues: values }), doc);
  it('change avec la version (enregistrement, Requery), pas sans', () => {
    expect(chartKey(req, 1)).not.toBe(chartKey(req, 2));
    expect(chartKey(req, 1)).toBe(chartKey(req, 1));
    expect(chartKey(null, 3)).toBe('');
  });
});
