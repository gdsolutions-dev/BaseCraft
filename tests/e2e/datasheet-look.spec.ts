// O2 Task 5: a table datasheet opens with the Options page's defaults (column width, font size and weight, italic, gridlines), once, when it opens (R1);
// a form's Datasheet view keeps its controls' widths (R12).
import { test, expect, type Page } from '@playwright/test';
import { writeFileSync } from 'node:fs';
import { seedSales } from '../../src/main/query/test-db';
import type { ControlDef, DesignDoc } from '../../src/shared/design/model';
import { DEFAULT_COL_PX, colLeft, launchApp, openDbOptions, seedBase, seedForm } from './helpers';

const FR = { BASECRAFT_REGION: 'fr-FR' };
const HEADER = 34;
const box = (name: string, left: number): ControlDef => ({ kind: 'textBox', name, left, top: 100, width: 1500, height: 340, props: { ControlSource: name, TabIndex: left } });
const formDoc: DesignDoc = {
  formatVersion: '1.0', recordSource: { kind: 'table', name: 'Clients' }, props: { Width: 9000, DefaultView: 'datasheet' },
  sections: [
    { kind: 'formHeader', height: 0, props: { Visible: false }, controls: [] },
    { kind: 'detail', height: 1000, props: {}, controls: [box('Nom', 100), box('Ville', 1700)] },
    { kind: 'formFooter', height: 0, props: { Visible: false }, controls: [] },
  ],
};
const sheet = (page: Page) => page.locator('[data-testid="datasheet"]:visible');
const cell = (page: Page, col: number, row: number) => sheet(page).getByTestId(`glide-cell-${col + 1}-${row}`);
async function open(page: Page, item: string) {
  await page.getByTestId(`nav-item-${item}`).dblclick();
  await expect(sheet(page).getByTestId('data-grid-canvas')).toBeVisible();
  await expect(cell(page, 0, 0)).toBeAttached();
}
/** Clicks at x (from the canvas' left) in the middle of `row`; the cell selected must be (col, row). */
async function clickAt(page: Page, x: number, row: number, rowH: number, col: number) {
  const b = (await sheet(page).getByTestId('data-grid-canvas').boundingBox())!;
  await page.mouse.click(b.x + x, b.y + HEADER + row * rowH + rowH / 2);
  await expect(cell(page, col, row)).toHaveAttribute('aria-selected', 'true');
}

test('defaults, then the Options page\'s width and font: a datasheet opened afterwards uses them', async ({}, testInfo) => {
  const base = seedBase('fx-look', (db) => { seedSales(db); seedForm(db, 'FDonnees', formDoc); });
  const { app, page } = await launchApp({ args: [base], env: FR });
  try {
    // default: 94,47 px columns, 30 px rows
    await open(page, 'Clients');
    await clickAt(page, colLeft(1) + 90, 1, 30, 1);
    await clickAt(page, colLeft(1) + 100, 1, 30, 2);

    // 4 cm, 16 pt, Gras, italique, vertical gridlines off
    await page.getByTestId('ribbon-tab-file').click();
    await page.getByTestId('bs-options').click();
    await page.getByTestId('opt-cat-datasheet').click();
    await page.getByTestId('opt-col-width').fill('4');
    await page.getByTestId('opt-col-width').press('Enter');
    await expect(page.getByTestId('opt-col-width')).toHaveValue('4,00 cm');
    await page.getByTestId('opt-font-size').fill('16');
    await page.getByTestId('opt-font-size').press('Enter');
    await page.getByTestId('opt-font-weight').selectOption('700');
    await page.getByTestId('opt-font-italic').check();
    await page.getByTestId('opt-grid-v').uncheck();
    await page.getByTestId('bs-back').click();

    // the Clients sheet still open keeps its look (R1)
    await expect(sheet(page).getByTestId('data-grid-canvas')).toBeVisible();
    await clickAt(page, colLeft(1) + 90, 1, 30, 1);
    await clickAt(page, colLeft(1) + 100, 1, 30, 2);

    // a Commandes sheet opened now: 151 px columns (4 cm = 2268 twips), rows max(30, ceil(21.33 x 1.5) + 8) = 40 px
    await open(page, 'Commandes');
    await clickAt(page, 44 + 148, 1, 40, 0);
    await clickAt(page, 44 + 154, 1, 40, 1);
    const cv = (await sheet(page).getByTestId('data-grid-canvas').boundingBox())!;
    const shot = await page.screenshot({ clip: { x: cv.x, y: cv.y, width: 420, height: 34 + 4 * 40 } });
    await testInfo.attach('cell', { body: shot, contentType: 'image/png' });
    if (process.env.BC_SHOT) writeFileSync(process.env.BC_SHOT, shot);   // manual check of the font (Task 10)

    // a form's Datasheet view keeps its controls' widths (1500 twips = 100 px)
    await page.getByTestId('nav-item-form-FDonnees').dblclick();
    const frame = page.getByTestId('form-run');
    const b = (await frame.getByTestId('data-grid-canvas').boundingBox())!;
    await page.mouse.click(b.x + 44 + 97, b.y + HEADER + 15);
    await expect(frame.getByTestId('glide-cell-1-0')).toHaveAttribute('aria-selected', 'true');
  } finally {
    await app.close();
  }
});

// O2 R13: « Vérifier les champs numériques tronqués »: a number too wide for its column shows #### (the real value stays for copy and the editor).
// Glide's accessible cell reads the edit text, never the shown one: the #### is checked on the canvas pixels.
test('a too-narrow number column shows ####, copy gives the value; unticked, the value; a date column is left alone', async () => {
  const base = seedBase('fx-trunc', (db) => { seedSales(db); db.prepare('UPDATE "Commandes" SET "Montant" = 12345678.9 WHERE "N°" = 1').run(); });
  const { app, page } = await launchApp({ args: [base], env: FR });
  const dragEdge = async (edge: number, to: number) => {
    const b = (await sheet(page).getByTestId('data-grid-canvas').boundingBox())!;
    await page.mouse.move(b.x + edge - 3, b.y + 15);
    await page.mouse.move(b.x + edge, b.y + 15);
    await page.mouse.down();
    await page.mouse.move(b.x + to, b.y + 15, { steps: 5 });
    await page.mouse.up();
  };
  /** The pixels of row 0 between two x (from the canvas' left). */
  const shot = async (from: number, to: number) => {
    const b = (await sheet(page).getByTestId('data-grid-canvas').boundingBox())!;
    return page.screenshot({ clip: { x: b.x + from + 1, y: b.y + HEADER + 2, width: to - from - 2, height: 26 } });
  };
  const narrow = async () => {   // Montant (41 px: the drag's own offset), then Le
    await dragEdge(colLeft(3) - 1, colLeft(2) + 40);
    await dragEdge(colLeft(2) + 40 + DEFAULT_COL_PX - 1, colLeft(2) + 80);
  };
  try {
    await open(page, 'Commandes');
    await narrow();
    const dateOn = await shot(colLeft(2) + 41, colLeft(2) + 80);
    await clickAt(page, colLeft(2) + 20, 0, 30, 2);
    await page.keyboard.press('Control+c');
    await expect.poll(() => app.evaluate(({ clipboard }) => clipboard.readText())).toMatch(/^12.345.678,90.€$/);
    await page.keyboard.press('F2');
    await expect(page.locator('#portal textarea')).toHaveValue(/^12345678,9/);
    await page.keyboard.press('Escape');
    const montantOn = await shot(colLeft(2), colLeft(2) + 41);   // selected
    await dragEdge(colLeft(2) + 41, colLeft(2) + 150);   // widened: the value again
    expect((await shot(colLeft(2), colLeft(2) + 41)).equals(montantOn)).toBe(false);

    // unticked, a datasheet opened afterwards shows the value (clipped on screen): not the #### drawn above
    await page.getByTestId('ribbon-tab-file').click();
    await openDbOptions(page);
    await page.getByTestId('opt-db-truncated').uncheck();
    await page.getByTestId('bs-back').click();
    await page.getByTestId('doc-tab-close-Commandes').click();
    await page.getByTestId('modal-btn-no').click();   // the widths dragged: the layout is not saved
    await open(page, 'Commandes');
    await narrow();
    await clickAt(page, colLeft(2) + 20, 0, 30, 2);
    expect((await shot(colLeft(2), colLeft(2) + 41)).equals(montantOn)).toBe(false);
    expect((await shot(colLeft(2) + 41, colLeft(2) + 80)).equals(dateOn)).toBe(true);   // a date column is the same either way
  } finally {
    await app.close();
  }
});
