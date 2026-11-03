// Recette du lot C6 (requêtes SQL direct, PostgreSQL), sur le serveur de BASECRAFT_PG_TEST_URL (sans lui : ignorée). Le test crée
// sa propre base de données, supprimée à la fin. Le front-end n'a aucune table liée (R3) ; son état RVilles repose sur PVilles.
// Le passage sur un vrai serveur TLS et deux vraies machines est la validation manuelle du propriétaire
// (2026-10-31-basecraft-c6-validation-manuelle.md).
import { test, expect, type Page } from '@playwright/test';
import { randomBytes } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import pg, { type Client } from 'pg';
import { addServerLinks } from '../../src/main/links/store';
import { saveObject } from '../../src/main/db/objects';
import { openPg, pgConfig } from '../../src/main/connectors/postgres/driver';
import { liveParams, noLiveServer } from '../../src/main/connectors/postgres/live';
import type { PgParams } from '../../src/main/connectors/postgres/params';
import type { DesignDoc } from '../../src/shared/design/model';
import { inFile, launchApp, layoutFromDom, seedBase } from './helpers';

const fr = JSON.parse(readFileSync(join(__dirname, '../../src/shared/i18n/fr.json'), 'utf8'));
const ENV = { BASECRAFT_REGION: 'fr-FR' };

// The C3 clients, on the server.
const SEED = `CREATE TABLE "Clients" ("N°" serial PRIMARY KEY, "Nom" varchar(80) NOT NULL, "Ville" varchar(80));
INSERT INTO "Clients" ("Nom", "Ville") VALUES ('Dupont', 'Lyon'), ('Martin', 'LYON'), ('Durand', 'Paris'), ('Éric', 'Lyôn')`;
// string_agg is outside C4's closed list: the same text as a select query is refused, so the function is the server's.
const VILLES = `SELECT initcap(lower("Ville")) AS "Ville", string_agg("Nom", ', ' ORDER BY "Nom") AS "Noms", count(*) AS "Nombre" FROM "Clients" GROUP BY 1`;
const MAJ = `UPDATE "Clients" SET "Ville" = 'Lyon' WHERE "Nom" = 'Durand'`;
const text = (n: string, left: number, source: string) => ({ kind: 'textBox' as const, name: n, left, top: 0, width: 3800, height: 300, props: { ControlSource: source, BorderStyle: 'transparent' } });
const RVILLES: DesignDoc = {
  formatVersion: '1.0', recordSource: { kind: 'query', name: 'PVilles' }, props: { Width: 9072, grouping: [{ expression: 'Ville', order: 'asc', header: true, footer: false, keepTogether: 'no' }] },
  sections: [
    { kind: 'groupHeader', groupLevel: 0, height: 340, props: {}, controls: [text('Ville', 0, 'Ville')] },
    { kind: 'detail', height: 340, props: {}, controls: [text('Noms', 0, 'Noms'), text('Nombre', 4200, 'Nombre')] },
  ],
};

type Live = { admin: Client; db: Client; params: PgParams; password: string; durand: () => Promise<string> };
/** `fn` with a new database `bcrecette_<hex>` of the live server, seeded, dropped afterwards (as recette-c4). */
async function withDatabase(fn: (x: Live) => Promise<void>): Promise<void> {
  const { params: url, login } = liveParams();
  const client = (p: PgParams) => new pg.Client({ ...pgConfig(p, login), application_name: 'BaseCraft tests' });
  const admin = client(url);
  await admin.connect();
  const name = `bcrecette_${randomBytes(4).toString('hex')}`;
  await admin.query(`CREATE DATABASE ${name}`);
  const params = { ...url, database: name };
  const db = client(params);
  try {
    await db.connect();
    await db.query(SEED);
    const durand = async () => (await db.query<{ Ville: string }>(`SELECT "Ville" FROM "Clients" WHERE "Nom" = 'Durand'`)).rows[0]!.Ville;
    await fn({ admin, db, params, password: login.password, durand });
  } finally {
    await db.end().catch(() => {});
    await admin.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`).finally(() => admin.end());
  }
}

const doc = (page: Page) => page.locator('section[role=tabpanel]:not([hidden])');
/** The login prompt answered. */
async function logIn(page: Page, password: string) {
  await expect(page.getByTestId('login-dialog')).toBeVisible();
  await page.getByTestId('login-password').fill(password);
  await page.getByTestId('login-ok').click();
  await expect(page.getByTestId('login-dialog')).toHaveCount(0);
}
/** Create › Query Design › SQL direct, « Autre serveur… » (password typed, « Mémoriser » unticked), the text, Returns Records,
 *  saved as `name`. */
async function passThrough(page: Page, name: string, sql: string, params: PgParams, password: string, returnsRecords: boolean) {
  await page.getByTestId('ribbon-tab-create').click();
  await page.getByTestId('cmd-createQueryDesign').click();
  await page.getByTestId('show-table-close').click();
  await page.getByTestId('cmd-passThroughQuery').click();
  await page.getByTestId('pt-props-connection').selectOption({ label: fr.query.passThrough.otherServerKind.replace('{{product}}', 'PostgreSQL') });
  await page.getByTestId('srv-host').fill(params.host);
  await page.getByTestId('srv-port').fill(String(params.port));
  await page.getByTestId('srv-database').fill(params.database);
  await page.getByTestId('srv-user').fill(params.user);
  await page.getByTestId('srv-tls').selectOption(params.tls);
  await page.getByTestId('srv-password').fill(password);
  if (await page.getByTestId('srv-remember').isEnabled()) await page.getByTestId('srv-remember').uncheck();
  await page.getByTestId('srv-connect').click();
  await expect(page.getByTestId('pt-props')).toBeVisible();
  await page.getByTestId('pt-props-returnsRecords').selectOption({ label: returnsRecords ? fr.dialog.button.yes : fr.dialog.button.no });
  await page.getByTestId('pt-props-ok').click();
  await expect(page.getByTestId('pt-props')).toHaveCount(0);
  await doc(page).getByTestId('query-sql').fill(sql);
  await page.keyboard.press('Control+s');
  await page.getByTestId('modal-input').fill(name);
  await page.getByTestId('modal-btn-ok').click();
  await expect(page.getByTestId(`nav-item-query-${name}`)).toBeVisible();
  await expect(page.getByTestId(`doc-tab-query-${name}`)).not.toContainText('•');
  await page.getByTestId(`doc-tab-close-query-${name}`).click();
}
/** The text of the printed pages of the open report. */
async function reportText(page: Page): Promise<string> {
  return (await layoutFromDom(page)).pages.flatMap((pg) => pg.bands.flatMap((b) => b.lines.map((l) => l[0]))).join(' | ');
}

test('C6 acceptance: a pass-through with server-only functions feeds a report; the UPDATE one is blocked in disabled mode and runs after « Activer le contenu »; Stop', async () => {
  test.skip(noLiveServer(), 'BASECRAFT_PG_TEST_URL is not set'); // fails on Linux CI without it
  test.setTimeout(300_000);
  await withDatabase(async ({ admin, params, password, durand }) => {
    // no linked table: a pass-through needs none (R3); the report on PVilles is seeded
    const front = seedBase('Ventes', (fe) => {
      const r = saveObject(fe, 'report', 'RVilles', RVILLES, null);
      if (!r.ok) throw new Error(r.reason);
    });
    const userData = mkdtempSync(join(tmpdir(), 'basecraft-'));
    let a = await launchApp({ args: [front], userDataDir: userData, env: ENV });
    try {
      // 1. Created through the designer; the file holds no password
      await passThrough(a.page, 'PVilles', VILLES, params, password, true);
      await passThrough(a.page, 'UMaj', MAJ, params, password, false);
      await a.app.close();
      // no query definition has a password key; the password text is searched for only when it cannot be a substring of the
      // user, host or database stored with the connection (CI's login and password are both « basecraft »)
      const defs = inFile<{ definition: string }>(front, `SELECT definition FROM bc_objects WHERE kind = 'query'`).map((r) => r.definition);
      expect(defs).toHaveLength(2);
      for (const d of defs) expect(JSON.stringify(JSON.parse(d)).toLowerCase()).not.toContain('password');
      if ([params.user, params.host, params.database].some((v) => v.includes(password))) {
        test.info().annotations.push({ type: 'password text', description: 'not searched: the password is part of the user, host or database' });
      } else for (const f of [front, `${front}-wal`]) if (existsSync(f)) expect(readFileSync(f).toString('latin1')).not.toContain(password);
      // string_agg is the server's: the same text as a select query on a linked Clients is refused as an unknown function
      const conn = await openPg(params, liveParams().login);
      const tables = (await conn.tables()).filter((t) => t.name === 'Clients');
      await conn.close();
      const linked = seedBase('Lien', (fe) => addServerLinks(fe, 'postgresql', params, tables));
      const l = await launchApp({ args: [linked], env: ENV });
      try {
        await l.page.getByTestId('ribbon-tab-create').click();
        await l.page.getByTestId('cmd-createQueryDesign').click();
        await l.page.getByTestId('show-table-close').click();
        await l.page.getByTestId('status-view-sql').click();
        await doc(l.page).getByTestId('query-sql').fill('SELECT string_agg(Nom, ", ") FROM Clients');
        await l.page.keyboard.press('Control+s'); // the error is raised on save
        await expect(doc(l.page).getByTestId('query-sql-error')).toHaveText(fr.expr.error.unknownFunction); // « Fonction inconnue. »: the text cannot be saved as a select query
      } finally {
        await l.app.close();
      }

      // 2. Disabled mode: UMaj blocked, RVilles (returns records) opens; nothing reached the server
      const stats = async () => {
        try {
          return (await admin.query<{ query: string; calls: string }>(`SELECT query, calls::text FROM pg_stat_statements
            WHERE dbid = (SELECT oid FROM pg_database WHERE datname = $1)`, [params.database])).rows;
        } catch {
          return null; // the extension is absent: the manual validation checks the server log
        }
      };
      const updates = async () => (await stats())?.filter((r) => /^\s*UPDATE\s+"Clients"/i.test(r.query)).map((r) => r.query);
      a = await launchApp({ args: [front], env: ENV, untrusted: true }); // a workstation that trusts nothing
      await expect(a.page.getByTestId('banner-content')).toBeVisible();
      const before = await updates();
      await a.page.getByTestId('nav-item-query-UMaj').dblclick();
      await expect(a.page.getByTestId('modal')).toContainText(fr.query.action.contentDisabled);
      await a.page.getByTestId('modal-btn-ok').click();
      await a.page.getByTestId('nav-item-report-RVilles').dblclick();
      await logIn(a.page, password); // the first read of this server in the session
      await expect.poll(() => reportText(a.page)).toMatch(/Lyon.*Dupont, Martin.*Lyôn.*Éric.*Paris.*Durand/s);
      expect(await durand()).toBe('Paris');
      if (before === undefined) test.info().annotations.push({ type: 'pg_stat_statements', description: 'absent: no UPDATE on the server is checked in the server log (manual validation); Durand still Paris is checked' });
      else expect(await updates()).toEqual(before);
      await a.page.getByTestId('doc-tab-close-report-RVilles').click();

      // 3. « Activer le contenu »: the same report (the key's login is asked once)
      await a.page.getByTestId('banner-enable-content').click();
      await expect(a.page.getByTestId('banner-content')).toHaveCount(0);
      await a.page.getByTestId('nav-item-report-RVilles').dblclick();
      await expect.poll(() => reportText(a.page)).toMatch(/Lyon.*Dupont, Martin.*2.*Lyôn.*Éric.*1.*Paris.*Durand.*1/s);
      await a.page.getByTestId('doc-tab-close-report-RVilles').click();

      // 4. The UPDATE runs: no question, no error; the server holds Lyon for Durand; the report follows
      await a.page.getByTestId('nav-item-query-UMaj').dblclick();
      await expect.poll(durand).toBe('Lyon');
      await expect(a.page.getByTestId('modal')).toHaveCount(0);
      await a.page.getByTestId('nav-item-report-RVilles').dblclick();
      await expect.poll(() => reportText(a.page)).toMatch(/Dupont, Durand, Martin/);
      expect(await reportText(a.page)).not.toContain('Paris');
      await a.page.getByTestId('doc-tab-close-report-RVilles').click();

      // 5. Stop: pg_sleep(60) as a datasheet; Stop cancels it on the server, the data process stays
      await a.app.close();
      a = await launchApp({ args: [front], userDataDir: userData, env: ENV });
      await passThrough(a.page, 'PSleep', 'SELECT pg_sleep(60)', params, password, true);
      const pid = () => JSON.parse(readFileSync(`${front}.lock`, 'utf8')).pid as number;
      const dataProcess = pid();
      await a.page.getByTestId('nav-item-query-PSleep').dblclick();
      await expect(a.page.getByTestId('running-notice')).toContainText(fr.query.run.running);
      await a.page.getByTestId('query-cancel').click();
      await expect(a.page.getByTestId('modal')).toContainText(fr.dialog.error.cancelled);
      await a.page.getByTestId('modal-btn-ok').click();
      await expect(a.page.getByTestId('running-notice')).toHaveCount(0);
      expect(pid()).toBe(dataProcess);
      await expect.poll(async () => (await admin.query(`SELECT 1 FROM pg_stat_activity WHERE datname = $1 AND application_name = 'BaseCraft'
        AND state <> 'idle' AND query LIKE '%pg_sleep%'`, [params.database])).rowCount).toBe(0);
    } finally {
      await a.app.close().catch(() => {});
    }
  });
});
