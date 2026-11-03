// O2 R14 : le menu de filtre de colonne (Accueil › Filtrer, la flèche d'un en-tête) et sa liste de valeurs — cases à cocher,
// (Vides), valeurs difficiles à remettre en critère, date, décimal en région française, champ Liste de choix, options
// « Filtrer les options de recherche » (limite, champs non indexés), autres filtres actifs, formulaire, liaison serveur.
import { test, expect, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { RemoteTable } from '../../src/main/connectors/connector';
import { addServerLinks } from '../../src/main/links/store';
import { seedSales } from '../../src/main/query/test-db';
import { createTable } from '../../src/main/db/schema';
import type { BasecraftApi } from '../../src/shared/api';
import type { DesignDoc } from '../../src/shared/design/model';
import { f, t } from '../../src/shared/test-fixtures';
import { colLeft, launchApp, openDbOptions, seedBase, seedForm } from './helpers';

const FR = { BASECRAFT_REGION: 'fr-FR' };
const fr = JSON.parse(readFileSync(join(__dirname, '../../src/shared/i18n/fr.json'), 'utf8'));
const HEADER = 34, ROW = 30;
const cell = (page: Page, col: number, row: number) => page.getByTestId(`glide-cell-${col + 1}-${row}`);
const count = (page: Page) => page.getByTestId('nav-record-count');
const value = (page: Page, name: string | RegExp) => page.getByTestId('filter-menu').getByRole('menuitemcheckbox', { name, exact: typeof name === 'string' });
const values = (page: Page) => page.locator('[data-testid^="filter-value-"]').allTextContents();
/** A click on the cell; on the one already selected it opens its editor, which Escape closes (the cell keeps the focus). */
async function clickCell(page: Page, col: number, row: number) {
  const b = (await page.getByTestId('datasheet').getByTestId('data-grid-canvas').boundingBox())!;
  await page.mouse.click(b.x + colLeft(col) + 30, b.y + HEADER + row * ROW + ROW / 2);
  if (await expect(cell(page, col, row)).toBeFocused({ timeout: 1500 }).then(() => false, () => true)) {
    await page.keyboard.press('Escape');
    await expect(cell(page, col, row)).toBeFocused();
  }
}
async function open(page: Page, table: string) {
  await page.getByTestId(`nav-item-${table}`).dblclick();
  await expect(page.getByTestId('datasheet').getByTestId('data-grid-canvas')).toBeVisible();
}
/** Home › Filter on column `col` (its first row selected). */
async function filterMenu(page: Page, col: number) {
  await clickCell(page, col, 0);
  await page.getByTestId('cmd-filter').click();
  await expect(page.getByTestId('filter-menu')).toBeVisible();
}
/** Only `pick` ticked, then OK. */
async function only(page: Page, ...pick: (string | RegExp)[]) {
  await page.getByTestId('filter-all').click();
  await expect(page.getByTestId('filter-ok')).toBeDisabled(); // none ticked
  for (const p of pick) await (p === '(Vides)' ? page.getByTestId('filter-blanks') : value(page, p)).click();
  await page.getByTestId('filter-ok').click();
  await expect(page.getByTestId('filter-menu')).toHaveCount(0);
}
async function clearField(page: Page, col: number) {
  await filterMenu(page, col);
  await page.getByTestId('filter-clear-field').click();
}
async function dbOptions(page: Page, set: (page: Page) => Promise<void>) {
  await page.getByTestId('ribbon-tab-file').click();
  await openDbOptions(page);
  await set(page);
  await page.getByTestId('bs-back').click();
  await page.getByTestId('ribbon-tab-home').click();
}
const startup = (page: Page) => page.evaluate(() => (window as unknown as { basecraft: BasecraftApi }).basecraft.base.startup());

const base = () => seedBase('filtres-listes', (db) => {
  seedSales(db); // Clients: Dupont Lyon, Martin LYON, Durand Paris, Éric Lyôn; Commandes: amounts 10,1 / 0,1 / 0,2 / 99,99 / 0,1, dates
  const c = db.prepare('INSERT INTO "Clients" ("Nom", "Ville") VALUES (?, ?)');
  for (const r of [["O'Brien", null], ['say "hi"', 'Paris'], ['50*', 'Lyon']]) c.run(...r);
  createTable(db, t('Longue', [f('N°', 'autoNumber'), f('Texte', 'shortText')]));
  const l = db.prepare('INSERT INTO "Longue" ("Texte") VALUES (?)');
  db.exec('BEGIN');
  for (let i = 0; i < 1000; i++) l.run(`${'x'.repeat(130)}${String(i).padStart(4, '0')}`); // 1 000 values of 134 characters
  db.exec('COMMIT');
  createTable(db, t('Etats', [f('N°', 'autoNumber'), f('Libellé', 'shortText')]));
  createTable(db, t('Suivi', [f('N°', 'autoNumber'), f('Statut', 'number', {
    numberSize: 'longInteger', lookup: { kind: 'table', table: 'Etats', boundField: 'N°', displayFields: ['Libellé'], limitToList: false },
  })]));
  db.exec(`INSERT INTO "Etats" ("Libellé") VALUES ('Ouvert'), ('Fermé'); INSERT INTO "Suivi" ("Statut") VALUES (1), (2), (1)`);
});

test('the column menu and its list of values: ticks, (Vides), hard values, the header drop-down, the typed filters', async () => {
  test.setTimeout(120_000);
  const { app, page } = await launchApp({ args: [await base()], env: FR });
  try {
    await open(page, 'Clients');
    await expect(count(page)).toHaveText('7');
    await filterMenu(page, 2);
    await expect(page.getByTestId('filter-sort-asc')).toBeFocused();
    await expect(page.getByTestId('filter-sort-asc')).toHaveText('Trier de A à Z');
    await expect(page.getByTestId('filter-sort-desc')).toHaveText('Trier de Z à A');
    await expect(page.getByTestId('filter-clear-field')).toHaveText('Effacer le filtre de Ville');
    await expect(page.getByTestId('filter-clear-field')).toBeDisabled();
    await expect(page.getByTestId('filter-typed')).toHaveText('Filtres de texte');
    await expect(page.getByTestId('filter-all')).toHaveText('(Sélectionner tout)');
    await expect(page.getByTestId('filter-all')).toHaveAttribute('aria-checked', 'true');
    await expect(page.getByTestId('filter-menu').locator('button input, button button')).toHaveCount(0);   // valid HTML: nothing interactive in a menu item
    await expect(page.getByTestId('filter-blanks')).toHaveText('(Vides)');
    // text compared without case (Lyon and LYON once), accents kept (Lyôn apart)
    expect((await values(page)).map((v) => v.toLowerCase()).sort()).toEqual(['lyon', 'lyôn', 'paris']);
    await only(page, /^lyon$/i, '(Vides)');
    await expect(count(page)).toHaveText('4'); // Dupont, Martin, O'Brien, 50*
    await expect(page.getByTestId('nav-filtered')).toHaveAttribute('aria-pressed', 'true');

    // reopened: the same ticks; « Effacer le filtre de Ville »: every row
    await filterMenu(page, 2);
    await expect(page.getByTestId('filter-all')).toHaveAttribute('aria-checked', 'mixed');
    await expect(page.getByTestId('filter-blanks')).toHaveAttribute('aria-checked', 'true');
    await expect(value(page, /^lyon$/i)).toHaveAttribute('aria-checked', 'true');
    await expect(value(page, 'Paris')).toHaveAttribute('aria-checked', 'false');
    await expect(value(page, 'Lyôn')).toHaveAttribute('aria-checked', 'false');
    await page.getByTestId('filter-clear-field').click();
    await expect(count(page)).toHaveText('7');
    await expect(page.getByTestId('nav-filtered')).toBeDisabled();

    // the header's drop-down opens the same menu, on its own column
    await clickCell(page, 1, 0);
    const b = (await page.getByTestId('datasheet').getByTestId('data-grid-canvas').boundingBox())!;
    await page.mouse.click(b.x + colLeft(3) - 12, b.y + HEADER / 2);
    await expect(page.getByTestId('filter-clear-field')).toHaveText('Effacer le filtre de Ville');
    await page.getByTestId('filter-sort-desc').click();
    await expect(cell(page, 2, 0)).toHaveText('Paris');
    await page.getByTestId('cmd-sortClear').click();
    await expect(cell(page, 1, 0)).toHaveText('Dupont');

    // values hard to put back into criteria: each alone gives exactly its row
    for (const nom of ["O'Brien", 'say "hi"', '50*']) {
      await filterMenu(page, 1);
      await only(page, nom);
      await expect(count(page)).toHaveText('1');
      await expect(cell(page, 1, 0)).toHaveText(nom);
      await clearField(page, 1);
      await expect(count(page)).toHaveText('7');
    }

    // another field's filter: Ville lists only the values left (Nom = Durand or say "hi": Paris only, no blanks)
    await filterMenu(page, 1);
    await only(page, 'Durand', 'say "hi"');
    await expect(count(page)).toHaveText('2');
    await filterMenu(page, 2);
    expect(await values(page)).toEqual(['Paris']);
    await expect(page.getByTestId('filter-blanks')).toHaveCount(0);
    await page.getByTestId('filter-cancel').click();
    await expect(page.getByTestId('filter-menu')).toHaveCount(0);
    await page.getByTestId('cmd-filterAdvanced').click();
    await page.getByTestId('filter-menu-clear').click();
    await expect(count(page)).toHaveText('7');

    // « Filtres de texte »: the Expression Builder, as before
    await filterMenu(page, 2);
    await page.getByTestId('filter-typed').click();
    await page.getByTestId('xb-text').fill('"Paris"');
    await page.getByTestId('xb-ok').click();
    await expect(count(page)).toHaveText('2');
    await clearField(page, 2);
    await expect(count(page)).toHaveText('7');

    // « Filtrer les options de recherche »: limit 3 (7 records): Ville (not indexed) and N° (7 values) list nothing, the other
    // items stay; limit back, non-indexed fields off: Ville nothing, the key (indexed) lists
    await dbOptions(page, async (p) => {
      await p.getByTestId('opt-db-list-max').fill('3');
      await p.getByTestId('opt-db-list-max').press('Enter');
      await expect.poll(async () => (await startup(p))?.filterListMax).toBe(3);
    });
    await filterMenu(page, 2);
    await expect(page.getByTestId('filter-typed')).toBeVisible();
    await expect(page.getByTestId('filter-all')).toHaveCount(0);
    await page.keyboard.press('Escape');
    await filterMenu(page, 0);
    await expect(page.getByTestId('filter-typed')).toHaveText('Filtres numériques');
    await expect(page.getByTestId('filter-sort-asc')).toHaveText('Trier du plus petit au plus grand');
    await expect(page.getByTestId('filter-all')).toHaveCount(0);
    await page.keyboard.press('Escape');
    await dbOptions(page, async (p) => {
      await p.getByTestId('opt-db-list-max').fill('1000');
      await p.getByTestId('opt-db-list-max').press('Enter');
      await p.getByTestId('opt-db-list-nonindexed').uncheck();
      await expect.poll(() => startup(p)).toMatchObject({ filterListMax: 1000, filterListNonIndexed: false });
    });
    await filterMenu(page, 2);
    await expect(page.getByTestId('filter-all')).toHaveCount(0);
    await page.keyboard.press('Escape');
    await filterMenu(page, 0);
    expect(await values(page)).toEqual(['1', '2', '3', '4', '5', '6', '7']);
    await only(page, '6');
    await expect(cell(page, 1, 0)).toHaveText('say "hi"');
    await expect(count(page)).toHaveText('1');
  } finally {
    await app.close();
  }
});

test('a date, a decimal in a French region, a Lookup field: their lists filter on the stored values', async () => {
  const { app, page } = await launchApp({ args: [await base()], env: FR });
  try {
    await open(page, 'Commandes');
    await filterMenu(page, 3);
    await expect(page.getByTestId('filter-sort-asc')).toHaveText('Trier du plus ancien au plus récent');
    await expect(page.getByTestId('filter-typed')).toHaveText('Filtres de date');
    expect(await values(page)).toEqual(['30/09/2026', '01/10/2026', '05/10/2026', '21/10/2026']);
    await only(page, '21/10/2026');
    await expect(count(page)).toHaveText('2');
    await clearField(page, 3);
    await filterMenu(page, 2);
    await only(page, /^0,10/);
    await expect(count(page)).toHaveText('2'); // 0,1 twice
    await expect(cell(page, 0, 0)).toHaveText('2');
    await expect(cell(page, 0, 1)).toHaveText('5');
    await page.getByTestId(`doc-tab-close-Commandes`).click();

    await open(page, 'Suivi');
    await expect(cell(page, 1, 0)).toHaveText('Ouvert');
    await filterMenu(page, 1);
    await expect(page.getByTestId('filter-typed')).toHaveText('Filtres de texte'); // its list text's
    expect(await values(page)).toEqual(['Fermé', 'Ouvert']); // in the order of the text shown, not of the bound values
    await only(page, 'Fermé');
    await expect(count(page)).toHaveText('1'); // Statut = 2
    await expect(cell(page, 0, 0)).toHaveText('2');
  } finally {
    await app.close();
  }
});

test('a long list: 200 of 1 000 values ticked filter; past the criterion limit a dedicated message, never the invalid-request one', async () => {
  test.setTimeout(120_000);
  const { app, page } = await launchApp({ args: [await base()], env: FR });
  try {
    await open(page, 'Longue');
    await expect(count(page)).toHaveText('1000');
    const tick = (n: number, from = 0) => page.evaluate(([k, a]) => {
      for (let i = a; i < a + k; i++) (document.querySelector(`[data-testid="filter-value-${i}"]`) as HTMLElement).click();
    }, [n, from]);
    await filterMenu(page, 1);
    await expect(page.locator('[data-testid^="filter-value-"]')).toHaveCount(1000);
    await page.getByTestId('filter-all').click();
    await tick(200);
    await page.getByTestId('filter-ok').click();
    await expect(page.getByTestId('filter-menu')).toHaveCount(0);
    await expect(count(page)).toHaveText('200');
    // 500 ticked: both forms exceed 65 536 characters
    await filterMenu(page, 1);
    await page.getByTestId('filter-all').click(); // every value
    await page.getByTestId('filter-all').click(); // none
    await tick(500, 100);
    await page.getByTestId('filter-ok').click();
    await expect(page.getByTestId('filter-too-long')).toHaveText(fr.datasheet.filter.tooLong);
    await expect(page.getByTestId('filter-menu')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(count(page)).toHaveText('200'); // the filter stays as it was
    await expect(page.getByText("La demande n'est pas valide")).toHaveCount(0);
  } finally {
    await app.close();
  }
});

test('a form: Home › Filter on its Ville text box opens the same list and filters the form', async () => {
  const form: DesignDoc = {
    formatVersion: '1.0', recordSource: { kind: 'table', name: 'Clients' }, props: { Width: 9072 },
    sections: [{ kind: 'formHeader', height: 0, props: { Visible: false }, controls: [] },
      { kind: 'detail', height: 1701, props: {}, controls: ['Nom', 'Ville'].map((n, i) => ({ kind: 'textBox' as const, name: n, left: 1701, top: 100 + i * 500, width: 2268, height: 340, props: { ControlSource: n, TabIndex: i } })) },
      { kind: 'formFooter', height: 0, props: { Visible: false }, controls: [] }],
  };
  const withForm = seedBase('filtres-listes-form', (db) => { seedSales(db); db.exec(`INSERT INTO "Clients" ("Nom") VALUES ('Sans ville')`); seedForm(db, 'Fiche', form); });
  const { app, page } = await launchApp({ args: [withForm], env: FR });
  try {
    await page.getByTestId('nav-item-form-Fiche').dblclick();
    await expect(page.getByTestId('form-run')).toBeVisible();
    await page.getByTestId('ribbon-tab-home').click();
    await page.getByTestId('form-ctl-Ville').click();
    await page.getByTestId('cmd-filter').click();
    await expect(page.getByTestId('filter-blanks')).toBeVisible();
    expect((await values(page)).map((v) => v.toLowerCase()).sort()).toEqual(['lyon', 'lyôn', 'paris']);
    await only(page, 'Paris', '(Vides)');
    await expect(page.getByTestId('nav-record-count')).toHaveText('2');
    await expect(page.getByTestId('form-ctl-Nom')).toHaveValue('Durand');
    await expect(page.getByTestId('nav-filtered')).toHaveAttribute('aria-pressed', 'true');
    await page.getByTestId('form-ctl-Ville').click();
    await page.getByTestId('cmd-filter').click();
    await expect(value(page, 'Paris')).toHaveAttribute('aria-checked', 'true');
    await expect(value(page, 'Lyôn')).toHaveAttribute('aria-checked', 'false');
    await page.getByTestId('filter-clear-field').click();
    await expect(page.getByTestId('nav-record-count')).toHaveText('5');
  } finally {
    await app.close();
  }
});

test('a PostgreSQL link (fake server): its fields never list, the menu offers the other filters', async () => {
  const clients: RemoteTable = {
    name: 'Clients', remote: 'Clients', schema: 'public', key: ['id'], skipped: [],
    design: t('Clients', [f('id', 'number', { numberSize: 'longInteger' }), f('Nom', 'shortText'), f('Ville', 'shortText')]),
  };
  const front = seedBase('Front', (db) => addServerLinks(db, 'postgresql', { host: 'db.example', port: 5432, database: 'ventes', user: 'ana', tls: 'verify-full', timeout: 60 }, [clients]));
  const { app, page } = await launchApp({ args: [front], env: { ...FR, BASECRAFT_E2E_FAKE_SERVER: '1' } });
  try {
    await page.getByTestId('nav-item-Clients').dblclick();
    await page.getByTestId('login-password').fill('secret');
    await page.getByTestId('login-ok').click();
    await expect(count(page)).toHaveText('2');
    await filterMenu(page, 2);
    await expect(page.getByTestId('filter-typed')).toHaveText(fr.datasheet.filter.typed.text);
    await expect(page.getByTestId('filter-all')).toHaveCount(0);
    await page.getByTestId('filter-sort-desc').click();
    await expect(cell(page, 2, 0)).toHaveText('Lyon');
  } finally {
    await app.close();
  }
});
