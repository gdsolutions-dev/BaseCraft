import type { LogLabels } from '../api';

export type LogTexts = { log: Record<'table' | 'objectType' | 'objectName' | 'controlName' | 'propertyName' | 'oldValue' | 'newValue' | 'time', string> & { failed: LogLabels['failed'] };
  kind: LogLabels['kinds'] };
/** The catalog's `autoCorrect` section as the data process takes it (ipc.ts: the UI language at the time). */
export const logLabels = ({ log: l, kind }: LogTexts): LogLabels =>
  ({ table: l.table, fields: [l.objectType, l.objectName, l.controlName, l.propertyName, l.oldValue, l.newValue, l.time], kinds: kind, failed: l.failed });
