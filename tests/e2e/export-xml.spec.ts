import { test, expect, type Page } from '@playwright/test';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { launchApp, seedBase, seedSalesE2E } from './helpers';

const fr = JSON.parse(readFileSync(join(__dirname, '../../src/shared/i18n/fr.json'), 'utf8'));
const FR = { BASECRAFT_REGION: 'fr-FR' };
const dir = () => mkdtempSync(join(tmpdir(), 'basecraft-xml-'));
const done = (rows: number) => (rows === 1 ? fr.exchange.done_one : fr.exchange.done_other).replace('{{count}}', String(rows));
const rowsOf = (page: Page, table: string) => page.evaluate((t) => (window as any).basecraft.rows.page(t, { offset: 0, limit: 50 }), table);

/** The end box of an export: the summary, optionally « Save export steps » under `save`. */
async function finish(page: Page, rows: number, save?: string) {
  await expect(page.getByTestId('modal')).toContainText(done(rows));
  if (save) {
    await page.getByTestId('export-save-check').check();
    await page.getByTestId('export-save-name').fill(save);
  }
  await page.getByTestId('modal-btn-ok').click();
  await expect(page.getByTestId('modal')).toHaveCount(0);
}

test('XML: export a table, import it as a new table; Saved Exports run and delete; More › HTML', async () => {
  const d = dir();
  const xml = join(d, 'clients.xml');
  const html = join(d, 'clients.html');
  const { app, page } = await launchApp({ args: [seedSalesE2E('export-xml')], env: { ...FR, BASECRAFT_E2E_EXPORT_PATH: xml, BASECRAFT_E2E_XML_PATH: xml } });
  try {
    // Export XML of the selected table, and keep its steps
    await page.getByTestId('ribbon-tab-externalData').click();
    await page.getByTestId('nav-item-Clients').click();
    await page.getByTestId('cmd-exportXml').click();
    await finish(page, 4, 'Clients en XML');
    const text = readFileSync(xml, 'utf8');
    expect(text).toMatch(/^<\?xml version="1.0" encoding="UTF-8"\?>\r\n<dataroot /);
    expect(text).toContain('<Clients>\r\n<N_x00B0_>1</N_x00B0_>\r\n<Nom>Dupont</Nom>\r\n<Ville>Lyon</Ville>\r\n</Clients>');
    expect(text.match(/<Clients>/g)).toHaveLength(4);

    // Import XML into a new table, compared with the original rows
    await page.getByTestId('cmd-importXml').click();
    await page.getByTestId('import-browse').click();
    await expect(page.getByTestId('import-path')).toHaveValue(xml);
    await page.getByTestId('import-btn-next').click();
    await expect(page.getByTestId('import-step')).toHaveAttribute('data-step', 'sheet');
    await expect(page.getByTestId('import-sheet-Clients')).toBeChecked();
    await expect(page.getByTestId('import-has-header')).toBeDisabled();
    await expect(page.getByTestId('import-preview')).toContainText('Dupont');
    await page.getByTestId('import-btn-next').click(); // fields
    await page.getByTestId('import-btn-next').click(); // key
    await page.getByTestId('import-pk-none').check();
    await page.getByTestId('import-btn-next').click();
    await page.getByTestId('import-table-name').fill('ClientsXml');
    await page.getByTestId('import-btn-finish').click();
    await expect(page.getByTestId('import-summary-imported')).toContainText('4');
    await page.getByTestId('import-btn-close').click();
    const a = await rowsOf(page, 'Clients');
    const b = await rowsOf(page, 'ClientsXml');
    expect(b.rows.map((r: any) => r.values)).toEqual(a.rows.map((r: any) => r.values));

    // Saved Exports: listed, run again (a new path is chosen), deleted
    await app.evaluate((_e, p) => { process.env.BASECRAFT_E2E_EXPORT_PATH = p; }, html.replace('.html', '2.xml'));
    await page.getByTestId('cmd-savedExports').click();
    await expect(page.getByTestId('saved-Clients en XML')).toContainText('Clients');
    await page.getByTestId('saved-run-Clients en XML').click();
    await finish(page, 4);
    expect(readFileSync(html.replace('.html', '2.xml'), 'utf8')).toContain('<Nom>Martin</Nom>');
    await page.getByTestId('cmd-savedExports').click();
    await page.getByTestId('saved-delete-Clients en XML').click();
    await expect(page.getByTestId('saved-empty')).toBeVisible();
    await page.getByTestId('saved-close').click();

    // More › HTML document
    await app.evaluate((_e, p) => { process.env.BASECRAFT_E2E_EXPORT_PATH = p; }, html);
    await page.getByTestId('cmd-exportMore').click();
    await page.getByTestId('export-more-html').click();
    await finish(page, 4);
    const h = readFileSync(html, 'utf8');
    expect(h).toContain('<th>Nom</th>');
    expect(h).toContain('<td>1</td><td>Dupont</td><td>Lyon</td>');
  } finally {
    await app.close();
  }
});

test('XML import refuses a DTD and a file that is not flat data', async () => {
  const d = dir();
  const bad = join(d, 'bad.xml');
  writeFileSync(bad, '<?xml version="1.0"?><!DOCTYPE d [<!ENTITY x SYSTEM "file:///etc/passwd">]><d><r><a>&x;</a></r></d>');
  const { app, page } = await launchApp({ args: [seedBase('xml-bad')], env: { ...FR, BASECRAFT_E2E_XML_PATH: bad } });
  try {
    await page.getByTestId('ribbon-tab-externalData').click();
    await page.getByTestId('cmd-importXml').click();
    await page.getByTestId('import-browse').click();
    await page.getByTestId('import-btn-next').click();
    await expect(page.getByTestId('import-wizard')).toContainText(fr.importText.error.xmlUnsupported);
    await expect(page.getByTestId('import-step')).toHaveAttribute('data-step', 'source');
  } finally {
    await app.close();
  }
});
