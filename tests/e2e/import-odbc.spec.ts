import { test, expect, type Page } from '@playwright/test';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { liveDriver, makeLiveSource } from '../../src/main/import/odbc.live';
import { launchApp, seedBase } from './helpers';

// Backlog C4: External Data › Import › « Base de données ODBC » reads a SQLite file through the SQLite ODBC driver (Windows with the
// driver installed, or BASECRAFT_ODBC_TEST_DRIVER); without one the test is skipped.
const fr = JSON.parse(readFileSync(join(__dirname, '../../src/shared/i18n/fr.json'), 'utf8'));
const title = (page: Page) => page.getByTestId('modal').locator('.modal-title');

test('External Data › Import › ODBC Database copies a table into a local table; a wrong source is said', async () => {
  const driver = liveDriver();
  test.skip(!driver, 'no SQLite ODBC driver (BASECRAFT_ODBC_TEST_DRIVER)');
  test.setTimeout(120_000);
  const dir = mkdtempSync(join(tmpdir(), 'bcodbc-e2e-'));
  const file = join(dir, 'src.db');
  makeLiveSource(file);
  const front = seedBase('Front', () => undefined);
  const { app, page } = await launchApp({ args: [front], env: { BASECRAFT_REGION: 'fr-FR' } });
  try {
    await page.getByTestId('ribbon-tab-externalData').click();
    await expect(page.getByTestId('cmd-importOdbc')).toHaveText(fr.ribbon.cmd.importOdbc);
    await page.getByTestId('cmd-importOdbc').click();
    await expect(title(page)).toHaveText(fr.import.odbc.title);

    await page.getByTestId('odbc-connection').fill(`Driver={${driver}};Database=${join(dir, 'absent', 'no.db')}`);
    await page.getByTestId('odbc-connect').click();
    await expect(page.getByTestId('odbc-error')).toBeVisible();

    await page.getByTestId('odbc-connection').fill(`Driver={${driver}};Database=${file}`);
    await page.getByTestId('odbc-connect').click();
    await expect(page.getByTestId('link-table-Clients')).toBeVisible();
    await expect(page.getByTestId('link-ok')).toHaveText(fr.import.server.ok);
    await page.getByTestId('link-table-Clients').check();
    await page.getByTestId('link-ok').click();
    await expect(page.getByTestId('import-result')).toContainText(fr.import.server.done.replace('{{names}}', 'Clients'));
    await page.getByTestId('import-close').click();

    await page.getByTestId('nav-item-Clients').dblclick();
    await expect(page.getByTestId('nav-record-count')).toHaveText('2');
    await expect(page.getByTestId('glide-cell-2-0')).toHaveText('Zoé "x"; é');
  } finally {
    await app.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
