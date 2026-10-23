// Formulaire en mode Exécution (module pur) : ordre de tabulation, erreurs par contrôle, style d'un contrôle, état modifiable,
// option choisie d'un groupe d'options.
import type { CSSProperties } from 'react';
import type { SqlValue } from '../../shared/coerce';
import { colorCss, type ColorValue } from '../../shared/design/colors';
import { flattenControls, type ControlDef, type ControlKind, type DesignDoc, type SectionDef } from '../../shared/design/model';
import { defaultFor, effectiveProp, PROPERTY_CATALOG } from '../../shared/design/properties';
import { sameName } from '../../shared/field-types';
import { EMBEDDED_FONTS, resolveFont } from '../../shared/fonts';
import type { SourceField, SourceInfo } from '../../shared/record-source';
import { twipsToPx } from '../designer/units';
import { boundField, isUnbound } from './control-values';
import { TAB_KINDS } from '../designer/field-controls';
import { writableField, type RecordError, type RecordSnapshot } from './record-controller';

export const prop = (c: ControlDef, name: string): unknown => effectiveProp(c.props, name, c.kind, 'form');
const desc = (name: string) => PROPERTY_CATALOG.find((d) => d.name === name)!;
export const applies = (c: ControlDef, name: string): boolean => desc(name).appliesTo.includes(c.kind);
export const color = (c: ControlDef, name: string): string =>
  colorCss(prop(c, name), (defaultFor(desc(name), c.kind, 'form') ?? 'transparent') as ColorValue | 'transparent');

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

/** Position (twips -> px), the look (controlLook) and alignment, every value read through effectiveProp. */
export function controlStyle(c: ControlDef): CSSProperties {
  const st: CSSProperties = { position: 'absolute', left: twipsToPx(c.left), top: twipsToPx(c.top), width: twipsToPx(c.width), height: twipsToPx(c.height), boxSizing: 'border-box',
    ...controlLook(c) };
  if (applies(c, 'TextAlign')) {
    const a = String(prop(c, 'TextAlign'));
    if (a === 'left' || a === 'center' || a === 'right') st.textAlign = a;
  }
  return st;
}

/** Colours, border and font: the same in Form view and in the Design view's preview (form-host). */
export function controlLook(c: ControlDef): CSSProperties {
  const st: CSSProperties = {};
  if (applies(c, 'BackStyle')) st.background = prop(c, 'BackStyle') === 'transparent' ? 'transparent' : color(c, 'BackColor');
  if (applies(c, 'BorderStyle') && c.kind !== 'line') {   // a line draws its own stroke
    const b = String(prop(c, 'BorderStyle'));
    if (b === 'transparent') st.borderStyle = 'none';
    else Object.assign(st, { borderStyle: b, borderWidth: Math.max(1, Number(prop(c, 'BorderWidth')) || 0), borderColor: color(c, 'BorderColor') });   // 0: a hairline (A5)
  }
  if (applies(c, 'FontName')) {
    const name = String(prop(c, 'FontName') || 'Inter');
    const f = resolveFont(name);
    const generic = EMBEDDED_FONTS.find((x) => x.family === f.family)?.generic ?? 'sans-serif';
    Object.assign(st, {
      fontFamily: f.family === 'Inter' ? '"Inter Variable", "Inter", sans-serif' : `"${f.family}", ${generic}`,   // the app's Inter (L9)
      fontSize: (Number(prop(c, 'FontSize')) || 10) * 4 / 3, color: color(c, 'ForeColor'),
      fontWeight: prop(c, 'FontWeight') === 'bold' ? 700 : 400, fontStyle: prop(c, 'FontItalic') === true ? 'italic' : 'normal',
      textDecoration: prop(c, 'FontUnderline') === true ? 'underline' : 'none',
    });
  }
  return st;
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
