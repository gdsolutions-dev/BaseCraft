// Test scenario 2 (docs/superpowers/plans/test-set.md): a large CSV (generated once, kept in DATA) imported through the Import
// Text wizard into a new base, analytical SELECT queries in SQL view, then their export to Excel files (External Data › Excel,
// A6). Previous run's files (OUT) are deleted first.
import { test, expect, type Page } from '@playwright/test';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import ExcelJS from 'exceljs';
import { launchApp } from './helpers';

const DATA = join(tmpdir(), 'basecraft-scenarios-data');
const CSV = join(DATA, 'sales-200k.csv');
const ROWS = 200_000;
const OUT = join(tmpdir(), 'basecraft-scenarios', 'test2');
/** The edit texts of a query datasheet's rows (Glide's accessible copy). */
async function shown(page: Page, rows: number): Promise<string[][]> {
  const cols = await doc(page).getByTestId('datasheet').locator('th[role=columnheader]').count();
  const out: string[][] = [];
  for (let r = 0; r < rows; r++) {
    const row: string[] = [];
    for (let c = 0; c < cols; c++) row.push((await doc(page).getByTestId(`glide-cell-${c + 1}-${r}`).textContent()) ?? '');
    out.push(row);
  }
  return out;
}
const doc = (page: Page) => page.locator('section[role=tabpanel]:not([hidden]), .doc:not([hidden])').first();

const REGIONS = ['North', 'South', 'East', 'West', 'Central', 'Northeast', 'Southwest', 'Pacific'];
const CATEGORIES = ['Audio', 'Computers', 'Accessories', 'Phones', 'Home'];
const CHANNELS = ['Web', 'Store', 'Marketplace'];

/** Deterministic: the same file on every machine (mulberry32), written once and kept between runs. */
function ensureCsv(): void {
  if (existsSync(CSV)) return;
  mkdirSync(DATA, { recursive: true });
  let seed = 42;
  const rnd = (n: number) => { // mulberry32
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return (((t ^ (t >>> 14)) >>> 0) / 4294967296 * n) | 0;
  };
  const lines = ['OrderDate,Region,Category,Product,Channel,Quantity,UnitPrice,Discount'];
  for (let i = 0; i < ROWS; i++) {
    const d = new Date(Date.UTC(2025, 0, 1) + rnd(365) * 86_400_000).toISOString().slice(0, 10);
    const c = rnd(CATEGORIES.length), p = rnd(10);
    lines.push([d, REGIONS[rnd(REGIONS.length)], CATEGORIES[c], `${CATEGORIES[c]} item ${p + 1}`, CHANNELS[rnd(CHANNELS.length)],
      1 + rnd(9), (5 + c * 20 + p * 3.5 + rnd(100) / 100).toFixed(2), [0, 0, 0.05, 0.1, 0.15][rnd(5)]].join(','));
  }
  writeFileSync(CSV, lines.join('\n') + '\n', 'utf8');
}

const QUERIES: [string, string, number][] = [
  ['QRevenueByRegion', 'SELECT Region, Count(*) AS Lines, Sum(Quantity * UnitPrice * (1 - Discount)) AS Revenue FROM Sales GROUP BY Region ORDER BY Sum(Quantity * UnitPrice * (1 - Discount)) DESC', 8],
  ['QMonthly', 'SELECT Year(OrderDate) AS Y, Month(OrderDate) AS M, Sum(Quantity * UnitPrice * (1 - Discount)) AS Revenue, Avg(Quantity) AS AvgQty FROM Sales GROUP BY Year(OrderDate), Month(OrderDate) ORDER BY Year(OrderDate), Month(OrderDate)', 12],
  ['QTopProducts', 'SELECT TOP 10 Product, Sum(Quantity) AS Units FROM Sales GROUP BY Product ORDER BY Sum(Quantity) DESC', 10],
  ['QChannelCategory', 'SELECT Channel, Category, Count(*) AS N, Avg(Discount) AS AvgDiscount FROM Sales WHERE Quantity >= 3 GROUP BY Channel, Category ORDER BY Channel, Category', 15],
];

test('scenario 2: large CSV import, analytical queries, export to Excel', async () => {
  test.setTimeout(900_000);
  ensureCsv();
  rmSync(OUT, { recursive: true, force: true });
  mkdirSync(OUT, { recursive: true });
  const base = join(OUT, 'Analytics.basecraft');
  const userDataDir = join(OUT, 'userdata');
  mkdirSync(userDataDir);
  writeFileSync(join(userDataDir, 'settings.json'), JSON.stringify({ locale: 'en' }));
  const timings: Record<string, number> = {};
  const results: Record<string, string[][]> = {};
  let t0 = Date.now();
  const lap = (k: string) => { timings[k] = Date.now() - t0; t0 = Date.now(); };

  const { app, page } = await launchApp({ env: { BASECRAFT_REGION: 'en-US', BASECRAFT_E2E_SAVE_PATH: base, BASECRAFT_E2E_IMPORT_PATH: CSV }, userDataDir });
  try {
    await page.getByTestId('bs-new').click();
    await expect(page.getByTestId('nav-pane')).toBeVisible();

    // 1. Import Text wizard, defaults (comma, headers, inferred types, AutoNumber key), table Sales
    await page.getByTestId('ribbon-tab-externalData').click();
    await page.getByTestId('cmd-importText').click();
    await page.getByTestId('import-browse').click();
    await expect(page.getByTestId('import-path')).toHaveValue(CSV);
    await page.getByTestId('import-btn-next').click();
    await expect(page.getByTestId('import-format-delimited')).toBeChecked();
    await page.getByTestId('import-btn-next').click();
    await expect(page.getByTestId('import-has-header')).toBeChecked();
    await page.getByTestId('import-btn-next').click();
    await page.getByTestId('import-btn-next').click();
    await page.getByTestId('import-btn-next').click();
    await page.getByTestId('import-table-name').fill('Sales');
    lap('wizard');
    await page.getByTestId('import-btn-finish').click();
    await expect(page.getByTestId('import-summary-imported')).toContainText(/200,?000/, { timeout: 600_000 });
    await expect(page.getByTestId('import-summary-errors')).not.toContainText(/[1-9]/);
    await page.getByTestId('import-btn-close').click();
    expect(await page.evaluate(() => (window as any).basecraft.rows.count('Sales'))).toBe(ROWS);
    const design = await page.evaluate(() => (window as any).basecraft.tables.design('Sales'));
    writeFileSync(join(OUT, 'sales-design.json'), JSON.stringify(design.fields.map((f: any) => [f.name, f.props.type, f.props.numberSize ?? null]), null, 2));
    lap('import');

    // 2. analytical queries: SQL view, saved, run as a datasheet
    for (const [name, sql, rows] of QUERIES) {
      await page.getByTestId('ribbon-tab-create').click();
      await page.getByTestId('cmd-createSqlQuery').click();
      await doc(page).getByTestId('query-sql').fill(sql);
      await page.keyboard.press('Control+s');
      await page.getByTestId('modal-input').fill(name);
      await page.getByTestId('modal-btn-ok').click();
      await expect(page.getByTestId(`nav-item-query-${name}`)).toBeVisible();
      const q0 = Date.now();
      await page.getByTestId('cmd-runQuery').click();
      try {
        await expect(doc(page).getByTestId('nav-record-count')).toHaveText(String(rows), { timeout: 120_000 });
        await expect(doc(page).getByTestId('glide-cell-1-0')).not.toBeEmpty();
      } finally {
        timings[`run ${name}`] = Date.now() - q0;
        await page.screenshot({ path: join(OUT, `${name}.png`) });
      }
      results[name] = await shown(page, rows);

      // 3. Export › Excel: the query's open datasheet, through the ribbon; the sheet holds its rows under a header row
      const xlsx = join(OUT, `${name}.xlsx`);
      await app.evaluate((_, path) => { process.env.BASECRAFT_E2E_EXPORT_PATH = path; }, xlsx);
      const x0 = Date.now();
      await page.getByTestId('ribbon-tab-externalData').click();
      await page.getByTestId('cmd-exportExcel').click();
      await expect(page.getByTestId('modal-btn-ok')).toBeVisible({ timeout: 120_000 }); // "n records exported"
      await page.getByTestId('modal-btn-ok').click();
      timings[`export ${name}`] = Date.now() - x0;
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.readFile(xlsx);
      expect(wb.worksheets[0]!.rowCount).toBe(rows + 1);
      expect(String(wb.worksheets[0]!.getCell('A2').value)).toBe(results[name]![0]![0]);
    }
    lap('queries');
    // every line is in exactly one region
    expect(results.QRevenueByRegion!.reduce((a, r) => a + Number(r[1]!.replace(/,/g, '')), 0)).toBe(ROWS);
  } finally {
    writeFileSync(join(OUT, 'timings.json'), JSON.stringify(timings, null, 2));
    writeFileSync(join(OUT, 'results.json'), JSON.stringify(results, null, 2));
    await app.close();
  }
});
