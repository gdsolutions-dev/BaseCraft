// Images partagées (F3, tâche 3) : un formulaire et un état dessinent l'image de la galerie ; la remplacer redessine les vues
// ouvertes sans les rouvrir ; une image absente donne le repère (formulaire) et l'avertissement pictureMissing (état).
// Le HTML d'impression est celui de l'aperçu (renderPageHtml / renderDocumentHtml partagent le même rendu d'image).
import { test, expect, type Page } from '@playwright/test';
import { deflateSync } from 'node:zlib';
import { addResource } from '../../src/main/db/resources';
import type { BasecraftApi } from '../../src/shared/api';
import type { ControlDef, DesignDoc } from '../../src/shared/design/model';
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
/** Un PNG 8x8 plein, couleur RGB. */
function png(r: number, g: number, b: number): string {
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(8, 0); ihdr.writeUInt32BE(8, 4); ihdr[8] = 8; ihdr[9] = 2;
  const row = Buffer.concat([Buffer.from([0]), Buffer.from(Array.from({ length: 8 }, () => [r, g, b]).flat())]);
  const raw = Buffer.concat(Array.from({ length: 8 }, () => row));
  const bytes = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
  return `data:image/png;base64,${bytes.toString('base64')}`;
}
const RED = png(255, 0, 0), BLUE = png(0, 0, 255);

const image = (picture: string): ControlDef => ({ kind: 'image', name: 'Image1', left: 200, top: 100, width: 1500, height: 1000, props: { PictureType: 'shared', Picture: picture } });
const doc = (kind: 'detail' | 'reportHeader', picture: string): DesignDoc => ({ formatVersion: '1.0', recordSource: null, props: { Width: 5000 },
  sections: [{ kind, height: 1300, props: {}, controls: [image(picture)] }] });

const seed = (name: string, picture: string) => seedBase(name, async (db) => {
  addResource(db, 'rouge', RED);
  addResource(db, 'bleu', BLUE);
  seedForm(db, 'Fiche', doc('detail', picture));
  const r = saveObject(db, 'report', 'Etat', doc('reportHeader', picture), null);
  if (!r.ok) throw new Error(r.reason);
});
const replace = (page: Page, name: string, url: string) => page.evaluate(([n, u]) => (window as unknown as { basecraft: BasecraftApi }).basecraft.resources.replace(n!, u!), [name, url]);
const img = (page: Page) => page.getByTestId('form-ctl-Image1').filter({ visible: true });
const openReport = async (page: Page) => {
  await page.getByTestId('nav-item-report-Etat').dblclick();
  const d = page.locator('.doc:not([hidden])');
  await expect(d.getByTestId('preview-page-of')).toBeVisible();
  return d;
};

test('a form draws the shared image and redraws it when the image is replaced', async () => {
  const { app, page } = await launchApp({ args: [await seed('images-form', 'rouge')] });
  try {
    await page.getByTestId('nav-item-form-Fiche').dblclick();
    await expect(page.getByTestId('form-run')).toBeVisible();
    await expect(img(page)).toHaveAttribute('src', RED);
    await replace(page, 'rouge', BLUE);
    await expect(img(page)).toHaveAttribute('src', BLUE);
  } finally { await app.close(); }
});

test('a report draws the shared image once and redraws it when the image is replaced', async () => {
  const { app, page } = await launchApp({ args: [await seed('images-report', 'rouge')] });
  try {
    const d = await openReport(page);
    await expect(d.locator('img.bc-img')).toHaveCount(1);
    await expect(d.locator('img.bc-img')).toHaveAttribute('src', RED);
    await replace(page, 'rouge', BLUE);
    await expect(d.locator('img.bc-img')).toHaveAttribute('src', BLUE);
    await expect(d.locator('img.bc-img')).toHaveCount(1);
  } finally { await app.close(); }
});

test('a missing shared image: placeholder on a form, one pictureMissing warning on a report', async () => {
  const { app, page } = await launchApp({ args: [await seed('images-missing', 'absente')] });
  try {
    await page.getByTestId('nav-item-form-Fiche').dblclick();
    await expect(page.getByTestId('form-run')).toBeVisible();
    await expect(img(page)).toBeVisible();
    await expect(img(page)).not.toHaveAttribute('src', /.*/);
    const d = await openReport(page);
    await expect(d.locator('img.bc-img')).toHaveCount(0);
    await expect(d.getByTestId('report-issues').locator('li')).toHaveCount(1);
  } finally { await app.close(); }
});
