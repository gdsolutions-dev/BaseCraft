// Définition normalisée d'un état (pur) : le DesignDoc (contrat 1.3) lu par le catalogue (props.ts), sections rangées,
// sources analysées, avertissements. readReport ne lève jamais : une valeur invalide prend son défaut, une structure
// invalide est ignorée, et chaque écart devient un ReportIssue.
import { CONTROL_KINDS, type ControlKind, type DesignDoc, type SectionKind } from '../design/model';
import type { Expr } from '../expr/ast';
import { fieldRefs, parseCanonical } from '../expr/parser';
import { MAX_TWIPS, sameName } from '../field-types';
import { defaultFor, PROPERTY_CATALOG } from '../design/properties';
import { resolveFont } from '../fonts';
import type { SourceField } from '../record-source';
import { readColor, readProp } from './props';
import { extractAggregates, type AggSpec } from './totals';
import type { Border, FontSpec } from './types';

// props du DesignDoc propres aux états (contrat 1.3, clés A5)
export interface GroupLevel { expression: string /* nom de champ, ou '=' + expression canonique */; order: 'asc' | 'desc';
  header: boolean; footer: boolean; keepTogether: 'no' | 'wholeGroup' | 'withFirstDetail' }          // doc.props.grouping
export interface PageSetup { orientation: 'portrait' | 'landscape'; margins: { top: number; right: number; bottom: number; left: number } }   // doc.props.pageSetup
export type ReportIssue = { code: 'unknownField' | 'invalidExpression' | 'groupingInvalid' | 'widthExceedsPage' | 'glyphMissing'
  | 'fontNotPortable' | 'unsupportedControl' | 'aggregateNotAllowed' | 'sizeClamped' | 'groupingMalformed' | 'sectionIgnored'; control?: string; detail?: string };
/** `error`: a source refused when read (invalid expression, aggregate where none is allowed); the engine shows #Erreur.
 *  `none`: unbound, shows nothing. */
export type ControlSource = { kind: 'none' } | { kind: 'error' } | { kind: 'field'; name: string }
  | { kind: 'expr'; expr: Expr; aggs: AggSpec[]; usesPage: boolean; usesPages: boolean };
export interface ControlSpec { kind: ControlKind; name: string; left: number; top: number; width: number; height: number;
  source: ControlSource; caption: string; format?: string; decimalPlaces?: 'auto' | number; visible: boolean; canGrow: boolean; canShrink: boolean;
  font: FontSpec; color: string; back: string | null; border: Border | null; align: 'general' | 'left' | 'center' | 'right';
  picture?: string /* data: URI */; sizeMode?: 'clip' | 'stretch' | 'zoom'; slant?: boolean }
export interface SectionSpec { kind: SectionKind; groupLevel?: number; height: number; visible: boolean; canGrow: boolean; canShrink: boolean;
  keepTogether: boolean; repeatSection: boolean; forceNewPage: 'none' | 'before' | 'after' | 'beforeAndAfter'; back: string | null; controls: ControlSpec[] }
export interface ReportSpec { width: number; page: PageSetup; grouping: (GroupLevel & { key: ControlSource })[];
  reportHeader?: SectionSpec; pageHeader?: SectionSpec; groupHeaders: (SectionSpec | undefined)[]; detail?: SectionSpec;
  groupFooters: (SectionSpec | undefined)[]; pageFooter?: SectionSpec; reportFooter?: SectionSpec; issues: ReportIssue[] }

/** A4 portrait, 1 cm margins. Frozen: readReport hands out copies. */
export const DEFAULT_PAGE_SETUP: PageSetup = Object.freeze({ orientation: 'portrait', margins: Object.freeze({ top: 567, right: 567, bottom: 567, left: 567 }) });

export function pageGeometry(p: PageSetup): { width: number; height: number; bodyLeft: number; bodyTop: number; printableWidth: number; printableHeight: number } {
  const [width, height] = p.orientation === 'landscape' ? [16838, 11906] : [11906, 16838];
  const m = p.margins;
  return { width, height, bodyLeft: m.left, bodyTop: m.top, printableWidth: width - m.left - m.right, printableHeight: height - m.top - m.bottom };
}

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj => (v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as Obj) : {});
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const uint = (v: unknown): number => (Number.isSafeInteger(v) && (v as number) >= 0 ? (v as number) : 0);
const isIn = <T extends string>(v: unknown, list: readonly T[]): v is T => list.includes(v as T);

const isLevel = (v: unknown): v is GroupLevel => {
  const l = obj(v);
  return typeof l.expression === 'string' && isIn(l.order, ['asc', 'desc']) && typeof l.header === 'boolean' && typeof l.footer === 'boolean'
    && isIn(l.keepTogether, ['no', 'wholeGroup', 'withFirstDetail']);
};
const margin = (v: unknown) => Number.isSafeInteger(v) && (v as number) >= 0 && (v as number) <= 5670;
function readPageSetup(v: unknown): PageSetup {
  const p = obj(v), m = obj(p.margins);
  if (!isIn(p.orientation, ['portrait', 'landscape']) || ![m.top, m.right, m.bottom, m.left].every(margin))
    return { ...DEFAULT_PAGE_SETUP, margins: { ...DEFAULT_PAGE_SETUP.margins } };
  return { orientation: p.orientation, margins: { top: m.top as number, right: m.right as number, bottom: m.bottom as number, left: m.left as number } };
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

/** Out of A5's scope and not drawn (Global Constraints); a subform is drawn as an empty frame, also reported. */
const NOT_DRAWN: ControlKind[] = ['commandButton', 'optionGroup', 'listBox', 'tabControl'];
const SINGLE = ['reportHeader', 'pageHeader', 'detail', 'pageFooter', 'reportFooter'] as const;

export function readReport(doc: DesignDoc, fields: SourceField[]): ReportSpec {
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

  /** A field name (`Client` or `[Client]`) or `=` + canonical expression; `noAgg`: the code when aggregates are not allowed. */
  const source = (text: string, control: string | undefined, bad: ReportIssue['code'], noAgg?: ReportIssue['code']): ControlSource => {
    if (text === '') return { kind: 'none' };
    if (!text.startsWith('=')) {
      const name = bareName(text);
      if (!known(name)) add('unknownField', control, name);
      return { kind: 'field', name };
    }
    let x: { expr: Expr; aggs: AggSpec[] };
    try { x = extractAggregates(parseCanonical(text.slice(1))); } catch { add(bad, control, text); return { kind: 'error' }; }
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
    const font: FontSpec = { name: r('FontName') as string, size: r('FontSize') as number, bold: r('FontWeight') === 'bold',
      italic: r('FontItalic') as boolean, underline: r('FontUnderline') as boolean };
    if (!resolveFont(font.name).portable) add('fontNotPortable', undefined, font.name);
    const format = r('Format') as string, places = r('DecimalPlaces') as string, picture = r('Picture'), sizeMode = r('SizeMode', 'zoom');
    return {
      kind, name, left: twips(c.left, name), top: twips(c.top, name), width: twips(c.width, name), height: twips(c.height, name),
      source: source(r('ControlSource') as string, name, 'invalidExpression', pageSection ? 'aggregateNotAllowed' : undefined),
      caption: r('Caption') as string, ...(format === '' ? {} : { format }), decimalPlaces: places === 'auto' ? 'auto' : Number(places),
      visible: r('Visible') as boolean, canGrow: r('CanGrow') as boolean, canShrink: r('CanShrink') as boolean,
      font, color: readColor(p, 'ForeColor', target),
      back: r('BackStyle') === 'transparent' ? null : readColor(p, 'BackColor', target),
      // BorderWidth: px 0–6; 0 = hairline, drawn 1 px (15 twips) wide, as in A4
      border: r('BorderStyle') === 'transparent' ? null
        : { width: Math.round(Math.max(1, r('BorderWidth') as number) * 15), color: readColor(p, 'BorderColor', target), style: r('BorderStyle') as Border['style'] },
      align: r('TextAlign') as ControlSpec['align'],
      // Picture, SizeMode and LineSlant come with A4: read raw until then; only an embedded image is ever drawn.
      ...(kind === 'image' ? { ...(typeof picture === 'string' && picture.startsWith('data:image/') ? { picture } : {}),
        sizeMode: isIn(sizeMode, ['clip', 'stretch', 'zoom']) ? sizeMode : 'zoom' } : {}),
      ...(kind === 'line' ? { slant: r('LineSlant', false) === true } : {}),
    };
  };

  /** Controls in drawing order: each one, then its children (already section-relative), depth first. */
  const controls = (list: unknown, pageSection: boolean): ControlSpec[] => arr(list).flatMap((v) => {
    const c = obj(v), kind = c.kind, name = typeof c.name === 'string' ? c.name : '';
    if (!isIn(kind, CONTROL_KINDS) || NOT_DRAWN.includes(kind)) { add('unsupportedControl', name, String(kind)); return []; }
    if (kind === 'subform') add('unsupportedControl', name, kind);
    return [control(c, kind, name, pageSection), ...controls(c.children, pageSection)];
  });

  const section = (s: Obj, kind: SectionKind, groupLevel?: number): SectionSpec => {
    const p = obj(s.props), r = (prop: string) => readProp(p, prop, kind);
    return {
      kind, ...(groupLevel === undefined ? {} : { groupLevel }), height: twips(s.height, undefined, kind),
      visible: r('Visible') as boolean, canGrow: r('CanGrow') as boolean, canShrink: r('CanShrink') as boolean,
      keepTogether: r('KeepTogether') as boolean, repeatSection: r('RepeatSection') as boolean,
      forceNewPage: r('ForceNewPage') as SectionSpec['forceNewPage'], back: readColor(p, 'BackColor', kind),
      controls: controls(s.controls, kind === 'pageHeader' || kind === 'pageFooter'),
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

  const spec: ReportSpec = { width: 0, page, grouping, groupHeaders: grouping.map(() => undefined), groupFooters: grouping.map(() => undefined), issues };
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

  if (Number.isSafeInteger(props.Width)) twips(props.Width, undefined, 'Width');   // reported when clamped
  spec.width = reportWidth(doc);
  if (spec.width > pageGeometry(page).printableWidth) add('widthExceedsPage');
  return spec;
}
