// B4 Task 8: Query Design › Crosstab — the Crosstab row of the grid (R13), Column Headings (PIVOT … IN), the read-only
// datasheet, [Forms]! parameters (Review Focus 4) and headings read again on Refresh (R14).
import { test, expect, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { saveObject } from '../../src/main/db/objects';
import { seedSales, seedSalesRelation } from '../../src/main/query/test-db';
import type { BasecraftApi } from '../../src/shared/api';
import type { ControlDef, DesignDoc } from '../../src/shared/design/model';
import { launchApp, SALES_QUERIES, seedBase, seedForm } from './helpers';

const fr = JSON.parse(readFileSync(join(__dirname, '../../src/shared/i18n/fr.json'), 'utf8'));
const FR = { BASECRAFT_REGION: 'fr-FR' };
type Win = { basecraft: BasecraftApi };

const doc = (page: Page) => page.locator('section[role=tabpanel]:not([hidden])');
const headers = (page: Page) => doc(page).getByTestId('datasheet').locator('th[role=columnheader]');
const sqlOf = (page: Page, name: string) => page.evaluate((n) => (window as unknown as Win).basecraft.objects.get('query', n)
  .then((g) => (g.definition as { sql: string }).sql), name);
async function type(page: Page, id: string, text: string) {
  await doc(page).getByTestId(id).fill(text);
  await doc(page).getByTestId(id).press('Tab');
}
async function save(page: Page) {
  await page.keyboard.press('Control+s');
  await expect(page.getByTestId('doc-tab-query-QVentesMois')).not.toContainText('•');
}

/** seedSalesE2E with FCrit: an unbound form with a text box Du. */
const base = () => seedBase('crosstab', (db) => {
  seedSales(db);
  seedSalesRelation(db);
  for (const [q, sql] of SALES_QUERIES) saveObject(db, 'query', q, { formatVersion: '1.0', sql }, null);
  const du: ControlDef = { kind: 'textBox', name: 'Du', left: 1701, top: 100, width: 2268, height: 340, props: {} };
  const form: DesignDoc = {
    formatVersion: '1.0', recordSource: null, props: { Width: 6000 },
    sections: [{ kind: 'formHeader', height: 0, props: { Visible: false }, controls: [] }, { kind: 'detail', height: 2000, props: {}, controls: [du] },
      { kind: 'formFooter', height: 0, props: { Visible: false }, controls: [] }],
  };
  seedForm(db, 'FCrit', form);
});

test('Query Design › Crosstab: the Crosstab row, a read-only datasheet, Column Headings, [Forms]! parameters, headings read again', async () => {
  test.setTimeout(120_000);
  const { app, page } = await launchApp({ args: [base()], env: FR });
  try {
    // 1. the grid
    await page.getByTestId('ribbon-tab-create').click();
    await page.getByTestId('cmd-createQueryDesign').click();
    await page.getByTestId('show-table-Clients').check();
    await page.getByTestId('show-table-Commandes').check();
    await page.getByTestId('show-table-add').click();
    await page.getByTestId('show-table-close').click();
    await expect(page.getByTestId('cmd-crosstabQuery')).toBeEnabled();
    await page.getByTestId('cmd-crosstabQuery').click();
    await expect(page.getByTestId('cmd-crosstabQuery')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByTestId('cmd-queryTotals')).toBeDisabled(); // Total is forced on (R13)
    const rowLabels = doc(page).getByTestId('qbe-grid').locator('th[scope=row]');
    await expect(rowLabels).toContainText([fr.query.row.total, fr.query.row.crosstab]);
    await expect(rowLabels.filter({ hasText: fr.query.row.show })).toHaveCount(0);
    await doc(page).getByTestId('qbe-field-Clients-Nom').dblclick();
    await expect(doc(page).getByTestId('qbe-cell-total-0')).toHaveValue('groupBy');
    await doc(page).getByTestId('qbe-cell-crosstab-0').selectOption({ label: fr.query.crosstab.rowHeading });
    await type(page, 'qbe-cell-field-1', 'Mois: Mois([Le])');
    await doc(page).getByTestId('qbe-cell-crosstab-1').selectOption({ label: fr.query.crosstab.columnHeading });
    await expect(doc(page).getByTestId('qbe-cell-sort-1')).toBeDisabled(); // no Sort on the Column Heading (R13)
    await doc(page).getByTestId('qbe-field-Commandes-Montant').dblclick();
    await doc(page).getByTestId('qbe-cell-total-2').selectOption({ label: fr.query.total.sum });
    await doc(page).getByTestId('qbe-cell-crosstab-2').selectOption({ label: fr.query.crosstab.value });
    await type(page, 'qbe-cell-field-3', 'Total: Montant');
    await doc(page).getByTestId('qbe-cell-total-3').selectOption({ label: fr.query.total.sum });
    await doc(page).getByTestId('qbe-cell-crosstab-3').selectOption({ label: fr.query.crosstab.rowHeading });
    await page.keyboard.press('Control+s');
    await page.getByTestId('modal-input').fill('QVentesMois');
    await page.getByTestId('modal-btn-ok').click();
    await expect(page.getByTestId('nav-item-query-QVentesMois')).toBeVisible();

    // 2. its datasheet: read-only, no new record (Review Focus 5)
    await page.getByTestId('status-view-datasheet').click();
    await expect(headers(page)).toHaveText(['Nom', 'Total', '9', '10']);
    await expect(doc(page).getByTestId('nav-record-count')).toHaveText('3');
    await expect(doc(page).getByTestId('nav-readonly')).toHaveText(fr.query.readOnly);
    await expect(doc(page).getByTestId('nav-new')).toBeDisabled();
    await expect(doc(page).getByTestId('glide-cell-1-3')).toHaveCount(0);
    expect((await page.evaluate(() => (window as unknown as Win).basecraft.sources.page({ kind: 'query', name: 'QVentesMois' }, { offset: 0, limit: 100 }))).rows)
      .toEqual([['Dupont', 10.2, null, 10.2], ['Durand', 99.99, 99.99, null], ['Martin', 0.3, null, 0.3]]);

    // 3. SQL view, then back to the grid: the canonical order (row headings, Column Heading, Value)
    await page.getByTestId('status-view-design').click();
    await page.getByTestId('cmd-viewSql').click();
    const sql = doc(page).getByTestId('query-sql');
    await expect(sql).toHaveValue(/^TRANSFORM Sum\(\[Commandes\]\.\[Montant\]\)\n/);
    // an expression column keeps its names as typed (A3): [Le] stays unqualified
    await expect(sql).toHaveValue(/\nPIVOT Month\(\[Le\]\) AS \[Mois\];$/);
    await page.getByTestId('status-view-design').click();
    await expect(doc(page).getByTestId('qbe-cell-field-0')).toHaveValue('Nom');
    for (const [i, field, total, role] of [[0, 'Nom', 'groupBy', 'rowHeading'], [1, /^Total: /, 'sum', 'rowHeading'],
      [2, /^Mois: Mois\(/, 'groupBy', 'columnHeading'], [3, 'Montant', 'sum', 'value']] as const) {
      await expect(doc(page).getByTestId(`qbe-cell-field-${i}`)).toHaveValue(field);
      await expect(doc(page).getByTestId(`qbe-cell-total-${i}`)).toHaveValue(total);
      await expect(doc(page).getByTestId(`qbe-cell-crosstab-${i}`)).toHaveValue(role);
    }

    // 4. Column Headings: the listed values, in their order; anything but a value refused
    await page.getByTestId('cmd-propertySheet').click();
    await expect(page.getByTestId('query-props-top')).toHaveCount(0); // no Top, Unique Values or Output All Fields
    await expect(page.getByTestId('query-props-distinct')).toHaveCount(0);
    await expect(page.getByTestId('query-props-outputAll')).toHaveCount(0);
    await page.getByTestId('query-props-headings').fill('10;9;11');
    await page.getByTestId('query-props-ok').click();
    await save(page);
    expect(await sqlOf(page, 'QVentesMois')).toMatch(/\nPIVOT Month\(\[Le\]\) AS \[Mois\] IN \(10, 9, 11\);$/);
    await page.getByTestId('status-view-datasheet').click();
    await expect(headers(page)).toHaveText(['Nom', 'Total', '10', '9', '11']);
    await page.getByTestId('status-view-design').click();
    await page.getByTestId('cmd-propertySheet').click();
    await expect(page.getByTestId('query-props-headings')).toHaveValue('10;9;11');
    await page.getByTestId('query-props-headings').fill('[x]');
    await page.getByTestId('query-props-ok').click();
    await expect(page.getByTestId('query-props-headings-error')).toHaveText(fr.query.props.badHeadings);

    // 5. Column Headings cleared; a Where column on [Formulaires]! (Review Focus 4)
    await page.getByTestId('query-props-headings').fill('');
    await page.getByTestId('query-props-ok').click();
    await doc(page).getByTestId('qbe-field-Commandes-Le').dblclick();
    await doc(page).getByTestId('qbe-cell-total-4').selectOption({ label: fr.query.total.where });
    await doc(page).getByTestId('qbe-cell-crosstab-4').selectOption({ label: fr.query.crosstab.none });
    await type(page, 'qbe-cell-criteria0-4', '>=[Formulaires]![FCrit]![Du]');
    await save(page);
    await page.getByTestId('nav-item-form-FCrit').dblclick();
    const du = page.locator('[data-testid="form-ctl-Du"]:visible');
    await du.fill('01/10/2026');
    await du.press('Tab');
    await page.getByTestId('doc-tab-query-QVentesMois').click();
    await page.getByTestId('status-view-datasheet').click();
    await expect(headers(page)).toHaveText(['Nom', 'Total', '10']);
    await expect(page.getByTestId('modal')).toHaveCount(0); // asked nothing
    await page.getByTestId('doc-tab-close-form-FCrit').click();
    await expect(page.getByTestId('doc-tab-form-FCrit')).toHaveCount(0);
    await page.getByTestId('doc-tab-query-QVentesMois').click();
    await page.getByTestId('status-view-design').click();
    await page.getByTestId('status-view-datasheet').click();
    await expect(page.getByTestId('modal')).toContainText('[Forms]![FCrit]![Du]'); // one prompt, labelled with the reference
    await page.getByTestId('modal-input').fill('01/09/2026');
    await page.getByTestId('modal-btn-ok').click();
    await expect(headers(page)).toHaveText(['Nom', 'Total', '9', '10']);
    await expect(page.getByTestId('modal')).toHaveCount(0);

    // 6. without the criterion: an order in a new month, Shift+F9 → a column 11 (R14)
    await page.getByTestId('status-view-design').click();
    await doc(page).getByTestId('qbe-colsel-4').click();
    await page.getByTestId('cmd-deleteColumns').click();
    await save(page);
    await page.getByTestId('status-view-datasheet').click();
    await expect(headers(page)).toHaveText(['Nom', 'Total', '9', '10']);
    expect(await page.evaluate(() => (window as unknown as Win).basecraft.rows.insert('Commandes', { Client: 1, Montant: 3, Le: '05/11/2026' }))).toMatchObject({ ok: true });
    await page.keyboard.press('Shift+F9');
    await expect(headers(page)).toHaveText(['Nom', 'Total', '9', '10', '11']);
    await expect(doc(page).getByTestId('glide-cell-5-0')).toHaveText(/^3/); // Dupont's November
  } finally {
    await app.close();
  }
});
