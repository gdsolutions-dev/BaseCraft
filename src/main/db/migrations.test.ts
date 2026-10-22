import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { BaseFileError, createBaseFile, CURRENT_FORMAT, openBaseFile } from './file-format';
import { MIGRATIONS } from './migrations';
import { createTable, tableDesign } from './schema';
import { clients } from '../../shared/test-fixtures';

let dir: string;
let p: string;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bcmig-'));
  p = path.join(dir, 'test.basecraft');
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

const tableExists = (db: DatabaseSync, name: string): boolean =>
  !!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name = ?").get(name);

/** A real 1.0 file as A1 wrote it: no bc_relations, format_minor 0, with a table in it. */
function make10(file: string): void {
  createBaseFile(file, '0.1.0');
  const w = openBaseFile(file, 'write', '0.1.0');
  createTable(w.db, clients);
  w.db.close();
  const raw = new DatabaseSync(file);
  raw.exec("DROP TABLE bc_relations; UPDATE bc_meta SET value='0' WHERE key='format_minor'");
  raw.close();
}

describe('format 1.1', () => {
  it('current format is 1.1 and MIGRATIONS ends there', () => {
    expect(CURRENT_FORMAT).toEqual({ major: 1, minor: 1 });
    expect(MIGRATIONS.map((m) => [m.toMajor, m.toMinor])).toEqual([[1, 1]]);
  });

  it('new base is 1.1 with bc_relations', () => {
    createBaseFile(p, '0.2.0');
    const b = openBaseFile(p, 'write', '0.2.0');
    expect(b.meta).toMatchObject({ formatMajor: 1, formatMinor: 1 });
    expect(b.migrated).toBe(false);
    expect(tableExists(b.db, 'bc_relations')).toBe(true);
    b.db.close();
  });

  it('migrates a 1.0 base with a byte-identical backup, keeping its data', () => {
    make10(p);
    const original = fs.readFileSync(p);
    const b = openBaseFile(p, 'write', '0.2.0');
    expect(b.migrated).toBe(true);
    expect(b.meta).toMatchObject({ formatMajor: 1, formatMinor: 1 });
    expect(tableExists(b.db, 'bc_relations')).toBe(true);
    expect(existsBackup(b.backupPath)).toBe(true);
    expect(fs.readFileSync(b.backupPath!)).toEqual(original);
    expect(tableDesign(b.db, 'Clients').fields).toHaveLength(clients.fields.length);
    b.db.close();
    // a second open neither migrates nor makes another backup
    const again = openBaseFile(p, 'write', '0.2.0');
    expect(again.migrated).toBe(false);
    again.db.close();
    expect(fs.readdirSync(dir).filter((f) => f.includes('.backup-'))).toHaveLength(1);
  });

  it('read-only open of a 1.0 base needs migration, file untouched', () => {
    make10(p);
    const before = fs.readFileSync(p);
    try {
      openBaseFile(p, 'readOnly', '0.2.0');
      throw new Error('expected needsMigration');
    } catch (e) {
      expect(e).toBeInstanceOf(BaseFileError);
      expect((e as BaseFileError).code).toBe('needsMigration');
    }
    expect(fs.readFileSync(p)).toEqual(before);
    expect(fs.readdirSync(dir)).toEqual(['test.basecraft']);
  });

  it('bc_relations is keyed by name (NOCASE is ASCII-only: Unicode duplicates are checked by relations.ts)', () => {
    createBaseFile(p, '0.2.0');
    const b = openBaseFile(p, 'write', '0.2.0');
    b.db.exec("INSERT INTO bc_relations (name, props) VALUES ('Rel', '{}')");
    expect(() => b.db.exec("INSERT INTO bc_relations (name, props) VALUES ('REL', '{}')")).toThrow(/UNIQUE|PRIMARY/);
    expect(() => b.db.exec("INSERT INTO bc_relations (name, props) VALUES ('x', NULL)")).toThrow(/NOT NULL/);
    b.db.close();
  });
});

const existsBackup = (f: string | undefined): boolean => !!f && fs.existsSync(f);
