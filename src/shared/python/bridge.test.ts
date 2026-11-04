import { describe, expect, it } from 'vitest'
import {
  ACK, BridgeCallError, BridgeServer, IDLE, NESTED, NESTED_MORE, REPLY, REPLY_MORE, SyncCaller, WAITING,
  createBridgeMemory, readMessage, writeMessage,
  type BridgeMemory, type HostToWorker, type WorkerToHost
} from './bridge'

const state = (m: BridgeMemory): number => Atomics.load(new Int32Array(m.control), 0)
const setState = (m: BridgeMemory, s: number): void => { Atomics.store(new Int32Array(m.control), 0, s) }
const noAck = (): void => {}

/** Write a message and replay its chunks into a reader, all on one thread. */
function roundTrip(mem: BridgeMemory, kind: 'reply' | 'nested', value: unknown): unknown {
  const ctl = new Int32Array(mem.control)
  const data = new Uint8Array(mem.data)
  const chunks: { s: number; bytes: Uint8Array }[] = []
  const snap = (): void => { chunks.push({ s: Atomics.load(ctl, 0), bytes: data.slice(0, ctl[1]) }) }
  writeMessage(mem, kind, value, () => { snap(); Atomics.store(ctl, 0, ACK) })
  snap() // the last chunk stays in memory
  let i = 0
  const load = (): void => {
    const c = chunks[i++]
    data.set(c.bytes)
    ctl[1] = c.bytes.length
    Atomics.store(ctl, 0, c.s)
  }
  load()
  return readMessage(mem, load)
}

describe('writeMessage / readMessage', () => {
  it('round-trips JSON with UTF-8', () => {
    const v = { s: '😀é', n: 1.5, x: null }
    expect(roundTrip(createBridgeMemory(), 'reply', v)).toEqual(v)
  })
  it('round-trips 5 MB through a 64 KiB area (chunked)', () => {
    const big = 'é'.repeat((5 * 1024 * 1024) / 2)
    expect(roundTrip(createBridgeMemory(64 * 1024), 'nested', big)).toBe(big)
  })
  it('turns undefined into null', () => {
    expect(roundTrip(createBridgeMemory(), 'reply', undefined)).toBeNull()
  })
})

function server(handle: () => Promise<unknown> = async () => 1, bytes = 1024) {
  const mem = createBridgeMemory(bytes)
  const posted: HostToWorker[] = []
  return { mem, posted, srv: new BridgeServer(mem, (m) => posted.push(m), handle) }
}
const done = (id: number, value: unknown): WorkerToHost => ({ t: 'done', id, ok: true, value })
const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 0))
const never = (): Promise<unknown> => new Promise(() => {})

/** Plays the worker's side of the handshake on the test thread, step by step. */
function fakeWorker(mem: BridgeMemory) {
  const ctl = new Int32Array(mem.control)
  const set = (s: number): void => { Atomics.store(ctl, 0, s); Atomics.notify(ctl, 0) }
  return {
    /** The worker enters a call: WAITING first, then the post (what SyncCaller does). */
    call(srv: BridgeServer): void { set(WAITING); srv.onWorkerMessage({ t: 'call', method: 'm', args: [] }) },
    /** The worker resumes waiting for its outer call after a nested request. */
    waiting(): void { set(WAITING) },
    /** The worker reads the message and stores IDLE (consumed). */
    take(): unknown { const v = readMessage(mem, noAck); set(IDLE); return v }
  }
}

describe('BridgeServer', () => {
  it('posts a request when the worker is idle', async () => {
    const { srv, posted } = server()
    const p = srv.request({ op: 'reset' })
    expect(posted).toEqual([{ t: 'request', id: 1, req: { op: 'reset' } }])
    expect(srv.busy).toBe(true)
    srv.onWorkerMessage(done(1, 'ok'))
    await expect(p).resolves.toBe('ok')
    expect(srv.busy).toBe(false)
  })
  it('rejects with the PyError', async () => {
    const { srv } = server()
    const p = srv.request({ op: 'reset' })
    const error = { type: 'ValueError', message: 'm', module: null, line: 3, traceback: 't' }
    srv.onWorkerMessage({ t: 'done', id: 1, ok: false, error })
    await expect(p).rejects.toEqual(error)
  })
  it('writes NESTED to the control cell while the worker waits', async () => {
    const { srv, posted, mem } = server(never)
    const p1 = srv.request({ op: 'exec', code: 'x' })
    const w = fakeWorker(mem)
    w.call(srv)
    const p2 = srv.request({ op: 'call', module: 'm', fn: 'f', args: [1] })
    expect(posted).toHaveLength(1)
    await flush()
    expect(state(mem)).toBe(NESTED)
    expect(w.take()).toEqual({ id: 2, req: { op: 'call', module: 'm', fn: 'f', args: [1] } })
    srv.onWorkerMessage(done(2, 'n'))
    await expect(p2).resolves.toBe('n')
    srv.onWorkerMessage(done(1, 'o'))
    await expect(p1).resolves.toBe('o')
  })
  it('queues a request while busy and not waiting (R5)', async () => {
    const { srv, posted } = server()
    const p1 = srv.request({ op: 'exec', code: 'a' })
    const p2 = srv.request({ op: 'exec', code: 'b' })
    expect(posted).toHaveLength(1)
    srv.onWorkerMessage(done(1, 1))
    await p1
    expect(posted).toHaveLength(2)
    expect(posted[1]).toEqual({ t: 'request', id: 2, req: { op: 'exec', code: 'b' } })
    srv.onWorkerMessage(done(2, 2))
    await expect(p2).resolves.toBe(2)
  })
  it('answers a worker call with { value }', async () => {
    const { srv, mem } = server(async () => 'v')
    fakeWorker(mem).call(srv)
    await flush()
    expect(state(mem)).toBe(REPLY)
    expect(readMessage(mem, noAck)).toEqual({ value: 'v' })
  })
  it('turns a handler rejection into an error reply', async () => {
    const { srv, mem } = server(async () => { throw new Error('x') })
    fakeWorker(mem).call(srv)
    await flush()
    expect(readMessage(mem, noAck)).toEqual({ error: { code: 'Error', message: 'x' } })
  })
  it('sends a multi-chunk reply, waiting for the reader ack between chunks', async () => {
    const { srv, mem } = server(async () => 'a'.repeat(50), 16)
    const ctl = new Int32Array(mem.control)
    const data = new Uint8Array(mem.data)
    fakeWorker(mem).call(srv)
    const parts: Uint8Array[] = []
    for (;;) {
      const s = state(mem)
      if (s === REPLY || s === REPLY_MORE) {
        parts.push(data.slice(0, ctl[1]))
        if (s === REPLY) break
        Atomics.store(ctl, 0, ACK)
        Atomics.notify(ctl, 0)
      }
      await flush()
    }
    const all = new Uint8Array(parts.reduce((a, p) => a + p.length, 0))
    let o = 0
    for (const p of parts) { all.set(p, o); o += p.length }
    expect(parts.length).toBeGreaterThan(2)
    expect(JSON.parse(new TextDecoder().decode(all))).toEqual({ value: 'a'.repeat(50) })
  })
})

describe('BridgeServer write coordination', () => {
  it('delivers two back-to-back nested requests one at a time, never overwriting', async () => {
    const { srv, mem } = server(never)
    const w = fakeWorker(mem)
    srv.request({ op: 'exec', code: 'top' })
    w.call(srv)
    const p2 = srv.request({ op: 'exec', code: 'a' })
    const p3 = srv.request({ op: 'exec', code: 'b' })
    await flush()
    expect(state(mem)).toBe(NESTED)
    expect(w.take()).toEqual({ id: 2, req: { op: 'exec', code: 'a' } })
    await flush()
    expect(state(mem)).toBe(IDLE) // request 3 waits: the worker is running request 2
    srv.onWorkerMessage(done(2, 'a'))
    await p2
    w.waiting()
    await flush()
    expect(state(mem)).toBe(NESTED)
    expect(w.take()).toEqual({ id: 3, req: { op: 'exec', code: 'b' } })
    srv.onWorkerMessage(done(3, 'b'))
    await expect(p3).resolves.toBe('b')
  })
  it('holds a handler reply that resolves while a nested request runs, then sends it', async () => {
    let resolve!: (v: unknown) => void
    const { srv, mem } = server(() => new Promise((r) => { resolve = r }))
    const w = fakeWorker(mem)
    srv.request({ op: 'exec', code: 'top' })
    w.call(srv)
    srv.request({ op: 'reset' })
    await flush()
    expect(w.take()).toEqual({ id: 2, req: { op: 'reset' } })
    resolve('late')
    await flush()
    expect(state(mem)).toBe(IDLE) // no reply while the nested request runs
    srv.onWorkerMessage(done(2, null))
    w.waiting()
    await flush()
    expect(state(mem)).toBe(REPLY)
    expect(w.take()).toEqual({ value: 'late' })
  })
  it('does not write a nested request over an unconsumed reply, and delivers it at the next call', async () => {
    const { srv, mem } = server(async () => 'r')
    const w = fakeWorker(mem)
    srv.request({ op: 'exec', code: 'top' })
    w.call(srv)
    await flush() // handler settled: the reply is in the shared area
    expect(state(mem)).toBe(REPLY)
    const p2 = srv.request({ op: 'reset' })
    await flush()
    expect(state(mem)).toBe(REPLY) // not clobbered by the nested request
    expect(w.take()).toEqual({ value: 'r' })
    await flush()
    expect(state(mem)).toBe(IDLE) // the worker runs Python: nothing is written to it
    w.call(srv) // its next call
    await flush()
    expect(state(mem)).toBe(NESTED)
    expect(w.take()).toEqual({ id: 2, req: { op: 'reset' } })
    srv.onWorkerMessage(done(2, 'x'))
    await expect(p2).resolves.toBe('x')
  })
  it('sends a multi-chunk nested request, waiting for the ack between chunks', async () => {
    const { srv, mem } = server(never, 16)
    const ctl = new Int32Array(mem.control)
    const data = new Uint8Array(mem.data)
    const w = fakeWorker(mem)
    srv.request({ op: 'exec', code: 'top' })
    w.call(srv)
    srv.request({ op: 'exec', code: 'x'.repeat(40) })
    const parts: Uint8Array[] = []
    for (;;) {
      const s = state(mem)
      if (s === NESTED || s === NESTED_MORE) {
        parts.push(data.slice(0, ctl[1]))
        if (s === NESTED) break
        Atomics.store(ctl, 0, ACK)
        Atomics.notify(ctl, 0)
      }
      await flush()
    }
    const all = new Uint8Array(parts.reduce((a, p) => a + p.length, 0))
    let o = 0
    for (const p of parts) { all.set(p, o); o += p.length }
    expect(parts.length).toBeGreaterThan(2)
    expect(JSON.parse(new TextDecoder().decode(all))).toEqual({ id: 2, req: { op: 'exec', code: 'x'.repeat(40) } })
  })
  it('keeps the write chain alive when a reply cannot be serialised', async () => {
    let n = 0
    const { srv, mem } = server(async () => (n++ === 0 ? 10n : 'ok'))
    const w = fakeWorker(mem)
    srv.request({ op: 'exec', code: 'top' })
    w.call(srv)
    await flush()
    expect(w.take()).toEqual({ error: { code: 'SerializationError', message: expect.stringContaining('BigInt') } })
    w.call(srv)
    await flush()
    expect(w.take()).toEqual({ value: 'ok' })
  })
  it('rejects a nested request that cannot be serialised without blocking the next one', async () => {
    const { srv, mem } = server(never)
    const w = fakeWorker(mem)
    srv.request({ op: 'exec', code: 'top' })
    w.call(srv)
    const bad = srv.request({ op: 'call', module: 'm', fn: 'f', args: [10n] })
    const good = srv.request({ op: 'reset' })
    await expect(bad).rejects.toThrow()
    await flush()
    expect(w.take()).toEqual({ id: 3, req: { op: 'reset' } })
    srv.onWorkerMessage(done(3, 1))
    await expect(good).resolves.toBe(1)
  })
  it('delivers a request issued by a handler while the worker runs a nested request (depth > 1)', async () => {
    let open!: () => void
    const gate = new Promise<void>((r) => { open = r })
    const { srv, mem } = server(async () => { await gate; return srv.request({ op: 'exec', code: 'ev' }) })
    const w = fakeWorker(mem)
    srv.request({ op: 'exec', code: 'top' })
    w.call(srv)
    const p2 = srv.request({ op: 'reset' })
    await flush()
    expect(w.take()).toEqual({ id: 2, req: { op: 'reset' } })
    open()
    await flush()
    expect(state(mem)).toBe(IDLE) // worker is running: the handler's request is queued
    srv.onWorkerMessage(done(2, null))
    await p2
    w.waiting()
    await flush()
    expect(state(mem)).toBe(NESTED)
    expect(w.take()).toEqual({ id: 3, req: { op: 'exec', code: 'ev' } })
    srv.onWorkerMessage(done(3, 'evres'))
    w.waiting()
    await flush()
    expect(w.take()).toEqual({ value: 'evres' })
  })
  it('posts a request queued while the worker ran once the top-level request finishes', async () => {
    const { srv, posted } = server(never)
    srv.request({ op: 'exec', code: 'a' })
    const p2 = srv.request({ op: 'exec', code: 'b' }) // no call in progress: cannot be nested
    srv.onWorkerMessage(done(1, 1))
    expect(posted[1]).toEqual({ t: 'request', id: 2, req: { op: 'exec', code: 'b' } })
    srv.onWorkerMessage(done(2, 2))
    await expect(p2).resolves.toBe(2)
  })
})

it('createBridgeMemory rejects a data area that cannot hold a chunk', () => {
  expect(() => createBridgeMemory(0)).toThrow(RangeError)
})

describe('SyncCaller', () => {
  function caller(onWait: (mem: BridgeMemory, n: number) => void, onNested: (id: number, req: unknown) => void = noAck) {
    const mem = createBridgeMemory(1024)
    const posted: WorkerToHost[] = []
    let n = 0
    const sc = new SyncCaller(mem, (m) => posted.push(m), onNested, () => onWait(mem, n++))
    return { sc, posted, mem }
  }
  it('posts the call, waits, returns the reply value and goes idle', () => {
    const { sc, posted, mem } = caller((m) => writeMessage(m, 'reply', { value: [1, 2] }, noAck))
    expect(sc.call('m', [7])).toEqual([1, 2])
    expect(posted).toEqual([{ t: 'call', method: 'm', args: [7] }])
    expect(state(mem)).toBe(IDLE)
  })
  it('throws BridgeCallError on an error reply', () => {
    const { sc } = caller((m) => writeMessage(m, 'reply', { error: { code: 'E', message: 'boom' } }, noAck))
    expect(() => sc.call('m', [])).toThrow(BridgeCallError)
    expect(() => sc.call('m', [])).toThrow('boom')
  })
  it('runs nested requests then keeps waiting for the final reply', () => {
    const seen: unknown[] = []
    const { sc } = caller(
      (m, n) => writeMessage(m, n === 0 ? 'nested' : 'reply', n === 0 ? { id: 9, req: { op: 'reset' } } : { value: 'end' }, noAck),
      (id, req) => seen.push([id, req])
    )
    expect(sc.call('m', [])).toBe('end')
    expect(seen).toEqual([[9, { op: 'reset' }]])
  })
  it('restores WAITING and rethrows when onNested throws', () => {
    const mem = createBridgeMemory(1024)
    const sc = new SyncCaller(mem, () => {}, () => { throw new Error('nested boom') }, () => writeMessage(mem, 'nested', { id: 1, req: { op: 'reset' } }, noAck))
    expect(() => sc.call('m', [])).toThrow('nested boom')
    expect(state(mem)).toBe(WAITING)
  })
  it('refuses to start a call unless the control cell is IDLE', () => {
    const mem = createBridgeMemory(1024)
    setState(mem, REPLY)
    expect(() => new SyncCaller(mem, () => {}, noAck).call('m', [])).toThrow('not IDLE')
  })
  it('is IDLE while a nested request runs, so Python can call() inside it', () => {
    const mem = createBridgeMemory(1024)
    let during = -1
    let n = 0
    const sc = new SyncCaller(mem, () => {}, () => { during = state(mem) }, () => {
      writeMessage(mem, n++ === 0 ? 'nested' : 'reply', n === 1 ? { id: 1, req: { op: 'reset' } } : { value: 1 }, noAck)
    })
    expect(sc.call('m', [])).toBe(1)
    expect(during).toBe(IDLE)
  })
})
