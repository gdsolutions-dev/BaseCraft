// Boîtes Ouvrir/Enregistrer. Crochet de test : avec BASECRAFT_E2E=1 (application non empaquetée seulement), aucune boîte
// ne s'ouvre et le chemin vient de l'environnement.
import { app, BrowserWindow, dialog } from 'electron';
import { join } from 'node:path';
import { FILE_EXTENSION } from './db/file-format';

const filters = [{ name: 'BaseCraft', extensions: [FILE_EXTENSION.slice(1)] }];
const e2e = () => process.env.BASECRAFT_E2E === '1' && !app.isPackaged;

export async function pickSavePath(defaultName: string): Promise<string | null> {
  if (e2e()) return process.env.BASECRAFT_E2E_SAVE_PATH ?? null;
  const opts = { defaultPath: join(app.getPath('documents'), defaultName), filters };
  const win = BrowserWindow.getFocusedWindow();
  const r = win ? await dialog.showSaveDialog(win, opts) : await dialog.showSaveDialog(opts);
  if (r.canceled || !r.filePath) return null;
  return r.filePath.toLowerCase().endsWith(FILE_EXTENSION) ? r.filePath : r.filePath + FILE_EXTENSION;
}

export async function pickOpenPath(): Promise<string | null> {
  if (e2e()) return process.env.BASECRAFT_E2E_OPEN_PATH ?? null;
  const opts = { filters, properties: ['openFile' as const] };
  const win = BrowserWindow.getFocusedWindow();
  const r = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts);
  return r.canceled ? null : (r.filePaths[0] ?? null);
}

/** Fichier texte à importer ; `names` : libellés des filtres (langue de l'interface). */
export async function pickImportPath(names: { text: string; all: string }): Promise<string | null> {
  if (e2e()) return process.env.BASECRAFT_E2E_IMPORT_PATH ?? null;
  const opts = {
    filters: [{ name: names.text, extensions: ['txt', 'csv', 'tab', 'asc'] }, { name: names.all, extensions: ['*'] }],
    properties: ['openFile' as const],
  };
  const win = BrowserWindow.getFocusedWindow();
  const r = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts);
  return r.canceled ? null : (r.filePaths[0] ?? null);
}

/** Classeur Excel à importer (A6). */
export async function pickExcelPath(filterName: string): Promise<string | null> {
  if (e2e()) return process.env.BASECRAFT_E2E_EXCEL_PATH ?? null;
  const opts = { filters: [{ name: filterName, extensions: ['xlsx', 'xlsm'] }], properties: ['openFile' as const] };
  const win = BrowserWindow.getFocusedWindow();
  const r = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts);
  return r.canceled ? null : (r.filePaths[0] ?? null);
}

/** Where to write an export (A6); `defaultName` is a bare name (no folder), the extension follows `format`. */
export async function pickExportPath(defaultName: string, format: 'text' | 'excel', filterName: string): Promise<string | null> {
  if (e2e()) return process.env.BASECRAFT_E2E_EXPORT_PATH ?? null;
  const extensions = format === 'text' ? ['csv', 'txt'] : ['xlsx'];
  const base = defaultName.replace(/[\\/:*?"<>|]/g, '_');
  const opts = { defaultPath: join(app.getPath('documents'), `${base}.${extensions[0]}`), filters: [{ name: filterName, extensions }] };
  const win = BrowserWindow.getFocusedWindow();
  const r = win ? await dialog.showSaveDialog(win, opts) : await dialog.showSaveDialog(opts);
  if (r.canceled || !r.filePath) return null;
  return extensions.some((x) => r.filePath.toLowerCase().endsWith(`.${x}`)) ? r.filePath : `${r.filePath}.${extensions[0]}`;
}

/** Where to write a PDF; `filterName` in the interface language. Always ends with .pdf. */
export async function pickPdfPath(defaultName: string, filterName: string): Promise<string | null> {
  if (e2e()) return process.env.BASECRAFT_E2E_PDF_PATH ?? null;
  const opts = { defaultPath: join(app.getPath('documents'), defaultName), filters: [{ name: filterName, extensions: ['pdf'] }] };
  const win = BrowserWindow.getFocusedWindow();
  const r = win ? await dialog.showSaveDialog(win, opts) : await dialog.showSaveDialog(opts);
  if (r.canceled || !r.filePath) return null;
  return r.filePath.toLowerCase().endsWith('.pdf') ? r.filePath : r.filePath + '.pdf';
}
