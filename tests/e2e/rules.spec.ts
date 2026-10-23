import { test, expect, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createTable } from '../../src/main/db/schema';
import { insertRow } from '../../src/main/db/write-layer';
import { localeInfo } from '../../src/shared/locale-format';
import { f, t } from '../../src/shared/test-fixtures';
import { launchApp, seedBase } from './helpers';

const fr = JSON.parse(readFileSync(join(__dirname, '../../src/shared/i18n/fr.json'), 'utf8'));
const FR = { BASECRAFT_REGION: 'fr-FR' };
const stock = t('Stock', [f('N°', 'autoNumber'), f('Article', 'shortText'), f('Qté', 'number')]);
// DatasheetView: row selector width, header and row heights, AutoNumber column width.
const MARKER = 44, HEADER = 34, ROW = 30, AUTONUMBER = 80;

const cell = (page: Page, col: number, row: number) => page.getByTestId(`glide-cell-${col + 1}-${row}`);
const cellEditor = (page: Page) => page.getByTestId('grid-editor-portal').locator('textarea');
const rowsOf = async (page: Page) =>
  (await page.evaluate(() => (window as any).basecraft.rows.page('Stock', { offset: 0, limit: 100 }))).rows as { values: unknown[] }[];

/** Clicks the trailing row's Article cell: a new record starts and its editor opens. */
async function newRecordAt(page: Page, row: number) {
  const b = (await page.getByTestId('datasheet').getByTestId('data-grid-canvas').boundingBox())!;
  await page.mouse.click(b.x + MARKER + AUTONUMBER + 30, b.y + HEADER + row * ROW + ROW / 2);
  await expect(cellEditor(page)).toBeFocused();
}
async function closeEditor(page: Page, key: 'Enter' | 'Tab') {
  await page.keyboard.press(key);
  await expect(cellEditor(page)).toHaveCount(0);
  await expect(page.getByTestId('datasheet')).not.toHaveAttribute('aria-busy', 'true');
}

test('default value, validation rule and message: designer, datasheet, other language', async () => {
  const base = seedBase('regles', (db) => createTable(db, stock));
  const { app, page } = await launchApp({ args: [base], env: FR });
  try {
    await page.getByTestId('nav-item-Stock').click({ button: 'right' });
    await page.getByTestId('nav-menu-design').click();
    await page.getByTestId('design-row-2-name').click();

    // an unreadable expression stays as typed, with its error; the save refuses it
    await page.getByTestId('prop-validationRule').fill('> 1 +');
    await page.getByTestId('prop-validationRule').press('Tab');
    await expect(page.getByTestId('prop-validationRule')).toHaveValue('> 1 +');
    await expect(page.getByTestId('prop-validationRule-error')).toHaveText(fr.expr.error.unexpectedEnd);
    await page.keyboard.press('Control+s');
    await expect(page.getByTestId('modal')).toContainText(fr.designer.invalidExpressions.split('\n')[0]);
    await page.getByTestId('modal-btn-ok').click();

    await page.getByTestId('prop-defaultValue').fill('1');
    await page.getByTestId('prop-validationRule').fill('>0');
    await page.getByTestId('prop-validationText').fill('Quantité positive'); // leaving the rule commits it
    await expect(page.getByTestId('prop-validationRule-error')).toHaveCount(0);
    await page.keyboard.press('Control+s');
    await expect(page.getByTestId('doc-tab-Stock')).not.toContainText('•');
    await expect(page.getByTestId('prop-validationRule')).toHaveValue('> 0');

    // the new record's row shows the default; a value breaking the rule shows its message
    await page.getByTestId('status-view-datasheet').click();
    await newRecordAt(page, 0);
    await expect(cell(page, 2, 0)).toHaveText('1');
    await page.keyboard.type('Vis');
    await closeEditor(page, 'Tab');
    await page.keyboard.press('-');
    await expect(cellEditor(page)).toBeFocused();
    await page.keyboard.type('3');
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('modal')).toContainText('« Qté » : Quantité positive');
    await page.getByTestId('modal-btn-ok').click();
    await expect(page.getByTestId('datasheet-error')).toHaveText('« Qté » : Quantité positive');
    await page.keyboard.press('Escape');
    await newRecordAt(page, 0);
    await page.keyboard.type('Ecrou');
    await closeEditor(page, 'Enter');
    await expect(page.getByTestId('nav-record-count')).toHaveText('1');
    expect((await rowsOf(page)).map((r) => r.values)).toEqual([[1, 'Ecrou', 1]]);

    // a stricter rule broken by the existing row: the designer asks; Yes saves it
    await page.getByTestId('status-view-design').click();
    await page.getByTestId('design-row-2-name').click();
    await page.getByTestId('prop-validationRule').fill('>5');
    await page.keyboard.press('Control+s');
    await expect(page.getByTestId('modal')).toContainText(fr.designer.validationExisting_one.replace('{{count}}', '1'));
    await page.getByTestId('modal-btn-yes').click();
    await expect(page.getByTestId('doc-tab-Stock')).not.toContainText('•');
    expect((await rowsOf(page)).map((r) => r.values)).toEqual([[1, 'Ecrou', 1]]);

    // English interface: the same expressions, in its words (the region stays fr-FR)
    await page.getByTestId('prop-validationRule').fill('>0 Et Pas Null');
    await page.keyboard.press('Control+s');
    await expect(page.getByTestId('doc-tab-Stock')).not.toContainText('•');
    await page.getByTestId('ribbon-tab-file').click();
    await page.getByTestId('bs-options').click();
    await page.getByTestId('opt-lang').selectOption('en');
    await page.getByTestId('bs-back').click();
    await page.getByTestId('design-row-2-name').click();
    await expect(page.getByTestId('prop-validationRule')).toHaveValue('> 0 And Is Not Null');
    await expect(page.getByTestId('prop-defaultValue')).toHaveValue('1');
    await expect(page.getByTestId('prop-validationText')).toHaveValue('Quantité positive');
  } finally {
    await app.close();
  }
});

test('expression builder: the rule of Qté built from the lists, a refusal with its faulty part selected; Test Validation Rules', async () => {
  const base = await seedBase('generateur', async (db) => {
    createTable(db, stock);
    await insertRow(db, stock, { Article: 'Vis', Qté: -2 }, localeInfo('fr-FR')); // breaks the rule built below
  });
  const { app, page } = await launchApp({ args: [base], env: FR });
  const text = page.getByTestId('xb-text');
  const selected = () => text.evaluate((el: HTMLTextAreaElement) => el.value.slice(el.selectionStart, el.selectionEnd));
  try {
    await page.getByTestId('nav-item-Stock').click({ button: 'right' });
    await page.getByTestId('nav-menu-design').click();
    await page.getByTestId('design-row-2-name').click();
    await page.getByTestId('prop-validationRule-build').click();
    await expect(text).toBeFocused();

    // an incomplete expression: OK refuses it with its message, the dangling part selected
    await text.fill('> 1 +');
    await page.getByTestId('xb-ok').click();
    await expect(page.getByTestId('xb-error')).toHaveText(fr.expr.error.unexpectedEnd);
    expect(await selected()).toBe('+');

    // a function: its description, then Enter inserts it with its first placeholder selected
    await text.fill('');
    await page.getByTestId('xb-cat-logic').click();
    await page.getByTestId('xb-val-VraiFaux').click();
    await expect(page.getByTestId('xb-desc')).toContainText(fr.expr.fn.IIf);
    await page.keyboard.press('Enter');
    await expect(text).toHaveValue('VraiFaux(«expr»; «vrai»; «faux»)');
    expect(await selected()).toBe('«expr»');
    await page.getByTestId('xb-ok').click(); // a placeholder left: refused, selected
    await expect(page.getByTestId('xb-error')).toHaveText(fr.expr.error.unexpectedToken);
    expect(await selected()).toBe('«expr»');

    // Fields › Qté, the operator >, then 0 typed: its own field, named explicitly, is allowed
    await text.fill('');
    await page.getByTestId('xb-el-fields').click();
    await page.getByTestId('xb-val-Qté').dblclick();
    await page.getByTestId('xb-el-operators').click();
    await page.getByTestId('xb-val->').dblclick();
    await page.keyboard.type('0');
    await expect(text).toHaveValue('[Qté] >0');
    await page.getByTestId('xb-ok').click();
    await expect(page.getByTestId('modal')).toHaveCount(0);
    await expect(page.getByTestId('prop-validationRule')).toHaveValue('[Qté] > 0');

    // Escape cancels: the rule stays
    await page.getByTestId('prop-validationRule-build').click();
    await page.getByTestId('xb-text').fill('> 5');
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('modal')).toHaveCount(0);
    await expect(page.getByTestId('prop-validationRule')).toHaveValue('[Qté] > 0');
    await expect(page.getByTestId('prop-validationRule-build')).toBeFocused(); // back where it was opened

    // saved (the existing row breaks it: Yes), then Test Validation Rules names the field and the count
    await page.keyboard.press('Control+s');
    await expect(page.getByTestId('modal')).toContainText(fr.designer.validationExisting_one.replace('{{count}}', '1'));
    await page.getByTestId('modal-btn-yes').click();
    await expect(page.getByTestId('doc-tab-Stock')).not.toContainText('•');
    await page.getByTestId('ribbon-tab-design').click();
    await page.getByTestId('cmd-testValidationRules').click();
    await expect(page.getByTestId('modal')).toContainText(fr.designer.testRulesField_one.replace('{{field}}', 'Qté').replace('{{count}}', '1'));
    await page.getByTestId('modal-btn-ok').click();

    // the Builder command opens it on the rule
    await page.getByTestId('cmd-builder').click();
    await expect(page.getByTestId('xb-text')).toHaveValue('[Qté] > 0');
    await page.getByTestId('xb-cancel').click();

    // the rule blocks -1 in the datasheet
    await page.getByTestId('status-view-datasheet').click();
    await newRecordAt(page, 1);
    await page.keyboard.type('Ecrou');
    await closeEditor(page, 'Tab');
    await page.keyboard.press('-');
    await expect(cellEditor(page)).toBeFocused();
    await page.keyboard.type('1');
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('modal')).toContainText(fr.fieldError.validation.replace('{{rule}}', '[Qté] > 0'));
    await page.getByTestId('modal-btn-ok').click();
    await page.keyboard.press('Escape');
    expect((await rowsOf(page)).map((r) => r.values)).toEqual([[1, 'Vis', -2]]);
  } finally {
    await app.close();
  }
});
