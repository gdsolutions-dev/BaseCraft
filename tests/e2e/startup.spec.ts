// B3 Task 4: the startup sequence (R3) — title, run mode (simplified ribbon, no Navigation Pane, no Design view), the startup form,
// then AutoExec; Shift bypasses it (R4); AutoExec blocked in disabled mode runs again on « Activer le contenu » (R6); a failing
// AutoExec leaves the base usable (R7).
import { test, expect, type ElectronApplication, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { saveObject } from '../../src/main/db/objects';
import { saveStartupOptions } from '../../src/main/db/startup';
import { seedSales } from '../../src/main/query/test-db';
import type { BasecraftApi } from '../../src/shared/api';
import type { ControlDef, DesignDoc } from '../../src/shared/design/model';
import type { MacroItem } from '../../src/shared/macro/model';
import { DEFAULT_STARTUP, type StartupOptions } from '../../src/shared/startup';
import { SHIFT_GRACE_MS } from '../../src/renderer/shell/shift-key';
import { launchApp, seedBase, seedCrashed, seedForm } from './helpers';

const fr = JSON.parse(readFileSync(join(__dirname, '../../src/shared/i18n/fr.json'), 'utf8'));
const FR = { BASECRAFT_REGION: 'fr-FR' };
const fill = (s: string, p: Record<string, string>) => s.replace(/\{\{(\w+)\}\}/g, (_, k: string) => p[k]!);
const act = (action: string, args: Record<string, string> = {}): MacroItem => ({ k: 'action', action, args });
const macro = (db: DatabaseSync, name: string, items: MacroItem[]) => {
  const r = saveObject(db, 'macro', name, { formatVersion: '1.0', items }, null);
  if (!r.ok) throw new Error(r.reason);
};
const box = (kind: ControlDef['kind'], name: string, top: number, props: Record<string, unknown>): ControlDef =>
  ({ kind, name, left: 1701, top, width: 2268, height: 340, props });
const form = (recordSource: DesignDoc['recordSource'], controls: ControlDef[], props: Record<string, unknown> = {}): DesignDoc => ({
  formatVersion: '1.0', recordSource, props: { Width: 9072, ...props },
  sections: [{ kind: 'formHeader', height: 0, props: { Visible: false }, controls: [] },
    { kind: 'detail', height: 1200, props: {}, controls },
    { kind: 'formFooter', height: 0, props: { Visible: false }, controls: [] }],
});
const embedded = (...items: MacroItem[]) => ({ embedded: { formatVersion: '1.0' as const, items } });
// FMenu's button asks for FClients in Design view: refused in run mode (R10)
const FMENU = form(null, [box('commandButton', 'cmdDesign', 100, { Caption: 'Création',
  OnClick: embedded(act('OpenForm', { FormName: 'FClients', View: 'design' })) })], { Caption: 'Menu' });
const FCLIENTS = form({ kind: 'table', name: 'Clients' }, [box('textBox', 'Nom', 100, { ControlSource: 'Nom' }), box('textBox', 'Ville', 600, { ControlSource: 'Ville' })]);
const OPTIONS: StartupOptions = { ...DEFAULT_STARTUP, appTitle: 'Gestion des ventes', startupForm: 'FMenu', showNavPane: false, ribbon: 'simplified', runMode: true };

const seed = (name: string, autoExec: MacroItem[], options: StartupOptions = OPTIONS) => seedBase(name, (db) => {
  seedSales(db);
  seedForm(db, 'FMenu', FMENU);
  seedForm(db, 'FClients', FCLIENTS);
  macro(db, 'AutoExec', autoExec);
  saveStartupOptions(db, options);
});

const windowTitle = (app: ElectronApplication) => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.getTitle());
const ribbonTabs = (page: Page) => page.locator('[data-testid^="ribbon-tab-"]').evaluateAll((els) => els.map((e) => (e as HTMLElement).dataset.testid));
const villes = (page: Page) => page.evaluate(() => (window as unknown as { basecraft: BasecraftApi }).basecraft.rows.page('Clients', { offset: 0, limit: 100 })
  .then((p) => p.rows.map((r) => r.values[2])));
const closeBase = (page: Page) => page.evaluate(() => (window as unknown as { basecraft: BasecraftApi }).basecraft.base.close());
const openBase = (page: Page, path: string) => page.evaluate((p) => (window as unknown as { basecraft: BasecraftApi }).basecraft.base.open(p).then(() => {}), path);

test('run mode: title, simplified ribbon, no Navigation Pane, FMenu then AutoExec; Shift bypasses all but the title', async () => {
  const path = seed('startup', [act('OpenForm', { FormName: 'FClients', View: 'form', WhereCondition: '[Ville]="Lyon"' })]);
  const { app, page } = await launchApp({ args: [path], env: FR });
  try {
    await expect.poll(() => windowTitle(app)).toBe('Gestion des ventes');
    await expect(page.getByTestId('doc-tab-form-FMenu')).toBeVisible();
    await expect(page.getByTestId('doc-tab-form-FClients')).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByTestId('nav-record-count').filter({ visible: true })).toHaveText('2');
    await expect(page.getByTestId('form-ctl-Nom').filter({ visible: true })).toHaveValue('Dupont');
    await expect(page.getByTestId('nav-pane')).toHaveCount(0);
    await expect(page.getByTestId('nav-show')).toHaveCount(0);   // R14: gone, no strip
    expect(await ribbonTabs(page)).toEqual(['ribbon-tab-file', 'ribbon-tab-home']);
    await expect(page.getByTestId('status-view-design')).toHaveCount(0);
    await expect(page.getByTestId('status-view-sql')).toHaveCount(0);

    // a macro's OpenForm in Design view is refused (Action Failed: cancelled)
    await page.getByTestId('doc-tab-form-FMenu').click();
    await page.getByTestId('form-ctl-cmdDesign').click();
    await expect(page.getByTestId('macro-failed')).toBeVisible();
    await expect(page.getByTestId('macro-failed-message')).toHaveText(fill(fr.macro.error.actionCancelled, { action: fr.macro.action.OpenForm }));
    await page.getByTestId('macro-failed-stop').click();
    await expect(page.getByTestId('modal')).toHaveCount(0);
    await expect(page.getByTestId('doc-tab-form-FClients')).toHaveAttribute('aria-selected', 'false');

    // F11 brings the pane back, with the Runtime's menus (no Design View)
    await page.keyboard.press('F11');
    await expect(page.getByTestId('nav-pane')).toBeVisible();
    await page.getByTestId('nav-item-form-FClients').click({ button: 'right' });
    await expect(page.getByTestId('nav-menu')).toBeVisible();
    await expect(page.getByTestId('nav-menu-design')).toHaveCount(0);
    await page.keyboard.press('Escape');

    // Shift held while the base opens: no sequence, the title stays (R4)
    await closeBase(page);
    await expect(page.getByTestId('backstage')).toBeVisible();
    await page.keyboard.down('Shift');
    await openBase(page, path);
    await expect.poll(() => windowTitle(app)).toBe('Gestion des ventes');
    await page.waitForTimeout(SHIFT_GRACE_MS * 3);   // the decision is taken while Shift is still held
    await page.keyboard.up('Shift');
    await expect(page.getByTestId('nav-pane')).toBeVisible();
    await expect(page.getByTestId('ribbon-tab-create')).toBeVisible();
    await page.waitForTimeout(SHIFT_GRACE_MS * 2);
    await expect(page.locator('[data-testid^="doc-tab-form-"]')).toHaveCount(0);

    // Shift released before the opening: the sequence runs
    await closeBase(page);
    await expect(page.getByTestId('backstage')).toBeVisible();
    await page.keyboard.down('Shift');
    await page.keyboard.up('Shift');
    await openBase(page, path);
    await expect(page.getByTestId('doc-tab-form-FClients')).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByTestId('doc-tab-form-FMenu')).toBeVisible();
    await expect(page.getByTestId('nav-pane')).toHaveCount(0);
  } finally {
    await app.close();
  }
});

test('the Shift of an opening that runs no sequence (a base to recover) is not kept for the next opening', async () => {
  const crashed = seedCrashed('startup-crashed');
  const path = seed('startup-after-crashed', []);
  const { app, page } = await launchApp({ args: [crashed], env: FR });
  try {
    await expect(page.getByTestId('banner-takeover')).toBeVisible();
    await page.getByTestId('ribbon-tab-file').click();
    await page.getByTestId('bs-recent-0').click({ modifiers: ['Shift'] });   // asks to open it again, with Shift: still to recover, no sequence
    await expect(page.getByTestId('backstage')).toHaveCount(0);
    await expect(page.getByTestId('banner-takeover')).toBeVisible();
    await closeBase(page);
    await openBase(page, path);   // asked by no click: no Shift
    await expect(page.getByTestId('doc-tab-form-FMenu')).toBeVisible();   // so its sequence runs
    await expect(page.getByTestId('nav-pane')).toHaveCount(0);
  } finally {
    await app.close();
  }
});

test('disabled content: AutoExec stops on its blocked RunSQL, « Activer le contenu » runs it again from its start', async () => {
  const path = seed('startup-untrusted', [act('OpenForm', { FormName: 'FMenu', View: 'form' }), act('RunSQL', { SQLStatement: 'UPDATE Clients SET Ville = "X";' })]);
  const { app, page } = await launchApp({ args: [path], env: FR, untrusted: true });
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
    await expect(page.getByTestId('macro-failed')).toHaveCount(0);
  } finally {
    await app.close();
  }
});

test('an AutoExec running itself stops at its depth limit, once; the base stays usable', async () => {
  const path = seed('startup-loop', [act('RunMacro', { MacroName: 'AutoExec' })], { ...DEFAULT_STARTUP, showNavPane: false });
  const { app, page } = await launchApp({ args: [path], env: FR });
  try {
    await expect(page.getByTestId('macro-failed')).toBeVisible();
    await expect(page.getByTestId('macro-failed-message')).toHaveText(fr.macro.error.tooDeep);
    await page.getByTestId('macro-failed-stop').click();
    await expect(page.getByTestId('modal')).toHaveCount(0);
    await page.waitForTimeout(500);
    await expect(page.getByTestId('macro-failed')).toHaveCount(0);
    await expect(page.getByTestId('nav-pane')).toHaveCount(0);   // its options only
    await page.getByTestId('ribbon-tab-file').click();
    await expect(page.getByTestId('backstage')).toBeVisible();
  } finally {
    await app.close();
  }
});
