# Python bridge spike, 2026-11-03

Electron 44.9.3 (Chromium 152), Pyodide 314.0.7, worker under COOP `same-origin` + COEP `require-corp`, window hidden. Raw data: `results.json`. Run: `npx electron tests/spike/python-bridge/main.cjs` (unset `ELECTRON_RUN_AS_NODE` first).

| Case | A: SharedArrayBuffer + Atomics.wait | B: JSPI (`run_sync`) |
|---|---|---|
| init (load Pyodide) | ok | ok |
| C1 1 000 `echo`, mean round trip | ok, **0.111 ms** | ok, **0.166 ms** |
| C2 100 x `ask` (300 ms answers) | ok, 30 661 ms total | ok, 30 605 ms total |
| C3 nested 3 levels (expected 31) | ok, 31 | ok, 31 |
| C4 `numpy.vectorize` calling bridge, 10 values | ok (0.8 s incl. numpy load) | ok (0.6 s incl. numpy load) |
| C5 interrupt `while True: pass` | ok, 0.5 ms | ok, 0.9 ms |
| C6 interrupt during bridge loop | ok, 0.1 ms | **FAIL**: no `KeyboardInterrupt` within 15 s (timeout) |
| C7 5 MB string reply | ok, 64 ms | ok, 109 ms |

(C5/C6 latency = time from writing 2 into the interrupt buffer to the page receiving the result; it includes the page's 300 ms delay only before the write.)

## CSP that worked

Worker CSP: `default-src 'none'; script-src 'self' 'wasm-unsafe-eval'; connect-src 'self' https://cdn.jsdelivr.net`. Pyodide loaded without `'unsafe-eval'` (the retry path was not taken). The jsDelivr entry is only for `loadPackage('numpy')` (C4, `packageBaseUrl` = `https://cdn.jsdelivr.net/pyodide/v314.0.7/full/`); core files came from the local scheme. The production CSP needs no CDN entry.

## Decision (rule: A if all pass, else B, else stop)

**A.** It passes every case; B fails C6.
