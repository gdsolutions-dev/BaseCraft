// Live SQL Server tests (C5 R15, G2): the server of BASECRAFT_MSSQL_TEST_URL
// (sqlserver://user:password@host:port/database?tls=verify-full|require|disable); without it, live suites are skipped
// (describe.skipIf(!mssqlUrl)).
import { randomBytes } from 'node:crypto';
import type { Credentials } from '../connector';
import { connectMs, msConfig, msQuery } from './driver';
import { msParams, type MsParams } from './params';

export const mssqlUrl: string | undefined = process.env.BASECRAFT_MSSQL_TEST_URL;

/** CI's Linux runner always has the server; a missing URL there (a renamed matrix value, a mistyped key) must fail the run,
 *  never skip the live tests silently. */
export const mssqlMissingOnCi = (env: Record<string, string | undefined>, platform: string): boolean =>
  !!env.CI && platform === 'linux' && !env.BASECRAFT_MSSQL_TEST_URL;
/** Playwright's live tests: a missing URL fails on Linux CI (mssqlMissingOnCi); elsewhere, true = skip. */
export function noLiveMssql(): boolean {
  if (mssqlMissingOnCi(process.env, process.platform)) throw new Error('BASECRAFT_MSSQL_TEST_URL is missing on the Linux CI runner');
  return !mssqlUrl;
}

/** The URL's params and login; tls disable or verify-full as given, anything else require. */
export function mssqlLive(): { params: MsParams; login: Credentials } {
  const u = new URL(mssqlUrl!);
  const mode = u.searchParams.get('tls');
  const user = decodeURIComponent(u.username);
  return {
    params: msParams({ host: u.hostname.replace(/^\[|\]$/g, ''), port: u.port ? Number(u.port) : undefined, database: decodeURIComponent(u.pathname.slice(1)) || 'master',
      user, tls: mode === 'disable' || mode === 'verify-full' ? mode : 'require' }),
    login: { user, password: decodeURIComponent(u.password) },
  };
}

/** `fn` in a new database `bctest_<hex>` (the server's collation or `o.collation`), with an admin connection to it (connected
 *  as BaseCraft connects, but named 'BaseCraft tests': tests find BaseCraft's own sessions by name); the database is dropped
 *  afterwards, BaseCraft's sessions still in it ended. */
export async function withDatabase(fn: (admin: { query(sql: string): Promise<unknown[][]> }, database: string) => Promise<void>, o: { collation?: string } = {}): Promise<void> {
  const { params, login } = mssqlLive();
  const config = msConfig(params, login);
  const open = (database: string) => connectMs({ ...config, options: { ...config.options, database, appName: 'BaseCraft tests' } });
  const database = `bctest_${randomBytes(4).toString('hex')}`;
  const master = await open(params.database);
  let failure: { e: unknown } | undefined; // the test's own error, never hidden by a failing drop
  try {
    await msQuery(master, `CREATE DATABASE ${database}${o.collation ? ` COLLATE ${o.collation}` : ''}`);
    const admin = await open(database);
    try {
      await fn({ query: (sql) => msQuery(admin, sql) }, database);
    } finally {
      admin.close();
    }
  } catch (e) {
    failure = { e };
  }
  try {
    await msQuery(master, `IF DB_ID('${database}') IS NOT NULL BEGIN ALTER DATABASE ${database} SET SINGLE_USER WITH ROLLBACK IMMEDIATE; DROP DATABASE ${database} END`);
  } catch (e) {
    failure ??= { e };
  } finally {
    master.close();
  }
  if (failure) throw failure.e;
}
