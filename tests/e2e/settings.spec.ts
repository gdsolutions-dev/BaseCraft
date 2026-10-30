import { test, expect } from '@playwright/test';
import { existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { BasecraftApi } from '../../src/shared/api';
import { launchApp } from './helpers';

test('language and theme apply live and persist', async () => {
  const { app, page, userDataDir } = await launchApp({ env: { BASECRAFT_REGION: 'fr-FR' } });
  try {
    await expect(page.getByTestId('ribbon-tab-create')).toHaveText('Créer');
    await page.getByTestId('bs-options').click(); // no base open: the backstage is shown at start
    await expect(page.getByTestId('opt-lang').locator('option[value="en"]')).toHaveText('English');
    expect(await page.evaluate(() => document.documentElement.lang)).toBe('fr');
    expect(await page.evaluate(() => document.documentElement.dataset.theme)).toBeUndefined();
    await page.getByTestId('opt-theme').selectOption('dark');
    expect(await page.evaluate(() => document.documentElement.dataset.theme)).toBe('dark');
    // the native popups (<select> lists, scroll bars) follow the app's theme, not the system's
    await expect.poll(() => app.evaluate(({ nativeTheme }) => nativeTheme.themeSource)).toBe('dark');
    await page.getByTestId('opt-lang').selectOption('en');
    await expect(page.getByTestId('opt-theme').locator('option[value="dark"]')).toHaveText('Dark');
    await page.getByTestId('opt-theme').selectOption('system');
    expect(await page.evaluate(() => document.documentElement.dataset.theme)).toBeUndefined();
    await expect.poll(() => app.evaluate(({ nativeTheme }) => nativeTheme.themeSource)).toBe('system');
    await page.getByTestId('opt-theme').selectOption('light');
    const f = join(userDataDir, 'settings.json');
    expect(existsSync(f)).toBe(true);
    expect(JSON.parse(readFileSync(f, 'utf8'))).toMatchObject({ locale: 'en', theme: 'light' });
  } finally {
    await app.close();
  }
});

type W = { basecraft: BasecraftApi; seen: unknown[] }; // the page's window, seen from page.evaluate
test('setSetting validates, persists and reaches the window; pickFolder', async () => {
  const folder = tmpdir();
  const { app, page, userDataDir } = await launchApp({ env: { BASECRAFT_E2E_FOLDER_PATH: folder } });
  try {
    await page.evaluate(() => { const w = window as unknown as W; w.seen = []; w.basecraft.app.onSettingsChanged((s) => w.seen.push(s)); });
    await page.evaluate(() => (window as unknown as W).basecraft.app.setSetting('confirmActionQueries', false));
    await page.evaluate(() => (window as unknown as W).basecraft.app.setSetting('defaultFolder', ''));
    await expect.poll(() => page.evaluate(() => (window as unknown as W).seen.length)).toBe(2);
    expect(await page.evaluate(() => (window as unknown as W).seen[0])).toMatchObject({ confirmActionQueries: false, recentCount: 10, uiLanguage: expect.any(String) });
    for (const [k, v] of [['recentCount', 51], ['openLast', 1], ['locale', 'fr'], ['__proto__', true]])
      await expect(page.evaluate(([key, val]) => (window as unknown as W).basecraft.app.setSetting(key as 'openLast', val as boolean), [k, v])).rejects.toThrow('bc:invalidArgument');
    expect(await page.evaluate(() => (window as unknown as W).seen.length)).toBe(2); // a refused value writes and broadcasts nothing
    expect(JSON.parse(readFileSync(join(userDataDir, 'settings.json'), 'utf8'))).toMatchObject({ confirmActionQueries: false, recentCount: 10, openLast: false });
    expect(await page.evaluate(() => (window as unknown as W).basecraft.app.pickFolder())).toBe(folder);
  } finally {
    await app.close();
  }
});
