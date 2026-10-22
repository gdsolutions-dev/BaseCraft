import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import { CH, type BasecraftApi, type SessionState } from '../shared/api';
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
    onStateChanged: (cb) => {
      const listener = (_e: IpcRendererEvent, s: SessionState | null) => cb(s);
      ipcRenderer.on(CH.baseStateChanged, listener);
      return () => { ipcRenderer.removeListener(CH.baseStateChanged, listener); };
    },
  },
  tables: {
    list: () => ipcRenderer.invoke(CH.tablesList),
    design: (name) => ipcRenderer.invoke(CH.tablesDesign, name),
    save: (req) => ipcRenderer.invoke(CH.tablesSave, req),
    rename: (oldName, newName) => ipcRenderer.invoke(CH.tablesRename, oldName, newName),
    drop: (name) => ipcRenderer.invoke(CH.tablesDrop, name),
  },
  rows: {
    count: (table) => ipcRenderer.invoke(CH.rowsCount, table),
    page: (table, req) => ipcRenderer.invoke(CH.rowsPage, table, req),
    insert: (table, values) => ipcRenderer.invoke(CH.rowsInsert, table, values),
    update: (table, rowid, changes) => ipcRenderer.invoke(CH.rowsUpdate, table, rowid, changes),
    delete: (table, rowids) => ipcRenderer.invoke(CH.rowsDelete, table, rowids),
  },
  relations: {
    list: () => ipcRenderer.invoke(CH.relationsList),
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
};

contextBridge.exposeInMainWorld('basecraft', api);
