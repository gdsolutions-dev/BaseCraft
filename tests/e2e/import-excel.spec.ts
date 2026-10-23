import { test, expect, type Page } from '@playwright/test';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { launchApp, seedBase } from './helpers';
import { makeA6Xlsx } from './fixtures/make-a6-xlsx';

const fr = JSON.parse(readFileSync(join(__dirname, '../../src/shared/i18n/fr.json'), 'utf8'));
const count = (page: Page, table: string) => page.evaluate((t) => (window as any).basecraft.rows.count(t), table);
const step = (page: Page) => page.getByTestId('import-step');

test('import a worksheet into a new table, then append another from the Navigation Pane', async () => {
  const xlsx = join(mkdtempSync(join(tmpdir(), 'basecraft-xlsx-')), 'a6.xlsx');
  await makeA6Xlsx(xlsx);
  const { app, page } = await launchApp({ args: [seedBase('import-excel')], env: { BASECRAFT_REGION: 'fr-FR', BASECRAFT_E2E_EXCEL_PATH: xlsx } });
  try {
    // the renderer cannot make the main process read a workbook the user did not choose
    await expect(page.evaluate((p) => (window as any).basecraft.importExcel.preview(p, null, null), xlsx)).rejects.toThrow(/bc:invalidArgument/);

    await page.getByTestId('ribbon-tab-externalData').click();
    await page.getByTestId('cmd-importExcel').click();
    await expect(page.getByTestId('import-wizard')).toBeVisible();
    await page.getByTestId('import-browse').click();
    await expect(page.getByTestId('import-path')).toHaveValue(xlsx);
    await page.getByTestId('import-btn-next').click();

    await expect(step(page)).toHaveAttribute('data-step', 'sheet');
    await expect(page.getByTestId('import-sheet-Clients')).toBeChecked();
    await expect(page.getByTestId('import-sheet-Vide')).toBeVisible();
    await expect(page.getByTestId('import-has-header')).toBeChecked();
    await expect(page.getByTestId('import-preview')).toContainText('Dupont');
    await page.getByTestId('import-btn-next').click();

    await expect(step(page)).toHaveAttribute('data-step', 'fields');
    await page.getByTestId('import-col-2').click();
    await expect(page.getByTestId('import-field-type')).toHaveValue('double');
    await page.getByTestId('import-btn-next').click();
    await expect(page.getByTestId('import-pk-auto')).toBeChecked();
    await page.getByTestId('import-btn-next').click();
    await expect(page.getByTestId('import-table-name')).toHaveValue('Clients');
    await page.getByTestId('import-btn-finish').click();
    await expect(page.getByTestId('import-summary-imported')).toHaveText(fr.importText.finish.imported.replace('{{count}}', '4').replace('{{table}}', 'Clients'));
    await expect(page.getByTestId('import-summary-errors')).toContainText('Clients_ErreursImportation');
    await page.getByTestId('import-btn-close').click();
    expect(await count(page, 'Clients')).toBe(4);
    const rows = await page.evaluate(() => (window as any).basecraft.rows.page('Clients', { offset: 0, limit: 10 }));
    expect(rows.rows[0].values).toEqual([1, 'Dupont', '01000', 12.5, '2026-10-23 00:00:00', '2026-10-23 09:05:00']);

    // Navigation Pane › Import › Excel on that table: appends the Produits sheet, columns mapped by name
    await page.getByTestId('nav-item-Clients').click({ button: 'right' });
    await page.getByTestId('nav-menu-import').click();
    await page.getByTestId('nav-menu-import-excel').click();
    await expect(page.getByTestId('import-dest-append')).toBeChecked();
    await page.getByTestId('import-browse').click();
    await page.getByTestId('import-btn-next').click();
    await page.getByTestId('import-sheet-Produits').click(); // the preview is fetched: checked once it arrives
    await expect(page.getByTestId('import-sheet-Produits')).toBeChecked();
    await expect(page.getByTestId('import-preview')).toContainText('Stylo');
    await page.getByTestId('import-btn-next').click();
    await expect(step(page)).toHaveAttribute('data-step', 'fields');
    await expect(page.getByTestId('import-field-target')).toHaveValue('Nom');
    await page.getByTestId('import-btn-finish').click();
    await expect(page.getByTestId('import-summary-imported')).toContainText('2');
    await page.getByTestId('import-btn-close').click();
    await expect.poll(() => count(page, 'Clients')).toBe(6);
    await expect(page.getByTestId('nav-record-count')).toHaveText('6'); // the open datasheet reloaded
  } finally {
    await app.close();
  }
});
