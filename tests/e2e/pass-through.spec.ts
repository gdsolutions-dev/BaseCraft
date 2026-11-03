import { test, expect, type Page } from '@playwright/test';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { BasecraftApi } from '../../src/shared/api';
import type { RemoteTable } from '../../src/main/connectors/connector';
import { saveObject } from '../../src/main/db/objects';
import { addServerLinks } from '../../src/main/links/store';
import { saveStartupOptions } from '../../src/main/db/startup';
import { DEFAULT_STARTUP } from '../../src/shared/startup';
import { f, t } from '../../src/shared/test-fixtures';
import type { DesignDoc } from '../../src/shared/design/model';
import { inFile, launchApp, layoutFromDom, seedBase } from './helpers';

// C6 pass-through queries on the fake connector (BASECRAFT_E2E_FAKE_SERVER=1, host.ts: password 'secret'; any text answers
// Texte, Nom, Ville). Design (Task 5) and running (Task 6).
const fr = JSON.parse(readFileSync(join(__dirname, '../../src/shared/i18n/fr.json'), 'utf8'));
const ENV = { BASECRAFT_REGION: 'fr-FR', BASECRAFT_E2E_FAKE_SERVER: '1' };
const P = { host: 'db.example', port: 5432, database: 'ventes', user: 'ana', tls: 'verify-full', timeout: 60 };
const clients: RemoteTable = {
  name: 'Clients', remote: 'Clients', schema: 'public', key: ['id'], skipped: [],
  design: t('Clients', [f('id', 'number', { numberSize: 'longInteger' }), f('Nom', 'shortText'), f('Ville', 'shortText')]),
};
type Win = { basecraft: BasecraftApi };
const doc = (page: Page) => page.locator('section[role=tabpanel]:not([hidden])');
const sqlBox = (page: Page) => doc(page).getByTestId('query-sql');
const definitionOf = (page: Page, name: string) => page.evaluate((n) => (window as unknown as Win).basecraft.objects.get('query', n)
  .then((g) => g.definition), name);
const pressed = (page: Page, id: string, on: boolean) => expect(page.getByTestId(`cmd-${id}`)).toHaveAttribute('aria-pressed', String(on));

/** Create › Query Design, Show Table closed, Query Type › SQL direct: the property sheet opens at once. */
async function newPassThrough(page: Page) {
  await page.getByTestId('ribbon-tab-create').click();
  await page.getByTestId('cmd-createQueryDesign').click();
  await page.getByTestId('show-table-close').click();
  await expect(page.getByTestId('cmd-passThroughQuery')).toHaveText(fr.ribbon.cmd.passThroughQuery);
  await page.getByTestId('cmd-passThroughQuery').click();
  await expect(page.getByTestId('pt-props')).toBeVisible();
}

test('C6 R10: Pass-Through turns a new query into SQL view, kept as typed; Design View off; the property sheet saves its server', async () => {
  test.setTimeout(120_000);
  const front = seedBase('Front', (db) => addServerLinks(db, 'postgresql', P, [clients]));
  const { app, page } = await launchApp({ args: [front], env: ENV });
  try {
    await newPassThrough(page);
    // the first linked server, its timeout Access's default, Returns Records Yes
    await expect(page.getByTestId('pt-props-connection').locator('option:checked')).toHaveText('db.example:5432/ventes');
    await expect(page.getByTestId('pt-props-returnsRecords')).toHaveValue('yes');
    await expect(page.getByTestId('pt-props-timeout')).toHaveValue('60');
    await page.getByTestId('pt-props-cancel').click(); // it stays a pass-through
    await expect(sqlBox(page)).toBeVisible();
    await expect(doc(page).getByTestId('qbe-cell-field-0')).toHaveCount(0);
    await expect(page.getByTestId('status-view-design')).toBeDisabled();
    await pressed(page, 'passThroughQuery', true);
    await pressed(page, 'selectQuery', false);
    for (const id of ['unionQuery', 'parameters', 'addTables', 'makeTableQuery', 'insertColumns']) await expect(page.getByTestId(`cmd-${id}`)).toBeDisabled();
    await expect(doc(page).getByTestId('query-sql-notice')).toHaveText(fr.query.passThrough.notice.replace('{{label}}', 'db.example:5432/ventes'));

    const text = `select string_agg("Nom", ', ') from "Clients" [where]`; // not Access SQL: never read
    await sqlBox(page).fill(text);
    await expect(doc(page).getByTestId('query-sql-error')).toHaveCount(0);
    await page.getByTestId('cmd-propertySheet').click();
    await page.getByTestId('pt-props-returnsRecords').selectOption({ label: fr.dialog.button.no });
    await page.getByTestId('pt-props-timeout').fill('3601');
    await page.getByTestId('pt-props-ok').click();
    await expect(page.getByTestId('pt-props-error')).toHaveText(fr.query.passThrough.badTimeout);
    await page.getByTestId('pt-props-timeout').fill('0');
    await page.getByTestId('pt-props-ok').click();
    await expect(page.getByTestId('pt-props')).toHaveCount(0);
    await page.keyboard.press('Control+s');
    await page.getByTestId('modal-input').fill('PAgg');
    await page.getByTestId('modal-btn-ok').click();
    await expect(page.getByTestId('nav-item-query-PAgg')).toBeVisible();
    expect(await definitionOf(page, 'PAgg')).toEqual({ formatVersion: '2.0', sql: text, passThrough: { kind: 'postgresql', params: { ...P, timeout: 0 }, returnsRecords: false } });

    // reopened in Design: SQL view, the text byte for byte, the properties kept
    await page.getByTestId('doc-tab-close-query-PAgg').click();
    await page.getByTestId('nav-item-query-PAgg').click({ button: 'right' });
    await page.getByTestId('nav-menu-design').click();
    await expect(sqlBox(page)).toHaveValue(text);
    await expect(page.getByTestId('status-view-design')).toBeDisabled();
    await page.getByTestId('cmd-propertySheet').click();
    await expect(page.getByTestId('pt-props-returnsRecords')).toHaveValue('no');
    await expect(page.getByTestId('pt-props-timeout')).toHaveValue('0');
    await page.getByTestId('pt-props-cancel').click();
    // back to a select query only when the text reads as Access SQL
    await page.getByTestId('cmd-selectQuery').click();
    await expect(doc(page).getByTestId('query-sql-error')).toBeVisible();
    await pressed(page, 'passThroughQuery', true);
    await sqlBox(page).fill('SELECT Nom FROM Clients');
    await page.getByTestId('cmd-selectQuery').click();
    await pressed(page, 'passThroughQuery', false);
    await expect(doc(page).getByTestId('query-sql-notice')).toHaveCount(0);
    await expect(page.getByTestId('status-view-design')).toBeEnabled();
  } finally {
    await app.close();
  }
});

test('C6 R3: « Autre serveur… » picks a server no link uses (password asked, never in the file)', async () => {
  test.setTimeout(120_000);
  const front = seedBase('Front');
  const { app, page } = await launchApp({ args: [front], env: ENV });
  try {
    await newPassThrough(page);
    await expect(page.getByTestId('pt-props-connection')).toHaveValue(''); // no linked server: none chosen
    await page.getByTestId('pt-props-cancel').click();
    await expect(doc(page).getByTestId('query-sql-notice')).toHaveText(fr.query.passThrough.noticeNoServer);
    await page.keyboard.press('Control+s');
    await expect(page.getByTestId('modal')).toContainText(fr.query.passThrough.empty);
    await page.getByTestId('modal-btn-ok').click();
    await sqlBox(page).fill('select 1');
    await page.keyboard.press('Control+s');
    await expect(page.getByTestId('modal')).toContainText(fr.query.passThrough.noConnection);
    await page.getByTestId('modal-btn-ok').click();

    await page.getByTestId('cmd-propertySheet').click();
    await page.getByTestId('pt-props-connection').selectOption({ label: fr.query.passThrough.otherServerKind.replace('{{product}}', 'PostgreSQL') });
    await expect(page.getByTestId('server-link-dialog')).toBeVisible();
    await page.getByTestId('srv-host').fill('autre.example');
    await page.getByTestId('srv-database').fill('compta');
    await page.getByTestId('srv-user').fill('ana');
    await page.getByTestId('srv-password').fill('faux');
    await page.getByTestId('srv-connect').click();
    await expect(page.getByTestId('srv-error')).toHaveText(fr.link.login.wrong);
    await page.getByTestId('srv-password').fill('secret');
    await page.getByTestId('srv-connect').click();
    await expect(page.getByTestId('pt-props')).toBeVisible(); // back to the sheet, the server chosen
    await expect(page.getByTestId('pt-props-connection').locator('option:checked')).toHaveText('autre.example:5432/compta');
    await page.getByTestId('pt-props-ok').click();
    await expect(doc(page).getByTestId('query-sql-notice')).toHaveText(fr.query.passThrough.notice.replace('{{label}}', 'autre.example:5432/compta'));
    await page.keyboard.press('Control+s');
    await page.getByTestId('modal-input').fill('PAutre');
    await page.getByTestId('modal-btn-ok').click();
    await expect(page.getByTestId('nav-item-query-PAutre')).toBeVisible();
    expect(await definitionOf(page, 'PAutre')).toEqual({ formatVersion: '2.0', sql: 'select 1',
      passThrough: { kind: 'postgresql', params: { host: 'autre.example', port: 5432, database: 'compta', user: 'ana', tls: 'verify-full', timeout: 60 }, returnsRecords: true } });
    await app.close();

    const [row] = inFile<{ definition: string }>(front, `SELECT definition FROM bc_objects WHERE name = 'PAutre'`);
    expect(row!.definition).toContain('autre.example');
    for (const file of [front, `${front}-wal`]) if (existsSync(file)) expect(readFileSync(file).toString('latin1')).not.toContain('secret');
  } finally {
    await app.close();
  }
});

test('C5 R13: « Autre serveur SQL Server… » opens the SQL Server connection dialog; Cancel returns to the sheet unchanged; the kind is saved', async () => {
  test.setTimeout(120_000);
  const front = seedBase('Front', (db) => addServerLinks(db, 'postgresql', P, [clients]));
  const { app, page } = await launchApp({ args: [front], env: ENV });
  const other = (product: string) => fr.query.passThrough.otherServerKind.replace('{{product}}', product);
  const title = page.getByTestId('modal').locator('.modal-title');
  try {
    await newPassThrough(page);
    const connection = page.getByTestId('pt-props-connection');
    await expect(connection.locator('option')).toHaveText(['db.example:5432/ventes', other('PostgreSQL'), other('SQL Server')]);
    await connection.selectOption({ label: other('SQL Server') });
    await expect(page.getByTestId('server-link-dialog')).toBeVisible();
    await expect(title).toHaveText(fr.link.server.titleSqlServer);
    await expect(page.getByTestId('srv-port')).toHaveValue('1433');
    await expect(page.getByTestId('srv-host')).toHaveValue(''); // never the PostgreSQL server's params
    await page.getByTestId('srv-cancel').click();
    await expect(page.getByTestId('pt-props')).toBeVisible();
    await expect(title).toHaveText(fr.query.props.title);
    await expect(connection.locator('option:checked')).toHaveText('db.example:5432/ventes');

    await connection.selectOption({ label: other('SQL Server') });
    await page.getByTestId('srv-host').fill('srv.example\\SQLEXPRESS');
    await expect(page.getByTestId('srv-port')).toBeDisabled();
    await page.getByTestId('srv-database').fill('compta');
    await page.getByTestId('srv-user').fill('ana');
    await page.getByTestId('srv-password').fill('secret');
    await page.getByTestId('srv-connect').click();
    await expect(page.getByTestId('pt-props')).toBeVisible();
    await expect(connection.locator('option:checked')).toHaveText('srv.example\\SQLEXPRESS/compta');
    await page.getByTestId('pt-props-ok').click();
    await expect(doc(page).getByTestId('query-sql-notice')).toHaveText(fr.query.passThrough.notice.replace('{{label}}', 'srv.example\\SQLEXPRESS/compta'));
    await sqlBox(page).fill('SELECT 1');
    await page.keyboard.press('Control+s');
    await page.getByTestId('modal-input').fill('PMs');
    await page.getByTestId('modal-btn-ok').click();
    await expect(page.getByTestId('nav-item-query-PMs')).toBeVisible();
    expect(await definitionOf(page, 'PMs')).toEqual({ formatVersion: '2.0', sql: 'SELECT 1',
      passThrough: { kind: 'sqlserver', params: { host: 'srv.example', instance: 'SQLEXPRESS', database: 'compta', user: 'ana', tls: 'verify-full', timeout: 60 }, returnsRecords: true } });
  } finally {
    await app.close();
  }
});

const RUN_SQL = 'select * from "Clients" -- as saved';
const pt = (returnsRecords: boolean, sql: string) => ({ formatVersion: '2.0', sql, passThrough: { kind: 'postgresql', params: P, returnsRecords } });
const RCLIENTS: DesignDoc = {
  formatVersion: '1.0', recordSource: { kind: 'query', name: 'PClients' }, props: { Width: 9072 },
  sections: [{ kind: 'detail', height: 400, props: {}, controls: [{ kind: 'textBox', name: 'Nom', left: 0, top: 0, width: 2268, height: 340, props: { ControlSource: 'Nom', BorderStyle: 'transparent' } }] }],
};
const cellAt = (page: Page, col: number, row: number) => page.getByTestId(`glide-cell-${col + 1}-${row}`);
/** The login prompt of the fake server, answered when it shows (the first read of a server in the session). */
async function loginIfAsked(page: Page) {
  const dialog = page.getByTestId('login-dialog');
  if (await dialog.waitFor({ state: 'visible', timeout: 5_000 }).then(() => true, () => false)) {
    await page.getByTestId('login-password').fill('secret');
    await page.getByTestId('login-ok').click();
    await expect(dialog).toHaveCount(0);
  }
}

// G1 (owner 2026-10-31): only Returns Records No is blocked in disabled mode.
test('C6: a pass-through datasheet and report, read-only, open in disabled mode; the action one is blocked until « Activer le contenu »', async () => {
  test.setTimeout(180_000);
  const front = seedBase('Run', (db) => {
    for (const [name, def] of [['PClients', pt(true, RUN_SQL)], ['UMaj', pt(false, "update \"Clients\" set \"Ville\" = 'X'")],
      ['QUn', { formatVersion: '1.0', sql: 'SELECT 1 AS Un' }]] as const) {
      const r = saveObject(db, 'query', name, def, null);
      if (!r.ok) throw new Error(r.reason);
    }
    const rep = saveObject(db, 'report', 'RClients', RCLIENTS, null);
    if (!rep.ok) throw new Error(rep.reason);
    const m = saveObject(db, 'macro', 'MMaj', { formatVersion: '1.0', items: [{ k: 'action', action: 'OpenQuery', args: { QueryName: 'UMaj' } }] }, null);
    if (!m.ok) throw new Error(m.reason);
  });
  const { app, page } = await launchApp({ args: [front], env: ENV, untrusted: true });
  try {
    await expect(page.getByTestId('banner-content')).toBeVisible();
    // Show Table leaves the pass-throughs out (R9: never a source; reading their fields would run them)
    await page.getByTestId('ribbon-tab-create').click();
    await page.getByTestId('cmd-createQueryDesign').click();
    await page.getByTestId('show-table-tab-queries').click();
    await expect(page.getByTestId('show-table-QUn')).toBeVisible();
    for (const n of ['PClients', 'UMaj']) await expect(page.getByTestId(`show-table-${n}`)).toHaveCount(0);
    await page.getByTestId('show-table-close').click();
    // the datasheet: the text as saved, read-only, sorted locally
    await page.getByTestId('nav-item-query-PClients').dblclick();
    await loginIfAsked(page);
    await expect(page.getByTestId('nav-record-count')).toHaveText('2');
    await expect(cellAt(page, 0, 0)).toHaveText(RUN_SQL);
    await expect(page.getByTestId('nav-new')).toBeDisabled();
    const b = (await page.getByTestId('datasheet').getByTestId('data-grid-canvas').boundingBox())!;
    await page.mouse.click(b.x + 44 + 30, b.y + 34 + 15); // Texte of the first row (selector 44 px, header 34, row 30)
    await expect(cellAt(page, 0, 0)).toBeFocused();
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowRight'); // Ville
    await expect(cellAt(page, 2, 0)).toBeFocused();
    await page.getByTestId('ribbon-tab-home').click();
    await page.getByTestId('cmd-sortDesc').click();
    await expect(cellAt(page, 1, 0)).toHaveText('Dupont'); // Lyon before Brest
    await expect(page.getByTestId('banner-content')).toBeVisible();
    // the report on it
    await page.getByTestId('nav-item-report-RClients').dblclick();
    await expect(page.getByTestId('report-pages')).toBeVisible();
    const text = (await layoutFromDom(page)).pages.flatMap((pg) => pg.bands.flatMap((b) => b.lines.map((l) => l[0]))).join(' ');
    expect(text).toContain('Dupont');
    expect(text).toContain('Martin');
    // the action one: blocked, the bar comes back (dismissed first), also from a macro
    await page.getByTestId('nav-item-query-UMaj').dblclick();
    await expect(page.getByTestId('modal')).toContainText(fr.query.action.contentDisabled);
    await page.getByTestId('modal-btn-ok').click();
    await page.getByTestId('banner-dismiss-content').click();
    await expect(page.getByTestId('banner-content')).toHaveCount(0);
    await page.getByTestId('ribbon-tab-databaseTools').click();
    await page.getByTestId('cmd-runMacro').click();
    await page.getByTestId('run-macro-name').fill('MMaj');
    await page.getByTestId('run-macro-name-list').getByRole('option', { name: 'MMaj', exact: true }).click();
    await page.getByTestId('run-macro-ok').click();
    await expect(page.getByTestId('modal')).toContainText(fr.query.action.contentDisabled); // the action's own message, then the macro's
    await page.getByTestId('modal-btn-ok').click();
    await expect(page.getByTestId('macro-failed')).toBeVisible();
    await expect(page.getByTestId('banner-content')).toBeVisible();
    await page.getByTestId('macro-failed-stop').click();
    // « Activer le contenu »: no question, done, no error dialog
    await page.getByTestId('banner-enable-content').click();
    await expect(page.getByTestId('banner-content')).toHaveCount(0);
    await page.getByTestId('nav-item-query-UMaj').dblclick();
    await expect(page.getByTestId('doc-tab-query-UMaj')).toHaveCount(0);
    await expect(page.getByTestId('modal')).toHaveCount(0);
  } finally {
    await app.close();
  }
});

// C6 Task 8 (owner 2026-10-31, option 2): a file not trusted never runs a pass-through on a remembered password.
test('C6 Task 8: a startup form on a pass-through in a file not trusted asks the remembered password; Cancel sends nothing, links keep it', async () => {
  test.setTimeout(180_000);
  const front = seedBase('Remember', (db) => {
    addServerLinks(db, 'postgresql', P, [clients]);
    for (const r of [saveObject(db, 'query', 'PClients', pt(true, RUN_SQL), null), saveObject(db, 'form', 'FClients', RCLIENTS, null)]) {
      if (!r.ok) throw new Error(r.reason);
    }
    saveStartupOptions(db, { ...DEFAULT_STARTUP, startupForm: 'FClients' }); // no active content: no bar
  });
  const nom = (page: Page) => doc(page).getByTestId('form-ctl-Nom');
  // trusted (a seeded folder): the startup form asks the login once, remembered
  let { app, page, userDataDir } = await launchApp({ args: [front], env: ENV });
  try {
    const canRemember = await app.evaluate(({ safeStorage }) => safeStorage.isEncryptionAvailable()
      && (process.platform !== 'linux' || !['basic_text', 'unknown'].includes(safeStorage.getSelectedStorageBackend())));
    test.skip(!canRemember, 'no keyring: nothing is remembered (G2)');
    await expect(page.getByTestId('login-dialog')).toBeVisible();
    await expect(page.getByTestId('login-untrusted')).toHaveCount(0); // nothing remembered yet: an ordinary prompt
    await expect(page.getByTestId('login-remember')).toBeChecked();
    await page.getByTestId('login-password').fill('secret');
    await page.getByTestId('login-ok').click();
    await expect(nom(page)).toHaveValue('Dupont');
    await app.close();
    const stored = readFileSync(join(userDataDir, 'credentials.json'), 'utf8');

    // a workstation that trusts nothing, the same user: the remembered password is asked again at open
    ({ app, page } = await launchApp({ args: [front], env: ENV, userDataDir, untrusted: true }));
    await expect(page.getByTestId('login-dialog')).toBeVisible();
    await expect(page.getByTestId('login-untrusted')).toHaveText(fr.link.login.untrusted); // it says why
    await expect(page.getByTestId('banner-content')).toHaveCount(0);
    await page.getByTestId('login-cancel').click();
    await expect(doc(page).getByRole('alert')).toHaveText(fr.dialog.error.linkUnavailable_needsLogin.replace('{{detail}}', 'db.example:5432/ventes'));
    await expect(page.getByTestId('login-dialog')).toHaveCount(0); // no loop
    await expect(page.getByTestId('modal')).toHaveCount(0);
    expect(readFileSync(join(userDataDir, 'credentials.json'), 'utf8')).toBe(stored); // kept: no refusal
    // a linked table of the same server still reads with it
    await page.getByTestId('nav-item-Clients').dblclick();
    await expect(page.getByTestId('login-dialog')).toHaveCount(0);
    await expect(page.getByTestId('nav-record-count')).toHaveText('2');
    // typed in this session: the pass-through runs
    await page.getByTestId('nav-item-query-PClients').dblclick();
    await expect(page.getByTestId('login-dialog')).toBeVisible();
    await page.getByTestId('login-password').fill('secret');
    await page.getByTestId('login-ok').click();
    await expect(page.getByTestId('nav-record-count')).toHaveText('2');
    await expect(cellAt(page, 0, 0)).toHaveText(RUN_SQL);
    await app.close();

    // trusted again (a trusted folder): the startup form runs on the remembered password, no prompt
    ({ app, page } = await launchApp({ args: [front], env: ENV, userDataDir }));
    await expect(nom(page)).toHaveValue('Dupont');
    await expect(page.getByTestId('login-dialog')).toHaveCount(0);
  } finally {
    await app.close();
  }
});
