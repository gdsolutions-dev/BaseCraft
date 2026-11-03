// The only importer of `tedious` (C5 R1): index.ts's open() imports it on first use, a separate chunk of the db-host bundle.
// Connection, encryption and session settings (R3, R4), the catalog (R5, R14), reads, writes checked on rowversion or original
// values (R7, R11), errors, cancel (R12).
import tls from 'node:tls';
import { Connection as Tds, Request, TYPES, type ConnectionConfiguration } from 'tedious';
import type { DeleteResult } from '../../../shared/api';
import type { SqlValue } from '../../../shared/coerce';
import type { FieldDef } from '../../../shared/field-types';
import type { BoundColumn } from '../../../shared/query/bind';
import { CERTIFICATE_ERRORS, equalities, fitsBigint, linkedAs, neverUnsent, type Connection, type Credentials, type FieldError, type NativeResult, type ReadPlan, type RemoteConflict, type RemoteTable, type RemoteWrite, type SchemaWriter } from '../connector';
import type { ServerIndex, ServerTable } from '../../migrate/plan';
import { msCascadeDowngrades, msColumnType, msCreateIndex, msCreateTable, msFinishTable, msForeignKey, msInsertRows, msUnfiltered, msVersionColumn } from './ddl';
import { parseRowToken, rowToken } from '../token';
import { msKey, msLabel, type MsParams } from './params';
import { msCondition, msIdent, msNumber, type MsExprCtx, type MsParam } from './sql-expr';
import { colInfo, exact, keyText, msPlan, paramOf, present, type MsPlan } from './sql-query';
import { msCi, msDecode, msPtProps, msPtValue, msRemoteTable, type MsColumn } from './types';

/** R3, R4: SQL authentication; verify-full checks the certificate against Node's CAs and the workstation's store (a `ca` list
 *  replaces the defaults) and the host name (tedious, never for an IP: RFC 6066), require encrypts trusting the server's
 *  certificate, disable is plain. A named instance has no port (tedious asks SQL Server Browser, R2). */
export function msConfig(p: MsParams, c: Credentials): ConnectionConfiguration {
  return {
    server: p.host,
    authentication: { type: 'default', options: { userName: c.user, password: c.password } },
    options: {
      ...(p.instance !== undefined ? { instanceName: p.instance } : { port: p.port }),
      database: p.database, appName: 'BaseCraft',
      encrypt: p.tls !== 'disable', trustServerCertificate: p.tls === 'require',
      ...(p.tls === 'verify-full' && { cryptoCredentialsDetails: { ca: [...tls.getCACertificates('default'), ...tls.getCACertificates('system')] } }),
      // The connect timeout stays bounded with `timeout` 0 (an unreachable host would wait on the OS); 0 = no request timeout.
      // useUTC: a Date read by a pass-through is decoded by its UTC parts = the server's wall clock (R13).
      connectTimeout: Math.min(p.timeout || 15, 15) * 1000, requestTimeout: p.timeout * 1000, useUTC: true,
    },
  };
}

/** A connected tedious connection; a refused connect rejects with tedious's error, `numbers` the server's login error numbers
 *  (18456 login failed, 4060 unknown database…: tedious keeps only the last message). */
export function connectMs(config: ConnectionConfiguration): Promise<Tds> {
  return new Promise((resolve, reject) => {
    const tds = new Tds(config);
    const numbers: number[] = [];
    const heard = (m: { number: number }) => numbers.push(m.number);
    tds.on('errorMessage', heard);
    // A connection lost while idle emits 'error': the next request fails and RemoteSources reconnects. Unheard, it ends db-host.
    tds.on('error', () => {});
    tds.connect((e) => {
      tds.removeListener('errorMessage', heard); // the login's only
      if (e) reject(Object.assign(e, { numbers })); else resolve(tds);
    });
  });
}

/** R7: a parameter's text, bound nvarchar; `{ varchar }` is bound VarChar (a key compared with a varchar or char column: an
 *  nvarchar parameter would convert the column, a scan instead of a seek). */
export type MsBind = string | null | { varchar: string };
/** `sql` on `tds`, the rows of its last result as arrays (a write's own final SELECT, never the results a trigger returns
 *  before it): one batch without `params` (its SET statements and transactions last for the session), else through
 *  sp_executesql with @p0… (R7). Rejects with tedious's error. */
export function msQuery(tds: Tds, sql: string, params?: MsBind[]): Promise<unknown[][]> {
  return new Promise((resolve, reject) => {
    let rows: unknown[][] = [];
    const req = new Request(sql, (e) => (e ? reject(e) : resolve(rows)));
    req.on('columnMetadata', () => { rows = []; }); // a new result begins
    req.on('row', (cols: { value: unknown }[]) => rows.push(cols.map((c) => c.value)));
    if (!params) return tds.execSqlBatch(req);
    params.forEach((v, i) => (v !== null && typeof v === 'object' ? req.addParameter(`p${i}`, TYPES.VarChar, v.varchar) : req.addParameter(`p${i}`, TYPES.NVarChar, v)));
    tds.execSql(req);
  });
}

type TdsError = Error & { code?: string; number?: number; class?: number; numbers?: number[] };
/** tedious's error, or the first of several the server sent for one request (an AggregateError). */
const first = (e: unknown): TdsError => ((e instanceof AggregateError ? e.errors[0] : e) ?? {}) as TdsError;
/** A connect failure as R3/R12 report it: a password expired or to be changed (18487, 18488: the login prompt cannot change
 *  it) passwordExpired|<label>, a refused login (18456, not after 4060 unknown database) needsLogin|<key>, an untrusted certificate (tedious's ESOCKET caused by the TLS error) certificate|<label>, anything else (ESOCKET, ETIMEOUT,
 *  EINSTLOOKUP, an unknown database…) cannotConnect|<label>. */
export function connectError(e: unknown, p: MsParams): Error {
  const x = (e ?? {}) as TdsError;
  if (x.numbers?.some((n) => n === 18487 || n === 18488)) return new Error(`bc:linkUnavailable|passwordExpired|${msLabel(p)}`, { cause: e });
  if (x.numbers?.includes(18456) && !x.numbers.includes(4060)) return new Error(`bc:linkUnavailable|needsLogin|${msKey(p)}`, { cause: e });
  const tlsCode = ((x.cause ?? {}) as TdsError).code;
  return new Error(`bc:linkUnavailable|${CERTIFICATE_ERRORS.has(tlsCode ?? '') ? 'certificate' : 'cannotConnect'}|${msLabel(p)}`, { cause: e });
}

/** A failed request as the shared layer reads it (R12): lost (`lost: true`, RemoteSources retries a read once; `unsent: true`
 *  for EINVALIDSTATE, never sent; a server error of class 20 or more ends the connection: a KILL's 596), ECANCEL bc:cancelled
 *  (only our cancel sends one: tedious cancels its request object, never the next one), ETIMEOUT bc:timeout|<s>, anything else
 *  bc:serverError|<number>|<message> of the first error. tedious's error stays as `cause`. `write`: ETIMEOUT is lost too —
 *  tedious's timeout is the client's, a write or COMMIT the server completed just before it would be saved again (final
 *  review 1): its outcome unknown, never sent again. */
export function serverError(e: unknown, timeout: number, write = false): Error {
  const x = first(e);
  if (x.code === 'EINVALIDSTATE') return Object.assign(new Error(x.message, { cause: e }), { lost: true, unsent: true });
  // a socket's own error, unwrapped (ECONNRESET, EPIPE, « socket hang up »: a KILL's reset mid-request) too, as PostgreSQL's
  if (['ESOCKET', 'ECLOSE', 'ECONNRESET', 'EPIPE'].includes(x.code ?? '') || /Connection lost|socket hang up/.test(x.message) || (x.class ?? 0) >= 20) {
    return Object.assign(new Error(x.message, { cause: e }), { lost: true });
  }
  if (x.code === 'ECANCEL') return new Error('bc:cancelled', { cause: e });
  if (x.code === 'ETIMEOUT') return write ? Object.assign(new Error(x.message, { cause: e }), { lost: true }) : new Error(`bc:timeout|${timeout}`, { cause: e });
  return new Error(`bc:serverError|${x.number ?? ''}|${x.message}`, { cause: e });
}

// R4: one batch after login (LANGUAGE first: it resets DATEFORMAT and DATEFIRST), then the server's major version and engine
// edition (msSupported) and the database's collation (R8: plain comparisons when it is _CI_AS).
const SESSION = `SET LANGUAGE us_english; SET DATEFORMAT ymd; SET DATEFIRST 7; SET LOCK_TIMEOUT -1; SET ARITHABORT ON; SET CONCAT_NULL_YIELDS_NULL ON;
SELECT CAST(SERVERPROPERTY('ProductMajorVersion') AS int), CAST(SERVERPROPERTY('EngineEdition') AS int), CAST(DATABASEPROPERTYEX(DB_NAME(), 'Collation') AS nvarchar(128))`;
/** R4: SQL Server 2016 (13) or later (DATEDIFF_BIG, R9); Azure SQL Database (edition 5) and Managed Instance (8) report 12
 *  but are current. */
export const msSupported = (major: number | null, edition: number | null): boolean => edition === 5 || edition === 8 || (major !== null && major >= 13);

/** User tables and views the login can read, outside sys and INFORMATION_SCHEMA; their columns (MsColumn: TYPE_NAME of the
 *  system type gives an alias type's base; a temporal table's period column, GENERATED ALWAYS, reads as computed) and the position of each in the primary key (null: not in it). Ordered by object
 *  id inside a name, so two tables whose names differ only by case (a case-sensitive database) never interleave. */
const catalog = (where: string) => `SELECT o.object_id, s.name, o.name, c.name, TYPE_NAME(c.system_type_id), c.max_length, c.precision, c.scale,
  c.is_nullable, CAST(CASE WHEN c.default_object_id <> 0 THEN 1 ELSE 0 END AS bit), c.is_identity,
  CAST(CASE WHEN c.is_computed = 1 OR c.generated_always_type <> 0 THEN 1 ELSE 0 END AS bit), c.collation_name, ic.key_ordinal
FROM sys.objects o
JOIN sys.schemas s ON s.schema_id = o.schema_id
JOIN sys.columns c ON c.object_id = o.object_id
LEFT JOIN sys.indexes i ON i.object_id = o.object_id AND i.is_primary_key = 1
LEFT JOIN sys.index_columns ic ON ic.object_id = i.object_id AND ic.index_id = i.index_id AND ic.column_id = c.column_id
WHERE o.type IN ('U', 'V') AND o.is_ms_shipped = 0 AND s.name NOT IN ('sys', 'INFORMATION_SCHEMA')
  AND HAS_PERMS_BY_NAME(QUOTENAME(s.name) + '.' + QUOTENAME(o.name), 'OBJECT', 'SELECT') = 1 AND ${where}
ORDER BY s.name, o.name, o.object_id, c.column_id`;

function tablesOf(rows: unknown[][]): RemoteTable[] {
  const out: RemoteTable[] = [];
  for (let i = 0, j = 0; i < rows.length; i = j) {
    const id = rows[i]![0];
    while (j < rows.length && rows[j]![0] === id) j++;
    const part = rows.slice(i, j);
    const cols = part.map((r): MsColumn & { pk: number | null } => ({ name: r[3] as string, type: (r[4] as string | null) ?? '', maxLength: r[5] as number,
      precision: r[6] as number, scale: r[7] as number, nullable: r[8] as boolean, hasDefault: r[9] as boolean, identity: r[10] as boolean,
      computed: r[11] as boolean, collation: r[12] as string | null, pk: r[13] as number | null }));
    const pk = cols.filter((c) => c.pk !== null).sort((a, b) => a.pk! - b.pk!).map((c) => c.name);
    out.push(msRemoteTable(part[0]![1] as string, part[0]![2] as string, cols, pk));
  }
  return out;
}

/** R12: the first column of unique constraint or index @p1 of table @p0 (2627 and 2601 name the index, not a column). */
const INDEX_COLUMN = `SELECT TOP (1) c.name FROM sys.indexes i
JOIN sys.index_columns ic ON ic.object_id = i.object_id AND ic.index_id = i.index_id AND ic.key_ordinal = 1
JOIN sys.columns c ON c.object_id = ic.object_id AND c.column_id = ic.column_id
WHERE i.object_id = OBJECT_ID(@p0) AND i.name = @p1`;
/** R12: constraint @p0 of schema @p1 (547 names it; names are unique per schema only): its type (F, C), its table and
 *  schema, its (first) column, and for a foreign key the first column it references. */
const CONSTRAINT = `SELECT TOP (1) RTRIM(o.type), OBJECT_NAME(o.parent_object_id), OBJECT_SCHEMA_NAME(o.parent_object_id),
  COALESCE(COL_NAME(fc.parent_object_id, fc.parent_column_id), COL_NAME(cc.parent_object_id, NULLIF(cc.parent_column_id, 0))),
  COL_NAME(fc.referenced_object_id, fc.referenced_column_id)
FROM sys.objects o
LEFT JOIN sys.foreign_key_columns fc ON fc.constraint_object_id = o.object_id AND fc.constraint_column_id = 1
LEFT JOIN sys.check_constraints cc ON cc.object_id = o.object_id
WHERE o.name = @p0 AND o.schema_id = SCHEMA_ID(@p1) AND o.type IN ('F', 'C')`;
// 244, 248: an nvarchar parameter too large for a tinyint or an int column (R7 sends every value as text).
const CONVERSION: Record<number, FieldError['code']> = { 2628: 'tooLong', 8152: 'tooLong', 220: 'outOfRange', 244: 'outOfRange', 248: 'outOfRange',
  8115: 'outOfRange', 241: 'invalidDate', 242: 'invalidDate' };
/** The name quoted after `before` in a server message (us_english, R4). ponytail: a name holding a quote is cut there (no field). */
const quoted = (message: string, before: string): string | undefined => new RegExp(`${before} ['"]([^'"]*)['"]`).exec(message)?.[1];

/** CONSTRAINT's parameters for a 547 on a write into `t`: the constraint lives in its table's schema, `t`'s for its own foreign
 *  key or check, else (a REFERENCE constraint: a key of `t` others refer to) the referencing table's, named in the message
 *  (`table "schema.name"`). ponytail: a schema holding a dot is cut there (no table named). */
function constraintOf(message: string, t: RemoteTable): string[] {
  const own = !/REFERENCE constraint/.test(message);
  return [quoted(message, 'constraint') ?? '', own ? (t.schema ?? 'dbo') : (/table "([^".]*)\./.exec(message)?.[1] ?? '')];
}

type Plan = { ms: MsPlan; cols: BoundColumn[] };
/** A write the server ignored without an error (an INSTEAD OF trigger writing nothing: OUTPUT reports it done all the same). */
const notWritten = (t: RemoteTable) => new Error(`bc:serverError|notWritten|${t.remote}`);
const invalid = (): never => { throw new Error('bc:invalidArgument'); };
/** R7: a value as the text bound for it: Yes/No 1/0, a date ISO `YYYY-MM-DDTHH:MM:SS`, numbers as digits; the server converts
 *  it to the column's type. */
const sent = (v: SqlValue, fd: FieldDef): string | null =>
  v === null ? null : fd.props.type === 'yesNo' ? (Number(v) ? '1' : '0') : fd.props.type === 'dateTime' ? String(v).replace(' ', 'T') : String(v);
/** R11: a row's token under key columns `names` (`version` '' without a rowversion), or null when a key is Null (an outer
 *  join's missing side: read-only) or the token is too long. */
const tokenOf = (names: string[], keys: unknown[], version: unknown): string | null =>
  keys.length && typeof version === 'string' && keys.every((k) => typeof k === 'string') ? rowToken(names, keys as string[], version) : null;
const tableSql = (t: RemoteTable) => `${t.schema !== undefined ? `${msIdent(t.schema)}.` : ''}${msIdent(t.remote)}`;
const fieldOf = (t: RemoteTable, name: string): FieldDef => t.design.fields.find((fd) => fd.name === name) ?? invalid();
/** A column of the table variable @k: its declared type (R5's msType, read from the cached link and written into the text:
 *  checked) and, for text, its collation (a table variable takes the database's: the join would conflict, 468). */
function declared(fd: FieldDef): string {
  const type = String(fd.props.msType ?? ''), collation = fd.props.msCollation;
  if (!/^[a-z0-9]+(?:\((?:\d+|max)(?:,\d+)?\))?$/i.test(type) || (collation !== undefined && !/^\w+$/.test(String(collation)))) invalid();
  return `${msIdent(fd.name)} ${type}${collation !== undefined ? ` COLLATE ${String(collation)}` : ''}`;
}
/** R7: key column `k`'s parameter `v`, VarChar for a varchar or char column. ponytail: tedious encodes a VarChar in the
 *  database's code page; a key character outside it (a column of another collation) becomes `?` and the row is not found
 *  (bind NVarChar when the column's collation differs from the database's, if one shows up). */
const keyBind = (t: RemoteTable, k: string, v: string): MsBind => (/^(?:var)?char\(/i.test(String(fieldOf(t, k).props.msType ?? '')) ? { varchar: v } : v);
/** R7: what an insert's or update's OUTPUT keeps in @k to read its row back, and the join of alias a with it: the key; without
 *  one (a view), every field but text and ntext (never compared), the row found by its values. ponytail: a keyless insert an
 *  INSTEAD OF trigger skipped reads as written when an identical row already exists (only reachable through the API: a
 *  keyless link is read-only). */
function kept(t: RemoteTable): { declare: string; output: string; join: string } {
  const cols = t.key.length ? t.key.map((k) => fieldOf(t, k)) : t.design.fields.filter((fd) => !/^n?text$/i.test(String(fd.props.msType ?? '')));
  if (!cols.length) invalid();
  const same = (fd: FieldDef) => {
    const c = msIdent(fd.name);
    return t.key.length ? `a.${c} = k.${c}` : `(a.${c} = k.${c} OR a.${c} IS NULL AND k.${c} IS NULL)`;
  };
  return {
    declare: `DECLARE @k TABLE (${cols.map(declared).join(', ')})`,
    output: `OUTPUT ${cols.map((fd) => `INSERTED.${msIdent(fd.name)}`).join(', ')} INTO @k`,
    join: `JOIN @k AS k ON ${cols.map(same).join(' AND ')}`,
  };
}
/** Alias a's fields in design order (R6's exact text, as a read presents them), then its key texts and rowversion: what every
 *  write returns. */
const outputs = (t: RemoteTable) => [
  ...t.design.fields.map((fd) => exact(present(`a.${msIdent(fd.name)}`, fd.props), fd.props.type, fd.props)),
  ...t.key.map((k) => keyText(`a.${msIdent(k)}`, fieldOf(t, k).props)),
  ...(t.key.length && t.version !== undefined ? [`CONVERT(varchar(18), CAST(a.${msIdent(t.version)} AS binary(8)), 1)`] : []),
].join(', ');
const decoded = (t: RemoteTable, row: unknown[]) => {
  const n = t.design.fields.length;
  return { values: t.design.fields.map((fd, i) => msDecode(fd, row[i])), ref: tokenOf(t.key, row.slice(n, n + t.key.length), t.version !== undefined ? row[n + t.key.length] : '') };
};
/** The fields written: a computed or identity column (msComputed) is never sent; a value for it is readOnly. */
function written(t: RemoteTable, values: Record<string, SqlValue>): { cols: FieldDef[] } | { errors: FieldError[] } {
  const given = t.design.fields.filter((fd) => Object.hasOwn(values, fd.name));
  const refused = given.filter((fd) => fd.props.msComputed && values[fd.name] !== null);
  return refused.length ? { errors: refused.map((fd) => ({ field: fd.name, code: 'readOnly' as const })) } : { cols: given.filter((fd) => !fd.props.msComputed) };
}
/** R11 without a rowversion: field `fd` still as read, its stored form compared with parameter @p<i> (none for Null). A date
 *  compares its text to the second, as read (a datetime2(7) fraction is no change), a Decimal at its linked scale (a
 *  decimal(38, 10) reads rounded), text in its column's collation (a change of case only is none on _CI_AS). */
function unchanged(fd: FieldDef, i: number | null): string {
  const col = `a.${msIdent(fd.name)}`;
  if (i === null) return `${col} IS NULL`;
  if (fd.props.type === 'dateTime') return `CONVERT(char(19), ${present(col, fd.props)}, 120) = @p${i}`;
  if (fd.props.type === 'number' && fd.props.numberSize === 'decimal') return `CAST(${col} AS decimal(38, ${Number(fd.props.scale) || 0})) = @p${i}`;
  return `${present(col, fd.props)} = @p${i}`;
}
/** R16: find()'s condition on alias a, compared as msPlan compares (R8: text without case, in the column's collation when it
 *  is _CI_AS, else Latin1_General_100_CI_AS). */
export function findCondition(t: RemoteTable, where: Record<string, SqlValue>, dbCi: boolean): { sql: string; params: MsParam[] } {
  const { cond, leaf } = equalities(t, where);
  const ctx: MsExprCtx = {
    resolve: (e) => {
      const x = leaf.get(e) ?? invalid();
      const { fd } = x, type = fd.props.type;
      if (!('value' in x)) return { sql: present(`a.${msIdent(fd.name)}`, fd.props), type, ...colInfo(type, fd.props) };
      const p = paramOf(x.value, { name: fd.name, type, props: fd.props });
      // a bigint key: an identity's int (above 2^31) and a Decimal(19, 0)'s decimal(38, 0) (the column converted: a scan) as bigint
      const q: MsParam = /^bigint$/i.test(String(fd.props.msType)) && (p.cast === 'int' || fitsBigint(p.value)) ? { ...p, cast: 'bigint' } : p;
      return { sql: q.cast === 'nvarchar' ? '@?' : `CAST(@? AS ${q.cast})`, type, ci: true, params: [q], param: true };
    },
    typeOf: (e) => leaf.get(e)?.fd.props.type ?? null, now: new Date(), dbCi,
  };
  return msNumber(msCondition(cond, ctx));
}
/** A token read under another key (M3): never a delete by its values. */
const stale = (): never => { throw new Error('bc:notFound'); };
const DELETE_PARAMS = 2000; // per request (a DELETE, a migration's INSERT page): under sp_executesql's 2 100 parameters
/** C7 R6: every name of schema @p0 an object of a run could clash with: sys.objects (tables, views, every constraint: PK, FK,
 *  DF, UQ, CHECK…, procedures…) and the indexes of its tables (per table on SQL Server: over-reserved); one row (NULL) for an
 *  empty schema, none when it does not exist. ponytail: an object the login cannot see (metadata visibility) is not listed;
 *  a clash with it fails the run inside its transaction (2714). */
const SCHEMA_NAMES = `SELECT o.name FROM sys.schemas s LEFT JOIN (SELECT schema_id, name FROM sys.objects
  UNION SELECT o.schema_id, i.name FROM sys.indexes i JOIN sys.objects o ON o.object_id = i.object_id WHERE i.name IS NOT NULL) o ON o.schema_id = s.schema_id
WHERE s.name = @p0`;
/** C7 R9: table `table` (quoted; @p0 the same text) dropped, every foreign key referencing it first (another table's too). */
const dropTable = (table: string) => `DECLARE @s nvarchar(max) = N'';
SELECT @s += N'ALTER TABLE ' + QUOTENAME(OBJECT_SCHEMA_NAME(parent_object_id)) + N'.' + QUOTENAME(OBJECT_NAME(parent_object_id)) + N' DROP CONSTRAINT ' + QUOTENAME(name) + N'; '
FROM sys.foreign_keys WHERE referenced_object_id = OBJECT_ID(@p0);
EXEC sp_executesql @s;
DROP TABLE IF EXISTS ${table}`;

/** What R13 reads of tedious's ColumnMetadata (not exported by its entry point). */
type ColumnMeta = { colName: string; type: { name: string }; precision?: number; scale?: number; dataLength?: number };
/** R13: `sql` as typed in one batch (no parameters, no sp_executesql; `GO` is the user's to avoid, as in Access): the records
 *  the first result set with columns, `affected` the rows of every done and doneInProc (a SELECT's rows too, as C6's
 *  PostgreSQL). Rejects with tedious's error. */
function msNative(tds: Tds, sql: string): Promise<NativeResult> {
  return new Promise((resolve, reject) => {
    let sets = 0, affected = 0;
    let meta: ColumnMeta[] = [];
    const rows: unknown[][] = [];
    const req = new Request(sql, (e) => {
      if (e) return reject(e);
      const columns = meta.map((m) => ({ name: m.colName, props: msPtProps(m.type.name, m.precision ?? 0, m.scale ?? 0, m.dataLength ?? 0) }));
      resolve({ columns, affected, rows: rows.map((r) => columns.map((c, k) => msDecode(c, msPtValue(r[k], meta[k]!.type.name, meta[k]!.scale ?? 0)))) });
    });
    req.on('columnMetadata', (cols) => { if (++sets === 1) meta = cols as ColumnMeta[]; }); // an array: useColumnNames is off
    req.on('row', (cols: { value: unknown }[]) => { if (sets === 1) rows.push(cols.map((c) => c.value)); });
    const count = (n: number | undefined) => { affected += n ?? 0; };
    req.on('done', count);
    req.on('doneInProc', count);
    tds.execSqlBatch(req);
  });
}

/** R4: a connected session, or bc:linkUnavailable|needsLogin|<key> / certificate|<label> / cannotConnect|<label> /
 *  passwordExpired|<label> / serverVersion|<label> (msSupported). */
export async function openMs(p: MsParams, c: Credentials): Promise<Connection> {
  let tds: Tds | undefined;
  let version: number | null;
  let edition: number | null;
  let collation: string | null;
  try {
    tds = await connectMs(msConfig(p, c)); // inside: a failing CA lookup is a connect failure too
    [[version, edition, collation]] = (await msQuery(tds, SESSION)) as [[number | null, number | null, string | null]];
  } catch (e) {
    tds?.close();
    throw connectError(e, p);
  }
  if (!msSupported(version, edition)) {
    tds.close();
    throw new Error(`bc:linkUnavailable|serverVersion|${msLabel(p)}`);
  }
  const cn = tds;
  const dbCi = msCi(collation);
  /** One request: a batch without `params`, else sp_executesql. `write` (a write or COMMIT): a timeout is lost and the
   *  connection closed (a transaction it leaves open is rolled back by the server). */
  const exec = async (sql: string, params?: MsBind[], write = false): Promise<unknown[][]> => {
    try {
      return await msQuery(cn, sql, params);
    } catch (e) {
      const x = serverError(e, p.timeout, write);
      if (write && first(e).code === 'ETIMEOUT') cn.close();
      throw x;
    }
  };
  const read = async (where: string, values: string[]) => tablesOf(await exec(catalog(where), values));
  /** A ROLLBACK that fails leaves the session inside the transaction: the connection is closed (the next call reconnects) and the
   *  outcome reported lost, never run again. */
  const rollback = (e: unknown) => exec('IF @@TRANCOUNT > 0 ROLLBACK').catch(() => {
    cn.close();
    throw Object.assign(new Error((e as Error).message, { cause: e }), { lost: true });
  });
  /** The first row of a lookup after a refusal; none when it fails. */
  const lookup = (sql: string, params: string[]): Promise<unknown[]> => exec(sql, params).then((r) => r[0] ?? [], () => []);
  /** A refused write of `cols` into `t` as a field error, else null (R12). */
  const refusal = async (e: unknown, t: RemoteTable, cols: FieldDef[]): Promise<FieldError | null> => {
    const x = first((e as Error).cause), msg = x.message ?? '';
    const field = (name: unknown) => (t.design.fields.some((fd) => fd.name === name) ? String(name) : '');
    switch (x.number) {
      case 2627: case 2601: { // the first column of the constraint's or unique index's index
        const [col] = await lookup(INDEX_COLUMN, [tableSql(t), quoted(msg, '(?:constraint|index)') ?? '']);
        return { field: field(col), code: 'duplicate' };
      }
      case 515: return { field: field(quoted(msg, 'column')), code: 'required' };
      case 547: {
        const [type, table, schema, col, parent] = await lookup(CONSTRAINT, constraintOf(msg, t));
        if (type === 'C') return { field: field(col), code: 'validation', message: msg };
        if (type !== 'F') return null;
        // our foreign key written, else a key of ours others refer to (the referencing table by its server name)
        const ours = table === t.remote && schema === t.schema && cols.some((fd) => fd.name === col);
        return ours ? { field: field(col), code: 'noParent' } : { field: field(parent), code: 'related', ...(typeof table === 'string' && { table }) };
      }
      default: { // the column the message names (2628), else the one field written
        const code = x.number !== undefined ? CONVERSION[x.number] : undefined;
        return code ? { field: field(quoted(msg, 'column')) || (cols.length === 1 ? cols[0]!.name : ''), code } : null;
      }
    }
  };
  /** A write of `cols`; a refusal of the server as a field error. */
  const write = async <T>(t: RemoteTable, cols: FieldDef[], fn: () => Promise<T>): Promise<T | { ok: false; errors: FieldError[] }> => {
    try {
      return await fn();
    } catch (e) {
      const f = await refusal(e, t, cols);
      if (f) return { ok: false, errors: [f] };
      throw e;
    }
  };
  const serverTable = (t: { schema: string; name: string }) => `${msIdent(t.schema)}.${msIdent(t.name)}`;
  /** A refused migration statement's error with the field it names and its FieldError code, when the server tells (R12's
   *  refusal: 2628 tooLong, 2627 duplicate…; 1505, a unique index over duplicates, by the index's first field). */
  const named = (e: unknown, f: Pick<FieldError, 'field' | 'code'> | null): unknown => (f ? Object.assign(e as Error, { field: f.field, code: f.code }) : e);
  const indexed = (e: unknown, ix: ServerIndex | undefined) => named(e, ix && first((e as Error).cause).number === 1505 ? { field: ix.fields[0]!.name, code: 'duplicate' } : null);
  let inTransaction = false; // transaction() running
  const unfiltered = new Map<string, { t: ServerTable; ix: ServerIndex }>(); // a one-field unique index created filtered, by schema, table, field
  const at = (schema: string, table: string, field: string) => JSON.stringify([schema, table, field]);
  // C7 R18: inside transaction() (SQL Server's DDL is transactional), but dropTables. Every request is a write (a timeout: lost).
  const schema: SchemaWriter = {
    limits: { nameMax: 128, unit: 'utf16', params: DELETE_PARAMS },
    columnType: msColumnType,
    async names(s) {
      const rows = await exec(SCHEMA_NAMES, [s]);
      return rows.length ? rows.map((r) => r[0]).filter((n): n is string => typeof n === 'string') : null;
    },
    async createTable(t) { await exec(msCreateTable(t, msVersionColumn(t)), undefined, true); },
    async insertRows(t, rows) {
      if (!rows.length) return;
      try {
        await exec(msInsertRows(t, rows.length), rows.flatMap((r) => r.map((v, i) => sent(v, t.fields[i]!))), true);
      } catch (e) {
        const rt: RemoteTable = { name: t.name, remote: t.name, schema: t.schema, key: t.key, skipped: [], design: { name: t.name, fields: t.fields } };
        throw named(e, await refusal(e, rt, t.fields));
      }
    },
    async finishTable(t) {
      const sqls = msFinishTable(t), from = sqls.length - t.indexes.length; // the reseed, then one per index
      for (const [i, sql] of sqls.entries()) await exec(sql, undefined, true).catch((e) => { throw indexed(e, t.indexes[i - from]); });
      for (const ix of t.indexes) if (ix.unique && ix.fields.length === 1 && msCreateIndex(t, ix) !== msCreateIndex(t, ix, false)) unfiltered.set(at(t.schema, t.name, ix.fields[0]!.name), { t, ix });
    },
    countRows: async (t) => Number((await exec(`SELECT count(*) FROM ${serverTable(t)}`))[0]![0]),
    async addForeignKeys(fks) {
      const made = msCascadeDowngrades(fks); // R7: never error 1785
      for (const fk of made) {
        const u = fk.parentFields.length === 1 ? unfiltered.get(at(fk.schema, fk.parent, fk.parentFields[0]!)) : undefined;
        if (u) { // a foreign key cannot reference a filtered index (1776): the parent's rebuilt
          unfiltered.delete(at(fk.schema, fk.parent, fk.parentFields[0]!));
          await exec(msUnfiltered(u.t, u.ix), undefined, true).catch((e) => {
            // the filtered index held: a 1505 here is two Nulls, which an unfiltered unique index refuses (Access allows them)
            if (first((e as Error).cause).number !== 1505) throw e;
            const field = u.ix.fields[0]!.name;
            throw Object.assign(new Error(`bc:migrateOneNull|${u.t.name}.${field}|${fk.relation}`, { cause: e }), { table: u.t.name, field });
          });
        }
        await exec(msForeignKey(fk), undefined, true);
      }
      return made;
    },
    async dropTables(tables) { // the last created first; each one's referencing foreign keys first
      const left: string[] = [];
      for (const t of [...tables].reverse()) await exec(dropTable(serverTable(t)), [serverTable(t)]).catch(() => left.push(t.name));
      return left;
    },
  };
  return {
    tables: () => read('1 = 1', []),
    async table(t) {
      const found = (await read('s.name = @p0 AND o.name = @p1', [t.schema ?? 'dbo', t.remote]))[0];
      return found ? linkedAs(found, t.name) : null; // the link keeps its name
    },
    plan: (r) => ({ ms: msPlan(r, dbCi), cols: r.query.columns } satisfies Plan as unknown as ReadPlan),
    async count(pl) {
      const { ms } = pl as unknown as Plan;
      return Number((await exec(ms.count, ms.params.map((q) => q.value)))[0]![0]);
    },
    async rows(pl, offset, limit) {
      const { ms, cols } = pl as unknown as Plan;
      if (limit <= 0) return { rows: [], refs: [] }; // FETCH NEXT 0 is an error (R10): nothing sent
      const rs = await exec(ms.rows, [...ms.params.map((q) => q.value), String(offset), String(limit)]);
      const n = ms.columns, k = ms.keys.length;
      return {
        rows: rs.map((r) => cols.map((c, j) => msDecode(c, r[j]))),
        refs: rs.map((r) => (k ? tokenOf(ms.keys, r.slice(n, n + k), ms.version ? r[n + k] : '') : null)),
      };
    },
    async insert(t, values): Promise<RemoteWrite> {
      const w = written(t, values);
      if ('errors' in w) return { ok: false, errors: w.errors };
      const k = kept(t);
      const into = w.cols.length ? ` (${w.cols.map((fd) => msIdent(fd.name)).join(', ')}) ${k.output} VALUES (${w.cols.map((_, i) => `@p${i}`).join(', ')})` : ` ${k.output} DEFAULT VALUES`;
      // R7: OUTPUT … INTO, then the row read back (a plain OUTPUT fails on a table with a trigger, 334); none: an INSTEAD OF
      // trigger wrote nothing
      return write(t, w.cols, async () => {
        const [row] = await exec(`${k.declare}; INSERT INTO ${tableSql(t)}${into}; SELECT TOP (1) ${outputs(t)} FROM ${tableSql(t)} AS a ${k.join}`,
          w.cols.map((fd) => sent(values[fd.name]!, fd)), true);
        if (!row) throw notWritten(t);
        return { ok: true as const, ...decoded(t, row) };
      });
    },
    async update(t, ref, values, expected): Promise<RemoteWrite | RemoteConflict> {
      if (!t.key.length) throw new Error('bc:invalidArgument');
      const at = parseRowToken(ref, t.key);
      if (!at) return { ok: false, conflict: 'deleted' }; // read under another key (M3): the row as it was read is gone
      const w = written(t, values);
      if ('errors' in w) return { ok: false, errors: w.errors };
      const binds: MsBind[] = t.key.map((k, j) => keyBind(t, k, at.keys[j]!));
      const bind = (v: MsBind) => binds.push(v) - 1;
      const where = t.key.map((k, j) => `a.${msIdent(k)} = @p${j}`).join(' AND ');
      // R11: the rowversion when the table has one (the expected values ignored), else each comparable value as read (a date
      // as its stored text, compared to the second)
      const versioned = t.version !== undefined && at.version !== '';
      const checks = versioned ? [`a.${msIdent(t.version!)} = CONVERT(binary(8), @p${bind({ varchar: at.version })}, 1)`]
        : t.design.fields.filter((fd) => expected && Object.hasOwn(expected, fd.name)).map((fd) => {
          const v = expected![fd.name]!;
          return unchanged(fd, v === null ? null : bind(fd.props.type === 'dateTime' ? String(v) : sent(v, fd)));
        });
      const set = w.cols.map((fd) => `a.${msIdent(fd.name)} = @p${bind(sent(values[fd.name]!, fd))}`).join(', ');
      const cond = [where, ...checks].join(' AND ');
      const k = kept(t);
      // nothing to write: the row checked only
      const sql = set ? `${k.declare}; UPDATE a SET ${set} ${k.output} FROM ${tableSql(t)} AS a WHERE ${cond}; SELECT TOP (1) ${outputs(t)} FROM ${tableSql(t)} AS a ${k.join}`
        : `SELECT TOP (1) ${outputs(t)} FROM ${tableSql(t)} AS a WHERE ${cond}`;
      return write(t, w.cols, async (): Promise<RemoteWrite | RemoteConflict> => {
        const [row] = await exec(sql, binds, set !== ''); // nothing to write: a read
        if (row) {
          const d = decoded(t, row);
          if (set && versioned && d.ref === ref) throw notWritten(t); // OUTPUT saw the row but its version did not move: an INSTEAD OF trigger
          // ponytail: without a rowversion an INSTEAD OF UPDATE trigger writing nothing reads as saved (OUTPUT reports the row,
          // nothing tells it apart); compare the row read back with the values sent if one shows up
          return { ok: true, ...d };
        }
        const [now] = await exec(`SELECT TOP (1) ${outputs(t)} FROM ${tableSql(t)} AS a WHERE ${where}`, binds.slice(0, t.key.length)); // F12: absent, or as it is now
        if (!now) return { ok: false, conflict: 'deleted' };
        const d = decoded(t, now);
        if (versioned && d.ref === ref) throw notWritten(t); // same version: the server skipped the row (a changed conflict would loop)
        // without a rowversion the reference stays: Save Record then compares against `current`, which the renderer adopts
        return { ok: false, conflict: 'changed', current: d.values, ref: d.ref! };
      });
    },
    async delete(t, refs): Promise<DeleteResult> { // by key only: deletes are not checked (C4 R8)
      if (!t.key.length) throw new Error('bc:invalidArgument');
      const keys = refs.map((r) => parseRowToken(r, t.key)?.keys ?? stale());
      const size = Math.floor(DELETE_PARAMS / t.key.length);
      const chunks = Array.from({ length: Math.ceil(keys.length / size) }, (_, i) => keys.slice(i * size, (i + 1) * size));
      const declare = `DECLARE @k TABLE (${t.key.map((k) => declared(fieldOf(t, k))).join(', ')})`;
      const output = `OUTPUT ${t.key.map((k) => `DELETED.${msIdent(k)}`).join(', ')} INTO @k`;
      const many = chunks.length > 1 && !inTransaction; // one statement is its own transaction; inside transaction() (C7 R14) its own: a nested ROLLBACK would end the caller's
      let count = 0;
      try {
        if (many) await exec('BEGIN TRANSACTION'); // a batch: the transaction lasts for the session
        for (const ks of chunks) {
          const cond = t.key.length === 1 ? `a.${msIdent(t.key[0]!)} IN (${ks.map((_, i) => `@p${i}`).join(', ')})`
            : ks.map((_, i) => `(${t.key.map((k, j) => `a.${msIdent(k)} = @p${i * t.key.length + j}`).join(' AND ')})`).join(' OR ');
          const [[n]] = await exec(`${declare}; DELETE a ${output} FROM ${tableSql(t)} AS a WHERE ${cond}; SELECT count(*) FROM @k`,
            ks.flatMap((k) => k.map((v, j) => keyBind(t, t.key[j]!, v))), true) as [[number]];
          count += n;
        }
        if (many) await exec('COMMIT', undefined, true);
      } catch (e) {
        if (many && !(e as { lost?: unknown }).lost) await rollback(e);
        const x = first((e as Error).cause);
        if (x.number !== 547) throw e;
        const [, table] = await lookup(CONSTRAINT, constraintOf(x.message ?? '', t));
        return { ok: false, reason: 'related', ...(typeof table === 'string' && { table }) }; // the referencing table's server name
      }
      return { ok: true, count };
    },
    async find(t, where, limit, lock) {
      const c = findCondition(t, where, dbCi);
      const rs = await exec(`SELECT TOP (CAST(@p${c.params.length} AS int)) ${outputs(t)} FROM ${tableSql(t)} AS a${lock ? ' WITH (UPDLOCK, ROWLOCK)' : ''} WHERE ${c.sql}`,
        [...c.params.map((q) => q.value), String(limit)]);
      return rs.map((r) => decoded(t, r));
    },
    async transaction(fn) {
      unfiltered.clear(); // C7: the filtered indexes of an earlier (rolled back) run are gone
      await exec('BEGIN TRANSACTION'); // a batch: the transaction lasts for the session
      inTransaction = true;
      try {
        const r = await fn();
        await exec('COMMIT', undefined, true);
        return r;
      } catch (e) {
        // a refusal ends its statement only (XACT_ABORT OFF), a cancel leaves the transaction open: rolled back here; lost: the
        // server rolled it back
        if (!(e as { lost?: unknown }).lost) await rollback(e);
        throw neverUnsent(e);
      } finally {
        inTransaction = false;
      }
    },
    // R13, C6 R4: one connection per run (RemoteSources.once); Stop is cancel(), the timeout requestTimeout's
    async native(sql) {
      try {
        return await msNative(cn, sql);
      } catch (e) {
        throw serverError(e, p.timeout);
      }
    },
    schema,
    // R12: an attention packet on the same connection, aimed at tedious's request object (never the next one); false when no
    // request runs. ponytail: a Stop landing between a page's count and its rows finds none and the rows run: Stop again.
    cancel: async () => cn.cancel(),
    close: async () => cn.close(),
  };
}
