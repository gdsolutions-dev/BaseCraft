// O4 Task 8: Name AutoCorrect from the user's side — table field renames saved in Design view, Navigation Pane renames, a
// dependent open with unsaved changes (the rename is refused), Effectuer off, a dependent that cannot be corrected.
import { test, expect, type Page } from '@playwright/test';
import { saveObject } from '../../src/main/db/objects';
import type { ControlDef, DesignDoc } from '../../src/shared/design/model';
import { seedSales, seedSalesRelation } from '../../src/main/query/test-db';
import { launchApp, seedBase, inFile, SALES_QUERIES } from './helpers';

const FR = { BASECRAFT_REGION: 'fr-FR' };
const vis = (page: Page, id: string) => page.locator('.doc:not([hidden])').getByTestId(id);
const box = (kind: ControlDef['kind'], name: string, left: number, top: number, props: Record<string, unknown>): ControlDef =>
  ({ kind, name, left, top, width: 2268, height: 340, props });
const FCLIENTS: DesignDoc = { formatVersion: '1.0', recordSource: { kind: 'table', name: 'Clients' }, props: {}, sections: [
  { kind: 'formHeader', height: 0, props: { Visible: false }, controls: [] },
  { kind: 'detail', height: 2835, props: {}, controls: [box('textBox', 'Nom', 1418, 0, { ControlSource: 'Nom', TabIndex: 0 }), box('textBox', 'Calc', 1418, 567, { ControlSource: '=[Nom] & "!"', TabIndex: 1 })] },
  { kind: 'formFooter', height: 0, props: { Visible: false }, controls: [] }] };
const RVENTES: DesignDoc = { formatVersion: '1.0', recordSource: { kind: 'query', name: 'QVentes' }, props: {}, sections: [
  { kind: 'detail', height: 567, props: {}, controls: [box('textBox', 'Nom', 0, 0, { ControlSource: 'Nom' })] }] };

const seed = (name: string, options?: object) => seedBase(name, (db) => {
  seedSales(db); seedSalesRelation(db);
  for (const [q, sql] of SALES_QUERIES) saveObject(db, 'query', q, { formatVersion: '1.0', sql }, null);
  saveObject(db, 'query', 'QCassée', { formatVersion: '1.0', sql: 'SELEKT FROM WHERE [Ville] ((' }, null);
  saveObject(db, 'form', 'FClients', FCLIENTS, null);
  saveObject(db, 'report', 'RVentes', RVENTES, null);
  if (options) db.prepare("INSERT OR REPLACE INTO bc_meta (key, value) VALUES ('options', ?)").run(JSON.stringify({ startup: options }));
});
const def = (path: string, kind: string, name: string) => inFile<{ definition: string }>(path, `SELECT definition FROM bc_objects WHERE kind = '${kind}' AND name = '${name}'`)[0]?.definition ?? '';
const docOf = (path: string, kind: string, name: string) => JSON.parse(def(path, kind, name)) as DesignDoc;
const cs = (path: string) => docOf(path, 'form', 'FClients').sections.flatMap((s) => s.controls).map((c) => c.props.ControlSource);
const sqlOf = (path: string, q: string) => (JSON.parse(def(path, 'query', q)) as { sql: string }).sql;
const modalText = (page: Page) => page.getByTestId('modal');
const renameInPane = async (page: Page, item: string, to: string) => {
  await page.getByTestId(item).click({ button: 'right' });
  await page.getByTestId('nav-menu-rename').click();
  await page.getByTestId('modal-input').fill(to);
  await page.getByTestId('modal-btn-ok').click();
};
const designOfClients = async (page: Page) => {
  await page.getByTestId('nav-item-Clients').click({ button: 'right' });
  await page.getByTestId('nav-menu-design').click();
};

test('a field renamed in Table Design and saved corrects the query, the form and the report; no message', async () => {
  const path = seed('ac-field.basecraft');
  const { app, page } = await launchApp({ args: [path], env: FR });
  try {
    await designOfClients(page);
    await vis(page, 'design-row-1-name').fill('NomClient');
    await page.keyboard.press('Control+s');
    await expect.poll(() => sqlOf(path, 'QVentes')).toContain('[Clients].[NomClient]');
    await expect(modalText(page)).toHaveCount(0);
    expect(cs(path)).toEqual(['NomClient', '=[Nom] & "!"']);
    await page.getByTestId('nav-item-report-RVentes').dblclick();
    await expect(page.getByTestId('doc-tab-report-RVentes')).toBeVisible();
    await expect(page.getByTestId('doc-unavailable')).toHaveCount(0);
  } finally { await app.close(); }
});

test('Navigation Pane: a renamed query is followed by the report that uses it', async () => {
  const path = seed('ac-query.basecraft');
  const { app, page } = await launchApp({ args: [path], env: FR });
  try {
    await renameInPane(page, 'nav-item-query-QVentes', 'QV');
    await expect(page.getByTestId('nav-item-query-QV')).toBeVisible();
    await expect.poll(() => docOf(path, 'report', 'RVentes').recordSource).toEqual({ kind: 'query', name: 'QV' });
    await expect(modalText(page)).toHaveCount(0);
    await page.getByTestId('nav-item-report-RVentes').dblclick();
    await expect(page.getByTestId('doc-tab-report-RVentes')).toBeVisible();
    await expect(page.getByTestId('doc-unavailable')).toHaveCount(0);
  } finally { await app.close(); }
});

test('a form open in Design with unsaved changes refuses the table rename; saved, it goes through', async () => {
  const path = seed('ac-dirty.basecraft');
  const { app, page } = await launchApp({ args: [path], env: FR });
  try {
    await page.getByTestId('nav-item-form-FClients').click({ button: 'right' });
    await page.getByTestId('nav-menu-design').click();
    await vis(page, 'ctl-Calc').click();
    await vis(page, 'prop-Name').fill('Calc2');
    await vis(page, 'prop-Name').press('Enter');
    await expect(page.getByTestId('doc-tab-form-FClients')).toContainText('•');
    await renameInPane(page, 'nav-item-Clients', 'Clientèle');
    await expect(modalText(page)).toContainText("Enregistrez ou fermez d'abord");
    await expect(modalText(page)).toContainText('Formulaire FClients');
    await page.getByTestId('modal-btn-ok').click();
    expect(inFile(path, "SELECT name FROM sqlite_master WHERE name = 'Clientèle'")).toHaveLength(0);
    await page.keyboard.press('Control+s');
    await expect(page.getByTestId('doc-tab-form-FClients')).not.toContainText('•');
    await renameInPane(page, 'nav-item-Clients', 'Clientèle');
    await expect(page.getByTestId('nav-item-Clientèle')).toBeVisible();
    await expect.poll(() => docOf(path, 'form', 'FClients').recordSource).toEqual({ kind: 'table', name: 'Clientèle' });
  } finally { await app.close(); }
});

test('Effectuer off: the dependents are listed as still using the old name, unchanged', async () => {
  const path = seed('ac-off.basecraft', { performNameAutoCorrect: false });
  const before = def(path, 'form', 'FClients');
  const { app, page } = await launchApp({ args: [path], env: FR });
  try {
    await renameInPane(page, 'nav-item-Clients', 'Clientèle');
    await expect(modalText(page)).toContainText("encore l'ancien nom");
    await expect(modalText(page)).toContainText('Formulaire FClients');
    await expect(modalText(page)).toContainText('Requête QVentes');
    await page.getByTestId('modal-btn-ok').click();
    expect(def(path, 'form', 'FClients')).toBe(before);
    expect(sqlOf(path, 'QVentes')).toBe(SALES_QUERIES[2][1]);
  } finally { await app.close(); }
});

test('a dependent that cannot be corrected is reported and left unchanged', async () => {
  const path = seed('ac-failed.basecraft');
  const before = def(path, 'query', 'QCassée');
  const { app, page } = await launchApp({ args: [path], env: FR });
  try {
    await designOfClients(page);
    await vis(page, 'design-row-2-name').fill('Commune');
    await page.keyboard.press('Control+s');
    await expect(modalText(page)).toContainText("n'ont pas pu être corrigés");
    await expect(modalText(page)).toContainText('Requête QCassée');
    await page.getByTestId('modal-btn-ok').click();
    expect(def(path, 'query', 'QCassée')).toBe(before);
    expect(sqlOf(path, 'QClientsLyon')).toContain('Commune');
  } finally { await app.close(); }
});
