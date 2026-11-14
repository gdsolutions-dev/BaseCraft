// Convert Macros to Python for a form or report (B6): each embedded event macro becomes a function of the object's code-behind module
// (`Nom_Click`) and its event becomes `[Event Procedure]`. Pure: the caller saves the module and applies `edit`.
import { EVENTS, readEvent, sectionName } from '../../shared/design/events'
import { flattenControls, type DesignDoc } from '../../shared/design/model'
import { convertMacro, type ConvertEnv, type ConvertOptions, type Note } from '../../shared/macro/to-python'
import { EVENT_PROCEDURE, procedureName } from '../../shared/python/code-behind'
import { foldName } from '../../shared/field-types'
import { setProps, type PropTarget } from './designer-model'

export interface EventConversion { source: string; edit(doc: DesignDoc): DesignDoc; converted: number; skipped: number; notes: Note[] }

const hasDef = (source: string, fn: string): boolean => new RegExp(String.raw`^\s*(?:async\s+)?def\s+${fn}\s*\(`, 'im').test(source)

/** null when the object has no embedded event macro. A procedure already in `existing` is never overwritten: its event is left as it is (counted in `skipped`). */
export function convertEventMacros(doc: DesignDoc, kind: 'form' | 'report', existing: string, o: ConvertOptions, env: ConvertEnv): EventConversion | null {
  const owners: { target: PropTarget; props: Record<string, unknown>; owner?: string }[] = [
    { target: { kind: 'doc' }, props: doc.props },
    ...doc.sections.map((s, index) => ({ target: { kind: 'section', index } as PropTarget, props: s.props, owner: sectionName(s.kind, s.groupLevel) })),
    ...doc.sections.flatMap((s) => flattenControls(s.controls)).map((c) => ({ target: { kind: 'control', name: c.name } as PropTarget, props: c.props, owner: c.name })),
  ]
  const done: { target: PropTarget; event: string }[] = []
  const imports = new Set<string>(), fns: string[] = [], notes: Note[] = [], taken = new Set<string>()
  let skipped = 0, any = false
  for (const { target, props, owner } of owners) {
    for (const e of EVENTS) {
      const b = readEvent(props[e])
      if (b.kind !== 'embedded') continue
      any = true
      const proc = procedureName(kind, e, owner)
      const out = hasDef(existing, proc) || taken.has(foldName(proc)) ? null : convertMacro(proc, b.def, o, env)
      if (!out || out.functions[0] !== proc) { skipped++; continue }
      taken.add(foldName(proc))
      const at = out.source.indexOf('# ---')
      for (const l of out.source.slice(0, at).split('\n')) if (/^(import|from) /.test(l) && !existing.includes(l)) imports.add(l)
      fns.push(out.source.slice(at).trimEnd())
      notes.push(...out.notes)
      done.push({ target, event: e })
    }
  }
  if (!any) return null
  const source = `${[...imports].sort().map((l) => `${l}\n`).join('')}${existing.trimEnd()}\n\n\n${fns.join('\n\n\n')}\n`
  return { source: fns.length ? source : existing, edit: (d) => done.reduce((x, h) => setProps(x, [h.target], h.event, EVENT_PROCEDURE), d), converted: fns.length, skipped, notes }
}
