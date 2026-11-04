// Variant B: JSPI. bridge is an async JS function awaited from Python with run_sync; every entry via runPythonAsync.
importScripts('/pyodide/pyodide.js')
let py, nextId = 1
const waiting = {}

function bridge(method, payload) {
  const id = nextId++
  return new Promise((res) => {
    waiting[id] = res
    postMessage({ type: 'bridge', id, method, payload })
  })
}

onmessage = async (e) => {
  const m = e.data
  try {
    if (m.type === 'init') {
      py = await loadPyodide({ indexURL: '/pyodide/', packageBaseUrl: 'https://cdn.jsdelivr.net/pyodide/v314.0.7/full/' })
      py.setInterruptBuffer(m.intr)
      py.globals.set('_bridge_async', bridge)
      await py.runPythonAsync(`
from pyodide.ffi import run_sync
def _bridge(m, p):
    return run_sync(_bridge_async(m, p))
` + m.prelude)
      postMessage({ type: 'ready' })
    } else if (m.type === 'run') {
      if (m.loadNumpy) await py.loadPackage('numpy')
      postMessage({ type: 'done', value: await py.runPythonAsync(m.code) })
    } else if (m.type === 'reply') {
      const r = m.obj
      if (r.call) { // nested call into Python while the outer stack is suspended
        const v = await py.runPythonAsync(`json.dumps(${r.call}(${r.args.map((a) => JSON.stringify(a)).join(',')}))`)
        postMessage({ type: 'callresult', id: m.id, value: v })
      } else { const w = waiting[m.id]; delete waiting[m.id]; w(JSON.stringify(r.ret)) }
    }
  } catch (err) { postMessage({ type: 'fail', error: String((err && err.message) || err) }) }
}
