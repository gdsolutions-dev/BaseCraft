// Messages between the main process and the data process (utilityProcess, host.ts): one request, one reply; events
// (state change, import progress) go to the main process unasked.
import type { SessionState } from '../../shared/api';
import type { Session } from '../session';

export type HostRequest = { id: number; method: string; args: unknown[] };
export type HostReply = { id: number; ok: true; value: unknown } | { id: number; ok: false; name: string; message: string };
export type HostEvent = { event: 'stateChanged'; state: SessionState } | { event: 'importProgress'; done: number; total: number };
export interface HostOpen { path: string; create: boolean; appVersion: string; region: string; sessionId: string;
  /** Shared-data settings of the workstation (C3 R7, R11); `settleMs` is the e2e seam of R5. */
  shared: { openMode: 'shared' | 'exclusive'; updateRetries: number; updateRetryMs: number; settleMs?: number };
  /** The Runtime's <userData>/front-ends: a front-end on a share opens from its local copy there (C3 R14). */
  frontEndCache?: string;
  /** e2e only (unpackaged + BASECRAFT_E2E=1): folders whose front-ends count as on a share for that copy alone. */
  frontEndNetworkDirs?: string[] }

/**
 * The only session methods a request may name (besides 'open'): those the main process calls. A batch that adds an IPC
 * handler over a new session method appends its name here (host.test.ts checks ipc.ts against this list).
 */
export const HOST_METHODS: ReadonlySet<string> = new Set<keyof Session>([
  'listTables', 'tableDesign', 'saveTable', 'renameTable', 'dropTable', 'testRules', 'copyTable', 'appendTable',
  'count', 'page', 'insert', 'update', 'delete', 'lookup',
  'listRelations', 'saveRelation', 'deleteRelation', 'relationsLayout', 'saveRelationsLayout', 'cascadeChildren',
  'importPreview', 'importRun', 'importExcelPreview', 'importExcelRun', 'importSpecs', 'saveImportSpec', 'deleteImportSpec',
  'listObjects', 'getObject', 'saveObject', 'renameObject', 'deleteObject', 'copyObject', 'setDescription',
  'describeSource', 'pageSource', 'saveSource', 'autoLookup', 'actionCount', 'runAction',
  'activeContent', 'setContentEnabled', 'dbUuid',
  'startup', 'saveStartup',
  'exportText',
  'exportRowCount',
  'exportExcel',
  'saveCopy',
  'compact',
  'splitDatabase',
  'inspectLinkFile', 'createLinks', 'listLinks', 'refreshLinks', 'relink', 'convertLink', 'unlockAccess',
  'takeOverLock', 'tick', 'dataStamp', 'close',
]);

/** R16: the HOST_METHODS that only read (retried once on a transient SQLITE_CORRUPT). */
export const READ_METHODS: ReadonlySet<string> = new Set<keyof Session>([
  'listTables', 'tableDesign', 'count', 'page', 'lookup', 'cascadeChildren', 'listRelations', 'relationsLayout',
  'describeSource', 'pageSource', 'autoLookup', 'actionCount', 'listObjects', 'getObject', 'importSpecs', 'startup',
  'activeContent', 'dbUuid', 'dataStamp',
]);
