// O2 Task 2: File › Options — « Paramètres du client » › Édition and Générales (four-digit year), the « Feuille de données » category,
// « Base de données active » (truncated numbers, filter lists). Each change is written at once; the base's own go to bc_meta.
import { test, expect, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { BasecraftApi } from '../../src/shared/api';
import { launchApp, openDbOptions, seedBase } from './helpers';

const FR = { BASECRAFT_REGION: 'fr-FR' };
type W = { basecraft: BasecraftApi };
const startup = (page: Page) => page.evaluate(() => (window as unknown as W).basecraft.base.startup());
const settingsFile = (dir: string) => JSON.parse(readFileSync(join(dir, 'settings.json'), 'utf8'));
const cats = (page: Page) => page.locator('[data-testid^="opt-cat-"]').evaluateAll((els) => els.map((e) => e.getAttribute('data-testid')));

test('no base: defaults, every change written at once and kept after a relaunch', async () => {
  const { app, page, userDataDir } = await launchApp({ env: FR });
  let again: Awaited<ReturnType<typeof launchApp>> | undefined;
  try {
    await page.getByTestId('bs-options').click();
    expect(await cats(page)).toEqual(['opt-cat-general', 'opt-cat-datasheet', 'opt-cat-designers', 'opt-cat-client']);
    await expect(page.getByTestId('opt-cat-datasheet')).toHaveText('Feuille de données');

    // the datasheet defaults
    await page.getByTestId('opt-cat-datasheet').click();
    await expect(page.getByTestId('opt-panel')).toContainText("Personnalisez l'apparence des feuilles de données dans BaseCraft.");
    await expect(page.getByTestId('opt-grid-h')).toBeChecked();
    await expect(page.getByTestId('opt-grid-v')).toBeChecked();
    await expect(page.getByTestId('opt-col-width')).toHaveValue('2,50 cm');
    await expect(page.getByTestId('opt-font-size')).toHaveValue('11');
    await expect(page.getByTestId('opt-font-weight').locator('option:checked')).toHaveText('Standard');
    await expect(page.getByTestId('opt-font-underline')).not.toBeChecked();
    await expect(page.getByTestId('opt-font-italic')).not.toBeChecked();

    // the client defaults
    await page.getByTestId('opt-cat-client').click();
    for (const id of ['enter-nextField', 'entry-selectAll', 'arrows-nextField', 'cont-none', 'find-fast']) await expect(page.getByTestId(`opt-${id}`)).toBeChecked();
    await expect(page.getByTestId('opt-cursor-stop')).not.toBeChecked();
    await expect(page.getByTestId('opt-year4-db')).toBeDisabled();
    await expect(page.getByTestId('opt-year4-db')).not.toBeChecked();
    await expect(page.getByTestId('opt-year4-all')).not.toBeChecked();

    // change every one
    for (const id of ['enter-nextRecord', 'entry-end', 'arrows-nextCharacter', 'cont-upDown', 'find-general']) await page.getByTestId(`opt-${id}`).check();
    await page.getByTestId('opt-cursor-stop').check();
    await page.getByTestId('opt-year4-all').check();
    await page.getByTestId('opt-cat-datasheet').click();
    await page.getByTestId('opt-grid-v').uncheck();
    await page.getByTestId('opt-col-width').fill('3,5');
    await page.getByTestId('opt-col-width').press('Enter');
    await expect(page.getByTestId('opt-col-width')).toHaveValue('3,50 cm');
    await expect.poll(() => settingsFile(userDataDir).columnWidth).toBe(1985);
    await page.getByTestId('opt-col-width').fill('abc');
    await page.getByTestId('opt-col-width').press('Enter');
    await expect(page.getByTestId('modal')).toBeVisible();
    await expect(page.getByTestId('opt-col-width')).not.toHaveValue(/NaN/);   // fix round 1: never « NaN cm », not even under the dialog
    await expect(page.getByTestId('opt-col-width')).toHaveValue('3,50 cm');
    await page.getByTestId('modal-btn-ok').click();
    await expect(page.getByTestId('modal')).toHaveCount(0);   // Enter then the dialog's blur: one dialog only
    await page.waitForTimeout(300);
    await expect(page.getByTestId('modal')).toHaveCount(0);
    await expect(page.getByTestId('opt-col-width')).toHaveValue('3,50 cm');
    await page.getByTestId('opt-font-size').fill('14');
    await page.getByTestId('opt-font-size').press('Enter');
    await page.getByTestId('opt-font-size').fill('128');   // at once: 14's write may still be in flight, the field must come back to 14   // a bad size: the same error dialog as a bad width
    await page.getByTestId('opt-font-size').press('Enter');
    await expect(page.getByTestId('modal')).toBeVisible();
    await expect(page.getByTestId('opt-font-size')).toHaveValue('14');
    await page.getByTestId('modal-btn-ok').click();
    await page.waitForTimeout(300);
    await expect(page.getByTestId('modal')).toHaveCount(0);
    await page.getByTestId('opt-font-weight').selectOption({ label: 'Gras' });
    await page.getByTestId('opt-font-italic').check();
    const expected = {
      moveAfterEnter: 'nextRecord', enterFieldBehavior: 'end', arrowKeyBehavior: 'nextCharacter', continuousArrowKeys: 'upDown', cursorStopsAtEnds: true,
      findReplaceDefault: 'general', fourDigitYearAll: true, gridlinesHorizontal: true, gridlinesVertical: false, columnWidth: 1985,
      datasheetFontSize: 14, datasheetFontWeight: 700, datasheetFontItalic: true, datasheetFontUnderline: false,
    };
    await expect.poll(() => settingsFile(userDataDir)).toMatchObject(expected);

    await app.close();
    again = await launchApp({ env: FR, userDataDir });
    const p2 = again.page;
    await p2.getByTestId('bs-options').click();
    await p2.getByTestId('opt-cat-client').click();
    for (const id of ['enter-nextRecord', 'entry-end', 'arrows-nextCharacter', 'cont-upDown', 'find-general']) await expect(p2.getByTestId(`opt-${id}`)).toBeChecked();
    await expect(p2.getByTestId('opt-cursor-stop')).toBeChecked();
    await expect(p2.getByTestId('opt-year4-all')).toBeChecked();
    await p2.getByTestId('opt-cat-datasheet').click();
    await expect(p2.getByTestId('opt-grid-h')).toBeChecked();
    await expect(p2.getByTestId('opt-grid-v')).not.toBeChecked();
    await expect(p2.getByTestId('opt-col-width')).toHaveValue('3,50 cm');
    await expect(p2.getByTestId('opt-font-size')).toHaveValue('14');
    await expect(p2.getByTestId('opt-font-weight').locator('option:checked')).toHaveText('Gras');
    await expect(p2.getByTestId('opt-font-italic')).toBeChecked();
  } finally {
    await again?.app.close();
    await app.close().catch(() => undefined);
  }
});

test('a base open: truncated numbers, filter lists and « Cette base de données » go to the base', async () => {
  const path = seedBase('options-o2.basecraft');
  const { app, page } = await launchApp({ args: [path], env: FR });
  try {
    await page.getByTestId('ribbon-tab-file').click();
    await openDbOptions(page);
    expect(await cats(page)).toEqual(['opt-cat-general', 'opt-cat-currentDb', 'opt-cat-datasheet', 'opt-cat-designers', 'opt-cat-client']);
    await expect(page.getByTestId('opt-db-truncated')).toBeChecked();
    await expect(page.getByTestId('opt-db-list-indexed')).toBeChecked();
    await expect(page.getByTestId('opt-db-list-nonindexed')).toBeChecked();
    await expect(page.getByTestId('opt-db-list-max')).toHaveValue('1000');
    await expect(page.getByTestId('opt-db')).toContainText('Filtrer les options de recherche pour options-o2 Base de données');
    await page.getByTestId('opt-db-truncated').uncheck();
    await page.getByTestId('opt-db-list-max').fill('50');
    await page.getByTestId('opt-db-list-max').press('Enter');
    await expect.poll(async () => (await startup(page)).filterListMax).toBe(50);
    await page.getByTestId('opt-cat-client').click();
    await expect(page.getByTestId('opt-year4-db')).toBeEnabled();
    await page.getByTestId('opt-year4-db').check();
    await expect.poll(() => startup(page)).toMatchObject({ checkTruncatedNumbers: false, filterListMax: 50, fourDigitYear: true });
  } finally {
    await app.close();
  }
});

test('Runtime with a base: « Feuille de données » and the client settings, « Cette base de données » disabled and showing the base', async () => {
  const path = seedBase('options-o2-runtime.basecraft');
  const a = await launchApp({ args: [path], env: FR });
  try {   // the base's four-digit year, set from the full application
    await a.page.getByTestId('ribbon-tab-file').click();
    await a.page.getByTestId('bs-options').click();
    await a.page.getByTestId('opt-cat-client').click();
    await a.page.getByTestId('opt-year4-db').check();
    await expect.poll(() => startup(a.page)).toMatchObject({ fourDigitYear: true });
  } finally {
    await a.app.close();
  }
  const { app, page } = await launchApp({ args: [path], env: FR, runtime: true });
  try {
    await page.getByTestId('ribbon-tab-file').click();
    await page.getByTestId('bs-options').click();
    expect(await cats(page)).toEqual(['opt-cat-general', 'opt-cat-datasheet', 'opt-cat-client']);
    await page.getByTestId('opt-cat-client').click();
    await expect(page.getByTestId('opt-year4-db')).toBeDisabled();
    await expect(page.getByTestId('opt-year4-db')).toBeChecked();
  } finally {
    await app.close();
  }
});

test('keyboard: ArrowDown reaches « Feuille de données »; arrow keys move within a radio group', async () => {
  const { app, page } = await launchApp({ env: FR });
  try {
    await page.getByTestId('bs-options').click();
    await page.getByTestId('opt-cat-general').focus();
    await page.keyboard.press('ArrowDown');
    await expect(page.getByTestId('opt-cat-datasheet')).toBeFocused();
    await expect(page.getByTestId('opt-cat-datasheet')).toHaveAttribute('aria-selected', 'true');
    await page.keyboard.press('ArrowDown');
    await expect(page.getByTestId('opt-cat-designers')).toHaveAttribute('aria-selected', 'true');   // O3
    await page.keyboard.press('ArrowDown');
    await expect(page.getByTestId('opt-cat-client')).toHaveAttribute('aria-selected', 'true');
    for (const [first, second, third] of [['enter-nextField', 'enter-nextRecord', 'enter-none'], ['entry-selectAll', 'entry-start', 'entry-end'],
      ['arrows-nextField', 'arrows-nextCharacter', 'arrows-nextField'], ['cont-none', 'cont-upDown', 'cont-leftRight'], ['find-fast', 'find-general', 'find-startOfField']] as const) {
      await page.getByTestId(`opt-${first}`).focus();
      await page.keyboard.press('ArrowDown');
      await expect(page.getByTestId(`opt-${second}`)).toBeChecked();
      await page.keyboard.press('ArrowDown');
      await expect(page.getByTestId(`opt-${third}`)).toBeChecked();
    }
  } finally {
    await app.close();
  }
});

test('fix round 1: « Cette base de données » is disabled on a read-only base, and shows the value again at each opening', async () => {
  const path = seedBase('options-o2-ro.basecraft');
  const holder = await launchApp({ args: [path], env: FR });   // takes the lock
  try {
    await holder.page.getByTestId('ribbon-tab-file').click();
    await holder.page.getByTestId('bs-options').click();
    await holder.page.getByTestId('opt-cat-client').click();
    await holder.page.getByTestId('opt-year4-db').check();
    await expect.poll(() => startup(holder.page)).toMatchObject({ fourDigitYear: true });
    await holder.page.getByTestId('bs-back').click();   // the Backstage unmounts, the next opening reads the base again
    await holder.page.getByTestId('ribbon-tab-file').click();
    await holder.page.getByTestId('bs-options').click();
    await holder.page.getByTestId('opt-cat-client').click();
    await expect(holder.page.getByTestId('opt-year4-db')).toBeChecked();
    const { app, page } = await launchApp({ args: [path], env: FR });   // finds it held: read-only
    try {
      expect(await page.evaluate(() => (window as unknown as { basecraft: BasecraftApi }).basecraft.base.state())).toMatchObject({ readOnly: true });
      await page.getByTestId('ribbon-tab-file').click();
      await page.getByTestId('bs-options').click();
      await page.getByTestId('opt-cat-client').click();
      await expect(page.getByTestId('opt-year4-db')).toBeDisabled();
    } finally {
      await app.close();
    }
  } finally {
    await holder.app.close();
  }
});
