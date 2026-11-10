// Recette F5a : les cinq nouveaux types (anneau, arc, entonnoir, nuage de points, bulles) dessinés sur une fiche par Insérer un graphique
// moderne et l'onglet Données, deux copiés dans un état (aperçu, deux PDF identiques), anneau passé en arc et retour depuis la feuille de
// propriétés (propriétés stockées intactes), enregistrement, réouverture ; un nuage sur un champ texte montre le repère, sans erreur.
import { test, expect, type Locator, type Page } from '@playwright/test';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { inflateSync } from 'node:zlib';
import type { BasecraftApi } from '../../src/shared/api';
import { saveObject } from '../../src/main/db/objects';
import { createTable } from '../../src/main/db/schema';
import { insertRow } from '../../src/main/db/write-layer';
import type { DesignDoc } from '../../src/shared/design/model';
import { localeInfo } from '../../src/shared/locale-format';
import { f, t } from '../../src/shared/test-fixtures';
import { launchApp, seedBase, seedForm } from './helpers';

const FR = { BASECRAFT_REGION: 'fr-FR' };
const clients = t('Clients', [f('Nom', 'shortText')]);
const commandes = t('Commandes', [f('Client', 'shortText'), f('Quantite', 'number', { numberSize: 'double' }), f('Montant', 'number', { numberSize: 'double' }),
  f('Remise', 'number', { numberSize: 'double' }), f('Statut', 'shortText')]);
const ROWS: [string, number, number, number, string][] = [['Dupont', 1, 10, 1, 'Payée'], ['Durand', 2, 20, 2, 'Payée'], ['Dupont', 3, 5, 0, 'Ouverte'], ['Martin', 4, 7, 3, 'Ouverte']];
const fiche: DesignDoc = { formatVersion: '1.0', recordSource: null, props: { Width: 9072 }, sections: [
  { kind: 'formHeader', height: 0, props: { Visible: false }, controls: [] },
  { kind: 'detail', height: 6000, props: {}, controls: [] },
  { kind: 'formFooter', height: 0, props: { Visible: false }, controls: [] }] };
const etat: DesignDoc = { formatVersion: '1.0', recordSource: null, props: { Width: 9072 }, sections: [{ kind: 'reportHeader', height: 4536, props: {}, controls: [] }] };

/** [type, axe, valeurs] : un graphique par type, dans l'ordre. */
const PLAN = [['doughnut', 'Client', ['Montant']], ['arc', 'Client', ['Montant']], ['funnel', 'Statut', ['Montant']],
  ['scatter', 'Quantite', ['Montant']], ['bubble', 'Quantite', ['Montant', 'Remise']]] as const;

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
  const b = (await body.boundingBox())!, x = b.x + 8 + (i % 2) * 170, y = b.y + 10 + Math.floor(i / 2) * 130;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + 40, y + 40, { steps: 3 });
  await page.mouse.move(x + 160, y + 120, { steps: 3 });
  await page.mouse.up();
}
const marks = (page: Page, name: string) => cur(page).getByTestId(`ctl-${name}`).locator('svg path[fill^="#"]');
function streams(path: string): string[] {
  const raw = readFileSync(path), s = raw.toString('latin1'), out: string[] = [];
  for (const m of s.matchAll(/stream\r?\n/g)) {
    const from = m.index! + m[0].length, to = s.indexOf('endstream', from);
    try { out.push(inflateSync(raw.subarray(from, to)).toString('latin1')); } catch { /* flux non compressé */ }
  }
  return out;
}

test('F5a: five new chart types drawn on a form, two copied to a report, doughnut/arc switch, saved and reopened, scatter on text', async () => {
  test.setTimeout(300000);
  const base = await seedBase('recette-f5a', async (db) => {
    createTable(db, clients); createTable(db, commandes);
    for (const [Client, Quantite, Montant, Remise, Statut] of ROWS) await insertRow(db, commandes, { Client, Quantite, Montant, Remise, Statut }, localeInfo('en-US'));
    seedForm(db, 'Fiche', fiche);
    const r = saveObject(db, 'report', 'Etat', etat, null);
    if (!r.ok) throw new Error(r.reason);
  });
  const pdfDir = mkdtempSync(join(tmpdir(), 'basecraft-f5a-'));
  const [pdf1, pdf2] = [join(pdfDir, 'a.pdf'), join(pdfDir, 'b.pdf')];
  let a = await launchApp({ args: [base], env: { ...FR, BASECRAFT_E2E_PDF_PATH: pdf1 } });
  let saved: Record<string, Record<string, unknown>> = {};
  try {
    const page = a.page;
    // 1. Fiche : cinq graphiques, chacun avec sa source, son axe et ses valeurs
    await openDesign(page, 'form', 'Fiche');
    for (const [i, [type, axis, values]] of PLAN.entries()) {
      await page.getByTestId('cmd-insertModernChart').click();
      await page.getByTestId(`chart-type-${type}`).click();
      await draw(page, page.locator('[data-section-body="1"]'), i);
      await expect(page.getByTestId('chart-settings')).toBeVisible();
      await page.getByTestId('chart-source-kind-tables').check();
      await page.getByTestId('chart-source').selectOption('Commandes');
      await page.getByTestId(`chart-axis-${axis}`).check();
      for (const v of values) await page.getByTestId(`chart-value-${v}`).check();
      await expect(marks(page, `Graphique${i + 1}`).first()).toBeVisible();
    }
    const svg = (n: number) => cur(page).getByTestId(`ctl-Graphique${n}`).locator('svg').first();
    for (const n of [1, 2]) for (const name of ['Dupont', 'Durand', 'Martin']) await expect(svg(n)).toContainText(name);   // une part par client
    for (const name of ['Payée', 'Ouverte']) await expect(svg(3)).toContainText(name);   // un étage par statut
    await expect.poll(() => marks(page, 'Graphique4').count()).toBeGreaterThanOrEqual(4);   // un point par ligne (+ la pastille de légende)
    await expect.poll(() => marks(page, 'Graphique5').count()).toBeGreaterThanOrEqual(4);   // une bulle par ligne (+ la pastille de légende)
    await page.keyboard.press('Control+s');
    await expect.poll(async () => Object.entries(await charts(page, 'form', 'Fiche')).map(([k, p]) => `${k}:${String(p.ChartType)}`))
      .toEqual(PLAN.map(([ty], i) => `Graphique${i + 1}:${ty}`));
    saved = await charts(page, 'form', 'Fiche');
    expect(saved.Graphique4).toMatchObject({ ChartAxis: ['Quantite'], ChartValues: [{ field: 'Montant' }] });   // le mode lignes ignore l'agrégat (le menu est masqué)
    expect(saved.Graphique5).toMatchObject({ ChartValues: [{ field: 'Montant' }, { field: 'Remise' }] });

    // 2. deux copiés dans l'état : aperçu, deux PDF aux mêmes flux décompressés
    await cur(page).getByTestId('ctl-Graphique1').click();
    await cur(page).getByTestId('ctl-Graphique4').click({ modifiers: ['Shift'] });
    await page.keyboard.press('Control+c');
    await openDesign(page, 'report', 'Etat');
    await cur(page).getByTestId('section-reportHeader').click();
    await page.keyboard.press('Control+v');
    await expect(cur(page).locator('[data-testid^="ctl-Graphique"]')).toHaveCount(2);
    await page.keyboard.press('Control+s');
    await expect.poll(async () => Object.values(await charts(page, 'report', 'Etat')).map((p) => p.ChartType).sort()).toEqual(['doughnut', 'scatter']);
    await closeTab(page, 'report', 'Etat');
    await page.getByTestId('nav-item-report-Etat').dblclick();
    await expect(cur(page).getByTestId('preview-page-of')).toHaveText(/^Page 1 sur \d+$/);
    await expect(cur(page).locator('.bc-chart svg')).toHaveCount(2);
    for (const file of [pdf1, pdf2]) {
      await a.app.evaluate((_e, p) => { process.env.BASECRAFT_E2E_PDF_PATH = p; }, file);
      await page.getByTestId('cmd-exportPdf').click();
      await page.getByTestId('modal-btn-ok').click();
    }
    expect(streams(pdf1).length).toBeGreaterThan(0);
    expect(streams(pdf2)).toEqual(streams(pdf1));
    await closeTab(page, 'report', 'Etat');

    // 3. anneau -> arc -> anneau depuis la feuille de propriétés : les propriétés stockées ne bougent pas
    await cur(page).getByTestId('ctl-Graphique1').click();
    await page.getByTestId('sheet-tab-format').click();
    await page.getByTestId('prop-ChartType').selectOption('arc');
    await page.keyboard.press('Control+s');
    await expect.poll(async () => (await charts(page, 'form', 'Fiche')).Graphique1?.ChartType).toBe('arc');
    await page.getByTestId('prop-ChartType').selectOption('doughnut');
    await page.keyboard.press('Control+s');
    await expect.poll(async () => (await charts(page, 'form', 'Fiche')).Graphique1).toEqual(saved.Graphique1);

    // 4. un nuage sur un champ texte : le repère et l'aide du type, aucune erreur
    await cur(page).getByTestId('ctl-Graphique4').click();
    await page.getByTestId('chart-axis-Quantite').uncheck();
    await page.getByTestId('chart-axis-Statut').check();
    await expect(page.getByTestId('chart-type-hint')).toBeVisible();
    await expect(page.getByRole('alert')).toHaveCount(0);
    await page.keyboard.press('Control+s');
    await expect.poll(async () => (await charts(page, 'form', 'Fiche')).Graphique4?.ChartAxis).toEqual(['Statut']);
  } finally { await a.app.close(); }

  // 5. fermeture, réouverture : tout est intact
  a = await launchApp({ args: [base], env: FR });
  try {
    const page = a.page;
    const now = await charts(page, 'form', 'Fiche');
    expect(Object.keys(now)).toEqual(Object.keys(saved));
    for (const k of Object.keys(saved)) if (k !== 'Graphique4') expect(now[k], k).toEqual(saved[k]);
    await page.getByTestId('nav-item-form-Fiche').dblclick();
    await expect(page.getByTestId('form-run')).toBeVisible();
    const run = (n: string) => page.getByTestId(`form-ctl-${n}`).filter({ visible: true });
    for (const name of ['Dupont', 'Durand', 'Martin']) await expect(run('Graphique1').locator('svg').first()).toContainText(name);
    await expect.poll(() => run('Graphique5').locator('svg path[fill^="#"]').count()).toBeGreaterThanOrEqual(4);
    const txt = run('Graphique4').getByTestId('chart-empty');
    await expect(txt).toBeVisible();
    await expect(txt).not.toContainText('Aucune donnée');
    await expect(page.getByRole('alert')).toHaveCount(0);
    await expect(page.getByTestId('modal')).toHaveCount(0);
  } finally { await a.app.close(); }
});
