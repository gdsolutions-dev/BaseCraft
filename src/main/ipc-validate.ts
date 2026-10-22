// Vérification des arguments venus du rendu (entrée non fiable) et traduction des erreurs en codes `bc:`.
// Module pur, sans Electron : testé sous Node.
import { statSync } from 'node:fs';
import { isAbsolute } from 'node:path';
import type { PageRequest, Relation, RelationsLayout, SaveTableRequest } from '../shared/api';
import type { CellInput } from '../shared/coerce';
import { validSpec, type ImportPlan, type ImportSpec } from '../shared/import-text';
import { BaseFileError, FILE_EXTENSION } from './db/file-format';

export function bad(): never { throw new TypeError('bc:invalidArgument'); }

const isObj = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === 'object' && Object.getPrototypeOf(v) === Object.prototype;
const isCell = (x: unknown) => x === null || typeof x === 'string' || typeof x === 'boolean' || (typeof x === 'number' && Number.isFinite(x));

export const str = (v: unknown): string => (typeof v === 'string' ? v : bad());
export const strOrNull = (v: unknown): string | null => (v === null ? null : str(v));
export const uint = (v: unknown): number => (Number.isSafeInteger(v) && (v as number) >= 0 ? (v as number) : bad());
// Array.from visits holes as undefined, so a sparse array is rejected.
export const uints = (v: unknown): number[] => (Array.isArray(v) ? Array.from(v, uint) : bad());

export const basePath = (v: unknown): string =>
  typeof v === 'string' && isAbsolute(v) && v.toLowerCase().endsWith(FILE_EXTENSION) ? v : bad();

export function cells(v: unknown): Record<string, CellInput> {
  if (!isObj(v) || !Object.values(v).every(isCell)) bad();
  return v as Record<string, CellInput>;
}

export function pageRequest(v: unknown): PageRequest {
  if (!isObj(v)) bad();
  const r: PageRequest = { offset: uint(v.offset), limit: uint(v.limit) };
  if (v.sort !== undefined) {
    const s = v.sort;
    if (!isObj(s) || typeof s.field !== 'string' || (s.dir !== 'asc' && s.dir !== 'desc')) bad();
    r.sort = { field: s.field, dir: s.dir };
  }
  return r;
}

const fields = (v: unknown): string[] =>
  (Array.isArray(v) && v.length >= 1 && v.length <= 10 ? Array.from(v, str) : bad());
const bool = (v: unknown): boolean => (typeof v === 'boolean' ? v : bad());

/** A relation, field by field (only the known fields cross); saveRelation checks the names against the base. */
export function relation(v: unknown): Relation {
  if (!isObj(v)) bad();
  const joinType = v.joinType === 1 || v.joinType === 2 || v.joinType === 3 ? v.joinType : bad();
  return {
    name: str(v.name), parentTable: str(v.parentTable), parentFields: fields(v.parentFields), childTable: str(v.childTable), childFields: fields(v.childFields),
    enforce: bool(v.enforce), cascadeUpdate: bool(v.cascadeUpdate), cascadeDelete: bool(v.cascadeDelete), joinType,
  };
}

export function relationsLayout(v: unknown): RelationsLayout {
  if (!isObj(v) || !isObj(v.tables)) bad();
  const tables: RelationsLayout['tables'] = {};
  for (const [k, p] of Object.entries(v.tables)) {
    if (k === '__proto__' || !isObj(p) || !Number.isFinite(p.x) || !Number.isFinite(p.y)) bad();
    tables[k] = { x: p.x as number, y: p.y as number };
  }
  return { tables };
}

// Shape only: createTable/alterTable validate the design itself.
export function saveRequest(v: unknown): SaveTableRequest {
  if (!isObj(v) || !(v.originalName === null || typeof v.originalName === 'string') || typeof v.allowDataLoss !== 'boolean'
    || !(v.acceptExistingViolations === undefined || typeof v.acceptExistingViolations === 'boolean')) bad();
  const d = v.design;
  if (!isObj(d) || typeof d.name !== 'string' || !(d.description === undefined || typeof d.description === 'string')
    || !(d.extra === undefined || isObj(d.extra)) || !Array.isArray(d.fields)
    || !Array.from(d.fields).every((x) => isObj(x) && typeof x.name === 'string' && isObj(x.props))) bad();
  if (!Array.isArray(v.mapping)
    || !Array.from(v.mapping).every((m) => isObj(m) && typeof m.name === 'string' && (m.sourceName === null || typeof m.sourceName === 'string'))) bad();
  return v as unknown as SaveTableRequest;
}

export const MAX_IMPORT_BYTES = 2 * 1024 ** 3;
/**
 * File to import: only a path the main-side open dialog returned in this session (`chosen`), still an existing file.
 * A file over `maxBytes` (2 GiB) rejects as bc:fileTooLarge.
 */
export function importPath(v: unknown, chosen: ReadonlySet<string>, maxBytes = MAX_IMPORT_BYTES): string {
  if (typeof v !== 'string' || !chosen.has(v) || !isAbsolute(v)) bad();
  let size: number;
  try {
    const st = statSync(v);
    if (!st.isFile()) bad();
    size = st.size;
  } catch {
    bad();
  }
  if (size > maxBytes) throw new Error('bc:fileTooLarge');
  return v;
}
export const importSpec = (v: unknown): ImportSpec => validSpec(v) ?? bad();
export const importSpecOrNull = (v: unknown): ImportSpec | null => (v === null ? null : importSpec(v));

/** Shape of an import plan; runImport checks the names against the base. */
export function importPlan(v: unknown): ImportPlan {
  if (!isObj(v) || !isObj(v.target)) bad();
  const spec = importSpec(v.spec);
  const t = v.target;
  if (typeof t.table !== 'string') bad();
  if (t.kind === 'new') {
    const pk = t.primaryKey;
    if (!isObj(pk)) bad();
    if (pk.kind === 'auto' || pk.kind === 'none') return { spec, target: { kind: 'new', table: t.table, primaryKey: { kind: pk.kind } } };
    if (pk.kind === 'field' && typeof pk.field === 'string') return { spec, target: { kind: 'new', table: t.table, primaryKey: { kind: 'field', field: pk.field } } };
    bad();
  }
  if (t.kind !== 'append' || !Array.isArray(t.mapping) || t.mapping.length > 255) bad();
  const mapping = Array.from(t.mapping, (m) => (m === null || typeof m === 'string' ? m : bad()));
  return { spec, target: { kind: 'append', table: t.table, mapping } };
}

/** Opening/creating a base: BaseFileError → `bc:<code>`; anything else (ENOENT, EACCES…) is logged → `bc:cannotOpen`. */
export function bcError(e: unknown): Error {
  if (e instanceof BaseFileError) return new Error(`bc:${e.code}`);
  console.error(e);
  return new Error('bc:cannotOpen');
}
