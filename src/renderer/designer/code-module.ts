// B6: the code-behind module of a form or report: created on demand, with the event procedure the user is going to write.
import { codeBehindModule } from '../../shared/python/code-behind'
import { sameName } from '../../shared/field-types'
import { api } from '../bridge'
import { pythonHost } from '../python/python-host'
import { shellDispatch } from '../shell/modal-tab'

const defLine = (source: string, fn: string): number => source.split(/\r?\n/).findIndex((l) => new RegExp(String.raw`^\s*(?:async\s+)?def\s+${fn}\s*\(`, 'i').test(l)) + 1

/** Saves `source` as the module (exports from Python; the engine down: saved anyway, as the module editor does) and resets the user modules. */
export async function saveModuleSource(module: string, source: string): Promise<void> {
  let exports: { name: string; params: string[] }[] = [], down = false
  try { exports = (await pythonHost().exports(source)).exports } catch { down = true }
  const r = await api.objects.save('module', module, { formatVersion: '1.0', source, exports }, null)
  if (!r.ok) throw new Error(`bc:${r.reason}`)
  shellDispatch({ type: 'objectSaved', kind: 'module', name: module })
  if (!down && pythonHost().state() !== 'off') await pythonHost().reset()
}

/** The module of the form or report, with `fn` in it (an empty `def` is added when missing); its line. */
export async function ensureCodeBehind(kind: 'form' | 'report', object: string, fn: string | null): Promise<{ module: string; line: number }> {
  const module = codeBehindModule(kind, object)
  const found = (await api.objects.list('module')).find((m) => sameName(m.name, module))
  let source = found ? ((await api.objects.get('module', found.name)).definition as { source?: string } | null)?.source ?? '' : `# Code of the ${kind} ${object}\n`
  const missing = fn !== null && defLine(source, fn) === 0
  if (missing) source = `${source.replace(/\s+$/, '')}\n\n\ndef ${fn}():\n    pass\n`
  if (!found || missing) await saveModuleSource(found?.name ?? module, source)
  return { module: found?.name ?? module, line: fn ? defLine(source, fn) || 1 : 0 }
}
