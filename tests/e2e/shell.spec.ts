import { test, expect, type Page } from '@playwright/test';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import os, { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { createTable } from '../../src/main/db/schema';
import { clients, f, t as table } from '../../src/shared/test-fixtures';
import { launchApp, seedBase } from './helpers';

const fr = JSON.parse(readFileSync(join(__dirname, '../../src/shared/i18n/fr.json'), 'utf8'));

async function openOptions(page: Page) {
  if (!(await page.getByTestId('backstage').isVisible())) await page.getByTestId('ribbon-tab-file').click();
  await page.getByTestId('bs-options').click();
}

test('File › About shows the version of package.json and the component versions', async () => {
  const pkg = JSON.parse(readFileSync(join(__dirname, '../../package.json'), 'utf8')) as { version: string };
  const { app, page } = await launchApp();
  try {
    await page.getByTestId('bs-about').click();
    await expect(page.getByTestId('about')).toBeVisible();
    await expect(page.getByTestId('about-version')).toHaveText(fr.about.version.replace('{{version}}', pkg.version));
    await expect(page.getByTestId('about-electron')).toHaveText(/^\d+\.\d+\.\d+/);
    await expect(page.getByTestId('about')).toContainText('SQLite');
    await expect(page.getByTestId('about-issues')).toBeEnabled();
    await page.getByTestId('bs-about').click(); // toggles back to the home panel
    await expect(page.getByTestId('about')).toHaveCount(0);
  } finally {
    await app.close();
  }
});

test('create base, switch language and theme, persisted', async () => {
  const tmpBase = join(mkdtempSync(join(tmpdir(), 'basecraft-shell-')), 'Coquille.basecraft');
  const { app, page, userDataDir } = await launchApp({ env: { BASECRAFT_E2E_SAVE_PATH: tmpBase } });
  try {
    await page.getByTestId('bs-new').click();
    await expect(page.getByTestId('nav-pane')).toBeVisible();
    await expect(page.getByTestId('backstage')).toBeHidden();
    expect(await page.title()).toBe(`${basename(tmpBase)} – BaseCraft`);
    await openOptions(page);
    await page.getByTestId('opt-lang').selectOption('en');
    await expect(page.getByTestId('ribbon-tab-create')).toHaveText('Create');
    await page.getByTestId('opt-theme').selectOption('dark');
    expect(await page.evaluate(() => document.documentElement.dataset.theme)).toBe('dark');
  } finally {
    await app.close();
  }
  const again = await launchApp({ userDataDir });
  try {
    await expect(again.page.getByTestId('ribbon-tab-create')).toHaveText('Create');
    await expect(again.page.getByTestId('bs-recent-0')).toContainText(basename(tmpBase)); // recent files
  } finally {
    await again.app.close();
  }
});

test('second instance opens read-only and names the holder', async () => {
  const base = seedBase('partagee', (db) => createTable(db, clients));
  const a = await launchApp({ args: [base] });
  const b = await launchApp({ args: [base] });
  try {
    await expect(b.page.getByTestId('banner-readonly')).toContainText(os.userInfo().username);
    await expect(b.page.getByTestId('banner-takeover')).toHaveCount(0); // the holder is alive
    await expect(a.page.getByTestId('banner-readonly')).toHaveCount(0);
    // read-only: nothing that writes is offered, by the ribbon, the navigation pane or the keyboard
    const p = b.page;
    await p.getByTestId('nav-item-Clients').dblclick();
    await expect(p.getByTestId('cmd-save')).toBeDisabled();
    await p.getByTestId('ribbon-tab-create').click();
    await expect(p.getByTestId('cmd-createTableDesign')).toBeDisabled();
    await p.getByTestId('nav-item-Clients').click({ button: 'right' });
    await expect(p.getByTestId('nav-menu-rename')).toBeDisabled();
    await expect(p.getByTestId('nav-menu-delete')).toBeDisabled();
    await p.keyboard.press('Escape');
    await p.keyboard.press('Control+s');
    await expect(p.getByTestId('modal')).toHaveCount(0);
    await expect(p.locator('[data-testid^="doc-tab-"]:not([data-testid^="doc-tab-close"])')).toHaveCount(1);
  } finally {
    await a.app.close();
    await b.app.close();
  }
});

test('opening a file that is not a base shows the translated error and keeps the backstage', async () => {
  const notBase = join(mkdtempSync(join(tmpdir(), 'basecraft-shell-')), 'texte.basecraft');
  writeFileSync(notBase, 'pas une base');
  const { app, page } = await launchApp({ env: { BASECRAFT_E2E_OPEN_PATH: notBase, BASECRAFT_REGION: 'fr-FR' } });
  try {
    // the backstage keeps the focus to itself, as a dialog does
    for (const key of ['Tab', 'Tab', 'Tab', 'Tab', 'Tab', 'Tab', 'Tab', 'Shift+Tab', 'Shift+Tab', 'Shift+Tab', 'Shift+Tab', 'Shift+Tab', 'Shift+Tab', 'Shift+Tab', 'Shift+Tab', 'Shift+Tab']) {
      await page.keyboard.press(key);
      expect(await page.evaluate(() => !!document.activeElement?.closest('[data-testid="backstage"]'))).toBe(true);
    }
    await page.getByTestId('bs-open').click();
    await expect(page.getByTestId('modal')).toContainText(fr.dialog.error.notBasecraft);
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('modal')).toBeHidden();
    await expect(page.getByTestId('backstage')).toBeVisible();
    expect(readFileSync(notBase, 'utf8')).toBe('pas une base');
  } finally {
    await app.close();
  }
});

test('navigation pane: search, open, modes, F11, rename, delete, new table', async () => {
  const base = seedBase('nav', (db) => {
    createTable(db, clients);
    createTable(db, table('Été', [f('N°', 'autoNumber')]));
  });
  const { app, page } = await launchApp({ args: [base], env: { BASECRAFT_REGION: 'fr-FR' } });
  try {
    await expect(page.getByTestId('nav-item-Clients')).toBeVisible();
    await page.getByTestId('nav-search').fill('ETE');
    await expect(page.getByTestId('nav-item-Été')).toBeVisible();
    await expect(page.getByTestId('nav-item-Clients')).toHaveCount(0);
    await page.getByTestId('nav-search').fill('');

    await page.getByTestId('nav-item-Clients').dblclick();
    await expect(page.getByTestId('doc-tab-Clients')).toBeVisible();
    await expect(page.getByTestId('status-mode')).toHaveText(fr.status.mode.datasheet);
    await page.getByTestId('cmd-viewDesign').click();
    await expect(page.getByTestId('status-mode')).toHaveText(fr.status.mode.design);
    await expect(page.getByTestId('ribbon-tab-design')).toBeVisible();
    await page.getByTestId('status-view-datasheet').click();
    await expect(page.getByTestId('ribbon-tab-design')).toHaveCount(0);
    await page.getByTestId('nav-item-Clients').dblclick(); // one tab per object
    await expect(page.locator('[data-testid^="doc-tab-"]:not([data-testid^="doc-tab-close"])')).toHaveCount(1);

    await page.keyboard.press('F11');
    await expect(page.getByTestId('nav-pane')).toHaveCount(0);
    await page.keyboard.press('F11');
    await expect(page.getByTestId('nav-pane')).toBeVisible();

    await page.getByTestId('nav-item-Clients').click({ button: 'right' });
    await page.getByTestId('nav-menu-rename').click();
    await page.getByTestId('modal-input').fill('Mauvais.nom');
    await page.getByTestId('modal-btn-ok').click();
    await expect(page.getByTestId('modal-error')).toHaveText(fr.designError.nameInvalid);
    await page.getByTestId('modal-input').fill('Contacts');
    await page.getByTestId('modal-btn-ok').click();
    await expect(page.getByTestId('nav-item-Contacts')).toBeVisible();
    await expect(page.getByTestId('doc-tab-Contacts')).toBeVisible();

    await page.getByTestId('nav-item-Contacts').click({ button: 'right' });
    await page.getByTestId('nav-menu-delete').click();
    await expect(page.getByTestId('modal')).toContainText('Contacts');
    await expect(page.getByTestId('modal-btn-no')).toBeFocused(); // destructive: No by default
    await page.getByTestId('modal-btn-yes').click();
    await expect(page.getByTestId('nav-item-Contacts')).toHaveCount(0);
    await expect(page.getByTestId('doc-tab-Contacts')).toHaveCount(0);
    await expect(page.getByTestId('status-mode')).toHaveText(fr.status.ready);

    await page.getByTestId('ribbon-tab-create').click();
    await page.getByTestId('cmd-createTableDesign').click();
    await expect(page.getByTestId('doc-tab-Table1')).toBeVisible();
    await expect(page.getByTestId('status-mode')).toHaveText(fr.status.mode.design);
    // a table not saved yet has no datasheet
    await expect(page.getByTestId('cmd-viewDatasheet')).toBeDisabled();
    await expect(page.getByTestId('status-view-datasheet')).toBeDisabled();
  } finally {
    await app.close();
  }
});
