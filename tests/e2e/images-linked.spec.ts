// B7: linked pictures (PictureType 'linked', a file path) are read by the main process, as pictures only and never from a network path.
import { test, expect } from '@playwright/test';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { deflateSync } from 'node:zlib';
import type { ControlDef, DesignDoc } from '../../src/shared/design/model';
import { launchApp, seedBase, seedForm } from './helpers';

const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc = (b: Buffer) => { let c = 0xffffffff; for (const x of b) c = crcTable[(c ^ x) & 0xff]! ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
const chunk = (type: string, data: Buffer) => {
  const body = Buffer.concat([Buffer.from(type), data]);
  const len = Buffer.alloc(4), sum = Buffer.alloc(4);
  len.writeUInt32BE(data.length); sum.writeUInt32BE(crc(body));
  return Buffer.concat([len, body, sum]);
};
function png(): Buffer {
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(8, 0); ihdr.writeUInt32BE(8, 4); ihdr[8] = 8; ihdr[9] = 2;
  const row = Buffer.concat([Buffer.from([0]), Buffer.from(Array.from({ length: 8 }, () => [255, 0, 0]).flat())]);
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(Buffer.concat(Array.from({ length: 8 }, () => row)))), chunk('IEND', Buffer.alloc(0))]);
}

// Linked pictures must sit in the base's folder (owner, 2026-11-13): the doc names them relative to it; one picture outside.
const outsideDir = mkdtempSync(join(tmpdir(), 'linked-pic-out-'));
const outside = join(outsideDir, 'out.png');
writeFileSync(outside, png());
const img = (name: string, left: number, path: string): ControlDef => ({ kind: 'image', name, left, top: 100, width: 1200, height: 1000, props: { PictureType: 'linked', Picture: path } });
const doc = (kind: 'detail' | 'reportHeader'): DesignDoc => ({ formatVersion: '1.0', recordSource: null, props: { Width: 9500 },
  sections: [{ kind, height: 1300, props: {}, controls: [img('Bonne', 100, 'ok.png'), img('Fausse', 1500, 'fake.png'), img('Absente', 2900, 'none.png'),
    img('Reseau', 4300, '\\\\127.0.0.1\\share\\x.png'), img('Dehors', 5700, outside)] }] });
/** A base whose folder holds ok.png (a picture) and fake.png (not one). */
async function base(name: string): Promise<string> {
  const file = await seedBase(name, async (db) => { seedForm(db, 'Fiche', doc('detail')); });
  writeFileSync(join(dirname(file), 'ok.png'), png());
  writeFileSync(join(dirname(file), 'fake.png'), 'MZ not a picture');
  return file;
}

test('a linked picture shows from its file in the base folder; a missing, non-image, network or outside path shows nothing', async () => {
  const { app, page } = await launchApp({ args: [await base('images-linked')] });
  try {
    await page.getByTestId('nav-item-form-Fiche').dblclick();
    await expect(page.getByTestId('form-run')).toBeVisible();
    await expect(page.getByTestId('form-ctl-Bonne').filter({ visible: true })).toHaveAttribute('src', /^data:image\/png;base64,/);
    for (const n of ['Fausse', 'Absente', 'Reseau', 'Dehors']) await expect(page.getByTestId(`form-ctl-${n}`).filter({ visible: true }).locator('xpath=self::img')).toHaveCount(0);
  } finally { await app.close(); }
});

test('the property sheet shows the linked path; Choose… keeps a file of the base folder relative and refuses one outside', async () => {
  const file = await base('images-linked-sheet');
  const { app, page } = await launchApp({ args: [file], env: { BASECRAFT_E2E_PICTURE_PATH: join(dirname(file), 'ok.png') } });
  try {
    await page.getByTestId('nav-item-form-Fiche').click({ button: 'right' });
    await page.getByTestId('nav-menu-design').click();
    await page.getByTestId('ctl-Absente').click();
    const sheet = page.locator('[data-testid="prop-PictureType"]:visible');
    await expect(sheet).toHaveValue('linked');
    await page.locator('[data-testid="prop-Picture-linked"]:visible').click();
    await expect(page.locator('[data-testid="prop-Picture-path"]:visible')).toHaveText('ok.png');
  } finally { await app.close(); }
  const second = await launchApp({ args: [file], env: { BASECRAFT_E2E_PICTURE_PATH: outside } });
  try {
    const page = second.page;
    await page.getByTestId('nav-item-form-Fiche').click({ button: 'right' });
    await page.getByTestId('nav-menu-design').click();
    await page.getByTestId('ctl-Absente').click();
    await page.locator('[data-testid="prop-Picture-linked"]:visible').click();
    await expect(page.getByText("Une image liée doit se trouver dans le dossier de la base de données")).toBeVisible();
  } finally { await second.app.close(); }
});
