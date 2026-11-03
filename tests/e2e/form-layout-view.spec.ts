// Mode Page des formulaires (L2), de bout en bout : ouvert par le menu du volet, les données de l'enregistrement courant, la barre
// des enregistrements, ni boîte à outils ni barres de hauteur de section ni onglet Événement ; les commandes de disposition et la
// poignée de largeur ; Création <-> Page sans question ni relecture (l'annulation reste) ; vers Formulaire, la question
// d'enregistrement ; un formulaire continu répète son Détail ; AllowLayoutView = false ; une source vide ; une source paramétrée.
import { test, expect, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createTable } from '../../src/main/db/schema';
import { saveObject } from '../../src/main/db/objects';
import type { ControlDef, DesignDoc } from '../../src/shared/design/model';
import { createLayout, membersOf } from '../../src/shared/design/layout-edit';
import { clients, t } from '../../src/shared/test-fixtures';
import { launchApp, seedBase, seedForm, pickView , checkView } from './helpers';

const fr = JSON.parse(readFileSync(join(__dirname, '../../src/shared/i18n/fr.json'), 'utf8'));
const FR = { BASECRAFT_REGION: 'fr-FR' };
const cur = (page: Page) => page.locator('.doc:not([hidden])');
const ctl = (page: Page, name: string) => cur(page).getByTestId(`ctl-${name}`);
const N = [1, 2, 3, 4, 5];
const SOURCES = ['N°', 'Nom', 'Âge', 'Solde', 'Email'];
const NOMS = ['Dupont', 'Martin', 'Durand', 'Petit', 'Leroy'];
// cinq zones de texte liées, chacune avec son étiquette ; un contrôle calculé hors disposition
const field = (i: number): ControlDef => ({ kind: 'textBox', name: `Texte${i}`, left: 1500, top: 200 + (i - 1) * 500, width: 2268, height: 340,
  props: { ControlSource: SOURCES[i - 1] },
  children: [{ kind: 'label', name: `Étiquette${i}`, left: 100, top: 200 + (i - 1) * 500, width: 1200, height: 340, props: { Caption: `${SOURCES[i - 1]}:` } }] });
const calc: ControlDef = { kind: 'textBox', name: 'Calcul', left: 6000, top: 200, width: 2268, height: 340, props: { ControlSource: '=[Nom] & "!"' } };
const plain = (source: DesignDoc['recordSource'], props: Record<string, unknown> = {}, footer = false): DesignDoc => ({
  formatVersion: '1.0', recordSource: source, props, sections: [
    { kind: 'formHeader', height: 0, props: { Visible: false }, controls: [] },
    { kind: 'detail', height: 3000, props: {}, controls: [...N.map(field), calc] },
    { kind: 'formFooter', height: footer ? 500 : 0, props: footer ? {} : { Visible: false },
      controls: footer ? [{ kind: 'label', name: 'Pied', left: 100, top: 50, width: 3000, height: 340, props: { Caption: 'Pied du formulaire' } }] : [] }] });
const stacked = (d: DesignDoc) => createLayout(d, membersOf(d, N.map((i) => `Texte${i}`)), 'stacked', { headerSection: 'formHeader' });
// le formulaire continu : un Détail bas (une ligne), le pied de formulaire montré
const continuous: DesignDoc = { formatVersion: '1.0', recordSource: { kind: 'table', name: 'Clients' }, props: { DefaultView: 'continuous' }, sections: [
  { kind: 'formHeader', height: 0, props: { Visible: false }, controls: [] },
  { kind: 'detail', height: 500, props: {}, controls: [{ kind: 'textBox', name: 'Nom', left: 1500, top: 50, width: 2268, height: 340, props: { ControlSource: 'Nom' } }] },
  { kind: 'formFooter', height: 500, props: {}, controls: [{ kind: 'label', name: 'Pied', left: 100, top: 50, width: 3000, height: 340, props: { Caption: 'Pied du formulaire' } }] }] };
const P = 'Âge minimum :';

const base = () => seedBase('fx-mode-page', (db) => {
  createTable(db, t('Clients', clients.fields));
  createTable(db, t('Vide', clients.fields));
  db.exec(`INSERT INTO "Clients"("Nom", "Âge", "Actif", "Solde", "Email") VALUES ${NOMS.map((n, i) => `('${n}', ${30 + i}, 0, ${100 * (i + 1)}, '${n.toLowerCase()}@x.fr')`).join(', ')}`);
  const q = saveObject(db, 'query', 'Clients âgés', { formatVersion: '1.0', sql: `PARAMETERS [${P}] Long; SELECT * FROM Clients WHERE [Âge] >= [${P}];` }, null);
  if (!q.ok) throw new Error(q.reason);
  seedForm(db, 'Fiche', stacked(plain({ kind: 'table', name: 'Clients' })));
  seedForm(db, 'Liste', continuous);
  seedForm(db, 'Interdit', plain({ kind: 'table', name: 'Clients' }, { AllowLayoutView: false }));
  seedForm(db, 'Sans données', plain({ kind: 'table', name: 'Vide' }));
  seedForm(db, 'Paramétré', plain({ kind: 'query', name: 'Clients âgés' }));
});

async function openLayout(page: Page, name: string) {
  await page.getByTestId(`nav-item-form-${name}`).click({ button: 'right' });
  await page.getByTestId('nav-menu-layout').click();
  await expect(cur(page).getByTestId('layout-record-bar')).toBeVisible();
  await clean(page, name);
}
/** Ni l'ouverture ni la navigation entre enregistrements ne modifient le formulaire (pas de marque de modification). */
const clean = (page: Page, name: string) => expect(page.getByTestId(`doc-tab-form-${name}`)).not.toContainText('•');
const box = async (page: Page, name: string) => (await ctl(page, name).boundingBox())!;
const status = (page: Page, v: string) => page.getByTestId(`status-view-${v}`);
/** Ni barres de hauteur de section, ni onglet Événement (mode Page) ; tous là en mode Création. La boîte à outils reste dans les deux (L2b). */
async function designerTools(page: Page, shown: boolean) {
  const n = shown ? 1 : 0;
  await expect(cur(page).getByTestId('sheet-tab-format')).toHaveCount(1);   // la feuille reste, sans l'onglet Événement en mode Page
  await expect(cur(page).getByTestId('toolbox')).toBeVisible();
  await expect(cur(page).getByTestId('tool-textBox')).toBeEnabled();
  await expect(cur(page).getByTestId('sheet-tab-event')).toHaveCount(n);
  if (shown) await expect(cur(page).locator('[data-testid^="section-resize-"]')).not.toHaveCount(0);
  else await expect(cur(page).locator('[data-testid^="section-resize-"]')).toHaveCount(0);
}

test('Layout view: live record, record bar, restricted designer, layout commands, width handle, Design <-> Layout, save to Form view', async () => {
  test.setTimeout(120000);
  const { app, page } = await launchApp({ args: [base()], env: FR });
  const modal = page.getByTestId('modal');
  try {
    await openLayout(page, 'Fiche');
    await expect(status(page, 'layout')).toHaveAttribute('aria-pressed', 'true');
    await checkView(page, 'viewLayout', (v) => expect(v).toHaveAttribute('aria-checked', 'true'));

    // les zones de texte montrent le premier enregistrement ; la barre passe au deuxième
    await expect(ctl(page, 'Texte2')).toHaveText('Dupont');
    await expect(ctl(page, 'Texte3')).toHaveText('30');
    await expect(cur(page).getByTestId('layout-record-pos')).toHaveText('1 / 5');
    await expect(cur(page).getByTestId('layout-record-prev')).toBeDisabled();
    await cur(page).getByTestId('layout-record-next').click();
    await expect(ctl(page, 'Texte2')).toHaveText('Martin');
    await expect(cur(page).getByTestId('layout-record-pos')).toHaveText('2 / 5');
    await cur(page).getByTestId('layout-record-last').click();
    await expect(ctl(page, 'Texte2')).toHaveText('Leroy');
    await cur(page).getByTestId('layout-record-first').click();
    await cur(page).getByTestId('layout-record-next').click();
    await expect(ctl(page, 'Texte2')).toHaveText('Martin');
    await clean(page, 'Fiche');
    await expect(cur(page).getByTestId('layout-notice')).toHaveCount(0);
    await designerTools(page, false);

    // Tabulaire puis Empilé, Insérer au-dessus : les commandes de disposition marchent en mode Page
    await cur(page).getByTestId('section-detail').click();
    await page.keyboard.press('Control+a');
    await page.getByTestId('ribbon-tab-arrange').click();
    await page.getByTestId('cmd-tabular').click();
    await expect.poll(async () => new Set(await Promise.all(N.map(async (i) => Math.round((await box(page, `Texte${i}`)).y)))).size).toBe(1);
    await page.getByTestId('cmd-stacked').click();
    await expect.poll(async () => new Set(await Promise.all(N.map(async (i) => Math.round((await box(page, `Texte${i}`)).x)))).size).toBe(1);
    const y3 = (await box(page, 'Texte3')).y;
    await ctl(page, 'Texte2').click();
    await page.getByTestId('cmd-insertAbove').click();
    await expect.poll(async () => (await box(page, 'Texte3')).y).toBeGreaterThan(y3);
    await expect(ctl(page, 'Texte2')).toHaveText('Martin');   // toujours l'enregistrement courant

    // la poignée droite du premier contrôle élargit la colonne : les autres suivent
    const w = (await box(page, 'Texte1')).width;
    await ctl(page, 'Texte1').click();
    const e = (await ctl(page, 'Texte1').getByTestId('handle-e').boundingBox())!;
    await page.mouse.move(e.x + e.width / 2, e.y + e.height / 2);
    await page.mouse.down();
    await page.mouse.move(e.x + 40, e.y + e.height / 2, { steps: 4 });
    await page.mouse.move(e.x + 80, e.y + e.height / 2, { steps: 4 });
    await page.mouse.up();
    await expect.poll(async () => (await box(page, 'Texte1')).width).toBeGreaterThan(w + 40);
    const wide = (await box(page, 'Texte1')).width;
    for (const i of N) expect(Math.round((await box(page, `Texte${i}`)).width), `Texte${i}`).toBe(Math.round(wide));

    // vers Création (barre d'état) : aucune question, la modification est là, l'annulation l'annule ; le contrôle calculé pareil
    const calcLayout = await ctl(page, 'Calcul').innerText();
    await status(page, 'design').click();
    await expect(status(page, 'design')).toHaveAttribute('aria-pressed', 'true');
    await expect(modal).toHaveCount(0);
    await expect(page.getByTestId('ribbon-tab-arrange')).toHaveAttribute('aria-selected', 'true');   // l'onglet choisi reste
    await designerTools(page, true);
    await expect(ctl(page, 'Texte2')).toHaveText('Nom');   // l'aperçu Création : la source
    expect(await ctl(page, 'Calcul').innerText()).toBe(calcLayout);
    expect(Math.round((await box(page, 'Texte1')).width)).toBe(Math.round(wide));
    await cur(page).getByTestId('design-canvas').focus();
    await page.keyboard.press('Control+z');
    await expect.poll(async () => Math.round((await box(page, 'Texte1')).width)).toBe(Math.round(w));
    await page.keyboard.press('Control+y');
    await expect.poll(async () => Math.round((await box(page, 'Texte1')).width)).toBe(Math.round(wide));

    // de retour en mode Page : rien n'est relu (toujours le deuxième enregistrement), barres de section et onglet Événement de nouveau masqués
    await status(page, 'layout').click();
    await expect(cur(page).getByTestId('layout-record-pos')).toHaveText('2 / 5');
    await expect(ctl(page, 'Texte2')).toHaveText('Martin');
    await expect(modal).toHaveCount(0);
    await expect(page.getByTestId('ribbon-tab-arrange')).toHaveAttribute('aria-selected', 'true');
    await designerTools(page, false);

    // vers Formulaire, modifié : la question d'enregistrement ; Oui enregistre ; le formulaire montre la colonne élargie
    await expect(page.getByTestId('doc-tab-form-Fiche')).toContainText('•');
    await page.getByTestId('ribbon-tab-home').click();
    await pickView(page, 'viewForm');
    await expect(modal).toContainText(fr.form.mustSaveFirst.replace('{{name}}', 'Fiche'));
    await page.getByTestId('modal-btn-yes').click();
    const run = page.getByTestId('form-run').filter({ visible: true });
    await expect(run).toBeVisible();
    await expect(run.getByTestId('form-ctl-Texte2')).toHaveValue('Dupont');
    for (const i of N) expect(Math.round((await run.getByTestId(`form-ctl-Texte${i}`).boundingBox())!.width), `Texte${i}`).toBeGreaterThan(Math.round(w) + 40);
  } finally {
    await app.close();
  }
});

test('Layout view: a Continuous form repeats its Detail above the footer; AllowLayoutView = false; an empty source', async () => {
  const { app, page } = await launchApp({ args: [base()], env: FR });
  try {
    // plusieurs enregistrements : le Détail modifiable (le premier) puis les copies, le pied de formulaire dessous
    await openLayout(page, 'Liste');
    await expect(ctl(page, 'Nom')).toHaveText('Dupont');
    const copies = cur(page).locator('.dz-copy');
    await expect(copies).toHaveCount(4);
    await expect(copies.nth(0)).toHaveText('Martin');
    await expect(copies.nth(3)).toHaveText('Leroy');
    const last = (await copies.nth(3).boundingBox())!;
    const footer = (await cur(page).locator('.dz-block', { has: page.getByTestId('section-formFooter') }).boundingBox())!;
    expect(footer.y).toBeGreaterThanOrEqual(last.y + last.height - 1);
    await cur(page).getByTestId('layout-record-next').click();
    await expect(ctl(page, 'Nom')).toHaveText('Martin');
    await expect(copies).toHaveCount(3);
    await expect(copies.nth(0)).toHaveText('Durand');
    await clean(page, 'Liste');

    // AllowLayoutView = false : le bouton d'état éteint, en mode Formulaire comme en mode Création
    await page.getByTestId('nav-item-form-Interdit').dblclick();
    await expect(page.getByTestId('form-run').filter({ visible: true })).toBeVisible();
    await expect(status(page, 'layout')).toBeDisabled();
    await status(page, 'design').click();
    await expect(cur(page).getByTestId('designer')).toBeVisible();
    await expect(status(page, 'layout')).toBeDisabled();
    await checkView(page, 'viewLayout', (v) => expect(v).toBeDisabled());

    // une source sans enregistrement : l'avis, et le mode Page s'ouvre quand même
    await openLayout(page, 'Sans données');
    await expect(cur(page).getByTestId('layout-notice')).toHaveText(fr.layoutView.notice.empty);
    await expect(cur(page).getByTestId('layout-record-pos')).toHaveText('0 / 0');
    await expect(ctl(page, 'Texte2')).toBeVisible();
  } finally {
    await app.close();
  }
});

test('Layout view on a parameterized query: asked once, neither Design <-> Layout nor a save asks again', async () => {
  const { app, page } = await launchApp({ args: [base()], env: FR });
  const modal = page.getByTestId('modal');
  try {
    await page.getByTestId('nav-item-form-Paramétré').click({ button: 'right' });
    await page.getByTestId('nav-menu-layout').click();
    await expect(modal).toContainText(P);
    await page.getByTestId('modal-input').fill('32');
    await page.getByTestId('modal-btn-ok').click();
    await expect(modal).toHaveCount(0);
    await expect(ctl(page, 'Texte2')).toHaveText('Durand');
    await expect(cur(page).getByTestId('layout-record-pos')).toHaveText('1 / 3');
    await cur(page).getByTestId('layout-record-next').click();
    await expect(ctl(page, 'Texte2')).toHaveText('Petit');

    await status(page, 'design').click();
    await expect(cur(page).locator('[data-testid^="section-resize-"]').first()).toBeVisible();
    await status(page, 'layout').click();
    await expect(cur(page).locator('[data-testid^="section-resize-"]')).toHaveCount(0);
    await expect(modal).toHaveCount(0);
    await expect(ctl(page, 'Texte2')).toHaveText('Petit');

    // une modification enregistrée en mode Page : ni question de paramètre ni relecture
    await ctl(page, 'Texte1').click();
    await page.keyboard.press('Delete');
    await expect(ctl(page, 'Texte1')).toHaveCount(0);
    await page.keyboard.press('Control+s');
    await expect(page.getByTestId('doc-tab-form-Paramétré')).not.toContainText('•');
    await expect(cur(page).getByTestId('layout-record-pos')).toHaveText('2 / 3');
    await expect(ctl(page, 'Texte2')).toHaveText('Petit');
    // les mêmes enregistrements, toujours lus avec 32 (une relecture redemanderait les paramètres, sa boîte bloquerait ce clic)
    await cur(page).getByTestId('layout-record-next').click();
    await expect(ctl(page, 'Texte2')).toHaveText('Leroy');
    await expect(cur(page).getByTestId('layout-record-pos')).toHaveText('3 / 3');
    await expect(modal).toHaveCount(0);
  } finally {
    await app.close();
  }
});

test('Layout view in a read-only base: the live record, the restricted designer', async () => {
  const b = base();
  const first = await launchApp({ args: [b], env: FR });
  const second = await launchApp({ args: [b], env: FR });   // la base déjà ouverte : en lecture seule
  try {
    const page = second.page;
    await expect(page.getByTestId('banner-readonly')).toBeVisible();
    await openLayout(page, 'Fiche');
    await expect(ctl(page, 'Texte2')).toHaveText('Dupont');
    await cur(page).getByTestId('layout-record-next').click();
    await expect(ctl(page, 'Texte2')).toHaveText('Martin');
    // la boîte à outils reste, ses outils désactivés comme en mode Création d'une base en lecture seule : rien ne se place
    await expect(cur(page).getByTestId('toolbox')).toBeVisible();
    await expect(cur(page).getByTestId('tool-textBox')).toBeDisabled();
    await expect(cur(page).locator('[data-testid^="section-resize-"]')).toHaveCount(0);
    await clean(page, 'Fiche');
  } finally {
    await second.app.close();
    await first.app.close();
  }
});
