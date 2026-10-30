// Couper, Copier, Coller des contrôles en mode Création : raccourcis, Accueil › Presse-papiers, étiquette attachée, multi-sélection,
// annulation, d'un formulaire à l'autre et vers un état (genres absents de l'état écartés), texte de la Feuille de propriétés intact.
import { test, expect, type Page } from '@playwright/test';
import { createTable } from '../../src/main/db/schema';
import { saveObject } from '../../src/main/db/objects';
import type { BasecraftApi } from '../../src/shared/api';
import type { ControlDef, DesignDoc } from '../../src/shared/design/model';
import { clients, t } from '../../src/shared/test-fixtures';
import { launchApp, seedBase, seedForm } from './helpers';

const cur = (page: Page) => page.locator('.doc:not([hidden])');
const ctl = (page: Page, name: string) => cur(page).getByTestId(`ctl-${name}`);
const embedded = { embedded: { formatVersion: '1.0', items: [] } };
const box = (kind: ControlDef['kind'], name: string, left: number, top: number, props: Record<string, unknown>, children?: ControlDef[]): ControlDef =>
  ({ kind, name, left, top, width: 2268, height: 340, props, ...(children ? { children } : {}) });
const form = (controls: ControlDef[]): DesignDoc => ({ formatVersion: '1.0', recordSource: { kind: 'table', name: 'Clients' }, props: {}, sections: [
  { kind: 'formHeader', height: 0, props: { Visible: false }, controls: [] }, { kind: 'detail', height: 2835, props: {}, controls },
  { kind: 'formFooter', height: 0, props: { Visible: false }, controls: [] }] });
const report: DesignDoc = { formatVersion: '1.0', recordSource: { kind: 'table', name: 'Clients' }, props: {}, sections: [
  { kind: 'pageHeader', height: 567, props: {}, controls: [{ kind: 'label', name: 'lblTitre', left: 0, top: 0, width: 2268, height: 340, props: { Caption: 'Titre' } }] }, { kind: 'detail', height: 1134, props: {}, controls: [] },
  { kind: 'pageFooter', height: 567, props: {}, controls: [] }] };
const getDoc = (page: Page, kind: 'form' | 'report', name: string) => page.evaluate(([k, n]) =>
  (window as unknown as { basecraft: BasecraftApi }).basecraft.objects.get(k as 'form', n), [kind, name]).then((r) => r.definition as DesignDoc);
const find = (doc: DesignDoc, name: string) => doc.sections.flatMap((s) => s.controls).find((c) => c.name === name);
async function design(page: Page, kind: 'form' | 'report', name: string) {
  await page.getByTestId(`nav-item-${kind}-${name}`).click({ button: 'right' });
  await page.getByTestId('nav-menu-design').click();
  await expect(cur(page).getByTestId('designer')).toBeVisible();
}
const pos = async (page: Page, name: string) => { const b = (await ctl(page, name).boundingBox())!; return [Math.round(b.x), Math.round(b.y)]; };

test('Design view clipboard: copy, cut, paste controls in forms and reports, between objects, with undo', async () => {
  test.setTimeout(120000);
  const base = seedBase('presse-papiers-creation', (db) => {
    createTable(db, t('Clients', clients.fields));
    seedForm(db, 'A', form([
      box('textBox', 'Texte1', 1418, 0, { ControlSource: 'Nom', FontWeight: 'bold', TabIndex: 0, OnClick: embedded }, [box('label', 'Étiquette1', 0, 0, { Caption: 'Nom:' })]),
      box('commandButton', 'Commande1', 1418, 1134, { Caption: 'OK', TabIndex: 1 })]));
    seedForm(db, 'B', form([]));
    const r = saveObject(db, 'report', 'R', report, null);
    if (!r.ok) throw new Error(r.reason);
  });
  const { app, page } = await launchApp({ args: [base], env: { BASECRAFT_REGION: 'fr-FR' } });
  try {
    await design(page, 'form', 'A');
    const controls = cur(page).locator('[data-ctl]');
    await expect(controls).toHaveCount(3);

    // Ctrl+V with nothing copied: nothing; Home › Paste greyed
    await page.getByTestId('ribbon-tab-home').click();
    await expect(page.getByTestId('cmd-paste')).toBeDisabled();
    // …but the Navigation Pane's object clipboard keeps it: a form copied in the pane, Home › Paste with the focus there
    await page.getByTestId('nav-item-form-B').click({ button: 'right' });
    await page.getByTestId('nav-menu-copy').click();
    await expect(page.getByTestId('cmd-paste')).toBeEnabled();
    await page.getByTestId('nav-item-form-B').click();
    await page.getByTestId('cmd-paste').click();
    await page.getByTestId('paste-ok').click();
    await expect(page.getByTestId('nav-item-form-Copie de B')).toBeVisible();
    await expect(cur(page).getByTestId('designer')).toBeVisible();   // form A still in Design view
    await ctl(page, 'Texte1').click();
    await page.keyboard.press('Control+v');
    await expect(controls).toHaveCount(3);

    // Ctrl+C, Ctrl+V: the copy below the original, renamed, its label with it, selected
    await page.keyboard.press('Control+c');
    await page.keyboard.press('Control+v');
    await expect(ctl(page, 'Texte2')).toBeVisible();
    await expect(page.getByTestId('cmd-paste')).toBeEnabled();
    await expect(ctl(page, 'Étiquette2')).toHaveText('Nom:');
    await expect(ctl(page, 'Texte2')).toHaveAttribute('aria-pressed', 'true');
    const [x1, y1] = await pos(page, 'Texte1'), [x2, y2] = await pos(page, 'Texte2');
    expect(x2).toBe(x1); expect(y2).toBeGreaterThan(y1);
    // Ctrl+Z: the paste is one undo step; Ctrl+Y brings it back
    await page.keyboard.press('Control+z');
    await expect(ctl(page, 'Texte2')).toHaveCount(0);
    await expect(ctl(page, 'Étiquette2')).toHaveCount(0);
    await page.keyboard.press('Control+y');
    await expect(ctl(page, 'Étiquette2')).toBeVisible();
    await page.keyboard.press('Control+s');
    await expect.poll(async () => find(await getDoc(page, 'form', 'A'), 'Texte2')).toMatchObject({
      props: { ControlSource: 'Nom', FontWeight: 'bold', TabIndex: 2, OnClick: embedded }, children: [{ name: 'Étiquette2', props: { Caption: 'Nom:' } }] });
    await ctl(page, 'Texte2').click();
    await page.keyboard.press('Delete');
    await expect(controls).toHaveCount(3);

    // a multi-selection through Home › Clipboard: relative positions kept
    await ctl(page, 'Texte1').click();
    await ctl(page, 'Commande1').click({ modifiers: ['Control'] });
    await page.getByTestId('ribbon-tab-home').click();
    await page.getByTestId('cmd-copy').click();
    await page.getByTestId('cmd-paste').click();
    await expect(ctl(page, 'Texte2')).toBeVisible();
    await expect(ctl(page, 'Commande2')).toBeVisible();
    const [, a1] = await pos(page, 'Texte1'), [, b1] = await pos(page, 'Commande1'), [, a2] = await pos(page, 'Texte2'), [, b2] = await pos(page, 'Commande2');
    expect(Math.abs(b2 - a2 - (b1 - a1))).toBeLessThanOrEqual(1);   // twips to px rounding

    // Ctrl+X on one control, then Ctrl+Z: one undo step; Home › Cut does the same
    await ctl(page, 'Commande2').click();
    await page.keyboard.press('Control+x');
    await expect(ctl(page, 'Commande2')).toHaveCount(0);
    await page.keyboard.press('Control+z');
    await expect(ctl(page, 'Commande2')).toBeVisible();
    await ctl(page, 'Commande2').click();
    await page.getByTestId('cmd-cut').click();
    await expect(ctl(page, 'Commande2')).toHaveCount(0);
    await ctl(page, 'Texte1').click();
    await page.keyboard.press('Control+v');   // the cut control back where it was (its place is free), in the selected control's section
    await expect(ctl(page, 'Commande2')).toBeVisible();
    expect(Math.abs((await pos(page, 'Commande2'))[1] - b2)).toBeLessThanOrEqual(1);

    // the Property Sheet keeps its own text copy and paste
    await ctl(page, 'Commande1').click();
    const caption = page.getByTestId('prop-Caption');
    await caption.click();
    await caption.press('Control+a');
    await caption.press('Control+c');
    await caption.press('End');
    await caption.press('Control+v');
    await expect(caption).toHaveValue('OKOK');
    await expect(controls).toHaveCount(6);

    // from one form to another: copy Texte1 and Commande1, paste in B's Detail
    await ctl(page, 'Texte1').click();
    await ctl(page, 'Commande1').click({ modifiers: ['Control'] });
    await page.keyboard.press('Control+c');
    await design(page, 'form', 'B');
    await cur(page).getByTestId('section-detail').click();
    await page.keyboard.press('Control+v');
    await expect(ctl(page, 'Texte1')).toBeVisible();
    await expect(ctl(page, 'Étiquette1')).toHaveText('Nom:');
    await expect(ctl(page, 'Commande1')).toBeVisible();

    // to a report: the command button is not a report control, the text box and its label are pasted
    await design(page, 'report', 'R');
    await cur(page).getByTestId('section-detail').click();
    await page.keyboard.press('Control+v');
    await expect(ctl(page, 'Texte1')).toBeVisible();
    await expect(ctl(page, 'Étiquette1')).toBeVisible();
    await expect(cur(page).locator('[data-ctl]')).toHaveCount(3);
    await page.keyboard.press('Control+z');
    await expect(cur(page).locator('[data-ctl]')).toHaveCount(1);

    // a cut from the page header, then Ctrl+V with nothing selected: back in the page header, under its own name
    await ctl(page, 'lblTitre').click();
    await page.keyboard.press('Control+x');
    await expect(ctl(page, 'lblTitre')).toHaveCount(0);
    await page.keyboard.press('Control+v');
    await expect(cur(page).locator('.dz-block', { has: page.getByTestId('section-pageHeader') }).getByTestId('ctl-lblTitre')).toHaveText('Titre');
  } finally {
    await app.close();
  }
});
