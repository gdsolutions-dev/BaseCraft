// Shared by recette-e2.spec.ts and recette-e2.access.spec.ts: the import of Ventes-complet through the dialog, and what Table Design and
// the datasheets must show for the structure that structure.json holds (tests/fixtures/access/Ventes-complet.export).
import { expect, type Page } from '@playwright/test';
import { copyFileSync, cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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
export async function importTables(page: Page, tables: string[], how: 'folder' | 'access', opts: { keep?: boolean; designs?: boolean } = {}): Promise<string> {
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
  await expect(page.getByTestId('import-designs')).toBeChecked(); // E4: ticked by default, with its note
  await expect(page.getByTestId('import-designs-note')).toBeVisible();
  if (opts.designs === false) await page.getByTestId('import-designs').uncheck();
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

// ---- E3: the queries of Ventes-complet, read through the datasheets and Design view ----
/** A temp copy of the committed export folder, with two more queries (one the parser keeps as text, one pass-through) when `extra`. */
export function copyExport(extra: boolean): string {
  const dir = mkdtempSync(join(tmpdir(), 'basecraft-recette-e3-export-'));
  cpSync(EXPORT_DIR, dir, { recursive: true });
  if (extra) {
    const m = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8'));
    m.objects.push({ type: 'query', name: 'QInconnue', file: 'queries/3.sql', queryType: 0, connect: '', returnsRecords: true },
      { type: 'query', name: 'QServeur', file: 'queries/4.sql', queryType: 112, connect: 'ODBC', returnsRecords: true });
    writeFileSync(join(dir, 'manifest.json'), JSON.stringify(m, null, 2));
    writeFileSync(join(dir, 'queries/3.sql'), 'SELECT DLookup("Nom","Clients","[N°]=1") AS Premier FROM Clients;\n');
    writeFileSync(join(dir, 'queries/4.sql'), 'SELECT 1\n');
  }
  return dir;
}

type Win = { basecraft: { rows: { page(t: string, r: { offset: number; limit: number }): Promise<{ rows: { values: unknown[] }[] }> } } };
const tableRows = (page: Page, table: string) => page.evaluate((t) => (window as unknown as Win).basecraft.rows.page(t, { offset: 0, limit: 100 })
  .then((p) => p.rows.map((r) => r.values)), table);
const num = (s: string) => Number(s.replace(/[^\d,.-]/g, '').replace(',', '.'));
async function openQuery(page: Page, name: string, how: 'dblclick' | 'design' | 'sqlView') {
  if (how === 'dblclick') await page.getByTestId(`nav-item-query-${name}`).dblclick();
  else { await page.getByTestId(`nav-item-query-${name}`).click({ button: 'right' }); await page.getByTestId(`nav-menu-${how}`).click(); }
}

/** QTotaux (or its renamed copy) as a datasheet: one row per customer having orders, with the sum and the count worked out from `orders`. */
export async function checkTotaux(page: Page, name: string, orders: string) {
  const rows = await tableRows(page, orders);
  const by = new Map<number, { sum: number; n: number }>();
  for (const r of rows) { const e = by.get(Number(r[1])) ?? { sum: 0, n: 0 }; e.sum += Number(r[2]); e.n++; by.set(Number(r[1]), e); }
  const want = [...by.entries()].sort((a, b) => a[0] - b[0]);
  await openQuery(page, name, 'dblclick');
  await expect(page.getByTestId(`doc-tab-query-${name}`)).toBeVisible();
  await expect(doc(page).getByTestId('nav-record-count')).toHaveText(String(want.length));
  for (const [i, [, e]] of want.entries()) {
    expect(num(await cell(page, 1, i).innerText()), `row ${i} sum`).toBeCloseTo(e.sum, 2);
    expect(num(await cell(page, 2, i).innerText()), `row ${i} count`).toBe(e.n);
  }
  const values = await Promise.all(want.map((_, i) => cell(page, 0, i).innerText()));
  await page.getByTestId(`doc-tab-close-query-${name}`).click();
  return values;
}

/** QTotaux in Design view: the grid is shown (not the SQL-only state) and the Totals row is on. */
export async function checkTotauxDesign(page: Page) {
  await openQuery(page, 'QTotaux', 'design');
  await expect(page.getByTestId('doc-tab-query-QTotaux')).toBeVisible();
  await expect(doc(page).getByTestId('qbe-cell-total-0')).toBeVisible();
  await expect(doc(page).getByTestId('query-sql-notice')).toHaveCount(0);
  await page.getByTestId('doc-tab-close-query-QTotaux').click();
}

/** QParVille: the prompt, then exactly the customers of one city; Design view shows the grid. */
export async function checkParVille(page: Page) {
  const clients = await tableRows(page, 'Clients');
  const city = String(clients[0][2]);
  const names = clients.filter((c) => String(c[2]).toLowerCase() === city.toLowerCase()).map((c) => String(c[1])); // Access compares text without case
  await openQuery(page, 'QParVille', 'dblclick');
  await expect(page.getByTestId('modal')).toContainText('Quelle ville ?');
  await page.getByTestId('modal-input').fill(city);
  await page.getByTestId('modal-btn-ok').click();
  await expect(page.getByTestId('doc-tab-query-QParVille')).toBeVisible();
  await expect(doc(page).getByTestId('nav-record-count')).toHaveText(String(names.length));
  for (const [i, n] of names.entries()) await expect(cell(page, 1, i)).toHaveText(n);
  await page.getByTestId('doc-tab-close-query-QParVille').click();
  await openQuery(page, 'QParVille', 'design');
  await expect(page.getByTestId('doc-tab-query-QParVille')).toBeVisible();
  await expect(doc(page).getByTestId('qbe-box-Clients')).toBeVisible();
  await expect(doc(page).getByTestId('query-sql-notice')).toHaveCount(0);
  await page.getByTestId('doc-tab-close-query-QParVille').click();
}

// ---- E4: the form FClients and the report ECommandes of Ventes-complet, read through the form view, Design data and Print Preview ----
type Api = { basecraft: { objects: { get(kind: string, name: string): Promise<{ definition: unknown }> } } };
export const objectDef = (page: Page, kind: 'form' | 'report', name: string) => page.evaluate(([k, n]) => (window as unknown as Api).basecraft.objects.get(k!, n!).then((o) => o.definition), [kind, name]) as Promise<{ recordSource: unknown; props: Record<string, unknown>;
  sections: { kind: string; controls: { name: string; kind: string; left: number; top: number; width: number; height: number; props: Record<string, unknown> }[] }[] }>;

/** FClients in Form view: the first customer's key in the text box N°, Access's numbers for its position, a combo box without a list (the fixture's Modifiable30 has no row source: it cannot open). */
export async function checkFormClients(page: Page) {
  const clients = await tableRows(page, 'Clients');
  await page.getByTestId('nav-item-form-FClients').dblclick();
  await expect(page.getByTestId('form-run')).toBeVisible();
  await expect(page.getByTestId('form-ctl-N°')).toHaveValue(String(clients[0][0]));
  await expect(page.getByTestId('form-ctl-Nom')).toHaveValue(String(clients[0][1]));
  const def = await objectDef(page, 'form', 'FClients');
  expect(def.recordSource).toEqual({ kind: 'table', name: 'Clients' });
  const n = def.sections.flatMap((x) => x.controls).find((c) => c.name === 'N°')!;
  expect([n.left, n.top, n.width, n.height]).toEqual([1620, 343, 10157, 334]);
  await expect(page.getByTestId('form-ctl-Modifiable30-toggle')).toBeDisabled(); // no row source: nothing to list, the arrow is off
  await expect(page.getByTestId('form-ctl-Modifiable30')).toHaveAttribute('aria-expanded', 'false');
  await page.getByTestId('doc-tab-close-form-FClients').click();
}

/** ECommandes in Print Preview: two group levels (customer, then lot), each with a header and a footer per group; the report footer's total is the sum of Montant (as the report formats it). */
export async function checkReportCommandes(page: Page) {
  const orders = await tableRows(page, 'Commandes');
  const customers = new Set(orders.map((r) => Number(r[1])));
  const lots = new Set(orders.map((r) => `${r[1]}|${r[8]}`)); // Lot is the ninth column
  const sum = orders.reduce((t, r) => t + Number(r[2]), 0);
  await page.getByTestId('nav-item-report-ECommandes').dblclick();
  const view = doc(page);
  await expect(view.getByTestId('report-pages')).toBeVisible();
  await expect(view.getByTestId('preview-page-of')).toHaveText('Page 1 sur 1');
  await expect(view.locator('[data-section="groupHeader"]')).toHaveCount(customers.size + lots.size);
  await expect(view.locator('[data-section="groupFooter"]')).toHaveCount(customers.size + lots.size);
  await expect(view.locator('[data-section="reportFooter"]')).toContainText(new RegExp(`${sum.toFixed(2).replace('.', ',')}\\s€`));
  await page.getByTestId('doc-tab-close-report-ECommandes').click();
}
