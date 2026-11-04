// R5: the expression registry of Python function names, kept up to date from the saved exports.
import { setUserFunctions, userFunctionNames } from '../../shared/expr/user-functions'
import { clearInFlight } from './expr-call'
import { listFunctions } from './function-index'

const subs = new Set<() => void>()
/** Tells the open forms and reports to calculate again (names changed, or a module was saved: same names, new bodies). */
export const notifyUserFunctions = (): void => { clearInFlight(); subs.forEach((f) => f()) }
export const onUserFunctionsChanged = (fn: () => void): (() => void) => { subs.add(fn); return () => { subs.delete(fn) } }

const key = (names: Iterable<string>): string => [...names].map((n) => n.toLowerCase()).sort().join('\n')

/** Sets the registry from the modules' exports; subscribers hear of it only when the set of names changed. */
let gen = 0
export async function refreshUserFunctions(): Promise<boolean> {
  const mine = ++gen
  const fns = (await listFunctions()).map((f) => f.fn)
  if (mine !== gen) return false // a newer refresh (or a clear) was started: its names win
  const before = key(userFunctionNames())
  setUserFunctions(fns)
  const changed = key(userFunctionNames()) !== before
  if (changed) notifyUserFunctions()
  return changed
}

/** A base closed: no names. */
export function clearUserFunctions(): void {
  gen++
  const had = userFunctionNames().size > 0
  setUserFunctions([])
  if (had) subs.forEach((f) => f())
}
