// D2 Task 7: Python events (=fonction()), a dialog form opened by Python running its own Python events nested in the caller,
// Ctrl+Break with nested calls (R9), the depth limit, disabled content.
import { test, expect, type Page } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createTable } from '../../src/main/db/schema'
import { saveObject } from '../../src/main/db/objects'
import type { BasecraftApi } from '../../src/shared/api'
import type { ControlDef, DesignDoc } from '../../src/shared/design/model'
import { f, t } from '../../src/shared/test-fixtures'
import { launchApp, seedBase, seedForm } from './helpers'

const fr = JSON.parse(readFileSync(join(__dirname, '../../src/shared/i18n/fr.json'), 'utf8'))
const box = (kind: ControlDef['kind'], name: string, top: number, props: Record<string, unknown> = {}): ControlDef =>
  ({ kind, name, left: 1701, top, width: 2268, height: 340, props })
const button = (name: string, top: number, onClick: unknown): ControlDef => box('commandButton', name, top, { Caption: name, OnClick: onClick })
const form = (source: string | null, controls: ControlDef[], props: Record<string, unknown> = {}): DesignDoc => ({
  formatVersion: '1.0', recordSource: source ? { kind: 'table', name: source } : null, props: { Width: 6000, ...props },
  sections: [{ kind: 'formHeader', height: 0, props: { Visible: false }, controls: [] },
    { kind: 'detail', height: 2400, props: {}, controls },
    { kind: 'formFooter', height: 0, props: { Visible: false }, controls: [] }],
})

const SOURCE = `
def marquer():
    me.Etat.value = "ok"

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

def boucle():
    while True:
        pass

def suivant():
    me.go_to_record("next")
`
const EXPORTS = ['marquer', 'verifier', 'choisir', 'valider', 'boucle', 'suivant'].map((name) => ({ name, params: [] }))
const runCode = { embedded: { formatVersion: '1.0' as const, items: [{ k: 'action', action: 'RunCode', args: { FunctionName: 'marquer()' } }] } }

const base = () => seedBase('python-events', (db) => {
  const m = saveObject(db, 'module', 'Ev', { formatVersion: '1.0', source: SOURCE, exports: EXPORTS }, null)
  if (!m.ok) throw new Error(m.reason)
  createTable(db, t('Lignes', [f('Id', 'autoNumber'), f('Montant', 'number')]))
  db.prepare('INSERT INTO "Lignes" ("Montant") VALUES (?)').run(10)
  createTable(db, t('Nombres', [f('Id', 'autoNumber'), f('Valeur', 'number')]))
  const ins = db.prepare('INSERT INTO "Nombres" ("Valeur") VALUES (?)')
  for (let i = 1; i <= 30; i++) ins.run(i)
  seedForm(db, 'FBouton', form(null, [box('textBox', 'Etat', 100), button('cmdMarquer', 600, '=marquer()'), button('cmdMacro', 1100, runCode)]))
  seedForm(db, 'FMontant', form('Lignes', [box('textBox', 'Montant', 100, { ControlSource: 'Montant' })], { BeforeUpdate: '=verifier()' }))
  seedForm(db, 'FAppel', form(null, [box('textBox', 'Resultat', 100), button('cmdChoisir', 600, '=choisir()')]))
  seedForm(db, 'DChoix', form(null, [box('textBox', 'Choix', 100, { TabIndex: 0 }), button('cmdValider', 600, '=valider()'), button('cmdBoucle', 1100, '=boucle()')]))
  seedForm(db, 'FBoucle', form('Nombres', [box('textBox', 'Valeur', 100, { ControlSource: 'Valeur' })], { OnCurrent: '=suivant()' }))
})

const open = (page: Page, name: string) => page.getByTestId(`nav-item-form-${name}`).dblclick()
const ctl = (page: Page, n: string) => page.getByTestId(`form-ctl-${n}`)
const lignes = (page: Page) => page.evaluate(() => (window as unknown as { basecraft: BasecraftApi }).basecraft.rows.page('Lignes', { offset: 0, limit: 10 }).then((p) => p.rows.map((r) => r.values)))
const restarted = (page: Page) => page.evaluate(() => ((window as unknown as { __bcPython: { log(): readonly string[] } }).__bcPython.log()).filter((l) => l === 'python.restarted').length)

test('Python events: =fonction() on click, RunCode, Before Update cancelling a save', async () => {
  test.setTimeout(240_000)
  const { app, page } = await launchApp({ args: [base()] })
  try {
    await open(page, 'FBouton')
    await ctl(page, 'cmdMarquer').click()
    await expect(ctl(page, 'Etat')).toHaveValue('ok', { timeout: 90_000 })
    await ctl(page, 'Etat').fill('')
    await ctl(page, 'cmdMacro').click()
    await expect(ctl(page, 'Etat')).toHaveValue('ok', { timeout: 30_000 })

    await open(page, 'FMontant')
    await ctl(page, 'Montant').click()
    await ctl(page, 'Montant').fill('-5')
    await ctl(page, 'Montant').press('Shift+Enter')
    await expect(page.getByTestId('macro-msgbox-text')).toHaveText('Montant négatif', { timeout: 30_000 })
    await page.getByTestId('macro-msgbox-ok').click()
    await expect(page.getByTestId('macro-msgbox')).toHaveCount(0)
    await expect(page.getByTestId('form-dirty')).toBeVisible()
    expect((await lignes(page))[0]![1]).toBe(10)
    await expect.poll(() => page.evaluate(() => (window as unknown as { __bcPython: { state(): string } }).__bcPython.state())).toBe('idle')   // the event is over
    await ctl(page, 'Montant').press('Escape')   // undo, as with a macro's refusal
    await expect(page.getByTestId('form-dirty')).toHaveCount(0)
    await ctl(page, 'Montant').fill('7')
    await ctl(page, 'Montant').press('Shift+Enter')
    await expect(page.getByTestId('form-dirty')).toHaveCount(0)
    expect((await lignes(page))[0]![1]).toBe(7)
  } finally { await app.close() }
})

test('Python dialog form: nested events usable, Ctrl+Break in the dialog keeps the worker and the caller', async () => {
  test.setTimeout(240_000)
  const { app, page } = await launchApp({ args: [base()] })
  const dialog = page.getByTestId('form-dialog-DChoix')
  try {
    await open(page, 'FAppel')
    await ctl(page, 'cmdChoisir').click()
    await expect(dialog).toBeVisible({ timeout: 90_000 })
    await dialog.getByTestId('form-ctl-Choix').fill('Lyon')
    await expect(dialog.getByTestId('form-ctl-Choix')).toHaveValue('Lyon')
    await expect(ctl(page, 'Resultat')).toHaveValue('')

    // a runaway loop in the dialog's button: Ctrl+Break stops it, the dialog stays, the worker lives on
    await dialog.getByTestId('form-ctl-cmdBoucle').click()
    await expect(page.getByTestId('python-interrupt')).toBeVisible({ timeout: 15_000 })
    await page.keyboard.press('Control+Pause')
    await expect(page.getByTestId('modal')).toBeVisible({ timeout: 15_000 })
    await page.getByTestId('modal').getByRole('button').first().click()
    await expect(page.getByTestId('modal')).toHaveCount(0)
    await expect(dialog).toBeVisible()
    await dialog.getByTestId('form-ctl-Choix').fill('Nantes')
    await expect(dialog.getByTestId('form-ctl-Choix')).toHaveValue('Nantes')
    await page.waitForTimeout(3000)
    expect(await restarted(page)).toBe(0)

    await dialog.getByTestId('form-ctl-cmdValider').click()
    await expect(dialog).toHaveCount(0, { timeout: 30_000 })
    await expect(ctl(page, 'Resultat')).toHaveValue('Nantes', { timeout: 30_000 })
  } finally { await app.close() }
})

test('Python On Current calling go_to_record: too deep, shown once, the window stays usable', async () => {
  test.setTimeout(240_000)
  const { app, page } = await launchApp({ args: [base()], env: { BASECRAFT_REGION: 'fr-FR' } })
  try {
    await open(page, 'FBoucle')
    await expect(page.getByTestId('macro-failed')).toBeVisible({ timeout: 120_000 })
    await expect(page.getByTestId('macro-failed-message')).toHaveText(fr.macro.error.eventTooDeep)
    await page.getByTestId('macro-failed-stop').click()
    await expect(page.getByTestId('modal')).toHaveCount(0)
    await page.waitForTimeout(500)
    await expect(page.getByTestId('macro-failed')).toHaveCount(0)
    await expect(ctl(page, 'Valeur')).toBeVisible()
  } finally { await app.close() }
})

test('Python events with disabled content do nothing and bring the security bar back; they work once enabled', async () => {
  test.setTimeout(240_000)
  const { app, page } = await launchApp({ args: [base()], untrusted: true })
  try {
    await open(page, 'FBouton')
    await ctl(page, 'cmdMarquer').click()
    await page.waitForTimeout(500)
    await expect(ctl(page, 'Etat')).toHaveValue('')
    await expect(page.getByTestId('banner-content')).toBeVisible()
    await page.getByTestId('banner-enable-content').click()
    await expect(page.getByTestId('banner-content')).toHaveCount(0)
    await ctl(page, 'cmdMarquer').click()
    await expect(ctl(page, 'Etat')).toHaveValue('ok', { timeout: 90_000 })
  } finally { await app.close() }
})
