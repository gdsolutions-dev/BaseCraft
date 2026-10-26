// B2 Task 10: report events — the Detail's On Format hides small amounts in Print Preview and in the PDF export, On No Data
// cancels a report opened by OpenReport (no tab, OpenReport fails), On Close runs when the preview closes.
import { test, expect, type Page } from '@playwright/test';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { saveObject } from '../../src/main/db/objects';
import type { DesignDoc } from '../../src/shared/design/model';
import type { MacroItem } from '../../src/shared/macro/model';
import { FACTURES_REPORT } from '../../src/shared/report/fixtures/factures';
import { launchApp, layoutFromDom, seedBase, seedReportsE2E } from './helpers';

const fr = JSON.parse(readFileSync(join(__dirname, '../../src/shared/i18n/fr.json'), 'utf8'));
const REPORT = 'Factures par client';
const act = (action: string, args: Record<string, string> = {}): MacroItem => ({ k: 'action', action, args });
const embedded = (...items: MacroItem[]) => ({ embedded: { formatVersion: '1.0' as const, items } });
const ok = (r: { ok: boolean }) => { if (!r.ok) throw new Error('seed'); };

/** The Detail hides itself when [Montant] < 1 (62 of the 75 rows). */
const SMALL_HIDDEN: DesignDoc = {
  ...FACTURES_REPORT,
  sections: FACTURES_REPORT.sections.map((s) => s.kind !== 'detail' ? s : { ...s, props: { ...s.props, OnFormat: embedded(
    { k: 'if', branches: [{ cond: '[Montant] < 1', items: [act('SetProperty', { ControlName: 'Detail', Property: 'visible', Value: 'Non' })] }] }) } }),
};
const EMPTY: DesignDoc = { ...FACTURES_REPORT, props: { ...FACTURES_REPORT.props,
  OnNoData: embedded(act('MessageBox', { Message: 'Aucune facture', Type: 'information' }), act('CancelEvent')) } };
const CLOSING: DesignDoc = { ...FACTURES_REPORT, props: { ...FACTURES_REPORT.props, OnClose: embedded(act('MessageBox', { Message: 'Au revoir' })) } };

const seed = () => seedBase('etats-evenements', (db) => {
  seedReportsE2E(db);
  ok(saveObject(db, 'report', REPORT, SMALL_HIDDEN, REPORT));
  ok(saveObject(db, 'report', 'Factures vides', EMPTY, null));
  ok(saveObject(db, 'report', 'Factures fermeture', CLOSING, null));
  ok(saveObject(db, 'macro', 'MPersonne', { formatVersion: '1.0', items: [
    act('OpenReport', { ReportName: 'Factures vides', View: 'preview', WhereCondition: '[Client] = "Personne"' }),
    act('MessageBox', { Message: 'jamais' })] }, null));
});

const item = (page: Page, name: string) => page.getByTestId('nav-group-report').getByTestId(`nav-item-report-${name}`);
const pageOf = (page: Page) => page.locator('.doc:not([hidden])').getByTestId('preview-page-of');
async function msgbox(page: Page, text: string) {
  await expect(page.getByTestId('macro-msgbox')).toBeVisible();
  await expect(page.getByTestId('macro-msgbox-text')).toHaveText(text);
  await page.getByTestId('macro-msgbox-ok').click();
  await expect(page.getByTestId('macro-msgbox')).toHaveCount(0);
}

test('On Format in Print Preview and in the PDF export; On No Data cancels OpenReport; On Close', async () => {
  test.setTimeout(120_000);
  const pdfPath = join(mkdtempSync(join(tmpdir(), 'basecraft-pdf-')), 'factures.pdf');
  const { app, page } = await launchApp({ args: [seed()], env: { BASECRAFT_REGION: 'fr-FR', BASECRAFT_E2E_PDF_PATH: pdfPath } });
  try {
    // Print Preview: 13 detail lines (Martin 10, Durand 12,35 / 7,65 / 100,00), every total unchanged
    await item(page, REPORT).dblclick();
    await expect(pageOf(page)).toHaveText(/^Page 1 sur \d+$/);
    const layout = await layoutFromDom(page);
    const bands = layout.pages.flatMap((p) => p.bands);
    expect(bands.filter((b) => b.section === 'detail')).toHaveLength(13);
    const text = bands.flatMap((b) => b.lines.map((l) => l[0])).join(' ');
    expect(text).toContain('Total Dupont');
    expect(text).toContain('75');   // Count(*) of the Report Footer: every row
    await page.getByTestId(`doc-tab-close-report-${REPORT}`).click();

    // Export › PDF from the Navigation Pane (laid out without the preview): the same pages
    await item(page, REPORT).click({ button: 'right' });
    await page.getByTestId('nav-menu-export').click();
    await page.getByTestId('nav-menu-export-pdf').click();
    await expect(page.getByTestId('modal')).toContainText(fr.report.pdfSaved);
    await page.getByTestId('modal-btn-ok').click();
    expect(readFileSync(pdfPath).toString('latin1').match(/\/Type\s*\/Page[^s]/g)).toHaveLength(layout.pages.length);
    // the document sent to the PDF: the same 13 detail lines (« Article n »), no hidden amount (Dupont 0,10, Durand 0,01 / 0,99)
    const html = await app.evaluate(() => (globalThis as unknown as { __bcPrintE2E: { html: string } }).__bcPrintE2E.html);
    expect(html.match(/>Article \d+</g)).toHaveLength(13);
    for (const hidden of ['0,10', '0,01', '0,99']) expect(html).not.toContain(hidden);

    // On No Data: its message, then CancelEvent: no tab, and the OpenReport of the macro fails (cancelled)
    await page.getByTestId('ribbon-tab-databaseTools').click();
    await page.getByTestId('cmd-runMacro').click();
    await page.getByTestId('run-macro-name').fill('MPersonne');
    await page.getByTestId('run-macro-name-list').getByRole('option', { name: 'MPersonne', exact: true }).click();
    await page.getByTestId('run-macro-ok').click();
    await msgbox(page, 'Aucune facture');
    await expect(page.getByTestId('macro-failed')).toBeVisible();
    await expect(page.getByTestId('macro-failed-action')).toHaveText(fr.macro.action.OpenReport);
    await page.getByTestId('macro-failed-stop').click();
    await expect(page.getByTestId('modal')).toHaveCount(0);   // the macro stopped: never « jamais »
    await expect(page.getByTestId('doc-tab-report-Factures vides')).toHaveCount(0);

    // On Close when the preview closes
    await item(page, 'Factures fermeture').dblclick();
    await expect(pageOf(page)).toHaveText(/^Page 1 sur \d+$/);
    await page.getByTestId('doc-tab-close-report-Factures fermeture').click();
    await msgbox(page, 'Au revoir');
    await expect(page.getByTestId('doc-tab-report-Factures fermeture')).toHaveCount(0);
  } finally {
    await app.close();
  }
});
