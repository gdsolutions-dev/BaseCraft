// Live PostgreSQL tests (G3): the server of BASECRAFT_PG_TEST_URL (postgresql://user:password@host:port/db?sslmode=…); without
// it, live suites are skipped (describe.skipIf(!liveUrl)).
import { randomBytes } from 'node:crypto';
import pg, { type Client } from 'pg';
import type { Credentials } from '../connector';
import { pgConfig } from './driver';
import { pgParams, type PgParams } from './params';

export const liveUrl: string | undefined = process.env.BASECRAFT_PG_TEST_URL;

/** G3: CI's Linux runner always has the server; a missing URL there (a renamed matrix value, a mistyped key) must fail the
 *  run, never skip the live tests silently. */
export const liveMissingOnCi = (env: Record<string, string | undefined>, platform: string): boolean =>
  !!env.CI && platform === 'linux' && !env.BASECRAFT_PG_TEST_URL;
/** Playwright's live tests (M7), as cross.test.ts: a missing URL fails on Linux CI (liveMissingOnCi); elsewhere, true = skip. */
export function noLiveServer(): boolean {
  if (liveMissingOnCi(process.env, process.platform)) throw new Error('BASECRAFT_PG_TEST_URL is missing on the Linux CI runner');
  return !liveUrl;
}

/** The URL's params and login; sslmode disable or verify-full as given, anything else require. */
export function liveParams(): { params: PgParams; login: Credentials } {
  const u = new URL(liveUrl!);
  const mode = u.searchParams.get('sslmode');
  const user = decodeURIComponent(u.username);
  return {
    params: pgParams({ host: u.hostname.replace(/^\[|\]$/g, ''), port: u.port ? Number(u.port) : undefined, database: decodeURIComponent(u.pathname.slice(1)),
      user, tls: mode === 'disable' || mode === 'verify-full' ? mode : 'require' }),
    login: { user, password: decodeURIComponent(u.password) },
  };
}

/** `fn` with a client (connected as BaseCraft connects, but named 'BaseCraft tests': tests find BaseCraft's own sessions by name)
 *  whose search_path is a new schema `bctest_<hex>`, dropped afterwards. */
export async function withSchema(fn: (client: Client, schema: string) => Promise<void>): Promise<void> {
  const { params, login } = liveParams();
  const client = new pg.Client({ ...pgConfig(params, login), application_name: 'BaseCraft tests' });
  await client.connect();
  const schema = `bctest_${randomBytes(4).toString('hex')}`;
  try {
    await client.query(`CREATE SCHEMA ${schema}`);
    await client.query(`SET search_path = ${schema}`);
    await fn(client, schema);
  } finally {
    await client.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`).finally(() => client.end());
  }
}
