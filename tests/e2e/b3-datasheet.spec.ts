// B3: a form's Datasheet view column header has the sort and filter drop-down, as a table's datasheet.
import { test, expect } from '@playwright/test';
import { createTable } from '../../src/main/db/schema';
import type { ControlDef, DesignDoc } from '../../src/shared/design/model';
import { f, t } from '../../src/shared/test-fixtures';
import { saveObject } from '../../src/main/db/objects';
import { saveRelation } from '../../src/main/db/relations';
import type { BasecraftApi } from '../../src/shared/api';
import { localeInfo } from '../../src/shared/locale-format';
import { colLeft, formGrid, launchApp, seedBase, seedForm, pickView } from './helpers';

const ctl = (name: string, left: number): ControlDef => ({ kind: 'textBox', name, left, top: 100, width: 1800, height: 340, props: { ControlSource: name, TabIndex: left } });
const doc: DesignDoc = {
  formatVersion: '1.0', recordSource: { kind: 'table', name: 'Gens' }, props: { Width: 6000 },
  sections: [{ kind: 'detail', height: 600, props: {}, controls: [ctl('Nom', 100), ctl('Ville', 2100)] }],
};
const base = () => seedBase('fx-b3-header', (db) => {
  createTable(db, t('Gens', [f('Nom', 'shortText'), f('Ville', 'shortText')]));
  db.exec(`INSERT INTO "Gens"("Nom","Ville") VALUES ('Bea','Paris'), ('Abel','Lyon'), ('Cleo','Paris')`);
  seedForm(db, 'Gens', doc);
});

test("a form's Datasheet view: the header drop-down sorts and filters on its column", async () => {
  const { app, page } = await launchApp({ args: [base()] });
  try {
    await page.getByTestId('nav-item-form-Gens').dblclick();
    await page.getByTestId('ribbon-tab-home').click();
    await pickView(page, 'viewDatasheet');
    const sheet = page.locator('[data-testid="form-datasheet"]:visible');
    const cell = (c: number, r: number) => sheet.getByTestId(`glide-cell-${c + 1}-${r}`);
    const b = (await sheet.getByTestId('data-grid-canvas').boundingBox())!;
    const menu = async (col: number) => { await page.mouse.click(b.x + 44 + 120 * (col + 1) - 12, b.y + 17); await expect(page.getByTestId('filter-menu')).toBeVisible(); };
    await menu(0);
    await page.getByTestId('filter-sort-asc').click();
    await expect(cell(0, 0)).toHaveText('Abel');
    await menu(1);
    await page.getByTestId('filter-value-0').click(); // Lyon (ticked) off: only Paris is kept
    await page.getByTestId('filter-ok').click();
    await expect(cell(0, 0)).toHaveText('Bea');
    await expect(cell(0, 1)).toHaveText('Cleo');
    await expect(page.locator('[data-testid="nav-record-count"]:visible')).toHaveText('2');
  } finally { await app.close(); }
});

// ---- typing during a row save, a scanner burst across fields, a click on a subform's second row
const rowsOf = (page: import('@playwright/test').Page, table: string) =>
  page.evaluate((n) => (window as unknown as { basecraft: BasecraftApi }).basecraft.rows.page(n, { offset: 0, limit: 100 }).then((p) => p.rows.map((r) => r.values)), table);
const people = () => seedBase('fx-b3-saisie', (db) => {
  createTable(db, t('Gens', [f('N°', 'autoNumber'), f('Nom', 'shortText'), f('Ville', 'shortText')]));
  db.exec(`INSERT INTO "Gens"("Nom","Ville") VALUES ('Abel','Lyon'), ('Bea','Paris'), ('Cleo','Nice')`);
});

test('table datasheet: keys typed right after leaving a modified row (its save under way) are kept, a burst per field', async () => {
  const { app, page } = await launchApp({ args: [people()] });
  try {
    await page.getByTestId('nav-item-Gens').dblclick();
    const sheet = page.locator('[data-testid="datasheet"]:visible');
    const b = (await sheet.getByTestId('data-grid-canvas').boundingBox())!;
    const click = (col: number, row: number) => page.mouse.click(b.x + colLeft(col) + 20, b.y + 34 + row * 30 + 15);
    await click(1, 0);
    await expect(sheet.getByTestId('glide-cell-2-0')).toBeFocused();
    await page.keyboard.type('X');                      // opens the editor
    await page.keyboard.type('YZ');
    await page.keyboard.press('Tab');
    await expect(sheet.getByTestId('glide-cell-3-0')).toHaveAttribute('aria-selected', 'true');   // each field waited for: its keys are kept
    await page.keyboard.type('QRS\n');
    await expect.poll(() => rowsOf(page, 'Gens')).toEqual([[1, 'XYZ', 'QRS'], [2, 'Bea', 'Paris'], [3, 'Cleo', 'Nice']]);
    // modify a row, click another one and type at once, while the first is saved
    await click(1, 1);
    await expect(sheet.getByTestId('glide-cell-2-1')).toBeFocused();
    await page.keyboard.type('B2\n');
    await click(2, 2);
    await page.keyboard.type('K9\n', { delay: 0 });
    await expect.poll(() => rowsOf(page, 'Gens')).toEqual([[1, 'XYZ', 'QRS'], [2, 'B2', 'Paris'], [3, 'Cleo', 'K9']]);
  } finally { await app.close(); }
});

test("a subform's datasheet: a click on its second row selects it and what is typed goes there", async () => {
  const box = (kind: ControlDef['kind'], name: string, left: number, top: number, props: Record<string, unknown>, width = 1500, height = 340): ControlDef => ({ kind, name, left, top, width, height, props });
  const form = (table: string, detail: ControlDef[], props: Record<string, unknown> = {}): DesignDoc => ({ formatVersion: '1.0', recordSource: { kind: 'table', name: table }, props: { Width: 9000, ...props },
    sections: [{ kind: 'detail', height: 4000, props: {}, controls: detail }] });
  const path = seedBase('fx-b3-sous', (db) => {
    createTable(db, t('Clients', [f('N°', 'autoNumber'), f('Nom', 'shortText')]));
    createTable(db, t('Commandes', [f('N°', 'autoNumber'), f('Client', 'number', { numberSize: 'longInteger' }), f('Montant', 'number', { numberSize: 'longInteger' })]));
    db.exec(`INSERT INTO "Clients"("Nom") VALUES ('Dupont'); INSERT INTO "Commandes"("Client","Montant") VALUES (1,10), (1,20), (1,30)`);
    saveRelation(db, { name: '', parentTable: 'Clients', parentFields: ['N°'], childTable: 'Commandes', childFields: ['Client'], enforce: true, cascadeUpdate: false, cascadeDelete: true, joinType: 1 }, null, localeInfo('fr-FR'));
    seedForm(db, 'Sous', form('Commandes', [box('textBox', 'N°', 100, 100, { ControlSource: 'N°', TabIndex: 0 }), box('textBox', 'Montant', 1800, 100, { ControlSource: 'Montant', TabIndex: 1 })], { DefaultView: 'datasheet' }));
    seedForm(db, 'Maitre', form('Clients', [box('textBox', 'Nom', 100, 100, { ControlSource: 'Nom', TabIndex: 0 }),
      box('subform', 'Commandes', 100, 600, { SourceObject: 'Sous', LinkMasterFields: 'N°', LinkChildFields: 'Client', TabIndex: 1 }, 4000, 2500)]));
  });
  const { app, page } = await launchApp({ args: [path] });
  try {
    await page.getByTestId('nav-item-form-Maitre').dblclick();
    const g = formGrid(page, page.getByTestId('form-ctl-Commandes'), [120, 120]);
    await expect(g.cell(1, 1)).toHaveText('20');
    await g.at(1, 1);                       // the second row, nothing awaited
    await page.keyboard.type('7\n', { delay: 0 });
    await expect.poll(() => rowsOf(page, 'Commandes')).toEqual([[1, 1, 10], [2, 1, 7], [3, 1, 30]]);
  } finally { await app.close(); }
});

// ---- a scanner burst across fields, no delay: every key is kept, in order (one queue for the pending moves)
/** keyboard.type() sends a Tab as text and its calls interleave when not awaited: one press per key, queued with no await between them. */
const burst = (page: import('@playwright/test').Page) => Promise.all(['X', 'Y', 'Z', 'Tab', 'Q', 'R', 'S', 'Enter'].map((k) => page.keyboard.press(k)));
const after = [[1, 'XYZ', 'QRS'], [2, 'Bea', 'Paris'], [3, 'Cleo', 'Nice']];

test('table datasheet: a burst across two fields (Tab inside) typed with no delay is kept', async () => {
  const { app, page } = await launchApp({ args: [people()] });
  try {
    await page.getByTestId('nav-item-Gens').dblclick();
    const sheet = page.locator('[data-testid="datasheet"]:visible');
    const b = (await sheet.getByTestId('data-grid-canvas').boundingBox())!;
    await page.mouse.click(b.x + colLeft(1) + 20, b.y + 34 + 15);
    await expect(sheet.getByTestId('glide-cell-2-0')).toBeFocused();
    await burst(page);
    await expect.poll(() => rowsOf(page, 'Gens')).toEqual(after);
  } finally { await app.close(); }
});

test("a form's Datasheet view: a burst across two fields with no delay is kept", async () => {
  const { app, page } = await launchApp({ args: [seedBase('fx-b3b-form', (db) => {
    createTable(db, t('Gens', [f('N°', 'autoNumber'), f('Nom', 'shortText'), f('Ville', 'shortText')]));
    db.exec(`INSERT INTO "Gens"("Nom","Ville") VALUES ('Abel','Lyon'), ('Bea','Paris'), ('Cleo','Nice')`);
    seedForm(db, 'Gens', { ...doc, sections: [{ kind: 'detail', height: 600, props: {}, controls: [ctl('Nom', 100), ctl('Ville', 2100)] }] });
  })] });
  try {
    await page.getByTestId('nav-item-form-Gens').dblclick();
    await page.getByTestId('ribbon-tab-home').click();
    await pickView(page, 'viewDatasheet');
    const sheet = page.locator('[data-testid="form-datasheet"]:visible');
    const b = (await sheet.getByTestId('data-grid-canvas').boundingBox())!;
    await page.mouse.click(b.x + 44 + 120 / 2, b.y + 34 + 15);
    await expect(sheet.getByTestId('glide-cell-1-0')).toHaveAttribute('aria-selected', 'true');
    await burst(page);
    await expect.poll(() => rowsOf(page, 'Gens')).toEqual(after);
  } finally { await app.close(); }
});

test("a form's text boxes: a burst across two fields with no delay is kept", async () => {
  const { app, page } = await launchApp({ args: [seedBase('fx-b3b-single', (db) => {
    createTable(db, t('Gens', [f('N°', 'autoNumber'), f('Nom', 'shortText'), f('Ville', 'shortText')]));
    db.exec(`INSERT INTO "Gens"("Nom","Ville") VALUES ('Abel','Lyon'), ('Bea','Paris'), ('Cleo','Nice')`);
    seedForm(db, 'Gens', doc);
  })] });
  try {
    await page.getByTestId('nav-item-form-Gens').dblclick();
    const nom = page.getByTestId('form-ctl-Nom').filter({ visible: true });
    await nom.click();
    await nom.selectText();
    await burst(page);
    await expect.poll(() => rowsOf(page, 'Gens')).toEqual(after);
  } finally { await app.close(); }
});
