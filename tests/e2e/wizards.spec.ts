import { test, expect, type Page } from '@playwright/test';
import { groupLevels } from '../../src/renderer/report/design/grouping-model';
import { seedSales } from '../../src/main/query/test-db';
import { emptyFormDoc } from '../../src/renderer/form/form-def';
import { inFile, launchApp, pickView, seedBase, seedForm, seedSalesE2E } from './helpers';

// H1-H3: Create > Query Wizard, Form Wizard, Report Wizard on the sales base (Clients, Commandes).
const SHOTS = process.env.WIZARD_SHOTS ?? '';
const shot = async (page: Page, name: string) => { if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png` }); };
const def = (path: string, kind: string, name: string) =>
  JSON.parse(inFile<{ definition: string }>(path, `SELECT definition FROM bc_objects WHERE kind = '${kind}' AND name = '${name}'`)[0]!.definition);

async function start(page: Page, cmd: string) {
  await page.getByTestId('ribbon-tab-create').click();
  await page.getByTestId(cmd).click();
}
const next = (page: Page) => page.getByTestId('wiz-next').click();
const finish = (page: Page) => page.getByTestId('wiz-finish').click();
async function pick(page: Page, from: string, names: string[], id = 'wiz') {
  await page.getByTestId(`${id}-avail`).selectOption(names);
  await page.getByTestId(`${id}-add`).click();
  void from;
}

test('Query Wizard: Simple (summary), Find Duplicates, Find Unmatched and Crosstab save a query that opens', async () => {
  const path = seedSalesE2E('assistants-req');
  const { app, page } = await launchApp({ args: [path], env: { BASECRAFT_REGION: 'fr-FR' } });
  try {
    // Simple, summary: Sum of Montant per day (a number field such as Client is summed, not grouped, as in Access), plus the record count
    await start(page, 'cmd-queryWizard');
    await shot(page, 'query-1-choose');
    await page.getByTestId('wiz-kind-simple').check();
    await next(page);
    await page.getByTestId('wiz-source').selectOption('Commandes');
    await pick(page, 'Commandes', ['Le', 'Montant']);
    await shot(page, 'query-2-fields');
    await next(page);
    await page.getByTestId('wiz-summary').check();
    await page.getByTestId('wiz-agg-Montant-Sum').check();
    await page.getByTestId('wiz-count').check();
    await shot(page, 'query-3-summary');
    await next(page);
    await page.getByTestId('wiz-name').fill('Total par client');
    await shot(page, 'query-4-name');
    await finish(page);
    await expect(page.getByTestId('doc-tab-query-Total par client')).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator('[aria-modal="true"]')).toHaveCount(0);
    expect(def(path, 'query', 'Total par client').sql).toBe('SELECT [Le], Sum([Montant]) AS [SumOfMontant], Count(*) AS [CountOfCommandes]\nFROM [Commandes]\nGROUP BY [Le];');

    // Find Duplicates on Clients.Ville (the two Lyon spellings are equal for Access's comparison), shown with Nom
    await start(page, 'cmd-queryWizard');
    await page.getByTestId('wiz-kind-duplicates').check();
    await next(page);
    await page.getByTestId('wiz-source').selectOption('Clients');
    await pick(page, 'Clients', ['Ville']);
    await next(page);
    await pick(page, 'Clients', ['Nom'], 'wiz-extra');
    await next(page);
    await page.getByTestId('wiz-name').fill('Villes en double');
    await page.getByTestId('wiz-open-design').check();
    await finish(page);
    await expect(page.getByTestId('doc-tab-query-Villes en double')).toHaveAttribute('aria-selected', 'true');
    expect(def(path, 'query', 'Villes en double').sql).toContain('HAVING Count(*) > 1) AS [Dup] ON [Clients].[Ville] = [Dup].[Ville]');
    await shot(page, 'query-5-duplicates-design');

    // Find Unmatched: the clients without an order
    await start(page, 'cmd-queryWizard');
    await page.getByTestId('wiz-kind-unmatched').check();
    await next(page);
    await page.getByTestId('wiz-source').selectOption('Clients');
    await page.getByTestId('wiz-source-b').selectOption('Commandes');
    await page.getByTestId('wiz-key-b').selectOption('Client');
    await next(page);
    await pick(page, 'Clients', ['Nom']);
    await next(page);
    await page.getByTestId('wiz-name').fill('Clients sans commande');
    await finish(page);
    await expect(page.getByTestId('doc-tab-query-Clients sans commande')).toHaveAttribute('aria-selected', 'true');
    expect(def(path, 'query', 'Clients sans commande').sql).toBe('SELECT [Clients].[Nom]\nFROM [Clients] LEFT JOIN [Commandes] ON [Clients].[N°] = [Commandes].[Client]\nWHERE [Commandes].[Client] Is Null;');

    // Crosstab: Montant summed by Client (rows) and by day (columns)
    await start(page, 'cmd-queryWizard');
    await page.getByTestId('wiz-kind-crosstab').check();
    await next(page);
    await page.getByTestId('wiz-source').selectOption('Commandes');
    await pick(page, 'Commandes', ['Client']);
    await next(page);
    await page.getByTestId('wiz-column').selectOption('Le');
    await page.getByTestId('wiz-value').selectOption('Montant');
    await next(page);
    await page.getByTestId('wiz-name').fill('Croisée');
    await finish(page);
    await expect(page.getByTestId('doc-tab-query-Croisée')).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator('[aria-modal="true"]')).toHaveCount(0);
    expect(def(path, 'query', 'Croisée').sql).toContain('TRANSFORM Sum([Montant]) AS [SumOfMontant]');
    await shot(page, 'query-6-crosstab');
  } finally {
    await app.close();
  }
});

test('Form Wizard: the picked fields in a tabular layout; Datasheet opens as a datasheet; a taken name is refused', async () => {
  const path = seedSalesE2E('assistants-form');
  const { app, page } = await launchApp({ args: [path], env: { BASECRAFT_REGION: 'fr-FR' } });
  try {
    await start(page, 'cmd-formWizard');
    await page.getByTestId('wiz-source').selectOption('Clients');
    await pick(page, 'Clients', ['Nom', 'Ville']);
    await next(page);
    await page.getByTestId('wiz-layout-tabular').check();
    await shot(page, 'form-1-layout');
    await next(page);
    await page.getByTestId('wiz-name').fill('Liste clients');
    await finish(page);
    await expect(page.getByTestId('doc-tab-form-Liste clients')).toHaveAttribute('aria-selected', 'true');
    const d = def(path, 'form', 'Liste clients');
    expect(d.props.DefaultView).toBe('continuous');
    expect(d.sections[1].controls.map((c: { props: { ControlSource: string } }) => c.props.ControlSource)).toEqual(['Nom', 'Ville']);
    await shot(page, 'form-2-tabular');

    await start(page, 'cmd-formWizard');
    await pick(page, 'Clients', ['Nom']);
    await next(page);
    await page.getByTestId('wiz-layout-datasheet').check();
    await next(page);
    await page.getByTestId('wiz-name').fill('Liste clients');
    await expect(page.getByTestId('wiz-name-error')).toBeVisible();
    await expect(page.getByTestId('wiz-finish')).toBeDisabled();
    await page.getByTestId('wiz-name').fill('Feuille clients');
    await finish(page);
    await expect(page.getByTestId('doc-tab-form-Feuille clients')).toHaveAttribute('aria-selected', 'true');
    expect(def(path, 'form', 'Feuille clients').props.DefaultView).toBe('datasheet');
  } finally {
    await app.close();
  }
});

test('Report Wizard: a group, a sort, a total and the landscape orientation, shown in Print Preview', async () => {
  const path = seedSalesE2E('assistants-etat');
  const { app, page } = await launchApp({ args: [path], env: { BASECRAFT_REGION: 'fr-FR' } });
  try {
    await start(page, 'cmd-reportWizard');
    await page.getByTestId('wiz-source').selectOption('Commandes');
    await page.getByTestId('wiz-addall').click();
    await shot(page, 'report-1-fields');
    await next(page);
    await pick(page, 'Commandes', ['Client'], 'wiz-groups');
    await shot(page, 'report-2-groups');
    await next(page);
    await page.getByTestId('wiz-sort-0').selectOption('Le');
    await page.getByTestId('wiz-sortdir-0').click();
    await next(page);
    await page.getByTestId('wiz-total-Montant-Sum').check();
    await page.getByTestId('wiz-orient-landscape').check();
    await shot(page, 'report-3-summary');
    await next(page);
    await page.getByTestId('wiz-name').fill('Commandes par client');
    await finish(page);
    await expect(page.getByTestId('doc-tab-report-Commandes par client')).toHaveAttribute('aria-selected', 'true');
    const cur = page.locator('.doc:not([hidden])');
    await expect(cur.getByTestId('preview-page-of')).toHaveText(/^Page 1 sur \d+$/);
    const first = cur.locator('.bc-page').first();
    await expect(first).toContainText('Commandes par client');
    await expect(first).toContainText('110,49');   // the report total
    await shot(page, 'report-4-preview');
    const d = def(path, 'report', 'Commandes par client');
    expect(d.props.pageSetup.orientation).toBe('landscape');
    expect(groupLevels(d).map((g) => [g.expression, g.order])).toEqual([['Client', 'asc'], ['Le', 'desc']]);
  } finally {
    await app.close();
  }
});

test('Label Wizard: Avery L7160 on Clients, three labels across in Print Preview', async () => {
  const path = seedSalesE2E('assistants-etiquettes');
  const { app, page } = await launchApp({ args: [path], env: { BASECRAFT_REGION: 'fr-FR' } });
  try {
    await start(page, 'cmd-labels');
    await page.getByTestId('wiz-source').selectOption('Clients');
    await expect(page.getByTestId('wiz-label-sheet')).toHaveValue('L7160');
    await shot(page, 'label-1-sheet');
    await next(page);
    await page.getByTestId('wiz-label-insert-0').selectOption('Nom');
    await page.getByTestId('wiz-label-line-0').press('End');
    await page.getByTestId('wiz-label-line-0').pressSequentially(' (');
    await page.getByTestId('wiz-label-insert-0').selectOption('Ville');
    await page.getByTestId('wiz-label-line-0').pressSequentially(')');
    await page.getByTestId('wiz-label-addline').click();
    await page.getByTestId('wiz-label-line-1').fill('Client "n°" [N°]');
    await shot(page, 'label-2-lines');
    await next(page);
    await page.getByTestId('wiz-label-sort').selectOption('Nom');
    await next(page);
    await page.getByTestId('wiz-name').fill('Etiquettes clients');
    await finish(page);
    await expect(page.getByTestId('doc-tab-report-Etiquettes clients')).toHaveAttribute('aria-selected', 'true');
    const cur = page.locator('.doc:not([hidden])');
    const first = cur.locator('.bc-page').first();
    await expect(first).toContainText('Dupont (Lyon)');
    await expect(first).toContainText('Durand (Paris)');
    await expect(first).toContainText('Éric (Lyôn)');
    await expect(first).toContainText('Client "n°" 1');
    await expect(first).toContainText('Martin (LYON)');
    const top = async (text: string) => (await first.getByText(text, { exact: true }).boundingBox())!;
    const [a, b, c, d] = [await top('Dupont (Lyon)'), await top('Durand (Paris)'), await top('Éric (Lyôn)'), await top('Martin (LYON)')];   // É sorts as E
    expect(b.y).toBe(a.y);
    expect(c.y).toBe(a.y);
    expect(a.x).toBeLessThan(b.x);
    expect(b.x).toBeLessThan(c.x);
    expect(d.y).toBeGreaterThan(a.y);   // Across, then Down: the fourth label starts the second row
    expect(d.x).toBe(a.x);
    await shot(page, 'label-3-preview');
    const r = def(path, 'report', 'Etiquettes clients');
    expect(r.props.columns).toMatchObject({ count: 3, across: true });
    expect(r.sections.find((s: { kind: string }) => s.kind === 'detail').controls[0].props.ControlSource).toBe('=[Nom] & " (" & [Ville] & ")"');
  } finally {
    await app.close();
  }
});

test('More Forms: Multiple Items and Datasheet over the selected table, a Modal Dialog whose buttons close it, Split Form listed disabled', async () => {
  const path = seedSalesE2E('assistants-plus-formulaires');
  const { app, page } = await launchApp({ args: [path], env: { BASECRAFT_REGION: 'fr-FR' } });
  try {
    await page.getByTestId('nav-item-Clients').click();
    await start(page, 'cmd-moreForms');
    await expect(page.getByTestId('choice-split')).toBeDisabled();
    await expect(page.getByTestId('choice-menu')).toContainText('Formulaire double affichage');
    await page.getByTestId('choice-multiple').click();
    await expect(page.getByTestId('doc-tab-form-Clients')).toHaveAttribute('aria-selected', 'true');
    const cur = page.locator('.doc:not([hidden])');
    await expect(cur.getByTestId('form-ctl-Nom').first()).toBeVisible();
    await expect(cur.getByTestId('form-ctl-Nom')).toHaveCount(5);   // continuous: a row per client and the new record
    await shot(page, 'moreforms-1-multiple');
    await page.getByTestId('doc-tab-close-form-Clients').click();
    await page.getByTestId('modal-btn-no').click();

    await page.getByTestId('cmd-moreForms').click();
    await page.getByTestId('choice-datasheet').click();
    await expect(page.getByTestId('doc-tab-form-Clients')).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator('.doc:not([hidden])').getByTestId('form-datasheet')).toBeVisible();   // the Datasheet default view
    await page.getByTestId('doc-tab-close-form-Clients').click();
    await page.getByTestId('modal-btn-no').click();

    await page.getByTestId('cmd-moreForms').click();
    await page.getByTestId('choice-modal').click();
    await expect(page.locator('[data-testid^="doc-tab-form-"][aria-selected="true"]')).toHaveCount(1);
    await shot(page, 'moreforms-2-modal-design');
    await pickView(page, 'viewForm');
    await expect(page.getByTestId('form-ctl-Commande1')).toHaveText('OK');
    await shot(page, 'moreforms-3-modal');
    await expect(page.getByTestId('form-ctl-Commande2')).toHaveText('Annuler');
    await page.getByTestId('form-ctl-Commande2').click();   // the form is new and unsaved: closing asks, as any close does
    await page.getByTestId('modal-btn-no').click();
    await expect(page.locator('[data-testid^="doc-tab-form-"]')).toHaveCount(0);
  } finally {
    await app.close();
  }
});

test('Navigation › Horizontal Tabs: a navigation form with a tab per form of the base; the vertical layouts are listed disabled', async () => {
  const path = seedBase('assistants-navigation', (db) => {
    seedSales(db);
    for (const name of ['Fiche', 'Liste']) {
      const f = emptyFormDoc({ kind: 'table', name: 'Clients' });
      seedForm(db, name, { ...f, sections: f.sections.map((s) => (s.kind === 'detail' ? { ...s, controls: [{ kind: 'textBox', name: `Nom${name}`, left: 1418, top: 113, width: 2268, height: 340, props: { ControlSource: 'Nom' } }] } : s)) });
    }
  });
  const { app, page } = await launchApp({ args: [path], env: { BASECRAFT_REGION: 'fr-FR' } });
  try {
    await start(page, 'cmd-navigationForm');
    for (const id of ['verticalLeft', 'verticalRight', 'horizontalVertical']) await expect(page.getByTestId(`choice-${id}`)).toBeDisabled();
    await page.getByTestId('choice-horizontal').click();
    await expect(page.getByTestId('doc-tab-form-Formulaire de navigation')).toHaveAttribute('aria-selected', 'true');
    const nav = page.getByTestId('ctl-Navigation1');
    await expect(nav).toContainText('Fiche');
    await expect(nav).toContainText('Liste');
    await shot(page, 'navigation-1-design');
    await pickView(page, 'viewForm');
    await expect(page.getByTestId('form-nav-tab-Navigation1-0')).toHaveText('Fiche');
    await expect(page.getByTestId('form-nav-tab-Navigation1-1')).toHaveText('Liste');
    await expect(page.getByTestId('form-ctl-NomFiche')).toHaveValue('Dupont');
    await page.getByTestId('form-nav-tab-Navigation1-1').click();
    await expect(page.getByTestId('form-ctl-NomListe')).toHaveValue('Dupont');
    await shot(page, 'navigation-2-form');
  } finally {
    await app.close();
  }
});
