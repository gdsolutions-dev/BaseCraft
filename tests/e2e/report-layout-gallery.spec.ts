// Mode Page des états (L3b), de bout en bout : la galerie de contrôles. Boîte à outils et galerie du ruban actives (ni barres de
// section, ni onglet Événement, ni volet Regrouper) ; un contrôle posé d'un clic dans le Détail du 3e enregistrement apparaît dans
// chaque enregistrement après la remise en page, l'état est modifié, une seule annulation le retire ; un clic hors bande (marge,
// zone grise) ne pose rien et garde l'outil ; sur une ligne d'un Tabulaire, le contrôle rejoint la disposition (les voisins se
// décalent) ; base en lecture seule : galerie éteinte ; le mode Création garde sa boîte à outils et sa pose.
import { test, expect, type Page } from '@playwright/test';
import { seedBase, seedReportsE2E, launchApp } from './helpers';

const FR = { BASECRAFT_REGION: 'fr-FR' };
const REPORT = 'Factures par client';

const base = () => seedBase('etats-galerie-page', (db) => seedReportsE2E(db));
const cur = (page: Page) => page.locator('.doc:not([hidden])');
const flow = (page: Page) => cur(page).getByTestId('layout-flow');
const items = (page: Page, name: string) => flow(page).locator(`[data-name="${name}"]`);
const detail = (page: Page) => flow(page).locator('.bc-band[data-section="detail"]');
const rings = (page: Page, name: string) => cur(page).locator(`[data-testid="layout-ring-${name}"]`);
const tab = (page: Page) => page.getByTestId(`doc-tab-report-${REPORT}`);
const status = (page: Page, v: string) => page.getByTestId(`status-view-${v}`);
const settled = (page: Page) => expect(cur(page).getByTestId('report-layout-canvas')).toHaveAttribute('aria-busy', 'false');
/** Les noms de tous les éléments du flux (sans doublon). */
const allNames = (page: Page) => flow(page).locator('[data-name]').evaluateAll((els) => [...new Set(els.map((e) => (e as HTMLElement).dataset.name!))]);
const left = async (page: Page, name: string) => Math.round((await items(page, name).first().evaluate((e) => e.getBoundingClientRect().x)));
async function openLayout(page: Page) {
  await page.getByTestId(`nav-item-report-${REPORT}`).click({ button: 'right' });
  await page.getByTestId('nav-menu-layout').click();
  await expect(flow(page)).toBeVisible();
  await settled(page);
  await expect(tab(page)).not.toContainText('•');
}
/** Un point du Détail de l'enregistrement `n`, dans l'interstice entre Date et Libelle (le volet de droite masque la fin de la bande), en coordonnées de la page. */
async function detailPoint(page: Page, n: number) {
  const b = (await detail(page).nth(n).boundingBox())!;
  return { x: b.x + 1757 / 15, y: b.y + b.height / 2 };
}

test('Report Layout view gallery: place in the 3rd record, every record gets it, one undo, outside bands keeps the tool, Tabular row joins, Design unchanged', async () => {
  test.setTimeout(150000);
  const { app, page } = await launchApp({ args: [base()], env: FR });
  try {
    await openLayout(page);
    // boîte à outils et galerie actives ; ni barres de section, ni onglet Événement, ni volet Regrouper
    await expect(cur(page).getByTestId('toolbox')).toBeVisible();
    await expect(cur(page).getByTestId('tool-textBox')).toBeEnabled();
    await page.getByTestId('ribbon-tab-reportDesign').click();
    await expect(page.getByTestId('cmd-textBox')).toBeEnabled();
    await expect(cur(page).locator('[data-testid^="section-resize-"]')).toHaveCount(0);
    await expect(cur(page).getByTestId('sheet-tab-event')).toHaveCount(0);
    await expect(cur(page).getByTestId('grouping-pane')).toHaveCount(0);

    // un clic hors bande (marge haute de la page, puis zone grise à gauche de la feuille) ne pose rien et garde l'outil
    const before = await allNames(page);
    await cur(page).getByTestId('tool-textBox').click();
    await expect(flow(page)).toHaveClass(/rl-placing/);
    const sheet = (await flow(page).boundingBox())!;
    await page.mouse.click(sheet.x + sheet.width / 2, sheet.y + 3);
    await page.mouse.click(Math.max(2, sheet.x - 6), sheet.y + 200);
    await settled(page);
    expect(await allNames(page)).toEqual(before);
    await expect(tab(page)).not.toContainText('•');
    await expect(flow(page)).toHaveClass(/rl-placing/);

    // le Détail du 3e enregistrement : le contrôle est dans chacun, l'état est modifié, l'outil est repris, il est sélectionné
    await detail(page).nth(2).scrollIntoViewIfNeeded();
    const p = await detailPoint(page, 2);
    await page.mouse.click(p.x, p.y);
    await expect(tab(page)).toContainText('•');
    await expect(flow(page)).not.toHaveClass(/rl-placing/);
    await settled(page);
    const added = (await allNames(page)).filter((n) => !before.includes(n));
    expect(added).toHaveLength(2);   // la zone de texte et son étiquette
    const box = added.find((n) => !n.startsWith('Étiquette'))!;
    for (const n of added) await expect(items(page, n), n).toHaveCount(75);
    await expect(rings(page, box)).toHaveCount(75);

    // une seule annulation retire le contrôle de chaque enregistrement
    await page.getByTestId('ribbon-tab-home').click();
    await page.keyboard.press('Control+z');
    await expect(items(page, box)).toHaveCount(0);
    await settled(page);
    await expect(detail(page)).toHaveCount(75);
    await page.keyboard.press('Control+y');
    await expect(items(page, box)).toHaveCount(75);
    await settled(page);
    await page.keyboard.press('Control+z');
    await expect(items(page, box)).toHaveCount(0);
    await settled(page);

    // Tabulaire sur les trois colonnes du Détail (L1) : un clic d'outil sur une ligne du membre rejoint la disposition
    await items(page, 'Date').first().click();
    await items(page, 'Libelle').first().click({ modifiers: ['Control'] });
    await items(page, 'Montant').first().click({ modifiers: ['Control'] });
    await page.getByTestId('ribbon-tab-arrange').click();
    await page.getByTestId('cmd-tabular').click();
    await settled(page);
    const mnt = await left(page, 'Montant');
    const known = await allNames(page);
    await page.getByTestId('ribbon-tab-reportDesign').click();
    await cur(page).getByTestId('tool-textBox').click();
    const lib = (await items(page, 'Libelle').nth(2).boundingBox())!;
    await page.mouse.click(lib.x + 2, lib.y + 2);
    await expect(flow(page)).not.toHaveClass(/rl-placing/);
    await expect.poll(async () => (await allNames(page)).filter((n) => !known.includes(n)).length).toBe(2);
    const joined = (await allNames(page)).filter((n) => !known.includes(n));
    await expect(items(page, joined.find((n) => !n.startsWith('Étiquette'))!)).toHaveCount(75);   // la zone de texte : une cellule par ligne
    await expect(items(page, joined.find((n) => n.startsWith('Étiquette'))!)).toHaveCount(1);     // son étiquette : dans l'en-tête de la disposition
    await expect.poll(() => left(page, 'Montant')).toBeGreaterThan(mnt);   // les voisins se décalent
    await settled(page);

    // Création : la boîte à outils est là et la pose y marche comme avant
    await status(page, 'design').click();
    await expect(cur(page).getByTestId('toolbox')).toBeVisible();
    await expect(cur(page).locator('[data-testid^="section-resize-"]').first()).toBeVisible();
    const ctls = () => cur(page).locator('[data-ctl]').count();
    const n0 = await ctls();
    await cur(page).getByTestId('tool-label').click();
    await cur(page).locator('.dz-block', { has: page.getByTestId('section-detail') }).locator('.dz-body').click({ position: { x: 20, y: 6 } });
    await expect.poll(ctls).toBeGreaterThan(n0);
  } finally {
    await app.close();
  }
});

test('Report Layout view gallery in a read-only base stays disabled', async () => {
  test.setTimeout(90000);
  const b = base();
  const first = await launchApp({ args: [b], env: FR });
  const second = await launchApp({ args: [b], env: FR });
  try {
    const page = second.page;
    await expect(page.getByTestId('banner-readonly')).toBeVisible();
    await openLayout(page);
    await expect(cur(page).getByTestId('tool-textBox')).toBeDisabled();
    await page.getByTestId('ribbon-tab-reportDesign').click();
    await expect(page.getByTestId('cmd-textBox')).toBeDisabled();
  } finally {
    await second.app.close();
    await first.app.close();
  }
});
