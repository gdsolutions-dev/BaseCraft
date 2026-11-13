// Ruban, lot D1/D2 : la galerie Contrôles d'un état pose Bouton, Onglet, Cadre et Zone de liste (imprimés en dessin statique dans
// l'Aperçu avant impression) ; le bouton bascule se pose dans un formulaire et dans un état, s'enfonce quand sa valeur est vraie
// et écrit la valeur Oui/Non liée au clic.
import { test, expect, type Page } from '@playwright/test';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createTable } from '../../src/main/db/schema';
import type { DesignDoc } from '../../src/shared/design/model';
import { clients } from '../../src/shared/test-fixtures';
import { checkView, inFile, launchApp, pickView, seedBase, seedForm, seedReportsE2E } from './helpers';

const FR = { BASECRAFT_REGION: 'fr-FR' };
const cur = (page: Page) => page.locator('.doc:not([hidden])');
const body = (page: Page, kind: string) => cur(page).locator('.dz-block', { has: page.getByTestId(`section-${kind}`) }).locator('.dz-body');
/** The Insert Hyperlink dialog: the address, then the text to display. */
async function typeLink(page: Page, address: string, text: string) {
  await page.getByTestId('cmd-hyperlink').click();
  await page.getByTestId('modal-input').fill(address);
  await page.getByTestId('modal-btn-ok').click();
  await page.getByTestId('modal-input').fill(text);
  await page.getByTestId('modal-btn-ok').click();
}
const shot = (name: string) => join(process.env.E2E_SHOTS ?? tmpdir(), `ribbon-d-${name}.png`);

test('Report: Button, Tab Control, Option Group, List Box and Toggle Button are placed and printed', async () => {
  test.setTimeout(120000);
  const { app, page } = await launchApp({ args: [seedBase('etats-controles-d', seedReportsE2E)], env: FR });
  try {
    await page.getByTestId('ribbon-tab-create').click();
    await page.getByTestId('cmd-createReportDesign').click();
    await expect(cur(page).getByTestId('designer')).toBeVisible();
    await page.getByTestId('prop-RecordSource').fill('Factures');
    await page.getByTestId('prop-RecordSource').press('Enter');
    const detail = body(page, 'detail'), footer = body(page, 'pageFooter');
    const TOOLS: [string, string][] = [['button', 'Commande1'], ['optionGroup', 'Cadre1'], ['listBox', 'Liste1'], ['tabControl', 'OngletCtl1'], ['toggleButton', 'Bascule1']];
    for (const [i, [cmd, name]] of TOOLS.entries()) {
      await expect(page.getByTestId(`cmd-${cmd}`)).toBeEnabled();
      await expect(page.getByTestId(`cmd-${cmd}`)).not.toHaveAttribute('data-planned', /.+/);
      await page.getByTestId(`cmd-${cmd}`).click();
      await (i < 3 ? detail : footer).click({ position: { x: 20 + 150 * (i % 3), y: 8 } });   // three in the Detail, two in the Page Footer
      await expect(page.getByTestId(`ctl-${name}`), cmd).toBeVisible();
    }
    await expect(page.getByTestId('cmd-hyperlink')).not.toHaveAttribute('data-planned', /.+/);
    await page.getByTestId('cmd-hyperlink').click();   // an address that is not http, https or mailto is refused
    await page.getByTestId('modal-input').fill('file:///C:/Windows/notepad.exe');
    await page.getByTestId('modal-btn-ok').click();
    await expect(page.getByTestId('modal-error')).toBeVisible();
    await page.getByTestId('modal-btn-cancel').click();
    await typeLink(page, 'https://example.com/', 'Notre site');
    await expect(page.getByTestId('ctl-Étiquette1')).toContainText('Notre site');
    for (const kind of ['commandButton', 'optionGroup', 'listBox', 'tabControl', 'toggleButton']) expect(await page.getByTestId(`tool-${kind}`).count(), kind).toBe(1);   // the Toolbox lists them
    await pickView(page, 'viewPrintPreview');
    const sheet = cur(page).locator('.bc-page').first();
    await expect(sheet).toBeVisible();
    const printed = (caption: string) => sheet.locator('.bc-text', { hasText: caption }).first();
    await expect(printed('Commande1')).toBeVisible();   // the button's caption, on its grey face
    await expect(printed('Commande1')).toHaveCSS('background-color', 'rgb(225, 225, 225)');
    await expect(printed('Cadre1')).toBeVisible();      // the group's caption over its frame
    await expect(printed('Bascule1')).toBeVisible();
    await expect(printed('Page1')).toBeVisible();       // the tab control's pages
    await expect(printed('Page2')).toBeVisible();
    await expect(printed('Notre site')).toHaveCSS('color', 'rgb(5, 99, 193)');   // the hyperlink label is printed as a link
    await expect(printed('Notre site').locator('.bc-line')).toHaveCSS('text-decoration-line', 'underline');
    await page.screenshot({ path: shot('report-preview') });
  } finally {
    await app.close();
  }
});

const fiche: DesignDoc = { formatVersion: '1.0', recordSource: { kind: 'table', name: 'Clients' }, props: { Width: 9072 }, sections: [
  { kind: 'formHeader', height: 0, props: { Visible: false }, controls: [] },
  { kind: 'detail', height: 3402, props: {}, controls: [
    { kind: 'textBox', name: 'Nom', left: 1701, top: 0, width: 2268, height: 340, props: { ControlSource: 'Nom' } }] },
  { kind: 'formFooter', height: 0, props: { Visible: false }, controls: [] }] };

test('Form: a Toggle Button bound to a Yes/No field shows pressed when true and writes the value on click', async () => {
  test.setTimeout(120000);
  const path = seedBase('formulaire-bascule', (db) => {
    createTable(db, clients);
    db.exec(`INSERT INTO "Clients" ("Nom", "Actif") VALUES ('Ana', 0)`);
    seedForm(db, 'Fiche', fiche);
  });
  const { app, page } = await launchApp({ args: [path], env: FR });
  try {
    await page.getByTestId('nav-item-form-Fiche').click({ button: 'right' });
    await page.getByTestId('nav-menu-design').click();
    await expect(page.getByTestId('ctl-Nom')).toBeVisible();
    await page.getByTestId('cmd-toggleButton').click();
    await expect(page.getByTestId('cmd-toggleButton')).not.toHaveAttribute('data-planned', /.+/);
    await page.locator('[data-section-body="1"]').click({ position: { x: 200, y: 90 } });
    await expect(page.getByTestId('ctl-Bascule1')).toContainText('Bascule1');   // drawn as a button with its caption
    await page.getByTestId('ctl-Bascule1').click();
    await page.getByTestId('prop-ControlSource').fill('Actif');
    await page.getByTestId('prop-ControlSource').press('Enter');
    await page.getByTestId('prop-Caption').fill('Actif ?');
    await page.getByTestId('prop-Caption').press('Enter');
    await checkView(page, 'viewForm', (v) => expect(v).toBeEnabled());
    await pickView(page, 'viewForm');
    const toggle = page.getByTestId('form-ctl-Bascule1');
    await expect(toggle).toHaveText('Actif ?');
    await expect(toggle).toHaveAttribute('aria-pressed', 'false');
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-pressed', 'true');
    await page.screenshot({ path: shot('form-pressed') });
    await page.keyboard.press('Shift+Enter');   // saves the record
    await expect.poll(() => inFile<{ Actif: number }>(path, `SELECT "Actif" FROM "Clients" WHERE "Nom" = 'Ana'`)[0]?.Actif).toBe(1);
    await toggle.click();   // and back to false
    await expect(toggle).toHaveAttribute('aria-pressed', 'false');
    await page.keyboard.press('Shift+Enter');
    await expect.poll(() => inFile<{ Actif: number }>(path, `SELECT "Actif" FROM "Clients" WHERE "Nom" = 'Ana'`)[0]?.Actif).toBe(0);
  } finally {
    await app.close();
  }
});

test('Form: a hyperlink label is drawn as a link and its click asks before opening anything', async () => {
  test.setTimeout(120000);
  const path = seedBase('formulaire-lien', (db) => {
    createTable(db, clients);
    db.exec(`INSERT INTO "Clients" ("Nom") VALUES ('Ana')`);
    seedForm(db, 'Fiche', fiche);
  });
  const { app, page } = await launchApp({ args: [path], env: FR });
  try {
    await page.getByTestId('nav-item-form-Fiche').click({ button: 'right' });
    await page.getByTestId('nav-menu-design').click();
    await expect(page.getByTestId('ctl-Nom')).toBeVisible();
    await page.getByTestId('cmd-hyperlink').click();   // a file: address is refused, never stored
    await page.getByTestId('modal-input').fill('file:///C:/Windows/notepad.exe');
    await page.getByTestId('modal-btn-ok').click();
    await expect(page.getByTestId('modal-error')).toBeVisible();
    await page.getByTestId('modal-btn-cancel').click();
    await expect(page.getByTestId('ctl-Étiquette1')).toHaveCount(0);
    await typeLink(page, 'https://example.com/docs', 'Documentation');
    await expect(page.getByTestId('ctl-Étiquette1')).toContainText('Documentation');
    await expect(page.getByTestId('ctl-Étiquette1').locator('.fz')).toHaveCSS('text-decoration-line', 'underline');   // the design preview draws a link too
    await page.getByTestId('ctl-Étiquette1').click();
    await expect(page.getByTestId('prop-HyperlinkAddress')).toHaveValue('https://example.com/docs');
    await checkView(page, 'viewForm', (v) => expect(v).toBeEnabled());
    await pickView(page, 'viewForm');
    const link = page.getByTestId('form-ctl-Étiquette1');
    await expect(link).toHaveText('Documentation');
    await expect(link).toHaveAttribute('role', 'link');
    await expect(link).toHaveCSS('text-decoration-line', 'underline');
    await expect(link).toHaveCSS('cursor', 'pointer');
    await page.screenshot({ path: shot('form-link') });
    await link.click();   // asks first; declined, nothing is opened
    await expect(page.getByTestId('modal')).toContainText('https://example.com/docs');
    await page.getByTestId('modal-btn-no').click();
    await expect(page.getByTestId('modal')).toHaveCount(0);
    await link.focus();
    await page.keyboard.press('Enter');   // the keyboard asks as well
    await expect(page.getByTestId('modal')).toBeVisible();
    await page.getByTestId('modal-btn-no').click();
    await expect(page.getByTestId('modal')).toHaveCount(0);
  } finally {
    await app.close();
  }
});

const liste: DesignDoc = { formatVersion: '1.0', recordSource: { kind: 'table', name: 'Clients' }, props: { Width: 5670 }, sections: [
  { kind: 'formHeader', height: 0, props: { Visible: false }, controls: [] },
  { kind: 'detail', height: 1134, props: {}, controls: [
    { kind: 'textBox', name: 'NomListe', left: 1134, top: 113, width: 2268, height: 340, props: { ControlSource: 'Nom' } }] },
  { kind: 'formFooter', height: 0, props: { Visible: false }, controls: [] }] };

test('Form: a Navigation Control shows the form of its active tab, and says a report cannot be shown yet', async () => {
  test.setTimeout(120000);
  const path = seedBase('formulaire-navigation', (db) => {
    createTable(db, clients);
    db.exec(`INSERT INTO "Clients" ("Nom") VALUES ('Ana')`);
    seedForm(db, 'Fiche', fiche);
    seedForm(db, 'Liste', liste);
  });
  const { app, page } = await launchApp({ args: [path], env: FR });
  try {
    await page.getByTestId('nav-item-form-Fiche').click({ button: 'right' });
    await page.getByTestId('nav-menu-design').click();
    await expect(page.getByTestId('ctl-Nom')).toBeVisible();
    await expect(page.getByTestId('cmd-navigationControl')).not.toHaveAttribute('data-planned', /.+/);
    await page.getByTestId('cmd-navigationControl').click();
    await page.locator('[data-section-body="1"]').click({ position: { x: 20, y: 60 } });
    await expect(page.getByTestId('ctl-Navigation1')).toBeVisible();
    await page.getByTestId('prop-NavigationTargets').fill('Clients|form:Liste\nÉtats|report:Rapport');
    await page.getByTestId('prop-NavigationTargets').blur();
    await expect(page.getByTestId('ctl-Navigation1')).toContainText('Clients');   // the design draws the tab strip
    await expect(page.getByTestId('ctl-Navigation1')).toContainText('États');
    await checkView(page, 'viewForm', (v) => expect(v).toBeEnabled());
    await pickView(page, 'viewForm');
    const tab = page.getByTestId('form-nav-tab-Navigation1-0');
    await expect(tab).toHaveText('Clients');
    await expect(tab).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByTestId('form-ctl-NomListe')).toHaveValue('Ana');   // the target form, inside the control
    await page.screenshot({ path: shot('form-navigation') });
    await page.getByTestId('form-nav-tab-Navigation1-1').click();
    await expect(page.getByTestId('form-nav-report')).toBeVisible();
    await expect(page.getByTestId('form-ctl-NomListe')).toHaveCount(0);
    await tab.click();
    await expect(page.getByTestId('form-ctl-NomListe')).toHaveValue('Ana');
  } finally {
    await app.close();
  }
});
