import type { PyodideInterface } from 'pyodide'
import { SyncCaller, type HostRequest, type HostToWorker, type PyError, type WorkerToHost } from '../../shared/python/bridge'
import { installBasecraftLib } from './install-lib'

const ctx = self as unknown as { postMessage(m: WorkerToHost): void; onmessage: ((e: MessageEvent<HostToWorker>) => void) | null }
const post = (m: WorkerToHost): void => ctx.postMessage(m)

// One run: JSON in, JSON out ({ok, value} | {ok: false, error}); the Python exception is described inside Python (empty PythonError.message).
const RUNNER = `
import json, basecraft
def _bc_run(op, payload):
    try:
        p = json.loads(payload)
        if op == 'immediate': v = basecraft.immediate.run(p['line'])
        elif op == 'exec': exec(compile(p['code'], '<exec>', 'exec'), basecraft.immediate._ns); v = None
        elif op == 'exports': v = basecraft.exports.of(p['source'])
        elif op == 'deps': v = basecraft.modules.deps(p.get('code'), p.get('module'))
        elif op == 'call': v = basecraft.modules.call(p['module'], p['fn'], p['args'])
        else: basecraft.modules.reset(); v = None
        try: out = json.dumps({'ok': True, 'value': v}, default=str, allow_nan=False)
        except ValueError: out = json.dumps({'ok': True, 'value': str(v)})
        return out
    except BaseException as e:
        return json.dumps({'ok': False, 'error': basecraft.errors.describe(e)})
    finally:
        basecraft.flush()
`

let py: PyodideInterface
let run: (op: string, payload: string) => string
let interrupt: Int32Array

const payload = (r: HostRequest): string => { const { op: _, ...rest } = r; return JSON.stringify(rest) }
const failure = (e: unknown): PyError => ({ type: 'WorkerError', message: String((e as Error)?.message ?? e), module: null, line: null, traceback: String((e as Error)?.stack ?? e) })

let depth = 0 // nested runs (an event during a msgbox): only the outermost one owns the interrupt cell

function runSync(r: HostRequest): { ok: true; value: unknown } | { ok: false; error: PyError } {
  depth++
  try {
    return JSON.parse(run(r.op, payload(r)))
  } catch (e) {
    return { ok: false, error: failure(e) }
  } finally {
    if (--depth === 0) Atomics.store(interrupt, 0, 0) // a handled interrupt must not hit the next run
  }
}

const finish = (id: number, r: ReturnType<typeof runSync>): void => post(r.ok ? { t: 'done', id, ok: true, value: r.value } : { t: 'done', id, ok: false, error: r.error })

async function init(m: Extract<HostToWorker, { t: 'init' }>): Promise<void> {
  try {
    const { loadPyodide } = (await import(/* @vite-ignore */ m.baseUrl + 'pyodide.mjs')) as typeof import('pyodide')
    py = await loadPyodide({ indexURL: m.baseUrl, lockFileURL: m.baseUrl + 'pyodide-lock.json', stdout: (text) => post({ t: 'stdout', text }), stderr: (text) => post({ t: 'stdout', text }) })
    interrupt = new Int32Array(m.interrupt)
    py.setInterruptBuffer(interrupt)
    // A nested request cannot await: no package loading there (a top-level run loads them first).
    const caller = new SyncCaller(m.memory, post, (id, req) => finish(id, runSync(req)))
    py.registerJsModule('_bc_bridge', { call: (method: string, args: unknown[]) => caller.call(method, args) })
    installBasecraftLib(py, m.lib)
    py.runPython(RUNNER)
    run = py.globals.get('_bc_run') as typeof run
    post({ t: 'ready' })
  } catch (e) {
    post({ t: 'loadError', message: String((e as Error)?.message ?? e) })
  }
}

async function request(id: number, req: HostRequest): Promise<void> {
  try {
    // Packages load asynchronously, so before the run: a synchronous pre-pass lists what the code and the user modules it reaches import.
    if (req.op === 'exec' || req.op === 'immediate' || req.op === 'call') {
      const d = JSON.parse(run('deps', JSON.stringify(req.op === 'call' ? { module: req.module } : { code: req.op === 'exec' ? req.code : req.line })))
      if (d.ok && d.value.length) {
        // Pyodide would consume the interrupt inside its loader and the load would fail half-way: it watches a dummy cell meanwhile,
        // ours keeps the 2 for the check below.
        py.setInterruptBuffer(new Int32Array(new SharedArrayBuffer(4)))
        try { await py.loadPackagesFromImports('import ' + (d.value as string[]).join(', ')) } finally { py.setInterruptBuffer(interrupt) }
      }
    }
    if (Atomics.load(interrupt, 0) === 2) throw { type: 'KeyboardInterrupt' } // pressed during the pre-pass: report it, do not run
  } catch (e) {
    // An interrupt landing while packages load is consumed there: report it instead of running the code unstoppable.
    if ((e as { type?: string })?.type === 'KeyboardInterrupt') {
      Atomics.store(interrupt, 0, 0)
      return finish(id, { ok: false, error: { type: 'KeyboardInterrupt', message: '', module: null, line: null, traceback: 'KeyboardInterrupt' } })
    }
    // otherwise the run reports the failed import itself
  }
  finish(id, runSync(req))
}

ctx.onmessage = (e) => {
  const m = e.data
  if (m.t === 'init') void init(m)
  else void request(m.id, m.req)
}
