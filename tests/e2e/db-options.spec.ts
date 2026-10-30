// O1 Task 4: the base's options applied at run time, in the full application and the Runtime — full menus, default shortcut
// menus, special keys, status bar, document tabs, table design in Datasheet view, the icon for forms and reports. The owner is
// never locked out: Shift + Recent and File › Options › « Base de données active » give the base back (B3 R12, G4).
import { test, expect, type Page } from '@playwright/test';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createTable } from '../../src/main/db/schema';
import { saveObject } from '../../src/main/db/objects';
import { saveStartupOptions } from '../../src/main/db/startup';
import { seedSales } from '../../src/main/query/test-db';
import type { BasecraftApi } from '../../src/shared/api';
import type { ControlDef, DesignDoc } from '../../src/shared/design/model';
import type { MacroItem } from '../../src/shared/macro/model';
import { DEFAULT_STARTUP, type StartupOptions } from '../../src/shared/startup';
import { f, t } from '../../src/shared/test-fixtures';
import { SHIFT_GRACE_MS } from '../../src/renderer/shell/shift-key';
import { launchApp, openDbOptions, seedBase, seedForm, seedReportsE2E } from './helpers';

const fr = JSON.parse(readFileSync(join(__dirname, '../../src/shared/i18n/fr.json'), 'utf8'));
const FR = { BASECRAFT_REGION: 'fr-FR' };
const REPORT = 'Factures par client';
const ICON = readFileSync(join(__dirname, '../../build/icon.png')).toString('base64');
// DatasheetView: row selector width, header and row heights, an AutoNumber column's width.
const MARKER = 44, HEADER = 34, ROW = 30, AUTONUMBER = 80;
const fill = (s: string, p: Record<string, string>) => s.replace(/\{\{(\w+)\}\}/g, (_, k: string) => p[k]!);
const act = (action: string, args: Record<string, string> = {}): MacroItem => ({ k: 'action', action, args });
const embedded = (...items: MacroItem[]) => ({ embedded: { formatVersion: '1.0' as const, items } });
const box = (kind: ControlDef['kind'], name: string, top: number, props: Record<string, unknown>): ControlDef =>
  ({ kind, name, left: 1701, top, width: 2268, height: 340, props });
const form = (recordSource: DesignDoc['recordSource'], controls: ControlDef[]): DesignDoc => ({
  formatVersion: '1.0', recordSource, props: { Width: 9072 },
  sections: [{ kind: 'formHeader', height: 0, props: { Visible: false }, controls: [] },
    { kind: 'detail', height: 1200, props: {}, controls },
    { kind: 'formFooter', height: 0, props: { Visible: false }, controls: [] }],
});
const FMENU = form(null, [box('commandButton', 'cmdConception', 100, { Caption: 'Création', OnClick: embedded(act('OpenForm', { FormName: 'FClients', View: 'design' })) })]);
const FCLIENTS = form({ kind: 'table', name: 'Clients' }, [box('textBox', 'Nom', 100, { ControlSource: 'Nom' }), box('textBox', 'Ville', 600, { ControlSource: 'Ville' })]);
const TICKETS = t('Tickets', [f('N°', 'autoNumber'), f('Etat', 'shortText', { lookup: { kind: 'values', values: ['Ouverte', 'Fermée'], allowValueListEdits: true, limitToList: false } })]);
/** Full menus, default shortcut menus and special keys off (the roadmap's O1 acceptance). */
const OFF: Partial<StartupOptions> = { fullMenus: false, shortcutMenus: false, specialKeys: false };

/** seedSales, « Factures par client », FMenu, FClients, Tickets (a value list the user may edit), the options given. */
const seed = (name: string, options: Partial<StartupOptions>) => seedBase(name, (db) => {
  seedSales(db);
  seedReportsE2E(db);
  seedForm(db, 'FMenu', FMENU);
  seedForm(db, 'FClients', FCLIENTS);
  createTable(db, TICKETS);
  db.prepare('INSERT INTO "Tickets" ("Etat") VALUES (?)').run('Ouverte');
  const r = saveObject(db, 'macro', 'MBip', { formatVersion: '1.0', items: [act('Beep')] }, null);
  if (!r.ok) throw new Error(r.reason);
  saveStartupOptions(db, { ...DEFAULT_STARTUP, ...options });
});

type Win = { basecraft: BasecraftApi };
const api = (page: Page) => ({
  state: () => page.evaluate(() => (window as unknown as Win).basecraft.base.state()),
  startup: () => page.evaluate(() => (window as unknown as Win).basecraft.base.startup()),
  noms: () => page.evaluate(() => (window as unknown as Win).basecraft.rows.page('Clients', { offset: 0, limit: 100 }).then((p) => p.rows.map((r) => r.values[1]))),
  insert: (Nom: string) => page.evaluate((n) => (window as unknown as Win).basecraft.rows.insert('Clients', { Nom: n }), Nom),
});
const ribbonTabs = (page: Page) => page.locator('[data-testid^="ribbon-tab-"]').evaluateAll((els) => els.map((e) => (e as HTMLElement).dataset.testid));
/** The document in front (every document stays mounted, only the front one is shown). */
const cur = (page: Page) => page.locator('.doc:not([hidden])');
const cell = (page: Page, col: number, row: number) => page.getByTestId(`glide-cell-${col + 1}-${row}`);
/** Clicks the second column's cell of a row (after an AutoNumber), and waits until Glide has focused it. */
const clickCell = async (page: Page, row: number) => {
  const b = (await cur(page).getByTestId('data-grid-canvas').boundingBox())!;
  await page.mouse.click(b.x + MARKER + AUTONUMBER + 30, b.y + HEADER + row * ROW + ROW / 2);
  await expect(cell(page, 1, row)).toBeFocused();
};
const openSheet = async (page: Page, table: string) => {
  await page.getByTestId(`nav-item-${table}`).dblclick();
  await expect(cur(page).getByTestId('data-grid-canvas')).toBeVisible();
};

/** Full menus, shortcut menus and special keys off: no design command, no shortcut menu, no F11; Ctrl+S and Shift+F9 still work. */
async function expectLocked(page: Page) {
  await expect.poll(() => ribbonTabs(page)).toEqual(['ribbon-tab-file', 'ribbon-tab-home']);   // once the sequence has run
  await expect(page.getByTestId('nav-pane')).toBeVisible();
  const item = page.getByTestId('nav-item-form-FClients');
  await item.click({ button: 'right' });
  await expect(page.getByTestId('nav-menu')).toHaveCount(0);
  await item.focus();
  await page.keyboard.press('Shift+F10');
  await expect(page.getByTestId('nav-menu')).toHaveCount(0);
  await page.keyboard.press('F11');
  await expect(page.getByTestId('nav-pane')).toBeVisible();

  // a macro's OpenForm in Design view is refused (full menus off is run mode)
  await page.getByTestId('nav-item-form-FMenu').dblclick();
  await expect(page.getByTestId('doc-tab-form-FMenu')).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByTestId('status-view-design')).toHaveCount(0);
  await page.getByTestId('form-ctl-cmdConception').filter({ visible: true }).click();
  await expect(page.getByTestId('macro-failed-message')).toHaveText(fill(fr.macro.error.actionCancelled, { action: fr.macro.action.OpenForm }));
  await page.getByTestId('macro-failed-stop').click();
  await expect(page.getByTestId('modal')).toHaveCount(0);
  await expect(page.getByTestId('doc-tab-form-FClients')).toHaveCount(0);

  // Ctrl+S and Shift+F9 are not Access's special keys
  await openSheet(page, 'Clients');
  await clickCell(page, 0);
  await page.keyboard.press('X');
  await expect(page.getByTestId('grid-editor-portal').locator('textarea')).toBeFocused();
  await page.keyboard.type('avier');
  await page.keyboard.press('Control+s');
  await expect.poll(() => api(page).noms()).toEqual(['Xavier', 'Martin', 'Durand', 'Éric']);
  expect(await api(page).insert('Zola')).toMatchObject({ ok: true });
  await expect(cur(page).getByTestId('nav-record-count')).toHaveText('4');
  await page.keyboard.press('Shift+F9');
  await expect(cur(page).getByTestId('nav-record-count')).toHaveText('5');
}

test('full menus, shortcut menus and special keys off in the full application; Shift + Recent gives everything back', async () => {
  const { app, page } = await launchApp({ args: [seed('dbopt-off', OFF)], env: FR });
  try {
    await expectLocked(page);

    // B3's Shift bypass: every tab, the status bar's Design button, the shortcut menus and F11 are back
    await page.getByTestId('ribbon-tab-file').click();
    await page.getByTestId('bs-close').click();
    await expect.poll(() => api(page).state()).toBeNull();
    await page.getByTestId('bs-recent').click();
    await page.getByTestId('bs-recent-0').click({ modifiers: ['Shift'] });
    await expect.poll(() => api(page).state()).not.toBeNull();
    await page.waitForTimeout(SHIFT_GRACE_MS * 2);   // past the moment the sequence would have run
    await expect(page.getByTestId('ribbon-tab-create')).toBeVisible();
    await expect(page.getByTestId('ribbon-tab-externalData')).toBeVisible();
    const item = page.getByTestId('nav-item-form-FClients');
    await item.click({ button: 'right' });
    await expect(page.getByTestId('nav-menu')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('nav-menu')).toHaveCount(0);
    await item.focus();
    await page.keyboard.press('Shift+F10');
    await expect(page.getByTestId('nav-menu-open')).toBeFocused();
    await page.keyboard.press('Escape');
    await page.keyboard.press('F11');
    await expect(page.getByTestId('nav-pane')).toHaveCount(0);
    await page.keyboard.press('F11');
    await expect(page.getByTestId('nav-pane')).toBeVisible();
    await item.dblclick();
    await expect(page.getByTestId('status-view-design')).toBeVisible();
    await expect(page.getByTestId('status-mode')).toBeVisible();
  } finally {
    await app.close();
  }
});

test('the same base in the Runtime: no shortcut menu, F11 does nothing (the option overrides B5 R3)', async () => {
  const { app, page } = await launchApp({ runtime: true, args: [seed('dbopt-off-rt', OFF)], env: FR });
  try {
    await expectLocked(page);
  } finally {
    await app.close();
  }
});

test('locked out (all off, run mode, no pane, no startup form): File › Options › « Base de données active » gives full menus back (G4)', async () => {
  const path = seed('dbopt-lockout', { ...OFF, runMode: true, showNavPane: false });
  const { app, page } = await launchApp({ args: [path], env: FR });
  try {
    await expect.poll(() => ribbonTabs(page)).toEqual(['ribbon-tab-file', 'ribbon-tab-home']);   // once the sequence has run
    await expect(page.getByTestId('backstage')).toHaveCount(0);
    await expect(page.locator('.docs .doc-empty')).toBeVisible();   // the document area, empty
    await expect(page.getByTestId('nav-pane')).toHaveCount(0);
    await page.keyboard.press('F11');
    await expect(page.getByTestId('nav-pane')).toHaveCount(0);

    await page.getByTestId('ribbon-tab-file').click();
    await openDbOptions(page);
    await page.getByTestId('opt-db-fullmenus').check();
    await page.getByTestId('opt-db-runmode').uncheck();
    await expect.poll(() => api(page).startup().then((s) => [s.fullMenus, s.runMode])).toEqual([true, false]);
    await page.getByTestId('bs-close').click();
    await expect.poll(() => api(page).state()).toBeNull();
    await page.getByTestId('bs-recent').click();
    await page.getByTestId('bs-recent-0').click();   // no Shift: the sequence runs
    await expect(page.getByTestId('ribbon-tab-create')).toBeVisible();
    await expect(page.getByTestId('nav-pane')).toHaveCount(0);   // its own option still hides it
  } finally {
    await app.close();
  }
});

test('status bar and document tabs off: no status bar, no tab strip, the last document in front; a Query Builder shows its own tab', async () => {
  const { app, page } = await launchApp({ args: [seed('dbopt-tabs', { statusBar: false, documentTabs: false })], env: FR });
  try {
    await expect(page.getByTestId('nav-pane')).toBeVisible();
    await expect(page.getByTestId('status-mode')).toHaveCount(0);
    const tabs = page.locator('[data-testid^="doc-tab-"]');
    await page.getByTestId('nav-item-form-FClients').dblclick();
    await expect(cur(page).getByTestId('form-ctl-Nom')).toBeVisible();
    await expect(tabs).toHaveCount(0);
    await openSheet(page, 'Clients');
    await expect(cur(page).getByTestId('datasheet')).toBeVisible();
    await expect(tabs).toHaveCount(0);
    await expect(page.getByRole('tablist')).toHaveCount(1);   // the ribbon's only
    await expect(page.locator('.doc[role="tabpanel"]')).toHaveCount(0);   // no tab panel without its tab

    // design is allowed (full menus on): Record Source's Query Builder brings its own tab
    await page.getByTestId('nav-item-form-FClients').click({ button: 'right' });
    await page.getByTestId('nav-menu-design').click();
    await expect(page.getByTestId('property-sheet')).toBeVisible();
    await page.getByTestId('prop-RecordSource-build').click();
    await page.getByTestId('modal-btn-yes').click();
    await expect(page.getByTestId('rowsource-builder-tab')).toBeVisible();
    await expect(tabs).toHaveCount(0);
  } finally {
    await app.close();
  }
});

test('table design in Datasheet view off: no Table Fields tab, no Edit List Items; Design view of the table still opens', async () => {
  const { app, page } = await launchApp({ args: [seed('dbopt-sheet', { datasheetDesign: false })], env: FR });
  try {
    await page.waitForTimeout(SHIFT_GRACE_MS * 2);   // past the startup sequence (nothing else shows it has run)
    await openSheet(page, 'Clients');
    await expect(page.getByTestId('ribbon-tab-table')).toBeVisible();
    await expect(page.getByTestId('ribbon-tab-tableFields')).toHaveCount(0);

    await openSheet(page, 'Tickets');
    await clickCell(page, 0);
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('lookup-editor')).toBeFocused();
    await expect(page.getByTestId('lookup-edit-list')).toHaveCount(0);
    await page.keyboard.press('F2');
    await expect(page.getByTestId('edit-list-items')).toHaveCount(0);
    await page.keyboard.press('Escape');

    await page.getByTestId('doc-tab-Clients').click();
    await page.getByTestId('status-view-design').click();
    await expect(page.getByTestId('design-row-0-name')).toBeVisible();
  } finally {
    await app.close();
  }
});

test('the application icon on form and report tabs: shown with the option, gone at once when unticked or when the icon is removed', async () => {
  const { app, page } = await launchApp({ args: [seed('dbopt-icon', { appIcon: ICON, iconForForms: true })], env: FR });
  const formTab = page.getByTestId('doc-tab-form-FClients');
  try {
    await page.getByTestId('nav-item-form-FClients').dblclick();
    await expect(formTab.locator('img')).toHaveAttribute('src', /^data:image\/png;base64,/);
    await expect(formTab.locator('img')).toHaveAttribute('alt', '');
    await expect(formTab.locator('svg')).toHaveCount(0);
    await page.getByTestId(`nav-item-report-${REPORT}`).dblclick();
    await expect(page.getByTestId(`doc-tab-report-${REPORT}`).locator('img')).toHaveAttribute('src', /^data:image\/png;base64,/);
    await openSheet(page, 'Clients');
    await expect(page.getByTestId('doc-tab-Clients').locator('img')).toHaveCount(0);
    await expect(page.getByTestId('doc-tab-Clients').locator('svg').first()).toBeVisible();

    await page.getByTestId('ribbon-tab-file').click();
    await openDbOptions(page);
    await page.getByTestId('opt-db-iconforms').uncheck();
    await expect(formTab.locator('img')).toHaveCount(0);   // at once (R3), the Backstage still open
    await expect(formTab.locator('svg')).toHaveCount(1);
    await page.getByTestId('opt-db-iconforms').check();
    await expect(formTab.locator('img')).toHaveCount(1);
    await page.getByTestId('opt-db-icon-remove').click();   // the option stays ticked, but there is no icon to show
    await expect(formTab.locator('img')).toHaveCount(0);
    expect((await api(page).startup()).iconForForms).toBe(true);
  } finally {
    await app.close();
  }
});

// O1 Task 6: « Compacter lors de la fermeture » (R8) — Compact and Repair run by the close, in the full application and the Runtime.
const NOTES = t('Notes', [f('N°', 'autoNumber'), f('Texte', 'shortText')]);
/** A base whose free pages are most of the file (2 000 rows inserted, then deleted but one), with the options given. */
const bloated = (name: string, options: Partial<StartupOptions>) => seedBase(name, (db) => {
  createTable(db, NOTES);
  db.exec(`INSERT INTO "Notes" ("Texte") VALUES ('Dupont')`);
  db.exec(`WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < 2000)
    INSERT INTO "Notes" ("Texte") SELECT 'Client ' || i || ' ' || hex(randomblob(90)) FROM n`);
  db.exec(`DELETE FROM "Notes" WHERE "Texte" <> 'Dupont'`);
  saveStartupOptions(db, { ...DEFAULT_STARTUP, ...options });
});
const size = (path: string) => statSync(path).size;
const backups = (path: string) => readdirSync(dirname(path)).filter((n) => n.includes('.backup-'));
/** What a close must not leave beside the base: a half-written copy (.compact, .bc-tmp). */
const halfWritten = (path: string) => readdirSync(dirname(path)).filter((n) => /\.(compact|bc-tmp)$/.test(n));
const texts = (path: string) => {
  const db = new DatabaseSync(path, { readOnly: true });
  try { return db.prepare('SELECT "Texte" FROM "Notes"').all().map((r) => (r as { Texte: string }).Texte); } finally { db.close(); }
};
/** The close of the base, whole (the compact included): what the File tab's Close awaits. */
const closeBase = (page: Page) => page.evaluate(() => (window as unknown as Win).basecraft.base.close());

test('compact on close: the file shrinks, the backup goes, the lock goes, the data is intact and the base reopens', async () => {
  const path = await bloated('dbopt-compact', { compactOnClose: true });
  const before = size(path);
  const { app, page } = await launchApp({ args: [path], env: FR });
  try {
    await page.getByTestId('ribbon-tab-file').click();
    await page.getByTestId('bs-close').click();
    await expect.poll(() => existsSync(`${path}.lock`), { timeout: 20_000 }).toBe(false);   // the lock goes last, after the compact
    expect(size(path)).toBeLessThan(before / 2);
    expect(backups(path)).toEqual([]);   // a compact that repaired nothing keeps no backup (G5)
    expect(halfWritten(path)).toEqual([]);
    expect(texts(path)).toEqual(['Dupont']);

    await page.getByTestId('bs-recent').click();
    await page.getByTestId('bs-recent-0').click();
    await expect.poll(() => api(page).state()).toMatchObject({ path, readOnly: false });
    expect(await page.evaluate(() => (window as unknown as Win).basecraft.rows.count('Notes'))).toBe(1);
  } finally {
    await app.close();
  }
  expect(texts(path)).toEqual(['Dupont']);
});

test('compact on close not asked: closing leaves the file as it is, with no backup', async () => {
  const path = await bloated('dbopt-nocompact', {});
  const before = size(path);
  const { app, page } = await launchApp({ args: [path], env: FR });
  try {
    await closeBase(page);
    expect(existsSync(`${path}.lock`)).toBe(false);
    expect(size(path)).toBe(before);
    expect(backups(path)).toEqual([]);
  } finally {
    await app.close();
  }
});

test('compact on close in a session that cannot write: the base is not touched', async () => {
  const path = await bloated('dbopt-compact-ro', { compactOnClose: true });
  const before = size(path);
  const holder = await launchApp({ args: [path], env: FR });   // takes the lock
  try {
    const { app, page } = await launchApp({ args: [path], env: FR });   // finds it held: read-only
    try {
      expect(await api(page).state()).toMatchObject({ readOnly: true });
      await closeBase(page);
      expect(size(path)).toBe(before);
      expect(backups(path)).toEqual([]);
      expect(existsSync(`${path}.lock`)).toBe(true);   // the other session's, not removed
    } finally {
      await app.close();
    }
    expect(await api(holder.page).state()).toMatchObject({ readOnly: false });
  } finally {
    await holder.app.close();
  }
});

test('compact on close while another session reads the base: the data is intact and the close ends; Windows refuses the swap, the others make it', async () => {
  const path = await bloated('dbopt-compact-shared', { compactOnClose: true });
  const writer = await launchApp({ args: [path], env: FR });
  const reader = await launchApp({ args: [path], env: FR });   // read-only: its handle may keep the swap from replacing the file (Windows)
  try {
    expect(await api(reader.page).state()).toMatchObject({ readOnly: true });
    const before = size(path);
    await closeBase(writer.page);
    expect(existsSync(`${path}.lock`)).toBe(false);
    expect(texts(path)).toEqual(['Dupont']);
    expect(halfWritten(path)).toEqual([]);
    // Windows: the reader's handle keeps the swap from replacing the file; the file is as it was and the backup, which only
    // repeats it, is removed (G5 bounded). Elsewhere the rename succeeds under the reader, which goes on reading the old inode.
    if (process.platform === 'win32') expect(size(path)).toBe(before);
    else expect(size(path)).toBeLessThan(before / 2);
    expect(backups(path)).toEqual([]);
    expect(await reader.page.evaluate(() => (window as unknown as Win).basecraft.rows.count('Notes'))).toBe(1);
  } finally {
    await reader.app.close();
    await writer.app.close();
  }
});

test('compact on close in the Runtime (G2): the file shrinks and the backup goes', async () => {
  const path = await bloated('dbopt-compact-rt', { compactOnClose: true });
  const before = size(path);
  const { app, page } = await launchApp({ runtime: true, args: [path], env: FR });
  try {
    await closeBase(page);
    expect(existsSync(`${path}.lock`)).toBe(false);
    expect(size(path)).toBeLessThan(before / 2);
    expect(backups(path)).toEqual([]);
    expect(texts(path)).toEqual(['Dupont']);
  } finally {
    await app.close();
  }
});
