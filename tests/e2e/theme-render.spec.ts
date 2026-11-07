// Thème effectif (F2, tâche 3) : un formulaire dessiné avec le thème par défaut de la base et le mode de l'application (clair/sombre),
// un état toujours en clair ; le HTML d'impression (la feuille de style de l'aperçu, générée par le même reportCss) et le PDF suivent
// les polices du thème, deux passages du même thème donnent la même feuille.
import { test, expect, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { saveObject } from '../../src/main/db/objects';
import { createTable } from '../../src/main/db/schema';
import type { BasecraftApi } from '../../src/shared/api';
import { shade, BUILTIN_THEMES, type Theme } from '../../src/shared/design/theme';
import type { ControlDef, DesignDoc } from '../../src/shared/design/model';
import { FACTURES_REPORT } from '../../src/shared/report/fixtures/factures';
import { clients } from '../../src/shared/test-fixtures';
import { launchApp, seedBase, seedForm, seedReportsE2E } from './helpers';

const FR = { BASECRAFT_REGION: 'fr-FR' };
const OCEAN = BUILTIN_THEMES.find((t) => t.name === 'Océan')!;   // Carlito / Liberation Sans, ni le thème intégré ni Inter
const rgb = (hex: string) => `rgb(${[1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)).join(', ')})`;
const box = (name: string, top: number, props: Record<string, unknown>): ControlDef => ({ kind: 'textBox', name, left: 1701, top, width: 2268, height: 340, props });
const form: DesignDoc = {
  formatVersion: '1.0', recordSource: null, props: { Width: 9072 },
  sections: [{ kind: 'detail', height: 2000, props: {}, controls: [
    box('Themed', 100, { Caption: 'x', ForeColor: 'theme:accent1@-25', FontName: '(Headings)', BackStyle: 'normal', BackColor: 'theme:lt2' }),
    box('Fixed', 600, { ForeColor: '#ff0000', BackStyle: 'normal', BackColor: '#ffcc00' }),
  ] }],
};
/** FACTURES_REPORT whose text boxes use a slot colour and the headings font. */
const themedReport = (): DesignDoc => ({ ...FACTURES_REPORT, sections: FACTURES_REPORT.sections.map((s) => ({ ...s,
  controls: s.controls.map((c) => ({ ...c, props: { ...c.props, ForeColor: 'theme:accent1@-25', FontName: '(Headings)' } })) })) });

const setTheme = (page: Page, t: Theme) => page.evaluate((x) => (window as unknown as { basecraft: BasecraftApi }).basecraft.theme.set(x), t);
const seed = (name: string) => seedBase(name, async (db) => {
  createTable(db, { name: 'Clients', fields: clients.fields.map((f) => ({ name: f.name, props: f.props })) } as never);
  seedReportsE2E(db);
  seedForm(db, 'Themé', form);
  const r = saveObject(db, 'report', 'Thémé', themedReport(), null);
  if (!r.ok) throw new Error(r.reason);
});
const colour = (page: Page, id: string) => page.getByTestId(id).filter({ visible: true }).evaluate((e) => getComputedStyle(e).color);
async function dark(page: Page, mode: 'light' | 'dark') {
  await page.getByTestId('ribbon-tab-file').click();
  await page.getByTestId('bs-options').click();
  await page.getByTestId('opt-theme').selectOption(mode);
  await page.getByTestId('bs-back').click();
}
/** The report preview's style sheet and the text colours drawn. */
async function previewLook(page: Page) {
  await page.getByTestId('nav-item-report-Thémé').dblclick();
  const doc = page.locator('.doc:not([hidden])');
  await expect(doc.getByTestId('preview-page-of')).toBeVisible();
  await expect.poll(() => doc.locator('.bc-text').count()).toBeGreaterThan(0);
  return { css: await doc.getByTestId('report-preview').locator('style').first().textContent(),
    colors: await doc.locator('.bc-text').evaluateAll((els) => [...new Set(els.map((e) => getComputedStyle(e).color))]) };
}

test('forms follow the app mode, a report stays light; theme fonts reach the form, the preview sheet and the PDF', async () => {
  const pdf = join(mkdtempSync(join(tmpdir(), 'basecraft-theme-')), 'themed.pdf');
  const { app, page } = await launchApp({ args: [await seed('theme-render')], env: { ...FR, BASECRAFT_E2E_PDF_PATH: pdf } });
  try {
    await setTheme(page, OCEAN);
    await page.getByTestId('nav-item-form-Themé').dblclick();
    await expect(page.getByTestId('form-run')).toBeVisible();
    const light = rgb(shade(OCEAN.colors.light.accent1, 0.25)), night = rgb(shade(OCEAN.colors.dark.accent1, 0.25));
    await expect.poll(() => colour(page, 'form-ctl-Themed')).toBe(light);
    expect(await page.getByTestId('form-ctl-Themed').filter({ visible: true }).evaluate((e) => getComputedStyle(e).fontFamily)).toContain('BC Carlito');
    await dark(page, 'dark');
    await expect.poll(() => colour(page, 'form-ctl-Themed')).toBe(night);
    expect(night).not.toBe(light);
    expect(await colour(page, 'form-ctl-Fixed')).toBe('rgb(255, 0, 0)');

    const a = await previewLook(page);   // still in dark mode: the report stays light
    expect(a.colors).toContain(light);
    expect(a.colors).not.toContain(night);
    expect(a.css).toContain('BC Carlito');

    await page.getByTestId('cmd-exportPdf').click();
    await page.getByTestId('modal-btn-ok').click();
    const fonts = [...readFileSync(pdf).toString('latin1').matchAll(/\/BaseFont\s*\/([^\s/<>[\]()]+)/g)].map((m) => m[1]!);
    expect(fonts.some((f) => /\+Carlito/.test(f))).toBe(true);
    expect(fonts.some((f) => /\+Inter/.test(f))).toBe(false);
  } finally {
    await app.close();
  }
});

test('the preview sheet of another theme differs; two runs of the same theme are identical', async () => {
  const sheet = async (theme: Theme | null) => {
    const { app, page } = await launchApp({ args: [await seed('theme-render-css')], env: FR });
    try {
      if (theme) await setTheme(page, theme);
      return (await previewLook(page)).css;
    } finally {
      await app.close();
    }
  };
  const [base, o1, o2] = [await sheet(null), await sheet(OCEAN), await sheet(OCEAN)];
  expect(o1).toBe(o2);
  expect(o1).not.toBe(base);
  expect(base).not.toContain('BC Carlito');
});
