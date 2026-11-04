import type { ModuleExport } from './bridge'

export type ModuleDef = { formatVersion: '1.0'; source: string; exports: ModuleExport[] }

const KEYWORDS = new Set(('False None True and as assert async await break class continue def del elif else except finally for from '
  + 'global if import in is lambda nonlocal not or pass raise return try while with yield').split(' '))

/** A module name is a Python name (it is imported by it) and not a Python keyword (R7). */
export const isModuleName = (name: string): boolean => /^[\p{L}_][\p{L}\p{N}_]*$/u.test(name) && !KEYWORDS.has(name)

export const newModuleDef = (): ModuleDef => ({ formatVersion: '1.0', source: '', exports: [] })

export function parseModuleDef(v: unknown): ModuleDef {
  const d = v as Partial<ModuleDef> | null
  const ok = typeof d === 'object' && d !== null && d.formatVersion === '1.0' && typeof d.source === 'string' && Array.isArray(d.exports)
    && d.exports.every((e) => typeof e?.name === 'string' && Array.isArray(e.params) && e.params.every((p) => typeof p === 'string'))
  if (!ok) throw new Error('bc:badModule')
  return d as ModuleDef
}
