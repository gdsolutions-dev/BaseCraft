import { test, expect } from '@playwright/test';
import { launchApp, seedSalesE2E, pickView } from './helpers';

const closeWindow = (app: Awaited<ReturnType<typeof launchApp>>['app']) => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close());

test('closing the window asks to save a new query, even unmodified', async () => {
  const { app, page } = await launchApp({ args: [seedSalesE2E('quit-new-query')], env: { BASECRAFT_REGION: 'fr-FR' } });
  try {
    await page.getByTestId('ribbon-tab-create').click();
    await page.getByTestId('cmd-createQueryDesign').click();
    await page.getByTestId('show-table-close').click();
    await closeWindow(app);
    await expect(page.getByTestId('modal')).toBeVisible({ timeout: 5000 });
    await page.getByTestId('modal-btn-cancel').click();
    expect(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length)).toBe(1);
  } finally {
    await app.close().catch(() => undefined);
  }
});

for (const [name, cmd] of [['table', 'cmd-createTableDesign'], ['form', 'cmd-createFormDesign'], ['report', 'cmd-createReportDesign']] as const) {
  test(`closing the window asks to save a new ${name}`, async () => {
    const { app, page } = await launchApp({ args: [seedSalesE2E(`quit-new-${name}`)], env: { BASECRAFT_REGION: 'fr-FR' } });
    try {
      await page.getByTestId('ribbon-tab-create').click();
      await page.getByTestId(cmd).click();
      await closeWindow(app);
      await expect(page.getByTestId('modal')).toBeVisible({ timeout: 5000 });
      await page.getByTestId('modal-btn-cancel').click();
    } finally {
      await app.close().catch(() => undefined);
    }
  });
}

test('a new query shown in Datasheet view runs unsaved, and closing the window still asks', async () => {
  const { app, page } = await launchApp({ args: [seedSalesE2E('quit-new-query-run')], env: { BASECRAFT_REGION: 'fr-FR' } });
  try {
    await page.getByTestId('ribbon-tab-create').click();
    await page.getByTestId('cmd-createQueryDesign').click();
    await page.getByTestId('show-table-Commandes').check();
    await page.getByTestId('show-table-add').click();
    await page.getByTestId('show-table-close').click();
    await page.locator('[data-testid="qbe-field-Commandes-Montant"]').last().dblclick();
    await pickView(page, 'viewDatasheet');
    await expect(page.getByTestId('modal')).toHaveCount(0); // no "save first"
    await expect(page.getByTestId('nav-record-count')).toBeVisible();
    await closeWindow(app);
    await expect(page.getByTestId('modal')).toBeVisible({ timeout: 5000 });
    await page.getByTestId('modal-btn-cancel').click();
  } finally {
    await app.close().catch(() => undefined);
  }
});

test('a modified saved query runs as it stands (no "save first"), its changes stay in Design, closing the window asks', async () => {
  const { app, page } = await launchApp({ args: [seedSalesE2E('quit-modified-query')], env: { BASECRAFT_REGION: 'fr-FR' } });
  try {
    await page.getByTestId('nav-item-query-QVentes').click({ button: 'right' });
    await page.getByTestId('nav-menu-design').click();
    await page.getByTestId('qbe-field-Commandes-Le').first().dblclick(); // a column added: the design is modified
    await expect(page.getByTestId('doc-tab-query-QVentes')).toContainText('•');
    await pickView(page, 'viewDatasheet');
    await expect(page.getByTestId('modal')).toHaveCount(0);
    await expect(page.getByTestId('nav-record-count')).toBeVisible();
    await page.getByTestId('status-view-design').click();
    await expect(page.getByTestId('modal')).toHaveCount(0);
    await expect(page.locator('section:not([hidden]) [data-testid="qbe-cell-field-3"]')).toHaveCount(1); // the change is still in the grid
    await pickView(page, 'viewDatasheet');
    await closeWindow(app);
    await expect(page.getByTestId('modal')).toBeVisible({ timeout: 5000 });
    await page.getByTestId('modal-btn-cancel').click();
  } finally {
    await app.close().catch(() => undefined);
  }
});
