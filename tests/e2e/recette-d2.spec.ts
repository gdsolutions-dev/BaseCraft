// Recette D2: a button typed =calculer() in the Property Sheet runs a module typed in the editor over 1 200 rows; a Python Before Update
// cancels a save with a message; a dialog form suspends the caller, which then reads its value; an error opens the module at its line;
// Python creates no file next to the base.
import { test, expect, type Page } from '@playwright/test'
import { readdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { createTable } from '../../src/main/db/schema'
import { saveObject } from '../../src/main/db/objects'
import type { ControlDef, DesignDoc } from '../../src/shared/design/model'
import { f, t } from '../../src/shared/test-fixtures'
import { launchApp, seedBase, seedForm } from './helpers'

const FR = { BASECRAFT_REGION: 'fr-FR' }
const box = (kind: ControlDef['kind'], name: string, top: number, props: Record<string, unknown> = {}): ControlDef =>
  ({ kind, name, left: 1701, top, width: 2268, height: 340, props })
const button = (name: string, top: number, onClick?: unknown): ControlDef => box('commandButton', name, top, { Caption: name, ...(onClick ? { OnClick: onClick } : {}) })
const form = (source: string | null, controls: ControlDef[], props: Record<string, unknown> = {}): DesignDoc => ({
  formatVersion: '1.0', recordSource: source ? { kind: 'table', name: source } : null, props: { Width: 6000, ...props },
  sections: [{ kind: 'formHeader', height: 0, props: { Visible: false }, controls: [] },
    { kind: 'detail', height: 2400, props: {}, controls },
    { kind: 'formFooter', height: 0, props: { Visible: false }, controls: [] }],
})
const SOURCE = `def casser():
    x = 1
    return 1 / 0

def verifier():
    if me.Montant.value < 0:
        msgbox("Montant négatif")
        docmd.cancel_event()

def choisir():
    docmd.open_form("DChoix", window_mode="dialog")
    me.Resultat.value = tempvars["choix"]

def valider():
    tempvars["choix"] = me.Choix.value
    docmd.close("form", "DChoix")
`
const EXPORTS = ['casser', 'verifier', 'choisir', 'valider'].map((name) => ({ name, params: [] }))
const state = (page: Page) => page.evaluate(() => (window as unknown as { __bcPython: { state(): string } }).__bcPython.state())
const editor = (page: Page) => page.locator('[data-testid="module-editor"]:visible')
const ctl = (page: Page, n: string) => page.getByTestId(`form-ctl-${n}`)
const files = (base: string) => readdirSync(dirname(base)).filter((n) => !/-(wal|shm|journal)$|\.lock$/.test(n)).sort()

test('Recette D2: Python button over 1 200 rows, Before Update, dialog form, Débogage, no file written', async () => {
  test.setTimeout(480_000)
  const base = seedBase('recette-d2', (db) => {
    const m = saveObject(db, 'module', 'Ev', { formatVersion: '1.0', source: SOURCE, exports: EXPORTS }, null)
    if (!m.ok) throw new Error(m.reason)
    createTable(db, t('Commandes', [f('Id', 'autoNumber'), f('Client', 'shortText'), f('Montant', 'number')]))
    db.exec('BEGIN')
    const ins = db.prepare('INSERT INTO "Commandes" ("Client", "Montant") VALUES (?, ?)')
    for (let i = 1; i <= 1200; i++) ins.run('C' + i, 2)
    db.exec('COMMIT')
    createTable(db, t('Lignes', [f('Id', 'autoNumber'), f('Montant', 'number')]))
    db.prepare('INSERT INTO "Lignes" ("Montant") VALUES (?)').run(10)
    seedForm(db, 'FTotal', form(null, [box('textBox', 'Total', 100), box('textBox', 'Nombre', 600), button('cmdCalcul', 1100), button('cmdCasser', 1600, '=casser()')]))
    seedForm(db, 'FMontant', form('Lignes', [box('textBox', 'Montant', 100, { ControlSource: 'Montant' })], { BeforeUpdate: '=verifier()' }))
    seedForm(db, 'FAppel', form(null, [box('textBox', 'Resultat', 100), button('cmdChoisir', 600, '=choisir()')]))
    seedForm(db, 'DChoix', form(null, [box('textBox', 'Choix', 100, { TabIndex: 0 }), button('cmdValider', 600, '=valider()')]))
  })
  const before = files(base)
  const { app, page } = await launchApp({ args: [base], env: FR })
  try {
    // 1. module typed in the editor, call typed in the Property Sheet
    await page.getByTestId('ribbon-tab-create').click()
    await page.getByTestId('cmd-createModule').click()
    await editor(page).locator('.cm-content').click()
    const lines: [string, boolean?][] = [['def calculer():'], ['total = 0'], ['n = 0'], ['for row in db.open_recordset("Commandes"):'],
      ['total += row["Montant"]'], ['n += 1'], ['me.Total.value = total', true], ['me.Nombre.value = n']]
    for (const [i, [l, less]] of lines.entries()) {
      if (i) await page.keyboard.press('Enter')
      if (less) await page.keyboard.press('Control+[')   // CodeMirror indented after the loop's colon
      await page.keyboard.type(l)
    }
    await page.keyboard.press('Control+s')
    await page.getByTestId('modal-input').fill('Calculs')
    await page.getByTestId('modal-btn-ok').click()
    await expect(page.getByTestId('doc-tab-module-Calculs')).toBeVisible({ timeout: 120_000 })

    await page.getByTestId('nav-item-form-FTotal').click({ button: 'right' })
    await page.getByTestId('nav-menu-design').click()
    await page.getByTestId('ctl-cmdCalcul').click()
    await page.getByTestId('sheet-tab-event').click()
    await page.getByTestId('prop-OnClick').fill('=calculer()')
    await page.getByTestId('prop-OnClick').press('Enter')
    await page.keyboard.press('Control+s')
    await expect(page.getByTestId('doc-tab-form-FTotal')).not.toContainText('•')
    await page.getByTestId('doc-tab-close-form-FTotal').click()

    await page.getByTestId('nav-item-form-FTotal').dblclick()
    await ctl(page, 'cmdCalcul').click()
    await expect(ctl(page, 'Total')).toHaveValue(/^2400(,0+)?$/, { timeout: 120_000 })
    await expect(ctl(page, 'Nombre')).toHaveValue('1200')

    // 4. an error at line 3 opens the module at that line
    await ctl(page, 'cmdCasser').click()
    await expect(page.getByTestId('python-error-where')).toHaveText('Module Ev, ligne 3', { timeout: 60_000 })
    await page.getByTestId('python-error-debug').click()
    await expect(page.getByTestId('modal')).toHaveCount(0)
    await expect(editor(page).locator('.cm-bc-error-line')).toContainText('return 1 / 0')

    // 2. Before Update
    await page.getByTestId('nav-item-form-FMontant').dblclick()
    await ctl(page, 'Montant').click()
    await ctl(page, 'Montant').fill('-5')
    await ctl(page, 'Montant').press('Shift+Enter')
    await expect(page.getByTestId('macro-msgbox-text')).toHaveText('Montant négatif', { timeout: 60_000 })
    await page.getByTestId('macro-msgbox-ok').click()
    await expect(page.getByTestId('form-dirty')).toBeVisible()
    await expect.poll(() => state(page)).toBe('idle')
    await ctl(page, 'Montant').press('Escape')

    // 3. dialog form
    await page.getByTestId('nav-item-form-FAppel').dblclick()
    await ctl(page, 'cmdChoisir').click()
    const dialog = page.getByTestId('form-dialog-DChoix')
    await expect(dialog).toBeVisible({ timeout: 60_000 })
    await dialog.getByTestId('form-ctl-Choix').fill('Lyon')
    await expect(ctl(page, 'Resultat')).toHaveValue('')
    await dialog.getByTestId('form-ctl-cmdValider').click()
    await expect(dialog).toHaveCount(0, { timeout: 30_000 })
    await expect(ctl(page, 'Resultat')).toHaveValue('Lyon', { timeout: 30_000 })
  } finally { await app.close() }
  // 5. nothing new next to the base
  expect(files(base)).toEqual(before)
})
