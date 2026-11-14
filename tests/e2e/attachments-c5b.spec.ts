// C5b: what C5 left for the Attachment field: files of removed rows, a query's column, the box from a form's Datasheet view, the report
// control and its PDF.
import { test, expect, type Locator, type Page } from '@playwright/test';
import type { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { deflateSync } from 'node:zlib';
import { addAttachments } from '../../src/main/db/attachments';
import { saveObject } from '../../src/main/db/objects';
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

const dir = mkdtempSync(join(tmpdir(), 'att5b-'));
const note = join(dir, 'note.txt');
writeFileSync(note, 'hello attachment');
const HEADER = 34, ROW = 30;

/** Abel: a picture and a text file; Bea: a PDF; Cleo: none. */
const seed = (name: string, extra?: (db: DatabaseSync) => void) => seedBase(name, (db) => {
  createTable(db, t('Clients', [f('Nom', 'shortText'), f('Pieces', 'attachment')]));
  db.exec(`INSERT INTO "Clients"("Nom") VALUES ('Abel'), ('Bea'), ('Cleo')`);
  addAttachments(db, 'Clients', 'Pieces', 1, [{ name: 'photo.png', data: png() }, { name: 'a.txt', data: Buffer.from('x') }]);
  addAttachments(db, 'Clients', 'Pieces', 2, [{ name: 'doc.pdf', data: Buffer.from('%PDF-1.4') }]);
  extra?.(db);
});

const dblclickCell = async (page: Page, grid: Locator, left: number, row: number) => {
  await expect(grid).toBeVisible();
  const b = (await grid.boundingBox())!;
  await page.mouse.dblclick(b.x + left, b.y + HEADER + row * ROW + ROW / 2);
};

test('Compact removes a set no cell references, and keeps the others', async () => {
  const file = seed('att5b-compact', (db) => db.exec(`INSERT INTO bc_attachments (set_id, name, type, data, created) VALUES (99, 'orphan.txt', 'txt', x'41', '')`));
  expect(inFile<{ n: number }>(file, 'SELECT count(*) AS n FROM bc_attachments')[0]!.n).toBe(4);
  const { app, page } = await launchApp({ args: [file] });
  try {
    await page.getByTestId('ribbon-tab-databaseTools').click();
    await page.getByTestId('cmd-compactRepair').click();
    await expect(page.getByTestId('modal')).toBeVisible();
    await page.getByTestId('modal-btn-ok').click();
  } finally { await app.close(); }
  expect(inFile<{ name: string }>(file, 'SELECT name FROM bc_attachments ORDER BY id').map((r) => r.name)).toEqual(['photo.png', 'a.txt', 'doc.pdf']);
});

test("a query's attachment column shows the number of files; a double-click opens the box when the query is updatable", async () => {
  const file = seed('att5b-query', (db) => {
    saveObject(db, 'query', 'QClients', { formatVersion: '1.0', sql: 'SELECT Nom, Pieces FROM Clients ORDER BY Nom;' }, null);
    saveObject(db, 'query', 'QJoint', { formatVersion: '1.0', sql: 'SELECT a.Nom, a.Pieces FROM Clients AS a INNER JOIN Clients AS b ON a.Nom = b.Nom;' }, null);
  });
  const { app, page } = await launchApp({ args: [file], env: { BASECRAFT_E2E_ATTACH_PATHS: note } });
  try {
    await page.getByTestId('nav-item-query-QClients').dblclick();
    const sheet = page.getByTestId('datasheet').filter({ visible: true });
    await expect(sheet.getByTestId('glide-cell-2-0')).toContainText('(2)');
    await expect(sheet.getByTestId('glide-cell-2-1')).toContainText('(1)');
    await expect(sheet.getByTestId('glide-cell-2-2')).toContainText('(0)');
    await dblclickCell(page, sheet.getByTestId('data-grid-canvas'), colLeft(1) + 30, 2);
    await expect(page.getByTestId('attachments-dialog')).toBeVisible();
    await page.getByTestId('att-add').click();
    await expect(page.getByTestId('att-item-0')).toContainText('note.txt');
    await page.getByTestId('att-ok').click();
    await expect(sheet.getByTestId('glide-cell-2-2')).toContainText('(1)');
    // a join is not updatable: the files are shown, the box does not open
    await page.getByTestId('nav-item-query-QJoint').dblclick();
    const joined = page.getByTestId('datasheet').filter({ visible: true });
    await expect(joined.getByTestId('glide-cell-2-0')).toContainText('(2)');
    await dblclickCell(page, joined.getByTestId('data-grid-canvas'), colLeft(1) + 30, 0);
    await expect(page.getByTestId('attachments-dialog')).toHaveCount(0);
  } finally { await app.close(); }
});

const ctl = (name: string, kind: ControlDef['kind'], left: number, width: number, height: number): ControlDef =>
  ({ kind, name, left, top: 100, width, height, props: { ControlSource: name === 'Fichiers' ? 'Pieces' : name, TabIndex: left } });
const formDoc: DesignDoc = { formatVersion: '1.0', recordSource: { kind: 'table', name: 'Clients' }, props: { Width: 6000, DefaultView: 'datasheet' },
  sections: [{ kind: 'detail', height: 1900, props: {}, controls: [ctl('Nom', 'textBox', 100, 1800, 340), ctl('Fichiers', 'attachment', 2000, 2400, 1700)] }] };

test("the Attachments box opens from a form's Datasheet view", async () => {
  const file = seed('att5b-sheet', (db) => seedForm(db, 'Fiche', formDoc));
  const { app, page } = await launchApp({ args: [file], env: { BASECRAFT_E2E_ATTACH_PATHS: note } });
  try {
    await page.getByTestId('nav-item-form-Fiche').dblclick();
    const sheet = page.locator('[data-testid="form-datasheet"]:visible');
    await expect(sheet.getByTestId('glide-cell-2-0')).toContainText('(2)');
    await dblclickCell(page, sheet.getByTestId('data-grid-canvas'), 44 + 120 + 40, 0);
    await expect(page.getByTestId('attachments-dialog')).toBeVisible();
    await expect(page.getByTestId('att-item-1')).toContainText('a.txt');
    await page.getByTestId('att-add').click();
    await expect(page.getByTestId('att-item-2')).toContainText('note.txt');
    await page.getByTestId('att-ok').click();
    await expect(sheet.getByTestId('glide-cell-2-0')).toContainText('(3)');
  } finally { await app.close(); }
});

const reportDoc: DesignDoc = { formatVersion: '1.0', recordSource: { kind: 'table', name: 'Clients' }, props: { Width: 6000 },
  sections: [{ kind: 'detail', height: 1800, props: {}, controls: [
    { kind: 'textBox', name: 'Nom', left: 100, top: 100, width: 1800, height: 340, props: { ControlSource: 'Nom', BorderStyle: 'transparent' } },
    { kind: 'attachment', name: 'Fichiers', left: 2000, top: 100, width: 1500, height: 1500, props: { ControlSource: 'Pieces' } }] }] };

test('a report draws the first picture or the file-type icon of each row, and prints it to PDF', async () => {
  const pdf = join(mkdtempSync(join(tmpdir(), 'att5b-pdf-')), 'clients.pdf');
  const file = seed('att5b-report', (db) => { const r = saveObject(db, 'report', 'Etat', reportDoc, null); if (!r.ok) throw new Error(r.reason); });
  const { app, page } = await launchApp({ args: [file], env: { BASECRAFT_E2E_PDF_PATH: pdf } });
  try {
    await page.getByTestId('nav-group-report').getByTestId('nav-item-report-Etat').dblclick();
    await expect(page.locator('.doc:not([hidden])').getByTestId('preview-page-of')).toHaveText(/^Page 1 sur \d+$/);
    const imgs = page.locator('.doc:not([hidden]) [data-testid="report-pages"] img.bc-img');
    await expect(imgs).toHaveCount(2); // Cleo has no file
    await expect(imgs.nth(0)).toHaveAttribute('src', /^data:image\/png;base64,/);
    await expect(imgs.nth(1)).toHaveAttribute('src', /^data:image\/svg\+xml/);
    await page.getByTestId('cmd-exportPdf').click();
    await expect(page.getByTestId('modal')).toBeVisible();
    await page.getByTestId('modal-btn-ok').click();
  } finally { await app.close(); }
  expect(readFileSync(pdf).toString('latin1').startsWith('%PDF-')).toBe(true);
});
