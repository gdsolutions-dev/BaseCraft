// Server migration (C7 R8, R9, R16): one run. The pre-flight refusals (reads only), the backup copy, one server transaction
// (every table, its rows by pages, its row count checked, its identity and indexes, then every foreign key, then every table
// read back and checked linkable), then one local SQLite transaction swapping every local table for its link; then R13's check
// of the saved queries and SQL Record Sources against the new links (planned only).
import type { DatabaseSync } from 'node:sqlite';
import type { QueryRef } from '../../shared/api';
import type { CellInput, SqlValue } from '../../shared/coerce';
import { sameName } from '../../shared/field-types';
import type { ImportProgress } from '../../shared/import-text';
import type { MigrateResult, MigrationReport } from '../../shared/migrate';
import { passThroughOf } from '../../shared/query/definition';
import type { Capabilities, Connection, RemoteTable, ServerKind } from '../connectors/connector';
import { remoteActionCount } from '../connectors/remote-action';
import { remotePageSource, type RemoteCtx } from '../connectors/remote-data';
import { isLost, type RemoteSources } from '../connectors/remote-sources';
import { getObject, listObjects } from '../db/objects';
import { hasRealRowid, quoteIdent, removeTable, tableDesign } from '../db/schema';
import { saveStartupOptions, startupOptions } from '../db/startup';
import { inTransaction } from '../db/tx';
import { linkMeta, type LinkMeta } from '../links/meta';
import { addServerLinks } from '../links/store';
import { remoteExpandCrosstab } from '../query/crosstab';
import { resolve } from '../query/source';
import { MigrateRefusal, migrationPlan, type ServerForeignKey, type ServerTable } from './plan';

export interface RunDeps {
  front: DatabaseSync; c: Connection; caps: Capabilities; kind: ServerKind; params: unknown /* the connector's */; label: string; schema: string;
  tick: (p: ImportProgress) => Promise<void>;
  /** backupCopy of the front-end (spec 6): its path. */
  backup: () => string;
  /** The local switch (R9), switchLocal's: one SQLite transaction, all or nothing. */
  switchLocal: (tables: RemoteTable[], metas: LinkMeta[]) => void;
  /** R13, after the switch: refusedQueries on the run's connection. */
  queries: () => Promise<MigrationReport['queries']>;
}

/** R8: the local rows of `t` (stored form, t.fields order) in pages of `n`: by rowid keyset, or by key with OFFSET without a
 *  real rowid. Each page is its own statement: no read transaction stays open between two pages. */
function* pages(db: DatabaseSync, t: ServerTable, n: number): Generator<SqlValue[][]> {
  const cols = t.fields.map((x) => quoteIdent(x.name)).join(', '), from = quoteIdent(t.name);
  if (hasRealRowid(db, tableDesign(db, t.name))) {
    const head = db.prepare(`SELECT rowid, ${cols} FROM ${from} ORDER BY rowid LIMIT ?`);
    const next = db.prepare(`SELECT rowid, ${cols} FROM ${from} WHERE rowid > ? ORDER BY rowid LIMIT ?`);
    for (const st of [head, next]) st.setReturnArrays(true);
    for (let page = head.all(n) as unknown as SqlValue[][]; page.length; page = next.all(page.at(-1)![0]!, n) as unknown as SqlValue[][]) {
      yield page.map((r) => r.slice(1));
    }
    return;
  }
  // ponytail: a shadowed rowid without a key reads in SQLite's scan order (stable while nothing writes: the run holds the base)
  const order = t.key.length ? ` ORDER BY ${t.key.map(quoteIdent).join(', ')}` : '';
  const st = db.prepare(`SELECT ${cols} FROM ${from}${order} LIMIT ? OFFSET ?`);
  st.setReturnArrays(true);
  for (let at = 0, page = st.all(n, 0) as unknown as SqlValue[][]; page.length; at += n, page = st.all(n, at) as unknown as SqlValue[][]) yield page;
}

/** R9's local switch: relations deleted (they named local tables), every table removed, every link added with its meta, the
 *  front-end option set; one SQLite transaction. `remove`: the test seam. */
export function switchLocal(front: DatabaseSync, kind: ServerKind, params: unknown, tables: RemoteTable[], metas: LinkMeta[],
  remove: typeof removeTable = removeTable): void {
  inTransaction(front, () => {
    front.exec('PRAGMA defer_foreign_keys=ON; DELETE FROM bc_relations');
    for (const t of tables) remove(front, t.name);
    addServerLinks(front, kind, params, tables, metas);
    saveStartupOptions(front, { ...startupOptions(front), frontEnd: true });
  });
}

const messageOf = (e: unknown): string => (e instanceof Error ? e.message : String(e));
/** The error as a bc: message (a driver's or the run's own; anything else is unknown). */
const bcMessage = (e: unknown): string => (messageOf(e).startsWith('bc:') ? messageOf(e) : `bc:unknown|${messageOf(e)}`);

/** R13: every saved query (a pass-through runs as it is) and every form's and report's SQL Record Source, read or counted through
 *  the paths that run it (describe, page, crosstab headings, an action's count) against the links, on a connection that only
 *  plans: nothing is sent. Each refusal with its message; a source other than `source` (the migrated one: another server's queries are not planned on this connection) is not checked. */
export async function refusedQueries(ctx: RemoteCtx, c: Connection, caps: Capabilities, source: string): Promise<MigrationReport['queries']> {
  const empty = async () => ({ rows: [], refs: [] });
  const planOnly = { plan: (r: Parameters<Connection['plan']>[0]) => c.plan(r), rows: empty, count: async () => 0 } as unknown as Connection;
  const dry: RemoteCtx = { ...ctx, remote: { run: (_: string, fn: (x: Connection, k: Capabilities) => Promise<unknown>) => fn(planOnly, caps) } as unknown as RemoteSources };
  const front = ctx.qc.front;
  const out: MigrationReport['queries'] = [];
  const refs: [string, QueryRef][] = [];
  for (const [kind, o] of (['query', 'form', 'report'] as const).flatMap((k) => listObjects(front, k).map((o) => [k, o] as const))) {
    try { // one corrupt object (bc:corruptObject) is listed, the others are still checked
      const def = getObject(front, kind, o.name)?.definition;
      if (kind === 'query') { if (!passThroughOf(def)) refs.push([o.name, { kind: 'query', name: o.name }]); continue; }
      const rs = (def as { recordSource?: { kind?: unknown; sql?: unknown } } | undefined)?.recordSource;
      if (rs?.kind === 'sql' && typeof rs.sql === 'string') refs.push([o.name, { kind: 'sql', sql: rs.sql }]);
    } catch { out.push({ name: o.name, error: 'bc:unreadable' }); }
  }
  for (const [name, ref] of refs) {
    try {
      const select = (() => { try { return resolve(dry.qc, ref); } catch (e) { if (messageOf(e) === 'bc:notSelectQuery') return null; throw e; } })();
      const b = select ?? resolve(dry.qc, ref, true); // an action query
      if (b.source !== source || !dry.qc.remote?.(b.source)) continue;
      const params: Record<string, CellInput> = Object.fromEntries(b.params.map((p) => [p.name, null]));
      if (!select) await remoteActionCount(dry, b, params);
      else await remotePageSource(dry, b.crosstab ? await remoteExpandCrosstab(dry, b, params as Record<string, SqlValue>) : b, { offset: 0, limit: 0, params });
    } catch (e) {
      out.push({ name, error: bcMessage(e) });
    }
  }
  return out;
}

/** R8, R9: refusals change nothing; a failure or Stop inside the server transaction leaves nothing on the server and the
 *  front-end untouched; a COMMIT lost on the way reports every table `left`; a failed local switch drops the tables it created. */
export async function runMigration(d: RunDeps): Promise<MigrateResult> {
  const w = d.caps.migrate ? d.c.schema : undefined;
  if (!w) throw new Error('bc:invalidArgument');
  const taken = await w.names(d.schema);
  if (taken === null) return { ok: false, reason: 'noSchema', schema: d.schema };
  let plan: ReturnType<typeof migrationPlan>;
  try {
    plan = migrationPlan(d.front, d.schema, w.limits, taken);
  } catch (e) {
    if (!(e instanceof MigrateRefusal)) throw e;
    return e.reason === 'noTables' ? { ok: false, reason: 'noTables' } : { ok: false, reason: e.reason, names: e.names };
  }
  let backupPath: string;
  try { backupPath = d.backup(); } catch (e) { return { ok: false, reason: 'failed', error: `bc:copyFailed|${messageOf(e)}` }; }

  const total = plan.tables.reduce((n, t) => n + t.rows, 0);
  await d.tick({ done: 0, total, backupPath }); // the wizard names it when a Stop ends the data process
  let done = 0, at: string | undefined, committing = false;
  let made: ServerForeignKey[] = [];
  const read: RemoteTable[] = [];
  try {
    await d.c.transaction(async () => {
      for (const t of plan.tables) {
        at = t.name;
        await w.createTable(t);
        const n = Math.max(1, Math.min(1000, Math.floor(w.limits.params / t.fields.length)));
        for (const page of pages(d.front, t, n)) {
          await w.insertRows(t, page);
          done += page.length;
          await d.tick({ done, total, label: t.name });
        }
        const count = await w.countRows(t);
        if (count !== t.rows) throw new Error(`bc:migrateCount|${t.name}|${t.rows}|${count}`);
        await w.finishTable(t); // after the count: SQL Server's reseed goes by t.rows
      }
      at = undefined; // a foreign key's failure names its table itself (its child; SQL Server's one Null: the parent)
      made = await w.addForeignKeys(plan.foreignKeys);
      for (const t of plan.tables) {
        at = t.name;
        const rt = await d.c.table({ schema: t.schema, remote: t.name, name: t.name });
        const sameKey = rt && rt.key.length === t.key.length && rt.key.every((k, i) => sameName(k, t.key[i]!));
        if (!rt || rt.unsupported || !sameKey) throw new Error(`bc:migrateUnlinkable|${t.name}|${rt?.unsupported ?? 'key'}`);
        read.push(rt);
      }
      at = undefined;
      await d.tick({ done, total, finishing: true });
      committing = true;
    });
  } catch (e) {
    const msg = messageOf(e);
    if (committing && (isLost(e) || msg === 'bc:cancelled')) { // the COMMIT's outcome is unknown: the tables may be on the server
      // (a Stop then too: SQL Server's ATTENTION ends a COMMIT it already completed with ECANCEL)
      const error = msg === 'bc:cancelled' ? msg : `bc:serverError|connection|${msg}`;
      return { ok: false, reason: 'failed', error, unknown: true, left: plan.tables.map((t) => t.name), backupPath };
    }
    if (msg === 'bc:cancelled') return { ok: false, reason: 'cancelled', backupPath };
    // a refusal whose ROLLBACK failed: the drivers close the connection and report it lost, the refusal its cause
    const cause = (e as { cause?: unknown }).cause;
    const refused = isLost(e) && cause instanceof Error && !isLost(cause) && cause.message.startsWith('bc:') ? cause : undefined;
    const error = refused ? refused.message : isLost(e) ? `bc:linkUnavailable|cannotConnect|${d.label}` : bcMessage(e); // lost before the COMMIT: rolled back
    const { table = at, field } = (refused ?? e) as { table?: string; field?: string };
    return { ok: false, reason: 'failed', error, ...(table !== undefined && { table }), ...(typeof field === 'string' && { field }),
      ...(refused && { closed: true as const }), backupPath };
  }

  let locals: ReturnType<typeof tableDesign>[];
  try {
    locals = plan.tables.map((t) => tableDesign(d.front, t.name));
    d.switchLocal(read, read.map((rt, i) => linkMeta(locals[i]!, rt)));
  } catch (e) {
    // the server tables this run committed, dropped again (outside a transaction); those it could not drop are left
    const left = await w.dropTables(plan.tables).catch(() => plan.tables.map((t) => t.name));
    return { ok: false, reason: 'failed', error: bcMessage(e), left, backupPath };
  }

  let queries: MigrationReport['queries'] = [], queriesUnchecked: string | undefined;
  try { queries = await d.queries(); } catch (e) { queriesUnchecked = bcMessage(e); } // the migration is done: the report says so
  const report: MigrationReport = {
    kind: d.kind, server: d.label, schema: d.schema, backupPath,
    tables: plan.tables.map((t, i) => ({ name: t.name, rows: t.rows, ...(t.nextId !== undefined && { nextId: t.nextId }),
      ...(read[i]!.version !== undefined && { version: read[i]!.version }) })),
    indexes: plan.tables.flatMap((t) => t.indexes.map((ix) => ({ table: t.name, name: ix.name, unique: ix.unique }))),
    relations: [
      ...made.map((fk) => {
        const asked = plan.foreignKeys.find((x) => x.relation === fk.relation)!;
        return { name: fk.relation, result: fk.onDelete === asked.onDelete && fk.onUpdate === asked.onUpdate ? 'created' as const : 'noAction' as const };
      }),
      ...plan.notEnforced.map((name) => ({ name, result: 'notEnforced' as const })),
    ],
    // read back as another type or size (PostgreSQL's Byte and Currency, Hyperlink): R11's overlay shows the local one
    approximated: locals.flatMap((local, i) => read[i]!.design.fields.flatMap((x) => {
      const fd = local.fields.find((y) => sameName(y.name, x.name));
      return fd && (fd.props.type !== x.props.type || (fd.props.type === 'number' && fd.props.numberSize !== x.props.numberSize))
        ? [{ table: local.name, field: fd.name, serverType: w.columnType(fd.props) }] : [];
    })),
    frontEndOnly: plan.frontEndOnly,
    queries,
    ...(queriesUnchecked !== undefined && { queriesUnchecked }),
  };
  return { ok: true, report };
}
