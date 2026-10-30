import { test, expect, type ElectronApplication, type Page } from '@playwright/test';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { openBaseFile } from '../../src/main/db/file-format';
import { saveObject } from '../../src/main/db/objects';
import { splitDatabase } from '../../src/main/db/split';
import { saveStartupOptions } from '../../src/main/db/startup';
import { addLinks } from '../../src/main/links/store';
import { seedSales } from '../../src/main/query/test-db';
import type { BasecraftApi } from '../../src/shared/api';
import type { ControlDef, DesignDoc } from '../../src/shared/design/model';
import type { MacroItem } from '../../src/shared/macro/model';
import { DEFAULT_STARTUP, type StartupOptions } from '../../src/shared/startup';
import { launchApp, seedBase, seedForm, seedReportsE2E, seedSalesE2E } from './helpers';

// The Runtime build (electron-vite build --mode runtime → out-runtime/) is launched like the full one: launchApp({ runtime: true }).

const windowTitle = (app: ElectronApplication) => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].getTitle());
const appName = (app: ElectronApplication) => app.evaluate(({ app: a }) => a.getName());

test('the Runtime starts as BaseCraft Runtime', async () => {
  const rt = await launchApp({ runtime: true });
  try {
    await expect.poll(() => windowTitle(rt.app)).toBe('BaseCraft Runtime');
    await expect(rt.page.getByTestId('bs-brand')).toHaveText('BaseCraft Runtime');
    await rt.page.getByTestId('bs-about').click();
    await expect(rt.page.getByTestId('about').locator('h1')).toHaveText(/ BaseCraft Runtime$/); // « À propos de … » / « About … »
  } finally {
    await rt.app.close();
  }
  const full = await launchApp();
  try {
    await expect.poll(() => windowTitle(full.app)).toBe('BaseCraft');
    await expect(full.page.getByTestId('bs-brand')).toHaveText('BaseCraft');
  } finally {
    await full.app.close();
  }
});

// B5 Task 4: the Runtime takes B3's run mode for good (simplified ribbon, no Design view, no Shift bypass), a reduced File tab,
// a Page Setup that is not saved, and disabled mode unchanged.
const fr = JSON.parse(readFileSync(join(__dirname, '../../src/shared/i18n/fr.json'), 'utf8'));
const FR = { BASECRAFT_REGION: 'fr-FR' };
const REPORT = 'Factures par client';
const fill = (s: string, p: Record<string, string>) => s.replace(/\{\{(\w+)\}\}/g, (_, k: string) => p[k]!);
const act = (action: string, args: Record<string, string> = {}): MacroItem => ({ k: 'action', action, args });
const macro = (db: DatabaseSync, name: string, items: MacroItem[]) => {
  const r = saveObject(db, 'macro', name, { formatVersion: '1.0', items }, null);
  if (!r.ok) throw new Error(r.reason);
};
const box = (kind: ControlDef['kind'], name: string, top: number, props: Record<string, unknown>): ControlDef =>
  ({ kind, name, left: 1701, top, width: 2268, height: 340, props });
const form = (recordSource: DesignDoc['recordSource'], controls: ControlDef[]): DesignDoc => ({
  formatVersion: '1.0', recordSource, props: { Width: 9072 },
  sections: [{ kind: 'formHeader', height: 0, props: { Visible: false }, controls: [] },
    { kind: 'detail', height: 1200, props: {}, controls },
    { kind: 'formFooter', height: 0, props: { Visible: false }, controls: [] }],
});
const embedded = (...items: MacroItem[]) => ({ embedded: { formatVersion: '1.0' as const, items } });
const FMENU = form(null, [
  box('commandButton', 'cmdConception', 100, { Caption: 'Création', OnClick: embedded(act('OpenForm', { FormName: 'FClients', View: 'design' })) }),
  box('commandButton', 'cmdEtat', 600, { Caption: 'État', OnClick: embedded(act('OpenReport', { ReportName: REPORT, View: 'design' })) }),
]);
const FCLIENTS = form({ kind: 'table', name: 'Clients' }, [box('textBox', 'Nom', 100, { ControlSource: 'Nom' }), box('textBox', 'Ville', 600, { ControlSource: 'Ville' })]);
const OPTIONS: StartupOptions = { ...DEFAULT_STARTUP, appTitle: 'Gestion des ventes', startupForm: 'FMenu', showNavPane: false, runMode: true };

/** seedSales, FMenu, FClients, « Factures par client », QClients and MBip; AutoExec and the startup options when given. */
const seed = (name: string, autoExec?: MacroItem[], options?: StartupOptions) => seedBase(name, (db) => {
  seedSales(db);
  seedReportsE2E(db);
  seedForm(db, 'FMenu', FMENU);
  seedForm(db, 'FClients', FCLIENTS);
  saveObject(db, 'query', 'QClients', { formatVersion: '1.0', sql: 'SELECT * FROM Clients;' }, null);
  macro(db, 'MBip', [act('Beep')]);
  if (autoExec) macro(db, 'AutoExec', autoExec);
  if (options) saveStartupOptions(db, options);
});

type Win = { basecraft: BasecraftApi };
const ribbonTabs = (page: Page) => page.locator('[data-testid^="ribbon-tab-"]').evaluateAll((els) => els.map((e) => (e as HTMLElement).dataset.testid));
const villes = (page: Page) => page.evaluate(() => (window as unknown as Win).basecraft.rows.page('Clients', { offset: 0, limit: 100 })
  .then((p) => p.rows.map((r) => r.values[2])));
const content = (page: Page) => page.evaluate(() => (window as unknown as Win).basecraft.base.state().then((s) => s?.content));
const reportDef = (page: Page) => page.evaluate((n) => (window as unknown as Win).basecraft.objects.get('report', n).then((o) => JSON.stringify(o.definition)), REPORT);
/** The active document (every document stays mounted, only the active one is shown). */
const cur = (page: Page) => page.locator('.doc:not([hidden])');
const landscape = (page: Page) => cur(page).locator('.bc-page').first().evaluate((el) => (el as HTMLElement).offsetWidth > (el as HTMLElement).offsetHeight);

test('a plain base in the Runtime: its pane, File and Home only, no design item, no Design view, Page Setup not saved, a reduced File tab', async () => {
  const { app, page } = await launchApp({ runtime: true, args: [seed('rt-plain')], env: FR });
  try {
    await expect(page.getByTestId('nav-pane')).toBeVisible();
    expect(await ribbonTabs(page)).toEqual(['ribbon-tab-file', 'ribbon-tab-home']);
    for (const item of ['nav-item-form-FClients', 'nav-item-query-QClients', `nav-item-report-${REPORT}`, 'nav-item-macro-MBip', 'nav-item-Clients']) {
      await page.getByTestId(item).click({ button: 'right' });
      await expect(page.getByTestId('nav-menu')).toBeVisible();
      for (const id of ['design', 'sqlView', 'rename', 'delete', 'cut', 'paste', 'import']) await expect(page.getByTestId(`nav-menu-${id}`), `${item} ${id}`).toHaveCount(0);
      await page.keyboard.press('Escape');
      await expect(page.getByTestId('nav-menu')).toHaveCount(0);
    }
    // Properties: shown, the description not editable (its save is a design change)
    await page.getByTestId('nav-item-form-FClients').click({ button: 'right' });
    await page.getByTestId('nav-menu-properties').click();
    await expect(page.getByTestId('object-properties-description')).toHaveAttribute('readonly', '');
    await page.getByTestId('object-properties-cancel').click();
    await expect(page.getByTestId('modal')).toHaveCount(0);
    for (const key of ['Enter', 'Control+Enter']) {
      await page.getByTestId('nav-item-form-FClients').focus();
      await page.keyboard.press(key);
      await expect(page.getByTestId('doc-tab-form-FClients')).toHaveAttribute('aria-selected', 'true');
      await expect(page.getByTestId('form-ctl-Nom').filter({ visible: true })).toBeVisible();   // Form view
      await expect(page.getByTestId('status-view-design')).toHaveCount(0);
    }
    await page.keyboard.press('F11');
    await expect(page.getByTestId('nav-pane')).toHaveCount(0);
    await page.keyboard.press('F11');
    await expect(page.getByTestId('nav-pane')).toBeVisible();

    // macros: OpenForm and OpenReport in Design view are refused (Action Failed: cancelled)
    await page.getByTestId('nav-item-form-FMenu').dblclick();
    await expect(page.getByTestId('doc-tab-form-FMenu')).toHaveAttribute('aria-selected', 'true');
    for (const [button, action] of [['cmdConception', 'OpenForm'], ['cmdEtat', 'OpenReport']] as const) {
      await page.getByTestId(`form-ctl-${button}`).filter({ visible: true }).click();
      await expect(page.getByTestId('macro-failed')).toBeVisible();
      await expect(page.getByTestId('macro-failed-message')).toHaveText(fill(fr.macro.error.actionCancelled, { action: fr.macro.action[action] }));
      await page.getByTestId('macro-failed-stop').click();
      await expect(page.getByTestId('modal')).toHaveCount(0);
    }
    await expect(page.getByTestId('doc-tab-form-FMenu')).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByTestId(`doc-tab-report-${REPORT}`)).toHaveCount(0);
    await expect(page.getByTestId('status-view-design')).toHaveCount(0);

    // Print Preview: Landscape lays the report out again, and is not saved (R7)
    const before = await reportDef(page);
    await page.getByTestId(`nav-item-report-${REPORT}`).dblclick();
    await expect(cur(page).getByTestId('preview-page-of')).toHaveText('Page 1 sur 3');
    expect(await landscape(page)).toBe(false);
    await page.getByTestId('cmd-landscape').click();
    await expect(cur(page).getByTestId('preview-page-of')).toHaveText('Page 1 sur 4');
    expect(await landscape(page)).toBe(true);
    await page.getByTestId('cmd-closePreview').click();
    await expect(page.getByTestId(`doc-tab-report-${REPORT}`)).toHaveCount(0);
    await page.getByTestId(`nav-item-report-${REPORT}`).dblclick();
    await expect(cur(page).getByTestId('preview-page-of')).toHaveText('Page 1 sur 3');
    expect(await landscape(page)).toBe(false);
    expect(await reportDef(page)).toBe(before);

    // File: no New, Save As, Compact and Repair, nor the base's options (R4)
    await page.getByTestId('ribbon-tab-file').click();
    for (const id of ['bs-open', 'bs-recent', 'bs-close', 'bs-options', 'bs-about']) await expect(page.getByTestId(id)).toBeVisible();
    for (const id of ['bs-new', 'bs-save-as', 'bs-compact']) await expect(page.getByTestId(id)).toHaveCount(0);
    await page.getByTestId('bs-options').click();
    await expect(page.getByTestId('opt-lang')).toBeVisible();
    await expect(page.getByTestId('opt-db')).toHaveCount(0);
    await page.getByTestId('bs-about').click();
    await expect(page.getByTestId('about').locator('h1')).toHaveText(fr.about.titleRuntime);
    await expect(page.getByTestId('about-licence')).toBeVisible();
  } finally {
    await app.close();
  }
});

test('B3 options in the Runtime: title, no pane, FMenu then AutoExec; Shift bypasses nothing', async () => {
  const path = seed('rt-options', [act('OpenForm', { FormName: 'FClients', View: 'form', WhereCondition: '[Ville]="Lyon"' })], OPTIONS);
  let { app, page, userDataDir } = await launchApp({ runtime: true, args: [path], env: FR });
  try {
    await expect.poll(() => windowTitle(app)).toBe('Gestion des ventes');
    await expect(page.getByTestId('doc-tab-form-FMenu')).toBeVisible();
    await expect(page.getByTestId('doc-tab-form-FClients')).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByTestId('nav-record-count').filter({ visible: true })).toHaveText('2');
    await expect(page.getByTestId('nav-pane')).toHaveCount(0);
    await app.close();

    ({ app, page } = await launchApp({ runtime: true, env: FR, userDataDir }));
    await page.getByTestId('bs-recent-0').click({ modifiers: ['Shift'] });
    await expect(page.getByTestId('doc-tab-form-FMenu')).toBeVisible();
    await expect(page.getByTestId('doc-tab-form-FClients')).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByTestId('nav-pane')).toHaveCount(0);
  } finally {
    await app.close();
  }
});

test('disabled mode in the Runtime: AutoExec blocked, « Activer le contenu », approvals per product, trusted folders shared', async () => {
  const path = seed('rt-untrusted', [act('OpenForm', { FormName: 'FMenu', View: 'form' }), act('RunSQL', { SQLStatement: 'UPDATE Clients SET Ville = "X";' })]);
  const userDataDir = mkdtempSync(join(tmpdir(), 'basecraft-rt-'));
  let { app, page } = await launchApp({ runtime: true, args: [path], env: FR, userDataDir, untrusted: true });
  try {
    await expect(page.getByTestId('macro-failed')).toBeVisible();
    await expect(page.getByTestId('macro-failed-message')).toHaveText(fill(fr.macro.error.blocked, { action: fr.macro.action.RunSQL }));
    await expect(page.getByTestId('doc-tab-form-FMenu')).toBeVisible();
    await expect(page.getByTestId('banner-content')).toBeVisible();
    expect(await villes(page)).toEqual(['Lyon', 'LYON', 'Paris', 'Lyôn']);
    await page.getByTestId('macro-failed-stop').click();
    await expect(page.getByTestId('modal')).toHaveCount(0);
    await page.getByTestId('banner-enable-content').click();
    await expect(page.getByTestId('modal')).toBeVisible();   // RunSQL's own question (warnings on)
    await page.getByTestId('modal-btn-yes').click();
    await expect.poll(() => villes(page)).toEqual(['X', 'X', 'X', 'X']);
    await app.close();

    // the same user data folder: the approval is remembered
    ({ app, page } = await launchApp({ runtime: true, args: [path], env: FR, userDataDir, untrusted: true }));
    await expect.poll(() => content(page)).toBe('enabled');
    await expect(page.getByTestId('banner-content')).toHaveCount(0);
    await app.close();

    // approved in the full application: still disabled in a Runtime that never approved it (R8)
    ({ app, page } = await launchApp({ args: [path], env: FR, untrusted: true }));
    await page.getByTestId('macro-failed-stop').click();
    await page.getByTestId('banner-enable-content').click();
    await page.getByTestId('modal-btn-yes').click();
    await expect.poll(() => content(page)).toBe('enabled');
    const fullName = await appName(app);
    await app.close();
    ({ app, page } = await launchApp({ runtime: true, args: [path], env: FR, untrusted: true }));
    // Electron's default user data folder is appData/<app name>: two names, two folders, so two sets of approvals. These launches
    // override the folder (BASECRAFT_USER_DATA) to stay off the real profile; the names are what keeps the products apart.
    expect(await appName(app)).not.toBe(fullName);
    await expect.poll(() => content(page)).toBe('disabled');
    await expect(page.getByTestId('banner-content')).toBeVisible();
    await app.close();

    // a trusted folder (the system file the full application reads too): no bar
    ({ app, page } = await launchApp({ runtime: true, args: [path], env: FR }));
    await expect.poll(() => content(page)).toBe('enabled');
    await expect(page.getByTestId('banner-content')).toHaveCount(0);
  } finally {
    await app.close();
  }
});

// C1 R15: a front-end's links work in the Runtime; only Refresh Link is offered (no manager, no convert), the design channels refuse.
test('links in the Runtime: the datasheet saves to the data file, Refresh Link only, link design calls refused', async () => {
  const data = seedBase('rt-donnees', (db) => seedSales(db));
  const front = seedBase('rt-front');
  const raw = new DatabaseSync(front);
  try { addLinks(raw, front, 'basecraft', data, ['Clients']); } finally { raw.close(); }
  const { app, page } = await launchApp({ runtime: true, args: [front], env: FR });
  try {
    await page.getByTestId('nav-item-Clients').dblclick();
    const canvas = page.getByTestId('datasheet').getByTestId('data-grid-canvas');
    await expect(canvas).toBeVisible();
    await expect(page.getByTestId('nav-record-count')).toHaveText('4');
    // Durand's Ville (row 2, column 2): a click on the row's first cell, then the arrows (MARKER 44, HEADER 34, ROW 30)
    const b = (await canvas.boundingBox())!;
    await page.mouse.click(b.x + 44 + 20, b.y + 34 + 2 * 30 + 15);
    await expect(page.getByTestId('glide-cell-1-2')).toBeFocused();
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowRight');
    await expect(page.getByTestId('glide-cell-3-2')).toBeFocused();
    await page.keyboard.press('M');
    await page.keyboard.type('arseille');
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('doc-tab-Clients')).not.toContainText('•');
    await page.getByTestId('doc-tab-close-Clients').click();
    // the close does not wait for the data process's write to reach the file: read until it does (a busy file reads as not yet)
    await expect.poll(() => {
      const check = new DatabaseSync(data, { readOnly: true });
      try { return check.prepare(`SELECT "Ville" FROM "Clients" WHERE "Nom" = 'Durand'`).all(); } catch { return null; } finally { check.close(); }
    }).toEqual([{ Ville: 'Marseille' }]);

    await page.getByTestId('nav-item-Clients').click({ button: 'right' });
    await expect(page.getByTestId('nav-menu-refreshLink')).toBeVisible();
    await expect(page.getByTestId('nav-menu-linkedTableManager')).toHaveCount(0);
    await expect(page.getByTestId('nav-menu-convertToLocal')).toHaveCount(0);
    await expect(page.getByTestId('nav-menu-design')).toHaveCount(0); // no Design view, even read-only (B5)
    await page.keyboard.press('Escape');

    const outcomes = await page.evaluate(async (p) => {
      const l = (window as unknown as Win).basecraft.links;
      const settle = (x: Promise<unknown>) => x.then(() => 'resolved', () => 'rejected');
      return [await settle(l.create(p, ['Commandes'])), await settle(l.relink(['Clients'], p)), await settle(l.convert('Clients')), await settle(l.refresh(['Clients']))];
    }, data);
    expect(outcomes).toEqual(['rejected', 'rejected', 'rejected', 'resolved']);
  } finally {
    await app.close();
  }
});

// C3 R14: a front-end on a share (BASECRAFT_E2E_NETWORK_DIR: a local folder counted as one by the copy alone, so its data file
// stays local and shared on Linux CI too) runs from a local copy in <userData>/front-ends, made again when the original changes.
test('front-end copied from a share: the copy runs, its links reach the data file beside the original, a republished form shows', async () => {
  const front = seedSalesE2E('Ventes');
  const share = dirname(front);
  const data = join(share, 'Ventes_donnees.basecraft');
  let uuid = '';
  const w = openBaseFile(front, 'write', '0.0.0').db;
  try {
    splitDatabase(w, front, data, '0.0.0');
    uuid = (w.prepare(`SELECT value FROM bc_meta WHERE key = 'db_uuid'`).get() as { value: string }).value;
  } finally { w.close(); }
  const env = { ...FR, BASECRAFT_E2E_NETWORK_DIR: share };
  let { app, page, userDataDir } = await launchApp({ runtime: true, args: [front], env });
  const copy = join(userDataDir, 'front-ends', uuid, 'Ventes.basecraft');
  try {
    await expect.poll(() => windowTitle(app)).toBe('Ventes.basecraft – BaseCraft Runtime');
    expect(existsSync(copy)).toBe(true);
    expect(await page.evaluate(() => (window as unknown as Win).basecraft.base.state().then((s) => s?.origin))).toBe(front);
    await expect(page.getByTestId('banner-risk')).toHaveCount(0);
    await expect(page.getByTestId('banner-readonly')).toHaveCount(0);

    await page.getByTestId('nav-item-Clients').dblclick();
    const canvas = page.getByTestId('datasheet').getByTestId('data-grid-canvas');
    await expect(canvas).toBeVisible();
    await expect(page.getByTestId('nav-record-count')).toHaveText('4');
    // Durand's Ville (row 2, column 2), as in the links test above
    const b = (await canvas.boundingBox())!;
    await page.mouse.click(b.x + 44 + 20, b.y + 34 + 2 * 30 + 15);
    await expect(page.getByTestId('glide-cell-1-2')).toBeFocused();
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowRight');
    await expect(page.getByTestId('glide-cell-3-2')).toBeFocused();
    await page.keyboard.press('M');
    await page.keyboard.type('arseille');
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('doc-tab-Clients')).not.toContainText('•');
    await page.getByTestId('doc-tab-close-Clients').click();
    await expect.poll(() => {
      const check = new DatabaseSync(data, { readOnly: true });
      try { return check.prepare(`SELECT "Ville" FROM "Clients" WHERE "Nom" = 'Durand'`).all(); } catch { return null; } finally { check.close(); }
    }).toEqual([{ Ville: 'Marseille' }]);
    await expect(page.getByTestId('nav-item-form-FNouveau')).toHaveCount(0);
    await app.close();

    // the designer republishes the original: the next opening copies it again
    const d = openBaseFile(front, 'write', '0.0.0').db;
    try { seedForm(d, 'FNouveau', form(null, [])); } finally { d.close(); }
    ({ app, page } = await launchApp({ runtime: true, args: [front], env, userDataDir }));
    await expect(page.getByTestId('nav-item-form-FNouveau')).toBeVisible();
    expect(await page.evaluate(() => (window as unknown as Win).basecraft.base.state().then((s) => s?.path))).toBe(copy);
  } finally {
    await app.close();
  }
});
