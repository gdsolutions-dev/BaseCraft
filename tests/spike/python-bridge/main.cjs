// Throwaway spike (Task 1, stage D1): bridge A (SharedArrayBuffer + Atomics.wait) vs B (JSPI).
// Run: npx electron tests/spike/python-bridge/main.cjs
const { app, BrowserWindow, protocol, net } = require('electron')
const path = require('node:path')
const fs = require('node:fs')
const { pathToFileURL } = require('node:url')

protocol.registerSchemesAsPrivileged([
  { scheme: 'spike', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true } }
])

const SPIKE = __dirname
const PYODIDE = path.join(__dirname, '..', '..', '..', 'node_modules', 'pyodide')
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.wasm': 'application/wasm', '.json': 'application/json', '.zip': 'application/zip' }
let unsafeEval = false

function register() {
  protocol.handle('spike', async (req) => {
    const u = new URL(req.url)
    const rel = decodeURIComponent(u.pathname)
    let file
    if (rel.startsWith('/pyodide/')) file = path.join(PYODIDE, rel.slice('/pyodide/'.length))
    else file = path.join(SPIKE, rel === '/' ? 'page.html' : rel)
    if (!fs.existsSync(file)) return new Response('not found', { status: 404 })
    const r = await net.fetch(pathToFileURL(file).toString())
    const headers = new Headers({
      'content-type': MIME[path.extname(file)] || 'application/octet-stream',
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
      'Cross-Origin-Resource-Policy': 'same-origin'
    })
    if (/worker-[^/\\]*\.js$/.test(file)) {
      headers.set('Content-Security-Policy',
        `default-src 'none'; script-src 'self' 'wasm-unsafe-eval'${unsafeEval ? " 'unsafe-eval'" : ''}; connect-src 'self' https://cdn.jsdelivr.net`)
    }
    return new Response(r.body, { status: 200, headers })
  })
}

async function runOnce(mode) {
  unsafeEval = mode === 'unsafe-eval'
  const win = new BrowserWindow({ show: false, webPreferences: { contextIsolation: true } })
  await win.loadURL('spike://s/page.html')
  const t0 = Date.now()
  while (Date.now() - t0 < 300000) {
    const done = await win.webContents.executeJavaScript('window.__spikeDone === true')
    if (done) break
    await new Promise((r) => setTimeout(r, 500))
  }
  const res = await win.webContents.executeJavaScript('JSON.stringify(window.__spikeResults)')
  win.destroy()
  return JSON.parse(res)
}

app.setPath('userData', path.join(require('node:os').tmpdir(), 'bc-spike-ud'))
app.whenReady().then(async () => {
  register()
  let csp = "script-src 'self' 'wasm-unsafe-eval'"
  let res = await runOnce('strict')
  if (res.some((r) => r.case === 'init' && (!r.A.ok || !r.B.ok))) {
    console.log('init failed under strict CSP, retrying with unsafe-eval', JSON.stringify(res[0]))
    res = await runOnce('unsafe-eval')
    csp += " 'unsafe-eval' (needed)"
  } else csp += ' (unsafe-eval NOT needed)'
  const out = { date: new Date().toISOString(), csp, electron: process.versions.electron, chrome: process.versions.chrome, results: res }
  fs.writeFileSync(path.join(SPIKE, 'results.json'), JSON.stringify(out, null, 2))
  console.log(JSON.stringify(out, null, 2))
  app.quit()
})
