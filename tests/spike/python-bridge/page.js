// Page side of the spike: drives workers A and B through the cases, answers bridge() calls.
const CH = 1 << 20 // 1 MiB data area
const TIMEOUT = 15000
const LONG = { C2: 80000, C4: 90000 }
const enc = new TextEncoder()

const PRELUDE = `
import json, time
def bridge(m, p=None):
    return json.loads(_bridge(m, json.dumps(p)))
def f(n):
    return 1 if n <= 0 else n * 10 + bridge('nest', n - 1)
`

// Python snippets (each returns a JSON string)
const CASES = {
  C1: `
t = time.perf_counter()
for i in range(1000):
    assert bridge('echo', i) == i
json.dumps((time.perf_counter() - t) * 1000 / 1000)`,
  C2: `
t = time.perf_counter()
for i in range(100):
    assert bridge('ask', i) == 'yes:%d' % i
json.dumps((time.perf_counter() - t) * 1000)`,
  C3: `json.dumps(bridge('nest', 2))`,
  C4: `
import numpy as np
v = np.vectorize(lambda x: bridge('echo', int(x)))
json.dumps(v(np.arange(10)).tolist())`,
  C5: `
try:
    while True: pass
except KeyboardInterrupt:
    r = 'KI'
json.dumps(r)`,
  C6: `
n = 0
try:
    while True:
        bridge('echo', n); n += 1
except KeyboardInterrupt:
    r = 'KI'
json.dumps(r)`,
  C7: `
s = bridge('big')
json.dumps([len(s), s[:3], s[-3:]])`
}

class Variant {
  constructor(name) { this.name = name }
  async start() {
    this.ctrl = new Int32Array(new SharedArrayBuffer(16))
    this.data = new Uint8Array(new SharedArrayBuffer(CH))
    this.intr = new Int32Array(new SharedArrayBuffer(4))
    this.moreFn = null
    this.callWait = {}
    this.w = new Worker(`worker-${this.name.toLowerCase()}.js`)
    this.w.onmessage = (e) => this.onMsg(e.data)
    this.w.onerror = (e) => { if (this.runWait) this.runWait.rej(new Error('worker error: ' + e.message)) }
    const ready = new Promise((res, rej) => (this.runWait = { res, rej }))
    this.w.postMessage({ type: 'init', ctrl: this.ctrl, data: this.data, intr: this.intr, prelude: PRELUDE })
    return this.timed(ready, 'init')
  }
  timed(p, what) {
    const t = LONG[what] || TIMEOUT
    return Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error("timeout " + what)), t))])
  }
  run(code, loadNumpy) {
    const p = new Promise((res, rej) => (this.runWait = { res, rej }))
    this.w.postMessage({ type: 'run', code, loadNumpy })
    return p
  }
  onMsg(m) {
    if (m.type === 'bridge') this.handle(m)
    else if (m.type === 'more') this.moreFn && this.moreFn()
    else if (m.type === 'callresult') this.callWait[m.id](m.value)
    else if (m.type === 'ready' || m.type === 'done') this.runWait.res(m)
    else if (m.type === 'fail') this.runWait.rej(new Error(m.error))
  }
  // B replies by plain message; A by shared buffer (chunked)
  reply(id, obj) {
    if (this.name === 'B') return this.w.postMessage({ type: 'reply', id, obj })
    const bytes = enc.encode(JSON.stringify(obj))
    let off = 0
    const next = () => {
      const n = Math.min(CH, bytes.length - off)
      this.data.set(bytes.subarray(off, off + n))
      off += n
      this.ctrl[1] = n
      this.ctrl[2] = off < bytes.length ? 1 : 0
      Atomics.store(this.ctrl, 0, 1)
      Atomics.notify(this.ctrl, 0)
    }
    this.moreFn = next
    next()
  }
  callPy(id, fn, args) {
    const p = new Promise((res) => (this.callWait[id] = res))
    this.reply(id, { call: fn, args })
    return p
  }
  async handle({ id, method, payload }) {
    await new Promise((r) => setTimeout(r, 0))
    const p = JSON.parse(payload)
    let value
    if (method === 'echo') value = p
    else if (method === 'ask') { await new Promise((r) => setTimeout(r, 300)); value = 'yes:' + p }
    else if (method === 'nest') value = JSON.parse(await this.callPy(id, 'f', [p]))
    else if (method === 'big') value = 'x'.repeat(5 * 1024 * 1024 - 3) + 'END'
    this.reply(id, { ret: value })
  }
  stop() { this.w && this.w.terminate() }
}

async function runCase(v, name) {
  const t0 = performance.now()
  let timer = null
  try {
    if (name === 'C5' || name === 'C6') timer = setTimeout(() => { v.tInt = performance.now(); Atomics.store(v.intr, 0, 2) }, 300)
    const m = await v.timed(v.run(CASES[name], name === 'C4'), name)
    const ms = performance.now() - t0
    const out = JSON.parse(m.value)
    if (name === 'C1') return { ok: typeof out === 'number', ms: out, note: 'mean ms/call' }
    if (name === 'C2') return { ok: out > 100 * 300 && out < 100 * 360, ms: out, note: 'total ms for 100 asks (floor 30000)' }
    if (name === 'C3') return { ok: out === 31, ms, note: 'result ' + out }
    if (name === 'C4') return { ok: JSON.stringify(out) === JSON.stringify([...Array(10).keys()]), ms, note: JSON.stringify(out) + ' (includes numpy load)' }
    if (name === 'C5' || name === 'C6') { const lat = performance.now() - v.tInt; return { ok: out === 'KI' && lat < 500, ms: lat, note: 'ms from interrupt to KeyboardInterrupt, result ' + out } }
    if (name === 'C7') return { ok: out[0] === 5 * 1024 * 1024 && out[1] === 'xxx' && out[2] === 'END', ms, note: JSON.stringify(out) }
  } catch (e) {
    return { ok: false, ms: performance.now() - t0, note: String((e && e.message) || e), restart: true }
  } finally {
    clearTimeout(timer)
    Atomics.store(v.intr, 0, 0)
  }
}

;(async () => {
  const names = ['C1', 'C2', 'C3', 'C4', 'C5', 'C6', 'C7']
  const rows = [{ case: 'init', A: {}, B: {} }, ...names.map((c) => ({ case: c, A: {}, B: {} }))]
  const vs = { A: new Variant('A'), B: new Variant('B') }
  for (const k of ['A', 'B']) {
    try { await vs[k].start(); rows[0][k] = { ok: true, ms: 0, note: 'loaded' } }
    catch (e) { rows[0][k] = { ok: false, ms: 0, note: String(e.message || e) } }
  }
  for (const k of ['A', 'B']) {
    for (let i = 0; i < names.length; i++) {
      if (!rows[0][k].ok) { rows[i + 1][k] = { ok: false, ms: 0, note: 'init failed' }; continue }
      const r = await runCase(vs[k], names[i])
      rows[i + 1][k] = r
      if (r.restart) { vs[k].stop(); try { await vs[k].start() } catch (e) { r.note += " [restart failed]"; for (let j = i + 1; j < names.length; j++) rows[j + 1][k] = { ok: false, ms: 0, note: "worker unrecoverable after " + names[i] }; break } }
    }
    vs[k].stop()
  }
  window.__spikeResults = rows
  window.__spikeDone = true
})()
