import type { DatabaseSync } from 'node:sqlite';
import type { LocaleInfo } from '../shared/locale-format';
import type { RelationResult } from '../shared/api';
import { defaultProps, type FieldDef, type FieldProps, type FieldType } from '../shared/field-types';
import { createTable, DanglingKeyError, DesignValidationError, isTableName, NameExistsError, usableProps } from '../main/db/schema';
import { saveRelation } from '../main/db/relations';
import { saveObject, setObjectDescription } from '../main/db/objects';
import { checkQueryDefinition } from '../main/query/source';
import { isActionDefinition } from '../shared/query/definition';
import { parseSql } from '../shared/query/sql-parser';
import { formCreate, reportCreate } from './ops-design';

export type OpOutcome = { ok: true } | { ok: false; message: string };
export type OpHandler = (db: DatabaseSync, args: Record<string, unknown>, info: LocaleInfo) => OpOutcome;

const FIELD_TYPE_SET: Record<FieldType, true> = { autoNumber: true, shortText: true, longText: true, number: true, currency: true, dateTime: true, yesNo: true, hyperlink: true }; // a new FieldType fails to compile here
const FIELD_TYPES: readonly string[] = Object.keys(FIELD_TYPE_SET);
const refuse = (message: string): OpOutcome => ({ ok: false, message });
const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

function tableCreate(db: DatabaseSync, args: Record<string, unknown>): OpOutcome {
  const { name, description, fields } = args;
  if (typeof name !== 'string') return refuse('"name" must be a string');
  if (description !== undefined && typeof description !== 'string') return refuse('"description" must be a string');
  if (!Array.isArray(fields)) return refuse('"fields" must be an array');
  const defs: FieldDef[] = [];
  for (const [i, f] of fields.entries()) {
    if (!isObject(f) || typeof f.name !== 'string') return refuse(`field #${i}: "name" must be a string`);
    const { name: fname, type, ...rest } = f;
    if (typeof type !== 'string' || !FIELD_TYPES.includes(type)) return refuse(`field "${fname}": unknown type: ${String(type)}`);
    defs.push({ name: fname, props: { ...defaultProps(type as FieldType), ...rest } as FieldProps });
  }
  const bad = defs.find((d) => !usableProps(d.props as unknown as Record<string, unknown>));
  if (bad) return refuse(`invalid field properties: ${bad.name}`);
  try {
    createTable(db, { name, ...(description === undefined ? {} : { description }), fields: defs });
    return { ok: true };
  } catch (e) {
    if (e instanceof DesignValidationError || e instanceof NameExistsError || e instanceof DanglingKeyError) return refuse(e.message);
    throw e;
  }
}

const strings = (v: unknown): v is string[] => Array.isArray(v) && v.every((x) => typeof x === 'string');
type RelationFailure = Extract<RelationResult, { ok: false }>;
const REASONS: Record<Exclude<RelationFailure['reason'], 'external' | 'duplicate' | 'violations'>, string> = { // a new reason fails to compile here
  fieldsMismatch: 'parent and child must list the same number of fields (1 to 10)',
  typesMismatch: 'parent and child fields have incompatible types',
  parentNotUnique: 'the parent fields are not a unique key',
  readOnly: 'the base is read-only',
  nameExists: 'a relation with this name already exists',
  nameInvalid: 'invalid relation name',
  sameTable: 'a table cannot be related to itself',
};

function relationCreate(db: DatabaseSync, args: Record<string, unknown>, info: LocaleInfo): OpOutcome {
  const { parentTable, parentFields, childTable, childFields, name = '', enforce = true, cascadeUpdate = false, cascadeDelete = false, joinType = 1 } = args;
  if (typeof parentTable !== 'string' || typeof childTable !== 'string') return refuse('"parentTable" and "childTable" must be strings');
  if (!strings(parentFields) || !strings(childFields)) return refuse('"parentFields" and "childFields" must be arrays of strings');
  if (typeof name !== 'string') return refuse('"name" must be a string');
  if (typeof enforce !== 'boolean' || typeof cascadeUpdate !== 'boolean' || typeof cascadeDelete !== 'boolean') return refuse('"enforce", "cascadeUpdate" and "cascadeDelete" must be booleans');
  if (joinType !== 1 && joinType !== 2 && joinType !== 3) return refuse('"joinType" must be 1, 2 or 3');
  for (const t of [parentTable, childTable]) if (!isTableName(db, t)) return refuse(`table not found: ${t}`);
  const r = saveRelation(db, { name, parentTable, parentFields, childTable, childFields, enforce, cascadeUpdate, cascadeDelete, joinType }, null, info);
  if (r.ok) return { ok: true };
  if (r.reason === 'external') return refuse(`table is external (linked): ${r.table}`);
  if (r.reason === 'duplicate') return refuse(`duplicate of existing relation: ${r.relation}`);
  if (r.reason === 'violations') return refuse(`${r.rows} existing row(s) violate the relation`);
  return refuse(REASONS[r.reason]);
}

/** The stored definition of a local SQL query. Only 1.x is built: a pass-through (2.x) needs a connector. */
export function buildQueryDefinition(sql: string, formatVersion = '1.0'): { formatVersion: '1.0'; sql: string } {
  if (formatVersion !== '1.0') throw new Error('pass-through queries are not supported by basecraft-cli yet');
  return { formatVersion: '1.0', sql };
}

const isCrosstab = (sql: string): boolean => { try { return parseSql(sql).body.k === 'crosstab'; } catch { return false; } };
/** Errors checkQueryDefinition throws by design: bc:invalidQuery (shape, syntax), bc:queryBind (binding, cycle), bc:notSelectQuery (an action query used as a source). */
const isQueryCheckError = (e: unknown): e is Error => e instanceof Error && /^bc:(invalidQuery|queryBind|notSelectQuery)(\||$)/.test(e.message);

function queryCreate(db: DatabaseSync, args: Record<string, unknown>): OpOutcome {
  const { name: rawName, sql, description } = args;
  if (typeof rawName !== 'string') return refuse('"name" must be a string');
  if (typeof sql !== 'string') return refuse('"sql" must be a string');
  if (description !== undefined && typeof description !== 'string') return refuse('"description" must be a string');
  const name = rawName.normalize('NFC');
  const def = buildQueryDefinition(sql);
  if (isCrosstab(sql) || isActionDefinition(def)) return refuse('action and crosstab queries are not supported by basecraft-cli yet');
  try {
    checkQueryDefinition(db, name, def);
  } catch (e) {
    if (isQueryCheckError(e)) return refuse(e.message.replace(/^bc:/, ''));
    throw e;
  }
  const r = saveObject(db, 'query', name, def, null);
  if (!r.ok) return refuse(r.reason === 'nameExists' ? `query name already used: ${name}` : r.reason === 'nameInvalid' ? `invalid query name: ${name}` : r.reason);
  if (description !== undefined) setObjectDescription(db, 'query', name, description);
  return { ok: true };
}

export const OP_HANDLERS: Record<string, OpHandler> = { 'table.create': tableCreate, 'relation.create': relationCreate, 'query.create': queryCreate, 'form.create': formCreate, 'report.create': reportCreate };
