// What Python's forms, reports, me, screen, tempvars and app proxies ask of the window (D2 R6). Every handler is wrapped by `handled`.
import { foldName } from '../../shared/field-types'
import { sectionName } from '../../shared/design/events'
import { valueToWire, wireToValue } from '../../shared/python/values'
import { formNamed, formOfTab, listOpenForms, listOpenReports, resolveObjectMember, type FormInstance, type RecordTarget, type SettableProperty } from '../form/form-instances'
import { MAX_TEMP_VARS } from '../macro/engine'
import { setOnBand } from '../macro/macro-shell'
import { tempVars } from '../macro/temp-vars'
import type { DocTab } from '../state/app-state'
import { topEvent } from './event-stack'
import { handled } from './handler-error'
import type { BridgeHandler } from './python-host'

const bad = (what: unknown): never => { throw new Error(`bc:badArgument|${String(what)}`) }
const form = (n: unknown): FormInstance => formNamed(String(n)) ?? ((): never => { throw new Error(`bc:notOpen||${String(n)}`) })()
const PROPS = new Set(['enabled', 'visible', 'locked', 'left', 'top', 'width', 'height', 'foreColor', 'backColor', 'caption', 'value'])
const prop = (p: unknown): SettableProperty => (PROPS.has(String(p)) ? (p as SettableProperty) : bad(p))

const METHODS: Record<string, (f: FormInstance, a: unknown[]) => unknown> = {
  requery: (f, [c]) => f.requery(c == null ? undefined : String(c)),
  goToRecord: (f, [r, o]) => f.goToRecord(String(r) as RecordTarget, o == null ? undefined : Number(o)),
  goToControl: (f, [c]) => f.goToControl(String(c)),
  saveRecord: (f) => f.saveRecord(),
  undoRecord: (f) => f.undoRecord(),
  deleteRecord: (f) => f.deleteRecord(true),
  refreshRecord: (f) => f.refreshRecord(),
  applyFilter: (f, [w]) => f.applyFilter(String(w)),
  showAllRecords: (f) => f.showAllRecords(),
}

export function objectHandlers(o: { projectName(): string | null; activeTab(): DocTab | null }): Record<string, BridgeHandler> {
  const h: Record<string, BridgeHandler> = {
    'forms.list': async () => listOpenForms().map((f) => f.name),
    'forms.name': async ([n]) => formNamed(String(n))?.name ?? null,
    'form.get': async ([f, c, p]) => {
      const x = form(f)
      return valueToWire(p === 'value' ? x.value(String(c)) : x.property(String(c), prop(p)))
    },
    'form.set': async ([f, c, p, v]) => {
      const x = form(f)
      if (p === 'value') await x.setValue(String(c), wireToValue(v))
      else await x.setProperty(String(c), prop(p), wireToValue(v))
      return null
    },
    'form.do': async ([f, m, a]) => {
      const x = form(f)
      const run = Object.hasOwn(METHODS, String(m)) ? METHODS[String(m)]! : bad(m)
      await run(x, Array.isArray(a) ? a : [])
      return null
    },
    'reports.name': async ([n]) => listOpenReports().find((r) => foldName(r.name) === foldName(String(n)))?.name ?? null,
    'report.get': async ([r, c]) => valueToWire(await resolveObjectMember(['Reports', String(r), String(c)])),
    'report.set': async ([, c, p, v]) => {
      const e = topEvent()?.report
      setOnBand(e, String(c) || (e ? sectionName(e.section, e.groupLevel) : ''), prop(p), wireToValue(v))
      return null
    },
    'event.current': async () => {
      const e = topEvent()
      return e ? { kind: e.object.kind, name: e.object.name, control: e.control ?? null, event: e.event } : null
    },
    'event.cancel': async () => { const e = topEvent(); if (e?.cancellable) e.cancelled = true; return null },
    'screen.active': async () => {
      const e = topEvent()
      if (e?.object.kind === 'form') return { form: e.object.name, control: e.control ?? null }
      const t = o.activeTab()
      const f = t && formOfTab(t.id)
      return { form: f?.name ?? null, control: f?.activeControl() ?? null }
    },
    'tempvars.get': async ([n]) => valueToWire(tempVars.get(foldName(String(n))) ?? null),
    'tempvars.set': async ([n, v]) => {
      const k = foldName(String(n))
      if (!tempVars.has(k) && tempVars.size >= MAX_TEMP_VARS) throw new Error('bc:tooManyTempVars')
      tempVars.set(k, wireToValue(v))
      return null
    },
    'tempvars.delete': async ([n]) => { tempVars.delete(foldName(String(n))); return null },
    'tempvars.clear': async () => { tempVars.clear(); return null },
    'tempvars.names': async () => [...tempVars.keys()],
    'app.project': async () => ({ name: o.projectName() }),
  }
  return Object.fromEntries(Object.entries(h).map(([k, f]) => [k, handled(f)]))
}
