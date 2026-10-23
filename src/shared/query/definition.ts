// Stored definition of a query (`bc_objects`, kind 'query'): checked when received over IPC and when read back. Pure module.
import type { ObjectKind } from '../api';
import { ExprSyntaxError } from '../expr/ast';
import { lookupOf, sameName, type TableDesign } from '../field-types';
import type { QueryDefinition } from './ast';
import { parseSql } from './sql-parser';

/** Longest SQL text of a definition (UTF-16 units). ponytail: counted in characters, not UTF-8 bytes. */
const MAX_SQL = 1_048_576;

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isCoord = (v: unknown): boolean => typeof v === 'number' && Number.isFinite(v);

/** `{ tables: { alias: { x, y } }, widths?: number[] }`; unknown keys are kept. */
function validLayout(v: unknown): boolean {
  if (!isObject(v) || !isObject(v.tables)) return false;
  if (!Object.values(v.tables).every((p) => isObject(p) && isCoord(p.x) && isCoord(p.y))) return false;
  return v.widths === undefined || (Array.isArray(v.widths) && v.widths.every((w) => isCoord(w) && (w as number) >= 0));
}

/** A parse or compile error (ExprSyntaxError) as `bc:invalidQuery|<code>|<position>` (no position: `withPosition` false,
 *  a compile limit such as tooComplex); null for any other error. */
export function invalidQueryError(e: unknown, withPosition = true): Error | null {
  return e instanceof ExprSyntaxError ? new Error(`bc:invalidQuery|${e.code}|${withPosition ? e.span.start : ''}`, { cause: e }) : null;
}

/**
 * The definition as stored, after checking it: an object, `formatVersion` '1.0' (or a newer minor '1.x'), `sql` a text of
 * at most 1 MB that parseSql accepts, an optional `layout` of valid shape. Unknown keys are kept (the object itself is
 * returned). Throws TypeError('bc:invalidQuery'), or `bc:invalidQuery|<code>|<position>` when the SQL does not parse.
 */
export function parseQueryDefinition(def: unknown): QueryDefinition {
  const invalid = (): never => { throw new TypeError('bc:invalidQuery'); };
  if (!isObject(def) || typeof def.formatVersion !== 'string' || !/^1\.\d+$/.test(def.formatVersion)) return invalid();
  if (typeof def.sql !== 'string' || def.sql.length > MAX_SQL) return invalid();
  try { parseSql(def.sql); } catch (e) {
    throw invalidQueryError(e) ?? new TypeError('bc:invalidQuery');
  }
  if (def.layout !== undefined && !validLayout(def.layout)) return invalid();
  return def as QueryDefinition;
}

/** Names used as sources (FROM, joins, derived tables, subqueries, at any depth) in a parsed query. */
function sourceNames(node: unknown, out: string[] = []): string[] {
  if (Array.isArray(node)) node.forEach((x) => sourceNames(x, out));
  else if (isObject(node)) {
    if (node.k === 'source' && typeof node.name === 'string') out.push(node.name);
    Object.values(node).forEach((x) => sourceNames(x, out));
  }
  return out;
}
const sqlUses = (sql: string, name: string): boolean => sourceNames(parseSql(sql)).some((n) => sameName(n, name));
/** A lookup's Row Source or a Record Source text that is SQL (else the name of a table or a saved query). */
export const isSqlSource = (text: string): boolean => /^\s*(SELECT|TRANSFORM|PARAMETERS)\b/i.test(text);

/**
 * The objects that use the query `name` (delete warning), best effort: queries whose SQL names it as a source, forms and
 * reports whose recordSource is `{ kind: 'query', name }` or a sql text naming it, tables whose lookup Row Source names it
 * (A2-R18: by name, or in its SQL). Unreadable definitions are skipped.
 */
export function queryDependents(name: string, objects: { kind: ObjectKind; name: string; definition: unknown }[], tables: TableDesign[] = []): { kind: ObjectKind | 'table'; name: string }[] {
  const lookupUses = (text: string): boolean => {
    try {
      return isSqlSource(text) ? sqlUses(text, name) : sameName(text.trim(), name);
    } catch {
      return false;
    }
  };
  const used = tables.filter((d) => d.fields.some((fd) => { const l = lookupOf(fd); return l !== undefined && 'table' in l && lookupUses(l.table); }))
    .map((d) => ({ kind: 'table' as const, name: d.name }));
  const uses = (o: { kind: ObjectKind; name: string; definition: unknown }): boolean => {
    try {
      if (o.kind === 'query') return !sameName(o.name, name) && sqlUses(parseQueryDefinition(o.definition).sql, name);
      const rs = isObject(o.definition) ? o.definition.recordSource : undefined;
      if (!isObject(rs)) return false;
      return rs.kind === 'query' ? typeof rs.name === 'string' && sameName(rs.name, name) : rs.kind === 'sql' && typeof rs.sql === 'string' && sqlUses(rs.sql, name);
    } catch {
      return false;
    }
  };
  return [...objects.filter(uses).map(({ kind, name: n }) => ({ kind, name: n })), ...used];
}
