// The events whose Python function is running (D2 R3): `me`, `screen` and `cancel_event` read the top. Nested calls are LIFO.
import type { EventContext } from '../macro/engine'

const stack: EventContext[] = []

/** Pushes `ctx`; the returned function pops that entry (and any above it). */
export function pushEvent(ctx: EventContext): () => void {
  stack.push(ctx)
  return () => { const i = stack.lastIndexOf(ctx); if (i >= 0) stack.length = i }
}

export const topEvent = (): EventContext | null => stack[stack.length - 1] ?? null
