import { test, expect, type Page } from '@playwright/test';
import { createTable } from '../../src/main/db/schema';
import { defaultProps } from '../../src/shared/field-types';
import { launchApp, seedBase, seedReportsE2E } from './helpers';

// « Achats » comes before « Factures »: Factures is selected only because its datasheet is the active document.
const seed = (name: string) => seedBase(name, (db) => {
  createTable(db, { name: 'Achats', fields: [{ name: 'Article', props: defaultProps('shortText') }] });
  seedReportsE2E(db);
});
const cur = (page: Page) => page.locator('.doc:not([hidden])');

async function createReport(page: Page) {
  await page.getByTestId('ribbon-tab-create').click();
  await page.getByTestId('cmd-createReport').click();
  await expect(page.getByTestId('source-picker-list')).toBeVisible();
}

test('Create > Report: a tabular report on the active table, saved under a free name and shown in Print Preview', async () => {
  const { app, page } = await launchApp({ args: [seed('instantane')], env: { BASECRAFT_REGION: 'fr-FR' } });
  try {
    await page.getByTestId('nav-item-Factures').dblclick();
    await expect(page.getByTestId('doc-tab-Factures')).toBeVisible();

    await createReport(page);
    await expect(page.getByTestId('source-picker-list')).toHaveValue('table:Factures');
    await page.getByTestId('source-picker-ok').click();
    await expect(page.getByTestId('doc-tab-report-Factures')).toHaveAttribute('aria-selected', 'true');
    await expect(cur(page).getByTestId('preview-page-of')).toHaveText(/^Page 1 sur \d+$/);
    const first = cur(page).locator('.bc-page').first();
    await expect(first).toContainText('Factures');
    await expect(first).toContainText(/Page 1 sur \d+/);
    await expect(page.getByTestId('nav-group-report').getByTestId('nav-item-report-Factures')).toBeVisible();

    await createReport(page);   // the report is active now: the navigation pane selection or the first source is offered
    await page.getByTestId('source-picker-list').selectOption('table:Factures');
    await page.getByTestId('source-picker-ok').click();
    await expect(page.getByTestId('doc-tab-report-Factures1')).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByTestId('nav-item-report-Factures1')).toBeVisible();

    await createReport(page);
    await page.getByTestId('source-picker-cancel').click();
    await expect(page.getByTestId('source-picker-list')).toHaveCount(0);
    await expect(page.getByTestId('nav-group-report').locator('[data-testid^="nav-item-report-"]')).toHaveCount(3);   // + Factures par client
  } finally {
    await app.close();
  }
});

test('read-only base: Create > Report is disabled', async () => {
  const base = seed('instantane-ro');
  const first = await launchApp({ args: [base] });
  const second = await launchApp({ args: [base] });
  try {
    await second.page.getByTestId('ribbon-tab-create').click();
    await expect(second.page.getByTestId('cmd-createReport')).toBeDisabled();
    await first.page.getByTestId('ribbon-tab-create').click();
    await expect(first.page.getByTestId('cmd-createReport')).toBeEnabled();
  } finally {
    await second.app.close();
    await first.app.close();
  }
});
