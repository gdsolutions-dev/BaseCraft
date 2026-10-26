// B2 Task 7: form and control events in the running form — Before Update refusing a save (R7, R8), the order of the events
// (Access's), On Open cancelled, On Close, On Exit cancelled, a check box's After Update, an On Current that loops (Review Focus 1).
import { test, expect, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createTable } from '../../src/main/db/schema';
import { seedSales } from '../../src/main/query/test-db';
import type { BasecraftApi } from '../../src/shared/api';
import type { ControlDef, DesignDoc } from '../../src/shared/design/model';
import type { MacroItem } from '../../src/shared/macro/model';
import { f, t } from '../../src/shared/test-fixtures';
import { launchApp, seedBase, seedForm } from './helpers';

const fr = JSON.parse(readFileSync(join(__dirname, '../../src/shared/i18n/fr.json'), 'utf8'));
const FR = { BASECRAFT_REGION: 'fr-FR' };
const act = (action: string, args: Record<string, string> = {}): MacroItem => ({ k: 'action', action, args });
const embedded = (...items: MacroItem[]) => ({ embedded: { formatVersion: '1.0' as const, items } });
const msg = (title: string, message = title) => act('MessageBox', { Message: message, Title: title, Beep: 'no', Type: 'none' });
const box = (kind: ControlDef['kind'], name: string, top: number, props: Record<string, unknown>): ControlDef =>
  ({ kind, name, left: 1701, top, width: 2268, height: 340, props });
const form = (source: string | null, controls: ControlDef[], props: Record<string, unknown> = {}): DesignDoc => ({
  formatVersion: '1.0', recordSource: source ? { kind: 'table', name: source } : null, props: { Width: 9072, ...props },
  sections: [{ kind: 'formHeader', height: 0, props: { Visible: false }, controls: [] },
    { kind: 'detail', height: 2268, props: {}, controls },
    { kind: 'formFooter', height: 0, props: { Visible: false }, controls: [] }],
});
/** Appends `|<name>` to the temporary variable Log. */
const log = (name: string) => embedded(act('SetTempVar', { Name: 'Log', Expression: `[TempVars]![Log] & "|${name}"` }));
const logAll = (names: string[]) => Object.fromEntries(names.map((n) => [n, log(n)]));
const rows = (page: Page, table: string) => page.evaluate((n) => (window as unknown as { basecraft: BasecraftApi }).basecraft.rows.page(n, { offset: 0, limit: 100 })
  .then((p) => p.rows.map((r) => r.values)), table);

const base = () => seedBase('form-events', (db) => {
  seedSales(db);
  createTable(db, t('Journal', [f('N°', 'autoNumber'), f('Texte', 'shortText'), f('Note', 'shortText')]));
  createTable(db, t('Nombres', [f('N°', 'autoNumber'), f('Valeur', 'number')]));
  const ins = db.prepare('INSERT INTO "Nombres" ("Valeur") VALUES (?)');
  for (let i = 1; i <= 30; i++) ins.run(i);
  seedForm(db, 'FCommandes', form('Commandes', [box('textBox', 'Client', 100, { ControlSource: 'Client', TabIndex: 0 }),
    box('textBox', 'Montant', 600, { ControlSource: 'Montant', TabIndex: 1 })], {
    BeforeUpdate: embedded({ k: 'if', branches: [{ cond: '[Montant] > 1000', items: [msg('BeforeUpdate', 'Montant trop élevé'), act('CancelEvent')] }] }),
    OnClose: embedded(msg('OnClose')),
  }));
  seedForm(db, 'FJournal', form('Journal', [
    box('textBox', 'Texte', 100, { ControlSource: 'Texte', TabIndex: 0,
      ...logAll(['OnEnter', 'OnGotFocus', 'OnChange', 'BeforeUpdate', 'AfterUpdate', 'OnExit', 'OnLostFocus', 'OnClick', 'OnDblClick']) }),
    box('textBox', 'Note', 600, { ControlSource: 'Note', TabIndex: 1 }),
    box('commandButton', 'cmdLog', 1100, { Caption: 'Journal', TabIndex: 2, OnClick: embedded(msg('Log', '=[TempVars]![Log]')) }),
  ], logAll(['OnOpen', 'OnLoad', 'OnCurrent', 'BeforeInsert', 'AfterInsert', 'BeforeUpdate', 'AfterUpdate', 'OnDelete', 'OnClick', 'OnDblClick'])));
  seedForm(db, 'FFerme', form('Clients', [box('textBox', 'Nom', 100, { ControlSource: 'Nom' })], { OnOpen: embedded(msg('OnOpen'), act('CancelEvent')) }));
  seedForm(db, 'FSortie', form('Clients', [
    box('textBox', 'Nom', 100, { ControlSource: 'Nom', TabIndex: 0,
      OnExit: embedded({ k: 'if', branches: [{ cond: '[Nom] = "Bloqué"', items: [act('CancelEvent')] }] }) }),
    box('textBox', 'Ville', 600, { ControlSource: 'Ville', TabIndex: 1 }),
    { kind: 'checkBox', name: 'Coche', left: 1701, top: 1100, width: 284, height: 284, props: { TabIndex: 2, AfterUpdate: embedded(msg('AfterUpdate', '="Coché : " & [Coche]')) } },
  ]));
  seedForm(db, 'FFin', form('Clients', [box('textBox', 'Nom', 100, { ControlSource: 'Nom' })], { OnClose: embedded(msg('OnClose'), act('CloseWindow')) }));
  seedForm(db, 'FBoucle', form('Nombres', [box('textBox', 'Valeur', 100, { ControlSource: 'Valeur' })],
    { OnCurrent: embedded(act('GoToRecord', { Record: 'next' })) }));
});

async function open(page: Page, name: string) {
  await page.getByTestId(`nav-item-form-${name}`).dblclick();
}
async function msgbox(page: Page, title: string, text?: string) {
  await expect(page.getByTestId('macro-msgbox')).toBeVisible();
  await expect(page.getByTestId('modal')).toContainText(title);
  if (text !== undefined) await expect(page.getByTestId('macro-msgbox-text')).toHaveText(text);
  await page.getByTestId('macro-msgbox-ok').click();
  await expect(page.getByTestId('macro-msgbox')).toHaveCount(0);
}

test('form and control events: Before Update cancels a save (R8 on close), Access order, On Open cancelled, On Exit, a check box, On Current looping', async () => {
  const { app, page } = await launchApp({ args: [base()], env: FR });
  const ctl = (n: string) => page.getByTestId(`form-ctl-${n}`);
  try {
    // Before Update refuses: the macro's own message, the record stays dirty, nothing written
    await open(page, 'FCommandes');
    await expect(page.getByTestId('nav-record-input')).toHaveValue('1');
    await ctl('Montant').click();
    await ctl('Montant').fill('5000');
    await ctl('Montant').press('Shift+Enter');
    await msgbox(page, 'BeforeUpdate', 'Montant trop élevé');
    await expect(page.getByTestId('form-dirty')).toBeVisible();
    expect((await rows(page, 'Commandes'))[0]![2]).toBe(10.1);
    await ctl('Montant').press('Escape');
    await expect(page.getByTestId('form-dirty')).toHaveCount(0);
    await ctl('Montant').press('PageDown');
    await expect(page.getByTestId('nav-record-input')).toHaveValue('2');
    await expect(page.getByTestId('macro-msgbox')).toHaveCount(0);

    // R8: refused, closing asks; Non keeps it open, Oui closes it (On Close then) with nothing written
    await ctl('Montant').fill('5000');
    await ctl('Montant').press('Shift+Enter');
    await msgbox(page, 'BeforeUpdate');
    await page.getByTestId('doc-tab-close-form-FCommandes').click();
    await msgbox(page, 'BeforeUpdate');   // asked again by the save the closing tries
    await expect(page.getByTestId('modal')).toContainText(fr.form.closeUnsaved);
    await page.getByTestId('modal-btn-no').click();
    await expect(page.getByTestId('doc-tab-form-FCommandes')).toBeVisible();
    await expect(page.getByTestId('form-dirty')).toBeVisible();
    await page.getByTestId('doc-tab-close-form-FCommandes').click();
    await msgbox(page, 'BeforeUpdate');
    await expect(page.getByTestId('modal')).toContainText(fr.form.closeUnsaved);
    await page.getByTestId('modal-btn-yes').click();
    await msgbox(page, 'OnClose');
    await expect(page.getByTestId('doc-tab-form-FCommandes')).toHaveCount(0);
    expect((await rows(page, 'Commandes'))[1]![2]).toBe(0.1);

    // the order of the events: open, type in a text box, Tab, save (the new record)
    await open(page, 'FJournal');
    await expect(ctl('Texte')).toBeVisible();
    await ctl('Texte').focus();
    await ctl('Texte').press('a');
    await ctl('Texte').press('Tab');
    await expect(ctl('Note')).toBeFocused();
    await ctl('Note').press('Shift+Enter');
    await expect(page.getByTestId('form-dirty')).toHaveCount(0);
    const expected = '|OnOpen|OnLoad|OnCurrent|OnEnter|OnGotFocus|BeforeInsert|OnChange|BeforeUpdate|AfterUpdate|OnExit|OnLostFocus'
      + '|BeforeUpdate|AfterUpdate|AfterInsert';
    await expect.poll(async () => {   // read through a final macro (After Insert ends just after the save is shown)
      await ctl('cmdLog').click();
      await expect(page.getByTestId('macro-msgbox')).toBeVisible();
      const text = await page.getByTestId('macro-msgbox-text').textContent();
      await page.getByTestId('macro-msgbox-ok').click();
      return text;
    }).toBe(expected);
    expect(await rows(page, 'Journal')).toEqual([[1, 'a', null]]);
    await page.getByTestId('doc-tab-close-form-FJournal').click();
    await expect(page.getByTestId('doc-tab-form-FJournal')).toHaveCount(0);

    // On Open cancelled: its message, then no tab and no error
    await open(page, 'FFerme');
    await msgbox(page, 'OnOpen');
    await expect(page.getByTestId('doc-tab-form-FFerme')).toHaveCount(0);
    await expect(page.getByTestId('form-run-error')).toHaveCount(0);

    // On Exit cancelled keeps the focus in the control; a check box's After Update on its click
    await open(page, 'FSortie');
    await ctl('Nom').click();
    await ctl('Nom').fill('Bloqué');
    await ctl('Nom').press('Tab');
    await expect(ctl('Nom')).toBeFocused();
    await ctl('Nom').fill('Dupont');
    await ctl('Nom').press('Tab');
    await expect(ctl('Ville')).toBeFocused();
    await ctl('Coche').click();
    await msgbox(page, 'AfterUpdate');
    await expect(ctl('Coche')).toBeChecked();
    await page.getByTestId('doc-tab-close-form-FSortie').click();
    await expect(page.getByTestId('doc-tab-form-FSortie')).toHaveCount(0);

    // Review Focus 1: On Current = GoToRecord Next nests until the limit: one Action Failed, the form stays usable
    await open(page, 'FBoucle');
    await expect(page.getByTestId('macro-failed')).toBeVisible();
    await expect(page.getByTestId('macro-failed-message')).toHaveText(fr.macro.error.eventTooDeep);
    await page.getByTestId('macro-failed-stop').click();
    await expect(page.getByTestId('modal')).toHaveCount(0);
    await expect(page.getByTestId('form-run')).toBeVisible();
    await expect(ctl('Valeur')).toBeVisible();
    await page.waitForTimeout(300);
    await expect(page.getByTestId('macro-failed')).toHaveCount(0);   // once
    await page.getByTestId('doc-tab-close-form-FBoucle').click();
    await expect(page.getByTestId('doc-tab-form-FBoucle')).toHaveCount(0);
  } finally {
    await app.close();
  }
});

test('CloseWindow in the own On Close of a form: the form closes once, its On Close not raised again', async () => {
  test.setTimeout(60_000);
  const { app, page } = await launchApp({ args: [base()], env: FR });
  try {
    await open(page, 'FFin');
    await expect(page.getByTestId('form-ctl-Nom')).toHaveValue('Dupont');
    await page.getByTestId('doc-tab-close-form-FFin').click();
    await msgbox(page, 'OnClose');
    await expect(page.getByTestId('doc-tab-form-FFin')).toHaveCount(0);
    await page.waitForTimeout(300);   // a second On Close would show its message box by now
    await expect(page.getByTestId('macro-msgbox')).toHaveCount(0);
    await expect(page.getByTestId('macro-failed')).toHaveCount(0);
  } finally {
    await app.close();
  }
});
