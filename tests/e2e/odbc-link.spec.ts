import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { launchApp, seedBase } from './helpers';

// Backlog D1: External Data › ODBC Database › « Lier » on the fake ODBC source (BASECRAFT_E2E_FAKE_ODBC=1, host.ts: table Pays = France,
// Italie; it refuses a connection without PWD=secret). The password is never stored: after a restart the table asks its login.
const fr = JSON.parse(readFileSync(join(__dirname, '../../src/shared/i18n/fr.json'), 'utf8'));
const ENV = { BASECRAFT_REGION: 'fr-FR', BASECRAFT_E2E_FAKE_ODBC: '1' };

test('D1: an ODBC table linked read-only, its login asked again after a restart', async () => {
  test.setTimeout(120_000);
  const front = seedBase('Front', () => undefined);
  let { app, page, userDataDir } = await launchApp({ args: [front], env: ENV });
  try {
    await page.getByTestId('ribbon-tab-externalData').click();
    await page.getByTestId('cmd-importOdbc').click();
    await expect(page.getByTestId('odbc-mode-link')).toBeVisible();
    await page.getByTestId('odbc-mode-link').check();
    await page.getByTestId('odbc-connection').fill('Driver=fake');
    await page.getByTestId('odbc-password').fill('secret');
    await page.getByTestId('odbc-connect').click();
    await expect(page.getByTestId('link-ok')).toHaveText(fr.link.ok);
    await page.getByTestId('link-table-Pays').check();
    await page.getByTestId('link-ok').click();
    await expect(page.getByTestId('link-dialog')).toHaveCount(0);

    await page.getByTestId('nav-item-Pays').dblclick();
    await expect(page.getByTestId('nav-record-count')).toHaveText('2');
    await expect(page.getByTestId('glide-cell-2-0')).toHaveText('France');
    await app.close();

    // the password was never stored: a restart asks the login; a wrong one is refused, the right one shows the rows
    ({ app, page } = await launchApp({ args: [front], env: ENV, userDataDir }));
    await page.getByTestId('nav-item-Pays').dblclick();
    await expect(page.getByTestId('login-dialog')).toBeVisible();
    await expect(page.getByTestId('login-remember')).toBeDisabled();
    await page.getByTestId('login-user').fill('u');
    await page.getByTestId('login-password').fill('faux');
    await page.getByTestId('login-ok').click();
    await expect(page.getByTestId('login-error')).toHaveText(fr.link.login.wrong);
    await page.getByTestId('login-password').fill('secret');
    await page.getByTestId('login-ok').click();
    await expect(page.getByTestId('login-dialog')).toHaveCount(0);
    await expect(page.getByTestId('nav-record-count')).toHaveText('2');
    await expect(page.getByTestId('glide-cell-2-1')).toHaveText('Italie');
  } finally {
    await app.close();
  }
});
