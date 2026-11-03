import tls from 'node:tls';
import pg from 'pg';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { connectError, offsetZone, openPg, pgConfig, pgSsl } from './driver';
import { liveParams, liveUrl, withSchema } from './live';
import { pgParams } from './params';

const P = pgParams({ host: 'DB.example', database: 'ventes', user: 'ana' });

describe('connection settings (no server)', () => {
  it('TLS: verify-full checks against Node\'s and the system\'s CAs, require does not check, disable is plain', () => { // R11
    const full = pgSsl('verify-full') as tls.ConnectionOptions;
    expect(full.rejectUnauthorized).toBe(true);
    expect(full.ca).toEqual([...tls.getCACertificates('default'), ...tls.getCACertificates('system')]);
    expect(pgSsl('require')).toEqual({ rejectUnauthorized: false });
    expect(pgSsl('disable')).toBe(false);
  });
  it('connect timeout, application name, the login as given', () => {
    expect(pgConfig(P, { user: 'bob', password: 'pw' })).toMatchObject({ host: 'db.example', port: 5432, database: 'ventes', user: 'bob', password: 'pw',
      connectionTimeoutMillis: 15_000, application_name: 'BaseCraft' });
    expect(pgConfig({ ...P, timeout: 5 }, { user: 'u', password: '' })).toMatchObject({ connectionTimeoutMillis: 5_000 });
    expect(pgConfig({ ...P, timeout: 0 }, { user: 'u', password: '' })).toMatchObject({ connectionTimeoutMillis: 15_000 });
    expect(pgConfig(P, { user: 'u', password: '' })).not.toHaveProperty('statement_timeout'); // set by the session (below)
  });
  it('type parsers: numbers and booleans parsed, everything else the server\'s text', () => { // R13
    const parse = (oid: number, v: string) => pgConfig(P, { user: 'u', password: '' }).types!.getTypeParser(oid, 'text')(v);
    expect(parse(23, '42')).toBe(42); expect(parse(21, '-3')).toBe(-3); expect(parse(701, '0.5')).toBe(0.5); expect(parse(16, 't')).toBe(true);
    for (const [oid, v] of [[20, '9007199254740993'], [1700, '1.10'], [1114, '2026-10-30 12:34:56.789123'], [1184, '2026-10-30 12:34:56+01'], [1082, '2026-10-30'],
      [114, '{"a":1}'], [3802, '{"a": 1}'], [1007, '{1,2}']] as const) expect(parse(oid, v)).toBe(v);
  });
  it('connect errors: a refused login needsLogin with the key, a certificate, anything else cannotConnect with the label', () => {
    const err = (code: string) => connectError(Object.assign(new Error('x'), { code }), P).message;
    expect(err('28P01')).toBe('bc:linkUnavailable|needsLogin|postgresql://db.example:5432/ventes?tls=verify-full');
    expect(err('28000')).toBe('bc:linkUnavailable|needsLogin|postgresql://db.example:5432/ventes?tls=verify-full');
    for (const code of ['UNABLE_TO_VERIFY_LEAF_SIGNATURE', 'SELF_SIGNED_CERT_IN_CHAIN', 'DEPTH_ZERO_SELF_SIGNED_CERT', 'ERR_TLS_CERT_ALTNAME_INVALID', 'CERT_HAS_EXPIRED'])
      expect(err(code)).toBe('bc:linkUnavailable|certificate|db.example:5432/ventes');
    for (const code of ['ENOTFOUND', 'ECONNREFUSED', 'ETIMEDOUT', '3D000'])
      expect(err(code)).toBe('bc:linkUnavailable|cannotConnect|db.example:5432/ventes');
    expect(connectError(new Error('Connection terminated due to connection timeout'), P).message).toBe('bc:linkUnavailable|cannotConnect|db.example:5432/ventes');
  });
});

describe('openPg over a faked pg client (no server)', () => {
  type Reply = { rows: unknown[] } | Error;
  /** pg's Client with connect/end stubbed; each query gets the next reply (an Error rejects). The SQL and values are recorded. */
  function fakePg(...replies: Reply[]) {
    const sent: { sql: string; values: unknown[] }[] = [];
    const connect = vi.spyOn(pg.Client.prototype, 'connect').mockResolvedValue(undefined);
    vi.spyOn(pg.Client.prototype, 'end').mockResolvedValue(undefined);
    vi.spyOn(pg.Client.prototype, 'query').mockImplementation((async (sql: string, values?: unknown[]) => {
      sent.push({ sql, values: values ?? [] });
      const r = replies.shift() ?? { rows: [] };
      if (r instanceof Error) throw r;
      return r;
    }) as never);
    return { sent, connect };
  }
  const ok = { rows: [{ version: 170000, collation: 'und-x-icu' }] };
  const login = { user: 'ana', password: 'pw' };
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const sqlError = (code: string) => Object.assign(new Error('x'), { code });
  afterEach(() => { vi.restoreAllMocks(); });

  it('a CA lookup that fails is a connect failure, never a raw error; nothing is sent', async () => { // review minor 1
    vi.spyOn(tls, 'getCACertificates').mockImplementation(() => { throw new Error('no store'); });
    const { connect } = fakePg();
    await expect(openPg(P, login)).rejects.toThrow(/^bc:linkUnavailable\|cannotConnect\|db\.example:5432\/ventes$/);
    expect(connect).not.toHaveBeenCalled();
  });
  it('the session sets its zone and statement timeout always, 0 meaning none', async () => { // review minor 4
    const { sent } = fakePg(ok, ok);
    await (await openPg(P, login)).close();
    await (await openPg({ ...P, timeout: 0 }, login)).close();
    expect(sent.map((x) => x.values)).toEqual([[zone, '60000'], [zone, '0']]);
    expect(sent[0]!.sql).toContain("pg_catalog.set_config('statement_timeout', $2, false)");
  });
  it('a zone the server lacks (22023): once more with the current offset; anything else fails the connect', async () => { // review minor 5
    const a = fakePg(sqlError('22023'), ok);
    await (await openPg(P, login)).close();
    expect(a.sent.map((x) => x.values[0])).toEqual([zone, offsetZone()]);
    vi.restoreAllMocks();
    fakePg(sqlError('22023'), sqlError('22023'));
    await expect(openPg(P, login)).rejects.toThrow('bc:linkUnavailable|cannotConnect|db.example:5432/ventes');
    vi.restoreAllMocks();
    const b = fakePg(sqlError('42501'));
    await expect(openPg(P, login)).rejects.toThrow('bc:linkUnavailable|cannotConnect|');
    expect(b.sent).toHaveLength(1);
  });
  it('offsetZone: hours east of UTC, as PostgreSQL reads a number', () => {
    expect(offsetZone({ getTimezoneOffset: () => -60 } as Date)).toBe('1');
    expect(offsetZone({ getTimezoneOffset: () => -345 } as Date)).toBe('5.75');
    expect(offsetZone({ getTimezoneOffset: () => 210 } as Date)).toBe('-3.5');
  });
  it('a server below 14 is serverVersion', async () => {
    fakePg({ rows: [{ version: 130011, collation: null }] });
    await expect(openPg(P, login)).rejects.toThrow('bc:linkUnavailable|serverVersion|db.example:5432/ventes');
  });
  it('the catalog: no partitions, schemas the user can use, catalog names qualified', async () => { // review minors 2, 3, 6
    const { sent } = fakePg(ok, { rows: [] });
    const conn = await openPg(P, login);
    expect(await conn.tables()).toEqual([]);
    for (const { sql } of sent) {
      expect(sql).not.toMatch(/(?<!pg_catalog\.)\b(pg_(class|namespace|attribute|type|attrdef|index|collation|get_expr)|format_type|has_\w+_privilege|array_position|set_config|current_setting|regnamespace|int[24])\b/);
    }
    expect(sent[1]!.sql).toContain('NOT c.relispartition');
    expect(sent[1]!.sql).toContain("pg_catalog.has_schema_privilege(n.oid, 'USAGE')");
    expect(sent[1]!.sql).toContain("pg_catalog.has_table_privilege(c.oid, 'SELECT')");
  });
});

describe.skipIf(!liveUrl)('PostgreSQL server (live)', () => {
  it('connects with TLS as the URL asks and lists the schema\'s tables with their keys', async () => {
    await withSchema(async (client, schema) => {
      await client.query('CREATE TABLE "Clients 2026" (id bigint generated always as identity primary key, "O""Brien" text)');
      await client.query('CREATE VIEW "V" AS SELECT * FROM "Clients 2026"');
      const { params, login } = liveParams();
      const ssl = (await client.query<{ ssl: boolean }>('SELECT ssl FROM pg_stat_ssl WHERE pid = pg_backend_pid()')).rows[0]!.ssl;
      expect(ssl).toBe(params.tls !== 'disable');
      const conn = await openPg(params, login);
      try {
        const mine = (await conn.tables()).filter((t) => t.schema === schema);
        expect(mine.map((t) => [t.name, t.remote, t.key, t.unsupported])).toEqual([
          [`${schema}_Clients 2026`, 'Clients 2026', ['id'], undefined], [`${schema}_V`, 'V', [], undefined]]);
        expect(mine[0]!.design.fields.map((f) => [f.name, f.props.type, f.props.primaryKey])).toEqual([['id', 'autoNumber', true], ['O"Brien', 'longText', false]]);
        expect(mine[1]!.design.fields.map((f) => [f.name, f.props.type, f.props.numberSize])).toEqual([['id', 'number', 'decimal'], ['O"Brien', 'longText', undefined]]);
        expect(await conn.table({ schema, remote: 'V', name: 'Vue' })).toMatchObject({ name: 'Vue', key: [], design: { name: 'Vue' } });
        expect(await conn.table({ schema, remote: 'absent', name: 'absent' })).toBeNull();
      } finally {
        await conn.close();
      }
    });
  });
  it('a wrong password is needsLogin', async () => {
    const { params, login } = liveParams();
    await expect(openPg({ ...params }, { user: login.user, password: 'wrong' })).rejects.toThrow(/^bc:linkUnavailable\|needsLogin\|/);
  });
  it('an unknown host is cannotConnect', async () => {
    const { params, login } = liveParams();
    await expect(openPg({ ...params, host: 'nonexistent.invalid' }, login)).rejects.toThrow(/^bc:linkUnavailable\|cannotConnect\|nonexistent\.invalid:/);
  });
});
