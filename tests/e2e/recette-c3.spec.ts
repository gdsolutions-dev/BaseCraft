// Recette du lot C3 (base fractionnée et fichier de données partagé). Deux postes simulés par deux instances sur une machine, dans un
// dossier local (share/ compté comme un partage pour la copie du Runtime seulement : BASECRAFT_E2E_NETWORK_DIR) ; le passage sur deux
// vraies machines et un vrai partage est la validation manuelle du propriétaire (plan C3, tâche 11, étape 5).
// A (application complète) fractionne share/Ventes.basecraft ; B (Runtime) ouvre l'application frontale du partage depuis sa copie
// locale ; chacun voit les enregistrements de l'autre après l'intervalle d'actualisation (1 s) ; un même enregistrement modifié des deux
// côtés donne la boîte Conflit d'écriture (chaque choix) ; un champ ajouté est refusé tant que B est connecté ; des écritures
// concurrentes scriptées finissent avec integrity_check = ok.
import { test, expect, type Page } from '@playwright/test';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { hostname, tmpdir, userInfo } from 'node:os';
import { dirname, join } from 'node:path';
import type { BasecraftApi } from '../../src/shared/api';
import type { ControlDef, DesignDoc } from '../../src/shared/design/model';
import { seedSales, seedSalesRelation } from '../../src/main/query/test-db';
import { inFile, launchApp, seedBase, seedForm } from './helpers';

type Win = { basecraft: BasecraftApi };
const fr = JSON.parse(readFileSync(join(__dirname, '../../src/shared/i18n/fr.json'), 'utf8'));
const SPIKE = join(__dirname, '../../scripts/smb-spike.mjs');
// DatasheetView: row selector, header and row heights; N° (AutoNumber) 80 px, Nom and Ville (short text) 170.
const MARKER = 44, HEADER = 34, ROW = 30, AUTONUMBER = 80, TEXT = 170;

const box = (name: string, top: number, i: number): ControlDef =>
  ({ kind: 'textBox', name, left: 1701, top, width: 2268, height: 340, props: { ControlSource: name, TabIndex: i } });
const FCLIENTS: DesignDoc = {
  formatVersion: '1.0', recordSource: { kind: 'table', name: 'Clients' }, props: { Width: 9072 },
  sections: [{ kind: 'formHeader', height: 0, props: { Visible: false }, controls: [] },
    { kind: 'detail', height: 2268, props: {}, controls: [box('Nom', 100, 0), box('Ville', 600, 1)] },
    { kind: 'formFooter', height: 0, props: { Visible: false }, controls: [] }],
};

/** A workstation's user data, the refresh interval at 1 s. */
function workstation(): string {
  const d = mkdtempSync(join(tmpdir(), 'basecraft-'));
  writeFileSync(join(d, 'settings.json'), JSON.stringify({ refreshInterval: 1 }));
  return d;
}

const sheet = (page: Page) => page.getByTestId('datasheet').filter({ visible: true });
const cell = (page: Page, col: number, row: number) => sheet(page).getByTestId(`glide-cell-${col + 1}-${row}`);
const count = (page: Page) => page.getByTestId('nav-record-count').filter({ visible: true });
const cellEditor = (page: Page) => page.getByTestId('grid-editor-portal').locator('textarea');
const dirty = (page: Page) => page.getByTestId('doc-tab-Clients');
const at = async (page: Page, col: 1 | 2, row: number) => {
  const b = (await sheet(page).getByTestId('data-grid-canvas').boundingBox())!;
  await page.mouse.click(b.x + MARKER + AUTONUMBER + (col - 1) * TEXT + 30, b.y + HEADER + row * ROW + ROW / 2);
};
/** A new record typed in the trailing row (`row`), Nom then Ville; Enter leaves the row: saved. */
async function addRecord(page: Page, row: number, nom: string, ville: string) {
  await at(page, 1, row);
  await expect(cellEditor(page)).toBeFocused();
  await page.keyboard.type(nom);
  await page.keyboard.press('Tab');
  await expect(cellEditor(page)).toHaveCount(0);
  await expect(cell(page, 2, row)).toBeFocused();
  await page.keyboard.press(ville[0]!);
  await expect(cellEditor(page)).toBeFocused();
  await page.keyboard.type(ville.slice(1));
  await page.keyboard.press('Enter');
  await expect(dirty(page)).not.toContainText('•');
}
/** Types in a Ville cell. `leave`: Enter, the next row (saved); else Shift+Tab, the row stays pending. */
async function typeVille(page: Page, row: number, text: string, leave: boolean) {
  await at(page, 2, row);
  await expect(cell(page, 2, row)).toBeFocused();
  await page.keyboard.press(text[0]!);
  await page.keyboard.type(text.slice(1));
  await page.keyboard.press(leave ? 'Enter' : 'Shift+Tab');
  await expect(dirty(page)).toHaveText(leave ? /^[^•]*$/ : /•/);
}

test('C3 acceptance: split, two workstations on one data file, write conflicts, structure refused, concurrent writes', async () => {
  test.setTimeout(240_000);
  const front = seedBase('Ventes', (db) => { seedSales(db); seedSalesRelation(db); seedForm(db, 'FClients', FCLIENTS); });
  const share = dirname(front); // the seed's folder: the share
  const data = join(share, 'Ventes_donnees.basecraft');
  const villes = () => inFile<{ Nom: string; Ville: string }>(data, 'SELECT "Nom", "Ville" FROM "Clients" ORDER BY "N°"');
  const durand = () => villes()[2]?.Ville;
  const ENV = { BASECRAFT_REGION: 'fr-FR', BASECRAFT_E2E_SETTLE_MS: '0' };

  // 1. Split: Database Tools › Split Database moves the tables to share/Ventes_donnees.basecraft; the base becomes its front-end
  const a = await launchApp({ args: [front], userDataDir: workstation(),
    env: { ...ENV, BASECRAFT_E2E_SAVE_PATH: data, BASECRAFT_E2E_OPEN_PATH: data } });
  let b: Awaited<ReturnType<typeof launchApp>> | null = null;
  try {
    await a.page.getByTestId('ribbon-tab-databaseTools').click();
    await a.page.getByTestId('cmd-splitDatabase').click();
    await expect(a.page.getByTestId('split-dialog')).toContainText(fr.split.intro);
    await a.page.getByTestId('split-ok').click();
    await expect(a.page.getByTestId('modal')).toContainText(fr.split.done.split(' : {{path}}')[0]);
    const backups = readdirSync(share).filter((x) => x.startsWith('Ventes.backup-'));
    expect(backups).toHaveLength(1);
    await expect(a.page.getByTestId('modal')).toContainText(fr.split.done.replace('{{path}}', data).replace('{{backup}}', join(share, backups[0]!)));
    await a.page.getByTestId('modal-btn-ok').click();
    await expect(a.page.getByTestId('nav-item-link-Clients')).toBeVisible();
    await expect(a.page.getByTestId('nav-item-link-Commandes')).toBeVisible();
    expect(villes().map((r) => r.Nom)).toEqual(['Dupont', 'Martin', 'Durand', 'Éric']);
    expect(inFile<{ name: string }>(data, `SELECT name FROM bc_relations`)).toHaveLength(1);
    expect(inFile<{ name: string }>(front, `SELECT name FROM sqlite_schema WHERE name IN ('Clients', 'Commandes')`)).toEqual([]);
    const uuid = inFile<{ value: string }>(front, `SELECT value FROM bc_meta WHERE key = 'db_uuid'`)[0]!.value;

    // 2. Two workstations: B (the Runtime) opens the front-end of the share from a local copy (R14); A and B open Clients
    b = await launchApp({ runtime: true, args: [front], userDataDir: workstation(), env: { ...ENV, BASECRAFT_E2E_NETWORK_DIR: share } });
    const copy = join(b.userDataDir, 'front-ends', uuid, 'Ventes.basecraft');
    expect(await b.page.evaluate(() => (window as unknown as Win).basecraft.base.state())).toMatchObject({ path: copy, origin: front, readOnly: false });
    expect(existsSync(copy)).toBe(true);
    for (const p of [a.page, b.page]) {
      await p.getByTestId('nav-item-Clients').dblclick();
      await expect(cell(p, 2, 2)).toHaveText('Paris');
      await expect(count(p)).toHaveText('4');
    }

    // 3. Each sees the other's records within the refresh interval
    await addRecord(b.page, 4, 'Petit', 'Nantes');
    await expect.poll(() => villes()[4]).toEqual({ Nom: 'Petit', Ville: 'Nantes' });
    await expect(count(a.page)).toHaveText('5', { timeout: 5000 });
    await expect(cell(a.page, 1, 4)).toHaveText('Petit');
    await expect(cell(a.page, 2, 4)).toHaveText('Nantes');
    await addRecord(a.page, 5, 'Grand', 'Brest');
    await expect.poll(() => villes()[5]).toEqual({ Nom: 'Grand', Ville: 'Brest' });
    await expect(count(b.page)).toHaveText('6', { timeout: 5000 });
    await expect(cell(b.page, 1, 5)).toHaveText('Grand');
    await expect(cell(b.page, 2, 5)).toHaveText('Brest');

    // 4. Write conflict on Durand's Ville: A types Lille, B saves its own; A leaves the row
    const conflict = async (other: string) => {
      await typeVille(a.page, 2, 'Lille', false);
      await typeVille(b!.page, 2, other, true);
      await expect.poll(durand).toBe(other);
      await a.page.keyboard.press('ArrowDown');
      await expect(a.page.getByTestId('write-conflict')).toContainText(fr.wc.message);
    };
    await conflict('Rennes');
    await a.page.getByTestId('wc-drop').click();
    await expect(cell(a.page, 2, 2)).toHaveText('Rennes');
    await expect(dirty(a.page)).not.toContainText('•');
    expect(durand()).toBe('Rennes');

    await conflict('Vannes');
    await a.page.getByTestId('wc-copy').click();
    await expect(cell(a.page, 2, 2)).toHaveText('Vannes');
    const clip = (await a.app.evaluate(({ clipboard }) => clipboard.readText())).split(/\r?\n/).map((l) => l.split('\t'));
    expect(clip).toEqual([['N°', 'Nom', 'Ville'], ['3', 'Durand', 'Lille']]);
    expect(durand()).toBe('Vannes');

    await conflict('Laval');
    await a.page.getByTestId('wc-save').click();
    await expect(dirty(a.page)).not.toContainText('•');
    await expect.poll(durand).toBe('Lille');
    await expect(cell(b.page, 2, 2)).toHaveText('Lille', { timeout: 5000 });

    // 5. Structure refused while B is connected: A opens the data file itself, adds Tel to Clients
    await a.page.getByTestId('ribbon-tab-file').click();
    await a.page.getByTestId('bs-close').click();
    await a.page.getByTestId('bs-open').click(); // the Backstage stays open on a closed base
    await expect.poll(() => a.page.evaluate(() => (window as unknown as Win).basecraft.base.state().then((s) => s?.path))).toBe(data);
    expect(await a.page.evaluate(() => (window as unknown as Win).basecraft.base.state())).toMatchObject({ readOnly: false });
    await expect(a.page.getByTestId('banner-risk')).toHaveCount(0);
    await a.page.getByTestId('nav-item-Clients').click({ button: 'right' });
    await a.page.getByTestId('nav-menu-design').click();
    await a.page.getByTestId('design-row-3-name').fill('Tel');
    const save = async () => { await a.page.getByTestId('ribbon-tab-home').click(); await a.page.getByTestId('cmd-save').click(); };
    await save();
    await expect(a.page.getByTestId('modal')).toContainText(fr.dialog.error.dataFileInUse.replace('{{detail}}', `${userInfo().username} (${hostname()})`));
    await a.page.getByTestId('modal-btn-ok').click();
    const fields = () => inFile<{ name: string }>(data, `SELECT name FROM pragma_table_info('Clients')`).map((r) => r.name);
    expect(fields()).toEqual(['N°', 'Nom', 'Ville']);
    await b.app.close();
    b = null;
    await save();
    await expect(dirty(a.page)).not.toContainText('•');
    expect(fields()).toEqual(['N°', 'Nom', 'Ville', 'Tel']);

    // 6. Scripted concurrent writes: the spike's own file in share/spike (as the plan says), not the data file; then the data
    //    file's integrity after everything above
    const spikeDir = join(share, 'spike');
    const run = spawnSync(process.execPath, [SPIKE, 'smoke', spikeDir, '--workers', '4', '--seconds', '10'], { encoding: 'utf8' });
    expect(run.stdout, run.stdout + run.stderr).toContain('VERDICT: OK');
    expect(run.status).toBe(0);
    expect(inFile<{ integrity_check: string }>(data, 'PRAGMA integrity_check')).toEqual([{ integrity_check: 'ok' }]);
  } finally {
    await b?.app.close();
    await a.app.close();
  }
});
