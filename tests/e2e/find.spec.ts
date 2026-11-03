// « Rechercher et remplacer », onglet Rechercher (O2 tâche 8, R10) : Ctrl+F et Accueil › Rechercher dans une feuille de données
// et dans un formulaire (unique, continu), valeurs par défaut de l'option « Rechercher/Remplacer par défaut », Où, Sens, Respecter
// la casse, Rechercher les champs mis en forme ; boîte non modale ; enregistrement refusé qui arrête la recherche.
import { test, expect, type Page } from '@playwright/test';
import { seedSales } from '../../src/main/query/test-db';
import type { AppSettings, BasecraftApi } from '../../src/shared/api';
import type { ControlDef, DesignDoc } from '../../src/shared/design/model';
import { colLeft, launchApp, seedBase, seedForm } from './helpers';

type W = { basecraft: BasecraftApi };
const FR = { BASECRAFT_REGION: 'fr-FR' };
const HEADER = 34, ROW = 30;
const box = (name: string, left: number, top: number, tab: number): ControlDef =>
  ({ kind: 'textBox', name, left, top, width: 1500, height: 340, props: { ControlSource: name, TabIndex: tab } });
const formOf = (detail: ControlDef[], props: Record<string, unknown>, height: number): DesignDoc => ({
  formatVersion: '1.0', recordSource: { kind: 'table', name: 'Clients' }, props: { Width: 9000, ...props },
  sections: [
    { kind: 'formHeader', height: 0, props: { Visible: false }, controls: [] },
    { kind: 'detail', height, props: {}, controls: detail },
    { kind: 'formFooter', height: 0, props: { Visible: false }, controls: [] },
  ],
});
// Clients: Dupont / Lyon, Martin / LYON, Durand / Paris, Éric / Lyôn; Commandes: a sixth order of 1 200 €
const base = () => seedBase('fx-rechercher', (db) => {
  seedSales(db);
  db.prepare('INSERT INTO "Commandes" ("Client", "Montant", "Le") VALUES (1, 1200, \'2026-11-01 00:00:00\')').run();
  seedForm(db, 'FClient', formOf([box('Nom', 100, 100, 0), box('Ville', 100, 600, 1)], {}, 1200));
  seedForm(db, 'FListe', formOf([box('Nom', 100, 100, 0), box('Ville', 1800, 100, 1)], { DefaultView: 'continuous' }, 500));
});

const vis = (page: Page, id: string) => page.locator(`[data-testid="${id}"]:visible`);
const sheet = (page: Page) => vis(page, 'datasheet');
const cell = (page: Page, col: number, row: number) => sheet(page).getByTestId(`glide-cell-${col + 1}-${row}`);
const selected = (page: Page, col: number, row: number) => expect(cell(page, col, row)).toHaveAttribute('aria-selected', 'true');
async function clickCell(page: Page, col: number, row: number) {
  const b = (await sheet(page).getByTestId('data-grid-canvas').boundingBox())!;
  await page.mouse.click(b.x + colLeft(col) + 20, b.y + HEADER + row * ROW + ROW / 2);
  await selected(page, col, row);
}
async function openSheet(page: Page, table: string) {
  await page.getByTestId(`nav-item-${table}`).dblclick();
  await expect(sheet(page).getByTestId('data-grid-canvas')).toBeVisible();
  await expect(cell(page, 0, 0)).toBeAttached();
}
const set = (page: Page, v: AppSettings['findReplaceDefault']) =>
  page.evaluate((val) => (window as unknown as W).basecraft.app.setSetting('findReplaceDefault', val), v);
const dialog = (page: Page) => vis(page, 'find-dialog');
async function next(page: Page, what?: string) {
  if (what !== undefined) await vis(page, 'find-what').fill(what);
  await vis(page, 'find-next').click();
}
/** « Élément recherché introuvable. », then OK: the Find dialog stays open. */
async function notFound(page: Page) {
  await expect(page.getByTestId('modal')).toContainText(/introuvable/);
  await page.getByTestId('modal-btn-ok').click();
  await expect(page.getByTestId('modal')).toHaveCount(0);
  await expect(dialog(page)).toBeVisible();
}

test('a datasheet: Ctrl+F opens the dialog with the « Recherche rapide » defaults; Next, Search, Match Case; modeless', async () => {
  const { app, page } = await launchApp({ args: [base()], env: FR });
  try {
    await openSheet(page, 'Clients');
    await clickCell(page, 2, 0);   // Ville, Lyon
    await page.keyboard.press('Control+f');
    await expect(dialog(page)).toBeVisible();
    await expect(dialog(page)).not.toHaveAttribute('aria-modal', 'true');
    await expect(vis(page, 'find-what')).toBeFocused();
    await expect(vis(page, 'find-look-in')).toHaveValue('field');   // Champ actif
    await expect(vis(page, 'find-match')).toHaveValue('whole');     // Champ entier
    await expect(vis(page, 'find-search')).toHaveValue('all');      // Tout
    await expect(vis(page, 'find-case')).not.toBeChecked();
    await expect(vis(page, 'find-formatted')).toBeChecked();
    await expect(vis(page, 'find-tab-replace')).toBeDisabled();
    await expect(vis(page, 'find-next')).toBeDisabled();             // nothing to find yet

    // Lyon, case ignored, accents kept (B2 R13): LYON, then Lyon from the top, never Lyôn
    await next(page, 'Lyon');
    await selected(page, 2, 1);
    await expect(vis(page, 'nav-record-input')).toHaveValue('2');
    await expect(dialog(page)).toBeVisible();
    await expect(vis(page, 'find-next')).toBeFocused();   // the match is selected behind, the focus stays in the dialog
    await vis(page, 'find-what').press('Enter');   // Enter = Suivant
    await selected(page, 2, 0);
    // an IME composition's Enter and Escape are the composition's: no Suivant, no close
    for (const key of ['Enter', 'Escape']) {
      await vis(page, 'find-what').evaluate((el, k) => el.dispatchEvent(new KeyboardEvent('keydown', { key: k, isComposing: true, bubbles: true })), key);
    }
    await expect(dialog(page)).toBeVisible();
    await selected(page, 2, 0);

    // modeless: a click on the sheet behind, the dialog stays and searches from there
    await clickCell(page, 2, 2);   // Paris
    await expect(dialog(page)).toBeVisible();
    await next(page);
    await selected(page, 2, 0);
    // Down: LYON, then nothing more (no wrap, Lyôn is not Lyon); Up: Lyon
    await vis(page, 'find-search').selectOption('down');
    await next(page);
    await selected(page, 2, 1);
    await next(page);
    await notFound(page);
    await selected(page, 2, 1);
    await vis(page, 'find-search').selectOption('up');
    await next(page);
    await selected(page, 2, 0);
    // Champ entier: « Ly » is not a whole field
    await vis(page, 'find-search').selectOption('all');
    await next(page, 'Ly');
    await notFound(page);
    // Match Case: lyon is not there, Lyon is
    await vis(page, 'find-case').check();
    await next(page, 'lyon');
    await notFound(page);
    await next(page, 'Lyon');
    await selected(page, 2, 0);
    // Escape = Annuler; the focus back on the sheet
    await vis(page, 'find-what').press('Escape');
    await expect(dialog(page)).toHaveCount(0);

    // « Recherche générale »: reopened (Home › Find) on Document actif, N'importe où; the last text kept; Ly in the Ville column
    await set(page, 'general');
    await clickCell(page, 1, 1);   // Nom, Martin
    await page.getByTestId('ribbon-tab-home').click();
    await page.getByTestId('cmd-find').click();
    await expect(vis(page, 'find-look-in')).toHaveValue('document');
    await expect(vis(page, 'find-match')).toHaveValue('anywhere');
    await expect(vis(page, 'find-what')).toHaveValue('Lyon');
    await next(page, 'Ly');
    await selected(page, 2, 1);   // LYON, the next cell of the row
    await vis(page, 'find-cancel').click();

    // « Début de champ »: Champ actif, Début de champ; « Ly » found in Ville
    await set(page, 'startOfField');
    await page.keyboard.press('Control+f');
    await expect(vis(page, 'find-look-in')).toHaveValue('field');
    await expect(vis(page, 'find-match')).toHaveValue('start');
    await next(page, 'Ly');
    await selected(page, 2, 3);
    await page.keyboard.press('Escape');
  } finally {
    await app.close();
  }
});

test('a datasheet: Search Fields As Formatted, then the stored value; a refused save stops the search', async () => {
  const { app, page } = await launchApp({ args: [base()], env: FR });
  try {
    await openSheet(page, 'Commandes');
    await clickCell(page, 2, 0);   // Montant
    await page.keyboard.press('Control+f');
    await next(page, '1 200,00 €');   // as shown (the region's no-break spaces read as spaces)
    await selected(page, 2, 5);
    await clickCell(page, 2, 0);
    await next(page, '1200');
    await notFound(page);
    await vis(page, 'find-formatted').uncheck();
    await next(page);
    await selected(page, 2, 5);
    await page.keyboard.press('Escape');

    // Clients: Nom is required; emptied, the search saves the row first: refused, its message, and the selection stays
    await openSheet(page, 'Clients');
    await clickCell(page, 1, 0);
    await page.keyboard.press('Delete');
    await page.keyboard.press('Control+f');
    await next(page, 'Durand');
    await expect(page.getByTestId('modal')).toBeVisible();
    await expect(page.getByTestId('modal')).not.toContainText(/introuvable/);
    await page.getByTestId('modal-btn-ok').click();
    await selected(page, 1, 0);
    await expect(dialog(page)).toBeVisible();
    await expect(vis(page, 'grid-pencil')).toBeVisible();   // the emptied Nom is still pending
    await expect(cell(page, 1, 0)).toHaveText('');
    await vis(page, 'find-cancel').click();

    // the row being edited is saved only when the search moves to another row: not when nothing is found, nor in the same row
    await clickCell(page, 1, 0);   // the selected cell again: its editor (the dialog's late focus must not take a key)
    await page.keyboard.type('Dupond');
    await page.keyboard.press('Tab');   // Ville, Lyon: the row still pending
    await selected(page, 2, 0);
    await expect(vis(page, 'grid-pencil')).toBeVisible();
    await page.keyboard.press('Control+f');
    await next(page, 'Personne');
    await notFound(page);
    await expect(vis(page, 'grid-pencil')).toBeVisible();
    await vis(page, 'find-case').check();
    await next(page, 'Lyon');   // only this row's Lyon
    await selected(page, 2, 0);
    await expect(vis(page, 'grid-pencil')).toBeVisible();
    await vis(page, 'find-case').uncheck();
    await next(page);   // LYON, the next row: this one saved first
    await selected(page, 2, 1);
    await expect(vis(page, 'grid-pencil')).toHaveCount(0);
    await expect(cell(page, 1, 0)).toHaveText('Dupond');
  } finally {
    await app.close();
  }
});

test('a datasheet: the dialog closed, a click then fast typing loses no key', async () => {
  const { app, page } = await launchApp({ args: [base()], env: FR });
  try {
    await openSheet(page, 'Clients');
    for (const row of [1, 2]) {
      await clickCell(page, 1, row);
      await page.keyboard.press('Control+f');
      await vis(page, 'find-cancel').click();
      await clickCell(page, 1, row);   // the selected cell again: its editor, while the dialog's focus is still to come
      await page.keyboard.press('Control+a');
      await page.keyboard.type('Dupond');
      await expect(page.locator('#portal textarea')).toHaveValue('Dupond');
      await page.keyboard.press('Escape');
      await expect(page.locator('#portal textarea')).toHaveCount(0);
    }
    for (const row of [1, 2]) {
      await page.keyboard.press('Control+f');
      await page.keyboard.press('Escape');
      await clickCell(page, 1, row);   // another cell, then typing opens its editor
      await page.keyboard.type('Dupond');
      await page.keyboard.press('Tab');
      await expect(cell(page, 1, row)).toHaveText('Dupond');
    }
  } finally {
    await app.close();
  }
});

test('forms: Home › Find in a single form and in a continuous form moves the record', async () => {
  const { app, page } = await launchApp({ args: [base()], env: FR });
  try {
    for (const [form, what, record] of [['FClient', 'Martin', '2'], ['FListe', 'Durand', '3']] as const) {
      await page.getByTestId(`nav-item-form-${form}`).dblclick();
      await expect(page.getByTestId(`doc-tab-form-${form}`)).toHaveAttribute('aria-selected', 'true');
      await expect(vis(page, 'nav-record-input').first()).toHaveValue('1');
      await vis(page, 'form-ctl-Nom').first().click();
      await page.getByTestId('ribbon-tab-home').click();
      await page.getByTestId('cmd-find').click();
      await expect(vis(page, 'find-look-in')).toHaveValue('field');
      await expect(vis(page, 'find-tab-replace')).toBeDisabled();
      await next(page, what);
      await expect(vis(page, 'nav-record-input').first()).toHaveValue(record);
      await expect(dialog(page)).toBeVisible();
      await expect(vis(page, 'find-next')).toBeFocused();
      await next(page, 'Personne');
      await notFound(page);
      await vis(page, 'find-cancel').click();
      await expect(dialog(page)).toHaveCount(0);
    }

    // FClient: the record being edited is saved only when the search moves to another record
    await page.getByTestId('doc-tab-form-FClient').click();
    await vis(page, 'nav-record-input').first().fill('1');
    await vis(page, 'nav-record-input').first().press('Enter');
    await vis(page, 'form-ctl-Nom').first().fill('Dupond');
    await vis(page, 'form-ctl-Ville').first().click();   // Lyon, the record pending
    await expect(vis(page, 'form-dirty')).toBeVisible();
    await page.getByTestId('ribbon-tab-home').click();
    await page.getByTestId('cmd-find').click();
    await next(page, 'Personne');
    await notFound(page);
    await expect(vis(page, 'form-dirty')).toBeVisible();
    await vis(page, 'find-case').check();
    await next(page, 'Lyon');   // only this record's
    await expect(vis(page, 'nav-record-input').first()).toHaveValue('1');
    await expect(vis(page, 'form-dirty')).toBeVisible();
    await vis(page, 'find-case').uncheck();
    await next(page);   // LYON: record 2, record 1 saved first
    await expect(vis(page, 'nav-record-input').first()).toHaveValue('2');
    await expect(vis(page, 'form-dirty')).toHaveCount(0);
    // « Document actif »: the control where the match is becomes the form's; the dialog keeps the focus, Annuler gives it there
    await vis(page, 'find-look-in').selectOption('document');
    await next(page, 'Éric');   // in Nom, record 4 (from Ville)
    await expect(vis(page, 'nav-record-input').first()).toHaveValue('4');
    await expect(vis(page, 'find-next')).toBeFocused();
    await vis(page, 'find-cancel').click();
    await expect(vis(page, 'form-ctl-Nom').first()).toBeFocused();
  } finally {
    await app.close();
  }
});
