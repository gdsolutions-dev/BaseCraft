// Recette du lot C1 (fichiers liés) : une base frontale lie les tables d'un fichier de données BaseCraft, les lit et les modifie
// par une feuille de données, un formulaire et son sous-formulaire, une requête paramétrée ; une requête sur deux sources est
// refusée ; le fichier de données déplacé est retrouvé par le Gestionnaire de tables liées ; BaseCraft Runtime ouvre la frontale.
import { test, expect, type Page } from '@playwright/test';
import { copyFileSync, mkdirSync, readFileSync, realpathSync, renameSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { createTable } from '../../src/main/db/schema';
import { seedSales, seedSalesRelation } from '../../src/main/query/test-db';
import type { BasecraftApi } from '../../src/shared/api';
import type { ControlDef, DesignDoc } from '../../src/shared/design/model';
import { f, t } from '../../src/shared/test-fixtures';
import { formGrid, inFile, launchApp, seedBase, seedForm } from './helpers';

type Win = { basecraft: BasecraftApi };
const fr = JSON.parse(readFileSync(join(__dirname, '../../src/shared/i18n/fr.json'), 'utf8'));
const FR = { BASECRAFT_REGION: 'fr-FR' };
// DatasheetView: row selector width, header and row heights.
const MARKER = 44, HEADER = 34, ROW = 30;
const NBSP = ' ';

/** The shown document (every tab stays mounted, hidden). */
const doc = (page: Page) => page.locator('section[role=tabpanel]:not([hidden])');
const cell = (page: Page, col: number, row: number) => doc(page).getByTestId(`glide-cell-${col + 1}-${row}`);
/** The accessible texts of the shown datasheet's rows (the edit texts: exact numbers, the region's separators). */
async function shown(page: Page, rows: number, cols: number): Promise<string[][]> {
  await expect(doc(page).getByTestId('nav-record-count')).toHaveText(String(rows));
  const out: string[][] = [];
  for (let r = 0; r < rows; r++) {
    const row: string[] = [];
    for (let c = 0; c < cols; c++) row.push((await cell(page, c, r).textContent()) ?? '');
    out.push(row);
  }
  return out;
}
/** The text the shown datasheet's cell paints, in its field's format (Currency « 0,20 € »), as Home › Selection quotes it (recette-a3);
 *  `left`: the column's left edge in px. The menu is closed again. */
async function painted(page: Page, left: number, row: number): Promise<string> {
  await page.getByTestId('ribbon-tab-home').click();
  const b = (await doc(page).getByTestId('datasheet').getByTestId('data-grid-canvas').boundingBox())!;
  await page.mouse.click(b.x + MARKER + left + 30, b.y + HEADER + row * ROW + ROW / 2);
  await expect(doc(page).getByTestId('datasheet').locator('td[role=gridcell]:focus')).toHaveCount(1);
  await page.getByTestId('cmd-filterSelection').click();
  const text = (await page.getByTestId('filter-menu-equals').textContent()) ?? '';
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('filter-menu')).toHaveCount(0);
  return /"(.*)"/s.exec(text)?.[1] ?? text;
}
async function openSheet(page: Page, name: string) {
  await page.getByTestId(`nav-item-${name}`).dblclick();
  await expect(doc(page).getByTestId('datasheet').getByTestId('data-grid-canvas')).toBeVisible();
}
/** QParVille's rows for « Lyon », computed from the data file (Ville compared without case, as Access): Nom and Montant in the
 *  region's text, sorted. */
const lyonFromFile = (path: string) => inFile<{ Nom: string; Montant: number }>(path,
  `SELECT c."Nom", o."Montant" FROM "Clients" c JOIN "Commandes" o ON c."N°" = o."Client" WHERE lower(c."Ville") = 'lyon'`)
  .map((r) => [r.Nom, String(r.Montant).replace('.', ',')]).sort();
const queries = (page: Page) => page.evaluate(() => (window as unknown as Win).basecraft.objects.list('query').then((l) => l.map((o) => o.name)));

/** Runs QParVille from the Navigation Pane with « Lyon »: its rows, sorted. */
async function runParVille(page: Page): Promise<string[][]> {
  await page.getByTestId('nav-item-query-QParVille').dblclick();
  await expect(page.getByTestId('modal')).toContainText('Quelle ville ?');
  await page.getByTestId('modal-input').fill('Lyon');
  await page.getByTestId('modal-btn-ok').click();
  await expect(page.getByTestId('modal')).toHaveCount(0);
  await expect(page.getByTestId('doc-tab-query-QParVille')).toHaveAttribute('aria-selected', 'true');
  const rows = (await shown(page, 5, 2)).sort();
  await page.getByTestId('doc-tab-close-query-QParVille').click();
  return rows;
}

// FClientsCommandes: Nom and Ville of Clients, the subform FCommandesSub (N° and Montant of Commandes, a datasheet) linked on
// N° → Client. Saved in the front-end before Clients and Commandes are linked, as a designer preparing a front-end does.
const box = (kind: ControlDef['kind'], name: string, left: number, top: number, props: Record<string, unknown>, width = 1500, height = 340): ControlDef =>
  ({ kind, name, left, top, width, height, props });
const formOf = (table: string, detail: ControlDef[], props: Record<string, unknown> = {}): DesignDoc => ({
  formatVersion: '1.0', recordSource: { kind: 'table', name: table }, props: { Width: 9000, ...props },
  sections: [
    { kind: 'formHeader', height: 0, props: { Visible: false }, controls: [] },
    { kind: 'detail', height: 4000, props: {}, controls: detail },
    { kind: 'formFooter', height: 0, props: { Visible: false }, controls: [] },
  ],
});
const SUB = formOf('Commandes', [box('textBox', 'N°', 100, 100, { ControlSource: 'N°', TabIndex: 0 }), box('textBox', 'Montant', 1800, 100, { ControlSource: 'Montant', TabIndex: 1 })],
  { DefaultView: 'datasheet' });
const MAIN = formOf('Clients', [
  box('textBox', 'Nom', 100, 100, { ControlSource: 'Nom', TabIndex: 0 }), box('textBox', 'Ville', 1800, 100, { ControlSource: 'Ville', TabIndex: 1 }),
  box('subform', 'Commandes', 100, 1000, { SourceObject: 'FCommandesSub', LinkMasterFields: 'N°', LinkChildFields: 'Client', TabIndex: 2 }, 4000, 2800),
]);

/** FClientsCommandes opened on Martin (the second client): the master's Nom and the subform's grid (N° and Montant, 100 px each). */
async function martin(page: Page) {
  await page.getByTestId('nav-item-form-FClientsCommandes').dblclick();
  const nom = page.getByTestId('form-ctl-Nom');
  await expect(nom).toHaveValue('Dupont');
  await page.getByTestId('form-run').first().locator(':scope > .recnav').getByRole('button', { name: fr.datasheet.nav.next }).click();
  await expect(nom).toHaveValue('Martin');
  return { nom, s: formGrid(page, page.getByTestId('form-ctl-Commandes'), [100, 100]) };
}

test('recette C1: a front-end links a BaseCraft data file — datasheet, form and subform, parameter query, one source per query, a moved file relinked, the Runtime', async () => {
  test.setTimeout(240_000); // three launches
  const front = seedBase('Ventes', (db) => {
    createTable(db, t('Notes', [f('N°', 'autoNumber'), f('Texte', 'shortText')]));
    seedForm(db, 'FCommandesSub', SUB);
    seedForm(db, 'FClientsCommandes', MAIN);
  });
  const dir = dirname(front); // one trusted temp folder: the front-end and its data file
  const data = join(dir, 'Ventes-donnees.basecraft');
  copyFileSync(seedBase('Ventes-donnees', (db) => { seedSales(db); seedSalesRelation(db); }), data);
  const commandes = () => inFile<{ Client: number; Montant: number }>(data, 'SELECT "Client", "Montant" FROM "Commandes" ORDER BY "N°"');

  let { app, page } = await launchApp({ args: [front], env: { ...FR, BASECRAFT_E2E_LINK_PATH: data } });
  try {
    // 1. External Data › BaseCraft or SQLite Database: Clients and Commandes linked, shown with the link icon
    await expect(page.getByTestId('ribbon-tab-externalData')).toBeVisible(); // the full app's tab, absent from the Runtime (step 8)
    await page.getByTestId('ribbon-tab-externalData').click();
    await page.getByTestId('cmd-linkBaseCraft').click();
    await expect(page.getByTestId('link-dialog')).toBeVisible();
    await expect(page.getByTestId('link-kind')).toHaveText(fr.link.kind.basecraft);
    await page.getByTestId('link-table-Clients').check();
    await page.getByTestId('link-table-Commandes').check();
    await page.getByTestId('link-ok').click();
    await expect(page.getByTestId('link-dialog')).toHaveCount(0);
    await expect(page.getByTestId('nav-item-link-Clients')).toBeVisible();
    await expect(page.getByTestId('nav-item-link-Commandes')).toBeVisible();
    await expect(page.getByTestId('nav-item-link-Notes')).toHaveCount(0);

    // 2. the Clients datasheet: the file's 4 records; Durand's Ville → « Marseille », read back from the data file
    await openSheet(page, 'Clients');
    await expect(page.getByTestId('nav-record-count')).toHaveText('4');
    await expect(cell(page, 1, 2)).toHaveText('Durand');
    const b = (await doc(page).getByTestId('datasheet').getByTestId('data-grid-canvas').boundingBox())!;
    await page.mouse.click(b.x + MARKER + 20, b.y + HEADER + 2 * ROW + ROW / 2);
    await expect(cell(page, 0, 2)).toBeFocused();
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowRight');
    await expect(cell(page, 2, 2)).toBeFocused();
    await page.keyboard.press('M');
    await expect(page.getByTestId('grid-editor-portal').locator('textarea')).toBeFocused();
    await page.keyboard.type('arseille');
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('grid-editor-portal').locator('textarea')).toHaveCount(0);
    await expect(page.getByTestId('doc-tab-Clients')).not.toContainText('•');
    await expect.poll(() => inFile(data, `SELECT "Ville" FROM "Clients" WHERE "Nom" = 'Durand'`)).toEqual([{ Ville: 'Marseille' }]);
    await page.getByTestId('doc-tab-close-Clients').click();
    // the linked Montant paints in the data file's Currency format: Martin's first order (row 2; Montant's left edge 190 px)
    await openSheet(page, 'Commandes');
    expect(await painted(page, 190, 2)).toBe(`0,20${NBSP}€`);
    await page.getByTestId('doc-tab-close-Commandes').click();

    // 3. FClientsCommandes on Martin: his 2 orders in the subform; a new one of 5 is saved to the data file as (2, 5)
    const { nom, s } = await martin(page);
    await expect(s.count).toHaveText('2');
    await expect(s.cell(1, 0)).toHaveText('0,2');
    await expect(s.cell(1, 1)).toHaveText('0,1');
    await s.click(1, 2);
    await s.type('5');
    await nom.click(); // leaving the subform saves its row
    await expect.poll(() => commandes().length).toBe(6);
    expect(commandes().at(-1)).toEqual({ Client: 2, Montant: 5 });
    await expect(s.count).toHaveText('3');

    // 4. a new order of 0: refused with the data file's rule, nothing written
    await s.click(1, 3);
    await s.type('0');
    await nom.click();
    await expect(page.getByTestId('modal')).toContainText(`« Montant » : ${fr.fieldError.validation.replace('{{rule}}', '> 0')}`); // the data file's rule
    await page.getByTestId('modal-btn-ok').click();
    await page.keyboard.press('Escape');
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('doc-tab-form-FClientsCommandes')).not.toContainText('•');
    expect(commandes()).toHaveLength(6);
    await page.getByTestId('doc-tab-close-form-FClientsCommandes').click();

    // 5. Create › Query Design › SQL view: the parameter query over both links, saved, run with « Lyon »: the data file's 5 rows
    await page.getByTestId('ribbon-tab-create').click();
    await page.getByTestId('cmd-createQueryDesign').click();
    await page.getByTestId('show-table-close').click();
    await page.getByTestId('status-view-sql').click();
    await doc(page).getByTestId('query-sql')
      .fill('SELECT Clients.Nom, Commandes.Montant FROM Clients INNER JOIN Commandes ON Clients.[N°] = Commandes.Client WHERE Clients.Ville = [Quelle ville ?];');
    await page.keyboard.press('Control+s');
    await page.getByTestId('modal-input').fill('QParVille');
    await page.getByTestId('modal-btn-ok').click();
    await expect(page.getByTestId('nav-item-query-QParVille')).toBeVisible();
    await page.getByTestId('doc-tab-close-query-QParVille').click();
    const lyon = [['Dupont', '0,1'], ['Dupont', '10,1'], ['Martin', '0,1'], ['Martin', '0,2'], ['Martin', '5']];
    expect(lyonFromFile(data)).toEqual(lyon);
    expect(await runParVille(page)).toEqual(lyon);

    // 6. a query over a local table and a link: refused at save, with its reason; not saved
    await page.getByTestId('ribbon-tab-create').click();
    await page.getByTestId('cmd-createQueryDesign').click();
    await page.getByTestId('show-table-close').click();
    await page.getByTestId('status-view-sql').click();
    await doc(page).getByTestId('query-sql').fill('SELECT Notes.Texte, Clients.Nom FROM Notes, Clients;');
    await page.keyboard.press('Control+s');
    await page.getByTestId('modal-input').fill('QMelange');
    await page.getByTestId('modal-btn-ok').click();
    await expect(page.getByTestId('modal')).toContainText(fr.dialog.error.queryBind_mixedSources.replace('{{detail}}', 'Clients'));
    await page.getByTestId('modal-btn-ok').click();
    await expect(page.getByTestId('modal')).toHaveCount(0);
    expect(await queries(page)).toEqual(['QParVille']);
  } finally {
    await app.close();
  }

  // 7. the data file moved into archive/: Clients names it missing; the manager's Change Source finds it, and everything works again
  mkdirSync(join(dir, 'archive'));
  const moved = join(dir, 'archive', 'Ventes-donnees.basecraft');
  const oldPath = realpathSync.native(data);
  renameSync(data, moved);
  ({ app, page } = await launchApp({ args: [front], env: { ...FR, BASECRAFT_E2E_LINK_PATH: moved } }));
  try {
    await page.getByTestId('nav-item-Clients').dblclick();
    await expect(page.getByTestId('modal')).toContainText(fr.dialog.error.linkUnavailable_missingFile.replace('{{detail}}', oldPath));
    await page.getByTestId('modal-btn-ok').click();
    await expect(page.getByTestId('modal')).toHaveCount(0);

    await page.getByTestId('ribbon-tab-externalData').click();
    await page.getByTestId('cmd-linkedTableManager').click();
    await expect(page.getByTestId('ltm-dialog')).toBeVisible();
    await page.getByTestId('ltm-select-all').click();
    await page.getByTestId('ltm-relink').click();
    for (const n of ['Clients', 'Commandes']) {
      await expect(page.getByTestId(`ltm-state-${n}`)).toHaveText(fr.ltm.state.ok);
      await expect(page.getByTestId(`ltm-path-${n}`)).toHaveText(realpathSync.native(moved));
    }
    await page.getByTestId('ltm-close').click();
    await expect(page.getByTestId('ltm-dialog')).toHaveCount(0);

    await openSheet(page, 'Clients');
    await expect(page.getByTestId('nav-record-count')).toHaveText('4');
    await expect(cell(page, 2, 2)).toHaveText('Marseille');
    await page.getByTestId('doc-tab-close-Clients').click();
    expect(await runParVille(page)).toEqual(lyonFromFile(moved));
    const { s } = await martin(page);
    await expect(s.count).toHaveText('3');
    await expect(s.cell(1, 2)).toHaveText('5');
  } finally {
    await app.close();
  }

  // 8. BaseCraft Runtime opens the front-end: the form works on the links, Refresh Link answers, no Linked Table Manager
  ({ app, page } = await launchApp({ runtime: true, args: [front], env: FR }));
  try {
    const { s } = await martin(page);
    await expect(s.count).toHaveText('3');
    await expect(s.cell(1, 0)).toHaveText('0,2');
    await page.getByTestId('nav-item-Clients').click({ button: 'right' });
    await expect(page.getByTestId('nav-menu-linkedTableManager')).toHaveCount(0);
    await page.getByTestId('nav-menu-refreshLink').click();
    await expect(page.getByTestId('modal')).toContainText(fr.link.refreshed);
    await page.getByTestId('modal-btn-ok').click();
    await expect(page.getByTestId('ribbon-tab-externalData')).toHaveCount(0); // no External Data tab, so no ribbon Linked Table Manager
  } finally {
    await app.close();
  }
});
