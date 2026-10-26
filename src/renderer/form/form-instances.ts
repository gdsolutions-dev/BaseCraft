// The open forms and reports (B2): what [Forms]! / [Reports]! reach (R11) and what the macro actions act on. No React: a
// form view registers its instance at mount, before On Open, so [Forms]! works in its own events.
import { ExprRuntimeError, type Value } from '../../shared/expr/ast';
import { fail, fromSerial } from '../../shared/expr/library';
import { parseCanonical } from '../../shared/expr/parser';
import type { CellInput } from '../../shared/coerce';
import { foldName, sameName } from '../../shared/field-types';
import { tempVars } from '../macro/temp-vars';

export type RecordTarget = 'previous' | 'next' | 'first' | 'last' | 'goTo' | 'new';
export type SettableProperty = 'enabled' | 'visible' | 'locked' | 'left' | 'top' | 'width' | 'height' | 'foreColor' | 'backColor' | 'caption' | 'value';
export interface FindOptions { what: string; match: 'anywhere' | 'whole' | 'start'; matchCase: boolean; search: 'up' | 'down' | 'all'; onlyCurrentField: boolean; findFirst: boolean }
export interface FormInstance {
  name: string; tabId: string;
  /** R11: the control (with the value being typed), else the source field, of the current record; else ExprRuntimeError('unknownField'). */
  value(control: string): Value;
  /** A control or field of the current record; rejects bc:readOnly, bc:notFound||<name>; fires no update event (R18). */
  setValue(target: string, v: Value): Promise<void>;
  /** R9 (`value`: as setValue); throws bc:propertyNotSupported, bc:notFound||<name>. */
  setProperty(control: string, p: SettableProperty, v: Value): void | Promise<void>;
  /** Rejects bc:cantGoToRecord (Access 2105). */
  goToRecord(r: RecordTarget, offset?: number): Promise<void>;
  /** Throws bc:notFound||<name>, bc:cantFocus (invisible or disabled); rejects bc:actionCancelled when the control left keeps
   *  the focus (its Before Update or On Exit cancelled). Resolves once the focus events it raised have run (R6). */
  goToControl(name: string): void | Promise<void>;
  applyFilter(where: string): Promise<void>; showAllRecords(): Promise<void>;
  /** false: not found (Access shows a message, no failure). */
  find(o: FindOptions): Promise<boolean>;
  /** None: the form's records; a list: its rows; a subform: its records. */
  requery(control?: string): Promise<void>;
  /** A refused save rejects bc:saveRefused. A save, a move, a requery or a delete asked while a Before Update / Before Insert
   *  of the form runs rejects bc:saveDuringEvent (Access 2115). */
  saveRecord(): Promise<void>; undoRecord(): void; deleteRecord(warnings: boolean): Promise<void>; refreshRecord(): Promise<void>;
}
export interface ReportInstance { name: string; value(control: string): Value }

const forms: FormInstance[] = [];
const reports: ReportInstance[] = [];
/** Instances whose On Open, On Load and first On Current have run. */
const ready = new WeakSet<FormInstance>();
const waiting: { name: string; resolve(f: FormInstance): void; reject(e: Error): void }[] = [];

/** Adds `x`, replacing one of the same name; the release removes `x` only (not a later instance of the same name). */
function register<T extends { name: string }>(list: T[], x: T): () => void {
  const i = list.findIndex((o) => sameName(o.name, x.name));
  if (i >= 0) list.splice(i, 1);
  list.push(x);
  return () => { const j = list.indexOf(x); if (j >= 0) list.splice(j, 1); };
}

/** At mount, before On Open; a second registration under the same name replaces the first. */
export const registerForm = (f: FormInstance): (() => void) => register(forms, f);
/** While the report is being laid out (its events and its own expressions). */
export const registerReport = (r: ReportInstance): (() => void) => register(reports, r);
export const formNamed = (name: string): FormInstance | undefined => forms.find((f) => sameName(f.name, name));
export const formOfTab = (tabId: string): FormInstance | undefined => forms.find((f) => f.tabId === tabId);
const reportNamed = (name: string): ReportInstance | undefined => reports.find((r) => sameName(r.name, name));

/** Registered, its On Open, On Load or first On Current still running. */
export const formOpening = (name: string): boolean => { const f = formNamed(name); return !!f && !ready.has(f); };

/** Resolves once the form is ready (at once when it is already); rejects bc:actionCancelled on formCancelled(name). */
export function whenFormOpened(name: string): Promise<FormInstance> {
  const f = formNamed(name);
  if (f && ready.has(f)) return Promise.resolve(f);
  return new Promise((resolve, reject) => { waiting.push({ name, resolve, reject }); });
}

/** No name: every waiter. */
function settle(name: string | undefined, done: (w: (typeof waiting)[number]) => void): void {
  for (let i = waiting.length - 1; i >= 0; i--) if (name === undefined || sameName(waiting[i]!.name, name)) done(waiting.splice(i, 1)[0]!);
}

/** On Open, On Load and the first On Current have run. */
export function formReady(name: string): void {
  const f = formNamed(name);
  if (!f) return;
  ready.add(f);
  settle(name, (w) => w.resolve(f));
}

/** On Open cancelled, or the tab closed before the form was ready; no name: the base closed or switched (no waiter left behind). */
export function formCancelled(name?: string): void { settle(name, (w) => w.reject(new Error('bc:actionCancelled'))); }

/** [Forms]![F]![C] / [Reports]![R]![C]; F or R not open: ExprRuntimeError('notOpen', its name). */
export async function resolveObjectMember(path: string[]): Promise<Value> {
  const [root, name = '', control = ''] = path;
  const o = root === 'Forms' ? formNamed(name) : root === 'Reports' ? reportNamed(name) : undefined;
  if (!o) throw new ExprRuntimeError('notOpen', name);
  return o.value(control);
}

/** [Forms]! / [Reports]! / [TempVars]! in a form's own expressions (calculated controls, default values, rules). */
export function memberValue(path: string[]): Value | Promise<Value> {
  if (path[0] === 'TempVars') return tempVars.get(foldName(path[1] ?? '')) ?? null;
  return path[0] === 'Forms' || path[0] === 'Reports' ? resolveObjectMember(path) : fail('unknownField');
}

/** A value as a parameter is entered: a date in its stored text, Empty as Null, a Yes/No -1 / 0 unless the parameter is Yes/No (Access). */
function cellOf(v: Value, type?: string | null): CellInput {
  if (v === null || v.t === 'empty') return null;
  if (v.t === 'bool' && type !== 'yesNo') return v.v ? -1 : 0;
  return v.t === 'date' ? fromSerial(v.v) : v.v;
}

/**
 * The value of a query parameter that is a member reference (its name the canonical text, `[Forms]![F]![C]`): a control
 * of an open form or report; a temporary variable (an absent one is Null, never asked, as Access). Not found (another
 * parameter, an object not open, an unknown control): the parameter is asked, as Access does. `type`: the parameter's
 * declared type (absent: Text).
 */
export function memberParamValue(name: string, tempVars: ReadonlyMap<string, Value>, type?: string | null): { found: true; value: CellInput } | { found: false } {
  let e;
  try { e = parseCanonical(name); } catch { return { found: false }; }
  if (e.k !== 'member') return { found: false };
  const [root, obj = '', control = ''] = e.path;
  if (root === 'TempVars') return { found: true, value: cellOf(tempVars.get(foldName(obj)) ?? null, type) };
  const o = root === 'Forms' ? formNamed(obj) : root === 'Reports' ? reportNamed(obj) : undefined;
  if (!o) return { found: false };
  try { return { found: true, value: cellOf(o.value(control), type) }; } catch (err) {
    if (err instanceof ExprRuntimeError) return { found: false };
    throw err;
  }
}
