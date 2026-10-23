// Formulaire en mode Création (A4, tâche 5) : création, ruban Création de formulaire et Organiser, Feuille de propriétés, Liste des
// champs (double-clic, Entrée, glisser), surface (glisser, annuler, aimantation, premier plan), boîte à outils, en-tête/pied, ordre de
// tabulation, enregistrement, menu du volet (C6), réouverture, définition abîmée, base en lecture seule.
import { test, expect, type Locator, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createTable } from '../../src/main/db/schema';
import type { BasecraftApi } from '../../src/shared/api';
import type { DesignDoc } from '../../src/shared/design/model';
import { clients, f, t } from '../../src/shared/test-fixtures';
import { launchApp, seedBase, seedForm } from './helpers';

const fr = JSON.parse(readFileSync(join(__dirname, '../../src/shared/i18n/fr.json'), 'utf8'));
const table = t('Clients', [...clients.fields, f('Ville', 'shortText')]);
const CM = 567 / 15;   // px par cm à 100 %
const testIds = (l: Locator) => l.evaluateAll((els) => els.map((e) => e.getAttribute('data-testid')));
const groups = (page: Page) => testIds(page.locator('[data-testid^="ribbon-group-"]'));
const selected = (page: Page, tab: string) => expect(page.getByTestId(`ribbon-tab-${tab}`)).toHaveAttribute('aria-selected', 'true');
const getForm = (page: Page, name: string) => page.evaluate((n) => (window as unknown as { basecraft: BasecraftApi }).basecraft.objects.get('form', n), name)
  .then((r) => r.definition as DesignDoc);
const menuLayout = (page: Page) => page.getByTestId('nav-menu').evaluate((m) =>
  [...m.children].map((e) => (e.getAttribute('role') === 'separator' ? '|' : (e.querySelector('[role="menuitem"]') ?? e).getAttribute('data-testid')!.replace('nav-menu-', ''))));

/** Glisse un contrôle de (dx, dy) px à la souris (Pointer Events, par petits pas). */
async function dragBy(page: Page, l: Locator, dx: number, dy: number) {
  const b = (await l.boundingBox())!;
  const x = Math.round(b.x + 6), y = Math.round(b.y + b.height / 2);
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + dx / 2, y + dy / 2, { steps: 3 });
  await page.mouse.move(x + dx, y + dy, { steps: 3 });
  await page.mouse.up();
}
/** Choisit un contrôle ; la feuille montre sa propriété Left (assertion web-first : la feuille se redessine après le clic). */
async function expectLeft(page: Page, name: string, value: string, not = false) {
  await page.getByTestId(`ctl-${name}`).click();
  await expect(page.getByTestId('sheet-object')).toHaveValue(`c:${name}`);
  await (not ? expect(page.getByTestId('prop-Left')).not.toHaveValue(value) : expect(page.getByTestId('prop-Left')).toHaveValue(value));
}

test('Form Design view: create, ribbon, sheet, Field List, gestures, toolbox, header/footer, tab order, save, reopen', async () => {
  test.setTimeout(120000);
  const base = seedBase('formulaire-creation', (db) => createTable(db, table));
  const { app, page } = await launchApp({ args: [base], env: { BASECRAFT_REGION: 'fr-FR' } });
  try {
    // Créer › Création de formulaire : un onglet Formulaire1 en mode Création, l'onglet Création de formulaire choisi
    await page.getByTestId('ribbon-tab-create').click();
    await page.getByTestId('cmd-createFormDesign').click();
    await expect(page.getByTestId('doc-tab-form-Formulaire1')).toBeVisible();
    await selected(page, 'formDesign');
    for (const id of ['arrange', 'format']) await expect(page.getByTestId(`ribbon-tab-${id}`)).toBeVisible();
    await expect.poll(() => groups(page)).toEqual(['view', 'themes', 'controls', 'headerFooter', 'tools'].map((g) => `ribbon-group-${g}`));
    expect(await testIds(page.getByTestId('ribbon-group-view').locator('[data-testid^="cmd-"]'))).toEqual(['cmd-viewForm', 'cmd-viewDatasheet']);
    await expect(page.getByTestId('cmd-viewForm')).toBeDisabled();   // pas encore enregistré
    expect(await testIds(page.getByTestId('ribbon-group-tools').locator('[data-testid^="cmd-"]')))
      .toEqual(['cmd-addExistingFields', 'cmd-propertySheet', 'cmd-tabOrder', 'cmd-chartSettings', 'cmd-subformInNewWindow', 'cmd-viewCode']);
    await expect(page.getByTestId('ruler-h')).toContainText('15');   // 16 cm de large, en cm
    await expect(page.getByTestId('ruler-v-detail')).toContainText('3');   // 4 cm de haut

    // Feuille de propriétés : le bouton du ruban la masque, F4 la rend
    await expect(page.getByTestId('property-sheet')).toBeVisible();
    await page.getByTestId('cmd-propertySheet').click();
    await expect(page.getByTestId('property-sheet')).toHaveCount(0);
    await page.keyboard.press('F4');
    await expect(page.getByTestId('property-sheet')).toBeVisible();
    await page.getByTestId('prop-RecordSource').fill('Clients');
    await page.getByTestId('prop-RecordSource').press('Enter');
    await expect(page.getByTestId('prop-RecordSource')).toHaveValue('Clients');

    // Liste des champs : double-clic, Entrée sur le bouton, glisser depuis le bouton du <li> déplaçable
    await page.getByTestId('cmd-addExistingFields').click();
    await expect(page.getByTestId('field-list')).toBeVisible();
    await page.getByTestId('field-Nom').dblclick();
    await expect(page.getByTestId('ctl-Nom')).toBeVisible();
    await expect(page.getByTestId('ctl-Nom_Étiquette')).toHaveText('Nom:');
    await page.getByTestId('field-Email').focus();
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('ctl-Email')).toBeVisible();
    const detail = page.locator('[data-section-body="1"]');
    await page.getByTestId('field-Ville').dragTo(detail, { targetPosition: { x: 300, y: 110 } });
    await expect(page.getByTestId('ctl-Ville')).toBeVisible();
    await expectLeft(page, 'Nom', '3,00 cm');
    await expectLeft(page, 'Ville', '3,00 cm', true);

    // un brouillon de la feuille est validé quand on clique sur la surface (le document change un instant après)
    await page.getByTestId('ctl-Nom_Étiquette').click();
    await page.getByTestId('prop-Caption').fill('Nom du client :');
    await page.getByTestId('ctl-Email').click();
    await expect.poll(() => page.getByTestId('ctl-Nom_Étiquette').textContent()).toBe('Nom du client :');
    await expect(page.getByTestId('sheet-object')).toHaveValue('c:Email');

    // glisser un contrôle de 1 cm (aimanté à la grille), puis Ctrl+Z
    await dragBy(page, page.getByTestId('ctl-Nom'), CM, 0);
    await expect(page.getByTestId('prop-Left')).toHaveValue('4,01 cm');
    await page.keyboard.press('Control+z');
    await expect(page.getByTestId('prop-Left')).toHaveValue('3,00 cm');

    // boîte à outils : Zone de texte, puis un clic dans le Détail
    await page.getByTestId('tool-textBox').click();
    await detail.click({ position: { x: 380, y: 20 } });
    await expect(page.getByTestId('ctl-Texte1')).toBeVisible();
    await expect(page.getByTestId('tool-select')).toHaveAttribute('aria-pressed', 'true');   // l'outil revient à Sélectionner
    await page.getByTestId('prop-Name').fill('Ville2');
    await page.getByTestId('prop-Name').press('Enter');
    await expect(page.getByTestId('ctl-Ville2')).toBeVisible();
    await expect(page.getByTestId('ctl-Texte1')).toHaveCount(0);
    await page.getByTestId('prop-ControlSource').fill('=Gauche([Nom];2)');   // affiché et saisi en français, stocké canonique
    await page.getByTestId('prop-ControlSource').press('Enter');
    await expect(page.getByTestId('ctl-Ville2')).toHaveText('=Gauche([Nom]; 2)');
    await page.getByTestId('prop-FontName').fill('Comic Sans MS');
    await page.getByTestId('prop-FontName').press('Enter');
    await expect(page.getByTestId('prop-FontName-note')).toHaveText(fr.sheet.fontNotPortable);
    await page.getByTestId('sheet-tab-event').click();
    await expect(page.getByTestId('sheet-events-later')).toBeVisible();
    await expect(page.getByTestId('prop-OnClick')).toBeDisabled();
    await page.getByTestId('sheet-tab-all').click();

    // clic droit sur la barre de l'en-tête : En-tête/pied de formulaire les affiche (1 cm)
    await page.getByTestId('section-formHeader').click({ button: 'right' });
    await page.getByTestId('section-menu-headerFooter').click();
    await page.getByTestId('section-formFooter').click();
    await expect(page.getByTestId('prop-Height')).toHaveValue('1,00 cm');
    await expect(page.getByTestId('prop-Visible')).toHaveValue('true');
    // la règle verticale du Détail suit : elle part du haut du corps du Détail, décalé par l'en-tête
    const top = async (l: Locator) => (await l.boundingBox())!.y;
    await expect.poll(async () => Math.abs((await top(page.getByTestId('ruler-v-detail'))) - (await top(detail)))).toBeLessThan(1);

    // Organiser : Maj+clic ajoute Ville à Nom ; groupes et commandes dans l'ordre d'Access ; Aligner › À gauche
    await page.getByTestId('ctl-Nom').click();
    await page.getByTestId('ctl-Ville').click({ modifiers: ['Shift'] });
    await page.getByTestId('ribbon-tab-arrange').click();
    await expect.poll(() => groups(page)).toEqual(['layoutTable', 'rowsColumns', 'mergeSplit', 'move', 'position', 'sizingOrdering'].map((g) => `ribbon-group-${g}`));
    expect(await testIds(page.getByTestId('ribbon-group-sizingOrdering').locator('[data-testid^="cmd-"]')))
      .toEqual(['cmd-sizeSpace', 'cmd-align', 'cmd-bringToFront', 'cmd-sendToBack']);
    await page.getByTestId('cmd-align').click();
    await page.getByTestId('arrange-menu-alignLeft').click();
    await expectLeft(page, 'Ville', '3,00 cm');

    // Taille/Espace › Aimanter à la grille décoché : un glisser n'aimante plus (10 px = 150 twips)
    await page.getByTestId('cmd-sizeSpace').click();
    await expect(page.getByTestId('arrange-menu-toggleSnap')).toHaveAttribute('aria-checked', 'true');
    await page.getByTestId('arrange-menu-toggleSnap').click();
    await dragBy(page, page.getByTestId('ctl-Ville'), 10, 0);
    await expect(page.getByTestId('prop-Left')).toHaveValue('3,26 cm');

    // Arrière-plan pour Ville, Premier plan pour Nom (ordre relu après l'enregistrement)
    await page.getByTestId('cmd-sendToBack').click();
    await page.getByTestId('ctl-Nom').click();
    await page.getByTestId('cmd-bringToFront').click();

    // Ordre de tabulation : Nom (premier) descend d'un cran
    await page.getByTestId('ribbon-tab-formDesign').click();
    await page.getByTestId('cmd-tabOrder').click();
    await expect(page.getByTestId('taborder-list-detail').locator('[role="option"]')).toHaveText(['Nom', 'Email', 'Ville', 'Ville2']);
    await page.getByTestId('taborder-down').click();
    const order = page.getByTestId('taborder-list-detail').locator('[role="option"]');
    await expect(order).toHaveText(['Email', 'Nom', 'Ville', 'Ville2']);
    // au clavier : Alt+Haut / Alt+Bas déplacent le contrôle choisi (Nom), Bas seul change le choix
    await page.getByTestId('taborder-list-detail').focus();
    await page.keyboard.press('Alt+ArrowUp');
    await expect(order).toHaveText(['Nom', 'Email', 'Ville', 'Ville2']);
    await page.keyboard.press('Alt+ArrowDown');
    await page.keyboard.press('Alt+ArrowDown');
    await expect(order).toHaveText(['Email', 'Ville', 'Nom', 'Ville2']);
    await page.keyboard.press('ArrowUp');
    await page.keyboard.press('Alt+ArrowDown');   // Ville, choisi, redescend
    await expect(order).toHaveText(['Email', 'Nom', 'Ville', 'Ville2']);
    await page.getByTestId('taborder-ok').click();
    await expect(page.getByTestId('doc-tab-form-Formulaire1')).toContainText('•');   // modifié

    // Ctrl+S : le nom est demandé, l'onglet et le volet prennent « Fiche client »
    await page.getByTestId('ctl-Nom').click();
    await page.keyboard.press('Control+s');
    await expect(page.getByTestId('modal-input')).toHaveValue('Formulaire1');
    await page.getByTestId('modal-input').fill('Fiche client');
    await page.getByTestId('modal-btn-ok').click();
    await expect(page.getByTestId('doc-tab-form-Fiche client')).toBeVisible();
    await expect(page.getByTestId('doc-tab-form-Fiche client')).not.toContainText('•');
    await expect(page.getByTestId('nav-item-form-Fiche client')).toBeVisible();
    await expect(page.getByTestId('cmd-viewForm')).toBeEnabled();

    const saved = await getForm(page, 'Fiche client');
    expect(saved.recordSource).toEqual({ kind: 'table', name: 'Clients' });
    expect(saved.sections.map((s) => s.kind)).toEqual(['formHeader', 'detail', 'formFooter']);
    expect(saved.sections[0]).toMatchObject({ height: 567, props: { Visible: true } });
    const d = saved.sections[1].controls;
    expect(d.map((c) => c.name)).toEqual(['Ville', 'Email', 'Ville2', 'Nom']);
    expect(d.find((c) => c.name === 'Ville2')!.props).toMatchObject({ ControlSource: '=Left([Nom], 2)', FontName: 'Comic Sans MS' });
    expect(Object.fromEntries(d.map((c) => [c.name, c.props.TabIndex]))).toEqual({ Email: 0, Nom: 1, Ville: 2, Ville2: 3 });
    expect(d.find((c) => c.name === 'Ville')!.left).toBe(1701 + 150);
    expect(d.find((c) => c.name === 'Nom')!.children![0]).toMatchObject({ kind: 'label', name: 'Nom_Étiquette', props: { Caption: 'Nom du client :' } });

    // menu du volet (C6) : disposition locale ; Mode Création rouvre le formulaire fermé, aux mêmes positions
    await page.getByTestId('nav-item-form-Fiche client').click({ button: 'right' });
    expect(await menuLayout(page)).toEqual(['open', 'layout', 'design', '|', 'export', '|', 'rename', 'hide', 'delete', '|', 'cut', 'copy', 'paste', '|', 'properties']);
    await expect(page.getByTestId('nav-menu-design')).toBeEnabled();
    await page.keyboard.press('Escape');
    await page.getByTestId('doc-tab-close-form-Fiche client').click();
    await expect(page.getByTestId('doc-tab-form-Fiche client')).toHaveCount(0);
    await page.getByTestId('nav-item-form-Fiche client').click({ button: 'right' });
    await page.getByTestId('nav-menu-design').click();
    await expect(page.getByTestId('doc-tab-form-Fiche client')).toBeVisible();
    await selected(page, 'formDesign');
    await expectLeft(page, 'Ville', '3,26 cm');
    await expectLeft(page, 'Nom', '3,00 cm');

    // En-tête/pied qui contiennent des contrôles : les masquer les supprime, après confirmation (Non : rien ne change)
    const footer = page.locator('[data-section-body="2"]');
    await page.getByTestId('tool-label').click();
    await footer.click({ position: { x: 60, y: 10 } });
    await expect(footer.locator('[data-ctl]')).toHaveCount(1);
    await page.getByTestId('section-formFooter').click({ button: 'right' });
    await page.getByTestId('section-menu-headerFooter').click();
    await expect(page.getByTestId('modal')).toContainText(fr.form.headerFooterConfirm);
    await page.getByTestId('modal-btn-no').click();
    await expect(footer.locator('[data-ctl]')).toHaveCount(1);
    await page.getByTestId('section-formFooter').click({ button: 'right' });
    await page.getByTestId('section-menu-headerFooter').click();
    await page.getByTestId('modal-btn-yes').click();
    await expect(footer.locator('[data-ctl]')).toHaveCount(0);
    await expect.poll(async () => (await footer.boundingBox())?.height ?? 0).toBe(0);

    // modifié : vers le mode Formulaire, Non reste en Création ; la fermeture propose Oui/Non/Annuler ; Oui enregistre puis change de mode
    await page.getByTestId('ctl-Nom').press('ArrowRight');
    await expect(page.getByTestId('doc-tab-form-Fiche client')).toContainText('•');
    await page.getByTestId('cmd-viewForm').click();
    await expect(page.getByTestId('modal')).toContainText(fr.form.mustSaveFirst.replace('{{name}}', 'Fiche client'));
    await page.getByTestId('modal-btn-no').click();
    await expect(page.getByTestId('design-canvas')).toBeVisible();
    await page.getByTestId('doc-tab-close-form-Fiche client').click();
    await expect(page.getByTestId('modal-btn-cancel')).toBeVisible();
    await page.getByTestId('modal-btn-cancel').click();
    await expect(page.getByTestId('doc-tab-form-Fiche client')).toBeVisible();
    // Mode Formulaire : la vue d'exécution
    await page.getByTestId('cmd-viewForm').click();
    await page.getByTestId('modal-btn-yes').click();
    await expect(page.getByTestId('form-run')).toBeVisible();
    await expect(page.getByTestId('ribbon-tab-formDesign')).toHaveCount(0);
    const after = await getForm(page, 'Fiche client');
    expect(after.sections[1].controls.find((c) => c.name === 'Nom')!.left).toBe(1846);   // une flèche : au point de grille suivant (142 twips)
    expect(after.sections[0]).toMatchObject({ height: 0, props: { Visible: false }, controls: [] });
    expect(after.sections[2]).toMatchObject({ height: 0, props: { Visible: false }, controls: [] });
  } finally {
    await app.close();
  }
});

const sample: DesignDoc = { formatVersion: '1.0', recordSource: { kind: 'table', name: 'Clients' }, props: { Width: 9072 }, sections: [
  { kind: 'formHeader', height: 0, props: { Visible: false }, controls: [] },
  { kind: 'detail', height: 2268, props: {}, controls: [{ kind: 'textBox', name: 'Nom', left: 1701, top: 0, width: 2268, height: 340, props: { ControlSource: 'Nom' } }] },
  { kind: 'formFooter', height: 0, props: { Visible: false }, controls: [] }] };

test('Ctrl+Z and Ctrl+Y undo and redo the design wherever the focus is in the view (Field List, ribbon), not in a text box of the sheet (its own undo)', async () => {
  const base = seedBase('formulaire-annuler', (db) => createTable(db, table));
  const { app, page } = await launchApp({ args: [base], env: { BASECRAFT_REGION: 'fr-FR' } });
  try {
    await page.getByTestId('ribbon-tab-create').click();
    await page.getByTestId('cmd-createFormDesign').click();
    await page.getByTestId('prop-RecordSource').fill('Clients');
    await page.getByTestId('prop-RecordSource').press('Enter');
    await page.getByTestId('cmd-addExistingFields').click();
    // the focus on the Field List's button: Ctrl+Z takes the field away, Ctrl+Y brings it back
    await page.getByTestId('field-Nom').dblclick();
    await expect(page.getByTestId('ctl-Nom')).toBeVisible();
    await expect(page.getByTestId('field-Nom')).toBeFocused();
    await page.keyboard.press('Control+z');
    await expect(page.getByTestId('ctl-Nom')).toHaveCount(0);
    await page.keyboard.press('Control+y');
    await expect(page.getByTestId('ctl-Nom')).toBeVisible();
    // the focus on a ribbon button (Property Sheet shown again)
    await page.getByTestId('ribbon-tab-formDesign').click();
    await page.getByTestId('cmd-propertySheet').click();
    await page.getByTestId('cmd-propertySheet').click();
    await expect(page.getByTestId('cmd-propertySheet')).toBeFocused();
    await page.keyboard.press('Control+z');
    await expect(page.getByTestId('ctl-Nom')).toHaveCount(0);
    await page.keyboard.press('Control+y');
    await expect(page.getByTestId('ctl-Nom')).toBeVisible();
    // in a text box of the sheet: the text box's own undo, the design untouched
    await page.getByTestId('ctl-Nom').click();
    await page.getByTestId('prop-Name').click();
    await page.keyboard.press('Control+z');
    await expect(page.getByTestId('ctl-Nom')).toBeVisible();
  } finally {
    await app.close();
  }
});

test('a definition that no longer matches: dropped controls and a missing table in banners, an unreadable one in place of the designer', async () => {
  const base = seedBase('formulaire-abime', (db) => {
    createTable(db, table);
    seedForm(db, 'Abîmé', { ...sample, recordSource: { kind: 'table', name: 'Disparue' },
      sections: sample.sections.map((s) => (s.kind === 'detail' ? { ...s, controls: [...s.controls, { kind: 'blob', name: 'X' } as never] } : s)) });
    seedForm(db, 'Cassé', { ...sample, formatVersion: '2.0' as never });
  });
  const { app, page } = await launchApp({ args: [base], env: { BASECRAFT_REGION: 'fr-FR' } });
  try {
    await page.getByTestId('nav-item-form-Abîmé').click({ button: 'right' });
    await page.getByTestId('nav-menu-design').click();
    await expect(page.getByTestId('form-dropped')).toHaveText(fr.form.dropped_one.replace('{{count}}', '1'));
    await expect(page.getByTestId('form-source-error')).toContainText('Disparue');
    await expect(page.getByTestId('ctl-Nom')).toBeVisible();   // le concepteur reste utilisable
    await page.getByTestId('nav-item-form-Cassé').click({ button: 'right' });
    await page.getByTestId('nav-menu-design').click();
    await expect(page.getByTestId('form-load-error')).toHaveText(fr.dialog.error.corruptObject);
    await page.getByTestId('doc-tab-close-form-Cassé').click();   // l'onglet reste fermable
    await expect(page.getByTestId('doc-tab-form-Cassé')).toHaveCount(0);
  } finally {
    await app.close();
  }
});

test('read-only base: Design view opens for viewing, a drag moves nothing, Arrange and Save are disabled', async () => {
  const base = seedBase('formulaire-lecture', (db) => { createTable(db, table); seedForm(db, 'Fiche', sample); });
  const a = await launchApp({ args: [base], env: { BASECRAFT_REGION: 'fr-FR' } });
  const b = await launchApp({ args: [base], env: { BASECRAFT_REGION: 'fr-FR' } });
  try {
    const page = b.page;
    await expect(page.getByTestId('banner-readonly')).toBeVisible();
    await page.getByTestId('nav-item-form-Fiche').click({ button: 'right' });
    await expect(page.getByTestId('nav-menu-design')).toBeEnabled();
    await page.getByTestId('nav-menu-design').click();
    await expect(page.getByTestId('ctl-Nom')).toBeVisible();
    const before = await page.getByTestId('ctl-Nom').boundingBox();
    await dragBy(page, page.getByTestId('ctl-Nom'), 2 * CM, 0);
    await expect(page.getByTestId('sheet-object')).toHaveValue('c:Nom');   // le clic sélectionne
    expect(await page.getByTestId('ctl-Nom').boundingBox()).toEqual(before);   // rien n'a bougé
    await expect(page.getByTestId('prop-Left')).toHaveValue('3,00 cm');
    expect((await getForm(page, 'Fiche')).sections[1].controls[0].left).toBe(1701);
    await expect(page.getByTestId('prop-Left')).toBeDisabled();
    await page.getByTestId('ribbon-tab-arrange').click();
    await expect(page.getByTestId('cmd-sizeSpace')).toBeDisabled();
    await page.getByTestId('ribbon-tab-home').click();
    await expect(page.getByTestId('cmd-save')).toBeDisabled();
    await expect(page.getByTestId('tool-textBox')).toBeDisabled();
    await page.getByTestId('ribbon-tab-formDesign').click();
    await expect(page.getByTestId('cmd-tabOrder')).toBeEnabled();   // ouvert en lecture seule
    await page.getByTestId('cmd-tabOrder').click();
    await expect(page.getByTestId('taborder-down')).toBeDisabled();
    await page.getByTestId('taborder-cancel').click();
  } finally {
    await b.app.close();
    await a.app.close();
  }
});
