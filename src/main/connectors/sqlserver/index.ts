// The SQL Server connector (C5 R1): a pure descriptor; `tedious` (driver.ts) is imported by the first open(), never at load.
import type { Connector } from '../connector';
import { msKey, msLabel, msParams, type MsParams } from './params';

export const sqlserver: Connector<MsParams> = {
  kind: 'sqlserver',
  capabilities: { passThrough: true, conflict: 'values', transactions: true, migrate: true },
  params: msParams,
  key: msKey,
  label: msLabel,
  open: async (p, c) => (await import('./driver')).openMs(p, c),
};
