// O3 Task 2: File › Options — « Concepteurs d'objets » and « Paramètres du client » › « Impression » (four margins).
// Each change is written at once; a refused entry shows one error dialog, sends nothing and gives back the stored value.
import { test, expect, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { launchApp } from './helpers';

const FR = { BASECRAFT_REGION: 'fr-FR' };
const settingsFile = (dir: string) => { try { return JSON.parse(readFileSync(join(dir, 'settings.json'), 'utf8')); } catch { return {}; } };   // absent until the first write
const cats = (page: Page) => page.locator('[data-testid^="opt-cat-"]').evaluateAll((els) => els.map((e) => e.getAttribute('data-testid')));
const MARGINS = ['left', 'right', 'top', 'bottom'];

/** Enter a bad value: one dialog, the stored value back (never NaN), no second dialog after OK. */
async function refused(page: Page, testid: string, bad: string, back: string) {
  const f = page.getByTestId(testid);
  await f.fill(bad);
  await f.press('Enter');
  await expect(page.getByTestId('modal')).toBeVisible();
  await expect(f).not.toHaveValue(/NaN/);
  await expect(f).toHaveValue(back);
  await page.getByTestId('modal-btn-ok').click();
  await page.waitForTimeout(300);
  await expect(page.getByTestId('modal')).toHaveCount(0);
  await expect(f).toHaveValue(back);
}

test('defaults, every change written at once and kept after a relaunch', async () => {
  const { app, page, userDataDir } = await launchApp({ env: FR });
  let again: Awaited<ReturnType<typeof launchApp>> | undefined;
  try {
    await page.getByTestId('bs-options').click();
    expect(await cats(page)).toEqual(['opt-cat-general', 'opt-cat-datasheet', 'opt-cat-designers', 'opt-cat-client']);
    await expect(page.getByTestId('opt-cat-designers')).toHaveText("Concepteurs d'objets");
    await page.getByTestId('opt-cat-designers').click();
    await expect(page.getByTestId('opt-panel')).toContainText('Modifiez les paramètres par défaut de création des objets de base de données.');
    await expect(page.getByTestId('opt-sheet-font')).toHaveValue('8');
    await expect(page.getByTestId('opt-field-type').locator('option:checked')).toHaveText('Texte court');
    await expect(page.getByTestId('opt-field-type').locator('option')).not.toContainText(['NuméroAuto']);
    await expect(page.getByTestId('opt-text-size')).toHaveValue('255');
    await expect(page.getByTestId('opt-number-size').locator('option:checked')).toHaveText('Entier long');
    await expect(page.getByTestId('opt-autoindex')).toHaveValue('N°;clé;code;num');
    await expect(page.getByTestId('opt-table-names')).toBeChecked();
    await expect(page.getByTestId('opt-output-all')).not.toBeChecked();
    await expect(page.getByTestId('opt-autojoin')).toBeChecked();
    await expect(page.getByTestId('opt-query-font')).toHaveValue('Segoe UI');
    await expect(page.getByTestId('opt-query-size')).toHaveValue('8');
    await expect(page.getByTestId('opt-select-partial')).toBeChecked();
    await expect(page.getByTestId('opt-select-full')).not.toBeChecked();
    // an untouched focus/blur on the default list does not store it
    await page.getByTestId('opt-autoindex').focus();
    await page.getByTestId('opt-text-size').focus();
    await page.waitForTimeout(200);
    expect(settingsFile(userDataDir).autoIndex ?? null).toBeNull();
    await page.getByTestId('opt-cat-client').click();
    for (const m of MARGINS) await expect(page.getByTestId(`opt-margin-${m}`)).toHaveValue('0,635 cm');

    // change every one
    await page.getByTestId('opt-cat-designers').click();
    await page.getByTestId('opt-sheet-font').selectOption('12');
    await page.getByTestId('opt-field-type').selectOption({ label: 'Nombre' });
    await page.getByTestId('opt-text-size').fill('50');
    await page.getByTestId('opt-text-size').press('Enter');
    await page.getByTestId('opt-number-size').selectOption({ label: 'Entier' });
    await page.getByTestId('opt-autoindex').fill('ID;code');
    await page.getByTestId('opt-autoindex').press('Enter');
    await page.getByTestId('opt-table-names').uncheck();
    await page.getByTestId('opt-output-all').check();
    await page.getByTestId('opt-autojoin').uncheck();
    await page.getByTestId('opt-query-font').fill('Liberation Serif');
    await page.getByTestId('opt-query-font').press('Enter');
    await page.getByTestId('opt-query-size').fill('12');
    await page.getByTestId('opt-query-size').press('Enter');
    await page.getByTestId('opt-select-full').check();
    await expect.poll(() => settingsFile(userDataDir)).toMatchObject({
      propertySheetFontSize: 12, defaultFieldType: 'number', defaultTextSize: 50, defaultNumberSize: 'integer', autoIndex: 'ID;code',
      showTableNames: false, outputAllFields: true, autoJoin: false, queryFontName: 'Liberation Serif', queryFontSize: 12, selectionBehavior: 'full',
    });

    // refusals: one dialog, nothing sent, the stored value back
    await refused(page, 'opt-text-size', '256', '50');
    await refused(page, 'opt-query-size', '0', '12');
    for (const bad of ['a"b', 'a\\b', 'a;b']) await refused(page, 'opt-query-font', bad, 'Liberation Serif');
    expect(settingsFile(userDataDir)).toMatchObject({ defaultTextSize: 50, queryFontName: 'Liberation Serif', queryFontSize: 12 });
    await page.getByTestId('opt-autoindex').fill('x'.repeat(256));
    await expect(page.getByTestId('opt-autoindex')).toHaveValue('x'.repeat(256));
    await page.getByTestId('opt-autoindex').press('Enter');
    await expect(page.getByTestId('modal')).toBeVisible();
    await expect(page.getByTestId('opt-autoindex')).toHaveValue('ID;code');
    await page.getByTestId('modal-btn-ok').click();
    await page.waitForTimeout(300);
    await expect(page.getByTestId('modal')).toHaveCount(0);

    // margins
    await page.getByTestId('opt-cat-client').click();
    await page.getByTestId('opt-margin-left').fill('2');
    await page.getByTestId('opt-margin-left').press('Enter');
    await expect(page.getByTestId('opt-margin-left')).toHaveValue('2,000 cm');
    await expect.poll(() => settingsFile(userDataDir).printMarginLeft).toBe(1134);
    await refused(page, 'opt-margin-top', '11', '0,635 cm');
    await refused(page, 'opt-margin-top', 'abc', '0,635 cm');
    await refused(page, 'opt-margin-top', '-1', '0,635 cm');
    // « 0.635 » in fr-FR: read as the region parses it (or refused), never stored wrong
    await page.getByTestId('opt-margin-right').fill('0.635');
    await page.getByTestId('opt-margin-right').press('Enter');
    await page.waitForTimeout(300);
    if (await page.getByTestId('modal').count()) await page.getByTestId('modal-btn-ok').click();
    const right = settingsFile(userDataDir).printMarginRight as number;
    expect(right).toBe(360);   // 0.635 is read as 0,635 cm or refused: never stored as anything else
    await expect(page.getByTestId('opt-margin-right')).toHaveValue('0,635 cm');
    expect(settingsFile(userDataDir)).toMatchObject({ printMarginTop: 360, printMarginBottom: 360 });

    await app.close();
    again = await launchApp({ env: FR, userDataDir });
    const p2 = again.page;
    await p2.getByTestId('bs-options').click();
    await p2.getByTestId('opt-cat-designers').click();
    await expect(p2.getByTestId('opt-sheet-font')).toHaveValue('12');
    await expect(p2.getByTestId('opt-field-type').locator('option:checked')).toHaveText('Nombre');
    await expect(p2.getByTestId('opt-text-size')).toHaveValue('50');
    await expect(p2.getByTestId('opt-number-size').locator('option:checked')).toHaveText('Entier');
    await expect(p2.getByTestId('opt-autoindex')).toHaveValue('ID;code');
    await expect(p2.getByTestId('opt-table-names')).not.toBeChecked();
    await expect(p2.getByTestId('opt-output-all')).toBeChecked();
    await expect(p2.getByTestId('opt-autojoin')).not.toBeChecked();
    await expect(p2.getByTestId('opt-query-font')).toHaveValue('Liberation Serif');
    await expect(p2.getByTestId('opt-query-size')).toHaveValue('12');
    await expect(p2.getByTestId('opt-select-full')).toBeChecked();
    await p2.getByTestId('opt-cat-client').click();
    await expect(p2.getByTestId('opt-margin-left')).toHaveValue('2,000 cm');
    expect(settingsFile(userDataDir)).toMatchObject({ printMarginLeft: 1134, autoIndex: 'ID;code' });
  } finally {
    await again?.app.close();
    await app.close().catch(() => undefined);
  }
});

test('an emptied AutoIndex list is stored empty and stays empty', async () => {
  const { app, page, userDataDir } = await launchApp({ env: FR });
  let again: Awaited<ReturnType<typeof launchApp>> | undefined;
  try {
    await page.getByTestId('bs-options').click();
    await page.getByTestId('opt-cat-designers').click();
    await page.getByTestId('opt-autoindex').fill('');
    await page.getByTestId('opt-autoindex').press('Enter');
    await expect.poll(() => settingsFile(userDataDir).autoIndex).toBe('');
    await app.close();
    again = await launchApp({ env: FR, userDataDir });
    await again.page.getByTestId('bs-options').click();
    await again.page.getByTestId('opt-cat-designers').click();
    await expect(again.page.getByTestId('opt-autoindex')).toHaveValue('');
  } finally {
    await again?.app.close();
    await app.close().catch(() => undefined);
  }
});

test('Runtime: no « Concepteurs d\'objets », no « Impression »', async () => {
  const { app, page } = await launchApp({ env: FR, runtime: true });
  try {
    await page.getByTestId('bs-options').click();
    expect(await cats(page)).toEqual(['opt-cat-general', 'opt-cat-datasheet', 'opt-cat-client']);
    await page.getByTestId('opt-cat-client').click();
    await expect(page.getByTestId('opt-recent-count')).toBeVisible();
    await expect(page.getByTestId('opt-margin-left')).toHaveCount(0);
    await expect(page.getByTestId('opt-panel')).not.toContainText('Impression');
  } finally {
    await app.close();
  }
});

test('keyboard: ArrowDown on the category list reaches « Concepteurs d\'objets »', async () => {
  const { app, page } = await launchApp({ env: FR });
  try {
    await page.getByTestId('bs-options').click();
    await page.getByTestId('opt-cat-datasheet').click();
    await page.keyboard.press('ArrowDown');
    await expect(page.getByTestId('opt-cat-designers')).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByTestId('opt-cat-designers')).toBeFocused();
    await expect(page.getByTestId('opt-sheet-font')).toBeVisible();
  } finally {
    await app.close();
  }
});
