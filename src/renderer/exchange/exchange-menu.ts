// Menu contextuel du volet de navigation, éléments d'échange de A6 (règle C6) : Exporter › Fichier texte des tables et des
// requêtes. Mêmes id que les éléments du socle, qu'ils remplacent. Un seul appel par type d'objet ; les tâches suivantes y ajoutent.
import { ClipboardPaste, Copy, FileSpreadsheet, FileText, FolderInput, FolderOutput, Scissors } from 'lucide-react';
import { registerNavMenuItems, type NavMenuItem } from '../shell/nav-menu';
import { exportNamed } from './export';
import { getClip, setClip } from './object-clipboard';
import { pasteClip } from './paste';

const exportItem: NavMenuItem = {
  id: 'export', group: 'transfer', order: 20, labelKey: 'nav.menu.export', icon: FolderOutput, submenu: [
    { id: 'text', group: 'transfer', order: 10, labelKey: 'nav.menu.exportText', icon: FileText,
      run: (c) => exportNamed(c.modal, c.kind === 'query' ? 'query' : 'table', c.name) },
    { id: 'excel', group: 'transfer', order: 20, labelKey: 'nav.menu.exportExcel', icon: FileSpreadsheet,
      run: (c) => exportNamed(c.modal, c.kind === 'query' ? 'query' : 'table', c.name, 'excel') },
  ],
};

let importExcel: (table: string) => void = () => {};
/** The shell opens the Excel import wizard with "Append to this table" preselected. */
export function setNavImportExcel(fn: (table: string) => void): void { importExcel = fn; }

// Replaces the foundation's placeholder; as a replacing parent it repeats the foundation's group, order, label, visible and enabled.
const importItem: NavMenuItem = {
  id: 'import', group: 'transfer', order: 10, labelKey: 'nav.menu.import', icon: FolderInput, visible: (c) => !c.runtime, enabled: (c) => !c.readOnly, submenu: [
    { id: 'excel', group: 'transfer', order: 20, labelKey: 'nav.menu.importExcel', icon: FileSpreadsheet, run: (c) => importExcel(c.name) },
  ],
};

// Cut, Copy and Paste: the foundation's ids, replaced. Cut and Paste need a writable base; Paste needs a clip and pastes it whatever object was
// right-clicked (a runtime menu has no Cut or Paste, as the foundation's).
const clipboardItems: NavMenuItem[] = [
  { id: 'cut', group: 'clipboard', order: 10, labelKey: 'nav.menu.cut', icon: Scissors, visible: (c) => !c.runtime, enabled: (c) => !c.readOnly,
    run: (c) => setClip({ kind: c.kind, name: c.name, cut: true }) },
  { id: 'copy', group: 'clipboard', order: 20, labelKey: 'nav.menu.copy', icon: Copy, run: (c) => setClip({ kind: c.kind, name: c.name, cut: false }) },
  { id: 'paste', group: 'clipboard', order: 30, labelKey: 'nav.menu.paste', icon: ClipboardPaste, visible: (c) => !c.runtime, enabled: (c) => !c.readOnly && getClip() !== null,
    run: (c) => pasteClip(c) },
];

registerNavMenuItems('table', [importItem, exportItem, ...clipboardItems]);
registerNavMenuItems('query', [exportItem, ...clipboardItems]);
registerNavMenuItems('form', clipboardItems);
registerNavMenuItems('report', clipboardItems);
registerNavMenuItems('macro', clipboardItems);
