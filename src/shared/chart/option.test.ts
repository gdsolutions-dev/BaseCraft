import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { DEFAULT_THEME } from '../design/theme';
import { chartFormatIssue, chartFrame, chartOption, cumulativeShares, chartTooltip, readChartFormat, sampleFor, SAMPLE_ROWS, waterfallSteps, type ChartFormat } from './option';
import { chartPalette } from './palette';
import type { ChartColumn, ChartData } from './query';
import { typeHintKey, type ChartSpec } from './spec';
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

describe('anneau, arc et entonnoir (F5)', () => {
  const rows = plain([['A', 3], ['B', 5]]);
  const kinds = ['doughnut', 'arc', 'funnel'] as const;
  it('anneau : une série pie, trou non nul, plus grand avec DoughnutHoleSize 70, arrondi à 2 décimales', () => {
    const o = opt(spec('doughnut'), rows);
    expect(o.series).toHaveLength(1);
    expect(o.series[0]).toMatchObject({ type: 'pie', data: [{ name: 'A', value: 3 }, { name: 'B', value: 5 }] });
    expect(o.series[0].radius).toEqual(['38.5%', '70%']);
    expect(opt(spec('doughnut'), rows, fmt({ holeSize: 70 })).series[0].radius[0]).toBe('49%');
  });
  it('arc : demi-anneau de 9 h à 3 h par le haut, centre bas, aucun texte au centre', () => {
    const o = opt(spec('arc'), rows);
    expect(o.series[0]).toMatchObject({ type: 'pie', startAngle: 180, endAngle: 0, clockwise: true, center: ['50%', '80%'], radius: ['55%', '100%'] });
    expect(o.graphic).toBeUndefined();
  });
  it('arc : géométrie du SVG, première part à gauche et toutes au-dessus de la ligne du centre', () => {
    const f = fmt();
    const svg = chartSvg(chartOption(spec('arc'), plain([['A', 1], ['B', 1], ['C', 1], ['D', 1]]), f, pal, size), size);
    // Extrémités de chaque part (M, L, A : deux derniers nombres) ; les parts sont les chemins remplis d'une couleur de série.
    const slices = [...svg.matchAll(/<path d="(M[^"]+)"[^>]*ecmeta_data_index/g)].map((m) => [...m[1]!.matchAll(/([MLA])([^MLAZ]+)/g)].map((c) => {
      const n = c[2]!.trim().split(/[\s,]+/).map(Number);
      return [n[n.length - 2]!, n[n.length - 1]!] as [number, number];
    }));
    expect(slices).toHaveLength(4);
    const baseline = slices[0]![0]![1];   // le diamètre : la part gauche y commence et la part droite y finit
    const centerX = (slices[0]![0]![0] + slices[3]![slices[3]!.length - 2]![0]) / 2;
    expect(slices[0]![0]![0]).toBeLessThan(centerX);
    for (const pts of slices) for (const p of pts) expect(p[1]).toBeLessThanOrEqual(baseline + 0.5);
    expect(slices[3]![slices[3]!.length - 2]![1]).toBeCloseTo(baseline, 0);
    const xs = slices.map((pts) => pts[1]![0]);   // fin de l'arc externe : de gauche à droite dans l'ordre de la légende
    expect([...xs].sort((a, b) => a - b)).toEqual(xs);
  });
  it('entonnoir : valeur décroissante puis libellé, négative et NULL écartées', () => {
    const o = opt(spec('funnel'), plain([['A', 3], ['B', 5], ['C', 3], ['D', -1], ['E', null]]));
    expect(o.series[0]).toMatchObject({ type: 'funnel', sort: 'none', data: [{ name: 'B', value: 5 }, { name: 'A', value: 3 }, { name: 'C', value: 3 }] });
    expect(o.series[0].top).toBeDefined();
  });
  it('entonnoir sans étape dessinable : aucune série', () => {
    expect(opt(spec('funnel'), plain([['A', null], ['B', -2]])).series).toEqual([]);
  });
  it.each(kinds)('%s : la légende est ignorée (parts sommées par catégorie)', (t) => {
    const o = opt(spec(t, { legend: 'Produit' }), legended([['A', 'X', 1], ['A', 'Y', 2], ['B', 'X', 3]]));
    expect(o.series[0].data.map((d: { value: number }) => d.value).sort()).toEqual([3, 3]);
    expect(o.series).toHaveLength(1);
  });
  it.each(kinds)('%s : sans légende (hasLegend faux), JSON sans fonction ni undefined, info-bulle par élément', (t) => {
    const o = opt(spec(t), rows);
    expect(o.legend).toBeUndefined();
    expect(JSON.parse(JSON.stringify(o))).toEqual(o);
    expect(opt(spec(t), rows, fmt({ hasLegend: true })).legend.show).toBe(true);
    expect(chartTooltip(spec(t), o)).toEqual({ trigger: 'item' });
  });
  it('info-bulle par élément aussi pour nuage de points, bulles et boîte, par axe pour les colonnes', () => {
    for (const t of ['scatter', 'bubble', 'boxWhisker'] as const) expect(chartTooltip(spec(t), {})).toEqual({ trigger: 'item' });
    expect(chartTooltip(spec('columnClustered'), {})).toEqual({ trigger: 'axis' });
  });
  const full = fmt({ hasTitle: true, title: 'Ventes', hasLegend: true });
  const data = plain([['Lyon', 3], ['Paris', 5], ['Nice', 2]]);
  it.each(kinds)('%s : golden, déterministe, sans NaN', (t) => {
    const make = () => chartSvg(chartOption(spec(t), data, full, pal, size), size);
    const svg = make();
    if (process.env.UPDATE_GOLDEN) writeFileSync(golden(t), svg);
    expect(svg).toBe(readFileSync(golden(t), 'utf8'));
    expect(make()).toBe(svg);
    expect(svg).not.toMatch(/NaN|undefined/);
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

describe('mise en forme F5', () => {
  const rf = (props: Record<string, unknown>, labels: object = {}) => readChartFormat(props, { title: 'T', empty: '', ...labels });
  it('trou, bulle maximale, cascade : défauts et valeurs hors plage', () => {
    expect(rf({}).holeSize).toBe(55); expect(rf({}).bubbleMax).toBe(40);
    expect(rf({ DoughnutHoleSize: 5 }).holeSize).toBe(55); expect(rf({ DoughnutHoleSize: 70 }).holeSize).toBe(70); expect(rf({ DoughnutHoleSize: 5.5 }).holeSize).toBe(55);
    expect(rf({ BubbleMaxSize: 'x' }).bubbleMax).toBe(40); expect(rf({ BubbleMaxSize: 100 }).bubbleMax).toBe(100);
    expect(rf({}).waterfall).toEqual({ increase: 'theme:accent1', decrease: 'theme:accent2', total: 'theme:accent3', showTotal: true });
    expect(rf({ WaterfallIncreaseColor: 'nope' }).waterfall.increase).toBe('theme:accent1');
    expect(rf({ WaterfallDecreaseColor: '#112233', WaterfallShowTotal: false }).waterfall).toMatchObject({ decrease: '#112233', showTotal: false });
  });
  it('libellés du total et du cumul', () => {
    expect([rf({}).total, rf({}).cumulative]).toEqual(['Total', 'Cumulative %']);
    expect([rf({}, { total: 'Somme', cumulative: 'Cumul %' }).total, rf({}, { total: 'Somme', cumulative: 'Cumul %' }).cumulative]).toEqual(['Somme', 'Cumul %']);
  });
  it('chartFormatIssue refuse les valeurs F5 invalides', () => {
    expect(chartFormatIssue({ BubbleMaxSize: 500 })).toMatch(/BubbleMaxSize/);
    expect(chartFormatIssue({ DoughnutHoleSize: 5.5 })).toMatch(/DoughnutHoleSize/);
    expect(chartFormatIssue({ WaterfallTotalColor: 'x' })).toMatch(/WaterfallTotalColor/);
    expect(chartFormatIssue({ WaterfallShowTotal: 'yes' })).toMatch(/WaterfallShowTotal/);
    expect(chartFormatIssue({ DoughnutHoleSize: 55, BubbleMaxSize: 40, WaterfallShowTotal: true, WaterfallIncreaseColor: 'theme:accent1' })).toBeNull();
  });
});

describe('nuage de points et bulles (F5)', () => {
  const xcol: ChartColumn = { role: 'category', field: 'Qte', name: 'Qte' };
  const xy = (rows: ChartData['rows']): ChartData => ({ columns: [xcol, val], rows, truncated: false });
  const xyl = (rows: ChartData['rows']): ChartData => ({ columns: [xcol, leg, val], rows, truncated: false });
  const poids: ChartColumn = { role: 'value', field: 'Poids', name: 'Poids' };
  const xys = (rows: ChartData['rows']): ChartData => ({ columns: [xcol, val, poids], rows, truncated: false });
  const sc = spec('scatter', { axis: ['Qte'] });
  const bu = spec('bubble', { axis: ['Qte'], values: [{ field: 'Montant', agg: 'none' }, { field: 'Poids', agg: 'none' }] });
  const diam = (s: { data: { symbolSize: number }[] }): number[] => s.data.map((p) => p.symbolSize);
  it('nuage : une série scatter, axes numériques, points triés par X puis Y', () => {
    const o = opt(sc, xy([[3, 2], [1, 5], [1, 4]]));
    expect(o.xAxis.type).toBe('value');
    expect(o.yAxis.type).toBe('value');
    expect(o.series).toHaveLength(1);
    expect(o.series[0]).toMatchObject({ type: 'scatter', name: 'SumOfMontant', symbolSize: 8, itemStyle: { opacity: 0.75 }, data: [[1, 4], [1, 5], [3, 2]] });
    expect(opt(sc, xy([[1, 10], [3, 20]])).series[0].data).toEqual([[1, 10], [3, 20]]);
  });
  it('légende : une série par valeur', () => {
    const o = opt(spec('scatter', { axis: ['Qte'], legend: 'Produit' }), xyl([[1, 'X', 2], [2, 'Y', 3], [3, 'X', 4]]));
    expect(o.series.map((s: { name: string; data: unknown[] }) => [s.name, s.data.length])).toEqual([['X', 2], ['Y', 1]]);
  });
  it('X NULL ou texte : point écarté (jamais NaN) ; texte numérique lu ; aucun point : option vide', () => {
    expect(opt(sc, xy([[null, 1], ['abc', 2], ['12', 3], [4, null]])).series[0].data).toEqual([[12, 3]]);
    const o = opt(sc, xy([['abc', 1], [null, 2]]));
    expect(o.series).toEqual([]);
    expect(o.xAxis).toEqual({ show: false });
    expect(JSON.stringify(o)).not.toMatch(/NaN/);
  });
  it('sans colonne d\'axe : option vide', () => {
    expect(opt(sc, { columns: [val], rows: [[2]], truncated: false }).series).toEqual([]);
  });
  it('bulles : diamètre proportionnel à l\'aire, la plus grande vaut BubbleMaxSize', () => {
    const o = opt(bu, xys([[1, 10, 4], [2, 20, 16]]), fmt({ bubbleMax: 40 }));
    expect(o.series[0].data).toEqual([{ value: [1, 10, 4], symbolSize: 22 }, { value: [2, 20, 16], symbolSize: 40 }]);
    expect(o.series[0].symbolSize).toBeUndefined();
  });
  it('bulles : échelle commune aux séries, taille négative écartée, taille 0 ou absente : diamètre moyen', () => {
    const l = spec('bubble', { axis: ['Qte'], legend: 'Produit', values: bu.values });
    const d: ChartData = { columns: [xcol, leg, val, poids], rows: [[1, 'X', 1, 16], [2, 'Y', 2, 4], [3, 'Y', 3, -1], [4, 'Y', 4, 0], [5, 'Y', 5, null]], truncated: false };
    const o = opt(l, d, fmt({ bubbleMax: 40 }));
    expect(diam(o.series[0])).toEqual([40]);
    expect(diam(o.series[1])).toEqual([22, 22, 22]);   // 4 sur 16 = 22 ; 0 et NULL = moyen (22) ; -1 écartée
  });
  it('bulles avec une seule Valeur : toutes les bulles ont le même diamètre moyen', () => {
    const o = opt(spec('bubble', { axis: ['Qte'] }), xy([[1, 10], [2, 20]]), fmt({ bubbleMax: 40 }));
    expect(diam(o.series[0])).toEqual([22, 22]);
  });
  it('titres d\'axes : champ X et première Valeur, ou saisis ; absents sans hasAxisTitles', () => {
    const o = opt(bu, xys([[1, 10, 4]]), fmt({ hasAxisTitles: true }));
    expect([o.xAxis.name, o.yAxis.name]).toEqual(['Qte', 'SumOfMontant']);
    const t = opt(sc, xy([[1, 1]]), fmt({ axisTitleX: 'HX', axisTitleY: 'HY' }));
    expect([t.xAxis.name, t.yAxis.name]).toEqual(['HX', 'HY']);
    const n = opt(sc, xy([[1, 1]]), fmt({ hasAxisTitles: false }));
    expect([n.xAxis.name, n.yAxis.name]).toEqual([undefined, undefined]);
  });
  it('plage manuelle, format et unités : axe Y seulement ; l\'axe X prend la police des abscisses', () => {
    const o = opt(sc, xy([[1, 10]]), fmt({ axisRange: 'manual', axisMin: 0, axisMax: 50, axisFormat: '0.00', axisUnits: 'thousands', axisXSize: 13 }));
    expect(o.yAxis).toMatchObject({ min: 0, max: 50 });
    expect(o.xAxis.min).toBeUndefined();
    expect(o.xAxis.max).toBeUndefined();
    expect(o.xAxis.axisLabel.formatter).toBeUndefined();
    expect(o.xAxis.axisLabel.fontSize).toBe(13);
    expect(o.yAxis.axisLabel.formatter).toBeTypeOf('function');
  });
  it('étiquettes : chaîne `{@[1]}` (valeur Y), sinon aucune', () => {
    const lab = spec('scatter', { axis: ['Qte'], series: [{ field: 'Montant', dataLabels: true }] });
    expect(opt(lab, xy([[1, 10]])).series[0].label).toMatchObject({ show: true, formatter: '{@[1]}' });
    expect(opt(sc, xy([[1, 10]])).series[0].label).toBeUndefined();
  });
  it.each([['scatter', sc, xy([[1, 10], [2, 5]])], ['bubble', bu, xys([[1, 10, 3], [2, 5, 4]])]] as const)('%s : séries sans fonction, info-bulle par élément', (_t, s, d) => {
    const o = opt(s, d, fmt({ axisFormat: '0.00' }));
    expect(JSON.parse(JSON.stringify(o.series))).toEqual(o.series);   // les axes portent un formatter (comme en F4)
    expect(chartTooltip(s, o)).toEqual({ trigger: 'item' });
  });
  const full = fmt({ hasTitle: true, title: 'Ventes', hasLegend: true });
  const gold: [string, () => string][] = [
    ['scatter-legend', () => chartSvg(chartOption(spec('scatter', { axis: ['Qte'], legend: 'Produit' }), xyl([[1, 'X', 3], [2, 'Y', 5], [3, 'X', 4], [4, 'Y', 1], [5, 'X', 6]]), full, pal, size), size)],
    ['bubble', () => chartSvg(chartOption(bu, xys([[1, 3, 4], [2, 5, 16], [3, 4, 9], [4, 1, 1]]), full, pal, size), size)],
  ];
  it.each(gold)('%s correspond au golden, déterministe, sans NaN', (name, make) => {
    const svg = make();
    if (process.env.UPDATE_GOLDEN) writeFileSync(golden(name), svg);
    expect(svg).toBe(readFileSync(golden(name), 'utf8'));
    expect(make()).toBe(svg);
    expect(svg).not.toMatch(/NaN|undefined/);
  });
});

describe('étiquettes intérieures de l\'entonnoir : contraste', () => {
  const lin = (hex: string, i: number): number => { const c = parseInt(hex.slice(i, i + 2), 16) / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
  const lum = (hex: string): number => 0.2126 * lin(hex, 1) + 0.7152 * lin(hex, 3) + 0.0722 * lin(hex, 5);
  const ratio = (a: string, b: string): number => (Math.max(lum(a), lum(b)) + 0.05) / (Math.min(lum(a), lum(b)) + 0.05);
  it.each(['light', 'dark'] as const)('palette %s : couleur de part explicite, étiquette lisible (contraste >= 4.5)', (mode) => {
    const p = chartPalette(DEFAULT_THEME, mode);
    const o = chartOption(spec('funnel'), plain([['A', 6], ['B', 5], ['C', 4], ['D', 3], ['E', 2], ['F', 1], ['G', 0]]), fmt(), p, size) as unknown as { series: { data: { itemStyle: { color: string }; label: { color: string } }[] }[] };
    expect(o.series[0]!.data).toHaveLength(7);
    for (const d of o.series[0]!.data) expect(ratio(d.itemStyle.color, d.label.color)).toBeGreaterThanOrEqual(4.5);
  });
});

describe('sampleFor (F5)', () => {
  it('F4 : les anciens types gardent SAMPLE_ROWS ; un exemple est une constante stable', () => {
    expect(sampleFor('columnClustered')).toBe(SAMPLE_ROWS);
    expect(sampleFor('funnel')).toEqual(sampleFor('funnel'));
  });
  it.each(['doughnut', 'arc', 'funnel', 'scatter', 'bubble', 'boxWhisker', 'pareto', 'waterfall'] as const)('%s : l exemple dessine au moins une série avec un point', (t) => {
    const o = opt(spec(t, { axis: ['x'], values: [{ field: 'v', agg: 'sum' }, { field: 'w', agg: 'sum' }] }), sampleFor(t));
    expect(o.series.length).toBeGreaterThan(0);
    expect(o.series[0].data.length).toBeGreaterThan(0);
    expect(JSON.stringify(o)).not.toMatch(/NaN|undefined/);
  });
  it('nuage : une légende désactive les étiquettes de données (comme en F4)', () => {
    const s = spec('scatter', { axis: ['Qte'], legend: 'Produit', series: [{ field: 'Montant', dataLabels: true }] });
    const d: ChartData = { columns: [{ role: 'category', field: 'Qte', name: 'Qte' }, leg, val], rows: [[1, 'X', 2], [2, 'Y', 3]], truncated: false };
    for (const x of opt(s, d).series) expect(x.label).toBeUndefined();
  });
});


describe('boîte à moustaches', () => {
  const ccol: ChartColumn = { role: 'category', field: 'Groupe', name: 'Groupe' };
  const v1: ChartColumn = { role: 'value', field: 'Montant', name: 'Montant' };
  const box = (rows: ChartData['rows'], cols: ChartColumn[] = [ccol, v1]): ChartData => ({ columns: cols, rows, truncated: false });
  const bs = spec('boxWhisker', { axis: ['Groupe'], values: [{ field: 'Montant', agg: 'none' }] });
  const rows: ChartData['rows'] = [['A', 1], ['A', 2], ['A', 3], ['A', 4], ['A', 5], ['A', 6], ['A', 7], ['A', 8], ['A', 9], ['A', 100], ['B', 5]];
  it('couleur et bordure de la Valeur : le remplissage (35 %) suit la couleur, la bordure suit la bordure, JSON stable', () => {
    const o = opt({ ...bs, series: [{ field: 'Montant', color: '#ff0000', borderColor: '#00ff00' }] }, box(rows));
    expect(o.series[0].itemStyle).toEqual({ color: 'rgba(255, 0, 0, 0.35)', borderColor: '#00ff00' });
    expect(JSON.parse(JSON.stringify(o)).series[0].itemStyle.borderColor).toBe('#00ff00');
    const c = opt({ ...bs, series: [{ field: 'Montant', color: '#ff0000' }] }, box(rows));
    expect(c.series[0].itemStyle.borderColor).toBe('#ff0000');
  });
  it('deux catégories, une boîte nommée par la Valeur, la valeur aberrante en nuage [catégorie, valeur]', () => {
    const o = opt(bs, box(rows));
    expect(o.xAxis).toMatchObject({ type: 'category', data: ['A', 'B'] });
    expect(o.yAxis.type).toBe('value');
    expect(o.series).toHaveLength(2);
    expect(o.series[0]).toMatchObject({ type: 'boxplot', name: 'Montant', data: [[1, 3, 5.5, 8, 9], [5, 5, 5, 5, 5]] });
    expect(o.series[1]).toMatchObject({ type: 'scatter', name: 'outliers', silent: true, data: [[0, 100]] });   // silent : jamais dans l'info-bulle
    expect(JSON.parse(JSON.stringify(o))).toEqual(o);
    expect(o.series[0].itemStyle).toEqual({ color: expect.stringMatching(/^rgba\(\d+, \d+, \d+, 0\.35\)$/), borderColor: pal.series[0] });
    expect(o.series[1].itemStyle.color).toBe(pal.series[0]);
  });
  it('une valeur aberrante est tracée à partir de [1..9, 100] et pas de [1,2,3,4,100]', () => {
    expect(opt(bs, box([['A', 1], ['A', 2], ['A', 3], ['A', 4], ['A', 100]])).series[1].data).toEqual([]);
  });
  it('catégories en points de code (B avant a), NULL en emptyLabel', () => {
    const o = opt(bs, box([['a', 1], ['B', 2], [null, 3]]), fmt({ emptyLabel: '(vide)' }));
    expect(o.xAxis.data).toEqual(['(vide)', 'B', 'a']);
  });
  it('un texte numérique est lu, un autre texte est ignoré ; une catégorie sans observation garde une case null', () => {
    const o = opt(bs, box([['A', '12'], ['A', 'x'], ['B', 'y'], ['B', null]]));
    expect(o.series[0].data).toEqual([[12, 12, 12, 12, 12], null]);
    expect(o.series[1].data).toEqual([]);
  });
  it('sans axe : une seule boîte ; la légende (colonne catégorie, légende, valeur) est ignorée', () => {
    const none = opt(spec('boxWhisker', { axis: [], values: [{ field: 'Montant', agg: 'none' }] }), box([[1], [2], [3]], [v1]));
    expect(none.series[0].data).toEqual([[1, 1, 2, 3, 3]]);
    const lcol: ChartColumn = { role: 'legend', field: 'Produit', name: 'Produit' };
    const o = opt(spec('boxWhisker', { axis: ['Groupe'], legend: 'Produit', values: [{ field: 'Montant', agg: 'none' }] }), box([['A', 'X', 1], ['A', 'Y', 3], ['B', 'X', 5]], [ccol, lcol, v1]), fmt({ hasLegend: true }));
    expect(o.series.filter((x: { type: string }) => x.type === 'boxplot')).toHaveLength(1);
    expect(o.series[0].data).toEqual([[1, 1, 2, 3, 3], [5, 5, 5, 5, 5]]);
    expect(o.legend.data).toEqual(['Montant']);   // les valeurs aberrantes n'ont pas d'entrée
  });
  it('JSON sans fonction, info-bulle par élément, golden déterministe', () => {
    const full = fmt({ hasTitle: true, title: 'Ventes', hasLegend: true });
    const make = (): string => chartSvg(chartOption(bs, box(rows), full, pal, size), size);
    const svg = make();
    const o = opt(bs, box(rows), full);
    expect(JSON.parse(JSON.stringify(o))).toEqual(o);
    expect(chartTooltip(bs, o)).toEqual({ trigger: 'item' });
    expect(svg).not.toMatch(/NaN|undefined/);
    expect(make()).toBe(svg);
    if (process.env.UPDATE_GOLDEN) writeFileSync(golden('box'), svg);
    expect(svg).toBe(readFileSync(golden('box'), 'utf8'));
  });
});

describe('Pareto', () => {
  const ps = spec('pareto');
  it('cumulativeShares : parts cumulées en pourcentage, arrondies à 2 décimales, jamais NaN', () => {
    expect(cumulativeShares([50, 30, 20])).toEqual([50, 80, 100]);
    expect(cumulativeShares([1, 1, 1])).toEqual([33.33, 66.67, 100]);
    expect(cumulativeShares([0, 0])).toEqual([0, 0]);
    expect(cumulativeShares([10, -5, 10])).toEqual([50, 50, 100]);
    expect(cumulativeShares([0.1, 0.2, 0.3])).toEqual([16.67, 50, 100]);
  });
  it('barres triées (valeur décroissante, puis libellé), courbe cumulée sur l axe secondaire fixe 0..100', () => {
    const o = opt(ps, plain([['A', 15], ['B', 40], ['C', 8]]));
    expect(o.xAxis.data).toEqual(['B', 'A', 'C']);
    expect(o.series).toHaveLength(2);
    expect(o.series[0]).toMatchObject({ type: 'bar', name: 'SumOfMontant', data: [40, 15, 8] });
    expect(o.series[1]).toMatchObject({ type: 'line', name: 'Cumulative %', yAxisIndex: 1, symbol: 'circle', smooth: false, data: [63.49, 87.3, 100] });
    expect(o.series[1].itemStyle.color).toBe(pal.series[1]);
    expect(o.yAxis).toHaveLength(2);
    expect(o.yAxis[1]).toMatchObject({ type: 'value', min: 0, max: 100, position: 'right', splitLine: { show: false }, axisLabel: { formatter: '{value}%' } });
    expect(JSON.parse(JSON.stringify(o))).toEqual(o);
  });
  it('égalités triées par libellé (points de code), le libellé de la courbe vient du format, la légende est ignorée', () => {
    const o = opt(ps, plain([['b', 5], ['B', 5], ['a', 5]]), fmt({ cumulative: 'Cumul %' }));
    expect(o.xAxis.data).toEqual(['B', 'a', 'b']);
    expect(o.series[1].name).toBe('Cumul %');
    const l = opt(spec('pareto', { legend: 'Produit' }), { columns: [cat, leg, val], rows: [['A', 'X', 1], ['A', 'Y', 2], ['B', 'X', 4]], truncated: false });
    expect(o.series).toHaveLength(2);
    expect(l.series[0].data).toEqual([4, 3]);
  });
  it('bordure et étiquettes de la Valeur sur les barres (chaîne, jamais de fonction)', () => {
    const o = opt(spec('pareto', { series: [{ field: 'Montant', borderColor: '#00ff00', dataLabels: true }] }), plain([['A', 3], ['B', 2]]));
    expect(o.series[0].itemStyle).toMatchObject({ borderColor: '#00ff00', borderWidth: 1 });
    expect(o.series[0].label).toMatchObject({ show: true });
    expect(JSON.parse(JSON.stringify(o)).series[0].label.show).toBe(true);
    const d = opt(spec('pareto'), plain([['A', 3]]));
    expect(d.series[0].label).toBeUndefined();
    expect(d.series[0].itemStyle.borderColor).toBeUndefined();
  });
  it('NULL : barre de hauteur 0 ; couleur de la Valeur ; titre de l axe de droite', () => {
    const o = opt(spec('pareto', { series: [{ field: 'Montant', color: '#ff0000' }] }), plain([['A', null], ['B', 2]]), fmt({ hasAxisTitles: true, axis2: { ...fmt().axis2, title: 'Cum.' } }));
    expect(o.series[0].data).toEqual([2, 0]);
    expect(o.series[0].itemStyle.color).toBe('#ff0000');
    expect(o.yAxis[1].name).toBe('Cum.');
    expect(opt(ps, plain([['A', 1]]), fmt({ hasAxisTitles: true })).yAxis[1].name).toBe('Cumulative %');
    expect(opt(ps, plain([['A', 1]]), fmt({ hasAxisTitles: false })).yAxis[1].name).toBeUndefined();
  });
  it('zéro ligne : option vide (aucune série), jamais undefined ; l aide du type reste celle de Pareto', () => {
    const o = opt(ps, plain([]));
    expect(o.series).toEqual([]);
    expect(JSON.stringify(o)).not.toMatch(/undefined|NaN/);
    expect(typeHintKey(ps)).toBe('chart.settings.typeHint.pareto');
    expect(opt(ps, { columns: [cat], rows: [['A']], truncated: false }).series).toEqual([]);   // aucune Valeur
  });
  it('golden déterministe', () => {
    const full = fmt({ hasTitle: true, title: 'Ventes', hasLegend: true });
    const make = (): string => chartSvg(chartOption(ps, plain([['A', 15], ['B', 40], ['C', 8], ['D', 25], ['E', 12]]), full, pal, size), size);
    const svg = make();
    expect(svg).not.toMatch(/NaN|undefined/);
    expect(make()).toBe(svg);
    if (process.env.UPDATE_GOLDEN) writeFileSync(golden('pareto'), svg);
    expect(svg).toBe(readFileSync(golden('pareto'), 'utf8'));
  });
});

describe('cascade', () => {
  const ws = spec('waterfall');
  const vals = (d: any[]): any[] => d.map((x) => (x !== null && typeof x === 'object' ? x.value : x));
  const byName = (o: any, name: string): any[] => o.series.filter((x: any) => x.name === name);
  it('waterfallSteps : cumul, hausse/baisse, total ; NULL = pas de 0', () => {
    expect(waterfallSteps([100, -30, 45], true)).toEqual([{ start: 0, end: 100, kind: 'increase' }, { start: 100, end: 70, kind: 'decrease' }, { start: 70, end: 115, kind: 'increase' }, { start: 0, end: 115, kind: 'total' }]);
    expect(waterfallSteps([100, -30, 45], false)).toHaveLength(3);
    expect(waterfallSteps([null, 10], true).map((x) => [x.start, x.end])).toEqual([[0, 0], [0, 10], [0, 10]]);
    expect(waterfallSteps([0.1, 0.2], false)[1]!.end).toBe(0.3);
  });
  it('série base transparente et muette, puis Hausse, Baisse, Total, toutes sur la pile wf ; légende de trois noms', () => {
    const o = opt(ws, plain([['A', 100], ['B', -30], ['C', 45]]));
    expect(o.xAxis.data).toEqual(['A', 'B', 'C', 'Total']);
    expect(o.series.map((x: any) => x.name)).toEqual(['base', 'Increase', 'Decrease', 'Total']);
    expect(o.series.every((x: any) => x.type === 'bar' && x.stack === 'wf')).toBe(true);
    expect(o.series[0]).toMatchObject({ silent: true, itemStyle: { color: 'transparent' }, data: [0, 70, 70, 0] });
    expect(vals(o.series[1].data)).toEqual([100, null, 45, null]);
    expect(vals(o.series[2].data)).toEqual([null, 30, null, null]);
    expect(vals(o.series[3].data)).toEqual([null, null, null, 115]);
    expect(o.tooltip.trigger).toBe('item');
    expect(JSON.parse(JSON.stringify(o))).toEqual(o);
  });
  it('légende : exactement Increase, Decrease, Total (base absente), localisés ; sans total, deux noms', () => {
    const o = opt(ws, plain([['A', 1], ['B', -1]]), fmt({ hasLegend: true, total: 'Gesamt', increase: 'Plus', decrease: 'Moins' }));
    expect(o.legend.data).toEqual(['Plus', 'Moins', 'Gesamt']);
    expect(o.series.map((x: any) => x.name)).toEqual(['base', 'Plus', 'Moins', 'Gesamt']);
    expect(opt(ws, plain([['A', 1]]), fmt({ hasLegend: true, waterfall: { ...fmt().waterfall, showTotal: false } })).legend.data).toEqual(['Increase', 'Decrease']);
  });
  it('passage par zéro : partie positive 50 et partie négative -30 de Baisse, base 0', () => {
    const o = opt(ws, plain([['A', 50], ['B', -80]]), fmt({ waterfall: { ...fmt().waterfall, showTotal: false } }));
    const dec = byName(o, 'Decrease');
    expect(dec).toHaveLength(2);
    expect(vals(dec[0].data)).toEqual([null, 50]);
    expect(vals(dec[1].data)).toEqual([null, -30]);
    expect(o.series[0].data).toEqual([0, 0]);
  });
  it('pas entièrement sous zéro : base négative puis barre négative', () => {
    const o = opt(ws, plain([['A', -10], ['B', -5]]), fmt({ waterfall: { ...fmt().waterfall, showTotal: false } }));
    expect(o.series[0].data).toEqual([0, -10]);
    const dec = byName(o, 'Decrease');
    expect(dec).toHaveLength(2);
    expect(vals(dec[0].data)).toEqual([null, null]);
    expect(vals(dec[1].data)).toEqual([-10, -5]);
  });
  it('total négatif : partie négative du Total ; NULL et tout à zéro : barres de hauteur 0, jamais NaN', () => {
    const o = opt(ws, plain([['A', -4]]));
    expect(byName(o, 'Total').map((x) => vals(x.data))).toEqual([[null, null], [null, -4]]);
    const z = opt(ws, plain([['A', null], ['B', 0]]));
    expect(vals(z.series[1].data)).toEqual([0, 0, null]);
    expect(JSON.stringify(z)).not.toMatch(/NaN|undefined/);
  });
  it('couleurs : accents 1, 2, 3 par défaut ; surchargées par Waterfall*Color', () => {
    const o = opt(ws, plain([['A', 1], ['B', -1]]));
    expect(o.series.slice(1).map((x: any) => x.itemStyle.color)).toEqual([pal.custom('theme:accent1'), pal.custom('theme:accent2'), pal.custom('theme:accent3')]);
    const c = opt(ws, plain([['A', 1]]), fmt({ waterfall: { increase: '#112233', decrease: '#223344', total: '#334455', showTotal: true } }));
    expect(c.series.slice(1).map((x: any) => x.itemStyle.color)).toEqual(['#112233', '#223344', '#334455']);
  });
  it('étiquettes (Valeur 1) : chaînes avec signe, total sans ; pas d étiquette sinon', () => {
    const d = plain([['A', 100], ['B', -30]]);
    expect(JSON.stringify(opt(ws, d))).not.toContain('"label"');
    const o = opt(spec('waterfall', { series: [{ field: 'Montant', dataLabels: true }] }), d);
    expect(o.series[1].data.map((x: any) => x?.label?.formatter)).toEqual(['+100', undefined, undefined]);
    expect(o.series[2].data.map((x: any) => x?.label?.formatter)).toEqual([undefined, '-30', undefined]);
    expect(o.series[3].data.map((x: any) => x?.label?.formatter)).toEqual([undefined, undefined, '70']);
    expect(o.series[0].label).toBeUndefined();
    expect(JSON.parse(JSON.stringify(o))).toEqual(o);
  });
  it('info-bulle : chaque partie visible montre la valeur signée du pas (total : le total)', () => {
    const o = opt(ws, plain([['A', 10], ['B', -4], ['C', 6], ['D', -15]]));
    const tips = (name: string): (string | undefined)[][] => byName(o, name).map((s: any) => s.data.map((x: any) => (x === null ? undefined : x.tooltip?.formatter)));
    const dec = tips('Decrease'), inc = tips('Increase'), tot = tips('Total');
    expect(dec).toHaveLength(2);
    expect(dec[0]![3]).toContain('-15');
    expect(dec[1]![3]).toContain('-15');
    expect(dec[0]![1]).toContain('-4');
    expect(inc[0]![0]).toContain('10');
    expect(inc[0]![0]).not.toContain('-');
    expect(tot[1]![4]).toContain('-3');
    expect(o.series[0].tooltip).toEqual({ show: false });
    const b = opt(ws, plain([['A', -8], ['B', 3]]));
    expect(byName(b, 'Increase').map((x: any) => x.data[1]?.tooltip?.formatter).find(Boolean)).toMatch(/: 3$/);
    expect(byName(b, 'Decrease').map((x: any) => x.data[0]?.tooltip?.formatter).find(Boolean)).toMatch(/: -8$/);
    expect(JSON.parse(JSON.stringify(o))).toEqual(o);
  });
  it('la légende du champ est ignorée (lignes d une catégorie additionnées) ; seule la première Valeur compte', () => {
    const o = opt(spec('waterfall', { legend: 'Produit' }), legended([['A', 'X', 1], ['A', 'Y', 2], ['B', 'X', -1]]), fmt({ waterfall: { ...fmt().waterfall, showTotal: false } }));
    expect(vals(o.series[1].data)).toEqual([3, null]);
    expect(vals(o.series[2].data)).toEqual([null, 1]);
  });
  it('goldens déterministes', () => {
    const full = fmt({ hasTitle: true, title: 'Ventes', hasLegend: true });
    for (const [name, rows] of [['waterfall', [['A', 100], ['B', -30], ['C', 45], ['D', -20]]], ['waterfall-cross-zero', [['A', 50], ['B', -80], ['C', 20]]]] as const) {
      const make = (): string => chartSvg(chartOption(spec('waterfall', { series: [{ field: 'Montant', dataLabels: true }] }), plain(rows.map((r) => [...r])), full, pal, size), size);
      const svg = make();
      expect(svg).not.toMatch(/NaN|undefined/);
      expect(make()).toBe(svg);
      if (process.env.UPDATE_GOLDEN) writeFileSync(golden(name), svg);
      expect(svg).toBe(readFileSync(golden(name), 'utf8'));
    }
  });
});
