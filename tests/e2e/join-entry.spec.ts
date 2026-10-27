// B4: data entry through a one-to-many join (R1–R7), in a query datasheet.
import { test, expect, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { saveObject } from '../../src/main/db/objects';
import { seedSales } from '../../src/main/query/test-db';
import type { BasecraftApi } from '../../src/shared/api';
import type { DesignDoc } from '../../src/shared/design/model';
import { launchApp, seedBase, seedForm, seedSalesE2E } from './helpers';

const fr = JSON.parse(readFileSync(join(__dirname, '../../src/shared/i18n/fr.json'), 'utf8'));
const FR = { BASECRAFT_REGION: 'fr-FR' };
type Win = { basecraft: BasecraftApi };
// DatasheetView: row selector width, header and row heights.
const MARKER = 44, HEADER = 34, ROW = 30;
// QSaisie's columns: Commandes.N° (AutoNumber 80), Client (Number 110), Clients.N° (AutoNumber 80), Nom (Short Text 170), Montant (Currency 120)
const X = { client: 80 + 30, cliN: 190 + 30, nom: 270 + 30, montant: 440 + 30 };
const COL = { cmdN: 0, client: 1, cliN: 2, nom: 3, montant: 4 };
const QSAISIE = 'SELECT Commandes.[N°], Commandes.Client, Clients.[N°], Clients.Nom, Commandes.Montant FROM Clients INNER JOIN Commandes ON Clients.[N°] = Commandes.Client;';
const QVIRGULE = 'SELECT Clients.Nom, Commandes.Montant, Commandes.Le FROM Clients, Commandes WHERE Clients.[N°] = Commandes.Client;';

const doc = (page: Page) => page.locator('section[role=tabpanel]:not([hidden])');
const cell = (page: Page, col: number, row: number) => doc(page).getByTestId(`glide-cell-${col + 1}-${row}`);
const cellEditor = (page: Page) => page.getByTestId('grid-editor-portal').locator('textarea');
const rowcount = (page: Page) => doc(page).getByTestId('datasheet').locator('table[role=grid]');
async function grid(page: Page) {
  const c = doc(page).getByTestId('data-grid-canvas');
  await expect(c).toBeVisible();
  return (await c.boundingBox())!;
}
async function clickCell(page: Page, x: number, row: number, col: number) {
  const b = await grid(page);
  await page.mouse.click(b.x + MARKER + x, b.y + HEADER + row * ROW + ROW / 2);
  await expect(cell(page, col, row)).toBeFocused();
}
const settled = (page: Page) => expect(doc(page).getByTestId('datasheet')).not.toHaveAttribute('aria-busy', 'true');
const rowsOf = (page: Page, table: string) =>
  page.evaluate(async (t) => (await (window as unknown as Win).basecraft.rows.page(t, { offset: 0, limit: 50 })).rows.map((r) => r.values), table);

test('datasheet: a join query is updatable; a one-side edit shows on the other rows, AutoLookup fills a new record (B4 R2–R7)', async () => {
  const { app, page } = await launchApp({ args: [seedSalesE2E('saisie-jointure')], env: FR });
  try {
    for (const [name, sql] of [['QSaisie', QSAISIE], ['QVentesVirgule', QVIRGULE]]) {
      expect(await page.evaluate(([n, q]) => (window as unknown as Win).basecraft.objects.save('query', n!, { formatVersion: '1.0', sql: q }, null), [name, sql])).toEqual({ ok: true });
    }
    await page.reload();
    await page.waitForSelector('[data-testid="app-root"]', { state: 'attached' });

    // 1. updatable: no read-only note, a new record row
    await page.getByTestId('nav-item-query-QSaisie').dblclick();
    await expect(doc(page).getByTestId('nav-record-count')).toHaveText('5');
    await expect(doc(page).getByTestId('nav-readonly')).toHaveCount(0);
    await expect(rowcount(page)).toHaveAttribute('aria-rowcount', '7'); // header + 5 records + the new record row

    // 2. sorted on Nom, Dupont's first order: Nom → « Dupont SA »; his other order shows it once the row is left (R3, R6)
    await clickCell(page, X.nom, 0, COL.nom);
    await page.getByTestId('ribbon-tab-home').click();
    await page.getByTestId('cmd-sortAsc').click();
    for (const [row, nom] of ['Dupont', 'Dupont', 'Durand', 'Martin', 'Martin'].entries()) await expect(cell(page, COL.nom, row)).toHaveText(nom);
    await clickCell(page, X.client, 1, COL.client); // the selected cell, clicked again, would not take the focus back from the ribbon
    await clickCell(page, X.nom, 0, COL.nom);
    await page.keyboard.press('D');
    await expect(cellEditor(page)).toBeFocused();
    await page.keyboard.type('upont SA');
    await page.keyboard.press('Tab');
    await expect(cellEditor(page)).toHaveCount(0);
    await page.keyboard.press('ArrowDown');
    await settled(page);
    await expect(cell(page, COL.nom, 0)).toHaveText('Dupont SA');
    await expect(cell(page, COL.nom, 1)).toHaveText('Dupont SA');
    expect((await rowsOf(page, 'Clients'))[0]).toEqual([1, 'Dupont SA', 'Lyon']);

    // 3. the one side's join field opens no editor (R2)
    await clickCell(page, X.cliN, 0, COL.cliN);
    await page.keyboard.press('5');
    await expect(cellEditor(page)).toHaveCount(0);
    await expect(cell(page, COL.cliN, 0)).toHaveText('1');

    // 4. a new record: Client 3, Tab → Nom shows Durand before the row is left (R4); Montant 1, ArrowUp: one order, no client
    const g = await grid(page);
    await page.mouse.click(g.x + MARKER + X.client, g.y + HEADER + 5 * ROW + ROW / 2); // the new record row: its editor opens
    await expect(cellEditor(page)).toBeFocused();
    await page.keyboard.type('3');
    await page.keyboard.press('Tab');
    await expect(cellEditor(page)).toHaveCount(0);
    await expect(cell(page, COL.nom, 5)).toHaveText('Durand');
    await expect(page.getByTestId('doc-tab-query-QSaisie')).toContainText('•'); // still pending
    await clickCell(page, X.montant, 5, COL.montant);
    await page.keyboard.press('1');
    await expect(cellEditor(page)).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(cellEditor(page)).toHaveCount(0);
    await page.keyboard.press('ArrowUp');
    await settled(page);
    await expect(doc(page).getByTestId('nav-record-count')).toHaveText('6');
    const orders = await rowsOf(page, 'Commandes');
    expect(orders).toHaveLength(6);
    expect(orders[5]!.slice(0, 3)).toEqual([6, 3, 1]);
    expect(await rowsOf(page, 'Clients')).toHaveLength(4);

    // 5. Montant 0 breaks the > 0 rule: the message, the row stays pending; Escape restores it
    await clickCell(page, X.montant, 0, COL.montant);
    const before = await cell(page, COL.montant, 0).textContent();
    await page.keyboard.press('0');
    await expect(cellEditor(page)).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(cellEditor(page)).toHaveCount(0);
    await page.keyboard.press('ArrowDown');
    await expect(page.getByTestId('modal')).toBeVisible();
    await expect(page.getByTestId('modal')).toContainText('Montant');
    await page.getByTestId('modal-btn-ok').click();
    await expect(doc(page).getByTestId('datasheet-error')).toBeVisible();
    await expect(page.getByTestId('doc-tab-query-QSaisie')).toContainText('•');
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('doc-tab-query-QSaisie')).not.toContainText('•');
    await expect(cell(page, COL.montant, 0)).toHaveText(before!);
    expect((await rowsOf(page, 'Commandes')).map((r) => r[2])).not.toContain(0);

    // 6. the new order deleted: from Commandes only (R2)
    let row = -1;
    for (let i = 0; i < 6 && row < 0; i++) if ((await cell(page, COL.cmdN, i).textContent()) === '6') row = i;
    expect(row).toBeGreaterThanOrEqual(0);
    const b = await grid(page);
    await page.mouse.click(b.x + MARKER / 2, b.y + HEADER + row * ROW + ROW / 2);
    await expect(doc(page).getByTestId('datasheet').locator(`tr[aria-rowindex="${row + 2}"]`)).toHaveAttribute('aria-selected', 'true');
    await page.keyboard.press('Delete');
    await expect(page.getByTestId('modal')).toContainText(fr.datasheet.delete_one);
    await page.getByTestId('modal-btn-yes').click();
    await expect(doc(page).getByTestId('nav-record-count')).toHaveText('5');
    expect(await rowsOf(page, 'Commandes')).toHaveLength(5);
    expect(await rowsOf(page, 'Clients')).toHaveLength(4);
    await page.getByTestId('doc-tab-close-query-QSaisie').click();

    // 7. a cross product stays read-only (A3's behaviour, R7)
    await page.getByTestId('nav-item-query-QVentesVirgule').dblclick();
    await expect(doc(page).getByTestId('nav-record-count')).toHaveText('5');
    await expect(doc(page).getByTestId('nav-readonly')).toHaveText(fr.query.readOnly);
    await expect(rowcount(page)).toHaveAttribute('aria-rowcount', '6'); // no new record row
  } finally {
    await app.close();
  }
});

test('datasheet: leaving the row waits for AutoLookup; a failed lookup keeps the row pending (B4 R4, final review I1)', async () => {
  const { app, page } = await launchApp({ args: [seedSalesE2E('saisie-recherche')], env: FR });
  // sources.autoLookup answered by the main process as usual, or failing
  const lookupFails = (on: boolean) => app.evaluate(({ ipcMain }, fail) => {
    const handlers = (ipcMain as unknown as { _invokeHandlers: Map<string, (...a: unknown[]) => unknown> })._invokeHandlers;
    const g = globalThis as unknown as { realLookup?: (...a: unknown[]) => unknown };
    g.realLookup ??= handlers.get('bc:sources:autoLookup');
    handlers.set('bc:sources:autoLookup', fail ? () => { throw new Error('bc:cannotOpen'); } : g.realLookup!);
  }, on);
  const rowOfOrder = async (n: string) => {
    for (let i = 0; i < 5; i++) if ((await cell(page, COL.cmdN, i).textContent()) === n) return i;
    throw new Error(`order ${n} not shown`);
  };
  /** Nom typed for the row's client, then Client 3 and Enter (the row is left at once: the lookup is still in flight). */
  const nomThenClient3 = async (row: number, nom: string) => {
    await clickCell(page, X.nom, row, COL.nom);
    await page.keyboard.press(nom[0]!);
    await expect(cellEditor(page)).toBeFocused();
    await page.keyboard.type(nom.slice(1));
    await page.keyboard.press('Tab');
    await expect(cellEditor(page)).toHaveCount(0);
    await clickCell(page, X.client, row, COL.client);
    await page.keyboard.press('3');
    await expect(cellEditor(page)).toBeFocused();
    await page.keyboard.press('Enter');
  };
  const noms = async () => (await rowsOf(page, 'Clients')).map((r) => r[1]);
  const clientOf = async (order: number) => (await rowsOf(page, 'Commandes')).find((r) => r[0] === order)![1];
  try {
    expect(await page.evaluate((q) => (window as unknown as Win).basecraft.objects.save('query', 'QSaisie', { formatVersion: '1.0', sql: q }, null), QSAISIE)).toEqual({ ok: true });
    await page.reload();
    await page.waitForSelector('[data-testid="app-root"]', { state: 'attached' });
    await page.getByTestId('nav-item-query-QSaisie').dblclick();
    await expect(doc(page).getByTestId('nav-record-count')).toHaveText('5');

    // 1. Dupont's order: Nom « Dupont SA », Client 3 + Enter → the order goes to Durand, who keeps his name (R4)
    await nomThenClient3(await rowOfOrder('1'), 'Dupont SA');
    await settled(page);
    await expect(page.getByTestId('doc-tab-query-QSaisie')).not.toContainText('•');
    expect(await clientOf(1)).toBe(3);
    expect(await noms()).toEqual(['Dupont', 'Martin', 'Durand', 'Éric']);

    // 2. the lookup fails: the save is refused with its error, nothing is written, the row stays pending
    await lookupFails(true);
    const row = await rowOfOrder('3'); // Martin's
    await nomThenClient3(row, 'Martin SA');
    await expect(page.getByTestId('modal')).toBeVisible();
    await page.getByTestId('modal-btn-ok').click();
    await settled(page);
    await expect(page.getByTestId('modal')).toHaveCount(0);
    await expect(page.getByTestId('doc-tab-query-QSaisie')).toContainText('•');
    expect(await clientOf(3)).toBe(2);
    expect(await noms()).toEqual(['Dupont', 'Martin', 'Durand', 'Éric']);

    // 3. a lookup that succeeds lifts it: the row is saved, Durand still keeps his name
    await lookupFails(false);
    await clickCell(page, X.client, row, COL.client);
    await page.keyboard.press('3');
    await expect(cellEditor(page)).toBeFocused();
    await page.keyboard.press('Enter');
    await settled(page);
    await expect(page.getByTestId('doc-tab-query-QSaisie')).not.toContainText('•');
    expect(await clientOf(3)).toBe(3);
    expect(await noms()).toEqual(['Dupont', 'Martin', 'Durand', 'Éric']);
  } finally {
    await app.close();
  }
});

test('datasheet: an outer join row without its key record is read-only and never deleted (B4 R5)', async () => {
  const { app, page } = await launchApp({ args: [seedSalesE2E('saisie-externe')], env: FR });
  try {
    const sql = 'SELECT Clients.Nom, Commandes.Montant FROM Clients LEFT JOIN Commandes ON Clients.[N°] = Commandes.Client;';
    expect(await page.evaluate((q) => (window as unknown as Win).basecraft.objects.save('query', 'QExterne', { formatVersion: '1.0', sql: q }, null), sql)).toEqual({ ok: true });
    await page.reload();
    await page.waitForSelector('[data-testid="app-root"]', { state: 'attached' });
    await page.getByTestId('nav-item-query-QExterne').dblclick();
    await expect(doc(page).getByTestId('nav-record-count')).toHaveText('6'); // 5 orders + Éric, who has none
    await expect(doc(page).getByTestId('nav-readonly')).toHaveCount(0);
    const nom = 30, montant = 170 + 30; // Nom (Short Text 170), Montant (Currency 120)
    await clickCell(page, nom, 0, 0);
    await page.getByTestId('ribbon-tab-home').click();
    await page.getByTestId('cmd-sortAsc').click();
    for (const [row, n] of ['Dupont', 'Dupont', 'Durand', 'Éric', 'Martin', 'Martin'].entries()) await expect(cell(page, 0, row)).toHaveText(n);
    await clickCell(page, montant, 1, 1);
    // Éric's row: neither his Nom nor the empty Montant opens an editor
    for (const [x, col] of [[nom, 0], [montant, 1]] as const) {
      await clickCell(page, x, 3, col);
      await page.keyboard.press('5');
      await expect(cellEditor(page)).toHaveCount(0);
    }
    await expect(page.getByTestId('doc-tab-query-QExterne')).not.toContainText('•');
    // a keyed row still opens its editor (the query is updatable)
    await clickCell(page, montant, 2, 1);
    await page.keyboard.press('5');
    await expect(cellEditor(page)).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(cellEditor(page)).toHaveCount(0);
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('doc-tab-query-QExterne')).not.toContainText('•');
    // Delete on Éric's row: no question, nothing deleted
    const b = await grid(page);
    await page.mouse.click(b.x + MARKER / 2, b.y + HEADER + 3 * ROW + ROW / 2);
    await expect(doc(page).getByTestId('datasheet').locator('tr[aria-rowindex="5"]')).toHaveAttribute('aria-selected', 'true');
    await page.keyboard.press('Delete');
    await settled(page);
    await expect(page.getByTestId('modal')).toHaveCount(0);
    await expect(doc(page).getByTestId('nav-record-count')).toHaveText('6');
    await expect(cell(page, 0, 3)).toHaveText('Éric');
    expect(await rowsOf(page, 'Commandes')).toHaveLength(5);
    expect(await rowsOf(page, 'Clients')).toHaveLength(4);
  } finally {
    await app.close();
  }
});

test('form: AutoForm on the join query is updatable; AutoLookup shows the client before the save; one save per record (B4 R2–R4)', async () => {
  const { app, page } = await launchApp({ args: [seedSalesE2E('saisie-formulaire')], env: FR });
  const ctl = (n: string) => page.getByTestId(`form-ctl-${n}`).filter({ visible: true });
  const dirty = page.getByTestId('form-dirty').filter({ visible: true });
  try {
    expect(await page.evaluate((q) => (window as unknown as Win).basecraft.objects.save('query', 'QSaisie', { formatVersion: '1.0', sql: q }, null), QSAISIE)).toEqual({ ok: true });
    await page.reload();
    await page.waitForSelector('[data-testid="app-root"]', { state: 'attached' });

    // Create › Form on QSaisie, saved as FSaisie
    await page.getByTestId('nav-item-query-QSaisie').click();
    await page.getByTestId('ribbon-tab-create').click();
    await page.getByTestId('cmd-createForm').click();
    await expect(page.getByTestId('doc-tab-form-QSaisie')).toHaveAttribute('aria-selected', 'true');
    await page.getByTestId('doc-tab-close-form-QSaisie').click();
    expect(await page.evaluate(() => (window as unknown as Win).basecraft.objects.rename('form', 'QSaisie', 'FSaisie'))).toEqual({ ok: true });
    await page.reload();
    await page.waitForSelector('[data-testid="app-root"]', { state: 'attached' });
    await page.getByTestId('nav-item-form-FSaisie').dblclick();
    await expect(page.getByTestId('doc-tab-form-FSaisie')).toHaveAttribute('aria-selected', 'true');
    await expect(ctl('Nom')).toHaveValue('Dupont');
    await expect(page.getByTestId('nav-readonly').filter({ visible: true })).toHaveCount(0);

    // a new record: Client 2, Tab → Nom shows Martin while the record is dirty (R4); Montant 12,5, Shift+Enter: one order
    await page.getByTestId('nav-new').filter({ visible: true }).click();
    await ctl('Client').fill('2');
    await page.keyboard.press('Tab');
    await expect(ctl('Nom')).toHaveValue('Martin');
    await expect(dirty).toBeVisible();
    await ctl('Montant').fill('12,5');
    await page.keyboard.press('Shift+Enter');
    await expect(dirty).toHaveCount(0);
    const orders = await rowsOf(page, 'Commandes');
    expect(orders).toHaveLength(6);
    expect(orders[5]!.slice(0, 3)).toEqual([6, 2, 12.5]);

    // Nom Martin SA, Shift+Enter: written to client 2 (R3)
    await ctl('Nom').fill('Martin SA');
    await page.keyboard.press('Shift+Enter');
    await expect(dirty).toHaveCount(0);
    expect((await rowsOf(page, 'Clients'))[1]).toEqual([2, 'Martin SA', 'LYON']);

    // the one side's join field is read-only (R2)
    await expect(ctl('Clients_N°')).toHaveAttribute('readonly', ''); // the control of the column Clients.N°

    // Client 99: no such client, the record stays dirty; Escape gives back Client 2 and Nom Martin SA
    await ctl('Client').fill('99');
    await page.keyboard.press('Shift+Enter');
    await expect(page.getByTestId('modal')).toContainText(fr.fieldError.noParent.replace('{{table}}', 'Clients'));
    await page.getByTestId('modal-btn-ok').click();
    await expect(dirty).toBeVisible();
    await page.keyboard.press('Escape');
    await page.keyboard.press('Escape');
    await expect(ctl('Client')).toHaveValue('2');
    await expect(ctl('Nom')).toHaveValue('Martin SA');
    await expect(dirty).toHaveCount(0);
    expect((await rowsOf(page, 'Commandes'))[5]!.slice(0, 3)).toEqual([6, 2, 12.5]);
  } finally {
    await app.close();
  }
});

test('form: a combo text typed out of its list stays as typed when AutoLookup answers (B4 R4)', async () => {
  const base = seedBase('saisie-combo', (db) => {
    seedSales(db);
    const r = saveObject(db, 'query', 'QSaisie', { formatVersion: '1.0', sql: QSAISIE }, null);
    if (!r.ok) throw new Error(r.reason);
    const doc: DesignDoc = { formatVersion: '1.0', recordSource: { kind: 'query', name: 'QSaisie' }, props: { Width: 9072 }, sections: [
      { kind: 'formHeader', height: 0, props: { Visible: false }, controls: [] },
      { kind: 'detail', height: 1200, props: {}, controls: [
        // Client: the hidden N° bound, the name shown (A2's lookup); Limit To List compares the shown texts
        { kind: 'comboBox', name: 'Client', left: 1701, top: 100, width: 2268, height: 340, props: { ControlSource: 'Client', TabIndex: 0, RowSourceType: 'tableQuery',
          RowSource: 'Clients', BoundColumn: 1, ColumnCount: 2, ColumnWidths: '0;1417', LimitToList: true } },
        { kind: 'textBox', name: 'Nom', left: 1701, top: 600, width: 2268, height: 340, props: { ControlSource: 'Nom', TabIndex: 1 } },
      ] },
      { kind: 'formFooter', height: 0, props: { Visible: false }, controls: [] },
    ] };
    seedForm(db, 'FCombo', doc);
  });
  const { app, page } = await launchApp({ args: [base], env: FR });
  const ctl = (n: string) => page.getByTestId(`form-ctl-${n}`).filter({ visible: true });
  try {
    await page.getByTestId('nav-item-form-FCombo').dblclick();
    await expect(ctl('Client')).toHaveValue('Dupont');
    // « 2 » typed: a hidden bound N°, so not in the list; AutoLookup still shows client 2, and the combo keeps « 2 »
    await ctl('Client').click();
    await page.keyboard.press('ControlOrMeta+A');
    await page.keyboard.type('2');
    await page.keyboard.press('Tab');
    await expect(page.getByTestId('modal')).toContainText(fr.fieldError.notInList);
    await page.getByTestId('modal-btn-ok').click();
    await expect(ctl('Nom')).toHaveValue('Martin');
    await expect(ctl('Client')).toHaveValue('2');
    await page.keyboard.press('Escape');
    await page.keyboard.press('Escape');
    await expect(ctl('Client')).toHaveValue('Dupont');
    await expect(ctl('Nom')).toHaveValue('Dupont');
  } finally {
    await app.close();
  }
});
