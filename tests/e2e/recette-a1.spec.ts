// Recette du lot A1 : de la création d'une base à la relecture en lecture seule, en français.
import { test, expect, type Page } from '@playwright/test';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { launchApp } from './helpers';

// DatasheetView: row selector width, header and row heights, column widths of the table below (AutoNumber, short text ×2, date, yes/no, currency).
const MARKER = 44, HEADER = 34, ROW = 30;
const WIDTHS = [80, 170, 170, 150, 80, 120];

async function canvas(page: Page) {
  return (await page.getByTestId('datasheet').getByTestId('data-grid-canvas').boundingBox())!;
}
const cell = (page: Page, col: number, row: number) => page.getByTestId(`glide-cell-${col + 1}-${row}`);
const cellEditor = (page: Page) => page.getByTestId('grid-editor-portal').locator('textarea');
/** Clicks a cell of the grid (column index, row index; the trailing row comes after the last record). */
async function clickCell(page: Page, col: number, row: number) {
  const b = await canvas(page);
  const x = MARKER + WIDTHS.slice(0, col).reduce((a, w) => a + w, 0) + 30;
  await page.mouse.click(b.x + x, b.y + HEADER + row * ROW + ROW / 2);
}
/** Enter / Tab in an open editor keeps the text and moves; waits until the editor is gone and no row is being saved. */
async function closeEditor(page: Page, key: 'Enter' | 'Tab') {
  await page.keyboard.press(key);
  await expect(cellEditor(page)).toHaveCount(0);
  await expect(page.getByTestId('datasheet')).not.toHaveAttribute('aria-busy', 'true');
}
/** Typing on the selected cell opens its editor with the first key; the rest goes to the editor once it is open. */
async function typeIntoCell(page: Page, text: string) {
  await expect(page.getByTestId('datasheet').locator('td[role=gridcell]:focus')).toHaveCount(1);
  await page.keyboard.press(text[0]);
  await expect(cellEditor(page)).toBeFocused();
  await page.keyboard.type(text.slice(1));
}
/** Starts a record on the trailing row (Nom's editor opens), then fills Nom, Ville, Inscrit and Solde, skipping Actif; Enter saves the row. */
async function addRecord(page: Page, row: number, [nom, ville, inscrit, solde]: string[]) {
  await clickCell(page, 1, row);
  await expect(cellEditor(page)).toBeFocused();
  await page.keyboard.type(nom);
  await closeEditor(page, 'Tab');
  await typeIntoCell(page, ville);
  await closeEditor(page, 'Tab');
  await typeIntoCell(page, inscrit);
  await closeEditor(page, 'Tab');
  await clickCell(page, 5, row);
  await expect(cell(page, 5, row)).toBeFocused();
  await typeIntoCell(page, solde);
  await closeEditor(page, 'Enter');
  await expect(page.getByTestId('nav-record-count')).toHaveText(String(row + 1));
}
/** Glide paints cell texts on a canvas and its accessible copy only holds the edit text: to read what is displayed
 *  (with its exact characters), record what is painted from now on. Call before the grid is first drawn. */
const recordPaintedTexts = (page: Page) => page.evaluate(() => {
  const w = window as unknown as { painted: string[] };
  w.painted = [];
  const orig = CanvasRenderingContext2D.prototype.fillText;
  CanvasRenderingContext2D.prototype.fillText = function (this: CanvasRenderingContext2D, t: string, x: number, y: number, maxWidth?: number) {
    w.painted.push(t);
    return orig.call(this, t, x, y, maxWidth);
  };
});
const painted = (page: Page) => page.evaluate(() => (window as unknown as { painted: string[] }).painted);

test('recette A1', async () => {
  test.setTimeout(120_000);
  const dir = mkdtempSync(join(tmpdir(), 'basecraft-recette-'));
  const base = join(dir, 'Factures.basecraft');
  const env = { BASECRAFT_REGION: 'fr-FR' };

  // 1-2. new base, table Clients
  let { app, page } = await launchApp({ env: { ...env, BASECRAFT_E2E_SAVE_PATH: base } });
  const apps = [app];
  try {
    await page.getByTestId('bs-new').click();
    await expect(page.getByTestId('nav-pane')).toBeVisible();
    await page.getByTestId('ribbon-tab-create').click();
    await page.getByTestId('cmd-createTableDesign').click();
    await expect(page.getByTestId('doc-tab-Table1')).toBeVisible();
    const field = async (i: number, name: string, type: string) => {
      await page.getByTestId(`design-row-${i}-name`).fill(name);
      await page.getByTestId(`design-row-${i}-type`).selectOption(type);
    };
    await field(0, 'N°', 'autoNumber');
    await field(1, 'Nom', 'shortText');
    await page.getByTestId('prop-size').fill('50');
    await page.getByTestId('prop-required').check();
    await field(2, 'Ville', 'shortText');
    await field(3, 'Inscrit', 'dateTime');
    await field(4, 'Actif', 'yesNo');
    await field(5, 'Solde', 'currency');
    await expect(page.getByTestId('design-row-0-key')).toHaveAttribute('data-primary-key', 'true');
    await page.keyboard.press('Control+s');
    await page.getByTestId('modal-input').fill('Clients');
    await page.getByTestId('modal-btn-ok').click();
    await expect(page.getByTestId('nav-item-Clients')).toBeVisible();
    await expect(page.getByTestId('doc-tab-Clients')).not.toContainText('•');

    // 3. three records
    await page.getByTestId('status-view-datasheet').click();
    await expect(page.getByTestId('datasheet').getByTestId('data-grid-canvas')).toBeVisible();
    await addRecord(page, 0, ['Dupont', 'Lyon', '21/10/2026', '1 234,50']);
    await addRecord(page, 1, ['Martin', 'Nantes', '22/10/2026', '10']);
    await addRecord(page, 2, ['Durand', 'Lille', '23/10/2026', '0,5']);

    // 4. a record without Nom: error shown, Escape cancels it
    await clickCell(page, 1, 3);
    await expect(cellEditor(page)).toBeFocused();
    await closeEditor(page, 'Tab');
    await typeIntoCell(page, 'Paris');
    await page.keyboard.press('Enter');
    await page.getByTestId('modal-btn-ok').click();
    await expect(page.getByTestId('datasheet-error')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('datasheet-error')).toHaveCount(0);
    await expect(page.getByTestId('nav-record-count')).toHaveText('3');
  } finally {
    // 5. close the application
    await app.close();
  }

  // 5-6. relaunch on the file: three records, display formats; start-up time
  const t0 = Date.now();
  ({ app, page } = await launchApp({ args: [base], env }));
  apps.push(app);
  try {
    await expect(page.getByTestId('nav-pane')).toBeVisible();
    const startupMs = Date.now() - t0;
    mkdirSync('test-results', { recursive: true });
    writeFileSync(join('test-results', 'perf-a1.json'), JSON.stringify({ startupMs }, null, 2));

    await recordPaintedTexts(page);
    await page.getByTestId('nav-item-Clients').dblclick();
    await expect(page.getByTestId('datasheet').getByTestId('data-grid-canvas')).toBeVisible();
    await expect(page.getByTestId('nav-record-count')).toHaveText('3');
    await expect.poll(() => painted(page)).toEqual(expect.arrayContaining(['1 234,50 €', '21/10/2026', 'Durand'])); // U+202F group separator, U+00A0 before €

    // 7. design: Ville → Commune, Solde → Nombre réel double
    await page.getByTestId('status-view-design').click();
    await page.getByTestId('design-row-2-name').fill('Commune');
    await page.getByTestId('design-row-5-name').click(); // selects the row whose properties are shown
    await page.getByTestId('design-row-5-type').selectOption('number');
    await page.getByTestId('prop-numberSize').selectOption('double');
    await page.keyboard.press('Control+s');
    await expect(page.getByTestId('doc-tab-Clients')).not.toContainText('•');
    await expect(page.getByTestId('modal')).toHaveCount(0);
    await recordPaintedTexts(page);
    await page.getByTestId('status-view-datasheet').click();
    await expect(page.getByTestId('datasheet').locator('th[role=columnheader]').nth(2)).toHaveText('Commune');
    await expect(cell(page, 2, 0)).toHaveText('Lyon');
    await expect.poll(() => painted(page)).toEqual(expect.arrayContaining(['1 234,5'])); // a plain number now: no currency sign
    const { rows } = await page.evaluate(() => (window as any).basecraft.rows.page('Clients', { offset: 0, limit: 10 }));
    expect(rows.map((r: { values: unknown[] }) => [r.values[1], r.values[2], r.values[3], r.values[5]])).toEqual([
      ['Dupont', 'Lyon', '2026-10-21 00:00:00', 1234.5],
      ['Martin', 'Nantes', '2026-10-22 00:00:00', 10],
      ['Durand', 'Lille', '2026-10-23 00:00:00', 0.5],
    ]);

    // 8. a second instance on the same file: read-only
    const second = await launchApp({ args: [base], env });
    apps.push(second.app);
    const p = second.page;
    await expect(p.getByTestId('banner-readonly')).toBeVisible();
    await p.getByTestId('nav-item-Clients').dblclick();
    await expect(p.getByTestId('datasheet').getByTestId('data-grid-canvas')).toBeVisible();
    await expect(cell(p, 1, 0)).toHaveText('Dupont');
    await expect(p.getByTestId('datasheet').locator('table[role=grid]')).toHaveAttribute('aria-rowcount', '4'); // header + 3 records, no new-record row
    await expect(p.getByTestId('nav-new')).toBeDisabled();
  } finally {
    for (const a of apps) await a.close().catch(() => undefined);
  }
});
