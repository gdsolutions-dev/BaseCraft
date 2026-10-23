import { test, expect, type ElectronApplication, type Page } from '@playwright/test';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createTable } from '../../src/main/db/schema';
import { insertRow } from '../../src/main/db/write-layer';
import { localeInfo } from '../../src/shared/locale-format';
import { clients } from '../../src/shared/test-fixtures';
import { launchApp, seedBase } from './helpers';

const fr = JSON.parse(readFileSync(join(__dirname, '../../src/shared/i18n/fr.json'), 'utf8'));
const FR = { BASECRAFT_REGION: 'fr-FR' };
// DatasheetView: row selector width, header and row heights, widths of Clients' first columns (AutoNumber, short text).
const MARKER = 44, HEADER = 34, ROW = 30, AUTONUMBER = 80, WIDTH_NOM = 170;

const clientsBase = (name: string, ...noms: string[]) => seedBase(name, async (db) => {
  createTable(db, clients);
  for (const nom of noms) await insertRow(db, clients, { Nom: nom }, localeInfo('fr-FR'));
});

async function openSheet(page: Page) {
  await page.getByTestId('nav-item-Clients').dblclick();
  await expect(page.getByTestId('datasheet').getByTestId('data-grid-canvas')).toBeVisible(); // Glide lays out after a render
}
async function canvas(page: Page) {
  return (await page.getByTestId('datasheet').getByTestId('data-grid-canvas').boundingBox())!;
}
/** Clicks the Nom cell (second column) of a row, and waits until Glide has selected and focused it. */
async function clickNom(page: Page, row: number) {
  const b = await canvas(page);
  await page.mouse.click(b.x + MARKER + AUTONUMBER + 30, b.y + HEADER + row * ROW + ROW / 2);
  await expect(cell(page, 1, row)).toBeFocused();
}
/** Clicks the trailing row's Nom cell: a new record starts; Glide opens the cell editor once the row exists. */
async function newRecordAt(page: Page, row: number) {
  const b = await canvas(page);
  await page.mouse.click(b.x + MARKER + AUTONUMBER + 30, b.y + HEADER + row * ROW + ROW / 2);
  await expect(cellEditor(page)).toBeFocused();
}
const cellEditor = (page: Page) => page.getByTestId('grid-editor-portal').locator('textarea');
/** Typing on the selected cell opens its editor with the first key; the rest goes to the editor once it is open. */
/** A key typing one character, sent as a keyboard would (Playwright's press only knows the US layout); `dead`: after a
 *  dead key (^ then e gives « ê »). */
async function pressChar(page: Page, ch: string, dead = false) {
  const cdp = await page.context().newCDPSession(page);
  if (dead) await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Dead' });
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: ch, text: ch, unmodifiedText: ch });
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: ch });
  await cdp.detach();
}
async function typeIntoCell(page: Page, text: string, dead = false) {
  await expect(page.getByTestId('datasheet').locator('td[role=gridcell]:focus')).toHaveCount(1); // Glide focuses the cell after a render
  if (/[ -~]/.test(text[0]) && !dead) await page.keyboard.press(text[0]);
  else await pressChar(page, text[0], dead);
  await expect(cellEditor(page)).toBeFocused();
  await page.keyboard.type(text.slice(1));
}
/** Enter / Tab in an open editor keeps the text and moves, even right after the last key; waits until the editor is gone. */
async function closeEditor(page: Page, key: 'Enter' | 'Tab') {
  await page.keyboard.press(key);
  await expect(cellEditor(page)).toHaveCount(0);
  await expect(page.getByTestId('datasheet')).not.toHaveAttribute('aria-busy', 'true'); // a row left is being saved
}
/** Clicks a row selector, and waits until Glide has selected the row and taken the focus: Glide focuses the grid in the
 *  next animation frame, and a key pressed before that goes to the element focused before (a ribbon button). */
async function clickSelector(page: Page, row: number) {
  const b = await canvas(page);
  await page.mouse.click(b.x + MARKER / 2, b.y + HEADER + row * ROW + ROW / 2);
  const tr = page.getByTestId('datasheet').locator(`tr[aria-rowindex="${row + 2}"]`);
  await expect(tr).toHaveAttribute('aria-selected', 'true');
  await expect(tr.locator('td[role=gridcell]:focus')).toHaveCount(1);
}
/** Glide's accessible copy of a cell (col counted without the row selectors). */
const cell = (page: Page, col: number, row: number) => page.getByTestId(`glide-cell-${col + 1}-${row}`);
const closeWindow = (app: ElectronApplication) => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close());
const rowsOf = async (page: Page, table = 'Clients') =>
  (await page.evaluate((t) => (window as any).basecraft.rows.page(t, { offset: 0, limit: 1000 }), table)).rows as { rowid: number; values: unknown[] }[];
function nomsInFile(base: string): unknown[] {
  const db = new DatabaseSync(base, { readOnly: true });
  try {
    return db.prepare('SELECT "Nom" FROM "Clients" ORDER BY rowid').all().map((r) => r.Nom);
  } finally {
    db.close();
  }
}

test('enter, validate, cancel, sort, delete', async () => {
  const { app, page } = await launchApp({ args: [await clientsBase('saisie')], env: FR });
  try {
    await openSheet(page);
    await expect(page.getByTestId('nav-record-count')).toHaveText('0');

    await newRecordAt(page, 0);
    await page.keyboard.type('Dupont');
    await closeEditor(page, 'Tab');
    await typeIntoCell(page, '42');
    await closeEditor(page, 'Enter'); // leaves the row: saved
    await expect(page.getByTestId('nav-record-count')).toHaveText('1');
    await newRecordAt(page, 1);
    await page.keyboard.type('Martin');
    await closeEditor(page, 'Enter');
    await expect(page.getByTestId('nav-record-count')).toHaveText('2');
    await expect(cell(page, 1, 0)).toHaveText('Dupont');
    await expect(cell(page, 2, 0)).toHaveText('42');
    expect((await page.evaluate(() => (window as any).basecraft.rows.page('Clients', { offset: 0, limit: 10 }))).rows.map((r: any) => r.values[1]))
      .toEqual(['Dupont', 'Martin']);

    // a new record without its required Nom: the row stays, the error is shown in a box and under the grid; Escape cancels the row
    await newRecordAt(page, 2);
    await closeEditor(page, 'Tab');
    await typeIntoCell(page, '5');
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('modal')).toContainText(`« Nom » : ${fr.fieldError.required}`);
    await page.getByTestId('modal-btn-ok').click();
    await expect(cell(page, 1, 2)).toBeFocused();
    await expect(page.getByTestId('datasheet-error')).toHaveText(`« Nom » : ${fr.fieldError.required}`);
    await expect(page.getByTestId('doc-tab-Clients')).toContainText('•');
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('datasheet-error')).toHaveCount(0);
    await expect(page.getByTestId('doc-tab-Clients')).not.toContainText('•');
    await expect(page.getByTestId('nav-record-count')).toHaveText('2');

    await clickNom(page, 0);
    await page.getByTestId('ribbon-tab-home').click();
    await page.getByTestId('cmd-sortDesc').click();
    await expect(cell(page, 1, 0)).toHaveText('Martin');
    await expect(cell(page, 1, 1)).toHaveText('Dupont');

    await clickSelector(page, 0);
    await page.keyboard.press('Delete');
    await expect(page.getByTestId('modal')).toContainText(fr.datasheet.delete_one);
    await page.getByTestId('modal-btn-yes').click();
    await expect(page.getByTestId('nav-record-count')).toHaveText('1');
    await expect(cell(page, 1, 0)).toHaveText('Dupont');
  } finally {
    await app.close();
  }
});

test('closing a tab saves a valid pending row', async () => {
  const { app, page } = await launchApp({ args: [await clientsBase('onglet')], env: FR });
  try {
    await openSheet(page);
    await newRecordAt(page, 0);
    await page.keyboard.type('Durand'); // the cell editor is still open
    await page.getByTestId('doc-tab-close-Clients').click();
    await expect(page.getByTestId('doc-tab-Clients')).toHaveCount(0);
    await openSheet(page);
    await expect(page.getByTestId('nav-record-count')).toHaveText('1');
    await expect(cell(page, 1, 0)).toHaveText('Durand');
  } finally {
    await app.close();
  }
});

test('closing the window saves a valid pending row, and the base is released', async () => {
  const base = await clientsBase('fenetre');
  const { app, page } = await launchApp({ args: [base], env: FR });
  try {
    await openSheet(page);
    await newRecordAt(page, 0);
    await page.keyboard.type('Leroy'); // the cell editor is still open
    const closed = app.waitForEvent('close');
    await closeWindow(app);
    await closed;
  } finally {
    await app.close().catch(() => undefined);
  }
  expect(nomsInFile(base)).toEqual(['Leroy']);
  expect(existsSync(`${base}.lock`)).toBe(false);
});

test('closing the window with an invalid pending row asks; No keeps the window, Yes discards and closes', async () => {
  const base = await clientsBase('invalide');
  const { app, page } = await launchApp({ args: [base], env: FR });
  try {
    await openSheet(page);
    await newRecordAt(page, 0);
    await closeEditor(page, 'Tab');
    await typeIntoCell(page, '7'); // Âge only: Nom is required
    await closeWindow(app);
    await expect(page.getByTestId('modal')).toContainText(`« Nom » : ${fr.fieldError.required}`); // the save tried first
    await page.getByTestId('modal-btn-ok').click();
    await expect(page.getByTestId('modal')).toContainText(fr.datasheet.discard.replace('{{name}}', 'Clients'));
    await page.getByTestId('modal-btn-no').click();
    await expect(page.getByTestId('modal')).toHaveCount(0);
    await expect(page.getByTestId('datasheet-error')).toBeVisible();
    expect(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length)).toBe(1);
    await expect(page.getByTestId('nav-record-count')).toHaveText('0'); // still usable

    const closed = app.waitForEvent('close');
    await closeWindow(app);
    await page.getByTestId('modal-btn-ok').click();
    await page.getByTestId('modal-btn-yes').click();
    await closed;
  } finally {
    await app.close().catch(() => undefined);
  }
  expect(nomsInFile(base)).toEqual([]);
});

test('read-only datasheet: no new record row, nothing can be changed', async () => {
  const base = await clientsBase('lecture', 'Dupont');
  const a = await launchApp({ args: [base] });
  const b = await launchApp({ args: [base], env: FR });
  try {
    const p = b.page;
    await expect(p.getByTestId('banner-readonly')).toBeVisible();
    await openSheet(p);
    await expect(cell(p, 1, 0)).toHaveText('Dupont');
    await expect(p.getByTestId('datasheet').locator('table[role=grid]')).toHaveAttribute('aria-rowcount', '2'); // header + 1 record
    await expect(p.getByTestId('nav-new')).toBeDisabled();
    await p.getByTestId('ribbon-tab-home').click();
    for (const id of ['newRecord', 'deleteRecord']) await expect(p.getByTestId(`cmd-${id}`)).toBeDisabled();
    await clickNom(p, 0);
    await p.keyboard.type('X');
    await p.keyboard.press('ArrowDown');
    await clickSelector(p, 0);
    await p.keyboard.press('Delete');
    await expect(p.getByTestId('modal')).toHaveCount(0);
    await expect(cell(p, 1, 0)).toHaveText('Dupont');
    await expect(p.getByTestId('doc-tab-Clients')).not.toContainText('•');
  } finally {
    await a.app.close();
    await b.app.close();
  }
  expect(nomsInFile(base)).toEqual(['Dupont']);
});

test('a write refused because the lock was lost: after "Take over", the sheet is editable again', async () => {
  const base = await clientsBase('reprise', 'Dupont');
  const { app, page } = await launchApp({ args: [base], env: FR });
  const rowcount = page.getByTestId('datasheet').locator('table[role=grid]');
  try {
    await openSheet(page);
    await expect(rowcount).toHaveAttribute('aria-rowcount', '3'); // header + 1 record + new record row
    await clickNom(page, 0);
    await typeIntoCell(page, 'Durand');
    // Another instance took the lock over (its holder looks dead, so ours can take it back); the next write finds out.
    writeFileSync(`${base}.lock`, JSON.stringify({ user: 'autre', host: 'PC-2', pid: 1, sessionId: 'voleur', heartbeatAt: '2000-01-01T00:00:00.000Z' }));
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('modal')).toContainText(fr.dialog.error.readOnly);
    await page.getByTestId('modal-btn-ok').click();
    await expect(rowcount).toHaveAttribute('aria-rowcount', '2'); // read-only: no new record row
    await page.getByTestId('banner-takeover').click();
    await expect(page.getByTestId('banner-readonly')).toHaveCount(0);
    await expect(rowcount).toHaveAttribute('aria-rowcount', '3'); // the new record row is back
    await page.getByTestId('ribbon-tab-home').click();
    await expect(page.getByTestId('cmd-newRecord')).toBeEnabled();
    await page.getByTestId('cmd-save').click(); // the row refused earlier is saved now
    await expect(page.getByTestId('doc-tab-Clients')).not.toContainText('•');
    await newRecordAt(page, 1);
    await page.keyboard.type('Martin');
    await closeEditor(page, 'Enter');
    await expect(page.getByTestId('nav-record-count')).toHaveText('2');
  } finally {
    await app.close();
  }
  expect(nomsInFile(base)).toEqual(['Durand', 'Martin']);
});

test('design change while datasheet open reloads columns', async () => {
  const { app, page } = await launchApp({ args: [await clientsBase('structure', 'Dupont')], env: FR });
  try {
    await openSheet(page);
    const headers = page.getByTestId('datasheet').locator('th[role=columnheader]'); // Glide's accessible copy of the canvas
    await expect(headers.nth(1)).toHaveText('Nom');
    await page.getByTestId('status-view-design').click();
    await page.getByTestId('design-row-1-name').fill('Client');
    await page.keyboard.press('Control+s');
    await expect(page.getByTestId('doc-tab-Clients')).not.toContainText('•');
    await page.getByTestId('status-view-datasheet').click();
    await expect(headers.nth(1)).toHaveText('Client');
    await expect(cell(page, 1, 0)).toHaveText('Dupont');

    await clickNom(page, 0);
    await typeIntoCell(page, 'Martin');
    await closeEditor(page, 'Enter');
    await expect(cell(page, 1, 0)).toHaveText('Martin');
    await expect(page.getByTestId('doc-tab-Clients')).not.toContainText('•');
    expect((await page.evaluate(() => (window as any).basecraft.rows.page('Clients', { offset: 0, limit: 10 }))).rows[0].values[1]).toBe('Martin');
  } finally {
    await app.close();
  }
});

test('a value typed and entered with no delay is saved (scanner, text expander)', async () => {
  const { app, page } = await launchApp({ args: [await clientsBase('rafale', 'Dupont')], env: FR });
  try {
    await openSheet(page);
    await clickNom(page, 0);
    await typeIntoCell(page, 'Martin');
    await page.keyboard.press('Enter'); // in the same tick as the last key
    await expect.poll(async () => (await rowsOf(page))[0].values[1]).toBe('Martin');
    // on a slow machine too: the new record's editor opens once, when its row is there (not first on the click's mouse-up, then
    // again, losing or misplacing the keys typed in between)
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 6 });
    await newRecordAt(page, 1);
    await page.keyboard.type('Durand');
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('nav-record-count')).toHaveText('2');
    expect((await rowsOf(page)).map((r) => r.values[1])).toEqual(['Martin', 'Durand']);
  } finally {
    await app.close();
  }
});

test('accented first letters open the editor (é, ç, ê from a dead key)', async () => {
  const { app, page } = await launchApp({ args: [await clientsBase('accents')], env: FR });
  try {
    await openSheet(page);
    await newRecordAt(page, 0);
    await page.keyboard.press('Escape'); // the new record's Nom is selected, its editor closed
    await typeIntoCell(page, 'Élodie');
    await closeEditor(page, 'Enter');
    await expect(page.getByTestId('nav-record-count')).toHaveText('1');
    await expect(cell(page, 1, 0)).toHaveText('Élodie');
    await clickNom(page, 0);
    await typeIntoCell(page, 'ça');
    await closeEditor(page, 'Enter');
    await expect(cell(page, 1, 0)).toHaveText('ça');
    await clickNom(page, 0);
    await typeIntoCell(page, 'ête', true);
    await closeEditor(page, 'Enter');
    await expect(cell(page, 1, 0)).toHaveText('ête');
    await expect.poll(async () => (await rowsOf(page)).map((r) => r.values[1])).toEqual(['ête']);
  } finally {
    await app.close();
  }
});

test('renaming the table keeps an invalid pending row and its error', async () => {
  const { app, page } = await launchApp({ args: [await clientsBase('renommer')], env: FR });
  try {
    await openSheet(page);
    await newRecordAt(page, 0);
    await closeEditor(page, 'Tab');
    await typeIntoCell(page, '7');
    await page.keyboard.press('Enter'); // Nom is required: the row stays pending
    await page.getByTestId('modal-btn-ok').click();
    await expect(page.getByTestId('datasheet-error')).toBeVisible();
    await page.getByTestId('nav-item-Clients').click({ button: 'right' });
    await page.getByTestId('nav-menu-rename').click();
    await page.getByTestId('modal-input').fill('Clients2');
    await page.getByTestId('modal-btn-ok').click();
    await expect(page.getByTestId('doc-tab-Clients2')).toContainText('•');
    await expect(page.getByTestId('datasheet-error')).toBeVisible();
    await expect(page.getByTestId('modal')).toHaveCount(0);
    const b = await canvas(page);
    await page.mouse.click(b.x + MARKER + AUTONUMBER + WIDTH_NOM + 30, b.y + HEADER + ROW / 2); // Âge, same row
    await expect(cell(page, 2, 0)).toBeFocused();
    await page.keyboard.press('ArrowLeft');
    await expect(cell(page, 1, 0)).toHaveAttribute('aria-selected', 'true');
    await typeIntoCell(page, 'Durand');
    await closeEditor(page, 'Enter'); // fixed: saved, under the new name
    await expect(page.getByTestId('nav-record-count')).toHaveText('1');
    await expect(page.getByTestId('datasheet-error')).toHaveCount(0);
    expect((await rowsOf(page, 'Clients2'))[0].values.slice(1, 3)).toEqual(['Durand', 7]);
  } finally {
    await app.close();
  }
});

test('with a sort, a saved row takes its sorted place', async () => {
  const { app, page } = await launchApp({ args: [await clientsBase('triee', 'Bernard', 'Durand')], env: FR });
  try {
    await openSheet(page);
    await clickNom(page, 0);
    await page.getByTestId('ribbon-tab-home').click();
    await page.getByTestId('cmd-sortAsc').click();
    await newRecordAt(page, 2);
    await page.keyboard.type('Albert');
    await closeEditor(page, 'Enter');
    await expect(page.getByTestId('nav-record-count')).toHaveText('3');
    await expect(cell(page, 1, 0)).toHaveText('Albert');
    await expect(cell(page, 1, 1)).toHaveText('Bernard');
    await expect(cell(page, 1, 2)).toHaveText('Durand');
  } finally {
    await app.close();
  }
});

test('after deleting a row beyond the first page, editing a later row updates that record', async () => {
  const noms = Array.from({ length: 250 }, (_, i) => `R${String(i).padStart(3, '0')}`);
  const { app, page } = await launchApp({ args: [await clientsBase('longue', ...noms)], env: FR });
  const goTo = async (n: number) => {
    await page.getByTestId('nav-record-input').fill(String(n));
    await page.getByTestId('nav-record-input').press('Enter');
  };
  try {
    await openSheet(page);
    await goTo(221); // R220, rowid 221 (second page)
    await expect(cell(page, 1, 220)).toHaveText('R220');
    await expect(cell(page, 1, 220)).toBeFocused();
    await page.getByTestId('ribbon-tab-home').click();
    await page.getByTestId('cmd-deleteRecord').click();
    await page.getByTestId('modal-btn-yes').click();
    await expect(page.getByTestId('nav-record-count')).toHaveText('249');
    await goTo(221);
    await expect(cell(page, 1, 220)).toHaveText('R221'); // the page was read again
    await expect(cell(page, 1, 220)).toBeFocused();
    await typeIntoCell(page, 'X');
    await closeEditor(page, 'Enter');
    await expect.poll(async () => (await rowsOf(page)).find((r) => r.values[1] === 'X')?.rowid).toBe(222);
    const rows = await rowsOf(page);
    expect(rows).toHaveLength(249);
    expect(rows[0].values[1]).toBe('R000');
    expect(rows.map((r) => r.values[1])).not.toContain('R220');
    expect(rows.map((r) => r.values[1])).not.toContain('R221');
  } finally {
    await app.close();
  }
});

test('a hung renderer does not keep the window open: a second close after 5 s closes it', async () => {
  const base = await clientsBase('fige');
  const { app, page } = await launchApp({ args: [base], env: FR });
  try {
    await openSheet(page);
    await page.evaluate(() => { setTimeout(() => { const end = Date.now() + 60000; while (Date.now() < end); }, 0); });
    let done = false;
    const closed = app.waitForEvent('close').then(() => { done = true; });
    await closeWindow(app); // asked, never acknowledged
    expect(done).toBe(false);
    await expect.poll(async () => {
      if (!done) await closeWindow(app).catch(() => undefined); // the user clicks again
      return done;
    }, { timeout: 20000, intervals: [1000] }).toBe(true);
    await closed;
  } finally {
    await app.close().catch(() => undefined);
  }
  expect(existsSync(`${base}.lock`)).toBe(false);
});

test("another tool's keys: the delete question warns of SET NULL, refusals name both tables, a dangling name is asked again", async () => {
  const base = await seedBase('autres-cles', async (db) => {
    createTable(db, clients);
    await insertRow(db, clients, { Nom: 'Dupont' }, localeInfo('fr-FR'));
    db.exec(`CREATE TABLE "Kids" ("c" INTEGER REFERENCES "Clients" ("N°") ON DELETE SET NULL); INSERT INTO "Kids" VALUES (1)`);
    db.exec(`CREATE TABLE "Ghost" ("id" INTEGER PRIMARY KEY); CREATE TABLE "Orph" ("g" INTEGER REFERENCES "Ghost" ("id"))`);
    db.exec('PRAGMA foreign_keys=OFF; DROP TABLE "Ghost"; PRAGMA foreign_keys=ON');
  });
  const { app, page } = await launchApp({ args: [base], env: FR });
  const fill = (s: string, p: Record<string, string>) => Object.entries(p).reduce((x, [k, v]) => x.replace(`{{${k}}}`, v), s);
  try {
    await page.getByTestId('nav-item-Clients').click({ button: 'right' });
    await page.getByTestId('nav-menu-delete').click();
    await page.getByTestId('modal-btn-yes').click();
    await expect(page.getByTestId('modal')).toContainText(fill(fr.dialog.op.referenced, { name: 'Clients', table: 'Kids' }));
    await page.getByTestId('modal-btn-ok').click();
    await page.getByTestId('nav-item-Clients').click({ button: 'right' });
    await page.getByTestId('nav-menu-rename').click();
    await page.getByTestId('modal-input').fill('Ghost');
    await page.getByTestId('modal-btn-ok').click();
    await expect(page.getByTestId('modal')).toContainText(fill(fr.dialog.op.danglingKey, { table: 'Orph', newName: 'Ghost' }));
    await page.getByTestId('modal-btn-ok').click();

    await openSheet(page);
    await clickNom(page, 0);
    await page.getByTestId('ribbon-tab-home').click();
    await page.getByTestId('cmd-deleteRecord').click();
    await expect(page.getByTestId('modal')).toContainText(fr.datasheet.deleteModifies_one);
    await page.getByTestId('modal-btn-no').click();

    // A new table saved under the name: refused with both names, then the name is asked again (as for a name taken).
    await page.getByTestId('ribbon-tab-create').click();
    await page.getByTestId('cmd-createTableDesign').click();
    await page.getByTestId('design-row-0-name').fill('Nom');
    await page.keyboard.press('Control+s');
    await page.getByTestId('modal-input').fill('Ghost');
    await page.getByTestId('modal-btn-ok').click();
    await page.getByTestId('modal-btn-no').click(); // no primary key
    await expect(page.getByTestId('modal')).toContainText(fill(fr.designer.danglingKey, { table: 'Orph', newName: 'Ghost' }));
    await page.getByTestId('modal-btn-ok').click();
    await expect(page.getByTestId('modal-input')).toHaveValue('Ghost');
    await page.getByTestId('modal-input').fill('Spectre');
    await page.getByTestId('modal-btn-ok').click();
    await expect(page.getByTestId('nav-item-Spectre')).toBeVisible();
  } finally {
    await app.close();
  }
});
