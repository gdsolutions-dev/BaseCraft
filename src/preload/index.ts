import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import { CH, type BasecraftApi, type SessionState, type SettingsView } from '../shared/api';
import type { ImportProgress } from '../shared/import-text';

let onClose: (() => void) | null = null;
// Registered at load, before the page subscribes: a close asked before (or without) a subscriber is not lost.
ipcRenderer.on(CH.closeRequested, () => {
  void ipcRenderer.invoke(CH.closeAck); // runs on the page's thread: a hung page never acknowledges
  if (onClose) onClose(); else void ipcRenderer.invoke(CH.closeAllowed);
});

const api: BasecraftApi = {
  app: {
    getSettings: () => ipcRenderer.invoke(CH.getSettings),
    setLocale: (l) => ipcRenderer.invoke(CH.setLocale, l),
    setTheme: (t) => ipcRenderer.invoke(CH.setTheme, t),
    setSetting: (k, v) => ipcRenderer.invoke(CH.setSetting, k, v),
    pickFolder: () => ipcRenderer.invoke(CH.pickFolder),
    onSettingsChanged: (cb) => {
      const listener = (_e: IpcRendererEvent, s: SettingsView) => cb(s);
      ipcRenderer.on(CH.settingsChanged, listener);
      return () => { ipcRenderer.removeListener(CH.settingsChanged, listener); };
    },
    info: () => ipcRenderer.invoke(CH.appInfo),
    licenses: () => ipcRenderer.invoke(CH.appLicenses),
    openExternal: (url) => ipcRenderer.invoke(CH.openExternal, url),
    setWindowIcon: (png) => ipcRenderer.invoke(CH.appSetIcon, png),
    edit: (cmd) => ipcRenderer.invoke(CH.edit, cmd),
    beep: () => ipcRenderer.invoke(CH.beep),
    writeClipboard: (text) => ipcRenderer.invoke(CH.appWriteClipboard, text),
    onCloseRequested: (cb) => {
      onClose = cb;
      return () => { if (onClose === cb) onClose = null; };
    },
    confirmClose: () => ipcRenderer.invoke(CH.closeAllowed),
  },
  base: {
    create: () => ipcRenderer.invoke(CH.baseCreate),
    open: (path) => ipcRenderer.invoke(CH.baseOpen, path),
    close: () => ipcRenderer.invoke(CH.baseClose),
    state: () => ipcRenderer.invoke(CH.baseState),
    takeOverLock: () => ipcRenderer.invoke(CH.baseTakeOverLock),
    openFailure: () => ipcRenderer.invoke(CH.baseOpenFailure),
    onStateChanged: (cb) => {
      const listener = (_e: IpcRendererEvent, s: SessionState | null) => cb(s);
      ipcRenderer.on(CH.baseStateChanged, listener);
      return () => { ipcRenderer.removeListener(CH.baseStateChanged, listener); };
    },
    onHostCrashed: (cb) => {
      const listener = () => cb();
      ipcRenderer.on(CH.baseHostCrashed, listener);
      return () => { ipcRenderer.removeListener(CH.baseHostCrashed, listener); };
    },
    onDataChanged: (cb) => {
      const listener = () => cb();
      ipcRenderer.on(CH.baseDataChanged, listener);
      return () => { ipcRenderer.removeListener(CH.baseDataChanged, listener); };
    },
    saveAs: () => ipcRenderer.invoke(CH.baseSaveAs),
    compact: () => ipcRenderer.invoke(CH.baseCompact),
    splitPick: () => ipcRenderer.invoke(CH.baseSplitPick),
    split: (p) => ipcRenderer.invoke(CH.baseSplit, p),
    enableContent: () => ipcRenderer.invoke(CH.baseEnableContent),
    startup: () => ipcRenderer.invoke(CH.baseStartup),
    saveStartup: (o) => ipcRenderer.invoke(CH.baseSaveStartup, o),
  },
  tables: {
    list: () => ipcRenderer.invoke(CH.tablesList),
    design: (name) => ipcRenderer.invoke(CH.tablesDesign, name),
    testRules: (name) => ipcRenderer.invoke(CH.tablesTestRules, name),
    save: (req) => ipcRenderer.invoke(CH.tablesSave, req),
    rename: (oldName, newName) => ipcRenderer.invoke(CH.tablesRename, oldName, newName),
    drop: (name) => ipcRenderer.invoke(CH.tablesDrop, name),
    copy: (name, newName, mode) => ipcRenderer.invoke(CH.tablesCopy, name, newName, mode),
    append: (from, to) => ipcRenderer.invoke(CH.tablesAppend, from, to),
  },
  rows: {
    count: (table, filter) => ipcRenderer.invoke(CH.rowsCount, table, filter),
    page: (table, req) => ipcRenderer.invoke(CH.rowsPage, table, req),
    insert: (table, values) => ipcRenderer.invoke(CH.rowsInsert, table, values),
    update: (table, rowid, changes, expected) => ipcRenderer.invoke(CH.rowsUpdate, table, rowid, changes, expected),
    delete: (table, rowids) => ipcRenderer.invoke(CH.rowsDelete, table, rowids),
    lookup: (table, field) => ipcRenderer.invoke(CH.rowsLookup, table, field),
  },
  relations: {
    list: (opts) => ipcRenderer.invoke(CH.relationsList, opts),
    save: (rel, originalName) => ipcRenderer.invoke(CH.relationsSave, rel, originalName),
    delete: (name) => ipcRenderer.invoke(CH.relationsDelete, name),
    layout: () => ipcRenderer.invoke(CH.relationsLayout),
    saveLayout: (l) => ipcRenderer.invoke(CH.relationsSaveLayout, l),
    cascadeChildren: (table) => ipcRenderer.invoke(CH.relationsCascadeChildren, table),
  },
  importText: {
    pickFile: () => ipcRenderer.invoke(CH.importPick),
    preview: (path, spec) => ipcRenderer.invoke(CH.importPreview, path, spec),
    run: (path, plan) => ipcRenderer.invoke(CH.importRun, path, plan),
    onProgress: (cb) => {
      const listener = (_e: IpcRendererEvent, p: ImportProgress) => cb(p);
      ipcRenderer.on(CH.importProgress, listener);
      return () => { ipcRenderer.removeListener(CH.importProgress, listener); };
    },
    specs: () => ipcRenderer.invoke(CH.importSpecs),
    saveSpec: (name, spec) => ipcRenderer.invoke(CH.importSaveSpec, name, spec),
    deleteSpec: (name) => ipcRenderer.invoke(CH.importDeleteSpec, name),
  },
  importExcel: {
    pickFile: () => ipcRenderer.invoke(CH.importExcelPick),
    preview: (path, sheet, hasHeader) => ipcRenderer.invoke(CH.importExcelPreview, path, sheet, hasHeader),
    run: (path, sheet, hasHeader, plan) => ipcRenderer.invoke(CH.importExcelRun, path, sheet, hasHeader, plan),
  },
  objects: {
    list: (kind) => ipcRenderer.invoke(CH.objectsList, kind),
    get: (kind, name) => ipcRenderer.invoke(CH.objectsGet, kind, name),
    save: (kind, name, definition, originalName) => ipcRenderer.invoke(CH.objectsSave, kind, name, definition, originalName),
    rename: (kind, oldName, newName) => ipcRenderer.invoke(CH.objectsRename, kind, oldName, newName),
    delete: (kind, name) => ipcRenderer.invoke(CH.objectsDelete, kind, name),
    copy: (kind, name, newName) => ipcRenderer.invoke(CH.objectsCopy, kind, name, newName),
    setDescription: (kind, name, description) => ipcRenderer.invoke(CH.objectsSetDescription, kind, name, description),
  },
  sources: {
    describe: (ref, params) => ipcRenderer.invoke(CH.sourcesDescribe, ref, params),
    page: (ref, req) => ipcRenderer.invoke(CH.sourcesPage, ref, req),
    save: (ref, req) => ipcRenderer.invoke(CH.sourcesSave, ref, req),
    autoLookup: (ref, values) => ipcRenderer.invoke(CH.sourcesAutoLookup, ref, values),
  },
  queries: {
    actionCount: (ref, params) => ipcRenderer.invoke(CH.queriesActionCount, ref, params),
    runAction: (ref, params, opts) => ipcRenderer.invoke(CH.queriesRunAction, ref, params, opts),
    cancel: () => ipcRenderer.invoke(CH.queriesCancel),
  },
  reports: {
    exportPdf: (r) => ipcRenderer.invoke(CH.reportsExportPdf, r),
    print: (r) => ipcRenderer.invoke(CH.reportsPrint, r),
  },
  exchange: {
    exportText: (src, spec, defaultName) => ipcRenderer.invoke(CH.exchangeExportText, src, spec, defaultName),
    exportExcel: (src, defaultName) => ipcRenderer.invoke(CH.exchangeExportExcel, src, defaultName),
    onProgress: (cb) => {
      const listener = (_e: IpcRendererEvent, p: ImportProgress) => cb(p);
      ipcRenderer.on(CH.importProgress, listener);
      return () => { ipcRenderer.removeListener(CH.importProgress, listener); };
    },
  },
  links: {
    pick: (first) => ipcRenderer.invoke(CH.linksPick, first),
    inspect: (path) => ipcRenderer.invoke(CH.linksInspect, path),
    create: (path, names) => ipcRenderer.invoke(CH.linksCreate, path, names),
    list: () => ipcRenderer.invoke(CH.linksList),
    refresh: (names) => ipcRenderer.invoke(CH.linksRefresh, names),
    relink: (names, path) => ipcRenderer.invoke(CH.linksRelink, names, path),
    convert: (name) => ipcRenderer.invoke(CH.linksConvert, name),
    unlock: (path, password) => ipcRenderer.invoke(CH.linksUnlock, path, password),
  },
};

contextBridge.exposeInMainWorld('basecraft', api);
