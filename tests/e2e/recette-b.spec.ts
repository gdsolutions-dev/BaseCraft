// Recette de l'étape B (spec 7), région fr-FR : une application — un menu au démarrage dont les boutons ouvrent des formulaires,
// filtrent, montrent une analyse croisée et impriment — construite par le concepteur dans l'application complète, par l'interface ;
// puis utilisée par un tiers avec BaseCraft Runtime seul (un fichier reçu : la barre de sécurité, « Activer le contenu », la saisie,
// aucune création, le verrou partagé, Quitter, Maj sans effet) ; enfin rouverte par le concepteur, Maj enfoncée : tout est là.
import { test, expect, type ElectronApplication, type Page } from '@playwright/test';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { BasecraftApi } from '../../src/shared/api';
import { formatValue } from '../../src/shared/expr/format';
import { num } from '../../src/shared/expr/library';
import { FACTURES_ROWS } from '../../src/shared/report/fixtures/factures';
import { checkView, launchApp, layoutFromDom, pickView } from './helpers';
import { buildStageBApp, REPORT, TITLE, vis } from './stage-b-app';

const fr = JSON.parse(readFileSync(join(__dirname, '../../src/shared/i18n/fr.json'), 'utf8'));
const fill = (s: string, p: Record<string, string>) => s.replace(/\{\{(\w+)\}\}/g, (_, k: string) => p[k]!);
const FR = { BASECRAFT_REGION: 'fr-FR' };
type Win = { basecraft: BasecraftApi };
type Row = (string | number | null)[];
// DatasheetView: row selector width, header and row heights.
const MARKER = 44, HEADER = 34, ROW = 30;

const doc = (page: Page) => page.locator('section[role=tabpanel]:not([hidden])');
const count = (page: Page, table: string) => page.evaluate((n) => (window as unknown as Win).basecraft.rows.count(n), table);
const rowsOf = (page: Page, table: string) => page.evaluate((n) => (window as unknown as Win).basecraft.rows.page(n, { offset: 0, limit: 200 })
  .then((p) => p.rows.map((r) => r.values)), table) as Promise<Row[]>;
const queryRows = (page: Page, name: string) => page.evaluate((n) => (window as unknown as Win).basecraft.sources.page({ kind: 'query', name: n },
  { offset: 0, limit: 50 }).then((p) => p.rows), name) as Promise<Row[]>;
const state = (page: Page) => page.evaluate(() => (window as unknown as Win).basecraft.base.state());
const windowTitle = (app: ElectronApplication) => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.getTitle());
const printed = (app: ElectronApplication) => app.evaluate(() => (globalThis as unknown as { __bcPrintE2E: { printed: number } }).__bcPrintE2E.printed);
const ribbonTabs = (page: Page) => page.locator('[data-testid^="ribbon-tab-"]').evaluateAll((els) => els.map((e) => (e as HTMLElement).dataset.testid));
const next = (page: Page) => vis(page, 'form-run').getByRole('button', { name: fr.datasheet.nav.next, exact: true });
/** Spaces compared loosely: ICU's group/currency separators (U+202F, U+00A0) may be substituted for a face (C12). */
const loose = (s: string) => s.replace(/\s/gu, ' ');
const money = (cents: number) => loose(formatValue(num(cents / 100), 'currency', { locale: 'fr-FR', lang: 'fr' }));

// ── Part 2: the third party's checks (B1–B4) ──

/** FMenu's button `name` clicked: `form` active with `count` records, its first `Nom`s as given (Next between them). */
async function menuOpens(page: Page, name: string, form: string, n: string, noms: string[] = []) {
  if (await page.getByTestId(`doc-tab-form-${form}`).count()) await page.getByTestId(`doc-tab-close-form-${form}`).click();
  await expect(page.getByTestId(`doc-tab-form-${form}`)).toHaveCount(0);
  await page.getByTestId('doc-tab-form-FMenu').click();
  await vis(page, `form-ctl-${name}`).click();
  await expect(page.getByTestId(`doc-tab-form-${form}`)).toHaveAttribute('aria-selected', 'true');
  await expect(vis(page, 'nav-record-count')).toHaveText(n);
  for (const [i, nom] of noms.entries()) {
    if (i) await next(page).click();
    await expect(vis(page, 'form-ctl-Nom')).toHaveValue(nom);
  }
  await expect(page.getByTestId('macro-failed')).toHaveCount(0);
}
/** FMenu's button `name` clicked. */
async function click(page: Page, name: string) {
  await page.getByTestId('doc-tab-form-FMenu').click();
  await vis(page, `form-ctl-${name}`).click();
}
/** RunSQL's own question (warnings on), answered Yes. */
async function runSqlYes(page: Page) {
  await expect(page.getByTestId('modal')).toBeVisible();
  await page.getByTestId('modal-btn-yes').click();
  await expect(page.getByTestId('modal')).toHaveCount(0);
}
/** Per client name, the sum of its Commandes in cents, from the tables as `api` reads them. */
async function salesByClient(page: Page): Promise<Map<string, number>> {
  const noms = new Map((await rowsOf(page, 'Clients')).map((c) => [c[0], c[1] as string]));
  const sums = new Map<string, number>();
  for (const [, client, montant] of await rowsOf(page, 'Commandes')) {
    const nom = noms.get(client)!;
    sums.set(nom, (sums.get(nom) ?? 0) + Math.round((montant as number) * 100));
  }
  return sums;
}

test('recette B: an application built in BaseCraft, used by a third party with BaseCraft Runtime alone', async () => {
  test.setTimeout(240_000);

  // ── Part 1: the designer, in the full application (stage-b-app.ts) ──
  const designer = mkdtempSync(join(tmpdir(), 'basecraft-'));
  const base = await buildStageBApp(designer);
  const thirdParty = mkdtempSync(join(tmpdir(), 'basecraft-tiers-'));
  let app: ElectronApplication, page: Page;

  // ── Part 2: the third party, BaseCraft Runtime alone, the file received (nothing trusted) ──
  // 5. the title, the security bar, FMenu open (the safe actions ran), RunSQL blocked, no pane, File and Home only
  ({ app, page } = await launchApp({ runtime: true, untrusted: true, userDataDir: thirdParty, args: [base], env: FR }));
  try {
    await expect.poll(() => windowTitle(app)).toBe(TITLE);
    await expect(page.getByTestId('banner-content')).toBeVisible();
    await expect(page.getByTestId('doc-tab-form-FMenu')).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByTestId('macro-failed')).toHaveCount(1);
    await expect(page.getByTestId('macro-failed-message')).toHaveText(fill(fr.macro.error.blocked, { action: fr.macro.action.RunSQL }));
    await page.getByTestId('macro-failed-stop').click();
    await expect(page.getByTestId('modal')).toHaveCount(0);
    expect(await count(page, 'Journal')).toBe(0);
    await expect(page.getByTestId('nav-pane')).toHaveCount(0);
    expect(await ribbonTabs(page)).toEqual(['ribbon-tab-file', 'ribbon-tab-home']);

    // 6. « Activer le contenu »: AutoExec runs again (B3 R6), Journal has its row
    await page.getByTestId('banner-enable-content').click();
    await runSqlYes(page);
    await expect(page.getByTestId('banner-content')).toHaveCount(0);
    await expect.poll(() => count(page, 'Journal')).toBe(1);

    // 7. the forms: every client, Lyon's (not Éric's « Lyôn », B1), every order; a new order with AutoLookup (B4), Before Update (B2)
    await menuOpens(page, 'cmdClients', 'FClients', '4', ['Dupont', 'Martin', 'Durand', 'Éric']);
    await menuOpens(page, 'cmdLyon', 'FClients', '2', ['Dupont', 'Martin']);
    await menuOpens(page, 'cmdCommandes', 'FCommandes', '5');
    await vis(page, 'nav-new').click();
    await vis(page, 'form-ctl-Client').fill('3');
    await page.keyboard.press('Tab');
    await expect(vis(page, 'form-ctl-Nom')).toHaveValue('Durand');
    await vis(page, 'form-ctl-Montant').fill('1500');
    await vis(page, 'form-ctl-Montant').press('Shift+Enter');
    await expect(page.getByTestId('macro-msgbox-text')).toHaveText('Montant trop élevé');
    await page.getByTestId('macro-msgbox-ok').click();
    await expect(page.getByTestId('macro-msgbox')).toHaveCount(0);
    await expect(vis(page, 'form-dirty')).toBeVisible();
    expect(await count(page, 'Commandes')).toBe(5);
    await vis(page, 'form-ctl-Montant').fill('5');
    await vis(page, 'form-ctl-Montant').press('Shift+Enter');
    await expect(vis(page, 'form-dirty')).toHaveCount(0);
    await expect(page.getByTestId('macro-msgbox')).toHaveCount(0);
    await expect.poll(() => count(page, 'Commandes')).toBe(6);
    expect((await rowsOf(page, 'Commandes'))[5]).toEqual([6, 3, 5, null]);

    // 8. the crosstab, read-only: each client's one value equals the sum of its orders (Durand: 99,99 + 5), typing changes nothing (B4)
    await click(page, 'cmdVentes');
    await expect(page.getByTestId('doc-tab-query-QVentes')).toHaveAttribute('aria-selected', 'true');
    await expect(doc(page).getByTestId('nav-readonly')).toHaveText(fr.query.readOnly);
    const sums = await salesByClient(page);
    expect(sums.get('Durand')).toBe(9999 + 500);
    const crosstab = await queryRows(page, 'QVentes');
    expect(crosstab.map((r) => r[0]).sort()).toEqual([...sums.keys()].sort());
    await expect(doc(page).getByTestId('nav-record-count')).toHaveText(String(sums.size));
    for (const [row, [nom, ...cells]] of crosstab.entries()) {
      const values = cells.filter((v) => v !== null);
      expect(values.map((v) => Math.round((v as number) * 100)), String(nom)).toEqual([sums.get(nom as string)]);
      const col = cells.findIndex((v) => v !== null) + 1;
      await expect(doc(page).getByTestId(`glide-cell-1-${row}`)).toHaveText(nom as string);
      await expect(doc(page).getByTestId(`glide-cell-${col + 1}-${row}`)).toHaveText(new RegExp(`^${String(values[0]).replace('.', ',')}`));
    }
    const box = (await doc(page).getByTestId('data-grid-canvas').boundingBox())!;
    await page.mouse.click(box.x + MARKER + 30, box.y + HEADER + ROW / 2);
    await expect(doc(page).getByTestId('glide-cell-1-0')).toBeFocused();
    await page.keyboard.type('X');
    await expect(page.getByTestId('grid-editor-portal').locator('textarea')).toHaveCount(0); // a read-only cell opens no editor
    await page.keyboard.press('Escape');
    await expect(doc(page).getByTestId('glide-cell-1-0')).toHaveText(crosstab[0]![0] as string);
    await expect(page.getByTestId('doc-tab-query-QVentes')).not.toContainText('•');
    expect(await queryRows(page, 'QVentes')).toEqual(crosstab);
    await page.getByTestId('doc-tab-close-query-QVentes').click();

    // 9. Print Preview: one group per client of the invoices, the report's total; Print: printed at once, no preview (B3)
    await click(page, 'cmdApercu');
    await expect(page.getByTestId(`doc-tab-report-${REPORT}`)).toHaveAttribute('aria-selected', 'true');
    const invoices = new Map<string, number>();
    for (const r of FACTURES_ROWS) invoices.set(r[1] as string, (invoices.get(r[1] as string) ?? 0) + Math.round((r[4] as number) * 100));
    const model = await layoutFromDom(page);
    const texts = (section: string) => model.pages.flatMap((p) => p.bands.filter((b) => b.section === section).map((b) => b.lines.map((l) => loose(l[0]))));
    expect(texts('groupFooter')).toEqual([...invoices].sort(([a], [b]) => a.localeCompare(b, 'fr')).map(([c, cents]) => [`Total ${c}`, money(cents)]));
    expect(texts('reportFooter')).toEqual([[String(FACTURES_ROWS.length), money([...invoices.values()].reduce((a, c) => a + c, 0))]]);
    await page.getByTestId(`doc-tab-close-report-${REPORT}`).click();
    await expect(page.getByTestId(`doc-tab-report-${REPORT}`)).toHaveCount(0);
    expect(await printed(app)).toBe(0);
    await click(page, 'cmdImprimer');
    await expect.poll(() => printed(app)).toBe(1);
    await expect(page.getByTestId(`doc-tab-report-${REPORT}`)).toHaveCount(0);

    // 10. no design: the button opening Design view is cancelled; F11 shows the pane, no Design View anywhere; the save is refused
    await click(page, 'cmdConception');
    await expect(page.getByTestId('macro-failed')).toBeVisible();
    await expect(page.getByTestId('macro-failed-message')).toHaveText(fill(fr.macro.error.actionCancelled, { action: fr.macro.action.OpenForm }));
    await page.getByTestId('macro-failed-stop').click();
    await expect(page.getByTestId('modal')).toHaveCount(0);
    await page.keyboard.press('F11');
    await expect(page.getByTestId('nav-pane')).toBeVisible();
    await page.getByTestId('nav-item-form-FMenu').click({ button: 'right' });
    await expect(page.getByTestId('nav-menu')).toBeVisible();
    await expect(page.getByTestId('nav-menu-design')).toHaveCount(0);
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('nav-menu')).toHaveCount(0);
    await checkView(page, 'viewDesign', (v) => expect(v).toHaveCount(0));
    await expect(page.getByTestId('status-view-design')).toHaveCount(0);
    await expect(page.evaluate(() => (window as unknown as Win).basecraft.objects.save('form', 'FMenu', {}, 'FMenu'))).rejects.toThrow(/No handler registered/);

    // 11. the full application, while the Runtime holds the base: read-only (R10)
    const full = await launchApp({ args: [base], env: FR, userDataDir: designer });
    try {
      await expect(full.page.getByTestId('banner-readonly')).toBeVisible();
      expect(await state(full.page)).toMatchObject({ readOnly: true, readOnlyReason: 'heldByOther' });
    } finally {
      await full.app.close();
    }

    // 12. « Quitter »: the Runtime exits
    const closed = app.waitForEvent('close');
    await click(page, 'cmdQuitter');
    await closed;
  } finally {
    await app.close().catch(() => undefined);
  }

  // 13. relaunched without a file; Shift + click on the recent base bypasses nothing: the title, FMenu, no pane, no bar (approved)
  ({ app, page } = await launchApp({ runtime: true, untrusted: true, userDataDir: thirdParty, env: FR }));
  try {
    await expect(page.getByTestId('bs-recent-0')).toHaveAttribute('title', base);
    await page.getByTestId('bs-recent-0').click({ modifiers: ['Shift'] });
    await runSqlYes(page);
    await expect.poll(() => windowTitle(app)).toBe(TITLE);
    await expect(page.getByTestId('doc-tab-form-FMenu')).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByTestId('nav-pane')).toHaveCount(0);
    await expect(page.getByTestId('banner-content')).toHaveCount(0);
    await expect.poll(() => count(page, 'Journal')).toBe(2);
  } finally {
    await app.close();
  }

  // ── Part 3: the designer again, Shift + Recent: everything shown, the third party's data there, Design view works ──
  ({ app, page } = await launchApp({ env: FR, userDataDir: designer }));
  try {
    await expect(page.getByTestId('bs-recent-0')).toHaveAttribute('title', base);
    await page.getByTestId('bs-recent-0').click({ modifiers: ['Shift'] });
    await expect(page.getByTestId('nav-pane')).toBeVisible();
    await expect(page.getByTestId('ribbon-tab-create')).toBeVisible();
    expect((await rowsOf(page, 'Commandes'))[5]).toEqual([6, 3, 5, null]);
    expect(await count(page, 'Journal')).toBe(2);
    await page.getByTestId('nav-item-form-FMenu').dblclick();
    await expect(page.getByTestId('doc-tab-form-FMenu')).toHaveAttribute('aria-selected', 'true');
    await pickView(page, 'viewDesign');
    await expect(page.getByTestId('form-design')).toBeVisible();
  } finally {
    await app.close();
  }
});
