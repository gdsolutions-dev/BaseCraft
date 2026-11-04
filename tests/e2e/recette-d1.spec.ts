// Recette D1 (UI only): modules importing each other, the Immediate window, numpy/pandas offline, msgbox, Ctrl+Break,
// no network, and the modules back after a reopen. Also logs the renderer's private memory (R10 pre-warm decision).
import { test, expect, type ElectronApplication, type Page } from '@playwright/test'
import { launchApp, seedBase } from './helpers'

const FR = { BASECRAFT_REGION: 'fr-FR' }
const editor = (page: Page) => page.locator('[data-testid="module-editor"]:visible')

async function createModule(page: Page, name: string, lines: string[]) {
  await page.getByTestId('ribbon-tab-create').click()
  await page.getByTestId('cmd-createModule').click()
  await expect(editor(page)).toBeVisible()
  await editor(page).locator('.cm-content').click()
  for (const [i, l] of lines.entries()) {
    if (i) await page.keyboard.press('Enter')
    await page.keyboard.type(l)
  }
  await page.keyboard.press('Control+s')
  await page.getByTestId('modal-input').fill(name)
  await page.getByTestId('modal-btn-ok').click()
  await expect(page.getByTestId(`nav-item-module-${name}`)).toBeVisible()
}

/** Renderer (Tab) private memory in MB; Python's worker lives in the renderer process. */
const rendererMb = (app: ElectronApplication) =>
  app.evaluate(({ app }) => app.getAppMetrics().filter((m) => m.type === 'Tab').reduce((s, m) => s + (m.memory.privateBytes ?? 0), 0) / 1024)
  .then((n) => Math.round(n))

test('Recette D1: modules, Immediate window, numpy/pandas, msgbox, Ctrl+Break, no network, reopen', async () => {
  test.setTimeout(420_000)
  const base = seedBase('recette-d1')
  let { app, page } = await launchApp({ args: [base], env: FR })
  try {
    const mem: Record<string, number> = { beforePython: await rendererMb(app) }
    await createModule(page, 'Outils', ['def double(x):', 'return x * 2'])
    await createModule(page, 'Calcul', ['import Outils', 'def quadruple(x):', 'return Outils.double(Outils.double(x))'])

    await page.keyboard.press('Control+g')
    const input = page.getByTestId('immediate-input')
    const log = page.getByTestId('immediate-log')
    const run = async (line: string) => { await expect(input).toBeEnabled({ timeout: 180_000 }); await input.fill(line); await input.press('Enter') }
    const line = (re: RegExp) => log.locator('.immediate-line', { hasText: re })

    await run('import Calcul')
    await run('?Calcul.quadruple(5)')
    await expect(line(/^20$/)).toHaveCount(1, { timeout: 180_000 })
    mem.afterCore = await rendererMb(app)
    await run('?2+2')
    await expect(line(/^4$/)).toHaveCount(1)

    await run('import numpy')
    await run('?numpy.arange(4).sum()')
    await expect(line(/^6$/)).toHaveCount(1, { timeout: 120_000 })

    await run('?msgbox("OK ?", "ok_cancel")')
    await expect(page.getByTestId('macro-msgbox-cancel')).toHaveText('Annuler')
    await page.getByTestId('macro-msgbox-cancel').click()
    await expect(line(/^cancel$/)).toHaveCount(1, { timeout: 60_000 })

    await run('while True: pass')
    await expect(page.getByTestId('python-interrupt')).toBeVisible({ timeout: 10_000 })
    await page.keyboard.press('Control+Pause')
    await expect(log).toContainText('KeyboardInterrupt', { timeout: 30_000 })

    // network refusal: `import js` alone is clean, then a synchronous request (the Immediate window cannot await js.fetch) is refused
    const errCount = () => log.locator('.immediate-line', { hasText: /Error/ }).count()
    const before = await errCount()
    await run('import js')
    await expect(input).toBeEnabled()
    expect(await errCount()).toBe(before)
    await run('x = js.XMLHttpRequest.new(); x.open("GET", "https://example.com", False); x.send()')
    await expect(log).toContainText(/NetworkError|Failed to execute|Failed to fetch/i, { timeout: 60_000 })

    await run('import pandas')
    await run('?pandas.Series([1, 2, 3]).sum()')
    await expect(line(/^6$/)).toHaveCount(2, { timeout: 120_000 })
    mem.afterPandas = await rendererMb(app)
    console.log('RENDERER_MEMORY_MB', JSON.stringify(mem))

    // close and reopen: the modules are listed, their text is back, the import chain works
    await app.close()
    ;({ app, page } = await launchApp({ args: [base], env: FR }))
    await expect(page.getByTestId('nav-item-module-Outils')).toBeVisible()
    await expect(page.getByTestId('nav-item-module-Calcul')).toBeVisible()
    await page.keyboard.press('Control+g')
    const input2 = page.getByTestId('immediate-input')
    await expect(input2).toBeEnabled()
    await input2.fill('import Calcul'); await input2.press('Enter')
    await expect(input2).toBeEnabled({ timeout: 180_000 })
    await input2.fill('?Calcul.quadruple(1)'); await input2.press('Enter')
    await expect(page.getByTestId('immediate-log').locator('.immediate-line', { hasText: /^4$/ })).toHaveCount(1, { timeout: 180_000 })
  } finally {
    await app.close()
  }
})
