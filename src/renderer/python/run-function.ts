// Calls a Python function by name (D2): RunCode and, in Task 7, `=fn()` events. Its own module so macro-shell can use it without a cycle.
import type { Value } from '../../shared/expr/ast'
import { valueToWire } from '../../shared/python/values'
import type { EventContext } from '../macro/engine'
import { sectionName } from '../../shared/design/events'
import { pushEvent } from './event-stack'
import { codeBehindModule, procedureName } from '../../shared/python/code-behind'
import { findProcedure, resolveFunction } from './function-index'
import { pythonHost } from './python-host'

/** Resolves `name` among the saved exports and runs it; `event` is the top of the event stack for the call. A PythonError propagates. */
export async function runPythonFunction(name: string, args: Value[], event?: EventContext): Promise<void> {
  const { module, fn } = await resolveFunction(name)
  const pop = event ? pushEvent(event) : null
  try { await pythonHost().call(module, fn, args.map(valueToWire)) } finally { pop?.() }
}

/** B6: runs the event procedure of the object's code-behind module; false when the module has none (Access does nothing then). A PythonError propagates. */
export async function runProcedure(ctx: EventContext): Promise<boolean> {
  const { kind, name } = ctx.object
  const ref = await findProcedure(codeBehindModule(kind, name), procedureName(kind, ctx.event, ctx.control ?? (ctx.report ? sectionName(ctx.report.section, ctx.report.groupLevel) : undefined)))
  if (!ref) return false
  const pop = pushEvent(ctx)
  try { await pythonHost().call(ref.module, ref.fn, []) } finally { pop() }
  return true
}
