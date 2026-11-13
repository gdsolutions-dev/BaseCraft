import { test, expect, type Page } from '@playwright/test';
import { copyFileSync, existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createTable } from '../../src/main/db/schema';
import { f, t } from '../../src/shared/test-fixtures';
import { ACCESS_EXPECTED, ACCESS_PASSWORD } from '../fixtures/access/expected';
import { launchApp, seedBase } from './helpers';

const fr = JSON.parse(readFileSync(join(__dirname, '../../src/shared/i18n/fr.json'), 'utf8'));
const FIXTURES = join(__dirname, '../fixtures/access');
const title = (page: Page) => page.getByTestId('modal').locator('.modal-title');
const cell = (page: Page, col: number, row: number) => page.getByTestId(`glide-cell-${col + 1}-${row}`);

/** The fixtures copied to a temp folder (the import reads the copy, never the committed file); `report`: where the report is saved. */
function copies() {
  const dir = mkdtempSync(join(tmpdir(), 'basecraft-import-access-'));
  for (const n of ['Ventes.accdb', 'Ventes-mdp.accdb']) copyFileSync(join(FIXTURES, n), join(dir, n));
  return { plain: join(dir, 'Ventes.accdb'), locked: join(dir, 'Ventes-mdp.accdb'), report: join(dir, 'rapport.txt') };
}
const seeded = () => seedBase('Front', (db) => createTable(db, t('Clients', [f('N°', 'autoNumber')]))); // the name Clients is in use

test('External Data › Access imports tables with their rows and ends on the report', async () => {
  test.setTimeout(120_000);
  const { plain, report: savedPath } = copies();
  const { app, page } = await launchApp({ args: [seeded()], env: { BASECRAFT_REGION: 'fr-FR', BASECRAFT_E2E_LINK_PATH: plain, BASECRAFT_E2E_REPORT_PATH: savedPath } });
  try {
    await page.getByTestId('ribbon-tab-externalData').click();
    await page.getByTestId('cmd-importAccess').click();
    await expect(title(page)).toHaveText(fr.import.access.title);
    await page.getByTestId('import-structure-file').check(); // this PC may have Access, which would be the default: the file alone is tested here
    await expect(page.getByTestId('import-file-only')).toHaveText(fr.import.access.fileOnly);
    await expect(page.getByTestId('link-table-Clients1')).toBeVisible(); // the name in use is numbered
    await expect(page.getByTestId('link-skipped-Clients1')).toContainText('Photo');
    await page.getByTestId('link-table-Clients1').check();
    await page.getByTestId('link-table-Commandes').check();
    await page.getByTestId('link-ok').click();
    await expect(page.getByTestId('import-report')).toContainText(fr.import.server.done.replace('{{names}}', 'Clients1, Commandes'));
    await expect(page.getByTestId('report-ignored').getByTestId('report-line-fieldSkipped')).toContainText('Photo');
    await expect(page.getByTestId('report-approximated').getByTestId('report-line-structureNotRead')).toBeVisible();
    await page.getByTestId('report-save').click();
    await expect.poll(() => { try { return readFileSync(savedPath, 'utf8'); } catch { return ''; } }).toContain('Photo');
    await page.getByTestId('import-close').click();
    // the Navigation Pane lists the two tables; Clients1 shows the file's rows (Nom, Ville)
    await expect(page.getByTestId('nav-item-Clients1')).toBeVisible();
    await expect(page.getByTestId('nav-item-Commandes')).toBeVisible();
    await page.getByTestId('nav-item-Clients1').dblclick();
    await expect(page.getByTestId('datasheet').getByTestId('data-grid-canvas')).toBeVisible();
    await expect(page.getByTestId('nav-record-count')).toHaveText(String(ACCESS_EXPECTED.clients.length));
    for (const [r, row] of ACCESS_EXPECTED.clients.entries()) for (const c of [1, 2]) await expect(cell(page, c, r)).toHaveText(String(row[c]));
  } finally {
    await app.close();
  }
});

test('a protected file asks its password: wrong, then right', async () => {
  test.setTimeout(120_000);
  const { locked, report: savedPath } = copies();
  const { app, page } = await launchApp({ args: [seeded()], env: { BASECRAFT_REGION: 'fr-FR', BASECRAFT_E2E_LINK_PATH: locked, BASECRAFT_E2E_REPORT_PATH: savedPath } });
  try {
    await page.getByTestId('ribbon-tab-externalData').click();
    await page.getByTestId('cmd-importAccess').click();
    await expect(page.getByTestId('modal')).toContainText(fr.link.password.label.replace('{{path}}', locked));
    const input = page.getByTestId('modal-input');
    await expect(input).toHaveAttribute('type', 'password');
    await input.fill('faux');
    await page.getByTestId('modal-btn-ok').click();
    await expect(page.getByTestId('modal-error')).toHaveText(fr.link.password.wrong);
    await input.fill(ACCESS_PASSWORD);
    await page.getByTestId('modal-btn-ok').click();
    await expect(page.getByTestId('link-dialog')).toBeVisible();
    await page.getByTestId('import-structure-file').check();
    await page.getByTestId('link-table-Divers').check();
    await page.getByTestId('link-ok').click();
    await expect(page.getByTestId('import-report')).toContainText(fr.import.server.done.replace('{{names}}', 'Divers'));
    await page.getByTestId('report-save').click();
    await expect.poll(() => { try { return readFileSync(savedPath, 'utf8'); } catch { return ''; } }).toContain('Divers');
    expect(readFileSync(savedPath, 'utf8')).not.toContain(ACCESS_PASSWORD); // a password is never in the report
    await page.getByTestId('import-close').click();
    await expect(page.getByTestId('nav-item-Divers')).toBeVisible();
  } finally {
    await app.close();
  }
});

test('closing the report with Escape still refreshes the Navigation Pane', async () => {
  test.setTimeout(120_000);
  const { plain } = copies();
  const { app, page } = await launchApp({ args: [seeded()], env: { BASECRAFT_REGION: 'fr-FR', BASECRAFT_E2E_LINK_PATH: plain } });
  try {
    await page.getByTestId('ribbon-tab-externalData').click();
    await page.getByTestId('cmd-importAccess').click();
    await page.getByTestId('import-structure-file').check();
    await page.getByTestId('link-table-Commandes').check();
    await page.getByTestId('link-ok').click();
    await expect(page.getByTestId('import-report')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('modal')).toHaveCount(0);
    await expect(page.getByTestId('nav-item-Commandes')).toBeVisible();
  } finally {
    await app.close();
  }
});

const COMPLET = join(FIXTURES, 'Ventes-complet.accdb');
const EXPORT_DIR = join(FIXTURES, 'Ventes-complet.export');

test('an export folder gives the keys and rules in Table Design', async () => {
  test.skip(!existsSync(COMPLET), "Ventes-complet.accdb is not committed: copy it from the owner's originals");
  test.setTimeout(120_000);
  const dir = mkdtempSync(join(tmpdir(), 'basecraft-import-access-'));
  const copy = join(dir, 'Ventes-complet.accdb');
  copyFileSync(COMPLET, copy);
  const { app, page } = await launchApp({ args: [seedBase('Front', (db) => createTable(db, t('Notes', [f('N°', 'autoNumber')])))], env: { BASECRAFT_REGION: 'fr-FR', BASECRAFT_E2E_LINK_PATH: copy, BASECRAFT_E2E_EXPORT_DIR: EXPORT_DIR } });
  try {
    await page.getByTestId('ribbon-tab-externalData').click();
    await page.getByTestId('cmd-importAccess').click();
    await page.getByTestId('import-structure-folder').check();
    await expect(page.getByTestId('import-export-dir')).toHaveText(EXPORT_DIR);
    await page.getByTestId('link-table-Commandes').check(); await page.getByTestId('link-table-Clients').check();
    await page.getByTestId('link-ok').click();
    await expect(page.getByTestId('report-carried').getByTestId('report-line-structureExact')).toHaveCount(2);
    await expect(page.getByTestId('report-line-keyAssumed')).toHaveCount(0);
    await page.getByTestId('import-close').click();
    // Commandes opened in Table Design: Quantité's Validation Rule and Default Value show the values of structure.json
    await page.getByTestId('nav-item-Commandes').click({ button: 'right' });
    await page.getByTestId('nav-menu-design').click();
    await page.getByTestId('design-row-4-name').click();
    await expect(page.getByTestId('design-row-4-name')).toHaveValue('Quantité');
    await expect(page.getByTestId('prop-validationRule')).toHaveValue('> 0'); // structure.json's >0, as the designer writes it
    await expect(page.getByTestId('prop-defaultValue')).toHaveValue('1');
  } finally {
    await app.close();
    try { rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } catch { console.warn(`could not remove the temp folder ${dir}`); }
  }
});

test('the Runtime has no Access import', async () => {
  test.setTimeout(120_000);
  const { app, page } = await launchApp({ runtime: true, args: [seeded()] });
  try {
    await expect(page.getByTestId('cmd-importAccess')).toHaveCount(0);
    await expect(page.getByTestId('ribbon-tab-externalData')).toHaveCount(0);
  } finally {
    await app.close();
  }
});
