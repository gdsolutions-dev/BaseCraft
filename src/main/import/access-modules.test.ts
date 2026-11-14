import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';
import type { ExportDesign } from '../../shared/access-export';
import type { DesignDoc } from '../../shared/design/model';
import { readEvent } from '../../shared/design/events';
import { parseModuleDef } from '../../shared/python/module-def';
import { registerFunctions, SYSTEM_DDL } from '../db/file-format';
import { getObject, listObjects, saveObject } from '../db/objects';
import { readAccessExport, readExportDesigns, readExportModules } from './access-export';
import { importDesigns } from './access-designs';
import { importModules, pythonModuleName, vbaAsPython, vbaLines } from './access-modules';
import { isModuleName } from '../../shared/python/module-def';
import { codeBehindModule } from '../../shared/python/code-behind';
import * as objects from '../db/objects';

vi.mock('../db/objects', async (orig) => { const m = await orig<typeof import('../db/objects')>(); return { ...m, saveObject: vi.fn(m.saveObject) }; });

const memoryBase = () => { const db = new DatabaseSync(':memory:'); registerFunctions(db); for (const ddl of SYSTEM_DDL) db.exec(ddl); return db; };
const FIXTURE = join(__dirname, '../../../tests/fixtures/access/Ventes-complet.export');
const none = { tables: [], queries: [] };
let db: DatabaseSync;
beforeEach(() => { db = memoryBase(); });
const fixture = () => { const r = readAccessExport(FIXTURE, 'Ventes-complet.accdb'); if (!r.ok) throw new Error('fixture'); return r.export; };

describe('vbaLines', () => {
  it('every exotic line break splits, NUL goes: every commented line starts with #', () => {
    const src = vbaAsPython('M', 'a\u2028b\fc\rd\u0000e\u0085f\vg\u2029h');
    expect(vbaLines('a\u2028b\fc\rd\u0000e')).toEqual(['a', 'b', 'c', 'de']);
    expect(src.split('\n').every((l) => l.startsWith('#'))).toBe(true);
    expect(src.split('\n')).toHaveLength(1 + 7);
  });
});

describe('vbaAsPython', () => {
  it('a header, then every line commented; an empty line gives #; CRLF becomes LF', () => {
    expect(vbaAsPython('M', 'Sub A()\r\n\r\nEnd Sub\r\n')).toBe(
      '# VBA module "M" imported from Access. Not converted: rewrite it in Python.\n# Sub A()\n#\n# End Sub');
  });
});

describe('pythonModuleName', () => {
  it('refused characters, a leading digit, a keyword, a taken name', () => {
    expect(pythonModuleName('Mod Outils', [])).toBe('Mod_Outils');
    expect(pythonModuleName('1Outils', [])).toBe('_1Outils');
    expect(pythonModuleName('class', [])).toBe('class_');
    expect(pythonModuleName('Outils', ['outils'])).toBe('Outils1');
  });

  it('the 64 limit applies after the prefix: a 64-character name starting with a digit stays valid', () => {
    const n = pythonModuleName('1' + 'a'.repeat(63), []);
    expect([...n].length).toBe(64);
    expect(isModuleName(n)).toBe(true);
  });
});

describe('importModules', () => {
  it('the fixture module is saved as comments and read back', () => {
    const r = importModules(db, readExportModules(FIXTURE, fixture()));
    expect(r.modules).toEqual([{ name: 'ModOutils', remote: 'ModOutils' }]);
    expect(r.lines).toEqual([{ code: 'moduleImported', object: 'ModOutils', n: 5 }]);
    const def = parseModuleDef(getObject(db, 'module', 'ModOutils')!.definition);
    expect(def.exports).toEqual([]);
    expect(def.source.split('\n').every((l) => l.startsWith('#'))).toBe(true);
  });

  it('a changed name, a duplicate, a missing text', () => {
    saveObject(db, 'module', 'Mod_A', { formatVersion: '1.0', source: '', exports: [] }, null);
    const r = importModules(db, [{ name: 'Mod A', text: 'x' }, { name: 'mod a', text: 'y' }, { name: 'Z', text: null }]);
    expect(r.lines).toEqual([{ code: 'moduleImported', object: 'Mod_A1', part: 'Mod A', n: 1 }, { code: 'moduleSkipped', object: 'mod a', reason: 'duplicate' },
      { code: 'moduleSkipped', object: 'Z', reason: 'unreadable' }]);
  });
});

describe('module names', () => {
  it('an over-long name is cut to 64 characters', () => {
    const r = importModules(db, [{ name: 'M'.repeat(70), text: 'x' }]);
    expect(r.modules[0]!.name).toBe('M'.repeat(64));
  });
});

describe('code-behind', () => {
  const forms = () => readExportDesigns(FIXTURE, fixture()).filter((d) => d.kind === 'form');
  const onCurrent = () => readEvent((getObject(db, 'form', 'FClients')!.definition as DesignDoc).props.OnCurrent);

  it('with code: Form_FClients exists, the event stays an event procedure', () => {
    const r = importDesigns(db, forms(), none, undefined, { code: true });
    expect(onCurrent()).toEqual({ kind: 'procedure' });
    const def = parseModuleDef(getObject(db, 'module', 'Form_FClients')!.definition);
    expect(def.source.split('\n').every((l) => l.startsWith('#'))).toBe(true);
    expect(r.lines).toContainEqual(expect.objectContaining({ code: 'codeBehindImported', object: 'FClients', part: 'Form_FClients' }));
    expect(r.lines).toContainEqual({ code: 'designEventProcedure', object: 'FClients', part: 'Form_Current' });
  });

  it('a module of that name already there: skipped, the event dropped', () => {
    saveObject(db, 'module', 'Form_FClients', { formatVersion: '1.0', source: '', exports: [] }, null);
    const r = importDesigns(db, forms(), none, undefined, { code: true });
    expect(onCurrent()).toEqual({ kind: 'none' });
    expect(r.lines).toContainEqual({ code: 'codeBehindSkipped', object: 'FClients', reason: 'nameTaken' });
    expect(r.lines).toContainEqual({ code: 'designEventDropped', object: 'FClients', part: 'Form_Current', reason: 'procedure' });
    expect(getObject(db, 'module', 'Form_FClients')!.definition).toEqual({ formatVersion: '1.0', source: '', exports: [] });
  });

  it('without code: the lines of E4', () => {
    const r = importDesigns(db, forms(), none);
    expect(getObject(db, 'module', 'Form_FClients')).toBeNull();
    expect(r.lines).toContainEqual({ code: 'designEventDropped', object: 'FClients', part: 'Form_Current', reason: 'procedure' });
    expect(r.lines.some((l) => ['codeBehindImported', 'codeBehindSkipped', 'designEventProcedure'].includes(l.code))).toBe(false);
  });

  it('a module that cannot be saved never loses its form', () => {
    const real = vi.mocked(objects.saveObject).getMockImplementation()!;
    vi.mocked(objects.saveObject).mockImplementation((d, k, ...a) => { if (k === 'module') throw new Error('boom'); return real(d, k, ...a); });
    try {
      const r = importDesigns(db, forms(), none, undefined, { code: true });
      expect(r.forms).toEqual([{ name: 'FClients', remote: 'FClients' }]);
      expect(getObject(db, 'form', 'FClients')).not.toBeNull();
      expect(r.lines.filter((l) => l.code === 'codeBehindSkipped')).toEqual([{ code: 'codeBehindSkipped', object: 'FClients', reason: 'notSaved' }]);
    } finally { vi.mocked(objects.saveObject).mockImplementation(real); }
  });

  it('the module follows the NFC name of a decomposed form name', () => {
    const nfd = 'Cafe\u0301';
    importDesigns(db, [{ ...forms()[0]!, name: nfd }], none, undefined, { code: true });
    const stored = listObjects(db, 'form')[0]!.name;
    expect(listObjects(db, 'module').map((o) => o.name)).toEqual([codeBehindModule('form', stored)]);
  });

  it('two forms with one module name: the second is refused, its events dropped', () => {
    const base = forms()[0]!;
    const r = importDesigns(db, [{ ...base, name: 'A B' }, { ...base, name: 'A_B' }], none, undefined, { code: true });
    expect(r.lines.filter((l) => l.code === 'codeBehindSkipped')).toEqual([{ code: 'codeBehindSkipped', object: 'A_B', reason: 'nameTaken' }]);
    expect(r.lines.filter((l) => l.code === 'codeBehindImported').map((l) => l.object)).toEqual(['A B']);
    expect(r.lines).toContainEqual(expect.objectContaining({ code: 'designEventDropped', object: 'A_B' }));
  });

  it('a form that got a numbered name has the module of that name', () => {
    saveObject(db, 'form', 'FClients', { formatVersion: '1.0', recordSource: null, props: {}, sections: [] }, null);
    const r = importDesigns(db, forms(), none, undefined, { code: true });
    expect(r.forms).toEqual([{ name: 'FClients1', remote: 'FClients' }]);
    expect(getObject(db, 'module', 'Form_FClients1')).not.toBeNull();
  });

  it('a module name over the limit is refused', () => {
    const r = importDesigns(db, [{ ...forms()[0]!, name: 'F'.repeat(62) }], none, undefined, { code: true });
    expect(r.lines).toContainEqual({ code: 'codeBehindSkipped', object: 'F'.repeat(62), reason: 'nameTooLong' });
    expect(listObjects(db, 'module')).toEqual([]);
  });
});
