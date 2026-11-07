// Default theme of the base (bc_meta, options.theme): read tolerantly (anything invalid reads as the built-in theme), saved
// without losing the other option keys.
import { DatabaseSync } from 'node:sqlite';
import { readTheme, type Theme } from '../../shared/design/theme';
import { readOptions, updateOptions } from './file-format';

/** Untrusted file content: never throws. */
export function baseTheme(db: DatabaseSync): Theme {
  return readTheme(readOptions(db).theme);
}

export function saveBaseTheme(db: DatabaseSync, t: Theme): void {
  updateOptions(db, (opts) => { opts.theme = readTheme(t); });  // normalized: only the known keys are stored
}
