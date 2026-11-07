// F2 Task 2: the base's default theme is stored in the file (options.theme) and survives reopening.
import { test, expect } from '@playwright/test';
import type { BasecraftApi } from '../../src/shared/api';
import { BUILTIN_THEMES, DEFAULT_THEME } from '../../src/shared/design/theme';
import { launchApp, seedBase } from './helpers';

test('theme.set then get returns it, and it persists after reopening the base', async () => {
  const p = seedBase('theme-base');
  const { app, page } = await launchApp({ args: [p] });
  const get = () => page.evaluate(() => (window as unknown as { basecraft: BasecraftApi }).basecraft.theme.get());
  expect(await get()).toEqual(DEFAULT_THEME);
  await page.evaluate((t) => (window as unknown as { basecraft: BasecraftApi }).basecraft.theme.set(t), BUILTIN_THEMES[2]!);
  expect(await get()).toEqual(BUILTIN_THEMES[2]);
  await page.evaluate(async (path) => {
    const b = (window as unknown as { basecraft: BasecraftApi }).basecraft.base;
    await b.close();
    await b.open(path);
  }, p);
  expect(await get()).toEqual(BUILTIN_THEMES[2]);
  await expect(page.evaluate(() => (window as unknown as { basecraft: BasecraftApi }).basecraft.theme.set({} as never))).rejects.toThrow(/bc:invalidTheme/);
  await app.close();
});
