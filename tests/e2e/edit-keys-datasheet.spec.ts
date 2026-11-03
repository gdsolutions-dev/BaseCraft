// Le modèle de touches d'Access dans les grilles (O2, tâche 4) : Entrée selon « Déplacement après saisie » (elle n'ouvre plus
// l'éditeur : F2), touches de direction, arrêt du curseur, comportement en entrée (« é », rafale d'un lecteur de codes-barres),
// feuille en lecture seule (Review Focus 3), enregistrement refusé (Review Focus 4), mode Feuille de données d'un formulaire et
// sous-formulaire.
import { test, expect, type Page } from '@playwright/test';
import { saveObject } from '../../src/main/db/objects';
import { createTable } from '../../src/main/db/schema';
import { seedSales } from '../../src/main/query/test-db';
import type { AppSettings, BasecraftApi, SettingKey } from '../../src/shared/api';
import type { ControlDef, DesignDoc } from '../../src/shared/design/model';
import { f, t } from '../../src/shared/test-fixtures';
import { formGrid, launchApp, seedBase, seedForm, colLeft } from './helpers';

type W = { basecraft: BasecraftApi };
const FR = { BASECRAFT_REGION: 'fr-FR' };
const box = (kind: ControlDef['kind'], name: string, left: number, top: number, props: Record<string, unknown>, width = 1500, height = 340): ControlDef =>
  ({ kind, name, left, top, width, height, props });
const formOf = (table: string, detail: ControlDef[], props: Record<string, unknown> = {}): DesignDoc => ({
  formatVersion: '1.0', recordSource: { kind: 'table', name: table }, props: { Width: 9000, ...props },
  sections: [
    { kind: 'formHeader', height: 0, props: { Visible: false }, controls: [] },
    { kind: 'detail', height: 3000, props: {}, controls: detail },
    { kind: 'formFooter', height: 0, props: { Visible: false }, controls: [] },
  ],
});
// Clients: Dupont / Lyon, Martin / LYON, Durand / Paris, Éric / Lyôn (N°, Nom, Ville); Commandes: Montant > 0, Dupont has two
const base = () => seedBase('fx-touches-grille', (db) => {
  seedSales(db);
  saveObject(db, 'query', 'QVilles', { formatVersion: '1.0', sql: 'SELECT Ville, Count(*) AS N FROM Clients GROUP BY Ville;' }, null);
  seedForm(db, 'FFeuille', formOf('Clients', [box('textBox', 'Nom', 100, 100, { ControlSource: 'Nom', TabIndex: 0 }),
    box('textBox', 'Ville', 100, 600, { ControlSource: 'Ville', TabIndex: 1 })], { DefaultView: 'datasheet' }));
  seedForm(db, 'FSous', formOf('Commandes', [box('textBox', 'Montant', 100, 100, { ControlSource: 'Montant', TabIndex: 0 })],
    { DefaultView: 'datasheet', AllowAdditions: false }));
  seedForm(db, 'FMaitre', formOf('Clients', [box('textBox', 'Nom', 100, 100, { ControlSource: 'Nom', TabIndex: 0 }),
    box('subform', 'Commandes', 100, 600, { SourceObject: 'FSous', LinkMasterFields: 'N°', LinkChildFields: 'Client', TabIndex: 1 }, 4000, 1500),
    box('textBox', 'Ville', 100, 2300, { ControlSource: 'Ville', TabIndex: 2 })]));
  // Fiches: a masked field, then a Lookup field (the last column)
  createTable(db, t('Fiches', [f('N°', 'autoNumber'), f('Code', 'shortText', { inputMask: '>L<LL' }),
    f('Statut', 'shortText', { lookup: { kind: 'values', values: ['Ouverte', 'Fermée'], limitToList: false } })]));
  const r = db.prepare('INSERT INTO "Fiches" ("Code", "Statut") VALUES (?, ?)');
  for (const v of [['Abc', 'Ouverte'], ['Xyz', 'Fermée']]) r.run(...v);
});

const set = <K extends SettingKey>(page: Page, k: K, v: AppSettings[K]) =>
  page.evaluate(([key, val]) => (window as unknown as W).basecraft.app.setSetting(key as SettingKey, val as never), [k, v] as const);
const sheet = (page: Page) => page.locator('[data-testid="datasheet"]:visible');   // the tab shown
const count = (page: Page) => page.locator('[data-testid="nav-record-count"]:visible');
/** Glide's accessible copy of a cell (col counted without the row selectors). */
const cell = (page: Page, col: number, row: number) => sheet(page).getByTestId(`glide-cell-${col + 1}-${row}`);
const editor = (page: Page) => page.locator('#portal textarea');
const caret = (page: Page) => editor(page).evaluate((e: HTMLTextAreaElement) => [e.selectionStart, e.selectionEnd]);
const rowsOf = async (page: Page, table: string) =>
  (await page.evaluate((t) => (window as unknown as W).basecraft.rows.page(t, { offset: 0, limit: 100 }), table)).rows.map((r) => r.values);
async function expectSelected(page: Page, col: number, row: number) {
  await expect(cell(page, col, row)).toHaveAttribute('aria-selected', 'true');
}
async function open(page: Page, item: string) {
  await page.getByTestId(`nav-item-${item}`).dblclick();
  await expect(sheet(page).getByTestId('data-grid-canvas')).toBeVisible();
  await expect(count(page)).not.toHaveText('0');
}
/** Clicks a cell (Clients' columns: N° 80 px, Nom 170, Ville 170, after the row selectors) and waits until Glide focuses it
 *  and the row left is saved (the cells are read-only meanwhile: keys typed then are dropped). */
async function click(page: Page, col: number, row: number) {
  const b = (await sheet(page).getByTestId('data-grid-canvas').boundingBox())!;
  await page.mouse.click(b.x + colLeft(col) + 20, b.y + 34 + row * 30 + 15);
  await expectSelected(page, col, row);
  await expect(sheet(page).locator('td[role=gridcell]:focus')).toHaveCount(1);
  await expect(sheet(page)).not.toHaveAttribute('aria-busy', 'true');
}
/** A key typing one character, sent as a keyboard would; `dead`: after a dead key (Review Focus 2). */
async function pressChar(page: Page, ch: string, dead = false) {
  const cdp = await page.context().newCDPSession(page);
  if (dead) await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Dead' });
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: ch, text: ch, unmodifiedText: ch });
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: ch });
  await cdp.detach();
}
async function enterClosing(page: Page) {
  await page.keyboard.press('Enter');
  await expect(editor(page)).toHaveCount(0);
}

test('Enter: Move after Enter, F2 opens the editor; next field wraps to the next record, then the new record', async () => {
  const { app, page } = await launchApp({ args: [base()], env: FR });
  try {
    await open(page, 'Clients');
    await click(page, 1, 0);
    await page.keyboard.press('Enter');
    await expectSelected(page, 2, 0);
    await expect(editor(page)).toHaveCount(0);
    await page.keyboard.press('F2');
    await expect(editor(page)).toBeFocused();
    await expect(editor(page)).toHaveValue('Lyon');
    expect(await caret(page)).toEqual([4, 4]);
    await page.keyboard.type('s');
    await enterClosing(page);   // past the last column: the next record's first field; the row left is saved
    await expectSelected(page, 0, 1);
    await expect.poll(async () => (await rowsOf(page, 'Clients'))[0]![2]).toBe('Lyons');
    await click(page, 2, 3);
    await page.keyboard.press('Enter');
    await expectSelected(page, 0, 4);   // the new record's row
    // a new record: past its last field, saved, then the next new record's row
    const b = (await sheet(page).getByTestId('data-grid-canvas').boundingBox())!;
    await page.mouse.click(b.x + colLeft(1) + 20, b.y + 34 + 4 * 30 + 15);
    await expect(editor(page)).toBeFocused();
    await page.keyboard.type('Zoé');
    await page.keyboard.press('Tab');
    await expect(editor(page)).toHaveCount(0);
    await page.keyboard.press('F2');
    await page.keyboard.type('Nice');
    await enterClosing(page);
    await expect(count(page)).toHaveText('5');
    await expectSelected(page, 0, 5);
    expect((await rowsOf(page, 'Clients'))[4]).toEqual([5, 'Zoé', 'Nice']);

    await set(page, 'moveAfterEnter', 'nextRecord');
    await click(page, 1, 0);
    await page.keyboard.press('Enter');
    await expectSelected(page, 1, 1);
    await page.keyboard.press('F2');
    await page.keyboard.type('Z');
    await enterClosing(page);
    await expectSelected(page, 1, 2);
    await expect.poll(async () => (await rowsOf(page, 'Clients'))[1]![1]).toBe('MartinZ');

    await set(page, 'moveAfterEnter', 'none');
    await page.keyboard.press('F2');
    await page.keyboard.type('Y');
    await enterClosing(page);   // the entry kept, the cell still selected
    await expectSelected(page, 1, 2);
    await expect(cell(page, 1, 2)).toHaveText('DurandY');
    await page.keyboard.press('Enter');
    await expectSelected(page, 1, 2);
    await expect(page.getByTestId('modal')).toHaveCount(0);
  } finally {
    await app.close();
  }
});

test('the arrows: next character opens the editor and leaves it at its ends; the cursor stop; Tab still wraps', async () => {
  const { app, page } = await launchApp({ args: [base()], env: FR });
  try {
    await open(page, 'Clients');
    await set(page, 'arrowKeyBehavior', 'nextCharacter');
    await click(page, 1, 0);
    await page.keyboard.press('ArrowRight');
    await expect(editor(page)).toBeFocused();
    expect(await caret(page)).toEqual([6, 6]);
    await page.keyboard.press('ArrowRight');   // at the end of the text: the next field
    await expect(editor(page)).toHaveCount(0);
    await expectSelected(page, 2, 0);
    await page.keyboard.press('ArrowLeft');   // navigation mode: the editor, the caret at the start
    await expect(editor(page)).toBeFocused();
    expect(await caret(page)).toEqual([0, 0]);
    await page.keyboard.press('ArrowLeft');
    await expect(editor(page)).toHaveCount(0);
    await expectSelected(page, 1, 0);

    // next field (default): the arrows move; past the last column the next record's first, unless the cursor stops there
    await set(page, 'arrowKeyBehavior', 'nextField');
    await page.keyboard.press('ArrowRight');
    await expectSelected(page, 2, 0);
    await page.keyboard.press('ArrowRight');
    await expectSelected(page, 0, 1);
    await page.keyboard.press('ArrowLeft');
    await expectSelected(page, 2, 0);
    await set(page, 'cursorStopsAtEnds', true);
    await page.keyboard.press('ArrowRight');
    await expectSelected(page, 2, 0);
    await page.keyboard.press('Tab');
    await expectSelected(page, 0, 1);
    await page.keyboard.press('ArrowLeft');
    await expectSelected(page, 0, 1);
    await page.keyboard.press('Shift+Tab');
    await expectSelected(page, 2, 0);
  } finally {
    await app.close();
  }
});

test('Behavior entering field: typing at the start or the end, « é » after a dead key, Backspace; a scanner burst ending with Enter', async () => {
  const { app, page } = await launchApp({ args: [base()], env: FR });
  try {
    await open(page, 'Clients');
    await set(page, 'enterFieldBehavior', 'start');
    await click(page, 1, 0);
    await page.keyboard.press('X');
    await expect(editor(page)).toHaveValue('XDupont');
    await page.keyboard.press('Enter');
    await set(page, 'enterFieldBehavior', 'end');
    await click(page, 1, 1);
    await page.keyboard.press('X');
    await expect(editor(page)).toHaveValue('MartinX');
    await page.keyboard.press('Enter');
    await set(page, 'enterFieldBehavior', 'start');
    await click(page, 1, 2);
    await pressChar(page, 'é', true);
    await expect(editor(page)).toHaveValue('éDurand');
    await page.keyboard.press('Enter');
    await set(page, 'enterFieldBehavior', 'end');
    await click(page, 1, 3);
    await page.keyboard.press('Backspace');
    await expect(editor(page)).toHaveValue('Éri');
    await enterClosing(page);
    // a scanner: the burst and its Enter with no delay, all kept, then the next field
    await click(page, 2, 0);
    await page.keyboard.type('ABC\n', { delay: 0 });
    await expect(editor(page)).toHaveCount(0);
    await expectSelected(page, 0, 1);
    await set(page, 'enterFieldBehavior', 'selectAll');
    await click(page, 2, 1);
    await page.keyboard.type('ABC\n', { delay: 0 });
    await expectSelected(page, 0, 2);
    await click(page, 2, 2);
    await page.keyboard.press('Q');   // the whole field: replaced
    await enterClosing(page);
    await click(page, 1, 0);
    await expect.poll(() => rowsOf(page, 'Clients')).toEqual([
      [1, 'XDupont', 'LyonABC'], [2, 'MartinX', 'ABC'], [3, 'éDurand', 'Q'], [4, 'Éri', 'Lyôn'],
    ]);
    // a range: Delete clears it (Glide's, as with « Champ entier »); Escape undoes the row's edit
    await set(page, 'enterFieldBehavior', 'start');
    await click(page, 1, 1);
    await page.keyboard.press('Shift+ArrowRight');
    await page.keyboard.press('Delete');
    await expect(cell(page, 1, 1)).toHaveText('');
    await expect(cell(page, 2, 1)).toHaveText('');
    await expect(editor(page)).toHaveCount(0);
    await page.keyboard.press('Escape');
    await expect(cell(page, 1, 1)).toHaveText('MartinX');
    // Alt alone is a shortcut, never typed (AltGr, Ctrl+Alt, types: « é » above)
    await set(page, 'enterFieldBehavior', 'end');
    await click(page, 1, 2);
    await page.keyboard.press('Alt+f');
    await page.keyboard.press('F2');
    await expect(editor(page)).toHaveValue('éDurand');
    await page.keyboard.press('Escape');
  } finally {
    await app.close();
  }
});

test('a sheet that cannot add stays at its end; a refused row keeps the selection (Review Focus 3, 4)', async () => {
  const { app, page } = await launchApp({ args: [base()], env: FR });
  try {
    await open(page, 'query-QVilles');
    const last = (await count(page).textContent())!;
    const row = Number(last) - 1;
    const b = (await sheet(page).getByTestId('data-grid-canvas').boundingBox())!;
    await page.mouse.click(b.x + colLeft(1) + 20, b.y + 34 + row * 30 + 15);   // N, after Ville
    await expectSelected(page, 1, row);
    for (const key of ['Enter', 'ArrowRight', 'Tab']) {
      await page.keyboard.press(key);
      await expectSelected(page, 1, row);
    }
    await expect(page.getByTestId('modal')).toHaveCount(0);

    await set(page, 'moveAfterEnter', 'nextRecord');
    await open(page, 'Commandes');
    const c = (await sheet(page).getByTestId('data-grid-canvas').boundingBox())!;
    await page.mouse.click(c.x + colLeft(2) + 20, c.y + 34 + 15);   // Montant: after N° and Client
    await expectSelected(page, 2, 0);
    await page.keyboard.type('-1');
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('modal')).toBeVisible();
    await page.getByTestId('modal-btn-ok').click();
    await expect(page.locator('[data-testid="datasheet-error"]:visible')).toBeVisible();
    await expectSelected(page, 2, 0);
  } finally {
    await app.close();
  }
});

test('the grid taking the focus back from an open editor (a late focus): the next keys still go into the editor', async () => {
  const { app, page } = await launchApp({ args: [base()], env: FR });
  try {
    await open(page, 'Clients');
    await click(page, 1, 0);
    const b = (await sheet(page).getByTestId('data-grid-canvas').boundingBox())!;
    await page.mouse.click(b.x + colLeft(1) + 20, b.y + 34 + 15);   // the selected cell again: its editor
    await expect(editor(page)).toBeFocused();
    await page.keyboard.press('Control+a');
    await page.keyboard.type('D');
    // what Glide's focus() does when a deferred call lands now: the selected cell's accessible copy, the editor still open
    const steal = () => cell(page, 1, 0).evaluate((e: HTMLElement) => e.focus());
    await steal();
    await page.keyboard.type('upondx');
    await expect(editor(page)).toHaveValue('Dupondx');
    await steal();
    await page.keyboard.press('Backspace');
    await expect(editor(page)).toHaveValue('Dupond');
    await steal();
    await enterClosing(page);   // Enter as from the editor: kept, next field
    await expectSelected(page, 2, 0);
    await expect(cell(page, 1, 0)).toHaveText('Dupond');
  } finally {
    await app.close();
  }
});

test('a form in Datasheet view: Enter moves right; a subform datasheet past its last cell goes to the master\'s next control', async () => {
  const { app, page } = await launchApp({ args: [base()], env: FR });
  try {
    await page.getByTestId('nav-item-form-FFeuille').dblclick();
    const g = formGrid(page, page.getByTestId('form-run'), [100, 100]);
    await g.click(0, 0);   // the current record's cell already selected: its editor opens (Glide)
    await page.keyboard.press('Enter');
    await expect(g.cell(1, 0)).toHaveAttribute('aria-selected', 'true');
    await page.keyboard.press('Enter');
    await expect(g.cell(0, 1)).toHaveAttribute('aria-selected', 'true');

    await page.getByTestId('nav-item-form-FMaitre').dblclick();
    await expect(page.locator('[data-testid="form-ctl-Nom"]:visible')).toHaveValue('Dupont');
    const s = formGrid(page, page.getByTestId('form-ctl-Commandes'), [100]);
    await expect(s.count).toHaveText('2');
    await s.click(0, 0);
    await page.keyboard.press('ArrowDown');   // its last record (Allow Additions off), its last cell
    await expect(s.cell(0, 1)).toHaveAttribute('aria-selected', 'true');
    await page.keyboard.press('Enter');
    await expect(page.locator('[data-testid="form-ctl-Ville"]:visible')).toBeFocused();
  } finally {
    await app.close();
  }
});

test('the masked and lookup editors follow Move after Enter (next field) and Tab wraps from them', async () => {
  const { app, page } = await launchApp({ args: [base()], env: FR });
  try {
    await open(page, 'Fiches');
    const mask = page.getByTestId('masked-editor'), lookup = page.getByTestId('lookup-editor');
    await click(page, 1, 0);   // Code (N° 80 px)
    await page.keyboard.press('F2');
    await expect(mask).toBeFocused();
    await page.keyboard.press('Backspace');
    await page.keyboard.type('d');
    await page.keyboard.press('Enter');
    await expect(mask).toHaveCount(0);
    await expectSelected(page, 2, 0);   // the next field, not the next record
    await page.keyboard.press('F2');
    await expect(lookup).toBeFocused();
    await expect(lookup).toHaveValue('Ouverte');
    await page.keyboard.press('ArrowDown');   // the list's own arrows
    await expect(lookup).toHaveValue('Fermée');
    await page.keyboard.press('Enter');   // picks, then past the last column: the next record's first field
    await expect(lookup).toHaveCount(0);
    await expectSelected(page, 0, 1);
    await expect.poll(async () => (await rowsOf(page, 'Fiches'))[0]).toEqual([1, 'Abd', 'Fermée']);
    await click(page, 2, 1);
    await page.keyboard.press('F2');
    await page.keyboard.press('ArrowDown');
    await expect(lookup).toHaveValue('Ouverte');
    await page.keyboard.press('Tab');   // wraps to the new record's row
    await expect(lookup).toHaveCount(0);
    await expectSelected(page, 0, 2);
    await expect.poll(async () => (await rowsOf(page, 'Fiches'))[1]).toEqual([2, 'Xyz', 'Ouverte']);
  } finally {
    await app.close();
  }
});
