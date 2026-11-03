// A fake server connector over rows in memory (tests and the e2e fake server): no SQL, no driver.
import type { DeleteResult } from '../../shared/api';
import type { SqlValue } from '../../shared/coerce';
import { neverUnsent, type Capabilities, type Connection, type Connector, type NativeResult, type ReadPlan, type ReadRequest, type RemoteConflict, type RemoteTable, type RemoteWrite, type SchemaWriter } from './connector';
import { ptProps } from './postgres/types';
import { pgKey, pgLabel, pgParams, type PgParams } from './postgres/params';

type Row = { values: SqlValue[]; version: number };
type FakePlan = { table: RemoteTable; cols: number[] /* -1: no origin */; lits: SqlValue[] /* a column without origin: its literal, else Null */; refs: boolean; keep: (r: Row) => boolean };
export type TestConnector = Connector<PgParams> & { log: string[]; connections: number; lastRequest?: ReadRequest; failNext?: unknown; hold?: boolean; undroppable?: string[] /* names dropTables leaves and returns */ };

const echo = (sql: string): NativeResult => ({ columns: [{ name: 'sql', props: ptProps(25, -1) }], rows: [[sql]], affected: 0 });
const cmp = (a: SqlValue, b: SqlValue) => (a === b ? 0 : a === null ? -1 : b === null ? 1 : a < b ? -1 : 1);
/** A request's `where` of the shape `[column] = <number or text>` (C7 R12: Limit To List's one-row read) as the output column
 *  and its value; undefined otherwise (not filtered). Only number and text literals: a negative number (`un`), a date or a Yes/No
 *  reads unfiltered, so a Limit To List over such a value always passes on the fake. */
const equality = (r: ReadRequest): { column: number; value: SqlValue } | undefined => {
  const w = r.where;
  if (w?.k !== 'bin' || w.op !== '=' || w.l.k !== 'id') return undefined;
  const name = w.l.name, column = r.query.columns.findIndex((c) => c.name === name);
  const value = w.r.k === 'num' ? Number(w.r.v) : w.r.k === 'str' ? w.r.v : undefined;
  return column < 0 || value === undefined ? undefined : { column, value };
};

/** Rows in memory by link name; key = the table's `key`; version = a counter per row ('rowVersion') or the values ('values');
 *  accepts only `password` (default 'secret'); `plan()` records the request (`lastRequest`) and serves table reads in key order,
 *  unfiltered but by a `where` `[column] = <number or text>` (compared with ===), a column without origin as its number or
 *  text literal, else Null (C7 R14: an Update's SET values); `rows()` waits on `hold` when set, until
 *  `cancel()`. `params`/`key`/`label` as PostgreSQL's; refs `JSON.stringify([keyTexts, String(version)])`, versions 10, 11, … in row order at creation, +1 on each update (checked by
 *  update, never by delete: R8). `failNext`: the next connection call throws it. Every call is logged by name ('open', 'plan',
 *  'count', 'rows', 'native', 'insert', 'find', …). `native(sql)`: o.native, default an echo
 *  { columns: [{ name: 'sql', props: Long Text }], rows: [[sql]], affected: 0 }; waits on `hold` as rows() does. An update with
 *  no values checks only (its version stays, as the drivers'). `find` compares stored forms (`===`; `lock` ignored: one session
 *  at a time). `transaction` logs 'begin', then 'commit', or 'rollback' with every row as it was at 'begin' when fn throws;
 *  `transactions` (default true): capabilities.transactions. `migrate` (default true): capabilities.migrate and `schema`, a
 *  SchemaWriter in memory (C7 R18): the schemas are 'public' and those of `tables`; a created table is served by tables(),
 *  table() and rows() under its own name (its local props as its design), its rows, indexes and foreign keys counted in
 *  names(); 'begin'…'rollback' removes what it created; insertRows waits on `hold` as rows() does; columnType is the
 *  field's type; insert() continues an AutoNumber at its nextId; each call logged by
 *  its method name ('createTable', 'insertRows', …) and failNext applies. */
export function testConnector(o: { conflict?: Capabilities['conflict']; transactions?: boolean; migrate?: boolean; tables?: RemoteTable[]; rows?: Record<string, SqlValue[][]>; password?: string; native?: (sql: string) => NativeResult } = {}): TestConnector {
  let next = 10;
  const created: RemoteTable[] = []; // by the SchemaWriter; o.tables stays the caller's (tests change it)
  const tables = () => [...(o.tables ?? []), ...created];
  const objects: { schema: string; name: string; on: string[] /* its tables */ }[] = []; // created indexes and foreign keys
  const sequence = new Map<string, number>(); // R8: a created table's next AutoNumber
  const data = new Map<string, Row[]>(Object.entries(o.rows ?? {}).map(([n, rs]) => [n, rs.map((values) => ({ values: [...values], version: next++ }))]));
  const conflict = o.conflict ?? 'rowVersion';
  const keyIdx = (t: RemoteTable) => t.key.map((k) => t.design.fields.findIndex((f) => f.name === k));
  const version = (r: Row) => (conflict === 'rowVersion' ? String(r.version) : JSON.stringify(r.values));
  const ref = (t: RemoteTable, r: Row) => (t.key.length ? JSON.stringify([keyIdx(t).map((i) => String(r.values[i])), version(r)]) : null);
  const rowsOf = (t: RemoteTable) => {
    const rs = data.get(t.name) ?? [];
    data.set(t.name, rs);
    return rs;
  };
  const sorted = (t: RemoteTable) => {
    const ks = keyIdx(t);
    return [...rowsOf(t)].sort((a, b) => ks.reduce((c, i) => c || cmp(a.values[i]!, b.values[i]!), 0));
  };
  const find = (t: RemoteTable, token: string) => {
    const [keys, ver] = JSON.parse(token) as [string[], string];
    const row = rowsOf(t).find((r) => keyIdx(t).every((i, j) => String(r.values[i]) === keys[j]));
    return { row, ver };
  };
  const assign = (t: RemoteTable, r: Row, values: Record<string, SqlValue>) => {
    t.design.fields.forEach((f, i) => { if (f.name in values) r.values[i] = values[f.name]!; });
  };

  const fake: TestConnector = {
    kind: 'postgresql',
    capabilities: { passThrough: true, conflict, transactions: o.transactions ?? true, migrate: o.migrate ?? true },
    log: [],
    connections: 0,
    params: pgParams,
    key: pgKey,
    label: pgLabel,
    async open(p, c) {
      fake.log.push('open');
      if (c.password !== (o.password ?? 'secret')) throw new Error(`bc:linkUnavailable|needsLogin|${fake.key(p)}`);
      fake.connections++;
      let held: ((e: Error) => void) | null = null;
      /** The call `name`, after failNext is thrown (once). */
      const call = async <T>(name: string, fn: () => T | Promise<T>): Promise<T> => {
        fake.log.push(name);
        const e = fake.failNext;
        if (e !== undefined) { fake.failNext = undefined; throw e; }
        return fn();
      };
      const conn: Connection = {
        tables: () => call('tables', tables),
        table: (t) => call('table', () => tables().find((x) => x.remote === t.remote && x.schema === t.schema) ?? null),
        plan(r) {
          fake.log.push('plan');
          fake.lastRequest = r;
          const src = r.query.sources.find((s) => s.kind === 'table');
          if (!src) throw new Error('bc:serverNotSupported|other|postgresql');
          const table = r.tables(src.name);
          const cols = r.query.columns.map((c) => (c.origin ? table.design.fields.findIndex((f) => f.name === c.origin!.field) : -1));
          const lits = r.query.columns.map(({ expr: e }) => (e?.k === 'num' ? Number(e.v) : e?.k === 'str' ? e.v : null)); // e: absent in a hand-made request
          const eq = equality(r);
          const keep = (row: Row) => !eq || (cols[eq.column]! >= 0 && row.values[cols[eq.column]!] === eq.value);
          return { table, cols, lits, refs: r.refs, keep } satisfies FakePlan as unknown as ReadPlan;
        },
        count: (p) => call('count', () => rowsOf((p as unknown as FakePlan).table).filter((p as unknown as FakePlan).keep).length),
        rows: (p, offset, limit) => call('rows', async () => {
          if (fake.hold) await new Promise<void>((_, reject) => { held = reject; });
          const { table, cols, lits, refs, keep } = p as unknown as FakePlan;
          const page = sorted(table).filter(keep).slice(offset, offset + limit);
          return { rows: page.map((r) => cols.map((i, k) => (i < 0 ? lits[k]! : r.values[i]!))), refs: page.map((r) => (refs ? ref(table, r) : null)) };
        }),
        native: (sql) => call('native', async () => {
          if (fake.hold) await new Promise<void>((_, reject) => { held = reject; });
          return (o.native ?? echo)(sql);
        }),
        insert: (t, values) => call('insert', (): RemoteWrite => {
          const r: Row = { values: t.design.fields.map(() => null), version: next++ };
          assign(t, r, values);
          for (const i of keyIdx(t)) {
            if (r.values[i] !== null) continue;
            r.values[i] = Math.max(sequence.get(t.name) ?? 1, Math.max(0, ...rowsOf(t).map((x) => Number(x.values[i]) || 0)) + 1); // a serial
            if (sequence.has(t.name)) sequence.set(t.name, Number(r.values[i]) + 1);
          }
          rowsOf(t).push(r);
          return { ok: true, ref: ref(t, r), values: [...r.values] };
        }),
        update: (t, token, values, expected) => call('update', (): RemoteWrite | RemoteConflict => {
          const { row, ver } = find(t, token);
          if (!row) return { ok: false, conflict: 'deleted' };
          const changed = conflict === 'rowVersion'
            ? version(row) !== ver
            : Object.entries(expected ?? {}).some(([k, v]) => row.values[t.design.fields.findIndex((f) => f.name === k)] !== v);
          if (changed) return { ok: false, conflict: 'changed', current: [...row.values], ref: ref(t, row)! };
          assign(t, row, values);
          if (Object.keys(values).length) row.version++;
          return { ok: true, ref: ref(t, row), values: [...row.values] };
        }),
        delete: (t, tokens) => call('delete', (): DeleteResult => {
          const rs = rowsOf(t);
          let count = 0;
          for (const token of tokens) {
            const { row } = find(t, token); // by key only: deletes are not checked (R8)
            if (row) { rs.splice(rs.indexOf(row), 1); count++; }
          }
          return { ok: true, count };
        }),
        find: (t, where, limit) => call('find', () => rowsOf(t)
          .filter((r) => Object.entries(where).every(([k, v]) => r.values[t.design.fields.findIndex((f) => f.name === k)] === v))
          .slice(0, limit).map((r) => ({ values: [...r.values], ref: ref(t, r) }))),
        async transaction(fn) {
          fake.log.push('begin');
          const saved = [...data].map(([n, rs]) => [n, rs.map((r) => ({ values: [...r.values], version: r.version }))] as const);
          const before = [created.length, objects.length] as const;
          const seq = new Map(sequence);
          try {
            const r = await fn();
            fake.log.push('commit');
            return r;
          } catch (e) {
            data.clear();
            for (const [n, rs] of saved) data.set(n, rs);
            sequence.clear();
            for (const [k, v] of seq) sequence.set(k, v);
            created.length = before[0];
            objects.length = before[1];
            fake.log.push('rollback'); // a lost connection too: the server rolls it back
            throw neverUnsent(e);
          }
        },
        async cancel() {
          fake.log.push('cancel');
          if (!held) return false;
          held(new Error('bc:cancelled'));
          held = null;
          return true;
        },
        async close() { fake.log.push('close'); },
      };
      const named = (schema: string, name: string) => tables().find((x) => x.schema === schema && x.remote === name);
      const writer: SchemaWriter = {
        limits: { nameMax: 63, unit: 'utf8', params: 65535 },
        columnType: (p) => p.type,
        names: (schema) => call('names', () => (schema === 'public' || tables().some((x) => x.schema === schema)
          ? [...tables(), ...objects].filter((x) => x.schema === schema).map((x) => ('remote' in x ? x.remote : x.name)) : null)),
        createTable: (t) => call('createTable', () => {
          if (named(t.schema, t.name)) throw new Error(`bc:serverError|42P07|relation "${t.name}" already exists`);
          created.push({ name: t.name, remote: t.name, schema: t.schema, key: t.key, skipped: [], design: { name: t.name, fields: t.fields.map((x) => ({ name: x.name, props: x.props })) } });
        }),
        insertRows: (t, rs) => call('insertRows', async () => {
          if (fake.hold) await new Promise<void>((_, reject) => { held = reject; });
          rowsOf(named(t.schema, t.name)!).push(...rs.map((values) => ({ values: [...values], version: next++ })));
        }),
        finishTable: (t) => call('finishTable', () => {
          if (t.nextId !== undefined) sequence.set(t.name, t.nextId);
          objects.push(...t.indexes.map((ix) => ({ schema: t.schema, name: ix.name, on: [t.name] })));
        }),
        countRows: (t) => call('countRows', () => rowsOf(named(t.schema, t.name)!).length),
        addForeignKeys: (fks) => call('addForeignKeys', () => {
          objects.push(...fks.map((x) => ({ schema: x.schema, name: x.name, on: [x.child, x.parent] })));
          return fks;
        }),
        dropTables: (ts) => call('dropTables', () => {
          const left: string[] = [];
          for (const t of ts) {
            if (fake.undroppable?.includes(t.name)) { left.push(t.name); continue; }
            const x = named(t.schema, t.name);
            if (x && created.includes(x)) { created.splice(created.indexOf(x), 1); data.delete(x.name); }
            for (let i = objects.length - 1; i >= 0; i--) if (objects[i]!.schema === t.schema && objects[i]!.on.includes(t.name)) objects.splice(i, 1);
          }
          return left;
        }),
      };
      if (o.migrate ?? true) conn.schema = writer;
      return conn;
    },
  };
  return fake;
}
