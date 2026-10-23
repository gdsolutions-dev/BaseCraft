// Affichages d'un formulaire (A4, tâche 10) : formulaire continu virtualisé (100 000 lignes), feuille de données du
// formulaire, affichage par défaut à l'ouverture et boutons d'affichage de la barre d'état (M10).
import { test, expect, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createTable } from '../../src/main/db/schema';
import type { BasecraftApi } from '../../src/shared/api';
import type { ControlDef, DesignDoc } from '../../src/shared/design/model';
import { f, t } from '../../src/shared/test-fixtures';
import { launchApp, seedBase, seedForm } from './helpers';

const fr = JSON.parse(readFileSync(join(__dirname, '../../src/shared/i18n/fr.json'), 'utf8'));
const fill = (s: string, p: Record<string, string | number>) => s.replace(/\{\{(\w+)\}\}/g, (_, k: string) => String(p[k]));
const FR = { BASECRAFT_REGION: 'fr-FR' };
const personnes = t('Personnes', [f('N°', 'autoNumber'), f('Nom', 'shortText')]);
const contacts = t('Contacts', [f('N°', 'autoNumber'), f('Nom', 'shortText'),
  f('Ville', 'shortText', { validationRule: '<> "Zzz"', validationText: 'Ville interdite' }), f('Référent', 'number', { numberSize: 'longInteger' }),
  f('Actif', 'yesNo')]);
const at = (kind: ControlDef['kind'], name: string, left: number, width: number, props: Record<string, unknown>, label?: string): ControlDef => ({
  kind, name, left, top: 100, width, height: 340, props,
  ...(label ? { children: [{ kind: 'label', name: `${name}_Étiquette`, left: left - 1100, top: 100, width: 1050, height: 340, props: { Caption: label } }] } : {}),
});
// A tabular layout: N°, Nom, Ville (its own Default Value), Référent (a combo box on Personnes, its N° hidden), Actif, Note
// (unbound), then a calculated control. In tab order, as the datasheet's columns.
const detail: ControlDef[] = [
  at('textBox', 'N°', 100, 900, { ControlSource: 'N°', TabIndex: 0 }),
  at('textBox', 'Nom', 2200, 1800, { ControlSource: 'Nom', TabIndex: 1 }, 'Nom du contact :'),
  at('textBox', 'Ville', 5100, 1500, { ControlSource: 'Ville', TabIndex: 2, DefaultValue: '"Paris"' }, 'Ville:'),
  at('comboBox', 'Référent', 7700, 2000, { ControlSource: 'Référent', TabIndex: 3, RowSourceType: 'tableQuery', RowSource: 'Personnes', BoundColumn: 1, ColumnCount: 2, ColumnWidths: '0;1417' }, 'Référent'),
  at('checkBox', 'Actif', 10900, 900, { ControlSource: 'Actif', TabIndex: 4 }, 'Actif'),
  at('textBox', 'Note', 11900, 1500, { TabIndex: 5 }),
  at('textBox', 'Salut', 13500, 1800, { ControlSource: '=[Nom] & "!"', TabStop: false }),
];
const formOn = (props: Record<string, unknown>): DesignDoc => ({
  formatVersion: '1.0', recordSource: { kind: 'table', name: 'Contacts' }, props: { Width: 15500, ...props },
  sections: [
    { kind: 'formHeader', height: 500, props: {}, controls: [{ kind: 'label', name: 'Titre', left: 100, top: 50, width: 3000, height: 400, props: { Caption: 'Contacts' } }] },
    { kind: 'detail', height: 600, props: {}, controls: detail },
    { kind: 'formFooter', height: 0, props: { Visible: false }, controls: [] },
  ],
});
const TITLES = ['N°', 'Nom du contact', 'Ville', 'Référent', 'Actif', 'Note', 'Salut'];

/** A base with Personnes (Dupont, Martin), n contacts « Client i » in Lyon, and the forms Contacts (Continuous Forms), Fiche
 *  (Single Form) and Feuille (Datasheet). */
const baseWith = (n: number) => seedBase(`fx-affichages-${n}`, (db) => {
  createTable(db, personnes);
  createTable(db, contacts);
  db.exec(`INSERT INTO "Personnes"("Nom") VALUES ('Dupont'), ('Martin')`);
  db.exec(`WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < ${n})
    INSERT INTO "Contacts"("Nom", "Ville", "Référent", "Actif") SELECT 'Client ' || i, 'Lyon', 1, 0 FROM n`);
  seedForm(db, 'Contacts', formOn({ DefaultView: 'continuous' }));
  seedForm(db, 'Fiche', formOn({}));
  seedForm(db, 'Feuille', formOn({ DefaultView: 'datasheet' }));
});

// every open tab keeps its view (hidden): the shown one
const shown = (page: Page, id: string) => page.locator(`[data-testid="${id}"]:visible`);
const pressed = (page: Page, v: string) => page.getByTestId(`status-view-${v}`);
const rowAt = (page: Page, i: number) => page.evaluate((k) => (window as unknown as { basecraft: BasecraftApi }).basecraft.rows.page('Contacts', { offset: k, limit: 1 })
  .then((p) => p.rows[0]?.values), i);

// The form's datasheet: Glide's accessible cells (the canvas is drawn), clicked where the columns are: the row selector, the
// header and row heights of the grid; each column as wide as its control (twips / 15 px).
const MARKER = 44, HEADER = 34, ROW = 30;
const WIDTHS = detail.map((c) => c.width / 15);   // the controls in tab order: the datasheet's columns
const LEFTS = WIDTHS.map((_, i) => WIDTHS.slice(0, i).reduce((a, b) => a + b, 0));
const cell = (page: Page, col: number, row: number) => shown(page, 'form-datasheet').getByTestId(`glide-cell-${col + 1}-${row}`);
async function clickAt(page: Page, x: number, row: number) {
  const b = (await shown(page, 'form-datasheet').getByTestId('data-grid-canvas').boundingBox())!;
  await page.mouse.click(b.x + x, b.y + HEADER + row * ROW + ROW / 2);
}
async function clickCell(page: Page, col: number, row: number) {
  await clickAt(page, MARKER + LEFTS[col]! + 20, row);
  await expect(cell(page, col, row)).toBeFocused();
}
/** Types in the selected cell: the first key opens Glide's editor (it must be open before the rest comes). */
async function typeInCell(page: Page, text: string) {
  await page.keyboard.press(text[0]!);
  await expect(page.locator('#portal textarea')).toBeFocused();
  await page.keyboard.type(text.slice(1));
}

test('Continuous Forms over 100 000 rows: virtualised rows, values and calculations per row, row changes saved or refused, keys', async () => {
  const N = 100_000;
  const { app, page } = await launchApp({ args: [baseWith(N)], env: FR });
  try {
    const row = (i: number) => page.getByTestId(`form-row-${i}`);
    const ctl = (i: number, n: string) => row(i).getByTestId(`form-ctl-${n}`);
    const rows = page.getByTestId('form-rows');
    const inView = async (i: number) => {
      const [r, v] = await Promise.all([row(i).boundingBox(), rows.boundingBox()]);
      return !!r && !!v && r.y >= v.y - 1 && r.y + r.height <= v.y + v.height + 1;
    };
    await page.getByTestId('nav-item-form-Contacts').dblclick();
    await page.getByTestId('ribbon-tab-home').click();

    // the Detail once per record, the header once; each row its own values, list text and calculation
    await expect(ctl(0, 'Nom')).toHaveValue('Client 1');
    await expect(ctl(1, 'Nom')).toHaveValue('Client 2');
    await expect(ctl(1, 'Salut')).toHaveValue('Client 2!');
    await expect(ctl(1, 'Référent')).toHaveValue('Dupont');
    await expect(row(0)).toHaveAttribute('data-current', 'true');
    await expect(page.getByTestId('form-section-formHeader')).toHaveCount(1);
    await expect(pressed(page, 'form')).toHaveAttribute('aria-pressed', 'true');
    await expect(pressed(page, 'datasheet')).toHaveAttribute('aria-pressed', 'false');

    // scrolled to the end, the current record far above: the last records and the new record (its default values and its
    // calculation), only the visible rows in the DOM, and the current row kept there
    await rows.evaluate((e) => { e.scrollTop = e.scrollHeight; });
    await expect(ctl(N - 1, 'Nom')).toHaveValue(`Client ${N}`);
    await expect(ctl(N, 'Ville')).toHaveValue('Paris');
    await expect(ctl(N, 'Salut')).toHaveValue('!');
    await expect(row(0)).toHaveAttribute('data-current', 'true');
    expect(await page.locator('[data-testid^="form-row-"]').count()).toBeLessThan(60);
    await rows.evaluate((e) => { e.scrollTop = 0; });

    // Last: the last record current and scrolled to; Ctrl+Home: the first record, its first field; Ctrl+End: the last
    // record, its last field
    await page.getByTestId('form-run').getByRole('button', { name: fr.datasheet.nav.last }).click();
    await expect(row(N - 1)).toHaveAttribute('data-current', 'true');
    await expect.poll(() => inView(N - 1)).toBe(true);
    await ctl(N - 1, 'Nom').focus();
    await page.keyboard.press('Control+Home');
    await expect(row(0)).toHaveAttribute('data-current', 'true');
    await expect(ctl(0, 'N°')).toBeFocused();
    await expect.poll(() => inView(0)).toBe(true);
    await page.keyboard.press('Control+End');
    await expect(row(N - 1)).toHaveAttribute('data-current', 'true');
    await expect(ctl(N - 1, 'Note')).toBeFocused();
    await page.keyboard.press('Control+Home');
    await expect(ctl(0, 'N°')).toBeFocused();

    // a row changed, then another row clicked: saved, that row current
    await ctl(2, 'Nom').click();
    await expect(row(2)).toHaveAttribute('data-current', 'true');
    await ctl(2, 'Nom').fill('Modifié');
    await expect(row(2).getByTestId('form-dirty')).toBeVisible();
    await ctl(4, 'Ville').click();
    await expect(row(4)).toHaveAttribute('data-current', 'true');
    await expect(ctl(4, 'Ville')).toBeFocused();
    await expect.poll(() => rowAt(page, 2)).toEqual([3, 'Modifié', 'Lyon', 1, 0]);
    await expect(ctl(2, 'Salut')).toHaveValue('Modifié!');

    // a row that cannot be saved: the message box, then the focus back on the current row, which stays current
    await ctl(4, 'Ville').fill('Zzz');
    await ctl(6, 'Nom').click();
    await expect(page.getByTestId('modal')).toContainText('Ville interdite');
    await page.getByTestId('modal-btn-ok').click();
    await expect(ctl(4, 'Ville')).toBeFocused();
    await expect(row(4)).toHaveAttribute('data-current', 'true');
    await expect(ctl(6, 'Nom')).toHaveAttribute('readonly', '');
    await page.keyboard.press('Escape');
    await expect(ctl(4, 'Ville')).toHaveValue('Lyon');

    // Page Down / Page Up: the next or previous record, the focus kept in the same control, on that row
    await page.keyboard.press('PageDown');
    await expect(row(5)).toHaveAttribute('data-current', 'true');
    await expect(ctl(5, 'Ville')).toBeFocused();
    await page.keyboard.press('PageUp');
    await expect(row(4)).toHaveAttribute('data-current', 'true');
    await expect(ctl(4, 'Ville')).toBeFocused();

    // a click anywhere on another row moves to it: its background, its read-only check box (not ticked by that click)
    await row(7).click({ position: { x: 30, y: 2 } });
    await expect(row(7)).toHaveAttribute('data-current', 'true');
    await ctl(8, 'Actif').click();
    await expect(row(8)).toHaveAttribute('data-current', 'true');
    await expect(ctl(8, 'Actif')).not.toBeChecked();

    // an unbound control shows the form's value on every row (Access)
    await ctl(8, 'Note').fill('Bonjour');
    await expect(ctl(3, 'Note')).toHaveValue('Bonjour');
    await expect(ctl(9, 'Note')).toHaveValue('Bonjour');
  } finally {
    await app.close();
  }
});

test("a form's datasheet: titles and texts, entry saved on a row change, Ctrl+S and Shift+F9 with the editor open, refused switch, list editor, delete", async () => {
  const { app, page } = await launchApp({ args: [baseWith(20)], env: FR });
  try {
    await page.getByTestId('nav-item-form-Contacts').dblclick();
    await page.getByTestId('ribbon-tab-home').click();
    await page.getByTestId('form-row-4').getByTestId('form-ctl-Ville').click();   // the 5th record current
    await page.getByTestId('cmd-viewDatasheet').click();
    const sheet = shown(page, 'form-datasheet');
    const record = page.getByTestId('nav-record-input');

    // the same records and values, the labels' captions as titles, the current record and control kept
    await expect(sheet.locator('th[role=columnheader]')).toHaveText(TITLES);
    await expect(cell(page, 1, 2)).toHaveText('Client 3');
    await expect(cell(page, 3, 0)).toHaveText('Dupont');
    await expect(cell(page, 6, 1)).toHaveText('Client 2!');
    const scroller = sheet.locator('.dvn-scroller');
    await scroller.evaluate((e) => { e.scrollTop = e.scrollHeight; });
    await expect(cell(page, 2, 20)).toHaveText('Paris');   // the new record: its default value
    await scroller.evaluate((e) => { e.scrollTop = 0; });
    await expect(record).toHaveValue('5');
    await expect(cell(page, 2, 4)).toBeFocused();
    await expect(pressed(page, 'datasheet')).toHaveAttribute('aria-pressed', 'true');
    await expect(pressed(page, 'form')).toHaveAttribute('aria-pressed', 'false');
    await expect(page.getByTestId('cmd-viewDatasheet')).toHaveAttribute('aria-pressed', 'true');

    // an entry, then Down: the next row, the record left saved
    await clickCell(page, 1, 2);
    await expect(record).toHaveValue('3');
    await typeInCell(page, 'Xyz');
    await page.keyboard.press('Tab');
    await expect(shown(page, 'grid-pencil')).toBeVisible();   // the modified record's selector
    await page.keyboard.press('ArrowDown');
    await expect(record).toHaveValue('4');
    await expect.poll(() => rowAt(page, 2)).toEqual([3, 'Xyz', 'Lyon', 1, 0]);
    await expect(shown(page, 'grid-pencil')).toHaveCount(0);

    // Ctrl+S and Shift+F9 while the cell editor is open: the text typed saved, on its record
    await clickCell(page, 1, 3);
    await typeInCell(page, 'Qrs');
    await page.keyboard.press('Control+s');
    await expect.poll(() => rowAt(page, 3)).toEqual([4, 'Qrs', 'Lyon', 1, 0]);
    await expect(record).toHaveValue('4');
    await clickCell(page, 1, 5);
    await typeInCell(page, 'Tuv');
    await page.keyboard.press('Shift+F9');
    await expect.poll(() => rowAt(page, 5)).toEqual([6, 'Tuv', 'Lyon', 1, 0]);
    await expect(record).toHaveValue('1');   // Requery: back on the first record

    // an invalid entry: Form view refused (the message box, then No: stays in Datasheet view); Esc Esc, then Form view
    await clickCell(page, 2, 4);
    await typeInCell(page, 'Zzz');
    await page.keyboard.press('Tab');   // the next field, on the same record
    await expect(cell(page, 2, 4)).toHaveText('Zzz');
    await page.getByTestId('cmd-viewForm').click();
    await expect(page.getByTestId('modal')).toContainText('Ville interdite');
    await page.getByTestId('modal-btn-ok').click();
    await expect(page.getByTestId('modal')).toContainText(fill(fr.datasheet.discard, { name: 'Contacts' }));
    await page.getByTestId('modal-btn-no').click();
    await expect(sheet).toBeVisible();
    await expect(page.getByTestId('form-datasheet-error')).toContainText('Ville interdite');
    await expect(cell(page, 2, 4)).toBeFocused();   // back on the cell in error
    await page.keyboard.press('Escape');
    await page.keyboard.press('Escape');
    await expect(cell(page, 2, 4)).toHaveText('Lyon');
    await page.getByTestId('cmd-viewForm').click();
    await expect(page.getByTestId('form-rows')).toBeVisible();
    await expect(pressed(page, 'form')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByTestId('form-row-4')).toHaveAttribute('data-current', 'true');
    expect(await rowAt(page, 4)).toEqual([5, 'Client 5', 'Lyon', 1, 0]);

    // a combo box: the list editor, Martin chosen, saved on leaving the row
    await pressed(page, 'datasheet').click();
    await expect(cell(page, 2, 4)).toBeFocused();   // the control last focused (Ville, the refusal's)
    await clickCell(page, 3, 4);
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('lookup-editor')).toHaveValue('Dupont');
    await page.getByTestId('lookup-list').getByRole('option', { name: 'Martin' }).click();
    await expect(cell(page, 3, 4)).toHaveText('Martin');
    await clickCell(page, 1, 6);
    await expect.poll(() => rowAt(page, 4)).toEqual([5, 'Client 5', 'Lyon', 2, 0]);

    // a whole row selected (its selector), then Delete: the form's deletion (confirmed), the next record current
    await clickAt(page, MARKER / 2, 7);
    await expect(record).toHaveValue('8');
    await page.keyboard.press('Delete');
    await expect(page.getByTestId('modal')).toBeVisible();
    await page.getByTestId('modal-btn-yes').click();
    await expect.poll(() => rowAt(page, 7)).toEqual([9, 'Client 9', 'Lyon', 1, 0]);
    await expect(page.getByTestId('nav-record-count')).toHaveText('19');
    await expect(cell(page, 1, 7)).toHaveText('Client 9');

    // a column widened by dragging its header's edge: the next column starts further right
    await page.waitForTimeout(600);   // Glide takes a mouse-up within 500 ms of the last one for a double click (column auto-size)
    const b = (await sheet.getByTestId('data-grid-canvas').boundingBox())!;
    await page.mouse.move(b.x + MARKER + WIDTHS[0]! - 2, b.y + HEADER / 2);
    await page.mouse.down();
    await page.mouse.move(b.x + MARKER + WIDTHS[0]! + 60, b.y + HEADER / 2, { steps: 5 });
    await page.mouse.up();
    await clickAt(page, MARKER + LEFTS[1]! + 20, 2);
    await expect(cell(page, 0, 2)).toBeFocused();   // where Nom began: now still N°
  } finally {
    await app.close();
  }
});

test('opening views and the status bar: Default View at opening, Design to Datasheet or Form view, a table', async () => {
  const { app, page } = await launchApp({ args: [baseWith(3)], env: FR });
  try {
    // from Design view, Datasheet view at once (its Default View is Single Form); Form view: Single Form
    await page.getByTestId('nav-item-form-Fiche').click({ button: 'right' });
    await page.getByTestId('nav-menu-design').click();
    await expect(shown(page, 'form-design')).toBeVisible();
    await expect(pressed(page, 'form')).toHaveAttribute('aria-pressed', 'false');
    await expect(pressed(page, 'design')).toHaveAttribute('aria-pressed', 'true');
    await page.getByTestId('cmd-viewDatasheet').click();
    await expect(shown(page, 'form-datasheet')).toBeVisible();
    await page.getByTestId('cmd-viewForm').click();
    await expect(shown(page, 'form-selector')).toBeVisible();
    await expect(shown(page, 'form-rows')).toHaveCount(0);

    // Default View Datasheet, opened from the Navigation Pane: Datasheet view; Design, then Form view: Single Form
    await page.getByTestId('nav-item-form-Feuille').dblclick();
    await expect(page.getByTestId('doc-tab-form-Feuille')).toHaveAttribute('aria-selected', 'true');
    await expect(shown(page, 'form-datasheet')).toBeVisible();
    await expect(cell(page, 1, 0)).toHaveText('Client 1');
    await expect(pressed(page, 'datasheet')).toHaveAttribute('aria-pressed', 'true');
    await expect(pressed(page, 'form')).toHaveAttribute('aria-pressed', 'false');
    await pressed(page, 'design').click();
    await expect(shown(page, 'form-design')).toBeVisible();
    await page.getByTestId('cmd-viewForm').click();
    await expect(shown(page, 'form-selector')).toBeVisible();

    // a table's datasheet: its Datasheet button pressed, no Form view button
    await page.getByTestId('nav-item-Personnes').dblclick();
    await expect(shown(page, 'datasheet')).toBeVisible();
    await expect(pressed(page, 'datasheet')).toHaveAttribute('aria-pressed', 'true');
    await expect(pressed(page, 'form')).toHaveCount(0);
  } finally {
    await app.close();
  }
});
