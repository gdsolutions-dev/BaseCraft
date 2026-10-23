import { test, expect, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { launchApp, seedSalesE2E } from './helpers';

const fr = JSON.parse(readFileSync(join(__dirname, '../../src/shared/i18n/fr.json'), 'utf8'));
const FR = { BASECRAFT_REGION: 'fr-FR' };
const menuLayout = (page: Page) => page.getByTestId('nav-menu').evaluate((m) =>
  [...m.children].map((e) => (e.getAttribute('role') === 'separator' ? '|' : (e.querySelector('[role="menuitem"]') ?? e).getAttribute('data-testid')!.replace('nav-menu-', ''))));
const menuOn = async (page: Page, testid: string) => { await page.getByTestId(testid).click({ button: 'right' }); await expect(page.getByTestId('nav-menu')).toBeVisible(); };

test('Cut / Copy / Paste of objects: menu order, copy (structure, data, append), cut keeps relationships, Paste disabled when empty', async () => {
  const base = seedSalesE2E('presse-papiers');
  const { app, page } = await launchApp({ args: [base], env: FR });
  try {
    await menuOn(page, 'nav-item-Clients');
    expect(await menuLayout(page)).toEqual(['open', 'design', '|', 'import', 'export', '|', 'rename', 'hide', 'delete', '|', 'cut', 'copy', 'paste', '|', 'properties']);
    await expect(page.getByTestId('nav-menu-paste')).toBeDisabled(); // empty clipboard
    await expect(page.getByTestId('nav-menu-cut')).toBeEnabled();

    // Copy then Paste, structure only: the copy is empty. Paste pastes the clip whatever was right-clicked.
    await page.getByTestId('nav-menu-copy').click();
    await menuOn(page, 'nav-item-Commandes');
    await page.getByTestId('nav-menu-paste').click();
    await expect(page.getByTestId('paste-name')).toHaveValue('Copie de Clients');
    await page.getByTestId('paste-mode-structure').check();
    await page.getByTestId('paste-ok').click();
    await expect(page.getByTestId('nav-item-Copie de Clients')).toBeVisible();
    await page.getByTestId('nav-item-Copie de Clients').dblclick();
    await expect(page.getByTestId('doc-tab-Copie de Clients')).toBeVisible();
    await expect(page.getByTestId('datasheet').locator('table[role=grid]')).toHaveAttribute('aria-rowcount', '2'); // header + new record row
    await page.getByTestId('doc-tab-close-Copie de Clients').click();

    // Paste again (the clip stays): the name is made unique; a query's name is refused (shared namespace); then structure and data
    await menuOn(page, 'nav-item-Clients');
    await page.getByTestId('nav-menu-paste').click();
    await expect(page.getByTestId('paste-name')).toHaveValue('Copie de Clients1');
    await page.getByTestId('paste-name').fill('QVentes');
    await expect(page.getByTestId('paste-error')).toHaveText(fr.nav.paste.exists);
    await expect(page.getByTestId('paste-ok')).toBeDisabled();
    await page.getByTestId('paste-name').fill('Clients bis');
    await page.getByTestId('paste-ok').click();
    await expect(page.getByTestId('nav-item-Clients bis')).toBeVisible();
    await page.getByTestId('nav-item-Clients bis').dblclick();
    await expect(page.getByTestId('datasheet').locator('table[role=grid]')).not.toHaveAttribute('aria-rowcount', '2');
    await page.getByTestId('doc-tab-close-Clients bis').click();

    // Append: the Clients rows into the structure-only copy
    await menuOn(page, 'nav-item-Clients');
    await page.getByTestId('nav-menu-paste').click();
    await page.getByTestId('paste-mode-append').check();
    await page.getByTestId('paste-name').fill('Clients');
    await expect(page.getByTestId('paste-error')).toHaveText(fr.nav.paste.appendTarget);
    await page.getByTestId('paste-name').fill('Copie de Clients');
    await page.getByTestId('paste-ok').click();
    await expect(page.getByTestId('modal')).toContainText(/\d+ enregistrements ajoutés, 0 refusés\./);
    await page.getByTestId('modal-btn-ok').click();

    // Cut Commandes, Paste as Cmd: renamed, the relationship line remains
    await menuOn(page, 'nav-item-Commandes');
    await page.getByTestId('nav-menu-cut').click();
    await menuOn(page, 'nav-item-Clients');
    await page.getByTestId('nav-menu-paste').click();
    await expect(page.getByTestId('paste-name')).toHaveValue('Commandes');
    await expect(page.getByTestId('paste-mode-data')).toHaveCount(0); // a cut has no copy mode
    await page.getByTestId('paste-name').fill('Cmd');
    await page.getByTestId('paste-ok').click();
    await expect(page.getByTestId('nav-item-Cmd')).toBeVisible();
    await expect(page.getByTestId('nav-item-Commandes')).toHaveCount(0);
    await menuOn(page, 'nav-item-Clients');
    await expect(page.getByTestId('nav-menu-paste')).toBeDisabled(); // the cut emptied the clipboard
    await page.keyboard.press('Escape');
    await page.getByTestId('ribbon-tab-databaseTools').click();
    await page.getByTestId('cmd-relationships').click();
    await expect(page.getByText(/Relation entre « Clients » \(N°\) et « Cmd » \(Client\)/).first()).toBeAttached(); // the relationship follows the rename (listed under its new table name)
  } finally {
    await app.close();
  }
});

test('Ctrl+C / Ctrl+V on the pane, and Home > Copy / Paste (pane item, or the focused text field)', async () => {
  const base = seedSalesE2E('presse-papiers-clavier');
  const { app, page } = await launchApp({ args: [base], env: FR });
  try {
    await page.getByTestId('nav-item-query-QVentes').click();
    await page.keyboard.press('Control+c');
    await page.keyboard.press('Control+v');
    await expect(page.getByTestId('paste-name')).toHaveValue('Copie de QVentes');
    await page.getByTestId('paste-ok').click();
    await expect(page.getByTestId('nav-item-query-Copie de QVentes')).toBeVisible();

    // Home > Copy / Paste with the pane focused act on the selected object
    await page.getByTestId('ribbon-tab-home').click();
    await page.getByTestId('nav-item-query-QClientsLyon').click();
    await page.getByTestId('cmd-copy').click();
    await page.getByTestId('cmd-paste').click();
    await expect(page.getByTestId('paste-name')).toHaveValue('Copie de QClientsLyon');
    await page.getByTestId('paste-cancel').click();

    // elsewhere they are the focused text field's own: the pane's search box
    const search = page.getByTestId('nav-search');
    await search.fill('abc');
    await search.press('Control+a');
    await page.getByTestId('cmd-copy').click();
    await search.press('End');
    await page.getByTestId('cmd-paste').click();
    await expect(search).toHaveValue('abcabc');
  } finally {
    await app.close();
  }
});

test('read-only base: Cut and Paste are disabled, Copy is not', async () => {
  const base = seedSalesE2E('presse-papiers-lecture');
  const a = await launchApp({ args: [base] });
  const b = await launchApp({ args: [base], env: FR });
  try {
    const p = b.page;
    await expect(p.getByTestId('banner-readonly')).toBeVisible();
    await menuOn(p, 'nav-item-Clients');
    await expect(p.getByTestId('nav-menu-cut')).toBeDisabled();
    await expect(p.getByTestId('nav-menu-copy')).toBeEnabled();
    await p.getByTestId('nav-menu-copy').click();
    await menuOn(p, 'nav-item-Clients');
    await expect(p.getByTestId('nav-menu-paste')).toBeDisabled();
    await p.keyboard.press('Escape');
    await p.getByTestId('ribbon-tab-home').click();
    await expect(p.getByTestId('cmd-cut')).toBeDisabled();
    await expect(p.getByTestId('cmd-paste')).toBeDisabled();
    await expect(p.getByTestId('cmd-copy')).toBeEnabled();
  } finally {
    await a.app.close();
    await b.app.close();
  }
});
