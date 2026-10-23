import { test, expect, type Page } from '@playwright/test';
import { createTable } from '../../src/main/db/schema';
import { insertRow } from '../../src/main/db/write-layer';
import { localeInfo } from '../../src/shared/locale-format';
import { f, t } from '../../src/shared/test-fixtures';
import { launchApp, seedBase } from './helpers';

const FR = { BASECRAFT_REGION: 'fr-FR' };
const clients = t('Clients', [f('N°', 'autoNumber'), f('Nom', 'shortText'), f('Ville', 'shortText')]);
// DatasheetView: row selector width, header and row heights, column widths (AutoNumber, Short Text).
const MARKER = 44, HEADER = 34, ROW = 30, AUTONUMBER = 80, TEXT = 170;
const design = (page: Page) => page.evaluate(() => (window as any).basecraft.tables.design('Clients'));
const names = async (page: Page): Promise<string[]> => (await design(page)).fields.map((x: { name: string }) => x.name);
/** The datasheet's column titles (Glide's accessible copy of the canvas): once they show a change, its reload is done and the
 *  column it selects again is selected, so a click that follows is not undone by it. */
const headers = (page: Page) => page.getByTestId('datasheet').locator('th[role=columnheader]');
/** Selects the cell of column `col` (0 = N°) in the first row. */
async function pick(page: Page, col: number) {
  const b = (await page.getByTestId('datasheet').getByTestId('data-grid-canvas').boundingBox())!;
  const x = col === 0 ? MARKER + 30 : MARKER + AUTONUMBER + (col - 1) * TEXT + 30;
  await page.mouse.click(b.x + x, b.y + HEADER + ROW / 2);
}

test('Table Fields: add, rename with caption, default value, field size, delete; Create › Table', async () => {
  test.setTimeout(90_000);
  const base = await seedBase('champs-table', async (db) => {
    createTable(db, clients);
    await insertRow(db, clients, { Nom: 'Dupont', Ville: 'Strasbourg' }, localeInfo('fr-FR'));
  });
  const { app, page } = await launchApp({ args: [base], env: FR });
  try {
    await page.getByTestId('nav-item-Clients').dblclick();
    await expect(page.getByTestId('datasheet')).toBeVisible();
    await page.getByTestId('ribbon-tab-tableFields').click();
    for (const id of ['addShortText', 'addNumber', 'addCurrency', 'addDateTime', 'addYesNo', 'moreFields', 'deleteField', 'nameCaption', 'defaultValue', 'fieldSize']) {
      await expect(page.getByTestId(`cmd-${id}`)).toBeVisible();
    }

    // Date & Time after the selected column (Nom)
    await pick(page, 1);
    await page.getByTestId('cmd-addDateTime').click();
    await expect.poll(() => names(page)).toEqual(['N°', 'Nom', 'Champ1', 'Ville']);
    expect((await design(page)).fields[2].props.type).toBe('dateTime');
    await expect(headers(page)).toHaveText(['N°', 'Nom', 'Champ1', 'Ville']);

    // rename with a caption
    await pick(page, 2);
    await page.getByTestId('cmd-nameCaption').click();
    await page.getByTestId('name-caption-name').fill('Naissance');
    await page.getByTestId('name-caption-caption').fill('Date de naissance');
    await page.getByTestId('name-caption-ok').click();
    await expect.poll(() => names(page)).toEqual(['N°', 'Nom', 'Naissance', 'Ville']);
    expect((await design(page)).fields[2].props.caption).toBe('Date de naissance');
    await expect(headers(page)).toHaveText(['N°', 'Nom', 'Date de naissance', 'Ville']);

    // More Fields: AutoNumber is not offered (the table has one), Double is
    await pick(page, 3);
    await page.getByTestId('cmd-moreFields').click();
    await expect(page.getByTestId('more-fields-menu')).toBeVisible();
    await expect(page.getByTestId('more-fields-autoNumber')).toHaveCount(0);
    await page.getByTestId('more-fields-double').click();
    await expect.poll(() => names(page)).toEqual(['N°', 'Nom', 'Naissance', 'Ville', 'Champ1']);
    expect((await design(page)).fields[4].props.numberSize).toBe('double');
    await expect(headers(page)).toHaveText(['N°', 'Nom', 'Date de naissance', 'Ville', 'Champ1']);

    // Default Value through the Expression Builder (Ville)
    await pick(page, 3);
    await page.getByTestId('cmd-defaultValue').click();
    await page.getByTestId('xb-text').fill('"Paris"');
    await page.getByTestId('xb-ok').click();
    await expect.poll(async () => (await design(page)).fields[3].props.defaultValue).toBe('"Paris"');

    // Field Size 5 on "Strasbourg": the data-loss question; No changes nothing
    await pick(page, 3);
    await page.getByTestId('cmd-fieldSize').click();
    await page.getByTestId('modal-input').fill('5');
    await page.getByTestId('modal-btn-ok').click();
    await expect(page.getByTestId('modal')).toContainText('Perte de données');
    await page.getByTestId('modal-btn-no').click();
    await expect(page.getByTestId('modal')).toHaveCount(0);
    expect((await design(page)).fields[3].props.size).toBe(255);

    // delete after confirmation
    await pick(page, 2);
    await page.getByTestId('cmd-deleteField').click();
    await expect(page.getByTestId('modal')).toContainText('« Naissance »');
    await page.getByTestId('modal-btn-yes').click();
    await expect.poll(() => names(page)).toEqual(['N°', 'Nom', 'Ville', 'Champ1']);

    // Create › Table
    await page.getByTestId('ribbon-tab-create').click();
    await page.getByTestId('cmd-createTable').click();
    await expect(page.getByTestId('doc-tab-Table1')).toBeVisible();
    await expect(page.getByTestId('status-view-datasheet')).toBeVisible();
    await expect(page.getByRole('region', { name: /Table1/ })).toBeVisible();
    const d = await page.evaluate(() => (window as any).basecraft.tables.design('Table1'));
    expect(d.fields.map((x: { name: string; props: { type: string } }) => [x.name, x.props.type])).toEqual([['N°', 'autoNumber']]);
  } finally {
    await app.close();
  }
});

// Articles: N° (80), Nom (170), then Number columns (110 each).
const articles = t('Articles', [f('N°', 'autoNumber'), f('Nom', 'shortText'), f('Prix', 'number', { numberSize: 'double' }), f('Qté', 'number')]);
const adesign = (page: Page) => page.evaluate(() => (window as any).basecraft.tables.design('Articles'));
const prop = async (page: Page, field: string) => (await adesign(page)).fields.find((x: { name: string }) => x.name === field).props;
async function pickArticle(page: Page, col: number, row = 0) {
  const b = (await page.getByTestId('datasheet').getByTestId('data-grid-canvas').boundingBox())!;
  const x = col === 0 ? MARKER + 30 : col === 1 ? MARKER + AUTONUMBER + 30 : MARKER + AUTONUMBER + TEXT + (col - 2) * 110 + 30;
  await page.mouse.click(b.x + x, b.y + HEADER + row * ROW + ROW / 2);
}

test('Table Fields: formatting, field and record validation; Home › Find, Go To, Select', async () => {
  test.setTimeout(120_000);
  const base = await seedBase('champs-mise-en-forme', async (db) => {
    createTable(db, articles);
    for (const [Nom, Prix, Qté] of [['Stylo', 12.5, 3], ['Cahier', 1234.5, 5], ['Stylo', 2, 7]] as const) await insertRow(db, articles, { Nom, Prix, Qté }, localeInfo('fr-FR'));
  });
  const { app, page } = await launchApp({ args: [base], env: FR });
  try {
    await page.getByTestId('nav-item-Articles').dblclick();
    await expect(page.getByTestId('datasheet')).toBeVisible();
    await page.getByTestId('ribbon-tab-tableFields').click();

    // Currency on a Number field (the canvas draws the formatted text: datasheet-cells tests cover it); the column stays selected for the next command
    await pickArticle(page, 2);
    await page.getByTestId('cmd-currencyFormat').click();
    await expect.poll(async () => (await prop(page, 'Prix')).format).toBe('currency');
    // Decimals: Auto becomes 2, then ±1 (no new pick: the edited column is selected again after the reload)
    await expect(page.getByTestId('cmd-increaseDecimals')).toBeEnabled();
    await page.getByTestId('cmd-increaseDecimals').click();
    await expect.poll(async () => (await prop(page, 'Prix')).decimalPlaces).toBe(2);
    await page.getByTestId('cmd-increaseDecimals').click();
    await expect.poll(async () => (await prop(page, 'Prix')).decimalPlaces).toBe(3);
    await page.getByTestId('cmd-decreaseDecimals').click();
    await expect.poll(async () => (await prop(page, 'Prix')).decimalPlaces).toBe(2);
    // Format popup: a named format of the type
    await page.getByTestId('cmd-format').click();
    await page.getByTestId('format-percent').click();
    await expect.poll(async () => (await prop(page, 'Prix')).format).toMatch(/percent/i);

    // Required: pressed state follows the selected column
    await pickArticle(page, 1);
    await expect(page.getByTestId('cmd-required')).toHaveAttribute('aria-pressed', 'false');
    await page.getByTestId('cmd-required').click();
    await expect.poll(async () => (await prop(page, 'Nom')).required).toBe(true);
    await expect(page.getByTestId('cmd-required')).toHaveAttribute('aria-pressed', 'true');
    await pickArticle(page, 3);
    await expect(page.getByTestId('cmd-required')).toHaveAttribute('aria-pressed', 'false');

    // Unique on a column with duplicates: the existing message, nothing changes
    await pickArticle(page, 1);
    await page.getByTestId('cmd-unique').click();
    await expect(page.getByTestId('modal')).toContainText('valeurs en double');
    await page.getByTestId('modal-btn-ok').click();
    expect((await prop(page, 'Nom')).indexed).toBe('no');
    // Unique on Qté, then Indexed on that unique field removes the index
    await pickArticle(page, 3);
    await page.getByTestId('cmd-unique').click();
    await expect.poll(async () => (await prop(page, 'Qté')).indexed).toBe('yesNoDuplicates');
    await expect(page.getByTestId('cmd-unique')).toHaveAttribute('aria-pressed', 'true');
    await page.getByTestId('cmd-indexed').click();
    await expect.poll(async () => (await prop(page, 'Qté')).indexed).toBe('no');

    // Validation popup: field rule and message, record rule and message
    await page.getByTestId('cmd-validation').click();
    await page.getByTestId('validation-fieldRule').click();
    await page.getByTestId('xb-text').fill('>=0');
    await page.getByTestId('xb-ok').click();
    await expect.poll(async () => (await prop(page, 'Qté')).validationRule).toBeTruthy();
    await page.getByTestId('cmd-validation').click();
    await page.getByTestId('validation-fieldText').click();
    await page.getByTestId('modal-input').fill('Quantité positive');
    await page.getByTestId('modal-btn-ok').click();
    await expect.poll(async () => (await prop(page, 'Qté')).validationText).toBe('Quantité positive');
    await page.getByTestId('cmd-validation').click();
    await page.getByTestId('validation-recordRule').click();
    await page.getByTestId('xb-text').fill('[Prix] > 0');
    await page.getByTestId('xb-ok').click();
    await expect.poll(async () => (await adesign(page)).validationRule).toBe('[Prix] > 0');
    await page.getByTestId('cmd-validation').click();
    await page.getByTestId('validation-recordText').click();
    await page.getByTestId('modal-input').fill('Prix positif');
    await page.getByTestId('modal-btn-ok').click();
    await expect.poll(async () => (await adesign(page)).validationText).toBe('Prix positif');
    const refused = await page.evaluate(() => (window as any).basecraft.rows.insert('Articles', { Nom: 'Gomme', Prix: -1, Qté: 1 }));
    expect(refused.ok).toBe(false);

    // Data Type popup: Qté becomes Short Text
    await pickArticle(page, 3);
    await page.getByTestId('cmd-dataType').click();
    await page.getByTestId('data-type-shortText').click();
    await expect.poll(async () => (await prop(page, 'Qté')).type).toBe('shortText');

    // Home › Find: Ctrl+F opens the search bar and finds a value
    await page.getByTestId('ribbon-tab-home').click();
    await pickArticle(page, 1);
    await page.keyboard.press('Control+f');
    await expect(page.getByTestId('search-input')).toBeVisible();
    await page.getByTestId('search-input').fill('Cahier');
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('search-result-area')).toContainText('1');
    await page.getByTestId('search-close-button').click();
    // Go To › Last, First; Select All
    await page.getByTestId('cmd-goTo').click();
    await page.getByTestId('goto-last').click();
    await expect(page.getByTestId('nav-record-input')).toHaveValue('3');
    await page.getByTestId('cmd-goTo').click();
    await page.getByTestId('goto-first').click();
    await expect(page.getByTestId('nav-record-input')).toHaveValue('1');
    await page.getByTestId('cmd-selectMenu').click();
    await page.getByTestId('select-all').click();
    await expect(page.getByTestId('datasheet').locator('tr[aria-selected="true"]')).toHaveCount(3);
  } finally {
    await app.close();
  }
});

test('Table Fields: the new field stays selected after the reload, so Delete removes it', async () => {
  test.setTimeout(60_000);
  const base = await seedBase('champs-selection', async (db) => { createTable(db, articles); });
  const { app, page } = await launchApp({ args: [base], env: FR });
  try {
    await page.getByTestId('nav-item-Articles').dblclick();
    await page.getByTestId('ribbon-tab-tableFields').click();
    await pickArticle(page, 3);
    await page.getByTestId('cmd-addYesNo').click();
    await expect.poll(async () => (await adesign(page)).fields.length).toBe(5);
    await expect(page.getByTestId('cmd-deleteField')).toBeEnabled();
    await page.getByTestId('cmd-deleteField').click();
    await page.getByTestId('modal-btn-yes').click();
    await expect.poll(async () => (await adesign(page)).fields.map((x: { name: string }) => x.name)).toEqual(['N°', 'Nom', 'Prix', 'Qté']);
  } finally {
    await app.close();
  }
});

test('Find: a value in a row beyond the pages already loaded is found', async () => {
  test.setTimeout(90_000);
  const journal = t('Journal', [f('N°', 'autoNumber'), f('Nom', 'shortText')]);
  const base = await seedBase('recherche-lointaine', async (db) => {
    createTable(db, journal);
    for (let i = 0; i < 650; i++) await insertRow(db, journal, { Nom: i === 640 ? 'Zeta-unique' : `Ligne ${i}` }, localeInfo('fr-FR'));
  });
  const { app, page } = await launchApp({ args: [base], env: FR });
  try {
    await page.getByTestId('nav-item-Journal').dblclick();
    await expect(page.getByTestId('nav-record-count')).toHaveText('650');
    const b = (await page.getByTestId('datasheet').getByTestId('data-grid-canvas').boundingBox())!;
    await page.mouse.click(b.x + MARKER + AUTONUMBER + 30, b.y + HEADER + ROW / 2);
    await page.keyboard.press('Control+f');
    await page.getByTestId('search-input').fill('Zeta-unique');
    await expect(page.getByTestId('search-result-area')).toContainText('1');
  } finally {
    await app.close();
  }
});
