// Lot L4 en mode Création : une cellule vide d'une disposition se voit (pointillés) et se sélectionne, seule ou avec un contrôle (Ctrl+clic).
import { test, expect, type Page } from '@playwright/test';
import { createTable } from '../../src/main/db/schema';
import type { ControlDef, DesignDoc } from '../../src/shared/design/model';
import { createLayout, insertCells, membersOf } from '../../src/shared/design/layout-edit';
import { clients, t } from '../../src/shared/test-fixtures';
import { launchApp, seedBase, seedForm } from './helpers';

const cur = (page: Page) => page.locator('.doc:not([hidden])');
const field = (i: number, top: number): ControlDef => ({ kind: 'textBox', name: `Texte${i}`, left: 1500, top, width: 2268, height: 340, props: {},
  children: [{ kind: 'label', name: `Étiquette${i}`, left: 100, top, width: 1200, height: 340, props: { Caption: `Champ ${i}:` } }] });
const form: DesignDoc = { formatVersion: '1.0', recordSource: { kind: 'table', name: 'Clients' }, props: {}, sections: [
  { kind: 'formHeader', height: 0, props: { Visible: false }, controls: [] },
  { kind: 'detail', height: 3000, props: {}, controls: [field(1, 200), field(2, 800)] },
  { kind: 'formFooter', height: 0, props: { Visible: false }, controls: [] }] };

test('Design view: an empty layout cell is visible and selectable', async () => {
  test.setTimeout(120000);
  const laid = insertCells(createLayout(form, membersOf(form, ['Texte1', 'Texte2']), 'stacked', { headerSection: 'formHeader' }), 'Texte1', 'right');
  const base = seedBase('dispositions-cellule-vide', (db) => {
    createTable(db, t('Clients', clients.fields));
    seedForm(db, 'A', laid);
  });
  const { app, page } = await launchApp({ args: [base], env: { BASECRAFT_REGION: 'fr-FR' } });
  try {
    await page.getByTestId('nav-item-form-A').click({ button: 'right' });
    await page.getByTestId('nav-menu-design').click();
    const cell = cur(page).getByTestId('cell-L1-0-2');
    await expect(cell).toBeVisible();
    await cell.click();
    await expect(cell).toHaveAttribute('aria-pressed', 'true');
    await cur(page).getByTestId('ctl-Texte2').click({ modifiers: ['Control'] });
    await expect(cell).toHaveAttribute('aria-pressed', 'true');
    await expect(cur(page).getByTestId('ctl-Texte2')).toHaveAttribute('aria-pressed', 'true');
  } finally {
    await app.close();
  }
});

test('Design view: merge a control with its empty neighbour, undo', async () => {
  test.setTimeout(120000);
  const laid = createLayout(form, membersOf(form, ['Texte1', 'Texte2']), 'stacked', { headerSection: 'formHeader' });
  const base = seedBase('dispositions-fusion', (db) => {
    createTable(db, t('Clients', clients.fields));
    seedForm(db, 'A', laid);
  });
  const { app, page } = await launchApp({ args: [base], env: { BASECRAFT_REGION: 'fr-FR' } });
  const width = async () => Math.round((await cur(page).getByTestId('ctl-Texte1').boundingBox())!.width);
  try {
    await page.getByTestId('nav-item-form-A').click({ button: 'right' });
    await page.getByTestId('nav-menu-design').click();
    await cur(page).getByTestId('ctl-Texte1').click();
    await page.getByTestId('ribbon-tab-arrange').click();
    await page.getByTestId('cmd-insertRight').click();
    const w0 = await width();
    await cur(page).getByTestId('ctl-Texte1').click();
    await cur(page).getByTestId('cell-L1-0-2').click({ modifiers: ['Control'] });
    await page.getByTestId('cmd-merge').click();
    await expect.poll(width).toBeGreaterThan(w0);
    await page.keyboard.press('Control+z');
    await expect.poll(width).toBe(w0);
  } finally {
    await app.close();
  }
});

test('Design view: Anchoring > Stretch Down and Across sets both anchors', async () => {
  test.setTimeout(120000);
  const laid = createLayout(form, membersOf(form, ['Texte1', 'Texte2']), 'stacked', { headerSection: 'formHeader' });
  const base = seedBase('dispositions-ancrage', (db) => {
    createTable(db, t('Clients', clients.fields));
    seedForm(db, 'A', laid);
  });
  const { app, page } = await launchApp({ args: [base], env: { BASECRAFT_REGION: 'fr-FR' } });
  try {
    await page.getByTestId('nav-item-form-A').click({ button: 'right' });
    await page.getByTestId('nav-menu-design').click();
    await cur(page).getByTestId('ctl-Texte1').click();
    await page.getByTestId('ribbon-tab-arrange').click();
    await page.getByTestId('cmd-anchoring').click();
    await page.getByTestId('layout-popup-anchoring-stretchAll').click();
    await page.getByTestId('sheet-tab-all').click();
    await expect(page.getByTestId('prop-HorizontalAnchor')).toHaveValue('both');
    await expect(page.getByTestId('prop-VerticalAnchor')).toHaveValue('both');
  } finally {
    await app.close();
  }
});

test('Design view: Control Padding Wide shifts the data column by 180 twips', async () => {
  test.setTimeout(120000);
  const laid = createLayout(form, membersOf(form, ['Texte1', 'Texte2']), 'stacked', { headerSection: 'formHeader' });
  const base = seedBase('dispositions-remplissage', (db) => {
    createTable(db, t('Clients', clients.fields));
    seedForm(db, 'A', laid);
  });
  const { app, page } = await launchApp({ args: [base], env: { BASECRAFT_REGION: 'fr-FR' } });
  const left = (n: string) => page.evaluate((x) => (window as unknown as { basecraft: { objects: { get(k: string, n: string): Promise<{ definition: DesignDoc }> } } })
    .basecraft.objects.get('form', 'A').then((r) => r.definition.sections.flatMap((s) => s.controls).find((c) => c.name === x)!.left), n);
  try {
    await page.getByTestId('nav-item-form-A').click({ button: 'right' });
    await page.getByTestId('nav-menu-design').click();
    const before = await left('Texte2');
    await cur(page).getByTestId('ctl-Texte1').click();
    await page.getByTestId('ribbon-tab-arrange').click();
    await page.getByTestId('cmd-controlPadding').click();
    await page.getByTestId('layout-popup-controlPadding-wide').click();
    await page.keyboard.press('Control+s');
    await expect.poll(() => left('Texte2')).toBe(before + 180);
  } finally {
    await app.close();
  }
});

test('Form view: a control anchored down and across takes the spare room and follows the window', async () => {
  test.setTimeout(120000);
  const d0 = createLayout(form, membersOf(form, ['Texte1', 'Texte2']), 'stacked', { headerSection: 'formHeader' });
  const laid: DesignDoc = { ...d0, sections: d0.sections.map((s) => ({ ...s, controls: s.controls.map((c) =>
    c.name === 'Texte1' ? { ...c, props: { ...c.props, HorizontalAnchor: 'both', VerticalAnchor: 'both' } } : c) })) };
  const base = seedBase('dispositions-ancrage', (db) => {
    createTable(db, t('Clients', clients.fields));
    seedForm(db, 'A', laid);
  });
  const { app, page } = await launchApp({ args: [base], env: { BASECRAFT_REGION: 'fr-FR' } });
  try {
    await page.getByTestId('nav-item-form-A').dblclick();
    const box = page.getByTestId('form-run').filter({ visible: true }).getByTestId('form-ctl-Texte1');
    await expect(box).toBeVisible();
    const size = async () => { const b = (await box.boundingBox())!; return { w: Math.round(b.width), h: Math.round(b.height) }; };
    const designW = Math.round(2268 / 15), designH = Math.round(340 / 15);
    await expect.poll(async () => (await size()).w).toBeGreaterThan(designW + 20);
    await expect.poll(async () => (await size()).h).toBeGreaterThan(designH + 20);
    const before = await size();
    const vp = page.viewportSize() ?? await page.evaluate(() => ({ width: window.innerWidth, height: window.innerHeight }));
    await page.setViewportSize({ width: vp.width + 400, height: vp.height });
    await expect.poll(async () => (await size()).w).toBeGreaterThan(before.w + 396);
    expect((await size()).w).toBeLessThan(before.w + 404);
  } finally {
    await app.close();
  }
});
