import { test, expect } from '@playwright/test';
import { colLeft, launchApp, seedSalesE2E } from './helpers';

// The Quick Access Toolbar's Undo on data (Access): in a datasheet, the record being edited is dropped (Escape); in a form, the
// record's entry is undone. Enabled only while a record is being edited; Redo stays off (Access has none for data).
test('Undo in a datasheet drops the pending record; in a form it undoes the record\'s entry', async () => {
  const { app, page } = await launchApp({ args: [seedSalesE2E('acces-rapide-annuler')], env: { BASECRAFT_REGION: 'fr-FR' } });
  const undo = page.getByTestId('qat-undo'), redo = page.getByTestId('qat-redo');
  try {
    await page.getByTestId('nav-item-Clients').dblclick();
    const sheet = page.locator('[data-testid="datasheet"]:visible');
    const nom = sheet.getByTestId('glide-cell-2-0');   // Glide's accessible copy of the cell: clicked through the canvas
    await expect(nom).toHaveText('Dupont');
    await expect(undo).toBeDisabled();
    const b = (await sheet.getByTestId('data-grid-canvas').boundingBox())!;
    await page.mouse.click(b.x + colLeft(1) + 20, b.y + 34 + 15);
    await expect(nom).toHaveAttribute('aria-selected', 'true');
    await page.keyboard.press('F2');
    await page.keyboard.type('x');
    await page.keyboard.press('Tab');   // the cell left: the record is pending
    await expect(nom).toHaveText('Dupontx');
    await expect(undo).toBeEnabled();
    await expect(redo).toBeDisabled();
    await undo.click();
    await expect(nom).toHaveText('Dupont');
    await expect(undo).toBeDisabled();

    await page.getByTestId('nav-item-Clients').click();
    await page.getByTestId('ribbon-tab-create').click();
    await page.getByTestId('cmd-createForm').click();
    const ctl = page.getByTestId('form-ctl-Nom');
    await expect(ctl).toHaveValue('Dupont');
    await expect(undo).toBeDisabled();
    await ctl.fill('Durand');
    await expect(undo).toBeEnabled();
    await undo.click();
    await expect(ctl).toHaveValue('Dupont');
    await expect(undo).toBeDisabled();
    await page.getByTestId('doc-tab-close-form-Clients').click();
    await page.getByTestId('modal-btn-no').click();
  } finally {
    await app.close();
  }
});
