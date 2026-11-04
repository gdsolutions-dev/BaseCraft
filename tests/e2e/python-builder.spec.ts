// D2 Task 9: the Property Sheet's Python calls (R1, localized display / canonical storage), « Choisir le générateur » and the
// function builder (R11), the name-clash warning bar of the module editor (R12).
import { test, expect, type Page } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { saveObject } from '../../src/main/db/objects'
import type { BasecraftApi } from '../../src/shared/api'
import type { ControlDef, DesignDoc } from '../../src/shared/design/model'
import { launchApp, seedBase, seedForm } from './helpers'

const fr = JSON.parse(readFileSync(join(__dirname, '../../src/shared/i18n/fr.json'), 'utf8'))
const FR = { BASECRAFT_REGION: 'fr-FR' }
const fill = (s: string, p: Record<string, string>) => s.replace(/\{\{(\w+)\}\}/g, (_, k: string) => p[k]!)
const button = (name: string, top: number, props: Record<string, unknown> = {}): ControlDef =>
  ({ kind: 'commandButton', name, left: 1701, top, width: 2268, height: 340, props: { Caption: name, ...props } })
const form = (controls: ControlDef[]): DesignDoc => ({
  formatVersion: '1.0', recordSource: null, props: { Width: 6000 },
  sections: [{ kind: 'formHeader', height: 0, props: { Visible: false }, controls: [] },
    { kind: 'detail', height: 2400, props: {}, controls },
    { kind: 'formFooter', height: 0, props: { Visible: false }, controls: [] }],
})
const getForm = (page: Page, name: string) => page.evaluate((n) => (window as unknown as { basecraft: BasecraftApi }).basecraft.objects.get('form', n), name)
  .then((r) => r.definition as DesignDoc)
const getModule = (page: Page, name: string) => page.evaluate((n) => (window as unknown as { basecraft: BasecraftApi }).basecraft.objects.get('module', n), name)
  .then((r) => r.definition as { exports: { name: string }[] })

const base = () => seedBase('python-builder', (db) => {
  saveObject(db, 'module', 'Calculs', { formatVersion: '1.0', source: 'def remise(prix, client):\n    return prix\n', exports: [{ name: 'remise', params: ['prix', 'client'] }] }, null)
  saveObject(db, 'macro', 'MLyon', { formatVersion: '1.0', items: [] }, null)
  seedForm(db, 'FOutils', form([button('cmdA', 100), button('cmdB', 600), button('cmdC', 1100), button('cmdD', 1600, { OnClick: 'MLyon' })]))
})

const editor = (page: Page) => page.locator('[data-testid="module-editor"]:visible')
async function newModule(page: Page, lines: string[], name: string) {
  await page.getByTestId('ribbon-tab-create').click()
  await page.getByTestId('cmd-createModule').click()
  await editor(page).locator('.cm-content').click()
  for (const [i, l] of lines.entries()) {
    if (i) await page.keyboard.press('Enter')
    await page.keyboard.type(l)
  }
  await page.keyboard.press('Control+s')
  await page.getByTestId('modal-input').fill(name)
  await page.getByTestId('modal-btn-ok').click()
  await expect(page.getByTestId(`doc-tab-module-${name}`)).toBeVisible({ timeout: 120_000 })
}

test('Property Sheet: Python calls typed and built, the chooser, the macro builder kept', async () => {
  test.setTimeout(180_000)
  const { app, page } = await launchApp({ args: [base()], env: FR })
  try {
    await page.getByTestId('nav-item-form-FOutils').click({ button: 'right' })
    await page.getByTestId('nav-menu-design').click()
    await expect(page.getByTestId('designer')).toBeVisible()
    const prop = page.getByTestId('prop-OnClick')
    const pick = async (n: string) => { await page.getByTestId(`ctl-${n}`).click(); await page.getByTestId('sheet-tab-event').click() }

    await pick('cmdA')
    await prop.fill('=remise([Prix];[Client])')
    await prop.press('Enter')
    await expect(page.getByTestId('prop-OnClick-error')).toHaveCount(0)
    await expect(prop).toHaveValue('=remise([Prix]; [Client])')
    await page.keyboard.press('Control+s')
    await expect(page.getByTestId('doc-tab-form-FOutils')).not.toContainText('•')
    expect((await getForm(page, 'FOutils')).sections[1]!.controls[0]!.props.OnClick).toBe('=remise([Prix], [Client])')

    await pick('cmdB')
    await prop.fill('=Gauche([x];1)')
    await prop.press('Enter')
    await expect(page.getByTestId('prop-OnClick-error')).toHaveText(fill(fr.prop.event.builtinFunction, { name: 'Gauche' }))
    await prop.press('Escape')
    await expect(prop).toHaveValue('')

    await pick('cmdC')
    await page.getByTestId('prop-OnClick-build').click()
    await expect(page.getByTestId('choose-function')).toBeVisible()
    await expect(page.getByTestId('choose-macro')).toHaveText(fr.builder.choose.macro)
    await page.getByTestId('choose-function').click()
    await expect(page.getByTestId('fn-item-Calculs.remise')).toHaveText('Calculs.remise(prix, client)')
    await page.getByTestId('fn-item-Calculs.remise').click()
    await page.getByTestId('fn-ok').click()
    await expect(prop).toHaveValue('=remise([prix]; [client])')
    await prop.focus()
    await page.keyboard.press('Control+s')
    await expect.poll(async () => (await getForm(page, 'FOutils')).sections[1]!.controls[2]!.props.OnClick).toBe('=remise([prix], [client])')

    // a Python call: « … » opens the function builder again
    await page.getByTestId('prop-OnClick-build').click()
    await expect(page.getByTestId('fn-ok')).toBeVisible()
    await page.getByTestId('fn-cancel').click()

    await pick('cmdD')
    await page.getByTestId('prop-OnClick-build').click()
    await expect(page.getByTestId('doc-tab-macro-MLyon')).toBeVisible()
  } finally { await app.close() }
})

test('Module editor: a name that exists in another module, or is a built-in, warns and still saves', async () => {
  test.setTimeout(240_000)
  const { app, page } = await launchApp({ args: [base()], env: FR })
  try {
    await newModule(page, ['def remise(a):', 'return a'], 'Autre')
    await expect(page.locator('[data-testid="module-warning"]:visible')).toHaveText(fill(fr.module.functionClash, { name: 'remise', fn: 'remise', other: 'Calculs' }))
    expect((await getModule(page, 'Autre')).exports.map((e) => e.name)).toEqual(['remise'])
    await newModule(page, ['def left(x):', 'return x'], 'Tiers')
    await expect(page.locator('[data-testid="module-warning"]:visible')).toHaveText(fill(fr.module.functionBuiltin, { name: 'left' }))
    expect((await getModule(page, 'Tiers')).exports.map((e) => e.name)).toEqual(['left'])
  } finally { await app.close() }
})
