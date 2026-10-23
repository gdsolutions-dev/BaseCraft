// Zones de liste déroulante et zones de liste en mode Formulaire (A4, tâche 9) : liste sur une table (N° lié caché), saisie
// semi-automatique, Limiter à liste (lié : bloque l'enregistrement ; indépendant : erreur propre au formulaire), zone de liste
// au clavier, source introuvable, liste relue après Maj+F9.
import { test, expect, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createTable } from '../../src/main/db/schema';
import { insertRow } from '../../src/main/db/write-layer';
import type { BasecraftApi } from '../../src/shared/api';
import type { ControlDef, DesignDoc } from '../../src/shared/design/model';
import { localeInfo } from '../../src/shared/locale-format';
import { clients, f, t } from '../../src/shared/test-fixtures';
import { launchApp, seedBase, seedForm } from './helpers';

const fr = JSON.parse(readFileSync(join(__dirname, '../../src/shared/i18n/fr.json'), 'utf8'));
const region = localeInfo('fr-FR');
const fill = (s: string, p: Record<string, string | number>) => s.replace(/\{\{(\w+)\}\}/g, (_, k: string) => String(p[k]));
const commandes = t('Commandes', [
  f('N°', 'autoNumber'),
  f('Client', 'number', { numberSize: 'longInteger', lookup: { kind: 'table', table: 'Clients', boundColumn: 1, columnCount: 2, columnWidths: [0, 1417], limitToList: false } }),
  f('Statut', 'shortText'),
  f('Priorité', 'shortText'),
]);
const combo = (name: string, top: number, props: Record<string, unknown>): ControlDef => ({ kind: 'comboBox', name, left: 1701, top, width: 2268, height: 340, props });
const doc: DesignDoc = {
  formatVersion: '1.0', recordSource: { kind: 'table', name: 'Commandes' }, props: { Width: 9072 },
  sections: [
    { kind: 'formHeader', height: 0, props: { Visible: false }, controls: [] },
    { kind: 'detail', height: 3969, props: {}, controls: [
      // as the Field List lays out a field with A2's lookup (boundControlWithLabel)
      { ...combo('Client', 100, { ControlSource: 'Client', TabIndex: 0, RowSourceType: 'tableQuery', RowSource: 'Clients', BoundColumn: 1, ColumnCount: 2, ColumnWidths: '0;1417', ColumnHeads: true, LimitToList: true }),
        children: [{ kind: 'label', name: 'Client_Étiquette', left: 100, top: 100, width: 1500, height: 340, props: { Caption: 'Client:' } }] },
      combo('Statut', 600, { ControlSource: 'Statut', TabIndex: 1, RowSourceType: 'valueList', RowSource: 'Ouverte;Fermée', LimitToList: true }),
      { kind: 'listBox', name: 'Priorité', left: 1701, top: 1100, width: 2268, height: 900, props: { ControlSource: 'Priorité', TabIndex: 2, RowSourceType: 'valueList', RowSource: 'Niveau;Basse;Normale;Haute', ColumnHeads: true },
        children: [{ kind: 'label', name: 'Priorité_Étiquette', left: 100, top: 1100, width: 1500, height: 340, props: { Caption: 'Priorité:' } }] },
      combo('Ville', 2200, { TabIndex: 3, RowSourceType: 'valueList', RowSource: 'Lyon;Paris', LimitToList: true }),   // unbound
      combo('Perdue', 3000, { TabStop: false, RowSourceType: 'tableQuery', RowSource: 'Absente' }),   // unbound, its table is gone
      { ...combo('Historique', 100, { TabStop: false, RowSourceType: 'tableQuery', RowSource: 'Commandes', ColumnCount: 4, ColumnWidths: '0;0;0;1417' }), left: 5000 },   // the form's own table
    ] },
    { kind: 'formFooter', height: 0, props: { Visible: false }, controls: [] },
  ],
};
const bc = (page: Page) => ({
  rows: (name: string) => page.evaluate((n) => (window as unknown as { basecraft: BasecraftApi }).basecraft.rows.page(n, { offset: 0, limit: 20 })
    .then((p) => p.rows.map((r) => r.values)), name),
  insert: (Nom: string) => page.evaluate((n) => (window as unknown as { basecraft: BasecraftApi }).basecraft.rows.insert('Clients', { Nom: n }), Nom),
});

test('combo box on a table, AutoExpand, Limit To List bound and unbound, list box keys, unknown source, Shift+F9 reads the list again', async () => {
  const base = await seedBase('fx-listes', async (db) => {
    createTable(db, clients);
    createTable(db, commandes);
    for (const Nom of ['Dupont', 'Martin']) await insertRow(db, clients, { Nom }, region);
    await insertRow(db, commandes, { Client: 1, Statut: 'Ouverte', Priorité: 'Basse' }, region);
    await insertRow(db, commandes, { Client: 2, Statut: 'Fermée', Priorité: 'Haute' }, region);
    seedForm(db, 'Commandes', doc);
  });
  const { app, page } = await launchApp({ args: [base], env: { BASECRAFT_REGION: 'fr-FR' } });
  try {
    await page.getByTestId('nav-item-form-Commandes').dblclick();
    const run = page.getByTestId('form-run');
    await expect(run).toBeVisible();
    await page.getByTestId('ribbon-tab-home').click();
    const ctl = (n: string) => page.getByTestId(`form-ctl-${n}`);
    const input = page.getByTestId('nav-record-input');
    const dirty = page.getByTestId('form-dirty');
    const next = run.getByRole('button', { name: fr.datasheet.nav.next });
    const prev = run.getByRole('button', { name: fr.datasheet.nav.prev });
    const options = (n: string) => page.getByTestId(`form-list-${n}`).getByRole('option');

    // the combo box shows the client's name, not the bound N° (hidden column); an ARIA combobox named by its label
    await expect(ctl('Client')).toHaveValue('Dupont');
    await expect(page.getByRole('combobox', { name: 'Client:' })).toHaveAttribute('aria-expanded', 'false');
    await page.getByTestId('form-ctl-Client-toggle').click();
    await expect(options('Client')).toHaveText(['Dupont', 'Martin']);
    await expect(page.getByTestId('form-list-heads-Client')).toHaveText('Nom');   // Column Heads: the visible column's name
    await expect(ctl('Client')).toHaveAttribute('aria-expanded', 'true');
    await expect(ctl('Client')).toBeFocused();
    await page.keyboard.press('Escape');   // closes the list, the value as it was
    await expect(page.getByTestId('form-list-Client')).toHaveCount(0);
    await expect(dirty).toHaveCount(0);
    await page.keyboard.press('Alt+ArrowDown');   // Alt+↓ and F4 open it too (Access)
    await expect(options('Client')).toHaveText(['Dupont', 'Martin']);
    await page.keyboard.press('Alt+ArrowUp');
    await expect(page.getByTestId('form-list-Client')).toHaveCount(0);
    await page.keyboard.press('F4');
    await expect(options('Client')).toHaveText(['Dupont', 'Martin']);
    await page.keyboard.press('F4');
    await expect(page.getByTestId('form-list-Client')).toHaveCount(0);
    await expect(dirty).toHaveCount(0);

    // AutoExpand: « mar » completes « Martin » (the rest selected); Enter chooses it; the next record saves N° 2
    await page.keyboard.press('Control+A');
    await page.keyboard.type('mar');
    await expect(ctl('Client')).toHaveValue('Martin');
    expect(await ctl('Client').evaluate((e: HTMLInputElement) => [e.selectionStart, e.selectionEnd])).toEqual([3, 6]);
    await expect(options('Client')).toHaveText(['Martin']);
    await expect(options('Client').first()).toHaveAttribute('aria-selected', 'true');
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('form-list-Client')).toHaveCount(0);
    await expect(dirty).toBeVisible();
    await next.click();
    await expect(input).toHaveValue('2');
    expect((await bc(page).rows('Commandes'))[0]![1]).toBe(2);
    await prev.click();
    await expect(ctl('Client')).toHaveValue('Martin');

    // a text typed that is a hidden bound N° stays as typed, and is not in the list (Access compares the shown texts)
    await ctl('Client').click();
    await page.keyboard.press('Control+A');
    await page.keyboard.type('2');
    await expect(ctl('Client')).toHaveValue('2');
    await page.keyboard.press('Tab');
    await expect(page.getByTestId('modal')).toContainText(fill(fr.datasheet.fieldError, { field: 'Client', message: fr.fieldError.notInList }));
    await page.getByTestId('modal-btn-ok').click();
    await expect(ctl('Client')).toBeFocused();
    await expect(ctl('Client')).toHaveValue('2');
    await page.keyboard.press('Escape');
    await expect(ctl('Client')).toHaveValue('Martin');
    await expect(page.getByTestId('form-error-Client')).toHaveCount(0);

    // Limit To List on a bound combo: a text in no row is refused on leaving (its box, the message under it, the focus back),
    // and the record cannot be saved until it is fixed or undone
    await ctl('Statut').click();
    await page.keyboard.press('Control+A');
    await page.keyboard.type('Autre');
    await page.keyboard.press('Tab');
    const notInList = fill(fr.datasheet.fieldError, { field: 'Statut', message: fr.fieldError.notInList });
    await expect(page.getByTestId('modal')).toContainText(notInList);
    await page.getByTestId('modal-btn-ok').click();
    await expect(ctl('Statut')).toBeFocused();
    await expect(page.getByTestId('form-error-Statut')).toHaveText(fr.fieldError.notInList);
    await next.click();
    await expect(page.getByTestId('modal')).toContainText(notInList);
    await page.getByTestId('modal-btn-ok').click();
    await expect(input).toHaveValue('1');
    await ctl('Statut').click();
    await page.keyboard.press('Escape');
    await expect(ctl('Statut')).toHaveValue('Ouverte');
    await expect(page.getByTestId('form-error-Statut')).toHaveCount(0);
    // the arrows of the open list choose as they go
    await page.keyboard.press('ArrowDown');
    await expect(options('Statut')).toHaveText(['Ouverte', 'Fermée']);
    await page.keyboard.press('ArrowDown');
    await expect(ctl('Statut')).toHaveValue('Fermée');
    await page.keyboard.press('Enter');
    await page.keyboard.press('Escape');   // the list closed: undoes the field
    await expect(ctl('Statut')).toHaveValue('Ouverte');

    // list box: role listbox, the stored value selected; ↓ chooses the next row, Escape undoes, Shift+Enter saves (and the
    // form's lists are read again after its own save: Historique lists the orders' Priorité)
    await page.getByTestId('form-ctl-Historique-toggle').click();
    await expect(options('Historique')).toHaveText(['Basse', 'Haute']);
    await page.keyboard.press('Escape');
    await expect(page.getByRole('listbox', { name: 'Priorité:' })).toBeVisible();
    await expect(page.getByTestId('form-list-heads-Priorité')).toHaveText('Niveau');   // the value list's first row, not an option
    await expect(ctl('Priorité').getByRole('option')).toHaveText(['Basse', 'Normale', 'Haute']);
    await expect(ctl('Priorité').getByRole('option', { name: 'Basse' })).toHaveAttribute('aria-selected', 'true');
    await page.getByText('Priorité:').click();   // its label gives it the focus
    await expect(ctl('Priorité')).toBeFocused();
    await page.keyboard.press('ArrowDown');
    await expect(ctl('Priorité').getByRole('option', { name: 'Normale' })).toHaveAttribute('aria-selected', 'true');
    await expect(dirty).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(ctl('Priorité').getByRole('option', { name: 'Basse' })).toHaveAttribute('aria-selected', 'true');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Shift+Enter');
    await expect(dirty).toHaveCount(0);
    expect((await bc(page).rows('Commandes'))[0]![3]).toBe('Normale');
    await page.getByTestId('form-ctl-Historique-toggle').click();
    await expect(options('Historique')).toHaveText(['Normale', 'Haute']);
    await page.keyboard.press('Escape');

    // Limit To List on an unbound combo: the form's own error (box, message, focus back), gone with Escape
    await ctl('Ville').click();
    await page.keyboard.type('zz');
    await page.keyboard.press('Tab');
    await expect(page.getByTestId('modal')).toContainText(fill(fr.datasheet.fieldError, { field: 'Ville', message: fr.fieldError.notInList }));
    await page.getByTestId('modal-btn-ok').click();
    await expect(ctl('Ville')).toBeFocused();
    await expect(page.getByTestId('form-error-Ville')).toHaveText(fr.fieldError.notInList);
    await page.keyboard.press('Escape');
    await expect(ctl('Ville')).toHaveValue('');
    await expect(page.getByTestId('form-error-Ville')).toHaveCount(0);
    await page.keyboard.type('par');
    await expect(ctl('Ville')).toHaveValue('Paris');

    // a Row Source naming no table: no rows, the reason under the control, the control still takes an entry
    await expect(page.getByTestId('form-list-note-Perdue')).toContainText(fr.form.list.sourceError.split('{{')[0]!);
    await ctl('Perdue').fill('libre');
    await expect(ctl('Perdue')).toHaveValue('libre');

    // a client added elsewhere: Shift+F9 reads the list again
    expect(await bc(page).insert('Zola')).toMatchObject({ ok: true });
    await ctl('Client').click();
    await page.keyboard.press('Shift+F9');
    await expect(input).toHaveValue('1');
    await page.getByTestId('form-ctl-Client-toggle').click();
    await expect(options('Client')).toHaveText(['Dupont', 'Martin', 'Zola']);
  } finally {
    await app.close();
  }
});
