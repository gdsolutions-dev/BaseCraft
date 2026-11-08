// Formulaire en mode Formulaire (A4, tâche 8) : formulaire unique lié à une table — navigation, saisie, enregistrement, règle et
// boîte de message, Échap, calculé, Pg.Suiv, ordre de tabulation, nouvel enregistrement, suppression (cascade, refus), tri, filtres,
// thème, Maj+F9, F5, retour sur l'onglet, menu du volet (C6), fermeture, base en lecture seule, autres contrôles.
import { test, expect, type ElectronApplication, type Page, type TestInfo } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { saveObject } from '../../src/main/db/objects';
import { saveRelation } from '../../src/main/db/relations';
import { seedSales } from '../../src/main/query/test-db';
import { createTable } from '../../src/main/db/schema';
import { insertRow } from '../../src/main/db/write-layer';
import type { BasecraftApi } from '../../src/shared/api';
import type { ControlDef, DesignDoc } from '../../src/shared/design/model';
import type { TableDesign } from '../../src/shared/field-types';
import { localeInfo } from '../../src/shared/locale-format';
import type { RecordSourceRef } from '../../src/shared/record-source';
import { clients, f, t } from '../../src/shared/test-fixtures';
import { launchApp, seedBase, seedForm, pickView } from './helpers';

const fr = JSON.parse(readFileSync(join(__dirname, '../../src/shared/i18n/fr.json'), 'utf8'));
const FR = { BASECRAFT_REGION: 'fr-FR' };
const region = localeInfo('fr-FR');
const fill = (s: string, p: Record<string, string | number>) => s.replace(/\{\{(\w+)\}\}/g, (_, k: string) => String(p[k]));
const table = t('Clients', [...clients.fields, f('Ville', 'shortText', { validationRule: '<> "Zzz"', validationText: 'Ville interdite' })]);
const box = (kind: ControlDef['kind'], name: string, top: number, props: Record<string, unknown>, left = 1701): ControlDef =>
  ({ kind, name, left, top, width: 2268, height: 340, props });
const doc: DesignDoc = {
  formatVersion: '1.0', recordSource: { kind: 'table', name: 'Clients' }, props: { Width: 9072 },
  sections: [
    { kind: 'formHeader', height: 567, props: { Visible: true }, controls: [box('label', 'Titre', 100, { Caption: 'Clients', BackStyle: 'normal', BackColor: '#ffcc00' }, 100)] },
    { kind: 'detail', height: 3402, props: {}, controls: [
      { ...box('textBox', 'Nom', 100, { ControlSource: 'Nom', TabIndex: 0 }), children: [box('label', 'Nom_Étiquette', 100, { Caption: 'Nom:' }, 100)] },
      box('textBox', 'Ville', 600, { ControlSource: 'Ville', TabIndex: 1 }),
      { kind: 'checkBox', name: 'Actif', left: 1701, top: 1100, width: 284, height: 284, props: { ControlSource: 'Actif', TabIndex: 2 } },
      box('textBox', 'Salut', 1600, { ControlSource: '=[Nom] & "!"', TabStop: false }),
      box('textBox', 'Inconnu', 2100, { ControlSource: '=[Absent]', TabStop: false }),
      box('textBox', 'Note', 2600, { TabStop: false, ValidationRule: '<> "non"', ValidationText: 'Pas non' }),   // unbound, with a control rule
    ] },
    { kind: 'formFooter', height: 0, props: { Visible: false }, controls: [] },
  ],
};
/** A form of `name` on `table`, one text box per field (no AutoNumber). */
const formFor = (name: string, fields: string[]): DesignDoc => ({
  formatVersion: '1.0', recordSource: { kind: 'table', name }, props: { Width: 9072 },
  sections: [{ kind: 'formHeader', height: 0, props: { Visible: false }, controls: [] },
    { kind: 'detail', height: 2268, props: {}, controls: fields.map((n, i) => box('textBox', n, 100 + i * 500, { ControlSource: n, TabIndex: i })) },
    { kind: 'formFooter', height: 0, props: { Visible: false }, controls: [] }],
});
const bc = (page: Page) => ({
  rows: (name = 'Clients') => page.evaluate((n) => (window as unknown as { basecraft: BasecraftApi }).basecraft.rows.page(n, { offset: 0, limit: 20 })
    .then((p) => p.rows.map((r) => r.values)), name),
  insert: (Nom: string) => page.evaluate((n) => (window as unknown as { basecraft: BasecraftApi }).basecraft.rows.insert('Clients', { Nom: n }), Nom),
  drop: () => page.evaluate(() => (window as unknown as { basecraft: BasecraftApi }).basecraft.tables.drop('Clients')),
});
const menuLayout = (page: Page) => page.getByTestId('nav-menu').evaluate((m) =>
  [...m.children].map((e) => (e.getAttribute('role') === 'separator' ? '|' : (e.querySelector('[role="menuitem"]') ?? e).getAttribute('data-testid')!.replace('nav-menu-', ''))));
const bg = (page: Page, name: string) => page.getByTestId(`form-ctl-${name}`).evaluate((e) => getComputedStyle(e).backgroundColor);

async function options(page: Page, id: 'opt-theme' | 'opt-lang', value: string) {
  await page.getByTestId('ribbon-tab-file').click();
  await page.getByTestId('bs-options').click();
  await page.getByTestId(id).selectOption(value);
  await page.getByTestId('bs-back').click();
}
const seedClients = (name: string, more?: (db: DatabaseSync) => Promise<void> | void) => seedBase(name, async (db) => {
  createTable(db, table);
  for (const [Nom, Ville, Actif] of [['Dupont', 'Lyon', true], ['Durand', 'Paris', false], ['Martin', 'Marseille', true]] as const) await insertRow(db, table, { Nom, Ville, Actif }, region);
  seedForm(db, 'Clients', doc);
  await more?.(db);
});

/** Opens the form Clients (Home ribbon tab); `run` gets the page and its locators. */
async function withForm(base: string, run: (p: ReturnType<typeof locators>, app: ElectronApplication) => Promise<void>, form = 'Clients') {
  const { app, page } = await launchApp({ args: [base], env: FR });
  try {
    await page.getByTestId(`nav-item-form-${form}`).dblclick();
    await expect(page.getByTestId('form-run')).toBeVisible();
    await page.getByTestId('ribbon-tab-home').click();
    await run(locators(page), app);
  } finally {
    await app.close();
  }
}
/** Locators in the tab shown (another open tab keeps its view mounted, hidden). */
function locators(page: Page) {
  const shown = (id: string) => page.getByTestId(id).filter({ visible: true });
  const run = shown('form-run');
  return {
    page, input: shown('nav-record-input'), count: shown('nav-record-count'), dirty: shown('form-dirty'),
    ctl: (n: string) => shown(`form-ctl-${n}`),
    next: run.getByRole('button', { name: fr.datasheet.nav.next }), prev: run.getByRole('button', { name: fr.datasheet.nav.prev }),
  };
}

test('navigate, edit and save; a refused save: message box, error under the control, focus; Escape twice; calculated control; Page Down/Up', async () => {
  await withForm(await seedClients('fx-saisie'), async ({ page, input, count, dirty, ctl, next, prev }) => {
    await expect(page.getByTestId('doc-tab-form-Clients')).toBeVisible();
    await expect(input).toHaveValue('1');
    await expect(count).toHaveText('3');
    await expect(ctl('Nom')).toHaveValue('Dupont');
    await expect(ctl('Salut')).toHaveValue('Dupont!');
    await expect(page.locator('label[for]', { hasText: 'Nom:' })).toHaveAttribute('for', (await ctl('Nom').getAttribute('id'))!);
    await expect(ctl('Ville')).toHaveAccessibleName('Ville');   // no attached label: its name

    await ctl('Nom').fill('Dupond');
    await expect(dirty).toBeVisible();
    await next.click();
    await expect(input).toHaveValue('2');
    await expect(dirty).toHaveCount(0);
    expect((await bc(page).rows())[0]![1]).toBe('Dupond');

    // the field's rule refuses: Access's message box, then the message under Ville and the focus on it; the record stays
    await prev.click();
    await ctl('Ville').fill('Zzz');
    await next.click();
    await expect(page.getByTestId('modal')).toContainText(fill(fr.datasheet.fieldError, { field: 'Ville', message: 'Ville interdite' }));
    await page.getByTestId('modal-btn-ok').click();
    await expect(page.getByTestId('form-error-Ville')).toHaveText('Ville interdite');
    await expect(page.getByTestId('form-error-Ville')).toHaveAttribute('role', 'alert');
    await expect(ctl('Ville')).toHaveAttribute('aria-invalid', 'true');
    await expect(input).toHaveValue('1');
    await expect(ctl('Ville')).toBeFocused();
    await page.keyboard.press('Escape');
    await page.keyboard.press('Escape');
    await expect(ctl('Ville')).toHaveValue('Lyon');
    await expect(dirty).toHaveCount(0);
    await expect(page.getByTestId('form-error-Ville')).toHaveCount(0);

    // the calculated control follows Nom once Nom is left; Escape in Ville (nothing typed there): the whole record
    await ctl('Nom').fill('Essai');
    await page.keyboard.press('Tab');
    await expect(ctl('Ville')).toBeFocused();
    await expect(ctl('Salut')).toHaveValue('Essai!');
    await page.keyboard.press('Escape');
    await expect(ctl('Nom')).toHaveValue('Dupond');
    await expect(ctl('Salut')).toHaveValue('Dupond!');

    // Page Down / Page Up: next and previous record, the focus staying in the control
    await ctl('Nom').click();
    await page.keyboard.press('PageDown');
    await expect(input).toHaveValue('2');
    await expect(ctl('Nom')).toHaveValue('Durand');
    await expect(ctl('Nom')).toBeFocused();
    await page.keyboard.press('PageUp');
    await expect(input).toHaveValue('1');

    // a control rule that fails when the control is left: its box, and the focus stays in the control, each time it is left,
    // until the entry is fixed or undone; Escape gives back its value
    const pasNon = fill(fr.datasheet.fieldError, { field: 'Note', message: 'Pas non' });
    await ctl('Note').fill('non');
    await ctl('Nom').click();
    await expect(page.getByTestId('modal')).toContainText(pasNon);
    await page.getByTestId('modal-btn-ok').click();
    await expect(ctl('Note')).toBeFocused();
    await expect(page.getByTestId('form-error-Note')).toHaveText('Pas non');
    await ctl('Nom').click();
    await expect(page.getByTestId('modal')).toContainText(pasNon);
    // CI-only failure (Nom read Dupond after its fill below): focus moves, inputs and Escapes from here on, shown if it fails again
    await page.evaluate(() => {
      const w = window as unknown as { __trace: string[] };
      const t0 = performance.now();
      w.__trace = [];
      const name = (e: Event) => (e.target as Element | null)?.closest?.('[data-ctl], [data-testid]')?.getAttribute('data-ctl')
        ?? (e.target as Element | null)?.closest?.('[data-testid]')?.getAttribute('data-testid') ?? (e.target as Element | null)?.tagName;
      for (const type of ['focusin', 'input', 'keydown'])
        document.addEventListener(type, (e) => {
          if (type === 'keydown' && (e as KeyboardEvent).key !== 'Escape') return;
          w.__trace.push(`${Math.round(performance.now() - t0)}ms ${type} ${name(e)} ${(e.target as HTMLInputElement).value ?? ''}`);
        }, true);
    });
    const trace = () => page.evaluate(() => (window as unknown as { __trace: string[] }).__trace.join('\n'));
    await page.getByTestId('modal-btn-ok').click();
    await expect(ctl('Note')).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(ctl('Note')).toHaveValue('');
    await expect(page.getByTestId('form-error-Note')).toHaveCount(0);

    // an unbound control's error is the form's, not the record's: the record is still saved (Page Down from the control)
    await ctl('Nom').fill('Dupont');
    if ((await ctl('Nom').inputValue()) !== 'Dupont') throw new Error(`Nom lost Dupont at its fill:\n${await trace()}`);
    await ctl('Note').fill('non');
    // a CI-only failure read Dupond here (the typing lost, not the save): the trace says where it went
    if ((await ctl('Nom').inputValue()) !== 'Dupont') throw new Error(`Nom lost Dupont after Note's fill:\n${await trace()}`);
    await expect(ctl('Note')).toBeFocused();
    await page.keyboard.press('PageDown');
    await expect(input).toHaveValue('2');
    expect((await bc(page).rows())[0]![1]).toBe('Dupont');
    await expect(page.getByTestId('form-error-Note')).toHaveText('Pas non');
    await expect(ctl('Note')).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('form-error-Note')).toHaveCount(0);
  });
});

test('Tab: Nom -> Ville -> Actif, then the next record; new record with Shift+Enter; delete asks first (No by default)', async () => {
  await withForm(await seedClients('fx-tab'), async ({ page, input, count, dirty, ctl }) => {
    await ctl('Nom').click();
    await page.keyboard.press('Tab');
    await expect(ctl('Ville')).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(ctl('Actif')).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(input).toHaveValue('2');
    await expect(ctl('Nom')).toBeFocused();
    await expect(ctl('Nom')).toHaveValue('Durand');
    await page.keyboard.press('Shift+Tab');   // back over the first stop: the previous record's last one
    await expect(input).toHaveValue('1');
    await expect(ctl('Actif')).toBeFocused();

    await page.getByTestId('cmd-newRecord').click();
    await expect(input).toHaveValue('4');
    await expect(ctl('Nom')).toBeFocused();
    await page.keyboard.type('Zoé');
    await page.keyboard.press('Shift+Enter');
    await expect(count).toHaveText('4');
    await expect(dirty).toHaveCount(0);
    await page.getByTestId('cmd-deleteRecord').click();
    await expect(page.getByTestId('modal')).toContainText(fr.datasheet.delete_one);
    await expect(page.getByTestId('modal-btn-no')).toBeFocused();
    await page.getByTestId('modal-btn-no').click();
    await expect(count).toHaveText('4');
    await expect(ctl('Nom')).toBeFocused();   // back to the form
    await page.getByTestId('cmd-deleteRecord').click();
    await page.getByTestId('modal-btn-yes').click();
    await expect(count).toHaveText('3');
    await expect(ctl('Nom')).toBeFocused();
    expect((await bc(page).rows()).map((r) => r[1])).toEqual(['Dupont', 'Durand', 'Martin']);
  });
});

test('type-ahead: what is typed right after New Record or Page Down, while the record left is saved, replaces the field on the record reached; dropped and said when the move is refused', async () => {
  await withForm(await seedClients('fx-frappe'), async ({ page, input, ctl }, app) => {
    // the record left is saved slowly (its write held 400 ms in the main process): the keys come while the move is under way
    const slowUpdates = (on: boolean) => app.evaluate(({ ipcMain }, slow) => {
      const handlers = (ipcMain as unknown as { _invokeHandlers: Map<string, (...a: unknown[]) => unknown> })._invokeHandlers;
      const g = globalThis as unknown as { realUpdate?: (...a: unknown[]) => unknown };
      g.realUpdate ??= handlers.get('bc:rows:update');
      const real = g.realUpdate!;
      handlers.set('bc:rows:update', slow ? async (...a: unknown[]) => { await new Promise((r) => setTimeout(r, 400)); return real(...a); } : real);
    }, on);
    const add = page.getByTestId('form-run').filter({ visible: true }).getByTestId('nav-new');
    await ctl('Ville').fill('Lille');
    await slowUpdates(true);
    await add.click();
    await page.keyboard.type('Zola');   // keys (Playwright types é without a key press); no wait: the record left is still being saved
    await expect(ctl('Nom')).toHaveValue('Zola');
    await expect(ctl('Nom')).toBeFocused();
    await slowUpdates(false);
    await page.keyboard.press('Shift+Enter');
    await expect.poll(async () => (await bc(page).rows()).map((r) => [r[1], r[6]])).toEqual([['Dupont', 'Lille'], ['Durand', 'Paris'], ['Martin', 'Marseille'], ['Zola', null]]);

    // Page Down in Nom: the keys replace the next record's Nom (Access selects the whole field on entering it)
    await page.getByTestId('form-run').filter({ visible: true }).getByRole('button', { name: fr.datasheet.nav.first }).click();
    await ctl('Nom').click();
    await ctl('Nom').fill('Dupond');
    await slowUpdates(true);
    await page.keyboard.press('PageDown');
    await page.keyboard.type('X');
    await expect(input).toHaveValue('2');
    await expect(ctl('Nom')).toHaveValue('X');
    await slowUpdates(false);
    await page.keyboard.press('Shift+Enter');
    await expect.poll(async () => (await bc(page).rows()).map((r) => r[1])).toEqual(['Dupond', 'X', 'Martin', 'Zola']);

    // the record left cannot be saved: the move does not happen, the keys are dropped, said in the status bar
    await ctl('Ville').fill('Zzz');
    await slowUpdates(true);
    await add.click();
    await page.keyboard.type('ab');
    await expect(page.getByTestId('modal')).toContainText('Ville interdite');
    await expect(page.getByTestId('status-message')).toHaveText(fr.form.typeAheadDropped);
    await page.getByTestId('modal-btn-ok').click();
    await expect(ctl('Ville')).toHaveValue('Zzz');
    await expect(ctl('Nom')).toHaveValue('X');
    await slowUpdates(false);
  });
});

test('delete: the real keys word the question (cascade) and refuse a parent with related records', async () => {
  const commandes = t('Commandes', [f('N°', 'autoNumber'), f('Client', 'number', { numberSize: 'longInteger' })]);
  const fournisseurs = t('Fournisseurs', [f('N°', 'autoNumber'), f('Nom', 'shortText')]);
  const produits = t('Produits', [f('N°', 'autoNumber'), f('Fournisseur', 'number', { numberSize: 'longInteger' })]);
  const rel = (parentTable: string, childTable: string, childField: string, cascadeDelete: boolean) => ({ name: '', parentTable, parentFields: ['N°'], childTable,
    childFields: [childField], enforce: true, cascadeUpdate: false, cascadeDelete, joinType: 1 as const });
  const base = await seedClients('fx-cascade', async (db) => {
    for (const d of [commandes, fournisseurs, produits] as TableDesign[]) createTable(db, d);
    await insertRow(db, commandes, { Client: 1 }, region);
    await insertRow(db, fournisseurs, { Nom: 'Acme' }, region);
    await insertRow(db, produits, { Fournisseur: 1 }, region);
    saveRelation(db, rel('Clients', 'Commandes', 'Client', true), null, region);
    saveRelation(db, rel('Fournisseurs', 'Produits', 'Fournisseur', false), null, region);
    seedForm(db, 'Fournisseurs', formFor('Fournisseurs', ['Nom']));
  });
  await withForm(base, async ({ page, count, ctl }) => {
    await page.getByTestId('cmd-deleteRecord').click();
    await expect(page.getByTestId('modal')).toContainText(fr.datasheet.deleteCascade_one);
    await page.getByTestId('modal-btn-yes').click();
    await expect(count).toHaveText('2');
    expect(await bc(page).rows('Commandes')).toEqual([]);

    await page.getByTestId('nav-item-form-Fournisseurs').dblclick();
    await expect(ctl('Nom')).toHaveValue('Acme');
    await page.getByTestId('cmd-deleteRecord').click();
    await expect(page.getByTestId('modal')).toContainText(fr.datasheet.delete_one);
    await page.getByTestId('modal-btn-yes').click();
    await expect(page.getByTestId('modal')).toContainText(fill(fr.datasheet.related, { table: 'Produits' }));
    await page.getByTestId('modal-btn-ok').click();
    await expect(ctl('Nom')).toBeFocused();
    await expect(ctl('Nom')).toHaveValue('Acme');
  });
});

test('sort and filters on the focused control: descending, by selection, toggle, clear, Filter in the builder', async () => {
  await withForm(await seedClients('fx-filtres'), async ({ page, input, count, ctl }) => {
    await ctl('Ville').click();
    await page.getByTestId('cmd-sortDesc').click();
    await expect(input).toHaveValue('1');
    await expect(ctl('Ville')).toHaveValue('Paris');
    await page.getByTestId('cmd-filterSelection').click();
    await page.getByTestId('filter-menu-equals').click();
    await expect(count).toHaveText('1');
    await expect(page.getByTestId('nav-filtered')).toHaveAttribute('aria-pressed', 'true');
    await page.getByTestId('cmd-filterToggle').click();
    await expect(count).toHaveText('3');
    await expect(input).toHaveValue('1');
    await expect(page.getByTestId('nav-filtered')).toHaveAttribute('aria-pressed', 'false');
    await page.getByTestId('cmd-filterAdvanced').click();
    await page.getByTestId('filter-menu-clear').click();
    await expect(page.getByTestId('nav-filtered')).toBeDisabled();
    await ctl('Ville').click();
    await page.getByTestId('cmd-filter').click();
    await page.getByTestId('filter-typed').click(); // O2 R14: Home › Filter opens the column menu; its typed filters, the Expression Builder
    await page.getByTestId('xb-text').fill('"Lyon"');
    await page.getByTestId('xb-ok').click();
    await expect(count).toHaveText('1');
    await expect(ctl('Ville')).toHaveValue('Lyon');
    await page.getByTestId('cmd-filterAdvanced').click();
    await page.getByTestId('filter-menu-clear').click();
    await expect(count).toHaveText('3');
  });
});

test('theme switch keeps the entry; Shift+F9; back on the tab the records are read again in place; F5 here and in Design view', async () => {
  await withForm(await seedClients('fx-touches'), async ({ page, input, count, dirty, ctl, next }) => {
    await options(page, 'opt-theme', 'light');
    const [surface, yellow] = [await bg(page, 'Nom'), await bg(page, 'Titre')];
    await ctl('Nom').fill('En cours');
    await options(page, 'opt-theme', 'dark');
    await expect.poll(() => bg(page, 'Nom')).not.toBe(surface);
    expect(await bg(page, 'Titre')).toBe(yellow);
    await expect(ctl('Nom')).toHaveValue('En cours');
    await ctl('Nom').click();
    await page.keyboard.press('Escape');
    await page.keyboard.press('Escape');
    await expect(dirty).toHaveCount(0);

    expect(await bc(page).insert('Nouveau')).toMatchObject({ ok: true });
    await page.keyboard.press('Shift+F9');
    await expect(count).toHaveText('4');

    // another tab meanwhile, a row added: back on the form, it counts it, on the same record, nothing saved
    await next.click();
    await expect(input).toHaveValue('2');
    await page.getByTestId('nav-item-Clients').dblclick();
    await expect(page.getByTestId('doc-tab-Clients')).toBeVisible();
    expect(await bc(page).insert('Encore')).toMatchObject({ ok: true });
    await page.getByTestId('doc-tab-form-Clients').click();
    await expect(count).toHaveText('5');
    await expect(input).toHaveValue('2');
    await expect(ctl('Nom')).toHaveValue('Durand');

    await ctl('Nom').click();
    await page.keyboard.press('F5');
    await expect(input).toBeFocused();
    expect(await input.evaluate((e: HTMLInputElement) => [e.selectionStart, e.selectionEnd])).toEqual([0, 1]);
    await page.keyboard.type('3');
    await page.keyboard.press('Enter');
    await expect(input).toHaveValue('3');

    // Design view with a valid entry: saved first, no question (Access)
    await ctl('Nom').fill('Avant Création');
    await pickView(page, 'viewDesign');
    await expect(page.getByTestId('form-design')).toBeVisible();
    await expect(page.getByTestId('modal')).toHaveCount(0);
    expect((await bc(page).rows())[2]![1]).toBe('Avant Création');
    await page.keyboard.press('F5');
    await expect(page.getByTestId('form-run')).toBeVisible();
  });
});

test('C6 Open; closing saves a valid entry, asks for an invalid one (close anyway?); English #Name?; a deleted table', async () => {
  await withForm(await seedClients('fx-fermer'), async ({ page, ctl }) => {
    await page.getByTestId('nav-item-form-Clients').click({ button: 'right' });
    expect(await menuLayout(page)).toEqual(['open', 'layout', 'design', '|', 'export', '|', 'rename', 'hide', 'delete', '|', 'cut', 'copy', 'paste', '|', 'properties']);
    await expect(page.getByTestId('nav-menu-open')).toBeEnabled();
    await page.keyboard.press('Escape');

    // a valid entry: saved on close, no question
    await ctl('Nom').fill('Sauvé');
    await page.getByTestId('doc-tab-close-form-Clients').click();
    await expect(page.getByTestId('doc-tab-form-Clients')).toHaveCount(0);
    await expect(page.getByTestId('modal')).toHaveCount(0);
    expect((await bc(page).rows())[0]![1]).toBe('Sauvé');

    await page.getByTestId('nav-item-form-Clients').click({ button: 'right' });
    await page.getByTestId('nav-menu-open').click();
    await expect(page.getByTestId('doc-tab-form-Clients')).toBeVisible();
    await expect(page.getByTestId('form-run')).toBeVisible();

    // an invalid entry: the refusal's box, then close anyway? (Yes/No, No by default); No stays, Yes closes and discards
    await ctl('Ville').fill('Zzz');
    await page.getByTestId('doc-tab-close-form-Clients').click();
    await page.getByTestId('modal-btn-ok').click();
    await expect(page.getByTestId('modal')).toContainText(fill(fr.form.closeDiscard, { name: 'Clients' }));
    await expect(page.getByTestId('modal-btn-cancel')).toHaveCount(0);
    await expect(page.getByTestId('modal-btn-no')).toBeFocused();
    await page.getByTestId('modal-btn-no').click();
    await expect(page.getByTestId('doc-tab-form-Clients')).toBeVisible();
    await expect(ctl('Ville')).toHaveValue('Zzz');
    await expect(page.getByTestId('form-error-Ville')).toBeVisible();
    await page.getByTestId('doc-tab-close-form-Clients').click();
    await page.getByTestId('modal-btn-ok').click();
    await page.getByTestId('modal-btn-yes').click();
    await expect(page.getByTestId('doc-tab-form-Clients')).toHaveCount(0);
    expect((await bc(page).rows())[0]![6]).toBe('Lyon');

    // English interface: #Name? for a calculated control naming an unknown field
    await options(page, 'opt-lang', 'en');
    await page.getByTestId('nav-item-form-Clients').dblclick();
    await expect(ctl('Inconnu')).toHaveValue('#Name?');
    await page.getByTestId('doc-tab-close-form-Clients').click();

    // a deleted table: a message in the form's place, the tab closes
    expect(await bc(page).drop()).toMatchObject({ ok: true });
    await page.getByTestId('nav-item-form-Clients').dblclick();
    await expect(page.getByTestId('form-run-error')).toBeVisible();
    await page.getByTestId('doc-tab-close-form-Clients').click();
    await expect(page.getByTestId('doc-tab-form-Clients')).toHaveCount(0);
  });
});

test('read-only base: bound controls cannot change, no new record; an unbound control still takes an entry', async () => {
  const base = await seedClients('fx-lecture');
  const a = await launchApp({ args: [base], env: FR });
  try {
    await withForm(base, async ({ page, dirty, ctl }) => {
      await expect(page.getByTestId('banner-readonly')).toBeVisible();
      await expect(ctl('Nom')).toHaveAttribute('readonly', '');
      await ctl('Nom').click();
      await page.keyboard.type('x');
      await expect(ctl('Nom')).toHaveValue('Dupont');
      await expect(dirty).toHaveCount(0);
      await expect(page.getByTestId('cmd-newRecord')).toBeDisabled();
      await expect(page.getByTestId('cmd-deleteRecord')).toBeDisabled();
      await expect(page.getByTestId('nav-new')).toBeDisabled();
      await ctl('Note').fill('libre');
      await expect(ctl('Note')).toHaveValue('libre');
    });
  } finally {
    await a.app.close();
  }
});

test('other controls: option group (arrows), tab pages by mouse and keyboard, image, line, empty subform, button, defaults, unbound into a calculated control; unreadable definition', async ({}, testInfo: TestInfo) => {
  const fiche = t('Fiche', [f('N°', 'autoNumber'), f('Nom', 'shortText'), f('Choix', 'number', { numberSize: 'longInteger' })]);
  const opt = (name: string, value: number, top: number): ControlDef => ({ kind: 'optionButton', name, left: 400, top, width: 284, height: 284, props: { OptionValue: value } });
  const form: DesignDoc = {
    formatVersion: '1.0', recordSource: { kind: 'table', name: 'Fiche' }, props: { Width: 9072 },
    sections: [
      { kind: 'formHeader', height: 0, props: { Visible: false }, controls: [] },
      { kind: 'detail', height: 5103, props: {}, controls: [
        box('textBox', 'Nom', 100, { ControlSource: 'Nom', TabIndex: 0, DefaultValue: '"Anonyme"', ControlTipText: 'Nom du client' }),
        { kind: 'optionGroup', name: 'G', left: 200, top: 600, width: 2268, height: 1000, props: { ControlSource: 'Choix', Caption: 'Choix', TabIndex: 1 },
          children: [opt('A', 1, 800), { ...opt('B', 2, 1200), children: [box('label', 'B_Étiquette', 1200, { Caption: 'Deuxième' }, 800)] }] },
        { kind: 'tabControl', name: 'Onglets', left: 3000, top: 600, width: 3402, height: 1400, props: { Pages: ['Un', 'Deux'] },
          children: [box('label', 'SurUn', 1000, { Caption: 'Page un' }, 3200), box('textBox', 'Remarque', 1450, {}, 3200),
            box('label', 'SurDeux', 1000, { Caption: 'Page deux', PageIndex: 1 }, 3200), box('textBox', 'Code', 1450, { PageIndex: 1 }, 3200)] },
        { kind: 'image', name: 'Logo', left: 200, top: 1800, width: 567, height: 567, props: { ControlTipText: 'Logo de la société' } },
        { kind: 'line', name: 'Trait', left: 200, top: 2500, width: 2268, height: 567, props: { LineSlant: true } },
        box('subform', 'Liste', 3200, {}),
        box('commandButton', 'OK', 3700, { Caption: 'Valider' }),
        box('textBox', 'Remise', 4200, { DefaultValue: '2', TabStop: false }),
        box('textBox', 'Total', 4700, { ControlSource: '=[Remise] * 10', TabStop: false }),
      ] },
      { kind: 'formFooter', height: 0, props: { Visible: false }, controls: [] },
    ],
  };
  const base = await seedBase('fx-controles', async (db) => {
    createTable(db, fiche);
    await insertRow(db, fiche, { Nom: 'Dupont', Choix: 2 }, region);
    seedForm(db, 'Fiche', form);
    seedForm(db, 'Abîmé', { formatVersion: '1.0', sections: 'illisible' } as unknown as DesignDoc);
  });
  await withForm(base, async ({ page, input, dirty, ctl }) => {
    await expect(ctl('Nom')).toHaveValue('Dupont');
    await expect(ctl('Nom')).toHaveAttribute('title', 'Nom du client');

    // option group: a radiogroup named by its caption; click, arrows, Escape
    await expect(page.getByRole('radiogroup', { name: 'Choix' })).toBeVisible();
    await expect(ctl('B')).toHaveAttribute('aria-checked', 'true');
    await expect(page.getByRole('radio', { name: 'Deuxième' })).toHaveAttribute('aria-checked', 'true');
    await expect(page.getByRole('radio', { name: 'A' })).toHaveAttribute('aria-checked', 'false');   // no label: its name
    await ctl('A').click();
    await expect(ctl('A')).toHaveAttribute('aria-checked', 'true');
    await expect(dirty).toBeVisible();
    await page.keyboard.press('ArrowDown');
    await expect(ctl('B')).toHaveAttribute('aria-checked', 'true');
    await expect(ctl('B')).toBeFocused();
    await page.keyboard.press('ArrowDown');
    await expect(ctl('A')).toHaveAttribute('aria-checked', 'true');
    await page.keyboard.press('Escape');
    await expect(ctl('B')).toHaveAttribute('aria-checked', 'true');
    await expect(dirty).toHaveCount(0);

    // Tab: Nom -> the group (its chosen option) -> the tab strip -> the controls of the page shown; arrows change the page
    const run = page.getByTestId('form-run');
    await ctl('Nom').click();
    await page.keyboard.press('Tab');
    await expect(ctl('B')).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(run.getByRole('tab', { name: 'Un' })).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(ctl('Remarque')).toBeFocused();
    await page.keyboard.press('Shift+Tab');
    await expect(run.getByRole('tab', { name: 'Un' })).toBeFocused();
    await page.keyboard.press('ArrowRight');
    await expect(run.getByRole('tab', { name: 'Deux' })).toHaveAttribute('aria-selected', 'true');
    await expect(ctl('SurDeux')).toBeVisible();
    await expect(ctl('SurUn')).toHaveCount(0);
    await page.keyboard.press('Home');   // the first page, then the last (APG tabs)
    await expect(run.getByRole('tab', { name: 'Un' })).toBeFocused();
    await expect(run.getByRole('tab', { name: 'Un' })).toHaveAttribute('aria-selected', 'true');
    await page.keyboard.press('End');
    await expect(run.getByRole('tab', { name: 'Deux' })).toBeFocused();
    await expect(ctl('SurDeux')).toBeVisible();
    await page.keyboard.press('Tab');
    await expect(ctl('Code')).toBeFocused();
    await run.getByRole('tab', { name: 'Un' }).click();
    await expect(ctl('SurUn')).toBeVisible();
    // Escape on the strip leaves the record's entry as it is
    await ctl('Nom').fill('Changé');
    await run.getByRole('tab', { name: 'Un' }).focus();
    await page.keyboard.press('Escape');
    await expect(dirty).toBeVisible();
    await expect(ctl('Nom')).toHaveValue('Changé');
    await ctl('Nom').click();
    await page.keyboard.press('Escape');
    await expect(dirty).toHaveCount(0);

    // image, line, a subform with no Source Object (an empty frame, as Access), a button with no effect
    await expect(page.getByRole('img', { name: 'Logo de la société' })).toBeVisible();
    await expect(ctl('Trait').locator('line')).toHaveAttribute('x1', '1');
    await expect(page.getByRole('group', { name: 'Liste' })).toHaveText('');
    await expect(ctl('Liste').getByTestId('form-subform-error')).toHaveCount(0);
    await ctl('OK').click();
    await expect(dirty).toHaveCount(0);

    // an unbound text box: its Default Value, an entry that feeds the calculated control, kept on another record
    await expect(ctl('Remise')).toHaveValue('2');
    await expect(ctl('Total')).toHaveValue('20');
    await ctl('Remise').fill('3');
    await ctl('Nom').click();
    await expect(ctl('Total')).toHaveValue('30');
    await expect(dirty).toHaveCount(0);   // not a change of the record

    // new record: the control's default value at once; the unbound value stays
    await page.getByTestId('cmd-newRecord').click();
    await expect(input).toHaveValue('2');
    await expect(ctl('Nom')).toHaveValue('Anonyme');
    await expect(ctl('Remise')).toHaveValue('3');
    await expect(dirty).toHaveCount(0);
    await page.screenshot({ path: testInfo.outputPath('form-run-light.png') });
    await options(page, 'opt-theme', 'dark');
    await page.screenshot({ path: testInfo.outputPath('form-run-dark.png') });

    // an unreadable definition: a message, never a crash; the tab closes
    await page.getByTestId('nav-item-form-Abîmé').dblclick();
    await expect(page.getByTestId('form-run-error')).toHaveText(fr.form.invalidDefinition);
    await page.getByTestId('doc-tab-close-form-Abîmé').click();
    await expect(page.getByTestId('doc-tab-form-Abîmé')).toHaveCount(0);
  }, 'Fiche');
});

/** A form on `ref`, one text box per field. */
const formOn = (ref: RecordSourceRef, fields: string[]): DesignDoc => ({ ...formFor('', fields), recordSource: ref });

test('query sources (A3, B4 R7): a single-table query with an alias writes its table, so does a one-to-many join; a Totals query, a cross product and a Union query are read-only, said in the navigation bar', async () => {
  const base = seedBase('fx-requetes', (db) => {
    seedSales(db);
    for (const [q, sql] of [['QNoms', 'SELECT [N°], Nom AS Client, Ville FROM Clients;'], ['QTotaux', 'SELECT Client, Sum(Montant) AS Total FROM Commandes GROUP BY Client;'],
      ['QVentes', 'SELECT Clients.Nom, Commandes.Montant FROM Clients INNER JOIN Commandes ON Clients.[N°] = Commandes.Client;'],
      ['QVentesVirgule', 'SELECT Clients.Nom, Commandes.Montant, Commandes.Le FROM Clients, Commandes WHERE Clients.[N°] = Commandes.Client;'],
      ['QUnion', 'SELECT Nom, Ville FROM Clients UNION SELECT Nom, Ville FROM Clients;']]) {
      const r = saveObject(db, 'query', q!, { formatVersion: '1.0', sql }, null);
      if (!r.ok) throw new Error(r.reason);
    }
    seedForm(db, 'FNoms', formOn({ kind: 'query', name: 'QNoms' }, ['Client', 'Ville']));
    seedForm(db, 'FTotaux', formOn({ kind: 'query', name: 'QTotaux' }, ['Client', 'Total']));
    seedForm(db, 'FVentes', formOn({ kind: 'sql', sql: 'SELECT * FROM QVentesVirgule' }, ['Nom', 'Montant']));
    seedForm(db, 'FJointure', formOn({ kind: 'query', name: 'QVentes' }, ['Nom', 'Montant']));
    seedForm(db, 'FUnion', formOn({ kind: 'query', name: 'QUnion' }, ['Nom', 'Ville']));
  });
  const { app, page } = await launchApp({ args: [base], env: FR });
  const { ctl, dirty } = locators(page);
  const note = page.getByTestId('nav-readonly').filter({ visible: true });
  const open = async (form: string) => {
    await page.getByTestId(`nav-item-form-${form}`).dblclick();
    await expect(page.getByTestId(`doc-tab-form-${form}`)).toHaveAttribute('aria-selected', 'true');
  };
  try {
    await open('FNoms');
    await expect(ctl('Client')).toHaveValue('Dupont');
    await expect(note).toHaveCount(0);
    await ctl('Client').fill('Dupond');
    await page.keyboard.press('Shift+Enter');
    await expect(dirty).toHaveCount(0);
    expect((await bc(page).rows())[0]).toEqual([1, 'Dupond', 'Lyon']);

    // R7: the one-to-many join is updatable now: no note, a new record, its controls editable
    await open('FJointure');
    await expect(ctl('Nom')).toHaveValue('Dupond');
    await expect(note).toHaveCount(0);
    await expect(page.getByTestId('nav-new').filter({ visible: true })).toBeEnabled();
    for (const n of ['Nom', 'Montant']) await expect(ctl(n)).not.toHaveAttribute('readonly', '');

    for (const [form, fields] of [['FTotaux', ['Client', 'Total']], ['FVentes', ['Nom', 'Montant']], ['FUnion', ['Nom', 'Ville']]] as const) {
      await open(form);
      await expect(note).toHaveText(fr.form.readOnlySource);
      await expect(page.getByTestId('nav-new').filter({ visible: true })).toBeDisabled();
      for (const n of fields) await expect(ctl(n)).toHaveAttribute('readonly', '');
      const before = await ctl(fields[0]).inputValue();
      await ctl(fields[0]).click();
      await page.keyboard.type('9');
      await expect(ctl(fields[0])).toHaveValue(before);
      await expect(dirty).toHaveCount(0);
    }
  } finally {
    await app.close();
  }
});

test('a formatted box (Currency) entered by Tab has its whole edit text selected: what is typed replaces it; a click keeps the caret', async () => {
  const base = seedBase('fx-currency', (db) => { seedSales(db); seedForm(db, 'Commandes', formFor('Commandes', ['Client', 'Montant'])); });
  await withForm(base, async ({ page, ctl, dirty }) => {
    const selection = () => ctl('Montant').evaluate((e: HTMLInputElement) => [e.selectionStart, e.selectionEnd, e.value.length]);
    await expect(ctl('Montant')).not.toHaveValue('10,1');   // the formatted display text
    await ctl('Client').click();
    await page.keyboard.press('Tab');
    await expect(ctl('Montant')).toBeFocused();
    await expect(ctl('Montant')).toHaveValue('10,1');   // the edit text, all of it selected (Access: Select Entire Field)
    expect(await selection()).toEqual([0, 4, 4]);
    await page.keyboard.type('25');
    await expect(ctl('Montant')).toHaveValue('25');
    await page.keyboard.press('Escape');
    await expect(dirty).toHaveCount(0);
    await ctl('Client').click();
    await ctl('Montant').click();   // a click: the caret where it lands, nothing selected
    await expect(ctl('Montant')).toHaveValue('10,1');
    const [start, end] = await selection();
    expect(start).toBe(end);
  }, 'Commandes');
});

/** Drags the row selector of `from` in the Tab Order dialog above the row `to` (already selected: a drag on a selected row moves its block). */
async function dragAbove(page: Page, from: string, to: string) {
  const a = (await page.getByTestId(`taborder-sel-${from}`).boundingBox())!;
  const b = (await page.getByTestId(`taborder-item-${to}`).boundingBox())!;
  const x = a.x + a.width / 2, y0 = a.y + a.height / 2, y1 = b.y + 1;
  await page.mouse.move(x, y0);
  await page.mouse.down();
  await page.mouse.move(x, (y0 + y1) / 2, { steps: 4 });
  await page.mouse.move(x, y1, { steps: 4 });
  await page.mouse.up();
}

test('F1 Tab Order: a block dragged to the top in Design view, then Tab in Form view follows it; a page order changes that page only', async () => {
  const letters = (names: string[], top = 100): ControlDef[] => names.map((n, i) => box('textBox', n, top + i * 500, { TabIndex: i }));
  const plain: DesignDoc = { ...formFor('Clients', []), sections: [
    { kind: 'formHeader', height: 0, props: { Visible: false }, controls: [] },
    { kind: 'detail', height: 2268, props: {}, controls: letters(['A', 'B', 'C', 'D']) },
    { kind: 'formFooter', height: 0, props: { Visible: false }, controls: [] }] };
  const paged: DesignDoc = { ...plain, sections: [plain.sections[0], { kind: 'detail', height: 3402, props: {}, controls: [
    box('textBox', 'Nom', 100, { TabIndex: 0 }),
    { kind: 'tabControl', name: 'Onglets', left: 4300, top: 100, width: 3402, height: 3000, props: { Pages: ['Un', 'Deux'], TabIndex: 1 }, children: [
      box('textBox', 'P0a', 500, { TabIndex: 0 }, 4400), box('textBox', 'P0b', 1000, { TabIndex: 1 }, 4400),
      box('textBox', 'P1a', 500, { TabIndex: 0, PageIndex: 1 }, 4400), box('textBox', 'P1b', 1000, { TabIndex: 1, PageIndex: 1 }, 4400),
      box('textBox', 'P1c', 1500, { TabIndex: 2, PageIndex: 1 }, 4400)] },
    box('textBox', 'Fin', 2800, { TabIndex: 2 })] }, plain.sections[2]] };
  const base = seedBase('f1-recette', (db) => { createTable(db, table); seedForm(db, 'Plain', plain); seedForm(db, 'Paged', paged); });
  const { app, page } = await launchApp({ args: [base], env: FR });
  try {
    const { ctl } = locators(page);
    const tabs = async (first: string, expected: string[]) => {
      await ctl(first).click();
      for (const n of expected) { await page.keyboard.press('Tab'); await expect(ctl(n)).toBeFocused(); }
    };
    const designView = async (form: string) => {
      await page.getByTestId(`nav-item-form-${form}`).dblclick();
      await pickView(page, 'viewDesign');
      await expect(page.getByTestId('form-design').filter({ visible: true })).toBeVisible();
    };
    const saveAndRun = async (form: string, first: string) => {
      await page.getByTestId(`ctl-${first}`).click();
      await page.keyboard.press('Control+s');
      await expect(page.getByTestId(`doc-tab-form-${form}`)).not.toContainText('•');
      await page.keyboard.press('F5');
      await expect(page.getByTestId('form-run').filter({ visible: true })).toBeVisible();
    };

    // the block C, D dragged to the top (C, then Shift+click D select it)
    await designView('Plain');
    await page.getByTestId('ribbon-tab-formDesign').click();
    await page.getByTestId('cmd-tabOrder').click();
    await page.getByTestId('taborder-item-C').click();
    await page.getByTestId('taborder-item-D').click({ modifiers: ['Shift'] });
    await dragAbove(page, 'C', 'A');
    await expect(page.getByTestId('taborder-list-detail').locator('[role="option"]')).toHaveText(['C', 'D', 'A', 'B']);
    await page.getByTestId('taborder-ok').click();
    await saveAndRun('Plain', 'A');
    await tabs('C', ['D', 'A', 'B']);

    // a page's order: P1c to the top of page 2 only
    await designView('Paged');
    await page.getByTestId('tabpage-Onglets-1').click({ button: 'right' });
    await page.getByTestId('page-menu-taborder').click();
    await expect(page.getByTestId('taborder-list-page').locator('[role="option"]')).toHaveText(['P1a', 'P1b', 'P1c']);
    await page.getByTestId('taborder-sel-P1c').click();
    await dragAbove(page, 'P1c', 'P1a');
    await page.getByTestId('taborder-ok').click();
    await saveAndRun('Paged', 'Nom');
    const run = page.getByTestId('form-run').filter({ visible: true });
    await ctl('Nom').click();
    await page.keyboard.press('Tab');
    await expect(run.getByRole('tab', { name: 'Un' })).toBeFocused();
    for (const n of ['P0a', 'P0b', 'Fin']) { await page.keyboard.press('Tab'); await expect(ctl(n)).toBeFocused(); }   // page 1 and the section order unchanged
    await run.getByRole('tab', { name: 'Deux' }).click();
    for (const n of ['P1c', 'P1a', 'P1b', 'Fin']) { await page.keyboard.press('Tab'); await expect(ctl(n)).toBeFocused(); }
  } finally {
    await app.close();
  }
});
