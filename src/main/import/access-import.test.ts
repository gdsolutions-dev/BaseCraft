import { afterAll, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type MDBReader from 'mdb-reader';
import { localeInfo } from '../../shared/locale-format';
import { listRelations } from '../db/relations';
import { registerFunctions, SYSTEM_DDL } from '../db/file-format';
import { getObject, listObjects, saveObject } from '../db/objects';
import { isTableName, tableDesign } from '../db/schema';
import { findLink } from '../links/store';
import type { AccessExport, ExportDesign, ExportMacro, ExportModule, ExportQuery } from '../../shared/access-export';
import { loadAccessCache, openAccess } from '../links/access';
import { readAccessExport, readExportDesigns, readExportMacros, readExportModules, readExportQueries } from './access-export';
import { importQueries } from './access-queries';
import { accessRelations, finalCodes, importAccess, PAGE, pageSize, type MSysRelRow } from './access-import';

vi.mock('./access-queries', async (orig) => { const m = await orig<typeof import('./access-queries')>(); return { ...m, importQueries: vi.fn(m.importQueries) }; });

const FIX = join(__dirname, '../../../tests/fixtures/access');
const tmp = fs.mkdtempSync(join(os.tmpdir(), 'bcaimp-'));
afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

const memoryBase = () => { const db = new DatabaseSync(':memory:'); registerFunctions(db); for (const ddl of SYSTEM_DDL) db.exec(ddl); return db; };
const open = (n: string) => { const p = join(tmp, n); fs.copyFileSync(join(FIX, n), p); return openAccess(p); };
const all = (db: DatabaseSync, t: string) => db.prepare(`SELECT * FROM "${t}" ORDER BY rowid`).all().map(Object.values);
const userTables = (db: DatabaseSync) => (db.prepare(`SELECT name FROM pragma_table_list WHERE schema = 'main' AND name NOT LIKE 'bc\\_%' ESCAPE '\\' AND name NOT LIKE 'sqlite\\_%' ESCAPE '\\'`).all() as { name: string }[]).map((r) => r.name);

type Tables = { remote: string; name: string }[];
const run = (front: DatabaseSync, r: MDBReader, tables: Tables, o: { linked?: string[]; stopped?: () => boolean; jet3?: boolean; structure?: AccessExport; queries?: ExportQuery[]; designs?: ExportDesign[]; macros?: ExportMacro[]; modules?: ExportModule[] } = {}) =>
  importAccess({ front, r, jet3: o.jet3 ?? false, source: 'Ventes.accdb', tables, linked: o.linked ?? [], info: localeInfo('fr-FR'),
    tick: async () => {}, stopped: o.stopped ?? (() => false), structure: o.structure, queries: o.queries, designs: o.designs, macros: o.macros, modules: o.modules });

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

describe('finalCodes', () => {
  it.each([
    [true, true, true, []], [true, true, false, ['noQueries']], [true, false, true, ['noDesigns']], [true, false, false, ['noQueriesDesigns']],
    [false, true, true, ['macrosOnly']], [false, true, false, ['designsOnly']], [false, false, true, ['formsOnly']], [false, false, false, ['tablesOnly']],
  ])('macros %s, designs %s, queries %s', (macrosRead, designsRead, queriesRead, codes) => {
    expect(finalCodes({ macrosRead, designsRead, queriesRead })).toEqual(codes);
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

    it.skipIf(!present)('with the queries of the export folder: saved, reported, and the report ends with formsOnly', async () => {
      const front = memoryBase(); const ex = readExport();
      const res = await run(front, open('Ventes-complet.accdb'), pair, { structure: ex, queries: readExportQueries(FIXTURE, ex) });
      const lines = res.ok ? res.report.lines : [];
      expect(lines).toContainEqual({ code: 'queryImported', object: 'QParVille' });
      expect(lines).toContainEqual({ code: 'queryImported', object: 'QTotaux' });
      expect(lines.at(-1)).toEqual({ code: 'formsOnly' });
      expect(lines.some((l) => l.code === 'tablesOnly')).toBe(false);
      expect(res.ok && res.queries).toEqual([{ name: 'QParVille', remote: 'QParVille' }, { name: 'QTotaux', remote: 'QTotaux' }]);
      expect(listObjects(front, 'query').map((o) => o.name)).toEqual(['QParVille', 'QTotaux']);
    });

    it.skipIf(!present)('with the forms and reports of the export folder: saved, reported, and the report ends with macrosOnly', async () => {
      const front = memoryBase(); const ex = readExport();
      const res = await run(front, open('Ventes-complet.accdb'), pair, { structure: ex, queries: readExportQueries(FIXTURE, ex), designs: readExportDesigns(FIXTURE, ex) });
      const lines = res.ok ? res.report.lines : [];
      expect(lines).toContainEqual({ code: 'formImported', object: 'FClients' });
      expect(lines).toContainEqual({ code: 'reportImported', object: 'ECommandes' });
      expect(lines.at(-1)).toEqual({ code: 'macrosOnly' });
      expect(lines.some((l) => l.code === 'formsOnly' || l.code === 'tablesOnly')).toBe(false);
      expect(res.ok && res.forms).toEqual([{ name: 'FClients', remote: 'FClients' }]);
      expect(res.ok && res.reports).toEqual([{ name: 'ECommandes', remote: 'ECommandes' }]);
      expect(listObjects(front, 'form').map((o) => o.name)).toEqual(['FClients']);
    });

    it.skipIf(!present)('with the macros: saved and reported, the form event follows, no "not imported" line', async () => {
      const front = memoryBase(); const ex = readExport();
      const res = await run(front, open('Ventes-complet.accdb'), pair, { structure: ex, queries: readExportQueries(FIXTURE, ex), designs: readExportDesigns(FIXTURE, ex), macros: readExportMacros(FIXTURE, ex) });
      const lines = res.ok ? res.report.lines : [];
      expect(lines).toContainEqual({ code: 'macroImported', object: 'MOuvrirEtat' });
      expect(lines.some((l) => ['macrosOnly', 'designsOnly', 'formsOnly', 'tablesOnly', 'noQueries', 'noDesigns', 'noQueriesDesigns'].includes(l.code))).toBe(false);
      expect(res.ok && res.macros).toEqual([{ name: 'MOuvrirEtat', remote: 'MOuvrirEtat' }]);
      expect(listObjects(front, 'macro').map((o) => o.name)).toEqual(['MOuvrirEtat']);
    });

    it.skipIf(!present)('with the modules: saved as comments, the form code-behind too, no "not imported" line', async () => {
      const front = memoryBase(); const ex = readExport();
      const res = await run(front, open('Ventes-complet.accdb'), pair, { structure: ex, queries: readExportQueries(FIXTURE, ex), designs: readExportDesigns(FIXTURE, ex), macros: readExportMacros(FIXTURE, ex), modules: readExportModules(FIXTURE, ex) });
      const lines = res.ok ? res.report.lines : [];
      expect(lines).toContainEqual({ code: 'moduleImported', object: 'ModOutils', n: 5 });
      expect(lines).toContainEqual(expect.objectContaining({ code: 'codeBehindImported', object: 'FClients', part: 'Form_FClients' }));
      expect(lines.some((l) => ['macrosOnly', 'designsOnly', 'formsOnly', 'tablesOnly', 'noQueries', 'noDesigns', 'noQueriesDesigns'].includes(l.code))).toBe(false);
      expect(res.ok && res.modules).toEqual([{ name: 'ModOutils', remote: 'ModOutils' }]);
      expect(listObjects(front, 'module').map((o) => o.name).sort()).toEqual(['Form_FClients', 'ModOutils']);
    });

    it.skipIf(!present)('a failing module savepoint gives the "not imported" final line, and so does a failing macro one', async () => {
      const ex = readExport();
      const bad = { get name(): string { throw new Error('boom'); }, text: 'x' };
      const base = { structure: ex, queries: readExportQueries(FIXTURE, ex), designs: readExportDesigns(FIXTURE, ex) };
      const noModules = await run(memoryBase(), open('Ventes-complet.accdb'), pair, { ...base, macros: readExportMacros(FIXTURE, ex), modules: [bad] as ExportModule[] });
      expect(noModules.ok && noModules.report.lines.at(-1)).toEqual({ code: 'macrosOnly' });
      const noMacros = await run(memoryBase(), open('Ventes-complet.accdb'), pair, { ...base, macros: [bad] as ExportMacro[], modules: readExportModules(FIXTURE, ex) });
      expect(noMacros.ok && noMacros.report.lines.at(-1)).toEqual({ code: 'macrosOnly' });
    });

    it.skipIf(!present)('with the macros but without the queries and the forms and reports: noQueriesDesigns', async () => {
      const ex = readExport();
      const res = await run(memoryBase(), open('Ventes-complet.accdb'), pair, { structure: ex, macros: readExportMacros(FIXTURE, ex) });
      expect(res.ok && res.report.lines.at(-1)).toEqual({ code: 'noQueriesDesigns' });
    });

    it.skipIf(!present)('with the forms and reports but without the queries: the report ends with designsOnly', async () => {
      const ex = readExport();
      const res = await run(memoryBase(), open('Ventes-complet.accdb'), pair, { structure: ex, designs: readExportDesigns(FIXTURE, ex) });
      const lines = res.ok ? res.report.lines : [];
      expect(lines).toContainEqual({ code: 'formImported', object: 'FClients' });
      expect(lines.at(-1)).toEqual({ code: 'designsOnly' });
      expect(lines.some((l) => l.code === 'macrosOnly' || l.code === 'formsOnly' || l.code === 'tablesOnly')).toBe(false);
    });

    it.skipIf(!present)('a Stop during the tables leaves no query', async () => {
      const front = memoryBase(); const ex = readExport(); let ticks = 0;
      const res = await run(front, open('Ventes-complet.accdb'), pair, { structure: ex, queries: readExportQueries(FIXTURE, ex), stopped: () => ++ticks >= 2 });
      expect(res).toEqual({ ok: false, reason: 'cancelled' });
      expect(listObjects(front, 'query')).toEqual([]);
    });

    it.skipIf(!present)('without queries: the report ends with tablesOnly and queries is empty', async () => {
      const res = await run(memoryBase(), open('Ventes-complet.accdb'), pair, { structure: readExport() });
      expect(res.ok && res.queries).toEqual([]);
      expect(res.ok && res.report.lines.at(-1)).toEqual({ code: 'tablesOnly' });
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

  it('an unexpected failure of the queries keeps the tables and ends the report with tablesOnly', async () => {
    const front = memoryBase();
    vi.mocked(importQueries).mockImplementationOnce(() => { throw new Error('boom'); });
    const res = await run(front, double({ T: { columns: [text('A')], rows: [{ A: 'x' }] } }), [{ remote: 'T', name: 'T' }], { queries: [{ name: 'Q', sql: 'SELECT T.A FROM T', queryType: 0, connect: '' }] });
    expect(res.ok && res.queries).toEqual([]);
    expect(res.ok && res.report.lines.at(-1)).toEqual({ code: 'tablesOnly' });
    expect(all(front, 'T')).toEqual([['x']]);
    expect(listObjects(front, 'query')).toEqual([]);
  });

  it('an unexpected failure of the designs keeps the tables and the queries and ends the report as before', async () => {
    const front = memoryBase();
    const boom = { kind: 'form', name: 'B', get text(): string { throw new Error('boom'); } } as unknown as ExportDesign;
    const ok: ExportDesign = { kind: 'form', name: 'A', text: 'Begin Form\n Begin\n  Begin Section\n   Begin\n   End\n  End\n End\nEnd\n' };
    const res = await run(front, double({ T: { columns: [text('A')], rows: [{ A: 'x' }] } }), [{ remote: 'T', name: 'T' }],
      { queries: [{ name: 'Q', sql: 'SELECT T.A FROM T', queryType: 0, connect: '' }], designs: [ok, boom] });
    expect(res.ok && res.forms).toEqual([]);
    expect(res.ok && res.report.lines.at(-1)).toEqual({ code: 'formsOnly' });
    expect(all(front, 'T')).toEqual([['x']]);
    expect(listObjects(front, 'query').map((o) => o.name)).toEqual(['Q']);
    expect(listObjects(front, 'form')).toEqual([]);
  });

  it('embedded macros follow the numbered names of this import even without the macros box', async () => {
    const front = memoryBase();
    saveObject(front, 'form', 'F', { sections: [] }, null);
    const f = (name: string, body: string): ExportDesign => ({ kind: 'form', name, text: `Begin Form\n Begin\n  Begin Section\n   Begin\n${body}\n   End\n  End\n End\nEnd\n` });
    const btn = '    Begin CommandButton\n     Name ="B"\n     OnClickEmMacro = Begin\n      Version =196611\n      Begin\n       Action ="OpenForm"\n       Argument ="F"\n      End\n     End\n    End';
    const res = await run(front, double({ T: { columns: [text('A')], rows: [{ A: 'x' }] } }), [{ remote: 'T', name: 'T' }], { designs: [f('F', ''), f('G', btn)] });
    expect(res.ok && res.forms).toEqual([{ name: 'F1', remote: 'F' }, { name: 'G', remote: 'G' }]);
    expect(JSON.stringify(getObject(front, 'form', 'G')!.definition)).toContain('"F1"');
    const lines = res.ok ? res.report.lines : [];
    expect(lines.some((l) => l.code.startsWith('macro') && l.code !== 'macrosOnly')).toBe(false);
    expect(lines.at(-1)).toEqual({ code: 'designsOnly' });
  });

  it('the savepoint removes the queries the real import saved before it threw', async () => {
    const front = memoryBase();
    const real = await vi.importActual<typeof import('./access-queries')>('./access-queries');
    vi.mocked(importQueries).mockImplementationOnce((db, q, t) => { real.importQueries(db, q, t); expect(listObjects(db, 'query')).toHaveLength(1); throw new Error('boom'); });
    const res = await run(front, double({ T: { columns: [text('A')], rows: [{ A: 'x' }] } }), [{ remote: 'T', name: 'T' }], { queries: [{ name: 'Q', sql: 'SELECT T.A FROM T', queryType: 0, connect: '' }] });
    expect(listObjects(front, 'query')).toEqual([]);
    expect(all(front, 'T')).toEqual([['x']]);
    expect(res.ok && res.report.lines.at(-1)).toEqual({ code: 'tablesOnly' });
  });

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

describe('relink (linked tables of the front-end)', () => {
  const backPath = join(tmp, 'Ventes.accdb');
  const importedFile = join(tmp, 'Front-end.accdb');
  const frontEndPath = join(tmp, 'mine.basecraft');
  // a front-end reader holding one table linked, under another name, to Clients of the real back-end
  const frontReader = (): MDBReader => ({ getTable: (n: string) => {
    if (n !== 'MSysObjects') throw new Error('no table');
    return { getData: () => [{ Name: 'ClientsLies', Type: 6, Database: backPath, ForeignName: 'Clients' }, { Name: 'Odbc', Type: 4, Database: '', ForeignName: '' }] };
  } }) as unknown as MDBReader;
  const setup = () => {
    fs.copyFileSync(join(FIX, 'Ventes.accdb'), backPath); fs.writeFileSync(importedFile, '');
    const front = memoryBase();
    const back = openAccess(backPath);
    const cache = loadAccessCache(back, ['Clients']).db;
    // the session's catalogue: a local table, else a link read from its file
    const catalog = { table: (n: string) => { if (isTableName(front, n)) return tableDesign(front, n); const l = findLink(front, n); return l ? tableDesign(cache, l.remote) : null; },
      query: () => null };
    const o = { linked: ['ClientsLies', 'Odbc'], relink: { frontEndPath, importedFile, open: (p: string) => openAccess(p), catalog } };
    return { front, o };
  };

  it('creates the links, reports them, and the queries and designs reading one find their source', async () => {
    const { front, o } = setup();
    const query: ExportQuery = { name: 'QClients', sql: 'SELECT * FROM ClientsLies', queryType: 0, connect: '' };
    const text = ['Begin Form', ' RecordSource ="ClientsLies"', ' Begin', '  Begin Section', '   Begin', '   End', '  End', ' End', 'End', ''].join(String.fromCharCode(10));
    const form: ExportDesign = { kind: 'form', name: 'F', text };
    const res = await importAccess({ front, r: frontReader(), jet3: false, source: 'Front-end.accdb', tables: [], info: localeInfo('fr-FR'), tick: async () => {},
      stopped: () => false, queries: [query], designs: [form], ...o });
    expect(res.ok && res.links).toEqual([{ name: 'ClientsLies', remote: 'ClientsLies' }]);
    const lines = res.ok ? res.report.lines : [];
    expect(lines).toContainEqual({ code: 'tableRelinked', object: 'ClientsLies', part: 'Ventes.accdb' });
    expect(lines).toContainEqual({ code: 'tableLinked', object: 'Odbc', reason: 'otherSource' });
    expect(lines).toContainEqual({ code: 'queryImported', object: 'QClients' });
    expect(lines).toContainEqual({ code: 'formImported', object: 'F' });
    expect(lines.some((l) => l.code === 'querySourceMissing' || l.code === 'designSourceMissing')).toBe(false);
    expect(findLink(front, 'ClientsLies')?.remote).toBe('Clients');
  });

  it('a failing links savepoint gives one line per linked table, and the imported tables stay', async () => {
    const { front, o } = setup();
    const real = openAccess(backPath); // its tables, with the front-end's linked rows
    const mixed = Object.assign(Object.create(real), { getTable: (n: string) => (n === 'MSysObjects' ? frontReader().getTable(n) : real.getTable(n)) }) as MDBReader;
    const res = await importAccess({ front, r: mixed, jet3: false, source: 'Front-end.accdb', tables: [{ remote: 'Clients', name: 'Clients' }],
      info: localeInfo('fr-FR'), tick: async () => {}, stopped: () => false, linked: o.linked,
      relink: { ...o.relink, open: () => { throw new Error('boom'); } } });
    expect(res.ok).toBe(true);
    const lines = res.ok ? res.report.lines : [];
    expect(lines.filter((l) => l.code === 'tableLinked' || l.code === 'tableRelinked')).toEqual([
      { code: 'tableLinked', object: 'Odbc', reason: 'otherSource' }, { code: 'tableLinked', object: 'ClientsLies', reason: 'cannotOpen' }]);
    expect(res.ok && res.links).toEqual([]);
    expect(userTables(front)).toEqual(['Clients']);
  });

  it('a link under a numbered name is the source of the queries and designs reading its Access name', async () => {
    const { front, o } = setup();
    front.exec('CREATE TABLE "ClientsLies" (a)'); // the name is taken: the link becomes ClientsLies1
    const query: ExportQuery = { name: 'QClients', sql: 'SELECT * FROM ClientsLies', queryType: 0, connect: '' };
    const text = ['Begin Form', ' RecordSource ="ClientsLies"', ' Begin', '  Begin Section', '   Begin', '   End', '  End', ' End', 'End', ''].join(String.fromCharCode(10));
    const res = await importAccess({ front, r: frontReader(), jet3: false, source: 'Front-end.accdb', tables: [], info: localeInfo('fr-FR'), tick: async () => {},
      stopped: () => false, queries: [query], designs: [{ kind: 'form', name: 'F', text }], ...o });
    const lines = res.ok ? res.report.lines : [];
    expect(res.ok && res.links).toEqual([{ name: 'ClientsLies1', remote: 'ClientsLies' }]);
    expect(lines).toContainEqual({ code: 'queryImported', object: 'QClients' });
    expect(lines.some((l) => l.code === 'designSourceMissing' || l.code === 'querySourceMissing')).toBe(false);
    expect(listObjects(front, 'query').map((q) => q.name)).toEqual(['QClients']);
    for (const n of ['F', 'QClients']) expect(JSON.stringify(front.prepare('SELECT definition FROM bc_objects WHERE name = ?').get(n))).toContain('ClientsLies1');
  });

  it('without relink the linked tables are only reported, as before', async () => {
    const { front, o } = setup();
    const res = await run(front, frontReader(), [], { linked: o.linked });
    expect(res.ok && res.links).toEqual([]);
    expect(res.ok && res.report.lines.filter((l) => l.code === 'tableLinked')).toEqual([{ code: 'tableLinked', object: 'ClientsLies' }, { code: 'tableLinked', object: 'Odbc' }]);
    expect(findLink(front, 'ClientsLies')).toBeUndefined();
  });
});
