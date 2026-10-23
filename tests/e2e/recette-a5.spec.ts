// Recette A5 (feuille de route) : un état de factures regroupé par client, avec des totaux exacts, produit en PDF, puis rouvert
// intact ; et le volet Regrouper, trier et total, les éléments d'en-tête et de pied, Masquer les détails (A5, tâche 13).
import { test, expect, type Page } from '@playwright/test';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { formatValue } from '../../src/shared/expr/format';
import { num } from '../../src/shared/expr/library';
import { launchApp, layoutFromDom, seedBase, seedReportsE2E } from './helpers';

const fr = JSON.parse(readFileSync(join(__dirname, '../../src/shared/i18n/fr.json'), 'utf8'));
const ENV = { BASECRAFT_REGION: 'fr-FR' };
const cur = (page: Page) => page.locator('.doc:not([hidden])');
const pageOf = (page: Page) => cur(page).getByTestId('preview-page-of');
/** The body of a section of the active designer (the block that holds its bar). */
const body = (page: Page, kind: string) => cur(page).locator('.dz-block', { has: page.getByTestId(`section-${kind}`) }).locator('.dz-body');
/** Spaces compared loosely: ICU's group/currency separators (U+202F, U+00A0) may be substituted for a face (C12). */
const loose = (s: string) => s.replace(/\s/gu, ' ');
const money = (n: number) => loose(formatValue(num(n), 'currency', { locale: 'fr-FR', lang: 'fr' }));
const pages = async (page: Page) => Number((await pageOf(page).textContent())!.match(/sur (\d+)$/)![1]);

async function openDesign(page: Page, name: string) {
  await page.getByTestId('nav-group-report').getByTestId(`nav-item-report-${name}`).click({ button: 'right' });
  await page.getByTestId('nav-menu-design').click();
  await expect(cur(page).getByTestId('designer')).toBeVisible();
  await page.getByTestId('ribbon-tab-reportDesign').click();
}

test('recette A5: AutoReport, grouped by client with exact totals, PDF, reopened intact, page numbers', async () => {
  test.setTimeout(180000);
  const base = seedBase('recette-a5', seedReportsE2E);
  const pdfPath = join(mkdtempSync(join(tmpdir(), 'basecraft-recette-')), 'Factures.pdf');
  let { app, page } = await launchApp({ args: [base], env: { ...ENV, BASECRAFT_E2E_PDF_PATH: pdfPath } });
  try {
    // Créer > État on Factures: AutoReport, shown in Print Preview, then Design view
    await page.getByTestId('ribbon-tab-create').click();
    await page.getByTestId('cmd-createReport').click();
    await page.getByTestId('source-picker-list').selectOption('table:Factures');
    await page.getByTestId('source-picker-ok').click();
    await expect(page.getByTestId('doc-tab-report-Factures')).toHaveAttribute('aria-selected', 'true');
    await expect(pageOf(page)).toHaveText(/^Page 1 sur \d+$/);
    await page.getByTestId('ribbon-tab-home').click();
    await page.getByTestId('cmd-viewDesign').click();
    await expect(cur(page).getByTestId('designer')).toBeVisible();

    // Group & Sort: a group on Client, with a header and a footer
    await page.getByTestId('ribbon-tab-reportDesign').click();
    await page.getByTestId('cmd-groupSort').click();
    await expect(page.getByTestId('grouping-pane')).toBeVisible();
    await page.getByTestId('grouping-add-group').click();
    await page.getByTestId('grouping-field-Client').click();
    await expect(page.getByTestId('grouping-row-0')).toContainText(fr.report.grouping.groupOn);
    await expect(page.getByTestId('grouping-row-0-expression')).toHaveValue('Client');
    await expect(page.getByTestId('grouping-row-0-order').locator('option:checked')).toHaveText(fr.report.grouping.orderBy.text.asc);
    await expect(page.getByTestId('section-groupHeader')).toContainText('En-tête de groupe : Client');
    await expect(page.getByTestId('section-groupFooter')).toHaveCount(0);
    await page.getByTestId('grouping-row-0-footer').selectOption('true');
    await expect(page.getByTestId('section-groupFooter')).toContainText('Pied de groupe : Client');

    // Repeat Section on the group header
    await page.getByTestId('section-groupHeader').click();
    await expect(page.getByTestId('cmd-reportTotals')).toBeDisabled();   // no bound text box selected
    await page.getByTestId('prop-RepeatSection').selectOption('true');
    await expect(page.getByTestId('prop-RepeatSection')).toHaveValue('true');

    // Totals › Sum on Montant: in the group footer (the report footer already has AutoReport's sum)
    await body(page, 'detail').getByTestId('ctl-Montant').click();
    await page.getByTestId('cmd-reportTotals').click();
    await expect(page.getByTestId('totals-popup')).toBeVisible();
    await expect(page.getByTestId('totals-popup-StDev')).toHaveText(fr.report.totals.StDev);
    await page.getByTestId('totals-popup-Sum').click();
    await expect(page.getByTestId('totals-popup')).toHaveCount(0);
    await expect(body(page, 'groupFooter').getByTestId('ctl-Somme_Montant1')).toBeVisible();
    await expect(page.getByTestId('prop-ControlSource')).toHaveValue('=Somme([Montant])');
    if (process.env.BC_SCREENSHOTS) await page.screenshot({ path: join(process.env.BC_SCREENSHOTS, 'report-grouping.png') });

    // saved, then Print Preview: exact totals per client and for the report
    await page.getByTestId('ribbon-tab-home').click();
    await page.getByTestId('cmd-save').click();
    await expect(page.getByTestId('doc-tab-report-Factures')).not.toContainText('•');
    await page.getByTestId('ribbon-tab-reportDesign').click();
    await page.getByTestId('cmd-viewPrintPreview').click();
    await expect(pageOf(page)).toHaveText(/^Page 1 sur \d+$/);
    const model = await layoutFromDom(page);
    const texts = (section: string) => model.pages.flatMap((p) => p.bands.filter((b) => b.section === section).flatMap((b) => b.lines.map((l) => loose(l[0]))));
    expect(texts('groupFooter')).toEqual([money(6), money(121), money(19999.9)]);   // Dupont, Durand, Martin
    expect(texts('reportFooter')).toEqual(expect.arrayContaining([money(20126.9)]));

    // PDF: as many pages as the preview
    const shown = await pages(page);
    expect(model.pages).toHaveLength(shown);
    await page.getByTestId('cmd-exportPdf').click();
    await expect(page.getByTestId('modal')).toContainText(fr.report.pdfSaved);
    await page.getByTestId('modal-btn-ok').click();
    const pdf = readFileSync(pdfPath).toString('latin1');
    expect(pdf.startsWith('%PDF-')).toBe(true);
    expect(pdf.match(/\/Type\s*\/Page[^s]/g)).toHaveLength(shown);
    await app.close();

    // reopened: the report, its grouping and its total are intact
    ({ app, page } = await launchApp({ args: [base], env: ENV }));
    await openDesign(page, 'Factures');
    await expect(body(page, 'groupFooter').getByTestId('ctl-Somme_Montant1')).toBeVisible();
    await page.getByTestId('cmd-groupSort').click();
    await expect(page.getByTestId('grouping-row-0-expression')).toHaveValue('Client');
    await expect(page.getByTestId('grouping-row-0-header')).toHaveValue('true');
    await expect(page.getByTestId('grouping-row-0-footer')).toHaveValue('true');
    await page.getByTestId('section-groupHeader').click();
    await expect(page.getByTestId('prop-RepeatSection')).toHaveValue('true');

    // Page Numbers: Page N sur M, bottom of page, next to AutoReport's own
    await page.getByTestId('cmd-pageNumbers').click();
    await expect(page.getByTestId('page-numbers-format-pageN')).toBeChecked();   // Access's defaults
    await expect(page.getByTestId('page-numbers-first-page')).toBeChecked();
    await page.getByTestId('page-numbers-format-pageNofM').check();
    await page.getByTestId('page-numbers-position-bottom').check();
    await page.getByTestId('modal-btn-ok').click();
    await expect(body(page, 'pageFooter').getByTestId('ctl-Numéro_Page1')).toBeVisible();
    await page.getByTestId('cmd-viewPrintPreview').click();
    await expect(page.getByTestId('modal')).toContainText(fr.report.saveFirst.replace('{{name}}', 'Factures'));
    await page.getByTestId('modal-btn-yes').click();
    await expect(pageOf(page)).toHaveText(/^Page 1 sur \d+$/);
    const n = await pages(page);
    await cur(page).getByTestId('preview-nav-last').click();
    const last = cur(page).locator(`.bc-page[data-page="${n}"] .bc-band[data-section="pageFooter"] .bc-line`);
    await expect(last.filter({ hasText: `Page ${n} sur ${n}` })).toHaveCount(2);
  } finally {
    await app.close();
  }
});

test('Group, Sort and Total pane: sort rows, move, removal asks first, undo; Hide Details; Title, Date and Time, Logo; read-only', async () => {
  test.setTimeout(120000);
  const base = seedBase('regroupement', seedReportsE2E);
  const a = await launchApp({ args: [base], env: ENV });
  try {
    const page = a.page;
    await openDesign(page, 'Factures par client');
    await page.getByTestId('cmd-groupSort').click();
    await expect(page.getByTestId('grouping-row-0-expression')).toHaveValue('Client');
    // a sort on Date: no section, « Trier par »
    await page.getByTestId('grouping-add-sort').click();
    await page.getByTestId('grouping-field-Date').click();
    await expect(page.getByTestId('grouping-row-1')).toContainText(fr.report.grouping.sortBy);
    await expect(page.getByTestId('grouping-row-1-order').locator('option')).toHaveText([fr.report.grouping.orderBy.date.asc, fr.report.grouping.orderBy.date.desc]);
    await expect(page.locator('[data-testid="section-groupHeader"]')).toHaveCount(1);
    // typed expression, in display form; an aggregate is refused
    await page.getByTestId('grouping-row-1-expression').fill('=Année([Date])');
    await page.getByTestId('grouping-row-1-expression').press('Enter');
    await expect(page.getByTestId('grouping-row-1-expression')).toHaveValue('=Année([Date])');
    await expect(page.getByTestId('grouping-row-1-order').locator('option:checked')).toHaveText(fr.report.grouping.asc);   // an expression
    await page.getByTestId('grouping-row-1-expression').fill('=Somme([Montant])');
    await page.getByTestId('grouping-row-1-expression').press('Enter');
    await expect(page.getByTestId('grouping-row-1-expression-error')).toBeVisible();
    await page.getByTestId('grouping-row-1-expression').press('Escape');
    await expect(page.getByTestId('grouping-row-1-expression')).toHaveValue('=Année([Date])');
    // move up: the sort becomes level 0, the client header follows its level
    await page.getByTestId('grouping-row-1-up').click();
    await expect(page.getByTestId('grouping-row-0')).toContainText(fr.report.grouping.sortBy);
    await expect(page.getByTestId('grouping-row-0-down')).toBeFocused();   // the moved level keeps the focus (its Up is off at the top)
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('grouping-row-1')).toContainText(fr.report.grouping.sortBy);
    await expect(page.getByTestId('grouping-row-1-up')).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(body(page, 'groupHeader').getByTestId('ctl-Client')).toBeVisible();
    await page.getByTestId('section-detail').click();
    await page.keyboard.press('Control+z');
    await expect(page.getByTestId('grouping-row-0')).toContainText(fr.report.grouping.groupOn);
    // removing the client level drops controls: asked first (No keeps it)
    await page.getByTestId('grouping-row-0-delete').click();
    await expect(page.getByTestId('modal')).toContainText(fr.report.confirmRemoveSections);
    await page.getByTestId('modal-btn-no').click();
    await expect(page.getByTestId('grouping-row-1')).toBeVisible();
    await page.getByTestId('grouping-row-0-header').selectOption('false');
    await page.getByTestId('modal-btn-yes').click();
    await expect(page.getByTestId('section-groupHeader')).toHaveCount(0);
    await expect(page.getByTestId('grouping-row-0')).toContainText(fr.report.grouping.groupOn);   // the footer is left
    // after a delete, the focus goes to the next row, else to « Ajouter un groupe »
    await page.getByTestId('grouping-add-sort').click();
    await page.getByTestId('grouping-field-Libellé').click();
    await page.getByTestId('grouping-row-1-delete').click();
    await expect(page.getByTestId('grouping-row-1-expression')).toHaveValue('Libellé');
    await expect(page.getByTestId('grouping-row-1-delete')).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('grouping-row-1')).toHaveCount(0);
    await expect(page.getByTestId('grouping-add-group')).toBeFocused();
    await page.getByTestId('grouping-row-0-delete').click();   // its footer has controls: asked first, then the focus moves on
    await page.getByTestId('modal-btn-yes').click();
    await expect(page.getByTestId('grouping-row-0')).toHaveCount(0);
    await expect(page.getByTestId('grouping-add-group')).toBeFocused();
    await page.getByTestId('section-detail').click();
    await page.keyboard.press('Control+z');
    await expect(page.getByTestId('grouping-row-0')).toBeVisible();
    await page.getByTestId('grouping-close').click();
    await expect(page.getByTestId('grouping-pane')).toHaveCount(0);

    // Hide Details: the Detail's Visible, undoable
    await page.getByTestId('cmd-hideDetails').click();
    await page.getByTestId('section-detail').click();
    await expect(page.getByTestId('prop-Visible')).toHaveValue('false');
    await page.keyboard.press('Control+z');
    await expect(page.getByTestId('prop-Visible')).toHaveValue('true');
    // the focus left on the ribbon button: Ctrl+Z and Ctrl+Y still reach the report (as in Form Design)
    await page.getByTestId('cmd-hideDetails').click();
    await expect(page.getByTestId('prop-Visible')).toHaveValue('false');
    await page.keyboard.press('Control+z');
    await expect(page.getByTestId('prop-Visible')).toHaveValue('true');
    await page.keyboard.press('Control+y');
    await expect(page.getByTestId('prop-Visible')).toHaveValue('false');
    await page.keyboard.press('Control+z');
    await expect(page.getByTestId('prop-Visible')).toHaveValue('true');

    // Title, Date and Time, Logo: in the report header; a title, a date and a time already there are selected, not copied
    await page.getByTestId('cmd-title').click();
    await expect(body(page, 'reportHeader').getByTestId('ctl-Titre')).toHaveAttribute('aria-pressed', 'true');   // the fixture's « Titre »
    await expect(page.getByTestId('ctl-Titre1')).toHaveCount(0);
    for (let i = 0; i < 2; i++) await page.getByTestId('cmd-dateTime').click();
    await expect(body(page, 'reportHeader').getByTestId('ctl-Auto_Date')).toContainText('=Date()');
    await expect(body(page, 'reportHeader').getByTestId('ctl-Auto_Heure')).toContainText('=Temps()');
    await expect(body(page, 'reportHeader').getByTestId('ctl-Auto_Heure')).toHaveAttribute('aria-pressed', 'true');
    await expect(cur(page).locator('[data-testid^="ctl-Auto_Date"]')).toHaveCount(1);
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
    await page.getByTestId('report-logo-file').setInputFiles({ name: 'logo.png', mimeType: 'image/png', buffer: png });
    await expect(body(page, 'reportHeader').getByTestId('ctl-Auto_Logo').locator('img')).toHaveAttribute('src', /^data:image\/png;base64,/);
    const logoBox = (await body(page, 'reportHeader').getByTestId('ctl-Auto_Logo').boundingBox())!;
    expect((await body(page, 'reportHeader').getByTestId('ctl-Titre').boundingBox())!.x).toBeGreaterThan(logoBox.x + logoBox.width);   // the title moved after it
    await page.getByTestId('report-logo-file').setInputFiles({ name: 'big.png', mimeType: 'image/png', buffer: Buffer.alloc(1024 * 1024 + 1) });
    await expect(page.getByTestId('modal')).toContainText(fr.sheet.error.pictureTooLarge);
    await page.getByTestId('modal-btn-ok').click();
    await expect(cur(page).locator('[data-testid^="ctl-Auto_Logo"]')).toHaveCount(1);
  } finally {
    await a.app.close();
  }

  // a read-only base: the pane opens disabled, the editing commands are off
  const first = await launchApp({ args: [base] });
  const second = await launchApp({ args: [base], env: ENV });
  try {
    const page = second.page;
    await expect(page.getByTestId('banner-readonly')).toBeVisible();
    await openDesign(page, 'Factures par client');
    for (const id of ['reportTotals', 'hideDetails', 'pageNumbers', 'logo', 'title', 'dateTime']) await expect(page.getByTestId(`cmd-${id}`), id).toBeDisabled();
    await page.getByTestId('cmd-groupSort').click();
    await expect(page.getByTestId('grouping-row-0-footer')).toBeDisabled();
    await expect(page.getByTestId('grouping-add-group')).toBeDisabled();
  } finally {
    await second.app.close();
    await first.app.close();
  }
});
