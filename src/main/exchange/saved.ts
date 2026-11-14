// Saved exports (F4): bc_meta options, key savedExports → name → SavedExport. Read with validation, as the saved import specs are:
// a damaged entry or one from a future version is ignored, never passed on as it is.
import type { DatabaseSync } from 'node:sqlite';
import { validSavedExport, validSavedImport, validSavedName, type SavedExport, type SavedImport } from '../../shared/exchange';
import { readOptions, updateOptions } from '../db/file-format';

export function loadSavedExports(db: DatabaseSync): Record<string, SavedExport> {
  const raw = readOptions(db).savedExports;
  const out: Record<string, SavedExport> = {};
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return out;
  for (const [name, v] of Object.entries(raw)) {
    const s = validSavedExport(v);
    if (s && validSavedName(name)) out[name] = s;
  }
  return out;
}

function update(db: DatabaseSync, fn: (all: Record<string, unknown>) => void, key: 'savedExports' | 'savedImports' = 'savedExports'): void {
  updateOptions(db, (o) => {
    const all = o[key] !== null && typeof o[key] === 'object' && !Array.isArray(o[key]) ? { ...(o[key] as Record<string, unknown>) } : {};
    fn(all);
    o[key] = all;
  });
}

export function saveSavedExport(db: DatabaseSync, name: string, e: SavedExport): void {
  if (!validSavedName(name) || !validSavedExport(e)) throw new TypeError('bc:invalidArgument');
  update(db, (all) => { all[name] = e; });
}

export function deleteSavedExport(db: DatabaseSync, name: string): void {
  update(db, (all) => { delete all[name]; });
}

/** Saved imports (Access's Saved Imports): the same, key savedImports. */
export function loadSavedImports(db: DatabaseSync): Record<string, SavedImport> {
  const raw = readOptions(db).savedImports;
  const out: Record<string, SavedImport> = {};
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return out;
  for (const [name, v] of Object.entries(raw)) {
    const s = validSavedImport(v);
    if (s && validSavedName(name)) out[name] = s;
  }
  return out;
}

export function saveSavedImport(db: DatabaseSync, name: string, i: SavedImport): void {
  if (!validSavedName(name) || !validSavedImport(i)) throw new TypeError('bc:invalidArgument');
  update(db, (all) => { all[name] = i; }, 'savedImports');
}

export function deleteSavedImport(db: DatabaseSync, name: string): void {
  update(db, (all) => { delete all[name]; }, 'savedImports');
}
