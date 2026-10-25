import { test, expect, type Page } from '@playwright/test';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openBaseFile } from '../../src/main/db/file-format';
import { saveObject } from '../../src/main/db/objects';
import { seedSales, seedSalesRelation } from '../../src/main/query/test-db';
import type { BasecraftApi } from '../../src/shared/api';
import { launchApp, seedBase } from './helpers';

const fr = JSON.parse(readFileSync(join(__dirname, '../../src/shared/i18n/fr.json'), 'utf8'));
const FR = { BASECRAFT_REGION: 'fr-FR' };
type Win = { basecraft: BasecraftApi };

const MACRO = { formatVersion: '1.0', items: [{ k: 'action', action: 'Beep', args: {} }] };
const BEFORE = [10.1, 0.1, 0.2, 99.99, 0.1];
const montants = (page: Page) => page.evaluate(() => (window as unknown as Win).basecraft.rows.page('Commandes', { offset: 0, limit: 100 })
  .then((p) => p.rows.map((r) => r.values[2])));
const content = (page: Page) => page.evaluate(() => (window as unknown as Win).basecraft.base.state().then((s) => s?.content));
/** The base's content is decided, then the bar is (not) there: a bar not yet drawn never passes for "no bar". */
async function noBar(page: Page, state: 'none' | 'enabled') {
  await expect.poll(() => content(page)).toBe(state);
  await expect(page.getByTestId('nav-item-query-QMaj')).toBeVisible();
  await expect(page.getByTestId('banner-content')).toHaveCount(0);
}

/** Clients / Commandes with a macro and the action query QMaj (active content), and a plain select query. */
const seedActive = (name: string) => seedBase(name, (db) => {
  seedSales(db);
  seedSalesRelation(db);
  saveObject(db, 'macro', 'MAuto', MACRO, null);
  saveObject(db, 'query', 'QMaj', { formatVersion: '1.0', sql: 'UPDATE Commandes SET Montant = Montant * 2;' }, null);
});

test('untrusted base: the bar blocks action queries until "Activer le contenu"; the approval is remembered, a change elsewhere asks again', async () => {
  const base = seedActive('trust-active');
  const userDataDir = mkdtempSync(join(tmpdir(), 'basecraft-trust-'));
  const open = () => launchApp({ args: [base], env: FR, userDataDir, untrusted: true });

  let { app, page } = await open();
  try {
    const bar = page.getByTestId('banner-content');
    await expect(bar).toBeVisible();
    await expect(bar).toContainText(fr.banner.contentDisabled);
    await expect(page.getByTestId('banner-enable-content')).toHaveText(fr.banner.enableContent);

    await page.getByTestId('nav-item-query-QMaj').dblclick(); // Open: blocked, nothing asked, nothing written
    await expect(page.getByTestId('modal')).toContainText(fr.query.action.contentDisabled);
    await page.getByTestId('modal-btn-ok').click();
    await expect(page.getByTestId('modal')).toHaveCount(0);
    await expect(page.getByTestId('doc-tab-query-QMaj')).toHaveCount(0);
    expect(await montants(page)).toEqual(BEFORE);

    await page.getByTestId('banner-enable-content').click();
    await expect(bar).toHaveCount(0);
    await page.getByTestId('nav-item-query-QMaj').dblclick(); // enabled: the count is asked, Yes writes
    await expect(page.getByTestId('modal')).toContainText(fr.query.action.confirm_update_other.replace('{{count}}', '5'));
    await page.getByTestId('modal-btn-yes').click();
    await expect(page.getByTestId('modal')).toHaveCount(0);
    await expect.poll(() => montants(page)).toEqual([20.2, 0.2, 0.4, 199.98, 0.2]);
  } finally {
    await app.close();
  }

  // same user data folder (trust.json): remembered
  ({ app, page } = await open());
  try {
    await noBar(page, 'enabled');
  } finally {
    await app.close();
  }

  // the macro edited while the app is closed (another program): not the content approved
  const { db } = openBaseFile(base, 'write', '0.0.0');
  try {
    const r = saveObject(db, 'macro', 'MAuto', { ...MACRO, items: [...MACRO.items, { k: 'comment', text: 'changé ailleurs' }] }, 'MAuto');
    expect(r.ok).toBe(true);
  } finally {
    db.close();
  }
  ({ app, page } = await open());
  try {
    await expect(page.getByTestId('banner-content')).toBeVisible();
    expect(await content(page)).toBe('disabled');
    // dismissing the bar leaves the content disabled
    await page.getByTestId('banner-dismiss-content').click();
    await expect(page.getByTestId('banner-content')).toHaveCount(0);
    await page.getByTestId('nav-item-query-QMaj').dblclick();
    await expect(page.getByTestId('modal')).toContainText(fr.query.action.contentDisabled);
    await page.getByTestId('modal-btn-ok').click();
  } finally {
    await app.close();
  }
});

test('no bar: a base without active content opened untrusted, or an active one in a trusted folder', async () => {
  const plain = seedBase('trust-plain', (db) => {
    seedSales(db);
    saveObject(db, 'query', 'QMaj', { formatVersion: '1.0', sql: 'SELECT * FROM Commandes;' }, null); // a select query is not active content
  });
  let { app, page } = await launchApp({ args: [plain], env: FR, untrusted: true });
  try {
    await noBar(page, 'none');
  } finally {
    await app.close();
  }

  ({ app, page } = await launchApp({ args: [seedActive('trust-folder')], env: FR })); // the temporary folder is trusted
  try {
    await noBar(page, 'enabled');
  } finally {
    await app.close();
  }
});
