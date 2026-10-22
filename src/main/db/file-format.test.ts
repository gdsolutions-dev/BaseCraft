import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import {
  APPLICATION_ID,
  BaseFileError,
  createBaseFile,
  openBaseFile,
  type Migration,
} from './file-format';

let dir: string;
let p: string;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bcff-'));
  p = path.join(dir, 'test.basecraft');
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

function expectCode(fn: () => unknown, code: string): void {
  try {
    fn();
  } catch (e) {
    expect(e).toBeInstanceOf(BaseFileError);
    expect((e as BaseFileError).code).toBe(code);
    return;
  }
  throw new Error('expected BaseFileError ' + code);
}
function makeFile(kind: string): Buffer {
  if (kind === 'empty') fs.writeFileSync(p, '');
  else if (kind === 'text') fs.writeFileSync(p, 'hello');
  else {
    const db = new DatabaseSync(p);
    if (kind === 'wal') db.exec('PRAGMA journal_mode=WAL');
    db.exec('CREATE TABLE t(x)');
    db.close();
  }
  return fs.readFileSync(p);
}
function editMeta(sql: string): Buffer {
  createBaseFile(p, '0.1.0');
  const db = new DatabaseSync(p);
  db.exec(sql);
  db.close();
  return fs.readFileSync(p);
}
function metaValue(file: string, key: string): string | undefined {
  const db = new DatabaseSync(file, { readOnly: true });
  const r = db.prepare('SELECT value FROM bc_meta WHERE key = ?').get(key) as { value: string } | undefined;
  db.close();
  return r?.value;
}
function tableExists(db: DatabaseSync, name: string): boolean {
  return !!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name = ?").get(name);
}

describe('file-format', () => {
  it('creates and opens a BaseCraft file', () => {
    createBaseFile(p, '0.1.0');
    const b = openBaseFile(p, 'write', '0.1.0');
    expect(b.meta).toMatchObject({ formatMajor: 1, formatMinor: 1, appVersion: '0.1.0', options: {} });
    expect(b.meta.dbUuid).toMatch(/^[0-9a-f-]{36}$/);
    expect(b.db.prepare('PRAGMA application_id').get()).toEqual({ application_id: APPLICATION_ID });
    expect(b.db.prepare('PRAGMA journal_mode').get()).toEqual({ journal_mode: 'delete' });
    expect(b.db.prepare("SELECT bc_fold('Éte') AS v").get()).toEqual({ v: 'ete' });
    b.db.close();
  });
  it('refuses to overwrite', () => {
    createBaseFile(p, '0.1.0');
    expectCode(() => createBaseFile(p, '0.1.0'), 'exists');
  });
  it.each(['empty', 'text', 'plainSqlite', 'wal'])('rejects %s file and leaves it untouched', (kind) => {
    const before = makeFile(kind);
    const files = fs.readdirSync(dir);
    expectCode(() => openBaseFile(p, 'write', '0.1.0'), 'notBasecraft');
    expect(fs.readFileSync(p)).toEqual(before);
    expect(fs.readdirSync(dir)).toEqual(files);
  });
  it('refuses newer major, untouched', () => {
    const before = editMeta("UPDATE bc_meta SET value='2' WHERE key='format_major'");
    expectCode(() => openBaseFile(p, 'write', '0.1.0'), 'newerMajor');
    expect(fs.readFileSync(p)).toEqual(before);
  });
  it('opens newer minor and keeps unknown meta keys', () => {
    editMeta("UPDATE bc_meta SET value='5' WHERE key='format_minor'; INSERT INTO bc_meta VALUES ('futureKey','x')");
    const b = openBaseFile(p, 'write', '0.1.0');
    b.db.close();
    expect(metaValue(p, 'futureKey')).toBe('x');
    expect(b.meta.formatMinor).toBe(5);
  });
  it('application_id without bc_meta is cannotOpen', () => {
    const db = new DatabaseSync(p);
    db.exec(`PRAGMA application_id=${APPLICATION_ID}; CREATE TABLE t(x)`);
    db.close();
    const before = fs.readFileSync(p);
    expectCode(() => openBaseFile(p, 'write', '0.1.0'), 'cannotOpen');
    expect(fs.readFileSync(p)).toEqual(before);
  });
  it.each(["''", "'-1'", "'x'", "'1.5'"])('damaged format_major %s is cannotOpen, untouched', (v) => {
    const before = editMeta(`UPDATE bc_meta SET value=${v} WHERE key='format_major'`);
    expectCode(() => openBaseFile(p, 'write', '0.1.0', { current: { major: 2, minor: 0 }, migrations: m }), 'cannotOpen');
    expect(fs.readFileSync(p)).toEqual(before);
    expect(fs.readdirSync(dir)).toEqual(['test.basecraft']);
  });
  it('older major without a migration reaching current is cannotOpen, no backup', () => {
    createBaseFile(p, '0.1.0');
    const before = fs.readFileSync(p);
    expectCode(() => openBaseFile(p, 'write', '0.1.0', { current: { major: 2, minor: 0 }, migrations: [] }), 'cannotOpen');
    expect(fs.readFileSync(p)).toEqual(before);
    expect(fs.readdirSync(dir)).toEqual(['test.basecraft']);
  });
  it('write open updates app_version, readOnly does not', () => {
    createBaseFile(p, '0.1.0');
    openBaseFile(p, 'readOnly', '0.2.0').db.close();
    expect(metaValue(p, 'app_version')).toBe('0.1.0');
    const b = openBaseFile(p, 'write', '0.2.0');
    expect(b.meta.appVersion).toBe('0.2.0');
    b.db.close();
    expect(metaValue(p, 'app_version')).toBe('0.2.0');
  });
  it('recovers a crashed base (hot journal) in write mode; readOnly is cannotOpen', () => {
    createBaseFile(p, '0.1.0');
    const w = new DatabaseSync(p);
    w.exec('PRAGMA cache_size=5; CREATE TABLE big(x)');
    w.exec('BEGIN');
    for (let i = 0; i < 300; i++) w.prepare('INSERT INTO big VALUES (?)').run('y'.repeat(2000) + i);
    w.exec("UPDATE bc_meta SET value='0.9.9' WHERE key='app_version'");
    const c = path.join(dir, 'crashed.basecraft');
    fs.copyFileSync(p, c);
    fs.copyFileSync(p + '-journal', c + '-journal');
    w.exec('ROLLBACK');
    w.close();
    expectCode(() => openBaseFile(c, 'readOnly', '0.1.0'), 'cannotOpen');
    const b = openBaseFile(c, 'write', '0.1.0');
    expect(b.meta.appVersion).toBe('0.1.0');
    expect(b.db.prepare('SELECT count(*) AS n FROM big').get()).toEqual({ n: 0 });
    b.db.close();
  });
  const m: Migration[] = [{ toMajor: 2, toMinor: 0, up: (db) => db.exec('CREATE TABLE bc_marker(x)') }];
  const cur = { major: 2, minor: 0 };
  it('migrates older major with a byte-identical backup', () => {
    createBaseFile(p, '0.1.0');
    const original = fs.readFileSync(p);
    const b = openBaseFile(p, 'write', '0.1.0', { current: cur, migrations: m, now: () => new Date('2026-10-21T10:00:00') });
    expect(b.migrated).toBe(true);
    expect(b.backupPath).toMatch(/test\.backup-20261021-100000\.basecraft$/);
    expect(fs.readFileSync(b.backupPath!)).toEqual(original);
    expect(tableExists(b.db, 'bc_marker')).toBe(true);
    expect(b.meta.formatMajor).toBe(2);
    b.db.close();
    expect(metaValue(p, 'format_major')).toBe('2');
  });
  it('failing migration rolls back and keeps the backup', () => {
    createBaseFile(p, '0.1.0');
    const bad: Migration[] = [{ toMajor: 2, toMinor: 0, up: (db) => { db.exec('CREATE TABLE bc_marker(x)'); throw new Error('boom'); } }];
    expect(() => openBaseFile(p, 'write', '0.1.0', { current: cur, migrations: bad })).toThrow('boom');
    expect(fs.readdirSync(dir).filter((f) => f.includes('.backup-'))).toHaveLength(1);
    const db = new DatabaseSync(p, { readOnly: true });
    expect(tableExists(db, 'bc_marker')).toBe(false);
    db.close();
    expect(metaValue(p, 'format_major')).toBe('1');
  });
  it('read-only open never migrates', () => {
    createBaseFile(p, '0.1.0');
    expectCode(() => openBaseFile(p, 'readOnly', '0.1.0', { current: cur, migrations: m }), 'needsMigration');
    expect(fs.readdirSync(dir)).toEqual(['test.basecraft']);
  });
});
