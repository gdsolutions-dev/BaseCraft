// État en mode Création (A5, tâche 12) : Créer › Création d'état, Feuille de propriétés, Liste des champs, menu des barres de section
// (paires d'en-tête/pied, confirmation quand des contrôles disparaissent), mise en page du ruban (annulable), enregistrement,
// Aperçu avant impression et retour, menu du volet (C6), base en lecture seule, mise en page depuis l'aperçu.
import { test, expect, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { BasecraftApi } from '../../src/shared/api';
import { resolveColor } from '../../src/shared/design/colors';
import type { DesignDoc } from '../../src/shared/design/model';
import { launchApp, seedBase, seedReportsE2E } from './helpers';

const fr = JSON.parse(readFileSync(join(__dirname, '../../src/shared/i18n/fr.json'), 'utf8'));
const REPORT = 'Factures par client';
const seed = () => seedBase('etats-creation', seedReportsE2E);
const cur = (page: Page) => page.locator('.doc:not([hidden])');
const pageOf = (page: Page) => cur(page).getByTestId('preview-page-of');
const visiblePages = (page: Page) => cur(page).locator('.bc-page');
const hexToRgb = (h: string) => `rgb(${[1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)).join(', ')})`;
/** The body of a section of the active designer (the block that holds its bar). */
const body = (page: Page, kind: string) => cur(page).locator('.dz-block', { has: page.getByTestId(`section-${kind}`) }).locator('.dz-body');
const selected = (page: Page, tab: string) => expect(page.getByTestId(`ribbon-tab-${tab}`)).toHaveAttribute('aria-selected', 'true');
const menuLayout = (page: Page) => page.getByTestId('nav-menu').evaluate((m) =>
  [...m.children].map((e) => (e.getAttribute('role') === 'separator' ? '|' : (e.querySelector('[role="menuitem"]') ?? e).getAttribute('data-testid')!.replace('nav-menu-', ''))));

/** Mise en page… shows `orientation` checked, then is cancelled. */
async function expectOrientation(page: Page, orientation: 'portrait' | 'landscape') {
  await page.getByTestId('cmd-pageSetupDialog').click();
  await expect(page.getByTestId(`page-setup-${orientation}`)).toBeChecked();
  await page.getByTestId('modal-btn-cancel').click();
  await expect(page.getByTestId('modal')).toHaveCount(0);
}

test('Report Design view: create, Field List, section pairs, page setup, save, Print Preview and back, pane menu', async () => {
  test.setTimeout(120000);
  const { app, page } = await launchApp({ args: [seed()], env: { BASECRAFT_REGION: 'fr-FR' } });
  try {
    await page.getByTestId('ribbon-tab-create').click();
    await page.getByTestId('cmd-createReportDesign').click();
    await expect(page.getByTestId('doc-tab-report-État1')).toBeVisible();
    await expect(cur(page).getByTestId('designer')).toBeVisible();
    await selected(page, 'reportDesign');
    for (const id of ['arrange', 'pageSetup']) await expect(page.getByTestId(`ribbon-tab-${id}`)).toBeVisible();
    await expect(page.getByTestId('cmd-viewPrintPreview')).toBeDisabled(); // not saved yet
    for (const kind of ['pageHeader', 'detail', 'pageFooter']) await expect(page.getByTestId(`section-${kind}`)).toBeVisible();

    // source, then the Field List: Enter adds a bound text box and its label to the Detail
    await page.getByTestId('prop-RecordSource').fill('Factures');
    await page.getByTestId('prop-RecordSource').press('Enter');
    await expect(page.getByTestId('prop-RecordSource')).toHaveValue('Factures');
    await page.getByTestId('cmd-addExistingFields').click();
    await expect(page.getByTestId('field-list')).toBeVisible();
    for (const f of ['Client', 'Montant']) {
      await page.getByTestId(`field-${f}`).focus();
      await page.keyboard.press('Enter');
      await expect(body(page, 'detail').getByTestId(`ctl-${f}`)).toBeVisible();
      await expect(body(page, 'detail').getByTestId(`ctl-${f}_Étiquette`)).toContainText(`${f}:`);
    }
    await expect(page.getByTestId('doc-tab-report-État1')).toContainText('•'); // dirty

    // the section bar's menu: Report Header/Footer adds the pair
    await page.getByTestId('section-detail').click({ button: 'right' });
    await page.getByTestId('section-menu-reportHeaderFooter').click();
    for (const kind of ['reportHeader', 'reportFooter']) await expect(page.getByTestId(`section-${kind}`)).toBeVisible();

    // a label in the Page Header: removing the pair asks first (No keeps it, Yes removes the pair and the label)
    await page.getByTestId('tool-label').click();
    await body(page, 'pageHeader').click({ position: { x: 40, y: 8 } });
    await expect(body(page, 'pageHeader').getByTestId('ctl-Étiquette1')).toContainText('Étiquette1');
    await page.getByTestId('section-pageHeader').click({ button: 'right' });
    await page.getByTestId('section-menu-pageHeaderFooter').click();
    await expect(page.getByTestId('modal')).toContainText(fr.report.confirmRemoveSections);
    await page.getByTestId('modal-btn-no').click();
    await expect(page.getByTestId('ctl-Étiquette1')).toBeVisible();
    await page.getByTestId('section-pageHeader').click({ button: 'right' });
    await page.getByTestId('section-menu-pageHeaderFooter').click();
    await page.getByTestId('modal-btn-yes').click();
    for (const kind of ['pageHeader', 'pageFooter']) await expect(page.getByTestId(`section-${kind}`)).toHaveCount(0);
    await expect(page.getByTestId('ctl-Étiquette1')).toHaveCount(0);

    // Page Setup tab: Landscape is an undoable edit of the design
    await page.getByTestId('ribbon-tab-pageSetup').click();
    await expect(page.getByTestId('cmd-showMargins')).toBeDisabled(); // later
    await page.getByTestId('cmd-landscape').click();
    await expectOrientation(page, 'landscape');
    await page.getByTestId('section-detail').click();
    await page.keyboard.press('Control+z');
    await expectOrientation(page, 'portrait');
    // Margins: a menu under its button; the preset chosen is checked
    await page.getByTestId('cmd-margins').click();
    await expect(page.getByTestId('cmd-margins')).toHaveAttribute('aria-expanded', 'true');
    await expect(page.getByTestId('margins-menu-custom')).toHaveAttribute('aria-checked', 'true'); // 1 cm: no preset
    await page.getByTestId('margins-menu-normal').click();
    await expect(page.getByTestId('margins-menu')).toHaveCount(0);
    await page.getByTestId('cmd-margins').click();
    await expect(page.getByTestId('margins-menu-normal')).toHaveAttribute('aria-checked', 'true');
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('margins-menu')).toHaveCount(0);

    // the canvas follows the theme (Print Preview stays light: report-preview.spec)
    const sheet = cur(page).locator('.dz-sheet');
    await page.evaluate(() => { document.documentElement.dataset.theme = 'dark'; });
    await expect(sheet).toHaveCSS('background-color', 'rgb(26, 29, 35)');
    if (process.env.BC_SCREENSHOTS) await page.screenshot({ path: join(process.env.BC_SCREENSHOTS, 'report-design-dark.png') });
    await page.evaluate(() => { document.documentElement.dataset.theme = 'light'; });
    await expect(sheet).toHaveCSS('background-color', 'rgb(255, 255, 255)');
    if (process.env.BC_SCREENSHOTS) await page.screenshot({ path: join(process.env.BC_SCREENSHOTS, 'report-design-light.png') });

    // save: a new report asks its name
    await page.keyboard.press('Control+s');
    await expect(page.getByTestId('modal-input')).toHaveValue('État1');
    await page.getByTestId('modal-input').fill('Essai');
    await page.getByTestId('modal-btn-ok').click();
    await expect(page.getByTestId('doc-tab-report-Essai')).toBeVisible();
    await expect(page.getByTestId('doc-tab-report-Essai')).not.toContainText('•');
    await page.getByTestId('ribbon-tab-pageSetup').click();
    await page.getByTestId('cmd-landscape').click();
    await expect(page.getByTestId('doc-tab-report-Essai')).toContainText('•');
    await page.getByTestId('section-detail').click();
    await page.keyboard.press('Control+z');   // portrait again; an undo does not make the design clean (Access neither)
    await page.keyboard.press('Control+s');
    await expect(page.getByTestId('doc-tab-report-Essai')).not.toContainText('•');

    // Print Preview, then Close Preview: back to Design view in the same tab
    await page.getByTestId('ribbon-tab-reportDesign').click();
    await page.getByTestId('cmd-viewPrintPreview').click();
    await expect(cur(page).getByTestId('report-preview')).toBeVisible();
    await expect(pageOf(page)).toHaveText(/^Page 1 sur \d+$/);
    await expect(visiblePages(page).first()).toContainText('Client:');
    await expect(visiblePages(page).first()).toContainText('Montant:');
    await expect(visiblePages(page).first()).toContainText('Dupont');
    await page.getByTestId('cmd-closePreview').click();
    await expect(cur(page).getByTestId('designer')).toBeVisible();
    await expect(page.getByTestId('doc-tab-report-Essai')).toHaveCount(1);
    await expect(body(page, 'detail').getByTestId('ctl-Montant')).toBeVisible(); // the saved design

    // a preview opened from the pane: Close Preview closes the tab
    await page.getByTestId('doc-tab-close-report-Essai').click();
    await page.getByTestId('nav-group-report').getByTestId('nav-item-report-Essai').dblclick();
    await expect(pageOf(page)).toHaveText(/^Page 1 sur \d+$/);
    await page.getByTestId('cmd-closePreview').click();
    await expect(page.getByTestId('doc-tab-report-Essai')).toHaveCount(0);

    // C6: the pane's Design View is delivered
    await page.getByTestId('nav-item-report-Essai').click({ button: 'right' });
    await expect.poll(() => menuLayout(page)).toEqual(['open', 'layout', 'design', '|', 'export', '|', 'rename', 'hide', 'delete', '|', 'cut', 'copy', 'paste',
      '|', 'print', 'printPreview', '|', 'properties']);
    await expect(page.getByTestId('nav-menu-design')).not.toHaveAttribute('aria-disabled', 'true');
    await page.getByTestId('nav-menu-design').click();
    await expect(page.getByTestId('doc-tab-report-Essai')).toBeVisible();
    await expect(cur(page).getByTestId('designer')).toBeVisible();
    await expect(body(page, 'detail').getByTestId('ctl-Client')).toBeVisible();
  } finally {
    await app.close();
  }
});

test('Format tab on a report: Bold, Font Color and Background Color on a text box, saved and drawn by Print Preview', async () => {
  const { app, page } = await launchApp({ args: [seed()], env: { BASECRAFT_REGION: 'fr-FR' } });
  try {
    await page.getByTestId(`nav-item-report-${REPORT}`).click({ button: 'right' });
    await page.getByTestId('nav-menu-design').click();
    await expect(cur(page).getByTestId('designer')).toBeVisible();
    await page.getByTestId('ribbon-tab-format').click();
    for (const id of ['bold', 'fontColor']) await expect(page.getByTestId(`cmd-${id}`), id).toBeDisabled();   // nothing selected
    await expect(page.getByTestId('cmd-selectAll')).toBeEnabled();
    await body(page, 'detail').getByTestId('ctl-Montant').click();
    await page.getByTestId('cmd-bold').click();
    await expect(page.getByTestId('prop-FontWeight')).toHaveValue('bold');
    await page.getByTestId('cmd-fontColor').click();
    await page.getByTestId('format-popup-fontColor-colors-danger').click();
    await expect(page.getByTestId('prop-ForeColor')).toHaveText('Danger');
    // Background Color: a report's text box is transparent by default, so it becomes normal too (one undo step)
    await page.getByTestId('cmd-backColor').click();
    await page.getByTestId('format-popup-backColor-colors-warning').click();
    await expect(page.getByTestId('prop-BackColor')).toHaveText('Avertissement');
    await page.keyboard.press('Control+s');
    await expect(page.getByTestId(`doc-tab-report-${REPORT}`)).not.toContainText('•');
    const saved = await page.evaluate((n) => (window as unknown as { basecraft: BasecraftApi }).basecraft.objects.get('report', n), REPORT)
      .then((r) => r.definition as DesignDoc);
    expect(saved.sections.find((x) => x.kind === 'detail')!.controls.find((c) => c.name === 'Montant')!.props)
      .toMatchObject({ FontWeight: 'bold', ForeColor: 'theme:danger', BackColor: 'theme:warning', BackStyle: 'normal' });

    await page.getByTestId('ribbon-tab-reportDesign').click();
    await page.getByTestId('cmd-viewPrintPreview').click();
    const amount = visiblePages(page).first().locator('.bc-band[data-section="detail"] .bc-text', { hasText: '€' }).first();
    await expect(amount).toHaveCSS('font-weight', '700');
    await expect(amount).toHaveCSS('color', hexToRgb(resolveColor('theme:danger', 'light')));
    await expect(amount).toHaveCSS('background-color', hexToRgb(resolveColor('theme:warning', 'light')));
  } finally {
    await app.close();
  }
});

test('Create > Blank Report: a new report in Design view with the Field List open', async () => {
  const { app, page } = await launchApp({ args: [seed()], env: { BASECRAFT_REGION: 'fr-FR' } });
  try {
    await page.getByTestId('ribbon-tab-create').click();
    await page.getByTestId('cmd-createBlankReport').click();
    await expect(page.getByTestId('doc-tab-report-État1')).toHaveAttribute('aria-selected', 'true');
    await expect(cur(page).getByTestId('designer')).toBeVisible();
    await expect(cur(page).getByTestId('field-list')).toBeVisible();
    await page.getByTestId('cmd-addExistingFields').click();   // the ribbon button still toggles it
    await expect(cur(page).getByTestId('field-list')).toHaveCount(0);
  } finally {
    await app.close();
  }
});

test('Report Design view on a read-only base: opened read-only, Print Preview still available', async () => {
  const base = seed();
  const a = await launchApp({ args: [base] });
  const b = await launchApp({ args: [base], env: { BASECRAFT_REGION: 'fr-FR' } });
  try {
    const page = b.page;
    await expect(page.getByTestId('banner-readonly')).toBeVisible();
    await page.getByTestId(`nav-item-report-${REPORT}`).click({ button: 'right' });
    await page.getByTestId('nav-menu-design').click();
    await expect(cur(page).getByTestId('designer')).toBeVisible();
    await expect(page.getByTestId('tool-textBox')).toBeDisabled();
    await expect(page.getByTestId('cmd-textBox')).toBeDisabled();
    await expect(page.getByTestId('cmd-viewPrintPreview')).toBeEnabled();
    await page.getByTestId('ribbon-tab-pageSetup').click();
    await expect(page.getByTestId('cmd-landscape')).toBeDisabled();
    await page.getByTestId('ribbon-tab-home').click();
    await expect(page.getByTestId('cmd-save')).toBeDisabled();
    await page.getByTestId('ribbon-tab-reportDesign').click();
    await page.getByTestId('cmd-viewPrintPreview').click();
    await expect(pageOf(page)).toHaveText('Page 1 sur 3');
  } finally {
    await b.app.close();
    await a.app.close();
  }
});

test('Print Preview: Landscape is saved and laid out again (4 pages), kept after reopening; More Pages shows 4; pressed states', async () => {
  const base = seed();
  let { app, page } = await launchApp({ args: [base], env: { BASECRAFT_REGION: 'fr-FR' } });
  try {
    await page.getByTestId('nav-group-report').getByTestId(`nav-item-report-${REPORT}`).dblclick();
    await expect(pageOf(page)).toHaveText('Page 1 sur 3');
    const pressed = (id: string, on: boolean) => expect(page.getByTestId(`cmd-${id}`), id).toHaveAttribute('aria-pressed', String(on));
    await pressed('portrait', true); await pressed('landscape', false);
    await page.getByTestId('cmd-landscape').click();
    await expect(pageOf(page)).toHaveText('Page 1 sur 4');
    await pressed('portrait', false); await pressed('landscape', true);
    // Design view: the Page Setup tab too; Group & Sort pressed while the pane shows, Hide Details while the Detail is hidden
    await page.getByTestId('ribbon-tab-home').click();
    await page.getByTestId('cmd-viewDesign').click();
    await expect(cur(page).getByTestId('designer')).toBeVisible();
    await page.getByTestId('ribbon-tab-pageSetup').click();
    await pressed('landscape', true); await pressed('portrait', false);
    await page.getByTestId('ribbon-tab-reportDesign').click();
    await pressed('groupSort', false); await pressed('hideDetails', false);
    await page.getByTestId('cmd-groupSort').click();
    await pressed('groupSort', true);
    await page.getByTestId('cmd-hideDetails').click();
    await pressed('hideDetails', true);
    await page.getByTestId('cmd-groupSort').click();
    await pressed('groupSort', false);
    await app.close();

    ({ app, page } = await launchApp({ args: [base], env: { BASECRAFT_REGION: 'fr-FR' } }));
    await page.getByTestId('nav-group-report').getByTestId(`nav-item-report-${REPORT}`).dblclick();
    await expect(pageOf(page)).toHaveText('Page 1 sur 4');
    await page.getByTestId('cmd-morePages').click();
    await expect(page.getByTestId('preview-pages-4')).toHaveText(fr.report.perView.replace('{{count}}', '4'));
    await page.getByTestId('preview-pages-4').click();
    await expect(visiblePages(page)).toHaveCount(4);
    await page.getByTestId('cmd-onePage').click();
    await expect(visiblePages(page)).toHaveCount(1);
  } finally {
    await app.close();
  }
});
