// F2b Task 7: the Colors gallery (apply to this object, fonts untouched, one undo step) and Customize Colors (Light and Dark columns, Save as a
// user theme, Cancel leaves the document clean).
import { test, expect, type Page } from '@playwright/test';
import { createTable } from '../../src/main/db/schema';
import type { DesignDoc } from '../../src/shared/design/model';
import { BUILTIN_THEMES } from '../../src/shared/design/theme';
import { clients } from '../../src/shared/test-fixtures';
import { launchApp, seedBase, seedForm } from './helpers';

const fiche: DesignDoc = { formatVersion: '1.0', recordSource: { kind: 'table', name: 'Clients' }, props: { Width: 9072 }, sections: [
  { kind: 'detail', height: 4536, props: {}, controls: [
    { kind: 'textBox', name: 'Nom', left: 1701, top: 0, width: 2268, height: 340, props: { ControlSource: 'Nom', ForeColor: 'theme:accent1', BackStyle: 'normal', BackColor: 'theme:accent1' } }] }] };
const [base, slate] = BUILTIN_THEMES;
const rgb = (hex: string) => `rgb(${[1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)).join(', ')})`;
const FR = { BASECRAFT_REGION: 'fr-FR' };
const tab = (page: Page) => page.getByTestId('doc-tab-form-Fiche');
const look = (page: Page) => page.locator('.doc:not([hidden])').getByTestId('ctl-Nom').locator('.fz-text').evaluate((e) => { const s = getComputedStyle(e); return { color: s.color, back: s.backgroundColor, font: s.fontFamily }; });
const openGallery = async (page: Page) => { await page.getByTestId('ribbon-tab-design').click().catch(() => undefined); await page.getByTestId('cmd-themeColors').click(); };
async function dark(page: Page, mode: 'light' | 'dark') {
  await page.getByTestId('ribbon-tab-file').click();
  await page.getByTestId('bs-options').click();
  await page.getByTestId('opt-theme').selectOption(mode);
  await page.getByTestId('bs-back').click();
}

test('Colors gallery applies a scheme to the object, keeps the fonts, undoes in one step; Customize Colors, Save, Cancel', async () => {
  test.setTimeout(240000);
  const path = seedBase('theme-colors', (db) => { createTable(db, clients); seedForm(db, 'Fiche', fiche); });
  let r = await launchApp({ args: [path], env: FR });
  const { userDataDir } = r;
  const open = async () => {
    await r.page.getByTestId('nav-item-form-Fiche').click({ button: 'right' });
    await r.page.getByTestId('nav-menu-design').click();
    await r.page.getByTestId('ctl-Nom').click();
  };
  try {
    await open();
    const before = await look(r.page);
    expect(before.color).toBe(rgb(base!.colors.light.accent1));
    // Cancel leaves the document clean
    await openGallery(r.page);
    await r.page.getByTestId('colors-customize').click();
    await r.page.getByTestId('colors-accent1-light').fill('#112233');
    await r.page.getByTestId('colors-cancel').click();
    await expect(r.page.getByTestId('colors-dialog')).toHaveCount(0);
    await expect(tab(r.page)).not.toContainText('•');
    expect((await look(r.page)).color).toBe(before.color);

    // keyboard: focus lands in the dialog, Tab stays inside, Escape cancels
    await openGallery(r.page);
    await r.page.getByTestId('colors-customize').click();
    await expect(r.page.getByTestId('colors-dialog')).toBeVisible();
    for (let i = 0; i < 40; i++) {
      await r.page.keyboard.press('Tab');
      expect(await r.page.evaluate(() => !!document.activeElement?.closest('[data-testid="colors-dialog"]'))).toBe(true);
    }
    await r.page.keyboard.press('Escape');
    await expect(r.page.getByTestId('colors-dialog')).toHaveCount(0);
    await expect(tab(r.page)).not.toContainText('•');

    // another scheme, this object only: the slot colours change, the font does not; one undo restores
    await openGallery(r.page);
    await r.page.getByTestId('colors-item-1').click({ button: 'right' });
    await expect(r.page.getByTestId('colors-menu-default')).toBeEnabled();
    await r.page.getByTestId('colors-menu-object').click();
    await expect.poll(async () => (await look(r.page)).color).toBe(rgb(slate!.colors.light.accent1));
    expect((await look(r.page)).font).toBe(before.font);
    await expect(tab(r.page)).toContainText('•');
    await r.page.getByTestId('ctl-Nom').click();
    await r.page.keyboard.press('Control+z');
    await expect.poll(async () => (await look(r.page)).color).toBe(before.color);

    // Customize Accent 1 (Light and Dark), name it, save as a user theme, OK
    await openGallery(r.page);
    await r.page.getByTestId('colors-customize').click();
    await r.page.getByTestId('colors-accent1-light').fill('#123456');
    await r.page.getByTestId('colors-accent1-dark').fill('#654321');
    await r.page.getByTestId('colors-name').fill('Mon jeu');
    await r.page.getByTestId('colors-save').click();
    await expect.poll(() => r.page.evaluate(() => (window as unknown as { basecraft: { themes: { list(): Promise<{ name: string }[]> } } }).basecraft.themes.list().then((l) => l.map((t) => t.name)))).toEqual(['Mon jeu']);
    await r.page.getByTestId('colors-ok').click();
    await expect.poll(async () => (await look(r.page)).color).toBe(rgb('#123456'));
    await dark(r.page, 'dark');
    await expect.poll(async () => (await look(r.page)).color).toBe(rgb('#654321'));
    await dark(r.page, 'light');
    await expect.poll(async () => (await look(r.page)).color).toBe(rgb('#123456'));

    // the saved scheme survives a relaunch, under « Personnalisé » in Colors and in Themes
    await r.app.close();
    r = await launchApp({ args: [path], userDataDir, env: FR });
    await open();
    await openGallery(r.page);
    await expect(r.page.locator('[data-testid^="colors-item-"][data-scheme-name="Mon jeu"]')).toHaveCount(1);
    await expect(r.page.getByTestId('colors-gallery').locator('h3').nth(1)).toHaveText('Personnalisé');
    await r.page.keyboard.press('Escape');
    await r.page.getByTestId('cmd-themes').click();
    await expect(r.page.locator('[data-testid^="theme-item-"][data-theme-name="Mon jeu"]')).toHaveCount(1);
  } finally { await r.app.close(); }
});
