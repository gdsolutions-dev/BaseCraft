// Recette of batch E4 with Microsoft Access (skipped where Access is not installed): Ventes-complet.accdb is imported with "Read the exact
// structure with Access"; the form and the report arrive as in recette-e4.spec.ts, and the report keeps the page setup Access holds for it.
import { test, expect } from '@playwright/test';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { checkFormClients, checkReportCommandes, copyComplet, FIXTURES, hasComplet, importTables, launch, objectDef, removeTemp } from './recette-e2-common';

const hasAccess = process.platform === 'win32' && spawnSync('reg', ['query', 'HKCR\\Access.Application'], { stdio: 'ignore' }).status === 0;
test.skip(!hasAccess, 'Microsoft Access is not installed');
test.skip(!hasComplet, "Ventes-complet.accdb is not committed: copy it from the owner's originals");

const PAPER: Record<number, string> = { 9: 'a4' };

test('recette E4 + Access: the form and the report read by Access are imported, open and keep their page setup', async () => {
  test.setTimeout(480_000);
  let dir: string | undefined, app: Awaited<ReturnType<typeof launch>>['app'] | undefined;
  try {
    const c = copyComplet();
    dir = c.dir;
    const l = await launch(c.path);
    app = l.app;
    const page = l.page;
    await importTables(page, ['Clients', 'Commandes', 'Divers'], 'access');
    for (const code of ['formImported', 'reportImported', 'designEventDropped', 'designControlReplaced', 'designSubformTable', 'designPropertiesIgnored']) {
      await expect(page.getByTestId(`report-line-${code}`).first(), code).toBeVisible();
    }
    await expect(page.getByTestId('report-line-designPageDefault')).toHaveCount(0); // the live text still has its Prt blocks
    await expect(page.getByTestId('report-ignored').locator('li').last()).toHaveAttribute('data-testid', 'report-line-macrosOnly');
    await page.getByTestId('import-close').click();
    await checkFormClients(page);
    await checkReportCommandes(page);

    const truth = JSON.parse(readFileSync(join(FIXTURES, 'Ventes-complet.props.json'), 'utf8').replace(/^﻿/, ''));
    const want = truth.objects.find((o: { kind: string; name: string }) => o.kind === 'report' && o.name === 'ECommandes').page;
    const setup = (await objectDef(page, 'report', 'ECommandes')).props.pageSetup;
    expect(setup).toMatchObject({ orientation: want.orientation === 1 ? 'portrait' : 'landscape', paper: PAPER[want.paperSize],
      margins: { left: want.leftMargin, top: want.topMargin, right: want.rightMargin, bottom: want.bottomMargin } });
  } finally {
    await app?.close();
    if (dir !== undefined) removeTemp(dir);
  }
});
