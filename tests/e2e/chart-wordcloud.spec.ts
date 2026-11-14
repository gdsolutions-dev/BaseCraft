// Nuage de mots (C3) : les clients de Commandes s'écrivent en texte SVG dans la vue Formulaire et en vue Création.
import { test, expect } from '@playwright/test';
import { createTable } from '../../src/main/db/schema';
import { insertRow } from '../../src/main/db/write-layer';
import type { DesignDoc } from '../../src/shared/design/model';
import { localeInfo } from '../../src/shared/locale-format';
import { f, t } from '../../src/shared/test-fixtures';
import { launchApp, pickView, seedBase, seedForm } from './helpers';

const FR = { BASECRAFT_REGION: 'fr-FR' };
const region = localeInfo('fr-FR');
const table = t('Commandes', [f('Client', 'shortText'), f('Montant', 'number', { numberSize: 'double' })]);
const doc: DesignDoc = {
  formatVersion: '1.0', recordSource: { kind: 'table', name: 'Commandes' }, props: { Width: 5500 },
  sections: [{ kind: 'detail', height: 3000, props: {}, controls: [{ kind: 'chart', name: 'Graph', left: 200, top: 100, width: 5000, height: 2600,
    props: { ChartType: 'wordCloud', ChartAxis: ['Client'], ChartValues: [{ field: 'Montant', agg: 'sum' }] } }] }],
};

test('word cloud: the clients are drawn as words in the form view and in the design view', async () => {
  const path = await seedBase('chart-wordcloud', async (db) => {
    createTable(db, table);
    for (const [Client, Montant] of [['Dupont', 40], ['Durand', 20], ['Dupont', 5], ['Martin', 7]] as const) await insertRow(db, table, { Client, Montant }, region);
    seedForm(db, 'FicheCmd', doc);
  });
  const { app, page } = await launchApp({ args: [path], env: FR });
  try {
    await page.getByTestId('nav-item-form-FicheCmd').dblclick();
    await expect(page.getByTestId('form-run')).toBeVisible();
    const svg = page.getByTestId('form-ctl-Graph').filter({ visible: true }).locator('svg').first();
    for (const w of ['Dupont', 'Durand', 'Martin']) await expect(svg).toContainText(w);
    await pickView(page, 'viewDesign');
    await expect(page.getByTestId('design-chart-svg').filter({ visible: true }).first()).toContainText('Dupont');
  } finally { await app.close(); }
});
