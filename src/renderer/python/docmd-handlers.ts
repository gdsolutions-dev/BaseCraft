// Python's `docmd` (D2 R7): the same rule set as macros. `docmd.<action>()` goes through the macro shell's `perform`.
import { ExprRuntimeError, type Value } from '../../shared/expr/ast'
import { evaluate, truthy, type EvalEnv } from '../../shared/expr/evaluate'
import { infoOf, toText } from '../../shared/expr/library'
import { bindMembers } from '../../shared/expr/members'
import { parseCanonical, serialize } from '../../shared/expr/parser'
import { withUserFunctions } from '../../shared/expr/user-functions'
import { foldName } from '../../shared/field-types'
import { ACTIONS, type ActionDef } from '../../shared/macro/catalog'
import { norm, REFUSED } from '../../shared/python/docmd-names'
import { valueToWire, wireToValue } from '../../shared/python/values'
import { memberValue } from '../form/form-instances'
import type { MacroHost, ResolvedArgs } from '../macro/engine'
import { runMacro } from '../macro/engine'
import { failureMessage } from '../macro/MacroFailedDialog'
import { currentShell, shellHost } from '../macro/macro-shell'
import { topEvent } from './event-stack'
import { handled, handlerError } from './handler-error'
import { pythonHost, type BridgeHandler } from './python-host'

export { runPythonFunction } from './run-function'

const bad = (what: string): never => { throw new Error(`bc:badArgument|${what}`) }

/** The catalog action a Python name stands for (`open_form`, `run_sql`; alias `close`). */
export function actionFor(pyName: string): ActionDef {
  const k = norm(pyName)
  if (REFUSED[k]) throw new Error(`bc:refusedDocmd|${pyName}|${REFUSED[k]}`)
  const def = ACTIONS.find((a) => a.name.toLowerCase() === (k === 'close' ? 'closewindow' : k))
  if (!def) throw new Error(`bc:noSuchDocmd|${pyName}`)
  return def
}

/** Positional arguments follow the catalog's order; keywords match argument names without `_`, case-insensitively. */
export async function argsFor(def: ActionDef, positional: unknown[], kwargs: Record<string, unknown>): Promise<{ args: ResolvedArgs; raw: Record<string, string> }> {
  if (positional.length > def.args.length) bad(`${positional.length} > ${def.args.length}`)
  const kw = Object.entries(kwargs)
  for (const [k] of kw) if (!def.args.some((a) => norm(a.name) === norm(k))) bad(k)
  const args: ResolvedArgs = {}, raw: Record<string, string> = {}
  for (const [i, a] of def.args.entries()) {
    const named = kw.find(([k]) => norm(k) === norm(a.name))
    if (named && i < positional.length) bad(named[0])
    const v = named ? named[1] : positional[i]
    if (v === null || v === undefined) {
      if (a.required) throw new Error(`bc:missingArgument|${a.name}`)
      if (a.default !== undefined) args[a.name] = a.default
      continue
    }
    const yesNo = a.type === 'enum' && a.options?.length === 2 && a.options[0] === 'yes'
    const text = typeof v === 'boolean' ? (yesNo ? (v ? 'yes' : 'no') : bad(a.name)) : String(v)
    if (a.type === 'enum' && !a.options?.includes(text)) bad(`${a.name}=${text}`)
    raw[a.name] = text
    if (a.type === 'expression') args[a.name] = wireToValue(v)
    else if (a.type === 'where') {
      let e
      try { e = parseCanonical(text) } catch { bad(a.name) }
      args[a.name] = serialize(await bindMembers(e!, async (p) => memberValue(p)))   // [Forms]/[Reports]/[TempVars] as the engine binds them
    } else args[a.name] = text
  }
  return { args, raw }
}

// One MacroHost per outermost Python call: SetWarnings lasts for it (as for a macro run). Dropped when Python stops running.
let host: MacroHost | null = null
let unsub: (() => void) | null = null
function callHost(): MacroHost {
  const d = currentShell()
  if (!d) throw new Error('bc:noBase')
  const p = pythonHost()
  if (host) return host
  const h = shellHost(d, { singleStep: false })
  if (p.state() === 'running') {
    host = h
    unsub = p.subscribe(() => { if (p.state() !== 'running') { host = null; unsub?.(); unsub = null } })
  }
  return h
}

/** `eval_expr(text)`: the environment of a macro's expression (R3): the running event's fields, TempVars, Forms/Reports, user functions. */
function exprEnv(h: MacroHost): EvalEnv {
  const ev = topEvent()
  const unknown = (): never => { throw new ExprRuntimeError('unknownField') }
  const member = (path: string[]): Value | Promise<Value> => {
    const [root, key = ''] = path
    if (root === 'TempVars') return h.tempVars.get(foldName(key)) ?? null
    if ((root === 'Forms' || root === 'Reports') && h.objectMember) return h.objectMember(path)
    return unknown()
  }
  return { field: ev ? (name, table) => (table !== undefined ? unknown() : ev.field(name)) : unknown, now: () => h.now(), locale: h.locale, lang: h.lang, member, callUser: h.callUser?.bind(h) }
}

export function docmdHandlers(): Record<string, BridgeHandler> {
  return {
    'docmd.run': handled(async ([name, pos, kw]) => {
      const def = actionFor(String(name))
      const h = callHost()
      if (def.unsafe && !h.contentEnabled()) throw new Error('bc:contentDisabled')
      const { args, raw } = await argsFor(def, Array.isArray(pos) ? pos : [], (kw ?? {}) as Record<string, unknown>)
      await h.perform({ macro: '(Python)', action: def.name, args, raw, event: topEvent() ?? undefined })
      return null
    }),
    // mode 'bool': the macro engine's If / repeat condition (truthy() === true); 'text': the engine's text conversion of an argument (Null -> "", locale number format)
    'expr.eval': handled(async ([text, mode]) => {
      const h = callHost(), v = await evaluate(parseCanonical(String(text), { functions: withUserFunctions() }), exprEnv(h))
      if (mode === 'bool') return truthy(v, infoOf(h.locale)) === true
      if (mode === 'text') return v === null ? '' : toText(v, infoOf(h.locale))
      return valueToWire(v)
    }),
    'docmd.runMacro': async ([name]) => {
      let outcome
      try { outcome = await runMacro(String(name), callHost(), { event: topEvent() ?? undefined }) } catch (e) { throw handlerError(e) }
      if (!outcome.ok) throw Object.assign(new Error(failureMessage(outcome.failure)), { code: 'macroFailed' })
      return null
    },
  }
}
