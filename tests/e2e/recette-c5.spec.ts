// Recette du lot C5 (tables liées SQL Server), sur le serveur de BASECRAFT_MSSQL_TEST_URL (sans lui : ignorée). Même scénario que
// recette-c4, avec une table sans rowversion (Commandes), une requête SQL direct et la saisie dans une requête sur deux tables.
// Le test crée sa propre base de données, supprimée à la fin. Deux postes simulés par deux instances sur une machine : A (application
// complète) et B (Runtime, sa copie locale de l'application frontale), chacun son dossier de données utilisateur. Le passage sur un
// vrai serveur chiffré, deux vraies machines et une instance nommée est la validation manuelle du propriétaire
// (2026-10-31-basecraft-c5-validation-manuelle.md).
import { test, expect, type Page } from '@playwright/test';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import type { BasecraftApi } from '../../src/shared/api';
import { saveStartupOptions, startupOptions } from '../../src/main/db/startup';
import { mssqlLive, noLiveMssql, withDatabase } from '../../src/main/connectors/sqlserver/live';
import { launchApp, seedBase } from './helpers';

type Win = { basecraft: BasecraftApi };
type App = Awaited<ReturnType<typeof launchApp>>;
type Admin = { query(sql: string): Promise<unknown[][]> };
const fr = JSON.parse(readFileSync(join(__dirname, '../../src/shared/i18n/fr.json'), 'utf8'));
const ENV = { BASECRAFT_REGION: 'fr-FR' };
// DatasheetView: row selector, header and row heights; id (AutoNumber) 80 px.
const MARKER = 44, HEADER = 34, ROW = 30, AUTONUMBER = 80;

// The C3 clients and orders, on the server. Clients has a rowversion, Commandes has none (original values are compared).
const SEED = `CREATE TABLE Clients (id int IDENTITY(1,1) PRIMARY KEY, Nom nvarchar(80) NOT NULL UNIQUE, Ville nvarchar(80), rv rowversion);
INSERT INTO Clients (Nom, Ville) VALUES (N'Dupont', N'Lyon'), (N'Martin', N'LYON'), (N'Durand', N'Paris'), (N'Éric', N'Lyôn');
CREATE TABLE Commandes (n int IDENTITY(1,1) PRIMARY KEY, Client int REFERENCES Clients(id), Montant decimal(10,2), [Date] datetime2(7));
INSERT INTO Commandes (Client, Montant, [Date]) VALUES (1, 10.1, '2026-10-01'), (1, 0.1, '2026-10-05'), (2, 0.2, '2026-10-21'),
  (3, 99.99, '2026-09-30'), (2, 0.1, '2026-10-21')`;
const one = async (admin: Admin, sql: string) => (await admin.query(sql))[0]![0];

/** A workstation's user data; `refreshInterval` in seconds. */
function workstation(refreshInterval: number): string {
  const d = mkdtempSync(join(tmpdir(), 'basecraft-'));
  writeFileSync(join(d, 'settings.json'), JSON.stringify({ refreshInterval }));
  return d;
}
/** G2: « Mémoriser » is offered only where safeStorage has a keyring (Linux: not basic_text / unknown). */
const canRemember = (x: App) => x.app.evaluate(({ safeStorage }) => safeStorage.isEncryptionAvailable()
  && (process.platform !== 'linux' || !['basic_text', 'unknown'].includes(safeStorage.getSelectedStorageBackend())));

const doc = (page: Page) => page.locator('section[role=tabpanel]:not([hidden])');
const sheet = (page: Page) => page.getByTestId('datasheet').filter({ visible: true });
const cell = (page: Page, col: number, row: number) => sheet(page).getByTestId(`glide-cell-${col + 1}-${row}`);
const count = (page: Page) => page.getByTestId('nav-record-count').filter({ visible: true });
const ctl = (page: Page, n: string) => page.getByTestId(`form-ctl-${n}`).filter({ visible: true });
/** Types in column `col` of row `row` (the first cell clicked, then ArrowRight). `leave`: Enter, the next row (saved); else
 *  Shift+Tab, the row stays pending. `tab`: the document tab, its • tells whether the row is pending. */
async function typeAt(page: Page, tab: string, col: number, row: number, text: string, leave: boolean) {
  const b = (await sheet(page).getByTestId('data-grid-canvas').boundingBox())!;
  await page.mouse.click(b.x + MARKER + 30, b.y + HEADER + row * ROW + ROW / 2);
  await expect(cell(page, 0, row)).toBeFocused();
  for (let i = 0; i < col; i++) await page.keyboard.press('ArrowRight');
  await expect(cell(page, col, row)).toBeFocused();
  await page.keyboard.press(text[0]!);
  await page.keyboard.type(text.slice(1));
  await page.keyboard.press(leave ? 'Enter' : 'Shift+Tab');
  await expect(page.getByTestId('grid-editor-portal').locator('textarea')).toHaveCount(0);
  await expect(page.getByTestId(`doc-tab-${tab}`)).toHaveText(leave ? /^[^•]*$/ : /•/);
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
  await doc(page).getByTestId('query-sql').fill(sql);
  await page.keyboard.press('Control+s');
  await page.getByTestId('modal-input').fill(name);
  await page.getByTestId('modal-btn-ok').click();
  await expect(page.getByTestId(`nav-item-query-${name}`)).toBeVisible();
  await expect(page.getByTestId(`doc-tab-query-${name}`)).not.toContainText('•');
}

test('C5 acceptance: link SQL Server tables, a parameter query on the server, a form edit, write conflicts (rowversion and not), a refused function, Stop, a pass-through, multi-table entry', async () => {
  test.skip(noLiveMssql(), 'BASECRAFT_MSSQL_TEST_URL is not set'); // fails on Linux CI without it
  test.setTimeout(420_000);
  const { params: url, login } = mssqlLive();
  await withDatabase(async (admin, database) => {
    const params = { ...url, database };
    const password = login.password;
    await admin.query(SEED);
    const durand = async () => String(await one(admin, `SELECT Ville FROM Clients WHERE Nom = N'Durand'`));
    const montant = async (n: number) => Number(await one(admin, `SELECT CAST(Montant AS varchar(20)) FROM Commandes WHERE n = ${n}`));
    // no tables; a front-end (as Split marks one): the Runtime opens it from its local copy, never read-only behind A's lock
    const front = seedBase('Ventes', (fe) => saveStartupOptions(fe, { ...startupOptions(fe), frontEnd: true }));
    const userA = workstation(1);
    let a = await launchApp({ args: [front], userDataDir: userA, env: ENV, enterMovesDown: true });
    let b: App | null = null;
    try {
      // 1. External Data › SQL Server: « approuver le certificat », « Mémoriser » ticked, Clients and Commandes linked; after a
      //    restart no prompt (G2: asked again where there is no keyring); the password never in clear in credentials.json
      const remember = await canRemember(a);
      await a.page.getByTestId('ribbon-tab-externalData').click();
      await a.page.getByTestId('cmd-linkSqlServer').click();
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

      a = await launchApp({ args: [front], userDataDir: userA, env: ENV, enterMovesDown: true });
      await a.page.getByTestId('nav-item-Clients').dblclick();
      if (!remember) await logIn(a.page, password);
      await expect(count(a.page)).toHaveText('4');
      await expect(cell(a.page, 1, 2)).toHaveText('Durand');
      await expect(a.page.getByTestId('login-dialog')).toHaveCount(0);

      // 2. QVille runs on the server: its statement, over [Clients] with @p0, in the server's query statistics (read by the
      //    test's own connection, on this database only)
      const stats = async () => (await admin.query(`SELECT CAST(s.sql_handle AS varchar(100)) + ':' + CAST(s.statement_start_offset AS varchar(20)), s.execution_count, t.text
        FROM sys.dm_exec_query_stats s CROSS APPLY sys.dm_exec_sql_text(s.sql_handle) t
        CROSS APPLY (SELECT CAST(value AS int) AS dbid FROM sys.dm_exec_plan_attributes(s.plan_handle) WHERE attribute = 'dbid') p
        WHERE p.dbid = DB_ID() AND t.text NOT LIKE '%dm_exec_query_stats%'`)) as [string, number, string][];
      await sqlQuery(a.page, 'QVille', 'PARAMETERS [Ville ?] Text; SELECT Nom FROM Clients WHERE Ville = [Ville ?]');
      await a.page.getByTestId('doc-tab-close-query-QVille').click();
      const before = new Map((await stats()).map((r) => [r[0], Number(r[1])]));
      await a.page.getByTestId('nav-item-query-QVille').dblclick();
      await expect(a.page.getByTestId('modal')).toContainText('Ville ?');
      await a.page.getByTestId('modal-input').fill('lyon');
      await a.page.getByTestId('modal-btn-ok').click();
      await expect(count(a.page)).toHaveText('2');
      expect([await cell(a.page, 0, 0).textContent(), await cell(a.page, 0, 1).textContent()].sort()).toEqual(['Dupont', 'Martin']);
      await expect.poll(async () => (await stats()).filter((r) => Number(r[1]) > (before.get(r[0]) ?? 0) && /\[Clients\][\s\S]*WHERE[\s\S]*\[Ville\][\s\S]*@p0/.test(r[2])).length).toBeGreaterThan(0);
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
      await a.page.getByTestId('modal-btn-no').click();   // the AutoForm, not kept

      // 4. Write conflict on Clients (rowversion): B (the Runtime, its own userData: its own login) and A on Durand's Ville
      b = await launchApp({ runtime: true, enterMovesDown: true, args: [front], userDataDir: workstation(1), env: { ...ENV, BASECRAFT_E2E_NETWORK_DIR: dirname(front) } });
      await b.page.getByTestId('nav-item-Clients').dblclick();
      await logIn(b.page, password);
      await expect(cell(b.page, 2, 2)).toHaveText('Lille');
      await a.page.getByTestId('doc-tab-Clients').click();
      await expect(cell(a.page, 2, 2)).toHaveText('Lille', { timeout: 5000 });
      const conflict = async (mine: string, other: string) => {
        await typeAt(a.page, 'Clients', 2, 2, mine, false);
        await typeAt(b!.page, 'Clients', 2, 2, other, true);
        await expect.poll(durand).toBe(other);
        await a.page.keyboard.press('ArrowDown');
        await expect(a.page.getByTestId('write-conflict')).toContainText(fr.wc.message);
      };
      await conflict('Brest', 'Rennes');
      await a.page.getByTestId('wc-drop').click();
      await expect(cell(a.page, 2, 2)).toHaveText('Rennes');
      await expect(a.page.getByTestId('doc-tab-Clients')).not.toContainText('•');
      expect(await durand()).toBe('Rennes');
      await conflict('Brest', 'Vannes');
      await a.page.getByTestId('wc-save').click();
      await expect(a.page.getByTestId('doc-tab-Clients')).not.toContainText('•');
      await expect.poll(durand).toBe('Brest');
      await expect(cell(b.page, 2, 2)).toHaveText('Brest', { timeout: 5000 });

      // 5. Write conflict on Commandes (no rowversion: original values). Montant is column 2 of order 1 (row 0)
      await a.page.getByTestId('nav-item-Commandes').dblclick();
      await expect(count(a.page)).toHaveText('5');
      await b.page.getByTestId('nav-item-Commandes').dblclick();
      await expect(count(b.page)).toHaveText('5');
      await typeAt(a.page, 'Commandes', 2, 0, '25', false);
      await typeAt(b.page, 'Commandes', 2, 0, '20', true);
      await expect.poll(() => montant(1)).toBe(20);
      await a.page.keyboard.press('ArrowDown');
      await expect(a.page.getByTestId('write-conflict')).toContainText(fr.wc.message);
      await a.page.getByTestId('wc-save').click();
      await expect(a.page.getByTestId('doc-tab-Commandes')).not.toContainText('•');
      await expect.poll(() => montant(1)).toBe(25);
      // a change of the Date fraction only (not shown, compared to the second) is no conflict (R11)
      await admin.query(`UPDATE Commandes SET [Date] = DATEADD(ns, 100, [Date]) WHERE n = 1`);
      await typeAt(a.page, 'Commandes', 2, 0, '30', true);
      await expect.poll(() => montant(1)).toBe(30);
      await expect(a.page.getByTestId('write-conflict')).toHaveCount(0);
      await b.app.close();
      b = null;
      await a.page.getByTestId('doc-tab-close-Commandes').click();

      // 6. Format is outside the closed list: refused with its message, nothing sent to the server
      await sqlQuery(a.page, 'QFormat', 'SELECT Format(Nom, ">") FROM Clients');
      await a.page.getByTestId('cmd-runQuery').click();
      await expect(a.page.getByTestId('modal')).toContainText(fr.dialog.error.serverFunction.replace('{{name}}', 'Format').replace('{{detail}}', 'SQL Server'));
      await a.page.getByTestId('modal-btn-ok').click();
      expect((await stats()).filter((r) => /\bformat\s*\(/i.test(r[2])).map((r) => r[2])).toEqual([]);

      // 7. Stop: Commandes locked (TABLOCKX, open transaction) by the test; its datasheet waits (« Exécution… »), Stop cancels it
      //    on the server; the window goes on (Clients still pages) in the same data process (the front-end's lock names it)
      const pid = () => JSON.parse(readFileSync(`${front}.lock`, 'utf8')).pid as number;
      const dataProcess = pid();
      await admin.query('BEGIN TRANSACTION; SELECT 1 FROM Commandes WITH (TABLOCKX, HOLDLOCK)');
      try {
        await a.page.getByTestId('nav-item-Commandes').dblclick();
        await expect(a.page.getByTestId('running-notice')).toContainText(fr.query.run.running);
        await a.page.getByTestId('query-cancel').click();
        await expect(a.page.getByTestId('modal')).toContainText(fr.dialog.error.cancelled);
        await a.page.getByTestId('modal-btn-ok').click();
        await expect(a.page.getByTestId('running-notice')).toHaveCount(0);
      } finally {
        await admin.query('ROLLBACK');
      }
      await a.page.getByTestId('nav-item-Clients').dblclick();
      await expect(cell(a.page, 1, 3)).toHaveText('Éric');
      const page = await a.page.evaluate(() => (window as unknown as Win).basecraft.rows.page('Clients', { offset: 2, limit: 2 }));
      expect(page.rows.map((r) => r.values)).toEqual([[3, 'Durand', 'Brest'], [4, 'Éric', 'Lyôn']]);
      expect(pid()).toBe(dataProcess);

      // 8. Pass-through: Query Type › SQL direct, « Autre serveur SQL Server… », T-SQL only the server knows (STRING_AGG ... WITHIN GROUP)
      await a.page.getByTestId('ribbon-tab-create').click();
      await a.page.getByTestId('cmd-createQueryDesign').click();
      await a.page.getByTestId('show-table-close').click();
      await a.page.getByTestId('cmd-passThroughQuery').click();
      await a.page.getByTestId('pt-props-connection').selectOption({ label: fr.query.passThrough.otherServerKind.replace('{{product}}', 'SQL Server') });
      await a.page.getByTestId('srv-host').fill(params.host);
      await a.page.getByTestId('srv-port').fill(String(params.port));
      await a.page.getByTestId('srv-database').fill(params.database);
      await a.page.getByTestId('srv-user').fill(params.user);
      await a.page.getByTestId('srv-tls').selectOption(params.tls);
      await a.page.getByTestId('srv-password').fill(password);
      if (await a.page.getByTestId('srv-remember').isEnabled()) await a.page.getByTestId('srv-remember').uncheck();
      await a.page.getByTestId('srv-connect').click();
      await expect(a.page.getByTestId('pt-props')).toBeVisible();
      await a.page.getByTestId('pt-props-returnsRecords').selectOption({ label: fr.dialog.button.yes });
      await a.page.getByTestId('pt-props-ok').click();
      await expect(a.page.getByTestId('pt-props')).toHaveCount(0);
      await doc(a.page).getByTestId('query-sql').fill(`SELECT Ville, STRING_AGG(Nom, ', ') WITHIN GROUP (ORDER BY Nom) AS Noms FROM Clients GROUP BY Ville ORDER BY Noms`);
      await a.page.keyboard.press('Control+s');
      await a.page.getByTestId('modal-input').fill('PVilles');
      await a.page.getByTestId('modal-btn-ok').click();
      await a.page.getByTestId('doc-tab-close-query-PVilles').click();
      await a.page.getByTestId('nav-item-query-PVilles').dblclick();
      await expect(count(a.page)).toHaveText('3'); // Lyon and LYON are one group on this collation
      await expect(cell(a.page, 1, 0)).toHaveText('Dupont, Martin');
      expect((await cell(a.page, 0, 0).textContent())!.toLowerCase()).toBe('lyon');
      await expect(a.page.getByTestId('nav-readonly').filter({ visible: true })).toBeVisible();
      await a.page.getByTestId('doc-tab-close-query-PVilles').click();

      // 9. Multi-table entry (R16): orders joined to their customers; Client 2 shows « Martin » before the save (AutoLookup);
      //    Martin's Ville typed in the new row before it is saved, then on the saved row: one transaction each, both on the server
      await sqlQuery(a.page, 'QSaisie', 'SELECT Commandes.n, Commandes.Client, Commandes.Montant, Clients.Nom, Clients.Ville FROM Commandes INNER JOIN Clients ON Commandes.Client = Clients.id');
      await a.page.getByTestId('doc-tab-close-query-QSaisie').click();
      await a.page.getByTestId('nav-item-query-QSaisie').dblclick();
      await expect(count(a.page)).toHaveText('5');
      await expect(a.page.getByTestId('nav-readonly').filter({ visible: true })).toHaveCount(0);
      const g = (await sheet(a.page).getByTestId('data-grid-canvas').boundingBox())!;
      await a.page.mouse.click(g.x + MARKER + AUTONUMBER + 30, g.y + HEADER + 5 * ROW + ROW / 2); // the new record row: Client
      await expect(a.page.getByTestId('grid-editor-portal').locator('textarea')).toBeFocused();
      await a.page.keyboard.type('2');
      await a.page.keyboard.press('Tab');
      await expect(cell(a.page, 3, 5)).toHaveText('Martin'); // AutoLookup, the row not saved yet
      await expect(a.page.getByTestId('doc-tab-query-QSaisie')).toContainText('•');
      expect(await one(admin, `SELECT COUNT(*) FROM Commandes`)).toBe(5);
      await expect(cell(a.page, 2, 5)).toBeFocused();
      await a.page.keyboard.press('7');
      await expect(a.page.getByTestId('grid-editor-portal').locator('textarea')).toBeFocused();
      await a.page.keyboard.press('Tab'); // Montant → Nom
      await expect(a.page.getByTestId('grid-editor-portal').locator('textarea')).toHaveCount(0);
      await a.page.keyboard.press('Tab'); // Nom → Ville: the "one" side's own field, on the row not saved yet (final review 7)
      await expect(cell(a.page, 4, 5)).toBeFocused();
      await a.page.keyboard.press('A');
      await expect(a.page.getByTestId('grid-editor-portal').locator('textarea')).toBeFocused();
      await a.page.keyboard.type('nnecy');
      await a.page.keyboard.press('Shift+Tab');
      await expect(a.page.getByTestId('grid-editor-portal').locator('textarea')).toHaveCount(0);
      await expect(cell(a.page, 4, 5)).toHaveText('Annecy');
      await a.page.mouse.click(g.x + MARKER + 30, g.y + HEADER + ROW / 2); // another record: the new one is saved
      await expect(a.page.getByTestId('doc-tab-query-QSaisie')).not.toContainText('•');
      await expect.poll(() => one(admin, `SELECT COUNT(*) FROM Commandes WHERE Client = 2 AND Montant = 7`)).toBe(1);
      await expect.poll(() => one(admin, `SELECT Ville FROM Clients WHERE Nom = N'Martin'`)).toBe('Annecy');
      await expect(count(a.page)).toHaveText('6');
      // then Martin's Ville through the saved row: the customer's row updated in the same save
      await typeAt(a.page, 'query-QSaisie', 4, 5, 'Chambéry', true);
      await expect.poll(() => one(admin, `SELECT Ville FROM Clients WHERE Nom = N'Martin'`)).toBe('Chambéry');
      expect(await one(admin, `SELECT COUNT(*) FROM Commandes WHERE Client = 2 AND Montant = 7`)).toBe(1);
    } finally {
      await b?.app.close();
      await a.app.close();
    }
  });
});
