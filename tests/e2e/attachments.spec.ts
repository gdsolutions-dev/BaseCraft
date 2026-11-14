// C5: the Attachment field (datasheet cell, Attachments box) and the Attachment control of a form.
import { test, expect, type Page } from '@playwright/test';
import { existsSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { deflateSync } from 'node:zlib';
import { addAttachments } from '../../src/main/db/attachments';
import { createTable } from '../../src/main/db/schema';
import type { ControlDef, DesignDoc } from '../../src/shared/design/model';
import { f, t } from '../../src/shared/test-fixtures';
import { colLeft, inFile, launchApp, seedBase, seedForm } from './helpers';

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

const dir = mkdtempSync(join(tmpdir(), 'att-'));
const note = join(dir, 'note.txt'), prog = join(dir, 'setup.exe');
writeFileSync(note, 'hello attachment');
writeFileSync(prog, 'MZ not really a program');
const MARKER = 44, HEADER = 34, ROW = 30;

const base = (name: string) => seedBase(name, (db) => {
  createTable(db, t('Clients', [f('Nom', 'shortText'), f('Pieces', 'attachment')]));
  db.exec(`INSERT INTO "Clients"("Nom") VALUES ('Abel'), ('Bea')`);
});

async function dblclickPieces(page: Page, row = 0) {
  await page.getByTestId('nav-item-Clients').dblclick();
  const canvas = page.getByTestId('datasheet').getByTestId('data-grid-canvas');
  await expect(canvas).toBeVisible();
  const b = (await canvas.boundingBox())!;
  await page.mouse.dblclick(b.x + colLeft(1) + 30, b.y + HEADER + row * ROW + ROW / 2);
  void MARKER;
}

test('Attachments box: add, count in the cell, Save As, Save All, Open asks first, Remove', async () => {
  const out = join(dir, 'saved.txt'), folder = mkdtempSync(join(tmpdir(), 'att-all-'));
  const file = base('att-sheet');
  const { app, page } = await launchApp({ args: [file], env: { BASECRAFT_REGION: 'fr-FR', BASECRAFT_E2E_ATTACH_PATHS: `${note}|${prog}`, BASECRAFT_E2E_ATTACH_SAVE_PATH: out, BASECRAFT_E2E_ATTACH_FOLDER: folder } });
  try {
    await dblclickPieces(page);
    const box = page.getByTestId('attachments-dialog');
    await expect(box).toBeVisible();
    await expect(page.getByTestId('att-none')).toBeVisible();
    await page.getByTestId('att-add').click();
    await expect(page.getByTestId('att-item-1')).toContainText('setup.exe');
    // Save As (the selected one: the last added) and Save All
    await page.getByTestId('att-item-0').click();
    await page.getByTestId('att-saveAs').click();
    await expect.poll(() => existsSync(out)).toBe(true);
    expect(readFileSync(out, 'utf8')).toBe('hello attachment');
    await page.getByTestId('att-saveAll').click();
    await expect.poll(() => readdirSync(folder).sort()).toEqual(['note.txt', 'setup.exe']);
    // Open: declined, then confirmed (a program gets the stronger wording); the temp copy is what the system is asked to open
    await page.getByTestId('att-item-1').click();
    await page.getByTestId('att-open').click();
    await expect(page.getByTestId('att-confirm')).toContainText('programme ou un script');
    await page.getByTestId('att-confirm-no').click();
    expect(await app.evaluate(() => process.env.BASECRAFT_E2E_ATTACH_OPENED ?? '')).toBe('');
    await page.getByTestId('att-open').click();
    await page.getByTestId('att-confirm-yes').click();
    await expect.poll(() => app.evaluate(() => process.env.BASECRAFT_E2E_ATTACH_OPENED ?? '')).toMatch(/setup\.exe$/);
    // Remove one, then OK: the cell counts the files left
    await page.getByTestId('att-remove').click();
    await expect(page.getByTestId('att-item-1')).toHaveCount(0);
    await page.getByTestId('att-ok').click();
    await expect(box).toHaveCount(0);
    await expect(page.getByTestId('datasheet').getByTestId('glide-cell-2-0')).toContainText('(1)');
  } finally { await app.close(); }
  expect(inFile<{ name: string }>(file, 'SELECT name FROM bc_attachments').map((r) => r.name)).toEqual(['note.txt']);
  expect(inFile<{ Pieces: number | null }>(file, 'SELECT "Pieces" FROM Clients ORDER BY rowid').map((r) => r.Pieces !== null)).toEqual([true, false]);
});

test('a file over 25 MB is refused, nothing is added', async () => {
  const big = join(dir, 'big.bin');
  writeFileSync(big, Buffer.alloc(25 * 1024 * 1024 + 1));
  const { app, page } = await launchApp({ args: [base('att-big')], env: { BASECRAFT_REGION: 'fr-FR', BASECRAFT_E2E_ATTACH_PATHS: big } });
  try {
    await dblclickPieces(page);
    await page.getByTestId('att-add').click();
    await expect(page.getByText(/25 Mo/)).toBeVisible();
    await expect(page.getByTestId('att-item-0')).toHaveCount(0);
  } finally { await app.close(); }
});

const ctl = (name: string, kind: ControlDef['kind'], left: number, top: number, width: number, height: number): ControlDef =>
  ({ kind, name, left, top, width, height, props: { ControlSource: name === 'Fichiers' ? 'Pieces' : name } });
const doc: DesignDoc = { formatVersion: '1.0', recordSource: { kind: 'table', name: 'Clients' }, props: { Width: 6000 },
  sections: [{ kind: 'detail', height: 2600, props: {}, controls: [ctl('Nom', 'textBox', 100, 100, 1800, 340), ctl('Fichiers', 'attachment', 100, 600, 2400, 1700)] }] };

test('the Attachment control shows the first picture, goes through the files, opens the box; a new record has none', async () => {
  const file = await seedBase('att-form', async (db) => {
    createTable(db, t('Clients', [f('Nom', 'shortText'), f('Pieces', 'attachment')]));
    db.exec(`INSERT INTO "Clients"("Nom") VALUES ('Abel'), ('Bea')`);
    addAttachments(db, 'Clients', 'Pieces', 1, [{ name: 'photo.png', data: png() }, { name: 'a.txt', data: Buffer.from('x') }]);
    seedForm(db, 'Fiche', doc);
  });
  const { app, page } = await launchApp({ args: [file], env: { BASECRAFT_REGION: 'fr-FR', BASECRAFT_E2E_ATTACH_PATHS: note } });
  try {
    await page.getByTestId('nav-item-form-Fiche').dblclick();
    const c = page.getByTestId('form-ctl-Fichiers').filter({ visible: true });
    await expect(c).toHaveAttribute('data-count', '2');
    await expect(page.getByTestId('form-att-img-Fichiers').filter({ visible: true })).toHaveAttribute('src', /^data:image\/png;base64,/);
    await expect(page.getByTestId('form-att-pos-Fichiers').filter({ visible: true })).toHaveText('1/2');
    await page.getByTestId('form-att-next-Fichiers').filter({ visible: true }).click();
    await expect(page.getByTestId('form-att-name-Fichiers').filter({ visible: true })).toHaveText('a.txt');
    // the second record has no file: the box adds one, the control follows
    await page.locator('[data-testid="nav-record-input"]:visible').fill('2');
    await page.keyboard.press('Enter');
    await expect(c).toHaveAttribute('data-count', '0');
    await c.dblclick();
    await page.getByTestId('att-add').click();
    await expect(page.getByTestId('att-item-0')).toContainText('note.txt');
    await page.getByTestId('att-ok').click();
    await expect(c).toHaveAttribute('data-count', '1');
  } finally { await app.close(); }
});
