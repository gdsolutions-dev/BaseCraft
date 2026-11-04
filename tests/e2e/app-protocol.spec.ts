import { test, expect } from '@playwright/test';
import { launchApp } from './helpers';

test('the renderer is served by bc-app:// and cross-origin isolated', async () => {
  const { app, page } = await launchApp();
  try {
    expect(page.url().startsWith('bc-app://app/')).toBe(true);
    expect(await page.evaluate(() => crossOriginIsolated)).toBe(true);
    expect(await page.evaluate(() => typeof SharedArrayBuffer)).toBe('function');
    expect(await page.evaluate(async () => (await fetch('bc-app://app/../package.json')).status)).toBe(404);
  } finally {
    await app.close();
  }
});
