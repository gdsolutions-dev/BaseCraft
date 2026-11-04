// D3 Task 6 (R8): « Visualiser le code » in Form Design and Report Design opens the module of the first Python event function at its
// def line, else a new module.
import { test, expect, type Page } from '@playwright/test'
import { saveObject } from '../../src/main/db/objects'
import type { ControlDef, DesignDoc, SectionDef } from '../../src/shared/design/model'
import { launchApp, seedBase, seedForm } from './helpers'

const SOURCE = `def autre():
    return 1

def marquer():
    return 2

def fmt():
    return 3
`
const exp = ['autre', 'marquer', 'fmt'].map((name) => ({ name, params: [] as string[] }))
const sec = (kind: SectionDef['kind'], controls: ControlDef[]): SectionDef => ({ kind, height: 800, props: {}, controls })
const btn = (props: Record<string, unknown>): ControlDef => ({ kind: 'commandButton', name: 'Bouton', left: 100, top: 100, width: 1500, height: 400, props: { Caption: 'Go', ...props } })
const doc = (props: Record<string, unknown>, controls: ControlDef[]): DesignDoc =>
  ({ formatVersion: '1.0', recordSource: null, props: { Width: 6000, ...props }, sections: [sec('detail', controls)] })

const base = () => seedBase('python-view-code', (db) => {
  const m = saveObject(db, 'module', 'Ev', { formatVersion: '1.0', source: SOURCE, exports: exp }, null)
  if (!m.ok) throw new Error(m.reason)
  seedForm(db, 'FPy', doc({}, [btn({ OnClick: '=marquer()' })]))
  seedForm(db, 'FSans', doc({}, [btn({})]))
  const r = saveObject(db, 'report', 'EPy', doc({ OnFormat: '=fmt()' }, [btn({})]), null)
  if (!r.ok) throw new Error(r.reason)
})

async function design(page: Page, item: string) {
  await page.getByTestId(item).click({ button: 'right' })
  await page.getByTestId('nav-menu-design').click()
}

test('View Code opens the module at the def line, else a new module (form and report)', async () => {
  test.setTimeout(240_000)
  const { app, page } = await launchApp({ args: [base()] })
  try {
    await design(page, 'nav-item-form-FPy')
    await page.getByTestId('cmd-viewCode').click()
    await expect(page.getByTestId('module-editor')).toBeVisible()
    await expect(page.locator('.cm-bc-error-line')).toContainText('def marquer(')

    await design(page, 'nav-item-form-FSans')
    await page.getByTestId('cmd-viewCode').click()
    await expect(page.locator('[data-testid^="doc-tab-module-"]')).toHaveCount(2)

    await design(page, 'nav-item-report-EPy')
    await page.getByTestId('cmd-viewCode').click()
    await expect(page.locator('.cm-bc-error-line')).toContainText('def fmt(')
  } finally { await app.close() }
})
