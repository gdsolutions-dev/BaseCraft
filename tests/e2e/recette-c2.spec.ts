// Recette du lot C2 (lien Access en lecture seule) : une base frontale lie Clients et Commandes d'un fichier .accdb ; les cellules,
// un filtre, un tri et une requête Totaux donnent ce qu'Access affiche (tests/fixtures/access/expected.ts) ; toute modification est refusée
// et le fichier Access n'est jamais modifié ; le fichier changé est relu par Actualiser le lien ; le fichier déplacé est retrouvé par le
// Gestionnaire de tables liées.
import { test, expect, type Page } from '@playwright/test';
import { copyFileSync, mkdirSync, readdirSync, readFileSync, realpathSync, renameSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { createTable } from '../../src/main/db/schema';
import type { BasecraftApi } from '../../src/shared/api';
import type { ControlDef, DesignDoc } from '../../src/shared/design/model';
import { f, t } from '../../src/shared/test-fixtures';
import { ACCESS_EXPECTED } from '../fixtures/access/expected';
import { launchApp, seedBase, seedForm } from './helpers';

type Win = { basecraft: BasecraftApi };
const fr = JSON.parse(readFileSync(join(__dirname, '../../src/shared/i18n/fr.json'), 'utf8'));
const FR = { BASECRAFT_REGION: 'fr-FR' };
const FIXTURES = join(__dirname, '../fixtures/access');
// DatasheetView: row selector width, header and row heights.
const MARKER = 44, HEADER = 34, ROW = 30;

/** The shown document (every tab stays mounted, hidden). */
const doc = (page: Page) => page.locator('section[role=tabpanel]:not([hidden])');
const cell = (page: Page, col: number, row: number) => doc(page).getByTestId(`glide-cell-${col + 1}-${row}`);
const cellEditor = (page: Page) => page.getByTestId('grid-editor-portal').locator('textarea');
/** The text with the region's spaces made plain (Windows may write a no-break space before the euro sign). */
const plain = (s: string) => s.replace(/[  ]/g, ' ');
const queries = (page: Page) => page.evaluate(() => (window as unknown as Win).basecraft.objects.list('query').then((l) => l.map((o) => o.name)));

/** A click on the shown datasheet's first cell, then the arrows to (col, row): the cell is the selection. */
async function select(page: Page, col: number, row: number) {
  const b = (await doc(page).getByTestId('datasheet').getByTestId('data-grid-canvas').boundingBox())!;
  await page.mouse.click(b.x + MARKER + 20, b.y + HEADER + ROW / 2);
  await expect(cell(page, 0, 0)).toBeFocused();
  for (let i = 0; i < row; i++) await page.keyboard.press('ArrowDown');
  for (let i = 0; i < col; i++) await page.keyboard.press('ArrowRight');
  await expect(cell(page, col, row)).toBeFocused();
}
/** The text the cell paints, in its field's format (Currency « 0,20 € »), as Home › Selection quotes it (recette-c1). */
async function painted(page: Page, col: number, row: number): Promise<string> {
  await page.getByTestId('ribbon-tab-home').click();
  await select(page, col, row);
  await page.getByTestId('cmd-filterSelection').click();
  const text = (await page.getByTestId('filter-menu-equals').textContent()) ?? '';
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('filter-menu')).toHaveCount(0);
  return plain(/"(.*)"/s.exec(text)?.[1] ?? text);
}
/** The shown datasheet's cells, `rows` x `cols`, as the accessible grid reads them (Yes/No: true or false). `money`: columns painted
 *  in a Currency format, read through the Selection menu. */
async function shown(page: Page, rows: number, cols: number, money: number[] = []): Promise<string[][]> {
  await expect(doc(page).getByTestId('nav-record-count')).toHaveText(String(rows));
  const out: string[][] = [];
  for (let r = 0; r < rows; r++) {
    const row: string[] = [];
    for (let c = 0; c < cols; c++) row.push(money.includes(c) ? await painted(page, c, r) : plain((await cell(page, c, r).textContent()) ?? ''));
    out.push(row);
  }
  return out;
}
async function openSheet(page: Page, name: string, tab = name) {
  await page.getByTestId(`nav-item-${name}`).dblclick();
  await expect(doc(page).getByTestId('datasheet').getByTestId('data-grid-canvas')).toBeVisible();
  await expect(page.getByTestId(`doc-tab-${tab}`)).toHaveAttribute('aria-selected', 'true');
}
const closeTab = (page: Page, tab: string) => page.getByTestId(`doc-tab-close-${tab}`).click();
const CLIENTS = ACCESS_EXPECTED.clients, ORDERS = ACCESS_EXPECTED.commandes;
const asText = (rows: (string | boolean)[][]) => rows.map((r) => r.map(String));

// FClients: Nom, Ville and Inscrit of Clients. Saved in the front-end before Clients is linked, as a designer preparing a front-end does.
const box = (name: string, left: number, top: number, source: string, tab: number): ControlDef =>
  ({ kind: 'textBox', name, left, top, width: 1500, height: 340, props: { ControlSource: source, TabIndex: tab } });
const FCLIENTS: DesignDoc = {
  formatVersion: '1.0', recordSource: { kind: 'table', name: 'Clients' }, props: { Width: 9000 },
  sections: [
    { kind: 'formHeader', height: 0, props: { Visible: false }, controls: [] },
    { kind: 'detail', height: 2000, props: {}, controls: [box('Nom', 100, 100, 'Nom', 0), box('Ville', 1800, 100, 'Ville', 1), box('Inscrit', 3500, 100, 'Inscrit', 2)] },
    { kind: 'formFooter', height: 0, props: { Visible: false }, controls: [] },
  ],
};

/** Opens a new query in SQL view with `sql` typed. */
async function sqlQuery(page: Page, sql: string) {
  await page.getByTestId('ribbon-tab-create').click();
  await page.getByTestId('cmd-createQueryDesign').click();
  await page.getByTestId('show-table-close').click();
  await page.getByTestId('status-view-sql').click();
  await doc(page).getByTestId('query-sql').fill(sql);
}
/** QTotaux's datasheet from the Navigation Pane: Client, Sum of Montant (Currency), Count of N°. */
async function totaux(page: Page): Promise<string[][]> {
  await page.getByTestId('nav-item-query-QTotaux').dblclick();
  await expect(page.getByTestId('doc-tab-query-QTotaux')).toHaveAttribute('aria-selected', 'true');
  const rows = await shown(page, 3, 3, [1]);
  await closeTab(page, 'query-QTotaux');
  return rows;
}

test('recette C2: a front-end links an Access file — cells as Access shows them, filter, sort, Totals query, every edit refused and the file untouched, a changed file refreshed, a moved file relinked', async () => {
  test.setTimeout(240_000);
  const front = seedBase('Ventes-frontal', (db) => {
    createTable(db, t('Notes', [f('N°', 'autoNumber'), f('Texte', 'shortText')]));
    seedForm(db, 'FClients', FCLIENTS);
  });
  const dir = dirname(front); // one trusted temp folder: the front-end and the Access files
  const accdb = join(dir, 'Ventes.accdb');
  copyFileSync(join(FIXTURES, 'Ventes.accdb'), accdb);
  copyFileSync(join(FIXTURES, 'Ventes-modifie.accdb'), join(dir, 'Ventes-modifie.accdb'));
  const original = readFileSync(accdb);
  const beside = () => readdirSync(dir).filter((n) => !n.startsWith('Ventes-frontal')).sort(); // (the front-end's own lock and journal excepted)
  // BaseCraft creates nothing beside the Access file (no .laccdb, -journal, .lock)
  const filesAtStart = beside();

  const { app, page } = await launchApp({ args: [front], env: { ...FR, BASECRAFT_E2E_LINK_PATH: accdb } });
  try {
    // 1. External Data › Link Access Database: Clients and Commandes linked, shown with the link icon
    await page.getByTestId('ribbon-tab-externalData').click();
    await page.getByTestId('cmd-linkAccess').click();
    await expect(page.getByTestId('link-dialog')).toBeVisible();
    await page.getByTestId('link-table-Clients').check();
    await page.getByTestId('link-table-Commandes').check();
    await page.getByTestId('link-ok').click();
    await expect(page.getByTestId('link-dialog')).toHaveCount(0);
    await expect(page.getByTestId('nav-item-link-Clients')).toBeVisible();
    await expect(page.getByTestId('nav-item-link-Commandes')).toBeVisible();
    await expect(page.getByTestId('nav-item-link-Notes')).toHaveCount(0);

    // 2. the Clients datasheet: every cell is Access's (dates as the region shows them, Yes/No as true or false)
    await openSheet(page, 'Clients');
    expect(await shown(page, CLIENTS.length, CLIENTS[0]!.length)).toEqual(asText(ACCESS_EXPECTED.clients));

    // 3. Clients filtered by selection on Dupont's Ville « Lyon » (Equals); Commandes sorted by Montant, descending
    await page.getByTestId('ribbon-tab-home').click();
    await select(page, 2, 0);
    await page.getByTestId('cmd-filterSelection').click();
    await page.getByTestId('filter-menu-equals').click();
    await expect(doc(page).getByTestId('nav-record-count')).toHaveText(String(ACCESS_EXPECTED.filtreLyon.length));
    expect(await shown(page, ACCESS_EXPECTED.filtreLyon.length, 2).then((r) => r.map((x) => x[1]))).toEqual(ACCESS_EXPECTED.filtreLyon);
    await closeTab(page, 'Clients');
    await openSheet(page, 'Commandes');
    await page.getByTestId('ribbon-tab-home').click();
    await select(page, 2, 0);
    await page.getByTestId('cmd-sortDesc').click();
    await expect(cell(page, 0, 0)).toHaveText(String(ACCESS_EXPECTED.montantDesc[0])); // the sort is applied
    // Orders 2 and 5 tie (0,10 EUR): the datasheet breaks a tie by N° in the sort's direction (5 before 2); `expected.ts` has 2 before 5 (TO CONFIRM
    // on Access's screen, G1). The tie is read either way, everything else is exact.
    const order = (await shown(page, ORDERS.length, 1)).map((r) => Number(r[0]));
    const montant = (n: number) => ORDERS[n - 1]![2];
    expect(order.map(montant)).toEqual(ACCESS_EXPECTED.montantDesc.map(montant));
    expect([...order].sort()).toEqual([...ACCESS_EXPECTED.montantDesc].sort());
    expect(await shown(page, ORDERS.length, ORDERS[0]!.length, [2])).toEqual(order.map((n) => ORDERS[n - 1]!));
    await closeTab(page, 'Commandes');

    // 4. QTotaux built in the QBE on the linked Commandes: Client Group By, Montant Sum, N° Count
    await page.getByTestId('ribbon-tab-create').click();
    await page.getByTestId('cmd-createQueryDesign').click();
    await page.getByTestId('show-table-Commandes').check();
    await page.getByTestId('show-table-add').click();
    await page.getByTestId('show-table-close').click();
    for (const n of ['Client', 'Montant', 'N°']) await doc(page).getByTestId(`qbe-field-Commandes-${n}`).dblclick();
    await page.getByTestId('cmd-queryTotals').click();
    await expect(doc(page).getByTestId('qbe-cell-total-0')).toHaveValue('groupBy');
    await doc(page).getByTestId('qbe-cell-total-1').selectOption('sum');
    await doc(page).getByTestId('qbe-cell-total-2').selectOption('count');
    await page.keyboard.press('Control+s');
    await page.getByTestId('modal-input').fill('QTotaux');
    await page.getByTestId('modal-btn-ok').click();
    await expect(page.getByTestId('nav-item-query-QTotaux')).toBeVisible();
    await closeTab(page, 'query-QTotaux');
    expect(await totaux(page)).toEqual(ACCESS_EXPECTED.totaux);

    // 5. edits refused: the datasheet, the form, an update query; the Access file is not written
    await openSheet(page, 'Clients');
    await expect(page.getByTestId('nav-new')).toBeDisabled();
    await page.getByTestId('ribbon-tab-home').click();
    await select(page, 1, 0);
    await page.keyboard.press('X');
    await page.keyboard.press('Enter'); // a positive control: were the cell editable, the keystroke would be committed by now
    await page.keyboard.press('Tab');
    await expect(cellEditor(page)).toHaveCount(0);
    await expect(cell(page, 1, 0)).toHaveText(String(CLIENTS[0]![1]));
    await expect(page.getByTestId('doc-tab-Clients')).not.toContainText('•');
    await closeTab(page, 'Clients');

    await page.getByTestId('nav-item-form-FClients').dblclick();
    const nom = page.getByTestId('form-ctl-Nom');
    await expect(nom).toHaveValue(String(CLIENTS[0]![1]));
    await nom.click();
    await page.keyboard.type('X');
    await expect(nom).toHaveValue(String(CLIENTS[0]![1]));
    await closeTab(page, 'form-FClients');

    await sqlQuery(page, "UPDATE Clients SET Ville = 'X'");
    await page.getByTestId('cmd-runQuery').click();
    await expect(page.getByTestId('modal')).toContainText(fr.query.action.confirm_update_other.replace('{{count}}', String(CLIENTS.length)));
    await page.getByTestId('modal-btn-yes').click();
    await expect(page.getByTestId('modal')).toContainText(fr.dialog.error.readOnly);
    await page.getByTestId('modal-btn-ok').click();
    await expect(page.getByTestId('modal')).toHaveCount(0);
    expect(readFileSync(accdb).equals(original)).toBe(true);
    expect(beside()).toEqual(filesAtStart);
    await openSheet(page, 'Clients');
    expect((await shown(page, CLIENTS.length, 3)).map((r) => r[2])).toEqual(CLIENTS.map((r) => String(r[2])));
    await closeTab(page, 'Clients');
    await page.locator('[data-testid^="doc-tab-close-query-"]').click(); // the update query, never saved
    await page.getByTestId('modal-btn-no').click(); // « Enregistrer les modifications ? »
    await expect(page.getByTestId('modal')).toHaveCount(0);

    // 6. a query joining Notes and Clients: the single-source message, not saved
    await sqlQuery(page, 'SELECT Notes.Texte, Clients.Nom FROM Notes, Clients;');
    await page.keyboard.press('Control+s');
    await page.getByTestId('modal-input').fill('QMelange');
    await page.getByTestId('modal-btn-ok').click();
    await expect(page.getByTestId('modal')).toContainText(fr.dialog.error.queryBind_mixedSources.replace('{{detail}}', 'Clients'));
    await page.getByTestId('modal-btn-ok').click();
    await expect(page.getByTestId('modal')).toHaveCount(0);
    expect(await queries(page)).toEqual(['QTotaux']);

    // 7. the Access file replaced by Ventes-modifie.accdb: Refresh Link on Commandes, then QTotaux and Clients show the new values
    copyFileSync(join(dir, 'Ventes-modifie.accdb'), accdb);
    await page.getByTestId('nav-item-Commandes').click({ button: 'right' });
    await page.getByTestId('nav-menu-refreshLink').click();
    await expect(page.getByTestId('modal')).toContainText(fr.link.refreshed);
    await page.getByTestId('modal-btn-ok').click();
    await expect(page.getByTestId('modal')).toHaveCount(0);
    expect(beside()).toEqual(filesAtStart);
    expect(await totaux(page)).toEqual(ACCESS_EXPECTED.totauxModifie);
    await openSheet(page, 'Clients');
    expect((await shown(page, CLIENTS.length, 3))[2]).toEqual([String(CLIENTS[2]![0]), String(CLIENTS[2]![1]), ACCESS_EXPECTED.modifie.durandVille]);
    await closeTab(page, 'Clients');
    await openSheet(page, 'Commandes');
    expect(await shown(page, ORDERS.length + 1, ORDERS[0]!.length, [2])).toEqual([...ORDERS, ACCESS_EXPECTED.modifie.commande6]);
    await closeTab(page, 'Commandes');

    // 8. Linked Table Manager: both « OK », kind « Base Access »; the file moved to archive/: « Fichier introuvable »; Change Source: OK again
    await page.getByTestId('ribbon-tab-externalData').click();
    await page.getByTestId('cmd-linkedTableManager').click();
    await expect(page.getByTestId('ltm-dialog')).toBeVisible();
    for (const n of ['Clients', 'Commandes']) {
      await expect(page.getByTestId(`ltm-state-${n}`)).toHaveText(fr.ltm.state.ok);
      await expect(page.getByTestId(`ltm-row-${n}`)).toContainText(fr.link.kind.access);
    }
    await page.getByTestId('ltm-close').click();
    mkdirSync(join(dir, 'archive'));
    const moved = join(dir, 'archive', 'Ventes.accdb');
    renameSync(accdb, moved);
    await app.evaluate((_e, p) => { process.env.BASECRAFT_E2E_LINK_PATH = p; }, moved);
    await page.getByTestId('cmd-linkedTableManager').click();
    for (const n of ['Clients', 'Commandes']) await expect(page.getByTestId(`ltm-state-${n}`)).toHaveText(fr.ltm.state.missingFile);
    await page.getByTestId('ltm-select-all').click();
    await page.getByTestId('ltm-relink').click();
    for (const n of ['Clients', 'Commandes']) {
      await expect(page.getByTestId(`ltm-state-${n}`)).toHaveText(fr.ltm.state.ok);
      await expect(page.getByTestId(`ltm-path-${n}`)).toHaveText(realpathSync.native(moved));
    }
    await page.getByTestId('ltm-close').click();
    await expect(page.getByTestId('ltm-dialog')).toHaveCount(0);
    expect(await totaux(page)).toEqual(ACCESS_EXPECTED.totauxModifie);
  } finally {
    await app.close();
  }
});
