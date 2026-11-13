import { afterAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type MDBReader from 'mdb-reader';
import { localeInfo } from '../../shared/locale-format';
import { listRelations } from '../db/relations';
import { registerFunctions, SYSTEM_DDL } from '../db/file-format';
import { tableDesign } from '../db/schema';
import type { AccessExport } from '../../shared/access-export';
import { loadAccessCache, openAccess } from '../links/access';
import { readAccessExport } from './access-export';
import { accessRelations, importAccess, PAGE, pageSize, type MSysRelRow } from './access-import';

const FIX = join(__dirname, '../../../tests/fixtures/access');
const tmp = fs.mkdtempSync(join(os.tmpdir(), 'bcaimp-'));
afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

const memoryBase = () => { const db = new DatabaseSync(':memory:'); registerFunctions(db); for (const ddl of SYSTEM_DDL) db.exec(ddl); return db; };
const open = (n: string) => { const p = join(tmp, n); fs.copyFileSync(join(FIX, n), p); return openAccess(p); };
const all = (db: DatabaseSync, t: string) => db.prepare(`SELECT * FROM "${t}" ORDER BY rowid`).all().map(Object.values);
const userTables = (db: DatabaseSync) => (db.prepare(`SELECT name FROM pragma_table_list WHERE schema = 'main' AND name NOT LIKE 'bc\\_%' ESCAPE '\\' AND name NOT LIKE 'sqlite\\_%' ESCAPE '\\'`).all() as { name: string }[]).map((r) => r.name);

type Tables = { remote: string; name: string }[];
const run = (front: DatabaseSync, r: MDBReader, tables: Tables, o: { linked?: string[]; stopped?: () => boolean; jet3?: boolean; structure?: AccessExport } = {}) =>
  importAccess({ front, r, jet3: o.jet3 ?? false, source: 'Ventes.accdb', tables, linked: o.linked ?? [], info: localeInfo('fr-FR'),
    tick: async () => {}, stopped: o.stopped ?? (() => false), structure: o.structure });

const row = (o: Partial<MSysRelRow>): MSysRelRow => ({ szRelationship: 'ClientsCommandes', grbit: 0, ccolumn: 1, icolumn: 0,
  szObject: 'Commandes', szColumn: 'Client', szReferencedObject: 'Clients', szReferencedColumn: 'N°', ...o });
const LOCAL = new Map([['Clients', 'Clients1'], ['Commandes', 'Commandes']]);

describe('accessRelations', () => {
  it('child and parent, local names, flags', () => {
    const { relations } = accessRelations([row({ grbit: 0x1100 })], LOCAL);
    expect(relations).toEqual([{ access: 'ClientsCommandes', rel: { name: '', parentTable: 'Clients1', parentFields: ['N°'],
      childTable: 'Commandes', childFields: ['Client'], enforce: true, cascadeUpdate: true, cascadeDelete: true, joinType: 1 } }]);
  });
  it('not enforced, join types, two fields in icolumn order', () => {
    expect(accessRelations([row({ grbit: 0x2 })], LOCAL).relations[0].rel.enforce).toBe(false);
    expect(accessRelations([row({ grbit: 0x01000000 })], LOCAL).relations[0].rel.joinType).toBe(2);
    expect(accessRelations([row({ grbit: 0x02000000 })], LOCAL).relations[0].rel.joinType).toBe(3);
    const two = accessRelations([row({ icolumn: 1, ccolumn: 2, szColumn: 'B', szReferencedColumn: 'b' }),
      row({ icolumn: 0, ccolumn: 2, szColumn: 'A', szReferencedColumn: 'a' })], LOCAL).relations[0].rel;
    expect(two.childFields).toEqual(['A', 'B']); expect(two.parentFields).toEqual(['a', 'b']);
  });
  it('a system relationship is silent, a table not imported is skipped', () => {
    const r = accessRelations([row({ szRelationship: 'S', szObject: 'MSysNavPaneGroups', szReferencedObject: 'MSysNavPaneGroupCategories' }),
      row({ szRelationship: 'X', szReferencedObject: 'Produits' })], LOCAL);
    expect(r.relations).toEqual([]); expect(r.skipped).toEqual([{ access: 'X', reason: 'tableNotImported' }]);
  });
});

describe('pageSize', () => {
  it('BASECRAFT_E2E_IMPORT_PAGE is read only when BASECRAFT_E2E is 1', () => {
    const keep = { ...process.env };
    try {
      process.env.BASECRAFT_E2E_IMPORT_PAGE = '1';
      delete process.env.BASECRAFT_E2E; expect(pageSize()).toBe(PAGE);
      process.env.BASECRAFT_E2E = '0'; expect(pageSize()).toBe(PAGE);
      process.env.BASECRAFT_E2E = '1'; expect(pageSize()).toBe(1);
    } finally { process.env = keep; }
  });
});

describe('importAccess', () => {
  it.each(['Ventes.accdb', 'Ventes.mdb'])('%s: the rows loadAccessCache gives, under the local names', async (n) => {
    const front = memoryBase(); const r = open(n);
    const res = await run(front, r, [{ remote: 'Clients', name: 'Clients1' }, { remote: 'Commandes', name: 'Commandes' }, { remote: 'Divers', name: 'Divers' }]);
    expect(res.ok && res.tables).toEqual([{ name: 'Clients1', remote: 'Clients', rows: 4 }, { name: 'Commandes', remote: 'Commandes', rows: 5 }, { name: 'Divers', remote: 'Divers', rows: 1 }]);
    const cache = loadAccessCache(r, ['Clients', 'Commandes', 'Divers']).db;
    for (const [a, b] of [['Clients', 'Clients1'], ['Commandes', 'Commandes'], ['Divers', 'Divers']]) expect(all(front, b)).toEqual(all(cache, a));
  });

  it('report lines of Ventes.accdb', async () => {
    const res = await run(memoryBase(), open('Ventes.accdb'), [{ remote: 'Clients', name: 'Clients' }, { remote: 'Divers', name: 'Divers' }], { linked: ['Stock'] });
    const lines = res.ok ? res.report.lines : [];
    expect(res.ok && res.report.source).toBe('Ventes.accdb');
    expect(lines).toContainEqual({ code: 'tableImported', object: 'Clients', n: 4 });
    expect(lines).toContainEqual({ code: 'keyAssumed', object: 'Clients', part: 'N°' });
    expect(lines).toContainEqual({ code: 'fieldSkipped', object: 'Clients', part: 'Photo' });
    expect(lines).toContainEqual({ code: 'keyNotRead', object: 'Divers' });
    expect(lines).toContainEqual({ code: 'tableLinked', object: 'Stock' });
    expect(lines.slice(-2)).toEqual([{ code: 'structureNotRead' }, { code: 'tablesOnly' }]);
  });

  it('Stop leaves nothing, and the same import then succeeds', async () => {
    const front = memoryBase(); let ticks = 0;
    const stopped = await run(front, open('Ventes.accdb'), [{ remote: 'Clients', name: 'Clients' }, { remote: 'Commandes', name: 'Commandes' }], { stopped: () => ++ticks >= 2 });
    expect(stopped).toEqual({ ok: false, reason: 'cancelled' });
    expect(userTables(front)).toEqual([]);
    expect((await run(front, open('Ventes.accdb'), [{ remote: 'Clients', name: 'Clients' }])).ok).toBe(true);
  });

  describe('with the export folder (E2)', () => {
    const FIXTURE = join(FIX, 'Ventes-complet.export');
    const present = fs.existsSync(join(FIX, 'Ventes-complet.accdb'));
    const readExport = (): AccessExport => { const r = readAccessExport(FIXTURE, 'Ventes-complet.accdb'); if (!r.ok) throw new Error(r.reason); return r.export; };
    const count = (db: DatabaseSync, t: string) => (db.prepare(`SELECT count(*) AS n FROM "${t}"`).get() as { n: number }).n;
    const pair: Tables = [{ remote: 'Clients', name: 'Clients' }, { remote: 'Commandes', name: 'Commandes' }];

    it.skipIf(!present)('Ventes-complet with its export: keys, the two-field index, rules and the lookup are in the table designs', async () => {
      const front = memoryBase(); const ex = readExport();
      const res = await run(front, open('Ventes-complet.accdb'), pair, { structure: ex });
      const lines = res.ok ? res.report.lines : [];
      expect(lines).toContainEqual({ code: 'structureExact', object: 'Commandes' });
      expect(lines).toContainEqual({ code: 'structureExact', object: 'Clients' });
      expect(lines.some((l) => l.code === 'keyAssumed' || l.code === 'keyNotRead' || l.code === 'structureNotRead')).toBe(false);
      expect(lines).toContainEqual({ code: 'relationCreated', object: 'ClientsCommandes' });
      const d = tableDesign(front, 'Commandes');
      const p = (n: string) => d.fields.find((f) => f.name === n)!.props;
      expect(d.indexes).toEqual([{ name: 'Idx', unique: true, fields: [{ name: 'Client', desc: false }, { name: 'Le', desc: false }] }]);
      expect(p('N°').primaryKey).toBe(true);
      expect(p('Client').required).toBe(true);
      expect(['N°', 'Montant', 'Le', 'Quantité', 'Remise', 'Poids', 'Taux', 'Lot'].filter((n) => p(n).required)).toEqual([]);
      expect(p('Client').lookup).toEqual({ kind: 'table', table: 'SELECT [N°], Nom FROM Clients; ', limitToList: true, displayControl: 'comboBox', boundColumn: 1,
        columnCount: 2, columnHeads: false, columnWidths: [0], listRows: 16, listWidth: 0, allowValueListEdits: false });
      expect(p('Client').decimalPlaces).toBe('auto');
      expect(p('Montant')).toMatchObject({ caption: 'Montant TTC', defaultValue: '0', format: '#,##0.00 €;-#,##0.00 €', decimalPlaces: 'auto' });
      expect(p('Quantité')).toMatchObject({ validationRule: '>0', validationText: 'La quantité doit être positive', defaultValue: '1', decimalPlaces: 'auto' });
      for (const n of ['Remise', 'Poids', 'Taux', 'Lot']) expect(p(n)).toMatchObject({ defaultValue: '0', decimalPlaces: 'auto' });
      expect(d.fields.filter((f) => f.props.caption !== undefined).map((f) => f.name)).toEqual(['Montant']);
      expect(d.fields.filter((f) => f.props.validationRule !== undefined).map((f) => f.name)).toEqual(['Quantité']);
      // Clients: key, three text fields that take an empty string, the plain Long Text, the Yes/No with its default and format
      const c = tableDesign(front, 'Clients');
      const q = (n: string) => c.fields.find((f) => f.name === n)!.props;
      expect(c.indexes ?? []).toEqual([]);
      expect(q('N°').primaryKey).toBe(true);
      for (const n of ['Nom', 'Ville', 'Remarque']) expect(q(n)).toMatchObject({ allowZeroLength: true, required: false });
      expect(q('Remarque').textFormat).toBe('plain');
      // a Yes/No default `No` is carried as the literal the table designer stores
      expect(q('Actif')).toMatchObject({ format: 'Yes/No', defaultValue: 'False' });
      expect(c.fields.some((f) => f.name === 'Photo')).toBe(false);
      expect(lines.some((l) => l.code === 'propertyDropped' || l.code === 'indexDropped')).toBe(false);
      expect(count(front, 'Commandes')).toBe(5);
    });

    it.skipIf(!present)('a row the carried structure refuses: the table is imported without it and reported', async () => {
      const front = memoryBase(); const ex = readExport();
      const tbl = ex.tables.find((t) => t.name === 'Commandes')!;
      tbl.indexes.push({ name: 'UniqueLot', primary: false, unique: true, foreign: false, fields: [{ name: 'Lot', desc: false }] }); // Lot holds 1 twice
      const res = await run(front, open('Ventes-complet.accdb'), pair, { structure: ex });
      const lines = res.ok ? res.report.lines : [];
      expect(lines).toContainEqual({ code: 'structureNotRead', object: 'Commandes' });
      expect(lines).toContainEqual({ code: 'keyAssumed', object: 'Commandes', part: 'N°' });
      expect(lines).toContainEqual({ code: 'structureExact', object: 'Clients' });
      expect(lines.filter((l) => l.code === 'structureNotRead')).toHaveLength(1);
      expect(count(front, 'Commandes')).toBe(5);
      expect(tableDesign(front, 'Commandes').fields.find((f) => f.name === 'Lot')!.props.indexed).toBe('no');
      expect(userTables(front).sort()).toEqual(['Clients', 'Commandes']);
    });

    it.skipIf(!present)('a structure withStructure cannot apply at all: the table gets the file-only lines and structureNotRead', async () => {
      const front = memoryBase(); const ex = readExport();
      ex.tables.find((t) => t.name === 'Commandes')!.validationText = 'x'.repeat(300);
      const res = await run(front, open('Ventes-complet.accdb'), pair, { structure: ex });
      const lines = res.ok ? res.report.lines : [];
      expect(lines).toContainEqual({ code: 'keyAssumed', object: 'Commandes', part: 'N°' });
      expect(lines).toContainEqual({ code: 'structureNotRead', object: 'Commandes' });
      // The reason withStructure gave comes first, then structureNotRead.
      const why = lines.findIndex((l) => l.code === 'propertyDropped' && l.object === 'Commandes' && l.part === undefined);
      expect(why).toBeGreaterThanOrEqual(0);
      expect(why).toBeLessThan(lines.findIndex((l) => l.code === 'structureNotRead' && l.object === 'Commandes'));
      expect(lines).not.toContainEqual({ code: 'structureExact', object: 'Commandes' });
      expect(lines).toContainEqual({ code: 'structureExact', object: 'Clients' });
      expect(count(front, 'Commandes')).toBe(5);
    });

    it.skipIf(!present)('a table the export does not hold keeps the file-only level', async () => {
      const front = memoryBase(); const ex = readExport();
      ex.tables = ex.tables.filter((t) => t.name !== 'Clients');
      const res = await run(front, open('Ventes-complet.accdb'), pair, { structure: ex });
      const lines = res.ok ? res.report.lines : [];
      expect(lines).toContainEqual({ code: 'keyAssumed', object: 'Clients', part: 'N°' });
      expect(lines).toContainEqual({ code: 'structureExact', object: 'Commandes' });
      expect(lines.filter((l) => l.code === 'structureNotRead')).toEqual([{ code: 'structureNotRead' }]);
      expect(lines.slice(-2)).toEqual([{ code: 'structureNotRead' }, { code: 'tablesOnly' }]);
    });

    it.skipIf(!present)('a table is matched to the export by sameName', async () => {
      const front = memoryBase(); const ex = readExport();
      ex.tables.find((t) => t.name === 'Commandes')!.name = 'COMMANDES';
      const res = await run(front, open('Ventes-complet.accdb'), [{ remote: 'Commandes', name: 'Commandes' }], { structure: ex });
      expect(res.ok && res.report.lines).toContainEqual({ code: 'structureExact', object: 'Commandes' });
    });

    it.skipIf(!present)('without structure, the lines are those of the file alone', async () => {
      const res = await run(memoryBase(), open('Ventes-complet.accdb'), pair);
      const lines = res.ok ? res.report.lines : [];
      expect(lines.some((l) => l.code === 'structureExact')).toBe(false);
      expect(lines).toContainEqual({ code: 'keyAssumed', object: 'Commandes', part: 'N°' });
      expect(lines.slice(-2)).toEqual([{ code: 'structureNotRead' }, { code: 'tablesOnly' }]);
    });
  });

  // Reader doubles: a table is { columns, rows }; the relationship rows are literal.
  const text = (name: string) => ({ name, type: 'text', size: 100, autoLong: false });
  const long = (name: string, autoLong = false) => ({ name, type: 'long', size: 4, autoLong });
  type Dbl = Record<string, { columns: object[]; rows: Record<string, unknown>[] }>;
  const double = (tables: Dbl, rel: MSysRelRow[] = []) => ({
    getTable: (n: string) => {
      if (n === 'MSysRelationships') return { name: n, rowCount: rel.length, getColumns: () => [], getData: () => rel };
      const t = tables[n];
      return { name: n, rowCount: t.rows.length, getColumns: () => t.columns, getData: (o: { rowOffset?: number; rowLimit?: number } = {}) => t.rows.slice(o.rowOffset ?? 0, (o.rowOffset ?? 0) + (o.rowLimit ?? 1e9)) };
    },
  }) as unknown as MDBReader;
  const parentChild = (childRows: Record<string, unknown>[], extraParent: object[] = [], parentKey = true): Dbl => ({
    Clients: { columns: [long('N°', parentKey), text('Nom'), ...extraParent], rows: [{ 'N°': 1, Nom: 'A' }, { 'N°': 2, Nom: 'B' }] },
    Commandes: { columns: [long('N°', true), long('Client')], rows: childRows },
  });
  const both: Tables = [{ remote: 'Clients', name: 'Clients' }, { remote: 'Commandes', name: 'Commandes' }];

  it('an empty table is created with no row', async () => {
    const front = memoryBase();
    const res = await run(front, double({ T: { columns: [text('A')], rows: [] } }), [{ remote: 'T', name: 'T' }]);
    expect(res.ok && res.tables[0].rows).toBe(0);
    expect(userTables(front)).toEqual(['T']);
  });

  it('values that do not fit become empty and are counted per field', async () => {
    const front = memoryBase();
    const t = { T: { columns: [{ name: 'B', type: 'byte' }], rows: [{ B: 300 }, { B: 5 }, { B: null }, { B: 400 }] } };
    const res = await run(front, double(t), [{ remote: 'T', name: 'T' }]);
    expect(res.ok && res.report.lines).toContainEqual({ code: 'valuesLost', object: 'T', part: 'B', n: 2 });
    expect(all(front, 'T')).toEqual([[null], [5], [null], [null]]);
  });

  it('an enforced relationship on the AutoNumber key is created with its cascades', async () => {
    const front = memoryBase();
    const r = double(parentChild([{ 'N°': 1, Client: 1 }, { 'N°': 2, Client: 2 }]), [row({ grbit: 0x1100 })]);
    const res = await run(front, r, both);
    expect(res.ok && res.report.lines).toContainEqual({ code: 'relationCreated', object: 'ClientsCommandes' });
    expect(listRelations(front)[0]).toMatchObject({ cascadeDelete: true, cascadeUpdate: true, enforce: true });
  });

  it('a parent field that is not a known key: created not enforced', async () => {
    const front = memoryBase();
    const r = double(parentChild([{ 'N°': 1, Client: 1 }], [], false), [row({})]); // N° is a plain Long here: no key read
    const res = await run(front, r, both);
    expect(res.ok && res.report.lines).toContainEqual({ code: 'relationNotEnforced', object: 'ClientsCommandes', reason: 'parentNotUnique' });
    expect(listRelations(front)[0].enforce).toBe(false);
  });

  it('rows that break it: created not enforced', async () => {
    const front = memoryBase();
    const r = double(parentChild([{ 'N°': 1, Client: 99 }]), [row({ grbit: 0x1100 })]);
    const res = await run(front, r, both);
    expect(res.ok && res.report.lines).toContainEqual({ code: 'relationNotEnforced', object: 'ClientsCommandes', reason: 'violations' });
    expect(listRelations(front)[0]).toMatchObject({ enforce: false, cascadeUpdate: false, cascadeDelete: false });
  });

  it('a field of a skipped column: ignored, the tables are imported', async () => {
    const front = memoryBase();
    const t = parentChild([{ 'N°': 1, Client: 1 }], [{ name: 'Photo', type: 'complex' }]);
    const res = await run(front, double(t, [row({ szRelationship: 'X', szReferencedColumn: 'Photo' })]), both);
    expect(res.ok).toBe(true);
    expect(res.ok && res.report.lines).toContainEqual({ code: 'relationIgnored', object: 'X', reason: 'fieldsMismatch' });
    expect(listRelations(front)).toEqual([]);
  });

  it('a table not picked: ignored', async () => {
    const front = memoryBase();
    const res = await run(front, double(parentChild([{ 'N°': 1, Client: 1 }]), [row({ szRelationship: 'X' })]), [{ remote: 'Commandes', name: 'Commandes' }]);
    expect(res.ok && res.report.lines).toContainEqual({ code: 'relationIgnored', object: 'X', reason: 'tableNotImported' });
  });
});
