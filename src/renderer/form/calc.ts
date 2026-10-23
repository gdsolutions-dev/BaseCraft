// Contrôles calculés (Control Source `=…`), valeurs par défaut et règles de validation des contrôles, évalués par
// l'évaluateur partagé (A2). Module pur : la vue construit les valeurs (contrôles, champs) et rafraîchit sous un jeton Latest.
import { coerce, type CellInput, type SqlValue } from '../../shared/coerce';
import { flattenControls, type ControlDef } from '../../shared/design/model';
import { ExprRuntimeError, ExprSyntaxError, type Expr, type Value } from '../../shared/expr/ast';
import { sameName } from '../../shared/field-types';
import { defaultInput, evaluate, fromStored, toStored, truthy } from '../../shared/expr/evaluate';
import { formatValue } from '../../shared/expr/format';
import { fail, infoOf, num, str, toText } from '../../shared/expr/library';
import { parseNumber } from '../../shared/locale-format';
import { fieldRefs, parseCanonical } from '../../shared/expr/parser';
import type { SourceInfo } from '../../shared/record-source';
import { boundField, dp, isUnbound } from './control-values';
import type { RecordError } from './record-controller';

export type CalcResult = { ok: true; value: Value; text: string } | { ok: false; code: 'error' | 'name' };
/** The value of a field whose typed text does not convert, or of a calculated control in error: #Erreur wherever it is used. */
export const FAILED: unique symbol = Symbol('failed');
export type CalcValue = Value | typeof FAILED;
export interface CalcEnv { fields: Record<string, CalcValue>; controls: Record<string, CalcValue>; locale: string; lang: 'fr' | 'en'; now(): Date }
type BaseEnv = Omit<CalcEnv, 'fields' | 'controls'>;

// ponytail: unbounded, one entry per distinct expression text of the open forms; an LRU if definitions ever churn.
const parsed = new Map<string, Expr | { failed: unknown }>();
/** parseCanonical, once per text and mode: recalculation runs on every record change. A parse failure is rethrown as is. */
export function parseExpr(text: string, criteria: boolean): Expr {
  const key = `${criteria ? 'c' : 'e'}:${text}`;
  let r = parsed.get(key);
  if (!r) {
    try { r = parseCanonical(text, { criteria }); } catch (e) { r = { failed: e }; }
    parsed.set(key, r);
  }
  if ('failed' in r) throw r.failed;
  return r;
}

const noField = (): Value => fail('unknownField');
const prop = (c: ControlDef, name: string): string => (typeof c.props[name] === 'string' ? c.props[name] as string : '');
const calcExpr = (c: ControlDef): Expr => parseExpr(prop(c, 'ControlSource').replace(/^=/, ''), false);
const CIRCULAR: CalcResult = { ok: false, code: 'error' }; // a circular reference shows #Erreur, as in Access

/** `=…` evaluated with a control's current value first, then the source field (case ignored), as `Me!X` in Access.
 *  Unknown name or unreadable definition: #Nom? ('name'); any other runtime error, aggregates included: #Erreur ('error'). */
export async function evalControlSource(c: ControlDef, env: CalcEnv): Promise<CalcResult> {
  const field = (name: string): Value => {
    const find = (rec: Record<string, CalcValue>): CalcValue | undefined => {
      const k = Object.keys(rec).find((n) => sameName(n, name));
      return k === undefined ? undefined : rec[k];
    };
    const ctl = find(env.controls); // a control first, even a Null one; a field only when no control has the name
    const v = ctl !== undefined ? ctl : find(env.fields);
    return v === undefined ? fail('unknownField') : v === FAILED ? fail('typeMismatch') : v;
  };
  let value: Value;
  try {
    const e = calcExpr(c);
    if (fieldRefs(e).some((n) => sameName(n, c.name))) return CIRCULAR; // a control is never in its own environment
    value = await evaluate(e, { field, now: env.now, locale: env.locale, lang: env.lang });
  } catch (e) {
    return { ok: false, code: e instanceof ExprSyntaxError || (e instanceof ExprRuntimeError && e.code === 'unknownField') ? 'name' : 'error' };
  }
  const format = prop(c, 'Format') || (value?.t === 'bool' ? 'trueFalse' : '');
  const text = format ? formatValue(value, format, { locale: env.locale, lang: env.lang, decimalPlaces: dp(c.props.DecimalPlaces) })
    : value === null ? '' : toText(value, infoOf(env.locale));
  return { ok: true, value, text };
}

/** The environment of the current record's calculations: each source field from the pending typed text (coerce, then
 *  fromStored; FAILED when it does not convert) or the stored value; each bound control its field's value; each unbound
 *  control its value (`extra`, by control name); each calculated control its result, in dependency order (a cycle is
 *  #Erreur), also returned as `results` (by control name) for display. */
export async function buildCalcEnv(controls: ControlDef[], info: SourceInfo, stored: Record<string, SqlValue>,
  pending: Record<string, CellInput>, base: BaseEnv, extra: Record<string, CalcValue> = {}): Promise<CalcEnv & { results: Record<string, CalcResult> }> {
  const region = infoOf(base.locale);
  const fields: Record<string, CalcValue> = {};
  for (const f of info.fields) {
    const k = Object.keys(pending).find((n) => sameName(n, f.name));
    if (k === undefined) { fields[f.name] = fromStored(f, stored[f.name] ?? null); continue; }
    const r = coerce(f, pending[k], region);
    fields[f.name] = r.ok ? fromStored(f, r.value) : r.error === 'required' ? null : FAILED; // blank on a required field: Null
  }
  const controlValues: Record<string, CalcValue> = { ...extra };
  const all = flattenControls(controls);
  for (const c of all) {
    const f = boundField(c, info);
    if (f) controlValues[c.name] = fields[f.name];
  }
  const env = { ...base, fields, controls: controlValues };
  const results: Record<string, CalcResult> = {};
  const calcs = all.filter((c) => prop(c, 'ControlSource').startsWith('='));
  const state = new Map<ControlDef, 'busy' | 'done'>();
  // Dependencies first (the calculated controls its expression names); one still being calculated means a cycle.
  const run = async (c: ControlDef): Promise<void> => {
    if (state.has(c)) return;
    state.set(c, 'busy');
    let refs: string[] = [];
    try { refs = fieldRefs(calcExpr(c)); } catch { /* unreadable: evalControlSource gives #Nom? */ }
    let cycle = false;
    for (const n of refs) {
      const d = calcs.find((x) => sameName(x.name, n));
      if (!d || d === c) continue; // itself: evalControlSource's circular reference
      if (state.get(d) === 'busy') cycle = true;
      else await run(d);
    }
    const r = cycle ? CIRCULAR : await evalControlSource(c, env);
    results[c.name] = r;
    controlValues[c.name] = r.ok ? r.value : FAILED;
    state.set(c, 'done');
  };
  for (const c of calcs) await run(c);
  return { ...env, results };
}

/** Values of a new record for its bound controls: the control's Default Value converted for the field (empty on an error),
 *  else the field's own default. Shown at once, sent only on insert (FormRecords' newRecordValues). */
export async function controlDefaults(controls: ControlDef[], info: SourceInfo, env: BaseEnv): Promise<Record<string, CellInput>> {
  const region = infoOf(env.locale);
  const out: Record<string, CellInput> = {};
  const seen = new Set<string>();
  for (const c of controls) {
    const f = boundField(c, info);
    if (!f || seen.has(f.name)) continue; // two controls on one field: the first one's default, as shown in the first control
    seen.add(f.name);
    const own = prop(c, 'DefaultValue');
    try {
      if (own) out[f.name] = toStored(f, await evaluate(parseExpr(own, false), { field: noField, now: env.now, locale: env.locale, lang: env.lang }), region);
      else if (f.props.defaultValue) out[f.name] = await defaultInput(f, region, env.now);
    } catch {
      if (own) out[f.name] = null; // the write layer reports a bad field default itself on insert
    }
  }
  return out;
}

/** Text typed in an unbound text box: blank is Null, a number in the region's form a number, anything else text (as Access guesses). */
export function typedValue(text: string, locale: string): Value {
  if (text.trim() === '') return null;
  const n = parseNumber(text, infoOf(locale));
  return n === null ? str(text) : num(n);
}

/** The Default Value of each unbound input (Null without one, or when it cannot be evaluated), kept across records as Access does. */
export async function unboundDefaults(controls: ControlDef[], env: BaseEnv): Promise<Record<string, Value>> {
  const out: Record<string, Value> = {};
  for (const c of flattenControls(controls).filter(isUnbound)) {
    const own = prop(c, 'DefaultValue');
    try { out[c.name] = own ? await evaluate(parseExpr(own, false), { field: noField, now: env.now, locale: env.locale, lang: env.lang }) : null; }
    catch { out[c.name] = null; }
  }
  return out;
}

/** The control's Validation Rule (criteria form) against the typed value: an error when the rule is False or cannot be evaluated. */
export async function checkControlRule(c: ControlDef, value: Value, info: SourceInfo, env: BaseEnv): Promise<RecordError | null> {
  const rule = prop(c, 'ValidationRule');
  if (!rule) return null;
  try {
    const r = await evaluate(parseExpr(rule, true), { field: noField, subject: value, now: env.now, locale: env.locale, lang: env.lang });
    if (truthy(r, infoOf(env.locale)) !== false) return null;
  } catch {
    // a rule that cannot be evaluated (unreadable, unknown name, type mismatch) blocks, as a False one does
  }
  const message = prop(c, 'ValidationText');
  return { field: boundField(c, info)?.name ?? c.name, code: 'controlValidation', ...(message ? { message } : {}) };
}

/** Generation token: a result computed under a token that is no longer current is dropped. */
export class Latest {
  private n = 0;
  next(): number { return ++this.n; }
  isCurrent(token: number): boolean { return token === this.n; }
}
