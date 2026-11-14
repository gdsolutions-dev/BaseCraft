// F2b Task 6: the user's themes (Save Current Theme, replace, Delete, « Personnalisé » section), kept in <userData>/themes.json.
import { test, expect } from '@playwright/test';
import { createTable } from '../../src/main/db/schema';
import type { BasecraftApi } from '../../src/shared/api';
import { BUILTIN_THEMES } from '../../src/shared/design/theme';
import { clients } from '../../src/shared/test-fixtures';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import JSZip from 'jszip';
import { launchApp, seedBase, seedForm } from './helpers';

const seed = () => seedBase('theme-user', async (db) => {
  createTable(db, clients);
  seedForm(db, 'Fiche', { formatVersion: '1.0', recordSource: null, props: { Width: 9072 }, sections: [{ kind: 'detail', height: 2000, props: {}, controls: [] }] });
});

test('save the current theme, replace it, survive a relaunch, delete it', async () => {
  test.setTimeout(180000);
  const base = await seed();
  let r = await launchApp({ args: [base], env: { BASECRAFT_REGION: 'fr-FR' } });
  const { userDataDir } = r;
  const open = async () => {
    await r.page.getByTestId('nav-item-form-Fiche').click({ button: 'right' });
    await r.page.getByTestId('nav-menu-design').click();
    await r.page.getByTestId('cmd-themes').click();
  };
  const mine = () => r.page.locator('[data-testid^="theme-item-"][data-theme-name="Ma charte"]');
  try {
    await open();
    await r.page.getByTestId('theme-save').click();
    await r.page.getByTestId('modal-input').fill('Ma charte');
    await r.page.getByTestId('modal-btn-ok').click();
    await open();
    await expect(mine()).toHaveCount(1);
    // built-ins have no Delete
    await r.page.locator(`[data-testid^="theme-item-"][data-theme-name="${BUILTIN_THEMES[1]!.name}"]`).click({ button: 'right' });
    await expect(r.page.getByTestId('theme-menu-delete')).toHaveCount(0);
    await r.page.keyboard.press('Escape');
    await r.page.keyboard.press('Escape');

    // same name: asks to replace; No keeps one entry
    await r.page.getByTestId('cmd-themes').click();
    await r.page.getByTestId('theme-save').click();
    await r.page.getByTestId('modal-input').fill('ma CHARTE');
    await r.page.getByTestId('modal-btn-ok').click();
    await r.page.getByTestId('modal-btn-no').click();
    expect(await r.page.evaluate(() => (window as unknown as { basecraft: BasecraftApi }).basecraft.themes.list().then((l) => l.map((t) => t.name)))).toEqual(['Ma charte']);
    await r.page.getByTestId('cmd-themes').click();
    await r.page.getByTestId('theme-save').click();
    await r.page.getByTestId('modal-input').fill('ma CHARTE');
    await r.page.getByTestId('modal-btn-ok').click();
    await r.page.getByTestId('modal-btn-yes').click();
    expect(await r.page.evaluate(() => (window as unknown as { basecraft: BasecraftApi }).basecraft.themes.list().then((l) => l.map((t) => t.name)))).toEqual(['ma CHARTE']);

    // a built-in name is refused
    await r.page.getByTestId('cmd-themes').click();
    await r.page.getByTestId('theme-save').click();
    await r.page.getByTestId('modal-input').fill(BUILTIN_THEMES[2]!.name);
    await r.page.getByTestId('modal-btn-ok').click();
    await expect(r.page.getByTestId('modal-btn-ok')).toBeVisible();
    await r.page.getByTestId('modal-btn-ok').click();

    // relaunch with the same user-data dir
    await r.app.close();
    r = await launchApp({ args: [base], userDataDir, env: { BASECRAFT_REGION: 'fr-FR' } });
    await open();
    const item = r.page.locator('[data-testid^="theme-item-"][data-theme-name="ma CHARTE"]');
    await expect(item).toHaveCount(1);
    await item.click({ button: 'right' });
    await r.page.getByTestId('theme-menu-delete').click();
    await r.page.getByTestId('modal-btn-yes').click();
    await expect.poll(() => r.page.evaluate(() => (window as unknown as { basecraft: BasecraftApi }).basecraft.themes.list().then((l) => l.length))).toBe(0);
  } finally { await r.app.close(); }
});

// B7: « Parcourir les thèmes… » reads an Office .thmx (a zip) in the main process and saves it as a custom theme.
test('browse for themes imports a .thmx file; a bad file shows an error', async () => {
  test.setTimeout(180000);
  const clr = (n: string, v: string) => `<a:${n}><a:srgbClr val="${v}"/></a:${n}>`;
  const xml = `<a:theme xmlns:a="x" name="Charte Office"><a:themeElements><a:clrScheme name="Office"><a:dk1><a:sysClr val="windowText" lastClr="000000"/></a:dk1><a:lt1><a:sysClr val="window" lastClr="FFFFFF"/></a:lt1>${
    ['dk2', 'lt2', 'accent1', 'accent2', 'accent3', 'accent4', 'accent5', 'accent6', 'hlink', 'folHlink'].map((n, i) => clr(n, ((i + 1) * 0x151515).toString(16).padStart(6, '0'))).join('')
  }</a:clrScheme><a:fontScheme name="Office"><a:majorFont><a:latin typeface="Calibri Light"/></a:majorFont><a:minorFont><a:latin typeface="Calibri"/></a:minorFont></a:fontScheme></a:themeElements></a:theme>`;
  const dir = mkdtempSync(join(tmpdir(), 'thmx-e2e-'));
  const good = join(dir, 'ok.thmx'), bad = join(dir, 'bad.thmx');
  writeFileSync(good, await new JSZip().file('theme/theme/theme1.xml', xml).generateAsync({ type: 'nodebuffer' }));
  writeFileSync(bad, 'not a zip');
  const base = await seed();
  const r = await launchApp({ args: [base], env: { BASECRAFT_REGION: 'fr-FR', BASECRAFT_E2E_THEME_PATH: good } });
  try {
    await r.page.getByTestId('nav-item-form-Fiche').click({ button: 'right' });
    await r.page.getByTestId('nav-menu-design').click();
    await r.page.getByTestId('cmd-themes').click();
    await r.page.getByTestId('theme-browse').click();
    await expect.poll(() => r.page.evaluate(() => (window as unknown as { basecraft: BasecraftApi }).basecraft.themes.list().then((l) => l.map((t) => [t.name, t.fonts.major])))).toEqual([['Charte Office', 'Calibri Light']]);
    await r.page.getByTestId('cmd-themes').click();
    await expect(r.page.locator('[data-testid^="theme-item-"][data-theme-name="Charte Office"]')).toHaveCount(1);
    // a bad file: the main process rejects it
    await r.app.evaluate((_, p) => { process.env.BASECRAFT_E2E_THEME_PATH = p; }, bad);
    await r.page.getByTestId('theme-browse').click();
    await expect(r.page.getByTestId('modal-btn-ok')).toBeVisible();
    await r.page.getByTestId('modal-btn-ok').click();
  } finally { await r.app.close(); }
});
