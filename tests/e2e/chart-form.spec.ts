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
