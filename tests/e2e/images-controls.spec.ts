// Contrôle image (alignement, mosaïque) et image du bouton de commande (F3, tâche 9).
import { test, expect } from '@playwright/test';
import { deflateSync } from 'node:zlib';
import { addResource } from '../../src/main/db/resources';
import type { ControlDef, DesignDoc } from '../../src/shared/design/model';
import type { MacroItem } from '../../src/shared/macro/model';
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


const ctl = (kind: ControlDef['kind'], name: string, left: number, props: Record<string, unknown>): ControlDef => ({ kind, name, left, top: 100, width: 1500, height: 1000, props });
const click = { embedded: { formatVersion: '1.0' as const, items: [{ k: 'action', action: 'MessageBox', args: { Message: 'clic', Title: 'T', Beep: 'no', Type: 'none' } } as MacroItem] } };
const doc = (kind: 'detail' | 'reportHeader', controls: ControlDef[]): DesignDoc => ({ formatVersion: '1.0', recordSource: null, props: { Width: 8000 },
  sections: [{ kind, height: 1300, props: {}, controls }] });
const image = ctl('image', 'Image1', 200, { Picture: RED, SizeMode: 'clip', PictureAlignment: 'bottomRight' });
const tiled = ctl('image', 'Tuiles', 2000, { Picture: RED, PictureTiling: true });
const bouton = (picture: string) => ctl('commandButton', 'Bouton1', 4000, { Caption: 'Go', PictureType: 'shared', Picture: picture, OnClick: click });

const seed = (name: string, picture: string) => seedBase(name, async (db) => {
  addResource(db, 'rouge', RED);
  seedForm(db, 'Fiche', doc('detail', [image, tiled, bouton(picture)]));
  const r = saveObject(db, 'report', 'Etat', doc('reportHeader', [image, tiled]), null);
  if (!r.ok) throw new Error(r.reason);
});

test('a form image aligns bottom right, tiles as a repeated background, and the button shows its picture and still clicks', async () => {
  const { app, page } = await launchApp({ args: [await seed('images-controls', 'rouge')] });
  try {
    await page.getByTestId('nav-item-form-Fiche').dblclick();
    await expect(page.getByTestId('form-run')).toBeVisible();
    await expect(page.getByTestId('form-ctl-Image1').filter({ visible: true })).toHaveCSS('object-position', /100% 100%|right bottom/);
    const t = page.getByTestId('form-ctl-Tuiles').filter({ visible: true });
    await expect(t).toHaveCSS('background-repeat', 'repeat');
    expect(await t.evaluate((e) => e.tagName)).toBe('DIV');
    const b = page.getByTestId('form-ctl-Bouton1').filter({ visible: true });
    await expect(b.locator('img')).toHaveAttribute('src', RED);
    await expect(b).toContainText('Go');
    await b.click();
    await expect(page.getByTestId('macro-msgbox-text')).toHaveText('clic');
    await page.getByTestId('macro-msgbox-ok').click();
  } finally { await app.close(); }
});

test('a button whose shared picture is missing shows its caption alone', async () => {
  const { app, page } = await launchApp({ args: [await seed('images-button-missing', 'absente')] });
  try {
    await page.getByTestId('nav-item-form-Fiche').dblclick();
    const b = page.getByTestId('form-ctl-Bouton1').filter({ visible: true });
    await expect(b).toContainText('Go');
    await expect(b.locator('img')).toHaveCount(0);
  } finally { await app.close(); }
});

test('a report prints the aligned image with object-position and the tiled one as a repeated background div', async () => {
  const { app, page } = await launchApp({ args: [await seed('images-controls-report', 'rouge')] });
  try {
    await page.getByTestId('nav-item-report-Etat').dblclick();
    const d = page.locator('.doc:not([hidden])');
    await expect(d.getByTestId('preview-page-of')).toBeVisible();
    await expect(d.locator('img.bc-img')).toHaveCSS('object-position', /100% 100%|right bottom/);
    await expect(d.locator('div.bc-img')).toHaveCSS('background-repeat', 'repeat');
  } finally { await app.close(); }
});
