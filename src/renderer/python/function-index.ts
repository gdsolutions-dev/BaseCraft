// Which module a `=name(args)` event calls (D2 R2): the saved `exports` of every module, read again only when `modified` changes.
import { FUNCTION_TABLE } from '../../shared/expr/catalog'
import { foldName, sameName } from '../../shared/field-types'
import type { ModuleExport } from '../../shared/python/bridge'
import { isCodeBehind } from '../../shared/python/code-behind'

export type FunctionRef = { module: string; fn: string; params: string[] }
const cache = new Map<string, { modified: string; exports: ModuleExport[] }>()

async function refresh(): Promise<void> {
  const { api } = await import('../bridge') // lazy: bridge.ts reads window.basecraft at load
  const list = await api.objects.list('module')
  const names = new Set(list.map((m) => m.name))
  for (const k of [...cache.keys()]) if (!names.has(k)) cache.delete(k)
  for (const m of list) {
    if (cache.get(m.name)?.modified === m.modified) continue
    let e: ModuleExport[] | undefined
    try { e = ((await api.objects.get('module', m.name)).definition as { exports?: ModuleExport[] } | null)?.exports } catch { cache.delete(m.name); continue } // unreadable: skipped for this call only, not cached
    cache.set(m.name, { modified: m.modified, exports: Array.isArray(e) ? e : [] })
  }
}

export async function listFunctions(): Promise<FunctionRef[]> {
  await refresh()
  return [...cache].filter(([module]) => !isCodeBehind(module)).flatMap(([module, c]) => c.exports.map((x) => ({ module, fn: x.name, params: x.params })))
    .sort((a, b) => a.module.localeCompare(b.module) || a.fn.localeCompare(b.fn))
}

/** B6: the event procedure `fn` of the code-behind module `module` (exported spelling), null when it is not there. */
export async function findProcedure(module: string, fn: string): Promise<FunctionRef | null> {
  await refresh()
  for (const [m, c] of cache) {
    const x = sameName(m, module) ? c.exports.find((e) => sameName(e.name, fn)) : undefined
    if (x) return { module: m, fn: x.name, params: x.params }
  }
  return null
}

// Errors follow errorMessage's `bc:code|sub|detail` convention (one pipe): sub -> {{name}}, the rest -> {{detail}}.
export async function resolveFunction(name: string): Promise<FunctionRef> {
  const found = (await listFunctions()).filter((f) => sameName(f.fn, name))
  if (found.length === 0) throw new Error(`bc:pythonFunctionNotFound|${name}`)
  if (found.length > 1) throw new Error(`bc:pythonFunctionAmbiguous|${name}|${found.map((f) => f.module).join(', ')}`)
  return found[0]!
}

/** R12: for each export of `module`, the other module exporting the same name, or null for a built-in expression function. */
export async function functionClashes(module: string, exports: ModuleExport[]): Promise<{ fn: string; other: string | null }[]> {
  if (isCodeBehind(module)) return []   // event procedures: the same names in every form's module
  const others = (await listFunctions()).filter((f) => !sameName(f.module, module))
  const builtins = new Set(Object.keys(FUNCTION_TABLE).map(foldName))
  const out: { fn: string; other: string | null }[] = []
  for (const x of exports) {
    if (builtins.has(foldName(x.name))) out.push({ fn: x.name, other: null })
    else { const o = others.find((f) => sameName(f.fn, x.name)); if (o) out.push({ fn: x.name, other: o.module }) }
  }
  return out
}
