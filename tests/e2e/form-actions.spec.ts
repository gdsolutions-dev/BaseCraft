// B2 Task 8: the running form's instance — [Forms]! in macros, Where Conditions, queries and calculated controls (R11), the form
// actions (GoToRecord, GoToControl, SetProperty, ApplyFilter, ShowAllRecords, FindRecord, SaveRecord, UndoRecord, DeleteRecord,
// Requery), control events nesting inside a macro (R6), a save asked during Before Update (2115), a form closed under its macro
// (Review Focus 4).
import { test, expect, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { saveObject } from '../../src/main/db/objects';
import { seedSales } from '../../src/main/query/test-db';
import type { BasecraftApi } from '../../src/shared/api';
import type { ControlDef, DesignDoc } from '../../src/shared/design/model';
import type { MacroItem } from '../../src/shared/macro/model';
import { launchApp, seedBase, seedForm } from './helpers';

const fr = JSON.parse(readFileSync(join(__dirname, '../../src/shared/i18n/fr.json'), 'utf8'));
const FR = { BASECRAFT_REGION: 'fr-FR' };
const act = (action: string, args: Record<string, string> = {}): MacroItem => ({ k: 'action', action, args });
const embedded = (...items: MacroItem[]) => ({ embedded: { formatVersion: '1.0' as const, items } });
const msg = (message: string) => act('MessageBox', { Message: message, Title: 'Test', Beep: 'no', Type: 'none' });
const box = (kind: ControlDef['kind'], name: string, top: number, props: Record<string, unknown>, left = 1701): ControlDef =>
  ({ kind, name, left, top, width: 2268, height: 340, props });
const button = (name: string, top: number, ...items: MacroItem[]) => box('commandButton', name, top, { Caption: name, OnClick: embedded(...items) }, 5000);
const form = (source: string | null, controls: ControlDef[], props: Record<string, unknown> = {}): DesignDoc => ({
  formatVersion: '1.0', recordSource: source ? { kind: 'table', name: source } : null, props: { Width: 9072, ...props },
  sections: [{ kind: 'formHeader', height: 0, props: { Visible: false }, controls: [] },
    { kind: 'detail', height: 9000, props: {}, controls },
    { kind: 'formFooter', height: 0, props: { Visible: false }, controls: [] }],
});
const log = (name: string) => embedded(act('SetTempVar', { Name: 'Log', Expression: `[TempVars]![Log] & "|${name}"` }));
const rows = (page: Page, table: string) => page.evaluate((n) => (window as unknown as { basecraft: BasecraftApi }).basecraft.rows.page(n, { offset: 0, limit: 100 })
  .then((p) => p.rows.map((r) => r.values)), table);

const base = () => seedBase('form-actions', (db) => {
  seedSales(db);
  seedForm(db, 'FClients', form('Clients', [
    box('textBox', 'N°', 100, { ControlSource: 'N°', TabIndex: 0 }),
    box('textBox', 'Nom', 600, { ControlSource: 'Nom', TabIndex: 1 }),
    box('textBox', 'Ville', 1100, { ControlSource: 'Ville', TabIndex: 2 }),
    box('comboBox', 'cboMeme', 1600, { TabIndex: 3, RowSourceType: 'tableQuery', RowSource: 'SELECT Nom FROM Clients WHERE Ville = [Forms]![FClients]![Ville];' }),
    button('cmdCommandes', 100, act('OpenForm', { FormName: 'FCommandes', View: 'form', WhereCondition: '[Client] = [Forms]![FClients]![N°]' })),
    button('cmdNom', 500, act('OpenForm', { FormName: 'FClients2', View: 'form', WhereCondition: '[Nom] = [Forms]![FClients]![Nom]' })),
    button('cmdVille', 900, msg('=[Forms]![FClients]![Ville]')),
    button('cmdDernier', 1300, act('GoToRecord', { Record: 'last' })),
    button('cmdAllerVille', 1700, act('GoToControl', { ControlName: 'Ville' })),
    button('cmdMasquer', 2100, act('SetProperty', { ControlName: 'Ville', Property: 'visible', Value: 'Non' })),
    button('cmdFiltrer', 2500, act('ApplyFilter', { WhereCondition: '[Ville] = "Paris"' })),
    button('cmdTous', 2900, act('ShowAllRecords')),
    button('cmdChercher', 3300, act('FindRecord', { FindWhat: 'Durand', Match: 'whole', MatchCase: 'no', Search: 'all', OnlyCurrentField: 'no', FindFirst: 'yes' })),
    button('cmdEnreg', 3700, act('SaveRecord')),
    button('cmdAnnuler', 4100, act('UndoRecord')),
    button('cmdSuppr', 4500, act('SetWarnings', { WarningsOn: 'no' }), act('DeleteRecord')),
    button('cmdRequery', 4900, act('Requery', { ControlName: 'cboMeme' })),
    button('cmdBoite', 5300, msg('Attente'), act('GoToControl', { ControlName: 'Nom' })),
  ]));
  seedForm(db, 'FCommandes', form('Commandes', [box('textBox', 'Client', 100, { ControlSource: 'Client' })]));
  seedForm(db, 'FClients2', form('Clients', [box('textBox', 'Nom', 100, { ControlSource: 'Nom' })]));
  seedForm(db, 'FAutre', form(null, [box('textBox', 'Calc', 100, { ControlSource: '=[Forms]![FClients]![Nom]' })]));
  seedForm(db, 'FNid', form('Commandes', [
    box('textBox', 'Client', 100, { ControlSource: 'Client', TabIndex: 0,
      OnChange: embedded(act('GoToControl', { ControlName: 'Montant' })),
      BeforeUpdate: embedded({ k: 'if', branches: [{ cond: '[Client] > 5', items: [act('CancelEvent')] }] }) }),
    box('textBox', 'Montant', 600, { ControlSource: 'Montant', TabIndex: 1, OnEnter: log('Enter'), OnGotFocus: log('GotFocus'), OnExit: log('Exit'), OnLostFocus: log('LostFocus') }),
    button('cmdAller', 100, act('GoToControl', { ControlName: 'Montant' }), msg('=[TempVars]![Log] & ";" & [Montant]')),
    box('commandButton', 'cmdDouble', 500, { Caption: 'Double', OnClick: log('Click'), OnDblClick: log('DblClick') }, 5000),
    button('cmdLog', 900, msg('=[TempVars]![Log]'), act('RemoveTempVar', { Name: 'Log' })),
  ]));
  seedForm(db, 'FAvant', form('Commandes', [box('textBox', 'Montant', 100, { ControlSource: 'Montant' })], { BeforeUpdate: embedded(act('SaveRecord')) }));
  seedForm(db, 'FInsert', form('Clients', [box('textBox', 'Nom', 100, { ControlSource: 'Nom', TabIndex: 0 }), box('textBox', 'Ville', 600, { ControlSource: 'Ville', TabIndex: 1 })],
    { BeforeInsert: embedded(act('GoToControl', { ControlName: 'Ville' })) }));
  seedForm(db, 'FCharge', form('Clients', [box('textBox', 'Nom', 100, { ControlSource: 'Nom', TabIndex: 0 }), box('textBox', 'Ville', 600, { ControlSource: 'Ville', TabIndex: 1 }),
    box('textBox', 'Remarque', 1100, { TabIndex: 2 })],
  { OnLoad: embedded(act('GoToControl', { ControlName: 'Ville' }), act('SetValue', { Item: '[Remarque]', Expression: '"Prêt"' }), act('ApplyFilter', { WhereCondition: '[Ville] = "Paris"' })) }));
  seedForm(db, 'FValeur', form('Commandes', [
    box('textBox', 'Montant', 100, { ControlSource: 'Montant', BeforeUpdate: log('BeforeUpdate'), AfterUpdate: log('AfterUpdate') }),
    button('cmdSet', 100, act('SetValue', { Item: '[Montant]', Expression: '42' })),
    button('cmdEnreg', 500, act('SaveRecord')),
    button('cmdLog', 900, msg('="L:" & [TempVars]![Log]')),
    button('cmdSuppr', 1300, act('DeleteRecord')),
  ], { OnDelete: embedded(act('CancelEvent')) }));
  saveObject(db, 'query', 'QCommandesClient', { formatVersion: '1.0', sql: 'SELECT * FROM Commandes WHERE Client = [Forms]![FClients]![N°];' }, null);
});

async function open(page: Page, kind: 'form' | 'query', name: string) {
  await page.getByTestId(`nav-item-${kind}-${name}`).dblclick();
  await expect(page.getByTestId(`doc-tab-${kind}-${name}`)).toBeVisible();
}
async function msgbox(page: Page, text?: string | RegExp) {
  await expect(page.getByTestId('macro-msgbox')).toBeVisible();
  if (text !== undefined) await expect(page.getByTestId('macro-msgbox-text')).toHaveText(text);
  await page.getByTestId('macro-msgbox-ok').click();
  await expect(page.getByTestId('macro-msgbox')).toHaveCount(0);
}
async function failed(page: Page, message: string) {
  await expect(page.getByTestId('macro-failed')).toBeVisible();
  await expect(page.getByTestId('macro-failed-message')).toContainText(message);
  await page.getByTestId('macro-failed-stop').click();
  await expect(page.getByTestId('modal')).toHaveCount(0);
}
async function close(page: Page, kind: 'form' | 'query', name: string) {
  await page.getByTestId(`doc-tab-close-${kind}-${name}`).click();
  await expect(page.getByTestId(`doc-tab-${kind}-${name}`)).toHaveCount(0);
}
const shown = (page: Page, id: string) => page.locator(`[data-testid="${id}"]:visible`);

test('[Forms]! reaches the open form: Where Conditions, a message, a query parameter, a calculated control on another form', async () => {
  test.setTimeout(90_000);
  const { app, page } = await launchApp({ args: [base()], env: FR });
  const ctl = (n: string) => shown(page, `form-ctl-${n}`);
  try {
    await open(page, 'form', 'FClients');
    await expect(ctl('Nom')).toHaveValue('Dupont');
    await ctl('Nom').press('PageDown');
    await expect(ctl('Nom')).toHaveValue('Martin');
    await ctl('cmdCommandes').click();
    await expect(page.getByTestId('doc-tab-form-FCommandes')).toBeVisible();
    await expect(shown(page, 'nav-record-count')).toHaveText('2');
    await close(page, 'form', 'FCommandes');
    await page.getByTestId('doc-tab-form-FClients').click();

    // a name that would break a quoted SQL text: exactly its own record (Review Focus 3)
    await shown(page, 'nav-new').click();
    await ctl('Nom').fill('O\'Brien" OR 1=1 --');
    await ctl('Nom').press('Shift+Enter');
    await expect(shown(page, 'form-dirty')).toHaveCount(0);
    await ctl('cmdNom').click();
    await expect(page.getByTestId('doc-tab-form-FClients2')).toBeVisible();
    await expect(shown(page, 'nav-record-count')).toHaveText('1');
    await expect(ctl('Nom')).toHaveValue('O\'Brien" OR 1=1 --');
    await close(page, 'form', 'FClients2');
    await page.getByTestId('doc-tab-form-FClients').click();

    // what is typed, not yet saved (Review Focus 3)
    await ctl('Ville').fill('Nantes');
    await ctl('cmdVille').click();
    await msgbox(page, 'Nantes');
    await ctl('Ville').click();
    await ctl('Ville').press('Escape');
    await expect(shown(page, 'form-dirty')).toHaveCount(0);

    // a query reads the open form's control, with no prompt; a calculated control on another form too
    await ctl('Nom').press('Control+Home');
    await expect(ctl('Nom')).toHaveValue('Dupont');
    await open(page, 'form', 'FAutre');
    await expect(ctl('Calc')).toHaveValue('Dupont');
    await close(page, 'form', 'FAutre');
    await open(page, 'query', 'QCommandesClient');
    await expect(shown(page, 'nav-record-count')).toHaveText('2');
    await expect(page.getByTestId('modal')).toHaveCount(0);
    await close(page, 'query', 'QCommandesClient');
    await close(page, 'form', 'FClients');
    // the form closed: the parameter is asked, labelled with the reference
    await page.getByTestId('nav-item-query-QCommandesClient').dblclick();
    await expect(page.getByTestId('modal')).toContainText('[Forms]![FClients]![N°]');
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('modal')).toHaveCount(0);
  } finally {
    await app.close();
  }
});

test('form actions from buttons: records, controls, properties, filters, find, save, undo, delete, requery; closed under its macro', async () => {
  test.setTimeout(90_000);
  const { app, page } = await launchApp({ args: [base()], env: FR });
  const ctl = (n: string) => shown(page, `form-ctl-${n}`);
  try {
    await open(page, 'form', 'FClients');
    await expect(ctl('Nom')).toHaveValue('Dupont');
    await ctl('cmdDernier').click();
    await expect(shown(page, 'nav-record-input')).toHaveValue('4');
    await ctl('cmdAllerVille').click();
    await expect(ctl('Ville')).toBeFocused();

    // ApplyFilter: « Filtré », Toggle Filter removes and applies it again; ShowAllRecords removes it
    await ctl('cmdFiltrer').click();
    await expect(shown(page, 'nav-record-count')).toHaveText('1');
    await expect(shown(page, 'nav-filtered')).toHaveText(fr.datasheet.nav.filter.on);
    await shown(page, 'nav-filtered').click();
    await expect(shown(page, 'nav-record-count')).toHaveText('4');
    await shown(page, 'nav-filtered').click();
    await expect(shown(page, 'nav-record-count')).toHaveText('1');
    await ctl('cmdTous').click();
    await expect(shown(page, 'nav-record-count')).toHaveText('4');
    await expect(shown(page, 'nav-filtered')).toBeDisabled();

    // FindRecord, every field: Durand current
    await ctl('cmdChercher').click();
    await expect(ctl('Nom')).toHaveValue('Durand');
    // a combo's Row Source reading [Forms]! gets its parameter again on Requery
    await ctl('cmdRequery').click();
    await shown(page, 'form-ctl-cboMeme-toggle').click();
    await expect(shown(page, 'form-list-cboMeme')).toContainText('Durand');
    await expect(shown(page, 'form-list-cboMeme')).not.toContainText('Dupont');
    await page.keyboard.press('Escape');

    // SaveRecord, UndoRecord
    await ctl('Nom').fill('Durand2');
    await ctl('cmdEnreg').click();
    await expect(shown(page, 'form-dirty')).toHaveCount(0);
    expect((await rows(page, 'Clients'))[2]![1]).toBe('Durand2');
    await ctl('Nom').fill('X');
    await ctl('cmdAnnuler').click();
    await expect(ctl('Nom')).toHaveValue('Durand2');
    await expect(shown(page, 'form-dirty')).toHaveCount(0);

    // DeleteRecord after SetWarnings No: no confirmation
    await ctl('cmdSuppr').click();
    await expect(shown(page, 'nav-record-count')).toHaveText('3');
    await expect(page.getByTestId('modal')).toHaveCount(0);
    expect((await rows(page, 'Clients')).map((r) => r[1])).toEqual(['Dupont', 'Martin', 'Éric']);

    // SetProperty Visible No
    await ctl('cmdMasquer').click();
    await expect(ctl('Ville')).toHaveCount(0);

    // Review Focus 4: the form closed while its macro waits in a message box: GoToControl fails with notOpen, nothing else
    await ctl('cmdBoite').click();
    await expect(page.getByTestId('macro-msgbox')).toBeVisible();
    await page.getByTestId('doc-tab-close-form-FClients').dispatchEvent('click');   // under the box (BaseCraft has no Ctrl+W)
    await expect(page.getByTestId('doc-tab-form-FClients')).toHaveCount(0);
    await page.getByTestId('macro-msgbox-ok').click();
    await failed(page, fr.macro.error.notOpen.replace('{{name}}', 'FClients'));
    await expect(page.getByTestId('modal')).toHaveCount(0);
  } finally {
    await app.close();
  }
});

test('control events nest inside a macro (R6); a save asked during Before Update (2115); clicks; focus leaving the form', async () => {
  test.setTimeout(90_000);
  const { app, page } = await launchApp({ args: [base()], env: FR });
  const ctl = (n: string) => shown(page, `form-ctl-${n}`);
  try {
    await open(page, 'form', 'FNid');
    await expect(ctl('Montant')).toBeVisible();
    // GoToControl: the target's Enter and Got Focus have run when the next action runs
    await ctl('cmdAller').click();
    await msgbox(page, /^\|Enter\|GotFocus;10,1/);
    await expect(ctl('Montant')).toBeFocused();
    await ctl('cmdLog').click();
    await msgbox(page);

    // focus to the Navigation Pane and back: no Exit, no Enter
    await ctl('Montant').click();
    await page.getByTestId('nav-search').click();
    await ctl('Montant').click();
    // a double click: On Click once, then On Dbl Click
    await ctl('cmdDouble').dblclick();
    await ctl('cmdLog').click();
    await msgbox(page, '|Enter|GotFocus|Exit|LostFocus|Click|DblClick');

    // GoToControl from a control whose Before Update cancels: the action fails, the focus stays
    await ctl('Client').click();
    await ctl('Client').fill('9');
    await failed(page, fr.macro.error.actionCancelled.replace('{{action}}', fr.macro.action.GoToControl));
    await ctl('Client').press('Escape');
    await expect(shown(page, 'form-dirty')).toHaveCount(0);
    await close(page, 'form', 'FNid');

    // SaveRecord during the form's Before Update: refused (2115), the save cancelled, nothing deadlocks
    await open(page, 'form', 'FAvant');
    await ctl('Montant').fill('20');
    await ctl('Montant').press('Shift+Enter');
    await failed(page, fr.macro.error.saveDuringEvent);
    await expect(shown(page, 'form-dirty')).toBeVisible();
    await ctl('Montant').press('Escape');
    await expect(shown(page, 'form-dirty')).toHaveCount(0);
    await close(page, 'form', 'FAvant');
  } finally {
    await app.close();
  }
});

test('form actions in On Load and Before Insert; SetValue raises no update event (R18); a cancelled DeleteRecord fails (2501)', async () => {
  test.setTimeout(90_000);
  const { app, page } = await launchApp({ args: [base()], env: FR });
  const ctl = (n: string) => shown(page, `form-ctl-${n}`);
  try {
    // On Load runs with the form shown: GoToControl, SetValue on an unbound control, ApplyFilter all applied
    await open(page, 'form', 'FCharge');
    await expect(shown(page, 'nav-record-count')).toHaveText('1');
    await expect(ctl('Nom')).toHaveValue('Durand');
    await expect(shown(page, 'nav-filtered')).toHaveText(fr.datasheet.nav.filter.on);
    await expect(ctl('Remarque')).toHaveValue('Prêt');
    await expect(ctl('Ville')).toBeFocused();
    await close(page, 'form', 'FCharge');

    // GoToControl in Before Insert (the first key typed on the new record): no hang, the key lands, the focus moves
    await open(page, 'form', 'FInsert');
    await shown(page, 'nav-new').click();
    await ctl('Nom').click();
    await page.keyboard.type('Z');
    await expect(ctl('Ville')).toBeFocused();
    await expect(ctl('Nom')).toHaveValue('Z');
    await page.keyboard.type('Q');
    await page.keyboard.press('Shift+Enter');
    await expect(shown(page, 'form-dirty')).toHaveCount(0);
    expect((await rows(page, 'Clients'))[4]).toEqual([5, 'Z', 'Q']);
    await close(page, 'form', 'FInsert');

    // SetValue on a bound control with Before / After Update: no event, the record dirty, the value saved
    await open(page, 'form', 'FValeur');
    await ctl('cmdSet').click();
    await expect(ctl('Montant')).toHaveValue(/^42/);
    await expect(shown(page, 'form-dirty')).toBeVisible();
    await ctl('cmdEnreg').click();
    await expect(shown(page, 'form-dirty')).toHaveCount(0);
    expect((await rows(page, 'Commandes'))[0]![2]).toBe(42);
    await ctl('cmdLog').click();
    await msgbox(page, 'L:');
    // On Delete cancels: DeleteRecord fails (Access 2501), nothing deleted
    await ctl('cmdSuppr').click();
    await failed(page, fr.macro.error.actionCancelled.replace('{{action}}', fr.macro.action.DeleteRecord));
    expect(await rows(page, 'Commandes')).toHaveLength(5);
  } finally {
    await app.close();
  }
});
