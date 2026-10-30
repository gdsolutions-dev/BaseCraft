import { test, expect, type Page } from '@playwright/test';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, renameSync, rmSync } from 'node:fs';
import { hostname, tmpdir, userInfo } from 'node:os';
import { dirname, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createTable } from '../../src/main/db/schema';
import { addLinks } from '../../src/main/links/store';
import { seedSales, seedSalesRelation } from '../../src/main/query/test-db';
import { f, t } from '../../src/shared/test-fixtures';
import { inFile, launchApp, seedBase } from './helpers';

const fr = JSON.parse(readFileSync(join(__dirname, '../../src/shared/i18n/fr.json'), 'utf8'));
// DatasheetView: row selector width, header and row heights.
const MARKER = 44, HEADER = 34, ROW = 30;

const cell = (page: Page, col: number, row: number) => page.getByTestId(`glide-cell-${col + 1}-${row}`);
const cellEditor = (page: Page) => page.getByTestId('grid-editor-portal').locator('textarea');
/** Selects cell (col, row): a click on the row's first cell, then the arrows. */
async function selectCell(page: Page, col: number, row: number) {
  const b = (await page.getByTestId('datasheet').getByTestId('data-grid-canvas').boundingBox())!;
  await page.mouse.click(b.x + MARKER + 20, b.y + HEADER + row * ROW + ROW / 2);
  await expect(cell(page, 0, row)).toBeFocused();
  for (let i = 0; i < col; i++) await page.keyboard.press('ArrowRight');
  await expect(cell(page, col, row)).toBeFocused();
}
async function typeIntoCell(page: Page, text: string) {
  await page.keyboard.press(text[0]!);
  await expect(cellEditor(page)).toBeFocused();
  await page.keyboard.type(text.slice(1));
}
async function openSheet(page: Page, name: string) {
  await page.getByTestId(`nav-item-${name}`).dblclick();
  await expect(page.getByTestId('datasheet').getByTestId('data-grid-canvas')).toBeVisible();
}

test('C1: link tables of a BaseCraft file, edit them, a read-only Design view, Convert to Local Table, delete a link', async () => {
  const data = seedBase('Ventes-donnees', (db) => { seedSales(db); seedSalesRelation(db); });
  const front = seedBase('Ventes', (db) => createTable(db, t('Notes', [f('N°', 'autoNumber'), f('Texte', 'shortText')])));
  const { app, page } = await launchApp({ args: [front], env: { BASECRAFT_REGION: 'fr-FR', BASECRAFT_E2E_LINK_PATH: data } });
  try {
    // 1. External Data › BaseCraft or SQLite Database: the file's tables, both linked
    await page.getByTestId('ribbon-tab-externalData').click();
    await expect(page.getByTestId('cmd-linkBaseCraft')).toHaveText(fr.ribbon.cmd.linkBaseCraft);
    await page.getByTestId('cmd-linkBaseCraft').click();
    await expect(page.getByTestId('link-dialog')).toBeVisible();
    await expect(page.getByTestId('link-path')).toHaveText(fr.link.source.replace('{{path}}', data));
    await expect(page.getByTestId('link-kind')).toHaveText(fr.link.kind.basecraft);
    await expect(page.getByTestId('link-ok')).toBeDisabled();
    await page.getByTestId('link-table-Clients').check();
    await page.getByTestId('link-table-Commandes').check();
    await page.getByTestId('link-ok').click();
    await expect(page.getByTestId('link-dialog')).toHaveCount(0);
    await expect(page.getByTestId('nav-item-link-Clients')).toBeVisible();
    await expect(page.getByTestId('nav-item-link-Commandes')).toBeVisible();
    await expect(page.getByTestId('nav-item-link-Notes')).toHaveCount(0); // a local table keeps its icon

    // the Relationships window: local tables only (R11)
    await page.getByTestId('ribbon-tab-databaseTools').click();
    await page.getByTestId('cmd-relationships').click();
    await expect(page.getByTestId('addtables-dialog')).toBeVisible();
    await expect(page.getByTestId('addtables-item-Notes')).toBeVisible();
    await expect(page.getByTestId('addtables-item-Clients')).toHaveCount(0);
    await page.getByTestId('addtables-close').click();
    await page.getByTestId('doc-tab-close-window-relations').click();

    // 2. a link's rows are its file's, and a change is written there
    await openSheet(page, 'Clients');
    await expect(page.getByTestId('nav-record-count')).toHaveText('4');
    await expect(cell(page, 1, 2)).toHaveText('Durand');
    await selectCell(page, 2, 2);
    await typeIntoCell(page, 'Marseille');
    await page.keyboard.press('Enter');
    await expect(cellEditor(page)).toHaveCount(0);
    await expect(page.getByTestId('doc-tab-Clients')).not.toContainText('•');
    await expect.poll(() => inFile<{ Ville: string }>(data, `SELECT "Ville" FROM "Clients" WHERE "Nom" = 'Durand'`), { timeout: 5000 }).toEqual([{ Ville: 'Marseille' }]);

    // 4. no Rename on a link; its Design view (as Access): a warning, then read-only (C1 R8)
    const warning = fr.link.designWarning.replace('{{name}}', 'Clients');
    await page.getByTestId('nav-item-Clients').click({ button: 'right' });
    await expect(page.getByTestId('nav-menu-refreshLink')).toBeVisible();
    await expect(page.getByTestId('nav-menu-rename')).toHaveCount(0);
    await expect(page.getByTestId('nav-menu-copy')).toHaveCount(0);
    await page.getByTestId('nav-menu-design').click();
    await expect(page.getByTestId('modal')).toContainText(warning);
    await expect(page.getByTestId('modal-btn-yes')).toBeFocused(); // Access's default
    await page.getByTestId('modal-btn-no').click(); // No: the Datasheet stays
    await expect(page.getByTestId('modal')).toHaveCount(0);
    await expect(page.getByTestId('datasheet')).toBeVisible();
    await expect(page.getByTestId('ribbon-tab-design')).toHaveCount(0);
    await page.getByTestId('ribbon-tab-home').click();
    await page.getByTestId('cmd-viewDesign').click();
    await expect(page.getByTestId('modal')).toContainText(warning);
    await page.getByTestId('modal-btn-yes').click();
    await expect(page.getByTestId('design-link-banner')).toHaveText(fr.link.designBanner.replace('{{path}}', data));
    await expect(page.getByTestId('design-row-0-name')).toHaveValue('N°'); // the source's fields
    await expect(page.getByTestId('design-row-1-name')).toHaveValue('Nom');
    await expect(page.getByTestId('design-row-2-name')).toHaveValue('Ville');
    await expect(page.getByTestId('design-row-3-name')).toHaveCount(0); // no empty row to add a field
    for (const id of ['design-row-1-name', 'design-row-1-type', 'design-row-1-desc', 'prop-caption']) await expect(page.getByTestId(id), id).toBeDisabled();
    await page.getByTestId('ribbon-tab-home').click();
    await expect(page.getByTestId('cmd-save')).toBeDisabled();
    await page.getByTestId('ribbon-tab-design').click();
    for (const id of ['cmd-primaryKey', 'cmd-insertRows', 'cmd-deleteRows', 'cmd-testValidationRules']) await expect(page.getByTestId(id), id).toBeDisabled();
    await expect(page.getByTestId('cmd-indexes')).toBeEnabled(); // shown, not editable
    // a short window, the splitter at its lowest: the Field Properties keep their minimum under the banner (PROPS_MIN 128)
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setSize(1280, 720));
    await page.getByTestId('design-splitter').focus();
    await page.keyboard.press('End');
    const room = async () => {
      const [pane, props] = [(await page.locator('.tdesign').boundingBox())!, (await page.locator('.fprops').boundingBox())!];
      return { props: Math.round(props.height), overflow: Math.round(props.y + props.height - (pane.y + pane.height)) };
    };
    await expect.poll(async () => (await room()).props).toBeGreaterThanOrEqual(127);
    expect((await room()).overflow).toBeLessThanOrEqual(1);
    await page.getByTestId('status-view-datasheet').click(); // back to its rows
    await expect(page.getByTestId('datasheet')).toBeVisible();
    await expect(page.getByTestId('design-link-banner')).toHaveCount(0);

    // Refresh Link: « Lien actualisé. »
    await page.getByTestId('nav-item-Clients').click({ button: 'right' });
    await page.getByTestId('nav-menu-refreshLink').click();
    await expect(page.getByTestId('modal')).toContainText(fr.link.refreshed);
    await page.getByTestId('modal-btn-ok').click();

    // 7. Properties of a link name its file
    await page.getByTestId('nav-item-Clients').click({ button: 'right' });
    await page.getByTestId('nav-menu-properties').click();
    await expect(page.getByTestId('object-properties-source')).toHaveText(fr.link.source.replace('{{path}}', realpathSync.native(data)));
    await page.getByTestId('object-properties-cancel').click();
    await page.getByTestId('doc-tab-close-Clients').click();

    // 3. the file's field rule holds: Montant 0 refused, the row stays pending; Escape cancels it
    await openSheet(page, 'Commandes');
    await expect(page.getByTestId('nav-record-count')).toHaveText('5');
    await selectCell(page, 2, 0);
    await typeIntoCell(page, '0');
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('modal')).toContainText('Montant');
    await page.getByTestId('modal-btn-ok').click();
    await expect(page.getByTestId('datasheet-error')).toContainText('Montant');
    await expect(page.getByTestId('doc-tab-Commandes')).toContainText('•');
    // Convert with that row pending: the datasheet has its say first (save tried, discard asked); No keeps the row and the link
    await page.getByTestId('nav-item-Commandes').click({ button: 'right' });
    await page.getByTestId('nav-menu-convertToLocal').click();
    await page.getByTestId('modal-btn-yes').click();
    await expect(page.getByTestId('modal')).toContainText('Montant'); // the save tried first
    await page.getByTestId('modal-btn-ok').click();
    await expect(page.getByTestId('modal')).toContainText(fr.datasheet.discard.replace('{{name}}', 'Commandes'));
    await page.getByTestId('modal-btn-no').click();
    await expect(page.getByTestId('modal')).toHaveCount(0);
    await expect(page.getByTestId('nav-item-link-Commandes')).toBeVisible();
    await expect(page.getByTestId('doc-tab-Commandes')).toContainText('•');
    await selectCell(page, 2, 0);
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('doc-tab-Commandes')).not.toContainText('•');

    // 5. Convert to Local Table: its documents closed, the table local with its 5 rows; the file keeps its own
    await page.getByTestId('nav-item-Commandes').click({ button: 'right' });
    await page.getByTestId('nav-menu-convertToLocal').click();
    await expect(page.getByTestId('modal')).toContainText(fr.link.confirmConvert.replace('{{name}}', 'Commandes'));
    await page.getByTestId('modal-btn-yes').click();
    await expect(page.getByTestId('doc-tab-Commandes')).toHaveCount(0);
    await expect(page.getByTestId('nav-item-link-Commandes')).toHaveCount(0);
    await expect(page.getByTestId('nav-item-Commandes')).toBeVisible();
    await openSheet(page, 'Commandes');
    await expect(page.getByTestId('nav-record-count')).toHaveText('5');
    expect(inFile<{ n: number }>(data, 'SELECT count(*) AS n FROM "Commandes"')).toEqual([{ n: 5 }]);

    // 6. Delete on a link removes the link only
    await page.getByTestId('nav-item-Clients').click({ button: 'right' });
    await page.getByTestId('nav-menu-delete').click();
    await expect(page.getByTestId('modal')).toContainText(fr.link.confirmDelete.replace('{{name}}', 'Clients').replace('{{path}}', realpathSync.native(data)));
    await page.getByTestId('modal-btn-yes').click();
    await expect(page.getByTestId('nav-item-Clients')).toHaveCount(0);
    expect(inFile<{ n: number }>(data, 'SELECT count(*) AS n FROM "Clients"')).toEqual([{ n: 4 }]);
  } finally {
    await app.close();
  }
});

test('C1: a SQLite WITHOUT ROWID table links read-only — its rows, no new record (R7)', async () => {
  const plain = join(mkdtempSync(join(tmpdir(), 'basecraft-seed-')), 'mesures.sqlite');
  const raw = new DatabaseSync(plain);
  raw.exec("CREATE TABLE W (k TEXT PRIMARY KEY, v INTEGER) WITHOUT ROWID; INSERT INTO W VALUES ('a', 1), ('b', 2);");
  raw.close();
  const front = seedBase('Mesures');
  const { app, page } = await launchApp({ args: [front], env: { BASECRAFT_REGION: 'fr-FR', BASECRAFT_E2E_LINK_PATH: plain } });
  try {
    await page.getByTestId('ribbon-tab-externalData').click();
    await page.getByTestId('cmd-linkBaseCraft').click();
    await expect(page.getByTestId('link-kind')).toHaveText(fr.link.kind.sqlite);
    await page.getByTestId('link-select-all').click();
    await page.getByTestId('link-ok').click();
    await expect(page.getByTestId('nav-item-link-W')).toBeVisible();
    await openSheet(page, 'W');
    await expect(page.getByTestId('nav-record-count')).toHaveText('2');
    await expect(cell(page, 0, 1)).toHaveText('b');
    await expect(page.getByTestId('nav-new')).toBeDisabled();
    await expect(page.getByTestId('nav-readonly')).toHaveText(fr.query.readOnly);
  } finally {
    await app.close();
  }
});

// R9, R5, R4 (Review Focus 1 and 2): the Linked Table Manager relinks a moved file, refuses a file without the table, shows a
// file held by another session; a front-end moved with its data file finds it again by its relative path.
test('C1: Linked Table Manager — a moved data file relinked, a file without the table refused, a held file shown, a folder moved whole', async () => {
  test.setTimeout(120_000); // four launches
  const front = seedBase('Ventes', (db) => createTable(db, t('Notes', [f('N°', 'autoNumber'), f('Texte', 'shortText')])));
  const dir = dirname(front);
  const data = join(dir, 'Ventes-donnees.basecraft');
  copyFileSync(seedBase('Ventes-donnees', (db) => { seedSales(db); seedSalesRelation(db); }), data);
  const noCommandes = seedBase('Sans-commandes', (db) => { seedSales(db); db.exec('DROP TABLE "Commandes"'); });
  const linkMenu = async (page: Page, name: string, item: string) => {
    await page.getByTestId(`nav-item-${name}`).click({ button: 'right' });
    await page.getByTestId(`nav-menu-${item}`).click();
  };
  const FR = { BASECRAFT_REGION: 'fr-FR' };

  // 1. Clients and Commandes linked, the app closed, the data file moved to archive/
  const oldPath = realpathSync.native(data);
  let { app, page } = await launchApp({ args: [front], env: { ...FR, BASECRAFT_E2E_LINK_PATH: data } });
  try {
    await page.getByTestId('ribbon-tab-externalData').click();
    await page.getByTestId('cmd-linkBaseCraft').click();
    await page.getByTestId('link-table-Clients').check();
    await page.getByTestId('link-table-Commandes').check();
    await page.getByTestId('link-ok').click();
    await expect(page.getByTestId('nav-item-link-Commandes')).toBeVisible();
  } finally {
    await app.close();
  }
  mkdirSync(join(dir, 'archive'));
  const moved = join(dir, 'archive', 'Ventes-donnees.basecraft');
  renameSync(data, moved);
  const movedPath = realpathSync.native(moved);

  ({ app, page } = await launchApp({ args: [front], env: { ...FR, BASECRAFT_E2E_LINK_PATH: moved } }));
  try {
    // 2. the moved file's link names the old path (Review Focus 1)
    await page.getByTestId('nav-item-Clients').dblclick();
    await expect(page.getByTestId('modal')).toContainText(fr.dialog.error.linkUnavailable_missingFile.replace('{{detail}}', oldPath));
    await page.getByTestId('modal-btn-ok').click();
    await expect(page.getByTestId('modal')).toHaveCount(0);
    // its Design view says the same, after the warning, and opens nothing (C1 R8)
    await page.getByTestId('nav-item-Clients').click({ button: 'right' });
    await page.getByTestId('nav-menu-design').click();
    await expect(page.getByTestId('modal')).toContainText(fr.link.designWarning.replace('{{name}}', 'Clients'));
    await page.getByTestId('modal-btn-yes').click();
    await expect(page.getByTestId('modal')).toContainText(fr.dialog.error.linkUnavailable_missingFile.replace('{{detail}}', oldPath));
    await page.getByTestId('modal-btn-ok').click();
    await expect(page.getByTestId('modal')).toHaveCount(0);
    await expect(page.getByTestId('ribbon-tab-design')).toHaveCount(0);

    // 3. the manager from the ribbon: both missing; Select All, Change Source → both OK, at the new path
    await page.getByTestId('ribbon-tab-externalData').click();
    await expect(page.getByTestId('cmd-linkedTableManager')).toHaveText(fr.ribbon.cmd.linkedTableManager);
    await page.getByTestId('cmd-linkedTableManager').click();
    await expect(page.getByTestId('ltm-dialog')).toBeVisible();
    for (const n of ['Clients', 'Commandes']) {
      await expect(page.getByTestId(`ltm-state-${n}`)).toHaveText(fr.ltm.state.missingFile);
      await expect(page.getByTestId(`ltm-check-${n}`)).not.toBeChecked();
    }
    await expect(page.getByTestId('ltm-relink')).toBeDisabled();
    await page.getByTestId('ltm-select-all').click();
    await page.getByTestId('ltm-relink').click();
    for (const n of ['Clients', 'Commandes']) {
      await expect(page.getByTestId(`ltm-state-${n}`)).toHaveText(fr.ltm.state.ok);
      await expect(page.getByTestId(`ltm-path-${n}`)).toHaveText(movedPath);
    }
    await page.getByTestId('ltm-close').click();
    await expect(page.getByTestId('ltm-dialog')).toHaveCount(0);
    await openSheet(page, 'Clients');
    await expect(page.getByTestId('nav-record-count')).toHaveText('4');

    // 4. from Commandes' menu (Commandes ticked): a file without Commandes is refused, nothing changed
    await app.evaluate((_e, p) => { process.env.BASECRAFT_E2E_LINK_PATH = p; }, noCommandes);
    await linkMenu(page, 'Commandes', 'linkedTableManager');
    await expect(page.getByTestId('ltm-check-Commandes')).toBeChecked();
    await expect(page.getByTestId('ltm-check-Clients')).not.toBeChecked();
    await page.getByTestId('ltm-relink').click();
    await expect(page.getByTestId('ltm-error')).toHaveText(fr.ltm.missingTables.replace('{{names}}', 'Commandes'));
    await expect(page.getByTestId('ltm-path-Commandes')).toHaveText(movedPath);
    await page.getByTestId('ltm-close').click();

    // 5. a second instance opens the front-end read-only (its lock held): the link's datasheet is read-only
    const second = await launchApp({ args: [front], env: FR });
    try {
      await openSheet(second.page, 'Clients');
      await expect(second.page.getByTestId('nav-record-count')).toHaveText('4');
      await expect(second.page.getByTestId('nav-new')).toBeDisabled();
    } finally {
      await second.app.close();
    }
    // another front-end linking the same data file, opened while the first instance writes it: « Lecture seule : ouvert par … » (Review Focus 2)
    const other = seedBase('Autre');
    const raw = new DatabaseSync(other);
    try { addLinks(raw, other, 'basecraft', moved, ['Clients']); } finally { raw.close(); }
    const third = await launchApp({ args: [other], env: FR });
    try {
      await third.page.getByTestId('ribbon-tab-externalData').click();
      await third.page.getByTestId('cmd-linkedTableManager').click();
      await expect(third.page.getByTestId('ltm-state-Clients'))
        .toHaveText(fr.ltm.state.readOnly.replace('{{user}}', userInfo().username).replace('{{host}}', hostname()));
    } finally {
      await third.app.close();
    }
  } finally {
    await app.close();
  }

  // 6. the front-end and its data file copied together to a new folder: the link follows its relative path (R5)
  const archive2 = join(mkdtempSync(join(tmpdir(), 'basecraft-archive2-')), 'archive2');
  mkdirSync(join(archive2, 'archive'), { recursive: true });
  copyFileSync(front, join(archive2, 'Ventes.basecraft'));
  copyFileSync(moved, join(archive2, 'archive', 'Ventes-donnees.basecraft'));
  rmSync(moved); // the absolute path no longer leads anywhere
  ({ app, page } = await launchApp({ args: [join(archive2, 'Ventes.basecraft')], env: FR }));
  try {
    await openSheet(page, 'Clients');
    await expect(page.getByTestId('nav-record-count')).toHaveText('4');
    await expect(page.getByTestId('modal')).toHaveCount(0);
  } finally {
    await app.close();
  }
});
