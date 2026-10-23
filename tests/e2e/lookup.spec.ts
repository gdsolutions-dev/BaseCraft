// Champs Liste de choix : onglet « Liste de choix » du mode Création, texte de la liste dans la feuille de données, liste
// déroulante filtrable au clavier, « Limiter à liste ».
import { test, expect, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createTable } from '../../src/main/db/schema';
import { insertRow } from '../../src/main/db/write-layer';
import { localeInfo } from '../../src/shared/locale-format';
import { f, t } from '../../src/shared/test-fixtures';
import { launchApp, seedBase } from './helpers';

const fr = JSON.parse(readFileSync(join(__dirname, '../../src/shared/i18n/fr.json'), 'utf8'));
const FR = { BASECRAFT_REGION: 'fr-FR' };
const clients = t('Clients', [f('N°', 'autoNumber'), f('Nom', 'shortText')]);
const commandes = t('Commandes', [f('N°', 'autoNumber'), f('Client', 'number', { numberSize: 'longInteger' }), f('Statut', 'shortText'),
  f('Qté', 'number', { numberSize: 'double' })]);
// DatasheetView: row selector width, header and row heights; AutoNumber and number column widths.
const MARKER = 44, HEADER = 34, ROW = 30, LEFT = [0, 80, 80 + 110];

const cell = (page: Page, col: number, row: number) => page.getByTestId(`glide-cell-${col + 1}-${row}`);
const editor = (page: Page) => page.getByTestId('lookup-editor');
const rowsOf = async (page: Page) =>
  (await page.evaluate(() => (window as any).basecraft.rows.page('Commandes', { offset: 0, limit: 100 }))).rows as { values: unknown[] }[];
async function clickCell(page: Page, col: number, row: number) {
  const b = (await page.getByTestId('datasheet').getByTestId('data-grid-canvas').boundingBox())!;
  await page.mouse.click(b.x + MARKER + LEFT[col]! + 30, b.y + HEADER + row * ROW + ROW / 2);
  await expect(cell(page, col, row)).toBeFocused(); // Glide focuses the cell after a render
}

test('lookup fields: Lookup tab, list text in the datasheet, keyboard choice, Limit To List', async () => {
  const base = await seedBase('liste', async (db) => {
    createTable(db, clients);
    createTable(db, commandes);
    for (const Nom of ['Dupont', 'Martin', 'Arnaud']) await insertRow(db, clients, { Nom }, localeInfo('fr-FR'));
    await insertRow(db, commandes, { Client: 1 }, localeInfo('fr-FR')); // Dupont
  });
  const { app, page } = await launchApp({ args: [base], env: FR });
  try {
    await page.getByTestId('nav-item-Commandes').click({ button: 'right' });
    await page.getByTestId('nav-menu-design').click();

    // Client: a combo box on the table Clients, bound to its key, showing Nom (the wizard's defaults)
    await page.getByTestId('design-row-1-name').click();
    await page.getByTestId('prop-tab-lookup').click();
    await expect(page.getByTestId('prop-tab-lookup')).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByTestId('prop-displayControl')).toHaveValue('textBox');
    await page.getByTestId('prop-displayControl').selectOption('comboBox');
    await expect(page.getByTestId('prop-rowSourceType')).toHaveValue('values');
    await expect(page.getByTestId('prop-rowSourceType').locator('option[value="table"]')).toBeEnabled();
    await page.getByTestId('prop-rowSourceType').selectOption('table');
    await expect(page.getByTestId('prop-rowSource')).toHaveValue(''); // the Row Source text is kept (an empty list: empty)
    await page.getByTestId('prop-rowSource').fill('Clients');
    await expect(page.getByTestId('prop-rowSource')).toHaveValue('Clients');
    await expect(page.getByTestId('prop-boundColumn')).toHaveValue('1');
    await expect(page.getByTestId('prop-columnCount')).toHaveValue('2');
    await expect(page.getByTestId('prop-columnWidths')).toHaveValue('0cm;2,54cm'); // the key hidden

    // Statut: a value list limited to the list
    await page.getByTestId('design-row-2-name').click();
    await expect(page.getByTestId('prop-displayControl')).toHaveValue('textBox');
    await page.getByTestId('prop-displayControl').selectOption('comboBox');
    await page.getByTestId('prop-rowSource').fill('Ouverte ; Fermée;');
    await page.getByTestId('prop-rowSource').press('Tab');
    await expect(page.getByTestId('prop-rowSource')).toHaveValue('Ouverte;Fermée');
    await page.getByTestId('prop-limitToList').check();
    // Qté: a Number's items are typed and shown in the region (fr), stored canonical (the same list in every region)
    await page.getByTestId('design-row-3-name').click();
    await page.getByTestId('prop-displayControl').selectOption('comboBox');
    await page.getByTestId('prop-rowSource').fill('1,5 ; 1 000');
    await page.getByTestId('prop-rowSource').press('Tab');
    await expect(page.getByTestId('prop-rowSource')).toHaveValue('1,5;1000');
    // an AutoNumber has no Lookup tab (Access offers it for Short Text, Number and Yes/No)
    await page.getByTestId('design-row-0-name').click();
    await expect(page.getByTestId('prop-tab-lookup')).toHaveCount(0);
    await page.keyboard.press('Control+s');
    await expect(page.getByTestId('doc-tab-Commandes')).not.toContainText('•');
    const design = await page.evaluate(() => (window as any).basecraft.tables.design('Commandes'));
    expect(design.fields[1].props.lookup).toEqual({ kind: 'table', table: 'Clients', boundColumn: 1, columnCount: 2, columnWidths: [0, 1440], limitToList: false });
    expect(design.fields[2].props.lookup).toEqual({ kind: 'values', values: ['Ouverte', 'Fermée'], limitToList: true });
    expect(design.fields[3].props.lookup).toEqual({ kind: 'values', values: ['1.5', '1000'], limitToList: false });

    // the cell shows the list text, not the stored 1
    await page.getByTestId('status-view-datasheet').click();
    await expect(cell(page, 1, 0)).toHaveText('Dupont');

    // the drop-down list, sorted on Nom, starts on the stored value; the arrows choose, Enter saves the bound value
    await clickCell(page, 1, 0);
    await page.keyboard.press('Enter');
    await expect(editor(page)).toBeFocused();
    await expect(editor(page)).toHaveValue('Dupont');
    await expect(page.getByTestId('lookup-list').getByRole('option')).toHaveText(['Arnaud', 'Dupont', 'Martin']);
    await expect(page.getByRole('option', { name: 'Dupont' })).toHaveAttribute('aria-selected', 'true');
    await page.keyboard.press('ArrowDown');
    await expect(editor(page)).toHaveValue('Martin');
    await page.keyboard.press('Enter');
    await expect(editor(page)).toHaveCount(0);
    await expect.poll(async () => (await rowsOf(page)).map((r) => r.values)).toEqual([[1, 2, null, null]]);
    await expect(cell(page, 1, 0)).toHaveText('Martin');

    // the lists are read again when the tab comes back: a client renamed meanwhile shows renamed
    await page.getByTestId('nav-item-Clients').dblclick();
    await expect(page.getByTestId('doc-tab-Clients')).toHaveAttribute('aria-selected', 'true');
    expect((await page.evaluate(() => (window as any).basecraft.rows.update('Clients', 2, { Nom: 'Martine' }))).ok).toBe(true);
    await page.getByTestId('doc-tab-Commandes').click();
    await expect(cell(page, 1, 0)).toHaveText('Martine');

    // typing filters the list (case and accents folded); a value outside a list limited to it is refused
    await clickCell(page, 2, 0);
    await page.keyboard.press('f');
    await expect(editor(page)).toBeFocused();
    await expect(page.getByTestId('lookup-list').getByRole('option')).toHaveText(['Fermée']);
    await page.keyboard.press('Escape');
    await expect(editor(page)).toHaveCount(0);
    await page.keyboard.press('A');
    await expect(editor(page)).toBeFocused();
    await page.keyboard.type('utre');
    await expect(editor(page)).toHaveValue('Autre');
    await expect(page.getByTestId('lookup-list').getByRole('option')).toHaveCount(0);
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('datasheet-error')).toContainText(fr.fieldError.notInList);
    await expect(page.getByTestId('modal')).toContainText(fr.fieldError.notInList); // the refusal also comes as a message box
    await page.getByTestId('modal-btn-ok').click();
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('datasheet-error')).toHaveCount(0);
    expect((await rowsOf(page)).map((r) => r.values)).toEqual([[1, 2, null, null]]);
  } finally {
    await app.close();
  }
});

test('the Lookup tab as in Access: its rows in order, hidden column, column heads, list rows, Edit List Items, SQL kept', async () => {
  const villes = t('Clients', [f('N°', 'autoNumber'), f('Nom', 'shortText'), f('Ville', 'shortText')]);
  const cmd = t('Commandes', [f('N°', 'autoNumber'), f('Client', 'number', { numberSize: 'longInteger' }), f('Statut', 'shortText'), f('Note', 'shortText')]);
  const base = await seedBase('liste-access', async (db) => {
    createTable(db, villes);
    createTable(db, cmd);
    for (const [Nom, Ville] of [['Dupont', 'Lyon'], ['Martin', 'Paris'], ['Arnaud', 'Nice']]) await insertRow(db, villes, { Nom, Ville }, localeInfo('fr-FR'));
    await insertRow(db, cmd, { Client: 1, Note: 'xyz' }, localeInfo('fr-FR'));
  });
  const P = fr.fieldProp;
  const labels = (page: Page) => page.locator('.fprops .plist .prow > label');
  const ALL = [P.displayControl, P.rowSourceType, P.rowSource, P.boundColumn, P.columnCount, P.columnHeads, P.columnWidths, P.listRows, P.listWidth,
    P.limitToList, P.allowMultipleValues, P.allowValueListEdits, P.listItemsEditForm, P.showOnlyRowSourceValues];
  const { app, page } = await launchApp({ args: [base], env: FR });
  try {
    await page.getByTestId('nav-item-Commandes').click({ button: 'right' });
    await page.getByTestId('nav-menu-design').click();
    await page.getByTestId('design-row-1-name').click();
    await page.getByTestId('prop-tab-lookup').click();
    // Text Box: no other row; Combo Box: Access's rows in Access's order; List Box: without List Rows, List Width, Limit To List
    await expect(labels(page)).toHaveText([P.displayControl]);
    await expect(page.getByTestId('prop-displayControl').locator('option')).toHaveText([P.displayControls.textBox, P.displayControls.listBox, P.displayControls.comboBox]);
    await page.getByTestId('prop-displayControl').selectOption('comboBox');
    await expect(labels(page)).toHaveText(ALL);
    await page.getByTestId('prop-displayControl').selectOption('listBox');
    await expect(labels(page)).toHaveText(ALL.filter((x) => ![P.listRows, P.listWidth, P.limitToList].includes(x)));
    await page.getByTestId('prop-displayControl').selectOption('comboBox');
    await expect(page.getByTestId('prop-rowSourceType').locator('option')).toHaveText([P.rowSourceTypes.table, P.rowSourceTypes.values, P.rowSourceTypes.fieldList]);
    // planned properties: shown disabled, with when they come
    for (const [key, tip] of [['allowMultipleValues', P.plannedLater], ['listItemsEditForm', P.plannedForms], ['showOnlyRowSourceValues', P.plannedLater]]) {
      await expect(page.getByTestId(`prop-${key}`)).toBeDisabled();
      await expect(page.getByTestId(`prop-${key}`)).toHaveAttribute('title', tip);
    }
    await expect(page.getByTestId('prop-rowSource-build')).toBeDisabled(); // « … »: A3's Query Builder, for a Table/Query source
    await expect(page.getByTestId('prop-rowSource-build')).toHaveAttribute('title', P.queryBuilder);

    // Client: three columns of Clients, the key hidden (0), column heads, two rows shown
    await page.getByTestId('prop-rowSourceType').selectOption('table');
    await page.getByTestId('prop-rowSource').fill('Clients');
    await expect(page.getByTestId('prop-columnWidths')).toHaveValue('0cm;2,54cm');
    await page.getByTestId('prop-columnCount').fill('3');
    await page.getByTestId('prop-columnCount').press('Tab');
    await page.getByTestId('prop-columnWidths').fill('abc');
    await page.getByTestId('prop-columnWidths').press('Tab');
    await expect(page.getByTestId('prop-columnWidths-error')).toHaveText(fr.expr.error.badWidths);
    await page.getByTestId('prop-columnWidths').fill('0;3');
    await page.getByTestId('prop-columnWidths').press('Tab');
    await expect(page.getByTestId('prop-columnWidths-error')).toHaveCount(0);
    await expect(page.getByTestId('prop-columnWidths')).toHaveValue('0cm;3cm');
    await page.getByTestId('prop-columnHeads').check();
    await page.getByTestId('prop-listRows').fill('2');
    await page.getByTestId('prop-listRows').press('Tab');
    await expect(page.getByTestId('prop-rowSource-note')).toHaveCount(0);
    // Statut: a value list whose items can be edited from the datasheet
    await page.getByTestId('design-row-2-name').click();
    await page.getByTestId('prop-displayControl').selectOption('comboBox');
    await page.getByTestId('prop-rowSource').fill('Ouverte;Fermée');
    await page.getByTestId('prop-rowSource').press('Tab');
    await page.getByTestId('prop-allowValueListEdits').check();
    // Note: SQL is kept as typed; its list comes from A3's query engine (A2-R18)
    await page.getByTestId('design-row-3-name').click();
    await page.getByTestId('prop-displayControl').selectOption('comboBox');
    await page.getByTestId('prop-rowSourceType').selectOption('table');
    const sql = 'SELECT Nom FROM Clients ORDER BY Nom;';
    await page.getByTestId('prop-rowSource').fill(sql);
    await expect(page.getByTestId('prop-rowSource-note')).toHaveCount(0); // SQL is served by A3 (A2-R18): no note
    await expect(page.getByTestId('prop-rowSource-build')).toBeEnabled();
    await page.keyboard.press('Control+s');
    await expect(page.getByTestId('doc-tab-Commandes')).not.toContainText('•');
    const design = await page.evaluate(() => (window as any).basecraft.tables.design('Commandes'));
    expect(design.fields[1].props.lookup).toEqual({ kind: 'table', table: 'Clients', boundColumn: 1, columnCount: 3, columnWidths: [0, 1701], columnHeads: true, listRows: 2, limitToList: false });
    expect(design.fields[2].props.lookup).toEqual({ kind: 'values', values: ['Ouverte', 'Fermée'], allowValueListEdits: true, limitToList: false });
    expect(design.fields[3].props.lookup).toMatchObject({ kind: 'table', table: sql });

    // the datasheet: the text shown is the first visible column; the list shows its heads and two rows, then scrolls
    await page.getByTestId('status-view-datasheet').click();
    await expect(cell(page, 1, 0)).toHaveText('Dupont');
    await expect(cell(page, 3, 0)).toHaveText('xyz'); // SQL: a value not in its list shows as stored
    const at = [0, 80, 190, 360];
    const click = async (col: number) => {
      const b = (await page.getByTestId('datasheet').getByTestId('data-grid-canvas').boundingBox())!;
      await page.mouse.click(b.x + MARKER + at[col]! + 30, b.y + HEADER + ROW / 2);
      await expect(cell(page, col, 0)).toBeFocused();
    };
    await click(1);
    await page.keyboard.press('Enter');
    await expect(editor(page)).toHaveValue('Dupont');
    await expect(page.getByTestId('lookup-heads')).toHaveText('NomVille');
    const options = page.getByTestId('lookup-list').getByRole('option');
    await expect(options).toHaveCount(3);
    await expect(options.first()).toHaveAccessibleName('Arnaud Nice'); // N° hidden
    const [shown, full] = await page.getByTestId('lookup-list').evaluate((e) => [e.clientHeight, e.scrollHeight]);
    expect(full).toBeGreaterThan(shown!);
    expect(shown).toBe(2 * 24);
    await expect(page.getByTestId('lookup-edit-list')).toHaveCount(0); // a table source: no Edit List Items
    await page.keyboard.press('Escape');
    await click(3);
    await page.keyboard.press('Enter');
    await expect(options).toHaveCount(3); // SQL (A3): the query's rows, in its order
    await expect(options.first()).toHaveAccessibleName('Arnaud');
    await page.keyboard.press('Escape');

    // Edit List Items: one item per line and the Default Value, saved as the field's design
    await click(2);
    await page.keyboard.press('Enter');
    await expect(page.getByRole('option')).toHaveText(['Ouverte', 'Fermée']);
    await page.getByTestId('lookup-edit-list').click();
    await expect(editor(page)).toHaveCount(0);
    await expect(page.getByTestId('edit-list-items')).toHaveValue('Ouverte\nFermée');
    await page.getByTestId('edit-list-items').fill('Ouverte\nFermée\nEn attente');
    await page.getByTestId('edit-list-default').selectOption('En attente');
    await page.getByTestId('edit-list-ok').click();
    await expect(page.getByTestId('edit-list')).toHaveCount(0);
    await expect.poll(async () => (await page.evaluate(() => (window as any).basecraft.tables.design('Commandes'))).fields[2].props)
      .toMatchObject({ defaultValue: '"En attente"', lookup: { kind: 'values', values: ['Ouverte', 'Fermée', 'En attente'], allowValueListEdits: true } });
    await click(2);
    await page.keyboard.press('Enter');
    await expect(page.getByRole('option')).toHaveText(['Ouverte', 'Fermée', 'En attente']);
    await page.keyboard.press('Escape');
  } finally {
    await app.close();
  }
});

test('Lookup fix round: hidden rows drop their errors, Row Source kept across types, Edit List Items by keyboard and on an empty list', async () => {
  const values = (v: string[], more: object = {}) => ({ lookup: { kind: 'values' as const, values: v, allowValueListEdits: true, limitToList: false, ...more } });
  const tickets = t('Tickets', [f('N°', 'autoNumber'), f('Statut', 'shortText', values([])),
    f('Etat', 'shortText', { ...values(['Ouverte', 'Fermée']), defaultValue: '"Ouverte"' }),
    f('Grille', 'shortText', values(['Code', 'Nom', '1', '', '2', 'B'], { columnCount: 2, columnHeads: true })),
    f('Champ', 'shortText', { lookup: { kind: 'fieldList', table: 'Nope', limitToList: false } })]);
  const base = await seedBase('liste-fix1', async (db) => {
    createTable(db, tickets);
    await insertRow(db, tickets, {}, localeInfo('fr-FR'));
  });
  const P = fr.fieldProp;
  const design = (page: Page) => page.evaluate(() => (window as any).basecraft.tables.design('Tickets'));
  const { app, page } = await launchApp({ args: [base], env: FR });
  try {
    await page.getByTestId('nav-item-Tickets').click({ button: 'right' });
    await page.getByTestId('nav-menu-design').click();
    // a Field List on a table that is not there: « Table introuvable », not the A3 note
    await page.getByTestId('design-row-4-name').click();
    await page.getByTestId('prop-tab-lookup').click();
    await expect(page.getByTestId('prop-rowSource-note')).toHaveText(P.tableNotFound);
    // Etat: the Row Source text survives a change of Row Source Type, both ways
    await page.getByTestId('design-row-2-name').click();
    await page.getByTestId('prop-rowSourceType').selectOption('table');
    await expect(page.getByTestId('prop-rowSource')).toHaveValue('Ouverte;Fermée');
    await page.getByTestId('prop-rowSourceType').selectOption('values');
    await expect(page.getByTestId('prop-rowSource')).toHaveValue('Ouverte;Fermée');
    // Statut: an unreadable List Rows, then a List Box hides the row: its error no longer blocks the save
    await page.getByTestId('design-row-1-name').click();
    await page.getByTestId('prop-listRows').fill('x');
    await page.getByTestId('prop-listRows').press('Tab');
    await expect(page.getByTestId('prop-listRows-error')).toBeVisible();
    await page.getByTestId('prop-displayControl').selectOption('listBox');
    await expect(page.getByTestId('prop-listRows')).toHaveCount(0);
    await page.keyboard.press('Control+s');
    await expect(page.getByTestId('doc-tab-Tickets')).not.toContainText('•');
    expect((await design(page)).fields[1].props.lookup.displayControl).toBe('listBox');

    await page.getByTestId('status-view-datasheet').click();
    const at = [0, 80, 250, 420];
    const open = async (col: number) => {
      // a saved list reloads the datasheet (its selection is reset): click again until the cell keeps the focus
      await expect(async () => {
        const b = (await page.getByTestId('datasheet').getByTestId('data-grid-canvas').boundingBox())!;
        await page.mouse.click(b.x + MARKER + at[col]! + 30, b.y + HEADER + ROW / 2);
        await expect(cell(page, col, 0)).toBeFocused({ timeout: 1000 });
      }).toPass();
      await page.keyboard.press('Enter');
      await expect(editor(page)).toBeFocused();
    };
    // Statut: an empty list still opens, and F2 opens Edit List Items
    await open(1);
    await expect(page.getByTestId('lookup-list').getByRole('option')).toHaveCount(0);
    await expect(page.getByTestId('lookup-edit-list')).toHaveAttribute('title', /F2/);
    await page.keyboard.press('F2');
    await expect(page.getByTestId('edit-list-items')).toHaveValue('');
    await page.getByTestId('edit-list-items').fill('A\nB');
    await page.getByTestId('edit-list-ok').click();
    await expect.poll(async () => (await design(page)).fields[1].props.lookup.values).toEqual(['A', 'B']);
    // Etat: the button works from the keyboard; renaming the default item renames the Default Value
    await open(2);
    await page.getByTestId('lookup-edit-list').focus();
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('edit-list-default').locator('option:checked')).toHaveText('Ouverte');
    await page.getByTestId('edit-list-items').fill('Ouvert\nFermée');
    await expect(page.getByTestId('edit-list-default').locator('option:checked')).toHaveText('Ouvert');
    await page.getByTestId('edit-list-ok').click();
    await expect.poll(async () => (await design(page)).fields[2].props.defaultValue).toBe('"Ouvert"');
    // Grille: blank cells stay, so the columns and the heads row stay aligned
    await open(3);
    await page.keyboard.press('F2');
    await expect(page.getByTestId('edit-list-items')).toHaveValue('Code\nNom\n1\n\n2\nB');
    await page.getByTestId('edit-list-ok').click();
    await expect(page.getByTestId('edit-list')).toHaveCount(0);
    expect((await design(page)).fields[3].props.lookup.values).toEqual(['Code', 'Nom', '1', '', '2', 'B']);
  } finally {
    await app.close();
  }
});
