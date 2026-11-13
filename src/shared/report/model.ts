// Définition normalisée d'un état (pur) : le DesignDoc (contrat 1.3) lu par le catalogue (props.ts), sections rangées,
// sources analysées, avertissements. readReport ne lève jamais : une valeur invalide prend son défaut, une structure
// invalide est ignorée, et chaque écart devient un ReportIssue.
import { compileConditions, type CompiledCondition } from '../design/format-conditions';
import { CONTROL_KINDS, type ControlKind, type DesignDoc, type SectionDef, type SectionKind } from '../design/model';
import { cellControl, cellItemName, emptyCellsOf, sectionRef } from '../design/layout';
import type { Expr } from '../expr/ast';
import { fieldRefs, parseCanonical } from '../expr/parser';
import { withUserFunctions } from '../expr/user-functions';
import { MAX_TWIPS, sameName } from '../field-types';
import { defaultFor, PROPERTY_CATALOG } from '../design/properties';
import { resolveFont, resolveThemeFont } from '../fonts';
import { DEFAULT_THEME, type Theme } from '../design/theme';
import type { SourceField } from '../record-source';
import { readColor, readProp } from './props';
import { readAlignment, readPictureSpec, type PictureAlignment, type PictureSpec } from '../design/picture-css';
import { readPictureType, resolvePicture, type ResourceMap } from '../pictures';
import { extractAggregates, type AggSpec } from './totals';
import { readChartFormat, type ChartFormat, type ChartLabels } from '../chart/option';
import { chartPalette, type ChartPalette } from '../chart/palette';
import type { ChartData, ChartDataMap } from '../chart/query';
import { readChartSpec, typeHintKey, type ChartSpec } from '../chart/spec';
import type { Border, FontSpec, Gridlines } from './types';

// props du DesignDoc propres aux états (contrat 1.3, clés A5)
export interface GroupLevel { expression: string /* nom de champ, ou '=' + expression canonique */; order: 'asc' | 'desc';
  header: boolean; footer: boolean; keepTogether: 'no' | 'wholeGroup' | 'withFirstDetail' }          // doc.props.grouping
/** The papers of the Size list (Access's Taille, Page Setup > Page): portrait width × height in twips, and the CSS page size. */
export const PAPERS = {
  letter: { width: 12240, height: 15840, css: '8.5in 11in' },
  legal: { width: 12240, height: 20160, css: '8.5in 14in' },
  statement: { width: 7920, height: 12240, css: '5.5in 8.5in' },
  executive: { width: 10440, height: 15120, css: '7.25in 10.5in' },
  a4: { width: 11906, height: 16838, css: '210mm 297mm' },
  a5: { width: 8391, height: 11906, css: '148mm 210mm' },
  b5: { width: 10319, height: 14570, css: '182mm 257mm' },
  env10: { width: 5940, height: 13680, css: '4.125in 9.5in' },
  envDl: { width: 6236, height: 12472, css: '110mm 220mm' },
  envC5: { width: 9184, height: 12983, css: '162mm 229mm' },
  envC6: { width: 6464, height: 9184, css: '114mm 162mm' },
  envMonarch: { width: 5580, height: 10800, css: '3.875in 7.5in' },
  env675: { width: 5220, height: 9360, css: '3.625in 6.5in' },
  postcardJp: { width: 5669, height: 8391, css: '100mm 148mm' },
  a6: { width: 5953, height: 8391, css: '105mm 148mm' },
  chou3: { width: 6803, height: 13323, css: '12cm 23.5cm' },
  chou4: { width: 5102, height: 11622, css: '9cm 20.5cm' },
  p4x6: { width: 5760, height: 8640, css: '10.16cm 15.24cm' },
  p5x7: { width: 7200, height: 10080, css: '12.7cm 17.78cm' },
  p35x5: { width: 5040, height: 7200, css: '8.89cm 12.7cm' },
  l2: { width: 7200, height: 10080, css: '12.7cm 17.78cm' },
  p8x10: { width: 11520, height: 14400, css: '20.32cm 25.4cm' },
  ofuku: { width: 11333, height: 8385, css: '19.99cm 14.79cm' },
  envA2: { width: 6287, height: 8271, css: '11.09cm 14.59cm' },
  bristol4x6: { width: 5760, height: 8640, css: '10.16cm 15.24cm' },
  bristol5x8: { width: 7200, height: 11520, css: '12.7cm 20.32cm' },
  cardUs: { width: 12240, height: 15840, css: '21.59cm 27.94cm' },
  cardA4: { width: 11900, height: 16832, css: '20.99cm 29.69cm' },
  p8_5x13: { width: 12240, height: 18720, css: '21.59cm 33.02cm' },
  p3x5: { width: 4320, height: 7200, css: '7.62cm 12.7cm' },
  bristol3x5: { width: 4320, height: 7200, css: '7.62cm 12.7cm' },
  b5iso: { width: 9978, height: 14173, css: '17.6cm 25cm' },
} as const;
export type PaperId = keyof typeof PAPERS;

export interface PageSetup { orientation: 'portrait' | 'landscape'; paper: PaperId; margins: { top: number; right: number; bottom: number; left: number };
  /** Print Data Only (Access's PrtMip data): the pages without their decoration and labels; absent = false. */ dataOnly?: true }   // doc.props.pageSetup
export type ReportIssue = { code: 'unknownField' | 'invalidExpression' | 'groupingInvalid' | 'widthExceedsPage' | 'glyphMissing'
  | 'fontNotPortable' | 'unsupportedControl' | 'aggregateNotAllowed' | 'sizeClamped' | 'groupingMalformed' | 'sectionIgnored' | 'pictureMissing'
  | 'subreportMissing' | 'subreportRecursive' | 'subreportBadLink'; control?: string; detail?: string };
/** `error`: a source refused when read (invalid expression, aggregate where none is allowed); the engine shows #Erreur.
 *  `none`: unbound, shows nothing. */
export type ControlSource = { kind: 'none' } | { kind: 'error' } | { kind: 'field'; name: string }
  | { kind: 'expr'; expr: Expr; aggs: AggSpec[]; usesPage: boolean; usesPages: boolean };
export interface ControlSpec { kind: ControlKind; name: string; left: number; top: number; width: number; height: number;
  source: ControlSource; caption: string; format?: string; decimalPlaces?: 'auto' | number; visible: boolean; canGrow: boolean; canShrink: boolean;
  font: FontSpec; color: string; back: string | null; border: Border | null; align: 'general' | 'left' | 'center' | 'right';
  /** Control Margins (twips): the text inset. */
  margin: { top: number; right: number; bottom: number; left: number };
  /** Gridlines over the cell rectangle; null when all four sides are transparent. */
  gridlines: Gridlines | null;
  picture?: string /* data: URI */; sizeMode?: 'clip' | 'stretch' | 'zoom'; pictureAlign?: PictureAlignment; tiling?: true; slant?: boolean;
  /** Conditional formatting rules of a text box or combo box (absent: none), evaluated per record by formatBand. */
  conditions?: CompiledCondition[];
  chart?: { spec: ChartSpec; data: ChartData | null; format: ChartFormat; palette: ChartPalette; fontFamily: string; titleFamily: string; hint?: string };
  /** A subreport: its Source Object (a report's name; '': an empty frame) and its Link Master / Child Fields. */
  sub?: { source: string; master: string[]; child: string[] };
  /** A tab control: its page captions (Pages). */
  pages?: string[] }
export interface SectionSpec { kind: SectionKind; groupLevel?: number; height: number; visible: boolean; canGrow: boolean; canShrink: boolean;
  keepTogether: boolean; repeatSection: boolean; forceNewPage: 'none' | 'before' | 'after' | 'beforeAndAfter'; back: string | null; controls: ControlSpec[] }
/** Columns (Access's Page Setup > Columns): the body's Detail and group bands flow in `count` columns of the printable width,
 *  `spacing` twips apart. `across`: Across, then Down (a row of records, then the next row), else Down, then Across. One column
 *  is the page as it always was. */
export interface ColumnSetup { count: number; spacing: number; across: boolean;
  /** Column Size (twips), explicit when present (several columns only): the column width, the height of each Detail cell, and the
   *  space between rows; absent: the computed width, the Detail's own height, no space ("Same as Detail"). */
  width?: number; height?: number; rowSpacing?: number }
export const DEFAULT_COLUMNS: ColumnSetup = Object.freeze({ count: 1, spacing: 0, across: false });
export const MAX_COLUMNS = 10;
/** The width of one column: `width` (twips) split in `count`, `spacing` apart (layout and the Page Setup dialog share it). */
export const columnWidth = (width: number, count: number, spacing: number): number => Math.floor((width - (count - 1) * spacing) / count);

export interface ReportSpec { background?: PictureSpec; width: number; page: PageSetup; columns: ColumnSetup; grouping: (GroupLevel & { key: ControlSource })[];
  reportHeader?: SectionSpec; pageHeader?: SectionSpec; groupHeaders: (SectionSpec | undefined)[]; detail?: SectionSpec;
  groupFooters: (SectionSpec | undefined)[]; pageFooter?: SectionSpec; reportFooter?: SectionSpec; issues: ReportIssue[] }

/** A4 portrait, 1 cm margins. Frozen: readReport hands out copies. */
export const DEFAULT_PAGE_SETUP: PageSetup = Object.freeze({ orientation: 'portrait', paper: 'a4', margins: Object.freeze({ top: 567, right: 567, bottom: 567, left: 567 }) });

export function pageGeometry(p: PageSetup): { width: number; height: number; bodyLeft: number; bodyTop: number; printableWidth: number; printableHeight: number } {
  const paper = PAPERS[p.paper], [width, height] = p.orientation === 'landscape' ? [paper.height, paper.width] : [paper.width, paper.height];
  const m = p.margins;
  return { width, height, bodyLeft: m.left, bodyTop: m.top, printableWidth: width - m.left - m.right, printableHeight: height - m.top - m.bottom };
}

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj => (v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as Obj) : {});
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const uint = (v: unknown): number => (Number.isSafeInteger(v) && (v as number) >= 0 ? (v as number) : 0);
const isIn = <T extends string>(v: unknown, list: readonly T[]): v is T => list.includes(v as T);
/** 'N°;Pays' -> ['N°', 'Pays'] (Link Master / Child Fields, as the subform's splitFields). */
const names = (v: unknown): string[] => String(v ?? '').split(';').map((s) => s.trim()).filter(Boolean);

const isLevel = (v: unknown): v is GroupLevel => {
  const l = obj(v);
  return typeof l.expression === 'string' && isIn(l.order, ['asc', 'desc']) && typeof l.header === 'boolean' && typeof l.footer === 'boolean'
    && isIn(l.keepTogether, ['no', 'wholeGroup', 'withFirstDetail']);
};
const margin = (v: unknown) => Number.isSafeInteger(v) && (v as number) >= 0 && (v as number) <= 5670;
function readColumns(v: unknown): ColumnSetup {
  const c = obj(v);
  const ok = Number.isSafeInteger(c.count) && (c.count as number) >= 1 && (c.count as number) <= MAX_COLUMNS
    && Number.isSafeInteger(c.spacing) && (c.spacing as number) >= 0 && (c.spacing as number) <= 5670 && typeof c.across === 'boolean';
  if (!ok) return { ...DEFAULT_COLUMNS };
  const size = (k: 'width' | 'height' | 'rowSpacing', min: number) => (Number.isSafeInteger(c[k]) && (c[k] as number) >= min && (c[k] as number) <= MAX_TWIPS ? { [k]: c[k] as number } : {});
  return { count: c.count as number, spacing: c.spacing as number, across: c.across as boolean, ...size('width', 1), ...size('height', 1), ...size('rowSpacing', 1) };
}
function readPageSetup(v: unknown): PageSetup {
  const p = obj(v), m = obj(p.margins);
  if (!isIn(p.orientation, ['portrait', 'landscape']) || ![m.top, m.right, m.bottom, m.left].every(margin))
    return { ...DEFAULT_PAGE_SETUP, margins: { ...DEFAULT_PAGE_SETUP.margins } };
  const paper = isIn(p.paper, Object.keys(PAPERS) as PaperId[]) ? p.paper : DEFAULT_PAGE_SETUP.paper;
  return { orientation: p.orientation, paper, margins: { top: m.top as number, right: m.right as number, bottom: m.bottom as number, left: m.left as number },
    ...(p.dataOnly === true ? { dataOnly: true as const } : {}) };
}

/** A field name as typed, with or without brackets (`Client`, `[Client]`). */
export const bareName = (text: string): string => (/^\[[^\]]*\]$/.test(text) ? text.slice(1, -1) : text);

/** A report's width, one rule for print and the designer (C5): its Width when stored, else the right edge of its rightmost
 *  control, children included; the catalog's 6994 only when there is neither (the designer never draws a report 0 wide);
 *  at most MAX_TWIPS. Any shape: never throws. */
export function reportWidth(doc: DesignDoc): number {
  const w = obj(obj(doc).props).Width;
  if (Number.isSafeInteger(w) && (w as number) >= 0) return Math.min(w as number, MAX_TWIPS);
  const right = (list: unknown): number[] => arr(list).flatMap((v) => { const c = obj(v); return [uint(c.left) + uint(c.width), ...right(c.children)]; });
  const edge = Math.min(MAX_TWIPS, Math.max(0, ...arr(obj(doc).sections).flatMap((s) => right(obj(s).controls))));
  return edge > 0 ? edge : (defaultFor(PROPERTY_CATALOG.find((d) => d.name === 'Width')!, 'report', 'report') as number);
}

const SINGLE = ['reportHeader', 'pageHeader', 'detail', 'pageFooter', 'reportFooter'] as const;

/** `allCells`: every empty layout cell becomes a rectangle (the report Layout view selects them); otherwise only those carrying
 *  stored formatting do, so a report saved before L5 reads and prints as before. */
export function readReport(doc: DesignDoc, fields: SourceField[], opts: { allCells?: boolean; theme?: Theme; resources?: ResourceMap; charts?: ChartDataMap; chartLabels?: ChartLabels } = {}): ReportSpec {
  const theme = opts.theme ?? DEFAULT_THEME;
  const issues: ReportIssue[] = [];
  const add = (code: ReportIssue['code'], control?: string, detail?: string): void => {
    if (issues.some((i) => i.code === code && i.control === control && i.detail === detail)) return;
    const i: ReportIssue = { code };
    if (control !== undefined) i.control = control;
    if (detail !== undefined) i.detail = detail;
    issues.push(i);
  };
  /** A length in twips: Access's limit at most (a definition written elsewhere may hold anything), reported when clamped. */
  const twips = (v: unknown, control?: string, detail?: string): number => {
    const n = uint(v);
    if (n <= MAX_TWIPS) return n;
    add('sizeClamped', control, detail);
    return MAX_TWIPS;
  };
  const known = (name: string) => fields.some((f) => sameName(f.name, name));
  /** Page or Pages when the source has no such field. */
  const pageRef = (name: string) => !known(name) && (sameName(name, 'Page') || sameName(name, 'Pages'));

  /** La police de corps du thème, embarquée (une non portable : Liberation Sans), comme chartPalette. */
  const embeddedBody = (theme: Theme, name = '(Body)'): string => { const f = resolveFont(name, theme); return f.portable ? f.family : 'Liberation Sans'; };

  /** A field name (`Client` or `[Client]`) or `=` + canonical expression; `noAgg`: the code when aggregates are not allowed. */
  const source = (text: string, control: string | undefined, bad: ReportIssue['code'], noAgg?: ReportIssue['code']): ControlSource => {
    if (text === '') return { kind: 'none' };
    if (!text.startsWith('=')) {
      const name = bareName(text);
      if (!known(name)) add('unknownField', control, name);
      return { kind: 'field', name };
    }
    let x: { expr: Expr; aggs: AggSpec[] };
    try { x = extractAggregates(parseCanonical(text.slice(1), { functions: withUserFunctions() })); } catch { add(bad, control, text); return { kind: 'error' }; }
    if (noAgg && x.aggs.length > 0) { add(noAgg, control, text); return { kind: 'error' }; }
    const refs = fieldRefs(x.expr);
    const page = (n: string) => !known(n) && refs.some((r) => sameName(r, n));
    // Page and Pages exist only outside aggregates (an aggregate reads the rows' fields)
    const unknown = [...refs.filter((n) => !n.startsWith('\u0000') && !sameName(n, 'Page') && !sameName(n, 'Pages')), ...x.aggs.flatMap((a) => fieldRefs(a.arg))];
    for (const n of unknown) if (!known(n)) add('unknownField', control, n);
    return { kind: 'expr', ...x, usesPage: page('Page'), usesPages: page('Pages') };
  };

  const control = (c: Obj, kind: ControlKind, name: string, pageSection: boolean): ControlSpec => {
    const p = obj(c.props);
    // a combo box prints as a text box showing its value: same properties, same report defaults (no border, no back)
    const target = kind === 'comboBox' ? 'textBox' : kind;
    const r = (prop: string, fallback?: unknown) => readProp(p, prop, target, fallback);
    const link = kind === 'label' && typeof r('HyperlinkAddress') === 'string' && (r('HyperlinkAddress') as string).trim() !== '';   // D3: printed as a link
    const font: FontSpec = { name: resolveThemeFont(r('FontName') as string, theme), size: r('FontSize') as number, bold: r('FontWeight') === 'bold',
      italic: r('FontItalic') as boolean, underline: link || (r('FontUnderline') as boolean) };
    if (!resolveFont(font.name).portable) add('fontNotPortable', undefined, font.name);
    const format = r('Format') as string, places = r('DecimalPlaces') as string, picture = r('Picture'), sizeMode = r('SizeMode', 'zoom');
    const src = kind === 'image' ? resolvePicture({ PictureType: p.PictureType, Picture: picture }, opts.resources ?? {}) : undefined;
    if (kind === 'image' && !src && readPictureType(p.PictureType) === 'shared' && typeof picture === 'string' && picture) add('pictureMissing', name, picture);
    const sides = ['Top', 'Right', 'Bottom', 'Left'] as const;
    const four = <T,>(f: (s: (typeof sides)[number]) => T) => ({ top: f('Top'), right: f('Right'), bottom: f('Bottom'), left: f('Left') });
    const margin = four((s) => (kind === 'pageBreak' ? 0 : r(`${s}Margin`) as number));
    const line = (s: (typeof sides)[number]): Border | null => kind === 'pageBreak' || r(`GridlineStyle${s}`) === 'transparent' ? null   // GridlineWidth: px, 0 = hairline
      : { width: Math.round(Math.max(1, r(`GridlineWidth${s}`) as number) * 15), color: readColor(p, 'GridlineColor', target, theme), style: r(`GridlineStyle${s}`) as Border['style'] };
    const lines = four(line);
    const conditions = kind === 'textBox' || kind === 'comboBox' ? compileConditions(p.FormatConditions, (text, criteria) => parseCanonical(text, { criteria, functions: withUserFunctions() })) : [];
    return {
      kind, name, left: twips(c.left, name), top: twips(c.top, name), width: twips(c.width, name), height: twips(c.height, name),
      source: source(r('ControlSource') as string, name, 'invalidExpression', pageSection ? 'aggregateNotAllowed' : undefined),
      caption: r('Caption') as string, ...(format === '' ? {} : { format }), decimalPlaces: places === 'auto' ? 'auto' : Number(places),
      visible: r('Visible') as boolean, canGrow: r('CanGrow') as boolean, canShrink: r('CanShrink') as boolean,
      font, color: link ? '#0563c1' : readColor(p, 'ForeColor', target, theme),
      back: r('BackStyle') === 'transparent' ? null : readColor(p, 'BackColor', target, theme),
      // BorderWidth: px 0–6; 0 = hairline, drawn 1 px (15 twips) wide, as in A4
      border: r('BorderStyle') === 'transparent' ? null
        : { width: Math.round(Math.max(1, r('BorderWidth') as number) * 15), color: readColor(p, 'BorderColor', target, theme), style: r('BorderStyle') as Border['style'] },
      align: r('TextAlign') as ControlSpec['align'],
      margin, gridlines: Object.values(lines).some(Boolean) ? { ...lines, padding: four((s) => r(`${s}Padding`) as number) } : null,
      // Picture (incorporée ou partagée, résolue ci-dessus), SizeMode et LineSlant.
      ...(kind === 'image' ? { ...(src ? { picture: src } : {}),
        sizeMode: isIn(sizeMode, ['clip', 'stretch', 'zoom']) ? sizeMode : 'zoom',
        // absents par défaut : un état sans ces propriétés s'imprime à l'identique
        ...(readAlignment(p.PictureAlignment) !== 'center' ? { pictureAlign: readAlignment(p.PictureAlignment) } : {}), ...(p.PictureTiling === true ? { tiling: true as const } : {}) } : {}),
      ...(conditions.length ? { conditions } : {}),
      // un état se dessine toujours en clair ; la police du graphique est celle de la palette (embarquée)
      ...(kind === 'chart' ? { chart: { spec: readChartSpec(p), data: opts.charts?.[name] ?? null,
        format: readChartFormat(p, opts.chartLabels ?? { title: 'Chart Title', empty: '(empty)' }), palette: chartPalette(theme, 'light'),
        ...(opts.chartLabels?.hints ? { hint: opts.chartLabels.hints[typeHintKey(readChartSpec(p)) ?? 'chart.noData'] } : {}),
        fontFamily: embeddedBody(theme), titleFamily: embeddedBody(theme, readChartFormat(p, { title: '', empty: '' }).titleFont) } } : {}),
      ...(kind === 'line' ? { slant: r('LineSlant', false) === true } : {}),
      ...(kind === 'tabControl' ? { pages: arr(p.Pages).map(String) } : {}),
      ...(kind === 'subform' ? { sub: { source: (r('SourceObject') as string).trim(), master: names(r('LinkMasterFields')), child: names(r('LinkChildFields')) } } : {}),
    };
  };

  /** Controls in drawing order: each one, then its children (already section-relative), depth first. */
  const controls = (list: unknown, pageSection: boolean, onTab = false): ControlSpec[] => arr(list).flatMap((v) => {
    const c = obj(v), kind = c.kind, name = typeof c.name === 'string' ? c.name : '';
    if (!isIn(kind, CONTROL_KINDS)) { add('unsupportedControl', name, String(kind)); return []; }
    if (onTab && uint(obj(c.props).PageIndex) > 0) return [];   // ponytail: a tab control prints its first page, the controls of the others are left out
    return [control(c, kind, name, pageSection), ...controls(c.children, pageSection, kind === 'tabControl')];
  });

  /** The section's empty layout cells as borderless, sourceless rectangles: the engine draws their back colour and gridlines. */
  const cells = (s: Obj, pageSection: boolean): ControlSpec[] => emptyCellsOf(doc, sectionRef(s as unknown as SectionDef))
    .filter((c) => opts.allCells || Object.keys(c.props).length > 0)
    .map((c) => ({ ...control(cellControl(c) as unknown as Obj, 'label', cellItemName(c), pageSection), kind: 'rectangle' as const, border: null, source: { kind: 'none' as const } }));

  const section = (s: Obj, kind: SectionKind, groupLevel?: number): SectionSpec => {
    const p = obj(s.props), r = (prop: string) => readProp(p, prop, kind);
    return {
      kind, ...(groupLevel === undefined ? {} : { groupLevel }), height: twips(s.height, undefined, kind),
      visible: r('Visible') as boolean, canGrow: r('CanGrow') as boolean, canShrink: r('CanShrink') as boolean,
      keepTogether: r('KeepTogether') as boolean, repeatSection: r('RepeatSection') as boolean,
      forceNewPage: r('ForceNewPage') as SectionSpec['forceNewPage'], back: readColor(p, 'BackColor', kind, theme),
      controls: [...cells(s, kind === 'pageHeader' || kind === 'pageFooter'), ...controls(s.controls, kind === 'pageHeader' || kind === 'pageFooter')],
    };
  };

  const d = obj(doc), props = obj(d.props);
  const page = readPageSetup(props.pageSetup);
  const levels = Array.isArray(props.grouping) && props.grouping.every(isLevel) ? (props.grouping as GroupLevel[]) : [];
  if (props.grouping !== undefined && levels !== props.grouping) add('groupingMalformed');
  const grouping = levels.map(({ expression, order, header, footer, keepTogether }) => {
    // a group needs a key, and a page number is not known when rows are grouped (bare [Page] included)
    let key: ControlSource = expression === '' || (!expression.startsWith('=') && pageRef(bareName(expression))) ? { kind: 'error' }
      : source(expression, undefined, 'groupingInvalid', 'groupingInvalid');
    if (key.kind === 'error' || (key.kind === 'expr' && (key.usesPage || key.usesPages))) {
      if (expression === '') add('groupingMalformed'); else add('groupingInvalid', undefined, expression);
      key = { kind: 'error' };
    }
    return { expression, order, header, footer, keepTogether, key };
  });

  const spec: ReportSpec = { width: 0, page, columns: readColumns(props.columns), grouping, groupHeaders: grouping.map(() => undefined), groupFooters: grouping.map(() => undefined), issues };
  for (const v of arr(d.sections)) {
    const s = obj(v), kind = s.kind, level = s.groupLevel;
    if (isIn(kind, SINGLE)) {
      if (spec[kind] === undefined) { spec[kind] = section(s, kind); continue; }
    } else if (kind === 'groupHeader' || kind === 'groupFooter') {
      // a level's section exists only when its header/footer flag asks for it, once
      const slots = kind === 'groupHeader' ? spec.groupHeaders : spec.groupFooters;
      const l = Number.isInteger(level) ? grouping[level as number] : undefined;
      if (l?.[kind === 'groupHeader' ? 'header' : 'footer'] && slots[level as number] === undefined) { slots[level as number] = section(s, kind, level as number); continue; }
    }
    add('sectionIgnored', undefined, String(kind));   // a duplicate, or a group section no level asks for
  }

  const background = readPictureSpec(props, opts.resources ?? {});
  if (background) spec.background = background;
  else if (readPictureType(props.PictureType) === 'shared' && typeof props.Picture === 'string' && props.Picture) add('pictureMissing', undefined, props.Picture);
  if (Number.isSafeInteger(props.Width)) twips(props.Width, undefined, 'Width');   // reported when clamped
  spec.width = reportWidth(doc);
  if (spec.width > pageGeometry(page).printableWidth) add('widthExceedsPage');
  return spec;
}
