// Calls a Python function by name (D2): RunCode and, in Task 7, `=fn()` events. Its own module so macro-shell can use it without a cycle.
import type { Value } from '../../shared/expr/ast'
import { valueToWire } from '../../shared/python/values'
import type { EventContext } from '../macro/engine'
import { pushEvent } from './event-stack'
import { resolveFunction } from './function-index'
import { pythonHost } from './python-host'

/** Resolves `name` among the saved exports and runs it; `event` is the top of the event stack for the call. A PythonError propagates. */
export async function runPythonFunction(name: string, args: Value[], event?: EventContext): Promise<void> {
  const { module, fn } = await resolveFunction(name)
  const pop = event ? pushEvent(event) : null
  try { await pythonHost().call(module, fn, args.map(valueToWire)) } finally { pop?.() }
}
