// D1 Task 8: Python running in the window — message and input boxes, veil, Ctrl+Break, restart notice, disabled content.
import { test, expect, type Page } from '@playwright/test'
import { saveObject } from '../../src/main/db/objects'
import { seedBase, launchApp } from './helpers'

type Host = { immediate(line: string): Promise<string>; interrupt(): void; state(): string; simulateStuck(): void }
type W = { __bcPython: Host }
const seed = (name: string) => seedBase(name, (db) => {
  const r = saveObject(db, 'module', 'helper', { formatVersion: '1.0', source: 'def f(x):\n    return x + 1\n', exports: [{ name: 'f', params: ['x'] }] }, null)
  if (!r.ok) throw new Error(r.reason)
})
/** Starts an immediate line without awaiting it; its outcome lands in window.__out. */
const start = (page: Page, line: string) => page.evaluate((l) => {
  const w = window as unknown as W & { __out?: string }
  w.__out = undefined
  w.__bcPython.immediate(l).then((v) => { w.__out = 'ok:' + v }, (e: { info?: { type: string }; message: string }) => { w.__out = 'err:' + (e.info?.type ?? e.message) })
}, line)
const outcome = (page: Page) => page.evaluate(() => (window as unknown as { __out?: string }).__out)

test('Python run: boxes, veil, Ctrl+Break, restart notice', async () => {
  test.setTimeout(180_000)
  const { app, page } = await launchApp({ args: [seed('python-run')], env: { BASECRAFT_REGION: 'fr-FR' } }) // French boxes on any runner
  try {
    await expect(page.getByTestId('nav-item-module-helper')).toBeVisible()
    // no active content: 'none' runs what the designer types, and the module needs no macro

    await start(page, '?msgbox("Continuer ?", "yes_no")')
    await expect(page.getByTestId('macro-msgbox-yes')).toHaveText('Oui')
    await expect(page.getByTestId('macro-msgbox-no')).toHaveText('Non')
    await page.getByTestId('macro-msgbox-no').click()
    await expect.poll(() => outcome(page), { timeout: 60_000 }).toBe('ok:no')

    await start(page, '?inputbox("Nom ?")')
    await page.getByTestId('modal-input').fill('Ana')
    await page.getByTestId('modal-btn-ok').click()
    await expect.poll(() => outcome(page)).toBe('ok:Ana')
    await start(page, '?inputbox("Nom ?")')
    await page.getByTestId('modal-btn-cancel').click()
    await expect.poll(() => outcome(page)).toBe('ok:None')

    // the veil: after 2 s the button shows, the window is inert, Ctrl+Break interrupts
    await start(page, 'while True: pass')
    await expect(page.getByTestId('python-interrupt')).toBeVisible({ timeout: 10_000 })
    await page.getByTestId('nav-item-module-helper').dblclick({ force: true })
    await expect(page.getByTestId('module-editor')).toHaveCount(0)
    // global shortcuts are dead during a run: F11 leaves the Navigation Pane alone, Ctrl+S does nothing
    const navBefore = await page.getByTestId('nav-item-module-helper').isVisible()
    await page.keyboard.press('F11')
    await page.keyboard.press('Control+s')
    await page.waitForTimeout(500)
    expect(await page.getByTestId('nav-item-module-helper').isVisible()).toBe(navBefore)
    expect(await page.evaluate(() => (window as unknown as W).__bcPython.state())).toBe('running')
    await page.keyboard.press('Control+Pause')
    await expect.poll(() => outcome(page)).toBe('err:KeyboardInterrupt')
    await expect(page.getByTestId('python-veil')).toHaveCount(0)
    await page.getByTestId('nav-item-module-helper').dblclick()
    await expect(page.getByTestId('module-editor')).toBeVisible()

    // the button interrupts too
    await start(page, 'while True: pass')
    await page.getByTestId('python-interrupt').click({ timeout: 10_000 })
    await expect.poll(() => outcome(page)).toBe('err:KeyboardInterrupt')

    // a worker that ignores the interrupt is restarted 2 s later, and the user is told
    await page.evaluate(() => (window as unknown as W).__bcPython.simulateStuck())
    await start(page, 'while True: pass')
    await expect(page.getByTestId('python-interrupt')).toBeVisible({ timeout: 10_000 })
    await page.getByTestId('python-interrupt').click()
    await expect(page.getByTestId('modal')).toContainText('Python ne répondait plus', { timeout: 10_000 })
    await page.getByTestId('modal-btn-ok').click()
    await expect.poll(() => outcome(page)).toBe('err:bc:pythonRestarted')
    await start(page, '?1+1')
    await expect.poll(() => outcome(page), { timeout: 60_000 }).toBe('ok:2')
  } finally {
    await app.close()
  }
})

test('Python run: Ctrl+Break while packages load interrupts the run and leaves no stale interrupt (R9)', async () => {
  test.setTimeout(180_000)
  const { app, page } = await launchApp({ args: [seed('python-interrupt-load')] })
  try {
    await expect.poll(() => page.evaluate(() => (window as unknown as W).__bcPython.state()), { timeout: 60_000 }).toBe('idle') // engine up: the call is in flight at once
    await start(page, 'import pandas as pd') // pandas loads for seconds
    await page.waitForTimeout(200)
    await page.evaluate(() => (window as unknown as W).__bcPython.interrupt())
    await expect.poll(() => outcome(page), { timeout: 60_000 }).toBe('err:KeyboardInterrupt')
    await start(page, '?1')
    await expect.poll(() => outcome(page), { timeout: 60_000 }).toBe('ok:1')
  } finally {
    await app.close()
  }
})

test('Python run: a trusted base with a module pre-warms the engine without any Python call', async () => {
  test.setTimeout(120_000)
  const { app, page } = await launchApp({ args: [seed('python-prewarm')] })
  try {
    await expect(page.getByTestId('nav-item-module-helper')).toBeVisible()
    await expect.poll(() => page.evaluate(() => (window as unknown as W).__bcPython.state()), { timeout: 10_000 }).toBe('idle')
  } finally {
    await app.close()
  }
})

test('Python run: disabled content blocks calls, creates no worker, and « Activer le contenu » unblocks without reopening', async () => {
  test.setTimeout(180_000)
  const { app, page } = await launchApp({ args: [seed('python-untrusted')], untrusted: true })
  try {
    await expect(page.getByTestId('banner-enable-content')).toBeVisible()
    const r = await page.evaluate(async () => {
      const h = (window as unknown as W).__bcPython
      try { await h.immediate('?1'); return { err: null, state: h.state() } } catch (e) { return { err: (e as Error).message, state: h.state() } }
    })
    expect(r).toEqual({ err: 'bc:contentDisabled', state: 'off' })
    await page.waitForTimeout(8000) // the pre-warm (2 s + idle) must not start a worker for disabled content
    expect(await page.evaluate(() => (window as unknown as W).__bcPython.state())).toBe('off')
    await page.getByTestId('banner-enable-content').click()
    await expect(page.getByTestId('banner-enable-content')).toHaveCount(0)
    await expect.poll(() => page.evaluate(() => (window as unknown as W).__bcPython.immediate('?1')), { timeout: 60_000 }).toBe('1')
  } finally {
    await app.close()
  }
})
