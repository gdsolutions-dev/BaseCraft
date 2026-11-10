// Recette F5 : les huit nouveaux types (anneau, arc, entonnoir, nuage de points, bulles, boîte à moustaches, Pareto, cascade) s'insèrent
// depuis Insérer un graphique moderne (exemple en Création), se dessinent depuis Commandes une fois l'onglet Données rempli, s'impriment
// dans le PDF (deux exports aux mêmes flux), montrent les lignes de format de leur type, restent lisibles en mode sombre (base de la
// cascade invisible), et survivent à l'enregistrement et à la réouverture.
import { test, expect, type Locator, type Page } from '@playwright/test';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { inflateSync } from 'node:zlib';
import type { BasecraftApi } from '../../src/shared/api';
import { saveObject } from '../../src/main/db/objects';
import { createTable } from '../../src/main/db/schema';
import { insertRow } from '../../src/main/db/write-layer';
import { chartPalette } from '../../src/shared/chart/palette';
import type { DesignDoc } from '../../src/shared/design/model';
import { DEFAULT_THEME } from '../../src/shared/design/theme';
import { localeInfo } from '../../src/shared/locale-format';
import { f, t } from '../../src/shared/test-fixtures';
import { launchApp, seedBase, seedForm } from './helpers';

const FR = { BASECRAFT_REGION: 'fr-FR' };
const commandes = t('Commandes', [f('Client', 'shortText'), f('Quantite', 'number', { numberSize: 'double' }), f('Montant', 'number', { numberSize: 'double' }),
  f('Remise', 'number', { numberSize: 'double' }), f('Statut', 'shortText'), f('Jour', 'dateTime')]);
const ROWS: [string, number, number, number, string, string][] = [
  ['Dupont', 1, 10, 1, 'Payée', '2026-01-05'], ['Durand', 2, 20, 2, 'Payée', '2026-01-20'], ['Dupont', 3, 5, 0, 'Ouverte', '2026-02-03'],
  ['Martin', 4, 7, 3, 'Ouverte', '2026-03-09'], ['Durand', 5, 12, 1, 'Payée', '2026-03-15'], ['Martin', 6, 9, 2, 'Ouverte', '2026-02-21']];
const fiche: DesignDoc = { formatVersion: '1.0', recordSource: null, props: { Width: 9072 }, sections: [
  { kind: 'formHeader', height: 0, props: { Visible: false }, controls: [] },
  { kind: 'detail', height: 9000, props: {}, controls: [] },
  { kind: 'formFooter', height: 0, props: { Visible: false }, controls: [] }] };
const etat: DesignDoc = { formatVersion: '1.0', recordSource: null, props: { Width: 9072 }, sections: [{ kind: 'reportHeader', height: 9000, props: {}, controls: [] }] };

/** [type, axe, valeurs, ligne de format présente, ligne de format absente] : un graphique par type, dans l'ordre. */
const PLAN = [
  ['doughnut', 'Client', ['Montant'], 'DoughnutHoleSize', 'AxisRange'], ['arc', 'Client', ['Montant'], 'DoughnutHoleSize', 'AxisRange'],
  ['funnel', 'Statut', ['Montant'], 'ChartTitle', 'DoughnutHoleSize'], ['scatter', 'Quantite', ['Montant'], 'AxisRange', 'BubbleMaxSize'],
  ['bubble', 'Quantite', ['Montant', 'Remise'], 'BubbleMaxSize', 'DoughnutHoleSize'], ['boxWhisker', 'Client', ['Montant'], 'AxisRange', 'HasLegend'],
  ['pareto', 'Client', ['Montant'], 'AxisSecTitle', 'AxisSecRange'], ['waterfall', 'Jour', ['Montant'], 'WaterfallShowTotal', 'AxisSecTitle'],
] as const;

const cur = (page: Page) => page.locator('.doc:not([hidden])');
const getDoc = (page: Page, kind: 'form' | 'report', name: string) => page.evaluate(([k, n]) =>
  (window as unknown as { basecraft: BasecraftApi }).basecraft.objects.get(k as 'form', n), [kind, name]).then((r) => r.definition as DesignDoc);
const charts = async (page: Page, kind: 'form' | 'report', name: string) =>
  Object.fromEntries((await getDoc(page, kind, name)).sections.flatMap((s) => s.controls).filter((c) => c.kind === 'chart').map((c) => [c.name, c.props]));
async function openDesign(page: Page, kind: 'form' | 'report', name: string) {
  await page.getByTestId(`nav-item-${kind}-${name}`).click({ button: 'right' });
  await page.getByTestId('nav-menu-design').click();
  await expect(cur(page).getByTestId('designer')).toBeVisible();
}
const closeTab = async (page: Page, kind: 'form' | 'report', name: string) => {
  await page.getByTestId(`doc-tab-close-${kind}-${name}`).click();
  await expect(page.getByTestId(`doc-tab-${kind}-${name}`)).toHaveCount(0);
};
/** Un rectangle par graphique : deux par rangée, à gauche (la feuille de propriétés recouvre le côté droit de la zone de conception). */
async function draw(page: Page, body: Locator, i: number) {
  const b = (await body.boundingBox())!, x = b.x + 8 + (i % 2) * 170, y = b.y + 6 + Math.floor(i / 2) * 124;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + 40, y + 40, { steps: 3 });
  await page.mouse.move(x + 160, y + 114, { steps: 3 });
  await page.mouse.up();
}
function streams(path: string): string[] {
  const raw = readFileSync(path), s = raw.toString('latin1'), out: string[] = [];
  for (const m of s.matchAll(/stream\r?\n/g)) {
    const from = m.index! + m[0].length, to = s.indexOf('endstream', from);
    try { out.push(inflateSync(raw.subarray(from, to)).toString('latin1')); } catch { /* flux non compressé */ }
  }
  return out;
}
async function mode(page: Page, m: 'light' | 'dark') {
  await page.getByTestId('ribbon-tab-file').click();
  await page.getByTestId('bs-options').click();
  await page.getByTestId('opt-theme').selectOption(m);
  await page.getByTestId('bs-back').click();
}

test('F5: eight new chart types, sample then data, format rows per type, PDF, dark mode, saved and reopened', async () => {
  test.setTimeout(420000);
  const base = await seedBase('recette-f5', async (db) => {
    createTable(db, commandes);
    for (const [Client, Quantite, Montant, Remise, Statut, Jour] of ROWS) await insertRow(db, commandes, { Client, Quantite, Montant, Remise, Statut, Jour }, localeInfo('en-US'));
    seedForm(db, 'Fiche', fiche);
    const r = saveObject(db, 'report', 'Etat', etat, null);
    if (!r.ok) throw new Error(r.reason);
  });
  const pdfDir = mkdtempSync(join(tmpdir(), 'basecraft-f5-'));
  const [pdf1, pdf2] = [join(pdfDir, 'a.pdf'), join(pdfDir, 'b.pdf')];
  let a = await launchApp({ args: [base], env: { ...FR, BASECRAFT_E2E_PDF_PATH: pdf1 } });
  let saved: Record<string, Record<string, unknown>> = {};
  try {
    const page = a.page;
    // 1. Création : chaque type s'insère et dessine son exemple, puis ses données (onglet Données) depuis Commandes
    await openDesign(page, 'form', 'Fiche');
    for (const [i, [type, axis, values]] of PLAN.entries()) {
      await page.getByTestId('cmd-insertModernChart').click();
      await page.getByTestId(`chart-type-${type}`).click();
      await draw(page, page.locator('[data-section-body="1"]'), i);
      await expect(page.getByTestId('chart-settings')).toBeVisible();
      await expect(cur(page).getByTestId(`ctl-Graphique${i + 1}`).getByTestId('design-chart-sample')).toBeVisible();   // l'exemple du type
      await page.getByTestId('chart-source-kind-tables').check();
      await page.getByTestId('chart-source').selectOption('Commandes');
      await page.getByTestId(`chart-axis-${axis}`).check();
      if (axis === 'Jour') await page.getByTestId('chart-date-group').selectOption('month');
      for (const v of values) await page.getByTestId(`chart-value-${v}`).check();
      await expect(cur(page).getByTestId(`ctl-Graphique${i + 1}`).locator('svg path[fill^="#"], svg path[fill="none"]').first()).toBeAttached();
    }
    await page.keyboard.press('Control+s');
    await expect.poll(async () => Object.entries(await charts(page, 'form', 'Fiche')).map(([k, p]) => `${k}:${String(p.ChartType)}`))
      .toEqual(PLAN.map(([ty], i) => `Graphique${i + 1}:${ty}`));
    saved = await charts(page, 'form', 'Fiche');

    // 2. Feuille de propriétés : les lignes de format de chaque type (une ligne qui s'applique, une qui ne s'applique pas)
    for (const [i, [type, , , present, absent]] of PLAN.entries()) {
      await cur(page).getByTestId(`ctl-Graphique${i + 1}`).click();
      await page.getByTestId('sheet-tab-format').click();
      await expect(page.getByTestId('prop-ChartType')).toHaveValue(type);
      await expect(page.getByTestId(`prop-${present}`), `${type} montre ${present}`).toBeVisible();
      await expect(page.getByTestId(`prop-${absent}`), `${type} cache ${absent}`).toHaveCount(0);
    }

    // 3. Les huit copiés dans l'état : aperçu, deux PDF aux mêmes flux décompressés
    await cur(page).getByTestId('ctl-Graphique1').click();
    for (let i = 2; i <= 8; i++) await cur(page).getByTestId(`ctl-Graphique${i}`).click({ modifiers: ['Shift'] });
    await page.keyboard.press('Control+c');
    await openDesign(page, 'report', 'Etat');
    await cur(page).getByTestId('section-reportHeader').click();
    await page.keyboard.press('Control+v');
    await expect(cur(page).locator('[data-testid^="ctl-Graphique"]')).toHaveCount(8);
    await page.keyboard.press('Control+s');
    await expect.poll(async () => Object.values(await charts(page, 'report', 'Etat')).map((p) => p.ChartType).sort()).toEqual(PLAN.map(([ty]) => ty).sort());
    await closeTab(page, 'report', 'Etat');
    await page.getByTestId('nav-item-report-Etat').dblclick();
    await expect(cur(page).getByTestId('preview-page-of')).toHaveText(/^Page 1 sur \d+$/);
    await expect(cur(page).locator('.bc-chart svg')).toHaveCount(8);
    for (const file of [pdf1, pdf2]) {
      await a.app.evaluate((_e, p) => { process.env.BASECRAFT_E2E_PDF_PATH = p; }, file);
      await page.getByTestId('cmd-exportPdf').click();
      await page.getByTestId('modal-btn-ok').click();
    }
    expect(streams(pdf1).length).toBeGreaterThan(0);
    expect(streams(pdf2)).toEqual(streams(pdf1));
  } finally { await a.app.close(); }

  // 4. Réouverture : propriétés intactes, huit graphiques dessinés depuis Commandes en vue Formulaire
  a = await launchApp({ args: [base], env: FR });
  try {
    const page = a.page;
    expect(await charts(page, 'form', 'Fiche')).toEqual(saved);
    await page.getByTestId('nav-item-form-Fiche').dblclick();
    await expect(page.getByTestId('form-run')).toBeVisible();
    const of = (n: number) => page.getByTestId(`form-ctl-Graphique${n}`).filter({ visible: true }).locator('svg').first();
    for (const n of [1, 2]) for (const name of ['Dupont', 'Durand', 'Martin']) await expect(of(n)).toContainText(name);
    for (const name of ['Payée', 'Ouverte']) await expect(of(3)).toContainText(name);
    await expect.poll(() => of(4).locator('path[fill^="#"]').count()).toBeGreaterThanOrEqual(6);
    await expect.poll(() => of(5).locator('path[fill^="#"]').count()).toBeGreaterThanOrEqual(6);
    await expect(of(6)).toContainText('Dupont');   // petit graphique : des étiquettes de catégories sont omises
    await expect(of(7)).toContainText('% cumulé');   // les étiquettes de catégories s'éclaircissent dans un graphique aussi petit
    await expect(of(8)).toContainText('2026-01');
    await expect(of(8)).toContainText('Total');
    for (let n = 1; n <= 8; n++) expect(await of(n).textContent(), `graphique ${n}`).not.toMatch(/NaN|undefined/);
    await expect(page.getByRole('alert')).toHaveCount(0);

    // 5. Mode sombre : texte lisible partout, la base transparente de la cascade ne se voit pas
    await mode(page, 'dark');
    const text = chartPalette(DEFAULT_THEME, 'dark').text.toLowerCase();
    for (let n = 1; n <= 8; n++) {   // l'entonnoir écrit dans les étages : noir ou blanc selon le contraste, jamais le texte du thème
      const ok = n === 3 ? [text, '#000000', '#ffffff'] : [text];
      await expect.poll(async () => ok.includes((await of(n).locator('text').first().getAttribute('fill'))?.toLowerCase() ?? ''), `texte du graphique ${n}`).toBe(true);
    }
    const dark = DEFAULT_THEME.colors.dark;
    const allowed = [dark.accent1, dark.accent2, dark.accent3].map((c) => c.toLowerCase());
    await expect.poll(async () => (await of(8).locator('path[fill]:not([fill="none"])').evaluateAll((els) => els.map((e) => [e.getAttribute('fill')!.toLowerCase(), e.getAttribute('fill-opacity')])))
      .filter(([c, o]) => !allowed.includes(c!) && o !== '0')).toEqual([]);   // la base est de opacité 0 : il ne reste de visible que hausse, baisse et total
  } finally { await a.app.close(); }
});
