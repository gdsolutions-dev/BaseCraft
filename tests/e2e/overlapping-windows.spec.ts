// C6: Document Window Options (overlapping windows or tabbed documents, read when the base opens) and the default zoom
// (the interface zoom and Print Preview's), a workstation setting applied at start.
import { test, expect, type Page } from '@playwright/test';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { saveStartupOptions } from '../../src/main/db/startup';
import { seedSales } from '../../src/main/query/test-db';
import type { BasecraftApi } from '../../src/shared/api';
import { DEFAULT_STARTUP, type StartupOptions } from '../../src/shared/startup';
import { launchApp, openDbOptions, seedBase, seedForm, seedReportsE2E } from './helpers';

const FCLIENTS = {
  formatVersion: '1.0' as const, recordSource: { kind: 'table' as const, name: 'Clients' }, props: { Width: 6000 },
  sections: [{ kind: 'formHeader' as const, height: 0, props: { Visible: false }, controls: [] },
    { kind: 'detail' as const, height: 1200, props: {}, controls: [{ kind: 'textBox' as const, name: 'Nom', left: 1701, top: 100, width: 2268, height: 340, props: { ControlSource: 'Nom' } }] },
    { kind: 'formFooter' as const, height: 0, props: { Visible: false }, controls: [] }],
};
const seed = (name: string, options: Partial<StartupOptions>) => seedBase(name, (db) => {
  seedSales(db);
  seedReportsE2E(db);
  seedForm(db, 'FClients', FCLIENTS);
  saveStartupOptions(db, { ...DEFAULT_STARTUP, ...options });
});
type Win = { basecraft: BasecraftApi };
const startup = (page: Page) => page.evaluate(() => (window as unknown as Win).basecraft.base.startup());
const switchTo = async (page: Page, tid: string) => { await page.getByTestId('cmd-switchWindows').click(); await page.getByTestId(`owin-switch-${tid}`).click(); };
const box = async (page: Page, id: string) => (await page.getByTestId(id).boundingBox())!;

test('overlapping windows: windows in the client area, move, resize, z-order, minimize, maximize, size to fit, switch, close', async () => {
  const { app, page } = await launchApp({ args: [seed('c6-windows', { overlappingWindows: true })] });
  try {
    await expect(page.getByTestId('owin-area')).toBeVisible();
    await page.getByTestId('nav-item-Clients').dblclick();
    await page.getByTestId('nav-item-form-FClients').dblclick();
    await expect(page.getByTestId('owin-Clients')).toBeVisible();
    await expect(page.getByTestId('owin-form-FClients')).toBeVisible();
    await expect(page.locator('[data-testid^="doc-tab-"]')).toHaveCount(0);   // no tab strip
    await expect(page.getByTestId('cmd-switchWindows')).toBeVisible();

    // the form's own width (6000 twips = 400 px, its record selectors and borders) and the opened last in front
    const w0 = (await box(page, 'owin-form-FClients')).width;
    expect(w0).toBeGreaterThan(400); expect(w0).toBeLessThan(440);
    await expect(page.getByTestId('owin-form-FClients')).toHaveAttribute('data-front', 'true');
    await expect(page.getByTestId('form-ctl-Nom').filter({ visible: true })).toBeVisible();

    // a click on another window brings it in front (higher z-order)
    const z = (id: string) => page.getByTestId(id).evaluate((e) => Number(getComputedStyle(e).zIndex));
    await page.getByTestId('owin-title-Clients').click();
    await expect(page.getByTestId('owin-Clients')).toHaveAttribute('data-front', 'true');
    await expect(page.getByTestId('owin-form-FClients')).toHaveAttribute('data-front', 'false');
    expect(await z('owin-Clients')).toBeGreaterThan(await z('owin-form-FClients'));

    // move by the title bar (the form is behind Clients: Switch Windows brings it back in front)
    await switchTo(page, 'form-FClients');
    await expect(page.getByTestId('owin-form-FClients')).toHaveAttribute('data-front', 'true');
    const before = await box(page, 'owin-form-FClients');
    const t = (await box(page, 'owin-title-form-FClients'));
    await page.mouse.move(t.x + 60, t.y + 10);
    await page.mouse.down();
    await page.mouse.move(t.x + 160, t.y + 60, { steps: 5 });
    await page.mouse.up();
    const moved = await box(page, 'owin-form-FClients');
    expect(Math.round(moved.x - before.x)).toBe(100);
    expect(Math.round(moved.y - before.y)).toBe(50);

    // resize by the grip, then Size to Fit Form gives the form's own width back
    const g = await box(page, 'owin-grip-form-FClients');
    await page.mouse.move(g.x + 6, g.y + 6);
    await page.mouse.down();
    await page.mouse.move(g.x + 106, g.y + 86, { steps: 5 });
    await page.mouse.up();
    expect(Math.round((await box(page, 'owin-form-FClients')).width - before.width)).toBe(100);
    await page.getByTestId('cmd-sizeToFit').click();   // Home › Window
    expect(Math.round((await box(page, 'owin-form-FClients')).width)).toBe(Math.round(before.width));

    // Switch Windows (Home › Window; the group is not there with tabbed documents)
    await switchTo(page, 'Clients');
    await expect(page.getByTestId('owin-Clients')).toHaveAttribute('data-front', 'true');

    // minimize: only the title bar stays; the same button restores
    await switchTo(page, 'form-FClients');
    await page.getByTestId('owin-min-form-FClients').click();
    expect((await box(page, 'owin-form-FClients')).height).toBeLessThan(40);
    await page.getByTestId('owin-min-form-FClients').click();
    expect((await box(page, 'owin-form-FClients')).height).toBeGreaterThan(80);

    // maximize fills the client area; restoring gives the window back
    await switchTo(page, 'Clients');
    await page.getByTestId('owin-max-Clients').click();
    const area = await box(page, 'owin-area');
    expect(Math.round((await box(page, 'owin-Clients')).width)).toBeGreaterThanOrEqual(Math.round(area.width) - 4);
    await page.getByTestId('owin-max-Clients').click();
    expect((await box(page, 'owin-Clients')).width).toBeLessThan(area.width - 50);

    // cascade and tile
    await page.getByTestId('cmd-switchWindows').click();
    await page.getByTestId('owin-tile').click();
    const a = await box(page, 'owin-Clients'), b = await box(page, 'owin-form-FClients');
    expect(Math.abs(a.x - b.x) + Math.abs(a.y - b.y)).toBeGreaterThan(100);
    await page.getByTestId('cmd-switchWindows').click();
    await page.getByTestId('owin-cascade').click();

    // close
    await switchTo(page, 'form-FClients');
    await page.getByTestId('owin-close-form-FClients').click();
    await expect(page.getByTestId('owin-form-FClients')).toHaveCount(0);
    await switchTo(page, 'Clients');
    await page.getByTestId('owin-close-Clients').click();
    await expect(page.getByTestId('owin-Clients')).toHaveCount(0);
  } finally {
    await app.close();
  }
});

test('Document Window Options: the choice is saved and read when the base opens again', async () => {
  const { app, page } = await launchApp({ args: [seed('c6-option', {})] });
  try {
    await page.getByTestId('nav-item-form-FClients').dblclick();
    await expect(page.getByTestId('doc-tab-form-FClients')).toBeVisible();   // tabbed by default
    await page.getByTestId('ribbon-tab-file').click();
    await openDbOptions(page);
    await expect(page.getByTestId('opt-db-tabbed')).toBeChecked();
    await expect(page.getByTestId('opt-db-doctabs')).toBeEnabled();
    await page.getByTestId('opt-db-overlapping').check();
    await expect(page.getByTestId('opt-db-doctabs')).toBeDisabled();
    await expect.poll(() => startup(page).then((s) => s.overlappingWindows)).toBe(true);
    await expect(page.getByTestId('opt-db-next-open')).toBeVisible();
    await page.getByTestId('bs-close').click();
    await expect.poll(() => page.evaluate(() => (window as unknown as Win).basecraft.base.state())).toBeNull();
    await page.getByTestId('bs-recent').click();
    await page.getByTestId('bs-recent-0').click();
    await expect(page.getByTestId('owin-area')).toBeVisible();
    await page.getByTestId('nav-item-form-FClients').dblclick();
    await expect(page.getByTestId('owin-form-FClients')).toBeVisible();
    await expect(page.locator('[data-testid^="doc-tab-"]')).toHaveCount(0);
  } finally {
    await app.close();
  }
});

test('default zoom: the interface zoom (options, Ctrl + plus / minus / 0, Ctrl + wheel) and Print Preview\'s, saved and applied at start', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'basecraft-zoom-'));
  writeFileSync(join(dir, 'settings.json'), JSON.stringify({ interfaceZoom: 150, previewZoom: 'actual' }));
  const { app, page } = await launchApp({ args: [seed('c6-zoom', {})], userDataDir: dir });
  try {
    const factor = () => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.webContents.getZoomFactor());
    await expect.poll(factor).toBeCloseTo(1.5, 2);   // read at start

    // Print Preview opens at 100 % (a page is 793.7 px wide)
    await page.getByTestId('nav-group-report').getByTestId('nav-item-report-Factures par client').dblclick();
    const pages = page.locator('.doc:not([hidden]) .bc-page');
    await expect(pages.first()).toBeVisible();
    expect(await pages.first().evaluate((el) => el.getBoundingClientRect().width)).toBeCloseTo(11906 / 15, 0);
    await page.getByTestId('cmd-previewZoom').click();   // the ribbon still toggles to Fit
    await expect.poll(() => pages.first().evaluate((el) => el.getBoundingClientRect().width)).toBeLessThan(11906 / 15 - 10);

    // keys and wheel save the setting, the main process applies it
    await page.keyboard.press('Control+0');
    await expect.poll(factor).toBeCloseTo(1, 2);
    await page.keyboard.press('Control+=');
    await expect.poll(factor).toBeCloseTo(1.1, 2);
    await page.keyboard.press('Control+-');
    await page.keyboard.press('Control+-');
    await expect.poll(factor).toBeCloseTo(0.9, 2);
    await page.keyboard.press('Control+0');
    await expect.poll(factor).toBeCloseTo(1, 2);
    await page.mouse.move(400, 400);
    await page.evaluate(() => window.dispatchEvent(new WheelEvent('wheel', { deltaY: -100, ctrlKey: true, cancelable: true })));
    await expect.poll(factor).toBeCloseTo(1.1, 2);

    // File › Options › General
    await page.getByTestId('ribbon-tab-file').click();
    await page.getByTestId('bs-options').click();
    await expect(page.getByTestId('opt-zoom')).toHaveValue('110');
    await page.getByTestId('opt-zoom').fill('125');
    await page.getByTestId('opt-zoom').press('Enter');
    await expect.poll(factor).toBeCloseTo(1.25, 2);
    await page.getByTestId('opt-zoom-reset').click();
    await expect.poll(factor).toBeCloseTo(1, 2);
    await page.getByTestId('opt-previewzoom-fit').check();
    await expect(page.getByTestId('opt-previewzoom-fit')).toBeChecked();
  } finally {
    await app.close();
  }
});

const FORM = (props: Record<string, unknown>) => ({ ...FCLIENTS, props: { Width: 6000, ...props } });
const seedWin = (name: string, overlapping: boolean) => seedBase(name, (db) => {
  seedSales(db);
  seedForm(db, 'FClients', FCLIENTS);
  seedForm(db, 'FPop', FORM({ PopUp: true, AutoCenter: true, MinMaxButtons: 'none' }));
  seedForm(db, 'FModal', FORM({ Modal: true, BorderStyle: 'dialog', CloseButton: false }));
  seedForm(db, 'FBare', FORM({ BorderStyle: 'none', AutoResize: false }));
  saveStartupOptions(db, { ...DEFAULT_STARTUP, overlappingWindows: overlapping });
});

for (const overlapping of [true, false]) {
  test(`form window properties (${overlapping ? 'overlapping windows' : 'tabbed documents'}): Pop Up floats, Modal blocks, Border Style, Auto Center`, async () => {
    const { app, page } = await launchApp({ args: [seedWin(`c6b-${overlapping}`, overlapping)] });
    try {
      await page.getByTestId('nav-item-form-FClients').dblclick();
      await expect(page.getByTestId('form-ctl-Nom').filter({ visible: true })).toBeVisible();

      // Pop Up: a floating window, whatever the host (not in the tab strip or the overlapping windows), above the others; centred; no min / max
      await page.getByTestId('nav-item-form-FPop').dblclick();
      const pop = page.getByTestId('popup-FPop');
      await expect(pop).toBeVisible();
      await expect(page.locator('[data-testid="doc-tab-form-FPop"], [data-testid="owin-form-FPop"]')).toHaveCount(0);
      await expect(page.getByTestId('popup-min-FPop')).toBeDisabled();
      await expect(page.getByTestId('popup-max-FPop')).toBeDisabled();
      await expect(page.getByTestId('popup-close-FPop')).toBeEnabled();
      const win = page.viewportSize() ?? (await page.evaluate(() => ({ width: innerWidth, height: innerHeight })));
      const p = await box(page, 'popup-FPop');
      expect(Math.abs(p.x + p.width / 2 - win.width / 2)).toBeLessThan(3);
      expect(Math.abs(p.y + p.height / 2 - win.height / 2)).toBeLessThan(3);
      // the rest stays usable (not modal): the other form is reachable and the pop-up stays on top of it
      const top = await page.evaluate(([x, y]) => document.elementFromPoint(x, y)?.closest('[role="group"][data-testid^="popup-"]')?.getAttribute('data-testid') ?? null, [p.x + 20, p.y + 20]);
      expect(top).toBe('popup-FPop');
      await page.getByTestId('popup-title-FPop').click();
      await page.getByTestId('popup-close-FPop').click();
      await expect(pop).toHaveCount(0);

      // Modal with a dialog border: over the whole window, the rest inert, no close button, no minimize or maximize
      await page.getByTestId('nav-item-form-FModal').dblclick();
      await expect(page.getByTestId('form-dialog-FModal')).toBeVisible();
      await expect(page.getByTestId('form-dialog-close')).toBeDisabled();
      await expect(page.getByTestId('app-root')).toHaveAttribute('inert', '');

    } finally {
      await app.close();
    }
  });
}

test('Border Style none and Auto Resize off (overlapping windows): no title bar, a window size of its own', async () => {
  const { app, page } = await launchApp({ args: [seedWin('c6b-bare', true)] });
  try {
    await page.getByTestId('nav-item-form-FBare').dblclick();
    await expect(page.getByTestId('owin-form-FBare')).toBeVisible();
    await expect(page.getByTestId('owin-title-form-FBare')).toHaveCount(0);
    expect(Math.round((await box(page, 'owin-form-FBare')).height)).toBe(400);   // Auto Resize off: not the form's own size
  } finally {
    await app.close();
  }
});
