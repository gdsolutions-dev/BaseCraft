// Largeur colonne d'un formulaire (Feuille de données) de bout en bout : largeur tirée gardée au passage Formulaire <-> Feuille de
// données sans question, question d'enregistrement à la fermeture (Annuler, Oui, Non), propriété Largeur colonne (cm) en Création.
import { test, expect, type Page } from '@playwright/test';
import { createTable } from '../../src/main/db/schema';
import type { ControlDef, DesignDoc } from '../../src/shared/design/model';
import { createLayout, membersOf } from '../../src/shared/design/layout-edit';
import { f, t } from '../../src/shared/test-fixtures';
import { launchApp, seedBase, seedForm, pickView } from './helpers';

const FR = { BASECRAFT_REGION: 'fr-FR' };
const fld = (name: string, top: number): ControlDef => ({ kind: 'textBox', name, left: 1500, top, width: 2268, height: 340, props: { ControlSource: name },
  children: [{ kind: 'label', name: `${name}_Étiquette`, left: 100, top, width: 1200, height: 340, props: { Caption: `${name}:` } }] });
const plain: DesignDoc = { formatVersion: '1.0', recordSource: { kind: 'table', name: 'Clients' }, props: {}, sections: [
  { kind: 'formHeader', height: 0, props: { Visible: false }, controls: [] },
  { kind: 'detail', height: 1500, props: {}, controls: [fld('Nom', 200), fld('Ville', 700)] },
  { kind: 'formFooter', height: 0, props: { Visible: false }, controls: [] }] };
const file = () => seedBase('fx-largeur-colonne', (db) => {
  createTable(db, t('Clients', [f('Nom', 'shortText'), f('Ville', 'shortText')]));
  db.exec(`INSERT INTO "Clients"("Nom", "Ville") VALUES ('Dupont', 'Lyon'), ('Martin', 'Nice')`);
  seedForm(db, 'Fiche', createLayout(plain, membersOf(plain, ['Nom', 'Ville']), 'stacked', { headerSection: 'formHeader' }));
});

const shown = (page: Page, id: string) => page.locator(`[data-testid="${id}"]:visible`);
/** First column's width in px, read from the drawn grid: the x of the first vertical border line, in the header's top margin (the
 *  accessible DOM has no widths). */
const width = (page: Page, _col: number) => shown(page, 'form-datasheet').getByTestId('data-grid-canvas').evaluate((c: HTMLCanvasElement) => {
  const k = c.width / c.getBoundingClientRect().width, d = c.getContext('2d')!.getImageData(0, 3 * k, c.width, 1).data;
  const lum = (i: number) => d[i * 4]! + d[i * 4 + 1]! + d[i * 4 + 2]!;
  for (let i = Math.round(60 * k); i < c.width - 1; i++) if (lum(i) < lum(i - 3) - 30 && lum(i) < lum(i + 3) - 30) return i / k - 44;
  return 0;
});
const near = (page: Page, px: number) => expect.poll(async () => Math.abs((await width(page, 0)) - px)).toBeLessThanOrEqual(2);
const MARKER = 44, HEADER = 34;
/** Tire le bord droit de l'en-tête de la première colonne de dx px (Glide : le bord de la colonne). */
async function drag(page: Page, dx: number) {
  await page.waitForTimeout(600);   // Glide prend deux relâchements à moins de 500 ms pour un double clic (ajustement automatique)
  const b = (await shown(page, 'form-datasheet').getByTestId('data-grid-canvas').boundingBox())!;
  const w = await width(page, 0);
  await page.mouse.move(b.x + MARKER + w - 2, b.y + HEADER / 2);
  await page.mouse.down();
  await page.mouse.move(b.x + MARKER + w + dx, b.y + HEADER / 2, { steps: 5 });
  await page.mouse.up();
}
const close = (page: Page) => page.getByTestId('doc-tab-close-form-Fiche').click();
async function open(page: Page) {
  await page.getByTestId('nav-item-form-Fiche').dblclick();
  await pickView(page, 'viewDatasheet');
  await expect(shown(page, 'form-datasheet')).toBeVisible();
}

test('Column Width: dragged width kept between views, asked on close (Cancel, Yes, No), Property Sheet in cm', async () => {
  const { app, page } = await launchApp({ args: [file()], env: FR });
  try {
    await open(page);
    const w0 = await width(page, 0);
    await drag(page, 80);
    const w1 = await width(page, 0);
    expect(w1).toBeGreaterThan(w0 + 60);

    // Form view and back: no question, the width kept
    await pickView(page, 'viewForm');
    await expect(page.getByTestId('modal')).toHaveCount(0);
    await pickView(page, 'viewDatasheet');
    await expect(page.getByTestId('modal')).toHaveCount(0);
    await near(page, w1);

    // closing: the question; Cancel keeps the tab and the width
    await close(page);
    await expect(page.getByTestId('modal')).toBeVisible();
    await page.getByTestId('modal-btn-cancel').click();
    await expect(shown(page, 'form-datasheet')).toBeVisible();
    await near(page, w1);

    // Yes: saved; reopened, the same width
    await close(page);
    await page.getByTestId('modal-btn-yes').click();
    await expect(page.getByTestId('doc-tab-form-Fiche')).toHaveCount(0);
    await open(page);
    await near(page, w1);

    // Design view: Column Width in cm; 5 cm = 189 px
    await page.getByTestId('status-view-design').click();
    await page.locator('.doc:not([hidden])').getByTestId('ctl-Nom').click();
    await page.getByTestId('sheet-tab-format').click();
    const cw = page.getByTestId('prop-ColumnWidth');
    await expect(cw).toBeVisible();
    await expect(cw).not.toHaveValue('');
    await cw.fill('5');
    await cw.press('Enter');
    await page.keyboard.press('Control+s');
    await pickView(page, 'viewDatasheet');
    await expect(shown(page, 'form-datasheet')).toBeVisible();
    await near(page, 189);

    // dragged again, closed with No: reopened at 5 cm
    await drag(page, 60);
    await close(page);
    await page.getByTestId('modal-btn-no').click();
    await expect(page.getByTestId('doc-tab-form-Fiche')).toHaveCount(0);
    await open(page);
    await near(page, 189);
  } finally {
    await app.close();
  }
});

// Sous-formulaire en Feuille de données : ses largeurs tirées sont demandées et enregistrées avec le formulaire principal.
const withSub = () => seedBase('fx-largeur-sousform', (db) => {
  createTable(db, t('Clients', [f('Nom', 'shortText'), f('Ville', 'shortText')]));
  db.exec(`INSERT INTO "Clients"("Nom", "Ville") VALUES ('Dupont', 'Lyon'), ('Martin', 'Nice')`);
  const sheet = createLayout(plain, membersOf(plain, ['Nom', 'Ville']), 'stacked', { headerSection: 'formHeader' });
  seedForm(db, 'Fiche', { ...sheet, props: { ...sheet.props, DefaultView: 'datasheet' } });
  seedForm(db, 'Principal', { formatVersion: '1.0', recordSource: { kind: 'table', name: 'Clients' }, props: { Width: 9000 }, sections: [
    { kind: 'formHeader', height: 0, props: { Visible: false }, controls: [] },
    { kind: 'detail', height: 4000, props: {}, controls: [fld('Nom', 100),
      { kind: 'subform', name: 'Sous', left: 100, top: 800, width: 8500, height: 3000, props: { SourceObject: 'Fiche', TabIndex: 1 } }] },
    { kind: 'formFooter', height: 0, props: { Visible: false }, controls: [] }] });
});
const closeMaster = (page: Page) => page.getByTestId('doc-tab-close-form-Principal').click();
async function openMaster(page: Page) {
  await page.getByTestId('nav-item-form-Principal').dblclick();
  await expect(shown(page, 'form-datasheet')).toBeVisible();
}

for (const answer of ['yes', 'no'] as const) {
  test(`Subform datasheet widths: asked with the main form on close, ${answer}`, async () => {
    const { app, page } = await launchApp({ args: [withSub()], env: FR });
    try {
      await openMaster(page);
      const w0 = await width(page, 0);
      await drag(page, 80);
      const w1 = await width(page, 0);
      expect(w1).toBeGreaterThan(w0 + 60);
      await closeMaster(page);
      await expect(page.getByTestId('modal')).toContainText('Principal');
      await page.getByTestId(`modal-btn-${answer}`).click();
      await expect(page.getByTestId('doc-tab-form-Principal')).toHaveCount(0);
      await openMaster(page);
      if (answer === 'no') { await near(page, w0); return; }
      await near(page, w1);
      // the subform's own form stores it (ColumnWidth)
      await page.getByTestId('nav-item-form-Fiche').dblclick();
      await expect(page.getByTestId('doc-tab-form-Fiche')).toBeVisible();
      await near(page, w1);
    } finally {
      await app.close();
    }
  });
}
