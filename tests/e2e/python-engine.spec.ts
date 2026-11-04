// D1 Task 6: the Python engine in the renderer — worker under its CSP, offline numpy/pandas, a refused network, real nesting.
import { test, expect, type Page } from '@playwright/test'
import { saveObject } from '../../src/main/db/objects'
import { readdirSync } from 'node:fs'
import { join } from 'node:path'
import { seedBase, launchApp } from './helpers'

// the page's test hook (renderer/python/python-host.ts), typed here: the node project cannot compile the renderer's sources
type Host = {
  immediate(line: string): Promise<string>; interrupt(): void; state(): string; log(): readonly string[]
  registerHandlers(h: Record<string, (args: unknown[]) => Promise<unknown>>): void
}
type W = { __bcPython: Host }
const imm = (page: Page, line: string) => page.evaluate((l) => (window as unknown as W).__bcPython.immediate(l), line)
const logLines = (page: Page) => page.evaluate(() => [...(window as unknown as W).__bcPython.log()])
const rejection = async (page: Page, line: string) =>
  page.evaluate(async (l) => { try { await (window as unknown as W).__bcPython.immediate(l); return null } catch (e) { return String((e as Error).message) } }, line)

test('Python engine: arithmetic, numpy and pandas offline, network and package installs refused, big values, real nesting, worker CSP', async () => {
  test.setTimeout(180_000)
  const { app, page } = await launchApp({ args: [seedBase('python', (db) => {
    // an unsafe macro action makes the base carry active content: enabled here (trusted temporary folder)
    for (const [kind, name, def] of [
      ['macro', 'MSql', { formatVersion: '1.0', items: [{ k: 'action', action: 'RunSQL', args: { SQLStatement: 'DELETE FROM T;' } }] }],
      ['module', 'helper', { formatVersion: '1.0', source: 'def f(x):\n    return x + 1\n' }],
    ] as const) {
      const r = saveObject(db, kind, name, def, null)
      if (!r.ok) throw new Error(r.reason)
    }
  })] })
  try {
    await expect.poll(() => page.evaluate(() => (window as unknown as { basecraft: { base: { state(): Promise<{ content?: string } | null> } } }).basecraft.base.state().then((s) => s?.content)))
      .toBe('enabled')
    expect(await imm(page, '?2+2')).toBe('4')

    await imm(page, 'import numpy; print(numpy.arange(3).sum())')
    expect(await logLines(page)).toContain('3')

    await imm(page, 'import pandas as pd')
    expect(await imm(page, '?pd.Series([1, 2]).sum()')).toBe('3')

    // js.fetch only returns a promise (Immediate cannot await it): a synchronous XMLHttpRequest shows the same CSP refusal as a rejection
    expect(await rejection(page, 'import js; x = js.XMLHttpRequest.new(); x.open("GET", "https://example.com", False); x.send()')).toMatch(/NetworkError|Failed to execute|Failed to fetch/i)
    // scipy is not in the trimmed lock: loadPackagesFromImports skips it and the import fails
    expect(await rejection(page, 'import scipy')).toContain('scipy')
    expect(await imm(page, '?len("x"*5_000_000)')).toBe('5000000')

    // a user module comes from the base through modules.source; an unknown one is just not found
    expect(await imm(page, 'import helper')).toBe('')
    expect(await imm(page, '?helper.f(1)')).toBe('2')
    expect(await rejection(page, 'import nothere')).toContain('nothere')

    // a Python error comes back described
    const err = await page.evaluate(async () => { try { await (window as unknown as W).__bcPython.immediate('?1/0'); return null } catch (e) { return (e as { info: { type: string } }).info.type } })
    expect(err).toBe('ZeroDivisionError')

    // nesting: Python calls a host handler, which runs Python again while Python waits
    await page.evaluate(() => {
      const h = (window as unknown as W).__bcPython
      h.registerHandlers({ 'test.nest': async ([x]) => Number(await h.immediate(`?${x}*2`)) })
    })
    await imm(page, 'import basecraft; r = basecraft.call("test.nest", [21])')
    expect(await imm(page, '?r')).toBe('42')

    // the emitted worker chunk is served under its CSP (a worker's own script is not in the page's resource timing: name it from the build)
    const chunk = readdirSync(join(__dirname, '../../out/renderer/assets')).find((f) => /^python-worker-[\w-]+\.js$/.test(f))
    expect(chunk).toBeTruthy()
    const csp = await page.evaluate(async (f) => (await fetch(`bc-app://app/assets/${f}`)).headers.get('content-security-policy'), chunk)
    expect(csp).toBe("default-src 'none'; script-src 'self' 'wasm-unsafe-eval'; connect-src 'self'")

    // R6: an interrupt stops a loop; one that swallows it costs the worker, which restarts on the next call
    const stopped = await page.evaluate(async () => {
      const h = (window as unknown as W).__bcPython
      const p = h.immediate('while True: pass').then(() => 'ended', (e: { info?: { type: string } }) => e.info?.type ?? String(e))
      await new Promise((r) => setTimeout(r, 300))
      h.interrupt()
      return p
    })
    expect(stopped).toBe('KeyboardInterrupt')
    expect(await imm(page, '?1+1')).toBe('2')
    const swallowed = await page.evaluate(async () => {
      const h = (window as unknown as W).__bcPython
      const p = h.immediate(String.raw`exec("while 1:\n try:\n  while 1: pass\n except BaseException: pass")`).then(() => 'ended', () => 'rejected')
      await new Promise((r) => setTimeout(r, 300))
      h.interrupt()
      return { result: await p, state: h.state(), log: [...h.log()] }
    })
    expect(swallowed.result).toBe('rejected')
    expect(swallowed.state).toBe('off')
    expect(swallowed.log).toContain('python.restarted')
    expect(await imm(page, '?2+2')).toBe('4')
  } finally {
    await app.close()
  }
})
