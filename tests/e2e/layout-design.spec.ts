// Dispositions en mode Création (Organiser › Tableau) : Empilé sur cinq champs mal alignés, contour et poignée, Insérer au-dessus,
// Monter, enregistrement et réouverture, Tabulaire (l'en-tête de formulaire apparaît avec les étiquettes, une seule annulation),
// Supprimer la disposition (positions gardées) ; en mode Formulaire, l'étiquette d'un Empilé nomme son contrôle et se masque avec lui.
import { test, expect, type Page } from '@playwright/test';
import { createTable } from '../../src/main/db/schema';
import type { BasecraftApi } from '../../src/shared/api';
import type { ControlDef, DesignDoc } from '../../src/shared/design/model';
import { createLayout, membersOf } from '../../src/shared/design/layout-edit';
import { clients, t } from '../../src/shared/test-fixtures';
import { launchApp, seedBase, seedForm } from './helpers';

const cur = (page: Page) => page.locator('.doc:not([hidden])');
const ctl = (page: Page, name: string) => cur(page).getByTestId(`ctl-${name}`);
const handles = (page: Page) => cur(page).locator('[data-testid^="layout-handle-"]');
const N = [1, 2, 3, 4, 5];
// cinq zones de texte mal alignées, chacune avec son étiquette attachée
const field = (i: number, left: number, top: number): ControlDef => ({ kind: 'textBox', name: `Texte${i}`, left, top, width: 2268, height: 340, props: {},
  children: [{ kind: 'label', name: `Étiquette${i}`, left: 100, top, width: 1200, height: 340, props: { Caption: `Champ ${i}:` } }] });
const form: DesignDoc = { formatVersion: '1.0', recordSource: { kind: 'table', name: 'Clients' }, props: {}, sections: [
  { kind: 'formHeader', height: 0, props: { Visible: false }, controls: [] },
  { kind: 'detail', height: 5000, props: {}, controls: [field(1, 1500, 200), field(2, 1700, 700), field(3, 1400, 1300), field(4, 1650, 1800), field(5, 1550, 2400)] },
  { kind: 'formFooter', height: 0, props: { Visible: false }, controls: [] }] };
const getDoc = (page: Page, name: string) => page.evaluate((n) =>
  (window as unknown as { basecraft: BasecraftApi }).basecraft.objects.get('form', n), name).then((r) => r.definition as DesignDoc);
const find = (doc: DesignDoc, name: string) => doc.sections.flatMap((s) => s.controls).find((c) => c.name === name);
async function design(page: Page, name: string) {
  await page.getByTestId(`nav-item-form-${name}`).click({ button: 'right' });
  await page.getByTestId('nav-menu-design').click();
  await expect(cur(page).getByTestId('designer')).toBeVisible();
}
const pos = async (page: Page, name: string) => { const b = (await ctl(page, name).boundingBox())!; return [Math.round(b.x), Math.round(b.y)]; };
const all = (page: Page, names: string[]) => Promise.all(names.map((n) => pos(page, n)));
const cmd = (page: Page, id: string) => page.getByTestId(`cmd-${id}`).click();
async function selectAll(page: Page) {
  await cur(page).getByTestId('section-detail').click();
  await page.keyboard.press('Control+a');
}

test('Design view layouts: Stacked, insert, move, save, Tabular, remove', async () => {
  test.setTimeout(120000);
  const base = seedBase('dispositions-creation', (db) => {
    createTable(db, t('Clients', clients.fields));
    seedForm(db, 'A', form);
  });
  const { app, page } = await launchApp({ args: [base], env: { BASECRAFT_REGION: 'fr-FR' } });
  try {
    await design(page, 'A');
    await expect(handles(page)).toHaveCount(0);   // pas de disposition : pas de contour
    await expect(cur(page).locator('.dz-layout')).toHaveCount(0);

    // Empilé : une colonne d'étiquettes, une colonne de contrôles alignés à gauche, de haut en bas
    await selectAll(page);
    await page.getByTestId('ribbon-tab-arrange').click();
    await cmd(page, 'stacked');
    await expect(handles(page)).toHaveCount(1);
    await expect(cur(page).locator('.dz-layout')).toHaveCount(1);
    await expect.poll(async () => new Set((await all(page, N.map((i) => `Texte${i}`))).map(([x]) => x)).size).toBe(1);
    const tops = (await all(page, N.map((i) => `Texte${i}`))).map(([, y]) => y);
    expect(tops).toEqual([...tops].sort((a, b) => a - b));
    expect(new Set(tops).size).toBe(5);
    const [lx] = await pos(page, 'Étiquette1'), [tx] = await pos(page, 'Texte1');
    expect(lx).toBeLessThan(tx);

    // la poignée sélectionne toute la disposition (contrôles et étiquettes)
    await ctl(page, 'Texte4').click();
    await handles(page).first().click();
    for (const n of N.flatMap((i) => [`Texte${i}`, `Étiquette${i}`])) await expect(ctl(page, n), n).toHaveAttribute('aria-pressed', 'true');

    // Insérer au-dessus du deuxième : le troisième descend
    const [, y3] = await pos(page, 'Texte3');
    await ctl(page, 'Texte2').click();
    await cmd(page, 'insertAbove');
    await expect.poll(async () => (await pos(page, 'Texte3'))[1]).toBeGreaterThan(y3);

    // Monter : le troisième prend la place du deuxième
    const [, y2] = await pos(page, 'Texte2');
    await ctl(page, 'Texte3').click();
    await cmd(page, 'moveUp');
    await expect.poll(async () => (await pos(page, 'Texte3'))[1]).toBe(y2);
    expect((await pos(page, 'Texte2'))[1]).toBeGreaterThan(y2);

    // enregistré, fermé, rouvert : positions et disposition gardées
    const before = await all(page, N.flatMap((i) => [`Texte${i}`, `Étiquette${i}`]));
    await ctl(page, 'Texte1').click();
    await page.keyboard.press('Control+s');
    await expect.poll(async () => (await getDoc(page, 'A')).props.Layouts).toMatchObject([{ id: 'L1', kind: 'stacked' }]);
    const saved = await getDoc(page, 'A');
    expect(find(saved, 'Texte3')!.top).toBeLessThan(find(saved, 'Texte2')!.top);
    expect(find(saved, 'Texte2')!.props.LayoutID).toBe('L1');
    expect(find(saved, 'Étiquette2')).toMatchObject({ kind: 'label', props: { LayoutID: 'L1' } });
    await page.getByTestId('doc-tab-close-form-A').click();
    await expect(page.getByTestId('doc-tab-form-A')).toHaveCount(0);
    await design(page, 'A');
    await expect(handles(page)).toHaveCount(1);
    expect(await all(page, N.flatMap((i) => [`Texte${i}`, `Étiquette${i}`]))).toEqual(before);

    // Tabulaire : l'en-tête de formulaire masqué s'affiche, les étiquettes y montent ; les contrôles sur une ligne du Détail
    const header = cur(page).locator('.dz-block', { has: page.getByTestId('section-formHeader') });
    await selectAll(page);
    await page.getByTestId('ribbon-tab-arrange').click();
    await cmd(page, 'tabular');
    for (const i of N) await expect(header.getByTestId(`ctl-Étiquette${i}`)).toBeVisible();
    await expect(handles(page)).toHaveCount(2);   // un contour par section traversée
    expect(new Set((await all(page, N.map((i) => `Texte${i}`))).map(([, y]) => y)).size).toBe(1);
    // une seule annulation : de nouveau Empilé, l'en-tête masqué ; Ctrl+Y le refait
    await cur(page).getByTestId('design-canvas').focus();
    await page.keyboard.press('Control+z');
    await expect(header.getByTestId('ctl-Étiquette1')).toHaveCount(0);
    await expect(handles(page)).toHaveCount(1);
    expect(await all(page, N.flatMap((i) => [`Texte${i}`, `Étiquette${i}`]))).toEqual(before);
    await page.keyboard.press('Control+y');
    await expect(header.getByTestId('ctl-Étiquette1')).toBeVisible();

    // Supprimer la disposition : plus de poignée, les contrôles restent où ils sont
    await ctl(page, 'Texte1').click();
    const kept = await all(page, N.flatMap((i) => [`Texte${i}`, `Étiquette${i}`]));
    await cmd(page, 'removeLayout');
    await expect(handles(page)).toHaveCount(0);
    expect(await all(page, N.flatMap((i) => [`Texte${i}`, `Étiquette${i}`]))).toEqual(kept);
  } finally {
    await app.close();
  }
});

test('Form view: a Stacked layout label names its control, focuses it on click, and hides with it', async () => {
  const d: DesignDoc = { ...form, sections: form.sections.map((s) => (s.kind !== 'detail' ? s
    : { ...s, controls: [field(1, 1500, 200), { ...field(2, 1700, 700), props: { Visible: false } }] })) };
  const base = seedBase('dispositions-formulaire', (db) => {
    createTable(db, t('Clients', clients.fields));
    seedForm(db, 'B', createLayout(d, membersOf(d, ['Texte1', 'Texte2']), 'stacked', { headerSection: 'formHeader' }));
  });
  const { app, page } = await launchApp({ args: [base], env: { BASECRAFT_REGION: 'fr-FR' } });
  try {
    await page.getByTestId('nav-item-form-B').dblclick();
    const run = page.getByTestId('form-run').filter({ visible: true });
    await expect(run).toBeVisible();
    const box = run.getByTestId('form-ctl-Texte1');
    await expect(box).toHaveAccessibleName('Champ 1:');
    await run.getByTestId('form-ctl-Étiquette1').click();
    await expect(box).toBeFocused();
    await expect(run.getByTestId('form-ctl-Étiquette2')).toHaveCount(0);   // its control is hidden
  } finally {
    await app.close();
  }
});
