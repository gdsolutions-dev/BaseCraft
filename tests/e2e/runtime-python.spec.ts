// D3 Task 7 (R9): the Runtime runs Python (events, calculated controls, reports, error dialog without « Débogage »)
// while the editor, the Immediate window, the builders and View Code are absent.
import { test, expect, type Page } from '@playwright/test'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { createTable } from '../../src/main/db/schema'
import { saveObject } from '../../src/main/db/objects'
import type { ControlDef, DesignDoc, SectionDef } from '../../src/shared/design/model'
import { f, t } from '../../src/shared/test-fixtures'
import { launchApp, layoutFromDom, seedBase, seedForm } from './helpers'

const SOURCE = `def calculer():
    me.Etat.value = "ok"

def remise(prix):
    return prix * 0.9

def casser():
    return 1 / 0
`
const EXPORTS = [['calculer', []], ['remise', ['prix']], ['casser', []]].map(([name, params]) => ({ name, params }))
const box = (kind: ControlDef['kind'], name: string, top: number, props: Record<string, unknown> = {}): ControlDef =>
  ({ kind, name, left: 1701, top, width: 2268, height: 340, props })
const FORM: DesignDoc = {
  formatVersion: '1.0', recordSource: { kind: 'table', name: 'Produits' }, props: { Width: 6000 },
  sections: [{ kind: 'formHeader', height: 0, props: { Visible: false }, controls: [] },
    { kind: 'detail', height: 2400, props: {}, controls: [
      box('textBox', 'Prix', 100, { ControlSource: 'Prix' }),
      box('textBox', 'Etat', 600),
      box('textBox', 'CRemise', 1100, { ControlSource: '=remise([Prix])', Format: 'standard' }),
      box('commandButton', 'cmdCalc', 1600, { Caption: 'Calc', OnClick: '=calculer()' }),
      box('commandButton', 'cmdCasser', 2000, { Caption: 'Casser', OnClick: '=casser()' })] },
    { kind: 'formFooter', height: 0, props: { Visible: false }, controls: [] }],
}
const rbox = (name: string, src: string): ControlDef => ({ kind: 'textBox', name, left: 0, top: 0, width: 3000, height: 340,
  props: { FontName: 'Liberation Sans', FontSize: 10, BorderStyle: 'transparent', ControlSource: src, Format: 'standard' } })
const rsec = (kind: SectionDef['kind'], controls: ControlDef[]): SectionDef => ({ kind, height: 340, props: {}, controls })
const REPORT: DesignDoc = {
  formatVersion: '1.0', recordSource: { kind: 'table', name: 'Produits' },
  props: { Width: 9000, pageSetup: { orientation: 'portrait', margins: { top: 567, right: 567, bottom: 567, left: 567 } } },
  sections: [rsec('detail', [rbox('Rem', '=remise([Prix])')])],
}
const base = () => seedBase('runtime-python', (db) => {
  const m = saveObject(db, 'module', 'Calculs', { formatVersion: '1.0', source: SOURCE, exports: EXPORTS }, null)
  if (!m.ok) throw new Error(m.reason)
  createTable(db, t('Produits', [f('Id', 'autoNumber'), f('Prix', 'number', { numberSize: 'double' })]))
  const ins = db.prepare('INSERT INTO "Produits" ("Prix") VALUES (?)')
  ins.run(100); ins.run(200)
  seedForm(db, 'FPrix', FORM)
  const r = saveObject(db, 'report', 'EPrix', REPORT, null)
  if (!r.ok) throw new Error(r.reason)
})
const reportText = async (page: Page) => (await layoutFromDom(page)).pages.flatMap((p) => p.bands.flatMap((b) => b.lines.map((l) => l[0]))).join(' ')

test('Runtime: Python events, calculated controls, reports and the error dialog work; no editor, Immediate window nor View Code', async () => {
  test.setTimeout(300_000)
  const { app, page } = await launchApp({ runtime: true, args: [base()], env: { BASECRAFT_REGION: 'fr-FR' } })
  try {
    await page.getByTestId('nav-item-form-FPrix').dblclick()
    const ctl = (n: string) => page.locator('.doc:not([hidden])').getByTestId(`form-ctl-${n}`)
    await expect(ctl('CRemise')).toHaveValue('90,00', { timeout: 150_000 })
    await ctl('cmdCalc').click()
    await expect(ctl('Etat')).toHaveValue('ok', { timeout: 60_000 })
    await ctl('cmdCasser').click()
    await expect(page.getByTestId('python-error-text')).toContainText('ZeroDivisionError', { timeout: 60_000 })
    await expect(page.getByTestId('python-error-debug')).toHaveCount(0)
    await page.getByTestId('python-error-end').click()

    // nothing opens an editor: Ctrl+G, a module in the Navigation Pane, View Code
    await page.keyboard.press('Control+g')
    if (await page.getByTestId('nav-item-module-Calculs').count()) await page.getByTestId('nav-item-module-Calculs').dblclick()
    await page.waitForTimeout(500)
    for (const id of ['module-editor', 'immediate-window']) await expect(page.getByTestId(id)).toHaveCount(0)
    await expect(page.getByTestId('ribbon-cmd-viewCode')).toHaveCount(0)

    await page.getByTestId('nav-item-report-EPrix').dblclick()
    await expect.poll(() => reportText(page), { timeout: 60_000 }).toMatch(/90,00 180,00/)
  } finally { await app.close() }
})

test('Runtime bundle: python-worker chunk present; no editor, Immediate window or builder code', () => {
  const root = join(__dirname, '../../out-runtime/renderer')
  const files: string[] = []
  const walk = (d: string) => { for (const n of readdirSync(d)) { const p = join(d, n); statSync(p).isDirectory() ? walk(p) : /\.(js|css|html)$/.test(n) && files.push(p) } }
  walk(root)
  expect(readdirSync(join(root, 'assets')).some((n) => /^python-worker-.*\.js$/.test(n))).toBe(true)
  // unique string literals survive minification: test ids of the editor, the Immediate window and the two builders, and the component names
  const banned = ['module-editor', 'immediate-window', 'immediate-input', 'fn-item-', 'choose-macro', 'ModuleEditorView', 'ImmediateWindow']
  for (const file of files) {
    const text = readFileSync(file, 'utf8')
    for (const s of banned) expect(text.includes(s), `${file} contains ${s}`).toBe(false)
  }
})
