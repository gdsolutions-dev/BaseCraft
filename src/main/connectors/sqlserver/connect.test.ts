import tls from 'node:tls';
import { describe, expect, it } from 'vitest';
import { connectError, msConfig, msSupported, openMs } from './driver';
import { mssqlLive, mssqlMissingOnCi, mssqlUrl, withDatabase } from './live';
import { msParams } from './params';

const P = msParams({ host: 'DB.example', database: 'ventes', user: 'ana' });
const login = { user: 'bob', password: 'pw' };

describe('connection settings (no server)', () => {
  it('encryption: verify-full checks against Node\'s and the system\'s CAs, require trusts the server, disable is plain', () => { // R3
    expect(msConfig(P, login).options).toMatchObject({ encrypt: true, trustServerCertificate: false,
      cryptoCredentialsDetails: { ca: [...tls.getCACertificates('default'), ...tls.getCACertificates('system')] } });
    expect(msConfig({ ...P, tls: 'require' }, login).options).toMatchObject({ encrypt: true, trustServerCertificate: true });
    expect(msConfig({ ...P, tls: 'require' }, login).options).not.toHaveProperty('cryptoCredentialsDetails');
    expect(msConfig({ ...P, tls: 'disable' }, login).options).toMatchObject({ encrypt: false });
  });
  it('the login as given, SQL authentication, application name, timeouts, UTC dates', () => { // R3, R4
    expect(msConfig(P, login)).toMatchObject({ server: 'db.example', authentication: { type: 'default', options: { userName: 'bob', password: 'pw' } },
      options: { port: 1433, database: 'ventes', appName: 'BaseCraft', connectTimeout: 15_000, requestTimeout: 60_000, useUTC: true } });
    expect(msConfig({ ...P, timeout: 5 }, login).options).toMatchObject({ connectTimeout: 5_000, requestTimeout: 5_000 });
    expect(msConfig({ ...P, timeout: 0 }, login).options).toMatchObject({ connectTimeout: 15_000, requestTimeout: 0 });
  });
  it('a named instance: no port (SQL Server Browser finds it)', () => { // R2
    const o = msConfig(msParams({ host: 'srv', instance: 'SQLEXPRESS', database: 'd', user: 'u' }), login).options!;
    expect(o).toMatchObject({ instanceName: 'SQLEXPRESS' });
    expect(o).not.toHaveProperty('port');
  });
  it('connect errors: a refused login needsLogin with the key, a certificate, anything else cannotConnect with the label', () => { // R12
    const err = (code: string, extra: object = {}) => connectError(Object.assign(new Error('x'), { code, ...extra }), P).message;
    expect(err('ELOGIN', { numbers: [18456] })).toBe('bc:linkUnavailable|needsLogin|sqlserver://db.example:1433/ventes?tls=verify-full');
    expect(err('ELOGIN', { numbers: [4060, 18456] })).toBe('bc:linkUnavailable|cannotConnect|db.example:1433/ventes'); // an unknown database
    for (const n of [18487, 18488]) expect(err('ELOGIN', { numbers: [n] })).toBe('bc:linkUnavailable|passwordExpired|db.example:1433/ventes'); // the login prompt cannot change it
    for (const code of ['DEPTH_ZERO_SELF_SIGNED_CERT', 'SELF_SIGNED_CERT_IN_CHAIN', 'UNABLE_TO_VERIFY_LEAF_SIGNATURE', 'ERR_TLS_CERT_ALTNAME_INVALID', 'CERT_HAS_EXPIRED'])
      expect(err('ESOCKET', { cause: Object.assign(new Error('tls'), { code }) })).toBe('bc:linkUnavailable|certificate|db.example:1433/ventes');
    for (const code of ['ESOCKET', 'ETIMEOUT', 'EINSTLOOKUP', 'EENCRYPT'])
      expect(err(code)).toBe('bc:linkUnavailable|cannotConnect|db.example:1433/ventes');
  });
  it('server version: 2016 (13) or later; Azure SQL Database (edition 5) and Managed Instance (8) whatever their major version', () => { // R4
    expect(msSupported(13, 3)).toBe(true); expect(msSupported(16, 4)).toBe(true);
    expect(msSupported(12, 3)).toBe(false); expect(msSupported(null, 2)).toBe(false); expect(msSupported(null, null)).toBe(false);
    expect(msSupported(12, 5)).toBe(true); expect(msSupported(12, 8)).toBe(true);
  });
  it('live tests: a missing URL fails on the Linux CI runner only', () => { // R15
    expect(mssqlMissingOnCi({ CI: '1' }, 'linux')).toBe(true);
    expect(mssqlMissingOnCi({}, 'linux')).toBe(false);
    expect(mssqlMissingOnCi({ CI: '1' }, 'win32')).toBe(false);
    expect(mssqlMissingOnCi({ CI: '1', BASECRAFT_MSSQL_TEST_URL: 'sqlserver://x' }, 'linux')).toBe(false);
  });
});

describe.skipIf(!mssqlUrl)('SQL Server (live)', () => {
  it('connects as the URL asks and lists tables with keys and rowversion', async () => {
    await withDatabase(async (admin, database) => {
      await admin.query("CREATE TABLE [Clients]] 2026] (id bigint IDENTITY PRIMARY KEY, [O'Brien] nvarchar(20) NOT NULL, rv rowversion, x xml)");
      await admin.query('EXEC(\'CREATE VIEW V AS SELECT id, [O\'\'Brien] FROM [Clients]] 2026]\')');
      await admin.query('EXEC(\'CREATE SCHEMA compta\')');
      await admin.query('CREATE TABLE compta.Factures (n int PRIMARY KEY, d datetime2(7), m money)');
      const { params, login } = mssqlLive();
      const conn = await openMs({ ...params, database }, login);
      try {
        const tables = await conn.tables();
        // `]` is no BaseCraft name: that link is offered under another name (linkedAs)
        expect(tables.map((t) => [t.name, t.remote, t.schema, t.key, t.version, t.skipped, t.unsupported])).toEqual([
          ['compta_Factures', 'Factures', 'compta', ['n'], undefined, [], undefined],
          ['Clients] 2026', 'Clients] 2026', 'dbo', ['id'], 'rv', ['x'], 'nameInvalid'], ['V', 'V', 'dbo', [], undefined, [], undefined]]);
        tables.shift();
        expect(tables[0]!.design.fields.map((f) => [f.name, f.props.type, f.props.primaryKey, f.props.required, f.props.msType])).toEqual([
          ['id', 'autoNumber', true, false, 'bigint'], ["O'Brien", 'shortText', false, true, 'nvarchar(20)']]);
        expect(tables[0]!.design.fields[1]!.props).toMatchObject({ msCi: true, msCollation: expect.any(String) });
        expect(tables[1]!.design.fields[0]!.props).toMatchObject({ type: 'number', numberSize: 'decimal', msComputed: true });
        expect(await conn.table({ schema: 'compta', remote: 'Factures', name: 'Fact' })).toMatchObject({ name: 'Fact', key: ['n'], design: { name: 'Fact' } });
        expect(await conn.table({ remote: 'V', name: 'V' })).toMatchObject({ schema: 'dbo', key: [] }); // dbo by default
        expect(await conn.table({ schema: 'dbo', remote: 'absent', name: 'absent' })).toBeNull();
        // R3, R4: BaseCraft's session as the server sees it
        const [s] = await admin.query(`SELECT c.encrypt_option, s.language, s.date_format, s.date_first, s.lock_timeout, s.arithabort, s.concat_null_yields_null
          FROM sys.dm_exec_sessions s JOIN sys.dm_exec_connections c ON c.session_id = s.session_id
          WHERE s.program_name = 'BaseCraft' AND s.database_id = DB_ID()`);
        expect(s).toEqual([params.tls === 'disable' ? 'FALSE' : 'TRUE', 'us_english', 'ymd', 7, -1, true, true]);
      } finally {
        await conn.close();
      }
    });
  });
  it('a case-sensitive database: its text columns are not msCi', async () => { // R8
    await withDatabase(async (admin, database) => {
      await admin.query('CREATE TABLE T (id int PRIMARY KEY, s nvarchar(10))');
      const { params, login } = mssqlLive();
      const conn = await openMs({ ...params, database }, login);
      try {
        expect((await conn.tables())[0]!.design.fields[1]!.props).toMatchObject({ msCi: false, msCollation: 'Latin1_General_100_CS_AS' });
      } finally {
        await conn.close();
      }
    }, { collation: 'Latin1_General_100_CS_AS' });
  });
  it('a system-versioned table: its period columns read-only and never Required; its history table linked too', async () => { // review Important 1
    await withDatabase(async (admin, database) => {
      await admin.query(`CREATE TABLE T (id int PRIMARY KEY, v nvarchar(10), vf datetime2 GENERATED ALWAYS AS ROW START NOT NULL, vt datetime2 GENERATED ALWAYS AS ROW END NOT NULL,
        PERIOD FOR SYSTEM_TIME (vf, vt)) WITH (SYSTEM_VERSIONING = ON (HISTORY_TABLE = dbo.T_history))`);
      const { params, login } = mssqlLive();
      const conn = await openMs({ ...params, database }, login);
      try {
        const tables = await conn.tables();
        expect(tables.map((t) => [t.name, t.key])).toEqual([['T', ['id']], ['T_history', []]]);
        expect(tables[0]!.design.fields.map((f) => [f.name, f.props.type, f.props.required, f.props.msComputed])).toEqual([
          ['id', 'number', true, undefined], ['v', 'shortText', false, undefined], ['vf', 'dateTime', false, true], ['vt', 'dateTime', false, true]]);
      } finally {
        await conn.close();
      }
    });
  });
  it('a wrong password is needsLogin; an unknown host or database cannotConnect; verify-full on the self-signed certificate is certificate', async () => {
    const { params, login } = mssqlLive();
    await expect(openMs(params, { ...login, password: 'wrong' })).rejects.toThrow(/^bc:linkUnavailable\|needsLogin\|sqlserver:\/\//);
    await expect(openMs({ ...params, host: 'nonexistent.invalid' }, login)).rejects.toThrow(/^bc:linkUnavailable\|cannotConnect\|nonexistent\.invalid:/);
    await expect(openMs({ ...params, database: 'bctest_absent' }, login)).rejects.toThrow(/^bc:linkUnavailable\|cannotConnect\|/);
    await expect(openMs({ ...params, tls: 'verify-full' }, login)).rejects.toThrow(/^bc:linkUnavailable\|certificate\|/); // CI's and the local container's certificate is self-signed
  });
});
