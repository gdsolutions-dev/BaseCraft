// T2: a table's data macros. The designer (Table tab › Before Delete), the refusal shown by the datasheet, SetField on a typed row,
// an After Insert macro writing into another table, and a linked table's buttons off.
import { test, expect, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createTable } from '../../src/main/db/schema';
import { insertRow } from '../../src/main/db/write-layer';
import { localeInfo } from '../../src/shared/locale-format';
import type { DataMacros } from '../../src/shared/macro/data-macro';
import type { MacroDef, MacroItem } from '../../src/shared/macro/model';
import { f, t } from '../../src/shared/test-fixtures';
import { colLeft, launchApp, pickView, seedBase } from './helpers';

const fr = JSON.parse(readFileSync(join(__dirname, '../../src/shared/i18n/fr.json'), 'utf8'));
const FR = { BASECRAFT_REGION: 'fr-FR' };
const HEADER = 34, ROW = 30, MARKER = 44;
const clients = t('Clients', [f('N°', 'autoNumber'), f('Nom', 'shortText'), f('Ville', 'shortText')]);
const journal = t('Journal', [f('Id', 'autoNumber'), f('Texte', 'shortText', { size: 100 })]);
const def = (...items: MacroItem[]): MacroDef => ({ formatVersion: '1.0', items });
const act = (action: string, args: Record<string, string> = {}): MacroItem => ({ k: 'action', action, args });
const when = (cond: string, ...items: MacroItem[]): MacroItem => ({ k: 'if', branches: [{ cond, items }] });

const seed = (name: string, ...noms: string[]) => seedBase(name, async (db) => {
  createTable(db, clients);
  createTable(db, journal);
  for (const nom of noms) await insertRow(db, clients, { Nom: nom, Ville: 'Lyon' }, localeInfo('fr-FR'));
});
const setMacros = (page: Page, dm: DataMacros) => page.evaluate((m) => (window as any).basecraft.tables.saveDataMacros('Clients', m), dm as never);
const getMacros = (page: Page): Promise<DataMacros> => page.evaluate(() => (window as any).basecraft.tables.dataMacros('Clients'));
const rows = async (page: Page, table: string) =>
  (await page.evaluate((n) => (window as any).basecraft.rows.page(n, { offset: 0, limit: 100 }), table)).rows.map((r: { values: unknown[] }) => r.values) as unknown[][];
const canvas = (page: Page) => page.getByTestId('datasheet').getByTestId('data-grid-canvas').boundingBox().then((b) => b!);
const cellEditor = (page: Page) => page.getByTestId('grid-editor-portal').locator('textarea');
async function openSheet(page: Page) {
  await page.getByTestId('nav-item-Clients').dblclick();
  await expect(page.getByTestId('datasheet').getByTestId('data-grid-canvas')).toBeVisible();
}
/** The trailing row's Nom cell is clicked: a new record starts. */
async function newRecordAt(page: Page, row: number) {
  const b = await canvas(page);
  await page.mouse.click(b.x + colLeft(1) + 30, b.y + HEADER + row * ROW + ROW / 2);
  await expect(cellEditor(page)).toBeFocused();
}
async function clickSelector(page: Page, row: number) {
  const b = await canvas(page);
  await page.mouse.click(b.x + MARKER / 2, b.y + HEADER + row * ROW + ROW / 2);
  const tr = page.getByTestId('datasheet').locator(`tr[aria-rowindex="${row + 2}"]`);
  await expect(tr).toHaveAttribute('aria-selected', 'true');
}

test('Before Delete: built in the designer from the Table tab, saved with the table, the delete is refused with its message', async () => {
  test.setTimeout(120_000);
  const { app, page } = await launchApp({ args: [await seed('t2-delete', 'Dupont', 'Martin')], env: FR });
  try {
    await openSheet(page);
    await page.getByTestId('ribbon-tab-table').click();
    for (const id of ['beforeChange', 'beforeDelete', 'afterInsert', 'afterUpdate', 'afterDelete', 'namedMacro'])
      await expect(page.getByTestId(`cmd-${id}`)).not.toHaveAttribute('data-planned', /.+/);
    await page.getByTestId('cmd-beforeDelete').click();
    await expect(page.getByTestId('macro-design')).toBeVisible();
    await expect(page.getByTestId('doc-tab-macro-Clients : Avant suppression')).toBeVisible();
    // the catalog offers the data actions of the event, not the UI ones
    await page.getByTestId('cmd-actionCatalog').click();
    await expect(page.getByTestId('macro-catalog-item-RaiseError')).toBeVisible();
    await expect(page.getByTestId('macro-catalog-item-SetLocalVar')).toBeVisible();
    await expect(page.getByTestId('macro-catalog-item-SetField')).toHaveCount(0);   // Before Change only
    await expect(page.getByTestId('macro-catalog-item-OpenForm')).toHaveCount(0);
    await page.getByTestId('macro-catalog-item-RaiseError').dblclick();
    await page.getByTestId('macro-arg-0-ErrorDescription-input').fill('Suppression interdite');
    await page.getByTestId('macro-arg-0-ErrorDescription-input').press('Enter');
    await page.screenshot({ path: test.info().outputPath('data-macro-designer.png') });
    await page.keyboard.press('Control+s');
    await expect.poll(async () => (await getMacros(page)).events?.beforeDelete?.items[0]).toMatchObject({ action: 'RaiseError', args: { ErrorDescription: 'Suppression interdite' } });

    await page.getByTestId('doc-tab-Clients').click();
    await expect(page.getByTestId('datasheet').getByTestId('data-grid-canvas')).toBeVisible();
    await clickSelector(page, 0);
    await page.getByTestId('ribbon-tab-home').click();
    await page.getByTestId('cmd-deleteRecord').click();
    await page.getByTestId('modal-btn-yes').click();
    await expect(page.getByTestId('modal')).toContainText('Suppression interdite');
    await page.screenshot({ path: test.info().outputPath('data-macro-refused-delete.png') });
    await page.getByTestId('modal-btn-ok').click();
    expect(await rows(page, 'Clients')).toHaveLength(2);
  } finally {
    await app.close();
  }
});

test('Before Change: a typed row without a Ville is refused with the message, nothing saved; SetField uppercases Nom', async () => {
  test.setTimeout(120_000);
  const { app, page } = await launchApp({ enterMovesDown: true, args: [await seed('t2-change')], env: FR });
  try {
    await openSheet(page);
    await setMacros(page, { events: { beforeChange: def(when('IsNull([Ville])', act('RaiseError', { ErrorDescription: 'La ville est obligatoire' }))) } });
    await newRecordAt(page, 0);
    await page.keyboard.type('Dupont');
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('modal')).toContainText('La ville est obligatoire');
    await page.screenshot({ path: test.info().outputPath('data-macro-refused-write.png') });
    await page.getByTestId('modal-btn-ok').click();
    await page.keyboard.press('Escape');
    expect(await rows(page, 'Clients')).toHaveLength(0);

    await setMacros(page, { events: { beforeChange: def(act('SetField', { Name: 'Nom', Value: 'UCase([Nom])' })) } });
    await newRecordAt(page, 0);
    await page.keyboard.type('dupont');
    await page.keyboard.press('Enter');
    await expect.poll(async () => (await rows(page, 'Clients')).map((r) => r[1])).toEqual(['DUPONT']);
  } finally {
    await app.close();
  }
});

test('After Insert: a macro creates a row in another table; Create Data Macros lists the events and the named macros', async () => {
  test.setTimeout(120_000);
  const { app, page } = await launchApp({ args: [await seed('t2-after')], env: FR });
  try {
    await openSheet(page);
    await setMacros(page, { events: { afterInsert: def(act('CreateRecord', { TableName: 'Journal', Values: 'Texte = "Nouveau client " & [Nom]' })) }, named: { Verif: def(act('StopMacro')) } });
    await page.evaluate(() => (window as any).basecraft.rows.insert('Clients', { Nom: 'Durand', Ville: 'Nice' }));
    expect(await rows(page, 'Journal')).toEqual([[1, 'Nouveau client Durand']]);

    await page.getByTestId('ribbon-tab-table').click();
    await page.getByTestId('cmd-namedMacro').click();
    await expect(page.getByTestId('datamacro-named')).toContainText('Verif');
    await page.screenshot({ path: test.info().outputPath('data-macro-named-list.png') });
    await page.getByTestId('datamacro-close').click();
    // Table Design: Create Data Macros lists the five events; the one defined can be deleted
    await page.getByTestId('doc-tab-Clients').click();
    await page.getByTestId('ribbon-tab-table').click();
    await page.getByTestId('ribbon-tab-home').click();
    await pickView(page, 'viewDesign');
    await expect(page.getByTestId('ribbon-tab-design')).toBeVisible();
    await page.getByTestId('ribbon-tab-design').click();
    await expect(page.getByTestId('cmd-createDataMacros')).not.toHaveAttribute('data-planned', /.+/);
    await page.getByTestId('cmd-createDataMacros').click();
    await expect(page.getByTestId('datamacro-delete-afterInsert')).toBeEnabled();
    await expect(page.getByTestId('datamacro-delete-beforeChange')).toBeDisabled();
    await page.getByTestId('datamacro-delete-afterInsert').click();
    await page.getByTestId('modal-btn-yes').click();
    await expect.poll(async () => (await getMacros(page)).events?.afterInsert).toBeUndefined();
    expect((await getMacros(page)).named).toHaveProperty('Verif');
    await page.getByTestId('datamacro-close').click();
  } finally {
    await app.close();
  }
});
