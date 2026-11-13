// Format tab of the form designer: Conditional Formatting (rules on a text box), seen in Form view (Continuous Forms).
// Background Image is main's image gallery, covered by images-background.spec.ts.
import { test, expect } from '@playwright/test';
import { createTable } from '../../src/main/db/schema';
import type { DesignDoc } from '../../src/shared/design/model';
import { clients } from '../../src/shared/test-fixtures';
import { launchApp, pickView, seedBase, seedForm } from './helpers';

const fiche: DesignDoc = { formatVersion: '1.0', recordSource: { kind: 'table', name: 'Clients' }, props: { Width: 9072, DefaultView: 'continuous' }, sections: [
  { kind: 'formHeader', height: 0, props: { Visible: false }, controls: [] },
  { kind: 'detail', height: 600, props: {}, controls: [
    { kind: 'textBox', name: 'Nom', left: 200, top: 100, width: 2268, height: 340, props: { ControlSource: 'Nom' } },
    { kind: 'textBox', name: 'Age', left: 2800, top: 100, width: 1418, height: 340, props: { ControlSource: 'Âge' } }] },
  { kind: 'formFooter', height: 0, props: { Visible: false }, controls: [] }] };

test('Format: Conditional Formatting reaches the Form view', async ({}, testInfo) => {
  test.setTimeout(120000);
  const base = seedBase('format-fond-conditions', (db) => {
    createTable(db, clients);
    seedForm(db, 'Fiche', fiche);
    db.exec(`INSERT INTO "Clients"("Nom", "Âge") VALUES ('Alice', 20), ('Bob', 40), ('Carole', 31)`);
  });
  const { app, page } = await launchApp({ args: [base], env: { BASECRAFT_REGION: 'fr-FR' } });
  try {
    await page.getByTestId('nav-item-form-Fiche').click({ button: 'right' });
    await page.getByTestId('nav-menu-design').click();
    await expect(page.getByTestId('ctl-Age')).toBeVisible();
    await page.getByTestId('ribbon-tab-format').click();

    // Conditional Formatting needs exactly one text box
    await expect(page.getByTestId('cmd-conditionalFormatting')).toBeDisabled();
    await page.getByTestId('ctl-Age').click();
    await expect(page.getByTestId('cmd-conditionalFormatting')).toBeEnabled();
    await page.getByTestId('cmd-conditionalFormatting').click();
    await page.getByTestId('cond-add').click();
    await page.getByTestId('cond-op-0').selectOption('greater');
    await page.getByTestId('cond-a-0').fill('30');
    await page.getByTestId('cond-back-0').fill('#ffcc00');
    await page.getByTestId('cond-ok').click();
    await expect(page.getByTestId('cond-dialog')).toHaveCount(0);
    // an unreadable expression keeps the dialog open
    await page.getByTestId('cmd-conditionalFormatting').click();
    await expect(page.getByTestId('cond-a-0')).toHaveValue('30');
    await page.getByTestId('cond-a-0').fill('30 +');
    await page.getByTestId('cond-ok').click();
    await expect(page.getByTestId('cond-error')).toBeVisible();
    await page.getByTestId('cond-cancel').click();

    await page.getByTestId('ribbon-tab-formDesign').click();
    await pickView(page, 'viewForm');
    const age = (row: number) => page.getByTestId(`form-row-${row}`).getByTestId('form-ctl-Age');
    await expect(age(1)).toBeVisible();
    await expect.poll(() => age(1).evaluate((e) => getComputedStyle(e).backgroundColor)).toBe('rgb(255, 204, 0)');   // 40 > 30
    await expect.poll(() => age(2).evaluate((e) => getComputedStyle(e).backgroundColor)).toBe('rgb(255, 204, 0)');   // 31 > 30
    expect(await age(0).evaluate((e) => getComputedStyle(e).backgroundColor)).not.toBe('rgb(255, 204, 0)');          // 20
    await page.screenshot({ path: testInfo.outputPath('format-fond-conditions.png') });
    console.log('SCREENSHOT', testInfo.outputPath('format-fond-conditions.png'));
  } finally {
    await app.close();
  }
});
