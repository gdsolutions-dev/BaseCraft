// Recette of batch E3 with Microsoft Access (skipped where Access is not installed): Ventes-complet.accdb is imported with "Read the exact
// structure with Access"; its two queries arrive and QTotaux and QParVille give the same values and Design view as in recette-e3.spec.ts.
import { test, expect } from '@playwright/test';
import { spawnSync } from 'node:child_process';
import { checkParVille, checkTotaux, checkTotauxDesign, copyComplet, hasComplet, importTables, launch, removeTemp } from './recette-e2-common';

const hasAccess = process.platform === 'win32' && spawnSync('reg', ['query', 'HKCR\\Access.Application'], { stdio: 'ignore' }).status === 0;
test.skip(!hasAccess, 'Microsoft Access is not installed');
test.skip(!hasComplet, "Ventes-complet.accdb is not committed: copy it from the owner's originals");

test('recette E3 + Access: the queries read by Access are imported, run and open in Design view', async () => {
  test.setTimeout(480_000);
  let dir: string | undefined, app: Awaited<ReturnType<typeof launch>>['app'] | undefined;
  try {
    const c = copyComplet();
    dir = c.dir;
    const l = await launch(c.path);
    app = l.app;
    const page = l.page;
    await importTables(page, ['Clients', 'Commandes', 'Divers'], 'access');
    await expect(page.getByTestId('report-line-queryImported')).toHaveCount(2);
    await expect(page.getByTestId('report-line-queryKeptAsText')).toHaveCount(0);
    await page.getByTestId('import-close').click();
    await checkTotaux(page, 'QTotaux', 'Commandes');
    await checkTotauxDesign(page);
    await checkParVille(page);
  } finally {
    await app?.close();
    if (dir !== undefined) removeTemp(dir);
  }
});
