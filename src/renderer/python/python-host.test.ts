import { afterEach, describe, expect, it, vi } from 'vitest'
import type { HostToWorker, WorkerToHost } from '../../shared/python/bridge'
import { createPythonHost } from './python-host'

class FakeWorker {
  static all: FakeWorker[] = []
  onmessage: ((e: { data: WorkerToHost }) => void) | null = null
  onerror: ((e: unknown) => void) | null = null
  received: HostToWorker[] = []
  terminated = false
  hold = false // do not answer requests
  constructor() { FakeWorker.all.push(this) }
  emit(m: WorkerToHost) { this.onmessage?.({ data: m }) }
  postMessage(m: HostToWorker) {
    this.received.push(m)
    if (m.t === 'init') queueMicrotask(() => this.emit({ t: 'ready' }))
    else if (m.t === 'request' && !this.hold) queueMicrotask(() => this.emit({ t: 'done', id: m.id, ok: true, value: m.req.op }))
  }
  terminate() { this.terminated = true }
}

const make = (enabled = true) => {
  FakeWorker.all = []
  const host = createPythonHost()
  host.configure({ contentEnabled: () => enabled, createWorker: () => new FakeWorker() as unknown as Worker })
  return host
}
const reqs = (w: FakeWorker) => w.received.filter((m) => m.t === 'request').map((m) => (m as { req: { op: string } }).req.op)

describe('PythonHost', () => {
  it('refuses immediate/exec/call while content is disabled, without creating the worker', async () => {
    const h = make(false)
    await expect(h.immediate('?1')).rejects.toThrow('bc:contentDisabled')
    await expect(h.exec('x=1')).rejects.toThrow('bc:contentDisabled')
    await expect(h.call('m', 'f', [])).rejects.toThrow('bc:contentDisabled')
    expect(FakeWorker.all).toHaveLength(0)
    expect(h.state()).toBe('off')
  })

  it('exports works while content is disabled', async () => {
    const h = make(false)
    await expect(h.exports('x')).resolves.toBe('exports')
    expect(FakeWorker.all).toHaveLength(1)
  })

  it('goes off, loading, idle, running, idle and notifies', async () => {
    const h = make()
    const seen: string[] = []
    h.subscribe(() => seen.push(h.state()))
    expect(h.state()).toBe('off')
    const ready = h.ensure()
    expect(h.state()).toBe('loading')
    await ready
    expect(h.state()).toBe('idle')
    FakeWorker.all[0]!.hold = true
    const p = h.exec('x=1')
    await Promise.resolve(); await Promise.resolve()
    expect(h.state()).toBe('running')
    expect(h.runningSince()).not.toBeNull()
    FakeWorker.all[0]!.emit({ t: 'done', id: 1, ok: true, value: null })
    await p
    expect(h.state()).toBe('idle')
    expect(h.runningSince()).toBeNull()
    expect(seen).toEqual(['loading', 'idle', 'running', 'idle'])
  })

  it('sends two exec calls to the worker in order, one at a time', async () => {
    const h = make()
    await Promise.all([h.exec('a'), h.exec('b')])
    const w = FakeWorker.all[0]!
    expect(w.received.filter((m) => m.t === 'request').map((m) => (m as { req: { code: string } }).req.code)).toEqual(['a', 'b'])
  })

  it('restart terminates the worker; the next call creates a new one', async () => {
    const h = make()
    await h.exec('a')
    h.restart()
    expect(FakeWorker.all[0]!.terminated).toBe(true)
    expect(h.state()).toBe('off')
    await h.exec('b')
    expect(FakeWorker.all).toHaveLength(2)
    expect(reqs(FakeWorker.all[1]!)).toEqual(['exec'])
  })

  it('restart rejects a call in flight', async () => {
    const h = make()
    await h.ensure()
    FakeWorker.all[0]!.hold = true
    const p = h.exec('loop')
    await Promise.resolve(); await Promise.resolve()
    h.restart()
    await expect(p).rejects.toThrow()
  })

  it('turns a Python error into a PythonError carrying the info', async () => {
    const h = make()
    await h.ensure()
    const w = FakeWorker.all[0]!
    w.hold = true
    const p = h.exec('boom')
    await Promise.resolve(); await Promise.resolve()
    const info = { type: 'ValueError', message: 'bad', module: null, line: 1, traceback: 'tb' }
    w.emit({ t: 'done', id: 1, ok: false, error: info })
    await expect(p).rejects.toMatchObject({ name: 'PythonError', message: 'bad', info })
  })

  it('a load error rejects ensure and the next ensure starts a fresh worker', async () => {
    FakeWorker.all = []
    const host = createPythonHost()
    host.configure({ contentEnabled: () => true, createWorker: () => {
      const w = new FakeWorker()
      if (FakeWorker.all.length === 1) w.postMessage = () => queueMicrotask(() => w.emit({ t: 'loadError', message: 'nope' }))
      return w as unknown as Worker
    } })
    await expect(host.ensure()).rejects.toThrow('nope')
    expect(host.state()).toBe('off')
    await host.ensure()
    expect(FakeWorker.all).toHaveLength(2)
  })

  it('answers worker calls with the registered handlers', async () => {
    const h = make()
    h.registerHandlers({ 'x.double': async (a) => (a[0] as number) * 2 })
    await h.ensure()
    const w = FakeWorker.all[0]!
    w.hold = true
    const p = h.exec('code')
    await Promise.resolve(); await Promise.resolve()
    const init = w.received.find((m) => m.t === 'init') as Extract<HostToWorker, { t: 'init' }>
    Atomics.store(new Int32Array(init.memory.control), 0, 1) // the worker parks in WAITING before it posts a call
    w.emit({ t: 'call', method: 'x.double', args: [21] })
    await new Promise((r) => setTimeout(r, 20))
    expect(new Int32Array(init.memory.control)[0]).toBe(2) // REPLY
    expect(JSON.parse(new TextDecoder().decode(new Uint8Array(init.memory.data).slice(0, new Int32Array(init.memory.control)[1])))).toEqual({ value: 42 })
    w.emit({ t: 'done', id: 1, ok: true, value: null })
    await p
  })

  it('keeps the last 1000 log lines and notifies', async () => {
    const h = make()
    const got: string[] = []
    h.onLog((l) => got.push(l))
    await h.ensure()
    const w = FakeWorker.all[0]!
    for (let i = 0; i < 1005; i++) w.emit({ t: 'stdout', text: `l${i}` })
    expect(h.log()).toHaveLength(1000)
    expect(h.log()[0]).toBe('l5')
    expect(got).toHaveLength(1005)
  })
})

describe('PythonHost interrupt (R6)', () => {
  afterEach(() => vi.useRealTimers())
  const running = async () => {
    const h = make()
    await h.ensure()
    const w = FakeWorker.all[0]!
    w.hold = true
    const p = h.exec('loop')
    p.catch(() => {})
    await Promise.resolve(); await Promise.resolve()
    return { h, w, p }
  }

  it('terminates a worker that ignores the interrupt after 2000 ms and signals the restart', async () => {
    vi.useFakeTimers()
    const { h, w, p } = await running()
    const restarted = vi.fn()
    h.onRestart(restarted)
    h.interrupt()
    vi.advanceTimersByTime(1999)
    expect(w.terminated).toBe(false)
    vi.advanceTimersByTime(1)
    expect(w.terminated).toBe(true)
    expect(restarted).toHaveBeenCalledTimes(1)
    await expect(p).rejects.toThrow('bc:pythonRestarted')
  })

  it('does not restart when the call ends at 1999 ms', async () => {
    vi.useFakeTimers()
    const { h, w, p } = await running()
    const restarted = vi.fn()
    h.onRestart(restarted)
    h.interrupt()
    vi.advanceTimersByTime(1999)
    w.emit({ t: 'done', id: 1, ok: true, value: null })
    await p
    vi.advanceTimersByTime(5000)
    expect(w.terminated).toBe(false)
    expect(restarted).not.toHaveBeenCalled()
  })

  it('never kills a queued call that started after the interrupted one ended', async () => {
    vi.useFakeTimers()
    const { h, w, p } = await running()
    const restarted = vi.fn()
    h.onRestart(restarted)
    const q = h.exec('next')
    await Promise.resolve(); await Promise.resolve()
    h.interrupt()
    h.interrupt() // no second timer
    w.emit({ t: 'done', id: 1, ok: true, value: null })
    await p
    vi.advanceTimersByTime(5000)
    expect(w.terminated).toBe(false)
    expect(restarted).not.toHaveBeenCalled()
    w.emit({ t: 'done', id: 2, ok: true, value: null })
    await q
  })

  it('simulateStuck makes the next interrupt a no-op for the worker', async () => {
    const { h, w } = await running()
    const init = w.received.find((m) => m.t === 'init') as Extract<HostToWorker, { t: 'init' }>
    const flag = new Int32Array(init.interrupt)
    h.simulateStuck()
    h.interrupt()
    expect(flag[0]).toBe(0)
    h.interrupt()
    expect(flag[0]).toBe(2)
    h.restart()
  })

  it('a restart between ensure and the request throws bc:pythonRestarted, not a TypeError', async () => {
    const h = make()
    const p = h.exec('x')
    h.restart() // session ends while ensure() is pending
    await expect(p).rejects.toThrow('bc:pythonRestarted')
  })
})
