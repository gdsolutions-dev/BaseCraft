// Recette F4a : un graphique en colonnes sur une fiche (Insérer un graphique moderne, source, axe par mois, légende, valeur), copié dans
// un état (aperçu, deux PDF identiques), passé en secteurs depuis la feuille de propriétés puis son axe changé depuis le volet,
// enregistré, rouvert ; un nom de champ hostile écrit dans le document donne le repère, jamais une erreur ni une écriture.
import { test, expect, type Locator, type Page } from '@playwright/test';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
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
import { inFile, launchApp, seedBase, seedForm } from './helpers';

const FR = { BASECRAFT_REGION: 'fr-FR' };
const clients = t('Clients', [f('Nom', 'shortText')]);
const commandes = t('Commandes', [f('Client', 'shortText'), f('Montant', 'number', { numberSize: 'double' }), f('Jour', 'dateTime')]);
const ROWS: [string, number, string][] = [['Dupont', 10, '2026-01-05'], ['Durand', 20, '2026-01-20'], ['Dupont', 5, '2026-02-03'], ['Martin', 7, '2026-02-18'], ['Durand', 12, '2026-03-09']];
const fiche: DesignDoc = { formatVersion: '1.0', recordSource: null, props: { Width: 9072 }, sections: [
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
const svgOf = (page: Page) => cur(page).getByTestId('ctl-Graphique1').locator('svg').first();
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
const sum = (p: string) => inFile<{ n: number; s: number }>(p, 'SELECT count(*) n, sum(Montant) s FROM Commandes')[0];

test('F4a: column chart on a form, copied to a report, pie from the sheet, axis from the pane, saved and reopened, hostile field', async () => {
  test.setTimeout(300000);
  const base = await seedBase('recette-f4a', async (db) => {
    createTable(db, clients); createTable(db, commandes);
    for (const [Client, Montant, Jour] of ROWS) await insertRow(db, commandes, { Client, Montant, Jour }, localeInfo('en-US'));
    seedForm(db, 'Fiche', fiche);
    const r = saveObject(db, 'report', 'Etat', etat, null);
    if (!r.ok) throw new Error(r.reason);
  });
  const pdfDir = mkdtempSync(join(tmpdir(), 'basecraft-f4a-'));
  const [pdf1, pdf2] = [join(pdfDir, 'a.pdf'), join(pdfDir, 'b.pdf')];
  const before = sum(base);
  let a = await launchApp({ args: [base], env: { ...FR, BASECRAFT_E2E_PDF_PATH: pdf1 } });
  try {
    const page = a.page;
    // 1. Fiche : colonnes, source Commandes, axe Jour par mois, légende Client, valeur Montant (Somme)
    await openDesign(page, 'form', 'Fiche');
    await page.getByTestId('cmd-insertModernChart').click();
    await page.getByTestId('chart-family-column').click();
    await page.getByTestId('chart-type-columnClustered').click();
    await draw(page, page.locator('[data-section-body="1"]'));
    await expect(page.getByTestId('chart-settings')).toBeVisible();
    await page.getByTestId('chart-source-kind-tables').check();
    await page.getByTestId('chart-source').selectOption('Commandes');
    await page.getByTestId('chart-axis-Jour').check();
    await page.getByTestId('chart-date-group').selectOption('month');
    await page.getByTestId('chart-legend-Client').check();
    await page.getByTestId('chart-value-Montant').check();
    const svg = svgOf(page);
    await expect(svg).toContainText('2026-01');
    await expect(svg).toContainText('2026-03');
    for (const name of ['Dupont', 'Durand', 'Martin']) await expect(svg).toContainText(name);   // une série par client
    await page.keyboard.press('Control+s');
    await expect.poll(() => chartProps(page, 'form', 'Fiche')).toMatchObject({ ChartType: 'columnClustered', ChartAxis: ['Jour'], ChartDateGroup: 'month', ChartLegend: 'Client',
      ChartValues: [{ field: 'Montant', agg: 'sum' }] });

    // 2. copier le contrôle dans l'état : aperçu, puis deux PDF aux mêmes octets décompressés
    await cur(page).getByTestId('ctl-Graphique1').click();
    await page.keyboard.press('Control+c');
    await openDesign(page, 'report', 'Etat');
    await cur(page).getByTestId('section-reportHeader').click();
    await page.keyboard.press('Control+v');
    await expect(cur(page).getByTestId('ctl-Graphique1')).toBeVisible();
    await page.keyboard.press('Control+s');
    await expect.poll(() => chartProps(page, 'report', 'Etat')).toMatchObject({ ChartAxis: ['Jour'], ChartLegend: 'Client', ChartSource: { kind: 'table', name: 'Commandes' } });
    await closeTab(page, 'report', 'Etat');
    await page.getByTestId('nav-item-report-Etat').dblclick();
    await expect(cur(page).getByTestId('preview-page-of')).toHaveText(/^Page 1 sur \d+$/);
    const pv = cur(page).locator('.bc-chart svg');
    await expect(pv).toBeVisible();
    await expect(pv).toContainText('Dupont');
    for (const file of [pdf1, pdf2]) {
      await a.app.evaluate((_e, p) => { process.env.BASECRAFT_E2E_PDF_PATH = p; }, file);
      await page.getByTestId('cmd-exportPdf').click();
      await page.getByTestId('modal-btn-ok').click();
    }
    expect(streams(pdf1).length).toBeGreaterThan(0);
    expect(streams(pdf2)).toEqual(streams(pdf1));
    for (const name of ['Dupont', 'Durand', 'Martin']) expect(pdfWords(pdf1)).toContain(name);   // le graphique est bien dans le PDF (seul contenu de l'état)
    await closeTab(page, 'report', 'Etat');

    // 3. Fiche : Secteurs depuis la feuille de propriétés (le dessin change), puis l'axe depuis l'onglet Données
    await cur(page).getByTestId('ctl-Graphique1').click();
    const columns = await svgOf(page).innerHTML();
    await page.getByTestId('sheet-tab-format').click();
    await page.getByTestId('prop-ChartType').selectOption('pie');
    await expect.poll(() => svgOf(page).innerHTML()).not.toBe(columns);
    await page.getByTestId('chart-legend-none').check();
    await page.getByTestId('chart-axis-Jour').uncheck();
    await page.getByTestId('chart-axis-Client').check();
    await expect(svgOf(page)).toContainText('Dupont');
    await expect(svgOf(page)).not.toContainText('2026-01');
    await page.keyboard.press('Control+s');
    await expect.poll(() => chartProps(page, 'form', 'Fiche')).toMatchObject({ ChartType: 'pie', ChartAxis: ['Client'], ChartLegend: '' });
  } finally { await a.app.close(); }

  // 4. fermeture, réouverture : le graphique est intact
  a = await launchApp({ args: [base], env: FR });
  try {
    const page = a.page;
    await expect.poll(() => chartProps(page, 'form', 'Fiche')).toMatchObject({ ChartType: 'pie', ChartAxis: ['Client'], ChartValues: [{ field: 'Montant', agg: 'sum' }] });
    await page.getByTestId('nav-item-form-Fiche').dblclick();
    await expect(page.getByTestId('form-run')).toBeVisible();
    await expect(page.getByTestId('form-ctl-Graphique1').filter({ visible: true }).locator('svg').first()).toContainText('Dupont');
    await closeTab(page, 'form', 'Fiche');

    // 5. un nom de champ hostile écrit dans le document : le repère, aucune erreur, aucune ligne changée
    const hostile = 'x"><script>alert(1)</script>\'; DROP TABLE Commandes; --';
    await page.evaluate(async (h) => {
      const api = (window as unknown as { basecraft: BasecraftApi }).basecraft;
      const { definition } = await api.objects.get('form', 'Fiche');
      const d = definition as DesignDoc;
      d.sections.flatMap((s) => s.controls).find((c) => c.kind === 'chart')!.props.ChartAxis = [h];
      await api.objects.save('form', 'Fiche', d, 'Fiche');
    }, hostile);
    await page.getByTestId('nav-item-form-Fiche').dblclick();
    await expect(page.getByTestId('form-run')).toBeVisible();
    const box = page.getByTestId('form-ctl-Graphique1').filter({ visible: true });
    await expect(box.getByTestId('chart-empty')).toBeVisible();
    await expect(box.locator('svg')).toHaveCount(0);
    await expect(page.getByRole('alert')).toHaveCount(0);
    await expect(page.getByTestId('modal')).toHaveCount(0);
  } finally { await a.app.close(); }
  expect(sum(base)).toEqual(before);

  // le CLI refuse le même nom de champ, en nommant le contrôle
  const dir = mkdtempSync(join(tmpdir(), 'basecraft-f4a-cli-')), cli = join(dir, 'c.basecraft'), spec = join(dir, 's.json');
  const bad: DesignDoc = { ...fiche, sections: [{ kind: 'detail', height: 4536, props: {}, controls: [
    { kind: 'chart', name: 'Graph', left: 200, top: 100, width: 5000, height: 2400, props: { ChartSource: { kind: 'table', name: 'Commandes' }, ChartAxis: ['x"><script>'], ChartValues: [{ field: 'Montant', agg: 'sum' }] } }] }] };
  writeFileSync(spec, JSON.stringify([{ op: 'table.create', name: 'Commandes', fields: [{ name: 'Montant', type: 'currency' }] }, { op: 'form.create', name: 'F', layout: 'doc', doc: bad }]));
  const run = (...args: string[]) => spawnSync(process.execPath, ['out/cli/basecraft-cli.mjs', ...args], { encoding: 'utf8' });
  expect(run('new', cli).status).toBe(0);
  const r = run('script', spec, cli);
  expect(r.status).toBe(1);
  expect(r.stdout + r.stderr).toContain('Graph');
});
