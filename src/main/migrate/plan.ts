// Server migration (C7): the front-end's local tables read into engine-neutral plan entries (R2, R3, R5, R6, R7, R8). Reads only;
// each connector's ddl.ts writes its SQL from these entries.
import type { DatabaseSync } from 'node:sqlite';
import { CANON, coerce, toDecimal } from '../../shared/coerce';
import type { Expr } from '../../shared/expr/ast';
import { parseCanonical } from '../../shared/expr/parser';
import { foldName, sameName, validateDesign, type FieldDef, type FieldProps } from '../../shared/field-types';
import type { FrontEndRule } from '../../shared/migrate';
import { listRelations, listTables, pickName, quoteIdent, tableDesign } from '../db/schema';
import { nextAutoNumber } from '../db/write-layer';

export type Literal = { k: 'num'; v: string } | { k: 'str'; v: string } | { k: 'date'; v: string /* YYYY-MM-DD HH:MM:SS */ } | { k: 'bool'; v: boolean };
export interface ServerField { name: string; props: FieldProps /* the local field's */; default?: Literal }
export interface ServerIndex { name: string; fields: { name: string; desc: boolean }[]; unique: boolean }
export interface ServerTable { name: string; schema: string; fields: ServerField[]; key: string[]; indexes: ServerIndex[]; nextId?: number; rows: number }
export interface ServerForeignKey { name: string; relation: string; schema: string; child: string; childFields: string[]; parent: string; parentFields: string[];
  onDelete: 'cascade' | 'noAction'; onUpdate: 'cascade' | 'noAction' }
export interface MigrationPlan { tables: ServerTable[]; foreignKeys: ServerForeignKey[]; notEnforced: string[]; frontEndOnly: FrontEndRule[] }
/** PostgreSQL { nameMax: 63, unit: 'utf8' }; SQL Server { nameMax: 128, unit: 'utf16' }. */
export interface NameLimits { nameMax: number; unit: 'utf8' | 'utf16' }

export class MigrateRefusal extends Error {
  constructor(readonly reason: 'noTables' | 'invalidDesign' | 'nameTooLong' | 'nameTaken', readonly names: string[]) {
    super(`bc:migrate|${reason}`);
    this.name = 'MigrateRefusal';
  }
}

const nameLength = (s: string, limits: NameLimits): number => (limits.unit === 'utf8' ? Buffer.byteLength(s) : s.length);

/** `taken`: the schema's object names (SchemaWriter.names). Throws MigrateRefusal; reads only. */
export function migrationPlan(db: DatabaseSync, schema: string, limits: NameLimits, taken: readonly string[]): MigrationPlan {
  const designs = listTables(db).map((x) => tableDesign(db, x.name));
  if (designs.length === 0) throw new MigrateRefusal('noTables', []);
  // A file is not trusted: size, precision and scale reach the DDL text, so a design the editor would refuse is refused here.
  const invalid = designs.flatMap((d) => validateDesign(d).map((e) => ('field' in e && e.field ? `${d.name}.${e.field}` : d.name)));
  if (invalid.length) throw new MigrateRefusal('invalidDesign', [...new Set(invalid)]);
  const over = (n: string) => nameLength(n, limits) > limits.nameMax;
  const tooLong = designs.flatMap((d) => [...(over(d.name) ? [d.name] : []), ...d.fields.filter((x) => over(x.name)).map((x) => `${d.name}.${x.name}`)]);
  if (tooLong.length) throw new MigrateRefusal('nameTooLong', tooLong);
  const sameAsServer = designs.map((d) => d.name).filter((n) => taken.some((x) => sameName(x, n)));
  if (sameAsServer.length) throw new MigrateRefusal('nameTaken', sameAsServer);

  const used = new Set([...taken, ...designs.map((d) => d.name)].map(foldName));
  // PostgreSQL's automatic names (primary key index, identity sequence): reserved so a chosen index name never meets them (42P07).
  for (const d of designs) {
    if (d.fields.some((x) => x.props.primaryKey)) used.add(foldName(`${d.name}_pkey`));
    for (const x of d.fields) if (x.props.type === 'autoNumber') used.add(foldName(`${d.name}_${x.name}_seq`));
  }
  const frontEndOnly: FrontEndRule[] = [];
  const tables = designs.map((d): ServerTable => {
    const key = d.fields.filter((x) => x.props.primaryKey).map((x) => x.name);
    const fields = d.fields.map((fd): ServerField => {
      const lit = literalDefault(fd);
      if (fd.props.defaultValue && !lit && fd.props.type !== 'autoNumber') frontEndOnly.push({ table: d.name, field: fd.name, what: 'defaultValue' });
      if (fd.props.validationRule) frontEndOnly.push({ table: d.name, field: fd.name, what: 'validationRule' });
      if (fd.props.allowZeroLength === false) frontEndOnly.push({ table: d.name, field: fd.name, what: 'allowZeroLength' });
      return lit ? { name: fd.name, props: fd.props, default: lit } : { name: fd.name, props: fd.props };
    });
    if (d.validationRule) frontEndOnly.push({ table: d.name, what: 'tableRule' });
    const soleKey = key.length === 1 ? key[0] : undefined;
    const indexes: ServerIndex[] = [
      ...d.fields.filter((x) => x.props.indexed !== 'no' && x.name !== soleKey).map((x) => ({
        name: objectName(`${d.name}_${x.name}`, used, limits), fields: [{ name: x.name, desc: false }], unique: x.props.indexed === 'yesNoDuplicates' })),
      ...(d.indexes ?? []).map((ix) => ({
        name: objectName(`${d.name}_${ix.name}`, used, limits), fields: ix.fields.map((x) => ({ name: x.name, desc: x.desc })), unique: ix.unique })),
    ];
    const rows = Number((db.prepare(`SELECT count(*) AS n FROM ${quoteIdent(d.name)}`).get() as { n: number }).n);
    const auto = d.fields.some((x) => x.props.type === 'autoNumber');
    return { name: d.name, schema, fields, key, indexes, ...(auto && { nextId: nextAutoNumber(db, d.name) }), rows };
  });

  const names = designs.map((d) => d.name);
  const fieldsOf = (table: string, list: string[]) => {
    const own = designs.find((d) => d.name === table)!.fields.map((x) => x.name);
    return list.map((n) => pickName(own, n) ?? n);
  };
  const foreignKeys: ServerForeignKey[] = [];
  const notEnforced: string[] = [];
  for (const r of listRelations(db)) {
    const parent = pickName(names, r.parentTable), child = pickName(names, r.childTable);
    if (!parent || !child) continue; // not between two local tables: nothing a server could hold
    if (!r.enforce) { notEnforced.push(r.name); continue; }
    foreignKeys.push({ name: objectName(r.name, used, limits), relation: r.name, schema, child, childFields: fieldsOf(child, r.childFields),
      parent, parentFields: fieldsOf(parent, r.parentFields), onDelete: r.cascadeDelete ? 'cascade' : 'noAction', onUpdate: r.cascadeUpdate ? 'cascade' : 'noAction' });
  }
  return { tables, foreignKeys, notEnforced, frontEndOnly };
}

/** A literal's text as `coerce` reads it (canonical, region-free); undefined for anything else. */
function literalInput(e: Expr): { k: 'num' | 'str' | 'date' | 'bool'; v: string | boolean } | undefined {
  if (e.k === 'un' && e.op === '-' && e.e.k === 'num') return { k: 'num', v: `-${e.e.v}` };
  return e.k === 'num' || e.k === 'str' || e.k === 'date' || e.k === 'bool' ? e : undefined;
}

/** R5: the field's Default Value when it is a literal the field stores (converted as stored: a number field's "5" → num "5"). */
export function literalDefault(fd: FieldDef): Literal | undefined {
  if (!fd.props.defaultValue) return undefined;
  let e: ReturnType<typeof literalInput>;
  try { e = literalInput(parseCanonical(fd.props.defaultValue)); } catch { return undefined; }
  if (!e) return undefined;
  switch (fd.props.type) {
    case 'yesNo':
      return e.k === 'bool' ? { k: 'bool', v: e.v as boolean } : e.k === 'num' ? { k: 'bool', v: Number(e.v) !== 0 } : undefined;
    case 'dateTime':
      return e.k === 'date' ? { k: 'date', v: e.v as string } : undefined;
    case 'shortText': case 'longText': case 'hyperlink': {
      if (e.k !== 'str') return undefined; // a number, date or Yes/No shown as text depends on the region
      const c = coerce(fd, e.v as string, CANON); // trimmed as stored; longer than the size: refused
      return c.ok && typeof c.value === 'string' ? { k: 'str', v: c.value } : undefined;
    }
    case 'number': case 'currency': {
      // ponytail: a text default only when it is digits (the same in every region); "1,5" vs "1.5" stays in the front-end
      if (e.k !== 'num' && !(e.k === 'str' && /^-?\d+$/.test(e.v as string))) return undefined;
      const c = coerce(fd, e.v as string, CANON); // rounded to the size and scale; out of range: refused
      const v = c.ok && c.value !== null ? toDecimal(c.value, CANON) : null;
      return v === null ? undefined : { k: 'num', v };
    }
    default: return undefined; // AutoNumber
  }
}

/** R6: `base` cut to the limit on a character boundary, then `_2`, `_3`… until free in `taken` (compared without case); added to it.
 *  `taken` holds folded names (foldName). */
export function objectName(base: string, taken: Set<string>, limits: NameLimits): string {
  const cut = (s: string, max: number) => {
    let out = '';
    for (const ch of s) { if (nameLength(out + ch, limits) > max) break; out += ch; } // code points: never half a surrogate pair
    return out;
  };
  let name = cut(base, limits.nameMax);
  for (let i = 2; taken.has(foldName(name)); i++) name = cut(base, limits.nameMax - nameLength(`_${i}`, limits)) + `_${i}`;
  taken.add(foldName(name));
  return name;
}
