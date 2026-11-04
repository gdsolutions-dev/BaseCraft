import { test, expect, type Page } from '@playwright/test';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { liveParams, noLiveServer, withSchema } from '../../src/main/connectors/postgres/live';
import { pgLabel } from '../../src/main/connectors/postgres/params';
import { saveObject } from '../../src/main/db/objects';
import { seedSales, seedSalesRelation } from '../../src/main/query/test-db';
import { launchApp, openDbOptions, seedBase, SALES_QUERIES } from './helpers';

// C7 R1, R13, R16: Database Tools › Move Data › « Vers un serveur » against the live PostgreSQL (BASECRAFT_PG_TEST_URL), in a
// schema of its own (withSchema), dropped after.
const fr = JSON.parse(readFileSync(join(__dirname, '../../src/shared/i18n/fr.json'), 'utf8'));
const ENV = { BASECRAFT_REGION: 'fr-FR' };

/** The wizard up to « Migrer »: PostgreSQL, the login of the URL, the schema. */
async function runWizard(page: Page, schema: string) {
  const { params, login } = liveParams();
  await page.getByTestId('ribbon-tab-databaseTools').click();
  await expect(page.getByTestId('cmd-moveToServer')).toHaveText(fr.ribbon.cmd.moveToServer);
  await page.getByTestId('cmd-moveToServer').click();
  await expect(page.getByTestId('modal')).toContainText(fr.migrate.title);
  await expect(page.getByTestId('migrate-dialog')).toContainText(fr.migrate.intro);
  await page.getByTestId('migrate-engine-postgresql').check();
  await page.getByTestId('migrate-next').click();
  await page.getByTestId('srv-host').fill(params.host);
  await page.getByTestId('srv-port').fill(String(params.port));
  await page.getByTestId('srv-database').fill(params.database);
  await page.getByTestId('srv-user').fill(params.user);
  await page.getByTestId('srv-tls').selectOption(params.tls);
  await page.getByTestId('srv-password').fill(login.password);
  await page.getByTestId('srv-connect').click();
  await expect(page.getByTestId('migrate-schema')).toHaveValue('public'); // R1: PostgreSQL's default
  await page.getByTestId('migrate-schema').fill(schema);
  await page.getByTestId('migrate-start').click();
}

test('the wizard moves the sales base: progress, report, links, front-end option; a second run is refused', async () => {
  test.skip(noLiveServer(), 'BASECRAFT_PG_TEST_URL is not set'); // fails on Linux CI without it (M7)
  test.setTimeout(180_000);
  await withSchema(async (_admin, schema) => {
    const front = seedBase('Ventes', (db) => {
      seedSales(db);
      seedSalesRelation(db);
      for (const [q, sql] of SALES_QUERIES) saveObject(db, 'query', q, { formatVersion: '1.0', sql }, null);
      saveObject(db, 'query', 'QNoms', { formatVersion: '1.0', sql: 'SELECT Format(Nom, ">") AS N FROM Clients;' }, null); // R13
    });
    const { params, login } = liveParams();
    let { app, page, userDataDir } = await launchApp({ args: [front], env: ENV });
    try {
      await page.getByTestId('nav-item-Clients').dblclick(); // an open document is closed first, as the split
      await expect(page.getByTestId('doc-tab-Clients')).toHaveCount(1);
      // every text the progress shows, and whether « Arrêter » was enabled with it (a 9-row run may show each for a moment only)
      await page.evaluate(() => {
        const w = window as unknown as { seen: string[] };
        w.seen = [];
        new MutationObserver(() => {
          const el = document.querySelector('[data-testid="migrate-progress"]');
          const stop = document.querySelector<HTMLButtonElement>('[data-testid="migrate-stop"]');
          if (el) w.seen.push(`${el.querySelector('p')?.textContent ?? ''}|${stop?.disabled ? 'off' : 'on'}`);
        }).observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true });
      });
      await runWizard(page, schema);

      const report = page.getByTestId('migrate-report');
      await expect(report).toBeVisible({ timeout: 60_000 });
      const seen = await page.evaluate(() => (window as unknown as { seen: string[] }).seen);
      expect(seen.some((x) => x.startsWith('Copie de Commandes : ') && x.endsWith('|on'))).toBe(true);
      expect(seen.filter((x) => x.startsWith(fr.migrate.finishing)).every((x) => x.endsWith('|off'))).toBe(true); // R9: no Stop once finishing
      const backups = readdirSync(dirname(front)).filter((x) => x.startsWith('Ventes.backup-'));
      expect(backups).toHaveLength(1);
      const backup = join(dirname(front), backups[0]!);
      await expect(report).toContainText(fr.migrate.done.replace('{{backup}}', backup));
      await expect(report).toContainText(`Serveur PostgreSQL : ${pgLabel(params)}, schéma ${schema}.`);
      for (const line of ['Clients : 4 enregistrement(s), prochain NuméroAuto : 5', 'Commandes : 5 enregistrement(s), prochain NuméroAuto : 6',
        'ClientsCommandes : clé étrangère créée', `Commandes.Montant : ${fr.fieldProp.validationRule}`,
        `QNoms : Format ne peut pas s'exécuter sur une source PostgreSQL`]) await expect(report).toContainText(line);
      await expect(report).not.toContainText('QVentes'); // the join runs on the server
      await expect(page.getByTestId('doc-tab-Clients')).toHaveCount(0);

      // R16: the report as text, one line per entry; no credential
      await page.getByTestId('migrate-copy').click();
      await expect.poll(() => app.evaluate(({ clipboard }) => clipboard.readText())).toContain('  Clients : 4 enregistrement(s)');
      const text = await app.evaluate(({ clipboard }) => clipboard.readText());
      expect(text.split('\n')[0]).toBe(fr.migrate.done.replace('{{backup}}', backup));
      expect(text).toContain(`\n${fr.migrate.report.relations}\n  ClientsCommandes : clé étrangère créée\n`);
      expect(text.replaceAll(backup, '').replaceAll(params.database, '')).not.toContain(login.password); // CI's password « basecraft » is also in the backup's path and the database's name
      await page.getByTestId('migrate-close').click();
      await expect(page.getByTestId('modal')).toHaveCount(0);

      // the pane lists the links; Clients reads from the server
      await expect(page.getByTestId('nav-item-link-Clients')).toBeVisible();
      await expect(page.getByTestId('nav-item-link-Commandes')).toBeVisible();
      await page.getByTestId('nav-item-Clients').dblclick();
      await expect(page.getByTestId('datasheet').getByTestId('data-grid-canvas')).toBeVisible();
      await expect(page.getByTestId('glide-cell-2-2')).toHaveText('Durand');

      // File › Options › « Base de données active »: the base is a front-end now
      await page.getByTestId('ribbon-tab-file').click();
      await openDbOptions(page);
      await expect(page.getByTestId('opt-db-frontend')).toBeChecked();
      await app.close();

      // the backup copy moved again to the same schema: refused, its tables named
      ({ app, page } = await launchApp({ args: [backup], env: ENV, userDataDir }));
      await runWizard(page, schema);
      await expect(page.getByTestId('migrate-result')).toContainText(fr.migrate.nameTaken.replace('{{names}}', 'Clients, Commandes'));
      await page.getByTestId('migrate-close').click();
      await expect(page.getByTestId('nav-item-link-Clients')).toHaveCount(0); // nothing changed
    } finally {
      await app.close();
    }
  });
});

test('Cancel on a page of the wizard does nothing; the Runtime has no « Vers un serveur »', async () => {
  const front = seedBase('Ventes', (db) => seedSales(db));
  let { app, page, userDataDir } = await launchApp({ args: [front], env: ENV });
  try {
    await page.getByTestId('nav-item-Clients').dblclick();
    await page.getByTestId('ribbon-tab-databaseTools').click();
    await page.getByTestId('cmd-moveToServer').click();
    await page.getByTestId('migrate-cancel').click();
    await expect(page.getByTestId('modal')).toHaveCount(0);
    await page.getByTestId('cmd-moveToServer').click();
    await page.getByTestId('migrate-engine-sqlserver').check();
    await page.getByTestId('migrate-next').click();
    await expect(page.getByTestId('srv-port')).toHaveValue('1433');
    await page.getByTestId('srv-cancel').click();
    await expect(page.getByTestId('modal')).toHaveCount(0);
    await expect(page.getByTestId('doc-tab-Clients')).toHaveCount(1); // no document closed
  } finally {
    await app.close();
  }
  ({ app, page } = await launchApp({ runtime: true, args: [front], env: ENV, userDataDir }));
  try {
    await expect(page.getByTestId('ribbon-tab-home')).toBeVisible();
    await expect(page.getByTestId('cmd-moveToServer')).toHaveCount(0);
  } finally {
    await app.close();
  }
});
