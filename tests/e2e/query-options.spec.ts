// O3 Task 5: Query Design options (Options › Concepteurs d'objets › Création de requête) — the Table row from « Afficher les
// noms des tables », a new query's Output All Fields from « Afficher tous les champs », AutoJoin on same-name key fields
// (relationship joins always: G1). Its own seeds: never through query-design.spec.ts's cases.
import { test, expect, type Page } from '@playwright/test';
import { createTable } from '../../src/main/db/schema';
import { seedSales, seedSalesRelation } from '../../src/main/query/test-db';
import { f, t } from '../../src/shared/test-fixtures';
import { launchApp, seedBase } from './helpers';

const FR = { BASECRAFT_REGION: 'fr-FR' };
/** The shown document (every tab stays mounted, hidden). */
const doc = (page: Page) => page.locator('section[role=tabpanel]:not([hidden])');

async function option(page: Page, testid: string, on: boolean) {
  await page.getByTestId('ribbon-tab-file').click();
  await page.getByTestId('bs-options').click();
  await page.getByTestId('opt-cat-designers').click();
  await page.getByTestId(testid).setChecked(on);
  await page.getByTestId('bs-back').click();
}
/** Create › Query Design, then Show Table's Add with `tables`. */
async function newQuery(page: Page, tables: string[]) {
  await page.getByTestId('ribbon-tab-create').click();
  await page.getByTestId('cmd-createQueryDesign').click();
  await expect(page.getByTestId('show-table')).toBeVisible();
  for (const n of tables) await page.getByTestId(`show-table-${n}`).check();
  await page.getByTestId('show-table-add').click();
  await page.getByTestId('show-table-close').click();
  for (const n of tables) await expect(doc(page).getByTestId(`qbe-box-${n}`)).toBeVisible();
}
/** Closes the shown query without saving it. */
async function closeQuery(page: Page, tab: string) {
  await page.getByTestId(`doc-tab-close-${tab}`).click();
  const no = page.getByTestId('modal-btn-no');
  if (await no.isVisible().catch(() => false)) await no.click();
  await expect(page.getByTestId(`doc-tab-${tab}`)).toHaveCount(0);
}

test('table names, all fields, AutoJoin off keeps the relationship join', async () => {
  test.setTimeout(120_000);
  const base = seedBase('query-options', (db) => {
    seedSales(db);
    seedSalesRelation(db);
  });
  const { app, page } = await launchApp({ args: [base], env: FR });
  try {
    // defaults: the relationship's join only (no N° = N°), the Table row shown
    await newQuery(page, ['Clients', 'Commandes']);
    await expect(doc(page).getByTestId('qbe-join-0')).toHaveAttribute('data-kind', 'inner');
    await expect(doc(page).getByTestId('qbe-join-1')).toHaveCount(0);
    await doc(page).getByTestId('qbe-field-Clients-Nom').dblclick();
    await expect(doc(page).getByTestId('qbe-cell-table-0')).toHaveValue('Clients');
    await page.keyboard.press('Control+s');
    await page.getByTestId('modal-input').fill('QNoms');
    await page.getByTestId('modal-btn-ok').click();
    await expect(page.getByTestId('nav-item-query-QNoms')).toBeVisible();
    await closeQuery(page, 'query-QNoms');

    // « Afficher les noms des tables » off: a new query and a saved one hide the Table row; the ribbon shows it again
    await option(page, 'opt-table-names', false);
    await newQuery(page, ['Clients']);
    await doc(page).getByTestId('qbe-field-Clients-Nom').dblclick();
    await expect(doc(page).getByTestId('qbe-cell-field-0')).toHaveValue('Nom');
    await expect(doc(page).getByTestId('qbe-cell-table-0')).toHaveCount(0);
    await expect(page.getByTestId('cmd-tableNames')).toHaveAttribute('aria-pressed', 'false');
    await closeQuery(page, 'query-Requête1');
    await page.getByTestId('nav-item-query-QNoms').click({ button: 'right' });
    await page.getByTestId('nav-menu-design').click();
    await expect(doc(page).getByTestId('qbe-cell-field-0')).toHaveValue('Nom');
    await expect(doc(page).getByTestId('qbe-cell-table-0')).toHaveCount(0);
    await page.getByTestId('cmd-tableNames').click();
    await expect(doc(page).getByTestId('qbe-cell-table-0')).toHaveValue('Clients');
    await closeQuery(page, 'query-QNoms');
    await option(page, 'opt-table-names', true);

    // « Afficher tous les champs » on: a new query outputs all fields, not dirty; a saved query keeps its own
    await option(page, 'opt-output-all', true);
    await newQuery(page, ['Clients']);
    await page.getByTestId('cmd-propertySheet').click();
    await expect(page.getByTestId('query-props-outputAll')).toBeChecked();
    await expect(doc(page).getByTestId('qbe-cell-field-0')).toHaveValue('*');
    await page.getByTestId('status-view-sql').click();
    await expect(doc(page).getByTestId('query-sql')).toHaveValue(/^SELECT \*\s+FROM \[Clients\];$/);
    await closeQuery(page, 'query-Requête1');
    await page.getByTestId('nav-item-query-QNoms').click({ button: 'right' });
    await page.getByTestId('nav-menu-design').click();
    await expect(doc(page).getByTestId('qbe-cell-field-0')).toHaveValue('Nom');
    await page.getByTestId('cmd-propertySheet').click();
    await expect(page.getByTestId('query-props-outputAll')).not.toBeChecked();
    await closeQuery(page, 'query-QNoms');
    await option(page, 'opt-output-all', false);

    // AutoJoin off (G1): the relationship join still appears
    await option(page, 'opt-autojoin', false);
    await newQuery(page, ['Clients', 'Commandes']);
    await expect(doc(page).getByTestId('qbe-join-0')).toHaveAttribute('data-kind', 'inner');
    await expect(doc(page).getByTestId('qbe-join-1')).toHaveCount(0);
  } finally {
    await app.close();
  }
});

test('AutoJoin: same-name fields, one a key; off: no join', async () => {
  test.setTimeout(120_000);
  const base = seedBase('query-autojoin', (db) => {
    seedSales(db);
    createTable(db, t('Villes', [f('Ville', 'shortText', { primaryKey: true, indexed: 'yesNoDuplicates' })]));
  });
  const { app, page } = await launchApp({ args: [base], env: FR });
  try {
    await newQuery(page, ['Clients', 'Villes']);
    await expect(doc(page).getByTestId('qbe-join-0')).toHaveAttribute('data-kind', 'inner');
    await expect(doc(page).getByTestId('qbe-join-1')).toHaveCount(0);
    await doc(page).getByTestId('qbe-field-Clients-Nom').dblclick();
    await page.getByTestId('status-view-sql').click();
    await expect(doc(page).getByTestId('query-sql')).toHaveValue(/ON \[Villes\]\.\[Ville\] = \[Clients\]\.\[Ville\];$/);
    await closeQuery(page, 'query-Requête1');

    await option(page, 'opt-autojoin', false);
    await newQuery(page, ['Clients', 'Villes']);
    await expect(doc(page).getByTestId('qbe-join-0')).toHaveCount(0);
  } finally {
    await app.close();
  }
});
