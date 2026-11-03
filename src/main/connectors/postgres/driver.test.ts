import { describe, expect, it } from 'vitest';
import type { Client } from 'pg';
import { sameName } from '../../../shared/field-types';
import { bindQuery, type QueryCatalog } from '../../../shared/query/bind';
import { parseSql } from '../../../shared/query/sql-parser';
import type { Connection, ReadRequest, RemoteTable } from '../connector';
import { findCondition, openPg, serverError } from './driver';
import { f, t } from '../../../shared/test-fixtures';
import { loadSnapshot, snapshotDesign } from '../../query/pass-through';
import { liveParams, liveUrl, withSchema } from './live';

const sqlError = (code: string, message = 'x') => Object.assign(new Error(message), { code });

describe('server errors (no server)', () => {
  it('a lost connection is marked lost, with its message (R11)', () => {
    for (const e of [sqlError('57P01', 'terminating connection due to administrator command'), sqlError('08006'), sqlError('ECONNRESET'),
      new Error('Connection terminated unexpectedly'), new Error('Client has encountered a connection error and is not queryable')]) {
      const x = serverError(e, false, 60);
      expect(x).toMatchObject({ message: e.message, lost: true });
    }
  });
  it('a statement pg refused on a broken client never left: unsent (a write runs again, I1); any other loss is not', () => {
    expect(serverError(new Error('Client has encountered a connection error and is not queryable'), false, 60)).toMatchObject({ lost: true, unsent: true });
    expect(serverError(new Error('Client was closed and is not queryable'), false, 60)).toMatchObject({ lost: true, unsent: true });
    expect(serverError(new Error('Connection terminated unexpectedly'), false, 60)).not.toHaveProperty('unsent');
    expect(serverError(sqlError('P0001', 'the ledger is not queryable'), false, 60)).not.toHaveProperty('unsent');
  });
  it('57014: bc:cancelled after our cancel, else the timeout in seconds (R12)', () => {
    expect(serverError(sqlError('57014'), true, 60).message).toBe('bc:cancelled');
    expect(serverError(sqlError('57014'), false, 60).message).toBe('bc:timeout|60');
    expect(serverError(sqlError('57014'), false, 0).message).toBe('bc:cancelled'); // no timeout set: someone else's cancel
  });
  it('anything else: bc:serverError|<code>|<message>, not lost', () => {
    const x = serverError(sqlError('42P01', 'relation "x" does not exist'), false, 60);
    expect(x.message).toBe('bc:serverError|42P01|relation "x" does not exist');
    expect(x).not.toHaveProperty('lost');
  });
});

/** `fn` with a connection of BaseCraft and the tables of a fresh schema (`admin`'s search_path). */
async function withTables(ddl: string, fn: (c: Connection, t: (remote: string) => Promise<RemoteTable>, admin: Client) => Promise<void>) {
  await withSchema(async (admin, schema) => {
    await admin.query(ddl);
    const { params, login } = liveParams();
    const conn = await openPg(params, login);
    try {
      await fn(conn, async (remote) => (await conn.table({ schema, remote, name: remote }))!, admin);
    } finally {
      await conn.close();
    }
  });
}

describe('find condition (no server)', () => {
  const table = (precision: number, scale = 0): RemoteTable => ({ name: 'B', remote: 'B', key: ['id'], skipped: [],
    design: t('B', [f('id', 'number', { numberSize: 'decimal', precision, scale })]) });
  it('a bigint key (Decimal(19, 0), an int8) is compared as int8, so the column is not converted (an index seek, final review 2)', () => {
    expect(findCondition(table(19), { id: '3000000000' }, null, 1)).toEqual({ sql: '"id" = $1::int8', params: [{ value: '3000000000', cast: 'int8' }] });
    expect(findCondition(table(19), { id: '-9223372036854775808' }, null, 3).params[0]!.cast).toBe('int8');
    // beyond int8's range (a numeric(19, 0): no overflow error), another decimal: as before
    expect(findCondition(table(19), { id: '9999999999999999999' }, null, 1).params[0]!.cast).toBe('numeric');
    expect(findCondition(table(10, 2), { id: '3.5' }, null, 1).params[0]!.cast).toBe('numeric');
  });
});

describe.skipIf(!liveUrl)('reads and writes on the server (live)', () => {
  it('insert, update and delete return stored values and fresh tokens; generated columns are never written', async () => {
    await withTables(`CREATE TABLE "T" (id int GENERATED ALWAYS AS IDENTITY PRIMARY KEY, n numeric(10,2), ok boolean,
        double numeric(12,2) GENERATED ALWAYS AS (n * 2) STORED, "At" time, d date)`, async (c, table) => {
      const t = await table('T');
      expect(t.design.fields.filter((f) => f.props.pgGenerated).map((f) => f.name)).toEqual(['id', 'double']);
      const a = await c.insert(t, { n: '1.5', ok: 1, At: '1899-12-30 08:30:00', d: '2026-10-30 00:00:00' });
      expect(a).toMatchObject({ ok: true, values: [1, '1.50', 1, '3.00', '1899-12-30 08:30:00', '2026-10-30 00:00:00'] });
      const ref = (a as { ref: string }).ref;
      expect(JSON.parse(ref).slice(0, 2)).toEqual([['id'], ['1']]);
      // M3: a token read under another key (Refresh Link changed it) is stale, never the key of another row
      expect(await c.update({ ...t, key: ['n'] }, ref, { n: '9' })).toEqual({ ok: false, conflict: 'deleted' });
      await expect(c.delete({ ...t, key: ['n'] }, [ref])).rejects.toThrow('bc:notFound');
      expect(await c.insert(t, { n: '2', double: '9' })).toEqual({ ok: false, errors: [{ field: 'double', code: 'readOnly' }] });
      expect(await c.insert(t, { n: '2', double: null })).toMatchObject({ ok: true, values: [2, '2.00', null, '4.00', null, null] });
      expect(await c.insert(t, { n: '1e20', double: null })).toEqual({ ok: false, errors: [{ field: 'n', code: 'outOfRange' }] }); // the one field written
      const u = await c.update(t, ref, { ok: 0, n: '4' });
      expect(u).toMatchObject({ ok: true, values: [1, '4.00', 0, '8.00', '1899-12-30 08:30:00', '2026-10-30 00:00:00'] });
      expect((u as { ref: string }).ref).not.toBe(ref); // a new xmin
      expect(await c.update(t, ref, { n: '5' })).toMatchObject({ ok: false, conflict: 'changed', current: [1, '4.00', 0, '8.00', '1899-12-30 08:30:00', '2026-10-30 00:00:00'], ref: (u as { ref: string }).ref });
      expect(await c.update(t, (u as { ref: string }).ref, {})).toMatchObject({ ok: true, ref: (u as { ref: string }).ref }); // nothing to write: checked only
      expect(await c.delete(t, [ref, (u as { ref: string }).ref])).toEqual({ ok: true, count: 1 }); // by key only (R8)
      expect(await c.update(t, ref, { n: '5' })).toEqual({ ok: false, conflict: 'deleted' });
    });
  });

  it('a delete of more than 1000 rows inside transaction() is part of it (C7 R14): rolled back with it', async () => {
    await withTables(`CREATE TABLE "D" (id int PRIMARY KEY); INSERT INTO "D" SELECT generate_series(1, 1500)`, async (c, table, admin) => {
      const d = await table('D');
      const tokens = Array.from({ length: 1500 }, (_, i) => JSON.stringify([['id'], [String(i + 1)], '0'])); // by key only
      await expect(c.transaction(async () => {
        expect(await c.delete(d, tokens)).toEqual({ ok: true, count: 1500 });
        throw new Error('undo');
      })).rejects.toThrow('undo');
      expect((await admin.query<{ n: number }>('SELECT count(*)::int AS n FROM "D"')).rows[0]!.n).toBe(1500);
    });
  });

  it('server refusals become field errors', async () => {
    await withTables(`CREATE TABLE "P" (id int PRIMARY KEY);
      CREATE TABLE "C" (n serial PRIMARY KEY, p int REFERENCES "P", code varchar(3), small int2, req text NOT NULL DEFAULT 'r', pos int CHECK (pos > 0),
        CONSTRAINT both_set CHECK (code IS NOT NULL OR small IS NULL));
      CREATE UNIQUE INDEX c_code ON "C" (code);
      INSERT INTO "P" VALUES (1), (2); INSERT INTO "C" (p, code) VALUES (1, 'abc');`, async (c, table) => {
      const p = await table('P'), t = await table('C');
      expect(await c.insert(t, { code: 'abc' })).toEqual({ ok: false, errors: [{ field: 'code', code: 'duplicate' }] });
      expect(await c.insert(t, { p: 9 })).toEqual({ ok: false, errors: [{ field: 'p', code: 'noParent' }] });
      expect(await c.insert(t, { req: null })).toEqual({ ok: false, errors: [{ field: 'req', code: 'required' }] });
      expect(await c.insert(t, { pos: -1 })).toMatchObject({ ok: false, errors: [{ field: 'pos', code: 'validation', message: expect.stringContaining('C_pos_check') }] });
      expect(await c.insert(t, { small: 1 })).toMatchObject({ ok: false, errors: [{ field: 'code', code: 'validation' }] }); // a table check: its first column
      expect(await c.insert(t, { code: 'abcd' })).toEqual({ ok: false, errors: [{ field: 'code', code: 'tooLong' }] });
      expect(await c.insert(t, { code: 'x', small: 99999 })).toEqual({ ok: false, errors: [{ field: '', code: 'outOfRange' }] }); // two fields: which one is unknown
      const child = await c.insert(t, { p: 2, code: 'k' });
      expect(await c.update(t, (child as { ref: string }).ref, { p: 9 })).toEqual({ ok: false, errors: [{ field: 'p', code: 'noParent' }] });
      // a delete is by key only (R8): any version; P's row 1 has a child, row 2 too: nothing deleted
      expect(await c.delete(p, [JSON.stringify([['id'], ['2'], '0']), JSON.stringify([['id'], ['1'], '0'])])).toEqual({ ok: false, reason: 'related', table: 'C' });
      // a referenced key changed: related records, as the local write layer says it (review minor 3)
      const p3 = await c.insert(p, { id: 3 });
      await c.insert(t, { p: 3, code: 'm' });
      expect(await c.update(p, (p3 as { ref: string }).ref, { id: 7 })).toEqual({ ok: false, errors: [{ field: 'id', code: 'related', table: 'C' }] });
    });
  });

  it('a self-referencing table: its foreign key written is noParent, its key referenced is related', async () => {
    await withTables(`CREATE TABLE "E" (id int PRIMARY KEY, boss int REFERENCES "E")`, async (c, table) => {
      const e = await table('E');
      const one = await c.insert(e, { id: 1 }) as { ref: string };
      const two = await c.insert(e, { id: 2, boss: 1 }) as { ref: string };
      expect(await c.update(e, two.ref, { boss: 9 })).toEqual({ ok: false, errors: [{ field: 'boss', code: 'noParent' }] });
      expect(await c.update(e, one.ref, { id: 5 })).toEqual({ ok: false, errors: [{ field: 'id', code: 'related', table: 'E' }] });
    });
  });

  it('a write the server skips is refused, never a conflict; a time key reads its value; an insert into a view returns no xmin', async () => { // review minors 1, 2, 4
    await withTables(`CREATE TABLE "G" (id int PRIMARY KEY, x int);
      CREATE FUNCTION skip() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.x < 0 THEN RETURN NULL; END IF; RETURN NEW; END $$;
      CREATE TRIGGER g_skip BEFORE INSERT OR UPDATE ON "G" FOR EACH ROW EXECUTE FUNCTION skip();
      CREATE TABLE "H" (t time PRIMARY KEY, x int); INSERT INTO "H" VALUES ('08:30:00', 1);
      CREATE VIEW "V" AS SELECT id, x FROM "G";`, async (c, table) => {
      const g = await table('G');
      const a = await c.insert(g, { id: 1, x: 1 }) as { ref: string };
      await expect(c.insert(g, { id: 2, x: -1 })).rejects.toThrow('bc:serverError|notWritten|G');
      await expect(c.update(g, a.ref, { x: -1 })).rejects.toThrow('bc:serverError|notWritten|G');
      expect(await c.update(g, a.ref, { x: 2 })).toMatchObject({ ok: true, values: [1, 2] });
      const h = await table('H');
      const catalog: QueryCatalog = { table: () => h.design, query: () => null, sourceOf: () => 'srv' };
      const plan = c.plan({ query: bindQuery(parseSql('SELECT * FROM H'), catalog), values: {}, filter: [], sort: [], refs: true, tables: () => h, now: new Date() });
      const { rows, refs } = await c.rows(plan, 0, 10);
      expect(rows).toEqual([['1899-12-30 08:30:00', 1]]);
      expect(await c.update(h, refs[0]!, { x: 2 })).toMatchObject({ ok: true, values: ['1899-12-30 08:30:00', 2] });
      // a keyless view: read-only in BaseCraft (describeSource); an insert through the API gets no reference, never a raw 42703
      expect(await c.insert(await table('V'), { id: 3, x: 3 })).toEqual({ ok: true, ref: null, values: [3, 3] });
    });
  });

  it('reads: parameters, Yes/No, pages; an outer join row whose key is Null gets no token (R4)', async () => {
    await withTables(`CREATE TABLE "A" (id int PRIMARY KEY, ok boolean); CREATE TABLE "B" (n int PRIMARY KEY, a int REFERENCES "A");
      INSERT INTO "A" VALUES (1, true), (2, false), (3, NULL); INSERT INTO "B" VALUES (10, 1);`, async (c, table) => {
      const tables = [await table('A'), await table('B')];
      const byName = (n: string) => tables.find((x) => sameName(x.name, n));
      const catalog: QueryCatalog = { table: (n) => byName(n)?.design ?? null, query: () => null, sourceOf: () => 'srv' };
      const read = async (sql: string, o: Partial<ReadRequest> = {}) => {
        const plan = c.plan({ query: bindQuery(parseSql(sql), catalog), values: {}, filter: [], sort: [], refs: true, tables: (n) => byName(n)!, now: new Date(), ...o });
        return { total: await c.count(plan), ...(await c.rows(plan, 0, 10)) };
      };
      const j = await read('SELECT B.n, A.id FROM A LEFT JOIN B ON A.id = B.a');
      expect(j.rows).toEqual([[10, 1], [null, 2], [null, 3]]);
      expect(j.refs.map((r) => (r === null ? null : JSON.parse(r).slice(0, 2)))).toEqual([[['n'], ['10']], null, null]); // B is the key table
      const y = await read('PARAMETERS [V] YesNo; SELECT id, ok FROM A WHERE ok = [V]', { values: { V: -1 } });
      expect(y).toMatchObject({ total: 1, rows: [[1, 1]] });
      expect((await read('SELECT id, ok FROM A WHERE ok = False')).rows).toEqual([[2, 0]]);
    });
  });

  it('a ROLLBACK that fails drops the connection: the outcome is lost, never run again (C5 R16)', async () => {
    await withTables('CREATE TABLE "T" (id int PRIMARY KEY)', async (c, table, admin) => {
      const t = await table('T');
      await expect(c.transaction(async () => {
        await c.find(t, { id: 1 }, 1, true);
        await admin.query(`SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE application_name = 'BaseCraft' AND query LIKE '%' || $1 || '%'`, [t.schema]);
        await new Promise((r) => setTimeout(r, 300));
        throw new Error('bc:notFound'); // a refusal: its ROLLBACK cannot reach the server
      })).rejects.toMatchObject({ lost: true });
    });
  });

  it('find compares an integer key above 2^31 (an int8 key)', async () => {
    await withTables(`CREATE TABLE "B" (id bigint GENERATED ALWAYS AS IDENTITY (START 3000000000) PRIMARY KEY, x int); INSERT INTO "B" (x) VALUES (7);
      CREATE TABLE "B2" (id bigint PRIMARY KEY, x int); INSERT INTO "B2" VALUES (3000000000, 8)`, async (c, table) => {
      const t = await table('B');
      expect(await c.find(t, { id: 3000000000 }, 2, false)).toMatchObject([{ values: [expect.anything(), 7] }]);
      // a plain int8 (Decimal(19, 0)): compared as int8; beyond its range, no row and no overflow
      expect(await c.find(await table('B2'), { id: '3000000000' }, 2, true)).toMatchObject([{ values: ['3000000000', 8] }]);
      expect(await c.find(await table('B2'), { id: '99999999999999999999' }, 2, false)).toEqual([]);
    });
  });

  it('Stop with nothing running sends nothing', async () => {
    const { params, login } = liveParams();
    const conn = await openPg(params, login);
    try {
      expect(await conn.cancel()).toBe(false);
    } finally {
      await conn.close();
    }
  });
});

describe.skipIf(!liveUrl)('native (live)', () => {
  const settles = () => new Promise((r) => setTimeout(r, 300));
  const withConn = async (fn: (c: Connection, admin: Client, schema: string) => Promise<void>) => withSchema(async (admin, schema) => {
    const { params, login } = liveParams();
    const c = await openPg(params, login);
    try { await fn(c, admin, schema); } finally { await c.close().catch(() => {}); }
  });
  it('the text as typed, the first result with columns, types from the metadata', () => withConn(async (c) => {
    const r = await c.native!(`CREATE TEMP TABLE t (n text, m money); INSERT INTO t VALUES ('a', 1.5), ('b', NULL);
      SELECT string_agg(n, ', ' ORDER BY n) AS noms, count(*), sum(m), now() AS le, '1 day'::interval AS i FROM t;`);
    expect(r.columns.map((x) => [x.name, x.props.type])).toEqual([['noms', 'longText'], ['count', 'number'], ['sum', 'longText'], ['le', 'dateTime'], ['i', 'longText']]);
    expect(r.rows[0]!.slice(0, 2)).toEqual(['a, b', '2']);
    expect(r.affected).toBe(3);
  }));
  it('typed NULLs come back as Null with their column type', () => withConn(async (c) => {
    const r = await c.native!('SELECT NULL::bool AS b, NULL::varchar AS v, true AS t');
    expect(r.columns.map((x) => [x.name, x.props.type])).toEqual([['b', 'yesNo'], ['v', 'longText'], ['t', 'yesNo']]);
    expect(r.rows).toEqual([[null, null, 1]]);
    const db = loadSnapshot(snapshotDesign(r.columns), r.rows); // a NULL bool is No in the snapshot
    try { expect(Object.values(db.prepare('SELECT * FROM "PassThrough"').get()!)).toEqual([0, null, 1]); } finally { db.close(); }
  }));
  it('an UPDATE has no columns and counts its rows', () => withConn(async (c) => {
    await c.native!('CREATE TEMP TABLE u (v int); INSERT INTO u VALUES (1), (1)');
    expect(await c.native!('UPDATE u SET v = 2')).toEqual({ columns: [], rows: [], affected: 2 });
  }));
  it("a syntax error is the server's message", () => withConn(async (c) => {
    await expect(c.native!('SELEC 1')).rejects.toThrow(/^bc:serverError\|42601\|.*syntax/);
  }));
  it('BEGIN without COMMIT dies with the connection', () => withConn(async (c, admin, schema) => {
    await admin.query('CREATE TABLE t2 (v int); INSERT INTO t2 VALUES (1)');
    await c.native!(`BEGIN; UPDATE ${schema}.t2 SET v = 2`);
    await c.close();
    expect((await admin.query('SELECT v FROM t2')).rows).toMatchObject([{ v: 1 }]);
  }));
  it('timeout and cancel', () => withConn(async (c) => {
    const { params, login } = liveParams();
    await expect(openPg({ ...params, timeout: 1 }, login).then(async (x) => { try { return await x.native!('SELECT pg_sleep(5)'); } finally { await x.close(); } })).rejects.toThrow('bc:timeout|1');
    const running = c.native!('SELECT pg_sleep(30)');
    await settles();
    expect(await c.cancel()).toBe(true);
    await expect(running).rejects.toThrow('bc:cancelled');
  }));
});
