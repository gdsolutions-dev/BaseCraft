// Gestionnaires ipcMain de l'API window.basecraft : émetteur vérifié, arguments vérifiés, une session à la fois.
import { app, ipcMain, nativeTheme, shell, type BrowserWindow } from 'electron';
import { randomUUID } from 'node:crypto';
import { readFileSync, realpathSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { CH, type AppInfo, type ContentState, type LicenseEntry, type OpResult, type RelationResult, type SaveTableResult, type SessionState } from '../shared/api';
import { MAX_EXCEL_ROWS } from '../shared/exchange';
import { sheetName } from '../shared/export-format';
import { resolveUiLanguage } from '../shared/i18n';
import en from '../shared/i18n/en.json';
import fr from '../shared/i18n/fr.json';
import { regionTag } from '../shared/locale-format';
import { FILE_EXTENSION } from './db/file-format';
import { keepAlive, releaseIfOurs } from './db/lock';
import { DbHost, type AsyncSession } from './db-host/client';
import type { HostEvent } from './db-host/protocol';
import { pickExcelPath, pickExportPath, pickImportPath, pickOpenPath, pickPdfPath, pickSavePath } from './dialogs';
import { CloseVeto } from './close-veto';
import {
  basePath, cells, definition, exportSource, exportSpec, fieldFilters, importPath, importPlan, importSpec, sheetOrNull, boolOrNull, importSpecOrNull, objectKind, objectKindOrAll, pageRequest, relation,
  relationsLayout, saveRequest, lookupName, nameArg, printRequest, sourcePageRequest, sourceRef, uint, uints, description, queryRef, queryParams, runActionOptions,
} from './ipc-validate';
import type { ImportTexts } from './import/text-import';
import { pdfFileName, printDocument, renderToPdf, replaceFile } from './report-print';
import { addRecentFile, loadSettings, saveSettings, type AppSettings } from './settings';
import { ApprovalStore, contentState, enabledAfterOwnWrite, readTrustConfig, systemTrustPath, type TrustConfig } from './trust';

let mainWindow: () => BrowserWindow | null = () => null;
let dir = '';
let settings: AppSettings;
/** The open base: its data process (db-host). The main process never opens SQLite itself. */
let host: DbHost | null = null;
let closing: Promise<void> = Promise.resolve();
export const closeVeto = new CloseVeto();
/** This user's approvals and the administrator's trusted folders (trust.ts), set up once in registerIpc. */
let approvals: ApprovalStore;
let trustConfig: TrustConfig = { trustedFolders: [] };

const region = () => regionTag(process.env.BASECRAFT_REGION ?? app.getSystemLocale());
const uiLanguage = () => resolveUiLanguage(settings.locale, region());
const catalog = () => (uiLanguage() === 'fr' ? fr : en);
/** What an import writes into the base, in the interface language (as Access does). */
const importTexts = (): ImportTexts => {
  const c = catalog();
  return { fieldPrefix: c.importText.fieldPrefix, idName: c.designer.defaultIdName, errorSuffix: c.importText.errorSuffix, errorFields: c.importText.errorFields, messages: c.fieldError, log: c.importText.log };
};
let importing = false;
/** Files the user chose in the main-side open dialog: the only ones the import may read (never a path made up by the renderer). */
const chosenImports = new Set<string>();

const HOMEPAGE = 'https://github.com/gdsolutions-dev/BaseCraft';
function appInfo(): AppInfo {
  return {
    version: app.getVersion(),
    electron: process.versions.electron, chromium: process.versions.chrome, node: process.versions.node, sqlite: process.versions.sqlite ?? '',
    platform: process.platform, arch: process.arch,
    copyright: '© 2026 GD Solutions', licence: 'GNU AGPL v3',
    links: { homepage: HOMEPAGE, issues: `${HOMEPAGE}/issues`, licence: `${HOMEPAGE}/blob/main/LICENSE` },
  };
}

function broadcast(s: SessionState | null): void {
  const w = mainWindow();
  if (w && !w.isDestroyed()) w.webContents.send(CH.baseStateChanged, s);
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
/** Settles once no opening or restart (Stop) is in progress: quitting waits for it, so the new process's lock is released. */
export const whenIdle = (): Promise<void> => baseOps.then(() => {});

/** Closes the base after the calls already queued (3 s at most), then removes its lock if a killed process left it. */
export function closeBase(): Promise<void> {
  const h = host;
  if (!h) return closing;
  host = null;
  const before = closing;
  closing = h.close().catch(console.error).finally(() => releaseIfOurs(h.opened.path, h.opened.sessionId)).then(() => before);
  broadcast(null);
  return closing;
}

/** Windows shutdown or logoff: the process may end before an asynchronous close. The data process is killed (SQLite rolls
 *  an unfinished write back at the next open) and the lock is removed at once. */
export function abandonBase(): void {
  const h = host;
  if (!h) return;
  host = null;
  void h.kill();
  releaseIfOurs(h.opened.path, h.opened.sessionId);
}

/** The data process ended on its own: the base is closed, and the window says so once (the calls it had pending reject
 *  bc:hostCrashed, which the renderer's error dialog leaves to this notice). */
function hostCrashed(h: DbHost): void {
  if (host !== h) return;
  host = null;
  releaseIfOurs(h.opened.path, h.opened.sessionId);
  broadcast(null);
  const w = mainWindow();
  if (w && !w.isDestroyed()) w.webContents.send(CH.baseHostCrashed);
}

async function startHost(path: string, create: boolean, sessionId: string): Promise<DbHost> {
  let me: DbHost | null = null;
  const onEvent = (e: HostEvent) => {
    if (host !== me) return;
    const w = mainWindow();
    if (e.event === 'stateChanged') broadcast(me?.state ?? e.state); // with its content state (client.ts keeps it)
    else if (w && !w.isDestroyed()) w.webContents.send(CH.importProgress, { done: e.done, total: e.total });
  };
  try {
    const { host: h } = await DbHost.start({ path, create, appVersion: app.getVersion(), region: region(), sessionId }, onEvent, () => { if (me) hostCrashed(me); });
    me = h;
    return h;
  } catch (e) {
    releaseIfOurs(path, sessionId); // a process that ended during the open may leave its lock
    throw e;
  }
}

/** The active content enabled in each data process, by fingerprint ('' : none); absent or null: disabled. */
const enabledFor = new WeakMap<DbHost, string | null>();

/** Tells the data process which content runs (null: none, action queries refused) and sets the state; broadcast if it changed. */
async function setContent(h: DbHost, fingerprint: string | null, content: ContentState, announce = true): Promise<void> {
  try { await h.session.setContentEnabled(fingerprint); } catch (e) { if (fingerprint !== null) throw e; } // null: a process gone runs nothing
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
function objectWrite(fn: () => Promise<OpResult>): Promise<OpResult | SaveTableResult | RelationResult> {
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
    try {
      settings = addRecentFile(settings, path, process.platform);
      saveSettings(dir, settings);
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
  if (!h.state.readOnly) keepAlive(h.opened.path, h.opened.sessionId);
  if (tickPending) return;
  tickPending = true;
  h.session.tick().catch(console.error).finally(() => { tickPending = false; });
}

/** The calls Stop may end: reads of a query or table, and action queries (one transaction, rolled back). Never a row write,
 *  an import or a design change. */
const STOPPABLE = new Set(['describeSource', 'pageSource', 'actionCount', 'runAction', 'page', 'count', 'lookup']);

/**
 * Stop (Ctrl+Break, « Arrêter »): ends the oldest pending query call. A row write executing before it finishes first (a
 * committed write never answers bc:cancelled, so saving it again cannot duplicate it). Then the data process is killed
 * (that call and the calls queued behind it, never started, reject bc:cancelled; SQLite rolls an interrupted action query
 * back) and the base reopens under the same opening (its lock is adopted).
 * DbHost keeps one call in flight, so the kill can only end the targeted call; nothing behind it has reached the data process.
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
    await h.kill();
    try {
      const n = await startHost(h.opened.path, false, h.opened.sessionId);
      await decideContent(n);
      if (host !== h) { await n.close(); return; } // closed meanwhile
      host = n;
      broadcast(n.state);
    } catch (e) {
      if (host === h) host = null;
      releaseIfOurs(h.opened.path, h.opened.sessionId);
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
const tableOp = async (fn: () => Promise<OpResult | SaveTableResult | RelationResult>): Promise<OpResult | SaveTableResult | RelationResult> => {
  try { return await fn(); } catch (e) { if (isReadOnly(e)) return { ok: false, reason: 'readOnly' }; throw e; }
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
async function runExport(src: ReturnType<typeof exportSource>, spec: ReturnType<typeof exportSpec> | null, defaultName: string): Promise<unknown> {
  if (importing) throw new Error('bc:invalidArgument');
  importing = true;
  try {
    // Excel (no spec): too many rows is told before the dialog
    if (!spec && (await need().exportRowCount(src)) > MAX_EXCEL_ROWS) return { ok: false, reason: 'tooManyRows', limit: MAX_EXCEL_ROWS };
    const { yes, no, textFilter, excelFilter } = catalog().exchange;
    const path = await pickExportPath(defaultName, spec ? 'text' : 'excel', spec ? textFilter : excelFilter);
    if (path === null) return { ok: false, reason: 'cancelled' };
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
  // E2E only (unpackaged + BASECRAFT_E2E=1): the tests' trusted folders replace the system file.
  const e2eTrust = process.env.BASECRAFT_E2E === '1' && !app.isPackaged ? process.env.BASECRAFT_E2E_TRUST_CONFIG : undefined;
  trustConfig = readTrustConfig(e2eTrust || systemTrustPath(process.platform, process.env));
  // The native popups (<select> lists, menus, scroll bars) follow the app's theme, not Windows'.
  nativeTheme.themeSource = settings.theme;
  const handle = (ch: string, fn: (...args: unknown[]) => unknown) =>
    ipcMain.handle(ch, (e, ...args) => {
      const w = mainWindow();
      if (!w || e.sender !== w.webContents) throw new Error('Unauthorized IPC sender');
      // after an opening or a restart (Stop) in progress: the command-line base, a call issued just after Stop
      return baseOps.then(() => fn(...args));
    });
  const update = (patch: Partial<AppSettings>) => { settings = { ...settings, ...patch }; saveSettings(dir, settings); };

  handle(CH.getSettings, () => ({ ...settings, uiLanguage: uiLanguage(), region: region() }));
  handle(CH.setLocale, (l) => {
    if (!['system', 'fr', 'en'].includes(l as string)) throw new Error('Invalid locale');
    update({ locale: l as AppSettings['locale'] });
  });
  handle(CH.setTheme, (t) => {
    if (!['system', 'light', 'dark'].includes(t as string)) throw new Error('Invalid theme');
    update({ theme: t as AppSettings['theme'] });
    nativeTheme.themeSource = settings.theme;
  });
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
    const p = await pickSavePath((uiLanguage() === 'fr' ? fr : en).dialog.newBaseName + FILE_EXTENSION);
    return p === null ? null : openBase(p, true);
  });
  handle(CH.baseOpen, async (p) => {
    const path = p === undefined ? await pickOpenPath() : basePath(p);
    return path === null ? null : openBase(path);
  });
  handle(CH.baseClose, () => closeBase());
  handle(CH.baseState, () => host?.state ?? null);
  // File › Save As (A6): a checked copy (VACUUM INTO), which then becomes the open base. Reads only: allowed read-only.
  handle(CH.baseSaveAs, async () => {
    need();
    const current = host!.opened.path;
    const p = await pickSavePath(catalog().dialog.copyName.replace('{{name}}', basename(current, FILE_EXTENSION)) + FILE_EXTENSION);
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
  // Reopening in write mode, unlinking the lock (bcError in the data process); the content is decided again (a crashed base
  // could not be read before).
  handle(CH.baseTakeOverLock, async () => {
    need();
    const h = host!;
    await h.session.takeOverLock();
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
  handle(CH.tablesSave, (r) => tableOp(() => need().saveTable(saveRequest(r))));
  handle(CH.tablesRename, (a, b) => tableOp(() => need().renameTable(lookupName(a), nameArg(b))));
  handle(CH.tablesDrop, (n) => tableOp(() => need().dropTable(lookupName(n))));
  handle(CH.tablesTestRules, (n) => need().testRules(lookupName(n)));

  handle(CH.rowsCount, (t, f) => need().count(lookupName(t), fieldFilters(f)));
  handle(CH.rowsPage, (t, r) => need().page(lookupName(t), pageRequest(r)));
  handle(CH.rowsInsert, (t, v) => rowWrite(() => need().insert(lookupName(t), cells(v))));
  handle(CH.rowsUpdate, (t, id, c) => rowWrite(() => need().update(lookupName(t), uint(id), cells(c))));
  handle(CH.rowsDelete, (t, ids) => rowWrite(() => need().delete(lookupName(t), uints(ids))));
  handle(CH.rowsLookup, (t, fd) => need().lookup(lookupName(t), lookupName(fd)));

  handle(CH.relationsList, () => need().listRelations());
  handle(CH.relationsSave, (r, o) => tableOp(() => need().saveRelation(relation(r), o === null ? null : lookupName(o))));
  handle(CH.relationsDelete, (n) => tableOp(() => need().deleteRelation(lookupName(n))));
  handle(CH.relationsLayout, () => need().relationsLayout());
  handle(CH.relationsSaveLayout, (l) => rowWrite(() => need().saveRelationsLayout(relationsLayout(l))));
  handle(CH.relationsCascadeChildren, (t) => need().cascadeChildren(lookupName(t)));

  handle(CH.importPick, async () => {
    const p = await pickImportPath({ text: catalog().importText.filterText, all: catalog().importText.filterAll });
    if (p !== null) chosenImports.add(p);
    return p;
  });
  handle(CH.importPreview, (p, s) => need().importPreview(importPath(p, chosenImports), importSpecOrNull(s), catalog().importText.fieldPrefix));
  handle(CH.importRun, (p, plan) => { const path = importPath(p, chosenImports); const pl = importPlan(plan); return runImport(() => need().importRun(path, pl, importTexts())); });
  handle(CH.importExcelPick, async () => {
    const p = await pickExcelPath(catalog().exchange.excelFilter);
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

  handle(CH.tablesCopy, (a, b, m) => {
    if (m !== undefined && m !== 'structure' && m !== 'data') throw new TypeError('bc:invalidArgument');
    return tableOp(() => need().copyTable(lookupName(a), nameArg(b), m));
  });
  handle(CH.tablesAppend, (a, b) => rowWrite(() => need().appendTable(lookupName(a), lookupName(b))));
  handle(CH.objectsList, (k) => need().listObjects(objectKindOrAll(k)));
  handle(CH.objectsGet, (k, n) => need().getObject(objectKind(k), lookupName(n)));
  handle(CH.objectsSave, (k, n, d, o) => objectWrite(() => need().saveObject(objectKind(k), nameArg(n), definition(d), o === null ? null : lookupName(o))));
  handle(CH.objectsRename, (k, a, b) => objectWrite(() => need().renameObject(objectKind(k), lookupName(a), nameArg(b))));
  handle(CH.objectsDelete, (k, n) => objectWrite(() => need().deleteObject(objectKind(k), lookupName(n))));
  handle(CH.objectsCopy, (k, n, to) => objectWrite(() => need().copyObject(objectKind(k), lookupName(n), nameArg(to))));
  handle(CH.objectsSetDescription, (k, n, d) => tableOp(() => need().setDescription(k === 'table' ? k : objectKind(k), lookupName(n), description(d))));
  handle(CH.sourcesDescribe, (r) => need().describeSource(sourceRef(r)));
  handle(CH.sourcesPage, (r, q) => need().pageSource(sourceRef(r), sourcePageRequest(q)));
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
}
