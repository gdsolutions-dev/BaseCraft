// C7: the sort order of a database (Options › General for new bases, Options › Current Database for the open one, applied by Compact and Repair).
import { test, expect, type Page } from '@playwright/test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createTable } from '../../src/main/db/schema';
import { insertRow } from '../../src/main/db/write-layer';
import { localeInfo } from '../../src/shared/locale-format';
import { f, t } from '../../src/shared/test-fixtures';
import { launchApp, openDbOptions, seedBase } from './helpers';

const FR = { BASECRAFT_REGION: 'fr-FR' };
const MOTS = t('Mots', [f('Mot', 'shortText')]);
const sorted = (page: Page) => page.evaluate(() => (window as any).basecraft.rows.page('Mots', { offset: 0, limit: 20, sort: { field: 'Mot', dir: 'asc' } }).then((p: any) => p.rows.map((r: any) => r.values[0])));

test('a new base takes the workstation\'s sort order', async () => {
  const target = join(mkdtempSync(join(tmpdir(), 'basecraft-neworder-')), 'nouvelle.basecraft');
  const { app, page } = await launchApp({ env: { ...FR, BASECRAFT_E2E_SAVE_PATH: target } });
  try {
    await page.getByTestId('bs-options').click();
    await expect(page.getByTestId('opt-sort-order')).toHaveValue('general');
    await page.getByTestId('opt-sort-order').selectOption('swedish');
    await expect.poll(() => page.evaluate(() => (window as any).basecraft.app.getSettings().then((s: any) => s.newSortOrder))).toBe('swedish');
    await page.evaluate(() => (window as any).basecraft.base.create());
    await expect.poll(() => page.evaluate(() => (window as any).basecraft.base.state().then((s: any) => s?.path))).toBe(target);
    expect(await page.evaluate(() => (window as any).basecraft.base.sortOrder())).toEqual({ applied: 'swedish', pending: null });
  } finally {
    await app.close();
  }
  const db = new DatabaseSync(target, { readOnly: true });
  try { expect(JSON.parse((db.prepare(`SELECT value FROM bc_meta WHERE key = 'options'`).get() as { value: string }).value).sortOrder).toBe('swedish'); } finally { db.close(); }
});

test('a datasheet sorts by the base\'s order; a changed order waits for Compact and Repair', async () => {
  const base = await seedBase('ordre', async (db) => {
    createTable(db, MOTS);
    for (const m of ['zebra', 'åker', 'ägg', 'apa']) await insertRow(db, MOTS, { Mot: m }, localeInfo('fr-FR'));
  });
  const { app, page } = await launchApp({ args: [base], env: FR });
  try {
    expect(await sorted(page)).toEqual(['ägg', 'åker', 'apa', 'zebra']); // General: å and ä are a
    await page.getByTestId('ribbon-tab-file').click();
    await openDbOptions(page);
    await expect(page.getByTestId('opt-db-sort-order')).toHaveValue('general');
    await page.getByTestId('opt-db-sort-order').selectOption('swedish');
    await expect(page.getByTestId('opt-db-sort-order-pending')).toBeVisible();
    expect(await sorted(page)).toEqual(['ägg', 'åker', 'apa', 'zebra']); // not applied yet
    await page.getByTestId('bs-back').click();
    await page.getByTestId('ribbon-tab-databaseTools').click();
    await page.getByTestId('cmd-compactRepair').click();
    await page.getByTestId('modal-btn-ok').click(); // the report
    await expect.poll(() => sorted(page)).toEqual(['apa', 'zebra', 'åker', 'ägg']); // Swedish: å, ä, ö after z
    await page.getByTestId('ribbon-tab-file').click();
    await openDbOptions(page);
    await expect(page.getByTestId('opt-db-sort-order')).toHaveValue('swedish');
    await expect(page.getByTestId('opt-db-sort-order-pending')).toHaveCount(0);
  } finally {
    await app.close();
  }
});

test('a query compares and groups texts by the base\'s order (Swedish: å, ä, ö come after z)', async () => {
  const base = await seedBase('ordre-sv', async (db) => {
    db.prepare(`UPDATE bc_meta SET value = json_set(value, '$.sortOrder', 'swedish') WHERE key = 'options'`).run();
    createTable(db, MOTS);
    for (const m of ['zebra', 'åker', 'ÅKER', 'ägg', 'apa']) await insertRow(db, MOTS, { Mot: m }, localeInfo('fr-FR'));
  });
  const { app, page } = await launchApp({ args: [base], env: FR });
  try {
    const run = (sql: string) => page.evaluate((s) => (window as any).basecraft.sources.page({ kind: 'sql', sql: s }, { offset: 0, limit: 20 }).then((p: any) => p.rows.map((r: any) => r.join('|'))), sql);
    expect((await run('SELECT Mot FROM Mots WHERE Mot > "zz" ORDER BY Mot')).sort()).toEqual(['ägg', 'åker', 'ÅKER'].sort());
    expect((await run('SELECT Mot, Count(*) AS n FROM Mots GROUP BY Mot ORDER BY Mot')).map((r: string) => r.toLowerCase())).toEqual(['apa|1', 'zebra|1', 'åker|2', 'ägg|1']);
  } finally {
    await app.close();
  }
});
