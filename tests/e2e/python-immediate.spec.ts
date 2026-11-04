// D1 Task 9: the Immediate window — Ctrl+G, ?expression, statements in a persistent namespace, errors, history,
// the specialKeys option, and the Runtime (no pane, no command).
import { test, expect } from '@playwright/test'
import { saveStartupOptions } from '../../src/main/db/startup'
import { DEFAULT_STARTUP } from '../../src/shared/startup'
import { SHIFT_GRACE_MS } from '../../src/renderer/shell/shift-key'
import { seedBase, launchApp } from './helpers'

const FR = { BASECRAFT_REGION: 'fr-FR' }
const seed = (name: string, specialKeys: boolean) => seedBase(name, (db) => { saveStartupOptions(db, { ...DEFAULT_STARTUP, specialKeys }) })

test('Immediate window: Ctrl+G, ?expression, statements, errors, history', async () => {
  test.setTimeout(180_000)
  const { app, page } = await launchApp({ args: [seed('python-imm', true)], env: FR })
  try {
    await expect(page.getByTestId('immediate-window')).toHaveCount(0)
    await page.keyboard.press('Control+g')
    const input = page.getByTestId('immediate-input')
    const log = page.getByTestId('immediate-log')
    await expect(input).toBeFocused()
    await input.fill('?2+2')
    await input.press('Enter')
    await expect(input).toBeEnabled({ timeout: 120_000 })   // disabled while Python loads
    await expect(log).toContainText('> ?2+2')
    await expect(log.locator('.immediate-line', { hasText: /^4$/ })).toHaveCount(1)
    await input.fill('x = 5'); await input.press('Enter')
    await input.fill('?x * 3'); await input.press('Enter')
    await expect(log.locator('.immediate-line', { hasText: /^15$/ })).toHaveCount(1)
    await input.fill('?1/0'); await input.press('Enter')
    await expect(log).toContainText('ZeroDivisionError')
    await input.press('ArrowUp')
    await expect(input).toHaveValue('?1/0')
    await input.press('ArrowUp')
    await expect(input).toHaveValue('?x * 3')
    await input.press('ArrowDown')
    await expect(input).toHaveValue('?1/0')
    // Ctrl+G again hides the pane, the log is kept
    await page.keyboard.press('Control+g')
    await expect(page.getByTestId('immediate-window')).toBeHidden()
    await page.keyboard.press('Control+g')
    await expect(log).toContainText('ZeroDivisionError')
  } finally {
    await app.close()
  }
})

test('specialKeys off: Ctrl+G does nothing, Create › Éditeur Python opens the pane', async () => {
  test.setTimeout(120_000)
  const { app, page } = await launchApp({ args: [seed('python-imm-off', false)], env: FR })
  try {
    await expect(page.getByTestId('nav-pane')).toBeVisible()
    await page.waitForTimeout(SHIFT_GRACE_MS * 2)   // past the moment the base's startup options apply
    await page.keyboard.press('Control+g')
    await expect(page.getByTestId('immediate-window')).toHaveCount(0)
    await page.getByTestId('ribbon-tab-create').click()
    await page.getByTestId('cmd-pythonEditor').click()
    await expect(page.getByTestId('immediate-window')).toBeVisible()
    await expect(page.getByTestId('immediate-input')).toBeFocused()
  } finally {
    await app.close()
  }
})

test('Runtime: no Immediate window, no command', async () => {
  const { app, page } = await launchApp({ runtime: true, args: [seed('python-imm-rt', true)], env: FR })
  try {
    await expect(page.getByTestId('nav-pane')).toBeVisible()
    await page.keyboard.press('Control+g')
    await expect(page.getByTestId('immediate-window')).toHaveCount(0)
    await expect(page.getByTestId('ribbon-tab-create')).toHaveCount(0)   // the Runtime ribbon has no Create tab, so no pythonEditor either
    await expect(page.getByTestId('cmd-pythonEditor')).toHaveCount(0)
  } finally {
    await app.close()
  }
})
