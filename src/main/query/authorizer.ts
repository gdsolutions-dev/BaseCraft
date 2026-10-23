// SQLite authorizer (A3): the second line of defence behind the SQL parser. Every compiled statement is prepared here.
import { constants, type DatabaseSync, type StatementSync } from 'node:sqlite';
import { isReservedName } from '../../shared/field-types';
import { REGISTERED_FUNCTIONS } from '../db/file-format';

/** The only actions a compiled statement may take: a SELECT, reading tables, calling functions. Writes go through the write
 *  layer (rules, relations, cascades): INSERT, UPDATE, DELETE are refused like ATTACH, PRAGMA, CREATE_*, DROP_* or a
 *  transaction. VACUUM reaches the authorizer with no action at all: no SELECT seen, refused too. */
const ALLOWED = new Set([constants.SQLITE_SELECT, constants.SQLITE_READ, constants.SQLITE_FUNCTION]);
/** SQLite names functions case-insensitively. */
const FUNCTIONS = new Set(['count', 'rank', 'row_number', ...[...REGISTERED_FUNCTIONS].map((n) => n.toLowerCase())]);
/** SQLite's own limits (compound terms, tables in a join, expression height, columns, variables, lengths). */
const LIMIT = /too many|too large|too big|too complex|at most \d+|stack overflow/i;

/** A SQLite failure as a typed error: a limit is `bc:invalidQuery|tooComplex|`, never SQLite's raw message (the original
 *  error is kept as `cause`). Other errors are returned as they are. Also for errors raised while a statement runs. */
export function queryError(e: unknown): unknown {
  return LIMIT.test(String((e as Error)?.message ?? e)) ? new Error('bc:invalidQuery|tooComplex|', { cause: e }) : e;
}

/**
 * Prepares `sql` under the authorizer, which acts only while the statement is compiled. Allowed: one SELECT, reading only
 * the base's own tables (real, not virtual, not reserved: no `pragma_*`, `dbstat`,
 * `json_each`, temp or attached schema), calling only `count`, `rank`, `row_number` and the registered bc_* functions.
 * A refusal throws Error('bc:invalidQuery'); a SQLite limit `bc:invalidQuery|tooComplex|` (queryError).
 */
export function authorizedPrepare(db: DatabaseSync, sql: string): StatementSync {
  const tables = new Set((db.prepare("SELECT name FROM main.sqlite_schema WHERE type = 'table' AND sql NOT LIKE 'CREATE VIRTUAL%'").all() as { name: string }[])
    .map((r) => r.name.toLowerCase()).filter((n) => !isReservedName(n)));
  let denied = false;
  let statement = false;
  db.setAuthorizer((action, arg1, arg2, dbName) => {
    if (action === constants.SQLITE_SELECT) statement = true;
    const ok = ALLOWED.has(action)
      && !(action === constants.SQLITE_READ && ((dbName ?? 'main') !== 'main' || !tables.has((arg1 ?? '').toLowerCase())))
      && !(action === constants.SQLITE_FUNCTION && !FUNCTIONS.has((arg2 ?? '').toLowerCase()));
    if (!ok) denied = true;
    return ok ? constants.SQLITE_OK : constants.SQLITE_DENY;
  });
  let stmt: StatementSync;
  try {
    stmt = db.prepare(sql);
  } catch (e) {
    if (denied) throw new Error('bc:invalidQuery');
    throw queryError(e);
  } finally {
    db.setAuthorizer(null);
  }
  if (!statement) throw new Error('bc:invalidQuery');
  return stmt;
}
