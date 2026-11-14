// Recette of stage E (macros, modules and code-behind), without Access: Ventes-complet.accdb is imported with a temp copy of its committed
// export folder, the macros box left ticked (it is by default). The macro, the module and the form's code-behind arrive and are listed.
import { test, expect } from '@playwright/test';
import { copyComplet, copyExport, hasComplet, importTables, launch, removeTemp } from './recette-e2-common';

test.skip(!hasComplet, 'Ventes-complet.accdb is not committed: copy it from the original files');

test('recette E (folder): the macro, the module ModOutils and the code-behind of FClients are imported and listed', async () => {
  test.setTimeout(300_000);
  let dir: string | undefined, exp: string | undefined, app: Awaited<ReturnType<typeof launch>>['app'] | undefined;
  try {
    const c = copyComplet();
    dir = c.dir;
    exp = copyExport(false);
    const l = await launch(c.path, exp);
    app = l.app;
    const page = l.page;
    await importTables(page, ['Clients', 'Commandes', 'Divers'], 'folder', { macros: true });
    for (const code of ['macroImported', 'moduleImported', 'codeBehindImported', 'designEventProcedure']) {
      await expect(page.getByTestId(`report-line-${code}`).first(), code).toBeVisible();
    }
    await expect(page.getByTestId('report-line-fieldSkipped').first()).toContainText('Photo');
    await expect(page.getByTestId('report-line-moduleImported')).toContainText('ModOutils');
    await expect(page.getByTestId('report-line-macroImported')).toContainText('MOuvrirEtat');
    await expect(page.getByTestId('report-line-macrosOnly')).toHaveCount(0);
    await page.getByTestId('import-close').click();
    await expect(page.getByTestId('nav-item-macro-MOuvrirEtat')).toBeVisible();
    await expect(page.getByTestId('nav-item-module-ModOutils')).toBeVisible();
    await expect(page.getByTestId('nav-item-module-Form_FClients')).toBeVisible();
  } finally {
    await app?.close();
    removeTemp(...[dir, exp].filter((d): d is string => d !== undefined));
  }
});
