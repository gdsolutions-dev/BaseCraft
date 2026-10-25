// Recette de l'étape A (spec, section 7) : une base neuve, tout par l'interface (région fr-FR) — trois tables en Création (NuméroAuto,
// Monétaire, Texte long) dont les produits importés d'Excel, deux relations avec intégrité, saisie maître/détail dans un formulaire
// instantané avec sous-formulaire, une requête paramétrée, l'état de factures regroupé par client en PDF avec des totaux exacts,
// l'export Excel et CSV de la requête puis le CSV réimporté, enfin Compacter et réparer, fermer et rouvrir : tout est intact.
import { test, expect, type Locator, type Page } from '@playwright/test';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import ExcelJS from 'exceljs';
import type { BasecraftApi } from '../../src/shared/api';
import { formatValue } from '../../src/shared/expr/format';
import { num } from '../../src/shared/expr/library';
import { formGrid, launchApp, layoutFromDom } from './helpers';

const fr = JSON.parse(readFileSync(join(__dirname, '../../src/shared/i18n/fr.json'), 'utf8'));
const fill = (s: string, p: Record<string, string | number>) => s.replace(/\{\{(\w+)\}\}/g, (_m, k: string) => String(p[k]));
type Win = { basecraft: BasecraftApi };

/** The shown element: the other tabs' views stay mounted, hidden, with the same test ids. */
const vis = (page: Page, id: string) => page.locator(`[data-testid="${id}"]:visible`);
const doc = (page: Page) => page.locator('section[role=tabpanel]:not([hidden])');
const rowsOf = (page: Page, table: string) => page.evaluate((n) => (window as unknown as Win).basecraft.rows.page(n, { offset: 0, limit: 100 })
  .then((p) => p.rows.map((r) => r.values)), table);
const names = (page: Page, kind: 'query' | 'form' | 'report') => page.evaluate((k) => (window as unknown as Win).basecraft.objects.list(k)
  .then((l) => l.map((o) => o.name).sort()), kind);
const tables = (page: Page) => page.evaluate(() => (window as unknown as Win).basecraft.tables.list().then((l) => l.map((t) => t.name).sort()));
/** Spaces compared loosely: ICU's group/currency separators (U+202F, U+00A0) may be substituted for a face (C12). */
const loose = (s: string) => s.replace(/\s/gu, ' ');
const money = (n: number) => loose(formatValue(num(n), 'currency', { locale: 'fr-FR', lang: 'fr' }));
const done = (rows: number) => (rows === 1 ? fr.exchange.done_one : fr.exchange.done_other).replace('{{count}}', String(rows));

async function drag(page: Page, from: Locator, to: Locator) {
  const a = (await from.boundingBox())!, b = (await to.boundingBox())!;
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
  await page.mouse.down();
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 6 });
  await page.mouse.up();
}
async function setProp(page: Page, name: string, value: string) {
  await vis(page, `prop-${name}`).fill(value);
  await vis(page, `prop-${name}`).press('Enter');
}
/** Create › Form on `source`, selected in the Navigation Pane (as Access: no source list). */
async function autoForm(page: Page, source: string) {
  await vis(page, `nav-item-${source}`).click();
  await vis(page, 'ribbon-tab-create').click();
  await vis(page, 'cmd-createForm').click();
  await expect(vis(page, `doc-tab-form-${source}`)).toHaveAttribute('aria-selected', 'true');
}
/** Create › Query Design, the tables added through Show Table, which opens by itself. */
async function newQuery(page: Page, tbls: string[]) {
  await page.getByTestId('ribbon-tab-create').click();
  await page.getByTestId('cmd-createQueryDesign').click();
  await expect(page.getByTestId('show-table')).toBeVisible();
  for (const t of tbls) await page.getByTestId(`show-table-${t}`).check();
  await page.getByTestId('show-table-add').click();
  await page.getByTestId('show-table-close').click();
  for (const t of tbls) await expect(doc(page).getByTestId(`qbe-box-${t}`)).toBeVisible();
}
async function saveQuery(page: Page, name: string) {
  await page.keyboard.press('Control+s');
  await page.getByTestId('modal-input').fill(name);
  await page.getByTestId('modal-btn-ok').click();
  await expect(page.getByTestId(`nav-item-query-${name}`)).toBeVisible();
  await expect(page.getByTestId(`doc-tab-query-${name}`)).not.toContainText('•');
  await page.getByTestId(`doc-tab-close-query-${name}`).click();
}
/** The parameter prompt of « Clients par ville », answered. */
async function answerVille(page: Page, ville: string) {
  await expect(page.getByTestId('modal')).toContainText('Ville ?');
  await page.getByTestId('modal-input').fill(ville);
  await page.getByTestId('modal-btn-ok').click();
}

const PARAM = 'Clients par ville';
const FACTURES = 'SELECT [Clients].[Nom] AS [Client], [Produits].[Nom] AS [Produit], [Commandes].[Quantité], [Produits].[Prix] * [Commandes].[Quantité] AS [Montant]\n'
  + 'FROM ([Clients] INNER JOIN [Commandes] ON [Clients].[N°] = [Commandes].[Client]) INNER JOIN [Produits] ON [Produits].[N°] = [Commandes].[Produit];';

test('recette A: from a new base to a compacted, reopened one, through the interface', async () => {
  test.setTimeout(360_000);
  const dir = mkdtempSync(join(tmpdir(), 'basecraft-recette-a-'));
  const base = join(dir, 'Ventes.basecraft');
  const xlsxIn = join(dir, 'produits.xlsx'), csvOut = join(dir, 'export.csv'), xlsxOut = join(dir, 'export.xlsx'), pdf = join(dir, 'Factures.pdf');
  const userDataDir = mkdtempSync(join(tmpdir(), 'basecraft-recette-a-ud-'));
  writeFileSync(join(userDataDir, 'settings.json'), JSON.stringify({ locale: 'fr' }));
  const wb = new ExcelJS.Workbook();
  const sheet = wb.addWorksheet('Produits');
  sheet.addRow(['Nom', 'Prix']);
  sheet.addRow(['Stylo', 1.5]);
  sheet.addRow(['Cahier', 4]);
  await wb.xlsx.writeFile(xlsxIn);
  const env = { BASECRAFT_REGION: 'fr-FR', BASECRAFT_E2E_SAVE_PATH: base, BASECRAFT_E2E_EXCEL_PATH: xlsxIn, BASECRAFT_E2E_PDF_PATH: pdf,
    BASECRAFT_E2E_EXPORT_PATH: csvOut, BASECRAFT_E2E_IMPORT_PATH: csvOut };
  const produits = [[1, 'Stylo', 1.5], [2, 'Cahier', 4]];
  const clients = [[1, 'Dupont', 'Lyon'], [2, 'Martin', 'Nantes']];
  const orders: [number, number, number][] = [[1, 1, 3], [1, 2, 2], [2, 2, 5]];   // client, produit, quantité
  const commandes = orders.map(([c, p, q], i) => [i + 1, c, p, q, null]);
  const amount = ([, p, q]: [number, number, number]) => (produits[p - 1]![2] as number) * q;
  const groupTotals = [1, 2].map((c) => orders.filter((o) => o[0] === c).reduce((a, o) => a + amount(o), 0));
  const reportTotal = orders.reduce((a, o) => a + amount(o), 0);
  const lyon = [['Dupont', 3, 'Lyon'], ['Dupont', 2, 'Lyon']];   // the parameter query's rows for Lyon

  let { app, page } = await launchApp({ env, userDataDir });
  try {
    // 1. a new base; Clients, Produits and Commandes in Design view
    await page.getByTestId('bs-new').click();
    await expect(page.getByTestId('nav-pane')).toBeVisible();
    const newTable = async (name: string, fields: [string, string][]) => {
      await page.getByTestId('ribbon-tab-create').click();
      await page.getByTestId('cmd-createTableDesign').click();
      await expect(page.getByTestId('doc-tab-Table1')).toBeVisible();
      for (const [i, [n, type]] of fields.entries()) {
        await page.getByTestId(`design-row-${i}-name`).fill(n);
        await page.getByTestId(`design-row-${i}-type`).selectOption(type);
      }
      await expect(page.getByTestId('design-row-0-key')).toHaveAttribute('data-primary-key', 'true');
      await page.keyboard.press('Control+s');
      await page.getByTestId('modal-input').fill(name);
      await page.getByTestId('modal-btn-ok').click();
      await expect(page.getByTestId(`nav-item-${name}`)).toBeVisible();
      await expect(page.getByTestId(`doc-tab-${name}`)).not.toContainText('•');
      await page.getByTestId(`doc-tab-close-${name}`).click();
    };
    await newTable('Clients', [['N°', 'autoNumber'], ['Nom', 'shortText'], ['Ville', 'shortText']]);
    await newTable('Produits', [['N°', 'autoNumber'], ['Nom', 'shortText'], ['Prix', 'currency']]);
    await newTable('Commandes', [['N°', 'autoNumber'], ['Client', 'number'], ['Produit', 'number'], ['Quantité', 'number'], ['Note', 'longText']]);
    const design = await page.evaluate(() => (window as unknown as Win).basecraft.tables.design('Commandes'));
    expect(design.fields.map((x) => [x.name, x.props.type])).toEqual([['N°', 'autoNumber'], ['Client', 'number'], ['Produit', 'number'],
      ['Quantité', 'number'], ['Note', 'longText']]);
    expect((await page.evaluate(() => (window as unknown as Win).basecraft.tables.design('Produits'))).fields[2]!.props.type).toBe('currency');

    // the Produits rows imported from an Excel sheet: Navigation Pane › Import › Excel, appended, columns mapped by name
    await page.getByTestId('nav-item-Produits').click({ button: 'right' });
    await page.getByTestId('nav-menu-import').click();
    await page.getByTestId('nav-menu-import-excel').click();
    await expect(page.getByTestId('import-dest-append')).toBeChecked();
    await page.getByTestId('import-browse').click();
    await expect(page.getByTestId('import-path')).toHaveValue(xlsxIn);
    await page.getByTestId('import-btn-next').click();
    await expect(page.getByTestId('import-step')).toHaveAttribute('data-step', 'sheet');
    await expect(page.getByTestId('import-sheet-Produits')).toBeChecked();
    await expect(page.getByTestId('import-preview')).toContainText('Cahier');
    await page.getByTestId('import-btn-next').click();
    await expect(page.getByTestId('import-step')).toHaveAttribute('data-step', 'fields');
    await page.getByTestId('import-btn-finish').click();
    await expect(page.getByTestId('import-summary-imported')).toHaveText(fill(fr.importText.finish.imported, { count: 2, table: 'Produits' }));
    await page.getByTestId('import-btn-close').click();
    expect(await rowsOf(page, 'Produits')).toEqual(produits);

    // 2. Relationships: Clients 1–∞ Commandes and Produits 1–∞ Commandes, with referential integrity
    await page.getByTestId('ribbon-tab-databaseTools').click();
    await page.getByTestId('cmd-relationships').click();
    for (const t of ['Clients', 'Produits', 'Commandes']) await page.getByTestId(`addtables-item-${t}`).check();
    await page.getByTestId('addtables-add').click();
    for (const [parent, child] of [['Clients', 'Client'], ['Produits', 'Produit']]) {
      await drag(page, page.getByTestId(`rel-field-${parent}-N°`), page.getByTestId(`rel-field-Commandes-${child}`));
      await expect(page.getByTestId('relation-parent')).toHaveValue(parent!);
      await expect(page.getByTestId('relation-cf-0')).toHaveValue(child!);
      await page.getByTestId('relation-enforce').check();
      await page.getByTestId('relation-ok').click();
      await expect(page.getByTestId('relation-dialog')).toHaveCount(0);
      await expect(page.getByTestId(`rel-line-${parent}Commandes-one`)).toHaveText('1');
      await expect(page.getByTestId(`rel-line-${parent}Commandes-many`)).toHaveText('∞');
    }
    await page.getByTestId('cmd-closeRelationships').click();
    expect(await page.evaluate(() => (window as unknown as Win).basecraft.relations.list())).toEqual(expect.arrayContaining([
      expect.objectContaining({ parentTable: 'Clients', parentFields: ['N°'], childTable: 'Commandes', childFields: ['Client'], enforce: true }),
      expect.objectContaining({ parentTable: 'Produits', parentFields: ['N°'], childTable: 'Commandes', childFields: ['Produit'], enforce: true })]));

    // 3. AutoForm on Commandes (the subform's source object), then on Clients with the Commandes subform (A4's recipe)
    await autoForm(page, 'Commandes');
    await vis(page, 'status-view-design').click();
    await vis(page, 'sheet-object').selectOption('doc');
    await vis(page, 'prop-DefaultView').selectOption('datasheet');
    await page.keyboard.press('Control+s');
    await expect(vis(page, 'doc-tab-form-Commandes')).not.toContainText('•');
    await autoForm(page, 'Clients');
    await vis(page, 'status-view-design').click();
    const detail = page.locator('[data-section-body="1"]:visible');
    await vis(page, 'sheet-object').selectOption('s:1');
    await setProp(page, 'Height', '10');
    await vis(page, 'ribbon-tab-formDesign').click();
    await vis(page, 'tool-subform').click();
    const d = (await detail.boundingBox())!, low = (await vis(page, 'ctl-Ville').boundingBox())!, x = (await vis(page, 'ctl-Ville_Étiquette').boundingBox())!;
    await detail.click({ position: { x: x.x - d.x + 2, y: low.y + low.height - d.y + 15 } });
    await setProp(page, 'Name', 'Commandes');
    await setProp(page, 'SourceObject', 'Commandes');
    await expect(vis(page, 'prop-LinkMasterFields')).toHaveValue('N°');
    await expect(vis(page, 'prop-LinkChildFields')).toHaveValue('Client');
    await setProp(page, 'Width', '14');
    await setProp(page, 'Height', '5');
    await page.keyboard.press('Control+s');
    await expect(vis(page, 'doc-tab-form-Clients')).not.toContainText('•');

    // two clients and three orders through the master/detail form: N°, Client, Produit, Quantité each 3 cm wide in the subform
    const ctl = (n: string) => vis(page, `form-ctl-${n}`);
    const s = formGrid(page, vis(page, 'form-ctl-Commandes'), [1701, 1701, 1701, 1701].map((tw) => tw / 15));
    const nav = vis(page, 'form-run').first().locator(':scope > .recnav');
    await vis(page, 'cmd-viewForm').click();
    for (const [c, nom, ville] of clients as [number, string, string][]) {
      if (c > 1) await nav.getByTestId('nav-new').click();
      await expect(ctl('Nom')).toHaveValue('');   // the new record is shown: a fill made before is lost when it appears
      await expect(ctl('Nom')).toBeEditable();
      await ctl('Nom').fill(nom);
      await ctl('Ville').fill(ville);
      await s.at(2, 0);   // entering the subform saves the client
      await expect.poll(() => rowsOf(page, 'Clients')).toEqual(clients.slice(0, c));
      await expect(s.count).toHaveText('0');
      for (const [row, [, p, q]] of orders.filter((o) => o[0] === c).entries()) {
        await s.click(2, row);
        await s.type(String(p));
        await s.click(3, row);
        await s.type(String(q));
        await ctl('Nom').click();   // leaving the subform saves its row
        await expect(s.count).toHaveText(String(row + 1));
      }
    }
    await expect.poll(() => rowsOf(page, 'Commandes')).toEqual(commandes);
    await expect(nav.getByTestId('nav-record-count')).toHaveText('2');
    await vis(page, 'doc-tab-close-form-Clients').click();
    await vis(page, 'doc-tab-close-form-Commandes').click();

    // 4. the parameter query [Ville ?], built in the design grid, returns Dupont's orders for Lyon
    await newQuery(page, ['Clients', 'Commandes']);
    for (const f of ['Clients-Nom', 'Commandes-Quantité', 'Clients-Ville']) await doc(page).getByTestId(`qbe-field-${f}`).dblclick();
    await doc(page).getByTestId('qbe-cell-criteria0-2').fill('[Ville ?]');
    await doc(page).getByTestId('qbe-cell-criteria0-2').press('Tab');
    await saveQuery(page, PARAM);
    await page.getByTestId(`nav-item-query-${PARAM}`).dblclick();
    await answerVille(page, 'Lyon');
    await expect(doc(page).getByTestId('nav-record-count')).toHaveText('2');
    await expect(doc(page).getByTestId('glide-cell-1-0')).toHaveText('Dupont');
    expect(await page.evaluate((n) => (window as unknown as Win).basecraft.sources.page({ kind: 'query', name: n }, { offset: 0, limit: 10, params: { 'Ville ?': 'Lyon' } })
      .then((p) => p.rows), PARAM)).toEqual(lyon);
    await page.getByTestId(`doc-tab-close-query-${PARAM}`).click();

    // 5. the invoice report: a query (SQL view) Client, Produit, Quantité, Montant; AutoReport, grouped by client, Sum; PDF
    await newQuery(page, ['Clients']);
    await doc(page).getByTestId('qbe-field-Clients-Nom').dblclick();
    await page.getByTestId('status-view-sql').click();
    await doc(page).getByTestId('query-sql').fill(FACTURES);
    await saveQuery(page, 'Factures');
    await page.getByTestId('nav-item-query-Factures').click();
    await page.getByTestId('ribbon-tab-create').click();
    await page.getByTestId('cmd-createReport').click();   // on the Navigation Pane's selection, as Access: no source list
    await expect(page.getByTestId('doc-tab-report-Factures')).toHaveAttribute('aria-selected', 'true');
    const cur = page.locator('.doc:not([hidden])');
    await expect(cur.getByTestId('preview-page-of')).toHaveText(/^Page 1 sur \d+$/);
    await page.getByTestId('ribbon-tab-home').click();
    await page.getByTestId('cmd-viewDesign').click();
    await expect(cur.getByTestId('designer')).toBeVisible();
    await page.getByTestId('ribbon-tab-reportDesign').click();
    await page.getByTestId('cmd-groupSort').click();
    await page.getByTestId('grouping-add-group').click();
    await page.getByTestId('grouping-field-Client').click();
    await expect(page.getByTestId('grouping-row-0-expression')).toHaveValue('Client');
    await page.getByTestId('grouping-row-0-footer').selectOption('true');
    await expect(page.getByTestId('section-groupFooter')).toContainText('Pied de groupe : Client');
    const body = (kind: string) => cur.locator('.dz-block', { has: page.getByTestId(`section-${kind}`) }).locator('.dz-body');
    await body('detail').getByTestId('ctl-Montant').click();
    await page.getByTestId('cmd-reportTotals').click();
    await page.getByTestId('totals-popup-Sum').click();
    await expect(body('groupFooter').getByTestId('ctl-Somme_Montant1')).toBeVisible();
    await page.getByTestId('ribbon-tab-home').click();
    await page.getByTestId('cmd-save').click();
    await expect(page.getByTestId('doc-tab-report-Factures')).not.toContainText('•');
    await page.getByTestId('ribbon-tab-reportDesign').click();
    await page.getByTestId('cmd-viewPrintPreview').click();
    await expect(cur.getByTestId('preview-page-of')).toHaveText(/^Page 1 sur \d+$/);
    const model = await layoutFromDom(page);
    const texts = (section: string) => model.pages.flatMap((p) => p.bands.filter((b) => b.section === section).flatMap((b) => b.lines.map((l) => loose(l[0]))));
    expect(texts('groupFooter')).toEqual(groupTotals.map(money));   // Dupont, Martin
    expect(texts('reportFooter')).toEqual(expect.arrayContaining([money(reportTotal)]));
    await page.getByTestId('cmd-exportPdf').click();
    await expect(page.getByTestId('modal')).toContainText(fr.report.pdfSaved);
    await page.getByTestId('modal-btn-ok').click();
    const pdfText = readFileSync(pdf).toString('latin1');
    expect(pdfText.startsWith('%PDF-')).toBe(true);
    expect(pdfText.match(/\/Type\s*\/Page[^s]/g)).toHaveLength(model.pages.length);
    await page.getByTestId('doc-tab-close-report-Factures').click();

    // 6. the parameter query exported to CSV and to Excel; the CSV imported into a new table: the same rows
    const exportQuery = async (kind: 'text' | 'excel') => {
      await page.getByTestId(`nav-item-query-${PARAM}`).click({ button: 'right' });
      await page.getByTestId('nav-menu-export').click();
      await page.getByTestId(`nav-menu-export-${kind}`).click();
      await answerVille(page, 'Lyon');
      if (kind === 'text') await page.getByTestId('export-text-ok').click();
      await expect(page.getByTestId('modal')).toContainText(done(2));
      await page.getByTestId('modal-btn-ok').click();
      await expect(page.getByTestId('modal')).toHaveCount(0);
    };
    await exportQuery('text');
    expect(readFileSync(csvOut, 'utf8').replace(/^﻿/, '').split('\r\n')).toEqual(['"Nom";"Quantité";"Ville"', '"Dupont";3;"Lyon"', '"Dupont";2;"Lyon"', '']);
    await app.evaluate((_e, p) => { process.env.BASECRAFT_E2E_EXPORT_PATH = p; }, xlsxOut);
    await exportQuery('excel');
    const out = new ExcelJS.Workbook();
    await out.xlsx.readFile(xlsxOut);
    const ws = out.worksheets[0]!;
    expect([1, 2, 3].map((r) => (ws.getRow(r).values as unknown[]).slice(1))).toEqual([['Nom', 'Quantité', 'Ville'], ...lyon]);

    await page.getByTestId('ribbon-tab-externalData').click();
    await page.getByTestId('cmd-importText').click();
    await expect(page.getByTestId('import-dest-new')).toBeChecked();
    await page.getByTestId('import-browse').click();
    await expect(page.getByTestId('import-path')).toHaveValue(csvOut);
    await page.getByTestId('import-btn-next').click();
    await expect(page.getByTestId('import-step')).toHaveAttribute('data-step', 'format');
    await page.getByTestId('import-btn-next').click();
    await expect(page.getByTestId('import-has-header')).toBeChecked();
    await page.getByTestId('import-btn-next').click();
    await expect(page.getByTestId('import-step')).toHaveAttribute('data-step', 'fields');
    await page.getByTestId('import-btn-next').click();
    await expect(page.getByTestId('import-pk-auto')).toBeChecked();
    await page.getByTestId('import-btn-next').click();
    await page.getByTestId('import-table-name').fill('Lyon');
    await page.getByTestId('import-btn-finish').click();
    await expect(page.getByTestId('import-summary-imported')).toHaveText(fill(fr.importText.finish.imported, { count: 2, table: 'Lyon' }));
    await expect(page.getByTestId('import-summary-errors')).toHaveText(fr.importText.finish.noErrors);
    await page.getByTestId('import-btn-close').click();
    expect((await rowsOf(page, 'Lyon')).map((r) => r.slice(1))).toEqual(lyon);

    // 7. Database Tools › Compact and Repair
    await page.getByTestId('ribbon-tab-databaseTools').click();
    await page.getByTestId('cmd-compactRepair').click();
    await expect(page.getByTestId('modal')).toContainText(fr.compact.title);
    await page.getByTestId('modal-btn-ok').click();
    await expect(page.getByTestId('modal')).toHaveCount(0);
  } finally {
    await app.close();
  }

  // 7. reopened: every table, query, form, report and row is intact; the form and the report still work
  ({ app, page } = await launchApp({ args: [base], env: { BASECRAFT_REGION: 'fr-FR' }, userDataDir }));
  try {
    for (const id of ['Clients', 'Produits', 'Commandes', 'Lyon', `query-${PARAM}`, 'query-Factures', 'form-Clients', 'form-Commandes', 'report-Factures']) {
      await expect(page.getByTestId(`nav-item-${id}`)).toBeVisible();
    }
    expect(await tables(page)).toEqual(['Clients', 'Commandes', 'Lyon', 'Produits']);
    expect(await names(page, 'query')).toEqual(['Clients par ville', 'Factures']);
    expect(await names(page, 'form')).toEqual(['Clients', 'Commandes']);
    expect(await names(page, 'report')).toEqual(['Factures']);
    expect(await rowsOf(page, 'Clients')).toEqual(clients);
    expect(await rowsOf(page, 'Produits')).toEqual(produits);
    expect(await rowsOf(page, 'Commandes')).toEqual(commandes);
    expect((await rowsOf(page, 'Lyon')).map((r) => r.slice(1))).toEqual(lyon);
    expect(await page.evaluate(() => (window as unknown as Win).basecraft.relations.list())).toHaveLength(2);

    await page.getByTestId('nav-item-form-Clients').dblclick();
    await expect(vis(page, 'form-ctl-Nom')).toHaveValue('Dupont');
    await expect(formGrid(page, vis(page, 'form-ctl-Commandes'), []).count).toHaveText('2');
    await page.getByTestId('nav-group-report').getByTestId('nav-item-report-Factures').dblclick();
    await expect(page.getByTestId('doc-tab-report-Factures')).toHaveAttribute('aria-selected', 'true');
    const model = await layoutFromDom(page);
    expect(model.pages.flatMap((p) => p.bands.filter((b) => b.section === 'groupFooter').flatMap((b) => b.lines.map((l) => loose(l[0])))))
      .toEqual(groupTotals.map(money));
  } finally {
    await app.close();
  }
});
