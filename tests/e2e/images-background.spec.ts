// Image d'arriere-plan d'un formulaire (F3, tache 7) : Format > Image d'arriere-plan, dessinee dans chaque section (Formulaire et Page),
// mosaique / alignement / mode d'affichage de la feuille de proprietes, "Aucune", annulation en une etape, lecture seule.
import { test, expect, type Page } from '@playwright/test';
import type { BasecraftApi } from '../../src/shared/api';
import type { DesignDoc } from '../../src/shared/design/model';
import { addResource } from '../../src/main/db/resources';
import { saveObject } from '../../src/main/db/objects';
import { FACTURES_REPORT } from '../../src/shared/report/fixtures/factures';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { launchApp, seedBase, seedForm, seedReportsE2E, pickView } from './helpers';

const PNG_URL = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
const cur = (page: Page) => page.locator('.doc:not([hidden])');
const getDef = (page: Page) =>
  page.evaluate(() => (window as unknown as { basecraft: BasecraftApi }).basecraft.objects.get('form', 'Fiche')).then((r) => r.definition as DesignDoc);

const fiche: DesignDoc = { formatVersion: '1.0', recordSource: null, props: { Width: 9072 }, sections: [
  { kind: 'formHeader', height: 0, props: { Visible: false }, controls: [] },
  { kind: 'detail', height: 4536, props: { BackColor: '#ffeecc' }, controls: [] },
  { kind: 'formFooter', height: 0, props: { Visible: false }, controls: [] }] };

const seed = (name: string) => seedBase(name, (db) => { seedForm(db, 'Fiche', fiche); addResource(db, 'Motif', PNG_URL); });
const openDesign = async (page: Page) => {
  await page.getByTestId('nav-item-form-Fiche').click({ button: 'right' });
  await page.getByTestId('nav-menu-design').click();
  await expect(cur(page).getByTestId('designer')).toBeVisible();
};
const pickMotif = async (page: Page) => {
  await page.getByTestId('ribbon-tab-format').click();
  await page.getByTestId('cmd-backgroundImage').click();
  await page.getByTestId('image-item-0').click();
};
const view = async (page: Page, id: string) => { await page.getByTestId('ribbon-tab-home').click(); await pickView(page, id); };
const css = (page: Page, prop: string) => page.getByTestId('form-section-detail').filter({ visible: true }).evaluate((el, p) => getComputedStyle(el).getPropertyValue(p), prop);

test('Format > Background Image: pick, draw in Form and Layout views, sheet properties, undo, None', async () => {
  test.setTimeout(120000);
  const { app, page } = await launchApp({ args: [seed('images-background')], env: { BASECRAFT_REGION: 'fr-FR' } });
  try {
    await openDesign(page);
    // la feuille du formulaire : les cinq lignes, dans l'ordre d'Access (capture 17)
    const rows = cur(page).getByTestId('property-sheet').locator('[data-testid^="prop-Picture"]:not([data-testid$="-shared"]):not([data-testid$="-file"])');
    await expect(rows.first()).toBeVisible();
    const ids = await rows.evaluateAll((els) => els.map((e) => e.getAttribute('data-testid')));
    expect(ids).toEqual(['prop-PictureType', 'prop-Picture', 'prop-PictureTiling', 'prop-PictureAlignment', 'prop-PictureSizeMode']);
    for (const label of ['Type image', 'Image', "Mosaïque d'images", "Alignement de l'image", "Mode d'affichage de l'image"]) {
      await expect(cur(page).getByTestId('property-sheet').getByText(label, { exact: true }).first()).toBeVisible();
    }

    await pickMotif(page);
    await expect(page.getByTestId('image-gallery')).toHaveCount(0);

    // Creation : l'image est dessinee sous la grille de points
    const body = cur(page).locator('.dz-body').nth(1);
    await expect(body).toHaveCSS('background-image', new RegExp(`radial-gradient.*${PNG_URL.slice(0, 40)}`));
    expect(await body.evaluate((el) => getComputedStyle(el).backgroundImage)).toContain(PNG_URL);

    // Page (mise en page) : le fond est dessine dans la section
    await view(page, 'viewLayout');
    expect(await cur(page).locator('.dz-body').nth(1).evaluate((el) => getComputedStyle(el).backgroundImage)).toContain(PNG_URL);
    expect(await cur(page).locator('.dz-body').nth(1).evaluate((el) => getComputedStyle(el).backgroundImage)).not.toContain('radial-gradient');
    await view(page, 'viewDesign');

    // Ctrl+Z annule le choix en une etape ; Ctrl+Y le retablit
    await page.getByTestId('design-canvas').focus();
    await page.keyboard.press('Control+z');
    await expect(cur(page).getByTestId('prop-PictureType')).toHaveValue('embedded');
    await page.keyboard.press('Control+y');
    await expect(cur(page).getByTestId('prop-PictureType')).toHaveValue('shared');

    // mosaique
    await cur(page).getByTestId('prop-PictureTiling').selectOption('true');
    await page.keyboard.press('Control+s');
    await expect.poll(async () => (await getDef(page)).props).toMatchObject({ PictureType: 'shared', Picture: 'Motif', PictureTiling: true });
    await view(page, 'viewForm');
    await expect(page.getByTestId('form-run')).toBeVisible();
    expect(await css(page, 'background-image')).toContain(PNG_URL);
    expect(await css(page, 'background-repeat')).not.toContain('no-repeat');
    expect(await css(page, 'background-color')).toBe('rgb(255, 238, 204)');   // la couleur de la section reste

    // alignement en bas a droite sans mosaique
    await view(page, 'viewDesign');
    await cur(page).getByTestId('prop-PictureTiling').selectOption('false');
    await cur(page).getByTestId('prop-PictureAlignment').selectOption('bottomRight');
    await page.keyboard.press('Control+s');
    await view(page, 'viewForm');
    expect(await css(page, 'background-position')).toBe('100% 100%');
    expect(await css(page, 'background-repeat')).toContain('no-repeat');

    // Aucune : les deux proprietes disparaissent, les autres restent ; une seule annulation les rend
    await view(page, 'viewDesign');
    await page.getByTestId('ribbon-tab-format').click();
    await page.getByTestId('cmd-backgroundImage').click();
    await page.getByTestId('image-none').click();
    await expect(cur(page).getByTestId('prop-PictureType')).toHaveValue('embedded');
    await page.getByTestId('design-canvas').focus();
    await page.keyboard.press('Control+z');
    await expect(cur(page).getByTestId('prop-PictureType')).toHaveValue('shared');   // une seule annulation
    await page.keyboard.press('Control+y');
    await page.keyboard.press('Control+s');
    await expect.poll(async () => { const p = (await getDef(page)).props; return ['PictureType' in p, 'Picture' in p, p.PictureAlignment]; }).toEqual([false, false, 'bottomRight']);
  } finally { await app.close(); }
});

test('Background Image on a read-only base: the gallery opens, items do nothing', async () => {
  test.setTimeout(120000);
  const base = seed('images-background-ro');
  const a = await launchApp({ args: [base] });
  const b = await launchApp({ args: [base], env: { BASECRAFT_REGION: 'fr-FR' } });
  try {
    const page = b.page;
    await expect(page.getByTestId('banner-readonly')).toBeVisible();
    await openDesign(page);
    await page.getByTestId('ribbon-tab-format').click();
    await page.getByTestId('cmd-backgroundImage').click();
    await expect(page.getByTestId('image-item-0').locator('img')).toHaveAttribute('src', PNG_URL);
    await expect(page.getByTestId('image-none')).toHaveAttribute('aria-disabled', 'true');
    await page.getByTestId('image-item-0').click({ force: true });
    await expect(page.getByTestId('image-gallery')).toBeVisible();   // un clic sans effet : la galerie reste ouverte
    await expect(page.locator('.dtab-dirty')).toHaveCount(0);   // et rien n'est devenu modifie
  } finally { await b.app.close(); await a.app.close(); }
});

// --- États (tâche 8) ---
const etat: DesignDoc = { ...FACTURES_REPORT, props: { ...FACTURES_REPORT.props, PictureType: 'shared', Picture: 'Motif', PictureTiling: true } };   // 3 pages
const seedEtat = (name: string) => seedBase(name, (db) => { seedReportsE2E(db); saveObject(db, 'report', 'Etat', etat, null); addResource(db, 'Motif', PNG_URL); });
const bgOf = (loc: ReturnType<Page['locator']>, p: string) => loc.evaluate((el, q) => getComputedStyle(el).getPropertyValue(q), p);

test('Report background: design under the grid, Layout and preview on every page, tiled alignment, live replace', async () => {
  test.setTimeout(120000);
  const { app, page } = await launchApp({ args: [seedEtat('images-background-etat')], env: { BASECRAFT_REGION: 'fr-FR' } });
  try {
    await page.getByTestId('nav-item-report-Etat').click({ button: 'right' });
    await page.getByTestId('nav-menu-design').click();
    await expect(cur(page).getByTestId('designer')).toBeVisible();
    const body = cur(page).locator('.dz-body').nth(1);
    expect(await bgOf(body, 'background-image')).toContain(PNG_URL);
    expect(await bgOf(body, 'background-image')).toContain('radial-gradient');

    await view(page, 'viewLayout');
    const flowBg = cur(page).locator('.bc-bg').first();
    await expect(flowBg).toBeVisible();
    expect(await bgOf(flowBg, 'background-image')).toContain(PNG_URL);
    await view(page, 'viewDesign');

    // Format > Image d'arrière-plan écrit l'état : "Aucune" puis le choix
    await page.getByTestId('ribbon-tab-format').click();
    await page.getByTestId('cmd-backgroundImage').click();
    await page.getByTestId('image-none').click();
    await expect(cur(page).getByTestId('prop-PictureType')).toHaveValue('embedded');
    await page.getByTestId('cmd-backgroundImage').click();
    await page.getByTestId('image-item-0').click();
    await expect(cur(page).getByTestId('prop-PictureType')).toHaveValue('shared');
    await cur(page).getByTestId('prop-PictureAlignment').selectOption('bottomRight');
    await cur(page).getByTestId('prop-PictureTiling').selectOption('false');
    await page.keyboard.press('Control+s');
    await expect.poll(async () => (await page.evaluate(() => (window as unknown as { basecraft: BasecraftApi }).basecraft.objects.get('report', 'Etat')).then((r) => r.definition as DesignDoc)).props)
      .toMatchObject({ PictureType: 'shared', Picture: 'Motif', PictureAlignment: 'bottomRight' });

    // aperçu : un .bc-bg par page
    await page.getByTestId('ribbon-tab-home').click();
    await pickView(page, 'viewState');
    const pages = cur(page).locator('.bc-page');
    await expect(pages.first()).toBeVisible();
    await expect(cur(page).getByTestId('preview-page-of')).toHaveText('Page 1 sur 3');
    const bg = cur(page).locator('.bc-page[data-page="1"] > .bc-bg');
    expect(await bgOf(bg, 'background-image')).toContain(PNG_URL);
    expect(await bgOf(bg, 'background-position')).toBe('100% 100%');
    const n = await pages.count();
    expect(n).toBeGreaterThan(1);
    await expect(cur(page).locator('.bc-page > .bc-bg')).toHaveCount(n);   // un fond par page dessinée

    // remplacer l'image partagée met l'aperçu ouvert à jour
    const BLUE = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR4nGNgAAIAAAUAAXpeqz8AAAAASUVORK5CYII=';
    await page.evaluate((u) => (window as unknown as { basecraft: BasecraftApi }).basecraft.resources.replace('Motif', u), BLUE);
    await expect.poll(async () => bgOf(cur(page).locator('.bc-page > .bc-bg').first(), 'background-image')).toContain(BLUE);
  } finally { await app.close(); }
});

test('Report background: tiled alignments, and the PDF is identical on two runs with the picture on every page', async () => {
  test.setTimeout(120000);
  const pdfPath = join(mkdtempSync(join(tmpdir(), 'basecraft-bg-')), 'etat.pdf');
  const { app, page } = await launchApp({ args: [seedEtat('images-background-pdf')], env: { BASECRAFT_REGION: 'fr-FR', TZ: 'Pacific/Kiritimati', BASECRAFT_E2E_PDF_PATH: pdfPath } });
  try {
    await page.getByTestId('nav-item-report-Etat').click({ button: 'right' });
    await page.getByTestId('nav-menu-design').click();
    await expect(cur(page).getByTestId('designer')).toBeVisible();
    // alignements avec mosaïque : la position calculée suit l'alignement
    for (const [a, pos] of [['topLeft', '0% 0%'], ['bottomLeft', '0% 100%'], ['center', '50% 50%']] as const) {
      await cur(page).getByTestId('prop-PictureAlignment').selectOption(a);
      await page.keyboard.press('Control+s');
      await view(page, 'viewState');
      await expect(cur(page).locator('.bc-page[data-page="1"] > .bc-bg')).toBeVisible();
      expect(await bgOf(cur(page).locator('.bc-page[data-page="1"] > .bc-bg'), 'background-position')).toBe(pos);
      await view(page, 'viewDesign');
    }
    await view(page, 'viewPrintPreview');
    await expect(cur(page).getByTestId('preview-page-of')).toHaveText('Page 1 sur 3');
    const exportPdf = async () => {
      await page.getByTestId('cmd-exportPdf').click();
      await expect(page.getByTestId('modal-btn-ok')).toBeVisible();
      await page.getByTestId('modal-btn-ok').click();
      await expect(page.getByTestId('modal-btn-ok')).toHaveCount(0);
      // titre (uuid du document d'impression), dates, identifiant : seuls octets qui varient légitimement
      return readFileSync(pdfPath).toString('latin1').replace(/\/(CreationDate|ModDate)\s*\([^)]*\)/g, '').replace(/bc-print:\/\/doc\/[0-9a-f-]+/g, '').replace(/\/ID\s*\[[^\]]*\]/g, '');
    };
    const a = await exportPdf(), b = await exportPdf();
    expect(a.match(/\/Type\s*\/Page[^s]/g)).toHaveLength(3);
    expect(a.match(/\/Subtype\s*\/Image/g)?.length ?? 0).toBeGreaterThan(0);   // l'image est dans le PDF
    expect(b).toBe(a);
  } finally { await app.close(); }
});
