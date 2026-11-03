import { test, expect, type Page } from '@playwright/test';
import ExcelJS from 'exceljs';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { launchApp, seedBase } from './helpers';

const step = (page: Page) => page.getByTestId('import-step');
const indexed = (page: Page) => page.getByTestId('import-field-indexed');
const CSV = 'NumClient;Nom;Ville;CodePostal\n1;Dupont;Paris;75001\n2;Martin;Lyon;69001\n3;Durand;Nantes;44000\n';

async function toFields(page: Page, kind: 'importText' | 'importExcel', sheetStep: boolean, noHeader = false) {
  await page.getByTestId('ribbon-tab-externalData').click();
  await page.getByTestId(`cmd-${kind}`).click();
  await page.getByTestId('import-browse').click();
  await page.getByTestId('import-btn-next').click();
  if (sheetStep) { await expect(step(page)).toHaveAttribute('data-step', 'sheet'); await page.getByTestId('import-btn-next').click(); }
  else {
    await page.getByTestId('import-btn-next').click(); // format
    await expect(step(page)).toHaveAttribute('data-step', 'delimited');
    if (noHeader) { await page.getByTestId('import-has-header').click(); await expect(page.getByTestId('import-has-header')).not.toBeChecked(); }
    await page.getByTestId('import-btn-next').click();
  }
  await expect(step(page)).toHaveAttribute('data-step', 'fields');
}
const expectCols = async (page: Page, values: string[]) => {
  for (const [i, v] of values.entries()) { await page.getByTestId(`import-col-${i}`).click(); await expect(indexed(page)).toHaveValue(v); }
};
const designIndexed = (page: Page, table: string) => page.evaluate(async (t) => {
  const d = await (window as any).basecraft.tables.design(t);
  return d.fields.map((f: any) => [f.name, f.props.indexed]);
}, table);

test('text import: AutoIndex pre-fills, renames, manual choice kept, no header, emptied list', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'basecraft-autoindex-'));
  const csv = join(dir, 'Clients.csv');
  writeFileSync(csv, CSV, 'utf8');
  const { app, page, userDataDir } = await launchApp({ args: [seedBase('import-autoindex')], env: { BASECRAFT_REGION: 'fr-FR', BASECRAFT_E2E_IMPORT_PATH: csv } });
  try {
    await toFields(page, 'importText', false);
    await expectCols(page, ['yesDuplicates', 'no', 'no', 'yesDuplicates']);
    await page.getByTestId('import-col-1').click();
    await indexed(page).selectOption({ label: 'Oui - Sans doublons' });
    await page.getByTestId('import-col-2').click();
    // typed key by key, only the committed name counts: « Annumber » is not in the list, « NumLot » is
    await page.getByTestId('import-field-name').fill('');
    await page.getByTestId('import-field-name').pressSequentially('Annumber');
    await page.getByTestId('import-field-name').blur();
    await expect(indexed(page)).toHaveValue('no');
    await page.getByTestId('import-field-name').fill('');
    await page.getByTestId('import-field-name').pressSequentially('NumLot');
    await expect(indexed(page)).toHaveValue('no'); // not yet committed
    await page.getByTestId('import-field-name').blur();
    await expect(indexed(page)).toHaveValue('yesDuplicates');
    await page.getByTestId('import-field-name').fill('CodeVille');
    await page.getByTestId('import-field-name').blur();
    await expect(indexed(page)).toHaveValue('yesDuplicates');
    await page.getByTestId('import-col-1').click();
    await expect(indexed(page)).toHaveValue('yesNoDuplicates');
    // a manual choice stays when the field is renamed to a matching name
    await page.getByTestId('import-field-name').fill('NomCode');
    await page.getByTestId('import-field-name').blur();
    await expect(indexed(page)).toHaveValue('yesNoDuplicates');
    await page.getByTestId('import-field-name').fill('Nom');
    await page.getByTestId('import-field-name').blur();
    await page.getByTestId('import-btn-next').click();
    await page.getByTestId('import-btn-next').click();
    await page.getByTestId('import-btn-finish').click();
    await expect(page.getByTestId('import-summary')).toBeVisible();
    await page.getByTestId('import-btn-close').click();
    expect(await designIndexed(page, 'Clients')).toEqual([['N°', 'yesNoDuplicates'], ['NumClient', 'yesDuplicates'], ['Nom', 'yesNoDuplicates'], ['CodeVille', 'yesDuplicates'], ['CodePostal', 'yesDuplicates']]);

    // no header: Champ1… none indexed
    await toFields(page, 'importText', false, true);
    await expectCols(page, ['no', 'no', 'no', 'no']);
    await page.getByTestId('import-btn-cancel').click();
  } finally { await app.close(); }

  // list emptied: nothing indexed
  writeFileSync(join(userDataDir, 'settings.json'), JSON.stringify({ autoIndex: '' }));
  const again = await launchApp({ userDataDir, args: [seedBase('import-autoindex-2')], env: { BASECRAFT_REGION: 'fr-FR', BASECRAFT_E2E_IMPORT_PATH: csv } });
  try {
    await toFields(again.page, 'importText', false);
    await expectCols(again.page, ['no', 'no', 'no', 'no']);
  } finally { await again.app.close(); }
});

test('Excel import: AutoIndex on the header row', async () => {
  const xlsx = join(mkdtempSync(join(tmpdir(), 'basecraft-autoindex-')), 'Clients.xlsx');
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Clients');
  ws.addRow(['NumClient', 'Nom', 'Ville', 'CodePostal']);
  ws.addRow([1, 'Dupont', 'Paris', '75001']);
  ws.addRow([2, 'Martin', 'Lyon', '69001']);
  await wb.xlsx.writeFile(xlsx);
  const { app, page } = await launchApp({ args: [seedBase('import-autoindex-xl')], env: { BASECRAFT_REGION: 'fr-FR', BASECRAFT_E2E_EXCEL_PATH: xlsx } });
  try {
    await toFields(page, 'importExcel', true);
    await expectCols(page, ['yesDuplicates', 'no', 'no', 'yesDuplicates']);
  } finally { await app.close(); }
});
