// O2 acceptance (roadmap, batch O2): each Enter / arrow setting, set through File › Options, behaves as in Access in a table datasheet
// and in a continuous form; a datasheet opened with the new default font and width uses them; a too-narrow number column shows ####
// while « Vérifier les champs numériques tronqués » is on; every option survives a restart (same userDataDir).
import { test, expect, type Locator, type Page } from '@playwright/test';
import { seedSales } from '../../src/main/query/test-db';
import type { ControlDef, DesignDoc } from '../../src/shared/design/model';
import { colLeft, launchApp, openDbOptions, seedBase, seedForm } from './helpers';

const FR = { BASECRAFT_REGION: 'fr-FR' };
const HEADER = 34;
const box = (name: string, left: number, i: number): ControlDef => ({ kind: 'textBox', name, left, top: 100, width: 1500, height: 340, props: { ControlSource: name, TabIndex: i } });
// FListe: Nom, Ville along each row of a continuous form on Clients (Dupont / Lyon, Martin / LYON, Durand / Paris, Éric / Lyôn)
const FLISTE: DesignDoc = {
  formatVersion: '1.0', recordSource: { kind: 'table', name: 'Clients' }, props: { Width: 9000, DefaultView: 'continuous' },
  sections: [
    { kind: 'formHeader', height: 0, props: { Visible: false }, controls: [] },
    { kind: 'detail', height: 500, props: {}, controls: [box('Nom', 100, 0), box('Ville', 1800, 1)] },
    { kind: 'formFooter', height: 0, props: { Visible: false }, controls: [] },
  ],
};

const sheet = (page: Page) => page.locator('[data-testid="datasheet"]:visible');
const cell = (page: Page, col: number, row: number) => sheet(page).getByTestId(`glide-cell-${col + 1}-${row}`);
const editor = (page: Page) => page.locator('#portal textarea');
const caret = (page: Page) => editor(page).evaluate((e: HTMLTextAreaElement) => [e.selectionStart, e.selectionEnd]);
const vis = (page: Page, id: string) => page.locator(`[data-testid="${id}"]:visible`);
const sel = (l: Locator) => l.evaluate((e: HTMLInputElement) => [e.selectionStart, e.selectionEnd]);
const expectSelected = (page: Page, col: number, row: number) => expect(cell(page, col, row)).toHaveAttribute('aria-selected', 'true');

async function openSheet(page: Page, item: string) {
  await page.getByTestId(`nav-item-${item}`).dblclick();
  await expect(sheet(page).getByTestId('data-grid-canvas')).toBeVisible();
  await expect(cell(page, 0, 0)).toBeAttached();
}
/** Clicks a cell and waits until Glide focuses it and the row left is saved. */
async function click(page: Page, col: number, row: number, again = false) {
  // a cell already selected is not focused by a click (kept from before the Backstage): select another one first
  if (!again && (await cell(page, col, row).getAttribute('aria-selected')) === 'true') await click(page, 0, row === 3 ? 2 : 3, true);
  const b = (await sheet(page).getByTestId('data-grid-canvas').boundingBox())!;
  await page.mouse.click(b.x + colLeft(col) + 20, b.y + HEADER + row * 30 + 15);
  await expectSelected(page, col, row);
  await expect(sheet(page).locator('td[role=gridcell]:focus')).toHaveCount(1);
  await expect(sheet(page)).not.toHaveAttribute('aria-busy', 'true');
}
const record = (page: Page) => vis(page, 'nav-record-input');
/** The control `n` of the current record's row. */
async function cur(page: Page, n: string) {
  return page.getByTestId(`form-row-${Number(await record(page).inputValue()) - 1}`).getByTestId(`form-ctl-${n}`);
}
async function openForm(page: Page) {
  await page.getByTestId('nav-item-form-FListe').dblclick();
  await expect(page.getByTestId('doc-tab-form-FListe')).toHaveAttribute('aria-selected', 'true');
  await expect(record(page)).not.toHaveValue('');
}
/** File › Options › Paramètres du client: ticks the radios (and boxes) by test id, then back to the documents. */
async function setClient(page: Page, ...ids: string[]) {
  await page.getByTestId('ribbon-tab-file').click();
  await page.getByTestId('bs-options').click();
  await page.getByTestId('opt-cat-client').click();
  for (const id of ids) await page.getByTestId(`opt-${id}`).check();
  await page.getByTestId('bs-back').click();
}
/** Click into the current record's `n`. */
async function focus(page: Page, n: string) {
  await (await cur(page, n)).click();
  await expect(await cur(page, n)).toBeFocused();
}
/** Focus on `Nom` in navigation mode (reached by the keyboard from Ville). */
async function navNom(page: Page) {
  await focus(page, 'Ville');
  await page.keyboard.press('Shift+Tab');
  await expect(await cur(page, 'Nom')).toBeFocused();
}

test('recette O2: the Enter and arrow settings in a datasheet and a continuous form, the datasheet defaults, ####, and a restart', async () => {
  test.setTimeout(240_000);
  const path = seedBase('recette-o2', (db) => { seedSales(db); db.prepare('UPDATE "Commandes" SET "Montant" = 12345678.9 WHERE "N°" = 1').run(); seedForm(db, 'FListe', FLISTE); });
  const first = await launchApp({ args: [path], env: FR });
  const { userDataDir } = first;
  const page = first.page;
  try {
    // 1. defaults. Datasheet: Enter moves right, then wraps to the next record; ArrowRight on a selected field moves to the next
    await openSheet(page, 'Clients');
    await click(page, 1, 0);
    await page.keyboard.press('Enter');
    await expectSelected(page, 2, 0);
    await page.keyboard.press('Enter');
    await expectSelected(page, 0, 1);
    await page.keyboard.press('ArrowRight');
    await expectSelected(page, 1, 1);
    // continuous form: Nom, Ville, the next row's Nom; ArrowRight on a wholly selected field moves to the next
    await openForm(page);
    await (await cur(page, 'Nom')).click();
    await page.keyboard.press('Enter');
    await expect(await cur(page, 'Ville')).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(record(page)).toHaveValue('2');
    await expect(await cur(page, 'Nom')).toBeFocused();
    await page.keyboard.press('ArrowRight');
    await expect(await cur(page, 'Ville')).toBeFocused();

    // 2. « Enregistrement suivant »: the same field of the next record, in both
    await setClient(page, 'enter-nextRecord');
    await openSheet(page, 'Clients');
    await click(page, 1, 0);
    await page.keyboard.press('Enter');
    await expectSelected(page, 1, 1);
    await openForm(page);
    await focus(page, 'Nom');
    await page.keyboard.press('Enter');
    await expect(record(page)).toHaveValue('3');
    await expect(await cur(page, 'Nom')).toBeFocused();
    // « Aucun effet »: both stay
    await setClient(page, 'enter-none');
    await openSheet(page, 'Clients');
    await click(page, 1, 2);
    await page.keyboard.press('Enter');
    await expectSelected(page, 1, 2);
    await expect(editor(page)).toHaveCount(0);
    await openForm(page);
    await focus(page, 'Nom');
    await page.keyboard.press('Enter');
    await expect(record(page)).toHaveValue('3');
    await expect(await cur(page, 'Nom')).toBeFocused();

    // 3. « Caractère suivant »: the characters, then the next field
    await setClient(page, 'enter-nextField', 'arrows-nextCharacter');
    await openSheet(page, 'Clients');
    await click(page, 1, 0);
    await page.keyboard.press('ArrowRight');
    await expect(editor(page)).toBeFocused();
    expect(await caret(page)).toEqual([6, 6]);
    await page.keyboard.press('ArrowRight');
    await expect(editor(page)).toHaveCount(0);
    await expectSelected(page, 2, 0);
    await openForm(page);
    await navNom(page);
    const nom = await cur(page, 'Nom');
    const len = (await nom.inputValue()).length;
    await page.keyboard.press('ArrowRight');   // the whole text collapses to its end first
    expect(await sel(nom)).toEqual([len, len]);
    await page.keyboard.press('ArrowRight');
    await expect(await cur(page, 'Ville')).toBeFocused();
    // « Arrêt du curseur… »: ArrowRight on the last field stays, in both
    await setClient(page, 'arrows-nextField', 'cursor-stop');
    await openSheet(page, 'Clients');
    await click(page, 2, 0);
    await page.keyboard.press('ArrowRight');
    await expectSelected(page, 2, 0);
    await openForm(page);
    const rec = await record(page).inputValue();
    await focus(page, 'Nom');
    await page.keyboard.press('Tab');
    await expect(await cur(page, 'Ville')).toBeFocused();
    await page.keyboard.press('ArrowRight');
    await expect(await cur(page, 'Ville')).toBeFocused();
    await expect(record(page)).toHaveValue(rec);

    // 4. « Début du champ » / « Fin du champ »: a typed X lands there
    await setClient(page, 'entry-start');
    await openSheet(page, 'Clients');
    await click(page, 1, 0);
    await page.keyboard.press('X');
    await expect(editor(page)).toHaveValue('XDupont');
    await page.keyboard.press('Escape');
    await openForm(page);
    await navNom(page);
    expect(await sel(await cur(page, 'Nom'))).toEqual([0, 0]);
    await page.keyboard.type('X');
    await expect(await cur(page, 'Nom')).toHaveValue(/^X/);
    await page.keyboard.press('Escape');
    await setClient(page, 'entry-end');
    await openSheet(page, 'Clients');
    await click(page, 1, 1);
    await page.keyboard.press('X');
    await expect(editor(page)).toHaveValue('MartinX');
    await page.keyboard.press('Escape');
    await openForm(page);
    await navNom(page);
    await page.keyboard.type('X');
    await expect(await cur(page, 'Nom')).toHaveValue(/X$/);
    await page.keyboard.press('Escape');

    // 5. continuous « Haut/bas »: ArrowDown goes to the next record, the same control; the datasheet's ArrowDown is unchanged
    await setClient(page, 'entry-selectAll', 'cont-upDown');
    await openForm(page);
    const r = Number(await record(page).inputValue());
    await focus(page, 'Nom');
    await page.keyboard.press('ArrowDown');
    await expect(record(page)).toHaveValue(String(r + 1));
    await expect(await cur(page, 'Nom')).toBeFocused();
    await openSheet(page, 'Clients');
    await click(page, 1, 0);
    await page.keyboard.press('ArrowDown');
    await expectSelected(page, 1, 1);

    // 6. datasheet defaults: 4 cm, 16 pt, italique: 151 px columns and 40 px rows in a datasheet opened afterwards
    await page.getByTestId('ribbon-tab-file').click();
    await page.getByTestId('bs-options').click();
    await page.getByTestId('opt-cat-datasheet').click();
    await page.getByTestId('opt-col-width').fill('4');
    await page.getByTestId('opt-col-width').press('Enter');
    await expect(page.getByTestId('opt-col-width')).toHaveValue('4,00 cm');
    await page.getByTestId('opt-font-size').fill('16');
    await page.getByTestId('opt-font-size').press('Enter');
    await page.getByTestId('opt-font-italic').check();
    await page.getByTestId('bs-back').click();
    await openSheet(page, 'Commandes');
    const cv = async () => (await sheet(page).getByTestId('data-grid-canvas').boundingBox())!;
    const clickAt = async (x: number, row: number, col: number) => {
      const b = await cv();
      await page.mouse.click(b.x + x, b.y + HEADER + row * 40 + 20);
      await expectSelected(page, col, row);
    };
    await clickAt(44 + 148, 1, 0);   // the first column ends at 195 px, the second ends at 346: columns are 151 px
    await clickAt(44 + 154, 1, 1);

    // ####: Montant dragged to 40 px shows #; widened, or unticked and reopened, the value
    const dragEdge = async (edge: number, to: number) => {
      const b = await cv();
      await page.mouse.move(b.x + edge - 3, b.y + 15);
      await page.mouse.move(b.x + edge, b.y + 15);
      await page.mouse.down();
      await page.mouse.move(b.x + to, b.y + 15, { steps: 5 });
      await page.mouse.up();
    };
    const shot = async (from: number, to: number) => {
      const b = await cv();
      return page.screenshot({ clip: { x: b.x + from + 1, y: b.y + HEADER + 2, width: to - from - 2, height: 36 } });
    };
    const left = 44 + 151 * 2;
    await dragEdge(left + 151 - 1, left + 40);
    await clickAt(left + 20, 0, 2);
    const hashes = await shot(left, left + 41);
    await dragEdge(left + 41, left + 200);
    expect((await shot(left, left + 41)).equals(hashes)).toBe(false);
    await page.getByTestId('ribbon-tab-file').click();
    await openDbOptions(page);
    await page.getByTestId('opt-db-truncated').uncheck();
    await page.getByTestId('bs-back').click();
    await page.getByTestId('doc-tab-close-Commandes').click();
    await openSheet(page, 'Commandes');
    await dragEdge(left + 151 - 1, left + 40);
    await clickAt(left + 20, 0, 2);
    expect((await shot(left, left + 41)).equals(hashes)).toBe(false);

    // the options this run ends with, for the restart
    await setClient(page, 'enter-nextRecord', 'entry-end', 'arrows-nextCharacter', 'cont-upDown', 'find-general');
  } finally {
    await first.app.close();
  }

  // 7. restart, same profile and base: every option kept
  const again = await launchApp({ args: [path], env: FR, userDataDir });
  try {
    const p = again.page;
    await p.getByTestId('ribbon-tab-file').click();
    await openDbOptions(p);
    await expect(p.getByTestId('opt-db-truncated')).not.toBeChecked();
    await p.getByTestId('opt-cat-client').click();
    for (const id of ['enter-nextRecord', 'entry-end', 'arrows-nextCharacter', 'cont-upDown', 'find-general']) await expect(p.getByTestId(`opt-${id}`)).toBeChecked();
    await expect(p.getByTestId('opt-cursor-stop')).toBeChecked();
    await p.getByTestId('opt-cat-datasheet').click();
    await expect(p.getByTestId('opt-col-width')).toHaveValue('4,00 cm');
    await expect(p.getByTestId('opt-font-size')).toHaveValue('16');
    await expect(p.getByTestId('opt-font-italic')).toBeChecked();
  } finally {
    await again.app.close();
  }
});
