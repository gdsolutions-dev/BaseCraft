// Recette of stage E with Microsoft Access (skipped where it is not installed): File > Open on Ventes-complet.accdb makes Ventes-complet.basecraft
// beside it and opens the Access import with everything ticked; one confirmation imports the tables, queries, form, report, macro and modules.
import { test, expect, type Page } from '@playwright/test';
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ACCESS_EXPECTED } from '../fixtures/access/expected';
import { checkParVille, checkTotaux, copyComplet, FIXTURES, hasComplet, openSheet, removeTemp, shown } from './recette-e2-common';
import { launchApp } from './helpers';

const hasAccess = process.platform === 'win32' && spawnSync('reg', ['query', 'HKCR\\Access.Application'], { stdio: 'ignore' }).status === 0;
test.skip(!hasAccess, 'Microsoft Access is not installed');

const state = (page: Page) => page.evaluate(() => (window as unknown as { basecraft: { base: { state(): Promise<{ path: string } | null> } } }).basecraft.base.state());
const open = (opened: string) => launchApp({ waitOpen: false, env: { BASECRAFT_REGION: 'fr-FR', BASECRAFT_E2E_OPEN_PATH: opened } });

test('recette E: File > Open on an Access file creates the base beside it and imports everything with one confirmation', async () => {
  test.skip(!hasComplet, 'Ventes-complet.accdb is not committed: copy it from the original files');
  test.setTimeout(600_000);
  let dir: string | undefined, app: Awaited<ReturnType<typeof launchApp>>['app'] | undefined;
  try {
    const c = copyComplet();
    dir = c.dir;
    const l = await open(c.path);
    app = l.app;
    const page = l.page;
    await page.getByTestId('bs-open').click();
    await expect(page.getByTestId('link-dialog')).toBeVisible({ timeout: 60_000 });
    for (const id of ['import-queries', 'import-designs', 'import-macros']) await expect(page.getByTestId(id), id).toBeChecked();
    for (const n of ['Clients', 'Commandes', 'Divers']) await expect(page.getByTestId(`link-table-${n}`)).toBeChecked();
    await page.getByTestId('link-ok').click();
    await expect(page.getByTestId('import-report')).toBeVisible({ timeout: 300_000 });
    for (const code of ['fieldSkipped', 'designEventProcedure', 'moduleImported', 'macroImported', 'codeBehindImported']) {
      await expect(page.getByTestId(`report-line-${code}`).first(), code).toBeVisible();
    }
    await expect(page.getByTestId('report-line-fieldSkipped').first()).toContainText('Photo');
    await page.getByTestId('import-close').click();

    const made = join(dir, 'Ventes-complet.basecraft');
    expect(existsSync(made)).toBe(true);
    expect((await state(page))!.path).toBe(made);

    await expect(page.getByTestId('nav-item-macro-MOuvrirEtat')).toBeVisible();
    await expect(page.getByTestId('nav-item-module-ModOutils')).toBeVisible();
    await expect(page.getByTestId('nav-item-module-Form_FClients')).toBeVisible();

    // the three tables hold Access's values, cell by cell
    const asText = (rows: (string | boolean)[][]) => rows.map((r) => r.map(String));
    await openSheet(page, 'Clients');
    expect(await shown(page, ACCESS_EXPECTED.clients.length, ACCESS_EXPECTED.clients[0]!.length)).toEqual(asText(ACCESS_EXPECTED.clients));
    await page.getByTestId('doc-tab-close-Clients').click();
    await openSheet(page, 'Commandes');
    // Client is a lookup in this file: the datasheet shows the customer's Nom, not its number
    const orders = ACCESS_EXPECTED.commandes.map((r) => r.map((v, i) => (i === 1 ? String(ACCESS_EXPECTED.clients.find((c) => c[0] === v)![1]) : v)));
    expect(await shown(page, orders.length, orders[0]!.length, [2])).toEqual(orders);
    await page.getByTestId('doc-tab-close-Commandes').click();
    await openSheet(page, 'Divers');
    expect((await shown(page, 1, 1))[0]).toEqual([ACCESS_EXPECTED.divers[0]]); // Heure is still a draft value in expected.ts
    await page.getByTestId('doc-tab-close-Divers').click();

    // both queries run: QTotaux gives the expected customers, QParVille answers its prompt (Lyon: Dupont and Martin)
    for (const q of ['QParVille', 'QTotaux']) await expect(page.getByTestId(`nav-item-query-${q}`)).toBeVisible();
    expect(await checkTotaux(page, 'QTotaux', 'Commandes')).toEqual(ACCESS_EXPECTED.totaux.map((r) => String(ACCESS_EXPECTED.clients.find((c) => c[0] === r[0])![1]))); // the Client lookup shows the Nom
    await checkParVille(page);

    // the form's button runs the macro, which opens the report's preview
    await page.getByTestId('nav-item-form-FClients').dblclick();
    await expect(page.getByTestId('form-run')).toBeVisible();
    await expect(page.getByTestId('form-ctl-N°')).toHaveValue(String(ACCESS_EXPECTED.clients[0]![0]));
    await expect(page.getByTestId('form-ctl-Nom')).toHaveValue(String(ACCESS_EXPECTED.clients[0]![1]));
    await page.getByTestId('form-ctl-Commande25').click();
    await expect(page.getByTestId('report-pages')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId('doc-tab-report-ECommandes')).toBeVisible();

    // the same file again: the name is numbered, the first base is left as it is; Cancel keeps the new empty base open
    await page.getByTestId('ribbon-tab-file').click();
    await page.getByTestId('bs-open').click();
    await expect(page.getByTestId('link-dialog')).toBeVisible({ timeout: 60_000 });
    await page.getByTestId('link-cancel').click();
    expect((await state(page))!.path).toBe(join(dir, 'Ventes-complet1.basecraft'));
    expect(existsSync(made)).toBe(true); // the first base is left as it is
    await expect(page.getByTestId('nav-item-Clients')).toHaveCount(0);
  } finally {
    await app?.close();
    if (dir !== undefined) removeTemp(dir);
  }
});

test('recette E: a front-end with only linked tables is imported with no table picked', async () => {
  test.setTimeout(480_000);
  const dir = mkdtempSync(join(tmpdir(), 'basecraft-recette-e-front-'));
  const backEnd = join(dir, 'Ventes.accdb'), front = join(dir, 'Front.accdb');
  let app: Awaited<ReturnType<typeof launchApp>>['app'] | undefined;
  try {
    copyFileSync(join(FIXTURES, 'Ventes.accdb'), backEnd);
    const made = spawnSync('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', join(__dirname, '../helpers/make-access-front-end.ps1'), '-BackEnd', backEnd, '-Out', front, '-NoLocal'], { encoding: 'utf8', timeout: 300_000 });
    expect(made.stdout, made.stderr).toContain('done');
    const l = await open(front);
    app = l.app;
    const page = l.page;
    await page.getByTestId('bs-open').click();
    await expect(page.getByTestId('link-dialog')).toBeVisible({ timeout: 60_000 });
    await expect(page.getByTestId('import-relink')).toBeChecked();
    await expect(page.locator('[data-testid^="link-table-"]')).toHaveCount(0); // no local table: the picker lists none
    await expect(page.getByTestId('link-ok')).toBeEnabled();
    await page.getByTestId('link-ok').click();
    await expect(page.getByTestId('import-report')).toBeVisible({ timeout: 300_000 });
    await expect(page.getByTestId('report-line-tableRelinked')).toHaveCount(2);
    await page.getByTestId('import-close').click();
    await expect(page.getByTestId('nav-item-link-Clients')).toBeVisible();
    await expect(page.getByTestId('nav-item-link-Cdes')).toBeVisible();
  } finally {
    await app?.close();
    removeTemp(dir);
  }
});
