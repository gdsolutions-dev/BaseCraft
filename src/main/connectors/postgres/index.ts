// The PostgreSQL connector (C4 R1): a pure descriptor; `pg` (driver.ts) is imported by the first open(), never at load.
import type { Connector } from '../connector';
import { pgKey, pgLabel, pgParams, type PgParams } from './params';

export const postgresql: Connector<PgParams> = {
  kind: 'postgresql',
  capabilities: { passThrough: true, conflict: 'rowVersion', transactions: true, migrate: true },
  params: pgParams,
  key: pgKey,
  label: pgLabel,
  open: async (p, c) => (await import('./driver')).openPg(p, c),
};
