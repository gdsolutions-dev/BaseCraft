// The server connector interface (C4 R3). Nothing here assumes SQL, rowids or sockets (transactions only through
// capabilities.transactions, C5 R16): the shared layer passes trees and values, a connector alone makes engine text (or HTTP
// requests) and reads its own row tokens back.
import type { DeleteResult, RowWriteResult, ServerKind } from '../../shared/api';
import type { SqlValue } from '../../shared/coerce';
import type { Expr } from '../../shared/expr/ast';
import { validateDesign, type FieldDef, type FieldProps, type TableDesign } from '../../shared/field-types';
import type { BoundQuery } from '../../shared/query/bind';
import type { NameLimits, ServerForeignKey, ServerTable } from '../migrate/plan';

export { isServerKind, type ServerKind } from '../../shared/api'; // shared with the renderer; never in registry.ts (R1)
/** passThrough: C6. conflict (R8): 'rowVersion' = the token carries a version the connector checks; 'values' = the connector
 *  compares the expected values. transactions: several writes as one unit. migrate: C7 R18, Connection.schema. */
export interface Capabilities { readonly passThrough: boolean; readonly conflict: 'rowVersion' | 'values'; readonly transactions: boolean; readonly migrate: boolean }
export interface Credentials { user: string; password: string }
/** Node's TLS verification codes: a connect failure with one of them is `certificate|<label>` (C4 R11, C5 R3), never cannotConnect. */
export const CERTIFICATE_ERRORS: ReadonlySet<string> = new Set(['UNABLE_TO_VERIFY_LEAF_SIGNATURE', 'SELF_SIGNED_CERT_IN_CHAIN', 'DEPTH_ZERO_SELF_SIGNED_CERT',
  'ERR_TLS_CERT_ALTNAME_INVALID', 'CERT_HAS_EXPIRED', 'UNABLE_TO_GET_ISSUER_CERT_LOCALLY', 'CERT_NOT_YET_VALID']);
/** A linked server table as the front-end caches it (R6). `remote`: what the connector reads back (PostgreSQL: the table name;
 *  `schema` beside it); `key`: field names, [] = read-only. */
export interface RemoteTable { name: string /* link name */; remote: string; schema?: string; design: TableDesign; key: string[]; skipped: string[]; unsupported?: string; version?: string /* C5 R11: the rowversion column, never a field */ }
/** `t` linked as `name`: its design renamed and `unsupported` read again for that name (validateDesign's first refusal). */
export function linkedAs(t: RemoteTable, name: string): RemoteTable {
  const { unsupported: _unsupported, ...rest } = t;
  const design = { ...t.design, name };
  const bad = validateDesign(design)[0];
  return { ...rest, name, design, ...(bad ? { unsupported: bad.code } : {}) };
}
export interface ReadRequest {
  query: BoundQuery; values: Record<string, SqlValue>;
  filter: { column: number; criteria: Expr }[]; // parseCanonical(criteria, { criteria: true }): `subject` = that output column
  where?: Expr; // over output column names
  sort: { column: number; dir: 'asc' | 'desc' }[];
  refs: boolean; // updatable: one RowRef per row
  tables: (linkName: string) => RemoteTable; // the bound query's table names → their remote tables
  now: Date; // Date(), Now(), Time()
}
declare const plan: unique symbol;
/** Opaque: only the connection that made it reads it. */
export type ReadPlan = { readonly [plan]: true };
/** As src/main/query/action.ts derives it (write-layer.ts's alias is private). */
export type FieldError = Extract<RowWriteResult, { errors: unknown }>['errors'][number];
export type RemoteWrite = { ok: true; ref: string | null; values: SqlValue[] /* design order, stored form */ } | { ok: false; errors: FieldError[] };
export type RemoteConflict = { ok: false; conflict: 'changed'; current: SqlValue[]; ref: string } | { ok: false; conflict: 'deleted' };
/** C6 R5, R6: a pass-through's result: the first result with columns (names as the server gave them; none: []), its rows in
 *  stored form (pgDecode), every result's rowCount summed. */
export interface NativeResult { columns: { name: string; props: FieldProps }[]; rows: SqlValue[][]; affected: number }
/** C7 R18: what the migration wizard writes, inside Connection.transaction(); text made by the connector's ddl.ts. */
export interface SchemaWriter {
  readonly limits: NameLimits & { params: number /* PostgreSQL 65535, SQL Server 2100 */ };
  /** The column type ddl.ts writes for a field of `p` (R16: the report names it for a field read back approximately). */
  columnType(p: FieldProps): string;
  /** Names of the schema's tables, views, indexes and constraints; null when the schema does not exist. */
  names(schema: string): Promise<string[] | null>;
  createTable(t: ServerTable): Promise<void>;
  /** One multi-row INSERT of `rows` (t.fields order, stored form), AutoNumber values included. A value the server refuses
   *  rejects with bc:serverError|…; SQL Server adds `field` and `code` (FieldError's: tooLong, duplicate…) when it can tell. */
  insertRows(t: ServerTable, rows: SqlValue[][]): Promise<void>;
  /** The identity restarted at t.nextId, then t.indexes created (SQL Server: a unique index over duplicates adds `field`, its
   *  first, and `code` 'duplicate' to the error). */
  finishTable(t: ServerTable): Promise<void>;
  countRows(t: ServerTable): Promise<number>;
  /** Every foreign key, as created (SQL Server: R7's downgrades applied). */
  addForeignKeys(fks: ServerForeignKey[]): Promise<ServerForeignKey[]>;
  /** Outside a transaction: the tables dropped (their foreign keys first); the names it could not drop. Receives only tables
   *  this run created and committed (R9: after a failed local switch). PostgreSQL's CASCADE also drops other clients' views on
   *  them; SQL Server drops every foreign key referencing one (another client's too) and leaves views invalid, a SCHEMABINDING
   *  view keeping its table (listed). */
  dropTables(tables: ServerTable[]): Promise<string[]>;
}
export interface Connection {
  tables(): Promise<RemoteTable[]>;
  table(t: Pick<RemoteTable, 'remote' | 'schema' | 'name'>): Promise<RemoteTable | null>;
  /** Synchronous; throws bc:serverFunction|… / bc:serverNotSupported|… before anything is sent. */
  plan(r: ReadRequest): ReadPlan;
  count(p: ReadPlan): Promise<number>;
  rows(p: ReadPlan, offset: number, limit: number): Promise<{ rows: SqlValue[][]; refs: (string | null)[] }>;
  insert(t: RemoteTable, values: Record<string, SqlValue>): Promise<RemoteWrite>;
  update(t: RemoteTable, ref: string, values: Record<string, SqlValue>, expected?: Record<string, SqlValue>): Promise<RemoteWrite | RemoteConflict>;
  delete(t: RemoteTable, refs: string[]): Promise<DeleteResult>;
  /** C5 R16: rows of `t` whose fields equal `where` (compared as the engine's generator compares: Access semantics), at most
   *  `limit`, values in design order (stored form) with their token; `lock` (inside transaction()): FOR UPDATE /
   *  WITH (UPDLOCK, ROWLOCK) until it ends. */
  find(t: RemoteTable, where: Record<string, SqlValue>, limit: number, lock: boolean): Promise<{ values: SqlValue[]; ref: string | null }[]>;
  /** fn in one server transaction: committed when it resolves, rolled back when it throws (capabilities.transactions). A
   *  connection lost inside it is never `unsent`: RemoteSources never runs it again. */
  transaction<T>(fn: () => Promise<T>): Promise<T>;
  /** C6: the text as typed, never parsed (capabilities.passThrough). */
  native?(sql: string): Promise<NativeResult>;
  /** C7 R18 (capabilities.migrate). */
  schema?: SchemaWriter;
  /** A statement running: its cancel sent, true. */
  cancel(): Promise<boolean>;
  close(): Promise<void>;
}
/** R16: find()'s `where` as a tree each connector compiles with its own generator: `[field] = [?]` per entry, joined by And;
 *  `leaf` gives each identifier's field and, for the value side, its value. */
export function equalities(t: RemoteTable, where: Record<string, SqlValue>): { cond: Expr; leaf: Map<Expr, { fd: FieldDef; value?: SqlValue }> } {
  const leaf = new Map<Expr, { fd: FieldDef; value?: SqlValue }>();
  const eqs = Object.entries(where).map(([name, value]): Expr => {
    const fd = t.design.fields.find((x) => x.name === name);
    if (!fd) throw new Error('bc:invalidArgument');
    const l: Expr = { k: 'id', name }, r: Expr = { k: 'id', name: '?' };
    leaf.set(l, { fd }).set(r, { fd, value });
    return { k: 'bin', op: '=', l, r };
  });
  if (!eqs.length) throw new Error('bc:invalidArgument');
  return { cond: eqs.reduce((l, r): Expr => ({ k: 'bin', op: 'And', l, r })), leaf };
}
/** R16: a whole number a bigint (int8) holds: find() compares a bigint key's value as one, so the column keeps its type (an
 *  index seek); beyond the range no row can match, the value keeps its decimal cast (no overflow error). */
export const fitsBigint = (v: SqlValue | undefined): boolean => {
  const s = String(v);
  return /^-?\d{1,19}$/.test(s) && BigInt(s) >= -(2n ** 63n) && BigInt(s) < 2n ** 63n;
};
/** R16: an error out of transaction() once it began: a lost connection is never `unsent` there (statements before it ran, the
 *  server rolled them back): RemoteSources reports it once and never runs the transaction again. */
export const neverUnsent = (e: unknown): unknown =>
  (e as { unsent?: unknown } | null)?.unsent === true ? Object.assign(new Error((e as Error).message, { cause: e }), { lost: true }) : e;
/** The descriptor part (`params`, `key`, `label`, `capabilities`) is pure and loads nothing; `open()` loads the driver (R1). */
export interface Connector<P = unknown> {
  readonly kind: ServerKind; readonly capabilities: Capabilities;
  params(v: unknown): P; // bc:invalidArgument
  key(p: P): string; // credentials (R10): never the user; always the TLS mode (Task 5 ruling: no password sent to a weaker mode)
  label(p: P): string; // Linked Table Manager, messages
  open(p: P, c: Credentials): Promise<Connection>; // loads its driver on first call
}
