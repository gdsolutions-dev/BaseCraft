// Recette du lot B1 (macros et sécurité), tout par l'interface (région fr-FR) : formulaire instantané FClients, macro MLyon
// (DéfinirVarTemp, OuvrirFormulaire avec Condition WHERE sur [VarTemp], ZoneMessage), Exécuter depuis la création ; macro MDoubler
// (Avertissements Non, ExécuterSQL) lancée du volet sans confirmation ; base rouverte non approuvée (barre de sécurité, actions sûres
// seules), « Activer le contenu », approbation retenue, puis redemandée après une modification faite ailleurs.
import { test, expect, type Page } from '@playwright/test';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openBaseFile } from '../../src/main/db/file-format';
import { saveObject } from '../../src/main/db/objects';
import type { BasecraftApi } from '../../src/shared/api';
import type { MacroDef } from '../../src/shared/macro/model';
import { launchApp, seedSalesE2E } from './helpers';

const fr = JSON.parse(readFileSync(join(__dirname, '../../src/shared/i18n/fr.json'), 'utf8'));
const fill = (s: string, p: Record<string, string>) => s.replace(/\{\{(\w+)\}\}/g, (_, k: string) => p[k]!);
const FR = { BASECRAFT_REGION: 'fr-FR' };
type Win = { basecraft: BasecraftApi };

/** The shown element: the other tabs' views stay mounted, hidden, with the same test ids. */
const vis = (page: Page, id: string) => page.locator(`[data-testid="${id}"]:visible`);
/** Order 1's Montant (seed: 10.1), read through the api. */
const montant1 = (page: Page) => page.evaluate(() => (window as unknown as Win).basecraft.rows.page('Commandes', { offset: 0, limit: 100 })
  .then((p) => p.rows.find((r) => r.values[0] === 1)?.values[2]));
const content = (page: Page) => page.evaluate(() => (window as unknown as Win).basecraft.base.state().then((s) => s?.content));
const names = (page: Page, kind: 'form' | 'macro') => page.evaluate((k) => (window as unknown as Win).basecraft.objects.list(k)
  .then((l) => l.map((o) => o.name)), kind);
const getMacro = (page: Page, name: string) => page.evaluate((n) => (window as unknown as Win).basecraft.objects.get('macro', n), name)
  .then((r) => r.definition as MacroDef);

/** « Ajouter une nouvelle action » at the top level: `action` picked from the list; its index is `i`. */
async function add(page: Page, action: string, i: number) {
  await page.getByTestId('macro-add-root-toggle').click();
  await page.getByTestId(`macro-add-root-option-${action}`).click();
  await expect(page.getByTestId(`macro-item-${i}`)).toContainText(fr.macro.action[action]);
}
async function arg(page: Page, i: number, name: string, value: string) {
  await page.getByTestId(`macro-arg-${i}-${name}-input`).fill(value);
  await page.getByTestId(`macro-arg-${i}-${name}-input`).press('Enter');
}
/** An object list (a combo box): `option` picked from its list. */
async function pick(page: Page, i: number, name: string, option: string) {
  await page.getByTestId(`macro-arg-${i}-${name}-input-toggle`).click();
  await page.getByTestId(`macro-arg-${i}-${name}-input-option-${option}`).click();
}
/** Ctrl+S on a new macro: its name asked, then saved. */
async function saveNew(page: Page, name: string) {
  await page.keyboard.press('Control+s');
  await page.getByTestId('modal-input').fill(name);
  await page.getByTestId('modal-btn-ok').click();
  await expect(page.getByTestId(`doc-tab-macro-${name}`)).toBeVisible();
  await expect(page.getByTestId(`nav-item-macro-${name}`)).toBeVisible();
}
/** MLyon's effect: the message box first (the form already open behind it), then FClients on Dupont and Martin only. */
async function lyon(page: Page) {
  await expect(page.getByTestId('macro-msgbox-text')).toHaveText('Clients de Lyon');
  await expect(page.getByTestId('doc-tab-form-FClients')).toBeVisible();
  await page.getByTestId('macro-msgbox-ok').click();
  await expect(page.getByTestId('macro-msgbox')).toHaveCount(0);
  await expect(page.getByTestId('doc-tab-form-FClients')).toHaveAttribute('aria-selected', 'true');
  await expect(vis(page, 'nav-record-count')).toHaveText('2');   // not Durand (Paris), not Éric (Lyôn)
  await expect(vis(page, 'form-ctl-Nom')).toHaveValue('Dupont');
  await vis(page, 'form-run').getByRole('button', { name: fr.datasheet.nav.next, exact: true }).click();
  await expect(vis(page, 'form-ctl-Nom')).toHaveValue('Martin');
  await page.getByTestId('doc-tab-close-form-FClients').click();
  await expect(page.getByTestId('doc-tab-form-FClients')).toHaveCount(0);
}

test('recette B1: macros, Where Condition on a TempVar, RunSQL without warnings, the security bar and the approval', async () => {
  test.setTimeout(180_000);
  const base = seedSalesE2E('recette-b1');

  // 1-4: in the trusted temporary folder (the base has no active content yet)
  let { app, page } = await launchApp({ args: [base], env: FR });
  try {
    expect(await content(page)).toBe('none');   // no active content yet: nothing to approve

    // 1. Clients selected in the Navigation Pane, Create › Formulaire (saved under the table's name), renamed FClients
    await page.getByTestId('nav-item-Clients').click();
    await page.getByTestId('ribbon-tab-create').click();
    await page.getByTestId('cmd-createForm').click();
    await expect(page.getByTestId('doc-tab-form-Clients')).toHaveAttribute('aria-selected', 'true');
    await page.getByTestId('doc-tab-close-form-Clients').click();
    await page.getByTestId('nav-item-form-Clients').click({ button: 'right' });
    await page.getByTestId('nav-menu-rename').click();
    await page.getByTestId('modal-input').fill('FClients');
    await page.getByTestId('modal-btn-ok').click();
    await expect(page.getByTestId('nav-item-form-FClients')).toBeVisible();
    expect(await names(page, 'form')).toEqual(['FClients']);

    // 2. Create › Macro: DéfinirVarTemp, OuvrirFormulaire with its Where Condition on [VarTemp]![Ville], ZoneMessage; saved MLyon
    await page.getByTestId('ribbon-tab-create').click();
    await page.getByTestId('cmd-createMacro').click();
    await expect(page.getByTestId('macro-design')).toBeVisible();
    await page.getByTestId('macro-add-root').fill(fr.macro.action.SetTempVar);
    await expect(page.getByTestId('macro-item-0')).toContainText(fr.macro.action.SetTempVar);
    await arg(page, 0, 'Name', 'Ville');
    await arg(page, 0, 'Expression', '"Lyon"');
    await add(page, 'OpenForm', 1);
    await pick(page, 1, 'FormName', 'FClients');
    await arg(page, 1, 'WhereCondition', '[Ville]=[VarTemp]![Ville]');
    await add(page, 'MessageBox', 2);
    await arg(page, 2, 'Message', '="Clients de " & [VarTemp]![Ville]');
    await saveNew(page, 'MLyon');
    const lyonDef = await getMacro(page, 'MLyon');
    expect(lyonDef.items.map((i) => (i.k === 'action' ? [i.action, i.args] : i.k))).toEqual([
      ['SetTempVar', { Name: 'Ville', Expression: '"Lyon"' }],
      ['OpenForm', expect.objectContaining({ FormName: 'FClients', WhereCondition: '[Ville] = [TempVars]![Ville]' })],
      ['MessageBox', expect.objectContaining({ Message: '="Clients de " & [TempVars]![Ville]' })],   // stored canonical
    ]);

    // 3. Macro Design › Exécuter
    await page.getByTestId('ribbon-tab-macroDesign').click();
    await page.getByTestId('cmd-macroRun').click();
    await lyon(page);
    await page.getByTestId('doc-tab-close-macro-MLyon').click();
    await expect(page.getByTestId('doc-tab-macro-MLyon')).toHaveCount(0);

    // 4. Create › Macro MDoubler: Show All Actions, Avertissements Non, then ExécuterSQL; run from the Navigation Pane
    await page.getByTestId('ribbon-tab-create').click();
    await page.getByTestId('cmd-createMacro').click();
    await expect(page.getByTestId('doc-tab-macro-Macro1')).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByTestId('ribbon-tab-macroDesign')).toHaveAttribute('aria-selected', 'true');
    await page.getByTestId('cmd-showAllActions').click();
    await expect(page.getByTestId('cmd-showAllActions')).toHaveAttribute('aria-pressed', 'true');
    await add(page, 'SetWarnings', 0);
    await page.getByTestId('macro-arg-0-WarningsOn-input').selectOption('no');
    await expect(page.getByTestId('macro-arg-0-WarningsOn-input').locator('option:checked')).toHaveText(fr.macro.argValue.WarningsOn.no);
    await add(page, 'RunSQL', 1);
    await page.getByTestId('macro-arg-1-SQLStatement-input').fill('UPDATE Commandes SET Montant = Montant * 2 WHERE [N°] = 1;');   // a text area
    await saveNew(page, 'MDoubler');
    expect((await getMacro(page, 'MDoubler')).items).toEqual([
      { k: 'action', action: 'SetWarnings', args: { WarningsOn: 'no' } },
      { k: 'action', action: 'RunSQL', args: { SQLStatement: 'UPDATE Commandes SET Montant = Montant * 2 WHERE [N°] = 1;' } },
    ]);
    expect(await montant1(page)).toBe(10.1);
    await page.getByTestId('nav-item-macro-MDoubler').dblclick();
    await expect.poll(() => montant1(page)).toBe(20.2);
    await expect(page.getByTestId('modal')).toHaveCount(0);   // no confirmation asked
    expect(await content(page)).toBe('enabled');   // R5: what this user saved stays approved
  } finally {
    await app.close();
  }

  // 5. the same file, nothing trusted, a fresh user data folder: the security bar; safe actions only
  const userDataDir = mkdtempSync(join(tmpdir(), 'basecraft-recette-b1-'));
  const untrusted = () => launchApp({ args: [base], env: FR, userDataDir, untrusted: true });
  ({ app, page } = await untrusted());
  try {
    await expect(page.getByTestId('banner-content')).toBeVisible();
    expect(await content(page)).toBe('disabled');
    await page.getByTestId('nav-item-macro-MLyon').dblclick();
    await lyon(page);

    await page.getByTestId('nav-item-macro-MDoubler').dblclick();
    await expect(page.getByTestId('macro-failed')).toBeVisible();
    await expect(page.getByTestId('macro-failed-message')).toHaveText(fill(fr.macro.error.blocked, { action: fr.macro.action.SetWarnings }));
    await page.getByTestId('macro-failed-stop').click();
    await expect(page.getByTestId('modal')).toHaveCount(0);
    expect(await montant1(page)).toBe(20.2);

    // 6. « Activer le contenu »: the bar goes, MDoubler runs
    await page.getByTestId('banner-enable-content').click();
    await expect(page.getByTestId('banner-content')).toHaveCount(0);
    await page.getByTestId('nav-item-macro-MDoubler').dblclick();
    await expect.poll(() => montant1(page)).toBe(40.4);
    await expect(page.getByTestId('modal')).toHaveCount(0);
  } finally {
    await app.close();
  }

  // 7. the approval is remembered in this user data folder; a change made while the app is closed asks again
  ({ app, page } = await untrusted());
  try {
    await expect.poll(() => content(page)).toBe('enabled');
    await expect(page.getByTestId('nav-item-macro-MDoubler')).toBeVisible();
    await expect(page.getByTestId('banner-content')).toHaveCount(0);
  } finally {
    await app.close();
  }
  const { db } = openBaseFile(base, 'write', '0.0.0');
  try {
    const r = saveObject(db, 'macro', 'MDoubler', { formatVersion: '1.0', items: [
      { k: 'action', action: 'RunSQL', args: { SQLStatement: 'UPDATE Commandes SET Montant = Montant * 3 WHERE [N°] = 1;' } }] }, 'MDoubler');
    expect(r.ok).toBe(true);
  } finally {
    db.close();
  }
  ({ app, page } = await untrusted());
  try {
    await expect(page.getByTestId('banner-content')).toBeVisible();
    expect(await content(page)).toBe('disabled');
    expect(await montant1(page)).toBe(40.4);
  } finally {
    await app.close();
  }
});
