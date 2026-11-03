// Recette de l'étape C (spec 7, sans macOS) : l'application de l'étape B (stage-b-app.ts) migrée vers PostgreSQL par l'Assistant
// Migration, sur le serveur de BASECRAFT_PG_TEST_URL (sans lui : ignorée), dans un schéma à elle (withSchema) ; puis deux postes
// Runtime saisissent en même temps sur leurs copies locales de l'application frontale, et un conflit d'écriture est signalé. Une
// seconde recette, plus courte, migre la même application vers SQL Server (BASECRAFT_MSSQL_TEST_URL, une base de données à elle).
// Deux postes simulés par deux instances sur une machine, chacune son dossier de données utilisateur ; le passage sur de vrais
// serveurs TLS et de vraies machines est la validation manuelle du propriétaire (2026-11-01-basecraft-c7-validation-manuelle.md).
import { test, expect, type Page } from '@playwright/test';
import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import type { Client } from 'pg';
import { liveParams, noLiveServer, withSchema } from '../../src/main/connectors/postgres/live';
import { mssqlLive, noLiveMssql, withDatabase } from '../../src/main/connectors/sqlserver/live';
import type { BasecraftApi, ServerKind } from '../../src/shared/api';
import { formatValue } from '../../src/shared/expr/format';
import { num } from '../../src/shared/expr/library';
import { FACTURES_ROWS } from '../../src/shared/report/fixtures/factures';
import { launchApp, layoutFromDom, openDbOptions } from './helpers';
import { buildStageBApp, REPORT, TITLE, vis } from './stage-b-app';

type Win = { basecraft: BasecraftApi };
type App = Awaited<ReturnType<typeof launchApp>>;
type Login = { host: string; port: number; database: string; user: string; tls: string; password: string };
const fr = JSON.parse(readFileSync(join(__dirname, '../../src/shared/i18n/fr.json'), 'utf8'));
const FR = { BASECRAFT_REGION: 'fr-FR' };
const loose = (s: string) => s.replace(/\s/gu, ' ');
const money = (cents: number) => loose(formatValue(num(cents / 100), 'currency', { locale: 'fr-FR', lang: 'fr' }));

/** A workstation's user data; `refreshInterval` in seconds. */
function workstation(refreshInterval: number): string {
  const d = mkdtempSync(join(tmpdir(), 'basecraft-'));
  writeFileSync(join(d, 'settings.json'), JSON.stringify({ refreshInterval }));
  return d;
}
const queryRows = (page: Page, name: string) => page.evaluate((n) => (window as unknown as Win).basecraft.sources.page({ kind: 'query', name: n },
  { offset: 0, limit: 50 }).then((p) => p.rows), name) as Promise<(string | number | null)[][]>;
const count = (page: Page) => vis(page, 'nav-record-count');
const ctl = (page: Page, n: string) => vis(page, `form-ctl-${n}`);
const navButton = (page: Page, key: 'first' | 'next') => vis(page, 'form-run').getByRole('button', { name: fr.datasheet.nav[key], exact: true });

/** The login prompt answered (asked once per workstation and session without a remembered password). */
async function logIn(page: Page, password: string) {
  await expect(page.getByTestId('login-dialog')).toBeVisible();
  await page.getByTestId('login-password').fill(password);
  await page.getByTestId('login-ok').click();
  await expect(page.getByTestId('login-dialog')).toHaveCount(0);
}

/** The designer reopens the base with Shift (B3: no AutoExec, the pane shown) and runs Database Tools › « Vers un serveur » up to
 *  the report: the engine, the login, the schema. Returns the backup's path. */
async function migrate(page: Page, kind: ServerKind, login: Login, schema: string, base: string): Promise<string> {
  await page.getByTestId('bs-recent-0').click({ modifiers: ['Shift'] });
  await expect(page.getByTestId('nav-pane')).toBeVisible();
  await page.getByTestId('ribbon-tab-databaseTools').click();
  await page.getByTestId('cmd-moveToServer').click();
  await page.getByTestId(`migrate-engine-${kind}`).check();
  await page.getByTestId('migrate-next').click();
  await page.getByTestId('srv-host').fill(login.host);
  await page.getByTestId('srv-port').fill(String(login.port));
  await page.getByTestId('srv-database').fill(login.database);
  await page.getByTestId('srv-user').fill(login.user);
  await page.getByTestId('srv-tls').selectOption(login.tls);
  await page.getByTestId('srv-password').fill(login.password);
  await page.getByTestId('srv-connect').click();
  await page.getByTestId('migrate-schema').fill(schema);
  await page.evaluate(() => { // every text the progress shows (a few rows per table: each shows for a moment only)
    const w = window as unknown as { seen: string[] };
    w.seen = [];
    new MutationObserver(() => {
      const p = document.querySelector('[data-testid="migrate-progress"] p');
      if (p?.textContent) w.seen.push(p.textContent);
    }).observe(document.body, { subtree: true, childList: true, characterData: true });
  });
  await page.getByTestId('migrate-start').click();
  const report = page.getByTestId('migrate-report');
  await expect(report).toBeVisible({ timeout: 60_000 });
  const seen = await page.evaluate(() => (window as unknown as { seen: string[] }).seen);
  for (const t of ['Clients', 'Commandes', 'Factures']) expect(seen.some((x) => x.startsWith(`Copie de ${t} : `)), t).toBe(true); // Journal is empty
  const backups = readdirSync(dirname(base)).filter((x) => x.startsWith('recette-b.backup-'));
  expect(backups).toHaveLength(1);
  const backup = join(dirname(base), backups[0]!);
  await expect(report).toContainText(fr.migrate.done.replace('{{backup}}', backup));
  for (const line of ['Clients : 4 enregistrement(s), prochain NuméroAuto : 5', 'Commandes : 5 enregistrement(s), prochain NuméroAuto : 6',
    'Journal : 0 enregistrement(s), prochain NuméroAuto : 1', 'ClientsCommandes : clé étrangère créée',
    `Commandes.Montant : ${fr.fieldProp.validationRule}`]) await expect(report).toContainText(line);
  await expect(report).not.toContainText(fr.migrate.report.queries); // every query, form and report runs on the server
  return backup;
}
/** After the report: the tables are links, the base is a front-end. */
async function migrated(page: Page) {
  await page.getByTestId('migrate-close').click();
  await expect(page.getByTestId('modal')).toHaveCount(0);
  for (const t of ['Clients', 'Commandes', 'Journal']) await expect(page.getByTestId(`nav-item-link-${t}`)).toBeVisible();
  await page.getByTestId('ribbon-tab-file').click();
  await openDbOptions(page);
  await expect(page.getByTestId('opt-db-frontend')).toBeChecked();
  await page.getByTestId('bs-back').click();
}

/** A Runtime workstation on the front-end of the share (its local copy, C3 R14), the file received (nothing trusted). */
const runtime = (base: string) => launchApp({ runtime: true, untrusted: true, args: [base], userDataDir: workstation(1),
  env: { ...FR, BASECRAFT_E2E_NETWORK_DIR: dirname(base) } });
/** The menu, AutoExec's RunSQL blocked (the bar), dismissed. */
async function opened(page: Page) {
  await expect(page.getByTestId('doc-tab-form-FMenu')).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByTestId('macro-failed-message')).toHaveText(fr.macro.error.blocked.replace('{{action}}', fr.macro.action.RunSQL));
  await page.getByTestId('macro-failed-stop').click();
  await expect(page.getByTestId('modal')).toHaveCount(0);
}
/** FMenu's button `name` clicked. */
async function menu(page: Page, name: string) {
  await page.getByTestId('doc-tab-form-FMenu').click();
  await vis(page, `form-ctl-${name}`).click();
}

/** A new order typed in FCommandes (the join) and not saved: AutoLookup shows the client's name. */
async function newOrder(page: Page, client: number, nom: string, montant: string) {
  await vis(page, 'nav-new').click();
  await ctl(page, 'Client').fill(String(client));
  await page.keyboard.press('Tab');
  await expect(ctl(page, 'Nom')).toHaveValue(nom);
  await ctl(page, 'Montant').fill(montant);
}
const save = async (page: Page) => {
  await ctl(page, 'Montant').press('Shift+Enter');
};
/** Steps 3 and 4 between workstations `a` and `b` on FCommandes (open on both, 5 orders); `orders()`: the server's N° > 5 as
 *  [N°, Client, Montant]; `montant(n)`: order n's Montant on the server. */
async function entryAndConflict(a: Page, b: Page, orders: () => Promise<number[][]>, montant: (n: number) => Promise<number>) {
  // 3. both type an order at once; A's Montant 0 is refused by the field's rule kept in the front-end (R5, R12), 2000 is cancelled
  //    by FCommandes' Before Update macro (B2), then both save: N° 6 and 7, each sees the other's after the refresh interval
  await newOrder(a, 3, 'Durand', '0');
  await newOrder(b, 4, 'Éric', '8');
  await save(a);
  await expect(a.getByTestId('modal')).toContainText(`« Montant » : ${fr.fieldError.validation.replace('{{rule}}', '> 0')}`);
  await a.getByTestId('modal-btn-ok').click();
  await ctl(a, 'Montant').fill('2000');
  await save(a);
  await expect(a.getByTestId('macro-msgbox-text')).toHaveText('Montant trop élevé');
  await a.getByTestId('macro-msgbox-ok').click();
  await expect(a.getByTestId('modal')).toHaveCount(0); // the macro's message only: the rule's earlier refusal is not shown again
  await expect(vis(a, 'form-dirty')).toBeVisible();
  expect(await orders()).toEqual([]);
  await ctl(a, 'Montant').fill('7');
  await save(a);
  await expect(vis(a, 'form-dirty')).toHaveCount(0);
  await save(b);
  await expect(vis(b, 'form-dirty')).toHaveCount(0);
  await expect.poll(orders).toEqual([[6, 3, 7], [7, 4, 8]]);
  await expect(count(a)).toHaveText('7', { timeout: 5000 });
  await expect(count(b)).toHaveText('7', { timeout: 5000 });

  // 4. a write conflict on order 1: A has 25 typed, B saves 20; A saves: « Conflit d'écriture », « Enregistrer l'enregistrement »
  for (const p of [a, b]) {
    await navButton(p, 'first').click();
    await expect(ctl(p, 'N°')).toHaveValue('1');
  }
  await ctl(a, 'Montant').fill('25');
  await ctl(b, 'Montant').fill('20');
  for (const [p, v] of [[a, '25'], [b, '20']] as const) await expect(ctl(p, 'Montant')).toHaveValue(v);
  await save(b);
  await expect.poll(() => montant(1)).toBe(20);
  await save(a);
  await expect(a.getByTestId('modal')).toContainText(fr.wc.title);
  await expect(a.getByTestId('write-conflict')).toContainText(fr.wc.message);
  await a.getByTestId('wc-save').click();
  await expect(vis(a, 'form-dirty')).toHaveCount(0);
  await expect.poll(() => montant(1)).toBe(25);
  await expect(ctl(b, 'Montant')).toHaveValue(/^25/, { timeout: 5000 });
}

test('stage C acceptance: the stage B application migrated to PostgreSQL by the wizard, two Runtime workstations entering data at once, a write conflict', async () => {
  test.skip(noLiveServer(), 'BASECRAFT_PG_TEST_URL is not set'); // fails on Linux CI without it (M7)
  test.setTimeout(420_000);
  const designer = workstation(1);
  const base = await buildStageBApp(designer);
  await withSchema(async (admin: Client, schema) => {
    const { params, login } = liveParams();
    const one = async <T>(sql: string) => Object.values((await admin.query(sql)).rows[0]!)[0] as T;
    const orders = async () => (await admin.query<{ n: number; c: number; m: number }>(
      `SELECT "N°" AS n, "Client" AS c, "Montant"::float AS m FROM "Commandes" WHERE "N°" > 5 ORDER BY 1`)).rows.map((r) => [r.n, r.c, r.m]);
    const montant = async (n: number) => one<number>(`SELECT "Montant"::float FROM "Commandes" WHERE "N°" = ${n}`);

    // 1. the designer, in the full application: the wizard moves every table; the report, the backup, the links, the front-end
    const d = await launchApp({ env: FR, userDataDir: designer });
    try {
      await migrate(d.page, 'postgresql', { ...params, password: login.password }, schema, base);
      await migrated(d.page);
    } finally {
      await d.app.close();
    }
    expect([await one<number>(`SELECT count(*)::int FROM "Clients"`), await one<number>(`SELECT count(*)::int FROM "Commandes"`),
      await one<number>(`SELECT count(*)::int FROM "Journal"`)]).toEqual([4, 5, 0]);
    expect(await one<string>(`SELECT string_agg(conname, ',') FROM pg_constraint WHERE contype = 'f' AND conrelid = '"Commandes"'::regclass`))
      .toBe('ClientsCommandes');
    const seq = await one<string>(`SELECT pg_get_serial_sequence('"Commandes"', 'N°')`);
    expect((await admin.query(`SELECT last_value::int AS v, is_called FROM ${seq}`)).rows[0]).toEqual({ v: 6, is_called: false });

    // 2. two Runtime workstations, each its local copy and its own login: « Activer le contenu » runs AutoExec again, its RunSQL
    //    writes Journal's row on the server (R14)
    let a: App | null = null, b: App | null = null;
    try {
      a = await runtime(base);
      b = await runtime(base);
      for (const [i, x] of [a, b].entries()) {
        await expect.poll(() => x.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.getTitle())).toBe(TITLE);
        await opened(x.page);
        await x.page.getByTestId('banner-enable-content').click();
        await x.page.getByTestId('modal-btn-yes').click(); // RunSQL's own question (warnings on)
        await logIn(x.page, login.password);
        await expect(x.page.getByTestId('banner-content')).toHaveCount(0);
        await expect.poll(() => one<number>(`SELECT count(*)::int FROM "Journal"`)).toBe(i + 1);
      }

      // 3, 4. FCommandes on both: entry at the same time, the rule and the macro, then a write conflict (xmin)
      for (const x of [a, b]) {
        await menu(x.page, 'cmdCommandes');
        await expect(x.page.getByTestId('doc-tab-form-FCommandes')).toHaveAttribute('aria-selected', 'true');
        await expect(count(x.page)).toHaveText('5');
      }
      await entryAndConflict(a.page, b.page, orders, montant);

      // 5. the rest of the application: « Ventes » opens the crosstab QVentes, read from the server (R15); « Aperçu des factures »
      await menu(a.page, 'cmdVentes');
      await expect(a.page.getByTestId('doc-tab-query-QVentes')).toHaveAttribute('aria-selected', 'true');
      const crosstab = await queryRows(a.page, 'QVentes');
      expect(crosstab.map((r) => r[0]).sort()).toEqual(['Dupont', 'Durand', 'Martin', 'Éric']);
      const durand = crosstab.find((r) => r[0] === 'Durand')!.slice(1).filter((v) => v !== null);
      expect(durand.map((v) => Math.round((v as number) * 100))).toEqual([9999 + 700]);
      await expect(count(a.page)).toHaveText('4');
      await a.page.getByTestId('doc-tab-close-query-QVentes').click();
      await menu(a.page, 'cmdApercu');
      await expect(a.page.getByTestId(`doc-tab-report-${REPORT}`)).toHaveAttribute('aria-selected', 'true');
      const model = await layoutFromDom(a.page);
      const footer = model.pages.flatMap((p) => p.bands.filter((x) => x.section === 'reportFooter').map((x) => x.lines.map((l) => loose(l[0]))));
      const cents = FACTURES_ROWS.reduce((n, r) => n + Math.round((r[4] as number) * 100), 0);
      expect(footer).toEqual([[String(FACTURES_ROWS.length), money(cents)]]);
    } finally {
      await b?.app.close();
      await a?.app.close();
    }
  });
});

test('stage C acceptance on SQL Server: the stage B application migrated by the wizard (bc_rowversion), the full application and a Runtime entering data, a rowversion conflict', async () => {
  test.skip(noLiveMssql(), 'BASECRAFT_MSSQL_TEST_URL is not set'); // fails on Linux CI without it
  test.setTimeout(420_000);
  const designer = workstation(1);
  const base = await buildStageBApp(designer);
  const { params: url, login } = mssqlLive();
  await withDatabase(async (admin, database) => {
    const one = async (sql: string) => (await admin.query(sql))[0]![0];
    const orders = async () => (await admin.query(`SELECT [N°], Client, CAST(Montant AS float) FROM Commandes WHERE [N°] > 5 ORDER BY 1`)) as number[][];
    const montant = async (n: number) => Number(await one(`SELECT CAST(Montant AS float) FROM Commandes WHERE [N°] = ${n}`));

    // 1. the wizard to the database's dbo: the report names each table's rowversion column
    const a = await launchApp({ env: FR, userDataDir: designer });
    let b: App | null = null;
    try {
      await migrate(a.page, 'sqlserver', { ...url, database, password: login.password }, 'dbo', base);
      for (const t of ['Clients', 'Commandes', 'Journal']) await expect(a.page.getByTestId('migrate-report')).toContainText(`${t} : `);
      await expect(a.page.getByTestId('migrate-report')).toContainText('Commandes : 5 enregistrement(s), prochain NuméroAuto : 6, colonne de version : bc_rowversion');
      await migrated(a.page);
      expect(await one(`SELECT COUNT(*) FROM Commandes`)).toBe(5);
      expect(await one(`SELECT name FROM sys.foreign_keys WHERE parent_object_id = OBJECT_ID('Commandes')`)).toBe('ClientsCommandes');

      // 2. A: the full application, FCommandes from the pane (the wizard's login is the link's); B: a Runtime, content disabled
      await a.page.getByTestId('nav-item-form-FCommandes').dblclick();
      await expect(count(a.page)).toHaveText('5');
      b = await runtime(base);
      await opened(b.page);
      await menu(b.page, 'cmdCommandes');
      await logIn(b.page, login.password);
      await expect(count(b.page)).toHaveText('5');

      // 3, 4. entry at the same time, then a write conflict found on bc_rowversion
      await entryAndConflict(a.page, b.page, orders, montant);
    } finally {
      await b?.app.close();
      await a.app.close();
    }
  });
});
