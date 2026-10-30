import { test, expect } from '@playwright/test';
import { existsSync, mkdirSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { launchApp, openDbOptions, seedSalesE2E } from './helpers';

const fr = JSON.parse(readFileSync(join(__dirname, '../../src/shared/i18n/fr.json'), 'utf8'));

test('C3: Database Tools › Split Database moves the tables to a shared data file; the base becomes its front-end', async () => {
  const front = seedSalesE2E('Ventes');
  const data = join(dirname(front), 'share', 'Ventes_donnees.basecraft');
  mkdirSync(dirname(data));
  const env = { BASECRAFT_REGION: 'fr-FR', BASECRAFT_E2E_SAVE_PATH: data };
  let { app, page, userDataDir } = await launchApp({ args: [front], env });
  try {
    await page.getByTestId('nav-item-Clients').dblclick(); // an open document is closed first, as before Compact
    await expect(page.getByTestId('doc-tab-Clients')).toHaveCount(1);
    await page.getByTestId('ribbon-tab-databaseTools').click();
    await expect(page.getByTestId('cmd-splitDatabase')).toHaveText(fr.ribbon.cmd.splitDatabase);
    await page.getByTestId('cmd-splitDatabase').click();
    await page.getByTestId('split-cancel').click(); // Cancel: nothing done
    await expect(page.getByTestId('modal')).toHaveCount(0);
    await expect(page.getByTestId('doc-tab-Clients')).toHaveCount(1);
    await page.getByTestId('cmd-splitDatabase').click();
    const dialog = page.getByTestId('split-dialog');
    await expect(dialog).toContainText(fr.split.intro);
    await expect(page.getByTestId('modal')).toContainText(fr.split.title);
    await page.getByTestId('split-ok').click();

    const done = page.getByTestId('modal');
    await expect(done).toContainText(fr.split.done.split(' : {{path}}')[0]);
    const backups = readdirSync(dirname(front)).filter((x) => x.startsWith('Ventes.backup-'));
    expect(backups).toHaveLength(1); // the backup beside the original
    const backup = join(dirname(front), backups[0]!);
    await expect(done).toContainText(fr.split.done.replace('{{path}}', data).replace('{{backup}}', backup));
    await expect(page.getByTestId('doc-tab-Clients')).toHaveCount(0);
    await page.getByTestId('modal-btn-ok').click();
    expect(existsSync(data)).toBe(true);

    // the pane lists the links
    await expect(page.getByTestId('nav-item-link-Clients')).toBeVisible();
    await expect(page.getByTestId('nav-item-link-Commandes')).toBeVisible();
    await expect(page.getByTestId('nav-item-query-QVentes')).toBeVisible(); // the queries stay in the front-end

    // Clients is read from the data file: Durand's Ville changed there shows
    const w = new DatabaseSync(data, { timeout: 5000 });
    try { w.prepare(`UPDATE "Clients" SET "Ville" = 'Lille' WHERE "Nom" = 'Durand'`).run(); } finally { w.close(); }
    await page.getByTestId('nav-item-Clients').dblclick();
    await expect(page.getByTestId('datasheet').getByTestId('data-grid-canvas')).toBeVisible();
    await expect(page.getByTestId('glide-cell-2-2')).toHaveText('Durand');
    await expect(page.getByTestId('glide-cell-3-2')).toHaveText('Lille');

    // File › Options › « Base de données active »: the base is a front-end now
    await page.getByTestId('ribbon-tab-file').click();
    await openDbOptions(page);
    await expect(page.getByTestId('opt-db-frontend')).toBeChecked();
    await expect(page.getByTestId('opt-db-datafile')).not.toBeChecked();
  } finally {
    await app.close();
  }

  // BaseCraft Runtime has no Split Database (B5: SplitDialog.tsx is a designer module)
  ({ app, page } = await launchApp({ runtime: true, args: [front], env, userDataDir }));
  try {
    await expect(page.getByTestId('ribbon-tab-home')).toBeVisible();
    await expect(page.getByTestId('ribbon-tab-databaseTools')).toHaveCount(0);
    await expect(page.getByTestId('cmd-splitDatabase')).toHaveCount(0);
  } finally {
    await app.close();
  }
});
