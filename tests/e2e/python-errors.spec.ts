// D2 Task 8 (R10): the Python error dialog (type, message, module, line), « Débogage » opening the module at the line,
// Action Failed for a RunCode error, no « Débogage » in the Runtime.
import { test, expect } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { saveObject } from '../../src/main/db/objects'
import type { ControlDef, DesignDoc } from '../../src/shared/design/model'
import { launchApp, seedBase, seedForm } from './helpers'

const fr = JSON.parse(readFileSync(join(__dirname, '../../src/shared/i18n/fr.json'), 'utf8'))
const button = (name: string, top: number, onClick: unknown): ControlDef =>
  ({ kind: 'commandButton', name, left: 1701, top, width: 2268, height: 340, props: { Caption: name, OnClick: onClick } })
const form = (controls: ControlDef[]): DesignDoc => ({
  formatVersion: '1.0', recordSource: null, props: { Width: 6000 },
  sections: [{ kind: 'formHeader', height: 0, props: { Visible: false }, controls: [] },
    { kind: 'detail', height: 2400, props: {}, controls },
    { kind: 'formFooter', height: 0, props: { Visible: false }, controls: [] }],
})
const SOURCE = 'def casser():\n    x = 1\n    return 1 / 0\n'
const runCode = { embedded: { formatVersion: '1.0' as const, items: [{ k: 'action', action: 'RunCode', args: { FunctionName: 'casser()' } }] } }
const base = () => seedBase('python-errors', (db) => {
  const m = saveObject(db, 'module', 'Err', { formatVersion: '1.0', source: SOURCE, exports: [{ name: 'casser', params: [] }] }, null)
  if (!m.ok) throw new Error(m.reason)
  seedForm(db, 'FErr', form([button('cmdCasser', 600, '=casser()'), button('cmdMacro', 1100, runCode)]))
})

test('Python error dialog names type, module and line; Débogage opens the module at the line; Fin closes; RunCode shows Action Failed', async () => {
  test.setTimeout(240_000)
  const { app, page } = await launchApp({ args: [base()] })
  try {
    await page.getByTestId('nav-item-form-FErr').dblclick()
    await page.getByTestId('form-ctl-cmdCasser').click()
    await expect(page.getByTestId('python-error-text')).toContainText('ZeroDivisionError', { timeout: 120_000 })
    await expect(page.getByTestId('python-error-where')).toHaveText('Module Err, ligne 3')
    await page.getByTestId('python-error-end').click()
    await expect(page.getByTestId('modal')).toHaveCount(0)

    await page.getByTestId('form-ctl-cmdMacro').click()
    await expect(page.getByTestId('macro-failed-message')).toContainText('ZeroDivisionError', { timeout: 60_000 })
    await expect(page.getByTestId('python-error-where')).toHaveText('Module Err, ligne 3')
    await page.getByTestId('python-error-debug').click()
    await expect(page.getByTestId('modal')).toHaveCount(0)
    await expect(page.getByTestId('module-editor')).toBeVisible()
    await expect(page.locator('.cm-activeLine')).toContainText('return 1 / 0')
    await expect(page.locator('.cm-bc-error-line')).toContainText('return 1 / 0')
    await expect(page.getByTestId('module-error')).toContainText('ZeroDivisionError')
  } finally { await app.close() }
})

test('Runtime: the Python error dialog has no Débogage', async () => {
  test.setTimeout(240_000)
  const { app, page } = await launchApp({ runtime: true, args: [base()] })
  try {
    await page.getByTestId('nav-item-form-FErr').dblclick()
    await page.getByTestId('form-ctl-cmdCasser').click()
    await expect(page.getByTestId('python-error-text')).toContainText('ZeroDivisionError', { timeout: 120_000 })
    await expect(page.getByTestId('python-error-where')).toHaveText(fr.python.error.where.replace('{{module}}', 'Err').replace('{{line}}', '3'))
    await expect(page.getByTestId('python-error-debug')).toHaveCount(0)
    await page.getByTestId('python-error-end').click()
    await expect(page.getByTestId('modal')).toHaveCount(0)
  } finally { await app.close() }
})
