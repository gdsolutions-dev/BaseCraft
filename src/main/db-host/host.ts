// The data process (Electron utilityProcess): the only process that opens SQLite. It holds the Session of the open base and
// runs its calls one at a time, in their order of arrival (a single queue), so no call starts while another one waits on
// an await: a read never sees a half-done write, and no write joins the savepoint of a running action query or import.
import { checkBaseFile, createBaseFile } from '../db/file-format';
import { setBusyRetry } from '../db/tx';
import { localFrontEnd } from '../db/front-end-copy';
import { systemProbe } from '../db/location-risk';
import { bcError } from '../ipc-validate';
import { RUNTIME } from '../../shared/product';
import type { ExportSource, ExportTextSpec } from '../../shared/exchange';
import type { ImportPlan, ImportProgress } from '../../shared/import-text';
import type { ServerKind } from '../../shared/api';
import type { AccessStructureSource } from '../../shared/access-import';
import type { MigrateRequest } from '../../shared/migrate';
import type { ImportTexts } from '../import/text-import';
import { Session } from '../session';
import { testConnector } from '../connectors/test-connector';
import type { Connector, NativeResult, RemoteTable } from '../connectors/connector';
import { msKey, msLabel, msParams } from '../connectors/sqlserver/params';
import { ptProps } from '../connectors/postgres/types';
import { defaultProps, type FieldDef, type FieldType } from '../../shared/field-types';
import { HOST_METHODS, READ_METHODS, type HostEvent, type HostOpen, type HostReply, type HostRequest } from './protocol';

type Target = Record<string, unknown>;
/** The e2e fake server's rows (server-link.spec.ts): its Clients link, by key order. */
const E2E_ROWS = { Clients: [[1, 'Dupont', 'Lyon'], [2, 'Martin', 'Brest']] };
const fd = (name: string, type: FieldType, more: object = {}): FieldDef => ({ name, props: { ...defaultProps(type), ...more } });
/** The e2e fake's pass-through: any text answers Texte (the text sent), Nom, Ville and a row per Clients row. */
const E2E_NATIVE = (sql: string): NativeResult => ({
  columns: ['Texte', 'Nom', 'Ville'].map((name) => ({ name, props: ptProps(25, -1) })),
  rows: E2E_ROWS.Clients.map((r) => [sql, r[1]!, r[2]!]), affected: 0,
});
/** Its tables (the link dialog lists them): Clients, keyed; Vue, without a key, a column BaseCraft does not link. */
const E2E_TABLES: RemoteTable[] = [
  { name: 'Clients', remote: 'Clients', schema: 'public', key: ['id'], skipped: [],
    design: { name: 'Clients', fields: [fd('id', 'number', { numberSize: 'longInteger', primaryKey: true }), fd('Nom', 'shortText'), fd('Ville', 'shortText')] } },
  { name: 'Vue', remote: 'Vue', schema: 'public', key: [], skipped: ['geo'], design: { name: 'Vue', fields: [fd('Ville', 'shortText')] } },
];
/** The fake as a SQL Server (C5 Task 7: the dialog's kind): the same tables in dbo, SQL Server's params, key and label. */
const e2eSqlServer = (): Connector => Object.assign(testConnector({ rows: E2E_ROWS, tables: E2E_TABLES.map((t) => ({ ...t, schema: 'dbo' })) }),
  { kind: 'sqlserver', params: msParams, key: msKey, label: msLabel }) as unknown as Connector;

const isCorrupt = (e: unknown) => ((e as { errcode?: number }).errcode ?? 0) % 256 === 11; // SQLITE_CORRUPT

/** Runs each request after the previous one has finished ('interrupt' excepted). 'open' creates the target and replies with
 *  its `state`; any other method must be in `methods` (an allowlist) and take an array of arguments. R16: a READ_METHODS call that fails
 *  SQLITE_CORRUPT (a share's cache serving pages older than another workstation's commit) runs once more after `pause(250)`;
 *  a second such failure, or a write's (rolled back by its transaction, never retried), is `bc:fileDamaged`. */
export function createDispatcher(
  open: (o: HostOpen, emit: (e: HostEvent) => void) => object, post: (m: HostReply | HostEvent) => void, methods: ReadonlySet<string> = HOST_METHODS,
  pause: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms)),
): (r: HostRequest) => Promise<void> {
  let target: Target | null = null;
  let queue: Promise<void> = Promise.resolve();
  const fail = (id: number, e: unknown) =>
    post({ id, ok: false, name: e instanceof Error ? e.name : 'Error', message: e instanceof Error ? e.message : String(e) });
  const run = async (r: HostRequest) => {
    try {
      let value: unknown;
      if (typeof r.method !== 'string' || !Array.isArray(r.args) || (r.method !== 'open' && !methods.has(r.method))) throw new Error('bc:invalidArgument');
      if (r.method === 'open') {
        target = open(r.args[0] as HostOpen, post) as Target;
        value = target.state;
      } else {
        if (!target) throw new Error('bc:noBase');
        const fn = target[r.method];
        if (typeof fn !== 'function') throw new Error('bc:invalidArgument');
        const call = async () => fn.apply(target, r.args);
        try {
          value = await call().catch(async (e) => {
            if (!isCorrupt(e) || !READ_METHODS.has(r.method)) throw e;
            await pause(250);
            return call();
          });
        } catch (e) {
          throw isCorrupt(e) ? new Error('bc:fileDamaged') : e;
        }
      }
      post({ id: r.id, ok: true, value });
    } catch (e) {
      try { fail(r.id, e); } catch (e2) { console.error(e2); }
    }
  };
  // R12: 'interrupt' skips the queue (it only asks the running remote statement to cancel, never touching the session's
  // data); it runs after the calls already handed over (a microtask later), so a call that arrived first has started.
  return (r) => (r.method === 'interrupt' ? Promise.resolve().then(() => run(r)) : (queue = queue.then(() => run(r))));
}

/** The base, checked (or created) first: a file error is a `bc:<code>` rejection. Import progress and state changes go out
 *  as events; an import yields between blocks of records (the queue keeps every other call waiting meanwhile). */
export function openSession(o: HostOpen, emit: (e: HostEvent) => void): object {
  let s: Session;
  setBusyRetry(o.shared.updateRetries, o.shared.updateRetryMs);
  try {
    if (o.create) createBaseFile(o.path, o.appVersion);
    else checkBaseFile(o.path);
    const probe = systemProbe();
    const path = o.frontEndCache && !o.create
      ? localFrontEnd(o.path, o.frontEndCache, probe, o.frontEndNetworkDirs ? { networkDirs: o.frontEndNetworkDirs } : {}) : o.path;
    s = Session.open(path, {
      appVersion: o.appVersion, region: o.region, probe, sessionId: o.sessionId, migrate: !RUNTIME, openMode: o.shared.openMode, runtime: RUNTIME,
      ...(path !== o.path ? { origin: o.path } : {}),
      ...(o.fakeServer ? { connectors: { postgresql: testConnector({ rows: E2E_ROWS, tables: E2E_TABLES, native: E2E_NATIVE }), sqlserver: e2eSqlServer() } } : {}),
      ...(o.shared.settleMs !== undefined ? { presence: { settleMs: o.shared.settleMs } } : {}),
      onStateChanged: (state) => emit({ event: 'stateChanged', state }),
    });
  } catch (e) {
    throw bcError(e);
  }
  const progress = async (p: ImportProgress) => {
    emit({ event: 'importProgress', ...p });
    await new Promise((r) => setImmediate(r));
  };
  const tick = (done: number, total: number) => progress({ done, total });
  const own: Target = {
    importRun: (path: string, plan: ImportPlan, texts: ImportTexts) => s.importRun(path, plan, texts, tick),
    importExcelRun: (path: string, sheet: string, hasHeader: boolean, plan: ImportPlan, texts: ImportTexts) => s.importExcelRun(path, sheet, hasHeader, plan, texts, tick),
    exportText: (src: ExportSource, spec: ExportTextSpec, path: string, texts: { yes: string; no: string }) => s.exportText(src, spec, path, texts, tick),
    exportExcel: (src: ExportSource, path: string, sheet: string) => s.exportExcel(src, path, sheet, tick),
    exportMarkup: (src: ExportSource, format: 'xml' | 'html', name: string, path: string, texts: { yes: string; no: string }) => s.exportMarkup(src, format, name, path, texts, tick),
    migrateToServer: (req: MigrateRequest) => s.migrateToServer(req, progress),
    importServerTables: (kind: ServerKind, params: unknown, names: string[]) => s.importServerTables(kind, params, names, progress),
    // Same positions as the session's method: the third one (the tick) is the host's own.
    importAccessTables: (path: string, remotes: string[], _tick: undefined, structure?: AccessStructureSource, keepDir?: string, script?: string) =>
      s.importAccessTables(path, remotes, progress, structure, keepDir, script),
    takeOverLock: () => { try { return s.takeOverLock(); } catch (e) { throw bcError(e); } }, // reopening in write mode
  };
  return new Proxy(s, { get: (t, k) => (typeof k === 'string' && k in own ? own[k] : Reflect.get(t, k)) });
}

const port = process.parentPort;
if (port) {
  const dispatch = createDispatcher(openSession, (m) => port.postMessage(m));
  port.on('message', (e) => { void dispatch(e.data as HostRequest); });
}
