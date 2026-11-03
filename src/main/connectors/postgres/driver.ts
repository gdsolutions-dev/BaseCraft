// The only importer of `pg` (C4 R1): index.ts's open() imports it on first use, a separate chunk of the db-host bundle.
// Connection, TLS and session settings (R11), the catalog (R6, R13), reads, writes with xmin (R4, R8), errors, cancel (R12).
import net from 'node:net';
import tls from 'node:tls';
import pg, { type Client, type ClientConfig } from 'pg';
import type { DeleteResult } from '../../../shared/api';
import type { SqlValue } from '../../../shared/coerce';
import type { FieldDef } from '../../../shared/field-types';
import type { BoundColumn } from '../../../shared/query/bind';
import { CERTIFICATE_ERRORS, equalities, fitsBigint, linkedAs, neverUnsent, type Connection, type Credentials, type FieldError, type ReadPlan, type RemoteConflict, type RemoteTable, type RemoteWrite } from '../connector';
import { pgColumnType, pgCreateTable, pgFinishTable, pgForeignKey, pgInsertRows } from './ddl';
import { pgKey, pgLabel, type PgParams } from './params';
import { pgCondition, pgIdent, pgNumber, type PgExprCtx, type PgParam } from './sql-expr';
import { parseRowToken, rowToken } from '../token';
import { castOf, pgPlan, present, type PgPlan } from './sql-query';
import { pgDecode, ptProps, remoteTable, type PgColumn } from './types';

// R13: the server's text for every type but these, which pg parses (numbers that fit a double, booleans): int8, numeric,
// dates and json stay exact text for pgDecode.
const PARSED = new Set([16 /* bool */, 21 /* int2 */, 23 /* int4 */, 700 /* float4 */, 701 /* float8 */]);
const asText = (v: string) => v;

/** R11: verify-full checks the certificate against Node's CAs and the workstation's store (a `ca` list replaces the defaults)
 *  and the host name (pg sets `servername` itself, never to an IP: RFC 6066); require encrypts without checking. */
export function pgSsl(mode: PgParams['tls']): ClientConfig['ssl'] {
  if (mode === 'disable') return false;
  if (mode === 'require') return { rejectUnauthorized: false };
  return { rejectUnauthorized: true, ca: [...tls.getCACertificates('default'), ...tls.getCACertificates('system')] };
}

export function pgConfig(p: PgParams, c: Credentials): ClientConfig {
  return {
    host: p.host, port: p.port, database: p.database, user: c.user, password: c.password, ssl: pgSsl(p.tls),
    // The connect timeout stays bounded with `timeout` 0 (an unreachable host would wait on the OS); statement_timeout: SESSION.
    connectionTimeoutMillis: Math.min(p.timeout || 15, 15) * 1000, application_name: 'BaseCraft',
    types: { getTypeParser: (oid, format) => (PARSED.has(oid) ? pg.types.getTypeParser(oid, format) : asText) },
  };
}

/** A connect failure as R11/R17 report it: a refused login needsLogin|<key>, an untrusted certificate certificate|<label>,
 *  anything else (ENOTFOUND, ECONNREFUSED, ETIMEDOUT, the connect timeout, an unknown database…) cannotConnect|<label>. */
export function connectError(e: unknown, p: PgParams): Error {
  const code = (e as { code?: unknown } | null)?.code;
  if (code === '28P01' || code === '28000') return new Error(`bc:linkUnavailable|needsLogin|${pgKey(p)}`, { cause: e });
  return new Error(`bc:linkUnavailable|${CERTIFICATE_ERRORS.has(code as string) ? 'certificate' : 'cannotConnect'}|${pgLabel(p)}`, { cause: e });
}

// One round trip after login (R11, R15): the session's date style, zone and statement timeout (always set: 0 = none, not the
// role's or server's default), the server version, the collation for text sorts. Catalog names are qualified with pg_catalog
// (a role's search_path cannot shadow them; operators stay unqualified: pg_catalog's exact-type ones are found first).
const SESSION = `SELECT pg_catalog.set_config('DateStyle', 'ISO, YMD', false), pg_catalog.set_config('TimeZone', $1, false),
  pg_catalog.set_config('statement_timeout', $2, false),
  pg_catalog.current_setting('server_version_num')::pg_catalog.int4 AS version,
  (SELECT collname FROM pg_catalog.pg_collation WHERE collname IN ('fr-x-icu', 'und-x-icu') ORDER BY collname LIMIT 1) AS collation`;
/** The workstation's current offset as PostgreSQL's numeric TimeZone (hours, east positive): when the server lacks its zone. */
export const offsetZone = (d = new Date()): string => String(-d.getTimezoneOffset() / 60);

/** Tables, partitioned tables (not their partitions), views and materialized views the user can read in a schema it can use,
 *  outside the system schemas; their columns
 *  (PgColumn) and the position of each in the primary key (null: not in it). */
const catalog = (where: string) => `SELECT n.nspname AS schema, c.relname AS table, a.attname AS name,
  pg_catalog.format_type(a.atttypid, a.atttypmod) AS type,
  CASE WHEN b.typtype = 'e' THEN 'enum' WHEN b.typcategory = 'A' THEN 'array'
    WHEN b.typnamespace = 'pg_catalog'::pg_catalog.regnamespace OR b.typname = 'citext' THEN b.typname::pg_catalog.text ELSE '' END AS base,
  CASE WHEN t.typtype = 'd' THEN t.typtypmod ELSE a.atttypmod END AS typmod,
  a.attnotnull OR t.typnotnull AS "notNull", a.atthasdef AS "hasDefault",
  a.attidentity <> '' OR coalesce(pg_catalog.pg_get_expr(d.adbin, d.adrelid) LIKE 'nextval(%', false) AS identity,
  a.attgenerated <> '' OR a.attidentity = 'a' AS generated,
  pg_catalog.array_position(k.indkey::pg_catalog.int2[], a.attnum) AS pk
FROM pg_catalog.pg_class c
JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
JOIN pg_catalog.pg_attribute a ON a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped
JOIN pg_catalog.pg_type t ON t.oid = a.atttypid
JOIN pg_catalog.pg_type b ON b.oid = CASE WHEN t.typtype = 'd' THEN t.typbasetype ELSE t.oid END
LEFT JOIN pg_catalog.pg_attrdef d ON d.adrelid = c.oid AND d.adnum = a.attnum
LEFT JOIN pg_catalog.pg_index k ON k.indrelid = c.oid AND k.indisprimary
WHERE c.relkind IN ('r', 'p', 'v', 'm') AND NOT c.relispartition AND n.nspname !~ '^pg_' AND n.nspname <> 'information_schema'
  AND pg_catalog.has_schema_privilege(n.oid, 'USAGE') AND pg_catalog.has_table_privilege(c.oid, 'SELECT') AND ${where}
ORDER BY n.nspname, c.relname, a.attnum`;
// ponytail: a domain over a domain reads as '' (skipped); walk typbasetype recursively if one shows up.

type CatalogRow = PgColumn & { schema: string; table: string; pk: number | null };
function tablesOf(rows: CatalogRow[]): RemoteTable[] {
  const out: RemoteTable[] = [];
  for (let i = 0, j = 0; i < rows.length; i = j) {
    const { schema, table } = rows[i]!;
    while (j < rows.length && rows[j]!.schema === schema && rows[j]!.table === table) j++;
    const cols = rows.slice(i, j);
    const pk = cols.filter((c) => c.pk !== null).sort((a, b) => a.pk! - b.pk!).map((c) => c.name);
    out.push(remoteTable(schema, table, cols, pk));
  }
  return out;
}

type PgError = Error & { code?: string; column?: string; constraint?: string; schema?: string; table?: string };
/** pg refuses a statement on a client already broken or closed before sending anything (“… is not queryable”): pg's own
 *  error, never a server one (no SQLSTATE), so a server message that happens to contain the words does not count. */
const notSent = (e: PgError): boolean => !e.code && /is not queryable$/.test(e.message);
/** R11: the connection is gone (a server shutdown, pg_terminate_backend, a network cut, a client already broken). */
const isLostError = (e: PgError): boolean => ['57P01', '57P02', '57P03', 'ECONNRESET', 'EPIPE', 'ETIMEDOUT'].includes(e.code ?? '')
  || /^08/.test(e.code ?? '') || /Connection terminated/.test(e.message) || notSent(e);

/** A failed statement as the shared layer reads it: lost (`lost: true`, R11: RemoteSources retries a read once; `unsent: true`
 *  when it never left, a write too), 57014
 *  bc:cancelled after our cancel (or with no timeout set: someone else's) else bc:timeout|<s> (R12), anything else
 *  bc:serverError|<code>|<message>. The server's error stays as `cause`. */
export function serverError(e: unknown, cancelled: boolean, timeout: number): Error {
  const x = e as PgError;
  if (isLostError(x)) return Object.assign(new Error(x.message, { cause: e }), { lost: true, ...(notSent(x) && { unsent: true }) });
  if (x.code === '57014') return new Error(cancelled || !timeout ? 'bc:cancelled' : `bc:timeout|${timeout}`, { cause: e });
  return new Error(`bc:serverError|${x.code ?? ''}|${x.message}`, { cause: e });
}

/** R12: PostgreSQL's cancel request for backend `pid`, on a connection of its own, as pg's Client.prototype.cancel sends it
 *  (plain, before any TLS: the server matches the key, no login); fire and forget, every socket error swallowed. Written here
 *  because Client.prototype.cancel needs the deprecated `activeQuery` and leaves its socket's errors unheard (db-host would end). */
function sendCancel(p: PgParams, pid: number, key: number): void {
  const b = Buffer.alloc(16);
  b.writeInt32BE(16, 0); b.writeInt32BE(80877102, 4); b.writeInt32BE(pid, 8); b.writeInt32BE(key, 12);
  const s = net.connect(p.port, p.host, () => s.end(b));
  s.on('error', () => {}).setTimeout(5000, () => s.destroy());
}

/** The first column of constraint or unique index $3 of table $1.$2 (23505, 23503, 23514 name no column), and for a foreign
 *  key the first column it references. */
const CONSTRAINT_COLUMN = `SELECT a.attname, f.attname FROM pg_catalog.pg_constraint k
JOIN pg_catalog.pg_class c ON c.oid = k.conrelid JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
JOIN pg_catalog.pg_attribute a ON a.attrelid = k.conrelid AND a.attnum = k.conkey[1]
LEFT JOIN pg_catalog.pg_attribute f ON f.attrelid = k.confrelid AND f.attnum = k.confkey[1]
WHERE n.nspname = $1 AND c.relname = $2 AND k.conname = $3
UNION ALL
SELECT a.attname, NULL FROM pg_catalog.pg_class i JOIN pg_catalog.pg_index x ON x.indexrelid = i.oid
JOIN pg_catalog.pg_class c ON c.oid = x.indrelid JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
JOIN pg_catalog.pg_attribute a ON a.attrelid = x.indrelid AND a.attnum = x.indkey[0]
WHERE n.nspname = $1 AND c.relname = $2 AND i.relname = $3
LIMIT 1`;
const CONVERSION: Record<string, FieldError['code']> = { 22001: 'tooLong', 22003: 'outOfRange', 22007: 'invalidDate', 22008: 'invalidDate' };

type Plan = { pg: PgPlan; cols: BoundColumn[] };
/** A write the server ignored without an error (a trigger returning NULL, a DO INSTEAD NOTHING rule, a security policy). */
const notWritten = (t: RemoteTable) => new Error(`bc:serverError|notWritten|${t.remote}`);
/** A Yes/No goes as a boolean ('-1' is no boolean input); every other value as text the server types from its column. */
const sent = (v: SqlValue, yesNo: boolean): unknown => (yesNo && typeof v === 'number' ? v !== 0 : v);
const planValues = (x: Pick<PgPlan, 'params'>) => x.params.map((q: PgParam) => sent(q.value, q.cast === 'boolean'));
/** R4: a row's token under key columns `names`, or null when a key is Null (an outer join's missing side: read-only) or the
 *  token is too long. */
const tokenOf = (names: string[], keys: unknown[], v: unknown): string | null =>
  keys.length && v != null && keys.every((k) => typeof k === 'string') ? rowToken(names, keys as string[], String(v)) : null;
const tableSql = (t: RemoteTable) => `${t.schema !== undefined ? `${pgIdent(t.schema)}.` : ''}${pgIdent(t.remote)}`;
/** A table's fields in design order, then its key as text and xmin (R4): what every write returns. A keyless table (a view:
 *  read-only, its insert reached only through the API) returns no xmin, which a view does not have. */
const outputs = (t: RemoteTable) => [...t.design.fields.map((f) => pgIdent(f.name)), ...t.key.map((k) => `${pgIdent(k)}::text`), ...(t.key.length ? ['xmin::text'] : [])].join(', ');
const decoded = (t: RemoteTable, row: unknown[]) => {
  const n = t.design.fields.length;
  return { values: t.design.fields.map((fd, i) => pgDecode(fd, row[i])), ref: tokenOf(t.key, row.slice(n, n + t.key.length), row[n + t.key.length]) };
};
/** The fields written: a generated column or GENERATED ALWAYS identity (pgGenerated) is never sent; a value for it is readOnly. */
function written(t: RemoteTable, values: Record<string, SqlValue>): { cols: FieldDef[] } | { errors: FieldError[] } {
  const given = t.design.fields.filter((fd) => Object.hasOwn(values, fd.name));
  const refused = given.filter((fd) => fd.props.pgGenerated && values[fd.name] !== null);
  return refused.length ? { errors: refused.map((fd) => ({ field: fd.name, code: 'readOnly' as const })) } : { cols: given.filter((fd) => !fd.props.pgGenerated) };
}
/** R16: find()'s condition from `$start`, compared as pgPlan compares (text without case: `lower`, a date as a timestamp). */
export function findCondition(t: RemoteTable, where: Record<string, SqlValue>, collation: string | null, start: number): { sql: string; params: PgParam[] } {
  const { cond, leaf } = equalities(t, where);
  const ctx: PgExprCtx = {
    resolve: (e) => {
      const x = leaf.get(e);
      if (!x) throw new Error('bc:invalidArgument');
      const { fd } = x, type = fd.props.type;
      if (!('value' in x)) return { sql: present(pgIdent(fd.name), fd.props), type };
      // a bigint key as int8: an identity's int4 (above 2^31) and an int8's Decimal(19, 0) numeric (the column converted: a scan)
      const c4 = castOf({ name: fd.name, type, props: fd.props });
      const cast = c4 === 'int4' || (c4 === 'numeric' && fd.props.precision === 19 && fd.props.scale === 0 && fitsBigint(x.value)) ? 'int8' : c4;
      return { sql: `$1::${cast}`, type, params: [{ value: x.value ?? null, cast }], param: true };
    },
    typeOf: (e) => leaf.get(e)?.fd.props.type ?? null, now: new Date(), collation,
  };
  return pgNumber(pgCondition(cond, ctx), start);
}
/** A token read under another key (M3): never a delete by its values. */
const stale = (): never => { throw new Error('bc:notFound'); };
/** C7 R6: every name of schema $1 an object of the run could clash with (relations, indexes, sequences, constraints, types), as
 *  JSON text; no row when the schema does not exist. */
const SCHEMA_NAMES = `SELECT coalesce((SELECT pg_catalog.json_agg(x.name) FROM (
  SELECT relname::pg_catalog.text AS name FROM pg_catalog.pg_class WHERE relnamespace = n.oid
  UNION SELECT conname::pg_catalog.text FROM pg_catalog.pg_constraint WHERE connamespace = n.oid
  UNION SELECT typname::pg_catalog.text FROM pg_catalog.pg_type WHERE typnamespace = n.oid) x), '[]')::pg_catalog.text
FROM pg_catalog.pg_namespace n WHERE n.nspname = $1`;
const DELETE_CHUNK = 1000; // rows per DELETE: at most 32 key columns x 1000 stays under PostgreSQL's 65535 parameters

/** R11: a connected session, or bc:linkUnavailable|needsLogin|<key> / certificate|<label> / cannotConnect|<label> /
 *  serverVersion|<label> (below 14). */
export async function openPg(p: PgParams, c: Credentials): Promise<Connection> {
  let client: Client | undefined;
  let version: number;
  let collation: string | null; // R15: what pgPlan sorts text with (Task 10)
  try {
    const cl = (client = new pg.Client(pgConfig(p, c))); // inside: a failing CA lookup is a connect failure too
    // A connection lost while idle emits 'error': the next call fails and RemoteSources reconnects (R11). Unheard, it ends db-host.
    cl.on('error', () => {});
    await cl.connect();
    const session = (zone: string) => cl.query<{ version: number; collation: string | null }>(SESSION, [zone, String(p.timeout * 1000)]);
    // 22023: the server's tzdata lacks the workstation's zone (a recent IANA name); its current offset instead (wrong only
    // across a DST change).
    const r = await session(Intl.DateTimeFormat().resolvedOptions().timeZone)
      .catch((e: unknown) => { if ((e as { code?: unknown } | null)?.code !== '22023') throw e; return session(offsetZone()); });
    ({ version, collation } = r.rows[0]!);
  } catch (e) {
    await client?.end().catch(() => {});
    throw connectError(e, p);
  }
  if (version < 140000) {
    await client.end().catch(() => {});
    throw new Error(`bc:linkUnavailable|serverVersion|${pgLabel(p)}`);
  }
  const cl = client;
  // R12: one statement at a time (db-host's queue): `running` its number while it runs, `cancelled` the one our cancel aimed at.
  let seq = 0, running = 0, cancelled = -1;
  const query = async (text: string, values?: unknown[]) => {
    const n = ++seq;
    running = n;
    try {
      const r = await cl.query({ text, ...(values && { values }), rowMode: 'array' });
      return Array.isArray(r) ? r : [r];
    } catch (e) {
      // ponytail: a cancel landing just after its statement ended hits the next one (PostgreSQL's cancel names a backend, not a
      // statement): that one reports bc:cancelled too, never a timeout.
      throw serverError(e, cancelled >= n - 1, p.timeout);
    } finally {
      if (running === n) running = 0;
    }
  };
  const exec = async (text: string, values: unknown[] = []): Promise<unknown[][]> => (await query(text, values))[0]!.rows;
  const read = async (where: string, values: unknown[]) => {
    try {
      return tablesOf((await cl.query<CatalogRow>(catalog(where), values)).rows);
    } catch (e) {
      throw serverError(e, false, p.timeout);
    }
  };
  /** A refused write of `cols` into `t` as a field error, else null. */
  const refusal = async (e: unknown, t: RemoteTable, cols: FieldDef[]): Promise<FieldError | null> => {
    const x = ((e as Error).cause ?? {}) as PgError;
    const field = (name: unknown) => (t.design.fields.some((fd) => fd.name === name) ? String(name) : '');
    const names = async () => (await exec(CONSTRAINT_COLUMN, [x.schema, x.table, x.constraint]).catch(() => []))[0] ?? [];
    switch (x.code) {
      case '23505': return { field: field((await names())[0]), code: 'duplicate' };
      case '23502': return { field: x.column ?? '', code: 'required' };
      case '23503': { // the error names the referencing table: ours with its foreign key written, else a key others refer to
        const [child, parent] = await names();
        const ours = x.table === t.remote && x.schema === t.schema && cols.some((fd) => fd.name === child);
        return ours ? { field: field(child), code: 'noParent' } : { field: field(parent), code: 'related', ...(x.table && { table: x.table }) };
      }
      case '23514': return { field: field((await names())[0]), code: 'validation', message: x.message };
      default: return x.code && CONVERSION[x.code] ? { field: cols.length === 1 ? cols[0]!.name : '', code: CONVERSION[x.code]! } : null; // no column named
    }
  };
  /** A ROLLBACK that fails leaves the session inside the transaction: the connection is closed (the next call reconnects) and the
   *  outcome reported lost, never run again. */
  const rollback = (e: unknown) => exec('ROLLBACK').catch(async () => {
    await cl.end().catch(() => {});
    throw Object.assign(new Error((e as Error).message, { cause: e }), { lost: true });
  });
  let inTransaction = false; // R16: transaction() running
  /** A write of `cols`; a refusal of the server as a field error. Inside a transaction, a savepoint first: a failed statement
   *  aborts the transaction, so the refusal's lookup runs after ROLLBACK TO it (and the transaction goes on to its own end).
   *  ponytail: one more round trip per write in a transaction. */
  const write = async <T>(t: RemoteTable, cols: FieldDef[], fn: () => Promise<T>): Promise<T | { ok: false; errors: FieldError[] }> => {
    if (inTransaction) await exec('SAVEPOINT bc_write');
    try {
      return await fn();
    } catch (e) {
      if (inTransaction && !(e as { lost?: unknown }).lost) await exec('ROLLBACK TO SAVEPOINT bc_write').catch(() => {});
      const f = await refusal(e, t, cols);
      if (f) return { ok: false, errors: [f] };
      throw e;
    }
  };
  const where = (t: RemoteTable) => t.key.map((k, j) => `${pgIdent(k)} = $${j + 1}`).join(' AND ');
  return {
    tables: () => read('true', []),
    async table(t) {
      const found = (await read('n.nspname = $1 AND c.relname = $2', [t.schema ?? 'public', t.remote]))[0];
      return found ? linkedAs(found, t.name) : null; // the link keeps its name
    },
    plan: (r) => ({ pg: pgPlan(r, collation), cols: r.query.columns } satisfies Plan as unknown as ReadPlan),
    async count(pl) {
      const { pg: x } = pl as unknown as Plan;
      return Number((await exec(x.count, planValues(x)))[0]![0]);
    },
    async rows(pl, offset, limit) {
      const { pg: x, cols } = pl as unknown as Plan;
      const rs = await exec(x.rows, [...planValues(x), limit, offset]);
      return {
        rows: rs.map((r) => cols.map((c, k) => pgDecode(c, r[k]))),
        refs: rs.map((r) => (x.version ? tokenOf(x.keys, r.slice(x.columns, x.columns + x.keys.length), r[x.columns + x.keys.length]) : null)),
      };
    },
    async insert(t, values): Promise<RemoteWrite> {
      const w = written(t, values);
      if ('errors' in w) return { ok: false, errors: w.errors };
      const into = w.cols.length ? ` (${w.cols.map((fd) => pgIdent(fd.name)).join(', ')}) VALUES (${w.cols.map((_, i) => `$${i + 1}`).join(', ')})` : ' DEFAULT VALUES';
      return write(t, w.cols, async () => {
        const [row] = await exec(`INSERT INTO ${tableSql(t)}${into} RETURNING ${outputs(t)}`, w.cols.map((fd) => sent(values[fd.name]!, fd.props.type === 'yesNo')));
        if (!row) throw notWritten(t);
        return { ok: true as const, ...decoded(t, row) };
      });
    },
    async update(t, ref, values): Promise<RemoteWrite | RemoteConflict> { // R8: the version is the token's xmin
      if (!t.key.length) throw new Error('bc:invalidArgument');
      const at = parseRowToken(ref, t.key);
      if (!at) return { ok: false, conflict: 'deleted' }; // read under another key (M3): the row as it was read is gone
      const { keys, version } = at;
      const w = written(t, values);
      if ('errors' in w) return { ok: false, errors: w.errors };
      const set = w.cols.map((fd, i) => `${pgIdent(fd.name)} = $${keys.length + i + 1}`).join(', ');
      const xmin = `xmin = $${keys.length + w.cols.length + 1}::xid`;
      // nothing to write: the version checked only (UPDATE … SET k = k would refuse a GENERATED ALWAYS key)
      const sql = set ? `UPDATE ${tableSql(t)} SET ${set} WHERE ${where(t)} AND ${xmin} RETURNING ${outputs(t)}`
        : `SELECT ${outputs(t)} FROM ${tableSql(t)} WHERE ${where(t)} AND ${xmin}`;
      return write(t, w.cols, async (): Promise<RemoteWrite | RemoteConflict> => {
        const [row] = await exec(sql, [...keys, ...w.cols.map((fd) => sent(values[fd.name]!, fd.props.type === 'yesNo')), version]);
        if (row) return { ok: true, ...decoded(t, row) };
        const [now] = await exec(`SELECT ${outputs(t)} FROM ${tableSql(t)} WHERE ${where(t)}`, keys); // F12: absent, or its new token
        if (!now) return { ok: false, conflict: 'deleted' };
        const d = decoded(t, now);
        if (d.ref === ref) throw notWritten(t); // same version: the server skipped the row (a changed conflict would loop)
        return { ok: false, conflict: 'changed', current: d.values, ref: d.ref! };
      });
    },
    async delete(t, refs): Promise<DeleteResult> { // by key only: deletes are not checked (R8)
      if (!t.key.length) throw new Error('bc:invalidArgument');
      const keys = refs.map((r) => parseRowToken(r, t.key)?.keys ?? stale());
      const chunks = Array.from({ length: Math.ceil(keys.length / DELETE_CHUNK) }, (_, i) => keys.slice(i * DELETE_CHUNK, (i + 1) * DELETE_CHUNK));
      const cols = t.key.map(pgIdent).join(', ');
      // one statement is its own transaction; inside transaction() (C7 R14) its own: a COMMIT here would end it
      const many = chunks.length > 1 && !inTransaction;
      let count = 0;
      try {
        if (many) await exec('BEGIN');
        for (const ks of chunks) {
          const tuples = ks.map((k, i) => `(${k.map((_, j) => `$${i * t.key.length + j + 1}`).join(', ')})`).join(', ');
          count += (await exec(`DELETE FROM ${tableSql(t)} WHERE (${cols}) IN (${tuples}) RETURNING 1`, ks.flat())).length;
        }
        if (many) await exec('COMMIT');
      } catch (e) {
        if (many && !(e as { lost?: unknown }).lost) await rollback(e);
        const x = ((e as Error).cause ?? {}) as PgError;
        if (x.code !== '23503') throw e;
        return { ok: false, reason: 'related', ...(x.table && { table: x.table }) }; // the referencing table's server name
      }
      return { ok: true, count };
    },
    async find(t, where, limit, lock) {
      const c = findCondition(t, where, collation, 1);
      const rs = await exec(`SELECT ${outputs(t)} FROM ${tableSql(t)} WHERE ${c.sql} LIMIT $${c.params.length + 1}${lock ? ' FOR UPDATE' : ''}`, [...planValues(c), limit]);
      return rs.map((r) => decoded(t, r));
    },
    async transaction(fn) {
      await exec('BEGIN');
      inTransaction = true;
      try {
        const r = await fn();
        await exec('COMMIT');
        return r;
      } catch (e) {
        if (!(e as { lost?: unknown }).lost) await rollback(e); // lost: the server rolled it back
        throw neverUnsent(e);
      } finally {
        inTransaction = false;
      }
    },
    async cancel() {
      if (!running || cl.processID === null || cl.secretKey === null) return false;
      cancelled = running;
      sendCancel(p, cl.processID, cl.secretKey);
      return true;
    },
    // C6 R5, R6: simple protocol (no values), the text as typed; the first result with columns is the records.
    async native(sql) {
      const rs = await query(sql);
      const first = rs.find((r) => r.fields?.length);
      const columns = (first?.fields ?? []).map((f) => ({ name: f.name, props: ptProps(f.dataTypeID, f.dataTypeModifier) }));
      return {
        columns, affected: rs.reduce((n, r) => n + (r.rowCount ?? 0), 0),
        rows: (first?.rows ?? []).map((r) => columns.map((d, k) => pgDecode(d, r[k]))),
      };
    },
    schema: { // C7 R18: inside transaction() (PostgreSQL's DDL is transactional), but dropTables
      limits: { nameMax: 63, unit: 'utf8', params: 65535 },
      columnType: pgColumnType,
      async names(schema) {
        const [row] = await exec(SCHEMA_NAMES, [schema]);
        return row ? JSON.parse(String(row[0])) as string[] : null;
      },
      async createTable(t) { await exec(pgCreateTable(t)); },
      async insertRows(t, rows) {
        if (!rows.length) return;
        const { sql, casts } = pgInsertRows(t, rows.length);
        await exec(sql, rows.flatMap((r) => r.map((v, i) => sent(v, casts[i] === 'boolean'))));
      },
      async finishTable(t) { for (const sql of pgFinishTable(t)) await exec(sql); },
      countRows: async (t) => Number((await exec(`SELECT count(*) FROM ${pgIdent(t.schema)}.${pgIdent(t.name)}`))[0]![0]),
      async addForeignKeys(fks) {
        for (const fk of fks) await exec(pgForeignKey(fk)).catch((e) => { throw Object.assign(e as Error, { table: fk.child }); });
        return fks;
      },
      async dropTables(tables) { // the last created first; CASCADE drops the foreign keys that name it
        const left: string[] = [];
        for (const t of [...tables].reverse()) await exec(`DROP TABLE IF EXISTS ${pgIdent(t.schema)}.${pgIdent(t.name)} CASCADE`).catch(() => left.push(t.name));
        return left;
      },
    },
    close: () => cl.end(),
  };
}
