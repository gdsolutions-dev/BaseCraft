import { test, expect, type Page } from '@playwright/test';
import { createTable } from '../../src/main/db/schema';
import { clients } from '../../src/shared/test-fixtures';
import { launchApp, seedBase } from './helpers';

const openDesign = async (page: Page) => {
  await page.getByTestId('nav-item-Clients').click({ button: 'right' });
  await page.getByTestId('nav-menu-design').click();
  await expect(page.getByTestId('design-splitter')).toBeVisible();
};
const heights = async (page: Page) => ({
  grid: (await page.getByTestId('design-grid-pane').boundingBox())!.height,
  props: (await page.locator('.fprops').boundingBox())!.height,
});
const now = async (page: Page) => Number(await page.getByTestId('design-splitter').getAttribute('aria-valuenow'));

test('design splitter: drag resizes both panes within limits, the position is remembered, the keyboard moves it', async () => {
  const base = seedBase('splitter', (db) => createTable(db, clients));
  const { app, page } = await launchApp({ args: [base] });
  try {
    await openDesign(page);
    const bar = page.getByTestId('design-splitter');
    await expect(bar).toHaveAttribute('role', 'separator');
    await expect(bar).toHaveAttribute('aria-orientation', 'horizontal');
    const min = Number(await bar.getAttribute('aria-valuemin'));
    const max = Number(await bar.getAttribute('aria-valuemax'));
    const before = await heights(page);

    const box = (await bar.boundingBox())!;
    const [x, y] = [box.x + box.width / 2, box.y + box.height / 2];
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x, y - 40, { steps: 4 });
    await page.mouse.move(x + 300, y - 80, { steps: 4 }); // sideways: the drag follows the pointer anywhere
    await page.mouse.up();
    const after = await heights(page);
    expect(Math.abs(after.grid - (before.grid - 80))).toBeLessThanOrEqual(2);
    expect(Math.abs(after.props - (before.props + 80))).toBeLessThanOrEqual(2);

    // Limits: dragging far past either end stops at the minimum / maximum.
    const drag = async (dy: number) => {
      const b = (await bar.boundingBox())!;
      await page.mouse.move(b.x + 20, b.y + 3);
      await page.mouse.down();
      await page.mouse.move(b.x + 20, b.y + 3 + dy, { steps: 5 });
      await page.mouse.up();
    };
    await drag(-2000);
    expect(await now(page)).toBe(min);
    expect((await heights(page)).grid).toBeGreaterThanOrEqual(124 - 1);
    await drag(2000);
    expect(await now(page)).toBe(max);
    const low = await heights(page);
    expect(low.props).toBeGreaterThanOrEqual(128 - 1);
    // the tab bar and the first two property rows are still on screen at the minimum
    const props = (await page.locator('.fprops').boundingBox())!;
    for (const loc of [page.locator('.fprops .ptab').first(), page.locator('.fprops .prow').nth(1)]) {
      const r = (await loc.boundingBox())!;
      expect(r.y + r.height).toBeLessThanOrEqual(props.y + props.height + 1);
    }
    await drag(-100);
    const dragged = await heights(page);

    // Reopen the designer: the position is back.
    await page.getByTestId('doc-tab-close-Clients').click();
    await openDesign(page);
    const reopened = await heights(page);
    expect(Math.abs(reopened.grid - dragged.grid)).toBeLessThanOrEqual(2);

    // Keyboard.
    await bar.focus();
    const v0 = await now(page);
    await page.keyboard.press('ArrowUp');
    expect(await now(page)).toBe(v0 - 16);
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowDown');
    expect(await now(page)).toBe(v0 + 16);
    await page.keyboard.press('PageUp');
    expect(await now(page)).toBeLessThan(v0 + 16 - 20);
    await page.keyboard.press('Home');
    expect(await now(page)).toBe(min);
    await page.keyboard.press('End');
    expect(await now(page)).toBe(max);
    expect(Math.abs((await heights(page)).props - 128)).toBeLessThanOrEqual(3);

    // Double-click: back to the default.
    await bar.dblclick();
    const reset = await now(page);
    expect(reset).toBeGreaterThan(min);
    expect(reset).toBeLessThan(max);
    expect(Math.abs(reset / (await heights(page)).grid - 1)).toBeLessThan(0.02);
  } finally {
    await app.close();
  }
});
