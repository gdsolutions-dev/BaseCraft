// Recette du lot B4 (jointures et analyse croisée), région fr-FR : une requête Clients ⋈ Commandes construite dans la grille, un
// formulaire instantané dessus — AutoLookup du client, Nom écrit chez le client, clé du côté « un » en lecture seule, client
// inexistant refusé ; la feuille de données de la requête (les autres commandes du client relues) ; une analyse croisée des ventes
// par client et par mois égale aux sommes calculées par le test, encore après réouverture ; un formulaire sur une analyse croisée
// dont les en-têtes demandent des paramètres ne voit que ses colonnes de ligne (R12).
import { test, expect, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { BasecraftApi } from '../../src/shared/api';
import type { DesignDoc } from '../../src/shared/design/model';
import { launchApp, seedSalesE2E } from './helpers';

const fr = JSON.parse(readFileSync(join(__dirname, '../../src/shared/i18n/fr.json'), 'utf8'));
const FR = { BASECRAFT_REGION: 'fr-FR' };
type Win = { basecraft: BasecraftApi };
type Row = (string | number | null)[];
// DatasheetView: row selector width, header and row heights.
const MARKER = 44, HEADER = 34, ROW = 30;
// QSaisieCommandes' columns: Commandes.N° (AutoNumber 80), Client (Number 110), Clients.N° (AutoNumber 80), Nom (Short Text 170)…
const X = { client: 80 + 30, nom: 270 + 30 };
const COL = { client: 1, nom: 3 };

const doc = (page: Page) => page.locator('section[role=tabpanel]:not([hidden])');
const vis = (page: Page, id: string) => page.locator(`[data-testid="${id}"]:visible`);
const cell = (page: Page, col: number, row: number) => doc(page).getByTestId(`glide-cell-${col + 1}-${row}`);
const cellEditor = (page: Page) => page.getByTestId('grid-editor-portal').locator('textarea');
const headers = (page: Page) => doc(page).getByTestId('datasheet').locator('th[role=columnheader]');
const settled = (page: Page) => expect(doc(page).getByTestId('datasheet')).not.toHaveAttribute('aria-busy', 'true');
const rowsOf = (page: Page, table: string) =>
  page.evaluate(async (t) => (await (window as unknown as Win).basecraft.rows.page(t, { offset: 0, limit: 50 })).rows.map((r) => r.values), table) as Promise<Row[]>;
const queryRows = (page: Page, name: string) =>
  page.evaluate(async (n) => (await (window as unknown as Win).basecraft.sources.page({ kind: 'query', name: n }, { offset: 0, limit: 50 })).rows, name) as Promise<Row[]>;
const sqlOf = (page: Page, name: string) => page.evaluate((n) => (window as unknown as Win).basecraft.objects.get('query', n)
  .then((g) => (g.definition as { sql: string }).sql), name);

async function grid(page: Page) {
  const c = doc(page).getByTestId('data-grid-canvas');
  await expect(c).toBeVisible();
  return (await c.boundingBox())!;
}
async function clickCell(page: Page, x: number, row: number, col: number) {
  const b = await grid(page);
  await page.mouse.click(b.x + MARKER + x, b.y + HEADER + row * ROW + ROW / 2);
  await expect(cell(page, col, row)).toBeFocused();
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
/** Create › Formulaire on the query `source` (saved under its name), then renamed `name` through the Navigation Pane. */
async function instantForm(page: Page, source: string, name: string) {
  await page.getByTestId(`nav-item-query-${source}`).click();
  await page.getByTestId('ribbon-tab-create').click();
  await page.getByTestId('cmd-createForm').click();
  await expect(page.getByTestId(`doc-tab-form-${source}`)).toHaveAttribute('aria-selected', 'true');
  await page.getByTestId(`doc-tab-close-form-${source}`).click();
  await page.getByTestId(`nav-item-form-${source}`).click({ button: 'right' });
  await page.getByTestId('nav-menu-rename').click();
  await page.getByTestId('modal-input').fill(name);
  await page.getByTestId('modal-btn-ok').click();
  await expect(page.getByTestId(`nav-item-form-${name}`)).toBeVisible();
}

/** The crosstab the test expects from the tables as `api` reads them: per client (by Nom, French order) [Nom, Total, September,
 *  October], the sums in integer cents, a month without orders Null (R9). */
async function salesByMonth(page: Page): Promise<Row[]> {
  const noms = new Map((await rowsOf(page, 'Clients')).map((c) => [c[0], c[1] as string]));
  const sums = new Map<string, Map<number, number>>();
  for (const [, client, montant, le] of await rowsOf(page, 'Commandes')) {
    const nom = noms.get(client)!, month = Number(String(le).slice(5, 7));
    const by = sums.get(nom) ?? new Map<number, number>();
    by.set(month, (by.get(month) ?? 0) + Math.round((montant as number) * 100));
    sums.set(nom, by);
  }
  return [...sums].sort(([a], [b]) => a.localeCompare(b, 'fr', { sensitivity: 'base' })).map(([nom, by]) => {
    expect([...by.keys()].every((m) => m === 9 || m === 10), nom).toBe(true); // the headings asserted: 9 and 10 only
    const cents = (m: number) => (by.has(m) ? by.get(m)! / 100 : null);
    return [nom, [...by.values()].reduce((a, c) => a + c, 0) / 100, cents(9), cents(10)];
  });
}

test('recette B4: an orders form on Commandes ⋈ Clients with AutoLookup; a crosstab of sales by client and month equals the sums', async () => {
  test.setTimeout(240_000);
  const base = seedSalesE2E('recette-b4');
  const ctl = (page: Page, n: string) => vis(page, `form-ctl-${n}`);
  const dirty = (page: Page) => vis(page, 'form-dirty');

  let { app, page, userDataDir } = await launchApp({ args: [base], env: FR });
  try {
    // 1. Créer › Création de requête: Clients ⋈ Commandes on the relation, six fields; then Créer › Formulaire on it
    await newQuery(page, ['Clients', 'Commandes']);
    await expect(doc(page).getByTestId('qbe-join-0')).toHaveAttribute('data-kind', 'inner');
    for (const f of ['Commandes-N°', 'Commandes-Client', 'Clients-N°', 'Clients-Nom', 'Commandes-Montant', 'Commandes-Le']) {
      await doc(page).getByTestId(`qbe-field-${f}`).dblclick();
    }
    await saveQuery(page, 'QSaisieCommandes');
    expect(await sqlOf(page, 'QSaisieCommandes')).toMatch(/INNER JOIN/);
    await page.getByTestId('doc-tab-close-query-QSaisieCommandes').click();
    await instantForm(page, 'QSaisieCommandes', 'FSaisieCommandes');

    // 2. a new record: Client 2, Tab → Nom « Martin » while dirty (AutoLookup, R4); Montant, Le, Shift+Enter: one order
    await page.getByTestId('nav-item-form-FSaisieCommandes').dblclick();
    await expect(page.getByTestId('doc-tab-form-FSaisieCommandes')).toHaveAttribute('aria-selected', 'true');
    await expect(ctl(page, 'Nom')).toHaveValue('Dupont');
    await expect(vis(page, 'nav-readonly')).toHaveCount(0);
    const clientsBefore = await rowsOf(page, 'Clients');
    await vis(page, 'nav-new').click();
    await ctl(page, 'Client').fill('2');
    await page.keyboard.press('Tab');
    await expect(ctl(page, 'Nom')).toHaveValue('Martin');
    await expect(dirty(page)).toBeVisible();
    await ctl(page, 'Montant').fill('12,5');
    await ctl(page, 'Le').fill('26/10/2026');
    await page.keyboard.press('Shift+Enter');
    await expect(dirty(page)).toHaveCount(0);
    let orders = await rowsOf(page, 'Commandes');
    expect(orders).toHaveLength(6);
    expect(orders[5]).toEqual([6, 2, 12.5, '2026-10-26 00:00:00']);
    expect(await rowsOf(page, 'Clients')).toEqual(clientsBefore);

    // 3. Nom « Martin SA » on that record: written to client 2 (R3); the one side's key control is read-only (R2)
    await ctl(page, 'Nom').fill('Martin SA');
    await page.keyboard.press('Shift+Enter');
    await expect(dirty(page)).toHaveCount(0);
    expect((await rowsOf(page, 'Clients'))[1]).toEqual([2, 'Martin SA', 'LYON']);
    expect(await rowsOf(page, 'Commandes')).toHaveLength(6);
    await expect(ctl(page, 'Clients_N°')).toHaveAttribute('readonly', '');

    // 4. Client 99: no such client (the enforced relation); Escape gives back Client 2 and Nom « Martin SA »
    await ctl(page, 'Client').fill('99');
    await page.keyboard.press('Shift+Enter');
    await expect(page.getByTestId('modal')).toContainText(fr.fieldError.noParent.replace('{{table}}', 'Clients'));
    await page.getByTestId('modal-btn-ok').click();
    await expect(dirty(page)).toBeVisible();
    await page.keyboard.press('Escape');
    await page.keyboard.press('Escape');
    await expect(ctl(page, 'Client')).toHaveValue('2');
    await expect(ctl(page, 'Nom')).toHaveValue('Martin SA');
    await expect(dirty(page)).toHaveCount(0);
    expect((await rowsOf(page, 'Commandes'))[5]).toEqual([6, 2, 12.5, '2026-10-26 00:00:00']);
    await page.getByTestId('doc-tab-close-form-FSaisieCommandes').click();

    // 5. the query's datasheet, sorted on Nom: Dupont's first order → « Dupont SA »; his other order shows it once the row is left (R6)
    await page.getByTestId('nav-item-query-QSaisieCommandes').dblclick();
    await expect(doc(page).getByTestId('nav-record-count')).toHaveText('6');
    await clickCell(page, X.nom, 0, COL.nom);
    await page.getByTestId('ribbon-tab-home').click();
    await page.getByTestId('cmd-sortAsc').click();
    for (const [row, nom] of ['Dupont', 'Dupont', 'Durand', 'Martin SA', 'Martin SA', 'Martin SA'].entries()) await expect(cell(page, COL.nom, row)).toHaveText(nom);
    await clickCell(page, X.client, 1, COL.client); // the selected cell, clicked again, would not take the focus back from the ribbon
    await clickCell(page, X.nom, 0, COL.nom);
    await page.keyboard.press('D');
    await expect(cellEditor(page)).toBeFocused();
    await page.keyboard.type('upont SA');
    await page.keyboard.press('Tab');
    await expect(cellEditor(page)).toHaveCount(0);
    await page.keyboard.press('ArrowDown');
    await settled(page);
    await expect(cell(page, COL.nom, 0)).toHaveText('Dupont SA');
    await expect(cell(page, COL.nom, 1)).toHaveText('Dupont SA');
    expect((await rowsOf(page, 'Clients'))[0]).toEqual([1, 'Dupont SA', 'Lyon']);
    await page.getByTestId('doc-tab-close-query-QSaisieCommandes').click();

    // 6. Créer › Création de requête › Analyse croisée: Nom row heading, Mois([Le]) column heading, Somme de Montant, a Total row total
    await newQuery(page, ['Clients', 'Commandes']);
    await page.getByTestId('cmd-crosstabQuery').click();
    await expect(page.getByTestId('cmd-crosstabQuery')).toHaveAttribute('aria-pressed', 'true');
    await doc(page).getByTestId('qbe-field-Clients-Nom').dblclick();
    await doc(page).getByTestId('qbe-cell-crosstab-0').selectOption({ label: fr.query.crosstab.rowHeading });
    await type(page, 'qbe-cell-field-1', 'Mois: Mois([Le])');
    await doc(page).getByTestId('qbe-cell-crosstab-1').selectOption({ label: fr.query.crosstab.columnHeading });
    await doc(page).getByTestId('qbe-field-Commandes-Montant').dblclick();
    await doc(page).getByTestId('qbe-cell-total-2').selectOption({ label: fr.query.total.sum });
    await doc(page).getByTestId('qbe-cell-crosstab-2').selectOption({ label: fr.query.crosstab.value });
    await type(page, 'qbe-cell-field-3', 'Total: Montant');
    await doc(page).getByTestId('qbe-cell-total-3').selectOption({ label: fr.query.total.sum });
    await doc(page).getByTestId('qbe-cell-crosstab-3').selectOption({ label: fr.query.crosstab.rowHeading });
    await saveQuery(page, 'QVentesParMois');
    expect(await sqlOf(page, 'QVentesParMois')).toMatch(/^TRANSFORM Sum\(\[Commandes\]\.\[Montant\]\)\n[\s\S]*\nPIVOT Month\(\[Le\]\) AS \[Mois\];$/);
    await page.getByTestId('status-view-datasheet').click();

    // 7. the crosstab equals the sums the test computes from the tables after steps 2–5, cent for cent
    const expected = await salesByMonth(page);
    expect(expected).toEqual([['Dupont SA', 10.2, null, 10.2], ['Durand', 99.99, 99.99, null], ['Martin SA', 12.8, null, 12.8]]);
    await expect(headers(page)).toHaveText(['Nom', 'Total', '9', '10']);
    await expect(doc(page).getByTestId('nav-record-count')).toHaveText('3');
    await expect(doc(page).getByTestId('nav-readonly')).toHaveText(fr.query.readOnly);
    for (const [row, r] of expected.entries()) {
      for (const [col, v] of r.entries()) {
        if (v === null) await expect(cell(page, col, row)).toHaveText('');
        else if (typeof v === 'string') await expect(cell(page, col, row)).toHaveText(v);
        else await expect(cell(page, col, row)).toHaveText(new RegExp(`^${String(v).replace('.', ',')}`));
      }
    }
    expect(await queryRows(page, 'QVentesParMois')).toEqual(expected);
  } finally {
    await app.close();
  }

  // 8. the base reopened: the crosstab runs with the same values; QSaisieCommandes' new order is there
  ({ app, page } = await launchApp({ args: [base], env: FR, userDataDir }));
  try {
    await page.getByTestId('nav-item-query-QVentesParMois').dblclick();
    await expect(headers(page)).toHaveText(['Nom', 'Total', '9', '10']);
    await expect(doc(page).getByTestId('nav-record-count')).toHaveText('3');
    const expected = await salesByMonth(page);
    expect(expected).toEqual([['Dupont SA', 10.2, null, 10.2], ['Durand', 99.99, 99.99, null], ['Martin SA', 12.8, null, 12.8]]);
    expect(await queryRows(page, 'QVentesParMois')).toEqual(expected);
    const saisie = await queryRows(page, 'QSaisieCommandes');
    expect(saisie).toHaveLength(6);
    expect(saisie.find((r) => r[0] === 6)).toEqual([6, 2, 2, 'Martin SA', 12.5, '2026-10-26 00:00:00']);
  } finally {
    await app.close();
  }
});

test('recette B4: a form on a crosstab whose headings need parameters, without Column Headings, sees its row columns only (R12)', async () => {
  const { app, page } = await launchApp({ args: [seedSalesE2E('recette-b4-r12')], env: FR });
  try {
    const sql = 'TRANSFORM Sum(Commandes.Montant) SELECT Clients.Nom FROM Clients INNER JOIN Commandes ON Clients.[N°] = Commandes.Client '
      + 'WHERE Commandes.Le >= [Du] GROUP BY Clients.Nom PIVOT Month(Commandes.Le);';
    expect(await page.evaluate((q) => (window as unknown as Win).basecraft.objects.save('query', 'QVentesDepuis', { formatVersion: '1.0', sql: q }, null), sql)).toEqual({ ok: true });
    await page.reload();
    await page.waitForSelector('[data-testid="app-root"]', { state: 'attached' });
    await page.getByTestId('nav-item-query-QVentesDepuis').click();
    await page.getByTestId('ribbon-tab-create').click();
    await page.getByTestId('cmd-createForm').click();
    // the form asks the parameter once, then shows the row column, no heading
    await expect(page.getByTestId('modal')).toContainText('Du');
    await page.getByTestId('modal-input').fill('01/09/2026');
    await page.getByTestId('modal-btn-ok').click();
    await expect(page.getByTestId('doc-tab-form-QVentesDepuis')).toHaveAttribute('aria-selected', 'true');
    await expect(vis(page, 'form-ctl-Nom')).toHaveValue('Dupont');
    await expect(vis(page, 'nav-record-count')).toHaveText('3');
    for (const h of ['9', '10']) await expect(page.getByTestId(`form-ctl-${h}`)).toHaveCount(0);
    const form = await page.evaluate(() => (window as unknown as Win).basecraft.objects.get('form', 'QVentesDepuis')) as { definition: DesignDoc };
    expect(form.definition.sections.flatMap((s) => s.controls).map((c) => c.props.ControlSource).filter((s) => s !== undefined)).toEqual(['Nom']);
  } finally {
    await app.close();
  }
});
