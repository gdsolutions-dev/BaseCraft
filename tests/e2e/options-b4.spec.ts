// B4: ScreenTips (style, shortcut keys), Quick Access Toolbar choices and the Trust Center page, in File › Options.
import { test, expect, type Page } from '@playwright/test';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { saveObject } from '../../src/main/db/objects';
import { launchApp, seedBase, seedSalesE2E } from './helpers';

const open = (name: string, env: Record<string, string> = {}) => launchApp({ args: [seedSalesE2E(name)], env: { BASECRAFT_REGION: 'fr-FR', ...env } });

const settingsFile = (dir: string) => JSON.parse(readFileSync(join(dir, 'settings.json'), 'utf8'));

test('ScreenTips with shortcut keys, without them, and off; the choice is kept', async () => {
  const { app, page, userDataDir } = await open('options-b4-tips.basecraft');
  try {
    await expect(page.getByTestId('qat-save')).toHaveAttribute('title', 'Enregistrer (Ctrl+S)');
    await page.getByTestId('ribbon-tab-file').click();
    await page.getByTestId('bs-options').click();
    await page.getByTestId('opt-screentip-keys').uncheck();
    await expect.poll(() => settingsFile(userDataDir).screenTipShortcuts).toBe(false);
    await page.getByTestId('opt-screentips-off').check();
    await expect.poll(() => settingsFile(userDataDir).screenTips).toBe(false);
    await page.getByTestId('bs-back').click();
    await expect(page.getByTestId('qat-save')).not.toHaveAttribute('title', /.+/);
    await page.getByTestId('ribbon-tab-file').click();
    await page.getByTestId('bs-options').click();
    await page.getByTestId('opt-screentips-on').check();
    await expect.poll(() => settingsFile(userDataDir).screenTips).toBe(true);
    await page.getByTestId('bs-back').click();
    await expect(page.getByTestId('qat-save')).toHaveAttribute('title', 'Enregistrer');
  } finally {
    await app.close();
  }
});

test('Quick Access Toolbar: add, move, remove, reset', async () => {
  const { app, page, userDataDir } = await open('options-b4-qat.basecraft');
  try {
    await page.getByTestId('ribbon-tab-file').click();
    await page.getByTestId('bs-options').click();
    await page.getByTestId('opt-cat-quickAccess').click();
    await page.getByTestId('opt-qat-pick').selectOption('find');
    await page.getByTestId('opt-qat-add').click();
    await expect.poll(() => settingsFile(userDataDir).quickAccess).toEqual(['save', 'undo', 'redo', 'find']);
    await page.getByTestId('opt-qat-item-find').click();
    await page.getByTestId('opt-qat-up').click();
    await expect.poll(() => settingsFile(userDataDir).quickAccess).toEqual(['save', 'undo', 'find', 'redo']);
    await page.getByTestId('opt-qat-remove').click();
    await expect.poll(() => settingsFile(userDataDir).quickAccess).toEqual(['save', 'undo', 'redo']);
    await page.getByTestId('opt-qat-item-undo').click();
    await page.getByTestId('opt-qat-remove').click();
    await expect.poll(() => settingsFile(userDataDir).quickAccess).toEqual(['save', 'redo']);
    await page.getByTestId('bs-back').click();
    await expect(page.getByTestId('qat-undo')).toHaveCount(0);
    await expect(page.getByTestId('qat-redo')).toBeVisible();
    await page.getByTestId('ribbon-tab-file').click();
    await page.getByTestId('bs-options').click();
    await page.getByTestId('opt-cat-quickAccess').click();
    await page.getByTestId('opt-qat-reset').click();
    await expect.poll(() => settingsFile(userDataDir).quickAccess).toEqual(['save', 'undo', 'redo']);
  } finally {
    await app.close();
  }
});

test('Trust Center: the administrator\'s folders, the approvals of this user', async () => {
  const { app, page } = await open('options-b4-trust.basecraft');
  try {
    await page.getByTestId('ribbon-tab-file').click();
    await page.getByTestId('bs-options').click();
    await page.getByTestId('opt-cat-trust').click();
    await expect(page.getByTestId('opt-trust-folder')).toHaveCount(1);   // launchApp trusts the temp folder
    await expect(page.getByTestId('opt-trust-approvals')).toContainText('0');
    await expect(page.getByTestId('opt-trust-clear')).toBeDisabled();
  } finally {
    await app.close();
  }
});

test('C8 Trust Center: the user adds, edits and removes a trusted location; a base in it opens enabled; the administrator\'s stay read only', async () => {
  const file = seedBase('options-c8-trust', (db) => {
    saveObject(db, 'macro', 'M1', { formatVersion: '1.0', items: [{ k: 'action', action: 'Beep', args: {} }] }, null);
  });
  const folder = dirname(file);
  const userDataDir = mkdtempSync(join(tmpdir(), 'basecraft-c8-'));
  const env = { BASECRAFT_REGION: 'fr-FR', BASECRAFT_E2E_FOLDER_PATH: folder };
  const openOptions = async (page: Page) => {
    await page.getByTestId('ribbon-tab-file').click();
    await page.getByTestId('bs-options').click();
    await page.getByTestId('opt-cat-trust').click();
  };
  let { app, page } = await launchApp({ args: [file], env, userDataDir, untrusted: true });
  try {
    await expect(page.getByTestId('banner-content')).toBeVisible(); // nothing trusts the folder yet
    await openOptions(page);
    await expect(page.getByTestId('opt-trust-folder')).toHaveCount(0);
    await page.getByTestId('opt-trust-add').click();
    await expect(page.getByTestId('opt-trust-own-item')).toHaveCount(1);
    await expect(page.getByTestId('opt-trust-own-item')).toContainText(folder);
    await page.getByTestId('opt-trust-sub').check();
    await page.getByTestId('opt-trust-desc').fill('Mes bases');
    await page.getByTestId('opt-trust-desc').blur();
    await expect.poll(() => settingsFile(userDataDir).trustedLocations).toEqual([{ path: folder, subfolders: true, description: 'Mes bases' }]);
    await expect(page.getByTestId('opt-trust-network')).not.toBeChecked(); // off by default
  } finally {
    await app.close();
  }

  ({ app, page } = await launchApp({ args: [file], env, userDataDir, untrusted: true }));
  try {
    await expect(page.getByTestId('banner-content')).toHaveCount(0); // opened from a trusted location: enabled
    await openOptions(page);
    await expect(page.getByTestId('opt-trust-own-item')).toContainText('Mes bases');
    await page.getByTestId('opt-trust-own-item').click();
    await page.getByTestId('opt-trust-remove').click();
    await expect(page.getByTestId('opt-trust-own-item')).toHaveCount(0);
    await expect.poll(() => settingsFile(userDataDir).trustedLocations).toEqual([]);
  } finally {
    await app.close();
  }

  ({ app, page } = await launchApp({ args: [file], env, userDataDir, untrusted: true }));
  try {
    await expect(page.getByTestId('banner-content')).toBeVisible(); // removed: the approval is asked again
  } finally {
    await app.close();
  }
});

test('C8 Trust Center: a network location is refused until network locations are allowed; the administrator\'s folder is read only', async () => {
  test.skip(process.platform !== 'win32', 'UNC paths');
  const unc = ['', '', 'srv', 'share', 'bases'].join(String.fromCharCode(92));
  const { app, page, userDataDir } = await open('options-c8-net.basecraft', { BASECRAFT_E2E_FOLDER_PATH: unc });
  try {
    await page.getByTestId('ribbon-tab-file').click();
    await page.getByTestId('bs-options').click();
    await page.getByTestId('opt-cat-trust').click();
    await expect(page.getByTestId('opt-trust-folder')).toHaveCount(1);   // the administrator's (the e2e's file): listed, nothing to remove it with
    await expect(page.getByTestId('opt-trust-remove')).toBeDisabled();
    await page.getByTestId('opt-trust-add').click();
    await expect(page.getByTestId('opt-trust-refused')).toBeVisible();
    await expect(page.getByTestId('opt-trust-own-item')).toHaveCount(0);
    await page.getByTestId('opt-trust-network').check();
    await expect.poll(() => settingsFile(userDataDir).trustNetwork).toBe(true);
    await page.getByTestId('opt-trust-add').click();
    await expect(page.getByTestId('opt-trust-own-item')).toHaveCount(1);
    await expect.poll(() => settingsFile(userDataDir).trustedLocations).toEqual([{ path: unc, subfolders: false, description: '' }]);
  } finally {
    await app.close();
  }
});
