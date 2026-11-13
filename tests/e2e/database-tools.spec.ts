// Database Tools (K1-K4): the relationship report, object dependencies, the documenter and the performance analyzer.
// BC_SHOT=<folder> saves a screenshot of each result there.
import { test, expect, type ElectronApplication, type Page } from '@playwright/test';
import { existsSync, mkdirSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { launchApp, seedSalesE2E } from './helpers';

const FR = { BASECRAFT_REGION: 'fr-FR' };
const fr = JSON.parse(readFileSync(join(__dirname, '../../src/shared/i18n/fr.json'), 'utf8'));
const shot = async (page: Page, name: string) => {
  if (!process.env.BC_SHOT) return;
  mkdirSync(process.env.BC_SHOT, { recursive: true });
  await page.screenshot({ path: join(process.env.BC_SHOT, `${name}.png`) });
};
const printedHtml = (app: ElectronApplication) => app.evaluate(() => (globalThis as unknown as { __bcPrintE2E: { html: string } }).__bcPrintE2E.html);
const tool = async (page: Page, id: string) => {
  await page.getByTestId('ribbon-tab-databaseTools').click();
  await page.getByTestId(`cmd-${id}`).click();
};

test('relationship report: the Relationships window as a document with the base name, saved as PDF', async () => {
  const base = seedSalesE2E('rapport-relations');
  const pdf = join(mkdtempSync(join(tmpdir(), 'bc-pdf-')), 'relations.pdf');
  const { app, page } = await launchApp({ args: [base], env: { ...FR, BASECRAFT_E2E_PDF_PATH: pdf } });
  try {
    await tool(page, 'relationships');
    await page.getByTestId('cmd-allRelationships').click();
    await expect(page.getByTestId('rel-table-Clients')).toBeVisible();
    await page.getByTestId('cmd-relationshipReport').click();
    await expect(page.getByTestId('document-dialog')).toBeVisible();
    const frame = page.frameLocator('[data-testid="document-frame"]');
    await expect(frame.locator('header h1')).toContainText(`${fr.ribbon.cmd.relationshipReport} – rapport-relations`);
    await expect(frame.locator('svg text', { hasText: /^Clients$/ })).toBeVisible();
    await expect(frame.locator('svg text', { hasText: /^Commandes$/ })).toBeVisible();
    await expect(frame.locator('svg text', { hasText: '∞' })).toBeVisible();   // the enforced relation
    await shot(page, 'k3-relationship-report');
    await page.getByTestId('document-pdf').click();
    await expect(page.getByTestId('document-status')).toHaveText(fr.report.pdfSaved);
    expect(existsSync(pdf)).toBe(true);
    expect(readFileSync(pdf).subarray(0, 4).toString()).toBe('%PDF');
    expect(await printedHtml(app)).toContain('rapport-relations');
    await page.getByTestId('document-close').click();
    await expect(page.getByTestId('document-dialog')).toHaveCount(0);
  } finally {
    await app.close();
  }
});

test('object dependencies: Clients is used by QClientsLyon and QVentes; a click opens the query in Design view', async () => {
  const base = seedSalesE2E('dependances');
  const { app, page } = await launchApp({ args: [base], env: FR });
  try {
    await tool(page, 'objectDependencies');   // nothing selected
    await expect(page.getByTestId('modal')).toContainText(fr.dbtools.depsNoSelection);
    await page.getByTestId('modal-btn-ok').click();
    await page.getByTestId('nav-item-Clients').click();
    await tool(page, 'objectDependencies');
    const dialog = page.getByTestId('dependencies-dialog');
    await expect(dialog).toBeVisible();
    await expect(page.getByTestId('deps-on-me').getByTestId('dep-query-QClientsLyon')).toBeVisible();
    await expect(page.getByTestId('deps-on-me').getByTestId('dep-query-QVentes')).toBeVisible();
    await expect(page.getByTestId('dep-query-QDepuis')).toHaveCount(0);
    await shot(page, 'k2-dependencies-table');
    await page.getByTestId('dep-query-QClientsLyon').click();
    await expect(page.getByTestId('doc-tab-query-QClientsLyon')).toBeVisible();
    await expect(page.getByTestId('ribbon-tab-queryDesign')).toHaveAttribute('aria-selected', 'true');
    // and the other way: the query depends on Clients
    await page.getByTestId('nav-item-query-QClientsLyon').click();
    await tool(page, 'objectDependencies');
    await expect(page.getByTestId('deps-i-depend-on').getByTestId('dep-table-Clients')).toBeVisible();
    await shot(page, 'k2-dependencies-query');
    await page.getByTestId('deps-close').click();
  } finally {
    await app.close();
  }
});

test('database documenter: the output holds a table\'s fields and a query\'s SQL', async () => {
  const base = seedSalesE2E('documenteur');
  const { app, page } = await launchApp({ args: [base], env: FR });
  try {
    await page.getByTestId('nav-item-query-QClientsLyon').click();
    await tool(page, 'databaseDocumenter');
    await expect(page.getByTestId('doc-query-QClientsLyon')).toBeChecked();   // the selection is ticked first
    await expect(page.getByTestId('doc-ok')).toBeEnabled();
    await page.getByTestId('doc-table-Clients').check();
    await shot(page, 'k1-documenter-picker');
    await page.getByTestId('doc-ok').click();
    const frame = page.frameLocator('[data-testid="document-frame"]');
    await expect(frame.locator('h2', { hasText: 'Clients' }).first()).toBeVisible();
    await expect(frame.locator('td', { hasText: /^Nom$/ })).toBeVisible();
    await expect(frame.locator('td', { hasText: /^Ville$/ })).toBeVisible();
    await expect(frame.locator('pre')).toContainText('SELECT * FROM [Clients] WHERE [Ville] = "Lyon"');
    await shot(page, 'k1-documenter-output');
    await page.getByTestId('document-print').click();
    expect(await printedHtml(app)).toContain('QClientsLyon');
    await page.getByTestId('document-close').click();
    // Select All
    await tool(page, 'databaseDocumenter');
    await page.getByTestId('doc-all').check();
    await expect(page.getByTestId('doc-table-Commandes')).toBeChecked();
    await expect(page.getByTestId('doc-query-QVentes')).toBeChecked();
    await page.getByTestId('doc-cancel').click();
  } finally {
    await app.close();
  }
});

test('performance analyzer: suggests an index for a field a query filters on; Optimize creates it', async () => {
  const base = seedSalesE2E('performance');
  const { app, page } = await launchApp({ args: [base], env: FR });
  try {
    await tool(page, 'analyzePerformance');
    const list = page.getByTestId('performance-list');
    await expect(list).toContainText('Clients.Ville');
    await expect(list).toContainText('QClientsLyon');
    await shot(page, 'k4-performance');
    await page.getByTestId('perf-optimize-Clients-Ville').click();
    await expect(page.getByTestId('performance-dialog')).toBeVisible();   // shown again, without that suggestion
    await expect(page.getByTestId('perf-optimize-Clients-Ville')).toHaveCount(0);
    const d = await page.evaluate(() => (window as any).basecraft.tables.design('Clients')) as { fields: { name: string; props: { indexed: string } }[] };
    expect(d.fields.find((x) => x.name === 'Ville')!.props.indexed).toBe('yesDuplicates');
    await page.getByTestId('perf-close').click();
    await expect(page.getByTestId('performance-dialog')).toHaveCount(0);
  } finally {
    await app.close();
  }
});
