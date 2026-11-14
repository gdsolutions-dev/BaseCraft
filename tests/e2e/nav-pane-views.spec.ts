import { test, expect, type Page } from '@playwright/test';
import { createTable } from '../../src/main/db/schema';
import { saveObject } from '../../src/main/db/objects';
import { clients } from '../../src/shared/test-fixtures';
import { launchApp, seedBase, seedForm } from './helpers';

const FR = { BASECRAFT_REGION: 'fr-FR' };
const seed = (name: string) => seedBase(name, (db) => {
  createTable(db, clients);
  saveObject(db, 'query', 'QClients', { formatVersion: '1.0', sql: 'SELECT * FROM Clients' }, null);
  seedForm(db, 'FClients', { formatVersion: '1.0', recordSource: { kind: 'table', name: 'Clients' }, props: { Width: 5500 }, sections: [{ kind: 'detail', height: 8000, props: {}, controls: [] }] });
});
const header = (page: Page, id: string) => page.getByTestId('nav-head-menu').click().then(() => page.getByTestId(`nav-pane-menu-${id}`).click());
/** The pane's background menu, opened on the empty part of the list. */
async function background(page: Page, ...ids: string[]) {
  const box = (await page.locator('.nav-list').boundingBox())!;
  await page.locator('.nav-list').click({ button: 'right', position: { x: box.width / 2, y: box.height - 4 } });
  for (const id of ids) await page.getByTestId(`nav-pane-menu-${id}`).click();
}
const names = (page: Page) => page.locator('[data-testid^="nav-item-"]').evaluateAll((l) => l.map((e) => e.getAttribute('data-testid')));

test('navigation pane views: category kept, filter, sort, View By, search bar, show all groups, search', async () => {
  const base = seed('nav-views');
  let { app, page, userDataDir } = await launchApp({ args: [base], env: FR });
  try {
    // (a)
    await expect(page.getByTestId('nav-head-menu')).toHaveText("Type d'objet");
    await header(page, 'cat-created');
    await expect(page.getByTestId('nav-group-today')).toBeVisible();
    await expect(page.getByTestId('nav-count-today')).toHaveText('3');
    await expect(page.getByTestId('nav-group-today')).toContainText("Aujourd'hui");
    await app.close();
    ({ app, page } = await launchApp({ args: [base], env: FR, userDataDir }));
    await expect(page.getByTestId('nav-head-menu')).toHaveText('Date de création');
    await header(page, 'cat-type');
    // (b)
    await header(page, 'group-query');
    await expect(page.getByTestId('nav-head-menu')).toHaveText('Requêtes');
    await expect(page.locator('details.ngroup')).toHaveCount(1);
    await header(page, 'all');
    await expect(page.locator('details.ngroup')).toHaveCount(6);
    // (c) the date category puts the three in one group
    await header(page, 'cat-created');
    await background(page, 'sort', 'sort-sort-name');
    await background(page, 'sort', 'sort-sort-asc');
    expect(await names(page)).toEqual(['nav-item-Clients', 'nav-item-form-FClients', 'nav-item-query-QClients']); // all three sit in « Aujourd'hui »
    await background(page, 'sort', 'sort-sort-desc');
    expect((await names(page)).reverse()).toEqual(['nav-item-Clients', 'nav-item-form-FClients', 'nav-item-query-QClients']);
    // (d)
    await background(page, 'viewBy', 'viewBy-view-details');
    await expect(page.getByTestId('nav-pane')).toHaveAttribute('data-view', 'details');
    await expect(page.getByTestId('nav-item-Clients').locator('.nitem-created')).not.toBeEmpty();
    await page.getByTestId('nav-head-menu').click({ button: 'right' }); // the header gives the same menu
    await page.getByTestId('nav-pane-menu-viewBy').click();
    await page.getByTestId('nav-pane-menu-viewBy-view-icon').click();
    await expect(page.getByTestId('nav-pane')).toHaveAttribute('data-view', 'icon');
    // (f) a collapsed group re-opens
    await header(page, 'cat-type');
    await page.getByTestId('nav-group-query').locator('summary').click();
    await expect(page.getByTestId('nav-group-query')).not.toHaveAttribute('open', '');
    await background(page, 'showAllGroups');
    await expect(page.getByTestId('nav-group-query')).toHaveAttribute('open', '');
    // (g)
    await page.getByTestId('nav-search').fill('QCli');
    await expect(page.getByTestId('nav-count-query')).toHaveText('1');
    await expect(page.getByTestId('nav-count-table')).toHaveText('0');
    await page.getByTestId('nav-search').fill('zzz');
    await expect(page.locator('.nav-empty')).toBeVisible();
    await page.getByTestId('nav-search').fill('');
    // (e)
    await background(page, 'searchBar');
    await expect(page.getByTestId('nav-search')).toHaveCount(0);
  } finally { await app.close(); }
});

test('navigation pane views: a read-only base changes the category but forgets it on reopen', async () => {
  const base = seed('nav-views-ro');
  const a = await launchApp({ args: [base], env: FR });
  const { app, page, userDataDir } = await launchApp({ args: [base], env: FR });
  try {
    await expect(page.getByTestId('banner-readonly')).toBeVisible();
    await header(page, 'cat-created');
    await expect(page.getByTestId('nav-group-today')).toBeVisible();
    await app.close();
    await a.app.close();
    const b = await launchApp({ args: [base], env: FR, userDataDir });
    try { await expect(b.page.getByTestId('nav-head-menu')).toHaveText("Type d'objet"); } finally { await b.app.close(); }
  } finally { await app.close().catch(() => undefined); await a.app.close().catch(() => undefined); }
});

test('navigation options dialog: untick a group, single click opens, kept on reopen', async () => {
  const base = seed('nav-options');
  let { app, page, userDataDir } = await launchApp({ args: [base], env: FR });
  try {
    await expect(page.getByTestId('nav-group-macro')).toBeVisible();
    await background(page, 'options');
    await expect(page.getByTestId('nav-options')).toBeVisible();
    await expect(page.getByTestId('nav-options-show-system')).toBeDisabled();
    await expect(page.getByTestId('nav-options-add-group')).toBeDisabled();
    await page.getByTestId('nav-options-group-macro').uncheck();
    await page.getByTestId('nav-options-single').check();
    await page.getByTestId('nav-options-ok').click();
    await expect(page.getByTestId('nav-group-macro')).toHaveCount(0);
    await page.getByTestId('nav-item-Clients').click();
    await expect(page.getByTestId('doc-tab-Clients')).toBeVisible();
    await app.close();
    ({ app, page } = await launchApp({ args: [base], env: FR, userDataDir }));
    await expect(page.getByTestId('nav-group-table')).toBeVisible();
    await expect(page.getByTestId('nav-group-macro')).toHaveCount(0);
  } finally { await app.close(); }
});

test('single-click mode: a double-click runs a macro once', async () => {
  const base = seedBase('nav-single-macro', (db) => {
    const r = saveObject(db, 'macro', 'MBip', { formatVersion: '1.0', items: [{ k: 'action', action: 'MessageBox', args: { Message: 'Bip bip', Beep: 'no', Type: 'information' } }] }, null);
    if (!r.ok) throw new Error(r.reason);
  });
  const { app, page } = await launchApp({ args: [base], env: FR });
  try {
    await background(page, 'options');
    await page.getByTestId('nav-options-single').check();
    await page.getByTestId('nav-options-ok').click();
    await page.getByTestId('nav-item-macro-MBip').dblclick();
    await expect(page.getByTestId('macro-msgbox-text')).toHaveText('Bip bip');
    await page.getByTestId('macro-msgbox-ok').click();
    await page.waitForTimeout(500); // a second run would show its box again
    await expect(page.getByTestId('macro-msgbox-text')).toHaveCount(0);
  } finally { await app.close(); }
});

test('navigation options dialog: OK on a read-only base shows the read-only error', async () => {
  const base = seed('nav-options-ro');
  const a = await launchApp({ args: [base], env: FR });
  const { app, page } = await launchApp({ args: [base], env: FR });
  try {
    await expect(page.getByTestId('banner-readonly')).toBeVisible();
    await background(page, 'options');
    await page.getByTestId('nav-options-group-macro').uncheck();
    await page.getByTestId('nav-options-ok').click();
    await expect(page.getByTestId('modal')).toContainText('lecture seule');
    await page.getByTestId('modal-btn-ok').click();
    await expect(page.getByTestId('nav-group-macro')).toBeVisible();
  } finally { await app.close().catch(() => undefined); await a.app.close().catch(() => undefined); }
});

test('navigation options dialog: add a category and a group, names keep their ampersand', async () => {
  const base = seed('nav-options-edit');
  const { app, page } = await launchApp({ args: [base], env: FR });
  const ask = async (name: string) => { await page.getByTestId('nav-options-ask-input').fill(name); await page.getByTestId('nav-options-ask-ok').click(); };
  try {
    await background(page, 'options');
    await expect(page.getByTestId('nav-options-add-group')).toBeDisabled(); // built-in category: computed groups
    await page.getByTestId('nav-options-add-category').click();
    await ask('Ventes');
    await expect(page.getByTestId('nav-options-add-group')).toBeEnabled();
    await page.getByTestId('nav-options-add-group').click();
    await ask('Clients');
    await page.getByTestId('nav-options-add-group').click();
    await page.getByTestId('nav-options-ask-input').fill('clients');
    await expect(page.getByTestId('nav-options-ask-error')).toHaveText('Ce nom existe déjà.');
    await ask('R&D');
    await expect(page.getByTestId('nav-options-groups')).toContainText('R&D');
    await expect(page.getByTestId('nav-options')).toContainText('Groupes pour « Ventes »');
    await page.getByTestId('nav-options-ok').click();
    await page.getByTestId('nav-head-menu').click();
    await expect(page.locator('[data-testid^="nav-pane-menu-cat-"]', { hasText: 'Ventes' })).toBeVisible();
    await page.keyboard.press('Escape');
    await background(page, 'category');
    await expect(page.locator('[data-testid^="nav-pane-menu-category-cat-"]', { hasText: 'Ventes' })).toBeVisible();
  } finally { await app.close(); }
});

test('add to group, hide in this group, hidden attribute, rename follows', async () => {
  const base = seed('nav-groups');
  const { app, page } = await launchApp({ args: [base], env: FR });
  const ask = async (name: string) => { await page.getByTestId('modal-input').fill(name); await page.getByTestId('modal-btn-ok').click(); };
  const menuOn = async (id: string) => { await page.getByTestId(id).click({ button: 'right' }); };
  try {
    await expect(page.getByTestId('nav-item-form-FClients')).toBeVisible();
    await background(page, 'options');
    await page.getByTestId('nav-options-add-category').click();
    await page.getByTestId('nav-options-ask-input').fill('Ventes');
    await page.getByTestId('nav-options-ask-ok').click();
    await page.getByTestId('nav-options-add-group').click();
    await page.getByTestId('nav-options-ask-input').fill('Saisie');
    await page.getByTestId('nav-options-ask-ok').click();
    await page.getByTestId('nav-options-ok').click();
    await page.getByTestId('nav-head-menu').click();
    await page.locator('[data-testid^="nav-pane-menu-cat-"]', { hasText: 'Ventes' }).click();
    // Add to group, then New Group (duplicate refused)
    await menuOn('nav-item-form-FClients');
    await page.getByTestId('nav-menu-addToGroup').click();
    await page.getByTestId('nav-menu-addToGroup-newGroup').click();
    await page.getByTestId('modal-input').fill('saisie');
    await page.getByTestId('modal-btn-ok').click();
    await expect(page.getByTestId('modal')).toContainText('Ce nom existe déjà.');
    await ask('Fiches');
    await expect(page.locator('details.ngroup', { hasText: 'Fiches' }).getByTestId('nav-item-form-FClients')).toBeVisible();
    // renaming the object from the pane: its group entry follows
    await menuOn('nav-item-form-FClients');
    await page.getByTestId('nav-menu-rename').click();
    await ask('FVentes');
    await expect(page.locator('details.ngroup', { hasText: 'Fiches' }).getByTestId('nav-item-form-FVentes')).toBeVisible();
    // Delete in a custom group removes the shortcut only
    await page.locator('details.ngroup', { hasText: 'Fiches' }).getByTestId('nav-item-form-FVentes').click({ button: 'right' });
    await page.getByTestId('nav-menu-delete').click();
    await expect(page.locator('details.ngroup', { hasText: 'Fiches' }).getByTestId('nav-item-form-FVentes')).toHaveCount(0);
    await expect(page.getByTestId('nav-item-form-FVentes')).toHaveCount(1); // still in Unassigned
    // Hide in this group, then shown dimmed with Show hidden objects, then unhide
    await menuOn('nav-item-form-FVentes');
    await page.getByTestId('nav-menu-hide').click();
    await expect(page.getByTestId('nav-item-form-FVentes')).toHaveCount(0);
    await background(page, 'options');
    await page.getByTestId('nav-options-show-hidden').check();
    await page.getByTestId('nav-options-ok').click();
    await expect(page.getByTestId('nav-item-form-FVentes')).toHaveClass(/is-hidden/);
    await menuOn('nav-item-form-FVentes');
    await page.getByTestId('nav-menu-unhide').click();
    await expect(page.getByTestId('nav-item-form-FVentes')).not.toHaveClass(/is-hidden/);
    // Hidden attribute: leaves every category once Show hidden objects is off
    await menuOn('nav-item-form-FVentes');
    await page.getByTestId('nav-menu-properties').click();
    await page.getByTestId('object-properties-hidden').check();
    await page.getByTestId('object-properties-ok').click();
    await expect(page.getByTestId('nav-item-form-FVentes')).toHaveClass(/is-hidden/);
    await background(page, 'options');
    await page.getByTestId('nav-options-show-hidden').uncheck();
    await page.getByTestId('nav-options-ok').click();
    await expect(page.getByTestId('nav-item-form-FVentes')).toHaveCount(0);
    await header(page, 'cat-type');
    await expect(page.getByTestId('nav-item-form-FVentes')).toHaveCount(0);
  } finally { await app.close(); }
});
