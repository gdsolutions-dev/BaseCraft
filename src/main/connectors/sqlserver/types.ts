// SQL Server catalog rows → BaseCraft designs, and server values → stored values (C5 R5, R6, R14). Pure: no import of `tedious`.
import { roundDecimalString } from '../../../shared/locale-format';
import type { SqlValue } from '../../../shared/coerce';
import { validateDesign, type FieldDef, type FieldProps } from '../../../shared/field-types';
import type { RemoteTable } from '../connector';

/** A column as the catalog reads it (sys.columns): `type` the system type name (an alias type's base), `maxLength` in bytes
 *  (-1 max), `collation` null for non-text. */
export interface MsColumn { name: string; type: string; maxLength: number; precision: number; scale: number; nullable: boolean;
  hasDefault: boolean; identity: boolean; computed: boolean; collation: string | null }

/** R8: a collation that compares without case and with accents, as Access (French_CI_AS, SQL_Latin1_General_CP1_CI_AS,
 *  Latin1_General_100_CI_AS_SC_UTF8…). */
export const msCi = (collation: string | null): boolean => collation !== null && /_CI_AS(?:_|$)/i.test(collation);

const decimal = (precision: number, scale: number): Partial<FieldProps> => ({ type: 'number', numberSize: 'decimal', precision, scale });
const INTEGERS: Record<string, Partial<FieldProps>> = {
  tinyint: { type: 'number', numberSize: 'byte' }, smallint: { type: 'number', numberSize: 'integer' }, int: { type: 'number', numberSize: 'longInteger' },
  bigint: decimal(19, 0),
};
const SIMPLE: Record<string, Partial<FieldProps>> = {
  ...INTEGERS,
  real: { type: 'number', numberSize: 'single' }, float: { type: 'number', numberSize: 'double' }, bit: { type: 'yesNo' },
  money: { type: 'currency' }, smallmoney: { type: 'currency' }, text: { type: 'longText' }, ntext: { type: 'longText' },
  uniqueidentifier: { type: 'shortText', size: 36 }, datetimeoffset: { type: 'shortText', size: 34 },
  date: { type: 'dateTime' }, smalldatetime: { type: 'dateTime' }, datetime: { type: 'dateTime' }, datetime2: { type: 'dateTime' }, time: { type: 'dateTime' },
};
const TEXT = new Set(['char', 'varchar', 'nchar', 'nvarchar']);
/** A text column's length in characters (nchar and nvarchar: two bytes each); -1 = max. */
const chars = (c: MsColumn) => (c.maxLength < 0 ? -1 : c.type.startsWith('n') ? c.maxLength / 2 : c.maxLength);

/** R5's `msType`: the declared type as T-SQL writes it (`nvarchar(80)`, `decimal(10,2)`, `datetime2(7)`). */
function declared(c: MsColumn): string {
  if (TEXT.has(c.type)) return `${c.type}(${c.maxLength < 0 ? 'max' : chars(c)})`;
  if (c.type === 'decimal' || c.type === 'numeric') return `${c.type}(${c.precision},${c.scale})`;
  return c.type === 'datetime2' || c.type === 'time' || c.type === 'datetimeoffset' ? `${c.type}(${c.scale})` : c.type;
}

/** R5's field of a column; null = skipped (xml, binary, varbinary, image, sql_variant, CLR types, rowversion: msRemoteTable
 *  makes it the table's version). Props: `msType` (declared()), text `msCi` and `msCollation` (R8), `msComputed` for an
 *  identity or computed column, never written (serverComputed). An identity integer is AutoNumber here; msRemoteTable keeps it
 *  only as the sole key. */
export function msField(c: MsColumn): FieldDef | null {
  let p: Partial<FieldProps> | undefined;
  if (c.identity && (c.type === 'smallint' || c.type === 'int' || c.type === 'bigint')) p = { type: 'autoNumber' };
  else if (c.type === 'decimal' || c.type === 'numeric') p = c.precision <= 28 ? decimal(c.precision, c.scale) : decimal(28, Math.min(c.scale, 6)); // C4's rule
  else if (TEXT.has(c.type)) p = chars(c) >= 1 && chars(c) <= 255 ? { type: 'shortText', size: chars(c) } : { type: 'longText' };
  else p = SIMPLE[c.type];
  if (!p) return null;
  return { name: c.name, props: { required: !c.nullable && !c.hasDefault && !c.identity && !c.computed, indexed: 'no', primaryKey: false, ...p,
    msType: declared(c), ...(c.collation !== null && { msCi: msCi(c.collation), msCollation: c.collation }),
    ...((c.identity || c.computed) && { msComputed: true }) } as FieldProps };
}

// CONVERT(…, 121) of a datetime2(7) (R6): the generator presents every date (and a time, on 1899-12-30) so.
const DATE = /^(\d{4})-(\d{2})-(\d{2})(?: (\d{2}):(\d{2}):(\d{2})(?:\.\d+)?)?$/;
const DIGITS = /^-?\d+(?:\.\d+)?$/;

/** A value as BaseCraft stores it: text from R6's conversions, numbers and booleans as tedious gives them; dates before 0100
 *  Null, fractional seconds dropped; decimals at their scale, Currency to 4 places; Yes/No 1/0 (the generator's -1 too). */
export function msDecode(fd: FieldDef, raw: unknown): SqlValue {
  if (raw === null || raw === undefined) return null;
  const p = fd.props;
  switch (p.type) {
    case 'yesNo': return raw === true || (typeof raw !== 'boolean' && Number(raw) !== 0 && !Number.isNaN(Number(raw))) ? 1 : 0;
    case 'dateTime': {
      const d = DATE.exec(String(raw));
      return d && Number(d[1]) >= 100 ? `${d[1]}-${d[2]}-${d[3]} ${d[4] ?? '00'}:${d[5] ?? '00'}:${d[6] ?? '00'}` : null;
    }
    // ponytail: Currency is stored as a JS number (coerce's form): a money above about 9e11 loses its last decimal (Task 10 doc).
    case 'currency': return typeof raw === 'string' && DIGITS.test(raw) ? Number(roundDecimalString(raw, 4)) : Number.isFinite(raw) ? (raw as number) : null;
    case 'number': case 'autoNumber': {
      if (p.numberSize === 'decimal') return typeof raw === 'string' && DIGITS.test(raw) ? roundDecimalString(raw, p.scale ?? 0) : null;
      // ponytail: a bigint IDENTITY sole key is AutoNumber, shown as a double: above 2^53 rounded (its token stays exact, Task 10 doc).
      const n = Number(raw);
      if (!Number.isFinite(n)) return null;
      return p.numberSize === 'single' ? Number(n.toPrecision(7)) : n; // a real arrives widened to a double, as C2's Single
    }
    default: return String(raw);
  }
}

/** tedious's type names (columnMetadata) as the system types msField maps; an N type by its length. */
const PT_TYPES: Record<string, string | Record<number, string>> = {
  TinyInt: 'tinyint', SmallInt: 'smallint', Int: 'int', BigInt: 'bigint', IntN: { 1: 'tinyint', 2: 'smallint', 4: 'int', 8: 'bigint' },
  Real: 'real', Float: 'float', FloatN: { 4: 'real', 8: 'float' }, Money: 'money', SmallMoney: 'smallmoney', MoneyN: { 4: 'smallmoney', 8: 'money' },
  Bit: 'bit', BitN: 'bit', Decimal: 'decimal', DecimalN: 'decimal', Numeric: 'decimal', NumericN: 'decimal',
  Char: 'char', VarChar: 'varchar', NChar: 'nchar', NVarChar: 'nvarchar', Text: 'text', NText: 'ntext', UniqueIdentifier: 'uniqueidentifier',
  Date: 'date', SmallDateTime: 'smalldatetime', DateTime: 'datetime', DateTimeN: 'datetime', DateTime2: 'datetime2', Time: 'time', DateTimeOffset: 'datetimeoffset',
};
/** R13: a result column's props from tedious's columnMetadata (type name, precision, scale, dataLength): R5's mapping, every
 *  other type Long Text; required false, indexed 'no', no msType / msCi / msComputed. */
export function msPtProps(type: string, precision: number, scale: number, dataLength: number): FieldProps {
  const t = PT_TYPES[type];
  const col = (sys: string): MsColumn => ({ name: 'c', type: sys, maxLength: dataLength === 0xffff ? -1 : dataLength, precision, scale, nullable: true,
    hasDefault: false, identity: false, computed: false, collation: null }); // 0xFFFF: a max type
  const { msType: _type, ...props } = msField(col((typeof t === 'object' ? t[dataLength] : t) ?? 'ntext'))!.props; // every PT_TYPES entry maps
  return props;
}

/** R13: a value as tedious parses it (the text is not rewritten: R6 cannot apply), as msDecode reads R6's text: a Date by
 *  its UTC parts (useUTC: the server's wall clock; a time on 1899-12-30, a datetimeoffset at +00:00 to the millisecond), a
 *  decimal's number as its digits (beyond a double's 15 significant digits rounded, documented), a binary as `0x…`; anything
 *  else (bigint's digits, money, text) as given. */
export function msPtValue(raw: unknown, type: string, scale: number): unknown {
  if (raw instanceof Date) {
    const s = raw.toISOString(); // YYYY-MM-DDTHH:MM:SS.mmmZ for SQL Server's years 1..9999
    if (type === 'Time') return `1899-12-30 ${s.slice(11, 19)}`;
    return type === 'DateTimeOffset' ? `${s.slice(0, 10)} ${s.slice(11, 23)} +00:00` : `${s.slice(0, 10)} ${s.slice(11, 19)}`;
  }
  if (typeof raw === 'number' && /^(?:Decimal|Numeric)N?$/.test(type)) return Math.abs(raw) < 1e21 ? raw.toFixed(scale) : BigInt(raw).toString();
  return Buffer.isBuffer(raw) ? `0x${raw.toString('hex').toUpperCase()}` : raw;
}

/** R14: a table's link (name `<table>` in `dbo`, else `<schema>_<table>`) with its design; `pk`: its PRIMARY KEY columns.
 *  The rowversion column is `version` (R11), neither a field nor skipped. An AutoNumber only as the sole key (BaseCraft's
 *  rule), else its integer type, still never written; a key with a skipped column is none (read-only). `unsupported`: the
 *  first refusal of validateDesign. */
export function msRemoteTable(schema: string, table: string, cols: MsColumn[], pk: string[]): RemoteTable {
  const name = schema === 'dbo' ? table : `${schema}_${table}`;
  const fields: FieldDef[] = [];
  const skipped: string[] = [];
  let version: string | undefined;
  for (const c of cols) {
    if (c.type === 'timestamp') { version = c.name; continue; }
    const fd = msField(c);
    if (fd) fields.push(fd); else skipped.push(c.name);
  }
  const key = pk.every((k) => fields.some((f) => f.name === k)) ? pk : [];
  for (const fd of fields) {
    // A key the server fills (DEFAULT NEWID(), a sequence) may be left out: `external`, the write layer's mark of a key it did
    // not create, so only `required` (NOT NULL without a default) asks for a value.
    if (key.includes(fd.name)) fd.props = { ...fd.props, primaryKey: true, external: true };
    if (fd.props.type === 'autoNumber' && !(key.length === 1 && key[0] === fd.name)) {
      fd.props = { ...fd.props, ...INTEGERS[cols.find((c) => c.name === fd.name)!.type] };
    }
  }
  const design = { name, fields };
  const bad = validateDesign(design)[0];
  return { name, remote: table, schema, design, key, skipped, ...(version !== undefined && { version }), ...(bad ? { unsupported: bad.code } : {}) };
}
