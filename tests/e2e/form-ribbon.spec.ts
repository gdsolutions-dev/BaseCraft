// Ruban des formulaires (A4, tâche 5b ; C10, M7) : galerie Contrôles (le même outil que la boîte à outils), En-tête/pied (Logo, Titre,
// Date et heure), onglet Format (chaque commande sur la sélection, une seule annulation), Créer › Formulaire vierge, base en lecture seule.
import { test, expect, type Locator, type Page } from '@playwright/test';
import { createTable } from '../../src/main/db/schema';
import type { BasecraftApi } from '../../src/shared/api';
import type { DesignDoc } from '../../src/shared/design/model';
import { clients } from '../../src/shared/test-fixtures';
import { launchApp, seedBase, seedForm } from './helpers';

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
const testIds = (l: Locator) => l.evaluateAll((els) => els.map((e) => e.getAttribute('data-testid')));
const groups = (page: Page) => testIds(page.locator('[data-testid^="ribbon-group-"]'));
const cmds = (page: Page, group: string) => testIds(page.getByTestId(`ribbon-group-${group}`).locator('[data-testid^="cmd-"]'));
const selected = (page: Page, tab: string) => expect(page.getByTestId(`ribbon-tab-${tab}`)).toHaveAttribute('aria-selected', 'true');
const getForm = (page: Page, name: string) => page.evaluate((n) => (window as unknown as { basecraft: BasecraftApi }).basecraft.objects.get('form', n), name)
  .then((r) => r.definition as DesignDoc);

const fiche: DesignDoc = { formatVersion: '1.0', recordSource: { kind: 'table', name: 'Clients' }, props: { Width: 9072 }, sections: [
  { kind: 'formHeader', height: 0, props: { Visible: false }, controls: [] },
  { kind: 'detail', height: 4536, props: {}, controls: [
    { kind: 'textBox', name: 'Nom', left: 1701, top: 0, width: 2268, height: 340, props: { ControlSource: 'Nom' } },
    { kind: 'label', name: 'Titre', left: 5103, top: 0, width: 1418, height: 340, props: { Caption: 'Titre' } }] },
  { kind: 'formFooter', height: 0, props: { Visible: false }, controls: [] }] };

/** Un outil de la galerie, puis un clic dans le Détail : le contrôle `name` apparaît (Étiquette1 : l'étiquette attachée de Texte1). */
const TOOLS: [string, string][] = [['label', 'Étiquette2'], ['button', 'Commande1'], ['tabControl', 'OngletCtl1'], ['optionGroup', 'Cadre1'],
  ['insertPageBreak', 'SautPage1'], ['comboBox', 'Modifiable1'], ['line', 'Trait1'], ['listBox', 'Liste1'], ['rectangle', 'Rectangle1'],
  ['checkBox', 'Case1'], ['optionButton', 'Option1'], ['subform', 'Enfant1'], ['image', 'Image1']];

test('Form ribbon: Controls gallery, Header/Footer, Format tab, Blank Form', async () => {
  test.setTimeout(180000);
  const base = seedBase('formulaire-ruban', (db) => { createTable(db, clients); seedForm(db, 'Fiche', fiche); });
  const { app, page } = await launchApp({ args: [base], env: { BASECRAFT_REGION: 'fr-FR' } });
  try {
    await page.getByTestId('nav-item-form-Fiche').click({ button: 'right' });
    await page.getByTestId('nav-menu-design').click();
    await expect(page.getByTestId('ctl-Nom')).toBeVisible();
    await selected(page, 'formDesign');
    await expect.poll(() => groups(page)).toEqual(['view', 'themes', 'controls', 'headerFooter', 'tools'].map((g) => `ribbon-group-${g}`));
    expect(await cmds(page, 'controls')).toEqual(['select', 'textBox', 'label', 'button', 'tabControl', 'hyperlink', 'navigationControl', 'optionGroup',
      'insertPageBreak', 'comboBox', 'line', 'toggleButton', 'listBox', 'rectangle', 'checkBox', 'unboundObjectFrame', 'attachment', 'optionButton', 'subform',
      'boundObjectFrame', 'image', 'webBrowser', 'chart', 'insertImage', 'insertModernChart'].map((c) => `cmd-${c}`));
    expect(await cmds(page, 'headerFooter')).toEqual(['cmd-logo', 'cmd-title', 'cmd-dateTime']);
    await expect(page.getByTestId('cmd-hyperlink')).toHaveAttribute('data-planned', 'later');
    await expect(page.getByTestId('cmd-subformInNewWindow')).toHaveAttribute('data-planned', 'later');
    // aucun contrôle sélectionné : Format n'offre que Objet et Sélectionner tout
    await page.getByTestId('ribbon-tab-format').click();
    for (const id of ['bold', 'font', 'fontColor', 'format', 'increaseDecimals', 'shapeOutline']) await expect(page.getByTestId(`cmd-${id}`), id).toBeDisabled();
    for (const id of ['objectList', 'selectAll']) await expect(page.getByTestId(`cmd-${id}`), id).toBeEnabled();
    await page.getByTestId('ribbon-tab-formDesign').click();

    // galerie Contrôles : le même outil que la boîte à outils ; un clic dans le Détail pose le contrôle, l'outil revient à Sélectionner
    const detail = page.locator('[data-section-body="1"]');
    await page.getByTestId('cmd-textBox').click();
    await expect(page.getByTestId('tool-textBox')).toHaveAttribute('aria-pressed', 'true');
    await detail.click({ position: { x: 110, y: 45 } });
    await expect(page.getByTestId('ctl-Texte1')).toBeVisible();
    await expect(page.getByTestId('tool-select')).toHaveAttribute('aria-pressed', 'true');
    await page.getByTestId('cmd-label').click();
    await page.getByTestId('cmd-select').click();
    await expect(page.getByTestId('tool-select')).toHaveAttribute('aria-pressed', 'true');
    for (const [i, [cmd, name]] of TOOLS.entries()) {
      await page.getByTestId(`cmd-${cmd}`).click();
      await detail.click({ position: { x: 110 + 150 * ((i + 1) % 3), y: 45 + 40 * Math.floor((i + 1) / 3) } });
      await expect(page.getByTestId(`ctl-${name}`), cmd).toBeVisible();
    }

    // En-tête/pied : Titre (le nom du formulaire), Date et heure, Logo ; l'en-tête s'affiche
    const header = page.locator('[data-section-body="0"]');
    await page.getByTestId('cmd-title').click();
    await expect(header.getByText('Fiche', { exact: true })).toBeVisible();
    await page.getByTestId('cmd-dateTime').click();
    await expect(header.locator('[data-ctl]')).toHaveCount(3);
    const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.getByTestId('cmd-logo').click()]);
    await chooser.setFiles({ name: 'logo.png', mimeType: 'image/png', buffer: PNG });
    await expect(header.locator('[data-ctl]')).toHaveCount(4);
    await expect(header.locator('img')).toHaveCount(1);

    // Format sur une sélection multiple : Gras pour Nom et Titre, une seule annulation les rend tous deux
    const weight = async (name: string) => { await page.getByTestId(`ctl-${name}`).click(); return page.getByTestId('prop-FontWeight'); };
    await page.getByTestId('ctl-Nom').click();
    await page.getByTestId('ctl-Titre').click({ modifiers: ['Shift'] });
    await page.getByTestId('ribbon-tab-format').click();
    await expect.poll(() => groups(page)).toEqual(['selection', 'font', 'number', 'background', 'controlFormatting'].map((g) => `ribbon-group-${g}`));
    await page.getByTestId('cmd-bold').click();
    await expect(page.getByTestId('prop-FontWeight')).toHaveValue('bold');   // les deux : pas de valeur mixte
    await page.getByTestId('ctl-Nom').focus();   // déjà sélectionné : la sélection reste
    await expect(page.getByTestId('sheet-object')).toHaveValue('multi');
    await page.keyboard.press('Control+z');
    await expect(await weight('Titre')).toHaveValue('normal');
    await expect(await weight('Nom')).toHaveValue('normal');

    // Format : sur Nom
    await page.getByTestId('cmd-bold').click();
    await expect(page.getByTestId('prop-FontWeight')).toHaveValue('bold');
    await page.getByTestId('cmd-italic').click();
    await expect(page.getByTestId('prop-FontItalic')).toHaveValue('true');
    await page.getByTestId('cmd-underline').click();
    await expect(page.getByTestId('prop-FontUnderline')).toHaveValue('true');
    await page.getByTestId('cmd-alignCenter').click();
    await expect(page.getByTestId('prop-TextAlign')).toHaveValue('center');
    await page.getByTestId('cmd-font').click();
    await expect(page.getByTestId('format-popup-font')).toBeVisible();
    await page.getByTestId('format-popup-font-name').fill('Carlito');
    await page.getByTestId('format-popup-font-name').press('Enter');
    await expect(page.getByTestId('format-popup-font')).toHaveCount(0);
    await expect(page.getByTestId('prop-FontName')).toHaveValue('Carlito');
    await page.getByTestId('cmd-fontSize').click();
    await page.getByTestId('format-popup-fontSize-14').click();
    await expect(page.getByTestId('prop-FontSize')).toHaveValue('14');
    // les pastilles au clavier : le focus va à la couleur actuelle, flèches, Début/Fin, puis Échap referme
    await page.getByTestId('cmd-fontColor').click();
    await expect(page.getByTestId('format-popup-fontColor')).toHaveAttribute('role', 'dialog');   // colour choices, no menu items
    await expect(page.getByTestId('cmd-fontColor')).toHaveAttribute('aria-haspopup', 'dialog');
    const swatch = (tok: string) => page.getByTestId(`format-popup-fontColor-colors-${tok}`);
    await expect(swatch('text')).toBeFocused();
    await page.keyboard.press('ArrowDown'); await expect(swatch('textMuted')).toBeFocused();
    await page.keyboard.press('ArrowRight'); await expect(swatch('border')).toBeFocused();
    await page.keyboard.press('ArrowUp'); await expect(swatch('textMuted')).toBeFocused();
    await page.keyboard.press('End'); await expect(swatch('custom')).toBeFocused();
    await page.keyboard.press('ArrowDown'); await expect(swatch('background')).toBeFocused();
    await page.keyboard.press('ArrowLeft'); await expect(swatch('custom')).toBeFocused();
    await page.keyboard.press('Home'); await expect(swatch('background')).toBeFocused();
    await page.keyboard.press('Escape'); await expect(page.getByTestId('format-popup-fontColor')).toHaveCount(0);
    for (const [cmd, token, prop, label] of [['fontColor', 'accent', 'ForeColor', 'Accent'], ['backColor', 'danger', 'BackColor', 'Danger'],
      ['shapeFill', 'warning', 'BackColor', 'Avertissement'], ['shapeOutline', 'accent', 'BorderColor', 'Accent']]) {
      await page.getByTestId(`cmd-${cmd}`).click();
      await page.getByTestId(`format-popup-${cmd}-colors-${token}`).click();
      await expect(page.getByTestId(`prop-${prop}`), cmd).toHaveText(label);
    }
    await page.getByTestId('cmd-format').click();
    await page.getByTestId('format-popup-format-fixed').click();
    await expect(page.getByTestId('prop-Format')).toHaveValue('fixed');
    for (const [cmd, value] of [['currencyFormat', 'currency'], ['percentFormat', 'percent'], ['commaFormat', 'standard']]) {
      await page.getByTestId(`cmd-${cmd}`).click();
      await expect(page.getByTestId('prop-Format'), cmd).toHaveValue(value);
    }
    await page.getByTestId('cmd-increaseDecimals').click();
    await expect(page.getByTestId('prop-DecimalPlaces')).toHaveValue('3');   // Auto compte pour 2
    await page.getByTestId('cmd-decreaseDecimals').click();
    await expect(page.getByTestId('prop-DecimalPlaces')).toHaveValue('2');
    // Ctrl+Z annule une commande Format
    await page.getByTestId('ctl-Nom').click();
    await page.keyboard.press('Control+z');
    await expect(page.getByTestId('prop-DecimalPlaces')).toHaveValue('3');

    // Sélection : Objet, Sélectionner tout
    await page.getByTestId('cmd-objectList').click();
    await expect(page.getByTestId('format-popup-objectList')).toBeVisible();
    await page.getByTestId('format-popup-objectList-s:1').click();
    await expect(page.getByTestId('sheet-object')).toHaveValue('s:1');
    await page.getByTestId('cmd-selectAll').click();
    await expect(page.getByTestId('sheet-object')).toHaveValue('multi');

    // Ctrl+S : les propriétés écrites
    await page.keyboard.press('Control+s');
    await expect(page.getByTestId('doc-tab-form-Fiche')).not.toContainText('•');
    const saved = await getForm(page, 'Fiche');
    expect(saved.sections[1].controls.find((c) => c.name === 'Nom')!.props).toMatchObject({ FontWeight: 'bold', FontItalic: true, FontUnderline: true,
      TextAlign: 'center', FontName: 'Carlito', FontSize: 14, ForeColor: 'theme:accent', BackColor: 'theme:warning', BackStyle: 'normal',
      BorderColor: 'theme:accent', Format: 'standard', DecimalPlaces: '3' });
    expect(saved.sections[0]).toMatchObject({ kind: 'formHeader', props: { Visible: true } });
    expect(saved.sections[0].controls.map((c) => [c.kind, c.props.ControlSource ?? c.props.Caption ?? c.props.SizeMode]))
      .toEqual([['label', 'Fiche'], ['textBox', '=Date()'], ['textBox', '=Time()'], ['image', 'zoom']]);

    // Créer › Formulaire vierge : un nouveau formulaire en mode Création, la Liste des champs affichée
    await page.getByTestId('ribbon-tab-create').click();
    await page.getByTestId('cmd-createBlankForm').click();
    await expect(page.getByTestId('doc-tab-form-Formulaire1')).toBeVisible();
    await expect(page.getByTestId('doc-tab-form-Formulaire1')).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByTestId('field-list')).toBeVisible();
    await expect(page.getByTestId('prop-RecordSource')).toHaveValue('');   // indépendant
  } finally {
    await app.close();
  }
});

test('read-only base: Format and gallery commands are disabled, Select All works', async () => {
  const base = seedBase('formulaire-ruban-lecture', (db) => { createTable(db, clients); seedForm(db, 'Fiche', fiche); });
  const a = await launchApp({ args: [base], env: { BASECRAFT_REGION: 'fr-FR' } });
  const b = await launchApp({ args: [base], env: { BASECRAFT_REGION: 'fr-FR' } });
  try {
    const page = b.page;
    await expect(page.getByTestId('banner-readonly')).toBeVisible();
    await page.getByTestId('nav-item-form-Fiche').click({ button: 'right' });
    await page.getByTestId('nav-menu-design').click();
    await expect(page.getByTestId('ctl-Nom')).toBeVisible();
    await expect(page.getByTestId('cmd-textBox')).toBeDisabled();
    await expect(page.getByTestId('cmd-title')).toBeDisabled();
    await page.getByTestId('ribbon-tab-format').click();
    await expect(page.getByTestId('cmd-bold')).toBeDisabled();
    await expect(page.getByTestId('cmd-selectAll')).toBeEnabled();
    await page.getByTestId('cmd-selectAll').click();
    await expect(page.getByTestId('sheet-object')).toHaveValue('multi');
    await page.getByTestId('cmd-objectList').click();
    await page.getByTestId('format-popup-objectList-c:Nom').click();
    await expect(page.getByTestId('sheet-object')).toHaveValue('c:Nom');
  } finally {
    await b.app.close();
    await a.app.close();
  }
});
