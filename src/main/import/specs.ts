// Spécifications d'import enregistrées dans la base : bc_meta, clé options → importSpecs (nom → spécification).
// Relues avec validation : une entrée abîmée ou d'une version future est ignorée, jamais transmise telle quelle.
import type { DatabaseSync } from 'node:sqlite';
import { validSpec, type ImportSpec } from '../../shared/import-text';
import { readOptions, updateOptions } from '../db/file-format';

export function loadSpecs(db: DatabaseSync): Record<string, ImportSpec> {
  const raw = readOptions(db).importSpecs;
  const out: Record<string, ImportSpec> = {};
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return out;
  for (const [name, v] of Object.entries(raw)) {
    const s = validSpec(v);
    if (s && validSpecName(name)) out[name] = s;
  }
  return out;
}

export const validSpecName = (n: string): boolean => n.trim() === n && n.length > 0 && [...n].length <= 64 && n !== '__proto__';

function update(db: DatabaseSync, fn: (specs: Record<string, unknown>) => void): void {
  updateOptions(db, (o) => {
    const specs = o.importSpecs !== null && typeof o.importSpecs === 'object' && !Array.isArray(o.importSpecs)
      ? { ...(o.importSpecs as Record<string, unknown>) } : {};
    fn(specs);
    o.importSpecs = specs;
  });
}

export function saveSpec(db: DatabaseSync, name: string, spec: ImportSpec): void {
  if (!validSpecName(name)) throw new TypeError('bc:invalidArgument');
  update(db, (s) => { s[name] = spec; });
}

export function deleteSpec(db: DatabaseSync, name: string): void {
  update(db, (s) => { delete s[name]; });
}
