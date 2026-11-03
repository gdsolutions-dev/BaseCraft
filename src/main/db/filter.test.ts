import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { createBaseFile, openBaseFile } from './file-format';
import { createTable } from './schema';
import { insertRow } from './write-layer';
import { countRows, readRows } from './rows';
import { compileFilter, compileWhere } from './filter';
import { tableDesign } from './schema';
import { seedSales } from '../query/test-db';
import { parseCanonical, serialize } from '../../shared/expr/parser';
import { f, t } from '../../shared/test-fixtures';
import { localeInfo } from '../../shared/locale-format';
import { compareText } from '../../shared/expr/library';
import type { SqlValue } from '../../shared/coerce';
import { filterValues, listCriteria, valuesCriteria } from '../../renderer/datasheet/filter-model';

const FR = 'fr-FR';
const fr = localeInfo(FR);
const clients = t('Clients', [f('N°', 'autoNumber'), f('Nom', 'shortText'), f('Ville', 'shortText'), f('Solde', 'currency')]);
const T = t('T', [f('id', 'autoNumber'), f('txt', 'shortText'), f('n', 'number', { numberSize: 'double' })]);
const SPECIAL = ["O'Brien", '50%', 'a*b', '[x]', 'a;b', 'a"b', 'x OR 1=1'];

let dir: string;
let db: DatabaseSync;
beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bcfilter-'));
  const p = path.join(dir, 'test.basecraft');
  createBaseFile(p, '0.0.0');
  db = openBaseFile(p, 'write', '0.0.0').db;
  createTable(db, clients);
  createTable(db, T);
  for (const [Nom, Ville, Solde] of [['Dupont', 'Lyon', 1500], ['Durand', 'Paris', 200], ['Martin', 'lyon', 50], ['Arnaud', null, 900]] as const) {
    await insertRow(db, clients, { Nom, Ville, Solde }, fr);
  }
  for (const [i, txt] of SPECIAL.entries()) await insertRow(db, T, { txt, n: i }, fr);
  await insertRow(db, T, { txt: 'ab', n: 99 }, fr); // matched by a pattern that would treat * or % as a wildcard
});
afterEach(() => {
  db.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

const ids = (table: string, filter: { field: string; criteria: string }[], sort?: { field: string; dir: 'asc' | 'desc' }) =>
  readRows(db, table === 'T' ? T : clients, { offset: 0, limit: 100, ...(sort ? { sort } : {}), filter }, FR).rows.map((r) => r.rowid);

describe('filters (brief)', () => {
  it('compiles and counts', () => {
    expect(countRows(db, 'Clients', [{ field: 'Ville', criteria: '"Lyon"' }], FR)).toBe(2); // text compared without case, as Access
  });
  it('special characters are data', () => {
    for (const v of SPECIAL) expect(countRows(db, 'T', [{ field: 'txt', criteria: serialize({ k: 'str', v }) }], FR), v).toBe(1);
    for (const v of SPECIAL) expect(countRows(db, 'T', [{ field: 'txt', criteria: `Like ${serialize({ k: 'str', v: `*${v.replace(/[[*?#]/g, '[$&]')}*` })}` }], FR), v).toBe(1);
  });
  it('rejects unknown field / bad criteria', () => {
    expect(() => compileFilter(T, [{ field: 'zz', criteria: '1' }], FR)).toThrow(/bc:invalidFilter/);
    expect(() => compileFilter(T, [{ field: 'n', criteria: '> 1 +' }], FR)).toThrow(/bc:invalidFilter/);
  });
});

describe('filters (extra)', () => {
  it('several fields are combined with And; the page and the count agree', () => {
    const filter = [{ field: 'Ville', criteria: '"Lyon"' }, { field: 'Solde', criteria: '>1000' }];
    expect(ids('Clients', filter)).toEqual([1]);
    expect(countRows(db, 'Clients', filter, FR)).toBe(1);
  });
  it('sort and paging apply to the filtered rows', () => {
    const filter = [{ field: 'Solde', criteria: '<1000' }];
    expect(ids('Clients', filter, { field: 'Nom', dir: 'asc' })).toEqual([4, 2, 3]);
    expect(readRows(db, clients, { offset: 1, limit: 1, sort: { field: 'Nom', dir: 'asc' }, filter }, FR).rows.map((r) => r.rowid)).toEqual([2]);
  });
  it('field names resolve as Access does (case ignored); Is Null and Not', () => {
    expect(ids('Clients', [{ field: 'ville', criteria: 'Is Null' }])).toEqual([4]);
    expect(ids('Clients', [{ field: 'Ville', criteria: 'Not "Lyon"' }])).toEqual([2]); // Null is neither
    expect(ids('Clients', [{ field: 'Ville', criteria: '<> [Nom]' }])).toEqual([1, 2, 3]); // another field of the row
  });
  it('no filter: every row; an empty list is no filter', () => {
    expect(countRows(db, 'Clients', [], FR)).toBe(4);
    expect(countRows(db, 'Clients')).toBe(4);
    expect(ids('Clients', [])).toEqual([1, 2, 3, 4]);
    expect(compileFilter(clients, [], FR)).toEqual({ sql: '', params: [] });
  });
  it('a criterion naming an unknown field, or too complex, is refused', () => {
    expect(() => compileFilter(clients, [{ field: 'Ville', criteria: '= [Pays]' }], FR)).toThrow(/bc:invalidFilter/);
    expect(() => compileFilter(clients, [{ field: 'Ville', criteria: `In (${Array(901).fill('1').join(',')})` }], FR)).toThrow(/bc:invalidFilter/);
  });
  it('a criterion the parser accepts but that SQLite could not run (expression depth over 450) is refused as invalid', () => {
    const deep = `> ${Array(950).fill('1').join(' + ')}`; // 950 operands: under the parser's 2000, a tree 949 levels deep
    expect(() => parseCanonical(deep, { criteria: true })).not.toThrow();
    expect(() => compileFilter(T, [{ field: 'n', criteria: deep }], FR)).toThrow(/^bc:invalidFilter n: tooComplex/);
    expect(() => countRows(db, 'T', [{ field: 'n', criteria: deep }], FR)).toThrow(/^bc:invalidFilter/);
    const shallow = `> ${Array(400).fill('1').join(' + ')}`; // within the limit: SQLite runs it
    expect(countRows(db, 'T', [{ field: 'n', criteria: shallow }], FR)).toBe(0);
  });
  it('a row error excludes the row (never fails the page)', () => {
    expect(ids('Clients', [{ field: 'Ville', criteria: '> 1 / 0' }])).toEqual([]);
  });
});

describe('Where Condition (B1)', () => {
  let sales: DatabaseSync;
  beforeEach(() => {
    const p = path.join(dir, 'sales.basecraft');
    createBaseFile(p, '0.0.0');
    sales = openBaseFile(p, 'write', '0.0.0').db;
    seedSales(sales);
  });
  afterEach(() => sales.close());
  const fieldsOf = (table: string) => tableDesign(sales, table).fields.map((x) => ({ name: x.name, type: x.props.type, numberSize: x.props.numberSize }));
  const namesWhere = (w: { sql: string; params: unknown[] }) => {
    const stmt = sales.prepare(`SELECT "Nom" FROM "Clients" WHERE ${w.sql} ORDER BY rowid`);
    stmt.setReturnArrays(true);
    return (stmt.all(...(w.params as never[])) as unknown as string[][]).map((r) => r[0]);
  };

  it('compiles a record-level condition with Access text rules', () => {
    const w = compileWhere(fieldsOf('Clients'), '[Ville] = "Lyon"', FR);
    expect(namesWhere(w)).toEqual(['Dupont', 'Martin']); // Lyon, LYON yes; Lyôn no
  });
  it('refuses members, unknown fields and text that does not parse', () => {
    const fl = fieldsOf('Clients');
    expect(() => compileWhere(fl, '[TempVars]![v] = 1', FR)).toThrow('bc:invalidFilter');
    expect(() => compileWhere(fl, '[Absent] = 1', FR)).toThrow('bc:invalidFilter');
    expect(() => compileWhere(fl, '[Ville] =', FR)).toThrow('bc:invalidFilter');
  });
  it('is ANDed with the filter by compileFilter, readRows and countRows', () => {
    const d = tableDesign(sales, 'Clients');
    expect(countRows(sales, 'Clients', [], FR, '[Ville] = "Lyon"')).toBe(2);
    expect(countRows(sales, 'Clients', [{ field: 'Nom', criteria: 'Like "M*"' }], FR, '[Ville] = "Lyon"')).toBe(1);
    expect(readRows(sales, d, { offset: 0, limit: 10, where: '[Ville] = "Lyon"' }, FR, [{ field: 'Nom', dir: 'desc' }], 0).rows.map((r) => r.values[1]))
      .toEqual(['Martin', 'Dupont']);
  });
});

describe('filter lists put back into criteria (O2 R14, Review Focus 5)', () => {
  const L = t('L', [f('id', 'autoNumber'), f('txt', 'shortText'), f('d', 'dateTime'), f('x', 'number', { numberSize: 'double' }), f('m', 'currency')]);
  const TEXTS = ["O'Brien", 'say "hi"', '50*', '#1', '[a', 'a Or b', 'Lyon', 'LYON', 'Élan', 'élan', 'elan', '', null];
  beforeEach(() => {
    createTable(db, L);
    const ins = db.prepare('INSERT INTO "L" ("txt", "d", "x", "m") VALUES (?, ?, ?, ?)');
    TEXTS.forEach((v, i) => ins.run(v, i % 3 ? `2026-10-2${i % 3} 00:00:00` : i % 2 ? '2026-10-21 13:05:00' : null, i % 4 ? 12.5 * (i % 4) : null, i % 2 ? 0.1 : 1500.25));
  });
  const rule = { indexed: true, local: true, listIndexed: true, listNonIndexed: true, max: 1000 };
  const all = () => readRows(db, L, { offset: 0, limit: 100 }, FR).rows;
  const rowids = (field: string, criteria: string) => readRows(db, L, { offset: 0, limit: 100, filter: [{ field, criteria }] }, FR).rows.map((r) => r.rowid);
  const blank = (v: SqlValue) => (v === '' ? null : v); // the list holds the zero-length string within the blanks
  const same = (a: SqlValue, b: SqlValue) => ((a = blank(a)) === null || (b = blank(b)) === null ? a === b : typeof a === 'string' && typeof b === 'string' ? compareText(a, b) === 0 : a === b);
  const listOf = (field: string) => filterValues(async (offset, limit) => ({
    rows: limit ? readRows(db, L, { offset, limit, sort: { field, dir: 'asc' } }, FR).rows.map((r) => r.values) : [], total: countRows(db, 'L', [], FR),
  }), L.fields.findIndex((x) => x.name === field), rule);

  it('each value of a list alone, and every value but one, give exactly their records (French region)', async () => {
    for (const field of ['txt', 'd', 'x', 'm']) {
      const fd = L.fields.find((x) => x.name === field)!;
      const col = L.fields.indexOf(fd);
      const list = (await listOf(field))!;
      expect(list.length, field).toBeGreaterThan(1);
      for (const v of list) {
        const want = all().filter((r) => same(r.values[col] ?? null, v)).map((r) => r.rowid);
        expect(rowids(field, valuesCriteria(fd, [v], v === null)), `${field} = ${String(v)}`).toEqual(want);
        const but = listCriteria(fd, list, list.filter((x) => x !== v))!;
        expect(rowids(field, but.criteria), `${field} but ${String(v)}`).toEqual(all().filter((r) => !same(r.values[col] ?? null, v)).map((r) => r.rowid));
      }
    }
    expect(await listOf('txt')).toEqual([null, '#1', '50*', '[a', 'a Or b', 'elan', 'Élan', 'Lyon', "O'Brien", 'say "hi"']);
  });
  it('a long list: the ticked values, and the values left out (past the length limit), run in SQLite', async () => {
    const ins = db.prepare('INSERT INTO "L" ("txt") VALUES (?)');
    db.exec('BEGIN');
    for (let i = 0; i < 300; i++) ins.run(`ville ${i}`);
    db.exec('COMMIT'); // one write to disk
    const fd = L.fields[1]!;
    const list = (await listOf('txt'))!;
    const n = (c: string) => countRows(db, 'L', [{ field: 'txt', criteria: c }], FR);
    const most = listCriteria(fd, list, list.filter((v) => v !== 'ville 7'))!;
    expect(n(most.criteria)).toBe(countRows(db, 'L', [], FR) - 1);
    expect(n('<> "ville 7" And <> "ville 8" And <> ""')).toBe(countRows(db, 'L', [{ field: 'txt', criteria: 'Is Not Null And <> ""' }], FR) - 2); // the values-left-out form, in SQLite
    const many = listCriteria(fd, list, list.filter((v) => typeof v === 'string' && /^ville \d\d?$/.test(v)))!; // 100 values Or'ed
    expect(many.not).toBe(false);
    expect(n(many.criteria)).toBe(100);
  });
});
