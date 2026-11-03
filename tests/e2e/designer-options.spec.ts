// O3 Task 7: marquee selection in the form and report designers — « Partiellement entouré » (default) vs « Entièrement entouré ».
import { test, expect, type Page } from '@playwright/test';
import { createTable } from '../../src/main/db/schema';
import { saveObject } from '../../src/main/db/objects';
import type { ControlDef, DesignDoc } from '../../src/shared/design/model';
import { clients, t } from '../../src/shared/test-fixtures';
import { launchApp, seedBase, seedForm } from './helpers';

const FR = { BASECRAFT_REGION: 'fr-FR' };
const cur = (page: Page) => page.locator('.doc:not([hidden])');
const ctl = (page: Page, name: string) => cur(page).getByTestId(`ctl-${name}`);
// A 150–1284 twips and B 850–1984 on the same line (they overlap); the detail section is 1134 twips high (76 px)
const text = (name: string, left: number): ControlDef => ({ kind: 'textBox', name, left, top: 200, width: 1134, height: 340, props: {} });
const doc = (kinds: [string, string, string]): DesignDoc => ({ formatVersion: '1.0', recordSource: { kind: 'table', name: 'Clients' }, props: {}, sections: [
  { kind: kinds[0], height: 0, props: { Visible: false }, controls: [] }, { kind: 'detail', height: 1134, props: {}, controls: [text('A', 150), text('B', 850)] },
  { kind: kinds[2], height: 0, props: { Visible: false }, controls: [] }] } as DesignDoc);
const selected = async (page: Page) => ({ A: await ctl(page, 'A').getAttribute('aria-pressed'), B: await ctl(page, 'B').getAttribute('aria-pressed') });
async function drag(page: Page, x0: number, x1: number, shift = false) {
  const b = (await cur(page).locator('[data-section-body="1"]').boundingBox())!;
  if (shift) await page.keyboard.down('Shift');
  await page.mouse.move(b.x + x0, b.y + 65); await page.mouse.down(); await page.mouse.move(b.x + (x0 + x1) / 2, b.y + 30); await page.mouse.move(b.x + x1, b.y + 5); await page.mouse.up();
  if (shift) await page.keyboard.up('Shift');
}
async function design(page: Page, kind: 'form' | 'report', name: string) {
  await page.getByTestId(`nav-item-${kind}-${name}`).click({ button: 'right' });
  await page.getByTestId('nav-menu-design').click();
  await expect(cur(page).getByTestId('designer')).toBeVisible();
}

test('marquee selection: partial by default, whole controls only with the option, in forms and reports', async () => {
  test.setTimeout(150_000);
  const base = seedBase('designer-options', (db) => {
    createTable(db, t('Clients', clients.fields));
    seedForm(db, 'FDeux', doc(['formHeader', 'detail', 'formFooter']));
    const r = saveObject(db, 'report', 'EDeux', doc(['pageHeader', 'detail', 'pageFooter']), null);
    if (!r.ok) throw new Error(r.reason);
  });
  const { app, page } = await launchApp({ args: [base], env: FR });
  try {
    await design(page, 'form', 'FDeux');
    await drag(page, 3, 94);   // 94 px = 1410 twips: reaches into B, covers A whole
    expect(await selected(page)).toEqual({ A: 'true', B: 'true' });

    await page.getByTestId('ribbon-tab-file').click();
    await page.getByTestId('bs-options').click();
    await page.getByTestId('opt-cat-designers').click();
    await page.getByTestId('opt-select-full').check();
    await page.getByTestId('bs-back').click();

    await drag(page, 3, 94);
    expect(await selected(page)).toEqual({ A: 'true', B: 'false' });
    await drag(page, 50, 140, true);   // around B alone, Shift: adds it
    expect(await selected(page)).toEqual({ A: 'true', B: 'true' });
    await cur(page).locator('[data-section-body="1"]').click({ position: { x: 300, y: 60 } });   // a click on the empty section
    expect(await selected(page)).toEqual({ A: 'false', B: 'false' });

    await design(page, 'report', 'EDeux');
    await drag(page, 3, 94);
    expect(await selected(page)).toEqual({ A: 'true', B: 'false' });
  } finally { await app.close(); }
});
