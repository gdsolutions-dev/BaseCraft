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
import type { ImportPlan } from '../../shared/import-text';
import type { ImportTexts } from '../import/text-import';
import { Session } from '../session';
import { HOST_METHODS, READ_METHODS, type HostEvent, type HostOpen, type HostReply, type HostRequest } from './protocol';

type Target = Record<string, unknown>;

const isCorrupt = (e: unknown) => ((e as { errcode?: number }).errcode ?? 0) % 256 === 11; // SQLITE_CORRUPT

/** Runs each request after the previous one has finished. 'open' creates the target and replies with its `state`; any
 *  other method must be in `methods` (an allowlist) and take an array of arguments. R16: a READ_METHODS call that fails
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
  return (r) => (queue = queue.then(() => run(r)));
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
      ...(o.shared.settleMs !== undefined ? { presence: { settleMs: o.shared.settleMs } } : {}),
      onStateChanged: (state) => emit({ event: 'stateChanged', state }),
    });
  } catch (e) {
    throw bcError(e);
  }
  const tick = async (done: number, total: number) => {
    emit({ event: 'importProgress', done, total });
    await new Promise((r) => setImmediate(r));
  };
  const own: Target = {
    importRun: (path: string, plan: ImportPlan, texts: ImportTexts) => s.importRun(path, plan, texts, tick),
    importExcelRun: (path: string, sheet: string, hasHeader: boolean, plan: ImportPlan, texts: ImportTexts) => s.importExcelRun(path, sheet, hasHeader, plan, texts, tick),
    exportText: (src: ExportSource, spec: ExportTextSpec, path: string, texts: { yes: string; no: string }) => s.exportText(src, spec, path, texts, tick),
    exportExcel: (src: ExportSource, path: string, sheet: string) => s.exportExcel(src, path, sheet, tick),
    takeOverLock: () => { try { return s.takeOverLock(); } catch (e) { throw bcError(e); } }, // reopening in write mode
  };
  return new Proxy(s, { get: (t, k) => (typeof k === 'string' && k in own ? own[k] : Reflect.get(t, k)) });
}

const port = process.parentPort;
if (port) {
  const dispatch = createDispatcher(openSession, (m) => port.postMessage(m));
  port.on('message', (e) => { void dispatch(e.data as HostRequest); });
}
