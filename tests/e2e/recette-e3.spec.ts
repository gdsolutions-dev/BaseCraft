// Recette of batch E3 (queries of an Access base), without Access: Ventes-complet.accdb is imported with a temp copy of its committed
// export folder plus two more queries (QInconnue, kept as text; QServeur, pass-through). The report counts them; QTotaux and QParVille open as
// datasheets with the right values and in Design view; QInconnue opens in SQL view with an error; a second import renames queries and tables.
import { test, expect } from '@playwright/test';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { checkParVille, checkTotaux, checkTotauxDesign, copyComplet, copyExport, hasComplet, importTables, launch, removeTemp } from './recette-e2-common';

test.skip(!hasComplet, "Ventes-complet.accdb is not committed: copy it from the owner's originals");

test('recette E3: the queries of Ventes-complet are imported, run and open in Design view', async () => {
  test.setTimeout(300_000);
  let dir: string | undefined, exp: string | undefined, app: Awaited<ReturnType<typeof launch>>['app'] | undefined;
  try {
    const c = copyComplet();
    dir = c.dir;
    exp = copyExport(true);
    const l = await launch(c.path, exp);
    app = l.app;
    const page = l.page;
    await importTables(page, ['Clients', 'Commandes', 'Divers'], 'folder');
    const imported = page.getByTestId('report-line-queryImported');
    await expect(imported).toHaveCount(2);
    await expect(imported.nth(0)).toContainText('QParVille');
    await expect(imported.nth(1)).toContainText('QTotaux');
    await expect(page.getByTestId('report-line-queryKeptAsText')).toHaveCount(1);
    await expect(page.getByTestId('report-line-queryKeptAsText')).toContainText('QInconnue');
    await expect(page.getByTestId('report-line-queryKeptAsText')).toContainText('DLookup');
    await expect(page.getByTestId('report-line-queryPassThrough')).toHaveCount(1);
    await expect(page.getByTestId('report-line-queryPassThrough')).toContainText('QServeur');
    await expect(page.getByTestId('report-line-macrosOnly')).toHaveCount(1); // E4: the forms and reports come with the queries by default
    await page.getByTestId('import-close').click();

    const first = await checkTotaux(page, 'QTotaux', 'Commandes');
    await checkTotauxDesign(page);
    await checkParVille(page);

    // QInconnue: SQL view with its text and the error; Design view stays out of reach
    await page.getByTestId('nav-item-query-QInconnue').click({ button: 'right' });
    await page.getByTestId('nav-menu-sqlView').click();
    await expect(page.getByTestId('doc-tab-query-QInconnue')).toBeVisible();
    await expect(page.getByTestId('query-sql')).toHaveValue(/DLookup/);
    await expect(page.getByTestId('query-sql-error')).toBeVisible();
    await page.getByTestId('status-view-design').click(); // a text that does not read stays in SQL view (query-design.spec.ts)
    await expect(page.getByTestId('status-view-sql')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByTestId('query-sql-error')).toBeVisible();
    await expect(page.getByTestId('qbe-cell-field-0')).toHaveCount(0);
    await page.getByTestId('doc-tab-close-query-QInconnue').click();

    // a second import into the same base: Clients1, Commandes1, Divers1 and queries reading them
    await importTables(page, ['Clients1', 'Commandes1', 'Divers1'], 'folder');
    await expect(page.getByTestId('report-line-querySourceMissing')).toHaveCount(0);
    await expect(imported).toHaveCount(2);
    await expect(imported.nth(0)).toContainText('QParVille1');
    await expect(imported.nth(1)).toContainText('QTotaux1');
    await page.getByTestId('import-close').click();
    expect(await checkTotaux(page, 'QTotaux1', 'Commandes1')).toEqual(first);
  } finally {
    await app?.close();
    removeTemp(...[dir, exp].filter((d): d is string => d !== undefined));
  }
});

test('recette E3: a long report opens at its top and its OK button stays reachable', async () => {
  test.setTimeout(300_000);
  let dir: string | undefined, exp: string | undefined, app: Awaited<ReturnType<typeof launch>>['app'] | undefined;
  try {
    const c = copyComplet();
    dir = c.dir;
    exp = copyExport(false);
    const m = JSON.parse(readFileSync(join(exp, 'manifest.json'), 'utf8'));
    for (let i = 0; i < 80; i++) m.objects.push({ type: 'query', name: `QMissing${i}`, file: `queries/missing${i}.sql`, queryType: 0, connect: '', returnsRecords: true });
    for (let i = 0; i < 80; i++) writeFileSync(join(exp, `queries/missing${i}.sql`), ''); // an empty text is unreadable: querySkipped
    writeFileSync(join(exp, 'manifest.json'), JSON.stringify(m, null, 2));
    const l = await launch(c.path, exp);
    app = l.app;
    const page = l.page;
    await importTables(page, ['Clients', 'Commandes', 'Divers'], 'folder');
    await expect(page.getByTestId('report-line-querySkipped')).toHaveCount(80);
    await expect(page.getByTestId('report-ignored').locator('h3')).toBeInViewport();
    await expect(page.getByTestId('import-close')).toBeInViewport();
    await page.getByTestId('import-close').click();
    await expect(page.getByTestId('import-report')).toHaveCount(0);
  } finally {
    await app?.close();
    removeTemp(...[dir, exp].filter((d): d is string => d !== undefined));
  }
});
