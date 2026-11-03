// Le modèle de touches d'Access dans les formulaires (O2, tâche 3) : Effet de la touche Entrée, Comportement du champ en entrée,
// Touches de direction, formulaires continus, Arrêt du curseur sur le premier/dernier champ ; sous-formulaire, contrôle
// onglet et enregistrement refusé (Review Focus 3 et 4).
import { test, expect, type Locator, type Page } from '@playwright/test';
import { seedSales } from '../../src/main/query/test-db';
import type { AppSettings, BasecraftApi, SettingKey } from '../../src/shared/api';
import type { ControlDef, DesignDoc } from '../../src/shared/design/model';
import { launchApp, seedBase, seedForm } from './helpers';

type W = { basecraft: BasecraftApi };
const FR = { BASECRAFT_REGION: 'fr-FR' };
const box = (kind: ControlDef['kind'], name: string, left: number, top: number, props: Record<string, unknown>, width = 1500, height = 340): ControlDef =>
  ({ kind, name, left, top, width, height, props });
const formOf = (table: string, detail: ControlDef[], props: Record<string, unknown> = {}, height = 3000): DesignDoc => ({
  formatVersion: '1.0', recordSource: { kind: 'table', name: table }, props: { Width: 9000, ...props },
  sections: [
    { kind: 'formHeader', height: 0, props: { Visible: false }, controls: [] },
    { kind: 'detail', height, props: {}, controls: detail },
    { kind: 'formFooter', height: 0, props: { Visible: false }, controls: [] },
  ],
});
// Nom, Ville, then an unbound check box Actif: down the page (a single form) or along the row (a continuous form)
const client = (across: boolean) => [
  box('textBox', 'Nom', 100, 100, { ControlSource: 'Nom', TabIndex: 0 }),
  box('textBox', 'Ville', across ? 1800 : 100, across ? 100 : 600, { ControlSource: 'Ville', TabIndex: 1 }),
  box('checkBox', 'Actif', across ? 3500 : 100, across ? 100 : 1100, { TabIndex: 2 }, 284, 284),
];
// Clients: Dupont / Lyon, Martin / LYON, Durand / Paris, Éric / Lyôn; Commandes: Montant > 0, Dupont has two
const base = () => seedBase('fx-touches-formulaire', (db) => {
  seedSales(db);
  seedForm(db, 'FClient', formOf('Clients', client(false)));
  seedForm(db, 'FFixe', formOf('Clients', client(false), { AllowAdditions: false }));
  seedForm(db, 'FListe', formOf('Clients', client(true), { DefaultView: 'continuous' }, 500));
  seedForm(db, 'FCommande', formOf('Commandes', [box('textBox', 'Client', 100, 100, { ControlSource: 'Client', TabIndex: 0 }), box('textBox', 'Montant', 100, 600, { ControlSource: 'Montant', TabIndex: 1 })]));
  seedForm(db, 'FSous', formOf('Commandes', [box('textBox', 'Montant', 100, 100, { ControlSource: 'Montant', TabIndex: 0 })], { AllowAdditions: false }, 600));
  seedForm(db, 'FMaitre', formOf('Clients', [box('textBox', 'Nom', 100, 100, { ControlSource: 'Nom', TabIndex: 0 }),
    box('subform', 'Commandes', 100, 600, { SourceObject: 'FSous', LinkMasterFields: 'N°', LinkChildFields: 'Client', TabIndex: 1 }, 4000, 1500),
    box('textBox', 'Ville', 100, 2300, { ControlSource: 'Ville', TabIndex: 2 })], {}, 3000));
  seedForm(db, 'FOnglets', formOf('Clients', [box('textBox', 'Nom', 100, 100, { ControlSource: 'Nom', TabIndex: 0 }),
    { ...box('tabControl', 'Pages', 100, 600, { Pages: ['Un', 'Deux'], TabIndex: 1 }, 5000, 2000), children: [
      box('textBox', 'Ville', 300, 1200, { ControlSource: 'Ville', PageIndex: 0 }), box('textBox', 'Note', 300, 1200, { PageIndex: 1 })] }]));
  // Montant (rule > 0), an unbound option group, an unbound list box
  const opt = (name: string, value: number, top: number): ControlDef => ({ kind: 'optionButton', name, left: 2200, top, width: 284, height: 284, props: { OptionValue: value } });
  seedForm(db, 'FGroupe', formOf('Commandes', [box('textBox', 'Client', 100, 100, { ControlSource: 'Client', TabIndex: 0 }),
    box('textBox', 'Montant', 100, 600, { ControlSource: 'Montant', TabIndex: 1 }),
    { ...box('optionGroup', 'G', 2000, 100, { Caption: 'Choix', TabIndex: 2 }, 2000, 1200), children: [opt('A', 1, 500), opt('B', 2, 900)] },
    box('listBox', 'L', 100, 1500, { TabIndex: 3, RowSourceType: 'valueList', RowSource: 'Un;Deux;Trois' }, 2000, 900)]));
});

const vis = (page: Page, id: string) => page.locator(`[data-testid="${id}"]:visible`);
const ctl = (page: Page, n: string) => vis(page, `form-ctl-${n}`);
const sel = (l: Locator) => l.evaluate((e: HTMLInputElement) => [e.selectionStart, e.selectionEnd]);
const set = <K extends SettingKey>(page: Page, k: K, v: AppSettings[K]) =>
  page.evaluate(([key, val]) => (window as unknown as W).basecraft.app.setSetting(key as SettingKey, val as never), [k, v] as const);
async function open(page: Page, form: string) {
  await page.getByTestId(`nav-item-form-${form}`).dblclick();
  await expect(page.getByTestId(`doc-tab-form-${form}`)).toHaveAttribute('aria-selected', 'true');
  await expect(vis(page, 'nav-record-input').first()).toHaveValue('1');
}

test('a single form: Enter, Behavior entering field, the arrows, F2 and the cursor stop, as Access', async () => {
  const { app, page } = await launchApp({ args: [base()], env: FR });
  try {
    const record = vis(page, 'nav-record-input');
    const dirty = vis(page, 'form-dirty');
    await open(page, 'FClient');

    // default: Tab into Nom selects it all; Enter: the next field, past the last stop the next record's first
    await ctl(page, 'Ville').click();
    await page.keyboard.press('Shift+Tab');
    await expect(ctl(page, 'Nom')).toBeFocused();
    expect(await sel(ctl(page, 'Nom'))).toEqual([0, 6]);
    await page.keyboard.press('Enter');
    await expect(ctl(page, 'Ville')).toBeFocused();
    expect(await sel(ctl(page, 'Ville'))).toEqual([0, 4]);
    await page.keyboard.press('Enter');
    await expect(ctl(page, 'Actif')).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(record).toHaveValue('2');
    await expect(ctl(page, 'Nom')).toBeFocused();
    await expect(ctl(page, 'Nom')).toHaveValue('Martin');
    // Next field: Right in navigation goes to Ville; typed into (edit mode), Left moves the caret
    await page.keyboard.press('ArrowRight');
    await expect(ctl(page, 'Ville')).toBeFocused();
    await page.keyboard.type('x');
    await page.keyboard.press('ArrowLeft');
    await expect(ctl(page, 'Ville')).toBeFocused();
    expect(await sel(ctl(page, 'Ville'))).toEqual([0, 0]);
    await page.keyboard.press('Escape');
    await expect(ctl(page, 'Ville')).toHaveValue('LYON');
    // F2: navigation -> the caret at the end; again -> all of it selected
    await page.keyboard.press('Tab');
    await page.keyboard.press('Shift+Tab');
    await expect(ctl(page, 'Ville')).toBeFocused();
    await page.keyboard.press('F2');
    expect(await sel(ctl(page, 'Ville'))).toEqual([4, 4]);
    await page.keyboard.press('ArrowLeft');   // edit mode now: the caret moves
    expect(await sel(ctl(page, 'Ville'))).toEqual([3, 3]);
    await page.keyboard.press('F2');
    expect(await sel(ctl(page, 'Ville'))).toEqual([0, 4]);
    await page.keyboard.press('ArrowLeft');   // navigation again: the previous field
    await expect(ctl(page, 'Nom')).toBeFocused();

    // Next record: Enter in Ville, the same control on the next record
    await set(page, 'moveAfterEnter', 'nextRecord');
    await ctl(page, 'Ville').press('Enter');
    await expect(record).toHaveValue('3');
    await expect(ctl(page, 'Ville')).toBeFocused();
    await expect(ctl(page, 'Ville')).toHaveValue('Paris');
    expect(await sel(ctl(page, 'Ville'))).toEqual([0, 5]);
    // no effect: the control stays, the text typed pending
    await set(page, 'moveAfterEnter', 'none');
    await page.keyboard.type('y');
    await page.keyboard.press('Enter');
    await expect(ctl(page, 'Ville')).toBeFocused();
    await expect(ctl(page, 'Ville')).toHaveValue('y');
    await expect(dirty).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(dirty).toHaveCount(0);

    // Start / End of field: the caret at 0 or at the end, typing inserts there; a click keeps the caret where it lands
    await set(page, 'moveAfterEnter', 'nextField');
    await set(page, 'enterFieldBehavior', 'start');
    await page.keyboard.press('Shift+Tab');
    await expect(ctl(page, 'Nom')).toBeFocused();
    expect(await sel(ctl(page, 'Nom'))).toEqual([0, 0]);
    await page.keyboard.type('A');
    await expect(ctl(page, 'Nom')).toHaveValue('ADurand');
    await page.keyboard.press('Escape');
    await set(page, 'enterFieldBehavior', 'end');
    await page.keyboard.press('Tab');
    await page.keyboard.press('Shift+Tab');
    expect(await sel(ctl(page, 'Nom'))).toEqual([6, 6]);
    await page.keyboard.type('B');
    await expect(ctl(page, 'Nom')).toHaveValue('DurandB');
    await page.keyboard.press('Escape');
    await ctl(page, 'Ville').click({ position: { x: 3, y: 8 } });
    expect(await sel(ctl(page, 'Ville'))).toEqual([0, 0]);

    // Next character: Right goes through « Durand », then, at its end, to Ville; Left at 0 back to Nom
    await set(page, 'enterFieldBehavior', 'start');
    await set(page, 'arrowKeyBehavior', 'nextCharacter');
    await page.keyboard.press('Shift+Tab');
    for (let i = 1; i <= 6; i++) {
      await page.keyboard.press('ArrowRight');
      expect(await sel(ctl(page, 'Nom'))).toEqual([i, i]);
    }
    await page.keyboard.press('ArrowRight');
    await expect(ctl(page, 'Ville')).toBeFocused();
    expect(await sel(ctl(page, 'Ville'))).toEqual([0, 0]);
    await page.keyboard.press('ArrowLeft');
    await expect(ctl(page, 'Nom')).toBeFocused();

    // Cursor stops at first/last field: Down on the last stop stays on the record; Tab still goes on
    await set(page, 'arrowKeyBehavior', 'nextField');
    await set(page, 'enterFieldBehavior', 'selectAll');
    await set(page, 'cursorStopsAtEnds', true);
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowDown');
    await expect(ctl(page, 'Actif')).toBeFocused();
    await page.keyboard.press('ArrowDown');
    await expect(ctl(page, 'Actif')).toBeFocused();
    await expect(record).toHaveValue('3');
    await page.keyboard.press('ArrowUp');
    await page.keyboard.press('ArrowUp');
    await page.keyboard.press('ArrowUp');   // the first stop: stays
    await expect(ctl(page, 'Nom')).toBeFocused();
    await expect(record).toHaveValue('3');
    await page.keyboard.press('Shift+Tab');
    await expect(record).toHaveValue('2');   // Tab is not stopped
    await set(page, 'cursorStopsAtEnds', false);

    // Review Focus 3: Enter (next record) on the last record of a form that cannot add: it stays, no error
    await open(page, 'FFixe');
    await ctl(page, 'Nom').click();
    await page.keyboard.press('ControlOrMeta+End');
    await expect(record).toHaveValue('4');
    await set(page, 'moveAfterEnter', 'nextRecord');
    await page.keyboard.press('Enter');
    await page.keyboard.press('Enter');
    await expect(record).toHaveValue('4');
    await expect(ctl(page, 'Actif')).toBeFocused();
    await expect(page.getByTestId('modal')).toHaveCount(0);
  } finally {
    await app.close();
  }
});

test('a continuous form: Up/Down or Left/Right go to the record, the focus in the same control; a single form ignores them', async () => {
  const { app, page } = await launchApp({ args: [base()], env: FR });
  try {
    const record = vis(page, 'nav-record-input');
    const row = (i: number, n: string) => page.getByTestId(`form-row-${i}`).getByTestId(`form-ctl-${n}`);
    await set(page, 'continuousArrowKeys', 'upDown');
    await open(page, 'FListe');
    await row(0, 'Ville').click();
    await page.keyboard.press('ArrowDown');
    await expect(record).toHaveValue('2');
    await expect(row(1, 'Ville')).toBeFocused();
    expect(await sel(row(1, 'Ville'))).toEqual([0, 4]);   // reached by the keyboard: all of it selected
    await page.keyboard.press('ArrowUp');
    await expect(record).toHaveValue('1');
    await expect(row(0, 'Ville')).toBeFocused();
    await page.keyboard.press('ArrowRight');   // not Left/Right: the next field
    await expect(row(0, 'Actif')).toBeFocused();
    await set(page, 'continuousArrowKeys', 'leftRight');
    await page.keyboard.press('ArrowRight');
    await expect(record).toHaveValue('2');
    await expect(row(1, 'Actif')).toBeFocused();
    await page.keyboard.press('ArrowDown');   // not Up/Down: past the last field, the next record's first (as Tab)
    await expect(record).toHaveValue('3');
    await expect(row(2, 'Nom')).toBeFocused();

    // a single form: the same keys move between fields
    await open(page, 'FClient');
    await ctl(page, 'Ville').click();
    await page.keyboard.press('Shift+Tab');
    await page.keyboard.press('ArrowRight');
    await expect(ctl(page, 'Ville')).toBeFocused();
    await set(page, 'continuousArrowKeys', 'upDown');
    await page.keyboard.press('ArrowDown');
    await expect(ctl(page, 'Actif')).toBeFocused();
    await expect(record).toHaveValue('1');
  } finally {
    await app.close();
  }
});

test('Enter walks Tab\'s path through a subform and a tab control; a refused save keeps the record and the focus', async () => {
  const { app, page } = await launchApp({ args: [base()], env: FR });
  try {
    // a subform (no additions): Enter on its last stop goes to its next record, then, at its last, to the master's next control
    await open(page, 'FMaitre');
    const sub = page.getByTestId('form-ctl-Commandes');
    const montant = sub.getByTestId('form-ctl-Montant');
    await ctl(page, 'Nom').first().click();
    await page.keyboard.press('Enter');
    await expect(montant).toBeFocused();
    await expect(montant).toHaveValue('10,1');
    await page.keyboard.press('Enter');
    await expect(montant).toBeFocused();
    await expect(montant).toHaveValue('0,1');
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('form-ctl-Ville')).toBeFocused();

    // a tab control: its strip, then the page shown only, then the next record
    await open(page, 'FOnglets');
    const record = vis(page, 'nav-record-input');
    await ctl(page, 'Nom').click();
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('form-tab-Pages-0')).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('form-tab-Pages-0')).toHaveAttribute('aria-selected', 'true');
    await expect(ctl(page, 'Ville')).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(record).toHaveValue('2');
    await expect(ctl(page, 'Nom')).toBeFocused();

    // Review Focus 4: Enter (next record) from an entry its validation rule refuses: the message, the focus stays, nothing saved
    await set(page, 'moveAfterEnter', 'nextRecord');
    await open(page, 'FCommande');
    await ctl(page, 'Client').click();
    await page.keyboard.press('Tab');
    await page.keyboard.type('0');
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('modal')).toBeVisible();
    await page.getByTestId('modal-btn-ok').click();
    await expect(ctl(page, 'Montant')).toBeFocused();
    await expect(ctl(page, 'Montant')).toHaveValue('0');
    // the focus given back (Access's boxes take no focus): the selection is kept, the next key does not replace the text
    expect(await sel(ctl(page, 'Montant'))).toEqual([1, 1]);
    await expect(vis(page, 'nav-record-input')).toHaveValue('1');
    const montants = await page.evaluate(() => (window as unknown as W).basecraft.rows.page('Commandes', { offset: 0, limit: 1 }).then((p) => p.rows[0]!.values[2]));
    expect(montants).toBe(10.1);
  } finally {
    await app.close();
  }
});

test('type-ahead follows Behavior entering field; a list box keeps its arrows; Page Down applies the entry caret; a click on a frame keeps edit mode', async () => {
  const { app, page } = await launchApp({ args: [base()], env: FR });
  try {
    const record = vis(page, 'nav-record-input');
    // the record left is saved slowly (its write held 400 ms in the main process): the keys come while the move is under way
    const slowUpdates = (on: boolean) => app.evaluate(({ ipcMain }, slow) => {
      const handlers = (ipcMain as unknown as { _invokeHandlers: Map<string, (...a: unknown[]) => unknown> })._invokeHandlers;
      const g = globalThis as unknown as { realUpdate?: (...a: unknown[]) => unknown };
      g.realUpdate ??= handlers.get('bc:rows:update');
      const real = g.realUpdate!;
      handlers.set('bc:rows:update', slow ? async (...a: unknown[]) => { await new Promise((r) => setTimeout(r, 400)); return real(...a); } : real);
    }, on);

    // « Fin du champ »: Enter (next record) from an edited record, « bis » typed at once: appended to « Paris »
    await set(page, 'moveAfterEnter', 'nextRecord');
    await set(page, 'enterFieldBehavior', 'end');
    await open(page, 'FClient');
    await ctl(page, 'Nom').click();
    await page.keyboard.press('PageDown');
    await expect(record).toHaveValue('2');
    await ctl(page, 'Nom').fill('Martine');
    await page.keyboard.press('Tab');
    await slowUpdates(true);
    await page.keyboard.press('Enter');
    await page.keyboard.type('bis');   // no wait: the record left is still being saved
    await expect(record).toHaveValue('3');
    await expect(ctl(page, 'Ville')).toHaveValue('Parisbis');
    expect(await sel(ctl(page, 'Ville'))).toEqual([8, 8]);
    await slowUpdates(false);
    await page.keyboard.press('Escape');
    await set(page, 'moveAfterEnter', 'nextField');
    await set(page, 'enterFieldBehavior', 'selectAll');

    // Page Down keeps the control and gives it the entry caret (« Champ entier »)
    await open(page, 'FGroupe');
    await ctl(page, 'Montant').click({ position: { x: 3, y: 8 } });
    await page.keyboard.press('PageDown');
    await expect(vis(page, 'nav-record-input').first()).toHaveValue('2');
    await expect(ctl(page, 'Montant')).toHaveValue('0,1');
    await expect.poll(() => sel(ctl(page, 'Montant'))).toEqual([0, 3]);
    await page.keyboard.press('PageUp');
    await expect(vis(page, 'nav-record-input').first()).toHaveValue('1');

    // a list box: Left / Right move its own selection, not to another field
    await ctl(page, 'L').focus();
    await page.keyboard.press('ArrowDown');
    await expect(page.getByTestId('form-option-L-0')).toHaveAttribute('aria-selected', 'true');
    await page.keyboard.press('ArrowRight');
    await expect(page.getByTestId('form-option-L-1')).toHaveAttribute('aria-selected', 'true');
    await page.keyboard.press('ArrowLeft');
    await expect(page.getByTestId('form-option-L-0')).toHaveAttribute('aria-selected', 'true');
    await expect(ctl(page, 'L')).toBeFocused();
    await expect(vis(page, 'nav-record-input').first()).toHaveValue('1');

    // clicked into Montant (edit mode), then a press on the option group's frame, which takes no focus, and the focus given back
    // to Montant (as after a ribbon command): still in edit mode (Left moves the caret, not to Client)
    await ctl(page, 'Montant').click();
    await ctl(page, 'Montant').fill('5');
    const frame = (await ctl(page, 'G').boundingBox())!;
    await page.mouse.click(frame.x + frame.width - 4, frame.y + frame.height - 4);
    await ctl(page, 'Montant').focus();
    expect(await sel(ctl(page, 'Montant'))).toEqual([1, 1]);
    await page.keyboard.press('ArrowLeft');
    await expect(ctl(page, 'Montant')).toBeFocused();
    expect(await sel(ctl(page, 'Montant'))).toEqual([0, 0]);
    await page.keyboard.press('Escape');
  } finally {
    await app.close();
  }
});
