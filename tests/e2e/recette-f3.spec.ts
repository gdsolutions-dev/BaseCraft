// Recette F3 : le logo partagé (galerie) sur un formulaire et un état, remplacé, puis en fond mosaïque des deux et en image d'un bouton ;
// enregistré, compacté, rouvert, et lu par une copie en lecture seule.
import { test, expect, type Locator, type Page } from '@playwright/test';
import { deflateSync } from 'node:zlib';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { BasecraftApi } from '../../src/shared/api';
import type { DesignDoc } from '../../src/shared/design/model';
import { launchApp, seedBase, seedForm } from './helpers';
import { saveObject } from '../../src/main/db/objects';

const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc = (b: Buffer) => { let c = 0xffffffff; for (const x of b) c = crcTable[(c ^ x) & 0xff]! ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
const chunk = (type: string, data: Buffer) => {
  const body = Buffer.concat([Buffer.from(type), data]);
  const len = Buffer.alloc(4), sum = Buffer.alloc(4);
  len.writeUInt32BE(data.length); sum.writeUInt32BE(crc(body));
  return Buffer.concat([len, body, sum]);
};
/** Un PNG 8x8 plein. */
function png(r: number, g: number, b: number): Buffer {
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(8, 0); ihdr.writeUInt32BE(8, 4); ihdr[8] = 8; ihdr[9] = 2;
  const row = Buffer.concat([Buffer.from([0]), Buffer.from(Array.from({ length: 8 }, () => [r, g, b]).flat())]);
  const raw = Buffer.concat(Array.from({ length: 8 }, () => row));
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
const url = (b: Buffer) => `data:image/png;base64,${b.toString('base64')}`;
const RED = png(255, 0, 0), BLUE = png(0, 0, 255);

const fiche: DesignDoc = { formatVersion: '1.0', recordSource: null, props: { Width: 9072 }, sections: [
  { kind: 'formHeader', height: 0, props: { Visible: false }, controls: [] },
  { kind: 'detail', height: 4536, props: {}, controls: [
    { kind: 'commandButton', name: 'Bouton1', left: 6000, top: 200, width: 1800, height: 700, props: { Caption: 'Go' } }] },
  { kind: 'formFooter', height: 0, props: { Visible: false }, controls: [] }] };
const etat: DesignDoc = { formatVersion: '1.0', recordSource: null, props: { Width: 9072 }, sections: [{ kind: 'reportHeader', height: 3000, props: {}, controls: [] }] };

const cur = (page: Page) => page.locator('.doc:not([hidden])');
const list = (page: Page) => page.evaluate(() => (window as unknown as { basecraft: BasecraftApi }).basecraft.resources.list());
const getRes = (page: Page, name: string) => page.evaluate((n) => (window as unknown as { basecraft: BasecraftApi }).basecraft.resources.get([n]), name).then((r) => r[name]);
const openDesign = async (page: Page, kind: 'form' | 'report', name: string) => {
  await page.getByTestId(`nav-item-${kind}-${name}`).click({ button: 'right' });
  await page.getByTestId('nav-menu-design').click();
  await expect(cur(page).getByTestId('designer')).toBeVisible();
};
async function draw(page: Page, body: Locator) {
  const b = (await body.boundingBox())!;
  await page.mouse.move(b.x + 40, b.y + 20);
  await page.mouse.down();
  await page.mouse.move(b.x + 100, b.y + 50, { steps: 3 });
  await page.mouse.move(b.x + 160, b.y + 80, { steps: 3 });
  await page.mouse.up();
}
const formImg = (page: Page) => page.getByTestId('form-ctl-Image1').filter({ visible: true });
async function openReport(page: Page): Promise<Locator> {
  await page.getByTestId('nav-item-report-Etat').dblclick();
  const d = cur(page);
  await expect(d.getByTestId('preview-page-of')).toBeVisible();
  return d;
}
async function openForm(page: Page) {
  await page.getByTestId('nav-item-form-Fiche').dblclick();
  await expect(page.getByTestId('form-run')).toBeVisible();
}
const closeTab = async (page: Page, kind: 'form' | 'report', name: string) => {
  await page.getByTestId(`doc-tab-close-${kind}-${name}`).click();
  await expect(page.getByTestId(`doc-tab-${kind}-${name}`)).toHaveCount(0);
};
/** Le fond mosaïque (formulaire : section Détail ; état : un .bc-bg par page du HTML d'impression), l'image dessinée et celle du bouton. */
async function checkAll(page: Page, color: string) {
  await openForm(page);
  const detail = page.getByTestId('form-section-detail').filter({ visible: true });
  expect(await detail.evaluate((el) => getComputedStyle(el).backgroundImage)).toContain(color);
  await expect(detail).toHaveCSS('background-repeat', 'repeat');
  await expect(formImg(page)).toHaveAttribute('src', color);
  await expect(page.getByTestId('form-ctl-Bouton1').filter({ visible: true }).locator('img')).toHaveAttribute('src', color);
  await closeTab(page, 'form', 'Fiche');
  const d = await openReport(page);
  const bgs = d.locator('.bc-page > .bc-bg');
  await expect(bgs).toHaveCount(await d.locator('.bc-page').count());
  expect(await bgs.first().evaluate((el) => getComputedStyle(el).backgroundImage)).toContain(color);
  await expect(bgs.first()).toHaveCSS('background-repeat', 'repeat');
  await expect(d.locator('img.bc-img')).toHaveAttribute('src', color);
  await closeTab(page, 'report', 'Etat');
}
const setBackground = async (page: Page) => {
  await page.getByTestId('ribbon-tab-format').click();
  await page.getByTestId('cmd-backgroundImage').click();
  await page.getByTestId('image-item-0').click();
  await cur(page).getByTestId('prop-PictureTiling').selectOption('true');
  await page.keyboard.press('Control+s');
};

test('F3: one gallery image drawn, replaced, tiled as background and button picture; saved, compacted, reopened, read-only', async () => {
  test.setTimeout(300000);
  const base = seedBase('recette-f3', (db) => {
    seedForm(db, 'Fiche', fiche);
    const r = saveObject(db, 'report', 'Etat', etat, null);
    if (!r.ok) throw new Error(r.reason);
  });
  const pdf = join(mkdtempSync(join(tmpdir(), 'basecraft-f3-')), 'etat.pdf');
  const env = { BASECRAFT_REGION: 'fr-FR', BASECRAFT_E2E_PDF_PATH: pdf };
  let a = await launchApp({ args: [base], env });
  try {
    const page = a.page;
    // Fiche : Parcourir ajoute le logo à la galerie, un glisser le dessine
    await openDesign(page, 'form', 'Fiche');
    await page.getByTestId('cmd-insertImage').click();
    await page.getByTestId('gallery-file').setInputFiles({ name: 'logo.png', mimeType: 'image/png', buffer: RED });
    await expect(page.getByTestId('tool-image')).toHaveAttribute('aria-pressed', 'true');
    await draw(page, page.locator('[data-section-body="1"]'));
    await expect(page.getByTestId('ctl-Image1')).toBeVisible();
    await page.keyboard.press('Control+s');
    await closeTab(page, 'form', 'Fiche');
    // Etat : la même image
    await openDesign(page, 'report', 'Etat');
    await page.getByTestId('cmd-insertImage').click();
    await page.getByTestId('image-item-0').click();
    await draw(page, cur(page).locator('.dz-block', { has: page.getByTestId('section-reportHeader') }).locator('.dz-body'));
    await expect(page.getByTestId('ctl-Image1')).toBeVisible();
    await page.keyboard.press('Control+s');
    // remplacer l'image partagée : les deux documents suivent
    await page.getByTestId('cmd-insertImage').click();
    await page.getByTestId('image-item-0').click({ button: 'right' });
    const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.getByTestId('gallery-menu-replace').click()]);
    await chooser.setFiles({ name: 'bleu.png', mimeType: 'image/png', buffer: BLUE });
    await expect.poll(() => getRes(page, 'logo')).toBe(url(BLUE));
    await closeTab(page, 'report', 'Etat');
    await openForm(page);
    await expect(formImg(page)).toHaveAttribute('src', url(BLUE));
    await closeTab(page, 'form', 'Fiche');
    const d = await openReport(page);
    await expect(d.locator('img.bc-img')).toHaveAttribute('src', url(BLUE));
    await page.getByTestId('cmd-exportPdf').click();
    await page.getByTestId('modal-btn-ok').click();
    expect(readFileSync(pdf).toString('latin1')).toMatch(/\/Subtype\s*\/Image/);
    await closeTab(page, 'report', 'Etat');

    // le logo en fond mosaïque des deux documents ; le bouton de commande avec le logo
    await openDesign(page, 'form', 'Fiche');
    await setBackground(page);
    await cur(page).getByTestId('ctl-Bouton1').click();
    await cur(page).getByTestId('prop-PictureType').selectOption('shared');
    await cur(page).getByTestId('prop-Picture-shared').click();
    await page.getByTestId('image-item-0').click();
    await page.keyboard.press('Control+s');
    await closeTab(page, 'form', 'Fiche');
    await openDesign(page, 'report', 'Etat');
    await setBackground(page);
    await closeTab(page, 'report', 'Etat');
    await checkAll(page, url(BLUE));

    // Compacter et réparer
    await page.getByTestId('ribbon-tab-databaseTools').click();
    await page.getByTestId('cmd-compactRepair').click();
    await expect(page.getByTestId('modal')).toBeVisible();
    await page.getByTestId('modal-btn-ok').click();
    await expect(page.getByTestId('modal')).toHaveCount(0);
    expect((await list(page)).map((r) => r.name)).toEqual(['logo']);
    await checkAll(page, url(BLUE));
  } finally { await a.app.close(); }

  // fermeture, réouverture
  a = await launchApp({ args: [base], env });
  try {
    expect(await getRes(a.page, 'logo')).toBe(url(BLUE));
    await checkAll(a.page, url(BLUE));
    // une copie en lecture seule (la base est déjà ouverte) dessine tout et n'offre aucune écriture
    const b = await launchApp({ args: [base], env });
    try {
      const page = b.page;
      await expect(page.getByTestId('banner-readonly')).toBeVisible();
      await checkAll(page, url(BLUE));
      await openDesign(page, 'form', 'Fiche');
      await page.getByTestId('ribbon-tab-format').click();
      await page.getByTestId('cmd-backgroundImage').click();
      await expect(page.getByTestId('image-item-0').locator('img')).toHaveAttribute('src', url(BLUE));
      await expect(page.getByTestId('image-none')).toHaveAttribute('aria-disabled', 'true');
      await page.keyboard.press('Escape');
      await page.getByTestId('ribbon-tab-formDesign').click();
      await page.getByTestId('cmd-insertImage').click();
      await page.getByTestId('image-item-0').click({ button: 'right', force: true });
      await expect(page.getByTestId('image-browse')).toBeDisabled();
      await expect(page.getByTestId('gallery-menu-replace')).toBeDisabled();
      await expect(page.getByTestId('gallery-menu-delete')).toBeDisabled();
    } finally { await b.app.close(); }
  } finally { await a.app.close(); }
});
