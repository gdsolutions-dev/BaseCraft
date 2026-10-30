import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs, { existsSync, readFileSync, realpathSync } from 'node:fs';
import os from 'node:os';
import { join } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { createBaseFile, openBaseFile } from './file-format';
import type { RiskProbe } from './location-risk';
import { listObjects, saveObject } from './objects';
import { listRelations } from './relations';
import { lookupRows } from './rows';
import { createTable, listTables, removeTable, tableDesign } from './schema';
import { splitDatabase } from './split';
import { saveStartupOptions, startupOptions } from './startup';
import { addLinks, linkRows, sourceRows } from '../links/store';
import { seedSales, seedSalesRelation } from '../query/test-db';
import { Session, type SessionDeps } from '../session';
import { localeInfo } from '../../shared/locale-format';
import { f, t } from '../../shared/test-fixtures';

// A front-end Ventes (seedSales + its relation, the saved query QLyon, a form, a macro, a lookup on Commandes.Client whose Row
// Source is QLyon, a C1 link Notes to Ventes_notes.basecraft), split into Ventes_donnees.basecraft beside it.
let dir: string;
let fe: string;
let data: string;
let front: DatabaseSync | null;
const opened: Session[] = [];
const probe: RiskProbe = { platform: 'win32', env: {}, homedir: 'C:\\Users\\x', windowsDriveType: () => 3 };
const deps: SessionDeps = { appVersion: '0.0.0', region: 'fr-FR', probe, lockDeps: { now: () => 0 }, sessionId: 'a' };
const open = (p: string, d: Partial<SessionDeps> = {}) => { const x = Session.open(p, { ...deps, ...d }); opened.push(x); return x; };
const rows = (db: DatabaseSync, sql: string) => db.prepare(sql).all();
const uuidOf = (db: DatabaseSync) => (db.prepare(`SELECT value FROM bc_meta WHERE key = 'db_uuid'`).get() as { value: string }).value;
const fr = localeInfo('fr-FR');
const QLYON = { formatVersion: '1.0', sql: 'SELECT [N°], Nom FROM Clients WHERE Ville = "Lyon";' };

function seedFront(p: string): void {
  createBaseFile(p, '0.0.0');
  const db = openBaseFile(p, 'write', '0.0.0').db;
  seedSales(db);
  seedSalesRelation(db);
  saveObject(db, 'query', 'QLyon', QLYON, null);
  saveObject(db, 'form', 'FClients', { formatVersion: '1.0' }, null);
  saveObject(db, 'macro', 'MOuvrir', { formatVersion: '1.0' }, null);
  const lookup = { kind: 'table', table: 'QLyon', boundColumn: 1, columnCount: 2, limitToList: true };
  db.prepare(`UPDATE bc_fields SET props = json_set(props, '$.lookup', json(?)) WHERE table_name = 'Commandes' AND field_name = 'Client'`).run(JSON.stringify(lookup));
  const notes = p.replace(/\.basecraft$/, '_notes.basecraft');
  createBaseFile(notes, '0.0.0');
  const n = openBaseFile(notes, 'write', '0.0.0').db;
  createTable(n, t('Notes', [f('N°', 'autoNumber'), f('Texte', 'shortText')]));
  n.close();
  addLinks(db, p, 'basecraft', notes, ['Notes']);
  db.close();
}

beforeEach(() => {
  dir = realpathSync.native(fs.mkdtempSync(join(os.tmpdir(), 'bcsplit-')));
  fe = join(dir, 'Ventes.basecraft');
  data = join(dir, 'Ventes_donnees.basecraft');
  seedFront(fe);
  front = openBaseFile(fe, 'write', '0.0.0').db;
});
afterEach(() => {
  front?.close();
  for (const x of opened.splice(0)) x.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('splitDatabase (C3 R12)', () => {
  it('moves every local table with its rows, rules and relations', () => {
    const before = rows(front!, 'SELECT rowid, Montant FROM Commandes ORDER BY rowid');
    const rule = tableDesign(front!, 'Commandes').fields.find((x) => x.name === 'Montant')!.props.validationRule;
    expect(splitDatabase(front!, fe, data, '0.0.0').sort()).toEqual(['Clients', 'Commandes']);
    const d = openBaseFile(data, 'write', '0.0.0').db;
    try {
      expect(rows(d, 'SELECT rowid, Montant FROM Commandes ORDER BY rowid')).toEqual(before);
      expect(tableDesign(d, 'Commandes').fields.find((x) => x.name === 'Montant')!.props.validationRule).toBe(rule);
      expect(listRelations(d).map((r) => [r.parentTable, r.childTable])).toEqual([['Clients', 'Commandes']]);
      expect(startupOptions(d)).toMatchObject({ dataFile: true, frontEnd: false, startupForm: '', appTitle: '' });
      expect(uuidOf(d)).not.toBe(uuidOf(front!));
      expect(listObjects(d).map((o) => [o.kind, o.name])).toEqual([['query', 'QLyon']]);
      expect(linkRows(d)).toEqual([]);
      expect(sourceRows(d)).toEqual([]);
      expect(rows(d, 'PRAGMA integrity_check')).toEqual([{ integrity_check: 'ok' }]);
    } finally { d.close(); }
  });

  it('the front-end keeps its objects and links the moved tables', () => {
    splitDatabase(front!, fe, data, '0.0.0');
    expect(listTables(front!)).toEqual([]);
    expect(listRelations(front!)).toEqual([]);
    expect(listObjects(front!).map((o) => [o.kind, o.name])).toEqual([['form', 'FClients'], ['macro', 'MOuvrir'], ['query', 'QLyon']]);
    expect(linkRows(front!).map((l) => l.name).sort()).toEqual(['Clients', 'Commandes', 'Notes']);
    expect(sourceRows(front!).find((s) => s.path === realpathSync.native(data))?.relative).toBe('Ventes_donnees.basecraft');
    expect(startupOptions(front!).frontEnd).toBe(true);
    expect(rows(front!, 'SELECT count(*) AS n FROM bc_fields')).toEqual([{ n: 0 }]);
  });

  it('the lookup on a saved query still works in the data file', () => {
    const want = lookupRows(front!, tableDesign(front!, 'Commandes'), 'Client', fr).rows;
    expect(want.length).toBeGreaterThan(0);
    splitDatabase(front!, fe, data, '0.0.0');
    front!.close();
    front = null;
    expect(open(data).lookup('Commandes', 'Client').rows).toEqual(want);
  });

  it('a failure leaves the front-end as it was and no data file', () => {
    let n = 0;
    const failing: typeof removeTable = (db, name) => {
      if (++n === 2) throw new Error('disk full');
      removeTable(db, name);
    };
    expect(() => splitDatabase(front!, fe, data, '0.0.0', { removeTable: failing })).toThrow('disk full');
    expect(listTables(front!).map((x) => x.name)).toEqual(['Clients', 'Commandes']);
    expect(linkRows(front!).map((l) => l.name)).toEqual(['Notes']);
    expect(listRelations(front!)).toHaveLength(1);
    expect(startupOptions(front!).frontEnd).toBe(false);
    expect(rows(front!, 'SELECT count(*) AS n FROM Commandes')).toEqual([{ n: 5 }]);
    expect(existsSync(data)).toBe(false);
  });

  it('a target taken just before the replace is kept as it is (the rule of Save As, R13)', () => {
    fs.writeFileSync(data, 'theirs');
    expect(() => splitDatabase(front!, fe, data, '0.0.0', { beforeReplace: () => { throw new Error('bc:targetInUse'); } })).toThrow('bc:targetInUse');
    expect(readFileSync(data, 'utf8')).toBe('theirs');
    expect(existsSync(`${data}.bc-tmp`)).toBe(false);
    expect(listTables(front!).map((x) => x.name)).toEqual(['Clients', 'Commandes']);
  });

  it('a data file split again: its front-end is not a data file', () => {
    saveStartupOptions(front!, { ...startupOptions(front!), dataFile: true });
    splitDatabase(front!, fe, data, '0.0.0');
    expect(startupOptions(front!)).toMatchObject({ frontEnd: true, dataFile: false });
  });

  it('the backup stays when the split fails', () => {
    front!.close();
    front = null;
    const s = open(fe);
    expect(() => s.splitDatabase(join(dir, 'absent', 'Ventes_donnees.basecraft'))).toThrow(/^bc:copyFailed/);
    expect(fs.readdirSync(dir).filter((n) => n.startsWith('Ventes.backup-'))).toHaveLength(1);
    expect(s.listTables().map((x) => x.name)).toEqual(['Clients', 'Commandes', 'Notes']);
  });

  it('the session backs up first and refuses what it cannot split', () => {
    front!.close();
    front = null;
    const s = open(fe);
    const original = readFileSync(fe);
    const r = s.splitDatabase(data);
    if (!r.ok) throw new Error(r.reason);
    expect(r.tables).toEqual(['Clients', 'Commandes']);
    expect(r.dataFile).toBe(data);
    expect(readFileSync(r.backupPath)).toEqual(original);
    expect(s.listTables().map((x) => [x.name, x.link?.kind])).toEqual([['Clients', 'basecraft'], ['Commandes', 'basecraft'], ['Notes', 'basecraft']]);
    expect(s.count('Commandes')).toBe(5); // read from the data file
    expect(s.splitDatabase(join(dir, 'encore.basecraft'))).toEqual({ ok: false, reason: 'noTables' }); // links only

    const other = join(dir, 'Autre.basecraft');
    seedFront(other);
    const o = open(other, { sessionId: 'b' });
    expect(o.splitDatabase(other)).toEqual({ ok: false, reason: 'self' });
    const ro = open(other, { sessionId: 'c' });
    expect(ro.state.readOnly).toBe(true);
    expect(ro.splitDatabase(join(dir, 'Autre_donnees.basecraft'))).toEqual({ ok: false, reason: 'readOnly' });
    expect(() => o.splitDatabase(fe)).toThrow('bc:targetInUse'); // the front-end s holds
    expect(existsSync(join(dir, 'Autre_donnees.basecraft'))).toBe(false);
  });
});
