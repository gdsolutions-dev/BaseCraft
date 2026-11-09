import { describe, expect, it } from 'vitest';
import { readChartSpec, type ChartSpec } from '../../shared/chart/spec';
import { armedChartTool, isDateField, listSources, setAgg, setLegend, setSeries, setSource, specPatch, specToProps, toggleAxis, toggleValue } from './chart-settings-model';

const base: ChartSpec = { type: 'columnClustered', source: { kind: 'table', name: 'Commandes' }, axis: ['Client'], dateGroup: 'none', legend: '',
  values: [{ field: 'Montant', agg: 'sum' }] };

describe('chart settings model', () => {
  it('toggleValue adds with sum, again removes', () => {
    const a = toggleValue(base, 'Remise');
    expect(a.values).toEqual([{ field: 'Montant', agg: 'sum' }, { field: 'Remise', agg: 'sum' }]);
    expect(toggleValue(a, 'Remise').values).toEqual(base.values);
  });
  it('setAgg changes only that entry', () => {
    const a = setAgg(toggleValue(base, 'Remise'), 'Remise', 'avg');
    expect(a.values).toEqual([{ field: 'Montant', agg: 'sum' }, { field: 'Remise', agg: 'avg' }]);
  });
  it('toggleAxis keeps the checking order and cuts at 8', () => {
    let s = { ...base, axis: [] as string[] };
    for (const f of ['b', 'a', 'c', 'd', 'e', 'f', 'g', 'h', 'i']) s = toggleAxis(s, f);
    expect(s.axis).toEqual(['b', 'a', 'c', 'd', 'e', 'f', 'g', 'h']);
    expect(toggleAxis(s, 'a').axis).toEqual(['b', 'c', 'd', 'e', 'f', 'g', 'h']);
  });
  it('setLegend clears with an empty name', () => {
    expect(setLegend(setLegend(base, 'Pays'), '').legend).toBe('');
  });
  it('setSource resets the fields', () => {
    expect(setSource(base, { kind: 'query', name: 'Q' })).toMatchObject({ source: { kind: 'query', name: 'Q' }, axis: [], values: [], legend: '' });
  });
  it('listSources', () => {
    expect(listSources('tables', ['A', 'B'], ['Q'])).toEqual(['A', 'B']);
    expect(listSources('queries', ['A'], ['Q'])).toEqual(['Q']);
    expect(listSources('both', ['A', 'B'], ['Q', 'a'])).toEqual(['A', 'B', 'Q']);
  });
  it('specToProps round-trips through readChartSpec', () => {
    const s = { ...base, legend: 'Pays', dateGroup: 'month' as const, type: 'pie' as const };
    expect(readChartSpec(specToProps(s))).toEqual({ ...s, series: [] });
    expect(readChartSpec(specToProps({ ...base, source: null })).source).toBeNull();
  });
  it('specPatch holds the changed props only', () => {
    expect(specPatch(base, toggleValue(base, 'Remise'))).toEqual({ ChartValues: toggleValue(base, 'Remise').values });
    expect(specPatch(base, { ...base, source: null })).toEqual({ ChartSource: undefined });
  });
  it('armedChartTool', () => {
    expect(armedChartTool('pie').props).toEqual({ ChartType: 'pie' });
    expect(armedChartTool('pie')).toMatchObject({ kind: 'chart', locked: false });
  });
  it('isDateField', () => {
    const f = [{ name: 'Jour', type: 'dateTime' }, { name: 'X', type: 'number' }];
    expect([isDateField(f, 'jour'), isDateField(f, 'X'), isDateField(f, undefined)]).toEqual([true, false, false]);
  });
});

describe('setSeries', () => {
  const a = { field: 'Montant', name: 'M' };
  const b = { field: 'Remise', color: 'theme:accent2' as const };
  it('ajoute, fusionne par champ (sans tenir compte de la casse) et laisse les autres séries intactes', () => {
    const added = setSeries([a], 'Remise', { dataLabels: true });
    expect(added).toEqual([a, { field: 'Remise', dataLabels: true }]);
    expect(added[0]).toBe(a);
    const merged = setSeries([a, b], 'montant', { secondary: true });
    expect(merged).toEqual([{ field: 'Montant', name: 'M', secondary: true }, b]);
    expect(merged[1]).toBe(b);
  });
  it('undefined efface une option ; une série sans option disparaît', () => {
    expect(setSeries([a, b], 'Montant', { name: undefined })).toEqual([b]);
    expect(setSeries([], 'Montant', { name: undefined })).toEqual([]);
  });
  it('décocher une Valeur retire sa série, changer de source les retire toutes', () => {
    const s: ChartSpec = { ...base, values: [{ field: 'Montant', agg: 'sum' }, { field: 'Remise', agg: 'sum' }], series: [a, b] };
    expect(toggleValue(s, 'montant').series).toEqual([b]);
    expect(toggleValue(s, 'Autre').series).toEqual([a, b]);
    expect(setSource(s, null).series).toEqual([]);
  });
  it('ChartSeries entre dans le correctif, une série retirée l efface', () => {
    const s: ChartSpec = { ...base, series: [a] };
    expect(specPatch(base, s)).toEqual({ ChartSeries: [a] });
    expect(specPatch(s, { ...s, series: [] })).toEqual({ ChartSeries: undefined });
  });
});
