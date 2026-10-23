import { test, expect, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { saveObject } from '../../src/main/db/objects';
import type { DesignDoc } from '../../src/shared/design/model';
import { FACTURES_REPORT } from '../../src/shared/report/fixtures/factures';
import { launchApp, seedBase, seedReportsE2E } from './helpers';

const fr = JSON.parse(readFileSync(join(__dirname, '../../src/shared/i18n/fr.json'), 'utf8'));
const REPORT = 'Factures par client';

/** « Factures par client » with a title « <b>x</b> » and a box bound to a field the source does not have. */
const BALISES: DesignDoc = {
  ...FACTURES_REPORT,
  sections: FACTURES_REPORT.sections.map((s) => s.kind !== 'reportHeader' ? s : {
    ...s, controls: [{ ...s.controls[0]!, props: { ...s.controls[0]!.props, Caption: '<b>x</b>' } },
      { kind: 'textBox', name: 'Fantome', left: 5000, top: 283, width: 2000, height: 340, props: { ControlSource: 'Inconnu', FontName: 'Liberation Sans' } }],
  }),
};

const seed = () => seedBase('etats', (db) => {
  seedReportsE2E(db);
  saveObject(db, 'report', 'Balises', BALISES, null);
  saveObject(db, 'report', 'Casse', FACTURES_REPORT, null);
  db.prepare("UPDATE bc_objects SET definition = '{' WHERE kind = 'report' AND name = 'Casse'").run();
});

async function openReport(page: Page, name: string) {
  await page.getByTestId('nav-group-report').getByTestId(`nav-item-report-${name}`).dblclick();
  await expect(page.getByTestId(`doc-tab-report-${name}`)).toBeVisible();
}
/** The active document (every document stays mounted, only the active one is shown). */
const cur = (page: Page) => page.locator('.doc:not([hidden])');
const pageOf = (page: Page) => cur(page).getByTestId('preview-page-of');
const visiblePages = (page: Page) => cur(page).locator('.bc-page');

test('print preview: pages, navigation, two pages, zoom, refresh, fonts, light paper in the dark theme', async () => {
  const { app, page } = await launchApp({ args: [seed()], env: { BASECRAFT_REGION: 'fr-FR' } });
  try {
    await openReport(page, REPORT);
    await expect(pageOf(page)).toHaveText('Page 1 sur 3');
    await expect(page.getByTestId('ribbon-tab-printPreview')).toHaveAttribute('aria-selected', 'true');
    await expect(visiblePages(page)).toHaveCount(1);
    await expect(cur(page).getByTestId('report-pages')).toBeVisible();
    // the embedded fonts are loaded before the pages show
    expect(await page.evaluate(() => document.fonts.check('10pt "BC Liberation Sans"'))).toBe(true);
    await expect(visiblePages(page).first()).toContainText('Factures');

    await cur(page).getByTestId('preview-nav-next').click();
    await expect(pageOf(page)).toHaveText('Page 2 sur 3');
    await expect(visiblePages(page).first()).toHaveAttribute('data-page', '2');
    await cur(page).getByTestId('preview-nav-last').click();
    await expect(pageOf(page)).toHaveText('Page 3 sur 3');
    await expect(cur(page).getByTestId('preview-nav-next')).toBeDisabled();
    await cur(page).getByTestId('report-viewport').press('PageUp');
    await expect(pageOf(page)).toHaveText('Page 2 sur 3');
    await cur(page).getByTestId('preview-nav-page').fill('1');
    await cur(page).getByTestId('preview-nav-page').press('Enter');
    await expect(pageOf(page)).toHaveText('Page 1 sur 3');
    await cur(page).getByTestId('report-viewport').press('PageDown');
    await expect(pageOf(page)).toHaveText('Page 2 sur 3');
    await cur(page).getByTestId('preview-nav-first').click();

    await page.getByTestId('cmd-twoPages').click();
    await expect(visiblePages(page)).toHaveCount(2);
    await page.getByTestId('cmd-onePage').click();
    await expect(visiblePages(page)).toHaveCount(1);

    // zoom: fitted to the window, then 100 % (a page is 793.7 px wide at 100 %)
    const width = () => visiblePages(page).first().evaluate((el) => el.getBoundingClientRect().width);
    const fitted = await width();
    await page.getByTestId('cmd-previewZoom').click();
    await expect.poll(width).toBeCloseTo(11906 / 15, 0);
    expect(fitted).toBeLessThan(11906 / 15);
    await page.getByTestId('cmd-previewZoom').click();
    await expect.poll(width).toBeCloseTo(fitted, 0);

    // record and sort commands stay off for a report
    await page.getByTestId('ribbon-tab-home').click();
    for (const id of ['newRecord', 'deleteRecord', 'sortAsc']) await expect(page.getByTestId(`cmd-${id}`)).toBeDisabled();
    await expect(page.getByTestId('cmd-refresh')).toBeEnabled();

    // Shift+F9: the data are read and laid out again
    const runs = await cur(page).getByTestId('report-preview').getAttribute('data-runs');
    await page.keyboard.press('Shift+F9');
    await expect(cur(page).getByTestId('report-preview')).toHaveAttribute('data-runs', String(Number(runs) + 1));
    await expect(pageOf(page)).toHaveText('Page 1 sur 3');

    // dark theme: the paper stays white, the area around it neutral grey
    await page.evaluate(() => { document.documentElement.dataset.theme = 'dark'; });
    expect(await visiblePages(page).first().evaluate((el) => getComputedStyle(el).backgroundColor)).toBe('rgb(255, 255, 255)');
    expect(await cur(page).getByTestId('report-viewport').evaluate((el) => getComputedStyle(el).backgroundColor)).toBe('rgb(138, 141, 145)');
    if (process.env.BC_SCREENSHOTS) {
      await page.screenshot({ path: join(process.env.BC_SCREENSHOTS, 'preview-dark.png') });
      await page.evaluate(() => { document.documentElement.dataset.theme = 'light'; });
      await page.screenshot({ path: join(process.env.BC_SCREENSHOTS, 'preview-light.png') });
    }

    // Close Preview closes the tab
    await page.getByTestId('ribbon-tab-printPreview').click();
    await page.getByTestId('cmd-closePreview').click();
    await expect(page.getByTestId(`doc-tab-report-${REPORT}`)).toHaveCount(0);

    // the pane's Open menu item opens the preview too
    await page.getByTestId(`nav-item-report-${REPORT}`).click({ button: 'right' });
    await page.getByTestId('nav-menu-open').click();
    await expect(pageOf(page)).toHaveText('Page 1 sur 3');
  } finally {
    await app.close();
  }
});

test('page setup: landscape is saved and laid out again (shorter pages: 4 instead of 3); it is kept when the base is opened again', async () => {
  const base = seed();
  let { app, page } = await launchApp({ args: [base], env: { BASECRAFT_REGION: 'fr-FR' } });
  try {
    await openReport(page, REPORT);
    await expect(pageOf(page)).toHaveText('Page 1 sur 3');
    await page.getByTestId('cmd-pageSetupDialog').click();
    await expect(page.getByTestId('page-setup-portrait')).toBeChecked();
    await expect(page.getByTestId('page-setup-margin-top')).toHaveValue('1');
    await page.getByTestId('page-setup-margin-left').fill('12');
    await page.getByTestId('modal-btn-ok').click();
    await expect(page.getByTestId('page-setup-error')).toHaveText(fr.report.pageSetup.invalid);
    // only the wrong margin is invalid, and it is described by the message (final review M10)
    const errorId = await page.getByTestId('page-setup-error').getAttribute('id');
    await expect(page.getByTestId('page-setup-margin-left')).toHaveAttribute('aria-invalid', 'true');
    await expect(page.getByTestId('page-setup-margin-left')).toHaveAttribute('aria-describedby', errorId!);
    await expect(page.getByTestId('page-setup-margin-top')).toHaveAttribute('aria-invalid', 'false');
    await expect(page.getByTestId('page-setup-margin-top')).not.toHaveAttribute('aria-describedby');
    await page.getByTestId('page-setup-margin-left').fill('1');
    await page.getByTestId('page-setup-landscape').check();
    await page.getByTestId('modal-btn-ok').click();
    await expect(pageOf(page)).toHaveText('Page 1 sur 4');
    await app.close();

    ({ app, page } = await launchApp({ args: [base], env: { BASECRAFT_REGION: 'fr-FR' } }));
    await openReport(page, REPORT);
    await expect(pageOf(page)).toHaveText('Page 1 sur 4');
    const box = await visiblePages(page).first().evaluate((el) => ({ w: (el as HTMLElement).offsetWidth, h: (el as HTMLElement).offsetHeight }));
    expect(box.w).toBeGreaterThan(box.h);
  } finally {
    await app.close();
  }
});

test('page setup is disabled on a read-only base', async () => {
  const base = seed();
  const a = await launchApp({ args: [base] });
  const b = await launchApp({ args: [base], env: { BASECRAFT_REGION: 'fr-FR' } });
  try {
    await expect(b.page.getByTestId('banner-readonly')).toBeVisible();
    await openReport(b.page, REPORT);
    await expect(pageOf(b.page)).toHaveText('Page 1 sur 3');
    await expect(b.page.getByTestId('cmd-pageSetupDialog')).toBeDisabled();
    await expect(b.page.getByTestId('cmd-closePreview')).toBeEnabled();
  } finally {
    await b.app.close();
    await a.app.close();
  }
});

test('text is shown as typed, warnings in a banner, a corrupt definition gives a message in the view', async () => {
  const { app, page } = await launchApp({ args: [seed()], env: { BASECRAFT_REGION: 'fr-FR' } });
  try {
    await openReport(page, 'Balises');
    await expect(pageOf(page)).toHaveText('Page 1 sur 3');
    const title = visiblePages(page).first().locator('.bc-text').first();
    await expect(title).toHaveText('<b>x</b>');
    expect(await visiblePages(page).first().locator('b').count()).toBe(0);
    const issues = cur(page).getByTestId('report-issues');
    await expect(issues).toContainText(fr.report.issues.replace('{{count}}', '1'));
    await issues.locator('summary').click();
    await expect(issues).toContainText(fr.report.issue.unknownField.replace('{{detail}}', 'Inconnu'));

    await openReport(page, 'Casse');
    await expect(cur(page).getByTestId('report-error')).toHaveText(fr.dialog.error.corruptObject);
    await expect(page.getByTestId('modal')).toHaveCount(0);
    await page.getByTestId(`doc-tab-report-Balises`).click(); // the app still works
    await expect(pageOf(page).first()).toBeVisible();
  } finally {
    await app.close();
  }
});
