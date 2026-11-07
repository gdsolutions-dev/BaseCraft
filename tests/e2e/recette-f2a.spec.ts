// Recette F2a (thèmes, tâche 5) : la galerie des thèmes du ruban (clic gauche = tous les objets correspondants, menu contextuel :
// tous / cet objet / valeur par défaut), l'annulation en une étape, l'enregistrement, la police du thème dans l'aperçu de l'état,
// la base en lecture seule et le mode sombre (un formulaire suit le mode de l'application, un état reste clair).
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
const [SABLE, FOREST, PRUNE, OCEAN] = [T('Sable'), T('Forêt'), T('Prune'), T('Océan')] as [Theme, Theme, Theme, Theme];
// a report has no records here: its box is a label in the report header (the only thing it prints)
const themedBox = (name: string, kind: 'textBox' | 'label' = 'textBox') => ({ kind, name, left: 1701, top: 100, width: 2268, height: 340,
  props: { Caption: 'x', ForeColor: 'theme:accent1@-25', FontName: '(Headings)' } });
const doc = (theme: Theme | null, box: string): DesignDoc => ({ formatVersion: '1.0', recordSource: null,
  props: { Width: 9072, ...(theme ? { Theme: theme } : {}) },
  sections: [{ kind: box === 'Tx' ? 'reportHeader' : 'detail', height: 2000, props: {}, controls: [themedBox(box, box === 'Tx' ? 'label' : 'textBox')] }] });

const seed = (name: string, fiche: Theme | null, etat: Theme | null) => seedBase(name, async (db) => {
  createTable(db, clients);
  seedForm(db, 'Fiche', doc(fiche, 'Nom'));
  seedForm(db, 'Autre', doc(fiche, 'Nom'));   // never opened: its saved row is rewritten by « all matching objects »
  const r = saveObject(db, 'report', 'Etat', doc(etat, 'Tx'), null);
  if (!r.ok) throw new Error(r.reason);
});

const baseTheme = (page: Page) => page.evaluate(() => (window as unknown as { basecraft: BasecraftApi }).basecraft.theme.get());
const saved = (page: Page, kind: 'form' | 'report', name: string) =>
  page.evaluate(([k, n]) => (window as unknown as { basecraft: BasecraftApi }).basecraft.objects.get(k as 'form', n!), [kind, name]).then((r) => r.definition as DesignDoc);

const rgb = (hex: string) => `rgb(${[1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)).join(', ')})`;
const accent = (t: Theme, mode: 'light' | 'dark' = 'light') => rgb(shade(t.colors[mode].accent1, 0.25));
const cur = (page: Page) => page.locator('.doc:not([hidden])');
/** Colour and font family drawn by the text box of the active designer. */
const look = (page: Page, ctl: string, cls: string) =>
  cur(page).getByTestId(`ctl-${ctl}`).locator(`.${cls}`).evaluate((e) => ({ c: getComputedStyle(e).color, f: getComputedStyle(e).fontFamily }));
const expectLook = async (page: Page, ctl: string, cls: string, t: Theme, mode: 'light' | 'dark' = 'light') => {
  await expect.poll(() => look(page, ctl, cls).then((l) => l.c)).toBe(accent(t, mode));
  if (t.fonts.major !== 'Inter') expect((await look(page, ctl, cls)).f).toContain(`BC ${t.fonts.major}`);   // Inter is the UI font itself
};
const openDesign = async (page: Page, kind: 'form' | 'report', name: string) => {
  await page.getByTestId(`nav-item-${kind}-${name}`).click({ button: 'right' });
  await page.getByTestId('nav-menu-design').click();
  await expect(cur(page).getByTestId('designer')).toBeVisible();
};
const item = (page: Page, name: string) => page.locator(`[data-testid^="theme-item-"][data-theme-name="${name}"]`);
async function leftClick(page: Page, name: string) { await page.getByTestId('cmd-themes').click(); await item(page, name).click(); }
async function menu(page: Page, name: string, entry: 'all' | 'object' | 'default') {
  await page.getByTestId('cmd-themes').click();
  await item(page, name).click({ button: 'right' });
  await page.getByTestId(`theme-menu-${entry}`).click();
  await expect(page.getByTestId('theme-gallery')).toHaveCount(0);
}
// Ctrl+Z / Ctrl+Y reach the design from a ribbon button (not from the document tab strip)
const undo = async (page: Page) => { await page.getByTestId('cmd-themes').focus(); await page.keyboard.press('Control+z'); };
const redo = async (page: Page) => { await page.getByTestId('cmd-themes').focus(); await page.keyboard.press('Control+y'); };
const dirty = (page: Page, tab: string) => expect(page.getByTestId(`doc-tab-${tab}`)).toContainText('•');

test('Themes gallery: all matching objects, this object only, default; one undo step; save and reopen; report preview font', async () => {
  test.setTimeout(240000);
  const { app, page } = await launchApp({ args: [await seed('recette-f2a', SABLE, null)], env: FR });
  try {
    await openDesign(page, 'report', 'Etat');
    await openDesign(page, 'form', 'Fiche');
    await expectLook(page, 'Nom', 'fz-text', SABLE);

    // the gallery: six themes, the current one first and marked
    await page.getByTestId('cmd-themes').click();
    await expect(page.getByTestId('theme-gallery')).toBeVisible();
    await expect(page.getByTestId('theme-item-0')).toHaveAttribute('data-theme-name', 'Sable');
    await expect(page.getByTestId('theme-item-0')).toHaveAttribute('aria-current', 'true');
    await expect(page.locator('[data-testid^="theme-item-"]')).toHaveCount(6);
    await page.keyboard.press('Escape');

    // (1) left click = all matching objects: default changes, the open Fiche and Etat lose their override by one edit each
    await leftClick(page, 'Forêt');
    await expect.poll(() => baseTheme(page).then((t) => t.name)).toBe('Forêt');
    await expectLook(page, 'Nom', 'fz-text', FOREST);
    await dirty(page, 'form-Fiche');
    expect((await saved(page, 'form', 'Fiche')).props.Theme).toEqual(SABLE);   // an open document is not rewritten in the base
    await expect.poll(async () => (await saved(page, 'form', 'Autre')).props).not.toHaveProperty('Theme');   // a closed one is
    await page.getByTestId('doc-tab-report-Etat').click();
    await expectLook(page, 'Tx', 'rz-text', FOREST);
    await page.getByTestId('doc-tab-form-Fiche').click();
    await undo(page);   // one step restores Fiche's own theme
    await expectLook(page, 'Nom', 'fz-text', SABLE);
    await redo(page);
    await expectLook(page, 'Nom', 'fz-text', FOREST);

    // (2) this object only: Fiche uses Prune, Etat keeps the default; one undo step, redo reapplies
    await menu(page, 'Prune', 'object');
    await expectLook(page, 'Nom', 'fz-text', PRUNE);
    expect((await baseTheme(page)).name).toBe('Forêt');
    await undo(page);
    await expectLook(page, 'Nom', 'fz-text', FOREST);
    await redo(page);
    await expectLook(page, 'Nom', 'fz-text', PRUNE);
    await page.getByTestId('doc-tab-report-Etat').click();
    await expectLook(page, 'Tx', 'rz-text', FOREST);

    // make default alone: the base changes, Fiche (with its override) does not
    await menu(page, 'Océan', 'default');
    await expect.poll(() => baseTheme(page).then((t) => t.name)).toBe('Océan');
    await expectLook(page, 'Tx', 'rz-text', OCEAN);
    await page.getByTestId('doc-tab-form-Fiche').click();
    await expectLook(page, 'Nom', 'fz-text', PRUNE);

    // (3) save, close, reopen: props.Theme persisted and used
    await page.keyboard.press('Control+s');
    await expect(page.getByTestId('doc-tab-form-Fiche')).not.toContainText('•');
    expect((await saved(page, 'form', 'Fiche')).props.Theme).toEqual(PRUNE);
    await page.getByTestId('doc-tab-close-form-Fiche').click();
    await openDesign(page, 'form', 'Fiche');
    await expectLook(page, 'Nom', 'fz-text', PRUNE);

    // (4) the report's preview style sheet uses the theme's font
    await page.getByTestId('doc-tab-close-report-Etat').click();
    await expect(page.getByTestId('doc-tab-report-Etat')).toHaveCount(0);
    await page.getByTestId('nav-item-report-Etat').dblclick();
    const sheet = cur(page).getByTestId('report-preview').locator('style').first();
    await expect.poll(async () => (await sheet.textContent()) ?? '').toContain(`BC ${OCEAN.fonts.major}`);
  } finally {
    await app.close();
  }
});

test('from a report: all matching objects clears the open report by an edit and leaves the forms alone', async () => {
  const { app, page } = await launchApp({ args: [await seed('recette-f2a-etat', SABLE, PRUNE)], env: FR });
  try {
    await openDesign(page, 'form', 'Fiche');
    await openDesign(page, 'report', 'Etat');
    await expectLook(page, 'Tx', 'rz-text', PRUNE);
    await leftClick(page, 'Forêt');
    await expect.poll(() => baseTheme(page).then((t) => t.name)).toBe('Forêt');
    await expectLook(page, 'Tx', 'rz-text', FOREST);
    await dirty(page, 'report-Etat');
    expect((await saved(page, 'report', 'Etat')).props.Theme).toEqual(PRUNE);   // open: not rewritten in the base
    expect((await saved(page, 'form', 'Autre')).props.Theme).toEqual(SABLE);   // a form: untouched
    await page.getByTestId('doc-tab-form-Fiche').click();
    await expectLook(page, 'Nom', 'fz-text', SABLE);
    await expect(page.getByTestId('doc-tab-form-Fiche')).not.toContainText('•');
    await page.getByTestId('doc-tab-report-Etat').click();
    await page.keyboard.press('Control+s');
    await expect(page.getByTestId('doc-tab-report-Etat')).not.toContainText('•');
    expect((await saved(page, 'report', 'Etat')).props).not.toHaveProperty('Theme');
  } finally {
    await app.close();
  }
});

test('all matching objects: a form open in Form view (no design mounted) shows the new theme', async () => {
  const { app, page } = await launchApp({ args: [await seed('recette-f2a-run', SABLE, null)], env: FR });
  try {
    await page.getByTestId('nav-item-form-Autre').dblclick();   // Form view: its own Sable override is read from the base
    await expect(page.getByTestId('form-run')).toBeVisible();
    const colour = () => page.getByTestId('form-ctl-Nom').filter({ visible: true }).evaluate((e) => getComputedStyle(e).color);
    await expect.poll(colour).toBe(accent(SABLE));
    await openDesign(page, 'form', 'Fiche');
    await leftClick(page, 'Forêt');
    await expect.poll(() => baseTheme(page).then((t) => t.name)).toBe('Forêt');
    await page.getByTestId('doc-tab-form-Autre').click();
    await expect.poll(colour).toBe(accent(FOREST));   // the tab re-read its saved row, which lost the override
  } finally {
    await app.close();
  }
});

test('read-only base: the gallery opens, nothing applies, every menu item is disabled, no dirty mark', async () => {
  const base = await seed('recette-f2a-ro', null, null);
  const a = await launchApp({ args: [base], env: FR });
  const b = await launchApp({ args: [base], env: FR });
  try {
    const page = b.page;
    await expect(page.getByTestId('banner-readonly')).toBeVisible();
    await openDesign(page, 'form', 'Fiche');
    await page.getByTestId('cmd-themes').click();
    await expect(page.getByTestId('theme-gallery')).toBeVisible();
    await item(page, 'Forêt').click();
    await expect(page.getByTestId('theme-gallery')).toBeVisible();   // left click does nothing
    await item(page, 'Forêt').click({ button: 'right' });
    for (const id of ['all', 'object', 'default']) await expect(page.getByTestId(`theme-menu-${id}`), id).toBeDisabled();
    expect(await baseTheme(page)).toEqual(DEFAULT_THEME);
    await expectLook(page, 'Nom', 'fz-text', DEFAULT_THEME);
    await expect(page.getByTestId('doc-tab-form-Fiche')).not.toContainText('•');
  } finally {
    await b.app.close();
    await a.app.close();
  }
});

test('dark mode: the form uses its theme dark palette, the report stays light', async () => {
  const { app, page } = await launchApp({ args: [await seed('recette-f2a-dark', OCEAN, OCEAN)], env: FR });
  try {
    await openDesign(page, 'report', 'Etat');
    await openDesign(page, 'form', 'Fiche');
    await page.evaluate(() => { document.documentElement.dataset.theme = 'dark'; });
    await expectLook(page, 'Nom', 'fz-text', OCEAN, 'dark');
    expect(accent(OCEAN, 'dark')).not.toBe(accent(OCEAN));
    await page.getByTestId('doc-tab-report-Etat').click();
    await expectLook(page, 'Tx', 'rz-text', OCEAN, 'light');
  } finally {
    await app.close();
  }
});
