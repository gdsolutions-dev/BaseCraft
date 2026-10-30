// O1 acceptance (roadmap, batch O1): a base with full menus, default shortcut menus and special keys off opens in the full
// application and in the Runtime with no design command, no shortcut menu and no F11; with action-query confirmation off an
// update query runs with no dialog; the options survive a restart. The designer sets everything through File › Options; a third
// party runs the same base in the Runtime with its own workstation settings (confirmations on).
import { test, expect, type Page } from '@playwright/test';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { saveObject } from '../../src/main/db/objects';
import { seedSales } from '../../src/main/query/test-db';
import type { BasecraftApi } from '../../src/shared/api';
import type { DesignDoc } from '../../src/shared/design/model';
import { SHIFT_GRACE_MS } from '../../src/renderer/shell/shift-key';
import { launchApp, openDbOptions, seedBase, seedForm } from './helpers';

const fr = JSON.parse(readFileSync(join(__dirname, '../../src/shared/i18n/fr.json'), 'utf8'));
const FR = { BASECRAFT_REGION: 'fr-FR' };
type W = { basecraft: BasecraftApi };

const FMENU: DesignDoc = {
  formatVersion: '1.0', recordSource: null, props: { Width: 9072 },
  sections: [{ kind: 'formHeader', height: 0, props: { Visible: false }, controls: [] },
    { kind: 'detail', height: 1200, props: {}, controls: [{
      kind: 'commandButton', name: 'cmdDouble', left: 1701, top: 100, width: 2268, height: 340,
      props: { Caption: 'Doubler', OnClick: { embedded: { formatVersion: '1.0', items: [{ k: 'action', action: 'OpenQuery', args: { QueryName: 'QDouble' } }] } } },
    }] },
    { kind: 'formFooter', height: 0, props: { Visible: false }, controls: [] }],
};

const state = (page: Page) => page.evaluate(() => (window as unknown as W).basecraft.base.state());
const startup = (page: Page) => page.evaluate(() => (window as unknown as W).basecraft.base.startup());
/** Client 2's order amounts (seedSales: two orders). */
const montants = (page: Page) => page.evaluate(() => (window as unknown as W).basecraft.rows.page('Commandes', { offset: 0, limit: 100 })
  .then((p) => p.rows.filter((r) => r.values[1] === 2).map((r) => r.values[2] as number)));
const ribbonTabs = (page: Page) => page.locator('[data-testid^="ribbon-tab-"]').evaluateAll((els) => els.map((e) => (e as HTMLElement).dataset.testid));
const modal = (page: Page) => page.getByTestId('modal');
const doubled = (m: number[]) => m.map((x) => x * 2);

/** FMenu in front; File and Home only; no Design button; no shortcut menu; F11 leaves the pane as it is. */
async function expectLocked(page: Page) {
  await expect(page.getByTestId('doc-tab-form-FMenu')).toHaveAttribute('aria-selected', 'true');   // the display form, once the sequence has run
  await expect.poll(() => ribbonTabs(page)).toEqual(['ribbon-tab-file', 'ribbon-tab-home']);
  await expect(page.getByTestId('status-view-design')).toHaveCount(0);
  await page.getByTestId('nav-item-query-QDouble').click({ button: 'right' });
  await expect(page.getByTestId('nav-menu')).toHaveCount(0);
  await expect(page.getByTestId('nav-pane')).toBeVisible();
  await page.keyboard.press('F11');
  await expect(page.getByTestId('nav-pane')).toBeVisible();
}

test('recette O1: options set by the designer, in force after a restart, in the full application and in the Runtime', async () => {
  test.setTimeout(120_000);   // four launches
  const path = seedBase('recette-o1', (db) => {
    seedSales(db);
    saveObject(db, 'query', 'QDouble', { formatVersion: '1.0', sql: 'UPDATE Commandes SET Montant = Montant * 2 WHERE Client = 2;' }, null);
    seedForm(db, 'FMenu', FMENU);
  });
  const designer = mkdtempSync(join(tmpdir(), 'basecraft-designer-'));
  const thirdParty = mkdtempSync(join(tmpdir(), 'basecraft-third-'));

  // Part 1 — the designer, full application, through File › Options
  let r = await launchApp({ args: [path], env: FR, userDataDir: designer });
  let before: number[];
  try {
    const page = r.page;
    before = await montants(page);
    expect(before).toHaveLength(2);
    await page.getByTestId('ribbon-tab-file').click();
    await openDbOptions(page);
    await page.getByTestId('opt-db-fullmenus').uncheck();
    await page.getByTestId('opt-db-shortcutmenus').uncheck();
    await page.getByTestId('opt-db-specialkeys').uncheck();
    await page.getByTestId('opt-db-form').selectOption('FMenu');
    await expect.poll(() => startup(page)).toMatchObject({ fullMenus: false, shortcutMenus: false, specialKeys: false, startupForm: 'FMenu' });
    await page.getByTestId('bs-close').click();
    await expect.poll(() => state(page)).toBeNull();

    // the Options page stays shown after Close (« Base de données active » gone); bs-options would toggle it off
    await page.getByTestId('opt-cat-client').click();
    await page.getByTestId('opt-confirm-actions').uncheck();
    await expect.poll(() => JSON.parse(readFileSync(join(designer, 'settings.json'), 'utf8')).confirmActionQueries).toBe(false);
  } finally {
    await r.app.close();
  }

  // Part 2 — reopened in the full application, same profile, no Shift: locked, and the update query runs with no dialog
  r = await launchApp({ args: [path], env: FR, userDataDir: designer });
  try {
    const page = r.page;
    await expectLocked(page);
    await page.getByTestId('form-ctl-cmdDouble').filter({ visible: true }).click();
    await expect.poll(() => montants(page)).toEqual(doubled(before));
    await expect(modal(page)).toHaveCount(0);
    await page.getByTestId('ribbon-tab-file').click();
    await page.getByTestId('bs-options').click();
    await page.getByTestId('opt-cat-client').click();
    await expect(page.getByTestId('opt-confirm-actions')).not.toBeChecked();
  } finally {
    await r.app.close();
  }

  // Part 3 — the same base in the Runtime, a third party's own profile (confirmations on): locked; the count question shows
  r = await launchApp({ runtime: true, args: [path], env: FR, userDataDir: thirdParty });
  try {
    const page = r.page;
    await expectLocked(page);
    await page.getByTestId('form-ctl-cmdDouble').filter({ visible: true }).click();
    await expect(modal(page)).toContainText(fr.query.action.confirm_update_other.replace('{{count}}', '2'));
    await page.getByTestId('modal-btn-yes').click();
    await expect.poll(() => montants(page)).toEqual(doubled(doubled(before)));
    await expect(modal(page)).toHaveCount(0);
  } finally {
    await r.app.close();
  }

  // Part 4 — back to the designer: Shift + Recent gives every tab, the menus and F11 back; Design view of FMenu opens
  r = await launchApp({ env: FR, userDataDir: designer });
  try {
    const page = r.page;
    await page.getByTestId('bs-recent').click();
    await page.getByTestId('bs-recent-0').click({ modifiers: ['Shift'] });
    await expect.poll(() => state(page)).not.toBeNull();
    await page.waitForTimeout(SHIFT_GRACE_MS * 2);   // past the moment the sequence would have run
    await expect(page.getByTestId('ribbon-tab-create')).toBeVisible();
    await expect(page.getByTestId('ribbon-tab-externalData')).toBeVisible();
    await expect(page.getByTestId('ribbon-tab-databaseTools')).toBeVisible();
    await page.keyboard.press('F11');
    await expect(page.getByTestId('nav-pane')).toHaveCount(0);
    await page.keyboard.press('F11');
    await expect(page.getByTestId('nav-pane')).toBeVisible();
    await page.getByTestId('nav-item-form-FMenu').click({ button: 'right' });
    await expect(page.getByTestId('nav-menu')).toBeVisible();
    await page.getByTestId('nav-menu-design').click();
    await expect(page.getByTestId('property-sheet')).toBeVisible();
    await expect(page.getByTestId('doc-tab-form-FMenu')).toHaveAttribute('aria-selected', 'true');
  } finally {
    await r.app.close();
  }
});
