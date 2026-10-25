// Éléments du menu contextuel du volet de navigation fournis par le socle (spec des menus, section 2) : Ouvrir et Mode création
// génériques, Importer › Fichier texte, Renommer, Supprimer, Copier… (jusqu'au presse-papiers de A6), Propriétés. Les
// fonctions pas encore livrées (A6, plus tard) sont des emplacements désactivés dont l'info-bulle nomme le lot (comme le ruban).
// Les lots A3, A4, A5 remplacent Ouvrir et Mode création de leurs objets en inscrivant les mêmes id (ces éléments sont des
// replis : un lot l'emporte quel que soit l'ordre d'import).
import { ClipboardPaste, Copy, EyeOff, LayoutTemplate, FileText, FolderInput, FileSpreadsheet, FolderOutput, PencilRuler, Pencil, Scissors, Settings, Sheet, Trash2 } from 'lucide-react';
import type { ObjectKind, OpResult } from '../../shared/api';
import { api } from '../bridge';
import { i18n } from '../i18n';
import type { DocKind } from '../state/app-state';
import { nameErrorKey } from './name-error';
import { hasDocumentView } from './document-views';
import { registerNavMenuItems, type NavMenuContext, type NavMenuItem } from './nav-menu';
import { showObjectProperties } from './ObjectProperties';

export { nameErrorKey };

let importText: (table: string) => void = () => {};
/** The shell opens the text import wizard with "Append to this table" preselected. */
export function setNavImportText(fn: (table: string) => void): void { importText = fn; }

const askName = (c: NavMenuContext, titleKey: string, labelKey: string, initial: string) => c.modal.prompt({
  titleKey, labelKey, initial, validate: (v) => { const k = nameErrorKey(v); return k && i18n.t(k); },
});
/** Runs an operation: a refusal (name taken, read-only, relations…) is explained, a success calls `done`. */
async function op(c: NavMenuContext, fn: () => Promise<OpResult>, done: () => void, params: { name: string; newName?: string }) {
  const r = await fn();
  if (r.ok) return done();
  await c.modal.confirm({
    titleKey: 'dialog.errorTitle', messageKey: `dialog.op.${r.reason}`,
    params: { ...params, table: 'table' in r ? r.table : '', view: 'view' in r ? r.view : '' }, buttons: ['ok'],
  });
}

const writable = (c: NavMenuContext) => !c.readOnly;
const design = (c: NavMenuContext) => !c.runtime;

async function rename(c: NavMenuContext) {
  const to = await askName(c, c.kind === 'table' ? 'nav.renameTitle' : 'nav.renameObjectTitle', 'nav.renameLabel', c.name);
  if (to === null || to === c.name) return;
  const params = { name: c.name, newName: to };
  if (c.kind === 'table') await op(c, () => api.tables.rename(c.name, to), () => { c.dispatch({ type: 'tableRenamed', from: c.name, to }); c.reselect(to); }, params);
  else {
    const kind = c.kind as ObjectKind;
    await op(c, () => api.objects.rename(kind, c.name, to), () => { c.dispatch({ type: 'objectRenamed', kind, from: c.name, to }); c.reselect(to); }, params);
  }
}

async function remove(c: NavMenuContext) {
  const table = c.kind === 'table';
  const ok = await c.modal.confirm({
    titleKey: table ? 'nav.deleteTitle' : 'nav.deleteObjectTitle', messageKey: table ? 'nav.deleteMessage' : 'nav.deleteObjectMessage',
    params: { name: c.name }, buttons: ['yes', 'no'], defaultButton: 'no',
  });
  if (ok !== 'yes') return;
  if (table) await op(c, () => api.tables.drop(c.name), () => { c.dispatch({ type: 'tableDropped', name: c.name }); c.reselect(null); }, { name: c.name });
  else {
    const kind = c.kind as ObjectKind;
    await op(c, () => api.objects.delete(kind, c.name), () => { c.dispatch({ type: 'objectDeleted', kind, name: c.name }); c.reselect(null); }, { name: c.name });
  }
}

/** The foundation's immediate duplicate (Access's Copy + Paste in one step) until A6's clipboard replaces it (same id). */
async function copy(c: NavMenuContext) {
  const to = await askName(c, 'nav.copyTitle', 'nav.copyLabel', i18n.t('nav.copyDefault', { name: c.name }));
  if (to === null) return;
  const params = { name: c.name, newName: to };
  if (c.kind === 'table') await op(c, () => api.tables.copy(c.name, to), () => c.dispatch({ type: 'tableSaved', name: to }), params);
  else {
    const kind = c.kind as ObjectKind;
    await op(c, () => api.objects.copy(kind, c.name, to), () => c.dispatch({ type: 'objectSaved', kind, name: to }), params);
  }
}

const properties = (c: NavMenuContext) => showObjectProperties(c.modal, { kind: c.kind as ObjectKind | 'table', name: c.name }, c.readOnly, c.dispatch);

/** Generic Open and Design View, the double-click's path (a table's Run view is its datasheet): enabled once the kind has a
 *  view for that mode. A batch delivering its views replaces them by registering the same ids. */
const view = (mode: 'run' | 'design') => ({
  enabled: (c: NavMenuContext) => hasDocumentView(c.kind, mode),
  run: (c: NavMenuContext) => { void c.dispatch({ type: 'open', kind: c.kind, name: c.name, mode: mode === 'design' ? 'design' : c.kind === 'table' ? 'datasheet' : 'run' }); },
});

/** The open, object, clipboard and properties groups every listed kind shares. */
const common = (propertiesLabel: string, exportPlanned: NavMenuItem['planned'] | null): NavMenuItem[] => [
  { id: 'open', group: 'open', order: 10, labelKey: 'nav.menu.open', icon: Sheet, ...view('run') },
  { id: 'design', group: 'open', order: 20, labelKey: 'nav.menu.design', icon: PencilRuler, visible: design, ...view('design') },
  ...(exportPlanned ? [{ id: 'export', group: 'transfer', order: 20, labelKey: 'nav.menu.export', icon: FolderOutput, planned: exportPlanned } as NavMenuItem] : []),
  { id: 'rename', group: 'object', order: 10, labelKey: 'nav.menu.rename', icon: Pencil, visible: design, enabled: writable, run: rename },
  { id: 'hide', group: 'object', order: 20, labelKey: 'nav.menu.hide', icon: EyeOff, planned: 'later' },
  { id: 'delete', group: 'object', order: 30, labelKey: 'nav.menu.delete', icon: Trash2, visible: design, enabled: writable, run: remove },
  { id: 'cut', group: 'clipboard', order: 10, labelKey: 'nav.menu.cut', icon: Scissors, visible: design, planned: 'A6' },
  { id: 'copy', group: 'clipboard', order: 20, labelKey: 'nav.menu.copy', icon: Copy, enabled: writable, run: copy },
  { id: 'paste', group: 'clipboard', order: 30, labelKey: 'nav.menu.paste', icon: ClipboardPaste, visible: design, planned: 'A6' },
  { id: 'properties', group: 'properties', order: 10, labelKey: propertiesLabel, icon: Settings, run: properties },
];

/** Access's Layout View of forms and reports: "later" in the spec (section 7), a placeholder until then (C11). */
const layoutView: NavMenuItem = { id: 'layout', group: 'open', order: 15, labelKey: 'nav.menu.layout', icon: LayoutTemplate, visible: design, planned: 'later' };

const MENUS: [DocKind, NavMenuItem[]][] = [
  ['table', [
    { id: 'import', group: 'transfer', order: 10, labelKey: 'nav.menu.import', icon: FolderInput, visible: design, enabled: writable, submenu: [
      { id: 'text', group: 'transfer', order: 10, labelKey: 'nav.menu.importText', icon: FileText, run: (c) => importText(c.name) },
      { id: 'excel', group: 'transfer', order: 20, labelKey: 'nav.menu.importExcel', icon: FileSpreadsheet, planned: 'A6' },
    ] },
    ...common('nav.menu.tableProperties', 'A6'),
  ]],
  ['query', common('nav.menu.objectProperties', 'A6')],
  ['form', [layoutView, ...common('nav.menu.properties', 'later')]],
  ['report', [layoutView, ...common('nav.menu.properties', null)]], // Export › PDF: A5's own item
  ['macro', common('nav.menu.objectProperties', 'later')], // B1's macro-menu.ts replaces Open and Design View
];

for (const [kind, items] of MENUS) registerNavMenuItems(kind, items, { fallback: true });
