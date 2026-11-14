import { test, expect, type Page } from '@playwright/test';
import { createTable } from '../../src/main/db/schema';
import { insertRow } from '../../src/main/db/write-layer';
import { localeInfo } from '../../src/shared/locale-format';
import { f, t } from '../../src/shared/test-fixtures';
import { colLeft, launchApp, seedBase } from './helpers';

const lines = t('Lines', [f('N', 'autoNumber'), f('Qty', 'number'), f('Price', 'currency')]);
const HEADER = 34, ROW = 30;
const design = (page: Page) => page.evaluate(() => (window as any).basecraft.tables.design('Lines'));
const rows = (page: Page) => page.evaluate(() => (window as any).basecraft.rows.page('Lines', { offset: 0, limit: 10 }));

test('Table Fields: Modify Expression makes a calculated field the write layer keeps up to date', async () => {
  test.setTimeout(90_000);
  const base = await seedBase('champ-calcule', async (db) => {
    createTable(db, lines);
    await insertRow(db, lines, { Qty: '2', Price: '5' }, localeInfo('en-US'));
  });
  const { app, page } = await launchApp({ env: { BASECRAFT_REGION: 'fr-FR' }, args: [base] });
  try {
    await page.getByTestId('nav-item-Lines').dblclick();
    await expect(page.getByTestId('datasheet')).toBeVisible();
    await page.getByTestId('ribbon-tab-tableFields').click();
    // add a Currency field after Price, then give it an expression
    const b = (await page.getByTestId('datasheet').getByTestId('data-grid-canvas').boundingBox())!;
    await page.mouse.click(b.x + colLeft(2) + 30, b.y + HEADER + ROW / 2);
    await page.getByTestId('cmd-addCurrency').click();
    const headers = page.getByTestId('datasheet').locator('th[role=columnheader]');
    await expect(headers).toHaveText(['N', 'Qty', 'Price', 'Champ1']); // the reload is done
    await page.mouse.click(b.x + colLeft(3) + 30, b.y + HEADER + ROW / 2);
    await page.getByTestId('cmd-modifyExpression').click();
    await page.getByTestId('xb-text').fill('[Qty] * [Price]');
    await page.getByTestId('xb-ok').click();
    await expect.poll(async () => (await design(page)).fields[3].props.calculated).toBe('[Qty] * [Price]');
    // the existing row got its value, and a new write recomputes it
    await expect.poll(async () => (await rows(page)).rows[0].values[3]).toBe(10);
    await page.evaluate(() => (window as any).basecraft.rows.update('Lines', 1, { Qty: '3' }));
    await expect.poll(async () => (await rows(page)).rows[0].values[3]).toBe(15);
  } finally {
    await app.close();
  }
});

test('Table Design: Calculated in the Data Type list, Result Type, dropped by another type', async () => {
  test.setTimeout(90_000);
  const base = await seedBase('champ-calcule-conception', async (db) => {
    createTable(db, lines);
    await insertRow(db, lines, { Qty: '2', Price: '5' }, localeInfo('en-US'));
  });
  const { app, page } = await launchApp({ env: { BASECRAFT_REGION: 'fr-FR' }, args: [base] });
  try {
    await page.getByTestId('nav-item-Lines').click({ button: 'right' });
    await page.getByTestId('nav-menu-design').click();
    await page.getByTestId('design-row-3-name').fill('Total'); // the trailing empty row
    await page.getByTestId('design-row-3-type').selectOption('calculated'); // opens the Expression Builder
    await page.getByTestId('xb-text').fill('[Qty] * [Price]');
    await page.getByTestId('xb-ok').click();
    await expect(page.getByTestId('design-row-3-type')).toHaveValue('calculated');
    await expect(page.getByTestId('prop-calculated')).toHaveValue('[Qty] * [Price]');
    await page.getByTestId('prop-resultType').selectOption('currency');
    await page.keyboard.press('Control+s');
    await expect.poll(async () => (await design(page)).fields[3]?.props).toMatchObject({ type: 'currency', calculated: '[Qty] * [Price]' });
    await expect.poll(async () => (await rows(page)).rows[0].values[3]).toBe(10);
    // another Data Type drops the expression
    await page.getByTestId('design-row-3-type').selectOption('number');
    await expect(page.getByTestId('prop-calculated')).toHaveCount(0);
    await page.keyboard.press('Control+s');
    await expect.poll(async () => (await design(page)).fields[3]?.props.calculated).toBeUndefined();
  } finally {
    await app.close();
  }
});
