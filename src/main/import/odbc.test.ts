import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { DatabaseSync as Db } from 'node:sqlite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import en from '../../shared/i18n/en.json';
import { localeInfo } from '../../shared/locale-format';
import { createBaseFile, openBaseFile } from '../db/file-format';
import { tableDesign } from '../db/schema';
import { liveDriver, makeLiveSource } from './odbc.live';
import {
  connectionString, importOdbcTable, isqlRunner, kindOfSqlType, odbcFields, odbcLabel, parseIsql, powershellRunner, type OdbcRunner,
} from './odbc';
import type { ImportTexts } from './text-import';

const info = localeInfo('fr-FR');
const texts: ImportTexts = {
  fieldPrefix: 'Champ', idName: 'N°', errorSuffix: '_ErreursImportation',
  errorFields: { error: 'Erreur', field: 'Champ', line: 'Ligne' }, messages: en.fieldError, log: en.importText.log,
};
const req = (o: Partial<Parameters<typeof connectionString>[0]> = {}) => ({ dsn: '', connection: '', user: '', password: '', ...o });

describe('connection string', () => {
  it('a DSN or a string, then the login; braces for what would end a value', () => {
    expect(connectionString(req({ dsn: 'Sales' }))).toBe('DSN=Sales');
    expect(connectionString(req({ dsn: 'Sales', user: 'bob', password: 'p' }))).toBe('DSN=Sales;UID=bob;PWD=p');
    expect(connectionString(req({ connection: 'Driver={SQLite3 ODBC Driver};Database=C:\\x.db;;', password: 'a;b}c' }))).toBe('Driver={SQLite3 ODBC Driver};Database=C:\\x.db;PWD={a;b}}c}');
    expect(connectionString(req({ dsn: 'My DSN', user: ' u' }))).toBe('DSN=My DSN;UID={ u}');
  });
  it('the label never carries a login', () => {
    expect(odbcLabel(req({ dsn: 'Sales', password: 'secret' }))).toBe('Sales');
    expect(odbcLabel(req({ connection: 'Driver={X};Server=s;UID=bob;PWD={a;b};Database=d' }))).toBe('Driver={X};Server=s;UID=***;PWD=***;Database=d');
  });
});

describe('isql output', () => {
  it('types, parsing, refusal of a broken row', () => {
    expect([[4, 10], [-7, 1], [93, 19], [12, 50], [12, 5000], [-1, 0], [-2, 4], [8, 53], [3, 10]].map(([t, s]) => kindOfSqlType(t!, s!)))
      .toEqual(['int', 'bool', 'date', 'text', 'longText', 'longText', 'other', 'float', 'float']);
    expect(parseIsql('A\x1fB\n1\x1fx\n2\x1f\n')).toEqual({ header: ['A', 'B'], rows: [['1', 'x'], ['2', '']] });
    expect(parseIsql('')).toEqual({ header: [], rows: [] });
    expect(() => parseIsql('A\x1fB\n1\x1fx\ny\n')).toThrow('bc:odbc|failed|');
  });
  it('a missing program is bc:odbc|unavailable', async () => {
    // isql is absent on a Windows runner, and may be absent elsewhere: either way the error is a bc: one, never a crash
    await expect(isqlRunner().dsns().then(() => 'ok', (e: Error) => e.message)).resolves.toMatch(/^(ok|bc:odbc\|)/);
  });
});

describe('fields', () => {
  it('names made valid and unique, a binary column skipped and named', () => {
    const r = odbcFields([{ name: 'id', kind: 'int', size: 10 }, { name: 'ID', kind: 'text', size: 600 }, { name: 'photo', kind: 'other', size: 0 }, { name: 'a.b', kind: 'text', size: 20 }]);
    expect(r.fields.map((f) => [f.name, f.type, f.skip, f.size])).toEqual([
      ['id', 'longInteger', false, undefined], ['ID_2', 'shortText', false, 255], ['photo', 'shortText', true, undefined], ['a_b', 'shortText', false, 20]]);
    expect(r.skipped).toEqual(['photo']);
  });
});

describe('import with a fake runner', () => {
  let dir: string; let db: Db;
  beforeAll(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bcodbc-'));
    createBaseFile(path.join(dir, 't.basecraft'), '0.0.0');
    db = openBaseFile(path.join(dir, 't.basecraft'), 'write', '0.0.0').db;
  });
  afterAll(() => { db.close(); fs.rmSync(dir, { recursive: true, force: true }); });
  const runner: OdbcRunner = {
    dsns: async () => [], tables: async () => [{ name: 'Clients', schema: '' }],
    read: async () => ({
      columns: [{ name: 'id', kind: 'int', size: 10 }, { name: 'nom', kind: 'text', size: 50 }, { name: 'solde', kind: 'float', size: 15 }, { name: 'actif', kind: 'bool', size: 1 },
        { name: 'ne', kind: 'date', size: 19 }, { name: 'photo', kind: 'other', size: 0 }],
      rows: [['1', 'Zoé; "x"', '12.5', '1', '2024-05-17 13:01:02', null], ['2', null, null, '0', null, null]],
    }),
  };
  it('creates the table with typed fields and converted values; the skipped column is reported', async () => {
    const ticks: number[] = [];
    const r = await importOdbcTable(db, runner, 'DSN=x', { name: 'Clients', schema: '' }, 'Clients', info, texts, async (d) => { ticks.push(d); });
    expect(r.result).toMatchObject({ ok: true, table: 'Clients', imported: 2, errors: 0 });
    expect(r.skipped).toEqual(['photo']);
    expect(ticks.at(-1)).toBe(2);
    expect(tableDesign(db, 'Clients').fields.map((f) => [f.name, f.props.type])).toEqual([['id', 'number'], ['nom', 'shortText'], ['solde', 'number'], ['actif', 'yesNo'], ['ne', 'dateTime']]);
    const rows = db.prepare('SELECT * FROM "Clients" ORDER BY rowid').all() as Record<string, unknown>[];
    expect(rows.map((x) => [x.id, x.nom, x.solde, x.actif])).toEqual([[1, 'Zoé; "x"', 12.5, 1], [2, null, null, 0]]);
    expect(String(rows[0]!.ne)).toContain('2024-05-17');
    expect(rows[1]!.ne).toBeNull();
  });
});

// Live: the real reader against a SQLite file through the SQLite ODBC driver (see odbc.live.ts).
const driver = liveDriver();
describe.skipIf(!driver)('live ODBC source', () => {
  let dir: string; let conn: string;
  const runner = process.platform === 'win32' ? powershellRunner(path.resolve(__dirname, '../../../resources/odbc.ps1')) : isqlRunner();
  beforeAll(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bcodbc-live-'));
    const file = path.join(dir, 'src.db');
    makeLiveSource(file);
    conn = `Driver={${driver}};Database=${file}`;
  });
  afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));
  it('lists the tables and reads one with its column kinds', async () => {
    expect((await runner.tables(conn)).map((t) => t.name).sort()).toEqual(['Clients', 'Pays']);
    const r = await runner.read(conn, { name: 'Clients', schema: '' });
    expect(r.columns.map((c) => c.name)).toEqual(['id', 'nom', 'solde', 'actif', 'ne', 'note']);
    expect(r.columns.find((c) => c.name === 'nom')!.kind).toBe('text');
    expect(r.rows[0]![1]).toBe('Zoé "x"; é');
    expect(r.rows[1]![1]).toBeNull();
  });
  it('a wrong source is bc:odbc|failed|…, the password masked', async () => {
    const bad = `Driver={${driver}};Database=${path.join(dir, 'no', 'such.db')};PWD=hunter2`;
    const e = await runner.tables(bad).then(() => '', (x: Error) => x.message);
    expect(e).toMatch(/^bc:odbc\|failed\|/);
    expect(e).not.toContain('hunter2');
  });
  it('refuses a table the source did not list', async () => {
    await expect(runner.read(conn, { name: 'Clients; DROP TABLE Pays', schema: '' })).rejects.toThrow('bc:odbc|failed|');
  });
});
