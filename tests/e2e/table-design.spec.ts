import { test, expect, type ElectronApplication, type Page } from '@playwright/test';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createTable } from '../../src/main/db/schema';
import { clients } from '../../src/shared/test-fixtures';
import { launchApp, seedBase } from './helpers';

const fr = JSON.parse(readFileSync(join(__dirname, '../../src/shared/i18n/fr.json'), 'utf8'));
const FR = { BASECRAFT_REGION: 'fr-FR' };

async function newBase(page: Page) {
  await page.getByTestId('bs-new').click();
  await expect(page.getByTestId('nav-pane')).toBeVisible();
  await page.getByTestId('ribbon-tab-create').click();
  await page.getByTestId('cmd-createTableDesign').click();
  await expect(page.getByTestId('doc-tab-Table1')).toBeVisible();
}

/** Spies on a main-process IPC handler (the bridge object is frozen, so the renderer side cannot be spied on): records
 *  the arguments of each call; the next `fail` calls get a missing table name instead, so they reject. Returns a reader. */
async function spyIpc(app: ElectronApplication, channel: string, fail = 0): Promise<() => Promise<unknown[][]>> {
  expect(await app.evaluate(({ ipcMain }, [ch, f]) => {
    const handlers = (ipcMain as any)._invokeHandlers as Map<string, (...a: unknown[]) => unknown> | undefined;
    const orig = handlers?.get(ch);
    if (!handlers || !orig) return false;
    const g = globalThis as any;
    g.spied = { ...g.spied, [ch]: [] };
    let left = f;
    handlers.set(ch, (e: unknown, ...args: unknown[]) => {
      g.spied[ch].push(args);
      return left-- > 0 ? orig(e, 'bc_absente') : orig(e, ...args);
    });
    return true;
  }, [channel, fail] as const)).toBe(true);
  return () => app.evaluate((_e, ch) => (globalThis as any).spied[ch] as unknown[][], channel);
}

async function openDesign(page: Page, table: string) {
  await page.getByTestId(`nav-item-${table}`).click({ button: 'right' });
  await page.getByTestId('nav-menu-design').click();
}

const savePath = () =>({ ...FR, BASECRAFT_E2E_SAVE_PATH: join(mkdtempSync(join(tmpdir(), 'basecraft-design-')), 'Conception.basecraft') });

test('design, save with prompt, reopen, lossy change asks confirmation', async () => {
  const { app, page } = await launchApp({ env: savePath() });
  try {
    await newBase(page);
    await page.getByTestId('design-row-0-name').fill('Nom');
    await expect(page.getByTestId('design-row-0-type')).toHaveValue('shortText');
    await page.getByTestId('prop-size').fill('50');
    await page.getByTestId('design-row-1-name').fill('Solde');
    await page.getByTestId('design-row-1-type').selectOption('currency');
    await expect(page.getByTestId('prop-size')).toHaveCount(0); // only the properties of the type
    await expect(page.getByTestId('prop-decimalPlaces')).toBeVisible();
    await page.getByTestId('prop-format').fill(fr.format.fixed); // a named format is stored by id and shown translated
    await expect(page.getByTestId('prop-format')).toHaveValue(fr.format.fixed);
    await expect(page.getByTestId('doc-tab-Table1')).toContainText('•'); // dirty

    await page.keyboard.press('Control+s');
    await expect(page.getByTestId('modal-input')).toHaveValue('Table1');
    await page.getByTestId('modal-input').fill('Clients');
    await page.getByTestId('modal-btn-ok').click();
    await expect(page.getByTestId('modal')).toContainText(fr.designer.noKeyTitle);
    await page.getByTestId('modal-btn-no').click();
    await expect(page.getByTestId('nav-item-Clients')).toBeVisible();
    await expect(page.getByTestId('doc-tab-Clients')).not.toContainText('•');
    await page.getByTestId('doc-tab-close-Clients').click();

    await page.getByTestId('nav-item-Clients').click({ button: 'right' });
    await page.getByTestId('nav-menu-design').click();
    await expect(page.getByTestId('design-row-0-name')).toHaveValue('Nom');
    await expect(page.getByTestId('prop-size')).toHaveValue('50');
    await expect(page.getByTestId('design-row-1-type')).toHaveValue('currency');

    expect(await page.evaluate(() => (window as any).basecraft.rows.insert('Clients', { Nom: 'Dupont', Solde: 12 }))).toMatchObject({ ok: true });
    await page.getByTestId('design-row-0-type').selectOption('number');
    await page.getByTestId('ribbon-tab-home').click();
    await page.getByTestId('cmd-save').click();
    await expect(page.getByTestId('modal')).toContainText(fr.designer.lossy_one.replace('{{count}}', '1'));
    // the save is in flight: nothing can be edited (an edit typed now would be lost)
    for (const id of ['design-row-0-name', 'design-row-0-type', 'design-row-2-name', 'prop-caption']) await expect(page.getByTestId(id)).toBeDisabled();
    await page.getByTestId('modal-btn-yes').click();
    await expect(page.getByTestId('modal')).toHaveCount(0);
    await expect(page.getByTestId('doc-tab-Clients')).not.toContainText('•');
    await expect(page.getByTestId('design-row-0-name')).toBeEnabled();
    expect(await page.evaluate(() => (window as any).basecraft.tables.design('Clients'))).toMatchObject({
      fields: [{ name: 'Nom', props: { type: 'number' } }, { name: 'Solde', props: { type: 'currency' } }],
    });
  } finally {
    await app.close();
  }
});

test('save without primary key offers one', async () => {
  const { app, page } = await launchApp({ env: savePath() });
  try {
    await newBase(page);
    await page.getByTestId('design-row-0-name').fill('Nom');
    await page.getByTestId('ribbon-tab-home').click();
    await page.getByTestId('cmd-save').click();
    await page.getByTestId('modal-input').fill('Contacts');
    await page.getByTestId('modal-btn-ok').click();
    await page.getByTestId('modal-btn-yes').click();
    await expect(page.getByTestId('nav-item-Contacts')).toBeVisible();
    await expect(page.getByTestId('design-row-0-name')).toHaveValue('N°');
    await expect(page.getByTestId('design-row-0-key')).toHaveAttribute('data-primary-key', 'true');
    await expect(page.getByTestId('design-row-0-type')).toHaveValue('autoNumber');
    await expect(page.getByTestId('prop-indexed')).toBeDisabled(); // an AutoNumber's index is fixed
    await expect(page.getByTestId('design-row-1-name')).toHaveValue('Nom');
  } finally {
    await app.close();
  }
});

test('keyboard: arrows change rows, Delete on a row selector deletes the field after confirmation, errors are listed', async () => {
  const base = seedBase('clavier', (db) => createTable(db, clients));
  const { app, page } = await launchApp({ args: [base], env: FR });
  try {
    await page.getByTestId('nav-item-Clients').click({ button: 'right' });
    await page.getByTestId('nav-menu-design').click();
    await page.getByTestId('design-row-1-name').focus();
    await page.keyboard.press('ArrowDown');
    await expect(page.getByTestId('design-row-2-name')).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(page.getByTestId('design-row-2-type')).toBeFocused();
    await page.keyboard.press('ArrowDown'); // the type does not change: the row does
    await expect(page.getByTestId('design-row-3-type')).toBeFocused();
    await expect(page.getByTestId('design-row-2-type')).toHaveValue('number');
    await expect(page.getByTestId('prop-numberSize')).toHaveCount(0); // row 3 is a Yes/No

    await page.getByTestId('design-row-5-key').click();
    await page.keyboard.press('Delete');
    await expect(page.getByTestId('modal')).toContainText('Email');
    await page.getByTestId('modal-btn-yes').click();
    await expect(page.getByTestId('design-row-5-name')).toHaveValue(''); // the empty row took its place

    await page.getByTestId('design-row-1-name').fill('Âge');
    await page.keyboard.press('Control+s');
    await expect(page.getByTestId('modal')).toContainText(`« Âge » : ${fr.designError.nameDuplicate}`);
  } finally {
    await app.close();
  }
});

test('read-only base: the designer cannot change or save anything', async () => {
  const base = seedBase('lecture', (db) => createTable(db, clients));
  const a = await launchApp({ args: [base] });
  const b = await launchApp({ args: [base], env: FR });
  try {
    const p = b.page;
    await expect(p.getByTestId('banner-readonly')).toBeVisible();
    await p.getByTestId('nav-item-Clients').click({ button: 'right' });
    await p.getByTestId('nav-menu-design').click();
    await expect(p.getByTestId('design-row-1-name')).toHaveValue('Nom');
    await expect(p.getByTestId('design-row-1-name')).toBeDisabled();
    await expect(p.getByTestId('design-row-1-type')).toBeDisabled();
    await expect(p.getByTestId('design-row-6-name')).toHaveCount(0); // no empty row to add a field
    await p.getByTestId('design-row-1-key').click();
    await expect(p.getByTestId('prop-size')).toBeDisabled();
    await p.keyboard.press('Delete');
    await expect(p.getByTestId('modal')).toHaveCount(0);
    for (const id of ['primaryKey', 'insertRows', 'deleteRows']) await expect(p.getByTestId(`cmd-${id}`)).toBeDisabled();

    // Ctrl+S must not reach tables.save
    const saves = await spyIpc(b.app, 'bc:tables:save');
    await p.keyboard.press('Control+s');
    await p.getByTestId('cmd-viewDatasheet').click(); // a command that runs: Ctrl+S had its chance to act first
    await expect(p.getByTestId('status-mode')).toHaveText(fr.status.mode.datasheet);
    expect(await saves()).toHaveLength(0);
    await expect(p.getByTestId('modal')).toHaveCount(0);
  } finally {
    await a.app.close();
    await b.app.close();
  }
});

for (const rename of [true, false]) {
  test(`after a save whose reload fails, a second save keeps the ${rename ? 'renamed and ' : ''}swapped fields`, async () => {
    const base = seedBase('echange', (db) => createTable(db, clients));
    const { app, page } = await launchApp({ args: [base], env: FR });
    try {
      expect(await page.evaluate(() => (window as any).basecraft.rows.insert('Clients', { Nom: 'Dupont', Email: 'd@x.fr', Actif: true }))).toMatchObject({ ok: true });
      await openDesign(page, 'Clients');
      await page.getByTestId('design-row-1-name').fill('Email'); // swap Nom and Email
      await page.getByTestId('design-row-5-name').fill('Nom');
      if (rename) await page.getByTestId('design-row-3-name').fill('Active');
      const saves = await spyIpc(app, 'bc:tables:save');
      const designs = await spyIpc(app, 'bc:tables:design', 1); // the reload after the first save fails
      await page.keyboard.press('Control+s');
      await expect(page.getByTestId('modal')).toContainText('bc_absente');
      await page.getByTestId('modal-btn-ok').click();
      await expect(page.getByTestId('doc-tab-Clients')).not.toContainText('•');
      await page.keyboard.press('Control+s'); // each field now maps to itself
      await expect.poll(async () => (await saves()).length).toBe(2);
      await expect.poll(async () => (await designs()).length).toBe(2); // reloaded: the second save succeeded
      await expect(page.getByTestId('modal')).toHaveCount(0);
      const d = await page.evaluate(() => (window as any).basecraft.tables.design('Clients'));
      expect(d.fields.map((x: { name: string }) => x.name)).toEqual(['N°', 'Email', 'Âge', rename ? 'Active' : 'Actif', 'Solde', 'Nom']);
      const { rows } = await page.evaluate(() => (window as any).basecraft.rows.page('Clients', { offset: 0, limit: 10 }));
      expect([rows[0].values[1], rows[0].values[3], rows[0].values[5]]).toEqual(['Dupont', 1, 'd@x.fr']); // swapped once
    } finally {
      await app.close();
    }
  });
}

test('answering No to the data-loss question changes nothing and does not retry', async () => {
  const base = seedBase('perte', (db) => createTable(db, clients));
  const { app, page } = await launchApp({ args: [base], env: FR });
  try {
    expect(await page.evaluate(() => (window as any).basecraft.rows.insert('Clients', { Nom: 'Dupont', Email: 'd@x.fr' }))).toMatchObject({ ok: true });
    await openDesign(page, 'Clients');
    await page.getByTestId('design-row-5-type').selectOption('number');
    const saves = await spyIpc(app, 'bc:tables:save');
    await page.keyboard.press('Control+s');
    await expect(page.getByTestId('modal')).toContainText(fr.designer.lossy_one.replace('{{count}}', '1'));
    await page.getByTestId('modal-btn-no').click();
    await expect(page.getByTestId('modal')).toHaveCount(0);
    const calls = await saves();
    expect(calls).toHaveLength(1);
    expect(calls[0][0]).toMatchObject({ allowDataLoss: false });
    expect(await page.evaluate(() => (window as any).basecraft.tables.design('Clients'))).toMatchObject({ fields: [{}, {}, {}, {}, {}, { name: 'Email', props: { type: 'shortText' } }] });
    await expect(page.getByTestId('design-row-5-type')).toHaveValue('number'); // the edit stays, to be fixed or saved later
    await expect(page.getByTestId('doc-tab-Clients')).toContainText('•');
  } finally {
    await app.close();
  }
});

test('changing mode from the navigation pane or the status bar requires saving a modified design first', async () => {
  const base = seedBase('mode', (db) => createTable(db, clients));
  const { app, page } = await launchApp({ args: [base], env: FR });
  try {
    await openDesign(page, 'Clients');
    await page.getByTestId('design-row-1-name').fill('Client');
    await page.getByTestId('nav-item-Clients').dblclick(); // opens in datasheet mode
    await expect(page.getByTestId('modal')).toContainText(fr.designer.mustSaveFirst.replace('{{name}}', 'Clients'));
    await expect(page.getByTestId('modal-btn-cancel')).toHaveCount(0);
    await page.getByTestId('modal-btn-no').click(); // No: stays in design, edits kept (Access)
    await expect(page.getByTestId('status-mode')).toHaveText(fr.status.mode.design);
    await expect(page.getByTestId('design-row-1-name')).toHaveValue('Client');
    await expect(page.getByTestId('doc-tab-Clients')).toContainText('•');

    await page.getByTestId('design-row-1-name').fill('Âge'); // a save that fails keeps the design
    await page.getByTestId('nav-item-Clients').dblclick();
    await page.getByTestId('modal-btn-yes').click();
    await expect(page.getByTestId('modal')).toContainText(fr.designError.nameDuplicate);
    await page.getByTestId('modal-btn-ok').click();
    await expect(page.getByTestId('status-mode')).toHaveText(fr.status.mode.design);
    await expect(page.getByTestId('design-row-1-name')).toHaveValue('Âge');

    await page.getByTestId('status-view-datasheet').click(); // Escape: stays too
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('status-mode')).toHaveText(fr.status.mode.design);
    await expect(page.getByTestId('design-row-1-name')).toHaveValue('Âge');

    await page.getByTestId('doc-tab-close-Clients').click(); // closing still offers to drop the edits
    await expect(page.getByTestId('modal')).toContainText(fr.designer.saveFirst.replace('{{name}}', 'Clients'));
    await page.getByTestId('modal-btn-no').click();
    await expect(page.getByTestId('doc-tab-Clients')).toHaveCount(0);
    await openDesign(page, 'Clients');
    await expect(page.getByTestId('design-row-1-name')).toHaveValue('Nom');

    await page.getByTestId('design-row-1-name').fill('Client'); // Yes: saved, then the datasheet
    await page.getByTestId('status-view-datasheet').click();
    await page.getByTestId('modal-btn-yes').click();
    await expect(page.getByTestId('status-mode')).toHaveText(fr.status.mode.datasheet);
    expect((await page.evaluate(() => (window as any).basecraft.tables.design('Clients'))).fields[1].name).toBe('Client');
  } finally {
    await app.close();
  }
});
