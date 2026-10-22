import { test, expect } from '@playwright/test';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createTable } from '../../src/main/db/schema';
import { insertRow } from '../../src/main/db/write-layer';
import { localeInfo } from '../../src/shared/locale-format';
import { clients } from '../../src/shared/test-fixtures';
import { launchApp, seedBase } from './helpers';

test('a base given on the command line opens writable and its lock is released on exit', async () => {
  const base = await seedBase('session', async (db) => {
    createTable(db, clients);
    await insertRow(db, clients, { Nom: 'Dupont' }, localeInfo('fr-FR'));
  });
  const { app, page } = await launchApp({ args: [base] });
  try {
    expect(await page.evaluate(() => (window as any).basecraft.base.state())).toMatchObject({ path: base, readOnly: false });
    expect(await page.evaluate(() => (window as any).basecraft.rows.count('Clients'))).toBe(1);
    expect(existsSync(`${base}.lock`)).toBe(true);
    // the IPC boundary rejects malformed arguments
    await expect(page.evaluate(() => (window as any).basecraft.rows.page('Clients', { offset: -1, limit: 10 }))).rejects.toThrow('bc:invalidArgument');
  } finally {
    await app.close();
  }
  expect(existsSync(`${base}.lock`)).toBe(false);
});

test('create through the save hook, write and read rows, recent files; a bad open keeps the current base', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'basecraft-e2e-'));
  const created = join(dir, 'Nouvelle.basecraft');
  const notBase = join(dir, 'texte.basecraft');
  writeFileSync(notBase, 'pas une base');
  const { app, page, userDataDir } = await launchApp({ env: { BASECRAFT_E2E_SAVE_PATH: created, BASECRAFT_REGION: 'fr-FR' } });
  try {
    expect(await page.evaluate(() => (window as any).basecraft.base.create())).toMatchObject({ path: created, readOnly: false });
    expect(await page.evaluate((d) => (window as any).basecraft.tables.save({ originalName: null, design: d, mapping: [], allowDataLoss: false }), clients))
      .toEqual({ ok: true });
    expect(await page.evaluate(() => (window as any).basecraft.rows.insert('Clients', { Nom: 'Dupont', Solde: '12,5' }))).toMatchObject({ ok: true, rowid: 1 });
    expect(await page.evaluate(() => (window as any).basecraft.rows.page('Clients', { offset: 0, limit: 10 })))
      .toEqual({ rows: [{ rowid: 1, values: [1, 'Dupont', null, 0, 12.5, null] }] });
    expect(JSON.parse(readFileSync(join(userDataDir, 'settings.json'), 'utf8')).recentFiles).toContain(created);

    const open = (p: string) => page.evaluate((x) => (window as any).basecraft.base.open(x), p);
    await expect(open(notBase)).rejects.toThrow('bc:notBasecraft');
    await expect(open(join(dir, 'absent', 'x.basecraft'))).rejects.toThrow('bc:cannotOpen');
    await expect(open(join(dir, 'x.txt'))).rejects.toThrow('bc:invalidArgument');
    expect(await page.evaluate(() => (window as any).basecraft.base.state())).toMatchObject({ path: created, readOnly: false }); // still open
    expect(readFileSync(notBase, 'utf8')).toBe('pas une base');
  } finally {
    await app.close();
  }
  expect(existsSync(`${created}.lock`)).toBe(false);
});
