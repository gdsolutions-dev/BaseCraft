// O3 Task 3: Table Design — new rows take the default field type and size (Options › Concepteurs d'objets), a type change the
// default size, the Table Fields tab the sizes; AutoIndex sets « Oui - Avec doublons » once, on the committed name of a new field.
import { test, expect, type Page } from '@playwright/test';
import { launchApp, seedSalesE2E } from './helpers';

const FR = { BASECRAFT_REGION: 'fr-FR' };
const design = (page: Page, table: string) => page.evaluate((n) => (window as any).basecraft.tables.design(n), table);

/** The visible one: closed-over tabs of other tables stay mounted. */
const vis = (page: Page, id: string) => page.locator(`[data-testid="${id}"]:visible`);

async function setDefaults(page: Page, type: string, size: string, numberSize: string) {
  await page.getByTestId('ribbon-tab-file').click();
  await page.getByTestId('bs-options').click();
  await page.getByTestId('opt-cat-designers').click();
  await page.getByTestId('opt-field-type').selectOption({ label: type });
  await page.getByTestId('opt-text-size').fill(size);
  await page.getByTestId('opt-text-size').press('Enter');
  await page.getByTestId('opt-number-size').selectOption({ label: numberSize });
  await page.getByTestId('bs-back').click();
}

test('defaults, AutoIndex on creation, Table Fields sizes', async () => {
  test.setTimeout(120_000);
  const { app, page } = await launchApp({ args: [seedSalesE2E('table-defaults')], env: FR });
  try {
    await setDefaults(page, 'Nombre', '50', 'Entier');
    await page.getByTestId('ribbon-tab-create').click();
    await page.getByTestId('cmd-createTableDesign').click();
    await expect(page.getByTestId('doc-tab-Table1')).toBeVisible();

    await page.getByTestId('design-row-0-name').fill('Quantité');
    await expect(page.getByTestId('design-row-0-type')).toHaveValue('number');
    await expect(page.getByTestId('prop-numberSize')).toHaveValue('integer');
    await page.getByTestId('design-row-1-name').fill('Libellé');
    await page.getByTestId('design-row-1-type').selectOption('shortText');
    await expect(page.getByTestId('prop-size')).toHaveValue('50');
    await page.getByTestId('design-row-2-name').fill('CodeProduit');
    await page.keyboard.press('Tab');
    await expect(page.getByTestId('prop-indexed')).toHaveValue('yesDuplicates');
    await page.getByTestId('design-row-3-name').fill('Ville');
    await page.keyboard.press('Tab');
    await expect(page.getByTestId('prop-indexed')).toHaveValue('no');
    await page.getByTestId('design-row-4-name').fill('NumLot');   // cursor stays in the name
    await page.keyboard.press('Control+s');
    await page.getByTestId('modal-input').fill('Produits');
    await page.getByTestId('modal-btn-ok').click();
    await page.getByTestId('modal-btn-no').click();   // no primary key
    await expect(page.getByTestId('nav-item-Produits')).toBeVisible();
    const saved = (await design(page, 'Produits')).fields as { name: string; props: { indexed: string } }[];
    expect(saved.map((x) => [x.name, x.props.indexed])).toEqual([
      ['Quantité', 'no'], ['Libellé', 'no'], ['CodeProduit', 'yesDuplicates'], ['Ville', 'no'], ['NumLot', 'yesDuplicates']]);

    await page.getByTestId('doc-tab-close-Produits').click();

    // an existing table: untouched, and a rename does not index
    await page.getByTestId('nav-item-Clients').click({ button: 'right' });
    await page.getByTestId('nav-menu-design').click();
    const ville = vis(page, 'design-row-2-name');
    await expect(ville).toHaveValue('Ville');
    await ville.click();
    await expect(vis(page, 'prop-size')).toHaveValue('255');
    await ville.fill('CodeVille');
    await page.keyboard.press('Tab');
    await expect(vis(page, 'prop-indexed')).toHaveValue('no');

    // Table Fields tab: Short Text takes the size
    await page.getByTestId('nav-item-Produits').dblclick();
    await page.getByTestId('ribbon-tab-tableFields').click();
    await page.getByTestId('cmd-addShortText').click();
    await expect.poll(async () => (await design(page, 'Produits')).fields.at(-1).props.size).toBe(50);

    // defaults back: a new row is Short Text 255
    await setDefaults(page, 'Texte court', '255', 'Entier long');
    await page.getByTestId('nav-item-Produits').click({ button: 'right' });
    await page.getByTestId('nav-menu-design').click();
    await vis(page, 'design-row-6-name').fill('Autre');
    await expect(vis(page, 'design-row-6-type')).toHaveValue('shortText');
    await expect(vis(page, 'prop-size')).toHaveValue('255');
  } finally {
    await app.close();
  }
});
