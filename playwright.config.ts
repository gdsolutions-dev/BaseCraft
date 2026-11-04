import { mkdtempSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { defineConfig } from '@playwright/test';

// Every temporary folder of a run (seeded bases, user data, exports, the apps' own) goes under one folder, removed by
// global-teardown.ts. Workers reload this file: they inherit the variables, so they reuse the runner's folder.
if (!process.env.BASECRAFT_E2E_TMP) {
  // realpath: Windows runners' TEMP is 8.3 (RUNNER~1); the specs compare the app's paths with realpathSync.native
  const dir = realpathSync.native(mkdtempSync(join(tmpdir(), 'basecraft-run-')));
  process.env.BASECRAFT_E2E_TMP = process.env.TEMP = process.env.TMP = process.env.TMPDIR = dir;
}

export default defineConfig({ testDir: 'tests/e2e', timeout: 30000, workers: 1, globalTeardown: './tests/e2e/global-teardown.ts' });
