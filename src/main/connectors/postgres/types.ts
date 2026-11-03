// PostgreSQL catalog rows → BaseCraft designs, and server values → stored values (C4 R6, R13). Pure: no import of `pg`.
import { roundDecimalString } from '../../../shared/locale-format';
import type { SqlValue } from '../../../shared/coerce';
import { validateDesign, type FieldDef, type FieldProps } from '../../../shared/field-types';
import type { RemoteTable } from '../connector';
import type { PgCast } from './sql-query';

/** A column as the catalog query reads it. `base`: the typname of its type, or of a domain's base type; 'enum' for an enum,
 *  'array' for an array, '' for a type outside pg_catalog (citext excepted). `typmod`: the base's (-1 = unconstrained). */
export interface PgColumn { name: string; type: string /* format_type */; base: string; typmod: number;
  notNull: boolean; hasDefault: boolean; identity: boolean /* identity or serial */; generated?: boolean /* GENERATED: never written */ }

const decimal = (precision: number, scale: number): Partial<FieldProps> => ({ type: 'number', numberSize: 'decimal', precision, scale });
const INTEGERS: Record<string, Partial<FieldProps>> = { int2: { type: 'number', numberSize: 'integer' }, int4: { type: 'number', numberSize: 'longInteger' }, int8: decimal(19, 0) };
const SIMPLE: Record<string, Partial<FieldProps> & { pgCast?: PgCast }> = {
  ...INTEGERS,
  float4: { type: 'number', numberSize: 'single' }, float8: { type: 'number', numberSize: 'double' }, bool: { type: 'yesNo' },
  text: { type: 'longText' }, citext: { type: 'longText' },
  enum: { type: 'longText', pgCast: 'text' }, json: { type: 'longText', pgCast: 'text' }, jsonb: { type: 'longText', pgCast: 'text' },
  uuid: { type: 'shortText', size: 36, pgCast: 'text' },
  timestamp: { type: 'dateTime' }, date: { type: 'dateTime', pgCast: 'timestamp' }, timestamptz: { type: 'dateTime', pgCast: 'timestamp' },
  time: { type: 'dateTime', pgCast: 'time' },
};

/** R13's field of a column; null = skipped (money, timetz, interval, bytea, arrays, geometry, ranges, xml, anything else: what
 *  PostgreSQL could not sort or compare stays out). `pgCast` tells the generator how to present the column (sql-query's PgCast). */
export function pgField(c: PgColumn): FieldDef | null {
  let p: Partial<FieldProps> | undefined;
  if (c.identity && c.base in INTEGERS) p = { type: 'autoNumber' };
  else if (c.base === 'numeric') {
    const t = c.typmod - 4;
    const precision = (t >> 16) & 0xffff;
    const scale = ((t & 0x7ff) ^ 0x400) - 0x400; // PostgreSQL 15: an 11-bit signed scale
    p = c.typmod >= 4 && precision <= 28 && scale >= 0 && scale <= precision ? decimal(precision, scale) : decimal(28, 6); // psqlODBC's default
  } else if (c.base === 'varchar' || c.base === 'bpchar') {
    const n = c.typmod - 4;
    p = c.typmod >= 5 && n <= 255 ? { type: 'shortText', size: n } : { type: 'longText' };
  } else p = SIMPLE[c.base];
  if (!p) return null;
  // The server fills defaults and identities: an absent field is not sent, so only a column it cannot fill is Required.
  // pgCast, pgGenerated: connector-specific props carried in the shared field props (bc_links.props). pgGenerated: a generated
  // column or a GENERATED ALWAYS identity, which the connector never writes (shown read-only: serverComputed).
  return { name: c.name, props: { required: c.notNull && !c.hasDefault && !c.identity && !c.generated, indexed: 'no', primaryKey: false, ...p,
    ...(c.generated && { pgGenerated: true }) } as FieldProps };
}

// ISO, YMD (set at connect); a timestamptz in the session's zone (the workstation's), its offset dropped. No ' BC', no 5-digit year.
const DATE = /^(\d{4})-(\d{2})-(\d{2})(?: (\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(?:[+-]\d{2}(?::\d{2}){0,2})?)?$/;
const TIME = /^([01]\d|2[0-3]):([0-5]\d):([0-5]\d)(?:\.\d+)?$/;
const DIGITS = /^-?\d+(?:\.\d+)?$/;

/** A value as BaseCraft stores it (R13): raw text from the server (type parsers return strings for every type but int2/int4/float/bool).
 *  Dates outside 0100-01-01 … 9999-12-31, infinities, BC: Null; fractional seconds dropped; decimals at their scale; Yes/No 1/0
 *  (the generator's -1 too). */
export function pgDecode(fd: FieldDef, raw: unknown): SqlValue {
  if (raw === null || raw === undefined) return null;
  const p = fd.props;
  switch (p.type) {
    case 'yesNo': {
      if (typeof raw === 'boolean') return raw ? 1 : 0;
      const t = String(raw).trim().toLowerCase(); // a boolean read as text: t / true / f / false
      return t === 't' || t === 'true' || (t !== '' && Number(t) !== 0 && !Number.isNaN(Number(t))) ? 1 : 0;
    }
    case 'dateTime': {
      const s = String(raw);
      const d = DATE.exec(s);
      if (d) return Number(d[1]) >= 100 ? `${d[1]}-${d[2]}-${d[3]} ${d[4] ?? '00'}:${d[5] ?? '00'}:${d[6] ?? '00'}` : null;
      const t = TIME.exec(s); // a time column read as stored (a key: never presented)
      return t ? `1899-12-30 ${t[1]}:${t[2]}:${t[3]}` : null;
    }
    case 'number': case 'currency': case 'autoNumber': {
      if (p.numberSize === 'decimal') return typeof raw === 'string' && DIGITS.test(raw) ? roundDecimalString(raw, p.scale ?? 0) : null;
      const n = Number(raw);
      if (!Number.isFinite(n)) return null;
      return p.numberSize === 'single' ? Number(n.toPrecision(7)) : n; // a float4 arrives widened to a double, as C2's Single
    }
    default: return String(raw);
  }
}

const OID_BASE: Record<number, string> = {
  16: 'bool', 20: 'int8', 21: 'int2', 23: 'int4', 25: 'text', 114: 'json', 700: 'float4', 701: 'float8', 1042: 'bpchar', 1043: 'varchar',
  1082: 'date', 1083: 'time', 1114: 'timestamp', 1184: 'timestamptz', 1700: 'numeric', 2950: 'uuid', 3802: 'jsonb',
};
/** C6 R6: a result column's props from its type OID and modifier: R13's mapping (pgField over the OID table), every other type
 *  Long Text; required false, indexed 'no', no pgCast / pgGenerated. */
export function ptProps(oid: number, typmod: number): FieldProps {
  const { pgCast: _cast, pgGenerated: _generated, ...props } = pgField({ name: 'c', type: '', base: OID_BASE[oid] ?? 'text', typmod, notNull: false, hasDefault: false, identity: false })!.props;
  return props;
}

/** R6: a table's link (name `<table>` in `public`, else `<schema>_<table>`) with its design; `pk`: its PRIMARY KEY columns.
 *  A key column marked, never cast (its value is the token's); an AutoNumber only as the sole key (BaseCraft's rule), else a
 *  Number; a key with a skipped column is none (read-only). `unsupported`: the first refusal of validateDesign. */
export function remoteTable(schema: string, table: string, cols: PgColumn[], pk: string[]): RemoteTable {
  const name = schema === 'public' ? table : `${schema}_${table}`;
  const fields: FieldDef[] = [];
  const skipped: string[] = [];
  for (const c of cols) {
    const fd = pgField(c);
    if (fd) fields.push(fd); else skipped.push(c.name);
  }
  const key = pk.every((k) => fields.some((f) => f.name === k)) ? pk : [];
  for (const fd of fields) {
    // A key the server fills (DEFAULT gen_random_uuid(), a sequence) may be left out: `external`, the write layer's mark of a
    // key it did not create, so only `required` (NOT NULL without a default) asks for a value (C5 Task 5, as SQL Server).
    if (key.includes(fd.name)) { fd.props = { ...fd.props, primaryKey: true, external: true }; delete fd.props.pgCast; }
    if (fd.props.type === 'autoNumber' && !(key.length === 1 && key[0] === fd.name)) {
      fd.props = { ...fd.props, ...INTEGERS[cols.find((c) => c.name === fd.name)!.base] };
    }
  }
  const design = { name, fields };
  const bad = validateDesign(design)[0];
  return { name, remote: table, schema, design, key, skipped, ...(bad ? { unsupported: bad.code } : {}) };
}
