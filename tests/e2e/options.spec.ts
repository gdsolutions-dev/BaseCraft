// O1 Task 3: File › Options — the categories (« Générales », « Base de données active », « Paramètres du client »), the workstation
// settings (settings.json) and the database switches (bc_meta options.startup). Each change is written at once.
import { test, expect, type ElectronApplication, type Page } from '@playwright/test';
import { mkdirSync, mkdtempSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { saveObject } from '../../src/main/db/objects';
import { seedSales, seedSalesRelation } from '../../src/main/query/test-db';
import type { BasecraftApi } from '../../src/shared/api';
import { inFile, launchApp, openDbOptions, seedBase } from './helpers';

const fr = JSON.parse(readFileSync(join(__dirname, '../../src/shared/i18n/fr.json'), 'utf8'));
const FR = { BASECRAFT_REGION: 'fr-FR' };
const ICON = join(__dirname, '../../build/icon.png');
type W = { basecraft: BasecraftApi };
const startup = (page: Page) => page.evaluate(() => (window as unknown as W).basecraft.base.startup());
const settingsFile = (dir: string) => JSON.parse(readFileSync(join(dir, 'settings.json'), 'utf8'));
const selected = (page: Page, cat: string) => expect(page.getByTestId(`opt-cat-${cat}`)).toHaveAttribute('aria-selected', 'true');
/** The Backstage's content scrolls only vertically. */
const noHScroll = (page: Page) => expect.poll(() => page.getByTestId('backstage').locator('.bs-content')
  .evaluate((e) => e.scrollWidth - e.clientWidth)).toBeLessThanOrEqual(0);
/** As in Access, the categories stay to the left of the panel, even in the smallest window. */
const sideBySide = async (page: Page) => {
  const cats = (await page.locator('.bs-optcats').boundingBox())!, panel = (await page.getByTestId('opt-panel').boundingBox())!;
  expect(panel.x).toBeGreaterThanOrEqual(cats.x + cats.width);
  expect(panel.y).toBeLessThan(cats.y + cats.height);
};
const minSize = (app: ElectronApplication) => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setSize(900, 600)); // the minimum size

test('no base: « Générales » and « Paramètres du client », written at once and kept after a relaunch', async () => {
  const folder = mkdtempSync(join(tmpdir(), 'basecraft-folder-'));
  const env = { ...FR, BASECRAFT_E2E_FOLDER_PATH: folder };
  const { app, page, userDataDir } = await launchApp({ env });
  try {
    await page.getByTestId('bs-options').click();
    await selected(page, 'general');
    await expect(page.getByTestId('opt-cat-general')).toHaveText('Générales');
    await expect(page.getByTestId('opt-cat-client')).toHaveText('Paramètres du client');
    await expect(page.getByTestId('opt-cat-currentDb')).toHaveCount(0);
    await expect(page.getByTestId('opt-panel')).toContainText("Options générales d'utilisation de BaseCraft.");
    await page.getByTestId('opt-theme').selectOption('dark');
    expect(await page.evaluate(() => document.documentElement.dataset.theme)).toBe('dark');
    await page.getByTestId('opt-theme').selectOption('system');
    await expect(page.getByTestId('opt-lang').locator('option[value="en"]')).toHaveText('English');

    // the default folder: Browse…, then a relative path refused (the error, the folder shown again)
    await page.getByTestId('opt-default-folder-browse').click();
    await expect(page.getByTestId('opt-default-folder')).toHaveValue(folder);
    await page.getByTestId('opt-default-folder').fill('dossier');
    await page.getByTestId('opt-default-folder').press('Enter');
    await expect(page.getByTestId('modal')).toBeVisible();
    await expect(page.getByTestId('opt-default-folder')).toHaveValue(folder);
    await page.getByTestId('modal-btn-ok').click();
    await expect(page.getByTestId('modal')).toHaveCount(0);
    await expect(page.getByTestId('opt-default-folder')).toHaveValue(folder);

    await page.getByTestId('opt-cat-client').click();
    await selected(page, 'client');
    await expect(page.getByTestId('opt-panel')).toContainText(fr.options.client.header);
    for (const id of ['records', 'deletions', 'actions']) await page.getByTestId(`opt-confirm-${id}`).uncheck();
    await page.getByTestId('opt-recent-count').fill('99');   // out of range: clamped before it is sent
    await page.getByTestId('opt-recent-count').press('Enter');
    await expect(page.getByTestId('opt-recent-count')).toHaveValue('50');
    await expect.poll(() => settingsFile(userDataDir).recentCount).toBe(50);
    // the broadcast of the write above may reach the field after this fill: it only echoes 50, the 3 typed stays
    await page.getByTestId('opt-recent-count').fill('3');
    await page.getByTestId('opt-recent-count').blur();
    await expect.poll(() => settingsFile(userDataDir).recentCount).toBe(3);
    await page.getByTestId('opt-open-last').check();
    await expect.poll(() => settingsFile(userDataDir)).toMatchObject({
      defaultFolder: folder, recentCount: 3, openLast: true, confirmRecordChanges: false, confirmDocumentDeletions: false, confirmActionQueries: false,
    });
    // the category stays chosen while the Backstage stays open
    await page.getByTestId('bs-about').click();
    await page.getByTestId('bs-options').click();
    await selected(page, 'client');
  } finally {
    await app.close();
  }

  const again = await launchApp({ env, userDataDir });
  try {
    const p = again.page;
    await p.getByTestId('bs-options').click();
    await expect(p.getByTestId('opt-default-folder')).toHaveValue(folder);
    await p.getByTestId('opt-cat-client').click();
    for (const id of ['records', 'deletions', 'actions']) await expect(p.getByTestId(`opt-confirm-${id}`)).not.toBeChecked();
    await expect(p.getByTestId('opt-recent-count')).toHaveValue('3');
    await expect(p.getByTestId('opt-open-last')).toBeChecked();
  } finally {
    await again.app.close();
  }
});

test('the recent list shows the number of bases the option asks for', async () => {
  const bases = [1, 2, 3, 4, 5].map((i) => seedBase(`recent-${i}`));
  const { app, page } = await launchApp({ env: FR });
  try {
    for (const b of bases) await page.evaluate((p) => (window as unknown as W).basecraft.base.open(p).then(() => {}), b);
    const setCount = async (n: string) => {
      await page.getByTestId('bs-options').click();
      await page.getByTestId('opt-cat-client').click();
      await page.getByTestId('opt-recent-count').fill(n);
      await page.getByTestId('opt-recent-count').press('Enter');
      await page.getByTestId('bs-recent').click();
    };
    await page.getByTestId('ribbon-tab-file').click();
    await expect(page.locator('[data-testid^="bs-recent-"]')).toHaveCount(5);
    await setCount('3');
    await expect(page.locator('[data-testid^="bs-recent-"]')).toHaveCount(3);
    await expect(page.getByTestId('bs-recent-0')).toContainText('recent-5');
    await setCount('10');
    await expect(page.locator('[data-testid^="bs-recent-"]')).toHaveCount(5);
  } finally {
    await app.close();
  }
});

test('a base open: « Base de données active » writes the switches to the base', async () => {
  const path = seedBase('options-db');
  const { app, page } = await launchApp({ args: [path], env: FR });
  try {
    await page.getByTestId('ribbon-tab-file').click();
    await openDbOptions(page);
    await expect(page.getByTestId('opt-cat-currentDb')).toHaveText('Base de données active');
    await expect(page.getByTestId('opt-db')).toContainText(fr.options.db.header);
    await expect(page.getByTestId('opt-db-specialkeys')).toHaveAccessibleDescription(fr.options.db.specialKeysHelp);
    await page.getByTestId('opt-db-statusbar').uncheck();
    await page.getByTestId('opt-db-fullmenus').uncheck();
    await expect(page.getByTestId('opt-db-ribbon')).toBeDisabled();
    await page.getByTestId('opt-db-compact').check();
    await expect.poll(() => startup(page)).toMatchObject({ statusBar: false, fullMenus: false, compactOnClose: true, documentTabs: true });

    await expect(page.getByTestId('opt-db-iconforms')).toBeDisabled();
    await page.getByTestId('opt-db-icon-input').setInputFiles(ICON);
    await expect(page.getByTestId('opt-db-iconforms')).toBeEnabled();
    await page.getByTestId('opt-db-iconforms').check();
    await expect.poll(async () => (await startup(page)).iconForForms).toBe(true);

    await minSize(app);
    await noHScroll(page);
    await sideBySide(page);
  } finally {
    await app.close();
  }
});

test('BaseCraft Runtime: « Générales » and « Paramètres du client », never « Base de données active »', async () => {
  const path = seedBase('options-runtime');
  const { app, page } = await launchApp({ args: [path], env: FR, runtime: true });
  try {
    await page.getByTestId('ribbon-tab-file').click();
    await page.getByTestId('bs-options').click();
    await selected(page, 'general');
    await expect(page.getByTestId('opt-cat-client')).toBeVisible();
    await expect(page.getByTestId('opt-cat-currentDb')).toHaveCount(0);
    await expect(page.getByTestId('opt-db')).toHaveCount(0);
  } finally {
    await app.close();
  }
});

test('keyboard: the categories are a vertical tab list; the page fits the narrowest window', async () => {
  const { app, page } = await launchApp({ env: FR });
  try {
    await page.getByTestId('bs-options').click();
    await page.getByTestId('bs-about').focus();
    await page.keyboard.press('Tab');
    await expect(page.getByTestId('opt-cat-general')).toBeFocused();
    await expect(page.getByTestId('backstage').getByRole('tablist')).toHaveAttribute('aria-orientation', 'vertical');
    await page.keyboard.press('ArrowDown');
    await expect(page.getByTestId('opt-cat-client')).toBeFocused();
    await selected(page, 'client');
    await expect(page.getByTestId('backstage').getByRole('tabpanel')).toHaveAttribute('aria-labelledby', 'opt-cat-client');
    await page.keyboard.press('ArrowUp');
    await selected(page, 'general');

    await minSize(app);
    await noHScroll(page);
    await sideBySide(page);
    await page.getByTestId('opt-cat-client').click();
    await noHScroll(page);
    await sideBySide(page);
  } finally {
    await app.close();
  }
});

// O1 Task 5: the client settings at run time — confirmations, the last base (the recent count is above).
type Switch = 'confirmRecordChanges' | 'confirmDocumentDeletions' | 'confirmActionQueries' | 'openLast';
const setSetting = (page: Page, k: Switch, v: boolean) =>
  page.evaluate(([key, val]) => (window as unknown as W).basecraft.app.setSetting(key as Switch, val), [k, v] as const);
const montants = (page: Page, client: number) => page.evaluate((c) => (window as unknown as W).basecraft.rows.page('Commandes', { offset: 0, limit: 100 })
  .then((p) => p.rows.filter((r) => r.values[1] === c).map((r) => r.values[2] as number)), client);
const count = (page: Page, table: string) => page.evaluate((t) => (window as unknown as W).basecraft.rows.count(t), table);
const salesBase = (name: string) => seedBase(name, (db) => {
  seedSales(db);
  seedSalesRelation(db);
  saveObject(db, 'query', 'QDouble', { formatVersion: '1.0', sql: 'UPDATE Commandes SET Montant = Montant * 2 WHERE Client = 2;' }, null);
  saveObject(db, 'query', 'QBase', { formatVersion: '1.0', sql: 'SELECT * FROM Clients;' }, null);
  saveObject(db, 'query', 'QUses', { formatVersion: '1.0', sql: 'SELECT Nom FROM QBase;' }, null);
  saveObject(db, 'form', 'FTemp', { formatVersion: '1.0', sections: [] } as never, null);
});
const MARKER = 44, HEADER = 34, ROW = 30;
/** Selects a record of the open datasheet by its row selector, then Home › Delete Record. */
async function deleteRow(page: Page, row: number) {
  await expect(page.getByTestId('datasheet').getByTestId('data-grid-canvas')).toBeVisible();   // Glide lays out after a render
  const b = (await page.getByTestId('datasheet').getByTestId('data-grid-canvas').boundingBox())!;
  await page.mouse.click(b.x + MARKER / 2, b.y + HEADER + row * ROW + ROW / 2);
  await expect(page.getByTestId('datasheet').locator(`tr[aria-rowindex="${row + 2}"]`)).toHaveAttribute('aria-selected', 'true');
  await page.getByTestId('ribbon-tab-home').click();
  await page.getByTestId('cmd-deleteRecord').click();
}
const modal = (page: Page) => page.getByTestId('modal');
const navDelete = async (page: Page, id: string) => {
  await page.getByTestId(id).click({ button: 'right' });
  await page.getByTestId('nav-menu-delete').click();
};

test('confirmations on ask; off, each one is read when it would ask: records, documents, action queries', async () => {
  const { app, page } = await launchApp({ args: [salesBase('opt-confirm')], env: FR });
  try {
    // on (the defaults): each asks; No leaves everything as it was
    await page.getByTestId('nav-item-Commandes').dblclick();
    await expect(page.getByTestId('datasheet').getByTestId('data-grid-canvas')).toBeVisible();
    await deleteRow(page, 0);
    await expect(modal(page)).toContainText(fr.datasheet.delete_one);
    await page.getByTestId('modal-btn-no').click();
    await expect(modal(page)).toHaveCount(0);
    expect(await count(page, 'Commandes')).toBe(5);

    await navDelete(page, 'nav-item-query-QDouble');
    await expect(modal(page)).toContainText(fr.nav.deleteObjectMessage.replace('{{name}}', 'QDouble'));
    await page.getByTestId('modal-btn-no').click();
    await expect(page.getByTestId('nav-item-query-QDouble')).toBeVisible();

    const before = await montants(page, 2);
    expect(before).toHaveLength(2);
    await page.getByTestId('nav-item-query-QDouble').dblclick();
    await expect(modal(page)).toContainText(fr.query.action.confirm_update_other.replace('{{count}}', '2'));
    await page.getByTestId('modal-btn-no').click();
    await expect(modal(page)).toHaveCount(0);
    expect(await montants(page, 2)).toEqual(before);

    // all three off, in this same session (each is read when it would ask): nothing is asked
    for (const k of ['confirmRecordChanges', 'confirmDocumentDeletions', 'confirmActionQueries'] as const) await setSetting(page, k, false);
    await deleteRow(page, 1);   // not row 0, still selected: a second click on its selector would deselect it
    await expect.poll(() => count(page, 'Commandes')).toBe(4);
    await expect(modal(page)).toHaveCount(0);

    await page.getByTestId('nav-item-query-QDouble').dblclick();
    await expect.poll(() => montants(page, 2)).toEqual(before.map((m) => m * 2));
    await expect(modal(page)).toHaveCount(0);

    // a refusal is still shown: Dupont has orders (datasheet.related)
    await page.getByTestId('nav-item-Clients').dblclick();
    await expect(page.getByTestId('doc-tab-Clients')).toBeVisible();
    await deleteRow(page, 0);
    await expect(modal(page)).toContainText(fr.datasheet.related.replace('{{table}}', 'Commandes'));
    await page.getByTestId('modal-btn-ok').click();
    await expect(modal(page)).toHaveCount(0);
    expect(await count(page, 'Clients')).toBe(4);

    // documents: a form goes at once, a query nothing uses too; one that another query uses still warns
    await navDelete(page, 'nav-item-form-FTemp');
    await expect(page.getByTestId('nav-item-form-FTemp')).toHaveCount(0);
    await navDelete(page, 'nav-item-query-QDouble');
    await expect(page.getByTestId('nav-item-query-QDouble')).toHaveCount(0);
    await navDelete(page, 'nav-item-query-QBase');
    await expect(modal(page)).toContainText('QUses');
    await page.getByTestId('modal-btn-no').click();
    await expect(page.getByTestId('nav-item-query-QBase')).toBeVisible();

    // back on: asked again
    await setSetting(page, 'confirmDocumentDeletions', true);
    await navDelete(page, 'nav-item-query-QUses');
    await expect(modal(page)).toContainText(fr.nav.deleteObjectMessage.replace('{{name}}', 'QUses'));
    await page.getByTestId('modal-btn-no').click();
    await expect(page.getByTestId('nav-item-query-QUses')).toBeVisible();
  } finally {
    await app.close();
  }
});

test('untrusted base, action queries off: still blocked until « Activer le contenu », then it runs without the count question', async () => {
  const { app, page } = await launchApp({ args: [salesBase('opt-untrusted')], env: FR, untrusted: true });
  try {
    await setSetting(page, 'confirmActionQueries', false);
    const before = await montants(page, 2);
    await page.getByTestId('nav-item-query-QDouble').dblclick();
    await expect(modal(page)).toContainText(fr.query.action.contentDisabled);
    await page.getByTestId('modal-btn-ok').click();
    await expect(modal(page)).toHaveCount(0);
    expect(await montants(page, 2)).toEqual(before);

    await page.getByTestId('banner-enable-content').click();
    await expect(page.getByTestId('banner-content')).toHaveCount(0);
    await page.getByTestId('nav-item-query-QDouble').dblclick();
    await expect.poll(() => montants(page, 2)).toEqual(before.map((m) => m * 2));
    await expect(modal(page)).toHaveCount(0);
  } finally {
    await app.close();
  }
});

test('open the last base at startup: when asked and present; a command-line base wins; a file that fails to open is told', async () => {
  const a = seedBase('last-a'), b = seedBase('last-b');
  const dir = mkdtempSync(join(tmpdir(), 'basecraft-last-'));
  const state = (page: Page) => page.evaluate(() => (window as unknown as W).basecraft.base.state());
  /** Nothing opened and nothing told: the Backstage shows (openFailure answers after any opening in progress). */
  const nothing = async (page: Page) => {
    await expect(page.getByTestId('backstage')).toBeVisible();
    await page.evaluate(() => (window as unknown as W).basecraft.base.openFailure());
    expect(await state(page)).toBeNull();
    await expect(modal(page)).toHaveCount(0);
  };

  // the chain: open a base, turn the option on, relaunch with no file
  let r = await launchApp({ args: [a], env: FR, userDataDir: dir });
  try {
    await setSetting(r.page, 'openLast', true);
    await expect.poll(() => settingsFile(dir).openLast).toBe(true);
  } finally {
    await r.app.close();
  }
  r = await launchApp({ env: FR, userDataDir: dir });
  try {
    await expect.poll(async () => (await state(r.page))?.path).toBe(a);
    await expect(r.page.getByTestId('backstage')).toHaveCount(0);
  } finally {
    await r.app.close();
  }

  // BaseCraft Runtime has its own profile and honours the same setting
  const rt = mkdtempSync(join(tmpdir(), 'basecraft-last-rt-'));
  writeFileSync(join(rt, 'settings.json'), JSON.stringify({ openLast: true, recentFiles: [b] }));
  r = await launchApp({ env: FR, userDataDir: rt, runtime: true });
  try {
    await expect.poll(async () => (await state(r.page))?.path).toBe(b);
  } finally {
    await r.app.close();
  }

  // a base on the command line wins over the last one (a is the last here; b is given)
  r = await launchApp({ args: [b], env: FR, userDataDir: dir });
  try {
    expect((await state(r.page))?.path).toBe(b);
  } finally {
    await r.app.close();
  }

  // the most recent file (b) is gone: nothing opens, no dialog; the older one (a) is not taken instead
  const moved = `${b}.moved`;
  renameSync(b, moved);
  r = await launchApp({ env: FR, userDataDir: dir });
  try {
    await nothing(r.page);
  } finally {
    await r.app.close();
  }

  // a file that is there but is no base: the opening error, as for a base on the command line
  writeFileSync(b, 'not a base');
  r = await launchApp({ env: FR, userDataDir: dir });
  try {
    await expect(modal(r.page)).toContainText(fr.dialog.error.notBasecraft);
    await r.page.getByTestId('modal-btn-ok').click();
    expect(await state(r.page)).toBeNull();
  } finally {
    await r.app.close();
  }

  // settings.json is edited by hand: an entry that is no valid base path (a folder, another file, a relative path) opens nothing, silently
  const folderBase = join(dir, 'dossier.basecraft'), text = join(dir, 'notes.txt');
  mkdirSync(folderBase);
  writeFileSync(text, 'x');
  for (const p of [folderBase, text, 'last-b.basecraft']) {
    writeFileSync(join(dir, 'settings.json'), JSON.stringify({ ...settingsFile(dir), recentFiles: [p] }));
    r = await launchApp({ env: FR, userDataDir: dir });
    try {
      await nothing(r.page);
    } finally {
      await r.app.close();
    }
  }

  // the option off: nothing opens
  writeFileSync(join(dir, 'settings.json'), JSON.stringify({ ...settingsFile(dir), openLast: false }));
  r = await launchApp({ env: FR, userDataDir: dir });
  try {
    await nothing(r.page);
  } finally {
    await r.app.close();
  }
});

test('shared-data settings: Access defaults, the pessimistic radios disabled, number fields clamped and kept after a relaunch', async () => {
  const { app, page, userDataDir } = await launchApp({ env: FR });
  try {
    await page.getByTestId('bs-options').click();
    await page.getByTestId('opt-cat-client').click();
    await expect(page.getByTestId('opt-open-mode-shared')).toBeChecked();
    await expect(page.getByTestId('opt-open-mode-exclusive')).not.toBeChecked();
    await expect(page.getByTestId('opt-record-locking-none')).toBeChecked();
    for (const id of ['all', 'edited']) {
      await expect(page.getByTestId(`opt-record-locking-${id}`)).toBeDisabled();
      await expect(page.locator('label', { has: page.getByTestId(`opt-record-locking-${id}`) })).toHaveAttribute('title', fr.ribbon.planned.later);
    }
    await expect(page.getByTestId('opt-refresh-interval')).toHaveValue('60');
    await expect(page.getByTestId('opt-update-retries')).toHaveValue('2');
    await expect(page.getByTestId('opt-update-retry-ms')).toHaveValue('250');

    await page.getByTestId('opt-open-mode-exclusive').check();
    await page.getByTestId('opt-refresh-interval').fill('5');
    await page.getByTestId('opt-refresh-interval').press('Enter');
    await page.getByTestId('opt-update-retries').fill('99');
    await page.getByTestId('opt-update-retries').press('Enter');
    await expect.poll(() => settingsFile(userDataDir)).toMatchObject({ openMode: 'exclusive', refreshInterval: 5, updateRetries: 10, recordLocking: 'none' });
    await page.getByTestId('opt-refresh-interval').fill('0');
    await page.getByTestId('opt-refresh-interval').press('Enter');
    await expect.poll(() => settingsFile(userDataDir).refreshInterval).toBe(1);
    await page.getByTestId('opt-refresh-interval').fill('5');
    await page.getByTestId('opt-refresh-interval').press('Enter');
    await expect.poll(() => settingsFile(userDataDir).refreshInterval).toBe(5);
  } finally {
    await app.close();
  }

  const again = await launchApp({ env: FR, userDataDir });
  try {
    await again.page.getByTestId('bs-options').click();
    await again.page.getByTestId('opt-cat-client').click();
    await expect(again.page.getByTestId('opt-refresh-interval')).toHaveValue('5');
    await expect(again.page.getByTestId('opt-open-mode-exclusive')).toBeChecked();
  } finally {
    await again.app.close();
  }
});

test('a base open: « Application frontale » and « Fichier de données partagé » write bc_meta, the other startup keys unchanged', async () => {
  const path = seedBase('options-datafile');
  const { app, page } = await launchApp({ args: [path], env: FR });
  try {
    await page.getByTestId('ribbon-tab-file').click();
    await openDbOptions(page);
    await expect(page.getByTestId('opt-db-datafile')).not.toBeChecked();
    await expect(page.getByTestId('opt-db-datafile')).toHaveAccessibleName(fr.options.db.dataFile);
    const before = await startup(page);
    await page.getByTestId('opt-db-datafile').check();
    await expect.poll(async () => (await startup(page)).dataFile).toBe(true);
    // read raw by the test, as the data file's reader will (the app holds the lock; a read-only connection waits out the write)
    await expect.poll(() => (JSON.parse(inFile<{ value: string }>(path, `SELECT value FROM bc_meta WHERE key = 'options'`)[0]!.value) as { startup: Record<string, unknown> }).startup)
      .toMatchObject({ ...before, dataFile: true });
    await page.getByTestId('opt-db-frontend').check();
    await expect.poll(async () => (await startup(page)).frontEnd).toBe(true);
    await expect(page.getByTestId('opt-db-datafile')).toBeChecked();
  } finally {
    await app.close();
  }
});
