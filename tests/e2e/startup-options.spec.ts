// B3 Task 5: File › Options › « Base de données active » — the six startup options of the open base. Each change saves at once;
// the title and the icon apply at once, the others at the next opening (R11); a read-only base shows the section disabled (R13);
// what a newer BaseCraft stored in the section is kept (R12).
import { test, expect, type ElectronApplication, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { openBaseFile, readOptions, updateOptions } from '../../src/main/db/file-format';
import { CH, type BasecraftApi } from '../../src/shared/api';
import type { DesignDoc } from '../../src/shared/design/model';
import { SHIFT_GRACE_MS } from '../../src/renderer/shell/shift-key';
import { DEFAULT_STARTUP } from '../../src/shared/startup';
import { launchApp, openDbOptions, seedBase, seedCrashed, seedForm } from './helpers';

const fr = JSON.parse(readFileSync(join(__dirname, '../../src/shared/i18n/fr.json'), 'utf8'));
const FR = { BASECRAFT_REGION: 'fr-FR' };
const ICON = join(__dirname, '../../build/icon.png');
const doc = (): DesignDoc => ({
  formatVersion: '1.0', recordSource: null, props: { Width: 9072 },
  sections: [{ kind: 'formHeader', height: 0, props: { Visible: false }, controls: [] }, { kind: 'detail', height: 1200, props: {}, controls: [] },
    { kind: 'formFooter', height: 0, props: { Visible: false }, controls: [] }],
});
const seed = (name: string) => seedBase(name, (db) => { seedForm(db, 'FMenu', doc()); seedForm(db, 'FClients', doc()); });

const startup = (page: Page) => page.evaluate(() => (window as unknown as { basecraft: BasecraftApi }).basecraft.base.startup());
const closeBase = (page: Page) => page.evaluate(() => (window as unknown as { basecraft: BasecraftApi }).basecraft.base.close());
const openBase = (page: Page, path: string) => page.evaluate((p) => (window as unknown as { basecraft: BasecraftApi }).basecraft.base.open(p).then(() => {}), path);
const windowTitle = (app: ElectronApplication) => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.getTitle());
const lastIcon = (app: ElectronApplication) => app.evaluate(() => (globalThis as { __bcIconE2E?: { last: unknown } }).__bcIconE2E?.last);
const openOptions = async (page: Page) => {
  await page.getByTestId('ribbon-tab-file').click();
  await openDbOptions(page);
};

test('every option saves at once; title and icon apply now, the others at the next opening', async () => {
  const path = seed('options');
  const { app, page } = await launchApp({ args: [path], env: FR });
  try {
    await openOptions(page);
    await expect(page.getByTestId('opt-cat-currentDb')).toHaveText('Base de données active');
    await expect(page.getByTestId('opt-db').locator('.bs-opthead')).toHaveText(fr.options.db.header);
    await expect(page.getByTestId('opt-db-next-open')).toHaveText(fr.options.db.nextOpen);
    await expect(page.getByTestId('opt-db-runmode')).toHaveAccessibleDescription(fr.options.db.runModeHelp);
    await expect(page.getByTestId('opt-db-form').locator('option')).toHaveText(['(aucun)', 'FClients', 'FMenu']);

    // title: control and bidirectional characters removed, shown cleaned, applied at once
    await page.getByTestId('opt-db-title').fill('  Gestion des ventes\u202E ');
    await page.getByTestId('opt-db-title').press('Enter');
    await expect(page.getByTestId('opt-db-title')).toHaveValue('Gestion des ventes');
    await expect.poll(() => windowTitle(app)).toBe('Gestion des ventes');
    expect((await startup(page)).appTitle).toBe('Gestion des ventes');

    // icon: re-encoded to 256 x 256 (the sources' build/icon.png is 1024 x 1024), applied at once
    await expect(page.getByTestId('opt-db-icon-preview')).toHaveCount(0);
    await expect(page.getByTestId('opt-db-icon-remove')).toBeDisabled();
    await page.getByTestId('opt-db-icon-input').setInputFiles(ICON);
    await expect(page.getByTestId('opt-db-icon-preview')).toBeVisible();
    await expect.poll(() => lastIcon(app)).toEqual({ width: 256, height: 256 });
    const icon = (await startup(page)).appIcon;
    expect(icon.length).toBeGreaterThan(0);

    // a file that is no picture: said, nothing saved
    await page.getByTestId('opt-db-icon-input').setInputFiles({ name: 'faux.png', mimeType: 'image/png', buffer: Buffer.from('ceci n\'est pas une image') });
    await expect(page.getByTestId('modal')).toContainText(fr.options.db.iconBad);
    await page.getByTestId('modal-btn-ok').click();
    await expect(page.getByTestId('modal')).toHaveCount(0);
    expect((await startup(page)).appIcon).toBe(icon);
    await expect(page.getByTestId('opt-db-icon-preview')).toBeVisible();

    // form, pane, run mode: saved at once, in force at the next opening only
    await page.getByTestId('opt-db-form').selectOption('FMenu');
    await page.getByTestId('opt-db-navpane').uncheck();
    await page.getByTestId('opt-db-runmode').check();
    await expect(page.getByTestId('opt-db-ribbon')).toBeDisabled();
    await expect(page.getByTestId('opt-db-ribbon').locator('option:checked')).toHaveText('Simplifié');
    await expect.poll(() => startup(page)).toEqual({ ...DEFAULT_STARTUP, appTitle: 'Gestion des ventes', startupForm: 'FMenu', showNavPane: false, runMode: true, appIcon: icon });
    await page.getByTestId('bs-back').click();
    await expect(page.getByTestId('nav-pane')).toBeVisible();          // R11: this window is unchanged
    await expect(page.getByTestId('ribbon-tab-create')).toBeVisible();
    await expect(page.locator('[data-testid^="doc-tab-form-"]')).toHaveCount(0);

    // run mode off again: the ribbon choice is back, and a choice of it saves
    await openOptions(page);
    await page.getByTestId('opt-db-runmode').uncheck();
    await expect(page.getByTestId('opt-db-ribbon')).toBeEnabled();
    await page.getByTestId('opt-db-ribbon').selectOption('simplified');
    await expect.poll(async () => (await startup(page)).ribbon).toBe('simplified');

    // BaseCraft's icon comes back at once
    await page.getByTestId('opt-db-icon-remove').click();
    await expect(page.getByTestId('opt-db-icon-preview')).toHaveCount(0);
    await expect.poll(() => lastIcon(app)).toBe('default');
    expect((await startup(page)).appIcon).toBe('');
  } finally {
    await app.close();
  }
});

test('a base opened read-only shows the section disabled', async () => {
  const path = seed('options-ro');
  const a = await launchApp({ args: [path], env: FR });
  const b = await launchApp({ args: [path], env: FR });
  try {
    await expect(b.page.getByTestId('banner-readonly')).toBeVisible();
    await openOptions(b.page);
    for (const id of ['title', 'icon-input', 'icon-browse', 'icon-remove', 'form', 'navpane', 'ribbon', 'runmode', 'iconforms', 'statusbar', 'doctabs',
      'specialkeys', 'compact', 'datasheetdesign', 'fullmenus', 'shortcutmenus']) {
      await expect(b.page.getByTestId(`opt-db-${id}`), id).toBeDisabled();
    }
  } finally {
    await b.app.close();
    await a.app.close();
  }
});

test('what a newer BaseCraft stored in the section is kept when the section saves (R12)', async () => {
  const path = seed('options-newer');
  const { app, page } = await launchApp({ args: [path], env: FR });
  const section = () => {
    const { db } = openBaseFile(path, 'write', '0.0.0');
    try { return readOptions(db).startup; } finally { db.close(); }
  };
  try {
    await closeBase(page);
    await expect(page.getByTestId('backstage')).toBeVisible();
    const { db } = openBaseFile(path, 'write', '0.0.0');
    try { updateOptions(db, (o) => { o.startup = { appTitle: 'Titre', appIcon: readFileSync(ICON).toString('base64'), startupForm: 'Disparu', v: 2, menuBar: 'X' }; }); } finally { db.close(); }

    // Shift held while it opens: no sequence (R4), the title applies
    await page.keyboard.down('Shift');
    await openBase(page, path);
    await expect.poll(() => windowTitle(app)).toBe('Titre');
    await expect.poll(() => lastIcon(app)).toEqual({ width: 256, height: 256 });   // the stored icon applies at the opening, bypassed or not
    await page.waitForTimeout(SHIFT_GRACE_MS * 3);   // the decision is taken while Shift is still held
    await page.keyboard.up('Shift');
    await expect(page.locator('[data-testid^="doc-tab-form-"]')).toHaveCount(0);

    await openOptions(page);
    await expect(page.getByTestId('opt-db-title')).toHaveValue('Titre');
    // a stored form that no form has stays chosen, and an option (R8)
    await expect(page.getByTestId('opt-db-form')).toHaveValue('Disparu');
    await expect(page.getByTestId('opt-db-form').locator('option')).toHaveText(['(aucun)', 'Disparu', 'FClients', 'FMenu']);
    await page.getByTestId('opt-db-title').fill('Autre titre');
    await page.getByTestId('opt-db-title').press('Enter');
    await expect.poll(() => windowTitle(app)).toBe('Autre titre');
    await closeBase(page);
    expect(section()).toEqual({ ...DEFAULT_STARTUP, appTitle: 'Autre titre', appIcon: readFileSync(ICON).toString('base64'), startupForm: 'Disparu', v: 2, menuBar: 'X' });   // the page saves the whole object: the eight O1 keys join the unknown ones
  } finally {
    await app.close();
  }
});

test('a base that needs recovery: File › Options shows no section and no error, the section comes with the take-over', async () => {
  const path = seedCrashed('options-crashed');
  const { app, page } = await launchApp({ args: [path], env: FR });
  try {
    await expect(page.getByTestId('banner-takeover')).toBeVisible();
    await page.getByTestId('ribbon-tab-file').click();
    await page.getByTestId('bs-options').click();
    await expect(page.getByTestId('opt-db')).toHaveCount(0);
    await page.waitForTimeout(500);   // the error dialog of a read that fails would be up by now
    await expect(page.getByTestId('modal')).toHaveCount(0);

    await page.getByTestId('bs-back').click();
    await page.getByTestId('banner-takeover').click();
    await expect(page.getByTestId('banner-takeover')).toHaveCount(0);
    await openOptions(page);
    await expect(page.getByTestId('opt-db-title')).toBeEnabled();
  } finally {
    await app.close();
  }
});

test('a save that resolves after a switch to another base does not put its title on the new base', async () => {
  const a = seed('options-late-a');
  const b = seed('options-late-b');
  const { app, page } = await launchApp({ args: [a], env: FR });
  try {
    await openOptions(page);
    // the save of A's title is held in the main process while the window switches to B
    await app.evaluate(({ ipcMain }, ch) => {
      const g = globalThis as { __releaseSave?: () => void };
      ipcMain.removeHandler(ch);
      ipcMain.handle(ch, () => new Promise<void>((resolve) => { g.__releaseSave = resolve; }));
    }, CH.baseSaveStartup);
    await page.getByTestId('opt-db-title').fill('Titre de A');
    await page.getByTestId('opt-db-title').press('Enter');
    await expect.poll(() => app.evaluate(() => !!(globalThis as { __releaseSave?: () => void }).__releaseSave)).toBe(true);
    await openBase(page, b);
    await expect(page.getByTestId('backstage')).toHaveCount(0);
    await expect.poll(() => windowTitle(app)).toBe('options-late-b.basecraft – BaseCraft');
    await app.evaluate(() => (globalThis as { __releaseSave?: () => void }).__releaseSave?.());
    await page.waitForTimeout(500);   // the late save has resolved and been applied (or dropped) by now
    expect(await windowTitle(app)).toBe('options-late-b.basecraft – BaseCraft');
  } finally {
    await app.close();
  }
});
