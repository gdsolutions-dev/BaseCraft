import { describe, expect, it, vi } from 'vitest';
import { join } from 'node:path';
import { BaseFileError } from './db/file-format';
import {
  basePath, bcError, cells, definition, description, fieldFilters, importPath, importPlan, importSpec, importSpecOrNull, MAX_DEFINITION_CHARS, MAX_IMPORT_BYTES, MAX_PAGE_ROWS,
  lookupName, nameArg, MAX_RULE_CHARS, MAX_SORT_KEYS, objectKind, objectKindOrAll, pageRequest, relation, relationsLayout, saveRequest, sourcePageRequest, sourceRef, str,
  strOrNull, uint, uints, queryRef, queryParams, runActionOptions,
} from './ipc-validate';
import { defaultSpec } from '../shared/import-text';
import { localeInfo } from '../shared/locale-format';
import { clients } from '../shared/test-fixtures';

const INVALID = 'bc:invalidArgument';
const abs = process.platform === 'win32' ? 'C:\\data\\x.basecraft' : '/data/x.basecraft';

describe('ipc argument checks', () => {
  it('objects', () => {
    expect(objectKind('form')).toBe('form');
    expect(description(null)).toBeNull();
    expect(description('é'.repeat(255))).toBe('é'.repeat(255));
    for (const v of ['x'.repeat(256), 3, undefined]) expect(() => description(v)).toThrow(INVALID);
    for (const v of ['table', 'Form', '', null, undefined]) expect(() => objectKind(v)).toThrow(INVALID);
    expect(objectKindOrAll(undefined)).toBeUndefined();
    expect(objectKindOrAll('report')).toBe('report');
    expect(strOrNull(null)).toBeNull();
    expect(() => strOrNull(undefined)).toThrow(INVALID);
    const d = { formatVersion: '1.0', a: [1, { b: null }] };
    expect(definition(d)).toEqual(d);
    expect(definition({ u: undefined, v: 1 })).toEqual({ v: 1 }); // dropped, as JSON.stringify does
    for (const v of [null, [], 'x', new Date(), { f: () => 1 }, { n: NaN }, { m: new Map() }]) expect(() => definition(v)).toThrow(INVALID);
  });

  it('definition: bounded walk (no DoS by a sparse array, a huge string or deep nesting)', () => {
    const sparse: unknown[] = [];
    sparse.length = 2 ** 32 - 1;
    const t0 = Date.now();
    expect(() => definition({ a: sparse })).toThrow(INVALID);
    expect(Date.now() - t0).toBeLessThan(200);
    expect(() => definition({ s: 'x'.repeat(100) }, 50)).toThrow(INVALID);
    expect(definition({ s: 'x'.repeat(10) }, 50)).toEqual({ s: 'x'.repeat(10) });
    expect(() => definition({ s: '"'.repeat(30) }, 50)).toThrow(INVALID); // the serialized size counts escapes
    const deep = (n: number): unknown => (n === 0 ? 1 : { x: deep(n - 1) });
    expect(definition(deep(63) as object)).toBeTruthy();
    expect(() => definition(deep(65) as object)).toThrow(INVALID);
    expect(MAX_DEFINITION_CHARS).toBe(8 * 1024 * 1024);
    for (const k of ['__proto__', 'constructor', 'prototype']) {
      const own = JSON.parse(`{"a": {"${k}": {"polluted": true}}}`);
      expect(() => definition(own), k).toThrow(INVALID);
    }
  });

  it('names: at most 64 characters, checked before any spread or regex', () => {
    expect(nameArg('Clients')).toBe('Clients');
    expect(nameArg('é'.repeat(64))).toBe('é'.repeat(64));
    expect(nameArg('\u{1F511}'.repeat(64))).toHaveLength(128); // 64 code points, 128 UTF-16 units
    const huge = 'x'.repeat(1e6);
    const t0 = Date.now();
    for (const v of [huge, 'x'.repeat(65), 1, null]) expect(() => nameArg(v)).toThrow(INVALID);
    expect(Date.now() - t0).toBeLessThan(50);
    // every name argument goes through it
    expect(() => sourceRef({ kind: 'table', name: huge })).toThrow(INVALID);
    expect(() => sourcePageRequest({ offset: 0, limit: 1, sort: [{ field: huge, dir: 'asc' }] })).toThrow(INVALID);
    expect(() => pageRequest({ offset: 0, limit: 1, sort: { field: huge, dir: 'asc' } })).toThrow(INVALID);
    expect(() => cells({ [huge]: 1 })).toThrow(INVALID);
    const req = (name: string, field: string) => ({ originalName: null, allowDataLoss: false, design: { name, fields: [{ name: field, props: {} }] }, mapping: [] });
    expect(() => saveRequest(req(huge, 'a'))).toThrow(INVALID);
    expect(() => saveRequest(req('T', huge))).toThrow(INVALID);
    expect(sourceRef({ kind: 'sql', sql: 'x'.repeat(1_048_576) })).toMatchObject({ kind: 'sql' }); // a query's SQL: 1 MB
    expect(() => sourceRef({ kind: 'sql', sql: 'x'.repeat(1_048_577) })).toThrow(INVALID);
  });

  it('C8: a name that looks something up accepts 1024 characters (external tables); creating or renaming keeps 64', () => {
    const long = 'x'.repeat(100);
    expect(lookupName(long)).toBe(long);
    expect(lookupName(String.fromCodePoint(0x1f511).repeat(1024))).toHaveLength(2048);
    for (const v of ['x'.repeat(1025), 'x'.repeat(5000), 'x'.repeat(1e6), 3]) expect(() => lookupName(v)).toThrow(INVALID);
    expect(sourceRef({ kind: 'table', name: long })).toEqual({ kind: 'table', name: long });
    expect(sourcePageRequest({ offset: 0, limit: 1, sort: [{ field: long, dir: 'asc' }], filter: [{ field: long, criteria: '1' }] })).toBeTruthy();
    expect(pageRequest({ offset: 0, limit: 1, sort: { field: long, dir: 'asc' } })).toBeTruthy();
    expect(cells({ [long]: 1 })).toEqual({ [long]: 1 });
    const req = (name: string, originalName: string | null, sourceName: string | null = null) =>
      ({ originalName, allowDataLoss: false, design: { name, fields: [{ name: 'a', props: {} }] }, mapping: [{ name: 'a', sourceName }] });
    expect(saveRequest(req('Court', long, long))).toBeTruthy(); // alter an external table and read its long field
    expect(() => saveRequest(req('x'.repeat(65), null))).toThrow(INVALID); // creating a 65-character table is refused
  });

  it('save requests: a Validation Rule and Validation Text, of the table or of a field, are strings within caps', () => {
    const req = (design: object, props: object = {}) =>
      ({ originalName: null, allowDataLoss: false, design: { name: 'T', fields: [{ name: 'a', props }], ...design }, mapping: [{ name: 'a', sourceName: null }] });
    expect(saveRequest(req({ validationRule: '[a]>0', validationText: 'é'.repeat(255) }))).toBeTruthy();
    expect(saveRequest(req({ validationRule: 'x'.repeat(MAX_RULE_CHARS) }, { validationRule: '>0', validationText: 'ok' }))).toBeTruthy();
    for (const bad of [{ validationRule: 5 }, { validationText: {} }, { validationRule: 'x'.repeat(MAX_RULE_CHARS + 1) }, { validationText: 'é'.repeat(256) }]) {
      expect(() => saveRequest(req(bad))).toThrow(INVALID);
      expect(() => saveRequest(req({}, bad))).toThrow(INVALID);
    }
  });

  it('save requests: names are length caps, never a silent false; kept fields may be long, new or renamed ones are 64', () => {
    const req = (fields: string[], mapping: [string, string | null][], name = 'T', originalName: string | null = null) =>
      ({ originalName, allowDataLoss: false, design: { name, fields: fields.map((n) => ({ name: n, props: {} })) }, mapping: mapping.map(([a, b]) => ({ name: a, sourceName: b })) });
    expect(saveRequest(req([''], [['', null]]))).toBeTruthy(); // an empty name is the core's typed nameEmpty, not bc:invalidArgument
    expect(saveRequest(req([], [], ''))).toBeTruthy();
    const long = 'L'.repeat(100);
    expect(saveRequest(req([long], [[long, long]], 'T', 'T'))).toBeTruthy(); // an external field kept by name
    expect(saveRequest(req(['x'.repeat(64)], [['x'.repeat(64), null]]))).toBeTruthy();
    expect(() => saveRequest(req(['x'.repeat(65)], [['x'.repeat(65), null]]))).toThrow(INVALID); // new
    expect(() => saveRequest(req([long], [[long, 'Court']], 'T', 'T'))).toThrow(INVALID); // renamed
    expect(() => saveRequest(req(['a'], [['a', null]], 'x'.repeat(65)))).toThrow(INVALID); // new table name
    expect(saveRequest(req(['a'], [['a', 'a']], long, long))).toBeTruthy(); // an external table keeps its long name
  });

  it('save requests: indexes are well formed (32 at most, 1024-character names, 10 fields each)', () => {
    const req = (indexes: unknown) => ({ originalName: null, allowDataLoss: false, design: { name: 'T', fields: [{ name: 'a', props: {} }], indexes }, mapping: [{ name: 'a', sourceName: null }] });
    const ix = { name: 'I', fields: [{ name: 'a', desc: true }], unique: false };
    expect(saveRequest(req(undefined))).toBeTruthy();
    expect(saveRequest(req([ix]))).toBeTruthy();
    for (const bad of [ix, [{ ...ix, unique: 1 }], [{ ...ix, fields: {} }], [{ ...ix, fields: [{ name: 'a' }] }], [{ ...ix, name: 'x'.repeat(1025) }],
      Array(33).fill(ix), [{ ...ix, fields: Array(11).fill(ix.fields[0]) }]]) expect(() => saveRequest(req(bad))).toThrow(INVALID);
  });

  it('names are counted in code points after NFC', () => {
    expect(nameArg('e\u0301'.repeat(64))).toBe('e\u0301'.repeat(64)); // 128 code points, 64 once composed
    expect(() => nameArg('e\u0301'.repeat(65))).toThrow(INVALID);
  });

  it('filter criteria are at most 2000 characters', () => {
    expect(sourcePageRequest({ offset: 0, limit: 1, filter: [{ field: 'a', criteria: 'x'.repeat(2000) }] })).toBeTruthy();
    expect(() => sourcePageRequest({ offset: 0, limit: 1, filter: [{ field: 'a', criteria: 'x'.repeat(2001) }] })).toThrow(INVALID);
  });

  it('table save requests: field and mapping lists are bounded before they are read', () => {
    const big: unknown[] = [];
    big.length = 2 ** 32 - 1;
    const req = (fields: unknown, mapping: unknown) => ({ originalName: null, allowDataLoss: false, design: { name: 'T', fields }, mapping });
    expect(() => saveRequest(req(big, []))).toThrow(INVALID);
    expect(() => saveRequest(req([], big))).toThrow(INVALID);
  });

  it('record sources', () => {
    expect(sourceRef({ kind: 'table', name: 'T' })).toEqual({ kind: 'table', name: 'T' });
    expect(sourceRef({ kind: 'query', name: 'Q' })).toEqual({ kind: 'query', name: 'Q' });
    expect(sourceRef({ kind: 'sql', sql: 'SELECT 1' })).toEqual({ kind: 'sql', sql: 'SELECT 1' });
    for (const v of [null, { kind: 'table' }, { kind: 'sql', name: 'x' }, { kind: 'view', name: 'x' }]) expect(() => sourceRef(v)).toThrow(INVALID);
    expect(sourcePageRequest({ offset: 0, limit: 10 })).toEqual({ offset: 0, limit: 10 });
    const full = { offset: 5, limit: 10, sort: [{ field: 'a', dir: 'desc' }], filter: [{ field: 'a', criteria: '>1' }], params: { P: 1 } };
    expect(sourcePageRequest(full)).toEqual(full);
    const sort = (n: number) => Array.from({ length: n }, () => ({ field: 'a', dir: 'asc' }));
    expect(sourcePageRequest({ offset: 0, limit: MAX_PAGE_ROWS, sort: sort(MAX_SORT_KEYS) })).toMatchObject({ limit: 10000 });
    expect(MAX_SORT_KEYS).toBe(8);
    for (const v of [{ offset: 0, limit: 10001 }, { offset: 0, limit: 1, sort: sort(9) }]) expect(() => sourcePageRequest(v)).toThrow(INVALID);
    for (const v of [{ offset: -1, limit: 1 }, { offset: 0, limit: 1, sort: { field: 'a', dir: 'asc' } }, { offset: 0, limit: 1, sort: [{ field: 'a', dir: 'up' }] },
      { offset: 0, limit: 1, filter: [{ field: 'a' }] }, { offset: 0, limit: 1, params: { P: {} } }]) expect(() => sourcePageRequest(v)).toThrow(INVALID);
    for (const v of [{ kind: 'sql', sql: 1 }, { kind: 'query', name: 1 }, { kind: 'query', name: ['Q'] }]) expect(() => sourceRef(v)).toThrow(INVALID);
    const params = (n: number) => Object.fromEntries(Array.from({ length: n }, (_, i) => [`P${i}`, i]));
    expect(sourcePageRequest({ offset: 0, limit: 1, params: params(100) }).params).toEqual(params(100));
    for (const p of [['x'], params(101), { P: { v: 1 } }]) expect(() => sourcePageRequest({ offset: 0, limit: 1, params: p })).toThrow(INVALID);
  });

  it('scalars', () => {
    expect(str('a')).toBe('a');
    expect(() => str(1)).toThrow(INVALID);
    expect(uint(0)).toBe(0);
    for (const v of [-1, 1.5, NaN, Infinity, 2 ** 53, '1', null]) expect(() => uint(v)).toThrow(INVALID);
  });

  it('relations', () => {
    const r = { name: 'R', parentTable: 'A', parentFields: ['x'], childTable: 'B', childFields: ['y'], enforce: true, cascadeUpdate: false, cascadeDelete: true, joinType: 2 };
    expect(relation(r)).toEqual(r);
    expect(relation({ ...r, extra: 1 })).toEqual(r); // only the known fields cross
    for (const bad of [null, [], { ...r, name: 1 }, { ...r, parentFields: [] }, { ...r, childFields: Array(11).fill('y') }, { ...r, parentFields: ['x', 2] },
      { ...r, enforce: 'yes' }, { ...r, joinType: 4 }, { ...r, joinType: '1' }, { ...r, childTable: undefined }, { ...r, parentFields: [, 'x'] }]) {
      expect(() => relation(bad)).toThrow(INVALID);
    }
    // C8: the relation's name creates (64; '' asks for a generated one), its tables and fields are looked up (1024)
    const long = 'x'.repeat(1024);
    expect(relation({ ...r, name: '', parentTable: long, parentFields: [long], childTable: long, childFields: [long] }).parentTable).toBe(long);
    for (const bad of [{ ...r, name: 'x'.repeat(65) }, { ...r, parentTable: 'x'.repeat(1025) }, { ...r, childFields: ['x'.repeat(1025)] }]) {
      expect(() => relation(bad)).toThrow(INVALID);
    }
    expect(() => relationsLayout({ tables: { ['x'.repeat(1025)]: { x: 1, y: 2 } } })).toThrow(INVALID);
    expect(strOrNull(null)).toBeNull();
    expect(() => strOrNull(undefined)).toThrow(INVALID);
    expect(relationsLayout({ tables: { A: { x: 1, y: -2.5 } } })).toEqual({ tables: { A: { x: 1, y: -2.5 } } });
    for (const bad of [null, {}, { tables: [] }, { tables: { A: { x: 1 } } }, { tables: { A: { x: NaN, y: 0 } } }, { tables: { A: null } },
      JSON.parse('{"tables":{"__proto__":{"x":1}}}'), { tables: Object.assign(Object.create(null), { A: { x: 1, y: 2 } }) }]) {
      expect(() => relationsLayout(bad)).toThrow(INVALID);
    }
    // a table may be named like an Object.prototype member: as IPC delivers it, an own key (never the prototype)
    const named = relationsLayout(JSON.parse('{"tables":{"__proto__":{"x":1,"y":2},"constructor":{"x":3,"y":4},"prototype":{"x":5,"y":6}}}'));
    expect(Object.getPrototypeOf(named.tables)).toBeNull();
    expect(Object.keys(named.tables)).toEqual(['__proto__', 'constructor', 'prototype']);
    expect(Object.getOwnPropertyDescriptor(named.tables, '__proto__')?.value).toEqual({ x: 1, y: 2 });
  });

  it('integer arrays', () => {
    expect(uints([0, 3])).toEqual([0, 3]);
    expect(uints([])).toEqual([]);
    expect(() => uints([1, -2])).toThrow(INVALID);
    expect(() => uints([1, 2 ** 53])).toThrow(INVALID);
    expect(() => uints([1, , 3])).toThrow(INVALID); // sparse
    expect(() => uints('1,2')).toThrow(INVALID);
  });

  it('base paths: absolute and .basecraft only', () => {
    expect(basePath(abs)).toBe(abs);
    expect(basePath(abs.toUpperCase().replace('.BASECRAFT', '.BaseCraft'))).toBeTruthy();
    expect(() => basePath('x.basecraft')).toThrow(INVALID);
    expect(() => basePath(abs.replace('.basecraft', '.txt'))).toThrow(INVALID);
    expect(() => basePath(undefined)).toThrow(INVALID);
  });

  it('cell values', () => {
    const ok = { Nom: 'a', Âge: 3, Actif: true, Email: null };
    expect(cells(ok)).toBe(ok);
    for (const v of [null, [], 'x', { a: {} }, { a: [1] }, { a: NaN }, { a: Infinity }, { a: undefined }, new Map()]) {
      expect(() => cells(v)).toThrow(INVALID);
    }
    // an own "__proto__" key (as JSON or structured clone produce) stays plain data
    const own = cells(JSON.parse('{"__proto__": "x"}'));
    expect(Object.getPrototypeOf(own)).toBe(Object.prototype);
    expect(Object.keys(own)).toEqual(['__proto__']);
    expect(() => cells(JSON.parse('{"__proto__": {"polluted": 1}}'))).toThrow(INVALID);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it('page requests', () => {
    expect(pageRequest({ offset: 0, limit: 10 })).toEqual({ offset: 0, limit: 10 });
    expect(pageRequest({ offset: 5, limit: 1, sort: { field: 'Nom', dir: 'desc' }, extra: 1 })).toEqual({ offset: 5, limit: 1, sort: { field: 'Nom', dir: 'desc' } });
    for (const v of [null, { offset: -1, limit: 1 }, { offset: 0 }, { offset: 0, limit: 1.5 }, { offset: 0, limit: 1, sort: { field: 'Nom', dir: 'up' } }, { offset: 0, limit: 1, sort: 'Nom' }]) {
      expect(() => pageRequest(v)).toThrow(INVALID);
    }
  });

  it('filters: 0 to 20 {field, criteria ≤ 2000}, in page requests and alone (count)', () => {
    const filter = [{ field: 'Ville', criteria: '"Lyon"' }];
    expect(pageRequest({ offset: 0, limit: 1, filter: [{ ...filter[0], extra: 1 }] })).toEqual({ offset: 0, limit: 1, filter });
    expect(pageRequest({ offset: 0, limit: 1, filter: [] })).toEqual({ offset: 0, limit: 1, filter: [] });
    expect(fieldFilters(undefined)).toBeUndefined();
    expect(fieldFilters(filter)).toEqual(filter);
    expect(fieldFilters(Array(20).fill(filter[0]))).toHaveLength(20);
    expect(fieldFilters([{ field: 'x', criteria: 'a'.repeat(2000) }])).toHaveLength(1);
    expect(fieldFilters([{ field: 'x'.repeat(1024), criteria: '1' }])).toHaveLength(1); // C8: a looked-up field name
    for (const v of [null, 'x', {}, Array(21).fill(filter[0]), [{ field: 'x' }], [{ field: 1, criteria: '1' }], [{ field: 'x', criteria: 'a'.repeat(2001) }], [{ field: 'x'.repeat(1025), criteria: '1' }], [null], new Array(1)]) {
      expect(() => fieldFilters(v)).toThrow(INVALID);
      expect(() => pageRequest({ offset: 0, limit: 1, filter: v ?? 0 })).toThrow(INVALID);
    }
  });

  it('save requests', () => {
    const req = { originalName: null, design: clients, mapping: [{ name: 'Nom', sourceName: null }], allowDataLoss: false };
    expect(saveRequest(req)).toBe(req);
    expect(saveRequest({ ...req, originalName: 'Clients', design: { ...clients, description: 'd', extra: { k: 1 } } })).toBeTruthy();
    expect(saveRequest({ ...req, acceptExistingViolations: true })).toBeTruthy();
    const bads = [
      null,
      { ...req, originalName: 1 },
      { ...req, allowDataLoss: 'no' },
      { ...req, acceptExistingViolations: 1 },
      { ...req, design: { ...clients, name: 1 } },
      { ...req, design: { ...clients, description: 1 } },
      { ...req, design: { ...clients, extra: [] } },
      { ...req, design: { ...clients, fields: [{ name: 'a', props: null }] } },
      { ...req, design: { ...clients, fields: [, clients.fields[0]] } }, // sparse
      { ...req, mapping: [{ name: 'a', sourceName: 1 }] },
      { ...req, mapping: {} },
    ];
    for (const v of bads) expect(() => saveRequest(v)).toThrow(INVALID);
  });
});

describe('file errors for the renderer', () => {
  it('BaseFileError keeps its code; anything else is cannotOpen', () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(bcError(new BaseFileError('notBasecraft')).message).toBe('bc:notBasecraft');
    expect(bcError(Object.assign(new Error('no such dir'), { code: 'ENOENT' })).message).toBe('bc:cannotOpen');
    expect(log).toHaveBeenCalledTimes(1);
    log.mockRestore();
  });
});

describe('import arguments', () => {
  const spec = defaultSpec(localeInfo('fr-FR'));
  it('path: absolute existing file only', () => {
    const chosen = new Set([__filename, __dirname, __filename + '.missing']);
    expect(importPath(__filename, chosen)).toBe(__filename);
    // only what the main-side open dialog returned: any other existing file is refused
    for (const v of [join(__dirname, 'ipc.ts'), 'relative.csv', __dirname, __filename + '.missing', 1]) expect(() => importPath(v, chosen)).toThrow(INVALID);
    expect(() => importPath(__filename, chosen, 10)).toThrow('bc:fileTooLarge'); // the 2 GiB ceiling, lowered for the test
    expect(MAX_IMPORT_BYTES).toBe(2 * 1024 ** 3);
  });
  it('spec: validated, unknown keys dropped', () => {
    expect(importSpecOrNull(null)).toBeNull();
    expect(importSpec({ ...spec, x: 1 })).toEqual(spec);
    expect(() => importSpec({ ...spec, delimiter: '' })).toThrow(INVALID);
  });
  it('plan: new table or append with mapping', () => {
    expect(importPlan({ spec, target: { kind: 'new', table: 'T', primaryKey: { kind: 'auto', x: 1 } } }))
      .toEqual({ spec, target: { kind: 'new', table: 'T', primaryKey: { kind: 'auto' } } });
    expect(importPlan({ spec, target: { kind: 'new', table: 'T', primaryKey: { kind: 'field', field: 'A' } } }).target)
      .toEqual({ kind: 'new', table: 'T', primaryKey: { kind: 'field', field: 'A' } });
    expect(importPlan({ spec, target: { kind: 'append', table: 'T', mapping: ['A', null] } }).target).toEqual({ kind: 'append', table: 'T', mapping: ['A', null] });
    for (const target of [
      { kind: 'new', table: 'T', primaryKey: { kind: 'field' } }, { kind: 'new', table: 1, primaryKey: { kind: 'auto' } },
      { kind: 'append', table: 'T', mapping: [1] }, { kind: 'append', table: 'T' }, { kind: 'link', table: 'T' },
    ]) expect(() => importPlan({ spec, target })).toThrow(INVALID);
    expect(() => importPlan({ spec: {}, target: { kind: 'new', table: 'T', primaryKey: { kind: 'auto' } } })).toThrow(INVALID);
  });
});

describe('action queries (A3)', () => {
  it('query ref, parameters, options', () => {
    expect(queryRef({ kind: 'sql', sql: 'DELETE * FROM T' })).toEqual({ kind: 'sql', sql: 'DELETE * FROM T' });
    expect(() => queryRef({ kind: 'table', name: 'T' })).toThrow(INVALID);
    expect(queryParams({ V: 'x' })).toEqual({ V: 'x' });
    expect(() => queryParams(Object.fromEntries(Array.from({ length: 101 }, (_, i) => [`p${i}`, 1])))).toThrow(INVALID);
    expect(runActionOptions({ skipFailures: true, replaceTable: false, x: 1 })).toEqual({ skipFailures: true, replaceTable: false });
    expect(() => runActionOptions({ skipFailures: 1, replaceTable: false })).toThrow(INVALID);
  });
});
