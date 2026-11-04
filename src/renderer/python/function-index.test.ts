import { beforeEach, describe, expect, it, vi } from 'vitest'

const defs: Record<string, { modified: string; exports: { name: string; params: string[] }[] }> = {}
const get = vi.fn(async (_k: string, name: string) => {
  if (name === 'Corrompu') throw new Error('bc:corruptObject')
  return { name, definition: { exports: defs[name]!.exports } }
})
vi.mock('../bridge', () => ({
  api: {
    objects: {
      list: async () => Object.entries(defs).map(([name, d]) => ({ kind: 'module', name, modified: d.modified })),
      get: (k: string, n: string) => get(k, n),
    },
  },
}))
import { functionClashes, listFunctions, resolveFunction } from './function-index'

const ex = (...n: string[]) => n.map((name) => ({ name, params: ['a'] }))
beforeEach(() => { for (const k of Object.keys(defs)) delete defs[k]; get.mockClear() })

describe('function index', () => {
  it('resolves case-insensitively with the export spelling; rereads only on a changed modified', async () => {
    defs.Calculs = { modified: '1', exports: ex('remise') }
    expect(await resolveFunction('Remise')).toEqual({ module: 'Calculs', fn: 'remise', params: ['a'] })
    await resolveFunction('REMISE')
    expect(get).toHaveBeenCalledTimes(1)
    defs.Calculs = { modified: '2', exports: ex('remise', 'autre') }
    expect((await listFunctions()).map((f) => f.fn)).toEqual(['autre', 'remise'])
    expect(get).toHaveBeenCalledTimes(2)
  })
  it('not found and ambiguous', async () => {
    defs.A = { modified: '1', exports: ex('f') }
    defs.B = { modified: '1', exports: ex('F') }
    await expect(resolveFunction('f')).rejects.toThrow('bc:pythonFunctionAmbiguous|f|A, B')
    await expect(resolveFunction('g')).rejects.toThrow('bc:pythonFunctionNotFound|g')
  })
  it('clashes', async () => {
    defs.A = { modified: '1', exports: ex('left', 'f') }
    defs.B = { modified: '1', exports: ex('F') }
    expect(await functionClashes('A', ex('left', 'f'))).toEqual([{ fn: 'left', other: null }, { fn: 'f', other: 'B' }])
  })
  it('a module that cannot be read is skipped, the others still resolve', async () => {
    defs.Corrompu = { modified: '1', exports: [] }
    defs.Calculs = { modified: '1', exports: ex('remise') }
    expect(await resolveFunction('remise')).toMatchObject({ module: 'Calculs' })
  })
  it('a failed read is not cached: the next call reads again under the same modified', async () => {
    defs.Transitoire = { modified: '9', exports: ex('tr') }
    get.mockRejectedValueOnce(new Error('transient'))
    expect(await listFunctions()).toEqual([])
    expect(await resolveFunction('tr')).toMatchObject({ module: 'Transitoire' })
  })
})
