// Recette of the Access import's linked tables, with Microsoft Access (skipped where it is not installed): a front-end that links Clients and
// Commandes (as Cdes) of Ventes.accdb and holds one query over Clients is imported with the "relink" box; the links open as read-only datasheets,
// the query runs; once the back-end is gone, a second import reports the tables and the query instead.
import { test, expect, type Page } from '@playwright/test';
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ACCESS_EXPECTED } from '../fixtures/access/expected';
import { FIXTURES, launch, removeTemp } from './recette-e2-common';

const hasAccess = process.platform === 'win32' && spawnSync('reg', ['query', 'HKCR\\Access.Application'], { stdio: 'ignore' }).status === 0;
test.skip(!hasAccess, 'Microsoft Access is not installed');

const cell = (page: Page, col: number, row: number) => page.getByTestId(`glide-cell-${col + 1}-${row}`);

/** Imports the local table Locale (an import needs one picked table) with the structure read by Access, "queries" and "relink" ticked. */
async function importFrontEnd(page: Page, fileOnly = false) {
  await page.getByTestId('ribbon-tab-externalData').click();
  await page.getByTestId('cmd-importAccess').click();
  if (fileOnly) await page.getByTestId('import-structure-file').check(); // no Access export: the links are read from the file
  else {
    await page.getByTestId('import-structure-access').check();
    await expect(page.getByTestId('import-queries')).toBeChecked();
  }
  await expect(page.getByTestId('import-relink')).toBeChecked(); // ticked by default, with its note
  await expect(page.getByTestId('import-relink-note')).toBeVisible();
  await page.getByTestId('link-table-Locale').check();
  await page.getByTestId('link-ok').click();
  await expect(page.getByTestId('import-report')).toBeVisible({ timeout: 180_000 });
}

test('linked tables: the front-end of a split Access application is imported with its links, then reported when the back-end is gone', async () => {
  test.setTimeout(480_000);
  const dir = mkdtempSync(join(tmpdir(), 'basecraft-recette-links-'));
  const backEnd = join(dir, 'Ventes.accdb'), front = join(dir, 'Front.accdb');
  let app: Awaited<ReturnType<typeof launch>>['app'] | undefined;
  try {
    copyFileSync(join(FIXTURES, 'Ventes.accdb'), backEnd);
    const made = spawnSync('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', join(__dirname, '../helpers/make-access-front-end.ps1'), '-BackEnd', backEnd, '-Out', front], { encoding: 'utf8', timeout: 300_000 });
    expect(made.stdout, made.stderr).toContain('done');

    let l = await launch(front);
    app = l.app;
    let page = l.page;
    await importFrontEnd(page);
    await expect(page.getByTestId('report-line-tableRelinked')).toHaveCount(2);
    await expect(page.getByTestId('report-line-queryImported')).toHaveCount(1);
    await page.getByTestId('import-close').click();
    await expect(page.getByTestId('nav-item-link-Clients')).toBeVisible();
    await expect(page.getByTestId('nav-item-link-Cdes')).toBeVisible();
    await page.getByTestId('nav-item-Clients').dblclick();
    await expect(page.getByTestId('nav-record-count')).toHaveText(String(ACCESS_EXPECTED.clients.length));
    await expect(page.getByTestId('nav-readonly')).toBeVisible();
    for (const [r, row] of ACCESS_EXPECTED.clients.entries()) await expect(cell(page, 1, r)).toHaveText(String(row[1]));
    await page.getByTestId('doc-tab-Clients').waitFor();
    await page.getByTestId('doc-tab-close-Clients').click();
    await page.getByTestId('nav-item-Cdes').dblclick();
    await expect(page.getByTestId('nav-record-count')).toHaveText(String(ACCESS_EXPECTED.commandes.length));
    await page.getByTestId('doc-tab-close-Cdes').click();
    await page.getByTestId('nav-item-query-QLiee').dblclick();
    await expect(page.getByTestId('nav-record-count')).toHaveText(String(ACCESS_EXPECTED.clients.length)); // one row per customer
    await app.close();
    app = undefined;

    rmSync(backEnd); // the application was moved without its data: nothing to link to
    l = await launch(front);
    app = l.app;
    page = l.page;
    await importFrontEnd(page);
    // each reported as not relinked, its file missing (the hidden table of the attachment field is left out: exactly two lines)
    for (const n of ['Clients', 'Cdes']) await expect(page.getByTestId('report-line-tableLinked').filter({ hasText: `« ${n} »` })).toHaveCount(1);
    await expect(page.getByTestId('report-line-tableLinked')).toHaveCount(2);
    await expect(page.getByTestId('report-line-tableRelinked')).toHaveCount(0);
    await expect(page.getByTestId('report-line-querySourceMissing')).toHaveCount(1);
  } finally {
    await app?.close();
    removeTemp(dir);
  }
});

test('linked tables: offered and created with the structure source "file only" too', async () => {
  test.setTimeout(300_000);
  const dir = mkdtempSync(join(tmpdir(), 'basecraft-recette-links-file-'));
  const backEnd = join(dir, 'Ventes.accdb'), front = join(dir, 'Front.accdb');
  let app: Awaited<ReturnType<typeof launch>>['app'] | undefined;
  try {
    copyFileSync(join(FIXTURES, 'Ventes.accdb'), backEnd);
    const made = spawnSync('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', join(__dirname, '../helpers/make-access-front-end.ps1'), '-BackEnd', backEnd, '-Out', front], { encoding: 'utf8', timeout: 300_000 });
    expect(made.stdout, made.stderr).toContain('done');
    const l = await launch(front);
    app = l.app;
    await importFrontEnd(l.page, true);
    await expect(l.page.getByTestId('report-line-tableRelinked')).toHaveCount(2);
    await l.page.getByTestId('import-close').click();
    await expect(l.page.getByTestId('nav-item-link-Clients')).toBeVisible();
    await expect(l.page.getByTestId('nav-item-link-Cdes')).toBeVisible();
  } finally {
    await app?.close();
    removeTemp(dir);
  }
});
