// F2b Task 8: the Fonts gallery (apply a pair to this object: Headings and Body controls follow, colours untouched) and Customize Fonts
// (embedded families only, Save as a user theme, keyboard, the report print sheet uses the chosen family, the saved scheme survives a relaunch).
import { test, expect, type Page } from '@playwright/test';
import { saveObject } from '../../src/main/db/objects';
import type { DesignDoc } from '../../src/shared/design/model';
import { BUILTIN_THEMES } from '../../src/shared/design/theme';
import { launchApp, seedBase } from './helpers';

const OCEAN = BUILTIN_THEMES.find((t) => t.name === 'Océan')!;   // Carlito / Liberation Sans
const FR = { BASECRAFT_REGION: 'fr-FR' };
const label = (name: string, top: number, FontName: string) => ({ kind: 'label' as const, name, left: 1701, top, width: 2268, height: 340,
  props: { Caption: 'x', ForeColor: 'theme:accent1', FontName } });
const etat: DesignDoc = { formatVersion: '1.0', recordSource: null, props: { Width: 9072 },
  sections: [{ kind: 'reportHeader', height: 2000, props: {}, controls: [label('Tit', 100, '(Headings)'), label('Corps', 600, '(Body)')] }] };
const cur = (page: Page) => page.locator('.doc:not([hidden])');
const look = (page: Page, ctl: string) => cur(page).getByTestId(`ctl-${ctl}`).locator('.rz-text').evaluate((e) => { const s = getComputedStyle(e); return { f: s.fontFamily, c: s.color }; });
const openGallery = async (page: Page) => { await page.getByTestId('ribbon-tab-design').click().catch(() => undefined); await page.getByTestId('cmd-themeFonts').click(); };

test('Fonts gallery applies a pair to the object (colours untouched); Customize Fonts: keyboard, Save, OK, print sheet, relaunch', async () => {
  test.setTimeout(240000);
  const path = seedBase('theme-fonts', (db) => { const r = saveObject(db, 'report', 'Etat', etat, null); if (!r.ok) throw new Error(r.reason); });
  let r = await launchApp({ args: [path], env: FR });
  const { userDataDir } = r;
  const open = async () => {
    await r.page.getByTestId('nav-item-report-Etat').click({ button: 'right' });
    await r.page.getByTestId('nav-menu-design').click();
    await expect(cur(r.page).getByTestId('designer')).toBeVisible();
  };
  const tab = () => r.page.getByTestId('doc-tab-report-Etat');
  try {
    await open();
    const before = { tit: await look(r.page, 'Tit'), corps: await look(r.page, 'Corps') };

    // keyboard: focus lands in the dialog, Tab stays inside, Escape cancels, nothing dirty
    await openGallery(r.page);
    await r.page.getByTestId('fonts-customize').click();
    await expect(r.page.getByTestId('fonts-dialog')).toBeVisible();
    for (let i = 0; i < 12; i++) {
      await r.page.keyboard.press('Tab');
      expect(await r.page.evaluate(() => !!document.activeElement?.closest('[data-testid="fonts-dialog"]'))).toBe(true);
    }
    await r.page.keyboard.press('Escape');
    await expect(r.page.getByTestId('fonts-dialog')).toHaveCount(0);
    await expect(tab()).not.toContainText('•');

    // another pair, this object only: Headings = Carlito, Body = Liberation Sans, colours unchanged; one undo restores
    await openGallery(r.page);
    await r.page.locator('[data-testid^="fonts-item-"][data-scheme-name="Océan"]').click({ button: 'right' });
    await expect(r.page.getByTestId('fonts-menu-default')).toBeEnabled();
    await expect(r.page.locator('[data-testid^="fonts-menu-"]')).toHaveCount(3);
    await r.page.getByTestId('fonts-menu-object').click();
    await expect.poll(async () => (await look(r.page, 'Tit')).f).toContain(`BC ${OCEAN.fonts.major}`);
    expect((await look(r.page, 'Corps')).f).toContain(`BC ${OCEAN.fonts.minor}`);
    expect((await look(r.page, 'Tit')).c).toBe(before.tit.c);
    await expect(tab()).toContainText('•');
    await cur(r.page).getByTestId('ctl-Tit').click();
    await r.page.keyboard.press('Control+z');
    await expect.poll(async () => (await look(r.page, 'Tit')).f).toBe(before.tit.f);

    // Customize: only embedded families are offered; Headings = Caladea, named, saved as a user theme, OK
    await openGallery(r.page);
    await r.page.getByTestId('fonts-customize').click();
    const offered = await r.page.getByTestId('fonts-major').locator('option').allTextContents();
    expect(offered).toEqual(['Liberation Sans', 'Liberation Serif', 'Liberation Mono', 'Carlito', 'Caladea', 'Inter']);
    await r.page.getByTestId('fonts-major').selectOption('Caladea');
    await r.page.getByTestId('fonts-name').fill('Mes polices');
    await r.page.getByTestId('fonts-save').click();
    await expect.poll(() => r.page.evaluate(() => (window as unknown as { basecraft: { themes: { list(): Promise<{ name: string }[]> } } }).basecraft.themes.list().then((l) => l.map((t) => t.name)))).toEqual(['Mes polices']);
    await r.page.getByTestId('fonts-ok').click();
    await expect.poll(async () => (await look(r.page, 'Tit')).f).toContain('BC Caladea');

    // the report's print sheet embeds BC Caladea
    await r.page.keyboard.press('Control+s');
    await expect(tab()).not.toContainText('•');
    await r.page.getByTestId('doc-tab-close-report-Etat').click();
    await r.page.getByTestId('nav-item-report-Etat').dblclick();
    const sheet = cur(r.page).getByTestId('report-preview').locator('style').first();
    await expect.poll(async () => (await sheet.textContent()) ?? '').toContain('BC Caladea');

    // the saved scheme survives a relaunch, as a user theme
    await r.app.close();
    r = await launchApp({ args: [path], userDataDir, env: FR });
    await open();
    await openGallery(r.page);
    await expect(r.page.locator('[data-testid^="fonts-item-"][data-scheme-name="Mes polices"]')).toHaveCount(1);
    // the report saved with it, so the row is the « Dans cette base » one (the identical custom row is not repeated)
    await expect(r.page.locator('[data-testid^="fonts-item-"][data-scheme-name="Mes polices"]')).toHaveAttribute('aria-current', 'true');
    await r.page.keyboard.press('Escape');
    await r.page.getByTestId('cmd-themes').click();
    await expect(r.page.locator('[data-testid^="theme-item-"][data-theme-name="Mes polices"]')).toHaveCount(1);
  } finally { await r.app.close(); }
});
