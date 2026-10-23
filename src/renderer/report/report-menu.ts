// Menu contextuel d'un état dans le volet de navigation (règle C6, spec des menus 2.4) : Ouvrir (Aperçu avant impression),
// Mode création (le concepteur de bandes, tâche 12), Exporter › PDF, Imprimer…, Aperçu avant impression.
// Mêmes id que les éléments génériques du socle, qu'ils remplacent ; Imprimer et Exporter n'ouvrent pas d'onglet.
import { Eye, FileType, FolderOutput, PencilRuler, Printer, ScrollText } from 'lucide-react';
import { api } from '../bridge';
import { registerNavMenuItems, type NavMenuContext } from '../shell/nav-menu';
import { layoutSavedReport } from './load';
import { askParameters, layoutEnv, outputBusy, outputReport } from './ReportPreviewView';

const preview = (c: NavMenuContext) => { void c.dispatch({ type: 'open', kind: 'report', name: c.name, mode: 'run' }); };
const output = (to: 'pdf' | 'printer') => (c: NavMenuContext) =>
  outputReport(c.modal, c.name, async (signal, ready) => layoutSavedReport(api, c.name, await layoutEnv(), askParameters(c.modal), signal, ready), to);
const idle = () => !outputBusy();   // one print or export at a time

registerNavMenuItems('report', [
  { id: 'open', group: 'open', order: 10, labelKey: 'nav.menu.open', icon: ScrollText, run: preview },
  { id: 'design', group: 'open', order: 20, labelKey: 'nav.menu.design', icon: PencilRuler, visible: (c) => !c.runtime,
    run: (c) => { void c.dispatch({ type: 'open', kind: 'report', name: c.name, mode: 'design' }); } },   // read-only base: the designer opens read-only
  { id: 'export', group: 'transfer', order: 20, labelKey: 'nav.menu.export', icon: FolderOutput, submenu: [
    { id: 'pdf', group: 'transfer', order: 10, labelKey: 'nav.menu.exportPdf', icon: FileType, enabled: idle, run: output('pdf') },
  ] },
  { id: 'print', group: 'print', order: 10, labelKey: 'nav.menu.print', icon: Printer, enabled: idle, run: output('printer') },
  { id: 'printPreview', group: 'print', order: 20, labelKey: 'nav.menu.printPreview', icon: Eye, run: preview },
]);
