import { test, expect, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createTable } from '../../src/main/db/schema';
import type { BasecraftApi } from '../../src/shared/api';
import { clients } from '../../src/shared/test-fixtures';
import { launchApp, seedBase } from './helpers';

const fr = JSON.parse(readFileSync(join(__dirname, '../../src/shared/i18n/fr.json'), 'utf8'));
/** The top-level menu: its items (test ids without the prefix) with '|' for each separator. */
const menuLayout = (page: Page) => page.getByTestId('nav-menu').evaluate((m) =>
  [...m.children].map((e) => (e.getAttribute('role') === 'separator' ? '|' : (e.querySelector('[role="menuitem"]') ?? e).getAttribute('data-testid')!.replace('nav-menu-', ''))));

test('C6: a table\'s context menu — Access order, access keys, placeholders, keyboard, Open, Design View, Import, Properties', async () => {
  const base = seedBase('menu-volet', (db) => createTable(db, clients));
  const { app, page } = await launchApp({ args: [base], env: { BASECRAFT_REGION: 'fr-FR' } });
  try {
    const item = page.getByTestId('nav-item-Clients');
    await item.click({ button: 'right' });
    expect(await menuLayout(page)).toEqual(['open', 'design', '|', 'import', 'export', '|', 'rename', 'hide', 'delete', '|', 'cut', 'copy', 'paste', '|', 'properties']);
    await expect(page.getByTestId('nav-menu')).toHaveAttribute('role', 'menu');
    await expect(page.getByTestId('nav-menu-open')).toHaveText('Ouvrir');
    await expect(page.getByTestId('nav-menu-open').locator('u')).toHaveText('O'); // access key underlined
    await expect(page.getByTestId('nav-menu-properties')).toHaveText('Propriétés de la table');
    // a placeholder: disabled but reachable, its tooltip names the batch, activating it does nothing
    const hide = page.getByTestId('nav-menu-hide');
    await expect(hide).toHaveAttribute('aria-disabled', 'true');
    await expect(hide).toHaveAttribute('title', fr.ribbon.planned.later);
    await expect(page.getByTestId('nav-menu-cut')).toBeEnabled(); // A6: Cut is live
    await hide.click({ force: true });
    await expect(page.getByTestId('nav-menu')).toBeVisible();

    // keyboard: the first item has the focus, arrows move (placeholders included), Escape closes and gives the focus back
    await page.getByTestId('nav-menu-open').focus();
    await page.keyboard.press('ArrowDown');
    await expect(page.getByTestId('nav-menu-design')).toBeFocused();
    await page.keyboard.press('End');
    await expect(page.getByTestId('nav-menu-properties')).toBeFocused();
    await page.keyboard.press('ArrowUp');
    await expect(page.getByTestId('nav-menu-copy')).toBeFocused(); // Paste is disabled (empty clipboard): skipped
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('nav-menu')).toHaveCount(0);
    await expect(item).toBeFocused();

    // Shift+F10 opens it on the selected item, focused on Open; Enter runs it
    await page.keyboard.press('Shift+F10');
    await expect(page.getByTestId('nav-menu-open')).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('doc-tab-Clients')).toBeVisible();
    await expect(page.getByTestId('ribbon-tab-tableFields')).toBeVisible(); // Datasheet view

    // an access key runs its item: d = Mode création
    await item.click({ button: 'right' });
    await page.keyboard.press('d');
    await expect(page.getByTestId('ribbon-tab-design')).toHaveAttribute('aria-selected', 'true');
    await page.getByTestId('doc-tab-close-Clients').click();

    // Import › Text File: the wizard with "Append to this table" preselected
    await item.click({ button: 'right' });
    await page.getByTestId('nav-menu-import').focus();
    await page.keyboard.press('ArrowRight');
    await expect(page.getByTestId('nav-menu-import-text')).toBeFocused();
    // ARIA: the item owns its submenu (aria-controls), its wrapper is presentational, access keys are not announced as shortcuts
    const sub = page.getByTestId('nav-menu-import-menu');
    await expect(sub).toHaveAttribute('role', 'menu');
    await expect(page.getByTestId('nav-menu-import')).toHaveAttribute('aria-controls', (await sub.getAttribute('id'))!);
    await expect(page.getByTestId('nav-menu-import')).toHaveAttribute('aria-expanded', 'true');
    await expect(page.getByTestId('nav-menu').locator('[aria-keyshortcuts]')).toHaveCount(0);
    expect(await page.getByTestId('nav-menu').evaluate((m) => [...m.children].filter((e) => !e.getAttribute('role')).length)).toBe(0);
    await expect(page.getByTestId('nav-menu-import-excel')).toBeEnabled(); // A6: Excel import is live
    await page.keyboard.press('ArrowLeft');
    await expect(page.getByTestId('nav-menu-import-text')).toHaveCount(0);
    await expect(page.getByTestId('nav-menu-import')).toBeFocused();
    await page.getByTestId('nav-menu-import').click();
    await page.getByTestId('nav-menu-import-text').click();
    await expect(page.getByTestId('import-wizard')).toBeVisible();
    await expect(page.getByTestId('import-dest-append')).toBeChecked();
    await expect(page.getByTestId('import-append-table')).toHaveValue('Clients');
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('import-wizard')).toHaveCount(0);

    // Properties: type, name, an editable description that persists
    await item.click({ button: 'right' });
    await page.getByTestId('nav-menu-properties').click();
    const dialog = page.getByTestId('object-properties');
    await expect(dialog.getByTestId('object-properties-type')).toHaveText('Table');
    await expect(dialog.getByTestId('object-properties-name')).toHaveText('Clients');
    await expect(dialog.getByTestId('object-properties-created')).toHaveCount(0); // a table keeps no dates
    await dialog.getByTestId('object-properties-description').fill('Nos clients');
    await dialog.getByTestId('object-properties-ok').click();
    await expect(dialog).toHaveCount(0);
    await expect(item).toHaveAttribute('title', 'Nos clients');
    await item.click({ button: 'right' });
    await page.keyboard.press('p');
    await expect(page.getByTestId('object-properties-description')).toHaveValue('Nos clients');
    await page.getByTestId('object-properties-cancel').click();
    expect(await page.evaluate(() => (window as unknown as { basecraft: BasecraftApi }).basecraft.tables.list()))
      .toEqual([{ name: 'Clients', description: 'Nos clients' }]);
  } finally {
    await app.close();
  }
});

test('C6: a query has its Open, Design View and SQL View (A3), a form gets its items from A4; Properties show the dates', async () => {
  const base = seedBase('menu-formulaire', (db) => createTable(db, clients));
  const { app, page } = await launchApp({ args: [base], env: { BASECRAFT_REGION: 'fr-FR' } });
  try {
    for (const kind of ['form', 'query'] as const) {
      expect(await page.evaluate((k) => (window as unknown as { basecraft: BasecraftApi }).basecraft.objects.save(k, 'Saisie',
        k === 'query' ? { formatVersion: '1.0', sql: 'SELECT * FROM [Clients];' } : { formatVersion: '1.0', sections: [] }, null), kind))
        .toEqual({ ok: true });
    }
    await page.reload();
    await page.waitForSelector('[data-testid="app-root"]', { state: 'attached' });
    const query = page.getByTestId('nav-item-query-Saisie');
    await query.click({ button: 'right' });
    expect(await menuLayout(page)).toEqual(['open', 'design', 'sqlView', '|', 'export', '|', 'rename', 'hide', 'delete', '|', 'cut', 'copy', 'paste', '|', 'properties']);
    await expect(page.getByTestId('nav-menu-properties')).toHaveText("Propriétés de l'objet");
    await expect(page.getByTestId('nav-menu-open')).toBeEnabled(); // A3: the query's datasheet
    await expect(page.getByTestId('nav-menu-design')).toBeEnabled(); // A3 Task 8: the design grid
    await page.keyboard.press('Escape');
    await query.dblclick(); // the query's datasheet (no parameters)
    await expect(page.getByTestId('doc-tab-query-Saisie')).toBeVisible();
    await expect(page.getByTestId('nav-record-count')).toHaveText('0');
    await page.getByTestId('doc-tab-close-query-Saisie').click();

    const item = page.getByTestId('nav-item-form-Saisie');
    await item.click({ button: 'right' });
    await expect(page.getByTestId('nav-menu-layout')).toHaveAttribute('title', fr.ribbon.planned.later); // Layout View: later (C11)
    await expect(page.getByTestId('nav-menu-layout')).toHaveText('Mode Page');
    expect(await menuLayout(page)).toEqual(['open', 'layout', 'design', '|', 'export', '|', 'rename', 'hide', 'delete', '|', 'cut', 'copy', 'paste', '|', 'properties']);
    await expect(page.getByTestId('nav-menu-open')).toBeEnabled();
    await expect(page.getByTestId('nav-menu-properties')).toHaveText('Afficher les propriétés');
    await page.getByTestId('nav-menu-properties').click();
    await expect(page.getByTestId('object-properties-type')).toHaveText('Formulaire');
    await expect(page.getByTestId('object-properties-created')).not.toBeEmpty();
    await expect(page.getByTestId('object-properties-modified')).not.toBeEmpty();
    await page.getByTestId('object-properties-description').fill('Saisie des clients');
    await page.getByTestId('object-properties-ok').click();
    await expect(item).toHaveAttribute('title', 'Saisie des clients');
  } finally {
    await app.close();
  }
});

test('C6: the menu of the last item of a short window stays inside it, submenu too', async () => {
  const names = Array.from({ length: 12 }, (_, i) => `T${String(i + 1).padStart(2, '0')}`);
  const base = seedBase('menu-bas', (db) => { for (const name of names) createTable(db, { ...clients, name }); });
  const { app, page } = await launchApp({ args: [base], env: { BASECRAFT_REGION: 'fr-FR' } });
  try {
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(900, 600)); // the minimum size
    await expect.poll(() => page.evaluate(() => innerHeight)).toBeLessThan(620);
    const last = page.getByTestId('nav-item-T12');
    await last.scrollIntoViewIfNeeded();
    const box = (await last.boundingBox())!;
    await last.click({ button: 'right', position: { x: box.width - 4, y: box.height - 2 } });
    /** Every item of the menu `testId`, fully inside the window. */
    const outside = (testId: string) => page.getByTestId(testId).evaluate((m) =>
      [...m.querySelectorAll(':scope > [role="menuitem"], :scope > * > [role="menuitem"]')].filter((e) => {
        const r = e.getBoundingClientRect();
        return r.top < 0 || r.left < 0 || r.bottom > innerHeight || r.right > innerWidth;
      }).map((e) => e.getAttribute('data-testid')));
    expect(await outside('nav-menu')).toEqual([]);
    await expect(page.getByTestId('nav-menu-properties')).toBeInViewport({ ratio: 1 });
    await page.getByTestId('nav-menu-import').click();
    await expect(page.getByTestId('nav-menu-import-text')).toBeVisible();
    expect(await outside('nav-menu-import-menu')).toEqual([]); // the submenu of Import
  } finally {
    await app.close();
  }
});

test('C6: read-only base — Properties shows the description read-only and OK saves nothing; Import is disabled', async () => {
  const base = seedBase('menu-lecture', (db) => createTable(db, clients));
  const a = await launchApp({ args: [base], env: { BASECRAFT_REGION: 'fr-FR' } });
  const b = await launchApp({ args: [base], env: { BASECRAFT_REGION: 'fr-FR' } });
  try {
    const p = b.page;
    await expect(p.getByTestId('banner-readonly')).toBeVisible();
    await p.getByTestId('nav-item-Clients').click({ button: 'right' });
    await expect(p.getByTestId('nav-menu-import')).toBeDisabled();
    await expect(p.getByTestId('nav-menu-properties')).toBeEnabled();
    await p.getByTestId('nav-menu-properties').click();
    const desc = p.getByTestId('object-properties-description');
    await expect(desc).toHaveAttribute('readonly', '');
    await desc.press('x'); // typing does nothing
    await expect(desc).toHaveValue('');
    await p.getByTestId('object-properties-ok').click();
    await expect(p.getByTestId('object-properties')).toHaveCount(0);
    expect(await a.page.evaluate(() => (window as unknown as { basecraft: BasecraftApi }).basecraft.tables.list())).toEqual([{ name: 'Clients' }]);
  } finally {
    await b.app.close();
    await a.app.close();
  }
});

test('C6: Properties while the table is open in Design view — saving the design keeps the new description', async () => {
  const base = seedBase('menu-aller-retour', (db) => createTable(db, clients));
  const { app, page } = await launchApp({ args: [base], env: { BASECRAFT_REGION: 'fr-FR' } });
  try {
    const item = page.getByTestId('nav-item-Clients');
    await item.click({ button: 'right' });
    await page.getByTestId('nav-menu-design').click();
    await page.getByTestId('design-row-1-desc').fill('Nom du client'); // the design is now modified
    await expect(page.getByTestId('doc-tab-Clients')).toContainText('•');
    await item.click({ button: 'right' });
    await page.getByTestId('nav-menu-properties').click();
    await page.getByTestId('object-properties-description').fill('Fichier clients');
    await page.getByTestId('object-properties-ok').click();
    await expect(page.getByTestId('object-properties')).toHaveCount(0);
    await expect(page.getByTestId('doc-tab-Clients')).toContainText('•'); // still the user's own edits, no more
    await page.getByTestId('design-row-1-desc').click();
    await page.keyboard.press('Control+s');
    await expect(page.getByTestId('doc-tab-Clients')).not.toContainText('•');
    const api = () => page.evaluate(async () => {
      const bc = (window as unknown as { basecraft: BasecraftApi }).basecraft;
      return { list: await bc.tables.list(), field: (await bc.tables.design('Clients')).fields[1]!.props.description };
    });
    expect(await api()).toEqual({ list: [{ name: 'Clients', description: 'Fichier clients' }], field: 'Nom du client' });
  } finally {
    await app.close();
  }
});
