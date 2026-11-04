// D3 Task 3 (R3, Review Focus 1, 2, 3, 5): Python functions in calculated controls, control rules, reports and macros;
// typing in a bound control while a calculated control calls Python; failures; modules changing under open forms; disabled content.
import { test, expect, type Page } from '@playwright/test'
import { createTable } from '../../src/main/db/schema'
import { saveObject } from '../../src/main/db/objects'
import type { ControlDef, DesignDoc, SectionDef } from '../../src/shared/design/model'
import { f, t } from '../../src/shared/test-fixtures'
import { launchApp, layoutFromDom, seedBase, seedForm } from './helpers'

const SOURCE = `def remise(prix):
    return prix * 0.9

def casse(x):
    raise ValueError("non")

def liste():
    return [1]

def boucle(x):
    while True: pass
`
const exportsOf = (names: Record<string, string[]>) => Object.entries(names).map(([name, params]) => ({ name, params }))
const EXPORTS = exportsOf({ remise: ['prix'], casse: ['x'], liste: [], boucle: ['x'] })

const box = (name: string, top: number, props: Record<string, unknown> = {}, left = 1701, width = 2268): ControlDef =>
  ({ kind: 'textBox', name, left, top, width, height: 340, props })
const form = (controls: ControlDef[]): DesignDoc => ({
  formatVersion: '1.0', recordSource: { kind: 'table', name: 'Produits' }, props: { Width: 6000 },
  sections: [{ kind: 'formHeader', height: 0, props: { Visible: false }, controls: [] },
    { kind: 'detail', height: 3000, props: {}, controls },
    { kind: 'formFooter', height: 0, props: { Visible: false }, controls: [] }],
})
const prix = (rule = false) => box('Prix', 100, { ControlSource: 'Prix', ...(rule ? { ValidationRule: '<remise(200)', ValidationText: 'Trop cher' } : {}) })
const calc = (name: string, top: number, src: string) => box(name, top, { ControlSource: src, Format: 'standard' })

const FONT = { FontName: 'Liberation Sans', FontSize: 10, BorderStyle: 'transparent' }
const rbox = (name: string, left: number, src: string): ControlDef =>
  ({ kind: 'textBox', name, left, top: 0, width: 3000, height: 340, props: { ...FONT, ControlSource: src, Format: 'standard' } })
const rsec = (kind: SectionDef['kind'], controls: ControlDef[]): SectionDef => ({ kind, height: 340, props: {}, controls })
const REPORT: DesignDoc = {
  formatVersion: '1.0', recordSource: { kind: 'table', name: 'Produits' },
  props: { Width: 9000, pageSetup: { orientation: 'portrait', margins: { top: 567, right: 567, bottom: 567, left: 567 } } },
  sections: [rsec('detail', [rbox('Rem', 0, '=remise([Prix])')]), rsec('reportFooter', [rbox('Tot', 0, '=Sum(remise([Prix]))')])],
}

const act = (action: string, args: Record<string, string> = {}) => ({ k: 'action' as const, action, args })

const base = () => seedBase('python-expressions', (db) => {
  const m = saveObject(db, 'module', 'Calculs', { formatVersion: '1.0', source: SOURCE, exports: EXPORTS }, null)
  if (!m.ok) throw new Error(m.reason)
  createTable(db, t('Produits', [f('Id', 'autoNumber'), f('Prix', 'number', { numberSize: 'double' })]))
  const ins = db.prepare('INSERT INTO "Produits" ("Prix") VALUES (?)')
  ins.run(100); ins.run(200)
  seedForm(db, 'FPrix', form([prix(true), calc('CRemise', 600, '=remise([Prix])'), calc('CCasse', 1100, '=casse([Prix])'), calc('CListe', 1600, '=liste()')]))
  seedForm(db, 'FBoucle', form([prix(), calc('CBoucle', 600, '=boucle([Prix])')]))
  const r = saveObject(db, 'report', 'EPrix', REPORT, null)
  if (!r.ok) throw new Error(r.reason)
  const mac = saveObject(db, 'macro', 'MCond', { formatVersion: '1.0', items: [
    act('SetTempVar', { Name: 'p', Expression: '10' }),
    { k: 'if', branches: [{ cond: 'remise([TempVars]![p])>5', items: [act('MessageBox', { Message: 'remise ok', Beep: 'no' })] }] }] }, null)
  if (!mac.ok) throw new Error(mac.reason)
})

const ctl = (page: Page, n: string) => page.locator('.doc:not([hidden])').getByTestId(`form-ctl-${n}`)
const open = (page: Page, kind: string, name: string) => page.getByTestId(`nav-item-${kind}-${name}`).dblclick()
const ENV = { BASECRAFT_REGION: 'fr-FR' }
const reportText = async (page: Page) => (await layoutFromDom(page)).pages.flatMap((p) => p.bands.flatMap((b) => b.lines.map((l) => l[0]))).join(' ')
async function setModule(page: Page, source: string) {
  await open(page, 'module', 'Calculs')
  await expect(page.getByTestId('module-editor')).toBeVisible()
  await page.locator('.cm-content').click()
  await page.keyboard.press('Control+a')
  await page.keyboard.insertText(source)
  await page.keyboard.press('Control+s')
  await page.waitForTimeout(500)
}

test('Python in calculated controls, rules, reports and macros; typing never loses a key nor shows the veil; modules changing under open forms', async () => {
  test.setTimeout(420_000)
  const { app, page } = await launchApp({ args: [base()], env: ENV })
  try {
    await open(page, 'form', 'FPrix')
    await expect(ctl(page, 'CRemise')).toHaveValue('90,00', { timeout: 150_000 })
    await expect(ctl(page, 'CCasse')).toHaveValue('#Erreur')
    await expect(ctl(page, 'CListe')).toHaveValue('#Erreur')

    // typing key by key in the bound control while the calculated one calls Python: every character arrives, no veil
    await ctl(page, 'Prix').click()
    await page.keyboard.press('Control+a')
    await page.keyboard.type('123,45', { delay: 40 })
    await expect(page.getByTestId('python-veil')).toHaveCount(0)
    await expect(ctl(page, 'Prix')).toHaveValue('123,45')
    await ctl(page, 'CRemise').click()
    await expect(ctl(page, 'CRemise')).toHaveValue(/^111,1[01]$/)
    await expect(ctl(page, 'Prix')).toHaveValue('123,45')
    await expect(page.getByTestId('python-veil')).toHaveCount(0)

    // a control Validation Rule calling Python: 200 is refused with the control's Validation Text
    await ctl(page, 'Prix').click()
    await page.keyboard.press('Control+a')
    await page.keyboard.type('200')
    await ctl(page, 'CRemise').click()
    await expect(page.getByTestId('modal')).toContainText('Trop cher')
    await page.getByTestId('modal-btn-ok').click()
    await expect(page.getByTestId('form-error-Prix')).toHaveText('Trop cher')
    await page.keyboard.press('Escape')
    await expect(ctl(page, 'Prix')).toHaveValue('100')

    // a macro condition and a calculated report
    await open(page, 'macro', 'MCond')
    await expect(page.getByTestId('macro-msgbox-text')).toHaveText('remise ok', { timeout: 60_000 })
    await page.getByTestId('macro-msgbox-ok').click()
    await open(page, 'report', 'EPrix')
    await expect.poll(() => reportText(page), { timeout: 60_000 }).toMatch(/90,00 180,00 270,00/)
    await page.getByTestId('doc-tab-close-report-EPrix').click()

    // modules changing while the form is open: a function removed gives #Nom?, restored gives its value, a new body shows
    const without = SOURCE.replace(/def remise[^]*?\n\n/, '')
    await setModule(page, without)
    await page.getByTestId('doc-tab-form-FPrix').click()
    await expect(ctl(page, 'CRemise')).toHaveValue('#Nom?', { timeout: 30_000 })
    await setModule(page, SOURCE)
    await page.getByTestId('doc-tab-form-FPrix').click()
    await expect(ctl(page, 'CRemise')).toHaveValue('90,00', { timeout: 30_000 })
    await setModule(page, SOURCE.replace('0.9', '0.5'))
    await page.getByTestId('doc-tab-form-FPrix').click()
    await expect(ctl(page, 'CRemise')).toHaveValue('50,00', { timeout: 30_000 })
    await page.getByTestId('doc-tab-close-module-Calculs').click()

    // a function that never returns: the veil after 2 s, Ctrl+Break gives #Erreur, the form is usable
    await open(page, 'form', 'FBoucle')
    await expect(page.getByTestId('python-interrupt')).toBeVisible({ timeout: 30_000 })
    await page.keyboard.press('Control+Pause')   // one is enough: the form's two calculations share the call
    await expect(page.getByTestId('python-veil')).toHaveCount(0, { timeout: 15_000 })
    await expect(ctl(page, 'CBoucle')).toHaveValue('#Erreur')
    await ctl(page, 'Prix').click()
    await expect(ctl(page, 'Prix')).toBeFocused()
  } finally { await app.close() }
})

test('disabled content: #Nom? in the form and the report, the security bar; enabling shows the values without reopening', async () => {
  test.setTimeout(300_000)
  const { app, page } = await launchApp({ args: [base()], env: ENV, untrusted: true })
  try {
    await open(page, 'form', 'FPrix')
    await expect(ctl(page, 'CRemise')).toHaveValue('#Nom?')
    await expect(page.getByTestId('banner-content')).toBeVisible()
    await open(page, 'report', 'EPrix')
    await expect.poll(() => reportText(page)).toContain('#Nom?')
    await page.getByTestId('banner-enable-content').click()
    await expect.poll(() => reportText(page), { timeout: 150_000 }).toMatch(/90,00 180,00 270,00/)
    await page.getByTestId('doc-tab-form-FPrix').click()
    await expect(ctl(page, 'CRemise')).toHaveValue('90,00', { timeout: 30_000 })
  } finally { await app.close() }
})

test('disabled content: a macro condition calling Python stops as blocked', async () => {
  test.setTimeout(120_000)
  const { app, page } = await launchApp({ args: [base()], env: ENV, untrusted: true })
  try {
    await open(page, 'macro', 'MCond')
    await expect(page.getByTestId('macro-failed')).toBeVisible()
    await expect(page.getByTestId('banner-content')).toBeVisible()
  } finally { await app.close() }
})
