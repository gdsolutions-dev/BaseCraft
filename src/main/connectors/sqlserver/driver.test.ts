import { describe, expect, it, vi } from 'vitest';
import { setTimeout as sleep } from 'node:timers/promises';
import { sameName } from '../../../shared/field-types';
import { bindQuery, type QueryCatalog } from '../../../shared/query/bind';
import { parseSql } from '../../../shared/query/sql-parser';
import type { Connection, ReadRequest, RemoteTable } from '../connector';
import { findCondition, openMs, serverError } from './driver';
import { f, t } from '../../../shared/test-fixtures';
import { mssqlLive, mssqlUrl, withDatabase } from './live';

const tdsError = (code: string, extra: object = {}, message = 'x') => Object.assign(new Error(message), { code, ...extra });

describe('server errors (no server)', () => {
  it('a lost connection is marked lost, with its message; a fatal server error (class 20+, a KILL) too (R12)', () => {
    for (const e of [tdsError('ESOCKET', {}, 'Connection lost - socket hang up'), tdsError('ECLOSE', {}, 'Connection closed before request completed.'),
      new Error('Connection lost - read ECONNRESET'), new Error('socket hang up'), tdsError('ECONNRESET', {}, 'read ECONNRESET'), tdsError('EPIPE', {}, 'write EPIPE'),
      tdsError('EREQUEST', { number: 596, class: 21 }, 'Cannot continue the execution because the session is in the kill state.')]) {
      expect(serverError(e, 60)).toMatchObject({ message: e.message, lost: true });
      expect(serverError(e, 60)).not.toHaveProperty('unsent');
    }
  });
  it('a request tedious refused before sending (EINVALIDSTATE) is unsent: a write runs again (I1)', () => {
    expect(serverError(tdsError('EINVALIDSTATE', {}, 'Requests can only be made in the LoggedIn state, not the Final state'), 60)).toMatchObject({ lost: true, unsent: true });
  });
  it('ECANCEL bc:cancelled, ETIMEOUT bc:timeout|<s>', () => {
    expect(serverError(tdsError('ECANCEL'), 60).message).toBe('bc:cancelled');
    expect(serverError(tdsError('ETIMEOUT'), 60).message).toBe('bc:timeout|60');
  });
  it('a write that times out is lost, never unsent: the client gave up, the server may have completed it (final review 1)', () => {
    const x = serverError(tdsError('ETIMEOUT', {}, 'Timeout: Request failed to complete in 1000ms'), 1, true);
    expect(x).toMatchObject({ message: 'Timeout: Request failed to complete in 1000ms', lost: true });
    expect(x).not.toHaveProperty('unsent');
    expect(serverError(tdsError('ECANCEL'), 1, true).message).toBe('bc:cancelled');
  });
  it('anything else: bc:serverError|<number>|<message> of the first error, not lost', () => {
    const x = serverError(tdsError('EREQUEST', { number: 208, class: 16 }, "Invalid object name 'x'."), 60);
    expect(x.message).toBe("bc:serverError|208|Invalid object name 'x'.");
    expect(x).not.toHaveProperty('lost');
    const many = new AggregateError([tdsError('EREQUEST', { number: 2627, class: 14 }, 'Violation'), tdsError('EREQUEST', { number: 3621, class: 0 }, 'terminated')]);
    expect(serverError(many, 60).message).toBe('bc:serverError|2627|Violation');
  });
});

describe('find condition (no server)', () => {
  const table = (msType: string, precision = 19): RemoteTable => ({ name: 'B', remote: 'B', key: ['id'], skipped: [],
    design: t('B', [f('id', 'number', { numberSize: 'decimal', precision, scale: 0, msType })]) });
  it('a bigint key (Decimal(19, 0)) is compared as bigint, so the column is not converted (an index seek, final review 2)', () => {
    expect(findCondition(table('bigint'), { id: '3000000000' }, true)).toEqual({ sql: 'a.[id] = CAST(@p0 AS bigint)', params: [{ value: '3000000000', cast: 'bigint' }] });
    expect(findCondition(table('bigint'), { id: '-9223372036854775808' }, true).params[0]!.cast).toBe('bigint');
    // beyond bigint's range (no row can match: never an overflow error), a decimal column: as before
    expect(findCondition(table('bigint'), { id: '9223372036854775808' }, true).params[0]!.cast).toBe('decimal(38, 0)');
    expect(findCondition(table('decimal(19,0)'), { id: '3000000000' }, true).params[0]!.cast).toBe('decimal(38, 0)');
  });
});

/** `fn` with a connection of BaseCraft to a fresh database seeded by `ddl` (one batch each). */
async function withTables(ddl: string[], fn: (c: Connection, t: (remote: string) => Promise<RemoteTable>, admin: { query(sql: string): Promise<unknown[][]> }) => Promise<void>) {
  await withDatabase(async (admin, database) => {
    for (const sql of ddl) await admin.query(sql);
    const { params, login } = mssqlLive();
    const conn = await openMs({ ...params, database }, login);
    try {
      await fn(conn, async (remote) => (await conn.table({ remote, name: remote }))!, admin);
    } finally {
      await conn.close();
    }
  });
}
const refOf = (w: unknown) => (w as { ref: string }).ref;

describe.skipIf(!mssqlUrl)('reads and writes on the server (live)', () => {
  it('insert, update and delete return stored values and fresh tokens; computed columns are never written', async () => {
    await withTables([`CREATE TABLE T (id int IDENTITY PRIMARY KEY, n decimal(10,2), ok bit, dbl AS n * 2, [At] time(7), d date, big decimal(38,10),
      m money, o datetimeoffset(7), rv rowversion)`], async (c, table) => {
      const t = await table('T');
      expect(t.design.fields.filter((f) => f.props.msComputed).map((f) => f.name)).toEqual(['id', 'dbl']);
      const a = await c.insert(t, { n: '1.5', ok: 1, At: '1899-12-30 08:30:00', d: '2026-10-30 00:00:00', big: '123456789012345678.1234567', m: 1234567.8912,
        o: '2026-10-30 12:34:56.1234567 +02:00' });
      expect(a).toMatchObject({ ok: true, values: [1, '1.50', 1, '3.00', '1899-12-30 08:30:00', '2026-10-30 00:00:00', '123456789012345678.123457', 1234567.8912,
        '2026-10-30 12:34:56.1234567 +02:00'] });
      const ref = refOf(a);
      expect(JSON.parse(ref)).toEqual([['id'], ['1'], expect.stringMatching(/^0x[0-9A-F]{16}$/)]);
      // M3: a token read under another key (Refresh Link changed it) is stale, never the key of another row
      expect(await c.update({ ...t, key: ['n'] }, ref, { n: '9' })).toEqual({ ok: false, conflict: 'deleted' });
      await expect(c.delete({ ...t, key: ['n'] }, [ref])).rejects.toThrow('bc:notFound');
      expect(await c.insert(t, { n: '2', dbl: '9' })).toEqual({ ok: false, errors: [{ field: 'dbl', code: 'readOnly' }] });
      expect(await c.insert(t, { n: '2', dbl: null })).toMatchObject({ ok: true, values: [2, '2.00', null, '4.00', null, null, null, null, null] });
      expect(await c.insert(t, {})).toMatchObject({ ok: true, values: [3, null, null, null, null, null, null, null, null] }); // DEFAULT VALUES
      const u = await c.update(t, ref, { ok: 0, n: '4' });
      expect(u).toMatchObject({ ok: true, values: [1, '4.00', 0, '8.00', '1899-12-30 08:30:00', '2026-10-30 00:00:00', '123456789012345678.123457', 1234567.8912,
        '2026-10-30 12:34:56.1234567 +02:00'] });
      expect(refOf(u)).not.toBe(ref); // a new rowversion
      expect(await c.update(t, ref, { n: '5' })).toMatchObject({ ok: false, conflict: 'changed', current: (u as { values: unknown[] }).values, ref: refOf(u) });
      expect(await c.update(t, refOf(u), {})).toMatchObject({ ok: true, ref: refOf(u) }); // nothing to write: checked only
      expect(await c.update(t, ref, {})).toMatchObject({ ok: false, conflict: 'changed' });
      expect(await c.delete(t, [ref, refOf(u)])).toEqual({ ok: true, count: 1 }); // by key only (R8)
      expect(await c.update(t, ref, { n: '5' })).toEqual({ ok: false, conflict: 'deleted' });
    });
  });

  it('server refusals become field errors', async () => {
    await withTables([`CREATE TABLE P (id int PRIMARY KEY); CREATE TABLE C (n int IDENTITY PRIMARY KEY, p int REFERENCES P, code nvarchar(3), small tinyint,
        req nvarchar(5) NOT NULL DEFAULT N'r', pos int CONSTRAINT pos_positive CHECK (pos > 0), d date);
      CREATE UNIQUE INDEX c_code ON C (code); INSERT INTO P VALUES (1), (2), (4); INSERT INTO C (p, code) VALUES (1, N'abc')`,
    // constraint names are unique per schema only: a foreign key `pos_positive` elsewhere, a check `p_ref` in dbo, P's row 4
    // referenced from another schema by `p_ref`
    "EXEC('CREATE SCHEMA other')", `CREATE TABLE other.O (id int PRIMARY KEY, y int, CONSTRAINT pos_positive FOREIGN KEY (y) REFERENCES other.O);
      ALTER TABLE C ADD CONSTRAINT p_ref CHECK (n > 0); CREATE TABLE other.R (n int PRIMARY KEY, p int CONSTRAINT p_ref REFERENCES dbo.P); INSERT INTO other.R VALUES (1, 4)`],
    async (c, table) => {
      const p = await table('P'), t = await table('C');
      expect(await c.insert(t, { code: 'abc' })).toEqual({ ok: false, errors: [{ field: 'code', code: 'duplicate' }] }); // 2601, a unique index
      expect(await c.insert(p, { id: 1 })).toEqual({ ok: false, errors: [{ field: 'id', code: 'duplicate' }] }); // 2627, the primary key
      expect(await c.insert(t, { p: 9 })).toEqual({ ok: false, errors: [{ field: 'p', code: 'noParent' }] });
      expect(await c.insert(t, { req: null })).toEqual({ ok: false, errors: [{ field: 'req', code: 'required' }] });
      expect(await c.insert(t, { pos: -1 })).toMatchObject({ ok: false, errors: [{ field: 'pos', code: 'validation', message: expect.stringContaining('pos_positive') }] });
      expect(await c.insert(t, { code: 'abcd' })).toEqual({ ok: false, errors: [{ field: 'code', code: 'tooLong' }] });
      expect(await c.insert(t, { small: 999 })).toEqual({ ok: false, errors: [{ field: 'small', code: 'outOfRange' }] });
      expect(await c.insert(t, { code: 'x', small: 999 })).toEqual({ ok: false, errors: [{ field: '', code: 'outOfRange' }] }); // two fields: which one is unknown
      expect(await c.insert(t, { d: '2026-02-30 00:00:00' })).toEqual({ ok: false, errors: [{ field: 'd', code: 'invalidDate' }] });
      const child = await c.insert(t, { p: 2, code: 'k' });
      expect(await c.update(t, refOf(child), { p: 9 }, {})).toEqual({ ok: false, errors: [{ field: 'p', code: 'noParent' }] });
      // a delete is by key only; P's rows 1 and 2 both have children: nothing deleted
      expect(await c.delete(p, [JSON.stringify([['id'], ['2'], '']), JSON.stringify([['id'], ['1'], ''])])).toEqual({ ok: false, reason: 'related', table: 'C' });
      // a referenced key changed: related records
      const p3 = await c.insert(p, { id: 3 });
      await c.insert(t, { p: 3, code: 'm' });
      expect(await c.update(p, refOf(p3), { id: 7 })).toEqual({ ok: false, errors: [{ field: 'id', code: 'related', table: 'C' }] });
      expect(await c.delete(p, [JSON.stringify([['id'], ['4'], ''])])).toEqual({ ok: false, reason: 'related', table: 'R' }); // other.p_ref, not dbo's
    });
  });

  it("a write's result is its own row, never the rows its trigger returns", async () => { // review fix 3: 'disallow results from triggers' is 0
    await withTables(['CREATE TABLE Tr (id int IDENTITY PRIMARY KEY, x int)',
      "EXEC('CREATE TRIGGER Tr_all ON Tr AFTER INSERT, UPDATE, DELETE AS SELECT 42, 42')"], async (c, table) => {
      const t = await table('Tr');
      const a = await c.insert(t, { x: 7 });
      expect(a).toMatchObject({ ok: true, values: [1, 7] });
      expect(await c.update(t, refOf(a), { x: 8 })).toMatchObject({ ok: true, values: [1, 8] });
      expect(await c.delete(t, [refOf(a)])).toEqual({ ok: true, count: 1 });
    });
  });

  it('a delete of more than one chunk runs in one transaction: a refusal deletes nothing', async () => {
    await withTables([`CREATE TABLE L (a int, b int, PRIMARY KEY (a, b)); CREATE TABLE R (n int PRIMARY KEY, a int, b int, FOREIGN KEY (a, b) REFERENCES L);
      WITH n AS (SELECT TOP (1500) ROW_NUMBER() OVER (ORDER BY (SELECT 1)) AS i FROM sys.all_columns) INSERT INTO L SELECT i, i % 7 FROM n;
      INSERT INTO R VALUES (1, 1500, 1500 % 7)`], async (c, table) => {
      const l = await table('L');
      const refs = Array.from({ length: 1500 }, (_, k) => JSON.stringify([['a', 'b'], [String(k + 1), String((k + 1) % 7)], ''])); // 3 000 parameters: two chunks
      expect(await c.delete(l, refs)).toEqual({ ok: false, reason: 'related', table: 'R' }); // the last row, in the second chunk
      const plan = c.plan(readOf(l, 'SELECT * FROM L'));
      expect(await c.count(plan)).toBe(1500); // the first chunk rolled back
      expect(await c.delete(l, refs.slice(0, 1499))).toEqual({ ok: true, count: 1499 });
      expect(await c.count(plan)).toBe(1);
    });
  });

  it('a refused chunked delete inside a transaction leaves it open: what follows is still rolled back with it', async () => {
    await withTables([`CREATE TABLE L (a int PRIMARY KEY); CREATE TABLE R (n int PRIMARY KEY, a int REFERENCES L); CREATE TABLE X (id int PRIMARY KEY);
      WITH n AS (SELECT TOP (3000) ROW_NUMBER() OVER (ORDER BY (SELECT 1)) AS i FROM sys.all_columns) INSERT INTO L SELECT i FROM n;
      INSERT INTO R VALUES (1, 3000)`], async (c, table) => {
      const [l, x] = [await table('L'), await table('X')];
      const refs = Array.from({ length: 3000 }, (_, k) => JSON.stringify([['a'], [String(k + 1)], ''])); // several chunks, the last row referenced
      await expect(c.transaction(async () => {
        expect(await c.delete(l, refs)).toEqual({ ok: false, reason: 'related', table: 'R' });
        await c.insert(x, { id: 1 }); // still inside the caller's transaction
        throw new Error('stop');
      })).rejects.toThrow('stop');
      expect(await c.count(c.plan(readOf(l, 'SELECT * FROM L')))).toBe(3000);
      expect(await c.count(c.plan(readOf(x, 'SELECT * FROM X')))).toBe(0);
    });
  });

  it('a ROLLBACK that fails drops the connection: the outcome is lost, never run again (C5 R16)', async () => {
    await withTables(['CREATE TABLE T (id int PRIMARY KEY)'], async (c, table, admin) => {
      const t = await table('T');
      await expect(c.transaction(async () => {
        await c.find(t, { id: 1 }, 1, true);
        // KILL refuses to run inside a transaction: the admin's own connection is outside of it
        await admin.query(`DECLARE @sql nvarchar(max) = N''; SELECT @sql += N'KILL ' + CAST(session_id AS nvarchar(10)) + N'; ' FROM sys.dm_exec_sessions
          WHERE program_name = N'BaseCraft' AND database_id = DB_ID(); EXEC(@sql)`);
        await sleep(300);
        throw new Error('bc:notFound'); // a refusal: its ROLLBACK cannot reach the server
      })).rejects.toMatchObject({ lost: true });
    });
  });

  it('a write that times out is lost (never sent again), the connection closed, inside a transaction too; a read keeps bc:timeout (final review 1)', async () => {
    await withTables(['CREATE TABLE T (id int PRIMARY KEY, x int); INSERT INTO T VALUES (1, 1)',
      "CREATE TRIGGER slow ON T AFTER INSERT, UPDATE AS WAITFOR DELAY '00:00:05'"], async (c, table, admin) => {
      const t = await table('T'), [r] = await c.find(t, { id: 1 }, 1, false); // read on the plain connection
      const { params, login } = mssqlLive();
      const database = (await admin.query('SELECT DB_NAME()'))[0]![0] as string;
      const open = () => openMs({ ...params, database, timeout: 2 }, login); // only the slow statements on it
      let slow = await open();
      try {
        await expect(slow.insert(t, { id: 2, x: 2 })).rejects.toMatchObject({ lost: true });
        await expect(slow.find(t, { id: 1 }, 1, false)).rejects.toMatchObject({ lost: true, unsent: true }); // closed: the next call reconnects
        await slow.close();
        slow = await open();
        await expect(slow.transaction(async () => slow.update(t, r!.ref!, { x: 3 }))).rejects.toMatchObject({ lost: true });
        await vi.waitFor(async () => expect(await admin.query(`SELECT count(*) FROM sys.dm_tran_session_transactions s JOIN sys.dm_exec_sessions x
          ON x.session_id = s.session_id WHERE x.program_name = N'BaseCraft' AND x.database_id = DB_ID()`)).toEqual([[0]]), { timeout: 5000, interval: 100 }); // closed: rolled back
        await slow.close();
        slow = await open();
        await admin.query('BEGIN TRAN; SELECT TOP (0) * FROM T WITH (TABLOCKX, HOLDLOCK)');
        await expect(slow.find(t, { id: 1 }, 1, false)).rejects.toThrow(/^bc:timeout\|2$/);
        await admin.query('ROLLBACK');
      } finally {
        await slow.close();
      }
    });
  });

  it('find compares an integer key above 2^31 (a bigint key)', async () => {
    await withTables(['CREATE TABLE B (id bigint IDENTITY(3000000000, 1) PRIMARY KEY, x int); INSERT INTO B (x) VALUES (7)',
      'CREATE TABLE B2 (id bigint PRIMARY KEY, x int); INSERT INTO B2 VALUES (3000000000, 8)'], async (c, table) => {
      const t = await table('B');
      expect(await c.find(t, { id: 3000000000 }, 2, false)).toMatchObject([{ values: [expect.anything(), 7] }]);
      // a plain bigint (Decimal(19, 0)): compared as bigint; beyond its range, no row and no overflow
      expect(await c.find(await table('B2'), { id: '3000000000' }, 2, true)).toMatchObject([{ values: ['3000000000', 8] }]);
      expect(await c.find(await table('B2'), { id: '99999999999999999999' }, 2, false)).toEqual([]);
    });
  });

  it('a write the server ignores is refused (an INSTEAD OF trigger); a keyless view returns its row without a reference', async () => { // Review Focus 4
    await withTables(['CREATE TABLE G (id int PRIMARY KEY, x int, rv rowversion); INSERT INTO G (id, x) VALUES (1, 1)',
      "EXEC('CREATE VIEW W AS SELECT id, x FROM G')", "EXEC('CREATE VIEW V AS SELECT id, x FROM G')",
      "EXEC('CREATE TRIGGER V_ins ON V INSTEAD OF INSERT AS BEGIN SET NOCOUNT ON; END')",
      "EXEC('CREATE TRIGGER G_upd ON G INSTEAD OF UPDATE AS BEGIN SET NOCOUNT ON; END')"], async (c, table) => {
      const g = await table('G');
      const [row] = (await c.rows(c.plan(readOf(g, 'SELECT * FROM G')), 0, 1)).refs;
      await expect(c.update(g, row!, { x: 2 })).rejects.toThrow('bc:serverError|notWritten|G');
      await expect(c.insert(await table('V'), { id: 2, x: 2 })).rejects.toThrow('bc:serverError|notWritten|V');
      expect(await c.insert(await table('W'), { id: 3, x: 3 })).toEqual({ ok: true, ref: null, values: [3, 3] });
    });
  });

  it('reads: identifiers quoted, parameters, Yes/No, pages; a page of 0 rows sends nothing', async () => {
    await withTables([`CREATE TABLE [Clients]] 2026] (id int PRIMARY KEY, [O'Brien] nvarchar(20), ok bit);
      INSERT INTO [Clients]] 2026] VALUES (1, N'a', 1), (2, N'b', 0), (3, N'c', NULL)`], async (c, table) => {
      const t = (await c.table({ remote: 'Clients] 2026', name: 'C2026' }))!;
      const read = async (sql: string, o: Partial<ReadRequest> = {}) => {
        const plan = c.plan({ ...readOf(t, sql), ...o });
        return { total: await c.count(plan), ...(await c.rows(plan, 0, 10)) };
      };
      const y = await read('PARAMETERS [V] YesNo; SELECT id, ok FROM C2026 WHERE ok = [V]', { values: { V: -1 } });
      expect(y).toMatchObject({ total: 1, rows: [[1, 1]], refs: [JSON.stringify([['id'], ['1'], ''])] });
      expect((await read('SELECT id, ok FROM C2026 WHERE ok = False')).rows).toEqual([[2, 0]]);
      expect(await c.rows(c.plan(readOf(t, 'SELECT * FROM C2026')), 0, 0)).toEqual({ rows: [], refs: [] });
      const u = await c.update(t, JSON.stringify([['id'], ['2'], '']), { "O'Brien": 'z' }, { "O'Brien": 'b' });
      expect(u).toMatchObject({ ok: true, values: [2, 'z', 0] });
    });
  });

  it('native: the batch as typed, the first result set, its rows counted with the others (R13)', async () => {
    await withTables([], async (c) => {
      const r = await c.native!(`CREATE TABLE #t (n nvarchar(10)); INSERT #t VALUES (N'a'), (N'b');
        SELECT STRING_AGG(n, ', ') WITHIN GROUP (ORDER BY n) AS noms, COUNT(*) AS nb, SYSDATETIME() AS le, CAST(1.5 AS money) AS m FROM #t;
        SELECT 1 AS autre;`);
      expect(r.columns.map((x) => [x.name, x.props.type])).toEqual([['noms', 'longText'], ['nb', 'number'], ['le', 'dateTime'], ['m', 'currency']]);
      expect(r.rows).toHaveLength(1);
      expect(r.rows[0]!.slice(0, 2)).toEqual(['a, b', 2]); expect(r.rows[0]![3]).toBe(1.5);
      expect(r.rows[0]![2]).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
      expect(r.affected).toBe(4); // two inserted, one row, one row
      const v = await c.native!(`SELECT CAST('2026-10-31 23:30:05.1234567' AS datetime2(7)) AS d, CAST(9007199254740993 AS bigint) AS b,
        CAST(12.345 AS decimal(10,3)) AS x, CAST(N'z' AS nvarchar(5)) AS s, CAST(NULL AS bit) AS y, CAST('08:30' AS time) AS t`);
      expect(v.rows).toEqual([['2026-10-31 23:30:05', '9007199254740993', '12.345', 'z', null, '1899-12-30 08:30:00']]); // the wall clock, not the workstation's zone
    });
  });

  it('native: an UPDATE has no columns and counts its rows; a syntax error is the server\'s message', async () => {
    await withTables(['CREATE TABLE T (n int); INSERT INTO T VALUES (1), (2), (3)'], async (c) => {
      expect(await c.native!('UPDATE T SET n = n + 1 WHERE n > 1')).toEqual({ columns: [], rows: [], affected: 2 });
      await expect(c.native!('SELECT (1')).rejects.toThrow(/^bc:serverError\|102\|/);
    });
  });

  it('native: timeout and cancel', async () => {
    const { params, login } = mssqlLive();
    const slow = await openMs({ ...params, timeout: 1 }, login);
    try {
      await expect(slow.native!("WAITFOR DELAY '00:00:05'")).rejects.toThrow(/^bc:timeout\|1$/);
    } finally {
      await slow.close();
    }
    const conn = await openMs(params, login);
    try {
      const run = conn.native!("WAITFOR DELAY '00:00:05'");
      const started = Date.now();
      await sleep(300);
      expect(await conn.cancel()).toBe(true);
      await expect(run).rejects.toThrow(/^bc:cancelled$/);
      expect(Date.now() - started).toBeLessThan(4000);
    } finally {
      await conn.close();
    }
  });

  it('Stop with nothing running sends nothing', async () => {
    const { params, login } = mssqlLive();
    const conn = await openMs(params, login);
    try {
      expect(await conn.cancel()).toBe(false);
    } finally {
      await conn.close();
    }
  });
});

/** A read request of `sql` over table `t` alone. */
function readOf(t: RemoteTable, sql: string): ReadRequest {
  const catalog: QueryCatalog = { table: (n) => (sameName(n, t.name) ? t.design : null), query: () => null, sourceOf: () => 'srv' };
  return { query: bindQuery(parseSql(sql), catalog), values: {}, filter: [], sort: [], refs: true, tables: () => t, now: new Date() };
}
