// Insérer un graphique moderne et volet Paramètres du graphique, onglet Données (F4, tâche 7) : type choisi puis dessin, source,
// axe, valeurs, menu des agrégats (clavier compris), annulation d'un pas, base en lecture seule.
import { test, expect, type Locator, type Page } from '@playwright/test';
import { createTable } from '../../src/main/db/schema';
import { insertRow } from '../../src/main/db/write-layer';
import type { DesignDoc } from '../../src/shared/design/model';
import { localeInfo } from '../../src/shared/locale-format';
import { f, t } from '../../src/shared/test-fixtures';
import { saveObject } from '../../src/main/db/objects';
import { launchApp, seedBase, seedForm } from './helpers';

const FR = { BASECRAFT_REGION: 'fr-FR' };
const region = localeInfo('fr-FR');
const table = t('Commandes', [f('Client', 'shortText'), f('Montant', 'number', { numberSize: 'double' }), f('Jour', 'dateTime')]);
const fiche = (controls: DesignDoc['sections'][number]['controls'] = []): DesignDoc => ({ formatVersion: '1.0', recordSource: null, props: { Width: 9072 }, sections: [
  { kind: 'formHeader', height: 0, props: { Visible: false }, controls: [] },
  { kind: 'detail', height: 4536, props: {}, controls },
  { kind: 'formFooter', height: 0, props: { Visible: false }, controls: [] }] });
const seed = (name: string, controls?: DesignDoc['sections'][number]['controls']) => seedBase(name, async (db) => {
  createTable(db, table);
  for (const [Client, Montant] of [['Dupont', 10], ['Durand', 20], ['Dupont', 5], ['Martin', 7]] as const) await insertRow(db, table, { Client, Montant }, region);
  seedForm(db, 'Fiche', fiche(controls));
});
const openDesign = async (page: Page) => {
  await page.getByTestId('nav-item-form-Fiche').click({ button: 'right' });
  await page.getByTestId('nav-menu-design').click();
  await expect(page.locator('.doc:not([hidden])').getByTestId('designer')).toBeVisible();
};
async function draw(page: Page, body: Locator) {
  const b = (await body.boundingBox())!;
  await page.mouse.move(b.x + 40, b.y + 20);
  await page.mouse.down();
  await page.mouse.move(b.x + 200, b.y + 100, { steps: 3 });
  await page.mouse.move(b.x + 420, b.y + 220, { steps: 3 });
  await page.mouse.up();
}

test('Insert Modern Chart: pick Column, draw, choose source, axis and value, aggregate menu, undo', async () => {
  test.setTimeout(120000);
  const { app, page } = await launchApp({ args: [await seed('chart-settings')], env: FR });
  try {
    await openDesign(page);
    await page.getByTestId('cmd-insertModernChart').click();
    await expect(page.getByTestId('chart-type-pie')).toBeVisible();
    await page.getByTestId('chart-family-column').click();
    for (const type of ['columnClustered', 'columnStacked', 'columnStacked100']) await expect(page.getByTestId(`chart-type-${type}`)).toBeVisible();
    await page.getByTestId('chart-type-columnClustered').click();
    await draw(page, page.locator('[data-section-body="1"]'));
    await expect(page.getByTestId('ctl-Graphique1')).toBeVisible();
    await expect(page.getByTestId('chart-settings')).toBeVisible();
    await page.getByTestId('cmd-chartSettings').click();
    await expect(page.getByTestId('chart-settings')).toBeVisible();
    await expect(page.getByTestId('chart-settings-tab-data')).toBeVisible();
    await expect(page.getByTestId('chart-settings-tab-format')).toBeEnabled();

    await page.getByTestId('chart-source-kind-tables').check();
    await page.getByTestId('chart-source').selectOption('Commandes');
    await page.getByTestId('chart-axis-Client').check();
    await page.getByTestId('chart-value-Montant').check();
    const label = page.getByTestId('chart-value-label-Montant');
    await expect(label).toHaveText('Montant (Somme)');
    await expect(page.getByTestId('ctl-Graphique1')).toContainText('Dupont');
    await expect(page.getByTestId('design-chart-sample')).toHaveCount(0);

    // le menu des agrégats : six choix, la coche sur Somme, Échap le ferme et rend le focus à l'étiquette
    await label.click();
    await expect(page.getByTestId('chart-agg-menu').getByRole('menuitemradio')).toHaveText(['Aucun', 'Somme', 'Moyenne', 'Minimum', 'Maximum', 'Nombre']);
    await expect(page.getByTestId('chart-agg-Montant-sum')).toHaveAttribute('aria-checked', 'true');
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('chart-agg-menu')).toHaveCount(0);
    await expect(label).toBeFocused();

    await label.click();
    await page.getByTestId('chart-agg-Montant-count').click();
    await expect(label).toHaveText('Montant (Nombre)');
    await expect(page.getByTestId('ctl-Graphique1')).toContainText('CountOfMontant');

    // Ctrl+Z : un seul pas
    await page.keyboard.press('Control+z');
    await expect(label).toHaveText('Montant (Somme)');
    await expect(page.getByTestId('ctl-Graphique1')).toContainText('SumOfMontant');

    // the date grouping select only exists when the first axis field is a date
    await expect(page.getByTestId('chart-date-group')).toHaveCount(0);
    await page.getByTestId('chart-axis-Client').uncheck();
    await page.getByTestId('chart-axis-Jour').check();
    await expect(page.getByTestId('chart-date-group')).toBeVisible();
  } finally { await app.close(); }
});

test('Insert Modern Chart: sub-menu keys, then Histogramme empilé 100 % draws full-height bars', async () => {
  test.setTimeout(120000);
  const { app, page } = await launchApp({ args: [await seed('chart-settings-stack')], env: FR });
  try {
    await openDesign(page);
    await page.getByTestId('cmd-insertModernChart').click();
    await page.getByTestId('chart-family-column').focus();
    await page.keyboard.press('ArrowRight');
    await expect(page.getByTestId('chart-type-columnStacked100')).toHaveText('empilé 100 %');
    await expect(page.getByTestId('chart-type-columnClustered')).toHaveText('groupé');
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('chart-type-columnStacked')).toHaveCount(0);
    await expect(page.getByTestId('chart-type-popup')).toBeVisible();
    await expect(page.getByTestId('chart-family-column')).toBeFocused();
    await page.keyboard.press('Enter');
    await page.getByTestId('chart-type-columnStacked100').click();
    await draw(page, page.locator('[data-section-body="1"]'));
    await page.getByTestId('chart-source-kind-tables').check();
    await page.getByTestId('chart-source').selectOption('Commandes');
    await page.getByTestId('chart-axis-Client').check();
    await page.getByTestId('chart-value-Montant').check();
    await expect(page.getByTestId('ctl-Graphique1')).toContainText('Dupont');
    const heights = async () => page.getByTestId('ctl-Graphique1').locator('svg path[d]').evaluateAll((els) =>
      els.map((e) => e.getBoundingClientRect()).filter((r) => r.width > 20 && r.height > 40).map((r) => Math.round(r.height)));
    const h = await heights();
    expect(h.length).toBeGreaterThanOrEqual(2);
    expect(new Set(h).size).toBe(1);
  } finally { await app.close(); }
});

test('Insert Modern Chart: Radar sub-menu (Radar / Remplissage radar) and top-level Combiné', async () => {
  test.setTimeout(120000);
  const { app, page } = await launchApp({ args: [await seed('chart-settings-radar')], env: FR });
  try {
    await openDesign(page);
    await page.getByTestId('cmd-insertModernChart').click();
    await page.getByTestId('chart-family-radar').focus();
    await page.keyboard.press('ArrowRight');
    await expect(page.getByTestId('chart-type-radar')).toHaveText('Radar');
    await expect(page.getByTestId('chart-type-radarFilled')).toHaveText('Remplissage radar');
    await page.keyboard.press('ArrowLeft');
    await expect(page.getByTestId('chart-type-radar')).toHaveCount(0);
    await expect(page.getByTestId('chart-family-radar')).toBeFocused();
    await expect(page.getByTestId('chart-type-combo')).toHaveText('Graphique combiné');
    await page.getByTestId('chart-type-combo').click();
    await draw(page, page.locator('[data-section-body="1"]'));
    await expect(page.getByTestId('ctl-Graphique1')).toBeVisible();
  } finally { await app.close(); }
});

test('Chart Settings Format tab: rename, secondary axis, fill, labels, trendline; one undo step each; arrow keys switch tabs', async () => {
  test.setTimeout(120000);
  const chart = { kind: 'chart' as const, name: 'G1', left: 200, top: 200, width: 5000, height: 2800,
    props: { ChartSource: { kind: 'table', name: 'Commandes' }, ChartAxis: ['Client'], ChartValues: [{ field: 'Montant', agg: 'sum' }] } };
  const { app, page } = await launchApp({ args: [await seed('chart-settings-format', [chart])], env: FR });
  try {
    await openDesign(page);
    await page.getByTestId('ctl-G1').click();
    const g = page.getByTestId('ctl-G1');
    const tabData = page.getByTestId('chart-settings-tab-data');
    const tabFormat = page.getByTestId('chart-settings-tab-format');
    // tabs: role=tab, aria-controls, arrow keys move selection and focus
    await expect(tabData).toHaveAttribute('aria-selected', 'true');
    await expect(tabFormat).toHaveAttribute('aria-controls', /panel-format/);
    await tabData.focus();
    await page.keyboard.press('ArrowRight');
    await expect(tabFormat).toBeFocused();
    await expect(tabFormat).toHaveAttribute('aria-selected', 'true');
    await page.keyboard.press('ArrowLeft');
    await expect(tabData).toBeFocused();
    await page.keyboard.press('ArrowRight');

    await expect(page.getByTestId('chart-series-pick')).toHaveValue('Montant');
    await expect(page.getByTestId('chart-series-pick')).toContainText('SumOfMontant');
    await page.getByTestId('chart-series-name').fill('Ventes');
    await page.getByTestId('chart-series-name').press('Enter');
    await expect(g).toContainText('Ventes');
    await page.getByTestId('chart-series-axis-secondary').check();
    await expect(page.getByTestId('chart-series-axis-secondary')).toBeChecked();
    await page.getByTestId('chart-series-fill').click();
    await page.getByTestId('colorpicker-theme-accent3').click();
    const texts = () => g.locator('svg text').count();
    const before = await texts();
    await page.getByTestId('chart-series-labels').check();
    await expect.poll(texts).toBeGreaterThan(before);
    await page.getByTestId('chart-series-trend').selectOption('linear');
    await expect(g).toContainText('Ventes (Linéaire)');

    // Ctrl+Z: one change at a time (trendline, labels, fill, axis, name)
    await page.getByTestId('chart-series-trend').blur();
    await page.keyboard.press('Control+z');
    await expect(g).not.toContainText('Ventes (Linéaire)');
    await page.keyboard.press('Control+z');
    await expect.poll(texts).toBe(before);
    await page.keyboard.press('Control+z');
    await page.keyboard.press('Control+z');
    await expect(page.getByTestId('chart-series-axis-primary')).toBeChecked();
    await expect(g).toContainText('Ventes');
    await page.keyboard.press('Control+z');
    await expect(g).toContainText('SumOfMontant');
  } finally { await app.close(); }
});

test('Chart Settings Format tab, Combo: the series type select turns a series into a line and back to columns', async () => {
  test.setTimeout(120000);
  const chart = { kind: 'chart' as const, name: 'G1', left: 200, top: 200, width: 5000, height: 2800,
    props: { ChartType: 'combo', ChartSource: { kind: 'table', name: 'Commandes' }, ChartAxis: ['Client'], ChartValues: [{ field: 'Montant', agg: 'sum' }] } };
  const { app, page } = await launchApp({ args: [await seed('chart-settings-combo', [chart])], env: FR });
  try {
    await openDesign(page);
    await page.getByTestId('ctl-G1').click();
    await page.getByTestId('chart-settings-tab-format').click();
    const svg = () => page.getByTestId('ctl-G1').locator('svg').first().innerHTML();
    const columns = await svg();
    const type = page.getByTestId('chart-series-type');
    await expect(type).toHaveValue('column');
    await type.selectOption('line');
    await expect.poll(svg).not.toBe(columns);
    await type.selectOption('column');
    await expect.poll(svg).toBe(columns);
  } finally { await app.close(); }
});

test('Chart Settings on a read-only base: the pane shows, its inputs are disabled, nothing is dirty', async () => {
  const chart = { kind: 'chart' as const, name: 'G1', left: 200, top: 200, width: 5000, height: 2800,
    props: { ChartSource: { kind: 'table', name: 'Commandes' }, ChartAxis: ['Client'], ChartValues: [{ field: 'Montant', agg: 'sum' }] } };
  const base = await seed('chart-settings-ro', [chart]);
  const a = await launchApp({ args: [base] });
  const b = await launchApp({ args: [base], env: FR });
  try {
    const page = b.page;
    await expect(page.getByTestId('banner-readonly')).toBeVisible();
    await openDesign(page);
    await expect(page.getByTestId('cmd-insertModernChart')).toBeDisabled();
    await page.getByTestId('ctl-G1').click();
    await expect(page.getByTestId('chart-settings')).toBeVisible();
    await expect(page.getByTestId('chart-source')).toBeDisabled();
    await expect(page.getByTestId('chart-axis-Client')).toBeDisabled();
    await expect(page.getByTestId('chart-value-Montant')).toBeDisabled();
    await expect(page.getByTestId('chart-legend-none')).toBeDisabled();
    await expect(page.getByTestId('chart-value-label-Montant')).toBeDisabled();
    await page.getByTestId('chart-settings-tab-format').click();
    for (const id of ['chart-series-name', 'chart-series-axis-secondary', 'chart-series-fill', 'chart-series-border', 'chart-series-labels', 'chart-series-trend']) await expect(page.getByTestId(id)).toBeDisabled();
  } finally { await b.app.close(); await a.app.close(); }
});

test('Report design: Insert Modern Chart > Column, draw, pane opens, source, axis field and value draw the chart', async () => {
  test.setTimeout(120000);
  const report: DesignDoc = { formatVersion: '1.0', recordSource: null, props: { Width: 9072 }, sections: [
    { kind: 'detail', height: 4536, props: {}, controls: [] }] };
  const base = await seedBase('chart-settings-report', async (db) => {
    createTable(db, table);
    for (const [Client, Montant] of [['Dupont', 10], ['Durand', 20]] as const) await insertRow(db, table, { Client, Montant }, region);
    const r = saveObject(db, 'report', 'Etat', report, null);
    if (!r.ok) throw new Error(r.reason);
  });
  const { app, page } = await launchApp({ args: [base], env: FR });
  try {
    await page.getByTestId('nav-group-report').getByTestId('nav-item-report-Etat').click({ button: 'right' });
    await page.getByTestId('nav-menu-design').click();
    await expect(page.locator('.doc:not([hidden])').getByTestId('designer')).toBeVisible();
    await page.getByTestId('cmd-insertModernChart').click();
    await page.getByTestId('chart-family-column').click();
    await page.getByTestId('chart-type-columnClustered').click();
    await draw(page, page.locator('[data-section-body="0"]'));
    await expect(page.getByTestId('ctl-Graphique1')).toBeVisible();
    await expect(page.getByTestId('chart-settings')).toBeVisible();
    await page.getByTestId('chart-source').selectOption('Commandes');
    await page.getByTestId('chart-axis-Client').check();
    await page.getByTestId('chart-value-Montant').check();
    await expect(page.getByTestId('ctl-Graphique1')).toContainText('Dupont');
    await expect(page.getByTestId('design-chart-sample')).toHaveCount(0);
  } finally { await app.close(); }
});

test('Property sheet: chart rows, Titre changes the SVG text, Type de graphique redraws and the pane follows; a missing source shows the pane error', async () => {
  test.setTimeout(120000);
  const chart = { kind: 'chart' as const, name: 'G1', left: 200, top: 200, width: 5000, height: 2800,
    props: { ChartSource: { kind: 'table', name: 'Commandes' }, ChartAxis: ['Client'], ChartValues: [{ field: 'Montant', agg: 'sum' }] } };
  const { app, page } = await launchApp({ args: [await seed('chart-sheet', [chart])], env: FR });
  try {
    await openDesign(page);
    await page.getByTestId('ctl-G1').click();
    await page.getByTestId('sheet-tab-format').click();
    await expect(page.getByTestId('prop-ChartType')).toHaveValue('columnClustered');
    await expect(page.getByTestId('prop-ChartTitle')).toHaveValue('Titre du graphique');
    await expect(page.getByTestId('ctl-G1')).toContainText('Titre du graphique');
    await page.getByTestId('prop-ChartTitle').fill('Ventes');
    await page.getByTestId('prop-ChartTitle').press('Enter');
    await expect(page.getByTestId('ctl-G1')).toContainText('Ventes');
    await page.getByTestId('prop-ChartType').selectOption('pie');
    await expect(page.getByTestId('ctl-G1')).toContainText('Dupont');
    await page.getByTestId('sheet-tab-data').click();
    await expect(page.getByTestId('prop-ChartSource')).toHaveValue('Commandes');
    await expect(page.getByTestId('prop-ChartValues')).toHaveValue('Montant (Somme)');
    await expect(page.getByTestId('prop-ChartValues')).toHaveAttribute('readonly', '');
  } finally { await app.close(); }
});

test('A chart whose source table is missing: the pane shows the source error, no crash', async () => {
  test.setTimeout(120000);
  const chart = { kind: 'chart' as const, name: 'G1', left: 200, top: 200, width: 5000, height: 2800,
    props: { ChartSource: { kind: 'table', name: 'Supprimee' }, ChartAxis: ['Client'], ChartValues: [{ field: 'Montant', agg: 'sum' }] } };
  const { app, page } = await launchApp({ args: [await seed('chart-missing-source', [chart])], env: FR });
  try {
    await openDesign(page);
    await page.getByTestId('ctl-G1').click();
    await expect(page.getByTestId('chart-settings')).toBeVisible();
    await expect(page.getByTestId('chart-source-error')).toBeVisible();
    await expect(page.getByTestId('ctl-G1')).toBeVisible();
  } finally { await app.close(); }
});

test('Insert Modern Chart lists the new types after Combo (no Word Cloud); Doughnut arms the tool', async () => {
  test.setTimeout(120000);
  const { app, page } = await launchApp({ args: [await seed('chart-settings-f5-menu')], env: FR });
  try {
    await openDesign(page);
    await page.getByTestId('cmd-insertModernChart').click();
    const ids = await page.getByTestId('chart-type-popup').locator('[data-testid^="chart-type-"]').evaluateAll((els) => els.map((e) => e.getAttribute('data-testid')));
    expect(ids.slice(ids.indexOf('chart-type-combo'))).toEqual(['chart-type-combo', 'chart-type-doughnut', 'chart-type-arc', 'chart-type-funnel', 'chart-type-scatter', 'chart-type-bubble', 'chart-type-boxWhisker', 'chart-type-pareto', 'chart-type-waterfall']);
    await expect(page.getByTestId('chart-type-wordCloud')).toHaveCount(0);
    await page.getByTestId('chart-type-doughnut').click();
    await draw(page, page.locator('[data-section-body="1"]'));
    await expect(page.getByTestId('ctl-Graphique1')).toBeVisible();
    await expect(page.getByTestId('prop-ChartType')).toHaveValue('doughnut');
    await expect(page.getByTestId('prop-DoughnutHoleSize')).toBeVisible();
    await expect(page.getByTestId('prop-BubbleMaxSize')).toHaveCount(0);
    await expect(page.getByTestId('prop-AxisRange')).toHaveCount(0);   // anneau : pas de lignes d'axe
    await page.getByTestId('prop-ChartType').selectOption('columnClustered');
    await expect(page.getByTestId('prop-AxisRange')).toBeVisible();
    await expect(page.getByTestId('prop-DoughnutHoleSize')).toHaveCount(0);
  } finally { await app.close(); }
});

test('Chart Settings for a Scatter: no aggregate menu, per-type and axis hints', async () => {
  test.setTimeout(120000);
  const chart = { kind: 'chart' as const, name: 'G1', left: 200, top: 200, width: 5000, height: 2800,
    props: { ChartType: 'scatter', ChartSource: { kind: 'table', name: 'Commandes' }, ChartAxis: ['Montant'], ChartValues: [{ field: 'Montant', agg: 'sum' }] } };
  const { app, page } = await launchApp({ args: [await seed('chart-settings-f5-scatter', [chart])], env: FR });
  try {
    await openDesign(page);
    await page.getByTestId('ctl-G1').click();
    await expect(page.getByTestId('chart-type-hint')).toBeVisible();
    await expect(page.getByTestId('chart-axis-x-hint')).toBeVisible();
    await expect(page.getByTestId('chart-rows-hint')).toBeVisible();
    await expect(page.getByTestId('chart-value-Montant')).toBeChecked();
    await expect(page.getByTestId('chart-value-label-Montant')).toHaveCount(0);
    await page.getByTestId('chart-settings-tab-format').click();
    await expect(page.getByTestId('chart-series-trend')).toBeDisabled();
    await expect(page.getByTestId('chart-series-fill')).toBeEnabled();
    await expect(page.getByTestId('chart-series-labels')).toBeEnabled();
  } finally { await app.close(); }
});

test('Disabled chart controls point at their hint (aria-describedby); the waterfall hint follows fill/border, before the waterfall colours', async () => {
  test.setTimeout(120000);
  const chart = { kind: 'chart' as const, name: 'G1', left: 200, top: 200, width: 5000, height: 2800,
    props: { ChartType: 'waterfall', ChartSource: { kind: 'table', name: 'Commandes' }, ChartAxis: ['Client'], ChartValues: [{ field: 'Montant', agg: 'sum' }] } };
  const { app, page } = await launchApp({ args: [await seed('chart-settings-f5-describedby', [chart])], env: FR });
  try {
    await openDesign(page);
    await page.getByTestId('ctl-G1').click();
    const described = async (testId: string) => page.getByTestId(testId).evaluate((el) => {
      const id = el.getAttribute('aria-describedby');
      return id ? document.getElementById(id)?.textContent ?? '' : null;
    });
    expect(await described('chart-legend-none')).toBe(await page.getByTestId('chart-legend-ignored').textContent());
    await page.getByTestId('chart-settings-tab-format').click();
    for (const id of ['chart-series-trend', 'chart-series-fill', 'chart-series-labels']) {
      if (await page.getByTestId(id).isDisabled()) expect((await described(id))?.length, id).toBeGreaterThan(0);
    }
    expect((await described('chart-series-trend'))?.length).toBeGreaterThan(0);
    expect((await described('chart-series-fill'))?.length).toBeGreaterThan(0);
    // la ligne « sans effet » suit les lignes remplissage/bordure ; les couleurs de la cascade viennent après
    const order = await page.locator('[data-testid="chart-series-border"], .cs-hint, [data-testid="chart-WaterfallIncreaseColor"]').evaluateAll((els) => els.map((e) => e.getAttribute('data-testid') ?? e.className));
    expect(order.indexOf('chart-series-border')).toBeLessThan(order.indexOf('chart-WaterfallIncreaseColor'));
    const hintAt = await page.locator(`[id="${await page.getByTestId('chart-series-fill').getAttribute('aria-describedby')}"]`).evaluate((h) => {
      const prev = h.previousElementSibling; return prev?.querySelector('[data-testid="chart-series-border"]') != null;
    });
    expect(hintAt).toBe(true);
  } finally { await app.close(); }
});
