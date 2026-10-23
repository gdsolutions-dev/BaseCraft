import { test, expect, type Page } from '@playwright/test';
import { existsSync, mkdtempSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createTable } from '../../src/main/db/schema';
import { insertRow } from '../../src/main/db/write-layer';
import { localeInfo } from '../../src/shared/locale-format';
import { clients } from '../../src/shared/test-fixtures';
import { launchApp, seedBase } from './helpers';

const fr = JSON.parse(readFileSync(join(__dirname, '../../src/shared/i18n/fr.json'), 'utf8'));
const FR = { BASECRAFT_REGION: 'fr-FR' };
const MARKER = 44, HEADER = 34, ROW = 30, AUTONUMBER = 80; // DatasheetView's geometry (datasheet.spec.ts)

const clientsBase = (name: string, ...noms: string[]) => seedBase(name, async (db) => {
  createTable(db, clients);
  for (const nom of noms) await insertRow(db, clients, { Nom: nom }, localeInfo('fr-FR'));
});
function nomsInFile(base: string): unknown[] {
  const db = new DatabaseSync(base, { readOnly: true });
  try { return db.prepare('SELECT Nom FROM Clients ORDER BY rowid').all().map((r) => (r as { Nom: unknown }).Nom); } finally { db.close(); }
}
const backups = (base: string) => readdirSync(dirname(base)).filter((f) => f.includes('.backup-'));
const cellEditor = (page: Page) => page.getByTestId('grid-editor-portal').locator('textarea');

/** A new record in the open Clients datasheet with Âge only (Nom is required): the row stays pending, invalid. */
async function invalidPendingRow(page: Page) {
  await page.getByTestId('nav-item-Clients').dblclick();
  const grid = page.getByTestId('datasheet').getByTestId('data-grid-canvas');
  await expect(grid).toBeVisible();
  const b = (await grid.boundingBox())!;
  await page.mouse.click(b.x + MARKER + AUTONUMBER + 30, b.y + HEADER + 1 * ROW + ROW / 2); // the trailing row's Nom
  await expect(cellEditor(page)).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(cellEditor(page)).toHaveCount(0);
  await expect(page.getByTestId('datasheet').locator('td[role=gridcell]:focus')).toHaveCount(1);
  await page.keyboard.press('7');
  await expect(cellEditor(page)).toBeFocused();
}
async function compactFromRibbon(page: Page) {
  await page.getByTestId('ribbon-tab-databaseTools').click();
  await page.getByTestId('cmd-compactRepair').click();
}

test('Compact and Repair asks about an unsaved document first, then compacts with a backup; data intact', async () => {
  const base = await clientsBase('compacter', 'Dupont');
  const { app, page } = await launchApp({ args: [base], env: FR });
  try {
    await invalidPendingRow(page);
    await compactFromRibbon(page);
    await expect(page.getByTestId('modal')).toContainText(`« Nom » : ${fr.fieldError.required}`); // the save tried first
    await page.getByTestId('modal-btn-ok').click();
    await expect(page.getByTestId('modal')).toContainText(fr.datasheet.discard.replace('{{name}}', 'Clients'));
    await page.getByTestId('modal-btn-no').click(); // the document stays: nothing is compacted
    await expect(page.getByTestId('modal')).toHaveCount(0);
    await expect(page.getByTestId('doc-tab-Clients')).toHaveCount(1);
    expect(backups(base)).toEqual([]);

    await compactFromRibbon(page);
    await page.getByTestId('modal-btn-ok').click();
    await page.getByTestId('modal-btn-yes').click(); // discard: every document closes, then the base is compacted
    const done = page.getByTestId('modal');
    await expect(done).toContainText(fr.compact.title);
    expect(backups(base)).toHaveLength(1);
    const backup = join(dirname(base), backups(base)[0]);
    await expect(done).toContainText(`Sauvegarde : ${backup}`);
    await expect(page.getByTestId('doc-tab-Clients')).toHaveCount(0);
    await page.getByTestId('modal-btn-ok').click();
    expect(await page.evaluate(() => (window as any).basecraft.base.state())).toMatchObject({ path: base, readOnly: false });
    expect(await page.evaluate(() => (window as any).basecraft.rows.count('Clients'))).toBe(1);
    expect(existsSync(`${base}.lock`)).toBe(true); // the lock is kept
  } finally {
    await app.close();
  }
  expect(nomsInFile(base)).toEqual(['Dupont']);
  expect(nomsInFile(join(dirname(base), backups(base)[0]))).toEqual(['Dupont']);
  expect(readdirSync(dirname(base)).filter((f) => /\.(compact|bc-tmp)$/.test(f))).toEqual([]);
});

test('File › Save As opens the copy (title bar, recent files); the open file itself is refused', async () => {
  const base = await clientsBase('original', 'Dupont');
  const copy = join(mkdtempSync(join(tmpdir(), 'basecraft-saveas-')), 'Copie.basecraft');
  const { app, page, userDataDir } = await launchApp({ args: [base], env: { ...FR, BASECRAFT_E2E_SAVE_PATH: copy } });
  try {
    await expect(page.getByTestId('nav-item-Clients')).toBeVisible(); // opened: File clicked earlier is closed by the opening
    await page.getByTestId('ribbon-tab-file').click();
    await page.getByTestId('bs-save-as').click();
    await expect(page).toHaveTitle(/^Copie\.basecraft/);
    expect(await page.evaluate(() => (window as any).basecraft.base.state())).toMatchObject({ path: copy, readOnly: false });
    expect(JSON.parse(readFileSync(join(userDataDir, 'settings.json'), 'utf8')).recentFiles[0]).toBe(copy);
    await page.getByTestId('ribbon-tab-file').click();
    await expect(page.getByTestId('bs-recent-0')).toHaveAttribute('title', copy);
    expect(existsSync(`${base}.lock`)).toBe(false); // the original is closed

    // the same file (another spelling of its path on Windows and macOS) is refused
    const same = process.platform === 'linux' ? copy : copy.toUpperCase();
    await app.evaluate((_e, p) => { process.env.BASECRAFT_E2E_SAVE_PATH = p; }, same);
    await page.getByTestId('bs-save-as').click();
    await expect(page.getByTestId('modal')).toContainText(fr.dialog.error.sameFile);
    await page.getByTestId('modal-btn-ok').click();
    expect(await page.evaluate(() => (window as any).basecraft.base.state())).toMatchObject({ path: copy, readOnly: false });
  } finally {
    await app.close();
  }
  expect(nomsInFile(copy)).toEqual(['Dupont']);
  expect(nomsInFile(base)).toEqual(['Dupont']);
});
