// Recette du lot A3 : une base neuve (tables, relation et données saisies par l'interface), une requête paramétrée créée dans la
// grille, l'aller-retour grille ↔ SQL, une requête Opération, la saisie dans une requête monotable, une requête Mise à jour
// refusée en partie puis exécutée quand même, les noms réservés (analyseur) et l'autorisateur, puis la relecture en anglais
// (région en-US).
import { test, expect, type Locator, type Page } from '@playwright/test';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { BasecraftApi } from '../../src/shared/api';
import { launchApp } from './helpers';

const fr = JSON.parse(readFileSync(join(__dirname, '../../src/shared/i18n/fr.json'), 'utf8'));
const en = JSON.parse(readFileSync(join(__dirname, '../../src/shared/i18n/en.json'), 'utf8'));
type Win = { basecraft: BasecraftApi };
// DatasheetView: row selector width, header and row heights; left edge of each column (AutoNumber 80, Number 110,
// Currency 120, Short Text 170).
const MARKER = 44, HEADER = 34, ROW = 30;
const LEFT: Record<string, number[]> = { Clients: [0, 80, 250], Commandes: [0, 80, 190, 310], 'Nom, Montant': [0, 170, 290] };
const NBSP = '\u00a0';

/** The shown document (every tab stays mounted, hidden). */
const doc = (page: Page) => page.locator('section[role=tabpanel]:not([hidden])');
const cell = (page: Page, col: number, row: number) => doc(page).getByTestId(`glide-cell-${col + 1}-${row}`);
const anyEditor = (page: Page) => page.getByTestId('grid-editor-portal').locator('textarea, input');
const count = (page: Page) => doc(page).getByTestId('nav-record-count');
const rowsOf = (page: Page, table: string) => page.evaluate((n) => (window as unknown as Win).basecraft.rows.page(n, { offset: 0, limit: 100 })
  .then((p) => p.rows.map((r) => r.values)), table);
const sqlOf = (page: Page, name: string) => page.evaluate((n) => (window as unknown as Win).basecraft.objects.get('query', n)
  .then((g) => (g.definition as { sql: string }).sql), name);
/** The accessible texts of a datasheet's rows (the edit texts: exact numbers, the region's separators). */
async function shown(page: Page, rows: number, cols: number): Promise<string[][]> {
  await expect(count(page)).toHaveText(String(rows));
  const out: string[][] = [];
  for (let r = 0; r < rows; r++) {
    const row: string[] = [];
    for (let c = 0; c < cols; c++) row.push((await cell(page, c, r).textContent()) ?? '');
    out.push(row);
  }
  return out;
}

async function clickCell(page: Page, table: string, col: number, row: number) {
  const b = (await doc(page).getByTestId('datasheet').getByTestId('data-grid-canvas').boundingBox())!;
  await page.mouse.click(b.x + MARKER + LEFT[table]![col]! + 30, b.y + HEADER + row * ROW + ROW / 2);
}
/** The text a cell shows, in its format (the painted text: Currency « 0,10 € »), as Home › Selection quotes it; the menu is
 *  closed again. `layout`: the columns' left edges (LEFT). */
async function painted(page: Page, layout: string, col: number, row: number): Promise<string> {
  await page.getByTestId('ribbon-tab-home').click();
  await clickCell(page, layout, col, row);
  await expect(doc(page).getByTestId('datasheet').locator('td[role=gridcell]:focus')).toHaveCount(1);
  await page.getByTestId('cmd-filterSelection').click();
  const text = (await page.getByTestId('filter-menu-equals').textContent()) ?? '';
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('filter-menu')).toHaveCount(0);
  return /"(.*)"/s.exec(text)?.[1] ?? text;
}
/** Enter / Tab in an open editor keeps the text and moves; waits until the editor is gone and no row is being saved. */
async function closeEditor(page: Page, key: 'Enter' | 'Tab') {
  await page.keyboard.press(key);
  await expect(anyEditor(page)).toHaveCount(0);
  await expect(doc(page).getByTestId('datasheet')).not.toHaveAttribute('aria-busy', 'true');
}
/** Typing on the selected cell opens its editor with the first key; the rest goes to the editor. */
async function typeIntoCell(page: Page, text: string) {
  await expect(doc(page).getByTestId('datasheet').locator('td[role=gridcell]:focus')).toHaveCount(1);
  await page.keyboard.press(text[0]!);
  await expect(anyEditor(page)).toBeFocused();
  await page.keyboard.type(text.slice(1));
}
/** A new record typed in the trailing row: the first editable column is clicked, the others reached with Tab. */
async function newRecord(page: Page, table: string, row: number, values: string[]) {
  await clickCell(page, table, 1, row);
  await expect(anyEditor(page)).toBeFocused();
  await page.keyboard.type(values[0]!);
  for (const v of values.slice(1)) {
    await closeEditor(page, 'Tab');
    await typeIntoCell(page, v);
  }
  await closeEditor(page, 'Enter');
  await expect(count(page)).toHaveText(String(row + 1));
}
async function drag(page: Page, from: Locator, to: Locator) {
  const a = (await from.boundingBox())!, b = (await to.boundingBox())!;
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
  await page.mouse.down();
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 6 });
  await page.mouse.up();
}
/** Types a design-grid cell (its display form) and leaves it, as Tab does. */
async function type(page: Page, id: string, text: string) {
  await doc(page).getByTestId(id).fill(text);
  await doc(page).getByTestId(id).press('Tab');
}
/** Create › Query Design, the tables added through Show Table, which opens by itself. */
async function newQuery(page: Page, tables: string[]) {
  await page.getByTestId('ribbon-tab-create').click();
  await page.getByTestId('cmd-createQueryDesign').click();
  await expect(page.getByTestId('show-table')).toBeVisible();
  for (const t of tables) await page.getByTestId(`show-table-${t}`).check();
  await page.getByTestId('show-table-add').click();
  await page.getByTestId('show-table-close').click();
  for (const t of tables) await expect(doc(page).getByTestId(`qbe-box-${t}`)).toBeVisible();
}
/** Ctrl+S on a new query: its name asked, then the query in the Navigation Pane. */
async function saveQuery(page: Page, name: string) {
  await page.keyboard.press('Control+s');
  await page.getByTestId('modal-input').fill(name);
  await page.getByTestId('modal-btn-ok').click();
  await expect(page.getByTestId(`nav-item-query-${name}`)).toBeVisible();
  await expect(page.getByTestId(`doc-tab-query-${name}`)).not.toContainText('•');
}
/** Opens a parameter query from the Navigation Pane and answers its prompt. */
async function runWith(page: Page, name: string, value: string) {
  await page.getByTestId(`nav-item-query-${name}`).dblclick();
  await expect(page.getByTestId('modal')).toContainText('Date début :');
  await page.getByTestId('modal-input').fill(value);
  await page.getByTestId('modal-btn-ok').click();
  await expect(page.getByTestId('modal')).toHaveCount(0);
  await expect(page.getByTestId(`doc-tab-query-${name}`)).toHaveAttribute('aria-selected', 'true');
}

const DEPUIS = 'SELECT [Clients].[Nom], [Commandes].[Montant], [Commandes].[Le]\nFROM [Clients] INNER JOIN [Commandes] ON [Clients].[N°] = [Commandes].[Client]\n'
  + 'WHERE [Commandes].[Le] >= [Date début :]\nORDER BY [Commandes].[Le];';
const DEPUIS_DESC = DEPUIS.replace('ORDER BY [Commandes].[Le]', 'ORDER BY [Commandes].[Montant] DESC');

test('recette A3', async () => {
  test.setTimeout(240_000);
  const dir = mkdtempSync(join(tmpdir(), 'basecraft-recette-a3-'));
  const base = join(dir, 'Ventes.basecraft');
  const userDataDir = mkdtempSync(join(tmpdir(), 'basecraft-recette-a3-ud-'));
  writeFileSync(join(userDataDir, 'settings.json'), JSON.stringify({ locale: 'fr' }));
  let lastRows: string[][] = [];

  let { app, page } = await launchApp({ env: { BASECRAFT_REGION: 'fr-FR', BASECRAFT_E2E_SAVE_PATH: base }, userDataDir });
  try {
    // 1. a new base: Clients and Commandes as in the test base (src/main/query/test-db.ts), the relation, the data
    await page.getByTestId('bs-new').click();
    await expect(page.getByTestId('nav-pane')).toBeVisible();
    const newTable = async () => {
      await page.getByTestId('ribbon-tab-create').click();
      await page.getByTestId('cmd-createTableDesign').click();
      await expect(page.getByTestId('doc-tab-Table1')).toBeVisible();
    };
    const field = async (i: number, name: string, type: string) => {
      await page.getByTestId(`design-row-${i}-name`).fill(name);
      await page.getByTestId(`design-row-${i}-type`).selectOption(type);
    };
    const saveTable = async (name: string) => {
      await page.keyboard.press('Control+s');
      await page.getByTestId('modal-input').fill(name);
      await page.getByTestId('modal-btn-ok').click();
      await expect(page.getByTestId(`nav-item-${name}`)).toBeVisible();
      await expect(page.getByTestId(`doc-tab-${name}`)).not.toContainText('•');
      await page.getByTestId(`doc-tab-close-${name}`).click();
    };
    await newTable();
    await field(0, 'N°', 'autoNumber');
    await field(1, 'Nom', 'shortText');
    await page.getByTestId('prop-required').check();
    await field(2, 'Ville', 'shortText');
    await saveTable('Clients');
    await newTable();
    await field(0, 'N°', 'autoNumber');
    await field(1, 'Client', 'number');
    await expect(page.getByTestId('prop-numberSize')).toHaveValue('longInteger');
    await field(2, 'Montant', 'currency');
    await page.getByTestId('prop-validationRule').fill('>0');
    await page.getByTestId('prop-validationRule').press('Tab');
    await field(3, 'Le', 'dateTime');
    await saveTable('Commandes');

    // the relation, with integrity: Database Tools › Relationships, Clients.N° dragged onto Commandes.Client
    await page.getByTestId('ribbon-tab-databaseTools').click();
    await page.getByTestId('cmd-relationships').click();
    await page.getByTestId('addtables-item-Clients').check();
    await page.getByTestId('addtables-item-Commandes').check();
    await page.getByTestId('addtables-add').click();
    await drag(page, page.getByTestId('rel-field-Clients-N°'), page.getByTestId('rel-field-Commandes-Client'));
    await expect(page.getByTestId('relation-cf-0')).toHaveValue('Client');
    await page.getByTestId('relation-enforce').check();
    await page.getByTestId('relation-ok').click();
    await expect(page.getByTestId('rel-line-ClientsCommandes-many')).toHaveText('∞');
    await page.getByTestId('cmd-closeRelationships').click();

    await page.getByTestId('nav-item-Clients').dblclick();
    for (const [i, r] of [['Dupont', 'Lyon'], ['Martin', 'LYON'], ['Durand', 'Paris'], ['Éric', 'Lyôn']].entries()) await newRecord(page, 'Clients', i, r);
    await page.getByTestId('doc-tab-close-Clients').click();
    await page.getByTestId('nav-item-Commandes').dblclick();
    const orders = [['1', '10,1', '01/10/2026'], ['1', '0,1', '05/10/2026'], ['2', '0,2', '21/10/2026'], ['3', '99,99', '30/09/2026'], ['2', '0,1', '21/10/2026']];
    for (const [i, r] of orders.entries()) await newRecord(page, 'Commandes', i, r);
    await page.getByTestId('doc-tab-close-Commandes').click();
    expect(await rowsOf(page, 'Clients')).toEqual([[1, 'Dupont', 'Lyon'], [2, 'Martin', 'LYON'], [3, 'Durand', 'Paris'], [4, 'Éric', 'Lyôn']]);
    expect(await rowsOf(page, 'Commandes')).toEqual([[1, 1, 10.1, '2026-10-01 00:00:00'], [2, 1, 0.1, '2026-10-05 00:00:00'],
      [3, 2, 0.2, '2026-10-21 00:00:00'], [4, 3, 99.99, '2026-09-30 00:00:00'], [5, 2, 0.1, '2026-10-21 00:00:00']]);
    expect(await page.evaluate(() => (window as unknown as Win).basecraft.relations.list())).toEqual([expect.objectContaining({
      parentTable: 'Clients', parentFields: ['N°'], childTable: 'Commandes', childFields: ['Client'], enforce: true, joinType: 1 })]);

    // 2. the parameter query, in the design grid: the relation's join, Nom, Montant, Le >= [Date début :], sorted on Le
    await newQuery(page, ['Clients', 'Commandes']);
    await expect(doc(page).getByTestId('qbe-join-0')).toHaveAttribute('data-kind', 'inner');
    for (const f of ['Clients-Nom', 'Commandes-Montant', 'Commandes-Le']) await doc(page).getByTestId(`qbe-field-${f}`).dblclick();
    await type(page, 'qbe-cell-criteria0-2', '>=[Date début :]');
    await expect(doc(page).getByTestId('qbe-cell-criteria0-2')).toHaveValue('>= [Date début :]');
    await doc(page).getByTestId('qbe-cell-sort-2').selectOption('asc');
    await saveQuery(page, 'Commandes depuis');
    expect(await sqlOf(page, 'Commandes depuis')).toBe(DEPUIS);
    await page.getByTestId('doc-tab-close-query-Commandes depuis').click();

    await runWith(page, 'Commandes depuis', '05/10/2026');
    expect(await shown(page, 3, 3)).toEqual([['Dupont', '0,1', '05/10/2026'], ['Martin', '0,2', '21/10/2026'], ['Martin', '0,1', '21/10/2026']]);
    expect(await painted(page, 'Nom, Montant', 1, 0)).toBe(`0,10${NBSP}€`); // shown as Currency, the field's format
    await page.getByTestId('doc-tab-close-query-Commandes depuis').click();
    // an impossible date is refused inside the prompt, which stays open
    await page.getByTestId('nav-item-query-Commandes depuis').dblclick();
    await page.getByTestId('modal-input').fill('31/02/2026');
    await page.getByTestId('modal-btn-ok').click();
    await expect(page.getByTestId('modal-error')).toHaveText(fr.fieldError.invalidDate);
    await expect(page.getByTestId('modal')).toContainText(fr.query.param.title);
    await expect(page.getByTestId('modal-input')).toHaveValue('31/02/2026');
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('modal')).toHaveCount(0);
    await expect(page.getByTestId('doc-tab-query-Commandes depuis')).toHaveCount(0);

    // 3. grid ↔ SQL: the SQL view shows the grid's text; the sort changed there comes back in the grid, then the same text
    await page.getByTestId('nav-item-query-Commandes depuis').click({ button: 'right' });
    await page.getByTestId('nav-menu-design').click();
    await expect(doc(page).getByTestId('qbe-cell-sort-2')).toHaveValue('asc');
    await page.getByTestId('status-view-sql').click();
    const sqlBox = doc(page).getByTestId('query-sql');
    await expect(sqlBox).toHaveValue(DEPUIS);
    expect(await sqlBox.inputValue()).toContain('WHERE [Commandes].[Le] >= [Date début :]');
    expect(await sqlBox.inputValue()).toContain('ORDER BY [Commandes].[Le];');
    await sqlBox.fill(DEPUIS_DESC);
    await page.getByTestId('status-view-design').click();
    await expect(doc(page).getByTestId('qbe-cell-sort-1')).toHaveValue('desc');
    await expect(doc(page).getByTestId('qbe-cell-sort-2')).toHaveValue('');
    await expect(doc(page).getByTestId('qbe-cell-criteria0-2')).toHaveValue('>= [Date début :]');
    await page.getByTestId('cmd-viewSql').click();
    await expect(sqlBox).toHaveValue(DEPUIS_DESC);
    await page.keyboard.press('Control+s');
    await expect(page.getByTestId('doc-tab-query-Commandes depuis')).not.toContainText('•');
    expect(await sqlOf(page, 'Commandes depuis')).toBe(DEPUIS_DESC);
    await page.getByTestId('doc-tab-close-query-Commandes depuis').click();

    // 4. a Totals query: Ville grouped (Lyon and LYON are one group, as in Access), Montant summed exactly
    await newQuery(page, ['Clients', 'Commandes']);
    await doc(page).getByTestId('qbe-field-Clients-Ville').dblclick();
    await doc(page).getByTestId('qbe-field-Commandes-Montant').dblclick();
    await page.getByTestId('cmd-queryTotals').click();
    await expect(doc(page).getByTestId('qbe-cell-total-0')).toHaveValue('groupBy');
    await doc(page).getByTestId('qbe-cell-total-1').selectOption('sum');
    await saveQuery(page, 'Total par ville');
    await page.getByTestId('status-view-datasheet').click();
    const totals = await shown(page, 2, 2);
    expect(totals[0]![0]).toMatch(/^(Lyon|LYON)$/);
    expect(totals).toEqual([[totals[0]![0], '10,5'], ['Paris', '99,99']]);
    expect(await painted(page, 'Nom, Montant', 1, 0)).toBe(`10,50${NBSP}€`);
    // a Currency sum, exact (10.1 + 0.1 + 0.2 + 0.1 is 10.499999999999998 in floating point), shown as Currency
    const ref = { kind: 'query', name: 'Total par ville' } as const;
    const [info, data] = await page.evaluate((r) => Promise.all([(window as unknown as Win).basecraft.sources.describe(r),
      (window as unknown as Win).basecraft.sources.page(r, { offset: 0, limit: 10 })]), ref);
    expect(info.fields[1]!.type).toBe('currency');
    expect(data.rows).toEqual([[totals[0]![0], 10.5], ['Paris', 99.99]]);
    await page.getByTestId('doc-tab-close-query-Total par ville').click();

    // 5. a one-table query is updatable: a name changed in its datasheet changes Clients
    await newQuery(page, ['Clients']);
    for (const f of ['N°', 'Nom', 'Ville']) await doc(page).getByTestId(`qbe-field-Clients-${f}`).dblclick();
    await type(page, 'qbe-cell-criteria0-2', '"Lyon"');
    await saveQuery(page, 'Clients de Lyon');
    expect(await sqlOf(page, 'Clients de Lyon')).toBe('SELECT [Clients].[N°], [Clients].[Nom], [Clients].[Ville]\nFROM [Clients]\nWHERE [Clients].[Ville] = "Lyon";');
    await page.getByTestId('doc-tab-close-query-Clients de Lyon').click();
    await page.getByTestId('nav-item-query-Clients de Lyon').dblclick();
    expect(await shown(page, 2, 3)).toEqual([['1', 'Dupont', 'Lyon'], ['2', 'Martin', 'LYON']]); // not Lyôn: accents count
    await expect(doc(page).getByTestId('nav-readonly')).toHaveCount(0);
    await clickCell(page, 'Clients', 1, 0);
    await typeIntoCell(page, 'Dupond');
    await closeEditor(page, 'Enter');
    await expect(cell(page, 1, 0)).toHaveText('Dupond');
    expect((await rowsOf(page, 'Clients'))[0]).toEqual([1, 'Dupond', 'Lyon']);
    await page.getByTestId('doc-tab-close-query-Clients de Lyon').click();
    // B4 R7: the join of step 2 is updatable
    await runWith(page, 'Commandes depuis', '05/10/2026');
    await expect(doc(page).getByTestId('nav-record-count')).toHaveText('3');
    await expect(doc(page).getByTestId('nav-readonly')).toHaveCount(0);
    await expect(doc(page).getByTestId('nav-new')).toBeEnabled();
    await page.getByTestId('doc-tab-close-query-Commandes depuis').click();

    // 6. an Update query on customer 1: 2 rows announced; 0,10 - 1 breaks the > 0 rule; run anyway: 9,10 and 0,10
    await newQuery(page, ['Commandes']);
    await doc(page).getByTestId('qbe-field-Commandes-Montant').dblclick();
    await doc(page).getByTestId('qbe-field-Commandes-Client').dblclick();
    await page.getByTestId('cmd-updateQuery').click();
    await type(page, 'qbe-cell-updateTo-0', '[Montant]-1');
    await type(page, 'qbe-cell-criteria0-1', '1');
    await page.getByTestId('cmd-runQuery').click();
    await expect(page.getByTestId('modal')).toContainText(fr.query.action.confirm_update_other.replace('{{count}}', '2'));
    await page.getByTestId('modal-btn-yes').click();
    await expect(page.getByTestId('modal')).toContainText(fr.query.action.validation);
    // Access's counts by cause: no field set to Null, no key or lock violation, 1 record refused by the validation rule, of 2
    const [before, after] = (fr.query.action.partial as string).replace('{{conversion}}', fr.query.action.fields_one.replace('{{count}}', '0'))
      .replace('{{key}}', fr.query.action.records_one.replace('{{count}}', '0')).replace('{{lock}}', fr.query.action.records_one.replace('{{count}}', '0'))
      .replace('{{validation}}', fr.query.action.records_one.replace('{{count}}', '1')).replace('{{total}}', '2').split('{{message}}');
    await expect(page.getByTestId('modal')).toContainText(before!);
    await expect(page.getByTestId('modal')).toContainText(after!);
    await page.getByTestId('modal-btn-yes').click();
    await expect(page.getByTestId('modal')).toHaveCount(0);
    await expect.poll(async () => (await rowsOf(page, 'Commandes')).map((r) => r[2])).toEqual([9.1, 0.1, 0.2, 99.99, 0.1]);
    await page.getByTestId('doc-tab-close-query-Requête1').click();
    await expect(page.getByTestId('modal')).toContainText(fr.query.saveFirst.replace('{{name}}', 'Requête1'));
    await page.getByTestId('modal-btn-no').click();
    await page.getByTestId('nav-item-Commandes').dblclick();
    await expect(cell(page, 2, 0)).toHaveText('9,1');
    await expect(cell(page, 2, 1)).toHaveText('0,1');
    await page.getByTestId('doc-tab-close-Commandes').click();

    // 7. the base's own tables are out of reach of a query, even from the page's API: the parser refuses their names (the
    // authorizer itself, behind it, is met after the reopen, on a table the parser lets through)
    const refused = await page.evaluate(() => (window as unknown as Win).basecraft.sources.page({ kind: 'sql', sql: 'SELECT * FROM bc_meta' }, { offset: 0, limit: 10 })
      .then(() => 'ok', (e: Error) => e.message));
    expect(refused).toMatch(/bc:invalidQuery\|reservedName\|/);

    // the rows the English run must find again (Montant descending now; the change of step 5; the update left 0,10)
    await runWith(page, 'Commandes depuis', '05/10/2026');
    lastRows = await shown(page, 3, 3);
    expect(lastRows[0]).toEqual(['Martin', '0,2', '21/10/2026']);
    expect([...lastRows].sort()).toEqual([['Dupond', '0,1', '05/10/2026'], ['Martin', '0,1', '21/10/2026'], ['Martin', '0,2', '21/10/2026']]);
  } finally {
    // 8. close
    await app.close();
  }

  // a virtual table added by another tool: a name the parser and the binder accept, which the authorizer refuses to read
  const other = new DatabaseSync(base);
  other.exec('CREATE VIRTUAL TABLE "Notes" USING fts5("Texte")');
  other.close();

  // 8. reopened with the interface in English (en-US region): the grid, the SQL and the rows are the same
  writeFileSync(join(userDataDir, 'settings.json'), JSON.stringify({ locale: 'en' }));
  ({ app, page } = await launchApp({ args: [base], env: { BASECRAFT_REGION: 'en-US' }, userDataDir }));
  try {
    await expect(page.getByTestId('ribbon-tab-create')).toHaveText(en.ribbon.tab.create);
    await page.getByTestId('nav-item-query-Commandes depuis').click({ button: 'right' });
    await page.getByTestId('nav-menu-design').click();
    await expect(doc(page).getByTestId('qbe-cell-criteria0-2')).toHaveValue('>= [Date début :]');
    await expect(doc(page).getByTestId('qbe-cell-sort-1')).toHaveValue('desc');
    await page.getByTestId('cmd-viewSql').click();
    await expect(doc(page).getByTestId('query-sql')).toHaveValue(DEPUIS_DESC);
    await page.getByTestId('status-view-datasheet').click();
    await expect(page.getByTestId('modal')).toContainText(en.query.param.title);
    await page.getByTestId('modal-input').fill('10/05/2026');
    await page.getByTestId('modal-btn-ok').click();
    // the same rows in the region's forms: 0.2, 10/21/2026
    const us = (r: string[]) => [r[0], r[1]!.replace(',', '.'), r[2]!.replace(/^(\d\d)\/(\d\d)/, '$2/$1')];
    expect(await shown(page, 3, 3)).toEqual(lastRows.map(us));

    // 7 (continued). the authorizer: the compiled SELECT reads only the base's real tables; its refusal carries no parser code
    const notes = await page.evaluate(() => (window as unknown as Win).basecraft.sources.page({ kind: 'sql', sql: 'SELECT * FROM Notes' }, { offset: 0, limit: 10 })
      .then(() => 'ok', (e: Error) => e.message));
    expect(notes).toMatch(/bc:invalidQuery$/);
  } finally {
    await app.close();
  }
});
