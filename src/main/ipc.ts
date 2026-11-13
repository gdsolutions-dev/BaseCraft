// Gestionnaires ipcMain de l'API window.basecraft : émetteur vérifié, arguments vérifiés, une session à la fois.
import { app, clipboard, ipcMain, nativeTheme, safeStorage, session, shell, type BrowserWindow } from 'electron';
import { randomUUID } from 'node:crypto';
import { readFileSync, realpathSync, rmSync } from 'node:fs';
import { stat, writeFile } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { CH, type AppInfo, type ContentState, type LicenseEntry, type LinkResult, type OpResult, type RelationResult, type SaveTableResult, type SessionState, type SettingsView } from '../shared/api';
import { logLabels } from '../shared/autocorrect/labels';
import { MAX_EXCEL_ROWS } from '../shared/exchange';
import { sheetName } from '../shared/export-format';
import { isUiLanguage, resolveUiLanguage } from '../shared/i18n';
import { catalogs } from '../shared/i18n/catalogs';
import { regionTag } from '../shared/locale-format';
import { RUNTIME } from '../shared/product';
import { FILE_EXTENSION } from './db/file-format';
import { HEARTBEAT_MS, keepAlive, releaseIfOurs } from './db/lock';
import { isDesignChannel } from './design-channels';
import { pickSpellLanguage } from './spellcheck';
import { DbHost, type AsyncSession } from './db-host/client';
import type { HostEvent, HostOpen } from './db-host/protocol';
import { pickExcelPath, pickExportPath, pickFolder, pickImportPath, pickLinkPath, pickOpenPath, pickPdfPath, pickSavePath, pickTextPath, showNotice } from './dialogs';
import { compactOnClose, whileCompacting } from './compact-on-close';
import { CloseVeto } from './close-veto';
import {
  basePath, cells, definition, exportSource, exportSpec, markupFormat, savedExport, fieldFilters, importPath, importPlan, importSpec, sheetOrNull, boolOrNull, importSpecOrNull, linkKindOrUndefined, linkPath, splitPath, reportBody, bareFileName, accessPassword, serverKey, serverKind, serverParams, migrateRequest, loginUser, bool, unlockPath, nameList, objectKind, objectKindOrAll, pageRequest, relation,
  relationsLayout, columnWidths, sheetLayoutArg, relationsListOptions, saveRequest, lookupName, nameArg, printRequest, sourcePageRequest, chartDataRequest, sourceRef, sourceSaveRequest, expectedValues, clipboardText, hyperlinkUrl, autoLookupRequest, rowRef, rowRefs, description, queryRef, queryParams, runActionOptions, startupOptions, themeArg, themeApplyArgs, resourceNameArg, resourceNamesArg, pictureDataUrlArg, iconBytes, settingValue, nameChanges, propertyTargetsArg, dataMacrosArg,
} from './ipc-validate';
import type { ImportTexts } from './import/text-import';
import { viaTemp } from './exchange/atomic-file';
import { pdfFileName, printDocument, renderToPdf, replaceFile } from './report-print';
import { setWindowIcon } from './window-icon';
import { addRecentFile, dialogDir, lastBaseToOpen, loadSettings, saveSettings, type AppSettings } from './settings';
import { readUserThemes, removeUserTheme, saveUserTheme } from './user-themes';
import { CredentialStore, refusedKey } from './credentials';
import { ApprovalStore, contentState, enabledAfterOwnWrite, readTrustConfig, systemTrustPath, trustsFile, type TrustConfig } from './trust';

let mainWindow: () => BrowserWindow | null = () => null;
let dir = '';
let settings: AppSettings;
/** The open base: its data process (db-host). The main process never opens SQLite itself. */
let host: DbHost | null = null;
let closing: Promise<void> = Promise.resolve();
/** Linked-file locks (C1 R4) a stopped data process held under this opening: its restart adopts them on first use (same session
 *  id), and until then (or if it never uses them) this process beats and releases them. */
const carried = new WeakMap<DbHost, string[]>();
const linkedLocks = (h: DbHost): string[] => [...new Set([...(carried.get(h) ?? []), ...(h.state.linkedLocks ?? [])])];
/** Removes every lock of this opening a killed or closed data process may have left: the base's and its linked files'. */
const releaseLocks = (h: DbHost): void => {
  for (const p of [h.state.path, ...linkedLocks(h)]) releaseIfOurs(p, h.opened.sessionId); // state.path: the Runtime's local copy (C3 R14)
};
export const closeVeto = new CloseVeto();
/** This user's approvals and the administrator's trusted folders (trust.ts), set up once in registerIpc. */
let approvals: ApprovalStore;
let trustConfig: TrustConfig = { trustedFolders: [] };
/** Server credentials (C4 R10, G2), set up once in registerIpc. */
let credentials: CredentialStore;

const region = () => regionTag(process.env.BASECRAFT_REGION ?? app.getSystemLocale());
const uiLanguage = () => resolveUiLanguage(settings.locale, region());
const catalog = () => catalogs[uiLanguage()];
/** What an import writes into the base, in the interface language (as Access does). */
const importTexts = (): ImportTexts => {
  const c = catalog();
  return { fieldPrefix: c.importText.fieldPrefix, idName: c.designer.defaultIdName, errorSuffix: c.importText.errorSuffix, errorFields: c.importText.errorFields, messages: c.fieldError, log: c.importText.log };
};
let importing = false;
/** Files the user chose in the main-side open dialog: the only ones the import may read (never a path made up by the renderer). */
const chosenImports = new Set<string>();
/** Files the user chose in the link dialog (C1): the only ones inspect, create and relink accept. */
const chosenLinks = new Set<string>();
/** Data files the user chose in the split's save dialog (C3 R13): the only targets base.split accepts. */
const chosenSplit = new Set<string>();

const HOMEPAGE = 'https://github.com/gdsolutions-dev/BaseCraft';
function appInfo(): AppInfo {
  return {
    version: app.getVersion(),
    electron: process.versions.electron, chromium: process.versions.chrome, node: process.versions.node, sqlite: process.versions.sqlite ?? '',
    platform: process.platform, arch: process.arch,
    copyright: '© 2026 GD Solutions', licence: 'GNU AGPL v3',
    links: { homepage: HOMEPAGE, issues: `${HOMEPAGE}/issues`, licence: `${HOMEPAGE}/blob/main/LICENSE`,
      site: 'https://gdsolutions-dev.github.io/BaseCraft/', releases: `${HOMEPAGE}/releases` },
  };
}

function broadcast(s: SessionState | null): void {
  const w = mainWindow();
  if (w && !w.isDestroyed()) w.webContents.send(CH.baseStateChanged, s);
}

const settingsView = (): SettingsView => ({ ...settings, uiLanguage: uiLanguage(), region: region() });
/** Every settings write reaches the window: it never asks again (the one refresh per write). */
function broadcastSettings(): void {
  const w = mainWindow();
  if (w && !w.isDestroyed()) w.webContents.send(CH.settingsChanged, settingsView());
}

/** One opening, start or restart of a base at a time (two quick opens of the same file must not race for its lock). Every
 *  IPC handler waits for them too. ponytail: an open that hangs (a data process that never answers) blocks every handler;
 *  add a timeout on DbHost.start if that is ever seen. */
let baseOps: Promise<unknown> = Promise.resolve();
function serial<T>(fn: () => Promise<T>): Promise<T> {
  const r = baseOps.then(fn);
  baseOps = r.catch(() => {});
  return r;
}
/** What became of the base the system gave this process (command line, file association): null, or the `bc:<code>` error of its
 *  opening, which the window asks for once at startup (base.openFailure) and shows as an Open's. A base given after the window
 *  is up (macOS open-file) is not re-asked: ponytail: that one stays in the log; push an event if macOS is taken up again. */
let systemOpen: Promise<string | null> = Promise.resolve(null);
function fromSystem(opened: Promise<unknown>): Promise<void> {
  systemOpen = opened.then(() => null, (e) => (e instanceof Error ? e.message : String(e)));
  return opened.then(() => {});
}
export const openFromSystem = (path: string): Promise<void> => fromSystem(openBase(path));

/** Startup with no base from the command line or the system (« Ouvrir la dernière base »): opens the most recent base if its
 *  path is valid and its file is there. The check is asynchronous (a base on a share that does not answer must not freeze the
 *  window); a missing file opens nothing, silently, and a base opened meanwhile from the Backstage wins. An existing file that
 *  fails to open is told like a command-line one (base.openFailure, which waits for this). */
export const openLastBase = (): Promise<void> =>
  fromSystem(lastBaseToOpen(settings, async (p) => (await stat(p)).isFile()).then((p) => (p && !hasBase() ? openBase(p) : undefined)));

const DIR_CHECK_MS = 2000;
/** Where New, Open and Save As start (the default folder is read from a file a user may edit: it must be a folder now). Checked
 *  asynchronously and for 2 s at most: a default folder on a share that does not answer falls back to Documents. */
const startDir = (): Promise<string> => dialogDir(settings, app.getPath('documents'), (p) => {
  let timer: NodeJS.Timeout | undefined;
  return Promise.race([stat(p).then((st) => st.isDirectory()), new Promise<boolean>((r) => { timer = setTimeout(r, DIR_CHECK_MS, false); })])
    .finally(() => clearTimeout(timer));
});

/** Settles once no opening or restart (Stop) is in progress: quitting waits for it, so the new process's lock is released. */
export const whenIdle = (): Promise<void> => baseOps.then(() => {});

const COMPACT_NOTICE_MS = 1500;
/** What « Compacter lors de la fermeture » asks of the base being closed: the compact keeps its lock alive and, if it takes long,
 *  says so (a close that waits must not look hung). */
const compactingSession = (h: DbHost) => ({
  startup: () => h.session.startup(),
  compact: () => whileCompacting(h.session.compact(), {
    beat: () => { for (const p of [h.state.path, ...linkedLocks(h)]) keepAlive(p, h.opened.sessionId); }, every: HEARTBEAT_MS, // its linked files' too (C1)
    notice: () => showNotice(catalog().dialog.compactOnClose, catalog().dialog.button.ok), after: COMPACT_NOTICE_MS,
  }),
});

/** Compacts the base if its options ask (compact-on-close.ts), closes it after the calls already queued (3 s at most), then
 *  removes its locks (and its linked files') if a killed process left them. The wait before the compact is bounded (compactOnClose reads the options for 3 s
 *  at most, as long as the close). ponytail: no ceiling on the compact itself (a large base on a slow share takes minutes, with
 *  the notice up and the lock beaten); a data process hung inside it holds the lock until someone kills it. Add a timeout that
 *  kills the data process if that is ever seen — the original stays intact either way. */
export function closeBase(): Promise<void> {
  const h = host;
  if (!h) return closing;
  host = null;
  stamped = null; // R10: the next data process's first stamp is a baseline again
  const before = closing;
  closing = compactOnClose(compactingSession(h), h.state, (p) => rmSync(p, { force: true }))
    .then(() => h.close()).catch(console.error).finally(() => releaseLocks(h)).then(() => before);
  broadcast(null);
  return closing;
}

/** Windows shutdown or logoff: the process may end before an asynchronous close. The data process is killed (SQLite rolls
 *  an unfinished write back at the next open) and the lock is removed at once. */
export function abandonBase(): void {
  const h = host;
  if (!h) return;
  host = null;
  stamped = null;
  void h.kill();
  releaseLocks(h);
}

/** The data process ended on its own: the base is closed, and the window says so once (the calls it had pending reject
 *  bc:hostCrashed, which the renderer's error dialog leaves to this notice). */
function hostCrashed(h: DbHost): void {
  if (host !== h) return;
  host = null;
  stamped = null;
  releaseLocks(h);
  broadcast(null);
  const w = mainWindow();
  if (w && !w.isDestroyed()) w.webContents.send(CH.baseHostCrashed);
}

/** The workstation's shared-data options for the data process; the settle wait is only shortened by the e2e seam (never packaged). */
function sharedOptions(): HostOpen['shared'] {
  const { openMode, updateRetries, updateRetryMs } = settings;
  const settleMs = process.env.BASECRAFT_E2E === '1' && !app.isPackaged && process.env.BASECRAFT_E2E_SETTLE_MS !== undefined
    ? Number(process.env.BASECRAFT_E2E_SETTLE_MS) : undefined;
  return { openMode, updateRetries, updateRetryMs, ...(settleMs !== undefined && Number.isFinite(settleMs) ? { settleMs } : {}) };
}

/** The Runtime's local copies of front-ends on a share (C3 R14); the e2e seam names a local folder that counts as a share for
 *  the copy alone (never packaged). */
function frontEndCopies(): Pick<HostOpen, 'frontEndCache' | 'frontEndNetworkDirs'> {
  if (!RUNTIME) return {};
  const share = process.env.BASECRAFT_E2E === '1' && !app.isPackaged ? process.env.BASECRAFT_E2E_NETWORK_DIR : undefined;
  return { frontEndCache: join(dir, 'front-ends'), ...(share ? { frontEndNetworkDirs: [share] } : {}) };
}

/** e2e only (unpackaged + BASECRAFT_E2E=1 + BASECRAFT_E2E_FAKE_SERVER=1): server sources read the fake connector. */
const fakeServer = (): Pick<HostOpen, 'fakeServer'> =>
  (process.env.BASECRAFT_E2E === '1' && process.env.BASECRAFT_E2E_FAKE_SERVER === '1' && !app.isPackaged ? { fakeServer: true } : {});

/** M6: the keys whose credential the current data process received from main. */
const pushed = new Set<string>();
/** R10: the credentials this process knows for the front-end's servers go to its data process (kept in its memory). A failure
 *  (no connection yet: needsRecovery) only means the login is asked at first use. Never logs a password. */
async function pushCredentials(h: DbHost): Promise<void> {
  pushed.clear();
  try {
    for (const key of await h.session.serverKeys()) {
      const c = credentials.get(key);
      if (c) { await h.session.setCredential(key, c.user, c.password); pushed.add(key); }
    }
  } catch { /* asked at first use */ }
}
/** M6: db-host lacks the credential main gave it for a key (bc:linkUnavailable|needsLogin|<key>): the server refused it and
 *  db-host forgot it. Main forgets it too: pushed again at each Stop restart, it would count one more failed login each time. */
function forgetRefused(e: unknown): void {
  const key = refusedKey(e);
  if (key !== null && pushed.delete(key)) credentials.forget(key);
}

/** Every start of a data process (openBase, Stop's restart) pushes the known credentials; takeOverLock keeps the process and
 *  pushes them again (a base opened in recovery had none). */
async function startHost(path: string, create: boolean, sessionId: string): Promise<DbHost> {
  let me: DbHost | null = null;
  const onEvent = (e: HostEvent) => {
    if (host !== me) return;
    const w = mainWindow();
    if (e.event === 'stateChanged') broadcast(me?.state ?? e.state); // with its content state (client.ts keeps it)
    else if (w && !w.isDestroyed()) { const { event: _event, ...p } = e; w.webContents.send(CH.importProgress, p); }
  };
  try {
    const { host: h } = await DbHost.start({ path, create, appVersion: app.getVersion(), region: region(), sessionId, shared: sharedOptions(),
      ...frontEndCopies(), ...fakeServer() }, onEvent, () => { if (me) hostCrashed(me); });
    me = h;
    await pushCredentials(h);
    return h;
  } catch (e) {
    releaseIfOurs(path, sessionId); // a process that ended during the open may leave its lock
    throw e;
  }
}

/** The active content enabled in each data process, by fingerprint ('' : none); absent or null: disabled. */
const enabledFor = new WeakMap<DbHost, string | null>();

/** Tells the data process which content runs (null: none, action queries refused) and whether its pass-throughs may use a
 *  stored password (C6 Task 8), and sets the state; broadcast if it changed. */
async function setContent(h: DbHost, fingerprint: string | null, content: ContentState, announce = true): Promise<void> {
  try { await h.session.setContentEnabled(fingerprint, trustsFile(content, h.opened.path, trustConfig, process.platform)); } catch (e) { if (fingerprint !== null) throw e; } // null: a process gone runs nothing
  enabledFor.set(h, fingerprint);
  const changed = h.state.content !== content;
  h.state = { ...h.state, content };
  if (announce && changed && host === h) broadcast(h.state);
}

/**
 * Decides whether the active content of a base just opened (or reopened after Stop, or taken over) is enabled, and tells its
 * data process. Any failure (no connection yet: needsRecovery) leaves it disabled.
 */
async function decideContent(h: DbHost, announce = false): Promise<void> {
  try {
    const a = await h.session.activeContent();
    const content = contentState(a, await h.session.dbUuid(), h.opened.path, { store: approvals, cfg: trustConfig, platform: process.platform });
    await setContent(h, content === 'disabled' ? null : a.fingerprint, content, announce);
  } catch {
    await setContent(h, null, 'disabled', announce);
  }
}

/** The data process refused an action query: its content changed since it was enabled (another connection). The bar shows. */
async function contentRefused<T>(fn: () => Promise<T>): Promise<T> {
  const h = host;
  try {
    return await fn();
  } catch (e) {
    if (h && e instanceof Error && e.message === 'bc:contentDisabled' && h.state.content !== 'disabled') await setContent(h, null, 'disabled');
    throw e;
  }
}

/** R5, after a successful save, rename, delete or copy of an object: content this user authors in a base whose content is
 *  enabled (or had none) is approved, if nothing changed it elsewhere before (enabledAfterOwnWrite); a base opened disabled
 *  stays disabled. One at a time, so that one write's "before" is never another's "after". ponytail: a write by another
 *  connection between the "before" read and this write is approved with it; closing that needs both in one data-process call. */
let objectWrites: Promise<unknown> = Promise.resolve();
function objectWrite(fn: () => Promise<TableOpResult>): Promise<TableOpResult> {
  const run = async () => {
    const h = host;
    const enabled = h ? enabledFor.get(h) ?? null : null;
    let before: string | null = null;
    if (h && enabled !== null) try { before = (await h.session.activeContent()).fingerprint; } catch { /* decided below: disabled */ }
    const r = await tableOp(fn);
    if (!r.ok || !h || host !== h || enabled === null) return r;
    try {
      const a = await h.session.activeContent();
      const next = enabledAfterOwnWrite(enabled, before, a.fingerprint);
      if (next === null) await setContent(h, null, 'disabled');
      else {
        if (a.present) approvals.approve(await h.session.dbUuid(), next);
        await setContent(h, next, a.present ? 'enabled' : h.state.content ?? 'none');
      }
    } catch (e) {
      console.error(e); // the write succeeded; the content is decided again at the next opening
      await setContent(h, null, 'disabled');
    }
    return r;
  };
  const p = objectWrites.then(run);
  objectWrites = p.catch(() => {});
  return p;
}

/** The same file (its real path), case-insensitive on Windows and macOS: Save As never writes over the open base. */
function sameFile(a: string, b: string): boolean {
  const real = (p: string) => { try { return realpathSync.native(p); } catch { return resolve(p); } }; // a new file has no real path yet
  const [x, y] = [real(a), real(b)];
  return process.platform === 'win32' || process.platform === 'darwin' ? x.toLowerCase() === y.toLowerCase() : x === y;
}
const samePath = (a: string, b: string) => (process.platform === 'win32' ? resolve(a).toLowerCase() === resolve(b).toLowerCase() : resolve(a) === resolve(b));

/**
 * Checks (open) or creates (create) the target first, so a bad target leaves the current base open; then closes the
 * current base (one base per window, as in Access). The same file is closed first (its lock). File errors reject as
 * `bc:<code>` (the data process applies bcError).
 */
let opening = 0; // opens in flight: host is assigned only after the data process started
export function openBase(path: string, create = false): Promise<SessionState> {
  opening++;
  return serial(async () => {
    if (host && samePath(host.opened.path, path)) await closeBase();
    await closing; // a base still closing releases its lock first
    const h = await startHost(path, create, randomUUID());
    await decideContent(h);
    await closeBase();
    host = h;
    refreshTick(); // the baseline
    try {
      settings = addRecentFile(settings, path, process.platform);
      saveSettings(dir, settings);
      broadcastSettings();
    } catch (e) {
      console.error(e); // recent files are a convenience: never fail an open that succeeded
    }
    broadcast(h.state);
    return h.state;
  }).finally(() => { opening--; });
}

/**
 * Heartbeat (every HEARTBEAT_MS, and when the machine wakes up). The main process beats the lock itself, so a long query
 * that keeps the data process busy does not let another workstation take the base over; the session's own check (a lost
 * lock switches to read-only) waits in its queue.
 */
let tickPending = false; // one queued tick at most: a long query does not pile them up
/** A base is open (or being opened) in this window. */
export const hasBase = (): boolean => host !== null || opening > 0;

export function heartbeat(): void {
  const h = host;
  if (!h) return;
  if (!h.state.readOnly) keepAlive(h.state.path, h.opened.sessionId);
  for (const p of linkedLocks(h)) keepAlive(p, h.opened.sessionId); // only while still ours
  if (tickPending) return;
  tickPending = true;
  h.session.tick().catch(console.error).finally(() => { tickPending = false; });
}

/**
 * C3 R10 Refresh interval: every « Intervalle d'actualisation » seconds, one queued dataStamp at most. The first answer from a
 * data process (an open, a restart: asked at once) is the baseline; a different one tells the window another workstation wrote.
 */
let refreshTimer: ReturnType<typeof setInterval> | undefined;
let stampPending: DbHost | null = null;
let stamped: { h: DbHost; stamp: string } | null = null;
function refreshTick(): void {
  const h = host;
  if (!h || stampPending === h) return;
  stampPending = h;
  h.session.dataStamp().then((stamp) => {
    const changed = stamped?.h === h && stamped.stamp !== stamp;
    stamped = { h, stamp };
    const w = mainWindow();
    if (changed && host === h && w && !w.isDestroyed()) w.webContents.send(CH.baseDataChanged);
  }).catch((e: unknown) => { if (!(e instanceof Error && e.message === 'bc:cancelled')) console.error(e); }) // Stop's kill
    .finally(() => { if (stampPending === h) stampPending = null; });
}
/** Started in registerIpc; a changed interval restarts it at once. */
function restartRefresh(): void {
  clearInterval(refreshTimer);
  refreshTimer = setInterval(refreshTick, settings.refreshInterval * 1000);
}

/** The calls Stop may end: reads of a query or table, action queries (one transaction, rolled back) and the server migration
 *  (C7 R10: its server transaction rolled back, the front-end untouched). Never a row write, an import or another design change. */
const STOPPABLE = new Set(['describeSource', 'pageSource', 'actionCount', 'runAction', 'page', 'count', 'lookup',
  'migrateToServer', 'importServerTables', 'importAccessTables']); // C7 R10: its server transaction rolls back

/** R12: how long a server statement whose cancel was sent may take to answer before Stop kills the data process. */
export const INTERRUPT_WAIT_MS = 5000;

/**
 * Stop (Ctrl+Break, « Arrêter »): ends the oldest pending query call. A row write executing before it finishes first (a
 * committed write never answers bc:cancelled, so saving it again cannot duplicate it). A server statement running is
 * cancelled first (DbHost.stop, R12): settled within INTERRUPT_WAIT_MS, the data process lives on. Otherwise the data
 * process is killed (that call and the calls queued behind it, never started, reject bc:cancelled; SQLite rolls an
 * interrupted action query back) and the base reopens under the same opening (its lock is adopted).
 * DbHost keeps one call in flight, and stop() checks that the call still executes in the kill's own tick (the interrupt's
 * wait lets it answer, and the next call leave): the kill can only end the targeted call.
 * ponytail: a runAction that commits just as Stop lands is reported bc:cancelled although it was written (running it again
 * would repeat it); closing that gap needs a cooperative interrupt (sqlite3_interrupt), which node:sqlite does not expose.
 * ponytail: a tracked page waiting behind an import or a design save shows « Exécution… », but Stop waits for that write
 * to finish (it is never stopped); stopping imports would need their own cancellation.
 */
async function cancelCall(): Promise<void> {
  const h = host;
  const id = h?.pendingCall(STOPPABLE) ?? null;
  if (!h || id === null || !(await h.whenExecuting(id))) return;
  return serial(async () => {
    if (host !== h || !h.isExecuting(id)) return; // it ended meanwhile
    // R12: a server statement cancelled, or the call answered meanwhile (the next call, maybe a row save, is never killed),
    // or the base closed meanwhile: no kill. DbHost.stop re-checks in the kill's own tick.
    if (!(await h.stop(id, INTERRUPT_WAIT_MS, () => host === h))) return;
    try {
      const n = await startHost(h.opened.path, false, h.opened.sessionId);
      carried.set(n, linkedLocks(h));
      await decideContent(n);
      if (host !== h) { await n.close(); return; } // closed meanwhile
      host = n;
      refreshTick(); // the baseline
      broadcast(n.state);
    } catch (e) {
      if (host === h) host = null;
      releaseLocks(h);
      broadcast(null);
      throw e;
    }
  });
}

function need(): AsyncSession {
  if (!host) throw new Error('bc:noBase');
  return host.session;
}
// The data process recreates its errors with their name.
const isReadOnly = (e: unknown) => e instanceof Error && e.name === 'ReadOnlyError';
type TableOpResult = OpResult | SaveTableResult | RelationResult | LinkResult | { ok: true; count: number };
/** A design write: a read-only base resolves readOnly (`names` empty: LinkResult's, PF10). */
const tableOp = async (fn: () => Promise<TableOpResult>): Promise<TableOpResult> => {
  try { return await fn(); } catch (e) { if (isReadOnly(e)) return { ok: false, reason: 'readOnly', names: [] }; throw e; }
};
const rowWrite = async <T>(fn: () => Promise<T>): Promise<T> => {
  try { return await fn(); } catch (e) { throw isReadOnly(e) ? new Error('bc:readOnly') : e; }
};

/** One import at a time; progress (the data process's importProgress events) goes to the window between blocks of records. */
async function runImport(run: () => Promise<unknown>): Promise<unknown> {
  if (importing) throw new Error('bc:invalidArgument');
  importing = true;
  try {
    return await rowWrite(run);
  } finally {
    importing = false;
  }
}

/** One export at a time, and not during an import (they share the progress event). The data process writes the file at the
 *  path chosen in the save dialog; nothing is written into the base. */
async function runExport(src: ReturnType<typeof exportSource>, spec: ReturnType<typeof exportSpec> | null, defaultName: string, markup?: 'xml' | 'html'): Promise<unknown> {
  if (importing) throw new Error('bc:invalidArgument');
  importing = true;
  try {
    // Excel (no spec): too many rows is told before the dialog
    if (!spec && !markup && (await need().exportRowCount(src)) > MAX_EXCEL_ROWS) return { ok: false, reason: 'tooManyRows', limit: MAX_EXCEL_ROWS };
    const { yes, no, textFilter, excelFilter, xmlFilter, htmlFilter } = catalog().exchange;
    const path = markup ? await pickExportPath(defaultName, markup, markup === 'xml' ? xmlFilter : htmlFilter)
      : await pickExportPath(defaultName, spec ? 'text' : 'excel', spec ? textFilter : excelFilter);
    if (path === null) return { ok: false, reason: 'cancelled' };
    if (markup) return await need().exportMarkup(src, markup, defaultName, path, { yes, no });
    if (!spec) return await need().exportExcel(src, path, sheetName(defaultName));
    return await need().exportText(src, spec, path, { yes, no });
  } finally {
    importing = false;
  }
}

export function registerIpc(getMainWindow: () => BrowserWindow | null): void {
  mainWindow = getMainWindow;
  dir = app.getPath('userData');
  settings = loadSettings(dir);
  approvals = new ApprovalStore(join(dir, 'trust.json'));
  credentials = new CredentialStore(join(dir, 'credentials.json'), safeStorage);
  // E2E only (unpackaged + BASECRAFT_E2E=1): the tests' trusted folders replace the system file.
  const e2eTrust = process.env.BASECRAFT_E2E === '1' && !app.isPackaged ? process.env.BASECRAFT_E2E_TRUST_CONFIG : undefined;
  trustConfig = readTrustConfig(e2eTrust || systemTrustPath(process.platform, process.env));
  // The native popups (<select> lists, menus, scroll bars) follow the app's theme, not Windows'.
  nativeTheme.themeSource = settings.theme;
  const handle = (ch: string, fn: (...args: unknown[]) => unknown) => {
    if (RUNTIME && isDesignChannel(ch)) return; // BaseCraft Runtime cannot design: no handler, so a call rejects (R5)
    ipcMain.handle(ch, (e, ...args) => {
      const w = mainWindow();
      if (!w || e.sender !== w.webContents) throw new Error('Unauthorized IPC sender');
      // after an opening or a restart (Stop) in progress: the command-line base, a call issued just after Stop
      // M6; the link dialog's typed login, refused, leaves the key's credential as it was (RemoteSources.probe)
      return baseOps.then(() => fn(...args)).catch((err: unknown) => { if (ch !== CH.linksInspectServer) forgetRefused(err); throw err; });
    });
  };
  // kept in memory only once written: a failed save leaves getSettings as the file is
  const update = (patch: Partial<AppSettings>) => { const next = { ...settings, ...patch }; saveSettings(dir, next); settings = next; broadcastSettings(); };

  handle(CH.getSettings, settingsView);
  handle(CH.setLocale, (l) => {
    if (l !== 'system' && !isUiLanguage(l)) throw new Error('Invalid locale');
    update({ locale: l as AppSettings['locale'] });
  });
  handle(CH.setTheme, (t) => {
    if (!['system', 'light', 'dark'].includes(t as string)) throw new Error('Invalid theme');
    update({ theme: t as AppSettings['theme'] });
    nativeTheme.themeSource = settings.theme;
  });
  handle(CH.setSetting, (k, v) => {
    const [key, val] = settingValue(k, v);
    update({ [key]: val });
    if (key === 'refreshInterval') restartRefresh();
  });
  restartRefresh();
  handle(CH.pickFolder, () => startDir().then(pickFolder));
  handle(CH.appInfo, (): AppInfo => appInfo());
  // Packaged: resources/licenses.json (extraResources); unpackaged: out/licenses.json (npm run licenses).
  handle(CH.appLicenses, (): LicenseEntry[] => {
    try { return JSON.parse(readFileSync(app.isPackaged ? join(process.resourcesPath, 'licenses.json') : join(app.getAppPath(), 'out/licenses.json'), 'utf8')); } catch { return []; }
  });
  // Home > Clipboard outside the Navigation Pane: the sender's focused element handles it (same sender check as handle()).
  ipcMain.handle(CH.edit, (e, cmd) => {
    const w = mainWindow();
    if (!w || e.sender !== w.webContents) throw new Error('Unauthorized IPC sender');
    if (cmd !== 'cut' && cmd !== 'copy' && cmd !== 'paste') throw new TypeError('bc:invalidArgument');
    e.sender[cmd as 'cut' | 'copy' | 'paste']();
  });
  handle(CH.beep, () => { shell.beep(); });
  handle(CH.appReadClipboard, () => clipboard.readText());
  // Spelling: Chromium's Hunspell dictionary of the interface language, downloaded on first use (Google's CDN) and kept in the user data folder
  const spellPrepare = () => {
    const ses = session.defaultSession;
    const lang = pickSpellLanguage(ses.availableSpellCheckerLanguages, uiLanguage(), region());
    if (lang && !ses.getSpellCheckerLanguages().includes(lang)) ses.setSpellCheckerLanguages([lang]);
    return lang !== null;
  };
  handle(CH.spellPrepare, spellPrepare);
  try { spellPrepare(); } catch (e) { console.error(e); }   // the download starts at launch, not at the first click
  handle(CH.appWriteClipboard, (text) => { clipboard.writeText(clipboardText(text)); });
  handle(CH.appSetIcon, (png) => {
    const bytes = iconBytes(png);
    const w = mainWindow();
    if (w && !w.isDestroyed()) setWindowIcon(w, bytes);
  });
  // A link a base's author typed (a label's HyperlinkAddress): the renderer asks the user first, the main process only checks the scheme.
  handle(CH.openHyperlink, (url) => shell.openExternal(hyperlinkUrl(url)));
  // The renderer never chooses the URL: only the links About shows may be opened, in the system browser.
  handle(CH.openExternal, (url) => {
    const links = appInfo().links;
    if (typeof url !== 'string' || !Object.values(links).includes(url)) throw new TypeError('bc:invalidArgument');
    return shell.openExternal(url);
  });

  // The renderer's documents agreed (pending rows saved or discarded): close without asking again. Deferred so that the
  // reply leaves first. destroy() emits 'closed' (the base is closed there), but not 'close'.
  handle(CH.closeAck, () => closeVeto.acknowledged());
  handle(CH.closeAllowed, () => { setImmediate(() => { const w = mainWindow(); if (w && !w.isDestroyed()) w.destroy(); }); });

  handle(CH.baseCreate, async () => {
    const p = await pickSavePath(catalog().dialog.newBaseName + FILE_EXTENSION, await startDir());
    return p === null ? null : openBase(p, true);
  });
  handle(CH.baseOpen, async (p) => {
    const path = p === undefined ? await pickOpenPath(await startDir()) : basePath(p);
    return path === null ? null : openBase(path);
  });
  handle(CH.baseClose, () => closeBase());
  handle(CH.baseState, () => host?.state ?? null);
  handle(CH.baseOpenFailure, () => { const r = systemOpen; systemOpen = Promise.resolve(null); return r; }); // once; after the opening in progress (handle)
  // File › Save As (A6): a checked copy (VACUUM INTO), which then becomes the open base. Reads only: allowed read-only.
  handle(CH.baseSaveAs, async () => {
    need();
    const current = host!.opened.path;
    const p = await pickSavePath(catalog().dialog.copyName.replace('{{name}}', basename(current, FILE_EXTENSION)) + FILE_EXTENSION, await startDir());
    if (p === null) return null;
    if (sameFile(p, current)) throw new Error('bc:sameFile');
    await whenIdle();
    await need().saveCopy(p);
    return openBase(p);
  });
  // Compact and Repair (A6): the renderer has closed every document; a read-only session rejects (ReadOnlyError).
  handle(CH.baseCompact, async () => {
    await whenIdle();
    try {
      return await rowWrite(() => need().compact());
    } catch (e) {
      if (e instanceof Error && e.name === 'BaseLostError') await closeBase(); // no connection left: the base is closed
      throw e;
    }
  });
  // Split Database (C3 R12, R13): the data file proposed beside the base, `<name>_donnees`; the renderer has closed every document.
  handle(CH.baseSplitPick, async () => {
    need();
    const current = host!.opened.path;
    const p = await pickSavePath(catalog().split.defaultName.replace('{{name}}', basename(current, FILE_EXTENSION)) + FILE_EXTENSION, dirname(current));
    if (p !== null) chosenSplit.add(p);
    return p;
  });
  handle(CH.baseSplit, async (p) => {
    const path = splitPath(p, chosenSplit);
    await whenIdle();
    return need().splitDatabase(path);
  });
  // Reopening in write mode, unlinking the lock (bcError in the data process); the content is decided again (a crashed base
  // could not be read before).
  handle(CH.baseTakeOverLock, async () => {
    need();
    const h = host!;
    await h.session.takeOverLock();
    await pushCredentials(h); // a base opened in recovery could not list its servers at its start
    await decideContent(h, true);
    return host === h ? h.state : null;   // closed meanwhile: no base
  });
  // « Activer le contenu »: approved for this file and content (local, so allowed read-only), enabled, broadcast.
  handle(CH.baseEnableContent, async () => {
    need();
    const h = host!;
    const a = await h.session.activeContent();
    if (a.present) approvals.approve(await h.session.dbUuid(), a.fingerprint);
    await setContent(h, a.fingerprint, 'enabled', false);
    if (host === h) broadcast(h.state);
    return h.state;
  });

  handle(CH.tablesList, () => need().listTables());
  handle(CH.tablesDesign, (n) => need().tableDesign(lookupName(n)));
  handle(CH.tablesSave, (r) => objectWrite(() => need().saveTable(saveRequest(r), logLabels(catalog().autoCorrect), settings.propertyUpdateOptions)));
  handle(CH.tablesRename, (a, b) => objectWrite(() => need().renameTable(lookupName(a), nameArg(b), logLabels(catalog().autoCorrect))));
  handle(CH.tablesDrop, (n) => tableOp(() => need().dropTable(lookupName(n))));
  handle(CH.tablesTestRules, (n) => need().testRules(lookupName(n)));
  handle(CH.tablesDataMacros, (n) => need().dataMacros(lookupName(n)));
  handle(CH.tablesSaveDataMacros, (n, m) => need().saveDataMacros(lookupName(n), dataMacrosArg(m)));

  handle(CH.rowsCount, (t, f) => need().count(lookupName(t), fieldFilters(f)));
  handle(CH.rowsPage, (t, r) => need().page(lookupName(t), pageRequest(r)));
  handle(CH.rowsInsert, (t, v) => rowWrite(() => need().insert(lookupName(t), cells(v))));
  handle(CH.rowsUpdate, (t, id, c, x) => rowWrite(() => need().update(lookupName(t), rowRef(id), cells(c), expectedValues(x))));
  handle(CH.rowsDelete, (t, ids) => rowWrite(() => need().delete(lookupName(t), rowRefs(ids))));
  handle(CH.rowsLookup, (t, fd) => need().lookup(lookupName(t), lookupName(fd)));

  // Startup options (B3): a read-only base reads them; saving rejects (ReadOnlyError) like any write.
  handle(CH.baseStartup, () => need().startup());
  handle(CH.baseSaveStartup, (o) => rowWrite(() => need().saveStartup(startupOptions(o))));

  // Default theme (F2): a read-only base reads it; saving rejects like any write; open views refetch on the broadcast.
  handle(CH.baseTheme, () => need().baseTheme());
  // The user's themes (F2b): per user, in userData; no base needed, allowed read-only.
  handle(CH.themesList, () => readUserThemes(dir));
  handle(CH.themesSave, (t, replace) => saveUserTheme(dir, themeArg(t), replace === true));
  handle(CH.themesRemove, (name) => removeUserTheme(dir, lookupName(name)));
  handle(CH.baseSaveTheme, async (t) => {
    await rowWrite(() => need().saveBaseTheme(themeArg(t)));
    const w = mainWindow();
    if (w && !w.isDestroyed()) w.webContents.send(CH.baseThemeChanged);
  });
  // Shared image gallery (F3): reads allowed read-only; writes are design channels (the Runtime has no handler) and broadcast.
  handle(CH.resourcesList, () => need().listResources());
  handle(CH.resourcesGet, (names) => need().getResources(resourceNamesArg(names)));
  const resourcesChanged = () => { const w = mainWindow(); if (w && !w.isDestroyed()) w.webContents.send(CH.resourcesChanged); };
  handle(CH.resourcesAdd, async (name, url) => { const n = await rowWrite(() => need().addResource(resourceNameArg(name), pictureDataUrlArg(url))); resourcesChanged(); return n; });
  handle(CH.resourcesReplace, async (name, url) => { await rowWrite(() => need().replaceResource(resourceNameArg(name), pictureDataUrlArg(url))); resourcesChanged(); });
  handle(CH.resourcesRemove, async (name) => { await rowWrite(() => need().removeResource(resourceNameArg(name))); resourcesChanged(); });
  handle(CH.baseApplyTheme, async (t, kind, names) => {
    const a = themeApplyArgs(t, kind, names);
    const r = await rowWrite(() => need().applyThemeToAll(a.theme, a.kind, a.names));
    const w = mainWindow();
    if (w && !w.isDestroyed()) w.webContents.send(CH.baseThemeChanged);
    return r;
  });

  handle(CH.relationsList, (o) => need().listRelations(relationsListOptions(o)));
  handle(CH.relationsSave, (r, o) => tableOp(() => need().saveRelation(relation(r), o === null ? null : lookupName(o))));
  handle(CH.relationsDelete, (n) => tableOp(() => need().deleteRelation(lookupName(n))));
  handle(CH.relationsLayout, () => need().relationsLayout());
  handle(CH.tablesSaveColumnWidths, (n, w) => rowWrite(() => need().saveColumnWidths(lookupName(n), columnWidths(w))));
  handle(CH.tablesSaveSheetLayout, (n, l) => rowWrite(() => need().saveSheetLayout(lookupName(n), sheetLayoutArg(l))));
  handle(CH.relationsSaveLayout, (l) => rowWrite(() => need().saveRelationsLayout(relationsLayout(l))));
  handle(CH.relationsCascadeChildren, (t) => need().cascadeChildren(lookupName(t)));

  handle(CH.importPick, async () => {
    const p = await pickImportPath({ text: catalog().importText.filterText, all: catalog().importText.filterAll });
    if (p !== null) chosenImports.add(p);
    return p;
  });
  handle(CH.importPreview, (p, s) => need().importPreview(importPath(p, chosenImports), importSpecOrNull(s), catalog().importText.fieldPrefix));
  handle(CH.importRun, (p, plan) => { const path = importPath(p, chosenImports); const pl = importPlan(plan); return runImport(() => need().importRun(path, pl, importTexts())); });
  handle(CH.importExcelPick, async (kind) => {
    const p = kind === 'xml' ? await pickExcelPath(catalog().exchange.xmlFilter, 'xml') : await pickExcelPath(catalog().exchange.excelFilter);
    if (p !== null) chosenImports.add(p);
    return p;
  });
  handle(CH.importExcelPreview, (p, sheet, header) => need().importExcelPreview(importPath(p, chosenImports), sheetOrNull(sheet), boolOrNull(header), catalog().importText.fieldPrefix));
  handle(CH.importExcelRun, (p, sheet, header, plan) => {
    const path = importPath(p, chosenImports); const sh = sheetOrNull(sheet); const hh = boolOrNull(header); const pl = importPlan(plan);
    if (sh === null || hh === null) throw new Error('bc:invalidArgument');
    return runImport(() => need().importExcelRun(path, sh, hh, pl, importTexts()));
  });
  handle(CH.importSpecs, () => need().importSpecs());
  handle(CH.importSaveSpec, (n, s) => rowWrite(() => need().saveImportSpec(nameArg(n), importSpec(s))));
  handle(CH.importDeleteSpec, (n) => rowWrite(() => need().deleteImportSpec(lookupName(n))));

  // Linked tables (C1). Design (absent from the Runtime) but refresh (R15). The session refuses the front-end itself (self).
  handle(CH.linksPick, async (k) => {
    const c = catalog().link;
    const p = await pickLinkPath({ basecraft: c.filterBasecraft, sqlite: c.filterSqlite, access: c.filterAccess, all: catalog().importText.filterAll }, linkKindOrUndefined(k));
    if (p !== null) chosenLinks.add(p);
    return p;
  });
  handle(CH.linksInspect, (p) => need().inspectLinkFile(linkPath(p, chosenLinks)));
  handle(CH.linksCreate, (p, n) => { const path = linkPath(p, chosenLinks); const names = nameList(n); return tableOp(() => need().createLinks(path, names)); });
  handle(CH.linksList, () => need().listLinks());
  handle(CH.linksRefresh, (n) => need().refreshLinks(nameList(n)));
  handle(CH.linksRelink, (n, p) => { const names = nameList(n); const path = linkPath(p, chosenLinks); return tableOp(() => need().relink(names, path)); });
  handle(CH.linksConvert, (n) => tableOp(() => need().convertLink(lookupName(n))));
  // C2 R7: data (the Runtime unlocks too); the session accepts a source of the front-end or the picked file only.
  handle(CH.linksUnlock, (p, pw) => { const path = unlockPath(p); return need().unlockAccess(path, accessPassword(pw), chosenLinks.has(path)); });
  // C4 R10: data too (the Runtime logs in). The password goes to the data process and the store, never back to the renderer.
  handle(CH.linksLogin, async (k, u, pw, r) => {
    const key = serverKey(k); const user = loginUser(u); const password = accessPassword(pw); const remember = bool(r);
    const ok = await need().login(key, user, password);
    if (ok) { credentials.set(key, { user, password }, remember); pushed.add(key); } else { credentials.forget(key); pushed.delete(key); } // M6
    return ok;
  });
  handle(CH.linksLoginInfo, async (k) => {
    const key = serverKey(k);
    const d = await need().loginDefaults(key);
    return { user: credentials.user(key) ?? d.user, label: d.label, canRemember: credentials.canStore() };
  });
  // C4 Task 12, design: the server link dialog. Its login, accepted, is kept as `linksLogin` keeps one (R10, G2).
  handle(CH.linksInspectServer, async (k, p, pw, r) => {
    const kind = serverKind(k); const params = serverParams(kind, p) as { user: string }; const password = accessPassword(pw); const remember = bool(r);
    const info = await need().inspectServer(kind, params, params.user, password);
    credentials.set(info.key, { user: params.user, password }, remember);
    pushed.add(info.key); // db-host keeps the dialog's accepted login too
    return info;
  });
  handle(CH.linksCreateServer, (k, p, n) => {
    const kind = serverKind(k); const params = serverParams(kind, p); const names = nameList(n);
    return tableOp(() => need().createServerLinks(kind, params, names));
  });
  handle(CH.linksRelinkServer, (n, k, p) => {
    const names = nameList(n); const kind = serverKind(k); const params = serverParams(kind, p);
    return tableOp(() => need().relinkServer(names, kind, params));
  });
  handle(CH.linksCanRemember, () => credentials.canStore());
  // C7 R1: the renderer has closed every document (as the split); one at a time with imports and exports (their progress event).
  handle(CH.migrateRun, async (r) => {
    const req = migrateRequest(r);
    await whenIdle();
    return runImport(() => need().migrateToServer(req));
  });
  // C7 R17: names are inspectServer's offered names; one at a time with imports and exports (their progress event).
  handle(CH.migrateImport, async (k, p, n) => {
    const kind = serverKind(k); const params = serverParams(kind, p); const names = nameList(n);
    await whenIdle();
    return runImport(() => need().importServerTables(kind, params, names));
  });
  // E1: the path is one links.pick returned; the file is only read. Progress and Stop as the other imports.
  handle(CH.accessImportInspect, (p) => need().inspectAccessImport(linkPath(p, chosenLinks)));
  handle(CH.accessImportRun, async (p, n) => {
    const path = linkPath(p, chosenLinks); const names = nameList(n);
    await whenIdle();
    return runImport(() => need().importAccessTables(path, names));
  });
  handle(CH.accessImportSaveReport, async (t, n) => {
    const text = reportBody(t); const name = bareFileName(n);
    const path = await pickTextPath(name, catalog().exchange.textFilter);
    if (path === null) return false;
    await viaTemp(path, (tmp) => writeFile(tmp, text, 'utf8')); // a failure leaves the file already there untouched
    return true;
  });

  handle(CH.tablesCopy, (a, b, m) => {
    if (m !== undefined && m !== 'structure' && m !== 'data') throw new TypeError('bc:invalidArgument');
    return tableOp(() => need().copyTable(lookupName(a), nameArg(b), m));
  });
  handle(CH.tablesAppend, (a, b) => rowWrite(() => need().appendTable(lookupName(a), lookupName(b))));
  handle(CH.objectsList, (k) => need().listObjects(objectKindOrAll(k)));
  handle(CH.objectsGet, (k, n) => need().getObject(objectKind(k), lookupName(n)));
  handle(CH.objectsSave, (k, n, d, o) => objectWrite(() => need().saveObject(objectKind(k), nameArg(n), definition(d), o === null ? null : lookupName(o))));
  handle(CH.objectsRename, (k, a, b) => objectWrite(() => need().renameObject(objectKind(k), lookupName(a), nameArg(b), logLabels(catalog().autoCorrect))));
  handle(CH.autoCorrectDependents, (c) => need().autoCorrectDependents(nameChanges(c)));
  handle(CH.autoCorrectApplyProperties, (items) => objectWrite(async () => ({ ok: true, count: await need().applyProperties(propertyTargetsArg(items)) })));
  handle(CH.objectsDelete, (k, n) => objectWrite(() => need().deleteObject(objectKind(k), lookupName(n))));
  handle(CH.objectsCopy, (k, n, to) => objectWrite(() => need().copyObject(objectKind(k), lookupName(n), nameArg(to))));
  handle(CH.objectsSetDescription, (k, n, d) => tableOp(() => need().setDescription(k === 'table' ? k : objectKind(k), lookupName(n), description(d))));
  handle(CH.sourcesDescribe, (r, p) => need().describeSource(sourceRef(r), p === undefined ? undefined : queryParams(p)));
  handle(CH.sourcesPage, (r, q) => need().pageSource(sourceRef(r), sourcePageRequest(q)));
  handle(CH.chartsData, (q) => need().chartData(chartDataRequest(q)));
  handle(CH.sourcesSave, (r, q) => rowWrite(() => need().saveSource(...sourceSaveRequest(r, q))));
  handle(CH.sourcesAutoLookup, (r, v) => need().autoLookup(...autoLookupRequest(r, v)));
  handle(CH.queriesActionCount, (r, p) => contentRefused(() => need().actionCount(queryRef(r), queryParams(p))));
  handle(CH.queriesRunAction, (r, p, o) => contentRefused(() => need().runAction(queryRef(r), queryParams(p), runActionOptions(o))));
  handle(CH.queriesCancel, () => cancelCall());

  // Reports: nothing is written into the base (allowed read-only); the PDF goes only to the path chosen in the dialog (4.8).
  handle(CH.reportsExportPdf, async (r) => {
    const req = printRequest(r);
    const path = await pickPdfPath(pdfFileName(req.name), catalog().report.pdfFilter);
    if (path === null) return 'canceled';
    const pdf = await renderToPdf(req);
    try {
      await replaceFile(path, pdf); // a failure leaves the PDF already there untouched
    } catch (e) {
      console.error(e);
      throw new Error('bc:writeFailed');
    }
    return 'saved';
  });
  handle(CH.reportsPrint, (r) => printDocument(printRequest(r)));
  handle(CH.exchangeExportText, (s, spec, name) => runExport(exportSource(s), exportSpec(spec), lookupName(name)));
  handle(CH.exchangeExportExcel, (s, name) => runExport(exportSource(s), null, lookupName(name)));
  handle(CH.exchangeExportMarkup, (s, format, name) => runExport(exportSource(s), null, lookupName(name), markupFormat(format)));
  // F4: the saved exports live in the base's options (the Runtime keeps them too, as it keeps the exports)
  handle(CH.exchangeSavedList, () => need().savedExports());
  handle(CH.exchangeSavedSave, (n, e) => rowWrite(() => need().saveSavedExport(nameArg(n), savedExport(e))));
  handle(CH.exchangeSavedDelete, (n) => rowWrite(() => need().deleteSavedExport(lookupName(n))));
}
