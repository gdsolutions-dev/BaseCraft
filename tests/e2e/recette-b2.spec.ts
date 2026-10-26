// Recette du lot B2 (événements), tout par l'interface (région fr-FR) : formulaires instantanés FClients et FCommandes ; un bouton
// cmdCommandes dont la macro incorporée « Sur clic » ouvre FCommandes filtré par [Formulaires]![FClients]![N°] ; « Avant MAJ » de
// FCommandes refuse un montant > 1000 (ZoneMessage, AnnulerÉvénement) ; « Au formatage » du Détail de « Factures par client » masque
// les petits montants ; la base rouverte non approuvée : la barre de sécurité, le clic marche encore (actions sûres seules).
import { test, expect, type Page } from '@playwright/test';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { seedSales, seedSalesRelation } from '../../src/main/query/test-db';
import type { BasecraftApi } from '../../src/shared/api';
import type { DesignDoc } from '../../src/shared/design/model';
import { FACTURES_REPORT } from '../../src/shared/report/fixtures/factures';
import { launchApp, layoutFromDom, seedBase, seedReportsE2E, type DomLayout } from './helpers';

const fr = JSON.parse(readFileSync(join(__dirname, '../../src/shared/i18n/fr.json'), 'utf8'));
const FR = { BASECRAFT_REGION: 'fr-FR' };
const REPORT = 'Factures par client';
type Win = { basecraft: BasecraftApi };
/** A Montant as the form shows it: ICU's space before « € » may be U+00A0 or U+202F. */
const euros = (amount: string) => new RegExp(`^${amount}\\s€$`, 'u');

/** The shown element: the other tabs' views stay mounted, hidden, with the same test ids. */
const vis = (page: Page, id: string) => page.locator(`[data-testid="${id}"]:visible`);
const names = (page: Page) => page.evaluate(() => (window as unknown as Win).basecraft.objects.list('form').then((l) => l.map((o) => o.name).sort()));
const getDef = (page: Page, kind: 'form' | 'report', name: string) => page.evaluate(([k, n]) => (window as unknown as Win).basecraft.objects.get(k, n),
  [kind, name] as const).then((r) => r.definition as DesignDoc);
/** Order 3's Montant (seed: Martin, 0.2), read through the api. */
const montant3 = (page: Page) => page.evaluate(() => (window as unknown as Win).basecraft.rows.page('Commandes', { offset: 0, limit: 100 })
  .then((p) => p.rows.find((r) => r.values[0] === 3)?.values[2]));

async function setProp(page: Page, name: string, value: string) {
  await vis(page, `prop-${name}`).fill(value);
  await vis(page, `prop-${name}`).press('Enter');
}
/** Create › Formulaire on `source` (saved under its name, B1), then renamed `name` through the Navigation Pane. */
async function instantForm(page: Page, source: string, name: string) {
  await page.getByTestId(`nav-item-${source}`).click();
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
async function design(page: Page, kind: 'form' | 'report', name: string) {
  await page.getByTestId(`nav-item-${kind}-${name}`).click({ button: 'right' });
  await page.getByTestId('nav-menu-design').click();
  await expect(vis(page, 'designer')).toBeVisible();
}
/** « Ajouter une nouvelle action » of a block (`root` or an If branch `i.b`): `id` picked from its list. */
async function add(page: Page, key: string, id: string) {
  await page.getByTestId(`macro-add-${key}-toggle`).click();
  await page.getByTestId(`macro-add-${key}-option-${id}`).click();
}
/** The embedded macro saved into its design (Ctrl+S), its tab closed, then the design saved and closed. */
async function saveEmbedded(page: Page, owner: string, kind: 'form' | 'report', macroTab: string) {
  await page.keyboard.press('Control+s');
  await expect(page.getByTestId('modal')).toHaveCount(0);
  await expect(page.getByTestId(macroTab)).not.toContainText('•');
  await expect(page.getByTestId(`doc-tab-${kind}-${owner}`)).toContainText('•');
  await page.getByTestId(macroTab.replace('doc-tab-', 'doc-tab-close-')).click();
  await expect(page.getByTestId(macroTab)).toHaveCount(0);
  await page.getByTestId(`doc-tab-${kind}-${owner}`).click();
  await page.keyboard.press('Control+s');
  await expect(page.getByTestId(`doc-tab-${kind}-${owner}`)).not.toContainText('•');
  await page.getByTestId(`doc-tab-close-${kind}-${owner}`).click();
  await expect(page.getByTestId(`doc-tab-${kind}-${owner}`)).toHaveCount(0);
}
/** Step 4: FClients on Martin, « Commandes » clicked: FCommandes on Martin's orders 3 and 5 only (order 3: `first`). */
async function martinOrders(page: Page, first: RegExp) {
  await page.getByTestId('nav-item-form-FClients').dblclick();
  await expect(vis(page, 'form-ctl-Nom')).toHaveValue('Dupont');
  await vis(page, 'form-run').getByRole('button', { name: fr.datasheet.nav.next, exact: true }).click();
  await expect(vis(page, 'form-ctl-Nom')).toHaveValue('Martin');
  await vis(page, 'form-ctl-cmdCommandes').click();
  await expect(page.getByTestId('doc-tab-form-FCommandes')).toHaveAttribute('aria-selected', 'true');
  await expect(vis(page, 'nav-record-count')).toHaveText('2');
  await expect(vis(page, 'form-ctl-N°')).toHaveValue('3');
  await expect(vis(page, 'form-ctl-Montant')).toHaveValue(first);
  await vis(page, 'form-run').getByRole('button', { name: fr.datasheet.nav.next, exact: true }).click();
  await expect(vis(page, 'form-ctl-N°')).toHaveValue('5');
  await expect(vis(page, 'form-ctl-Montant')).toHaveValue(euros('0,10'));
  await vis(page, 'form-run').getByRole('button', { name: fr.datasheet.nav.prev, exact: true }).click();
  await expect(vis(page, 'form-ctl-N°')).toHaveValue('3');
}
/** The detail bands and Dupont's group footer as the active Print Preview draws them. */
async function preview(page: Page) {
  await page.getByTestId('nav-group-report').getByTestId(`nav-item-report-${REPORT}`).dblclick();
  await expect(page.locator('.doc:not([hidden])').getByTestId('preview-page-of')).toHaveText(/^Page 1 sur \d+$/);
  const bands = (await layoutFromDom(page)).pages.flatMap((p) => p.bands);
  await page.getByTestId(`doc-tab-close-report-${REPORT}`).click();
  const text = (b: DomLayout['pages'][number]['bands'][number]) => b.lines.map((l) => l[0]).join(' ');
  const footer = bands.filter((b) => b.section.startsWith('groupFooter') && text(b).includes('Dupont'));
  expect(footer).toHaveLength(1);
  return { details: bands.filter((b) => b.section === 'detail').map(text), dupontFooter: footer[0]!.lines };
}

test('recette B2: an embedded On Click opening a form through [Formulaires]!, a Before Update refusing a save, an On Format hiding lines, in disabled mode too', async () => {
  test.setTimeout(240_000);
  const base = seedBase('recette-b2', (db) => { seedSales(db); seedSalesRelation(db); seedReportsE2E(db); });

  let { app, page } = await launchApp({ args: [base], env: FR });
  try {
    // 1. Create › Formulaire on Clients and on Commandes, renamed FClients and FCommandes
    await instantForm(page, 'Clients', 'FClients');
    await instantForm(page, 'Commandes', 'FCommandes');
    expect(await names(page)).toEqual(['FClients', 'FCommandes']);

    // 2. FClients: a command button cmdCommandes in the Detail; its « Sur clic » « … »: OuvrirFormulaire FCommandes on [Formulaires]!
    await design(page, 'form', 'FClients');
    const di = (await getDef(page, 'form', 'FClients')).sections.findIndex((s) => s.kind === 'detail');
    await vis(page, 'sheet-tab-all').click();
    await vis(page, 'sheet-object').selectOption(`s:${di}`);
    await setProp(page, 'Height', '8');
    const detail = page.locator(`[data-section-body="${di}"]:visible`);
    const low = Math.max(...await Promise.all((await detail.locator('[data-testid^="ctl-"]').all()).map(async (c) => {
      const b = (await c.boundingBox())!; return b.y + b.height; })));
    await vis(page, 'ribbon-tab-formDesign').click();
    await vis(page, 'tool-commandButton').click();
    await detail.click({ position: { x: 40, y: low - (await detail.boundingBox())!.y + 30 } });
    await setProp(page, 'Name', 'cmdCommandes');
    await setProp(page, 'Caption', 'Commandes');
    await expect(vis(page, 'ctl-cmdCommandes')).toHaveText('Commandes');
    await vis(page, 'sheet-tab-event').click();
    await vis(page, 'prop-OnClick-build').click();
    const onClickTab = `doc-tab-macro-FClients : cmdCommandes : ${fr.prop.OnClick}`;
    await expect(page.getByTestId(onClickTab)).toHaveAttribute('aria-selected', 'true');
    await vis(page, 'macro-add-root').fill(fr.macro.action.OpenForm);
    await expect(vis(page, 'macro-item-0')).toContainText(fr.macro.action.OpenForm);
    await vis(page, 'macro-arg-0-FormName-input-toggle').click();
    await vis(page, 'macro-arg-0-FormName-input-option-FCommandes').click();
    await vis(page, 'macro-arg-0-WhereCondition-input').fill('[Client]=[Formulaires]![FClients]![N°]');
    await vis(page, 'macro-arg-0-WhereCondition-input').press('Enter');
    await saveEmbedded(page, 'FClients', 'form', onClickTab);
    const button = (await getDef(page, 'form', 'FClients')).sections.find((s) => s.kind === 'detail')!.controls.find((c) => c.name === 'cmdCommandes')!;
    expect(button.kind).toBe('commandButton');
    expect(button.props).toMatchObject({ Caption: 'Commandes', OnClick: { embedded: { formatVersion: '1.0', items: [
      { k: 'action', action: 'OpenForm', args: expect.objectContaining({ FormName: 'FCommandes', WhereCondition: '[Client] = [Forms]![FClients]![N°]' }) }] } } });

    // 3. FCommandes: the form's « Avant MAJ » « … »: Si [Montant]>1000 → ZoneMessage « Montant trop élevé », AnnulerÉvénement
    await design(page, 'form', 'FCommandes');
    await vis(page, 'sheet-object').selectOption('doc');
    await vis(page, 'sheet-tab-event').click();
    await vis(page, 'prop-BeforeUpdate-build').click();
    const beforeUpdateTab = `doc-tab-macro-FCommandes : ${fr.tabs.kind.form} : ${fr.prop.BeforeUpdate}`;
    await expect(page.getByTestId(beforeUpdateTab)).toHaveAttribute('aria-selected', 'true');
    await add(page, 'root', 'block-if');
    await vis(page, 'macro-if-0-0').fill('[Montant]>1000');
    await vis(page, 'macro-if-0-0').press('Enter');
    await add(page, '0.0', 'MessageBox');
    await vis(page, 'macro-arg-0.0.0-Message-input').fill('Montant trop élevé');
    await add(page, '0.0', 'CancelEvent');
    await expect(vis(page, 'macro-item-0.0.1')).toContainText(fr.macro.action.CancelEvent);
    await saveEmbedded(page, 'FCommandes', 'form', beforeUpdateTab);
    expect((await getDef(page, 'form', 'FCommandes')).props.BeforeUpdate).toEqual({ embedded: { formatVersion: '1.0', items: [
      { k: 'if', branches: [{ cond: '[Montant] > 1000', items: [
        { k: 'action', action: 'MessageBox', args: expect.objectContaining({ Message: 'Montant trop élevé' }) },
        { k: 'action', action: 'CancelEvent', args: {} }] }] }] } });

    // 4. FClients on Martin, « Commandes »: FCommandes shows Martin's two orders
    await martinOrders(page, euros('0,20'));

    // 5. 5000 refused by Before Update: the macro's message, the record still being edited, nothing written; 0,5 then saved
    await vis(page, 'form-ctl-Montant').click();
    await vis(page, 'form-ctl-Montant').fill('5000');
    await vis(page, 'form-ctl-Montant').press('Shift+Enter');
    await expect(page.getByTestId('macro-msgbox-text')).toHaveText('Montant trop élevé');
    await page.getByTestId('macro-msgbox-ok').click();
    await expect(page.getByTestId('macro-msgbox')).toHaveCount(0);
    await expect(vis(page, 'form-dirty')).toBeVisible();
    expect(await montant3(page)).toBe(0.2);
    await vis(page, 'form-ctl-Montant').press('Escape');
    await expect(vis(page, 'form-dirty')).toHaveCount(0);
    expect(await montant3(page)).toBe(0.2);   // undone: still nothing written
    await vis(page, 'form-ctl-Montant').fill('0,5');
    await vis(page, 'form-ctl-Montant').press('Shift+Enter');
    await expect(vis(page, 'form-dirty')).toHaveCount(0);
    await expect(page.getByTestId('macro-msgbox')).toHaveCount(0);
    await expect.poll(() => montant3(page)).toBe(0.5);
    await page.getByTestId('doc-tab-close-form-FCommandes').click();
    await page.getByTestId('doc-tab-close-form-FClients').click();
    await expect(page.getByTestId('doc-tab-form-FClients')).toHaveCount(0);

    // 6. « Factures par client »: the Detail's « Au formatage » « … »: Si [Montant]<1 → DéfinirPropriété Detail Visible Non
    const before = await preview(page);
    expect(before.details).toHaveLength(75);
    await design(page, 'report', REPORT);
    await vis(page, 'sheet-object').selectOption(`s:${FACTURES_REPORT.sections.findIndex((s) => s.kind === 'detail')}`);
    await vis(page, 'sheet-tab-event').click();
    await vis(page, 'prop-OnFormat-build').click();
    const onFormatTab = page.locator(`[data-testid^="doc-tab-macro-${REPORT} : "][data-testid$=" : ${fr.prop.OnFormat}"]`);
    await expect(onFormatTab).toHaveAttribute('aria-selected', 'true');
    await add(page, 'root', 'block-if');
    await vis(page, 'macro-if-0-0').fill('[Montant]<1');
    await vis(page, 'macro-if-0-0').press('Enter');
    await add(page, '0.0', 'SetProperty');
    await vis(page, 'macro-arg-0.0.0-ControlName-input').fill('Detail');
    await vis(page, 'macro-arg-0.0.0-Property-input').selectOption('visible');
    await vis(page, 'macro-arg-0.0.0-Value-input').fill('Non');
    await saveEmbedded(page, REPORT, 'report', (await onFormatTab.getAttribute('data-testid'))!);
    const detailDef = (await getDef(page, 'report', REPORT)).sections.find((s) => s.kind === 'detail')!;
    expect(detailDef.props.OnFormat).toEqual({ embedded: { formatVersion: '1.0', items: [
      { k: 'if', branches: [{ cond: '[Montant] < 1', items: [
        { k: 'action', action: 'SetProperty', args: expect.objectContaining({ ControlName: 'Detail', Property: 'visible', Value: 'Non' }) }] }] }] } });
    const after = await preview(page);
    expect(after.details).toHaveLength(13);   // Martin's 10, Durand's 12,35 / 7,65 / 100,00
    for (const hidden of ['0,10', '0,01', '0,99']) expect(after.details.filter((l) => l.includes(hidden))).toEqual([]);
    expect(after.dupontFooter).toEqual(before.dupontFooter);   // the totals still count every row
  } finally {
    await app.close();
  }

  // 7. the same file, nothing trusted, a fresh user data folder: the security bar; step 4's click still works (OpenForm is safe)
  const userDataDir = mkdtempSync(join(tmpdir(), 'basecraft-recette-b2-'));
  ({ app, page } = await launchApp({ args: [base], env: FR, userDataDir, untrusted: true }));
  try {
    await expect(page.getByTestId('banner-content')).toBeVisible();
    expect(await montant3(page)).toBe(0.5);   // step 5's save, in the file
    await martinOrders(page, euros('0,50'));
    await expect(page.getByTestId('macro-failed')).toHaveCount(0);
  } finally {
    await app.close();
  }
});
