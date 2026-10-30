// Menu contextuel du volet de navigation, éléments des tables liées (C1, règle C6) : Actualiser le lien (aussi dans BaseCraft
// Runtime, R15) et Convertir en table locale (R12). Aucun concepteur importé : module d'exécution.
import { HardDriveDownload, RefreshCw } from 'lucide-react';
import { api } from '../bridge';
import { registerNavMenuItems, type NavMenuContext } from '../shell/nav-menu';

/** Reopens the link's file (a stale lock is taken over, R4): « Lien actualisé. » or why it is not usable. */
async function refreshLink(c: NavMenuContext) {
  const [r] = await api.links.refresh([c.name]);
  if (!r) throw new Error('bc:notFound'); // gone meanwhile
  c.dispatch({ type: 'tableDataChanged', name: c.name }); // an open datasheet reads it again
  if (r.state === 'ok') await c.modal.confirm({ titleKey: 'nav.menu.refreshLink', messageKey: 'link.refreshed', buttons: ['ok'] });
  else await c.modal.confirm({ titleKey: 'dialog.errorTitle', messageKey: `dialog.error.linkUnavailable_${r.state}`, params: { detail: r.path }, buttons: ['ok'] });
}

let leaveTable: (name: string) => Promise<boolean> = async () => true;
/** The shell lets the table's documents have their say first (a pending row saved, or its discard asked), as a tab's close does. */
export function setNavLeaveTable(fn: typeof leaveTable): void { leaveTable = fn; }

/** The link's table copied into this base under its name, the link removed (R12); its documents are closed first, as before a Delete. */
async function convertToLocal(c: NavMenuContext) {
  const ok = await c.modal.confirm({ titleKey: 'nav.menu.convertToLocal', messageKey: 'link.confirmConvert', params: { name: c.name }, buttons: ['yes', 'no'], defaultButton: 'no' });
  if (ok !== 'yes' || !(await leaveTable(c.name))) return; // a document that stays (a row it keeps) cancels the conversion
  c.dispatch({ type: 'tableDropped', name: c.name });
  const r = await api.links.convert(c.name);
  c.dispatch({ type: 'tableSaved', name: c.name }); // the pane reads its tables again (the link, kept on a refusal, or the local table)
  if (!r.ok) await c.modal.confirm({ titleKey: 'dialog.errorTitle', messageKey: `dialog.op.${r.reason}`, params: { name: c.name, table: '', view: '' }, buttons: ['ok'] });
}

registerNavMenuItems('table', [
  { id: 'refreshLink', group: 'link', order: 20, labelKey: 'nav.menu.refreshLink', icon: RefreshCw, visible: (c) => !!c.link, run: refreshLink },
  { id: 'convertToLocal', group: 'link', order: 30, labelKey: 'nav.menu.convertToLocal', icon: HardDriveDownload,
    visible: (c) => !!c.link && !c.runtime, enabled: (c) => !c.readOnly, run: convertToLocal },
]);
