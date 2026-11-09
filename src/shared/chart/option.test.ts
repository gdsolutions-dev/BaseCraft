import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { DEFAULT_THEME } from '../design/theme';
import { chartFrame, chartOption, chartTooltip, readChartFormat, SAMPLE_ROWS, type ChartFormat } from './option';
import { chartPalette } from './palette';
import type { ChartColumn, ChartData } from './query';
import type { ChartSpec } from './spec';
import { chartSvg } from './svg';

const pal = chartPalette(DEFAULT_THEME, 'light');
const size = { width: 400, height: 240 };
const fmt = (o: Partial<ChartFormat> = {}): ChartFormat => ({ ...readChartFormat({}, { title: 'Chart Title', empty: '(empty)' }), hasLegend: false, hasTitle: false, ...o });
const spec = (type: ChartSpec['type'], o: Partial<ChartSpec> = {}): ChartSpec => ({ type, source: null, axis: ['Ville'], dateGroup: 'none', legend: '', values: [{ field: 'Montant', agg: 'sum' }], ...o });
const cat: ChartColumn = { role: 'category', field: 'Ville', name: 'Ville' };
const leg: ChartColumn = { role: 'legend', field: 'Produit', name: 'Produit' };
const val: ChartColumn = { role: 'value', field: 'Montant', name: 'SumOfMontant' };
const plain = (rows: ChartData['rows']): ChartData => ({ columns: [cat, val], rows, truncated: false });
const legended = (rows: ChartData['rows']): ChartData => ({ columns: [cat, leg, val], rows, truncated: false });
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const opt = (s: ChartSpec, d: ChartData | null, f = fmt()): any => chartOption(s, d, f, pal, size);
const golden = (name: string) => fileURLToPath(new URL(`./fixtures/${name}.svg`, import.meta.url));

describe('chartOption', () => {
  it('histogramme sans légende : une série bar nommée SumOfMontant', () => {
    const o = opt(spec('columnClustered'), plain([['A', 3], ['B', 5]]));
    expect(o.xAxis.data).toEqual(['A', 'B']);
    expect(o.series).toHaveLength(1);
    expect(o.series[0]).toMatchObject({ type: 'bar', name: 'SumOfMontant', data: [3, 5] });
    expect(o.animation).toBe(false);
  });
  it('avec légende : une série par valeur de légende, un trou est null', () => {
    const o = opt(spec('columnClustered', { legend: 'Produit' }), legended([['A', 'X', 1], ['A', 'Y', 2], ['B', 'X', 3]]));
    expect(o.series.map((s: { name: string; data: unknown }) => [s.name, s.data])).toEqual([['X', [1, 3]], ['Y', [2, null]]]);
  });
  it('barres : les axes sont échangés', () => {
    const o = opt(spec('barClustered'), plain([['A', 3]]));
    expect(o.yAxis.type).toBe('category');
    expect(o.xAxis.type).toBe('value');
  });
  it('courbe : type line, non lissée', () => {
    expect(opt(spec('line'), plain([['A', 3]])).series[0]).toMatchObject({ type: 'line', smooth: false });
  });
  it('secteurs : une série pie, des paires nom/valeur, pas d\'axes', () => {
    const o = opt(spec('pie'), plain([['A', 3], ['B', 5]]));
    expect(o.series).toHaveLength(1);
    expect(o.series[0]).toMatchObject({ type: 'pie', data: [{ name: 'A', value: 3 }, { name: 'B', value: 5 }] });
    expect(o.xAxis).toBeUndefined();
    expect(o.yAxis).toBeUndefined();
  });
  it('secteurs ignorent la légende : les lignes d\'une catégorie s\'additionnent', () => {
    const o = opt(spec('pie', { legend: 'Produit' }), legended([['A', 'X', 1], ['A', 'Y', 2], ['B', 'X', 3]]));
    expect(o.series[0].data).toEqual([{ name: 'A', value: 3 }, { name: 'B', value: 3 }]);
  });
  it('catégorie NULL : libellé emptyLabel', () => {
    const o = opt(spec('columnClustered'), plain([[null, 3]]), fmt({ emptyLabel: '(vide)' }));
    expect(o.xAxis.data).toEqual(['(vide)']);
  });
  it('titre : absent si hasTitle est faux, sinon dans title.text', () => {
    expect(opt(spec('line'), plain([['A', 1]])).title).toBeUndefined();
    expect(opt(spec('line'), plain([['A', 1]]), fmt({ hasTitle: true, title: '<b>T</b>' })).title.text).toBe('<b>T</b>');
  });
  it('légende en bas', () => {
    const o = opt(spec('line'), plain([['A', 1]]), fmt({ hasLegend: true, legendPosition: 'bottom' }));
    expect(o.legend.bottom).toBeDefined();
    expect(o.legend.top).toBeUndefined();
  });
  it('titres d\'axes : champs de la requête, ou rien', () => {
    const d = plain([['A', 1]]);
    expect(opt(spec('line'), d, fmt({ hasAxisTitles: true })).xAxis.name).toBe('Ville');
    expect(opt(spec('line'), d, fmt({ hasAxisTitles: false })).xAxis.name).toBeUndefined();
    expect(opt(spec('line'), { ...d, columns: [val, val] }, fmt({ hasAxisTitles: true })).xAxis.name).toBeUndefined();
  });
  it('titres d axes saisis, et lecture tolérante de la mise en forme', () => {
    const d = plain([['A', 1]]);
    const o = opt(spec('line'), d, fmt({ hasAxisTitles: true, axisTitleX: 'Villes', axisTitleY: 'Total' }));
    expect(o.xAxis.name).toBe('Villes');
    expect(o.yAxis.name).toBe('Total');
    expect(opt(spec('line'), d, fmt({ hasAxisTitles: false, axisTitleX: 'Villes' })).xAxis.name).toBeUndefined();
    const L = { title: 'Chart Title', empty: '(empty)' };
    expect(readChartFormat({ HasTitle: false, ChartTitle: 'Ventes', LegendPosition: 'bottom' }, L)).toMatchObject({ hasTitle: false, title: 'Ventes', legendPosition: 'bottom' });
    expect(readChartFormat({ LegendPosition: 'weird' }, L).legendPosition).toBe('top');
    expect(readChartFormat({}, L)).toMatchObject({ hasTitle: true, title: 'Chart Title', hasLegend: true, hasAxisTitles: true, axisTitleX: '' });
  });
  it('NaN et texte numérique sont ramenés à un nombre fini ou null', () => {
    const o = opt(spec('line'), plain([['A', NaN], ['B', '12'], ['C', 'abc'], ['D', Infinity]]));
    expect(o.series[0].data).toEqual([null, 12, null, null]);
  });
  it('la 7e série reprend la couleur 1', () => {
    const rows = Array.from({ length: 7 }, (_, i) => ['A', `S${i}`, i] as [string, string, number]);
    const o = opt(spec('columnClustered', { legend: 'Produit' }), legended(rows));
    expect(o.series).toHaveLength(7);
    expect(o.color).toEqual(pal.series);
    expect(o.color).toHaveLength(6);
  });
  it('sans donnée : pas de série, axes cachés', () => {
    for (const d of [null, plain([])]) {
      const o = opt(spec('columnClustered'), d);
      expect(o.series).toEqual([]);
      expect(o.xAxis.show).toBe(false);
    }
  });
  it('jamais de undefined dans le JSON', () => {
    const rows = legended([['A', 'X', 1], [null, 'Y', 2]]);
    for (const t of ['columnClustered', 'barClustered', 'line', 'pie'] as const) {
      const o = chartOption(spec(t, { legend: 'Produit' }), rows, fmt({ hasTitle: true, title: 'T', hasLegend: true }), pal, size);
      expect(JSON.stringify(o, (_k, v) => (v === undefined ? '__undefined__' : v))).not.toContain('__undefined__');
    }
  });
  it('SAMPLE_ROWS : 3 catégories x 2 séries', () => {
    const o = opt(spec('columnClustered', { legend: 'Series' }), SAMPLE_ROWS);
    expect(o.xAxis.data).toHaveLength(3);
    expect(o.series).toHaveLength(2);
  });
});

describe('empilé, 100 % et zone', () => {
  const two = legended([['A', 'X', 1], ['A', 'Y', 3]]);
  it('empilé : stack total sur chaque série', () => {
    const o = opt(spec('columnStacked', { legend: 'Produit' }), two);
    expect(o.series.map((s: { stack: string }) => s.stack)).toEqual(['total', 'total']);
  });
  it('100 % : parts de la catégorie, axe max 100, valeur réelle conservée', () => {
    const o = opt(spec('columnStacked100', { legend: 'Produit' }), two);
    expect(o.series[0].data).toEqual([25]);
    expect(o.series[1].data).toEqual([75]);
    expect(o.series[1].realData).toEqual([3]);
    expect(o.yAxis.max).toBe(100);
    expect(chartTooltip(spec('columnStacked100'), o).trigger).toBe('axis');
  });
  it('100 % : total nul donne des parts à 0, jamais NaN', () => {
    const o = opt(spec('columnStacked100', { legend: 'Produit' }), legended([['A', 'X', 0], ['A', 'Y', 0]]));
    expect(o.series.map((s: { data: number[] }) => s.data)).toEqual([[0], [0]]);
  });
  it('100 % : valeurs négatives, parts signées sur la somme des valeurs absolues', () => {
    const o = opt(spec('columnStacked100', { legend: 'Produit' }), legended([['A', 'X', 5], ['A', 'Y', -5]]));
    expect(o.series.map((s: { data: number[] }) => s.data)).toEqual([[50], [-50]]);
    expect(o.yAxis.min).toBe(-100);
    expect(o.yAxis.max).toBe(100);
    expect(opt(spec('columnStacked100', { legend: 'Produit' }), two).yAxis.min).toBe(0);
  });
  it('100 % : NULL reste un trou, ligne empilée 100 %', () => {
    const o = opt(spec('lineStacked100', { legend: 'Produit' }), legended([['A', 'X', 1], ['A', 'Y', 3], ['B', 'X', null], ['B', 'Y', 2]]));
    expect(o.series[0].data).toEqual([25, null]);
    expect(o.series[1].data).toEqual([75, 100]);
    expect(o.series[0].stack).toBe('total');
  });
  it('zone : series line avec areaStyle', () => {
    const o = opt(spec('area'), plain([['A', 1], ['B', 2]]));
    expect(o.series[0]).toMatchObject({ type: 'line', areaStyle: {} });
    expect(o.series[0].stack).toBeUndefined();
    const b = opt(spec('barStacked'), plain([['A', 1]]));
    expect(b.xAxis.type).toBe('value');
    expect(b.yAxis.type).toBe('category');
    expect(opt(spec('barStacked100', { legend: 'Produit' }), two).series.map((x: { stack: string }) => x.stack)).toEqual(['total', 'total']);
  });
});

describe('radar et combiné', () => {
  const rem: ChartColumn = { role: 'value', field: 'Remise', name: 'AvgOfRemise' };
  const two = (rows: ChartData['rows']): ChartData => ({ columns: [cat, val, rem], rows, truncated: false });
  it('radar : indicateurs = catégories, max arrondi au plus grand, données dans l ordre', () => {
    const o = opt(spec('radar'), plain([['A', 3.2], ['B', 7.5], ['C', 1]]));
    expect(o.radar.indicator).toEqual([{ name: 'A', max: 8, min: 0 }, { name: 'B', max: 8, min: 0 }, { name: 'C', max: 8, min: 0 }]);
    expect(o.series).toHaveLength(1);
    expect(o.series[0]).toMatchObject({ type: 'radar', data: [{ name: 'SumOfMontant', value: [3.2, 7.5, 1] }] });
    expect(o.series[0].areaStyle).toBeUndefined();
    expect(o.xAxis).toBeUndefined();
    expect(chartTooltip(spec('radar'), o).trigger).toBe('item');
  });
  it('radar : une série par valeur ou par valeur de légende, rempli = areaStyle', () => {
    const o = opt(spec('radarFilled', { legend: 'Produit' }), legended([['A', 'X', 1], ['A', 'Y', 2], ['B', 'X', 3]]));
    expect(o.series[0].areaStyle).toBeDefined();
    expect(o.series[0].data.map((d: { name: string; value: number[] }) => [d.name, d.value])).toEqual([['X', [1, 3]], ['Y', [2, 0]]]);
    expect(opt(spec('radar'), two([['A', 1, 2]])).series[0].data).toHaveLength(2);
  });
  it('radar : toutes valeurs nulles, max 1 (jamais 0)', () => {
    expect(opt(spec('radar'), plain([['A', 0], ['B', null]])).radar.indicator.map((i: { max: number }) => i.max)).toEqual([1, 1]);
  });
  it('combiné : bar + line, second axe à droite, yAxisIndex 1', () => {
    const s = spec('combo', { values: [{ field: 'Montant', agg: 'sum' }, { field: 'Remise', agg: 'avg' }], series: [{ field: 'Remise', type: 'line', secondary: true, color: '#ff0000', name: 'Rabais' }] });
    const o = opt(s, two([['A', 3, 1], ['B', 5, 2]]));
    expect(o.series.map((x: { type: string }) => x.type)).toEqual(['bar', 'line']);
    expect(o.series[1]).toMatchObject({ name: 'Rabais', yAxisIndex: 1, data: [1, 2], itemStyle: { color: '#ff0000' }, lineStyle: { color: '#ff0000' } });
    expect(o.series[0].yAxisIndex).toBeUndefined();
    expect(o.yAxis).toHaveLength(2);
    expect(o.yAxis[1].position).toBe('right');
  });
  it('combiné avec légende : type et axe de la première valeur valent pour toutes les séries, la couleur reste celle de la palette', () => {
    const o = opt(spec('combo', { legend: 'Produit', series: [{ field: 'Montant', type: 'line', secondary: true, color: '#ff0000' }] }), legended([['A', 'X', 1], ['A', 'Y', 2], ['B', 'X', 3]]));
    expect(o.series.map((x: { type: string }) => x.type)).toEqual(['line', 'line']);
    expect(o.series.map((x: { yAxisIndex: number }) => x.yAxisIndex)).toEqual([1, 1]);
    expect(o.yAxis).toHaveLength(2);
    expect(o.series.every((x: { itemStyle?: unknown }) => x.itemStyle === undefined)).toBe(true);
  });
  it('combiné sans série secondaire : un seul yAxis, colonnes par défaut ; zone = line + areaStyle', () => {
    const o = opt(spec('combo', { values: [{ field: 'Montant', agg: 'sum' }, { field: 'Remise', agg: 'avg' }], series: [{ field: 'Remise', type: 'area' }] }), two([['A', 3, 1]]));
    expect(Array.isArray(o.yAxis)).toBe(false);
    expect(o.series.map((x: { type: string }) => x.type)).toEqual(['bar', 'line']);
    expect(o.series[1].areaStyle).toBeDefined();
    expect(opt(spec('combo'), plain([['A', 3]])).series[0].type).toBe('bar');
  });
});

describe('radar : cas limites', () => {
  it('valeurs négatives : min = plancher de la plus petite valeur', () => {
    const o = opt(spec('radar'), plain([['A', -2.5], ['B', 4], ['C', 1]]));
    expect(o.radar.indicator.map((i: { min: number; max: number }) => [i.min, i.max])).toEqual([[-3, 4], [-3, 4], [-3, 4]]);
  });
  it('aucune catégorie : pas d exception, pas de radar', () => {
    const o = opt(spec('radar'), { columns: [cat, val], rows: [], truncated: false });
    expect(o.series).toEqual([]);
    expect(() => chartSvg(o, size)).not.toThrow();
  });
});

describe('mise en forme des séries', () => {
  const s1 = (type: ChartSpec['type'], series: NonNullable<ChartSpec['series']>[number], extra: Partial<ChartSpec> = {}) => spec(type, { series: [series], ...extra });
  const rows = plain([['A', 3], ['B', null], ['C', 5]]);
  it('nom, étiquettes, remplissage du thème et bordure sur un histogramme', () => {
    const o = opt(s1('columnClustered', { field: 'Montant', name: 'Mon nom', dataLabels: true, color: 'theme:accent3', borderColor: '#ff0000' }), rows);
    expect(o.series[0]).toMatchObject({ name: 'Mon nom', label: { show: true }, itemStyle: { color: pal.series[2], borderColor: '#ff0000' } });
  });
  it('sans mise en forme : ni label ni itemStyle', () => {
    const o = opt(spec('columnClustered'), rows);
    expect(o.series[0].label).toBeUndefined();
    expect(o.series[0].itemStyle).toBeUndefined();
  });
  it('options de courbe : trous, trait, épaisseur, marqueur', () => {
    const base = { field: 'Montant', lineWidth: 4, dash: 'dashed' as const, marker: false };
    const o = opt(s1('line', { ...base, gap: 'connect' }), rows);
    expect(o.series[0]).toMatchObject({ connectNulls: true, symbol: 'none', lineStyle: { width: 4, type: 'dashed' }, data: [3, null, 5] });
    expect(opt(s1('line', { ...base, gap: 'zero' }), rows).series[0].data).toEqual([3, 0, 5]);
    expect(opt(s1('line', { field: 'Montant' }), rows).series[0].connectNulls).toBeUndefined();
  });
  it('axe secondaire sur un histogramme groupé, pas empilé', () => {
    const o = opt(s1('columnClustered', { field: 'Montant', secondary: true }), rows);
    expect(o.series[0].yAxisIndex).toBe(1);
    expect(Array.isArray(o.yAxis)).toBe(true);
    expect(opt(s1('columnStacked', { field: 'Montant', secondary: true }), rows).series[0].yAxisIndex).toBeUndefined();
  });
  it('tendance : série pointillée ajoutée après les autres, nom propre ou par défaut', () => {
    const r = plain([['A', 1], ['B', 2], ['C', 3], ['D', 4]]);
    const o = opt(s1('columnClustered', { field: 'Montant', trendline: 'linear', trendlineName: 'Ma tendance' }), r);
    expect(o.series).toHaveLength(2);
    expect(o.series[1]).toMatchObject({ type: 'line', name: 'Ma tendance', lineStyle: { type: 'dashed', color: pal.series[0] } });
    expect(o.series[1].data.map((v: number) => Math.round(v))).toEqual([1, 2, 3, 4]);
    expect(opt(s1('line', { field: 'Montant', trendline: 'linear' }), r).series[1].name).toBe('SumOfMontant (linear)');
  });
  it('tendance impossible ou empilé ou barres : aucune série en plus', () => {
    const neg = plain([['A', 1], ['B', -2], ['C', 3]]);
    expect(opt(s1('line', { field: 'Montant', trendline: 'exponential' }), neg).series).toHaveLength(1);
    expect(opt(s1('columnStacked', { field: 'Montant', trendline: 'linear' }), neg).series).toHaveLength(1);
    expect(opt(s1('barClustered', { field: 'Montant', trendline: 'linear' }), neg).series).toHaveLength(1);
    expect(opt(s1('line', { field: 'Montant', trendline: 'none' }), neg).series).toHaveLength(1);
    expect(() => chartSvg(opt(s1('line', { field: 'Montant', trendline: 'power' }), neg), size)).not.toThrow();
  });
  it('nom de tendance traduit par fmt.trendNames', () => {
    const r = plain([['A', 1], ['B', 2], ['C', 3]]);
    expect(opt(s1('line', { field: 'Montant', trendline: 'movingAverage' }), r, fmt({ trendNames: { movingAverage: 'Moyenne mobile' } })).series[1].name).toBe('SumOfMontant (Moyenne mobile)');
  });
  it('avec une légende : aucune mise en forme par série (couleurs de la palette, pas de tendance)', () => {
    const s = spec('line', { legend: 'Produit', series: [{ field: 'Montant', color: '#ff0000', borderColor: '#00ff00', trendline: 'linear', dataLabels: true }] });
    const o = opt(s, legended([['A', 'X', 1], ['B', 'X', 2], ['A', 'Y', 3], ['B', 'Y', 4]]));
    expect(o.series).toHaveLength(2);
    for (const x of o.series) expect(JSON.stringify(x)).not.toMatch(/ff0000|00ff00|"label"/i);
  });
  it('rendu SVG avec tendance et étiquettes : déterministe, sans NaN', () => {
    const o = () => opt(s1('line', { field: 'Montant', trendline: 'polynomial', dataLabels: true, name: 'Ventes' }), plain([['A', 1], ['B', 4], ['C', 9], ['D', 16]]));
    const svg = chartSvg(o(), size);
    expect(svg).toBe(chartSvg(o(), size));
    expect(svg).not.toMatch(/NaN|undefined/);
    expect(svg).toContain('Ventes');
  });
});

describe('goldens', () => {
  const full = fmt({ hasTitle: true, title: 'Ventes', hasLegend: true });
  const cases: [string, () => string][] = [
    ['pie', () => chartSvg(chartOption(spec('pie'), plain([['Lyon', 3], ['Paris', 5], ['Nice', 2]]), full, pal, size), size)],
    ['bar-two-series', () => chartSvg(chartOption(spec('columnClustered', { legend: 'Produit' }), legended([['Lyon', 'X', 3], ['Lyon', 'Y', 4], ['Paris', 'X', 5], ['Paris', 'Y', 1]]), full, pal, size), size)],
    ['column-stacked100', () => chartSvg(chartOption(spec('columnStacked100', { legend: 'Produit' }), legended([['Lyon', 'X', 3], ['Lyon', 'Y', 4], ['Paris', 'X', 5], ['Paris', 'Y', 1]]), full, pal, size), size)],
    ['area-stacked', () => chartSvg(chartOption(spec('areaStacked', { legend: 'Produit' }), legended([['Jan', 'X', 3], ['Jan', 'Y', 4], ['Fév', 'X', 5], ['Fév', 'Y', 1], ['Mar', 'X', 2], ['Mar', 'Y', 2]]), full, pal, size), size)],
    ['radar', () => chartSvg(chartOption(spec('radarFilled', { legend: 'Produit' }), legended([['Lyon', 'X', 3], ['Lyon', 'Y', 4], ['Paris', 'X', 5], ['Paris', 'Y', 1], ['Nice', 'X', 2], ['Nice', 'Y', 6]]), full, pal, size), size)],
    ['combo-secondary', () => chartSvg(chartOption(spec('combo', { values: [{ field: 'Montant', agg: 'sum' }, { field: 'Remise', agg: 'avg' }], series: [{ field: 'Remise', type: 'line', secondary: true }] }),
      { columns: [cat, val, { role: 'value', field: 'Remise', name: 'AvgOfRemise' }], rows: [['Jan', 30, 0.1], ['Fév', 50, 0.3], ['Mar', 40, 0.2]], truncated: false }, full, pal, size), size)],
    ['line', () => chartSvg(chartOption(spec('line'), plain([['Jan', 3], ['Fév', 5], ['Mar', 4]]), full, pal, size), size)],
  ];
  it.each(cases)('%s correspond au golden', (name, make) => {
    const svg = make();
    if (process.env.UPDATE_GOLDEN) writeFileSync(golden(name), svg);
    expect(svg).toBe(readFileSync(golden(name), 'utf8'));
    expect(make()).toBe(svg);
  });
});

describe('mise en forme complète (T15)', () => {
  const rf = (props: Record<string, unknown>) => ({ ...readChartFormat(props, { title: 'T', empty: '(empty)' }), hasLegend: false, hasTitle: false });
  const o2 = (props: Record<string, unknown>, s = spec('columnClustered'), d = plain([['A', 1000], ['B', 2000]])) => opt(s, d, rf(props));
  it('défauts : tailles 14 / 10, sous-titre absent, plage automatique, pas de cadre', () => {
    const f = readChartFormat({}, { title: 'T', empty: '' });
    expect([f.titleSize, f.legendSize, f.subtitleSize, f.axisSize, f.axisXSize, f.hasSubtitle, f.axisRange, f.axisUnits]).toEqual([14, 10, 10, 10, 10, false, 'auto', 'none']);
    expect(chartFrame(f, pal)).toBeNull();
    expect(o2({}).backgroundColor).toBeUndefined();
    expect(o2({}).yAxis.min).toBeUndefined();
  });
  it("plage manuelle : min et max de l'axe des valeurs ; un max non numérique est ignoré", () => {
    expect(o2({ AxisRange: 'manual', AxisMin: 0, AxisMax: 100 }).yAxis).toMatchObject({ min: 0, max: 100 });
    const o = o2({ AxisRange: 'manual', AxisMin: 5, AxisMax: 'x' }).yAxis;
    expect([o.min, o.max]).toEqual([5, undefined]);
    expect(o2({ AxisRange: 'auto', AxisMin: 0, AxisMax: 100 }).yAxis.max).toBeUndefined();
    expect(o2({ AxisRange: 'manual', AxisMin: 10, AxisMax: 10 }).yAxis.max).toBeUndefined();
  });
  it("barres : la plage va sur l'axe horizontal (valeurs)", () => {
    expect(o2({ AxisRange: 'manual', AxisMax: 9 }, spec('barClustered')).xAxis.max).toBe(9);
  });
  it('unités : les étiquettes sont divisées (1, 2 et non 1000)', () => {
    const f = o2({ AxisUnits: 'thousands' }).yAxis.axisLabel.formatter;
    expect([f(1000), f(2000), f(2500)]).toEqual(['1', '2', '2.5']);
    expect(o2({}).yAxis.axisLabel.formatter).toBeUndefined();
  });
  it("unités : sur barres, elles s'appliquent à l'axe horizontal", () => {
    const f = o2({ AxisUnits: 'thousands' }, spec('barClustered')).xAxis.axisLabel.formatter;
    expect([f(1000), f(2500)]).toEqual(['1', '2.5']);
  });
  it("axe secondaire : titre, plage, unités et police propres ; l'axe principal n'est pas touché ; ignoré sans axe secondaire", () => {
    const combo = spec('combo', { values: [{ field: 'Montant', agg: 'sum' }, { field: 'Remise', agg: 'avg' }], series: [{ field: 'Remise', type: 'line', secondary: true }] });
    const d: ChartData = { columns: [cat, val, { role: 'value', field: 'Remise', name: 'AvgOfRemise' }], rows: [['A', 1000, 5000], ['B', 2000, 9000]], truncated: false };
    const o = o2({ AxisSecTitle: 'Taux', AxisSecRange: 'manual', AxisSecMin: 0, AxisSecMax: 20000, AxisSecUnits: 'thousands', AxisSecFontSize: 12, AxisSecFontColor: '#ff0000' }, combo, d);
    const [y1, y2] = o.yAxis;
    expect(y2).toMatchObject({ name: 'Taux', min: 0, max: 20000, axisLabel: { fontSize: 12 } });
    expect([y2.axisLabel.formatter(5000), y1.min, y1.max, y1.axisLabel.formatter, y1.axisLabel.fontSize]).toEqual(['5', undefined, undefined, undefined, 10]);
    expect(rf({ AxisSecRange: 'manual', AxisSecMin: 'x', AxisSecMax: 5, AxisSecUnits: 'lots' }).axis2).toMatchObject({ min: null, max: 5, units: 'none' });
    expect(o2({ AxisSecRange: 'manual', AxisSecMax: 5, AxisSecUnits: 'thousands' }).yAxis.max).toBeUndefined();
  });
  it("format d'axe : décimales, séparateur de milliers, préfixe et suffixe", () => {
    const f = (fm: string) => o2({ AxisFormat: fm }).yAxis.axisLabel.formatter;
    expect(f('0.00')(2)).toBe('2.00');
    expect(f('#,##0 €')(1234567)).toBe('1,234,567 €');
    expect(o2({ AxisFormat: 'texte' }).yAxis.axisLabel.formatter).toBeUndefined();
  });
  it("couleurs : une valeur qui n'est pas une ColorValue retombe sur le défaut", () => {
    const o = o2({ AxisFontColor: 'rouge', AxisXFontColor: '#ff0000', LegendFontColor: 42 });
    expect(o.yAxis.axisLabel.color).toBe(pal.text);
    expect(o.xAxis.axisLabel.color).toBe('#ff0000');
    expect(readChartFormat({ LegendFontColor: 42 }, { title: '', empty: '' }).legendColor).toBe('theme:text');
  });
  it('tailles : hors 6-72 ou non entières, retour au défaut', () => {
    const f = readChartFormat({ TitleFontSize: 200, LegendFontSize: 'x', AxisFontSize: 12 }, { title: '', empty: '' });
    expect([f.titleSize, f.legendSize, f.axisSize]).toEqual([14, 10, 12]);
  });
  it('titre, sous-titre et légende reçoivent leur taille et leur couleur', () => {
    const f = { ...readChartFormat({ TitleFontSize: 20, TitleFontColor: '#112233', HasSubtitle: true, Subtitle: 'Sous', SubtitleFontSize: 8, LegendFontSize: 12 }, { title: 'T', empty: '' }), hasLegend: true };
    const o = opt(spec('columnClustered'), plain([['A', 1]]), f);
    expect(o.title.text).toBe('T');
    expect(o.title.textStyle).toMatchObject({ fontSize: 20, color: '#112233' });
    expect(o.title).toMatchObject({ subtext: 'Sous', subtextStyle: { fontSize: 8 } });
    expect(o.legend.textStyle.fontSize).toBe(12);
  });
  it('sous-titre coupé : pas de subtext', () => {
    const o = opt(spec('columnClustered'), plain([['A', 1]]), readChartFormat({ HasSubtitle: false, Subtitle: 'S' }, { title: 'T', empty: '' }));
    expect(o.title.subtext).toBeUndefined();
  });
  it('police du titre : famille embarquée, une police non portable devient Liberation Sans', () => {
    expect(pal.font('Carlito')).toContain('Carlito');
    expect(pal.font('Police Inconnue')).toBe(pal.font('Liberation Sans'));
    expect(pal.font('(Body)')).toBe(pal.fontFamily);
  });
  it('fond et cadre', () => {
    const f = readChartFormat({ ChartBackStyle: 'normal', ChartBackColor: '#00ff00', ChartBorderStyle: 'dashed', ChartBorderWidth: 2, ChartBorderColor: '#0000ff' }, { title: '', empty: '' });
    expect(o2({ ChartBackStyle: 'normal', ChartBackColor: '#00ff00' }).backgroundColor).toBe('#00ff00');
    expect(chartFrame(f, pal)).toEqual({ width: 2, style: 'dashed', color: '#0000ff' });
    expect(chartFrame(readChartFormat({ ChartBorderStyle: 'solid', ChartBorderWidth: 0 }, { title: '', empty: '' }), pal)?.width).toBe(1);
    expect(chartFrame(readChartFormat({ ChartBorderStyle: 'bizarre' }, { title: '', empty: '' }), pal)).toBeNull();
  });
});
