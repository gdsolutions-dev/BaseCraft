// Filtres de la feuille de données : filtre par sélection, filtre sur le champ (critère saisi en français), activer /
// désactiver, effacer, suppression dans une feuille filtrée, champ Liste de choix filtré sur sa valeur stockée.
import { test, expect, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createTable } from '../../src/main/db/schema';
import { insertRow } from '../../src/main/db/write-layer';
import { localeInfo } from '../../src/shared/locale-format';
import { f, t } from '../../src/shared/test-fixtures';
import { launchApp, seedBase } from './helpers';

const FR = { BASECRAFT_REGION: 'fr-FR' };
const fr = localeInfo('fr-FR');
const text = JSON.parse(readFileSync(join(__dirname, '../../src/shared/i18n/fr.json'), 'utf8'));
const clients = t('Clients', [f('N°', 'autoNumber'), f('Nom', 'shortText'), f('Ville', 'shortText'), f('Solde', 'currency')]);
const commandes = t('Commandes', [f('N°', 'autoNumber'), f('Client', 'number', {
  numberSize: 'longInteger', lookup: { kind: 'table', table: 'Clients', boundField: 'N°', displayFields: ['Nom'], limitToList: false },
})]);
// DatasheetView: row selector width, header and row heights; left edge of each column (AutoNumber 80, short text 170).
const MARKER = 44, HEADER = 34, ROW = 30, LEFT = [0, 80, 250, 420];

const cell = (page: Page, col: number, row: number) => page.getByTestId(`glide-cell-${col + 1}-${row}`);
const count = (page: Page) => page.getByTestId('nav-record-count');
async function clickCell(page: Page, col: number, row: number) {
  const b = (await page.getByTestId('datasheet').getByTestId('data-grid-canvas').boundingBox())!;
  await page.mouse.click(b.x + MARKER + LEFT[col]! + 30, b.y + HEADER + row * ROW + ROW / 2);
  await expect(cell(page, col, row)).toBeFocused(); // Glide focuses the cell after a render
}
async function open(page: Page, table: string) {
  await page.getByTestId(`nav-item-${table}`).dblclick();
  await expect(page.getByTestId('datasheet').getByTestId('data-grid-canvas')).toBeVisible();
}
const base = () => seedBase('filtres', async (db) => {
  createTable(db, clients);
  createTable(db, commandes);
  for (const [Nom, Ville, Solde] of [['Dupont', 'Lyon', 1500], ['Durand', 'Paris', 200], ['Martin', 'Lyon', 50], ['Arnaud', 'Marseille', 900]] as const) {
    await insertRow(db, clients, { Nom, Ville, Solde }, fr);
  }
  for (const Client of [1, 2, 1]) await insertRow(db, commandes, { Client }, fr);
});

test('filters: by selection, toggle, criteria typed in French, delete while filtered, clear', async () => {
  const { app, page } = await launchApp({ args: [await base()], env: FR });
  try {
    await open(page, 'Clients');
    await expect(page.getByTestId('nav-filtered')).toBeDisabled(); // no filter
    await expect(page.getByTestId('cmd-filterToggle')).toBeDisabled();

    // Selection « Lyon » -> Equals
    await clickCell(page, 2, 0);
    await page.getByTestId('cmd-filterSelection').click();
    await expect(page.getByTestId('filter-menu-equals')).toBeFocused();
    await expect(page.getByTestId('filter-menu-contains')).toBeVisible(); // text: Contains is offered
    await page.getByTestId('filter-menu-equals').click();
    await expect(page.getByTestId('filter-menu')).toHaveCount(0);
    await expect(page.getByTestId('nav-filtered')).toHaveAttribute('aria-pressed', 'true');
    await expect(count(page)).toHaveText('2');
    await expect(cell(page, 1, 0)).toHaveText('Dupont');
    await expect(cell(page, 1, 1)).toHaveText('Martin');
    // sorted while filtered: the filtered rows in that order
    await clickCell(page, 1, 0);
    await page.getByTestId('cmd-sortDesc').click();
    await expect(cell(page, 1, 0)).toHaveText('Martin');
    await expect(cell(page, 1, 1)).toHaveText('Dupont');
    await expect(count(page)).toHaveText('2');
    await page.getByTestId('cmd-sortClear').click();
    await expect(cell(page, 1, 0)).toHaveText('Dupont');

    // Toggle: every row, the criteria kept; the navigation bar's indicator turns it back on
    await page.getByTestId('cmd-filterToggle').click();
    await expect(page.getByTestId('nav-filtered')).toHaveAttribute('aria-pressed', 'false');
    await expect(count(page)).toHaveText('4');
    await page.getByTestId('nav-filtered').click();
    await expect(count(page)).toHaveText('2');

    // Filter on the field Solde: a criteria typed in French (decimal comma), combined with Ville
    await clickCell(page, 3, 0);
    await page.getByTestId('cmd-filter').click();
    await page.getByTestId('xb-text').fill('> 999,5 Et');
    await page.getByTestId('xb-ok').click();
    await expect(page.getByTestId('xb-error')).toBeVisible(); // incomplete: refused, the builder stays
    await page.getByTestId('xb-text').fill('= [Pays]');
    await page.getByTestId('xb-ok').click();
    await expect(page.getByTestId('xb-error')).toHaveText(text.expr.error.unknownField); // no such field
    // nested beyond what the parser accepts (and SQLite could run): refused as too complex, the text and the reason stay
    const tooDeep = `${'-'.repeat(950)}1`;
    await page.getByTestId('xb-text').fill(tooDeep);
    await page.getByTestId('xb-ok').click();
    await expect(page.getByTestId('xb-error')).toHaveText(text.expr.error.tooComplex);
    await expect(page.getByTestId('xb-text')).toHaveValue(tooDeep);
    await page.getByTestId('xb-text').fill('>999,5');
    await page.getByTestId('xb-ok').click();
    await expect(count(page)).toHaveText('1');
    await expect(cell(page, 1, 0)).toHaveText('Dupont');
    // the criteria comes back in its display form; emptied, it no longer filters
    await expect(cell(page, 3, 0)).toBeFocused(); // the filter brings the grid back to its first record, same column
    await page.getByTestId('cmd-filter').click();
    await expect(page.getByTestId('xb-text')).toHaveValue('> 999,5');
    await page.getByTestId('xb-text').fill('');
    await page.getByTestId('xb-ok').click();
    await expect(count(page)).toHaveText('2');

    // Deleting a filtered row deletes that record
    await clickCell(page, 1, 1);
    await page.getByTestId('cmd-deleteRecord').click();
    await page.getByTestId('modal-btn-yes').click();
    await expect(count(page)).toHaveText('1');
    await expect(cell(page, 1, 0)).toHaveText('Dupont');
    const rows = await page.evaluate(() => (window as any).basecraft.rows.page('Clients', { offset: 0, limit: 10 }));
    expect(rows.rows.map((r: { values: unknown[] }) => r.values[1])).toEqual(['Dupont', 'Durand', 'Arnaud']);

    // A row saved that no longer matches leaves the filtered rows, and the count follows
    await clickCell(page, 2, 0);
    await page.keyboard.press('P');
    await expect(page.getByTestId('grid-editor-portal').locator('textarea')).toBeFocused();
    await page.keyboard.type('aris');
    await page.keyboard.press('Tab');
    await expect(page.getByTestId('grid-editor-portal').locator('textarea')).toHaveCount(0);
    await page.getByTestId('cmd-save').click();
    await expect(count(page)).toHaveText('0');

    // Advanced > Clear All Filters
    await page.getByTestId('cmd-filterAdvanced').click();
    await page.getByTestId('filter-menu-clear').click();
    await expect(count(page)).toHaveText('3');
    await expect(page.getByTestId('nav-filtered')).toBeDisabled();
  } finally {
    await app.close();
  }
});

test('a row saved out of the filter: the next record is not skipped, the new record opens at the first click', async () => {
  const p = await seedBase('filtres-saisie', async (db) => {
    createTable(db, clients);
    for (const [Nom, Ville] of [['Dupont', 'Lyon'], ['Martin', 'Lyon'], ['Zola', 'Lyon'], ['Durand', 'Paris']] as const) await insertRow(db, clients, { Nom, Ville }, fr);
  });
  const { app, page } = await launchApp({ args: [p], env: FR });
  const editor = page.getByTestId('grid-editor-portal').locator('textarea');
  try {
    await open(page, 'Clients');
    await clickCell(page, 2, 0);
    await page.getByTestId('cmd-filterSelection').click();
    await page.getByTestId('filter-menu-equals').click();
    await expect(count(page)).toHaveText('3');

    // Dupont leaves the filter, Enter moves down: the current record is Martin (now first), not Zola
    await expect(cell(page, 2, 0)).toBeFocused(); // the filter brings the grid back to its first record
    await page.keyboard.press('P');
    await expect(editor).toBeFocused();
    await page.keyboard.type('aris');
    await page.keyboard.press('Enter');
    await expect(count(page)).toHaveText('2');
    await expect(cell(page, 1, 0)).toHaveText('Martin');
    await expect(cell(page, 2, 0)).toBeFocused();
    await expect(page.getByTestId('nav-record-input')).toHaveValue('1');

    // Martin leaves the filter, then a click on the new record's row: its editor opens at once
    await page.keyboard.press('P');
    await expect(editor).toBeFocused();
    await page.keyboard.type('aris');
    await page.keyboard.press('Tab');
    await expect(editor).toHaveCount(0);
    const b = (await page.getByTestId('datasheet').getByTestId('data-grid-canvas').boundingBox())!;
    await page.mouse.click(b.x + MARKER + LEFT[1]! + 30, b.y + HEADER + 2 * ROW + ROW / 2); // the trailing row, under Zola
    await expect(count(page)).toHaveText('1');
    await expect(editor).toBeFocused();
    await page.keyboard.type('Hugo');
    await page.keyboard.press('Escape');
    await page.keyboard.press('Escape');
    await expect(count(page)).toHaveText('1'); // the new record discarded
    await expect(cell(page, 1, 0)).toHaveText('Zola');
  } finally {
    await app.close();
  }
});

test('filter by selection on a Lookup field compares its stored value', async () => {
  const { app, page } = await launchApp({ args: [await base()], env: FR });
  try {
    await open(page, 'Commandes');
    await expect(cell(page, 1, 0)).toHaveText('Dupont');
    await clickCell(page, 1, 0);
    await page.getByTestId('cmd-filterSelection').click();
    await expect(page.getByTestId('filter-menu-equals')).toContainText('Dupont'); // the text shown…
    await expect(page.getByTestId('filter-menu-contains')).toHaveCount(0); // a Number
    await page.getByTestId('filter-menu-notEquals').click();
    await expect(count(page)).toHaveText('1'); // …the value compared: Client <> 1
    await expect(cell(page, 1, 0)).toHaveText('Durand');
  } finally {
    await app.close();
  }
});
