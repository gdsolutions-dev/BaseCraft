// Mise en forme d'une bande d'état (pur) : valeur et texte de chaque contrôle, lignes coupées et alignées, Peut augmenter /
// Peut réduire sur les positions de conception (règle d'Access), points de coupe et sauts de page. Le placement sur la page
// est la tâche 6, qui appelle aussi onPrint.
import { aggregateArgType } from '../expr/aggregate';
import { ExprRuntimeError, ExprSyntaxError, type Value } from '../expr/ast';
import { evaluate } from '../expr/evaluate';
import { formatValue } from '../expr/format';
import { infoOf, num, truthy } from '../expr/library';
import { resolveColor } from '../design/colors';
import { firstMatch } from '../design/format-conditions';
import { sameName } from '../field-types';
import type { ControlSource, ControlSpec, ReportIssue, SectionSpec } from './model';
import { richToPlain } from '../rich-text';
import { lineHeight, measure, wrap } from './text';
import { computeAggregate, rowField, type AggSpec } from './totals';
import type { Border, LaidOutItem, LayoutEnv, ReportData, SectionEvent, SubLayout } from './types';

export interface BandContext { row: number | null; scope: number[]; page: number; pages: number | null; formatCount: number;
  /** A subreport's content for the band's row (layoutReport's); absent or null: an empty frame. */
  sub?(c: ControlSpec, row: number | null): Promise<SubLayout | null> }
export interface FormattedBand { height: number; items: LaidOutItem[]; cuts: number[] /* y où l'on peut couper, croissants */; breaks: number[] /* y des sauts de page */;
  event: SectionEvent; issues: ReportIssue[] }

/** Totals that keep their argument's type, so a Currency total prints as currency. */
const TYPED_TOTALS = ['Sum', 'Avg', 'Min', 'Max', 'First', 'Last'];

// ponytail: keyed on the scope array's identity, so the caller must never mutate a scope it has passed (Task 6 builds one per group)
const totalsCache = new WeakMap<number[], { data: ReportData; env: LayoutEnv; totals: Map<AggSpec, Promise<Value>> }>();
/** A total over `ctx.scope`, computed once per (scope, data, env, aggregate): every row of a group shares its totals. */
function total(a: AggSpec, data: ReportData, ctx: BandContext, env: LayoutEnv): Promise<Value> {
  let c = totalsCache.get(ctx.scope);
  if (c?.data !== data || c.env !== env) totalsCache.set(ctx.scope, c = { data, env, totals: new Map() });
  let p = c.totals.get(a);
  if (!p) c.totals.set(a, p = computeAggregate(a, { fields: data.fields, rows: data.rows, scope: ctx.scope,
    env: { now: () => env.now(), locale: env.locale, lang: env.lang, ...(env.member ? { member: env.member } : {}), ...(env.callUser ? { callUser: env.callUser } : {}) } }));
  return p;
}

/**
 * A bound control's value, or the text Access shows in its place: #Nom? for an unknown field, #Erreur for any other
 * failure. An expression reads, in this order: its totals (computed over `ctx.scope`), Page and Pages when the source has
 * no such field (only here, never inside a total), then the row's fields; with no current row a field is Null.
 */
async function valueOf(src: Exclude<ControlSource, { kind: 'none' }>, data: ReportData, ctx: BandContext, env: LayoutEnv): Promise<Value | string> {
  const column = (name: string) => data.fields.findIndex((f) => sameName(f.name, name));
  const field = rowField(data.fields, ctx.row === null ? null : data.rows[ctx.row]!);
  try {
    if (src.kind === 'error') return env.errorText.error;
    if (src.kind === 'field') return field(src.name);
    const base = { now: () => env.now(), locale: env.locale, lang: env.lang, ...(env.member ? { member: env.member } : {}), ...(env.callUser ? { callUser: env.callUser } : {}) };
    const totals = new Map<string, Value>();
    for (const a of src.aggs) totals.set(a.id, await total(a, data, ctx, env));
    const page = (name: string, p: string) => sameName(name, p) && column(name) < 0;
    return await evaluate(src.expr, { ...base, field: (name) => totals.has(name) ? totals.get(name)!
      : page(name, 'Page') ? num(ctx.page) : page(name, 'Pages') ? num(ctx.pages ?? 0) : field(name) });
  } catch (e) {
    if (e instanceof ExprRuntimeError) return e.code === 'unknownField' || e.code === 'unknownFunction' || e.code === 'contentDisabled' ? env.errorText.name : env.errorText.error;
    if (e instanceof ExprSyntaxError) return env.errorText.error;
    throw e;
  }
}

/** Format of a text box without one: a bare field's own, else currency for a Currency field or a Currency total. */
function defaultFormat(src: ControlSource, data: ReportData): string | undefined {
  const find = (name: string) => data.fields.find((f) => sameName(f.name, name));
  if (src.kind === 'field') { const f = find(src.name); return f?.props.format || (f?.type === 'currency' ? 'currency' : undefined); }
  if (src.kind !== 'expr' || src.expr.k !== 'id') return undefined;
  const root = src.expr.name, a = src.aggs.find((x) => x.id === root);   // a total is the whole expression
  return a && TYPED_TOTALS.includes(a.fn) && aggregateArgType(a.arg, find).type === 'currency' ? 'currency' : undefined;
}

/** The gridlines a drawn item carries (nothing when none: the markup is then unchanged). */
const grid = (c: ControlSpec) => (c.gridlines ? { grid: c.gridlines } : {});

/** A text control's lines inside its border; Can Grow keeps every line, otherwise the lines that fit (one at least). */
function textItem(c: ControlSpec, text: string, numeric: boolean, issues: ReportIssue[]): Extract<LaidOutItem, { kind: 'text' }> {
  const bw = c.border?.width ?? 0, lh = lineHeight(c.font);
  const { top: mt, bottom: mb, left: ml, right: mr } = c.margin;
  const inner = Math.max(0, c.width - 2 * bw - ml - mr);   // the margins inset the text inside the border
  let { lines, missing } = wrap(text, c.font, inner);   // measure only lines: never raw text with line breaks
  // a number or a date that does not fit on one line shows as many # as fit, as Access does
  if (numeric && (lines.length > 1 || measure(lines[0] ?? '', c.font).width > inner)) {
    lines = ['#'.repeat(Math.max(1, Math.floor(inner / measure('#', c.font).width)))];
    missing = [];
  }
  for (const ch of missing) issues.push({ code: 'glyphMissing', control: c.name, detail: ch });
  const kept = c.canGrow ? lines : lines.slice(0, Math.max(1, Math.floor((c.height - 2 * bw - mt - mb) / lh)));
  const align = c.align === 'general' ? (numeric ? 'right' : 'left') : c.align;
  return { kind: 'text', name: c.name, left: c.left, top: c.top, width: c.width,
    height: c.canGrow ? Math.max(c.height, kept.length * lh + 2 * bw + mt + mb) : c.height,
    font: c.font, color: c.color, back: c.back, border: c.border, align, ...grid(c),
    lines: kept.map((t, i) => {
      const w = measure(t, c.font).width;
      return { text: t, x: ml + Math.round(align === 'right' ? inner - w : align === 'center' ? (inner - w) / 2 : 0), y: mt + i * lh, width: Math.round(w) };
    }) };
}

/** A small box of text drawn over a control (a group's caption, a tab): `text` at `left` inside the control, on `back`. */
function tag(c: ControlSpec, text: string, left: number, back: string, border: Border | null, issues: ReportIssue[], height = lineHeight(c.font)): Extract<LaidOutItem, { kind: 'text' }> {
  const width = Math.ceil(measure(text, c.font).width) + 120 + 2 * (border?.width ?? 0);
  return textItem({ ...c, left: c.left + left, top: c.top, width, height, border, back, align: 'left', canGrow: false, margin: { top: 0, right: 0, bottom: 0, left: 60 }, gridlines: null },
    text, false, issues);
}

interface Box { c: ControlSpec; item?: LaidOutItem; grow: number; shrunk: boolean; more?: LaidOutItem[] /* a subreport's content, in band coordinates */ }

const moved = (i: LaidOutItem, dx: number, dy: number): LaidOutItem =>
  i.kind === 'line' ? { ...i, x1: i.x1 + dx, x2: i.x2 + dx, y1: i.y1 + dy, y2: i.y2 + dy } : { ...i, left: i.left + dx, top: i.top + dy };

/**
 * Formats section `s` for one row (or none) and one aggregate scope: `onFormat` sees the values, the visibility and the
 * design height before anything is measured, and what it changes applies. Null when the section is invisible or the
 * event cancels it. Positions are twips relative to the band; invisible controls are neither drawn nor move anything.
 */
export async function formatBand(s: SectionSpec, data: ReportData, ctx: BandContext, env: LayoutEnv): Promise<FormattedBand | null> {
  // sans prototype : un contrôle nommé __proto__ reçoit sa valeur comme les autres
  const values: Record<string, Value> = Object.create(null) as Record<string, Value>, failed = new Map<string, string>();
  const event: SectionEvent = { section: s.kind, ...(s.groupLevel === undefined ? {} : { groupLevel: s.groupLevel }), formatCount: ctx.formatCount,
    page: ctx.page, values, visible: Object.fromEntries(s.controls.map((c) => [c.name, c.visible])), sectionVisible: s.visible, cancel: false, height: s.height,
    field: rowField(data.fields, ctx.row === null ? null : data.rows[ctx.row]!) };
  env.hooks?.onBand?.(event);   // [Reports]! in the values below reads this band: its controls read so far, else its row
  for (const c of s.controls) {
    if (c.source.kind === 'none') continue;
    const v = await valueOf(c.source, data, ctx, env);
    if (typeof v === 'string') failed.set(c.name, v);
    else values[c.name] = v;
  }
  await env.hooks?.onFormat?.(event);
  if (event.cancel || !event.sectionVisible) return null;

  const issues: ReportIssue[] = [];
  const boxes: Box[] = [], pageBreaks: number[] = [];
  for (const c of s.controls) {
    // own entries only: a control named toString or constructor never reads Object.prototype
    if (!(Object.hasOwn(event.visible, c.name) && event.visible[c.name])) continue;
    const has = Object.hasOwn(event.values, c.name), v = has ? event.values[c.name] ?? null : null;
    const box: Box = { c, grow: 0, shrunk: false };
    const at = { name: c.name, left: c.left, top: c.top, width: c.width, height: c.height };
    switch (c.kind) {
      case 'label': case 'textBox': case 'comboBox': case 'listBox': {   // a list box prints its bound value, as a combo box does
        // a text box on a Rich Text field: measured as its text (lists marked), drawn as its HTML
        const bound = c.kind === 'textBox' && c.source.kind === 'field' ? c.source.name : null;
        const rich = bound !== null && data.fields.some((f) => f.type === 'longText' && f.props.textFormat === 'rich' && sameName(f.name, bound));
        let text = c.kind === 'label' ? c.caption
          : has ? formatValue(v, c.format ?? defaultFormat(c.source, data), { locale: env.locale, lang: env.lang, decimalPlaces: c.decimalPlaces ?? 'auto', ...(env.fourDigitYear ? { fourDigitYear: true } : {}) })
          : failed.get(c.name) ?? '';
        // conditional formatting: the first rule that holds for this row (the control's value is the subject; fields of the row only)
        const fmt = c.conditions && c.kind !== 'label' ? await firstMatch(c.conditions, v, { field: event.field, now: () => env.now(), locale: env.locale, lang: env.lang,
          ...(env.member ? { member: env.member } : {}), ...(env.callUser ? { callUser: env.callUser } : {}) }) : null;
        const look = !fmt ? c : { ...c, font: { ...c.font, bold: c.font.bold || !!fmt.bold, italic: c.font.italic || !!fmt.italic, underline: c.font.underline || !!fmt.underline },
          color: fmt.fore ? resolveColor(fmt.fore, 'light') : c.color, back: fmt.back ? resolveColor(fmt.back, 'light') : c.back };
        const html = text;
        if (rich) text = richToPlain(html);
        const item = textItem(look, text, c.kind !== 'label' && has && (v?.t === 'num' || v?.t === 'date'), issues);
        if (rich) item.rich = { html, inset: [c.margin.top, c.margin.right, c.margin.bottom, c.margin.left] };
        if (c.canShrink && text === '') box.shrunk = true;
        else { box.item = item; box.grow = item.height - c.height; }
        break;
      }
      case 'checkBox': case 'optionButton': {
        let checked: boolean | null = null;
        try { checked = truthy(v, infoOf(env.locale)); } catch (e) { if (!(e instanceof ExprRuntimeError)) throw e; }   // not a truth value: neither
        box.item = { kind: 'check', ...at, checked, color: c.color, ...grid(c) };
        break;
      }
      case 'commandButton': case 'toggleButton': {   // the face with its caption; a toggle button is sunken (darker face) when its value is true
        let down = false;
        if (c.kind === 'toggleButton') try { down = truthy(v, infoOf(env.locale)) === true; } catch (e) { if (!(e instanceof ExprRuntimeError)) throw e; }
        box.item = textItem({ ...c, align: 'center', back: down && c.back ? '#b4b4b4' : c.back }, c.caption, false, issues);
        break;
      }
      case 'optionGroup': {   // a frame with its caption (Caption) over the top edge; its option buttons are controls of their own
        box.item = { kind: 'rect', ...at, border: c.border, back: c.back, ...grid(c) };
        box.more = c.caption ? [tag(c, c.caption, 113, '#ffffff', null, issues)] : [];
        break;
      }
      case 'tabControl': {   // the page captions as tabs over a frame; the first page selected
        const strip = lineHeight(c.font) + 60;
        box.item = { kind: 'rect', ...at, top: c.top + strip, height: Math.max(0, c.height - strip), border: c.border, back: c.back, ...grid(c) };
        let x = 0;
        box.more = (c.pages ?? []).map((p, i) => { const t = tag(c, p, x, i === 0 ? '#ffffff' : '#e1e1e1', c.border, issues, strip); x += t.width; return t; });
        break;
      }
      case 'line':
        if (c.border) box.item = { kind: 'line', name: c.name, x1: c.left, x2: c.left + c.width, border: c.border,
          y1: c.slant ? c.top + c.height : c.top, y2: c.slant ? c.top : c.top + c.height };
        break;
      case 'rectangle': box.item = { kind: 'rect', ...at, border: c.border, back: c.back, ...grid(c) }; break;
      case 'subform': {
        // the subreport's bands for this row inside the frame (empty without a Source Object); it grows to its content
        const sub = c.sub?.source ? await ctx.sub?.(c, ctx.row) ?? null : null;
        if (sub) issues.push(...sub.issues);
        if (sub && c.canShrink && sub.height === 0) { box.shrunk = true; break; }
        const bw = c.border?.width ?? 0, w = c.width - 2 * bw;
        const height = sub && c.canGrow ? Math.max(c.height, sub.height + 2 * bw) : c.height;
        box.item = { kind: 'rect', ...at, height, border: c.border, back: c.back, ...grid(c) };
        box.grow = height - c.height;
        // ponytail: what starts outside the frame is dropped, what straddles its edge overflows (no clip); a clipping
        // group item when a subreport wider than its control matters
        box.more = sub?.items.filter((i) => (i.kind === 'line' ? Math.min(i.x1, i.x2) < w && Math.min(i.y1, i.y2) < height - 2 * bw : i.left < w && i.top < height - 2 * bw))
          .map((i) => moved(i, c.left + bw, c.top + bw));
        break;
      }
      case 'image': if (c.picture) box.item = { kind: 'image', ...at, src: c.picture, sizeMode: c.sizeMode ?? 'zoom', ...(c.pictureAlign ? { pictureAlign: c.pictureAlign } : {}), ...(c.tiling ? { tiling: true } : {}), ...grid(c) }; break;
      case 'chart': if (c.chart) box.item = { kind: 'chart', ...at, ...c.chart }; break;
      case 'pageBreak': pageBreaks.push(c.top); continue;
      default: continue;   // readReport keeps no other kind
    }
    boxes.push(box);
  }

  // Can Grow / Can Shrink on design positions (Access). A control moves down by the largest push of the controls that end
  // above it and start above it (a zero-height box is neither above itself nor above one at its own top), a push being their
  // own push plus their growth (stacked growing boxes add up, side by side the largest wins); it moves up by the freed space
  // above it: the bands of empty Can Shrink boxes that no drawn control overlaps.
  const bottom = (b: Box) => b.c.top + b.c.height;
  const push = new Map<Box, number>();
  const pushAt = (y: number, above = (_: Box) => true) =>
    Math.max(0, ...boxes.filter((b) => bottom(b) <= y && above(b)).map((b) => (push.get(b) ?? 0) + b.grow));
  for (const b of [...boxes].sort((p, q) => p.c.top - q.c.top)) push.set(b, pushAt(b.c.top, (o) => o.c.top < b.c.top));
  const freed = boxes.filter((z) => z.shrunk && !boxes.some((o) => !o.shrunk && o.c.top < bottom(z) && bottom(o) > z.c.top))
    .map((z) => [z.c.top, bottom(z)] as const).sort((p, q) => p[0] - q[0]);
  const freedAbove = (y: number) => {   // length of the union of the freed bands, cut at y: a page break inside one moves up too
    let sum = 0, end = -Infinity;
    for (const [a, b] of freed) { const from = Math.max(a, end), to = Math.min(b, y); if (to > from) sum += to - from; end = Math.max(end, b); }
    return sum;
  };
  const shift = (y: number) => pushAt(y) - freedAbove(y);

  // `between` a Set: a Can Grow memo of n lines gives n candidates, each looked up in O(1) (final review M5)
  const span = (i: LaidOutItem) => i.kind === 'line' ? { top: Math.min(i.y1, i.y2), bottom: Math.max(i.y1, i.y2), between: new Set<number>() }
    : { top: i.top, bottom: i.top + i.height, between: new Set(i.kind === 'text' ? i.lines.slice(1).map((l) => i.top + (i.border?.width ?? 0) + l.y) : []) };
  const items: LaidOutItem[] = [], spans: ReturnType<typeof span>[] = [];
  for (const box of boxes) {
    const { c, item } = box;
    if (!item) continue;
    const d = push.get(box)! - freedAbove(c.top), frame = span(moved(item, 0, d));
    items.push(moved(item, 0, d)); spans.push(frame);
    // a subreport's frame can be cut wherever its content can: between its bands
    for (const m of box.more ?? []) {
      const inner = span(moved(m, 0, d));
      items.push(moved(m, 0, d)); spans.push(inner);
      for (const y of [inner.top, inner.bottom, ...inner.between]) frame.between.add(y);
    }
  }

  let height = event.height + (s.canGrow ? pushAt(event.height) : 0);
  // a shrinking section loses the freed bands at its bottom, never ending above its last control
  if (s.canShrink) height = Math.max(height - freedAbove(event.height), Math.min(height, Math.max(0, ...spans.map((sp) => sp.bottom))));
  // where no object straddles, plus the boundaries between two lines of a text
  const cuts = [...new Set(spans.flatMap((sp) => [sp.top, sp.bottom, ...sp.between]))]
    .filter((y) => y > 0 && y < height && spans.every((sp) => !(sp.top < y && y < sp.bottom) || sp.between.has(y)))
    .sort((p, q) => p - q);
  return { height, items, cuts, breaks: pageBreaks.map((y) => y + shift(y)).sort((p, q) => p - q), event, issues };
}
