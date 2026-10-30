import { test, expect, type Page } from '@playwright/test';
import { chmodSync, existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { BasecraftApi } from '../../src/shared/api';
import { saveObject } from '../../src/main/db/objects';
import { createTable } from '../../src/main/db/schema';
import { seedSales } from '../../src/main/query/test-db';
import { clients } from '../../src/shared/test-fixtures';
import { launchApp, seedBase } from './helpers';

// What BaseCraft Runtime does with the files and the lock it shares with the full application, and with design calls (B5, R5, R6, R10).
const fr = JSON.parse(readFileSync(join(__dirname, '../../src/shared/i18n/fr.json'), 'utf8'));
const FR = { BASECRAFT_REGION: 'fr-FR' };
type Win = { basecraft: BasecraftApi };

/** A base as an earlier or a later version wrote it: edited after seeding, while no application has it open. */
function edit(base: string, sql: string): void {
  const db = new DatabaseSync(base);
  db.exec(sql);
  db.close();
}
const OLDER = "DROP TABLE bc_links; DROP TABLE bc_sources; DROP TABLE bc_objects; UPDATE bc_meta SET value='1' WHERE key='format_minor'"; // a 1.1 base, as A2 wrote it
const state = (page: Page) => page.evaluate(() => (window as unknown as Win).basecraft.base.state());

test('an older base: the Runtime refuses it and leaves it untouched; the full application migrates it', async () => {
  const base = seedBase('ancienne', (db) => { createTable(db, clients); });
  edit(base, OLDER);
  const before = readFileSync(base);
  const listing = readdirSync(dirname(base));
  // Given on the command line (as a double-click does), then asked for again through the Backstage: the same dialog both times.
  const rt = await launchApp({ runtime: true, args: [base], waitOpen: false, env: { ...FR, BASECRAFT_E2E_OPEN_PATH: base } });
  try {
    await expect(rt.page.getByTestId('modal')).toContainText(fr.dialog.error.needsDesigner);
    await rt.page.getByTestId('modal-btn-ok').click();
    await expect(rt.page.getByTestId('modal')).toHaveCount(0);
    await rt.page.getByTestId('bs-open').click();
    await expect(rt.page.getByTestId('modal')).toContainText(fr.dialog.error.needsDesigner);
    expect(await state(rt.page)).toBeNull();
  } finally {
    await rt.app.close();
  }
  expect(readFileSync(base)).toEqual(before); // no migration, no app_version stamp
  expect(readdirSync(dirname(base))).toEqual(listing); // no backup, no lock left

  const full = await launchApp({ args: [base], env: FR });
  try {
    const s = (await state(full.page))!;
    expect(s).toMatchObject({ readOnly: false });
    expect(s.migratedBackupPath).toMatch(/\.backup-\d{8}-\d{6}\.basecraft$/);
    expect(readFileSync(s.migratedBackupPath!)).toEqual(before);
  } finally {
    await full.app.close();
  }
});

test('a newer major is refused with the full application\'s message; a newer minor opens and keeps its unknown keys', async () => {
  const major = seedBase('future-majeure');
  edit(major, "UPDATE bc_meta SET value='2' WHERE key='format_major'");
  const before = readFileSync(major);
  const a = await launchApp({ runtime: true, args: [major], waitOpen: false, env: FR });
  try {
    await expect(a.page.getByTestId('modal')).toContainText(fr.dialog.error.newerMajor);
    expect(await state(a.page)).toBeNull();
  } finally {
    await a.app.close();
  }
  expect(readFileSync(major)).toEqual(before);

  const minor = seedBase('future-mineure');
  edit(minor, "UPDATE bc_meta SET value='5' WHERE key='format_minor'; INSERT INTO bc_meta VALUES ('futureKey','x')");
  const b = await launchApp({ runtime: true, args: [minor], env: FR });
  try {
    expect(await state(b.page)).toMatchObject({ readOnly: false });
  } finally {
    await b.app.close();
  }
  const db = new DatabaseSync(minor, { readOnly: true });
  expect(db.prepare("SELECT value FROM bc_meta WHERE key = 'futureKey'").get()).toEqual({ value: 'x' });
  expect(db.prepare("SELECT value FROM bc_meta WHERE key = 'format_minor'").get()).toEqual({ value: '5' });
  db.close();
});

test('one write lock across the two products: the second to open a base is read-only, whichever it is', async () => {
  const base = seedBase('partagee', (db) => createTable(db, clients));
  const held = { readOnly: true, readOnlyReason: 'heldByOther' };
  // the full application first
  const full = await launchApp({ args: [base], env: FR });
  const rt = await launchApp({ runtime: true, args: [base], env: FR });
  try {
    expect(await state(full.page)).toMatchObject({ readOnly: false });
    expect(await state(rt.page)).toMatchObject(held);
    await expect(rt.page.getByTestId('banner-readonly')).toBeVisible();
    await expect(rt.page.getByTestId('banner-takeover')).toHaveCount(0); // the holder is alive
    await expect(full.page.getByTestId('banner-readonly')).toHaveCount(0);
  } finally {
    await rt.app.close();
    await full.app.close();
  }
  expect(existsSync(`${base}.lock`)).toBe(false);
  // the Runtime first
  const rt2 = await launchApp({ runtime: true, args: [base], env: FR });
  const full2 = await launchApp({ args: [base], env: FR });
  try {
    expect(await state(rt2.page)).toMatchObject({ readOnly: false });
    expect(await state(full2.page)).toMatchObject(held);
    await expect(full2.page.getByTestId('banner-readonly')).toBeVisible();
    await expect(rt2.page.getByTestId('banner-readonly')).toHaveCount(0);
  } finally {
    await full2.app.close();
    await rt2.app.close();
  }
  expect(existsSync(`${base}.lock`)).toBe(false);
});

test('a file marked read-only on disk opens read-only in the Runtime', async () => {
  const base = seedBase('protegee', (db) => createTable(db, clients));
  chmodSync(base, 0o444);
  try {
    const { app, page } = await launchApp({ runtime: true, args: [base], env: FR });
    try {
      expect(await state(page)).toMatchObject({ readOnly: true, readOnlyReason: 'fileReadOnly' });
      expect(await page.evaluate(() => (window as unknown as Win).basecraft.tables.list().then((t) => t.map((x) => x.name)))).toEqual(['Clients']);
    } finally {
      await app.close();
    }
  } finally {
    chmodSync(base, 0o666); // even when the launch failed
  }
});

test('the Runtime rejects every design call and writes nothing, and keeps data entry', async () => {
  const base = seedBase('conception', (db) => {
    seedSales(db);
    saveObject(db, 'query', 'QMaj', { formatVersion: '1.0', sql: 'UPDATE Clients SET Ville = "Nice" WHERE Nom = "Dupont";' }, null);
  });
  const { app, page } = await launchApp({ runtime: true, args: [base], env: FR });
  const inventory = () => page.evaluate(async () => {
    const b = (window as unknown as Win).basecraft;
    return { objects: await b.objects.list(), tables: (await b.tables.list()).map((t) => t.name) };
  });
  const noHandler = /No handler registered/;
  try {
    const before = await inventory();
    expect(before.objects).toHaveLength(1);
    await expect(page.evaluate(() => (window as unknown as Win).basecraft.objects.save('form', 'X', {}, null))).rejects.toThrow(noHandler);
    await expect(page.evaluate(() => (window as unknown as Win).basecraft.objects.delete('query', 'QMaj'))).rejects.toThrow(noHandler);
    await expect(page.evaluate(() => (window as unknown as Win).basecraft.tables.save(
      { originalName: null, design: { name: 'X', fields: [] }, mapping: [], allowDataLoss: false }))).rejects.toThrow(noHandler);
    await expect(page.evaluate(() => (window as unknown as Win).basecraft.tables.drop('Commandes'))).rejects.toThrow(noHandler);
    await expect(page.evaluate(() => (window as unknown as Win).basecraft.relations.save(
      { name: '', parentTable: 'Clients', parentFields: ['N°'], childTable: 'Commandes', childFields: ['Client'],
        enforce: false, cascadeUpdate: false, cascadeDelete: false, joinType: 1 }, null))).rejects.toThrow(noHandler);
    await expect(page.evaluate(() => (window as unknown as Win).basecraft.base.create())).rejects.toThrow(noHandler);
    await expect(page.evaluate(() => (window as unknown as Win).basecraft.base.compact())).rejects.toThrow(noHandler);
    await expect(page.evaluate(() => (window as unknown as Win).basecraft.base.saveStartup(
      { appTitle: '', appIcon: '', startupForm: '', showNavPane: true, ribbon: 'full', runMode: false,
        statusBar: true, documentTabs: true, specialKeys: true, compactOnClose: false, datasheetDesign: true, fullMenus: true, shortcutMenus: true, iconForForms: false, frontEnd: false, dataFile: false }))).rejects.toThrow(noHandler);
    expect(await inventory()).toEqual(before);
    expect(await state(page)).toMatchObject({ path: base, readOnly: false }); // still open

    // data entry: reads, row writes and an action query
    expect(await page.evaluate(() => (window as unknown as Win).basecraft.rows.insert('Clients', { Nom: 'Nouveau', Ville: 'Nice' }))).toMatchObject({ ok: true });
    expect(await page.evaluate(() => (window as unknown as Win).basecraft.rows.count('Clients'))).toBe(5);
    expect(await page.evaluate(() => (window as unknown as Win).basecraft.queries.runAction(
      { kind: 'query', name: 'QMaj' }, {}, { skipFailures: false, replaceTable: false }))).toEqual({ ok: true, count: 1 });
  } finally {
    await app.close();
  }
});
