// C3: a data file shared by front-ends — optimistic locking and the Write Conflict dialog (R8, R9), the refresh interval (R10).
import { test, expect, type Page } from '@playwright/test';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createBaseFile, openBaseFile } from '../../src/main/db/file-format';
import { saveStartupOptions } from '../../src/main/db/startup';
import { addLinks } from '../../src/main/links/store';
import { seedSales } from '../../src/main/query/test-db';
import type { ControlDef, DesignDoc } from '../../src/shared/design/model';
import { DEFAULT_STARTUP } from '../../src/shared/startup';
import { inFile, launchApp, seedForm } from './helpers';

const fr = JSON.parse(readFileSync(join(__dirname, '../../src/shared/i18n/fr.json'), 'utf8'));
const ENV = { BASECRAFT_REGION: 'fr-FR', BASECRAFT_E2E_SETTLE_MS: '0' };

const box = (name: string, top: number, i: number): ControlDef =>
  ({ kind: 'textBox', name, left: 1701, top, width: 2268, height: 340, props: { ControlSource: name, TabIndex: i } });
const FCLIENTS: DesignDoc = {
  formatVersion: '1.0', recordSource: { kind: 'table', name: 'Clients' }, props: { Width: 9072 },
  sections: [{ kind: 'formHeader', height: 0, props: { Visible: false }, controls: [] },
    { kind: 'detail', height: 2268, props: {}, controls: [box('Nom', 100, 0), box('Ville', 600, 1)] },
    { kind: 'formFooter', height: 0, props: { Visible: false }, controls: [] }],
};

/** share/Ventes_donnees.basecraft (seedSales, a data file) and two front-ends fe-a, fe-b linking its tables (fe-a: the form FClients). */
function layout(): { data: string; a: string; b: string } {
  const root = mkdtempSync(join(tmpdir(), 'basecraft-c3-'));
  for (const d of ['share', 'fe-a', 'fe-b']) mkdirSync(join(root, d));
  const data = join(root, 'share', 'Ventes_donnees.basecraft');
  createBaseFile(data, '0.0.0');
  let { db } = openBaseFile(data, 'write', '0.0.0');
  try { seedSales(db); saveStartupOptions(db, { ...DEFAULT_STARTUP, dataFile: true }); } finally { db.close(); }
  const [a, b] = ['fe-a', 'fe-b'].map((d) => join(root, d, 'Ventes.basecraft'));
  for (const fe of [a!, b!]) {
    createBaseFile(fe, '0.0.0');
    ({ db } = openBaseFile(fe, 'write', '0.0.0'));
    try { addLinks(db, fe, 'basecraft', data, ['Clients', 'Commandes']); if (fe === a) seedForm(db, 'FClients', FCLIENTS); } finally { db.close(); }
  }
  return { data, a: a!, b: b! };
}

/** Durand's record in the data file (a write in progress elsewhere waits out the busy timeout). */
const durand = (data: string) => inFile<{ Nom: string; Ville: string }>(data, `SELECT "Nom", "Ville" FROM "Clients" WHERE "N°" = 3`)[0];

/** The tab shown's datasheet (another open tab keeps its view mounted, hidden). */
const sheet = (page: Page) => page.getByTestId('datasheet').filter({ visible: true });
const cell = (page: Page, col: number, row: number) => sheet(page).getByTestId(`glide-cell-${col + 1}-${row}`);
/** Types in the cell (N° 80 px, Nom and Ville 170, row selector 44, header 34, rows 30). `leave`: Enter, the next row (saved);
 *  else Shift+Tab, the row stays pending. */
async function typeIn(page: Page, col: 1 | 2, row: number, text: string, leave: boolean) {
  const b = (await sheet(page).getByTestId('data-grid-canvas').boundingBox())!;
  await page.mouse.click(b.x + 44 + 80 + (col - 1) * 170 + 30, b.y + 34 + row * 30 + 15);
  await expect(cell(page, col, row)).toBeFocused();
  await page.keyboard.press(text[0]!);
  await page.keyboard.type(text.slice(1));
  await page.keyboard.press(leave ? 'Enter' : 'Shift+Tab');
  await expect(page.getByTestId('doc-tab-Clients')).toHaveText(leave ? /^[^•]*$/ : /•/);
}
const open = async (page: Page, item: string) => { await page.getByTestId(item).dblclick(); };

test('two front-ends, one record: Write Conflict in the datasheet — Drop Changes, Copy to Clipboard, Save Record', async () => {
  const { data, a: feA, b: feB } = layout();
  const a = await launchApp({ args: [feA], env: ENV });
  const b = await launchApp({ args: [feB], env: ENV });
  try {
    for (const p of [a.page, b.page]) { await open(p, 'nav-item-Clients'); await expect(cell(p, 2, 2)).toHaveText('Paris'); }

    // B saves Brest while A types Lille; A leaves its row: Drop Changes, A shows Brest
    await typeIn(a.page, 2, 2, 'Lille', false);
    await typeIn(b.page, 2, 2, 'Brest', true);
    await expect.poll(() => durand(data)?.Ville).toBe('Brest');
    await a.page.keyboard.press('ArrowDown');
    await expect(a.page.getByTestId('write-conflict')).toContainText(fr.wc.message);
    await expect(a.page.getByTestId('modal')).toContainText(fr.wc.title);
    await a.page.getByTestId('wc-drop').click();
    await expect(a.page.getByTestId('modal')).toHaveCount(0);
    await expect(cell(a.page, 2, 2)).toHaveText('Brest');
    await expect(a.page.getByTestId('doc-tab-Clients')).not.toContainText('•');
    expect(durand(data)?.Ville).toBe('Brest');

    // Copy to Clipboard: A's record (names, then values as shown), then as Drop Changes
    await typeIn(a.page, 2, 2, 'Lille', false);
    await typeIn(b.page, 2, 2, 'Rennes', true);
    await expect.poll(() => durand(data)?.Ville).toBe('Rennes');
    await a.page.keyboard.press('ArrowDown');
    await a.page.getByTestId('wc-copy').click();
    await expect(cell(a.page, 2, 2)).toHaveText('Rennes');
    const clip = (await a.app.evaluate(({ clipboard }) => clipboard.readText())).split(/\r?\n/).map((l) => l.split('\t'));
    expect(clip).toEqual([['N°', 'Nom', 'Ville'], ['3', 'Durand', 'Lille']]);
    expect(durand(data)?.Ville).toBe('Rennes');

    // Save Record: last writer wins
    await typeIn(a.page, 2, 2, 'Lille', false);
    await typeIn(b.page, 2, 2, 'Vannes', true);
    await expect.poll(() => durand(data)?.Ville).toBe('Vannes');
    await a.page.keyboard.press('ArrowDown');
    await a.page.getByTestId('wc-save').click();
    await expect(a.page.getByTestId('doc-tab-Clients')).not.toContainText('•');
    await expect.poll(() => durand(data)?.Ville).toBe('Lille');
    await expect(cell(a.page, 2, 2)).toHaveText('Lille');
  } finally {
    await a.app.close();
    await b.app.close();
  }
});

test('a form against a datasheet of another front-end: Save Record writes only the form’s change; a record deleted meanwhile', async () => {
  const { data, a: feA, b: feB } = layout();
  const a = await launchApp({ args: [feA], env: ENV });
  const b = await launchApp({ args: [feB], env: ENV });
  const ctl = (n: string) => a.page.getByTestId(`form-ctl-${n}`).filter({ visible: true });
  try {
    await open(a.page, 'nav-item-form-FClients');
    await a.page.getByTestId('nav-record-input').filter({ visible: true }).fill('3');
    await a.page.keyboard.press('Enter');
    await expect(ctl('Nom')).toHaveValue('Durand');
    await open(b.page, 'nav-item-Clients');
    await expect(cell(b.page, 1, 2)).toHaveText('Durand');

    await ctl('Ville').fill('Lille');   // not saved
    await typeIn(b.page, 1, 2, 'Durant', true);
    await expect.poll(() => durand(data)?.Nom).toBe('Durant');
    await ctl('Ville').press('Shift+Enter');
    await a.page.getByTestId('wc-save').click();   // Nom differs from what A read: a conflict, though A changed only Ville
    await expect.poll(() => durand(data)).toEqual({ Nom: 'Durant', Ville: 'Lille' });
    await expect(a.page.getByTestId('form-dirty')).toHaveCount(0);

    // B deletes Durand while A edits it: A's save says so, the changes go, the form moves on
    await ctl('Ville').fill('Brest');
    const bb = (await sheet(b.page).getByTestId('data-grid-canvas').boundingBox())!;
    await b.page.mouse.click(bb.x + 22, bb.y + 34 + 2 * 30 + 15);
    await b.page.keyboard.press('Delete');
    await b.page.getByTestId('modal-btn-yes').click();
    await expect.poll(() => durand(data)).toBeUndefined();
    await ctl('Ville').press('Shift+Enter');
    await expect(a.page.getByTestId('modal')).toContainText(fr.wc.deleted);
    await a.page.getByTestId('modal-btn-ok').click();
    await expect(ctl('Nom')).toHaveValue('Éric');
    await expect(a.page.getByTestId('form-dirty')).toHaveCount(0);
  } finally {
    await a.app.close();
    await b.app.close();
  }
});

// G3: one workstation, a form and a datasheet on the same record
test('one instance: a form and a datasheet on the same record get the Write Conflict dialog (G3)', async () => {
  const { data, a: feA } = layout();
  const a = await launchApp({ args: [feA], env: ENV });
  const martin = () => inFile<{ Ville: string }>(data, `SELECT "Ville" FROM "Clients" WHERE "N°" = 2`)[0]?.Ville;
  const ctl = (n: string) => a.page.getByTestId(`form-ctl-${n}`).filter({ visible: true });
  try {
    await open(a.page, 'nav-item-form-FClients');
    await a.page.getByTestId('nav-record-input').filter({ visible: true }).fill('2');
    await a.page.keyboard.press('Enter');
    await expect(ctl('Nom')).toHaveValue('Martin');
    await ctl('Ville').fill('Lyon 3');   // the form's entry begins: its original is LYON

    await open(a.page, 'nav-item-Clients');
    await expect(cell(a.page, 2, 1)).toHaveText('LYON');
    await typeIn(a.page, 2, 1, 'Lyon 2', true);
    await expect.poll(martin).toBe('Lyon 2');

    await a.page.getByTestId('doc-tab-form-FClients').click();
    await expect(ctl('Ville')).toHaveValue('Lyon 3');   // still being edited
    await ctl('Ville').press('Shift+Enter');
    await expect(a.page.getByTestId('write-conflict')).toBeVisible();
    await a.page.getByTestId('wc-save').click();
    await expect.poll(martin).toBe('Lyon 3');
  } finally {
    await a.app.close();
  }
});

// R10: both workstations refresh every second (settings.json seeded): the other one's writes show with no action
test('the refresh interval: a datasheet and a form show the other workstation’s writes, never over a record being edited; a new interval applies at once', async () => {
  const { data, a: feA, b: feB } = layout();
  const userData = () => { const d = mkdtempSync(join(tmpdir(), 'basecraft-')); writeFileSync(join(d, 'settings.json'), JSON.stringify({ refreshInterval: 1 })); return d; };
  const dirA = userData();
  const interval = () => JSON.parse(readFileSync(join(dirA, 'settings.json'), 'utf8')).refreshInterval;
  const a = await launchApp({ args: [feA], env: ENV, userDataDir: dirA });
  const b = await launchApp({ args: [feB], env: ENV, userDataDir: userData() });
  const ctl = (n: string) => a.page.getByTestId(`form-ctl-${n}`).filter({ visible: true });
  const count = (p: Page) => p.getByTestId('nav-record-count').filter({ visible: true });
  // B types only once its view shows the file's value (A's last save, after B's refresh): typed over an older value, B's save
  // would rightly be a Write Conflict and write nothing.
  const bWrites = async (ville: string) => {
    await expect(cell(b.page, 2, 2)).toHaveText(durand(data)!.Ville, { timeout: 5000 });
    await typeIn(b.page, 2, 2, ville, true);
    await expect.poll(() => durand(data)?.Ville).toBe(ville);
  };
  try {
    await open(a.page, 'nav-item-Clients');
    await expect(count(a.page)).toHaveText('4');
    await open(b.page, 'nav-item-Clients');
    await expect(cell(b.page, 2, 2)).toHaveText('Paris');

    // a datasheet: B's new record (written by B's data process, as its datasheet does)
    await b.page.evaluate(() => (window as unknown as { basecraft: { rows: { insert(t: string, v: object): Promise<unknown> } } }).basecraft.rows.insert('Clients', { Nom: 'Petit' }));
    await expect.poll(() => inFile<{ n: number }>(data, 'SELECT count(*) AS n FROM "Clients"')[0]!.n).toBe(5);
    await expect.poll(() => count(a.page).textContent(), { timeout: 5000 }).toBe('5');
    await expect(cell(a.page, 1, 4)).toHaveText('Petit');

    // a new record being typed is not refreshed (its row would become B's): saved as A's, then refreshed with no other write
    const bb = (await sheet(a.page).getByTestId('data-grid-canvas').boundingBox())!;
    await a.page.mouse.click(bb.x + 44 + 80 + 30, bb.y + 34 + 5 * 30 + 15);   // the new-record row's Nom: its editor opens
    await expect(a.page.getByTestId('grid-editor-portal').locator('textarea')).toBeFocused();
    await a.page.keyboard.type('Grand');
    await b.page.evaluate(() => (window as unknown as { basecraft: { rows: { insert(t: string, v: object): Promise<unknown> } } }).basecraft.rows.insert('Clients', { Nom: 'Moyen' }));
    await expect.poll(() => inFile<{ n: number }>(data, 'SELECT count(*) AS n FROM "Clients"')[0]!.n).toBe(6);
    await a.page.waitForTimeout(2500); // two refresh intervals and more
    await a.page.keyboard.press('Enter');   // saved
    await expect(a.page.getByTestId('doc-tab-Clients')).not.toContainText('•');
    const lastNames = () => inFile<{ Nom: string }>(data, 'SELECT "Nom" FROM "Clients" ORDER BY "N°" DESC LIMIT 3').map((r) => r.Nom);
    await expect.poll(lastNames).toEqual(['Grand', 'Moyen', 'Petit']);
    await expect.poll(() => count(a.page).textContent(), { timeout: 5000 }).toBe('7');
    for (const [row, nom] of [[4, 'Petit'], [5, 'Moyen'], [6, 'Grand']] as const) await expect(cell(a.page, 1, row)).toHaveText(nom);

    // a cell editor open with nothing typed: the refresh waits, then runs when the editor closes (onFinishedEditing), with no
    // other write (B's one signal came while it was open)
    await a.page.mouse.click(bb.x + 44 + 80 + 170 + 30, bb.y + 34 + 2 * 30 + 15);   // Durand's Ville
    await expect(cell(a.page, 2, 2)).toBeFocused();
    await a.page.keyboard.press('Enter');
    await expect(a.page.getByTestId('grid-editor-portal').locator('textarea')).toBeFocused();
    await bWrites('Nantes');
    await a.page.waitForTimeout(2500); // two refresh intervals and more
    await expect(cell(a.page, 2, 2)).toHaveText('Paris');
    await a.page.keyboard.press('Escape');
    await expect(a.page.getByTestId('grid-editor-portal').locator('textarea')).toHaveCount(0);
    await expect(cell(a.page, 2, 2)).toHaveText('Nantes', { timeout: 5000 });
    await expect(a.page.getByTestId('doc-tab-Clients')).not.toContainText('•');

    // a form: B's new Ville
    await open(a.page, 'nav-item-form-FClients');
    await a.page.getByTestId('nav-record-input').filter({ visible: true }).fill('3');
    await a.page.keyboard.press('Enter');
    await expect(ctl('Ville')).toHaveValue('Nantes');
    await bWrites('Brest');
    await expect(ctl('Ville')).toHaveValue('Brest', { timeout: 5000 });

    // a record being edited keeps its text; its save conflicts, Drop Changes shows B's
    await ctl('Ville').fill('Lille');
    await bWrites('Rennes');
    await a.page.waitForTimeout(2500); // two refresh intervals and more
    await expect(ctl('Ville')).toHaveValue('Lille');
    await ctl('Ville').press('Shift+Enter');
    await a.page.getByTestId('wc-drop').click();
    await expect(ctl('Ville')).toHaveValue('Rennes');
    await expect(a.page.getByTestId('form-dirty')).toHaveCount(0);

    // B's new record while A edits: A's count stays until A saves, then follows with no other write
    await ctl('Ville').fill('Quimper');
    await b.page.evaluate(() => (window as unknown as { basecraft: { rows: { insert(t: string, v: object): Promise<unknown> } } }).basecraft.rows.insert('Clients', { Nom: 'Dernier' }));
    await expect.poll(() => inFile<{ n: number }>(data, 'SELECT count(*) AS n FROM "Clients"')[0]!.n).toBe(8);
    await a.page.waitForTimeout(2500); // two refresh intervals and more
    await expect(count(a.page)).toHaveText('7');
    await ctl('Ville').press('Shift+Enter');
    await expect(a.page.getByTestId('form-dirty')).toHaveCount(0);
    await expect.poll(() => durand(data)?.Ville).toBe('Quimper');
    await expect.poll(() => count(a.page).textContent(), { timeout: 5000 }).toBe('8');

    // Options › Client settings, applied without reopening: the longest interval (B's write does not show), then 2 s (it does)
    const setRefresh = async (v: number) => {
      await a.page.getByTestId('ribbon-tab-file').click();
      await a.page.getByTestId('bs-options').click();
      await a.page.getByTestId('opt-cat-client').click();
      await a.page.getByTestId('opt-refresh-interval').fill(String(v));
      await a.page.getByTestId('opt-refresh-interval').press('Enter');
      await expect.poll(interval).toBe(v);
      await a.page.getByTestId('bs-back').click();
    };
    await setRefresh(32766);
    await bWrites('Vannes');
    await a.page.waitForTimeout(2500); // two of the former intervals and more
    await expect(ctl('Ville')).toHaveValue('Quimper');
    await setRefresh(2);
    await expect(ctl('Ville')).toHaveValue('Vannes', { timeout: 5000 });
  } finally {
    await a.app.close();
    await b.app.close();
  }
});
