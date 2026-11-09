// Option ECharts d'un graphique (F4) : histogramme, barres, courbe, zone, secteurs, radar, combiné. Une seule option sert l'écran (instance vivante)
// et l'impression (chartSvg) : aucune valeur aléatoire, animation coupée, jamais de `undefined`, textes échappés par ECharts
// (le titre passe uniquement par `title.text`).
import type { EChartsCoreOption } from 'echarts/core';
import type { SqlValue } from '../coerce';
import { isColorValue, type ColorValue } from '../design/colors';
import type { ChartPalette } from './palette';
import type { ChartData } from './query';
import { chartFamily, chartStack, type ChartSpec } from './spec';
import { trendlineData } from './trend';

const TEXT = 10;
const TITLE = 14;

export type LegendPosition = 'top' | 'bottom' | 'left' | 'right';
export interface ChartFormat {
  hasTitle: boolean; title: string; hasLegend: boolean; legendPosition: LegendPosition; hasAxisTitles: boolean;
  /** Titres d'axes saisis ('' = automatique : champ d'axe et nom des séries) ; X = axe horizontal, Y = axe vertical. */
  axisTitleX: string; axisTitleY: string;
  /** Libellé d'une catégorie NULL : « (vide) » en fr, « (empty) » en en. */
  emptyLabel: string;
  /** Nom des types de courbe de tendance, dans la langue de l'interface (absent : l'identifiant). */
  trendNames: Record<string, string>;
  // Captures 12 et 13 : fond, cadre, polices (couleur ColorValue résolue avec le thème par la palette), axes.
  backStyle: 'normal' | 'transparent'; backColor: ColorValue;
  borderStyle: BorderStyle; borderWidth: number; borderColor: ColorValue;
  legendColor: ColorValue; legendSize: number;
  titleFont: string; titleColor: ColorValue; titleSize: number;
  hasSubtitle: boolean; subtitle: string; subtitleColor: ColorValue; subtitleSize: number;
  /** Axe des abscisses (catégories) ; `axis*` : axe des valeurs. */
  axisXColor: ColorValue; axisXSize: number; axisColor: ColorValue; axisSize: number;
  axisRange: 'auto' | 'manual'; axisMin: number | null; axisMax: number | null; axisFormat: string; axisUnits: AxisUnits;
  /** Axe des valeurs secondaire (combiné) : titre, plage, format, unités, police ; ignoré sans axe secondaire. */
  axis2: { title: string; range: 'auto' | 'manual'; min: number | null; max: number | null; format: string; units: AxisUnits; color: ColorValue; size: number };
}

export interface ChartLabels { title: string; empty: string; trends?: Record<string, string> }

const POSITIONS: readonly LegendPosition[] = ['top', 'bottom', 'left', 'right'];
export const BORDER_STYLES = ['transparent', 'solid', 'dashed', 'dotted'] as const;
export type BorderStyle = (typeof BORDER_STYLES)[number];
export const BACK_STYLES = ['normal', 'transparent'] as const;
export const AXIS_RANGES = ['auto', 'manual'] as const;
/** Unités d'affichage : le diviseur des étiquettes de l'axe des valeurs. */
export const AXIS_UNITS = { none: 1, hundreds: 100, thousands: 1e3, millions: 1e6, billions: 1e9 } as const;
export type AxisUnits = keyof typeof AXIS_UNITS;
export const FONT_SIZE = { min: 6, max: 72 } as const;
const isSize = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= FONT_SIZE.min && v <= FONT_SIZE.max;
const isWidth = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= 6;

/** Pourquoi les props de mise en forme brutes d'un graphique sont refusées (CLI : plus strict que la lecture tolérante), ou null. */
export function chartFormatIssue(p: Record<string, unknown>): string | null {
  type Check = [string, (v: unknown) => boolean, string];
  const oneOf = (k: string, list: readonly unknown[]): Check => [k, (v) => list.includes(v), `must be one of ${list.join(', ')}`];
  const each = (ks: string[], ok: (v: unknown) => boolean, what: string): Check[] => ks.map((k) => [k, ok, what]);
  const checks: Check[] = [
    oneOf('ChartBackStyle', BACK_STYLES), oneOf('ChartBorderStyle', BORDER_STYLES), oneOf('LegendPosition', POSITIONS), oneOf('AxisRange', AXIS_RANGES), oneOf('AxisUnits', Object.keys(AXIS_UNITS)), oneOf('AxisSecRange', AXIS_RANGES), oneOf('AxisSecUnits', Object.keys(AXIS_UNITS)),
    ['ChartBorderWidth', isWidth, 'must be a whole number from 0 to 6'],
    ...each(['LegendFontSize', 'TitleFontSize', 'SubtitleFontSize', 'AxisXFontSize', 'AxisFontSize', 'AxisSecFontSize'], isSize, `must be a whole number from ${FONT_SIZE.min} to ${FONT_SIZE.max}`),
    ...each(['ChartBackColor', 'ChartBorderColor', 'LegendFontColor', 'TitleFontColor', 'SubtitleFontColor', 'AxisXFontColor', 'AxisFontColor', 'AxisSecFontColor'], isColorValue, 'must be a color value (theme:... or #rrggbb)'),
    ...each(['HasTitle', 'HasLegend', 'HasAxisTitles', 'HasSubtitle'], (v) => typeof v === 'boolean', 'must be a boolean'),
    ...each(['ChartTitle', 'Subtitle', 'AxisTitleX', 'AxisTitleY', 'TitleFontName', 'AxisFormat', 'AxisSecTitle', 'AxisSecFormat'], (v) => typeof v === 'string', 'must be a string'),
    ...each(['AxisMin', 'AxisMax', 'AxisSecMin', 'AxisSecMax'], (v) => typeof v === 'number' && Number.isFinite(v), 'must be a finite number'),
  ];
  for (const [k, ok, what] of checks) if (p[k] !== undefined && !ok(p[k])) return `${k} ${what}`;
  return null;
}

const col = (v: unknown, d: ColorValue): ColorValue => (isColorValue(v) ? v : d);
const fsize = (v: unknown, d: number): number => (isSize(v) ? v : d);
const units = (v: unknown): AxisUnits => (typeof v === 'string' && Object.hasOwn(AXIS_UNITS, v) ? (v as AxisUnits) : 'none');
const fin = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/** Le cadre du graphique (px, style CSS, couleur résolue), ou null quand la bordure est transparente : aucun trait. 0 = filet de 1 px. */
export function chartFrame(f: ChartFormat, pal: ChartPalette): { width: number; style: 'solid' | 'dashed' | 'dotted'; color: string } | null {
  return f.borderStyle === 'transparent' ? null : { width: Math.max(1, f.borderWidth), style: f.borderStyle, color: pal.custom(f.borderColor) };
}

/** Étiquette d'axe : motif simple (préfixe, `#,##0` ou `0.00`, suffixe) et unités ; un autre texte est ignoré. Jamais de HTML : ECharts échappe le texte. */
function axisFormatter(format: string, div: number): ((v: number) => string) | undefined {
  const m = /^([^0#,]*)([#,]*0(?:\.0+)?)([^0#,]*)$/.exec(format);
  if (!m) return div === 1 ? undefined : (v) => String(Math.round((v / div) * 1e9) / 1e9);
  const [, pre, spec, post] = m as unknown as [string, string, string, string];
  const decimals = spec.includes('.') ? spec.length - spec.indexOf('.') - 1 : 0;
  // en-US : l'impression est déterministe, indépendante de la langue de la machine
  const nf = new Intl.NumberFormat('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals, useGrouping: spec.includes(',') });
  return (v) => `${pre}${nf.format(v / div)}${post}`;
}

/** Mise en forme lue des props du contrôle ; lecture tolérante, valeurs par défaut d'Access. */
export function readChartFormat(props: Record<string, unknown>, labels: ChartLabels): ChartFormat {
  const bool = (v: unknown, d: boolean): boolean => (typeof v === 'boolean' ? v : d);
  return {
    hasTitle: bool(props.HasTitle, true),
    title: typeof props.ChartTitle === 'string' ? props.ChartTitle : labels.title,
    hasLegend: bool(props.HasLegend, true),
    legendPosition: POSITIONS.find((p) => p === props.LegendPosition) ?? 'top',
    hasAxisTitles: bool(props.HasAxisTitles, true),
    axisTitleX: typeof props.AxisTitleX === 'string' ? props.AxisTitleX : '',
    axisTitleY: typeof props.AxisTitleY === 'string' ? props.AxisTitleY : '',
    emptyLabel: labels.empty, trendNames: labels.trends ?? {},
    backStyle: props.ChartBackStyle === 'normal' ? 'normal' : 'transparent', backColor: col(props.ChartBackColor, 'theme:surface'),
    borderStyle: BORDER_STYLES.find((s) => s === props.ChartBorderStyle) ?? 'transparent', borderWidth: isWidth(props.ChartBorderWidth) ? props.ChartBorderWidth : 0,
    borderColor: col(props.ChartBorderColor, 'theme:border'),
    legendColor: col(props.LegendFontColor, 'theme:text'), legendSize: fsize(props.LegendFontSize, TEXT),
    titleFont: typeof props.TitleFontName === 'string' && props.TitleFontName !== '' ? props.TitleFontName : '(Body)',
    titleColor: col(props.TitleFontColor, 'theme:text'), titleSize: fsize(props.TitleFontSize, TITLE),
    hasSubtitle: bool(props.HasSubtitle, false), subtitle: typeof props.Subtitle === 'string' ? props.Subtitle : '',
    subtitleColor: col(props.SubtitleFontColor, 'theme:text'), subtitleSize: fsize(props.SubtitleFontSize, TEXT),
    axisXColor: col(props.AxisXFontColor, 'theme:text'), axisXSize: fsize(props.AxisXFontSize, TEXT),
    axisColor: col(props.AxisFontColor, 'theme:text'), axisSize: fsize(props.AxisFontSize, TEXT),
    axisRange: props.AxisRange === 'manual' ? 'manual' : 'auto', axisMin: fin(props.AxisMin), axisMax: fin(props.AxisMax),
    axisFormat: typeof props.AxisFormat === 'string' ? props.AxisFormat : '',
    axisUnits: units(props.AxisUnits),
    axis2: { title: typeof props.AxisSecTitle === 'string' ? props.AxisSecTitle : '', range: props.AxisSecRange === 'manual' ? 'manual' : 'auto', min: fin(props.AxisSecMin), max: fin(props.AxisSecMax),
      format: typeof props.AxisSecFormat === 'string' ? props.AxisSecFormat : '', units: units(props.AxisSecUnits), color: col(props.AxisSecFontColor, 'theme:text'), size: fsize(props.AxisSecFontSize, TEXT) },
  };
}

/** Données d'exemple de la vue Création : 3 catégories x 2 séries. */
export const SAMPLE_ROWS: ChartData = {
  columns: [{ role: 'category', field: 'Category', name: 'Category' }, { role: 'legend', field: 'Series', name: 'Series' }, { role: 'value', field: 'Value', name: 'SumOfValue' }],
  rows: [['A', 'Series 1', 4], ['A', 'Series 2', 2], ['B', 'Series 1', 6], ['B', 'Series 2', 5], ['C', 'Series 1', 3], ['C', 'Series 2', 7]],
  truncated: false,
};

/** Info-bulle de la vue vivante (jamais à l'impression) ; en 100 % elle montre la valeur réelle, pas la part. */
export function chartTooltip(spec: ChartSpec, option: EChartsCoreOption, locale?: string): Record<string, unknown> {
  if (chartFamily(spec.type) === 'pie' || chartFamily(spec.type) === 'radar') return { trigger: 'item' };
  if (chartStack(spec.type) !== 'percent') return { trigger: 'axis' };
  const series = (option as { series?: { realData?: (number | null)[] }[] }).series ?? [];
  const nf = new Intl.NumberFormat(locale);
  const real = (p: { seriesIndex: number; dataIndex: number }): string => { const v = series[p.seriesIndex]?.realData?.[p.dataIndex]; return v == null ? '' : nf.format(v); };
  const esc = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
  return { trigger: 'axis', formatter: (ps: { seriesIndex: number; dataIndex: number; seriesName: string; value: number | null; axisValueLabel?: string }[]) =>
    [esc(String(ps[0]?.axisValueLabel ?? '')), ...ps.map((p) => `${esc(p.seriesName)}: ${real(p)} (${p.value == null ? '' : `${Math.round(p.value * 10) / 10} %`})`)].join('<br/>') };
}

/** Un nombre fini ou null (NaN, texte non numérique, NULL) : un trou, jamais 0. */
function num(v: SqlValue | undefined): number | null {
  const n = typeof v === 'number' ? v : typeof v === 'bigint' ? Number(v) : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN;
  return Number.isFinite(n) ? n : null;
}

export function chartOption(spec: ChartSpec, data: ChartData | null, fmt: ChartFormat, pal: ChartPalette,
  _size: { width: number; height: number }): EChartsCoreOption { // la taille vient du rendu (svg.ts ou conteneur) : réservée
  const textStyle = { fontFamily: pal.fontFamily, color: pal.text, fontSize: TEXT };
  const base = { animation: false, color: pal.series, textStyle, ...(fmt.backStyle === 'normal' ? { backgroundColor: pal.custom(fmt.backColor) } : {}) };
  const valueCols = data ? data.columns.flatMap((c, i) => (c.role === 'value' ? [{ c, i }] : [])) : [];
  if (!data || data.rows.length === 0 || valueCols.length === 0) return { ...base, xAxis: { show: false }, yAxis: { show: false }, series: [] };

  const family = chartFamily(spec.type);
  const stack = chartStack(spec.type);
  const catIdx = data.columns.findIndex((c) => c.role === 'category');
  const legIdx = data.columns.findIndex((c) => c.role === 'legend');
  const label = (v: SqlValue | undefined): string => (v === null || v === undefined || v === '' ? fmt.emptyLabel : String(v));

  // Pivot : catégories et séries dans l'ordre de première apparition ; un trou reste null.
  const cats: string[] = [];
  const names: string[] = [];
  const catIx = new Map<string, number>();
  const nameIx = new Map<string, number>();
  const cells = new Map<string, number | null>();
  const key = (s: number, c: number): string => `${s}:${c}`;
  data.rows.forEach((r, n) => {
    const cat = catIdx < 0 ? String(n + 1) : label(r[catIdx]);
    let c = catIx.get(cat);
    if (c === undefined) { c = cats.push(cat) - 1; catIx.set(cat, c); }
    // Avec une légende, seule la première valeur est tracée.
    (legIdx >= 0 ? valueCols.slice(0, 1) : valueCols).forEach(({ c: col, i }) => {
      // Secteurs : la légende est ignorée, une seule série.
      const sName = family === 'pie' ? col.name : legIdx >= 0 ? label(r[legIdx]) : col.name;
      let s = nameIx.get(sName);
      if (s === undefined) { s = names.push(sName) - 1; nameIx.set(sName, s); }
      const v = num(r[i]);
      const old = cells.get(key(s, c));
      // Secteurs : plusieurs lignes d'une même catégorie (légende ignorée) s'additionnent.
      cells.set(key(s, c), family === 'pie' && old != null ? old + (v ?? 0) : v);
    });
  });

  const titleOn = fmt.hasTitle && fmt.title !== '';
  const subOn = fmt.hasSubtitle && fmt.subtitle !== '';
  const titleH = (titleOn ? fmt.titleSize + 8 : 0) + (subOn ? fmt.subtitleSize + 6 : 0);   // hauteur réservée au titre et au sous-titre (14 pt : 22)
  const axisX = { fontSize: fmt.axisXSize, color: pal.custom(fmt.axisXColor) };
  const axisY = { fontSize: fmt.axisSize, color: pal.custom(fmt.axisColor) };
  const pos = fmt.hasLegend ? fmt.legendPosition : null;
  const horizontal = family === 'bar';
  const axisTitles = fmt.hasAxisTitles && family !== 'pie' && family !== 'radar';
  // La mise en forme de la série vient de la Valeur qu'elle trace (avec une légende, la première) ; le type de série ne compte que pour le combiné.
  const combo = family === 'combo';
  // Avec une légende, une seule Valeur se répartit sur toutes les séries : ni couleur, ni bordure, ni étiquettes, ni tendance par série (le volet les désactive).
  const cfgFor = (f: string | undefined) => (spec.series ?? []).find((x) => x.field.toLowerCase() === f);
  const cfgOf = (s: number) => cfgFor(legIdx >= 0 ? undefined : valueCols[s]?.c.field.toLowerCase());
  // Exception : le type et l'axe de la première Valeur valent pour toutes les séries de la légende (le combiné garde sa courbe et son axe secondaire).
  const shapeOf = (s: number) => (legIdx >= 0 ? cfgFor(valueCols[0]!.c.field.toLowerCase()) : cfgOf(s));
  // Axe secondaire : ni en barres (l'axe des valeurs est l'horizontal), ni empilé (un cumul sur deux échelles n'a pas de sens).
  const secondary = names.map((_, s) => !horizontal && stack === 'none' && shapeOf(s)?.secondary === true);
  const hasSecondary = secondary.some(Boolean);
  const shown = (s: number): string => (legIdx < 0 ? cfgOf(s)?.name : undefined) ?? names[s]!;
  const catTitle = axisTitles && catIdx >= 0 ? data.columns[catIdx]!.field : '';
  const valTitle = axisTitles ? (legIdx >= 0 ? valueCols[0]!.c.name : valueCols.flatMap(({ c }, s) => (secondary[s] ? [] : [shown(s) === names[s] ? c.name : shown(s)])).join(', ')) : '';
  const secTitle = axisTitles && hasSecondary && fmt.axis2.title !== '' ? fmt.axis2.title : axisTitles && hasSecondary && legIdx < 0 ? names.flatMap((_, s) => (secondary[s] ? [shown(s)] : [])).join(', ') : '';
  const bottomTitle = axisTitles && fmt.axisTitleX !== '' ? fmt.axisTitleX : horizontal ? valTitle : catTitle;
  const leftTitle = axisTitles && fmt.axisTitleY !== '' ? fmt.axisTitleY : horizontal ? catTitle : valTitle;
  // Marges réservées au titre, à la légende et aux titres d'axes.
  const box = {
    top: 8 + titleH + (pos === 'top' ? 24 : 0),
    bottom: 8 + (pos === 'bottom' ? 24 : 0) + (bottomTitle !== '' ? 22 : 0),
    left: 8 + (pos === 'left' ? 90 : 0) + (leftTitle !== '' ? 22 : 0),
    right: 12 + (pos === 'right' ? 90 : 0) + (secTitle !== '' ? 22 : 0),
  };

  const vertical = pos === 'left' || pos === 'right';
  const legend = pos
    ? { legend: { show: true, [pos]: pos === 'top' && titleH > 0 ? 6 + titleH : 4, orient: vertical ? 'vertical' : 'horizontal', ...(vertical ? { top: 'middle' } : { left: 'center' }), textStyle: { fontSize: fmt.legendSize, color: pal.custom(fmt.legendColor) } } }
    : {};
  const title = titleOn || subOn ? { title: { text: titleOn ? fmt.title : '', ...(subOn ? { subtext: fmt.subtitle, subtextStyle: { fontSize: fmt.subtitleSize, color: pal.custom(fmt.subtitleColor), fontFamily: pal.fontFamily } } : {}),
    left: 'center', top: 4, textStyle: { fontSize: fmt.titleSize, color: pal.custom(fmt.titleColor), fontFamily: pal.font(fmt.titleFont) } } } : {};

  if (family === 'pie') {
    const slices = cats.flatMap((name, c) => { const v = cells.get(key(0, c)); return v == null ? [] : [{ name, value: v }]; });
    return { ...base, ...title, ...legend, tooltip: { trigger: 'item' },
      series: [{ type: 'pie', name: valueCols[0]!.c.name, radius: '70%', ...box, label: { formatter: '{b}: {d}%', fontSize: TEXT, color: pal.text }, data: slices }] };
  }

  if (family === 'radar') {
    if (cats.length === 0) return { ...base, series: [] };   // rien à tracer : un radar sans indicateur ferait échouer ECharts
    const lines = names.map((name, s) => ({ name, value: cats.map((_, c) => cells.get(key(s, c)) ?? 0) }));
    const all = lines.flatMap((l) => l.value);
    const max = Math.ceil(Math.max(0, ...all)) || 1; // indicateurs à la même échelle ; jamais 0
    const min = Math.floor(Math.min(0, ...all));    // 0, ou le plus petit entier sous la plus petite valeur négative
    const color = (i: number) => pal.series[i % pal.series.length]!;
    return { ...base, ...title, ...legend, tooltip: { trigger: 'item' },
      radar: { indicator: cats.map((name) => ({ name, max, min })), center: ['50%', `${Math.round(50 + (box.top - box.bottom) / 8)}%`], radius: '60%',
        axisName: { color: pal.text, fontSize: TEXT }, axisLine: { lineStyle: { color: pal.grid } }, splitLine: { lineStyle: { color: pal.grid } }, splitArea: { show: false } },
      series: [{ type: 'radar', ...(spec.type === 'radarFilled' ? { areaStyle: { opacity: 0.3 } } : {}),
        data: lines.map((l, i) => ({ ...l, itemStyle: { color: color(i) }, lineStyle: { color: color(i) } })) }] };
  }

  const category = (name: string) => ({ type: 'category' as const, data: cats, axisLine: { lineStyle: { color: pal.grid } }, axisLabel: axisX,
    ...(name !== '' ? { name, nameLocation: 'middle' as const, nameGap: 26, nameTextStyle: axisX } : {}) });
  // 100 % : total = somme des valeurs absolues (comme Excel), part signée ; l'axe descend à -100 si une part est négative.
  const anyNegative = stack === 'percent' && [...cells.values()].some((v) => v != null && v < 0);
  // Plage manuelle, format et unités, par axe des valeurs (en 100 % l'axe est fixe) ; un bord illisible est ignoré, un intervalle vide aussi.
  const a2 = fmt.axis2;
  const value = (name: string, primary = true) => {
    const ax = primary ? { range: fmt.axisRange, min: fmt.axisMin, max: fmt.axisMax, format: fmt.axisFormat, units: fmt.axisUnits, font: axisY }
      : { range: a2.range, min: a2.min, max: a2.max, format: a2.format, units: a2.units, font: { fontSize: a2.size, color: pal.custom(a2.color) } };
    const manual = ax.range === 'manual' && stack !== 'percent' && !(ax.min !== null && ax.max !== null && ax.min >= ax.max);
    const formatter = stack === 'percent' ? undefined : axisFormatter(ax.format, AXIS_UNITS[ax.units]);
    return { type: 'value' as const, ...(stack === 'percent' ? { min: anyNegative ? -100 : 0, max: 100 } : {}),
      ...(manual ? { ...(ax.min !== null ? { min: ax.min } : {}), ...(ax.max !== null ? { max: ax.max } : {}) } : {}),
      axisLabel: { ...ax.font, ...(formatter ? { formatter } : {}) }, splitLine: { lineStyle: { color: pal.grid } },
      ...(name !== '' ? { name, nameLocation: 'middle' as const, nameGap: 34, nameTextStyle: ax.font } : {}) };
  };
  // 100 % : chaque valeur devient sa part du total de la catégorie (total nul : parts à 0, jamais NaN) ; le réel reste dans realData.
  const total = cats.map((_, c) => names.reduce((t, _n, s) => t + Math.abs(cells.get(key(s, c)) ?? 0), 0));
  const series = names.map((name, s) => {
    const real = cats.map((_, c) => cells.get(key(s, c)) ?? null);
    const drawn = stack === 'percent' ? real.map((v, c) => (v == null ? null : total[c] === 0 ? 0 : (v / total[c]!) * 100)) : real;
    const cfg = cfgOf(s);
    const kind = combo ? (shapeOf(s)?.type ?? 'column') : family === 'area' ? 'area' : family === 'line' ? 'line' : 'column';
    const asLine = kind !== 'column';
    const fill = cfg?.color ? pal.custom(cfg.color) : undefined;
    const border = cfg?.borderColor ? pal.custom(cfg.borderColor) : undefined;
    const itemStyle = { ...(fill ? { color: fill } : {}), ...(border ? { borderColor: border, borderWidth: 1 } : {}) };
    const paint = { ...(Object.keys(itemStyle).length ? { itemStyle } : {}), ...(asLine && fill ? { lineStyle: { color: fill } } : {}) };
    // Options de courbe : épaisseur, trait, marqueurs, trous (gap = trou, zero = 0, connect = relié).
    const lineOpts = asLine ? { ...(cfg?.marker === false ? { symbol: 'none' } : {}), ...(cfg?.gap === 'connect' ? { connectNulls: true } : {}),
      ...(cfg?.lineWidth !== undefined || cfg?.dash ? { lineStyle: { ...(fill ? { color: fill } : {}), ...(cfg.lineWidth !== undefined ? { width: cfg.lineWidth } : {}), ...(cfg.dash && cfg.dash !== 'solid' ? { type: cfg.dash } : {}) } } : {}) } : {};
    const shownData = asLine && cfg?.gap === 'zero' ? drawn.map((v) => v ?? 0) : drawn;
    return { type: asLine ? ('line' as const) : ('bar' as const), name: shown(s), ...(asLine ? { smooth: false } : {}),
      ...(kind === 'area' ? { areaStyle: {} } : {}), ...(stack !== 'none' ? { stack: 'total' } : {}), ...paint, ...lineOpts,
      ...(cfg?.dataLabels ? { label: { show: true, fontSize: TEXT, color: pal.text } } : {}),
      ...(secondary[s] ? { yAxisIndex: 1 } : {}), ...(stack === 'percent' ? { realData: real } : {}), data: shownData };
  });
  // Courbes de tendance : séries pointillées en plus, après les autres (les couleurs des séries ne bougent pas), de la couleur de leur série ;
  // ni en barres horizontales ni empilé. Une courbe impossible (voir trendlineData) n'ajoute rien.
  const trends = stack !== 'none' || horizontal ? [] : names.flatMap((_, s) => {
    const cfg = cfgOf(s);
    if (!cfg?.trendline || cfg.trendline === 'none') return [];
    const ys = cats.map((_c, c) => cells.get(key(s, c)) ?? null);
    const data = trendlineData(cfg.trendline, ys);
    if (data.length === 0) return [];
    const color = cfg.color ? pal.custom(cfg.color) : pal.series[s % pal.series.length]!;
    return [{ type: 'line' as const, name: cfg.trendlineName ?? `${shown(s)} (${fmt.trendNames[cfg.trendline] ?? cfg.trendline})`, silent: true, symbol: 'none', data,
      lineStyle: { type: 'dashed', width: 2, color }, itemStyle: { color }, ...(secondary[s] ? { yAxisIndex: 1 } : {}) }];
  });
  // Axe secondaire (combiné) : à droite, sans grille, seulement si une série le demande.
  const yAxis = horizontal ? category(leftTitle) : hasSecondary ? [value(leftTitle), { ...value(secTitle, false), position: 'right' as const, splitLine: { show: false } }] : value(leftTitle);
  return { ...base, ...title, ...legend, tooltip: { trigger: 'axis' }, grid: { ...box, containLabel: true },
    xAxis: horizontal ? value(bottomTitle) : category(bottomTitle), yAxis, series: [...series, ...trends] };
}
