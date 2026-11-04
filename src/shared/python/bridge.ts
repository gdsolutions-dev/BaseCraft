// Python bridge protocol over SharedArrayBuffer (decision R4/R5, Task 1 spike option A).
// Pure TypeScript: no Electron, DOM or Node API. Used by the worker (SyncCaller) and the renderer host (BridgeServer).

export type HostRequest =
  | { op: 'exec'; code: string }
  | { op: 'immediate'; line: string }
  | { op: 'exports'; source: string }
  | { op: 'call'; module: string; fn: string; args: unknown[] }
  | { op: 'reset' }

export type PyError = { type: string; message: string; module: string | null; line: number | null; traceback: string }
export type ModuleExport = { name: string; params: string[] }

export type BridgeMemory = { control: SharedArrayBuffer; data: SharedArrayBuffer }

export type WorkerToHost =
  | { t: 'ready' }
  | { t: 'call'; method: string; args: unknown[] }
  | { t: 'done'; id: number; ok: true; value: unknown }
  | { t: 'done'; id: number; ok: false; error: PyError }
  | { t: 'stdout'; text: string }
  | { t: 'loadError'; message: string }

export type HostToWorker =
  | { t: 'init'; memory: BridgeMemory; interrupt: SharedArrayBuffer; baseUrl: string; lib: Record<string, string> }
  | { t: 'request'; id: number; req: HostRequest }

// Control cell 0 = state, cell 1 = byte length of the chunk currently in the data area.
export const IDLE = 0
export const WAITING = 1
export const REPLY = 2
export const REPLY_MORE = 3
export const NESTED = 4
export const NESTED_MORE = 5
export const ACK = 6

export class BridgeCallError extends Error {
  constructor(readonly code: string, message: string) {
    super(message)
    this.name = 'BridgeCallError'
  }
}

export function createBridgeMemory(dataBytes = 1 << 20): BridgeMemory {
  if (!(dataBytes >= 16)) throw new RangeError('createBridgeMemory: dataBytes must be at least 16')
  return { control: new SharedArrayBuffer(16), data: new SharedArrayBuffer(dataBytes) }
}

const enc = new TextEncoder()
const dec = new TextDecoder()
const encode = (value: unknown): Uint8Array => enc.encode(JSON.stringify(value === undefined ? null : value))

// The renderer main thread cannot Atomics.wait; waitAsync is available in Chromium (and Node).
const waitAsync = (Atomics as unknown as { waitAsync(a: Int32Array, i: number, v: number): { async: boolean; value: unknown } }).waitAsync

/** Publishes the message chunk by chunk; yields after each non-final chunk (caller waits for the ack). */
function* publish(mem: BridgeMemory, kind: 'reply' | 'nested', bytes: Uint8Array): Generator<void> {
  const ctl = new Int32Array(mem.control)
  const data = new Uint8Array(mem.data)
  const [last, more] = kind === 'reply' ? [REPLY, REPLY_MORE] : [NESTED, NESTED_MORE]
  let off = 0
  do {
    const n = Math.min(data.length, bytes.length - off)
    data.set(bytes.subarray(off, off + n))
    off += n
    ctl[1] = n
    const final = off >= bytes.length
    Atomics.store(ctl, 0, final ? last : more)
    Atomics.notify(ctl, 0)
    if (!final) yield
  } while (off < bytes.length)
}

/** Blocking writer: `waitAck` must return once the reader has acknowledged the chunk (state ACK). */
export function writeMessage(mem: BridgeMemory, kind: 'reply' | 'nested', value: unknown, waitAck: () => void): void {
  for (const _ of publish(mem, kind, encode(value))) waitAck()
}

async function until(ctl: Int32Array, ok: (s: number) => boolean): Promise<void> {
  for (;;) {
    const s = Atomics.load(ctl, 0)
    if (ok(s)) return
    const r = waitAsync(ctl, 0, s)
    if (r.async) await r.value
  }
}

/**
 * Host-side writer. Only valid while the worker is parked in WAITING; returns once the worker has
 * consumed the whole message (its next store leaves REPLY/NESTED), so the next write cannot clobber it.
 */
async function writeMessageAsync(mem: BridgeMemory, kind: 'reply' | 'nested', bytes: Uint8Array): Promise<void> {
  const ctl = new Int32Array(mem.control)
  await until(ctl, (s) => s === WAITING)
  for (const _ of publish(mem, kind, bytes)) await until(ctl, (s) => s === ACK)
  const [last, more] = kind === 'reply' ? [REPLY, REPLY_MORE] : [NESTED, NESTED_MORE]
  await until(ctl, (s) => s !== last && s !== more)
}

/** Reads one (possibly chunked) message. `ack` must acknowledge the chunk and block until the next one is published. */
export function readMessage(mem: BridgeMemory, ack: () => void): unknown {
  const ctl = new Int32Array(mem.control)
  const data = new Uint8Array(mem.data)
  const parts: Uint8Array[] = []
  for (;;) {
    const s = Atomics.load(ctl, 0)
    parts.push(data.slice(0, ctl[1])) // copy: TextDecoder cannot decode a view on a SharedArrayBuffer
    if (s !== REPLY_MORE && s !== NESTED_MORE) break
    ack()
  }
  const all = new Uint8Array(parts.reduce((a, p) => a + p.length, 0))
  let o = 0
  for (const p of parts) { all.set(p, o); o += p.length }
  return JSON.parse(dec.decode(all))
}

/** Worker side: a synchronous call to the host. Nested host requests run on this very stack. */
export class SyncCaller {
  constructor(
    private readonly mem: BridgeMemory,
    private readonly post: (m: WorkerToHost) => void,
    // Contract: onNested reports its own failures through `done`; if it throws, call() restores WAITING
    // and rethrows, and the bridge must be considered broken (the host should recycle the worker).
    private readonly onNested: (id: number, req: HostRequest) => void,
    // Blocking seam; tests inject a fake that plays the host's part.
    private readonly wait: (ctl: Int32Array, index: number, value: number) => unknown = (c, i, v) => Atomics.wait(c, i, v)
  ) {}

  call(method: string, args: unknown[]): unknown {
    const ctl = new Int32Array(this.mem.control)
    // The control cell is IDLE whenever Python runs, also inside a nested request.
    if (Atomics.load(ctl, 0) !== IDLE) throw new Error('SyncCaller.call: control cell is not IDLE')
    const set = (s: number): void => { Atomics.store(ctl, 0, s); Atomics.notify(ctl, 0) }
    // WAITING before post: the host may answer before this thread reaches its wait.
    set(WAITING)
    this.post({ t: 'call', method, args })
    const ack = (): void => {
      set(ACK)
      while (Atomics.load(ctl, 0) === ACK) this.wait(ctl, 0, ACK)
    }
    for (;;) {
      const s = Atomics.load(ctl, 0)
      if (s === WAITING) { this.wait(ctl, 0, WAITING); continue }
      const msg = readMessage(this.mem, ack) as never
      set(IDLE) // consumed: lets the host issue the next message once we wait again
      if (s === REPLY || s === REPLY_MORE) {
        const r = msg as { value?: unknown; error?: { code: string; message: string } }
        if (r.error) throw new BridgeCallError(r.error.code, r.error.message)
        return r.value
      }
      const n = msg as { id: number; req: HostRequest }
      try {
        this.onNested(n.id, n.req) // may itself call(); that nests cleanly
      } finally {
        set(WAITING)
      }
    }
  }
}

type Deferred = { resolve: (v: unknown) => void; reject: (e: unknown) => void }
type OpenCall = { reply?: unknown } // a worker call awaiting its reply (stack: innermost last)

/**
 * Host side. One Python call at a time (R5). A request made while the worker runs is queued and delivered
 * at its next opportunity: nested as soon as it next waits for a call, or posted once it is idle.
 * Writes into the shared area happen one at a time, only while the worker is parked in WAITING.
 */
export class BridgeServer {
  private nextId = 1
  private readonly pending = new Map<number, Deferred>()
  private readonly queue: { id: number; req: HostRequest }[] = []
  private readonly nestedIds = new Set<number>()
  private readonly calls: OpenCall[] = []
  private posted = false // a top-level request is in flight
  private slot = false // the worker is (about to be) parked in WAITING and nothing was issued to it yet
  private sending = false

  constructor(
    private readonly mem: BridgeMemory,
    private readonly post: (m: HostToWorker) => void,
    private readonly handle: (method: string, args: unknown[]) => Promise<unknown>
  ) {}

  get busy(): boolean { return this.pending.size > 0 }

  /** Worker calls (message box, dialog form...) whose reply is not issued yet: the worker is parked on them, not stuck (R9). */
  pendingCalls(): number { return this.calls.length }

  request(req: HostRequest): Promise<unknown> {
    const id = this.nextId++
    const p = new Promise<unknown>((resolve, reject) => this.pending.set(id, { resolve, reject }))
    if (!this.posted) {
      this.posted = true
      this.post({ t: 'request', id, req })
    } else {
      this.queue.push({ id, req })
      this.pump()
    }
    return p
  }

  // 'ready', 'stdout' and 'loadError' are not the protocol's business: the owner of the worker handles them.
  onWorkerMessage(m: WorkerToHost): void {
    if (m.t === 'call') {
      const open: OpenCall = {}
      this.calls.push(open)
      this.slot = true // the worker stored WAITING before posting this
      const settle = (reply: unknown): void => { open.reply = reply; this.pump() }
      this.handle(m.method, m.args).then(
        (value) => settle({ value: value === undefined ? null : value }),
        (e: unknown) => {
          const err = e as { code?: unknown; name?: unknown; message?: unknown }
          const code = typeof err?.code === 'string' ? err.code : typeof err?.name === 'string' ? err.name : 'Error'
          settle({ error: { code, message: String(err?.message ?? e) } })
        }
      )
      this.pump()
    } else if (m.t === 'done') {
      const d = this.pending.get(m.id)
      if (!d) return
      this.pending.delete(m.id)
      if (this.nestedIds.delete(m.id)) this.slot = this.calls.length > 0 // the worker resumes waiting for its outer call
      else this.posted = false
      if (m.ok) d.resolve(m.value)
      else d.reject(m.error)
      const next = this.posted ? undefined : this.queue.shift()
      if (next) {
        this.posted = true
        this.post({ t: 'request', id: next.id, req: next.req })
      } else this.pump()
    }
  }

  /** Issues the next message if the worker is waiting: the innermost call's reply first, else a queued request. */
  private pump(): void {
    if (this.sending || !this.slot) return
    const top = this.calls[this.calls.length - 1]
    if (top?.reply !== undefined) {
      this.calls.pop() // leaves the stack as soon as it is on its way: the worker may call again right after reading it
      this.issue('reply', top.reply)
    } else if (this.queue.length > 0 && top) {
      const { id, req } = this.queue.shift()!
      this.nestedIds.add(id)
      this.issue('nested', { id, req }, (err) => {
        // Not serialisable: fail this request only; the worker is still waiting.
        this.nestedIds.delete(id)
        this.pending.get(id)?.reject(err)
        this.pending.delete(id)
        this.pump()
      })
    }
  }

  private issue(kind: 'reply' | 'nested', value: unknown, onEncodeError?: (e: unknown) => void): void {
    let bytes: Uint8Array
    try {
      bytes = encode(value)
    } catch (e) {
      if (kind === 'nested') { onEncodeError?.(e); return }
      bytes = encode({ error: { code: 'SerializationError', message: String((e as Error)?.message ?? e) } })
    }
    this.slot = false
    this.sending = true
    writeMessageAsync(this.mem, kind, bytes).finally(() => { this.sending = false; this.pump() })
  }
}
