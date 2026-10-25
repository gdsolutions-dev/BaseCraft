// B1 Task 10: the macro designer — blocks (actions, If, Submacro), typed argument editors (object list, Where Condition and
// condition in display form, stored canonical), Save with its name, Design view reopening, an unknown action kept as stored.
// B1 Task 11: the Macro Design tab — Run (saved first), Single Step, Expand / Collapse, Action Catalog, Show All Actions.
import { test, expect, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { saveObject } from '../../src/main/db/objects';
import { seedSales } from '../../src/main/query/test-db';
import type { BasecraftApi } from '../../src/shared/api';
import type { ControlDef, DesignDoc } from '../../src/shared/design/model';
import type { MacroDef, MacroItem } from '../../src/shared/macro/model';
import { launchApp, seedBase, seedForm } from './helpers';

const fr = JSON.parse(readFileSync(join(__dirname, '../../src/shared/i18n/fr.json'), 'utf8'));
const FR = { BASECRAFT_REGION: 'fr-FR' };
const act = (action: string, args: Record<string, string> = {}): MacroItem => ({ k: 'action', action, args });
const macro = (db: DatabaseSync, name: string, items: MacroItem[]) => {
  const r = saveObject(db, 'macro', name, { formatVersion: '1.0', items }, null);
  if (!r.ok) throw new Error(r.reason);
};
const box = (name: string, top: number): ControlDef => ({ kind: 'textBox', name, left: 1701, top, width: 2268, height: 340, props: { ControlSource: name } });
const FCLIENTS: DesignDoc = {
  formatVersion: '1.0', recordSource: { kind: 'table', name: 'Clients' }, props: { Width: 9072 },
  sections: [{ kind: 'formHeader', height: 0, props: { Visible: false }, controls: [] },
    { kind: 'detail', height: 1200, props: {}, controls: [box('Nom', 100), box('Ville', 600)] },
    { kind: 'formFooter', height: 0, props: { Visible: false }, controls: [] }],
};
const UNKNOWN = act('ImportXML', { DataSource: 'C:\\données\\clients.xml', ImportOptions: '1' });
const base = () => seedBase('macro-design', (db) => {
  seedSales(db);
  seedForm(db, 'FClients', FCLIENTS);
  macro(db, 'MInconnu', [UNKNOWN, act('Beep')]);
  macro(db, 'MDeux', [act('MessageBox', { Message: 'A' }), act('MessageBox', { Message: 'B' })]);
});
const getMacro = (page: Page, name: string) => page.evaluate((n) => (window as unknown as { basecraft: BasecraftApi }).basecraft.objects.get('macro', n), name)
  .then((r) => r.definition as MacroDef);

/** « Ajouter une nouvelle action » of the list `key`: its option `id` picked from the list. */
async function add(page: Page, key: string, id: string) {
  await page.getByTestId(`macro-add-${key}-toggle`).click();
  await page.getByTestId(`macro-add-${key}-option-${id}`).click();
}
async function openDesign(page: Page, name: string) {
  await page.getByTestId(`nav-item-macro-${name}`).click({ button: 'right' });
  await page.getByTestId('nav-menu-design').click();
  await expect(page.getByTestId('macro-design')).toBeVisible();
}

test('Macro designer: OpenForm with a Where Condition, an If with a MessageBox, a submacro; saved canonical, reopened in display form', async () => {
  const { app, page } = await launchApp({ args: [base()], env: FR });
  try {
    await page.getByTestId('ribbon-tab-create').click();
    await page.getByTestId('cmd-createMacro').click();
    await expect(page.getByTestId('macro-design')).toBeVisible();

    // OuvrirFormulaire, typed in « Ajouter une nouvelle action »; FClients picked in « Nom du formulaire »
    await page.getByTestId('macro-add-root').fill(fr.macro.action.OpenForm);
    await expect(page.getByTestId('macro-item-0')).toContainText(fr.macro.action.OpenForm);
    await expect(page.getByTestId('macro-arg-0-FormName')).toContainText(fr.macro.arg.FormName);
    await page.getByTestId('macro-arg-0-FormName-input-toggle').click();
    await page.getByTestId('macro-arg-0-FormName-input-option-FClients').click();
    await expect(page.getByTestId('macro-arg-0-FormName-input')).toHaveValue('FClients');
    await expect(page.getByTestId('macro-arg-0-View-input')).toHaveValue('form');   // the default
    await page.getByTestId('macro-arg-0-WhereCondition-input').fill('[Ville]="Lyon"');
    await page.getByTestId('macro-arg-0-WhereCondition-input').press('Enter');

    // a Si block with a decimal comma and a TempVar in French, ZoneMessage inside
    await add(page, 'root', 'block-if');
    await page.getByTestId('macro-if-1-0').fill('[VarTemp]![n]>1,5');
    await page.getByTestId('macro-if-1-0').press('Enter');
    await add(page, '1.0', 'MessageBox');
    await expect(page.getByTestId('macro-item-1.0.0')).toContainText(fr.macro.action.MessageBox);
    await page.getByTestId('macro-arg-1.0.0-Message-input').fill('Bonjour');

    // a Sous-macro: always last, at the top level
    await add(page, 'root', 'block-submacro');
    await expect(page.getByTestId('macro-sub-2')).toHaveValue('Sub1');

    // Ctrl+S: the name is asked (a new macro)
    await page.keyboard.press('Control+s');
    await page.getByTestId('modal-input').fill('MTest');
    await page.getByTestId('modal-btn-ok').click();
    await expect(page.getByTestId('doc-tab-macro-MTest')).toBeVisible();
    await expect(page.getByTestId('nav-item-macro-MTest')).toBeVisible();

    const def = await getMacro(page, 'MTest');
    expect(def.items).toEqual([
      act('OpenForm', { FormName: 'FClients', WhereCondition: '[Ville] = "Lyon"' }),
      { k: 'if', branches: [{ cond: '[TempVars]![n] > 1.5', items: [act('MessageBox', { Message: 'Bonjour' })] }] },
      { k: 'submacro', name: 'Sub1', items: [] },
    ]);

    // reopened in Design view: display form (French)
    await page.getByTestId('doc-tab-close-macro-MTest').click();
    await openDesign(page, 'MTest');
    await expect(page.getByTestId('macro-arg-0-FormName-input')).toHaveValue('FClients');
    await expect(page.getByTestId('macro-arg-0-WhereCondition-input')).toHaveValue('[Ville] = "Lyon"');
    await expect(page.getByTestId('macro-if-1-0')).toHaveValue('[VarTemp]![n] > 1,5');
    await expect(page.getByTestId('macro-arg-1.0.0-Message-input')).toHaveValue('Bonjour');

    // an empty condition is refused on Save (nothing saved); closing asks about the changes
    await page.getByTestId('macro-if-1-addElseIf').click();
    await page.keyboard.press('Control+s');
    await expect(page.getByTestId('modal')).toContainText(fr.macro.issue.emptyCondition.replace('{{path}}', 'items[1].branches[1].cond'));
    await page.getByTestId('modal-btn-ok').click();
    expect((await getMacro(page, 'MTest')).items[1]).toMatchObject({ branches: [{}] });
    await page.getByTestId('doc-tab-close-macro-MTest').click();
    await expect(page.getByTestId('modal')).toContainText(fr.macro.saveFirst.replace('{{name}}', 'MTest'));
    await page.getByTestId('modal-btn-no').click();
    await expect(page.getByTestId('doc-tab-macro-MTest')).toHaveCount(0);
  } finally {
    await app.close();
  }
});

test('An unknown action shows « Action inconnue » with its arguments read-only, and saving keeps it as stored', async () => {
  const { app, page } = await launchApp({ args: [base()], env: FR });
  try {
    await openDesign(page, 'MInconnu');
    await expect(page.getByTestId('macro-item-0')).toContainText(fr.macro.unknownAction.replace('{{name}}', 'ImportXML'));
    await expect(page.getByTestId('macro-arg-0-DataSource').locator('input')).toHaveValue('C:\\données\\clients.xml');
    await expect(page.getByTestId('macro-arg-0-DataSource').locator('input')).not.toBeEditable();

    // an edit elsewhere, then Save: the unknown action stays as it was
    await page.getByTestId('macro-item-1').click();
    await page.keyboard.press('Delete');
    await expect(page.getByTestId('macro-item-1')).toHaveCount(0);
    await page.keyboard.press('Control+s');
    await expect.poll(async () => (await getMacro(page, 'MInconnu')).items).toEqual([UNKNOWN]);
  } finally {
    await app.close();
  }
});

test('Read-only base: the designer and Save are disabled; a macro offers no Datasheet view', async () => {
  const file = base();
  const a = await launchApp({ args: [file], env: FR });
  const b = await launchApp({ args: [file], env: FR });
  try {
    const page = b.page;
    await expect(page.getByTestId('banner-readonly')).toBeVisible();
    await openDesign(page, 'MInconnu');
    await expect(page.getByTestId('macro-add-root')).toBeDisabled();
    await expect(page.getByTestId('status-view-datasheet')).toHaveCount(0);
    await page.getByTestId('macro-item-1').click();
    await page.keyboard.press('Delete');
    await expect(page.getByTestId('macro-item-1')).toBeVisible();   // nothing removed
    // the Macro Design commands change nothing in the file: enabled on a read-only base; the catalogue adds nothing
    for (const id of ['macroRun', 'singleStep', 'collapseActions', 'expandAll', 'collapseAll', 'actionCatalog', 'showAllActions']) {
      await expect(page.getByTestId(`cmd-${id}`), id).toBeEnabled();
    }
    await page.getByTestId('cmd-actionCatalog').click();
    await page.getByTestId('macro-catalog-item-Beep').dblclick();
    await expect(page.getByTestId('macro-item-2')).toHaveCount(0);
    await page.getByTestId('ribbon-tab-home').click();
    await expect(page.getByTestId('cmd-save')).toBeDisabled();
    await expect(page.getByTestId('cmd-viewDatasheet')).toHaveCount(0);
    await expect(page.getByTestId('cmd-viewDesign')).toBeVisible();
  } finally {
    await b.app.close();
    await a.app.close();
  }
});

test('Ctrl+Down moves the selected block, not from a field being typed in (its text stays with its action)', async () => {
  const { app, page } = await launchApp({ args: [base()], env: FR });
  try {
    await openDesign(page, 'MDeux');
    const message = (i: number) => page.getByTestId(`macro-arg-${i}-Message-input`);
    await message(0).click();   // selects its block, as a user does
    await message(0).fill('A2');
    await page.keyboard.press('Control+ArrowDown');   // typing: nothing moves
    await expect(message(0)).toHaveValue('A2');
    await expect(message(1)).toHaveValue('B');
    await page.getByTestId('macro-item-0').locator('.macro-title').click();   // commits the field, selects the block
    await page.keyboard.press('Control+ArrowDown');
    await expect(message(0)).toHaveValue('B');
    await expect(message(1)).toHaveValue('A2');
    await expect(page.getByTestId('macro-item-1')).toBeFocused();   // the focus follows the block
    await page.keyboard.press('Control+s');
    await expect.poll(async () => (await getMacro(page, 'MDeux')).items)
      .toEqual([act('MessageBox', { Message: 'B' }), act('MessageBox', { Message: 'A2' })]);
  } finally {
    await app.close();
  }
});

const pressed = (page: Page, id: string, on: boolean) => expect(page.getByTestId(`cmd-${id}`)).toHaveAttribute('aria-pressed', String(on));

test('Macro Design tab: selected on opening, in Access order; Run saves a new macro first (No runs nothing); the catalogue adds after the selection', async () => {
  const { app, page } = await launchApp({ args: [base()], env: FR });
  try {
    await page.getByTestId('ribbon-tab-create').click();
    await page.getByTestId('cmd-createMacro').click();
    await expect(page.getByTestId('ribbon-tab-macroDesign')).toHaveAttribute('aria-selected', 'true');
    const layout = await page.locator('.rbody [data-testid^="ribbon-group-"]').evaluateAll((gs) => gs.map((g) =>
      `${g.getAttribute('data-testid')}: ${[...g.querySelectorAll('[data-testid^="cmd-"]')].map((c) => c.getAttribute('data-testid')).join(' ')}`));
    expect(layout).toEqual([
      'ribbon-group-tools: cmd-macroRun cmd-singleStep',
      'ribbon-group-expandCollapse: cmd-expandActions cmd-collapseActions cmd-expandAll cmd-collapseAll',
      'ribbon-group-showHide: cmd-actionCatalog cmd-showAllActions',
    ]);
    await expect(page.getByTestId('ribbon-group-tools')).toHaveAttribute('aria-label', fr.ribbon.group.tools);
    await expect(page.getByTestId('cmd-macroRun')).toContainText(fr.ribbon.cmd.macroRun);
    await expect(page.getByTestId('cmd-singleStep')).toContainText(fr.ribbon.cmd.singleStep);

    // a new macro shows the Action Catalog; a double-click adds at the end, Enter after the selected block
    await expect(page.getByTestId('macro-catalog')).toBeVisible();
    await pressed(page, 'actionCatalog', true);
    await expect(page.getByTestId('macro-catalog-flow')).toContainText(fr.macro.catalog.flow);
    await page.getByTestId('macro-catalog-item-MessageBox').dblclick();
    await page.getByTestId('macro-arg-0-Message-input').fill('Un');
    await page.getByTestId('macro-catalog-item-Beep').dblclick();
    await page.getByTestId('macro-item-0').locator('.macro-title').click();
    await page.getByTestId('macro-catalog-item-MessageBox').press('Enter');
    await page.getByTestId('macro-arg-1-Message-input').fill('Deux');
    await expect(page.getByTestId('macro-item-2')).toContainText(fr.macro.action.Beep);

    // Run on an unsaved macro: No runs nothing; Yes asks the name, saves, then runs
    await page.getByTestId('cmd-macroRun').click();
    await expect(page.getByTestId('modal')).toContainText(fr.macro.saveBeforeRun);
    await page.getByTestId('modal-btn-no').click();
    await expect(page.getByTestId('macro-msgbox')).toHaveCount(0);
    await page.getByTestId('cmd-macroRun').click();
    await page.getByTestId('modal-btn-yes').click();
    await page.getByTestId('modal-input').fill('MExec');
    await page.getByTestId('modal-btn-ok').click();
    await expect(page.getByTestId('macro-msgbox-text')).toHaveText('Un');
    await page.getByTestId('macro-msgbox-ok').click();
    await expect(page.getByTestId('macro-msgbox-text')).toHaveText('Deux');
    await page.getByTestId('macro-msgbox-ok').click();
    await expect(page.getByTestId('doc-tab-macro-MExec')).toBeVisible();
    expect((await getMacro(page, 'MExec')).items.map((i) => (i.k === 'action' ? i.action : i.k))).toEqual(['MessageBox', 'MessageBox', 'Beep']);
  } finally {
    await app.close();
  }
});

test('Single Step: Step runs the action and stops at the next, Stop All ends the run; Collapse All, Action Catalog and Show All Actions', async () => {
  const { app, page } = await launchApp({ args: [base()], env: FR });
  try {
    await openDesign(page, 'MDeux');
    await expect(page.getByTestId('ribbon-tab-macroDesign')).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByTestId('macro-catalog')).toHaveCount(0);   // a saved macro opens without the catalogue

    // Single Step pressed: Run stops before each action
    await pressed(page, 'singleStep', false);
    await page.getByTestId('cmd-singleStep').click();
    await pressed(page, 'singleStep', true);
    await page.getByTestId('cmd-macroRun').click();
    await expect(page.getByTestId('macro-step-macro')).toHaveText('MDeux');
    await expect(page.getByTestId('macro-step-condition')).toHaveText(fr.macro.step.none);
    await expect(page.getByTestId('macro-step-action')).toHaveText(fr.macro.action.MessageBox);
    await expect(page.getByTestId('macro-step-args')).toContainText('A');
    await page.getByTestId('macro-step-step').click();
    await expect(page.getByTestId('macro-msgbox-text')).toHaveText('A');
    await page.getByTestId('macro-msgbox-ok').click();
    await expect(page.getByTestId('macro-step-args')).toContainText('B');
    await page.getByTestId('macro-step-stop').click();
    await expect(page.getByTestId('macro-step')).toHaveCount(0);
    await expect(page.getByTestId('macro-msgbox')).toHaveCount(0);

    // Expand / Collapse Actions need a selection; Collapse All hides every argument row, Expand All brings them back
    await expect(page.getByTestId('cmd-collapseActions')).toBeDisabled();
    await page.getByTestId('macro-item-0').locator('.macro-title').click();
    await page.getByTestId('cmd-collapseActions').click();
    await expect(page.getByTestId('macro-arg-0-Message')).toHaveCount(0);
    await expect(page.getByTestId('macro-arg-1-Message')).toBeVisible();
    await page.getByTestId('cmd-expandActions').click();
    await expect(page.getByTestId('macro-arg-0-Message')).toBeVisible();
    await page.getByTestId('cmd-collapseAll').click();
    await expect(page.getByTestId('macro-design').locator('.macro-arg')).toHaveCount(0);
    await page.getByTestId('cmd-expandAll').click();
    await expect(page.getByTestId('macro-design').locator('.macro-arg')).toHaveCount(8);

    // Action Catalog toggles the pane; Show All Actions lists the unsafe ones (ExécuterSQL), searched without accents
    await page.getByTestId('cmd-actionCatalog').click();
    await expect(page.getByTestId('macro-catalog')).toBeVisible();
    await pressed(page, 'actionCatalog', true);
    await page.getByTestId('macro-catalog-search').fill('executersql');
    await expect(page.getByTestId('macro-catalog-item-RunSQL')).toHaveCount(0);
    await page.getByTestId('cmd-showAllActions').click();
    await pressed(page, 'showAllActions', true);
    await expect(page.getByTestId('macro-catalog-item-RunSQL')).toHaveText(fr.macro.action.RunSQL);
    await expect(page.getByTestId('macro-catalog').locator('li')).toHaveCount(1);
    await page.getByTestId('cmd-actionCatalog').click();
    await expect(page.getByTestId('macro-catalog')).toHaveCount(0);
  } finally {
    await app.close();
  }
});
