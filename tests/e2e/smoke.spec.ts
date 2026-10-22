import { test, expect } from '@playwright/test';
import { launchApp } from './helpers';

test('window is secure and exposes the bridge only', async () => {
  const { app, page } = await launchApp();
  expect(await page.title()).toBe('BaseCraft');
  expect(await page.evaluate(() => typeof (window as any).require)).toBe('undefined');
  expect(await page.evaluate(() => typeof (window as any).process)).toBe('undefined');
  expect(await page.evaluate(() => typeof (window as any).basecraft)).toBe('object');
  await app.close();
});

test('CSP is enforced in the built app', async () => {
  const { app, page } = await launchApp();
  try {
    expect(await page.locator('meta[http-equiv="Content-Security-Policy"]').getAttribute('content')).toBe(
      "default-src 'self'; style-src 'self' 'unsafe-inline'; font-src 'self'; img-src 'self' data:",
    );
    await page.evaluate(() => {
      const s = document.createElement('script');
      s.textContent = 'window.__cspProbe = 1';
      document.head.appendChild(s);
    });
    expect(await page.evaluate(() => (window as any).__cspProbe)).toBeUndefined();
  } finally {
    await app.close();
  }
});
