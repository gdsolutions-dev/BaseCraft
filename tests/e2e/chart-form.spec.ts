// Graphique moderne en vues Formulaire et Création (F4, tâche 6) : barres par client, titre par défaut, repère sans valeurs,
// exemple fixe en Création sans source, couleur d'accent qui suit le mode clair/sombre de l'application.
import { test, expect, type Page } from '@playwright/test';
import { createTable } from '../../src/main/db/schema';
import { insertRow } from '../../src/main/db/write-layer';
import type { ControlDef, DesignDoc } from '../../src/shared/design/model';
import { chartPalette } from '../../src/shared/chart/palette';
import { DEFAULT_THEME } from '../../src/shared/design/theme';
import { localeInfo } from '../../src/shared/locale-format';
import { f, t } from '../../src/shared/test-fixtures';
import { launchApp, pickView, seedBase, seedForm } from './helpers';

const FR = { BASECRAFT_REGION: 'fr-FR' };
const region = localeInfo('fr-FR');
const table = t('Commandes', [f('Client', 'shortText'), f('Montant', 'number', { numberSize: 'double' })]);
const chart = (name: string, top: number, props: Record<string, unknown>): ControlDef => ({ kind: 'chart', name, left: 200, top, width: 5000, height: 2400, props });
const doc: DesignDoc = {
  formatVersion: '1.0', recordSource: { kind: 'table', name: 'Commandes' }, props: { Width: 5500 },
  sections: [{ kind: 'detail', height: 5000, props: {}, controls: [
    chart('Graph', 100, { HasLegend: false, ChartAxis: ['Client'], ChartValues: [{ field: 'Montant', agg: 'sum' }] }),
    chart('Vide', 2600, {}),
  ] }],
};
const seed = (name: string, form: DesignDoc = doc) => seedBase(name, async (db) => {
  createTable(db, table);
  for (const [Client, Montant] of [['Dupont', 10], ['Durand', 20], ['Dupont', 5], ['Martin', 7]] as const) await insertRow(db, table, { Client, Montant }, region);
  seedForm(db, 'FicheCmd', form);
});
const svg = (page: Page) => page.getByTestId('form-ctl-Graph').filter({ visible: true }).locator('svg').first();
const bars = (page: Page) => svg(page).locator('path[fill]:not([fill="none"])').evaluateAll((els) => els.map((e) => e.getAttribute('fill')!));
async function mode(page: Page, m: 'light' | 'dark') {
  await page.getByTestId('ribbon-tab-file').click();
  await page.getByTestId('bs-options').click();
  await page.getByTestId('opt-theme').selectOption(m);
  await page.getByTestId('bs-back').click();
}

test('the form view draws one bar per client with the default title, and a placeholder without values', async () => {
  const { app, page } = await launchApp({ args: [await seed('chart-form')], env: FR });
  try {
    await page.getByTestId('nav-item-form-FicheCmd').dblclick();
    await expect(page.getByTestId('form-run')).toBeVisible();
    await expect(svg(page)).toBeVisible();
    await expect(page.getByTestId('chart-svg').first()).toBeAttached();
    await expect(svg(page)).toContainText('Titre du graphique');
    const accent = DEFAULT_THEME.colors.light.accent1.toLowerCase();
    await expect.poll(async () => (await bars(page)).filter((c) => c.toLowerCase() === accent).length).toBe(3);
    await expect(page.getByTestId('form-ctl-Vide').filter({ visible: true }).getByTestId('chart-empty')).toBeVisible();
  } finally { await app.close(); }
});

test('the design view draws the sample without a source', async () => {
  const { app, page } = await launchApp({ args: [await seed('chart-design')], env: FR });
  try {
    await page.getByTestId('nav-item-form-FicheCmd').dblclick();
    await expect(page.getByTestId('form-run')).toBeVisible();
    await pickView(page, 'viewDesign');
    const sample = page.getByTestId('design-chart-sample').filter({ visible: true });
    await expect(sample.first()).toBeVisible();
    await expect(sample.first().getByTestId('design-chart-svg')).toBeAttached();
    // le graphique sans source propre prend celle du formulaire : données réelles, seul « Vide » (sans valeurs) reste l'exemple
    await expect(sample).toHaveCount(1);
    await expect(page.getByTestId('design-chart-svg').filter({ visible: true })).toHaveCount(2);
  } finally { await app.close(); }
});

test('the bars take the dark accent1 in dark mode and the text stays readable', async () => {
  const { app, page } = await launchApp({ args: [await seed('chart-dark')], env: FR });
  try {
    const th = DEFAULT_THEME;
    await page.getByTestId('nav-item-form-FicheCmd').dblclick();
    await expect(svg(page)).toBeVisible();
    await expect.poll(async () => (await bars(page))[0]?.toLowerCase()).toBe(th.colors.light.accent1.toLowerCase());
    await mode(page, 'dark');
    await expect.poll(async () => (await bars(page))[0]?.toLowerCase()).toBe(th.colors.dark.accent1.toLowerCase());
    const text = await svg(page).locator('text').first().getAttribute('fill');
    expect(text?.toLowerCase()).toBe(chartPalette(th, 'dark').text.toLowerCase());
  } finally { await app.close(); }
});

test('a continuous form draws its chart for the current record only', async () => {
  const cont: DesignDoc = { ...doc, props: { Width: 5500, DefaultView: 'continuous' }, sections: [{ kind: 'detail', height: 2600, props: {}, controls: [doc.sections[0].controls[0]] }] };
  const { app, page } = await launchApp({ args: [await seed('chart-continuous', cont)], env: FR });
  try {
    await page.getByTestId('nav-item-form-FicheCmd').dblclick();
    await expect(page.getByTestId('form-run')).toBeVisible();
    await expect(page.getByTestId('chart-svg')).toHaveCount(1);
    await expect(page.getByTestId('form-ctl-Graph')).not.toHaveCount(1);
  } finally { await app.close(); }
});

const F5A = ['doughnut', 'arc', 'funnel', 'scatter', 'bubble'] as const;
const f5Table = t('Commandes5', [f('Client', 'shortText'), f('Quantite', 'number', { numberSize: 'double' }), f('Montant', 'number', { numberSize: 'double' }), f('Remise', 'number', { numberSize: 'double' })]);
const f5Doc: DesignDoc = {
  formatVersion: '1.0', recordSource: null, props: { Width: 5500 },
  sections: [{ kind: 'detail', height: 12000, props: {}, controls: [
    ...F5A.map((ty, i) => chart(`S_${ty}`, 100 + i * 2400, { ChartType: ty })),
    chart('Anneau', 12100, { ChartType: 'doughnut', HasLegend: false, ChartSource: { kind: 'table', name: 'Commandes5' }, ChartAxis: ['Client'], ChartValues: [{ field: 'Montant', agg: 'sum' }] }),
    chart('NuageTexte', 16900, { ChartType: 'scatter', HasLegend: false, ChartSource: { kind: 'table', name: 'Commandes5' }, ChartAxis: ['Client'], ChartValues: [{ field: 'Montant', agg: 'sum' }] }),
    chart('Nuage', 14500, { ChartType: 'scatter', HasLegend: false, ChartSource: { kind: 'table', name: 'Commandes5' }, ChartAxis: ['Quantite'], ChartValues: [{ field: 'Montant', agg: 'sum' }] }),
  ] }],
};
const seed5 = (name: string) => seedBase(name, async (db) => {
  createTable(db, f5Table);
  for (const [Client, Quantite, Montant] of [['Dupont', 1, 10], ['Durand', 2, 20], ['Dupont', 3, 5], ['Martin', 4, 7]] as const) await insertRow(db, f5Table, { Client, Quantite, Montant }, region);
  seedForm(db, 'Fiche5', f5Doc);
});

test('F5a design view: each new type draws its sample without NaN', async () => {
  test.setTimeout(120000);
  const { app, page } = await launchApp({ args: [await seed5('chart-f5-design')], env: FR });
  try {
    await page.getByTestId('nav-item-form-Fiche5').dblclick();
    await expect(page.getByTestId('form-run')).toBeVisible();
    await pickView(page, 'viewDesign');
    for (const ty of F5A) {
      const c = page.getByTestId('design-chart-sample').filter({ visible: true }).nth(F5A.indexOf(ty));
      await c.scrollIntoViewIfNeeded();
      const s = c.getByTestId('design-chart-svg');
      await expect(s).toBeAttached();
      expect(await s.locator('path, circle, rect').count()).toBeGreaterThan(0);
      expect(await s.textContent()).not.toMatch(/NaN|undefined/);
    }
  } finally { await app.close(); }
});

test('F5a form view: a Doughnut (slice per client) and a Scatter (point per row) from real data', async () => {
  test.setTimeout(120000);
  const { app, page } = await launchApp({ args: [await seed5('chart-f5-form')], env: FR });
  try {
    await page.getByTestId('nav-item-form-Fiche5').dblclick();
    await expect(page.getByTestId('form-run')).toBeVisible();
    const slices = page.getByTestId('form-ctl-Anneau').filter({ visible: true }).locator('svg path[fill^="#"]');
    await expect.poll(() => slices.count()).toBe(3);
    const pts = page.getByTestId('form-ctl-Nuage').filter({ visible: true }).locator('svg path[fill^="#"]');
    await expect.poll(() => pts.count()).toBe(4);
    // X texte : rien à tracer, le texte d'aide du nuage (pas « Aucune donnée ») recouvre le graphique
    const txt = page.getByTestId('form-ctl-NuageTexte').filter({ visible: true }).getByTestId('chart-empty');
    await expect(txt).toBeVisible();
    await expect(txt).not.toContainText('Aucune donnée');
    await expect(txt).toContainText('nombre');
  } finally { await app.close(); }
});

const mesures = t('Mesures', [f('Groupe', 'shortText'), f('Valeur', 'number', { numberSize: 'double' })]);
const seed5b = (name: string) => seedBase(name, async (db) => {
  createTable(db, mesures);
  for (const [Groupe, Valeur] of [...[1, 2, 3, 4, 5, 6, 7, 8, 9, 100].map((v) => ['A', v] as const), ...[2, 4, 4, 5, 7, 9].map((v) => ['B', v] as const)]) await insertRow(db, mesures, { Groupe, Valeur }, region);
  seedForm(db, 'Fiche5b', { formatVersion: '1.0', recordSource: { kind: 'table', name: 'Mesures' }, props: { Width: 5500 }, sections: [{ kind: 'detail', height: 8000, props: {}, controls: [
    chart('Boite', 100, { ChartType: 'boxWhisker', HasLegend: false, ChartAxis: ['Groupe'], ChartValues: [{ field: 'Valeur', agg: 'none' }] }),
    chart('Cascade', 2600, { ChartType: 'waterfall', ChartAxis: ['Groupe'], ChartValues: [{ field: 'Valeur', agg: 'sum' }] }),
    chart('CascadeSansTotal', 5100, { ChartType: 'waterfall', WaterfallShowTotal: false, ChartAxis: ['Groupe'], ChartValues: [{ field: 'Valeur', agg: 'sum' }] }),
  ] }] });
});

test('F5b form view: a Box and Whisker draws two boxes and the outlier point; the Waterfall total bar and legend follow "Afficher le total"', async () => {
  test.setTimeout(120000);
  const { app, page } = await launchApp({ args: [await seed5b('chart-f5b-form')], env: FR });
  try {
    await page.getByTestId('nav-item-form-Fiche5b').dblclick();
    await expect(page.getByTestId('form-run')).toBeVisible();
    const of = (n: string) => page.getByTestId(`form-ctl-${n}`).filter({ visible: true }).locator('svg').first();
    const box = of('Boite');
    await expect.poll(() => box.locator('path[fill-opacity="0.35"]').count()).toBe(2);   // une boîte par groupe
    await expect(box.locator('path[transform^="matrix(5,"][fill^="#"]')).toHaveCount(1);   // le point aberrant (100 pour le groupe A)
    expect(await box.textContent()).toContain('A');
    expect(await box.textContent()).not.toMatch(/NaN|undefined/);
    const full = of('Cascade'), off = of('CascadeSansTotal');
    await expect(full).toContainText('Total');
    await expect(full).toContainText('Hausse');
    await expect(off).toContainText('Hausse');
    await expect(off).toContainText('Baisse');
    await expect(off).not.toContainText('Total');   // ni barre ni entrée de légende
    expect((await off.locator('text').allTextContents()).filter((x) => x === 'Hausse' || x === 'Baisse' || x === 'Total')).toEqual(['Hausse', 'Baisse']);
  } finally { await app.close(); }
});
