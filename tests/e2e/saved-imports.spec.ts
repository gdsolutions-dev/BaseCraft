import { test, expect, type Page } from '@playwright/test';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { launchApp, seedBase } from './helpers';

const CSV = 'Name,Qty\nTea,3\nCoffee,5\n';
const count = (page: Page, table: string) => page.evaluate((t) => (window as any).basecraft.rows.count(t), table);

test('Saved Imports: the steps of a text import are kept, then run again on the file asked', async () => {
  test.setTimeout(90_000);
  const dir = mkdtempSync(join(tmpdir(), 'basecraft-saved-import-'));
  const csv = join(dir, 'Items.csv');
  writeFileSync(csv, CSV, 'utf8');
  const { app, page } = await launchApp({ args: [seedBase('saved-imports')], env: { BASECRAFT_E2E_IMPORT_PATH: csv } });
  try {
    await page.getByTestId('ribbon-tab-externalData').click();
    await page.getByTestId('cmd-importText').click();
    await page.getByTestId('import-browse').click();
    await expect(page.getByTestId('import-path')).toHaveValue(csv);
    await page.getByTestId('import-btn-next').click();
    await page.getByTestId('import-btn-finish').click();
    await expect(page.getByTestId('import-summary-imported')).toBeVisible();
    await page.getByTestId('import-save-check').check();
    await page.getByTestId('import-save-name').fill('Items import');
    await page.getByTestId('import-btn-close').click();
    await expect(page.getByTestId('import-wizard')).toHaveCount(0);
    const table = (await page.evaluate(() => (window as any).basecraft.tables.list()))[0].name;
    expect(await count(page, table)).toBe(2);

    // run it again: the file is asked, the table exists, so the rows are appended
    await page.getByTestId('cmd-savedImports').click();
    await expect(page.getByTestId('saved-import-Items import')).toBeVisible();
    await page.getByTestId('saved-import-run-Items import').click();
    await page.getByTestId('modal-btn-ok').click();
    await expect.poll(() => count(page, table)).toBe(4);

    // delete it
    await page.getByTestId('cmd-savedImports').click();
    await page.getByTestId('saved-import-delete-Items import').click();
    await expect(page.getByTestId('saved-import-empty')).toBeVisible();
  } finally {
    await app.close();
  }
});
