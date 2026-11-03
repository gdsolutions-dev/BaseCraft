// Import from a server (C7 R17): the read path reversed. Each picked table is bound as `SELECT *` over a one-table catalog, read by
// the connector's plan in pages, and copied as the stored values the connector decoded into a new local table; every table in one
// SQLite transaction (all or nothing), so a failure, a Stop or a lost connection leaves the front-end as it was.
import type { DatabaseSync } from 'node:sqlite';
import { bracket } from '../../shared/expr/lexer';
import type { TableDesign } from '../../shared/field-types';
import type { ImportProgress } from '../../shared/import-text';
import type { ServerImportResult } from '../../shared/migrate';
import { bindQuery } from '../../shared/query/bind';
import { parseSql } from '../../shared/query/sql-parser';
import type { Connection, RemoteTable } from '../connectors/connector';
import { createTable, DesignValidationError, quoteIdent } from '../db/schema';
import { inTransactionAsync } from '../db/tx';

const PAGE = 1000;
const CONNECTOR_PROP = /^(pg|ms)[A-Z]/;

/** R17: the server-read design as a local one: connector props (`pg*`, `ms*`) and `external` removed, the key (already marked by
 *  the connector, an identity sole key already AutoNumber) as the primary key, NOT NULL as a primary key is. */
export function localDesign(t: RemoteTable): TableDesign {
  return { name: t.name, fields: t.design.fields.map((x) => {
    const props = Object.fromEntries(Object.entries(x.props).filter(([k]) => k !== 'external' && !CONNECTOR_PROP.test(k))) as typeof x.props;
    return { name: x.name, props: t.key.includes(x.name) ? { ...props, primaryKey: true, required: true } : props };
  }) };
}

/** `tables`: the offered, picked tables (named as they will be locally). A Stop or a lost connection rejects (the caller maps it). */
export async function importTables(d: { front: DatabaseSync; c: Connection; tables: RemoteTable[];
  tick: (p: ImportProgress) => Promise<void> }): Promise<ServerImportResult> {
  const read = d.tables.map((t) => {
    const query = bindQuery(parseSql(`SELECT * FROM ${bracket(t.name)}`), { table: () => t.design, query: () => null, sourceOf: () => 'srv' });
    return { t, plan: d.c.plan({ query, values: {}, filter: [], sort: [], refs: false, tables: () => t, now: new Date() }) };
  });
  try {
    const counts: number[] = [];
    for (const { plan } of read) counts.push(await d.c.count(plan));
    const total = counts.reduce((n, x) => n + x, 0);
    let done = 0;
    await inTransactionAsync(d.front, async () => {
      for (const [i, { t, plan }] of read.entries()) {
        const design = localDesign(t);
        createTable(d.front, design);
        const cols = design.fields.map((x) => quoteIdent(x.name)).join(', ');
        const ins = d.front.prepare(`INSERT INTO ${quoteIdent(t.name)} (${cols}) VALUES (${design.fields.map(() => '?').join(', ')})`);
        let copied = 0;
        // ponytail: OFFSET pages outside a server snapshot. A row deleted meanwhile ends the pages short: the count check below fails
        // (nothing kept). A row inserted meanwhile shifts them, with an equal count: the last row is missed, and one before the
        // offset is copied twice (a key's local PRIMARY KEY refuses it, a keyless table keeps it: docs/server-migration.md says so).
        // The reads in one REPEATABLE READ transaction if it matters.
        while (copied < counts[i]!) {
          const page = await d.c.rows(plan, copied, PAGE);
          if (!page.rows.length) break;
          // a local Yes/No is NOT NULL (as an absent one is filled at insert): a Null of the server's becomes No
          for (const r of page.rows) ins.run(...r.map((v, k) => (v === null && design.fields[k]!.props.type === 'yesNo' ? 0 : v)));
          copied += page.rows.length;
          done += page.rows.length;
          await d.tick({ done, total, label: t.name });
        }
        if (copied !== counts[i]) throw new Error(`bc:migrateCount|${t.name}|${counts[i]}|${copied}`);
      }
    });
    return { ok: true, tables: read.map(({ t }, i) => ({ name: t.name, remote: t.remote, rows: counts[i]!, skipped: t.skipped })) };
  } catch (e) {
    // data a local CHECK, NOT NULL or UNIQUE refuses (SQLITE_CONSTRAINT), or a design the editor refuses: as a table copy says it
    if (e instanceof DesignValidationError || ((e as { errcode?: number }).errcode ?? 0) % 256 === 19) throw new Error('bc:unsupportedTable', { cause: e });
    throw e;
  }
}
