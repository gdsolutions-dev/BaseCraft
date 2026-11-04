import type { DatabaseSync } from 'node:sqlite';
import type { LocaleInfo } from '../shared/locale-format';
import { defaultProps, type FieldDef, type FieldProps, type FieldType } from '../shared/field-types';
import { createTable, DanglingKeyError, DesignValidationError, isTableName, NameExistsError, usableProps } from '../main/db/schema';
import { saveRelation } from '../main/db/relations';

export type OpOutcome = { ok: true } | { ok: false; message: string };
export type OpHandler = (db: DatabaseSync, args: Record<string, unknown>, info: LocaleInfo) => OpOutcome;

const FIELD_TYPES: readonly string[] = ['autoNumber', 'shortText', 'longText', 'number', 'currency', 'dateTime', 'yesNo', 'hyperlink'] satisfies FieldType[];
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
const REASONS: Record<string, string> = {
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
  return refuse(REASONS[r.reason] ?? r.reason);
}

export const OP_HANDLERS: Record<string, OpHandler> = { 'table.create': tableCreate, 'relation.create': relationCreate };
