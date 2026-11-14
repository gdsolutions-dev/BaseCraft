import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { createBaseFile, openBaseFile } from './file-format';
import { codeBehindRefusal, copyCodeBehind, deleteCodeBehind, renameCodeBehind } from './code-behind';
import { getObject, listObjects, saveObject } from './objects';

let dir: string;
let db: DatabaseSync;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bccb-'));
  const p = path.join(dir, 'o.basecraft');
  createBaseFile(p, '0.0.0');
  db = openBaseFile(p, 'write', '0.0.0').db;
  saveObject(db, 'form', 'A', { sections: [] }, null);
  saveObject(db, 'module', 'Form_A', { formatVersion: '1.0', source: 'x = 1', exports: [] }, null);
});
afterEach(() => { db.close(); fs.rmSync(dir, { recursive: true, force: true }); });
const modules = () => listObjects(db, 'module').map((m) => m.name);

describe('code-behind lifecycle', () => {
  it('renames, copies and deletes the module of a form', () => {
    renameCodeBehind(db, 'form', 'A', 'B');
    expect(modules()).toEqual(['Form_B']);
    copyCodeBehind(db, 'form', 'B', 'Copie de B');
    expect(modules()).toEqual(['Form_B', 'Form_Copie_de_B']);
    expect(getObject(db, 'module', 'Form_Copie_de_B')?.definition).toMatchObject({ source: 'x = 1' });
    deleteCodeBehind(db, 'form', 'B');
    expect(modules()).toEqual(['Form_Copie_de_B']);
  });
  it('a form without a module leaves the modules alone', () => {
    renameCodeBehind(db, 'form', 'Z', 'Y');
    deleteCodeBehind(db, 'form', 'Z');
    expect(modules()).toEqual(['Form_A']);
  });
  it('refuses two names with the same module name, and a target module already taken', () => {
    saveObject(db, 'form', 'A B', { sections: [] }, null);
    expect(codeBehindRefusal(db, 'form', 'A_B')).toEqual({ ok: false, reason: 'moduleNameClash' });
    expect(codeBehindRefusal(db, 'form', 'A_B', 'A B', 'A B')).toBeNull(); // renaming A B itself
    expect(codeBehindRefusal(db, 'report', 'A_B')).toBeNull(); // another kind, another module
    saveObject(db, 'module', 'Form_C', { formatVersion: '1.0', source: '', exports: [] }, null);
    expect(codeBehindRefusal(db, 'form', 'C', 'A', 'A')).toEqual({ ok: false, reason: 'moduleNameClash' });
    expect(codeBehindRefusal(db, 'form', 'C')).toBeNull(); // a new form adopts an orphan module as before
  });
});
