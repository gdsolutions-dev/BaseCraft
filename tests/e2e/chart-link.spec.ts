// Graphique lié au formulaire parent (F4, tâche 16) : champs père/fils, valeur avec apostrophe, repère sans commande,
// graphique redessiné après l'enregistrement d'un enregistrement.
import { test, expect, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createTable } from '../../src/main/db/schema';
import { insertRow } from '../../src/main/db/write-layer';
import type { ControlDef, DesignDoc } from '../../src/shared/design/model';
import { DEFAULT_THEME } from '../../src/shared/design/theme';
import { localeInfo } from '../../src/shared/locale-format';
import { f, t } from '../../src/shared/test-fixtures';
import { launchApp, seedBase, seedForm } from './helpers';

const fr = JSON.parse(readFileSync(join(__dirname, '../../src/shared/i18n/fr.json'), 'utf8'));
const FR = { BASECRAFT_REGION: 'fr-FR' };
const region = localeInfo('fr-FR');
const clients = t('Clients', [f('Nom', 'shortText')]);
const commandes = t('Commandes', [f('Client', 'shortText'), f('Mois', 'shortText'), f('Montant', 'number', { numberSize: 'double' })]);
const ctl = (kind: ControlDef['kind'], name: string, top: number, props: Record<string, unknown>, height = 340): ControlDef => ({ kind, name, left: 200, top, width: 5000, height, props });
const formOf = (table: string, controls: ControlDef[]): DesignDoc => ({
  formatVersion: '1.0', recordSource: { kind: 'table', name: table }, props: { Width: 5500 },
  sections: [{ kind: 'detail', height: 3600, props: {}, controls }],
});
const values = [{ field: 'Montant', agg: 'sum' }];
const seed = (name: string) => seedBase(name, async (db) => {
  createTable(db, clients); createTable(db, commandes);
  for (const Nom of ['Dupont', 'Martin', "O'Brien", 'Vide']) await insertRow(db, clients, { Nom }, region);
  for (const [Client, Mois, Montant] of [['Dupont', '2026-01', 10], ['Dupont', '2026-02', 20], ['Martin', '2026-03', 5], ["O'Brien", '2026-04', 8]] as const) await insertRow(db, commandes, { Client, Mois, Montant }, region);
  seedForm(db, 'FicheClient', formOf('Clients', [ctl('textBox', 'Nom', 100, { ControlSource: 'Nom' }),
    ctl('chart', 'Graph', 600, { HasLegend: false, ChartAxis: ['Mois'], ChartValues: values, ChartSource: { kind: 'table', name: 'Commandes' }, LinkMasterFields: 'Nom', LinkChildFields: 'Client' }, 2800)]));
  seedForm(db, 'Saisie', formOf('Commandes', [ctl('textBox', 'Client', 100, { ControlSource: 'Client' }), ctl('textBox', 'Montant', 500, { ControlSource: 'Montant' }),
    ctl('chart', 'Graph', 1000, { HasLegend: false, ChartAxis: ['Client'], ChartValues: values }, 2400)]));
});
const shown = (page: Page, id: string) => page.getByTestId(id).filter({ visible: true });
const bars = (page: Page) => shown(page, 'form-ctl-Graph').locator('svg').first().locator(`path[fill="${DEFAULT_THEME.colors.light.accent1}" i]`);
const next = (page: Page) => shown(page, 'form-run').getByRole('button', { name: fr.datasheet.nav.next });

test('the chart follows the current client: its months only, a quote in the value, a placeholder without orders', async () => {
  const { app, page } = await launchApp({ args: [await seed('chart-link')], env: FR });
  try {
    await page.getByTestId('nav-item-form-FicheClient').dblclick();
    await expect(shown(page, 'form-run')).toBeVisible();
    await expect(bars(page)).toHaveCount(2);   // Dupont : janvier, février
    await next(page).click();
    await expect(bars(page)).toHaveCount(1);   // Martin
    await next(page).click();
    await expect(shown(page, 'nav-record-input')).toHaveValue('3');
    await expect(bars(page)).toHaveCount(1);   // O'Brien : l'apostrophe reste une valeur
    await next(page).click();
    await expect(shown(page, 'form-ctl-Graph').getByTestId('chart-empty')).toBeVisible();
  } finally { await app.close(); }
});

test('the chart is drawn again once the record is saved', async () => {
  const { app, page } = await launchApp({ args: [await seed('chart-save')], env: FR });
  try {
    await page.getByTestId('nav-item-form-Saisie').dblclick();
    await expect(bars(page)).toHaveCount(3);
    const before = await bars(page).evaluateAll((els) => els.map((e) => e.getAttribute('d')).join('|'));
    await shown(page, 'form-ctl-Montant').fill('300');
    await next(page).click();   // saves the record
    await expect.poll(() => bars(page).evaluateAll((els) => els.map((e) => e.getAttribute('d')).join('|'))).not.toBe(before);
    await expect(bars(page)).toHaveCount(3);
  } finally { await app.close(); }
});
