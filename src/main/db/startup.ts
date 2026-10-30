// Startup options of the base (bc_meta, options.startup): read tolerantly (R12), saved without losing what BaseCraft does not know.
import { existsSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { readStartup, type StartupOptions } from '../../shared/startup';
import { APPLICATION_ID, BaseFileError, checkBaseFile, readOptions, updateOptions } from './file-format';
import { lockPathFor } from './lock';

/** Untrusted file content: every key reads as its own default when wrong; never throws. */
export function startupOptions(db: DatabaseSync): StartupOptions {
  return readStartup(readOptions(db).startup);
}

/** The other options keys, and the startup keys of a newer BaseCraft, are kept; an unusable section is replaced. */
export function saveStartupOptions(db: DatabaseSync, o: StartupOptions): void {
  updateOptions(db, (opts) => {
    const prev = opts.startup;
    opts.startup = { ...(prev !== null && typeof prev === 'object' && !Array.isArray(prev) ? prev : {}), ...o };
  });
}

const SQLITE_READONLY_ROLLBACK = 776; // a hot journal, seen from a read-only connection

/** checkBaseFile, then a short connection — read-only when a `${path}.lock` file exists (a crashed base behind a stale lock keeps
 *  its hot journal for the take-over: needsRecovery as today), writable when there is none (SQLite rolls a shared writer's hot
 *  journal back under its own locks) — application_id, readStartup(options.startup). Null (today's path and errors) only when
 *  the file is not a BaseCraft base, or for that hot journal behind a lock. Fails closed otherwise: a busy file throws bc:busy,
 *  any other failure cannotOpen, so a data file in shared use is never opened exclusively after a failed read. */
export function peekStartup(path: string): StartupOptions | null {
  try { checkBaseFile(path); } catch { return null; } // not a base, or unreadable: today's path says which
  const locked = existsSync(lockPathFor(path));
  try {
    const db = new DatabaseSync(path, { readOnly: locked, timeout: 5000 });
    try {
      if ((db.prepare('PRAGMA application_id').get() as { application_id: number }).application_id !== APPLICATION_ID) return null;
      return startupOptions(db);
    } finally {
      db.close();
    }
  } catch (e) {
    const code = (e as { errcode?: number }).errcode ?? 0;
    if (locked && code === SQLITE_READONLY_ROLLBACK) return null;
    if (code % 256 === 5) throw new Error('bc:busy'); // SQLITE_BUSY
    throw new BaseFileError('cannotOpen');
  }
}
