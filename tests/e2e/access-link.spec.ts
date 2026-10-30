import { test, expect, type Page } from '@playwright/test';
import { copyFileSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ACCESS_EXPECTED, ACCESS_PASSWORD } from '../fixtures/access/expected';
import { launchApp, seedBase } from './helpers';

const fr = JSON.parse(readFileSync(join(__dirname, '../../src/shared/i18n/fr.json'), 'utf8'));
const FR = { BASECRAFT_REGION: 'fr-FR' };
const FIXTURES = join(__dirname, '../fixtures/access');
const cell = (page: Page, col: number, row: number) => page.getByTestId(`glide-cell-${col + 1}-${row}`);
const cellEditor = (page: Page) => page.getByTestId('grid-editor-portal').locator('textarea');

/** The fixtures copied to a temp folder (a front-end links the copy, never the committed file). */
function copies(): { plain: string; locked: string } {
  const dir = mkdtempSync(join(tmpdir(), 'basecraft-access-'));
  for (const n of ['Ventes.accdb', 'Ventes-mdp.accdb']) copyFileSync(join(FIXTURES, n), join(dir, n));
  return { plain: join(dir, 'Ventes.accdb'), locked: join(dir, 'Ventes-mdp.accdb') };
}
async function openSheet(page: Page, name: string) {
  await page.getByTestId(`nav-item-${name}`).dblclick();
  await expect(page.getByTestId('datasheet').getByTestId('data-grid-canvas')).toBeVisible();
}
async function typePassword(page: Page, password: string) {
  const input = page.getByTestId('modal-input');
  await expect(input).toHaveAttribute('type', 'password');
  await input.fill(password);
  await page.getByTestId('modal-btn-ok').click();
}

test('C2: link an Access file (read-only), a protected one asks its password, relaunch and Runtime ask again', async () => {
  test.setTimeout(120_000);
  const { plain, locked } = copies();
  const front = seedBase('Front');
  let { app, page, userDataDir } = await launchApp({ args: [front], env: { ...FR, BASECRAFT_E2E_LINK_PATH: plain } });
  try {
    // 1. External Data > Link Access Database: the file's tables, Photo (attachment) named as not linked; Clients and Commandes linked
    await page.getByTestId('ribbon-tab-externalData').click();
    await expect(page.getByTestId('cmd-linkAccess')).toHaveText(fr.ribbon.cmd.linkAccess);
    await page.getByTestId('cmd-linkAccess').click();
    await expect(page.getByTestId('link-dialog')).toBeVisible();
    await expect(page.getByTestId('link-kind')).toHaveText(fr.link.kind.access);
    for (const n of ['Clients', 'Commandes', 'Divers']) await expect(page.getByTestId(`link-table-${n}`)).toBeVisible();
    await expect(page.getByTestId('link-skipped-Clients')).toHaveText(fr.link.skipped.replace('{{names}}', 'Photo'));
    await expect(page.getByTestId('link-skipped-Commandes')).toHaveCount(0);
    await page.getByTestId('link-table-Clients').check();
    await page.getByTestId('link-table-Commandes').check();
    await page.getByTestId('link-ok').click();
    await expect(page.getByTestId('link-dialog')).toHaveCount(0);
    await expect(page.getByTestId('nav-item-link-Clients')).toBeVisible();
    await expect(page.getByTestId('nav-item-link-Commandes')).toBeVisible();

    // 2. Clients: its 4 rows, read-only, no Rename, a read-only Design view
    await openSheet(page, 'Clients');
    await expect(page.getByTestId('nav-record-count')).toHaveText('4');
    for (const [r, row] of ACCESS_EXPECTED.clients.entries()) for (const c of [0, 1, 2]) await expect(cell(page, c, r)).toHaveText(String(row[c]));
    await expect(page.getByTestId('nav-readonly')).toHaveText(fr.query.readOnly);
    await expect(page.getByTestId('nav-new')).toBeDisabled();
    // a click on row 0's first cell (MARKER 44, HEADER 34, ROW 30), then the arrow: Nom
    const b = (await page.getByTestId('datasheet').getByTestId('data-grid-canvas').boundingBox())!;
    await page.mouse.click(b.x + 44 + 20, b.y + 34 + 15);
    await expect(cell(page, 0, 0)).toBeFocused();
    await page.keyboard.press('ArrowRight');
    await expect(cell(page, 1, 0)).toBeFocused();
    await page.keyboard.press('X');
    await expect(cellEditor(page)).toHaveCount(0);
    await expect(cell(page, 1, 0)).toHaveText('Dupont');
    await page.getByTestId('nav-item-Clients').click({ button: 'right' });
    await expect(page.getByTestId('nav-menu')).toBeVisible();
    await expect(page.getByTestId('nav-menu-rename')).toHaveCount(0);
    // its Design view, after the warning: the design BaseCraft built from the Access file, read-only (C1 R8)
    await page.getByTestId('nav-menu-design').click();
    await expect(page.getByTestId('modal')).toContainText(fr.link.designWarning.replace('{{name}}', 'Clients'));
    await page.getByTestId('modal-btn-yes').click();
    await expect(page.getByTestId('design-link-banner')).toContainText('Ventes.accdb');
    for (const [i, n] of ['N°', 'Nom', 'Ville'].entries()) await expect(page.getByTestId(`design-row-${i}-name`)).toHaveValue(n);
    await expect(page.getByTestId('design-row-1-name')).toBeDisabled();
    await page.getByTestId('ribbon-tab-home').click();
    await expect(page.getByTestId('cmd-save')).toBeDisabled();
    await page.getByTestId('doc-tab-close-Clients').click();
    await page.getByTestId('ribbon-tab-externalData').click();

    // 3. the protected copy: the password prompt (hidden field), a wrong one refused, the right one lists the tables
    await app.evaluate((_e, p) => { process.env.BASECRAFT_E2E_LINK_PATH = p; }, locked);
    await page.getByTestId('cmd-linkAccess').click();
    await expect(page.getByTestId('modal')).toContainText(fr.link.password.label.replace('{{path}}', locked));
    await typePassword(page, 'faux');
    await expect(page.getByTestId('modal-error')).toHaveText(fr.link.password.wrong);
    await typePassword(page, ACCESS_PASSWORD);
    await expect(page.getByTestId('link-dialog')).toBeVisible();
    for (const n of ['Clients', 'Commandes', 'Divers']) await expect(page.getByTestId(`link-table-${n}`)).toBeVisible();
    await expect(page.getByTestId('link-table-Clients')).toBeDisabled(); // the name is taken (R2)
    await page.getByTestId('link-table-Divers').check();
    await page.getByTestId('link-ok').click();
    await expect(page.getByTestId('nav-item-link-Divers')).toBeVisible();
    await openSheet(page, 'Divers');
    await expect(page.getByTestId('nav-record-count')).toHaveText('1');
    await app.close();

    // 4. relaunched on the same front-end: the password is asked again (one prompt); Cancel says the file is protected
    ({ app, page } = await launchApp({ args: [front], env: FR, userDataDir }));
    await page.getByTestId('nav-item-Divers').dblclick();
    await expect(page.getByTestId('modal-input')).toHaveAttribute('type', 'password');
    await expect(page.getByTestId('modal-input')).toHaveCount(1);
    await page.getByTestId('modal-btn-cancel').click();
    await expect(page.getByTestId('modal')).toContainText(fr.dialog.error.linkUnavailable_needsPassword.split(' : ')[0]);
    await page.getByTestId('modal-btn-ok').click();
    await page.getByTestId('doc-tab-close-Divers').click(); // the refused tab stays empty: open the table again, in Design view
    await page.getByTestId('nav-item-Divers').click({ button: 'right' });
    await page.getByTestId('nav-menu-design').click();
    await page.getByTestId('modal-btn-yes').click(); // the warning, then the password as for its Datasheet
    await typePassword(page, ACCESS_PASSWORD);
    await expect(page.getByTestId('design-link-banner')).toContainText('Ventes-mdp.accdb');
    await page.getByTestId('status-view-datasheet').click();
    await expect(page.getByTestId('nav-record-count')).toHaveText('1');
    await app.close();

    // 5. the Runtime on the same front-end: Clients opens, Divers asks the password (R7), no link can be created
    ({ app, page } = await launchApp({ runtime: true, args: [front], env: FR, userDataDir }));
    await openSheet(page, 'Clients');
    await expect(page.getByTestId('nav-record-count')).toHaveText('4');
    await page.getByTestId('doc-tab-close-Clients').click();
    await page.getByTestId('nav-item-Divers').dblclick();
    await typePassword(page, ACCESS_PASSWORD);
    await expect(page.getByTestId('nav-record-count')).toHaveText('1');
    const created = await page.evaluate((p) => {
      const l = (window as unknown as { basecraft: { links: { create(p: string, n: string[]): Promise<unknown> } } }).basecraft.links;
      return l.create(p, ['Commandes']).then(() => 'resolved', () => 'rejected');
    }, plain);
    expect(created).toBe('rejected');
  } finally {
    await app.close();
  }
});
