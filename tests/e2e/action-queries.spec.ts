import { test, expect, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { BasecraftApi } from '../../src/shared/api';
import { saveObject } from '../../src/main/db/objects';
import { seedSales, seedSalesRelation } from '../../src/main/query/test-db';
import { launchApp, seedBase, seedSalesE2E } from './helpers';

const fr = JSON.parse(readFileSync(join(__dirname, '../../src/shared/i18n/fr.json'), 'utf8'));
const FR = { BASECRAFT_REGION: 'fr-FR' };
type Win = { basecraft: BasecraftApi };

const doc = (page: Page) => page.locator('section[role=tabpanel]:not([hidden])');
const cell = (page: Page, col: number, row: number) => doc(page).getByTestId(`glide-cell-${col + 1}-${row}`);
const montants = (page: Page) => page.evaluate(() => (window as unknown as Win).basecraft.rows.page('Commandes', { offset: 0, limit: 100 })
  .then((p) => p.rows.map((r) => r.values[2])));
async function type(page: Page, id: string, text: string) {
  await doc(page).getByTestId(id).fill(text);
  await doc(page).getByTestId(id).press('Tab');
}
/** A new query in SQL view, its text typed. */
async function sqlQuery(page: Page, sql: string) {
  await page.getByTestId('ribbon-tab-create').click();
  await page.getByTestId('cmd-createSqlQuery').click();
  await doc(page).getByTestId('query-sql').fill(sql);
}

test('Update query from the grid: Run asks to confirm the rows (No by default), Yes writes through the write layer', async () => {
  const { app, page } = await launchApp({ args: [seedSalesE2E('action-maj')], env: FR });
  try {
    await page.getByTestId('ribbon-tab-create').click();
    await page.getByTestId('cmd-createQueryDesign').click();
    await page.getByTestId('show-table-Commandes').check();
    await page.getByTestId('show-table-add').click();
    await page.getByTestId('show-table-close').click();
    await doc(page).getByTestId('qbe-field-Commandes-Montant').dblclick();
    await doc(page).getByTestId('qbe-field-Commandes-Client').dblclick();
    await page.getByTestId('cmd-updateQuery').click();
    await type(page, 'qbe-cell-updateTo-0', '[Montant]*2');
    await type(page, 'qbe-cell-criteria0-1', '2');
    await expect(page.getByTestId('cmd-runQuery')).toBeEnabled();
    await page.getByTestId('cmd-runQuery').click();
    await expect(page.getByTestId('modal')).toContainText('2 lignes');
    await expect(page.getByTestId('modal-btn-no')).toBeFocused();
    await page.getByTestId('modal-btn-yes').click();
    await expect(page.getByTestId('modal')).toHaveCount(0);
    await expect.poll(() => montants(page)).toEqual([10.1, 0.1, 0.4, 99.99, 0.2]);
    await page.getByTestId('nav-item-Commandes').dblclick();
    await expect(cell(page, 2, 2)).toHaveText('0,4');
    await expect(cell(page, 2, 4)).toHaveText('0,2');
  } finally {
    await app.close();
  }
});

test('Delete query refused by a related table; Make-Table twice asks to replace the table', async () => {
  const { app, page } = await launchApp({ args: [seedSalesE2E('action-sup')], env: FR });
  try {
    await sqlQuery(page, 'DELETE * FROM Clients WHERE Ville = "Paris"');
    await page.getByTestId('cmd-runQuery').click();
    await expect(page.getByTestId('modal')).toContainText('1 ligne');
    await page.getByTestId('modal-btn-yes').click();
    await expect(page.getByTestId('modal')).toContainText(fr.query.action.related.replace('{{table}}', 'Commandes'));
    await page.getByTestId('modal-btn-ok').click();
    expect(await page.evaluate(() => (window as unknown as Win).basecraft.rows.count('Clients'))).toBe(4);

    await doc(page).getByTestId('query-sql').fill('SELECT Client, Sum(Montant) AS Total INTO Totaux FROM Commandes GROUP BY Client');
    for (const replace of [false, true]) {
      await page.getByTestId('cmd-runQuery').click();
      await expect(page.getByTestId('modal')).toContainText('3 lignes');
      await page.getByTestId('modal-btn-yes').click();
      if (replace) {
        await expect(page.getByTestId('modal')).toContainText(fr.query.action.replace.replace('{{table}}', 'Totaux'));
        await page.getByTestId('modal-btn-yes').click();
      }
      await expect(page.getByTestId('modal')).toHaveCount(0);
      await expect(page.getByTestId('nav-item-Totaux')).toBeVisible();
    }
    expect(await page.evaluate(() => (window as unknown as Win).basecraft.rows.count('Totaux'))).toBe(3);
  } finally {
    await app.close();
  }
});

test('Navigation Pane: Open on an action query asks to confirm; No changes nothing and leaves no tab', async () => {
  const base = seedBase('action-menu', (db) => {
    seedSales(db);
    seedSalesRelation(db);
    saveObject(db, 'query', 'QDouble', { formatVersion: '1.0', sql: 'UPDATE Commandes SET Montant = Montant * 2 WHERE Client = 2;' }, null);
  });
  const { app, page } = await launchApp({ args: [base], env: FR });
  try {
    await expect(page.getByTestId('nav-item-query-QDouble')).toBeVisible();
    await page.getByTestId('nav-item-query-QDouble').click({ button: 'right' });
    await page.getByTestId('nav-menu-open').click();
    await expect(page.getByTestId('modal')).toContainText(fr.query.action.confirm_update_other.replace('{{count}}', '2'));
    await page.getByTestId('modal-btn-no').click();
    await expect(page.getByTestId('modal')).toHaveCount(0);
    await expect(page.getByTestId('doc-tab-query-QDouble')).toHaveCount(0);
    expect(await montants(page)).toEqual([10.1, 0.1, 0.2, 99.99, 0.1]);
    // a double-click runs it too: Yes writes
    await page.getByTestId('nav-item-query-QDouble').dblclick();
    await page.getByTestId('modal-btn-yes').click();
    await expect(page.getByTestId('doc-tab-query-QDouble')).toHaveCount(0);
    await expect.poll(() => montants(page)).toEqual([10.1, 0.1, 0.4, 99.99, 0.2]);
  } finally {
    await app.close();
  }
});

test('a record being edited in the target table: the action query is refused (table in use), nothing written; saved, the query runs', async () => {
  const { app, page } = await launchApp({ args: [seedSalesE2E('action-verrou')], env: FR });
  const clients = () => page.evaluate(() => (window as unknown as Win).basecraft.rows.page('Clients', { offset: 0, limit: 100 })
    .then((p) => p.rows.map((r) => r.values)));
  try {
    await page.getByTestId('nav-item-Clients').dblclick();
    const b = (await doc(page).getByTestId('data-grid-canvas').boundingBox())!;
    await page.mouse.click(b.x + 44 + 80 + 30, b.y + 34 + 15); // Nom of the first row (row selector 44, N° 80, header 34)
    await expect(doc(page).getByTestId('datasheet').locator('td[role=gridcell]:focus')).toHaveCount(1);
    await page.keyboard.press('D');
    await page.keyboard.type('upond');
    await page.keyboard.press('Tab'); // still on the row: pending
    await expect(page.getByTestId('doc-tab-Clients')).toContainText('•');

    await sqlQuery(page, 'UPDATE Clients SET Nom = "Durand" WHERE [N°] = 1');
    await page.getByTestId('cmd-runQuery').click();
    await expect(page.getByTestId('modal')).toContainText(fr.query.action.inUse.replace('{{table}}', 'Clients'));
    await page.getByTestId('modal-btn-ok').click();
    await expect(page.getByTestId('modal')).toHaveCount(0);
    expect((await clients())[0]).toEqual([1, 'Dupont', 'Lyon']);

    await page.getByTestId('doc-tab-Clients').click();
    await page.keyboard.press('Control+s');
    await expect(page.getByTestId('doc-tab-Clients')).not.toContainText('•');
    expect((await clients())[0]).toEqual([1, 'Dupond', 'Lyon']);
    await page.getByTestId('doc-tab-query-Requête1').click();
    await page.getByTestId('cmd-runQuery').click();
    await expect(page.getByTestId('modal')).toContainText('1 ligne');
    await page.getByTestId('modal-btn-yes').click();
    await expect(page.getByTestId('modal')).toHaveCount(0);
    await expect.poll(async () => (await clients())[0]).toEqual([1, 'Durand', 'Lyon']);
  } finally {
    await app.close();
  }
});

test('read-only base: Run on an action query in Design view says at once the base is read-only, nothing written', async () => {
  const base = seedBase('action-lecture', (db) => {
    seedSales(db);
    saveObject(db, 'query', 'QDouble', { formatVersion: '1.0', sql: 'UPDATE Commandes SET Montant = Montant * 2 WHERE Client = 2;' }, null);
  });
  const a = await launchApp({ args: [base], env: FR });
  const { app, page } = await launchApp({ args: [base], env: FR });
  try {
    await expect(page.getByTestId('banner-readonly')).toBeVisible();
    await page.getByTestId('nav-item-query-QDouble').click({ button: 'right' });
    await page.getByTestId('nav-menu-design').click();
    await expect(page.getByTestId('cmd-runQuery')).toBeEnabled();
    await page.getByTestId('cmd-runQuery').click();
    await expect(page.getByTestId('modal')).toContainText(fr.dialog.op.readOnly); // no count asked first
    await expect(page.getByTestId('modal-btn-yes')).toHaveCount(0);
    await page.getByTestId('modal-btn-ok').click();
    expect(await montants(page)).toEqual([10.1, 0.1, 0.2, 99.99, 0.1]);
  } finally {
    await app.close();
    await a.app.close();
  }
});
