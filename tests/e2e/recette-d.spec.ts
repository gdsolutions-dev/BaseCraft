// Recette D (stage D acceptance): the D2 scenario, then Python in a form's calculated control and a report's text box typed in the
// Property Sheet (Print Preview and the HTML sent to the PDF export agree), a SQL query refused with the R6 message, the same base in the
// Runtime, and no file written next to the base. PDF text cannot be extracted (compressed streams, no parser): the HTML handed to the print
// path (__bcPrintE2E.html) is compared with the preview's rendered text.
import { test, expect, type Page } from '@playwright/test'
import { join } from 'node:path'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { createTable } from '../../src/main/db/schema'
import { saveObject } from '../../src/main/db/objects'
import type { ControlDef, DesignDoc, SectionDef } from '../../src/shared/design/model'
import { f, t } from '../../src/shared/test-fixtures'
import { box, button, ctl, files, form, FR, runD2, seedD2 } from './recette-d-shared'
import { launchApp, layoutFromDom, pickView, seedBase, seedForm } from './helpers'

const FONCTIONS = 'def remise(prix):\n    return prix * 0.9\n'
const MESSAGE = 'La fonction Python remise ne peut pas être utilisée ici'
const rsec = (kind: SectionDef['kind'], controls: ControlDef[]): SectionDef => ({ kind, height: 340, props: {}, controls })
const REPORT: DesignDoc = {
  formatVersion: '1.0', recordSource: { kind: 'table', name: 'Produits' },
  props: { Width: 9000, pageSetup: { orientation: 'portrait', margins: { top: 567, right: 567, bottom: 567, left: 567 } } },
  sections: [rsec('detail', [{ kind: 'textBox', name: 'Rem', left: 0, top: 0, width: 3000, height: 340,
    props: { FontName: 'Liberation Sans', FontSize: 10, BorderStyle: 'transparent', Format: 'standard' } }])],
}
const reportText = async (page: Page) => (await layoutFromDom(page)).pages.flatMap((p) => p.bands.flatMap((b) => b.lines.map((l) => l[0]))).join(' ')
const doc = (page: Page) => page.locator('section[role=tabpanel]:not([hidden])')
const dctl = (page: Page, n: string) => page.locator('.doc:not([hidden])').getByTestId(`form-ctl-${n}`)

async function typeSource(page: Page, testId: string, text: string) {
  await page.getByTestId(testId).fill(text)
  await page.getByTestId(testId).press('Enter')
  await page.keyboard.press('Control+s')
}

test('Recette D: D2 scenario, Python in a form and a report (preview = PDF html), refused in SQL, same base in the Runtime, no file written', async () => {
  test.setTimeout(900_000)
  const base = seedBase('recette-d', (db) => {
    seedD2(db)
    const m = saveObject(db, 'module', 'Fonctions', { formatVersion: '1.0', source: FONCTIONS, exports: [{ name: 'remise', params: ['prix'] }] }, null)
    if (!m.ok) throw new Error(m.reason)
    createTable(db, t('Produits', [f('Id', 'autoNumber'), f('Prix', 'number', { numberSize: 'double' })]))
    const ins = db.prepare('INSERT INTO "Produits" ("Prix") VALUES (?)')
    ins.run(100); ins.run(200)
    seedForm(db, 'FPrix', form('Produits', [box('textBox', 'Prix', 100, { ControlSource: 'Prix' }), box('textBox', 'CRemise', 600, { Format: 'standard' }),
      button('cmdRemise', 1100, '=remise(50)')]))
    const r = saveObject(db, 'report', 'EPrix', REPORT, null)
    if (!r.ok) throw new Error(r.reason)
    saveObject(db, 'query', 'QOk', { formatVersion: '1.0', sql: 'SELECT Prix FROM Produits' }, null)
  })
  const before = files(base)
  let { app, page } = await launchApp({ args: [base], env: { ...FR, BASECRAFT_E2E_PDF_PATH: join(mkdtempSync(join(tmpdir(), 'basecraft-recette-')), 'EPrix.pdf') } })
  try {
    // 1. the D2 scenario
    await runD2(page)

    // 2. a form's calculated control, typed in the Property Sheet
    await page.getByTestId('nav-item-form-FPrix').click({ button: 'right' })
    await page.getByTestId('nav-menu-design').click()
    await page.getByTestId('ctl-CRemise').click()
    await typeSource(page, 'prop-ControlSource', '=remise([Prix])')
    await expect(page.getByTestId('doc-tab-form-FPrix')).not.toContainText('•')
    await page.getByTestId('doc-tab-close-form-FPrix').click()
    await page.getByTestId('nav-item-form-FPrix').dblclick()
    await expect(dctl(page, 'CRemise')).toHaveValue('90,00', { timeout: 150_000 })
    await page.getByTestId('doc-tab-close-form-FPrix').click()

    // ... and a report's text box
    await page.getByTestId('nav-item-report-EPrix').click({ button: 'right' })
    await page.getByTestId('nav-menu-design').click()
    await page.getByTestId('ctl-Rem').click()
    await typeSource(page, 'prop-ControlSource', '=remise([Prix])')
    await expect(page.getByTestId('doc-tab-report-EPrix')).not.toContainText('•')
    await page.getByTestId('doc-tab-close-report-EPrix').click()
    await page.getByTestId('nav-item-report-EPrix').dblclick()
    await expect.poll(() => reportText(page), { timeout: 60_000 }).toMatch(/90,00 180,00/)
    const shown = await reportText(page)
    await page.getByTestId('cmd-exportPdf').click()
    await expect(page.getByTestId('modal')).toBeVisible()   // the confirmation after saving
    await page.getByTestId('modal-btn-ok').click()
    // the HTML sent to the PDF path holds the same text as the preview
    const html = await app.evaluate(() => (globalThis as unknown as { __bcPrintE2E: { html: string } }).__bcPrintE2E.html)
    const pdfText = html.replace(/<style[^]*?<\/style>/g, '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ')
    for (const v of shown.split(' ').filter(Boolean)) expect(pdfText).toContain(v)
    expect(pdfText).toMatch(/90,00\s+180,00/)
    await page.getByTestId('doc-tab-close-report-EPrix').click()

    // 3. a query in SQL view is refused with the R6 message
    await page.getByTestId('nav-item-query-QOk').click({ button: 'right' })
    await page.getByTestId('nav-menu-design').click()
    await pickView(page, 'viewSql')
    await doc(page).getByTestId('query-sql').fill('SELECT remise(Prix) FROM Produits')
    await page.keyboard.press('Control+s')
    await expect(doc(page).getByTestId('query-sql-error')).toContainText(MESSAGE)
  } finally { await app.close() }

  // 4. the same base in the Runtime: the button and the calculated control work
  ;({ app, page } = await launchApp({ runtime: true, args: [base], env: FR }))
  try {
    await page.getByTestId('nav-item-form-FPrix').dblclick()
    await expect(ctl(page, 'CRemise')).toHaveValue('90,00', { timeout: 150_000 })
    await page.getByTestId('nav-item-form-FTotal').dblclick()
    await ctl(page, 'cmdCalcul').click()
    await expect(ctl(page, 'Total')).toHaveValue(/^2400(,0+)?$/, { timeout: 120_000 })
    await expect(ctl(page, 'Nombre')).toHaveValue('1200')
  } finally { await app.close() }

  // 5. nothing new next to the base
  expect(files(base)).toEqual(before)
})
