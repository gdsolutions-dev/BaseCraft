// B1 Task 9: macros in the Navigation Pane — the Macros group, double-click runs, the context menu (Rename, Copy / Paste, Delete,
// Object Properties) and Create › Macro opening a new macro in Design view.
import { test, expect, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { saveObject } from '../../src/main/db/objects';
import type { MacroItem } from '../../src/shared/macro/model';
import { launchApp, seedBase } from './helpers';

const fr = JSON.parse(readFileSync(join(__dirname, '../../src/shared/i18n/fr.json'), 'utf8'));
const FR = { BASECRAFT_REGION: 'fr-FR' };
const act = (action: string, args: Record<string, string> = {}): MacroItem => ({ k: 'action', action, args });
/** The top-level menu: its items (test ids without the prefix) with '|' for each separator. */
const menuLayout = (page: Page) => page.getByTestId('nav-menu').evaluate((m) =>
  [...m.children].map((e) => (e.getAttribute('role') === 'separator' ? '|' : (e.querySelector('[role="menuitem"]') ?? e).getAttribute('data-testid')!.replace('nav-menu-', ''))));
const item = (page: Page, name: string) => page.getByTestId(`nav-item-macro-${name}`);

const base = () => seedBase('macros-volet', (db) => {
  for (const [name, message] of [['MBip', 'Bip bip'], ['MAutre', 'Autre']] as const) {
    const r = saveObject(db, 'macro', name, { formatVersion: '1.0', items: [act('MessageBox', { Message: message, Beep: 'no', Type: 'information' })] }, null);
    if (!r.ok) throw new Error(r.reason);
  }
});

test('Navigation Pane: the Macros group, double-click runs, menu order, Rename, Copy / Paste, Delete, Object Properties', async () => {
  const { app, page } = await launchApp({ args: [base()], env: FR });
  try {
    await expect(page.getByTestId('nav-group-macro')).toContainText(fr.nav.macros);
    await expect(page.getByTestId('nav-count-macro')).toHaveText('2');
    await expect(item(page, 'MBip')).toBeVisible();
    await expect(item(page, 'MAutre')).toBeVisible();

    // double-click runs the macro: its MessageBox, no document tab
    await item(page, 'MBip').dblclick();
    await expect(page.getByTestId('macro-msgbox-text')).toHaveText('Bip bip');
    await page.getByTestId('macro-msgbox-ok').click();
    await expect(page.getByTestId('modal')).toHaveCount(0);
    await expect(page.getByTestId('doc-tab-macro-MBip')).toHaveCount(0);

    // the menu, in the spec's order; Run is the first item, Export and Hide are placeholders
    await item(page, 'MBip').click({ button: 'right' });
    expect(await menuLayout(page)).toEqual(['open', 'design', '|', 'export', '|', 'rename', 'hide', 'delete', '|', 'cut', 'copy', 'paste', '|', 'properties']);
    await expect(page.getByTestId('nav-menu-open')).toHaveText('Exécuter');
    await expect(page.getByTestId('nav-menu-properties')).toHaveText("Propriétés de l'objet");
    for (const id of ['export', 'hide']) {
      await expect(page.getByTestId(`nav-menu-${id}`)).toHaveAttribute('aria-disabled', 'true');
      await expect(page.getByTestId(`nav-menu-${id}`)).toHaveAttribute('title', fr.ribbon.planned.later);
    }
    await expect(page.getByTestId('nav-menu-paste')).toBeDisabled(); // empty clipboard
    await page.getByTestId('nav-menu-open').click(); // Run
    await expect(page.getByTestId('macro-msgbox-text')).toHaveText('Bip bip');
    await page.getByTestId('macro-msgbox-ok').click();

    // Rename
    await item(page, 'MAutre').click({ button: 'right' });
    await page.getByTestId('nav-menu-rename').click();
    await page.getByTestId('modal-input').fill('MDeux');
    await page.getByTestId('modal-btn-ok').click();
    await expect(item(page, 'MDeux')).toBeVisible();
    await expect(item(page, 'MAutre')).toHaveCount(0);

    // Copy then Paste: « Copie de MBip », a macro of its own that runs
    await item(page, 'MBip').click({ button: 'right' });
    await page.getByTestId('nav-menu-copy').click();
    await item(page, 'MDeux').click({ button: 'right' });
    await page.getByTestId('nav-menu-paste').click();
    await expect(page.getByTestId('paste-name')).toHaveValue('Copie de MBip');
    await page.getByTestId('paste-name').fill('MDeux');
    await expect(page.getByTestId('paste-error')).toHaveText(fr.nav.paste.exists); // the macros' own namespace
    await page.getByTestId('paste-name').fill('Copie de MBip');
    await page.getByTestId('paste-ok').click();
    await expect(item(page, 'Copie de MBip')).toBeVisible();
    await expect(page.getByTestId('nav-count-macro')).toHaveText('3');
    await item(page, 'Copie de MBip').dblclick();
    await expect(page.getByTestId('macro-msgbox-text')).toHaveText('Bip bip');
    await page.getByTestId('macro-msgbox-ok').click();

    // Delete, after the confirmation
    await item(page, 'Copie de MBip').click({ button: 'right' });
    await page.getByTestId('nav-menu-delete').click();
    await expect(page.getByTestId('modal')).toContainText('Copie de MBip');
    await page.getByTestId('modal-btn-no').click();
    await expect(item(page, 'Copie de MBip')).toBeVisible();
    await item(page, 'Copie de MBip').click({ button: 'right' });
    await page.getByTestId('nav-menu-delete').click();
    await page.getByTestId('modal-btn-yes').click();
    await expect(item(page, 'Copie de MBip')).toHaveCount(0);
    await expect(page.getByTestId('nav-count-macro')).toHaveText('2');

    // Object Properties: the type, the description (the item's tooltip)
    await item(page, 'MBip').click({ button: 'right' });
    await page.getByTestId('nav-menu-properties').click();
    await expect(page.getByTestId('object-properties-type')).toHaveText(fr.tabs.kind.macro);
    await expect(page.getByTestId('object-properties-name')).toHaveText('MBip');
    await page.getByTestId('object-properties-description').fill('Fait un bip');
    await page.getByTestId('object-properties-ok').click();
    await expect(item(page, 'MBip')).toHaveAttribute('title', 'Fait un bip');
  } finally {
    await app.close();
  }
});

test('Create › Macro opens Macro1 in Design view, not saved; a second one is Macro2', async () => {
  const { app, page } = await launchApp({ args: [base()], env: FR });
  try {
    await page.getByTestId('ribbon-tab-create').click();
    await page.getByTestId('cmd-createMacro').click();
    await expect(page.getByTestId('doc-tab-macro-Macro1')).toBeVisible();
    await expect(page.getByTestId('ribbon-tab-macroDesign')).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByTestId('nav-count-macro')).toHaveText('2'); // nothing saved
    await page.getByTestId('ribbon-tab-create').click();
    await page.getByTestId('cmd-createMacro').click();
    await expect(page.getByTestId('doc-tab-macro-Macro2')).toBeVisible();
  } finally {
    await app.close();
  }
});
