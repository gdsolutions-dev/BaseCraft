import { _electron, type ElectronApplication, type Page } from '@playwright/test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { createBaseFile, FILE_EXTENSION, openBaseFile } from '../../src/main/db/file-format';

export async function launchApp(
  opts: { args?: string[]; env?: Record<string, string>; userDataDir?: string } = {},
): Promise<{ app: ElectronApplication; page: Page; userDataDir: string }> {
  const userDataDir = opts.userDataDir ?? mkdtempSync(join(tmpdir(), 'basecraft-'));
  const env = { ...process.env, BASECRAFT_E2E: '1', BASECRAFT_USER_DATA: userDataDir, ...opts.env } as Record<string, string>;
  delete env.ELECTRON_RUN_AS_NODE; // sinon Electron démarre comme Node simple
  const app = await _electron.launch({
    args: ['.', ...(opts.args ?? [])],
    env,
  });
  const page = await app.firstWindow();
  // The window stays hidden (main/index.ts): the page must still behave as focused for the grid's editors.
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Emulation.setFocusEmulationEnabled', { enabled: true });
  await page.waitForSelector('[data-testid="app-root"]', { state: 'attached' });
  return { app, page, userDataDir };
}

/** Creates a base in a fresh temporary folder, lets `setup` fill it (createTable, insertRow…), closes it, returns its path.
 *  An asynchronous setup (insertRow is async) gives a promise of the path. */
export function seedBase(name: string, setup?: (db: DatabaseSync) => void): string;
export function seedBase(name: string, setup: (db: DatabaseSync) => Promise<void>): Promise<string>;
export function seedBase(name: string, setup?: (db: DatabaseSync) => void | Promise<void>): string | Promise<string> {
  const p = join(mkdtempSync(join(tmpdir(), 'basecraft-seed-')), name.endsWith(FILE_EXTENSION) ? name : name + FILE_EXTENSION);
  createBaseFile(p, '0.0.0');
  const { db } = openBaseFile(p, 'write', '0.0.0');
  let pending: void | Promise<void>;
  try {
    pending = setup?.(db);
  } catch (e) {
    db.close();
    throw e;
  }
  if (pending instanceof Promise) return pending.then(() => p).finally(() => db.close());
  db.close();
  return p;
}
