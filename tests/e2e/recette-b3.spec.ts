// Recette du lot B3 (démarrage de l'application), région fr-FR : un menu FMenu ouvert par AutoExec, dont les boutons ouvrent des
// formulaires, filtrent et impriment ; Fichier › Options › « Base de données active » : titre, icône, volet masqué, mode exécution ;
// rouverte : le titre, pas de volet, le ruban simplifié, pas de mode Création ; non approuvée : AutoExec ouvre encore le menu ;
// Maj + clic sur la base récente : tout est montré ; le bouton Quitter ferme l'application.
import { test, expect, type ElectronApplication, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { saveObject } from '../../src/main/db/objects';
import { seedSales, seedSalesRelation } from '../../src/main/query/test-db';
import type { BasecraftApi } from '../../src/shared/api';
import type { ControlDef, DesignDoc } from '../../src/shared/design/model';
import type { MacroItem } from '../../src/shared/macro/model';
import { DEFAULT_STARTUP } from '../../src/shared/startup';
import { SHIFT_GRACE_MS } from '../../src/renderer/shell/shift-key';
import { launchApp, openDbOptions, seedBase, seedForm, seedReportsE2E } from './helpers';

const fr = JSON.parse(readFileSync(join(__dirname, '../../src/shared/i18n/fr.json'), 'utf8'));
const FR = { BASECRAFT_REGION: 'fr-FR' };
const ICON = join(__dirname, '../../build/icon.png');
const REPORT = 'Factures par client';
type Win = { basecraft: BasecraftApi };

const act = (action: string, args: Record<string, string> = {}): MacroItem => ({ k: 'action', action, args });
const embedded = (...items: MacroItem[]) => ({ embedded: { formatVersion: '1.0' as const, items } });
const box = (kind: ControlDef['kind'], name: string, top: number, props: Record<string, unknown>): ControlDef =>
  ({ kind, name, left: 1701, top, width: 2268, height: 340, props });
const form = (recordSource: DesignDoc['recordSource'], controls: ControlDef[], props: Record<string, unknown> = {}): DesignDoc => ({
  formatVersion: '1.0', recordSource, props: { Width: 9072, ...props },
  sections: [{ kind: 'formHeader', height: 0, props: { Visible: false }, controls: [] },
    { kind: 'detail', height: 2400, props: {}, controls },
    { kind: 'formFooter', height: 0, props: { Visible: false }, controls: [] }],
});
const bound = (table: string, fields: string[]) =>
  form({ kind: 'table', name: table }, fields.map((f, i) => box('textBox', f, 100 + i * 500, { ControlSource: f })));
const button = (name: string, caption: string, i: number, item: MacroItem) =>
  box('commandButton', name, 100 + i * 450, { Caption: caption, OnClick: embedded(item) });
const FMENU = form(null, [
  button('cmdClients', 'Clients', 0, act('OpenForm', { FormName: 'FClients', View: 'form' })),
  button('cmdLyon', 'Clients de Lyon', 1, act('OpenForm', { FormName: 'FClients', View: 'form', WhereCondition: '[Ville]="Lyon"' })),
  button('cmdCommandes', 'Commandes', 2, act('OpenForm', { FormName: 'FCommandes', View: 'form' })),
  button('cmdImprimer', 'Imprimer les factures', 3, act('OpenReport', { ReportName: REPORT, View: 'print' })),
  button('cmdQuitter', 'Quitter', 4, act('Quit')),
], { Caption: 'Menu principal' });

const seed = () => seedBase('recette-b3', (db: DatabaseSync) => {
  seedSales(db);
  seedSalesRelation(db);
  seedReportsE2E(db);
  seedForm(db, 'FClients', bound('Clients', ['N°', 'Nom', 'Ville']));
  seedForm(db, 'FCommandes', bound('Commandes', ['Client', 'Montant']));
  seedForm(db, 'FMenu', FMENU);
  const r = saveObject(db, 'macro', 'AutoExec', { formatVersion: '1.0', items: [act('OpenForm', { FormName: 'FMenu', View: 'form' })] }, null);
  if (!r.ok) throw new Error(r.reason);
});

/** The shown element: the other tabs' views stay mounted, hidden, with the same test ids. */
const vis = (page: Page, id: string) => page.locator(`[data-testid="${id}"]:visible`);
const windowTitle = (app: ElectronApplication) => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.getTitle());
const lastIcon = (app: ElectronApplication) => app.evaluate(() => (globalThis as { __bcIconE2E?: { last: unknown } }).__bcIconE2E?.last);
const printed = (app: ElectronApplication) => app.evaluate(() => (globalThis as unknown as { __bcPrintE2E: { printed: number } }).__bcPrintE2E.printed);
const startup = (page: Page) => page.evaluate(() => (window as unknown as Win).basecraft.base.startup());
const ribbonTabs = (page: Page) => page.locator('[data-testid^="ribbon-tab-"]').evaluateAll((els) => els.map((e) => (e as HTMLElement).dataset.testid));
const docTabs = (page: Page) => page.locator('[data-testid^="doc-tab-"]:not([data-testid^="doc-tab-close-"])');

/** FMenu's button `name` clicked: `form` active with `count` records, its first `Nom`s as given (Next between them). */
async function menuOpens(page: Page, name: string, form: string, count: string, noms: string[] = []) {
  await page.getByTestId('doc-tab-form-FMenu').click();
  await vis(page, `form-ctl-${name}`).click();
  await expect(page.getByTestId(`doc-tab-form-${form}`)).toHaveAttribute('aria-selected', 'true');
  await expect(vis(page, 'nav-record-count')).toHaveText(count);
  for (const [i, nom] of noms.entries()) {
    if (i) await vis(page, 'form-run').getByRole('button', { name: fr.datasheet.nav.next, exact: true }).click();
    await expect(vis(page, 'form-ctl-Nom')).toHaveValue(nom);
  }
}
/** cmdLyon on a fresh FClients: Dupont and Martin (« LYON »), not Éric (« Lyôn »: B1's accent rule). */
async function lyon(page: Page) {
  if (await page.getByTestId('doc-tab-form-FClients').count()) await page.getByTestId('doc-tab-close-form-FClients').click();
  await expect(page.getByTestId('doc-tab-form-FClients')).toHaveCount(0);
  await menuOpens(page, 'cmdLyon', 'FClients', '2', ['Dupont', 'Martin']);
  await expect(page.getByTestId('macro-failed')).toHaveCount(0);
}

test('recette B3: AutoExec opens a menu whose buttons open forms, filter and print; the options hide the pane and Design view; Shift shows everything', async () => {
  test.setTimeout(240_000);
  const base = seed();

  // 1. no options yet: everything shown, AutoExec opens FMenu; File › Options › « Base de données active »
  let { app, page, userDataDir } = await launchApp({ args: [base], env: FR });
  try {
    await expect(page.getByTestId('doc-tab-form-FMenu')).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByTestId('nav-pane')).toBeVisible();
    await expect(page.getByTestId('ribbon-tab-create')).toBeVisible();
    expect(await startup(page)).toEqual(DEFAULT_STARTUP);
    await page.getByTestId('ribbon-tab-file').click();
    await openDbOptions(page);
    await page.getByTestId('opt-db-title').fill('Gestion des ventes');
    await page.getByTestId('opt-db-title').press('Enter');
    await expect.poll(() => windowTitle(app)).toBe('Gestion des ventes');   // at once (R11)
    await page.getByTestId('opt-db-icon-input').setInputFiles(ICON);
    await expect.poll(() => lastIcon(app)).toEqual({ width: 256, height: 256 });
    await page.getByTestId('opt-db-navpane').uncheck();
    await page.getByTestId('opt-db-runmode').check();
    await expect.poll(() => startup(page)).toMatchObject({ appTitle: 'Gestion des ventes', showNavPane: false, runMode: true, startupForm: '' });
    expect((await startup(page)).appIcon.length).toBeGreaterThan(0);
  } finally {
    await app.close();
  }

  // 2. reopened: the title and the icon, no pane and no strip, File and Home only, no Design view; AutoExec's FMenu active
  ({ app, page } = await launchApp({ args: [base], env: FR, userDataDir }));
  try {
    await expect.poll(() => windowTitle(app)).toBe('Gestion des ventes');
    await expect.poll(() => lastIcon(app)).toEqual({ width: 256, height: 256 });
    await expect(page.getByTestId('doc-tab-form-FMenu')).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByTestId('nav-pane')).toHaveCount(0);
    await expect(page.getByTestId('nav-show')).toHaveCount(0);
    expect(await ribbonTabs(page)).toEqual(['ribbon-tab-file', 'ribbon-tab-home']);
    await expect(page.getByTestId('cmd-viewDesign')).toHaveCount(0);
    await expect(page.getByTestId('status-view-design')).toHaveCount(0);

    // 3. the menu's buttons: every client, Lyon's, every order, the report printed without a preview
    await menuOpens(page, 'cmdClients', 'FClients', '4', ['Dupont', 'Martin', 'Durand', 'Éric']);
    await lyon(page);
    await menuOpens(page, 'cmdCommandes', 'FCommandes', '5');
    expect(await printed(app)).toBe(0);
    await page.getByTestId('doc-tab-form-FMenu').click();
    await vis(page, 'form-ctl-cmdImprimer').click();
    await expect.poll(() => printed(app)).toBe(1);
    await expect(page.getByTestId(`doc-tab-report-${REPORT}`)).toHaveCount(0);
    await expect(page.getByTestId('modal')).toHaveCount(0);

    // 4. no way into Design view: F11 shows the pane, its menu has no Design View
    await page.keyboard.press('F11');
    await expect(page.getByTestId('nav-pane')).toBeVisible();
    await page.getByTestId('nav-item-form-FMenu').click({ button: 'right' });
    await expect(page.getByTestId('nav-menu')).toBeVisible();
    await expect(page.getByTestId('nav-menu-design')).toHaveCount(0);
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('nav-menu')).toHaveCount(0);
    await page.getByTestId('doc-tab-form-FMenu').click();
    await expect(vis(page, 'form-run')).toBeVisible();
    await expect(page.getByTestId('form-design')).toHaveCount(0);
  } finally {
    await app.close();
  }

  // 5. untrusted: the security bar; AutoExec still opens FMenu (OpenForm is safe), cmdLyon still filters
  ({ app, page } = await launchApp({ args: [base], env: FR, userDataDir, untrusted: true }));
  try {
    await expect(page.getByTestId('banner-content')).toBeVisible();
    await expect(page.getByTestId('doc-tab-form-FMenu')).toHaveAttribute('aria-selected', 'true');
    await lyon(page);
  } finally {
    await app.close();
  }

  // 6. no file given; Shift + click on File › Recent's base: the title, everything shown, no AutoExec, Design view works
  ({ app, page } = await launchApp({ env: FR, userDataDir }));
  try {
    await expect(page.getByTestId('backstage')).toBeVisible();
    await expect(page.getByTestId('bs-recent-0')).toHaveAttribute('title', base);
    await page.getByTestId('bs-recent-0').click({ modifiers: ['Shift'] });
    await expect.poll(() => page.evaluate(() => (window as unknown as Win).basecraft.base.state())).not.toBeNull();
    await expect.poll(() => windowTitle(app)).toBe('Gestion des ventes');   // R4: the title applies, bypassed or not
    await expect(page.getByTestId('nav-pane')).toBeVisible();
    await expect(page.getByTestId('ribbon-tab-create')).toBeVisible();
    await page.waitForTimeout(SHIFT_GRACE_MS * 2);   // past the moment the sequence would have run
    await expect(docTabs(page)).toHaveCount(0);
    await page.getByTestId('nav-item-form-FMenu').dblclick();
    await expect(page.getByTestId('doc-tab-form-FMenu')).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByTestId('cmd-viewDesign')).toBeVisible();
    await page.getByTestId('cmd-viewDesign').click();
    await expect(page.getByTestId('form-design')).toBeVisible();

    // 7. back to Form view, « Quitter »: the app exits
    await page.getByTestId('cmd-viewForm').click();
    await expect(vis(page, 'form-run')).toBeVisible();
    const closed = app.waitForEvent('close');
    await vis(page, 'form-ctl-cmdQuitter').click();
    await closed;
  } finally {
    await app.close().catch(() => undefined);
  }
});
