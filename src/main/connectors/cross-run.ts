// Test-only (spec 4.5): the evaluator's and SQLite's side of the cross-tests, shared by postgres/cross.test.ts and
// sqlserver/cross.test.ts. Evaluator = SQLite always; each connector's test compares its server with these.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import type { SqlValue } from '../../shared/coerce';
import { ExprRuntimeError, type Expr, type Value } from '../../shared/expr/ast';
import { CROSS_ROWS, CROSS_TABLE, type CrossCase } from '../../shared/expr/cross-cases';
import { evaluate, fromStored, truthy } from '../../shared/expr/evaluate';
import { fromSerial, infoOf } from '../../shared/expr/library';
import { parseCanonical } from '../../shared/expr/parser';
import { compileSql, compileValue, decodeValue, type SqlCompileCtx } from '../../shared/expr/sql';
import { sameName } from '../../shared/field-types';
import { bindQuery, type QueryCatalog } from '../../shared/query/bind';
import { parseSql } from '../../shared/query/sql-parser';
import { createBaseFile, openBaseFile } from '../db/file-format';
import { createTable, tableDesign } from '../db/schema';
import { authorizedPrepare } from '../query/authorizer';
import { compileSelect } from '../query/compile';

export const LOCALE = 'fr-FR';
export const ROWS = CROSS_ROWS.length;
export const NOW = (): Date => new Date(); // SQLite's bc_* functions read the clock too

/** Outcome of a row: a value as compared (number to 12 digits, text, date 'YYYY-MM-DD HH:MM:SS', Yes/No -1/0, Null), a
 *  condition (true, false, Null), or an error code (evaluator, SQLite) / bc:serverError|<code> (a server). A query a server
 *  refuses before sending it: its one message. */
export type Outcome = unknown;
export const r12 = (x: number): number => Number(x.toPrecision(12)) + 0;
export const err = (x: unknown): string => {
  if (x instanceof ExprRuntimeError) return x.code;
  const m = /^(bc:serverError\|\w+)\|/.exec((x as Error).message);
  if (m) return m[1]!;
  throw x;
};
export const norm = (v: Value | { t: 'empty' }): Outcome => {
  if (v === null || v.t === 'empty') return null; // Empty shows as Null (bc_out)
  switch (v.t) {
    case 'num': return r12(v.v);
    case 'date': return fromSerial(v.v);
    case 'bool': return v.v ? -1 : 0;
    default: return v.v;
  }
};
const tryOut = (fn: () => Outcome): Outcome => { try { return fn(); } catch (x) { return err(x); } };
export const parse = (c: CrossCase): Expr => parseCanonical(c.src, { criteria: c.mode === 'criteria' });

// ---- Evaluator ----
function evalEnv(row: SqlValue[], k: number, subject?: string) {
  const field = (name: string): Value => {
    const at = CROSS_TABLE.fields.findIndex((x) => sameName(x.name, name));
    if (at < 0) throw new ExprRuntimeError('unknownField');
    return fromStored(CROSS_TABLE.fields[at]!, at === 0 ? k + 1 : row[at - 1]!);
  };
  return { field, get subject() { return subject === undefined ? undefined : field(subject); }, now: NOW, locale: LOCALE };
}
export async function evaluatorResults(c: CrossCase): Promise<Outcome[]> {
  const e = parse(c), out: Outcome[] = [];
  for (const [k, row] of CROSS_ROWS.entries()) {
    try {
      const v = await evaluate(e, evalEnv(row, k, c.subject));
      out.push(c.mode === 'value' ? norm(v) : c.mode === 'condition' ? truthy(v, infoOf(LOCALE)) : truthy(v, infoOf(LOCALE)) === true);
    } catch (x) {
      out.push(c.mode === 'criteria' ? false : err(x)); // a criteria error excludes the row
    }
  }
  return out;
}

// ---- SQLite (a BaseCraft base holding T) ----
let dir: string | undefined;
let db: DatabaseSync | undefined;
/** The base, created on first use (T and its rows); `closeLite` in the test file's afterAll. */
export function lite(): DatabaseSync {
  if (db) return db;
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bccross-'));
  const p = path.join(dir, 'test.basecraft');
  createBaseFile(p, '0.0.0');
  db = openBaseFile(p, 'write', '0.0.0').db;
  createTable(db, CROSS_TABLE);
  const ins = db.prepare('INSERT INTO "T" ("txt", "n", "i", "d", "b") VALUES (?, ?, ?, ?, ?)');
  for (const r of CROSS_ROWS) ins.run(...r);
  return db;
}
export function closeLite(): void {
  db?.close();
  if (dir) fs.rmSync(dir, { recursive: true, force: true });
  db = dir = undefined;
}
const ctx: SqlCompileCtx = { fields: CROSS_TABLE.fields.map((x) => ({ name: x.name, type: x.props.type, numberSize: x.props.numberSize })), locale: LOCALE };
export function sqliteResults(c: CrossCase): Outcome[] {
  const e = parse(c), ids = Array.from({ length: ROWS }, (_, k) => k + 1);
  if (c.mode === 'criteria') {
    const w = compileSql(e, { ...ctx, subject: c.subject });
    const kept = new Set(lite().prepare(`SELECT "id" FROM "T" WHERE ${w.sql}`).all(...w.params).map((r) => Number(r.id)));
    return ids.map((id) => kept.has(id));
  }
  if (c.mode === 'condition') {
    const w = compileSql(e, ctx, { onError: 'throw' });
    const q = lite().prepare(`SELECT ${w.sql} AS r FROM "T" WHERE "id" = ?`);
    return ids.map((id) => tryOut(() => { const r = q.get(...w.params, id)!.r; return r === null ? null : Number(r) !== 0; }));
  }
  const v = compileValue(e, ctx);
  const q = lite().prepare(`SELECT ${v.sql} AS r FROM "T" WHERE "id" = ?`);
  return ids.map((id) => tryOut(() => norm(decodeValue(q.get(...v.params, id)!.r as never))));
}
/** A query's rows on the base (any of its tables). */
export const sqliteQuery = (sql: string): unknown[][] => {
  const base = lite();
  const catalog: QueryCatalog = { table: (n) => { try { return tableDesign(base, n); } catch { return null; } }, query: () => null };
  const c = compileSelect(bindQuery(parseSql(sql), catalog), {}, { locale: LOCALE });
  const stmt = authorizedPrepare(base, c.sql);
  stmt.setReturnArrays(true);
  return (stmt.all(...c.params) as unknown as unknown[][]).map((r) => (c.hasRowid ? r.slice(1) : r));
};
