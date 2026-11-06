// Recette du lot L5 (cellules vides de disposition), conduite par l'interface, sur un formulaire Empilé (Num, Nom, Ville) :
// (1) Insérer en dessous : ligne de 240 twips ; (2) cellule vide sélectionnée : feuille de propriétés, noms CelluleVide1/2 ;
// (3) Remplissage, Quadrillage, Marges de la cellule ; (4) saisie « aaaaa » + Entrée : une étiquette remplit la cellule, Ctrl+Z/Ctrl+Y ;
// (5) Sélectionner la ligne + Suppr ; (6) dépôt d'un champ de la liste dans la cellule ; (7) enregistrer, rouvrir, mode Formulaire (fond de la
// cellule, aucun arrêt de tabulation en plus) ; (8) un formulaire d'avant L5 s'ouvre et s'enregistre sans bouger d'un twip.
// Étape 9 (état avec une cellule mise en forme -> aperçu / impression) : pas d'assistant d'amorçage d'état dans ces e2e, elle reste au
// niveau unitaire (readReport avec cellules mises en forme et rendu : tests de la Tâche 7).
import { test, expect, type Page } from '@playwright/test';
import { createTable } from '../../src/main/db/schema';
import type { ControlDef, DesignDoc } from '../../src/shared/design/model';
import { createLayout, membersOf } from '../../src/shared/design/layout-edit';
import { emptyCellsOf, readLayouts } from '../../src/shared/design/layout';
import { clients, t } from '../../src/shared/test-fixtures';
import { launchApp, seedBase, seedForm } from './helpers';

const NAMES = ['Num', 'Nom', 'Ville'];
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
const ctl = (d: DesignDoc, n: string) => d.sections.flatMap((s) => s.controls).find((c) => c.name === n);
const byCaption = (d: DesignDoc, cap: string) => d.sections.flatMap((s) => s.controls).find((c) => c.props.Caption === cap);
const geom = (d: DesignDoc) => d.sections.flatMap((s) => s.controls.flatMap((c) => [c, ...(c.children ?? [])])).map((c) => [c.name, c.left, c.top, c.width, c.height]);
const rightCell = (d: DesignDoc) => emptyCellsOf(d).find((c) => c.layout === 'L1' && c.row === 2 && c.col === 1);

async function openDesign(page: Page) {
  await page.getByTestId('nav-item-form-A').click({ button: 'right' });
  await page.getByTestId('nav-menu-design').click();
}
const seed = (name: string, doc: DesignDoc) => seedBase(name, (db) => { createTable(db, t('Clients', clients.fields)); seedForm(db, 'A', doc); });

test('recette L5: empty cells, typing, deleting, dropping, reopening, Form view', async () => {
  test.setTimeout(240000);
  const base = seed('recette-l5', stacked());
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
    const top0 = ctl(await getDoc(page), 'Ville')!.top;

    // 1. Insérer en dessous sur Nom : nouvelle ligne de 240 twips, Ville descend de 240 + 170
    await pick('Nom');
    await page.getByTestId('cmd-insertBelow').click();
    await save();
    await expect.poll(async () => ctl(await getDoc(page), 'Ville')!.top).toBe(top0 + 240 + 170);
    expect(readLayouts(await getDoc(page))[0].rows.map((r) => r.height)).toContain(240);

    // 2. La cellule de droite est CelluleVide2, celle de gauche CelluleVide1
    const right = d.getByTestId('cell-L1-2-1'), left = d.getByTestId('cell-L1-2-0');
    const name = async (v: string) => { await expect(page.getByTestId('sheet-object')).toHaveValue(v); return page.getByTestId('sheet-object').locator('option:checked').textContent(); };
    await right.click();
    await expect(page.getByTestId('property-sheet')).toBeVisible();
    await expect(page.getByTestId('sheet-type')).toContainText('Cellule vide');
    expect(await name('cell:L1:2:1')).toBe('CelluleVide2');
    await left.click();
    expect(await name('cell:L1:2:0')).toBe('CelluleVide1');
    await right.click();

    // 3. Remplissage (danger), Quadrillage Les deux, Marges Large sur la cellule de droite
    await page.getByTestId('ribbon-tab-format').click();
    await page.getByTestId('cmd-backColor').click();
    await page.getByTestId('format-popup-backColor-colors-danger').click();
    await page.getByTestId('ribbon-tab-arrange').click();
    await choose('layoutGridlines', 'both');
    await choose('controlPadding', 'wide');
    await save();
    await expect.poll(async () => rightCell(await getDoc(page))?.props).toMatchObject({ BackColor: 'theme:danger', BackStyle: 'normal', LeftPadding: 180, GridlineStyleTop: 'solid' });
    const cellRect = rightCell(await getDoc(page))!.rect;

    // 4. Saisie : « aaaaa » puis Entrée remplit la cellule d'une étiquette ; Ctrl+Z la retire (la cellule retrouve sa mise en forme) ;
    //    on la retape, puis on enregistre (un enregistrement vide l'historique : l'annulation se vérifie avant)
    const type = async () => { await right.click(); await page.keyboard.type('aaaaa'); await expect(page.getByTestId('cell-input')).toHaveValue('aaaaa'); await page.keyboard.press('Enter'); };
    await type();
    await expect(d.getByTestId('ctl-Étiquette1')).toHaveCount(1);
    await page.keyboard.press('Control+z');
    await expect(d.getByTestId('ctl-Étiquette1')).toHaveCount(0);
    await page.keyboard.press('Control+y');
    await expect(d.getByTestId('ctl-Étiquette1')).toHaveCount(1);
    await page.keyboard.press('Control+z');
    await expect(d.getByTestId('ctl-Étiquette1')).toHaveCount(0);
    await save();
    await expect.poll(async () => rightCell(await getDoc(page))?.props).toMatchObject({ BackColor: 'theme:danger', LeftPadding: 180 });
    expect(byCaption(await getDoc(page), 'aaaaa')).toBeUndefined();
    await type();
    await save();
    await expect.poll(async () => byCaption(await getDoc(page), 'aaaaa')?.props.Caption).toBe('aaaaa');
    const lab = byCaption(await getDoc(page), 'aaaaa')!;
    expect([lab.kind, lab.left, lab.top, lab.width, lab.height]).toEqual(['label', cellRect.left, cellRect.top, cellRect.width, cellRect.height]);
    expect(lab.props).toMatchObject({ BackColor: 'theme:danger', GridlineStyleTop: 'solid', GridlineStyleBottom: 'solid', GridlineStyleLeft: 'solid', GridlineStyleRight: 'solid',
      TopPadding: 180, BottomPadding: 180, LeftPadding: 180, RightPadding: 180 });

    // 5. Cellule de gauche, Sélectionner la ligne, Suppr : étiquette et ligne disparaissent, Ville remonte
    await left.click();
    await page.getByTestId('cmd-selectRow').click();
    await page.keyboard.press('Delete');
    await save();
    await expect.poll(async () => ctl(await getDoc(page), 'Ville')!.top).toBe(top0);
    expect(byCaption(await getDoc(page), 'aaaaa')).toBeUndefined();
    expect(readLayouts(await getDoc(page))[0].rows).toHaveLength(3);

    // 6. Insérer en dessous, glisser Email depuis la liste des champs sur la cellule de droite : une zone de texte la remplit
    await pick('Nom');
    await page.getByTestId('cmd-insertBelow').click();
    await page.getByTestId('ribbon-tab-formDesign').click();
    await page.getByTestId('cmd-addExistingFields').click();
    await expect(page.getByTestId('field-list')).toBeVisible();
    await save();
    await expect.poll(async () => rightCell(await getDoc(page))?.rect).toBeTruthy();
    const target = rightCell(await getDoc(page))!.rect;
    await page.getByTestId('field-Email').dragTo(d.getByTestId('cell-L1-2-1'));
    await save();
    await expect.poll(async () => {
      const cells = readLayouts(await getDoc(page))[0].cells;
      const at = (c: number) => cells.find((k) => k.row === 2 && k.col === c)?.control;
      return [at(0), at(1)];
    }).toEqual([expect.stringMatching(/Email/), 'Email']);   // the label (left) and the text box (right)
    const dropped = await getDoc(page), box = ctl(dropped, 'Email')!;
    expect([box.left, box.top, box.width, box.height]).toEqual([target.left, target.top, target.width, target.height]);   // the text box takes the cell
    const lbl = ctl(dropped, readLayouts(dropped)[0].cells.find((k) => k.row === 2 && k.col === 0)!.control!)!;
    expect(lbl.left + lbl.width).toBeLessThanOrEqual(box.left);   // its label sits in the left cell

    // une seconde ligne vide, mise en forme (Remplissage) : c'est elle que le mode Formulaire doit peindre
    await page.getByTestId('ribbon-tab-arrange').click();
    await pick('Nom');
    await page.getByTestId('cmd-insertBelow').click();
    await d.getByTestId('cell-L1-2-1').click();
    await page.getByTestId('sheet-tab-format').click();   // through the property sheet this time: the cell's own BackStyle and BackColor
    await page.getByTestId('prop-BackStyle').selectOption('normal');
    // Suppr dans un <select> de la feuille de propriétés : ne supprime rien dans le document
    const beforeDelete = await getDoc(page);
    await page.getByTestId('prop-BackStyle').focus();
    await page.keyboard.press('Delete');
    await page.waitForTimeout(300);
    expect(await getDoc(page)).toEqual(beforeDelete);
    await page.getByTestId('prop-BackColor').click();
    await page.getByTestId('prop-BackColor-colors-warning').click();

    // 7. Enregistrer, fermer, rouvrir : tout est conservé ; mode Formulaire : le fond de la cellule, pas d'arrêt de tabulation en plus
    await save();
    await expect.poll(async () => rightCell(await getDoc(page))?.props.BackColor).toBe('theme:warning');
    const saved = await getDoc(page);
    await app.close();
    ({ app, page } = await launchApp({ args: [base], userDataDir: first.userDataDir, env }));
    await expect.poll(async () => geom(await getDoc(page))).toEqual(geom(saved));
    const again = await getDoc(page);
    expect(readLayouts(again)).toEqual(readLayouts(saved));
    expect(emptyCellsOf(again).map((c) => c.props)).toEqual(emptyCellsOf(saved).map((c) => c.props));

    await page.getByTestId('nav-item-form-A').dblclick();
    const run = page.getByTestId('form-run').filter({ visible: true });
    const shade = run.getByTestId('form-cell-L1-2-1');
    await expect(shade).toBeVisible();
    const colour = (e: Element) => getComputedStyle(e).backgroundColor;
    const warning = await page.evaluate(() => { const p = document.createElement('i'); p.style.color = 'var(--bc-warning)'; document.body.append(p); const c = getComputedStyle(p).color; p.remove(); return c; });
    await expect.poll(() => shade.evaluate(colour)).toBe(warning);   // the colour set in the property sheet
    await expect(run.getByTestId('form-cell-L1-2-0')).toHaveCount(0);   // an unformatted empty cell draws nothing
    await run.getByTestId('form-ctl-Num').focus();
    const seen: string[] = [];
    const active = () => page.evaluate(() => document.activeElement?.getAttribute('data-testid') ?? '');
    for (let i = 0; i < 4; i++) {
      const before = await active();
      await page.keyboard.press('Tab');
      await expect.poll(active).not.toBe(before);   // the focus has moved (it is not read mid-move)
      seen.push(await active());
    }
    expect(seen).toEqual(['form-ctl-Nom', 'form-ctl-Ville', 'form-ctl-Email', 'form-ctl-Num']);   // no cell stop, none unnamed
  } finally {
    await app.close();
  }
});

test('recette L5: a form saved before L5 keeps its coordinates and Layouts when opened and saved', async () => {
  test.setTimeout(120000);
  const old = stacked();   // L1-L4 shape: no cell props, null cells
  expect(JSON.stringify(old.props.Layouts)).not.toContain('"props"');
  const { app, page } = await launchApp({ args: [seed('recette-l5-ancien', old)], env: { BASECRAFT_REGION: 'fr-FR' } });
  try {
    await openDesign(page);
    await expect(cur(page).getByTestId('ctl-Nom')).toBeVisible();
    await cur(page).getByTestId('ctl-Ville').click();
    await page.getByTestId('ribbon-tab-arrange').click();
    await page.getByTestId('cmd-anchoring').click();
    await page.getByTestId('layout-popup-anchoring-stretchAll').click();   // a real edit that moves nothing, so that the save writes
    await page.keyboard.press('Control+s');
    await expect.poll(async () => ctl(await getDoc(page), 'Ville')!.props.HorizontalAnchor).toBe('both');
    const after = await getDoc(page);
    expect(geom(after)).toEqual(geom(old));
    expect(JSON.stringify(after.props.Layouts)).toBe(JSON.stringify(old.props.Layouts));
  } finally {
    await app.close();
  }
});
