// Logique pure de l'assistant d'import de fichier texte (étapes, coupures, correspondance des champs, vérifications).
import { isValidObjectName, sameName, type TableDesign } from '../../shared/field-types';
import { sanitizeTableName, uniqueName, type ImportSpec, type PrimaryKeyChoice } from '../../shared/import-text';

export type Step = 'source' | 'format' | 'delimited' | 'fixed' | 'fields' | 'key' | 'finish';

/** Étapes de l'assistant : la clé primaire ne concerne qu'une nouvelle table. */
export function stepsFor(format: ImportSpec['format'], mode: 'new' | 'append'): Step[] {
  return ['source', 'format', format === 'fixed' ? 'fixed' : 'delimited', 'fields', ...(mode === 'new' ? ['key' as const] : []), 'finish'];
}

/** Options qui changent le découpage : les champs sont alors déduits de nouveau. */
const STRUCTURAL = ['format', 'delimiter', 'qualifier', 'hasHeader', 'encoding', 'breaks'] as const;
export const structuralChange = (a: ImportSpec, b: ImportSpec): boolean => STRUCTURAL.some((k) => JSON.stringify(a[k]) !== JSON.stringify(b[k]));

// ---------- Coupures (largeur fixe) ----------
export function addBreak(breaks: readonly number[], pos: number): number[] {
  if (!Number.isSafeInteger(pos) || pos <= 0 || breaks.includes(pos)) return [...breaks];
  return [...breaks, pos].sort((a, b) => a - b);
}
export const removeBreak = (breaks: readonly number[], pos: number): number[] => breaks.filter((b) => b !== pos);
/** Déplace une coupure ; refusé si la position est prise ou invalide. */
export function moveBreak(breaks: readonly number[], from: number, to: number): number[] {
  if (to === from) return [...breaks];
  if (!Number.isSafeInteger(to) || to <= 0 || breaks.includes(to)) return [...breaks];
  return addBreak(removeBreak(breaks, from), to);
}

// ---------- Destination ----------
export const fileName = (path: string): string => path.split(/[\\/]/).pop() ?? path;

/** Nom de table proposé : nom du fichier sans extension, nettoyé, différent des tables existantes. */
export function defaultTableName(path: string, tables: readonly string[], fallback: string): string {
  const base = fileName(path).replace(/\.[^.]*$/, '');
  return uniqueName(sanitizeTableName(base, fallback), tables);
}

/** Ajout à une table : chaque colonne va au champ de même nom (casse ignorée), s'il est modifiable et libre. */
export function mapByName(names: readonly string[], design: TableDesign): (string | null)[] {
  const used = new Set<string>();
  return names.map((n) => {
    const fd = design.fields.find((x) => x.props.type !== 'autoNumber' && sameName(x.name, n) && !used.has(x.name));
    if (!fd) return null;
    used.add(fd.name);
    return fd.name;
  });
}

// ---------- Vérifications (clés i18n) ----------
/** A datasheet of `table` has a row being edited: an append would show it on the wrong row once the rows are re-read. */
export function hasPendingRow(tabs: readonly { name: string; mode: string; dirty: boolean; isNew?: boolean }[], table: string): boolean {
  return tabs.some((x) => !x.isNew && x.mode === 'datasheet' && x.dirty && sameName(x.name, table));
}

/** Noms des champs importés : valides et distincts ; au moins un champ. */
export function fieldsError(spec: ImportSpec): { key: string; index?: number } | null {
  const kept = spec.fields.map((f, i) => ({ f, i })).filter((x) => !x.f.skip);
  if (kept.length === 0) return { key: 'importText.error.noField' };
  for (const { f, i } of kept) {
    if (f.name === '') return { key: 'designError.nameEmpty', index: i };
    if (!isValidObjectName(f.name) || ['rowid', 'oid', '_rowid_'].includes(f.name.toLowerCase())) return { key: 'designError.nameInvalid', index: i };
    if (kept.some((o) => o.i < i && sameName(o.f.name, f.name))) return { key: 'designError.nameDuplicate', index: i };
  }
  return null;
}

export function mappingError(mapping: readonly (string | null)[]): string | null {
  const used = mapping.filter((m): m is string => m !== null);
  if (used.length === 0) return 'importText.error.noField';
  return new Set(used).size === used.length ? null : 'importText.error.mappingDuplicate';
}

export function keyError(spec: ImportSpec, pk: PrimaryKeyChoice): string | null {
  return pk.kind === 'field' && !spec.fields.some((f) => !f.skip && f.name === pk.field) ? 'importText.error.pkField' : null;
}
