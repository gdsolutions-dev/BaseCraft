// Variant A: SharedArrayBuffer + Atomics.wait. A Python sync call blocks this worker until the page answers.
importScripts('/pyodide/pyodide.js')
const dec = new TextDecoder()
let py, ctrl, data, nextId = 1

function bridge(method, payload) {
  const id = nextId++
  postMessage({ type: 'bridge', id, method, payload })
  for (;;) {
    const parts = []
    for (;;) { // read one (possibly chunked) reply
      Atomics.wait(ctrl, 0, 0)
      const n = ctrl[1], more = ctrl[2]
      parts.push(data.slice(0, n)) // copy out of the shared area
      Atomics.store(ctrl, 0, 0)
      if (!more) break
      postMessage({ type: 'more', id })
    }
    const total = parts.reduce((a, p) => a + p.length, 0)
    const all = new Uint8Array(total)
    let o = 0
    for (const p of parts) { all.set(p, o); o += p.length }
    const r = JSON.parse(dec.decode(all))
    if (r.call) { // the page wants Python run (nested call), then keeps waiting for the final answer
      const v = py.globals.get('json').dumps(py.globals.get(r.call)(...r.args))
      postMessage({ type: 'callresult', id, value: v })
      continue
    }
    return JSON.stringify(r.ret)
  }
}

onmessage = async (e) => {
  const m = e.data
  try {
    if (m.type === 'init') {
      ctrl = m.ctrl; data = m.data
      py = await loadPyodide({ indexURL: '/pyodide/', packageBaseUrl: 'https://cdn.jsdelivr.net/pyodide/v314.0.7/full/' })
      py.setInterruptBuffer(m.intr)
      py.globals.set('_bridge', bridge)
      py.runPython(m.prelude)
      postMessage({ type: 'ready' })
    } else if (m.type === 'run') {
      if (m.loadNumpy) await py.loadPackage('numpy')
      postMessage({ type: 'done', value: py.runPython(m.code) })
    }
  } catch (err) { postMessage({ type: 'fail', error: String((err && err.message) || err) }) }
}
