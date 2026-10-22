// Gestionnaires ipcMain de l'API window.basecraft : émetteur vérifié, arguments vérifiés, une session à la fois.
import { app, ipcMain, type BrowserWindow } from 'electron';
import { CH, type OpResult, type RelationResult, type SaveTableResult, type SessionState } from '../shared/api';
import { resolveUiLanguage } from '../shared/i18n';
import en from '../shared/i18n/en.json';
import fr from '../shared/i18n/fr.json';
import { checkBaseFile, createBaseFile, FILE_EXTENSION } from './db/file-format';
import { systemProbe, type RiskProbe } from './db/location-risk';
import { pickImportPath, pickOpenPath, pickSavePath } from './dialogs';
import { CloseVeto } from './close-veto';
import {
  basePath, bcError, cells, importPath, importPlan, importSpec, importSpecOrNull, pageRequest, relation, relationsLayout, saveRequest, str, strOrNull,
  uint, uints,
} from './ipc-validate';
import type { ImportTexts } from './import/text-import';
import { ReadOnlyError, Session } from './session';
import { addRecentFile, loadSettings, saveSettings, type AppSettings } from './settings';

let mainWindow: () => BrowserWindow | null = () => null;
let dir = '';
let settings: AppSettings;
let session: Session | null = null;
let probe: RiskProbe | undefined;
export const closeVeto = new CloseVeto();

const region = () => process.env.BASECRAFT_REGION ?? app.getSystemLocale();
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

function broadcast(s: SessionState | null): void {
  const w = mainWindow();
  if (w && !w.isDestroyed()) w.webContents.send(CH.baseStateChanged, s);
}

export function currentSession(): Session | null { return session; }

export function closeBase(): void {
  if (!session) return;
  const s = session;
  try {
    s.close();
  } finally {
    session = null;
    broadcast(null);
  }
}

/**
 * Checks (open) or creates (create) the target first, so a bad target leaves the current base open; then closes the
 * current base (one base per window, as in Access) and opens the new one. File errors reject as `bc:<code>`.
 */
export function openBase(path: string, create = false): SessionState {
  try {
    if (create) createBaseFile(path, app.getVersion());
    else checkBaseFile(path);
  } catch (e) {
    throw bcError(e);
  }
  closeBase();
  const deps = { appVersion: app.getVersion(), region: region(), probe: (probe ??= systemProbe()), onStateChanged: broadcast };
  try {
    session = Session.open(path, deps);
  } catch (e) {
    throw bcError(e);
  }
  try {
    settings = addRecentFile(settings, path, process.platform);
    saveSettings(dir, settings);
  } catch (e) {
    console.error(e); // recent files are a convenience: never fail an open that succeeded
  }
  broadcast(session.state);
  return session.state;
}

function need(): Session {
  if (!session) throw new Error('bc:noBase');
  return session;
}
const tableOp = async (fn: () => OpResult | SaveTableResult | RelationResult | Promise<SaveTableResult>): Promise<OpResult | SaveTableResult | RelationResult> => {
  try { return await fn(); } catch (e) { if (e instanceof ReadOnlyError) return { ok: false, reason: 'readOnly' }; throw e; }
};
const rowWrite = async <T>(fn: () => T | Promise<T>): Promise<T> => {
  try { return await fn(); } catch (e) { throw e instanceof ReadOnlyError ? new Error('bc:readOnly') : e; }
};

/** One import at a time; progress goes to the window between blocks of records. */
async function runImport(path: string, plan: ReturnType<typeof importPlan>): Promise<unknown> {
  if (importing) throw new Error('bc:invalidArgument');
  importing = true;
  try {
    const tick = async (done: number, total: number) => {
      const w = mainWindow();
      if (w && !w.isDestroyed()) w.webContents.send(CH.importProgress, { done, total });
      await new Promise((r) => setImmediate(r));
    };
    return await rowWrite(() => need().importRun(path, plan, importTexts(), tick));
  } finally {
    importing = false;
  }
}

export function registerIpc(getMainWindow: () => BrowserWindow | null): void {
  mainWindow = getMainWindow;
  dir = app.getPath('userData');
  settings = loadSettings(dir);
  const handle = (ch: string, fn: (...args: unknown[]) => unknown) =>
    ipcMain.handle(ch, (e, ...args) => {
      const w = mainWindow();
      if (!w || e.sender !== w.webContents) throw new Error('Unauthorized IPC sender');
      return fn(...args);
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
  handle(CH.baseState, () => session?.state ?? null);
  handle(CH.baseTakeOverLock, () => {
    const s = need(); // bc:noBase as is
    try { return s.takeOverLock(); } catch (e) { throw bcError(e); } // reopening in write mode, unlinking the lock
  });

  handle(CH.tablesList, () => need().listTables());
  handle(CH.tablesDesign, (n) => need().tableDesign(str(n)));
  handle(CH.tablesSave, (r) => tableOp(() => need().saveTable(saveRequest(r))));
  handle(CH.tablesRename, (a, b) => tableOp(() => need().renameTable(str(a), str(b))));
  handle(CH.tablesDrop, (n) => tableOp(() => need().dropTable(str(n))));

  handle(CH.rowsCount, (t) => need().count(str(t)));
  handle(CH.rowsPage, (t, r) => need().page(str(t), pageRequest(r)));
  handle(CH.rowsInsert, (t, v) => rowWrite(() => need().insert(str(t), cells(v))));
  handle(CH.rowsUpdate, (t, id, c) => rowWrite(() => need().update(str(t), uint(id), cells(c))));
  handle(CH.rowsDelete, (t, ids) => rowWrite(() => need().delete(str(t), uints(ids))));

  handle(CH.relationsList, () => need().listRelations());
  handle(CH.relationsSave, (r, o) => tableOp(() => need().saveRelation(relation(r), strOrNull(o))));
  handle(CH.relationsDelete, (n) => tableOp(() => need().deleteRelation(str(n))));
  handle(CH.relationsLayout, () => need().relationsLayout());
  handle(CH.relationsSaveLayout, (l) => rowWrite(() => need().saveRelationsLayout(relationsLayout(l))));
  handle(CH.relationsCascadeChildren, (t) => need().cascadeChildren(str(t)));

  handle(CH.importPick, async () => {
    const p = await pickImportPath({ text: catalog().importText.filterText, all: catalog().importText.filterAll });
    if (p !== null) chosenImports.add(p);
    return p;
  });
  handle(CH.importPreview, (p, s) => need().importPreview(importPath(p, chosenImports), importSpecOrNull(s), catalog().importText.fieldPrefix));
  handle(CH.importRun, (p, plan) => runImport(importPath(p, chosenImports), importPlan(plan)));
  handle(CH.importSpecs, () => need().importSpecs());
  handle(CH.importSaveSpec, (n, s) => rowWrite(() => need().saveImportSpec(str(n), importSpec(s))));
  handle(CH.importDeleteSpec, (n) => rowWrite(() => need().deleteImportSpec(str(n))));
}
