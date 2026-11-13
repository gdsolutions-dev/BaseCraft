// Formulaire en mode Exécution (module pur) : ordre de tabulation, erreurs par contrôle, style d'un contrôle, état modifiable,
// option choisie d'un groupe d'options.
import type { CSSProperties } from 'react';
import type { SqlValue } from '../../shared/coerce';
import { colorCss, type ColorValue } from '../../shared/design/colors';
import type { FormatCondition } from '../../shared/design/format-conditions';
import type { Mode, Theme } from '../../shared/design/theme';
import { flattenControls, type ControlDef, type ControlKind, type DesignDoc, type SectionDef } from '../../shared/design/model';
import { ownLabel } from '../../shared/design/layout';
import { defaultFor, effectiveProp, PROPERTY_CATALOG } from '../../shared/design/properties';
import { sameName } from '../../shared/field-types';
import { cssFamily, EMBEDDED_FONTS, isThemeFontRef, resolveFont } from '../../shared/fonts';
import type { SourceField, SourceInfo } from '../../shared/record-source';
import { twipsToPx } from '../designer/units';
import type { CalcResult } from './calc';
import { boundField, isUnbound } from './control-values';
import { TAB_KINDS } from '../designer/field-controls';
import { writableField, type RecordError, type RecordSnapshot } from './record-controller';

export const prop = (c: ControlDef, name: string): unknown => effectiveProp(c.props, name, c.kind, 'form');
const desc = (name: string) => PROPERTY_CATALOG.find((d) => d.name === name)!;
export const applies = (c: ControlDef, name: string): boolean => desc(name).appliesTo.includes(c.kind);
/** Le thème et le mode avec lesquels une couleur ou une police de thème se résout (absent : le thème intégré, clair). */
export type ThemeCtx = { theme: Theme; mode: Mode };
export const color = (c: ControlDef, name: string, ctx?: ThemeCtx): string =>
  colorCss(prop(c, name), (defaultFor(desc(name), c.kind, 'form') ?? 'transparent') as ColorValue | 'transparent', ctx);

/** La liste `font-family` d'une référence `(Headings)` / `(Body)` : la police embarquée du thème sous son nom « BC … » (voir
 *  DocThemeProvider), puis son nom ; null pour tout autre nom (même rendu qu'avant), et pour Inter (la police de l'application). */
export function themedFamily(name: string, f: { family: string }, generic: string): string | null {
  return isThemeFontRef(name) && f.family !== 'Inter' ? `"${cssFamily(f.family)}", "${f.family}", ${generic}` : null;
}

const pageOf = (c: ControlDef): number => (typeof c.props.PageIndex === 'number' ? c.props.PageIndex : 0);
const stops = (c: ControlDef): boolean => (TAB_KINDS.includes(c.kind) || c.kind === 'tabControl')
  && prop(c, 'TabStop') !== false && prop(c, 'Visible') !== false && prop(c, 'Enabled') !== false;

/** The section's controls that Tab stops on, in tab order (TabIndex, then document order): input controls without Tab Stop,
 *  Visible or Enabled false, and tab controls; a tab control is its strip, then the controls of its page shown (`pages`: the
 *  page shown of each tab control, the first by default), in their own tab order. */
export function tabSequence(section: SectionDef, pages: Record<string, number> = {}): string[] {
  const key = (c: ControlDef) => (typeof c.props.TabIndex === 'number' ? c.props.TabIndex : Number.MAX_SAFE_INTEGER);
  const ordered = (list: ControlDef[]): string[] => list.map((c, i) => ({ c, i })).filter((x) => stops(x.c)).sort((a, b) => key(a.c) - key(b.c) || a.i - b.i)
    .flatMap(({ c }) => (c.kind === 'tabControl' ? [c.name, ...ordered((c.children ?? []).filter((k) => pageOf(k) === (pages[c.name] ?? 0)))] : [c.name]));
  return ordered(section.controls);
}

/** The labels a layout detached from their control, in the same section (Stacked), by label name -> control name: each stays linked
 *  to its control (its accessible name, a click focuses it) and is hidden with it. Tabular header labels sit in another section. */
export function layoutLabels(doc: DesignDoc): Record<string, string> {   // fromEntries: own keys only, even for a label named __proto__
  return Object.fromEntries(doc.sections.flatMap((s) => s.controls.flatMap((c) => { const l = ownLabel(doc, c.name); return l ? [[l.name, c.name]] : []; })));
}

/** Each error under the first control bound to its field (never an unbound control of that name: its own errors are the
 *  form's, not the record's); orphan: a field no control shows, for the form's message bar. */
export function errorsByControl(errs: RecordError[], doc: DesignDoc, info: SourceInfo): { byControl: Record<string, RecordError>; orphan: RecordError[] } {
  const all = doc.sections.flatMap((s) => flattenControls(s.controls));
  const byControl: Record<string, RecordError> = {};
  const orphan: RecordError[] = [];
  for (const e of errs) {
    const c = all.find((x) => { const f = boundField(x, info); return !!f && sameName(f.name, e.field); });
    if (!c) orphan.push(e);
    else byControl[c.name] ??= e;
  }
  return { byControl, orphan };
}

/** The look of the conditional format that holds for this record (calc.ts stores it in the results under `cf:<control>`), if any. */
export function conditionStyle(c: ControlDef, results: Record<string, CalcResult>): CSSProperties {
  const r = results[`cf:${c.name}`];
  if (!r?.ok) return {};
  const f = JSON.parse(r.text) as FormatCondition;
  return { ...(f.bold ? { fontWeight: 700 } : {}), ...(f.italic ? { fontStyle: 'italic' } : {}), ...(f.underline ? { textDecoration: 'underline' } : {}),
    ...(f.fore ? { color: colorCss(f.fore) } : {}), ...(f.back ? { background: colorCss(f.back) } : {}) };
}

/** Position (twips -> px), the look (controlLook) and alignment, every value read through effectiveProp. */
export function controlStyle(c: ControlDef, ctx?: ThemeCtx): CSSProperties {
  const st: CSSProperties = { position: 'absolute', left: twipsToPx(c.left), top: twipsToPx(c.top), width: twipsToPx(c.width), height: twipsToPx(c.height), boxSizing: 'border-box',
    ...controlLook(c, ctx) };
  if (applies(c, 'TextAlign')) {
    const a = String(prop(c, 'TextAlign'));
    if (a === 'left' || a === 'center' || a === 'right') st.textAlign = a;
  }
  return st;
}

/** A label's HyperlinkAddress (D3), trimmed; '' for any other control or a label without one. */
export const linkAddress = (c: ControlDef): string => (c.kind === 'label' && typeof c.props.HyperlinkAddress === 'string' ? c.props.HyperlinkAddress.trim() : '');
/** A hyperlink label is drawn as a link, whatever its fore colour: accent, underlined. */
export const LINK_LOOK: CSSProperties = { color: 'var(--bc-accent)', textDecoration: 'underline' };

/** Colours, border and font: the same in Form view and in the Design view's preview (form-host). */
export function controlLook(c: ControlDef, ctx?: ThemeCtx): CSSProperties {
  const st: CSSProperties = {};
  if (applies(c, 'BackStyle')) st.background = prop(c, 'BackStyle') === 'transparent' ? 'transparent' : color(c, 'BackColor', ctx);
  if (applies(c, 'BorderStyle') && c.kind !== 'line') {   // a line draws its own stroke
    const b = String(prop(c, 'BorderStyle'));
    if (b === 'transparent') st.borderStyle = 'none';
    else Object.assign(st, { borderStyle: b, borderWidth: Math.max(1, Number(prop(c, 'BorderWidth')) || 0), borderColor: color(c, 'BorderColor', ctx) });   // 0: a hairline (A5)
  }
  if (applies(c, 'FontName')) {
    const name = String(prop(c, 'FontName') || 'Inter');
    const f = resolveFont(name, ctx?.theme);
    const generic = EMBEDDED_FONTS.find((x) => x.family === f.family)?.generic ?? 'sans-serif';
    Object.assign(st, {
      fontFamily: themedFamily(name, f, generic) ?? (f.family === 'Inter' ? '"Inter Variable", "Inter", sans-serif' : `"${f.family}", ${generic}`),   // the app's Inter (L9)
      fontSize: (Number(prop(c, 'FontSize')) || 10) * 4 / 3, color: color(c, 'ForeColor', ctx),
      fontWeight: prop(c, 'FontWeight') === 'bold' ? 700 : 400, fontStyle: prop(c, 'FontItalic') === true ? 'italic' : 'normal',
      textDecoration: prop(c, 'FontUnderline') === true ? 'underline' : 'none',
    });
  }
  // Control Margins: the text inset, only on the text-bearing kinds; added to the stylesheet's own inset (--bc-ix/--bc-iy, 0 in print); a side at 0 adds nothing
  return Object.assign(st, marginInset(c));
}

/** Control Margins as CSS padding (the text inset; the box keeps its size). */
export function marginInset(c: ControlDef): CSSProperties {
  const st: CSSProperties = {};
  if (MARGIN_KINDS.includes(c.kind)) {
    for (const [side, key] of SIDE_KEYS) { const m = Number(prop(c, `${side}Margin`)) || 0; if (m > 0) st[key] = `calc(var(${side === 'Top' || side === 'Bottom' ? '--bc-iy' : '--bc-ix'}, 0px) + ${twipsToPx(m)}px)`; }
  }
  return st;
}

const MARGIN_KINDS: ControlKind[] = ['label', 'textBox', 'comboBox', 'listBox'];
const SIDE_KEYS = [['Top', 'paddingTop'], ['Bottom', 'paddingBottom'], ['Left', 'paddingLeft'], ['Right', 'paddingRight']] as const;

/** The gridline overlay of a control, null when its four sides are transparent: an absolutely positioned box at the cell rectangle
 *  (the control grown by its own padding), positioned relative to `origin` (the section's corner by default), drawn as a sibling of
 *  the control so its size and text do not change. ponytail: a cell padded less than its column's maximum draws its lines at its own padding. */
export function gridlineStyle(c: ControlDef, origin: { left: number; top: number } = { left: 0, top: 0 }, ctx?: ThemeCtx): CSSProperties | null {
  if (!applies(c, 'GridlineColor')) return null;
  const pad = (side: string) => Number(prop(c, `${side}Padding`)) || 0;
  const st: CSSProperties = {};
  let any = false;
  for (const [side] of SIDE_KEYS) {
    const style = String(prop(c, `GridlineStyle${side}`));
    if (style === 'transparent') continue;
    any = true;
    (st as Record<string, string>)[`border${side}`] = `${Math.max(1, Number(prop(c, `GridlineWidth${side}`)) || 0)}px ${style} ${color(c, 'GridlineColor', ctx)}`;
  }
  if (!any) return null;
  const [t, b, l, r] = [pad('Top'), pad('Bottom'), pad('Left'), pad('Right')];
  return { ...st, position: 'absolute', boxSizing: 'border-box', pointerEvents: 'none', left: twipsToPx(c.left - l - origin.left), top: twipsToPx(c.top - t - origin.top),
    width: twipsToPx(c.width + l + r), height: twipsToPx(c.height + t + b) };
}

/** Enabled false: disabled. An unbound input is read-only only when Locked. Otherwise read-only: Locked, a record that cannot be edited now (busy, rights), an AutoNumber, a calculated or
 *  unbound control (no field), a field the form cannot write (a computed column, a joined table's field: writableField). */
export function controlEnabled(c: ControlDef, snap: RecordSnapshot, f: SourceField | null): { disabled: boolean; readOnly: boolean } {
  if (isUnbound(c)) return { disabled: prop(c, 'Enabled') === false, readOnly: prop(c, 'Locked') === true };   // its value is the form's
  return {
    disabled: prop(c, 'Enabled') === false,
    readOnly: prop(c, 'Locked') === true || !snap.editable || snap.busy || !f || !snap.info || f.type === 'autoNumber' || !writableField(f, snap.info),
  };
}

/** The option (a child with an Option Value) whose value is the group's: its name, else null. */
export function optionGroupValue(group: ControlDef, stored: SqlValue): string | null {
  if (stored === null || stored === '') return null;
  const v = Number(stored);
  return (group.children ?? []).find((k) => typeof k.props.OptionValue === 'number' && k.props.OptionValue === v)?.name ?? null;
}
