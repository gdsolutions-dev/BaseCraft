// B2 Task 8: the running form's instance — [Forms]! in macros, Where Conditions, queries and calculated controls (R11), the form
// actions (GoToRecord, GoToControl, SetProperty, ApplyFilter, ShowAllRecords, FindRecord, SaveRecord, UndoRecord, DeleteRecord,
// Requery), control events nesting inside a macro (R6), a save asked during Before Update (2115), a form closed under its macro
// (Review Focus 4).
import { test, expect, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { saveObject } from '../../src/main/db/objects';
import { convertAccessMacro, type AccessMacroRow } from '../../src/shared/access-macro';
import { seedSales } from '../../src/main/query/test-db';
import type { BasecraftApi } from '../../src/shared/api';
import type { ControlDef, DesignDoc } from '../../src/shared/design/model';
import type { MacroItem } from '../../src/shared/macro/model';
import { colLeft, launchApp, seedBase, seedForm } from './helpers';

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
    // B2 R13: case ignored, accents kept — Lyon is not Lyôn
    button('cmdLyon', 5700, act('FindRecord', { FindWhat: 'Lyon', Match: 'whole', MatchCase: 'no', Search: 'down', OnlyCurrentField: 'no', FindFirst: 'no' })),
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
    // FindRecord down from Durand: Éric's Lyôn is not Lyon (accents kept, B2 R13)
    await ctl('cmdLyon').click();
    await msgbox(page, fr.macro.findRecord.notFound);
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

// E6: the macro the Command Button Wizard writes for a delete button, converted from Access's text, and OpenQuery read-only.
// Beep has no e2e seam (shell.beep): on the new untouched record the proof is that nothing was deleted and no dialog appeared.
test('imported Access delete-record macro works on a form; a converted read-only OpenQuery refuses typing', async () => {
  test.setTimeout(90_000);
  const r = (action: string, condition: string | undefined, ...args: string[]): AccessMacroRow => ({ action, args, ...(condition ? { condition } : {}) });
  const wizard = convertAccessMacro([r('OnError', undefined, '0'), r('GoToControl', undefined, '=[Screen].[PreviousControl].[Name]'), r('ClearMacroError', undefined),
    r('RunCommand', 'Not [Form].[NewRecord]', '223'), r('Beep', '[Form].[NewRecord] And Not [Form].[Dirty]'), r('RunCommand', '[Form].[NewRecord] And [Form].[Dirty]', '292'),
    r('MsgBox', '[MacroError]<>0', '=[MacroError].[Description]', '-1', '0')]);
  expect(wizard.notes).toEqual([]);
  const wizardDef = { ...wizard.def, items: [...wizard.def.items, msg('end')] };   // a last visible effect: the macro has run to its end when its box shows
  const openRo = convertAccessMacro([r('OpenQuery', undefined, 'QClients', '0', '2')]), openRw = convertAccessMacro([r('OpenQuery', undefined, 'QClients', '0')]);
  expect(openRo.notes).toEqual([]);
  expect(openRw.notes).toEqual([]);
  const path = seedBase('e6-wizard', (db) => {
    seedSales(db);
    saveObject(db, 'query', 'QClients', { formatVersion: '1.0', sql: 'SELECT * FROM Clients;' }, null);
    seedForm(db, 'FSuppr', form('Clients', [box('textBox', 'Nom', 100, { ControlSource: 'Nom', TabIndex: 0 }),
      box('commandButton', 'cmdSuppr', 500, { Caption: 'Suppr', OnClick: { embedded: wizardDef } }, 5000),
      box('commandButton', 'cmdLecture', 900, { Caption: 'Lecture', OnClick: { embedded: openRo.def } }, 5000),
      box('commandButton', 'cmdEdition', 1300, { Caption: 'Edition', OnClick: { embedded: openRw.def } }, 5000)]));
  });
  const { app, page } = await launchApp({ args: [path], env: FR });
  const ctl = (n: string) => shown(page, `form-ctl-${n}`);
  const names = async () => (await rows(page, 'Clients')).map((x) => x[1]);
  try {
    await open(page, 'form', 'FSuppr');
    await expect(ctl('Nom')).toHaveValue('Dupont');
    // an existing record: deleted after the usual confirmation
    await ctl('Nom').click();
    await ctl('cmdSuppr').click();
    await page.getByTestId('modal-btn-yes').click();
    await msgbox(page, 'end');
    await expect(shown(page, 'nav-record-count')).toHaveText('3');
    expect(await names()).toEqual(['Martin', 'Durand', 'Éric']);
    // a new untouched record: it beeps, nothing is deleted, no dialog, no failure
    await shown(page, 'nav-new').click();
    await ctl('Nom').click();
    await ctl('cmdSuppr').click();
    await msgbox(page, 'end');   // the macro ran to its end: now the absences mean something
    await expect(page.getByTestId('modal')).toHaveCount(0);
    await expect(page.getByTestId('macro-failed')).toHaveCount(0);
    expect(await names()).toEqual(['Martin', 'Durand', 'Éric']);
    // a new record with something typed: undone
    await ctl('Nom').fill('Zed');
    await expect(shown(page, 'form-dirty')).toBeVisible();
    await ctl('cmdSuppr').click();
    await msgbox(page, 'end');
    await expect(shown(page, 'form-dirty')).toHaveCount(0);
    await expect(ctl('Nom')).toHaveValue('');
    await expect(page.getByTestId('modal')).toHaveCount(0);
    expect(await names()).toEqual(['Martin', 'Durand', 'Éric']);
    // the focus trail: the button's GoToControl [Screen]![PreviousControl]![Name] gave the focus back to Nom (the macro's box is closed)
    await ctl('Nom').click();
    await ctl('cmdSuppr').click();
    await msgbox(page, 'end');   // a new record is shown: nothing to delete, the macro ran to its end
    await expect(ctl('Nom')).toBeFocused();
    // the button is the first thing clicked in a fresh view: no previous control, GoToControl fails, OnError next absorbs it, the record goes
    await close(page, 'form', 'FSuppr');
    await open(page, 'form', 'FSuppr');
    await expect(ctl('Nom')).toHaveValue('Martin');
    await ctl('cmdSuppr').click();
    await page.getByTestId('modal-btn-yes').click();
    await msgbox(page, 'end');
    await expect(page.getByTestId('macro-failed')).toHaveCount(0);
    expect(await names()).toEqual(['Durand', 'Éric']);
    // control: the same query opened without DataMode has its new-record row and typing opens the editor
    const editor = page.getByTestId('grid-editor-portal').locator('textarea');
    const sheet = page.getByTestId('datasheet');
    const typeInFirstCell = async () => {
      const b = (await sheet.getByTestId('data-grid-canvas').boundingBox())!;
      await page.mouse.click(b.x + colLeft(1) + 30, b.y + 34 + 15);
      await page.keyboard.press('x');
    };
    await ctl('cmdEdition').click();
    await expect(page.getByTestId('doc-tab-query-QClients')).toBeVisible();
    await expect(sheet.locator('table[role=grid]')).toHaveAttribute('aria-rowcount', '4');   // header + 2 records + the new-record row
    // the click can land before the grid takes the pointer: typed again until the editor opens
    await expect(async () => { await typeInFirstCell(); await expect(editor).toHaveCount(1, { timeout: 1000 }); }).toPass();
    await page.keyboard.press('Escape');
    await expect(editor).toHaveCount(0);
    await page.getByTestId('doc-tab-close-query-QClients').dispatchEvent('click');
    await expect(page.getByTestId('doc-tab-query-QClients')).toHaveCount(0);
    // OpenQuery read-only: a datasheet with no new-record row, where typing opens no editor and writes nothing
    await ctl('cmdLecture').click();
    await expect(page.getByTestId('doc-tab-query-QClients')).toBeVisible();
    await expect(sheet.getByTestId('data-grid-canvas')).toBeVisible();
    await expect(sheet.locator('table[role=grid]')).toHaveAttribute('aria-rowcount', '3');   // header + 2 records, no new-record row
    await typeInFirstCell();
    await expect(editor).toHaveCount(0);
    expect(await names()).toEqual(['Durand', 'Éric']);
  } finally {
    await app.close();
  }
});

// E6b: the macro the Command Button Wizard writes for a duplicate button (select, copy, new record, select, paste), converted from
// Access's text. The new record is the copy, not saved: its controls show the copied values, the AutoNumber is left to the table.
test('imported Access duplicate-record macro copies the record into a new one; copy with no record selected fails as not available', async () => {
  test.setTimeout(90_000);
  const r = (action: string, condition: string | undefined, ...args: string[]): AccessMacroRow => ({ action, args, ...(condition ? { condition } : {}) });
  const ok = '[MacroError]=0';
  const dup = convertAccessMacro([r('OnError', undefined, '0'), r('RunCommand', undefined, '50'), r('RunCommand', ok, '190'), r('RunCommand', ok, '28'), r('RunCommand', ok, '50'),
    r('RunCommand', ok, '191'), r('MsgBox', '[MacroError]<>0', '=[MacroError].[Description]', '-1', '0')]);
  expect(dup.notes).toEqual([]);
  const dupDef = { ...dup.def, items: [...dup.def.items, msg('end')] };
  const alone = embedded(act('OnError', { GoTo: 'next' }), act('RunMenuCommand', { Command: 'copy' }), act('MessageBox', { Message: '=[MacroError]![Description]', Title: 'Test', Beep: 'no', Type: 'none' }));
  const paste = embedded(act('OnError', { GoTo: 'next' }), act('RunMenuCommand', { Command: 'paste' }), act('MessageBox', { Message: '=[MacroError]![Description]', Title: 'Test', Beep: 'no', Type: 'none' }));
  const path = seedBase('e6b-duplicate', (db) => {
    seedSales(db);
    seedForm(db, 'FDouble', form('Clients', [box('textBox', 'N°', 100, { ControlSource: 'N°', TabIndex: 0 }), box('textBox', 'Nom', 600, { ControlSource: 'Nom', TabIndex: 1 }),
      box('textBox', 'Ville', 1100, { ControlSource: 'Ville', TabIndex: 2 }),
      box('commandButton', 'cmdDouble', 500, { Caption: 'Dupliquer', OnClick: { embedded: dupDef } }, 5000),
      box('commandButton', 'cmdCopie', 900, { Caption: 'Copier', OnClick: alone }, 5000), button('cmdEnreg', 1300, act('SaveRecord')),
      box('commandButton', 'cmdColle', 1700, { Caption: 'Coller', OnClick: paste }, 5000)]));
  });
  const { app, page } = await launchApp({ args: [path], env: FR });
  const ctl = (n: string) => shown(page, `form-ctl-${n}`);
  try {
    await open(page, 'form', 'FDouble');
    await expect(ctl('Nom')).toHaveValue('Dupont');
    // nothing selected: copy fails, OnError next goes on, the box shows the message of the failure
    await ctl('cmdCopie').click();
    await msgbox(page, fr.macro.error.commandUnavailable);
    // paste with no record selected: the same message, and nothing was written
    await ctl('cmdColle').click();
    await msgbox(page, fr.macro.error.commandUnavailable);
    await expect(shown(page, 'form-dirty')).toHaveCount(0);
    // an existing record: duplicated into a new, dirty one holding the same values and no key yet
    await ctl('Nom').click();
    await ctl('cmdDouble').click();
    await msgbox(page, 'end');
    await expect(page.getByTestId('macro-failed')).toHaveCount(0);
    await expect(shown(page, 'form-dirty')).toBeVisible();
    await expect(shown(page, 'form-selector')).toHaveAttribute('data-selected', 'true');
    await expect(ctl('Nom')).toHaveValue('Dupont');
    await expect(ctl('Ville')).toHaveValue('Lyon');
    await expect(ctl('N°')).toHaveValue('');   // the AutoNumber is left to the table
    expect(await rows(page, 'Clients')).toHaveLength(4);   // not saved yet
    await ctl('cmdEnreg').click();
    await expect.poll(async () => (await rows(page, 'Clients')).length).toBe(5);
    const all = await rows(page, 'Clients');
    expect(all.at(-1)!.slice(1)).toEqual(all[0]!.slice(1));
    expect(all.at(-1)![0]).not.toBe(all[0]![0]);
  } finally {
    await app.close();
  }
});

// E6b: the Combo Box Wizard's find-a-record list, converted from Access's text: choosing a key in the unbound combo box moves the form
// to that record; a filter that leaves the record out of the form: the form stays where it is, no message, no failure.
test('imported Access find-a-record macro moves the form to the chosen record; with a filter excluding it, the form stays', async () => {
  test.setTimeout(90_000);
  const found = convertAccessMacro([{ action: 'SearchForRecord', args: ['-1', '', '2', '="[N°] = " & Str(Nz([Screen].[ActiveControl],0))'] }]);
  expect(found.notes).toEqual([]);
  const path = seedBase('e6b-search', (db) => {
    seedSales(db);
    seedForm(db, 'FChercher', form('Clients', [box('textBox', 'N°', 100, { ControlSource: 'N°', TabIndex: 0 }), box('textBox', 'Nom', 600, { ControlSource: 'Nom', TabIndex: 1 }),
      box('comboBox', 'cboCherche', 1100, { TabIndex: 2, RowSourceType: 'tableQuery', RowSource: 'SELECT N° FROM Clients ORDER BY N°;', AfterUpdate: { embedded: found.def } }),
      button('cmdParis', 500, act('ApplyFilter', { WhereCondition: '[Ville] = "Paris"' }))]));
  });
  const { app, page } = await launchApp({ args: [path], env: FR });
  const ctl = (n: string) => shown(page, `form-ctl-${n}`);
  const pick = async (index: number) => {
    await shown(page, 'form-ctl-cboCherche-toggle').click();
    await page.getByTestId('form-list-cboCherche').getByRole('option').nth(index).click();
  };
  try {
    await open(page, 'form', 'FChercher');
    await expect(ctl('Nom')).toHaveValue('Dupont');
    await pick(2);   // key 3
    await expect(ctl('Nom')).toHaveValue('Durand');
    await pick(1);
    await expect(ctl('Nom')).toHaveValue('Martin');
    // filtered on Paris: only Durand is left; key 1 is not among the records shown
    await ctl('cmdParis').click();
    await expect(ctl('Nom')).toHaveValue('Durand');
    await pick(0);
    await expect(page.getByTestId('macro-failed')).toHaveCount(0);
    await expect(page.getByTestId('macro-msgbox')).toHaveCount(0);
    await expect(ctl('Nom')).toHaveValue('Durand');
  } finally {
    await app.close();
  }
});

// E6b: the print CSS, with the two marks set as the action sets them: what stays visible, what is hidden (each hidden selector must match
// something in normal media: a renamed selector fails the test), the light palette on paper.
async function expectPrintLayout(page: Page, formTab: string, current: string, nom: string, others: string[]) {
  const hiddenSels = ['.ribbon', '[data-testid="nav-pane"]', `[data-testid="doc-tab-form-${formTab}"]`, '[data-testid="form-selector"]', '.recnav', 'footer.status', ...others];
  for (const sel of hiddenSels) expect(await page.locator(sel).count(), `${sel} matches in normal media`).toBeGreaterThan(0);
  const run = page.locator('[data-testid="form-run"]:visible').first();   // the shown tab's form
  await run.evaluate((e) => { document.documentElement.classList.add('bc-print-record'); e.setAttribute('data-print-record', ''); });
  await page.emulateMedia({ media: 'print' });
  try {
    for (const sel of hiddenSels) for (const el of await page.locator(sel).all()) await expect(el, sel).toBeHidden();
    const ctl = page.locator(`${current} [data-testid="form-ctl-Nom"]`);
    await expect(ctl).toBeVisible();
    await expect(ctl).toHaveValue(nom);
    await expect(page.locator('[data-testid="form-ctl-lblTitre"]:visible')).toHaveCount(1);   // the form header
    await expect(page.locator('[data-testid="form-ctl-lblPied"]:visible')).toHaveCount(1);    // the form footer
    const b = (await ctl.boundingBox())!;
    expect(b.x).toBeLessThan(2 / 2.54 * 96 + 2000 / 15 + 2);   // within the first 2 cm plus its designed left
    expect(b.y).toBeLessThan(600 / 15 + 700 / 15 + 40);        // under the header, at the top of the page
    // the paper is white: the light theme's text colour, in the dark theme too
    expect(await page.locator('[data-testid="form-ctl-lblTitre"]:visible').evaluate((e) => getComputedStyle(e).color)).toBe('rgb(27, 31, 39)');
  } finally {
    await page.emulateMedia({ media: null });
    await run.evaluate((e) => { document.documentElement.classList.remove('bc-print-record'); e.removeAttribute('data-print-record'); });
  }
}

// E6b: the Command Button Wizard's print-selection button (RunCommand 590 alone), converted: it prints the form's current record through the
// main window (counted in the e2e log, no dialog), the marks are gone afterwards, and under the print marks only the current row remains.
test('imported Access print-selection macro prints the current record of a continuous form only; no mark is left behind', async () => {
  test.setTimeout(120_000);
  const printMacro = convertAccessMacro([{ action: 'RunCommand', args: ['590'] }]);
  expect(printMacro.notes).toEqual([]);
  const withBands = (d: DesignDoc, detail: ControlDef[]): DesignDoc => ({ ...d, sections: [
    { kind: 'formHeader', height: 600, props: {}, controls: [box('label', 'lblTitre', 100, { Caption: 'Clients' }, 300)] },
    { kind: 'detail', height: 700, props: {}, controls: detail },
    { kind: 'formFooter', height: 400, props: {}, controls: [box('label', 'lblPied', 100, { Caption: 'Fin' }, 300)] }] });
  const nomBox = (): ControlDef[] => [box('textBox', 'N°', 100, { ControlSource: 'N°', TabIndex: 0 }, 300), box('textBox', 'Nom', 100, { ControlSource: 'Nom', TabIndex: 1 }, 2000)];
  const docC = withBands(form('Clients', [], { DefaultView: 'continuous' }), [...nomBox(),
    box('commandButton', 'cmdImprime', 100, { Caption: 'Imprimer', OnClick: { embedded: printMacro.def } }, 4500)]);
  const docS = withBands(form('Clients', []), nomBox());
  const path = seedBase('e6b-print', (db) => { seedSales(db); seedForm(db, 'FImprime', docC); seedForm(db, 'FSimple', docS); });
  const { app, page } = await launchApp({ args: [path], env: FR });
  const printed = () => app.evaluate(() => (globalThis as unknown as { __bcPrintE2E: { formsPrinted: number } }).__bcPrintE2E.formsPrinted);
  const marks = () => page.evaluate(() => [document.documentElement.classList.contains('bc-print-record'), document.querySelectorAll('[data-print-record]').length]);
  try {
    await page.evaluate(() => { document.documentElement.dataset.theme = 'dark'; });
    await open(page, 'form', 'FImprime');
    await expect(page.getByTestId('form-row-2')).toBeVisible();
    await shown(page, 'form-row-1').locator('[data-testid="form-ctl-Nom"]').click();   // the second record becomes the current one
    await expect(page.getByTestId('form-row-1')).toHaveAttribute('data-current', 'true');
    const nom = await shown(page, 'form-row-1').locator('[data-testid="form-ctl-Nom"]').inputValue();
    expect(await page.locator('[data-testid="form-ctl-lblTitre"]:visible').evaluate((e) => getComputedStyle(e).color)).not.toBe('rgb(27, 31, 39)');   // dark on screen
    expect(await printed()).toBe(0);
    await shown(page, 'form-row-1').locator('[data-testid="form-ctl-cmdImprime"]').click();
    await expect.poll(printed).toBe(1);
    await expect(page.getByTestId('macro-failed')).toHaveCount(0);
    await expect.poll(marks).toEqual([false, 0]);
    await expectPrintLayout(page, 'FImprime', '[data-testid="form-row-1"]', nom,
      ['[data-row-other]', '[data-testid="form-row-0"] [data-testid="form-ctl-Nom"]', '[data-testid="form-row-2"] [data-testid="form-ctl-Nom"]']);

    // a single form: its one record, the header and the footer
    await open(page, 'form', 'FSimple');
    const nomS = await shown(page, 'form-ctl-Nom').inputValue();
    await expectPrintLayout(page, 'FSimple', '[data-testid="form-run"]:visible', nomS, []);
  } finally {
    await app.close();
  }
});

// E6c: RunCommand 340 (Print) prints every record of the form, as Access: the header, the detail once per record in the form's order and filter, the
// footer. The main window's print is held while the page is read under print media (the marks and the print-only block exist only then).
const bandsDoc = (d: DesignDoc, detail: ControlDef[]): DesignDoc => ({ ...d, sections: [
  { kind: 'formHeader', height: 600, props: {}, controls: [box('label', 'lblTitre', 100, { Caption: 'Clients' }, 300)] },
  { kind: 'detail', height: 700, props: {}, controls: detail },
  { kind: 'formFooter', height: 400, props: {}, controls: [box('label', 'lblPied', 100, { Caption: 'Fin' }, 300)] }] });
test('imported Access print macro (340) prints every record of a continuous and a single form, filtered or not; nothing is left behind', async () => {
  test.setTimeout(150_000);
  const printMacro = convertAccessMacro([{ action: 'RunCommand', args: ['340'] }]);
  expect(printMacro.notes).toEqual([]);
  const filterMacro = convertAccessMacro([{ action: 'ApplyFilter', args: ['', '[N°] > 1'] }]);
  const detail = (): ControlDef[] => [box('textBox', 'N°', 100, { ControlSource: 'N°', TabIndex: 0 }, 300), box('textBox', 'Nom', 100, { ControlSource: 'Nom', TabIndex: 1 }, 2000),
    box('commandButton', 'cmdImprime', 100, { Caption: 'Imprimer', OnClick: { embedded: printMacro.def } }, 4500),
    box('commandButton', 'cmdFiltre', 100, { Caption: 'Filtrer', OnClick: { embedded: filterMacro.def } }, 6000)];
  const path = seedBase('e6c-print-all', (db) => {
    seedSales(db);
    seedForm(db, 'FTous', bandsDoc(form('Clients', [], { DefaultView: 'continuous' }), detail()));
    seedForm(db, 'FUn', bandsDoc(form('Clients', []), detail()));
  });
  const { app, page } = await launchApp({ args: [path], env: FR });
  type PrintLog = { formsPrinted: number; hold?: Promise<void>; release?: () => void };
  const printed = () => app.evaluate(() => (globalThis as unknown as { __bcPrintE2E: PrintLog }).__bcPrintE2E.formsPrinted);
  const hold = () => app.evaluate(() => { const l = (globalThis as unknown as { __bcPrintE2E: PrintLog }).__bcPrintE2E; l.hold = new Promise<void>((r) => { l.release = r; }); });
  const release = () => app.evaluate(() => { (globalThis as unknown as { __bcPrintE2E: PrintLog }).__bcPrintE2E.release?.(); });
  const marks = () => page.evaluate(() => [document.documentElement.classList.contains('bc-print-record'), document.querySelectorAll('[data-print-record]').length, document.querySelectorAll('.frun-printall').length]);
  const printAll = async (btn: () => ReturnType<typeof shown>, names: string[]) => {
    const before = await printed();
    await hold();
    await btn().click();
    await expect.poll(printed).toBe(before + 1);   // the print is in progress: the marks and the print-only block are there
    await expect(page.locator('[data-print-record="all"]')).toHaveCount(1);
    await page.emulateMedia({ media: 'print' });
    try {
      await expect(page.locator('.frun-print-row')).toHaveCount(names.length);
      for (const [i, nom] of names.entries()) {
        const c = page.locator(`[data-testid="form-print-${i}"] [data-testid="form-ctl-Nom"]`);
        await expect(c).toBeVisible();
        await expect(c).toHaveValue(nom);
      }
      await expect(page.locator('[data-testid="form-ctl-Nom"]:visible')).toHaveCount(names.length);   // each record once: no other row, no new record
      await expect(page.locator('[data-testid="form-ctl-lblTitre"]:visible')).toHaveCount(1);
      await expect(page.locator('[data-testid="form-ctl-lblPied"]:visible')).toHaveCount(1);
      for (const sel of ['.recnav', '[data-testid="form-selector"]', '[data-row-other]:not(.frun-print-row)', '.frun-message', '[data-testid="form-rows"]'])
        for (const el of await page.locator(sel).all()) await expect(el, sel).toBeHidden();
      expect(await page.locator('[data-testid="form-ctl-lblTitre"]:visible').evaluate((e) => getComputedStyle(e).color)).toBe('rgb(27, 31, 39)');
      expect(await page.locator('.frun-print-row').first().evaluate((e) => getComputedStyle(e).breakInside)).toBe('avoid');
    } finally {
      await page.emulateMedia({ media: null });
      await release();
    }
    await expect.poll(marks).toEqual([false, 0, 0]);
  };
  try {
    await open(page, 'form', 'FTous');
    await expect(page.getByTestId('form-row-3')).toBeVisible();
    const rowNom = (i: number) => shown(page, `form-row-${i}`).locator('[data-testid="form-ctl-Nom"]');
    await expect(page.locator('.frun-printall')).toHaveCount(0);   // never there on screen
    await printAll(() => shown(page, 'form-row-0').locator('[data-testid="form-ctl-cmdImprime"]'), ['Dupont', 'Martin', 'Durand', 'Éric']);
    await rowNom(2).click();   // the form still works: another record becomes the current one
    await expect(page.getByTestId('form-row-2')).toHaveAttribute('data-current', 'true');
    await shown(page, 'form-row-2').locator('[data-testid="form-ctl-cmdFiltre"]').click();
    await expect(rowNom(0)).toHaveValue('Martin');
    await printAll(() => shown(page, 'form-row-0').locator('[data-testid="form-ctl-cmdImprime"]'), ['Martin', 'Durand', 'Éric']);
    await rowNom(1).click();
    await expect(page.getByTestId('form-row-1')).toHaveAttribute('data-current', 'true');

    await open(page, 'form', 'FUn');
    const nom = shown(page, 'form-ctl-Nom');
    await printAll(() => shown(page, 'form-ctl-cmdImprime'), ['Dupont', 'Martin', 'Durand', 'Éric']);
    await expect(nom).toHaveValue('Dupont');
    await shown(page, 'form-ctl-cmdFiltre').click();
    await expect(nom).toHaveValue('Martin');
    await printAll(() => shown(page, 'form-ctl-cmdImprime'), ['Martin', 'Durand', 'Éric']);
    await nom.press('PageDown');
    await expect(nom).toHaveValue('Durand');
    await nom.fill('Durand-X');   // typed, not saved: the record being edited prints as shown
    await printAll(() => shown(page, 'form-ctl-cmdImprime'), ['Martin', 'Durand-X', 'Éric']);
  } finally {
    await app.close();
  }
});

// E6c: an unbound form's `print` is the form as it is (no print-only block); a subform in the detail stays the live one (the print rows hold an empty frame:
// no second embedded form, no registration over the live subform's).
test('print on an unbound form prints it as it is; print rows leave the live subform alone', async () => {
  test.setTimeout(120_000);
  const printMacro = convertAccessMacro([{ action: 'RunCommand', args: ['340'] }]);
  const btn = box('commandButton', 'cmdImprime', 100, { Caption: 'Imprimer', OnClick: { embedded: printMacro.def } }, 4500);
  const path = seedBase('e6c-print-more', (db) => {
    seedSales(db);
    seedForm(db, 'FLibre', form(null, [btn]));
    seedForm(db, 'FSousC', form('Clients', [box('textBox', 'Nom', 100, { ControlSource: 'Nom', TabIndex: 0 })]));
    seedForm(db, 'FMaitre', bandsDoc(form('Clients', []), [box('textBox', 'Nom', 100, { ControlSource: 'Nom', TabIndex: 0 }, 2000), btn,
      { ...box('subform', 'Sous', 700, { SourceObject: 'FSousC', TabIndex: 1 }, 100), width: 3000, height: 1500 }]));
  });
  const { app, page } = await launchApp({ args: [path], env: FR });
  type PrintLog = { formsPrinted: number; hold?: Promise<void>; release?: () => void };
  const printed = () => app.evaluate(() => (globalThis as unknown as { __bcPrintE2E: PrintLog }).__bcPrintE2E.formsPrinted);
  const hold = () => app.evaluate(() => { const l = (globalThis as unknown as { __bcPrintE2E: PrintLog }).__bcPrintE2E; l.hold = new Promise<void>((r) => { l.release = r; }); });
  const release = () => app.evaluate(() => { (globalThis as unknown as { __bcPrintE2E: PrintLog }).__bcPrintE2E.release?.(); });
  try {
    await open(page, 'form', 'FLibre');
    await hold();
    await shown(page, 'form-ctl-cmdImprime').click();
    await expect.poll(printed).toBe(1);
    await expect(page.locator('[data-print-record=""]')).toHaveCount(1);   // the current-form mark, no print-only block
    await expect(page.locator('.frun-printall')).toHaveCount(0);
    await release();
    await expect(page.locator('[data-print-record]')).toHaveCount(0);

    await open(page, 'form', 'FMaitre');
    const live = page.locator('.frun-subform:visible [data-testid="form-ctl-Nom"]');
    await expect(live).toHaveCount(1);
    await expect(live).toHaveValue('Dupont');
    await hold();
    await shown(page, 'form-ctl-cmdImprime').click();
    await expect.poll(printed).toBe(2);
    await expect(page.locator('[data-testid="form-print-0"] .frun-subform')).toHaveCount(1);   // its empty frame
    await expect(page.locator('.frun-printall .frun-subform .frun')).toHaveCount(0);   // no embedded form in the print rows
    await expect(page.locator('.frun-subform .frun')).toHaveCount(1);   // only the live one
    await release();
    await expect(page.locator('[data-print-record]')).toHaveCount(0);
    await expect(live).toHaveValue('Dupont');   // the live subform is still there and working
    await live.fill('Dupont2');
    await live.press('Tab');
    await expect(live).toHaveValue('Dupont2');
    // the print itself fails: the block and the marks are gone all the same
    await app.evaluate(() => { const l = (globalThis as unknown as { __bcPrintE2E: PrintLog }).__bcPrintE2E; l.hold = Promise.reject(new Error('print failed')); l.hold.catch(() => undefined); });
    await shown(page, 'form-ctl-cmdImprime').click();
    await expect.poll(printed).toBe(3);
    await expect(page.locator('[data-print-record]')).toHaveCount(0);
    await expect(page.locator('.frun-printall')).toHaveCount(0);
    await expect(page.locator('html.bc-print-record')).toHaveCount(0);
  } finally {
    await app.close();
  }
});
