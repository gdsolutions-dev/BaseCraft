// B3 Task 6: a base cannot lock its owner out (R5) — an AutoExec that quits or closes the base, run mode, a dialog form at startup,
// a menu's Quit and CloseDatabase buttons, a hostile title, a missing startup form: Shift + Recent, F11 and File › Options always
// give the base back.
import { test, expect, type ElectronApplication, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { updateOptions } from '../../src/main/db/file-format';
import { saveObject } from '../../src/main/db/objects';
import { saveStartupOptions } from '../../src/main/db/startup';
import type { BasecraftApi } from '../../src/shared/api';
import { CH } from '../../src/shared/api';
import type { ControlDef, DesignDoc } from '../../src/shared/design/model';
import type { MacroItem } from '../../src/shared/macro/model';
import { DEFAULT_STARTUP, type StartupOptions } from '../../src/shared/startup';
import { SHIFT_GRACE_MS } from '../../src/renderer/shell/shift-key';
import { launchApp, openDbOptions, seedBase, seedForm } from './helpers';

const fr = JSON.parse(readFileSync(join(__dirname, '../../src/shared/i18n/fr.json'), 'utf8'));
const FR = { BASECRAFT_REGION: 'fr-FR' };
const ICON = join(__dirname, '../../build/icon.png');
const fill = (s: string, p: Record<string, string>) => s.replace(/\{\{(\w+)\}\}/g, (_, k: string) => p[k]!);
const act = (action: string, args: Record<string, string> = {}): MacroItem => ({ k: 'action', action, args });
const msg = (message: string) => act('MessageBox', { Message: message, Title: 'Test', Beep: 'no', Type: 'none' });
const embedded = (...items: MacroItem[]) => ({ embedded: { formatVersion: '1.0' as const, items } });
const box = (kind: ControlDef['kind'], name: string, top: number, props: Record<string, unknown>): ControlDef =>
  ({ kind, name, left: 1701, top, width: 2268, height: 340, props });
const form = (controls: ControlDef[], props: Record<string, unknown> = {}): DesignDoc => ({
  formatVersion: '1.0', recordSource: null, props: { Width: 9072, ...props },
  sections: [{ kind: 'formHeader', height: 0, props: { Visible: false }, controls: [] },
    { kind: 'detail', height: 1200, props: {}, controls },
    { kind: 'formFooter', height: 0, props: { Visible: false }, controls: [] }],
});
const menu = (props: Record<string, unknown> = {}) => form([
  box('commandButton', 'cmdFermerBase', 100, { Caption: 'Fermer la base', OnClick: embedded(act('CloseDatabase')) }),
  box('commandButton', 'cmdQuitter', 600, { Caption: 'Quitter', OnClick: embedded(act('Quit')) }),
], { Caption: 'Menu', ...props });
const OPTIONS: StartupOptions = { ...DEFAULT_STARTUP, runMode: true, showNavPane: false, startupForm: 'FMenu' };

const seed = (name: string, autoExec: MacroItem[] | null, o: { menu?: Record<string, unknown>; options?: Partial<StartupOptions>; raw?: (db: DatabaseSync) => void } = {}) =>
  seedBase(name, (db) => {
    seedForm(db, 'FMenu', menu(o.menu));
    seedForm(db, 'FDialogue', form([], { Caption: 'Dialogue' }));
    if (autoExec) {
      const r = saveObject(db, 'macro', 'AutoExec', { formatVersion: '1.0', items: autoExec }, null);
      if (!r.ok) throw new Error(r.reason);
    }
    saveStartupOptions(db, { ...OPTIONS, ...o.options });
    o.raw?.(db);
  });

const windowTitle = (app: ElectronApplication) => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.getTitle());
const lastIcon = (app: ElectronApplication) => app.evaluate(() => (globalThis as { __bcIconE2E?: { last: unknown } }).__bcIconE2E?.last);
const baseState = (page: Page) => page.evaluate(() => (window as unknown as { basecraft: BasecraftApi }).basecraft.base.state());
const openOptions = async (page: Page) => {
  await page.getByTestId('ribbon-tab-file').click();
  await openDbOptions(page);
};
/** AutoExec's MessageBox « Suite », answered. */
const suite = async (page: Page) => {
  await expect(page.getByTestId('macro-msgbox-text')).toHaveText('Suite');
  await page.getByTestId('macro-msgbox-ok').click();
  await expect(page.getByTestId('macro-msgbox')).toHaveCount(0);
};
/** Opened in full: every startup step bypassed (R4). */
const expectFull = async (page: Page) => {
  await expect.poll(() => baseState(page)).not.toBeNull();
  await page.waitForTimeout(SHIFT_GRACE_MS * 2);   // past the moment the sequence would have run
  await expect(page.getByTestId('nav-pane')).toBeVisible();
  await expect(page.getByTestId('ribbon-tab-create')).toBeVisible();
  await expect(page.getByTestId('doc-tab-form-FMenu')).toHaveCount(0);
};
/** Shift + click on the first recent file (File › Recent): the reliable bypass (R4). */
const shiftRecent = async (page: Page) => {
  await expect(page.getByTestId('backstage')).toBeVisible();
  await page.getByTestId('bs-recent-0').click({ modifiers: ['Shift'] });
};

test('AutoExec = Quit: the app exits; relaunched, Shift + Recent opens the base in full and it stays open', async () => {
  const path = seed('lockout-quit', [act('Quit')]);
  const first = await launchApp({ args: [path], env: FR, waitOpen: false });
  try {
    // exited, however fast (an application already closed has no process left to ask: that throw means closed too)
    const exited = () => { try { return first.app.process().exitCode !== null; } catch { return true; } };
    await expect.poll(exited, { timeout: 20_000 }).toBe(true);
  } finally {
    await first.app.close().catch(() => undefined);
  }
  const { app, page } = await launchApp({ env: FR, userDataDir: first.userDataDir });
  try {
    await expect(page.getByTestId('bs-recent-0')).toHaveAttribute('title', path);
    await shiftRecent(page);
    await expectFull(page);
    await page.waitForTimeout(1000);
    expect(await baseState(page)).not.toBeNull();   // AutoExec's Quit did not run
  } finally {
    await app.close();
  }
});

test('AutoExec = CloseDatabase: the Backstage with no base, BaseCraft\'s title and icon; Shift + Recent opens it in full', async () => {
  const path = seed('lockout-close', [act('CloseDatabase')], { options: { appTitle: 'Gestion', appIcon: readFileSync(ICON).toString('base64') } });
  const { app, page } = await launchApp({ args: [path], env: FR, waitOpen: false });
  try {
    await expect(page.getByTestId('bs-recent-0')).toHaveAttribute('title', path, { timeout: 20_000 });   // it was opened
    await expect.poll(() => baseState(page)).toBeNull();
    await expect.poll(() => windowTitle(app)).toBe('BaseCraft');
    await expect.poll(() => lastIcon(app)).toBe('default');
    await expect(page.getByTestId('macro-failed')).toHaveCount(0);
    await shiftRecent(page);
    await expectFull(page);
    await expect.poll(() => windowTitle(app)).toBe('Gestion');   // the title and the icon apply, bypassed or not
    await expect.poll(() => lastIcon(app)).toEqual({ width: 256, height: 256 });
    expect(await baseState(page)).not.toBeNull();
  } finally {
    await app.close();
  }
});

test('run mode, not bypassed: F11 shows the pane, File › Options turns run mode off, the next opening allows Design view', async () => {
  const path = seed('lockout-runmode', null);
  const { app, page } = await launchApp({ args: [path], env: FR });
  try {
    await expect(page.getByTestId('doc-tab-form-FMenu')).toBeVisible();
    await expect(page.getByTestId('nav-pane')).toHaveCount(0);
    await expect(page.getByTestId('status-view-design')).toHaveCount(0);
    await page.keyboard.press('F11');
    await expect(page.getByTestId('nav-pane')).toBeVisible();

    await openOptions(page);
    await expect(page.getByTestId('opt-db-runmode')).toBeEnabled();
    await page.getByTestId('opt-db-runmode').uncheck();
    await expect.poll(() => page.evaluate(() => (window as unknown as { basecraft: BasecraftApi }).basecraft.base.startup()).then((s) => s.runMode)).toBe(false);
    await page.getByTestId('bs-close').click();
    await expect.poll(() => baseState(page)).toBeNull();
    await page.getByTestId('bs-recent').click();
    await page.getByTestId('bs-recent-0').click();   // no Shift: the sequence runs
    await expect(page.getByTestId('doc-tab-form-FMenu')).toBeVisible();
    await expect(page.getByTestId('status-view-design')).toBeVisible();
    await expect(page.getByTestId('nav-pane')).toHaveCount(0);   // its option still hides it
  } finally {
    await app.close();
  }
});

for (const event of ['OnOpen', 'OnLoad']) {
  test(`FMenu's ${event} opens a dialog form: shown over everything, its close button closes it, then AutoExec runs`, async () => {
    const path = seed(`lockout-dialog-${event}`, [msg('Suite')],
      { menu: { [event]: embedded(act('OpenForm', { FormName: 'FDialogue', View: 'form', WindowMode: 'dialog' })) } });
    const { app, page } = await launchApp({ args: [path], env: FR });
    try {
      const dialog = page.getByTestId('form-dialog-FDialogue');
      await expect(dialog).toBeVisible();
      await expect(dialog).toHaveAttribute('aria-modal', 'true');
      await page.waitForTimeout(500);
      await expect(page.getByTestId('macro-msgbox')).toHaveCount(0);   // AutoExec waits for the startup form (R3)
      await dialog.getByTestId('form-dialog-close').click();
      await expect(dialog).toHaveCount(0);
      await suite(page);   // not skipped: the event's run was no Run Macro
      await expect(page.getByTestId('doc-tab-form-FMenu')).toBeVisible();
      await page.keyboard.press('F11');
      await expect(page.getByTestId('nav-pane')).toBeVisible();   // usable
    } finally {
      await app.close();
    }
  });
}

test('menu buttons: CloseDatabase gives the Backstage, Quit exits the app', async () => {
  const path = seed('lockout-menu', null);
  const { app, page } = await launchApp({ args: [path], env: FR });
  try {
    await expect(page.getByTestId('doc-tab-form-FMenu')).toBeVisible();
    await page.getByTestId('form-ctl-cmdFermerBase').click();
    await expect(page.getByTestId('backstage')).toBeVisible();
    await expect.poll(() => baseState(page)).toBeNull();
    await expect(page.getByTestId('macro-failed')).toHaveCount(0);

    await shiftRecent(page);
    await expectFull(page);
    await page.getByTestId('nav-item-form-FMenu').dblclick();
    await expect(page.getByTestId('doc-tab-form-FMenu')).toBeVisible();
    const closed = app.waitForEvent('close');
    await page.getByTestId('form-ctl-cmdQuitter').click();
    await closed;
  } finally {
    await app.close().catch(() => undefined);
  }
});

test('a 10,000-character title with U+202E, stored raw: 255 code points in the window title, no override', async () => {
  const raw = 'A'.repeat(100) + '\u202E' + 'B'.repeat(9899);
  const path = seed('lockout-title', null, { raw: (db) => updateOptions(db, (o) => { (o.startup as Record<string, unknown>).appTitle = raw; }) });
  const { app, page } = await launchApp({ args: [path], env: FR });
  try {
    await expect(page.getByTestId('doc-tab-form-FMenu')).toBeVisible();
    await expect.poll(() => windowTitle(app)).toBe('A'.repeat(100) + 'B'.repeat(155));
    const title = await windowTitle(app);
    expect([...title]).toHaveLength(255);
    expect(title).not.toContain('\u202E');
  } finally {
    await app.close();
  }
});

test('a startup form that is no form: said once, then AutoExec runs', async () => {
  const path = seed('lockout-absent', [msg('Suite')], { options: { startupForm: 'Absent' } });
  const { app, page } = await launchApp({ args: [path], env: FR });
  try {
    await expect(page.getByTestId('modal')).toContainText(fill(fr.startup.formNotFound, { name: 'Absent' }));
    await page.getByTestId('modal-btn-ok').click();
    await suite(page);
    await page.waitForTimeout(500);
    await expect(page.getByTestId('modal')).toHaveCount(0);   // said once
  } finally {
    await app.close();
  }
});

test('a failing save of the section: the error is shown, the section reloads what the file holds', async () => {
  const path = seed('lockout-save', null, { options: { runMode: false, startupForm: '', showNavPane: true } });
  const { app, page } = await launchApp({ args: [path], env: FR });
  try {
    await openOptions(page);
    await expect(page.getByTestId('opt-db-navpane')).toBeChecked();
    await app.evaluate(({ ipcMain }, ch) => {
      ipcMain.removeHandler(ch);
      ipcMain.handle(ch, () => { throw new Error('x'); });
    }, CH.baseSaveStartup);
    await page.getByTestId('opt-db-navpane').click();
    await expect(page.getByTestId('modal')).toContainText('x');
    await expect(page.getByTestId('opt-db-navpane')).not.toBeChecked();   // shown at once, until the reload
    await page.getByTestId('modal-btn-ok').click();
    await expect(page.getByTestId('modal')).toHaveCount(0);
    await expect(page.getByTestId('opt-db-navpane')).toBeChecked();
  } finally {
    await app.close();
  }
});
