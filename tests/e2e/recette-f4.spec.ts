// Recette F4 : un graphique en colonnes des commandes par mois sur FicheClient suit le client courant (champs père/fils), copié dans
// un état il s'imprime dans le PDF (deux exports identiques), passé en Combiné (Montant en courbe sur l'axe secondaire) il montre deux axes
// des valeurs dans la fiche et dans le PDF, enregistré puis rouvert à l'identique ; chacun des 16 types se dessine depuis le menu.
import { test, expect, type Locator, type Page } from '@playwright/test';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { inflateSync } from 'node:zlib';
import type { BasecraftApi } from '../../src/shared/api';
import { saveObject } from '../../src/main/db/objects';
import { createTable } from '../../src/main/db/schema';
import { insertRow } from '../../src/main/db/write-layer';
import { CHART_TYPES, chartFamily, F5_CHART_TYPES } from '../../src/shared/chart/spec';
import type { ControlDef, DesignDoc } from '../../src/shared/design/model';
import { localeInfo } from '../../src/shared/locale-format';
import { f, t } from '../../src/shared/test-fixtures';
import { launchApp, seedBase, seedForm } from './helpers';

const FR = { BASECRAFT_REGION: 'fr-FR' };
const clients = t('Clients', [f('Nom', 'shortText')]);
const commandes = t('Commandes', [f('Client', 'shortText'), f('Montant', 'number', { numberSize: 'double' }), f('Quantite', 'number', { numberSize: 'double' }), f('Jour', 'dateTime')]);
const ROWS: [string, number, number, string][] = [['Dupont', 1000, 2, '2026-01-05'], ['Dupont', 3000, 4, '2026-02-03'], ['Martin', 2000, 3, '2026-03-09'], ['Durand', 500, 1, '2026-01-20']];
const ctl = (kind: ControlDef['kind'], name: string, top: number, height: number, props: Record<string, unknown>): ControlDef => ({ kind, name, left: 200, top, width: 6000, height, props });
const ficheClient: DesignDoc = { formatVersion: '1.0', recordSource: { kind: 'table', name: 'Clients' }, props: { Width: 6500 }, sections: [
  { kind: 'detail', height: 3800, props: {}, controls: [ctl('textBox', 'Nom', 100, 340, { ControlSource: 'Nom' }),
    ctl('chart', 'Graph', 600, 3000, { HasLegend: true, ChartSource: { kind: 'table', name: 'Commandes' }, ChartAxis: ['Jour'], ChartDateGroup: 'month',
      ChartValues: [{ field: 'Quantite', agg: 'sum' }, { field: 'Montant', agg: 'sum' }], LinkMasterFields: 'Nom', LinkChildFields: 'Client' })] }] };
const vide: DesignDoc = { formatVersion: '1.0', recordSource: null, props: { Width: 9072 }, sections: [
  { kind: 'formHeader', height: 0, props: { Visible: false }, controls: [] },
  { kind: 'detail', height: 4536, props: {}, controls: [] },
  { kind: 'formFooter', height: 0, props: { Visible: false }, controls: [] }] };
const etat: DesignDoc = { formatVersion: '1.0', recordSource: null, props: { Width: 9072 }, sections: [{ kind: 'reportHeader', height: 4536, props: {}, controls: [] }] };

const cur = (page: Page) => page.locator('.doc:not([hidden])');
const getDoc = (page: Page, kind: 'form' | 'report', name: string) => page.evaluate(([k, n]) =>
  (window as unknown as { basecraft: BasecraftApi }).basecraft.objects.get(k as 'form', n), [kind, name]).then((r) => r.definition as DesignDoc);
const chartProps = async (page: Page, kind: 'form' | 'report', name: string) =>
  (await getDoc(page, kind, name)).sections.flatMap((s) => s.controls).find((c) => c.kind === 'chart')?.props;
async function openDesign(page: Page, kind: 'form' | 'report', name: string) {
  await page.getByTestId(`nav-item-${kind}-${name}`).click({ button: 'right' });
  await page.getByTestId('nav-menu-design').click();
  await expect(cur(page).getByTestId('designer')).toBeVisible();
}
const closeTab = async (page: Page, kind: 'form' | 'report', name: string) => {
  await page.getByTestId(`doc-tab-close-${kind}-${name}`).click();
  await expect(page.getByTestId(`doc-tab-${kind}-${name}`)).toHaveCount(0);
};
async function draw(page: Page, body: Locator) {
  const b = (await body.boundingBox())!;
  await page.mouse.move(b.x + 40, b.y + 20);
  await page.mouse.down();
  await page.mouse.move(b.x + 200, b.y + 100, { steps: 3 });
  await page.mouse.move(b.x + 520, b.y + 260, { steps: 3 });
  await page.mouse.up();
}
const shown = (page: Page, id: string) => page.getByTestId(id).filter({ visible: true });
const next = (page: Page) => shown(page, 'form-run').getByRole('button', { name: 'Enregistrement suivant' });
/** Les flux décompressés d'un PDF (Flate) : de quoi comparer deux exports sans leurs dates. */
function streams(path: string): string[] {
  const raw = readFileSync(path), s = raw.toString('latin1'), out: string[] = [];
  for (const m of s.matchAll(/stream\r?\n/g)) {
    const from = m.index! + m[0].length, to = s.indexOf('endstream', from);
    try { out.push(inflateSync(raw.subarray(from, to)).toString('latin1')); } catch { /* flux non compressé */ }
  }
  return out;
}
/** Les mots lisibles du PDF : chaque segment de texte (Tj / TJ) décodé avec le ToUnicode de chaque police (Identity-H, 2 octets) ;
 *  on ne sait pas quelle police sert quel segment, on garde tout ce que chaque table sait lire. */
function pdfWords(path: string): string {
  const all = streams(path), maps: Map<number, string>[] = [];
  const swap = (h: string) => Buffer.from(Buffer.from(h, 'hex').swap16()).toString('utf16le');
  for (const c of all) {
    if (!c.includes('begincmap')) continue;
    const map = new Map<number, string>();
    for (const b of c.matchAll(/beginbfchar([\s\S]*?)endbfchar/g)) for (const m of b[1]!.matchAll(/<([0-9a-f]+)>\s*<([0-9a-f]+)>/gi)) map.set(parseInt(m[1]!, 16), swap(m[2]!));
    for (const b of c.matchAll(/beginbfrange([\s\S]*?)endbfrange/g)) for (const m of b[1]!.matchAll(/<([0-9a-f]+)>\s*<([0-9a-f]+)>\s*<([0-9a-f]+)>/gi)) {
      const lo = parseInt(m[1]!, 16), hi = parseInt(m[2]!, 16), base = parseInt(m[3]!, 16);
      for (let g = lo; g <= hi; g++) map.set(g, String.fromCharCode(base + g - lo));
    }
    maps.push(map);
  }
  const out: string[] = [];
  for (const c of all) {
    if (c.includes('begincmap')) continue;
    // Skia pose chaque glyphe par un Td : on rassemble les glyphes d'une même police (entre deux Tf)
    for (const run of c.split(/\/F\d+ [\d.]+ Tf/)) {
      const hex = [...run.matchAll(/<([0-9a-f]+)>\s*Tj|\[([^\]]*)\]\s*TJ/gi)].flatMap((m) => [...(m[1] ?? m[2]!).matchAll(/[0-9a-f]{4,}/gi)].map((h) => h[0])).join('');
      for (const map of maps) out.push([...hex.matchAll(/[0-9a-f]{4}/gi)].map((g) => map.get(parseInt(g[0], 16)) ?? '').join(''));
    }
  }
  return out.join('|');
}

/** Le texte des nœuds <text> d'un SVG, un élément par entrée. */
const texts = (svg: Locator) => svg.locator('text').allTextContents();

test('F4: column chart follows the client, prints in the PDF, becomes a Combo with two value axes, saved and reopened', async () => {
  test.setTimeout(300000);
  const base = await seedBase('recette-f4', async (db) => {
    createTable(db, clients); createTable(db, commandes);
    for (const Nom of ['Dupont', 'Martin', 'Durand']) await insertRow(db, clients, { Nom }, localeInfo('en-US'));
    for (const [Client, Montant, Quantite, Jour] of ROWS) await insertRow(db, commandes, { Client, Montant, Quantite, Jour }, localeInfo('en-US'));
    seedForm(db, 'FicheClient', ficheClient);
    const r = saveObject(db, 'report', 'Etat', etat, null);
    if (!r.ok) throw new Error(r.reason);
  });
  const dir = mkdtempSync(join(tmpdir(), 'basecraft-f4-'));
  const pdfs = ['a', 'b', 'c', 'd'].map((n) => join(dir, `${n}.pdf`));
  const exportPdf = async (a: Awaited<ReturnType<typeof launchApp>>, file: string) => {
    await a.app.evaluate((_e, p) => { process.env.BASECRAFT_E2E_PDF_PATH = p; }, file);
    await a.page.getByTestId('cmd-exportPdf').click();
    await a.page.getByTestId('modal-btn-ok').click();
  };
  let a = await launchApp({ args: [base], env: { ...FR, BASECRAFT_E2E_PDF_PATH: pdfs[0]! } });
  try {
    const page = a.page;
    // 1. la fiche suit le client : Dupont (janvier, février), Martin (mars)
    await page.getByTestId('nav-item-form-FicheClient').dblclick();
    await expect(shown(page, 'form-run')).toBeVisible();
    const svg1 = shown(page, 'form-ctl-Graph').locator('svg').first();
    await expect(svg1).toContainText('2026-02');
    await expect(svg1).not.toContainText('2026-03');
    await next(page).click();
    await expect(svg1).toContainText('2026-03');
    await expect(svg1).not.toContainText('2026-02');
    await closeTab(page, 'form', 'FicheClient');

    // 2. copié dans l'état : aperçu, deux PDF identiques qui contiennent le graphique
    await openDesign(page, 'form', 'FicheClient');
    await cur(page).getByTestId('ctl-Graph').click();
    await page.keyboard.press('Control+c');
    await openDesign(page, 'report', 'Etat');
    await cur(page).getByTestId('section-reportHeader').click();
    await page.keyboard.press('Control+v');
    await expect(cur(page).getByTestId('ctl-Graph')).toBeVisible();
    await page.keyboard.press('Control+s');
    await expect.poll(() => chartProps(page, 'report', 'Etat')).toMatchObject({ ChartAxis: ['Jour'], ChartDateGroup: 'month' });
    await closeTab(page, 'report', 'Etat');
    await page.getByTestId('nav-item-report-Etat').dblclick();
    await expect(cur(page).getByTestId('preview-page-of')).toHaveText(/^Page 1 sur \d+$/);
    await expect(cur(page).locator('.bc-chart svg')).toBeVisible();
    await exportPdf(a, pdfs[0]!);
    await exportPdf(a, pdfs[1]!);
    expect(streams(pdfs[0]!).length).toBeGreaterThan(0);
    expect(streams(pdfs[1]!)).toEqual(streams(pdfs[0]!));
    const columnWords = pdfWords(pdfs[0]!);
    for (const w of [/2026\D*01/, /2026\D*03/, /SumOfQuantite, SumOfMontant/]) expect(columnWords).toMatch(w);   // un seul axe des valeurs : ses deux séries dans un titre
    await closeTab(page, 'report', 'Etat');

    // 3. Combiné : Montant en courbe sur l'axe secondaire (feuille de propriétés, puis onglet Mise en forme)
    const g = cur(page).getByTestId('ctl-Graph');
    await g.click();
    await page.getByTestId('sheet-tab-format').click();
    await page.getByTestId('prop-ChartType').selectOption('combo');
    await page.getByTestId('chart-settings-tab-format').click();
    await page.getByTestId('chart-series-pick').selectOption('Montant');
    await page.getByTestId('chart-series-type').selectOption('line');
    await page.getByTestId('chart-series-axis-secondary').check();
    const joined = async (loc: Locator) => (await texts(loc)).join('|');
    await expect.poll(async () => joined(g.locator('svg').first())).not.toContain('SumOfQuantite, SumOfMontant');   // chaque axe porte le titre de sa série
    expect(await joined(g.locator('svg').first())).toContain('SumOfMontant');
    await page.keyboard.press('Control+s');
    const series = [{ field: 'Montant', type: 'line', secondary: true }];
    await expect.poll(() => chartProps(page, 'form', 'FicheClient')).toMatchObject({ ChartType: 'combo', ChartSeries: series });

    // la copie dans l'état remplace le graphique en colonnes : le PDF montre aussi les deux axes
    await g.click();
    await page.keyboard.press('Control+c');
    await openDesign(page, 'report', 'Etat');
    await cur(page).getByTestId('ctl-Graph').click();
    await page.keyboard.press('Delete');
    await expect(cur(page).getByTestId('ctl-Graph')).toHaveCount(0);
    await cur(page).getByTestId('section-reportHeader').click();
    await page.keyboard.press('Control+v');
    await expect(cur(page).getByTestId('ctl-Graph')).toBeVisible();
    await page.keyboard.press('Control+s');
    await expect.poll(() => chartProps(page, 'report', 'Etat')).toMatchObject({ ChartType: 'combo', ChartSeries: series });
    await closeTab(page, 'report', 'Etat');
    await closeTab(page, 'form', 'FicheClient');
    await page.getByTestId('nav-item-report-Etat').dblclick();
    await expect(cur(page).locator('.bc-chart svg')).toBeVisible();
    await exportPdf(a, pdfs[2]!);
    await exportPdf(a, pdfs[3]!);
    expect(streams(pdfs[3]!)).toEqual(streams(pdfs[2]!));
    expect(pdfWords(pdfs[2]!)).toContain('SumOfMontant');
    expect(pdfWords(pdfs[2]!)).not.toContain('SumOfQuantite, SumOfMontant');
  } finally { await a.app.close(); }

  // 4. fermeture, réouverture : la fiche garde ses deux axes, le lien suit toujours le client
  a = await launchApp({ args: [base], env: FR });
  try {
    const page = a.page;
    await expect.poll(() => chartProps(page, 'form', 'FicheClient')).toMatchObject({ ChartType: 'combo', LinkMasterFields: 'Nom', LinkChildFields: 'Client',
      ChartSeries: [{ field: 'Montant', type: 'line', secondary: true }] });
    await page.getByTestId('nav-item-form-FicheClient').dblclick();
    await expect(shown(page, 'form-run')).toBeVisible();
    const svg = shown(page, 'form-ctl-Graph').locator('svg').first();
    await expect.poll(async () => (await texts(svg)).join('|')).not.toContain('SumOfQuantite, SumOfMontant');
    await expect(svg).toContainText('SumOfMontant');
    await expect(svg).toContainText('2026-02');
    await next(page).click();
    await expect(svg).not.toContainText('2026-02');
    await expect(svg).toContainText('2026-03');
  } finally { await a.app.close(); }
});

test('F4: every chart type of the Insert Modern Chart menu draws without error', async () => {
  test.setTimeout(600000);
  const base = await seedBase('recette-f4-types', async (db) => {
    createTable(db, commandes);
    for (const [Client, Montant, Quantite, Jour] of ROWS) await insertRow(db, commandes, { Client, Montant, Quantite, Jour }, localeInfo('en-US'));
    seedForm(db, 'Types', vide);
  });
  const { app, page } = await launchApp({ args: [base], env: FR });
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  try {
    await openDesign(page, 'form', 'Types');
    const f4Types = CHART_TYPES.filter((ty) => !F5_CHART_TYPES.includes(ty));   // les types F5 ont leur recette (recette-f5a)
    expect(f4Types.length).toBe(16);
    for (const type of f4Types) {
      await page.getByTestId('cmd-insertModernChart').click();
      const family = chartFamily(type);
      if (family !== 'pie' && family !== 'combo') await page.getByTestId(`chart-family-${family}`).click();
      await page.getByTestId(`chart-type-${type}`).click();
      await draw(page, page.locator('[data-section-body="1"]'));
      await expect(page.getByTestId('chart-settings')).toBeVisible();
      await page.getByTestId('chart-source-kind-tables').check();
      await page.getByTestId('chart-source').selectOption('Commandes');
      await page.getByTestId('chart-axis-Client').check();
      await page.getByTestId('chart-value-Montant').check();
      const chart = cur(page).locator('[data-testid^="ctl-Graphique"]');
      await expect(chart).toHaveCount(1);
      await expect(chart.locator('svg').first()).toContainText('Dupont');
      await expect(page.getByTestId('design-chart-sample')).toHaveCount(0);
      expect(errors, type).toEqual([]);
      await chart.click();
      await page.keyboard.press('Delete');
      await expect(chart).toHaveCount(0);
    }
  } finally { await app.close(); }
});
