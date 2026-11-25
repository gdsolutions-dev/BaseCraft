// helpers.ts captures a test's windows when it closes its app, and keeps the files only if the test failed.
import { test, expect } from '@playwright/test';
import { existsSync } from 'node:fs';
import { launchApp } from './helpers';

test.describe.configure({ mode: 'serial' });   // the second test reads what the first one left
let capture = '';

test('closing the app captures its window', async () => {
  const { app } = await launchApp();
  await app.close();
  capture = test.info().outputPath('at-close-1.png');
  expect(existsSync(capture)).toBe(true);
});

test('the capture of a test that passed is gone at the next launch', async () => {
  const { app } = await launchApp();
  try {
    expect(capture).not.toBe('');
    expect(existsSync(capture)).toBe(false);
  } finally {
    await app.close();
  }
});
