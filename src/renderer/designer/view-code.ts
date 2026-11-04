// Visualiser le code (D3 R8): the module of the first Python event function, opened at its `def` line; else a new module.
import type { ControlDef, DesignDoc } from '../../shared/design/model'
import { flattenControls } from '../../shared/design/model'
import { EVENTS, readEvent } from '../../shared/design/events'
import type { Selection } from './designer-model'
import { resolveFunction } from '../python/function-index'

const pythonIn = (props: Record<string, unknown>): string | null => {
  for (const e of EVENTS) { const b = readEvent(props[e]); if (b.kind === 'python') return b.name }
  return null
}

/** The function of the selected control's first Python event, else the form's (then its sections', then its controls'); null when none. */
export function firstPythonCall(doc: DesignDoc, selection: Selection): string | null {
  const all = doc.sections.flatMap((s) => flattenControls(s.controls))
  if (selection.kind === 'controls') {
    const picked = selection.names.map((n) => all.find((c: ControlDef) => c.name.toLowerCase() === n.toLowerCase())).find(Boolean)
    const r = picked && pythonIn(picked.props)
    if (r) return r
  }
  return pythonIn(doc.props) ?? doc.sections.map((s) => pythonIn(s.props)).find(Boolean) ?? all.map((c) => pythonIn(c.props)).find(Boolean) ?? null
}

/** Opens the function's module at its `def` line, else (no Python call) a new module. A missing function throws `bc:pythonFunctionNotFound|name`. */
export async function viewCode(fn: string | null, open: (module: string, line: number) => void, newModule: () => void): Promise<void> {
  if (fn === null) return newModule()
  const { api } = await import('../bridge')
  const ref = await resolveFunction(fn)
  const source = ((await api.objects.get('module', ref.module)).definition as { source?: string } | null)?.source ?? ''
  const at = source.split(/\r?\n/).findIndex((l) => new RegExp(String.raw`^\s*(?:async\s+)?def\s+${ref.fn}\s*\(`, 'i').test(l))
  open(ref.module, at < 0 ? 1 : at + 1)
}
