// Data macros (T2): the macros of a table's events (Before Change, Before Delete, After Insert / Update / Delete) and its named
// macros, stored in the table's metadata (`bc_tables.props.dataMacros`). Same MacroDef format as a UI macro, a restricted action
// set, run by the main process inside the write's transaction. Pure module (no I/O): the host gives the row and takes the changes.
// A data macro runs with the base author's authority on every write, so it can reach nothing outside the base: no UI action,
// file, network or Python (a Python function in an expression is refused), and an unknown action fails the run.
import { ExprRuntimeError, ExprSyntaxError, type Value } from '../expr/ast';
import { evaluate, truthy, type EvalEnv } from '../expr/evaluate';
import { fail, infoOf, toText } from '../expr/library';
import { parseCanonical } from '../expr/parser';
import { foldName, isValidObjectName, sameName } from '../field-types';
import { actionDef } from './catalog';
import { validateMacro, type MacroDef, type MacroItem } from './model';

export const DATA_EVENTS = ['beforeChange', 'beforeDelete', 'afterInsert', 'afterUpdate', 'afterDelete'] as const;
export type DataEvent = (typeof DATA_EVENTS)[number];
export interface DataMacros { events?: Partial<Record<DataEvent, MacroDef>>; named?: Record<string, MacroDef> }

/** Access limits the nesting of data macros (an After macro that edits the table, RunDataMacro) to 10. */
export const MAX_DATA_MACRO_DEPTH = 10;
export const MAX_DATA_MACRO_STEPS = 10_000;
const ACTIONS: ReadonlySet<string> = new Set(['SetField', 'CreateRecord', 'SetLocalVar', 'RaiseError', 'RunDataMacro', 'StopMacro']);
/** The events an action is limited to (the others: any). */
const ONLY: Record<string, readonly DataEvent[]> = { SetField: ['beforeChange'], CreateRecord: ['afterInsert', 'afterUpdate', 'afterDelete'] };
const allowedIn = (action: string, event?: DataEvent): boolean => ACTIONS.has(action) && (event === undefined || (ONLY[action]?.includes(event) ?? true));
/** The actions the designer offers a data macro (the blocks If / Group / comment are always there). */
export const isDataAction = (name: string, event?: DataEvent): boolean => allowedIn(name, event);
export const isBeforeEvent = (e: DataEvent): boolean => e === 'beforeChange' || e === 'beforeDelete';

/** [Old].[Field] is a qualified name; no `functions`: a Python function is an unknown function. */
const Q = { qualified: true } as const;
const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const noShape = (def: unknown): def is MacroDef => validateMacro(def).every((i) => i.code !== 'shape');

/** The data macros as stored (an unreadable entry, or one a newer version wrote in another shape, is dropped: it cannot run). */
export function parseDataMacros(v: unknown): DataMacros {
  const out: DataMacros = {};
  if (!isObject(v)) return out;
  if (isObject(v.events)) {
    for (const e of DATA_EVENTS) if (noShape(v.events[e])) (out.events ??= {})[e] = v.events[e] as MacroDef;
  }
  if (isObject(v.named)) {
    for (const [name, def] of Object.entries(v.named)) if (noShape(def) && isValidObjectName(name)) (out.named ??= {})[name] = def;
  }
  return out;
}

/** The first problem of a macro meant for `event` (undefined: a named macro, run from any), or null: shape and expressions
 *  (validateMacro, then no Python call), only the data actions, SetField only in Before Change and named macros. */
export function dataMacroIssue(def: unknown, event?: DataEvent): string | null {
  const first = validateMacro(def, { data: true })[0];
  if (first) return `${first.path}: ${first.code}`;
  const walk = (items: MacroItem[]): string | null => {
    for (const it of items) {
      if (it.k === 'action') {
        if (!allowedIn(it.action, event)) return `unknownAction: ${it.action}`;
        const known = actionDef(it.action)!;
        for (const a of known.args) {
          const raw = it.args[a.name] ?? '';
          const text = a.type === 'expression' ? raw : (a.type === 'text' || a.type === 'number') && raw.startsWith('=') ? raw.slice(1) : '';
          if (text.trim() !== '') { try { parseCanonical(text, Q); } catch { return `badExpression: ${it.action}.${a.name}`; } }
        }
        if (it.action === 'CreateRecord' && !parseValues(it.args.Values ?? '')) return 'badExpression: CreateRecord.Values';
      } else if (it.k === 'if') {
        for (const b of it.branches) { try { parseCanonical(b.cond, Q); } catch { return `badExpression: ${b.cond}`; } }
        const r = [...it.branches.map((b) => b.items), it.else ?? []].map(walk).find((x) => x !== null);
        if (r) return r;
      } else if (it.k === 'group') { const r = walk(it.items); if (r) return r; }
    }
    return null;
  };
  return walk((def as MacroDef).items.filter((i) => i.k !== 'submacro'));   // ponytail: submacros are never run (no OnError), only the body
}

/** The first problem of the whole set (saved over IPC), or null. */
export function dataMacrosIssue(dm: DataMacros): string | null {
  for (const e of DATA_EVENTS) { const d = dm.events?.[e]; const r = d && dataMacroIssue(d, e); if (r) return `${e}: ${r}`; }
  for (const [n, d] of Object.entries(dm.named ?? {})) { const r = dataMacroIssue(d); if (r) return `${n}: ${r}`; }
  return null;
}

/** CreateRecord's Values: one `Field = expression` per line (canonical expression); null when a line does not read. */
export function parseValues(text: string): { field: string; expr: string }[] | null {
  const out: { field: string; expr: string }[] = [];
  for (const line of text.split(/\r?\n/)) {
    if (line.trim() === '') continue;
    const i = line.indexOf('=');
    const field = i < 0 ? '' : line.slice(0, i).trim().replace(/^\[(.*)\]$/, '$1'), expr = line.slice(i + 1);
    try { parseCanonical(expr, Q); } catch { return null; }
    if (!field) return null;
    out.push({ field, expr });
  }
  return out;
}

/** What a run needs from the write path. `field(name, true)` is [Old].[name]; both throw the library's unknownField for a missing field. */
export interface DataMacroHost {
  field(name: string, old: boolean): Value;
  setField(name: string, v: Value): void;   // throws for an unknown field
  /** CreateRecord: inserts a row into `table` (same transaction, nested macros one level deeper); a refusal rejects with its text. */
  createRecord(table: string, values: Record<string, Value>, depth: number): Promise<void>;
  named(name: string): MacroDef | undefined;
  now(): Date; locale: string;
}
/** `message` is shown to the user (RaiseError's description, or a failure's text). */
export type DataMacroResult = { ok: true } | { ok: false; message: string; raised: boolean /* RaiseError, rather than a failure */ };

class Stop {}
class Raised { constructor(public message: string, public raised: boolean) {} }

/** Runs `def` (its body, up to the first submacro). `label` names the macro in failure messages; `event` the one it runs for (the
 *  actions limited to other events fail, a named macro included); `depth` the nesting so far. Never throws for a macro's own
 *  failure: it is the result. */
export async function runDataMacro(def: MacroDef, label: string, host: DataMacroHost, opts: { event: DataEvent; depth?: number }): Promise<DataMacroResult> {
  let steps = 0;
  const info = infoOf(host.locale);
  const call = async (d: MacroDef, name: string, depth: number): Promise<void> => {
    if (depth > MAX_DATA_MACRO_DEPTH) throw new Raised(`${name}: data macros are nested too deeply`, false);
    const issue = dataMacroIssue(d, opts.event);   // unknown actions fail the run
    if (issue) throw new Raised(`${name}: ${issue}`, false);
    const locals = new Map<string, Value>();
    const env: EvalEnv = {
      field: (n, table) => (table === undefined ? host.field(n, false) : sameName(table, 'Old') ? host.field(n, true) : fail('unknownField')),
      now: () => host.now(), locale: host.locale,
      member: ([root, key = '']) => (root === 'LocalVars' ? locals.get(foldName(key)) ?? null : fail('unknownField')),
    };
    const ev = async (text: string): Promise<Value> => evaluate(parseCanonical(text, Q), env);
    const text = async (raw: string | undefined): Promise<string> => (raw === undefined ? '' : raw.startsWith('=') ? ((v) => (v === null ? '' : toText(v, info)))(await ev(raw.slice(1))) : raw);
    const nameOf = (raw: string | undefined): string => (raw ?? '').trim().replace(/^\[(.*)\]$/, '$1');

    const run = async (items: MacroItem[]): Promise<void> => {
      for (const it of items) {
        if (it.k === 'submacro') throw new Stop();
        if (++steps > MAX_DATA_MACRO_STEPS) throw new Raised(`${name}: too many steps`, false);
        if (it.k === 'group') await run(it.items);
        else if (it.k === 'if') {
          let chosen: MacroItem[] = it.else ?? [];
          for (const b of it.branches) if (truthy(await ev(b.cond), info) === true) { chosen = b.items; break; }
          await run(chosen);
        } else if (it.k === 'action') {
          const a = it.args;
          switch (it.action) {
            case 'StopMacro': throw new Stop();
            case 'SetLocalVar': locals.set(foldName(nameOf(a.Name)), await ev(a.Expression ?? '')); break;
            case 'SetField': host.setField(nameOf(a.Name), await ev(a.Value ?? '')); break;
            case 'CreateRecord': {
              const values: Record<string, Value> = {};
              for (const { field, expr } of parseValues(a.Values ?? '') ?? []) values[field] = await ev(expr);
              try { await host.createRecord(nameOf(a.TableName), values, depth); } catch (e) {
                if (e instanceof ExprRuntimeError || e instanceof Raised) throw e;
                throw new Raised(`${name}: CreateRecord: ${e instanceof Error ? e.message : String(e)}`, false);
              }
              break;
            }
            case 'RaiseError': {
              const d = (await text(a.ErrorDescription)).trim();
              throw new Raised(d || (a.ErrorNumber?.trim() ? `Error ${await text(a.ErrorNumber)}` : 'Data macro error'), true);
            }
            case 'RunDataMacro': {
              const callee = nameOf(await text(a.MacroName)), target = host.named(callee);
              if (!target) throw new Raised(`${name}: RunDataMacro: unknown macro`, false);
              try { await call(target, callee, depth + 1); } catch (e) { if (!(e instanceof Stop)) throw e; }
              break;
            }
            default: throw new Raised(`${name}: unknownAction: ${it.action}`, false);
          }
        }
      }
    };
    await run(d.items);
  };
  try {
    await call(def, label, opts.depth ?? 1);
    return { ok: true };
  } catch (e) {
    if (e instanceof Stop) return { ok: true };
    if (e instanceof Raised) return { ok: false, message: e.message, raised: e.raised };
    if (e instanceof ExprRuntimeError) return { ok: false, message: `${label}: ${e.code}${e.detail ? ` (${e.detail})` : ''}`, raised: false };
    if (e instanceof ExprSyntaxError) return { ok: false, message: `${label}: ${e.message}`, raised: false };
    throw e;
  }
}
