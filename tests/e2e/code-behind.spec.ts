// B6: code-behind modules. An [Event Procedure] runs <Control>_<Event> of Form_<Name>; View Code creates the module and the function;
// Convert Macros to Python on a form turns its embedded macros into procedures.
import { test, expect, type Page } from '@playwright/test'
import { saveObject } from '../../src/main/db/objects'
import type { BasecraftApi } from '../../src/shared/api'
import type { ControlDef, DesignDoc } from '../../src/shared/design/model'
import { launchApp, seedBase, seedForm } from './helpers'

const box = (kind: ControlDef['kind'], name: string, top: number, props: Record<string, unknown> = {}): ControlDef =>
  ({ kind, name, left: 1701, top, width: 2268, height: 340, props })
const form = (controls: ControlDef[], props: Record<string, unknown> = {}): DesignDoc => ({
  formatVersion: '1.0', recordSource: null, props: { Width: 6000, ...props },
  sections: [{ kind: 'detail', height: 2400, props: {}, controls }],
})
const SOURCE = 'def cmdGo_Click():\n    me.Etat.value = "ok"\n\ndef Form_Load():\n    me.Etat.value = "ouvert"\n'
const embedded = { embedded: { formatVersion: '1.0' as const, items: [{ k: 'action', action: 'SetTempVar', args: { Name: 'x', Expression: '5' } }] } }

const base = () => seedBase('code-behind', (db) => {
  const m = saveObject(db, 'module', 'Form_FCode', { formatVersion: '1.0', source: SOURCE, exports: [{ name: 'cmdGo_Click', params: [] }, { name: 'Form_Load', params: [] }] }, null)
  if (!m.ok) throw new Error(m.reason)
  seedForm(db, 'FCode', form([box('textBox', 'Etat', 100), box('commandButton', 'cmdGo', 600, { Caption: 'Go', OnClick: '[Event Procedure]' })], { OnLoad: '[Event Procedure]' }))
  seedForm(db, 'FVide', form([box('commandButton', 'cmdX', 600, { Caption: 'X' })]))
  seedForm(db, 'FMacro', form([box('commandButton', 'cmdM', 600, { Caption: 'M', OnClick: embedded })]))
})

type Mod = { source: string; exports: { name: string }[] }
const getModule = (page: Page, name: string) => page.evaluate((n) => (window as unknown as { basecraft: BasecraftApi }).basecraft.objects.get('module', n), name)
  .then((r) => r.definition as Mod)
const design = async (page: Page, name: string) => { await page.getByTestId(`nav-item-form-${name}`).click({ button: 'right' }); await page.getByTestId('nav-menu-design').click() }

test('[Event Procedure] runs the procedures of Form_<Name> (On Load and a button)', async () => {
  test.setTimeout(240_000)
  const { app, page } = await launchApp({ args: [base()] })
  try {
    await page.getByTestId('nav-item-form-FCode').dblclick()
    const ctl = (n: string) => page.getByTestId(`form-ctl-${n}`)
    await expect(ctl('Etat')).toHaveValue('ouvert', { timeout: 120_000 })
    await ctl('cmdGo').click()
    await expect(ctl('Etat')).toHaveValue('ok', { timeout: 30_000 })
  } finally { await app.close() }
})

test('View Code opens the procedure; on an object without code it creates its module', async () => {
  test.setTimeout(240_000)
  const { app, page } = await launchApp({ args: [base()] })
  try {
    await design(page, 'FCode')
    await page.getByTestId('cmd-viewCode').click()
    await expect(page.getByTestId('module-editor')).toBeVisible()
    await expect(page.locator('.cm-bc-error-line')).toContainText('def Form_Load(')

    await design(page, 'FVide')
    await page.getByTestId('cmd-viewCode').click()
    await expect.poll(() => getModule(page, 'Form_FVide').then((m) => m.source, () => ''), { timeout: 60_000 }).toContain('Code of the form FVide')
  } finally { await app.close() }
})

test('Convert Macros to Python on a form: the embedded macro becomes a procedure and [Event Procedure]', async () => {
  test.setTimeout(240_000)
  const { app, page } = await launchApp({ args: [base()] })
  try {
    await design(page, 'FMacro')
    await expect(page.getByTestId('cmd-convertMacros')).toBeEnabled()
    await page.getByTestId('cmd-convertMacros').click()
    await page.getByTestId('convert-macros-ok').click()
    await expect(page.getByTestId('modal')).toContainText('Form_FMacro', { timeout: 120_000 })
    await page.getByTestId('modal-btn-ok').click()
    const m = await getModule(page, 'Form_FMacro')
    expect(m.source).toContain('def cmdM_Click():')
    expect(m.source).toContain('tempvars["x"] = 5')
    expect(m.exports.map((e) => e.name)).toEqual(['cmdM_Click'])
    await page.keyboard.press('Control+s')
    await expect.poll(() => page.evaluate(() => (window as unknown as { basecraft: BasecraftApi }).basecraft.objects.get('form', 'FMacro')).then((o) => JSON.stringify(o.definition)), { timeout: 30_000 }).toContain('[Event Procedure]')
  } finally { await app.close() }
})

const modules = (page: Page) => page.evaluate(() => (window as unknown as { basecraft: BasecraftApi }).basecraft.objects.list('module')).then((l) => l.map((m) => m.name).sort())
const nav = async (page: Page, item: string, cmd: string, name?: string) => {
  await page.getByTestId(item).click({ button: 'right' })
  await page.getByTestId(`nav-menu-${cmd}`).click()
  if (name !== undefined) { await page.getByTestId('modal-input').fill(name); await page.getByTestId('modal-btn-ok').click() }
}

test('the module follows its form: rename, copy, delete; a name giving the same module is refused', async () => {
  test.setTimeout(240_000)
  const { app, page } = await launchApp({ args: [base()] })
  try {
    await nav(page, 'nav-item-form-FCode', 'rename', 'FRen')
    await expect.poll(() => modules(page)).toEqual(['Form_FRen'])
    expect((await getModule(page, 'Form_FRen')).source).toContain('def cmdGo_Click')

    await nav(page, 'nav-item-form-FRen', 'copy')
    await nav(page, 'nav-item-form-FRen', 'paste')
    await expect(page.getByTestId('paste-name')).toHaveValue('Copie de FRen')
    await page.getByTestId('paste-ok').click()
    await expect.poll(() => modules(page)).toEqual(['Form_Copie_de_FRen', 'Form_FRen'])

    // « Copie_de FRen » would give the module Form_Copie_de_FRen again: refused, nothing changes
    await nav(page, 'nav-item-form-FVide', 'rename', 'Copie de_FRen')
    await expect(page.getByTestId('modal')).toContainText('même module de code')
    await page.getByTestId('modal-btn-ok').click()
    await expect(page.getByTestId('nav-item-form-FVide')).toBeVisible()

    await nav(page, 'nav-item-form-FRen', 'delete')
    await page.getByTestId('modal-btn-yes').click()
    await expect.poll(() => modules(page)).toEqual(['Form_Copie_de_FRen'])
  } finally { await app.close() }
})
