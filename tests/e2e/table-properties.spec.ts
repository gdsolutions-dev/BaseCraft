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
const commandes = t('Commandes', [f('N°', 'autoNumber'), f('DateCommande', 'dateTime'), f('DateLivraison', 'dateTime')]);
// DatasheetView: row selector width, header and row heights, AutoNumber column width.
const MARKER = 44, HEADER = 34, ROW = 30, AUTONUMBER = 80;
const cellEditor = (page: Page) => page.getByTestId('grid-editor-portal').locator('textarea');

test('Table Property Sheet: F4 and the ribbon, a record rule built, saved over existing data, tested and enforced', async () => {
  const base = await seedBase('proprietes-table', async (db) => {
    createTable(db, commandes);
    await insertRow(db, commandes, { DateCommande: '23/10/2026', DateLivraison: '01/10/2026' }, localeInfo('fr-FR')); // breaks the rule below
  });
  const { app, page } = await launchApp({ args: [base], env: FR });
  const sheet = page.getByTestId('table-properties');
  try {
    await page.getByTestId('nav-item-Commandes').click({ button: 'right' });
    await page.getByTestId('nav-menu-design').click();
    await page.getByTestId('design-row-1-name').click();
    await expect(sheet).toHaveCount(0);

    // Table Design › Property Sheet shows it, F4 hides and shows it again
    await page.getByTestId('ribbon-tab-design').click();
    await page.getByTestId('cmd-propertySheet').click();
    await expect(sheet).toBeVisible();
    await page.getByTestId('design-row-1-name').click();
    await page.keyboard.press('F4');
    await expect(sheet).toHaveCount(0);
    await page.keyboard.press('F4');
    await expect(sheet).toBeVisible();

    // the rule through the builder: Fields › DateLivraison, >=, Fields › DateCommande
    await page.getByTestId('table-prop-validationRule-build').click();
    await page.getByTestId('xb-el-fields').click();
    await page.getByTestId('xb-val-DateLivraison').dblclick();
    await page.getByTestId('xb-el-operators').click();
    await page.getByTestId('xb-val->=').dblclick();
    await page.getByTestId('xb-el-fields').click();
    await page.getByTestId('xb-val-DateCommande').dblclick();
    await page.getByTestId('xb-ok').click();
    await expect(page.getByTestId('modal')).toHaveCount(0);
    await expect(page.getByTestId('table-prop-validationRule')).toHaveValue('[DateLivraison] >= [DateCommande]');
    await page.getByTestId('table-prop-validationText').fill('Livraison avant commande');
    await page.getByTestId('table-prop-description').fill('Les commandes');

    // saved: the existing row breaks it, the designer asks; Yes
    await page.keyboard.press('Control+s');
    await expect(page.getByTestId('modal')).toContainText(fr.designer.validationExisting_one.replace('{{count}}', '1'));
    await page.getByTestId('modal-btn-yes').click();
    await expect(page.getByTestId('doc-tab-Commandes')).not.toContainText('•');
    await expect(page.getByTestId('table-prop-validationText')).toHaveValue('Livraison avant commande');
    expect(await page.evaluate(() => (window as any).basecraft.tables.design('Commandes'))).toMatchObject({
      description: 'Les commandes', validationRule: '[DateLivraison] >= [DateCommande]', validationText: 'Livraison avant commande',
    });

    // Test Validation Rules: the table rule on its own line
    await page.getByTestId('cmd-testValidationRules').click();
    await expect(page.getByTestId('modal')).toContainText(fr.designer.testRulesTable_one.replace('{{count}}', '1'));
    await page.getByTestId('modal-btn-ok').click();

    // a refused record in the datasheet: a message box with the validation text alone (no field)
    await page.getByTestId('status-view-datasheet').click();
    const b = (await page.getByTestId('datasheet').getByTestId('data-grid-canvas').boundingBox())!;
    await page.mouse.click(b.x + MARKER + AUTONUMBER + 30, b.y + HEADER + ROW + ROW / 2); // the new record's DateCommande
    await expect(cellEditor(page)).toBeFocused();
    await page.keyboard.type('23/10/2026');
    await page.keyboard.press('Tab');
    await expect(cellEditor(page)).toHaveCount(0);
    await page.keyboard.press('0');
    await expect(cellEditor(page)).toBeFocused();
    await page.keyboard.type('1/10/2026');
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('modal')).toContainText('Livraison avant commande');
    await expect(page.getByTestId('modal')).not.toContainText('»');
    await page.getByTestId('modal-btn-ok').click();
    await expect(page.getByTestId('datasheet-error')).toHaveText('Livraison avant commande');
    await page.keyboard.press('Escape');
    expect((await page.evaluate(() => (window as any).basecraft.rows.page('Commandes', { offset: 0, limit: 10 }))).rows).toHaveLength(1);
  } finally {
    await app.close();
  }
});

test('Table Design › Indexes: a unique index on two fields, saved, enforced in the datasheet, shown again', async () => {
  const personnes = t('Personnes', [f('N°', 'autoNumber'), f('Nom', 'shortText'), f('Prénom', 'shortText'), f('Ville', 'shortText', { indexed: 'yesDuplicates' })]);
  const base = await seedBase('index-multichamps', async (db) => {
    createTable(db, personnes);
    await insertRow(db, personnes, { Nom: 'Dupont', Prénom: 'Jean' }, localeInfo('fr-FR'));
  });
  const { app, page } = await launchApp({ args: [base], env: FR });
  const dialog = page.getByTestId('indexes-dialog');
  try {
    await page.getByTestId('nav-item-Personnes').click({ button: 'right' });
    await page.getByTestId('nav-menu-design').click();
    await page.getByTestId('design-row-1-name').click();
    await page.getByTestId('ribbon-tab-design').click();
    await page.getByTestId('cmd-indexes').click();
    await expect(dialog).toBeVisible();
    for (const [i, name] of ['PrimaryKey', 'N°', 'Ville'].entries()) await expect(page.getByTestId(`idx-name-${i}`)).toHaveValue(name);

    // a new index: Nom, Prénom (descending), unique
    await page.getByTestId('idx-add').click();
    await page.getByTestId('idx-name-3').fill('NomPrénom');
    await page.getByTestId('idx-field-3-0').selectOption('Nom');
    await page.getByTestId('idx-add-field-3').click();
    await page.getByTestId('idx-field-3-1').selectOption('Prénom');
    await page.getByTestId('idx-dir-3-1').selectOption('desc');
    await page.getByTestId('idx-unique-3').check();
    await page.getByTestId('indexes-ok').click();
    await expect(dialog).toHaveCount(0);
    await expect(page.getByTestId('doc-tab-Personnes')).toContainText('•');
    await page.keyboard.press('Control+s');
    await expect(page.getByTestId('doc-tab-Personnes')).not.toContainText('•');
    expect((await page.evaluate(() => (window as any).basecraft.tables.design('Personnes'))).indexes).toEqual([
      { name: 'NomPrénom', fields: [{ name: 'Nom', desc: false }, { name: 'Prénom', desc: true }], unique: true }]);

    // a duplicate pair is refused in the datasheet
    await page.getByTestId('status-view-datasheet').click();
    const b = (await page.getByTestId('datasheet').getByTestId('data-grid-canvas').boundingBox())!;
    await page.mouse.click(b.x + MARKER + AUTONUMBER + 30, b.y + HEADER + ROW + ROW / 2); // the new record's Nom
    await expect(cellEditor(page)).toBeFocused();
    await page.keyboard.type('Dupont');
    await page.keyboard.press('Tab');
    await expect(cellEditor(page)).toHaveCount(0);
    await page.keyboard.press('J');
    await expect(cellEditor(page)).toBeFocused();
    await page.keyboard.type('ean');
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('modal')).toContainText(fr.fieldError.duplicate);
    await page.getByTestId('modal-btn-ok').click();
    await page.keyboard.press('Escape');
    await page.keyboard.press('Escape');
    expect((await page.evaluate(() => (window as any).basecraft.rows.page('Personnes', { offset: 0, limit: 10 }))).rows).toHaveLength(1);

    // reopened: PrimaryKey, the field's index and the new one
    await page.getByTestId('status-view-design').click();
    await page.getByTestId('ribbon-tab-design').click();
    await page.getByTestId('cmd-indexes').click();
    for (const [i, name] of ['PrimaryKey', 'N°', 'Ville', 'NomPrénom'].entries()) await expect(page.getByTestId(`idx-name-${i}`)).toHaveValue(name);
    await expect(page.getByTestId('idx-field-3-1')).toHaveValue('Prénom');
    await expect(page.getByTestId('idx-dir-3-1')).toHaveValue('desc');
    await expect(page.getByTestId('idx-unique-3')).toBeChecked();
    await page.getByTestId('indexes-cancel').click();
    await expect(dialog).toHaveCount(0);
  } finally {
    await app.close();
  }
});
