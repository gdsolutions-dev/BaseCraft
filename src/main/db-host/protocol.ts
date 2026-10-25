// Messages between the main process and the data process (utilityProcess, host.ts): one request, one reply; events
// (state change, import progress) go to the main process unasked.
import type { SessionState } from '../../shared/api';
import type { Session } from '../session';

export type HostRequest = { id: number; method: string; args: unknown[] };
export type HostReply = { id: number; ok: true; value: unknown } | { id: number; ok: false; name: string; message: string };
export type HostEvent = { event: 'stateChanged'; state: SessionState } | { event: 'importProgress'; done: number; total: number };
export interface HostOpen { path: string; create: boolean; appVersion: string; region: string; sessionId: string }

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
  'describeSource', 'pageSource', 'actionCount', 'runAction',
  'activeContent', 'setContentEnabled', 'dbUuid',
  'exportText',
  'exportRowCount',
  'exportExcel',
  'saveCopy',
  'compact',
  'takeOverLock', 'tick', 'close',
]);
