// Recette F3a : la galerie d'images partagée de bout en bout. Un logo ajouté par Parcourir sur le formulaire Fiche, choisi dans
// la galerie sur l'état Etat ; remplacé par un second PNG, les deux documents (vues, aperçu et PDF de l'état) portent les nouveaux octets ;
// Compacter et réparer, fermeture et réouverture : la galerie et les deux dessins sont intacts ; une base préparée par basecraft-cli
// (resource.add puis form.create) s'ouvre et dessine.
import { test, expect, type Locator, type Page } from '@playwright/test';
import { deflateSync } from 'node:zlib';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { BasecraftApi } from '../../src/shared/api';
import type { DesignDoc } from '../../src/shared/design/model';
import { spawnSync } from 'node:child_process';
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
  { kind: 'detail', height: 4536, props: {}, controls: [] },
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
/** Ouvre l'état en aperçu et rend l'élément document. */
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

test('F3a: one gallery image on a form and a report, replaced, compacted, reopened', async () => {
  test.setTimeout(240000);
  const base = seedBase('recette-f3a', (db) => {
    seedForm(db, 'Fiche', fiche);
    const r = saveObject(db, 'report', 'Etat', etat, null);
    if (!r.ok) throw new Error(r.reason);
  });
  const pdf = join(mkdtempSync(join(tmpdir(), 'basecraft-f3a-')), 'etat.pdf');
  const env = { BASECRAFT_REGION: 'fr-FR', BASECRAFT_E2E_PDF_PATH: pdf };
  let a = await launchApp({ args: [base], env });
  try {
    const page = a.page;
    // Fiche : Parcourir ajoute le logo à la galerie et arme l'outil, un glisser le dessine
    await openDesign(page, 'form', 'Fiche');
    await page.getByTestId('cmd-insertImage').click();
    await page.getByTestId('gallery-file').setInputFiles({ name: 'logo.png', mimeType: 'image/png', buffer: RED });
    await expect(page.getByTestId('tool-image')).toHaveAttribute('aria-pressed', 'true');
    await draw(page, page.locator('[data-section-body="1"]'));
    await expect(page.getByTestId('ctl-Image1')).toBeVisible();
    await page.keyboard.press('Control+s');
    await closeTab(page, 'form', 'Fiche');

    // Etat : la même image choisie dans la galerie
    await openDesign(page, 'report', 'Etat');
    await page.getByTestId('cmd-insertImage').click();
    await expect(page.getByTestId('image-item-0')).toHaveAttribute('data-image-name', 'logo');
    await page.getByTestId('image-item-0').click();
    await draw(page, cur(page).locator('.dz-block', { has: page.getByTestId('section-reportHeader') }).locator('.dz-body'));
    await expect(page.getByTestId('ctl-Image1')).toBeVisible();
    await page.keyboard.press('Control+s');

    // Remplacer par un second PNG : même nom, nouveaux octets
    await page.getByTestId('cmd-insertImage').click();
    await page.getByTestId('image-item-0').click({ button: 'right' });
    const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.getByTestId('gallery-menu-replace').click()]);
    await chooser.setFiles({ name: 'bleu.png', mimeType: 'image/png', buffer: BLUE });
    await expect.poll(() => getRes(page, 'logo')).toBe(url(BLUE));
    await closeTab(page, 'report', 'Etat');

    const check = async (color: string) => {
      await openForm(page);
      await expect(formImg(page)).toHaveAttribute('src', color);
      await closeTab(page, 'form', 'Fiche');
      const d = await openReport(page);
      await expect(d.locator('img.bc-img')).toHaveCount(1);
      await expect(d.locator('img.bc-img')).toHaveAttribute('src', color);
    };
    await check(url(BLUE));
    // le PDF de l'état : écrit, avec une image
    await page.getByTestId('cmd-exportPdf').click();
    await expect(page.getByTestId('modal')).toBeVisible();
    await page.getByTestId('modal-btn-ok').click();
    expect(readFileSync(pdf).toString('latin1')).toMatch(/\/Subtype\s*\/Image/);
    await closeTab(page, 'report', 'Etat');

    // Compacter et réparer
    await page.getByTestId('ribbon-tab-databaseTools').click();
    await page.getByTestId('cmd-compactRepair').click();
    await expect(page.getByTestId('modal')).toBeVisible();
    await page.getByTestId('modal-btn-ok').click();
    await expect(page.getByTestId('modal')).toHaveCount(0);
    expect((await list(page)).map((r) => r.name)).toEqual(['logo']);
    await check(url(BLUE));
  } finally { await a.app.close(); }

  // fermeture, réouverture
  a = await launchApp({ args: [base], env });
  try {
    const page = a.page;
    expect(await getRes(page, 'logo')).toBe(url(BLUE));
    expect((await list(page)).map((r) => r.name)).toEqual(['logo']);
    await openForm(page);
    await expect(formImg(page)).toHaveAttribute('src', url(BLUE));
    await closeTab(page, 'form', 'Fiche');
    const d = await openReport(page);
    await expect(d.locator('img.bc-img')).toHaveAttribute('src', url(BLUE));
  } finally { await a.app.close(); }
});

test('F3a: a base prepared with basecraft-cli (resource.add then form.create) opens and draws', async () => {
  test.setTimeout(120000);
  const dir = mkdtempSync(join(tmpdir(), 'basecraft-f3a-cli-'));
  const base = join(dir, 'cli.basecraft'), img = join(dir, 'logo.png'), spec = join(dir, 'spec.json');
  writeFileSync(img, RED);
  const doc: DesignDoc = { formatVersion: '1.0', recordSource: null, props: { Width: 5000 }, sections: [{ kind: 'detail', height: 1300, props: {}, controls: [
    { kind: 'image', name: 'Image1', left: 200, top: 100, width: 1500, height: 1000, props: { PictureType: 'shared', Picture: 'logo' } }] }] };
  writeFileSync(spec, JSON.stringify([{ op: 'resource.add', file: img }, { op: 'form.create', name: 'Fiche', layout: 'doc', doc }]));
  // le CLI construit (npm run build:cli), comme livré
  const cli = (...args: string[]) => spawnSync(process.execPath, ['out/cli/basecraft-cli.mjs', ...args], { encoding: 'utf8' });
  for (const args of [['new', base], ['script', spec, base]]) { const r = cli(...args); expect(r.stderr).toBe(''); expect(r.status).toBe(0); }
  expect(JSON.parse(cli('resources', base).stdout)).toEqual([{ name: 'logo', type: 'png', bytes: RED.length }]);
  const a = await launchApp({ args: [base] });
  try {
    expect((await list(a.page)).map((r) => r.name)).toEqual(['logo']);
    await openForm(a.page);
    await expect(formImg(a.page)).toHaveAttribute('src', url(RED));
  } finally { await a.app.close(); }
});
