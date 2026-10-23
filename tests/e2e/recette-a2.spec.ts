// Recette du lot A2 : liste de choix, format, règle de validation, valeur par défaut, masque de saisie, relation avec
// intégrité puis suppression en cascade, filtres, relecture en anglais — tout par l'interface, en français (région fr-FR).
import { test, expect, type Locator, type Page } from '@playwright/test';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { launchApp } from './helpers';

const fr = JSON.parse(readFileSync(join(__dirname, '../../src/shared/i18n/fr.json'), 'utf8'));
const en = JSON.parse(readFileSync(join(__dirname, '../../src/shared/i18n/en.json'), 'utf8'));
const fill = (s: string, p: Record<string, string | number>) => s.replace(/\{\{(\w+)\}\}/g, (_m, k: string) => String(p[k]));
// DatasheetView: row selector width, header and row heights; left edge of each column (AutoNumber 80, Number 110,
// Currency 120, Date/Time 150, Short Text 170).
const MARKER = 44, HEADER = 34, ROW = 30;
const LEFT: Record<string, number[]> = { Clients: [0, 80, 250], Commandes: [0, 80, 190, 310, 460] };

/** The datasheet shown: the other tabs' datasheets stay mounted, hidden, with the same test ids. */
const view = (page: Page) => page.locator('.datasheet:visible');
const cell = (page: Page, col: number, row: number) => view(page).getByTestId(`glide-cell-${col + 1}-${row}`);
const textEditor = (page: Page) => page.getByTestId('grid-editor-portal').locator('textarea');
const anyEditor = (page: Page) => page.getByTestId('grid-editor-portal').locator('textarea, input');
const count = (page: Page) => view(page).getByTestId('nav-record-count');
const rowsOf = async (page: Page, table: string) =>
  ((await page.evaluate((n) => (window as any).basecraft.rows.page(n, { offset: 0, limit: 100 }), table)).rows as { values: unknown[] }[]).map((r) => r.values);

async function clickCell(page: Page, table: string, col: number, row: number) {
  const b = (await view(page).getByTestId('datasheet').getByTestId('data-grid-canvas').boundingBox())!;
  await page.mouse.click(b.x + MARKER + LEFT[table]![col]! + 30, b.y + HEADER + row * ROW + ROW / 2);
}
/** Enter / Tab in an open editor keeps the text and moves; waits until the editor is gone and no row is being saved. */
async function closeEditor(page: Page, key: 'Enter' | 'Tab') {
  await page.keyboard.press(key);
  await expect(anyEditor(page)).toHaveCount(0);
  await expect(view(page).getByTestId('datasheet')).not.toHaveAttribute('aria-busy', 'true');
}
/** Typing on the selected cell opens its editor (text, list or mask) with the first key; the rest goes to the editor. */
async function typeIntoCell(page: Page, text: string) {
  await expect(view(page).getByTestId('datasheet').locator('td[role=gridcell]:focus')).toHaveCount(1); // Glide focuses the cell after a render
  await page.keyboard.press(text[0]!);
  await expect(anyEditor(page)).toBeFocused();
  await page.keyboard.type(text.slice(1));
}
/** The save attempt just made is refused: a box with the inline bar's text, dismissed with OK; the focus is back on the
 *  cell in error, the bar still shows it and the row is still pending. */
async function refused(page: Page, text: string, [col, row]: [number, number]) {
  const box = page.getByRole('dialog', { name: 'BaseCraft' });
  await expect(box).toContainText(text);
  await page.getByTestId('modal-btn-ok').click();
  await expect(page.getByTestId('modal')).toHaveCount(0);
  await expect(cell(page, col, row)).toBeFocused();
  await expect(view(page).getByTestId('datasheet-error')).toHaveText(text);
  await expect(page.getByTestId('doc-tab-Commandes')).toContainText('•');
}
async function drag(page: Page, from: Locator, to: Locator) {
  const a = (await from.boundingBox())!, b = (await to.boundingBox())!;
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
  await page.mouse.down();
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 6 });
  await page.mouse.up();
}
/** Database Tools › Relationships, where Access puts it. */
async function openRelations(page: Page, text: typeof fr) {
  await page.getByTestId('ribbon-tab-databaseTools').click();
  await page.getByTestId('cmd-relationships').click();
  await expect(page.getByTestId('doc-tab-window-relations')).toHaveText(text.relations.title);
}
async function openDatasheet(page: Page, table: string) {
  await page.getByTestId(`nav-item-${table}`).dblclick();
  await expect(page.getByTestId(`doc-tab-${table}`)).toHaveAttribute('aria-selected', 'true');
  await expect(view(page).getByTestId('datasheet').getByTestId('data-grid-canvas')).toBeVisible();
}

test('recette A2', async () => {
  test.setTimeout(180_000);
  const dir = mkdtempSync(join(tmpdir(), 'basecraft-recette-a2-'));
  const base = join(dir, 'Ventes.basecraft');
  const userDataDir = mkdtempSync(join(tmpdir(), 'basecraft-recette-a2-ud-'));
  writeFileSync(join(userDataDir, 'settings.json'), JSON.stringify({ locale: 'fr' }));
  const env = { BASECRAFT_REGION: 'fr-FR' };
  const now = new Date();
  const p2 = (n: number) => String(n).padStart(2, '0');
  const today = `${p2(now.getDate())}/${p2(now.getMonth() + 1)}/${now.getFullYear()}`;
  const todayStored = `${now.getFullYear()}-${p2(now.getMonth() + 1)}-${p2(now.getDate())} 00:00:00`;

  let { app, page } = await launchApp({ env: { ...env, BASECRAFT_E2E_SAVE_PATH: base }, userDataDir });
  try {
    // 1. a new base; Clients (N°, Nom required, Ville)
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
    const saveAs = async (name: string) => {
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
    await saveAs('Clients');

    // Commandes: Client a Lookup on Clients (N°, Nom); Montant Standard, > 0; Le = Date(); Tél masked
    await newTable();
    await field(0, 'N°', 'autoNumber');
    await field(1, 'Client', 'number');
    await expect(page.getByTestId('prop-numberSize')).toHaveValue('longInteger');
    await page.getByTestId('prop-tab-lookup').click();
    await page.getByTestId('prop-displayControl').selectOption('comboBox');
    await page.getByTestId('prop-rowSourceType').selectOption('table');
    await page.getByTestId('prop-rowSource').fill('Clients');
    await expect(page.getByTestId('prop-boundColumn')).toHaveValue('1');
    await expect(page.getByTestId('prop-columnCount')).toHaveValue('2');
    await field(2, 'Montant', 'currency');
    await page.getByTestId('prop-tab-general').click();
    await page.getByTestId('prop-format').fill(fr.format.standard);
    await page.getByTestId('prop-validationRule').fill('>0');
    await page.getByTestId('prop-validationText').fill('Montant positif');
    await field(3, 'Le', 'dateTime');
    await page.getByTestId('prop-defaultValue').fill('Date()');
    await field(4, 'Tél', 'shortText');
    await page.getByTestId('prop-inputMask').fill('00 00 00 00 00');
    await page.getByTestId('prop-inputMask').press('Tab');
    await expect(page.getByTestId('prop-inputMask-error')).toHaveCount(0);
    await expect(page.getByTestId('design-row-0-key')).toHaveAttribute('data-primary-key', 'true');
    await saveAs('Commandes');
    const design = await page.evaluate(() => (window as any).basecraft.tables.design('Commandes'));
    expect(design.fields.map((x: { name: string; props: { type: string } }) => [x.name, x.props.type]))
      .toEqual([['N°', 'autoNumber'], ['Client', 'number'], ['Montant', 'currency'], ['Le', 'dateTime'], ['Tél', 'shortText']]);
    expect(design.fields[1].props.lookup).toMatchObject({ kind: 'table', table: 'Clients', boundColumn: 1, columnCount: 2 });
    expect(design.fields[2].props).toMatchObject({ format: 'standard', validationRule: '> 0', validationText: 'Montant positif' });
    expect(design.fields[3].props).toMatchObject({ defaultValue: 'Date()' });
    expect(design.fields[4].props).toMatchObject({ inputMask: '00 00 00 00 00' });

    // 2. Relationships: Clients.N° dragged onto Commandes.Client, with integrity, no cascade
    await openRelations(page, fr);
    await expect(page.getByTestId('addtables-dialog')).toBeVisible();
    await page.getByTestId('addtables-item-Clients').check();
    await page.getByTestId('addtables-item-Commandes').check();
    await page.getByTestId('addtables-add').click();
    await drag(page, page.getByTestId('rel-field-Clients-N°'), page.getByTestId('rel-field-Commandes-Client'));
    await expect(page.getByTestId('relation-parent')).toHaveValue('Clients');
    await expect(page.getByTestId('relation-child')).toHaveValue('Commandes');
    await expect(page.getByTestId('relation-pf-0')).toHaveValue('N°');
    await expect(page.getByTestId('relation-cf-0')).toHaveValue('Client');
    await page.getByTestId('relation-enforce').check();
    await expect(page.getByTestId('relation-cascadeDelete')).not.toBeChecked();
    await page.getByTestId('relation-ok').click();
    await expect(page.getByTestId('relation-dialog')).toHaveCount(0);
    await expect(page.getByTestId('rel-line-ClientsCommandes-one')).toHaveText('1');
    await expect(page.getByTestId('rel-line-ClientsCommandes-many')).toHaveText('∞');
    await page.getByTestId('cmd-closeRelationships').click();

    // 3. two customers
    await openDatasheet(page, 'Clients');
    for (const [row, nom, ville] of [[0, 'Dupont', 'Lyon'], [1, 'Martin', 'Nantes']] as const) {
      await clickCell(page, 'Clients', 1, row);
      await expect(textEditor(page)).toBeFocused();
      await page.keyboard.type(nom);
      await closeEditor(page, 'Tab');
      await typeIntoCell(page, ville);
      await closeEditor(page, 'Enter');
      await expect(count(page)).toHaveText(String(row + 1));
    }
    expect(await rowsOf(page, 'Clients')).toEqual([[1, 'Dupont', 'Lyon'], [2, 'Martin', 'Nantes']]);

    // three orders; a new record's date is today's (Glide's trailing row shows only its hint until the record starts)
    await openDatasheet(page, 'Commandes');
    const orders: unknown[][] = [];

    // order 1: Dupont, 50, a full phone number
    await clickCell(page, 'Commandes', 1, 0);
    await expect(page.getByTestId('lookup-editor')).toBeFocused();
    await expect(cell(page, 3, 0)).toHaveText(today);
    await page.keyboard.type('Dup');
    await expect(page.getByTestId('lookup-editor')).toHaveValue('Dup');
    await closeEditor(page, 'Tab');
    await expect(cell(page, 1, 0)).toHaveText('Dupont');
    await typeIntoCell(page, '50');
    await closeEditor(page, 'Tab');
    await expect(cell(page, 3, 0)).toHaveText(today);
    await closeEditor(page, 'Tab'); // no editor open on Le: Tab only moves on
    await typeIntoCell(page, '0612345678');
    await expect(page.getByTestId('masked-editor')).toHaveValue('06 12 34 56 78');
    await closeEditor(page, 'Enter');
    await expect(count(page)).toHaveText('1');
    orders.push([1, 1, 50, todayStored, '0612345678']);
    expect(await rowsOf(page, 'Commandes')).toEqual(orders);

    // order 2: Martin, -5 refused with the rule's text, then 150
    await clickCell(page, 'Commandes', 1, 1);
    await expect(page.getByTestId('lookup-editor')).toBeFocused();
    await page.keyboard.type('Mar');
    await closeEditor(page, 'Tab');
    await typeIntoCell(page, '-5');
    await page.keyboard.press('Enter');
    await refused(page, '« Montant » : Montant positif', [2, 1]);
    await expect(count(page)).toHaveText('1');
    expect(await rowsOf(page, 'Commandes')).toEqual(orders);
    await typeIntoCell(page, '150');
    await closeEditor(page, 'Enter');
    await expect(count(page)).toHaveText('2');
    orders.push([2, 2, 150, todayStored, null]);
    expect(await rowsOf(page, 'Commandes')).toEqual(orders);

    // order 3, no amount: an incomplete phone number refused, customer 99 refused (no parent record), then Martin
    await clickCell(page, 'Commandes', 1, 2);
    await expect(page.getByTestId('lookup-editor')).toBeFocused();
    await page.keyboard.type('99');
    await closeEditor(page, 'Tab');
    await page.keyboard.press('Tab'); // Montant left empty
    await page.keyboard.press('Tab');
    await expect(cell(page, 4, 2)).toBeFocused();
    await typeIntoCell(page, '0612');
    await expect(page.getByTestId('masked-editor')).toHaveValue('06 12 __ __ __');
    await page.keyboard.press('Enter');
    await refused(page, `« Tél » : ${fr.fieldError.mask}`, [4, 2]);
    await expect(count(page)).toHaveText('2');
    expect(await rowsOf(page, 'Commandes')).toEqual(orders);
    await typeIntoCell(page, '0712345678');
    await page.keyboard.press('Enter');
    await refused(page, `« Client » : ${fill(fr.fieldError.noParent, { table: 'Clients' })}`, [1, 2]);
    await expect(count(page)).toHaveText('2');
    expect(await rowsOf(page, 'Commandes')).toEqual(orders);
    await typeIntoCell(page, 'Mar');
    await expect(page.getByTestId('lookup-editor')).toHaveValue('Mar');
    await closeEditor(page, 'Enter');
    await expect(count(page)).toHaveText('3');
    orders.push([3, 2, null, todayStored, '0712345678']);
    expect(await rowsOf(page, 'Commandes')).toEqual(orders);
    await expect(page.getByTestId('doc-tab-Commandes')).not.toContainText('•');

    // 4. deleting Dupont, who has an order: refused, naming Commandes; nothing deleted
    await page.getByTestId('doc-tab-Clients').click();
    await clickCell(page, 'Clients', 1, 0);
    await page.getByTestId('ribbon-tab-home').click();
    await page.getByTestId('cmd-deleteRecord').click();
    await expect(page.getByTestId('modal')).toContainText(fr.datasheet.delete_one);
    await page.getByTestId('modal-btn-yes').click();
    await expect(page.getByTestId('modal')).toContainText(fill(fr.datasheet.related, { table: 'Commandes' }));
    await page.getByTestId('modal-btn-ok').click();
    await expect(page.getByTestId('modal')).toHaveCount(0);
    await expect(count(page)).toHaveText('2');
    expect(await rowsOf(page, 'Clients')).toEqual([[1, 'Dupont', 'Lyon'], [2, 'Martin', 'Nantes']]);
    expect(await rowsOf(page, 'Commandes')).toEqual(orders);

    // Cascade Delete Related Records turned on in the relationship
    await openRelations(page, fr);
    await page.getByTestId('rel-line-ClientsCommandes').dblclick();
    await expect(page.getByTestId('relation-enforce')).toBeChecked();
    await page.getByTestId('relation-cascadeDelete').check();
    await page.getByTestId('relation-ok').click();
    await expect(page.getByTestId('relation-dialog')).toHaveCount(0);
    await page.getByTestId('cmd-closeRelationships').click();

    // the deletion now announces the related records, then deletes them with the customer
    await page.getByTestId('doc-tab-Clients').click();
    await clickCell(page, 'Clients', 1, 0);
    await page.getByTestId('ribbon-tab-home').click();
    await page.getByTestId('cmd-deleteRecord').click();
    await expect(page.getByTestId('modal')).toContainText(fr.datasheet.deleteCascade_one);
    await page.getByTestId('modal-btn-yes').click();
    await expect(page.getByTestId('modal')).toHaveCount(0);
    await expect(count(page)).toHaveText('1');
    expect(await rowsOf(page, 'Clients')).toEqual([[2, 'Martin', 'Nantes']]);
    orders.shift();
    expect(await rowsOf(page, 'Commandes')).toEqual(orders);

    // 5. Commandes: filter by selection on Martin, then Montant > 100 typed in French, then no filter
    await page.getByTestId('doc-tab-Commandes').click();
    await expect(count(page)).toHaveText('2'); // the deleted order left the open datasheet
    await expect(cell(page, 0, 0)).toHaveText('2'); // not the deleted order N° 1 still shown
    await expect(view(page).getByTestId('nav-filtered')).toBeDisabled();
    await clickCell(page, 'Commandes', 1, 0);
    await expect(cell(page, 1, 0)).toBeFocused();
    await page.getByTestId('cmd-filterSelection').click();
    await expect(page.getByTestId('filter-menu-equals')).toContainText('Martin');
    await page.getByTestId('filter-menu-equals').click();
    await expect(view(page).getByTestId('nav-filtered')).toHaveAttribute('aria-pressed', 'true');
    await expect(view(page).getByTestId('nav-filtered')).toContainText(fr.datasheet.nav.filter.on);
    await expect(count(page)).toHaveText('2');
    await clickCell(page, 'Commandes', 2, 0);
    await expect(cell(page, 2, 0)).toBeFocused();
    await page.getByTestId('cmd-filter').click();
    await page.getByTestId('xb-text').fill('> 100 Et Pas Null');
    await page.getByTestId('xb-ok').click();
    await expect(page.getByTestId('modal')).toHaveCount(0);
    await expect(count(page)).toHaveText('1'); // Martin's orders: 150 and none
    await expect(cell(page, 0, 0)).toHaveText('2');
    await expect(view(page).getByTestId('nav-filtered')).toHaveAttribute('aria-pressed', 'true');
    await page.getByTestId('cmd-filterAdvanced').click();
    await page.getByTestId('filter-menu-clear').click();
    await expect(count(page)).toHaveText('2');
    await expect(view(page).getByTestId('nav-filtered')).toBeDisabled();
  } finally {
    // 6. close
    await app.close();
  }

  // 6. reopened with the interface in English: the rule in its display form, the relationship and the data intact
  writeFileSync(join(userDataDir, 'settings.json'), JSON.stringify({ locale: 'en' }));
  ({ app, page } = await launchApp({ args: [base], env, userDataDir }));
  try {
    await expect(page.getByTestId('ribbon-tab-create')).toHaveText(en.ribbon.tab.create);
    await page.getByTestId('nav-item-Commandes').click({ button: 'right' });
    await page.getByTestId('nav-menu-design').click();
    await page.getByTestId('design-row-2-name').click();
    await expect(page.getByTestId('prop-validationRule')).toHaveValue('> 0');
    await expect(page.getByTestId('prop-validationText')).toHaveValue('Montant positif');
    await expect(page.getByTestId('prop-format')).toHaveValue(en.format.standard);
    await page.getByTestId('design-row-3-name').click();
    await expect(page.getByTestId('prop-defaultValue')).toHaveValue('Date()');
    await page.getByTestId('design-row-4-name').click();
    await expect(page.getByTestId('prop-inputMask')).toHaveValue('00 00 00 00 00');

    await openRelations(page, en);
    await expect(page.getByTestId('rel-line-ClientsCommandes-many')).toHaveText('∞');
    await expect(page.getByTestId('relations-list')).toContainText(fill(en.relations.line_enforced, { parent: 'Clients', parentFields: 'N°', child: 'Commandes', childFields: 'Client' }));
    const relations = await page.evaluate(() => (window as any).basecraft.relations.list());
    expect(relations).toEqual([expect.objectContaining({ name: 'ClientsCommandes', parentTable: 'Clients', parentFields: ['N°'], childTable: 'Commandes',
      childFields: ['Client'], enforce: true, cascadeUpdate: false, cascadeDelete: true })]);

    expect(await rowsOf(page, 'Clients')).toEqual([[2, 'Martin', 'Nantes']]);
    expect(await rowsOf(page, 'Commandes')).toEqual([[2, 2, 150, todayStored, null], [3, 2, null, todayStored, '0712345678']]);
    await openDatasheet(page, 'Commandes');
    await expect(count(page)).toHaveText('2');
    await expect(cell(page, 1, 0)).toHaveText('Martin');
  } finally {
    await app.close();
  }
});
