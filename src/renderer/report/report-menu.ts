// Menu contextuel d'un état dans le volet de navigation (règle C6, spec des menus 2.4) : Ouvrir (Aperçu avant impression),
// Mode Page (L3), Mode création (le concepteur de bandes, tâche 12), Exporter › PDF, Imprimer…, Aperçu avant impression.
// Mêmes id que les éléments génériques du socle, qu'ils remplacent ; Imprimer et Exporter n'ouvrent pas d'onglet.
import { Eye, FileType, FolderOutput, LayoutTemplate, PencilRuler, Printer, ScrollText } from 'lucide-react';
import { api } from '../bridge';
import { allowsLayout } from '../form/views';
import { registerNavMenuItems, type NavMenuContext } from '../shell/nav-menu';
import { tabCommandState } from '../shell/ribbon-model';
import { loadReportDoc } from './load';
import { outputBusy, outputSavedReport } from './ReportPreviewView';

const preview = (c: NavMenuContext) => { void c.dispatch({ type: 'open', kind: 'report', name: c.name, mode: 'run' }); };
const output = (to: 'pdf' | 'printer') => async (c: NavMenuContext) => { await outputSavedReport(c.modal, c.name, to); };   // cancelled by an event: silently
const idle = () => !outputBusy();   // one print or export at a time
/** Le mode Page est-il permis ? Ouvert, la vue de l'état le dit (sa valeur en cours de modification, son état de commande) ;
 *  sinon AllowLayoutView lu dans la définition enregistrée : non (false) ne fait rien ; illisible, le concepteur dit pourquoi. */
async function layoutAllowed(c: NavMenuContext): Promise<boolean> {
  if (c.openTab) return tabCommandState(c.openTab, 'viewLayout')?.enabled !== false;
  try { return allowsLayout(await loadReportDoc(api, c.name), 'report'); } catch { return true; }
}

registerNavMenuItems('report', [
  { id: 'open', group: 'open', order: 10, labelKey: 'nav.menu.open', icon: ScrollText, run: preview },
  { id: 'layout', group: 'open', order: 15, labelKey: 'nav.menu.layout', icon: LayoutTemplate, visible: (c) => !c.runtime,
    run: async (c) => { if (await layoutAllowed(c)) void c.dispatch({ type: 'open', kind: 'report', name: c.name, mode: 'layout' }); } },
  { id: 'design', group: 'open', order: 20, labelKey: 'nav.menu.design', icon: PencilRuler, visible: (c) => !c.runtime,
    run: (c) => { void c.dispatch({ type: 'open', kind: 'report', name: c.name, mode: 'design' }); } },   // read-only base: the designer opens read-only
  { id: 'export', group: 'transfer', order: 20, labelKey: 'nav.menu.export', icon: FolderOutput, submenu: [
    { id: 'pdf', group: 'transfer', order: 10, labelKey: 'nav.menu.exportPdf', icon: FileType, enabled: idle, run: output('pdf') },
  ] },
  { id: 'print', group: 'print', order: 10, labelKey: 'nav.menu.print', icon: Printer, enabled: idle, run: output('printer') },
  { id: 'printPreview', group: 'print', order: 20, labelKey: 'nav.menu.printPreview', icon: Eye, run: preview },
]);
