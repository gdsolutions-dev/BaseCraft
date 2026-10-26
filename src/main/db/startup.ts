// Startup options of the base (bc_meta, options.startup): read tolerantly (R12), saved without losing what BaseCraft does not know.
import type { DatabaseSync } from 'node:sqlite';
import { readStartup, type StartupOptions } from '../../shared/startup';
import { readOptions, updateOptions } from './file-format';

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
