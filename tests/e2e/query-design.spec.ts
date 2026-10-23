import { test, expect, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { BasecraftApi } from '../../src/shared/api';
import { saveObject } from '../../src/main/db/objects';
import { seedSales, seedSalesRelation } from '../../src/main/query/test-db';
import { launchApp, seedBase, seedSalesE2E } from './helpers';

const fr = JSON.parse(readFileSync(join(__dirname, '../../src/shared/i18n/fr.json'), 'utf8'));
const FR = { BASECRAFT_REGION: 'fr-FR' };
type Win = { basecraft: BasecraftApi };

/** The shown document (every tab stays mounted, hidden). */
const doc = (page: Page) => page.locator('section[role=tabpanel]:not([hidden])');
const cell = (page: Page, col: number, row: number) => doc(page).getByTestId(`glide-cell-${col + 1}-${row}`);
const selected = (page: Page, tab: string) => expect(page.getByTestId(`ribbon-tab-${tab}`)).toHaveAttribute('aria-selected', 'true');
const sqlOf = (page: Page, name: string) => page.evaluate((n) => (window as unknown as Win).basecraft.objects.get('query', n)
  .then((g) => (g.definition as { sql: string }).sql), name);
/** Types a grid cell (its display form) and leaves it, as Tab does. */
async function type(page: Page, id: string, text: string) {
  await doc(page).getByTestId(id).fill(text);
  await doc(page).getByTestId(id).press('Tab');
}
async function datasheet(page: Page, rows: string[][]) {
  await page.getByTestId('status-view-datasheet').click();
  await expect(doc(page).getByTestId('nav-record-count')).toHaveText(String(rows.length));
  for (const [r, row] of rows.entries()) for (const [c, v] of row.entries()) await expect(cell(page, c, r)).toHaveText(v === '' ? '' : new RegExp(v));
}

test('Query Design: Show Table, relation join, fields, sort, criteria, save, totals, outer join, Navigation Pane Design View', async () => {
  const { app, page } = await launchApp({ args: [seedSalesE2E('qbe')], env: FR });
  try {
    await page.getByTestId('ribbon-tab-create').click();
    await page.getByTestId('cmd-createQueryDesign').click();
    await expect(page.getByTestId('doc-tab-query-Requête1')).toBeVisible();
    await selected(page, 'queryDesign');
    // Show Table opens by itself on a new query (Access): tabs Tables / Queries / Both, multiple selection
    await expect(page.getByTestId('show-table')).toContainText(fr.query.showTable.title);
    await page.getByTestId('show-table-tab-tables').focus();
    await page.keyboard.press('ArrowRight'); // ARIA tabs: arrows move and select
    await expect(page.getByTestId('show-table-tab-queries')).toBeFocused();
    await expect(page.getByTestId('show-table-tab-queries')).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByRole('tabpanel', { name: fr.query.showTable.queries })).toContainText('QVentes');
    await expect(page.getByTestId('show-table-QVentes')).toBeVisible();
    await page.keyboard.press('ArrowLeft');
    await expect(page.getByTestId('show-table-tab-tables')).toHaveAttribute('aria-selected', 'true');
    await page.getByTestId('show-table-Clients').check();
    await page.getByTestId('show-table-Commandes').check();
    await page.getByTestId('show-table-add').click();
    await page.getByTestId('show-table-close').click();
    await expect(page.getByTestId('show-table')).toHaveCount(0);
    await expect(doc(page).getByTestId('qbe-box-Clients')).toBeVisible();
    await expect(doc(page).getByTestId('qbe-box-Commandes')).toBeVisible();
    await expect(doc(page).getByTestId('qbe-join-0')).toHaveAttribute('data-kind', 'inner'); // the relation's join

    await doc(page).getByTestId('qbe-field-Clients-Nom').dblclick();
    await doc(page).getByTestId('qbe-field-Commandes-Montant').dblclick();
    await expect(doc(page).getByTestId('qbe-cell-field-0')).toHaveValue('Nom');
    await expect(doc(page).getByTestId('qbe-cell-table-1')).toHaveValue('Commandes');
    await doc(page).getByTestId('qbe-cell-sort-1').selectOption('desc');
    await type(page, 'qbe-cell-criteria0-1', '>0,5');
    await expect(doc(page).getByTestId('qbe-cell-criteria0-1')).toHaveValue('> 0,5');

    await page.keyboard.press('Control+s');
    await expect(page.getByTestId('modal-input')).toHaveValue('Requête1');
    await page.getByTestId('modal-input').fill('Grosses commandes');
    await page.getByTestId('modal-btn-ok').click();
    await expect(page.getByTestId('nav-item-query-Grosses commandes')).toBeVisible();
    await expect(page.getByTestId('doc-tab-query-Grosses commandes')).not.toContainText('•');
    await expect(doc(page).getByTestId('qbe-field-Clients-Nom')).toBeVisible(); // the fields are read again after the save
    expect(await sqlOf(page, 'Grosses commandes')).toBe('SELECT [Clients].[Nom], [Commandes].[Montant]\nFROM [Clients] INNER JOIN [Commandes] ON [Clients].[N°] = [Commandes].[Client]\nWHERE [Commandes].[Montant] > 0.5\nORDER BY [Commandes].[Montant] DESC;');
    await datasheet(page, [['Durand', '^99,99'], ['Dupont', '^10,1']]);

    // Totals: Montant = Somme, Nom = Regroupement, the criterion removed, the sort kept
    await page.getByTestId('status-view-design').click();
    await selected(page, 'queryDesign');
    await page.getByTestId('cmd-queryTotals').click();
    await expect(doc(page).getByTestId('qbe-cell-total-0')).toHaveValue('groupBy');
    await doc(page).getByTestId('qbe-cell-total-1').selectOption('sum');
    await type(page, 'qbe-cell-criteria0-1', '');
    await page.keyboard.press('Control+s');
    await expect(page.getByTestId('doc-tab-query-Grosses commandes')).not.toContainText('•');
    await datasheet(page, [['Durand', '^99,99'], ['Dupont', '^10,2'], ['Martin', '^0,3']]);

    // Join Properties: every Clients row
    await page.getByTestId('status-view-design').click();
    await doc(page).getByTestId('qbe-join-0').dblclick();
    await expect(page.getByTestId('join-dialog')).toContainText('Clients');
    await expect(page.getByRole('group', { name: fr.query.joinDialog.kind })).toBeVisible(); // the choices' fieldset has its legend
    await page.getByTestId('join-kind-left').check();
    await page.getByTestId('join-ok').click();
    await expect(doc(page).getByTestId('qbe-join-0')).toHaveAttribute('data-kind', 'left');
    // a change of mode asks for the save first (as for a table)
    await page.getByTestId('status-view-datasheet').click();
    await expect(page.getByTestId('modal')).toContainText(fr.query.mustSaveFirst.replace('{{name}}', 'Grosses commandes'));
    await page.getByTestId('modal-btn-yes').click();
    await expect(doc(page).getByTestId('nav-record-count')).toHaveText('4');
    await expect(cell(page, 0, 3)).toHaveText('Éric');
    await expect(cell(page, 1, 3)).toHaveText('');

    // Navigation Pane: Open then Design View first; Design View opens the grid
    await page.getByTestId('doc-tab-close-query-Grosses commandes').click();
    await page.getByTestId('nav-item-query-Grosses commandes').click({ button: 'right' });
    const items = page.getByTestId('nav-menu').getByRole('menuitem');
    await expect(items.nth(0)).toHaveAttribute('data-testid', 'nav-menu-open');
    await expect(items.nth(1)).toHaveAttribute('data-testid', 'nav-menu-design');
    await page.getByTestId('nav-menu-design').click();
    await expect(page.getByTestId('doc-tab-query-Grosses commandes')).toBeVisible();
    await expect(doc(page).getByTestId('qbe-box-Clients')).toBeVisible();
    await expect(doc(page).getByTestId('qbe-cell-total-1')).toHaveValue('sum');
    await selected(page, 'queryDesign');
  } finally {
    await app.close();
  }
});

test('Query Design commands: Add Tables, Query Type, Insert/Delete Columns, Builder, Run; checks before saving', async () => {
  const { app, page } = await launchApp({ args: [seedSalesE2E('qbe-cmds')], env: FR });
  try {
    await page.getByTestId('nav-item-query-QClientsLyon').click({ button: 'right' });
    await page.getByTestId('nav-menu-design').click();
    await expect(doc(page).getByTestId('qbe-box-Clients')).toBeVisible();
    await expect(doc(page).getByTestId('qbe-cell-field-0')).toHaveValue('*');
    await expect(doc(page).getByTestId('qbe-cell-criteria0-1')).toHaveValue('"Lyon"');
    // the groups and commands of the tab, in Access order
    const order = await page.locator('[data-testid^="ribbon-group-"]').evaluateAll((gs) => gs.map((g) => g.getAttribute('data-testid')));
    expect(order).toEqual(['results', 'queryType', 'querySetup', 'showHide'].map((g) => `ribbon-group-${g}`));

    // Add Tables: Show Table, then the second Clients box gets an alias
    await page.getByTestId('cmd-addTables').click();
    await page.getByTestId('show-table-Clients').check();
    await page.getByTestId('show-table-add').click();
    await page.getByTestId('show-table-close').click();
    await expect(doc(page).getByTestId('qbe-box-Clients_1')).toBeVisible();
    await doc(page).getByTestId('qbe-remove-Clients_1').click();
    await expect(doc(page).getByTestId('qbe-box-Clients_1')).toHaveCount(0);

    // Insert Columns before the selected column, Delete Columns removes it
    await doc(page).getByTestId('qbe-colsel-0').click();
    await page.getByTestId('cmd-insertColumns').click();
    await expect(doc(page).getByTestId('qbe-cell-field-0')).toHaveValue('');
    await expect(doc(page).getByTestId('qbe-cell-field-1')).toHaveValue('*');
    await page.getByTestId('cmd-deleteColumns').click();
    await expect(doc(page).getByTestId('qbe-cell-field-0')).toHaveValue('*');

    // Builder: the Expression Builder on the cell last focused
    await doc(page).getByTestId('qbe-cell-criteria1-1').focus();
    await page.getByTestId('cmd-builder').click();
    await page.getByTestId('xb-text').fill('"Paris"');
    await page.getByTestId('xb-ok').click();
    await expect(doc(page).getByTestId('qbe-cell-criteria1-1')).toHaveValue('"Paris"');

    // Query Type: Update shows Update To and hides Sort and Show; Make-Table asks for its table; back to Select
    await page.getByTestId('cmd-updateQuery').click();
    await expect(page.getByTestId('cmd-returnValues')).toBeDisabled(); // Top Values: Select, Make-Table and Append only
    await expect(doc(page).getByTestId('qbe-cell-updateTo-1')).toBeVisible();
    await expect(doc(page).getByTestId('qbe-cell-sort-1')).toHaveCount(0);
    await page.getByTestId('cmd-makeTableQuery').click();
    await page.getByTestId('modal-input').fill('Copie');
    await page.getByTestId('modal-btn-ok').click();
    await expect(doc(page).getByTestId('qbe-cell-show-1')).toBeVisible();
    await page.getByTestId('cmd-selectQuery').click();
    await expect(page.getByTestId('cmd-returnValues')).toBeEnabled();
    await expect(page.getByTestId('cmd-runQuery')).toBeEnabled();

    // a parameter shown as a column stays a parameter (the catalog knows it is no field of Clients)
    await type(page, 'qbe-cell-field-2', '[Combien ?]');
    await expect(doc(page).getByTestId('qbe-cell-table-2')).toHaveValue('');
    // a cell that does not read blocks the save, with its message
    await type(page, 'qbe-cell-criteria0-2', '> > 1');
    await expect(doc(page).getByTestId('qbe-cell-criteria0-2-error')).toBeVisible();
    await page.keyboard.press('Control+s');
    await expect(page.getByTestId('modal')).toContainText(fr.query.invalidCells.split(';')[0]);
    await page.getByTestId('modal-btn-ok').click();
    await type(page, 'qbe-cell-criteria0-2', '');
    // no shown field: refused with Access's message
    for (const col of [0, 1, 2]) await doc(page).getByTestId(`qbe-cell-show-${col}`).uncheck();
    await page.keyboard.press('Control+s');
    await expect(page.getByTestId('modal')).toContainText(fr.dialog.error.invalidQuery_noField);
    await page.getByTestId('modal-btn-ok').click();
    for (const col of [0, 2]) await doc(page).getByTestId(`qbe-cell-show-${col}`).check();
    await page.keyboard.press('Control+s');
    await expect(page.getByTestId('doc-tab-query-QClientsLyon')).not.toContainText('•');
    expect(await sqlOf(page, 'QClientsLyon')).toBe('SELECT *, [Combien ?]\nFROM [Clients]\nWHERE [Clients].[Ville] = "Lyon" Or [Clients].[Ville] = "Paris";');
    // after the save the boxes keep their fields, and a second save keeps the parameter bare
    await expect(doc(page).getByTestId('qbe-field-Clients-Nom')).toBeVisible();
    await doc(page).getByTestId('qbe-cell-sort-1').selectOption('asc');
    await page.keyboard.press('Control+s');
    await expect(page.getByTestId('doc-tab-query-QClientsLyon')).not.toContainText('•');
    expect(await sqlOf(page, 'QClientsLyon')).toBe('SELECT *, [Combien ?]\nFROM [Clients]\nWHERE [Clients].[Ville] = "Lyon" Or [Clients].[Ville] = "Paris"\nORDER BY [Clients].[Ville];');

    // Run: the datasheet, after the parameter prompt
    await page.getByTestId('cmd-runQuery').click();
    await expect(page.getByTestId('modal')).toContainText('Combien ?');
    await page.getByTestId('modal-input').fill('7');
    await page.getByTestId('modal-btn-ok').click();
    await expect(doc(page).getByTestId('nav-record-count')).toHaveText('3'); // Lyon, LYON (no case), Paris
  } finally {
    await app.close();
  }
});

test('the Lookup tab\'s « … » opens the Query Builder over the Row Source and writes back its SQL', async () => {
  const { app, page } = await launchApp({ args: [seedSalesE2E('qbe-lookup')], env: FR });
  try {
    await page.getByTestId('nav-item-Commandes').click({ button: 'right' });
    await page.getByTestId('nav-menu-design').click();
    await page.getByTestId('design-row-1-name').click();
    await page.getByTestId('prop-tab-lookup').click();
    await page.getByTestId('prop-displayControl').selectOption('comboBox');
    await page.getByTestId('prop-rowSourceType').selectOption('table');
    await page.getByTestId('prop-rowSource').fill('Clients');
    await page.getByTestId('prop-rowSource').press('Tab');
    await expect(page.getByTestId('prop-rowSource-build')).toBeEnabled();
    await expect(page.getByTestId('prop-rowSource-build')).toHaveAttribute('title', fr.fieldProp.queryBuilder);
    await page.getByTestId('prop-rowSource-build').click();
    const builder = page.getByTestId('rowsource-builder');
    await expect(builder.getByTestId('qbe-box-Clients')).toBeVisible();
    await builder.getByTestId('qbe-field-Clients-N°').dblclick();
    await builder.getByTestId('qbe-field-Clients-Nom').dblclick();
    await builder.getByTestId('qbe-cell-sort-1').selectOption('asc');
    await page.getByTestId('rowsource-builder-ok').click();
    await expect(builder).toHaveCount(0);
    const sql = 'SELECT [Clients].[N°], [Clients].[Nom] FROM [Clients] ORDER BY [Clients].[Nom];';
    await expect(page.getByTestId('prop-rowSource')).toHaveValue(sql);
    await expect(page.getByTestId('prop-rowSource-note')).toHaveCount(0);
    // reopened on that SQL: the same grid; Cancel keeps the property
    await page.getByTestId('prop-rowSource-build').click();
    await expect(builder.getByTestId('qbe-cell-field-1')).toHaveValue('Nom');
    await page.getByTestId('rowsource-builder-cancel').click();
    await expect(page.getByTestId('prop-rowSource')).toHaveValue(sql);
  } finally {
    await app.close();
  }
});

test('drag a field onto another box (a join) or onto the grid (a column), move a column; a read-only base opens the grid read-only', async () => {
  const base = seedSalesE2E('qbe-drag');
  const a = await launchApp({ args: [base], env: FR });
  try {
    const page = a.page;
    await page.getByTestId('nav-item-query-QVentes').click({ button: 'right' });
    await page.getByTestId('nav-menu-design').click();
    await expect(doc(page).getByTestId('qbe-join-0')).toBeVisible();
    await doc(page).getByTestId('qbe-field-Clients-Ville').dragTo(doc(page).getByTestId('qbe-field-Commandes-Le'));
    await expect(doc(page).getByTestId('qbe-join-1')).toBeVisible(); // a second pair of the same join
    await doc(page).getByTestId('qbe-join-1').focus();
    await page.keyboard.press('Delete');
    await expect(doc(page).getByTestId('qbe-join-1')).toHaveCount(0);
    await doc(page).getByTestId('qbe-field-Clients-Ville').dragTo(doc(page).getByTestId('qbe-cell-field-0'));
    await expect(doc(page).getByTestId('qbe-cell-field-0')).toHaveValue('Ville');
    await expect(doc(page).getByTestId('qbe-cell-field-1')).toHaveValue('Nom');
    await doc(page).getByTestId('qbe-colsel-0').dragTo(doc(page).getByTestId('qbe-colsel-3'));
    await expect(doc(page).getByTestId('qbe-cell-field-3')).toHaveValue('Ville');
    await expect(doc(page).getByTestId('qbe-cell-field-0')).toHaveValue('Nom');
    // closing a modified query offers to drop the edits
    await page.getByTestId('doc-tab-close-query-QVentes').click();
    await expect(page.getByTestId('modal')).toContainText(fr.query.saveFirst.replace('{{name}}', 'QVentes'));
    await page.getByTestId('modal-btn-no').click();
    await expect(page.getByTestId('doc-tab-query-QVentes')).toHaveCount(0);

    const b = await launchApp({ args: [base], env: FR });
    try {
      const p = b.page;
      await expect(p.getByTestId('banner-readonly')).toBeVisible();
      await p.getByTestId('nav-item-query-QVentes').click({ button: 'right' });
      await p.getByTestId('nav-menu-design').click();
      await expect(doc(p).getByTestId('qbe-box-Clients')).toBeVisible();
      await expect(doc(p).getByTestId('qbe-cell-field-0')).toBeDisabled();
      await expect(doc(p).getByTestId('qbe-remove-Clients')).toHaveCount(0);
      await expect(p.getByTestId('cmd-queryTotals')).toBeDisabled();
      await expect(p.getByTestId('cmd-runQuery')).toBeEnabled();
    } finally {
      await b.app.close();
    }
  } finally {
    await a.app.close();
  }
});

test('a stored SQL that no longer parses opens in SQL view with its error, never a blank view', async () => {
  const base = seedBase('qbe-broken', (db) => {
    seedSales(db);
    saveObject(db, 'query', 'Cassée', { formatVersion: '1.0', sql: 'SELECT FROM WHERE' }, null); // written by hand, past the save check
  });
  const { app, page } = await launchApp({ args: [base], env: FR });
  try {
    await page.getByTestId('nav-item-query-Cassée').click({ button: 'right' });
    await page.getByTestId('nav-menu-design').click();
    await expect(doc(page).getByTestId('query-sql')).toHaveValue('SELECT FROM WHERE');
    await expect(doc(page).getByTestId('query-sql-error')).toHaveText(fr.query.error.unexpectedToken);
  } finally {
    await app.close();
  }
});

test('keyboard: arrows move between grid cells, Tab goes cell to cell, Ctrl+F2 opens the builder, Ctrl+Shift+arrows move the column', async () => {
  const { app, page } = await launchApp({ args: [seedSalesE2E('qbe-keys')], env: FR });
  try {
    await page.getByTestId('nav-item-query-QClientsLyon').click({ button: 'right' });
    await page.getByTestId('nav-menu-design').click();
    const c = (id: string) => doc(page).getByTestId(id);
    // the view's load may take the focus back: focus again until the cell keeps it
    await expect(async () => {
      await c('qbe-cell-field-0').focus();
      await expect(c('qbe-cell-field-0')).toBeFocused({ timeout: 500 });
    }).toPass();
    await page.keyboard.press('Tab'); // the « … » button is no tab stop
    await expect(c('qbe-cell-field-1')).toBeFocused();
    await page.keyboard.press('ArrowDown');
    await expect(c('qbe-cell-table-1')).toBeFocused();
    await expect(c('qbe-cell-table-1')).toHaveValue('Clients'); // Down moves, it never changes the list's value
    await page.keyboard.press('ArrowLeft');
    await expect(c('qbe-cell-table-0')).toBeFocused();
    for (let i = 0; i < 3; i++) await page.keyboard.press('ArrowDown');
    await expect(c('qbe-cell-criteria0-0')).toBeFocused(); // a `*` column: Sort and Show are there, its criteria too
    await page.keyboard.press('ArrowRight');
    await expect(c('qbe-cell-criteria0-1')).toBeFocused();
    await page.keyboard.press('Control+F2');
    await expect(page.getByTestId('xb-text')).toHaveValue('"Lyon"');
    await page.getByTestId('xb-cancel').click();
    await c('qbe-cell-field-1').focus();
    await page.keyboard.press('Control+Shift+ArrowLeft');
    await expect(c('qbe-cell-field-0')).toHaveValue('Ville');
    await expect(c('qbe-cell-field-0')).toBeFocused();
    await expect(c('qbe-colsel-0')).toHaveAttribute('aria-pressed', 'true');
    // a bare field name typed in Field: Access's Table row, shown without brackets (stored canonical)
    await type(page, 'qbe-cell-field-2', 'Nom');
    await expect(c('qbe-cell-table-2')).toHaveValue('Clients');
    await expect(c('qbe-cell-field-2')).toHaveValue('Nom');
  } finally {
    await app.close();
  }
});

// ---------- Task 9: SQL view, Query Parameters, and the Query Design commands no other task owned ----------

const GROSSES = 'SELECT [Clients].[Nom], [Commandes].[Montant]\nFROM [Clients] INNER JOIN [Commandes] ON [Clients].[N°] = [Commandes].[Client]\nWHERE [Commandes].[Montant] > 0.5\nORDER BY [Commandes].[Montant] DESC;';
const seedGrosses = (name: string) => seedBase(name, (db) => {
  seedSales(db);
  seedSalesRelation(db);
  saveObject(db, 'query', 'Grosses commandes', { formatVersion: '1.0', sql: GROSSES }, null);
});
const sqlBox = (page: Page) => doc(page).getByTestId('query-sql');

test('SQL view: grid to SQL and back, a SQL-only UNION, a refused name, Query Parameters, Navigation Pane SQL View', async () => {
  const { app, page } = await launchApp({ args: [seedGrosses('qsql')], env: FR });
  try {
    await page.getByTestId('nav-item-query-Grosses commandes').click({ button: 'right' });
    await page.getByTestId('nav-menu-design').click();
    await expect(doc(page).getByTestId('qbe-cell-field-0')).toHaveValue('Nom');
    // grid -> SQL: the canonical text, never translated (0.5, not 0,5)
    await page.getByTestId('cmd-viewSql').click();
    await expect(sqlBox(page)).toHaveValue(GROSSES);
    await expect(sqlBox(page)).toHaveValue(/WHERE \[Commandes\]\.\[Montant\] > 0\.5/);
    await expect(page.getByTestId('cmd-viewSql')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByTestId('status-view-sql')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByTestId('status-view-design')).toHaveAttribute('aria-pressed', 'false');
    await expect(page.getByTestId('status-mode')).toHaveText(fr.status.mode.sql);
    // Access's order, also the tab order: Datasheet, SQL, Design
    expect(await page.locator('[data-testid^="status-view-"]').evaluateAll((els) => els.map((e) => e.getAttribute('data-testid'))))
      .toEqual(['status-view-datasheet', 'status-view-sql', 'status-view-design']);
    await expect(page.getByTestId('cmd-insertColumns')).toBeDisabled(); // the grid's commands wait for the grid

    // SQL -> grid: a criterion on a field no column shows becomes a hidden column; then the datasheet asks the parameter
    await sqlBox(page).fill(GROSSES.replace('\nORDER BY', ' AND [Commandes].[Le] >= [Date début :]\nORDER BY'));
    await expect(page.getByTestId('doc-tab-query-Grosses commandes')).toContainText('•');
    await page.getByTestId('status-view-design').click();
    await expect(doc(page).getByTestId('qbe-cell-field-2')).toHaveValue('Le');
    await expect(doc(page).getByTestId('qbe-cell-show-2')).not.toBeChecked();
    await expect(doc(page).getByTestId('qbe-cell-criteria0-2')).toHaveValue('>= [Date début :]');
    await expect(page.getByTestId('doc-tab-query-Grosses commandes')).toContainText('•'); // still to be saved
    await page.getByTestId('status-view-datasheet').click();
    await page.getByTestId('modal-btn-yes').click(); // save first
    await expect(page.getByTestId('modal')).toContainText('Date début :');
    expect(await sqlOf(page, 'Grosses commandes')).toContain('WHERE [Commandes].[Montant] > 0.5 And [Commandes].[Le] >= [Date début :]');
    await page.getByTestId('modal-input').fill('01/01/2000');
    await page.getByTestId('modal-btn-ok').click();
    await expect(doc(page).getByTestId('nav-record-count')).toBeVisible();

    // Navigation Pane: Open, Design View, SQL View first; SQL View opens the tab on the grid's SQL (the saved text)
    await page.getByTestId('doc-tab-close-query-Grosses commandes').click();
    await page.getByTestId('nav-item-query-Grosses commandes').click({ button: 'right' });
    const items = page.getByTestId('nav-menu').getByRole('menuitem');
    for (const [i, id] of ['open', 'design', 'sqlView'].entries()) await expect(items.nth(i)).toHaveAttribute('data-testid', `nav-menu-${id}`);
    await expect(page.getByTestId('nav-menu-sqlView')).toContainText(fr.nav.menu.sqlView.replace('&', ''));
    await page.getByTestId('nav-menu-sqlView').click();
    await expect(page.getByTestId('doc-tab-query-Grosses commandes')).toBeVisible();
    const withLe = 'SELECT [Clients].[Nom], [Commandes].[Montant]\nFROM [Clients] INNER JOIN [Commandes] ON [Clients].[N°] = [Commandes].[Client]\n'
      + 'WHERE [Commandes].[Montant] > 0.5 And [Commandes].[Le] >= [Date début :]\nORDER BY [Commandes].[Montant] DESC;';
    await expect(sqlBox(page)).toHaveValue(withLe);
    expect(await sqlOf(page, 'Grosses commandes')).toBe(withLe);
    await expect(page.getByTestId('doc-tab-query-Grosses commandes')).not.toContainText('•');

    // a UNION: only SQL view shows it (Design View off, as in Access); it saves and runs
    await sqlBox(page).fill('SELECT Nom FROM Clients UNION SELECT Nom FROM Clients');
    await expect(doc(page).getByTestId('query-sql-notice')).toHaveText(fr.query.sqlOnly);
    await expect(page.getByTestId('status-view-design')).toBeDisabled();
    await expect(page.getByTestId('doc-tab-query-Grosses commandes')).toContainText('•');
    await page.keyboard.press('Control+s');
    await expect(page.getByTestId('doc-tab-query-Grosses commandes')).not.toContainText('•');
    const union = 'SELECT [Nom]\nFROM [Clients]\nUNION\nSELECT [Nom]\nFROM [Clients];';
    expect(await sqlOf(page, 'Grosses commandes')).toBe(union);
    await expect(sqlBox(page)).toHaveValue(union); // the normalised text
    await page.getByTestId('status-view-datasheet').click();
    await expect(doc(page).getByTestId('nav-record-count')).toBeVisible();
    await page.getByTestId('status-view-design').click(); // a SQL-only query opens in SQL view
    await expect(sqlBox(page)).toHaveValue(union);

    // a reserved name: its error under the editor, its range selected, nothing saved
    await sqlBox(page).fill('SELECT * FROM bc_meta');
    await page.keyboard.press('Control+s');
    await expect(doc(page).getByTestId('query-sql-error')).toHaveText(fr.expr.error.reservedName); // query.error.reservedName falls back on it
    expect(await sqlBox(page).evaluate((el: HTMLTextAreaElement) => el.value.slice(el.selectionStart, el.selectionEnd))).toBe('bc_meta');
    expect(await sqlOf(page, 'Grosses commandes')).toBe(union);
    await page.getByTestId('status-view-design').click(); // a text that does not read stays in SQL view
    await expect(doc(page).getByTestId('query-sql-error')).toBeVisible();

    // Query Parameters in SQL view: the PARAMETERS clause; an empty or duplicate name is refused in the dialog
    await sqlBox(page).fill('SELECT * FROM Clients');
    await page.getByTestId('cmd-parameters').click();
    await page.getByTestId('query-params-name-0').fill('Mini');
    await page.getByTestId('query-params-type-0').selectOption('currency');
    await page.getByTestId('query-params-name-1').fill('mini');
    await page.getByTestId('query-params-ok').click();
    await expect(page.getByTestId('query-params-error')).toHaveText(fr.query.params.duplicate.replace('{{name}}', 'mini'));
    await page.getByTestId('query-params-name-1').fill('');
    await page.getByTestId('query-params-type-1').selectOption('number:double');
    await page.getByTestId('query-params-ok').click();
    await expect(page.getByTestId('query-params-error')).toHaveText(fr.query.params.emptyName);
    await page.getByTestId('query-params-type-1').selectOption('shortText');
    await page.getByTestId('query-params-ok').click();
    await expect(sqlBox(page)).toHaveValue(/^PARAMETERS \[Mini\] Currency;\nSELECT \*\nFROM \[Clients\];$/);
    // the grid keeps the declaration (Parameters there shows it), and writes it back
    await page.getByTestId('status-view-design').click();
    await page.getByTestId('cmd-parameters').click();
    await expect(page.getByTestId('query-params-name-0')).toHaveValue('Mini');
    await expect(page.getByTestId('query-params-type-0')).toHaveValue('currency');
    await page.getByTestId('query-params-cancel').click();
    await page.getByTestId('cmd-viewSql').click();
    await expect(sqlBox(page)).toHaveValue(/^PARAMETERS \[Mini\] Currency;/);
  } finally {
    await app.close();
  }
});

test('Create > SQL Query, Table Names, Insert/Delete Rows, Top Values, Property Sheet, Union, SQL View from the datasheet', async () => {
  const { app, page } = await launchApp({ args: [seedSalesE2E('qsql-cmds')], env: FR });
  try {
    // a new query opens in SQL view, empty, without Show Table
    await page.getByTestId('ribbon-tab-create').click();
    await page.getByTestId('cmd-createSqlQuery').click();
    await expect(page.getByTestId('doc-tab-query-Requête1')).toBeVisible();
    await expect(sqlBox(page)).toHaveValue('');
    await expect(page.getByTestId('show-table')).toHaveCount(0);
    await sqlBox(page).fill('SELECT Nom, Ville FROM Clients WHERE Ville = "Lyon" OR Ville = "Paris"');
    await page.getByTestId('status-view-design').click();
    await expect(doc(page).getByTestId('qbe-cell-field-1')).toHaveValue('Ville');
    await expect(doc(page).getByTestId('qbe-cell-criteria1-1')).toHaveValue('"Paris"');

    // Table Names: the Table row hidden, then shown again
    await expect(page.getByTestId('cmd-tableNames')).toHaveAttribute('aria-pressed', 'true');
    await page.getByTestId('cmd-tableNames').click();
    await expect(doc(page).getByTestId('qbe-cell-table-0')).toHaveCount(0);
    await expect(page.getByTestId('cmd-tableNames')).toHaveAttribute('aria-pressed', 'false');
    await page.getByTestId('cmd-tableNames').click();
    await expect(doc(page).getByTestId('qbe-cell-table-0')).toHaveValue('Clients');

    // Insert Rows: an empty « Or » row above the row of the cell; Delete Rows removes it
    await doc(page).getByTestId('qbe-cell-criteria1-0').focus();
    await page.getByTestId('cmd-insertRows').click();
    await expect(doc(page).getByTestId('qbe-cell-criteria1-1')).toHaveValue('');
    await expect(doc(page).getByTestId('qbe-cell-criteria2-1')).toHaveValue('"Paris"');
    await page.getByTestId('cmd-deleteRows').click();
    await expect(doc(page).getByTestId('qbe-cell-criteria1-1')).toHaveValue('"Paris"');
    await doc(page).getByTestId('qbe-cell-criteria0-0').focus();
    await page.getByTestId('cmd-deleteRows').click();
    await expect(doc(page).getByTestId('qbe-cell-criteria0-1')).toHaveValue('"Paris"');
    await type(page, 'qbe-cell-criteria1-1', '"Lyon"');

    // Top Values (Return): a refused value, then 25 %
    await page.getByTestId('cmd-returnValues').click();
    await expect(page.getByTestId('query-top-input')).toHaveValue(fr.query.props.all);
    await page.getByTestId('query-top-input').fill('0');
    await page.getByTestId('query-top-ok').click();
    await expect(page.getByTestId('query-top-error')).toHaveText(fr.query.props.badTop);
    await page.getByTestId('query-top-input').fill('25%');
    await page.getByTestId('query-top-ok').click();

    // Property Sheet: Description, Output All Fields, Unique Values, Top Values
    await page.getByTestId('cmd-propertySheet').click();
    await expect(page.getByTestId('query-props-top')).toHaveValue('25%');
    await page.getByTestId('query-props-description').fill('Clients de Paris ou Lyon');
    await page.getByTestId('query-props-outputAll').check();
    await page.getByTestId('query-props-distinct').check();
    await page.getByTestId('query-props-ok').click();
    await expect(doc(page).getByTestId('qbe-cell-field-0')).toHaveValue('*');
    await page.getByTestId('cmd-viewSql').click();
    await expect(sqlBox(page)).toHaveValue('SELECT DISTINCT TOP 25 PERCENT *, [Clients].[Nom], [Clients].[Ville]\nFROM [Clients]\nWHERE [Clients].[Ville] = "Paris" Or [Clients].[Ville] = "Lyon";');
    await page.keyboard.press('Control+s');
    await page.getByTestId('modal-input').fill('QParisLyon');
    await page.getByTestId('modal-btn-ok').click();
    await expect(page.getByTestId('nav-item-query-QParisLyon')).toBeVisible();
    const described = await page.evaluate(() => (window as unknown as Win).basecraft.objects.list('query').then((l) => l.find((o) => o.name === 'QParisLyon')?.description));
    expect(described).toBe('Clients de Paris ou Lyon');
    // the fields shown again after * are named T.F, as in Access
    const names = await page.evaluate(() => (window as unknown as Win).basecraft.sources.describe({ kind: 'query', name: 'QParisLyon' }).then((d) => d.fields.map((f) => f.name)));
    expect(names).toEqual(['N°', 'Nom', 'Ville', 'Clients.Nom', 'Clients.Ville']);

    // Union: a select query goes to SQL view to write its UNION (Access's SQL-specific query)
    await page.getByTestId('status-view-design').click();
    await expect(doc(page).getByTestId('qbe-cell-field-0')).toHaveValue('*');
    await page.getByTestId('cmd-unionQuery').click();
    await expect(sqlBox(page)).toHaveValue(/^SELECT DISTINCT TOP 25 PERCENT \*/);

    // SQL View from the datasheet (status bar)
    await page.getByTestId('status-view-datasheet').click();
    await expect(doc(page).getByTestId('nav-record-count')).toBeVisible();
    await page.getByTestId('status-view-sql').click();
    await expect(sqlBox(page)).toHaveValue(/^SELECT DISTINCT TOP 25 PERCENT \*/);
    await expect(page.getByTestId('status-view-sql')).toHaveAttribute('aria-pressed', 'true');

    // a description that cannot be written: its message, and the query stays to be saved
    await app.evaluate(({ ipcMain }) => {
      ipcMain.removeHandler('bc:objects:setDescription');
      ipcMain.handle('bc:objects:setDescription', () => ({ ok: false, reason: 'notFound' }));
    });
    await page.getByTestId('status-view-design').click();
    await page.getByTestId('cmd-propertySheet').click();
    await page.getByTestId('query-props-description').fill('Autre');
    await page.getByTestId('query-props-ok').click();
    await page.keyboard.press('Control+s');
    await expect(page.getByTestId('modal')).toContainText(fr.dialog.op.notFound);
    await page.getByTestId('modal-btn-ok').click();
    await expect(page.getByTestId('doc-tab-query-QParisLyon')).toContainText('•');
  } finally {
    await app.close();
  }
});
