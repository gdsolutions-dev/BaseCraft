// O4 acceptance (roadmap, batch O4): Name AutoCorrect set through File › Options — a table's fields renamed in Design view and saved
// correct the queries, the form and the report that use them, in one go; the log table lists the changes; everything survives a
// restart (same userDataDir). A second scenario: a rename that rewrites a macro leaves the approved content approved.
import { test, expect, type Page } from '@playwright/test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { saveObject } from '../../src/main/db/objects';
import type { ControlDef, DesignDoc } from '../../src/shared/design/model';
import { seedSales, seedSalesRelation } from '../../src/main/query/test-db';
import { inFile, launchApp, layoutFromDom, openDbOptions, seedBase, SALES_QUERIES } from './helpers';

const FR = { BASECRAFT_REGION: 'fr-FR' };
const LOG = 'Journal de la correction automatique de nom';
const cur = (page: Page) => page.locator('.doc:not([hidden])');
const box = (name: string, left: number, top: number, source: string): ControlDef =>
  ({ kind: 'textBox', name, left, top, width: 2268, height: 340, props: { ControlSource: source, TabIndex: 0 } });
const FCLIENTS: DesignDoc = { formatVersion: '1.0', recordSource: { kind: 'table', name: 'Clients' }, props: {}, sections: [
  { kind: 'formHeader', height: 0, props: { Visible: false }, controls: [] },
  { kind: 'detail', height: 1134, props: {}, controls: [box('Nom', 1418, 0, 'Nom'), box('Ville', 1418, 567, 'Ville')] },
  { kind: 'formFooter', height: 0, props: { Visible: false }, controls: [] }] };
const RCLIENTS: DesignDoc = { formatVersion: '1.0', recordSource: { kind: 'query', name: 'QClientsLyon' },
  props: { Width: 9072, pageSetup: { orientation: 'portrait', margins: { top: 1134, right: 1134, bottom: 1134, left: 1134 } },
    grouping: [{ expression: 'Ville', order: 'asc', header: true, footer: false, keepTogether: 'no' }] }, sections: [
  { kind: 'groupHeader', groupLevel: 0, height: 400, props: {}, controls: [] },
  { kind: 'detail', height: 567, props: {}, controls: [box('Nom', 0, 0, 'Nom')] }] };

const seed = (name: string, extra?: (db: DatabaseSync) => void) => seedBase(name, (db) => {
  seedSales(db); seedSalesRelation(db);
  for (const [q, sql] of SALES_QUERIES) saveObject(db, 'query', q, { formatVersion: '1.0', sql }, null);
  saveObject(db, 'form', 'FClients', FCLIENTS, null);
  saveObject(db, 'report', 'RClients', RCLIENTS, null);
  extra?.(db);
});
const defOf = <T>(path: string, kind: string, name: string) => JSON.parse(inFile<{ definition: string }>(path, `SELECT definition FROM bc_objects WHERE kind = '${kind}' AND name = '${name}'`)[0]!.definition) as T;
const controls = (path: string, kind: string, name: string) => defOf<DesignDoc>(path, kind, name).sections.flatMap((s) => s.controls).map((c) => [c.name, c.props.ControlSource]);

test('recette O4: Name AutoCorrect options, a field rename corrects the query, form and report, the log, and a restart', async () => {
  test.setTimeout(300_000);
  const path = seed('recette-o4');
  const first = await launchApp({ args: [path], env: FR });
  const { userDataDir } = first;
  const page = first.page;
  try {
    // 1. « Historique de la correction automatique de nom » ticked
    await page.getByTestId('ribbon-tab-file').click();
    await openDbOptions(page);
    await page.getByTestId('opt-db-ac-log').check();
    await expect(page.getByTestId('opt-db-ac-log')).toBeChecked();
    await page.getByTestId('bs-back').click();

    // 2. Table Design of Clients: Nom → NomClient, Ville → Cité, Ctrl+S
    await page.getByTestId('nav-item-Clients').click({ button: 'right' });
    await page.getByTestId('nav-menu-design').click();
    await cur(page).getByTestId('design-row-1-name').fill('NomClient');
    await cur(page).getByTestId('design-row-2-name').fill('Cité');
    await page.keyboard.press('Control+s');
    await expect.poll(() => (defOf<{ sql: string }>(path, 'query', 'QVentes')).sql).toContain('[Clients].[NomClient]');
    await expect(page.getByTestId('modal')).toHaveCount(0);

    // 3. the SQL view, the form, the report
    await page.getByTestId('nav-item-query-QVentes').click({ button: 'right' });
    await page.getByTestId('nav-menu-design').click();
    await page.getByTestId('status-view-sql').click();
    await expect(cur(page).getByTestId('query-sql')).toHaveValue(/\[Clients\]\.\[NomClient\]/);
    expect(controls(path, 'form', 'FClients')).toEqual([['Nom', 'NomClient'], ['Ville', 'Cité']]);
    expect(controls(path, 'report', 'RClients')).toEqual([['Nom', 'NomClient']]);
    expect((defOf<DesignDoc>(path, 'report', 'RClients').props.grouping as { expression: string }[])[0]!.expression).toBe('Cité');
    await page.getByTestId('nav-item-form-FClients').click({ button: 'right' });
    await page.getByTestId('nav-menu-design').click();
    await cur(page).getByTestId('ctl-Nom').click();
    await expect(cur(page).getByTestId('prop-ControlSource')).toHaveValue('NomClient');
    await page.getByTestId('nav-group-report').getByTestId('nav-item-report-RClients').dblclick();
    await expect(page.getByTestId('doc-tab-report-RClients')).toBeVisible();
    await expect(cur(page).getByTestId('report-preview')).toBeVisible();
    const text = (await layoutFromDom(page)).pages.flatMap((p) => p.bands.flatMap((b) => b.lines.map((l) => l[0]))).join(' ');
    expect(text).toContain('Dupont');
    expect(text).toContain('Martin');
    await expect(page.getByTestId('doc-unavailable')).toHaveCount(0);

    // 4. the log table is in the Navigation Pane, its datasheet lists the rows
    await page.getByTestId(`nav-item-${LOG}`).dblclick();
    await expect(page.getByTestId(`doc-tab-${LOG}`)).toBeVisible();
    await expect(cur(page).getByTestId('data-grid-canvas')).toBeVisible();
  } finally {
    await first.app.close();
  }
  type Row = { o: string; c: string | null; p: string; a: string; n: string };
  const rows = () => inFile<Row>(path, `SELECT "Nom de l'objet" AS o, "Nom du contrôle" AS c, "Nom de la propriété" AS p, "Ancienne valeur" AS a, "Nouvelle valeur" AS n FROM "${LOG}"`);
  const logged = (o: string, c: string | null, p: string) => rows().find((r) => r.o === o && r.c === c && r.p === p);
  expect(logged('QVentes', null, 'SQL')).toMatchObject({ a: expect.stringContaining('Clients.Nom'), n: expect.stringContaining('[Clients].[NomClient]') });
  expect(logged('QClientsLyon', null, 'SQL')?.n).toContain('Cité');
  expect(logged('FClients', 'Nom', 'ControlSource')).toMatchObject({ a: 'Nom', n: 'NomClient' });
  expect(logged('RClients', 'Nom', 'ControlSource')).toMatchObject({ a: 'Nom', n: 'NomClient' });
  expect(logged('RClients', null, 'GroupLevel1')).toMatchObject({ a: 'Ville', n: 'Cité' });

  // 5. restart, same profile: the option and the corrections kept
  const again = await launchApp({ args: [path], env: FR, userDataDir });
  try {
    const p = again.page;
    await p.getByTestId('ribbon-tab-file').click();
    await openDbOptions(p);
    await expect(p.getByTestId('opt-db-ac-track')).toBeChecked();
    await expect(p.getByTestId('opt-db-ac-perform')).toBeChecked();
    await expect(p.getByTestId('opt-db-ac-log')).toBeChecked();
    await p.getByTestId('bs-back').click();
    await expect(p.getByTestId(`nav-item-${LOG}`)).toBeVisible();
    expect(controls(path, 'form', 'FClients')).toEqual([['Nom', 'NomClient'], ['Ville', 'Cité']]);
    expect(defOf<{ sql: string }>(path, 'query', 'QVentes').sql).toContain('[Clients].[NomClient]');
  } finally {
    await again.app.close();
  }
});

test('a rename that rewrites a macro leaves the approved content approved: the macro runs, no security bar', async () => {
  test.setTimeout(120_000);
  const path = seed('recette-o4-macro', (db) => {
    const r = saveObject(db, 'macro', 'MLyon', { formatVersion: '1.0', items: [
      { k: 'action', action: 'OpenForm', args: { FormName: 'FClients', View: 'form', WhereCondition: '[Ville] = "Lyon"' } },
      { k: 'action', action: 'RunSQL', args: { SQLStatement: 'UPDATE Commandes SET Montant = Montant * 2;' } }] }, null);
    if (!r.ok) throw new Error(r.reason);
  });
  const userDataDir = mkdtempSync(join(tmpdir(), 'basecraft-o4-'));
  const { app, page } = await launchApp({ args: [path], env: FR, userDataDir, untrusted: true });
  try {
    await expect(page.getByTestId('banner-content')).toBeVisible();
    await page.getByTestId('banner-enable-content').click();
    await expect(page.getByTestId('banner-content')).toHaveCount(0);
    await page.getByTestId('nav-item-Clients').click({ button: 'right' });
    await page.getByTestId('nav-menu-design').click();
    await cur(page).getByTestId('design-row-2-name').fill('Cité');
    await page.keyboard.press('Control+s');
    await expect.poll(() => JSON.stringify(defOf(path, 'macro', 'MLyon'))).toContain('[Cité] = \\"Lyon\\"');
    await expect(page.getByTestId('banner-content')).toHaveCount(0);
    await page.getByTestId('ribbon-tab-databaseTools').click();
    await page.getByTestId('cmd-runMacro').click();
    await page.getByTestId('run-macro-name').fill('MLyon');
    await page.getByTestId('run-macro-name-list').getByRole('option', { name: 'MLyon', exact: true }).click();
    await page.getByTestId('run-macro-ok').click();
    await expect(page.getByTestId('form-run')).toBeVisible();
    await expect(page.getByTestId('nav-record-count')).toHaveText('2');
    await page.getByTestId('modal-btn-yes').click();   // RunSQL: the count is asked
    await expect(page.getByTestId('macro-failed')).toHaveCount(0);
    await expect(page.getByTestId('banner-content')).toHaveCount(0);
    await expect.poll(() => inFile<{ m: number }>(path, 'SELECT Montant AS m FROM Commandes ORDER BY "N°"').map((r) => r.m)).toEqual([20.2, 0.2, 0.4, 199.98, 0.2]);
  } finally {
    await app.close();
  }
});
