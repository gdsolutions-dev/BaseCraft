// Recette of batch E1 (Access import, tables and data): each of the four fixtures is imported into a front-end; the datasheets of the
// local tables show what Access shows (tests/fixtures/access/expected.ts, as recette-c2 reads the linked ones), a row is edited and
// saved (the tables are local), the report says Photo is ignored (Ventes.accdb: the other fixtures hold no Photo column) and keys and indexes were not read. On Ventes.accdb:
// a second import offers Clients1, a stopped import leaves the Navigation Pane unchanged, a third import succeeds.
import { test, expect, type Page } from '@playwright/test';
import { copyFileSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ACCESS_EXPECTED, ACCESS_PASSWORD } from '../fixtures/access/expected';
import type { BasecraftApi } from '../../src/shared/api';
import { launchApp, seedBase } from './helpers';

const fr = JSON.parse(readFileSync(join(__dirname, '../../src/shared/i18n/fr.json'), 'utf8'));
const FIXTURES = join(__dirname, '../fixtures/access');
const MARKER = 44, HEADER = 34, ROW = 30; // DatasheetView: row selector width, header and row heights
const doc = (page: Page) => page.locator('section[role=tabpanel]:not([hidden])');
const cell = (page: Page, col: number, row: number) => doc(page).getByTestId(`glide-cell-${col + 1}-${row}`);
const plain = (s: string) => s.replace(/[  ]/g, ' ');
const asText = (rows: (string | boolean)[][]) => rows.map((r) => r.map(String));
const CLIENTS = ACCESS_EXPECTED.clients, ORDERS = ACCESS_EXPECTED.commandes;

async function select(page: Page, col: number, row: number) {
  const b = (await doc(page).getByTestId('datasheet').getByTestId('data-grid-canvas').boundingBox())!;
  await page.mouse.click(b.x + MARKER + 20, b.y + HEADER + ROW / 2);
  await expect(cell(page, 0, 0)).toBeFocused();
  for (let i = 0; i < row; i++) await page.keyboard.press('ArrowDown');
  for (let i = 0; i < col; i++) await page.keyboard.press('ArrowRight');
  await expect(cell(page, col, row)).toBeFocused();
}
/** The text a cell paints in its field's format (Currency), as Home › Selection quotes it (recette-c2). */
async function painted(page: Page, col: number, row: number): Promise<string> {
  await page.getByTestId('ribbon-tab-home').click();
  await select(page, col, row);
  await page.getByTestId('cmd-filterSelection').click();
  const text = (await page.getByTestId('filter-menu-equals').textContent()) ?? '';
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('filter-menu')).toHaveCount(0);
  return plain(/"(.*)"/s.exec(text)?.[1] ?? text);
}
async function shown(page: Page, rows: number, cols: number, money: number[] = []): Promise<string[][]> {
  await expect(doc(page).getByTestId('nav-record-count')).toHaveText(String(rows));
  const out: string[][] = [];
  for (let r = 0; r < rows; r++) {
    const row: string[] = [];
    for (let c = 0; c < cols; c++) row.push(money.includes(c) ? await painted(page, c, r) : plain((await cell(page, c, r).textContent()) ?? ''));
    out.push(row);
  }
  return out;
}
async function openSheet(page: Page, name: string) {
  await page.getByTestId(`nav-item-${name}`).dblclick();
  await expect(doc(page).getByTestId('datasheet').getByTestId('data-grid-canvas')).toBeVisible();
  await expect(page.getByTestId(`doc-tab-${name}`)).toHaveAttribute('aria-selected', 'true');
}
const closeTab = (page: Page, name: string) => page.getByTestId(`doc-tab-close-${name}`).click();
const openImport = async (page: Page) => {
  await page.getByTestId('ribbon-tab-externalData').click();
  await page.getByTestId('cmd-importAccess').click();
};
/** E1 is the file-only import: this PC may have Access, which would be the default choice (batch E2). */
const fileOnly = (page: Page) => page.getByTestId('import-structure-file').check();
/** Past the password prompt of a protected file. */
async function password(page: Page) {
  await page.getByTestId('modal-input').fill(ACCESS_PASSWORD);
  await page.getByTestId('modal-btn-ok').click();
}

for (const file of ['Ventes.accdb', 'Ventes.mdb', 'Ventes-mdp.accdb', 'Ventes-mdp.mdb']) {
  test(`recette E1: ${file} — the three tables imported with Access's values, a row edited, the report`, async () => {
    test.setTimeout(240_000);
    const dir = mkdtempSync(join(tmpdir(), 'basecraft-recette-e1-'));
    copyFileSync(join(FIXTURES, file), join(dir, file)); // the import reads the copy, never the committed file
    const photo = file === 'Ventes.accdb' /* the fixtures README: the others hold no Photo column */, locked = file.includes('-mdp');
    const { app, page } = await launchApp({ args: [seedBase('Front', () => {})], env: { BASECRAFT_REGION: 'fr-FR', BASECRAFT_E2E_LINK_PATH: join(dir, file) } });
    try {
      await openImport(page);
      if (locked) await password(page);
      await fileOnly(page);
      for (const n of ['Clients', 'Commandes', 'Divers']) await page.getByTestId(`link-table-${n}`).check();
      await page.getByTestId('link-ok').click();
      const report = page.getByTestId('import-report');
      await expect(report).toContainText(fr.import.server.done.replace('{{names}}', 'Clients, Commandes, Divers'));
      if (photo) await expect(page.getByTestId('report-ignored').getByTestId('report-line-fieldSkipped')).toContainText('Photo');
      else await expect(page.getByTestId('report-line-fieldSkipped')).toHaveCount(0);
      await expect(page.getByTestId('report-approximated').getByTestId('report-line-structureNotRead')).toBeVisible();
      await page.getByTestId('import-close').click();

      // the datasheets of the local tables hold Access's values
      await openSheet(page, 'Clients');
      expect(await shown(page, CLIENTS.length, CLIENTS[0]!.length)).toEqual(asText(CLIENTS));
      // a row edited and saved: Dupont's Nom, read again after the sheet is closed and reopened
      await page.getByTestId('ribbon-tab-home').click();
      await select(page, 1, 0);
      await page.keyboard.press('D');
      await expect(page.getByTestId('grid-editor-portal').locator('textarea')).toBeFocused();
      await page.keyboard.type('upond2');
      await page.keyboard.press('Enter');
      await expect(page.getByTestId('grid-editor-portal').locator('textarea')).toHaveCount(0);
      await page.keyboard.press('ArrowDown'); // leaving the row saves it
      await expect(page.getByTestId('doc-tab-Clients')).not.toContainText('•');
      await closeTab(page, 'Clients');
      await openSheet(page, 'Clients');
      await expect(cell(page, 1, 0)).toHaveText('Dupond2');
      await closeTab(page, 'Clients');

      await openSheet(page, 'Commandes');
      expect(await shown(page, ORDERS.length, ORDERS[0]!.length, [2])).toEqual(ORDERS);
      await closeTab(page, 'Commandes');

      await openSheet(page, 'Divers');
      expect((await shown(page, 1, 1))[0]).toEqual([ACCESS_EXPECTED.divers[0]]); // Heure is a draft value of expected.ts (a time-only display Access's screen has to settle)
      await closeTab(page, 'Divers');
    } finally {
      await app.close();
    }
  });
}

test('recette E1: a second import offers Clients1; a stopped import leaves the Navigation Pane unchanged; a third succeeds', async () => {
  test.setTimeout(240_000);
  const dir = mkdtempSync(join(tmpdir(), 'basecraft-recette-e1-'));
  copyFileSync(join(FIXTURES, 'Ventes.accdb'), join(dir, 'Ventes.accdb'));
  // The engine reads one row per page here (BASECRAFT_E2E_IMPORT_PAGE, honoured only under BASECRAFT_E2E=1), so Stop is reachable on a small file.
  const { app, page } = await launchApp({ args: [seedBase('Front', () => {})],
    env: { BASECRAFT_REGION: 'fr-FR', BASECRAFT_E2E_LINK_PATH: join(dir, 'Ventes.accdb'), BASECRAFT_E2E_IMPORT_PAGE: '1' } });
  try {
    await openImport(page);
    await fileOnly(page);
    for (const n of ['Clients', 'Commandes', 'Divers']) await page.getByTestId(`link-table-${n}`).check();
    await page.getByTestId('link-ok').click();
    await expect(page.getByTestId('import-report')).toBeVisible();
    await page.getByTestId('import-close').click();

    // second import: the names in use are numbered
    await openImport(page);
    for (const n of ['Clients1', 'Commandes1', 'Divers1']) await expect(page.getByTestId(`link-table-${n}`)).toBeVisible();
    await page.getByTestId('link-cancel').click();
    await expect(page.getByTestId('modal')).toHaveCount(0);
    // Stop, through the bridge: on a file this small the dialog's Stop button is gone (the report is up) before a click can land, even at one row
    // per page, so the import is run from the page and stopped on its first progress event (what the button sends).
    const stopped = await page.evaluate(async () => {
      const api = (window as unknown as { basecraft: BasecraftApi }).basecraft;
      const path = (await api.links.pick('access'))!;
      const off = api.accessImport.onProgress(() => { void api.queries.cancel(); });
      try { return await api.accessImport.run(path, ['Clients', 'Commandes', 'Divers']); } finally { off(); }
    });
    expect(stopped).toEqual({ ok: false, reason: 'cancelled' });
    for (const n of ['Clients', 'Commandes', 'Divers']) await expect(page.getByTestId(`nav-item-${n}`)).toBeVisible();
    for (const n of ['Clients1', 'Commandes1', 'Divers1']) await expect(page.getByTestId(`nav-item-${n}`)).toHaveCount(0);

    // third import succeeds
    await openImport(page);
    await fileOnly(page);
    await page.getByTestId('link-table-Clients1').check();
    await page.getByTestId('link-ok').click();
    await expect(page.getByTestId('import-report')).toContainText(fr.import.server.done.replace('{{names}}', 'Clients1'));
    await page.getByTestId('import-close').click();
    await expect(page.getByTestId('nav-item-Clients1')).toBeVisible();
  } finally {
    await app.close();
  }
});
