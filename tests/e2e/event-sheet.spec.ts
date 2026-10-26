// B2 Task 11: the Property Sheet's Event tab — a named macro picked from the list (macros and submacros), an embedded macro built
// with « … » in its own macro designer tab and saved into the open form (R16); the embedded macro changed elsewhere brings the
// security bar back (Review Focus 5); in disabled mode an embedded macro runs its safe actions and is blocked at SetValue.
import { test, expect, type Page } from '@playwright/test';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openBaseFile } from '../../src/main/db/file-format';
import { saveObject } from '../../src/main/db/objects';
import { seedSales } from '../../src/main/query/test-db';
import type { BasecraftApi } from '../../src/shared/api';
import type { ControlDef, DesignDoc } from '../../src/shared/design/model';
import type { MacroItem } from '../../src/shared/macro/model';
import { launchApp, seedBase, seedForm } from './helpers';

const fr = JSON.parse(readFileSync(join(__dirname, '../../src/shared/i18n/fr.json'), 'utf8'));
const FR = { BASECRAFT_REGION: 'fr-FR' };
const fill = (s: string, p: Record<string, string>) => s.replace(/\{\{(\w+)\}\}/g, (_, k: string) => p[k]!);
const act = (action: string, args: Record<string, string> = {}): MacroItem => ({ k: 'action', action, args });
const msg = (message: string) => act('MessageBox', { Message: message, Title: 'Test', Beep: 'no', Type: 'none' });
const box = (kind: ControlDef['kind'], name: string, top: number, props: Record<string, unknown>): ControlDef =>
  ({ kind, name, left: 1701, top, width: 2268, height: 340, props });
const form = (controls: ControlDef[]): DesignDoc => ({
  formatVersion: '1.0', recordSource: { kind: 'table', name: 'Clients' }, props: { Width: 9072 },
  sections: [{ kind: 'formHeader', height: 0, props: { Visible: false }, controls: [] },
    { kind: 'detail', height: 2268, props: {}, controls },
    { kind: 'formFooter', height: 0, props: { Visible: false }, controls: [] }],
});
const getForm = (page: Page, name: string) => page.evaluate((n) => (window as unknown as { basecraft: BasecraftApi }).basecraft.objects.get('form', n), name)
  .then((r) => r.definition as DesignDoc);

const base = () => seedBase('event-sheet', (db) => {
  seedSales(db);
  saveObject(db, 'macro', 'MLyon', { formatVersion: '1.0', items: [msg('Lyon'), { k: 'submacro', name: 'Fermer', items: [act('CloseWindow')] }] }, null);
  seedForm(db, 'FClients', form([box('textBox', 'Nom', 100, { ControlSource: 'Nom' }), box('commandButton', 'cmdCommandes', 600, { Caption: 'Commandes' })]));
  seedForm(db, 'FBloque', form([box('commandButton', 'cmdBloque', 100, { Caption: 'Bloqué',
    OnClick: { embedded: { formatVersion: '1.0', items: [msg('avant'), act('SetValue', { Item: '[Nom]', Expression: '"X"' })] } } })]));
});

async function design(page: Page, name: string) {
  await page.getByTestId(`nav-item-form-${name}`).click({ button: 'right' });
  await page.getByTestId('nav-menu-design').click();
  await expect(page.getByTestId('designer')).toBeVisible();
}
async function msgbox(page: Page, text: string) {
  await expect(page.getByTestId('macro-msgbox-text')).toHaveText(text);
  await page.getByTestId('macro-msgbox-ok').click();
  await expect(page.getByTestId('macro-msgbox')).toHaveCount(0);
}

test('Event tab: a named macro picked and run; an embedded macro built with « … », saved into the form, kept by the file; changed elsewhere, the bar is back', async () => {
  const file = base();
  const userDataDir = mkdtempSync(join(tmpdir(), 'basecraft-events-'));
  const open = () => launchApp({ args: [file], env: FR, userDataDir, untrusted: true });
  let { app, page } = await open();
  const title = `FClients : ${fr.tabs.kind.form} : ${fr.prop.BeforeUpdate}`;
  try {
    await page.getByTestId('banner-enable-content').click();
    await expect(page.getByTestId('banner-content')).toHaveCount(0);

    // « Sur clic » of cmdCommandes lists the macros and their submacros; MLyon picked, the form saved, then run
    await design(page, 'FClients');
    await page.getByTestId('ctl-cmdCommandes').click();
    await page.getByTestId('sheet-tab-event').click();
    await expect(page.getByTestId('prop-OnClick')).toBeEnabled();
    await page.getByTestId('prop-OnClick-toggle').click();
    const list = page.getByTestId('prop-OnClick-list');
    await expect(list.getByRole('option')).toHaveText(['MLyon', 'MLyon.Fermer']);
    await list.getByRole('option', { name: 'MLyon', exact: true }).click();
    await expect(page.getByTestId('prop-OnClick')).toHaveValue('MLyon');
    await page.getByTestId('prop-OnClick').fill('a.b.c');   // not a macro name: refused, nothing changes
    await page.getByTestId('prop-OnClick').press('Enter');
    await expect(page.getByTestId('prop-OnClick-error')).toHaveText(fr.sheet.error.badMacroName);
    await page.getByTestId('prop-OnClick').press('Escape');
    await expect(page.getByTestId('prop-OnClick')).toHaveValue('MLyon');
    await page.keyboard.press('Control+s');
    await expect(page.getByTestId('doc-tab-form-FClients')).not.toContainText('•');
    expect((await getForm(page, 'FClients')).sections[1]!.controls[1]!.props.OnClick).toBe('MLyon');
    await page.getByTestId('ribbon-tab-home').click();
    await page.getByTestId('cmd-viewForm').click();
    await page.getByTestId('form-ctl-cmdCommandes').click();
    await msgbox(page, 'Lyon');

    // « … » of the form's « Avant MAJ »: a new embedded macro in its own tab, no Run there
    await page.getByTestId('ribbon-tab-home').click();
    await page.getByTestId('cmd-viewDesign').click();
    await expect(page.getByTestId('designer')).toBeVisible();
    await page.getByTestId('sheet-object').selectOption('doc');
    await page.getByTestId('sheet-tab-event').click();
    await page.getByTestId('prop-BeforeUpdate-build').click();
    await expect(page.getByTestId(`doc-tab-macro-${title}`)).toBeVisible();
    await expect(page.getByTestId('macro-design')).toBeVisible();
    await expect(page.getByTestId('ribbon-tab-macroDesign')).toBeVisible();
    await page.getByTestId('ribbon-tab-macroDesign').click();
    await expect(page.getByTestId('cmd-macroRun')).toBeDisabled();
    await expect(page.getByTestId('cmd-singleStep')).toBeDisabled();
    await page.getByTestId('macro-add-root').fill(fr.macro.action.MessageBox);
    await page.getByTestId('macro-arg-0-Message-input').fill('x');
    await page.keyboard.press('Control+s');   // into the form, no name asked
    await expect(page.getByTestId('modal')).toHaveCount(0);
    await expect(page.getByTestId(`doc-tab-macro-${title}`)).not.toContainText('•');
    await expect(page.getByTestId('doc-tab-form-FClients')).toContainText('•');   // the form is dirty, nothing written yet
    expect((await getForm(page, 'FClients')).props.BeforeUpdate).toBeUndefined();
    await page.getByTestId(`doc-tab-close-macro-${title}`).click();
    await expect(page.getByTestId(`doc-tab-macro-${title}`)).toHaveCount(0);
    await expect(page.getByTestId('prop-BeforeUpdate')).toHaveValue(fr.sheet.embeddedMacro);
    await page.keyboard.press('Control+s');
    await expect(page.getByTestId('doc-tab-form-FClients')).not.toContainText('•');
    await expect(page.getByTestId('banner-content')).toHaveCount(0);   // its own change: approved again in the session (R5)
    expect((await getForm(page, 'FClients')).props.BeforeUpdate).toEqual({ embedded: { formatVersion: '1.0', items: [
      { k: 'action', action: 'MessageBox', args: expect.objectContaining({ Message: 'x' }) }] } });

    // reopened: the action is there; closing the design takes its embedded macro tab along
    await page.getByTestId('prop-BeforeUpdate-build').click();
    await expect(page.getByTestId('macro-arg-0-Message-input')).toHaveValue('x');
    await page.getByTestId('doc-tab-close-form-FClients').click();
    await expect(page.getByTestId('doc-tab-form-FClients')).toHaveCount(0);
    await expect(page.getByTestId(`doc-tab-macro-${title}`)).toHaveCount(0);
  } finally {
    await app.close();
  }

  // reopened as saved here: still the content approved, no bar
  ({ app, page } = await open());
  try {
    await expect(page.getByTestId('nav-item-form-FClients')).toBeVisible();
    await expect(page.getByTestId('banner-content')).toHaveCount(0);
  } finally {
    await app.close();
  }

  // the embedded macro changed by another program while the app is closed: not the content approved
  const { db } = openBaseFile(file, 'write', '0.0.0');
  try {
    const doc = JSON.parse((db.prepare("SELECT definition FROM bc_objects WHERE kind = 'form' AND name = 'FClients'").get() as { definition: string }).definition) as DesignDoc;
    doc.props.BeforeUpdate = { embedded: { formatVersion: '1.0', items: [msg('changé ailleurs')] } };
    expect(saveObject(db, 'form', 'FClients', doc, 'FClients')).toEqual({ ok: true });
  } finally {
    db.close();
  }
  ({ app, page } = await open());
  try {
    await expect(page.getByTestId('banner-content')).toBeVisible();
    // disabled: the embedded macro's safe action runs, SetValue is blocked
    await page.getByTestId('nav-item-form-FBloque').dblclick();
    await page.getByTestId('form-ctl-cmdBloque').click();
    await msgbox(page, 'avant');
    await expect(page.getByTestId('macro-failed-message')).toHaveText(fill(fr.macro.error.blocked, { action: fr.macro.action.SetValue }));
    await page.getByTestId('macro-failed-stop').click();
  } finally {
    await app.close();
  }
});

test('Event tab: closing the form asks its embedded macro first, then the form; Delete clears an embedded macro after a question', async () => {
  const { app, page } = await launchApp({ args: [base()], env: FR });
  try {
    await design(page, 'FClients');
    await page.getByTestId('ctl-cmdCommandes').click();
    await page.getByTestId('sheet-tab-event').click();
    await page.getByTestId('prop-OnClick-build').click();   // an empty event: a new embedded macro
    await expect(page.getByTestId(`doc-tab-macro-FClients : cmdCommandes : ${fr.prop.OnClick}`)).toBeVisible();
    await page.getByTestId('macro-add-root').fill(fr.macro.action.Beep);
    // closing the form asks the macro first (B1's question), then the form
    await page.getByTestId('doc-tab-close-form-FClients').click();
    await expect(page.getByTestId('modal')).toContainText(fill(fr.macro.saveFirst, { name: `FClients : cmdCommandes : ${fr.prop.OnClick}` }));
    await page.getByTestId('modal-btn-yes').click();
    await expect(page.getByTestId('modal')).toContainText(fill(fr.form.saveFirst, { name: 'FClients' }));
    await page.getByTestId('modal-btn-cancel').click();
    await expect(page.getByTestId('doc-tab-form-FClients')).toBeVisible();
    await expect(page.getByTestId('prop-OnClick')).toHaveValue(fr.sheet.embeddedMacro);
    // Delete clears it after a question
    await page.getByTestId('prop-OnClick').press('Delete');
    await expect(page.getByTestId('modal')).toContainText(fr.macro.embedded.deleteAsk);
    await page.getByTestId('modal-btn-yes').click();
    await expect(page.getByTestId('prop-OnClick')).toHaveValue('');
  } finally {
    await app.close();
  }
});
