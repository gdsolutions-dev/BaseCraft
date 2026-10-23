import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync, type AggregateOptions } from 'node:sqlite';
import { BC_OBJECTS_DDL, BC_RELATIONS_DDL, MIGRATIONS } from './migrations'; // migrations.ts only imports types from here
import { fold, SQL_AGGREGATES, SQL_FUNCTIONS } from '../../shared/expr/sql';
import { inTransaction } from './tx';

export const FILE_EXTENSION = '.basecraft';
export const APPLICATION_ID = 0x42435246; // 'BCRF'
export const CURRENT_FORMAT = { major: 1, minor: 2 };

export interface BaseMeta {
  formatMajor: number;
  formatMinor: number;
  appVersion: string;
  dbUuid: string;
  createdAt: string;
  options: Record<string, unknown>;
}
export interface Migration {
  toMajor: number;
  toMinor: number;
  up(db: DatabaseSync): void;
}
export type BaseFileErrorCode = 'exists' | 'notBasecraft' | 'newerMajor' | 'needsMigration' | 'cannotOpen';
export class BaseFileError extends Error {
  constructor(public code: BaseFileErrorCode, message?: string) {
    super(message ?? code);
    this.name = 'BaseFileError';
  }
}
export interface OpenedBase {
  db: DatabaseSync;
  meta: BaseMeta;
  migrated: boolean;
  backupPath?: string;
}

const SQLITE_HEADER = Buffer.from('SQLite format 3\0', 'latin1');

export function registerFunctions(db: DatabaseSync): void {
  db.function('bc_fold', { deterministic: true }, (x) => (x === null || x === undefined ? null : fold(String(x))));
  // Fonctions des expressions compilées par sql.ts : seulement dans les requêtes générées, jamais dans le schéma.
  for (const [name, { deterministic, fn }] of Object.entries(SQL_FUNCTIONS)) db.function(name, { deterministic, varargs: true, useBigIntArguments: true }, fn);
  for (const [name, a] of Object.entries(SQL_AGGREGATES)) {
    db.aggregate(name, { ...a, varargs: true, useBigIntArguments: true } as unknown as AggregateOptions);
  }
}

/** Every function registerFunctions adds (the SQL authorizer allows only these, plus count, rank and row_number). */
export const REGISTERED_FUNCTIONS: ReadonlySet<string> = new Set(['bc_fold', ...Object.keys(SQL_FUNCTIONS), ...Object.keys(SQL_AGGREGATES)]);

export function createBaseFile(filePath: string, appVersion: string): void {
  if (fs.existsSync(filePath)) throw new BaseFileError('exists');
  const db = new DatabaseSync(filePath);
  try {
    db.exec(`PRAGMA application_id=${APPLICATION_ID}`);
    db.exec('BEGIN');
    db.exec(`CREATE TABLE bc_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE bc_tables (name TEXT PRIMARY KEY COLLATE NOCASE, props TEXT NOT NULL DEFAULT '{}');
CREATE TABLE bc_fields (table_name TEXT NOT NULL COLLATE NOCASE, field_name TEXT NOT NULL COLLATE NOCASE,
  position INTEGER NOT NULL, props TEXT NOT NULL, PRIMARY KEY (table_name, field_name));
${BC_RELATIONS_DDL};
${BC_OBJECTS_DDL};`);
    const ins = db.prepare('INSERT INTO bc_meta (key, value) VALUES (?, ?)');
    ins.run('format_major', String(CURRENT_FORMAT.major));
    ins.run('format_minor', String(CURRENT_FORMAT.minor));
    ins.run('app_version', appVersion);
    ins.run('db_uuid', crypto.randomUUID());
    ins.run('created_at', new Date().toISOString());
    ins.run('options', '{}');
    db.exec('COMMIT');
  } catch (e) {
    db.close();
    fs.rmSync(filePath, { force: true });
    throw e;
  }
  db.close();
}

// First 100 bytes: magic + application_id (bytes 68-71, big-endian). No SQLite involved.
function looksLikeBaseCraft(filePath: string): boolean {
  const buf = Buffer.alloc(100);
  const fd = fs.openSync(filePath, 'r');
  try {
    return (
      fs.readSync(fd, buf, 0, 100, 0) === 100 &&
      buf.subarray(0, 16).equals(SQLITE_HEADER) &&
      buf.readUInt32BE(68) === APPLICATION_ID
    );
  } finally {
    fs.closeSync(fd);
  }
}

/** Header check only (no SQLite): throws BaseFileError cannotOpen (unreadable/missing) or notBasecraft. */
export function checkBaseFile(filePath: string): void {
  let ok: boolean;
  try {
    ok = looksLikeBaseCraft(filePath);
  } catch {
    throw new BaseFileError('cannotOpen');
  }
  if (!ok) throw new BaseFileError('notBasecraft');
}

function readMeta(db: DatabaseSync): BaseMeta {
  const m = new Map<string, string>();
  for (const r of db.prepare('SELECT key, value FROM bc_meta').all() as { key: string; value: string }[]) m.set(r.key, r.value);
  const rawMajor = m.get('format_major') ?? '';
  const rawMinor = m.get('format_minor') ?? '';
  if (!/^\d+$/.test(rawMajor) || !/^\d+$/.test(rawMinor)) throw new Error('bad format version');
  const major = Number(rawMajor);
  const minor = Number(rawMinor);
  return {
    formatMajor: major,
    formatMinor: minor,
    appVersion: m.get('app_version') ?? '',
    dbUuid: m.get('db_uuid') ?? '',
    createdAt: m.get('created_at') ?? '',
    options: JSON.parse(m.get('options') ?? '{}') as Record<string, unknown>,
  };
}

/** bc_meta options (untrusted file content): anything but an object reads as {}. */
export function readOptions(db: DatabaseSync): Record<string, unknown> {
  const row = db.prepare(`SELECT value FROM bc_meta WHERE key = 'options'`).get() as { value: string } | undefined;
  try {
    const o: unknown = JSON.parse(row?.value ?? '{}');
    return o !== null && typeof o === 'object' && !Array.isArray(o) ? (o as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/** Changes the options in place (other keys are kept), atomically. */
export function updateOptions(db: DatabaseSync, fn: (o: Record<string, unknown>) => void): void {
  inTransaction(db, () => {
    const o = readOptions(db);
    fn(o);
    db.prepare(`INSERT INTO bc_meta (key, value) VALUES ('options', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`).run(JSON.stringify(o));
  });
}

const pad = (n: number, w = 2): string => String(n).padStart(w, '0');
function stamp(d: Date): string {
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

/** Copies the base to `<name>.backup-YYYYMMDD-HHMMSS[-n].basecraft` beside it (never overwriting a file) and returns that path.
 *  Before a format migration and before Compact and Repair (spec 6). */
export function backupCopy(filePath: string, now: Date = new Date()): string {
  const base = path.join(path.dirname(filePath), `${path.basename(filePath, FILE_EXTENSION)}.backup-${stamp(now)}`);
  // A migration retried within the same second (the first one failed) gets its own name; a backup is never overwritten.
  for (let n = 0; ; n++) {
    const backupPath = `${base}${n ? `-${n}` : ''}${FILE_EXTENSION}`;
    try {
      fs.copyFileSync(filePath, backupPath, fs.constants.COPYFILE_EXCL);
      return backupPath;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'EEXIST' || n >= 99) throw e;
    }
  }
}

export function openBaseFile(
  filePath: string,
  mode: 'write' | 'readOnly',
  appVersion: string,
  opts: { current?: { major: number; minor: number }; migrations?: Migration[]; now?: () => Date } = {},
): OpenedBase {
  const current = opts.current ?? CURRENT_FORMAT;
  const migrations = opts.migrations ?? MIGRATIONS;
  const now = opts.now ?? (() => new Date());

  // 1. header + application_id from raw bytes, before SQLite ever opens the file
  checkBaseFile(filePath);

  // 2. read-only inspection
  const probe = (): BaseMeta => {
    const p = new DatabaseSync(filePath, { readOnly: true });
    try {
      const appId = (p.prepare('PRAGMA application_id').get() as { application_id: number }).application_id;
      if (appId !== APPLICATION_ID) throw new BaseFileError('notBasecraft');
      return readMeta(p);
    } finally {
      p.close();
    }
  };
  const HOT_JOURNAL = 776; // SQLITE_READONLY_ROLLBACK
  let meta: BaseMeta;
  try {
    try {
      meta = probe();
    } catch (e) {
      if (mode !== 'write' || (e as { errcode?: number }).errcode !== HOT_JOURNAL) throw e;
      // crashed base: a write connection lets SQLite roll the hot journal back
      const r = new DatabaseSync(filePath);
      try {
        r.prepare('SELECT count(*) FROM sqlite_master').get();
      } finally {
        r.close();
      }
      meta = probe();
    }
  } catch (e) {
    if (e instanceof BaseFileError) throw e;
    throw new BaseFileError('cannotOpen'); // unreadable bc_meta, bad version, hot journal in readOnly, corrupt file
  }

  // 3. version check
  if (meta.formatMajor > current.major) throw new BaseFileError('newerMajor');
  const older = meta.formatMajor < current.major || (meta.formatMajor === current.major && meta.formatMinor < current.minor);
  const pending = older
    ? migrations
        .filter((m) => m.toMajor > meta.formatMajor || (m.toMajor === meta.formatMajor && m.toMinor > meta.formatMinor))
        .filter((m) => m.toMajor < current.major || (m.toMajor === current.major && m.toMinor <= current.minor))
        .sort((a, b) => a.toMajor - b.toMajor || a.toMinor - b.toMinor)
    : [];
  if (meta.formatMajor < current.major && !pending.some((m) => m.toMajor === current.major)) {
    throw new BaseFileError('cannotOpen'); // no migration path: never re-stamp without a schema change
  }
  const needsMigration = older && pending.length > 0;
  if (needsMigration && mode === 'readOnly') throw new BaseFileError('needsMigration');

  const backupPath = needsMigration ? backupCopy(filePath, now()) : undefined;

  // 4. reopen in requested mode
  let db: DatabaseSync;
  try {
    db = new DatabaseSync(filePath, { readOnly: mode === 'readOnly', timeout: 5000 });
  } catch {
    throw new BaseFileError('cannotOpen');
  }
  try {
    if (mode === 'write') {
      db.exec('PRAGMA journal_mode=DELETE');
      db.exec('PRAGMA synchronous=FULL');
    }
    db.exec('PRAGMA foreign_keys=ON');
    db.exec('PRAGMA legacy_alter_table=OFF'); // a table rename rewrites the REFERENCES clauses of the other tables
    db.exec('PRAGMA busy_timeout=5000');
    registerFunctions(db);
    if (needsMigration) {
      db.exec('BEGIN');
      try {
        for (const m of pending) m.up(db);
        const upd = db.prepare('UPDATE bc_meta SET value = ? WHERE key = ?');
        upd.run(String(current.major), 'format_major');
        upd.run(String(current.minor), 'format_minor');
        if (mode === 'write' && meta.appVersion !== appVersion) upd.run(appVersion, 'app_version');
        db.exec('COMMIT');
      } catch (e) {
        db.exec('ROLLBACK');
        throw e;
      }
      meta = readMeta(db);
    } else if (mode === 'write' && meta.appVersion !== appVersion) {
      db.prepare('UPDATE bc_meta SET value = ? WHERE key = ?').run(appVersion, 'app_version');
      meta = readMeta(db);
    }
  } catch (e) {
    db.close();
    throw e;
  }
  return { db, meta, migrated: needsMigration, backupPath };
}
