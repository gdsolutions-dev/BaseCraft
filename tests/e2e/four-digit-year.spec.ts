// O2 Task 7: « Utiliser le format d'année à quatre chiffres » — a Date/Time Format property shows `yy` as four digits in a datasheet, a form text
// box (bound and calculated) and a report text box, when a view opens (R1); the Format() function keeps two digits (R11).
import { test, expect, type Page } from '@playwright/test';
import { saveObject } from '../../src/main/db/objects';
import { createTable } from '../../src/main/db/schema';
import type { ControlDef, DesignDoc } from '../../src/shared/design/model';
import { f, t } from '../../src/shared/test-fixtures';
import { launchApp, seedBase, seedForm } from './helpers';

const FR = { BASECRAFT_REGION: 'fr-FR' };
const box = (name: string, top: number, props: Record<string, unknown>): ControlDef =>
  ({ kind: 'textBox', name, left: 100, top, width: 2268, height: 340, props: { FontName: 'Liberation Sans', FontSize: 10, ...props } });
const sections = (controls: ControlDef[], kind: 'detail' | 'reportHeader' = 'detail') => [
  { kind: 'formHeader' as const, height: 0, props: { Visible: false }, controls: [] },
  { kind, height: 2000, props: {}, controls },
  { kind: 'formFooter' as const, height: 0, props: { Visible: false }, controls: [] },
];
const FORM: DesignDoc = { formatVersion: '1.0', recordSource: { kind: 'table', name: 'Commandes' }, props: { Width: 9000 }, sections: sections([
  box('Le', 100, { ControlSource: 'Le', TabIndex: 0 }), box('Calc', 600, { ControlSource: '=[Le]', Format: 'dd/mm/yy', TabStop: false }),
  box('Fn', 1100, { ControlSource: '=Format([Le], "dd/mm/yy")', TabStop: false })]) };
const REPORT: DesignDoc = { formatVersion: '1.0', recordSource: { kind: 'table', name: 'Commandes' }, props: { Width: 9000,
  pageSetup: { orientation: 'portrait', margins: { top: 567, right: 567, bottom: 567, left: 567 } } }, sections: [
  { kind: 'detail', height: 340, props: {}, controls: [{ ...box('Le', 0, { ControlSource: 'Le' }), left: 0 }] }] };

const seed = (name: string) => seedBase(name, (db) => {
  createTable(db, t('Commandes', [f('N°', 'autoNumber'), f('Le', 'dateTime', { format: 'dd/mm/yy' })]));
  db.prepare('INSERT INTO "Commandes" ("Le") VALUES (?)').run('2026-03-05 00:00:00');
  createTable(db, t('Ref', [f('N°', 'autoNumber'), f('Le', 'dateTime', { format: 'dd/mm/yyyy' })]));   // what the datasheet must look like with the option
  db.prepare('INSERT INTO "Ref" ("Le") VALUES (?)').run('2026-03-05 00:00:00');
  seedForm(db, 'FCmd', FORM);
  const r = saveObject(db, 'report', 'RCmd', REPORT, null);
  if (!r.ok) throw new Error(r.reason);
});
const sheet = (page: Page) => page.locator('[data-testid="datasheet"]:visible');
const txt = (page: Page, id: string) => page.getByTestId(id).filter({ visible: true }).evaluate((e) => (e as HTMLInputElement).value ?? e.textContent);

/** Glide draws on a canvas (its accessible cell reads the edit text): the pixels of the Le cell of the first row. */
async function pixels(page: Page, table: string): Promise<string> {
  await page.getByTestId(`nav-item-${table}`).dblclick();
  const cell = sheet(page).getByTestId('glide-cell-2-0');
  await expect(cell).toBeAttached();
  const b = (await sheet(page).getByTestId('data-grid-canvas').boundingBox())!;
  const shot = await page.screenshot({ clip: { x: b.x + 44 + 94, y: b.y + 34 + 2, width: 90, height: 26 } });   // col 1, row 0 (selector 44, header 34, column 94 px)
  return shot.toString('base64');
}

/** Opens the datasheet, the form and the report preview; returns what each shows. */
async function shown(page: Page) {
  await page.getByTestId('nav-item-Commandes').dblclick();
  await expect(sheet(page).getByTestId('data-grid-canvas')).toBeVisible();
  const cell = await pixels(page, 'Commandes');
  const ref = await pixels(page, 'Ref');
  await page.getByTestId('nav-item-form-FCmd').dblclick();
  await expect(page.getByTestId('form-run').filter({ visible: true })).toBeVisible();
  await expect.poll(() => txt(page, 'form-ctl-Le')).toMatch(/^05\/03\/\d+$/);
  await expect.poll(() => txt(page, 'form-ctl-Fn')).toMatch(/^05\/03\/\d+$/);
  const form = [await txt(page, 'form-ctl-Le'), await txt(page, 'form-ctl-Calc'), await txt(page, 'form-ctl-Fn')];
  await page.getByTestId('nav-group-report').getByTestId('nav-item-report-RCmd').dblclick();
  const pages = page.locator('.doc:not([hidden])').locator('.bc-page');
  await expect(pages.first()).toBeVisible();
  const report = await pages.first().textContent();
  return { cell, ref, form, report };
}
async function closeAll(page: Page) {   // a view keeps its look while open (R1): reopen everything
  const close = page.locator('[data-testid^="doc-tab-close-"]');
  while (await close.count()) await close.first().click();
}

test('yy shows four digits with either option, per base; Format() keeps two digits', async () => {
  const a = seed('year4-a'), b = seed('year4-b');
  const { app, page } = await launchApp({ args: [a], env: FR });
  try {
    let s = await shown(page);
    const two = s.cell;
    expect(two).not.toBe(s.ref);
    expect(s.form).toEqual(['05/03/26', '05/03/26', '05/03/26']);
    expect(s.report).toContain('05/03/26'); expect(s.report).not.toContain('2026');
    await closeAll(page);

    await page.getByTestId('ribbon-tab-file').click();
    await page.getByTestId('bs-options').click();
    await page.getByTestId('opt-cat-client').click();
    await page.getByTestId('opt-year4-all').check();
    await page.getByTestId('bs-back').click();
    s = await shown(page);
    expect(s.cell).toBe(s.ref); expect(s.cell).not.toBe(two);
    expect(s.form).toEqual(['05/03/2026', '05/03/2026', '05/03/26']);   // the Format() function is not affected
    expect(s.report).toContain('05/03/2026');
    await closeAll(page);

    await page.getByTestId('ribbon-tab-file').click();
    await page.getByTestId('bs-options').click();
    await page.getByTestId('opt-cat-client').click();
    await page.getByTestId('opt-year4-all').uncheck();
    await page.getByTestId('opt-year4-db').check();
    await page.getByTestId('bs-back').click();
    s = await shown(page);
    expect(s.cell).toBe(s.ref); expect(s.form[1]).toBe('05/03/2026'); expect(s.report).toContain('05/03/2026');
  } finally { await app.close(); }
  const other = await launchApp({ args: [b], env: FR });   // the database level is per base
  try {
    const s = await shown(other.page);
    expect(s.cell).not.toBe(s.ref); expect(s.form[1]).toBe('05/03/26');
  } finally { await other.app.close(); }
});
