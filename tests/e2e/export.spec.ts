import { test, expect, type Page } from '@playwright/test';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import ExcelJS from 'exceljs';
import { launchApp, seedBase, seedReportsE2E, seedSalesE2E } from './helpers';

const fr = JSON.parse(readFileSync(join(__dirname, '../../src/shared/i18n/fr.json'), 'utf8'));
const FR = { BASECRAFT_REGION: 'fr-FR' };
const outFile = () => join(mkdtempSync(join(tmpdir(), 'basecraft-export-')), 'sortie.csv');
const done = (rows: number) => (rows === 1 ? fr.exchange.done_one : fr.exchange.done_other).replace('{{count}}', String(rows));

/** The export file as text (BOM kept) and its CRLF-terminated lines. */
function lines(path: string) {
  const raw = readFileSync(path);
  expect([...raw.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
  const text = raw.toString('utf8').slice(1);
  expect(text.endsWith('\r\n')).toBe(true);
  expect(text.replace(/\r\n/g, '')).not.toMatch(/[\r\n]/);
  return text.split('\r\n').slice(0, -1);
}
/** Options dialog with its defaults (fr-FR: ';', '"', header, UTF-8 with BOM), then the end message. */
async function confirmDefaults(page: Page, rows: number) {
  await expect(page.getByTestId('export-text-delimiter-semicolon')).toBeChecked();
  await expect(page.getByTestId('export-text-header')).toBeChecked();
  await page.getByTestId('export-text-ok').click();
  await expect(page.getByTestId('modal')).toContainText(done(rows));
  await page.getByTestId('modal-btn-ok').click();
  await expect(page.getByTestId('modal')).toHaveCount(0);
}

test('Navigation Pane: Export › Text File of a table and of a parameter query', async () => {
  const out = outFile();
  const { app, page } = await launchApp({ args: [seedSalesE2E('export')], env: { ...FR, BASECRAFT_E2E_EXPORT_PATH: out } });
  try {
    await page.getByTestId('nav-item-Clients').click({ button: 'right' });
    const layout = await page.getByTestId('nav-menu').evaluate((m) => [...m.children].map((e) => (e.getAttribute('role') === 'separator' ? '|' : (e.querySelector('[role="menuitem"]') ?? e).getAttribute('data-testid')!.replace('nav-menu-', ''))));
    expect(layout.slice(layout.indexOf('import'), layout.indexOf('import') + 2)).toEqual(['import', 'export']);
    await page.getByTestId('nav-menu-export').focus();
    await page.keyboard.press('ArrowRight');
    await expect(page.getByTestId('nav-menu-export-text')).toBeFocused();
    await page.keyboard.press('Enter');
    await confirmDefaults(page, 4);
    expect(lines(out)).toEqual(['"N°";"Nom";"Ville"', '1;"Dupont";"Lyon"', '2;"Martin";"LYON"', '3;"Durand";"Paris"', '4;"Éric";"Lyôn"']);

    // a query asks for its parameter first
    await page.getByTestId('nav-item-query-QDepuis').click({ button: 'right' });
    await page.getByTestId('nav-menu-export').click();
    await page.getByTestId('nav-menu-export-text').click();
    await expect(page.getByTestId('modal')).toContainText('Date début :');
    await page.getByTestId('modal-input').fill('05/10/2026');
    await page.getByTestId('modal-btn-ok').click();
    await page.getByTestId('export-text-delimiter-tab').check();
    await page.getByTestId('export-text-qualifier').selectOption('');
    await page.getByTestId('export-text-header').uncheck();
    await page.getByTestId('export-text-ok').click();
    await expect(page.getByTestId('modal')).toContainText(done(3));
    await page.getByTestId('modal-btn-ok').click();
    const q = lines(out);
    expect(q).toHaveLength(3);
    expect(q[0]!.split('\t')).toEqual(['2', '0,1', '05/10/2026']);

    // Escape on the parameter box: nothing is written, no further dialog
    await page.getByTestId('nav-item-query-QDepuis').click({ button: 'right' });
    await page.getByTestId('nav-menu-export').click();
    await page.getByTestId('nav-menu-export-text').click();
    await expect(page.getByTestId('modal')).toBeVisible(); // the parameter box: Escape before it opens would close nothing
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('modal')).toHaveCount(0);
  } finally {
    await app.close();
  }
});

test('External Data › Text File: the open datasheet, else the Navigation Pane selection; cancel and a failed write', async () => {
  const out = outFile();
  const { app, page } = await launchApp({ args: [seedSalesE2E('export-ribbon')], env: { ...FR, BASECRAFT_E2E_EXPORT_PATH: out } });
  try {
    // nothing open, nothing selected: asked to select
    await page.getByTestId('ribbon-tab-externalData').click();
    await page.getByTestId('cmd-exportText').click();
    await expect(page.getByTestId('modal')).toContainText(fr.exchange.selectObject);
    await page.getByTestId('modal-btn-ok').click();

    // the selection
    await page.getByTestId('nav-item-Commandes').click();
    await page.getByTestId('cmd-exportText').click();
    await confirmDefaults(page, 5);
    expect(lines(out)[0]).toBe('"N°";"Client";"Montant";"Le"');

    // the datasheet that is open (a one-table query), the file replaced
    await page.getByTestId('nav-item-query-QClientsLyon').dblclick();
    await expect(page.getByTestId('doc-tab-query-QClientsLyon')).toBeVisible();
    await page.getByTestId('ribbon-tab-externalData').click();
    await page.getByTestId('cmd-exportText').click();
    await confirmDefaults(page, 2);
    expect(lines(out)).toHaveLength(3);

    // Cancel in the options box writes nothing
    await page.getByTestId('nav-item-Clients').click({ button: 'right' });
    await page.getByTestId('nav-menu-export').click();
    await page.getByTestId('nav-menu-export-text').click();
    await page.getByTestId('export-text-cancel').click();
    await expect(page.getByTestId('modal')).toHaveCount(0);
    expect(lines(out)).toHaveLength(3);

    // a save path that cannot be written: explained, the other file is untouched
    await app.evaluate(() => { process.env.BASECRAFT_E2E_EXPORT_PATH = '/nonexistent-folder/x/sortie.csv'; });
    await page.getByTestId('cmd-exportText').click();
    await page.getByTestId('export-text-ok').click();
    await expect(page.getByTestId('modal')).toContainText(fr.dialog.error.writeFailed);
    await page.getByTestId('modal-btn-ok').click();
    expect(lines(out)).toHaveLength(3);
  } finally {
    await app.close();
  }
});

test('Print Preview › Text File exports the report\'s record source', async () => {
  const out = outFile();
  const { app, page } = await launchApp({ args: [seedBase('export-report', seedReportsE2E)], env: { ...FR, BASECRAFT_E2E_EXPORT_PATH: out } });
  try {
    await page.getByTestId('nav-group-report').getByTestId('nav-item-report-Factures par client').dblclick();
    await expect(page.getByTestId('doc-tab-report-Factures par client')).toBeVisible();
    await expect(page.getByTestId('ribbon-tab-printPreview')).toHaveAttribute('aria-selected', 'true');
    await page.getByTestId('cmd-exportText').click();
    await confirmDefaults(page, 75);
    const l = lines(out);
    expect(l[0]).toBe('"N°";"Client";"Date";"Libellé";"Montant"');
    expect(l).toHaveLength(76);
  } finally {
    await app.close();
  }
});

const outXlsx = () => join(mkdtempSync(join(tmpdir(), 'basecraft-export-')), 'sortie.xlsx');
async function sheetOf(path: string) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(path);
  return wb.worksheets[0]!;
}
async function confirmDone(page: Page, rows: number) {
  await expect(page.getByTestId('modal')).toContainText(done(rows));
  await page.getByTestId('modal-btn-ok').click();
  await expect(page.getByTestId('modal')).toHaveCount(0);
}

test('Excel: Navigation Pane and ribbon export a table (typed cells, bold frozen header), a failed write is explained', async () => {
  const out = outXlsx();
  const { app, page } = await launchApp({ args: [seedSalesE2E('export-xlsx')], env: { ...FR, BASECRAFT_E2E_EXPORT_PATH: out } });
  try {
    await page.getByTestId('nav-item-Clients').click({ button: 'right' });
    await page.getByTestId('nav-menu-export').click();
    await page.getByTestId('nav-menu-export-excel').click();
    await confirmDone(page, 4);
    let ws = await sheetOf(out);
    expect(ws.name).toBe('Clients');
    expect(ws.getRow(1).values).toEqual([undefined, 'N°', 'Nom', 'Ville']);
    expect(ws.getCell('A1').font?.bold).toBe(true);
    expect(ws.views[0]).toMatchObject({ state: 'frozen', ySplit: 1 });
    expect(ws.rowCount).toBe(5);
    expect(ws.getCell('B2').value).toBe('Dupont');
    expect(ws.getCell('A2').value).toBe(1);

    // the ribbon, with the datasheet that is open (Commandes: a currency and a date column)
    await page.getByTestId('nav-item-Commandes').dblclick();
    await expect(page.getByTestId('doc-tab-Commandes')).toBeVisible();
    await page.getByTestId('ribbon-tab-externalData').click();
    await page.getByTestId('cmd-exportExcel').click();
    await confirmDone(page, 5);
    ws = await sheetOf(out);
    expect(ws.name).toBe('Commandes');
    expect(ws.rowCount).toBe(6);
    expect(ws.getCell('D2').value).toBeInstanceOf(Date);

    // a save path that cannot be written: explained, the file is untouched
    await app.evaluate(() => { process.env.BASECRAFT_E2E_EXPORT_PATH = '/nonexistent-folder/x/sortie.xlsx'; });
    await page.getByTestId('cmd-exportExcel').click();
    await expect(page.getByTestId('modal')).toContainText(fr.dialog.error.writeFailed);
    await page.getByTestId('modal-btn-ok').click();
    expect((await sheetOf(out)).rowCount).toBe(6);
  } finally {
    await app.close();
  }
});

test('Print Preview › Excel exports the record source of the report', async () => {
  const out = outXlsx();
  const { app, page } = await launchApp({ args: [seedBase('export-report-xlsx', seedReportsE2E)], env: { ...FR, BASECRAFT_E2E_EXPORT_PATH: out } });
  try {
    await page.getByTestId('nav-group-report').getByTestId('nav-item-report-Factures par client').dblclick();
    await expect(page.getByTestId('ribbon-tab-printPreview')).toHaveAttribute('aria-selected', 'true');
    await page.getByTestId('cmd-exportExcel').click();
    await confirmDone(page, 75);
    const ws = await sheetOf(out);
    expect(ws.name).toBe('Factures par client');
    expect(ws.getCell('A1').font?.bold).toBe(true);
    expect(ws.rowCount).toBe(76);
  } finally {
    await app.close();
  }
});
