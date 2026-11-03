// Recette du lot C4 (tables liées PostgreSQL), sur le serveur de BASECRAFT_PG_TEST_URL (sans lui : ignorée). Le test crée sa propre
// base de données (ses tables dans public : les liens portent leur nom), supprimée à la fin. Deux postes simulés par deux instances
// sur une machine : A (application complète) et B (Runtime, sa copie locale de l'application frontale : BASECRAFT_E2E_NETWORK_DIR),
// chacun son dossier de données utilisateur. Le passage sur un vrai serveur TLS et deux vraies machines est la validation manuelle
// du propriétaire (2026-10-30-basecraft-c4-validation-manuelle.md).
import { test, expect, type Page } from '@playwright/test';
import { randomBytes } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import pg, { type Client } from 'pg';
import type { BasecraftApi } from '../../src/shared/api';
import { addServerLinks } from '../../src/main/links/store';
import { saveStartupOptions, startupOptions } from '../../src/main/db/startup';
import { openPg, pgConfig } from '../../src/main/connectors/postgres/driver';
import { liveParams, noLiveServer } from '../../src/main/connectors/postgres/live';
import type { PgParams } from '../../src/main/connectors/postgres/params';
import { launchApp, seedBase } from './helpers';

type Win = { basecraft: BasecraftApi };
type App = Awaited<ReturnType<typeof launchApp>>;
const fr = JSON.parse(readFileSync(join(__dirname, '../../src/shared/i18n/fr.json'), 'utf8'));
const ENV = { BASECRAFT_REGION: 'fr-FR' };
// DatasheetView: row selector, header and row heights; N° (serial: AutoNumber) 80 px, Nom and Ville (varchar: Short Text) 170.
const MARKER = 44, HEADER = 34, ROW = 30, AUTONUMBER = 80, TEXT = 170;

// The C3 clients and orders, on the server.
const SEED = `CREATE TABLE "Clients" ("N°" serial PRIMARY KEY, "Nom" varchar(80) NOT NULL, "Ville" varchar(80));
INSERT INTO "Clients" ("Nom", "Ville") VALUES ('Dupont', 'Lyon'), ('Martin', 'LYON'), ('Durand', 'Paris'), ('Éric', 'Lyôn');
CREATE TABLE "Commandes" ("N°" serial PRIMARY KEY, "Client" int REFERENCES "Clients", "Montant" numeric(19, 4), "Le" timestamp);
INSERT INTO "Commandes" ("Client", "Montant", "Le") VALUES (1, 10.1, '2026-10-01'), (1, 0.1, '2026-10-05'), (2, 0.2, '2026-10-21'),
  (3, 99.99, '2026-09-30'), (2, 0.1, '2026-10-21')`;

type Live = { admin: Client; db: Client; params: PgParams; password: string; durand: () => Promise<string> };
/** `fn` with a new database `bcrecette_<hex>` of the live server, seeded, dropped afterwards. `db`: the test's own connection to
 *  it (the other writer, the lock); `admin`: on the URL's database (where pg_stat_statements is read). */
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

/** A workstation's user data; `refreshInterval` in seconds. */
function workstation(refreshInterval: number): string {
  const d = mkdtempSync(join(tmpdir(), 'basecraft-'));
  writeFileSync(join(d, 'settings.json'), JSON.stringify({ refreshInterval }));
  return d;
}
/** G2: « Mémoriser » is offered only where safeStorage has a keyring (Linux: not basic_text / unknown). */
const canRemember = (x: App) => x.app.evaluate(({ safeStorage }) => safeStorage.isEncryptionAvailable()
  && (process.platform !== 'linux' || !['basic_text', 'unknown'].includes(safeStorage.getSelectedStorageBackend())));

const sheet = (page: Page) => page.getByTestId('datasheet').filter({ visible: true });
const cell = (page: Page, col: number, row: number) => sheet(page).getByTestId(`glide-cell-${col + 1}-${row}`);
const count = (page: Page) => page.getByTestId('nav-record-count').filter({ visible: true });
const dirty = (page: Page) => page.getByTestId('doc-tab-Clients');
const ctl = (page: Page, n: string) => page.getByTestId(`form-ctl-${n}`).filter({ visible: true });
const at = async (page: Page, col: 1 | 2, row: number) => {
  const b = (await sheet(page).getByTestId('data-grid-canvas').boundingBox())!;
  await page.mouse.click(b.x + MARKER + AUTONUMBER + (col - 1) * TEXT + 30, b.y + HEADER + row * ROW + ROW / 2);
};
/** Types in a Ville cell. `leave`: Enter, the next row (saved); else Shift+Tab, the row stays pending. */
async function typeVille(page: Page, row: number, text: string, leave: boolean) {
  await at(page, 2, row);
  await expect(cell(page, 2, row)).toBeFocused();
  await page.keyboard.press(text[0]!);
  await page.keyboard.type(text.slice(1));
  await page.keyboard.press(leave ? 'Enter' : 'Shift+Tab');
  await expect(page.getByTestId('grid-editor-portal').locator('textarea')).toHaveCount(0);
  await expect(dirty(page)).toHaveText(leave ? /^[^•]*$/ : /•/);
}
/** The login prompt answered (asked once per workstation and session without a remembered password). */
async function logIn(page: Page, password: string) {
  await expect(page.getByTestId('login-dialog')).toBeVisible();
  await page.getByTestId('login-password').fill(password);
  await page.getByTestId('login-ok').click();
  await expect(page.getByTestId('login-dialog')).toHaveCount(0);
}
/** A new query written in SQL view (Create › Query Design, no table added), saved as `name` (Ctrl+S). */
async function sqlQuery(page: Page, name: string, sql: string) {
  await page.getByTestId('ribbon-tab-create').click();
  await page.getByTestId('cmd-createQueryDesign').click();
  await page.getByTestId('show-table-close').click();
  await page.getByTestId('status-view-sql').click();
  await page.locator('section[role=tabpanel]:not([hidden])').getByTestId('query-sql').fill(sql);
  await page.keyboard.press('Control+s');
  await page.getByTestId('modal-input').fill(name);
  await page.getByTestId('modal-btn-ok').click();
  await expect(page.getByTestId(`nav-item-query-${name}`)).toBeVisible();
  await expect(page.getByTestId(`doc-tab-query-${name}`)).not.toContainText('•');
}

test('C4 acceptance: link PostgreSQL tables, a parameter query on the server, a form edit, a write conflict, a refused function, Stop', async () => {
  test.skip(noLiveServer(), 'BASECRAFT_PG_TEST_URL is not set'); // fails on Linux CI without it (M7)
  test.setTimeout(300_000);
  await withDatabase(async ({ admin, db, params, password, durand }) => {
    // no tables; a front-end (as Split marks one): the Runtime opens it from its local copy, never read-only behind A's lock
    const front = seedBase('Ventes', (db) => saveStartupOptions(db, { ...startupOptions(db), frontEnd: true }));
    const userA = workstation(1);
    let a = await launchApp({ args: [front], userDataDir: userA, env: ENV });
    let b: App | null = null;
    try {
      // 1. External Data › PostgreSQL: « Mémoriser » ticked, Clients and Commandes linked; after a restart no prompt (G2: asked
      //    again where there is no keyring); the password never in clear in credentials.json
      const remember = await canRemember(a);
      await a.page.getByTestId('ribbon-tab-externalData').click();
      await a.page.getByTestId('cmd-linkPostgreSql').click();
      await a.page.getByTestId('srv-host').fill(params.host);
      await a.page.getByTestId('srv-port').fill(String(params.port));
      await a.page.getByTestId('srv-database').fill(params.database);
      await a.page.getByTestId('srv-user').fill(params.user);
      await a.page.getByTestId('srv-tls').selectOption(params.tls);
      await a.page.getByTestId('srv-password').fill(password);
      if (remember) await expect(a.page.getByTestId('srv-remember')).toBeChecked();
      else await expect(a.page.getByTestId('srv-remember')).toBeDisabled();
      await a.page.getByTestId('srv-connect').click();
      await a.page.getByTestId('link-table-Clients').check();
      await a.page.getByTestId('link-table-Commandes').check();
      await a.page.getByTestId('link-ok').click();
      await expect(a.page.getByTestId('nav-item-link-Clients')).toBeVisible();
      await expect(a.page.getByTestId('nav-item-link-Commandes')).toBeVisible();
      await a.app.close();

      const file = join(userA, 'credentials.json');
      if (remember) {
        const stored = Object.values(JSON.parse(readFileSync(file, 'utf8')) as Record<string, { user: string; password: string }>);
        expect(stored).toEqual([{ user: params.user, password: expect.any(String) }]);
        expect(stored[0]!.password).not.toContain(password);
        expect(Buffer.from(stored[0]!.password, 'base64').toString('latin1')).not.toContain(password);
      } else expect(existsSync(file)).toBe(false);

      a = await launchApp({ args: [front], userDataDir: userA, env: ENV });
      await a.page.getByTestId('nav-item-Clients').dblclick();
      if (!remember) await logIn(a.page, password);
      await expect(count(a.page)).toHaveText('4');
      await expect(cell(a.page, 1, 2)).toHaveText('Durand');
      await expect(a.page.getByTestId('login-dialog')).toHaveCount(0);

      // 2. QVille runs on the server: its statement, with $1, in pg_stat_statements (read by the test's own connection)
      const stats = async () => {
        try {
          return (await admin.query<{ queryid: string; calls: string; query: string }>(`SELECT queryid::text, calls::text, query FROM pg_stat_statements
            WHERE dbid = (SELECT oid FROM pg_database WHERE datname = $1)`, [params.database])).rows;
        } catch {
          return null; // the extension is absent: the manual validation checks the server log
        }
      };
      await sqlQuery(a.page, 'QVille', 'PARAMETERS [Ville ?] Text; SELECT Nom FROM Clients WHERE Ville = [Ville ?]');
      await a.page.getByTestId('doc-tab-close-query-QVille').click();
      const before = new Map((await stats())?.map((r) => [r.queryid, Number(r.calls)]));
      await a.page.getByTestId('nav-item-query-QVille').dblclick();
      await expect(a.page.getByTestId('modal')).toContainText('Ville ?');
      await a.page.getByTestId('modal-input').fill('lyon');
      await a.page.getByTestId('modal-btn-ok').click();
      await expect(count(a.page)).toHaveText('2');
      expect([await cell(a.page, 0, 0).textContent(), await cell(a.page, 0, 1).textContent()].sort()).toEqual(['Dupont', 'Martin']);
      const after = await stats();
      if (after === null) test.info().annotations.push({ type: 'pg_stat_statements', description: 'absent: step 2 is checked in the server log (manual validation)' });
      else {
        // QVille's criterion evaluated by the server, on Clients.Ville. pg_stat_statements shows every constant as $n, so the $1
        // proves the WHERE ran on the server, not that the value was bound: the manual checklist checks the binding.
        const ran = after.filter((r) => Number(r.calls) > (before.get(r.queryid) ?? 0) && /FROM "public"\."Clients" .*WHERE .*"Ville".*\$1/s.test(r.query));
        expect(ran.map((r) => r.query), JSON.stringify(after.map((r) => r.query))).not.toEqual([]);
      }
      await a.page.getByTestId('doc-tab-close-query-QVille').click();

      // 3. AutoForm on Clients: Durand's Ville « Lille », next record: saved on the server
      await a.page.getByTestId('nav-item-Clients').click();
      await a.page.getByTestId('ribbon-tab-create').click();
      await a.page.getByTestId('cmd-createForm').click();
      await expect(a.page.getByTestId('doc-tab-form-Clients')).toHaveAttribute('aria-selected', 'true');
      await expect(ctl(a.page, 'Nom')).toHaveValue('Dupont');
      const next = () => a.page.getByTestId('form-run').filter({ visible: true }).getByRole('button', { name: fr.datasheet.nav.next }).click();
      await next();
      await next();
      await expect(ctl(a.page, 'Nom')).toHaveValue('Durand');
      await ctl(a.page, 'Ville').fill('Lille');
      await next();
      await expect(ctl(a.page, 'Nom')).toHaveValue('Éric');
      await expect(a.page.getByTestId('form-dirty').filter({ visible: true })).toHaveCount(0);
      await expect.poll(durand).toBe('Lille');
      await a.page.getByTestId('doc-tab-close-form-Clients').click();

      // 4. Write conflict: B (the Runtime, its own userData: its own login) and A on Durand's Ville
      b = await launchApp({ runtime: true, args: [front], userDataDir: workstation(1), env: { ...ENV, BASECRAFT_E2E_NETWORK_DIR: dirname(front) } });
      await b.page.getByTestId('nav-item-Clients').dblclick();
      await logIn(b.page, password);
      await expect(cell(b.page, 2, 2)).toHaveText('Lille');
      await a.page.getByTestId('doc-tab-Clients').click();
      await expect(cell(a.page, 2, 2)).toHaveText('Lille', { timeout: 5000 });
      const conflict = async (mine: string, other: string) => {
        await typeVille(a.page, 2, mine, false);
        await typeVille(b!.page, 2, other, true);
        await expect.poll(durand).toBe(other);
        await a.page.keyboard.press('ArrowDown');
        await expect(a.page.getByTestId('write-conflict')).toContainText(fr.wc.message);
      };
      await conflict('Brest', 'Rennes');
      await a.page.getByTestId('wc-drop').click();
      await expect(cell(a.page, 2, 2)).toHaveText('Rennes');
      await expect(dirty(a.page)).not.toContainText('•');
      expect(await durand()).toBe('Rennes');

      await conflict('Brest', 'Vannes');
      await a.page.getByTestId('wc-save').click();
      await expect(dirty(a.page)).not.toContainText('•');
      await expect.poll(durand).toBe('Brest');
      await expect(cell(b.page, 2, 2)).toHaveText('Brest', { timeout: 5000 });
      await b.app.close();
      b = null;

      // 5. Format is outside the closed list: refused with its message, nothing sent to the server
      await sqlQuery(a.page, 'QFormat', 'SELECT Format(Nom, ">") FROM Clients');
      await a.page.getByTestId('cmd-runQuery').click();
      await expect(a.page.getByTestId('modal')).toContainText(fr.dialog.error.serverFunction.replace('{{name}}', 'Format').replace('{{detail}}', 'PostgreSQL'));
      await a.page.getByTestId('modal-btn-ok').click();
      expect((await stats())?.filter((r) => /\bformat\s*\(/i.test(r.query)).map((r) => r.query) ?? []).toEqual([]); // not format_type( of the catalog

      // 6. Stop: Commandes locked by the test; its datasheet waits (« Exécution… »), Stop cancels it on the server; the window
      //    goes on (Clients still pages) in the same data process (the front-end's lock names it)
      const pid = () => JSON.parse(readFileSync(`${front}.lock`, 'utf8')).pid as number;
      const dataProcess = pid();
      await db.query('BEGIN');
      try {
        await db.query('LOCK TABLE "Commandes" IN ACCESS EXCLUSIVE MODE');
        await a.page.getByTestId('nav-item-Commandes').dblclick();
        await expect(a.page.getByTestId('running-notice')).toContainText(fr.query.run.running);
        await a.page.getByTestId('query-cancel').click();
        await expect(a.page.getByTestId('modal')).toContainText(fr.dialog.error.cancelled);
        await a.page.getByTestId('modal-btn-ok').click();
        await expect(a.page.getByTestId('running-notice')).toHaveCount(0);
      } finally {
        await db.query('ROLLBACK');
      }
      await a.page.getByTestId('nav-item-Clients').dblclick();
      await expect(cell(a.page, 1, 3)).toHaveText('Éric');
      const page = await a.page.evaluate(() => (window as unknown as Win).basecraft.rows.page('Clients', { offset: 2, limit: 2 }));
      expect(page.rows.map((r) => r.values)).toEqual([[3, 'Durand', 'Brest'], [4, 'Éric', 'Lyôn']]);
      expect(pid()).toBe(dataProcess);
    } finally {
      await b?.app.close();
      await a.app.close();
    }
  });
});

test('C4 write conflict on a server: Drop Changes and Copy to Clipboard take the row\'s current reference (its next save is no conflict)', async () => {
  test.skip(noLiveServer(), 'BASECRAFT_PG_TEST_URL is not set'); // fails on Linux CI without it (M7)
  test.setTimeout(180_000);
  await withDatabase(async ({ db, params, password, durand }) => {
    const { login } = liveParams();
    const conn = await openPg(params, login);
    const tables = (await conn.tables()).filter((t) => t.name === 'Clients');
    await conn.close();
    const front = seedBase('Ventes', (fe) => addServerLinks(fe, 'postgresql', params, tables));
    // the datasheet never reads the rows again by itself here: only the conflict's answer can give the row its new reference
    const { app, page } = await launchApp({ args: [front], userDataDir: workstation(32766), env: ENV });
    try {
      await page.getByTestId('nav-item-Clients').dblclick();
      await logIn(page, password);
      await expect(cell(page, 2, 2)).toHaveText('Paris');
      /** A pending Ville, the other writer's, then the row left: the Write Conflict dialog. */
      const conflict = async (mine: string, other: string) => {
        await typeVille(page, 2, mine, false);
        await db.query(`UPDATE "Clients" SET "Ville" = $1 WHERE "Nom" = 'Durand'`, [other]);
        await page.keyboard.press('ArrowDown');
        await expect(page.getByTestId('write-conflict')).toContainText(fr.wc.message);
      };
      for (const [choice, other, next] of [['wc-drop', 'Rennes', 'Brest'], ['wc-copy', 'Vannes', 'Nice']] as const) {
        await conflict('Lille', other);
        await page.getByTestId(choice).click();
        await expect(cell(page, 2, 2)).toHaveText(other);
        await typeVille(page, 2, next, true); // saved at once: the row's reference is the server's current one
        await expect.poll(durand).toBe(next);
        await expect(page.getByTestId('write-conflict')).toHaveCount(0);
      }
    } finally {
      await app.close();
    }
  });
});
