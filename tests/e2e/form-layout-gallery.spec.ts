// Mode Page des formulaires (L2b), de bout en bout : la galerie de contrôles. Boîte à outils et galerie du ruban actives ; un contrôle
// posé hors disposition reste libre, sur une ligne d'un Empilé il en devient une (les suivants descendent, le contour grandit, une
// seule annulation) ; un onglet s'étire sur une ligne, un groupe d'options reste libre ; un champ de la Liste des champs rejoint la
// disposition ; Création montre les mêmes lignes ; l'enregistrement les garde ; base en lecture seule : galerie éteinte.
import { test, expect, type Page } from '@playwright/test';
import { createTable } from '../../src/main/db/schema';
import type { BasecraftApi } from '../../src/shared/api';
import type { ControlDef, DesignDoc } from '../../src/shared/design/model';
import { createLayout, membersOf } from '../../src/shared/design/layout-edit';
import { clients, t } from '../../src/shared/test-fixtures';
import { launchApp, pickView, seedBase, seedForm, seedReportsE2E } from './helpers';

const FR = { BASECRAFT_REGION: 'fr-FR' };
const cur = (page: Page) => page.locator('.doc:not([hidden])');
const ctl = (page: Page, name: string) => cur(page).getByTestId(`ctl-${name}`);
const N = [1, 2, 3];
const SOURCES = ['Nom', 'Âge', 'Email'];
// trois zones de texte liées, chacune avec son étiquette, en Empilé ; un contrôle libre à droite
const field = (i: number): ControlDef => ({ kind: 'textBox', name: `Texte${i}`, left: 1500, top: 200 + (i - 1) * 500, width: 2268, height: 340,
  props: { ControlSource: SOURCES[i - 1] },
  children: [{ kind: 'label', name: `Étiquette${i}`, left: 100, top: 200 + (i - 1) * 500, width: 1200, height: 340, props: { Caption: `${SOURCES[i - 1]}:` } }] });
const free: ControlDef = { kind: 'textBox', name: 'Libre', left: 8000, top: 200, width: 2268, height: 340, props: {} };
const plain: DesignDoc = { formatVersion: '1.0', recordSource: { kind: 'table', name: 'Clients' }, props: {}, sections: [
  { kind: 'formHeader', height: 0, props: { Visible: false }, controls: [] },
  { kind: 'detail', height: 4000, props: {}, controls: [...N.map(field), free] },
  { kind: 'formFooter', height: 0, props: { Visible: false }, controls: [] }] };
const stacked = createLayout(plain, membersOf(plain, N.map((i) => `Texte${i}`)), 'stacked', { headerSection: 'formHeader' });

const base = () => seedBase('fx-galerie-page', (db) => {
  createTable(db, t('Clients', clients.fields));
  db.exec(`INSERT INTO "Clients"("Nom", "Âge", "Actif", "Solde", "Email") VALUES ('Dupont', 30, 0, 100, 'd@x.fr')`);
  seedForm(db, 'Fiche', stacked);
});

const getDoc = (page: Page, name: string) => page.evaluate((n) =>
  (window as unknown as { basecraft: BasecraftApi }).basecraft.objects.get('form', n), name).then((r) => r.definition as DesignDoc);
const find = (doc: DesignDoc, name: string) => doc.sections.flatMap((s) => s.controls).find((c) => c.name === name);
const tabOf = (page: Page) => page.getByTestId('doc-tab-form-Fiche');
const status = (page: Page, v: string) => page.getByTestId(`status-view-${v}`);
const body = (page: Page) => cur(page).locator('[data-section-body="1"]');
const names = (page: Page) => cur(page).locator('[data-ctl]').evaluateAll((els) => els.map((e) => (e as HTMLElement).dataset.ctl!));
const box = async (page: Page, name: string) => (await ctl(page, name).boundingBox())!;
const outline = async (page: Page) => (await cur(page).locator('.dz-layout').first().boundingBox())!;
async function openLayout(page: Page) {
  await page.getByTestId('nav-item-form-Fiche').click({ button: 'right' });
  await page.getByTestId('nav-menu-layout').click();
  await expect(cur(page).getByTestId('layout-record-bar')).toBeVisible();
  await expect(tabOf(page)).not.toContainText('•');
}
/** Choisit l'outil dans la boîte à outils, puis un clic sur la surface (x, y absolus de la page) ; renvoie le nom du contrôle posé. */
async function place(page: Page, kind: string, x: number, y: number): Promise<string> {
  const before = await names(page);
  await cur(page).getByTestId(`tool-${kind}`).click();
  await page.mouse.click(x, y);
  await expect.poll(async () => (await names(page)).length).toBeGreaterThan(before.length);
  return (await names(page)).find((n) => !before.includes(n))!;
}

test('Form Layout view gallery: free placement, row in a Stacked layout, one-step undo, tab control, option group, field list, Design, save, read-only', async () => {
  test.setTimeout(150000);
  const b = base();
  const { app, page } = await launchApp({ args: [b], env: FR });
  try {
    await openLayout(page);
    // la boîte à outils et la galerie du ruban actives ; ni barres de section ni onglet Événement
    await expect(cur(page).getByTestId('toolbox')).toBeVisible();
    await expect(cur(page).getByTestId('tool-textBox')).toBeEnabled();
    await page.getByTestId('ribbon-tab-formDesign').click();
    await expect(page.getByTestId('cmd-textBox')).toBeEnabled();
    await expect(cur(page).locator('[data-testid^="section-resize-"]')).toHaveCount(0);
    await expect(cur(page).getByTestId('sheet-tab-event')).toHaveCount(0);

    // hors de la disposition : le contrôle apparaît, libre, le formulaire est modifié, la disposition intacte
    const o0 = await outline(page);
    const t3 = await box(page, 'Texte3');
    const bd = (await body(page).boundingBox())!;
    const freeName = await place(page, 'textBox', bd.x + 700 / 15 + 400, bd.y + 2500 / 15);
    await expect(tabOf(page)).toContainText('•');
    expect(await outline(page)).toEqual(o0);
    expect(await box(page, 'Texte3')).toEqual(t3);
    await cur(page).getByTestId('design-canvas').focus();
    await page.keyboard.press('Control+z');
    await expect(ctl(page, freeName)).toHaveCount(0);

    // sur la dernière ligne (moitié basse) : une ligne de plus, le contour grandit
    const t1 = await box(page, 'Texte1'), t2 = await box(page, 'Texte2');
    const y2 = t2.y, y3 = t3.y;
    const row = await place(page, 'textBox', t2.x + 4, t2.y + 1);   // le centre du rectangle posé tombe dans la moitié basse de la ligne 2
    await expect(tabOf(page)).toContainText('•');
    const nb = await box(page, row);
    expect(Math.round(nb.x)).toBe(Math.round(t1.x));
    expect(nb.y).toBeGreaterThan(t1.y);
    await expect.poll(async () => (await box(page, 'Texte3')).y).toBeGreaterThan(y3);
    expect(Math.round((await box(page, 'Texte2')).y)).toBe(Math.round(y2));
    const o1 = await outline(page);
    expect(o1.height).toBeGreaterThan(o0.height);
    expect(Math.round(nb.y)).toBe(Math.round((await box(page, 'Texte3')).y - nb.height - (t3.y - t2.y - t2.height)));

    // une seule annulation : le contrôle disparaît, les suivants et le contour reviennent ; Ctrl+Y le refait
    await cur(page).getByTestId('design-canvas').focus();
    await page.keyboard.press('Control+z');
    await expect(ctl(page, row)).toHaveCount(0);
    await expect.poll(async () => Math.round((await box(page, 'Texte3')).y)).toBe(Math.round(y3));
    expect(await outline(page)).toEqual(o0);
    await page.keyboard.press('Control+y');
    await expect(ctl(page, row)).toBeVisible();
    await expect.poll(async () => (await box(page, 'Texte3')).y).toBeGreaterThan(y3);

    // un onglet déposé sur la disposition : une ligne étirée sur sa largeur
    const t3b = await box(page, 'Texte3');
    const tabName = await place(page, 'tabControl', t3b.x + 4, t3b.y + 1);
    await expect.poll(async () => (await box(page, 'Texte3')).y).toBeGreaterThan(t3b.y - 1);
    const tb = await box(page, tabName);
    const lo = await outline(page);
    expect(tb.x).toBeGreaterThanOrEqual(lo.x - 1);
    expect(tb.x + tb.width).toBeLessThanOrEqual(lo.x + lo.width + 1);
    expect(Math.round(tb.width)).toBe(Math.round((await box(page, 'Texte1')).width));   // étiré sur la colonne des données (1418 twips posés)

    // un groupe d'options déposé sur la disposition : libre, la disposition intacte
    const oBefore = await outline(page), t1b = await box(page, 'Texte1');
    const og = await place(page, 'optionGroup', t1b.x + 4, t1b.y + 1);
    expect(await outline(page)).toEqual(oBefore);
    expect(await box(page, 'Texte1')).toEqual(t1b);
    await expect(ctl(page, og)).toBeVisible();

    // un champ de la Liste des champs déposé sur la disposition (haut de la dernière ligne) en devient un membre
    await page.getByTestId('cmd-addExistingFields').click();
    await expect(page.getByTestId('field-list')).toBeVisible();
    const last = await box(page, 'Texte3'), bd2 = (await body(page).boundingBox())!;
    const oF = await outline(page);
    await page.getByTestId('field-Solde').dragTo(body(page), { targetPosition: { x: last.x - bd2.x + 4, y: last.y - bd2.y + 2 } });
    await expect.poll(async () => (await outline(page)).height).toBeGreaterThan(oF.height);

    // Création : les nouvelles lignes y sont
    const rowsLayout = (await names(page)).length;
    await status(page, 'design').click();
    await expect(cur(page).locator('[data-testid^="section-resize-"]').first()).toBeVisible();
    await expect(ctl(page, row)).toBeVisible();
    await expect(ctl(page, tabName)).toBeVisible();
    expect((await names(page)).length).toBe(rowsLayout);
    await status(page, 'layout').click();
    await expect(cur(page).getByTestId('layout-record-bar')).toBeVisible();

    // enregistré : le formulaire montre les lignes
    await cur(page).getByTestId('design-canvas').focus();
    await page.keyboard.press('Control+s');
    await expect(tabOf(page)).not.toContainText('•');
    const saved = await getDoc(page, 'Fiche');
    expect(find(saved, row)!.props.LayoutID).toBe('L1');
    expect(find(saved, tabName)!.props.LayoutID).toBe('L1');
    expect(find(saved, og)!.props.LayoutID).toBeUndefined();
    expect(find(saved, 'Libre')!.props.LayoutID).toBeUndefined();
    await page.getByTestId('ribbon-tab-home').click();
    await pickView(page, 'viewForm');
    const run = page.getByTestId('form-run').filter({ visible: true });
    await expect(run).toBeVisible();
    await expect(run.getByTestId(`form-ctl-${row}`)).toBeVisible();
    await expect(run.getByTestId(`form-ctl-${tabName}`)).toBeVisible();
  } finally {
    await app.close();
  }
});

test('Form Layout view gallery in a read-only base stays disabled; the report Layout view has the toolbox but no Event tab', async () => {
  test.setTimeout(90000);
  const b = base();
  const first = await launchApp({ args: [b], env: FR });
  const second = await launchApp({ args: [b], env: FR });
  try {
    const page = second.page;
    await expect(page.getByTestId('banner-readonly')).toBeVisible();
    await openLayout(page);
    await expect(cur(page).getByTestId('tool-textBox')).toBeDisabled();
    await page.getByTestId('ribbon-tab-formDesign').click();
    await expect(page.getByTestId('cmd-textBox')).toBeDisabled();
  } finally {
    await second.app.close();
    await first.app.close();
  }
  const rb = seedBase('fx-galerie-etat', (db) => seedReportsE2E(db));
  const { app, page } = await launchApp({ args: [rb], env: FR });
  try {
    await page.getByTestId('nav-item-report-Factures par client').click({ button: 'right' });
    await page.getByTestId('nav-menu-layout').click();
    await expect(cur(page).getByTestId('layout-flow')).toBeVisible();
    await expect(cur(page).getByTestId('toolbox')).toHaveCount(1);
    await expect(cur(page).getByTestId('sheet-tab-event')).toHaveCount(0);
  } finally {
    await app.close();
  }
});
