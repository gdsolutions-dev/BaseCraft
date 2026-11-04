import { describe, expect, it } from 'vitest'
import { isModuleName, newModuleDef, parseModuleDef } from './module-def'

describe('isModuleName', () => {
  it('accepts Python identifiers', () => {
    for (const n of ['Module1', 'outils_stock', 'Remises_été', '_x']) expect(isModuleName(n), n).toBe(true)
  })
  it('refuses the rest and the keywords', () => {
    for (const n of ['1abc', 'class', 'None', 'a b', 'a-b', '']) expect(isModuleName(n), n).toBe(false)
  })
})

describe('parseModuleDef', () => {
  const ok = { formatVersion: '1.0', source: 'x', exports: [{ name: 'f', params: ['a'] }] }
  it('accepts a valid definition', () => {
    expect(parseModuleDef(ok)).toEqual(ok)
    expect(newModuleDef()).toEqual({ formatVersion: '1.0', source: '', exports: [] })
  })
  it('rejects invalid ones', () => {
    for (const bad of [{ ...ok, formatVersion: '2.0' }, { ...ok, source: 3 }, { ...ok, exports: [{ name: 'f' }] }, null, 'x'])
      expect(() => parseModuleDef(bad)).toThrow('bc:badModule')
  })
})
