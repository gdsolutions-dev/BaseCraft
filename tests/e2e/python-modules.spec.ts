// D1 Task 7: the Module object — Create › Module, the CodeMirror editor, Save (exports from the engine), the Navigation Pane,
// the Python-name rule, a syntax error that still saves.
import { test, expect, type Page } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { BasecraftApi } from '../../src/shared/api'
import { saveObject } from '../../src/main/db/objects'
import { launchApp, seedBase, seedForm } from './helpers'

const fr = JSON.parse(readFileSync(join(__dirname, '../../src/shared/i18n/fr.json'), 'utf8'))
const FR = { BASECRAFT_REGION: 'fr-FR' }
const getModule = (page: Page, name: string) =>
  page.evaluate((n) => (window as unknown as { basecraft: BasecraftApi }).basecraft.objects.get('module', n), name)
    .then((r) => r.definition as { source: string; exports: { name: string; params: string[] }[] })

/** Other documents stay mounted, hidden: the visible editor. */
const editor = (page: Page) => page.locator('[data-testid="module-editor"]:visible')

/** Types `lines` in the editor (the editor indents after a colon, 4 spaces a level). */
async function type(page: Page, lines: string[]) {
  await editor(page).locator('.cm-content').click()
  for (const [i, l] of lines.entries()) {
    if (i) await page.keyboard.press('Enter')
    await page.keyboard.type(l)
  }
}
async function saveAs(page: Page, name: string) {
  await page.keyboard.press('Control+s')
  await page.getByTestId('modal-input').fill(name)
  await page.getByTestId('modal-btn-ok').click()
}
async function createModule(page: Page) {
  await page.getByTestId('ribbon-tab-create').click()
  await page.getByTestId('cmd-createModule').click()
  await expect(editor(page)).toBeVisible()
}

test('Module: create, type, save under a name, exports from the engine, listed, reopened; a second module; bad names; a syntax error still saves', async () => {
  test.setTimeout(180_000)
  const base = seedBase('modules')
  let { app, page } = await launchApp({ args: [base], env: FR })
  try {
    await createModule(page)
    await expect(page.getByTestId('doc-tab-module-Module1')).toBeVisible()
    await type(page, ['def double(x):', 'return x * 2'])
    await saveAs(page, 'Outils')
    await expect(page.getByTestId('doc-tab-module-Outils')).toBeVisible()
    await expect(page.getByTestId('nav-item-module-Outils')).toBeVisible()
    expect(await getModule(page, 'Outils')).toMatchObject({ formatVersion: '1.0', source: 'def double(x):\n    return x * 2', exports: [{ name: 'double', params: ['x'] }] })
    await expect(page.getByTestId('module-error')).toHaveCount(0)

    // closed and reopened from the Navigation Pane: the same text
    await page.getByTestId('doc-tab-close-module-Outils').click()
    await expect(editor(page)).toHaveCount(0)
    await page.getByTestId('nav-item-module-Outils').dblclick()
    await expect(editor(page).locator('.cm-content')).toHaveText(/def double\(x\):\s*return x \* 2/)

    // a second module importing the first
    await createModule(page)
    await type(page, ['import Outils', 'def quadruple(x):', 'return Outils.double(Outils.double(x))'])
    await saveAs(page, 'Calcul')
    await expect(page.getByTestId('nav-item-module-Calcul')).toBeVisible()
    expect((await getModule(page, 'Calcul')).exports).toEqual([{ name: 'quadruple', params: ['x'] }])

    // a Python keyword is no module name: the prompt refuses it
    await createModule(page)
    await type(page, ['x = 1'])
    await page.keyboard.press('Control+s')
    await page.getByTestId('modal-input').fill('class')
    await page.getByTestId('modal-btn-ok').click()
    await expect(page.getByTestId('modal-error')).toHaveText(fr.module.badName)
    await page.getByTestId('modal-input').fill('Brouillon')
    await page.getByTestId('modal-btn-ok').click()
    await expect(page.getByTestId('nav-item-module-Brouillon')).toBeVisible()

    // a syntax error: saved without exports, the bar shows its line
    await createModule(page)
    await type(page, ['def f(:'])
    await saveAs(page, 'Casse')
    await expect(page.getByTestId('nav-item-module-Casse')).toBeVisible()
    await expect(page.getByTestId('module-error')).toContainText(fr.module.syntaxError.replace('{{line}}', '1').split('{{message}}')[0])
    expect((await getModule(page, 'Casse')).exports).toEqual([])

    // the Runtime lists the modules but has no editor: a double-click opens no tab
    await app.close();
    ;({ app, page } = await launchApp({ runtime: true, args: [base], env: FR }))
    await expect(page.getByTestId('nav-item-module-Outils')).toBeVisible()
    await page.getByTestId('nav-item-module-Outils').dblclick()
    await page.waitForTimeout(500) // a tab, if one were to open, is there by now
    await expect(page.locator('[data-testid^="doc-tab-"]')).toHaveCount(0)
  } finally {
    await app.close()
  }
})

test('Module: typing forms[" lists the forms, then the controls of the chosen one; Enter inserts the name', async () => {
  test.setTimeout(120_000)
  const base = seedBase('completions', (db) => {
    seedForm(db, 'Clients', { formatVersion: '1.0', recordSource: null, props: { Width: 6000 }, sections: [
      { kind: 'formHeader', height: 0, props: { Visible: false }, controls: [] },
      { kind: 'detail', height: 2400, props: {}, controls: [{ kind: 'textBox', name: 'txtVille', left: 1701, top: 100, width: 2268, height: 340, props: {} }] },
      { kind: 'formFooter', height: 0, props: { Visible: false }, controls: [] }] })
    saveObject(db, 'macro', 'MLyon', { formatVersion: '1.0', items: [] }, null)
  })
  const { app, page } = await launchApp({ args: [base], env: FR })
  try {
    await createModule(page)
    await editor(page).locator('.cm-content').click()
    await page.keyboard.type('forms["')
    const list = page.locator('.cm-tooltip-autocomplete:visible')
    await expect(list).toContainText('Clients')
    await page.waitForTimeout(200) // CodeMirror ignores Enter for 75 ms after the list opens
    await page.keyboard.press('Enter')
    await expect(editor(page).locator('.cm-content')).toContainText('forms["Clients')
    await page.keyboard.type('"].')
    await expect(list).toContainText('txtVille')
    await expect(list).toContainText('requery')
  } finally {
    await app.close()
  }
})

test('Module: Jedi completes BaseCraft\'s API (db.), highlighting is present, Enter accepts an item', async () => {
  test.setTimeout(180_000)
  const { app, page } = await launchApp({ args: [seedBase('jedi')], env: FR })
  try {
    await createModule(page)
    await editor(page).locator('.cm-content').click()
    await page.keyboard.type('def f():')
    await page.keyboard.press('Enter')
    await page.keyboard.type('rs = db.open_r')
    const list = page.locator('.cm-tooltip-autocomplete:visible')
    await expect(list).toContainText('open_recordset', { timeout: 90_000 }) // the first call starts Python and loads Jedi
    await expect(editor(page).locator('.cm-content span[class*="ͼ"]').first()).toBeVisible() // lang-python highlighting spans
    await page.waitForTimeout(200)
    await page.keyboard.press('Enter')
    await expect(editor(page).locator('.cm-content')).toContainText('db.open_recordset')
  } finally {
    await app.close()
  }
})

test('Module: the list opens while typing; Enter keeps its new line until an arrow key, Tab accepts', async () => {
  test.setTimeout(180_000)
  const { app, page } = await launchApp({ args: [seedBase('jedi-typing')], env: FR })
  try {
    await createModule(page)
    const content = editor(page).locator('.cm-content')
    await content.click()
    const list = page.locator('.cm-tooltip-autocomplete:visible')
    await page.keyboard.type('pri')
    await expect(list).toContainText('print')
    await page.waitForTimeout(200)
    await page.keyboard.press('Enter')   // fresh typed list: a new line, not the item
    await expect(list).toBeHidden()
    await expect(content.locator('.cm-line')).toHaveCount(2)
    await page.keyboard.type('pri')
    await expect(list).toContainText('print')
    await page.waitForTimeout(200)
    await page.keyboard.press('ArrowDown')
    await page.keyboard.press('Enter')   // moved into the list: accepts
    await expect(content.locator('.cm-line')).toHaveCount(2)
    await expect(content.locator('.cm-line').nth(1)).not.toHaveText('pri')
    await page.keyboard.type('\nlen')   // Tab accepts the selected item
    await expect(list).toContainText('len')
    await page.keyboard.press('Tab')
    await expect(content.locator('.cm-line').last()).toHaveText(/^len\w*$/)
  } finally {
    await app.close()
  }
})
