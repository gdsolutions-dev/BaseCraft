// The shared remote path (C4 R5, R7, R8, R9): a bound query on a server source becomes a ReadRequest of trees and values — never
// SQL — that its connector plans and runs on the source's connection; a write runs the write layer's checks (prepareWrite, then
// C7 R12's rules and Limit To List), then its connector. A query writing several tables writes them in one server transaction
// (C5 R16).
import type { DeleteResult, QueryRef, RowRef, RowWriteResult } from '../../shared/api';
import type { CellInput, SqlValue } from '../../shared/coerce';
import { bracket } from '../../shared/expr/lexer';
import { parseCanonical } from '../../shared/expr/parser';
import type { Expr } from '../../shared/expr/ast';
import { fromStored } from '../../shared/expr/evaluate';
import { literalOf } from '../../shared/expr/members';
import { accessColumns, lookupOf, sameName, type FieldDef, type TableDesign, type TableLookup } from '../../shared/field-types';
import type { LocaleInfo } from '../../shared/locale-format';
import { toSourceInfo, type BoundQuery } from '../../shared/query/bind';
import { writableColumn, type SourcePage, type SourcePageRequest, type SourceSaveRequest, type SourceSaveResult } from '../../shared/record-source';
import { checkRecordRule, checkRules } from '../db/rules';
import { inList, prepareWrite, type PreparedWrite, type WriteOptions } from '../db/write-layer';
import { linkValues, planRequest } from '../query/join-write';
import { paramValues, rowSourceRef, type QueryConn } from '../query/source';
import type { Capabilities, Connection, FieldError, ReadRequest, RemoteConflict, RemoteTable, RemoteWrite } from './connector';
import type { RemoteSources } from './remote-sources';

export interface RemoteCtx { remote: RemoteSources; qc: QueryConn; info: LocaleInfo; now: () => Date;
  /** R12: whether `ref`'s output column `column` holds `value` (a one-row page, local or server). */
  hasValue(ref: QueryRef, column: number, value: SqlValue): Promise<boolean> }

/** A server table read as a query (as noRowidLink reads a table without rowids). */
export const remoteTableRef = (name: string): QueryRef => ({ kind: 'sql', sql: `SELECT * FROM ${bracket(name)}` });

const tree = (text: string, criteria: boolean): Expr => {
  try {
    return parseCanonical(text, { criteria });
  } catch (e) {
    throw new Error('bc:invalidArgument', { cause: e });
  }
};

/** The request of a bound query, its page filters as trees (unknown field: bc:notFound; a criterion that does not parse:
 *  bc:invalidArgument, as pageSource's contract). */
export function readRequest(ctx: RemoteCtx, b: BoundQuery, req: SourcePageRequest): ReadRequest {
  const server = ctx.qc.remote?.(b.source);
  if (!server) throw new Error('bc:invalidArgument'); // a caller routes only server sources here
  const column = (field: string) => {
    const k = b.columns.findIndex((c) => sameName(c.name, field));
    if (k < 0) throw new Error('bc:notFound');
    return k;
  };
  const sort = (req.sort ?? []).map((s) => ({ column: column(s.field), dir: s.dir }));
  const filter = (req.filter ?? []).map((f) => ({ column: column(f.field), criteria: tree(f.criteria, true) }));
  return {
    query: b, values: paramValues(b, req.params ?? {}, ctx.info), filter, sort, refs: b.updatable,
    ...(req.where !== undefined ? { where: tree(req.where, false) } : {}),
    tables: (name) => server.table(name), now: ctx.now(),
  };
}

/** A page of a bound query on a server source: planned and run on its connection (a lost connection: once more, R11); `limit`
 *  0 counts only. `rowids`: the connector's row references, null when read-only. `withTotal` false (a table page, whose
 *  datasheet asks `count` itself): no count sent, `total` NaN. */
export async function remotePageSource(ctx: RemoteCtx, b: BoundQuery, req: SourcePageRequest, withTotal = true): Promise<SourcePage> {
  const r = readRequest(ctx, b, req);
  return ctx.remote.run(b.source, async (c) => {
    const plan = c.plan(r);
    const total = withTotal ? await c.count(plan) : NaN;
    if (req.limit === 0) return { rows: [], rowids: [], total };
    const { rows, refs } = await c.rows(plan, req.offset, req.limit);
    return { rows, rowids: refs, total };
  }, true);
}

/** R8: what the connector compares. 'rowVersion': nothing (the reference carries the version); 'values': the expected values of
 *  the fields Access compares at save (not Single, Double or Long Text), by design name. */
export function comparable(design: TableDesign, expected: Record<string, SqlValue> | undefined, c: Capabilities): Record<string, SqlValue> | undefined {
  if (c.conflict === 'rowVersion' || !expected) return undefined;
  return Object.fromEntries(Object.entries(expected).flatMap(([k, v]) => {
    const fd = design.fields.find((x) => sameName(x.name, k));
    const inexact = fd?.props.type === 'longText' || fd?.props.type === 'hyperlink' || (fd?.props.type === 'number' && (fd.props.numberSize === 'single' || fd.props.numberSize === 'double'));
    return fd && !inexact ? [[fd.name, v]] : [];
  }));
}

/** C7 R12: whether output column `column` of `b`, a query on a server source, holds `value` (Limit To List): a one-row page whose
 *  `where` is `[column] = value`, compared as the connector's generator compares. */
export async function remoteHasValue(ctx: RemoteCtx, b: BoundQuery, column: number, value: SqlValue): Promise<boolean> {
  const col = Number.isSafeInteger(column) ? b.columns[column] : undefined;
  if (!col) throw new Error('bc:invalidArgument');
  // a Decimal's stored text is the literal itself: through a double, more than 15 digits would compare wrong
  const dec = col.props.type === 'number' && col.props.numberSize === 'decimal' && typeof value === 'string' ? /^(-?)(\d+(?:\.\d+)?)$/.exec(value.trim()) : null;
  const lit: Expr = dec ? (dec[1] ? { k: 'un', op: '-', e: { k: 'num', v: dec[2]! } } : { k: 'num', v: dec[2]! }) : literalOf(fromStored({ name: col.name, props: col.props }, value));
  const where: Expr = { k: 'bin', op: '=', l: { k: 'id', name: col.name }, r: lit };
  const r = { ...readRequest(ctx, b, { offset: 0, limit: 1 }), refs: false, where };
  return ctx.remote.run(b.source, async (c) => (await c.rows(c.plan(r), 0, 1)).rows.length > 0, true);
}

/** A Row Source that does not run checks nothing and lists nothing, as rows.ts's degraded; a Stop, a timeout, a lost connection
 *  or a source that cannot be reached is no such Row Source: it stops the caller. */
export async function degradedSource<T>(fn: () => Promise<T>, fallback: T, inTransaction = false): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    // in a transaction any server error stops the save with its own message: PostgreSQL has aborted the transaction
    const fatal = inTransaction ? /^bc:(cancelled|timeout|linkUnavailable|serverError)\b/ : /^bc:(cancelled|timeout|linkUnavailable|serverError\|connection)\b/;
    if (e instanceof Error && /^bc:\w/.test(e.message) && !fatal.test(e.message)) return fallback;
    throw e;
  }
}
/** The names of the fields of `table` as the front-end resolves it (a local table or a link); undefined when it is gone. */
export function fieldNames(qc: QueryConn, table: string): string[] | undefined {
  try {
    return qc.catalog.table(table.trim())?.fields.map((x) => x.name);
  } catch (e) {
    if (e instanceof Error && /^bc:\w/.test(e.message)) return undefined;
    throw e;
  }
}
/** C7 R12: a table lookup's Row Source as the front-end resolves it: SQL or a saved query as itself, a table (local or a link)
 *  as `SELECT *` over it (`table`: its list is sorted on its first visible column), `lookup` with Access columns
 *  (accessColumns); undefined when the table is gone. */
export function rowSourceOf(qc: QueryConn, l: TableLookup): { ref: QueryRef; lookup: TableLookup; table: boolean } | undefined {
  const ref = rowSourceRef(qc.front, l.table);
  if (ref && ref.kind !== 'table') return { ref, lookup: l, table: false };
  const name = ref?.name ?? l.table.trim();
  const names = fieldNames(qc, name);
  const lookup = names && accessColumns(l, names);
  return lookup && { ref: remoteTableRef(name), lookup, table: true };
}

/** R12: Limit To List of `cols` on a server table (enforceMask), as notInList: a value list or a Field List (inList), else the
 *  Row Source's bound column through ctx.hasValue. */
async function unlisted(ctx: RemoteCtx, cols: { fd: FieldDef; value: SqlValue }[], inTransaction: boolean): Promise<FieldError[]> {
  const errors: FieldError[] = [];
  for (const { fd, value } of cols) {
    const l = lookupOf(fd);
    if (!l?.limitToList || value === null) continue;
    let found = inList(fd, l, value, (t) => fieldNames(ctx.qc, t));
    if (found === undefined && l.kind === 'table') {
      found = await degradedSource(async () => {
        const src = rowSourceOf(ctx.qc, l);
        return !src || ctx.hasValue(src.ref, (src.lookup.boundColumn ?? 1) - 1, value);
      }, true, inTransaction);
    }
    if (!found) errors.push({ field: fd.name, code: 'notInList' });
  }
  return errors;
}
/**
 * R12: what insertRow and updateRow check after prepareWrite, on a server table: Limit To List (enforceMask; an insert's fields
 * given, an update's prepared), then the rules of every field (insert: a Yes/No absent counted as 0, as the local insert fills
 * it) or of the changed ones, then an insert's record rule. An update's record rule reads the server's row (recordRule).
 */
async function remoteChecks(ctx: RemoteCtx, kind: 'insert' | 'update', design: TableDesign, p: Extract<PreparedWrite, { ok: true }>, given: Record<string, CellInput>, opts: WriteOptions, inTransaction = false): Promise<FieldError[]> {
  if (opts.enforceMask) {
    const errors = await unlisted(ctx, kind === 'insert' ? p.cols.filter((c) => Object.hasOwn(given, c.fd.name)) : p.cols, inTransaction);
    if (errors.length) return errors;
  }
  const stored = { ...p.values };
  if (kind === 'insert') for (const fd of design.fields) if (fd.props.type === 'yesNo' && !Object.hasOwn(stored, fd.name)) stored[fd.name] = 0;
  const broken = await checkRules(design, stored, kind === 'insert' ? design.fields.map((x) => x.name) : Object.keys(given), ctx.now, ctx.info);
  if (broken.length) return broken;
  const record = kind === 'insert' ? await checkRecordRule(design, stored, ctx.now, ctx.info) : null;
  return record ? [record] : [];
}
/** R12: an update's record rule against the server's row (`current`, design order) with its changes. */
async function recordRule(ctx: RemoteCtx, t: RemoteTable, current: SqlValue[], values: Record<string, SqlValue>): Promise<FieldError[]> {
  const row = { ...Object.fromEntries(t.design.fields.map((x, i) => [x.name, current[i] ?? null])), ...values };
  const r = await checkRecordRule(t.design, row, ctx.now, ctx.info);
  return r ? [r] : [];
}
/** A server row's reference is its connector's token; a local rowid (or NaN, a read-only row) is refused. */
const token = (ref: RowRef): string => {
  if (typeof ref !== 'string') throw new Error('bc:invalidArgument');
  return ref;
};
/** The connector's answer as the write layer's: `ref` → `rowid` (null → NaN: the server row has no key); a referencing table
 *  by its link name (the message the user reads). */
const written = (ctx: RemoteCtx, sourceId: string, r: RemoteWrite | RemoteConflict, nulled: PreparedNulled): RowWriteResult => {
  if (r.ok) return { ok: true, rowid: r.ref ?? NaN, values: r.values, ...(nulled.length && { nulled }) };
  if ('conflict' in r && r.conflict === 'changed') return { ok: false, conflict: 'changed', current: r.current, rowid: r.ref };
  if ('errors' in r) return { ok: false, errors: r.errors.map((e) => (e.table === undefined ? e : { ...e, table: ctx.remote.linkName(sourceId, e.table) })) };
  return r;
};
type PreparedNulled = Extract<PreparedWrite, { ok: true }>['nulled'];

/** prepareWrite, then R12's checks: the write ready to send, or the front-end's refusal. */
async function checked(ctx: RemoteCtx, kind: 'insert' | 'update', design: TableDesign, values: Record<string, CellInput>, opts: WriteOptions, inTransaction = false) {
  const p = await prepareWrite(kind, design, values, ctx.info, ctx.now, opts);
  if (!p.ok) return p;
  const errors = await remoteChecks(ctx, kind, design, p, values, opts, inTransaction);
  return errors.length ? { ok: false as const, errors } : p;
}
/** C7 R14: a write inside the caller's transaction; `byServer`: `r` is the connector's answer (a refusal there is the server's). */
export type SentWrite = { r: RowWriteResult; byServer: boolean };

/** An insert on a server table: the fields given and the front-end's defaults are sent (the server fills its own); never a
 *  conflict. */
export async function remoteInsert(ctx: RemoteCtx, sourceId: string, t: RemoteTable, values: Record<string, CellInput>, opts: WriteOptions): Promise<RowWriteResult> {
  const p = await checked(ctx, 'insert', t.design, values, opts);
  if (!p.ok) return p;
  return written(ctx, sourceId, await ctx.remote.run(sourceId, (c) => c.insert(t, p.values), false), p.nulled);
}
/** remoteInsert's body on `c`, inside the caller's transaction (C7 R14). */
export async function remoteInsertOn(ctx: RemoteCtx, c: Connection, sourceId: string, t: RemoteTable, values: Record<string, CellInput>, opts: WriteOptions): Promise<SentWrite> {
  const p = await checked(ctx, 'insert', t.design, values, opts, true);
  if (!p.ok) return { r: p, byServer: false };
  return { r: written(ctx, sourceId, await c.insert(t, p.values), p.nulled), byServer: true };
}

/** R12: the update of `at` on `c`; a table rule: the row read by a check-only update (a conflict returns as today), the rule
 *  checked on it with the changes (Refused: nothing written), then the update with the same reference and `expected`. */
async function sendUpdate(ctx: RemoteCtx, c: Connection, caps: Capabilities, t: RemoteTable, at: string, values: Record<string, SqlValue>, opts: WriteOptions) {
  const expected = comparable(t.design, opts.expected, caps);
  if (!t.design.validationRule) return c.update(t, at, values, expected);
  const row = await c.update(t, at, {}, expected);
  if (!row.ok) return row;
  const broken = await recordRule(ctx, t, row.values, values);
  if (broken.length) throw new Refused(broken);
  return c.update(t, at, values, expected);
}
/** An update of the server row `ref`; `opts.expected` reaches the connector as its capability asks (R8). A table rule (R12): in
 *  one server transaction (sendUpdate). */
export async function remoteUpdate(ctx: RemoteCtx, sourceId: string, t: RemoteTable, ref: RowRef, changes: Record<string, CellInput>, opts: WriteOptions): Promise<RowWriteResult> {
  const at = token(ref);
  const p = await checked(ctx, 'update', t.design, changes, opts);
  if (!p.ok) return p;
  try {
    return written(ctx, sourceId, await ctx.remote.run(sourceId, async (c, caps) => {
      const save = () => sendUpdate(ctx, c, caps, t, at, p.values, opts);
      // without transactions: the reference still guards the write
      return t.design.validationRule && caps.transactions ? c.transaction(save) : save();
    }, false), p.nulled);
  } catch (e) {
    if (e instanceof Refused) return { ok: false, errors: e.errors }; // rolled back: nothing was written
    throw e;
  }
}
/** remoteUpdate's body on `c`, inside the caller's transaction (C7 R14). */
export async function remoteUpdateOn(ctx: RemoteCtx, c: Connection, caps: Capabilities, sourceId: string, t: RemoteTable, ref: RowRef, changes: Record<string, CellInput>, opts: WriteOptions): Promise<SentWrite> {
  const at = token(ref);
  const p = await checked(ctx, 'update', t.design, changes, opts, true);
  if (!p.ok) return { r: p, byServer: false };
  try {
    return { r: written(ctx, sourceId, await sendUpdate(ctx, c, caps, t, at, p.values, opts), p.nulled), byServer: true };
  } catch (e) {
    if (e instanceof Refused) return { r: { ok: false, errors: e.errors }, byServer: false }; // the table rule: nothing written
    throw e;
  }
}

export async function remoteDelete(ctx: RemoteCtx, sourceId: string, t: RemoteTable, refs: RowRef[]): Promise<DeleteResult> {
  const tokens = refs.map(token);
  return ctx.remote.run(sourceId, (c) => remoteDeleteOn(ctx, c, sourceId, t, tokens), false);
}
/** remoteDelete's body on `c` (C7 R14: inside the caller's transaction): a referencing table by its link name. */
export async function remoteDeleteOn(ctx: RemoteCtx, c: Connection, sourceId: string, t: RemoteTable, tokens: string[]): Promise<DeleteResult> {
  const r = await c.delete(t, tokens);
  return r.ok || r.table === undefined ? r : { ...r, table: ctx.remote.linkName(sourceId, r.table) };
}

/** R9: a record of a query on a server source, saved by origin into its one written table (as saveSourceRow's key table: a
 *  column that is not writable refuses readOnly, nothing sent). A query writing several tables: joinSave (C5 R16). */
export async function remoteSaveSource(ctx: RemoteCtx, b: BoundQuery, req: SourceSaveRequest, opts: WriteOptions): Promise<SourceSaveResult> {
  const server = ctx.qc.remote?.(b.source);
  if (!server) throw new Error('bc:invalidArgument'); // a caller routes only server sources here
  if (!b.updatable || !b.writePlan) return { ok: false, errors: [{ field: b.columns[0]?.name ?? '', code: 'readOnly' }] };
  if (b.writePlan.length > 1) return joinSave(ctx, b, server, req, opts);
  const t = server.table(b.writePlan[0]!.table);
  const src = toSourceInfo(b);
  const names = Object.keys(req.values);
  const refused = names.filter((n) => !writableColumn(src, n));
  if (refused.length) return { ok: false, errors: refused.map((field) => ({ field, code: 'readOnly' as const })) };
  /** The table's field of output column `name` (none: a computed column). */
  const fieldOf = (name: string): string | undefined => {
    const o = b.columns.find((c) => sameName(c.name, name))?.origin;
    return o && sameName(o.table, t.name) ? o.field : undefined;
  };
  const byField = <V>(byColumn: Record<string, V>): Record<string, V> => Object.fromEntries(Object.entries(byColumn).flatMap(([k, v]) => {
    const fd = fieldOf(k);
    return fd === undefined ? [] : [[fd, v]];
  }));
  const byColumn = (row: SqlValue[]): Record<string, SqlValue> => Object.fromEntries(b.columns.flatMap((c) => {
    const i = c.origin && sameName(c.origin.table, t.name) ? t.design.fields.findIndex((x) => sameName(x.name, c.origin!.field)) : -1;
    return i < 0 ? [] : [[c.name, row[i] ?? null]];
  }));
  /** A field error under its output column: the request's first, else the query's, else the field. */
  const column = (field: string): string => names.find((n) => sameName(fieldOf(n) ?? '', field))
    ?? b.columns.find((c) => sameName(fieldOf(c.name) ?? '', field))?.name ?? field;
  const r = req.rowid === null ? await remoteInsert(ctx, b.source, t, byField(req.values), opts)
    : await remoteUpdate(ctx, b.source, t, req.rowid, byField(req.values), { ...opts, ...(req.expected && { expected: byField(req.expected) }) });
  if (r.ok) return { ok: true, rowid: r.rowid, values: byColumn(r.values) };
  if ('errors' in r) return { ok: false, errors: r.errors.map((e) => ({ ...e, field: column(e.field) })) };
  return r.conflict === 'changed' ? { ...r, current: byColumn(r.current) } : r;
}

/** R16: a row found by find(), or none (null), or several ('ambiguous'). */
type Found = { values: SqlValue[]; ref: string | null } | null | 'ambiguous';
/** A refusal inside the save's transaction (B4's): it rolls every table back and carries its errors out. */
class Refused extends Error { constructor(readonly errors: FieldError[]) { super('refused'); } }
/** A conflict of plan table `at` inside the save's transaction: it rolls every table back too. */
class Conflict extends Error { constructor(readonly at: number, readonly c: RemoteConflict) { super('conflict'); } }
const indexOf = (t: RemoteTable, field: string): number => t.design.fields.findIndex((x) => sameName(x.name, field));
const nameOf = (t: RemoteTable, field: string): string => t.design.fields[indexOf(t, field)]?.name ?? field;

/** R16, B4 R3: "one" table `w`'s row whose join fields equal the child values `child`, find(…, 2, lock): none (a Null never
 *  joins: not asked) null, two 'ambiguous' (never a guess). */
async function lookUp(c: Connection, w: NonNullable<BoundQuery['writePlan']>[number], t: RemoteTable, child: SqlValue[], lock: boolean): Promise<Found> {
  if (child.some((v) => v === null)) return null;
  const rs = await c.find(t, Object.fromEntries(w.parent!.pairs.map((p, k) => [nameOf(t, p.field), child[k]!])), 2, lock);
  return rs.length === 1 ? rs[0]! : rs.length ? 'ambiguous' : null;
}

/**
 * R16: a record of a query writing several tables of a server source (B4's saveSourceRow on the connector), in one server
 * transaction: the key row as a single-table save writes it (inserted, or updated, its own check; no values: checked only), then
 * each "one" table with values on its row found by its join pairs from the row written before it (a chain: each after the one
 * it is looked up from), locked (none: noParent; two: readOnly; `table` set), its comparable values as read compared with the
 * locked row (no token was read for it: by values, whatever the connector's conflict mode; a mismatch: changed), then
 * updated by the found row's token. Any refusal or conflict rolls everything back; after a conflict `current` is read again
 * (the key row checked only). `values`: every plan table's output columns as the transaction leaves them. Without
 * capabilities.transactions: bc:serverNotSupported|joinSave|<kind>.
 */
async function joinSave(ctx: RemoteCtx, b: BoundQuery, server: { kind: string; table(name: string): RemoteTable }, req: SourceSaveRequest, opts: WriteOptions): Promise<SourceSaveResult> {
  const plan = b.writePlan!, tables = plan.map((w) => server.table(w.table));
  const { refused, valuesOf, mapped, expectedOf, first } = planRequest(b, req);
  if (refused.length) return { ok: false, errors: refused.map((field) => ({ field, code: 'readOnly' as const })) };
  const keyRef = req.rowid === null ? null : token(req.rowid);
  const viaOf = (i: number) => plan.findIndex((x) => x.alias === plan[i]!.parent!.via);
  // the "one" tables found inside the transaction, locked: those with values and those on the way to one (a chain's link)
  const needed = plan.map((_, i) => i > 0 && Object.keys(valuesOf(i)).length > 0);
  for (let i = plan.length - 1; i > 0; i--) if (needed[i]) needed[viaOf(i)] = true;
  /** Plan table i's row from its via's row in `rows`. */
  const locate = (c: Connection, rows: Found[], i: number, lock: boolean): Promise<Found> => {
    const via = rows[viaOf(i)]!, vt = tables[viaOf(i)]!;
    if (via === null || via === 'ambiguous') return Promise.resolve(via);
    return lookUp(c, plan[i]!, tables[i]!, plan[i]!.parent!.pairs.map((p) => via.values[indexOf(vt, p.child)] ?? null), lock);
  };
  /** `rows` completed: every plan table not found yet, unlocked. */
  const completed = async (c: Connection, rows: Found[]): Promise<Found[]> => {
    for (let i = 1; i < plan.length; i++) if (rows[i] === undefined) rows[i] = await locate(c, rows, i, false);
    return rows;
  };
  /** Every plan table's output columns (an ambiguous row's left out, as B4's readValues). */
  const outputs = (rows: Found[]): Record<string, SqlValue> => Object.fromEntries(b.columns.flatMap((col) => {
    const i = plan.findIndex((w) => col.origin !== undefined && sameName(col.origin.table, w.table)), r = rows[i];
    return i < 0 || r === undefined || r === 'ambiguous' ? [] : [[col.name, r === null ? null : r.values[indexOf(tables[i]!, col.origin!.field)] ?? null]];
  }));
  /** A connector's refusal of table i under output columns, a referencing table by its link name. */
  const refusedBy = (i: number, errors: FieldError[]) => new Refused(mapped(i, errors.map((e) => (e.table === undefined ? e : { ...e, table: ctx.remote.linkName(b.source, e.table) }))));
  /** R12: a refusal of plan table i's checks, under output columns. */
  const refuse = (i: number, errors: FieldError[]): void => { if (errors.length) throw new Refused(mapped(i, errors)); };
  const rowOf = (i: number, r: RemoteWrite | RemoteConflict): Found => {
    if (r.ok) return { values: r.values, ref: r.ref };
    throw 'errors' in r ? refusedBy(i, r.errors) : new Conflict(i, r);
  };

  const saved = await ctx.remote.run(b.source, async (c, caps): Promise<SourceSaveResult | Conflict> => {
    if (!caps.transactions) throw new Error(`bc:serverNotSupported|joinSave|${server.kind}`);
    try {
      const rows = await c.transaction(async () => {
        // the key row first, written or checked: gone or changed, no "one" table is written through it (B4 R8)
        const t0 = tables[0]!, kind = keyRef === null ? 'insert' : 'update';
        const kp = await prepareWrite(kind, t0.design, valuesOf(0), ctx.info, ctx.now, opts);
        if (!kp.ok) throw new Refused(mapped(0, kp.errors));
        refuse(0, await remoteChecks(ctx, kind, t0.design, kp, valuesOf(0), opts, true));
        const expected0 = comparable(t0.design, expectedOf(0), caps);
        if (keyRef !== null && t0.design.validationRule) { // R12: the key row as the server holds it (checked only), then the rule
          const current = rowOf(0, await c.update(t0, keyRef, {}, expected0)) as { values: SqlValue[] };
          refuse(0, await recordRule(ctx, t0, current.values, kp.values));
        }
        const rows: Found[] = [rowOf(0, keyRef === null ? await c.insert(t0, kp.values) : await c.update(t0, keyRef, kp.values, expected0))];
        for (let i = 1; i < plan.length; i++) {
          if (!needed[i]) continue;
          const found = rows[i] = await locate(c, rows, i, true);
          const values = valuesOf(i);
          if (!Object.keys(values).length) continue;
          if (found === null) throw new Refused([{ field: first(i), code: 'noParent', table: plan[i]!.table }]);
          if (found === 'ambiguous' || found.ref === null) throw new Refused([{ field: first(i), code: 'readOnly', table: plan[i]!.table }]);
          const expected = comparable(tables[i]!.design, expectedOf(i), { ...caps, conflict: 'values' }) ?? {};
          if (Object.entries(expected).some(([f, v]) => found.values[indexOf(tables[i]!, f)] !== v)) throw new Conflict(i, { ok: false, conflict: 'changed', current: found.values, ref: found.ref });
          const p = await prepareWrite('update', tables[i]!.design, values, ctx.info, ctx.now, opts);
          if (!p.ok) throw new Refused(mapped(i, p.errors));
          refuse(i, await remoteChecks(ctx, 'update', tables[i]!.design, p, values, opts, true));
          refuse(i, await recordRule(ctx, tables[i]!, found.values, p.values)); // R12: on the row as locked
          rows[i] = rowOf(i, await c.update(tables[i]!, found.ref, p.values));
        }
        return completed(c, rows);
      });
      return { ok: true, rowid: (rows[0] as { ref: string | null }).ref ?? NaN, values: outputs(rows) };
    } catch (e) {
      if (e instanceof Refused) return { ok: false, errors: e.errors };
      if (e instanceof Conflict) return e;
      throw e;
    }
  }, false);
  if (!(saved instanceof Conflict)) return saved;
  const e = saved;
  if (e.at === 0 && e.c.conflict === 'deleted') return { ok: false, conflict: 'deleted' };
  // rolled back, so read again as a read of its own (final review 4): a lost connection reconnects once, and lost again is
  // cannotConnect, never "outcome unknown". The key row as it is now (its own conflict's `current`, else checked only), the
  // "one" rows found from it.
  return ctx.remote.run(b.source, async (c): Promise<SourceSaveResult> => {
    const k = e.at === 0 ? e.c : keyRef === null ? null : await c.update(tables[0]!, keyRef, {});
    let key: Found = null; // an insert rolled back has no row
    if (k?.ok) key = { values: k.values, ref: k.ref };
    else if (k && 'conflict' in k) {
      if (k.conflict === 'deleted') return { ok: false, conflict: 'deleted' };
      key = { values: k.current, ref: k.ref };
    }
    const rows = await completed(c, [key]);
    return { ok: false, conflict: 'changed', current: outputs(rows), ...(key?.ref != null && { rowid: key.ref }) };
  }, true);
}

/** R16, B4 R4 on a server: each "one" table, in plan order, looked up from its link's child values (linkValues) by
 *  find(…, 2, false); none or two: Nulls. Returns every output column of each looked-up table. Reads only; a query writing one
 *  table looks nothing up (never connects). */
export async function remoteAutoLookup(ctx: RemoteCtx, b: BoundQuery, values: Record<string, CellInput>): Promise<Record<string, SqlValue>> {
  const server = ctx.qc.remote?.(b.source);
  if (!server) throw new Error('bc:invalidArgument'); // a caller routes only server sources here
  if (!b.updatable || !b.writePlan || b.writePlan.length < 2) return {};
  const plan = b.writePlan;
  return ctx.remote.run(b.source, async (c) => {
    const found = new Map<string, Record<string, SqlValue> | null>(); // by alias: the parent's fields, null when none
    const out: [string, SqlValue][] = [];
    for (const w of plan.slice(1)) {
      const child = linkValues(b, w, values, ctx.info, found);
      if (!child) continue;
      const t = server.table(w.table), r = await lookUp(c, w, t, child, false);
      const row = r === null || r === 'ambiguous' ? null : Object.fromEntries(t.design.fields.map((x, i) => [x.name, r.values[i] ?? null]));
      found.set(w.alias, row);
      for (const col of b.columns) if (col.origin && sameName(col.origin.table, w.table)) out.push([col.name, row?.[col.origin.field] ?? null]);
    }
    return Object.fromEntries(out);
  }, true);
}
