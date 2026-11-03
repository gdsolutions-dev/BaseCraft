// O3 Task 8: a new report (Create › Report, Blank Report / Report Design) stores the print margins of the Options (default 0,635 cm);
// an existing report keeps its own (1 cm here); Print Preview lays the page out with the stored margins.
import { test, expect, type Page } from '@playwright/test';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createTable } from '../../src/main/db/schema';
import { saveObject } from '../../src/main/db/objects';
import { defaultProps } from '../../src/shared/field-types';
import { launchApp, seedBase } from './helpers';

const FR = { BASECRAFT_REGION: 'fr-FR' };
const OLD = { formatVersion: '1.0', recordSource: null, props: { grouping: [], Width: 6994 },
  sections: [{ kind: 'detail', height: 1000, props: {}, controls: [] }] };
const seed = (name: string) => seedBase(name, (db) => {
  createTable(db, { name: 'Clients', fields: [{ name: 'Nom', props: defaultProps('shortText') }] });
  const ok = saveObject(db, 'report', 'EAncien', OLD, null);
  if (!ok.ok) throw new Error(ok.reason);
});
const cur = (page: Page) => page.locator('.doc:not([hidden])');
const userDir = (left?: number) => {
  const dir = mkdtempSync(join(tmpdir(), 'basecraft-'));
  if (left !== undefined) writeFileSync(join(dir, 'settings.json'), JSON.stringify({ printMarginLeft: left }));
  return dir;
};
async function margins(page: Page): Promise<string[]> {
  await page.getByTestId('cmd-pageSetupDialog').click();
  const v = await Promise.all(['left', 'top', 'right', 'bottom'].map((s) => page.getByTestId(`page-setup-margin-${s}`).inputValue()));
  await page.getByTestId('modal-btn-cancel').click();
  await expect(page.getByTestId('modal')).toHaveCount(0);
  return v;
}
/** Left edge of the first band of the shown Print Preview page, in twips (inline lengths are pt). */
const bandLeft = (page: Page) => cur(page).locator('.bc-page .bc-band').first().evaluate((b) => Math.round(parseFloat((b as HTMLElement).style.left) * 20));

test('defaults: Create > Report stores 0,635 cm; an existing report keeps 1 cm', async () => {
  const { app, page } = await launchApp({ args: [seed('marges-defaut')], env: FR });
  try {
    await page.getByTestId('nav-item-Clients').click();
    await page.getByTestId('ribbon-tab-create').click();
    await page.getByTestId('cmd-createReport').click();
    await expect(page.getByTestId('doc-tab-report-Clients')).toHaveAttribute('aria-selected', 'true');
    expect(await margins(page)).toEqual(['0,63', '0,63', '0,63', '0,63']);
    expect(await bandLeft(page)).toBe(360);
    await page.getByTestId('nav-item-report-EAncien').dblclick();
    await expect(page.getByTestId('doc-tab-report-EAncien')).toBeVisible();
    expect(await margins(page)).toEqual(['1', '1', '1', '1']);
  } finally {
    await app.close();
  }
});

test('left margin 2 cm in the Options: Report Design stores it, kept after save and reopen; Print Preview starts 2 cm in; EAncien untouched', async () => {
  test.setTimeout(120000);
  const base = seed('marges-2cm'), userDataDir = userDir(1134);
  let { app, page } = await launchApp({ args: [base], env: FR, userDataDir });
  try {
    await page.getByTestId('ribbon-tab-create').click();
    await page.getByTestId('cmd-createReportDesign').click();
    await expect(cur(page).getByTestId('designer')).toBeVisible();
    await page.getByTestId('ribbon-tab-pageSetup').click();
    expect(await margins(page)).toEqual(['2', '0,63', '0,63', '0,63']);
    await page.keyboard.press('Control+s');
    await page.getByTestId('modal-input').fill('ENeuf');
    await page.getByTestId('modal-btn-ok').click();
    await expect(page.getByTestId('doc-tab-report-ENeuf')).not.toContainText('•');
    await app.close();
    ({ app, page } = await launchApp({ args: [base], env: FR, userDataDir }));
    await page.getByTestId('nav-item-report-ENeuf').dblclick();
    await expect(page.getByTestId('doc-tab-report-ENeuf')).toBeVisible();
    expect(await margins(page)).toEqual(['2', '0,63', '0,63', '0,63']);
    expect(await bandLeft(page)).toBe(1134);
    await page.getByTestId('nav-item-report-EAncien').dblclick();
    await expect(page.getByTestId('doc-tab-report-EAncien')).toBeVisible();
    expect(await margins(page)).toEqual(['1', '1', '1', '1']);
  } finally {
    await app.close();
  }
});
