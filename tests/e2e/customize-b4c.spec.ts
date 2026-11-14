// B4c: « Ajouter à la barre d'outils Accès rapide » (clic droit), Personnaliser le ruban, modèles de formulaire et d'état,
// vérification des erreurs en mode Création.
import { test, expect, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createTable } from '../../src/main/db/schema';
import { emptyFormDoc } from '../../src/shared/design/auto-form';
import type { ControlDef } from '../../src/shared/design/model';
import { clients, t } from '../../src/shared/test-fixtures';
import { launchApp, seedBase, seedForm } from './helpers';
import { saveObject } from '../../src/main/db/objects';
import type { DatabaseSync } from 'node:sqlite';
import type { DesignDoc } from '../../src/shared/design/model';
const seedReport = (db: DatabaseSync, name: string, doc: DesignDoc) => { const r = saveObject(db, 'report', name, doc, null); if (!r.ok) throw new Error(r.reason); };

const settingsFile = (dir: string) => JSON.parse(readFileSync(join(dir, 'settings.json'), 'utf8'));
const options = async (page: Page, cat: string) => {
  await page.getByTestId('ribbon-tab-file').click();
  await page.getByTestId('bs-options').click();
  await page.getByTestId(`opt-cat-${cat}`).click();
};

test('right-click: add a ribbon button to the Quick Access Toolbar, remove it from the toolbar', async () => {
  const { app, page, userDataDir } = await launchApp({ args: [seedBase('b4c-qat.basecraft', (db) => createTable(db, t('Clients', clients.fields)))], env: { BASECRAFT_REGION: 'fr-FR' } });
  try {
    await page.getByTestId('ribbon-tab-create').click();
    await page.getByTestId('cmd-createTable').click({ button: 'right' });
    await expect(page.getByTestId('qat-menu-add')).toHaveText("Ajouter à la barre d'outils Accès rapide");
    await page.getByTestId('qat-menu-add').click();
    await expect.poll(() => settingsFile(userDataDir).quickAccess).toEqual(['save', 'undo', 'redo', 'createTable']);
    await expect(page.getByTestId('qat-createTable')).toBeVisible();
    // on the toolbar, the ribbon button offers to remove it too
    await page.getByTestId('cmd-createTable').click({ button: 'right' });
    await expect(page.getByTestId('qat-menu-remove')).toBeVisible();
    await page.keyboard.press('Escape');
    await page.getByTestId('qat-createTable').click({ button: 'right' });
    await expect(page.getByTestId('qat-menu-remove')).toHaveText("Supprimer de la barre d'outils Accès rapide");
    await page.getByTestId('qat-menu-remove').click();
    await expect.poll(() => settingsFile(userDataDir).quickAccess).toEqual(['save', 'undo', 'redo']);
    await expect(page.getByTestId('qat-createTable')).toHaveCount(0);
    // a command with a menu has it too (B4d)
    await page.getByTestId('cmd-navigationForm').click({ button: 'right' });
    await expect(page.getByTestId('qat-menu-add')).toBeVisible();
  } finally {
    await app.close();
  }
});

test('Customize Ribbon: hide a tab, a custom tab and group with a command, rename, reorder, reset', async () => {
  test.setTimeout(90000);
  const { app, page, userDataDir } = await launchApp({ args: [seedBase('b4c-ribbon.basecraft', (db) => createTable(db, t('Clients', clients.fields)))], env: { BASECRAFT_REGION: 'fr-FR' } });
  try {
    await options(page, 'ribbon');
    await expect(page.getByTestId('opt-rib-show-home')).toBeDisabled();
    // controlled by the settings pushed back from main (async): click, then wait for the new state (uncheck() checks it at once)
    await page.getByTestId('opt-rib-show-help').click();
    await expect(page.getByTestId('opt-rib-show-help')).not.toBeChecked();
    await expect.poll(() => settingsFile(userDataDir).ribbonCustom?.hidden).toEqual(['help']);
    // a custom tab with its group and a command
    await page.getByTestId('opt-rib-newtab').click();
    await expect.poll(() => settingsFile(userDataDir).ribbonCustom?.tabs?.length).toBe(1);
    await page.getByTestId('opt-rib-name').fill('Mes outils');
    await page.getByTestId('opt-rib-rename').click();
    await page.getByTestId('opt-rib-pick').selectOption('createTable');
    await page.getByTestId('opt-rib-add').click();
    await expect.poll(() => settingsFile(userDataDir).ribbonCustom.tabs[0]).toMatchObject({ id: 'c1', label: 'Mes outils', groups: [{ commands: ['createTable'] }] });
    await expect(page.getByTestId('opt-rib-cmd-g1-createTable')).toBeVisible();
    // rename a built-in tab, move the custom tab first
    await page.getByTestId('opt-rib-tab-create').click();
    await page.getByTestId('opt-rib-name').fill('Fabriquer');
    await page.getByTestId('opt-rib-rename').click();
    await page.getByTestId('opt-rib-tab-c1').click();
    for (let i = 0; i < 5; i++) await page.getByTestId('opt-rib-up').click();
    await expect.poll(() => settingsFile(userDataDir).ribbonCustom.order[0]).toBe('c1');
    await page.getByTestId('bs-back').click();
    await expect(page.getByTestId('ribbon-tab-help')).toHaveCount(0);
    await expect(page.getByTestId('ribbon-tab-create')).toHaveText('Fabriquer');
    const order = await page.locator('[data-testid^="ribbon-tab-"][role="tab"]').evaluateAll((els) => els.map((e) => e.getAttribute('data-testid')));
    expect(order.slice(0, 2)).toEqual(['ribbon-tab-c1', 'ribbon-tab-home']);
    await page.getByTestId('ribbon-tab-c1').click();
    await expect(page.getByTestId('ribbon-tab-c1')).toHaveText('Mes outils');
    await expect(page.getByTestId('ribbon-group-g1').getByTestId('cmd-createTable')).toBeEnabled();
    // reset
    await options(page, 'ribbon');
    await page.getByTestId('opt-rib-reset').click();
    await expect.poll(() => settingsFile(userDataDir).ribbonCustom).toEqual({ hidden: [], order: [], names: {}, tabs: [] });
    await page.getByTestId('bs-back').click();
    await expect(page.getByTestId('ribbon-tab-help')).toBeVisible();
    await expect(page.getByTestId('ribbon-tab-c1')).toHaveCount(0);
  } finally {
    await app.close();
  }
});

test("form template: a new form takes the template form's properties and section settings", async () => {
  const base = seedBase('b4c-template.basecraft', (db) => {
    createTable(db, t('Clients', clients.fields));
    const tpl = emptyFormDoc(null);
    seedForm(db, 'Modèle', { ...tpl, props: { ...tpl.props, Width: 5670 }, sections: tpl.sections.map((s) => (s.kind === 'detail' ? { ...s, height: 1134 } : s)) });
  });
  const { app, page, userDataDir } = await launchApp({ args: [base], env: { BASECRAFT_REGION: 'fr-FR' } });
  try {
    await page.getByTestId('ribbon-tab-create').click();
    await page.getByTestId('cmd-createFormDesign').click();   // « Normal » (the default) names no form here: the built-in blank form
    await expect(page.getByTestId('doc-tab-form-Formulaire1')).toBeVisible();
    await expect(page.getByTestId('ruler-v-detail')).toHaveCSS('height', /^151\.\d+px$/);
    await options(page, 'designers');
    await expect(page.getByTestId('opt-form-template')).toHaveValue('Normal');
    await expect(page.getByTestId('opt-report-template')).toHaveValue('Normal');
    await page.getByTestId('opt-form-template').fill('Modèle');
    await page.getByTestId('opt-form-template').press('Enter');
    await expect.poll(() => settingsFile(userDataDir).formTemplate).toBe('Modèle');
    await page.getByTestId('bs-back').click();
    await page.getByTestId('ribbon-tab-create').click();
    await page.getByTestId('cmd-createFormDesign').click();
    await expect(page.getByTestId('doc-tab-form-Formulaire2')).toBeVisible();
    await expect(page.getByTestId('ruler-v-detail').last()).toHaveCSS('height', /^75\.\d+px$/);
    await expect(page.getByTestId('ruler-h').last()).toContainText('9');   // 10 cm: the template's width
  } finally {
    await app.close();
  }
});

test('error checking: an unassociated label, an unknown field, the menu, ignore, and the options', async () => {
  test.setTimeout(90000);
  const ctl = (kind: ControlDef['kind'], name: string, left: number, props: Record<string, unknown> = {}): ControlDef =>
    ({ kind, name, left, top: 200, width: kind === 'label' ? 900 : 2000, height: 300, props });
  const base = seedBase('b4c-errors.basecraft', (db) => {
    createTable(db, t('Clients', clients.fields));
    const d = emptyFormDoc({ kind: 'table', name: 'Clients' });
    seedForm(db, 'Fiche', { ...d, sections: d.sections.map((s) => (s.kind === 'detail' ? { ...s, controls: [
      ctl('label', 'Etiquette', 100, { Caption: 'Nom :' }), ctl('textBox', 'Nom', 1100, { ControlSource: 'Nom' }), ctl('textBox', 'Fantome', 3300, { ControlSource: 'Absent' })] } : s)) });
  });
  const { app, page, userDataDir } = await launchApp({ args: [base], env: { BASECRAFT_REGION: 'fr-FR' } });
  try {
    await page.getByTestId('nav-item-form-Fiche').click({ button: 'right' });
    await page.getByTestId('nav-menu-design').click();
    await expect(page.getByTestId('ctl-Nom')).toBeVisible();
    await expect(page.getByTestId('err-Etiquette')).toBeVisible();
    await expect(page.getByTestId('err-Fantome')).toBeVisible();
    await expect(page.getByTestId('err-Nom')).toHaveCount(0);
    // the menu: message, associate, ignore
    await page.getByTestId('err-Fantome').click();
    await expect(page.getByTestId('err-message')).toContainText('Absent');
    await expect(page.getByTestId('err-associate')).toHaveCount(0);
    await page.getByTestId('err-ignore').click();
    await expect(page.getByTestId('err-Fantome')).toHaveCount(0);
    await page.getByTestId('err-Etiquette').click();
    await page.getByTestId('err-associate').click();
    await expect(page.getByTestId('err-Etiquette')).toHaveCount(0);
    await expect(page.getByTestId('doc-tab-form-Fiche')).toContainText('•');   // an edit, undoable
    await page.getByTestId('qat-undo').click();
    await expect(page.getByTestId('err-Etiquette')).toBeVisible();
    // the options: each check can be turned off
    await options(page, 'designers');
    await page.getByTestId('opt-err-unassociated').uncheck();
    await expect.poll(() => settingsFile(userDataDir).errorUnassociated).toBe(false);
    await page.getByTestId('bs-back').click();
    await expect(page.getByTestId('err-Etiquette')).toHaveCount(0);
    await options(page, 'designers');
    await page.getByTestId('opt-err-enable').uncheck();
    await expect.poll(() => settingsFile(userDataDir).errorChecking).toBe(false);
  } finally {
    await app.close();
  }
});

test('report template and the report check: a new report takes the template; a report wider than its page is flagged', async () => {
  test.setTimeout(90000);
  const report = (width: number, detail: number) => ({ formatVersion: '1.0' as const, recordSource: null, props: { Width: width, grouping: [] },
    sections: [{ kind: 'detail' as const, height: detail, props: {}, controls: [] }] });
  const base = seedBase('b4c-report.basecraft', (db) => {
    createTable(db, t('Clients', clients.fields));
    seedReport(db, 'Modèle', report(6000, 1134));
    seedReport(db, 'Large', report(20000, 1134));
  });
  const { app, page, userDataDir } = await launchApp({ args: [base], env: { BASECRAFT_REGION: 'fr-FR' } });
  try {
    await options(page, 'designers');
    await page.getByTestId('opt-report-template').fill('Modèle');
    await page.getByTestId('opt-report-template').press('Enter');
    await expect.poll(() => settingsFile(userDataDir).reportTemplate).toBe('Modèle');
    await page.getByTestId('bs-back').click();
    await page.getByTestId('ribbon-tab-create').click();
    await page.getByTestId('cmd-createReportDesign').click();
    await expect(page.getByTestId('ruler-v-detail')).toHaveCSS('height', /^75\.\d+px$/);
    await expect(page.getByTestId('err-doc')).toHaveCount(0);
    await page.getByTestId('nav-item-report-Large').click({ button: 'right' });
    await page.getByTestId('nav-menu-design').click();
    await expect(page.getByTestId('err-doc')).toBeVisible();
    await page.getByTestId('err-doc').click();
    await expect(page.getByTestId('err-message')).toContainText('plus large');
  } finally {
    await app.close();
  }
});