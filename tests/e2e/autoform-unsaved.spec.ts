import { test, expect } from '@playwright/test';
import { launchApp, seedSalesE2E } from './helpers';

// Create › Form (AutoForm), as Access: the form opens in Form view unsaved; closing its tab asks, Yes saves it under the proposed
// name (its source's), No drops it. Save (Ctrl+S, the Quick Access Toolbar) saves it too, asking its name.
test('Create › Form opens the form unsaved; closing asks, Yes saves it under its source name', async () => {
  const { app, page } = await launchApp({ args: [seedSalesE2E('autoform-unsaved')], env: { BASECRAFT_REGION: 'fr-FR' } });
  try {
    await page.getByTestId('nav-item-Clients').click();
    await page.getByTestId('ribbon-tab-create').click();
    await page.getByTestId('cmd-createForm').click();
    await expect(page.getByTestId('doc-tab-form-Clients')).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByTestId('form-ctl-Nom')).toBeVisible();   // Form view, the records shown
    await expect(page.getByTestId('nav-item-form-Clients')).toHaveCount(0);   // not saved
    await page.getByTestId('doc-tab-close-form-Clients').click();
    await expect(page.getByTestId('modal')).toContainText('Clients');
    await page.getByTestId('modal-btn-yes').click();
    await expect(page.getByTestId('modal-input')).toHaveValue('Clients');
    await page.getByTestId('modal-btn-ok').click();
    await expect(page.getByTestId('nav-item-form-Clients')).toBeVisible();
    await expect(page.getByTestId('doc-tab-form-Clients')).toHaveCount(0);
  } finally {
    await app.close();
  }
});

test('Create › Form: No on closing drops the form; Save keeps it under a name asked', async () => {
  const { app, page } = await launchApp({ args: [seedSalesE2E('autoform-unsaved-no')], env: { BASECRAFT_REGION: 'fr-FR' } });
  try {
    await page.getByTestId('nav-item-Clients').click();
    await page.getByTestId('ribbon-tab-create').click();
    await page.getByTestId('cmd-createForm').click();
    await expect(page.getByTestId('form-ctl-Nom')).toBeVisible();
    await page.getByTestId('doc-tab-close-form-Clients').click();
    await page.getByTestId('modal-btn-no').click();
    await expect(page.getByTestId('doc-tab-form-Clients')).toHaveCount(0);
    await expect(page.getByTestId('nav-item-form-Clients')).toHaveCount(0);

    await page.getByTestId('nav-item-Clients').click();
    await page.getByTestId('cmd-createForm').click();
    await expect(page.getByTestId('form-ctl-Nom')).toBeVisible();
    await page.getByTestId('qat-save').click();
    await expect(page.getByTestId('modal-input')).toHaveValue('Clients');
    await page.getByTestId('modal-input').fill('Fiche client');
    await page.getByTestId('modal-btn-ok').click();
    await expect(page.getByTestId('nav-item-form-Fiche client')).toBeVisible();
    await expect(page.getByTestId('doc-tab-form-Fiche client')).toHaveAttribute('aria-selected', 'true');
  } finally {
    await app.close();
  }
});

// Create › Report (AutoReport), the same way: Print Preview unsaved; Save from the preview, or Yes on closing, names it after its source.
test('Create › Report opens the report unsaved; Save from the preview asks its name; closing another asks too', async () => {
  const { app, page } = await launchApp({ args: [seedSalesE2E('autoreport-unsaved')], env: { BASECRAFT_REGION: 'fr-FR' } });
  const cur = page.locator('.doc:not([hidden])');
  try {
    await page.getByTestId('nav-item-Clients').click();
    await page.getByTestId('ribbon-tab-create').click();
    await page.getByTestId('cmd-createReport').click();
    await expect(page.getByTestId('doc-tab-report-Clients')).toHaveAttribute('aria-selected', 'true');
    await expect(cur.getByTestId('preview-page-of')).toHaveText(/^Page 1 sur \d+$/);
    await expect(page.getByTestId('nav-item-report-Clients')).toHaveCount(0);
    await page.getByTestId('qat-save').click();
    await expect(page.getByTestId('modal-input')).toHaveValue('Clients');
    await page.getByTestId('modal-btn-ok').click();
    await expect(page.getByTestId('nav-item-report-Clients')).toBeVisible();
    await expect(page.getByTestId('doc-tab-report-Clients')).not.toContainText('•');

    await page.getByTestId('nav-item-Clients').click();
    await page.getByTestId('ribbon-tab-create').click();   // Print Preview took the ribbon
    await page.getByTestId('cmd-createReport').click();   // a free name: Clients1
    await expect(page.getByTestId('doc-tab-report-Clients1')).toHaveAttribute('aria-selected', 'true');
    await expect(cur.getByTestId('preview-page-of')).toHaveText(/^Page 1 sur \d+$/);
    await page.getByTestId('doc-tab-close-report-Clients1').click();
    await expect(page.getByTestId('modal')).toContainText('Clients1');
    await page.getByTestId('modal-btn-no').click();
    await expect(page.getByTestId('doc-tab-report-Clients1')).toHaveCount(0);
    await expect(page.getByTestId('nav-item-report-Clients1')).toHaveCount(0);
  } finally {
    await app.close();
  }
});
