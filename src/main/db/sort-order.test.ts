import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { createBaseFile, openBaseFile, readOptions } from './file-format';
import { applyPendingSortOrder, readSortOrder, restoreSortOrder, setPendingSortOrder } from './sort-order';
import { createTable } from './schema';
import { insertRow } from './write-layer';
import { readRows } from './rows';
import { f, t } from '../../shared/test-fixtures';
import { localeInfo } from '../../shared/locale-format';
import { Session } from '../session';

vi.setConfig({ testTimeout: 30_000, hookTimeout: 15_000 });

let dir: string;
let p: string;
const open: DatabaseSync[] = [];
const fr = localeInfo('fr-FR');
const notes = t('Notes', [f('Txt', 'shortText')]);
const VALUES = ['zèbre', 'Eté', 'ete', 'ŒUF', 'oeuf', 'straße', 'strasse'];

beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bcorder-')); p = path.join(dir, 't.basecraft'); });
afterEach(() => { for (const d of open.splice(0)) try { d.close(); } catch { /* closed */ } fs.rmSync(dir, { recursive: true, force: true }); });

async function seeded(order?: Parameters<typeof createBaseFile>[2], file = p): Promise<DatabaseSync> {
  createBaseFile(file, '0.0.0', order);
  const db = openBaseFile(file, 'write', '0.0.0').db;
  open.push(db);
  createTable(db, notes);
  for (const v of VALUES) await insertRow(db, notes, { Txt: v }, fr);
  return db;
}
const sheet = (db: DatabaseSync) => readRows(db, notes, { offset: 0, limit: 20, sort: { field: 'Txt', dir: 'asc' } }).rows.map((r) => r.values[0]);
const query = (db: DatabaseSync) => (db.prepare(`SELECT "Txt" AS v FROM "Notes" ORDER BY bc_skey("Txt"), bc_gkey("Txt")`).all() as { v: string }[]).map((r) => r.v);

describe('a base\'s sort order', () => {
  it('a new base stores General; a base without one is Legacy', async () => {
    const db = await seeded();
    expect(readSortOrder(db)).toEqual({ applied: 'general', pending: null });
    expect(readOptions(db).sortOrder).toBe('general');
    db.prepare(`UPDATE bc_meta SET value = '{}' WHERE key = 'options'`).run();
    expect(readSortOrder(db)).toEqual({ applied: 'legacy', pending: null });
    db.prepare(`UPDATE bc_meta SET value = '{"sortOrder":"nope","sortOrderPending":7}' WHERE key = 'options'`).run();
    expect(readSortOrder(db)).toEqual({ applied: 'legacy', pending: null });
  });
  it('sorts the datasheet and queries by the order registered on the connection', async () => {
    const legacy = ['ete', 'Eté', 'oeuf', 'strasse', 'straße', 'zèbre', 'ŒUF'];
    // ties (Eté/ete, oeuf/ŒUF) are broken by bc_gkey, on the NFC lowercase text: "ete" before "eté"
    const l = await seeded('legacy');
    expect(sheet(l)).toEqual(legacy);
    expect(query(l)).toEqual(legacy);
    const g = await seeded('general', path.join(dir, 'g.basecraft'));
    expect(sheet(g)).toEqual(['ete', 'Eté', 'oeuf', 'ŒUF', 'strasse', 'straße', 'zèbre']);
    expect(query(g)).toEqual(sheet(g));
  });
  it('a chosen order waits for Compact: reopening the base does not apply it', async () => {
    const db = await seeded('general');
    setPendingSortOrder(db, 'swedish');
    expect(readSortOrder(db)).toEqual({ applied: 'general', pending: 'swedish' });
    setPendingSortOrder(db, 'general'); // back to the applied one: nothing waits
    expect(readSortOrder(db)).toEqual({ applied: 'general', pending: null });
    setPendingSortOrder(db, 'legacy');
    db.close();
    const again = openBaseFile(p, 'write', '0.0.0').db;
    open.push(again);
    expect(readSortOrder(again).applied).toBe('general');
    expect(sheet(again)[0]).toBe('ete');
  });
  it('applying the pending order, and undoing it', async () => {
    const db = await seeded('general');
    setPendingSortOrder(db, 'legacy');
    const before = applyPendingSortOrder(db);
    expect(before).toEqual({ applied: 'general', pending: 'legacy' });
    expect(readSortOrder(db)).toEqual({ applied: 'legacy', pending: null });
    restoreSortOrder(db, before);
    expect(readSortOrder(db)).toEqual({ applied: 'general', pending: 'legacy' });
  });
  it('Compact and Repair applies it: the reopened base sorts by the new order, the backup keeps the old', async () => {
    const db = await seeded('general');
    db.close();
    open.pop();
    const s = Session.open(p, { appVersion: '0.0.0', region: 'fr-FR', sessionId: 'a', probe: { platform: 'win32', env: {}, homedir: 'C:\\Users\\x', windowsDriveType: () => 3 } });
    try {
      s.setSortOrder('legacy');
      expect(s.sortOrder()).toEqual({ applied: 'general', pending: 'legacy' });
      const r = await s.compact();
      expect(r.ok).toBe(true);
      expect(s.sortOrder()).toEqual({ applied: 'legacy', pending: null });
      if (r.ok) {
        const old = openBaseFile(r.backupPath, 'readOnly', '0.0.0').db;
        open.push(old);
        expect(readSortOrder(old)).toEqual({ applied: 'general', pending: 'legacy' });
      }
    } finally { s.close(); }
  });
});
