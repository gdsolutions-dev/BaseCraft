// C6: a pass-through's run (the text sent as typed, R4, R5) and its result as a snapshot in memory (R1, R6), read through
// pageQuerySource like any query.
import { DatabaseSync } from 'node:sqlite';
import type { SqlValue } from '../../shared/coerce';
import { isValidObjectName, quoteIdent, sameName, type TableDesign } from '../../shared/field-types';
import type { PassThroughProps } from '../../shared/query/ast';
import type { NativeResult } from '../connectors/connector';
import { listObjects, getObject } from '../db/objects';
import { passThroughOf } from '../../shared/query/definition';
import { isLost, type RemoteSources } from '../connectors/remote-sources';
import { registerFunctions, SYSTEM_DDL } from '../db/file-format';
import { createTable } from '../db/schema';
import { inTransaction } from '../db/tx';

export const PT_TABLE = 'PassThrough';

const holdable = (name: string) => isValidObjectName(name) && !['rowid', 'oid', '_rowid_'].includes(name.toLowerCase()); // as validateDesign

/** R6: the design `PassThrough` of a result's columns, names refused or taken renamed Expr1000, Expr1001… */
export function snapshotDesign(columns: NativeResult['columns']): TableDesign {
  const kept: (string | null)[] = [];
  for (const c of columns) kept.push(holdable(c.name) && !kept.some((k) => k !== null && sameName(k, c.name)) ? c.name : null);
  const taken = kept.filter((k) => k !== null);
  let n = 1000;
  const next = () => {
    while (taken.some((k) => sameName(k, `Expr${n}`))) n++;
    return `Expr${n++}`;
  };
  return { name: PT_TABLE, fields: columns.map((c, i) => ({ name: kept[i] ?? next(), props: c.props })) };
}

/** R1: an in-memory, query_only connection holding PT_TABLE filled with `rows` (as loadAccessCache). */
export function loadSnapshot(design: TableDesign, rows: SqlValue[][]): DatabaseSync {
  const db = new DatabaseSync(':memory:');
  try {
    registerFunctions(db);
    for (const ddl of SYSTEM_DDL) db.exec(ddl);
    createTable(db, design);
    const insert = db.prepare(`INSERT INTO ${quoteIdent(PT_TABLE)} (${design.fields.map((f) => quoteIdent(f.name)).join(', ')}) VALUES (${design.fields.map(() => '?').join(', ')})`);
    const yesNo = design.fields.map((f) => f.props.type === 'yesNo'); // NOT NULL: a NULL bool is No, as Access shows a Null bit
    inTransaction(db, () => { for (const r of rows) insert.run(...r.map((v, i) => (v === null && yesNo[i] ? 0 : v))); });
    db.exec('PRAGMA query_only=ON');
    return db;
  } catch (e) {
    db.close();
    throw e;
  }
}

/** R4, R5, R12, R13: `sql` sent as is through remote.once (`trusted` false: no stored credential, C6 Task 8); capabilities.passThrough false or no native(): bc:serverNotSupported|passThrough|<kind>;
 *  Returns Records Yes without columns: bc:passThroughNoRecords; bc:timeout|<s> → bc:passThroughTimeout|<s>; lost → bc:passThroughLost||<message>. */
export async function runNative(remote: RemoteSources, pt: PassThroughProps, sql: string, trusted: boolean): Promise<NativeResult> {
  try {
    return await remote.once(pt.kind, pt.params, trusted, async (c, caps) => {
      if (!caps.passThrough || !c.native) throw new Error(`bc:serverNotSupported|passThrough|${pt.kind}`);
      const r = await c.native(sql);
      if (pt.returnsRecords && !r.columns.length) throw new Error('bc:passThroughNoRecords');
      return r;
    });
  } catch (e) {
    if (isLost(e)) throw new Error(`bc:passThroughLost||${(e as Error).message}`, { cause: e }); // never repeated: the text may have run
    const timeout = e instanceof Error ? /^bc:timeout\|(.*)$/.exec(e.message) : null;
    if (timeout) throw new Error(`bc:passThroughTimeout|${timeout[1]}`, { cause: e });
    throw e;
  }
}

/** R3: kind and params of every 2.x query definition of the front-end (unreadable ones skipped). */
export function passThroughServers(front: DatabaseSync): { kind: string; params: unknown }[] {
  const out: { kind: string; params: unknown }[] = [];
  for (const q of listObjects(front, 'query')) {
    try {
      const pt = passThroughOf(getObject(front, 'query', q.name)?.definition);
      if (pt) out.push({ kind: pt.kind, params: pt.params });
    } catch { /* unreadable: skipped */ }
  }
  return out;
}
