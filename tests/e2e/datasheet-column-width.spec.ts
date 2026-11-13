// Largeurs de colonne tirées en Feuille de données d'une table ou d'une requête : la question d'Access à la fermeture
// (enregistrer la mise en forme ?), Ctrl+S sans question, et la largeur retrouvée à la réouverture.
import { test, expect, type Page } from '@playwright/test';
import { saveObject } from '../../src/main/db/objects';
import { createTable } from '../../src/main/db/schema';
import { seedSales } from '../../src/main/query/test-db';
import { f, t } from '../../src/shared/test-fixtures';
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

test('More › Hide Fields: typing goes to the field shown, Unhide brings the field back, the layout keeps it hidden', async () => {
  test.setTimeout(90_000);
  const { app, page } = await launchApp({ args: [seedSalesE2E('fx-masquer')], env: FR });
  const clickCell = async (col: number, row: number) => {
    const b = (await sheet(page).getByTestId('data-grid-canvas').boundingBox())!;
    await page.mouse.click(b.x + colLeft(col) + 20, b.y + HEADER + row * ROW + ROW / 2);
    await expect(cell(page, col, row)).toHaveAttribute('aria-selected', 'true');
  };
  const more = async (item: string) => { await page.getByTestId('cmd-moreRecords').click(); await page.getByTestId(item).click(); };
  try {
    await open(page, 'Clients');   // N°, Nom, Ville
    const nom = (await cell(page, 1, 0).textContent())!;
    await clickCell(1, 0);
    await more('more-hide');
    await expect(cell(page, 2, 0)).toHaveCount(0);   // two columns left: N°, Ville
    await expect(cell(page, 1, 0)).toHaveAttribute('aria-selected', 'true');   // the current cell moved to the next field shown

    // typed in the second column of the grid: written to Ville, not to the hidden Nom
    await page.keyboard.type('Zed');
    await page.keyboard.press('Enter');
    await expect(sheet(page)).not.toHaveAttribute('aria-busy', 'true');
    await expect(cell(page, 1, 0)).toHaveText('Zed');
    const row = (await page.evaluate(() => (window as any).basecraft.rows.page('Clients', { offset: 0, limit: 1 }))).rows[0].values;
    expect(row.slice(1)).toEqual([nom, 'Zed']);

    // Unhide Fields: Nom is back between the two
    await more('more-unhide');
    await page.getByTestId('unhide-Nom').check();
    await page.getByTestId('unhide-ok').click();
    await expect(cell(page, 1, 0)).toHaveText(nom);
    await expect(cell(page, 2, 0)).toHaveText('Zed');

    // hidden again, saved with the layout: still hidden on reopening
    await clickCell(1, 0);
    await more('more-hide');
    await close(page, 'Clients');
    await page.getByTestId('modal-btn-yes').click();
    await expect(page.getByTestId('doc-tab-close-Clients')).toHaveCount(0);
    await open(page, 'Clients');
    await expect(cell(page, 1, 0)).toHaveText('Zed');
    await expect(cell(page, 2, 0)).toHaveCount(0);
  } finally {
    await app.close();
  }
});

test('Home › Records › Totals: a totals row under the grid, a function picked per column', async () => {
  const { app, page } = await launchApp({ args: [seedSalesE2E('fx-totaux')], env: FR });
  try {
    await open(page, 'Clients');   // N°, Nom, Ville
    await expect(page.getByTestId('datasheet-totals')).toHaveCount(0);
    await page.getByTestId('cmd-recordsTotals').click();
    await expect(page.getByTestId('datasheet-totals')).toBeVisible();
    const rows = (await page.evaluate(() => (window as any).basecraft.rows.page('Clients', { offset: 0, limit: 1000 }))).rows as { values: number[] }[];
    await page.getByTestId('total-Nom').selectOption('count');
    await expect(page.getByTestId('total-value-Nom')).toHaveText(String(rows.length));
    await page.getByTestId('total-N°').selectOption('max');
    await expect(page.getByTestId('total-value-N°')).toHaveText(String(Math.max(...rows.map((r) => r.values[0]))));
    // each total sits under its column
    const b = (await sheet(page).getByTestId('data-grid-canvas').boundingBox())!;
    const cellBox = (await page.getByTestId('total-Nom').boundingBox())!;
    expect(Math.abs(cellBox.x - b.x - colLeft(1))).toBeLessThan(1);
    if (process.env.BC_SHOT) await page.screenshot({ path: process.env.BC_SHOT });
    await page.getByTestId('cmd-recordsTotals').click();
    await expect(page.getByTestId('datasheet-totals')).toHaveCount(0);
  } finally {
    await app.close();
  }
});

test('Home › Text Formatting on a datasheet: bold, font size and alignment for the view', async () => {
  const { app, page } = await launchApp({ args: [seedSalesE2E('fx-texte')], env: FR });
  try {
    await open(page, 'Clients');
    const bold = page.getByTestId('cmd-textBold');
    await expect(bold).toHaveAttribute('aria-pressed', 'false');
    await bold.click();
    await expect(bold).toHaveAttribute('aria-pressed', 'true');
    await page.getByTestId('cmd-textFontSize').click();
    await page.getByTestId('font-size-16').click();
    // a 16 pt font takes a taller row: the second row starts lower than the default 30 px
    const b = (await sheet(page).getByTestId('data-grid-canvas').boundingBox())!;
    await page.mouse.click(b.x + colLeft(1) + 20, b.y + HEADER + 35);
    await expect(cell(page, 1, 0)).toHaveAttribute('aria-selected', 'true');
    const center = page.getByTestId('cmd-textAlignCenter');
    await center.click();
    await expect(center).toHaveAttribute('aria-pressed', 'true');
    if (process.env.BC_SHOT) await page.screenshot({ path: process.env.BC_SHOT });
  } finally {
    await app.close();
  }
});

test('Home › Text Formatting on a datasheet: font, colours and the Datasheet Formatting dialog for the view', async () => {
  const { app, page } = await launchApp({ args: [seedSalesE2E('fx-couleurs')], env: FR });
  try {
    await open(page, 'Clients');
    await page.getByTestId('cmd-textFont').click();
    await page.getByTestId('font-Liberation-Serif').click();
    await page.getByTestId('cmd-textFontColor').click();
    await page.getByTestId('fontColor-choices-c8261a').click();
    await page.getByTestId('cmd-textBackColor').click();
    await page.getByTestId('backColor-choices-fff2a8').click();
    await page.getByTestId('cmd-datasheetFormatting').click();
    await page.getByTestId('format-vertical').uncheck();
    await page.getByTestId('format-underline').check();
    await page.getByTestId('format-grid-3e63dd').click();
    await page.getByTestId('format-ok').click();
    await expect(page.getByTestId('format-ok')).toHaveCount(0);
    // the dialog reopens on the view's choices
    await page.getByTestId('cmd-datasheetFormatting').click();
    await expect(page.getByTestId('format-vertical')).not.toBeChecked();
    await expect(page.getByTestId('format-back-fff2a8')).toHaveAttribute('aria-pressed', 'true');
    await page.getByTestId('format-cancel').click();
    await expect(page.getByTestId('cmd-textUnderline')).toHaveAttribute('aria-pressed', 'true');
    if (process.env.BC_SHOT) await page.screenshot({ path: process.env.BC_SHOT });
  } finally {
    await app.close();
  }
});

test('table datasheet: row height, frozen field, totals, bold and alignment are saved with the table; Unfreeze leaves the field first', async () => {
  test.setTimeout(120_000);
  const { app, page } = await launchApp({ args: [seedSalesE2E('fx-mise-en-forme')], env: FR });
  const clickCell = async (col: number, row: number, y = HEADER + row * ROW + ROW / 2) => {
    const b = (await sheet(page).getByTestId('data-grid-canvas').boundingBox())!;
    await page.mouse.click(b.x + colLeft(col) + 20, b.y + y);
    await expect(cell(page, col, row)).toHaveAttribute('aria-selected', 'true');
  };
  const more = async (item: string) => { await page.getByTestId('cmd-moreRecords').click(); await page.getByTestId(item).click(); };
  try {
    await open(page, 'Clients');   // N°, Nom, Ville
    const rows = (await page.evaluate(() => (window as any).basecraft.rows.page('Clients', { offset: 0, limit: 1000 }))).rows as { values: (number | string)[] }[];
    const ville = String(rows[0]!.values[2]);
    // row height 45 pt (60 px), bold, totals Sum on the number, Ville frozen and centred
    await more('more-row-height');
    await page.getByTestId('size-box-value').fill('45');
    await page.getByTestId('size-box-ok').click();
    await page.getByTestId('cmd-textBold').click();
    await page.getByTestId('cmd-recordsTotals').click();
    await page.getByTestId('total-N°').selectOption('sum');
    await clickCell(2, 0, HEADER + 30);
    await more('more-freeze');
    await expect(cell(page, 0, 0)).toHaveText(ville);
    await page.getByTestId('cmd-textAlignCenter').click();
    await close(page, 'Clients');
    await page.getByTestId('modal-btn-yes').click();
    await expect(page.getByTestId('doc-tab-close-Clients')).toHaveCount(0);

    // reopened: everything is back
    await open(page, 'Clients');
    await expect(cell(page, 0, 0)).toHaveText(ville);
    await expect(page.getByTestId('cmd-textBold')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByTestId('datasheet-totals')).toBeVisible();
    await expect(page.getByTestId('total-N°')).toHaveValue('sum');
    await expect(page.getByTestId('total-value-N°')).toHaveText(String(rows.reduce((a, r) => a + (r.values[0] as number), 0)));
    await clickCell(1, 1, HEADER + 60 + 30);   // the second row starts at 60 px, not 30
    await clickCell(0, 0, HEADER + 30);
    await expect(page.getByTestId('cmd-textAlignCenter')).toHaveAttribute('aria-pressed', 'true');
    if (process.env.BC_SHOT) await page.screenshot({ path: process.env.BC_SHOT });

    // Unfreeze All: Ville stays the first column, unfrozen
    await more('more-unfreeze');
    await expect(cell(page, 0, 0)).toHaveText(ville);
    await close(page, 'Clients');
    await page.getByTestId('modal-btn-yes').click();
    await open(page, 'Clients');
    await expect(cell(page, 0, 0)).toHaveText(ville);
    await page.getByTestId('cmd-moreRecords').click();
    await expect(page.getByTestId('more-unfreeze')).toBeDisabled();
  } finally {
    await app.close();
  }
});

test('Home › Text Formatting on a datasheet: an alignment button with nothing selected aligns every field', async () => {
  const { app, page } = await launchApp({ args: [seedSalesE2E('fx-alignement')], env: FR });
  try {
    await open(page, 'Clients');
    const right = page.getByTestId('cmd-textAlignRight');
    await right.click();
    const b = (await sheet(page).getByTestId('data-grid-canvas').boundingBox())!;
    for (const col of [0, 1, 2]) {
      await page.mouse.click(b.x + colLeft(col) + 20, b.y + HEADER + ROW / 2);
      await expect(cell(page, col, 0)).toHaveAttribute('aria-selected', 'true');
      await expect(right).toHaveAttribute('aria-pressed', 'true');
    }
    // the same button again, with a column selected: only that column goes back to its own alignment
    await right.click();
    await expect(right).toHaveAttribute('aria-pressed', 'false');
    await page.mouse.click(b.x + colLeft(1) + 20, b.y + HEADER + ROW / 2);
    await expect(right).toHaveAttribute('aria-pressed', 'true');
  } finally {
    await app.close();
  }
});

test('Home › Records › Totals: computed over every row, beyond the 100 000 the grid reads', async () => {
  test.setTimeout(120_000);
  const file = seedBase('fx-totaux-gros', (db) => {
    createTable(db, t('Gros', [f('Id', 'autoNumber'), f('Val', 'number')]));
    db.exec(`WITH RECURSIVE s(n) AS (SELECT 1 UNION ALL SELECT n + 1 FROM s WHERE n < 100050) INSERT INTO "Gros" ("Val") SELECT n % 10 FROM s`);
  });
  const { app, page } = await launchApp({ args: [file], env: FR });
  try {
    await open(page, 'Gros');
    await page.getByTestId('cmd-recordsTotals').click();
    await page.getByTestId('total-Val').selectOption('count');
    await expect(page.getByTestId('total-value-Val')).toHaveText(/^100\D050$/);
    await page.getByTestId('total-Val').selectOption('sum');
    await expect(page.getByTestId('total-value-Val')).toHaveText(/^450\D225$/);   // 10 005 cycles of 0..9
    await page.getByTestId('total-Val').selectOption('stdev');
    await expect(page.getByTestId('total-value-Val')).toHaveText(/^2,8723$/);   // the sample's, 4 decimals
  } finally {
    await app.close();
  }
});

test('More › Freeze Fields: the frozen field stays in view when the grid scrolls sideways', async () => {
  test.setTimeout(90_000);
  const names = Array.from({ length: 30 }, (_, i) => `F${i + 1}`);
  const base = seedBase('fx-gele-defile', (db) => {
    createTable(db, t('Large', names.map((n) => f(n, 'shortText'))));
    db.prepare(`INSERT INTO "Large" (${names.map((n) => `"${n}"`).join(', ')}) VALUES (${names.map(() => '?').join(', ')})`).run(...names.map((n) => `v${n}`));
  });
  const { app, page } = await launchApp({ args: [base], env: FR });
  try {
    await open(page, 'Large');
    const b = (await sheet(page).getByTestId('data-grid-canvas').boundingBox())!;
    await page.mouse.click(b.x + colLeft(1) + 20, b.y + HEADER + ROW / 2);   // F2
    await expect(cell(page, 1, 0)).toHaveAttribute('aria-selected', 'true');
    await page.getByTestId('cmd-moreRecords').click();
    await page.getByTestId('more-freeze').click();
    await expect(cell(page, 0, 0)).toHaveText('vF2');   // frozen, first
    await expect(cell(page, 1, 0)).toHaveText('vF1');
    await page.mouse.move(b.x + b.width / 2, b.y + HEADER + ROW * 2);
    await page.mouse.wheel(4000, 0);
    await expect(cell(page, 1, 0)).toHaveCount(0, { timeout: 10_000 });   // F1 scrolled out of view…
    await expect(cell(page, 0, 0)).toHaveText('vF2');                    // …the frozen field did not
    await expect(cell(page, 29, 0)).toHaveText('vF30');                  // the grid did scroll to the last field
  } finally {
    await app.close();
  }
});

test('More › Column Width › Best Fit: the column takes the width of its longest value', async () => {
  test.setTimeout(90_000);
  const base = seedBase('fx-ajuster', (db) => {
    createTable(db, t('Villes', [f('Id', 'autoNumber'), f('Nom', 'shortText')]));
    db.prepare('INSERT INTO "Villes" ("Nom") VALUES (?)').run('Saint-Remy-de-Provence-sur-Mer-et-ses-environs-lointains-de-la-region');
  });
  const { app, page } = await launchApp({ args: [base], env: FR });
  try {
    await open(page, 'Villes');
    const b = (await sheet(page).getByTestId('data-grid-canvas').boundingBox())!;
    const beyond = async () => {   // a click past the default width of the last column: on it only once it is wider
      await page.mouse.click(b.x + colLeft(2) + 60, b.y + HEADER + ROW / 2);
      await page.waitForTimeout(300);
      return (await cell(page, 1, 0).getAttribute('aria-selected')) === 'true';
    };
    await page.mouse.click(b.x + colLeft(1) + 20, b.y + HEADER + ROW / 2);   // Nom
    await expect(cell(page, 1, 0)).toHaveAttribute('aria-selected', 'true');
    await page.mouse.click(b.x + colLeft(0) + 20, b.y + HEADER + ROW / 2);
    expect(await beyond()).toBe(false);   // default width: nothing there
    await page.mouse.click(b.x + colLeft(1) + 20, b.y + HEADER + ROW / 2);
    await page.getByTestId('cmd-moreRecords').click();
    await page.getByTestId('more-column-width').click();
    await page.getByTestId('size-box-fit').click();
    await page.mouse.click(b.x + colLeft(0) + 20, b.y + HEADER + ROW / 2);
    expect(await beyond()).toBe(true);
  } finally {
    await app.close();
  }
});
