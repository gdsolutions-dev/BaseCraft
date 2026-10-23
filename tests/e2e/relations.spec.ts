// Fenêtre Relations : création par glisser-déposer, lignes 1–∞, disposition enregistrée, onglet Création de relation, lecture seule.
import { test, expect, type Locator, type Page } from '@playwright/test';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { saveRelation, saveRelationsLayout } from '../../src/main/db/relations';
import { createTable } from '../../src/main/db/schema';
import { insertRow } from '../../src/main/db/write-layer';
import { localeInfo } from '../../src/shared/locale-format';
import { clients, f, t } from '../../src/shared/test-fixtures';
import { launchApp, seedBase } from './helpers';

const fr = JSON.parse(readFileSync(join(__dirname, '../../src/shared/i18n/fr.json'), 'utf8'));
const FR = { BASECRAFT_REGION: 'fr-FR' };
const commandes = t('Commandes', [f('N°', 'autoNumber'), f('Client', 'number', { numberSize: 'longInteger' }), f('Montant', 'currency')]);
const lignes = t('Lignes', [f('N°', 'autoNumber'), f('Commande', 'number', { numberSize: 'longInteger' })]);

const fill = (s: string, p: Record<string, string | number>) => s.replace(/\{\{(\w+)\}\}/g, (_m, k: string) => String(p[k]));
const layoutOf = (page: Page) => page.evaluate(() => (window as any).basecraft.relations.layout()) as Promise<{ tables: Record<string, { x: number; y: number }> }>;
const relationsOf = (page: Page) => page.evaluate(() => (window as any).basecraft.relations.list()) as Promise<{ name: string; joinType: number }[]>;
const field = (page: Page, table: string, name: string) => page.getByTestId(`rel-field-${table}-${name}`);

async function drag(page: Page, from: Locator, to: Locator) {
  const a = (await from.boundingBox())!, b = (await to.boundingBox())!;
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
  await page.mouse.down();
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 6 });
  await page.mouse.up();
}

/** Database Tools → Relationships, where Access puts it (Table Design offers it too). */
async function openRelations(page: Page) {
  await page.getByTestId('ribbon-tab-databaseTools').click();
  await expect(page.getByTestId('ribbon-tab-databaseTools')).toHaveText(fr.ribbon.tab.databaseTools);
  await page.getByTestId('cmd-relationships').click();
  await expect(page.getByTestId('doc-tab-window-relations')).toHaveText(fr.relations.title);
  await expect(page.getByTestId('ribbon-tab-relationshipDesign')).toHaveAttribute('aria-selected', 'true');
}

test('drag a field onto another table: relation with integrity, line 1–∞, layout and relation kept after reopening', async () => {
  const base = await seedBase('relations', async (db) => {
    createTable(db, clients);
    createTable(db, commandes);
    createTable(db, lignes);
    for (const n of [7, 8]) await insertRow(db, lignes, { Commande: n }, localeInfo('fr-FR'));
  });
  let { app, page } = await launchApp({ args: [base], env: FR });
  try {
    await openRelations(page);
    // Relationship Design: Access's groups and commands, in Access's order
    expect(await page.locator('.rbody [data-testid^="ribbon-group-"]').evaluateAll((els) => els.map((e) => e.getAttribute('data-testid'))))
      .toEqual(['ribbon-group-tools', 'ribbon-group-relationships']);
    expect(await page.locator('.rbody [data-testid^="cmd-"]').evaluateAll((els) => els.map((e) => e.getAttribute('data-testid'))))
      .toEqual(['cmd-editRelationships', 'cmd-clearLayout', 'cmd-relationshipReport', 'cmd-addTables', 'cmd-hideTable', 'cmd-directRelationships', 'cmd-allRelationships', 'cmd-closeRelationships']);
    await expect(page.getByTestId('status-mode')).toHaveText(fr.status.ready);
    await expect(page.getByTestId('status-view-design')).toBeDisabled();

    // no layout and no relation yet: Add Tables opens by itself, as Show Table does in Access
    await expect(page.getByTestId('addtables-dialog')).toBeVisible();
    await page.getByTestId('addtables-item-Clients').check();
    await page.getByTestId('addtables-item-Commandes').check();
    await page.getByTestId('addtables-add').click();
    await expect(page.getByTestId('rel-table-Clients')).toHaveAccessibleName(fill(fr.relations.table, { name: 'Clients' }));
    await expect(field(page, 'Clients', 'N°')).toContainText(fr.relations.key); // the key icon is named
    await expect(page.getByTestId('relations-list')).toHaveText(fr.relations.none);

    await drag(page, field(page, 'Clients', 'N°'), field(page, 'Commandes', 'Client'));
    await expect(page.getByTestId('relation-dialog')).toBeVisible();
    await expect(page.getByTestId('relation-parent')).toHaveValue('Clients');
    await expect(page.getByTestId('relation-child')).toHaveValue('Commandes');
    await expect(page.getByTestId('relation-pf-0')).toHaveValue('N°');
    await expect(page.getByTestId('relation-cf-0')).toHaveValue('Client');
    await expect(page.getByTestId('relation-cascadeDelete')).toBeDisabled();
    await page.getByTestId('relation-enforce').check();
    await expect(page.getByTestId('relation-cascadeDelete')).toBeEnabled();
    await page.getByTestId('relation-ok').click();
    await expect(page.getByTestId('relation-dialog')).toHaveCount(0);
    const line = page.getByTestId('rel-line-ClientsCommandes');
    await expect(page.getByTestId('rel-line-ClientsCommandes-one')).toHaveText('1');
    await expect(page.getByTestId('rel-line-ClientsCommandes-many')).toHaveText('∞');
    const described = fill(fr.relations.line_enforced, { parent: 'Clients', parentFields: 'N°', child: 'Commandes', childFields: 'Client' });
    await expect(line).toHaveAccessibleName(described);
    await expect(page.getByTestId('relations-list')).toContainText(described);

    // the same fields again, dragged the other way: the unique side is still the parent; refused, naming the relation (Task 9's duplicate)
    await drag(page, field(page, 'Commandes', 'Client'), field(page, 'Clients', 'N°'));
    await expect(page.getByTestId('relation-parent')).toHaveValue('Clients');
    await expect(page.getByTestId('relation-cf-0')).toHaveValue('Client');
    await page.getByTestId('relation-ok').click();
    await expect(page.getByTestId('relation-error')).toHaveText(fill(fr.relations.error.duplicate, { relation: 'ClientsCommandes' }));
    await page.getByTestId('relation-cancel').click();

    // orphan rows: integrity refused, with their number
    await page.getByTestId('cmd-addTables').click();
    await expect(page.getByTestId('addtables-item-Clients')).toHaveCount(0); // only the tables not shown
    await page.getByTestId('addtables-item-Lignes').check();
    await page.getByTestId('addtables-add').click();
    await drag(page, field(page, 'Commandes', 'N°'), field(page, 'Lignes', 'Commande'));
    // a row filled on one side only is refused under that row, never paired with another row
    await page.getByTestId('relation-pf-1').selectOption('Montant');
    await page.getByTestId('relation-ok').click();
    await expect(page.getByTestId('relation-pair-error-1')).toHaveText(fr.relations.dialog.incomplete);
    await expect(page.getByTestId('relation-pair-error-0')).toHaveCount(0);
    await expect(page.getByTestId('relation-dialog')).toBeVisible();
    await page.getByTestId('relation-pf-1').selectOption('');
    await expect(page.getByTestId('relation-pair-error-1')).toHaveCount(0);
    await page.getByTestId('relation-enforce').check();
    await page.getByTestId('relation-ok').click();
    await expect(page.getByTestId('relation-error')).toHaveText(fill(fr.relations.error.violations_other, { count: 2, child: 'Lignes', parent: 'Commandes' }));
    await page.getByTestId('relation-cancel').click();

    // moved with the mouse by its title, and with the keyboard: saved at the end of each move
    const head = page.getByTestId('rel-table-Commandes').locator('.rel-box-head');
    const before = (await layoutOf(page)).tables.Commandes;
    const h = (await head.boundingBox())!;
    await page.mouse.move(h.x + 40, h.y + 10);
    await page.mouse.down();
    await page.mouse.move(h.x + 100, h.y + 40, { steps: 5 });
    await page.mouse.up();
    await expect.poll(async () => (await layoutOf(page)).tables.Commandes).toEqual({ x: before.x + 60, y: before.y + 30 });
    const clientsAt = (await layoutOf(page)).tables.Clients;
    await page.getByTestId('rel-table-Clients').focus();
    await page.keyboard.press('ArrowDown');
    await expect.poll(async () => (await layoutOf(page)).tables.Clients).toEqual({ x: clientsAt.x, y: clientsAt.y + 10 });

    await app.close();
    ({ app, page } = await launchApp({ args: [base], env: FR }));
    await openRelations(page);
    await expect(page.getByTestId('addtables-dialog')).toHaveCount(0);
    await expect(page.getByTestId('rel-table-Commandes')).toHaveCSS('left', `${before.x + 60}px`);
    await expect(page.getByTestId('rel-table-Clients')).toHaveCSS('top', `${clientsAt.y + 10}px`);
    await expect(page.getByTestId('rel-line-ClientsCommandes-many')).toHaveText('∞');

    // Hide Table and Direct Relationships act on the selected table; All Relationships on every relation
    await expect(page.getByTestId('cmd-hideTable')).toBeDisabled();
    await page.getByTestId('rel-table-Commandes').locator('.rel-box-head').click();
    await page.getByTestId('cmd-hideTable').click();
    await expect(page.getByTestId('rel-table-Commandes')).toHaveCount(0);
    await expect(page.getByTestId('rel-line-ClientsCommandes')).toHaveCount(0);
    await page.getByTestId('rel-table-Clients').locator('.rel-box-head').click();
    await page.getByTestId('cmd-directRelationships').click();
    await expect(page.getByTestId('rel-table-Commandes')).toBeVisible();
    await page.getByTestId('rel-table-Commandes').focus();
    await page.keyboard.press('Delete'); // Delete on a table hides it, as in Access
    await expect(page.getByTestId('rel-table-Commandes')).toHaveCount(0);
    await page.getByTestId('cmd-allRelationships').click();
    await expect(page.getByTestId('rel-table-Commandes')).toBeVisible();

    // a click selects the line, Edit Relationships edits it; a double click too
    await page.getByTestId('rel-line-ClientsCommandes').click();
    await page.getByTestId('cmd-editRelationships').click();
    await expect(page.getByTestId('relation-parent')).toBeDisabled(); // an existing relation keeps its tables
    await expect(page.getByTestId('relation-enforce')).toBeChecked();
    await page.getByTestId('relation-join-2').check();
    await page.getByTestId('relation-ok').click();
    await expect(page.getByTestId('relation-dialog')).toHaveCount(0);
    expect((await relationsOf(page)).map((r) => [r.name, r.joinType])).toEqual([['ClientsCommandes', 2]]);
    await page.getByTestId('rel-line-ClientsCommandes').dblclick();
    await expect(page.getByTestId('relation-join-2')).toBeChecked();
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('relation-dialog')).toHaveCount(0);

    // Delete deletes the selected line after confirmation
    await page.getByTestId('rel-line-ClientsCommandes').click();
    await page.keyboard.press('Delete');
    await expect(page.getByTestId('modal')).toContainText(fr.relations.deleteMessage);
    await page.getByTestId('modal-btn-yes').click();
    await expect(page.getByTestId('rel-line-ClientsCommandes')).toHaveCount(0);
    await expect(page.getByTestId('relations-list')).toHaveText(fr.relations.none);
    expect(await relationsOf(page)).toEqual([]);

    // Clear Layout empties the window, after confirmation; Close closes it and Table Design comes back
    await page.getByTestId('cmd-clearLayout').click();
    await page.getByTestId('modal-btn-yes').click();
    await expect(page.locator('.rel-box')).toHaveCount(0);
    await expect.poll(async () => (await layoutOf(page)).tables).toEqual({});
    await page.getByTestId('cmd-closeRelationships').click();
    await expect(page.getByTestId('doc-tab-window-relations')).toHaveCount(0);
    await expect(page.getByTestId('ribbon-tab-relationshipDesign')).toHaveCount(0); // its contextual tab leaves with it
  } finally {
    await app.close();
  }
});

test('relations without a layout: the window opens empty, what it shows is saved, Clear Layout lasts', async () => {
  const base = seedBase('relations-nolayout', (db) => {
    createTable(db, clients);
    createTable(db, commandes);
    createTable(db, t('Autre', [f('N°', 'autoNumber')]));
    saveRelation(db, { name: '', parentTable: 'Clients', parentFields: ['N°'], childTable: 'Commandes', childFields: ['Client'],
      enforce: true, cascadeUpdate: false, cascadeDelete: false, joinType: 1 }, null, localeInfo('fr-FR'));
  });
  const { app, page } = await launchApp({ args: [base], env: FR });
  try {
    // relations but no layout: an empty window, as in Access (Show Table opens by itself only without relations)
    await openRelations(page);
    await expect(page.getByTestId('relations-item-ClientsCommandes')).toBeVisible();
    await expect(page.locator('.rel-box')).toHaveCount(0);
    await expect(page.getByTestId('addtables-dialog')).toHaveCount(0);

    // what the window shows is the stored layout: a table change elsewhere keeps the boxes
    await page.getByTestId('cmd-allRelationships').click();
    await expect(page.locator('.rel-box')).toHaveCount(2);
    await expect.poll(async () => Object.keys((await layoutOf(page)).tables).sort()).toEqual(['Clients', 'Commandes']);
    await page.getByTestId('nav-item-Autre').click({ button: 'right' });
    await page.getByTestId('nav-menu-rename').click();
    await page.getByTestId('modal-input').fill('Divers');
    await page.getByTestId('modal-btn-ok').click();
    await expect(page.getByTestId('nav-item-Divers')).toBeVisible();
    await page.getByTestId('doc-tab-window-relations').click();
    await expect(page.locator('.rel-box')).toHaveCount(2);

    // Clear Layout lasts after the window is reopened
    await page.getByTestId('cmd-clearLayout').click();
    await page.getByTestId('modal-btn-yes').click();
    await expect(page.locator('.rel-box')).toHaveCount(0);
    await page.getByTestId('cmd-closeRelationships').click();
    await openRelations(page);
    await expect(page.getByTestId('relations-item-ClientsCommandes')).toBeVisible();
    await expect(page.locator('.rel-box')).toHaveCount(0);
    expect((await layoutOf(page)).tables).toEqual({});
  } finally {
    await app.close();
  }
});

test('a table imported while the window is open is offered by Add Tables (the window reloads its tables)', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'basecraft-relimport-'));
  const csv = join(dir, 'ZzrvImport.csv');
  writeFileSync(csv, 'Code,Libellé\n1,Un\n2,Deux\n', 'utf8');
  const base = seedBase('relations-import', (db) => { createTable(db, clients); createTable(db, commandes); });
  const { app, page } = await launchApp({ args: [base], env: { ...FR, BASECRAFT_E2E_IMPORT_PATH: csv } });
  try {
    await openRelations(page);
    await page.getByTestId('addtables-close').click();
    await page.getByTestId('ribbon-tab-externalData').click();
    await page.getByTestId('cmd-importText').click();
    await page.getByTestId('import-browse').click();
    await page.getByTestId('import-btn-next').click();
    await page.getByTestId('import-btn-finish').click();
    await page.getByTestId('import-btn-close').click();
    await expect(page.getByTestId('nav-item-ZzrvImport')).toBeVisible();

    await page.getByTestId('doc-tab-window-relations').click();
    await page.getByTestId('cmd-addTables').click();
    await expect(page.getByTestId('addtables-item-ZzrvImport')).toBeVisible();
  } finally {
    await app.close();
  }
});

test('read-only base: the layout moves but is not saved; dragging a field creates nothing', async () => {
  const base = seedBase('relations-ro', (db) => {
    createTable(db, clients);
    createTable(db, commandes);
    saveRelation(db, { name: '', parentTable: 'Clients', parentFields: ['N°'], childTable: 'Commandes', childFields: ['Client'],
      enforce: true, cascadeUpdate: false, cascadeDelete: false, joinType: 1 }, null, localeInfo('fr-FR'));
    saveRelationsLayout(db, { tables: { Clients: { x: 20, y: 20 }, Commandes: { x: 400, y: 60 } } });
  });
  const a = await launchApp({ args: [base] });
  const b = await launchApp({ args: [base], env: FR });
  try {
    const page = b.page;
    await expect(page.getByTestId('banner-readonly')).toBeVisible();
    await openRelations(page);
    await expect(page.getByTestId('rel-line-ClientsCommandes-many')).toHaveText('∞');
    await expect(page.getByTestId('cmd-editRelationships')).toBeDisabled();
    await expect(page.getByTestId('relations-edit-ClientsCommandes')).toBeDisabled();
    await expect(page.getByTestId('relations-delete-ClientsCommandes')).toBeDisabled();

    await drag(page, field(page, 'Clients', 'N°'), field(page, 'Commandes', 'Montant'));
    await expect(page.getByTestId('relation-dialog')).toHaveCount(0);
    await page.getByTestId('rel-line-ClientsCommandes').dblclick();
    await page.getByTestId('rel-line-ClientsCommandes').press('Delete');
    await expect(page.getByTestId('relation-dialog')).toHaveCount(0);
    await expect(page.getByTestId('modal')).toHaveCount(0);

    await page.getByTestId('rel-table-Commandes').focus();
    await page.keyboard.press('ArrowRight');
    await expect(page.getByTestId('rel-table-Commandes')).toHaveCSS('left', '410px');
    expect((await layoutOf(page)).tables).toEqual({ Clients: { x: 20, y: 20 }, Commandes: { x: 400, y: 60 } });
    expect((await relationsOf(page)).map((r) => r.name)).toEqual(['ClientsCommandes']);
  } finally {
    await b.app.close();
    await a.app.close();
  }
});
