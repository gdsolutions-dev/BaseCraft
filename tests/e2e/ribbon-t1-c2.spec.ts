// T1 (Table Fields › Modify Lookups) and C2 (Home › Spelling).
import { test, expect, type Page } from '@playwright/test';
import { createTable } from '../../src/main/db/schema';
import { insertRow } from '../../src/main/db/write-layer';
import { localeInfo } from '../../src/shared/locale-format';
import { f, t } from '../../src/shared/test-fixtures';
import { colLeft, launchApp, seedBase } from './helpers';

const FR = { BASECRAFT_REGION: 'fr-FR' };
const HEADER = 34, ROW = 30;
const clients = t('Clients', [f('N°', 'autoNumber'), f('Nom', 'shortText'), f('Ville', 'shortText')]);
const villes = t('Villes', [f('N°', 'autoNumber'), f('Libellé', 'shortText')]);
const design = (page: Page) => page.evaluate(() => (window as any).basecraft.tables.design('Clients'));
const lookup = async (page: Page) => (await design(page)).fields[2].props.lookup;
async function pick(page: Page, col: number) {
  const b = (await page.getByTestId('datasheet').getByTestId('data-grid-canvas').boundingBox())!;
  await page.mouse.click(b.x + colLeft(col) + 30, b.y + HEADER + ROW / 2);
}

test('Modify Lookups: a value list, then a table as the row source, then none', async () => {
  test.setTimeout(90_000);
  const base = await seedBase('t1-lookups', async (db) => {
    createTable(db, villes);
    createTable(db, clients);
    await insertRow(db, villes, { Libellé: 'Lyon' }, localeInfo('fr-FR'));
    await insertRow(db, clients, { Nom: 'Dupont', Ville: 'Strasbourg' }, localeInfo('fr-FR'));
  });
  const { app, page } = await launchApp({ args: [base], env: FR });
  try {
    await page.getByTestId('nav-item-Clients').dblclick();
    await expect(page.getByTestId('datasheet')).toBeVisible();
    await page.getByTestId('ribbon-tab-tableFields').click();
    await expect(page.getByTestId('cmd-modifyLookups')).not.toHaveAttribute('data-planned', /.+/);
    await pick(page, 0);
    await expect(page.getByTestId('cmd-modifyLookups')).toBeDisabled();   // AutoNumber: no lookup
    await pick(page, 2);
    await page.getByTestId('cmd-modifyLookups').click();
    await page.getByTestId('lookup-kind').selectOption('values');
    await page.getByTestId('lookup-values').fill('Paris\nLyon\nStrasbourg');
    await page.getByTestId('lookup-limit').check();
    await page.getByTestId('lookup-ok').click();
    await expect.poll(() => lookup(page)).toMatchObject({ kind: 'values', values: ['Paris', 'Lyon', 'Strasbourg'], limitToList: true });

    await pick(page, 2);
    await page.getByTestId('cmd-modifyLookups').click();
    await page.getByTestId('lookup-kind').selectOption('table');
    await page.getByTestId('lookup-source').fill('Villes');
    await page.getByTestId('lookup-ok').click();
    await expect.poll(() => lookup(page)).toMatchObject({ kind: 'table', table: 'Villes', boundColumn: 1, columnCount: 2, limitToList: true });
    // the datasheet reloaded with the lookup: the cell opens its list editor
    await expect(async () => {   // the reload may still be under way: the first click can be undone by it
      await pick(page, 2);
      await page.keyboard.press('F2');
      await expect(page.getByTestId('lookup-editor')).toBeVisible({ timeout: 1000 });
    }).toPass({ timeout: 15_000 });
    await page.keyboard.press('Escape');

    await pick(page, 2);
    await page.getByTestId('cmd-modifyLookups').click();
    await page.getByTestId('lookup-kind').selectOption('none');
    await page.getByTestId('lookup-ok').click();
    await expect.poll(() => lookup(page)).toBeUndefined();
  } finally {
    await app.close();
  }
});

const spellBase = () => seedBase('c2-spelling', async (db) => {
  createTable(db, clients);
  await insertRow(db, clients, { Nom: 'bonjour', Ville: 'une phrse erronnée avec phrse' }, localeInfo('fr-FR'));
  await insertRow(db, clients, { Nom: 'bonjour', Ville: 'zzqxk' }, localeInfo('fr-FR'));
});
const cities = async (page: Page) => (await page.evaluate(() => (window as any).basecraft.rows.page('Clients', { offset: 0, limit: 10 }))).rows.map((r: { values: unknown[] }) => r.values[2]);

// A fake checker (--bc-e2e-misspelled): Chromium's dictionary is a download (or the OS's), not a given of the test machine.
test('Spelling: stops on each misspelled word; Change All writes the cells, Ignore All lasts for one check, Cancel stops', async () => {
  test.setTimeout(90_000);
  const { app, page } = await launchApp({ args: [await spellBase()], env: { ...FR, BASECRAFT_E2E_MISSPELLED: 'phrse=phrase,zzqxk=zzqxk' } });
  try {
    await page.getByTestId('nav-item-Clients').dblclick();
    await expect(page.getByTestId('datasheet')).toBeVisible();
    await pick(page, 0);   // the first cell: the check starts there
    await page.getByTestId('ribbon-tab-home').click();
    await expect(page.getByTestId('cmd-spelling')).not.toHaveAttribute('data-planned', /.+/);
    await page.getByTestId('cmd-spelling').click();
    const word = page.getByTestId('spell-word');
    await expect(word).toHaveText('phrse');
    await expect(page.getByTestId('spell-change-to')).toHaveValue('phrase');   // the first suggestion
    await page.screenshot({ path: test.info().outputPath('spelling-dialog.png') });
    await page.getByTestId('spell-change-all').click();   // both occurrences of the cell
    await expect(word).toHaveText('zzqxk');
    await page.getByTestId('spell-ignore-all').click();
    await expect(page.getByTestId('modal')).toContainText('La vérification orthographique est terminée');
    await page.getByTestId('modal-btn-ok').click();
    await expect.poll(() => cities(page)).toEqual(['une phrase erronnée avec phrase', 'zzqxk']);
    // a new check asks again about zzqxk (Ignore All was for the first one); Cancel ends it without the closing message
    await pick(page, 0);
    await page.getByTestId('cmd-spelling').click();
    await expect(word).toHaveText('zzqxk');
    await page.getByTestId('spell-cancel').click();
    await expect(page.getByTestId('modal')).toHaveCount(0);
  } finally {
    await app.close();
  }
});

test('Spelling with the real checker: it finds the words, or says that no dictionary is available', async () => {
  test.setTimeout(120_000);
  const { app, page } = await launchApp({ args: [await spellBase()], env: FR });
  try {
    await page.getByTestId('nav-item-Clients').dblclick();
    await expect(page.getByTestId('datasheet')).toBeVisible();
    await pick(page, 0);
    await page.getByTestId('ribbon-tab-home').click();
    await page.getByTestId('cmd-spelling').click();
    const word = page.getByTestId('spell-word'), modal = page.getByTestId('modal');
    await expect(word.or(modal.filter({ hasNot: word }))).toBeVisible({ timeout: 30_000 });   // the Spelling dialog is a modal too
    if (await word.isVisible()) await expect(word).toHaveText('phrse');
    else {
      await expect(modal).toContainText('dictionnaire');
      test.info().annotations.push({ type: 'dictionary', description: 'not available here: the unavailable message was asserted' });
    }
  } finally {
    await app.close();
  }
});
