// B4d: what B4c left: custom groups in built-in and tool tabs, renamed built-in groups, menu commands on custom groups and the Quick
// Access Toolbar (the menu opens under the button clicked), templates for generated forms, « Ignorer l'erreur » kept in the design,
// the error indicator colour, keyboard shortcut keys in captions.
import { test, expect, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createTable } from '../../src/main/db/schema';
import { emptyFormDoc } from '../../src/shared/design/auto-form';
import type { ControlDef } from '../../src/shared/design/model';
import { clients, t } from '../../src/shared/test-fixtures';
import { inFile, launchApp, seedBase, seedForm } from './helpers';

const settingsFile = (dir: string) => JSON.parse(readFileSync(join(dir, 'settings.json'), 'utf8'));
const options = async (page: Page, cat: string) => {
  await page.getByTestId('ribbon-tab-file').click();
  await page.getByTestId('bs-options').click();
  await page.getByTestId(`opt-cat-${cat}`).click();
};
const ctl = (kind: ControlDef['kind'], name: string, left: number, props: Record<string, unknown> = {}, top = 200, children?: ControlDef[]): ControlDef =>
  ({ kind, name, left, top, width: kind === 'label' ? 900 : 2000, height: 300, props, ...(children ? { children } : {}) });

test('Customize Ribbon: groups in a built-in and a tool tab, a renamed built-in group; a menu command opens under the button clicked', async () => {
  test.setTimeout(120000);
  const { app, page, userDataDir } = await launchApp({ args: [seedBase('b4d-ribbon.basecraft', (db) => createTable(db, t('Clients', clients.fields)))], env: { BASECRAFT_REGION: 'fr-FR' } });
  try {
    await options(page, 'ribbon');
    await expect(page.getByTestId('opt-rib-tab-formDesign')).toBeVisible();   // under « Onglets d'outils »
    // a custom group in the Help tab, holding a command with a menu
    await page.getByTestId('opt-rib-tab-help').click();
    await page.getByTestId('opt-rib-newgroup').click();
    await expect.poll(() => settingsFile(userDataDir).ribbonCustom.groups?.help?.length).toBe(1);
    await page.getByTestId('opt-rib-name').fill('Mes menus');
    await page.getByTestId('opt-rib-rename').click();
    await page.getByTestId('opt-rib-pick').selectOption('moreRecords');
    await page.getByTestId('opt-rib-add').click();
    await expect.poll(() => settingsFile(userDataDir).ribbonCustom.groups.help[0]).toMatchObject({ label: 'Mes menus', commands: ['moreRecords'] });
    // rename a built-in group, and add a group to a tool tab
    await page.getByTestId('opt-rib-bgroup-create-tables').click();
    await page.getByTestId('opt-rib-name').fill('Mes tables');
    await page.getByTestId('opt-rib-rename').click();
    await expect.poll(() => settingsFile(userDataDir).ribbonCustom.groupNames).toEqual({ 'create.tables': 'Mes tables' });
    await expect(page.getByTestId('opt-rib-up')).toBeDisabled();   // a built-in group is not moved
    await page.getByTestId('opt-rib-tab-formDesign').click();
    await page.getByTestId('opt-rib-newgroup').click();
    await expect.poll(() => Object.keys(settingsFile(userDataDir).ribbonCustom.groups).sort()).toEqual(['formDesign', 'help']);
    // the menu command on the Quick Access Toolbar too (right-click on the ribbon button of a datasheet)
    await page.getByTestId('bs-back').click();
    await page.getByTestId('nav-item-Clients').dblclick();
    await page.getByTestId('cmd-moreRecords').click({ button: 'right' });
    await page.getByTestId('qat-menu-add').click();
    await expect(page.getByTestId('qat-moreRecords')).toBeVisible();
    await page.getByTestId('ribbon-tab-create').click();
    await expect(page.getByTestId('ribbon-group-tables')).toContainText('Mes tables');
    await page.getByTestId('ribbon-tab-help').click();
    const inGroup = page.getByTestId('ribbon-group-g1').getByTestId('cmd-moreRecords');
    await inGroup.click();
    const menu = page.getByTestId('more-records-menu');
    await expect(menu).toBeVisible();
    const left = async (l: ReturnType<Page['getByTestId']>) => (await l.boundingBox())!.x;
    expect(Math.abs(await left(menu) - await left(inGroup))).toBeLessThan(2);
    // the button that was clicked closes it (no reopening), and the other one anchors it
    await inGroup.click();
    await expect(menu).toHaveCount(0);
    await page.getByTestId('qat-moreRecords').click();
    await expect(menu).toBeVisible();
    expect(Math.abs(await left(menu) - await left(page.getByTestId('qat-moreRecords')))).toBeLessThan(2);
  } finally {
    await app.close();
  }
});

test('templates: Navigation Form starts from the form template, never shorter than its content needs', async () => {
  test.setTimeout(90000);
  const base = seedBase('b4d-template.basecraft', (db) => {
    createTable(db, t('Clients', clients.fields));
    const tpl = emptyFormDoc(null);
    seedForm(db, 'Modèle', { ...tpl, props: { ...tpl.props, BackColor: '#ccddee' }, sections: tpl.sections.map((s) => (s.kind === 'detail' ? { ...s, height: 10000 } : s)) });
  });
  const { app, page, userDataDir } = await launchApp({ args: [base], env: { BASECRAFT_REGION: 'fr-FR' } });
  try {
    await options(page, 'designers');
    await page.getByTestId('opt-form-template').fill('Modèle');
    await page.getByTestId('opt-form-template').press('Enter');
    await expect.poll(() => settingsFile(userDataDir).formTemplate).toBe('Modèle');
    await page.getByTestId('bs-back').click();
    await page.getByTestId('ribbon-tab-create').click();
    await page.getByTestId('cmd-navigationForm').click();
    await page.getByTestId('choice-horizontal').click();
    await expect(page.getByTestId('doc-tab-form-Formulaire de navigation')).toBeVisible();
    await expect(page.getByTestId('ruler-v-detail')).toHaveCSS('height', /^66[67]\.\d+px$/);   // 10000 twips: the template's height (the content needs 6804)
  } finally {
    await app.close();
  }
});

test('error checking: « Ignorer l\'erreur » is saved with the design; the indicator colour option', async () => {
  test.setTimeout(120000);
  const base = seedBase('b4d-ignore.basecraft', (db) => {
    createTable(db, t('Clients', clients.fields));
    const d = emptyFormDoc({ kind: 'table', name: 'Clients' });
    seedForm(db, 'Fiche', { ...d, sections: d.sections.map((s) => (s.kind === 'detail' ? { ...s, controls: [
      ctl('label', 'Etiquette', 100, { Caption: 'Nom :' }), ctl('textBox', 'Nom', 1100, { ControlSource: 'Nom' }), ctl('textBox', 'Fantome', 3300, { ControlSource: 'Absent' })] } : s)) });
  });
  const { app, page, userDataDir } = await launchApp({ args: [base], env: { BASECRAFT_REGION: 'fr-FR' } });
  try {
    await page.getByTestId('nav-item-form-Fiche').click({ button: 'right' });
    await page.getByTestId('nav-menu-design').click();
    await expect(page.getByTestId('err-Fantome')).toBeVisible();
    await expect(page.getByTestId('err-Etiquette')).toHaveCSS('background-color', 'rgb(46, 157, 63)');
    await page.getByTestId('err-Fantome').click();
    await page.getByTestId('err-ignore').click();
    await expect(page.getByTestId('err-Fantome')).toHaveCount(0);
    await page.getByTestId('qat-save').click();
    await expect.poll(() => inFile<{ definition: string }>(base, "SELECT definition FROM bc_objects WHERE kind = 'form' AND name = 'Fiche'")[0]!.definition).toContain('"IgnoreErrors":["unknownField"]');
    // closed and opened again: still ignored (the other error is still there)
    await page.getByTestId('doc-tab-close-form-Fiche').click();
    await page.getByTestId('nav-item-form-Fiche').click({ button: 'right' });
    await page.getByTestId('nav-menu-design').click();
    await expect(page.getByTestId('err-Etiquette')).toBeVisible();
    await expect(page.getByTestId('err-Fantome')).toHaveCount(0);
    // the indicator colour
    await options(page, 'designers');
    await page.getByTestId('opt-err-color').fill('#ff0000');
    await expect.poll(() => settingsFile(userDataDir).errorColor).toBe('#ff0000');
    await page.getByTestId('bs-back').click();
    await expect(page.getByTestId('err-Etiquette')).toHaveCSS('background-color', 'rgb(255, 0, 0)');
  } finally {
    await app.close();
  }
});

test('shortcut keys in captions: underlined, Alt+key focuses the control, duplicate and invalid keys are errors', async () => {
  test.setTimeout(120000);
  const base = seedBase('b4d-keys.basecraft', (db) => {
    createTable(db, t('Clients', clients.fields));
    const d = emptyFormDoc({ kind: 'table', name: 'Clients' });
    seedForm(db, 'Cles', { ...d, sections: d.sections.map((s) => (s.kind === 'detail' ? { ...s, controls: [
      ctl('textBox', 'Nom', 1100, { ControlSource: 'Nom' }, 200, [ctl('label', 'LNom', 100, { Caption: '&Nom' }, 200)]),
      ctl('textBox', 'Email', 1100, { ControlSource: 'Email' }, 700, [ctl('label', 'LEmail', 100, { Caption: 'E&mail' }, 700)]),
      ctl('commandButton', 'Dup', 3300, { Caption: '&Nouveau' }), ctl('commandButton', 'Bad', 5400, { Caption: '& x' })] } : s)) });
  });
  const { app, page } = await launchApp({ args: [base], env: { BASECRAFT_REGION: 'fr-FR' } });
  try {
    await page.getByTestId('nav-item-form-Cles').dblclick();
    await expect(page.getByTestId('form-ctl-LNom').locator('u')).toHaveText('N');
    await expect(page.getByTestId('form-ctl-LNom')).toHaveText('Nom');
    await expect(page.getByTestId('form-ctl-Dup')).toHaveText('Nouveau');
    await page.getByTestId('form-ctl-Email').click();
    await page.keyboard.press('Alt+N');
    await expect(page.getByTestId('form-ctl-Nom')).toBeFocused();
    await page.keyboard.press('Alt+M');
    await expect(page.getByTestId('form-ctl-Email')).toBeFocused();
    // Design view: the duplicate key and the invalid one are reported
    await page.getByTestId('doc-tab-close-form-Cles').click();
    await page.getByTestId('nav-item-form-Cles').click({ button: 'right' });
    await page.getByTestId('nav-menu-design').click();
    await expect(page.getByTestId('err-Dup')).toBeVisible();
    await expect(page.getByTestId('err-Bad')).toBeVisible();
    await page.getByTestId('err-Dup').click();
    await expect(page.getByTestId('err-message')).toContainText('« N »');
  } finally {
    await app.close();
  }
});
