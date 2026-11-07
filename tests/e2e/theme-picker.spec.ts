// Sélecteur de couleurs à l'Access (F2, tâche 4) : feuille de propriétés et onglet Format, références d'emplacement du thème avec
// nuances, Automatique, Transparent (fonds seulement), clavier, police du thème affichée « Inter (Détail) », base en lecture seule.
import { test, expect, type Page } from '@playwright/test';
import { createTable } from '../../src/main/db/schema';
import type { BasecraftApi } from '../../src/shared/api';
import type { DesignDoc } from '../../src/shared/design/model';
import { clients } from '../../src/shared/test-fixtures';
import { launchApp, seedBase, seedForm } from './helpers';

const fiche: DesignDoc = { formatVersion: '1.0', recordSource: { kind: 'table', name: 'Clients' }, props: { Width: 9072 }, sections: [
  { kind: 'detail', height: 4536, props: {}, controls: [
    { kind: 'textBox', name: 'Nom', left: 1701, top: 0, width: 2268, height: 340, props: { ControlSource: 'Nom' } }] }] };
const FR = { BASECRAFT_REGION: 'fr-FR' };
const nomProps = (page: Page) => page.evaluate((n) => (window as unknown as { basecraft: BasecraftApi }).basecraft.objects.get('form', n), 'Fiche')
  .then((r) => (r.definition as DesignDoc).sections.flatMap((x) => x.controls).find((c) => c.name === 'Nom')!.props);
const save = async (page: Page) => { await page.keyboard.press('Control+s'); await expect(page.getByTestId('doc-tab-form-Fiche')).not.toContainText('•'); await page.waitForTimeout(300); };
const openDesign = async (page: Page) => {
  await page.getByTestId('nav-item-form-Fiche').click({ button: 'right' });
  await page.getByTestId('nav-menu-design').click();
  await page.getByTestId('ctl-Nom').click();
};
const seed = (name: string) => seedBase(name, (db) => { createTable(db, clients); seedForm(db, 'Fiche', fiche); });

test('colour picker: theme slots with tints and shades, Automatic, Transparent, keyboard, Format tab, theme font label', async () => {
  test.setTimeout(180000);
  const { app, page } = await launchApp({ args: [seed('theme-picker')], env: FR });
  try {
    await openDesign(page);
    // ForeColor: no Transparent; the grid, standard colours and "More colours" are there
    await page.getByTestId('prop-ForeColor').click();
    await expect(page.getByTestId('prop-ForeColor-colors')).toBeVisible();
    for (const id of ['auto', 'theme-lt1', 'theme-accent6', 'theme-accent1-d25', 'std-c00000', 'more']) await expect(page.getByTestId(`colorpicker-${id}`), id).toBeVisible();
    await expect(page.getByTestId('prop-ForeColor-colors-custom')).toHaveCount(1);
    await expect(page.getByTestId('colorpicker-transparent')).toHaveCount(0);
    // keyboard: the roving tab stop starts on Automatic, the arrows rove
    await page.getByTestId('colorpicker-auto').focus();
    await page.keyboard.press('ArrowRight'); await expect(page.getByTestId('colorpicker-theme-lt1')).toBeFocused();
    await page.keyboard.press('ArrowDown'); await expect(page.locator('[data-testid^="colorpicker-theme-lt1-"]').first()).toBeFocused();
    // Accent 1, darker 25 %
    await page.getByTestId('colorpicker-theme-accent1-d25').click();
    await expect(page.getByTestId('prop-ForeColor')).toHaveText('Accent 1, Plus sombre 25%');
    await expect(page.getByTestId('prop-ForeColor')).toHaveAttribute('title', 'Accent 1, Plus sombre 25%');
    await save(page);
    expect((await nomProps(page)).ForeColor).toBe('theme:accent1@-25');
    expect(await page.evaluate(() => localStorage.getItem('bc.recentColors') ?? '[]')).not.toContain('theme:');   // a theme reference never enters the recent colours
    // Automatic removes the stored value
    await page.getByTestId('prop-ForeColor').click();
    await page.getByTestId('colorpicker-auto').click();
    await save(page);
    expect(await nomProps(page)).not.toHaveProperty('ForeColor');
    // BackColor offers Transparent, which hides the fill
    await page.getByTestId('prop-BackColor').click();
    await expect(page.getByTestId('colorpicker-transparent')).toBeVisible();
    await page.getByTestId('colorpicker-transparent').click();
    await save(page);
    expect((await nomProps(page)).BackStyle).toBe('transparent');
    // Format tab: the same grid, the same value
    await page.getByTestId('ribbon-tab-format').click();
    await page.getByTestId('cmd-fontColor').click();
    await expect(page.getByTestId('format-popup-fontColor-colors')).toBeVisible();
    await expect(page.getByTestId('colorpicker-transparent')).toHaveCount(0);
    await page.getByTestId('colorpicker-theme-accent1-d25').click();
    await save(page);
    expect((await nomProps(page)).ForeColor).toBe('theme:accent1@-25');
    // Format tab font box: the theme font reads « Inter (Détail) », picking a family writes the family
    await expect(page.getByTestId('prop-FontName')).toHaveValue('Inter (Détail)');
    await page.getByTestId('cmd-font').click();
    await expect(page.getByTestId('format-popup-font-name')).toHaveValue('Inter (Détail)');
    await expect(page.getByTestId('format-popup-font-name-note')).toHaveCount(0);
    await page.getByTestId('format-popup-font-name').fill('Carlito');
    await page.getByTestId('format-popup-font-name').press('Enter');
    await expect(page.getByTestId('prop-FontName')).toHaveValue('Carlito');
    await save(page);
    expect((await nomProps(page)).FontName).toBe('Carlito');
    // the property sheet lists the two theme fonts first: picking « Inter (En-têtes) » stores the reference
    await page.getByTestId('prop-FontName-toggle').click();
    await expect(page.getByTestId('prop-FontName-option-o0')).toHaveText('Inter (En-têtes)');
    await expect(page.getByTestId('prop-FontName-option-o1')).toHaveText('Inter (Détail)');
    await page.getByTestId('prop-FontName-option-o0').click();
    await save(page);
    expect((await nomProps(page)).FontName).toBe('(Headings)');
  } finally { await app.close(); }
});

test('colour picker: a read-only base opens the design but nothing can be picked or becomes dirty', async () => {
  test.setTimeout(120000);
  const base = seed('theme-picker-ro');
  const a = await launchApp({ args: [base], env: FR });
  const b = await launchApp({ args: [base], env: FR });
  try {
    const page = b.page;
    await expect(page.getByTestId('banner-readonly')).toBeVisible();
    await openDesign(page);
    await expect(page.getByTestId('prop-ForeColor')).toBeDisabled();
    await page.getByTestId('ribbon-tab-format').click();
    await expect(page.getByTestId('cmd-fontColor')).toBeDisabled();
    await expect(page.getByTestId('doc-tab-form-Fiche')).not.toContainText('•');
  } finally { await b.app.close(); await a.app.close(); }
});
