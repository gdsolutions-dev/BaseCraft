import { test, expect, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { BasecraftApi } from '../../src/shared/api';
import { launchApp, seedSalesE2E, seedSlow } from './helpers';

const fr = JSON.parse(readFileSync(join(__dirname, '../../src/shared/i18n/fr.json'), 'utf8'));
const FR = { BASECRAFT_REGION: 'fr-FR' };
// DatasheetView: row selector width, header and row heights, AutoNumber column width.
const MARKER = 44, HEADER = 34, ROW = 30, AUTONUMBER = 80;
/** The page's API (`basecraft`), inside page.evaluate. */
type Win = { basecraft: BasecraftApi };

/** The shown document (every tab stays mounted, hidden). */
const doc = (page: Page) => page.locator('section[role=tabpanel]:not([hidden])');
const cell = (page: Page, col: number, row: number) => doc(page).getByTestId(`glide-cell-${col + 1}-${row}`);
const cellEditor = (page: Page) => page.getByTestId('grid-editor-portal').locator('textarea');
async function grid(page: Page) {
  const c = doc(page).getByTestId('data-grid-canvas');
  await expect(c).toBeVisible();
  return (await c.boundingBox())!;
}
/** Clicks the cell at x (from the grid's left, after the row selectors) of a row and waits for Glide's focus. */
async function clickCell(page: Page, x: number, row: number, col: number) {
  const b = await grid(page);
  await page.mouse.click(b.x + MARKER + x, b.y + HEADER + row * ROW + ROW / 2);
  await expect(cell(page, col, row)).toBeFocused();
}
async function openQuery(page: Page, name: string) {
  await page.getByTestId(`nav-item-query-${name}`).dblclick();
  await expect(page.getByTestId(`doc-tab-query-${name}`)).toBeVisible();
}
const rowcount = (page: Page) => doc(page).getByTestId('datasheet').locator('table[role=grid]');

test('a parameter query asks its value first (Access), then shows its rows; Escape closes the tab', async () => {
  const { app, page } = await launchApp({ args: [seedSalesE2E('param')], env: FR });
  try {
    await page.getByTestId('nav-item-query-QDepuis').dblclick();
    await expect(page.getByTestId('modal')).toContainText(fr.query.param.title);
    await expect(page.getByTestId('modal')).toContainText('Date début :');
    await page.getByTestId('modal-input').fill('31/02/2026'); // checked as a date, in the region
    await page.getByTestId('modal-btn-ok').click();
    await expect(page.getByTestId('modal-error')).toHaveText(fr.fieldError.invalidDate);
    await page.getByTestId('modal-input').fill('05/10/2026');
    await page.getByTestId('modal-btn-ok').click();
    await expect(page.getByTestId('doc-tab-query-QDepuis')).toBeVisible();
    await expect(doc(page).getByTestId('nav-record-count')).toHaveText('3');
    await expect(cell(page, 0, 0)).toHaveText('2');
    await page.getByTestId('doc-tab-close-query-QDepuis').click();

    await page.getByTestId('nav-item-query-QDepuis').dblclick();
    await expect(page.getByTestId('modal-input')).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('modal')).toHaveCount(0);
    await expect(page.getByTestId('doc-tab-query-QDepuis')).toHaveCount(0);
  } finally {
    await app.close();
  }
});

test('a query that cannot run shows why, then its tab closes (a renamed table); an action query asks to run, no datasheet', async () => {
  const { app, page } = await launchApp({ args: [seedSalesE2E('erreurs')], env: FR });
  try {
    expect(await page.evaluate(() => (window as unknown as Win).basecraft.objects.save('query', 'QSuppr', { formatVersion: '1.0', sql: 'DELETE FROM Commandes WHERE Montant > 1000;' }, null))).toEqual({ ok: true });
    expect(await page.evaluate(() => (window as unknown as Win).basecraft.tables.rename('Clients', 'Contacts'))).toEqual({ ok: true });
    await page.reload();
    await page.waitForSelector('[data-testid="app-root"]', { state: 'attached' });
    for (const [name, message, button] of [['QSuppr', fr.query.action.confirm_delete_one.replace('{{count}}', '0'), 'no'],
      ['QClientsLyon', fr.dialog.error.notFound_unknownSource.replace('{{detail}}', 'Clients'), 'ok']]) {
      await page.getByTestId(`nav-item-query-${name}`).dblclick();
      await expect(page.getByTestId('modal')).toContainText(message);
      await page.getByTestId(`modal-btn-${button}`).click();
      await expect(page.getByTestId(`doc-tab-query-${name}`)).toHaveCount(0);
    }
  } finally {
    await app.close();
  }
});

test('a one-table query is updatable: an edit and a new record reach the Clients table', async () => {
  const { app, page } = await launchApp({ args: [seedSalesE2E('saisie-requete')], env: FR });
  try {
    await openQuery(page, 'QClientsLyon');
    await expect(doc(page).getByTestId('nav-record-count')).toHaveText('2');
    await expect(doc(page).getByTestId('nav-readonly')).toHaveCount(0);
    await clickCell(page, AUTONUMBER + 30, 0, 1); // Dupont's Nom
    await page.keyboard.press('D'); // the first key opens the editor, replacing the text
    await expect(cellEditor(page)).toBeFocused();
    await page.keyboard.type('upond');
    await page.keyboard.press('Enter');
    await expect(cellEditor(page)).toHaveCount(0);
    await expect(doc(page).getByTestId('datasheet')).not.toHaveAttribute('aria-busy', 'true');
    await expect(cell(page, 1, 0)).toHaveText('Dupond');

    // a new record: the trailing row's Nom, then Ville
    const b = await grid(page);
    await page.mouse.click(b.x + MARKER + AUTONUMBER + 30, b.y + HEADER + 2 * ROW + ROW / 2);
    await expect(cellEditor(page)).toBeFocused();
    await page.keyboard.type('Petit');
    await page.keyboard.press('Tab');
    await expect(cellEditor(page)).toHaveCount(0);
    await page.keyboard.press('L');
    await expect(cellEditor(page)).toBeFocused();
    await page.keyboard.type('yon');
    await page.keyboard.press('Enter');
    await expect(cellEditor(page)).toHaveCount(0);
    await expect(doc(page).getByTestId('nav-record-count')).toHaveText('3');
    await page.getByTestId('doc-tab-close-query-QClientsLyon').click();

    await page.getByTestId('nav-item-Clients').dblclick();
    await expect(cell(page, 1, 0)).toHaveText('Dupond');
    const rows = await page.evaluate(() => (window as unknown as Win).basecraft.rows.page('Clients', { offset: 0, limit: 10 }));
    expect(rows.rows.map((r) => r.values.slice(1))).toEqual([['Dupond', 'Lyon'], ['Martin', 'LYON'], ['Durand', 'Paris'], ['Éric', 'Lyôn'], ['Petit', 'Lyon']]);
  } finally {
    await app.close();
  }
});

test('a join is read-only: no new record row, cells not editable, the reason in the navigation bar; sorting works', async () => {
  const { app, page } = await launchApp({ args: [seedSalesE2E('jointure')], env: FR });
  try {
    await openQuery(page, 'QVentes');
    await expect(doc(page).getByTestId('nav-record-count')).toHaveText('5');
    await expect(rowcount(page)).toHaveAttribute('aria-rowcount', '6'); // header + 5 records, no new record row
    await expect(doc(page).getByTestId('nav-readonly')).toHaveText(fr.query.readOnly);
    await expect(doc(page).getByTestId('nav-new')).toBeDisabled();
    await clickCell(page, 30, 0, 0);
    await page.keyboard.type('X');
    await expect(cellEditor(page)).toHaveCount(0); // a read-only cell opens no editor
    await page.keyboard.press('Escape');
    await expect(cell(page, 0, 0)).toHaveText('Dupont');
    await expect(page.getByTestId('doc-tab-query-QVentes')).not.toContainText('•');
    await page.getByTestId('ribbon-tab-home').click();
    for (const id of ['newRecord', 'deleteRecord']) await expect(page.getByTestId(`cmd-${id}`)).toBeDisabled();
    await expect(page.getByTestId('cmd-sortAsc')).toBeEnabled();
    await clickCell(page, 30, 0, 0); // Escape left no selection: the sort applies to the selected column
    await page.getByTestId('cmd-sortAsc').click();
    for (const [row, nom] of ['Dupont', 'Dupont', 'Durand', 'Martin', 'Martin'].entries()) await expect(cell(page, 0, row)).toHaveText(nom);
  } finally {
    await app.close();
  }
});

test('the Clients table datasheet still sorts, filters by selection, takes entries and deletes (A1/A2)', async () => {
  const { app, page } = await launchApp({ args: [seedSalesE2E('table')], env: FR });
  try {
    await page.getByTestId('nav-item-Clients').dblclick();
    await expect(doc(page).getByTestId('nav-record-count')).toHaveText('4');
    await clickCell(page, AUTONUMBER + 30, 0, 1);
    await page.getByTestId('ribbon-tab-home').click();
    await page.getByTestId('cmd-sortDesc').click();
    await expect(cell(page, 1, 0)).toHaveText('Martin');
    await clickCell(page, AUTONUMBER + 170 + 30, 1, 2); // Éric's Ville (Martin, Éric, Durand, Dupont); Éric has no orders
    await expect(cell(page, 2, 1)).toHaveText('Lyôn');
    await page.getByTestId('cmd-filterSelection').click();
    await page.getByTestId('filter-menu-equals').click();
    await expect(doc(page).getByTestId('nav-record-count')).toHaveText('1'); // accents count, as in Access
    await clickCell(page, AUTONUMBER + 30, 0, 1);
    await page.keyboard.press('Z');
    await expect(cellEditor(page)).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(cellEditor(page)).toHaveCount(0);
    await expect(doc(page).getByTestId('datasheet')).not.toHaveAttribute('aria-busy', 'true');
    await expect(cell(page, 1, 0)).toHaveText('Z');
    const b = await grid(page);
    await page.mouse.click(b.x + MARKER / 2, b.y + HEADER + ROW / 2);
    await page.keyboard.press('Delete');
    await page.getByTestId('modal-btn-yes').click();
    await expect(doc(page).getByTestId('nav-record-count')).toHaveText('0');
    expect((await page.evaluate(() => (window as unknown as Win).basecraft.rows.count('Clients')))).toBe(3);
  } finally {
    await app.close();
  }
});

test('Shift+F9 reads the query again with the same parameter values: a row added elsewhere appears', async () => {
  const { app, page } = await launchApp({ args: [seedSalesE2E('requery')], env: FR });
  try {
    await openQuery(page, 'QClientsLyon');
    await expect(doc(page).getByTestId('nav-record-count')).toHaveText('2');
    expect(await page.evaluate(() => (window as unknown as Win).basecraft.rows.insert('Clients', { Nom: 'Petit', Ville: 'Lyon' }))).toMatchObject({ ok: true });
    await expect(doc(page).getByTestId('nav-record-count')).toHaveText('2'); // nothing told the datasheet
    await page.keyboard.press('Shift+F9');
    await expect(doc(page).getByTestId('nav-record-count')).toHaveText('3');
    await expect(cell(page, 1, 2)).toHaveText('Petit');

    await page.getByTestId('nav-item-query-QDepuis').dblclick();
    await page.getByTestId('modal-input').fill('21/10/2026');
    await page.getByTestId('modal-btn-ok').click();
    await expect(doc(page).getByTestId('nav-record-count')).toHaveText('2');
    expect(await page.evaluate(() => (window as unknown as Win).basecraft.rows.insert('Commandes', { Client: '1', Montant: '5', Le: '22/10/2026' }))).toMatchObject({ ok: true });
    await page.keyboard.press('Shift+F9');
    await expect(doc(page).getByTestId('nav-record-count')).toHaveText('3'); // no prompt again
    await expect(page.getByTestId('modal')).toHaveCount(0);
  } finally {
    await app.close();
  }
});

/** The top-level menu: its items (test ids without the prefix) with '|' for each separator. */
const menuLayout = (page: Page) => page.getByTestId('nav-menu').evaluate((m) =>
  [...m.children].map((e) => (e.getAttribute('role') === 'separator' ? '|' : (e.querySelector('[role="menuitem"]') ?? e).getAttribute('data-testid')!.replace('nav-menu-', ''))));

test('Navigation Pane menu of a query: Open runs it (parameters first); Delete names the objects that use it', async () => {
  const { app, page } = await launchApp({ args: [seedSalesE2E('menu-requete')], env: FR });
  try {
    await page.getByTestId('nav-item-query-QDepuis').click({ button: 'right' });
    expect(await menuLayout(page)).toEqual(['open', 'design', 'sqlView', '|', 'export', '|', 'rename', 'hide', 'delete', '|', 'cut', 'copy', 'paste', '|', 'properties']);
    await expect(page.getByTestId('nav-menu-open')).toBeEnabled();
    await page.getByTestId('nav-menu-open').click();
    await expect(page.getByTestId('modal')).toContainText('Date début :');
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('doc-tab-query-QDepuis')).toHaveCount(0);

    expect(await page.evaluate(() => (window as unknown as Win).basecraft.objects.save('query', 'QNoms', { formatVersion: '1.0', sql: 'SELECT Nom FROM QClientsLyon;' }, null))).toEqual({ ok: true });
    await page.getByTestId('nav-item-query-QClientsLyon').click({ button: 'right' });
    await page.getByTestId('nav-menu-delete').click();
    await expect(page.getByTestId('modal')).toContainText('QNoms');
    await expect(page.getByTestId('modal-btn-no')).toBeFocused(); // default No
    await page.getByTestId('modal-btn-no').click();
    await expect(page.getByTestId('nav-item-query-QClientsLyon')).toBeVisible();
    expect((await page.evaluate(() => (window as unknown as Win).basecraft.objects.list('query'))).map((o) => o.name)).toContain('QClientsLyon');

    // without dependents: the foundation's message, Yes deletes
    await page.getByTestId('nav-item-query-QVentes').click({ button: 'right' });
    await page.getByTestId('nav-menu-delete').click();
    await expect(page.getByTestId('modal')).toContainText(fr.nav.deleteObjectMessage.replace('{{name}}', 'QVentes'));
    await page.getByTestId('modal-btn-yes').click();
    await expect(page.getByTestId('nav-item-query-QVentes')).toHaveCount(0);
  } finally {
    await app.close();
  }
});

test('SQL View from a datasheet whose pending row stays (mode guard refused): the next Design View is the grid', async () => {
  const { app, page } = await launchApp({ args: [seedSalesE2E('sql-refuse')], env: FR });
  try {
    await openQuery(page, 'QClientsLyon');
    await expect(doc(page).getByTestId('nav-record-count')).toHaveText('2');
    // a new record without its required Nom
    const b = await grid(page);
    await page.mouse.click(b.x + MARKER + AUTONUMBER + 30, b.y + HEADER + 2 * ROW + ROW / 2);
    await expect(cellEditor(page)).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(cellEditor(page)).toHaveCount(0);
    await page.keyboard.press('X');
    await expect(cellEditor(page)).toBeFocused();
    await page.getByTestId('status-view-sql').click();
    await page.getByTestId('modal-btn-ok').click(); // the row cannot be saved (Nom is required)
    await expect(page.getByTestId('modal')).toContainText(fr.datasheet.discard.replace('{{name}}', 'QClientsLyon'));
    await page.getByTestId('modal-btn-no').click(); // the row stays: so does the datasheet
    await expect(doc(page).getByTestId('nav-record-count')).toBeVisible();
    // later, Design View: the grid, not the SQL view of the refused request
    await page.getByTestId('status-view-design').click();
    await page.getByTestId('modal-btn-ok').click();
    await page.getByTestId('modal-btn-yes').click(); // discard the row this time
    await expect(doc(page).getByTestId('qbe-cell-field-0')).toHaveValue('*');
    await expect(doc(page).getByTestId('query-sql')).toHaveCount(0);
  } finally {
    await app.close();
  }
});

test('a slow query shows « Exécution… » with Stop: the run is cancelled, the base stays open and writable (lock adopted)', async () => {
  const base = seedSlow('lente');
  const { app, page } = await launchApp({ args: [base], env: FR });
  try {
    await page.getByTestId('nav-item-query-QLente').dblclick();
    await expect(page.getByTestId('running-notice')).toContainText(fr.query.run.running);
    await page.getByTestId('query-cancel').click();
    await expect(page.getByTestId('modal')).toContainText(fr.dialog.error.cancelled);
    await page.getByTestId('modal-btn-ok').click();
    await expect(page.getByTestId('doc-tab-query-QLente')).toHaveCount(0);
    expect(await page.evaluate(() => (window as unknown as Win).basecraft.base.state())).toMatchObject({ path: base, readOnly: false });
    expect(JSON.parse(readFileSync(`${base}.lock`, 'utf8')).pid).not.toBe(await app.evaluate(() => process.pid)); // held by the data process

    await page.getByTestId('nav-item-Clients').dblclick();
    await expect(doc(page).getByTestId('nav-record-count')).toHaveText('4');
    const b = await grid(page);
    await page.mouse.click(b.x + MARKER + AUTONUMBER + 30, b.y + HEADER + 4 * ROW + ROW / 2); // the new record row's Nom
    await expect(cellEditor(page)).toBeFocused();
    await page.keyboard.type('Zoe');
    await page.keyboard.press('Tab');
    await expect(cellEditor(page)).toHaveCount(0);
    await expect(cell(page, 2, 4)).toBeFocused();
    await page.keyboard.press('N');
    await expect(cellEditor(page)).toBeFocused();
    await page.keyboard.type('ice');
    await page.keyboard.press('Enter'); // leaves the row: saved
    await expect(doc(page).getByTestId('nav-record-count')).toHaveText('5');
    await expect.poll(() => page.evaluate(() => (window as unknown as Win).basecraft.rows.count('Clients'))).toBe(5);
  } finally {
    await app.close();
  }
});

test('a datasheet row saved behind a slow query: Ctrl+Break stops the query, the row stays to be saved, then saves', async () => {
  const base = seedSlow('file');
  const { app, page } = await launchApp({ args: [base], env: FR });
  try {
    await page.getByTestId('nav-item-Clients').dblclick();
    await expect(doc(page).getByTestId('nav-record-count')).toHaveText('4');
    await page.getByTestId('nav-item-query-QLente').dblclick();
    await expect(page.getByTestId('running-notice')).toBeVisible();
    await page.getByTestId('doc-tab-Clients').click();
    const b = await grid(page);
    await page.mouse.click(b.x + MARKER + AUTONUMBER + 30, b.y + HEADER + 4 * ROW + ROW / 2); // the new record row's Nom
    await expect(cellEditor(page)).toBeFocused();
    await page.keyboard.type('Zoe');
    await page.keyboard.press('Enter'); // leaves the cell
    await expect(cellEditor(page)).toHaveCount(0);
    await page.keyboard.press('ArrowUp'); // leaves the row: its insert waits behind the query
    await expect(doc(page).getByTestId('datasheet')).toHaveAttribute('aria-busy', 'true');
    await page.keyboard.press('Control+Pause');
    await expect(page.getByTestId('modal')).toContainText(fr.dialog.error.cancelled); // once: the query, the row's save, a refresh
    await page.waitForTimeout(300); // read by a person: longer than Glide's delay before it moves the focus to the selected cell
    await page.getByTestId('modal-btn-ok').click();
    await expect(page.getByTestId('modal')).toHaveCount(0);
    expect(await page.evaluate(() => (window as unknown as Win).basecraft.rows.count('Clients'))).toBe(4); // never written
    await expect(cell(page, 1, 4)).toHaveText('Zoe'); // the row stays, still to be saved
    await expect(cell(page, 1, 4)).toBeFocused(); // a refused save keeps the row selected (as Access)
    await page.keyboard.press('ArrowUp'); // leaving it again saves it
    await expect.poll(() => page.evaluate(() => (window as unknown as Win).basecraft.rows.count('Clients'))).toBe(5);
    await expect(doc(page).getByTestId('nav-record-count')).toHaveText('5');
  } finally {
    await app.close();
  }
});

test('a slow action query shows the same Stop: its count is cancelled, nothing is written', async () => {
  const { app, page } = await launchApp({ args: [seedSlow('action')], env: FR });
  try {
    await page.getByTestId('nav-item-query-QLenteAction').dblclick();
    await expect(page.getByTestId('running-notice')).toContainText(fr.query.run.running);
    await page.getByTestId('query-cancel').click();
    await expect(page.getByTestId('modal')).toContainText(fr.dialog.error.cancelled);
    await page.getByTestId('modal-btn-ok').click();
    await expect(page.getByTestId('running-notice')).toHaveCount(0);
    expect((await page.evaluate(() => (window as unknown as Win).basecraft.tables.list())).map((t) => t.name)).not.toContain('Lente');
  } finally {
    await app.close();
  }
});

test('during a slow query the ribbon stays responsive', async () => {
  const { app, page } = await launchApp({ args: [seedSlow('ruban')], env: FR });
  try {
    await page.getByTestId('nav-item-query-QLente').dblclick();
    await expect(page.getByTestId('query-cancel')).toBeVisible();
    const t0 = Date.now();
    await page.getByTestId('ribbon-tab-create').click();
    await expect(page.getByTestId('ribbon-tab-create')).toHaveAttribute('aria-selected', 'true');
    expect(Date.now() - t0).toBeLessThan(500);
    // the main process answers too (the query runs in the data process)
    expect(await page.evaluate(() => (window as unknown as Win).basecraft.app.getSettings().then(() => true))).toBe(true);
    await page.getByTestId('query-cancel').click();
    await page.getByTestId('modal-btn-ok').click();
  } finally {
    await app.close();
  }
});
