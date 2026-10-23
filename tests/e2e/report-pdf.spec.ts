import { test, expect, type ElectronApplication, type Page } from '@playwright/test';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { saveObject } from '../../src/main/db/objects';
import type { BasecraftApi, PrintRequest } from '../../src/shared/api';
import type { DesignDoc } from '../../src/shared/design/model';
import { fontFaceCss } from '../../src/shared/fonts';
import { FACTURES_REPORT } from '../../src/shared/report/fixtures/factures';
import { launchApp, seedBase, seedReportsE2E } from './helpers';

const fr = JSON.parse(readFileSync(join(__dirname, '../../src/shared/i18n/fr.json'), 'utf8'));
const REPORT = 'Factures par client';
const FONTS = join(__dirname, '../../src/renderer/public/fonts');

/** « Factures par client » whose title is an <img> tag pointing at the network. */
const IMAGE: DesignDoc = {
  ...FACTURES_REPORT,
  sections: FACTURES_REPORT.sections.map((s) => s.kind !== 'reportHeader' ? s : {
    ...s, controls: [{ ...s.controls[0]!, props: { ...s.controls[0]!.props, Caption: '<img src=https://example.invalid/x.png>' } }, ...s.controls.slice(1)],
  }),
};
const seed = () => seedBase('etats', (db) => {
  seedReportsE2E(db);
  saveObject(db, 'report', 'Image', IMAGE, null);
});

/** The embedded fonts copied into a folder whose path has spaces and parentheses, without `except`. */
function fontsCopy(except?: string): string {
  const dir = join(mkdtempSync(join(tmpdir(), 'basecraft-fonts-')), 'polices (copie) x');
  mkdirSync(dir);
  for (const f of readdirSync(FONTS)) if (f.endsWith('.ttf') && f !== except) copyFileSync(join(FONTS, f), join(dir, f));
  return dir;
}
const setEnv = (app: ElectronApplication, k: string, v: string | null) =>
  app.evaluate((_e, [k, v]) => { if (v === null) delete process.env[k!]; else process.env[k!] = v; }, [k, v] as const);
const exportPdf = (page: Page, r: PrintRequest) =>
  page.evaluate((r) => (window as unknown as { basecraft: BasecraftApi }).basecraft.reports.exportPdf(r), r);
const printLog = (app: ElectronApplication) =>
  app.evaluate(() => (globalThis as unknown as { __bcPrintE2E: { blocked: string[]; printed: number } }).__bcPrintE2E);

async function openReport(page: Page, name: string) {
  await page.getByTestId('nav-group-report').getByTestId(`nav-item-report-${name}`).dblclick();
  await expect(page.getByTestId(`doc-tab-report-${name}`)).toBeVisible();
  await expect(page.locator('.doc:not([hidden])').getByTestId('preview-page-of')).toHaveText(/^Page 1 sur \d+$/);
}

function checkPdf(path: string, pages: number) {
  const pdf = readFileSync(path).toString('latin1');
  expect(pdf.startsWith('%PDF-')).toBe(true);
  expect(pdf.match(/\/Type\s*\/Page[^s]/g)).toHaveLength(pages);
  const box = pdf.match(/\/MediaBox\s*\[\s*0\s+0\s+([\d.]+)\s+([\d.]+)\s*\]/)!;
  expect(Math.abs(Number(box[1]) - 595.28)).toBeLessThan(1);
  expect(Math.abs(Number(box[2]) - 841.89)).toBeLessThan(1);
  expect(pdf).toMatch(/\/FontFile2/); // the faces are embedded
  expect(pdf).toMatch(/\/BaseFont\s*\/[A-Z]{6}\+LiberationSans/);
}

test('export to PDF, cancel, print, hostile input: only bc-print is ever requested', async () => {
  const out = mkdtempSync(join(tmpdir(), 'basecraft-pdf-'));
  const pdfPath = join(out, 'Factures (1).pdf');
  const { app, page } = await launchApp({ args: [seed()], env: { BASECRAFT_REGION: 'fr-FR', BASECRAFT_E2E_PDF_PATH: pdfPath, BASECRAFT_E2E_FONTS_DIR: fontsCopy() } });
  try {
    await openReport(page, REPORT);
    await page.getByTestId('cmd-exportPdf').click();
    await expect(page.getByTestId('modal')).toContainText(fr.report.pdfSaved);
    await page.getByTestId('modal-btn-ok').click();
    checkPdf(pdfPath, 3);
    // the work window is gone, and was never shown
    expect(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length)).toBe(1);

    // no path chosen (dialog cancelled): nothing is written
    await setEnv(app, 'BASECRAFT_E2E_PDF_PATH', null);
    await page.getByTestId('cmd-exportPdf').click();
    const req = { html: '<p>x</p>', name: 'x', landscape: false };
    expect(await exportPdf(page, req)).toBe('canceled');
    await expect(page.getByTestId('modal')).toHaveCount(0);
    expect(readdirSync(out)).toEqual(['Factures (1).pdf']);

    // print: the e2e hook loads the document and checks the fonts, without the system dialog
    await page.getByTestId('cmd-print').click();
    await expect.poll(async () => (await printLog(app)).printed).toBe(1);
    await expect(page.getByTestId('modal')).toHaveCount(0);

    // a caption that looks like an <img> tag is text: the PDF is made, nothing goes to the network
    const imgPath = join(out, 'image.pdf');
    await setEnv(app, 'BASECRAFT_E2E_PDF_PATH', imgPath);
    await openReport(page, 'Image');
    await page.getByTestId('cmd-exportPdf').click();
    await expect(page.getByTestId('modal')).toContainText(fr.report.pdfSaved);
    await page.getByTestId('modal-btn-ok').click();
    expect(readFileSync(imgPath).toString('latin1').startsWith('%PDF-')).toBe(true);

    // raw HTML through the API: the page's script is blocked by the CSP (it would add a face that cannot load), the
    // network image is refused, and a font URL with spaces and parentheses (quoted by fontFaceCss) loads
    const rawPath = join(out, 'raw.pdf');
    await setEnv(app, 'BASECRAFT_E2E_PDF_PATH', rawPath);
    const css = fontFaceCss([{ family: 'Carlito', bold: true, italic: true }], 'fonts/a (b) c/../');
    const html = `<!doctype html><style>${css}</style><p style="font:italic 700 12pt 'BC Carlito'">x</p>`
      + '<img src="https://example.invalid/y.png"><script>document.fonts.add(new FontFace("Z", "url(fonts/nope.ttf)"))</script>';
    expect(await exportPdf(page, { html, name: 'raw', landscape: false })).toBe('saved');
    expect(readFileSync(rawPath).toString('latin1')).toMatch(/\/BaseFont\s*\/[A-Z]{6}\+Carlito-BoldItalic/);

    expect((await printLog(app)).blocked).toEqual([]);
  } finally {
    await app.close();
  }
});

test('a missing embedded face stops the export and the print (no fallback font, no file)', async () => {
  const out = mkdtempSync(join(tmpdir(), 'basecraft-pdf-'));
  const pdfPath = join(out, 'f.pdf');
  const { app, page } = await launchApp({ args: [seed()], env: {
    BASECRAFT_REGION: 'fr-FR', BASECRAFT_E2E_PDF_PATH: pdfPath, BASECRAFT_E2E_FONTS_DIR: fontsCopy('LiberationSans-Regular.ttf'),
  } });
  try {
    await openReport(page, REPORT);
    await page.getByTestId('cmd-exportPdf').click();
    await expect(page.getByTestId('modal')).toContainText(fr.dialog.error.fontMissing);
    await page.getByTestId('modal-btn-ok').click();
    expect(existsSync(pdfPath)).toBe(false);
    await page.getByTestId('cmd-print').click();
    await expect(page.getByTestId('modal')).toContainText(fr.dialog.error.fontMissing);
    await page.getByTestId('modal-btn-ok').click();
    expect((await printLog(app)).printed).toBe(0);
  } finally {
    await app.close();
  }
});

/** The next work window's renderer: crashed once its document is loaded, or paused in the debugger (hung). */
const sabotageNextPrintWindow = (app: ElectronApplication, how: 'crash' | 'hang') => app.evaluate(({ app: a }, how) => {
  a.once('browser-window-created', (_e, w) => {
    if (how === 'crash') { w.webContents.once('did-finish-load', () => w.webContents.forcefullyCrashRenderer()); return; }
    // paused before any script: the font check (the first script the window runs) never returns
    w.webContents.debugger.attach();
    void w.webContents.debugger.sendCommand('Debugger.enable').then(() => w.webContents.debugger.sendCommand('Debugger.pause'));
  });
}, how);
const windowCount = (app: ElectronApplication) => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length);

test('a crashed work window settles the job with a typed error and is destroyed', async () => {
  const out = mkdtempSync(join(tmpdir(), 'basecraft-pdf-'));
  const pdfPath = join(out, 'c.pdf');
  const { app, page } = await launchApp({ args: [seed()], env: { BASECRAFT_REGION: 'fr-FR', BASECRAFT_E2E_PDF_PATH: pdfPath } });
  try {
    await openReport(page, REPORT);
    await sabotageNextPrintWindow(app, 'crash');
    await page.getByTestId('cmd-exportPdf').click();
    await expect(page.getByTestId('modal')).toContainText(fr.dialog.error.printFailed, { timeout: 10_000 });
    await page.getByTestId('modal-btn-ok').click();
    expect(existsSync(pdfPath)).toBe(false);
    expect(await windowCount(app)).toBe(1);
    await sabotageNextPrintWindow(app, 'crash');
    await page.getByTestId('cmd-print').click();
    await expect(page.getByTestId('modal')).toContainText(fr.dialog.error.printFailed, { timeout: 10_000 });
    await page.getByTestId('modal-btn-ok').click();
    expect(await windowCount(app)).toBe(1);
  } finally {
    await app.close();
  }
});

test('closing the main window during a hung job destroys the work window: the app quits', async () => {
  const { app, page } = await launchApp({ args: [seed()], env: { BASECRAFT_REGION: 'fr-FR', BASECRAFT_E2E_PDF_PATH: join(mkdtempSync(join(tmpdir(), 'basecraft-pdf-')), 'h.pdf') } });
  let gone = false;
  const exited = new Promise<void>((r) => app.process().once('exit', () => { gone = true; r(); }));
  try {
    await openReport(page, REPORT);
    await sabotageNextPrintWindow(app, 'hang');
    await page.getByTestId('cmd-print').click();
    // the work window has loaded its document (and is paused in the font check)
    await expect.poll(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().some((w) => w.webContents.getURL().startsWith('bc-print:')))).toBe(true);
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().sort((a, b) => a.id - b.id)[0]!.close()); // the main window
    await Promise.race([exited, new Promise((_, rej) => setTimeout(() => rej(new Error('the app did not quit')), 10_000))]);
  } finally {
    if (!gone) await app.close();
  }
});

/** The top-level Navigation Pane menu: its items (test ids without the prefix) with '|' for each separator. */
const menuLayout = (page: Page) => page.getByTestId('nav-menu').evaluate((m) =>
  [...m.children].map((e) => (e.getAttribute('role') === 'separator' ? '|' : (e.querySelector('[role="menuitem"]') ?? e).getAttribute('data-testid')!.replace('nav-menu-', ''))));

test('C6: a report\'s context menu — Access order, Design View, Export › PDF and Print… without a tab, Print Preview, Open', async () => {
  const out = mkdtempSync(join(tmpdir(), 'basecraft-pdf-'));
  const pdfPath = join(out, 'menu.pdf');
  const { app, page } = await launchApp({ args: [seed()], env: { BASECRAFT_REGION: 'fr-FR', BASECRAFT_E2E_PDF_PATH: pdfPath } });
  try {
    const item = page.getByTestId('nav-group-report').getByTestId(`nav-item-report-${REPORT}`);
    const tab = page.getByTestId(`doc-tab-report-${REPORT}`);
    await item.click({ button: 'right' });
    expect(await menuLayout(page)).toEqual(['open', 'layout', 'design', '|', 'export', '|', 'rename', 'hide', 'delete', '|', 'cut', 'copy', 'paste',
      '|', 'print', 'printPreview', '|', 'properties']);
    await expect(page.getByTestId('nav-menu-print')).toHaveText(fr.nav.menu.print.replace('&', ''));
    await expect(page.getByTestId('nav-menu-printPreview')).toHaveText(fr.nav.menu.printPreview.replace('&', ''));
    // Design View: the band designer (Task 12), enabled
    await expect(page.getByTestId('nav-menu-design')).not.toHaveAttribute('aria-disabled', 'true');
    await expect(page.getByTestId('nav-menu-design')).not.toHaveAttribute('title', fr.ribbon.planned.A5);

    // Export › PDF: laid out without opening the report, saved to the chosen path
    await page.getByTestId('nav-menu-export').click();
    await page.getByTestId('nav-menu-export-pdf').click();
    await expect(page.getByTestId('modal')).toContainText(fr.report.pdfSaved);
    await page.getByTestId('modal-btn-ok').click();
    checkPdf(pdfPath, 3);
    await expect(tab).toHaveCount(0);

    // Print…: the e2e hook answers without the system dialog; no tab either
    await item.click({ button: 'right' });
    await page.getByTestId('nav-menu-print').click();
    await expect.poll(async () => (await printLog(app)).printed).toBe(1);
    await expect(page.getByTestId('modal')).toHaveCount(0);
    await expect(tab).toHaveCount(0);

    // Print Preview, then Open (Enter on the focused first item): the report's Print Preview
    await item.click({ button: 'right' });
    await page.getByTestId('nav-menu-printPreview').click();
    await expect(page.locator('.doc:not([hidden])').getByTestId('preview-page-of')).toHaveText('Page 1 sur 3');
    await page.getByTestId(`doc-tab-close-report-${REPORT}`).click();
    await expect(tab).toHaveCount(0);
    await item.click({ button: 'right' });
    await expect(page.getByTestId('nav-menu-open')).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page.locator('.doc:not([hidden])').getByTestId('preview-page-of')).toHaveText('Page 1 sur 3');
    await expect(page.getByTestId('ribbon-tab-printPreview')).toBeVisible();
  } finally {
    await app.close();
  }
});

test('C3: a report on a parameterized query asks first (Open, Design view › Print Preview, Print…, Export › PDF); Cancel stops quietly', async () => {
  test.setTimeout(120000);
  const pdfPath = join(mkdtempSync(join(tmpdir(), 'basecraft-pdf-')), 'param.pdf');
  const base = seedBase('etats-param', (db) => {
    seedReportsE2E(db);
    saveObject(db, 'query', 'Factures du client', { formatVersion: '1.0', sql: 'PARAMETERS [Client voulu] Text; SELECT * FROM Factures WHERE Client = [Client voulu];' }, null);
    saveObject(db, 'report', 'Par client', { ...FACTURES_REPORT, recordSource: { kind: 'query', name: 'Factures du client' } }, null);
  });
  const { app, page } = await launchApp({ args: [base], env: { BASECRAFT_REGION: 'fr-FR', BASECRAFT_E2E_PDF_PATH: pdfPath } });
  try {
    const item = page.getByTestId('nav-group-report').getByTestId('nav-item-report-Par client');
    const tab = page.getByTestId('doc-tab-report-Par client');
    const doc = page.locator('.doc:not([hidden])');
    /** « Entrer une valeur de paramètre » for [Client voulu]: `value` then OK, or Cancel (null). */
    const answer = async (value: string | null) => {
      await expect(page.getByTestId('modal')).toContainText(fr.query.param.title);
      await expect(page.getByTestId('modal')).toContainText('Client voulu');
      if (value === null) await page.getByTestId('modal-btn-cancel').click();
      else { await page.getByTestId('modal-input').fill(value); await page.getByTestId('modal-btn-ok').click(); }
      await expect(page.getByTestId('modal')).toHaveCount(0);
    };

    // Open: asked, then only the rows of that client
    await item.dblclick();
    await answer('Martin');
    await expect(doc.getByTestId('preview-page-of')).toHaveText('Page 1 sur 1');
    await expect(doc.locator('.bc-page').first()).toContainText('Martin');
    await expect(doc.locator('.bc-page').first()).not.toContainText('Dupont');
    // Shift+F9: asked again before the pages go; Cancel keeps them (no new layout), OK reads the new rows
    const runs = await doc.getByTestId('report-preview').getAttribute('data-runs');
    await page.keyboard.press('Shift+F9');
    await answer(null);
    await expect(doc.getByTestId('report-preview')).toHaveAttribute('data-runs', runs!);
    await expect(tab).toHaveCount(1);
    await expect(doc.getByTestId('preview-page-of')).toHaveText('Page 1 sur 1');
    await expect(doc.locator('.bc-page').first()).toContainText('Martin');
    await page.keyboard.press('Shift+F9');
    await answer('Durand');
    await expect(doc.getByTestId('report-preview')).toHaveAttribute('data-runs', String(Number(runs) + 1));
    await expect(doc.locator('.bc-page').first()).toContainText('Durand');
    await expect(doc.locator('.bc-page').first()).not.toContainText('Martin');
    await page.getByTestId('doc-tab-close-report-Par client').click();
    // Cancel: the preview closes, no message
    await item.dblclick();
    await answer(null);
    await expect(tab).toHaveCount(0);

    // Design view › Print Preview: Cancel goes back to Design view; OK shows the preview
    await item.click({ button: 'right' });
    await page.getByTestId('nav-menu-design').click();
    await expect(doc.getByTestId('designer')).toBeVisible();
    await page.getByTestId('cmd-viewPrintPreview').click();
    await answer(null);
    await expect(doc.getByTestId('designer')).toBeVisible();
    await page.getByTestId('cmd-viewPrintPreview').click();
    await answer('Durand');
    await expect(doc.getByTestId('preview-page-of')).toHaveText('Page 1 sur 1');
    await expect(doc.locator('.bc-page').first()).toContainText('Durand');
    await page.getByTestId('doc-tab-close-report-Par client').click();

    // Print… and Export › PDF from the pane: asked before the progress box; Cancel prints nothing
    await item.click({ button: 'right' });
    await page.getByTestId('nav-menu-print').click();
    await answer(null);
    await item.click({ button: 'right' });
    await page.getByTestId('nav-menu-print').click();
    await answer('Durand');
    await expect.poll(async () => (await printLog(app)).printed).toBe(1);
    await item.click({ button: 'right' });
    await page.getByTestId('nav-menu-export').click();
    await page.getByTestId('nav-menu-export-pdf').click();
    await answer('Durand');
    await expect(page.getByTestId('modal')).toContainText(fr.report.pdfSaved);
    await page.getByTestId('modal-btn-ok').click();
    checkPdf(pdfPath, 1);
    await expect(tab).toHaveCount(0);
  } finally {
    await app.close();
  }
});
