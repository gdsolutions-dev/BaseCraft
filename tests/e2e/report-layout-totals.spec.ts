// Totaux d'un état instantané dans la disposition tabulaire : en mode Page, la poignée de largeur de la colonne Montant élargit
// aussi son total (une seule annulation) ; en Création, Totaux > Somme sur Quantité ajoute un total qui suit sa colonne
// (Insérer à gauche), et « Sélectionner la colonne » prend la zone de texte, son étiquette et son total.
import { test, expect, type Page } from '@playwright/test';
import { createTable } from '../../src/main/db/schema';
import { defaultProps } from '../../src/shared/field-types';
import { launchApp, seedBase } from './helpers';

const base = () => seedBase('totaux-disposition', (db) => {
  createTable(db, { name: 'Achats', fields: [{ name: 'Article', props: defaultProps('shortText') },
    { name: 'Quantite', props: defaultProps('number') }, { name: 'Montant', props: defaultProps('currency') }] });
  db.exec(`INSERT INTO "Achats" ("Article", "Quantite", "Montant") VALUES ('a', 1, 2.5), ('b', 2, 3.5)`);
});
const cur = (page: Page) => page.locator('.doc:not([hidden])');
const item = (page: Page, name: string) => cur(page).getByTestId('layout-flow').locator(`[data-name="${name}"]`).first();
const lw = async (page: Page, name: string) => Math.round((await item(page, name).boundingBox())!.width);
const ctl = (page: Page, name: string) => cur(page).getByTestId(`ctl-${name}`);
const x = async (page: Page, name: string) => Math.round((await ctl(page, name).boundingBox())!.x);
const settled = (page: Page) => expect(cur(page).getByTestId('report-layout-canvas')).toHaveAttribute('aria-busy', 'false');

test('Instant report totals follow their column: width handle in Layout view, Totals, Insert Left and Select Column in Design view', async () => {
  test.setTimeout(120000);
  const { app, page } = await launchApp({ args: [base()], env: { BASECRAFT_REGION: 'fr-FR' } });
  try {
    await page.getByTestId('nav-item-Achats').click();
    await page.getByTestId('ribbon-tab-create').click();
    await page.getByTestId('cmd-createReport').click();
    await expect(cur(page).getByTestId('preview-page-of')).toBeVisible();
    await page.keyboard.press('Control+s');   // the new report, saved under the proposed name: Layout view needs a saved one
    await page.getByTestId('modal-btn-ok').click();
    await expect(page.getByTestId('nav-item-report-Achats')).toBeVisible();
    await page.getByTestId('status-view-layout').click();
    await settled(page);

    // la poignée de largeur de Montant : le total suit ; une annulation rétablit les deux
    await item(page, 'Montant').click();
    const w = await lw(page, 'Montant');
    expect(await lw(page, 'Somme_Montant')).toBe(w);
    const h = (await cur(page).getByTestId('layout-width-handle').boundingBox())!;
    await page.mouse.move(h.x + h.width / 2, h.y + h.height / 2);
    await page.mouse.down();
    await page.mouse.move(h.x + 40, h.y + h.height / 2, { steps: 4 });
    await page.mouse.move(h.x + 80, h.y + h.height / 2, { steps: 4 });
    await page.mouse.up();
    await expect.poll(() => lw(page, 'Montant')).toBeGreaterThan(w + 40);
    await settled(page);
    expect(await lw(page, 'Somme_Montant')).toBe(await lw(page, 'Montant'));
    await page.getByTestId('ribbon-tab-home').click();
    await page.keyboard.press('Control+z');
    await expect.poll(() => lw(page, 'Montant')).toBe(w);
    await settled(page);
    expect(await lw(page, 'Somme_Montant')).toBe(w);

    // en Création : Totaux > Somme sur Quantité, puis Insérer à gauche : la zone de texte et son total se décalent du même écart
    await page.getByTestId('status-view-design').click();
    await ctl(page, 'Quantite').click();
    await page.getByTestId('ribbon-tab-reportDesign').click();
    await page.getByTestId('cmd-reportTotals').click();
    await page.getByTestId('totals-popup-Sum').click();
    await expect(ctl(page, 'Somme_Quantite')).toBeVisible();
    expect(await x(page, 'Somme_Quantite')).toBe(await x(page, 'Quantite'));
    const [q, s] = [await x(page, 'Quantite'), await x(page, 'Somme_Quantite')];
    await ctl(page, 'Quantite').click();
    await page.getByTestId('ribbon-tab-arrange').click();
    await page.getByTestId('cmd-insertLeft').click();
    await expect.poll(() => x(page, 'Quantite')).toBeGreaterThan(q);
    const d = (await x(page, 'Quantite')) - q;
    expect((await x(page, 'Somme_Quantite')) - s).toBe(d);

    // Sélectionner la colonne : zone de texte, étiquette et total
    await ctl(page, 'Quantite').click();
    await page.getByTestId('cmd-selectColumn').click();
    await expect(ctl(page, 'Quantite')).toHaveAttribute('aria-pressed', 'true');
    await expect(ctl(page, 'Somme_Quantite')).toHaveAttribute('aria-pressed', 'true');
    await expect(cur(page).locator('[data-testid^="ctl-"][aria-pressed="true"]')).toHaveCount(3);
  } finally {
    await app.close();
  }
});

test('Totals in Layout view: a Detail value selected in the flow, Totals > Sum puts the total in the footer, aligned with its column', async () => {
  test.setTimeout(120000);
  const { app, page } = await launchApp({ args: [base()], env: { BASECRAFT_REGION: 'fr-FR' } });
  try {
    await page.getByTestId('nav-item-Achats').click();
    await page.getByTestId('ribbon-tab-create').click();
    await page.getByTestId('cmd-createReport').click();
    await expect(cur(page).getByTestId('preview-page-of')).toBeVisible();
    await page.keyboard.press('Control+s');   // the new report, saved under the proposed name: Layout view needs a saved one
    await page.getByTestId('modal-btn-ok').click();
    await expect(page.getByTestId('nav-item-report-Achats')).toBeVisible();
    await page.getByTestId('status-view-layout').click();
    await settled(page);

    await item(page, 'Quantite').click();
    await page.getByTestId('ribbon-tab-reportDesign').click();
    await page.getByTestId('cmd-reportTotals').click();
    await page.getByTestId('totals-popup-Sum').click();
    await settled(page);
    // le total est dans le flux (pied d'état) : même gauche et même largeur que la colonne
    await expect(item(page, 'Somme_Quantite')).toBeVisible();
    await expect(item(page, 'Somme_Quantite')).toContainText('3');
    const [c, t] = [(await item(page, 'Quantite').boundingBox())!, (await item(page, 'Somme_Quantite').boundingBox())!];
    expect(Math.round(t.x)).toBe(Math.round(c.x));
    expect(Math.round(t.width)).toBe(Math.round(c.width));
  } finally {
    await app.close();
  }
});
