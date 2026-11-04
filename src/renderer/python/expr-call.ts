// R3: the function expressions call for a name that is not built in: a public function of a module.
import { ExprRuntimeError, type Value } from '../../shared/expr/ast'
import { valueToWire, wireToValue } from '../../shared/python/values'
import { contentBlocked } from '../shell/Banners'
import { resolveFunction } from './function-index'
import { pythonHost } from './python-host'

// The same call (name and arguments) asked again while it is running shares it: a form that calculates twice in a row
// (record shown, then its info) does not queue a second run of a function that never returns, so one Ctrl+Break ends both.
const inFlight = new Map<string, Promise<Value>>()
/** A module was saved: a call asked now must not share the old body's run. */
export const clearInFlight = (): void => inFlight.clear()
export function callUserFunction(name: string, args: Value[]): Promise<Value> {
  let key: string
  try { key = name.toLowerCase() + JSON.stringify(args.map(valueToWire)) } catch { return callOnce(name, args) }
  let p = inFlight.get(key)
  if (!p) { p = callOnce(name, args).finally(() => inFlight.delete(key)); inFlight.set(key, p) }
  return p
}

async function callOnce(name: string, args: Value[]): Promise<Value> {
  const host = pythonHost()
  if (!host.contentEnabled()) { contentBlocked(); throw new ExprRuntimeError('contentDisabled', name) }
  let ref
  try { ref = await resolveFunction(name) } catch { throw new ExprRuntimeError('unknownFunction', name) }
  let wire: unknown
  try {
    wire = await host.call(ref.module, ref.fn, args.map(valueToWire), { quiet: true })
  } catch (e) {
    const m = e instanceof Error ? e.message : String(e)
    if (m === 'bc:contentDisabled') { contentBlocked(); throw new ExprRuntimeError('contentDisabled', name) }
    throw new ExprRuntimeError('pythonError', m)   // a PythonError, a restart, a dead engine: #Error, never a raw throw
  }
  try { return wireToValue(wire) } catch { throw new ExprRuntimeError('typeMismatch', name) }
}
