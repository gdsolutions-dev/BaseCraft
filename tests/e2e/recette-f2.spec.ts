// Recette F2b (thèmes, tâche 9) : jeux de couleurs et de polices appliqués à tous les objets correspondants (clic gauche), thème
// personnalisé (enregistrer, échanger couleurs puis polices, personnaliser, supprimer), base en lecture seule.
import { test, expect, type Page } from '@playwright/test';
import { createTable } from '../../src/main/db/schema';
import { saveObject } from '../../src/main/db/objects';
import type { BasecraftApi } from '../../src/shared/api';
import { BUILTIN_THEMES, DEFAULT_THEME, shade, type Theme } from '../../src/shared/design/theme';
import type { DesignDoc } from '../../src/shared/design/model';
import { clients } from '../../src/shared/test-fixtures';
import { launchApp, seedBase, seedForm } from './helpers';

const FR = { BASECRAFT_REGION: 'fr-FR' };
const T = (name: string) => BUILTIN_THEMES.find((t) => t.name === name)!;
const [SABLE, SLATE, FOREST, PRUNE] = [T('Sable'), T('Ardoise'), T('Forêt'), T('Prune')] as [Theme, Theme, Theme, Theme];
const box = (name: string, kind: 'textBox' | 'label') => ({ kind, name, left: 1701, top: 100, width: 2268, height: 340,
  props: { Caption: 'x', ForeColor: 'theme:accent1@-25', FontName: '(Headings)' } });
const doc = (theme: Theme | null, ctl: string): DesignDoc => ({ formatVersion: '1.0', recordSource: null,
  props: { Width: 9072, ...(theme ? { Theme: theme } : {}) },
  sections: [{ kind: ctl === 'Tx' ? 'reportHeader' : 'detail', height: 2000, props: {}, controls: [box(ctl, ctl === 'Tx' ? 'label' : 'textBox')] }] });
// Fiche carries its own theme (Sable), Autre follows the base, Etat carries its own (Prune) and must keep it
const seed = (name: string) => seedBase(name, async (db) => {
  createTable(db, clients);
  seedForm(db, 'Fiche', doc(SABLE, 'Nom'));
  seedForm(db, 'Autre', doc(null, 'Nom'));
  const r = saveObject(db, 'report', 'Etat', doc(PRUNE, 'Tx'), null);
  if (!r.ok) throw new Error(r.reason);
});

type Win = { basecraft: BasecraftApi };
const baseTheme = (page: Page) => page.evaluate(() => (window as unknown as Win).basecraft.theme.get());
const names = (page: Page) => page.evaluate(() => (window as unknown as Win).basecraft.themes.list().then((l) => l.map((t) => t.name)));
const saved = (page: Page, kind: 'form' | 'report', name: string) =>
  page.evaluate(([k, n]) => (window as unknown as Win).basecraft.objects.get(k as 'form', n!), [kind, name]).then((r) => r.definition as DesignDoc);
const rgb = (hex: string) => `rgb(${[1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)).join(', ')})`;
const accent = (t: Theme) => rgb(shade(t.colors.light.accent1, 0.25));
const cur = (page: Page) => page.locator('.doc:not([hidden])');
const look = (page: Page, ctl: string, cls: string) => cur(page).getByTestId(`ctl-${ctl}`).locator(`.${cls}`).evaluate((e) => ({ c: getComputedStyle(e).color, f: getComputedStyle(e).fontFamily }));
const openDesign = async (page: Page, kind: 'form' | 'report', name: string) => {
  await page.getByTestId(`nav-item-${kind}-${name}`).click({ button: 'right' });
  await page.getByTestId('nav-menu-design').click();
  await expect(cur(page).getByTestId('designer')).toBeVisible();
};
const scheme = (page: Page, prefix: 'colors' | 'fonts', name: string) => page.locator(`[data-testid^="${prefix}-item-"][data-scheme-name="${name}"]`).first();
const gallery = async (page: Page, cmd: 'themeColors' | 'themeFonts') => {
  const tab = page.getByTestId('ribbon-tab-design');
  if (await tab.count()) await tab.click();
  await page.getByTestId(`cmd-${cmd}`).click();
};
// the closing gallery popup must be gone before the keyboard shortcut, or it can steal the focus
const key = async (page: Page, combo: string) => { await expect(page.getByTestId('theme-gallery')).toBeHidden(); await page.getByTestId('cmd-themes').focus(); await page.keyboard.press(combo); };

test('Colors and Fonts left click = all matching objects: forms restyled (one undo step), the report with its own theme untouched', async () => {
  test.setTimeout(60000);
  const { app, page } = await launchApp({ args: [await seed('recette-f2')], env: FR });
  try {
    await openDesign(page, 'report', 'Etat');
    await openDesign(page, 'form', 'Fiche');
    await expect.poll(() => look(page, 'Nom', 'fz-text').then((l) => l.c)).toBe(accent(SABLE));

    await cur(page).getByTestId('ctl-Nom').click();   // dirty the open form first: one earlier edit on the undo stack
    await page.getByTestId('prop-Left').fill('5,00 cm');
    await page.getByTestId('prop-Left').press('Enter');
    await expect(page.getByTestId('doc-tab-form-Fiche')).toContainText('•');
    await gallery(page, 'themeColors');
    await scheme(page, 'colors', 'Ardoise').click();   // left click
    await expect.poll(() => baseTheme(page).then((t) => t.colors.name)).toBe('Ardoise');
    expect((await baseTheme(page)).fonts).toEqual(DEFAULT_THEME.fonts);
    await expect.poll(() => look(page, 'Nom', 'fz-text').then((l) => l.c)).toBe(accent(SLATE));   // Fiche lost its override
    await expect(page.getByTestId('doc-tab-form-Fiche')).toContainText('•');
    expect((await saved(page, 'form', 'Fiche')).props.Theme).toEqual(SABLE);   // open: edited, not rewritten
    expect((await saved(page, 'form', 'Autre')).props).not.toHaveProperty('Theme');
    expect((await saved(page, 'report', 'Etat')).props.Theme).toEqual(PRUNE);
    await key(page, 'Control+z');   // one step: the theme override is back, the earlier edit is still there
    await expect.poll(() => look(page, 'Nom', 'fz-text').then((l) => l.c)).toBe(accent(SABLE));
    await expect(page.getByTestId('prop-Left')).toHaveValue('5,00 cm');
    await key(page, 'Control+y');
    await expect.poll(() => look(page, 'Nom', 'fz-text').then((l) => l.c)).toBe(accent(SLATE));
    await expect(page.getByTestId('prop-Left')).toHaveValue('5,00 cm');
    await page.getByTestId('doc-tab-report-Etat').click();
    await expect.poll(() => look(page, 'Tx', 'rz-text').then((l) => l.c)).toBe(accent(PRUNE));
    await page.getByTestId('doc-tab-form-Fiche').click();

    // Fonts: the menu's first item does the same, colours stay
    await gallery(page, 'themeFonts');
    await scheme(page, 'fonts', 'Forêt').click({ button: 'right' });
    await page.getByTestId('fonts-menu-all').click();
    await expect.poll(() => baseTheme(page).then((t) => t.fonts.major)).toBe(FOREST.fonts.major);
    expect((await baseTheme(page)).colors.name).toBe('Ardoise');
    await expect.poll(() => look(page, 'Nom', 'fz-text').then((l) => l.f)).toContain(`BC ${FOREST.fonts.major}`);
    await page.getByTestId('doc-tab-report-Etat').click();
    await expect.poll(() => look(page, 'Tx', 'rz-text').then((l) => l.f)).toContain(`BC ${PRUNE.fonts.major}`);
  } finally { await app.close(); }
});

test('user theme: save, swap only its colours then only its fonts, customize both, delete', async () => {
  test.setTimeout(60000);
  const { app, page } = await launchApp({ args: [await seed('recette-f2-user')], env: FR });
  try {
    await openDesign(page, 'form', 'Autre');
    await page.getByTestId('cmd-themes').click();
    await page.getByTestId('theme-save').click();
    await page.getByTestId('modal-input').fill('Ma charte');
    await page.getByTestId('modal-btn-ok').click();
    await expect.poll(() => names(page)).toEqual(['Ma charte']);

    await gallery(page, 'themeColors');
    await scheme(page, 'colors', 'Prune').click();
    await expect.poll(() => baseTheme(page).then((t) => t.colors.name)).toBe('Prune');
    expect((await baseTheme(page)).fonts.name).toBe('BaseCraft');
    await gallery(page, 'themeFonts');
    await scheme(page, 'fonts', 'Forêt').click();
    await expect.poll(() => baseTheme(page).then((t) => t.fonts.name)).toBe('Forêt');
    expect((await baseTheme(page)).colors.name).toBe('Prune');
    expect((await baseTheme(page)).name).toBe('BaseCraft');

    await gallery(page, 'themeColors');
    await page.getByTestId('colors-customize').click();
    await page.getByTestId('colors-accent1-light').fill('#123456');
    await page.getByTestId('colors-name').fill('Mes couleurs');
    await page.getByTestId('colors-save').click();
    await page.getByTestId('colors-ok').click();
    await gallery(page, 'themeFonts');
    await page.getByTestId('fonts-customize').click();
    await page.getByTestId('fonts-major').selectOption('Caladea');
    await page.getByTestId('fonts-name').fill('Mes polices');
    await page.getByTestId('fonts-save').click();
    await page.getByTestId('fonts-ok').click();
    await expect.poll(() => names(page).then((l) => [...l].sort())).toEqual(['Ma charte', 'Mes couleurs', 'Mes polices']);

    for (const n of ['Ma charte', 'Mes couleurs', 'Mes polices']) {
      await page.getByTestId('cmd-themes').click();
      await page.locator(`[data-testid^="theme-item-"][data-theme-name="${n}"]`).click({ button: 'right' });
      await page.getByTestId('theme-menu-delete').click();
      await page.getByTestId('modal-btn-yes').click();
      await expect(page.getByTestId('theme-gallery')).toBeHidden();
    }
    await expect.poll(() => names(page)).toEqual([]);
  } finally { await app.close(); }
});

test('read-only base: Colors and Fonts galleries open, left click and every menu item are disabled', async () => {
  test.setTimeout(60000);
  const base = await seed('recette-f2-ro');
  const a = await launchApp({ args: [base], env: FR });
  const b = await launchApp({ args: [base], env: FR });
  try {
    const page = b.page;
    await expect(page.getByTestId('banner-readonly')).toBeVisible();
    await openDesign(page, 'form', 'Autre');
    for (const [cmd, prefix, nm] of [['themeColors', 'colors', 'Ardoise'], ['themeFonts', 'fonts', 'Forêt']] as const) {
      await gallery(page, cmd);
      await expect(page.getByTestId(`${prefix}-gallery`)).toBeVisible();
      await scheme(page, prefix, nm).click();
      await expect(page.getByTestId(`${prefix}-gallery`)).toBeVisible();
      await scheme(page, prefix, nm).click({ button: 'right' });
      for (const id of ['all', 'object', 'default']) await expect(page.getByTestId(`${prefix}-menu-${id}`), id).toBeDisabled();
      await page.keyboard.press('Escape');
      await page.keyboard.press('Escape');
    }
    expect(await baseTheme(page)).toEqual(DEFAULT_THEME);
    await expect(page.getByTestId('doc-tab-form-Autre')).not.toContainText('•');
  } finally { await b.app.close(); await a.app.close(); }
});
