// Mode Page des états (L3), de bout en bout : ouvert par le ruban, la barre d'état et le menu du volet ; l'état en un seul flux
// (une seule page) avec ses groupes et ses totaux calculés par le moteur ; un contrôle du Détail cliqué : un anneau sur chaque
// enregistrement, la Feuille de propriétés le montre ; Tabulaire puis la poignée de largeur (une seule étape d'annulation) ; ni
// boîte à outils ni barres de hauteur de section ni onglet Événement, ni volet Regrouper ni Liste des champs ; Création <-> Page
// sans question ; vers l'Aperçu, la question d'enregistrement, et « Fermer » ramène au mode Page ; AllowLayoutView = false ; une
// source vide, une source de plus de 100 lignes, une source paramétrée ; les noms comparés sans la casse.
import { test, expect, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { saveObject } from '../../src/main/db/objects';
import { createTable } from '../../src/main/db/schema';
import type { DesignDoc } from '../../src/shared/design/model';
import type { MacroItem } from '../../src/shared/macro/model';
import { FACTURES_FIELDS, FACTURES_REPORT } from '../../src/shared/report/fixtures/factures';
import { checkView, launchApp, pickView, seedBase, seedReportsE2E } from './helpers';

const fr = JSON.parse(readFileSync(join(__dirname, '../../src/shared/i18n/fr.json'), 'utf8'));
const FR = { BASECRAFT_REGION: 'fr-FR' };
const REPORT = 'Factures par client';
const P = 'Nom du client :';
const report = (props: Record<string, unknown>, recordSource: DesignDoc['recordSource'] = FACTURES_REPORT.recordSource): DesignDoc =>
  ({ ...FACTURES_REPORT, recordSource, props: { ...FACTURES_REPORT.props, ...props } });
const msg = (Message: string) => ({ embedded: { formatVersion: '1.0' as const, items: [{ k: 'action', action: 'MessageBox', args: { Message } } as MacroItem] } });
/** Sur ouverture et Sur fermeture affichent un message ; le Détail se masque sur formatage (comme report-events.spec) : jamais en mode Page. */
const EVENTS: DesignDoc = {
  ...report({ OnOpen: msg('Ouverture'), OnClose: msg('Fermeture') }),
  sections: FACTURES_REPORT.sections.map((x) => x.kind !== 'detail' ? x : { ...x, props: { ...x.props, OnFormat: { embedded: { formatVersion: '1.0' as const, items: [
    { k: 'action', action: 'SetProperty', args: { ControlName: 'Detail', Property: 'visible', Value: 'Non' } } as MacroItem] } } } }),
};

/** Un graphique (Client en abscisse, somme des montants) dans l'en-tête : le mode Page le dessine avec ses données. */
const CHART: DesignDoc = { formatVersion: '1.0', recordSource: { kind: 'table', name: 'Factures' }, props: { Width: 8000 },
  sections: [{ kind: 'reportHeader', height: 3600, props: {}, controls: [
    { kind: 'chart', name: 'Graph', left: 200, top: 100, width: 7000, height: 3400, props: { HasLegend: false, ChartAxis: ['Client'], ChartValues: [{ field: 'Montant', agg: 'sum' }] } }] }] };

const base = () => seedBase('etats-mode-page', (db) => {
  seedReportsE2E(db);   // Factures (75 lignes, 3 clients) et « Factures par client » (regroupé sur Client, totaux)
  const table = (name: string) => createTable(db, { name, fields: FACTURES_FIELDS.map((f) => ({ name: f.name, props: f.props })) });
  table('Vide');
  table('Longue');
  const insert = db.prepare('INSERT INTO "Longue" ("Client", "Montant") VALUES (?, 1)');
  db.exec('BEGIN');
  for (let i = 0; i < 150; i++) insert.run(`Client ${i % 3}`);
  db.exec('COMMIT');
  const q = saveObject(db, 'query', 'Factures du client', { formatVersion: '1.0', sql: `SELECT * FROM Factures WHERE Client = [${P}];` }, null);
  if (!q.ok) throw new Error(q.reason);
  for (const [name, doc] of [['Interdit', report({ AllowLayoutView: false })], ['Sans données', report({}, { kind: 'table', name: 'Vide' })],
    ['Longue', report({}, { kind: 'table', name: 'Longue' })], ['Paramétré', report({}, { kind: 'query', name: 'Factures du client' })],
    ['Événements', EVENTS], ['Avec graphique', CHART]] as const) {
    const r = saveObject(db, 'report', name, doc, null);
    if (!r.ok) throw new Error(r.reason);
  }
});

const cur = (page: Page) => page.locator('.doc:not([hidden])');
const flow = (page: Page) => cur(page).getByTestId('layout-flow');
const bands = (page: Page, section: string) => flow(page).locator(`.bc-band[data-section="${section}"]`);
/** Les occurrences d'un contrôle dans le flux (chaque élément porte le nom de son contrôle). */
const items = (page: Page, name: string) => flow(page).locator(`[data-name="${name}"]`);
const rings = (page: Page, name: string) => cur(page).locator(`[data-testid="layout-ring-${name}"]`);
const status = (page: Page, v: string) => page.getByTestId(`status-view-${v}`);
const tab = (page: Page, name: string) => page.getByTestId(`doc-tab-report-${name}`);
/** Ni l'ouverture ni la sélection ne modifient l'état (pas de marque de modification). */
const clean = (page: Page, name: string) => expect(tab(page, name)).not.toContainText('•');
/** La dernière modification mise en page (le flux montré est celui de la définition courante). */
const settled = (page: Page) => expect(cur(page).getByTestId('report-layout-canvas')).toHaveAttribute('aria-busy', 'false');
const widths = (page: Page, name: string) => items(page, name).evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().width)));
/** La première occurrence, lue d'un coup dans la page (le flux remis en page remplace ses éléments). */
const first = (page: Page, name: string) => items(page, name).first().evaluate((e) => e.getBoundingClientRect().toJSON() as DOMRect);
const left = async (page: Page, name: string) => Math.round((await first(page, name)).x);
const width = async (page: Page, name: string) => Math.round((await first(page, name)).width);

async function openLayout(page: Page, name: string) {
  await page.getByTestId(`nav-item-report-${name}`).click({ button: 'right' });
  await page.getByTestId('nav-menu-layout').click();
  await expect(flow(page)).toBeVisible();
  await clean(page, name);
}
/** Boîte à outils dans les deux modes (L3b) ; ni barres de hauteur de section, ni onglet Événement, ni volet Regrouper, ni Liste des champs
 *  en mode Page ; barres et onglet Événement en mode Création. */
async function designerTools(page: Page, shown: boolean) {
  const n = shown ? 1 : 0;
  await expect(cur(page).getByTestId('sheet-tab-format')).toHaveCount(1);
  await expect(cur(page).getByTestId('toolbox')).toHaveCount(1);
  await expect(cur(page).getByTestId('sheet-tab-event')).toHaveCount(n);
  if (shown) await expect(cur(page).locator('[data-testid^="section-resize-"]')).not.toHaveCount(0);
  else {
    await expect(cur(page).locator('[data-testid^="section-resize-"]')).toHaveCount(0);
    await expect(cur(page).getByTestId('grouping-pane')).toHaveCount(0);
    await expect(cur(page).getByTestId('field-list')).toHaveCount(0);
  }
}

test('Report Layout view: one flow with groups and totals, rings on every record, Tabular and the width handle, Design <-> Layout, save to Print Preview and back', async () => {
  test.setTimeout(150000);
  const { app, page } = await launchApp({ args: [base()], env: FR });
  const modal = page.getByTestId('modal');
  try {
    // ouvert par le ruban, depuis l'Aperçu avant impression
    await page.getByTestId('nav-group-report').getByTestId(`nav-item-report-${REPORT}`).dblclick();
    await expect(cur(page).getByTestId('preview-page-of')).toHaveText('Page 1 sur 3');
    await page.getByTestId('ribbon-tab-home').click();
    await pickView(page, 'viewLayout');
    await expect(flow(page)).toBeVisible();
    await expect(status(page, 'layout')).toHaveAttribute('aria-pressed', 'true');
    await checkView(page, 'viewLayout', (v) => expect(v).toHaveAttribute('aria-checked', 'true'));
    await expect(modal).toHaveCount(0);
    await clean(page, REPORT);

    // un seul flux : une page, les 75 lignes, un en-tête et un pied par client, les totaux du moteur, un seul pied de page
    await expect(flow(page).locator('.bc-page')).toHaveCount(1);
    await expect(bands(page, 'detail')).toHaveCount(75);
    await expect(bands(page, 'groupHeader')).toHaveCount(3);
    await expect(bands(page, 'groupHeader').first()).toHaveText('Dupont');
    await expect(bands(page, 'groupFooter').first()).toContainText('Total Dupont');
    await expect(items(page, 'Somme_Client').first()).toHaveText(/^6,00\s€$/);   // 60 × 0,10
    await expect(items(page, 'Somme_Totale')).toHaveText(/^20\s126,90\s€$/);     // 6,00 + 20 120,90 (Durand 121, Martin 19 999,90)
    await expect(bands(page, 'pageFooter')).toHaveCount(1);
    await expect(cur(page).getByTestId('layout-notice')).toHaveCount(0);
    await designerTools(page, false);

    // un contrôle du Détail cliqué : un anneau sur chaque enregistrement, la Feuille de propriétés le montre ; rien n'est modifié
    await items(page, 'Montant').nth(3).click();
    await expect(rings(page, 'Montant')).toHaveCount(75);
    await expect(cur(page).getByTestId('prop-Name')).toHaveValue('Montant');
    await expect(cur(page).getByTestId('layout-width-handle')).toBeVisible();
    await clean(page, REPORT);

    // Tabulaire (commande Organiser) sur les trois colonnes du Détail : une modification, le flux remis en page
    await items(page, 'Date').first().click();
    await items(page, 'Libelle').first().click({ modifiers: ['Control'] });
    await items(page, 'Montant').first().click({ modifiers: ['Control'] });
    await expect(rings(page, 'Libelle')).toHaveCount(75);
    await page.getByTestId('ribbon-tab-arrange').click();
    await page.getByTestId('cmd-tabular').click();
    await expect(tab(page, REPORT)).toContainText('•');
    await settled(page);
    // Sélectionner la disposition : les trois membres, chacun cerclé sur chaque enregistrement
    await items(page, 'Date').first().click();
    await page.getByTestId('cmd-selectLayout').click();
    for (const n of ['Date', 'Libelle', 'Montant']) await expect(rings(page, n), n).toHaveCount(75);

    // la poignée de largeur de Date : toutes les lignes suivent, les colonnes voisines se décalent ; une seule étape d'annulation
    await items(page, 'Date').first().click();
    await expect(rings(page, 'Libelle')).toHaveCount(0);
    await settled(page);
    const w = await width(page, 'Date'), lib = await left(page, 'Libelle'), mnt = await left(page, 'Montant');
    const h = (await cur(page).getByTestId('layout-width-handle').boundingBox())!;
    await page.mouse.move(h.x + h.width / 2, h.y + h.height / 2);
    await page.mouse.down();
    await page.mouse.move(h.x + 40, h.y + h.height / 2, { steps: 4 });
    await page.mouse.move(h.x + 80, h.y + h.height / 2, { steps: 4 });
    await page.mouse.up();
    await expect.poll(() => width(page, 'Date')).toBeGreaterThan(w + 40);
    await settled(page);
    const wide = await width(page, 'Date');
    expect(new Set(await widths(page, 'Date'))).toEqual(new Set([wide]));
    expect(await widths(page, 'Date')).toHaveLength(75);
    await expect.poll(() => left(page, 'Libelle')).toBeGreaterThan(lib + 40);
    expect(await left(page, 'Montant')).toBeGreaterThan(mnt + 40);
    await expect(rings(page, 'Date')).toHaveCount(75);
    await page.getByTestId('ribbon-tab-home').click();
    await page.keyboard.press('Control+z');
    await expect.poll(() => width(page, 'Date')).toBe(w);
    await settled(page);
    expect(new Set(await widths(page, 'Date'))).toEqual(new Set([w]));
    await expect.poll(() => left(page, 'Libelle')).toBe(lib);
    await page.keyboard.press('Control+y');
    await expect.poll(() => width(page, 'Date')).toBe(wide);

    // vers Création (barre d'état) : aucune question, la modification et l'annulation restent ; les outils de nouveau là
    await status(page, 'design').click();
    await expect(status(page, 'design')).toHaveAttribute('aria-pressed', 'true');
    await expect(modal).toHaveCount(0);
    await designerTools(page, true);
    const ctl = cur(page).getByTestId('ctl-Date');
    const designWide = (await ctl.boundingBox())!.width;
    await cur(page).getByTestId('design-canvas').focus();
    await page.keyboard.press('Control+z');
    await expect.poll(async () => (await ctl.boundingBox())!.width).toBeLessThan(designWide - 20);
    await page.keyboard.press('Control+y');
    await expect.poll(async () => (await ctl.boundingBox())!.width).toBe(designWide);
    // le volet Regrouper, trier et total ouvert en Création : masqué en mode Page, son bouton n'y est pas enfoncé
    await page.getByTestId('ribbon-tab-reportDesign').click();
    await page.getByTestId('cmd-groupSort').click();
    await expect(cur(page).getByTestId('grouping-pane')).toBeVisible();

    // de retour en mode Page par le menu du volet : aucune question, la largeur gardée, l'état toujours modifié
    await page.getByTestId(`nav-item-report-${REPORT}`).click({ button: 'right' });
    await page.getByTestId('nav-menu-layout').click();
    await expect(flow(page)).toBeVisible();
    await expect(modal).toHaveCount(0);
    await expect(tab(page, REPORT)).toContainText('•');
    await expect.poll(() => width(page, 'Date')).toBe(wide);
    await designerTools(page, false);
    await expect(page.getByTestId('cmd-groupSort')).toHaveAttribute('aria-pressed', 'false');

    // enregistré (Ctrl+S), puis vers l'Aperçu ; « Fermer » ramène au mode Page (sans enregistrer, l'Aperçu s'affiche aussi : de6f3a8)
    await page.keyboard.press('Control+s');
    await expect(tab(page, REPORT)).not.toContainText('•');
    await pickView(page, 'viewPrintPreview');
    await expect(cur(page).getByTestId('report-preview')).toBeVisible();
    await expect(tab(page, REPORT)).not.toContainText('•');
    await page.getByTestId('cmd-closePreview').click();
    await expect(flow(page)).toBeVisible();
    await expect(status(page, 'layout')).toHaveAttribute('aria-pressed', 'true');
    await expect.poll(() => width(page, 'Date')).toBe(wide);
    await clean(page, REPORT);
  } finally {
    await app.close();
  }
});

test('Report Layout view: names compared without case; AllowLayoutView = false; an empty source; more than 100 rows', async () => {
  test.setTimeout(120000);
  const { app, page } = await launchApp({ args: [base()], env: FR });
  try {
    // ouvert par la barre d'état, depuis le mode Création
    await page.getByTestId(`nav-item-report-${REPORT}`).click({ button: 'right' });
    await page.getByTestId('nav-menu-design').click();
    await expect(cur(page).getByTestId('designer')).toBeVisible();
    await status(page, 'layout').click();
    await expect(flow(page)).toBeVisible();
    await clean(page, REPORT);

    // Montant renommé MONTANT puis l'annulation : la sélection garde « MONTANT », le flux « Montant » ; les anneaux restent
    await cur(page).getByTestId('sheet-object').selectOption('c:Montant');
    await expect(rings(page, 'Montant')).toHaveCount(75);
    await cur(page).getByTestId('prop-Name').fill('MONTANT');
    await cur(page).getByTestId('prop-Name').press('Enter');
    await expect(items(page, 'MONTANT')).toHaveCount(75);
    await page.getByTestId('ribbon-tab-home').click();
    await page.keyboard.press('Control+z');
    await expect(items(page, 'Montant')).toHaveCount(75);
    await expect(cur(page).getByTestId('prop-Name')).toHaveValue('Montant');
    await expect(rings(page, 'MONTANT')).toHaveCount(75);
    await expect(cur(page).getByTestId('layout-width-handle')).toBeVisible();

    // AllowLayoutView = false : le bouton d'état éteint, dans l'Aperçu comme en mode Création ; le menu du volet n'ouvre rien
    await page.getByTestId('nav-group-report').getByTestId('nav-item-report-Interdit').dblclick();
    await expect(cur(page).getByTestId('report-preview')).toBeVisible();
    await expect(status(page, 'layout')).toBeDisabled();
    await status(page, 'design').click();
    await expect(cur(page).getByTestId('designer')).toBeVisible();
    await expect(status(page, 'layout')).toBeDisabled();
    await page.getByTestId('ribbon-tab-home').click();
    await checkView(page, 'viewLayout', (v) => expect(v).toBeDisabled());
    await page.getByTestId('nav-item-report-Interdit').click({ button: 'right' });
    await page.getByTestId('nav-menu-layout').click();
    await expect(page.getByTestId('nav-menu')).toHaveCount(0);
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));   // l'élément du menu a fini
    await expect(status(page, 'design')).toHaveAttribute('aria-pressed', 'true');
    await expect(cur(page).getByTestId('report-layout-canvas')).toHaveCount(0);

    // AllowLayoutView mis à false en mode Page (l'état déjà modifié), puis l'Aperçu (enregistré) : « Fermer » ramène au mode Création
    await page.getByTestId(`doc-tab-report-${REPORT}`).click();
    await expect(flow(page)).toBeVisible();
    await cur(page).getByTestId('sheet-object').selectOption('doc');
    await cur(page).getByTestId('sheet-tab-format').click();
    await cur(page).getByTestId('prop-AllowLayoutView').selectOption('false');
    await expect(status(page, 'layout')).toBeDisabled();
    await page.keyboard.press('Control+s');
    await expect(tab(page, REPORT)).not.toContainText('•');
    await page.getByTestId('ribbon-tab-reportDesign').click();
    await pickView(page, 'viewPrintPreview');
    await expect(cur(page).getByTestId('report-preview')).toBeVisible();
    await page.getByTestId('cmd-closePreview').click();
    await expect(cur(page).getByTestId('toolbox')).toBeVisible();
    await expect(status(page, 'design')).toHaveAttribute('aria-pressed', 'true');

    // une source sans enregistrement : l'avis propre aux états, et le mode Page s'ouvre quand même
    await openLayout(page, 'Sans données');
    await expect(cur(page).getByTestId('layout-notice')).toHaveText(fr.layoutView.notice.report.empty);
    await expect(bands(page, 'detail')).toHaveCount(0);
    await expect(bands(page, 'reportHeader')).toHaveText('Factures');

    // plus de 100 lignes : les 100 premières, l'avis de troncature
    await openLayout(page, 'Longue');
    await expect(cur(page).getByTestId('layout-notice')).toHaveText(fr.layoutView.notice.truncated.replace('{{count}}', '100'));
    await expect(bands(page, 'detail')).toHaveCount(100);
    await expect(items(page, 'Nombre_Factures')).toHaveText('100');
  } finally {
    await app.close();
  }
});

test('Report Layout view on a parameterized query: asked once, neither Design <-> Layout nor an edit asks again (a refusal asks again); no event runs', async () => {
  const { app, page } = await launchApp({ args: [base()], env: FR });
  const modal = page.getByTestId('modal');
  try {
    // la question refusée : l'avis, et le mode Page s'ouvre sans données ; y revenir depuis Création la repose
    await page.getByTestId('nav-item-report-Paramétré').click({ button: 'right' });
    await page.getByTestId('nav-menu-layout').click();
    await expect(modal).toContainText(P);
    await page.getByTestId('modal-btn-cancel').click();
    await expect(cur(page).getByTestId('layout-notice')).toHaveText(fr.layoutView.notice.report.parameters);
    await expect(bands(page, 'detail')).toHaveCount(0);
    await status(page, 'design').click();
    await expect(cur(page).getByTestId('toolbox')).toBeVisible();
    await status(page, 'layout').click();
    await expect(modal).toContainText(P);
    await page.getByTestId('modal-input').fill('Durand');
    await page.getByTestId('modal-btn-ok').click();
    await expect(modal).toHaveCount(0);
    await expect(bands(page, 'detail')).toHaveCount(5);
    await expect(bands(page, 'groupHeader')).toHaveText('Durand');

    await status(page, 'design').click();
    await expect(cur(page).getByTestId('toolbox')).toBeVisible();
    await status(page, 'layout').click();
    await expect(flow(page)).toBeVisible();
    await settled(page);
    await expect(modal).toHaveCount(0);
    await expect(bands(page, 'detail')).toHaveCount(5);

    // une modification (Gras) : remise en page sans relire les lignes ni redemander le paramètre
    await items(page, 'Libelle').first().click();
    await page.getByTestId('ribbon-tab-format').click();
    await page.getByTestId('cmd-bold').click();
    await expect(items(page, 'Libelle').first()).toHaveCSS('font-weight', '700');
    await settled(page);
    await expect(modal).toHaveCount(0);
    await expect(bands(page, 'detail')).toHaveCount(5);

    // un état avec des événements : le mode Page n'en exécute aucun (ni Sur ouverture, ni Sur formatage, ni Sur fermeture)
    await openLayout(page, 'Événements');
    await settled(page);
    await expect(bands(page, 'detail')).toHaveCount(75);   // Sur formatage les aurait presque tous masqués
    await expect(page.getByTestId('macro-msgbox')).toHaveCount(0);
    await expect(modal).toHaveCount(0);
    await page.getByTestId('doc-tab-close-report-Événements').click();
    await expect(tab(page, 'Événements')).toHaveCount(0);
    await expect(page.getByTestId('macro-msgbox')).toHaveCount(0);
  } finally {
    await app.close();
  }
});

test('Report Layout view: the header items (Date and Time) work in Layout, one undo removes them; totals stay off, the gallery is on', async () => {
  const { app, page } = await launchApp({ args: [base()], env: FR });
  try {
    await openLayout(page, REPORT);
    await settled(page);
    await page.getByTestId('ribbon-tab-reportDesign').click();
    for (const id of ['pageNumbers', 'logo', 'title', 'dateTime']) await expect(page.getByTestId(`cmd-${id}`), id).toBeEnabled();
    for (const id of ['reportTotals', 'hideDetails', 'groupSort']) await expect(page.getByTestId(`cmd-${id}`), id).toBeDisabled();
    for (const id of ['textBox', 'label', 'line']) await expect(page.getByTestId(`cmd-${id}`), id).toBeEnabled();
    await expect(items(page, 'Auto_Date')).toHaveCount(0);
    await page.getByTestId('cmd-dateTime').click();
    await expect(items(page, 'Auto_Date')).toHaveCount(1);
    await expect(items(page, 'Auto_Heure')).toHaveCount(1);
    await settled(page);
    await expect(tab(page, REPORT)).toContainText('•');
    await page.getByTestId('ribbon-tab-home').click();
    await page.keyboard.press('Control+z');
    await expect(items(page, 'Auto_Date')).toHaveCount(0);
    await expect(items(page, 'Auto_Heure')).toHaveCount(0);
    await settled(page);
  } finally {
    await app.close();
  }
});

test('Report Layout view: Delete removes the selected control everywhere (one undo step); typing in the property sheet and a read-only base are safe', async () => {
  test.setTimeout(120000);
  const b = base();
  const { app, page } = await launchApp({ args: [b], env: FR });
  try {
    await openLayout(page, REPORT);
    await settled(page);
    // rien de sélectionné, ou l'état : Suppr ne fait rien
    await cur(page).getByTestId('report-layout-canvas').focus();
    await page.keyboard.press('Delete');
    await expect(items(page, 'Montant')).toHaveCount(75);
    await clean(page, REPORT);
    // Suppr dans un champ de la Feuille de propriétés : le contrôle reste
    await items(page, 'Montant').nth(3).click();
    await expect(rings(page, 'Montant')).toHaveCount(75);
    await cur(page).getByTestId('prop-Name').focus();
    await page.keyboard.press('Delete');
    await page.keyboard.press('Backspace');
    await expect(items(page, 'Montant')).toHaveCount(75);
    await clean(page, REPORT);
    // un clic dans le flux donne le clavier au canevas : Suppr retire le contrôle de chaque enregistrement et de la feuille
    await items(page, 'Montant').nth(3).click();
    await page.keyboard.press('Backspace');   // Retour arrière ne supprime pas (comme en mode Création)
    await expect(items(page, 'Montant')).toHaveCount(75);
    await page.keyboard.press('Delete');
    await expect(items(page, 'Montant')).toHaveCount(0);
    await settled(page);
    await expect(tab(page, REPORT)).toContainText('•');
    await expect(cur(page).getByTestId('sheet-object').locator('option[value="c:Montant"]')).toHaveCount(0);
    await page.keyboard.press('Control+z');
    await expect(items(page, 'Montant')).toHaveCount(75);
    await settled(page);
    await expect(cur(page).getByTestId('sheet-object').locator('option[value="c:Montant"]')).toHaveCount(1);
  } finally {
    await app.close();
  }
  // base en lecture seule (seconde instance) : Suppr ne retire rien
  const first = await launchApp({ args: [b], env: FR });
  const second = await launchApp({ args: [b], env: FR });
  try {
    const p = second.page;
    await expect(p.getByTestId('banner-readonly')).toBeVisible();
    await openLayout(p, REPORT);
    await settled(p);
    await items(p, 'Montant').nth(3).click();
    await expect(rings(p, 'Montant')).toHaveCount(75);
    await p.keyboard.press('Delete');
    await expect(items(p, 'Montant')).toHaveCount(75);
    await clean(p, REPORT);
  } finally {
    await second.app.close();
    await first.app.close();
  }
});

test('Report Layout view: a chart control draws its bars with data', async () => {
  const { app, page } = await launchApp({ args: [base()], env: FR });
  try {
    await openLayout(page, 'Avec graphique');
    await settled(page);
    const g = items(page, 'Graph');
    await expect(g).toContainText('Dupont');   // les catégories viennent des données
    await expect(g.locator('path[ecmeta_series_index]')).toHaveCount(3);   // une barre par client
  } finally {
    await app.close();
  }
});
