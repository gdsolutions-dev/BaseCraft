// Gérer la galerie d'images (F3, tâche 5) : Remplacer et Supprimer au clic droit, le refus d'une image utilisée, les lignes Type image / Image
// de la feuille de propriétés du contrôle Image (incorporée ou partagée), la base en lecture seule.
import { test, expect, type Page } from '@playwright/test';
import type { BasecraftApi } from '../../src/shared/api';
import type { ControlDef, DesignDoc } from '../../src/shared/design/model';
import { addResource } from '../../src/main/db/resources';
import { saveObject } from '../../src/main/db/objects';
import { launchApp, seedBase, seedForm } from './helpers';

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
const url = (b: Buffer) => `data:image/png;base64,${b.toString('base64')}`;
const PNG_URL = url(PNG);
const PNG2 = Buffer.concat([PNG, Buffer.from([0, 1, 2, 3])]);   // même image, octets en plus : une autre URL de données
const BIG = Buffer.concat([PNG, Buffer.alloc(2 * 1024 * 1024)]);
const SVG = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"/>');
const cur = (page: Page) => page.locator('.doc:not([hidden])');
const list = (page: Page) => page.evaluate(() => (window as unknown as { basecraft: BasecraftApi }).basecraft.resources.list());
const getDef = (page: Page, kind: 'form' | 'report', name: string) =>
  page.evaluate(([k, n]) => (window as unknown as { basecraft: BasecraftApi }).basecraft.objects.get(k as 'form', n!), [kind, name]).then((r) => r.definition as DesignDoc);

const image = (props: Record<string, unknown>): ControlDef => ({ kind: 'image', name: 'Image1', left: 200, top: 100, width: 1500, height: 1000, props });
const formDoc = (props: Record<string, unknown>): DesignDoc => ({ formatVersion: '1.0', recordSource: null, props: { Width: 5000 },
  sections: [{ kind: 'detail', height: 1300, props: {}, controls: [image(props)] }] });
const reportDoc = (props: Record<string, unknown>): DesignDoc => ({ formatVersion: '1.0', recordSource: null, props: { Width: 5000 },
  sections: [{ kind: 'reportHeader', height: 1300, props: {}, controls: [image(props)] }] });

const seed = (name: string, props: Record<string, unknown> = { PictureType: 'shared', Picture: 'Logo' }) => seedBase(name, (db) => {
  addResource(db, 'Logo', PNG_URL);
  seedForm(db, 'Fiche', formDoc(props));
  const r = saveObject(db, 'report', 'Etat', reportDoc(props), null);
  if (!r.ok) throw new Error(r.reason);
});
const openDesign = async (page: Page, kind: 'form' | 'report', name: string) => {
  await page.getByTestId(`nav-item-${kind}-${name}`).click({ button: 'right' });
  await page.getByTestId('nav-menu-design').click();
  await expect(cur(page).getByTestId('designer')).toBeVisible();
};
const openGallery = async (page: Page) => {
  if (await page.getByTestId('image-gallery').count()) return;   // un message l'a peut-être refermée
  await page.getByTestId('cmd-insertImage').click();
  await expect(page.getByTestId('image-gallery')).toBeVisible();
};
const ok = async (page: Page) => { await expect(page.getByTestId('modal')).toBeVisible(); await page.getByTestId('modal-btn-ok').click(); await expect(page.getByTestId('modal')).toHaveCount(0); };
/** Remplacer : le menu ouvre le sélecteur de fichier (le même champ que Parcourir). */
async function replaceWith(page: Page, item: string, file: { name: string; mimeType: string; buffer: Buffer }) {
  await page.getByTestId(item).click({ button: 'right' });
  const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.getByTestId('gallery-menu-replace').click()]);
  await chooser.setFiles(file);
}

test('Replace keeps the name, redraws every open view and dirties nothing; invalid files are refused', async () => {
  test.setTimeout(120000);
  const { app, page } = await launchApp({ args: [seed('images-manage-replace')], env: { BASECRAFT_REGION: 'fr-FR' } });
  try {
    await openDesign(page, 'form', 'Fiche');
    await openDesign(page, 'report', 'Etat');
    await openGallery(page);
    await replaceWith(page, 'image-item-0', { name: 'x.png', mimeType: 'image/png', buffer: PNG2 });
    await expect.poll(async () => (await page.evaluate(() => (window as unknown as { basecraft: BasecraftApi }).basecraft.resources.get(['Logo']))).Logo).toBe(url(PNG2));
    await expect(cur(page).getByTestId('ctl-Image1').locator('img')).toHaveAttribute('src', url(PNG2));
    await page.getByTestId('doc-tab-form-Fiche').click();
    await expect(cur(page).getByTestId('ctl-Image1').locator('img')).toHaveAttribute('src', url(PNG2));
    await expect(page.getByTestId('doc-tab-form-Fiche')).not.toContainText('•');
    await expect(page.getByTestId('doc-tab-report-Etat')).not.toContainText('•');
    expect((await list(page)).map((r) => r.name)).toEqual(['Logo']);

    // un SVG, puis 2 Mo : le message, les octets restent
    await openGallery(page);
    await replaceWith(page, 'image-item-0', { name: 'x.svg', mimeType: 'image/svg+xml', buffer: SVG });
    await ok(page);
    await openGallery(page);
    await replaceWith(page, 'image-item-0', { name: 'big.png', mimeType: 'image/png', buffer: BIG });
    await ok(page);
    expect((await page.evaluate(() => (window as unknown as { basecraft: BasecraftApi }).basecraft.resources.get(['Logo']))).Logo).toBe(url(PNG2));

    // un Remplacer annulé (sélecteur jamais validé) ne fait pas remplacer le Parcourir suivant : il ajoute
    await openGallery(page);
    await page.getByTestId('image-item-0').click({ button: 'right' });
    await Promise.all([page.waitForEvent('filechooser'), page.getByTestId('gallery-menu-replace').click()]);
    await openGallery(page);
    const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.getByTestId('image-browse').click()]);
    await chooser.setFiles({ name: 'add.png', mimeType: 'image/png', buffer: PNG });
    await expect.poll(async () => (await list(page)).map((r) => r.name).sort()).toEqual(['Logo', 'add']);
    expect((await page.evaluate(() => (window as unknown as { basecraft: BasecraftApi }).basecraft.resources.get(['Logo']))).Logo).toBe(url(PNG2));
  } finally { await app.close(); }
});

test('Delete is refused with the count while saved objects use the image, then works once they do not', async () => {
  test.setTimeout(120000);
  const { app, page } = await launchApp({ args: [seed('images-manage-delete')], env: { BASECRAFT_REGION: 'fr-FR' } });
  try {
    await openDesign(page, 'form', 'Fiche');
    await openGallery(page);
    await page.getByTestId('image-item-0').click({ button: 'right' });
    await page.getByTestId('gallery-menu-delete').click();
    await expect(page.getByTestId('modal')).toContainText('2');
    await ok(page);
    expect((await list(page)).map((r) => r.name)).toEqual(['Logo']);

    // le formulaire sans le contrôle, enregistré ; l'état reste : encore refusé (1)
    await page.keyboard.press('Escape');
    await cur(page).getByTestId('ctl-Image1').click();
    await page.keyboard.press('Delete');
    await page.keyboard.press('Control+s');
    await expect.poll(async () => (await getDef(page, 'form', 'Fiche')).sections.flatMap((x) => x.controls).length).toBe(0);
    await openGallery(page);
    await page.getByTestId('image-item-0').click({ button: 'right' });
    await page.getByTestId('gallery-menu-delete').click();
    await expect(page.getByTestId('modal')).toContainText('1');
    await ok(page);

    await openDesign(page, 'report', 'Etat');
    await cur(page).getByTestId('ctl-Image1').click();
    await page.keyboard.press('Delete');
    await page.keyboard.press('Control+s');
    await expect.poll(async () => (await getDef(page, 'report', 'Etat')).sections[0]!.controls.length).toBe(0);
    await openGallery(page);
    await page.getByTestId('image-item-0').click({ button: 'right' });
    await page.getByTestId('gallery-menu-delete').click();
    await expect(page.getByTestId('image-item-0')).toHaveCount(0);
    expect(await list(page)).toEqual([]);
  } finally { await app.close(); }
});

test('Property Sheet of an Image control: shared picture from the gallery, switching type clears, embedded file keeps a data URL', async () => {
  test.setTimeout(120000);
  const { app, page } = await launchApp({ args: [seed('images-manage-sheet', {})], env: { BASECRAFT_REGION: 'fr-FR' } });
  try {
    await openDesign(page, 'form', 'Fiche');
    await cur(page).getByTestId('ctl-Image1').click();
    const sheet = cur(page).getByTestId('property-sheet');
    await expect(sheet.getByTestId('prop-PictureType')).toHaveValue('embedded');
    await sheet.getByTestId('prop-PictureType').selectOption('shared');
    await sheet.getByTestId('prop-Picture-shared').click();
    await page.getByTestId('image-item-0').click();
    await expect(sheet.getByTestId('prop-Picture-shared')).toHaveText('Logo');
    await page.keyboard.press('Control+s');
    await expect.poll(async () => (await getDef(page, 'form', 'Fiche')).sections.flatMap((x) => x.controls)[0]!.props).toMatchObject({ PictureType: 'shared', Picture: 'Logo' });

    // revenir à Incorporé efface le nom
    await sheet.getByTestId('prop-PictureType').selectOption('embedded');
    await expect(sheet.getByTestId('prop-Picture-shared')).toHaveCount(0);
    // une seule annulation rend le type ET le nom
    await page.keyboard.press('Control+z');
    await expect(sheet.getByTestId('prop-PictureType')).toHaveValue('shared');
    await expect(sheet.getByTestId('prop-Picture-shared')).toHaveText('Logo');
    await sheet.getByTestId('prop-PictureType').selectOption('embedded');
    await expect(sheet.getByTestId('prop-Picture-shared')).toHaveCount(0);
    await page.keyboard.press('Control+s');
    await expect.poll(async () => (await getDef(page, 'form', 'Fiche')).sections.flatMap((x) => x.controls)[0]!.props.Picture).toBeUndefined();

    // une image incorporée choisie par le bouton fichier reste une URL de données, sans PictureType
    await sheet.getByTestId('prop-Picture-file').setInputFiles({ name: 'p.png', mimeType: 'image/png', buffer: PNG });
    await page.keyboard.press('Control+s');
    await expect.poll(async () => (await getDef(page, 'form', 'Fiche')).sections.flatMap((x) => x.controls)[0]!.props).toMatchObject({ Picture: PNG_URL });
    expect((await getDef(page, 'form', 'Fiche')).sections.flatMap((x) => x.controls)[0]!.props.PictureType).toBeUndefined();
  } finally { await app.close(); }
});

test('Read-only base: Replace and Delete are disabled, the picture type row too', async () => {
  const base = seed('images-manage-ro');
  const a = await launchApp({ args: [base] });
  const b = await launchApp({ args: [base], env: { BASECRAFT_REGION: 'fr-FR' } });
  try {
    const page = b.page;
    await expect(page.getByTestId('banner-readonly')).toBeVisible();
    await openDesign(page, 'form', 'Fiche');
    await openGallery(page);
    await page.getByTestId('image-item-0').click({ button: 'right', force: true });
    await expect(page.getByTestId('gallery-menu-replace')).toBeDisabled();
    await expect(page.getByTestId('gallery-menu-delete')).toBeDisabled();
    await page.keyboard.press('Escape');
    await page.keyboard.press('Escape');
    await cur(page).getByTestId('ctl-Image1').click();
    await expect(cur(page).getByTestId('prop-PictureType')).toBeDisabled();
  } finally { await b.app.close(); await a.app.close(); }
});
