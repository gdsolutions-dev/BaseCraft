// F2b Task 6: the user's themes (Save Current Theme, replace, Delete, « Personnalisé » section), kept in <userData>/themes.json.
import { test, expect } from '@playwright/test';
import { createTable } from '../../src/main/db/schema';
import type { BasecraftApi } from '../../src/shared/api';
import { BUILTIN_THEMES } from '../../src/shared/design/theme';
import { clients } from '../../src/shared/test-fixtures';
import { launchApp, seedBase, seedForm } from './helpers';

const seed = () => seedBase('theme-user', async (db) => {
  createTable(db, clients);
  seedForm(db, 'Fiche', { formatVersion: '1.0', recordSource: null, props: { Width: 9072 }, sections: [{ kind: 'detail', height: 2000, props: {}, controls: [] }] });
});

test('save the current theme, replace it, survive a relaunch, delete it; browse is disabled', async () => {
  test.setTimeout(180000);
  const base = await seed();
  let r = await launchApp({ args: [base], env: { BASECRAFT_REGION: 'fr-FR' } });
  const { userDataDir } = r;
  const open = async () => {
    await r.page.getByTestId('nav-item-form-Fiche').click({ button: 'right' });
    await r.page.getByTestId('nav-menu-design').click();
    await r.page.getByTestId('cmd-themes').click();
  };
  const mine = () => r.page.locator('[data-testid^="theme-item-"][data-theme-name="Ma charte"]');
  try {
    await open();
    await expect(r.page.getByTestId('theme-browse')).toBeDisabled();
    await r.page.getByTestId('theme-save').click();
    await r.page.getByTestId('modal-input').fill('Ma charte');
    await r.page.getByTestId('modal-btn-ok').click();
    await open();
    await expect(mine()).toHaveCount(1);
    // built-ins have no Delete
    await r.page.locator(`[data-testid^="theme-item-"][data-theme-name="${BUILTIN_THEMES[1]!.name}"]`).click({ button: 'right' });
    await expect(r.page.getByTestId('theme-menu-delete')).toHaveCount(0);
    await r.page.keyboard.press('Escape');
    await r.page.keyboard.press('Escape');

    // same name: asks to replace; No keeps one entry
    await r.page.getByTestId('cmd-themes').click();
    await r.page.getByTestId('theme-save').click();
    await r.page.getByTestId('modal-input').fill('ma CHARTE');
    await r.page.getByTestId('modal-btn-ok').click();
    await r.page.getByTestId('modal-btn-no').click();
    expect(await r.page.evaluate(() => (window as unknown as { basecraft: BasecraftApi }).basecraft.themes.list().then((l) => l.map((t) => t.name)))).toEqual(['Ma charte']);
    await r.page.getByTestId('cmd-themes').click();
    await r.page.getByTestId('theme-save').click();
    await r.page.getByTestId('modal-input').fill('ma CHARTE');
    await r.page.getByTestId('modal-btn-ok').click();
    await r.page.getByTestId('modal-btn-yes').click();
    expect(await r.page.evaluate(() => (window as unknown as { basecraft: BasecraftApi }).basecraft.themes.list().then((l) => l.map((t) => t.name)))).toEqual(['ma CHARTE']);

    // a built-in name is refused
    await r.page.getByTestId('cmd-themes').click();
    await r.page.getByTestId('theme-save').click();
    await r.page.getByTestId('modal-input').fill(BUILTIN_THEMES[2]!.name);
    await r.page.getByTestId('modal-btn-ok').click();
    await expect(r.page.getByTestId('modal-btn-ok')).toBeVisible();
    await r.page.getByTestId('modal-btn-ok').click();

    // relaunch with the same user-data dir
    await r.app.close();
    r = await launchApp({ args: [base], userDataDir, env: { BASECRAFT_REGION: 'fr-FR' } });
    await open();
    const item = r.page.locator('[data-testid^="theme-item-"][data-theme-name="ma CHARTE"]');
    await expect(item).toHaveCount(1);
    await item.click({ button: 'right' });
    await r.page.getByTestId('theme-menu-delete').click();
    await r.page.getByTestId('modal-btn-yes').click();
    await expect.poll(() => r.page.evaluate(() => (window as unknown as { basecraft: BasecraftApi }).basecraft.themes.list().then((l) => l.length))).toBe(0);
  } finally { await r.app.close(); }
});
