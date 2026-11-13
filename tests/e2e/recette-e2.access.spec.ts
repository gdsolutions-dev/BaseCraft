// Recette of batch E2 with Microsoft Access (skipped where Access is not installed): Ventes-complet.accdb is imported with "Read the exact
// structure with Access" and shows the same Table Design values as recette-e2.spec.ts; "Keep the export folder" leaves a folder that a
// second import reads through "Use an export folder…" with the same report; a hostile base (code that runs on open and writes a sentinel
// file) is imported with Access: the import ends, the sentinel does not exist, and no Access process is left from the test.
import { test, expect } from '@playwright/test';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { checkTableDesign, copyComplet, hasComplet, importComplet, importTables, launch, removeTemp } from './recette-e2-common';

const hasAccess = process.platform === 'win32' && spawnSync('reg', ['query', 'HKCR\\Access.Application'], { stdio: 'ignore' }).status === 0;
test.skip(!hasAccess, 'Microsoft Access is not installed');

const HOSTILE = join(__dirname, '../helpers/make-hostile-access.ps1');
/** Ids of the MSACCESS processes alive now (the owner may have Access open: those are never touched). */
const accessIds = (): number[] => spawnSync('powershell', ['-NoProfile', '-Command', '(Get-Process MSACCESS -ErrorAction SilentlyContinue).Id'], { encoding: 'utf8' })
  .stdout.split(/\s+/).filter(Boolean).map(Number);

test('recette E2 + Access: the exact structure read by Access, kept, then read again from the kept folder', async () => {
  test.skip(!hasComplet, "Ventes-complet.accdb is not committed: copy it from the owner's originals");
  test.setTimeout(480_000);
  const { dir, path } = copyComplet();
  const keepParent = mkdtempSync(join(tmpdir(), 'basecraft-recette-e2-keep-'));
  try {
    const first = await launch(path, keepParent);
    let report: string;
    try {
      // the Keep check box belongs to the Access choice only
      await first.page.getByTestId('ribbon-tab-externalData').click();
      await first.page.getByTestId('cmd-importAccess').click();
      await first.page.getByTestId('import-structure-file').check();
      await expect(first.page.getByTestId('import-keep-export')).toBeDisabled();
      await first.page.getByTestId('import-structure-access').check();
      await expect(first.page.getByTestId('import-keep-export')).toBeEnabled();
      await first.page.getByTestId('link-cancel').click();
      report = await importComplet(first.page, 'access', { keep: true });
      await checkTableDesign(first.page);
    } finally {
      await first.app.close();
    }
    const kept = join(keepParent, 'Ventes-complet.accdb.export');
    expect(existsSync(join(kept, 'manifest.json'))).toBe(true);
    expect(existsSync(join(kept, 'structure.json'))).toBe(true);
    expect(readdirSync(dir)).toEqual(['Ventes-complet.accdb']); // no temporary folder of the export beside the file

    // a second import, on another front-end, reads the kept folder: same report
    const second = await launch(path, kept);
    try {
      expect(await importComplet(second.page, 'folder')).toBe(report);
      await checkTableDesign(second.page);
    } finally {
      await second.app.close();
    }
    expect(readFileSync(join(kept, 'manifest.json'), 'utf8')).toContain('Ventes-complet.accdb');
  } finally {
    removeTemp(dir, keepParent);
  }
});

test('recette E2 + Access: a hostile base is imported, its code does not run, no Access process is left', async () => {
  test.setTimeout(480_000);
  const before = new Set(accessIds());
  const dir = mkdtempSync(join(tmpdir(), 'basecraft-recette-e2-hostile-'));
  try {
    const path = join(dir, 'hostile.accdb'), sentinel = join(dir, 'sentinel.txt');
    const built = spawnSync('powershell', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', HOSTILE, '-Out', path, '-Sentinel', sentinel], { encoding: 'utf8', timeout: 150_000 });
    expect(built.status, built.stderr).toBe(0);
    expect(existsSync(path)).toBe(true);
    expect(existsSync(sentinel)).toBe(false); // building it never ran its code
    const { app, page } = await launch(path);
    try {
      await importTables(page, ['T1'], 'access'); // the report step is reached
      expect(existsSync(sentinel)).toBe(false);
      await page.getByTestId('import-close').click();
    } finally {
      await app.close();
    }
    expect(existsSync(sentinel)).toBe(false);
    await expect.poll(() => accessIds().filter((id) => !before.has(id)), { timeout: 20_000 }).toEqual([]);
  } finally {
    removeTemp(dir);
  }
});
