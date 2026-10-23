// Contexte d'exécution partagé par les contrôles d'un formulaire en mode Formulaire : enregistrement courant, résultats des calculs,
// erreurs, saisie et événements clavier/focus (fournis par la vue).
import type { TFunction } from 'i18next';
import type { CSSProperties, FocusEvent, KeyboardEvent, RefObject } from 'react';
import type { CellInput, SqlValue } from '../../../shared/coerce';
import type { ControlDef } from '../../../shared/design/model';
import type { Value } from '../../../shared/expr/ast';
import { infoOf, num, str, toText } from '../../../shared/expr/library';
import type { RecordSourceRef, SourceField, SourceInfo } from '../../../shared/record-source';
import { editText, type LookupList } from '../../datasheet/datasheet-cells';
import type { ComboOption } from '../../shell/combobox-model';
import { typedValue, type CalcResult } from '../calc';
import { boundField, controlTexts, isUnbound } from '../control-values';
import { rowOfText, rowOfValue } from '../row-source';
import type { FormRecords, RecordSnapshot } from '../record-controller';
import { twipsToPx } from '../../designer/units';
import { controlStyle, prop } from '../run-model';

export interface RunCtx {
  snap: RecordSnapshot;
  info: SourceInfo | null;
  results: Record<string, CalcResult>;   // the current record's calculated controls (empty until computed)
  defaults: Record<string, SqlValue>;    // the new record's default values, by source field (shown until typed over)
  display: { locale: string; lang: 'fr' | 'en' };
  t: TFunction;
  focused: string | null;
  errors: Record<string, string>;        // control name -> message shown under it
  stops: Set<string>;                    // Tab stops (tabIndex 0); other controls take the focus by click only
  id(name: string): string;              // the control's DOM id
  edit(f: SourceField, input: CellInput): void;
  unbound: Record<string, UnboundValue>;   // unbound inputs' values, by control name (kept across records)
  editUnbound(c: ControlDef, value: Value, text?: string): void;
  events(c: ControlDef): { onFocus(): void; onBlur(e: FocusEvent): void; onKeyDown(e: KeyboardEvent): void };
  pages: Record<string, number>;          // the page shown of each tab control (the first by default)
  setPage(tabControl: string, page: number): void;
  lists: Record<string, ListState>;       // each combo and list box's rows, by control name (absent until read)
  typed: Record<string, string>;          // a bound combo's text typed that matched no row, by control name (its entry while it is the pending value)
  setTyped(name: string, text: string | undefined): void;
  sub?: SubformHost;                      // what the form's subform controls need from it (Task 11)
  other?: boolean;                        // another row of Continuous Forms or the datasheet: shown, not current
}

/** The master form, for its subform controls. */
export interface SubformHost {
  records: FormRecords;                   // its records: their link values, leave hooks
  ancestors: string[];                    // its name and the forms above it (a subform already among them is recursive)
  readOnly: boolean; active: boolean; region: string;
  root: RefObject<HTMLDivElement>;        // the master's form: the focus leaving a subform toward it saves the subform's record
  enter(name: string): Promise<boolean>;  // the focus entering a subform: the master's record saved first (refused: focus back on it)
  register(name: string, api: RunnerApi | null): void;
  exit(name: string, dir: 1 | -1): void;  // out of the subform (Ctrl+Tab, Tab past its last control): the master's next or previous stop
  focusOf(name: string): void;            // the focus is in the subform: the master's control focused, for its commands
  filterOf(name: string, has: boolean): void;   // the subform (or the one the focus is in, inside it) is filtered: Toggle Filter
  dirtyOf(name: string, sources: RecordSourceRef[]): void;   // the subform's sources with a record being edited (its own, deeper ones): the master's tab
  leavePage(tabControl: string, page: number): Promise<boolean>;   // the page left: its subforms saved first (false: refused)
}

/** A form running (a subform), as its master drives it. */
export interface RunnerApi {
  run(cmd: string): void;                 // a record command (ribbon), on the form that has the focus: this one or one of its subforms
  leave(reason: 'mode' | 'close'): Promise<boolean>;   // its record saved (or discarded on demand), its subforms' first
  save(): Promise<boolean>;               // its subforms' records, then its own, with the refusal message box
  focusIn(): void;                        // the focus on its last control, else its first stop
  requery(ask: boolean): Promise<boolean>;   // Requery (its master's): read again, its record saved first, its subforms too; ask: Shift+F9 (its parameters asked again)
}

/** A combo or list box's rows (LookupData with the text of each value), what AutoExpand compares, and how the reading went. */
export interface ListState { data: LookupList; options: ComboOption[]; truncated: boolean; error?: unknown }
export const NO_LIST: ListState = { data: { rows: [], widths: [], text: new Map() }, options: [], truncated: false };

/** An unbound input's value, and the text typed in a text box (shown as typed). */
export interface UnboundValue { value: Value; text?: string }

/** The text an unbound text box shows. */
export function unboundText(c: ControlDef, x: RunCtx): string {
  const u = x.unbound[c.name];
  return !u ? '' : u.text ?? (u.value === null ? '' : toText(u.value, infoOf(x.display.locale)));
}

/** The navigation bar's note on a source that is not updatable (a Totals query, a join without a key table). */
export const readOnlyNote = (x: RunCtx): string | undefined => (x.info && !x.info.updatable ? x.t('form.readOnlySource') : undefined);

export interface CtlProps { c: ControlDef; x: RunCtx; style: CSSProperties }

/** The control's bound field, with its stored value and its pending typed input (undefined: none). */
export function fieldOf(c: ControlDef, x: RunCtx): { f: SourceField; stored: SqlValue; pending: CellInput | undefined } | null {
  const f = x.info ? boundField(c, x.info) : null;
  if (!f || !x.info) return null;
  const stored = Object.hasOwn(x.defaults, f.name) ? x.defaults[f.name] : x.snap.values[x.info.fields.indexOf(f)] ?? null;
  return { f, stored, pending: Object.hasOwn(x.snap.pending, f.name) ? x.snap.pending[f.name] : undefined };
}

/** The control has an attached label (its accessible name); otherwise its name is. */
export const hasLabel = (c: ControlDef): boolean => (c.children ?? []).some((k) => k.kind === 'label');

/** Attributes every focusable control carries: id, test id, accessible name without a label, tooltip, tab stop, error link, focus and keys. */
export function ctlAttrs(c: ControlDef, x: RunCtx) {
  const err = x.errors[c.name];
  const tip = prop(c, 'ControlTipText');
  return {
    id: x.id(c.name), 'data-testid': `form-ctl-${c.name}`, 'data-ctl': c.name, tabIndex: x.stops.has(c.name) ? 0 : -1,
    ...(hasLabel(c) ? {} : { 'aria-label': c.name }),
    ...(typeof tip === 'string' && tip ? { title: tip } : {}),
    ...(err !== undefined ? { 'aria-invalid': true } : {}),
    ...describedBy(c, x),
    ...x.events(c),
  };
}

/** The control's error and its list's reading error (form.list.sourceError), shown under it. */
export function describedBy(c: ControlDef, x: RunCtx): { 'aria-describedby'?: string } {
  const ids = [x.errors[c.name] !== undefined && `${x.id(c.name)}-err`, x.lists[c.name]?.error !== undefined && `${x.id(c.name)}-note`].filter(Boolean);
  return ids.length ? { 'aria-describedby': ids.join(' ') } : {};
}

const rawOf = (v: Value, locale: string): CellInput => (v === null ? null : v.t === 'num' || v.t === 'str' ? v.v : toText(v, infoOf(locale)));

/** The row a combo or list box stands on (-1: none) and the text it shows: the row's first visible column, else the value as is
 *  (a value not in the list, a text typed). A calculated one shows its result; one bound to an unknown field, #Name?. */
export function listCurrent(c: ControlDef, x: RunCtx): { row: number; text: string } {
  const { data } = x.lists[c.name] ?? NO_LIST;
  const at = (row: number, other: string) => ({ row, text: row >= 0 ? data.rows[row].display[0] ?? '' : other });
  if (isUnbound(c)) {
    const u = x.unbound[c.name];
    if (!u) return { row: -1, text: '' };
    if (u.text !== undefined) return at(rowOfText(data, u.text), u.text);
    const raw = rawOf(u.value, x.display.locale);
    return at(rowOfValue(data, raw, String), raw === null ? '' : String(raw));
  }
  if (x.snap.status !== 'ready') return { row: -1, text: '' };
  const src = prop(c, 'ControlSource');
  if (typeof src === 'string' && src.startsWith('=')) {
    const r = x.results[c.name];
    return { row: -1, text: !r ? '' : r.ok ? r.text : x.t(`form.calc.${r.code}`) };
  }
  const b = fieldOf(c, x);
  if (!b) return { row: -1, text: src ? x.t('form.calc.name') : '' };
  const editOf = (v: SqlValue) => editText(b.f, v, x.display.locale);
  if (b.pending !== undefined) {
    const typed = x.typed[c.name];
    if (typed !== undefined && typed === b.pending) return at(rowOfText(data, typed), typed);   // as typed, even a hidden bound value
    return at(rowOfValue(data, b.pending, editOf), b.pending === null ? '' : String(b.pending));
  }
  if (!x.lists[c.name]) return { row: -1, text: '' };   // the list is still being read: never a flash of the hidden bound N°
  return at(rowOfValue(data, b.stored, editOf), controlTexts(c, b.f, b.stored, undefined, x.display).display);
}

/** A row chosen (row >= 0), else a text typed that is in no row: the field gets the row's bound value (as its edit text, as the
 *  datasheet's list does) or the text as typed; an unbound control keeps the value and the text it shows. */
export function listChoose(c: ControlDef, x: RunCtx, row: number, typed: string): void {
  const r = row >= 0 ? (x.lists[c.name] ?? NO_LIST).data.rows[row] : undefined;
  if (isUnbound(c)) {
    const v = r?.value ?? null;
    x.editUnbound(c, r ? (v === null ? null : typeof v === 'number' ? num(v) : str(String(v))) : typedValue(typed, x.display.locale), r ? r.display[0] ?? '' : typed);
    return;
  }
  const b = fieldOf(c, x);
  if (!b) return;
  x.setTyped(c.name, r ? undefined : typed);
  x.edit(b.f, r ? (r.value === null ? null : editText(b.f, r.value, x.display.locale)) : typed);
}

/** The tooltip only (controls that take no focus). */
export const tipOf = (c: ControlDef): { title?: string } => {
  const tip = prop(c, 'ControlTipText');
  return typeof tip === 'string' && tip ? { title: tip } : {};
};

/** The control's style inside a container (option group, tab control): positions relative to it. */
export function placed(c: ControlDef, origin: { left: number; top: number } | null): CSSProperties {
  const st = controlStyle(c);
  return origin ? { ...st, left: twipsToPx(c.left - origin.left), top: twipsToPx(c.top - origin.top) } : st;
}
