// Recette of batch E4 (forms and reports of an Access base), without Access: Ventes-complet.accdb is imported with a temp copy of its committed
// export folder. The report counts what was carried and what was left out; FClients opens in Form view on the first customer, with Access's
// positions; ECommandes prints one group per customer and the sum of Montant; a second import without the box brings no form or report.
import { test, expect } from '@playwright/test';
import { checkFormClients, checkReportCommandes, copyComplet, copyExport, hasComplet, importTables, launch, removeTemp } from './recette-e2-common';

test.skip(!hasComplet, "Ventes-complet.accdb is not committed: copy it from the owner's originals");

test('recette E4: the form and the report of Ventes-complet are imported, open and give the same values as in Access', async () => {
  test.setTimeout(300_000);
  let dir: string | undefined, exp: string | undefined, app: Awaited<ReturnType<typeof launch>>['app'] | undefined;
  try {
    const c = copyComplet();
    dir = c.dir;
    exp = copyExport(false);
    const l = await launch(c.path, exp);
    app = l.app;
    const page = l.page;
    await importTables(page, ['Clients', 'Commandes', 'Divers'], 'folder');
    for (const code of ['formImported', 'reportImported', 'designEventDropped', 'designControlReplaced', 'designSubformTable', 'designPropertiesIgnored']) {
      await expect(page.getByTestId(`report-line-${code}`).first(), code).toBeVisible();
    }
    await expect(page.getByTestId('report-line-formImported')).toContainText('FClients');
    await expect(page.getByTestId('report-line-reportImported')).toContainText('ECommandes');
    await expect(page.getByTestId('report-line-designSubformTable')).toContainText('Table.Commandes');
    await expect(page.getByTestId('report-ignored').locator('li').last()).toHaveAttribute('data-testid', 'report-line-macrosOnly');
    await expect(page.getByTestId('report-line-formsOnly')).toHaveCount(0);
    await page.getByTestId('import-close').click();

    await expect(page.getByTestId('nav-item-form-FClients')).toBeVisible();
    await expect(page.getByTestId('nav-item-report-ECommandes')).toBeVisible();
    await checkFormClients(page);
    await checkReportCommandes(page);

    // a second import without the box: no new form or report, the report ends as E3's
    await importTables(page, ['Clients1', 'Commandes1', 'Divers1'], 'folder', { designs: false });
    await expect(page.getByTestId('report-line-formImported')).toHaveCount(0);
    await expect(page.getByTestId('report-line-reportImported')).toHaveCount(0);
    await expect(page.getByTestId('report-ignored').locator('li').last()).toHaveAttribute('data-testid', 'report-line-formsOnly');
    await page.getByTestId('import-close').click();
    await expect(page.getByTestId('nav-item-form-FClients1')).toHaveCount(0);
    await expect(page.getByTestId('nav-item-report-ECommandes1')).toHaveCount(0);
  } finally {
    await app?.close();
    removeTemp(...[dir, exp].filter((d): d is string => d !== undefined));
  }
});
