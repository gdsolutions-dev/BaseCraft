// Shared by recette-e2.spec.ts and recette-e2.access.spec.ts: the import of Ventes-complet through the dialog, and what Table Design and
// the datasheets must show for the structure that structure.json holds (tests/fixtures/access/Ventes-complet.export).
import { expect, type Page } from '@playwright/test';
import { copyFileSync, existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { launchApp, seedBase } from './helpers';

export const fr = JSON.parse(readFileSync(join(__dirname, '../../src/shared/i18n/fr.json'), 'utf8'));
export const FIXTURES = join(__dirname, '../fixtures/access');
export const COMPLET = join(FIXTURES, 'Ventes-complet.accdb');
export const EXPORT_DIR = join(FIXTURES, 'Ventes-complet.export');
export const hasComplet = existsSync(COMPLET);
const MARKER = 44, HEADER = 34, ROW = 30; // DatasheetView: row selector width, header and row heights
const doc = (page: Page) => page.locator('section[role=tabpanel]:not([hidden])');
const cell = (page: Page, col: number, row: number) => doc(page).getByTestId(`glide-cell-${col + 1}-${row}`);

/** Removes temp folders once the application is closed; a folder that cannot be removed yet is reported, never fatal. */
export function removeTemp(...dirs: string[]) {
  for (const d of dirs) {
    try { rmSync(d, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } catch { console.warn(`could not remove the temp folder ${d}`); }
  }
}

/** A copy of Ventes-complet.accdb in a new temp folder (the import reads the copy, never the committed file). */
export function copyComplet(): { dir: string; path: string } {
  const dir = mkdtempSync(join(tmpdir(), 'basecraft-recette-e2-'));
  copyFileSync(COMPLET, join(dir, 'Ventes-complet.accdb'));
  return { dir, path: join(dir, 'Ventes-complet.accdb') };
}
/** Launches on an empty front-end with `path` as the file the import dialog picks; `exportDir` is what the folder dialogs answer. */
export const launch = (path: string, exportDir?: string) => launchApp({
  args: [seedBase('Front', () => {})],
  env: { BASECRAFT_REGION: 'fr-FR', BASECRAFT_E2E_LINK_PATH: path, ...(exportDir ? { BASECRAFT_E2E_EXPORT_DIR: exportDir } : {}) },
});

/** Imports the given `tables`; `how` picks where the structure comes from; returns the report's text. */
export async function importTables(page: Page, tables: string[], how: 'folder' | 'access', opts: { keep?: boolean } = {}): Promise<string> {
  await page.getByTestId('ribbon-tab-externalData').click();
  await page.getByTestId('cmd-importAccess').click();
  if (how === 'folder') {
    await page.getByTestId('import-structure-folder').check();
    await expect(page.getByTestId('import-export-dir')).toBeVisible();
    const shown = await page.getByTestId('import-export-dir').innerText();
    await page.getByTestId('import-structure-folder-change').click(); // the e2e seam answers the same folder again
    await expect(page.getByTestId('import-export-dir')).toHaveText(shown);
  } else {
    await page.getByTestId('import-structure-access').check();
    if (opts.keep) { await page.getByTestId('import-keep-export').check(); await expect(page.getByTestId('import-keep-dir')).toBeVisible(); await expect(page.getByTestId('import-keep-note')).toBeVisible(); }
  }
  for (const n of tables) await page.getByTestId(`link-table-${n}`).check();
  await page.getByTestId('link-ok').click();
  const report = page.getByTestId('import-report');
  await expect(report).toContainText(fr.import.server.done.replace('{{names}}', tables.join(', ')), { timeout: 180_000 });
  return report.innerText();
}

/** The three tables of Ventes-complet, each reported as carried exactly; the report's text. */
export async function importComplet(page: Page, how: 'folder' | 'access', opts: { keep?: boolean } = {}): Promise<string> {
  const text = await importTables(page, ['Clients', 'Commandes', 'Divers'], how, opts);
  await expect(page.getByTestId('report-carried').getByTestId('report-line-structureExact')).toHaveCount(3);
  await expect(page.getByTestId('report-line-keyAssumed')).toHaveCount(0);
  await expect(page.getByTestId('report-line-structureNotRead')).toHaveCount(0);
  await page.getByTestId('import-close').click();
  return text;
}

async function openDesign(page: Page, table: string, row: number) {
  await page.getByTestId(`nav-item-${table}`).click({ button: 'right' });
  await page.getByTestId('nav-menu-design').click();
  await page.getByTestId(`design-row-${row}-name`).click();
}
/** Selects the design row `row`, which must be the field `name`; back on the General tab. */
async function field(page: Page, row: number, name: string) {
  await page.getByTestId(`design-row-${row}-name`).click();
  await expect(page.getByTestId(`design-row-${row}-name`)).toHaveValue(name);
  if (await page.getByTestId('prop-tab-general').count()) await page.getByTestId('prop-tab-general').click();
}

/** Table Design of Clients and Commandes shows what structure.json holds. */
export async function checkTableDesign(page: Page) {
  // Commandes: N° key; Client required with its lookup; Montant caption, default and format; Quantité rule, text, default; the two-field index
  await openDesign(page, 'Commandes', 0);
  await expect(page.getByTestId('design-row-0-key')).toHaveAttribute('data-primary-key', 'true');
  await field(page, 1, 'Client');
  await expect(page.getByTestId('prop-required')).toBeChecked();
  await page.getByTestId('prop-tab-lookup').click();
  await expect(page.getByTestId('prop-rowSource')).toHaveValue(/^SELECT \[N°\], Nom FROM Clients;\s*$/);
  await expect(page.getByTestId('prop-boundColumn')).toHaveValue('1');
  await expect(page.getByTestId('prop-columnCount')).toHaveValue('2');
  await expect(page.getByTestId('prop-listRows')).toHaveValue('16');
  await expect(page.getByTestId('prop-limitToList')).toBeChecked();
  await field(page, 2, 'Montant');
  await expect(page.getByTestId('prop-caption')).toHaveValue('Montant TTC');
  await expect(page.getByTestId('prop-defaultValue')).toHaveValue('0');
  await expect(page.getByTestId('prop-format')).toHaveValue('#,##0.00 €;-#,##0.00 €');
  await field(page, 4, 'Quantité');
  await expect(page.getByTestId('prop-validationRule')).toHaveValue('> 0'); // structure.json's >0, as the designer writes it
  await expect(page.getByTestId('prop-validationText')).toHaveValue('La quantité doit être positive');
  await expect(page.getByTestId('prop-defaultValue')).toHaveValue('1');
  await page.getByTestId('ribbon-tab-design').click();
  await page.getByTestId('cmd-indexes').click();
  const dialog = page.getByTestId('indexes-dialog');
  await expect(dialog).toBeVisible();
  const names = await dialog.locator('[data-testid^="idx-name-"]').evaluateAll((els) => els.map((e) => (e as HTMLInputElement).value));
  const i = names.indexOf('Idx');
  expect(i, `indexes: ${names.join(', ')}`).toBeGreaterThanOrEqual(0);
  await expect(page.getByTestId(`idx-field-${i}-0`)).toHaveValue('Client');
  await expect(page.getByTestId(`idx-field-${i}-1`)).toHaveValue('Le');
  await expect(page.getByTestId(`idx-dir-${i}-0`)).toHaveValue('asc');
  await expect(page.getByTestId(`idx-dir-${i}-1`)).toHaveValue('asc');
  await expect(page.getByTestId(`idx-unique-${i}`)).toBeChecked();
  await expect(page.getByTestId(`idx-primary-${i}`)).not.toBeChecked();
  await page.getByTestId('indexes-cancel').click();
  await expect(dialog).toHaveCount(0);
  await page.getByTestId('doc-tab-close-Commandes').click();

  // Clients: N° key; Actif's default No carried as False
  await openDesign(page, 'Clients', 0);
  await expect(page.getByTestId('design-row-0-key')).toHaveAttribute('data-primary-key', 'true');
  await field(page, 4, 'Actif');
  await expect(page.getByTestId('prop-defaultValue')).toHaveValue(/^(False|Faux)$/);
  await page.getByTestId('doc-tab-close-Clients').click();
}

async function select(page: Page, col: number, row: number) {
  const b = (await doc(page).getByTestId('datasheet').getByTestId('data-grid-canvas').boundingBox())!;
  await page.mouse.click(b.x + MARKER + 20, b.y + HEADER + ROW / 2);
  await expect(cell(page, 0, 0)).toBeFocused();
  for (let i = 0; i < row; i++) await page.keyboard.press('ArrowDown');
  for (let i = 0; i < col; i++) await page.keyboard.press('ArrowRight');
  await expect(cell(page, col, row)).toBeFocused();
}
async function openSheet(page: Page, name: string) {
  await page.getByTestId(`nav-item-${name}`).dblclick();
  await expect(doc(page).getByTestId('datasheet').getByTestId('data-grid-canvas')).toBeVisible();
  await expect(page.getByTestId(`doc-tab-${name}`)).toHaveAttribute('aria-selected', 'true');
}

/** The datasheets: the lookup's list on Client, a Quantité the rule refuses, the cascade delete of customer Dupont. */
export async function checkBehaviour(page: Page) {
  await openSheet(page, 'Commandes');
  await expect(doc(page).getByTestId('nav-record-count')).toHaveText('5');
  await page.getByTestId('ribbon-tab-home').click();
  await select(page, 1, 0);
  await page.keyboard.press('F2');
  await expect(page.getByTestId('lookup-editor')).toBeVisible();
  await expect(page.getByTestId('lookup-list').getByRole('option', { name: 'Dupont' })).toBeVisible();
  await expect(page.getByTestId('lookup-list').getByRole('option', { name: 'Martin' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('lookup-editor')).toHaveCount(0);

  await select(page, 4, 0); // Quantité of the first order
  await page.keyboard.press('0');
  await expect(page.getByTestId('grid-editor-portal').locator('textarea')).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('grid-editor-portal').locator('textarea')).toHaveCount(0);
  await expect(page.getByTestId('datasheet')).not.toHaveAttribute('aria-busy', 'true');
  await page.keyboard.press('ArrowDown'); // leaving the row saves it
  await expect(page.getByTestId('modal')).toContainText('La quantité doit être positive');
  await page.getByTestId('modal-btn-ok').click();
  await page.keyboard.press('Escape');
  await expect(cell(page, 4, 0)).toHaveText('1');

  // Deleting Dupont (the first customer; two orders) removes his orders, as in Access
  await openSheet(page, 'Clients');
  await select(page, 1, 0);
  await expect(cell(page, 1, 0)).toHaveText('Dupont');
  await page.getByTestId('cmd-deleteRecord').click();
  await expect(page.getByTestId('modal')).toContainText(fr.datasheet.deleteCascade_one);
  await page.getByTestId('modal-btn-yes').click();
  await expect(page.getByTestId('modal')).toHaveCount(0);
  await expect(doc(page).getByTestId('nav-record-count')).toHaveText('3');
  await page.getByTestId('doc-tab-close-Clients').click();
  await page.getByTestId('doc-tab-close-Commandes').click();
  await openSheet(page, 'Commandes');
  await expect(doc(page).getByTestId('nav-record-count')).toHaveText('3');
}
