// O3 acceptance (roadmap, batch O3): the Object Designers options, set through File › Options, apply — a new field takes the default type
// and size; a field named after an AutoIndex entry is indexed on creation and on import; a new query hides the Table row and joins
// related (and same-name key) tables itself; a marquee selects per the chosen behavior; a new report takes the left margin; every option
// survives a restart (same userDataDir).
import { test, expect, type Page } from '@playwright/test';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createTable } from '../../src/main/db/schema';
import { seedSales, seedSalesRelation } from '../../src/main/query/test-db';
import type { ControlDef, DesignDoc } from '../../src/shared/design/model';
import { f, t } from '../../src/shared/test-fixtures';
import { launchApp, seedBase, seedForm } from './helpers';

const FR = { BASECRAFT_REGION: 'fr-FR' };
const doc = (page: Page) => page.locator('section[role=tabpanel]:not([hidden])');
const cur = (page: Page) => page.locator('.doc:not([hidden])');
const ctl = (page: Page, name: string) => cur(page).getByTestId(`ctl-${name}`);
const design = (page: Page, table: string) => page.evaluate((n) => (window as any).basecraft.tables.design(n), table);
// FDeux: A 150–1284 twips and B 850–1984 on one line (they overlap)
const text = (name: string, left: number): ControlDef => ({ kind: 'textBox', name, left, top: 200, width: 1134, height: 340, props: {} });
const FDEUX: DesignDoc = { formatVersion: '1.0', recordSource: { kind: 'table', name: 'Clients' }, props: {}, sections: [
  { kind: 'formHeader', height: 0, props: { Visible: false }, controls: [] },
  { kind: 'detail', height: 1134, props: {}, controls: [text('A', 150), text('B', 850)] },
  { kind: 'formFooter', height: 0, props: { Visible: false }, controls: [] }] };

/** File › Options › `cat` (default: Concepteurs d'objets), runs `fn`, then back to the documents. */
async function options(page: Page, fn: () => Promise<void>, cat = 'designers') {
  await page.getByTestId('ribbon-tab-file').click();
  await page.getByTestId('bs-options').click();
  await page.getByTestId(`opt-cat-${cat}`).click();
  await fn();
  await page.getByTestId('bs-back').click();
}
const typed = async (page: Page, id: string, v: string) => { await page.getByTestId(id).fill(v); await page.getByTestId(id).press('Enter'); };
/** Create › Query Design, then Show Table's Add with `tables`. */
async function newQuery(page: Page, tables: string[]) {
  await page.getByTestId('ribbon-tab-create').click();
  await page.getByTestId('cmd-createQueryDesign').click();
  await expect(page.getByTestId('show-table')).toBeVisible();
  for (const n of tables) await page.getByTestId(`show-table-${n}`).check();
  await page.getByTestId('show-table-add').click();
  await page.getByTestId('show-table-close').click();
  for (const n of tables) await expect(doc(page).getByTestId(`qbe-box-${n}`)).toBeVisible();
}
async function closeTab(page: Page, tab: string) {
  await page.getByTestId(`doc-tab-close-${tab}`).click();
  const no = page.getByTestId('modal-btn-no');
  if (await no.isVisible().catch(() => false)) await no.click();
  await expect(page.getByTestId(`doc-tab-${tab}`)).toHaveCount(0);
}
async function drag(page: Page, x0: number, x1: number) {
  const b = (await cur(page).locator('[data-section-body="1"]').boundingBox())!;
  await page.mouse.move(b.x + x0, b.y + 65); await page.mouse.down(); await page.mouse.move(b.x + (x0 + x1) / 2, b.y + 30); await page.mouse.move(b.x + x1, b.y + 5); await page.mouse.up();
}
const selected = async (page: Page) => ({ A: await ctl(page, 'A').getAttribute('aria-pressed'), B: await ctl(page, 'B').getAttribute('aria-pressed') });
const margins = async (page: Page) => {
  await page.getByTestId('cmd-pageSetupDialog').click();
  const v = await Promise.all(['left', 'top', 'right', 'bottom'].map((s) => page.getByTestId(`page-setup-margin-${s}`).inputValue()));
  await page.getByTestId('modal-btn-cancel').click();
  await expect(page.getByTestId('modal')).toHaveCount(0);
  return v;
};

test('recette O3: field defaults, AutoIndex (creation and import), query options, marquee, margins, and a restart', async () => {
  test.setTimeout(300_000);
  const csv = join(mkdtempSync(join(tmpdir(), 'basecraft-o3-')), 'Imports.csv');
  writeFileSync(csv, 'NumClient;Nom\n1;Dupont\n2;Martin\n', 'utf8');
  const path = seedBase('recette-o3', (db) => {
    seedSales(db); seedSalesRelation(db);
    createTable(db, t('Villes', [f('Ville', 'shortText', { primaryKey: true, indexed: 'yesNoDuplicates' })]));
    seedForm(db, 'FDeux', FDEUX);
  });
  const first = await launchApp({ args: [path], env: { ...FR, BASECRAFT_E2E_IMPORT_PATH: csv } });
  const { userDataDir } = first;
  const page = first.page;
  try {
    // 1. « Numérique », « Entier », text size 50, the AutoIndex list; Table Design
    await options(page, async () => {
      await page.getByTestId('opt-field-type').selectOption({ label: 'Nombre' });
      await typed(page, 'opt-text-size', '50');
      await page.getByTestId('opt-number-size').selectOption({ label: 'Entier' });
      await typed(page, 'opt-autoindex', 'N°;clé;code;num');
    });
    await page.getByTestId('ribbon-tab-create').click();
    await page.getByTestId('cmd-createTableDesign').click();
    await expect(page.getByTestId('doc-tab-Table1')).toBeVisible();
    await page.getByTestId('design-row-0-name').fill('Quantité');
    await expect(page.getByTestId('design-row-0-type')).toHaveValue('number');
    await expect(page.getByTestId('prop-numberSize')).toHaveValue('integer');
    await page.getByTestId('design-row-1-name').fill('Libellé');
    await page.getByTestId('design-row-1-type').selectOption('shortText');
    await expect(page.getByTestId('prop-size')).toHaveValue('50');
    // 2. AutoIndex on creation
    await page.getByTestId('design-row-2-name').fill('CodeProduit');
    await page.keyboard.press('Tab');
    await expect(page.getByTestId('prop-indexed')).toHaveValue('yesDuplicates');
    await page.keyboard.press('Control+s');
    await page.getByTestId('modal-input').fill('Produits');
    await page.getByTestId('modal-btn-ok').click();
    await page.getByTestId('modal-btn-no').click();   // no primary key
    await expect(page.getByTestId('nav-item-Produits')).toBeVisible();
    const saved = (await design(page, 'Produits')).fields as { name: string; props: { indexed: string } }[];
    expect(saved.map((x) => [x.name, x.props.indexed])).toEqual([['Quantité', 'no'], ['Libellé', 'no'], ['CodeProduit', 'yesDuplicates']]);
    await page.getByTestId('doc-tab-close-Produits').click();
    // …and on import: the CSV to a new table, NumClient indexed
    await page.getByTestId('ribbon-tab-externalData').click();
    await page.getByTestId('cmd-importText').click();
    await page.getByTestId('import-browse').click();
    await page.getByTestId('import-btn-next').click();   // file
    await page.getByTestId('import-btn-next').click();   // format
    await expect(page.getByTestId('import-step')).toHaveAttribute('data-step', 'delimited');
    await page.getByTestId('import-btn-next').click();
    await expect(page.getByTestId('import-step')).toHaveAttribute('data-step', 'fields');
    await page.getByTestId('import-btn-next').click();
    await page.getByTestId('import-btn-next').click();
    await page.getByTestId('import-btn-finish').click();
    await expect(page.getByTestId('import-summary')).toBeVisible();
    await page.getByTestId('import-btn-close').click();
    const imp = (await design(page, 'Imports')).fields as { name: string; props: { indexed: string } }[];
    expect(imp.map((x) => [x.name, x.props.indexed])).toEqual([['N°', 'yesNoDuplicates'], ['NumClient', 'yesDuplicates'], ['Nom', 'no']]);

    // 3. a new query: related tables joined, same-name key joined (AutoJoin), no Table row; AutoJoin off: no join
    await options(page, async () => { await page.getByTestId('opt-table-names').uncheck(); await page.getByTestId('opt-output-all').check(); });
    await newQuery(page, ['Clients', 'Commandes']);
    await expect(doc(page).getByTestId('qbe-join-0')).toHaveAttribute('data-kind', 'inner');
    await expect(doc(page).getByTestId('qbe-join-1')).toHaveCount(0);
    await doc(page).getByTestId('qbe-field-Clients-Nom').dblclick();
    await expect(doc(page).getByTestId('qbe-cell-table-0')).toHaveCount(0);
    await closeTab(page, 'query-Requête1');
    await newQuery(page, ['Clients', 'Villes']);
    await expect(doc(page).getByTestId('qbe-join-0')).toHaveAttribute('data-kind', 'inner');
    await closeTab(page, 'query-Requête1');
    // the Query Builder of a form (empty Record Source) starts with Output All Fields
    await page.getByTestId('ribbon-tab-create').click();
    await page.getByTestId('cmd-createFormDesign').click();
    await page.getByTestId('prop-RecordSource-build').click();
    const builder = page.getByTestId('rowsource-builder');
    await expect(builder).toBeVisible();
    await page.getByTestId('cmd-propertySheet').click();
    await expect(page.getByTestId('query-props-outputAll')).toBeChecked();
    await page.getByTestId('rowsource-builder-tab-close').click();
    const no = page.getByTestId('modal-btn-no');
    if (await no.isVisible().catch(() => false)) await no.click();
    await expect(builder).toHaveCount(0);
    await closeTab(page, 'form-Formulaire1');
    await options(page, async () => { await page.getByTestId('opt-autojoin').uncheck(); });
    await newQuery(page, ['Clients', 'Villes']);
    await expect(doc(page).getByTestId('qbe-join-0')).toHaveCount(0);
    await closeTab(page, 'query-Requête1');

    // 4. the marquee: « Totalement encadrés » selects A only, « Partiellement encadré » A and B
    await options(page, async () => { await page.getByTestId('opt-select-full').check(); });
    await page.getByTestId('nav-item-form-FDeux').click({ button: 'right' });
    await page.getByTestId('nav-menu-design').click();
    await expect(cur(page).getByTestId('designer')).toBeVisible();
    await drag(page, 3, 94);
    expect(await selected(page)).toEqual({ A: 'true', B: 'false' });
    await options(page, async () => { await page.getByTestId('opt-select-partial').check(); });
    await drag(page, 3, 94);
    expect(await selected(page)).toEqual({ A: 'true', B: 'true' });
    await options(page, async () => { await page.getByTestId('opt-select-full').check(); });

    // 5. left margin 2 cm: a new report's Page Setup
    await options(page, async () => { await typed(page, 'opt-margin-left', '2'); }, 'client');
    await page.getByTestId('ribbon-tab-create').click();
    await page.getByTestId('cmd-createReportDesign').click();
    await expect(cur(page).getByTestId('designer')).toBeVisible();
    await page.getByTestId('ribbon-tab-pageSetup').click();
    expect(await margins(page)).toEqual(['2', '0,63', '0,63', '0,63']);
  } finally {
    await first.app.close();
  }

  // 6. restart, same profile: every option kept
  const again = await launchApp({ args: [path], env: FR, userDataDir });
  try {
    const p = again.page;
    await p.getByTestId('ribbon-tab-file').click();
    await p.getByTestId('bs-options').click();
    await p.getByTestId('opt-cat-designers').click();
    await expect(p.getByTestId('opt-field-type').locator('option:checked')).toHaveText('Nombre');
    await expect(p.getByTestId('opt-text-size')).toHaveValue('50');
    await expect(p.getByTestId('opt-number-size').locator('option:checked')).toHaveText('Entier');
    await expect(p.getByTestId('opt-autoindex')).toHaveValue('N°;clé;code;num');
    await expect(p.getByTestId('opt-table-names')).not.toBeChecked();
    await expect(p.getByTestId('opt-output-all')).toBeChecked();
    await expect(p.getByTestId('opt-autojoin')).not.toBeChecked();
    await expect(p.getByTestId('opt-select-full')).toBeChecked();
    await p.getByTestId('opt-cat-client').click();
    await expect(p.getByTestId('opt-margin-left')).toHaveValue('2,000 cm');
    await expect(p.getByTestId('opt-margin-right')).toHaveValue('0,635 cm');
  } finally {
    await again.app.close();
  }
});
