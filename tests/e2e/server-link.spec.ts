import { test, expect, type Page } from '@playwright/test';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { addServerLinks } from '../../src/main/links/store';
import type { RemoteTable } from '../../src/main/connectors/connector';
import { liveParams, noLiveServer, withSchema } from '../../src/main/connectors/postgres/live';
import { pgLabel } from '../../src/main/connectors/postgres/params';
import { mssqlLive, noLiveMssql, withDatabase } from '../../src/main/connectors/sqlserver/live';
import { msLabel } from '../../src/main/connectors/sqlserver/params';
import { createTable } from '../../src/main/db/schema';
import { f, t } from '../../src/shared/test-fixtures';
import { launchApp, seedBase, seedCrashed } from './helpers';

// C4 server links on the fake connector (BASECRAFT_E2E_FAKE_SERVER=1, host.ts: Clients = Dupont/Lyon, Martin/Brest; password 'secret').
const fr = JSON.parse(readFileSync(join(__dirname, '../../src/shared/i18n/fr.json'), 'utf8'));
const ENV = { BASECRAFT_REGION: 'fr-FR', BASECRAFT_E2E_FAKE_SERVER: '1' };
const P = { host: 'db.example', port: 5432, database: 'ventes', user: 'ana', tls: 'verify-full', timeout: 60 };
const clients: RemoteTable = {
  name: 'Clients', remote: 'Clients', schema: 'public', key: ['id'], skipped: [],
  design: t('Clients', [f('id', 'number', { numberSize: 'longInteger' }), f('Nom', 'shortText'), f('Ville', 'shortText')]),
};
const cell = (page: Page, col: number, row: number) => page.getByTestId(`glide-cell-${col + 1}-${row}`);

async function rowsShown(page: Page) {
  await expect(page.getByTestId('nav-record-count')).toHaveText('2');
  await expect(cell(page, 1, 0)).toHaveText('Dupont');
  await expect(cell(page, 1, 1)).toHaveText('Martin');
}

test('C4 R10: the login dialog — wrong password asked again, the right one shows the rows, « Mémoriser » skips it after a restart', async () => {
  test.setTimeout(120_000);
  const front = seedBase('Front', (db) => addServerLinks(db, 'postgresql', P, [clients]));
  let { app, page, userDataDir } = await launchApp({ args: [front], env: ENV });
  try {
    // G2: « Mémoriser » is offered only where safeStorage has a keyring (Linux: not basic_text / unknown)
    const canRemember = await app.evaluate(({ safeStorage }) => safeStorage.isEncryptionAvailable()
      && (process.platform !== 'linux' || !['basic_text', 'unknown'].includes(safeStorage.getSelectedStorageBackend())));

    await page.getByTestId('nav-item-Clients').dblclick();
    await expect(page.getByTestId('login-dialog')).toBeVisible();
    await expect(page.getByTestId('modal')).toContainText(fr.link.login.title);
    await expect(page.getByTestId('login-dialog')).toContainText(fr.link.login.message.replace('{{label}}', 'db.example:5432/ventes'));
    await expect(page.getByTestId('login-user')).toHaveValue('ana');
    await expect(page.getByTestId('login-password')).toHaveAttribute('type', 'password');
    if (canRemember) {
      await expect(page.getByTestId('login-remember')).toBeEnabled();
      await expect(page.getByTestId('login-remember')).toBeChecked();
    } else {
      await expect(page.getByTestId('login-remember')).toBeDisabled();
      await expect(page.getByTestId('login-no-keyring')).toHaveText(fr.link.login.noKeyring);
    }

    // a wrong password: the error, the dialog stays (asked again, the user name kept)
    await page.getByTestId('login-password').fill('faux');
    await page.getByTestId('login-ok').click();
    await expect(page.getByTestId('login-error')).toHaveText(fr.link.login.wrong);
    await expect(page.getByTestId('login-dialog')).toHaveCount(1);
    await expect(page.getByTestId('login-user')).toHaveValue('ana');
    // the right one: the rows
    await page.getByTestId('login-password').fill('secret');
    await page.getByTestId('login-ok').click();
    await expect(page.getByTestId('login-dialog')).toHaveCount(0);
    await rowsShown(page);
    await app.close();

    // never in clear on disk; stored only where a keyring exists (G2)
    const file = join(userDataDir, 'credentials.json');
    if (canRemember) expect(readFileSync(file, 'utf8')).not.toContain('secret');
    else expect(existsSync(file)).toBe(false);

    // after a restart: no prompt when remembered, asked again otherwise
    ({ app, page } = await launchApp({ args: [front], env: ENV, userDataDir }));
    await page.getByTestId('nav-item-Clients').dblclick();
    if (!canRemember) {
      await expect(page.getByTestId('login-dialog')).toBeVisible();
      await page.getByTestId('login-password').fill('secret');
      await page.getByTestId('login-ok').click();
    }
    await rowsShown(page);
    await expect(page.getByTestId('login-dialog')).toHaveCount(0);
    await app.close();

    // a front-end opened in recovery (no credential pushed at its open): the take-over pushes the remembered one
    if (canRemember) {
      const crashed = seedCrashed('Crashed', (db) => addServerLinks(db, 'postgresql', P, [clients]));
      ({ app, page } = await launchApp({ args: [crashed], env: ENV, userDataDir }));
      await page.getByTestId('banner-takeover').click();
      await expect(page.getByTestId('banner-takeover')).toHaveCount(0);
      await page.getByTestId('nav-item-Clients').dblclick();
      await rowsShown(page);
      await expect(page.getByTestId('login-dialog')).toHaveCount(0);
    }
  } finally {
    await app.close();
  }
});

const headers = (page: Page) => page.getByTestId('datasheet').locator('th[role=columnheader]');
const title = (page: Page) => page.getByTestId('modal').locator('.modal-title');
/** The connection form filled; the password typed last. */
async function fillServer(page: Page, p: { host: string; port: number; database: string; user: string; tls: string }, password: string) {
  await page.getByTestId('srv-host').fill(p.host);
  await page.getByTestId('srv-port').fill(String(p.port));
  await page.getByTestId('srv-database').fill(p.database);
  await page.getByTestId('srv-user').fill(p.user);
  await page.getByTestId('srv-tls').selectOption(p.tls);
  await page.getByTestId('srv-password').fill(password);
}

test('C4 Task 12: External Data › PostgreSQL links a server table (fake server); the Linked Table Manager shows, refreshes and moves it', async () => {
  test.setTimeout(120_000);
  const front = seedBase('Front', (db) => createTable(db, t('Notes', [f('N°', 'autoNumber'), f('Texte', 'shortText')])));
  const { app, page } = await launchApp({ args: [front], env: ENV });
  try {
    const canRemember = await app.evaluate(({ safeStorage }) => safeStorage.isEncryptionAvailable()
      && (process.platform !== 'linux' || !['basic_text', 'unknown'].includes(safeStorage.getSelectedStorageBackend())));
    await page.getByTestId('ribbon-tab-externalData').click();
    await expect(page.getByTestId('cmd-linkPostgreSql')).toHaveText(fr.ribbon.cmd.linkPostgreSql);
    await page.getByTestId('cmd-linkPostgreSql').click();
    await expect(page.getByTestId('server-link-dialog')).toBeVisible();
    await expect(page.getByTestId('modal')).toContainText(fr.link.server.title);
    await expect(page.getByTestId('srv-port')).toHaveValue('5432');
    await expect(page.getByTestId('srv-timeout')).toHaveValue('60');
    await expect(page.getByTestId('srv-tls')).toHaveValue('verify-full');
    await expect(page.getByTestId('srv-tls').locator('option')).toHaveText([fr.link.server.tlsVerify, fr.link.server.tlsRequire, fr.link.server.tlsDisable]);
    if (canRemember) await expect(page.getByTestId('srv-remember')).toBeChecked();
    else {
      await expect(page.getByTestId('srv-remember')).toBeDisabled(); // G2
      await expect(page.getByTestId('srv-no-keyring')).toHaveText(fr.link.login.noKeyring);
    }
    await expect(page.getByTestId('srv-connect')).toBeDisabled();
    await fillServer(page, P, 'faux');
    await page.getByTestId('srv-connect').click();
    await expect(page.getByTestId('srv-error')).toHaveText(fr.link.login.wrong); // said in the dialog, no login prompt
    await expect(page.getByTestId('login-dialog')).toHaveCount(0);
    await page.getByTestId('srv-password').fill('secret');
    await page.getByTestId('srv-connect').click();

    // the tables: Vue without a key is read-only, its unread column said; the focus moves to the first table
    await expect(page.getByTestId('link-dialog')).toBeVisible();
    await expect(page.getByTestId('link-table-Clients')).toBeFocused();
    await expect(page.getByTestId('link-path')).toHaveText(fr.link.source.replace('{{path}}', 'db.example:5432/ventes'));
    await expect(page.getByTestId('link-kind')).toHaveText(fr.link.kind.postgresql);
    await expect(page.getByTestId('link-readonly-Vue')).toContainText(fr.link.server.readOnly);
    await expect(page.getByTestId('link-readonly-Clients')).toHaveCount(0);
    await expect(page.getByTestId('link-skipped-Vue')).toHaveText(fr.link.server.skipped.replace('{{names}}', 'geo'));
    await page.getByTestId('link-table-Clients').check();
    await page.getByTestId('link-ok').click();
    await expect(page.getByTestId('link-dialog')).toHaveCount(0);
    await expect(page.getByTestId('nav-item-link-Clients')).toBeVisible();
    await page.getByTestId('nav-item-Clients').dblclick();
    await rowsShown(page); // the dialog's login serves the reads: no login prompt
    await expect(page.getByTestId('login-dialog')).toHaveCount(0);
    await page.getByTestId('doc-tab-close-Clients').click();

    // External Data › PostgreSQL again: Clients is taken, offered as Clients1 (never overwritten)
    await page.getByTestId('cmd-linkPostgreSql').click();
    await fillServer(page, P, 'secret');
    await page.getByTestId('srv-connect').click();
    await expect(page.getByTestId('link-table-Clients1')).toBeVisible();
    await page.getByTestId('link-cancel').click();

    // the manager: kind, the server's label under Source, no location risk; Refresh; Change Source moves it to another server
    await page.getByTestId('cmd-linkedTableManager').click();
    await expect(page.getByTestId('ltm-dialog')).toContainText(fr.ltm.col.path);
    await expect(page.getByTestId('ltm-row-Clients')).toContainText(fr.link.kind.postgresql);
    await expect(page.getByTestId('ltm-path-Clients')).toHaveText('db.example:5432/ventes');
    await expect(page.getByTestId('ltm-risk-Clients')).toHaveCount(0);
    await page.getByTestId('ltm-check-Clients').check();
    await page.getByTestId('ltm-refresh').click();
    await expect(page.getByTestId('ltm-state-Clients')).toHaveText(fr.ltm.state.ok);
    await page.getByTestId('ltm-relink').click();
    await expect(page.getByTestId('server-link-dialog')).toBeVisible();
    await expect(title(page)).toHaveText(fr.link.server.title);
    await expect(page.getByTestId('srv-host')).toBeFocused();
    await page.keyboard.press('Escape'); // back to the list, the manager stays
    await expect(page.getByTestId('ltm-dialog')).toBeVisible();
    await expect(title(page)).toHaveText(fr.ltm.title);
    await expect(page.getByTestId('ltm-check-Clients')).toBeFocused();
    await page.getByTestId('ltm-relink').click();
    await expect(page.getByTestId('srv-host')).toHaveValue('db.example');
    await expect(page.getByTestId('srv-database')).toHaveValue('ventes');
    await expect(page.getByTestId('srv-user')).toHaveValue('ana');
    await page.getByTestId('srv-host').fill('autre.example');
    await page.getByTestId('srv-password').fill('secret');
    await page.getByTestId('srv-connect').click();
    await expect(page.getByTestId('ltm-path-Clients')).toHaveText('autre.example:5432/ventes');
    await expect(page.getByTestId('ltm-state-Clients')).toHaveText(fr.ltm.state.ok);
    await page.getByTestId('ltm-close').click();
    await page.getByTestId('nav-item-Clients').dblclick();
    await rowsShown(page);
  } finally {
    await app.close();
  }
});

test('C4 Task 12, live server: link a table, its rows, the manager, Refresh Link after ALTER TABLE; the Runtime has no PostgreSQL command', async () => {
  test.skip(noLiveServer(), 'BASECRAFT_PG_TEST_URL is not set'); // fails on Linux CI without it (M7)
  test.setTimeout(180_000);
  await withSchema(async (admin, schema) => {
    await admin.query(`CREATE TABLE "Clients" (id serial PRIMARY KEY, "Nom" varchar(80), "Ville" varchar(80));
      INSERT INTO "Clients" ("Nom", "Ville") VALUES ('Dupont', 'Lyon'), ('Martin', 'Brest');
      CREATE TABLE "Journal" (x int, note text)`);
    const { params, login } = liveParams();
    const name = `${schema}_Clients`; // R6: a table outside public
    const front = seedBase('Front');
    const { app, page } = await launchApp({ args: [front], env: { BASECRAFT_REGION: 'fr-FR' } });
    try {
      await page.getByTestId('ribbon-tab-externalData').click();
      await page.getByTestId('cmd-linkPostgreSql').click();
      await fillServer(page, params, login.password);
      await page.getByTestId('srv-connect').click();
      await expect(page.getByTestId(`link-readonly-${schema}_Journal`)).toContainText(fr.link.server.readOnly);
      await expect(page.getByTestId(`link-readonly-${name}`)).toHaveCount(0);
      await page.getByTestId(`link-table-${name}`).check();
      await page.getByTestId('link-ok').click();
      await expect(page.getByTestId(`nav-item-link-${name}`)).toBeVisible();
      await page.getByTestId(`nav-item-${name}`).dblclick();
      await rowsShown(page);
      await page.getByTestId(`doc-tab-close-${name}`).click();

      await page.getByTestId('cmd-linkedTableManager').click();
      await expect(page.getByTestId(`ltm-row-${name}`)).toContainText(fr.link.kind.postgresql);
      await expect(page.getByTestId(`ltm-path-${name}`)).toHaveText(pgLabel(params));
      await admin.query('ALTER TABLE "Clients" ADD COLUMN "Pays" varchar(40)');
      await page.getByTestId(`ltm-check-${name}`).check();
      await page.getByTestId('ltm-refresh').click();
      await expect(page.getByTestId(`ltm-state-${name}`)).toHaveText(fr.ltm.state.ok);
      await page.getByTestId('ltm-close').click();
      await page.getByTestId(`nav-item-${name}`).dblclick();
      await expect(headers(page)).toHaveText(['id', 'Nom', 'Ville', 'Pays']);
    } finally {
      await app.close();
    }

    // B5: the Runtime has no PostgreSQL command (design only)
    const rt = await launchApp({ runtime: true, args: [front], env: { BASECRAFT_REGION: 'fr-FR' } });
    try {
      await expect(rt.page.getByTestId('nav-pane')).toBeVisible();
      await expect(rt.page.getByTestId('cmd-linkPostgreSql')).toHaveCount(0);
      await expect(rt.page.getByTestId('ribbon-tab-externalData')).toHaveCount(0);
    } finally {
      await rt.app.close();
    }
  });
});

test('C5 Task 7: External Data › SQL Server (fake server): host\\instance disables the port, « approuver le certificat », the manager relinks with the SQL Server dialog; no password in the file', async () => {
  test.setTimeout(120_000);
  const front = seedBase('Front', (db) => createTable(db, t('Notes', [f('N°', 'autoNumber'), f('Texte', 'shortText')])));
  const { app, page } = await launchApp({ args: [front], env: ENV });
  try {
    await page.getByTestId('ribbon-tab-externalData').click();
    await expect(page.getByTestId('cmd-linkSqlServer')).toHaveText(fr.ribbon.cmd.linkSqlServer);
    await page.getByTestId('cmd-linkSqlServer').click();
    await expect(page.getByTestId('server-link-dialog')).toBeVisible();
    await expect(title(page)).toHaveText(fr.link.server.titleSqlServer);
    await expect(page.getByTestId('srv-host')).toHaveAttribute('placeholder', fr.link.server.hostHint);
    await expect(page.getByTestId('srv-port')).toHaveValue('1433');
    await expect(page.getByTestId('srv-tls').locator('option')).toHaveText([fr.link.server.tlsVerify, fr.link.server.tlsTrust, fr.link.server.tlsDisable]);
    // R2: a named instance — the port is not used (disabled, an invalid one never blocking Connect); cleared, it is again
    await page.getByTestId('srv-host').fill('db.example');
    await page.getByTestId('srv-port').fill('x');
    await page.getByTestId('srv-database').fill('ventes');
    await page.getByTestId('srv-user').fill('ana');
    await page.getByTestId('srv-password').fill('secret');
    await expect(page.getByTestId('srv-connect')).toBeDisabled();
    await page.getByTestId('srv-host').fill('db.example\\SQLEXPRESS');
    await expect(page.getByTestId('srv-port')).toBeDisabled();
    await expect(page.getByTestId('srv-connect')).toBeEnabled();
    await page.getByTestId('srv-host').fill('db.example');
    await expect(page.getByTestId('srv-port')).toBeEnabled();
    await expect(page.getByTestId('srv-connect')).toBeDisabled(); // the port is checked again
    await page.getByTestId('srv-port').fill('1433');
    await page.getByTestId('srv-tls').selectOption('require');
    await page.getByTestId('srv-connect').click();

    await expect(page.getByTestId('link-dialog')).toBeVisible();
    await expect(page.getByTestId('link-path')).toHaveText(fr.link.source.replace('{{path}}', 'db.example:1433/ventes'));
    await expect(page.getByTestId('link-kind')).toHaveText(fr.link.kind.sqlserver);
    await expect(page.getByTestId('link-readonly-Vue')).toContainText(fr.link.server.readOnly);
    await page.getByTestId('link-table-Clients').check();
    await page.getByTestId('link-ok').click();
    await expect(page.getByTestId('nav-item-link-Clients')).toBeVisible();
    await page.getByTestId('nav-item-Clients').dblclick();
    await rowsShown(page);
    await expect(page.getByTestId('login-dialog')).toHaveCount(0);
    await page.getByTestId('doc-tab-close-Clients').click();

    // the manager: its kind and label; Change Source opens the SQL Server dialog, prefilled, and moves it to a named instance
    await page.getByTestId('cmd-linkedTableManager').click();
    await expect(page.getByTestId('ltm-row-Clients')).toContainText(fr.link.kind.sqlserver);
    await expect(page.getByTestId('ltm-path-Clients')).toHaveText('db.example:1433/ventes');
    await page.getByTestId('ltm-check-Clients').check();
    await page.getByTestId('ltm-relink').click();
    await expect(title(page)).toHaveText(fr.link.server.titleSqlServer);
    await expect(page.getByTestId('srv-host')).toHaveValue('db.example');
    await expect(page.getByTestId('srv-port')).toHaveValue('1433');
    await expect(page.getByTestId('srv-tls')).toHaveValue('require');
    await page.getByTestId('srv-host').fill('autre.example\\INST1');
    await page.getByTestId('srv-password').fill('secret');
    await page.getByTestId('srv-connect').click();
    await expect(page.getByTestId('ltm-path-Clients')).toHaveText('autre.example\\INST1/ventes');
    await expect(page.getByTestId('ltm-state-Clients')).toHaveText(fr.ltm.state.ok);
    await page.getByTestId('ltm-relink').click();
    await expect(page.getByTestId('srv-host')).toHaveValue('autre.example\\INST1'); // the instance read back
    await expect(page.getByTestId('srv-port')).toBeDisabled();
    await page.keyboard.press('Escape');
    await page.getByTestId('ltm-close').click();
    await page.getByTestId('nav-item-Clients').dblclick();
    await rowsShown(page);
  } finally {
    await app.close();
  }
  // C4 G2: the typed password reaches neither the front-end nor its journal
  for (const file of [front, `${front}-wal`]) if (existsSync(file)) expect(readFileSync(file).includes('secret')).toBe(false);
});

test('C5 Task 7, live SQL Server: link a table with a rowversion and a keyless view, its rows, the manager, Refresh Link after ALTER TABLE; the Runtime has no SQL Server command', async () => {
  test.skip(noLiveMssql(), 'BASECRAFT_MSSQL_TEST_URL is not set'); // fails on Linux CI without it
  test.setTimeout(180_000);
  await withDatabase(async (admin, database) => {
    await admin.query(`CREATE TABLE Clients (id int IDENTITY PRIMARY KEY, Nom nvarchar(80), Ville nvarchar(80), rv rowversion);
      INSERT INTO Clients (Nom, Ville) VALUES (N'Dupont', N'Lyon'), (N'Martin', N'Brest')`);
    await admin.query('CREATE VIEW Villes AS SELECT Ville FROM Clients');
    const live = mssqlLive();
    const params = { ...live.params, database };
    const front = seedBase('Front');
    const { app, page } = await launchApp({ args: [front], env: { BASECRAFT_REGION: 'fr-FR' } });
    try {
      await page.getByTestId('ribbon-tab-externalData').click();
      await page.getByTestId('cmd-linkSqlServer').click();
      await expect(page.getByTestId('srv-port')).toHaveValue('1433');
      await fillServer(page, params, live.login.password);
      if (params.tls === 'require') await expect(page.getByTestId('srv-tls').locator('option:checked')).toHaveText(fr.link.server.tlsTrust);
      await page.getByTestId('srv-connect').click();
      await expect(page.getByTestId('link-readonly-Villes')).toContainText(fr.link.server.readOnly);
      await expect(page.getByTestId('link-readonly-Clients')).toHaveCount(0);
      await page.getByTestId('link-table-Clients').check();
      await page.getByTestId('link-ok').click();
      await expect(page.getByTestId('nav-item-link-Clients')).toBeVisible();
      await page.getByTestId('nav-item-Clients').dblclick();
      await rowsShown(page);
      await expect(headers(page)).toHaveText(['id', 'Nom', 'Ville']); // the rowversion is the table's version, not a field
      await page.getByTestId('doc-tab-close-Clients').click();

      await page.getByTestId('cmd-linkedTableManager').click();
      await expect(page.getByTestId('ltm-row-Clients')).toContainText(fr.link.kind.sqlserver);
      await expect(page.getByTestId('ltm-path-Clients')).toHaveText(msLabel(params));
      await admin.query('ALTER TABLE Clients ADD Pays nvarchar(40)');
      await page.getByTestId('ltm-check-Clients').check();
      await page.getByTestId('ltm-refresh').click();
      await expect(page.getByTestId('ltm-state-Clients')).toHaveText(fr.ltm.state.ok);
      await page.getByTestId('ltm-close').click();
      await page.getByTestId('nav-item-Clients').dblclick();
      await expect(headers(page)).toHaveText(['id', 'Nom', 'Ville', 'Pays']);
    } finally {
      await app.close();
    }
    for (const file of [front, `${front}-wal`]) if (existsSync(file)) expect(readFileSync(file).includes(live.login.password)).toBe(false);

    const rt = await launchApp({ runtime: true, args: [front], env: { BASECRAFT_REGION: 'fr-FR' } });
    try {
      await expect(rt.page.getByTestId('nav-pane')).toBeVisible();
      await expect(rt.page.getByTestId('cmd-linkSqlServer')).toHaveCount(0);
    } finally {
      await rt.app.close();
    }
  });
});

test('C4 Task 12 review: Refresh Link without a login says it is required; a server link whose params are damaged changes source on a server', async () => {
  const front = seedBase('Front', (db) => {
    addServerLinks(db, 'postgresql', P, [clients]);
    addServerLinks(db, 'postgresql', { ...P, host: 'h2.example' }, [{ ...clients, name: 'Damaged' }]);
    db.exec(`UPDATE bc_sources SET props = '{"host":""}' WHERE id = (SELECT source_id FROM bc_links WHERE name = 'Damaged')`);
  });
  const { app, page } = await launchApp({ args: [front], env: ENV });
  try {
    await page.getByTestId('nav-item-Clients').click({ button: 'right' });
    await page.getByTestId('nav-menu-refreshLink').click();
    await expect(page.getByTestId('modal')).toContainText(fr.link.needsLogin.replace('{{detail}}', 'db.example:5432/ventes'));
    await expect(page.getByTestId('login-dialog')).toHaveCount(0);
    await page.getByTestId('modal-btn-ok').click();

    await page.getByTestId('ribbon-tab-externalData').click();
    await page.getByTestId('cmd-linkedTableManager').click();
    await expect(page.getByTestId('ltm-state-Damaged')).toHaveText(fr.ltm.state.unsupportedKind);
    await page.getByTestId('ltm-check-Damaged').check();
    await page.getByTestId('ltm-relink').click();
    await expect(page.getByTestId('server-link-dialog')).toBeVisible(); // never the file picker: it stays a server link
    await expect(page.getByTestId('srv-host')).toHaveValue('');
    await expect(page.getByTestId('srv-port')).toHaveValue('5432');
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('ltm-dialog')).toBeVisible();
  } finally {
    await app.close();
  }
});
