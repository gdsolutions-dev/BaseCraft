// Vérification des arguments venus du rendu (entrée non fiable) et traduction des erreurs en codes `bc:`.
// Module pur, sans Electron : testé sous Node.
import { statSync } from 'node:fs';
import { isAbsolute } from 'node:path';
import {
  MAX_FILTERS, MAX_PRINT_HTML_CHARS, type FieldFilter, type ObjectKind, type PageRequest, type PrintRequest, type RecordSourceRef, type Relation, type RelationsLayout, type SaveTableRequest,
  type SourcePageRequest, type SourceSaveRequest, type QueryRef, type RunActionOptions,
} from '../shared/api';
import { isValidObjectName, MAX_INDEX_FIELDS, MAX_INDEXES } from '../shared/field-types';
import { pngSize } from '../shared/png';
import { cleanTitle, isValidIcon, MAX_APP_TITLE, type StartupOptions } from '../shared/startup';
import type { CellInput } from '../shared/coerce';
import { validExportSpec, type ExportSource, type ExportTextSpec } from '../shared/exchange';
import { validSpec, type ImportPlan, type ImportSpec } from '../shared/import-text';
import { BaseFileError, FILE_EXTENSION } from './db/file-format';
import { definitionJson, MAX_DEFINITION_CHARS } from './db/objects';

export { MAX_DEFINITION_CHARS };

export function bad(): never { throw new TypeError('bc:invalidArgument'); }

const isObj = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === 'object' && Object.getPrototypeOf(v) === Object.prototype;
const isCell = (x: unknown) => x === null || typeof x === 'string' || typeof x === 'boolean' || (typeof x === 'number' && Number.isFinite(x));

export const str = (v: unknown): string => (typeof v === 'string' ? v : bad());

/** A string of at most `max` code points; the UTF-16 length is checked first (≤ 4 × max), so a huge string is refused
 *  before anything walks it. */
function boundedName(v: unknown, max: number): string {
  if (typeof v !== 'string' || v.length > max * 4) bad();
  let n = 0;
  for (const _ of v.normalize('NFC')) if (++n > max) bad(); // the core stores and counts names in NFC
  return v;
}
export const MAX_NAME_CHARS = 64;
export const MAX_LOOKUP_CHARS = 1024;
/** A name that CREATES or RENAMES a table, object, field or spec: at most 64 characters, as BaseCraft allows. */
export const nameArg = (v: unknown): string => boundedName(v, MAX_NAME_CHARS);
/** A name that LOOKS UP something that exists (table, object, field, sort or filter field, cell key, mapping source): at most
 *  1024 characters, so a table an external tool created with a long name stays readable (C8). */
export const lookupName = (v: unknown): string => boundedName(v, MAX_LOOKUP_CHARS);
export const uint = (v: unknown): number => (Number.isSafeInteger(v) && (v as number) >= 0 ? (v as number) : bad());
// Array.from visits holes as undefined, so a sparse array is rejected.
export const uints = (v: unknown): number[] => (Array.isArray(v) ? Array.from(v, uint) : bad());

export const basePath = (v: unknown): string =>
  typeof v === 'string' && isAbsolute(v) && v.toLowerCase().endsWith(FILE_EXTENSION) ? v : bad();

export function cells(v: unknown): Record<string, CellInput> {
  if (!isObj(v) || !Object.values(v).every(isCell)) bad();
  for (const k of Object.keys(v)) lookupName(k);
  return v as Record<string, CellInput>;
}

export const strOrNull = (v: unknown): string | null => (v === null ? null : str(v));
/** An object's description (Properties dialog): null or at most 255 characters, as in Access. */
export const description = (v: unknown): string | null => (v === null ? null : boundedName(v, 255));

const OBJECT_KINDS: readonly string[] = ['query', 'form', 'report', 'macro', 'module'];
export const objectKind = (v: unknown): ObjectKind => (typeof v === 'string' && OBJECT_KINDS.includes(v) ? (v as ObjectKind) : bad());
export const objectKindOrAll = (v: unknown): ObjectKind | undefined => (v === undefined ? undefined : objectKind(v));

/** An object definition: a plain JSON object within the save limits (definitionJson), returned as JSON gives it back. */
export function definition(v: unknown, maxChars = MAX_DEFINITION_CHARS): unknown {
  const json = definitionJson(v, maxChars);
  return json === null ? bad() : (JSON.parse(json) as unknown);
}

export function sourceRef(v: unknown): RecordSourceRef {
  if (!isObj(v)) bad();
  if (v.kind === 'table' || v.kind === 'query') return { kind: v.kind, name: lookupName(v.name) };
  if (v.kind === 'sql' && typeof v.sql === 'string' && v.sql.length <= MAX_SQL_CHARS) return { kind: 'sql', sql: v.sql };
  bad();
}

export const MAX_PAGE_ROWS = 10_000;
const MAX_SQL_CHARS = 1_048_576; // a query definition's SQL (definition.ts); Access stops at 64 000 characters
export const MAX_CRITERIA_CHARS = 2000;
export const MAX_SORT_KEYS = 8;
const MAX_PARAMS = 100;
export const MAX_WHERE_CHARS = 65_536;

/** A page of a record source: at most MAX_PAGE_ROWS rows, MAX_SORT_KEYS sort keys, MAX_FILTERS filters, MAX_PARAMS parameter
 *  values and a Where Condition of at most MAX_WHERE_CHARS characters. */
export function sourcePageRequest(v: unknown): SourcePageRequest {
  if (!isObj(v)) bad();
  const r: SourcePageRequest = { offset: uint(v.offset), limit: uint(v.limit) };
  if (r.limit > MAX_PAGE_ROWS) bad();
  if (v.sort !== undefined) {
    if (!Array.isArray(v.sort) || v.sort.length > MAX_SORT_KEYS) bad();
    r.sort = Array.from(v.sort, (s) => (isObj(s) && (s.dir === 'asc' || s.dir === 'desc') ? { field: lookupName(s.field), dir: s.dir } : bad()));
  }
  if (v.filter !== undefined) r.filter = fieldFilters(v.filter);
  if (v.params !== undefined) r.params = queryParams(v.params);
  if (v.where !== undefined) r.where = typeof v.where === 'string' && v.where.length <= MAX_WHERE_CHARS ? v.where : bad();
  return r;
}

export function pageRequest(v: unknown): PageRequest {
  if (!isObj(v)) bad();
  const r: PageRequest = { offset: uint(v.offset), limit: uint(v.limit) };
  if (v.sort !== undefined) {
    const s = v.sort;
    if (!isObj(s) || (s.dir !== 'asc' && s.dir !== 'desc')) bad();
    r.sort = { field: lookupName(s.field), dir: s.dir };
  }
  if (v.filter !== undefined) r.filter = fieldFilters(v.filter);
  return r;
}

/** A datasheet filter: 0 to MAX_FILTERS {field, criteria} (only those cross); compileFilter checks names and criteria. */
export function fieldFilters(v: unknown): FieldFilter[] | undefined {
  if (v === undefined) return undefined;
  if (!Array.isArray(v) || v.length > MAX_FILTERS) bad();
  return Array.from(v, (x: unknown) => (isObj(x) && typeof x.criteria === 'string' && x.criteria.length <= MAX_CRITERIA_CHARS
    ? { field: lookupName(x.field), criteria: x.criteria } : bad()));
}

const fields = (v: unknown): string[] =>
  (Array.isArray(v) && v.length >= 1 && v.length <= 10 ? Array.from(v, lookupName) : bad());
const bool = (v: unknown): boolean => (typeof v === 'boolean' ? v : bad());

/** A relation, field by field (only the known fields cross); saveRelation checks the names against the base. Its name creates
 *  or renames (nameArg; '' asks for a generated one); tables and fields are looked up (lookupName). */
export function relation(v: unknown): Relation {
  if (!isObj(v)) bad();
  const joinType = v.joinType === 1 || v.joinType === 2 || v.joinType === 3 ? v.joinType : bad();
  return {
    name: nameArg(v.name), parentTable: lookupName(v.parentTable), parentFields: fields(v.parentFields), childTable: lookupName(v.childTable),
    childFields: fields(v.childFields),
    enforce: bool(v.enforce), cascadeUpdate: bool(v.cascadeUpdate), cascadeDelete: bool(v.cascadeDelete), joinType,
  };
}

/** Keyed by table name: a table may be named "__proto__" (IPC delivers it as an own key), so no prototype to set. */
export function relationsLayout(v: unknown): RelationsLayout {
  if (!isObj(v) || !isObj(v.tables)) bad();
  const tables: RelationsLayout['tables'] = Object.create(null);
  for (const [k, p] of Object.entries(v.tables)) {
    if (!isObj(p) || !Number.isFinite(p.x) || !Number.isFinite(p.y)) bad();
    tables[lookupName(k)] = { x: p.x as number, y: p.y as number };
  }
  return { tables };
}

const STARTUP_KEYS = ['appTitle', 'appIcon', 'startupForm', 'showNavPane', 'ribbon', 'runMode'];
/** The startup options to save: exactly the six keys, each of its exact type, and already in the form readStartup reads back
 *  (a title that cleanTitle would change, an icon that is no PNG, a form that is no object name are refused, never repaired). */
export function startupOptions(v: unknown): StartupOptions {
  if (!isObj(v) || Object.keys(v).length !== STARTUP_KEYS.length || !STARTUP_KEYS.every((k) => Object.hasOwn(v, k))) bad();
  const { appTitle, appIcon, startupForm, showNavPane, ribbon, runMode } = v;
  if (typeof appTitle !== 'string' || appTitle.length > MAX_APP_TITLE * 2 || appTitle !== cleanTitle(appTitle)) bad(); // 255 code points never take more than 510 UTF-16 units
  if (typeof appIcon !== 'string' || (appIcon !== '' && !isValidIcon(appIcon))) bad();
  if (typeof startupForm !== 'string' || (startupForm !== '' && !isValidObjectName(startupForm))) bad();
  if (typeof showNavPane !== 'boolean' || typeof runMode !== 'boolean' || (ribbon !== 'full' && ribbon !== 'simplified')) bad();
  return { appTitle, appIcon, startupForm, showNavPane, ribbon, runMode };
}

/** The window icon the renderer re-encoded: null (BaseCraft's), or a Uint8Array of at most 1 MiB that starts as a PNG does (signature and IHDR chunk).
 *  Its size is checked where it is read (setWindowIcon: header first, then nativeImage). */
const MAX_ICON_BYTES = 1024 * 1024;
export function iconBytes(v: unknown): Uint8Array | null {
  if (v === null) return null;
  if (!(v instanceof Uint8Array) || v.byteLength > MAX_ICON_BYTES || pngSize(v) === null) bad();
  return v;
}

const MAX_FIELDS = 255; // as in Access; checked before a list is read (a sparse array claims billions of slots)
/** A Validation Rule: at most 2048 characters, as in Access. Its text (and a Validation Text, 255 code points as the UI) are
 *  strings: anything else would reach validateDesign and renamedRule as an untyped TypeError. */
export const MAX_RULE_CHARS = 2048;
function ruleProps(o: Record<string, unknown>): void {
  if (!(o.validationRule === undefined || (typeof o.validationRule === 'string' && o.validationRule.length <= MAX_RULE_CHARS))) bad();
  if (o.validationText !== undefined) boundedName(o.validationText, 255);
}

/**
 * Shape of a table save; createTable/alterTable validate the design itself and explain a bad name with a typed design error
 * (an empty name is nameEmpty, not bc:invalidArgument). Names here are only length caps, as statements: a name kept as it is
 * (the table's, or a field mapped from the same name) is a lookup (1024: an external table's long names stay); a new or
 * renamed one is limited to 64, a second defence behind the table designer's own check.
 */
export function saveRequest(v: unknown): SaveTableRequest {
  if (!isObj(v) || !(v.originalName === null || typeof v.originalName === 'string') || typeof v.allowDataLoss !== 'boolean'
    || !(v.acceptExistingViolations === undefined || typeof v.acceptExistingViolations === 'boolean')) bad();
  if (v.originalName !== null) lookupName(v.originalName);
  const d = v.design;
  if (!isObj(d) || typeof d.name !== 'string' || !(d.description === undefined || typeof d.description === 'string')
    || !(d.extra === undefined || isObj(d.extra)) || !Array.isArray(d.fields) || d.fields.length > MAX_FIELDS
    || !Array.isArray(v.mapping) || v.mapping.length > MAX_FIELDS) bad();
  if (d.name === v.originalName) lookupName(d.name); else nameArg(d.name);
  ruleProps(d);
  const kept = new Set<string>();
  for (const m of Array.from(v.mapping)) {
    if (!isObj(m) || typeof m.name !== 'string' || !(m.sourceName === null || typeof m.sourceName === 'string')) bad();
    if (m.sourceName !== null) lookupName(m.sourceName);
    if (m.sourceName === m.name) kept.add(m.name);
  }
  for (const x of Array.from(d.fields)) {
    if (!isObj(x) || typeof x.name !== 'string' || !isObj(x.props)) bad();
    ruleProps(x.props);
    if (kept.has(x.name)) lookupName(x.name); else nameArg(x.name);
  }
  // Indexes: shape and caps only (Access's 32 indexes of 10 fields); the core validates the names and fields.
  if (d.indexes !== undefined && (!Array.isArray(d.indexes) || d.indexes.length > MAX_INDEXES)) bad();
  for (const ix of Array.from((d.indexes ?? []) as unknown[])) {
    if (!isObj(ix) || typeof ix.name !== 'string' || typeof ix.unique !== 'boolean' || !Array.isArray(ix.fields) || ix.fields.length > MAX_INDEX_FIELDS) bad();
    lookupName(ix.name);
    for (const x of Array.from(ix.fields as unknown[])) {
      if (!isObj(x) || typeof x.name !== 'string' || typeof x.desc !== 'boolean') bad();
      lookupName(x.name);
    }
  }
  return v as unknown as SaveTableRequest;
}

/** Sheet name of a workbook (Excel: 31 characters; a longer name is refused) or null. */
export function sheetOrNull(v: unknown): string | null {
  if (v === null) return null;
  if (typeof v !== 'string' || v === '' || [...v].length > 31) bad();
  return v;
}
export function boolOrNull(v: unknown): boolean | null {
  if (v !== null && typeof v !== 'boolean') bad();
  return v;
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
  const table = t.kind === 'new' ? nameArg(t.table) : lookupName(t.table);
  if (t.kind === 'new') {
    const pk = t.primaryKey;
    if (!isObj(pk)) bad();
    if (pk.kind === 'auto' || pk.kind === 'none') return { spec, target: { kind: 'new', table, primaryKey: { kind: pk.kind } } };
    if (pk.kind === 'field') return { spec, target: { kind: 'new', table, primaryKey: { kind: 'field', field: nameArg(pk.field) } } };
    bad();
  }
  if (t.kind !== 'append' || !Array.isArray(t.mapping) || t.mapping.length > 255) bad();
  const mapping = Array.from(t.mapping, (m) => (m === null ? m : lookupName(m)));
  return { spec, target: { kind: 'append', table, mapping } };
}

/** A report to print or export: html of at most 64 Mi characters, the report's name (1 to 1024 characters, C8 lookupName:
 *  a report an external tool named at length still prints; pdfFileName shortens the file proposed). */
export function printRequest(v: unknown): PrintRequest {
  if (!isObj(v) || typeof v.html !== 'string' || v.html.length > MAX_PRINT_HTML_CHARS || typeof v.landscape !== 'boolean' || v.name === '') bad();
  return { html: v.html, name: lookupName(v.name), landscape: v.landscape };
}

/** Opening/creating a base: BaseFileError → `bc:<code>`; anything else (ENOENT, EACCES…) is logged → `bc:cannotOpen`. */
export function bcError(e: unknown): Error {
  if (e instanceof BaseFileError) return new Error(`bc:${e.code}`);
  console.error(e);
  return new Error('bc:cannotOpen');
}

/** An export's source (A6): a source ref and the datasheet's parameters, sort and filter, checked as a page request is. */
export function exportSource(v: unknown): ExportSource {
  if (!isObj(v)) bad();
  const { sort, filter, params, where } = sourcePageRequest({ offset: 0, limit: 0, sort: v.sort, filter: v.filter, params: v.params, where: v.where });
  return { ref: sourceRef(v.ref), ...(params ? { params } : {}), ...(sort ? { sort } : {}), ...(filter ? { filter } : {}), ...(where !== undefined ? { where } : {}) };
}
export const exportSpec = (v: unknown): ExportTextSpec => validExportSpec(v) ?? bad();

/** A3 action queries: a query or SQL ref (never a table), at most MAX_PARAMS parameter values, the run's two options. */
export const queryRef = (v: unknown): QueryRef => { const r = sourceRef(v); return r.kind === 'table' ? bad() : r; };
/** B4 sources.save: a query or SQL ref (never a table), a key rowid (null: a new record), values as cells(). */
export function sourceSaveRequest(r: unknown, q: unknown): [QueryRef, SourceSaveRequest] {
  if (!isObj(q)) bad();
  return [queryRef(r), { rowid: q.rowid === null ? null : uint(q.rowid) /* as rows.update */, values: cells(q.values) }];
}
/** B4 sources.autoLookup: a query or SQL ref (never a table), the link values as cells(). */
export const autoLookupRequest = (r: unknown, v: unknown): [QueryRef, Record<string, CellInput>] => [queryRef(r), cells(v)];
export function queryParams(v: unknown): Record<string, CellInput> {
  if (!isObj(v) || Object.keys(v).length > MAX_PARAMS) bad();
  return cells(v);
}
export function runActionOptions(v: unknown): RunActionOptions {
  if (!isObj(v)) bad();
  return { skipFailures: bool(v.skipFailures), replaceTable: bool(v.replaceTable) };
}
