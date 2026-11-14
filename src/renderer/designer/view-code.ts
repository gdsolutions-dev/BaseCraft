// Visualiser le code (D3 R8, B6): the module of the first Python event function, opened at its `def` line; the code-behind module for an
// `[Event Procedure]` (created with its function) or when nothing is bound.
import type { ControlDef, DesignDoc } from '../../shared/design/model'
import { flattenControls } from '../../shared/design/model'
import { EVENTS, readEvent, sectionName } from '../../shared/design/events'
import { procedureName } from '../../shared/python/code-behind'
import type { Selection } from './designer-model'
import { resolveFunction } from '../python/function-index'
import { ensureCodeBehind } from './code-module'

type Hit = { call: string } | { proc: string }
const hitIn = (props: Record<string, unknown>, kind: 'form' | 'report', owner?: string): Hit | null => {
  for (const e of EVENTS) {
    const b = readEvent(props[e])
    if (b.kind === 'python') return { call: b.name }
    if (b.kind === 'procedure') return { proc: procedureName(kind, e, owner) }
  }
  return null
}

/** The first event code of the selected control, else the form's (then its sections', then its controls'); null when none. */
export function firstCode(doc: DesignDoc, selection: Selection, kind: 'form' | 'report' = 'form'): Hit | null {
  const all = doc.sections.flatMap((s) => flattenControls(s.controls).map((c) => [c, s] as const))
  if (selection.kind === 'controls') {
    const picked = selection.names.map((n) => all.find(([c]) => c.name.toLowerCase() === n.toLowerCase())?.[0]).find(Boolean) as ControlDef | undefined
    const r = picked && hitIn(picked.props, kind, picked.name)
    if (r) return r
  }
  return hitIn(doc.props, kind) ?? doc.sections.map((s) => hitIn(s.props, kind, sectionName(s.kind, s.groupLevel))).find(Boolean) ?? all.map(([c]) => hitIn(c.props, kind, c.name)).find(Boolean) ?? null
}

/** The function of the first `=fn()` event (see firstCode); `[Event Procedure]` events are not calls. */
export const firstPythonCall = (doc: DesignDoc, selection: Selection): string | null => {
  const h = firstCode(doc, selection)
  return h && 'call' in h ? h.call : null
}

/** Opens the function's module at its `def` line; an event procedure, or nothing bound, opens the object's code-behind module. A missing function throws `bc:pythonFunctionNotFound|name`. */
export async function viewCode(hit: Hit | null, kind: 'form' | 'report', object: string, open: (module: string, line: number) => void): Promise<void> {
  if (!hit || 'proc' in hit) { const r = await ensureCodeBehind(kind, object, hit?.proc ?? null); return open(r.module, r.line) }
  const { api } = await import('../bridge')
  const ref = await resolveFunction(hit.call)
  const source = ((await api.objects.get('module', ref.module)).definition as { source?: string } | null)?.source ?? ''
  const at = source.split(/\r?\n/).findIndex((l) => new RegExp(String.raw`^\s*(?:async\s+)?def\s+${ref.fn}\s*\(`, 'i').test(l))
  open(ref.module, at < 0 ? 1 : at + 1)
}
