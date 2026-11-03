// L'application de l'étape B (spec 7), construite par le concepteur dans l'application complète, par l'interface (B1–B4) :
// FClients, FCommandes sur la jointure QCommandesClients avec sa macro Avant MAJ, FMenu et ses huit boutons, AutoExec (OpenForm FMenu,
// RunSQL dans Journal), l'analyse croisée QVentes, l'état « Factures par client », les options de démarrage. Partie 1 de recette-b,
// reprise par recette-c7 (cette application migrée vers un serveur).
import { expect, type ElectronApplication, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { saveObject } from '../../src/main/db/objects';
import { createTable } from '../../src/main/db/schema';
import { seedSales, seedSalesRelation } from '../../src/main/query/test-db';
import type { BasecraftApi } from '../../src/shared/api';
import type { DesignDoc } from '../../src/shared/design/model';
import type { MacroDef } from '../../src/shared/macro/model';
import { f, t } from '../../src/shared/test-fixtures';
import { launchApp, openDbOptions, seedBase, seedReportsE2E } from './helpers';

const fr = JSON.parse(readFileSync(join(__dirname, '../../src/shared/i18n/fr.json'), 'utf8'));
const FR = { BASECRAFT_REGION: 'fr-FR' };
const ICON = join(__dirname, '../../build/icon.png');
export const REPORT = 'Factures par client';
export const TITLE = 'Gestion des ventes';
type Win = { basecraft: BasecraftApi };

/** B4's join query and crosstab, as Query Design writes them. */
const QUERIES: [string, string][] = [
  ['QCommandesClients', 'SELECT [Commandes].[N°], [Commandes].[Client], [Commandes].[Montant], [Clients].[Nom], [Clients].[Ville]\n'
    + 'FROM [Clients] INNER JOIN [Commandes] ON [Clients].[N°] = [Commandes].[Client];'],
  ['QVentes', 'TRANSFORM Sum([Commandes].[Montant])\nSELECT [Clients].[Nom]\n'
    + 'FROM [Clients] INNER JOIN [Commandes] ON [Clients].[N°] = [Commandes].[Client]\nGROUP BY [Clients].[Nom]\nPIVOT [Clients].[Ville];'],
];
const seed = () => seedBase('recette-b', (db: DatabaseSync) => {
  seedSales(db);
  seedSalesRelation(db);
  seedReportsE2E(db);
  createTable(db, t('Journal', [f('N°', 'autoNumber'), f('Texte', 'shortText')]));
  for (const [name, sql] of QUERIES) {
    const r = saveObject(db, 'query', name, { formatVersion: '1.0', sql }, null);
    if (!r.ok) throw new Error(r.reason);
  }
});

/** The shown element: the other tabs' views stay mounted, hidden, with the same test ids. */
export const vis = (page: Page, id: string) => page.locator(`[data-testid="${id}"]:visible`);
const count = (page: Page, table: string) => page.evaluate((n) => (window as unknown as Win).basecraft.rows.count(n), table);
const getDef = (page: Page, kind: 'form' | 'macro', name: string) =>
  page.evaluate(([k, n]) => (window as unknown as Win).basecraft.objects.get(k, n).then((o) => o.definition), [kind, name] as const);
const startup = (page: Page) => page.evaluate(() => (window as unknown as Win).basecraft.base.startup());
const windowTitle = (app: ElectronApplication) => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.getTitle());

async function setProp(page: Page, name: string, value: string) {
  await vis(page, `prop-${name}`).fill(value);
  await vis(page, `prop-${name}`).press('Enter');
}
/** Create › Formulaire on the selected `navItem` (saved under its name, B1), then renamed `name` through the Navigation Pane. */
async function instantForm(page: Page, navItem: string, source: string, name: string) {
  await page.getByTestId(navItem).click();
  await page.getByTestId('ribbon-tab-create').click();
  await page.getByTestId('cmd-createForm').click();
  await expect(page.getByTestId(`doc-tab-form-${source}`)).toHaveAttribute('aria-selected', 'true');
  await page.getByTestId(`doc-tab-close-form-${source}`).click();
  await page.getByTestId(`nav-item-form-${source}`).click({ button: 'right' });
  await page.getByTestId('nav-menu-rename').click();
  await page.getByTestId('modal-input').fill(name);
  await page.getByTestId('modal-btn-ok').click();
  await expect(page.getByTestId(`nav-item-form-${name}`)).toBeVisible();
}
/** « Ajouter une nouvelle action » of a block (`root` or an If branch `i.b`): `id` picked from its list. */
async function add(page: Page, key: string, id: string) {
  await vis(page, `macro-add-${key}-toggle`).click();
  await vis(page, `macro-add-${key}-option-${id}`).click();
}
/** An object list (a combo box) of action `i`: `option` picked from its list. */
async function pick(page: Page, i: number, name: string, option: string) {
  await vis(page, `macro-arg-${i}-${name}-input-toggle`).click();
  await vis(page, `macro-arg-${i}-${name}-input-option-${option}`).click();
}
async function arg(page: Page, i: number, name: string, value: string) {
  await vis(page, `macro-arg-${i}-${name}-input`).fill(value);
  await vis(page, `macro-arg-${i}-${name}-input`).press('Enter');
}
/** The embedded macro saved into its design (Ctrl+S), its tab closed, back on the design (B2). */
async function saveEmbedded(page: Page, owner: string, macroTab: string) {
  await page.keyboard.press('Control+s');
  await expect(page.getByTestId('modal')).toHaveCount(0);
  await expect(page.getByTestId(macroTab)).not.toContainText('•');
  await expect(page.getByTestId(`doc-tab-form-${owner}`)).toContainText('•');
  await page.getByTestId(macroTab.replace('doc-tab-', 'doc-tab-close-')).click();
  await expect(page.getByTestId(macroTab)).toHaveCount(0);
  await page.getByTestId(`doc-tab-form-${owner}`).click();
}
async function saveDesign(page: Page, owner: string) {
  await page.keyboard.press('Control+s');
  await expect(page.getByTestId(`doc-tab-form-${owner}`)).not.toContainText('•');
  await page.getByTestId(`doc-tab-close-form-${owner}`).click();
  await expect(page.getByTestId(`doc-tab-form-${owner}`)).toHaveCount(0);
}

type Button = { name: string; caption: string; action: string; args: (page: Page) => Promise<void> };
const BUTTONS: Button[] = [
  { name: 'cmdClients', caption: 'Clients', action: 'OpenForm', args: (p) => pick(p, 0, 'FormName', 'FClients') },
  { name: 'cmdLyon', caption: 'Clients de Lyon', action: 'OpenForm', args: async (p) => {
    await pick(p, 0, 'FormName', 'FClients');
    await arg(p, 0, 'WhereCondition', '[Ville]="Lyon"');
  } },
  { name: 'cmdCommandes', caption: 'Commandes', action: 'OpenForm', args: (p) => pick(p, 0, 'FormName', 'FCommandes') },
  { name: 'cmdVentes', caption: 'Ventes', action: 'OpenQuery', args: (p) => pick(p, 0, 'QueryName', 'QVentes') },
  { name: 'cmdApercu', caption: 'Aperçu des factures', action: 'OpenReport', args: async (p) => {
    await pick(p, 0, 'ReportName', REPORT);
    await vis(p, 'macro-arg-0-View-input').selectOption('preview');
  } },
  { name: 'cmdImprimer', caption: 'Imprimer les factures', action: 'OpenReport', args: async (p) => {
    await pick(p, 0, 'ReportName', REPORT);
    await vis(p, 'macro-arg-0-View-input').selectOption('print');
  } },
  { name: 'cmdConception', caption: 'Création', action: 'OpenForm', args: async (p) => {
    await pick(p, 0, 'FormName', 'FClients');
    await vis(p, 'macro-arg-0-View-input').selectOption('design');
  } },
  { name: 'cmdQuitter', caption: 'Quitter', action: 'Quit', args: async () => undefined },
];

/** Create › Création de formulaire: FMenu, Caption « Menu principal », BUTTONS in its Detail (two columns), each On Click embedded. */
async function buildMenu(page: Page) {
  await page.getByTestId('ribbon-tab-create').click();
  await page.getByTestId('cmd-createFormDesign').click();
  await expect(page.getByTestId('doc-tab-form-Formulaire1')).toHaveAttribute('aria-selected', 'true');
  await vis(page, 'sheet-tab-all').click();
  await vis(page, 'sheet-object').selectOption('doc');
  await setProp(page, 'Caption', 'Menu principal');
  await vis(page, 'sheet-object').selectOption('s:1');
  await setProp(page, 'Height', '8');
  await page.keyboard.press('Control+s');
  await page.getByTestId('modal-input').fill('FMenu');
  await page.getByTestId('modal-btn-ok').click();
  await expect(page.getByTestId('doc-tab-form-FMenu')).not.toContainText('•');
  await expect(page.getByTestId('nav-item-form-FMenu')).toBeVisible();

  const detail = page.locator('[data-section-body="1"]:visible');
  for (const [i, b] of BUTTONS.entries()) {
    await vis(page, 'ribbon-tab-formDesign').click();
    await vis(page, 'tool-commandButton').click();
    await detail.click({ position: { x: 20 + (i % 2) * 300, y: 15 + Math.floor(i / 2) * 70 } });
    await vis(page, 'sheet-tab-all').click();
    await setProp(page, 'Name', b.name);
    await setProp(page, 'Caption', b.caption);
    await expect(vis(page, `ctl-${b.name}`)).toHaveText(b.caption);
    await vis(page, 'sheet-tab-event').click();
    await vis(page, 'prop-OnClick-build').click();
    const tab = `doc-tab-macro-FMenu : ${b.name} : ${fr.prop.OnClick}`;
    await expect(page.getByTestId(tab)).toHaveAttribute('aria-selected', 'true');
    await add(page, 'root', b.action);
    await expect(vis(page, 'macro-item-0')).toContainText(fr.macro.action[b.action]);
    await b.args(page);
    await saveEmbedded(page, 'FMenu', tab);
  }
  await saveDesign(page, 'FMenu');
}

/** The stage B application built through the UI by the designer, in the full application (its user data `userDataDir`, a new
 *  folder if none: the base is then its most recent one), and closed. Journal is empty. Returns the base's path. */
export async function buildStageBApp(userDataDir?: string): Promise<string> {
  const base = seed();
  const { app, page } = await launchApp({ args: [base], env: FR, userDataDir });
  try {
    // 1. Create › Formulaire on Clients → FClients, on QCommandesClients → FCommandes; FCommandes' Before Update (B2)
    await instantForm(page, 'nav-item-Clients', 'Clients', 'FClients');
    await instantForm(page, 'nav-item-query-QCommandesClients', 'QCommandesClients', 'FCommandes');
    await page.getByTestId('nav-item-form-FCommandes').click({ button: 'right' });
    await page.getByTestId('nav-menu-design').click();
    await expect(vis(page, 'designer')).toBeVisible();
    await vis(page, 'sheet-object').selectOption('doc');
    await vis(page, 'sheet-tab-event').click();
    await vis(page, 'prop-BeforeUpdate-build').click();
    const beforeUpdate = `doc-tab-macro-FCommandes : ${fr.tabs.kind.form} : ${fr.prop.BeforeUpdate}`;
    await expect(page.getByTestId(beforeUpdate)).toHaveAttribute('aria-selected', 'true');
    await add(page, 'root', 'block-if');
    await vis(page, 'macro-if-0-0').fill('[Montant]>1000');
    await vis(page, 'macro-if-0-0').press('Enter');
    await add(page, '0.0', 'MessageBox');
    await vis(page, 'macro-arg-0.0.0-Message-input').fill('Montant trop élevé');
    await add(page, '0.0', 'CancelEvent');
    await expect(vis(page, 'macro-item-0.0.1')).toContainText(fr.macro.action.CancelEvent);
    await saveEmbedded(page, 'FCommandes', beforeUpdate);
    await saveDesign(page, 'FCommandes');

    // 2. Create › Création de formulaire → FMenu, its eight buttons with embedded On Click macros (B2)
    await buildMenu(page);
    const fmenu = await getDef(page, 'form', 'FMenu') as DesignDoc;
    expect(fmenu.props.Caption).toBe('Menu principal');
    const onClick = Object.fromEntries(fmenu.sections.flatMap((s) => s.controls).map((c) => [c.name, c.props.OnClick]));
    const embedded = (action: string, args: Record<string, string>) =>
      ({ embedded: { formatVersion: '1.0', items: [{ k: 'action', action, args: expect.objectContaining(args) }] } });
    expect(onClick).toEqual({
      cmdClients: embedded('OpenForm', { FormName: 'FClients' }),
      cmdLyon: embedded('OpenForm', { FormName: 'FClients', WhereCondition: '[Ville] = "Lyon"' }),
      cmdCommandes: embedded('OpenForm', { FormName: 'FCommandes' }),
      cmdVentes: embedded('OpenQuery', { QueryName: 'QVentes' }),
      cmdApercu: embedded('OpenReport', { ReportName: REPORT, View: 'preview' }),
      cmdImprimer: embedded('OpenReport', { ReportName: REPORT, View: 'print' }),
      cmdConception: embedded('OpenForm', { FormName: 'FClients', View: 'design' }),
      cmdQuitter: embedded('Quit', {}),
    });

    // 3. Create › Macro → AutoExec: OpenForm FMenu, RunSQL into Journal (B1)
    await page.getByTestId('ribbon-tab-create').click();
    await page.getByTestId('cmd-createMacro').click();
    await expect(page.getByTestId('macro-design')).toBeVisible();
    await page.getByTestId('cmd-showAllActions').click();
    await expect(page.getByTestId('cmd-showAllActions')).toHaveAttribute('aria-pressed', 'true');
    await add(page, 'root', 'OpenForm');
    await pick(page, 0, 'FormName', 'FMenu');
    await add(page, 'root', 'RunSQL');
    await vis(page, 'macro-arg-1-SQLStatement-input').fill('INSERT INTO Journal (Texte) VALUES ("ouverture");');
    await page.keyboard.press('Control+s');
    await page.getByTestId('modal-input').fill('AutoExec');
    await page.getByTestId('modal-btn-ok').click();
    await expect(page.getByTestId('nav-item-macro-AutoExec')).toBeVisible();
    expect((await getDef(page, 'macro', 'AutoExec') as MacroDef).items).toEqual([
      { k: 'action', action: 'OpenForm', args: expect.objectContaining({ FormName: 'FMenu' }) },
      { k: 'action', action: 'RunSQL', args: { SQLStatement: 'INSERT INTO Journal (Texte) VALUES ("ouverture");' } },
    ]);

    // 4. File › Options › « Base de données active »: title, icon, display form, no pane, run mode (B3)
    await page.getByTestId('ribbon-tab-file').click();
    await openDbOptions(page);
    await page.getByTestId('opt-db-title').fill(TITLE);
    await page.getByTestId('opt-db-title').press('Enter');
    await expect.poll(() => windowTitle(app)).toBe(TITLE);
    await page.getByTestId('opt-db-icon-input').setInputFiles(ICON);
    await page.getByTestId('opt-db-form').selectOption('FMenu');
    await page.getByTestId('opt-db-navpane').uncheck();
    await page.getByTestId('opt-db-runmode').check();
    await expect.poll(() => startup(page))
      .toMatchObject({ appTitle: TITLE, startupForm: 'FMenu', showNavPane: false, runMode: true, appIcon: expect.stringMatching(/.+/) });
    expect(await count(page, 'Journal')).toBe(0);
  } finally {
    await app.close();
  }
  return base;
}
