// Recette du lot A4 : saisie maître/détail Clients → Commandes, tout par l'interface (région fr-FR). Formulaires instantanés
// (Créer › Formulaire), Mode par défaut Feuille de données, Liste des champs, contrôle calculé, sous-formulaire et liens proposés,
// saisie liée, règle de validation refusée, Limite à liste refusée, base fermée puis rouverte, suppression du père refusée (enregistrements
// liés), Commandes ouvert du volet en Feuille de données (et rouvert sans changer d'affichage), interface en anglais.
import { test, expect, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { saveRelation } from '../../src/main/db/relations';
import { createTable } from '../../src/main/db/schema';
import type { BasecraftApi } from '../../src/shared/api';
import { localeInfo } from '../../src/shared/locale-format';
import { f, t } from '../../src/shared/test-fixtures';
import { saveObject } from '../../src/main/db/objects';
import { formGrid, launchApp, seedBase } from './helpers';

const fr = JSON.parse(readFileSync(join(__dirname, '../../src/shared/i18n/fr.json'), 'utf8'));
const fill = (s: string, p: Record<string, string | number>) => s.replace(/\{\{(\w+)\}\}/g, (_m, k: string) => String(p[k]));
const FR = { BASECRAFT_REGION: 'fr-FR' };
const MESSAGE = 'Le montant doit être positif';

const clients = t('Clients', [f('N°', 'autoNumber'), f('Nom', 'shortText', { size: 50 }),
  f('Ville', 'shortText', { size: 30, lookup: { kind: 'values', values: ['Paris', 'Lyon', 'Nantes'], limitToList: true } })]);
const commandes = t('Commandes', [f('N°', 'autoNumber'), f('Client', 'number', { numberSize: 'longInteger' }), f('Date', 'dateTime'),
  f('Montant', 'currency', { validationRule: '>0', validationText: MESSAGE })]);

/** The shown element: the other tabs' views stay mounted, hidden, with the same test ids. */
const vis = (page: Page, id: string) => page.locator(`[data-testid="${id}"]:visible`);
const rows = (page: Page, table: string) => page.evaluate((tb) => (window as unknown as { basecraft: BasecraftApi }).basecraft.rows.page(tb, { offset: 0, limit: 100 })
  .then((p) => p.rows.map((r) => r.values)), table);

// the subform's datasheet: N°, Client, Date, Montant, each 3 cm (AutoForm's Number, Currency and Date width) = 1701 twips
const sub = (page: Page) => formGrid(page, vis(page, 'form-ctl-Commandes'), [1701, 1701, 1701, 1701].map((tw) => tw / 15));
const master = (page: Page) => {
  const nav = vis(page, 'form-run').first().locator(':scope > .recnav');
  return { count: nav.getByTestId('nav-record-count'), input: nav.getByTestId('nav-record-input'), add: nav.getByTestId('nav-new'),
    button: (k: string) => nav.getByRole('button', { name: fr.datasheet.nav[k] }) };
};

/** Create › Form on `source`, picked in the source list (the Navigation Pane's selection is preselected). */
async function autoForm(page: Page, source: string) {
  await vis(page, `nav-item-${source}`).click();
  await vis(page, 'ribbon-tab-create').click();
  await vis(page, 'cmd-createForm').click();
  await expect(vis(page, 'source-picker-list')).toHaveValue(`table:${source}`);
  await vis(page, 'source-picker-ok').click();
  await expect(vis(page, `doc-tab-form-${source}`)).toHaveAttribute('aria-selected', 'true');
  await expect(vis(page, `nav-item-form-${source}`)).toBeVisible();
}
async function setProp(page: Page, name: string, value: string) {
  await vis(page, `prop-${name}`).fill(value);
  await vis(page, `prop-${name}`).press('Enter');
}
async function save(page: Page, tab: string) {
  await page.keyboard.press('Control+s');
  await expect(vis(page, tab)).not.toContainText('•');
}

test('recette A4: master/detail entry Clients → Commandes', async () => {
  const base = seedBase('recette-a4', (db) => {
    createTable(db, clients);
    createTable(db, commandes);
    saveRelation(db, { name: '', parentTable: 'Clients', parentFields: ['N°'], childTable: 'Commandes', childFields: ['Client'],
      enforce: true, cascadeUpdate: false, cascadeDelete: false, joinType: 1 }, null, localeInfo('fr-FR'));
    db.exec(`INSERT INTO "Clients"("Nom", "Ville") VALUES ('Dupont', 'Paris'), ('Martin', 'Lyon')`);
  });
  const { app, page } = await launchApp({ args: [base], env: FR });
  try {
    const ctl = (n: string) => vis(page, `form-ctl-${n}`);

    // 2. Create › Form on Commandes: a columnar form in Form view; in Design view, Default View = Datasheet
    await autoForm(page, 'Commandes');
    await expect(ctl('Montant')).toBeVisible();
    await expect(vis(page, 'form-run').locator('label', { hasText: 'Montant:' })).toBeVisible();
    await vis(page, 'status-view-design').click();
    await vis(page, 'sheet-object').selectOption('doc');
    await vis(page, 'prop-DefaultView').selectOption('datasheet');
    await save(page, 'doc-tab-form-Commandes');

    // 3. Create › Form on Clients; Design view: Ville removed, then put back from the Field List (a combo box, its value list);
    //    a calculated text box; the Subform tool in the Detail, Source Object Commandes: N° / Client proposed
    await autoForm(page, 'Clients');
    await expect(ctl('Nom')).toHaveValue('Dupont');
    await vis(page, 'status-view-design').click();
    await vis(page, 'ctl-Ville').click();
    await page.keyboard.press('Delete');
    await expect(vis(page, 'ctl-Ville')).toHaveCount(0);
    await vis(page, 'ribbon-tab-formDesign').click();
    await vis(page, 'cmd-addExistingFields').click();
    await vis(page, 'field-Ville').dblclick();
    await expect(vis(page, 'ctl-Ville')).toBeVisible();
    const detail = page.locator('[data-section-body="1"]:visible');
    await vis(page, 'sheet-object').selectOption('s:1');
    await setProp(page, 'Height', '10');   // room for the new controls, below Ville
    // each new control dropped under the lowest one, at Ville's left edge (its label then fits on the left) or its label's
    const below = async (id: string, edge: string) => {
      const d = (await detail.boundingBox())!, low = (await vis(page, id).boundingBox())!, x = (await vis(page, edge).boundingBox())!;
      await detail.click({ position: { x: x.x - d.x + 2, y: low.y + low.height - d.y + 15 } });
    };
    await vis(page, 'tool-textBox').click();
    await below('ctl-Ville', 'ctl-Ville');
    await setProp(page, 'Name', 'Majuscules');
    await setProp(page, 'ControlSource', '=Majuscule([Nom])');
    await expect(vis(page, 'ctl-Majuscules')).toHaveText('=Majuscule([Nom])');
    await vis(page, 'tool-subform').click();
    await below('ctl-Majuscules', 'ctl-Ville_Étiquette');
    await setProp(page, 'Name', 'Commandes');
    await setProp(page, 'SourceObject', 'Commandes');
    await expect(vis(page, 'prop-LinkMasterFields')).toHaveValue('N°');
    await expect(vis(page, 'prop-LinkChildFields')).toHaveValue('Client');
    await expect(vis(page, 'form-subform-linked')).toHaveText(fill(fr.form.subform.linked, { master: 'N°', child: 'Client' }));
    await setProp(page, 'Width', '14');
    await setProp(page, 'Height', '5');
    await save(page, 'doc-tab-form-Clients');

    // 4. Form view: client 1, the calculated control; two orders in the subform; -3 refused, its message under the cell; Escape
    const s = sub(page);
    const m = master(page);
    await vis(page, 'cmd-viewForm').click();
    await expect(ctl('Nom')).toHaveValue('Dupont');
    await expect(ctl('Majuscules')).toHaveValue('DUPONT');
    await expect(page.getByRole('combobox', { name: 'Ville:' })).toHaveValue('Paris');   // the Field List made it a combo box
    await expect(s.count).toHaveText('0');
    for (const row of [0, 1]) {
      await s.click(2, row);
      await s.type('21/10/2026');
      await s.click(3, row);
      await s.type('12,50');
      await ctl('Nom').click();   // leaving the subform saves its row
      await expect.poll(() => rows(page, 'Commandes')).toHaveLength(row + 1);
    }
    expect(await rows(page, 'Commandes')).toEqual([[1, 1, '2026-10-21 00:00:00', 12.5], [2, 1, '2026-10-21 00:00:00', 12.5]]);
    await s.click(3, 1);
    await s.type('-3');
    await expect(vis(page, 'modal')).toContainText(fill(fr.datasheet.fieldError, { field: 'Montant', message: MESSAGE }));
    await vis(page, 'modal-btn-ok').click();
    await expect(s.error).toHaveText(fill(fr.datasheet.fieldError, { field: 'Montant', message: MESSAGE }));
    await page.keyboard.press('Escape');
    await expect(s.cell(3, 1)).toHaveText('12,5');   // Glide's accessible cell: the edit text (the canvas shows 12,50 €)
    await expect(s.error).toHaveCount(0);
    expect((await rows(page, 'Commandes')).map((r) => r[3])).toEqual([12.5, 12.5]);

    // 5. the next client (no order), then back: both orders; a new client: Rome refused by Limit To List, then Nantes; one order
    await m.button('next').click();
    await expect(ctl('Nom')).toHaveValue('Martin');
    await expect(ctl('Majuscules')).toHaveValue('MARTIN');
    await expect(s.count).toHaveText('0');
    await m.button('prev').click();
    await expect(ctl('Nom')).toHaveValue('Dupont');
    await expect(s.count).toHaveText('2');
    await m.add.click();
    await expect(m.input).toHaveValue('3');   // the new record is current: its controls take an entry
    await expect(s.count).toHaveText('0');
    await expect(ctl('Nom')).toBeEditable();
    await ctl('Nom').fill('Durand');
    await ctl('Ville').click();
    await page.keyboard.type('Rome');
    await page.keyboard.press('Tab');
    await expect(vis(page, 'modal')).toContainText(fill(fr.datasheet.fieldError, { field: 'Ville', message: fr.fieldError.notInList }));
    await vis(page, 'modal-btn-ok').click();
    await expect(ctl('Ville')).toBeFocused();
    await page.keyboard.press('Control+A');
    await page.keyboard.type('Nantes');
    await page.keyboard.press('Enter');
    await expect(ctl('Ville')).toHaveValue('Nantes');
    await expect(ctl('Majuscules')).toHaveValue('DURAND');
    await s.at(3, 0);
    await expect.poll(() => rows(page, 'Clients')).toEqual([[1, 'Dupont', 'Paris'], [2, 'Martin', 'Lyon'], [3, 'Durand', 'Nantes']]);
    await expect(m.count).toHaveText('3');
    await expect(s.frame.getByTestId('nav-new')).toBeEnabled();   // the subform now allows additions
    await s.click(3, 0);
    await s.type('40');
    await ctl('Nom').click();
    await expect.poll(() => rows(page, 'Commandes')).toHaveLength(3);
    expect((await rows(page, 'Commandes')).map((r) => [r[1], r[3]])).toEqual([[1, 12.5], [1, 12.5], [3, 40]]);

    // 6. File › Close, then the recent base: the data, the forms and their links are intact
    await vis(page, 'ribbon-tab-file').click();
    await vis(page, 'bs-close').click();
    await vis(page, 'bs-recent-0').click();
    await expect(vis(page, 'nav-item-form-Clients')).toBeVisible();
    await expect(vis(page, 'nav-item-form-Commandes')).toBeVisible();
    await vis(page, 'nav-item-form-Clients').dblclick();
    await expect(ctl('Nom')).toHaveValue('Dupont');
    await expect(ctl('Majuscules')).toHaveValue('DUPONT');
    await expect(s.count).toHaveText('2');
    await m.button('last').click();
    await expect(ctl('Nom')).toHaveValue('Durand');
    await expect(s.count).toHaveText('1');
    await expect(s.cell(3, 0)).toHaveText('40');
    expect((await rows(page, 'Commandes')).map((r) => r[1])).toEqual([1, 1, 3]);
    // Durand has an order (relation enforced, no cascade): Delete Record is refused with the related-records message, nothing deleted
    await vis(page, 'ribbon-tab-home').click();
    await vis(page, 'cmd-deleteRecord').click();
    await vis(page, 'modal-btn-yes').click();
    await expect(vis(page, 'modal')).toContainText(fill(fr.datasheet.related, { table: 'Commandes' }));
    await vis(page, 'modal-btn-ok').click();
    await expect(ctl('Nom')).toHaveValue('Durand');
    expect(await rows(page, 'Clients')).toHaveLength(3);
    // Commandes opened from the Navigation Pane: its Default View, Datasheet; opened again, it stays so (only its tab is activated)
    await vis(page, 'nav-item-form-Commandes').dblclick();
    await expect(vis(page, 'form-datasheet')).toBeVisible();
    await vis(page, 'doc-tab-form-Clients').click();
    await vis(page, 'nav-item-form-Commandes').dblclick();
    await expect(vis(page, 'doc-tab-form-Commandes')).toHaveAttribute('aria-selected', 'true');
    await expect(vis(page, 'form-datasheet')).toBeVisible();
    await expect(vis(page, 'status-view-datasheet')).toHaveAttribute('aria-pressed', 'true');
    await vis(page, 'doc-tab-form-Clients').click();

    // 7. English interface: the form shows; in Design view the calculated Control Source is in its English form
    await vis(page, 'ribbon-tab-file').click();
    await vis(page, 'bs-options').click();
    await vis(page, 'opt-lang').selectOption('en');
    await vis(page, 'bs-back').click();
    await expect(ctl('Majuscules')).toHaveValue('DURAND');
    await expect(vis(page, 'form-run').first().locator('label', { hasText: 'Nom:' })).toBeVisible();
    await vis(page, 'status-view-design').click();
    await vis(page, 'ctl-Majuscules').click();
    await expect(vis(page, 'prop-ControlSource')).toHaveValue('=UCase([Nom])');
    await expect(vis(page, 'ctl-Majuscules')).toHaveText('=UCase([Nom])');
  } finally {
    await app.close();
  }
});

test('Create › Form: Cancel creates nothing; a query (A3) gives a form named after it; an unreadable query is refused with its message, no form', async () => {
  const base = seedBase('auto-form-requete', (db) => {
    createTable(db, clients);
    db.exec(`INSERT INTO "Clients"("Nom", "Ville") VALUES ('Dupont', 'Paris')`);
    for (const [name, sql] of [['Liste', 'SELECT [Nom], [Ville] FROM [Clients];'], ['Cassée', 'SELECT * FROM [Absente];']]) {
      const r = saveObject(db, 'query', name!, { formatVersion: '1.0', sql }, null);
      if (!r.ok) throw new Error(r.reason);
    }
  });
  const { app, page } = await launchApp({ args: [base], env: FR });
  const forms = () => page.evaluate(() => (window as unknown as { basecraft: BasecraftApi }).basecraft.objects.list('form').then((l) => l.map((o) => o.name)));
  try {
    await vis(page, 'ribbon-tab-create').click();
    await vis(page, 'cmd-createForm').click();
    await expect(vis(page, 'source-picker-list').locator('option')).toHaveText(['Clients', 'Cassée', 'Liste']);   // tables, then queries
    await vis(page, 'source-picker-cancel').click();
    await expect(vis(page, 'modal')).toHaveCount(0);

    await vis(page, 'cmd-createForm').click();
    await vis(page, 'source-picker-list').selectOption('query:Cassée');
    await vis(page, 'source-picker-ok').click();
    await expect(vis(page, 'modal')).toBeVisible();
    await vis(page, 'modal-btn-ok').click();
    await expect(page.locator('[data-testid^="doc-tab-form-"]')).toHaveCount(0);
    expect(await forms()).toEqual([]);

    await vis(page, 'cmd-createForm').click();
    await vis(page, 'source-picker-list').selectOption('query:Liste');
    await vis(page, 'source-picker-ok').click();
    await expect(vis(page, 'doc-tab-form-Liste')).toHaveAttribute('aria-selected', 'true');
    await expect(vis(page, 'form-ctl-Nom')).toHaveValue('Dupont');
    expect(await forms()).toEqual(['Liste']);
    // a single-table query: the form is editable, the entry written to the table
    await vis(page, 'form-ctl-Nom').fill('Dupond');
    await page.keyboard.press('Shift+Enter');
    await expect(vis(page, 'doc-tab-form-Liste')).not.toContainText('•');
    expect(await rows(page, 'Clients')).toEqual([[1, 'Dupond', 'Paris']]);
  } finally {
    await app.close();
  }
});
