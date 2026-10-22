import { test, expect, type Page } from '@playwright/test';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { launchApp, seedBase } from './helpers';

const fr = JSON.parse(readFileSync(join(__dirname, '../../src/shared/i18n/fr.json'), 'utf8'));
const TABLE = 'Ventes_machines_cafe_UTF8';
const HEADER = 'Date,Produit,Quantité vendue,Prix unitaire (€),Région,Canal de vente,Vente totale (€)\n';
const CSV = HEADER
  + '2024-01-15,Machine à café Expresso Pro,3,249.90,Île-de-France,En ligne,749.70\n'
  + '2024-01-16,"Machine à café à grain ""Deluxe""",1,899.00,Bretagne,Magasin,899.00\n'
  + "2024-01-17,Machine à café Capsules,5,79.99,Provence-Alpes-Côte d'Azur,En ligne,399.95\n";

const cell = (page: Page, col: number, row: number) => page.getByTestId(`glide-cell-${col + 1}-${row}`);
const count = (page: Page, table: string) => page.evaluate((t) => (window as any).basecraft.rows.count(t), table);
const step = (page: Page) => page.getByTestId('import-step');
async function openWizard(page: Page) {
  await page.getByTestId('ribbon-tab-externalData').click();
  await page.getByTestId('cmd-importText').click();
  await expect(page.getByTestId('import-wizard')).toBeVisible();
}

test('import a UTF-8 CSV into a new table, append it again, log a refused row', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'basecraft-import-'));
  const csv = join(dir, `${TABLE}.csv`);
  writeFileSync(csv, CSV, 'utf8');
  const { app, page } = await launchApp({ args: [seedBase('import')], env: { BASECRAFT_REGION: 'fr-FR', BASECRAFT_E2E_IMPORT_PATH: csv } });
  try {
    // the renderer cannot make the main process read a file the user did not choose in the open dialog
    const other = join(__dirname, '../../package.json');
    await expect(page.evaluate((p) => (window as any).basecraft.importText.preview(p, null), other)).rejects.toThrow(/bc:invalidArgument/);

    // 1. source: the main-side open dialog gives the path
    await openWizard(page);
    await expect(step(page)).toHaveAttribute('data-step', 'source');
    await expect(page.getByTestId('import-dest-new')).toBeChecked();
    await expect(page.getByTestId('import-dest-link')).toBeDisabled();
    await page.getByTestId('import-browse').click();
    await expect(page.getByTestId('import-path')).toHaveValue(csv);
    await page.getByTestId('import-btn-next').click();

    // 2. format detected, read as UTF-8: no « QuantitÃ© »
    await expect(step(page)).toHaveAttribute('data-step', 'format');
    await expect(page.getByTestId('import-format-delimited')).toBeChecked();
    await expect(page.getByTestId('import-lines')).toContainText('Quantité vendue,Prix unitaire (€)');
    await expect(page.getByTestId('import-encoding')).toContainText('UTF-8');
    await page.getByTestId('import-btn-next').click();

    // 3. comma, headers; decimal symbol '.' set in Advanced…, specification saved
    await expect(step(page)).toHaveAttribute('data-step', 'delimited');
    await expect(page.getByTestId('import-delim-comma')).toBeChecked();
    await expect(page.getByTestId('import-has-header')).toBeChecked();
    await expect(page.getByTestId('import-col-2')).toHaveText('Quantité vendue');
    await expect(page.getByTestId('import-preview')).toContainText('Machine à café à grain "Deluxe"');
    await page.getByTestId('import-btn-advanced').click();
    await page.getByTestId('import-adv-decimal').fill('.');
    await page.getByTestId('import-adv-save-as').click();
    await page.getByTestId('modal-input').fill('Ventes café');
    await page.getByTestId('modal-btn-ok').click();
    await page.getByTestId('import-adv-specs').click();
    await expect(page.getByTestId('import-spec-Ventes café')).toBeVisible();
    await page.getByTestId('import-specs-cancel').click();
    await page.getByTestId('import-adv-ok').click();
    await expect(page.getByTestId('import-adv')).toHaveCount(0);
    await page.getByTestId('import-btn-next').click();

    // 4. field options: inferred types, the unit price as Currency
    await expect(step(page)).toHaveAttribute('data-step', 'fields');
    await expect(page.getByTestId('import-field-name')).toHaveValue('Date');
    await expect(page.getByTestId('import-assumed-decimal')).toHaveCount(0); // 249.90: the decimal point is certain
    await expect(page.getByTestId('import-field-type')).toHaveValue('dateTime');
    await page.getByTestId('import-col-2').click();
    await expect(page.getByTestId('import-field-type')).toHaveValue('longInteger');
    await page.getByTestId('import-col-3').click();
    await expect(page.getByTestId('import-field-type')).toHaveValue('double');
    await page.getByTestId('import-field-type').selectOption('currency');
    await page.getByTestId('import-btn-next').click();

    // 5. primary key, 6. finish
    await expect(page.getByTestId('import-pk-auto')).toBeChecked();
    await page.getByTestId('import-btn-next').click();
    await expect(page.getByTestId('import-table-name')).toHaveValue(TABLE);
    await page.getByTestId('import-btn-finish').click();
    await expect(page.getByTestId('import-summary-imported')).toHaveText(fr.importText.finish.imported.replace('{{count}}', '3').replace('{{table}}', TABLE));
    await expect(page.getByTestId('import-summary-errors')).toHaveText(fr.importText.finish.noErrors);
    await page.getByTestId('import-btn-close').click();

    // the new table opens: accented header, typed and formatted values
    await expect(page.getByTestId(`nav-item-${TABLE}`)).toBeVisible();
    const headers = page.getByTestId('datasheet').locator('th[role=columnheader]');
    await expect(headers.nth(0)).toHaveText(fr.designer.defaultIdName);
    await expect(headers.nth(3)).toHaveText('Quantité vendue');
    await expect(headers.nth(4)).toHaveText('Prix unitaire (€)');
    await expect(cell(page, 1, 0)).toHaveText('15/01/2024');
    await expect(cell(page, 2, 1)).toHaveText('Machine à café à grain "Deluxe"');
    await expect(cell(page, 3, 2)).toHaveText('5');
    await expect(cell(page, 4, 0)).toHaveText('249,9'); // Glide's accessible copy holds the edit text
    const rows = await page.evaluate((t) => (window as any).basecraft.rows.page(t, { offset: 0, limit: 10 }), TABLE);
    expect(rows.rows[0].values).toEqual([1, '2024-01-15 00:00:00', 'Machine à café Expresso Pro', 3, 249.9, 'Île-de-France', 'En ligne', 749.7]);
    const design = await page.evaluate((t) => (window as any).basecraft.tables.design(t), TABLE);
    expect(design.fields.map((f: any) => [f.name, f.props.type, f.props.numberSize ?? null])).toEqual([
      [fr.designer.defaultIdName, 'autoNumber', null], ['Date', 'dateTime', null], ['Produit', 'shortText', null],
      ['Quantité vendue', 'number', 'longInteger'], ['Prix unitaire (€)', 'currency', null], ['Région', 'shortText', null],
      ['Canal de vente', 'shortText', null], ['Vente totale (€)', 'number', 'double'],
    ]);
    expect(await count(page, TABLE)).toBe(3);

    // append the same file: the count doubles
    await openWizard(page);
    await page.getByTestId('import-browse').click();
    await page.getByTestId('import-dest-append').check();
    await page.getByTestId('import-append-table').selectOption(TABLE);
    await page.getByTestId('import-btn-next').click();
    await expect(step(page)).toHaveAttribute('data-step', 'format');
    await page.getByTestId('import-btn-finish').click();
    await expect(page.getByTestId('import-summary-imported')).toContainText('3');
    await page.getByTestId('import-btn-close').click();
    await expect.poll(() => count(page, TABLE)).toBe(6);
    await expect(page.getByTestId('nav-record-count')).toHaveText('6'); // the open datasheet reloaded

    // another file, one row with an impossible date: refused and logged in <Table>_ErreursImportation
    const bad = join(dir, 'ventes_fevrier.csv');
    writeFileSync(bad, HEADER + '2024-02-29,Moulin à café,2,39.90,Bretagne,Magasin,79.80\n2024-02-30,Machine à café,1,99.00,Bretagne,Magasin,99.00\n', 'utf8');
    await openWizard(page);
    await app.evaluate((_e, p) => { process.env.BASECRAFT_E2E_IMPORT_PATH = p; }, bad); // the next "open dialog" answer
    await page.getByTestId('import-browse').click();
    await expect(page.getByTestId('import-path')).toHaveValue(bad);
    await expect(page.getByTestId('import-path')).toHaveAttribute('readonly', '');
    await page.getByTestId('import-dest-append').check();
    await page.getByTestId('import-append-table').selectOption(TABLE);
    await page.getByTestId('import-btn-next').click();
    await page.getByTestId('import-btn-finish').click();
    await expect(page.getByTestId('import-summary-errors')).toContainText(`${TABLE}_ErreursImportation`);
    await page.getByTestId('import-btn-close').click();
    expect(await count(page, TABLE)).toBe(7);
    await expect(page.getByTestId(`nav-item-${TABLE}_ErreursImportation`)).toBeVisible();
    expect(await count(page, `${TABLE}_ErreursImportation`)).toBe(1);
    const err = await page.evaluate((t) => (window as any).basecraft.rows.page(t, { offset: 0, limit: 10 }), `${TABLE}_ErreursImportation`);
    expect(err.rows[0].values).toEqual([fr.fieldError.invalidDate, 'Date', 3]);
  } finally {
    await app.close();
  }
});

test('read-only base: the import command is disabled', async () => {
  const base = seedBase('import-ro');
  const first = await launchApp({ args: [base] });
  const second = await launchApp({ args: [base] });
  try {
    await second.page.getByTestId('ribbon-tab-externalData').click();
    await expect(second.page.getByTestId('cmd-importText')).toBeDisabled();
    await first.page.getByTestId('ribbon-tab-externalData').click();
    await expect(first.page.getByTestId('cmd-importText')).toBeEnabled();
  } finally {
    await second.app.close();
    await first.app.close();
  }
});
