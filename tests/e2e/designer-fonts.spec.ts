// O3 Task 6: designer fonts through CSS variables — the Property Sheet size (form, query and table sheets) and the query
// design font (QBE grid, table boxes). Views already open follow at once; rows grow with the font; the SQL view stays monospace.
import { test, expect, type Page, type Locator } from '@playwright/test';
import { seedSales } from '../../src/main/query/test-db';
import type { ControlDef, DesignDoc } from '../../src/shared/design/model';
import { launchApp, seedBase, seedForm } from './helpers';

const FR = { BASECRAFT_REGION: 'fr-FR' };
const doc = (page: Page) => page.locator('section[role=tabpanel]:not([hidden])');
const FCLIENT: DesignDoc = {
  formatVersion: '1.0', recordSource: { kind: 'table', name: 'Clients' }, props: { Width: 9072 },
  sections: [{ kind: 'formHeader', height: 0, props: { Visible: false }, controls: [] },
    { kind: 'detail', height: 1200, props: {}, controls: [{ kind: 'textBox', name: 'Nom', left: 1701, top: 100, width: 2268, height: 340, props: { ControlSource: 'Nom' } } as ControlDef] },
    { kind: 'formFooter', height: 0, props: { Visible: false }, controls: [] }],
};
const css = (l: Locator, p: string) => l.evaluate((e, k) => getComputedStyle(e).getPropertyValue(k), p);
const px = async (l: Locator) => parseFloat(await css(l, 'font-size'));
const unclipped = (l: Locator) => l.evaluateAll((els) => els.every((e) => e.scrollHeight <= e.clientHeight + 1));
async function openDesign(page: Page, item: string) {
  await page.getByTestId(item).click({ button: 'right' });
  await page.getByTestId('nav-menu-design').click();
}

test('sheet and query design fonts: defaults, then live change in open views', async () => {
  test.setTimeout(150_000);
  const base = seedBase('designer-fonts', (db) => { seedSales(db); seedForm(db, 'FClient', FCLIENT); });
  const { app, page } = await launchApp({ args: [base], env: FR });
  try {
    await openDesign(page, 'nav-item-form-FClient');
    const formLabel = doc(page).locator('.dz-prow > label').first();
    await expect(formLabel).toBeVisible();
    expect(Math.abs((await px(formLabel)) - 10.6667)).toBeLessThan(0.01);

    await page.getByTestId('ribbon-tab-create').click();
    await page.getByTestId('cmd-createQueryDesign').click();
    await page.getByTestId('show-table-Clients').check();
    await page.getByTestId('show-table-add').click();
    await page.getByTestId('show-table-close').click();
    await doc(page).getByTestId('qbe-field-Clients-Nom').dblclick();
    const cellField = doc(page).getByTestId('qbe-cell-field-0');
    expect(Math.abs((await px(cellField)) - 10.6667)).toBeLessThan(0.01);
    expect(await css(cellField, 'font-family')).toMatch(/^"?Segoe UI/);
    const field = doc(page).getByTestId('qbe-field-Clients-Nom');
    const rowBefore = (await field.boundingBox())!.height;
    await page.getByTestId('cmd-propertySheet').click();
    const qrow = page.getByTestId('query-props').locator('.prow > label').first();
    expect(Math.abs((await px(qrow)) - 10.6667)).toBeLessThan(0.01);

    // change both while the form, the query (and a table's sheet) are open
    await page.getByTestId('ribbon-tab-file').click();
    await page.getByTestId('bs-options').click();
    await page.getByTestId('opt-cat-designers').click();
    await page.getByTestId('opt-sheet-font').selectOption('14');
    await page.getByTestId('opt-query-font').fill('Liberation Serif');
    await page.getByTestId('opt-query-font').press('Enter');
    await page.getByTestId('opt-query-size').fill('16');
    await page.getByTestId('opt-query-size').press('Enter');
    await page.getByTestId('bs-back').click();

    expect(Math.abs((await px(qrow)) - 18.6667)).toBeLessThan(0.01);
    expect(Math.abs((await px(cellField)) - 21.3333)).toBeLessThan(0.01);
    expect(await css(cellField, 'font-family')).toMatch(/^"Liberation Serif"/);
    expect(await unclipped(doc(page).locator('.qg td, .qg th'))).toBe(true);
    expect(await unclipped(page.getByTestId('query-props').locator('.prow'))).toBe(true);
    // rows grew with the font, and the join anchors follow (same size feeds boxHeight and the row style)
    const rowAfter = (await field.boundingBox())!.height;
    expect(rowAfter).toBeGreaterThan(rowBefore);
    expect(rowAfter).toBe(40);
    const box = doc(page).getByTestId('qbe-box-Clients');
    const bh = (await box.boundingBox())!.height;
    expect(Math.round(bh)).toBe(2 + 34 + 8 + (await box.locator('.qbe-field').count()) * 40); // boxHeight: every row at the grown height

    // SQL view keeps its monospace font
    await page.getByTestId('status-view-sql').click();
    expect(await css(doc(page).getByTestId('query-sql'), 'font-family')).toMatch(/mono/i);
    await page.getByTestId('status-view-design').click();

    // the form's sheet follows (its tab was open the whole time)
    await page.getByTestId('doc-tab-form-FClient').click();
    expect(Math.abs((await px(formLabel)) - 18.6667)).toBeLessThan(0.01);
    expect(await unclipped(doc(page).locator('.dz-prow'))).toBe(true);

    // a table's sheet follows too
    await openDesign(page, 'nav-item-Clients');
    await page.getByTestId('cmd-propertySheet').click();
    expect(Math.abs((await px(page.getByTestId('table-properties').locator('.prow > label').first())) - 18.6667)).toBeLessThan(0.01);
    // ...but the field properties pane of Table Design keeps its 12 px (O3 R7)
    const fprow = doc(page).locator('.fprops .prow > label').first();
    await expect(fprow).toBeVisible();
    expect(await px(fprow)).toBe(12);
  } finally {
    await app.close();
  }
});
