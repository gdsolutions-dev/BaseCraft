import { _electron, expect, type ElectronApplication, type Locator, type Page } from '@playwright/test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { createBaseFile, FILE_EXTENSION, openBaseFile } from '../../src/main/db/file-format';
import { saveObject } from '../../src/main/db/objects';
import type { BasecraftApi } from '../../src/shared/api';
import type { DesignDoc } from '../../src/shared/design/model';
import { seedSales, seedSalesRelation } from '../../src/main/query/test-db';
import { createTable } from '../../src/main/db/schema';
import { FACTURES_FIELDS, FACTURES_REPORT, FACTURES_ROWS } from '../../src/shared/report/fixtures/factures';

export async function launchApp(
  opts: { args?: string[]; env?: Record<string, string>; userDataDir?: string } = {},
): Promise<{ app: ElectronApplication; page: Page; userDataDir: string }> {
  const userDataDir = opts.userDataDir ?? mkdtempSync(join(tmpdir(), 'basecraft-'));
  const env = { ...process.env, BASECRAFT_E2E: '1', BASECRAFT_USER_DATA: userDataDir, ...opts.env } as Record<string, string>;
  delete env.ELECTRON_RUN_AS_NODE; // sinon Electron démarre comme Node simple
  const app = await _electron.launch({
    args: ['.', ...(opts.args ?? [])],
    env,
  });
  const page = await app.firstWindow();
  // The window stays hidden (main/index.ts): the page must still behave as focused for the grid's editors.
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Emulation.setFocusEmulationEnabled', { enabled: true });
  await page.waitForSelector('[data-testid="app-root"]', { state: 'attached' });
  // A base named on the command line opens in the main process after the window loads (main/index.ts): wait until it is open
  // (its lock taken, or found held by another instance). A second instance launched next then always finds the first one's
  // lock and opens read-only, however slow the machine; a fixed wait for the banner raced both the open and the lock.
  if (opts.args?.some((a) => a.toLowerCase().endsWith(FILE_EXTENSION))) {
    await expect.poll(() => page.evaluate(() => (window as unknown as { basecraft: BasecraftApi }).basecraft.base.state()),
      { timeout: 20_000, message: 'the base given on the command line opens' }).not.toBeNull();
  }
  return { app, page, userDataDir };
}

/** Creates a base in a fresh temporary folder, lets `setup` fill it (createTable, insertRow…), closes it, returns its path.
 *  An asynchronous setup (insertRow is async) gives a promise of the path. */
export function seedBase(name: string, setup?: (db: DatabaseSync) => void): string;
export function seedBase(name: string, setup: (db: DatabaseSync) => Promise<void>): Promise<string>;
export function seedBase(name: string, setup?: (db: DatabaseSync) => void | Promise<void>): string | Promise<string> {
  const p = join(mkdtempSync(join(tmpdir(), 'basecraft-seed-')), name.endsWith(FILE_EXTENSION) ? name : name + FILE_EXTENSION);
  createBaseFile(p, '0.0.0');
  const { db } = openBaseFile(p, 'write', '0.0.0');
  let pending: void | Promise<void>;
  try {
    pending = setup?.(db);
  } catch (e) {
    db.close();
    throw e;
  }
  if (pending instanceof Promise) return pending.then(() => p).finally(() => db.close());
  db.close();
  return p;
}

/** A form saved in a seeded base (inside `seedBase`'s setup), as the foundation stores it. */
export function seedForm(db: DatabaseSync, name: string, doc: DesignDoc): void {
  const r = saveObject(db, 'form', name, doc, null);
  if (!r.ok) throw new Error(`seedForm ${name}: ${r.reason}`);
}

/**
 * A form's datasheet (a subform's, FormDatasheet) inside `frame`: Glide's accessible cells, clicked where its columns are — row
 * selector 44 px, header 34, rows 30, then `widths` (px: each column as wide as its control, twips / 15).
 */
export function formGrid(page: Page, frame: Locator, widths: number[]) {
  const MARKER = 44, HEADER = 34, ROW = 30;
  const editor = page.locator('#portal textarea, #portal input');
  return {
    frame,
    count: frame.getByTestId('nav-record-count'),
    add: frame.getByTestId('nav-new'),
    error: frame.getByTestId('form-datasheet-error'),
    cell: (col: number, row: number) => frame.getByTestId(`glide-cell-${col + 1}-${row}`),
    /** A click on the cell, nothing awaited (a row not there yet). */
    async at(col: number, row: number) {
      const b = (await frame.getByTestId('data-grid-canvas').boundingBox())!;
      const left = widths.slice(0, col).reduce((a, w) => a + w, 0);
      await page.mouse.click(b.x + MARKER + left + 20, b.y + HEADER + row * ROW + ROW / 2);
    },
    /** A click on the cell: then selected, the focus in the grid (Glide may keep it on its scroller until the row is drawn; typing
     *  goes to the cell) or in its editor (a click on the cell already selected opens it, as Glide does). */
    async click(col: number, row: number) {
      await this.at(col, row);
      await expect(this.cell(col, row)).toHaveAttribute('aria-selected', 'true');
      await expect.poll(() => frame.evaluate((el) => el.contains(document.activeElement) || !!document.activeElement?.closest('#portal'))).toBe(true);
    },
    /** Types in the selected cell (the first key opens Glide's editor) or in its open editor (its text replaced); Enter commits it. */
    async type(text: string) {
      if (await editor.count()) {
        await page.keyboard.press('ControlOrMeta+A');
        await page.keyboard.type(text);
      } else {
        await page.keyboard.press(text[0]!);
        await expect(editor.first()).toBeFocused();
        await page.keyboard.type(text.slice(1));
      }
      await page.keyboard.press('Enter');
      await expect(editor).toHaveCount(0);
    },
  };
}

/** A3's saved queries of the test base: a parameter query, a one-table query (updatable) and a join (read-only). */
export const SALES_QUERIES: [string, string][] = [
  ['QDepuis', 'SELECT [N°], Montant, Le FROM Commandes WHERE Le >= [Date début :];'],
  ['QClientsLyon', 'SELECT * FROM [Clients] WHERE [Ville] = "Lyon";'],
  ['QVentes', 'SELECT Clients.Nom, Commandes.Montant, Commandes.Le FROM Clients INNER JOIN Commandes ON Clients.[N°] = Commandes.Client;'],
];
/** A3's test base (Clients / Commandes, relation ClientsCommandes, src/main/query/test-db.ts) with SALES_QUERIES saved. */
export function seedSalesE2E(name: string): string {
  return seedBase(name, (db) => {
    seedSales(db);
    seedSalesRelation(db);
    for (const [q, sql] of SALES_QUERIES) saveObject(db, 'query', q, { formatVersion: '1.0', sql }, null);
  });
}

/** Commandes with 2000 rows, and queries over three copies of it whose Like criterion is false: their count never ends
 *  (QLente: a select query; QLenteAction: a Make-Table query). */
export function seedSlow(name: string): string {
  return seedBase(name, (db) => {
    seedSales(db);
    const o = db.prepare('INSERT INTO "Commandes" ("Client", "Montant", "Le") VALUES (1, 1, \'2026-10-01 00:00:00\')');
    db.exec('BEGIN');
    for (let i = 0; i < 1995; i++) o.run();
    db.exec('COMMIT'); // one write to disk, not 1995
    saveObject(db, 'query', 'QLente', { formatVersion: '1.0', sql: 'SELECT a.[N°] FROM Commandes AS a, Commandes AS b, Commandes AS c WHERE a.Le & b.Le & c.Le Like "*zz*";' }, null);
    saveObject(db, 'query', 'QLenteAction', { formatVersion: '1.0', sql: 'SELECT a.[N°] INTO Lente FROM Commandes AS a, Commandes AS b, Commandes AS c WHERE a.Le & b.Le & c.Le Like "*zz*";' }, null);
  });
}

/** Table Factures (FACTURES_FIELDS, FACTURES_ROWS) and the report « Factures par client » (FACTURES_REPORT). */
export function seedReportsE2E(db: DatabaseSync): void {
  createTable(db, { name: 'Factures', fields: FACTURES_FIELDS.map((f) => ({ name: f.name, props: f.props })) });
  const insert = db.prepare('INSERT INTO "Factures" VALUES (?, ?, ?, ?, ?)');
  for (const r of FACTURES_ROWS) insert.run(...(r as (string | number | null)[]));
  const ok = saveObject(db, 'report', 'Factures par client', FACTURES_REPORT, null);
  if (!ok.ok) throw new Error(ok.reason);
}

export type DomLayout = { pages: { bands: { section: string; top: number; height: number; lines: [string, number, number, number][] }[] }[] };

/** The layout model as the active Print Preview draws it, read from the data-* attributes of every page (stepping with
 *  « suivant »). Twips; a line is [text, x, y, width] with x and y in its band (the text box's left/top + the line's). */
export async function layoutFromDom(page: Page): Promise<DomLayout> {
  const doc = page.locator('.doc:not([hidden])');
  const nav = (k: string) => doc.getByTestId(`preview-nav-${k}`);
  await doc.getByTestId('report-pages').waitFor({ state: 'visible' }); // the fonts are loaded
  if (await nav('first').isEnabled()) await nav('first').click();
  await doc.locator('.bc-page[data-page="1"]').waitFor();
  const pages = new Map<number, DomLayout['pages'][number]>();
  for (;;) {
    const shown = await doc.locator('.bc-page').evaluateAll((els) => els.map((p) => {
      const tw = (pt: string) => Math.round(parseFloat(pt) * 20); // inline lengths are twips / 20, in pt
      return [Number((p as HTMLElement).dataset.page), { bands: [...p.querySelectorAll<HTMLElement>(':scope > .bc-band')].map((b) => ({
        section: b.dataset.section!, top: Number(b.dataset.top), height: Number(b.dataset.height),
        lines: [...b.querySelectorAll<HTMLElement>('.bc-line')].map((l): [string, number, number, number] => {
          const box = l.parentElement!.style;
          return [l.textContent ?? '', tw(box.left) + Number(l.dataset.x), tw(box.top) + Number(l.dataset.y), Number(l.dataset.w)];
        }),
      })) }] as const;
    }));
    for (const [n, p] of shown) pages.set(n, p);
    if (!(await nav('next').isEnabled())) break;
    const next = Math.max(...pages.keys()) + 1;
    await nav('next').click();
    await doc.locator(`.bc-page[data-page="${next}"]`).waitFor();
  }
  return { pages: [...pages].sort((a, b) => a[0] - b[0]).map(([, p]) => p) };
}
