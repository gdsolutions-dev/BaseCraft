import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ExprRuntimeError } from '../../shared/expr/ast'
import { num } from '../../shared/expr/library'
import { setUserFunctions, userFunctionNames } from '../../shared/expr/user-functions'

const h = vi.hoisted(() => ({
  PE: class extends Error { constructor(readonly info: { message: string }) { super(info.message); this.name = 'PythonError' } }, enabled: true, call: vi.fn(), blocked: vi.fn(), fns: [] as { module: string; fn: string; params: string[] }[], gate: null as Promise<void> | null }))
const PE = h.PE
vi.mock('./python-host', () => ({ PythonError: h.PE, pythonHost: () => ({ contentEnabled: () => h.enabled, call: h.call }) }))
vi.mock('../shell/Banners', () => ({ contentBlocked: h.blocked }))
vi.mock('./function-index', () => ({
  listFunctions: async () => { const f = h.fns; const g = h.gate; h.gate = null; if (g) await g; return f },
  resolveFunction: async (n: string) => {
    const f = h.fns.filter((x) => x.fn.toLowerCase() === n.toLowerCase())
    if (f.length !== 1) throw new Error('bc:pythonFunctionNotFound|' + n)
    return f[0]
  },
}))
import { callUserFunction, clearInFlight } from './expr-call'
import { notifyUserFunctions, onUserFunctionsChanged, refreshUserFunctions } from './user-function-names'

const code = async (p: Promise<unknown>) => p.then(() => null, (e: ExprRuntimeError) => e)

beforeEach(() => {
  h.enabled = true; h.call.mockReset(); h.blocked.mockReset()
  h.fns = [{ module: 'm', fn: 'Double', params: ['x'] }]
})

describe('callUserFunction', () => {
  it('content disabled: banner and contentDisabled', async () => {
    h.enabled = false
    expect((await code(callUserFunction('Double', [])))?.code).toBe('contentDisabled')
    expect(h.blocked).toHaveBeenCalled()
    expect(h.call).not.toHaveBeenCalled()
  })
  it('unknown function', async () => { expect((await code(callUserFunction('Nope', [])))?.code).toBe('unknownFunction') })
  it('calls quietly and converts the result', async () => {
    h.call.mockResolvedValueOnce(4)
    expect(await callUserFunction('double', [{ t: 'num', v: 2 }])).toEqual({ t: 'num', v: 4 })
    expect(h.call).toHaveBeenCalledWith('m', 'Double', [2], { quiet: true })
    h.call.mockResolvedValueOnce(null)
    expect(await callUserFunction('Double', [])).toBeNull()
    h.call.mockResolvedValueOnce({ $date: '2024-03-05 00:00:00' })
    expect(((await callUserFunction('Double', [])) as { t: string }).t).toBe('date')
  })
  it('any other failure (dead engine, restart) -> pythonError, never a raw throw; a late contentDisabled rejection -> contentDisabled', async () => {
    h.call.mockRejectedValueOnce(new Error('engine dead'))
    expect([(await code(callUserFunction('Double', [])))?.code]).toEqual(['pythonError'])
    h.call.mockRejectedValueOnce(new Error('bc:pythonRestarted'))
    expect((await code(callUserFunction('Double', [])))?.code).toBe('pythonError')
    h.call.mockRejectedValueOnce(new Error('bc:contentDisabled'))
    expect((await code(callUserFunction('Double', [])))?.code).toBe('contentDisabled')
    expect(h.blocked).toHaveBeenCalled()
  })
  it('PythonError -> pythonError with message; list -> typeMismatch', async () => {
    h.call.mockRejectedValueOnce(new PE({ message: 'boom' }))
    const e = await code(callUserFunction('Double', []))
    expect([e?.code, e?.detail]).toEqual(['pythonError', 'boom'])
    h.call.mockResolvedValueOnce([1, 2])
    expect((await code(callUserFunction('Double', [])))?.code).toBe('typeMismatch')
  })
})

describe('callUserFunction: the same call in flight', () => {
  it('is shared, and asked again after it ended', async () => {
    let end!: (v: unknown) => void
    h.call.mockImplementationOnce(() => new Promise((r) => { end = r }))
    const a = callUserFunction('Double', [num(1)]), b = callUserFunction('double', [num(1)])
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve()
    end(2)
    expect(await a).toEqual(await b)
    expect(h.call).toHaveBeenCalledTimes(1)
    h.call.mockResolvedValueOnce(2)
    await callUserFunction('Double', [num(1)])
    expect(h.call).toHaveBeenCalledTimes(2)
  })
})

describe('callUserFunction: after a module save', () => {
  it('notifyUserFunctions drops the shared in-flight call', async () => {
    h.call.mockImplementationOnce(() => new Promise(() => {}))
    void callUserFunction('Double', [num(1)])
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve()
    notifyUserFunctions()
    h.call.mockResolvedValueOnce(9)
    expect(await callUserFunction('Double', [num(1)])).toEqual(num(9))
    expect(h.call).toHaveBeenCalledTimes(2)
    clearInFlight()
  })
})

describe('refreshUserFunctions', () => {
  it('sets the registry and fires only on a change of names', async () => {
    setUserFunctions([])
    const f = vi.fn(); onUserFunctionsChanged(f)
    await refreshUserFunctions()
    expect([...userFunctionNames()]).toEqual(['double'])
    expect(f).toHaveBeenCalledTimes(1)
    await refreshUserFunctions()
    expect(f).toHaveBeenCalledTimes(1)
    h.fns = [{ module: 'm', fn: 'Triple', params: [] }]
    await refreshUserFunctions()
    expect(f).toHaveBeenCalledTimes(2)
  })
  it('an older refresh resolving late does not overwrite newer names', async () => {
    setUserFunctions([])
    let open!: () => void
    h.gate = new Promise<void>((r) => { open = r })
    h.fns = [{ module: 'm', fn: 'Old', params: [] }]
    const slow = refreshUserFunctions()
    await Promise.resolve()
    h.fns = [{ module: 'm', fn: 'New', params: [] }]
    await refreshUserFunctions()
    open(); await slow
    expect([...userFunctionNames()]).toEqual(['new'])
  })
})
