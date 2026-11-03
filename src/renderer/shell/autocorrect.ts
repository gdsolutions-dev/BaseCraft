// Name AutoCorrect, renderer side (O4 R10): a rename is refused while a dependent is open with unsaved changes, and what the
// correction could not do is reported afterwards.
import { createElement } from 'react';
import type { AutoCorrectReport, NameChange, ObjRef, PropertyUpdate } from '../../shared/api';
import { api } from '../bridge';
import { i18n } from '../i18n';
import { isDoc, type AppAction, type DocTab } from '../state/app-state';
import type { ModalApi } from './Modal';
import { PropertyUpdateDialog } from './PropertyUpdateDialog';

const t = (k: string, o?: Record<string, unknown>) => i18n.t(k, o) as string;
const list = (refs: ObjRef[]) => refs.map((r) => `${t(`autoCorrect.kind.${r.kind}`)} ${r.name}`).join('\n');

/** R10: the dependents open with unsaved changes (the saved table's own tab excluded: `self`). */
export function dirtyDependents(tabs: DocTab[], deps: ObjRef[], self?: ObjRef): ObjRef[] {
  return deps.filter((d) => !(self && self.kind === d.kind && self.name === d.name)
    && tabs.some((x) => x.dirty && isDoc(x, d.kind, d.name)));
}

/** Asks the dependents and refuses (message naming them) when one is dirty; true: go on. Skipped when changes is empty. */
export async function guardRename(modal: ModalApi, tabs: DocTab[], changes: NameChange[], self?: ObjRef): Promise<boolean> {
  if (!changes.length) return true;
  const dirty = dirtyDependents(tabs, await api.autoCorrect.dependents(changes), self);
  if (!dirty.length) return true;
  const c = changes[0];
  const name = c.k === 'object' ? c.from : c.renames[0].from;
  await modal.confirm({ titleKey: 'autoCorrect.dirtyTitle', messageKey: 'autoCorrect.dirty', params: { name, list: list(dirty) }, buttons: ['ok'] });
  return false;
}

/** After success: objectSaved / tableSaved per corrected object, tablesChanged for a log table, then one message when
 *  failed, stale or logSkipped is not empty (failed first). */
export async function afterRename(modal: ModalApi, dispatch: (a: AppAction) => void, report: AutoCorrectReport | undefined): Promise<void> {
  if (!report) return;
  for (const o of report.corrected) dispatch(o.kind === 'table' ? { type: 'tableSaved', name: o.name } : { type: 'objectSaved', kind: o.kind, name: o.name });
  if (report.logTable && !report.logSkipped) dispatch({ type: 'tablesChanged' });
  const show = (key: string, params: object) => modal.confirm({ titleKey: `autoCorrect.${key}Title`, messageKey: `autoCorrect.${key}`, params, buttons: ['ok'] });
  if (report.failed.length) await show('failed', { list: list(report.failed) });
  if (report.stale.length) await show('stale', { list: list(report.stale) });
  if (report.logSkipped) await modal.confirm({ titleKey: 'dialog.errorTitle', messageKey: 'autoCorrect.logSkipped', params: { table: report.logTable }, buttons: ['ok'] });
}

/** O4 R12: one dialog per update; « Oui » writes the ticked targets, refused (message naming them) when one is open with
 *  unsaved changes; then `objectSaved` for each object written. */
export async function offerPropertyUpdates(modal: ModalApi, tabs: DocTab[], dispatch: (a: AppAction) => void, updates: PropertyUpdate[] | undefined): Promise<void> {
  for (const u of updates ?? []) {
    const chosen = await modal.custom<PropertyUpdate['targets']>((close) => createElement(PropertyUpdateDialog, { update: u, onClose: close }), { titleKey: 'propertyUpdate.title' });
    if (!chosen?.length) continue;
    const dirty = dirtyDependents(tabs, chosen.map((x) => ({ kind: x.kind, name: x.name })));
    if (dirty.length) {
      await modal.confirm({ titleKey: 'autoCorrect.dirtyTitle', messageKey: 'autoCorrect.dirty', params: { name: `${u.table}.${u.field}`, list: list(dirty) }, buttons: ['ok'] });
      continue;
    }
    const r = await api.autoCorrect.applyProperties(chosen.map((x) => ({ kind: x.kind, name: x.name, control: x.control, prop: u.prop, value: u.value })));
    if (!r.ok) { await modal.confirm({ titleKey: 'dialog.errorTitle', messageKey: 'dialog.op.readOnly', buttons: ['ok'] }); continue; }
    for (const o of new Map(chosen.map((x) => [`${x.kind}|${x.name}`, x])).values()) dispatch({ type: 'objectSaved', kind: o.kind, name: o.name });
  }
}
