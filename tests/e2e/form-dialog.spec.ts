// B2 Task 9: OpenForm in Dialog window mode (R12) — the form over the whole window, the ribbon and the Navigation Pane out of
// reach, the macro waiting until it closes (OK or the close button), then the opener tab active again.
import { test, expect, type Page } from '@playwright/test';
import { seedSales } from '../../src/main/query/test-db';
import type { ControlDef, DesignDoc } from '../../src/shared/design/model';
import type { MacroItem } from '../../src/shared/macro/model';
import { launchApp, seedBase, seedForm } from './helpers';

const FR = { BASECRAFT_REGION: 'fr-FR' };
const act = (action: string, args: Record<string, string> = {}): MacroItem => ({ k: 'action', action, args });
const embedded = (...items: MacroItem[]) => ({ embedded: { formatVersion: '1.0' as const, items } });
const box = (kind: ControlDef['kind'], name: string, top: number, props: Record<string, unknown>): ControlDef =>
  ({ kind, name, left: 1701, top, width: 2268, height: 340, props });
const form = (controls: ControlDef[], props: Record<string, unknown> = {}): DesignDoc => ({
  formatVersion: '1.0', recordSource: null, props: { Width: 6000, ...props },
  sections: [{ kind: 'formHeader', height: 0, props: { Visible: false }, controls: [] },
    { kind: 'detail', height: 2000, props: {}, controls },
    { kind: 'formFooter', height: 0, props: { Visible: false }, controls: [] }],
});

const base = () => seedBase('form-dialog', (db) => {
  seedSales(db);
  seedForm(db, 'FMenu', form([box('commandButton', 'cmdChoisir', 100, { Caption: 'Choisir', OnClick: embedded(
    act('RemoveTempVar', { Name: 'Choix' }),
    act('OpenForm', { FormName: 'FChoix', View: 'form', WindowMode: 'dialog' }),
    act('MessageBox', { Message: '="Choisi : " & [TempVars]![Choix]', Title: 'Test', Beep: 'no', Type: 'none' })) })]));
  // a bound opener that writes the choice into its own record (finding: SetValue right after the dialog closes)
  seedForm(db, 'FClientVille', { ...form([
    box('textBox', 'Ville', 100, { ControlSource: 'Ville' }),
    box('commandButton', 'cmdVille', 600, { Caption: 'Ville', OnClick: embedded(
      act('OpenForm', { FormName: 'FChoix', View: 'form', WindowMode: 'dialog' }),
      act('SetValue', { Item: '[Ville]', Expression: '[TempVars]![Choix]' })) }),
  ]), recordSource: { kind: 'table', name: 'Clients' } });
  seedForm(db, 'FChoix', form([
    box('comboBox', 'Choix', 100, { TabIndex: 0, RowSourceType: 'valueList', RowSource: 'Paris;Lyon;Nantes', LimitToList: true }),
    box('commandButton', 'cmdOK', 600, { Caption: 'OK', TabIndex: 1,
      OnClick: embedded(act('SetTempVar', { Name: 'Choix', Expression: '[Choix]' }), act('CloseWindow')) }),
  ], { Caption: 'Choisir une ville' }));
});

async function msgbox(page: Page, text: RegExp) {
  await expect(page.getByTestId('macro-msgbox')).toBeVisible();
  await expect(page.getByTestId('macro-msgbox-text')).toHaveText(text);
  await page.getByTestId('macro-msgbox-ok').click();
  await expect(page.getByTestId('macro-msgbox')).toHaveCount(0);
}

test('OpenForm in Dialog mode: over the window, the shell out of reach, the macro waits for its close (OK or the close button)', async () => {
  test.setTimeout(90_000);
  const { app, page } = await launchApp({ args: [base()], env: FR });
  const dialog = page.getByTestId('form-dialog-FChoix');
  try {
    await page.getByTestId('nav-item-form-FMenu').dblclick();
    await expect(page.getByTestId('doc-tab-form-FMenu')).toBeVisible();
    await page.getByTestId('form-ctl-cmdChoisir').click();
    await expect(dialog).toBeVisible();
    await expect(dialog).toHaveAttribute('aria-modal', 'true');
    await expect(dialog.getByTestId('form-dialog-title')).toHaveText('Choisir une ville');
    await expect(page.getByTestId('doc-tab-form-FChoix')).toHaveCount(0);   // not a tab
    await expect(page.getByTestId('macro-msgbox')).toHaveCount(0);           // the macro waits

    // the ribbon and the Navigation Pane do not respond: inert, under the backdrop
    expect(await page.getByTestId('app-root').evaluate((e) => (e as HTMLElement).inert)).toBe(true);
    await page.getByTestId('nav-item-Clients').dblclick({ force: true });
    await page.getByTestId('ribbon-tab-create').click({ force: true });
    await expect(page.getByTestId('ribbon-tab-create')).toHaveAttribute('aria-selected', 'false');
    await expect(page.getByTestId('doc-tab-table-Clients')).toHaveCount(0);
    await page.keyboard.press('Escape');   // Access: Escape does not close a dialog form
    await expect(dialog).toBeVisible();

    // Lyon, OK: the dialog closes, then the message; the opener tab is active again
    await dialog.getByTestId('form-ctl-Choix-toggle').click();
    await page.getByTestId('form-list-Choix').getByRole('option', { name: 'Lyon' }).click();
    await expect(dialog.getByTestId('form-ctl-Choix')).toHaveValue('Lyon');
    await dialog.getByTestId('form-ctl-cmdOK').click();
    await expect(dialog).toHaveCount(0);
    await msgbox(page, /^Choisi : Lyon$/);
    await expect(page.getByTestId('doc-tab-form-FMenu')).toHaveAttribute('aria-selected', 'true');
    expect(await page.getByTestId('app-root').evaluate((e) => (e as HTMLElement).inert)).toBe(false);

    // the close button instead of OK: the macro goes on, nothing chosen
    await page.getByTestId('form-ctl-cmdChoisir').click();
    await expect(dialog).toBeVisible();
    await dialog.getByTestId('form-dialog-close').click();
    await expect(dialog).toHaveCount(0);
    await msgbox(page, /^Choisi :\s*$/);
    await expect(page.getByTestId('form-ctl-cmdChoisir')).toBeFocused();   // the focus back where it was before the dialog
    await expect(page.getByTestId('doc-tab-form-FMenu')).toHaveAttribute('aria-selected', 'true');
  } finally {
    await app.close();
  }
});

test('a bound opener sets its own record right after its dialog closes (no refusal while the record is read again)', async () => {
  test.setTimeout(60_000);
  const { app, page } = await launchApp({ args: [base()], env: FR });
  const dialog = page.getByTestId('form-dialog-FChoix');
  try {
    await page.getByTestId('nav-item-form-FClientVille').dblclick();
    await expect(page.getByTestId('form-ctl-Ville')).toHaveValue('Lyon');   // Dupont
    await page.getByTestId('form-ctl-cmdVille').click();
    await expect(dialog).toBeVisible();
    await dialog.getByTestId('form-ctl-Choix-toggle').click();
    await page.getByTestId('form-list-Choix').getByRole('option', { name: 'Nantes' }).click();
    await dialog.getByTestId('form-ctl-cmdOK').click();
    await expect(dialog).toHaveCount(0);
    await expect(page.getByTestId('form-ctl-Ville')).toHaveValue('Nantes');
    await expect(page.getByTestId('macro-failed')).toHaveCount(0);
  } finally {
    await app.close();
  }
});
