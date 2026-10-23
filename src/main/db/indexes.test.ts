// Index multichamps (boîte de dialogue Index) : DDL bcxi_, renommages, unicité sur données existantes, réconciliation.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { createBaseFile, openBaseFile } from './file-format';
import { createTable, isExternal, reconcile, renameTable, tableDesign } from './schema';
import { insertRow } from './write-layer';
import { alterTable } from './alter';
import { f, t } from '../../shared/test-fixtures';
import { localeInfo } from '../../shared/locale-format';
import { validateDesign, type IndexDef, type TableDesign } from '../../shared/field-types';
import { designReducer, fromDesign, savedModel, toSaveRequest } from '../../renderer/table-design/design-model';

vi.setConfig({ testTimeout: 15_000, hookTimeout: 15_000 });

let dir: string;
let db: DatabaseSync;
const fr = localeInfo('fr-FR');
const now = () => new Date(2026, 9, 23);

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bcidx-'));
  const p = path.join(dir, 'test.basecraft');
  createBaseFile(p, '0.0.0');
  db = openBaseFile(p, 'write', '0.0.0').db;
});
afterEach(() => {
  try { db.close(); } catch { /* already closed */ }
  fs.rmSync(dir, { recursive: true, force: true });
});

const NP: IndexDef = { name: 'NomPrénom', fields: [{ name: 'Nom', desc: false }, { name: 'Prénom', desc: true }], unique: true };
const personnes = (indexes: IndexDef[] = [NP]): TableDesign =>
  ({ ...t('Personnes', [f('N°', 'autoNumber'), f('Nom', 'shortText'), f('Prénom', 'shortText')]), indexes });
const insert = (values: Record<string, string>, table = 'Personnes') => insertRow(db, tableDesign(db, table), values, fr, now);
const sqlOf = (name: string) => (db.prepare(`SELECT sql FROM sqlite_master WHERE type = 'index' AND name = ?`).get(name) as { sql: string } | undefined)?.sql;
const ident = (d: TableDesign) => d.fields.map((x) => ({ name: x.name, sourceName: x.name }));

describe('multi-field indexes', () => {
  it('creates the SQLite index and enforces uniqueness', async () => {
    createTable(db, personnes());
    expect(sqlOf('bcxi_Personnes.NomPrénom')).toBe('CREATE UNIQUE INDEX "bcxi_Personnes.NomPrénom" ON "Personnes" ("Nom" ASC, "Prénom" DESC)');
    expect(tableDesign(db, 'Personnes').indexes).toEqual([NP]);
    expect(isExternal(db, tableDesign(db, 'Personnes'))).toBe(false);
    expect(await insert({ Nom: 'Dupont', Prénom: 'Jean' })).toMatchObject({ ok: true });
    expect(await insert({ Nom: 'Dupont', Prénom: 'Marie' })).toMatchObject({ ok: true });
    expect(await insert({ Nom: 'Dupont', Prénom: 'Jean' })).toMatchObject({ ok: false, errors: [{ field: 'Nom', code: 'duplicate' }] });
    const plan = db.prepare(`EXPLAIN QUERY PLAN SELECT * FROM "Personnes" WHERE "Nom" = 'Dupont' AND "Prénom" = 'Jean'`).all() as { detail: string }[];
    expect(plan.map((x) => x.detail).join(' ')).toContain('bcxi_Personnes.NomPrénom');
  });

  it('round trip with unknown keys; validateDesign checks the indexes', () => {
    createTable(db, { ...personnes(), extra: { futur: 1 } });
    expect(tableDesign(db, 'Personnes')).toMatchObject({ indexes: [NP], extra: { futur: 1 } });
    const bad = (ix: IndexDef[]) => validateDesign(personnes(ix)).map((e) => e.code);
    expect(bad([{ ...NP, fields: [{ name: 'Pays', desc: false }] }])).toEqual(['invalidIndex']);
    expect(bad([NP, { ...NP, name: 'nomprénom' }])).toEqual(['invalidIndex']);
    expect(bad([{ ...NP, fields: [] }])).toEqual(['invalidIndex']);
    expect(bad([{ ...NP, name: 'a.b' }])).toEqual(['invalidIndex']);
  });

  it('rename field and table keep the index', async () => {
    createTable(db, personnes());
    const d = tableDesign(db, 'Personnes');
    // The design names the index fields by their source names (as stored): alterTable follows the renames, a swap included.
    const names = ['N°', 'Prénom', 'NomFamille'];
    const design = { ...d, fields: d.fields.map((x, i) => ({ ...x, name: names[i]! })) };
    const mapping = d.fields.map((x, i) => ({ name: names[i]!, sourceName: x.name }));
    expect(await alterTable(db, 'Personnes', design, mapping, { allowDataLoss: false, info: fr })).toEqual({ ok: true });
    const fields = [{ name: 'Prénom', desc: false }, { name: 'NomFamille', desc: true }];
    expect(tableDesign(db, 'Personnes').indexes).toEqual([{ ...NP, fields }]);
    expect(sqlOf('bcxi_Personnes.NomPrénom')).toContain('("Prénom" ASC, "NomFamille" DESC)');
    renameTable(db, 'Personnes', 'Gens');
    expect(sqlOf('bcxi_Personnes.NomPrénom')).toBeUndefined();
    expect(sqlOf('bcxi_Gens.NomPrénom')).toBe('CREATE UNIQUE INDEX "bcxi_Gens.NomPrénom" ON "Gens" ("Prénom" ASC, "NomFamille" DESC)');
    expect(isExternal(db, tableDesign(db, 'Gens'))).toBe(false);
  });

  it('a deleted field leaves its indexes; an index left empty goes', async () => {
    createTable(db, personnes([NP, { name: 'P', fields: [{ name: 'Prénom', desc: false }], unique: false }]));
    const d = tableDesign(db, 'Personnes');
    const design = { ...d, fields: d.fields.filter((x) => x.name !== 'Prénom') };
    expect(await alterTable(db, 'Personnes', design, ident(design), { allowDataLoss: false, info: fr })).toEqual({ ok: true });
    expect(tableDesign(db, 'Personnes').indexes).toEqual([{ ...NP, fields: [NP.fields[0]] }]);
    expect(sqlOf('bcxi_Personnes.P')).toBeUndefined();
  });

  it('unique over duplicates fails the save', async () => {
    createTable(db, personnes([]));
    await insert({ Nom: 'Dupont', Prénom: 'Jean' });
    await insert({ Nom: 'Dupont', Prénom: 'Jean' });
    const d = tableDesign(db, 'Personnes');
    const single = { ...d, fields: d.fields.map((x) => (x.name === 'Nom' ? { ...x, props: { ...x.props, indexed: 'yesNoDuplicates' as const } } : x)) };
    const expected = await alterTable(db, 'Personnes', single, ident(d), { allowDataLoss: false, info: fr });
    expect(expected).toEqual({ ok: false, reason: 'duplicate', field: 'Nom' });
    expect(await alterTable(db, 'Personnes', { ...d, indexes: [NP] }, ident(d), { allowDataLoss: false, info: fr })).toEqual(expected);
    expect(tableDesign(db, 'Personnes').indexes).toBeUndefined();
  });

  it('unknown keys of an index and of its fields, and unreadable stored entries, survive alterTable (with a rename), reconcile and the design model', async () => {
    const futur = { ...NP, futur: 1, fields: [{ ...NP.fields[0]!, poids: 2 }, NP.fields[1]!] };
    createTable(db, personnes([futur]));
    const raw = () => JSON.parse((db.prepare(`SELECT props FROM bc_tables WHERE name = 'Personnes'`).get() as { props: string }).props).indexes;
    db.exec(`UPDATE bc_tables SET props = json_set(props, '$.indexes', json('${JSON.stringify([futur, { name: 7 }])}')) WHERE name = 'Personnes'`);
    expect(tableDesign(db, 'Personnes').indexes).toEqual([futur]);
    // through the design model (rename of Nom), then alterTable
    let m = fromDesign(tableDesign(db, 'Personnes'));
    m = designReducer(m, { type: 'setName', index: 1, name: 'NomFamille' });
    const req = toSaveRequest(m, 'Personnes', false);
    expect(await alterTable(db, 'Personnes', req.design, req.mapping, { allowDataLoss: false, info: fr })).toEqual({ ok: true });
    const renamed = { ...futur, fields: [{ ...futur.fields[0], name: 'NomFamille' }, futur.fields[1]] };
    expect(raw()).toEqual([renamed, { name: 7 }]);
    expect(savedModel(m, req).indexes?.[0]).toMatchObject({ futur: 1, fields: [{ poids: 2 }, {}] });
    // reconcile: nothing gone leaves the entries untouched; an index whose field is gone goes, the unreadable entry stays
    const P = { name: 'P', fields: [{ name: 'Prénom', desc: false }], unique: false, futur: 3 };
    db.exec(`UPDATE bc_tables SET props = json_set(props, '$.indexes', json('${JSON.stringify([renamed, P, { name: 7 }])}')) WHERE name = 'Personnes'`);
    db.exec('CREATE INDEX "bcxi_Personnes.P" ON "Personnes" ("Prénom" ASC)');
    reconcile(db);
    expect(raw()).toEqual([renamed, P, { name: 7 }]);
    db.exec('DROP INDEX "bcxi_Personnes.P"');
    db.exec('DROP INDEX "bcxi_Personnes.NomPrénom"');
    db.exec('ALTER TABLE "Personnes" DROP COLUMN "Prénom"');
    reconcile(db);
    expect(raw()).toEqual([{ name: 7 }]); // both used Prénom
  });

  it('reconcile drops an index whose field disappeared and recreates a missing SQLite index', () => {
    const N: IndexDef = { name: 'N', fields: [{ name: 'Nom', desc: true }], unique: false };
    createTable(db, personnes([NP, N]));
    db.exec('DROP INDEX "bcxi_Personnes.NomPrénom"'); // another tool, which then drops the column
    db.exec('DROP INDEX "bcxi_Personnes.N"');
    db.exec('ALTER TABLE "Personnes" DROP COLUMN "Prénom"');
    reconcile(db);
    expect(tableDesign(db, 'Personnes').indexes).toEqual([N]);
    expect(sqlOf('bcxi_Personnes.N')).toBe('CREATE INDEX "bcxi_Personnes.N" ON "Personnes" ("Nom" DESC)');
    expect(isExternal(db, tableDesign(db, 'Personnes'))).toBe(false);
  });
  // R16-1: SQLite index names are case-insensitive; reconcile and renameTable must not trip over a case variant.
  const multiIndexes = () => (db.prepare(`SELECT name FROM sqlite_master WHERE type = 'index' AND substr(name, 1, 5) = 'bcxi_'`).all() as { name: string }[]).map((x) => x.name);
  const makeExternal = () => db.exec('CREATE TRIGGER "trg" AFTER INSERT ON "Personnes" BEGIN SELECT 1; END');

  it('a case-only rename of an external table rebuilds its multi-field indexes; reconcile then keeps one per IndexDef', () => {
    createTable(db, personnes());
    makeExternal();
    expect(isExternal(db, tableDesign(db, 'Personnes'))).toBe(true);
    renameTable(db, 'Personnes', 'PERSONNES');
    expect(() => reconcile(db)).not.toThrow();
    expect(multiIndexes()).toEqual(['bcxi_PERSONNES.NomPrénom']);
    expect(tableDesign(db, 'PERSONNES').indexes).toEqual([NP]);
  });

  it('a rename of an external table leaves no orphan multi-field index', () => {
    createTable(db, personnes());
    makeExternal();
    renameTable(db, 'Personnes', 'Gens');
    reconcile(db);
    expect(multiIndexes()).toEqual(['bcxi_Gens.NomPrénom']);
  });

  it('reconcile after another tool renamed the table by case only', () => {
    createTable(db, personnes());
    db.exec('ALTER TABLE "Personnes" RENAME TO "tmp_x"');
    db.exec('ALTER TABLE "tmp_x" RENAME TO "PERSONNES"');
    expect(() => reconcile(db)).not.toThrow();
    expect(multiIndexes()).toEqual(['bcxi_Personnes.NomPrénom']);
    expect(tableDesign(db, 'PERSONNES').indexes).toEqual([NP]);
  });
});
