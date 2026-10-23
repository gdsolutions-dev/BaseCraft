// Sous-formulaires maître/détail (A4, tâche 11) : liens proposés en mode Création, filtre par les champs pères/fils, ajout lié,
// refus qui garde le focus dans le sous-formulaire, père nouveau enregistré à l'entrée, suppression en cascade, récursion,
// objet source introuvable, Tab / Ctrl+Tab entre père et sous-formulaire, flèches Haut/Bas, clic droit en formulaire continu.
import { test, expect, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { saveObject } from '../../src/main/db/objects';
import { saveRelation } from '../../src/main/db/relations';
import { createTable } from '../../src/main/db/schema';
import type { BasecraftApi } from '../../src/shared/api';
import type { ControlDef, DesignDoc } from '../../src/shared/design/model';
import { localeInfo } from '../../src/shared/locale-format';
import { f, t } from '../../src/shared/test-fixtures';
import { formGrid, launchApp, seedBase, seedForm } from './helpers';

const fr = JSON.parse(readFileSync(join(__dirname, '../../src/shared/i18n/fr.json'), 'utf8'));
const FR = { BASECRAFT_REGION: 'fr-FR' };
const fill = (s: string, p: Record<string, string | number>) => s.replace(/\{\{(\w+)\}\}/g, (_, k: string) => String(p[k]));
const clients = t('Clients', [f('N°', 'autoNumber'), f('Nom', 'shortText'), f('Actif', 'yesNo')]);
const commandes = t('Commandes', [f('N°', 'autoNumber'), f('Client', 'number', { numberSize: 'longInteger' }),
  f('Montant', 'number', { numberSize: 'longInteger', validationRule: '>0', validationText: 'Montant positif' })]);
const box = (kind: ControlDef['kind'], name: string, left: number, top: number, props: Record<string, unknown>, width = 1500, height = 340): ControlDef =>
  ({ kind, name, left, top, width, height, props });
const formOf = (table: string, detail: ControlDef[], props: Record<string, unknown> = {}, height = 4000): DesignDoc => ({
  formatVersion: '1.0', recordSource: { kind: 'table', name: table }, props: { Width: 9000, ...props },
  sections: [
    { kind: 'formHeader', height: 0, props: { Visible: false }, controls: [] },
    { kind: 'detail', height, props: {}, controls: detail },
    { kind: 'formFooter', height: 0, props: { Visible: false }, controls: [] },
  ],
});
const subform = (source: string, links: Record<string, string> = {}) =>
  box('subform', 'Commandes', 100, 1000, { SourceObject: source, TabIndex: 2, ...links }, 4000, 3200);
// the master: N°, Nom, the subform, then an unbound multi-line Remarque (a textarea)
const fiche = (source: string, links: Record<string, string> = {}) => formOf('Clients', [
  box('textBox', 'N°', 100, 100, { ControlSource: 'N°', TabIndex: 0 }), box('textBox', 'Nom', 1800, 100, { ControlSource: 'Nom', TabIndex: 1 }),
  subform(source, links), box('textBox', 'Remarque', 4300, 1000, { TabIndex: 3 }, 2000, 1200),
]);
// the subform's form: a datasheet of N° and Montant (Client is not shown)
const saisie = formOf('Commandes', [box('textBox', 'N°', 100, 100, { ControlSource: 'N°', TabIndex: 0 }), box('textBox', 'Montant', 1800, 100, { ControlSource: 'Montant', TabIndex: 1 })],
  { DefaultView: 'datasheet' });

const base = () => seedBase('fx-sous-formulaires', (db) => {
  createTable(db, clients);
  createTable(db, commandes);
  db.exec(`INSERT INTO "Clients"("Nom", "Actif") VALUES ('Dupont', 0), ('Martin', 0), ('Bernard', 0)`);
  db.exec(`INSERT INTO "Commandes"("Client", "Montant") VALUES (1, 10), (1, 20)`);
  saveRelation(db, { name: '', parentTable: 'Clients', parentFields: ['N°'], childTable: 'Commandes', childFields: ['Client'],
    enforce: true, cascadeUpdate: false, cascadeDelete: true, joinType: 1 }, null, localeInfo('fr-FR'));
  seedForm(db, 'Saisie des commandes', saisie);
  saveObject(db, 'query', 'QMontants', { formatVersion: '1.0', sql: 'UPDATE Commandes SET Montant = Montant WHERE Client = 1;' }, null);   // an action query on Commandes
  seedForm(db, 'Copie des commandes', saisie);
  seedForm(db, 'Fiche client', fiche('Saisie des commandes', { LinkMasterFields: 'N°', LinkChildFields: 'Client' }));
  // the same, in Single Form view, with Client shown
  seedForm(db, 'Saisie unique', { ...saisie, props: { Width: 9000 }, sections: saisie.sections.map((x) => (x.kind !== 'detail' ? x
    : { ...x, controls: [...x.controls, box('textBox', 'Client', 3500, 100, { ControlSource: 'Client', TabIndex: 2 })] })) });
  seedForm(db, 'Fiche simple', fiche('Saisie unique', { LinkMasterFields: 'N°', LinkChildFields: 'Client' }));
  seedForm(db, 'Fiche vide', formOf('Clients', [box('textBox', 'Nom', 1800, 100, { ControlSource: 'Nom', TabIndex: 0 })]));
  seedForm(db, 'Boucle', formOf('Clients', [box('textBox', 'Nom', 1800, 100, { ControlSource: 'Nom', TabIndex: 0 }), box('subform', 'Moi', 100, 1000, { SourceObject: 'Boucle' }, 4000, 2000)]));
  seedForm(db, 'Fiche orpheline', fiche('Copie des commandes', { LinkMasterFields: 'N°', LinkChildFields: 'Client' }));
  seedForm(db, 'Onglets client', formOf('Clients', [box('textBox', 'Nom', 1800, 100, { ControlSource: 'Nom', TabIndex: 0 }),
    { ...box('tabControl', 'Pages', 100, 600, { Pages: ['Commandes', 'Autre'], TabIndex: 1 }, 6000, 4000), children: [
      { ...subform('Saisie des commandes', { LinkMasterFields: 'N°', LinkChildFields: 'Client' }), left: 200, top: 1100 },
      box('textBox', 'Note', 300, 1100, { PageIndex: 1 })] }], {}, 5000));
  seedForm(db, 'Liste', formOf('Clients', [box('textBox', 'Nom', 1800, 50, { ControlSource: 'Nom', TabIndex: 0 }),
    box('label', 'Étiquette', 100, 50, { Caption: 'Client' }, 1500), box('checkBox', 'Actif', 3500, 50, { ControlSource: 'Actif', TabIndex: 1 }, 284, 284)],
  { DefaultView: 'continuous' }, 500));
});

const rows = (page: Page, table: string) => page.evaluate((tb) => (window as unknown as { basecraft: BasecraftApi }).basecraft.rows.page(tb, { offset: 0, limit: 100 })
  .then((p) => p.rows.map((r) => r.values)), table);

// the subform's datasheet: N° and Montant, each as wide as its control (1500 twips = 100 px)
const sub = (page: Page) => formGrid(page, page.getByTestId('form-ctl-Commandes'), [100, 100]);
const focusIn = (page: Page, testId: string) => page.evaluate((id) => !!document.activeElement?.closest(`[data-testid="${id}"]`), testId);
// the master's own navigation bar (the subform has one too, inside the master's form)
const master = (page: Page) => {
  const nav = page.getByTestId('form-run').first().locator(':scope > .recnav');
  return { nav, count: nav.getByTestId('nav-record-count'), add: nav.getByTestId('nav-new'), button: (k: string) => nav.getByRole('button', { name: fr.datasheet.nav[k] }) };
};

test('Design view: a subform given its Source Object gets the link fields of the relation, announced and editable', async () => {
  const { app, page } = await launchApp({ args: [base()], env: FR });
  try {
    await page.getByTestId('nav-item-form-Fiche vide').click({ button: 'right' });
    await page.getByTestId('nav-menu-design').click();
    await page.getByTestId('tool-subform').click();
    await page.locator('[data-section-body="1"]').click({ position: { x: 60, y: 60 } });
    await expect(page.getByTestId('ctl-Enfant1')).toBeVisible();
    await page.getByTestId('prop-SourceObject').fill('Saisie des commandes');
    await page.getByTestId('prop-SourceObject').press('Enter');
    await expect(page.getByTestId('prop-LinkMasterFields')).toHaveValue('N°');
    await expect(page.getByTestId('prop-LinkChildFields')).toHaveValue('Client');
    await expect(page.getByTestId('form-subform-linked')).toHaveText(fill(fr.form.subform.linked, { master: 'N°', child: 'Client' }));
    await expect(page.getByTestId('ctl-Enfant1')).toHaveText('Saisie des commandes');   // a frame with the object's name, no data
    await page.getByTestId('prop-LinkChildFields').fill('N°');
    await page.getByTestId('prop-LinkChildFields').press('Enter');
    await expect(page.getByTestId('prop-LinkChildFields')).toHaveValue('N°');
  } finally {
    await app.close();
  }
});

test('Form view: the subform follows the master record, adds linked rows, keeps a refused row, saves a new master on entry, cascade delete', async () => {
  const { app, page } = await launchApp({ args: [base()], env: FR });
  try {
    const s = sub(page);
    const m = master(page);
    const nom = page.getByTestId('form-ctl-Nom');
    await page.getByTestId('nav-item-form-Fiche client').dblclick();
    await expect(nom).toHaveValue('Dupont');
    await expect(s.count).toHaveText('2');
    await expect(s.cell(1, 0)).toHaveText('10');

    // the next client: no order; one typed (its Client not shown) is saved with Client = 2 when the master is clicked
    await m.button('next').click();
    await expect(nom).toHaveValue('Martin');
    await expect(s.count).toHaveText('0');
    await s.click(1, 0);
    await s.type('15');
    await nom.click();
    await expect.poll(() => rows(page, 'Commandes')).toEqual([[1, 1, 10], [2, 1, 20], [3, 2, 15]]);
    await expect(s.count).toHaveText('1');

    // a broken rule: the master clicked, the message box, then the focus stays in the subform; Esc Esc lets it go
    await s.click(1, 1);
    await s.type('-5');
    await nom.click();
    await expect(page.getByTestId('modal')).toContainText('Montant positif');
    await page.getByTestId('modal-btn-ok').click();
    await expect(s.cell(1, 1)).toBeFocused();
    // the master's previous record: refused the same way, the master stays on its record and the entry is kept
    await m.button('prev').click();
    await expect(page.getByTestId('modal')).toContainText('Montant positif');
    await page.getByTestId('modal-btn-ok').click();
    await expect(nom).toHaveValue('Martin');
    await expect(s.cell(1, 1)).toBeFocused();
    await expect(s.cell(1, 1)).toHaveText('-5');
    // the subform's record being edited makes the master's tab dirty (an action query on Commandes is refused meanwhile)
    const tab = page.getByTestId('doc-tab-form-Fiche client');
    await expect(tab).toContainText('•');
    await page.getByTestId('nav-item-query-QMontants').dblclick();
    await expect(page.getByTestId('modal')).toContainText(fill(fr.query.action.inUse, { table: 'Commandes' }));
    await page.getByTestId('modal-btn-ok').click();
    // back on the form's tab: read again in place, its subform's row saved first (Task 12), refused the same way, kept
    await expect(page.getByTestId('modal')).toContainText('Montant positif');
    await page.getByTestId('modal-btn-ok').click();
    await expect(page.getByTestId('modal')).toHaveCount(0);
    await expect(tab).toHaveAttribute('aria-selected', 'true');
    await expect(s.cell(1, 1)).toBeFocused();
    await expect(s.cell(1, 1)).toHaveText('-5');
    await page.keyboard.press('Escape');
    await page.keyboard.press('Escape');
    await expect(tab).not.toContainText('•');
    // once undone, the action query runs (its count asked, Yes)
    await page.getByTestId('nav-item-query-QMontants').dblclick();
    await expect(page.getByTestId('modal-btn-yes')).toBeVisible();
    await page.getByTestId('modal-btn-yes').click();
    await expect(page.getByTestId('modal')).toHaveCount(0);
    await expect(tab).toHaveAttribute('aria-selected', 'true');
    await nom.click();
    await expect(nom).toBeFocused();
    await expect(page.getByTestId('modal')).toHaveCount(0);
    expect(await rows(page, 'Commandes')).toHaveLength(3);

    // a new client: the subform has no rows and allows no addition; typing « Durand » then entering the subform saves it, and
    // the subform is ready for its first order
    await m.add.click();
    await expect(s.count).toHaveText('0');
    await expect(s.add).toBeDisabled();
    await nom.fill('Durand');
    await s.at(1, 0);   // no row there yet
    await expect(m.count).toHaveText('4');
    await expect(s.add).toBeEnabled();
    await expect.poll(async () => (await rows(page, 'Clients')).map((r) => r[1])).toEqual(['Dupont', 'Martin', 'Bernard', 'Durand']);
    // its new record, ready: selected, the focus in its grid (the cell itself once Glide has drawn the row)
    await expect(s.cell(0, 0)).toHaveAttribute('aria-selected', 'true');
    await expect.poll(() => focusIn(page, 'form-ctl-Commandes')).toBe(true);
    await s.click(1, 0);
    await s.type('7');
    await nom.click();
    await expect.poll(async () => (await rows(page, 'Commandes')).at(-1)).toEqual([4, 4, 7]);

    // the first client, who has orders: the cascade is in the question; the next client's orders then show
    await m.button('first').click();
    await expect(nom).toHaveValue('Dupont');
    await page.getByTestId('ribbon-tab-home').click();
    await page.getByTestId('cmd-deleteRecord').click();
    await expect(page.getByTestId('modal')).toContainText(fr.datasheet.deleteCascade_one);
    await page.getByTestId('modal-btn-yes').click();
    await expect(nom).toHaveValue('Martin');
    await expect(s.count).toHaveText('1');
    expect((await rows(page, 'Commandes')).map((r) => r[1])).toEqual([2, 4]);
  } finally {
    await app.close();
  }
});

test('focus: Tab into the subform, Tab past its last column and Ctrl+Tab back to the master; Up and Down move between fields', async () => {
  const { app, page } = await launchApp({ args: [base()], env: FR });
  try {
    const s = sub(page);
    const ctl = (n: string) => page.getByTestId(`form-ctl-${n}`);
    await page.getByTestId('nav-item-form-Fiche client').dblclick();
    await expect(s.count).toHaveText('2');

    // Up and Down: the previous and next fields; a multi-line text box keeps its caret
    await ctl('Nom').click();
    await page.keyboard.press('ArrowUp');
    await expect(ctl('N°')).toBeFocused();
    await page.keyboard.press('ArrowDown');
    await expect(ctl('Nom')).toBeFocused();
    await ctl('Remarque').click();
    await page.keyboard.type('a');
    await page.keyboard.press('ArrowUp');
    await expect(ctl('Remarque')).toBeFocused();

    // Tab from Nom: into the subform; Ctrl+Tab: the master's next control; Ctrl+Shift+Tab from the subform: the previous one
    await ctl('Nom').click();
    await page.keyboard.press('Tab');
    await expect(s.cell(0, 0)).toHaveAttribute('aria-selected', 'true');
    await expect.poll(() => focusIn(page, 'form-ctl-Commandes')).toBe(true);   // in its grid (the cell, or the scroller while drawn)
    await page.keyboard.press('Control+Tab');
    await expect(ctl('Remarque')).toBeFocused();
    await s.click(1, 1);
    await page.keyboard.press('Control+Shift+Tab');
    await expect(ctl('Nom')).toBeFocused();

    // Tab past the last column of the untouched new row: out to the master's next control
    await s.click(1, 2);
    await expect(s.cell(1, 2)).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(ctl('Remarque')).toBeFocused();

    // an existing master edited, then the subform entered: the master is saved; the master's Next then keeps the focus on
    // the button (the subform read again does not take it)
    await ctl('Nom').fill('Dupond');
    await s.click(1, 0);
    await expect.poll(async () => (await rows(page, 'Clients'))[0][1]).toBe('Dupond');
    const next = master(page).button('next');
    await next.click();
    await expect(ctl('Nom')).toHaveValue('Martin');
    await expect(s.count).toHaveText('0');
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
    await expect(next).toBeFocused();
  } finally {
    await app.close();
  }
});

test('a recursive subform and a renamed Source Object show a frame with their message; the master stays usable', async () => {
  const { app, page } = await launchApp({ args: [base()], env: FR });
  try {
    await page.getByTestId('nav-item-form-Boucle').dblclick();
    await expect(page.getByTestId('form-subform-error')).toHaveText(fill(fr.form.subform.recursive, { name: 'Boucle' }));
    const nom = page.locator('[data-testid="form-ctl-Nom"]:visible');
    await expect(nom).toHaveValue('Dupont');
    await nom.fill('Dupond');
    await page.getByTestId('form-run').locator(':scope > .recnav').getByRole('button', { name: fr.datasheet.nav.next }).click();
    await expect(nom).toHaveValue('Martin');
    expect((await rows(page, 'Clients'))[0][1]).toBe('Dupond');

    expect(await page.evaluate(() => (window as unknown as { basecraft: BasecraftApi }).basecraft.objects.rename('form', 'Copie des commandes', 'Copie renommée')))
      .toMatchObject({ ok: true });
    await page.getByTestId('nav-item-form-Fiche orpheline').dblclick();
    const frame = page.locator('[data-testid="form-ctl-Commandes"]:visible');
    await expect(frame.getByTestId('form-subform-error')).toHaveText(fill(fr.form.subform.missing, { name: 'Copie des commandes' }));
    await expect(page.locator('[data-testid="form-ctl-Nom"]:visible')).toHaveValue('Dupond');
  } finally {
    await app.close();
  }
});

test('Continuous Forms: a right click on another row never swallows the next real click on it', async () => {
  const { app, page } = await launchApp({ args: [base()], env: FR });
  try {
    const row = (i: number) => page.getByTestId(`form-row-${i}`);
    await page.getByTestId('nav-item-form-Liste').dblclick();
    await expect(row(1).getByTestId('form-ctl-Nom')).toHaveValue('Martin');
    await row(1).getByTestId('form-ctl-Étiquette').click({ button: 'right' });   // no click follows a right press
    await page.getByTestId('form-run').locator(':scope > .recnav').getByRole('button', { name: fr.datasheet.nav.next }).click();
    await expect(row(1)).toHaveAttribute('data-current', 'true');
    await row(1).getByTestId('form-ctl-Actif').click();
    await expect(row(1).getByTestId('form-ctl-Actif')).toBeChecked();
    await page.keyboard.press('Shift+Enter');   // saved
    await expect.poll(async () => (await rows(page, 'Clients'))[1][2]).toBe(1);
  } finally {
    await app.close();
  }
});

test('Shift+F9 on the master reads the subform again; a filter in the subform is toggled from the ribbon, the master unfiltered', async () => {
  const { app, page } = await launchApp({ args: [base()], env: FR });
  try {
    const s = sub(page);
    const m = master(page);
    await page.getByTestId('nav-item-form-Fiche client').dblclick();
    await expect(s.cell(1, 0)).toHaveText('10');
    // changed elsewhere: Shift+F9 on the master (same record, same link values) shows it
    expect(await page.evaluate(() => (window as unknown as { basecraft: BasecraftApi }).basecraft.rows.update('Commandes', 1, { Montant: 11 }))).toMatchObject({ ok: true });
    await page.getByTestId('form-ctl-Nom').click();
    await page.keyboard.press('Shift+F9');
    await expect(s.cell(1, 0)).toHaveText('11');

    // Filter by Selection in the subform, then Toggle Filter (the master has none)
    await page.getByTestId('ribbon-tab-home').click();
    await s.click(1, 1);
    await page.getByTestId('cmd-filterSelection').click();
    await page.getByTestId('filter-menu-equals').click();
    await expect(s.count).toHaveText('1');
    await expect(page.getByTestId('cmd-filterToggle')).toBeEnabled();
    await page.getByTestId('cmd-filterToggle').click();
    await expect(s.count).toHaveText('2');
    await expect(m.count).toHaveText('3');
    // back in the master: its own state (no filter)
    await page.getByTestId('form-ctl-Nom').click();
    await expect(page.getByTestId('cmd-filterToggle')).toBeDisabled();
  } finally {
    await app.close();
  }
});

test('a subform on a tab page: another page is refused while its row cannot be saved, the entry kept; once undone, it changes', async () => {
  const { app, page } = await launchApp({ args: [base()], env: FR });
  try {
    const s = sub(page);
    await page.getByTestId('nav-item-form-Onglets client').dblclick();
    await expect(s.count).toHaveText('2');
    await s.click(1, 2);
    await s.type('-5');
    await page.getByTestId('form-tab-Pages-1').click();
    await expect(page.getByTestId('modal')).toContainText('Montant positif');
    await page.getByTestId('modal-btn-ok').click();
    await expect(page.getByTestId('form-tab-Pages-0')).toHaveAttribute('aria-selected', 'true');
    await expect(s.cell(1, 2)).toHaveText('-5');
    await expect(s.cell(1, 2)).toBeFocused();
    expect(await rows(page, 'Commandes')).toHaveLength(2);
    await page.keyboard.press('Escape');
    await page.keyboard.press('Escape');
    await page.getByTestId('form-tab-Pages-1').click();
    await expect(page.getByTestId('form-tab-Pages-1')).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByTestId('form-ctl-Note')).toBeVisible();
    await expect(s.frame).toHaveCount(0);
  } finally {
    await app.close();
  }
});

test('a parameterized source (A3): asked once when the form opens, again on Shift+F9 (Cancel keeps the records); Cancel on opening closes the tab; a subform asks once, not on each master record, and again on the master Shift+F9 (Cancel keeps its rows)', async () => {
  const P = 'Saisir le client :', M = 'À partir du N° :';
  const onQuery = (doc: DesignDoc): DesignDoc => ({ ...doc, recordSource: { kind: 'query', name: 'Commandes du client' } });
  const b = seedBase('fx-parametres', (db) => {
    createTable(db, clients);
    createTable(db, commandes);
    db.exec(`INSERT INTO "Clients"("Nom", "Actif") VALUES ('Dupont', 0), ('Martin', 0)`);
    db.exec(`INSERT INTO "Commandes"("Client", "Montant") VALUES (1, 10), (1, 20), (2, 30), (2, 40), (2, 50)`);
    const r = saveObject(db, 'query', 'Commandes du client', { formatVersion: '1.0', sql: `PARAMETERS [${P}] Long; SELECT * FROM Commandes WHERE Client = [${P}];` }, null);
    if (!r.ok) throw new Error(r.reason);
    const m = saveObject(db, 'query', 'Clients à partir de', { formatVersion: '1.0', sql: `PARAMETERS [${M}] Long; SELECT * FROM Clients WHERE [N°] >= [${M}];` }, null);
    if (!m.ok) throw new Error(m.reason);
    seedForm(db, 'Par client', onQuery(formOf('Commandes', [box('textBox', 'Montant', 1800, 100, { ControlSource: 'Montant', TabIndex: 0 })])));
    seedForm(db, 'Saisie paramétrée', onQuery(saisie));
    seedForm(db, 'Fiche paramétrée', { ...fiche('Saisie paramétrée', { LinkMasterFields: 'N°', LinkChildFields: 'Client' }), recordSource: { kind: 'query', name: 'Clients à partir de' } });
  });
  const { app, page } = await launchApp({ args: [b], env: FR });
  const modal = page.getByTestId('modal');
  /** The prompt for `name` answered with `v` (null: Cancel). */
  const answer = async (v: string | null, name = P) => {
    await expect(modal).toContainText(name);
    if (v === null) await page.keyboard.press('Escape');
    else { await page.getByTestId('modal-input').fill(v); await page.getByTestId('modal-btn-ok').click(); }
    await expect(modal.filter({ hasText: name })).toHaveCount(0);
  };
  try {
    const m = master(page);
    await page.getByTestId('nav-item-form-Par client').dblclick();
    await expect(modal).toContainText(fr.query.param.title);
    await answer('2');
    await expect(page.getByTestId('form-ctl-Montant')).toHaveValue('30');
    await expect(m.count).toHaveText('3');
    await m.button('next').click();
    await expect(page.getByTestId('form-ctl-Montant')).toHaveValue('40');
    await expect(modal).toHaveCount(0);   // never asked again for another record
    // Shift+F9 (Access's order): the record being edited saved first, then the parameters asked again; Cancel keeps the
    // records where they are, new values read them from the start
    await page.getByTestId('form-ctl-Montant').fill('41');
    await page.keyboard.press('Shift+F9');
    await expect(modal).toContainText(P);
    expect((await rows(page, 'Commandes'))[3]).toEqual([4, 2, 41]);
    await page.keyboard.press('Escape');
    await expect(modal).toHaveCount(0);
    await expect(page.getByTestId('form-ctl-Montant')).toHaveValue('41');
    await expect(page.getByTestId('doc-tab-form-Par client')).not.toContainText('•');
    await expect(m.count).toHaveText('3');
    await page.keyboard.press('Shift+F9');
    await answer('1');
    await expect(m.count).toHaveText('2');
    await expect(page.getByTestId('form-ctl-Montant')).toHaveValue('10');
    // closed, opened again, Cancel: the tab closes, with no error
    await page.getByTestId('doc-tab-close-form-Par client').click();
    await expect(page.getByTestId('doc-tab-form-Par client')).toHaveCount(0);
    await page.getByTestId('nav-item-form-Par client').dblclick();
    await expect(page.getByTestId('modal-input')).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(modal).toHaveCount(0);
    await expect(page.getByTestId('doc-tab-form-Par client')).toHaveCount(0);

    // a master and its subform on parameterized queries: each asks once at opening, the master first; the subform declined
    // shows an empty frame with no additions
    const s = sub(page);
    const nom = page.getByTestId('form-ctl-Nom');
    const requery = async (master: string, subform: string | null) => {
      await nom.click();
      await page.keyboard.press('Shift+F9');
      await answer(master, M);
      await answer(subform, P);
      await expect(modal).toHaveCount(0);
    };
    await page.getByTestId('nav-item-form-Fiche paramétrée').dblclick();
    await answer('1', M);
    await answer(null, P);
    await expect(nom).toHaveValue('Dupont');
    await expect(s.count).toHaveText('0');
    await expect(s.add).toBeDisabled();
    // Shift+F9 on the master: the master asks, then its subform (declined before: asked again)
    await requery('1', '1');
    await expect(nom).toHaveValue('Dupont');
    await expect(s.count).toHaveText('2');
    await expect(s.cell(1, 0)).toHaveText('10');
    // Cancel on the subform keeps its rows
    await requery('1', null);
    await expect(s.count).toHaveText('2');
    // another master record: never asked again
    await m.button('next').click();
    await expect(nom).toHaveValue('Martin');
    await expect(s.count).toHaveText('0');
    await expect(modal).toHaveCount(0);
    // the master read again on another record (Dupont): the subform's new values are asked before it follows it
    await requery('1', '2');
    await expect(nom).toHaveValue('Dupont');
    await expect(s.count).toHaveText('0');
    await m.button('next').click();
    await expect(nom).toHaveValue('Martin');
    await expect(s.count).toHaveText('3');
    await expect(s.cell(1, 0)).toHaveText('30');
    await expect(modal).toHaveCount(0);
  } finally {
    await app.close();
  }
});

test('two master moves while the subform reads slowly: the first read, overtaken, is not a refusal; a key typed in the subform then neither saves nor moves', async () => {
  const { app, page } = await launchApp({ args: [base()], env: FR });
  // the subform's pages (source Commandes) held 800 ms in the main process; the master's (Clients) are read at once
  const slowOrders = (on: boolean) => app.evaluate(({ ipcMain }, slow) => {
    const handlers = (ipcMain as unknown as { _invokeHandlers: Map<string, (...a: unknown[]) => unknown> })._invokeHandlers;
    const g = globalThis as unknown as { realPage?: (...a: unknown[]) => unknown };
    g.realPage ??= handlers.get('bc:sources:page');
    const real = g.realPage!;
    handlers.set('bc:sources:page', slow ? async (...a: unknown[]) => {
      if ((a[1] as { name?: string }).name === 'Commandes') await new Promise((r) => setTimeout(r, 800));
      return real(...a);
    } : real);
  }, on);
  try {
    await page.evaluate(async () => {
      const bc = (window as unknown as { basecraft: BasecraftApi }).basecraft;
      await bc.rows.insert('Commandes', { Client: 3, Montant: 30 });
      await bc.rows.insert('Commandes', { Client: 3, Montant: 40 });
    });
    const m = master(page);
    const frame = page.getByTestId('form-ctl-Commandes');
    const montant = frame.getByTestId('form-ctl-Montant');
    const at = frame.getByTestId('nav-record-input');
    await page.getByTestId('nav-item-form-Fiche simple').dblclick();
    await expect(montant).toHaveValue('10');
    await slowOrders(true);
    await m.button('next').click();
    await m.button('next').click();   // the first link read still under way: overtaken
    await expect(page.getByTestId('form-ctl-Nom')).toHaveValue('Bernard');
    await expect(montant).toHaveValue('30');
    await slowOrders(false);
    // the subform's second record, one key typed: still on it, nothing saved
    await frame.getByRole('button', { name: fr.datasheet.nav.next }).click();
    await expect(montant).toHaveValue('40');
    await montant.click();
    await page.keyboard.press('End');
    await page.keyboard.type('5');
    await expect(montant).toHaveValue('405');
    await page.evaluate(() => new Promise((r) => setTimeout(r, 300)));
    await expect(montant).toHaveValue('405');
    await expect(montant).toBeFocused();
    await expect(at).toHaveValue('2');
    expect((await rows(page, 'Commandes')).map((r) => r[2])).toEqual([10, 20, 30, 40]);
  } finally {
    await app.close();
  }
});

test("a subform's new record shows the master's link value at once (Access), saved with it", async () => {
  const { app, page } = await launchApp({ args: [base()], env: FR });
  try {
    const frame = page.getByTestId('form-ctl-Commandes');
    await page.getByTestId('nav-item-form-Fiche simple').dblclick();
    await expect(frame.getByTestId('form-ctl-Client')).toHaveValue('1');
    await master(page).button('next').click();
    await expect(page.getByTestId('form-ctl-Nom')).toHaveValue('Martin');
    await expect(frame.getByTestId('form-ctl-Client')).toHaveValue('2');   // no orders: its new record
    await frame.getByTestId('form-ctl-Montant').fill('5');
    await expect(frame.getByTestId('form-ctl-Client')).toHaveValue('2');
    await page.getByTestId('form-ctl-Nom').click();
    await expect.poll(async () => (await rows(page, 'Commandes')).at(-1)).toEqual([3, 2, 5]);
  } finally {
    await app.close();
  }
});
