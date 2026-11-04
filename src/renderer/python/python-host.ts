import {
  BridgeServer, createBridgeMemory,
  type HostRequest, type HostToWorker, type ModuleExport, type PyError, type WorkerToHost,
} from '../../shared/python/bridge'
import { PYTHON_BASE_URL } from '../../shared/python/paths'
import { LIB_FILES } from './install-lib'

export type PythonState = 'off' | 'loading' | 'idle' | 'running'
export type BridgeHandler = (args: unknown[]) => Promise<unknown>
export type ExportsResult = { exports: ModuleExport[]; error: { line: number; col: number; message: string } | null }

export class PythonError extends Error {
  constructor(readonly info: PyError) {
    super(info.message)
    this.name = 'PythonError'
  }
}

const LOG_MAX = 1000
const INTERRUPT_GRACE_MS = 2000 // R6
const SLOW_MS = 2000 // R4

/** One worker with its bridge and shared memory; dropped as a whole when the worker dies. */
type Session = {
  worker: Worker
  server: BridgeServer
  interrupt: SharedArrayBuffer
  ready: boolean
  whenReady: Promise<void>
  dead: Promise<never> // rejects when the session ends; races every request
  end(reason: Error): void
}

export function createPythonHost() {
  let contentEnabled: () => boolean = () => false
  let createWorker: () => Worker = () => new Worker(new URL('./python-worker.ts', import.meta.url), { type: 'module', name: 'python-worker' })
  const handlers: Record<string, BridgeHandler> = {
    'log.write': async ([text]) => { pushLog(String(text)); return null },
    'modules.source': async ([name]) => {
      const { api } = await import('../bridge') // lazy: bridge.ts reads window.basecraft at load
      try {
        const o = await api.objects.get('module', String(name))
        return (o.definition as { source?: string } | null)?.source ?? null
      } catch (e) {
        if (/bc:notFound/.test(String((e as Error)?.message ?? e))) return null
        throw e
      }
    },
  }
  let session: Session | null = null
  const flight: number[] = [] // ids of the requests in flight, oldest (the one the worker runs) first
  const baseline = new Map<number, number>() // id -> pendingCalls() when the request started (R9: calls above it are its own)
  const quiet = new Map<number, { slow: boolean; timer: ReturnType<typeof setTimeout> }>() // R4: quiet calls in flight (expression calls), with their start
  let seq = 0
  let killTimer: { id: number; handle: ReturnType<typeof setTimeout> } | null = null // R6: one at most
  let stuck = false // test hook: the next interrupt is not delivered
  const restartSubs = new Set<() => void>()
  let since: number | null = null
  let lines: string[] = []
  const subs = new Set<() => void>()
  const logSubs = new Set<(line: string) => void>()
  const notify = () => subs.forEach((f) => f())

  function pushLog(text: string): void {
    for (const line of text.replace(/\n$/, '').split('\n')) {
      lines.push(line)
      if (lines.length > LOG_MAX) lines.shift()
      logSubs.forEach((f) => f(line))
    }
  }

  function start(): Session {
    const memory = createBridgeMemory()
    const interrupt = new SharedArrayBuffer(4)
    const worker = createWorker()
    let resolveReady!: () => void
    let rejectReady!: (e: Error) => void
    const whenReady = new Promise<void>((res, rej) => { resolveReady = res; rejectReady = rej })
    let kill!: (e: Error) => void
    const dead = new Promise<never>((_, rej) => { kill = rej })
    dead.catch(() => {}); whenReady.catch(() => {})
    const server = new BridgeServer(memory, (m: HostToWorker) => worker.postMessage(m), (method, args) => {
      const h = handlers[method]
      return h ? h(args) : Promise.reject(Object.assign(new Error(`unknown bridge method ${method}`), { code: 'unknownMethod' }))
    })
    const s: Session = {
      worker, server, interrupt, ready: false, whenReady, dead,
      end(reason) {
        if (session !== s) return
        session = null
        worker.terminate()
        rejectReady(reason); kill(reason)
        flight.length = 0; baseline.clear(); since = null
        quiet.forEach((q) => clearTimeout(q.timer)); quiet.clear()
        clearKill()
        notify()
      },
    }
    worker.onmessage = (e: MessageEvent<WorkerToHost>) => {
      if (session !== s) return
      const m = e.data
      if (m.t === 'ready') { s.ready = true; resolveReady(); notify() }
      else if (m.t === 'stdout') pushLog(m.text)
      else if (m.t === 'loadError') s.end(new Error(m.message))
      else server.onWorkerMessage(m)
    }
    worker.onerror = (e: ErrorEvent) => s.end(new Error(e.message || 'python worker crashed'))
    worker.postMessage({ t: 'init', memory, interrupt, baseUrl: PYTHON_BASE_URL, lib: LIB_FILES } satisfies HostToWorker)
    return s
  }

  function clearKill(): void { if (killTimer) { clearTimeout(killTimer.handle); killTimer = null } }

  function ensure(): Promise<void> {
    if (!session) { session = start(); notify() }
    return session.whenReady
  }

  async function send(req: HostRequest, isQuiet = false): Promise<unknown> {
    await ensure()
    const s = session
    if (!s) throw new Error('bc:pythonRestarted') // restart() or a crash ran while ensure() waited
    const id = ++seq
    baseline.set(id, s.server.pendingCalls())
    if (isQuiet) { const q = { slow: false, timer: setTimeout(() => { q.slow = true; notify() }, SLOW_MS) }; quiet.set(id, q) } // crossing 2 s makes the host busy
    // R6/R9: a new top-level call starts with a clean cell (a stale 2 must not hit it); an interrupt sent later, even before the worker dequeues the request, stays.
    if (flight.length === 0) Atomics.store(new Int32Array(s.interrupt), 0, 0)
    if (flight.push(id) === 1) { since = Date.now(); notify() }
    try {
      return await Promise.race([s.server.request(req), s.dead])
    } catch (e) {
      throw e && typeof e === 'object' && 'traceback' in e ? new PythonError(e as PyError) : e
    } finally {
      if (session === s) {
        flight.splice(flight.indexOf(id), 1)
        baseline.delete(id)
        const q = quiet.get(id)
        if (q) { clearTimeout(q.timer); quiet.delete(id); if (flight.length > 0) notify() }
        if (killTimer?.id === id) clearKill()
        if (flight.length === 0) { since = null; notify() }
      }
    }
  }

  const gated = (req: HostRequest, isQuiet = false): Promise<unknown> =>
    contentEnabled() ? send(req, isQuiet) : Promise.reject(new Error('bc:contentDisabled')) // R9

  function restart(): void { session?.end(new Error('bc:pythonRestarted')) }

  return {
    configure(o: { contentEnabled: () => boolean; createWorker?: () => Worker }): void {
      contentEnabled = o.contentEnabled
      if (o.createWorker) createWorker = o.createWorker
    },
    contentEnabled: (): boolean => contentEnabled(),
    registerHandlers(h: Record<string, BridgeHandler>): void { Object.assign(handlers, h) },
    ensure,
    immediate: (line: string) => gated({ op: 'immediate', line }) as Promise<string>,
    exec: async (code: string) => { await gated({ op: 'exec', code }) },
    call: (module: string, fn: string, args: unknown[], opts?: { quiet?: boolean }) => gated({ op: 'call', module, fn, args }, !!opts?.quiet),
    exports: (source: string) => send({ op: 'exports', source }) as Promise<ExportsResult>,
    reset: async () => { await send({ op: 'reset' }) },
    /** R6: asks Python to stop; a call still running 2 s later costs the worker (restarted by the next need). */
    interrupt(): void {
      const s = session
      if (!s || flight.length === 0) return
      if (stuck) stuck = false
      else Atomics.store(new Int32Array(s.interrupt), 0, 2)
      // R9: the innermost call (a dialog's button while the caller waits on the bridge); else the one the worker runs (queued ones come later)
      const target = s.server.pendingCalls() > 0 ? flight[flight.length - 1]! : flight[0]!
      if (killTimer?.id === target) return
      clearKill() // re-target: a newer innermost call started since the timer was armed
      const arm = (id: number): void => {
        killTimer = { id, handle: setTimeout(() => {
          killTimer = null
          if (session !== s || !flight.includes(id)) return
          // the call has a bridge call of its own pending (above its baseline): parked, responsive, wait on
          if (s.server.pendingCalls() > (baseline.get(id) ?? 0)) arm(id)
          else { pushLog('python.restarted'); restart(); restartSubs.forEach((f) => f()) }
        }, INTERRUPT_GRACE_MS) }
      }
      arm(target)
    },
    /** Test hook (e2e): the next interrupt does not reach Python, so the 2 s restart path can be exercised. */
    simulateStuck(): void { stuck = true },
    /** Fired when a call ignored the interrupt and the worker was terminated (R6): the window tells the user. */
    onRestart(fn: () => void): () => void { restartSubs.add(fn); return () => { restartSubs.delete(fn) } },
    restart,
    state: (): PythonState => (!session ? 'off' : !session.ready ? 'loading' : flight.length > 0 ? 'running' : 'idle'),
    /** R4: a non-quiet call in flight, or a quiet one running for 2 s or more: the window stands back (veil, inert). */
    busy: (): boolean => flight.some((id) => !quiet.has(id)) || [...quiet.values()].some((q) => q.slow),
    subscribe(fn: () => void): () => void { subs.add(fn); return () => { subs.delete(fn) } },
    runningSince: (): number | null => since,
    log: (): readonly string[] => lines,
    onLog(fn: (line: string) => void): () => void { logSubs.add(fn); return () => { logSubs.delete(fn) } },
  }
}

export type PythonHost = ReturnType<typeof createPythonHost>

declare global { interface Window { __bcPython?: PythonHost } }

let instance: PythonHost | null = null
/** The window's host. */
export function pythonHost(): PythonHost { return (instance ??= createPythonHost()) }
