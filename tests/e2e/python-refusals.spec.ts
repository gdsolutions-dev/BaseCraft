// D3 Task 4 (R6): a Python function name reaching SQL, a query grid cell or a table rule gets the clear message, never a raw error.
import { test, expect, type Page } from '@playwright/test'
import { createTable } from '../../src/main/db/schema'
import { saveObject } from '../../src/main/db/objects'
import { f, t } from '../../src/shared/test-fixtures'
import { launchApp, pickView, seedBase } from './helpers'

const SOURCE = 'def remise(prix):\n    return prix * 0.9\n'
const MESSAGE = 'La fonction Python remise ne peut pas être utilisée ici'
const doc = (page: Page) => page.locator('section[role=tabpanel]:not([hidden])')

const base = () => seedBase('python-refusals', (db) => {
  const m = saveObject(db, 'module', 'Calculs', { formatVersion: '1.0', source: SOURCE, exports: [{ name: 'remise', params: ['prix'] }] }, null)
  if (!m.ok) throw new Error(m.reason)
  createTable(db, t('Produits', [f('Id', 'autoNumber'), f('Prix', 'number', { numberSize: 'double' })]))
  db.prepare('INSERT INTO "Produits" ("Prix") VALUES (?)').run(100)
  saveObject(db, 'query', 'QOk', { formatVersion: '1.0', sql: 'SELECT Prix FROM Produits' }, null)
  saveObject(db, 'query', 'QImport', { formatVersion: '1.0', sql: 'SELECT remise(Prix) AS R FROM Produits' }, null)   // as an import would store it
})

test('Python functions are refused clearly in the SQL view, the query grid, a stored query and table rules', async () => {
  test.setTimeout(180_000)
  const { app, page } = await launchApp({ args: [base()], env: { BASECRAFT_REGION: 'fr-FR' } })
  try {
    // SQL view: save and run
    await page.getByTestId('nav-item-query-QOk').click({ button: 'right' })
    await page.getByTestId('nav-menu-design').click()
    await pickView(page, 'viewSql')
    await doc(page).getByTestId('query-sql').fill('SELECT remise(Prix) AS R FROM Produits')
    await page.keyboard.press('Control+s')
    await expect(doc(page).getByTestId('query-sql-error')).toContainText(MESSAGE)
    await page.getByTestId('status-view-datasheet').click()
    await expect(doc(page).getByTestId('query-sql-error')).toContainText(MESSAGE)

    // the grid: the Field cell is refused at once, and the run points at it
    await doc(page).getByTestId('query-sql').fill('SELECT Prix FROM Produits')
    await page.getByTestId('status-view-design').click()
    await doc(page).getByTestId('qbe-cell-field-0').fill('R: remise([Prix])')
    await doc(page).getByTestId('qbe-cell-field-0').press('Tab')
    await expect(doc(page).getByTestId('qbe-cell-field-0-error')).toContainText(MESSAGE)
    await page.getByTestId('status-view-datasheet').click()
    await expect(page.getByTestId('modal')).toContainText(MESSAGE)
    await page.getByTestId('modal-btn-ok').click()

    // a stored query that calls the function: the message at opening, the app stays usable
    await page.getByTestId('nav-item-query-QImport').dblclick()
    await expect(page.getByTestId('modal')).toContainText(MESSAGE)
    await page.getByTestId('modal-btn-ok').click()
    await expect(page.getByTestId('nav-item-query-QOk')).toBeVisible()

    // table design: Validation Rule and Default Value
    await page.getByTestId('nav-item-Produits').click({ button: 'right' })
    await page.getByTestId('nav-menu-design').click()
    await page.getByTestId('design-row-1-name').click()
    await page.getByTestId('prop-validationRule').fill('remise([Prix])>0')
    await page.getByTestId('prop-validationRule').press('Tab')
    await expect(page.getByTestId('prop-validationRule-error')).toContainText(MESSAGE)
    await page.getByTestId('prop-defaultValue').fill('remise(1)')
    await page.getByTestId('prop-defaultValue').press('Tab')
    await expect(page.getByTestId('prop-defaultValue-error')).toContainText(MESSAGE)
  } finally {
    await app.close()
  }
})
