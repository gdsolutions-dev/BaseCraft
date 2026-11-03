import { test, expect, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { liveParams, noLiveServer, withSchema } from '../../src/main/connectors/postgres/live';
import { createTable } from '../../src/main/db/schema';
import { f, t } from '../../src/shared/test-fixtures';
import { launchApp, seedBase } from './helpers';

// C7 R17: External Data › Import › « PostgreSQL » against the live PostgreSQL (BASECRAFT_PG_TEST_URL), in a schema of its own.
const fr = JSON.parse(readFileSync(join(__dirname, '../../src/shared/i18n/fr.json'), 'utf8'));
const ENV = { BASECRAFT_REGION: 'fr-FR' };
const title = (page: Page) => page.getByTestId('modal').locator('.modal-title');

test('External Data › Import › PostgreSQL copies a server table into a local table; skipped columns said; a name in use gets a number', async () => {
  test.skip(noLiveServer(), 'BASECRAFT_PG_TEST_URL is not set'); // fails on Linux CI without it (M7)
  test.setTimeout(180_000);
  await withSchema(async (admin, schema) => {
    await admin.query(`CREATE TABLE "Villes" (id serial PRIMARY KEY, "Nom" varchar(80), "Pop" numeric(12,2), photo bytea);
      INSERT INTO "Villes" ("Nom", "Pop") VALUES ('Lyon', 513.25), ('Brest', NULL)`);
    const { params, login } = liveParams();
    const name = `${schema}_Villes`; // R6: a table outside public
    const front = seedBase('Front', (db) => createTable(db, t(name, [f('N°', 'autoNumber')])));
    const { app, page } = await launchApp({ args: [front], env: ENV });
    try {
      await page.getByTestId('ribbon-tab-externalData').click();
      await expect(page.getByTestId('cmd-importPostgreSql')).toHaveText(fr.ribbon.cmd.importPostgreSql);
      await page.getByTestId('cmd-importPostgreSql').click();
      await expect(title(page)).toHaveText(fr.import.server.title);
      await page.getByTestId('srv-host').fill(params.host);
      await page.getByTestId('srv-port').fill(String(params.port));
      await page.getByTestId('srv-database').fill(params.database);
      await page.getByTestId('srv-user').fill(params.user);
      await page.getByTestId('srv-tls').selectOption(params.tls);
      await page.getByTestId('srv-password').fill(login.password);
      await page.getByTestId('srv-connect').click();
      // the name the front-end uses is not offered: a number is added
      await expect(page.getByTestId(`link-table-${name}1`)).toBeVisible();
      await expect(page.getByTestId('link-ok')).toHaveText(fr.import.server.ok);
      await page.getByTestId(`link-table-${name}1`).check();
      await page.getByTestId('link-ok').click();

      const done = fr.import.server.done.replace('{{names}}', `${name}1`);
      await expect(page.getByTestId('import-result')).toContainText(done);
      await expect(page.getByTestId(`import-skipped-${name}1`)).toHaveText(fr.import.server.skipped.replace('{{table}}', `${name}1`).replace('{{names}}', 'photo'));
      await page.getByTestId('import-close').click();

      // a local table, not a link: its rows are there
      await expect(page.getByTestId(`nav-item-link-${name}1`)).toHaveCount(0);
      await page.getByTestId(`nav-item-${name}1`).dblclick();
      await expect(page.getByTestId('nav-record-count')).toHaveText('2');
      await expect(page.getByTestId('glide-cell-2-0')).toHaveText('Lyon');
      await expect(page.getByTestId('glide-cell-3-0')).toHaveText('513,25');
    } finally {
      await app.close();
    }
  });
});
