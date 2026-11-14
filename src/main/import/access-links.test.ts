import { afterAll, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type MDBReader from 'mdb-reader';
import { registerFunctions, SYSTEM_DDL } from '../db/file-format';
import { createTable } from '../db/schema';
import { linkRows, sourceRows } from '../links/store';
import { accessLinkedTables, isAttachmentTable, relinkTables, resolveBackEnd, type AccessLinkedTable } from './access-links';

const tmp = fs.mkdtempSync(join(os.tmpdir(), 'bcalnk-'));
afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));
const touch = (n: string) => { const p = join(tmp, n); fs.writeFileSync(p, ''); return p; };
const base = () => { const db = new DatabaseSync(':memory:'); registerFunctions(db); for (const ddl of SYSTEM_DDL) db.exec(ddl); return db; };

/** A reader with the given MSysObjects rows and normal tables. */
const reader = (rows: object[], tables: string[] = []) => ({
  getTable: (n: string) => {
    if (n !== 'MSysObjects') throw new Error('no table');
    // the password column is never asked for, and never without an explicit column list
    return { getData: (o?: { columns?: string[] }) => { if (!o?.columns || o.columns.includes('Connect')) throw new Error('Connect must not be read'); return rows; } };
  },
  getTableNames: () => tables,
}) as unknown as MDBReader;

const front = touch('Front.accdb');
const mine = join(tmp, 'mine.basecraft');
const access = (name: string, database: string, foreign = name): AccessLinkedTable => ({ name, kind: 'access', database, foreign });

describe('accessLinkedTables', () => {
  it('Type 6 is an Access link, Type 4 and others linked are other, Type 1 and system rows are ignored', () => {
    const r = reader([
      { Name: 'Clients', Type: 6, Database: 'C:\\x\\Back.accdb', ForeignName: 'tblClients' },
      { Name: 'Odbc', Type: 4, Database: '', ForeignName: 'dbo.T' },
      { Name: 'Local', Type: 1, Database: null, ForeignName: null },
      { Name: 'MSysThing', Type: 6, Database: 'x', ForeignName: 'y' },
      { Name: '~TMPCLP1', Type: 6, Database: 'x', ForeignName: 'y' },
      { Name: 'NoForeign', Type: 6, Database: 'x', ForeignName: null },
    ]);
    expect(accessLinkedTables(r)).toEqual([
      { name: 'Clients', kind: 'access', database: 'C:\\x\\Back.accdb', foreign: 'tblClients' },
      { name: 'Odbc', kind: 'other' }, { name: 'NoForeign', kind: 'other' }]);
  });
  it('a Database that is not an .mdb or .accdb file is another source', () => {
    expect(accessLinkedTables(reader([
      { Name: 'A', Type: 6, Database: 'C:/x/list.xls', ForeignName: 'S' }, { Name: 'B', Type: 6, Database: 'C:/x/Back.ACCDB', ForeignName: 'S' }])))
      .toEqual([{ name: 'A', kind: 'other' }, { name: 'B', kind: 'access', database: 'C:/x/Back.ACCDB', foreign: 'S' }]);
  });
  it('the hidden attachment tables are left out', () => {
    const hidden = `f_${'0123456789abcdefABCDEF0123456789'}_Photo`;
    expect(isAttachmentTable(hidden)).toBe(true);
    expect(isAttachmentTable('f_123_Photo')).toBe(false);
    expect(isAttachmentTable('Clients')).toBe(false);
    expect(accessLinkedTables(reader([{ Name: hidden, Type: 6, Database: 'x.accdb', ForeignName: hidden }]))).toEqual([]);
  });
  it('a file without MSysObjects has nothing linked', () => {
    expect(accessLinkedTables({ getTable: () => { throw new Error('x'); } } as unknown as MDBReader)).toEqual([]);
  });
});

describe('resolveBackEnd', () => {
  it('the stored path, the file of that name beside the imported one, or null', () => {
    const stored = touch('stored.accdb');
    expect(resolveBackEnd(stored, front)).toBe(stored);
    const beside = touch('Moved.accdb');
    expect(resolveBackEnd('Z:\\gone\\Moved.accdb', front)).toBe(beside);
    expect(resolveBackEnd('Z:\\gone\\Nowhere.accdb', front)).toBeNull();
    expect(resolveBackEnd('/a/b/c.accdb', '/f/x.accdb', (p) => p === join('/f', 'c.accdb'))).toBe(join('/f', 'c.accdb'));
  });
  it('a relative stored path is never used as is: the same-named file beside the imported one, or null', () => {
    const beside = touch('Rel.accdb');
    expect(resolveBackEnd('Rel.accdb', front, (p) => p === 'Rel.accdb' || p === beside)).toBe(beside);
    expect(resolveBackEnd(join('sub', 'Rel.accdb'), front)).toBe(beside);
    expect(resolveBackEnd('NothingBeside.accdb', front, (p) => p === 'NothingBeside.accdb')).toBeNull();
  });
  it('a stored path with no base name gives null', () => {
    expect(resolveBackEnd(`${tmp}/`, front, () => true)).toBeNull();
  });
});

describe('relinkTables', () => {
  const back = touch('Back.accdb');
  it('two tables of one back-end, one renamed: one source, two links, the back-end opened once', () => {
    const db = base();
    const open = vi.fn(() => reader([], ['Clients', 'Orders']));
    const { links, lines } = relinkTables(db, mine, front, [access('Clients', back), access('LocalOrders', back, 'orders')], open);
    expect(open).toHaveBeenCalledTimes(1);
    expect(links).toEqual([{ remote: 'Clients', name: 'Clients' }, { remote: 'LocalOrders', name: 'LocalOrders' }]);
    expect(linkRows(db).map((l) => [l.name, l.remote])).toEqual([['Clients', 'Clients'], ['LocalOrders', 'Orders']]);
    expect(sourceRows(db).map((s) => s.kind)).toEqual(['access']);
    expect(lines).toEqual([{ code: 'tableRelinked', object: 'Clients', part: 'Back.accdb' }, { code: 'tableRelinked', object: 'LocalOrders', part: 'Back.accdb' }]);
  });
  it('three tables with the same stored path: that path is looked up once', () => {
    const exists = vi.fn((p: string) => p === back);
    const { lines } = relinkTables(base(), mine, front, [access('A', back), access('B', back), access('C', back)], () => reader([], ['A', 'B', 'C']), exists);
    expect(lines.filter((l) => l.code === 'tableRelinked')).toHaveLength(3);
    expect(exists.mock.calls.filter(([p]) => p === back)).toHaveLength(1);
  });
  it('each reason gives its line and no link', () => {
    const db = base();
    const open = (p: string) => { if (p === join(tmp, 'Bad.accdb')) throw new Error(`bc:linkUnavailable|cannotOpen|${p}`); return reader([], ['Clients', 'Chained']); };
    touch('Bad.accdb');
    const { links, lines } = relinkTables(db, mine, front, [
      { name: 'Odbc', kind: 'other' }, access('Lost', 'Z:\\gone\\Lost.accdb'), access('Gone', back), access('Chained', back, 'LinkedInBack'),
      access('BadOne', join(tmp, 'Bad.accdb')), access('Itself', front)], open);
    expect(links).toEqual([]);
    expect(linkRows(db)).toEqual([]);
    expect(sourceRows(db)).toEqual([]);
    expect(lines).toEqual([
      { code: 'tableLinked', object: 'Odbc', reason: 'otherSource' }, { code: 'tableLinked', object: 'Lost', reason: 'fileMissing' },
      { code: 'tableLinked', object: 'Itself', reason: 'sameFile' },
      { code: 'tableLinked', object: 'Gone', reason: 'notInFile' }, { code: 'tableLinked', object: 'Chained', reason: 'notInFile' },
      { code: 'tableLinked', object: 'BadOne', reason: 'cannotOpen' }]);
  });
  it.skipIf(process.platform !== 'win32')('a stored path differing from the imported file by case only is the same file', () => {
    const { links, lines } = relinkTables(base(), mine, front, [access('Itself', front.toUpperCase())], () => reader([], ['Itself']));
    expect(links).toEqual([]);
    expect(lines).toEqual([{ code: 'tableLinked', object: 'Itself', reason: 'sameFile' }]);
  });
  it('a back-end that needs a password is linked without being checked', () => {
    const db = base();
    const open = () => { throw new Error(`bc:linkUnavailable|needsPassword|${back}`); };
    const { links, lines } = relinkTables(db, mine, front, [access('Clients', back, 'tblClients')], open);
    expect(links).toEqual([{ remote: 'Clients', name: 'Clients' }]);
    expect(linkRows(db).map((l) => [l.name, l.remote])).toEqual([['Clients', 'tblClients']]);
    expect(lines).toEqual([{ code: 'tableRelinked', object: 'Clients', part: 'Back.accdb' }]);
  });
  it('a taken name gives the numbered link name', () => {
    const db = base();
    createTable(db, { name: 'Clients', fields: [{ name: 'a', props: { type: 'shortText', size: 10, required: false, indexed: 'no', primaryKey: false } }] });
    const { links, lines } = relinkTables(db, mine, front, [access('Clients', back)], () => reader([], ['Clients']));
    expect(links).toEqual([{ remote: 'Clients', name: 'Clients1' }]);
    expect(linkRows(db).map((l) => l.name)).toEqual(['Clients1']);
    expect(lines).toEqual([{ code: 'tableRelinked', object: 'Clients1', part: 'Back.accdb' }]);
  });
});
