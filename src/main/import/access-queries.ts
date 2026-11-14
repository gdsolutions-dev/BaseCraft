// Access import (E3): the saved queries of an export folder, saved as BaseCraft queries with one report line each.
// The import never runs a query. A query that cannot be imported gives a line, never an error.
import type { DatabaseSync } from 'node:sqlite';
import type { ExportQuery } from '../../shared/access-export';
import type { ReportLine } from '../../shared/access-import';
import { rewriteSql, toRenames } from '../../shared/autocorrect/sql';
import { foldName, sameName } from '../../shared/field-types';
import { uniqueName } from '../../shared/import-text';
import type { NameChange } from '../../shared/api';
import { danglingNames, listTables } from '../db/schema';
import { getObject, listObjects, saveObject } from '../db/objects';
import { bindQuery, QueryBindError } from '../../shared/query/bind';
import { parseSql } from '../../shared/query/sql-parser';
import { linkRows } from '../links/store';
import { checkQueryDefinition, queryCatalog } from '../query/source';

const PASS_THROUGH = [112, 144];
const definition = (sql: string) => ({ formatVersion: '1.0', sql });

/** The line for the error `checkQueryDefinition` threw. */
function errorLine(e: unknown, name: string, queryType: number): ReportLine {
  const [kind, code, a, fn] = (e instanceof Error ? e.message : '').split('|');
  if (kind === 'bc:invalidQuery') {
    if (code === 'unknownFunction' && fn !== undefined) return { code: 'queryKeptAsText', object: name, reason: 'unknownFunction', part: fn };
    return { code: 'queryKeptAsText', object: name, reason: code === 'forbiddenStatement' || queryType === 96 ? 'dataDefinition' : 'notRead' };
  }
  if ((kind === 'bc:queryBind' || kind === 'bc:notFound') && code === 'unknownSource' && a !== undefined) return { code: 'querySourceMissing', object: name, part: a };
  return { code: 'queryKeptAsText', object: name, reason: 'notBound' };
}

/** What a rewrite of Access SQL needs once this import renamed some tables and queries (`remote`: name in Access, `name`: here).
 *  `old`: the catalog as Access saw it; `lenient`: the same, a source nobody knows binds as a table without fields, so the renamed sources of its text are still rewritten. */
export function renameContext(db: DatabaseSync, tables: { remote: string; name: string }[], queries: { remote: string; name: string }[]) {
  const changes: NameChange[] = [
    ...tables.filter((t) => t.name !== t.remote).map((t) => ({ k: 'object' as const, kind: 'table' as const, from: t.remote, to: t.name })),
    ...queries.filter((q) => q.name !== q.remote).map((q) => ({ k: 'object' as const, kind: 'query' as const, from: q.remote, to: q.name })),
  ];
  const renames = toRenames(changes);
  const base = queryCatalog(db);
  // (a design keeps the Access name it was asked for, as the rewrite expects of the catalog before the rename)
  const old = { ...base, table: (n: string) => { const d = base.table(renames.objects.table.get(foldName(n)) ?? n); return d && { ...d, name: n }; }, query: (n: string) => base.query(renames.objects.query.get(foldName(n)) ?? n) };
  const lenient: typeof base = { ...old, table: (n) => old.table(n) ?? (old.query(n) === null ? { name: n, fields: [] } : null) };
  return { changes, renames, old, lenient };
}

/** Saves the queries of an Access export in `db` and says what became of each. Never throws for a query; never runs one.
 *  `tables`: the tables of this import ({ remote: name in Access, name: name in BaseCraft }). */
export function importQueries(db: DatabaseSync, queries: ExportQuery[], tables: { remote: string; name: string }[]):
  { queries: { name: string; remote: string }[]; lines: ReportLine[] } {
  const taken = [...listTables(db).map((t) => t.name), ...listObjects(db, 'query').map((o) => o.name), ...linkRows(db).map((l) => l.name), ...danglingNames(db)];
  const seen: string[] = [];
  const lines: (ReportLine | undefined)[] = []; // by query; undefined: judged below
  const saved: { i: number; q: ExportQuery; name: string }[] = [];
  // 1 and 2: names, then every query saved before any is judged (a query over a later one binds)
  queries.forEach((q, i) => {
    const skip = (reason: string): void => { lines[i] = { code: 'querySkipped', object: q.name, reason }; };
    const duplicate = seen.some((x) => sameName(x, q.name));
    seen.push(q.name);
    if (duplicate) return skip('duplicate');
    if (q.sql === null) return skip('unreadable');
    const name = uniqueName(q.name, taken);
    const res = saveObject(db, 'query', name, definition(q.sql), null);
    if (!res.ok) return skip('nameInvalid');
    taken.push(name);
    saved.push({ i, q, name });
  });
  // 4: the Access names of the renamed tables and queries resolve to the objects as imported
  const { changes, renames, old, lenient } = renameContext(db, tables, saved.map((s) => ({ remote: s.q.name, name: s.name })));
  // the objects of this import, by their Access names: whatever else a query reads (absent from the target or not) was not imported with it
  const access: typeof lenient = {
    table: (n) => (tables.some((t) => sameName(t.remote, n)) ? old.table(n) : null),
    query: (n) => saved.find((s) => sameName(s.q.name, n))?.q.sql ?? null,
  };
  const outside = (q: ExportQuery): string | undefined => {
    try { bindQuery(parseSql(q.sql!), access, q.name); } catch (e) { if (e instanceof QueryBindError && e.code === 'unknownSource') return e.detail; }
  };
  // an append query writes into its target: a table this import did not bring is reported, present in the target or not
  const appendOutside = (q: ExportQuery): string | undefined => {
    try { const b = parseSql(q.sql!).body; if (b.k === 'insert' && !tables.some((t) => sameName(t.remote, b.target))) return b.target; } catch { /* the check below says what is wrong */ }
  };
  for (const { i, q, name } of saved) {
    if (PASS_THROUGH.includes(q.queryType)) { lines[i] = { code: 'queryPassThrough', object: name, ...(q.connect ? { part: q.connect } : {}) }; continue; }
    let sql = q.sql!;
    let failure: unknown;
    try {
      const rewritten = changes.length ? rewriteSql(sql, lenient, renames, q.name) : null;
      if (rewritten !== null) { sql = rewritten; if (!saveObject(db, 'query', name, definition(sql), name).ok) failure = new Error('bc:queryBind|notBound'); }
    } catch (e) { failure = e; }
    try {
      if (failure) throw failure;
      const target = appendOutside(q);
      if (target !== undefined) { lines[i] = { code: 'querySourceMissing', object: name, part: target }; continue; }
      checkQueryDefinition(db, name, definition(sql));
      const part = outside(q);
      lines[i] = part !== undefined ? { code: 'querySourceMissing', object: name, part } : { code: 'queryImported', object: name, ...(name !== q.name ? { part: q.name } : {}) };
    } catch (e) { lines[i] = errorLine(e, name, q.queryType); }
  }
  return { queries: saved.map(({ q, name }) => ({ name: getObject(db, 'query', name)!.name, remote: q.name })), lines: lines as ReportLine[] };
}
