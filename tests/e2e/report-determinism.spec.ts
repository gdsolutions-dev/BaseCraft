// Recette de déterminisme (A5) : le modèle de mise en page que l'application dessine est celui du fichier de référence,
// Chromium le dessine avec les avances de la police embarquée, et le PDF a les mêmes pages avec les seules polices
// embarquées. Le fichier de référence est produit par l'application elle-même (BC_UPDATE_GOLDEN=1), jamais à la main ;
// une différence sur un autre OS est un défaut du moteur ou des polices, jamais une raison de le régénérer.
import { test, expect, type Page } from '@playwright/test';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { formatValue } from '../../src/shared/expr/format';
import { num } from '../../src/shared/expr/library';
import { FACTURES_REPORT } from '../../src/shared/report/fixtures/factures';
import { launchApp, layoutFromDom, seedBase, seedReportsE2E, type DomLayout } from './helpers';

const GOLDEN = join(__dirname, 'golden/factures.layout.json');
/** Pinned: region (formats) and time zone. The UI language follows the region (fresh settings). */
const ENV = { BASECRAFT_REGION: 'fr-FR', TZ: 'Pacific/Kiritimati' };
const EMBEDDED = /^[A-Z]{6}\+(LiberationSans|LiberationSerif|LiberationMono|Carlito|Caladea|Inter)/;

/** Spaces compared loosely: ICU's group/currency separators (U+202F, U+00A0) may be substituted for a face (C12). */
const loose = (s: string) => s.replace(/\s/gu, ' ');
const cur = (n: number) => loose(formatValue(num(n), 'currency', { locale: 'fr-FR', lang: 'fr' }));

/** Every line of the active preview at 100 %: [page, text, drawn width (px), model width (twips)]. */
async function drawnWidths(page: Page): Promise<[number, string, number, number][]> {
  const doc = page.locator('.doc:not([hidden])');
  const out: [number, string, number, number][] = [];
  for (let n = 1; ; n++) {
    const p = doc.locator(`.bc-page[data-page="${n}"]`);
    await p.waitFor();
    out.push(...await p.locator('.bc-line').evaluateAll((els, n) => els.map((l): [number, string, number, number] =>
      [n, l.textContent ?? '', l.getBoundingClientRect().width, Number((l as HTMLElement).dataset.w)]), n));
    if (!(await doc.getByTestId('preview-nav-next').isEnabled())) return out;
    await doc.getByTestId('preview-nav-next').click();
  }
}

test('determinism: layout model = golden, drawn widths = model, PDF pages and fonts, exact totals', async () => {
  // AutoReport's =Date()/=Time() would change the golden every run: the reference report reads no clock
  expect(JSON.stringify(FACTURES_REPORT)).not.toMatch(/\b(Date|Now|Time)\s*\(/i);

  const out = mkdtempSync(join(tmpdir(), 'basecraft-det-'));
  const pdfPath = join(out, 'factures.pdf');
  const seed = seedBase('etats', seedReportsE2E);
  const { app, page } = await launchApp({ args: [seed], env: { ...ENV, BASECRAFT_E2E_PDF_PATH: pdfPath } });
  try {
    await page.getByTestId('nav-group-report').getByTestId('nav-item-report-Factures par client').dblclick();
    const doc = page.locator('.doc:not([hidden])');
    await expect(doc.getByTestId('preview-page-of')).toHaveText('Page 1 sur 3');
    expect(await page.evaluate(() => document.fonts.check('10pt "BC Liberation Sans"'))).toBe(true);

    // 1. the layout model, against the golden file produced by the app
    const model = await layoutFromDom(page);
    if (process.env.BC_UPDATE_GOLDEN === '1') {
      mkdirSync(dirname(GOLDEN), { recursive: true });
      // one band line, one text line per row: reviewable diffs
      const text = JSON.stringify(model, null, 2).replace(/\[\n\s+("(?:[^"\\]|\\.)*",)\n\s+(-?\d+),\n\s+(-?\d+),\n\s+(-?\d+)\n\s+\]/g, '[$1 $2, $3, $4]');
      writeFileSync(GOLDEN, text + '\n');
    }
    if (!existsSync(GOLDEN)) throw new Error(`golden missing: ${GOLDEN} (BC_UPDATE_GOLDEN=1 npm run e2e -- report-determinism)`);
    const golden = JSON.parse(readFileSync(GOLDEN, 'utf8')) as DomLayout;
    expect(model).toEqual(golden);
    expect(model.pages).toHaveLength(3);

    // 4. the exact totals, in the Group Footers and the Report Footer
    const texts = (section: string) => model.pages.flatMap((p) => p.bands.filter((b) => b.section === section).flatMap((b) => b.lines.map((l) => loose(l[0]))));
    expect(texts('groupFooter')).toEqual(expect.arrayContaining([cur(6), cur(121), cur(19999.9)]));
    expect(texts('reportFooter')).toEqual(expect.arrayContaining(['75', cur(20126.9)]));

    // 2. the drawing follows the model: at 100 %, each line is as wide as its advances (no kerning, no fallback font)
    expect(await doc.locator('.bc-text').evaluateAll((els) => els.filter((e) => !getComputedStyle(e).fontFamily.startsWith('"BC ')).length)).toBe(0);
    await page.getByTestId('cmd-previewZoom').click();
    await expect.poll(() => doc.locator('.bc-page').first().evaluate((el) => el.getBoundingClientRect().width)).toBeCloseTo(11906 / 15, 0);
    await doc.getByTestId('preview-nav-first').click();
    const widths = await drawnWidths(page);
    expect(widths.length).toBe(model.pages.flatMap((p) => p.bands.flatMap((b) => b.lines)).length);
    const off = widths.filter(([, , px, w]) => { const want = w / 20 * 4 / 3; return Math.abs(px - want) > want * 0.01 + 0.5; });
    expect(off).toEqual([]);

    // 3. the PDF: as many A4 pages as the model, the embedded faces only
    await page.getByTestId('cmd-exportPdf').click();
    await expect(page.getByTestId('modal-btn-ok')).toBeVisible();
    await page.getByTestId('modal-btn-ok').click();
    const pdf = readFileSync(pdfPath).toString('latin1');
    expect(pdf.match(/\/Type\s*\/Page[^s]/g)).toHaveLength(model.pages.length);
    for (const box of pdf.matchAll(/\/MediaBox\s*\[\s*0\s+0\s+([\d.]+)\s+([\d.]+)\s*\]/g)) {
      expect(Math.abs(Number(box[1]) - 595.28)).toBeLessThan(1);
      expect(Math.abs(Number(box[2]) - 841.89)).toBeLessThan(1);
    }
    expect(pdf).toMatch(/\/FontFile2/);
    const fonts = [...pdf.matchAll(/\/BaseFont\s*\/([^\s/<>[\]()]+)/g)].map((m) => m[1]!);
    expect(fonts.length).toBeGreaterThan(0);
    expect(fonts.filter((f) => !EMBEDDED.test(f))).toEqual([]);
  } finally {
    await app.close();
  }
});
