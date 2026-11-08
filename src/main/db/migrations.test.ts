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

const DROP_13 = 'DROP TABLE bc_resources; DROP TABLE bc_links; DROP TABLE bc_sources;'; // what formats 1.3 and 1.4 added
/** A real 1.0 file as A1 wrote it: no bc_relations, format_minor 0, with a table in it. */
function make10(file: string): void {
  createBaseFile(file, '0.1.0');
  const w = openBaseFile(file, 'write', '0.1.0');
  createTable(w.db, clients);
  w.db.close();
  const raw = new DatabaseSync(file);
  raw.exec(`${DROP_13} DROP TABLE bc_objects; DROP TABLE bc_relations; UPDATE bc_meta SET value='0' WHERE key='format_minor'`);
  raw.close();
}

/** A real 1.1 file as A2 wrote it: bc_relations, no bc_objects, with a table and a row in it. */
function make11(file: string): void {
  createBaseFile(file, '0.1.0');
  const w = openBaseFile(file, 'write', '0.1.0');
  createTable(w.db, clients);
  w.db.exec(`INSERT INTO Clients ("Nom") VALUES ('Dupont')`);
  w.db.close();
  const raw = new DatabaseSync(file);
  raw.exec(`${DROP_13} DROP TABLE bc_objects; UPDATE bc_meta SET value='1' WHERE key='format_minor'`);
  raw.close();
}

/** A real 1.2 file as B5 wrote it: bc_objects, no bc_sources and no bc_links, with a table and a row in it. */
function make12(file: string): void {
  createBaseFile(file, '0.1.0');
  const w = openBaseFile(file, 'write', '0.1.0');
  createTable(w.db, clients);
  w.db.exec(`INSERT INTO Clients ("Nom") VALUES ('Dupont')`);
  w.db.close();
  const raw = new DatabaseSync(file);
  raw.exec(`${DROP_13} UPDATE bc_meta SET value='2' WHERE key='format_minor'`);
  raw.close();
}

describe('format 1.4', () => {
  it('current format is 1.4 and MIGRATIONS ends there', () => {
    expect(CURRENT_FORMAT).toEqual({ major: 1, minor: 4 });
    expect(MIGRATIONS.map((m) => [m.toMajor, m.toMinor])).toEqual([[1, 1], [1, 2], [1, 3], [1, 4]]);
  });

  it('a new base is 1.4 with bc_relations, bc_objects, bc_sources, bc_links and bc_resources', () => {
    createBaseFile(p, '0.2.0');
    const b = openBaseFile(p, 'write', '0.2.0');
    expect(b.meta).toMatchObject({ formatMajor: 1, formatMinor: 4 });
    expect(b.migrated).toBe(false);
    for (const t of ['bc_relations', 'bc_objects', 'bc_sources', 'bc_links', 'bc_resources']) expect(tableExists(b.db, t)).toBe(true);
    expect(b.db.prepare('SELECT count(*) AS n FROM bc_links').get()).toEqual({ n: 0 });
    expect(b.db.prepare('SELECT count(*) AS n FROM bc_sources').get()).toEqual({ n: 0 });
    b.db.close();
  });

  it('migrates a 1.1 base to 1.4 with a backup, keeping its tables and rows', () => {
    make11(p);
    const original = fs.readFileSync(p);
    const b = openBaseFile(p, 'write', '0.2.0');
    expect(b.migrated).toBe(true);
    expect(b.meta).toMatchObject({ formatMajor: 1, formatMinor: 4 });
    expect(tableExists(b.db, 'bc_objects')).toBe(true);
    expect(tableExists(b.db, 'bc_links')).toBe(true);
    expect(fs.readFileSync(b.backupPath!)).toEqual(original);
    expect(b.db.prepare('SELECT "Nom" FROM Clients').all()).toEqual([{ Nom: 'Dupont' }]);
    expect(tableDesign(b.db, 'Clients').fields).toHaveLength(clients.fields.length);
    b.db.close();
  });

  it('1.2 -> 1.4 adds bc_sources and bc_links, with a backup', () => {
    make12(p);
    const original = fs.readFileSync(p);
    const b = openBaseFile(p, 'write', '0.2.0');
    expect(b.migrated).toBe(true);
    expect(b.meta).toMatchObject({ formatMajor: 1, formatMinor: 4 });
    for (const t of ['bc_sources', 'bc_links']) expect(b.db.prepare(`SELECT count(*) AS n FROM ${t}`).get()).toEqual({ n: 0 });
    expect(fs.readFileSync(b.backupPath!)).toEqual(original);
    expect(b.db.prepare('SELECT "Nom" FROM Clients').all()).toEqual([{ Nom: 'Dupont' }]);
    b.db.close();
  });

  it('1.3 -> 1.4 adds bc_resources only, with a backup', () => {
    make12(p);
    const raw = new DatabaseSync(p);
    raw.exec("UPDATE bc_meta SET value='3' WHERE key='format_minor'; CREATE TABLE bc_sources (id TEXT PRIMARY KEY, kind TEXT NOT NULL, props TEXT NOT NULL DEFAULT '{}'); CREATE TABLE bc_links (name TEXT PRIMARY KEY, source_id TEXT NOT NULL, remote_name TEXT NOT NULL, props TEXT NOT NULL DEFAULT '{}')");
    raw.close();
    const original = fs.readFileSync(p);
    const b = openBaseFile(p, 'write', '0.2.0');
    expect(b.migrated).toBe(true);
    expect(b.meta).toMatchObject({ formatMajor: 1, formatMinor: 4 });
    expect(b.db.prepare('SELECT count(*) AS n FROM bc_resources').get()).toEqual({ n: 0 });
    expect(fs.readFileSync(b.backupPath!)).toEqual(original);
    b.db.close();
  });

  it('bc_resources: binary name key, type check, data required', () => {
    createBaseFile(p, '0.2.0');
    const b = openBaseFile(p, 'write', '0.2.0');
    const ins = (n: string, t: string) => b.db.prepare("INSERT INTO bc_resources (name, type, data, created, modified) VALUES (?, ?, x'89504e47', 'c', 'm')").run(n, t);
    ins('a', 'png');
    expect(() => ins('a', 'gif')).toThrow(/UNIQUE|PRIMARY/);
    expect(() => ins('b', 'svg')).toThrow(/CHECK/);
    b.db.close();
  });

  it('bc_sources and bc_links are keyed by id and by name, props default to {}', () => {
    createBaseFile(p, '0.2.0');
    const b = openBaseFile(p, 'write', '0.2.0');
    b.db.exec("INSERT INTO bc_sources (id, kind) VALUES ('s1', 'basecraft')");
    expect(b.db.prepare('SELECT props FROM bc_sources').get()).toEqual({ props: '{}' });
    expect(() => b.db.exec("INSERT INTO bc_sources (id, kind) VALUES ('s1', 'sqlite')")).toThrow(/UNIQUE|PRIMARY/);
    expect(() => b.db.exec("INSERT INTO bc_sources (id, kind, props) VALUES ('s2', NULL, '{}')")).toThrow(/NOT NULL/);
    b.db.exec("INSERT INTO bc_links (name, source_id, remote_name) VALUES ('Clients', 's1', 'Clients')");
    expect(() => b.db.exec("INSERT INTO bc_links (name, source_id, remote_name) VALUES ('Clients', 's1', 'x')")).toThrow(/UNIQUE|PRIMARY/);
    expect(() => b.db.exec("INSERT INTO bc_links (name, source_id) VALUES ('x', 's1')")).toThrow(/NOT NULL/);
    b.db.close();
  });

  it('migrates a 1.0 base with a byte-identical backup, keeping its data', () => {
    make10(p);
    const original = fs.readFileSync(p);
    const b = openBaseFile(p, 'write', '0.2.0');
    expect(b.migrated).toBe(true);
    expect(b.meta).toMatchObject({ formatMajor: 1, formatMinor: 4 });
    expect(tableExists(b.db, 'bc_relations')).toBe(true);
    expect(tableExists(b.db, 'bc_objects')).toBe(true);
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
