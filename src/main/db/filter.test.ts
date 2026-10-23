import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { createBaseFile, openBaseFile } from './file-format';
import { createTable } from './schema';
import { insertRow } from './write-layer';
import { countRows, readRows } from './rows';
import { compileFilter } from './filter';
import { parseCanonical, serialize } from '../../shared/expr/parser';
import { f, t } from '../../shared/test-fixtures';
import { localeInfo } from '../../shared/locale-format';

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
