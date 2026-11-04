// Largeurs de colonne tirées en Feuille de données d'une table ou d'une requête : la question d'Access à la fermeture
// (enregistrer la mise en forme ?), Ctrl+S sans question, et la largeur retrouvée à la réouverture.
import { test, expect, type Page } from '@playwright/test';
import { saveObject } from '../../src/main/db/objects';
import { seedSales } from '../../src/main/query/test-db';
import { colLeft, launchApp, seedBase, seedSalesE2E } from './helpers';

const FR = { BASECRAFT_REGION: 'fr-FR' };
const HEADER = 34, ROW = 30, MORE = 60;
const sheet = (page: Page) => page.locator('[data-testid="datasheet"]:visible');
const cell = (page: Page, col: number, row: number) => sheet(page).getByTestId(`glide-cell-${col + 1}-${row}`);
async function open(page: Page, item: string) {
  await page.getByTestId(`nav-item-${item}`).dblclick();
  await expect(sheet(page).getByTestId('data-grid-canvas')).toBeVisible();
  await expect(cell(page, 0, 0)).toBeAttached();
}
/** The first column's right edge (`from` px past the default) dragged 60 px further (Glide takes a quick mouse-up for a double click: auto-size). */
async function widen(page: Page, from = 0) {
  await page.waitForTimeout(600);
  const b = (await sheet(page).getByTestId('data-grid-canvas').boundingBox())!;
  const edge = colLeft(1) + from;
  await page.mouse.move(b.x + edge - 2, b.y + HEADER / 2);
  await page.mouse.down();
  await page.mouse.move(b.x + edge + MORE, b.y + HEADER / 2, { steps: 5 });
  await page.mouse.up();
}
/** True when the first column is `extra` px wider than the default: a click just inside the new edge lands on it. */
async function firstColumnWider(page: Page, extra: number) {
  const b = (await sheet(page).getByTestId('data-grid-canvas').boundingBox())!;
  await page.mouse.click(b.x + colLeft(1) + extra - 10, b.y + HEADER + ROW / 2);
  await page.waitForTimeout(300);   // the selection settles (aria-selected is read once)
  return (await cell(page, 0, 0).getAttribute('aria-selected')) === 'true';
}
const close = (page: Page, id: string) => page.getByTestId(`doc-tab-close-${id}`).click();

for (const [kind, item, name] of [['table', 'Clients', 'Clients'], ['query', 'query-QClientsLyon', 'query-QClientsLyon']] as const) {
  test(`${kind} datasheet: Yes saves the dragged width, No forgets it, Ctrl+S saves without asking`, async () => {
    test.setTimeout(90_000);
    const { app, page } = await launchApp({ args: [seedSalesE2E(`fx-largeur-${kind}`)], env: FR });
    try {
      // Yes: the question names the object, the width is back on reopening
      await open(page, item);
      await widen(page);
      await close(page, name);
      await expect(page.getByTestId('modal')).toContainText(item.replace('query-', ''));
      await page.getByTestId('modal-btn-yes').click();
      await expect(page.getByTestId(`doc-tab-close-${name}`)).toHaveCount(0);
      await open(page, item);
      expect(await firstColumnWider(page, MORE)).toBe(true);

      // widened again by a non-saved drag, No: nothing more is kept (still the saved width)
      await widen(page, MORE);
      await close(page, name);
      await page.getByTestId('modal-btn-no').click();
      await expect(page.getByTestId(`doc-tab-close-${name}`)).toHaveCount(0);
      await open(page, item);
      expect(await firstColumnWider(page, MORE * 2)).toBe(false);

      // Ctrl+S after a second drag: no question at closing, the new width kept
      await widen(page, MORE);
      await page.keyboard.press('Control+s');
      await close(page, name);
      await expect(page.getByTestId('modal')).toHaveCount(0);
      await expect(page.getByTestId(`doc-tab-close-${name}`)).toHaveCount(0);
      await open(page, item);
      expect(await firstColumnWider(page, MORE * 2)).toBe(true);
    } finally {
      await app.close();
    }
  });
}

test('table datasheet: No leaves the default width on reopening', async () => {
  const { app, page } = await launchApp({ args: [seedSalesE2E('fx-largeur-non')], env: FR });
  try {
    await open(page, 'Clients');
    await widen(page);
    await close(page, 'Clients');
    await page.getByTestId('modal-btn-no').click();
    await open(page, 'Clients');
    expect(await firstColumnWider(page, MORE)).toBe(false);
  } finally {
    await app.close();
  }
});

test('non-updatable query (totals) datasheet: Yes still saves the dragged width', async () => {
  const sql = 'SELECT [Ville], Count(*) AS Nb FROM [Clients] GROUP BY [Ville];';
  const file = seedBase('fx-largeur-totaux', (db) => { seedSales(db); saveObject(db, 'query', 'QTotaux', { formatVersion: '1.0', sql }, null); });
  const { app, page } = await launchApp({ args: [file], env: FR });
  try {
    await open(page, 'query-QTotaux');
    await widen(page);
    await close(page, 'query-QTotaux');
    await expect(page.getByTestId('modal')).toContainText('QTotaux');
    await page.getByTestId('modal-btn-yes').click();
    await expect(page.getByTestId('doc-tab-close-query-QTotaux')).toHaveCount(0);
    await open(page, 'query-QTotaux');
    expect(await firstColumnWider(page, MORE)).toBe(true);
  } finally {
    await app.close();
  }
});
