import { describe, expect, it } from 'vitest';
import { chartFamily, chartStack, isEmptySpec, readChartSeries, readChartSpec, seriesName } from './spec';

describe('readChartSpec', () => {
  it('lit les valeurs par défaut', () => {
    expect(readChartSpec({})).toEqual({ type: 'columnClustered', source: null, axis: [], dateGroup: 'none', legend: '', values: [], series: [] });
  });
  it('tolère un document édité à la main', () => {
    const s = readChartSpec({ ChartType: 'weird', ChartValues: [{ field: 'M', agg: 'zzz' }, { agg: 'sum' }], ChartAxis: 'x' });
    expect(s).toMatchObject({ type: 'columnClustered', values: [{ field: 'M', agg: 'sum' }], axis: [] });
  });
  it('plafonne les listes et nettoie les textes', () => {
    expect(readChartSpec({ ChartAxis: Array.from({ length: 9 }, (_, i) => `A${i}`) }).axis).toHaveLength(8);
    expect(readChartSpec({ ChartValues: Array.from({ length: 20 }, () => ({ field: 'M', agg: 'sum' })) }).values).toHaveLength(16);
    expect(readChartSpec({ ChartLegend: `  ${'x'.repeat(300)} ` }).legend).toHaveLength(255);
    expect(readChartSpec({ ChartAxis: [' Pays ', 3] }).axis).toEqual(['Pays']);
  });
  it('lit la source, le regroupement de dates et le type', () => {
    const s = readChartSpec({ ChartSource: { kind: 'table', name: 'T' }, ChartDateGroup: 'month', ChartType: 'pie', ChartValues: [{ field: 'M', agg: 'none' }] });
    expect(s).toMatchObject({ source: { kind: 'table', name: 'T' }, dateGroup: 'month', type: 'pie', values: [{ field: 'M', agg: 'none' }] });
    expect(readChartSpec({ ChartSource: 3, ChartDateGroup: 'week' })).toMatchObject({ source: null, dateGroup: 'none' });
  });
});

describe('seriesName et isEmptySpec', () => {
  it('nomme les séries comme Access', () => {
    expect(seriesName({ field: 'Montant', agg: 'sum' })).toBe('SumOfMontant');
    expect(seriesName({ field: 'Nom', agg: 'count' })).toBe('CountOfNom');
    expect(seriesName({ field: 'Montant', agg: 'none' })).toBe('Montant');
  });
  it('détecte une spécification vide', () => {
    expect(isEmptySpec(readChartSpec({}))).toBe(true);
    expect(isEmptySpec(readChartSpec({ ChartAxis: ['A'] }))).toBe(false);
  });
});

describe('formes hostiles', () => {
  it('source : champs en trop ignorés, nom nettoyé et non vide', () => {
    expect(readChartSpec({ ChartSource: { kind: 'table', name: 'T', extra: 1 } }).source).toEqual({ kind: 'table', name: 'T' });
    expect(readChartSpec({ ChartSource: { kind: 'query', name: '  Q  ' } }).source).toEqual({ kind: 'query', name: 'Q' });
    expect(readChartSpec({ ChartSource: { kind: 'table', name: 'x'.repeat(300) } }).source).toEqual({ kind: 'table', name: 'x'.repeat(255) });
    expect(readChartSpec({ ChartSource: { kind: 'table', name: '   ' } }).source).toBeNull();
  });
  it('__proto__ ne fabrique ni source ni valeur', () => {
    expect(readChartSpec({ ChartSource: JSON.parse('{"__proto__":{"kind":"sql","sql":"x"}}') }).source).toBeNull();
    const values = readChartSpec({ ChartValues: JSON.parse('[{"__proto__":{"field":"x","agg":"sum"}}]') }).values;
    expect(values).toEqual([]);
  });
});
describe('famille et empilement', () => {
  it('déduit la famille et le mode d’empilement du type', () => {
    expect(chartStack('columnStacked100')).toBe('percent');
    expect(chartStack('areaStacked')).toBe('stack');
    expect(chartStack('line')).toBe('none');
    expect(chartFamily('areaStacked')).toBe('area');
    expect(chartFamily('barStacked100')).toBe('bar');
    expect(chartFamily('lineStacked')).toBe('line');
    expect(chartFamily('pie')).toBe('pie');
  });
  it('lit les nouveaux types, rejette les autres', () => {
    expect(readChartSpec({ ChartType: 'areaStacked100' }).type).toBe('areaStacked100');
    expect(readChartSpec({ ChartType: 'areaStacked101' }).type).toBe('columnClustered');
  });
});

describe('readChartSeries', () => {
  const values = [{ field: 'Montant', agg: 'sum' }, { field: 'Remise', agg: 'avg' }];
  it('ignore un champ absent de ChartValues, un type inconnu devient column', () => {
    expect(readChartSeries({ ChartValues: values, ChartSeries: [{ field: 'Nope' }, { field: 'remise', type: 'zzz', secondary: true }, { field: 'Montant', type: 'line' }] }))
      .toEqual([{ field: 'Remise', type: 'column', secondary: true }, { field: 'Montant', type: 'line' }]);
  });
  it('secondary doit être booléen, color un ColorValue, nom nettoyé', () => {
    const s = readChartSeries({ ChartValues: values, ChartSeries: [{ field: 'Montant', secondary: 'oui', color: 'nimporte', name: ' N ' }, { field: 'Remise', color: 'theme:accent2' }, 3, null] });
    expect(s).toEqual([{ field: 'Montant', name: 'N' }, { field: 'Remise', color: 'theme:accent2' }]);
  });
  it('lit la mise en forme (étiquettes, bordure, tendance, courbe) et ignore les valeurs invalides', () => {
    const ok = { field: 'Montant', dataLabels: true, borderColor: '#ff0000', trendline: 'linear', trendlineName: ' T ', lineWidth: 3, dash: 'dashed', marker: false, gap: 'connect' };
    expect(readChartSeries({ ChartValues: values, ChartSeries: [ok] })).toEqual([{ ...ok, trendlineName: 'T' }]);
    const bad = { field: 'Montant', dataLabels: 'oui', borderColor: 'rouge', trendline: 'cubic', trendlineName: 3, lineWidth: 99, dash: 'wavy', marker: 1, gap: 'jump' };
    expect(readChartSeries({ ChartValues: values, ChartSeries: [bad] })).toEqual([{ field: 'Montant' }]);
    expect(readChartSeries({ ChartValues: values, ChartSeries: [{ field: 'Montant', lineWidth: NaN }, { field: 'Montant', lineWidth: 0 }] })).toEqual([{ field: 'Montant' }, { field: 'Montant' }]);
  });
  it('au plus 16 ; tolère un non-tableau', () => {
    const many = Array.from({ length: 20 }, () => ({ field: 'Montant' }));
    expect(readChartSeries({ ChartValues: values, ChartSeries: many })).toHaveLength(16);
    expect(readChartSeries({ ChartValues: values, ChartSeries: 'x' })).toEqual([]);
  });
  it('radar et combiné ont leur famille', () => {
    expect(chartFamily('radar')).toBe('radar'); expect(chartFamily('radarFilled')).toBe('radar'); expect(chartFamily('combo')).toBe('combo');
    expect(chartStack('combo')).toBe('none');
  });
});
