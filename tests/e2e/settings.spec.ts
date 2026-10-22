import { test, expect } from '@playwright/test';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
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
    await page.getByTestId('opt-lang').selectOption('en');
    await expect(page.getByTestId('opt-theme').locator('option[value="dark"]')).toHaveText('Dark');
    await page.getByTestId('opt-theme').selectOption('system');
    expect(await page.evaluate(() => document.documentElement.dataset.theme)).toBeUndefined();
    await page.getByTestId('opt-theme').selectOption('light');
    const f = join(userDataDir, 'settings.json');
    expect(existsSync(f)).toBe(true);
    expect(JSON.parse(readFileSync(f, 'utf8'))).toMatchObject({ locale: 'en', theme: 'light' });
  } finally {
    await app.close();
  }
});
