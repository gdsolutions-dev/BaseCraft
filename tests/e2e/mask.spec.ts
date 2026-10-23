import { test, expect, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createTable } from '../../src/main/db/schema';
import { f, t } from '../../src/shared/test-fixtures';
import { launchApp, seedBase } from './helpers';

const fr = JSON.parse(readFileSync(join(__dirname, '../../src/shared/i18n/fr.json'), 'utf8'));
const FR = { BASECRAFT_REGION: 'fr-FR' };
const contacts = t('Contacts', [f('N°', 'autoNumber'), f('Tel', 'shortText'), f('Code', 'shortText', { inputMask: '>L<LL', format: '>' }), f('Lot', 'shortText', { inputMask: '99-00' })]);
// DatasheetView: row selector width, header and row heights, AutoNumber and short text column widths.
const MARKER = 44, HEADER = 34, ROW = 30, AUTONUMBER = 80, TEXT = 170;

const cell = (page: Page, col: number, row: number) => page.getByTestId(`glide-cell-${col + 1}-${row}`);
const editor = (page: Page) => page.getByTestId('masked-editor');
const rowsOf = async (page: Page) =>
  (await page.evaluate(() => (window as any).basecraft.rows.page('Contacts', { offset: 0, limit: 100 }))).rows as { values: unknown[] }[];
async function clickCell(page: Page, col: number, row: number) {
  const b = (await page.getByTestId('datasheet').getByTestId('data-grid-canvas').boundingBox())!;
  await page.mouse.click(b.x + MARKER + AUTONUMBER + (col - 1) * TEXT + 30, b.y + HEADER + row * ROW + ROW / 2);
}
async function closeEditor(page: Page, key: 'Enter' | 'Tab') {
  await page.keyboard.press(key);
  await expect(editor(page)).toHaveCount(0);
  await expect(page.getByTestId('datasheet')).not.toHaveAttribute('aria-busy', 'true');
}
/** One non-ASCII key, as a keyboard sends it (Playwright's press only knows the US layout); `dead`: after a dead key. */
async function pressChar(page: Page, ch: string, dead = false) {
  const cdp = await page.context().newCDPSession(page);
  if (dead) await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Dead' });
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: ch, text: ch, unmodifiedText: ch });
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: ch });
  await cdp.detach();
}

test('input mask: designer, masked editor, refused entry, case and accents', async () => {
  const base = seedBase('masque', (db) => createTable(db, contacts));
  const { app, page } = await launchApp({ args: [base], env: FR });
  try {
    await page.getByTestId('nav-item-Contacts').click({ button: 'right' });
    await page.getByTestId('nav-menu-design').click();
    await page.getByTestId('design-row-1-name').click();

    // an unreadable mask stays as typed, with its error; the save refuses it
    await page.getByTestId('prop-inputMask').fill('"00');
    await page.getByTestId('prop-inputMask').press('Tab');
    await expect(page.getByTestId('prop-inputMask-error')).toHaveText(fr.expr.error.maskUnclosedQuote);
    await page.keyboard.press('Control+s');
    await expect(page.getByTestId('modal')).toContainText(fr.designer.invalidExpressions.split('\n')[0]);
    await page.getByTestId('modal-btn-ok').click();
    await page.getByTestId('prop-inputMask').fill('00\\ 00\\ 00\\ 00\\ 00;0;_');
    await page.getByTestId('prop-inputMask').press('Tab');
    await expect(page.getByTestId('prop-inputMask-error')).toHaveCount(0);
    await page.keyboard.press('Control+s');
    await expect(page.getByTestId('doc-tab-Contacts')).not.toContainText('•');

    // the slots show the placeholder; the literals are typed for the user; stored with them (;0)
    await page.getByTestId('status-view-datasheet').click();
    await clickCell(page, 1, 0);
    await expect(editor(page)).toBeFocused();
    await expect(editor(page)).toHaveValue('__ __ __ __ __');
    await page.keyboard.type('06a 12-345678'); // « a » and « - » refused; the space is the literal already passed
    await expect(editor(page)).toHaveValue('06 12 34 56 78');
    await closeEditor(page, 'Enter');
    await expect(page.getByTestId('nav-record-count')).toHaveText('1');
    await expect(cell(page, 1, 0)).toHaveText('06 12 34 56 78');
    expect((await rowsOf(page)).map((r) => r.values)).toEqual([[1, '06 12 34 56 78', null, null]]);

    // an incomplete entry: the row is refused with the mask's message
    await clickCell(page, 1, 1);
    await expect(editor(page)).toBeFocused();
    await page.keyboard.type('0612');
    await expect(editor(page)).toHaveValue('06 12 __ __ __');
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('modal')).toContainText(fr.fieldError.mask);
    await page.getByTestId('modal-btn-ok').click();
    await expect(page.getByTestId('datasheet-error')).toContainText(fr.fieldError.mask);
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('datasheet-error')).toHaveCount(0);

    // >L<LL with the format > (Access: the mask edits, the format displays): an accented first key opens the editor (glide-keyboard), a dead key types in it, upper then lower case, a digit refused
    await clickCell(page, 2, 0);
    await expect(cell(page, 2, 0)).toBeFocused(); // Glide focuses the cell after a render
    await pressChar(page, 'é');
    await expect(editor(page)).toBeFocused();
    await pressChar(page, 'ê', true);
    await page.keyboard.type('1X');
    await expect(editor(page)).toHaveValue('Éêx');
    await closeEditor(page, 'Enter');
    await expect(cell(page, 2, 0)).toHaveText('Éêx'); // Glide's accessible copy is the edit text (the display is unit-tested)
    await expect.poll(async () => (await rowsOf(page)).map((r) => r.values)).toEqual([[1, '06 12 34 56 78', 'Éêx', null]]);

    // 99-00 (literals not stored): « - » skips the empty optional slot, stored as a space (A2-R11); it reads back in place
    await clickCell(page, 3, 0);
    await expect(cell(page, 3, 0)).toBeFocused();
    await page.keyboard.press('1');
    await expect(editor(page)).toBeFocused();
    await page.keyboard.type('-23');
    await expect(editor(page)).toHaveValue('1_-23');
    await closeEditor(page, 'Enter');
    await expect(cell(page, 3, 0)).toHaveText('1 23');
    await expect.poll(async () => (await rowsOf(page)).map((r) => r.values[3])).toEqual(['1 23']);
    await page.keyboard.press('ArrowUp'); // Enter moved down to the new record's row
    await expect(cell(page, 3, 0)).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(editor(page)).toHaveValue('1 -23');
    await page.keyboard.press('Escape');

    // editing a stored value opens the editor prefilled; Backspace clears the slot before the caret
    await clickCell(page, 1, 0);
    await expect(cell(page, 1, 0)).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(editor(page)).toBeFocused();
    await expect(editor(page)).toHaveValue('06 12 34 56 78');
    await page.keyboard.press('Backspace');
    await page.keyboard.type('9');
    await closeEditor(page, 'Enter');
    await expect(cell(page, 1, 0)).toHaveText('06 12 34 56 79');
  } finally {
    await app.close();
  }
});
