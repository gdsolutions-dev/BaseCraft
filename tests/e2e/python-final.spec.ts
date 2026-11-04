// D1 final review fixes: packages imported by a user module, Python state across bases and module rename, Ctrl+G in the editor.
import { test, expect, type Page } from '@playwright/test'
import { saveObject } from '../../src/main/db/objects'
import type { DatabaseSync } from 'node:sqlite'
import type { BasecraftApi } from '../../src/shared/api'
import { saveStartupOptions } from '../../src/main/db/startup'
import { DEFAULT_STARTUP } from '../../src/shared/startup'
import { seedBase, launchApp } from './helpers'

const FR = { BASECRAFT_REGION: 'fr-FR' }
const mod = (db: DatabaseSync, name: string, source: string) => {
  const r = saveObject(db, 'module', name, { formatVersion: '1.0', source, exports: [] }, null)
  if (!r.ok) throw new Error(r.reason)
}
const imm = async (page: Page, line: string) => {
  const input = page.getByTestId('immediate-input')
  await expect(input).toBeEnabled({ timeout: 120_000 })
  await input.fill(line)
  await input.press('Enter')
  await expect(input).toBeEnabled({ timeout: 120_000 })
}
const lastLine = (page: Page) => page.getByTestId('immediate-log').locator('.immediate-line').last()

test('a user module that imports pandas loads it on a fresh worker', async () => {
  test.setTimeout(240_000)
  const base = seedBase('python-final-pkg', (db) => {
    saveStartupOptions(db, { ...DEFAULT_STARTUP, specialKeys: true })
    mod(db, 'Analyse', 'import pandas\n\ndef total():\n    return int(pandas.Series([1, 2, 3]).sum())\n')
  })
  const { app, page } = await launchApp({ args: [base], env: FR })
  try {
    await page.keyboard.press('Control+g')
    await imm(page, 'import Analyse')
    await imm(page, '?Analyse.total()')
    await expect(lastLine(page)).toHaveText('6')
  } finally {
    await app.close()
  }
})

test('Python state does not survive another base nor a module rename; Ctrl+G from the module editor', async () => {
  test.setTimeout(240_000)
  const a = seedBase('python-final-a', (db) => { saveStartupOptions(db, { ...DEFAULT_STARTUP, specialKeys: true }); mod(db, 'Foo', "def f():\n    return 'A'\n") })
  const b = seedBase('python-final-b', (db) => { saveStartupOptions(db, { ...DEFAULT_STARTUP, specialKeys: true }); mod(db, 'Foo', "def f():\n    return 'B'\n") })
  const { app, page } = await launchApp({ args: [a], env: FR })
  try {
    // Ctrl+G with the module editor focused: the Immediate window, no CodeMirror search
    await page.getByTestId('nav-item-module-Foo').dblclick()
    const editor = page.locator('[data-testid="module-editor"]:visible .cm-content')
    await editor.click()
    await page.keyboard.press('Control+g')
    await expect(page.getByTestId('immediate-window')).toBeVisible()
    await expect(page.locator('.cm-search')).toHaveCount(0)
    await page.getByTestId('doc-tab-close-module-Foo').click()

    await imm(page, 'import Foo')
    await imm(page, 'v = 1')
    await imm(page, '?Foo.f()')
    await expect(lastLine(page)).toHaveText('A')

    // rename in the Navigation Pane: the old name is gone from the session
    await page.getByTestId('nav-item-module-Foo').click({ button: 'right' })
    await page.getByTestId('nav-menu-rename').click()
    await page.getByTestId('modal-input').fill('Bar')
    await page.getByTestId('modal-btn-ok').click()
    await expect(page.getByTestId('nav-item-module-Bar')).toBeVisible()
    await imm(page, 'import Foo')
    await expect(lastLine(page)).toContainText('ModuleNotFoundError')

    // another base: fresh worker, the namespace is gone and Foo is B's
    await imm(page, 'v = 1')
    await page.evaluate((p) => (window as unknown as { basecraft: BasecraftApi }).basecraft.base.open(p).then(() => {}), b)
    await expect(page.getByTestId('nav-item-module-Foo')).toBeVisible()
    await imm(page, '?v')
    await expect(lastLine(page)).toContainText('NameError')
    await imm(page, 'import Foo')
    await imm(page, '?Foo.f()')
    await expect(lastLine(page)).toHaveText('B')
  } finally {
    await app.close()
  }
})
