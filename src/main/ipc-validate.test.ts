import { describe, expect, it, vi } from 'vitest';
import { join } from 'node:path';
import { BaseFileError } from './db/file-format';
import {
  basePath, bcError, cells, importPath, importPlan, importSpec, importSpecOrNull, MAX_IMPORT_BYTES, pageRequest, relation, relationsLayout, saveRequest, str, strOrNull, uint, uints,
} from './ipc-validate';
import { defaultSpec } from '../shared/import-text';
import { localeInfo } from '../shared/locale-format';
import { clients } from '../shared/test-fixtures';

const INVALID = 'bc:invalidArgument';
const abs = process.platform === 'win32' ? 'C:\\data\\x.basecraft' : '/data/x.basecraft';

describe('ipc argument checks', () => {
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
    expect(strOrNull(null)).toBeNull();
    expect(() => strOrNull(undefined)).toThrow(INVALID);
    expect(relationsLayout({ tables: { A: { x: 1, y: -2.5 } } })).toEqual({ tables: { A: { x: 1, y: -2.5 } } });
    for (const bad of [null, {}, { tables: [] }, { tables: { A: { x: 1 } } }, { tables: { A: { x: NaN, y: 0 } } }, { tables: { A: null } }]) {
      expect(() => relationsLayout(bad)).toThrow(INVALID);
    }
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
