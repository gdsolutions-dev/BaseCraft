// Feuille de données : un enregistrement refusé affiche son erreur aussi dans une boîte de message (comme Access).
import { test, expect, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { saveRelation } from '../../src/main/db/relations';
import { createTable } from '../../src/main/db/schema';
import { insertRow } from '../../src/main/db/write-layer';
import { localeInfo } from '../../src/shared/locale-format';
import { clients, f, t } from '../../src/shared/test-fixtures';
import { launchApp, seedBase } from './helpers';

const fr = JSON.parse(readFileSync(join(__dirname, '../../src/shared/i18n/fr.json'), 'utf8'));
const FR = { BASECRAFT_REGION: 'fr-FR' };
const commandes = t('Commandes', [
  f('N°', 'autoNumber'),
  f('Client', 'number', { numberSize: 'longInteger', required: true }),
  f('Montant', 'currency', { validationRule: '>10', validationText: 'Sup à 10 !' }),
]);
// DatasheetView: row selector width, header and row heights, AutoNumber column width.
const MARKER = 44, HEADER = 34, ROW = 30, AUTONUMBER = 80;

const cell = (page: Page, col: number, row: number) => page.getByTestId(`glide-cell-${col + 1}-${row}`);
const cellEditor = (page: Page) => page.getByTestId('grid-editor-portal').locator('textarea');
const rowsOf = async (page: Page) =>
  (await page.evaluate(() => (window as any).basecraft.rows.page('Commandes', { offset: 0, limit: 100 }))).rows as { values: unknown[] }[];

/** Clicks the trailing row's Client cell: a new record starts and its editor opens. */
async function newRecordAt(page: Page, row: number) {
  const b = (await page.getByTestId('datasheet').getByTestId('data-grid-canvas').boundingBox())!;
  await page.mouse.click(b.x + MARKER + AUTONUMBER + 30, b.y + HEADER + row * ROW + ROW / 2);
  await expect(cellEditor(page)).toBeFocused();
}
async function typeIntoCell(page: Page, text: string) {
  await expect(page.getByTestId('datasheet').locator('td[role=gridcell]:focus')).toHaveCount(1); // Glide focuses the cell after a render
  await page.keyboard.press(text[0]);
  await expect(cellEditor(page)).toBeFocused();
  await page.keyboard.type(text.slice(1));
}
async function closeEditor(page: Page, key: 'Enter' | 'Tab') {
  await page.keyboard.press(key);
  await expect(cellEditor(page)).toHaveCount(0);
  await expect(page.getByTestId('datasheet')).not.toHaveAttribute('aria-busy', 'true');
}
/** The save attempt just made is refused: one box (title BaseCraft, the inline bar's text, OK only); `close` dismisses it,
 *  then the focus is back on the cell in error, the bar still shows the error and the row is still pending. */
async function refused(page: Page, text: string, [col, row]: [number, number], close: () => Promise<void>) {
  const box = page.getByRole('dialog', { name: 'BaseCraft' });
  await expect(box).toContainText(text);
  await expect(box.getByRole('button')).toHaveCount(1);
  await expect(page.getByTestId('modal-btn-ok')).toBeFocused();
  await page.waitForTimeout(300); // read as a person would: the grid's deferred focus (Glide) has run behind the box
  await close();
  await expect(page.getByTestId('modal')).toHaveCount(0); // one box per attempt, never a second one queued
  await expect(cell(page, col, row)).toBeFocused();
  await expect(page.getByTestId('datasheet-error')).toHaveText(text);
  await expect(page.getByTestId('doc-tab-Commandes')).toContainText('•');
}

test('a refused row shows its first error in a message box; OK goes back to the cell, the row stays pending', async () => {
  const base = await seedBase('boite', async (db) => {
    createTable(db, clients);
    await insertRow(db, clients, { Nom: 'Dupont' }, localeInfo('fr-FR')); // N° 1
    createTable(db, commandes);
    saveRelation(db, { name: '', parentTable: 'Clients', parentFields: ['N°'], childTable: 'Commandes', childFields: ['Client'],
      enforce: true, cascadeUpdate: false, cascadeDelete: false, joinType: 1 }, null, localeInfo('fr-FR'));
  });
  const { app, page } = await launchApp({ args: [base], env: FR });
  try {
    await page.getByTestId('nav-item-Commandes').dblclick();
    await expect(page.getByTestId('datasheet').getByTestId('data-grid-canvas')).toBeVisible();
    const ok = () => page.getByTestId('modal-btn-ok').click();

    // the validation rule's message: Enter leaves the row, then Ctrl+S, the ribbon's Save and Escape in the box
    await newRecordAt(page, 0);
    await page.keyboard.type('1');
    await closeEditor(page, 'Tab');
    await typeIntoCell(page, '5');
    await page.keyboard.press('Enter');
    await refused(page, '« Montant » : Sup à 10 !', [2, 0], ok);
    await expect(cell(page, 2, 0)).toHaveText('5'); // unchanged
    await expect(page.getByTestId('nav-record-count')).toHaveText('0');
    await page.keyboard.press('Control+s');
    await refused(page, '« Montant » : Sup à 10 !', [2, 0], () => page.keyboard.press('Escape'));
    await page.getByTestId('ribbon-tab-home').click();
    await page.getByTestId('cmd-save').click();
    await refused(page, '« Montant » : Sup à 10 !', [2, 0], ok);

    // File > Close base: the box over the backstage, then the discard question; No keeps the row and the backstage keeps
    // the focus (Escape closes it, it does not reach the grid and cancel the row)
    await page.getByTestId('ribbon-tab-file').click();
    await page.getByTestId('bs-close').click();
    await expect(page.getByRole('dialog', { name: 'BaseCraft' })).toContainText('« Montant » : Sup à 10 !');
    await ok();
    await page.getByTestId('modal-btn-no').click();
    await expect(page.getByTestId('modal')).toHaveCount(0);
    expect(await page.evaluate(() => !!document.activeElement?.closest('[data-testid="backstage"]'))).toBe(true);
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('backstage')).toBeHidden();
    await expect(page.getByTestId('doc-tab-Commandes')).toContainText('•');
    await expect(cell(page, 2, 0)).toHaveText('5');
    const grid = (await page.getByTestId('datasheet').getByTestId('data-grid-canvas').boundingBox())!;
    await page.mouse.click(grid.x + MARKER + AUTONUMBER + 30, grid.y + HEADER + ROW / 2); // back to the row, on Client
    await expect(cell(page, 1, 0)).toBeFocused();
    await page.keyboard.press('Tab');

    // fixed: saved, no box
    await typeIntoCell(page, '15');
    await closeEditor(page, 'Enter');
    await expect(page.getByTestId('nav-record-count')).toHaveText('1');
    await expect(page.getByTestId('modal')).toHaveCount(0);
    await expect(page.getByTestId('datasheet-error')).toHaveCount(0);
    expect((await rowsOf(page)).map((r) => r.values)).toEqual([[1, 1, 15]]);

    // a required field left empty, then a value with no parent record (relation with integrity)
    await newRecordAt(page, 1);
    await closeEditor(page, 'Tab');
    await typeIntoCell(page, '20');
    await page.keyboard.press('Enter');
    await refused(page, `« Client » : ${fr.fieldError.required}`, [1, 1], ok);
    // the navigation bar (button, then record number): the box keeps the focus once the bar's deferred focus has run
    const box = page.getByRole('dialog', { name: 'BaseCraft' });
    await page.getByRole('button', { name: fr.datasheet.nav.first }).click();
    await expect(box).toBeVisible();
    await page.waitForTimeout(300);
    await refused(page, `« Client » : ${fr.fieldError.required}`, [1, 1], () => page.keyboard.press('Escape'));
    await page.getByTestId('nav-record-input').fill('1');
    await page.getByTestId('nav-record-input').press('Enter');
    await expect(box).toBeVisible();
    await page.waitForTimeout(300);
    await refused(page, `« Client » : ${fr.fieldError.required}`, [1, 1], () => page.keyboard.press('Escape'));
    await typeIntoCell(page, '99');
    await page.keyboard.press('Enter');
    await refused(page, `« Client » : ${fr.fieldError.noParent.replace('{{table}}', 'Clients')}`, [1, 1], ok);
    await page.keyboard.press('Escape'); // the row is cancelled
    await expect(page.getByTestId('datasheet-error')).toHaveCount(0);
    await expect(page.getByTestId('doc-tab-Commandes')).not.toContainText('•');
    await expect(page.getByTestId('modal')).toHaveCount(0);
    expect((await rowsOf(page)).map((r) => r.values)).toEqual([[1, 1, 15]]);
  } finally {
    await app.close();
  }
});
