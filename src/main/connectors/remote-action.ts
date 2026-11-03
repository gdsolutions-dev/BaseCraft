// Action queries on a server source (C7 R14): Append, Update and Delete run as A3's runAction runs them, through the remote write
// path (R12's checks, then the connector), in one server transaction. The rows are read first: INSERT … VALUES evaluated in the
// front-end, otherwise actionSelect's SELECT planned by the connector (the target's row tokens for Update and Delete).
import type { ActionResult, RunActionOptions } from '../../shared/api';
import type { CellInput, SqlValue } from '../../shared/coerce';
import { ExprRuntimeError, type Expr, type Value } from '../../shared/expr/ast';
import { evaluate, fromStored, toStored } from '../../shared/expr/evaluate';
import { fail } from '../../shared/expr/library';
import { literalOf } from '../../shared/expr/members';
import { defaultProps, sameName, type FieldDef } from '../../shared/field-types';
import type { LocaleInfo } from '../../shared/locale-format';
import { actionSelect } from '../../shared/query/action-select';
import type { BoundQuery } from '../../shared/query/bind';
import { causeOf, Refused } from '../query/action';
import { paramValues } from '../query/source';
import type { Connection, FieldError, ReadPlan, ReadRequest } from './connector';
import { remoteDeleteOn, remoteInsertOn, remoteUpdateOn, type RemoteCtx, type SentWrite } from './remote-data';

type ByCause = Extract<ActionResult, { reason: 'rowErrors' }>['byCause'];
const PAGE = 1000;

/** The action's target, its rows' read request (null for INSERT … VALUES) and its values evaluated (INSERT … VALUES). Make-Table:
 *  bc:serverNotSupported|makeTable|<kind> (resolve refuses it first); a subquery in VALUES: bc:serverNotSupported|other|<kind>. */
function prepared(ctx: RemoteCtx, b: BoundQuery, params: Record<string, CellInput>) {
  const server = ctx.qc.remote?.(b.source);
  if (!server) throw new Error('bc:invalidArgument'); // a caller routes only server sources here
  const a = actionSelect(b);
  if (a.mode === 'makeTable') throw new Error(`bc:serverNotSupported|makeTable|${server.kind}`);
  const t = server.table(a.target);
  const values = paramValues(b, params, ctx.info);
  if (a.values) {
    /** `x` with each parameter as the literal of its value (the evaluator reads no parameter). */
    const bound = (x: unknown): unknown => {
      if (Array.isArray(x)) return x.map(bound);
      if (!x || typeof x !== 'object') return x;
      const e = x as Expr, r = b.refs.get(e);
      if (e.k === 'sub' || e.k === 'inSub') throw new Error(`bc:serverNotSupported|other|${server.kind}`); // only SQL runs a subquery
      if (r?.kind === 'param') {
        const p = b.params.find((y) => sameName(y.name, r.name))!;
        return literalOf(fromStored({ name: p.name, props: p.props ?? defaultProps('shortText') }, values[p.name] ?? null));
      }
      return Object.fromEntries(Object.entries(e).map(([k, v]) => [k, bound(v)]));
    };
    const exprs = a.values.map((e) => bound(e) as Expr);
    const row = exprs.map((e) => () => evaluate(e, { field: () => fail('unknownField'), now: ctx.now, locale: ctx.info.locale }));
    return { kind: server.kind, a, t, row, read: null };
  }
  const query: BoundQuery = { ...b, query: { ...b.query, body: a.q }, columns: b.selects.get(a.q)!.columns };
  const read: ReadRequest = { query, values, filter: [], sort: [], refs: a.mode !== 'insert', tables: (n) => server.table(n), now: ctx.now() };
  return { kind: server.kind, a, t, row: null, read };
}

/** Every row of `plan`, in pages (inside a transaction: nothing written yet, so the pages hold still).
 *  ponytail: OFFSET pages cost the server O(n²) on a large run; a keyset read if one is ever slow. */
async function readAll(c: Connection, plan: ReadPlan): Promise<{ rows: SqlValue[][]; refs: (string | null)[] }> {
  const out = { rows: [] as SqlValue[][], refs: [] as (string | null)[] };
  for (let offset = 0; ; offset += PAGE) {
    const p = await c.rows(plan, offset, PAGE);
    out.rows.push(...p.rows);
    out.refs.push(...p.refs);
    if (p.rows.length < PAGE) return out;
  }
}

/** The rows the query would write (distinct target rows for Update, Delete; INSERT … VALUES: one, nothing sent) and its table. */
export async function remoteActionCount(ctx: RemoteCtx, b: BoundQuery, params: Record<string, CellInput>): Promise<{ count: number; table: string }> {
  const { t, read } = prepared(ctx, b, params);
  if (!read) return { count: 1, table: t.name };
  return ctx.remote.run(b.source, async (c) => {
    const plan = c.plan(read);
    // a join may give a target row more than once: its tokens counted once
    const count = read.refs && b.sources.length > 1 ? new Set((await readAll(c, plan)).refs.filter((r) => r !== null)).size : await c.count(plan);
    return { count, table: t.name };
  }, true);
}

/** Each value converted as its field stores it; a value that is an error becomes Null (`nulled`: expressionError), as action.ts. */
async function inputs(fields: FieldDef[], cells: (() => Value | Promise<Value>)[], info: LocaleInfo): Promise<{ values: Record<string, CellInput>; nulled: FieldError[] }> {
  const values: Record<string, CellInput> = {};
  const nulled: FieldError[] = [];
  for (const [i, fd] of fields.entries()) {
    try {
      values[fd.name] = toStored(fd, await cells[i]!(), info);
    } catch (e) {
      if (!(e instanceof ExprRuntimeError)) throw e;
      values[fd.name] = null;
      nulled.push({ field: fd.name, code: 'expressionError' });
    }
  }
  return { values, nulled };
}

/**
 * Runs the action query `b` on its server source (R14), in one server transaction: its rows read, then each through R12's checks
 * and the connector (allowAutoNumber, nullOnConversion as locally; never `expected`). A front-end refusal or a Null set counts by
 * cause and rolls everything back (`rowErrors`) unless `skipFailures`, as locally; a row changed or deleted by another user
 * since it was read counts as a lock. A refusal by the server (duplicate, missing parent) rolls the whole run back whatever
 * `skipFailures` (PostgreSQL aborts a transaction after an error; ponytail: a savepoint per row to skip it). Delete sends every
 * token at once: `related` refuses the whole run. A target without a key, or a read-only front-end: readOnly. Without
 * capabilities.transactions: bc:serverNotSupported|actionQuery|<kind>. An Append supplying an AutoNumber field's values (PostgreSQL would
 * not move the identity, SQL Server refuses): bc:serverNotSupported|appendAutoNumber|<kind>, before anything is sent. A lost connection inside the transaction or its COMMIT:
 * bc:serverError|connection|… (outcome unknown, never sent again); Stop: bc:cancelled, rolled back.
 */
export async function remoteRunAction(ctx: RemoteCtx, b: BoundQuery, params: Record<string, CellInput>, opts: RunActionOptions): Promise<ActionResult> {
  const { kind, a, t, row: valuesRow, read } = prepared(ctx, b, params);
  if (!t.key.length || ctx.qc.writable?.(b.source) === false) return { ok: false, reason: 'readOnly' };
  const body = b.query.body, info = ctx.info;
  let written = 0, failed = 0, nulledFields = 0, total = 0;
  const errors: FieldError[] = [];
  const byCause: ByCause = { conversion: 0, key: 0, lock: 0, validation: 0 };
  const rowErrors = (): ActionResult => ({ ok: false, reason: 'rowErrors', failed, total, errors, byCause });
  /** A row: its values converted, then written by `write`. */
  const row = async (v: Awaited<ReturnType<typeof inputs>>, write: (values: Record<string, CellInput>) => Promise<SentWrite>) => {
    const { r, byServer } = await write(v.values);
    if (r.ok) {
      written++;
      const nulled = [...v.nulled, ...(r.nulled ?? [])];
      nulledFields += nulled.length;
      byCause.conversion += nulled.length;
      for (const e of nulled) if (errors.length < 5) errors.push(e);
      return;
    }
    failed++;
    if (!('errors' in r)) { byCause.lock++; return; } // changed or deleted by another user since this transaction read it
    byCause[causeOf(r.errors[0]!.code)]++;
    if (errors.length < 5) errors.push(r.errors[0]!);
    if (byServer) throw new Refused(rowErrors()); // R14: never skipped
  };

  return ctx.remote.run(b.source, async (c, caps) => {
    if (!caps.transactions) throw new Error(`bc:serverNotSupported|actionQuery|${kind}`);
    const plan = read && c.plan(read); // the connector's refusals (a function it lacks…) before anything is sent
    let insertFields: FieldDef[] = [];
    if (a.mode === 'insert' && body.k === 'insert') {
      // a field list, else (Append from a SELECT) each output column's field of the same name, else every field in order
      const names = body.columns.length ? body.columns : 'values' in body.source ? null : read!.query.columns.map((x) => x.name);
      insertFields = names ? names.map((n) => t.design.fields.find((x) => sameName(x.name, n))!) : t.design.fields;
      if (insertFields.some((x) => x.props.type === 'autoNumber')) throw new Error(`bc:serverNotSupported|appendAutoNumber|${kind}`);
    }
    try {
      return await c.transaction(async (): Promise<ActionResult> => {
        const got = plan ? await readAll(c, plan) : null; // read first: a query may read its own target
        if (a.mode === 'delete') {
          const tokens = [...new Set(got!.refs.filter((r): r is string => r !== null))];
          const d = await remoteDeleteOn(ctx, c, b.source, t, tokens);
          if (!d.ok) throw new Refused({ ok: false, reason: 'related', table: d.table ?? '' });
          return { ok: true, count: d.count };
        }
        if (a.mode === 'update' && body.k === 'update') {
          const fields = body.set.map((s) => {
            const r = b.refs.get(s.target);
            return t.design.fields.find((x) => r?.kind === 'column' && sameName(x.name, r.field))!;
          });
          const cols = read!.query.columns;
          const seen = new Set<string>();
          const todo = got!.rows.flatMap((cells, i) => { // a join gives a row more than once: its first values win
            const ref = got!.refs[i];
            if (ref == null || seen.has(ref)) return [];
            seen.add(ref);
            return [{ ref, cells }];
          });
          total = todo.length;
          for (const { ref, cells } of todo) {
            const v = await inputs(fields, cells.map((x, k) => () => fromStored({ name: '', props: cols[k]!.props }, x)), info);
            await row(v, (values) => remoteUpdateOn(ctx, c, caps, b.source, t, ref, values, { enforceMask: false, nullOnConversion: true }));
          }
        } else if (body.k === 'insert') {
          const fields = insertFields;
          const cols = read?.query.columns;
          const cells = valuesRow ? [valuesRow] : got!.rows.map((r) => r.map((x, k) => () => fromStored({ name: '', props: cols![k]!.props }, x)));
          total = cells.length;
          for (const r of cells) {
            await row(await inputs(fields, r, info), (values) => remoteInsertOn(ctx, c, b.source, t, values, { enforceMask: false, allowAutoNumber: true, nullOnConversion: true }));
          }
        }
        if ((failed || nulledFields) && !opts.skipFailures) throw new Refused(rowErrors());
        return { ok: true, count: written };
      });
    } catch (e) {
      if (e instanceof Refused) return e.result;
      throw e;
    }
  }, false);
}
