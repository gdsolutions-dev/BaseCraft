// Insérer une image (F3, tâche 4) : la galerie d'images, Parcourir… (le type vient des octets), l'outil Image armé avec l'image choisie
// (formulaire et état), le refus d'un fichier trop gros, le nom unique d'un second ajout, la base en lecture seule.
import { test, expect, type Locator, type Page } from '@playwright/test';
import type { BasecraftApi } from '../../src/shared/api';
import type { DesignDoc } from '../../src/shared/design/model';
import { addResource } from '../../src/main/db/resources';
import { saveObject } from '../../src/main/db/objects';
import { launchApp, seedBase, seedForm, pickView } from './helpers';

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
const PNG_URL = `data:image/png;base64,${PNG.toString('base64')}`;
const BIG = Buffer.concat([PNG, Buffer.alloc(2 * 1024 * 1024)]);
const list = (page: Page) => page.evaluate(() => (window as unknown as { basecraft: BasecraftApi }).basecraft.resources.list());
const getDef = (page: Page, kind: 'form' | 'report', name: string) =>
  page.evaluate(([k, n]) => (window as unknown as { basecraft: BasecraftApi }).basecraft.objects.get(k as 'form', n!), [kind, name]).then((r) => r.definition as DesignDoc);
const cur = (page: Page) => page.locator('.doc:not([hidden])');

const fiche: DesignDoc = { formatVersion: '1.0', recordSource: null, props: { Width: 9072 }, sections: [
  { kind: 'formHeader', height: 0, props: { Visible: false }, controls: [] },
  { kind: 'detail', height: 4536, props: {}, controls: [] },
  { kind: 'formFooter', height: 0, props: { Visible: false }, controls: [] }] };
const etat: DesignDoc = { formatVersion: '1.0', recordSource: null, props: { Width: 9072 }, sections: [{ kind: 'reportHeader', height: 3000, props: {}, controls: [] }] };

const seed = (name: string, shared = false) => seedBase(name, (db) => {
  seedForm(db, 'Fiche', fiche);
  const r = saveObject(db, 'report', 'Etat', etat, null);
  if (!r.ok) throw new Error(r.reason);
  if (shared) addResource(db, 'Logo', PNG_URL);
});
const openDesign = async (page: Page, kind: 'form' | 'report', name: string) => {
  await page.getByTestId(`nav-item-${kind}-${name}`).click({ button: 'right' });
  await page.getByTestId('nav-menu-design').click();
  await expect(cur(page).getByTestId('designer')).toBeVisible();
};
/** Glisse un rectangle dans le corps de la section (pointeur, par petits pas). */
async function draw(page: Page, body: Locator) {
  const b = (await body.boundingBox())!;
  await page.mouse.move(b.x + 40, b.y + 20);
  await page.mouse.down();
  await page.mouse.move(b.x + 100, b.y + 50, { steps: 3 });
  await page.mouse.move(b.x + 160, b.y + 80, { steps: 3 });
  await page.mouse.up();
}
const browse = (page: Page, name: string, buffer: Buffer, mimeType = 'image/png') => page.getByTestId('gallery-file').setInputFiles({ name, mimeType, buffer });

test('Insert Image on a form: Browse adds to the gallery and arms the tool; limits, unique names, pick an existing image', async () => {
  test.setTimeout(120000);
  const { app, page } = await launchApp({ args: [seed('images-insert-form')], env: { BASECRAFT_REGION: 'fr-FR' } });
  try {
    await openDesign(page, 'form', 'Fiche');
    await page.getByTestId('cmd-insertImage').click();
    await expect(page.getByTestId('image-gallery')).toBeVisible();
    await expect(page.getByTestId('image-gallery-empty')).toBeVisible();
    await expect(page.getByTestId('image-browse')).toBeEnabled();

    // Parcourir : le PNG entre dans la galerie, l'outil est armé, un glisser dessine Image1
    await browse(page, 'Logo société.png', PNG);
    await expect(page.getByTestId('image-gallery')).toHaveCount(0);
    await expect(page.getByTestId('tool-image')).toHaveAttribute('aria-pressed', 'true');
    await draw(page, page.locator('[data-section-body="1"]'));
    await expect(page.getByTestId('ctl-Image1')).toBeVisible();
    await page.keyboard.press('Control+s');
    await expect.poll(async () => (await getDef(page, 'form', 'Fiche')).sections[1]!.controls[0]?.props).toMatchObject({ PictureType: 'shared', Picture: 'Logo société' });

    // la galerie rouverte montre l'image
    await page.getByTestId('cmd-insertImage').click();
    await expect(page.getByTestId('image-item-0')).toHaveAttribute('data-image-name', 'Logo société');
    await expect(page.getByTestId('image-item-0').locator('img')).toHaveAttribute('src', PNG_URL);
    await expect(page.getByTestId('image-gallery-empty')).toHaveCount(0);

    // 2 Mo : le message, rien n'est ajouté
    await browse(page, 'Grosse.png', BIG);
    await expect(page.getByTestId('modal')).toBeVisible();
    await page.getByTestId('modal-btn-ok').click();
    await expect(page.getByTestId('modal')).toHaveCount(0);
    expect((await list(page)).map((r) => r.name)).toEqual(['Logo société']);

    // un PNG nommé .jpg est rangé comme PNG ; le même nom ajouté deux fois reçoit « (2) »
    await page.getByTestId('cmd-insertImage').click();
    await browse(page, 'Logo société.jpg', PNG, 'image/jpeg');
    await expect(page.getByTestId('tool-image')).toHaveAttribute('aria-pressed', 'true');
    expect((await list(page)).map((r) => [r.name, r.type])).toEqual([['Logo société', 'png'], ['Logo société (2)', 'png']]);
    await page.getByTestId('tool-select').click();

    // choisir une image existante arme l'outil sans rien ajouter
    await page.getByTestId('cmd-insertImage').click();
    await page.getByTestId('image-item-0').click();
    await expect(page.getByTestId('image-gallery')).toHaveCount(0);
    await expect(page.getByTestId('tool-image')).toHaveAttribute('aria-pressed', 'true');
    expect(await list(page)).toHaveLength(2);
  } finally { await app.close(); }
});

test('Insert Image on a report: the drawn control uses the shared image and the preview draws it', async () => {
  test.setTimeout(120000);
  const { app, page } = await launchApp({ args: [seed('images-insert-report', true)], env: { BASECRAFT_REGION: 'fr-FR' } });
  try {
    await openDesign(page, 'report', 'Etat');
    await page.getByTestId('cmd-insertImage').click();
    await page.getByTestId('image-item-0').click();
    await expect(page.getByTestId('tool-image')).toHaveAttribute('aria-pressed', 'true');
    await draw(page, cur(page).locator('.dz-block', { has: page.getByTestId('section-reportHeader') }).locator('.dz-body'));
    await expect(page.getByTestId('ctl-Image1')).toBeVisible();
    await page.keyboard.press('Control+s');
    await expect.poll(async () => (await getDef(page, 'report', 'Etat')).sections[0]!.controls[0]?.props).toMatchObject({ PictureType: 'shared', Picture: 'Logo' });
    await page.getByTestId('ribbon-tab-reportDesign').click();
    await pickView(page, 'viewPrintPreview');
    await expect(cur(page).getByTestId('report-preview')).toBeVisible();
    await expect(cur(page).locator('img.bc-img')).toHaveAttribute('src', PNG_URL);
  } finally { await app.close(); }
});

test('Insert Image on a read-only base: the gallery opens with its thumbnails, Browse is disabled', async () => {
  const base = seed('images-insert-ro', true);
  const a = await launchApp({ args: [base] });
  const b = await launchApp({ args: [base], env: { BASECRAFT_REGION: 'fr-FR' } });
  try {
    const page = b.page;
    await expect(page.getByTestId('banner-readonly')).toBeVisible();
    await openDesign(page, 'form', 'Fiche');
    await page.getByTestId('cmd-insertImage').click();
    await expect(page.getByTestId('image-item-0').locator('img')).toHaveAttribute('src', PNG_URL);
    await expect(page.getByTestId('image-browse')).toBeDisabled();
  } finally { await b.app.close(); await a.app.close(); }
});
