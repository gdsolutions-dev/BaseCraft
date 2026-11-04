// Recette du lot L4 (fusion, fractionnement, quadrillage, marges, remplissage, ancrage), conduite par l'interface : sur un formulaire
// Empilé (Nom, Ville, Inscrit, Actif, Remarque) : (1) Insérer à droite + Fusionner, (2) Fractionner verticalement, (3) Remplissage
// Large, (4) Marges Large, (5) Quadrillage Les deux, (6) Ancrage Étirement latéral vers le bas ; (7) enregistrer, fermer, rouvrir :
// tout est conservé ; (8) en mode Formulaire, Ville prend la place libre et suit la fenêtre ; (9) un formulaire d'avant L4 (disposition L1,
// sans étendue ni propriété L4) s'ouvre et s'enregistre sans bouger d'un twip.
import { test, expect, type Page } from '@playwright/test';
import { createTable } from '../../src/main/db/schema';
import type { ControlDef, DesignDoc } from '../../src/shared/design/model';
import { createLayout, membersOf } from '../../src/shared/design/layout-edit';
import { readLayouts } from '../../src/shared/design/layout';
import { clients, t } from '../../src/shared/test-fixtures';
import { launchApp, seedBase, seedForm } from './helpers';

const NAMES = ['Nom', 'Ville', 'Inscrit', 'Actif', 'Remarque'];
const cur = (page: Page) => page.locator('.doc:not([hidden])');
const field = (name: string, i: number): ControlDef => ({ kind: 'textBox', name, left: 1500, top: 200 + i * 600, width: 2268, height: 340, props: {},
  children: [{ kind: 'label', name: `Étiquette${name}`, left: 100, top: 200 + i * 600, width: 1200, height: 340, props: { Caption: `${name} :` } }] });
const form: DesignDoc = { formatVersion: '1.0', recordSource: { kind: 'table', name: 'Clients' }, props: {}, sections: [
  { kind: 'formHeader', height: 0, props: { Visible: false }, controls: [] },
  { kind: 'detail', height: 4000, props: {}, controls: NAMES.map(field) },
  { kind: 'formFooter', height: 0, props: { Visible: false }, controls: [] }] };
const stacked = () => createLayout(form, membersOf(form, NAMES), 'stacked', { headerSection: 'formHeader' });

type Api = { basecraft: { objects: { get(k: string, n: string): Promise<{ definition: DesignDoc }> } } };
const getDoc = (page: Page) => page.evaluate(() => (window as unknown as Api).basecraft.objects.get('form', 'A').then((r) => r.definition));
const ctl = (d: DesignDoc, n: string) => d.sections.flatMap((s) => s.controls).find((c) => c.name === n)!;
const geom = (d: DesignDoc) => d.sections.flatMap((s) => s.controls.flatMap((c) => [c, ...(c.children ?? [])])).map((c) => [c.name, c.left, c.top, c.width, c.height]);

async function openDesign(page: Page) {
  await page.getByTestId('nav-item-form-A').click({ button: 'right' });
  await page.getByTestId('nav-menu-design').click();
}
const seed = (name: string, doc: DesignDoc) => seedBase(name, (db) => { createTable(db, t('Clients', clients.fields)); seedForm(db, 'A', doc); });

test('recette L4: merge, split, padding, margins, gridlines, anchoring, reopen, Form view', async () => {
  test.setTimeout(240000);
  const base = seed('recette-l4', stacked());
  const env = { BASECRAFT_REGION: 'fr-FR' };
  const first = await launchApp({ args: [base], env });
  let { app, page } = first;
  try {
    await openDesign(page);
    const d = cur(page);
    const pick = (n: string) => d.getByTestId(`ctl-${n}`).click();
    const save = async () => { await page.keyboard.press('Control+s'); };
    const choose = async (cmd: string, item: string) => { await page.getByTestId(`cmd-${cmd}`).click(); await page.getByTestId(`layout-popup-${cmd}-${item}`).click(); };
    await page.getByTestId('ribbon-tab-arrange').click();
    const d0 = await getDoc(page);
    const h0 = ctl(d0, 'Remarque').height, w0 = ctl(d0, 'Nom').width;

    // 1. Insérer à droite sur Nom, Nom + la cellule vide, Fusionner : Nom couvre les deux colonnes
    await pick('Nom');
    await page.getByTestId('cmd-insertRight').click();
    await pick('Nom');
    await d.getByTestId('cell-L1-0-2').click({ modifiers: ['Control'] });
    await page.getByTestId('cmd-merge').click();
    await save();
    await expect.poll(async () => ctl(await getDoc(page), 'Nom').width).toBeGreaterThan(w0);

    // 2. Fractionner verticalement sur Remarque : sa hauteur est divisée par deux
    await pick('Remarque');
    await page.getByTestId('cmd-splitVertically').click();
    await save();
    const half = h0 - 170 - Math.floor((h0 - 170) / 2);
    await expect.poll(async () => ctl(await getDoc(page), 'Remarque').height).toBe(half);

    // 3. Remplissage Large sur Ville : la colonne des données se décale de 180 twips
    const l0 = ctl(await getDoc(page), 'Ville').left;
    await pick('Ville');
    await choose('controlPadding', 'wide');
    await save();
    await expect.poll(async () => ctl(await getDoc(page), 'Ville').left).toBe(l0 + 180);

    // 4. Marges Large sur Ville
    await pick('Ville');
    await choose('controlMargins', 'wide');

    // 5. Quadrillage Les deux sur toute la disposition
    await pick('Nom');
    await page.getByTestId('cmd-selectLayout').click();
    await choose('layoutGridlines', 'both');

    // 6. Ancrage Étirement latéral vers le bas sur Ville
    await pick('Ville');
    await choose('anchoring', 'stretchAll');
    await save();
    const marker = (x: DesignDoc) => { const v = ctl(x, 'Ville').props; return [v.TopMargin, v.LeftPadding, v.GridlineStyleTop, v.GridlineStyleLeft, v.HorizontalAnchor, v.VerticalAnchor]; };
    await expect.poll(async () => marker(await getDoc(page))).toEqual([90, 180, expect.anything(), expect.anything(), 'both', 'both']);
    const saved = await getDoc(page);
    expect(ctl(saved, 'Nom').props.GridlineStyleTop).toBeTruthy();
    expect(readLayouts(saved)[0].cells.some((c) => (c.colSpan ?? 1) > 1)).toBe(true);

    // 7. Fermer, rouvrir : propriétés et coordonnées conservées
    await app.close();
    ({ app, page } = await launchApp({ args: [base], userDataDir: first.userDataDir, env }));
    await expect.poll(async () => geom(await getDoc(page))).toEqual(geom(saved));
    const again = await getDoc(page);
    expect(marker(again)).toEqual(marker(saved));
    expect(readLayouts(again)).toEqual(readLayouts(saved));

    // 8. Mode Formulaire : Ville prend la largeur et la hauteur libres, et regrandit avec la fenêtre
    await page.getByTestId('nav-item-form-A').dblclick();
    const box = page.getByTestId('form-run').filter({ visible: true }).getByTestId('form-ctl-Ville');
    await expect(box).toBeVisible();
    const size = async () => { const b = (await box.boundingBox())!; return { w: Math.round(b.width), h: Math.round(b.height) }; };
    await expect.poll(async () => (await size()).w).toBeGreaterThan(Math.round(2268 / 15) + 20);
    await expect.poll(async () => (await size()).h).toBeGreaterThan(Math.round(340 / 15) + 20);
    const before = await size();
    const vp = page.viewportSize() ?? await page.evaluate(() => ({ width: window.innerWidth, height: window.innerHeight }));
    await page.setViewportSize({ width: vp.width + 400, height: vp.height + 200 });
    await expect.poll(async () => (await size()).w).toBeGreaterThan(before.w + 396);
    await expect.poll(async () => (await size()).h).toBeGreaterThan(before.h + 196);
  } finally {
    await app.close();
  }
});

test('recette L4: a form saved before L4 keeps its coordinates when opened and saved', async () => {
  test.setTimeout(120000);
  const old = stacked();   // L1 shape: no span, no padding / margin / gridline / anchor property
  expect(JSON.stringify(old)).not.toMatch(/Span|Padding|Margin|Gridline|Anchor/);
  const { app, page } = await launchApp({ args: [seed('recette-l4-ancien', old)], env: { BASECRAFT_REGION: 'fr-FR' } });
  try {
    await openDesign(page);
    await expect(cur(page).getByTestId('ctl-Nom')).toBeVisible();
    await cur(page).getByTestId('ctl-Ville').click();
    await page.getByTestId('ribbon-tab-arrange').click();
    // a real edit that leaves every coordinate alone (anchoring), so the save writes and the marker proves it
    await page.getByTestId('cmd-anchoring').click();
    await page.getByTestId('layout-popup-anchoring-stretchAll').click();
    await page.keyboard.press('Control+s');
    await expect.poll(async () => ctl(await getDoc(page), 'Ville').props.HorizontalAnchor).toBe('both');
    expect(geom(await getDoc(page))).toEqual(geom(old));
  } finally {
    await app.close();
  }
});
